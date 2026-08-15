import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseImageDataUrl, saveEvidence, verifyEvidenceSignature } from "./evidence.mjs";

const DEMO_USER_ID = "demo_explorer";
const PROFILE_HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
const LIVE_CHALLENGES = [
  "Include a clear thumbs-up anywhere in the photo.",
  "Include one open hand anywhere in the photo.",
  "Include two raised fingers anywhere in the photo.",
];

const ERROR_MESSAGES = {
  ASSIGNMENT_NOT_AVAILABLE: "That quest is already completed or being verified.",
  EVIDENCE_ALREADY_USED: "That photo was already submitted. Take a fresh one.",
  IMAGE_FORMAT_UNSUPPORTED: "Use a JPEG, PNG, or WebP image.",
  IMAGE_CONTENT_INVALID: "The file contents do not match a supported image format.",
  IMAGE_REQUIRED: "Capture an image before submitting proof.",
  IMAGE_TOO_LARGE: "The image is larger than the 8 MB limit.",
  IMAGE_TOO_SMALL: "The captured image is too small to verify.",
  PROOF_SESSION_EXPIRED: "That live challenge expired. Start the quest again.",
  PROOF_SESSION_NOT_FOUND: "The proof session could not be found.",
  PROOF_SESSION_USED: "That proof session has already been used.",
  RATE_LIMITED: "You’re moving quickly. Wait a moment and try again.",
};

function publicSubmission(submission) {
  return {
    id: submission.id,
    assignmentId: submission.assignmentId,
    questTitle: submission.questTitle,
    xp: submission.xp,
    status: submission.status,
    verdict: submission.verdict,
    transactionHash: submission.transactionHash,
    createdAt: submission.createdAt,
    verifiedAt: submission.verifiedAt,
  };
}

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 10);
}

