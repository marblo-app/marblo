import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserPaneNoticeForExternalReason,
  BrowserPaneOpenUrlDelivery,
  type BrowserPaneOpenUrlSender,
  classifyInAppBrowserNavigation,
  normalizeBrowserPaneUrl,
  resolveBrowserPaneWindowOpen,
  resolveExternalLinkRouting,
} from "../../electron/in-app-browser-policy";

describe("in-app browser policy", () => {
  it("normalizes typed URLs for the browser pane", () => {
    expect(normalizeBrowserPaneUrl("localhost:3001")).toBe(
      "http://localhost:3001",
    );
    expect(normalizeBrowserPaneUrl("example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeBrowserPaneUrl("about:blank")).toBe("about:blank");
  });

  it("leaves a URL that already names a scheme alone", () => {
    // Prefixing https:// onto these does not just fail to help, it changes
    // what they mean: "https://mailto:hi@example.com" parses as example.com
    // with credentials, so an email link used to classify as an ordinary
    // allowed page and open in a tab.
    expect(normalizeBrowserPaneUrl("mailto:hi@example.com")).toBe(
      "mailto:hi@example.com",
    );
    expect(normalizeBrowserPaneUrl("tel:+15551234")).toBe("tel:+15551234");
    expect(normalizeBrowserPaneUrl("javascript:alert(1)")).toBe(
      "javascript:alert(1)",
    );
    // ...but a host:port is a host and a port, not a scheme.
    expect(normalizeBrowserPaneUrl("myhost:8080/path")).toBe(
      "https://myhost:8080/path",
    );
  });

  it("classifies a mailto: link as an external-protocol hand-off, not a page", () => {
    expect(
      classifyInAppBrowserNavigation(
        normalizeBrowserPaneUrl("mailto:hi@example.com"),
      ),
    ).toEqual({ action: "external", reason: "external-protocol" });
  });

  it("keeps ordinary http(s) sites inside the app tab", () => {
    expect(classifyInAppBrowserNavigation("https://example.com/admin")).toEqual(
      {
        action: "allow",
      },
    );
    expect(
      classifyInAppBrowserNavigation("https://settlement.example.co.kr"),
    ).toEqual({ action: "allow" });
  });

  it("sends Google auth and known payment flows to the system browser", () => {
    expect(
      classifyInAppBrowserNavigation(
        "https://accounts.google.com/o/oauth2/v2/auth",
      ),
    ).toEqual({ action: "external", reason: "google-auth" });
    expect(
      classifyInAppBrowserNavigation("https://checkout.stripe.com/c/pay/test"),
    ).toEqual({ action: "external", reason: "payment" });
  });

  it("blocks dangerous embedded schemes but allows safe external protocols", () => {
    expect(classifyInAppBrowserNavigation("javascript:alert(1)")).toEqual({
      action: "deny",
      reason: "unsupported-protocol",
    });
    expect(classifyInAppBrowserNavigation("mailto:hello@example.com")).toEqual({
      action: "external",
      reason: "external-protocol",
    });
  });

  it("explains Google embedded sign-in failures", () => {
    expect(browserPaneNoticeForExternalReason("google-auth")).toEqual({
      code: "google-auth-external",
      message:
        "Google blocks sign-in inside embedded browsers. Marblo opened it in your system browser instead.",
    });
  });

  it("explains every deny and open-failure reason too (bHuirRxD643VVvhdaWGM: no silent reason)", () => {
    expect(
      browserPaneNoticeForExternalReason("unsupported-protocol"),
    ).toMatchObject({ code: "unsupported-protocol" });
    expect(browserPaneNoticeForExternalReason("invalid-url")).toMatchObject({
      code: "invalid-url",
    });
    expect(browserPaneNoticeForExternalReason("open-failed")).toMatchObject({
      code: "open-failed",
    });
    expect(
      browserPaneNoticeForExternalReason("tab-open-failed"),
    ).toMatchObject({ code: "tab-open-failed" });
    expect(
      browserPaneNoticeForExternalReason("external-protocol"),
    ).toMatchObject({ code: "external-protocol" });
  });
});

describe("resolveExternalLinkRouting (routeAppExternalLink's three branches)", () => {
  it("routes a browser-pane window request without mutating the current pane", () => {
    expect(
      resolveBrowserPaneWindowOpen("https://github.com/melocream/marblo", true),
    ).toEqual({
      url: "https://github.com/melocream/marblo",
      routing: { kind: "open-in-tab" },
    });
  });

  it("keeps authentication window requests external", () => {
    expect(
      resolveBrowserPaneWindowOpen(
        "https://github.com/login/oauth/authorize",
        true,
      ),
    ).toMatchObject({
      routing: { kind: "open-external", notice: { code: "auth-external" } },
    });
  });

  it("opens the app tab when the clicking window registered one and the URL is allowed", () => {
    expect(resolveExternalLinkRouting({ action: "allow" }, true)).toEqual({
      kind: "open-in-tab",
    });
  });

  // The ticket-pmpcvaEsswlsOLJDwer6 spec change. Routing used to take a third
  // `shouldOpenInTab` argument that main filled with "is this a loopback demo
  // URL", so github.com and every other ordinary site left for the OS browser
  // even with a Web tab open and listening. Ordinary http(s) now belongs in a
  // tab, exactly as typing it into the Web tab's address bar already did.
  it("opens an ordinary external site in a tab, not the OS browser", () => {
    const decision = classifyInAppBrowserNavigation("https://github.com/melocream/marblo/pull/1389");
    expect(decision).toEqual({ action: "allow" });
    expect(resolveExternalLinkRouting(decision, true)).toEqual({
      kind: "open-in-tab",
    });
  });

  it("still opens a local demo on another loopback port in a tab", () => {
    const decision = classifyInAppBrowserNavigation("http://localhost:8791/demo.html");
    expect(resolveExternalLinkRouting(decision, true)).toEqual({
      kind: "open-in-tab",
    });
  });

  it("says why when it falls back to the OS browser because no tab can host it", () => {
    // This was THE silent branch: `{kind:"open-external", notice: null}`, so
    // shell.openExternal ran with nothing shown. A link leaving the app must
    // always explain itself.
    const routing = resolveExternalLinkRouting({ action: "allow" }, false);
    expect(routing.kind).toBe("open-external");
    if (routing.kind !== "open-external") return;
    expect(routing.notice).toMatchObject({ code: "no-tab-target" });
    expect(routing.notice.message.length).toBeGreaterThan(0);
  });

  it("hands auth/payment links to the OS browser with a reason attached", () => {
    expect(
      resolveExternalLinkRouting(
        { action: "external", reason: "payment" },
        true,
      ),
    ).toEqual({
      kind: "open-external",
      notice: browserPaneNoticeForExternalReason("payment"),
    });
  });

  it("never resolves a deny to silence — every deny reason carries a notice", () => {
    for (const reason of ["invalid-url", "unsupported-protocol"] as const) {
      const routing = resolveExternalLinkRouting(
        { action: "deny", reason },
        true,
      );
      expect(routing.kind).toBe("blocked");
      if (routing.kind === "blocked") {
        expect(routing.notice.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("no branch of the routing decision is silent", () => {
    const decisions: Parameters<typeof resolveExternalLinkRouting>[0][] = [
      { action: "allow" },
      { action: "external", reason: "google-auth" },
      { action: "external", reason: "auth" },
      { action: "external", reason: "payment" },
      { action: "external", reason: "external-protocol" },
      { action: "deny", reason: "invalid-url" },
      { action: "deny", reason: "unsupported-protocol" },
    ];
    for (const decision of decisions) {
      for (const hasOpenTarget of [true, false]) {
        const routing = resolveExternalLinkRouting(decision, hasOpenTarget);
        if (routing.kind === "open-in-tab") continue;
        expect(routing.notice.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("classify()'s deny output round-trips into a non-silent routing decision", () => {
    // Regression for the exact bug: a click that reaches routeAppExternalLink
    // and classifies as deny used to fall through every branch and return.
    const denyDecision = classifyInAppBrowserNavigation("javascript:alert(1)");
    expect(denyDecision.action).toBe("deny");
    const routing = resolveExternalLinkRouting(denyDecision, true);
    expect(routing.kind).toBe("blocked");
  });
});

describe("BrowserPaneOpenUrlDelivery (GiChqmgXxSQxdUwo3NLq: the open-in-tab branch must never lose a click)", () => {
  function makeSender(id = 1): BrowserPaneOpenUrlSender {
    return {
      id,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    };
  }

  // Manual fake clock injected via the class's own setTimeout/clearTimeout
  // deps, instead of vi.useFakeTimers()/useRealTimers() — in this
  // environment those hang the afterEach hook for every test file that uses
  // them (reproduces on unrelated pre-existing suites too, e.g.
  // agent-lifecycle.test.ts), so real fake-timer control is unusable here
  // regardless of this change. The class was built dependency-injected
  // precisely so tests don't need a global timer mock.
  function makeFakeClock() {
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
      advance(ms: number) {
        now += ms;
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= now)
          .sort((a, b) => a[1].at - b[1].at);
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
      },
    };
  }

  let requestIdCounter: number;

  beforeEach(() => {
    requestIdCounter = 0;
  });

  function makeDelivery(onDeliveryFailed = vi.fn()) {
    const clock = makeFakeClock();
    return {
      onDeliveryFailed,
      clock,
      delivery: new BrowserPaneOpenUrlDelivery({
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        generateRequestId: () => `req-${requestIdCounter++}`,
        onDeliveryFailed,
        ackTimeoutMs: 1500,
      }),
    };
  }

  it("does not fall back once the renderer acknowledges the send", () => {
    const { delivery, onDeliveryFailed, clock } = makeDelivery();
    const sender = makeSender();

    delivery.send(sender, "https://example.com/docs");
    expect(sender.send).toHaveBeenCalledWith("browserPane:openUrl", {
      url: "https://example.com/docs",
      requestId: "req-0",
    });

    expect(delivery.acknowledge(sender.id, "req-0")).toBe(true);
    clock.advance(5000);
    expect(onDeliveryFailed).not.toHaveBeenCalled();
  });

  it("regression: an unacknowledged send (missing/stale renderer listener) falls back after the timeout instead of vanishing", () => {
    const { delivery, onDeliveryFailed, clock } = makeDelivery();
    const sender = makeSender();

    // Renderer never calls ackOpenUrl — e.g. WorkspaceShell's listener
    // wasn't mounted yet, or the window was mid-reload when the IPC
    // message arrived. This used to leave the click with no tab, no OS
    // browser fallback, and no notice: total silence.
    delivery.send(sender, "https://example.com/docs");
    expect(onDeliveryFailed).not.toHaveBeenCalled();

    clock.advance(1499);
    expect(onDeliveryFailed).not.toHaveBeenCalled();

    clock.advance(1);
    expect(onDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(onDeliveryFailed).toHaveBeenCalledWith(
      sender,
      "https://example.com/docs",
    );
  });

  it("ignores an ack whose requestId is unknown or whose sender doesn't match — timeout still fires", () => {
    const { delivery, onDeliveryFailed, clock } = makeDelivery();
    const sender = makeSender(1);
    const otherSender = makeSender(2);

    delivery.send(sender, "https://example.com/docs");

    expect(delivery.acknowledge(sender.id, "not-the-real-id")).toBe(false);
    expect(delivery.acknowledge(otherSender.id, "req-0")).toBe(false);

    clock.advance(1500);
    expect(onDeliveryFailed).toHaveBeenCalledTimes(1);
  });

  it("resolves as failed immediately when the sender is known gone (window destroyed / open-target unregistered) rather than waiting out the timeout", () => {
    const { delivery, onDeliveryFailed, clock } = makeDelivery();
    const sender = makeSender();

    delivery.send(sender, "https://example.com/docs");
    expect(delivery.pendingCount).toBe(1);

    delivery.cancelForSender(sender.id);

    expect(onDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(onDeliveryFailed).toHaveBeenCalledWith(
      sender,
      "https://example.com/docs",
    );
    expect(delivery.pendingCount).toBe(0);

    // The timer was cleared, not merely raced — advancing time must not
    // double-fire the fallback.
    clock.advance(5000);
    expect(onDeliveryFailed).toHaveBeenCalledTimes(1);
  });

  it("tracks multiple in-flight sends independently by requestId", () => {
    const { delivery, onDeliveryFailed, clock } = makeDelivery();
    const sender = makeSender();

    delivery.send(sender, "https://example.com/one");
    delivery.send(sender, "https://example.com/two");
    expect(delivery.pendingCount).toBe(2);

    expect(delivery.acknowledge(sender.id, "req-0")).toBe(true);
    expect(delivery.pendingCount).toBe(1);

    clock.advance(1500);
    expect(onDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(onDeliveryFailed).toHaveBeenCalledWith(
      sender,
      "https://example.com/two",
    );
  });
});
