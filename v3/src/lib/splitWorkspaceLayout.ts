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

/**
 * Right-pane tabs, in bar order. Every id maps 1:1 to a reused legacy tab
 * component (WorkTabs.TAB_COMPONENTS); we never reimplement a view.
 *
 * `startHere` leads the bar: onboarding is a first-class destination, not a
 * modal you can lose (see lib/onboardingProgress).
 *
 * ★ PARITY RULE: this list must stay a superset of TabBar.TabId (the legacy
 * Layout tab set). When the shell was built, `agents` and `settings` were
 * excluded on the reasoning that "agents live in the left column" and
 * "settings is an overlay" — both were wrong in practice and each cost a
 * user-visible regression the CEO had to find by hand (tickets ZdgQMxW7,
 * 0JVQcUxd):
 *   - the left column holds agent TERMINALS (AgentListPanel); the legacy
 *     `agents` tab is the AgentDashboard *management* view, which had no other
 *     home at all;
 *   - `settings` did open as a full-screen overlay from the Header gear, but
 *     with no tab-bar entry users simply never found it.
 * So the rule is now: every legacy TabId is a tab here. If a future change
 * wants to drop one, leave the reason in this comment — do not just delete it.
 *
 * Nothing is currently excluded. `startHere` is the only addition: onboarding
 * is a first-class destination, not a modal you can lose (lib/onboardingProgress).
 *
 * ★ ORDER IS PRODUCT, NOT ALPHABET. `lanes` (Quick Lanes) sits immediately
 * after `code` because it is the second thing a user reaches for while working
 * — spawn a parallel worker on the improvement you just noticed, without
 * leaving the file you are in. It used to sit after `history`, six tabs deep,
 * where it read as an archive view; a feature that is supposed to be the fast
 * path cannot be behind the slow ones. `tests/unit/splitWorkspaceLayout.test.ts`
 * pins the adjacency so a future insertion doesn't quietly bury it again.
 */
export const RIGHT_TABS = [
  "startHere",
  "guide",
  "board",
  "code",
  "lanes",
  "agents",
  "worktrees",
  "history",
  "usage",
  "harness",
  "missions",
  "flows",
  "deploy",
  "settings",
] as const;
export type RightTabId = (typeof RIGHT_TABS)[number];

/**
 * Tabs hidden in production — surfaced only when VITE_DEV_FEATURES lists the id.
 * Mirrors TabBar.DEV_ONLY_TABS so the shell and the legacy tab bar gate the same
 * feature-flagged views identically.
 */
export const DEV_ONLY_RIGHT_TABS: ReadonlySet<RightTabId> = new Set<RightTabId>(
  ["missions", "flows", "deploy"],
);

/**
 * The tabs to actually render, given the parsed VITE_DEV_FEATURES list. Pure so
 * the dev-gating rule is unit-testable without an import.meta.env stub.
 */
export function visibleRightTabs(devFeatures: string[]): RightTabId[] {
  return RIGHT_TABS.filter(
    (t) => !DEV_ONLY_RIGHT_TABS.has(t) || devFeatures.includes(t),
  );
}

/** Left (terminal) pane width as a fraction of the split container. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.7;
export const DEFAULT_RATIO = 0.4;

/**
 * Vertical split inside the LEFT column: the orchestrator pane's height as a
 * fraction of the column, with the agent pane taking the rest. Wider legal band
 * than the horizontal split (either terminal can be the focus) and defaults to
 * an even 50/50.
 */
export const MIN_V_RATIO = 0.2;
export const MAX_V_RATIO = 0.8;
export const DEFAULT_V_RATIO = 0.5;

/**
 * Below this container width (px) the terminal column auto-collapses to a slim
 * rail so the work view stays usable on narrow windows. Independent of the
 * user's manual collapse toggle — whichever wants it collapsed wins.
 */
export const NARROW_BREAKPOINT = 880;

/** Width (px) of the draggable divider between the terminal and work panes. */
export const DIVIDER_WIDTH = 4;

/**
 * Board geometry the shell has to respect, mirrored from the board's own
 * Tailwind classes: KanbanBoard lays the four status columns out as
 * `flex gap-4` (16px) inside a `p-4` (16px per side) `overflow-x-auto` box, and
 * KanbanColumn floors each column at `min-w-[168px]`.
 *
 * ★ These are the SAME numbers as the board's classes, not an estimate. If a
 * board class changes, change these — BOARD_MIN_WIDTH_PARTS is asserted against
 * BOARD_MIN_WIDTH in the unit tests so the drift is a failing test, not a
 * silently reappearing hidden REVIEW column.
 *
 * The Stuck lane (board/StuckLane, right of DONE) is deliberately NOT counted
 * here. It ships collapsed at a 52px rail and holds work that is by definition
 * not moving, so reserving pane width for it would take space from the active
 * columns — the opposite of what this reservation is for. Expanded, it takes
 * its share of the same flex row and the board scrolls, exactly as it already
 * does past the fourth column.
 */
export const BOARD_COLUMN_COUNT = 4;
export const BOARD_COLUMN_MIN_WIDTH = 168;
export const BOARD_COLUMN_GAP = 16;
export const BOARD_PADDING = 16;

/**
 * The narrowest the work-view pane can get before the Board tab starts clipping
 * columns:
 *
 *   4 × 168 + 3 × 16 + 2 × 16 = 752
 *
 * Below this the columns stop shrinking and the last one (REVIEW) slides behind
 * the horizontal scroll — the exact symptom this constant exists to prevent.
 */
