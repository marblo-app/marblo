import * as fs from "node:fs";
import * as path from "node:path";
import type { SafeStorage } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  WITHHELD_RESTRICTED_SCOPES,
} from "../../electron/google-restricted-scopes";

const tempHomes: string[] = [];

function fakeSafeStorage(): SafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, "utf8"),
    decryptString: (encrypted: Buffer) => encrypted.toString("utf8"),
  } as SafeStorage;
}

async function importStoreWithTempHome(): Promise<
  typeof import("../../electron/google-drive-token-store")
> {
  vi.resetModules();
  const home = fs.mkdtempSync(path.join(process.cwd(), ".tmp-google-store-"));
  tempHomes.push(home);
  vi.doMock("node:os", async () => {
    const actual = await vi.importActual<typeof import("node:os")>("node:os");
    return {
      ...actual,
      homedir: () => home,
    };
  });
  return import("../../electron/google-drive-token-store");
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("googleDriveConnectionStatus", () => {
  it("보류한 restricted/sensitive scope 는 UI 상태에서 숨긴다", async () => {
    const store = await importStoreWithTempHome();
    const storage = fakeSafeStorage();
    store.saveGoogleDriveTokens(storage, "user-1", {
      refreshToken: "refresh-token-for-test",
      scope: [
        "openid",
        "email",
        WITHHELD_RESTRICTED_SCOPES[0],
        CALENDAR_READONLY_SCOPE,
        GMAIL_SEND_SCOPE,
      ].join(" "),
      email: "user@example.com",
      connectedAt: 1_760_000_000_000,
    });

    expect(store.googleDriveConnectionStatus(storage, "user-1")).toEqual({
      connected: true,
      email: "user@example.com",
      scopes: ["openid", "email"],
      connectedAt: 1_760_000_000_000,
    });
  });
});
