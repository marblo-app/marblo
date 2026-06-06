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

function uniqueProjectRoots(roots: WorktreeProjectRoot[]): WorktreeProjectRoot[] {
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
}
