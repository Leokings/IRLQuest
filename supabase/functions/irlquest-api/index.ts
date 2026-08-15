import { withSupabase } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";
import {
  GenLayerResultPendingError,
  genLayerStatusName,
  isGenLayerTerminalStatus,
  isGenLayerTimeoutStatus,
  leaderOnlyTimeoutVerdict,
  waitForGenLayerResult,
} from "./genlayer-receipt.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const EVIDENCE_BUCKET = "quest-evidence";
const CONTRACT_ADDRESS = "0xec9569A41A715D962DD24b3be623792D08a7e709";
const GENLAYER_RPC_URL = "https://rpc-bradbury.genlayer.com";
const MAXIMUM_IMAGE_BYTES = 8 * 1024 * 1024;
const GENLAYER_RECEIPT_TIMEOUT_MS = 90_000;
const GENLAYER_RECEIPT_POLL_MS = 3_000;
const GENLAYER_TIMEOUT_GRACE_MS = 55_000;
const GENLAYER_RESULT_READ_TIMEOUT_MS = 30_000;
const GENLAYER_RESULT_READ_POLL_MS = 2_000;
const HASHED_SUBMISSION_LEASE_MS = 145_000;
const UNRELAYED_SUBMISSION_LEASE_MS = 60_000;
const MAX_UNRELAYED_ATTEMPTS = 3;
const EVIDENCE_RETENTION_DAYS = 30;
const DEFAULT_RESULT_PAGE_SIZE = 8;
const MAX_RESULT_PAGE_SIZE = 20;
const PROOF_SESSION_LIMIT_PER_HOUR = 12;
const SUBMISSION_LIMIT_PER_DAY = 20;
const processingSubmissions = new Set<string>();

const LIVE_CHALLENGES = [
  "Include a clear thumbs-up anywhere in the photo.",
  "Include one open hand anywhere in the photo.",
  "Include two raised fingers anywhere in the photo.",
];

const ERROR_MESSAGES: Record<string, string> = {
  ASSIGNMENT_NOT_AVAILABLE: "That quest is already completed or being verified.",
  ASSIGNMENT_NOT_FOUND: "Quest assignment not found.",
  EVIDENCE_ALREADY_USED: "That photo was already submitted. Take a fresh one.",
  IMAGE_CONTENT_INVALID: "The file contents do not match a supported image format.",
  IMAGE_FORMAT_UNSUPPORTED: "Use a JPEG, PNG, or WebP image.",
  IMAGE_REQUIRED: "Capture an image before submitting proof.",
  IMAGE_TOO_LARGE: "The image is larger than the 8 MB limit.",
  IMAGE_TOO_SMALL: "The captured image is too small to verify.",
  PROOF_SESSION_EXPIRED: "That live challenge expired. Start the quest again.",
  PROOF_SESSION_NOT_FOUND: "The proof session could not be found.",
  PROOF_SESSION_USED: "That proof session has already been used.",
  RATE_LIMITED: "You’re moving quickly. Wait a moment and try again.",
};

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

class ConsensusStillPendingError extends Error {}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
    },
  });
}

function validDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date().toISOString().slice(0, 10);
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return new Date().toISOString().slice(0, 10);
  }
  return value;
}

function boundedInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function addDays(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function startOfIsoWeek(day: string) {
  const date = new Date(`${day}T12:00:00.000Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

function validTimeZone(value: unknown) {
  if (typeof value !== "string" || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "UTC";
  }
}

function dayInTimeZone(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function levelForXp(totalXp: number) {
  const perLevel = 250;
  const level = Math.floor(totalXp / perLevel) + 1;
  const currentLevelXp = totalXp - (level - 1) * perLevel;
  return {
    level,
    currentLevelXp,
    nextLevelXp: perLevel,
    progress: Math.min(100, Math.round((currentLevelXp / perLevel) * 100)),
  };
}

function displayNameForUser(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {};
  const candidate = [metadata.full_name, metadata.name, metadata.preferred_username]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  const fallback = user.email?.split("@")[0] || "Explorer";
  return String(candidate || fallback).trim().slice(0, 80);
}

function initialsForName(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "Q";
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomChallenge() {
  const byte = crypto.getRandomValues(new Uint8Array(1))[0];
  return LIVE_CHALLENGES[byte % LIVE_CHALLENGES.length];
}

function databaseError(error: { message?: string } | null, fallback: string): never {
  const message = error?.message || fallback;
  const knownCode = Object.keys(ERROR_MESSAGES).find((code) => message.includes(code));
  if (knownCode) throw new HttpError(ERROR_MESSAGES[knownCode], 409);
  console.error(`[database] ${message}`);
  throw new HttpError(fallback, 500);
}

async function enforceRateLimit(
  admin: any,
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number,
) {
  const { data, error } = await admin.rpc("irlquest_take_rate_limit", {
    p_user_id: userId,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) databaseError(error, "The request limit could not be checked.");
  if (!data) throw new HttpError(ERROR_MESSAGES.RATE_LIMITED, 429);
}

async function claimMaintenance(admin: any, name: string, intervalSeconds: number) {
  const { data, error } = await admin.rpc("irlquest_claim_maintenance", {
    p_name: name,
    p_min_interval_seconds: intervalSeconds,
  });
  if (error) throw new Error(`Maintenance claim failed: ${error.message}`);
  return Boolean(data);
}

async function completeMaintenance(admin: any, name: string, detail: Record<string, unknown>) {
  const { error } = await admin.rpc("irlquest_complete_maintenance", {
    p_name: name,
    p_detail: detail,
  });
  if (error) throw new Error(`Maintenance completion failed: ${error.message}`);
}

async function cleanupExpiredEvidence(admin: any) {
  if (!await claimMaintenance(admin, "evidence_cleanup", 3600)) return;
  const cutoff = new Date(Date.now() - EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("submissions")
    .select("id, evidence_path")
    .neq("status", "pending")
    .is("evidence_deleted_at", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`Evidence cleanup query failed: ${error.message}`);

  let deleted = 0;
  for (const submission of data ?? []) {
    const { error: removeError } = await admin.storage
      .from(EVIDENCE_BUCKET)
      .remove([submission.evidence_path]);
    if (removeError) {
      console.error(`[evidence-cleanup] ${submission.id}: ${removeError.message}`);
      continue;
    }
    const { error: updateError } = await admin
      .from("submissions")
      .update({ evidence_deleted_at: new Date().toISOString() })
      .eq("id", submission.id)
      .is("evidence_deleted_at", null);
    if (updateError) {
      console.error(`[evidence-cleanup] ${submission.id}: ${updateError.message}`);
      continue;
    }
    deleted += 1;
  }
  await completeMaintenance(admin, "evidence_cleanup", { deleted, retentionDays: EVIDENCE_RETENTION_DAYS });
}

async function scanVerificationHealth(admin: any) {
  const { data, error } = await admin.rpc("irlquest_scan_verification_health");
  if (error) throw new Error(`Verification health scan failed: ${error.message}`);
  const open = (data ?? []).reduce(
    (sum: number, item: Record<string, unknown>) => sum + Number(item.open_count ?? 0),
    0,
  );
  if (open > 0) console.warn(`[verification-health] ${JSON.stringify(data)}`);
}

async function recoverGlobalStaleSubmissions(admin: any) {
  if (!await claimMaintenance(admin, "verification_recovery", 60)) return;
  const { data, error } = await admin
    .from("submissions")
    .select("id, user_id, processing_lease_until")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(`Global recovery query failed: ${error.message}`);
  const now = Date.now();
  const stale = (data ?? []).filter((submission: Record<string, unknown>) => (
    typeof submission.processing_lease_until !== "string"
    || new Date(submission.processing_lease_until).getTime() <= now
  ));
  await Promise.all(stale.map((submission: Record<string, unknown>) => (
    processSubmission(admin, String(submission.id), String(submission.user_id))
  )));
  await scanVerificationHealth(admin);
  await completeMaintenance(admin, "verification_recovery", { recovered: stale.length });
}

async function runMaintenance(admin: any) {
  try {
    await Promise.all([
      cleanupExpiredEvidence(admin),
      recoverGlobalStaleSubmissions(admin),
    ]);
  } catch (error) {
    console.error(`[maintenance] ${error instanceof Error ? error.message : String(error)}`);
  }
}

function questFromVersion(version: Record<string, unknown>) {
  return {
    id: String(version.quest_id),
    versionId: String(version.id),
    version: Number(version.version),
    slug: String(version.slug),
    title: String(version.title),
    prompt: String(version.prompt),
    description: String(version.description),
    category: String(version.category),
    difficulty: String(version.difficulty),
    xp: Number(version.xp),
    icon: String(version.icon),
    accent: String(version.accent),
    captureTip: String(version.capture_tip),
    rules: Array.isArray(version.verification_rules) ? version.verification_rules.map(String) : [],
  };
}

function assignmentFromRow(row: Record<string, any>) {
  return {
    assignmentId: row.id,
    assignedDate: row.assigned_date,
    status: row.status,
    submissionId: row.submission_id,
    quest: questFromVersion(row.version),
  };
}

async function ensureProfile(admin: any, user: any) {
  const displayName = displayNameForUser(user);
  const handle = `explorer_${String(user.id).replace(/-/g, "").slice(0, 8)}`;
  const { error } = await admin.from("profiles").upsert({
    id: user.id,
    display_name: displayName,
    handle,
    avatar_url: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
    avatar_initials: initialsForName(displayName),
  }, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) databaseError(error, "Your explorer profile could not be prepared.");
}

async function bootstrap(admin: any, user: any, requestedDay: unknown, requestedTimeZone: unknown) {
  const day = validDay(requestedDay);
  const timeZone = validTimeZone(requestedTimeZone);
  const weekStart = startOfIsoWeek(day);
  const weekEnd = addDays(weekStart, 7);
  await ensureProfile(admin, user);

  const { error: assignmentError } = await admin.rpc("irlquest_ensure_assignments", {
    p_user_id: user.id,
    p_assigned_date: day,
  });
  if (assignmentError) databaseError(assignmentError, "Today's quests could not be assigned.");
  EdgeRuntime.waitUntil(recoverStaleSubmissions(admin, user.id));
  EdgeRuntime.waitUntil(runMaintenance(admin));

  const { data: testerData, error: testerError } = await admin.rpc("irlquest_is_tester", {
    p_user_id: user.id,
  });
  if (testerError) databaseError(testerError, "Your quest access could not be loaded.");
  const isTester = Boolean(testerData);

  const [
    profileResult,
    assignmentResult,
    xpResult,
    activityResult,
    weeklyCompletionResult,
    historyResult,
    leaderboardResult,
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("id", user.id).single(),
    admin
      .from("daily_assignments")
      .select(`
        id,
        assigned_date,
        status,
        submission_id,
        quest:quests!daily_assignments_quest_id_fkey(cadence, state),
        version:quest_versions!daily_assignments_quest_version_id_fkey(
          id, quest_id, version, slug, title, prompt, description, category,
          difficulty, xp, icon, accent, capture_tip, verification_rules
        )
      `)
      .eq("user_id", user.id)
      .in("assigned_date", [day, weekStart]),
    admin.from("xp_events").select("amount").eq("user_id", user.id),
    admin
      .from("xp_events")
      .select("id, amount, reason, created_at, quest:quests(title, icon, accent)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("submissions")
      .select("verified_at, created_at")
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .gte("verified_at", `${addDays(weekStart, -1)}T00:00:00.000Z`)
      .lt("verified_at", `${addDays(weekEnd, 1)}T00:00:00.000Z`),
    admin
      .from("submissions")
      .select(`
        id, assignment_id, status, verdict, transaction_hash, created_at, verified_at,
        assignment:daily_assignments!submissions_assignment_id_fkey(
          version:quest_versions!daily_assignments_quest_version_id_fkey(title, xp)
        )
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(6),
    admin.rpc("irlquest_leaderboard", { p_limit: 25 }),
  ]);

  if (profileResult.error) databaseError(profileResult.error, "Your profile could not be loaded.");
  if (assignmentResult.error) databaseError(assignmentResult.error, "Today's quests could not be loaded.");
  if (xpResult.error) databaseError(xpResult.error, "Your XP could not be loaded.");
  if (activityResult.error) databaseError(activityResult.error, "Your activity could not be loaded.");
  if (weeklyCompletionResult.error) databaseError(weeklyCompletionResult.error, "Your weekly goal could not be loaded.");
  if (historyResult.error) databaseError(historyResult.error, "Your proof history could not be loaded.");
  if (leaderboardResult.error) databaseError(leaderboardResult.error, "The leaderboard could not be loaded.");

  const assignments = (assignmentResult.data ?? [])
    .filter((row: Record<string, any>) => (
      row.quest?.state === "active"
      || (row.quest?.state === "testing" && isTester)
    ))
    .map((row: Record<string, any>) => ({
      ...assignmentFromRow(row),
      cadence: row.quest?.cadence,
    }));
  const dailyQuests = assignments
    .filter((item: Record<string, any>) => item.cadence === "daily" && item.assignedDate === day)
    .sort((left: Record<string, any>, right: Record<string, any>) => left.quest.xp - right.quest.xp)
    .map(({ cadence: _cadence, ...item }: Record<string, any>) => item);
  const weekly = assignments.find((item: Record<string, any>) => item.cadence === "weekly");
  const weeklyQuest = weekly
    ? (({ cadence: _cadence, ...item }: Record<string, any>) => item)(weekly)
    : null;
  const totalXp = (xpResult.data ?? []).reduce(
    (sum: number, event: { amount: number }) => sum + Number(event.amount),
    0,
  );
  const weeklyCompletionCounts = new Map<string, number>();
  for (const completion of weeklyCompletionResult.data ?? []) {
    const instant = completion.verified_at ?? completion.created_at;
    if (typeof instant !== "string") continue;
    const completionDay = dayInTimeZone(instant, timeZone);
    if (completionDay < weekStart || completionDay >= weekEnd) continue;
    weeklyCompletionCounts.set(
      completionDay,
      (weeklyCompletionCounts.get(completionDay) ?? 0) + 1,
    );
  }
  const completedDays = [...weeklyCompletionCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const weeklyCompleted = completedDays.reduce((sum, item) => sum + item.count, 0);
  const profile = profileResult.data;
  const verifierMode = Deno.env.get("GENLAYER_RELAYER_PRIVATE_KEY") ? "genlayer" : "local";
  const leaderboard = (leaderboardResult.data ?? []).map((entry: Record<string, any>) => ({
    rank: Number(entry.rank_position),
    userId: entry.user_id,
    displayName: entry.display_name,
    handle: entry.handle,
    avatarInitials: entry.avatar_initials,
    totalXp: Number(entry.total_xp),
    currentStreak: Number(entry.current_streak),
    longestStreak: Number(entry.longest_streak),
    completedQuests: Number(entry.completed_quests),
  }));
  const leaderboardProfile = leaderboard.find((entry: Record<string, any>) => entry.userId === user.id);

  return {
    date: day,
    verifierMode,
    genLayerContractAddress: CONTRACT_ADDRESS,
    user: {
      id: profile.id,
      displayName: profile.display_name,
      handle: profile.handle,
      avatarInitials: profile.avatar_initials,
      totalXp,
      currentStreak: Number(profile.current_streak),
      longestStreak: Number(profile.longest_streak),
      completedQuests: leaderboardProfile?.completedQuests ?? 0,
      rank: leaderboardProfile?.rank ?? null,
      ...levelForXp(totalXp),
    },
    dailyQuests,
    weeklyQuest,
    activity: (activityResult.data ?? []).map((event: Record<string, any>) => ({
      id: event.id,
      amount: Number(event.amount),
      reason: event.reason,
      createdAt: event.created_at,
      questTitle: event.quest?.title ?? null,
      icon: event.quest?.icon ?? null,
      accent: event.quest?.accent ?? null,
    })),
    proofHistory: (historyResult.data ?? []).map((submission: Record<string, any>) => (
      publicSubmission(submission)
    )),
    leaderboard: leaderboard.slice(0, 10),
    weeklyGoal: {
      completed: Math.min(5, weeklyCompleted),
      target: 5,
      completedDays,
    },
  };
}

async function createProofSession(admin: any, userId: string, assignmentId: unknown) {
  if (typeof assignmentId !== "string") throw new HttpError("Choose a quest before starting a proof.");
  await enforceRateLimit(admin, userId, "proof_session", PROOF_SESSION_LIMIT_PER_HOUR, 3600);
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("irlquest_create_proof_session", {
    p_user_id: userId,
    p_assignment_id: assignmentId,
    p_nonce: randomNonce(),
    p_challenge: randomChallenge(),
    p_expires_at: expiresAt,
  });
  if (error) databaseError(error, "The live proof session could not be created.");
  const session = data?.[0];
  if (!session) throw new HttpError("The live proof session could not be created.", 500);
  return {
    id: session.session_id,
    assignmentId: session.assignment_id,
    challenge: session.challenge,
    expiresAt: session.expires_at,
    sessionCode: session.session_code,
  };
}

function decodeImageDataUrl(dataUrl: unknown) {
  if (typeof dataUrl !== "string") throw new HttpError(ERROR_MESSAGES.IMAGE_REQUIRED);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) throw new HttpError(ERROR_MESSAGES.IMAGE_FORMAT_UNSUPPORTED);
  let binary: string;
  try {
    binary = atob(match[2].replace(/[\r\n]/g, ""));
  } catch {
    throw new HttpError(ERROR_MESSAGES.IMAGE_CONTENT_INVALID);
  }
  if (binary.length < 64) throw new HttpError(ERROR_MESSAGES.IMAGE_TOO_SMALL);
  if (binary.length > MAXIMUM_IMAGE_BYTES) throw new HttpError(ERROR_MESSAGES.IMAGE_TOO_LARGE, 413);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const mime = match[1];
  const valid = (
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mime === "image/png" && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value))
    || (mime === "image/webp"
      && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
      && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP")
  );
  if (!valid) throw new HttpError(ERROR_MESSAGES.IMAGE_CONTENT_INVALID);
  return {
    bytes,
    mime,
    extension: mime === "image/jpeg" ? "jpg" : mime.split("/")[1],
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicSubmission(row: Record<string, any>) {
  const assignment = row.assignment;
  const version = assignment?.version;
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    questTitle: version?.title ?? "Quest",
    xp: Number(version?.xp ?? 0),
    status: row.status,
    verdict: row.verdict,
    transactionHash: row.transaction_hash,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}

async function listResults(
  admin: any,
  userId: string,
  requestedPage: unknown,
  requestedPageSize: unknown,
  requestedStatus: unknown,
) {
  const page = boundedInteger(requestedPage, 1, 10_000);
  const pageSize = boundedInteger(requestedPageSize, DEFAULT_RESULT_PAGE_SIZE, MAX_RESULT_PAGE_SIZE);
  const status = requestedStatus === "accepted" ? "accepted" : null;
  const from = (page - 1) * pageSize;
  let query = admin
    .from("submissions")
    .select(`
      id, assignment_id, status, verdict, transaction_hash, created_at, verified_at,
      assignment:daily_assignments!submissions_assignment_id_fkey(
        version:quest_versions!daily_assignments_quest_version_id_fkey(title, xp)
      )
    `, { count: "exact" })
    .eq("user_id", userId);
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) databaseError(error, "Your results could not be loaded.");
  const total = count ?? 0;
  return {
    items: (data ?? []).map((submission: Record<string, any>) => publicSubmission(submission)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function getSubmission(admin: any, userId: string, submissionId: string) {
  const { data, error } = await admin
    .from("submissions")
    .select(`
      id, user_id, assignment_id, proof_session_id, evidence_path,
      evidence_mime, evidence_hash, status, verdict, transaction_hash,
      verification_source, consensus_status, processing_attempts,
      processing_lease_until, created_at, verified_at,
      assignment:daily_assignments!submissions_assignment_id_fkey(
        quest_id, quest_version_id, assigned_date,
        version:quest_versions!daily_assignments_quest_version_id_fkey(
          id, quest_id, title, description, verification_rules, xp
        )
      ),
      proof:proof_sessions!submissions_proof_session_id_fkey(challenge, nonce)
    `)
    .eq("id", submissionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) databaseError(error, "The submission could not be loaded.");
  if (!data) throw new HttpError("Submission not found.", 404);
  return data;
}

async function finalizeSubmission(
  admin: any,
  values: {
    submissionId: string;
    status: "accepted" | "rejected" | "review";
    verdict: Record<string, unknown>;
    transactionHash: string | null;
    verificationSource: "genlayer_consensus" | "genlayer_leader_fallback" | "local_demo" | "none";
    consensusStatus: string | null;
  },
) {
  const { error } = await admin.rpc("irlquest_finalize_submission_v2", {
    p_submission_id: values.submissionId,
    p_status: values.status,
    p_verdict: values.verdict,
    p_transaction_hash: values.transactionHash,
    p_verification_source: values.verificationSource,
    p_consensus_status: values.consensusStatus,
  });
  if (error) databaseError(error, "The proof result could not be finalized.");
}

async function localVerdict(admin: any, submission: Record<string, any>) {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const title = submission.assignment?.version?.title ?? "quest";
  const verdict = {
    verdict: "PASS",
    questSatisfied: true,
    challengeSatisfied: true,
    evidenceClear: true,
    safe: true,
    reasonCode: "PASS",
    summary: `Local demo verification accepted the capture for “${title}”.`,
    verifier: "local-demo",
  };
  await finalizeSubmission(admin, {
    submissionId: submission.id,
    status: "accepted",
    verdict,
    transactionHash: null,
    verificationSource: "local_demo",
    consensusStatus: null,
  });
}

function reviewVerdict(reasonCode: string, summary: string, verifier = "genlayer-leader") {
  return {
    verdict: "REVIEW",
    questSatisfied: false,
    challengeSatisfied: false,
    evidenceClear: false,
    safe: true,
    reasonCode,
    summary,
    verifier,
  };
}

async function finalizeReview(
  admin: any,
  submissionId: string,
  reasonCode: string,
  summary: string,
  transactionHash: string | null,
  consensusStatus: string | null,
  verifier = "genlayer-leader",
) {
  await finalizeSubmission(admin, {
    submissionId,
    status: "review",
    verdict: reviewVerdict(reasonCode, summary, verifier),
    transactionHash,
    verificationSource: "none",
    consensusStatus,
  });
}

async function persistTransactionHash(
  admin: any,
  submission: Record<string, any>,
  transactionHash: string,
) {
  const { data: persisted, error } = await admin
    .from("submissions")
    .update({
      transaction_hash: transactionHash,
      processing_lease_until: new Date(Date.now() + HASHED_SUBMISSION_LEASE_MS).toISOString(),
    })
    .eq("id", submission.id)
    .eq("user_id", submission.user_id)
    .eq("status", "pending")
    .is("transaction_hash", null)
    .select("transaction_hash")
    .maybeSingle();
  if (error) databaseError(error, "The GenLayer transaction could not be recorded.");
  if (persisted?.transaction_hash) return String(persisted.transaction_hash);

  const { data: current, error: currentError } = await admin
    .from("submissions")
    .select("status, transaction_hash")
    .eq("id", submission.id)
    .eq("user_id", submission.user_id)
    .maybeSingle();
  if (currentError) databaseError(currentError, "The GenLayer transaction could not be recovered.");
  if (!current || current.status !== "pending") return null;
  if (current.transaction_hash) return String(current.transaction_hash);
  throw new Error("The GenLayer transaction hash was not persisted");
}

async function waitForGenLayerReceipt(client: any, transactionHash: string) {
  const startedAt = Date.now();
  const deadline = Date.now() + GENLAYER_RECEIPT_TIMEOUT_MS;
  let lastRetryableError: unknown = null;
  let lastReceipt: unknown = null;
  while (Date.now() < deadline) {
    try {
      const receipt = await client.getTransaction({ hash: transactionHash });
      lastReceipt = receipt;
      const statusName = genLayerStatusName(receipt);
      if (isGenLayerTerminalStatus(statusName)) {
        const timeoutNeedsGrace = isGenLayerTimeoutStatus(statusName)
          && Date.now() - startedAt < GENLAYER_TIMEOUT_GRACE_MS;
        if (!timeoutNeedsGrace) return { receipt, statusName };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Transaction not found|not found for hash|Timed out waiting for transaction/i.test(message)) throw error;
      lastRetryableError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, GENLAYER_RECEIPT_POLL_MS));
  }
  const finalStatusName = genLayerStatusName(lastReceipt);
  if (lastReceipt && isGenLayerTerminalStatus(finalStatusName)) {
    return { receipt: lastReceipt, statusName: finalStatusName };
  }
  throw new ConsensusStillPendingError(
    lastRetryableError instanceof Error
      ? lastRetryableError.message
      : "GenLayer consensus is still pending.",
  );
}

function terminalReview(statusName: string) {
  switch (statusName) {
    case "VALIDATORS_TIMEOUT":
      return {
        reasonCode: "GENLAYER_VALIDATORS_TIMEOUT",
        summary: "Couldn't verify this one.",
      };
    case "LEADER_TIMEOUT":
      return {
        reasonCode: "GENLAYER_LEADER_TIMEOUT",
        summary: "Couldn't verify this one.",
      };
    case "UNDETERMINED":
      return {
        reasonCode: "GENLAYER_UNDETERMINED",
        summary: "Couldn't verify this one.",
      };
    case "CANCELED":
      return {
        reasonCode: "GENLAYER_CANCELED",
        summary: "Couldn't verify this one.",
      };
    default:
      return {
        reasonCode: "GENLAYER_NOT_ACCEPTED",
        summary: "Couldn't verify this one.",
      };
  }
}

async function genLayerVerdict(admin: any, submission: Record<string, any>, privateKey: string) {
  const assignment = submission.assignment;
  const version = assignment.version;
  const proof = submission.proof;
  const [{ abi, createAccount, createClient }, { testnetBradbury }, { fromHex, fromRlp }] = await Promise.all([
    import("npm:genlayer-js@1.1.8"),
    import("npm:genlayer-js@1.1.8/chains"),
    import("npm:viem@2.55.16"),
  ]);
  const account = createAccount(privateKey as `0x${string}`);
  const client = createClient({ chain: testnetBradbury, endpoint: GENLAYER_RPC_URL, account });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== testnetBradbury.id) {
    throw new Error(`GenLayer RPC chain mismatch: expected ${testnetBradbury.id}, received ${rpcChainId}`);
  }
  let transactionHash = typeof submission.transaction_hash === "string"
    ? submission.transaction_hash
    : null;
  if (!transactionHash) {
    const { data: signed, error: signedError } = await admin.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(submission.evidence_path, 1800);
    if (signedError || !signed?.signedUrl) throw new Error("Could not sign the private evidence URL");
    const userIdHash = await sha256Hex(new TextEncoder().encode(submission.user_id));
    const createdTransactionHash = await client.writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "verify_submission",
      leaderOnly: true,
      args: [
        submission.id,
        userIdHash,
        assignment.quest_id,
        assignment.quest_version_id,
        version.title,
        version.description,
        JSON.stringify(version.verification_rules),
        proof.challenge,
        signed.signedUrl,
        submission.evidence_hash,
      ],
    });
    transactionHash = await persistTransactionHash(admin, submission, createdTransactionHash);
    if (!transactionHash) return;
  }

  const { receipt, statusName } = await waitForGenLayerReceipt(client, transactionHash);
  if (statusName !== "ACCEPTED" && statusName !== "FINALIZED") {
    const completedLeaderVerdict = leaderOnlyTimeoutVerdict(receipt, {
      fromRlp: (value) => fromRlp(value as `0x${string}`),
      fromHex: (value) => fromHex(value as `0x${string}`, "bytes"),
      decodeCalldata: (value) => abi.calldata.decode(value),
    });
    if (completedLeaderVerdict) {
      await finalizeSubmission(admin, {
        submissionId: submission.id,
        status: completedLeaderVerdict.verdict === "PASS" ? "accepted" : "rejected",
        verdict: completedLeaderVerdict,
        transactionHash,
        verificationSource: "genlayer_leader_fallback",
        consensusStatus: statusName,
      });
      return;
    }
    const outcome = terminalReview(statusName);
    await finalizeReview(
      admin,
      submission.id,
      outcome.reasonCode,
      outcome.summary,
      transactionHash,
      statusName,
      "genlayer-leader",
    );
    return;
  }
  if (String(receipt.txExecutionResultName || "").includes("ERROR")) {
    await finalizeReview(
      admin,
      submission.id,
      "GENLAYER_EXECUTION_ERROR",
      "Couldn't verify this one.",
      transactionHash,
      statusName,
      "genlayer-leader",
    );
    return;
  }
  let result: any;
  try {
    result = await waitForGenLayerResult(client, CONTRACT_ADDRESS, submission.id, {
      timeoutMs: GENLAYER_RESULT_READ_TIMEOUT_MS,
      pollMs: GENLAYER_RESULT_READ_POLL_MS,
    });
  } catch (error) {
    if (error instanceof GenLayerResultPendingError) {
      throw new ConsensusStillPendingError(error.message);
    }
    throw error;
  }
  const verdict = {
    verdict: result.verdict,
    questSatisfied: Boolean(result.quest_satisfied),
    challengeSatisfied: Boolean(result.challenge_satisfied),
    evidenceClear: Boolean(result.evidence_clear),
    safe: Boolean(result.safe),
    reasonCode: result.reason_code,
    summary: result.summary,
    verifier: "genlayer-consensus",
  };
  await finalizeSubmission(admin, {
    submissionId: submission.id,
    status: verdict.verdict === "PASS" ? "accepted" : "rejected",
    verdict,
    transactionHash,
    verificationSource: "genlayer_consensus",
    consensusStatus: statusName,
  });
}