export const BOARD_MIN_WIDTH = 752;

/**
 * Activity Stream panel width band. The panel is the FOURTH region of the shell
 * (files · terminals · work view · activity), not an overlay and not a shove:
 * it is deliberately narrower than the 320px it used to claim, because the
 * width it takes comes straight out of the work view.
 */
export const ACTIVITY_PANEL_WIDTH = 280;
export const ACTIVITY_MIN_PANEL_WIDTH = 220;

/**
 * Fraction of the work area the Activity panel may never exceed. Guards the
 * mid-width band where a fixed 280px would be most of the window.
 */
const ACTIVITY_MAX_FRACTION = 0.3;

/**
 * Below this work-area width (px) the panel cannot usefully coexist with
 * anything and renders as its slim rail instead. Well under the point where the
 * terminal column has already auto-collapsed (NARROW_BREAKPOINT), so this only
 * fires on genuinely tiny windows; the rail's button brings it straight back
 * once the window grows.
 */
export const ACTIVITY_COLLAPSE_BREAKPOINT = 700;

/**
 * How wide to render the Activity panel inside a work area of `availableWidth`
 * (the region holding the split area + the panel/rail), or `null` when the
 * window is too narrow to host it at all.
 *
 * A non-positive / non-finite width means "not measured yet" (first frame
 * before the ResizeObserver reports) — answer with the preferred width so the
 * panel doesn't flash collapsed.
 */
export function activityPanelWidth(availableWidth: number): number | null {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return ACTIVITY_PANEL_WIDTH;
  }
  if (availableWidth < ACTIVITY_COLLAPSE_BREAKPOINT) return null;
  const cap = Math.floor(availableWidth * ACTIVITY_MAX_FRACTION);
  return Math.max(
    ACTIVITY_MIN_PANEL_WIDTH,
    Math.min(ACTIVITY_PANEL_WIDTH, cap),
  );
}

/**
 * The terminal-pane fraction to actually render while the Activity panel is
 * open: the stored ratio, capped so the work view keeps at least
 * BOARD_MIN_WIDTH. Opening Activity must never be what pushes a board column
 * out of view — the space comes from the terminal column instead, which the
 * user can always drag back or collapse.
 *
 * The stored ratio is NOT mutated: close the panel and the drag the user chose
 * returns verbatim. When the split is so narrow that even a zero-width terminal
 * column couldn't reach BOARD_MIN_WIDTH, clampRatio's floor (MIN_RATIO) wins —
 * the board scrolls, exactly as it already does at that width with the panel
 * closed. Only called when the panel is open, so the panel-closed geometry is
 * untouched.
 */
export function ratioWithActivityOpen(
  storedRatio: number,
  splitWidth: number,
): number {
  if (!Number.isFinite(splitWidth) || splitWidth <= 0) {
    return clampRatio(storedRatio);
  }
  // Reserve one extra pixel. The exact quotient round-trips through binary
  // floating point (ratio → flex-basis → remaining width) and can land a hair
  // UNDER the reservation — 879.9999999999999px — which is all it takes for the
  // browser to start the horizontal scroll this function exists to avoid.
  const maxTerminalRatio =
    (splitWidth - DIVIDER_WIDTH - BOARD_MIN_WIDTH - 1) / splitWidth;
  return clampRatio(Math.min(storedRatio, maxTerminalRatio));
}

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

/**
 * Which tab a cold start opens.
 *
 * A persisted choice wins — with one graduation exception: `startHere` itself.
 * Onboarding is meant to be lived in until it's finished, not permanently
 * revisited — once a user completes every step there is no reason to show
 * them the finish line again on every restart, and the tab stays one click
 * away in the bar regardless. Every OTHER persisted tab is untouchable; this
 * never yanks a user out of `code`/`board`/etc. mid-flow. With no stored
 * choice at all, the onboarding state decides: an unfinished, non-dismissed
 * onboarding lands on Start Here, everything else on the board.
 *
 * `landOnStartHere` comes from onboardingProgress.shouldLandOnStartHere.
 * `onboardingComplete` comes from onboardingProgress.isPersistedComplete —
 * defaults to false so existing callers are unaffected.
 */
export function initialActiveTab(
  rawTab: string | null | undefined,
  landOnStartHere: boolean,
  onboardingComplete = false,
): RightTabId {
  if (isRightTab(rawTab)) {
    return rawTab === "startHere" && onboardingComplete ? "board" : rawTab;
  }
  return landOnStartHere ? "startHere" : "board";
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

/** Clamp a raw vertical fraction into [MIN_V, MAX_V]; non-finite → default. */
export function clampVerticalRatio(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_V_RATIO;
  return Math.min(MAX_V_RATIO, Math.max(MIN_V_RATIO, n));
}

/** Parse a persisted vertical-ratio string; anything invalid → DEFAULT_V_RATIO. */
export function parseStoredVerticalRatio(
  raw: string | null | undefined,
): number {
  if (raw == null) return DEFAULT_V_RATIO;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clampVerticalRatio(n) : DEFAULT_V_RATIO;
}

/**
 * Vertical fraction from a drag: pointer Y relative to the column, clamped to
 * the legal band. `top`/`height` come from getBoundingClientRect.
 */
export function verticalRatioFromPointer(
  clientY: number,
  top: number,
  height: number,
): number {
  if (!(height > 0)) return DEFAULT_V_RATIO;
  return clampVerticalRatio((clientY - top) / height);
}
