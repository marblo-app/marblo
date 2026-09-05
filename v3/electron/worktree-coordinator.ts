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
  /** Present only when dispatch reuses an existing worktree; never a gate. */
  baseStatus?: {
    baseRef: string;
    behind: number;
  };
}

export interface ReapForTaskInput {
  projectId: string;
  taskId: string;
  repoRoot: string;
  /** Only reap if the branch is merged into base (PR-merge trigger). */
  requireMerged?: boolean;
}

export interface ReapForTaskResult {
  removed: boolean;
  /** Why it was removed, or why it was preserved / skipped. */
  reason: string;
  /** The worktree path acted on, when one was found. */
  path?: string;
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

  // L3 — per-(projectId, taskId) serialization. The dedup below (find an
  // existing worktree by <projectId>/<taskId> suffix) is a check-then-act that
  // straddles `await`s, so two concurrent prepare() calls for the SAME task can
  // both observe "no worktree yet" and both create one. Chaining each key's
  // calls makes the list→find→create section atomic per task: the second caller
  // runs only after the first finishes and therefore sees its worktree.
  private readonly prepareLocks = new Map<string, Promise<unknown>>();

  constructor(deps: WorktreeCoordinatorDeps) {
    this.worktreeManager = deps.worktreeManager;
    this.createTask = deps.createTask;
  }

  /**
   * Lock key for a (projectId, taskId) pair.
   *
   * MUST be built in exactly one place. prepare() used to embed a raw NUL byte
   * here while reapForTask() used a space, so the two took DIFFERENT locks and
   * the "a reap can't race a concurrent re-create of the same task's worktree"
   * guarantee documented on reapForTask() silently did not hold. (The raw NUL
   * also made git treat this file as binary, hiding every diff.) `\0` still
   * separates unambiguously - neither id can contain it - but written as an
   * escape so the source stays text.
   */
  private lockKey(projectId: string, taskId: string): string {
    return `${projectId}\0${taskId}`;
  }

  /** Run `fn` after any in-flight call for the same `key` settles (success or
   * failure both release the lock so one bad prepare can't wedge the task). */
  private runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.prepareLocks.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    // Tail never rejects, so the next waiter can always await it.
    const tail = result.then(
      () => {},
      () => {},
    );
    this.prepareLocks.set(key, tail);
    void tail.finally(() => {
      // GC: drop the entry only if no newer call has chained on.
      if (this.prepareLocks.get(key) === tail) this.prepareLocks.delete(key);
    });
    return result;
  }

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    // Only a concrete (projectId, taskId) identifies a single worktree to
    // dedup against. Ad-hoc spawns (no taskId) create their own task each, so
    // there's nothing to serialize — run them directly.
    if (input.projectId && input.taskId) {
      return this.runExclusive(
        this.lockKey(input.projectId, input.taskId),
        () => this.prepareInner(input),
      );
    }
    return this.prepareInner(input);
  }

  /**
   * Observe an existing worktree immediately before reuse. Fetch is
   * best-effort, matching create(): offline dispatch still proceeds, while a
   * reachable origin gives a current default-base count. This topology signal
   * is freshness-only, never evidence about whether a patch was squash-merged.
   */
  private async existingBaseStatus(
    worktreePath: string,
    repoRoot: string,
  ): Promise<PrepareResult["baseStatus"]> {
    try {
      await this.worktreeManager.fetchOrigin(repoRoot);
      // Resolve from the primary checkout, not the reused branch: without an
      // origin/HEAD ref the latter would resolve to itself and report 0.
      const baseRef = await this.worktreeManager.resolveBaseRef(repoRoot);
      const status = await this.worktreeManager.status(worktreePath, baseRef);
      return { baseRef, behind: status.behind };
    } catch {
      // Do not invent a zero count when git evidence is unavailable.
      return undefined;
    }
  }

  private async prepareInner(input: PrepareInput): Promise<PrepareResult> {
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
        baseStatus: await this.existingBaseStatus(existing.path, repoRoot),
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

  /**
   * Reap the isolated worktree of a now-terminal task (DONE) or a merged PR —
   * the lifecycle counterpart of prepare(). Locates the worktree by the same
   * `<projectId>/<taskId>` path convention prepare() creates it under, then
   * delegates to the manager's safety-gated reap (dirty / unmerged-unpushed
   * work is preserved, never destroyed).
   *
   * Never throws: a missing worktree, a non-git repo, or any git failure
   * resolves to `{ removed: false, reason }` so a lifecycle event is never
   * blocked by cleanup. Serialized per (projectId, taskId) against prepare()
   * so a reap can't race a concurrent re-create of the same task's worktree.
   */
  async reapForTask(input: ReapForTaskInput): Promise<ReapForTaskResult> {
    const { projectId, taskId, repoRoot, requireMerged } = input;
    return this.runExclusive(this.lockKey(projectId, taskId), async () => {
      try {
        // Drop admin entries whose directory is already gone BEFORE listing.
        // `git worktree remove` cleans up the entry it removes, but a tree that
        // disappeared any other way (manual rm, an interrupted teardown) stays
        // registered forever — and `reap` can't clear it either, because every
        // git probe against the missing dir errors and `hasUncommittedChanges`
        // conservatively reads that as "dirty" → preserved. So the stale
        // registration outlives the worktree and keeps showing up as work that
        // still needs cleaning. Pruning first is what actually clears it.
        // Safe by construction: prune only touches entries whose directory no
        // longer exists, never a live worktree. `reapAll` already opens the
        // same way.
        try {
          await this.worktreeManager.prune(repoRoot);
        } catch {
          // Best-effort hygiene — never block a reap on it.
        }

        let worktrees: WorktreeInfo[] = [];
        try {
          worktrees = await this.worktreeManager.list(repoRoot);
        } catch {
          worktrees = [];
        }
        const suffix = path.sep + path.join(projectId, taskId);
        const wt = worktrees.find((w) => w.path.endsWith(suffix));
        if (!wt) return { removed: false, reason: "no worktree for task" };

        const res = await this.worktreeManager.reap(repoRoot, wt.path, {
          requireMerged,
        });
        return { removed: res.removed, reason: res.reason, path: wt.path };
      } catch (e) {
        console.error(
          `[WorktreeCoordinator] reapForTask failed for task ${taskId}:`,
          e,
        );
        return {
          removed: false,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    });
  }
}
