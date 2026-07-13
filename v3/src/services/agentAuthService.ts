import type { User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

interface IssueAgentCustomTokenResponse {
  customToken: string;
  uid: string;
}

interface SyncAgentFirebaseAuthOptions {
  forceRefreshIdToken?: boolean;
}

const issueAgentCustomToken = httpsCallable<
  Record<string, never>,
  IssueAgentCustomTokenResponse
>(functions, "issueAgentCustomToken");

const SYNC_AGENT_AUTH_RETRY_DELAYS_MS = [0, 500, 1_500];

function getAgentAuthApi() {
  return window.electronAPI?.auth;
}

function isIssueAgentCustomTokenResponse(
  value: unknown,
): value is IssueAgentCustomTokenResponse {
  if (typeof value !== "object" || value === null) return false;

  const response = value as Partial<IssueAgentCustomTokenResponse>;
  return (
    typeof response.customToken === "string" && typeof response.uid === "string"
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncAgentFirebaseAuthOnce(
  user: User,
  options: SyncAgentFirebaseAuthOptions,
): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.syncAgentCustomToken) return;

  await user.getIdToken(options.forceRefreshIdToken ?? false);
  const result = await issueAgentCustomToken({});
  const { data } = result;

  if (!isIssueAgentCustomTokenResponse(data) || data.uid !== user.uid) {
    throw new Error("Invalid agent custom token response.");
  }

  const syncResult = await api.syncAgentCustomToken(data.customToken);
  if (!syncResult.ok) {
    throw new Error(syncResult.error || "Agent Firebase auth sync failed.");
  }
}

export async function syncAgentFirebaseAuth(
  user: User,
  options: SyncAgentFirebaseAuthOptions = {},
): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.syncAgentCustomToken) return;

  let lastError: unknown;

  for (let attempt = 1; attempt <= SYNC_AGENT_AUTH_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = SYNC_AGENT_AUTH_RETRY_DELAYS_MS[attempt - 1];
    if (delayMs > 0) await sleep(delayMs);

    try {
      await syncAgentFirebaseAuthOnce(user, options);
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[auth] agent Firebase auth sync attempt ${attempt} failed: ${errorMessage(
          err,
        )}`,
      );
    }
  }

  await api.clearAgentCustomToken?.().catch(() => undefined);
  throw lastError instanceof Error
    ? lastError
    : new Error("Agent Firebase auth sync failed.");
}

export async function clearAgentFirebaseAuth(): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.clearAgentCustomToken) return;

  const result = await api.clearAgentCustomToken();
  if (!result.ok) {
    throw new Error(result.error || "Agent Firebase auth clear failed.");
  }
}
