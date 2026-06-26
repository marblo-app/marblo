import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

/**
 * In-app bug report — thin wrapper over the `submitBugReport` callable.
 * The server stamps uid/email/createdAt and validates input; this client only
 * forwards the free-text description plus best-effort diagnostic context.
 */
export interface BugReportContext {
  /** Recent client-side log lines, if a buffer is available (best-effort). */
  recentLogs?: string;
  /** Where the user was when reporting (e.g. active project / tab). */
  route?: string;
  /** Lightweight summary of the current agent fleet for triage. */
  agentSnapshot?: string;
}

export interface SubmitBugReportInput {
  description: string;
  appVersion?: string;
  platform?: string;
  context?: BugReportContext;
}

const submitBugReportFn = httpsCallable<
  SubmitBugReportInput,
  { ok: boolean; id: string }
>(functions, "submitBugReport");

export async function submitBugReport(
  input: SubmitBugReportInput,
): Promise<{ ok: boolean; id: string }> {
  const res = await submitBugReportFn(input);
  return res.data;
}
