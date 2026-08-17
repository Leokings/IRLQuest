import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  GenLayerResultPendingError,
  genLayerStatusName,
  isGenLayerTerminalStatus,
  isGenLayerTimeoutStatus,
  isXpEligibleConsensusReceipt,
  waitForGenLayerResult,
} from "../supabase/functions/irlquest-api/genlayer-receipt.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));

test("Bradbury verification uses Bradbury's chain configuration", async () => {
  const endpoint = "https://rpc-bradbury.genlayer.com";
  const client = createClient({ chain: testnetBradbury, endpoint });

  assert.equal(client.chain.id, 4221);
  assert.equal(client.chain.isStudio, false);
  assert.equal(client.chain.consensusMainContract.address, "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D");

  const edgeFunction = await readFile(
    join(testDirectory, "..", "supabase", "functions", "irlquest-api", "index.ts"),
    "utf8",
  );
  assert.match(edgeFunction, /import\("npm:genlayer-js@1\.1\.8\/chains"\)/);
  assert.match(edgeFunction, /createClient\(\{ chain: testnetBradbury, endpoint: GENLAYER_RPC_URL, account \}\)/);
});

test("verification persists one relay hash and classifies terminal consensus outcomes", async () => {
  const edgeFunction = await readFile(
    join(testDirectory, "..", "supabase", "functions", "irlquest-api", "index.ts"),
    "utf8",
  );

  const persistPosition = edgeFunction.indexOf("persistTransactionHash(admin, submission, createdTransactionHash)");
  const waitPosition = edgeFunction.indexOf("waitForGenLayerReceipt(client, transactionHash");
  assert.ok(persistPosition > 0, "the relay hash must be stored immediately");
  assert.ok(waitPosition > persistPosition, "the relay hash must be stored before consensus polling");
  assert.match(edgeFunction, /leaderOnly: false/);
  assert.match(edgeFunction, /client\.getTransaction\(\{ hash: transactionHash \}\)/);
  assert.match(edgeFunction, /GENLAYER_TIMEOUT_GRACE_MS = 55_000/);
  assert.match(edgeFunction, /isXpEligibleConsensusReceipt\(receipt\)/);
  assert.doesNotMatch(edgeFunction, /leaderOnlyTimeoutVerdict/);
  assert.doesNotMatch(edgeFunction, /genlayer_leader_fallback/);
  assert.match(edgeFunction, /GENLAYER_VALIDATORS_TIMEOUT/);
  assert.match(edgeFunction, /GENLAYER_UNDETERMINED/);
  assert.match(edgeFunction, /processingSubmissions\.has\(submissionId\)/);
  assert.match(edgeFunction, /HASHED_SUBMISSION_LEASE_MS = 145_000/);
  assert.match(edgeFunction, /UNRELAYED_SUBMISSION_LEASE_MS = 60_000/);
  assert.match(edgeFunction, /MAX_UNRELAYED_ATTEMPTS = 3/);
  assert.match(edgeFunction, /irlquest_claim_submission/);
  const claimPosition = edgeFunction.indexOf("claimAttempt = await claimSubmission");
  const claimedLoadPosition = edgeFunction.indexOf("const submission = await getSubmission", claimPosition);
  assert.ok(claimPosition > 0, "a worker must acquire the database lease");
  assert.ok(claimedLoadPosition > claimPosition, "the lease must be acquired before verification starts");
  assert.match(edgeFunction, /GENLAYER_RESULT_READ_TIMEOUT_MS = 30_000/);
  assert.match(edgeFunction, /waitForGenLayerResult\(client, CONTRACT_ADDRESS, submission\.id/);
  assert.doesNotMatch(edgeFunction, /stateStatus: "accepted"/);
  const resultReadPosition = edgeFunction.indexOf("waitForGenLayerResult(client, CONTRACT_ADDRESS, submission.id");
  const pendingPosition = edgeFunction.indexOf("error instanceof GenLayerResultPendingError", resultReadPosition);
  const pendingCatchPosition = edgeFunction.indexOf("error instanceof ConsensusStillPendingError", resultReadPosition);
  const postRelayPosition = edgeFunction.indexOf('transactionHash && Deno.env.get("GENLAYER_RELAYER_PRIVATE_KEY")');
  const unavailablePosition = edgeFunction.indexOf('"VERIFIER_UNAVAILABLE"', postRelayPosition);
  assert.ok(pendingPosition > resultReadPosition, "temporarily unreadable accepted state must remain pending");
  assert.ok(pendingCatchPosition > resultReadPosition, "a delayed result must not be finalized as unavailable");
  assert.ok(postRelayPosition > pendingCatchPosition, "unexpected post-relay errors must be recovered from the database");
  assert.ok(unavailablePosition > postRelayPosition, "post-relay errors must return before unavailable review finalization");
});

test("submission finalization records its source and remains XP-idempotent", async () => {
  const [migration, consensusMigration] = await Promise.all([
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814143009_verification_reliability_and_simple_quests.sql",
      ),
      "utf8",
    ),
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260817122818_require_validator_consensus_for_xp.sql",
      ),
      "utf8",
    ),
  ]);
  const edgeFunction = await readFile(
    join(testDirectory, "..", "supabase", "functions", "irlquest-api", "index.ts"),
    "utf8",
  );

  assert.match(migration, /add column if not exists verification_source text/);
  assert.match(migration, /add column if not exists consensus_status text/);
  assert.match(migration, /add column if not exists processing_lease_until timestamptz/);
  assert.match(migration, /create or replace function public\.irlquest_claim_submission/);
  assert.match(migration, /for update of s, da/);
  assert.match(migration, /on conflict \(submission_id\) do nothing/);
  assert.match(edgeFunction, /verificationSource: "genlayer_consensus"/);
  assert.doesNotMatch(edgeFunction, /verificationSource: "genlayer_leader_fallback"/);
  assert.match(edgeFunction, /verifier: "genlayer-consensus"/);
  assert.match(edgeFunction, /recoverStaleSubmissions\(admin, user\.id\)/);
  assert.match(consensusMigration, /VALIDATOR_CONSENSUS_REQUIRED_FOR_XP/);
  assert.match(consensusMigration, /p_verification_source is distinct from 'genlayer_consensus'/);
  assert.match(consensusMigration, /coalesce\(p_consensus_status, ''\) not in \('ACCEPTED', 'FINALIZED'\)/);
  assert.match(consensusMigration, /delete from public\.xp_events/);
});

