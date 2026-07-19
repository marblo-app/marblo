import * as fs from "node:fs";
import type { IpcMain } from "electron";
import type {
  CleanupStaleResult,
  StaleInfo,
  WorktreeInfo,
  WorktreeManager,
  WorktreeStatus,
} from "./worktree-manager";
import { classifyChangeType } from "./merge-features";

export interface WorktreeProjectRoot {
  projectId: string;
  repoRoot: string;
}

export interface WorktreeListItem extends WorktreeInfo {
  status: WorktreeStatus;
  /** Cleanup candidate (merged into base or long idle). Main worktree → false. */
  stale: boolean;
  /** Full stale verdict; omitted for the main worktree (never stale). */
  staleInfo?: StaleInfo;
}

export interface WorktreeProjectGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeListItem[];
}

/**
 * Topology-only variant of {@link WorktreeProjectGroup}: enumeration without
 * per-worktree status/staleInfo. Served by `worktree:listLight` for callers
 * that only need existence (board cards / ticket modal resolving "does this
 * task have a worktree?"). Measured at 681 registered worktrees: full list
 * ≈ 19–26s (7 git spawns per worktree), light list ≈ 0.17s (one
 * `git worktree list` + baseRef per repo).
 */
export interface WorktreeLightGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeInfo[];
}

interface WorktreeStatusArgs {
  path: string;
  baseRef: string;
}

interface WorktreeRemoveArgs {
  repoRoot: string;
  path: string;
  deleteBranch?: boolean;
}

interface WorktreeRebaseArgs {
  path: string;
  baseRef: string;
}

interface WorktreeMergeArgs {
  repoRoot: string;
  path: string;
  baseRef: string;
  branch: string;
  /** For the merge-history audit record (best-effort; merge proceeds without). */
  projectId?: string;
  taskId?: string;
  /** "manual" = human clicked Merge; "auto" = orchestrator auto-merge (future). */
  mode?: MergeMode;
}

interface WorktreeShowCommitArgs {
  repoRoot: string;
  sha: string;
}

export type MergeMode = "manual" | "auto";

/**
 * One immutable audit entry for a completed (squash-merged) worktree. Captured
 * at the merge chokepoint just before the worktree is torn down — the only
 * place all of {sha, branch, task} are still known. Persisted append-only
 * (see firestore.rules merge_history) so the cockpit's "완료 이력" view can
 * reconstruct who merged what, when, and link back to the diff via headSha.
 */
export interface MergeHistoryRecord {
  projectId: string;
  taskId?: string;
  repoRoot: string;
  branch: string;
  baseRef: string;
  headSha: string;
  mode: MergeMode;
  mergedAt: Date;
  // De-identified diff features derived ONCE at this chokepoint (privacy gate:
  // counts + path-category only, never raw diff). Fed to BOTH the audit doc and
  // the ML merge-outcome telemetry so the merge is captured a single time. Left
  // undefined when `git show` on the squashed sha failed.
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  changeType?: string;
}

/**
 * Injected by the host (main.ts) to persist a merge record. Left undefined in
 * tests / partial wiring, in which case merges simply aren't recorded (the
 * merge itself always proceeds). Fire-and-forget: never blocks the merge.
 */
export type MergeHistoryRecorder = (
  record: MergeHistoryRecord,
) => Promise<void>;

interface WorktreeResolveArgs {
  repoRoot: string;
  path: string;
  baseRef: string;
  branch: string;
  projectId?: string;
  taskId?: string;
  conflicts?: string[];
}

interface WorktreeCleanupStaleArgs {
  repoRoot: string;
  maxIdleDays?: number;
}

/**
 * Request handed to the resolver-spawner when a merge hits conflicts
 * (WORKTREE-SPEC §6 충돌 경로). The host wires this to BridgeServer's spawn
 * path so a Resolve(agent) launches inside the conflicted worktree.
 */
export interface WorktreeResolveRequest {
  repoRoot: string;
  worktreePath: string;
  baseRef: string;
  branch: string;
  projectId?: string;
  taskId?: string;
  conflicts?: string[];
}

