/**
 * Google Drive 연결(OAuth) — 티켓 zqNxS9904aeeBEug1uAD.
 *
 * ── 설계 결정 ①: 로그인에 얹지 않고 **별도 동의**로 간다 ─────────────────
 * "기존 Firebase Google 로그인에 Drive 스코프를 증분 추가할지, 별도 플로우로 갈지"
 * 가 이 티켓의 첫 갈림길이었다. 결론은 **같은 OAuth client + 별도 동의 시점**이다.
 *
 *  · 로그인 경로(`runGoogleLoopbackOAuth`)는 받은 토큰을 **저장하지 않는다**.
 *    id_token 은 렌더러가 `signInWithCredential` 에 한 번 쓰고 버리고,
 *    refresh_token 은 아예 읽지도 않는다. Drive 는 앱이 나중에 혼자 파일을 읽어야
 *    하므로 장기 refresh_token 보관이 필수라 그 경로를 그대로 못 쓴다.
 *  · 로그인 시점에 Drive 동의를 끼워 넣으면 **Drive 를 안 쓰는 사용자까지**
 *    "내 드라이브 전체 읽기" 동의 화면을 보게 된다. 최소권한 원칙 위반이고,
 *    로그인 전환율에도 직접 손해다.
 *  · 그래도 OAuth 의미의 **incremental authorization 은 지킨다** — 같은 client id
 *    로 2차 authorize 를 하면서 `include_granted_scopes=true` 를 붙인다. 그러면
 *    새 토큰이 기존에 부여된 스코프까지 함께 커버해, 사용자는 이미 준 권한을
 *    다시 묻는 화면을 보지 않는다.
 *
 * ── 설계 결정 ②: loopback 경로 준수 ──────────────────────────────────────
 * dev/패키지 양쪽에서 `signInWithRedirect` 는 Electron 에서 깨진다(google-oauth.ts
 * 머리주석의 실측 이력). 그래서 Drive 동의도 **시스템 브라우저 + 127.0.0.1
 * 루프백 + PKCE**(RFC 8252) 하나로만 간다. 앱 창은 절대 navigate 하지 않는다.
 *
 * ── 설계 결정 ③: 스코프 ─────────────────────────────────────────────────
 * `drive.readonly` 로 시작한다(쓰기 없음). 지식위키는 **사용자가 이미 갖고 있는**
 * 문서를 읽어야 하므로 `drive.file`(앱이 만들거나 피커로 연 파일만)로는 목적을
 * 달성할 수 없다.
 * ★운영 주의: `drive.readonly` 는 Google 분류상 **restricted scope** 라, 앱을
 * 프로덕션(외부 공개)으로 올리려면 OAuth 검증 + CASA 보안평가가 필요하다.
 * Testing 상태(테스트 사용자 100명)에서는 그대로 동작하므로 MVP·도그푸딩엔
 * 문제가 없다. 외부 출시 전에 반드시 별도 트랙으로 다룰 것.
 * `openid email` 을 함께 요청하는 이유는 (a) 어떤 구글 계정으로 연결됐는지
 * UI 에 보여주고 (b) 재동의 때 `login_hint` 로 계정 선택을 건너뛰기 위해서다.
 * 둘 다 이미 로그인에서 부여된 non-sensitive 스코프라 동의 화면이 늘지 않는다.
 *
 * ── 보안 ────────────────────────────────────────────────────────────────
 * 토큰 값은 이 모듈 밖으로 나가지 않는다. 저장은 safeStorage 암호화
 * (`google-drive-token-store.ts`), 로그에는 마스킹된 값조차 남기지 않는다.
 */
import type { SafeStorage } from "electron";
import {
  GOOGLE_TOKEN_ENDPOINT,
  googleDesktopOAuthClient,
  runGoogleLoopbackAuthorization,
  type GoogleDesktopOAuthClient,
} from "./google-oauth";
import {
  getGoogleDriveTokens,
  googleDriveConnectionStatus,
  removeGoogleDriveTokens,
  saveGoogleDriveTokens,
  type GoogleDriveConnectionStatus,
  type GoogleDriveTokens,
} from "./google-drive-token-store";
import {
  createDriveConnector,
  type DriveConnector,
  type DriveFetchLike,
} from "./google-drive-connector";
import {
  createGmailConnector,
  type GmailConnector,
  type GmailFetchLike,
} from "./gmail-connector";
import {
  createCalendarConnector,
  type CalendarConnector,
  type CalendarFetchLike,
} from "./calendar-connector";
import {
  createContactsConnector,
  type ContactsConnector,
  type ContactsFetchLike,
} from "./contacts-connector";
import {
  createSheetsConnector,
  type SheetsConnector,
  type SheetsFetchLike,
} from "./sheets-connector";
import { extractOfficeText } from "./office-text-extract";
import { extractPdfText } from "./pdf-text-extract";

