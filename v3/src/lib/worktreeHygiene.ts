import type { Worktree } from "../types/worktree";

/**
 * Worktree hygiene: the renderer-side "archive" model that keeps the default
 * worktree surfaces (the Worktrees tab list and every root selector) showing
 * only *active / ongoing* worktrees.
 *
 * A single project can accumulate dozens of worktrees — merged-and-landed
 * branches, long-idle experiments, ad-hoc feat/fix branches — that never get
 * pruned. Showing all of them in a `<select>` (as the Code-tab Root dropdown
 * did) is unusable at 100+ entries.
 *
 * "Archived" folds two signals:
 *  1. an **auto verdict** from the electron main hygiene pass, surfaced through
 *     `worktree:list` as {@link Worktree.staleInfo} / {@link Worktree.stale}
 *     (`stale = merged || idle >= N days`), and
 *  2. an optional **manual override** the user sets from the Worktrees tab
 *     (archive an active one, or restore an auto-archived one), persisted in
 *     localStorage so the choice survives reloads.
 *
 * The manual override always wins over the auto verdict. Physical deletion of
 * merged/idle worktrees stays a separate, deliberate action (`cleanupStale`);
 * archiving only hides.
 */

export type ArchiveOverride = "archived" | "active";
export type ArchiveOverrides = Record<string, ArchiveOverride>;

/** Why a worktree is auto-archived — used to label the archived view. */
export type ArchiveReason = "merged" | "done" | "stale";

/** Why a worktree is held OUT of the archive despite an archive signal. */
export type ArchiveBlocker = "dirty" | "unpushed" | "busy";

/**
 * Renderer-side signals the hygiene verdict cannot carry, resolved once per
 * render from stores that already hold them — never per worktree.
 *
 * Both are keyed by task id because the worktree path encodes it
 * (`~/.marblo/worktrees/<projectId>/<taskId>`), which the store already
 * reverses into `Worktree.taskId`. Building each Set is one pass over data the
 * renderer is subscribed to anyway: zero git spawns, zero IPC, no per-worktree
 * lookup. Doing this per worktree instead is the trap #511 dug out of.
 */
export interface ArchiveSignals {
  /**
   * Tasks whose ticket is DONE. Their worktrees are finished work regardless of
   * how recently someone touched them — a meaning-level signal, strictly better
   * than the idle clock it supplements.
   */
  doneTaskIds?: ReadonlySet<string>;
  /** Tasks an agent is actively attached to. Their worktrees are in use. */
  busyTaskIds?: ReadonlySet<string>;
}

const NO_SIGNALS: ArchiveSignals = {};

/**
 * Idle threshold the renderer trusts without a cleanliness probe.
 *
 * Mirrors `LEGACY_MAX_IDLE_DAYS` in electron/worktree-manager. Kept as a
 * literal rather than imported because this module is renderer-side and must
 * not pull in main-process code; the pairing is asserted by unit test.
 */
export const LEGACY_IDLE_ARCHIVE_DAYS = 14;

/**
 * Why a worktree must NOT be auto-archived, or null when nothing blocks it.
 *
 * ★ This is the invariant that outranks every count target in this module.
 * Archiving hides a worktree from the root selectors; a user who cannot see
 * their uncommitted work has, for practical purposes, lost it. So each of these
 * vetoes auto-archive at ANY idle threshold and against EVERY archive signal,
 * `merged` and DONE-ticket included:
 *
 *  - **dirty**    uncommitted changes; they exist nowhere but this disk.
 *  - **unpushed** commits neither in base nor on a remote (see StaleInfo).
 *  - **busy**     an agent is working in it right now.
 *
 * Measured over 135 live worktrees when the threshold dropped 14 → 5: 10 dirty
 * worktrees would have been newly hidden, and every one of them was *also*
 * fully pushed (`ahead == 0`) — so the unpushed veto does not cover the dirty
 * case. They are independent guards and both are load-bearing.
 *
 * Only a **manual** override may hide a blocked worktree; the user hiding their
 * own work on purpose is a choice, not an accident. See {@link isWorktreeArchived}.
 */