test("active hosted quests keep simple tasks and proven quest variety", async () => {
  const [migration, restoreMigration, shadowPauseMigration, correctionMigration, localDatabase] = await Promise.all([
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814143009_verification_reliability_and_simple_quests.sql",
      ),
      "utf8",
    ),
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814151405_restore_verified_quests.sql",
      ),
      "utf8",
    ),
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814163645_pause_unverified_shadow_snap.sql",
      ),
      "utf8",
    ),
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814164818_correct_legacy_verdicts_and_closeup_state.sql",
      ),
      "utf8",
    ),
    readFile(join(testDirectory, "..", "server", "database.mjs"), "utf8"),
  ]);
  const simpleQuestIds = [
    "quest_cup_find",
    "quest_pen_find",
    "quest_book_find",
    "quest_bottle_find",
    "quest_spoon_find",
  ];

  for (const questId of simpleQuestIds) {
    assert.match(migration, new RegExp(`'${questId}'`));
    assert.match(localDatabase, new RegExp(`id: "${questId}"`));
  }
  for (const restoredQuestId of [
    "quest_golden_hour",
    "quest_found_face",
    "quest_tiny_wonder",
  ]) {
    assert.match(restoreMigration, new RegExp(`'${restoredQuestId}'`));
    assert.match(localDatabase, new RegExp(`id: "${restoredQuestId}"`));
  }
  assert.match(shadowPauseMigration, /where id = 'quest_shadow_story'/);
  assert.match(shadowPauseMigration, /state = 'paused'/);
  assert.doesNotMatch(localDatabase, /id: "quest_shadow_story"/);
  assert.match(correctionMigration, /where id = 'quest_tiny_wonder'/);
  assert.match(correctionMigration, /state = 'testing'/);
  assert.match(migration, /'quest_balance_act'/);
  assert.doesNotMatch(localDatabase, /id: "quest_balance_act"/);
  assert.match(migration, /limit greatest\(0, 3 - v_daily_count\)/);
});

