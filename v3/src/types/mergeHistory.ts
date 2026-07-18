/**
 * One completed (squash-merged) worktree, recorded append-only at the merge
 * chokepoint in the Electron main process (see electron/main.ts
 * recordMergeHistory + firestore.rules merge_history). Powers WorktreeTab's
 * "완료 이력" audit view: the worktree itself is gone, but headSha lets us
 * recover the exact diff via `git show`.
 */
export type MergeMode = "manual" | "auto";

export interface MergeHistoryEntry {
  id: string;
  projectId: string;
  /** Inferred from the worktree path at merge time; null for ad-hoc worktrees. */
  taskId: string | null;
  /** Base repo the squashed commit landed in — needed to `git show` the diff. */
  repoRoot: string;
  branch: string;
  baseRef: string;
  /** SHA of the squashed commit on base. */
  headSha: string;
  /** "manual" = human clicked Merge; "auto" = orchestrator auto-merge. */
  mode: MergeMode;
  mergedAt: Date;
  // De-identified diff features captured at merge time (counts + path category
  // only — never raw diff). Optional: absent on pre-existing rows and whenever
  // `git show` on the squashed commit failed. Same values feed the BigQuery
  // task:merged ML label (ticket cZBlOnkg).
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  changeType?: string;
}
