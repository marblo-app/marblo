/**
 * google-restricted-scopes — **요청하지 않기로 한 restricted 스코프**와, 그
 * 결정 때문에 지금 쓸 수 없게 된 기능들의 단일 진실원. 티켓 v5Phjv1WxndUpgFJyrIn.
 *
 * ── 왜 이 파일이 생겼나 ──────────────────────────────────────────────────
 * Google 은 OAuth 스코프를 non-sensitive / sensitive / **restricted** 셋으로
 * 나눈다. restricted 가 하나라도 섞이면 앱을 외부 공개로 올릴 때 **CASA 보안평가**
 * (유료 · 연 1회 갱신)가 따라붙는다. 일본 런칭 일정을 그 심사에 걸 수 없다는
 * 판단으로, 우리는 restricted 를 **전부 뺐다**. 이후 T2 에서 sensitive 도 전부 뺐다.
 *
 * 먼저 빠진 셋(공식 분류 재확인 결과 셋 다 restricted 다):
 *   · `drive.readonly`   — Drive 는 `drive.file` 만 non-sensitive 고 readonly/metadata
 *                          계열은 전부 restricted 다.
 *   · `gmail.readonly`
 *   · `gmail.compose`    — ★sensitive 가 아니다. Gmail 에서 sensitive 인 것은
 *                          `gmail.send` 와 addons 계열뿐이고, readonly · compose ·
 *                          metadata · modify · insert 는 restricted 다.
 *
 * ── ★삭제가 아니라 보류다 ────────────────────────────────────────────────
 * 런칭 후 CASA 를 별도 트랙으로 밟아 되살릴 것이다. 그래서 스코프 상수도,
 * 이 스코프에 의존하던 코드(Drive 폴더 바인딩·스코프 해석기·커넥터)도 **지우지
 * 않는다.** 되살릴 때 필요한 것은 이 파일의 목록에서 스코프를 옮기고 게이트를
 * 걷어내는 일뿐이어야 한다.
 *
 * ── ★게이트는 토큰이 아니라 앱에 건다 ────────────────────────────────────
 * 콘솔에서 스코프를 지워도 **이미 저장된 refresh_token 은 넓은 스코프를 그대로
 * 갖고 있다.** 구글은 소급 철회를 하지 않는다. 그러니 "토큰에 스코프가 있으면
 * 쓴다" 로 두면, 기존 사용자에 한해 우리는 여전히 restricted 데이터를 다루는
 * 앱이 된다 — CASA 가 규율하려는 바로 그 행위다. 그래서 이 게이트는 토큰이
 * 무엇을 부여받았는지 **묻지 않고** 무조건 막는다. 기존 토큰의 넓이는 그냥
 * 무해하게 잠든다.
 *
 * ── ★후속 결정: sensitive 도 0 으로 간다 (티켓 5UI2a7MsD75QqgRB8icV) ─────
 * restricted 를 뺐다고 심사가 끝난 게 아니다. 앱을 게시할 때 붙는 **검증 심사**
 * (스코프마다 데모 영상 · 도메인 소유권 · 브랜드 검증 · 정책 개정)는 "sensitive
 * **또는** restricted 를 요청하는 경우" 에 발동한다. 6개를 1개로 줄여도 심사는
 * 통째로 그대로 붙는다 — **0 만이 심사를 없앤다.** 그래서 남은 sensitive 5개도
 * 뺐다. `drive.file` 은 non-sensitive 라 검증 심사 제거에는 기여하지 않지만,
 * 유일한 소비자 `drive_write` 가 이미 잠겨 있어 아무 능력도 사주지 않는 스코프를
 * 동의 화면에 남기지 않는 최소권한 정리로 먼저 보류했다. 이제 Google 커넥터에
 * 남는 요청은 로그인용 `openid` · `email` 뿐이다.
 *
 * 판정과 대체 경로는 `docs/GOOGLE_SCOPE_ZERO_DESIGN.md` 가 원본이고, 이 파일은
 * 그 결론의 목록만 든다(아래 `WITHHELD_SENSITIVE_SCOPES`).
 *
 * ★이 파일의 위 두 원칙은 sensitive 회수에도 그대로 간다. 삭제가 아니라 보류이고,
 * 게이트는 토큰이 아니라 앱에 무조건 건다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 조용히 401 을 내지 않는다. 막힌 기능은 (a) 무엇을 못 하는지 (b) 왜 못 하는지
 * (c) 대신 무엇을 쓰면 되는지를 **한 문장 안에서** 말한다. 기능이 사라진 게
 * 아니라 "지금은 못 쓴다" 는 것이 사용자에게 전달돼야 한다.
 */

