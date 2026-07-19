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
export type ArchiveReason = "merged" | "stale";

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
 * Auto-archive verdict straight from the electron main hygiene computation: a
 * worktree is auto-archived once it is merged into base (landed) or has gone
 * stale (idle beyond the threshold).
 *
 * `stale` already folds in `merged` (`stale = merged || idle >= N`), but we
 * check `merged` explicitly too so a future change to the idle threshold can't
 * accidentally un-hide a merged-and-landed worktree, and so {@link archiveReason}
 * can distinguish the two.
 *
 * An {@link isVerdictUnknown} worktree is NOT auto-archived — hiding work we
 * cannot judge risks hiding live work, which is worse than showing one row too
 * many. Unknown is reported separately rather than quietly folded into either
 * answer.
 */
export function isAutoArchived(worktree: Worktree): boolean {
  return (
    worktree.staleInfo?.merged === true ||
    worktree.staleInfo?.stale === true ||
    worktree.stale === true
  );
}

/** The reason a worktree is auto-archived, or null when it is active. */
export function archiveReason(worktree: Worktree): ArchiveReason | null {
  if (worktree.staleInfo?.merged === true) return "merged";
  if (worktree.staleInfo?.stale === true || worktree.stale === true) {
    return "stale";
  }
  return null;
}

/**
 * Whether a worktree is archived — i.e. hidden from the default active/ongoing
 * views. A manual override always wins over the auto verdict:
 *  - "active"   → user restored it: show even if merged/stale.
 *  - "archived" → user archived it: hide even if active.
 * With no override, fall back to the auto verdict.
 */
export function isWorktreeArchived(
  worktree: Worktree,
  overrides: ArchiveOverrides,
): boolean {
  const override = overrides[worktreeKey(worktree)];
  if (override === "active") return false;
  if (override === "archived") return true;
  return isAutoArchived(worktree);
}

/**
 * Active/ongoing *task* worktree — the surface every root selector should
 * offer. Belongs to a task (`taskId != null`, which drops ad-hoc feat/fix
 * branches) and is not archived.
 */
export function isActiveOngoingWorktree(
  worktree: Worktree,
  overrides: ArchiveOverrides,
): boolean {
  return worktree.taskId != null && !isWorktreeArchived(worktree, overrides);
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
