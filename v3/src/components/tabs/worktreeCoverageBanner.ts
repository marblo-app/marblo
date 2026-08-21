import { WORKTREE_PROJECT_FILTER_ALL } from "./worktreeProjectFilter";

/**
 * "Worktrees are missing, and it is NOT the filters" — the banner #1045 could
 * not express.
 *
 * #1045 added "filters are hiding N worktrees + reset". That count is derived
 * from the IPC response, so it can only ever describe worktrees that arrived
 * and were then filtered out. Through the whole NHCsWfnp outage — 74 of 81
 * worktrees absent — it correctly read zero and stayed silent, because nothing
 * had been filtered. The worktrees were never fetched.
 *
 * Two independent losses therefore need two independent banners. Making this
 * one say "filters" would be a lie, and offering "reset filters" here would be
 * a dead button. It reports the fetch-side loss and names the clones behind it.
 */
export interface WorktreeUnfetchedNotice {
  /** Pool directories on disk that no listing reported. */
  missing: number;
  /** Owning clones that are gone or that no project root enumerates. */
  unreachableRoots: string[];
}

/**
 * Decide whether the fetch-side banner should appear, scoped to what the user
 * is actually looking at: with a project selected, another project's missing
 * worktrees are not this view's problem.
 *
 * Returns null when nothing is missing — the normal, healthy case.
 */
export function selectUnfetchedNotice(
  coverage: readonly WorktreeCoverage[],
  projectFilter: string,
): WorktreeUnfetchedNotice | null {
  const scoped =
    projectFilter === WORKTREE_PROJECT_FILTER_ALL
      ? coverage
      : coverage.filter((entry) => entry.projectId === projectFilter);

  let missing = 0;
  const roots = new Set<string>();
  for (const entry of scoped) {
    missing += Math.max(0, entry.missing);
    for (const root of entry.unreachableRoots) roots.add(root);
  }

  if (missing <= 0) return null;
  return { missing, unreachableRoots: Array.from(roots).sort() };
}
