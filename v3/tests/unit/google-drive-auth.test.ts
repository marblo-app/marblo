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
  CONTACTS_READONLY_SCOPE,
  GOOGLE_CONNECTOR_REQUIRED_SCOPES,
  SHEETS_READONLY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  DRIVE_FILE_SCOPE,
  DRIVE_READONLY_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  emailFromIdToken,
  parseRefreshResponse,
  refreshAccessToken,
} from "../../electron/google-drive-auth";
import {
  WITHHELD_RESTRICTED_SCOPES,
  legacyRestrictedScopes,
  restrictedScopesIn,
  withheldCapabilityError,
} from "../../electron/google-restricted-scopes";

/** 서명 없는 테스트용 JWT(우리는 payload 만 읽는다). */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}

describe("스코프", () => {
  it("스코프 상수의 문자열 값이 고정돼 있다", () => {
    expect(DRIVE_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(GMAIL_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(GMAIL_COMPOSE_SCOPE).toBe(
      "https://www.googleapis.com/auth/gmail.compose",
    );
    expect(GMAIL_SEND_SCOPE).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(CALENDAR_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(CALENDAR_EVENTS_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.events",
    );
    expect(CONTACTS_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/contacts.readonly",
    );
  });

  it("★restricted 스코프 셋은 동의 화면에 보내지 않는다 (티켓 v5Phjv1WxndUpgFJyrIn)", () => {
    // 콘솔에서도 같은 셋을 지웠다. 코드가 계속 요청하면 동의 화면 자체가
    // 에러로 뜨고 사용자는 연결을 아예 못 한다 — 이 테스트가 그 회귀를 막는다.
    expect(WITHHELD_RESTRICTED_SCOPES).toEqual([
      DRIVE_READONLY_SCOPE,
      GMAIL_READONLY_SCOPE,
      GMAIL_COMPOSE_SCOPE,
    ]);
    expect(restrictedScopesIn(DRIVE_AUTH_SCOPE)).toEqual([]);
    for (const scope of WITHHELD_RESTRICTED_SCOPES) {
      expect(DRIVE_AUTH_SCOPE).not.toContain(scope);
    }
  });

  it("남긴 것은 openid·email + 아직 회수 전인 민감 스코프 다섯뿐이다", () => {
    expect(DRIVE_AUTH_SCOPE.split(/\s+/).filter(Boolean)).toEqual([
      "openid",
      "email",
      CALENDAR_READONLY_SCOPE,
      CONTACTS_READONLY_SCOPE,
      SHEETS_READONLY_SCOPE,
      GMAIL_SEND_SCOPE,
      CALENDAR_EVENTS_SCOPE,
    ]);
    // drive.file 은 non-sensitive 라 검증 심사 제거에는 기여하지 않는다. 다만
    // 유일한 소비자 drive_write 가 이미 잠겨 있어 최소권한으로 동의 화면에서 뺀다.
    expect(DRIVE_AUTH_SCOPE).not.toContain(DRIVE_FILE_SCOPE);
    expect(GOOGLE_CONNECTOR_REQUIRED_SCOPES).not.toContain(DRIVE_FILE_SCOPE);
    // drive(전체 쓰기) 와 시트 쓰기는 예전부터 요청하지 않는다.
    expect(DRIVE_AUTH_SCOPE).not.toMatch(/auth\/drive(\s|$)/);
    expect(DRIVE_AUTH_SCOPE).not.toMatch(/auth\/spreadsheets(\s|$)/);
  });

  it("★시트 스코프는 연결 필수 검증 목록에 넣지 않는다", () => {
    // 넣으면 이미 연결해 둔 기존 사용자가 재연결할 때 시트 동의를 빼는 순간
    // 연결 자체가 실패한다. 시트를 안 쓰는 사용자의 연결을 깨뜨리지 않는다.
    // 대신 설정 패널이 스코프 부재를 읽어 시트 조건 저장을 막는다.
    expect(GOOGLE_CONNECTOR_REQUIRED_SCOPES).not.toContain(
      SHEETS_READONLY_SCOPE,
    );
    for (const scope of [
      GMAIL_SEND_SCOPE,
      CALENDAR_EVENTS_SCOPE,
      CALENDAR_READONLY_SCOPE,
      CONTACTS_READONLY_SCOPE,
    ]) {
      expect(GOOGLE_CONNECTOR_REQUIRED_SCOPES).toContain(scope);
    }
  });

  it("★필수 검증 목록에도 restricted 가 남으면 안 된다", () => {
    // 남겨두면 콘솔 변경 이후의 **새 연결이 전부** "필수 스코프 미부여" 로
    // 실패한다. 기존 사용자의 넓은 토큰은 상위집합이라 어느 쪽이든 통과한다.
    for (const scope of WITHHELD_RESTRICTED_SCOPES) {
      expect(GOOGLE_CONNECTOR_REQUIRED_SCOPES).not.toContain(scope);
    }
  });
});

describe("보류된 기능 — 조용히 실패하지 않는다", () => {
  const capabilities = [
    "drive_read",
    "drive_write",
    "drive_binding",
    "gmail_read",
    "gmail_draft",
    "gmail_trigger",
  ] as const;

  it("여섯 기능 모두 사용자가 읽을 수 있는 이유를 돌려준다", () => {
    for (const capability of capabilities) {
      const result = withheldCapabilityError(capability);
      expect(result).not.toBeNull();
      expect(result?.ok).toBe(false);
      // 문구 규율: 무엇이 / 왜 / 대신 무엇을. 최소한 "왜" 가 들어 있어야 한다.
      expect(result?.error).toContain("restricted");
      expect(result?.error).toContain("사용할 수 없습니다");
      expect((result?.error ?? "").length).toBeGreaterThan(60);
    }
  });

  it("Drive 읽기의 대안으로 로컬 위키를 가리킨다", () => {
    const error = withheldCapabilityError("drive_read")?.error ?? "";
    expect(error).toContain("wiki_query");
    expect(error).toContain("docs/wiki");
  });

  it("gmail_draft 는 앱 안에서 확인 후 발송하는 경로를 가리킨다", () => {
    const error = withheldCapabilityError("gmail_draft")?.error ?? "";
    expect(error).toContain("gmail_send");
  });

  /**
   * ★sheets_trigger 는 위 여섯과 문구 뼈대가 **일부러 다르다**.
   *
   * 여섯은 restricted 때문에 막혔고 대체가 없어서 "지금은 못 쓴다" 로 끝난다.
   * 이건 sensitive 회수(설계 §3.5)이고 대체가 **이미 배선돼 있어서** "어디로
   * 가면 된다" 로 끝나야 한다. "권한이 없다" 로 읽히면 사용자는 없는 연결을
   * 찾아다닌다 — 이 테스트가 그 회귀를 막는다.
   */
  it("sheets_trigger 는 '권한 부족' 이 아니라 'Apps Script 로 바뀌었다' 로 안내한다", () => {
    const error = withheldCapabilityError("sheets_trigger")?.error ?? "";
    expect(error).toContain("Apps Script");
    expect(error).toContain("Webhook");
    expect(error).toContain("sensitive");
    // 대체가 있다는 사실이 문장 안에 있어야 한다.
    expect(error).toContain("기능이 사라진 것은 아닙니다");
    // 플랫폼 무관하다는 것이 이 대체의 값이다(설계 §6.1).
    expect(error).toContain("Windows");
    // ★"다시 연결" 로 유도하지 않는다.
    expect(error).not.toContain("다시 연결");
  });
});

describe("기존 사용자 — 넓은 토큰은 두되 쓰지 않는다", () => {
  it("저장된 토큰이 아직 restricted 를 들고 있으면 진단으로 드러난다", () => {
    expect(
      legacyRestrictedScopes([
        "openid",
        DRIVE_READONLY_SCOPE,
        GMAIL_SEND_SCOPE,
        GMAIL_READONLY_SCOPE,
      ]),
    ).toEqual([DRIVE_READONLY_SCOPE, GMAIL_READONLY_SCOPE]);
  });

  it("★그래도 게이트는 토큰을 묻지 않는다 — 넓은 토큰이어도 막힌다", () => {
    // 재연결을 강제하지 않는 대신, restricted 데이터를 다루는 행위 자체를
    // 앱에서 막는다. 이 테스트가 "토큰에 있으면 쓴다" 로의 회귀를 막는다.
    expect(withheldCapabilityError("gmail_read")).not.toBeNull();
    expect(withheldCapabilityError("drive_read")).not.toBeNull();
  });

  it("새로 연결한 사용자의 스코프 집합은 필수 검증을 통과한다", () => {
    const granted = new Set(DRIVE_AUTH_SCOPE.split(/\s+/).filter(Boolean));
    for (const scope of GOOGLE_CONNECTOR_REQUIRED_SCOPES) {
      expect(granted.has(scope)).toBe(true);
    }
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