async function claimSubmission(admin: any, submissionId: string, userId: string) {
  const { data, error } = await admin.rpc("irlquest_claim_submission", {
    p_submission_id: submissionId,
    p_user_id: userId,
    p_unrelayed_lease_seconds: Math.ceil(UNRELAYED_SUBMISSION_LEASE_MS / 1000),
    p_hashed_lease_seconds: Math.ceil(HASHED_SUBMISSION_LEASE_MS / 1000),
  });
  if (error) databaseError(error, "The proof could not be prepared for verification.");
  return Number(data ?? 0);
}

async function processSubmission(admin: any, submissionId: string, userId: string) {
  if (processingSubmissions.has(submissionId)) return;
  processingSubmissions.add(submissionId);
  let claimAttempt = 0;
  try {
    claimAttempt = await claimSubmission(admin, submissionId, userId);
    if (claimAttempt <= 0) return;
    const submission = await getSubmission(admin, userId, submissionId);
    if (submission.status !== "pending") return;
    const privateKey = Deno.env.get("GENLAYER_RELAYER_PRIVATE_KEY");
    if (privateKey) await genLayerVerdict(admin, submission, privateKey);
    else await localVerdict(admin, submission);
  } catch (error) {
    if (error instanceof ConsensusStillPendingError) {
      console.info(`[verification-pending] ${submissionId}: ${error.message}`);
      return;
    }
    console.error(`[verification] ${submissionId}: ${error instanceof Error ? error.message : String(error)}`);
    const { data: current, error: currentError } = await admin
      .from("submissions")
      .select("transaction_hash, processing_attempts")
      .eq("id", submissionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (currentError) {
      console.info(`[verification-pending] ${submissionId}: the submission state could not be recovered.`);
      return;
    }
    const transactionHash = typeof current?.transaction_hash === "string"
      ? current.transaction_hash
      : null;
    const message = error instanceof Error ? error.message : String(error);
    if (transactionHash && Deno.env.get("GENLAYER_RELAYER_PRIVATE_KEY")) {
      console.info(`[verification-pending] ${submissionId}: post-relay processing will retry: ${message}`);
      return;
    }
    const relayerReverted = /revert/i.test(message);
    const attempts = Number(current?.processing_attempts ?? claimAttempt);
    if (!relayerReverted
      && Deno.env.get("GENLAYER_RELAYER_PRIVATE_KEY")
      && attempts < MAX_UNRELAYED_ATTEMPTS) {
      console.info(`[verification-pending] ${submissionId}: pre-relay processing will retry: ${message}`);
      return;
    }
    try {
      await finalizeReview(
        admin,
        submissionId,
        relayerReverted ? "GENLAYER_RELAY_REVERTED" : "VERIFIER_UNAVAILABLE",
        "Couldn't verify this one.",
        transactionHash,
        null,
        Deno.env.get("GENLAYER_RELAYER_PRIVATE_KEY") ? "genlayer-leader" : "local",
      );
    } catch (finalizeError) {
      console.error(`[verification-finalize] ${finalizeError instanceof Error ? finalizeError.message : String(finalizeError)}`);
    }
  } finally {
    processingSubmissions.delete(submissionId);
  }
}

async function recoverStaleSubmissions(admin: any, userId: string) {
  const { data, error } = await admin
    .from("submissions")
    .select("id, processing_lease_until")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) {
    console.error(`[verification-recovery] ${error.message}`);
    return;
  }

  const now = Date.now();
  const stale = (data ?? []).filter((submission: Record<string, unknown>) => {
    if (typeof submission.processing_lease_until !== "string") return true;
    return new Date(submission.processing_lease_until).getTime() <= now;
  });
  await Promise.all(stale.map((submission: Record<string, unknown>) => (
    processSubmission(admin, String(submission.id), userId)
  )));
}

