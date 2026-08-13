/**
 * Google Drive 커넥터 (읽기 전용 MVP) — 티켓 zqNxS9904aeeBEug1uAD.
 *
 * ── 이 파일의 자리 ────────────────────────────────────────────────────────
 * 지식위키·헤르메스형 비서 에이전트의 **선행 기반**이다. 이번 티켓의 범위는
 * "Drive 에서 파일을 찾고 본문을 텍스트로 가져오는 것" 까지고, 인덱스 저장소·
 * 위키 UI·비서 에이전트는 후속 에픽이다. 그래서 이 모듈이 밖으로 내는 것은
 * **중립 반환형**(`DriveDocument`: id·title·mimeType·text) 하나뿐이다 — 후속
 * 소비자가 Drive API 모양에 결합되지 않게 하는 seam 이다.
 *
 * ── 설계 규율 ────────────────────────────────────────────────────────────
 * 1. **electron 의존 없음.** 이 파일은 순수 TS + fetch 다. 유닛테스트(node 환경)가
 *    그대로 import 한다. OAuth/토큰은 `getAccessToken` 콜백으로 주입받는다.
 * 2. **googleapis SDK 미도입.** REST 3개 엔드포인트(files.list / files.get?
 *    alt=media / files.export)면 충분하고, SDK 는 앱 번들과 dist-mcp esbuild
 *    번들을 수 MB 불린다. 순수 fetch 라 dist-mcp 의존성 변화가 **0** 이다.
 * 3. **읽기 전용.** 쓰기 엔드포인트를 부르는 코드가 이 파일에 없다. 스코프도
 *    `drive.readonly` 하나다(google-drive-auth.ts).
 * 4. **토큰 미로그.** access token 은 Authorization 헤더에만 쓰이고 어떤 에러
 *    메시지·로그에도 실리지 않는다.
 */
import { detectOfficeFormat, type OfficeFormat } from "./office-formats";

export type DriveFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<Response>;

export const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/** Drive 가 목록에 돌려줄 필드(과다 수집 금지 — 필요한 것만). */
export const DRIVE_LIST_FIELDS =
  "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, parents)";

/** 단건 메타 조회 필드. */
export const DRIVE_FILE_FIELDS =
  "id, name, mimeType, modifiedTime, size, webViewLink, parents";

/** 목록 1페이지 최대 개수(Drive 상한은 1000, 우리는 훨씬 보수적으로). */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** 본문 다운로드 상한. 넘으면 잘라내고 truncated 로 알린다(10MB). */
export const DEFAULT_MAX_CONTENT_BYTES = 10 * 1024 * 1024;
/** 반환 텍스트 상한(문자). 후속 인덱서가 청킹할 때까지의 안전판. */
export const DEFAULT_MAX_TEXT_CHARS = 400_000;

// ── 중립 반환형 (후속 위키/비서가 쓰는 유일한 계약) ──────────────────────

export interface DriveFileMeta {
  id: string;
  /** Drive 의 `name`. 후속 소비자에겐 "제목" 이라 title 로 노출한다. */
  title: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  /** 바이트. Google 네이티브 문서는 값이 없다. */
  size?: number;
  webViewLink?: string;
  parents?: string[];
}

/** 본문을 어떻게 얻었는가. 실패도 값으로 드러낸다(조용한 빈 문자열 금지). */
export type DriveExtraction =
  /** Google 네이티브 문서를 files.export 로 텍스트/CSV 변환 */
  | "export"
  /** 일반 파일을 files.get?alt=media 로 받아 UTF-8 디코드 */
  | "download"
  /** PDF 바이트를 받아 텍스트 레이어 추출 */
  | "pdf"
  /** PDF 이지만 텍스트 레이어가 없다(스캔본) — text 는 빈 문자열 */
  | "pdf-no-text"
  /** Office/한글 문서(docx·pptx·xlsx·hwpx·hwp)에서 본문 텍스트 추출 */
  | "office"
  /** 파일은 열렸으나 텍스트가 없다(이미지만 든 문서) — text 는 빈 문자열 */
  | "office-no-text"
  /** 컨테이너를 열지 못했다(암호·손상·잘림·미지원 하위형식) */
  | "office-unreadable"
  /** 텍스트로 바꿀 방법이 없는 형식(이미지·동영상·폴더 등) */
  | "unsupported";

