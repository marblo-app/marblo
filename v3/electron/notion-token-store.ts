import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SafeStorage } from "electron";

const STORE_DIRECTORY = path.join(os.homedir(), ".marblo");
const STORE_FILE = path.join(STORE_DIRECTORY, "notion-oauth.enc.json");

export interface NotionTokens {
  accessToken: string;
  workspaceName?: string;
  workspaceId?: string;
  botId?: string;
  connectedAt: number;
}

export interface NotionConnectionStatus {
  connected: boolean;
  workspaceName?: string;
  workspaceId?: string;
  botId?: string;
  connectedAt?: number;
}

interface EncryptedNotionStore {
  version: 1;
  accounts: Record<string, string>;
}

function readStore(): EncryptedNotionStore {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && "accounts" in parsed) {
      const accounts = (parsed as { accounts?: unknown }).accounts;
      if (
        accounts &&
        typeof accounts === "object" &&
        !Array.isArray(accounts)
      ) {
        return {
          version: 1,
          accounts: { ...(accounts as Record<string, string>) },
        };
      }
    }
  } catch {
    // Missing or malformed local store is equivalent to no connected Notion.
  }
  return { version: 1, accounts: {} };
}

function writeStore(store: EncryptedNotionStore): void {
  fs.mkdirSync(STORE_DIRECTORY, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(STORE_FILE, 0o600);
  } catch {
    /* best effort on platforms without chmod semantics */
  }
}

function assertSafeStorage(storage: SafeStorage): void {
  if (!storage.isEncryptionAvailable()) {
    throw new Error(
      "OS 키체인을 사용할 수 없어 Notion 연결 정보를 저장할 수 없습니다. " +
        "Linux 라면 libsecret-1-0 / gnome-keyring 설치 후 Marblo 를 재시작하세요.",
    );
  }
}

export function getNotionTokens(
  storage: SafeStorage,
  userId: string,
): NotionTokens | null {
  try {
    assertSafeStorage(storage);
    const encrypted = readStore().accounts[userId];
    if (!encrypted) return null;
    const plain = storage.decryptString(Buffer.from(encrypted, "base64"));
    const parsed: unknown = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object") return null;
    const tokens = parsed as Partial<NotionTokens>;
    if (typeof tokens.accessToken !== "string" || !tokens.accessToken) {
      return null;
    }
    return {
      accessToken: tokens.accessToken,
      workspaceName:
        typeof tokens.workspaceName === "string"
          ? tokens.workspaceName
          : undefined,
      workspaceId:
        typeof tokens.workspaceId === "string" ? tokens.workspaceId : undefined,
      botId: typeof tokens.botId === "string" ? tokens.botId : undefined,
      connectedAt:
        typeof tokens.connectedAt === "number" ? tokens.connectedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveNotionTokens(
  storage: SafeStorage,
  userId: string,
  tokens: NotionTokens,
): void {
  assertSafeStorage(storage);
  const store = readStore();
  store.accounts[userId] = storage
    .encryptString(JSON.stringify(tokens))
    .toString("base64");
  writeStore(store);
}

export function removeNotionTokens(
  _storage: SafeStorage,
  userId: string,
): void {
  const store = readStore();
  if (!(userId in store.accounts)) return;
  delete store.accounts[userId];
  writeStore(store);
}

export function notionConnectionStatus(
  storage: SafeStorage,
  userId: string,
): NotionConnectionStatus {
  const tokens = getNotionTokens(storage, userId);
  if (!tokens) return { connected: false };
  return {
    connected: true,
    workspaceName: tokens.workspaceName,
    workspaceId: tokens.workspaceId,
    botId: tokens.botId,
    connectedAt: tokens.connectedAt || undefined,
  };
}
