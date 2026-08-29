import { describe, expect, it } from "vitest";
import {
  browserPaneNoticeForExternalReason,
  classifyInAppBrowserNavigation,
  normalizeBrowserPaneUrl,
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
});
