import * as path from "node:path";
import type { WorktreeInfo, WorktreeManager } from "./worktree-manager";

export interface PrepareInput {
  projectId?: string;
  taskId?: string;
  title?: string;
  /** Spawn prompt for ad-hoc tasks — persisted as the board task's description
   *  so a worktree-spawned agent's ticket shows what it was asked to do. */
  description?: string;
  repoRoot: string;
  requestedCwd?: string;
}

export interface PrepareResult {
  taskId: string | null;
  cwd: string;
  worktreeCreated: boolean;
}

export interface WorktreeCoordinatorDeps {
  worktreeManager: WorktreeManager;
  createTask: (input: {
    projectId: string;
    title: string;
    description?: string;
  }) => Promise<string>;
}

/**
 * Runs just before an agent is spawned. Guarantees a board task and an isolated
 * git worktree exist for it, returning the cwd the agent should launch in
 * (WORKTREE-SPEC §3 핵심모델 / §4 라이프사이클).
 *
 * Never throws: if the repo isn't a git repo, there's no project context, or the
 * worktree create fails, it falls back to a plain cwd so a spawn is never blocked.
 */
export class WorktreeCoordinator {
  private readonly worktreeManager: WorktreeManager;
  private readonly createTask: WorktreeCoordinatorDeps["createTask"];

  constructor(deps: WorktreeCoordinatorDeps) {
    this.worktreeManager = deps.worktreeManager;
    this.createTask = deps.createTask;
  }

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const { projectId, taskId, title, description, repoRoot, requestedCwd } =
      input;
    const fallback = (tid: string | null): PrepareResult => ({
      taskId: tid,
      cwd: requestedCwd ?? repoRoot,
      worktreeCreated: false,
    });

    // No project context → nothing to isolate against; spawn in place.
    if (!projectId) return fallback(taskId ?? null);

    // git-repo probe: a real repo always lists at least its main worktree, so an
    // empty list means repoRoot isn't a git repo. Reused below for the dup check.
    let worktrees: WorktreeInfo[] = [];
    try {
      worktrees = await this.worktreeManager.list(repoRoot);
    } catch {
      worktrees = [];
    }
    if (worktrees.length === 0) return fallback(taskId ?? null);

    // Ensure a board task: ad-hoc agents (no taskId) get one auto-created so the
    // invariant "every worktree has a task" holds (WORKTREE-SPEC §3).
    let resolvedTaskId = taskId;
    if (!resolvedTaskId) {
      resolvedTaskId = await this.createTask({
        projectId,
        title: title ?? "ad-hoc",
        description,
      });
    }

    // Reuse an existing worktree for this (projectId, taskId) — never create twice.
    // Worktree paths are ~/.marblo/worktrees/<projectId>/<taskId>, so the
    // <projectId>/<taskId> suffix uniquely identifies the row.
    const suffix = path.sep + path.join(projectId, resolvedTaskId);
    const existing = worktrees.find((w) => w.path.endsWith(suffix));
    if (existing) {
      return {
        taskId: resolvedTaskId,
        cwd: existing.path,
        worktreeCreated: false,
      };
    }

    // Create a fresh worktree. If git fails (path clash / disk), don't block the
    // spawn — fall back to a plain cwd and surface the error.
    try {
      const info = await this.worktreeManager.create({
        repoRoot,
        projectId,
        taskId: resolvedTaskId,
        slug: title ?? resolvedTaskId,
      });
      return { taskId: resolvedTaskId, cwd: info.path, worktreeCreated: true };
    } catch (e) {
      console.error(
        `[WorktreeCoordinator] worktree create failed for task ${resolvedTaskId}:`,
        e,
      );
      return {
        taskId: resolvedTaskId,
        cwd: requestedCwd ?? repoRoot,
        worktreeCreated: false,
      };
    }
  }
}
