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
 * Which side the caller wants when both sides fit.
 *
 * `"down"` is the historical behavior (session/model pickers hanging off a
 * header). `"up"` is for a trigger that sits ON TOP of the thing the popup
 * must not cover — the first-spawn guide rail, whose panel has to rise over
 * the board above rather than fall across the live orchestrator terminal
 * below. Either way the popup flips to the other side rather than going off
 * screen, so "prefer" is a preference and never a guarantee of vanishing.
 */
export type AnchoredPopupPreference = "down" | "up";

/**
 * Place a popup of `width` next to `rect`.
 *
 * Opens toward `prefer` (downward unless asked otherwise) and flips to the
 * other side only when there genuinely isn't room on the preferred side AND
 * there is more room on the other — so the common case (trigger near the top
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
  prefer: AnchoredPopupPreference = "down",
): AnchoredPopupPlacement {
  const spaceBelow = viewport.height - rect.bottom;
  const spaceAbove = rect.top;
  const fits = (space: number) => space >= estHeight + VIEWPORT_MARGIN;
  const openUp =
    prefer === "up"
      ? fits(spaceAbove) || spaceAbove >= spaceBelow
      : !fits(spaceBelow) && spaceAbove > spaceBelow;

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
