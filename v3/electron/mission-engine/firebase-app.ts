import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";

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

let cached: { app: FirebaseApp; authReady: Promise<void> } | null = null;

export function getMissionFirebaseApp(): {
  app: FirebaseApp;
  authReady: Promise<void>;
} {
  if (cached) return cached;

  const config = {
    apiKey:
      process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "",
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

  const app =
    getApps().find((a) => a.name === APP_NAME) ||
    initializeApp(config, APP_NAME);
  const authReady = signInAnonymously(getAuth(app))
    .then(() => {
      console.log("[MissionEngine] anonymous firebase auth OK");
    })
    .catch((err) => {
      console.error("[MissionEngine] anonymous firebase auth failed:", err);
    });

  cached = { app, authReady };
  return cached;
}
