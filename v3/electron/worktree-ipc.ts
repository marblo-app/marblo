import type { IpcMain } from "electron";
import type {
  WorktreeInfo,
  WorktreeManager,
  WorktreeStatus,
} from "./worktree-manager";

export interface WorktreeProjectRoot {
  projectId: string;
  repoRoot: string;
}

export interface WorktreeListItem extends WorktreeInfo {
  status: WorktreeStatus;
}

export interface WorktreeProjectGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeListItem[];
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
}

interface WorktreeResolveArgs {
  repoRoot: string;
  path: string;
  baseRef: string;
  branch: string;
  projectId?: string;
  taskId?: string;
  conflicts?: string[];
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
): void {
  const listWorktrees = async (): Promise<WorktreeProjectGroup[]> => {
    const roots = uniqueProjectRoots(getProjectRoots());
    return Promise.all(
      roots.map(async ({ projectId, repoRoot }) => {
        const baseRef = await worktreeManager.resolveBaseRef(repoRoot);
        const worktrees = await worktreeManager.list(repoRoot);
        const items = await Promise.all(
          worktrees.map(async (worktree) => ({
            ...worktree,
            status: await worktreeManager.status(worktree.path, baseRef),
          })),
        );
        return { projectId, repoRoot, baseRef, worktrees: items };
      }),
    );
  };

  ipcMain.handle("worktree:list", listWorktrees);
  ipcMain.handle("worktree:refresh", listWorktrees);

  ipcMain.handle("worktree:status", async (_event, args: unknown) => {
    const parsed = parseStatusArgs(args);
    return worktreeManager.status(parsed.path, parsed.baseRef);
  });

  ipcMain.handle("worktree:remove", async (_event, args: unknown) => {
    const parsed = parseRemoveArgs(args);
    await worktreeManager.remove(parsed.repoRoot, parsed.path, {
      deleteBranch: parsed.deleteBranch,
    });
    return { success: true };
  });

  ipcMain.handle("worktree:prune", async (_event, repoRoot: unknown) => {
    await worktreeManager.prune(requireString(repoRoot, "repoRoot"));
    return { success: true };
  });

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
    return worktreeManager.squashMergeToBase(
      parsed.repoRoot,
      parsed.path,
      parsed.baseRef,
      parsed.branch,
    );
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
