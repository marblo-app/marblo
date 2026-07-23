/**
 * Pure geometry / persistence helpers for the IDE split Workspace shell.
 *
 * The shell is a two-pane split: a fixed LEFT terminal column (orchestrator +
 * agents) and a RIGHT work-view pane (tabbed board / code / worktrees /
 * history). A draggable divider sets the left pane's width fraction; the ratio,
 * the active right tab, and the terminal-collapse state are persisted so the
 * layout survives restarts.
 *
 * Everything here is a pure function of its inputs (no DOM / storage), so the
 * clamping and parse rules are unit-testable in the node test environment.
 */

/** Right-pane tabs, in bar order. Terminals live in the LEFT column, not here. */
export const RIGHT_TABS = ["board", "code", "worktrees", "history"] as const;
export type RightTabId = (typeof RIGHT_TABS)[number];

/** Left (terminal) pane width as a fraction of the split container. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.7;
export const DEFAULT_RATIO = 0.4;

/**
 * Below this container width (px) the terminal column auto-collapses to a slim
 * rail so the work view stays usable on narrow windows. Independent of the
 * user's manual collapse toggle — whichever wants it collapsed wins.
 */
export const NARROW_BREAKPOINT = 880;

/** Clamp a raw fraction into [MIN, MAX]; non-finite falls back to the default. */
export function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, n));
}

/** Parse a persisted ratio string; anything invalid → DEFAULT_RATIO. */
export function parseStoredRatio(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_RATIO;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clampRatio(n) : DEFAULT_RATIO;
}

export function isRightTab(v: unknown): v is RightTabId {
  return typeof v === "string" && (RIGHT_TABS as readonly string[]).includes(v);
}

/** Parse a persisted active-tab string; unknown / missing → "board". */
export function parseStoredTab(raw: string | null | undefined): RightTabId {
  return isRightTab(raw) ? raw : "board";
}

/** Parse the persisted terminal-collapsed flag. Explicit "1" only → true. */
export function parseStoredCollapsed(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * Effective collapse: the left column is collapsed when the user asked for it
 * OR the container is too narrow to comfortably show both panes.
 */
export function isTerminalCollapsed(
  manualCollapsed: boolean,
  containerWidth: number,
): boolean {
  return manualCollapsed || containerWidth < NARROW_BREAKPOINT;
}

/**
 * Fraction from a horizontal drag: pointer X relative to the container, clamped
 * to the legal ratio band. `left`/`width` come from getBoundingClientRect.
 */
export function ratioFromPointer(
  clientX: number,
  left: number,
  width: number,
): number {
  if (!(width > 0)) return DEFAULT_RATIO;
  return clampRatio((clientX - left) / width);
}
