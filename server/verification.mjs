import { createHash } from "node:crypto";
import { createSignedEvidenceUrl } from "./evidence.mjs";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isXpEligibleConsensusReceipt(receipt) {
  const status = String(receipt?.statusName || receipt?.status_name || "").toUpperCase();
  if (status !== "ACCEPTED" && status !== "FINALIZED") return false;
  const txData = receipt?.txDataDecoded || receipt?.tx_data_decoded;
  const leaderOnly = txData?.leaderOnly
    ?? txData?.leader_only
    ?? receipt?.leaderOnly
    ?? receipt?.leader_only;
  if (leaderOnly !== false) return false;

  const topLevelExecution = receipt?.txExecutionResultName || receipt?.tx_execution_result_name;
  const topLevelExecutionCode = receipt?.txExecutionResult ?? receipt?.tx_execution_result;
  if (topLevelExecution || topLevelExecutionCode !== undefined) {
    if (topLevelExecution !== "FINISHED_WITH_RETURN"
      && topLevelExecutionCode !== 1
      && topLevelExecutionCode !== "1") return false;
  } else {
    const leaderReceipts = receipt?.consensusData?.leaderReceipt
      || receipt?.consensus_data?.leader_receipt;
    const leaderReceipt = Array.isArray(leaderReceipts)
      ? leaderReceipts.find((candidate) => candidate?.mode === "leader")
      : null;
    if (leaderReceipt?.execution_result !== "SUCCESS"
      || leaderReceipt?.result?.status !== "return") return false;
  }

  const resultName = String(receipt?.resultName || receipt?.result_name || "").toUpperCase();
  if (resultName !== "AGREE" && resultName !== "MAJORITY_AGREE") return false;
  const votes = receipt?.lastRound?.validatorVotesName
    || receipt?.last_round?.validator_votes_name;
  if (!Array.isArray(votes) || votes.length < 3) return false;
  return votes.filter((vote) => String(vote).toUpperCase() === "AGREE").length > votes.length / 2;
}

function localVerdict(submission) {
  return {
    verdict: "PASS",
    questSatisfied: true,
    challengeSatisfied: true,
    evidenceClear: true,
    safe: true,
    reasonCode: "PASS",
    summary: `Local demo verification accepted the capture for “${submission.questTitle}”.`,
    verifier: "local-demo",
  };
}

async function runGenLayerVerification({
  submission,
  publicBaseUrl,
  evidenceSecret,
  genLayerConfig,
}) {
  const rpcUrl = genLayerConfig?.rpcUrl;
  const contractAddress = genLayerConfig?.contractAddress;
  const privateKey = genLayerConfig?.privateKey;
  if (!rpcUrl || !contractAddress || !privateKey) {
    throw new Error("GenLayer mode requires GENLAYER_RPC_URL, GENLAYER_CONTRACT_ADDRESS, and GENLAYER_RELAYER_PRIVATE_KEY");
  }
  if (!publicBaseUrl.startsWith("https://")) {
    throw new Error("GenLayer mode requires an HTTPS IRLQUEST_PUBLIC_BASE_URL that validators can reach");
  }

  const [{ createAccount, createClient }, { studionet }, { TransactionStatus }] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/chains"),
    import("genlayer-js/types"),
  ]);
  const account = createAccount(privateKey);
  const client = createClient({ chain: studionet, endpoint: rpcUrl, account });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== studionet.id) {
    throw new Error(`GenLayer RPC chain mismatch: expected ${studionet.id}, received ${rpcChainId}`);
  }
  const userIdHash = createHash("sha256").update(submission.userId).digest("hex");
  const evidenceUrl = createSignedEvidenceUrl({
    publicBaseUrl,
    secret: evidenceSecret,
    submissionId: submission.id,
  });

  const transactionHash = await client.writeContract({
    address: contractAddress,
    functionName: "verify_submission",
    leaderOnly: false,
    args: [
      submission.id,
      userIdHash,
      submission.questId,
      submission.questVersionId,
      submission.questTitle,
      submission.questPrompt,
      submission.verificationRules,
      submission.challenge,
      evidenceUrl,
      submission.evidenceHash,
    ],
  });
  await client.waitForTransactionReceipt({
    hash: transactionHash,
    status: TransactionStatus.ACCEPTED,
    fullTransaction: false,
  });
  const receipt = await client.getTransaction({ hash: transactionHash });
  if (!isXpEligibleConsensusReceipt(receipt)) {
    throw new Error("The GenLayer verification transaction did not reach validator consensus");
  }
  const result = await client.readContract({
    address: contractAddress,
    functionName: "get_result",
    args: [submission.id],
    transactionHashVariant: "latest-nonfinal",
  });
  return {
    transactionHash,
    verdict: {
      verdict: result.verdict,
      questSatisfied: Boolean(result.quest_satisfied),
      challengeSatisfied: Boolean(result.challenge_satisfied),
      evidenceClear: Boolean(result.evidence_clear),
      safe: Boolean(result.safe),
      reasonCode: result.reason_code,
      summary: result.summary,
      verifier: "genlayer-consensus",
    },
  };
}

export function createVerificationService({
  database,
  mode = "local",
  delayMs = 1400,
  publicBaseUrl,
  evidenceSecret,
  genLayerConfig,
  logger = console,
} = {}) {
  const running = new Set();

  async function processSubmission(submissionId) {
    if (running.has(submissionId)) return;
    running.add(submissionId);
    try {
      const submission = database.getSubmission(submissionId);
      if (!submission || submission.status !== "pending") return;
      let verdict;
      let transactionHash = null;
      if (mode === "genlayer") {
        const result = await runGenLayerVerification({
          submission,
          publicBaseUrl,
          evidenceSecret,
          genLayerConfig,
        });
        verdict = result.verdict;
        transactionHash = result.transactionHash;
      } else {
        await wait(Number(delayMs));
        verdict = localVerdict(submission);
      }
      database.finalizeSubmission({
        submissionId,
        status: verdict.verdict === "PASS" ? "accepted" : "rejected",
        verdict,
        transactionHash,
      });
    } catch (error) {
      logger.error?.(`[verification] ${submissionId}: ${error.message}`);
      database.finalizeSubmission({
        submissionId,
        status: "review",
        verdict: {
          verdict: "REVIEW",
          questSatisfied: false,
          challengeSatisfied: false,
          evidenceClear: false,
          safe: true,
          reasonCode: "VERIFIER_UNAVAILABLE",
          summary: "Verification could not finish. No XP was awarded; the quest can be retried.",
          verifier: mode,
        },
      });
    } finally {
      running.delete(submissionId);
    }
  }

  return {
    mode,
    schedule(submissionId) {
      setTimeout(() => void processSubmission(submissionId), 0);
    },
    processSubmission,
    recoverPending() {
      for (const submissionId of database.listPendingSubmissions()) this.schedule(submissionId);
    },
  };
}
