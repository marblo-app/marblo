export type NotionFetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<Response>;

export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";
export const DEFAULT_NOTION_PAGE_SIZE = 25;
export const MAX_NOTION_PAGE_SIZE = 100;
export const DEFAULT_MAX_BLOCK_DEPTH = 8;
export const DEFAULT_MAX_BLOCKS = 500;
export const DEFAULT_MAX_TEXT_CHARS = 400_000;

export type NotionObjectKind = "page" | "database";

export interface NotionObjectMeta {
  id: string;
  object: NotionObjectKind;
  title: string;
  url?: string;
  lastEditedTime?: string;
  parent?: NotionParent;
}

export interface NotionSearchResult {
  results: NotionObjectMeta[];
  nextCursor?: string;
  hasMore: boolean;
}

export type NotionExtraction = "blocks" | "empty";

export interface NotionDocument {
  id: string;
  title: string;
  object: "page";
  text: string;
  extraction: NotionExtraction;
  truncated: boolean;
  url?: string;
  lastEditedTime?: string;
}

export type NotionParent =
  | { type: "page_id"; pageId: string }
  | { type: "database_id"; databaseId: string }
  | { type: "workspace" }
  | { type: "block_id"; blockId: string }
  | { type: "unknown" };

export interface NotionSearchParams {
  query?: string;
  object?: NotionObjectKind;
  pageSize?: number;
  startCursor?: string;
}

export interface NotionDatabaseQueryParams {
  databaseId: string;
  pageSize?: number;
  startCursor?: string;
}

export interface NotionWriteParams {
  parentPageId?: string;
  parentDatabaseId?: string;
  pageId?: string;
  title?: string;
  content?: string;
}

export type NotionWriteAction = "create_page" | "append_blocks";

export interface NotionWriteResult {
  action: NotionWriteAction;
  pageId: string;
  title?: string;
  url?: string;
  appendedBlocks: number;
}

export interface NotionConnector {
  search(params: NotionSearchParams): Promise<NotionSearchResult>;
  queryDatabase(params: NotionDatabaseQueryParams): Promise<NotionSearchResult>;
  getPageMeta(pageId: string): Promise<NotionObjectMeta>;
  fetchPage(pageId: string): Promise<NotionDocument>;
  listChildPages(pageId: string): Promise<NotionObjectMeta[]>;
  createPage(params: NotionWriteParams): Promise<NotionWriteResult>;
  appendBlocks(params: NotionWriteParams): Promise<NotionWriteResult>;
}

export interface NotionConnectorOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: NotionFetchLike;
  maxBlockDepth?: number;
  maxBlocks?: number;
  maxTextChars?: number;
}

export class NotionApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NotionApiError";
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

function requireNonEmpty(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new NotionApiError(400, `${label} 값이 필요합니다.`);
  return trimmed;
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || !Number.isFinite(pageSize)) return DEFAULT_NOTION_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_NOTION_PAGE_SIZE);
}

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").trim().toLowerCase();
}

function parseParent(raw: unknown): NotionParent {
  const record = asRecord(raw);
  if (!record) return { type: "unknown" };
  const type = stringField(record.type);
  const pageId = stringField(record.page_id);
  const databaseId = stringField(record.database_id);
  const blockId = stringField(record.block_id);
  if (type === "page_id" && pageId) {
    return { type, pageId };
  }
  if (type === "database_id" && databaseId) {
    return { type, databaseId };
  }
  if (type === "workspace") return { type };
  if (type === "block_id" && blockId) {
    return { type, blockId };
  }
  return { type: "unknown" };
}

function richTextPlain(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((item) => {
      const record = asRecord(item);
      return stringField(record?.plain_text) ?? "";
    })
    .join("");
}

function plainRichText(text: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: { content: text.slice(0, 2000) } }];
}

function titleFromProperties(raw: unknown): string | null {
  const props = asRecord(raw);
  if (!props) return null;
  for (const value of Object.values(props)) {
    const prop = asRecord(value);
    if (!prop || prop.type !== "title") continue;
    const title = richTextPlain(prop.title);
    if (title.trim()) return title.trim();
  }
  return null;
}

function titleFromObject(raw: Record<string, unknown>): string {
  if (raw.object === "database") {
    const title = richTextPlain(raw.title);
    return title.trim() || "(제목 없는 데이터베이스)";
  }
  const pageTitle = titleFromProperties(raw.properties);
  return pageTitle ?? "(제목 없는 페이지)";
}

export function parseNotionObject(raw: unknown): NotionObjectMeta | null {
  const record = asRecord(raw);
  if (!record) return null;
  const object = record?.object;
  const id = stringField(record?.id);
  if (!id || (object !== "page" && object !== "database")) return null;
  return {
    id,
    object,
    title: titleFromObject(record),
    url: stringField(record.url),
    lastEditedTime: stringField(record.last_edited_time),
    parent: parseParent(record.parent),
  };
}

