import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";

// renderer 의 src/lib/firebase.ts 와 동일 리전 — main 은 renderer 모듈을 임포트할
// 수 없어 상수를 별도로 둔다. Cloud Functions 는 전부 us-central1 에 배포된다.
const FIREBASE_FUNCTIONS_REGION = "us-central1";

interface AuthSyncResult {
  ok: boolean;
  uid?: string;
  customTokenAccepted?: boolean;
  error?: string;
}

interface FreshCustomTokenResult {
  ok: boolean;
  customToken?: string;
  uid?: string;
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firebaseAuthErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

// renderer 가 Cloud Function 에서 받은 custom token 을 IPC 로 전달하면 mission
// app(main 프로세스 전용 firebase 인스턴스)을 실제 사용자 uid 로 로그인시키고,
// 이후 spawn 되는 에이전트/MCP 가 상속할 env 토큰을 갱신한다.
//
// ★거부 시 익명 폴백을 하지 않는다 (티켓 etTRzsjqSr3S60xS5Wva):
//   예전엔 거부돼도 signInAnonymously 후 ok:true 를 반환해 renderer 가 sync
//   성공으로 오인했다('로그인 성공 ≠ 토큰sync 성공'의 뿌리, 티켓
//   7qohuvyFNHRJFQP5SubV). 이제 거부는 ok:false 로 정직하게 반환하고 mission
//   app 의 기존 인증 상태를 건드리지 않는다 — renderer 쪽 재시도/에러 표면화가
//   동작할 수 있게.
export async function syncAgentCustomToken(
  customToken: unknown,
): Promise<AuthSyncResult> {
  if (typeof customToken !== "string" || customToken.trim() === "") {
    delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    return { ok: false, error: "Missing custom token." };
  }

  try {
    const { app } = getMissionFirebaseApp();
    const credential = await signInWithCustomToken(getAuth(app), customToken);
    process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = customToken;
    console.info(
      `[FirebaseAuthSync] custom-token auth OK uid=${credential.user.uid}`,
    );
    return { ok: true, uid: credential.user.uid, customTokenAccepted: true };
  } catch (err) {
    // 죽은 토큰이 spawn 되는 에이전트들에게 상속되지 않도록 반드시 제거한다.
    delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    const code = firebaseAuthErrorCode(err);
    console.error(
      `[FirebaseAuthSync] custom-token auth FAILED (code=${code}) — ` +
        "no anonymous fallback; previous auth state preserved",
    );
    return {
      ok: false,
      customTokenAccepted: false,
      error: `custom-token auth failed (code=${code}): ${errorMessage(err)}`,
    };
  }
}

/**
 * 지금 main 프로세스가 알고 있는 **실사용자** uid. 익명 폴백이거나 아직 로그인
 * 전이면 null.
 *
 * 렌더러가 userId 를 넘겨주지 못하는 경로(브리지 → MCP 도구처럼 창이 개입하지
 * 않는 호출)가 "누구의 자격증명으로 동작해야 하나" 를 물을 때 쓴다. 익명 uid 를
 * 절대 돌려주지 않는 것이 요점이다 — 익명 uid 로 사용자 시크릿 저장소를 찾으면
 * 매번 다른 칸을 보게 되고, 그건 "연결이 안 된다" 는 유령 버그로 나타난다.
 */
export function currentRealUserUid(): string | null {
  try {
    const { app } = getMissionFirebaseApp();
    const user = getAuth(app).currentUser;
    if (!user || user.isAnonymous) return null;
    return user.uid;
  } catch {
    return null;
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

// MCP 서버(별도 프로세스)의 자가 재인증 경로 — bridge 의 POST /agent-custom-token
// 이 호출한다. mission app 이 실사용자로 로그인돼 있으면(custom-token 세션의 ID
// 토큰은 자동 갱신됨) issueAgentCustomToken callable 로 신선한 토큰을 발급받는다.
// 익명/미로그인 상태에선 발급을 거부한다 — 익명 uid 로 토큰을 만들면 fail-closed
// 룰과 어긋난 세션을 오히려 재생산하게 되기 때문.
export async function issueFreshAgentCustomToken(): Promise<FreshCustomTokenResult> {
  try {
    const { app } = getMissionFirebaseApp();
    const user = getAuth(app).currentUser;
    if (!user) {
      return { ok: false, error: "mission app has no signed-in user" };
    }
    if (user.isAnonymous) {
      return {
        ok: false,
        error: "mission app is signed in anonymously (not as a real user)",
      };
    }

    const callable = httpsCallable<
      Record<string, never>,
      { customToken?: unknown; uid?: unknown }
    >(getFunctions(app, FIREBASE_FUNCTIONS_REGION), "issueAgentCustomToken");
    const { data } = await callable({});
    if (
      typeof data?.customToken !== "string" ||
      data.customToken === "" ||
      data.uid !== user.uid
    ) {
      return { ok: false, error: "invalid issueAgentCustomToken response" };
    }

    // 이후 spawn 되는 에이전트/오케도 신선한 토큰을 상속하도록 env 를 갱신.
    process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = data.customToken;
    return { ok: true, customToken: data.customToken, uid: user.uid };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
