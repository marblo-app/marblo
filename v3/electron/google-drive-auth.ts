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
 * ── 설계 결정 ③: 스코프 — ★restricted 를 전부 뺐다 (티켓 v5Phjv1WxndUpgFJyrIn)
 * 원래 이 커넥터는 `drive.readonly` 로 시작했다. 지식위키가 **사용자가 이미 갖고
 * 있는** 문서를 읽어야 해서 `drive.file`(앱이 만들거나 피커로 연 파일만)로는
 * 목적을 달성할 수 없었기 때문이다. 그 판단 자체는 여전히 맞다 — 바뀐 것은
 * 가격표다.
 *
 * `drive.readonly` · `gmail.readonly` · `gmail.compose` 는 셋 다 Google 분류상
 * **restricted** 이고, 하나라도 요청하면 외부 공개 시 **CASA 보안평가**(유료 ·
 * 연 1회 갱신)가 따라붙는다. 일본 출시 일정을 그 심사에 걸 수 없다는 판단으로
 * 셋을 모두 뺐다. 남는 것은 sensitive 여섯 + non-sensitive 둘이다:
 *
 *   sensitive     drive.file · gmail.send · calendar.readonly · calendar.events ·
 *                 contacts.readonly · spreadsheets.readonly
 *   non-sensitive openid · email
 *
 * ★`gmail.compose` 가 sensitive 라는 통념은 틀렸다. Gmail 에서 sensitive 인 것은
 * `gmail.send` 와 addons 계열뿐이고, readonly · compose · metadata · modify ·
 * insert 는 전부 restricted 다. Drive 도 마찬가지로 `drive.file` 만 sensitive 고
 * readonly/metadata 계열은 전부 restricted 다.
 *
 * 빠진 스코프와 그 때문에 잠긴 기능, 사용자에게 보일 문구는 전부
 * `google-restricted-scopes.ts` 한 곳에 모여 있다. ★삭제가 아니라 **보류**다 —
 * 런칭 후 CASA 를 별도 트랙으로 밟아 되살린다.
 *
 * `openid email` 을 함께 요청하는 이유는 (a) 어떤 구글 계정으로 연결됐는지
 * UI 에 보여주고 (b) 재동의 때 `login_hint` 로 계정 선택을 건너뛰기 위해서다.
 * 둘 다 이미 로그인에서 부여된 non-sensitive 스코프라 동의 화면이 늘지 않는다.
 *
 * ── ★기존 사용자: 재연결을 강제하지 않는다 ───────────────────────────────
 * 콘솔에서 스코프를 지워도 이미 발급된 refresh_token 은 넓은 스코프를 그대로
 * 유지한다(구글은 소급 철회를 하지 않는다). 그래도 강제 재연결은 하지 않는다:
 *   · 강제하면 아직 잘 도는 Calendar · Contacts · Sheets · 메일 발송까지 한 번에
 *     끊기고, 얻는 것은 없다.
 *   · restricted 기능을 막는 일은 토큰이 아니라 **앱 쪽 게이트**가 한다
 *     (`withheldCapabilityError`). 토큰이 무엇을 부여받았는지 묻지 않고 막으므로,
 *     기존 토큰의 넓이는 그냥 무해하게 잠든다.
 *   · 반대로 `GOOGLE_CONNECTOR_REQUIRED_SCOPES` 에서는 셋을 **반드시** 빼야 한다.
 *     남겨두면 콘솔 변경 이후의 **새 연결이 전부** "필수 스코프 미부여" 로 실패한다.
 *     기존 사용자의 넓은 토큰은 상위집합이라 그대로 통과한다.
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

/**
 * 보류한 restricted 스코프. **요청하지 않지만 상수는 남긴다** — 되살릴 때
 * 필요하고, 기존 토큰이 아직 들고 있는 값을 진단할 때도 필요하다.
 * 정의는 `google-restricted-scopes.ts` 한 곳이고 여기서는 다시 내보내기만 한다.
 */
