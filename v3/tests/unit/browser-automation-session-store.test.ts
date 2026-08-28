import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SafeStorage } from "electron";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  BrowserSessionStore,
  deriveSiteKeyFromOrigins,
} from "../../electron/web-automation/browser-session-store";
import { ChromeBrowserSessionManager } from "../../electron/web-automation/browser-session-manager";
import {
  assertPromptSnapshotIsSafe,
  BROWSER_SESSION_LEAKAGE_GUARDS,
  redactBrowserSessionValue,
} from "../../electron/web-automation/leakage-guards";
import type { BrowserStorageState } from "../../electron/web-automation/types";

class FakeSafeStorage {
  constructor(private readonly available = true) {}

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(plainText: string): Buffer {
    return Buffer.from(
      `encrypted:${Buffer.from(plainText).toString("base64")}`,
    );
  }

  decryptString(encrypted: Buffer): string {
    const text = encrypted.toString("utf8");
    if (!text.startsWith("encrypted:")) throw new Error("bad ciphertext");
    return Buffer.from(text.slice("encrypted:".length), "base64").toString(
      "utf8",
    );
  }
}

const USER_ID = "user_123";
const SITE_KEY = "example.com";
const ORIGIN = "https://admin.example.com";
const COOKIE_SECRET = "session-cookie-secret";
const LOCAL_STORAGE_SECRET = "local-storage-secret";

function safeStorage(available = true): SafeStorage {
  return new FakeSafeStorage(available) as unknown as SafeStorage;
}

