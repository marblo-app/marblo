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
  stale?: boolean;
  status?: WorktreeStatus;
}

export interface WorktreeListItem {
  path: string;
  branch: string;
  head: string;
  status: WorktreeStatus;
}

export interface WorktreeProjectGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeListItem[];
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
