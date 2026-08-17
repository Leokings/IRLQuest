const GENLAYER_STATUS_BY_CODE: Record<string, string> = {
  "0": "UNINITIALIZED",
  "1": "PENDING",
  "2": "PROPOSING",
  "3": "COMMITTING",
  "4": "REVEALING",
  "5": "ACCEPTED",
  "6": "UNDETERMINED",
  "7": "FINALIZED",
  "8": "CANCELED",
  "9": "APPEAL_REVEALING",
  "10": "APPEAL_COMMITTING",
  "11": "READY_TO_FINALIZE",
  "12": "VALIDATORS_TIMEOUT",
  "13": "LEADER_TIMEOUT",
};

const TERMINAL_STATUSES = new Set([
  "ACCEPTED",
  "UNDETERMINED",
  "FINALIZED",
  "CANCELED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

const TIMEOUT_STATUSES = new Set(["VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"]);
const CONSENSUS_STATUSES = new Set(["ACCEPTED", "FINALIZED"]);

type GenLayerResultClient = {
  readContract(args: Record<string, unknown>): Promise<unknown>;
};

type GenLayerResultWaitOptions = {
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class GenLayerResultPendingError extends Error {}

export async function waitForGenLayerResult(
  client: GenLayerResultClient,
  contractAddress: string,
  submissionId: string,
  options: GenLayerResultWaitOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 2_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;
  let lastError: unknown = null;

  while (true) {
    try {
      const hasResult = await client.readContract({
        address: contractAddress,
        functionName: "has_result",
        args: [submissionId],
        transactionHashVariant: "latest-nonfinal",
      });
      if (hasResult === true || hasResult === 1 || hasResult === "true") {
        return await client.readContract({
          address: contractAddress,
          functionName: "get_result",
          args: [submissionId],
          transactionHashVariant: "latest-nonfinal",
        });
      }
      lastError = new Error("GenLayer accepted the proof, but its result is not visible yet.");
    } catch (error) {
      // An accepted transaction can become visible through getTransaction before
      // gen_call sees its state. All read/RPC errors are therefore retryable here.
      lastError = error;
    }

    if (now() >= deadline) break;
    await sleep(pollMs);
  }

  throw new GenLayerResultPendingError(
    lastError instanceof Error
      ? lastError.message
      : "GenLayer accepted the proof, but its result is not readable yet.",
  );
}

function statusValue(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return GENLAYER_STATUS_BY_CODE[String(value)] || "UNKNOWN";
  }
  if (typeof value !== "string" || !value.trim()) return "UNKNOWN";
  const normalized = value.trim().toUpperCase();
  return /^\d+$/.test(normalized)
    ? GENLAYER_STATUS_BY_CODE[String(Number(normalized))] || "UNKNOWN"
    : normalized;
}

export function genLayerStatusName(receipt: unknown) {
  if (!receipt || typeof receipt !== "object") return "UNKNOWN";
  const record = receipt as Record<string, unknown>;
  const named = statusValue(record.statusName ?? record.status_name);
  if (named !== "UNKNOWN") return named;
  return statusValue(record.statusCode ?? record.status_code ?? record.status);
}

export function isGenLayerTerminalStatus(statusName: string) {
  return TERMINAL_STATUSES.has(statusName);
}

export function isGenLayerTimeoutStatus(statusName: string) {
  return TIMEOUT_STATUSES.has(statusName);
}

export function isXpEligibleConsensusReceipt(receipt: unknown) {
  if (!receipt || typeof receipt !== "object") return false;
  const transaction = receipt as Record<string, unknown>;
  if (!CONSENSUS_STATUSES.has(genLayerStatusName(receipt))) return false;

  const txData = transaction.txDataDecoded ?? transaction.tx_data_decoded;
  const txDataRecord = txData && typeof txData === "object"
    ? txData as Record<string, unknown>
    : null;
  const leaderOnly = txDataRecord?.leaderOnly
    ?? txDataRecord?.leader_only
    ?? transaction.leaderOnly
    ?? transaction.leader_only;
  if (leaderOnly !== false) return false;

  const executionName = String(
    transaction.txExecutionResultName ?? transaction.tx_execution_result_name ?? "",
  ).toUpperCase();
  const executionCode = transaction.txExecutionResult ?? transaction.tx_execution_result;
  const hasTopLevelExecution = Boolean(executionName) || executionCode !== undefined;
  if (hasTopLevelExecution) {
    if (executionName !== "FINISHED_WITH_RETURN" && executionCode !== 1 && executionCode !== "1") {
      return false;
    }
  } else {
    const consensusData = transaction.consensusData ?? transaction.consensus_data;
    if (!consensusData || typeof consensusData !== "object") return false;
    const leaderReceipts = (consensusData as Record<string, unknown>).leaderReceipt
      ?? (consensusData as Record<string, unknown>).leader_receipt;
    if (!Array.isArray(leaderReceipts)) return false;
    const leaderReceipt = leaderReceipts.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      return String((candidate as Record<string, unknown>).mode ?? "").toLowerCase() === "leader";
    });
    if (!leaderReceipt || typeof leaderReceipt !== "object") return false;
    const leaderRecord = leaderReceipt as Record<string, unknown>;
    const executionResult = String(
      leaderRecord.executionResult ?? leaderRecord.execution_result ?? "",
    ).toUpperCase();
    const leaderResult = leaderRecord.result;
    const resultStatus = leaderResult && typeof leaderResult === "object"
      ? String((leaderResult as Record<string, unknown>).status ?? "").toUpperCase()
      : "";
    if (executionResult !== "SUCCESS" || resultStatus !== "RETURN") return false;
  }

  const resultName = String(transaction.resultName ?? transaction.result_name ?? "").toUpperCase();
  if (resultName !== "AGREE" && resultName !== "MAJORITY_AGREE") return false;

  const lastRound = transaction.lastRound ?? transaction.last_round;
  if (!lastRound || typeof lastRound !== "object") return false;
  const voteNames = (lastRound as Record<string, unknown>).validatorVotesName
    ?? (lastRound as Record<string, unknown>).validator_votes_name;
  if (!Array.isArray(voteNames) || voteNames.length < 3) return false;
  const agreeVotes = voteNames.filter((vote) => String(vote).toUpperCase() === "AGREE").length;
  return agreeVotes > voteNames.length / 2;
}
