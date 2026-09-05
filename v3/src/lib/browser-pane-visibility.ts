/**
 * Whether the Web tab should reveal its native `WebContentsView` right now.
 *
 * Ticket r70lKKYAN8syX9sLpcFj ("웹탭도 너무 오래 걸린다"): `BrowserPane.tsx`
 * used to compute `visible` from layout alone (see `canShowNativeView`),
 * with no regard for load state. That means the very first time a tab opens,
 * main hands the native view real bounds and `setVisible(true)` as soon as
 * layout allows — Electron then composites Chromium's blank default
 * background on top of our React tree (native child views always draw above
 * the window's own page), so the user watches an opaque white rectangle
 * until the destination page paints, indistinguishable from a frozen tab.
 *
 * Gating the FIRST reveal on load completion lets `BrowserPane` render its
 * own loading state (spinner) underneath instead, which is actually
 * paintable since nothing native is occluding it yet. Once a pane has been
 * shown once, subsequent reloads/navigations keep showing it — flashing back
 * to a spinner on every re-navigation would be a worse regression than the
 * blank-white flash this fixes.
 */
export interface BrowserPaneVisibilityInput {
  url: string;
  hasNotice: boolean;
  /** True once we know the destination finished its initial load (or we
   * don't yet know — treat unknown as "still loading"). */
  isLoading: boolean;
  /** True once this pane's native view has been made visible at least once. */
  hasEverBeenVisible: boolean;
  /** Layout-only visibility: non-degenerate bounds, tab active, no overlay. */
  canShowNativeView: boolean;
}

export function shouldShowNativeBrowserView(
  input: BrowserPaneVisibilityInput,
): boolean {
  if (
    input.url === "about:blank" ||
    input.hasNotice ||
    !input.canShowNativeView
  ) {
    return false;
  }
  return input.hasEverBeenVisible || !input.isLoading;
}