/** Drive — restricted. `drive.file` 만 non-sensitive 다. */
export const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
/** Gmail — restricted. */
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
/** Gmail — ★restricted. sensitive 가 아니다(공식 분류 확인). */
export const GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
/**
/** Gmail — sensitive. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Calendar — sensitive. */
export const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
/** Calendar — sensitive. */
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
/** Contacts — sensitive. */
export const CONTACTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/contacts.readonly";
/** Sheets — sensitive. */
export const SPREADSHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

/**
 * 동의 화면에서 **요청하지 않는** restricted 스코프.
 *
 * 이 배열은 두 곳에서 읽힌다: (1) `DRIVE_AUTH_SCOPE` 를 만들 때 "여기 있는 것은
 * 절대 넣지 않는다" 는 회귀 테스트의 기준, (2) 저장된 토큰이 아직 넓은지
 * 진단할 때의 조회 목록. 콘솔에서 지운 목록과 이 배열이 같아야 한다.
 */
export const WITHHELD_RESTRICTED_SCOPES = [
  DRIVE_READONLY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_COMPOSE_SCOPE,
] as const;

/**
 * 동의 화면에서 **요청하지 않는** sensitive 스코프.
 *
 * 이 배열은 T2 의 집행 결과다. 콘솔에서도 같은 다섯을 지우고, 요청 문자열과
 * 필수 검증 목록에서도 빠져야 한다. 기존 refresh_token 이 이 스코프를 아직
 * 들고 있어도 앱 게이트가 아래 capability 를 무조건 막으므로 사용하지 않는다.
 */
export const WITHHELD_SENSITIVE_SCOPES = [
  CALENDAR_READONLY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  CONTACTS_READONLY_SCOPE,
  SPREADSHEETS_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
] as const;

/**
 * ★회수한 sensitive 스코프.
 *
 * 설계 원본은 `docs/GOOGLE_SCOPE_ZERO_DESIGN.md` 다. 여기 있는 것은 그 문서의
 * 판정을 코드가 들고 있는 형태다. 삭제하지 않는 이유는 #1267 의 규율 때문이다:
 * 되살릴 때 이 목록과 `WITHHELD_CAPABILITIES` 에서 빼고, 요청 목록에 다시 넣으면
 * 된다. 구현 코드는 각 호출 지점 아래에 그대로 남아 컴파일러가 계속 본다.
 */
export interface WithheldSensitiveScope {
  /** 회수할 스코프. */
  readonly scope: string;
  /** 이 스코프가 지금 사주고 있는 것 — 빠지면 무엇이 멈추는지. */
  readonly buys: string;
  /** 무엇으로 대신하나. */
  readonly replacement: string;
  /**
   * 대체 경로가 도는 플랫폼.
   *  · "all"     — 플랫폼 무관
   *  · "darwin"  — macOS 전용. ★Windows/Linux 사용자는 능력을 잃는다.
   *                조용히 없는 것처럼 보이면 안 된다(CONVENTION 정직성 조항) —
   *                문구는 후속 티켓의 `platform-capabilities` 가 든다.
   *  · "none"    — 대체하지 않는다. 그냥 잃는다.
   */
  readonly availableOn: "all" | "darwin" | "none";
}

