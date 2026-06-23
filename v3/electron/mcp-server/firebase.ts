import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
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
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "",
};

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);

// MCP 서버는 별도 프로세스로 실행되어 Firebase Auth 컨텍스트가 없음.
// 익명 인증으로 Firestore 보안 규칙의 isAuthenticated() 체크를 통과.
const auth = getAuth(app);

// 인증이 네트워크 지연 등으로 영영 settle 되지 않아도 서버 기동을 막지 않도록
// 타임아웃 가드를 둔다. 만료되면 경고만 남기고 진행하며, 이후 Firestore 호출은
// 각 호출 지점의 try/catch 로 개별 처리된다(인증 미완료 시 보안규칙에서 거절될 뿐
// 프로세스는 살아 있음).
const AUTH_TIMEOUT_MS = 10_000;

// 주의: 반드시 stderr 로만 출력. stdio MCP transport 가 stdout 으로 JSONRPC
// 프레임을 주고받기 때문에 console.log 로 한 줄이라도 흘리면 strict 클라이언트
// (Codex 등) 가 initialize response 를 파싱 못하고 connection 을 끊음.
// authReady 는 절대 reject 하지 않는다(항상 void 로 resolve) — main() 의
// `await authReady` 가 인증 실패/지연으로 서버 기동을 멈추지 않게 하기 위함.
export const authReady: Promise<void> = new Promise<void>((resolve) => {
  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve();
  };

  const timer = setTimeout(() => {
    if (settled) return;
    console.error(
      `[MCP] Firebase anonymous auth timed out after ${AUTH_TIMEOUT_MS}ms; ` +
        "starting server anyway (Firestore calls will be handled individually)"
    );
    finish();
  }, AUTH_TIMEOUT_MS);
  // 인증이 먼저 끝나면 이 타이머가 프로세스 종료를 막지 않게 unref.
  if (typeof timer.unref === "function") timer.unref();

  signInAnonymously(auth)
    .then(() => {
      console.error("[MCP] Firebase anonymous auth OK");
    })
    .catch((err) => {
      console.error("[MCP] Firebase anonymous auth failed:", err);
    })
    .finally(finish);
});