function storageState(): BrowserStorageState {
  return {
    cookies: [
      {
        name: "sid",
        value: COOKIE_SECRET,
        domain: ".example.com",
        path: "/",
        expires: 4_000,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [
      {
        origin: ORIGIN,
        localStorage: [{ name: "auth", value: LOCAL_STORAGE_SECRET }],
      },
    ],
  };
}

describe("browser automation session storage", () => {
  let dir: string;
  let storeFile: string;
  let store: BrowserSessionStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-browser-session-"));
    storeFile = path.join(dir, "browser-sessions.enc.json");
    store = new BrowserSessionStore({
      storeFile,
      verificationStaleMs: 1_000,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("safeStorage 없이는 평문 fallback 없이 저장을 거부한다", () => {
    expect(() =>
      store.saveSession(safeStorage(false), {
        userId: USER_ID,
        siteKey: SITE_KEY,
        origins: [ORIGIN],
        storageState: storageState(),
        consentLabel: "example.com 로그인 세션 저장",
      }),
    ).toThrow(/평문으로 저장하지 않습니다/);
    expect(fs.existsSync(storeFile)).toBe(false);
  });

  it("저장 파일에는 세션 원문이 없고 list 는 사이트 요약만 반환한다", () => {
    const summary = store.saveSession(safeStorage(), {
      userId: USER_ID,
      siteKey: SITE_KEY,
      origins: [`${ORIGIN}/ignored/path`],
      storageState: storageState(),
      consentLabel: "example.com 로그인 세션 저장",
      capturedAt: 1_000,
      lastVerifiedAt: 1_000,
      expiresAt: 3_000,
    });

    expect(summary).toMatchObject({
      connected: true,
      siteKey: SITE_KEY,
      origins: [ORIGIN],
      browserChannel: "chrome",
      status: "READY",
      cookieCount: 1,
      localStorageOriginCount: 1,
    });

    const fileText = fs.readFileSync(storeFile, "utf8");
    expect(fileText).not.toContain(COOKIE_SECRET);
    expect(fileText).not.toContain(LOCAL_STORAGE_SECRET);

    const listedJson = JSON.stringify(
      store.listSessions(safeStorage(), USER_ID, 1_500),
    );
    expect(listedJson).toContain(SITE_KEY);
    expect(listedJson).not.toContain(COOKIE_SECRET);
    expect(listedJson).not.toContain(LOCAL_STORAGE_SECRET);
  });

  it("복원은 자동화 내부 API 에서만 평문 storageState 를 돌려주고 삭제는 멱등이다", () => {
    store.saveSession(safeStorage(), {
      userId: USER_ID,
      siteKey: SITE_KEY,
      origins: [ORIGIN],
      storageState: storageState(),
      consentLabel: "example.com 로그인 세션 저장",
      capturedAt: 1_000,
      expiresAt: 3_000,
    });

    const restored = store.getSessionForAutomation(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      1_500,
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error("expected stored session");
    expect(restored.session.record.storageState.cookies[0].value).toBe(
      COOKIE_SECRET,
    );

    store.deleteSession(safeStorage(false), USER_ID, SITE_KEY);
    store.deleteSession(safeStorage(false), USER_ID, SITE_KEY);
    expect(store.listSessions(safeStorage(), USER_ID)).toEqual([]);
  });

  it("세션은 반드시 만료되고 만료/오래된 검증은 사람 호출 상태로 멈춘다", () => {
    store.saveSession(safeStorage(), {
      userId: USER_ID,
      siteKey: SITE_KEY,
      origins: [ORIGIN],
      storageState: storageState(),
      consentLabel: "example.com 로그인 세션 저장",
      capturedAt: 1_000,
      lastVerifiedAt: 1_000,
      expiresAt: 3_000,
    });

    const expired = store.getSessionForAutomation(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      3_001,
    );
    expect(expired).toMatchObject({
      ok: false,
      status: "NEEDS_HUMAN_AUTH",
      humanActionReason: "SESSION_EXPIRED",
    });

    const stale = store.getSessionForAutomation(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      2_500,
    );
    expect(stale).toMatchObject({
      ok: false,
      status: "NEEDS_HUMAN_AUTH",
      humanActionReason: "SESSION_VERIFICATION_STALE",
    });
  });

  it("인증 게이트 감지는 사람 호출로 멈추고 3회 실패는 EXPIRED_DISABLED 로 전환한다", () => {
    store.saveSession(safeStorage(), {
      userId: USER_ID,
      siteKey: SITE_KEY,
      origins: [ORIGIN],
      storageState: storageState(),
      consentLabel: "example.com 로그인 세션 저장",
      capturedAt: 1_000,
      lastVerifiedAt: 2_000,
      expiresAt: 10_000,
    });

    store.recordAuthFailure(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      "AUTH_GATE_DETECTED",
      3_000,
    );
    const needsHuman = store.getSessionForAutomation(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      3_500,
    );
    expect(needsHuman).toMatchObject({
      ok: false,
      status: "NEEDS_HUMAN_AUTH",
      humanActionReason: "AUTH_GATE_DETECTED",
    });

    store.recordAuthFailure(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      "AUTH_GATE_DETECTED",
      4_000,
    );
    store.recordAuthFailure(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      "AUTH_GATE_DETECTED",
      5_000,
    );

    const disabled = store.getSessionForAutomation(
      safeStorage(),
      USER_ID,
      SITE_KEY,
      6_000,
    );
    expect(disabled).toMatchObject({
      ok: false,
      status: "EXPIRED_DISABLED",
      humanActionReason: "CONSECUTIVE_AUTH_FAILURES",
    });
  });

  it("siteKey 는 origin 에서 파생 가능하고 세션 보관 가드 목록은 유출 경로를 명시한다", () => {
    expect(deriveSiteKeyFromOrigins([ORIGIN])).toBe(SITE_KEY);
    expect(BROWSER_SESSION_LEAKAGE_GUARDS.map((g) => g.path)).toEqual(
      expect.arrayContaining([
        "logs",
        "telemetry",
        "crash_dumps",
        "agent_prompts",
        "ipc",
        "temp_files",
      ]),
    );
  });

  it("에이전트 프롬프트에는 storage/header/body/hidden DOM 을 넣을 수 없다", () => {
    expect(() =>
      assertPromptSnapshotIsSafe({
        role: "textbox",
        label: "정산 금액",
        storageState: storageState(),
      }),
    ).toThrow(/blocked session field: storageState/);

    expect(
      redactBrowserSessionValue({
        visibleText: "정산 금액",
        cookies: [{ value: COOKIE_SECRET }],
      }),
    ).toEqual({
      visibleText: "정산 금액",
      cookies: "<REDACTED_BROWSER_SESSION>",
    });
  });
});

describe("ChromeBrowserSessionManager", () => {
  it('channel:"chrome" 로만 기동/종료 probe 를 수행한다', async () => {
    const close = vi.fn(async () => undefined);
    const launch = vi.fn(async () => ({
      close,
      newContext: vi.fn(),
    }));
    const manager = new ChromeBrowserSessionManager({
      runtimeLoader: async () => ({ chromium: { launch } }),
    });

    await expect(manager.probeChrome()).resolves.toEqual({
      ok: true,
      browserChannel: "chrome",
    });
    expect(launch).toHaveBeenCalledWith({ channel: "chrome", headless: true });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Chrome 미설치 시 Edge/Brave 자동 폴백 없이 NEEDS_BROWSER_INSTALL 로 멈춘다", async () => {
    const launch = vi.fn(async () => {
      throw new Error(
        "browserType.launch: Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app",
      );
    });
    const manager = new ChromeBrowserSessionManager({
      runtimeLoader: async () => ({ chromium: { launch } }),
    });

    await expect(manager.probeChrome()).resolves.toMatchObject({
      ok: false,
      status: "NEEDS_BROWSER_INSTALL",
      humanActionReason: "CHROME_NOT_INSTALLED",
      browserChannel: "chrome",
    });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith({ channel: "chrome", headless: true });
  });

  it("저장 세션을 메모리 storageState 로 복원하고 closeSession 이 context/browser 를 닫는다", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "marblo-browser-session-"),
    );
    const managerStoreFile = path.join(dir, "browser-sessions.enc.json");
    const closeBrowser = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const newContext = vi.fn(async () => ({ close: closeContext }));
    const launch = vi.fn(async () => ({
      close: closeBrowser,
      newContext,
    }));
    const store = new BrowserSessionStore({
      storeFile: managerStoreFile,
      verificationStaleMs: 10_000,
    });
    try {
      const now = Date.now();
      store.saveSession(safeStorage(), {
        userId: USER_ID,
        siteKey: SITE_KEY,
        origins: [ORIGIN],
        storageState: storageState(),
        consentLabel: "example.com 로그인 세션 저장",
        capturedAt: now,
        lastVerifiedAt: now,
        expiresAt: now + 10_000,
      });
      const manager = new ChromeBrowserSessionManager({
        runtimeLoader: async () => ({ chromium: { launch } }),
        store,
      });

      const launched = await manager.launchStoredSession(safeStorage(), {
        userId: USER_ID,
        siteKey: SITE_KEY,
      });
      expect(launched.ok).toBe(true);
      if (!launched.ok) throw new Error("expected launched session");
      expect(newContext).toHaveBeenCalledWith({ storageState: storageState() });
      await expect(manager.closeSession(launched.session.id)).resolves.toBe(
        true,
      );
      expect(closeContext).toHaveBeenCalledTimes(1);
      expect(closeBrowser).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