export const WITHHELD_SENSITIVE_WITHDRAWAL_DETAILS: readonly WithheldSensitiveScope[] =
  [
    {
      // ★회수 비용 0. `drive.file` 은 non-sensitive 라 검증 심사 제거에는
      // 기여하지 않는다. 유일한 소비자 `drive_write` 가 이미 WITHHELD_CAPABILITIES
      // 로 잠겨 있어, 아무 능력도 사주지 않는 스코프를 동의 화면에 남기지 않는
      // 최소권한 정리다.
      scope: "https://www.googleapis.com/auth/drive.file",
      buys: "drive_write — 이미 잠김. 잃는 기능 0.",
      replacement: "로컬 위키(defaultWikiRootPath) · 노션 커넥터(자체 OAuth)",
      availableOn: "all",
    },
    {
      scope: CALENDAR_READONLY_SCOPE,
      buys: "calendar_list · 비서 일정 트리거",
      replacement: "애플 캘린더 (JXA → Calendar.app)",
      availableOn: "darwin",
    },
    {
      scope: CALENDAR_EVENTS_SCOPE,
      buys: "calendar_create · calendar_patch",
      replacement: "애플 캘린더 (JXA → Calendar.app)",
      availableOn: "darwin",
    },
    {
      // 대체가 둘이라 한 줄로 못 적는다. Resend 는 크로스플랫폼이지만 우리
      // 도메인에서 나가고, 애플 메일은 macOS 전용이지만 ★사용자 본인 주소로
      // 나가고 ★메일 읽기까지 돌려준다(gmail.readonly 를 포기하며 잃은 것).
      // 그래서 availableOn 은 "발송은 어디서나 된다" 를 기준으로 "all" 이다 —
      // 읽기가 macOS 전용이라는 사실은 설계 문서 §6.1 의 능력표가 든다.
      scope: GMAIL_SEND_SCOPE,
      buys: "gmail_send (confirm=true 2단계 계약)",
      replacement:
        "애플 메일(macOS · 내 주소로 발송 + 메일 읽기 복원) / Resend(크로스플랫폼 · 우리 도메인)",
      availableOn: "all",
    },
    {
      // 내부 소비자가 0 이고(에이전트 도구뿐), 자동화 대상 앱이 늘 때마다 TCC
      // 승인 팝업이 하나씩 는다. 거의 안 쓰는 기능에 세 번째 팝업을 쓰면 정작
      // 중요한 Calendar·Mail 승인률이 떨어진다. 그래서 대체하지 않고 비워 둔다.
      scope: CONTACTS_READONLY_SCOPE,
      buys: "contacts_search — 내부 소비자 0",
      replacement: "없음. 이름 대신 이메일 주소를 직접 받는다(설계 문서 §3.4)",
      availableOn: "none",
    },
    {
      // ★플랫폼 무관한 유일한 대체다. Apps Script 는 사용자의 구글 계정 안에서
      // 구글이 돌리므로 우리 앱의 플랫폼과 무관하다. 웹훅은 이미 서버에 있다
      // (#1256) — 다시 만들지 않는다.
      scope: SPREADSHEETS_READONLY_SCOPE,
      buys: "비서 시트 새 행 트리거",
      replacement: "Apps Script(시간 구동·배치) → 기존 assistantWebhook",
      availableOn: "all",
    },
  ] as const;

/**
 * restricted 스코프가 빠지면서 지금 쓸 수 없게 된 기능들.
 *
 * 티켓이 넷을 지목했고(`drive_read` · `drive_binding` · `gmail_read` ·
 * `gmail_draft`), 코드를 따라가며 둘을 더 찾았다:
 *   · `drive_write` — 스코프는 `drive.file` 로 살아 있지만, 목적지인 **프로젝트
 *     위키 폴더**가 사용자 소유 폴더다. `drive.file` 로는 앱이 만들지 않은 폴더의
 *     메타데이터조차 못 읽어(404) 바인딩 검증이 성립하지 않는다. 즉 바인딩이
 *     비활성인 동안 이 도구도 같이 잠긴다.
 *   · `gmail_trigger` — 비서 트리거 엔진의 Gmail 폴링이 `gmail.readonly` 를 쓴다.
 *     지금까지는 실패해도 console.error 로만 남아 사용자에게 보이지 않았다.
 */
export type WithheldGoogleCapability =
  | "drive_read"
  | "drive_write"
  | "drive_binding"
  | "gmail_read"
  | "gmail_draft"
  | "gmail_trigger"
  // ★sensitive 회수(T2): 게이트는 토큰 scope 를 보지 않고 앱에 무조건 건다.
  | "gmail_send"
  | "calendar_read"
  | "calendar_write"
  | "calendar_trigger"
  | "contacts_search"
  // ★대체가 이미 있는 sensitive 회수. 문구가 "지금은 못 쓴다" 가 아니라
  // "방식이 바뀌었다" 로 끝난다.
  | "sheets_trigger";

/** 어느 스코프가 빠져서 막혔는지 — 진단·로그용(사용자 문구에는 넣지 않는다). */
export const WITHHELD_CAPABILITY_SCOPE: Readonly<
  Record<WithheldGoogleCapability, string>