async function submitProof(admin: any, userId: string, body: Record<string, unknown>) {
  if (typeof body.proofSessionId !== "string") throw new HttpError(ERROR_MESSAGES.PROOF_SESSION_NOT_FOUND);
  await enforceRateLimit(admin, userId, "submission", SUBMISSION_LIMIT_PER_DAY, 86400);
  const image = decodeImageDataUrl(body.imageDataUrl);
  const evidenceHash = await sha256Hex(image.bytes);
  const submissionId = crypto.randomUUID();
  const evidencePath = `${userId}/${submissionId}.${image.extension}`;
  const { error: uploadError } = await admin.storage.from(EVIDENCE_BUCKET).upload(
    evidencePath,
    image.bytes,
    { contentType: image.mime, cacheControl: "0", upsert: false },
  );
  if (uploadError) {
    console.error(`[storage] ${uploadError.message}`);
    throw new HttpError("The private evidence upload failed.", 500);
  }

  const { error: submissionError } = await admin.rpc("irlquest_create_submission", {
    p_submission_id: submissionId,
    p_user_id: userId,
    p_proof_session_id: body.proofSessionId,
    p_evidence_path: evidencePath,
    p_evidence_mime: image.mime,
    p_evidence_hash: evidenceHash,
  });
  if (submissionError) {
    await admin.storage.from(EVIDENCE_BUCKET).remove([evidencePath]);
    databaseError(submissionError, "The proof could not be submitted.");
  }

  const submission = await getSubmission(admin, userId, submissionId);
  EdgeRuntime.waitUntil(processSubmission(admin, submissionId, userId));
  return publicSubmission(submission);
}

