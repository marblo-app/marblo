import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SafeStorage } from "electron";

const STORE_DIRECTORY = path.join(os.homedir(), ".marblo");
const STORE_FILE = path.join(STORE_DIRECTORY, "github-oauth.enc.json");

interface EncryptedTokenStore {
  tokens: Record<string, string>;
}

function readStore(): EncryptedTokenStore {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && "tokens" in parsed) {
      const tokens = (parsed as { tokens?: unknown }).tokens;
      if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
        return { tokens: { ...(tokens as Record<string, string>) } };
      }
    }
  } catch {
    // A missing or malformed local store is equivalent to no connected account.
  }
  return { tokens: {} };
}

function writeStore(store: EncryptedTokenStore): void {
  fs.mkdirSync(STORE_DIRECTORY, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
}

function assertSafeStorage(storage: SafeStorage): void {
  if (!storage.isEncryptionAvailable()) {
    throw new Error("OS 키체인을 사용할 수 없어 GitHub 연결 정보를 저장할 수 없습니다.");
  }
}

export function getGitHubToken(storage: SafeStorage, userId: string): string | null {
  try {
    assertSafeStorage(storage);
    const encrypted = readStore().tokens[userId];
    return encrypted ? storage.decryptString(Buffer.from(encrypted, "base64")) : null;
  } catch {
    return null;
  }
}

export function saveGitHubToken(storage: SafeStorage, userId: string, token: string): void {
  assertSafeStorage(storage);
  const store = readStore();
  store.tokens[userId] = storage.encryptString(token).toString("base64");
  writeStore(store);
}

export function removeGitHubToken(storage: SafeStorage, userId: string): void {
  assertSafeStorage(storage);
  const store = readStore();
  delete store.tokens[userId];
  writeStore(store);
}