> = {
  drive_read: DRIVE_READONLY_SCOPE,
  drive_write: DRIVE_READONLY_SCOPE,
  drive_binding: DRIVE_READONLY_SCOPE,
  gmail_read: GMAIL_READONLY_SCOPE,
  gmail_draft: GMAIL_COMPOSE_SCOPE,
  gmail_trigger: GMAIL_READONLY_SCOPE,
  gmail_send: GMAIL_SEND_SCOPE,
  calendar_read: CALENDAR_READONLY_SCOPE,
  calendar_write: CALENDAR_EVENTS_SCOPE,
  calendar_trigger: CALENDAR_READONLY_SCOPE,
  contacts_search: CONTACTS_READONLY_SCOPE,
  sheets_trigger: SPREADSHEETS_READONLY_SCOPE,
};

/**
 * 사용자·에이전트에게 그대로 보여줄 문장.
 *
 * 전부 같은 뼈대다 — **무엇이 / 왜 / 대신 무엇을**. "권한이 없습니다" 로 끝나면
 * 사용자는 자기가 뭘 잘못했는지 찾다가 시간을 버린다. 여기서 막은 것은 사용자의
 * 실수가 아니라 우리의 결정이므로, 그 사실을 문장이 지고 있어야 한다.
 */
const WITHHELD_CAPABILITY_MESSAGE: Readonly<
  Record<WithheldGoogleCapability, string>
