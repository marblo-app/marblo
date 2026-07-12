import type { User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

interface IssueAgentCustomTokenResponse {
  customToken: string;
  uid: string;
}

const issueAgentCustomToken = httpsCallable<
  Record<string, never>,
  IssueAgentCustomTokenResponse
>(functions, "issueAgentCustomToken");

function getAgentAuthApi() {
  return window.electronAPI?.auth;
}

export async function syncAgentFirebaseAuth(user: User): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.syncAgentCustomToken) return;

  try {
    const result = await issueAgentCustomToken({});
    const { customToken, uid } = result.data;

    if (!customToken || uid !== user.uid) {
      throw new Error("Invalid agent custom token response.");
    }

    const syncResult = await api.syncAgentCustomToken(customToken);
    if (!syncResult.ok) {
      throw new Error(syncResult.error || "Agent Firebase auth sync failed.");
    }
  } catch (err) {
    await api.clearAgentCustomToken?.().catch(() => undefined);
    throw err;
  }
}

export async function clearAgentFirebaseAuth(): Promise<void> {
  const api = getAgentAuthApi();
  if (!api?.clearAgentCustomToken) return;

  const result = await api.clearAgentCustomToken();
  if (!result.ok) {
    throw new Error(result.error || "Agent Firebase auth clear failed.");
  }
}
