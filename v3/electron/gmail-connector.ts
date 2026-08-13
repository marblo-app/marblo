/**
 * Gmail 읽기 전용 커넥터.
 *
 * Drive 커넥터와 같은 규율을 따른다: electron 의존 없음, REST + fetch 만 사용,
 * access token 은 Authorization 헤더에만 넣고 URL/로그/에러 메시지에 싣지 않는다.
 */

export type GmailFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<Response>;

export const GMAIL_MESSAGES_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export const GMAIL_MESSAGE_FIELDS =
  "id,threadId,labelIds,snippet,internalDate,payload(headers,mimeType,body,data,parts)";

export const GMAIL_LIST_FIELDS =
  "nextPageToken,resultSizeEstimate,messages(id,threadId)";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_MAX_BODY_CHARS = 120_000;

export interface GmailSearchParams {
  query?: string;
  labelIds?: string[];
  pageSize?: number;
  pageToken?: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
}

export interface GmailSearchResult {
  messages: GmailMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
  labelIds: string[];
  truncated: boolean;
}

export interface GmailConnectorOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: GmailFetchLike;
  maxBodyChars?: number;
}

export interface GmailConnector {
  search(params: GmailSearchParams): Promise<GmailSearchResult>;
  fetch(messageId: string): Promise<GmailMessage>;
}

export class GmailApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GmailApiError";
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

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || !Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE);
}

export function buildGmailListParams(
  params: GmailSearchParams,
): URLSearchParams {
  const search = new URLSearchParams({
    maxResults: String(clampPageSize(params.pageSize)),
    fields: GMAIL_LIST_FIELDS,
  });
  const query = params.query?.trim();
  if (query) search.set("q", query);
  if (params.pageToken) search.set("pageToken", params.pageToken);
  for (const labelId of params.labelIds ?? []) {
    const trimmed = labelId.trim();
    if (trimmed) search.append("labelIds", trimmed);
  }
  return search;
}

export function parseGmailSearchResult(raw: unknown): GmailSearchResult {
  const record = asRecord(raw);
  const rawMessages =
    record && Array.isArray(record.messages) ? record.messages : [];
  const messages = rawMessages
    .map((message): GmailMessageSummary | null => {
      const item = asRecord(message);
      const id = stringField(item?.id);
      const threadId = stringField(item?.threadId);
      return id && threadId ? { id, threadId } : null;
    })
    .filter((message): message is GmailMessageSummary => message !== null);
  return {
    messages,
    nextPageToken: stringField(record?.nextPageToken),
    resultSizeEstimate: numberField(record?.resultSizeEstimate),
  };
}

function headersFromPayload(
  payload: Record<string, unknown> | null,
): Map<string, string> {
  const headers = new Map<string, string>();
  const rawHeaders = Array.isArray(payload?.headers) ? payload.headers : [];
  for (const raw of rawHeaders) {
    const header = asRecord(raw);
    const name = stringField(header?.name);
    const value = stringField(header?.value);
    if (name && value) headers.set(name.toLowerCase(), value);
  }
  return headers;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function textFromHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function collectBodyParts(part: unknown): { plain: string[]; html: string[] } {
  const record = asRecord(part);
  if (!record) return { plain: [], html: [] };
  const mimeType = stringField(record.mimeType);
  const body = asRecord(record.body);
  const data = stringField(body?.data);
  const own: { plain: string[]; html: string[] } =
    data && mimeType
      ? mimeType === "text/plain"
        ? { plain: [decodeBase64Url(data)], html: [] }
        : mimeType === "text/html"
          ? { plain: [], html: [textFromHtml(decodeBase64Url(data))] }
          : { plain: [], html: [] }
      : { plain: [], html: [] };
  const children = Array.isArray(record.parts) ? record.parts : [];
  for (const child of children) {
    const nested = collectBodyParts(child);
    own.plain.push(...nested.plain);
    own.html.push(...nested.html);
  }
  return own;
}

export function parseGmailMessage(
  raw: unknown,
  maxBodyChars: number = DEFAULT_MAX_BODY_CHARS,
): GmailMessage | null {
  const record = asRecord(raw);
  const id = stringField(record?.id);
  const threadId = stringField(record?.threadId);
  if (!id || !threadId) return null;
  const payload = asRecord(record?.payload);
  const headers = headersFromPayload(payload);
  const parts = collectBodyParts(payload);
  const fullBody = (parts.plain.length ? parts.plain : parts.html)
    .join("\n")
    .trim();
  const truncated = fullBody.length > maxBodyChars;
  const labelIds = Array.isArray(record?.labelIds)
    ? record.labelIds.filter(
        (label): label is string => typeof label === "string",
      )
    : [];
  return {
    id,
    threadId,
    subject: headers.get("subject") ?? "(제목 없음)",
    from: headers.get("from") ?? "",
    date: headers.get("date") ?? stringField(record?.internalDate) ?? "",
    snippet: stringField(record?.snippet) ?? "",
    body: truncated ? fullBody.slice(0, maxBodyChars) : fullBody,
    labelIds,
    truncated,
  };
}

export function gmailErrorMessage(status: number, body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const detail = stringField(error?.message);
  if (status === 401) {
    return "Google Gmail 인증이 만료되었습니다. Harness 탭에서 Google 계정을 다시 연결해 주세요.";
  }
  if (status === 403) {
    return `Gmail 읽기 권한이 없거나 Gmail API 가 활성화되지 않았습니다${detail ? `: ${detail}` : "."}`;
  }
  if (status === 404) return "Gmail 메시지를 찾을 수 없습니다.";
  if (status === 429)
    return "Gmail 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
  return `Gmail 오류 (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

export function createGmailConnector(
  options: GmailConnectorOptions,
): GmailConnector {
  const doFetch: GmailFetchLike = options.fetchImpl ?? fetch;
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;

  async function authorizedFetch(url: string): Promise<Response> {
    const accessToken = await options.getAccessToken();
    return doFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function getJson(url: string): Promise<unknown> {
    const response = await authorizedFetch(url);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new GmailApiError(
        response.status,
        gmailErrorMessage(response.status, body),
      );
    }
    return response.json();
  }

  return {
    async search(params: GmailSearchParams): Promise<GmailSearchResult> {
      const search = buildGmailListParams(params);
      return parseGmailSearchResult(
        await getJson(`${GMAIL_MESSAGES_ENDPOINT}?${search}`),
      );
    },
    async fetch(messageId: string): Promise<GmailMessage> {
      const search = new URLSearchParams({
        format: "full",
        fields: GMAIL_MESSAGE_FIELDS,
      });
      const parsed = parseGmailMessage(
        await getJson(
          `${GMAIL_MESSAGES_ENDPOINT}/${encodeURIComponent(messageId)}?${search}`,
        ),
        maxBodyChars,
      );
      if (!parsed) {
        throw new GmailApiError(
          502,
          "Gmail 이 알 수 없는 형식의 응답을 보냈습니다.",
        );
      }
      return parsed;
    },
  };
}
