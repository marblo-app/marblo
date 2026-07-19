import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInWithCustomToken } from "firebase/auth";

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

// env → 값 (FIREBASE_* 우선, 없으면 VITE_FIREBASE_*).
function fromEnv(): FirebaseWebConfig {
  return {
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
}

// 패키지 앱에서 이 MCP child 는 별도 node 프로세스라 process.env 에 Firebase
// 설정이 없다(dev 만 .env/vite 로 존재). electron main 이 아니라 이 프로세스가
// 자기완결적으로 붙도록, env 가 비면 자기 옆에 번들된 공개 firebase-config.json
// 을 읽는다. esbuild 번들 후 import.meta.url 은 dist-mcp/index.js 를 가리키므로
// Resources/dist-mcp/firebase-config.json 이 sibling 으로 해석된다(dev 는 파일이
// 없어 catch → env 사용). 이게 없으면 apiKey="" 로 getAuth 가 모듈 로드 중
// auth/invalid-api-key 로 크래시 → -32000. 티켓 MRJKgyJ4C1qPhj2Ui3vJ.
function fromBundledFile(): Partial<FirebaseWebConfig> {
  try {
    const p = fileURLToPath(new URL("./firebase-config.json", import.meta.url));
    return JSON.parse(
      fs.readFileSync(p, "utf-8"),
    ) as Partial<FirebaseWebConfig>;
  } catch {
    return {};
  }
}

function resolveFirebaseConfig(): FirebaseWebConfig {
  const env = fromEnv();
  if (env.apiKey) return env;
  // env 부재(패키지 경로): 번들 파일을 베이스로, 개별적으로 세팅된 env 값만 덮어씀.
  const disk = fromBundledFile();
  const merged = { ...disk } as Record<string, string>;
  for (const [k, v] of Object.entries(env)) {
    if (v) merged[k] = v;
  }
  return {
    apiKey: merged.apiKey || "",
    authDomain: merged.authDomain || "",
    projectId: merged.projectId || "",
    storageBucket: merged.storageBucket || "",
    messagingSenderId: merged.messagingSenderId || "",
    appId: merged.appId || "",
  };
}

const firebaseConfig = resolveFirebaseConfig();

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);

// MCP 서버는 별도 프로세스로 실행되어 renderer Firebase Auth 컨텍스트가 없음.
// main 이 전달한 custom token(MARBLO_FIREBASE_CUSTOM_TOKEN)으로 실제 사용자
// uid 로 로그인한다.
//
// ★익명 폴백은 하지 않는다 (티켓 etTRzsjqSr3S60xS5Wva):
//   firestore.rules 는 fail-closed(isProjectMember)라 익명 uid 는 프로젝트
//   데이터 전부 PERMISSION_DENIED 다. 그런데도 익명으로 조용히 붙어 있으면
//   '연결은 됐는데 아무것도 안 되는' 무증상 마비가 되고, 사용자는 룰/멤버십을
//   의심하게 된다. 게다가 익명 세션도 isAuthenticated() 만 검사하는 컬렉션
//   (missions/users read/audit_logs 등)에는 접근 가능해 보안상으로도 나쁘다.
//   인증 실패는 실패로 드러내고, 도구 호출 시 ensureAuthenticated() 가 bridge
//   를 통해 신선한 토큰을 받아 자가 복구를 시도한다.
const auth = getAuth(app);

export type McpAuthStatus =
  | { state: "pending" }
  | { state: "authenticated"; uid: string }
  | { state: "unauthenticated"; reason: string; errorCode?: string };

let authStatus: McpAuthStatus = { state: "pending" };

export function getAuthStatus(): McpAuthStatus {
  return authStatus;
}

export function getCurrentAuthUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

/** 인증 실패를 PERMISSION_DENIED 로 둔갑시키지 않기 위한 명시적 에러 타입. */
export class McpAuthError extends Error {}

// 테스트/개발용 명시적 opt-in — 인증 게이트를 건너뛰고 도구 핸들러를 실행한다
// (익명 로그인을 하는 게 아니라 그냥 미인증으로 진행; Firestore 는 mock 이거나
// 룰에서 거절된다). 유닛테스트가 tools.ts 를 임포트해 핸들러를 직접 부를 때 사용.
function allowUnauthenticated(): boolean {
  return process.env.MARBLO_MCP_ALLOW_UNAUTHENTICATED === "1";
}

function getFirebaseAuthErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return "unknown";
}

// 인증이 네트워크 지연 등으로 영영 settle 되지 않아도 서버 기동을 막지 않도록
// 타임아웃 가드를 둔다. 만료되면 경고만 남기고 진행하며, 이후 도구 호출은
// ensureAuthenticated() 가 개별적으로 인증을 보장/복구한다.
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
      `[MCP] Firebase auth did not settle within ${AUTH_TIMEOUT_MS}ms; ` +
        "starting server anyway (tool calls will retry via ensureAuthenticated)",
    );
    finish();
  }, AUTH_TIMEOUT_MS);
  // 인증이 먼저 끝나면 이 타이머가 프로세스 종료를 막지 않게 unref.
  if (typeof timer.unref === "function") timer.unref();

  const customToken = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
  if (!customToken) {
    authStatus = { state: "unauthenticated", reason: "no custom token in env" };
    console.error(
      "[MCP] No MARBLO_FIREBASE_CUSTOM_TOKEN; starting signed out " +
        "(first tool call will attempt re-auth via the Marblo bridge)",
    );
    finish();
    return;
  }

  signInWithCustomToken(auth, customToken)
    .then(() => {
      authStatus = {
        state: "authenticated",
        uid: auth.currentUser?.uid ?? "",
      };
      console.error(
        `[MCP] Firebase custom-token auth OK (uid=${auth.currentUser?.uid ?? "unknown"})`,
      );
    })
    .catch((err) => {
      const code = getFirebaseAuthErrorCode(err);
      authStatus = {
        state: "unauthenticated",
        reason: "custom token rejected",
        errorCode: code,
      };
      console.error(
        `[MCP] Firebase custom-token auth FAILED (code=${code}); ` +
          "NOT falling back to anonymous — tool calls will attempt re-auth via the Marblo bridge",
      );
    })
    .finally(finish);
});