export function archiveSafetyBlocker(
  worktree: Worktree,
  signals: ArchiveSignals = NO_SIGNALS,
): ArchiveBlocker | null {
  if (worktree.status?.dirty === true) return "dirty";
  if (worktree.staleInfo?.unpushed === true) return "unpushed";
  if (worktree.agentId != null) return "busy";
  if (worktree.taskId != null && signals.busyTaskIds?.has(worktree.taskId)) {
    return "busy";
  }
  return null;
}

/** Whether this worktree's ticket is DONE — finished work, whatever the clock says. */
function hasDoneTicket(worktree: Worktree, signals: ArchiveSignals): boolean {
  return (
    worktree.taskId != null &&
    signals.doneTaskIds?.has(worktree.taskId) === true
  );
}

/**
 * Whether the idle clock alone says "archive".
 *
 * Two bands, because the renderer's evidence is uneven. `dirty` is only known
 * where a `status` probe ran — the full `worktree:list` sweep. The light path
 * has none by design: probing dirtiness per worktree is the per-worktree-spawn
 * pattern #511 removed (2 repo-level spawns / 52ms vs 135 status spawns /
 * 960ms measured), so restoring it to serve this feature would undo that fix.
 *
 * So the newly aggressive band only fires on positive evidence:
 *  - `idleDays >= 14` — the pre-existing threshold, unchanged behaviour.
 *  - `idleDays >= 5`  — only when `status` is present, i.e. we can actually see
 *    whether it is dirty. With no status the worktree stays visible.
 *
 * The honest cost: on a profile that has never opened the Worktrees tab, 5–13
 * day worktrees keep showing. They are still reached by the `merged` and
 * DONE-ticket signals, which need no probe — and showing one row too many is
 * the failure we choose over hiding live work.
 */
function isIdleArchived(worktree: Worktree): boolean {
  const idleDays = worktree.staleInfo?.idleDays;
  if (idleDays === undefined) {
    // No idle number to band on — fall back to whatever verdict we were handed
    // (a legacy preload or cached entry carrying only the flat flag).
    return worktree.staleInfo?.stale === true || worktree.stale === true;
  }
  if (idleDays >= LEGACY_IDLE_ARCHIVE_DAYS) return true;
  return worktree.staleInfo?.stale === true && worktree.status !== undefined;
}

const STORAGE_KEY = "marblo.worktree.archiveOverrides.v1";

/**
 * Stable per-worktree key for archive overrides. A worktree's path is stable
 * for the task's whole lifetime and unique across projects, so it survives
 * refreshes (unlike the store's synthetic `id`, which is fine too but couples
 * to `${projectId}:${path}`). Path keeps the persisted map human-inspectable.
 */
export function worktreeKey(worktree: Pick<Worktree, "path">): string {
  return worktree.path;
}

/**
 * Whether the hygiene pass reached NO verdict for this worktree — git could not
 * judge it (detached HEAD, failed probe) or the data path that supplies
 * verdicts is broken.
 *
 * This is a first-class third state, not a synonym for "active". Treating it as
 * "active" is what let a dead verdict pipeline masquerade as a working filter:
 * the light refresh never seeded the verdict cache, so every worktree looked
 * un-stale and all 160 stayed in the dropdown while the filter reported itself
 * healthy (ticket NaviULZe). Callers surface the count (see CodeTab) so the
 * same class of regression is loud instead of silent.
 */
export function isVerdictUnknown(worktree: Worktree): boolean {
  return worktree.staleInfo === undefined && worktree.stale === undefined;
}

/** How many of `worktrees` carry no hygiene verdict at all. */
export function countUnknownVerdicts(worktrees: Worktree[]): number {
  return worktrees.filter(isVerdictUnknown).length;
}

