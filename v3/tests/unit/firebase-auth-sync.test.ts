/**
 * firebase-auth-sync 회귀 테스트 (티켓 etTRzsjqSr3S60xS5Wva).
 *
 * 계약:
 *  1. custom token 거부 시 익명 폴백 없이 ok:false 를 반환한다 — 예전엔
 *     signInAnonymously 후 ok:true 를 반환해 renderer 가 sync 성공으로
 *     오인했다('로그인 성공 ≠ 토큰sync 성공', 티켓 7qohuvyFNHRJFQP5SubV 뿌리).
 *  2. env 토큰은 성공 시에만 설정되고, 거부 시 제거된다 (spawn 상속 오염 방지).
 *  3. issueFreshAgentCustomToken 은 mission app 이 실사용자일 때만 발급한다 —
 *     익명 세션으로는 발급하지 않는다 (bridge /agent-custom-token 의 코어).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const missionMock = vi.hoisted(() => {
  const auth: {
    currentUser: { uid: string; isAnonymous: boolean } | null;
  } = { currentUser: null };
  return {
    auth,
    signInWithCustomToken: vi.fn(),
    signInAnonymously: vi.fn(),
    callable: vi.fn(),
    httpsCallable: vi.fn(),
  };
});

vi.mock("firebase/auth", () => ({
  getAuth: () => missionMock.auth,
  signInWithCustomToken: missionMock.signInWithCustomToken,
  signInAnonymously: missionMock.signInAnonymously,
}));

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: missionMock.httpsCallable,
}));

vi.mock("../../electron/mission-engine/firebase-app", () => ({
  getMissionFirebaseApp: () => ({
    app: { name: "mission-engine" },
    authReady: Promise.resolve(),
  }),
}));

import {
  issueFreshAgentCustomToken,
  syncAgentCustomToken,
} from "../../electron/firebase-auth-sync";

const savedToken = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;

beforeEach(() => {
  missionMock.auth.currentUser = null;
  missionMock.signInWithCustomToken.mockReset();
  missionMock.signInAnonymously.mockReset();
  missionMock.callable.mockReset();
  missionMock.httpsCallable.mockReset();
  missionMock.httpsCallable.mockReturnValue(missionMock.callable);
  delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
  else process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = savedToken;
});

describe("syncAgentCustomToken — 거부 시 익명 폴백 없음", () => {
  it("토큰 거부 → ok:false + env 제거 + signInAnonymously 미호출", async () => {
    process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = "stale-token";
    missionMock.signInWithCustomToken.mockRejectedValueOnce({
      code: "auth/invalid-custom-token",
    });

    const result = await syncAgentCustomToken("bad-token");

    expect(result.ok).toBe(false);
    expect(result.customTokenAccepted).toBe(false);
    expect(result.error).toContain("auth/invalid-custom-token");
    expect(process.env.MARBLO_FIREBASE_CUSTOM_TOKEN).toBeUndefined();
    expect(missionMock.signInAnonymously).not.toHaveBeenCalled();
  });

  it("토큰 성공 → ok:true + env 는 성공 시에만 설정", async () => {
    missionMock.signInWithCustomToken.mockResolvedValueOnce({
      user: { uid: "real-user" },
    });

    const result = await syncAgentCustomToken("good-token");

    expect(result).toEqual({
      ok: true,
      uid: "real-user",
      customTokenAccepted: true,
    });
    expect(process.env.MARBLO_FIREBASE_CUSTOM_TOKEN).toBe("good-token");
  });

  it("빈/비문자열 토큰 → ok:false + env 제거", async () => {
    process.env.MARBLO_FIREBASE_CUSTOM_TOKEN = "leftover";
    const result = await syncAgentCustomToken("   ");
    expect(result.ok).toBe(false);
    expect(process.env.MARBLO_FIREBASE_CUSTOM_TOKEN).toBeUndefined();
    expect(missionMock.signInWithCustomToken).not.toHaveBeenCalled();
  });
});

describe("issueFreshAgentCustomToken — 실사용자 세션에서만 발급", () => {
  it("미로그인 → 거부", async () => {
    const result = await issueFreshAgentCustomToken();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no signed-in user");
    expect(missionMock.callable).not.toHaveBeenCalled();
  });

  it("익명 세션 → 거부 (익명 uid 로 토큰 재생산 금지)", async () => {
    missionMock.auth.currentUser = { uid: "anon-uid", isAnonymous: true };
    const result = await issueFreshAgentCustomToken();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("anonymously");
    expect(missionMock.callable).not.toHaveBeenCalled();
  });

  it("실사용자 → callable 발급 + env 갱신", async () => {
    missionMock.auth.currentUser = { uid: "real-user", isAnonymous: false };
    missionMock.callable.mockResolvedValueOnce({
      data: { customToken: "fresh-token", uid: "real-user" },
    });

    const result = await issueFreshAgentCustomToken();

    expect(result).toEqual({
      ok: true,
      customToken: "fresh-token",
      uid: "real-user",
    });
    expect(process.env.MARBLO_FIREBASE_CUSTOM_TOKEN).toBe("fresh-token");
  });

  it("uid 불일치 응답 → 거부 + env 미갱신", async () => {
    missionMock.auth.currentUser = { uid: "real-user", isAnonymous: false };
    missionMock.callable.mockResolvedValueOnce({
      data: { customToken: "fresh-token", uid: "someone-else" },
    });

    const result = await issueFreshAgentCustomToken();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid issueAgentCustomToken response");
    expect(process.env.MARBLO_FIREBASE_CUSTOM_TOKEN).toBeUndefined();
  });

  it("callable 실패 → ok:false 로 흡수 (throw 하지 않음)", async () => {
    missionMock.auth.currentUser = { uid: "real-user", isAnonymous: false };
    missionMock.callable.mockRejectedValueOnce(new Error("deadline exceeded"));

    const result = await issueFreshAgentCustomToken();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("deadline exceeded");
  });
});
