/**
 * apps-script-sheets-trigger — 사용자가 자기 스프레드시트에 붙여넣는 Apps Script
 * 템플릿의 생성기. 티켓 kJbIsaRPjMnGQTvDbR1V (설계 §3.5 · §9 T6).
 *
 * ── 왜 이게 생겼나 ──────────────────────────────────────────────────────
 * `spreadsheets.readonly` 는 sensitive 스코프고, sensitive 가 **하나라도** 남으면
 * 게시 검증 심사가 통째로 붙는다(`docs/GOOGLE_SCOPE_ZERO_DESIGN.md` §1). 그래서
 * 회수한다. 회수하면 우리는 시트를 읽을 수 없다.
 *
 * ★그래서 방향을 뒤집는다 — **우리가 시트를 읽는 게 아니라 시트가 우리를 부른다.**
 * 사용자의 구글 계정 안에서 구글이 돌리는 Apps Script 가 새 행을 감지해
 * #1256 이 이미 배포해 둔 `assistantWebhook` 을 POST 한다. 우리 쪽 구글 스코프는
 * 0 이고, Apps Script 는 사용자 계정 안에서 도니 **플랫폼도 가리지 않는다**
 * (설계 §6.1 에서 Windows 에서도 살아남는 유일한 대체 경로).
 *
 * ── 다시 만들지 않는 것 ─────────────────────────────────────────────────
 * 수신부는 **서버에 살아 있다**. 이 파일은 서버를 향해 쏘는 클라이언트 코드를
 * 문자열로 만들 뿐이고, 계약은 `functions/src/assistantWebhook.ts` 가 원본이다:
 *   · URL       `…/assistantWebhook?webhookId=awh_…`
 *   · 헤더      `x-marblo-signature: ts=<epoch초>;h1=<hex>`
 *   · h1        HMAC_SHA256(secret, "<ts>:<보낸 본문 문자열 그대로>")
 *   · 본문      { event, source?, payload } — payload 는 평면 스칼라만,
 *               ≤20 필드 · 문자열 ≤2,000자 · 총 텍스트 ≤8,000자 · raw ≤32KB
 *   · 레이트    웹훅당 60초 10회 / 600초 60회
 *
 * ── ★조용히 어긋나는 자리 셋 ────────────────────────────────────────────
 *  1. **부호 있는 바이트.** `Utilities.computeHmacSha256Signature()` 는 Java 의
 *     `byte[]` 를 준다 — 값 범위가 **-128..127** 이다. 그대로 `toString(16)` 하면
 *     `-3f` 같은 문자열이 나와 서명이 통째로 깨진다. `(b & 0xff)` 로 접고
 *     `padStart(2,'0')` 로 자리를 채워야 한다. 템플릿의 `marbloHmacHex_` 가 그것이다.
 *  2. **직렬화는 한 번.** 서명 대상과 전송 본문이 **같은 문자열**이어야 한다.
 *     객체를 두 번 `JSON.stringify` 하면 키 순서는 같아도 우리가 서명한 바이트와
 *     보낸 바이트가 갈릴 수 있다. 템플릿은 `var body = JSON.stringify(...)` 를
 *     한 번만 만들고 서명·전송이 그 변수를 쓴다.
 *  3. **hex 는 소문자.** 검증기는 `timingSafeEqualHex` 로 **문자열 바이트를**
 *     비교한다 — 대문자 hex 는 값이 같아도 불일치다. `toString(16)` 은 소문자를
 *     주므로 대문자로 바꾸는 코드를 넣지 않는 것이 곧 계약이다.
 *
 * ── 배치로 보낸다 (설계 §3.5) ───────────────────────────────────────────
 * 편집 이벤트를 그대로 웹훅에 연결하면 50행 붙여넣기 한 번에 레이트 리밋을 넘고
 * 그 뒤가 조용히 버려진다. 그래서 템플릿은 **커서 + 시간 구동 트리거**가 뼈대다.
 * `onChange` 는 지연을 줄이는 가속기로만 얹고, 60초 쿨다운과 같은 커서를 공유해
 * 한 tick 에 POST 가 1회를 넘지 못하게 한다. 쿨다운에 걸린 변화는 버려지지 않고
 * 다음 시간 트리거가 커서로 집어간다.
 *
 * ── 보안 ────────────────────────────────────────────────────────────────
 * 생성된 스크립트에는 웹훅 시크릿 **원문**이 들어간다(사용자 자신의 스크립트
 * 프로젝트로 들어가는 값이라 그래야 동작한다). ★그래서 이 모듈은 스크립트를
 * 로그로 내보내지 않고, 호출부도 그러면 안 된다. 표시·기록용으로는
 * `maskAppsScriptSecret()` 를 쓴다.
 */