/** Google Workspace 커넥터 스코프. 쓰기는 비파괴 생성 + 명시 확인 발송에 한정한다. */
export const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const CONTACTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/contacts.readonly";
/**
 * 시트 **읽기 전용**. 티켓 qxDMhv5bgZA2nRe7AdPC.
 *
 * ★쓰기 스코프(`spreadsheets`)를 요구하지 않는다 — "새 행이 추가되면" 트리거는
 * 읽기만 하면 되고, 쓰기까지 묶으면 동의 화면이 무거워질 뿐이다.
 * Google 분류상 sensitive scope 이지만 `drive.readonly` 와 달리 restricted 는
 * 아니라 CASA 보안평가 대상이 아니다.
 */
export const SHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

export const GOOGLE_CONNECTOR_READONLY_SCOPES = [
  DRIVE_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  CALENDAR_READONLY_SCOPE,
  CONTACTS_READONLY_SCOPE,
  SHEETS_READONLY_SCOPE,
] as const;

export const GOOGLE_CONNECTOR_WRITE_SCOPES = [
  DRIVE_FILE_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_SEND_SCOPE,
  CALENDAR_EVENTS_SCOPE,
] as const;

/**
 * 연결 성립 시점에 **전량 부여되었는지 검증**하는 목록.
 *
 * ★SHEETS_READONLY_SCOPE 는 여기 없다. 요청(DRIVE_AUTH_SCOPE)에는 넣지만 필수
 * 검증에서는 뺀다 — 이 목록에 넣는 순간, 이미 연결해 둔 기존 사용자가 재연결할
 * 때 시트 동의를 빼면 **연결 자체가 실패**한다. 시트 조건을 쓰지 않는 사용자의
 * 연결을 깨뜨리지 않는 쪽을 택했다. 대신 조용히 두지도 않는다: 설정 패널이
 * drive.status().scopes 에서 이 스코프의 부재를 읽어 "시트 조건을 켜려면 Google
 * 을 다시 연결해야 한다" 고 말하고, 저장 자체를 막는다(assistantTriggerSettings
 * 의 sheets_connector_required).
 */
export const GOOGLE_CONNECTOR_REQUIRED_SCOPES = [
  ...GOOGLE_CONNECTOR_WRITE_SCOPES,
  DRIVE_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  CALENDAR_READONLY_SCOPE,
  CONTACTS_READONLY_SCOPE,
] as const;

/** authorize 에 실제로 보내는 스코프 문자열(위 주석 ③ 참고). */
export const DRIVE_AUTH_SCOPE = `openid email ${GOOGLE_CONNECTOR_READONLY_SCOPES.join(
  " "
)} ${GOOGLE_CONNECTOR_WRITE_SCOPES.join(
  " "
)}`;

/**
 * access_token 을 만료 몇 ms 전에 미리 갱신할지. 네트워크 왕복 + 시계 오차를
 * 흡수하는 여유다 — 이게 없으면 "방금 유효했는데 요청 도중 만료" 401 이 난다.
 */
const REFRESH_SKEW_MS = 2 * 60 * 1000;

const DRIVE_LABELS = {
  okTitle: "Google 커넥터 연결 완료",
  okBody:
    "Marblo 가 Google Drive, Gmail, Calendar, Contacts, Sheets 를 읽을 수 있게 되었습니다. 이 창을 닫고 앱으로 돌아가세요.",
  failTitle: "Google 커넥터 연결 실패",
  failBody: "연결에 실패했습니다. 이 창을 닫고 앱에서 다시 시도해 주세요.",
};

export type DriveConnectResult =
  | { ok: true; status: GoogleDriveConnectionStatus }
  | { ok: false; error: string };

/**
 * id_token(JWT) payload 에서 email 을 읽는다.
 *
 * ★서명 검증을 하지 않는 이유: 이 토큰은 방금 우리가 TLS 로 Google 토큰
 * 엔드포인트에서 **직접** 받아온 것이다(중간자가 없다). 여기서 뽑는 값은 화면
 * 표시와 login_hint 용이지 인가 판단에 쓰지 않는다. 인증 판단은 전적으로
 * Firebase 쪽 `signInWithCredential` 이 한다.
 */
export function emailFromIdToken(
  idToken: string | undefined
): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    if (!payload || typeof payload !== "object") return undefined;
    const email = (payload as { email?: unknown }).email;
    return typeof email === "string" && email ? email : undefined;
  } catch {
    return undefined;
  }
}

/** 토큰 엔드포인트 응답 중 우리가 쓰는 필드. */
export interface RefreshedAccessToken {
  accessToken: string;
  expiresAt: number;
  scope?: string;
}

