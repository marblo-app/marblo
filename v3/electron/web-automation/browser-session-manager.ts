import { randomUUID } from "node:crypto";
import type { SafeStorage } from "electron";

import { BrowserSessionStore } from "./browser-session-store";
import {
  BROWSER_AUTOMATION_CHANNEL,
  type BrowserSessionHumanActionReason,
  type BrowserStorageState,
} from "./types";

interface BrowserLike {
  newContext(options?: {
    storageState?: BrowserStorageState;
  }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  close(): Promise<void>;
}

interface ChromiumLike {
  launch(options: {
    channel: typeof BROWSER_AUTOMATION_CHANNEL;
    headless: boolean;
  }): Promise<BrowserLike>;
}

export interface ChromeBrowserRuntime {
  chromium: ChromiumLike;
}

export interface ActiveBrowserSession {
  id: string;
  userId: string;
  siteKey: string;
  browserChannel: typeof BROWSER_AUTOMATION_CHANNEL;
  startedAt: number;
}

export type ChromeProbeResult =
  | { ok: true; browserChannel: typeof BROWSER_AUTOMATION_CHANNEL }
  | {
      ok: false;
      status: "NEEDS_BROWSER_INSTALL";
      browserChannel: typeof BROWSER_AUTOMATION_CHANNEL;
      humanActionReason: "CHROME_NOT_INSTALLED";
      message: string;
    };

type StoredSessionLaunchHumanActionReason =
  | "CHROME_NOT_INSTALLED"
  | BrowserSessionHumanActionReason;

export type LaunchStoredBrowserSessionResult =
  | { ok: true; session: ActiveBrowserSession }
  | {
      ok: false;
      status: "NEEDS_BROWSER_INSTALL" | "NEEDS_HUMAN_AUTH" | "EXPIRED_DISABLED";
      humanActionReason: StoredSessionLaunchHumanActionReason;
      message: string;
    };

interface ActiveRuntimeSession extends ActiveBrowserSession {
  browser: BrowserLike;
  context: BrowserContextLike;
}

export class ChromeBrowserSessionManager {
  private readonly sessions = new Map<string, ActiveRuntimeSession>();
  private readonly runtimeLoader: () => Promise<ChromeBrowserRuntime>;
  private readonly store: BrowserSessionStore;

  constructor(
    options: {
      runtimeLoader?: () => Promise<ChromeBrowserRuntime>;
      store?: BrowserSessionStore;
    } = {},
  ) {
    this.runtimeLoader = options.runtimeLoader ?? loadPlaywrightRuntime;
    this.store = options.store ?? new BrowserSessionStore();
  }

  async probeChrome(): Promise<ChromeProbeResult> {
    const launch = await this.launchChrome(true);
    if (!launch.ok) return launch;
    await launch.browser.close();
    return { ok: true, browserChannel: BROWSER_AUTOMATION_CHANNEL };
  }

  async launchStoredSession(
    storage: SafeStorage,
    input: { userId: string; siteKey: string; headless?: boolean },
  ): Promise<LaunchStoredBrowserSessionResult> {
    const stored = this.store.getSessionForAutomation(
      storage,
      input.userId,
      input.siteKey,
    );
    if (!stored.ok) {
      return {
        ok: false,
        status: stored.status,
        humanActionReason: stored.humanActionReason,
        message: humanActionMessage(stored.humanActionReason),
      };
    }

    const launch = await this.launchChrome(input.headless ?? true);
    if (!launch.ok) return launch;

    try {
      const context = await launch.browser.newContext({
        storageState: stored.session.record.storageState,
      });
      const session: ActiveRuntimeSession = {
        id: randomUUID(),
        userId: input.userId,
        siteKey: stored.session.siteKey,
        browserChannel: BROWSER_AUTOMATION_CHANNEL,
        startedAt: Date.now(),
        browser: launch.browser,
        context,
      };
      this.sessions.set(session.id, session);
      return {
        ok: true,
        session: {
          id: session.id,
          userId: session.userId,
          siteKey: session.siteKey,
          browserChannel: session.browserChannel,
          startedAt: session.startedAt,
        },
      };
    } catch (error) {
      await launch.browser.close().catch(() => undefined);
      throw new Error(
        `브라우저 세션 복원에 실패했습니다: ${safeErrorMessage(error)}`,
      );
    }
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    return true;
  }

