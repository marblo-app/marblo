import { create } from "zustand";
import type {
  Worktree,
  WorktreeLightGroup,
  WorktreeLightItem,
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
import {
  buildVerdictCache,
  cachedVerdictFor,
  loadVerdictCache,
  saveVerdictCache,
} from "../lib/worktreeVerdictCache";

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
   * Topology-only refresh via `worktree:listLight` (one `git worktree list`
   * per repo, measured ~0.17s at 681 worktrees vs ~19–26s for the full
   * status sweep). Existing per-worktree status/staleInfo is carried over
   * when a worktree's HEAD is unchanged, and dropped when it moved (the old
   * status is provably outdated); a later full refresh() re-hydrates it.
   */
  refreshLight: () => Promise<void>;
  /**
   * Refresh unless the list is younger than `maxAgeMs`. Uses the light
   * (topology-only) refresh: its callers — card mounts, ticket modal opens —
   * only need "does this task's worktree exist?", never the merge status,
   * and the full sweep's ~20s process storm was freezing the ticket screen
   * (ticket yJgz7s03). Concurrent callers share the same in-flight fetch.
   */
  ensureFresh: (maxAgeMs?: number) => Promise<void>;
  /**
   * Resolve ONE worktree on demand: run `select` against the current snapshot
   * and, only on a miss, re-enumerate (light) once and select again. Returns
   * null when it genuinely isn't there — callers must surface that as a
   * failure, never as an empty-but-fine result (ticket F2WGGGVthmg7lN490PDy).
   *
   * `select` takes the whole list rather than a per-item predicate so callers
   * keep their *ordered* matching rules (findTaskWorktree tries taskId → path
   * → branch in priority order; a plain `.find(predicate)` would return
   * whichever candidate happens to sit earliest in the array).
   *
   * ── Why the escalation is refreshLight(), never refresh() ──────────────────
   * Both IPCs enumerate the identical set — `worktree:list` and
   * `worktree:listLight` each come from `worktreeManager.list(repoRoot)` over
   * the same project roots. The full list only *adds* per-worktree status +
   * staleInfo probes (~61ms × N; measured 9.4s sequential and 12–26s under
   * spawn contention at 160 worktrees). So the sweep cannot find a worktree
   * the light path missed — on the miss path it buys nothing and pays
   * everything. Callers that need `status` for the one resolved worktree ask
   * `worktree:status` for that path alone.
   */
  resolveWorktree: (
    select: (worktrees: Worktree[]) => Worktree | null,
  ) => Promise<Worktree | null>;
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

/**
 * Is this the repo's main working tree?
 *
 * `git worktree list` documents that the main worktree is listed first and the
 * linked worktrees follow, and `worktreeManager.list` preserves that order — so
 * the enumeration index IS git's answer. Stamping it here (identically on the
 * full and the light path) is what lets `findMainWorktree` stop inferring
 * "main" from path shape, which mis-fires whenever the projectId is absent from
 * the worktree path or the group's repoRoot is an orchestrator session root
 * that happens to be a worktree.
 */
function isMainByEnumerationOrder(index: number): boolean {
  return index === 0;
}

