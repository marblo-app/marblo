import { create } from "zustand";
import type {
  Worktree,
  WorktreeProjectGroup,
  WorktreeStatusPill,
} from "../types/worktree";

interface WorktreeState {
  worktrees: Worktree[];
  loading: boolean;
  lastError: string | null;

  refresh: () => Promise<void>;
  remove: (
    repoRoot: string,
    path: string,
    deleteBranch?: boolean,
  ) => Promise<void>;
  getWorktreesByProject: (projectId: string) => Worktree[];
  getGroupedByProject: () => Record<string, Worktree[]>;
  statusPill: (worktree: Worktree) => WorktreeStatusPill;
  clearError: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to load worktrees";
}

function inferTaskId(projectId: string, worktreePath: string): string | null {
  const parts = worktreePath.split(/[\\/]+/).filter(Boolean);
  const projectIndex = parts.lastIndexOf(projectId);
  if (projectIndex === -1) return null;
  return parts[projectIndex + 1] ?? null;
}

function normalizeWorktree(
  group: WorktreeProjectGroup,
  item: WorktreeProjectGroup["worktrees"][number],
): Worktree {
  const taskId = inferTaskId(group.projectId, item.path);
  return {
    id: `${group.projectId}:${item.path}`,
    taskId,
    projectId: group.projectId,
    agentId: null,
    branch: item.branch || item.status.branch,
    baseRef: item.status.baseRef || group.baseRef,
    path: item.path,
    repoRoot: group.repoRoot,
    head: item.head,
    createdAt: null,
    status: item.status,
  };
}

export function statusPill(worktree: Worktree): WorktreeStatusPill {
  const status = worktree.status;
  if (status && (!status.mergeable || status.conflicts.length > 0)) {
    return { icon: "🔴", label: "충돌", tone: "danger" };
  }
  if (worktree.stale) {
    return { icon: "⚠️", label: "stale", tone: "warning" };
  }
  if (status && status.behind > 0) {
    return { icon: "🟡", label: "뒤처짐", tone: "behind" };
  }
  if (status && status.mergeable && status.behind === 0 && status.ahead > 0) {
    return { icon: "🟢", label: "머지 가능", tone: "ready" };
  }
  return { icon: "⚪", label: "작업중", tone: "idle" };
}

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  worktrees: [],
  loading: false,
  lastError: null,

  refresh: async () => {
    set({ loading: true, lastError: null });
    try {
      const groups = await window.electronAPI.worktree.list();
      const worktrees = groups.flatMap((group) =>
        group.worktrees.map((item) => normalizeWorktree(group, item)),
      );
      set({ worktrees, loading: false });
    } catch (err) {
      set({ loading: false, lastError: errorMessage(err) });
      throw err;
    }
  },

  remove: async (repoRoot, path, deleteBranch) => {
    set({ loading: true, lastError: null });
    try {
      await window.electronAPI.worktree.remove(repoRoot, path, deleteBranch);
      await get().refresh();
    } catch (err) {
      set({ loading: false, lastError: errorMessage(err) });
      throw err;
    }
  },

  getWorktreesByProject: (projectId) => {
    return get().worktrees.filter(
      (worktree) => worktree.projectId === projectId,
    );
  },

  getGroupedByProject: () => {
    return get().worktrees.reduce<Record<string, Worktree[]>>(
      (groups, worktree) => {
        groups[worktree.projectId] = groups[worktree.projectId] ?? [];
        groups[worktree.projectId].push(worktree);
        return groups;
      },
      {},
    );
  },

  statusPill,

  clearError: () => set({ lastError: null }),
}));