test("the legacy correction stays scoped while the consensus migration revokes unproven XP", async () => {
  const migration = await readFile(
    join(
      testDirectory,
      "..",
      "supabase",
      "migrations",
      "20260814164818_correct_legacy_verdicts_and_closeup_state.sql",
    ),
    "utf8",
  );

  for (const transactionHash of [
    "0xbc6329571cf8d6e47c8d85b0b1b29d8cabf84d856718742bada239ac60874d2d",
    "0xe36393b5d3c60ccf6404e34e0569d52f9e4a3081003c5c4f2c1b2a5a95875efb",
    "0xaccc872185949ac6b85f15a76efbb0069cae5db2ff4d4e4461d3f3040b1e295a",
    "0x7e4f1c60f233d80f0a8c95382229985ca94908c80e2c3fe0b7d2f53dc557dcba",
    "0xfdf213d9aa373d2dab15e6dd37c31375a2b2187321ca2b1635423db56e25750c",
    "0x8d7f4c7a6322bc480cf000e0c8652f29f1e689d84e9d78cf213b424870bfa89e",
  ]) {
    assert.match(migration, new RegExp(transactionHash));
  }
  for (const previouslyPreservedHash of [
    "0x9ced920e563508de67f1d78786be717cad283ccd2328a19b60e14fb4223a0885",
    "0x6d52c32f9ec0177a64e34adca09ca63e6ff909612e2496d6fd5b3062885b8cb2",
    "0x1b3ca93c340aa4066b7308ad7e2e8b8e4fb5b0156fe75d07c79412fdbed04bb5",
  ]) {
    assert.doesNotMatch(migration, new RegExp(previouslyPreservedHash));
  }

  assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.match(migration, /set status = 'review'/);
  assert.match(migration, /verification_source = 'none'/);
  assert.match(migration, /consensus_status = 'NO_ONCHAIN_RESULT'/);
  assert.match(migration, /'summary', 'Couldn''t verify this one\.'/);
  assert.match(migration, /delete from public\.xp_events/);
});

test("quest states, launch safeguards, and social surfaces stay wired together", async () => {
  const [migration, serviceGrantMigration, edgeFunction, app, notifications] = await Promise.all([
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814161016_quest_states_social_launch.sql",
      ),
      "utf8",
    ),
    readFile(
      join(
        testDirectory,
        "..",
        "supabase",
        "migrations",
        "20260814163414_grant_private_ops_to_service_role.sql",
      ),
      "utf8",
    ),
    readFile(
      join(testDirectory, "..", "supabase", "functions", "irlquest-api", "index.ts"),
      "utf8",
    ),
    readFile(join(testDirectory, "..", "src", "App.tsx"), "utf8"),
    readFile(join(testDirectory, "..", "src", "components", "NotificationsPanel.tsx"), "utf8"),
  ]);

  for (const questId of [
    "quest_path_view",
    "quest_open_air_view",
    "quest_red_find",
    "quest_yellow_find",
    "quest_hand_sign",
  ]) {
    assert.match(migration, new RegExp(`'${questId}'`));
  }

  assert.match(migration, /check \(state in \('testing', 'active', 'paused'\)\)/);
  assert.match(migration, /create table if not exists private\.quest_testers/);
  assert.match(migration, /create or replace function public\.irlquest_take_rate_limit/);
  assert.match(migration, /create or replace function public\.irlquest_scan_verification_health/);
  assert.match(migration, /create or replace function public\.irlquest_leaderboard/);
  assert.match(migration, /add column if not exists evidence_deleted_at timestamptz/);
  assert.match(serviceGrantMigration, /grant usage on schema private to service_role/);
  assert.match(serviceGrantMigration, /grant select on private\.quest_testers to service_role/);
  assert.match(serviceGrantMigration, /private\.action_rate_limits to service_role/);
  assert.match(serviceGrantMigration, /private\.maintenance_runs to service_role/);
  assert.match(serviceGrantMigration, /private\.verification_alerts to service_role/);
  assert.match(edgeFunction, /EVIDENCE_RETENTION_DAYS = 30/);
  assert.match(edgeFunction, /PROOF_SESSION_LIMIT_PER_HOUR = 12/);
  assert.match(edgeFunction, /SUBMISSION_LIMIT_PER_DAY = 20/);
  assert.match(edgeFunction, /runMaintenance\(admin\)/);
  assert.match(edgeFunction, /case "list-results"/);
  assert.match(edgeFunction, /\.range\(from, from \+ pageSize - 1\)/);
  assert.match(edgeFunction, /query = query\.eq\("status", status\)/);
  assert.match(edgeFunction, /\.eq\("status", "accepted"\)/);
  assert.match(edgeFunction, /completedDays/);
  assert.match(notifications, /Accepted/);
  assert.match(notifications, /Still checking/);
  assert.match(notifications, /Couldn.t verify/);
  assert.match(notifications, /You earned/);
  assert.match(notifications, /Try this quest again/);
  assert.match(notifications, /Accepted proofs/);
  assert.match(notifications, /loadSubmissionPage\(page, 8, "accepted"\)/);
  assert.match(notifications, /Share/);
  assert.match(notifications, /className="archive-share"/);
  assert.doesNotMatch(notifications, /Browse all results/);
  assert.doesNotMatch(app, /<ProofHistory/);
  assert.match(app, /makeResultCard/);
  assert.match(app, /weeklyGoal\.completedDays/);
  assert.doesNotMatch(app, /index < data\.weeklyGoal\.completed/);
});