const authenticated = withSupabase({ auth: "user" }, async (request, context) => {
  try {
    if (request.method !== "POST") throw new HttpError("Use POST for this endpoint.", 405);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const { data: userResult, error: userError } = await context.supabase.auth.getUser();
    if (userError || !userResult.user) throw new HttpError("Sign in to continue.", 401);
    const user = userResult.user;
    switch (body.action) {
      case "bootstrap":
        return json(await bootstrap(context.supabaseAdmin, user, body.date, body.timeZone));
      case "create-proof-session":
        return json(await createProofSession(context.supabaseAdmin, user.id, body.assignmentId), 201);
      case "submit-proof":
        return json(await submitProof(context.supabaseAdmin, user.id, body), 202);
      case "get-submission": {
        if (typeof body.submissionId !== "string") throw new HttpError("Submission not found.", 404);
        const submission = await getSubmission(context.supabaseAdmin, user.id, body.submissionId);
        const leaseExpired = typeof submission.processing_lease_until !== "string"
          || new Date(submission.processing_lease_until).getTime() <= Date.now();
        if (submission.status === "pending" && leaseExpired) {
          EdgeRuntime.waitUntil(processSubmission(context.supabaseAdmin, submission.id, user.id));
        }
        return json(publicSubmission(submission));
      }
      case "list-results":
        return json(await listResults(context.supabaseAdmin, user.id, body.page, body.pageSize, body.status));
      default:
        throw new HttpError("Unknown IRLQuest action.", 404);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: "Something went wrong in base camp." }, 500);
  }
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const response = await authenticated(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
