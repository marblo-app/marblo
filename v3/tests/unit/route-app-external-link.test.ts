import { describe, expect, it, vi } from "vitest";
import {
  BrowserPaneOpenUrlDelivery,
  browserPaneNoticeForExternalReason,
  routeExternalLinkClick,
  type AppExternalLinkEffects,
  type BrowserPaneOpenUrlSender,
} from "../../electron/in-app-browser-policy";

/**
 * Behavior tests for the top-level link-click path — the one a click in a
 * markdown preview, a `target="_blank"`, or a `will-navigate` takes.
 *
 * These drive `routeExternalLinkClick`, which `electron/main.ts`'s
 * `routeAppExternalLink` is now a thin adapter over, so what runs here is the
 * shipping decision rather than a restatement of it. (This file used to assert
 * on the *text* of main.ts, which passed happily while the behavior it claimed
 * to protect was broken.)
 *
 * Ack delivery is driven by an injected clock so the 1500ms timeout is a test
 * assertion, not a wait.
 */

function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance: (ms: number) => {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

const ACK_TIMEOUT_MS = 1500;

/**
 * A stand-in for the running app: a window that may or may not have a Web tab
 * surface registered, a renderer that may or may not ack, and the two exits a
 * link can take (an app tab, or the OS browser) plus the notices the user sees.
 */
function makeApp(options: { hasOpenTarget: boolean; rendererAcks: boolean }) {
  const clock = makeClock();
  const openedExternally: string[] = [];
  const notices: string[] = [];
  const openedInTab: string[] = [];
  let requestSeq = 0;

  const owner: BrowserPaneOpenUrlSender = {
    id: 42,
    isDestroyed: () => false,
    send: vi.fn((_channel, payload) => {
      openedInTab.push(payload.url);
      // The renderer creates the pane, surfaces the Web tab, and acks — all
      // synchronously (see src/lib/openLinkInWebTab.ts).
      if (options.rendererAcks) delivery.acknowledge(owner.id, payload.requestId);
    }),
  };

  const delivery = new BrowserPaneOpenUrlDelivery({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    generateRequestId: () => `req-${++requestSeq}`,
    ackTimeoutMs: ACK_TIMEOUT_MS,
    onDeliveryFailed: (_sender, url) => {
      // Mirrors main's handleBrowserPaneOpenDeliveryFailure.
      const notice = browserPaneNoticeForExternalReason("tab-open-failed");
      if (notice) notices.push(notice.code);
      openedExternally.push(url);
    },
  });

  const effects: AppExternalLinkEffects = {
    openInTab: (url) => delivery.send(owner, url),
    openExternal: (url) => openedExternally.push(url),
    notify: (notice) => notices.push(notice.code),
  };

  return {
    clock,
    openedExternally,
    openedInTab,
    notices,
    click: (url: string) =>
      routeExternalLinkClick(url, options.hasOpenTarget, effects),
  };
}

/** The workspace is open and the renderer behaves — the normal case. */
function healthyApp() {
  return makeApp({ hasOpenTarget: true, rendererAcks: true });
}

describe("clicking a link with a Web tab surface open (ticket pmpcvaEsswlsOLJDwer6)", () => {
  it("opens an ordinary external site as an app tab instead of leaving the app", () => {
    const app = healthyApp();
    app.click("https://github.com/melocream/marblo");

    expect(app.openedInTab).toEqual(["https://github.com/melocream/marblo"]);
    expect(app.openedExternally).toEqual([]);
    expect(app.notices).toEqual([]);
  });

  it("opens a bare typed host as an app tab, normalized to https", () => {
    const app = healthyApp();
    app.click("example.com/docs");
    expect(app.openedInTab).toEqual(["https://example.com/docs"]);
    expect(app.openedExternally).toEqual([]);
  });

  it("opens a local demo on another loopback port as an app tab", () => {
    const app = healthyApp();
    app.click("http://localhost:8791/demo.html");
    expect(app.openedInTab).toEqual(["http://localhost:8791/demo.html"]);
    expect(app.openedExternally).toEqual([]);
  });

  it("sends sign-in, OAuth and payment links to the OS browser, saying why", () => {
    for (const [url, code] of [
      ["https://accounts.google.com/signin", "google-auth-external"],
      ["https://github.com/login/oauth/authorize", "auth-external"],
      ["https://checkout.stripe.com/pay/cs_test", "payment-external"],
    ] as const) {
      const app = healthyApp();
      app.click(url);
      expect(app.openedInTab).toEqual([]);
      expect(app.openedExternally).toEqual([url]);
      expect(app.notices).toEqual([code]);
    }
  });

  it("hands mailto: to the OS's default app, saying why", () => {
    const app = healthyApp();
    app.click("mailto:hello@example.com");
    expect(app.openedInTab).toEqual([]);
    expect(app.openedExternally).toEqual(["mailto:hello@example.com"]);
    expect(app.notices).toEqual(["external-protocol"]);
  });

  it("blocks an unsupported scheme without opening anything, and says so", () => {
    const app = healthyApp();
    app.click("javascript:alert(1)");
    expect(app.openedInTab).toEqual([]);
    expect(app.openedExternally).toEqual([]);
    expect(app.notices).toEqual(["unsupported-protocol"]);
  });
});

describe("clicking a link with no window able to host a Web tab", () => {
  it("falls back to the OS browser and explains why, instead of leaving silently", () => {
    // The exact regression: this branch used to carry `notice: null`, so the
    // OS browser appeared with nothing said. That is what the CEO reported.
    const app = makeApp({ hasOpenTarget: false, rendererAcks: true });
    app.click("https://github.com/melocream/marblo");

    expect(app.openedInTab).toEqual([]);
    expect(app.openedExternally).toEqual(["https://github.com/melocream/marblo"]);
    expect(app.notices).toEqual(["no-tab-target"]);
  });
});

describe("the renderer never acknowledges the open (ticket GiChqmgXxSQxdUwo3NLq)", () => {
  it("falls back to the OS browser once the ack timeout elapses, with a notice", () => {
    const app = makeApp({ hasOpenTarget: true, rendererAcks: false });
    app.click("https://github.com/melocream/marblo");

    // The tab was attempted, so nothing has left the app yet.
    expect(app.openedInTab).toEqual(["https://github.com/melocream/marblo"]);
    expect(app.openedExternally).toEqual([]);
    expect(app.notices).toEqual([]);

    app.clock.advance(ACK_TIMEOUT_MS - 1);
    expect(app.openedExternally).toEqual([]);

    app.clock.advance(1);
    expect(app.openedExternally).toEqual([
      "https://github.com/melocream/marblo",
    ]);
    // "tab-open-failed", not "open-failed" — the OS-browser open is still
    // expected to succeed, so the notice must not claim otherwise.
    expect(app.notices).toEqual(["tab-open-failed"]);
  });

  it("does not fall back when the renderer acks in time", () => {
    const app = healthyApp();
    app.click("https://github.com/melocream/marblo");

    app.clock.advance(ACK_TIMEOUT_MS * 10);
    expect(app.openedExternally).toEqual([]);
    expect(app.notices).toEqual([]);
  });
});