// ── 자가 재인증 (bridge 경유) ────────────────────────────────────────────────
// custom token 은 짧은 수명(만료 ~1h)이라, env 로 물려받은 토큰이 죽으면 예전엔
// 앱 재시작만이 유일한 복구법이었다. 앱이 로그인 상태면 bridge 의
// POST /agent-custom-token 이 mission app 계정으로 신선한 토큰을 발급해 주므로,
// 여기서 받아서 스스로 다시 로그인한다.

const REAUTH_FAILURE_COOLDOWN_MS = 10_000;
let reauthInFlight: Promise<void> | null = null;
let lastReauthFailureAt = 0;
let lastReauthFailureMessage = "";

async function fetchCustomTokenFromBridge(): Promise<string> {
  const port = process.env.MARBLO_BRIDGE_PORT;
  if (!port) {
    throw new McpAuthError(
      "bridge unreachable (no MARBLO_BRIDGE_PORT) — Marblo 앱이 실행 중인지 확인",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const bridgeToken = process.env.MARBLO_BRIDGE_TOKEN;
  if (bridgeToken) headers["Authorization"] = `Bearer ${bridgeToken}`;

  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/agent-custom-token`, {
      method: "POST",
      headers,
      body: "{}",
    });
  } catch (err) {
    throw new McpAuthError(
      `bridge request failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    customToken?: unknown;
    error?: string;
  } | null;
  if (
    !res.ok ||
    !body?.success ||
    typeof body.customToken !== "string" ||
    body.customToken === ""
  ) {
    throw new McpAuthError(
      `bridge did not return a token (status=${res.status}${
        body?.error ? `, ${body.error}` : ""
      })`,
    );
  }
  return body.customToken;
}

async function reauthenticateViaBridge(): Promise<void> {
  const customToken = await fetchCustomTokenFromBridge();
  try {
    await signInWithCustomToken(auth, customToken);
  } catch (err) {
    throw new McpAuthError(
      `fresh token sign-in failed (code=${getFirebaseAuthErrorCode(err)})`,
    );
  }
  // 이 프로세스가 자식을 spawn 할 일이 생겨도 죽은 토큰 대신 새 토큰을 상속시킨다.
  process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = customToken;
  authStatus = { state: "authenticated", uid: auth.currentUser?.uid ?? "" };
  console.error(
    `[MCP] Firebase re-auth via bridge OK (uid=${auth.currentUser?.uid ?? "unknown"})`,
  );
}

function authFailureMessage(detail: string): string {
  const cause =
    authStatus.state === "unauthenticated"
      ? authStatus.errorCode
        ? `${authStatus.reason} (code=${authStatus.errorCode})`
        : authStatus.reason
      : "auth not settled";
  return (
    `Firebase 인증 실패 — MCP 는 익명 폴백 없이 fail-closed 로 동작합니다. ` +
    `원인: ${cause}. 재인증 시도 결과: ${detail}. ` +
    `이것은 Firestore 룰/프로젝트 멤버십 문제가 아니라 이 MCP 프로세스의 인증 문제입니다. ` +
    `복구: Marblo 앱이 실행 중이고 로그인돼 있으면 잠시 후 다시 호출하세요(자동 재인증). ` +
    `계속 실패하면 앱에서 재로그인하세요.`
  );
}

/**
 * 도구 실행 전 인증 게이트. 인증 상태면 즉시 통과, 아니면 bridge 재인증을
 * 시도하고(동시 호출은 single-flight 로 합류, 실패 후 10s 쿨다운), 그래도
 * 실패하면 원인을 명시한 McpAuthError 를 던진다 — 익명으로 진행하지 않는다.
 */
export async function ensureAuthenticated(): Promise<void> {
  await authReady;
  if (auth.currentUser && !auth.currentUser.isAnonymous) return;
  if (allowUnauthenticated()) return;

  let attempt = reauthInFlight;
  if (!attempt) {
    if (Date.now() - lastReauthFailureAt < REAUTH_FAILURE_COOLDOWN_MS) {
      throw new McpAuthError(
        authFailureMessage(
          `직전 재인증 실패(${lastReauthFailureMessage}) 후 쿨다운 중`,
        ),
      );
    }
    attempt = reauthenticateViaBridge().finally(() => {
      reauthInFlight = null;
    });
    reauthInFlight = attempt;
  }

  try {
    await attempt;
  } catch (err) {
    lastReauthFailureAt = Date.now();
    lastReauthFailureMessage =
      err instanceof Error ? err.message : String(err);
    throw new McpAuthError(authFailureMessage(lastReauthFailureMessage));
  }
}
