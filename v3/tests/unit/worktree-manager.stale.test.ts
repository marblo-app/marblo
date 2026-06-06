import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/**
 * Fresh, isolated git repo on branch `main` with one commit (no remote).
 * Mirrors the makeRepo() helper in worktree-manager.test.ts — fs.realpathSync
 * normalizes /var → /private/var on macOS so path equality holds.
 */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wts-")),
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe("WorktreeManager.isMergedIntoBase", () => {
  it("returns true for a fresh worktree with no commits beyond base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "freshtask001",
      slug: "fresh",
    });
    expect(await mgr.isMergedIntoBase(info.path, "main")).toBe(true);
  });

  it("returns false once the branch has a commit not in base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "aheadtask001",
      slug: "ahead",
    });
    fs.writeFileSync(path.join(info.path, "wip.ts"), "export const x = 1;\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wip"], info.path);
    expect(await mgr.isMergedIntoBase(info.path, "main")).toBe(false);
  });

  it("returns true again after the branch is merged into base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "mergeback001",
      slug: "merge-back",
    });
    fs.writeFileSync(
      path.join(info.path, "feature.ts"),
      "export const x = 1;\n",
    );
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);
    // Merge the branch into base (main) — branch tip becomes reachable from base.
    git(["merge", "--no-ff", info.branch, "-m", "merge feat"], repoRoot);
    expect(await mgr.isMergedIntoBase(info.path, "main")).toBe(true);
  });
});

describe("WorktreeManager.lastActivityAt", () => {
  it("returns the last commit time as a Date", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "activitytsk1",
      slug: "act",
    });
    fs.writeFileSync(path.join(info.path, "a.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "commit"], info.path);

    const when = await mgr.lastActivityAt(info.path);
    expect(when).toBeInstanceOf(Date);
    expect(when!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});

describe("WorktreeManager.staleInfo", () => {
  it("flags a branch already merged into base as merged:true and stale:true", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "mergedtask01",
      slug: "merged",
    });
    fs.writeFileSync(
      path.join(info.path, "feature.ts"),
      "export const x = 1;\n",
    );
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);
    git(["merge", "--no-ff", info.branch, "-m", "merge feat"], repoRoot);

    const stale = await mgr.staleInfo(info.path, "main");
    expect(stale.merged).toBe(true);
    expect(stale.stale).toBe(true);
  });

  it("reports merged:false and not stale for a fresh unmerged commit", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "unmergedtsk1",
      slug: "unmerged",
    });
    fs.writeFileSync(path.join(info.path, "wip.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wip"], info.path);

    const stale = await mgr.staleInfo(info.path, "main");
    expect(stale.merged).toBe(false);
    expect(stale.stale).toBe(false);
  });

  it("flags a long-idle but unmerged worktree as stale via idleDays", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "idletask0001",
      slug: "idle",
    });
    fs.writeFileSync(path.join(info.path, "old.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "old work"], info.path);

    // 20 days after the commit, maxIdleDays=14 → stale by idleness alone.
    const future = new Date(Date.now() + 20 * DAY_MS);
    const stale = await mgr.staleInfo(info.path, "main", {
      maxIdleDays: 14,
      now: future,
    });
    expect(stale.merged).toBe(false);
    expect(stale.idleDays).toBeGreaterThanOrEqual(14);
    expect(stale.stale).toBe(true);
  });
});

describe("WorktreeManager.cleanupStale", () => {
  it("removes merged worktrees (with their branches) but keeps main and active ones", async () => {
    const { repoRoot, mgr } = makeRepo();

    // Stale: a worktree merged back into base.
    const merged = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "cleanmerged1",
      slug: "merged",
    });
    fs.writeFileSync(path.join(merged.path, "m.ts"), "x\n");
    git(["add", "."], merged.path);
    git(["commit", "-m", "m"], merged.path);
    git(["merge", "--no-ff", merged.branch, "-m", "merge m"], repoRoot);

    // Active: a worktree with a fresh, unmerged commit (not stale).
    const active = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "activework01",
      slug: "active",
    });
    fs.writeFileSync(path.join(active.path, "a.ts"), "x\n");
    git(["add", "."], active.path);
    git(["commit", "-m", "a"], active.path);

    const result = await mgr.cleanupStale(repoRoot);

    expect(result.removed).toContain(merged.path);
    expect(result.removed).not.toContain(active.path);
    expect(result.removed).not.toContain(repoRoot);
    expect(fs.existsSync(merged.path)).toBe(false);
    expect(fs.existsSync(active.path)).toBe(true);

    const paths = (await mgr.list(repoRoot)).map((w) => w.path);
    expect(paths).toContain(repoRoot); // main worktree untouched
    expect(paths).toContain(active.path);
    expect(paths).not.toContain(merged.path);
    // merged branch was deleted as part of cleanup
    expect(git(["branch", "--list", merged.branch], repoRoot)).toBe("");
  });
});