/**
 * refresh_token 교환 응답 파서(순수 함수 — 유닛테스트 대상).
 *
 * `now` 를 인자로 받는 이유는 만료시각 계산을 결정적으로 검증하기 위해서다.
 * 실패는 예외가 아니라 `{ ok: false, error }` 로 — 호출자가 "재연결 필요" 를
 * 사용자 문구로 바꿔야 하기 때문이다.
 */
export function parseRefreshResponse(
  status: number,
  body: unknown,
  now: number
): { ok: true; token: RefreshedAccessToken } | { ok: false; error: string } {
  const json =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const accessToken =
    typeof json.access_token === "string" ? json.access_token : "";
  const errorCode = typeof json.error === "string" ? json.error : "";

  if (status !== 200 || !accessToken) {
    // invalid_grant = 사용자가 권한을 철회했거나 refresh_token 이 만료됐다.
    // 이 경우만 "재연결" 로 유도해야 하고, 나머지는 일시 오류일 수 있다.
    if (errorCode === "invalid_grant") {
      return {
        ok: false,
        error:
          "Google Drive 접근 권한이 해제되었습니다. 설정에서 Drive 를 다시 연결해 주세요.",
      };
    }
    const detail =
      typeof json.error_description === "string"
        ? json.error_description
        : errorCode || `HTTP ${status}`;
    return { ok: false, error: `Google 토큰 갱신 실패: ${detail}` };
  }

  const expiresIn =
    typeof json.expires_in === "number" && json.expires_in > 0
      ? json.expires_in
      : 3600;
  return {
    ok: true,
    token: {
      accessToken,
      expiresAt: now + expiresIn * 1000,
      scope: typeof json.scope === "string" ? json.scope : undefined,
    },
  };
}

/** refresh_token → 새 access_token. 네트워크 실패도 ok:false 로 접는다. */
export async function refreshAccessToken(
  client: GoogleDesktopOAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now()
): Promise<
  { ok: true; token: RefreshedAccessToken } | { ok: false; error: string }
> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);
  try {
    const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = await response.json().catch(() => ({}));
    return parseRefreshResponse(response.status, json, now);
  } catch (e) {
    return {
      ok: false,
      error: `Google 토큰 갱신 중 네트워크 오류: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

function missingClientError(): string {
  return (
    "Desktop OAuth client 미설정: VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID 환경변수를 설정하세요. " +
    "(docs/GOOGLE_LOGIN_PACKAGED.md 참고)"
  );
}

/**
 * Drive 연결(사용자 동의). 이미 연결돼 있어도 다시 부르면 재동의한다 —
 * 스코프를 넓혔거나 사용자가 권한을 철회한 뒤의 복구 경로다.
 */
export async function connectGoogleDrive(
  storage: SafeStorage,
  userId: string
): Promise<DriveConnectResult> {
  const client = googleDesktopOAuthClient();
  if (!client) return { ok: false, error: missingClientError() };

  // 이미 연결된 계정이 있으면 그 계정으로 유도한다(계정 선택 화면 생략).
  const existing = getGoogleDriveTokens(storage, userId);

  const result = await runGoogleLoopbackAuthorization({
    client,
    scope: DRIVE_AUTH_SCOPE,
    extraAuthParams: {
      // refresh_token 은 "새로 동의한" 요청에만 딸려온다. 재연결 때도 확실히
      // 받으려면 prompt=consent 가 필요하다(select_account 만으론 못 받는다).
      prompt: "consent",
      access_type: "offline",
      include_granted_scopes: "true",
      ...(existing?.email ? { login_hint: existing.email } : {}),
    },
    labels: DRIVE_LABELS,
  });

  if (!result.ok) return { ok: false, error: result.error };

  const { refreshToken, accessToken, expiresInSeconds, scope, idToken } =
    result.tokens;

  if (!refreshToken) {
    return {
      ok: false,
      error:
        "Google 이 refresh token 을 주지 않아 연결을 유지할 수 없습니다. " +
        "구글 계정의 '보안 → 타사 앱' 에서 Marblo 접근을 제거한 뒤 다시 시도해 주세요.",
    };
  }
  // 사용자가 동의 화면에서 Drive 체크를 해제할 수 있다. 그 경우 토큰은 오지만
  // Drive 는 못 읽는다 — 여기서 잡지 않으면 나중에 알 수 없는 403 으로 나온다.
  const grantedScopes = scope ? scope.split(/\s+/) : [];
  const missingScopes = GOOGLE_CONNECTOR_REQUIRED_SCOPES.filter(
    (requiredScope) => !grantedScopes.includes(requiredScope)
  );
  if (scope && missingScopes.length > 0) {
    return {
      ok: false,
      error:
        "Google 커넥터 권한이 모두 부여되지 않았습니다. 동의 화면에서 Drive, Gmail, Calendar, Contacts 항목을 허용해 주세요.",
    };
  }

  const now = Date.now();
  const tokens: GoogleDriveTokens = {
    refreshToken,
    accessToken,
    accessTokenExpiresAt: expiresInSeconds
      ? now + expiresInSeconds * 1000
      : undefined,
    scope,
    email: emailFromIdToken(idToken) ?? existing?.email,
    connectedAt: now,
  };

  try {
    saveGoogleDriveTokens(storage, userId, tokens);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // ★로그에 토큰이 절대 안 들어가도록 값 없는 사실만 남긴다.
  console.log("[google-connectors] 연결됨", {
    userId,
    scopes: scope ? scope.split(/\s+/).length : 0,
  });
  return { ok: true, status: googleDriveConnectionStatus(storage, userId) };
}

/** 연결 해제. 로컬 토큰만 지운다(구글 쪽 grant 철회는 사용자 계정 설정에서). */
export function disconnectGoogleDrive(
  storage: SafeStorage,
  userId: string
): { ok: boolean; error?: string } {
  try {
    removeGoogleDriveTokens(storage, userId);
    console.log("[google-connectors] 연결 해제됨", { userId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function driveConnectionStatus(
  storage: SafeStorage,
  userId: string
): GoogleDriveConnectionStatus {
  return googleDriveConnectionStatus(storage, userId);
}

/** Drive 가 연결되지 않았거나 권한이 끊긴 상태. 호출자가 재연결로 유도한다. */
export class DriveNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveNotConnectedError";
  }
}

/**
 * 유효한 access token 을 돌려준다. 캐시가 살아 있으면 그대로, 아니면 refresh 해서
 * 저장까지 갱신한다.
 */
export async function getDriveAccessToken(
  storage: SafeStorage,
  userId: string,
  now: number = Date.now()
): Promise<string> {
  const tokens = getGoogleDriveTokens(storage, userId);
  if (!tokens) {
    throw new DriveNotConnectedError(
      "Google Drive 가 연결되어 있지 않습니다. 설정에서 Drive 를 연결해 주세요."
    );
  }
  if (
    tokens.accessToken &&
    tokens.accessTokenExpiresAt &&
    tokens.accessTokenExpiresAt - REFRESH_SKEW_MS > now
  ) {
    return tokens.accessToken;
  }

  const client = googleDesktopOAuthClient();
  if (!client) throw new DriveNotConnectedError(missingClientError());

  const refreshed = await refreshAccessToken(
    client,
    tokens.refreshToken,
    fetch,
    now
  );
  if (!refreshed.ok) throw new DriveNotConnectedError(refreshed.error);

  try {
    saveGoogleDriveTokens(storage, userId, {
      ...tokens,
      accessToken: refreshed.token.accessToken,
      accessTokenExpiresAt: refreshed.token.expiresAt,
      scope: refreshed.token.scope ?? tokens.scope,
    });
  } catch {
    // 저장에 실패해도 이번 요청은 진행한다 — 다음 호출이 다시 refresh 할 뿐이다.
  }
  return refreshed.token.accessToken;
}

/**
 * 이 사용자의 Drive 커넥터. 토큰 갱신은 커넥터가 매 요청 `getAccessToken` 을
 * 부를 때 위 함수가 알아서 한다.
 */
export function createUserDriveConnector(
  storage: SafeStorage,
  userId: string,
  fetchImpl?: DriveFetchLike
): DriveConnector {
  return createDriveConnector({
    getAccessToken: () => getDriveAccessToken(storage, userId),
    extractPdfText,
    extractOfficeText,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function createUserGmailConnector(
  storage: SafeStorage,
  userId: string,
  fetchImpl?: GmailFetchLike
): GmailConnector {
  return createGmailConnector({
    getAccessToken: () => getDriveAccessToken(storage, userId),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function createUserCalendarConnector(
  storage: SafeStorage,
  userId: string,
  fetchImpl?: CalendarFetchLike
): CalendarConnector {
  return createCalendarConnector({
    getAccessToken: () => getDriveAccessToken(storage, userId),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function createUserContactsConnector(
  storage: SafeStorage,
  userId: string,
  fetchImpl?: ContactsFetchLike
): ContactsConnector {
  return createContactsConnector({
    getAccessToken: () => getDriveAccessToken(storage, userId),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export function createUserSheetsConnector(
  storage: SafeStorage,
  userId: string,
  fetchImpl?: SheetsFetchLike
): SheetsConnector {
  return createSheetsConnector({
    getAccessToken: () => getDriveAccessToken(storage, userId),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