/**
 * 후속 지식위키/비서가 소비하는 **중립 문서형**. Drive API 모양이 여기서 끊긴다.
 */
export interface DriveDocument {
  id: string;
  title: string;
  mimeType: string;
  text: string;
  extraction: DriveExtraction;
  /**
   * 본문이 빈 이유 등, 사용자에게 그대로 보여줄 짧은 설명. 성공 시엔 없다.
   * (조용한 빈 본문 금지 — 왜 비었는지가 값으로 따라와야 한다.)
   */
  extractionDetail?: string;
  /** 상한에 걸려 잘렸는가. */
  truncated: boolean;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface DriveSearchResult {
  files: DriveFileMeta[];
  nextPageToken?: string;
  /** 실제로 Drive 에 보낸 q — 디버깅·감사용(토큰 없음). */
  query: string;
}

// ── 쿼리 빌더 ────────────────────────────────────────────────────────────

export interface DriveSearchQuery {
  /** 전문 검색(`fullText contains`). */
  text?: string;
  /** 파일명 부분일치(`name contains`). */
  nameContains?: string;
  /** 이 폴더의 직계 자식만. */
  folderId?: string;
  /**
   * 이 폴더들 **중 하나**의 직계 자식만(OR). `folderId` 와 함께 주면 둘 다 합쳐
   * 하나의 OR 절이 된다.
   *
   * 왜 필요한가: Drive 의 `in parents` 는 **직계 자식만** 매칭한다. "이 폴더
   * 하위 전체" 를 검색하려면 하위 폴더 id 들을 미리 펼쳐 OR 로 넘기는 수밖에
   * 없다(drive-scope.ts 가 그 펼치기를 한다). 프로젝트 위키 폴더 스코프가
   * 하위 폴더까지 닿아야 실제로 쓸모가 있어서 이 필드를 뒀다.
   */
  folderIds?: string[];
  /** 이 MIME 들 중 하나(OR). */
  mimeTypes?: string[];
  /** 폴더를 결과에 포함할지. 기본 false(문서만 보고 싶은 게 보통이다). */
  includeFolders?: boolean;
  /** 휴지통 포함 여부. 기본 false. */
  includeTrashed?: boolean;
}

/**
 * Drive 쿼리 문자열 리터럴 이스케이프.
 *
 * Drive 의 `q` 는 값을 홑따옴표로 감싼다. 백슬래시와 홑따옴표만 이스케이프하면
 * 되고, **순서가 중요하다**(백슬래시를 먼저 — 나중에 하면 방금 넣은 이스케이프
 * 백슬래시를 또 이스케이프한다). 이걸 빼먹으면 사용자가 입력한 `'` 하나로
 * 쿼리가 깨지고, 최악엔 의도치 않은 절이 붙는다(쿼리 인젝션).
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * `DriveSearchQuery` → Drive `q` 문자열. 절의 순서는 고정이다(테스트 가능성 +
 * 로그 가독성). 아무 조건도 없으면 `trashed = false` 만 남는다.
 */
export function buildDriveQuery(query: DriveSearchQuery): string {
  const clauses: string[] = [];

  const text = query.text?.trim();
  if (text) clauses.push(`fullText contains '${escapeDriveQueryValue(text)}'`);

  const name = query.nameContains?.trim();
  if (name) clauses.push(`name contains '${escapeDriveQueryValue(name)}'`);

  // folderId(단수) + folderIds(복수)를 하나의 부모 절로 합친다. 중복은 제거하고
  // 입력 순서를 보존한다 — 쿼리 문자열이 결정적이어야 테스트·로그가 읽힌다.
  const parentIds: string[] = [];
  for (const candidate of [query.folderId, ...(query.folderIds ?? [])]) {
    const trimmed = candidate?.trim();
    if (trimmed && !parentIds.includes(trimmed)) parentIds.push(trimmed);
  }
  if (parentIds.length === 1) {
    clauses.push(`'${escapeDriveQueryValue(parentIds[0])}' in parents`);
  } else if (parentIds.length > 1) {
    clauses.push(
      `(${parentIds
        .map((id) => `'${escapeDriveQueryValue(id)}' in parents`)
        .join(" or ")})`,
    );
  }

  const mimeTypes = (query.mimeTypes ?? [])
    .map((m) => m.trim())
    .filter(Boolean);
  if (mimeTypes.length === 1) {
    clauses.push(`mimeType = '${escapeDriveQueryValue(mimeTypes[0])}'`);
  } else if (mimeTypes.length > 1) {
    clauses.push(
      `(${mimeTypes
        .map((m) => `mimeType = '${escapeDriveQueryValue(m)}'`)
        .join(" or ")})`,
    );
  }

  if (!query.includeFolders) clauses.push(`mimeType != '${DRIVE_FOLDER_MIME}'`);
  if (!query.includeTrashed) clauses.push("trashed = false");

  return clauses.join(" and ");
}

export interface DriveListParams extends DriveSearchQuery {
  pageSize?: number;
  pageToken?: string;
}

/** files.list 의 쿼리스트링. pageSize 는 1..100 으로 클램프한다. */
export function buildDriveListParams(params: DriveListParams): URLSearchParams {
  const query = buildDriveQuery(params);
  const search = new URLSearchParams({
    fields: DRIVE_LIST_FIELDS,
    pageSize: String(clampPageSize(params.pageSize)),
    // 공유 드라이브(팀 드라이브)의 파일도 검색 대상에 넣는다. 읽기 전용이라
    // 위험이 없고, 회사 지식이 대개 공유 드라이브에 있다.
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    // 최근 수정 문서가 위로 — 지식 취득에서 사실상 항상 원하는 정렬이다.
    orderBy: "modifiedTime desc",
  });
  // 모든 필터를 끈 경우 q 는 빈 문자열이 된다. 그때는 파라미터 자체를 빼서
  // "필터 없음" 을 명확히 한다 — `q=` 를 보내면 Drive 가 빈 쿼리를 어떻게 볼지에
  // 우리 동작을 의존하게 된다.
  if (query) search.set("q", query);
  if (params.pageToken) search.set("pageToken", params.pageToken);
  return search;
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || !Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE);
}