test("accepted results wait through RPC lag and use GenLayer's supported state selector", async () => {
  let clock = 0;
  let visibilityChecks = 0;
  const calls = [];
  const expected = { verdict: "PASS", quest_satisfied: true };
  const client = {
    async readContract(args) {
      calls.push(args);
      if (args.functionName === "has_result") {
        visibilityChecks += 1;
        if (visibilityChecks === 1) throw new Error("temporary RPC failure");
        if (visibilityChecks === 2) return false;
        return true;
      }
      return expected;
    },
  };

  const result = await waitForGenLayerResult(client, "0xcontract", "submission-1", {
    timeoutMs: 10,
    pollMs: 1,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
  });

  assert.equal(result, expected);
  assert.equal(visibilityChecks, 3);
  assert.ok(calls.every((call) => call.transactionHashVariant === "latest-nonfinal"));
  assert.ok(calls.some((call) => call.functionName === "has_result"));
  assert.ok(calls.some((call) => call.functionName === "get_result"));
});

test("accepted result read failures remain pending after the retry window", async () => {
  let clock = 0;
  const client = {
    async readContract() {
      throw new Error("generic gen_call failure");
    },
  };

  await assert.rejects(
    waitForGenLayerResult(client, "0xcontract", "submission-2", {
      timeoutMs: 2,
      pollMs: 1,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    }),
    (error) => error instanceof GenLayerResultPendingError
      && error.message === "generic gen_call failure",
  );
});

test("proof UI stays concise and does not claim validator consensus", async () => {
  const [captureSheet, app] = await Promise.all([
    readFile(join(testDirectory, "..", "src", "components", "CaptureSheet.tsx"), "utf8"),
    readFile(join(testDirectory, "..", "src", "App.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(captureSheet, /Independent GenLayer validators|Consensus-backed by GenLayer|No quest verdict was written onchain/);
  assert.doesNotMatch(app, /Consensus-backed proofs|GenLayer consensus active|No paid API key is required/);
  assert.match(captureSheet, /Checking proof/);
  assert.match(captureSheet, /Reviewing your photo\./);
});

test("hosted live challenges stay gesture-only and position-free", async () => {
  const edgeFunction = await readFile(
    join(testDirectory, "..", "supabase", "functions", "irlquest-api", "index.ts"),
    "utf8",
  );
  const challengeBlock = edgeFunction.slice(
    edgeFunction.indexOf("const LIVE_CHALLENGES"),
    edgeFunction.indexOf("const ERROR_MESSAGES"),
  );
  assert.match(challengeBlock, /anywhere in the photo/);
  assert.doesNotMatch(challengeBlock, /corner|angle|edge/);
});

test("numeric and named Bradbury receipt statuses normalize consistently", () => {
  assert.equal(genLayerStatusName({ status: 12 }), "VALIDATORS_TIMEOUT");
  assert.equal(genLayerStatusName({ status: "13" }), "LEADER_TIMEOUT");
  assert.equal(genLayerStatusName({ status_name: "accepted" }), "ACCEPTED");
  assert.equal(genLayerStatusName({ statusName: "FINALIZED", status: 12 }), "FINALIZED");
  assert.equal(genLayerStatusName({}), "UNKNOWN");
  assert.equal(isGenLayerTerminalStatus("VALIDATORS_TIMEOUT"), true);
  assert.equal(isGenLayerTimeoutStatus("VALIDATORS_TIMEOUT"), true);
  assert.equal(isGenLayerTimeoutStatus("ACCEPTED"), false);
});

test("only a majority validator agreement is eligible for XP", () => {
  const consensusReceipt = {
    statusName: "ACCEPTED",
    txDataDecoded: { leaderOnly: false },
    txExecutionResult: 1,
    txExecutionResultName: "FINISHED_WITH_RETURN",
    resultName: "AGREE",
    lastRound: {
      validatorVotesName: ["AGREE", "AGREE", "DISAGREE"],
    },
  };

  assert.equal(isXpEligibleConsensusReceipt(consensusReceipt), true);
  assert.equal(
    isXpEligibleConsensusReceipt({ ...consensusReceipt, statusName: "VALIDATORS_TIMEOUT" }),
    false,
  );
  assert.equal(
    isXpEligibleConsensusReceipt({ ...consensusReceipt, statusName: "UNDETERMINED" }),
    false,
  );
  assert.equal(
    isXpEligibleConsensusReceipt({ ...consensusReceipt, txDataDecoded: { leaderOnly: true } }),
    false,
  );
  assert.equal(
    isXpEligibleConsensusReceipt({
      ...consensusReceipt,
      resultName: "DISAGREE",
      lastRound: { validatorVotesName: ["AGREE", "DISAGREE", "DISAGREE"] },
    }),
    false,
  );
});