export interface WorktreeResolveResult {
  success: boolean;
  agentId?: string;
  taskId?: string | null;
  /** True when no spawner was wired — resolve was a no-op stub. */
  stub?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Injected by the host (main.ts) to spawn a conflict-resolution agent in a
 * worktree. Left undefined in tests / partial wiring, in which case
 * worktree:resolve returns a clear stub instead of spawning.
 */
export type WorktreeResolverSpawner = (
  req: WorktreeResolveRequest,
) => Promise<WorktreeResolveResult>;

type ProjectRootProvider = () => WorktreeProjectRoot[];

const defaultProjectRootProvider: ProjectRootProvider = () => [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function parseStatusArgs(args: unknown): WorktreeStatusArgs {
  if (!isRecord(args)) throw new Error("worktree:status args must be object");
  return {
    path: requireString(args.path, "path"),
    baseRef: requireString(args.baseRef, "baseRef"),
  };
}

function parseRemoveArgs(args: unknown): WorktreeRemoveArgs {
  if (!isRecord(args)) throw new Error("worktree:remove args must be object");
  return {
    repoRoot: requireString(args.repoRoot, "repoRoot"),
    path: requireString(args.path, "path"),
    deleteBranch:
      typeof args.deleteBranch === "boolean" ? args.deleteBranch : undefined,
  };
}

function parseRebaseArgs(args: unknown): WorktreeRebaseArgs {
  if (!isRecord(args)) throw new Error("worktree:rebase args must be object");
  return {
    path: requireString(args.path, "path"),
    baseRef: requireString(args.baseRef, "baseRef"),
  };
}

function parseMergeArgs(args: unknown): WorktreeMergeArgs {
  if (!isRecord(args)) throw new Error("worktree:merge args must be object");
  return {
    repoRoot: requireString(args.repoRoot, "repoRoot"),
    path: requireString(args.path, "path"),
    baseRef: requireString(args.baseRef, "baseRef"),
    branch: requireString(args.branch, "branch"),
    projectId:
      typeof args.projectId === "string" && args.projectId.length > 0
        ? args.projectId
        : undefined,
    taskId:
      typeof args.taskId === "string" && args.taskId.length > 0
        ? args.taskId
        : undefined,
    mode: args.mode === "auto" ? "auto" : "manual",
  };
}

function parseShowCommitArgs(args: unknown): WorktreeShowCommitArgs {
  if (!isRecord(args))
    throw new Error("worktree:showCommit args must be object");
  return {
    repoRoot: requireString(args.repoRoot, "repoRoot"),
    sha: requireString(args.sha, "sha"),
  };
}

function parseCleanupStaleArgs(args: unknown): WorktreeCleanupStaleArgs {
  if (!isRecord(args))
    throw new Error("worktree:cleanupStale args must be object");
  const maxIdleDays =
    typeof args.maxIdleDays === "number" &&
    Number.isFinite(args.maxIdleDays) &&
    args.maxIdleDays >= 0
      ? args.maxIdleDays
      : undefined;
  return {
    repoRoot: requireString(args.repoRoot, "repoRoot"),
    maxIdleDays,
  };
}

function parseResolveArgs(args: unknown): WorktreeResolveArgs {
  if (!isRecord(args)) throw new Error("worktree:resolve args must be object");
  return {
    repoRoot: requireString(args.repoRoot, "repoRoot"),
    path: requireString(args.path, "path"),
    baseRef: requireString(args.baseRef, "baseRef"),
    branch: requireString(args.branch, "branch"),
    projectId:
      typeof args.projectId === "string" && args.projectId.length > 0
        ? args.projectId
        : undefined,
    taskId:
      typeof args.taskId === "string" && args.taskId.length > 0
        ? args.taskId
        : undefined,
    conflicts: Array.isArray(args.conflicts)
      ? args.conflicts.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}

/**
 * Cap on concurrent per-worktree status probes during a full list. Each probe
 * is up to 7 short git subprocesses; unbounded Promise.all at 681 worktrees
 * launches them all at once (measured: ~4,700 competing spawns, individual
 * commands ballooning from ~18ms uncontended to 1–5s) and the process storm
 * drags the whole machine — including the renderer. 16 saturates the disk
 * already (measured 12.2s; 32 → 12.9s), without the system-wide stall.
 */
const STATUS_PROBE_CONCURRENCY = 16;

/** Map with at most `limit` callbacks in flight (order-preserving). */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

function uniqueProjectRoots(
  roots: WorktreeProjectRoot[],
): WorktreeProjectRoot[] {
  const seen = new Set<string>();
  const out: WorktreeProjectRoot[] = [];
  for (const root of roots) {
    if (!root.projectId || !root.repoRoot) continue;
    const key = `${root.projectId}\0${root.repoRoot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

export function registerWorktreeIpc(
  ipcMain: IpcMain,
  worktreeManager: WorktreeManager,
  getProjectRoots: ProjectRootProvider = defaultProjectRootProvider,
  spawnResolver?: WorktreeResolverSpawner,
  recordMergeHistory?: MergeHistoryRecorder,
  // Called with the worktree paths a removal just deleted. Open windows may be
  // rooted at one of them; main.ts uses this to re-point them before the dead
  // path gets persisted to app-state.json. Removal succeeds regardless — this
  // is a notification, not a gate.
  onWorktreesRemoved?: (paths: string[]) => void,
): void {
  const listWorktrees = async (): Promise<WorktreeProjectGroup[]> => {
    const roots = uniqueProjectRoots(getProjectRoots());
    return Promise.all(
      roots.map(async ({ projectId, repoRoot }) => {
        const baseRef = await worktreeManager.resolveBaseRef(repoRoot);
        const worktrees = await worktreeManager.list(repoRoot);
        // The main working tree (path === repoRoot) is "merged" by definition
        // and must never be flagged stale / offered for cleanup.
        const realRepoRoot = fs.existsSync(repoRoot)
          ? fs.realpathSync(repoRoot)
          : repoRoot;
        const items = await mapBounded(
          worktrees,
          STATUS_PROBE_CONCURRENCY,
          async (worktree) => {
            const status = await worktreeManager.status(worktree.path, baseRef);
            if (worktree.path === realRepoRoot) {
              return { ...worktree, status, stale: false };
            }
            const staleInfo = await worktreeManager.staleInfo(
              worktree.path,
              baseRef,
            );
            return { ...worktree, status, stale: staleInfo.stale, staleInfo };
          },
        );
        return { projectId, repoRoot, baseRef, worktrees: items };
      }),
    );
  };

  // Topology only — no per-worktree git probes. This is the ensureFresh()
  // path behind board cards / the ticket modal, where the only question is
  // "does a worktree exist for this task?" and the full sweep's 19–26s cost
  // (ticket yJgz7s03) is pure waste.
  const listWorktreesLight = async (): Promise<WorktreeLightGroup[]> => {
    const roots = uniqueProjectRoots(getProjectRoots());
    return Promise.all(
      roots.map(async ({ projectId, repoRoot }) => {
        const baseRef = await worktreeManager.resolveBaseRef(repoRoot);
        const worktrees = await worktreeManager.list(repoRoot);
        return { projectId, repoRoot, baseRef, worktrees };
      }),
    );
  };

  ipcMain.handle("worktree:list", listWorktrees);
  ipcMain.handle("worktree:refresh", listWorktrees);
  ipcMain.handle("worktree:listLight", listWorktreesLight);

  ipcMain.handle("worktree:status", async (_event, args: unknown) => {
    const parsed = parseStatusArgs(args);
    return worktreeManager.status(parsed.path, parsed.baseRef);
  });

  ipcMain.handle("worktree:remove", async (_event, args: unknown) => {
    const parsed = parseRemoveArgs(args);
    await worktreeManager.remove(parsed.repoRoot, parsed.path, {
      deleteBranch: parsed.deleteBranch,
    });
    onWorktreesRemoved?.([parsed.path]);
    return { success: true };
  });

  ipcMain.handle("worktree:prune", async (_event, repoRoot: unknown) => {
    await worktreeManager.prune(requireString(repoRoot, "repoRoot"));
    return { success: true };
  });

  // Stale hygiene (WORKTREE-SPEC §4): bulk-remove worktrees that are already
  // merged into base or long idle, deleting their branches. Delegates to the
  // manager (reuses list/staleInfo/remove); the main worktree is never touched.
  ipcMain.handle(
    "worktree:cleanupStale",
    async (_event, args: unknown): Promise<CleanupStaleResult> => {
      const parsed = parseCleanupStaleArgs(args);
      const result = await worktreeManager.cleanupStale(
        parsed.repoRoot,
        parsed.maxIdleDays !== undefined
          ? { maxIdleDays: parsed.maxIdleDays }
          : undefined,
      );
      // Bulk hygiene is the highest-volume source of dead window roots — it can
      // remove hundreds of worktrees in one call.
      if (result.removed.length > 0) onWorktreesRemoved?.(result.removed);
      return result;
    },
  );

  // ── Merge stage (WORKTREE-SPEC §4/§6) ──────────────────────────

  // Rebase the worktree branch onto base. Conflict → {ok:false, conflicts}
  // (the manager safe-aborts so the working tree is never left half-rebased).
  ipcMain.handle("worktree:rebase", async (_event, args: unknown) => {
    const parsed = parseRebaseArgs(args);
    return worktreeManager.rebaseOntoBase(parsed.path, parsed.baseRef);
  });

  // Clean path: rebase → squash onto base → remove worktree+branch. A rebase
  // conflict short-circuits to {ok:false, needsResolve:true}; the caller then
  // invokes worktree:resolve to spawn a Resolve(agent).
  ipcMain.handle("worktree:merge", async (_event, args: unknown) => {
    const parsed = parseMergeArgs(args);
    const result = await worktreeManager.squashMergeToBase(
      parsed.repoRoot,
      parsed.path,
      parsed.baseRef,
      parsed.branch,
    );

    // Append-only audit record on success — fire-and-forget so a Firestore
    // hiccup never fails or stalls the merge. Needs projectId + the sha that
    // the manager captured before teardown; skip silently if either is absent.
    if (
      result.ok &&
      recordMergeHistory &&
      parsed.projectId &&
      result.mergedSha
    ) {
      // Single-source merge capture (ticket cZBlOnkg): compute de-identified
      // diff features ONCE here, then hand them to recordMergeHistory which
      // feeds BOTH the audit trail (merge_history) and the ML sink
      // (task:merged → BigQuery events). No duplicate capture, no raw diff.
      const stat = await worktreeManager.mergedCommitDiffStat(
        parsed.repoRoot,
        result.mergedSha,
      );
      const changeType = stat ? classifyChangeType(stat.paths) : undefined;
      void recordMergeHistory({
        projectId: parsed.projectId,
        taskId: parsed.taskId,
        repoRoot: parsed.repoRoot,
        branch: parsed.branch,
        baseRef: parsed.baseRef,
        headSha: result.mergedSha,
        mode: parsed.mode ?? "manual",
        mergedAt: new Date(),
        filesChanged: stat?.filesChanged,
        linesAdded: stat?.linesAdded,
        linesDeleted: stat?.linesDeleted,
        changeType,
      }).catch((err) => {
        console.error("[MergeHistory] record failed:", err);
      });
    }

    return result;
  });

  // Recover the diff of a completed merge for the "완료 이력" view: the worktree
  // is long gone, but its squashed commit lives on base — `git show <sha>`.
  ipcMain.handle("worktree:showCommit", async (_event, args: unknown) => {
    const parsed = parseShowCommitArgs(args);
    const diff = await worktreeManager.showCommit(parsed.repoRoot, parsed.sha);
    return { ok: true, diff };
  });

  // Conflict path: spawn a resolver agent inside the conflicted worktree. Wired
  // by the host via spawnResolver; absent that, returns a clear stub so the UI
  // can surface "resolver not available" instead of silently failing.
  ipcMain.handle("worktree:resolve", async (_event, args: unknown) => {
    const parsed = parseResolveArgs(args);
    if (!spawnResolver) {
      return {
        success: false,
        stub: true,
        reason:
          "resolver spawn not wired — pass spawnResolver to registerWorktreeIpc",
      } satisfies WorktreeResolveResult;
    }
    return spawnResolver({
      repoRoot: parsed.repoRoot,
      worktreePath: parsed.path,
      baseRef: parsed.baseRef,
      branch: parsed.branch,
      projectId: parsed.projectId,
      taskId: parsed.taskId,
      conflicts: parsed.conflicts,
    });
  });
}
