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
 */
export const RIGHT_TABS = [
  "startHere",
  "guide",
  "board",
  "code",
  "agents",
  "worktrees",
  "history",
  "lanes",
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
