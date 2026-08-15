import { createHash } from "node:crypto";
import { createSignedEvidenceUrl } from "./evidence.mjs";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  const [{ createAccount, createClient }, { TransactionStatus }] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/types"),
  ]);
  const account = createAccount(privateKey);
  const client = createClient({ endpoint: rpcUrl, account });
  const userIdHash = createHash("sha256").update(submission.userId).digest("hex");
  const evidenceUrl = createSignedEvidenceUrl({
    publicBaseUrl,
    secret: evidenceSecret,
    submissionId: submission.id,
  });

  const transactionHash = await client.writeContract({
    address: contractAddress,
    functionName: "verify_submission",
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
  const receipt = await client.waitForTransactionReceipt({
    hash: transactionHash,
    status: TransactionStatus.ACCEPTED,
    fullTransaction: false,
  });
  if (String(receipt.txExecutionResultName || "").includes("ERROR")) {
    throw new Error("The GenLayer verification transaction finished with an execution error");
  }
  const result = await client.readContract({
    address: contractAddress,
    functionName: "get_result",
    args: [submission.id],
    stateStatus: "accepted",
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