export function createApp({
  database,
  verificationService,
  evidenceDir,
  evidenceSecret,
  distDir,
  logger = console,
} = {}) {
  const app = express();
  let lastMaintenanceAt = 0;

  async function runMaintenance() {
    if (Date.now() - lastMaintenanceAt < 60 * 60 * 1000) return;
    lastMaintenanceAt = Date.now();
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    for (const evidence of database.listExpiredEvidence(cutoff, 20)) {
      await unlink(evidence.evidencePath).catch(() => undefined);
      database.markEvidenceDeleted(evidence.id);
    }
    const health = database.verificationHealth();
    if (health.stuckSubmissions || health.repeatedFailureQuests) {
      logger.warn?.(`[verification-health] ${JSON.stringify(health)}`);
    }
  }
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(self), geolocation=()");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      verifierMode: verificationService.mode,
      verification: database.verificationHealth(),
    });
  });

  app.get("/api/bootstrap", (request, response) => {
    const data = database.getBootstrap(
      DEMO_USER_ID,
      validDay(request.query.date),
      request.query.timeZone,
    );
    void runMaintenance();
    response.json(data);
  });

  app.get("/api/results", (request, response) => {
    const page = Number(request.query.page);
    const pageSize = Number(request.query.pageSize);
    const status = request.query.status === "accepted" ? "accepted" : null;
    response.setHeader("Cache-Control", "private, no-store");
    return response.json(database.listSubmissionPage(DEMO_USER_ID, page, pageSize, status));
  });

  app.patch("/api/profile", (request, response) => {
    const handle = typeof request.body?.handle === "string"
      ? request.body.handle.trim().replace(/^@+/, "").toLowerCase().replace(/\s+/g, "_")
      : "";
    if (!PROFILE_HANDLE_PATTERN.test(handle)) {
      return response.status(400).json({ error: "Use 3–30 lowercase letters, numbers, or underscores." });
    }
    try {
      const profile = database.updateProfileHandle(DEMO_USER_ID, handle);
      if (!profile) return response.status(404).json({ error: "Profile not found." });
      return response.json(profile);
    } catch (error) {
      if (String(error?.message).includes("UNIQUE constraint failed")) {
        return response.status(409).json({ error: "That username is already taken." });
      }
      throw error;
    }
  });

  app.post("/api/proof-sessions", (request, response) => {
    const assignmentId = request.body?.assignmentId;
    if (typeof assignmentId !== "string") {
      return response.status(400).json({ error: "Choose a quest before starting a proof." });
    }
    if (!database.takeRateLimit(DEMO_USER_ID, "proof_session", 12, 3600)) {
      return response.status(429).json({ error: ERROR_MESSAGES.RATE_LIMITED });
    }
    const assignment = database.getAssignment(assignmentId, DEMO_USER_ID);
    if (!assignment) return response.status(404).json({ error: "Quest assignment not found." });
    if (!["pending", "rejected", "review"].includes(assignment.status)) {
      return response.status(409).json({ error: ERROR_MESSAGES.ASSIGNMENT_NOT_AVAILABLE });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000);
    const nonce = randomBytes(18).toString("base64url");
    const challenge = LIVE_CHALLENGES[randomBytes(1)[0] % LIVE_CHALLENGES.length];
    const session = database.createProofSession({
      id: `proof_${randomUUID()}`,
      userId: DEMO_USER_ID,
      assignmentId,
      nonce,
      challenge,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    });
    return response.status(201).json({
      id: session.id,
      assignmentId: session.assignmentId,
      challenge: session.challenge,
      expiresAt: session.expiresAt,
      sessionCode: session.nonce.slice(0, 5).toUpperCase(),
    });
  });

  app.post("/api/submissions", async (request, response) => {
    let savedPath;
    try {
      const proofSessionId = request.body?.proofSessionId;
      if (typeof proofSessionId !== "string") throw new Error("PROOF_SESSION_NOT_FOUND");
      if (!database.takeRateLimit(DEMO_USER_ID, "submission", 20, 86400)) {
        throw new Error("RATE_LIMITED");
      }
      const image = parseImageDataUrl(request.body?.imageDataUrl);
      const submissionId = `sub_${randomUUID()}`;
      savedPath = await saveEvidence({ evidenceDir, submissionId, image });
      const submission = database.createSubmission({
        id: submissionId,
        userId: DEMO_USER_ID,
        proofSessionId,
        evidencePath: savedPath,
        evidenceMime: image.mime,
        evidenceHash: image.sha256,
        createdAt: new Date().toISOString(),
      });
      verificationService.schedule(submissionId);
      return response.status(202).json(publicSubmission(submission));
    } catch (error) {
      if (savedPath) await unlink(savedPath).catch(() => undefined);
      const message = ERROR_MESSAGES[error.message] || "The proof could not be submitted.";
      const status = error.message === "RATE_LIMITED"
        ? 429
        : error.message?.startsWith("IMAGE_") ? 400 : 409;
      logger.warn?.(`[submission] ${error.message}`);
      return response.status(status).json({ error: message });
    }
  });

  app.get("/api/submissions/:submissionId", (request, response) => {
    const submission = database.getSubmission(request.params.submissionId, DEMO_USER_ID);
    if (!submission) return response.status(404).json({ error: "Submission not found." });
    response.setHeader("Cache-Control", "no-store");
    return response.json(publicSubmission(submission));
  });

  app.get("/api/evidence/:submissionId", (request, response) => {
    const { submissionId } = request.params;
    if (!verifyEvidenceSignature({
      secret: evidenceSecret,
      submissionId,
      expiresAt: request.query.expires,
      signature: request.query.signature,
    })) {
      return response.status(403).json({ error: "This evidence link is invalid or expired." });
    }
    const submission = database.getSubmission(submissionId, DEMO_USER_ID);
    if (!submission || !existsSync(submission.evidencePath)) {
      return response.status(404).json({ error: "Evidence not found." });
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", submission.evidenceMime);
    return response.sendFile(resolve(submission.evidencePath));
  });

  app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found." }));

  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: "1h" }));
    app.use((request, response, next) => {
      if (request.method !== "GET") return next();
      return response.sendFile(resolve(distDir, "index.html"));
    });
  }

  app.use((error, _request, response, _next) => {
    logger.error?.(error);
    if (error?.type === "entity.too.large") {
      return response.status(413).json({ error: "The upload is larger than the request limit." });
    }
    return response.status(500).json({ error: "Something went wrong on the server." });
  });

  return app;
}
