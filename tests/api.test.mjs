import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.mjs";
import { createDatabase } from "../server/database.mjs";
import { createSignedEvidenceUrl } from "../server/evidence.mjs";
import { createVerificationService } from "../server/verification.mjs";


const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const EVIDENCE_SECRET = "integration-test-evidence-secret";

let database;
let verificationService;
let server;
let origin;
let temporaryDirectory;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "irlquest-api-test-"));
  database = createDatabase();
  verificationService = createVerificationService({
    database,
    mode: "local",
    delayMs: 5,
    publicBaseUrl: "https://example.test",
    evidenceSecret: EVIDENCE_SECRET,
    logger: { error() {} },
  });
  const app = createApp({
    database,
    verificationService,
    evidenceDir: join(temporaryDirectory, "evidence"),
    evidenceSecret: EVIDENCE_SECRET,
    logger: { warn() {}, error() {} },
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("bootstrap returns three versioned daily assignments and one weekly quest", async () => {
  const response = await fetch(`${origin}/api/bootstrap?date=2026-08-13`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dailyQuests.length, 3);
  assert.equal(body.weeklyQuest.quest.id, "quest_wearable_find");
  assert.ok(body.dailyQuests.every((item) => item.quest.id));
  assert.ok(body.dailyQuests.every((item) => item.quest.version >= 1));
  assert.ok(body.dailyQuests.every((item) => item.quest.difficulty === "easy"));
  assert.ok(body.dailyQuests.every((item) => item.quest.rules.length === 1));
  assert.ok(body.dailyQuests.every((item) => [
    "quest_cup_find",
    "quest_pen_find",
    "quest_book_find",
    "quest_bottle_find",
    "quest_spoon_find",
    "quest_touch_grass",
    "quest_color_hunt",
    "quest_golden_hour",
    "quest_found_face",
    "quest_tiny_wonder",
    "quest_path_view",
    "quest_open_air_view",
    "quest_red_find",
    "quest_yellow_find",
    "quest_hand_sign",
  ].includes(item.quest.id)));
  assert.equal(body.weeklyQuest.quest.version, 2);
  assert.equal(body.weeklyQuest.quest.difficulty, "easy");
  assert.equal(body.weeklyQuest.quest.rules.length, 1);
  assert.equal(body.user.totalXp, 1680);
  assert.ok(Array.isArray(body.proofHistory));
  assert.ok(body.proofHistory.length <= 6);
  assert.ok(body.leaderboard.length >= 2);
  assert.equal(body.leaderboard[0].rank, 1);
  assert.ok(body.user.rank >= 1);
  assert.ok(Array.isArray(body.weeklyGoal.completedDays));
});

test("profile username can be changed and remains unique", async () => {
  const patchProfile = (handle) => fetch(`${origin}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  });

  const updated = await patchProfile("@Alex Moves");
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { handle: "alex_moves" });

  const bootstrap = await (await fetch(`${origin}/api/bootstrap?date=2026-08-13`)).json();
  assert.equal(bootstrap.user.handle, "alex_moves");
  assert.equal(
    bootstrap.leaderboard.find((entry) => entry.userId === bootstrap.user.id).handle,
    "alex_moves",
  );

  const duplicate = await patchProfile("mayamoves");
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already taken/i);

  const invalid = await patchProfile("no!");
  assert.equal(invalid.status, 400);

  const restored = await patchProfile("alexoutside");
  assert.equal(restored.status, 200);
});

test("proof session to local verdict awards XP exactly once", async () => {
  const bootstrapBefore = await (await fetch(`${origin}/api/bootstrap?date=2026-08-13`)).json();
  const assignment = bootstrapBefore.dailyQuests[0];
  const sessionResponse = await fetch(`${origin}/api/proof-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId: assignment.assignmentId }),
  });
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  assert.match(session.sessionCode, /^[A-Z0-9_-]{5}$/);
  assert.ok(session.challenge.length > 10);
  assert.match(session.challenge, /anywhere in the photo/i);
  assert.doesNotMatch(session.challenge, /corner|angle|edge/i);

  const submitResponse = await fetch(`${origin}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proofSessionId: session.id,
      imageDataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    }),
  });
  assert.equal(submitResponse.status, 202);
  let submission = await submitResponse.json();
  assert.equal(submission.status, "pending");

  for (let attempt = 0; attempt < 30 && submission.status === "pending"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    submission = await (await fetch(`${origin}/api/submissions/${submission.id}`)).json();
  }
  assert.equal(submission.status, "accepted");
  assert.equal(submission.verdict.reasonCode, "PASS");

  const bootstrapAfter = await (await fetch(`${origin}/api/bootstrap?date=2026-08-13`)).json();
  assert.equal(bootstrapAfter.user.totalXp, bootstrapBefore.user.totalXp + assignment.quest.xp);
  assert.equal(
    bootstrapAfter.dailyQuests.find((item) => item.assignmentId === assignment.assignmentId).status,
    "completed",
  );
  assert.equal(bootstrapAfter.proofHistory[0].status, "accepted");
  assert.equal(bootstrapAfter.proofHistory[0].questTitle, assignment.quest.title);

  database.raw.prepare(`
    INSERT INTO submissions (
      id, user_id, assignment_id, proof_session_id, evidence_path,
      evidence_mime, evidence_hash, status, verdict_json, created_at, verified_at
    )
    SELECT ?, user_id, assignment_id, proof_session_id, evidence_path,
           evidence_mime, ?, 'review', ?, ?, ?
    FROM submissions WHERE id = ?
  `).run(
    "test_failed_result",
    "test-failed-evidence-hash",
    JSON.stringify({ reasonCode: "NO_VERDICT", summary: "Couldn’t verify this one." }),
    "2026-08-15T09:00:00.000Z",
    "2026-08-15T09:00:01.000Z",
    submission.id,
  );

  const notificationResults = await (await fetch(`${origin}/api/results?page=1&pageSize=10`)).json();
  assert.ok(notificationResults.items.some((item) => item.status === "accepted"));
  assert.ok(notificationResults.items.some((item) => item.status === "review"));

  const proofsResponse = await fetch(`${origin}/api/results?page=1&pageSize=1&status=accepted`);
  assert.equal(proofsResponse.status, 200);
  const proofPage = await proofsResponse.json();
  assert.equal(proofPage.page, 1);
  assert.equal(proofPage.pageSize, 1);
  assert.equal(proofPage.items.length, 1);
  assert.equal(proofPage.total, 1);
  assert.equal(proofPage.totalPages, 1);
  assert.equal(proofPage.items[0].id, submission.id);
  assert.ok(proofPage.items.every((item) => item.status === "accepted"));

  database.raw.prepare(`
    UPDATE submissions
    SET created_at = ?, verified_at = ?
    WHERE id = ?
  `).run("2026-08-14T12:00:00.000Z", "2026-08-14T12:00:01.000Z", submission.id);
  const weeklyBootstrap = database.getBootstrap(
    "demo_explorer",
    "2026-08-15",
    "Africa/Lagos",
  );
  assert.equal(weeklyBootstrap.weeklyGoal.completed, 1);
  assert.deepEqual(weeklyBootstrap.weeklyGoal.completedDays, [
    { date: "2026-08-14", count: 1 },
  ]);

  database.finalizeSubmission({
    submissionId: submission.id,
    status: "accepted",
    verdict: submission.verdict,
  });
  const afterRetry = database.getBootstrap("demo_explorer", "2026-08-13");
  assert.equal(afterRetry.user.totalXp, bootstrapAfter.user.totalXp);

  const replayResponse = await fetch(`${origin}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proofSessionId: session.id,
      imageDataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    }),
  });
  assert.equal(replayResponse.status, 409);
});

