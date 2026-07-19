/**
 * MCP 인증 게이트 회귀 테스트 (티켓 etTRzsjqSr3S60xS5Wva).
 *
 * 계약:
 *  1. custom token 실패/부재 시 익명으로 조용히 진행하지 않는다 (익명 폴백 제거).
 *  2. 미인증 상태의 도구 호출은 bridge 재인증을 시도하고, 실패하면 '인증 실패'
 *     를 명시한 McpAuthError 를 던진다 — PERMISSION_DENIED 로 둔갑하지 않는다.
 *  3. 재인증 성공 시 인증 상태로 전환되고 env 토큰이 신선한 값으로 갱신된다.
 *  4. 재인증 실패 직후의 연속 호출은 쿨다운으로 빠르게 실패한다 (bridge 폭주 방지).
 *
 * firebase.ts 는 모듈 로드 시점에 authReady 사이드이펙트를 시작하므로, 각
 * 테스트는 vi.resetModules + 동적 import 로 새 모듈 상태에서 시작한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => {
  const instance: {
    currentUser: { uid: string; isAnonymous: boolean } | null;
  } = { currentUser: null };
  return {
    instance,
    signInWithCustomToken: vi.fn(),
  };
});

vi.mock("firebase/auth", () => ({
  getAuth: () => authMock.instance,
  signInWithCustomToken: authMock.signInWithCustomToken,
}));

const ENV_KEYS = [
  "MARBLO_FIREBASE_CUSTOM_TOKEN",
  "MARBLO_MCP_ALLOW_UNAUTHENTICATED",
  "MARBLO_BRIDGE_PORT",
  "MARBLO_BRIDGE_TOKEN",
] as const;
const savedEnv: Record<string, string | undefined> = {};

type FirebaseModule = typeof import("../../electron/mcp-server/firebase");

async function importFirebase(): Promise<FirebaseModule> {
  return await import("../../electron/mcp-server/firebase");
}

function stubFetchOnce(response: {
  ok: boolean;
  status: number;
  body: unknown;
}) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
  authMock.instance.currentUser = null;
  authMock.signInWithCustomToken.mockReset();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("MCP auth gate — no anonymous fallback", () => {
  it("토큰 부재 + bridge 부재 → 익명 진행 없이 명시적 인증 실패 에러", async () => {
    const fb = await importFirebase();
    await fb.authReady;

    expect(fb.getAuthStatus()).toEqual({
      state: "unauthenticated",
      reason: "no custom token in env",
    });
    // 익명 로그인 자체가 존재하지 않는다 — 어떤 sign-in 도 호출되지 않았다.
    expect(authMock.signInWithCustomToken).not.toHaveBeenCalled();

    await expect(fb.ensureAuthenticated()).rejects.toThrow(fb.McpAuthError);
    await expect(fb.ensureAuthenticated()).rejects.toThrow(/익명 폴백/);
    // 룰/멤버십을 의심하게 만들지 않는 문구 계약.
    await expect(fb.ensureAuthenticated()).rejects.toThrow(
      /룰\/프로젝트 멤버십 문제가 아니라/,
    );
  });

  it("startup 토큰 거부 → unauthenticated 상태 기록, 익명 폴백 없음", async () => {
    process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = "expired-token";
    authMock.signInWithCustomToken.mockRejectedValueOnce({
      code: "auth/invalid-custom-token",
    });

    const fb = await importFirebase();
    await fb.authReady;

    expect(fb.getAuthStatus()).toEqual({
      state: "unauthenticated",
      reason: "custom token rejected",
      errorCode: "auth/invalid-custom-token",
    });
    expect(fb.getCurrentAuthUid()).toBeNull();
  });

  it("startup 토큰 성공 → authenticated, 게이트 즉시 통과 (무회귀)", async () => {
    process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = "good-token";
    authMock.signInWithCustomToken.mockImplementationOnce(async () => {
      authMock.instance.currentUser = { uid: "real-user", isAnonymous: false };
      return { user: authMock.instance.currentUser };
    });
    const fetchMock = stubFetchOnce({ ok: true, status: 200, body: {} });

    const fb = await importFirebase();
    await fb.authReady;

    expect(fb.getAuthStatus()).toEqual({
      state: "authenticated",
      uid: "real-user",
    });
    await expect(fb.ensureAuthenticated()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("MARBLO_MCP_ALLOW_UNAUTHENTICATED=1 opt-in 시에만 미인증 통과", async () => {
    process.env.MARBLO_MCP_ALLOW_UNAUTHENTICATED = "1";
    const fb = await importFirebase();
    await expect(fb.ensureAuthenticated()).resolves.toBeUndefined();
  });
});

describe("MCP auth gate — bridge 자가 재인증", () => {
  it("미인증 도구 호출 → bridge 에서 신선한 토큰 받아 재로그인 + env 갱신", async () => {
    process.env.MARBLO_BRIDGE_PORT = "45678";
    process.env.MARBLO_BRIDGE_TOKEN = "bridge-secret";
    const fetchMock = stubFetchOnce({
      ok: true,
      status: 200,
      body: { success: true, customToken: "fresh-token", uid: "real-user" },
    });
    authMock.signInWithCustomToken.mockImplementationOnce(async () => {
      authMock.instance.currentUser = { uid: "real-user", isAnonymous: false };
      return { user: authMock.instance.currentUser };
    });

    const fb = await importFirebase();
    await expect(fb.ensureAuthenticated()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("http://127.0.0.1:45678/agent-custom-token");
    expect(init.headers["Authorization"]).toBe("Bearer bridge-secret");
    expect(authMock.signInWithCustomToken).toHaveBeenCalledWith(
      authMock.instance,
      "fresh-token",
    );
    expect(fb.getAuthStatus()).toEqual({
      state: "authenticated",
      uid: "real-user",
    });
    // 이후 spawn 상속용 env 도 신선한 토큰으로 갱신된다.
    expect(process.env.MARBLO_FIREBASE_CUSTOM_TOKEN).toBe("fresh-token");
  });

  it("bridge 발급 거부(익명/미로그인) → 명시 에러 + 쿨다운으로 연속 호출 차단", async () => {
    process.env.MARBLO_BRIDGE_PORT = "45678";
    const fetchMock = stubFetchOnce({
      ok: false,
      status: 409,
      body: {
        success: false,
        error: "mission app is signed in anonymously (not as a real user)",
      },
    });

    const fb = await importFirebase();
    await expect(fb.ensureAuthenticated()).rejects.toThrow(
      /signed in anonymously/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 쿨다운: 직후 재호출은 bridge 를 다시 두드리지 않고 빠르게 실패한다.
    await expect(fb.ensureAuthenticated()).rejects.toThrow(/쿨다운/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