export function parseNotionList(raw: unknown): NotionSearchResult {
  const record = asRecord(raw);
  const items = record && Array.isArray(record.results) ? record.results : [];
  const results = items
    .map((item) => parseNotionObject(item))
    .filter((item): item is NotionObjectMeta => item !== null);
  return {
    results,
    nextCursor: record ? stringField(record.next_cursor) : undefined,
    hasMore: record?.has_more === true,
  };
}

export function notionErrorMessage(status: number, body: unknown): string {
  const record = asRecord(body);
  const message = stringField(record?.message);
  const code = stringField(record?.code);
  if (status === 401) {
    return "Notion 연결이 만료되었거나 토큰이 올바르지 않습니다. Harness 탭에서 다시 연결해 주세요.";
  }
  if (status === 403) {
    return `Notion 접근 권한이 없습니다${message ? `: ${message}` : "."}`;
  }
  if (status === 404) {
    return "Notion 페이지/데이터베이스를 찾을 수 없습니다. integration 이 해당 문서에 초대되어 있는지 확인해 주세요.";
  }
  if (status === 429) {
    return "Notion 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.";
  }
  return `Notion 오류 (HTTP ${status})${code ? ` ${code}` : ""}${
    message ? `: ${message}` : ""
  }`;
}

function blockText(raw: unknown): string {
  const block = asRecord(raw);
  const type = stringField(block?.type);
  const body = type ? asRecord(block?.[type]) : null;
  if (!type || !body) return "";

  const text = richTextPlain(body.rich_text);
  switch (type) {
    case "paragraph":
      return text;
    case "heading_1":
      return text ? `# ${text}` : "";
    case "heading_2":
      return text ? `## ${text}` : "";
    case "heading_3":
      return text ? `### ${text}` : "";
    case "bulleted_list_item":
      return text ? `- ${text}` : "";
    case "numbered_list_item":
      return text ? `1. ${text}` : "";
    case "to_do":
      return text ? `- [${body.checked === true ? "x" : " "}] ${text}` : "";
    case "toggle":
      return text ? `<details><summary>${text}</summary>` : "";
    case "quote":
      return text ? `> ${text}` : "";
    case "callout":
      return text ? `> ${text}` : "";
    case "code": {
      const language = stringField(body.language) ?? "";
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }
    case "child_page": {
      const title = stringField(body.title);
      return title ? `## ${title}` : "";
    }
    case "child_database": {
      const title = stringField(body.title);
      return title ? `## ${title}` : "";
    }
    default:
      return text;
  }
}

function blockFromLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
  if (heading) {
    const type =
      heading[1].length === 1
        ? "heading_1"
        : heading[1].length === 2
          ? "heading_2"
          : "heading_3";
    return { object: "block", type, [type]: { rich_text: plainRichText(heading[2]) } };
  }
  const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
  if (bullet) {
    return {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: plainRichText(bullet[1]) },
    };
  }
  const numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
  if (numbered) {
    return {
      object: "block",
      type: "numbered_list_item",
      numbered_list_item: { rich_text: plainRichText(numbered[1]) },
    };
  }
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: plainRichText(trimmed) },
  };
}

export function buildNotionBlocks(content: string | undefined): Record<string, unknown>[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((line) => blockFromLine(line))
    .filter((block): block is Record<string, unknown> => block !== null)
    .slice(0, 100);
}

function parentPayload(params: NotionWriteParams): Record<string, string> {
  const databaseId = params.parentDatabaseId?.trim();
  if (databaseId) return { database_id: databaseId };
  return { page_id: requireNonEmpty(params.parentPageId, "parentPageId") };
}

function createPageProperties(title: string): Record<string, unknown> {
  return {
    title: {
      title: plainRichText(title),
    },
  };
}

