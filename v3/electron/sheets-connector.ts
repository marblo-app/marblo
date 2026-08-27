/**
 * Google Sheets 커넥터 — 티켓 qxDMhv5bgZA2nRe7AdPC ("새 행이 추가되면" 조건 트리거).
 *
 * `spreadsheets.values.get` **하나만** 감싼다. 쓰기는 없다 — 이 커넥터가 존재하는
 * 이유는 트리거가 시트를 **읽어서** 새 행을 알아채는 것뿐이고, 그래서 요구하는
 * 스코프도 `spreadsheets.readonly` 다(google-drive-auth.ts 의 SHEETS_READONLY_SCOPE).
 *
 * ── flow-engine 의 sheets 실행기와 무관하다 ─────────────────────────────
 * `flow-engine/node-executors.ts` 에도 sheets append 가 있지만, 그것은 사용자가
 * config 에 **생 토큰을 붙여넣는** 방식이라 OAuth 커넥터를 타지 않고, 플로우 탭은
 * DEV_ONLY_RIGHT_TABS 라 출시되지도 않았다. 재사용하지 않는다.
 *
 * ── 모양은 calendar-connector.ts 를 그대로 따른다 ───────────────────────
 * 토큰은 Authorization 헤더에만 들어가고, 파서/에러문구/빌더는 전부 순수 함수로
 * 빼서 유닛테스트가 fetch 없이 검증한다.
 */

export type SheetsFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<Response>;

export const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** 사용자가 범위를 비워두면 쓰는 기본값 — 첫 번째 시트의 A~Z 열. */
export const DEFAULT_SHEETS_RANGE = "A:Z";

/**
 * 한 번의 폴링에서 지문을 추적할 행 수 상한.
 *
 * ★이 상한은 취향이 아니라 **창(window) 이동 방향** 때문에 안전하다. 추적 창은
 * "마지막 N 행" 이고, 행이 **추가**되면 창의 앞쪽 행이 밖으로 밀려날 뿐 새 행이
 * 앞에서 들어오지 않는다. 앞에서 들어오는 경우는 행 **삭제** 뿐인데, 삭제는 행
 * 수가 줄어 `detectNewSheetRows` 가 애초에 발화하지 않는다(아래 규칙 2).
 * 즉 창 절단이 오탐을 만드는 경우는 "한 폴링 안에서 삭제와 추가가 섞이고 총합이
 * 늘어난" 좁은 교집합뿐이고, 그때도 오탐 행 수는 삭제 행 수로 묶인다.
 */
export const MAX_TRACKED_SHEET_ROWS = 5_000;

/** 한 번의 폴링에서 오케스트레이터에 알릴 새 행 수 상한(주입 폭주 방지). */
export const MAX_ANNOUNCED_SHEET_ROWS = 10;

export interface SheetsValuesParams {
  spreadsheetId: string;
  range?: string;
}

export interface SheetsValuesResult {
  /** Sheets 가 실제로 해석한 범위(예: `Sheet1!A1:Z1000`). */
  range: string;
  /** 행 배열. 후행 빈 행은 Sheets 가 잘라서 준다. */
  rows: string[][];
}

export interface SheetsConnectorOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: SheetsFetchLike;
}

export interface SheetsConnector {
  getValues(params: SheetsValuesParams): Promise<SheetsValuesResult>;
}

export class SheetsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SheetsApiError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * 사용자가 붙여넣는 것은 대부분 **URL** 이지 id 가 아니다. 스프레드시트 URL 은
 * `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0` 형태라 `/d/` 뒤 한
 * 조각이 id 다. 이미 id 를 넣었으면 그대로 통과시킨다.
 *
 * 판정 불가면 빈 문자열 — 호출자가 "스프레드시트를 지정해야 합니다" 로 바꾼다.
 * 여기서 추측해서 아무 문자열이나 id 로 넘기면 나중에 알 수 없는 404 가 된다.
 */
export function normalizeSpreadsheetId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "";
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  // URL 처럼 생겼는데 위 패턴에 안 맞으면(다른 문서 종류 등) 받아주지 않는다.
  if (/^https?:\/\//i.test(trimmed)) return "";
  return /^[a-zA-Z0-9-_]+$/.test(trimmed) ? trimmed : "";
}

/**
 * 범위 문자열 정규화. 비어 있으면 기본값(첫 시트 A~Z).
 *
 * Sheets 는 범위를 **URL 경로**에 넣기 때문에(`/values/{range}`) 시트 이름에
 * 공백·한글·`/` 가 들어가면 그대로 붙일 수 없다. 인코딩은 URL 을 만드는 쪽에서
 * 한다 — 여기서는 문자열만 다듬는다.
 */
export function normalizeSheetsRange(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : DEFAULT_SHEETS_RANGE;
}

