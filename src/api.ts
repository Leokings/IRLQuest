import type { BootstrapData, ProofSession, Submission, SubmissionPage } from "./types";
import { supabase, supabaseFunctionName } from "./supabase";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || "The request failed.", response.status);
  return body as T;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new ApiError("Supabase is not configured.", 500);
  const { data, error } = await supabase.functions.invoke(supabaseFunctionName, { body });
  if (!error) return data as T;

  let message = error.message || "The request failed.";
  let status = 500;
  const context = "context" in error ? error.context : null;
  if (context instanceof Response) {
    status = context.status;
    const responseBody = await context.clone().json().catch(() => ({})) as { error?: string };
    message = responseBody.error || message;
  }
  throw new ApiError(message, status);
}

export function localDay(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function loadBootstrap(): Promise<BootstrapData> {
  const date = localDay();
  const timeZone = browserTimeZone();
  if (supabase) return invoke({ action: "bootstrap", date, timeZone });
  const search = new URLSearchParams({ date, timeZone });
  return request(`/api/bootstrap?${search.toString()}`);
}

const PROFILE_HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export function normalizeProfileHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase().replace(/\s+/g, "_");
}

export async function updateProfileHandle(userId: string, value: string): Promise<string> {
  const handle = normalizeProfileHandle(value);
  if (!PROFILE_HANDLE_PATTERN.test(handle)) {
    throw new ApiError("Use 3–30 lowercase letters, numbers, or underscores.", 400);
  }

  if (!supabase) {
    const result = await request<{ handle: string }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ handle }),
    });
    return result.handle;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ handle })
    .eq("id", userId)
    .select("handle")
    .single();

  if (error?.code === "23505") throw new ApiError("That username is already taken.", 409);
  if (error) throw new ApiError(error.message || "The username could not be changed.", 500);
  return data.handle;
}

export function createProofSession(assignmentId: string): Promise<ProofSession> {
  if (supabase) return invoke({ action: "create-proof-session", assignmentId });
  return request("/api/proof-sessions", {
    method: "POST",
    body: JSON.stringify({ assignmentId }),
  });
}

export function submitProof(proofSessionId: string, imageDataUrl: string): Promise<Submission> {
  if (supabase) return invoke({ action: "submit-proof", proofSessionId, imageDataUrl });
  return request("/api/submissions", {
    method: "POST",
    body: JSON.stringify({ proofSessionId, imageDataUrl }),
  });
}

export function loadSubmission(submissionId: string): Promise<Submission> {
  if (supabase) return invoke({ action: "get-submission", submissionId });
  return request(`/api/submissions/${encodeURIComponent(submissionId)}`, {
    headers: { "Cache-Control": "no-store" },
  });
}

export function loadSubmissionPage(page: number, pageSize = 8, status?: "accepted"): Promise<SubmissionPage> {
  if (supabase) return invoke({ action: "list-results", page, pageSize, status });
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set("status", status);
  return request(`/api/results?${query.toString()}`, {
    headers: { "Cache-Control": "no-store" },
  });
}