function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export function createNotionConnector(
  options: NotionConnectorOptions,
): NotionConnector {
  const doFetch = options.fetchImpl ?? fetch;
  const maxDepth = options.maxBlockDepth ?? DEFAULT_MAX_BLOCK_DEPTH;
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;

  async function authorizedFetch(
    path: string,
    init: { method?: string; body?: string } = {},
  ): Promise<Response> {
    const accessToken = await options.getAccessToken();
    return doFetch(`${NOTION_API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      ...(init.body ? { body: init.body } : {}),
    });
  }

  async function toApiError(response: Response): Promise<NotionApiError> {
    const body = await response.json().catch(() => null);
    return new NotionApiError(
      response.status,
      notionErrorMessage(response.status, body),
    );
  }

  async function getJson(
    path: string,
    init: { method?: string; body?: string } = {},
  ): Promise<unknown> {
    const response = await authorizedFetch(path, init);
    if (!response.ok) throw await toApiError(response);
    return response.json();
  }

  async function blockChildren(blockId: string, startCursor?: string) {
    const search = new URLSearchParams({
      page_size: String(MAX_NOTION_PAGE_SIZE),
    });
    if (startCursor) search.set("start_cursor", startCursor);
    return getJson(`/blocks/${encodeURIComponent(blockId)}/children?${search}`);
  }

  async function collectBlocks(
    blockId: string,
    depth: number,
    state: { lines: string[]; count: number; truncated: boolean },
  ): Promise<void> {
    if (depth > maxDepth || state.count >= maxBlocks) {
      state.truncated = true;
      return;
    }
    let cursor: string | undefined;
    do {
      const parsed = asRecord(await blockChildren(blockId, cursor));
      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      for (const raw of results) {
        if (state.count >= maxBlocks) {
          state.truncated = true;
          return;
        }
        state.count += 1;
        const line = blockText(raw);
        if (line.trim()) state.lines.push(line);
        const record = asRecord(raw);
        if (record?.has_children === true && stringField(record.id)) {
          await collectBlocks(stringField(record.id)!, depth + 1, state);
        }
      }
      cursor = stringField(parsed?.next_cursor);
    } while (cursor);
  }

  async function getPageMeta(pageId: string): Promise<NotionObjectMeta> {
    const meta = parseNotionObject(
      await getJson(`/pages/${encodeURIComponent(pageId)}`),
    );
    if (!meta || meta.object !== "page") {
      throw new NotionApiError(
        502,
        "Notion 이 알 수 없는 형식의 페이지 응답을 보냈습니다.",
      );
    }
    return meta;
  }

  return {
    async search(params: NotionSearchParams): Promise<NotionSearchResult> {
      const body: Record<string, unknown> = {
        page_size: clampPageSize(params.pageSize),
      };
      const query = params.query?.trim();
      if (query) body.query = query;
      if (params.object)
        body.filter = { property: "object", value: params.object };
      if (params.startCursor) body.start_cursor = params.startCursor;
      return parseNotionList(
        await getJson("/search", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    },

    async queryDatabase(
      params: NotionDatabaseQueryParams,
    ): Promise<NotionSearchResult> {
      const body: Record<string, unknown> = {
        page_size: clampPageSize(params.pageSize),
      };
      if (params.startCursor) body.start_cursor = params.startCursor;
      return parseNotionList(
        await getJson(
          `/databases/${encodeURIComponent(params.databaseId)}/query`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      );
    },

    getPageMeta,

    async fetchPage(pageId: string): Promise<NotionDocument> {
      const meta = await getPageMeta(pageId);
      const state = { lines: [] as string[], count: 0, truncated: false };
      await collectBlocks(pageId, 0, state);
      const limited = truncateText(state.lines.join("\n\n"), maxTextChars);
      return {
        id: meta.id,
        title: meta.title,
        object: "page",
        text: limited.text,
        extraction: limited.text ? "blocks" : "empty",
        truncated: state.truncated || limited.truncated,
        url: meta.url,
        lastEditedTime: meta.lastEditedTime,
      };
    },

    async listChildPages(pageId: string): Promise<NotionObjectMeta[]> {
      const pages: NotionObjectMeta[] = [];
      let cursor: string | undefined;
      do {
        const parsed = asRecord(await blockChildren(pageId, cursor));
        const results = Array.isArray(parsed?.results) ? parsed.results : [];
        for (const raw of results) {
          const block = asRecord(raw);
          const child = asRecord(block?.child_page);
          const id = stringField(block?.id);
          const title = stringField(child?.title);
          if (id && title) {
            pages.push({
              id,
              object: "page",
              title,
              parent: { type: "page_id", pageId },
            });
          }
        }
        cursor = stringField(parsed?.next_cursor);
      } while (cursor);
      return pages;
    },

    async createPage(params: NotionWriteParams): Promise<NotionWriteResult> {
      const title = requireNonEmpty(params.title, "title");
      const children = buildNotionBlocks(params.content);
      const raw = await getJson("/pages", {
        method: "POST",
        body: JSON.stringify({
          parent: parentPayload(params),
          properties: createPageProperties(title),
          ...(children.length ? { children } : {}),
        }),
      });
      const meta = parseNotionObject(raw);
      if (!meta || meta.object !== "page") {
        throw new NotionApiError(
          502,
          "Notion 이 알 수 없는 형식의 페이지 생성 응답을 보냈습니다.",
        );
      }
      return {
        action: "create_page",
        pageId: meta.id,
        title: meta.title,
        url: meta.url,
        appendedBlocks: children.length,
      };
    },

    async appendBlocks(params: NotionWriteParams): Promise<NotionWriteResult> {
      const pageId = requireNonEmpty(params.pageId, "pageId");
      const children = buildNotionBlocks(params.content);
      if (children.length === 0) {
        throw new NotionApiError(400, "추가할 content 블록이 필요합니다.");
      }
      await getJson(`/blocks/${encodeURIComponent(pageId)}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children }),
      });
      return {
        action: "append_blocks",
        pageId,
        appendedBlocks: children.length,
      };
    },
  };
}

export function sameNotionId(a: string, b: string): boolean {
  return normalizeNotionId(a) === normalizeNotionId(b);
}