export function buildSheetsValuesUrl(params: SheetsValuesParams): string {
  const spreadsheetId = normalizeSpreadsheetId(params.spreadsheetId);
  if (!spreadsheetId) {
    throw new SheetsApiError(400, "스프레드시트 ID 또는 URL 이 필요합니다.");
  }
  const range = normalizeSheetsRange(params.range);
  const search = new URLSearchParams({
    majorDimension: "ROWS",
    // FORMATTED_VALUE: 사람이 시트에서 보는 문자열 그대로. 프롬프트에 그대로
    // 실어야 하므로 숫자 직렬화 규칙을 우리가 다시 정하지 않는다.
    valueRenderOption: "FORMATTED_VALUE",
  });
  return `${SHEETS_API_BASE}/${encodeURIComponent(
    spreadsheetId,
  )}/values/${encodeURIComponent(range)}?${search.toString()}`;
}

/** 셀 하나 → 문자열. Sheets 가 숫자/불리언을 줄 수도 있어 방어적으로 받는다. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function parseSheetsValuesResult(raw: unknown): SheetsValuesResult {
  const record = asRecord(raw);
  const rawRows = record && Array.isArray(record.values) ? record.values : [];
  return {
    range: stringField(record?.range) ?? "",
    rows: rawRows.map((row) =>
      Array.isArray(row) ? row.map((cell) => cellText(cell)) : [],
    ),
  };
}

export function sheetsErrorMessage(status: number, body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const detail = stringField(error?.message);
  if (status === 401) {
    return "Google Sheets 인증이 만료되었습니다. Harness 탭에서 Google 계정을 다시 연결해 주세요.";
  }
  if (status === 403) {
    // 403 은 원인이 둘이다 — 스코프 미부여와 API 미활성화. 둘 다 사람이 손을
    // 대야 풀리는 상태라 문구에서 갈라 준다(둘 중 무엇인지는 detail 에 온다).
    return `Sheets 권한이 없거나 Sheets API 가 활성화되지 않았습니다${
      detail ? `: ${detail}` : "."
    }`;
  }
  if (status === 404) {
    return "스프레드시트를 찾을 수 없습니다. ID·URL 과 이 계정의 접근 권한을 확인해 주세요.";
  }
  if (status === 400) {
    return `시트 범위를 해석하지 못했습니다${detail ? `: ${detail}` : "."}`;
  }
  if (status === 429) {
    return "Sheets 요청 한도를 넘었습니다. 폴링 간격을 늘려 주세요.";
  }
  return `Sheets 오류 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

export function createSheetsConnector(
  options: SheetsConnectorOptions,
): SheetsConnector {
  const doFetch: SheetsFetchLike = options.fetchImpl ?? fetch;

  return {
    async getValues(params: SheetsValuesParams): Promise<SheetsValuesResult> {
      const url = buildSheetsValuesUrl(params);
      const accessToken = await options.getAccessToken();
      const response = await doFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new SheetsApiError(
          response.status,
          sheetsErrorMessage(response.status, body),
        );
      }
      return parseSheetsValuesResult(await response.json());
    },
  };
}

// ── "새 행" 판정 (★이 기능의 설계 핵심) ──────────────────────────────────
//
// 순진한 방법은 **행 개수 비교**다. 그리고 그건 틀린다:
//
//   커서=10 → 사용자가 5행을 지운다(9) → 새 행을 붙인다(10) → 10==10 → 놓친다.
//
// 그래서 커서를 두 조각으로 나눈다.
//
//   (a) rowCount   — "행이 늘었는가" 를 판정하는 **발화 게이트**
//   (b) fingerprints — 늘었을 때 **어느 행이 새 것인가** 를 고르는 다중집합
//
// 규칙은 셋뿐이다.
//
//   1. **첫 폴링은 커서만 잡고 발화하지 않는다.** 이게 없으면 조건을 켜는 순간
//      기존 1,000 행이 전부 "새 행" 으로 오케에 쏟아진다. gmail 조건이 `warmed`
//      플래그로 하는 것과 같은 규율이고, 여기서는 커서 부재가 곧 warmed=false 다.
//   2. **행 수가 늘지 않았으면 발화하지 않는다.** 셀 하나를 고쳐도 지문은 바뀌지만
//      그건 "새 행" 이 아니다. 삭제도 마찬가지다. 두 경우 모두 커서만 다시 맞춘다.
//      → 이 규칙이 "오타 수정 한 번에 오케가 깨어나는" 오탐을 막는다.
//   3. 늘었으면 **다중집합 차분**으로 새 행을 고른다. 앞에서부터 훑으며 이전에
//      본 지문의 몫을 먼저 소진시키므로, 같은 내용의 행이 두 번 들어와도(폼 응답
//      중복 제출) 두 번째만 새 행이 된다.
//
// ★이 방식이 놓치는 것 — 정직하게 적는다. **한 폴링 간격 안에서** 삭제와 추가가
// 함께 일어나 총 행 수가 늘지 않으면(2 삭제 + 1 추가) 그 추가는 놓친다. 폴링으로
// 관측하는 이상 원리적으로 피할 수 없고, 완화책은 폴링 간격을 줄이는 것뿐이다.
// 순차로 관측되는 "삭제 → (폴링) → 추가" 는 규칙 2 가 커서를 9 로 되돌려 놓기
// 때문에 정상 발화한다.
//
// 커서는 **메모리에만** 산다(ProjectRuntime). 기존 gmail/calendar 조건과 같은
// 자리이고, 앱 재시작이나 설정 변경은 커서를 지워 다음 폴링이 다시 warm 한다.
// 즉 "앱이 꺼져 있는 동안 쌓인 행" 은 알리지 않는다 — 켜자마자 밀린 알림이
// 터지는 것보다 조용한 쪽이 안전하다는, gmail 조건과 같은 선택이다.

export interface SheetRow {
  /** 시트에서의 1-기반 행 번호(범위 시작 기준). 사람에게 보여줄 위치. */
  rowNumber: number;
  values: string[];
}

