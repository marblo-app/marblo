import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
} from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

// Main 프로세스 전용 firebase 인스턴스 — pending-instruction-listener / mcp-server
// 와 같은 패턴 (별도 named app + anonymous auth).
//
// Auth 주의:
//   - missions 룰은 firestore.rules 에서 isAuthenticated 만 검사 (v3.1 hardening
//     까지 한시적). isProjectMember 로 다시 좁히면 main 의 anon uid 가 members
//     리스트에 없으므로 write 가 모두 실패한다. 그 시점에는 renderer 가 id token
//     을 IPC 로 전달하고 main 이 signInWithCustomToken 으로 갈아끼우는 흐름이 필요.
//   - tasks/agents 룰은 isAuthenticated 만 검사하므로 anon auth 로 충분.

const APP_NAME = "mission-engine";
const AUTH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const MAX_AUTH_RETRY_DELAY_MS = 30_000;

let cached: { app: FirebaseApp; authReady: Promise<void> } | null = null;

function getAnonymousAuthRetryDelayMs(attempt: number): number {
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

function startAnonymousAuth(auth: Auth): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | undefined;

    const finish = (): void => {
      if (done) return;
      done = true;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      unsubscribe?.();

      console.log("[MissionEngine] anonymous firebase auth OK");
      resolve();
    };

    if (auth.currentUser) {
      finish();
      return;
    }

    unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) finish();
    });

    const attemptSignIn = async (): Promise<void> => {
      if (done) return;

      attempt += 1;
      try {
        await signInAnonymously(auth);
        finish();
      } catch (error) {
        if (done) return;

        const delayMs = getAnonymousAuthRetryDelayMs(attempt);
        console.error(
          `[MissionEngine] anonymous firebase auth failed (attempt ${attempt}; retrying in ${delayMs}ms; code=${getFirebaseAuthErrorCode(
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

  // Electron main uses in-memory auth persistence, so each startup normally
  // needs a fresh anonymous sign-in. Firestore callers await authReady; while
  // offline this may wait indefinitely, but those callers would otherwise hit
  // permission-denied until auth recovers, so retrying here lets the session
  // self-heal after transient network or Electron net stack startup failures.
  const authReady = isTestMode
    ? Promise.resolve()
    : startAnonymousAuth(getAuth(app));

  cached = { app, authReady };
  return cached;
}