  activeSessions(): ActiveBrowserSession[] {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      userId: session.userId,
      siteKey: session.siteKey,
      browserChannel: session.browserChannel,
      startedAt: session.startedAt,
    }));
  }

  private async launchChrome(headless: boolean): Promise<
    | { ok: true; browser: BrowserLike }
    | {
        ok: false;
        status: "NEEDS_BROWSER_INSTALL";
        browserChannel: typeof BROWSER_AUTOMATION_CHANNEL;
        humanActionReason: "CHROME_NOT_INSTALLED";
        message: string;
      }
  > {
    try {
      const runtime = await this.runtimeLoader();
      const browser = await runtime.chromium.launch({
        channel: BROWSER_AUTOMATION_CHANNEL,
        headless,
      });
      return { ok: true, browser };
    } catch (error) {
      if (isChromeMissingError(error)) {
        return {
          ok: false,
          status: "NEEDS_BROWSER_INSTALL",
          browserChannel: BROWSER_AUTOMATION_CHANNEL,
          humanActionReason: "CHROME_NOT_INSTALLED",
          message: humanActionMessage("CHROME_NOT_INSTALLED"),
        };
      }
      throw new Error(
        `Chrome 브라우저 기동에 실패했습니다: ${safeErrorMessage(error)}`,
      );
    }
  }
}

export const chromeBrowserSessionManager = new ChromeBrowserSessionManager();

async function loadPlaywrightRuntime(): Promise<ChromeBrowserRuntime> {
  const runtime: unknown = await import("playwright");
  if (
    !runtime ||
    typeof runtime !== "object" ||
    !("chromium" in runtime) ||
    typeof (runtime as { chromium?: unknown }).chromium !== "object"
  ) {
    throw new Error("Playwright Chromium runtime 을 찾을 수 없습니다.");
  }
  return runtime as ChromeBrowserRuntime;
}

export function isChromeMissingError(error: unknown): boolean {
  const message = safeErrorMessage(error);
  return (
    message.includes("Chromium distribution 'chrome' is not found") ||
    (message.includes("Google Chrome") && message.includes("not found")) ||
    message.includes("Executable doesn't exist") ||
    message.includes("browserType.launch: Chromium distribution")
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0];
  return "알 수 없는 오류";
}

function humanActionMessage(
  reason: StoredSessionLaunchHumanActionReason,
): string {
  switch (reason) {
    case "CHROME_NOT_INSTALLED":
      return "Google Chrome 설치 후 다시 시도해야 합니다. Edge/Brave 로 자동 전환하지 않습니다.";
    case "NO_STORED_SESSION":
      return "이 사이트의 저장된 로그인 세션이 없어 사람이 로그인해야 합니다.";
    case "SESSION_EXPIRED":
      return "저장된 사이트 로그인 세션이 만료되어 사람이 다시 로그인해야 합니다.";
    case "SESSION_VERIFICATION_STALE":
      return "사이트 로그인 세션 검증 시각이 오래되어 사람이 확인해야 합니다.";
    case "CONSECUTIVE_AUTH_FAILURES":
      return "반복 인증 실패로 자동 실행을 멈췄습니다. 사람이 로그인 세션을 갱신해야 합니다.";
    case "AUTH_GATE_DETECTED":
      return "로그인 화면이 감지되어 사람이 사이트 로그인 세션을 갱신해야 합니다.";
    case "MFA_REQUIRED":
      return "2단계 인증이 필요해 사람이 직접 인증해야 합니다.";
    case "CAPTCHA_REQUIRED":
      return "CAPTCHA 가 감지되어 사람이 직접 확인해야 합니다.";
  }
}
