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
 * Mirrors the makeRepo() helpers in the sibling worktree tests — fs.realpathSync
 * normalizes /var → /private/var on macOS so path equality holds.
 */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-reap-")),
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

/** Add a bare `origin` to an existing repo and push `main` to it. */
function addBareRemote(repoRoot: string): string {
  const remote = path.join(path.dirname(repoRoot), "origin.git");
  git(["init", "--bare", "-b", "main", remote], path.dirname(repoRoot));
  git(["remote", "add", "origin", remote], repoRoot);
  git(["push", "origin", "main"], repoRoot);
  return remote;
}

/** Commit a new file inside a worktree, returning nothing. */
function commitInWorktree(wtPath: string, file: string, body: string): void {
  fs.writeFileSync(path.join(wtPath, file), body);
  git(["add", "."], wtPath);
  git(["commit", "-m", `add ${file}`], wtPath);
}

describe("WorktreeManager.reapSafety", () => {
  it("marks a fresh (merged, clean) worktree as safe", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "freshsafe001",
      slug: "fresh",
    });
    const s = await mgr.reapSafety(info.path, "main");
    expect(s.merged).toBe(true);
    expect(s.dirty).toBe(false);
    expect(s.safe).toBe(true);
    expect(s.blockers).toEqual([]);
  });

  it("blocks on uncommitted changes (work-loss guard)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "dirtytask001",
      slug: "dirty",
    });
    fs.writeFileSync(path.join(info.path, "scratch.txt"), "wip\n");
    const s = await mgr.reapSafety(info.path, "main");
    expect(s.dirty).toBe(true);
    expect(s.safe).toBe(false);
    expect(s.blockers.join()).toContain("uncommitted changes");
  });

  it("blocks on unmerged, unpushed (local-only) commits", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "localonly001",
      slug: "local",
    });
    commitInWorktree(info.path, "wip.ts", "export const x = 1;\n");
    const s = await mgr.reapSafety(info.path, "main");
    expect(s.merged).toBe(false);
    expect(s.unpushedCommits).toBe(1);
    expect(s.safe).toBe(false);
    expect(s.blockers.join()).toContain("unmerged, unpushed");
  });

  it("is safe when unmerged commits are all pushed to origin", async () => {
    const { repoRoot, mgr } = makeRepo();
    addBareRemote(repoRoot);
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "pushedtask001",
      slug: "pushed",
    });
    commitInWorktree(info.path, "feat.ts", "export const y = 2;\n");
    git(["push", "-u", "origin", info.branch], info.path);
    const s = await mgr.reapSafety(info.path, "main");
    expect(s.merged).toBe(false);
    expect(s.unpushedCommits).toBe(0);
    expect(s.safe).toBe(true);
  });
});

describe("WorktreeManager.reap", () => {
  it("removes a merged worktree and deletes its branch", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "mergedreap01",
      slug: "merged",
    });
    const res = await mgr.reap(repoRoot, info.path, { baseRef: "main" });
    expect(res.removed).toBe(true);
    expect(res.reason).toContain("merged");
    expect(fs.existsSync(info.path)).toBe(false);
    // Branch is deleted for a merged worktree.
    const branches = git(["branch", "--list", info.branch], repoRoot);
    expect(branches).toBe("");
  });

  it("preserves a dirty worktree instead of removing it", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "dirtyreap01",
      slug: "dirty",
    });
    fs.writeFileSync(path.join(info.path, "scratch.txt"), "unsaved\n");
    const res = await mgr.reap(repoRoot, info.path, { baseRef: "main" });
    expect(res.removed).toBe(false);
    expect(res.reason).toContain("preserved");
    // The worktree (and its uncommitted file) survives.
    expect(fs.existsSync(path.join(info.path, "scratch.txt"))).toBe(true);
  });

  it("preserves a worktree with local-only commits", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "localreap01",
      slug: "local",
    });
    commitInWorktree(info.path, "wip.ts", "export const z = 3;\n");
    const res = await mgr.reap(repoRoot, info.path, { baseRef: "main" });
    expect(res.removed).toBe(false);
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it("removes a clean, fully-pushed (unmerged) worktree, keeping its branch", async () => {
    const { repoRoot, mgr } = makeRepo();
    addBareRemote(repoRoot);
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "pushedreap01",
      slug: "pushed",
    });
    commitInWorktree(info.path, "feat.ts", "export const w = 4;\n");
    git(["push", "-u", "origin", info.branch], info.path);
    const res = await mgr.reap(repoRoot, info.path, { baseRef: "main" });
    expect(res.removed).toBe(true);
    expect(fs.existsSync(info.path)).toBe(false);
    // Unmerged branch ref is kept so the PR's commits stay reachable.
    const branches = git(["branch", "--list", info.branch], repoRoot);
    expect(branches).not.toBe("");
  });

  it("with requireMerged, refuses an unmerged-but-pushed worktree", async () => {
    const { repoRoot, mgr } = makeRepo();
    addBareRemote(repoRoot);
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "reqmerge001",
      slug: "reqmerge",
    });
    commitInWorktree(info.path, "feat.ts", "export const v = 5;\n");
    git(["push", "-u", "origin", info.branch], info.path);
    const res = await mgr.reap(repoRoot, info.path, {
      baseRef: "main",
      requireMerged: true,
    });
    expect(res.removed).toBe(false);
    expect(res.reason).toContain("not merged");
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it("refuses to reap the main worktree", async () => {
    const { repoRoot, mgr } = makeRepo();
    const res = await mgr.reap(repoRoot, repoRoot, { baseRef: "main" });
    expect(res.removed).toBe(false);
    expect(res.reason).toContain("main worktree");
    expect(fs.existsSync(repoRoot)).toBe(true);
  });
});