test("rate limits are atomic and reject the next request", () => {
  const action = `test_${Date.now()}`;
  assert.equal(database.takeRateLimit("demo_explorer", action, 2, 60, 1_000), true);
  assert.equal(database.takeRateLimit("demo_explorer", action, 2, 60, 1_001), true);
  assert.equal(database.takeRateLimit("demo_explorer", action, 2, 60, 1_002), false);
});

test("signed evidence links expose bytes only before expiry", async () => {
  const pendingIds = database.raw.prepare("SELECT id FROM submissions ORDER BY created_at DESC LIMIT 1").all();
  const submissionId = pendingIds[0].id;
  const signedUrl = createSignedEvidenceUrl({
    publicBaseUrl: origin,
    secret: EVIDENCE_SECRET,
    submissionId,
    lifetimeSeconds: 60,
  });
  const response = await fetch(signedUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const expected = await readFile(database.getSubmission(submissionId).evidencePath);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);

  const invalid = new URL(signedUrl);
  invalid.searchParams.set("signature", "not-the-signature");
  assert.equal((await fetch(invalid)).status, 403);
});

test("media headers cannot disguise arbitrary bytes", async () => {
  const bootstrap = await (await fetch(`${origin}/api/bootstrap?date=2026-08-14`)).json();
  const session = await (await fetch(`${origin}/api/proof-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId: bootstrap.dailyQuests[0].assignmentId }),
  })).json();
  const fake = Buffer.alloc(128, 7).toString("base64");
  const response = await fetch(`${origin}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proofSessionId: session.id, imageDataUrl: `data:image/png;base64,${fake}` }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /contents do not match/i);
});
