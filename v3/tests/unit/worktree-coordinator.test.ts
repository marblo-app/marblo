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
