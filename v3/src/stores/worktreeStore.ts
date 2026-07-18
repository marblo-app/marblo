import { create } from "zustand";
import type {
  Worktree,
  WorktreeProjectGroup,
  WorktreeStatusPill,
} from "../types/worktree";
import { t } from "../lib/i18n";
import {
  loadArchiveOverrides,
  persistArchiveOverrides,
  setOverride,
  type ArchiveOverrides,
} from "../lib/worktreeHygiene";

interface WorktreeState {
  worktrees: Worktree[];
  loading: boolean;
  lastError: string | null;
  /**
   * Epoch ms of the last *successful* refresh, or null before the first one.
   * Freshness gate for {@link ensureFresh}.
   */
  lastRefreshedAt: number | null;
  /**
   * User archive/restore overrides, keyed by worktree path. Persisted to
   * localStorage so hiding a worktree (or restoring an auto-archived one)
   * survives reloads. See {@link ../lib/worktreeHygiene}.
   */
  archiveOverrides: ArchiveOverrides;

  refresh: () => Promise<void>;
  /**
   * Refresh unless the list is younger than `maxAgeMs`. A full refresh walks
   * every registered worktree with several git subprocesses each (measured
   * ~20s at 681 worktrees), so callers that merely want "not a stale
   * snapshot" — card mounts, ticket modal opens — must use this instead of
   * refresh(). Concurrent callers share the same in-flight refresh.
   */
  ensureFresh: (maxAgeMs?: number) => Promise<void>;
  /** Archive (hide) or restore (show) a worktree by its key (path). */
  setWorktreeArchived: (key: string, archived: boolean) => void;
  rebase: (path: string, baseRef: string) => Promise<void>;
  merge: (args: {
    repoRoot: string;
    path: string;
    baseRef: string;
    branch: string;
    projectId?: string;
    taskId?: string;
    mode?: "manual" | "auto";
  }) => Promise<void>;
  resolve: (args: {
    repoRoot: string;
    path: string;
    baseRef: string;
    branch: string;
    projectId?: string;
    taskId?: string;
    conflicts?: string[];
  }) => Promise<void>;
  remove: (
    repoRoot: string,
    path: string,
    deleteBranch?: boolean,
  ) => Promise<void>;
  cleanupStale: (
    repoRoot: string,
    maxIdleDays?: number,
  ) => Promise<{
    removed: string[];
    failed: { path: string; error: string }[];
  }>;
  getWorktreesByProject: (projectId: string) => Worktree[];
  getGroupedByProject: () => Record<string, Worktree[]>;
  statusPill: (worktree: Worktree) => WorktreeStatusPill;
  clearError: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to load worktrees";
}

function assertActionResult(
  result: unknown,
  fallbackMessage: string,
): asserts result {
  if (!result || typeof result !== "object") return;
  if ("ok" in result && result.ok === false) {
    const conflicts =
      "conflicts" in result && Array.isArray(result.conflicts)
        ? result.conflicts.join(", ")
        : "";
    const error =
      "error" in result && typeof result.error === "string"
        ? result.error
        : conflicts
          ? `${fallbackMessage}: ${conflicts}`
          : fallbackMessage;
    throw new Error(error);
  }
  if ("success" in result && result.success === false) {
    const reason =
      "reason" in result && typeof result.reason === "string"
        ? result.reason
        : fallbackMessage;
    throw new Error(reason);
  }
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
    stale: item.stale ?? item.staleInfo?.stale ?? false,
    // Carry the full hygiene verdict so the renderer can distinguish
    // "merged" (aggressive auto-archive) from "idle-stale" and label each.
    staleInfo: item.staleInfo,
    status: item.status,
  };
}

export function statusPill(worktree: Worktree): WorktreeStatusPill {
  const status = worktree.status;
  if (status && (!status.mergeable || status.conflicts.length > 0)) {
    return { icon: "🔴", label: t("common.worktree.conflict"), tone: "danger" };
  }
  if (worktree.stale) {
    return { icon: "⚠️", label: "stale", tone: "warning" };
  }
  if (status && status.behind > 0) {
    return { icon: "🟡", label: t("common.worktree.behind"), tone: "behind" };
  }
  if (status && status.mergeable && status.behind === 0 && status.ahead > 0) {
    return { icon: "🟢", label: t("common.worktree.mergeable"), tone: "ready" };
  }
  return { icon: "⚪", label: t("common.worktree.idle"), tone: "idle" };
}

/**
 * Default freshness window for {@link WorktreeState.ensureFresh}. Card mounts
 * and modal opens arrive in bursts; anything younger than this is served from
 * the store as-is.
 */
export const WORKTREE_FRESH_TTL_MS = 60_000;

// Shared in-flight refresh so a burst of ensureFresh()/refresh() callers
// (every TaskCard mounting at once) collapses into a single worktree:list IPC.
let inflightRefresh: Promise<void> | null = null;

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  worktrees: [],
  loading: false,
  lastError: null,
  lastRefreshedAt: null,
  archiveOverrides: loadArchiveOverrides(),

  setWorktreeArchived: (key, archived) => {
    const next = setOverride(
      get().archiveOverrides,
      key,
      archived ? "archived" : "active",
    );
    persistArchiveOverrides(next);
    set({ archiveOverrides: next });
  },

  refresh: async () => {
    if (inflightRefresh) return inflightRefresh;
    const run = (async () => {
      set({ loading: true, lastError: null });
      try {
        const groups = await window.electronAPI.worktree.list();
        const worktrees = groups.flatMap((group) =>
          group.worktrees.map((item) => normalizeWorktree(group, item)),
        );
        set({ worktrees, loading: false, lastRefreshedAt: Date.now() });
      } catch (err) {
        set({ loading: false, lastError: errorMessage(err) });
        throw err;
      }
    })();
    inflightRefresh = run.finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  },

  ensureFresh: async (maxAgeMs = WORKTREE_FRESH_TTL_MS) => {
    if (inflightRefresh) return inflightRefresh;
    const { lastRefreshedAt } = get();
    if (lastRefreshedAt !== null && Date.now() - lastRefreshedAt < maxAgeMs) {
      return;
    }
    return get().refresh();
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

  cleanupStale: async (repoRoot, maxIdleDays) => {
    set({ loading: true, lastError: null });
    try {
      const result = await window.electronAPI.worktree.cleanupStale(
        repoRoot,
        maxIdleDays,
      );
      await get().refresh();
      return result;
    } catch (err) {
      set({ loading: false, lastError: errorMessage(err) });
      throw err;
    }
  },

  rebase: async (path, baseRef) => {
    set({ loading: true, lastError: null });
    try {
      const result = await window.electronAPI.worktree.rebase(path, baseRef);
      assertActionResult(result, "Rebase failed");
      await get().refresh();
    } catch (err) {
      set({ loading: false, lastError: errorMessage(err) });
      throw err;
    }
  },

  merge: async (args) => {
    set({ loading: true, lastError: null });
    try {
      const result = await window.electronAPI.worktree.merge(args);
      assertActionResult(result, "Merge failed");
      await get().refresh();
    } catch (err) {
      set({ loading: false, lastError: errorMessage(err) });
      throw err;
    }
  },

  resolve: async (args) => {
    set({ loading: true, lastError: null });
    try {
      const result = await window.electronAPI.worktree.resolve(args);
      assertActionResult(result, "Resolve failed");
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