> = {
  drive_read:
    "Google Drive 문서 읽기는 지금 사용할 수 없습니다. " +
    "Drive 전체 읽기 권한(drive.readonly)은 Google 이 restricted 로 분류해 " +
    "별도 보안평가(CASA)를 통과해야 요청할 수 있어, 이번 출시에서는 요청하지 않습니다. " +
    "프로젝트 지식은 로컬 위키 폴더로 사용해 주세요 — wiki_query 에 프로젝트의 " +
    "docs/wiki 경로를 root_path 로 넘기면 같은 지식을 그대로 읽습니다.",
  drive_write:
    "Google Drive 문서 생성은 지금 사용할 수 없습니다. " +
    "만들 위치인 프로젝트 위키 폴더를 확인하려면 Drive 읽기 권한(drive.readonly)이 " +
    "필요한데, 이 권한은 restricted 로 분류돼 이번 출시에서는 요청하지 않습니다. " +
    "문서는 로컬 위키 폴더(docs/wiki)에 파일로 남겨 주세요.",
  drive_binding:
    "이 프로젝트의 Google Drive 위키 폴더 지정은 지금 사용할 수 없습니다. " +
    "폴더를 찾고 그 하위를 읽으려면 Drive 읽기 권한(drive.readonly)이 필요한데, " +
    "이 권한은 restricted 로 분류돼 별도 보안평가(CASA)를 통과해야 요청할 수 있어 " +
    "이번 출시에서는 요청하지 않습니다. 지식위키는 로컬 폴더(프로젝트의 docs/wiki)로 " +
    "그대로 쓸 수 있습니다. 이미 지정해 둔 폴더 정보는 지우지 않고 보관합니다.",
  gmail_read:
    "Gmail 메일 읽기는 지금 사용할 수 없습니다. " +
    "메일 본문 읽기 권한(gmail.readonly)은 Google 이 restricted 로 분류해 " +
    "별도 보안평가(CASA)를 통과해야 요청할 수 있어, 이번 출시에서는 요청하지 않습니다. " +
    "메일 발송은 이제 gmail_send 가 아니라 mail_send 로 합니다. 일정과 연락처 기능은 지금은 쓸 수 없습니다.",
  gmail_draft:
    "Gmail 초안함에 초안을 만드는 기능은 지금 사용할 수 없습니다. " +
    "초안 작성 권한(gmail.compose)은 Google 이 restricted 로 분류해 이번 출시에서는 " +
    "요청하지 않습니다. 대신 초안을 Marblo 안에서 보여 드리고, 확인하시면 " +
    "mail_send 로 발송합니다 — 검토 단계가 Gmail 이 아니라 앱에서 일어날 뿐입니다.",
  gmail_trigger:
    "새 메일 감지 트리거는 지금 사용할 수 없습니다. " +
    "받은 메일을 읽으려면 gmail.readonly 권한이 필요한데, 이 권한은 restricted 로 " +
    "분류돼 이번 출시에서는 요청하지 않습니다. 시간 트리거는 그대로 동작하고, " +
    "스프레드시트 새 행 감지는 이제 Webhook 조건의 Apps Script 로 합니다.",
  gmail_send:
    "Gmail API 발송은 지금 사용할 수 없습니다. " +
    "메일 발송 권한(gmail.send)은 Google 이 sensitive 로 분류해, 하나라도 요청하면 " +
    "게시 검증 심사가 통째로 붙습니다. 그래서 요청하지 않습니다. " +
    "메일 발송은 이제 mail_send 로 합니다 — Resend sendAssistantEmail 경로가 확인 후 " +
    "우리 도메인에서 발송하고, 수신자는 현재 서버 정책에 맞게 검증됩니다.",
  calendar_read:
    "Google Calendar 일정 조회는 지금 사용할 수 없습니다. " +
    "캘린더 읽기 권한(calendar.readonly)은 Google 이 sensitive 로 분류해, 하나라도 요청하면 " +
    "게시 검증 심사가 통째로 붙습니다. 그래서 요청하지 않습니다. " +
    "Apple Calendar 대체 경로가 붙기 전까지는 지금은 쓸 수 없습니다.",
  calendar_write:
    "Google Calendar 일정 생성·수정은 지금 사용할 수 없습니다. " +
    "캘린더 쓰기 권한(calendar.events)은 Google 이 sensitive 로 분류해, 하나라도 요청하면 " +
    "게시 검증 심사가 통째로 붙습니다. 그래서 요청하지 않습니다. " +
    "Apple Calendar 대체 경로가 붙기 전까지는 지금은 쓸 수 없습니다.",
  calendar_trigger:
    "일정 트리거는 지금 사용할 수 없습니다. " +
    "임박 일정을 읽으려면 calendar.readonly 권한이 필요한데, 이 권한은 Google 이 sensitive 로 " +
    "분류해 이번 출시에서는 요청하지 않습니다. Apple Calendar 대체 경로가 붙기 전까지는 " +
    "지금은 쓸 수 없습니다. 설정은 지우지 않고 보관합니다.",
  contacts_search:
    "Google Contacts 검색은 지금 사용할 수 없습니다. " +
    "연락처 읽기 권한(contacts.readonly)은 Google 이 sensitive 로 분류해, 하나라도 요청하면 " +
    "게시 검증 심사가 통째로 붙습니다. 이 기능은 내부 소비자가 없어 이번 출시에서는 " +
    "대체하지 않습니다. 지금은 쓸 수 없습니다 — 이름 대신 이메일 주소를 직접 받아 주세요.",
  // ★이 문구만 뼈대가 다르다. 위 다섯은 "지금은 못 쓴다" 로 끝나지만 여기는
  // 대체가 이미 배선돼 있으므로 **어디로 가면 되는지**로 끝난다. 사용자가
  // "연결이 끊겼나" 를 찾아다니게 두지 않는 것이 이 문구의 일이다.
  sheets_trigger:
    "스프레드시트 새 행 감지는 이제 Google Sheets 권한이 아니라 Apps Script 로 동작합니다. " +
    "시트 읽기 권한(spreadsheets.readonly)은 Google 이 sensitive 로 분류해, 하나라도 요청하면 " +
    "게시 검증 심사가 통째로 붙습니다. 그래서 요청하지 않습니다. " +
    "기능이 사라진 것은 아닙니다 — 비서 트리거 설정의 Webhook 조건에서 수신 URL을 발급하면 " +
    "시트에 붙여넣을 Apps Script 를 그대로 만들어 드리고, 그 스크립트가 새 행을 감지해 " +
    "Marblo 를 호출합니다. 이 방식은 Windows 에서도 동작합니다.",
};

/**
 * ★지금 잠겨 있는 기능들 — **되살리는 스위치가 이 집합이다.**
 *
 * 기능 코드는 지우지 않았다(티켓 지시). CASA 를 통과해 스코프를 되찾는 날,
 * 해당 스코프를 `DRIVE_AUTH_SCOPE` 요청 목록에 넣고 여기서 이름을 빼면 경로가
 * 그대로 살아난다. 게이트를 `if (…) return` 형태로 남겨 둔 것도 같은 이유다 —
 * 무조건 return 으로 막으면 그 아래 구현이 죽은 코드가 되어 컴파일러의 감시
 * 밖으로 나가고, 되살릴 때 조용히 썩어 있는 것을 발견하게 된다.
 *
 * 집합으로 둔 이유: 여섯을 한꺼번에 되살릴 이유가 없다. `drive.file` 만으로
 * 되는 경로가 나중에 갈라져 나올 수 있고, 그때 한 줄씩 빼는 게 맞다.
 */
