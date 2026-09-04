/** A renderer container rectangle, expressed in CSS pixels. */
export interface BrowserPaneContainerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The visual viewport's origin within the renderer window, in CSS pixels.
 *
 * `getBoundingClientRect()` is relative to the visual viewport, whereas a
 * native `WebContentsView` is positioned from the BrowserWindow content
 * origin. In ordinary desktop use this is `{ x: 0, y: 0 }`; keeping it
 * explicit makes the conversion correct if Chromium offsets the viewport.
 */
export interface BrowserPaneWindowOrigin {
  x: number;
  y: number;
}

/** A WebContentsView rectangle, expressed in BrowserWindow-content DIP. */
export interface BrowserPaneViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts the renderer's CSS-pixel container rectangle to the DIP coordinate
 * system consumed by `WebContentsView.setBounds`.
 *
 * Electron page zoom changes CSS pixels without changing native view bounds;
 * multiplying both the viewport-relative position and size by `zoomFactor`
 * keeps the native browser aligned with its DOM anchor.
 */
export function browserPaneBoundsFromContainerRect(
  rect: BrowserPaneContainerRect,
  windowOrigin: BrowserPaneWindowOrigin,
  zoomFactor: number,
): BrowserPaneViewBounds {
  const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const roundNonNegative = (value: number) => Math.max(0, Math.round(value));

  return {
    x: roundNonNegative((rect.x + windowOrigin.x) * scale),
    y: roundNonNegative((rect.y + windowOrigin.y) * scale),
    width: roundNonNegative(rect.width * scale),
    height: roundNonNegative(rect.height * scale),
  };
}