// ── 응답 파서 ────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Drive 가 문자열로 주는 size 를 숫자로. 못 읽으면 undefined. */
function sizeField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

/** files 항목 하나 → 중립 메타. id/name/mimeType 이 없으면 null(스킵). */
export function parseDriveFile(raw: unknown): DriveFileMeta | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = stringField(record.id);
  const mimeType = stringField(record.mimeType);
  if (!id || !mimeType) return null;
  const parents = Array.isArray(record.parents)
    ? record.parents.filter((p): p is string => typeof p === "string")
    : undefined;
  return {
    id,
    // 이름 없는 파일이 실제로 존재한다(휴지통 잔재 등) — 빈 제목으로 떨어뜨리지
    // 않고 표시 가능한 대체값을 준다.
    title: stringField(record.name) ?? "(제목 없음)",
    mimeType,
    isFolder: mimeType === DRIVE_FOLDER_MIME,
    modifiedTime: stringField(record.modifiedTime),
    size: sizeField(record.size),
    webViewLink: stringField(record.webViewLink),
    ...(parents && parents.length ? { parents } : {}),
  };
}

/** files.list 응답 파서. 깨진 항목은 조용히 버리고 나머지를 살린다. */
export function parseDriveFileList(raw: unknown): {
  files: DriveFileMeta[];
  nextPageToken?: string;
} {
  const record = asRecord(raw);
  const rawFiles = record && Array.isArray(record.files) ? record.files : [];
  const files = rawFiles
    .map((f) => parseDriveFile(f))
    .filter((f): f is DriveFileMeta => f !== null);
  return {
    files,
    nextPageToken: record ? stringField(record.nextPageToken) : undefined,
  };
}