/** 생성된 스크립트가 보내는 이벤트 이름. 웹훅 프롬프트에서 이 값으로 구분된다. */
export const APPS_SCRIPT_EVENT_NAME = "sheets.new_rows";

/** `source` 필드 값 — 웹훅 이벤트가 어디서 왔는지. */
export const APPS_SCRIPT_SOURCE = "apps-script";

/**
 * Apps Script 시간 구동 트리거가 실제로 받는 분 간격.
 *
 * ★`everyMinutes()` 는 아무 수나 받지 않는다 — 1·5·10·15·30 만 유효하고 그 밖의
 * 값은 실행 시점에 예외로 죽는다. 우리 설정 화면은 1~60 을 허용하므로 여기서
 * 접어야 한다. 60 은 `everyHours(1)` 로 내보낸다.
 */
export const APPS_SCRIPT_ALLOWED_INTERVAL_MINUTES = [
  1, 5, 10, 15, 30, 60,
] as const;

export type AppsScriptIntervalMinutes =
  (typeof APPS_SCRIPT_ALLOWED_INTERVAL_MINUTES)[number];

/** 한 번의 POST 에 실어 보낼 최근 행 수(20필드 예산 안). */
export const APPS_SCRIPT_MAX_ROWS_IN_PAYLOAD = 5;

/** 셀 묶음 문자열 상한 — 서버의 2,000자·8,000자 예산보다 한참 아래로 잡는다. */
export const APPS_SCRIPT_MAX_CELL_CHARS = 200;

/** onChange 가속기의 쿨다운(초). 레이트 리밋(60초 10회)보다 보수적이다. */
export const APPS_SCRIPT_MIN_SEND_INTERVAL_SECONDS = 60;

export type AppsScriptLocale = "ko" | "en";

export interface AppsScriptSheetsTriggerConfig {
  /** `provisionAssistantWebhook` 이 돌려준 수신 URL. */
  webhookUrl: string;
  /** 발급·재발급 직후에만 원문으로 존재하는 서명 시크릿. */
  secret: string;
  /** 빈 문자열이면 첫 번째 시트를 본다. */
  sheetName?: string;
  /** 설정 화면의 pollMinutes(1~60). Apps Script 가 받는 값으로 접힌다. */
  pollMinutes?: number;
  locale: AppsScriptLocale;
}

/**
 * 설정 화면의 1~60분을 Apps Script 가 실제로 받는 값으로 접는다.
 *
 * 올림이 아니라 **가장 가까운 허용값**이다. 3분을 1분으로 올려붙이면 사용자가
 * 원하지 않은 5배 빈도가 되고, 5분으로 내려붙이면 늦어질 뿐 안전하다 — 그래서
 * 동률(예: 3분)은 **느린 쪽**으로 간다.
 */
