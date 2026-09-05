import { describe, expect, it } from "vitest";
import {
  type BrowserPaneVisibilityInput,
  shouldShowNativeBrowserView,
} from "../../src/lib/browser-pane-visibility";

const BASE: BrowserPaneVisibilityInput = {
  url: "https://example.com",
  hasNotice: false,
  isLoading: false,
  hasEverBeenVisible: false,
  canShowNativeView: true,
};

describe("shouldShowNativeBrowserView", () => {
  it("hides an about:blank pane regardless of everything else", () => {
    expect(shouldShowNativeBrowserView({ ...BASE, url: "about:blank" })).toBe(
      false,
    );
  });

  it("hides while a notice (blocked/failed load) is showing", () => {
    expect(shouldShowNativeBrowserView({ ...BASE, hasNotice: true })).toBe(
      false,
    );
  });

  it("hides when layout says the view can't be shown", () => {
    expect(
      shouldShowNativeBrowserView({ ...BASE, canShowNativeView: false }),
    ).toBe(false);
  });

  it("hides a first-time load until it finishes, even though layout allows it", () => {
    expect(
      shouldShowNativeBrowserView({
        ...BASE,
        isLoading: true,
        hasEverBeenVisible: false,
      }),
    ).toBe(false);
  });

  it("reveals a first-time load once it finishes loading", () => {
    expect(
      shouldShowNativeBrowserView({
        ...BASE,
        isLoading: false,
        hasEverBeenVisible: false,
      }),
    ).toBe(true);
  });

  it("keeps showing an already-revealed pane through a subsequent reload, with no flicker back to the spinner", () => {
    expect(
      shouldShowNativeBrowserView({
        ...BASE,
        isLoading: true,
        hasEverBeenVisible: true,
      }),
    ).toBe(true);
  });
});
