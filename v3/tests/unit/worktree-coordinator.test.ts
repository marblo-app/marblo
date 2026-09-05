import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";
import { WorktreeCoordinator } from "../../electron/worktree-coordinator";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/**
 * Fresh, isolated git repo on branch `main` with one commit (no remote).
 * Mirrors the makeRepo() helper pattern in worktree-manager.test.ts —
 * fs.realpathSync normalizes /var → /private/var on macOS for path equality.
 */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wtc-")),
  );
  const repoRoot = path.join(base, "repo");
  const wtRoot = path.join(base, "worktrees");
  fs.mkdirSync(repoRoot, { recursive: true });
  git(["init", "-b", "main"], repoRoot);
  git(["config", "user.email", "t@t.com"], repoRoot);
  git(["config", "user.name", "t"], repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "base\n");
  git(["add", "."], repoRoot);
  git(["commit", "-m", "init"], repoRoot);
  return {
    repoRoot,
    wtRoot,
    mgr: new WorktreeManager({ worktreesRoot: wtRoot }),
  };
}

describe("WorktreeCoordinator.prepare", () => {
  it("creates a worktree under the given taskId and returns worktreeCreated:true", async () => {
    const { repoRoot, wtRoot, mgr } = makeRepo();
    const createTask = vi.fn(async () => "SHOULD_NOT_BE_CALLED");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const res = await coord.prepare({
      projectId: "proj1",
      taskId: "task1234abcd",
      title: "Login Bug Fix",
      repoRoot,
    });

    expect(res.taskId).toBe("task1234abcd");
    expect(res.worktreeCreated).toBe(true);
    expect(res.cwd).toBe(path.join(wtRoot, "proj1", "task1234abcd"));
    // The base commit is checked out in the new worktree.
    expect(fs.existsSync(path.join(res.cwd, "README.md"))).toBe(true);
    // taskId was supplied → no ad-hoc task is created.
    expect(createTask).not.toHaveBeenCalled();
  });

  it("auto-creates an ad-hoc task when no taskId is given and uses its id", async () => {
    const { repoRoot, wtRoot, mgr } = makeRepo();
    const createTask = vi.fn(async () => "adhoc-generated-id");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const res = await coord.prepare({ projectId: "proj1", repoRoot });

    expect(createTask).toHaveBeenCalledWith({
      projectId: "proj1",
      title: "ad-hoc",
    });
    expect(res.taskId).toBe("adhoc-generated-id");
    expect(res.worktreeCreated).toBe(true);
    expect(res.cwd).toBe(path.join(wtRoot, "proj1", "adhoc-generated-id"));
  });

  it("threads the spawn prompt into the ad-hoc createTask call as description", async () => {
    const { repoRoot, mgr } = makeRepo();
    const createTask = vi.fn(async () => "adhoc-desc-id");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    await coord.prepare({
      projectId: "proj1",
      title: "wt-runtime-test2",
      description: "Fix the login bug in auth.ts",
      repoRoot,
    });

    // Ad-hoc ticket carries the spawn prompt so its board card isn't empty.
    expect(createTask).toHaveBeenCalledWith({
      projectId: "proj1",
      title: "wt-runtime-test2",
      description: "Fix the login bug in auth.ts",
    });
  });

  it("reuses the existing worktree on a second prepare with the same taskId (no duplicate create)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const createTask = vi.fn(async () => "unused");
    const createSpy = vi.spyOn(mgr, "create");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const first = await coord.prepare({
      projectId: "proj1",
      taskId: "reusetask001",
      title: "Work",
      repoRoot,
    });
    const second = await coord.prepare({
      projectId: "proj1",
      taskId: "reusetask001",
      title: "Work",
      repoRoot,
    });

    expect(second.cwd).toBe(first.cwd);
    expect(second.taskId).toBe("reusetask001");
    expect(second.worktreeCreated).toBe(false);
    // create() ran for the first prepare only.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("reports the exact base drift when an existing worktree is reused, without blocking it", async () => {
    const { repoRoot, mgr } = makeRepo();
    const coord = new WorktreeCoordinator({
      worktreeManager: mgr,
      createTask: async () => "unused",
    });
    const first = await coord.prepare({
      projectId: "proj1",
      taskId: "behindtask01",
      repoRoot,
    });

    fs.writeFileSync(path.join(repoRoot, "BASE-ADVANCE.md"), "new base\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);

    const reused = await coord.prepare({
      projectId: "proj1",
      taskId: "behindtask01",
      repoRoot,
    });

    expect(reused.worktreeCreated).toBe(false);
    expect(reused.cwd).toBe(first.cwd);
    expect(reused.baseStatus).toEqual({ baseRef: "main", behind: 1 });
  });

  it("L3: concurrent prepare() for the SAME taskId creates exactly one worktree", async () => {
    // Two dispatches racing for the same task. Without the per-(projectId,
    // taskId) serialization lock, both would observe "no worktree yet" across
    // the await in list() and both call create() → duplicate worktree TOCTOU.
    const { repoRoot, wtRoot, mgr } = makeRepo();
    const createTask = vi.fn(async () => "unused");
    const createSpy = vi.spyOn(mgr, "create");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const input = {
      projectId: "projRace",
      taskId: "racetask0001",
      title: "Race",
      repoRoot,
    };
    const [a, b] = await Promise.all([
      coord.prepare(input),
      coord.prepare(input),
    ]);

    // Exactly one create() despite the concurrent calls.
    expect(createSpy).toHaveBeenCalledTimes(1);
    // Both resolve to the same worktree path, and exactly one reports it created.
    const expectedCwd = path.join(wtRoot, "projRace", "racetask0001");
    expect(a.cwd).toBe(expectedCwd);
    expect(b.cwd).toBe(expectedCwd);
    expect([a.worktreeCreated, b.worktreeCreated].filter(Boolean)).toHaveLength(
      1,
    );
  });

  it("L3: distinct taskIds run independently (lock is per-task, not global)", async () => {
    const { repoRoot, wtRoot, mgr } = makeRepo();
    const createTask = vi.fn(async () => "unused");
    const createSpy = vi.spyOn(mgr, "create");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const [a, b] = await Promise.all([
      coord.prepare({ projectId: "p", taskId: "taskAAAA0001", repoRoot }),
      coord.prepare({ projectId: "p", taskId: "taskBBBB0002", repoRoot }),
    ]);

    // Different tasks → two distinct worktrees, both created.
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(a.cwd).toBe(path.join(wtRoot, "p", "taskAAAA0001"));
    expect(b.cwd).toBe(path.join(wtRoot, "p", "taskBBBB0002"));
    expect(a.worktreeCreated).toBe(true);
    expect(b.worktreeCreated).toBe(true);
  });

  it("falls back to a plain cwd without creating when repoRoot is not a git repo", async () => {
    const nonGit = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "marblo-nogit-")),
    );
    const mgr = new WorktreeManager({ worktreesRoot: path.join(nonGit, "wt") });
    const createTask = vi.fn(async () => "unused");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const res = await coord.prepare({
      projectId: "proj1",
      taskId: "task1234abcd",
      repoRoot: nonGit,
    });

    expect(res.worktreeCreated).toBe(false);
    expect(res.cwd).toBe(nonGit);
    expect(res.taskId).toBe("task1234abcd");
    // No worktree possible → no ad-hoc task and no git create attempt.
    expect(createTask).not.toHaveBeenCalled();

    // requestedCwd wins over repoRoot, and a missing taskId stays null in fallback.
    const res2 = await coord.prepare({
      projectId: "proj1",
      repoRoot: nonGit,
      requestedCwd: path.join(nonGit, "custom"),
    });
    expect(res2.cwd).toBe(path.join(nonGit, "custom"));
    expect(res2.taskId).toBeNull();
  });
});