export interface SheetsRowCursor {
  /** 비어 있지 않은 행의 수. 발화 게이트. */
  rowCount: number;
  /** 지문 → 등장 횟수. */
  fingerprints: Record<string, number>;
}

export interface SheetsRowDetection {
  cursor: SheetsRowCursor;
  /** 이번에 알릴 새 행(시트 순서). 첫 폴링이면 항상 빈 배열. */
  newRows: SheetRow[];
  /** 헤더로 쓸 첫 행(첫 행 자체가 새 행이면 undefined). */
  header?: string[];
  /** 알림 상한에 걸려 일부 새 행을 잘랐는가. */
  truncated: boolean;
  /** 추적 상한에 걸려 앞쪽 행을 창 밖으로 버렸는가. */
  windowed: boolean;
}

function isBlankRow(values: string[]): boolean {
  return values.every((cell) => cell.trim() === "");
}

/**
 * 행 지문. 셀 값을 그대로 이어 붙이되 구분자를 이스케이프해, `["a|b"]` 와
 * `["a","b"]` 가 같은 지문이 되는 것을 막는다. 해시를 쓰지 않는 이유는 충돌
 * 확률을 따질 필요 자체를 없애기 위해서다 — 추적 상한이 5,000 행이라 원문
 * 보관 비용이 문제가 되지 않는다.
 */
export function sheetRowFingerprint(values: string[]): string {
  return values.map((cell) => cell.replace(/[\\|]/g, "\\$&")).join("|");
}

/** 시트 응답 → 빈 행을 걸러낸 행 목록(행 번호는 원래 위치를 유지한다). */
export function toSheetRows(rows: string[][]): SheetRow[] {
  return rows
    .map((values, index) => ({ rowNumber: index + 1, values }))
    .filter((row) => !isBlankRow(row.values));
}

export function detectNewSheetRows(
  previous: SheetsRowCursor | null,
  rawRows: string[][],
): SheetsRowDetection {
  const allRows = toSheetRows(rawRows);
  const windowed = allRows.length > MAX_TRACKED_SHEET_ROWS;
  const rows = windowed ? allRows.slice(-MAX_TRACKED_SHEET_ROWS) : allRows;

  const fingerprints: Record<string, number> = {};
  for (const row of rows) {
    const fingerprint = sheetRowFingerprint(row.values);
    fingerprints[fingerprint] = (fingerprints[fingerprint] ?? 0) + 1;
  }
  const cursor: SheetsRowCursor = { rowCount: rows.length, fingerprints };

  // 규칙 1 — 첫 폴링은 커서만 잡는다.
  if (!previous) {
    return { cursor, newRows: [], truncated: false, windowed };
  }
  // 규칙 2 — 늘지 않았으면 발화하지 않는다(수정·삭제·재정렬).
  if (rows.length <= previous.rowCount) {
    return { cursor, newRows: [], truncated: false, windowed };
  }

  // 규칙 3 — 다중집합 차분. 앞에서부터 이전 몫을 소진시킨다.
  const remaining: Record<string, number> = { ...previous.fingerprints };
  const fresh: SheetRow[] = [];
  for (const row of rows) {
    const fingerprint = sheetRowFingerprint(row.values);
    const left = remaining[fingerprint] ?? 0;
    if (left > 0) {
      remaining[fingerprint] = left - 1;
      continue;
    }
    fresh.push(row);
  }

  // 상한을 넘으면 **최근** 행을 남긴다 — 오래된 것보다 방금 들어온 것이 알 값이
  // 크고, 잘렸다는 사실은 truncated 로 드러낸다(조용히 버리지 않는다).
  const truncated = fresh.length > MAX_ANNOUNCED_SHEET_ROWS;
  const newRows = truncated ? fresh.slice(-MAX_ANNOUNCED_SHEET_ROWS) : fresh;

  const firstRow = rows[0];
  const header =
    firstRow && !fresh.some((row) => row.rowNumber === firstRow.rowNumber)
      ? firstRow.values
      : undefined;

  return { cursor, newRows, header, truncated, windowed };
}
