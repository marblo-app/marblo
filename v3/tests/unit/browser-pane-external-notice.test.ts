import { describe, expect, it } from "vitest";
import {
  browserPaneExternalNotice,
  isBrowserPaneExternalNotice,
} from "../../src/lib/browser-pane-external-notice";

describe("isBrowserPaneExternalNotice", () => {
  it("claims every code that means 'handed to the system browser'", () => {
    for (const code of [
      "google-auth-external",
      "auth-external",
      "payment-external",
      "external-protocol",
      "tab-open-failed",
    ] as const) {
      expect(isBrowserPaneExternalNotice(code)).toBe(true);
    }
  });

  it("leaves in-pane failures to the dismissible bottom bar", () => {
    for (const code of [
      "load-failed",
      "blocked-url",
      "invalid-url",
      "unsupported-protocol",
      "open-failed",
      "no-tab-target",
    ] as const) {
      expect(isBrowserPaneExternalNotice(code)).toBe(false);
      expect(
        browserPaneExternalNotice({ code, hasPageBehind: true }),
      ).toBeNull();
    }
  });
});

describe("browserPaneExternalNotice", () => {
  it("uses the sign-in copy for OAuth externalizations", () => {
    // The point of the separate key: only a sign-in has an in-app
    // alternative worth naming (the site's own email/password form, whose
    // session persists in the Web tab partition). Payment does not.
    for (const code of ["google-auth-external", "auth-external"] as const) {
      expect(
        browserPaneExternalNotice({ code, hasPageBehind: true })?.reasonKey,
      ).toBe("workspace.browser.external.signInReason");
    }
  });

  it("keeps the generic copy for payment and non-http schemes", () => {
    for (const code of [
      "payment-external",
      "external-protocol",
      "tab-open-failed",
    ] as const) {
      expect(
        browserPaneExternalNotice({ code, hasPageBehind: true })?.reasonKey,
      ).toBe("workspace.browser.external.reason");
    }
  });

  it("offers the way back only when a page is still loaded behind the block", () => {
    expect(
      browserPaneExternalNotice({
        code: "google-auth-external",
        hasPageBehind: true,
      })?.canReturnToPage,
    ).toBe(true);
    expect(
      browserPaneExternalNotice({
        code: "google-auth-external",
        hasPageBehind: false,
      })?.canReturnToPage,
    ).toBe(false);
  });
});