describe("WorktreeManager.reapAll", () => {
  it("removes safe worktrees, preserves dirty ones, and prunes", async () => {
    const { repoRoot, mgr } = makeRepo();
    const safe1 = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "bulksafe001",
      slug: "safe1",
    });
    const safe2 = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "bulksafe002",
      slug: "safe2",
    });
    const dirty = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "bulkdirty001",
      slug: "dirty",
    });
    fs.writeFileSync(path.join(dirty.path, "scratch.txt"), "unsaved\n");

    const res = await mgr.reapAll(repoRoot);

    expect(res.removed.sort()).toEqual([safe1.path, safe2.path].sort());
    expect(res.preserved.map((p) => p.path)).toEqual([dirty.path]);
    expect(res.failed).toEqual([]);
    expect(fs.existsSync(safe1.path)).toBe(false);
    expect(fs.existsSync(safe2.path)).toBe(false);
    expect(fs.existsSync(dirty.path)).toBe(true);
  });

  it("recovers from a manually-deleted worktree dir via prune", async () => {
    const { repoRoot, mgr } = makeRepo();
    const orphan = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "orphan00001",
      slug: "orphan",
    });
    // Simulate the real-world pileup: the dir is gone but git's admin entry
    // lingers. prune (run inside reapAll) must drop it without erroring.
    fs.rmSync(orphan.path, { recursive: true, force: true });

    const res = await mgr.reapAll(repoRoot);
    expect(res.failed).toEqual([]);
    // The pruned worktree is no longer listed.
    const list = await mgr.list(repoRoot);
    expect(list.some((w) => w.path === orphan.path)).toBe(false);
  });
});

describe("WorktreeCoordinator.reapForTask", () => {
  const makeCoord = (mgr: WorktreeManager) =>
    new WorktreeCoordinator({
      worktreeManager: mgr,
      createTask: vi.fn(async () => "SHOULD_NOT_BE_CALLED"),
    });

  it("reaps the worktree matching <projectId>/<taskId>", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "coordtask001",
      slug: "coord",
    });
    const coord = makeCoord(mgr);
    const res = await coord.reapForTask({
      projectId: "proj1",
      taskId: "coordtask001",
      repoRoot,
    });
    expect(res.removed).toBe(true);
    expect(res.path).toBe(info.path);
    expect(fs.existsSync(info.path)).toBe(false);
  });

  it("preserves a dirty worktree and reports it as not removed", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "coorddirty01",
      slug: "coorddirty",
    });
    fs.writeFileSync(path.join(info.path, "wip.txt"), "unsaved\n");
    const coord = makeCoord(mgr);
    const res = await coord.reapForTask({
      projectId: "proj1",
      taskId: "coorddirty01",
      repoRoot,
    });
    expect(res.removed).toBe(false);
    expect(res.reason).toContain("preserved");
    expect(fs.existsSync(info.path)).toBe(true);
  });

  it("returns removed:false when no worktree exists for the task", async () => {
    const { repoRoot, mgr } = makeRepo();
    const coord = makeCoord(mgr);
    const res = await coord.reapForTask({
      projectId: "proj1",
      taskId: "nonexistent1",
      repoRoot,
    });
    expect(res.removed).toBe(false);
    expect(res.reason).toContain("no worktree");
  });

  it("never throws on a non-git repoRoot", async () => {
    const { mgr } = makeRepo();
    const coord = makeCoord(mgr);
    const res = await coord.reapForTask({
      projectId: "proj1",
      taskId: "whatever0001",
      repoRoot: "/tmp/definitely-not-a-git-repo-marblo-reap",
    });
    expect(res.removed).toBe(false);
  });
});
