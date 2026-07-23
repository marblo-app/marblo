/**
 * Sentry init for the Electron MAIN process.
 *
 * ★ Why this file exists: the main-process half had no unit coverage, and a
 * real, total outage hid there for the entire life of the feature.
 * `@sentry/electron`'s default `ipcMode` is `Both` (Classic | Protocol), and
 * the Protocol half calls `protocol.registerSchemesAsPrivileged`, which
 * Electron only allows BEFORE the app 'ready' event — the SDK throws
 * "Sentry SDK should be initialized before the Electron app 'ready' event is
 * fired" otherwise. Our init is deliberately consent-driven and therefore
 * ALWAYS runs post-ready, so every single call threw: `initMainSentry`
 * returned false, the renderer saw `!res.ok` and bailed, and Sentry was dead
 * in every build (dev and production) regardless of DSN or consent.
 *
 * These tests pin the invariants that keep it alive:
 *   1. init passes `ipcMode: Classic` (the fix — no pre-ready requirement).
 *   2. no DSN → complete no-op (regression guard, PIPA).
 *   3. idempotent, and an SDK throw is swallowed into `false` rather than
 *      crashing the main process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ init: vi.fn() }));

// IPCMode mirrors the real enum in @sentry/electron/common/ipc.js.
vi.mock("@sentry/electron/main", () => ({
  init: h.init,
  IPCMode: { Classic: 1, Protocol: 2, Both: 3 },
}));

beforeEach(() => {
  vi.resetModules(); // module-level `initialized` latch must be fresh
  h.init.mockReset();
});

const OPTS = {
  dsn: "https://abc123@o1.ingest.sentry.io/42",
  release: "marblo@3.0.17",
  environment: "production",
};

describe("initMainSentry", () => {
  it("★ passes ipcMode Classic so a POST-'ready' (consent-driven) init works", async () => {
    const { initMainSentry } = await import("../../electron/sentry-main");

    await expect(initMainSentry(OPTS)).resolves.toBe(true);

    expect(h.init).toHaveBeenCalledTimes(1);
    const args = h.init.mock.calls[0][0] as { ipcMode?: number };
    // 1 === IPCMode.Classic. Anything else (incl. undefined → SDK default
    // `Both`) reintroduces the pre-ready protocol registration and makes
    // every consent-driven init throw.
    expect(args.ipcMode).toBe(1);
  });

  it("forwards dsn/release/environment and never sends default PII", async () => {
    const { initMainSentry } = await import("../../electron/sentry-main");

    await initMainSentry(OPTS);

    const args = h.init.mock.calls[0][0] as {
      dsn: string;
      release?: string;
      environment?: string;
      sendDefaultPii?: boolean;
      beforeSend?: (e: unknown) => unknown;
    };
    expect(args.dsn).toBe(OPTS.dsn);
    expect(args.release).toBe(OPTS.release);
    expect(args.environment).toBe(OPTS.environment);
    expect(args.sendDefaultPii).toBe(false);
    expect(typeof args.beforeSend).toBe("function");
  });

  it("scrubs PII through beforeSend (path / email / api key / user)", async () => {
    const { initMainSentry } = await import("../../electron/sentry-main");
    await initMainSentry(OPTS);
    const { beforeSend } = h.init.mock.calls[0][0] as {
      beforeSend: (e: unknown) => Record<string, unknown>;
    };

    const out = beforeSend({
      message:
        "boom at /Users/alice/app.log for bob@example.com key sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA",
      user: { id: "u1", email: "bob@example.com" },
      server_name: "alices-macbook",
    });

    expect(out.message).toContain("<USER_HOME>");
    expect(out.message).toContain("<EMAIL>");
    expect(out.message).toContain("<API_KEY>");
    expect(out.message).not.toContain("/Users/alice");
    expect(out.message).not.toContain("sk-ant-A");
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
  });

  it("no DSN → complete no-op (SDK never touched)", async () => {
    const { initMainSentry, isMainSentryInitialized } =
      await import("../../electron/sentry-main");

    await expect(initMainSentry({})).resolves.toBe(false);
    await expect(initMainSentry({ dsn: "" })).resolves.toBe(false);

    expect(h.init).not.toHaveBeenCalled();
    expect(isMainSentryInitialized()).toBe(false);
  });

  it("is idempotent — a second call does not re-init", async () => {
    const { initMainSentry } = await import("../../electron/sentry-main");

    await initMainSentry(OPTS);
    await initMainSentry(OPTS);

    expect(h.init).toHaveBeenCalledTimes(1);
  });

  it("an SDK throw returns false instead of crashing the main process", async () => {
    h.init.mockImplementation(() => {
      throw new Error(
        "Sentry SDK should be initialized before the Electron app 'ready' event is fired",
      );
    });
    const { initMainSentry, isMainSentryInitialized } =
      await import("../../electron/sentry-main");

    await expect(initMainSentry(OPTS)).resolves.toBe(false);
    expect(isMainSentryInitialized()).toBe(false);
  });
});
