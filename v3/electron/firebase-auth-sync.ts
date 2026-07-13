import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
} from "firebase/auth";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";

interface AuthSyncResult {
  ok: boolean;
  uid?: string;
  error?: string;
}

interface MissionSignInResult {
  uid: string;
  customTokenAccepted: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function signInMissionAppWithAnonymousFallback(
  customToken: string,
): Promise<MissionSignInResult> {
  const { app } = getMissionFirebaseApp();
  const auth = getAuth(app);

  try {
    const credential = await signInWithCustomToken(auth, customToken);
    return { uid: credential.user.uid, customTokenAccepted: true };
  } catch (err) {
    console.error(
      "[FirebaseAuthSync] custom-token auth failed; falling back to anonymous",
      err,
    );
    const credential = await signInAnonymously(auth);
    return { uid: credential.user.uid, customTokenAccepted: false };
  }
}

export async function syncAgentCustomToken(
  customToken: unknown,
): Promise<AuthSyncResult> {
  if (typeof customToken !== "string" || customToken.trim() === "") {
    delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    return { ok: false, error: "Missing custom token." };
  }

  process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = customToken;

  try {
    const result = await signInMissionAppWithAnonymousFallback(customToken);
    if (!result.customTokenAccepted) {
      delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    }
    return { ok: true, uid: result.uid };
  } catch (err) {
    delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    return { ok: false, error: errorMessage(err) };
  }
}

export async function clearAgentCustomToken(): Promise<AuthSyncResult> {
  delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;

  try {
    const { app } = getMissionFirebaseApp();
    const credential = await signInAnonymously(getAuth(app));
    return { ok: true, uid: credential.user.uid };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
