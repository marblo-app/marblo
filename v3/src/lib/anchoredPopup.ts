/**
 * Viewport-anchored popup placement.
 *
 * Popups that live inside a clipped panel (the Workspace split shell wraps the
 * terminal column in several `overflow-hidden` ancestors) cannot be positioned
 * with `absolute bottom-full` — the popup renders outside the clip rect and
 * simply vanishes. The fix is to portal the popup to <body> and position it
 * `fixed` against the trigger's viewport rect; this module holds that math so
 * the flip/clamp rules are unit-testable in the node test environment (same
 * split as splitWorkspaceLayout.ts).
 */

export const VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the popup edge. */
const ANCHOR_GAP = 4;

/** Minimal viewport rect of the trigger element (a DOMRect satisfies this). */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface AnchoredPopupPlacement {
  left: number;
  width: number;
  maxHeight: number;
  /** Exactly one of these is set, matching the chosen flip direction. */
  top?: number;
  bottom?: number;
}

/**
 * Place a popup of `width` next to `rect`.
 *
 * Opens downward by default and flips up only when there genuinely isn't room
 * below AND there is more room above — so the common case (trigger near the top
 * of the window, as in the split shell's terminal column) stays on screen.
 * `left` is clamped into the viewport, and `maxHeight` is capped to the space
 * actually available so a long session list scrolls instead of overflowing.
 */
export function placeAnchoredPopup(
  rect: AnchorRect,
  viewport: Viewport,
  width: number,
  estHeight: number,
  align: "left" | "right",
): AnchoredPopupPlacement {
  const spaceBelow = viewport.height - rect.bottom;
  const spaceAbove = rect.top;
  const openUp =
    spaceBelow < estHeight + VIEWPORT_MARGIN && spaceAbove > spaceBelow;

  const rawLeft = align === "left" ? rect.left : rect.right - width;
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    viewport.width - width - VIEWPORT_MARGIN,
  );
  const left = Math.min(Math.max(VIEWPORT_MARGIN, rawLeft), maxLeft);

  const available =
    (openUp ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN - ANCHOR_GAP;
  const maxHeight = Math.max(0, available);

  return openUp
    ? {
        left,
        width,
        maxHeight,
        bottom: viewport.height - rect.top + ANCHOR_GAP,
      }
    : { left, width, maxHeight, top: rect.bottom + ANCHOR_GAP };
}