/**
 * Drive 에러 응답 → 사람이 읽을 한국어 메시지.
 *
 * 403 은 원인이 둘로 갈리고 대처가 정반대라 구분해 준다: API 미활성화(=GCP 콘솔
 * 작업)와 권한 부족(=재동의). 이 구분이 없으면 "권한 없음" 만 보고 사용자가
 * 재로그인을 반복하게 된다.
 */
export function driveErrorMessage(status: number, body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const detail = stringField(error?.message);
  const reasons = Array.isArray(error?.errors)
    ? error.errors
        .map((e) => stringField(asRecord(e)?.reason))
        .filter((r): r is string => Boolean(r))
    : [];

  if (status === 401) {
    return "Google Drive 인증이 만료되었습니다. 설정에서 Drive 를 다시 연결해 주세요.";
  }
  if (status === 403) {
    if (reasons.includes("accessNotConfigured")) {
      return (
        "이 Google Cloud 프로젝트에서 Drive API 가 켜져 있지 않습니다. " +
        "콘솔에서 Google Drive API 를 활성화한 뒤 다시 시도하세요." +
        (detail ? ` (${detail})` : "")
      );
    }
    if (
      reasons.includes("rateLimitExceeded") ||
      reasons.includes("userRateLimitExceeded")
    ) {
      return "Google Drive 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
    }
    return `Google Drive 접근 권한이 없습니다${detail ? `: ${detail}` : "."}`;
  }
  if (status === 404) {
    return "파일을 찾을 수 없습니다. 삭제되었거나 접근 권한이 없습니다.";
  }
  if (status === 429) {
    return "Google Drive 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
  }
  return `Google Drive 오류 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

// ── 본문 취득 전략 ───────────────────────────────────────────────────────

/**
 * Google 네이티브 문서 → files.export 로 쓸 MIME. 지원하지 않으면 null.
 *
 * 도면(drawing)·양식(form)·스크립트는 텍스트로 의미가 없어 제외한다 — 억지로
 * 변환해 쓰레기 텍스트를 인덱스에 넣는 것보다 "미지원" 이 낫다.
 */
export function driveExportMimeType(mimeType: string): string | null {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
    case "application/vnd.google-apps.presentation":
      return "text/plain";
    case "application/vnd.google-apps.spreadsheet":
      // CSV 는 첫 시트만 나온다(Drive 제약). 여러 시트는 후속 에픽에서 xlsx →
      // 시트별 파싱으로 넓힌다.
      return "text/csv";
    default:
      return null;
  }
}

/** 이 MIME 이 Google 네이티브(= 바이트 다운로드가 불가한) 형식인가. */
export function isGoogleNativeMime(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps.");
}

/**
 * alt=media 로 받은 바이트를 텍스트로 볼 수 있는가.
 *
 * 파일명을 함께 받는 이유: Windows 에서 올린 .csv 가 `application/vnd.ms-excel`
 * 로 붙어 오는 일이 흔하다. MIME 만 믿으면 멀쩡한 CSV 를 "미지원" 으로 되돌려
 * 보내게 된다 — 확장자가 명백한 텍스트 형식이면 받아준다.
 */
export function isTextualMime(mimeType: string, fileName = ""): boolean {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base.startsWith("text/")) return true;
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (
    [
      "csv",
      "tsv",
      "txt",
      "md",
      "markdown",
      "json",
      "jsonl",
      "ndjson",
      "xml",
      "yaml",
      "yml",
      "log",
    ].includes(extension)
  ) {
    return true;
  }
  return [
    "application/csv",
    "application/json",
    "application/xml",
    "application/xhtml+xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/yaml",
    "application/sql",
    "application/x-sh",
    "application/rtf",
    "application/x-ndjson",
  ].includes(base);
}

/** 문자 상한을 적용한다. 잘렸는지 함께 돌려준다. */
export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

// ── 커넥터 ───────────────────────────────────────────────────────────────

export interface DriveConnectorOptions {
  /**
   * 유효한 access token 을 돌려주는 콜백. 만료 갱신은 호출자(google-drive-auth)의
   * 책임이다 — 이 모듈은 토큰 저장소를 모른다.
   */
  getAccessToken: () => Promise<string>;
  fetchImpl?: DriveFetchLike;
  /** PDF 바이트 → 텍스트. 주입식이라 이 모듈이 zlib 에 묶이지 않는다. */
  extractPdfText?: (bytes: Buffer) => { text: string; empty: boolean };
  /**
   * Office/한글 문서 바이트 → 텍스트. PDF 와 같은 이유로 주입식이다.
   * `reason` 은 왜 비었는지다: `no-text`(텍스트 없는 문서) / `unreadable`(못 엶).
   */
  extractOfficeText?: (
    bytes: Buffer,
    format: OfficeFormat,
  ) => {
    text: string;
    empty: boolean;
    reason?: "no-text" | "unreadable";
    detail?: string;
  };
  maxContentBytes?: number;
  maxTextChars?: number;
}

export interface DriveConnector {
  search(params: DriveListParams): Promise<DriveSearchResult>;
  getFileMeta(fileId: string): Promise<DriveFileMeta>;
  fetchDocument(fileId: string): Promise<DriveDocument>;
}

/** Drive 호출 실패를 사용자 메시지와 상태코드로 함께 나르는 에러. */
export class DriveApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

export function createDriveConnector(
  options: DriveConnectorOptions,
): DriveConnector {
  const doFetch: DriveFetchLike = options.fetchImpl ?? fetch;
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;

  async function authorizedFetch(url: string): Promise<Response> {
    const accessToken = await options.getAccessToken();
    return doFetch(url, {
      method: "GET",
      // ★토큰은 헤더에만. URL 에 넣으면 로그·에러메시지에 그대로 새어나간다.
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  /** 실패 응답을 DriveApiError 로 변환. 본문은 JSON 이 아닐 수도 있다. */
  async function toApiError(response: Response): Promise<DriveApiError> {
    const body = await response.json().catch(() => null);
    return new DriveApiError(
      response.status,
      driveErrorMessage(response.status, body),
    );
  }

  async function getJson(url: string): Promise<unknown> {
    const response = await authorizedFetch(url);
    if (!response.ok) throw await toApiError(response);
    return response.json();
  }

  /** 바이트 본문. 상한을 넘으면 앞부분만 남기고 truncated 로 알린다. */
  async function getBytes(
    url: string,
  ): Promise<{ bytes: Buffer; truncated: boolean }> {
    const response = await authorizedFetch(url);
    if (!response.ok) throw await toApiError(response);
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length <= maxContentBytes) return { bytes: raw, truncated: false };
    return { bytes: raw.subarray(0, maxContentBytes), truncated: true };
  }

  async function getFileMeta(fileId: string): Promise<DriveFileMeta> {
    const search = new URLSearchParams({
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: "true",
    });
    const meta = parseDriveFile(
      await getJson(
        `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${search}`,
      ),
    );
    if (!meta) {
      throw new DriveApiError(
        502,
        "Drive 가 알 수 없는 형식의 응답을 보냈습니다.",
      );
    }
    return meta;
  }

  return {
    async search(params: DriveListParams): Promise<DriveSearchResult> {
      const search = buildDriveListParams(params);
      const parsed = parseDriveFileList(
        await getJson(`${DRIVE_FILES_ENDPOINT}?${search}`),
      );
      return { ...parsed, query: search.get("q") ?? "" };
    },

    getFileMeta,

    async fetchDocument(fileId: string): Promise<DriveDocument> {
      const meta = await getFileMeta(fileId);
      const base: Omit<DriveDocument, "text" | "extraction" | "truncated"> = {
        id: meta.id,
        title: meta.title,
        mimeType: meta.mimeType,
        modifiedTime: meta.modifiedTime,
        webViewLink: meta.webViewLink,
      };

      // (a) Google 네이티브 문서 → files.export
      if (isGoogleNativeMime(meta.mimeType)) {
        const exportMime = driveExportMimeType(meta.mimeType);
        if (!exportMime) {
          return {
            ...base,
            text: "",
            extraction: "unsupported",
            truncated: false,
          };
        }
        const search = new URLSearchParams({ mimeType: exportMime });
        const { bytes, truncated: bytesTruncated } = await getBytes(
          `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(
            fileId,
          )}/export?${search}`,
        );
        const limited = truncateText(bytes.toString("utf8"), maxTextChars);
        return {
          ...base,
          text: limited.text,
          extraction: "export",
          truncated: bytesTruncated || limited.truncated,
        };
      }

      // (b) 일반 파일 → files.get?alt=media
      const isPdf = meta.mimeType.split(";")[0].trim() === "application/pdf";
      // Office/한글 문서는 MIME 이 틀려 올라온 경우가 잦아 파일명도 함께 본다.
      const officeFormat = detectOfficeFormat(meta.mimeType, meta.title);
      if (
        !isPdf &&
        !officeFormat &&
        !isTextualMime(meta.mimeType, meta.title)
      ) {
        return {
          ...base,
          text: "",
          extraction: "unsupported",
          truncated: false,
        };
      }

      const search = new URLSearchParams({
        alt: "media",
        supportsAllDrives: "true",
      });
      const { bytes, truncated: bytesTruncated } = await getBytes(
        `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${search}`,
      );

      if (isPdf) {
        const extract = options.extractPdfText;
        if (!extract) {
          return {
            ...base,
            text: "",
            extraction: "unsupported",
            truncated: false,
          };
        }
        const result = extract(bytes);
        if (result.empty) {
          // 스캔 PDF — 조용히 빈 본문으로 넘기지 않고 사실을 값으로 드러낸다.
          return {
            ...base,
            text: "",
            extraction: "pdf-no-text",
            truncated: false,
          };
        }
        const limited = truncateText(result.text, maxTextChars);
        return {
          ...base,
          text: limited.text,
          extraction: "pdf",
          truncated: bytesTruncated || limited.truncated,
        };
      }

      if (officeFormat) {
        const extract = options.extractOfficeText;
        if (!extract) {
          return {
            ...base,
            text: "",
            extraction: "unsupported",
            truncated: false,
          };
        }
        const result = extract(bytes, officeFormat);
        if (result.empty) {
          // 왜 비었는지를 값으로 남긴다 — 조용한 빈 본문 금지.
          return {
            ...base,
            text: "",
            extraction:
              result.reason === "unreadable"
                ? "office-unreadable"
                : "office-no-text",
            extractionDetail: result.detail,
            // 10MB 상한에 잘려서 못 읽었을 수 있다는 사실을 함께 알린다.
            truncated: bytesTruncated,
          };
        }
        const limited = truncateText(result.text, maxTextChars);
        return {
          ...base,
          text: limited.text,
          extraction: "office",
          truncated: bytesTruncated || limited.truncated,
        };
      }

      const limited = truncateText(bytes.toString("utf8"), maxTextChars);
      return {
        ...base,
        text: limited.text,
        extraction: "download",
        truncated: bytesTruncated || limited.truncated,
      };
    },
  };
}
