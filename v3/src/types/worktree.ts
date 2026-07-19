export interface WorktreeStatus {
  branch: string;
  baseRef: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  mergeable: boolean;
  conflicts: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface Worktree {
  id: string;
  taskId: string | null;
  projectId: string;
  agentId: string | null;
  branch: string;
  baseRef: string;
  path: string;
  repoRoot: string;
  head?: string;
  createdAt: string | null;
  /**
   * True when this entry is the repo's **main working tree** (as opposed to a
   * linked worktree). Stamped from the enumeration order in the store's
   * normalizers — `git worktree list` documents that "the main worktree is
   * listed first" — so main-detection rests on git's own answer instead of
   * guessing from path shape. Optional only for defensive back-compat with
   * snapshots built before this field existed; see `findMainWorktree`.
   */
  isMain?: boolean;
  stale?: boolean;
  /** Full hygiene verdict (merged / idleDays / stale) from the main process. */
  staleInfo?: WorktreeStaleInfo;
  status?: WorktreeStatus;
}

export interface WorktreeStaleInfo {
  merged: boolean;
  idleDays: number;
  stale: boolean;
}

export interface WorktreeListItem {
  path: string;
  branch: string;
  head: string;
  status: WorktreeStatus;
  /** Cleanup candidate (merged into base or long idle). Main worktree → false. */
  stale?: boolean;
  /** Full stale verdict; omitted for the main worktree. */
  staleInfo?: WorktreeStaleInfo;
}

export interface WorktreeProjectGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeListItem[];
}

/** Topology-only entry from `worktree:listLight` — no status/staleInfo. */
export interface WorktreeLightItem {
  path: string;
  branch: string;
  head: string;
}

export interface WorktreeLightGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeLightItem[];
}

export type WorktreeStatusTone =
  | "danger"
  | "warning"
  | "behind"
  | "ready"
  | "idle";

export interface WorktreeStatusPill {
  icon: string;
  label: string;
  tone: WorktreeStatusTone;
}
