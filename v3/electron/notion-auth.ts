import type { SafeStorage } from "electron";
import {
  createNotionConnector,
  type NotionConnector,
  type NotionFetchLike,
} from "./notion-connector";
import {
  getNotionTokens,
  notionConnectionStatus,
  removeNotionTokens,
  saveNotionTokens,
  type NotionConnectionStatus,
} from "./notion-token-store";

export type NotionConnectResult =
  | { ok: true; status: NotionConnectionStatus }
  | { ok: false; error: string };

export class NotionNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionNotConnectedError";
  }
}

const NOTION_TOKEN_RE = /^secret_[A-Za-z0-9]{20,}|^ntn_[A-Za-z0-9_-]{20,}/;

export function isPlausibleNotionToken(value: unknown): value is string {
  return typeof value === "string" && NOTION_TOKEN_RE.test(value.trim());
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function connectNotionWithIntegrationToken(
  storage: SafeStorage,
  userId: string,
  input: {
    accessToken: string;
    workspaceName?: unknown;
    workspaceId?: unknown;
    botId?: unknown;
  },
): NotionConnectResult {
  if (!isPlausibleNotionToken(input.accessToken)) {
    return {
      ok: false,
      error: "Notion integration token 형식이 올바르지 않습니다.",
    };
  }
  try {
    saveNotionTokens(storage, userId, {
      accessToken: input.accessToken.trim(),
      workspaceName: normalizeOptional(input.workspaceName),
      workspaceId: normalizeOptional(input.workspaceId),
      botId: normalizeOptional(input.botId),
      connectedAt: Date.now(),
    });
    console.log("[notion] 연결됨", {
      userId,
      workspace: normalizeOptional(input.workspaceName) ? "set" : "unknown",
    });
    return { ok: true, status: notionConnectionStatus(storage, userId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function disconnectNotion(
  storage: SafeStorage,
  userId: string,
): { ok: boolean; error?: string } {
  try {
    removeNotionTokens(storage, userId);
    console.log("[notion] 연결 해제됨", { userId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function notionStatus(
  storage: SafeStorage,
  userId: string,
): NotionConnectionStatus {
  return notionConnectionStatus(storage, userId);
}

export async function getNotionAccessToken(
  storage: SafeStorage,
  userId: string,
): Promise<string> {
  const tokens = getNotionTokens(storage, userId);
  if (!tokens) {
    throw new NotionNotConnectedError(
      "Notion 이 연결되어 있지 않습니다. Harness 탭에서 Notion 을 연결해 주세요.",
    );
  }
  return tokens.accessToken;
}

export function createUserNotionConnector(
  storage: SafeStorage,
  userId: string,
  fetchImpl?: NotionFetchLike,
): NotionConnector {
  return createNotionConnector({
    getAccessToken: () => getNotionAccessToken(storage, userId),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
