/**
 * Drive OAuth 보조 로직 — 토큰 갱신 응답 파서 · id_token 이메일 추출
 * (티켓 zqNxS9904aeeBEug1uAD).
 *
 * 이 모듈은 electron 의 `shell`(google-oauth 경유)을 정적 임포트하므로 node
 * 환경에서 그대로는 못 돈다 — 저장소 코드가 아니라 순수 함수만 검증하면 되니
 * electron 을 최소 스텁으로 대체한다(레포의 기존 테스트와 같은 방식).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openExternal: async () => undefined },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  },
}));

import {
  DRIVE_AUTH_SCOPE,
  CALENDAR_READONLY_SCOPE,
  DRIVE_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  emailFromIdToken,
  parseRefreshResponse,
  refreshAccessToken,
} from "../../electron/google-drive-auth";

/** 서명 없는 테스트용 JWT(우리는 payload 만 읽는다). */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}

describe("스코프", () => {
  it("읽기 전용 스코프만 요청한다(쓰기 스코프 금지)", () => {
    expect(DRIVE_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    expect(GMAIL_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(CALENDAR_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(DRIVE_AUTH_SCOPE).toContain(DRIVE_READONLY_SCOPE);
    expect(DRIVE_AUTH_SCOPE).toContain(GMAIL_READONLY_SCOPE);
    expect(DRIVE_AUTH_SCOPE).toContain(CALENDAR_READONLY_SCOPE);
    // drive.file / drive(전체 쓰기) 가 섞여 들어오면 최소권한이 깨진다.
    expect(DRIVE_AUTH_SCOPE).not.toMatch(/auth\/drive(\s|$)/);
    expect(DRIVE_AUTH_SCOPE).not.toContain("drive.file");
  });
});

describe("emailFromIdToken", () => {
  it("payload 의 email 을 읽는다", () => {
    expect(emailFromIdToken(fakeIdToken({ email: "a@b.com" }))).toBe("a@b.com");
  });

  it("이메일이 없거나 토큰이 없으면 undefined", () => {
    expect(emailFromIdToken(fakeIdToken({ sub: "1" }))).toBeUndefined();
    expect(emailFromIdToken(undefined)).toBeUndefined();
  });

  it("깨진 JWT 에도 throw 하지 않는다", () => {
    expect(emailFromIdToken("not-a-jwt")).toBeUndefined();
    expect(emailFromIdToken("a.b")).toBeUndefined();
    expect(emailFromIdToken("a.!!!notbase64!!!.c")).toBeUndefined();
  });
});

describe("parseRefreshResponse", () => {
  const NOW = 1_760_000_000_000;

  it("성공하면 만료시각을 now + expires_in 으로 계산한다", () => {
    const result = parseRefreshResponse(
      200,
      { access_token: "AT", expires_in: 3599, scope: "a b" },
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      token: { accessToken: "AT", expiresAt: NOW + 3599 * 1000, scope: "a b" },
    });
  });

  it("expires_in 이 없으면 1시간으로 본다(Google 기본값)", () => {
    const result = parseRefreshResponse(200, { access_token: "AT" }, NOW);
    expect(result.ok && result.token.expiresAt).toBe(NOW + 3600 * 1000);
  });

  it("invalid_grant 는 '재연결' 로 유도한다(일시 오류와 구분)", () => {
    const result = parseRefreshResponse(400, { error: "invalid_grant" }, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("다시 연결");
  });

  it("다른 오류는 원인을 숨기지 않는다", () => {
    const result = parseRefreshResponse(
      500,
      { error: "backend_error", error_description: "서버 오류" },
      NOW,
    );
    expect(!result.ok && result.error).toContain("서버 오류");
  });

  it("200 이어도 access_token 이 없으면 실패다", () => {
    expect(parseRefreshResponse(200, {}, NOW).ok).toBe(false);
  });

  it("응답이 객체가 아니어도 throw 하지 않는다", () => {
    expect(parseRefreshResponse(200, null, NOW).ok).toBe(false);
    expect(parseRefreshResponse(502, "gateway", NOW).ok).toBe(false);
  });
});

describe("refreshAccessToken", () => {
  const NOW = 1_760_000_000_000;
  const client = { clientId: "CID", clientSecret: "CSECRET" };

  it("refresh_token grant 로 POST 하고 client_secret 을 함께 보낸다", async () => {
    let captured: { url: string; body: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, body: String(init.body) };
      return {
        status: 200,
        json: async () => ({ access_token: "AT", expires_in: 3600 }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await refreshAccessToken(client, "RT", fetchImpl, NOW);
    expect(result.ok).toBe(true);
    expect(captured!.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(captured!.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
    expect(body.get("client_id")).toBe("CID");
    expect(body.get("client_secret")).toBe("CSECRET");
  });

  it("client_secret 이 없는 클라이언트면 그 필드를 빼고 보낸다", async () => {
    let body = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return {
        status: 200,
        json: async () => ({ access_token: "AT" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await refreshAccessToken({ clientId: "CID" }, "RT", fetchImpl, NOW);
    expect(new URLSearchParams(body).has("client_secret")).toBe(false);
  });

  it("네트워크 예외는 throw 가 아니라 ok:false 로 접는다", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await refreshAccessToken(client, "RT", fetchImpl, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("ECONNREFUSED");
  });

  it("JSON 이 아닌 응답에도 죽지 않는다", async () => {
    const fetchImpl = (async () => ({
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    const result = await refreshAccessToken(client, "RT", fetchImpl, NOW);
    expect(result.ok).toBe(false);
  });
});