export function normalizeAppsScriptIntervalMinutes(
  pollMinutes: number | undefined,
): AppsScriptIntervalMinutes {
  const requested =
    typeof pollMinutes === "number" && Number.isFinite(pollMinutes)
      ? Math.round(pollMinutes)
      : 5;
  let best: AppsScriptIntervalMinutes = APPS_SCRIPT_ALLOWED_INTERVAL_MINUTES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of APPS_SCRIPT_ALLOWED_INTERVAL_MINUTES) {
    const distance = Math.abs(candidate - requested);
    // `<` 가 아니라 `<=` 인 것이 동률 규칙이다 — 뒤쪽(느린) 후보가 이긴다.
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** 로그·UI 용 마스킹. ★시크릿 원문을 찍는 경로를 만들지 않기 위해 존재한다. */
export function maskAppsScriptSecret(secret: string): string {
  if (!secret) return "****";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

/**
 * 작은따옴표 JS 문자열 리터럴에 안전하게 박아 넣는다.
 *
 * 값은 우리가 만든 URL·시크릿·사용자가 고른 시트 이름이다. 시트 이름에는
 * 따옴표·역슬래시·줄바꿈이 들어갈 수 있고, 그대로 넣으면 사용자가 붙여넣은
 * 스크립트가 **문법 오류로 죽는다** — 사용자는 우리가 준 코드가 깨진 것으로
 * 본다. 그래서 이스케이프는 편의가 아니라 계약이다.
 */
export function escapeAppsScriptStringLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

interface AppsScriptStrings {
  readonly headerTitle: string;
  readonly headerWhy: string;
  readonly headerInstall: string;
  readonly secretWarning: string;
  readonly sheetNameHint: string;
  readonly intervalHint: string;
  readonly baselineNote: string;
  readonly signedByteNote: string;
  readonly singleSerializeNote: string;
  readonly cooldownNote: string;
  readonly httpErrorNote: string;
  readonly logInstalled: string;
  readonly logUninstalled: string;
  readonly logChecked: string;
  readonly errorSheetMissing: string;
}

/**
 * 생성 코드 안의 주석·로그 문구. ko/en 대칭이며 키가 같다.
 *
 * ★사용자가 자기 에디터에서 읽는 텍스트라 반드시 양쪽이 필요하다. 렌더러의
 * i18n 은 electron 메인에서 못 쓰므로 `google-restricted-scopes.ts` 와 같은
 * 모양으로 이 파일이 문자열을 직접 든다.
 */
const APPS_SCRIPT_STRINGS: Readonly<Record<AppsScriptLocale, AppsScriptStrings>> =
  {
    ko: {
      headerTitle: "Marblo — 구글 시트 새 행 → Marblo 웹훅 (자동 생성됨)",
      headerWhy:
        "Marblo 는 이 스프레드시트에 대한 구글 권한을 하나도 갖지 않습니다. 대신 이 스크립트가 새 행을 감지해 Marblo 로 알려 줍니다.",
      headerInstall:
        "설치: 저장(Cmd/Ctrl+S) → 위 함수 목록에서 marbloInstall 선택 → 실행 → 권한 승인(최초 1회).",
      secretWarning:
        "이 시크릿은 이 스크립트 밖으로 내보내지 마세요. 유출되면 Marblo 설정에서 재발급하고 이 스크립트를 다시 붙여넣으세요.",
      sheetNameHint: "빈 값이면 첫 번째 시트를 봅니다.",
      intervalHint:
        "Apps Script 시간 트리거가 받는 값은 1·5·10·15·30분 또는 시간 단위뿐입니다.",
      baselineNote:
        "첫 설치는 현재 상태를 기준선으로 잡기만 하고 알리지 않습니다. 이후 늘어난 행만 알립니다.",
      signedByteNote:
        "Apps Script 의 HMAC 은 부호 있는 바이트(-128~127)를 돌려줍니다. 그대로 16진수로 바꾸면 '-3f' 같은 값이 나와 서명이 조용히 깨집니다. 0xff 로 접고 두 자리로 채우세요. 대문자로 바꾸지 마세요 - 검증기는 소문자 hex 를 기대합니다.",
      singleSerializeNote:
        "서명 대상과 전송 본문은 같은 문자열이어야 합니다. 두 번 직렬화하지 마세요.",
      cooldownNote:
        "쿨다운에 걸린 변화는 버려지지 않습니다. 다음 시간 트리거가 커서로 집어갑니다.",
      httpErrorNote:
        "401=서명 불일치(시크릿 재발급 후 스크립트를 갱신하지 않은 경우가 대부분), 403=Marblo 에서 웹훅 트리거가 꺼짐, 429=레이트 리밋(다음 실행에서 재시도됩니다).",
      logInstalled: "Marblo: 설치 완료. 기준선 행 = ",
      logUninstalled: "Marblo: 트리거를 제거했습니다.",
      logChecked:
        "Marblo: 점검 완료. 새 행이 없으면 아무것도 보내지 않는 것이 정상입니다.",
      errorSheetMissing: "Marblo: 시트를 찾을 수 없습니다 - ",
    },
    en: {
      headerTitle: "Marblo - Google Sheets new rows -> Marblo webhook (generated)",
      headerWhy:
        "Marblo holds no Google permission on this spreadsheet. This script detects new rows and tells Marblo instead.",
      headerInstall:
        "Install: Save (Cmd/Ctrl+S) -> pick marbloInstall in the function list -> Run -> approve the permissions once.",
      secretWarning:
        "Never share this secret outside this script. If it leaks, rotate it in Marblo settings and paste the regenerated script here.",
      sheetNameHint: "Leave empty to watch the first sheet.",
      intervalHint:
        "Apps Script time triggers only accept 1, 5, 10, 15 or 30 minutes, or whole hours.",
      baselineNote:
        "The first install only records the current state as a baseline and sends nothing. Only rows added after that are reported.",
      signedByteNote:
        "Apps Script HMAC returns SIGNED bytes (-128..127). Converting them directly to hex yields values like '-3f' and the signature breaks silently. Fold with 0xff and pad to two digits. Do not uppercase - the verifier expects lowercase hex.",
      singleSerializeNote:
        "The signed string and the sent body must be the same string. Never serialize twice.",
      cooldownNote:
        "Changes suppressed by the cooldown are not dropped. The next time-driven run picks them up from the cursor.",
      httpErrorNote:
        "401=signature mismatch (usually the secret was rotated and this script was not updated), 403=webhook trigger disabled in Marblo, 429=rate limited (retried on the next run).",
      logInstalled: "Marblo: installed. Baseline row = ",
      logUninstalled: "Marblo: triggers removed.",
      logChecked:
        "Marblo: check finished. Sending nothing when there are no new rows is the normal case.",
      errorSheetMissing: "Marblo: sheet not found - ",
    },
  };

/**
 * 붙여넣을 Apps Script 전문을 만든다.
 *
 * 반환값에는 **시크릿 원문이 들어 있다.** 화면에 보여 주고 클립보드로 복사하는
 * 용도이며, 로그·텔레메트리·에러 리포트에 실어 보내면 안 된다.
 */
export function buildSheetsAppsScript(
  config: AppsScriptSheetsTriggerConfig,
): string {
  const s = APPS_SCRIPT_STRINGS[config.locale];
  const interval = normalizeAppsScriptIntervalMinutes(config.pollMinutes);
  const url = escapeAppsScriptStringLiteral(config.webhookUrl);
  const secret = escapeAppsScriptStringLiteral(config.secret);
  const sheetName = escapeAppsScriptStringLiteral(config.sheetName ?? "");
  // 60분은 everyMinutes 가 받지 않는다(위 상수 주석). 여기서 호출 자체를 바꾼다.
  const scheduleCall =
    interval === 60 ? ".everyHours(1)" : `.everyMinutes(${interval})`;

  return [
    "/**",
    ` * ${s.headerTitle}`,
    " *",
    ` * ${s.headerWhy}`,
    " *",
    ` * ${s.headerInstall}`,
    " */",
    "",
    `var MARBLO_WEBHOOK_URL = '${url}';`,
    `// ${s.secretWarning}`,
    `var MARBLO_WEBHOOK_SECRET = '${secret}';`,
    `// ${s.sheetNameHint}`,
    `var MARBLO_SHEET_NAME = '${sheetName}';`,
    `// ${s.intervalHint}`,
    `var MARBLO_INTERVAL_MINUTES = ${interval};`,
    "",
    `var MARBLO_EVENT = '${APPS_SCRIPT_EVENT_NAME}';`,
    `var MARBLO_SOURCE = '${APPS_SCRIPT_SOURCE}';`,
    `var MARBLO_MAX_ROWS_IN_PAYLOAD = ${APPS_SCRIPT_MAX_ROWS_IN_PAYLOAD};`,
    `var MARBLO_MAX_CELL_CHARS = ${APPS_SCRIPT_MAX_CELL_CHARS};`,
    `var MARBLO_MIN_SEND_INTERVAL_SECONDS = ${APPS_SCRIPT_MIN_SEND_INTERVAL_SECONDS};`,
    "var MARBLO_CURSOR_PREFIX = 'marblo_last_row:';",
    "var MARBLO_LAST_SENT_KEY = 'marblo_last_sent_at';",
    "",
    "function marbloInstall() {",
    "  marbloRemoveTriggers_();",
    "  ScriptApp.newTrigger('marbloCheckNewRows')",
    "    .timeBased()",
    `    ${scheduleCall}`,
    "    .create();",
    "  ScriptApp.newTrigger('marbloOnChange')",
    "    .forSpreadsheet(SpreadsheetApp.getActive())",
    "    .onChange()",
    "    .create();",
    `  // ${s.baselineNote}`,
    "  var sheet = marbloSheet_();",
    "  marbloSetCursor_(sheet.getName(), sheet.getLastRow());",
    `  Logger.log('${escapeAppsScriptStringLiteral(s.logInstalled)}' + sheet.getLastRow());`,
    "}",
    "",
    "function marbloUninstall() {",
    "  marbloRemoveTriggers_();",
    `  Logger.log('${escapeAppsScriptStringLiteral(s.logUninstalled)}');`,
    "}",
    "",
    "function marbloTestNow() {",
    "  marbloCheckNewRows();",
    `  Logger.log('${escapeAppsScriptStringLiteral(s.logChecked)}');`,
    "}",
    "",
    "function marbloOnChange(event) {",
    "  var changeType = event && event.changeType ? event.changeType : '';",
    "  if (changeType === 'REMOVE_ROW' || changeType === 'REMOVE_COLUMN') return;",
    "  var props = PropertiesService.getScriptProperties();",
    "  var lastSent = Number(props.getProperty(MARBLO_LAST_SENT_KEY) || 0);",
    "  var now = Math.floor(Date.now() / 1000);",
    `  // ${s.cooldownNote}`,
    "  if (now - lastSent < MARBLO_MIN_SEND_INTERVAL_SECONDS) return;",
    "  marbloCheckNewRows();",
    "}",
    "",
    "function marbloCheckNewRows() {",
    "  var lock = LockService.getScriptLock();",
    "  if (!lock.tryLock(5000)) return;",
    "  try {",
    "    var sheet = marbloSheet_();",
    "    var sheetName = sheet.getName();",
    "    var lastRow = sheet.getLastRow();",
    "    var cursor = marbloGetCursor_(sheetName);",
    "    if (cursor === null || lastRow <= cursor) {",
    "      marbloSetCursor_(sheetName, lastRow);",
    "      return;",
    "    }",
    "    var lastColumn = Math.max(1, sheet.getLastColumn());",
    "    var newRowCount = lastRow - cursor;",
    "    var take = Math.min(newRowCount, MARBLO_MAX_ROWS_IN_PAYLOAD);",
    "    var firstTakenRow = lastRow - take + 1;",
    "    var rows = sheet.getRange(firstTakenRow, 1, take, lastColumn).getValues();",
    "    var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];",
    "    var spreadsheet = SpreadsheetApp.getActive();",
    "    var payload = {",
    "      spreadsheetId: spreadsheet.getId(),",
    "      spreadsheetName: marbloTrim_(spreadsheet.getName()),",
    "      sheetName: marbloTrim_(sheetName),",
    "      firstNewRow: cursor + 1,",
    "      lastNewRow: lastRow,",
    "      newRowCount: newRowCount,",
    "      truncated: newRowCount > take,",
    "      columns: marbloTrim_(marbloJoinRow_(header))",
    "    };",
    "    for (var i = 0; i < rows.length; i++) {",
    "      payload['row' + (firstTakenRow + i)] = marbloTrim_(marbloJoinRow_(rows[i]));",
    "    }",
    "    marbloPost_({ event: MARBLO_EVENT, source: MARBLO_SOURCE, payload: payload });",
    "    marbloSetCursor_(sheetName, lastRow);",
    "  } finally {",
    "    lock.releaseLock();",
    "  }",
    "}",
    "",
    "function marbloPost_(message) {",
    `  // ${s.singleSerializeNote}`,
    "  var body = JSON.stringify(message);",
    "  var ts = Math.floor(Date.now() / 1000);",
    "  var signature = 'ts=' + ts + ';h1=' + marbloHmacHex_(ts + ':' + body, MARBLO_WEBHOOK_SECRET);",
    "  var response = UrlFetchApp.fetch(MARBLO_WEBHOOK_URL, {",
    "    method: 'post',",
    "    contentType: 'application/json',",
    "    payload: body,",
    "    headers: { 'x-marblo-signature': signature },",
    "    muteHttpExceptions: true",
    "  });",
    "  PropertiesService.getScriptProperties()",
    "    .setProperty(MARBLO_LAST_SENT_KEY, String(Math.floor(Date.now() / 1000)));",
    "  var code = response.getResponseCode();",
    `  // ${s.httpErrorNote}`,
    "  if (code < 200 || code >= 300) {",
    "    throw new Error('Marblo webhook ' + code + ': ' + response.getContentText());",
    "  }",
    "}",
    "",
    "function marbloHmacHex_(message, secret) {",
    `  // ${s.signedByteNote}`,
    "  var raw = Utilities.computeHmacSha256Signature(message, secret);",
    "  var hex = '';",
    "  for (var i = 0; i < raw.length; i++) {",
    "    hex += (raw[i] & 0xff).toString(16).padStart(2, '0');",
    "  }",
    "  return hex;",
    "}",
    "",
    "function marbloSheet_() {",
    "  var spreadsheet = SpreadsheetApp.getActive();",
    "  if (MARBLO_SHEET_NAME) {",
    "    var named = spreadsheet.getSheetByName(MARBLO_SHEET_NAME);",
    "    if (!named) {",
    `      throw new Error('${escapeAppsScriptStringLiteral(s.errorSheetMissing)}' + MARBLO_SHEET_NAME);`,
    "    }",
    "    return named;",
    "  }",
    "  return spreadsheet.getSheets()[0];",
    "}",
    "",
    "function marbloJoinRow_(row) {",
    "  var cells = [];",
    "  for (var i = 0; i < row.length; i++) {",
    "    var cell = row[i];",
    "    cells.push(cell === null || cell === undefined ? '' : String(cell));",
    "  }",
    "  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();",
    "  return cells.join(' | ');",
    "}",
    "",
    "function marbloTrim_(value) {",
    "  var text = String(value === null || value === undefined ? '' : value)",
    "    .replace(/\\s+/g, ' ')",
    "    .trim();",
    "  if (text.length <= MARBLO_MAX_CELL_CHARS) return text;",
    "  return text.slice(0, MARBLO_MAX_CELL_CHARS - 3) + '...';",
    "}",
    "",
    "function marbloGetCursor_(sheetName) {",
    "  var raw = PropertiesService.getScriptProperties()",
    "    .getProperty(MARBLO_CURSOR_PREFIX + sheetName);",
    "  if (raw === null || raw === '') return null;",
    "  var parsed = Number(raw);",
    "  return isFinite(parsed) ? parsed : null;",
    "}",
    "",
    "function marbloSetCursor_(sheetName, lastRow) {",
    "  PropertiesService.getScriptProperties()",
    "    .setProperty(MARBLO_CURSOR_PREFIX + sheetName, String(lastRow));",
    "}",
    "",
    "function marbloRemoveTriggers_() {",
    "  var triggers = ScriptApp.getProjectTriggers();",
    "  for (var i = 0; i < triggers.length; i++) {",
    "    var handler = triggers[i].getHandlerFunction();",
    "    if (handler === 'marbloCheckNewRows' || handler === 'marbloOnChange') {",
    "      ScriptApp.deleteTrigger(triggers[i]);",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}
