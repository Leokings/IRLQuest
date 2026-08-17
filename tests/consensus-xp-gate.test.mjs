import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isXpEligibleConsensusReceipt } from "../supabase/functions/irlquest-api/genlayer-receipt.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));

function consensusReceipt(overrides = {}) {
  return {
    statusName: "FINALIZED",
    txDataDecoded: { leaderOnly: false },
    txExecutionResult: 1,
    txExecutionResultName: "FINISHED_WITH_RETURN",
    resultName: "AGREE",
    lastRound: {
      validatorVotesName: ["AGREE", "AGREE", "DISAGREE"],
    },
    ...overrides,
  };
}

test("validator timeout cannot award XP", () => {
  const receipt = consensusReceipt({ statusName: "VALIDATORS_TIMEOUT" });
  assert.equal(isXpEligibleConsensusReceipt(receipt), false);
});

test("validator disagreement cannot award XP", () => {
  const receipt = consensusReceipt({
    resultName: "DISAGREE",
    lastRound: {
      validatorVotesName: ["AGREE", "DISAGREE", "DISAGREE"],
    },
  });
  assert.equal(isXpEligibleConsensusReceipt(receipt), false);
});

test("leader-only execution cannot award XP even after finalization", () => {
  const receipt = consensusReceipt({ txDataDecoded: { leaderOnly: true } });
  assert.equal(isXpEligibleConsensusReceipt(receipt), false);
});

test("the Edge Function and Postgres both enforce the consensus XP gate", async () => {
  const [edgeFunction, migration] = await Promise.all([
    readFile(
      join(testDirectory, "..", "supabase", "functions", "irlquest-api", "index.ts"),
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

  assert.match(edgeFunction, /leaderOnly: false/);
  assert.match(edgeFunction, /if \(!isXpEligibleConsensusReceipt\(receipt\)\)/);
  assert.doesNotMatch(edgeFunction, /genlayer_leader_fallback/);
  assert.match(migration, /VALIDATOR_CONSENSUS_REQUIRED_FOR_XP/);
  assert.match(migration, /delete from public\.xp_events/);
  assert.match(migration, /s\.status = 'accepted'/);
  assert.match(migration, /s\.verification_source is distinct from 'genlayer_consensus'/);
});
