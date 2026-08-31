import { describe, expect, it } from "vitest";
import {
  browserPaneNoticeForExternalReason,
  classifyInAppBrowserNavigation,
  normalizeBrowserPaneUrl,
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
      browserPaneNoticeForExternalReason("external-protocol"),
    ).toMatchObject({ code: "external-protocol" });
  });
});

describe("resolveExternalLinkRouting (routeAppExternalLink's three branches)", () => {
  it("opens the app tab when the clicking window registered one and the URL is allowed", () => {
    expect(resolveExternalLinkRouting({ action: "allow" }, true)).toEqual({
      kind: "open-in-tab",
    });
  });

  it("falls back to the OS browser, silently, when no tab is registered for an ordinary link", () => {
    expect(resolveExternalLinkRouting({ action: "allow" }, false)).toEqual({
      kind: "open-external",
      notice: null,
    });
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

  it("classify()'s deny output round-trips into a non-silent routing decision", () => {
    // Regression for the exact bug: a click that reaches routeAppExternalLink
    // and classifies as deny used to fall through every branch and return.
    const denyDecision = classifyInAppBrowserNavigation("javascript:alert(1)");
    expect(denyDecision.action).toBe("deny");
    const routing = resolveExternalLinkRouting(denyDecision, true);
    expect(routing.kind).toBe("blocked");
  });
});