export {
  DRIVE_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  WITHHELD_RESTRICTED_SCOPES,
} from "./google-restricted-scopes";

/**
 * Google Workspace 커넥터 스코프 — ★여기 있는 것은 **전부 sensitive** 다.
 * 쓰기는 비파괴 생성 + 명시 확인 발송에 한정한다.
 *
 * restricted 셋(`drive.readonly` · `gmail.readonly` · `gmail.compose`)은 이
 * 파일에 없다. 위에서 `google-restricted-scopes.ts` 의 것을 다시 내보내기만 한다.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
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
 * Google 분류상 sensitive scope 이지만 readonly 계열 restricted 스코프와 달리
 * CASA 보안평가 대상이 아니다 — 그래서 이번 정리에서도 그대로 남는다.
 */
export const SHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

/**
 * 요청하는 **읽기** 스코프. Drive · Gmail 읽기는 restricted 라 여기 없다 —
 * 남은 셋은 전부 sensitive 다.
 */
export const GOOGLE_CONNECTOR_READONLY_SCOPES = [
  CALENDAR_READONLY_SCOPE,
  CONTACTS_READONLY_SCOPE,
  SHEETS_READONLY_SCOPE,
] as const;

/**
 * 요청하는 **쓰기** 스코프. `gmail.compose` 는 restricted 라 빠졌다 —
 * 초안은 이제 Gmail 초안함이 아니라 Marblo 화면에서 만들고, 사용자가 확인하면
 * `gmail.send` 로 나간다(docs/GMAIL_DRAFT_REPLACEMENT.md).
 */
export const GOOGLE_CONNECTOR_WRITE_SCOPES = [
  DRIVE_FILE_SCOPE,
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
 *
 * ★restricted 셋도 반드시 여기 없어야 한다. 남겨두면 콘솔에서 스코프를 지운
 * 뒤의 **새 연결이 전부** "필수 스코프 미부여" 로 실패한다. 기존 사용자의 넓은
 * 토큰은 상위집합이라 어느 쪽이든 통과하므로, 이 목록은 새 사용자를 기준으로
 * 잡는 게 맞다.
 */
export const GOOGLE_CONNECTOR_REQUIRED_SCOPES = [
  ...GOOGLE_CONNECTOR_WRITE_SCOPES,
  CALENDAR_READONLY_SCOPE,
  CONTACTS_READONLY_SCOPE,
] as const;

/**
 * authorize 에 실제로 보내는 스코프 문자열(위 주석 ③ 참고).
 *
 * ★이름은 `DRIVE_AUTH_SCOPE` 그대로 두었다. 내용은 이미 Drive 를 넘어선 Google
 * Workspace 커넥터 전체의 동의 문자열이지만, 이 상수명은 검증 기준·회귀 테스트·
 * 운영 런북에서 고유명사처럼 참조되고 있다. 지금 개명하면 얻는 것은 이름의
 * 정확도 하나이고 잃는 것은 그 참조들의 연결이라, 정확도는 이 주석이 대신 진다.
 *
 * ★이 문자열에 restricted 스코프가 섞이면 동의 화면 자체가 에러로 뜬다(콘솔에서
 * 지운 스코프를 요청하는 셈이라). `restrictedScopesIn()` 으로 검사하는 회귀
 * 테스트가 tests/unit/google-drive-auth.test.ts 에 있다.
 */
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
  // ★약속한 것만 적는다. Drive 문서 읽기와 Gmail 메일 읽기는 이번 출시에서
  //   요청하지 않는 권한이므로 여기서도 말하지 않는다(CONVENTION 정직성 조항).
  okBody:
    "Marblo 가 Calendar 와 Contacts, 스프레드시트를 조회하고, 확인하신 메일을 발송할 수 있게 되었습니다. 이 창을 닫고 앱으로 돌아가세요.",
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