/**
 * Auto-archive verdict: is this worktree finished or dormant enough to hide?
 *
 * Three signals archive, in descending order of how much they actually mean:
 *  1. **DONE ticket** — the task this worktree exists for is closed. Meaning,
 *     not time: a worktree touched an hour ago whose ticket shipped is done,
 *     and no idle threshold will ever say so. Needs `signals.doneTaskIds`.
 *  2. **merged** — the branch landed in base.
 *  3. **idle** — dormant past the threshold. See {@link isIdleArchived} for why
 *     this one is banded rather than a single number.
 *
 * ★ Every one of them is subordinate to {@link archiveSafetyBlocker}. A dirty,
 * unpushed, or busy worktree is never auto-archived, however finished it looks
 * — a DONE ticket does not make uncommitted changes in its worktree disposable,
 * and neither does a merged branch. Getting the count down is not worth hiding
 * work from the person who wrote it.
 *
 * An {@link isVerdictUnknown} worktree is NOT auto-archived — hiding work we
 * cannot judge risks hiding live work, which is worse than showing one row too
 * many. Unknown is reported separately rather than quietly folded into either
 * answer.
 */
export function isAutoArchived(
  worktree: Worktree,
  signals: ArchiveSignals = NO_SIGNALS,
): boolean {
  if (archiveSafetyBlocker(worktree, signals) !== null) return false;
  if (hasDoneTicket(worktree, signals)) return true;
  if (worktree.staleInfo?.merged === true) return true;
  return isIdleArchived(worktree);
}

/** The reason a worktree is auto-archived, or null when it is active. */
export function archiveReason(
  worktree: Worktree,
  signals: ArchiveSignals = NO_SIGNALS,
): ArchiveReason | null {
  if (archiveSafetyBlocker(worktree, signals) !== null) return null;
  if (hasDoneTicket(worktree, signals)) return "done";
  if (worktree.staleInfo?.merged === true) return "merged";
  if (isIdleArchived(worktree)) return "stale";
  return null;
}

/**
 * Whether a worktree is archived — i.e. hidden from the default active/ongoing
 * views. A manual override always wins over the auto verdict:
 *  - "active"   → user restored it: show even if merged/stale/DONE.
 *  - "archived" → user archived it: hide even if active, and even if a safety
 *    blocker would have vetoed the automatic verdict. Deliberately hiding your
 *    own dirty worktree is a choice; the guard exists to stop the machine from
 *    doing it behind your back, not to overrule you.
 * With no override, fall back to the auto verdict.
 */
export function isWorktreeArchived(
  worktree: Worktree,
  overrides: ArchiveOverrides,
  signals: ArchiveSignals = NO_SIGNALS,
): boolean {
  const override = overrides[worktreeKey(worktree)];
  if (override === "active") return false;
  if (override === "archived") return true;
  return isAutoArchived(worktree, signals);
}

/**
 * Active/ongoing *task* worktree — the surface every root selector should
 * offer. Belongs to a task (`taskId != null`, which drops ad-hoc feat/fix
 * branches) and is not archived.
 */
export function isActiveOngoingWorktree(
  worktree: Worktree,
  overrides: ArchiveOverrides,
  signals: ArchiveSignals = NO_SIGNALS,
): boolean {
  return (
    worktree.taskId != null && !isWorktreeArchived(worktree, overrides, signals)
  );
}

/**
 * Set (or clear) a single override immutably. Passing `null` removes the
 * override so the worktree reverts to its auto verdict.
 */
export function setOverride(
  overrides: ArchiveOverrides,
  key: string,
  value: ArchiveOverride | null,
): ArchiveOverrides {
  const next = { ...overrides };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

/** Load persisted overrides. Safe in non-browser (test/SSR) contexts. */
export function loadArchiveOverrides(): ArchiveOverrides {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ArchiveOverrides = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (value === "archived" || value === "active") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist overrides. Swallows quota/serialization errors — hygiene is best-effort. */
export function persistArchiveOverrides(overrides: ArchiveOverrides): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
}
