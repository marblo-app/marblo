import { getAuth, signInWithCustomToken, signOut } from "firebase/auth";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";

interface AuthSyncResult {
  ok: boolean;
  uid?: string;
  error?: string;
}

interface MissionSignInResult {
  uid: string;
}

const CUSTOM_TOKEN_SYNC_RETRY_DELAYS_MS = [250, 750, 1_500];
const CUSTOM_TOKEN_WAIT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000];

let inFlightSync: Promise<AuthSyncResult> | null = null;
let lastSyncResult: AuthSyncResult | null = null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getFirebaseAuthErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signInMissionAppWithCustomToken(
  customToken: string,
): Promise<MissionSignInResult> {
  const { app } = getMissionFirebaseApp();
  const auth = getAuth(app);

  for (let attempt = 1; ; attempt += 1) {
    try {
      const credential = await signInWithCustomToken(auth, customToken);
      return { uid: credential.user.uid };
    } catch (err) {
      const delayMs = CUSTOM_TOKEN_SYNC_RETRY_DELAYS_MS[attempt - 1];
      const code = getFirebaseAuthErrorCode(err);
      if (delayMs === undefined) {
        console.error(
          `[FirebaseAuthSync] custom-token auth failed after ${attempt} attempts (code=${code}); fail-closed`,
          err,
        );
        throw err;
      }
      console.warn(
        `[FirebaseAuthSync] custom-token auth failed (attempt ${attempt}; retrying in ${delayMs}ms; code=${code})`,
        err,
      );
      await sleep(delayMs);
    }
  }
}

export async function syncAgentCustomToken(
  customToken: unknown,
): Promise<AuthSyncResult> {
  if (typeof customToken !== "string" || customToken.trim() === "") {
    delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    lastSyncResult = { ok: false, error: "Missing custom token." };
    return lastSyncResult;
  }

  const token = customToken.trim();
  process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = token;

  inFlightSync = (async () => {
    try {
      const result = await signInMissionAppWithCustomToken(token);
      lastSyncResult = { ok: true, uid: result.uid };
      console.info(`[FirebaseAuthSync] custom-token auth OK (uid=${result.uid})`);
      return lastSyncResult;
    } catch (err) {
      delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
      const error = `Agent Firebase custom-token auth failed: ${errorMessage(err)}`;
      lastSyncResult = { ok: false, error };
      return lastSyncResult;
    } finally {
      inFlightSync = null;
    }
  })();

  return inFlightSync;
}

export async function waitForAgentCustomToken(
  reason: string,
): Promise<AuthSyncResult> {
  for (let attempt = 1; ; attempt += 1) {
    if (inFlightSync) {
      const result = await inFlightSync;
      if (result.ok) return result;
    }

    const customToken = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    if (typeof customToken === "string" && customToken.trim() !== "") {
      return { ok: true, uid: lastSyncResult?.uid };
    }

    const delayMs = CUSTOM_TOKEN_WAIT_DELAYS_MS[attempt - 1];
    if (delayMs === undefined) {
      const detail =
        lastSyncResult?.error ??
        "Agent Firebase custom token is not ready. Sign in again and retry.";
      const error = `Agent launch blocked before ${reason}: ${detail}`;
      console.error(`[FirebaseAuthSync] ${error}`);
      return { ok: false, error };
    }

    console.warn(
      `[FirebaseAuthSync] Waiting for custom token before ${reason} (attempt ${attempt}; ${delayMs}ms)`,
    );
    await sleep(delayMs);
  }
}

export async function clearAgentCustomToken(): Promise<AuthSyncResult> {
  delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
  lastSyncResult = null;

  try {
    const { app } = getMissionFirebaseApp();
    await signOut(getAuth(app));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
