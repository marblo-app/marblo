import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  type Auth,
} from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

// Main 프로세스 전용 firebase 인스턴스 — pending-instruction-listener / mcp-server
// 와 같은 패턴 (별도 named app).
//
// Auth 주의:
//   - renderer 가 Cloud Function 에서 받은 custom token 을 IPC 로 전달하면
//     main 이 실제 사용자 uid 로 signInWithCustomToken 한다.
//   - token 이 아직 없으면 Firestore 접근 전 대기한다. flip 이후 anonymous/unauth
//     상태로 eager listener/write 가 나가면 permission-denied 로 실패한다.
//   - token 검증 실패 후에도 익명 인증으로 폴백하지 않고 fail-closed 한다.

const APP_NAME = "mission-engine";
const AUTH_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const MAX_AUTH_RETRY_DELAY_MS = 30_000;

let cached: { app: FirebaseApp; authReady: Promise<void> } | null = null;

function getCustomTokenAuthRetryDelayMs(attempt: number): number {
  return Math.min(
    AUTH_RETRY_DELAYS_MS[attempt - 1] ?? MAX_AUTH_RETRY_DELAY_MS,
    MAX_AUTH_RETRY_DELAY_MS,
  );
}

function getFirebaseAuthErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return "unknown";
}

async function signInWithCustomTokenOrThrow(
  auth: Auth,
  customToken: string,
): Promise<void> {
  try {
    const credential = await signInWithCustomToken(auth, customToken);
    console.log(
      `[MissionEngine] Firebase auth OK uid=${credential.user.uid} anonymous=${credential.user.isAnonymous}`,
    );
  } catch (error) {
    console.error(
      `[MissionEngine] custom-token auth failed (code=${getFirebaseAuthErrorCode(
        error,
      )}); fail-closed`,
      error,
    );
    throw new Error(
      `[MissionEngine] custom-token auth failed (code=${getFirebaseAuthErrorCode(
        error,
      )}); fail-closed`,
    );
  }
}

function startMainFirebaseAuth(auth: Auth): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = (): void => {};

    const finish = (): void => {
      if (done) return;
      done = true;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      unsubscribe();

      console.log(
        `[MissionEngine] firebase auth ready uid=${auth.currentUser?.uid ?? "unknown"} anonymous=${auth.currentUser?.isAnonymous ?? "unknown"}`,
      );
      resolve();
    };

    const fail = (error: unknown): void => {
      if (done) return;
      done = true;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      unsubscribe?.();

      console.error(
        `[MissionEngine] firebase custom-token auth unavailable; continuing fail-closed (code=${getFirebaseAuthErrorCode(
          error,
        )})`,
        error,
      );
      resolve();
    };

    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      finish();
      return;
    }

    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && !user.isAnonymous) finish();
    });

    const attemptSignIn = async (): Promise<void> => {
      if (done) return;

      attempt += 1;
      try {
        const customToken = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
        if (customToken) {
          await signInWithCustomTokenOrThrow(auth, customToken);
        } else {
          throw new Error("Missing MARBLO_FIREBASE_CUSTOM_TOKEN");
        }

        finish();
        return;
      } catch (error) {
        if (done) return;

        if (attempt >= AUTH_RETRY_DELAYS_MS.length) {
          console.error(
            `[MissionEngine] firebase custom-token auth failed after ${attempt} attempts; fail-closed (code=${getFirebaseAuthErrorCode(
              error,
            )})`,
            error,
          );
          fail(error);
          return;
        }

        const delayMs = getCustomTokenAuthRetryDelayMs(attempt);
        console.error(
          `[MissionEngine] firebase custom-token auth not ready (attempt ${attempt}; retrying in ${delayMs}ms; code=${getFirebaseAuthErrorCode(
            error,
          )})`,
          error,
        );

        retryTimer = setTimeout(() => {
          retryTimer = null;
          void attemptSignIn();
        }, delayMs);
      }
    };

    void attemptSignIn();
  });
}

export function getMissionFirebaseApp(): {
  app: FirebaseApp;
  authReady: Promise<void>;
} {
  if (cached) return cached;

  // e2e/test 모드 — Playwright launch.ts가 MARBLO_TEST_BYPASS_AUTH=1 을 기본 주입.
  // worktree처럼 .env가 없는 환경에서 apiKey=undefined로 getAuth가 throw하면
  // main process가 다이얼로그와 함께 죽는다 (auth/invalid-api-key). 더미 키로
  // initialize하고 signIn 시도 자체를 skip 해서 호출 경로만 살려둔다.
  const isTestMode =
    process.env.MARBLO_TEST_MODE === "mock" ||
    process.env.MARBLO_TEST_BYPASS_AUTH === "1";

  const apiKey =
    process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";

  const config = {
    apiKey: apiKey || (isTestMode ? "test-api-key" : ""),
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      "",
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      "",
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      "",
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID ||
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      "",
    appId:
      process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "",
  };

  const existing = getApps().find((a) => a.name === APP_NAME);
  const app = existing || initializeApp(config, APP_NAME);
  if (!existing) {
    // step.output / step.error 등 optional 필드가 undefined 인 상태로 patch 되는
    // 경우 addDoc/updateDoc 실패를 막기 위해 firestore 초기화 시 옵션을 켠다.
    // 이후 getFirestore(app) 호출은 동일 인스턴스를 반환한다.
    initializeFirestore(app, { ignoreUndefinedProperties: true });
  }

  // Electron main uses in-memory auth persistence, so each startup needs a
  // fresh custom-token sign-in. authReady never signs in anonymously; if the
  // token is missing or rejected, callers continue fail-closed and Firestore
  // rules deny access until syncAgentCustomToken signs the app in.
  const authReady = isTestMode
    ? Promise.resolve()
    : startMainFirebaseAuth(getAuth(app));

  cached = { app, authReady };
  return cached;
}