export const WITHHELD_CAPABILITIES: ReadonlySet<WithheldGoogleCapability> =
  new Set<WithheldGoogleCapability>([
    "drive_read",
    "drive_write",
    "drive_binding",
    "gmail_read",
    "gmail_draft",
    "gmail_trigger",
    "gmail_send",
    "calendar_read",
    "calendar_write",
    "calendar_trigger",
    "contacts_search",
    // ★T6 이 켠 잠금. 이 이름을 빼면 폴링 경로(sheets-connector · startSheetsPoll)가
    // 그대로 되살아난다 — 그래서 그 코드를 지우지 않았다.
    "sheets_trigger",
  ]);

export function isCapabilityWithheld(
  capability: WithheldGoogleCapability,
): boolean {
  return WITHHELD_CAPABILITIES.has(capability);
}

/**
 * 막힌 기능의 표준 실패값 — 잠겨 있지 않으면 `null` 이고 호출자는 그대로 진행한다.
 *
 * 이 코드베이스의 커넥터 경로는 전부 `{ ok:false, error }` 로 실패를 접는다
 * (예외를 던지지 않는다) — MCP 도구가 그 문장을 에이전트에게 그대로 보여주기
 * 때문이다. 그 계약을 그대로 따른다.
 */
export function withheldCapabilityError(
  capability: WithheldGoogleCapability,
): { ok: false; error: string } | null {
  if (!WITHHELD_CAPABILITIES.has(capability)) return null;
  return { ok: false, error: WITHHELD_CAPABILITY_MESSAGE[capability] };
}

/** 문구만 필요한 호출자(로그·UI)를 위한 접근자. */
export function withheldCapabilityMessage(
  capability: WithheldGoogleCapability,
): string {
  return WITHHELD_CAPABILITY_MESSAGE[capability];
}

/**
 * 스코프 문자열(동의 화면에 보낼 것)에 restricted 가 섞였는가.
 *
 * ★이 함수는 편의가 아니라 안전장치다. 콘솔에서 지운 스코프를 코드가 계속
 * 요청하면 동의 화면 자체가 에러로 뜨고, 사용자는 연결을 아예 못 한다. 그래서
 * 회귀 테스트가 `DRIVE_AUTH_SCOPE` 를 이 함수로 검사한다.
 */
export function restrictedScopesIn(scopeString: string): string[] {
  const requested = new Set(scopeString.split(/\s+/).filter(Boolean));
  return WITHHELD_RESTRICTED_SCOPES.filter((scope) => requested.has(scope));
}

/** 스코프 문자열(동의 화면에 보낼 것)에 sensitive 회수분이 섞였는가. */
export function sensitiveScopesIn(scopeString: string): string[] {
  const requested = new Set(scopeString.split(/\s+/).filter(Boolean));
  return WITHHELD_SENSITIVE_SCOPES.filter((scope) => requested.has(scope));
}

/**
 * 저장된 토큰이 아직 restricted 스코프를 들고 있는가(진단용).
 *
 * ★있다고 해서 재연결을 강제하지 않는다. 근거는 이 파일 머리주석의 "게이트는
 * 토큰이 아니라 앱에 건다" 항목이다 — 넓은 토큰은 그대로 두되 앱이 쓰지 않는다.
 * 강제 재연결은 아직 도는 non-sensitive 로그인 연결까지 끊고, 얻는 것은 없다.
 */
export function legacyRestrictedScopes(
  grantedScopes: readonly string[],
): string[] {
  const granted = new Set(grantedScopes);
  return WITHHELD_RESTRICTED_SCOPES.filter((scope) => granted.has(scope));
}

/**
 * 저장된 토큰이 아직 회수한 sensitive 스코프를 들고 있는가(진단용).
 *
 * 앱 게이트는 이 결과를 보지 않는다. 넓은 기존 토큰이 있어도 민감 API 호출은
 * capability gate 에서 막힌다.
 */
export function legacySensitiveScopes(grantedScopes: readonly string[]): string[] {
  const granted = new Set(grantedScopes);
  return WITHHELD_SENSITIVE_SCOPES.filter((scope) => granted.has(scope));
}
