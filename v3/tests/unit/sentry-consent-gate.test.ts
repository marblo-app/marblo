/**
 * Sentry consent + DSN gate (renderer wrapper).
 *
 * Proves the two no-op invariants the privacy design depends on:
 *   1. Consent OFF  → NOTHING initializes (no main IPC, no renderer SDK).
 *   2. DSN absent   → NOTHING initializes, even with consent ON.
 * And that the gate is *live*, not a dead path: consent ON + DSN present DOES
 * init main (with dsn/release/environment) then the renderer SDK (with the PII
 * scrubber as beforeSend). Also that captureException is inert until init.
 *
 * These are the paths flagged as "단위검증 필수" — a regression here would
 * either leak data without consent (PIPA violation) or silently disable crash
 * capture once a DSN is configured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Spies for the dynamically-imported @sentry/electron/renderer module.
const h = vi.hoisted(() => ({
  rendererInit: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/electron/renderer", () => ({
  init: h.rendererInit,
  captureException: h.captureException,
  captureMessage: h.captureMessage,
}));

const DSN = "https://abc123@o1.ingest.sentry.io/42";
const initMain = vi.fn();

beforeEach(() => {
  vi.resetModules(); // re-evaluate sentry.ts so it re-reads VITE_SENTRY_DSN
  h.rendererInit.mockClear();
  h.captureException.mockClear();
  h.captureMessage.mockClear();
  initMain.mockReset();
  initMain.mockResolvedValue({ ok: true });
  // Renderer code references `window.electronAPI` — provide it on the global.
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: { sentry: { initMain } },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("maybeInitSentry — no-op invariants", () => {
  it("consent OFF → no main init, no renderer init (even with a DSN)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    const { maybeInitSentry } = await import("../../src/lib/telemetry/sentry");

    await maybeInitSentry(false);

    expect(initMain).not.toHaveBeenCalled();
    expect(h.rendererInit).not.toHaveBeenCalled();
  });

  it("consent ON but DSN absent → complete no-op", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", ""); // empty = unconfigured
    const { maybeInitSentry } = await import("../../src/lib/telemetry/sentry");

    await maybeInitSentry(true);

    expect(initMain).not.toHaveBeenCalled();
    expect(h.rendererInit).not.toHaveBeenCalled();
  });

  it("main bridge unavailable → no-op even with consent + DSN", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    (globalThis as unknown as { window: unknown }).window = { electronAPI: {} };
    const { maybeInitSentry } = await import("../../src/lib/telemetry/sentry");

    await maybeInitSentry(true);

    expect(h.rendererInit).not.toHaveBeenCalled();
  });
});

describe("maybeInitSentry — live path (proves the gate is real)", () => {
  it("consent ON + DSN → inits main (dsn/environment) then renderer (scrub beforeSend)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    const { maybeInitSentry } = await import("../../src/lib/telemetry/sentry");

    await maybeInitSentry(true);

    expect(initMain).toHaveBeenCalledTimes(1);
    const mainArgs = initMain.mock.calls[0][0] as {
      dsn: string;
      environment: string;
      release?: string;
    };
    expect(mainArgs.dsn).toBe(DSN);
    expect(mainArgs.environment).toBeTruthy();

    expect(h.rendererInit).toHaveBeenCalledTimes(1);
    const rendererArgs = h.rendererInit.mock.calls[0][0] as {
      beforeSend: (e: unknown) => unknown;
      dsn?: unknown;
    };
    // DSN must NOT be passed to the renderer (deprecated there — inherited over IPC).
    expect(rendererArgs.dsn).toBeUndefined();
    expect(typeof rendererArgs.beforeSend).toBe("function");

    // Wire-through: the beforeSend actually scrubs PII (file path → masked).
    const scrubbed = rendererArgs.beforeSend({
      message: "boom at /Users/alice/secret/app.log",
    }) as { message: string };
    expect(scrubbed.message).not.toContain("/Users/alice");
    expect(scrubbed.message).toContain("<USER_HOME>");
  });

  it("is idempotent — a second call does not re-init", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    const { maybeInitSentry } = await import("../../src/lib/telemetry/sentry");

    await maybeInitSentry(true);
    await maybeInitSentry(true);

    expect(initMain).toHaveBeenCalledTimes(1);
    expect(h.rendererInit).toHaveBeenCalledTimes(1);
  });
});

describe("captureException gating", () => {
  it("no-ops (and never throws) before init", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const { captureException } = await import("../../src/lib/telemetry/sentry");

    expect(() => captureException(new Error("x"))).not.toThrow();
    expect(h.captureException).not.toHaveBeenCalled();
  });
});