function normalizeWorktree(
  group: WorktreeProjectGroup,
  item: WorktreeProjectGroup["worktrees"][number],
  index: number,
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
    isMain: isMainByEnumerationOrder(index),
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
// Separate slot for the light (topology-only) fetch: a light fetch must not
// satisfy a full refresh() — it carries no status — but either one satisfies
// ensureFresh().
let inflightLight: Promise<void> | null = null;

/**
 * Normalize a light (topology-only) entry, carrying status/staleInfo over
 * from the previous snapshot when the worktree's HEAD is unchanged. A moved
 * HEAD means new commits — the old merge status is provably outdated, so it
 * is dropped (pill degrades to ⚪ idle) until the next full refresh().
 *
 * When the in-memory snapshot has no verdict (cold start — the store now
 * light-refreshes on Code tab / FileTree mounts and never runs the full sweep
 * itself), the persisted verdict cache fills in stale/staleInfo for an
 * unmoved HEAD so the archived-worktree filter keeps working across reloads.
 */
function normalizeLightWorktree(
  group: WorktreeLightGroup,
  item: WorktreeLightItem,
  prev: Worktree | undefined,
  index: number,
  verdicts: ReturnType<typeof loadVerdictCache>,
): Worktree {
  const carry = prev !== undefined && prev.head === item.head;
  const cached = carry
    ? null
    : cachedVerdictFor(verdicts, item.path, item.head);
  return {
    id: `${group.projectId}:${item.path}`,
    taskId: inferTaskId(group.projectId, item.path),
    projectId: group.projectId,
    agentId: null,
    branch: item.branch,
    baseRef: group.baseRef,
    path: item.path,
    repoRoot: group.repoRoot,
    head: item.head,
    createdAt: prev?.createdAt ?? null,
    // Stamped from enumeration order, never carried over from `prev`: the light
    // path re-enumerates every time, so index 0 is always current truth.
    isMain: isMainByEnumerationOrder(index),
    stale: carry ? prev.stale : (cached?.stale ?? false),
    staleInfo: carry ? prev.staleInfo : cached?.staleInfo,
    status: carry ? prev.status : undefined,
  };
}

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
          group.worktrees.map((item, index) =>
            normalizeWorktree(group, item, index),
          ),
        );
        set({ worktrees, loading: false, lastRefreshedAt: Date.now() });
        // Persist the sweep's hygiene verdicts so light refreshes (Code tab /
        // FileTree mounts) can keep filtering archived worktrees without ever
        // re-running the 12–26s sweep themselves.
        saveVerdictCache(buildVerdictCache(worktrees));
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

  refreshLight: async () => {
    if (inflightLight) return inflightLight;
    const run = (async () => {
      set({ loading: true, lastError: null });
      try {
        // Fall back to the full list when the preload predates listLight
        // (dev HMR / renderer newer than main) — slower but never wrong.
        const api = window.electronAPI.worktree;
        const groups: (WorktreeLightGroup | WorktreeProjectGroup)[] =
          api.listLight ? await api.listLight() : await api.list();
        // Snapshot AFTER the await so a full refresh that landed meanwhile
        // contributes its fresh statuses to the carry-over.
        const prevById = new Map(get().worktrees.map((w) => [w.id, w]));
        const verdicts = loadVerdictCache();
        const worktrees = groups.flatMap((group) =>
          group.worktrees.map((item, index) =>
            normalizeLightWorktree(
              group,
              item,
              prevById.get(`${group.projectId}:${item.path}`),
              index,
              verdicts,
            ),
          ),
        );
        set({ worktrees, loading: false, lastRefreshedAt: Date.now() });
      } catch (err) {
        set({ loading: false, lastError: errorMessage(err) });
        throw err;
      }
    })();
    inflightLight = run.finally(() => {
      inflightLight = null;
    });
    return inflightLight;
  },

  ensureFresh: async (maxAgeMs = WORKTREE_FRESH_TTL_MS) => {
    if (inflightRefresh) return inflightRefresh;
    if (inflightLight) return inflightLight;
    const { lastRefreshedAt } = get();
    if (lastRefreshedAt !== null && Date.now() - lastRefreshedAt < maxAgeMs) {
      return;
    }
    return get().refreshLight();
  },

  resolveWorktree: async (select) => {
    const hit = select(get().worktrees);
    if (hit) return hit;
    // Miss → one cheap re-enumeration. Not TTL-gated: the caller is acting on
    // an explicit click and a miss is exactly the case where the snapshot is
    // suspect (the worktree may have been created seconds ago). Concurrent
    // callers still share `inflightLight`.
    await get().refreshLight();
    return select(get().worktrees);
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