describe("WorktreeCoordinator.reapForTask — merge_and_close hygiene (pn2m5cVx)", () => {
  const coordFor = (mgr: WorktreeManager) =>
    new WorktreeCoordinator({
      worktreeManager: mgr,
      createTask: vi.fn(async () => "SHOULD_NOT_BE_CALLED"),
    });

  it("PRESERVES a worktree with uncommitted changes instead of removing it", async () => {
    // The work-loss guard that matters most: reaping a dirty tree to tidy a
    // listing destroys untracked files (docs written but not yet committed).
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "task1234abcd",
      slug: "dirty",
    });
    fs.writeFileSync(path.join(info.path, "NOTES.md"), "uncommitted work\n");

    const res = await coordFor(mgr).reapForTask({
      projectId: "proj1",
      taskId: "task1234abcd",
      repoRoot,
    });

    expect(res.removed).toBe(false);
    expect(res.reason).toMatch(/uncommitted/i);
    // The tree — and the uncommitted file — are still there.
    expect(fs.existsSync(path.join(info.path, "NOTES.md"))).toBe(true);
    expect((await mgr.list(repoRoot)).some((w) => w.path === info.path)).toBe(
      true,
    );
  });

  it("prunes a stale registration whose directory is already gone", async () => {
    // Before the prune step, this entry was unreachable: every git probe against
    // the missing dir errors, hasUncommittedChanges conservatively reports
    // "dirty", and the reap preserved a worktree that no longer existed — so it
    // stayed registered forever and kept reading as "still needs cleanup".
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "task5678efgh",
      slug: "stale",
    });
    fs.rmSync(info.path, { recursive: true, force: true });
    expect((await mgr.list(repoRoot)).some((w) => w.path === info.path)).toBe(
      true,
    );

    const res = await coordFor(mgr).reapForTask({
      projectId: "proj1",
      taskId: "task5678efgh",
      repoRoot,
    });

    // Pruned before the lookup, so there is no worktree left to act on.
    expect(res.removed).toBe(false);
    expect(res.reason).toBe("no worktree for task");
    expect((await mgr.list(repoRoot)).some((w) => w.path === info.path)).toBe(
      false,
    );
  });

  it("removes a clean worktree whose branch is merged into base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "task9012ijkl",
      slug: "clean",
    });

    const res = await coordFor(mgr).reapForTask({
      projectId: "proj1",
      taskId: "task9012ijkl",
      repoRoot,
    });

    expect(res.removed).toBe(true);
    expect(fs.existsSync(info.path)).toBe(false);
  });

  it("is a no-op for a task that never had a worktree", async () => {
    const { repoRoot, mgr } = makeRepo();
    const res = await coordFor(mgr).reapForTask({
      projectId: "proj1",
      taskId: "neverExisted00",
      repoRoot,
    });
    expect(res.removed).toBe(false);
    expect(res.reason).toBe("no worktree for task");
  });
});

describe("WorktreeManager.gitSupportsMergeTree", () => {
  it("reports ok:true and a version string for the current (modern) git", async () => {
    const mgr = new WorktreeManager();
    const res = await mgr.gitSupportsMergeTree();
    expect(res.version).toMatch(/^\d+\.\d+/);
    expect(typeof res.ok).toBe("boolean");
    // dev/CI git is >= 2.38.
    expect(res.ok).toBe(true);
  });
});
