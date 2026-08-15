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

const DECISION_KEYS = new Set([
  "challenge_satisfied",
  "evidence_clear",
  "quest_satisfied",
  "reason_code",
  "safe",
  "verdict",
]);

const DECISION_SUMMARIES: Record<string, string> = {
  PASS: "Proof accepted.",
  QUEST_NOT_MET: "The quest item wasn't clearly shown.",
  CHALLENGE_NOT_MET: "The live gesture wasn't visible.",
  UNCLEAR: "Couldn't verify this one.",
  UNSAFE: "This photo couldn't be accepted.",
};

type LeaderOutputDecoder = {
  fromRlp(value: string): unknown;
  fromHex(value: string): Uint8Array;
  decodeCalldata(value: Uint8Array): unknown;
};

export type GenLayerLeaderVerdict = {
  verdict: "PASS" | "FAIL";
  questSatisfied: boolean;
  challengeSatisfied: boolean;
  evidenceClear: boolean;
  safe: boolean;
  reasonCode: string;
  summary: string;
  verifier: "genlayer-leader";
};

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

function recordFromCalldata(value: unknown) {
  if (value instanceof Map) {
    return Object.fromEntries(value) as Record<string, unknown>;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function canonicalReason(decision: Record<string, unknown>) {
  if (decision.safe === false) return "UNSAFE";
  if (decision.evidence_clear === false) return "UNCLEAR";
  if (decision.quest_satisfied === false) return "QUEST_NOT_MET";
  if (decision.challenge_satisfied === false) return "CHALLENGE_NOT_MET";
  return "PASS";
}

export function leaderOnlyTimeoutVerdict(
  receipt: unknown,
  decoder: LeaderOutputDecoder,
): GenLayerLeaderVerdict | null {
  if (!receipt || typeof receipt !== "object") return null;
  const transaction = receipt as Record<string, unknown>;
  if (!isGenLayerTimeoutStatus(genLayerStatusName(receipt))) return null;

  const txData = transaction.txDataDecoded ?? transaction.tx_data_decoded;
  if (!txData || typeof txData !== "object") return null;
  if ((txData as Record<string, unknown>).leaderOnly !== true) return null;

  const executionName = String(
    transaction.txExecutionResultName ?? transaction.tx_execution_result_name ?? "",
  ).toUpperCase();
  const executionCode = transaction.txExecutionResult ?? transaction.tx_execution_result;
  if (executionName !== "FINISHED_WITH_RETURN" && executionCode !== 1 && executionCode !== "1") {
    return null;
  }

  const encoded = transaction.eqBlocksOutputs ?? transaction.eq_blocks_outputs;
  if (typeof encoded !== "string" || !/^0x[0-9a-f]+$/i.test(encoded)) return null;

  try {
    const envelope = decoder.fromRlp(encoded);
    if (!Array.isArray(envelope) || typeof envelope[0] !== "string") return null;
    const resultBytes = decoder.fromHex(envelope[0]);
    if (!(resultBytes instanceof Uint8Array) || resultBytes.length < 2 || resultBytes[0] !== 0) {
      return null;
    }

    const decision = recordFromCalldata(decoder.decodeCalldata(resultBytes.slice(1)));
    if (!decision) return null;
    const keys = Object.keys(decision);
    if (keys.length !== DECISION_KEYS.size || keys.some((key) => !DECISION_KEYS.has(key))) {
      return null;
    }
    for (const key of ["quest_satisfied", "challenge_satisfied", "evidence_clear", "safe"]) {
      if (typeof decision[key] !== "boolean") return null;
    }

    const reasonCode = canonicalReason(decision);
    if (decision.reason_code !== reasonCode) return null;
    const verdict = reasonCode === "PASS" ? "PASS" : "FAIL";
    if (decision.verdict !== verdict) return null;

    return {
      verdict,
      questSatisfied: decision.quest_satisfied as boolean,
      challengeSatisfied: decision.challenge_satisfied as boolean,
      evidenceClear: decision.evidence_clear as boolean,
      safe: decision.safe as boolean,
      reasonCode,
      summary: DECISION_SUMMARIES[reasonCode],
      verifier: "genlayer-leader",
    };
  } catch {
    return null;
  }
}
