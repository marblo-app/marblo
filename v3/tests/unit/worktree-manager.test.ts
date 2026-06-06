import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  WorktreeManager,
  provisionNodeModules,
} from "../../electron/worktree-manager";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/** Fresh, isolated git repo on branch `main` with one commit. No remote (offline). */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wt-"));
  // Normalize to real path to avoid /var → /private/var symlink issues on macOS
  const realBase = fs.realpathSync(base);
  const repoRoot = path.join(realBase, "repo");
  const wtRoot = path.join(realBase, "worktrees");
  fs.mkdirSync(repoRoot, { recursive: true });
  const realRepoRoot = repoRoot; // already normalized via realBase
  git(["init", "-b", "main"], realRepoRoot);
  git(["config", "user.email", "t@t.com"], realRepoRoot);
  git(["config", "user.name", "t"], realRepoRoot);
  fs.writeFileSync(path.join(realRepoRoot, "README.md"), "base\n");
  git(["add", "."], realRepoRoot);
  git(["commit", "-m", "init"], realRepoRoot);
  return {
    repoRoot: realRepoRoot,
    wtRoot,
    mgr: new WorktreeManager({ worktreesRoot: wtRoot }),
  };
}

describe("WorktreeManager.resolveBaseRef", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("falls back to the local current branch when no origin remote exists", async () => {
    const base = await mgr.resolveBaseRef(repoRoot);
    expect(base).toBe("main");
  });
});

// Export so later tasks can reuse these helpers (same file).
export { git, makeRepo };

describe("WorktreeManager.create", () => {
  let repoRoot: string;
  let wtRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, wtRoot, mgr } = makeRepo());
  });

  it("creates a worktree dir on a marblo/<slug>-<id8> branch under worktreesRoot", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "abcdef1234567890",
      slug: "Login Bug Fix",
    });
    expect(info.branch).toBe("marblo/login-bug-fix-abcdef12");
    expect(info.path).toBe(path.join(wtRoot, "proj1", "abcdef1234567890"));
    expect(fs.existsSync(path.join(info.path, "README.md"))).toBe(true);
    expect(info.head).toMatch(/^[0-9a-f]{40}$/);
    // The new branch is checked out in the worktree
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], info.path)).toBe(
      info.branch
    );
  });

  it("throws on a taskId with unsafe characters", async () => {
    await expect(
      mgr.create({
        repoRoot,
        projectId: "p",
        taskId: "../escape",
        slug: "x",
      })
    ).rejects.toThrow(/invalid taskId/);
  });

  it("throws when the branch already exists", async () => {
    const params = {
      repoRoot,
      projectId: "proj1",
      taskId: "dupdupdup000000",
      slug: "dup",
    };
    await mgr.create(params);
    await expect(mgr.create(params)).rejects.toThrow(/worktree add failed/i);
  });
});

describe("WorktreeManager — node_modules provisioning", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("symlinks the main repo node_modules into a new worktree (absolute, no copy)", async () => {
    // node_modules is .gitignore'd in real life; here it's simply untracked,
    // so the fresh worktree checkout won't contain it until we provision.
    fs.mkdirSync(path.join(repoRoot, "node_modules"));
    fs.writeFileSync(
      path.join(repoRoot, "node_modules", ".marker"),
      "from-main\n"
    );

    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "nodemods0001",
      slug: "deps",
    });

    const link = path.join(info.path, "node_modules");
    // It's a symlink (not a copy)…
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    // …with an absolute target resolving to the main repo's node_modules…
    const target = fs.readlinkSync(link);
    expect(path.isAbsolute(target)).toBe(true);
    expect(fs.realpathSync(link)).toBe(
      fs.realpathSync(path.join(repoRoot, "node_modules"))
    );
    // …and content is readable through the link.
    expect(fs.readFileSync(path.join(link, ".marker"), "utf8")).toBe(
      "from-main\n"
    );
  });

  it("is idempotent — a second provision is a no-op and never throws", () => {
    fs.mkdirSync(path.join(repoRoot, "node_modules"));
    // Stand-in worktree dir (real create() would produce this).
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wt-dest-"));

    provisionNodeModules(repoRoot, wt);
    const link = path.join(wt, "node_modules");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    const firstTarget = fs.readlinkSync(link);

    // Second call must not throw and must leave the existing link untouched.
    expect(() => provisionNodeModules(repoRoot, wt)).not.toThrow();
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(firstTarget);
  });

  it("skips silently when the source has no node_modules — create still succeeds", async () => {
    // makeRepo() builds a repo with no node_modules anywhere.
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "nonodemods01",
      slug: "bare",
    });

    // Worktree was created successfully…
    expect(info.branch).toBe("marblo/bare-nonodemo");
    expect(fs.existsSync(path.join(info.path, "README.md"))).toBe(true);
    // …but no node_modules link was provisioned (nothing to link).
    expect(fs.existsSync(path.join(info.path, "node_modules"))).toBe(false);
  });

  it("does not dirty the worktree — the symlink stays git-ignored", async () => {
    // The ignore pattern MUST omit the trailing slash: "node_modules/" matches
    // directories only, but git treats the provisioned symlink as a file, so it
    // would show as untracked and force status().dirty=true on every worktree.
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "ignore node_modules"], repoRoot);
    fs.mkdirSync(path.join(repoRoot, "node_modules"));

    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "cleanstatus1",
      slug: "clean status",
    });

    // The symlink was provisioned…
    expect(
      fs.lstatSync(path.join(info.path, "node_modules")).isSymbolicLink()
    ).toBe(true);
    // …yet the worktree reports clean (ignored, so not counted as dirty).
    const s = await mgr.status(info.path, "main");
    expect(s.dirty).toBe(false);
  });
});

describe("WorktreeManager.list", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("lists the main worktree plus any created worktrees with branch names", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "task1234abcd",
      slug: "feature",
    });
    const all = await mgr.list(repoRoot);
    const paths = all.map((w) => w.path);
    expect(paths).toContain(info.path);
    const created = all.find((w) => w.path === info.path)!;
    expect(created.branch).toBe("marblo/feature-task1234");
    expect(created.head).toMatch(/^[0-9a-f]{40}$/);
    // The main repo worktree is present too
    expect(paths).toContain(repoRoot);
  });
});

describe("WorktreeManager.status — counts & diff", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("reports ahead/behind, dirty flag, and diff stats", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "statustask01",
      slug: "work",
    });

    // One committed change in the worktree => ahead 1, behind 0
    fs.writeFileSync(path.join(info.path, "README.md"), "base\nline2\nline3\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt change"], info.path);

    const s1 = await mgr.status(info.path, "main");
    // taskId 'statustask01' → slice(0,8) = 'statusta' per the 8-char spec rule
    expect(s1.branch).toBe("marblo/work-statusta");
    expect(s1.baseRef).toBe("main");
    expect(s1.ahead).toBe(1);
    expect(s1.behind).toBe(0);
    expect(s1.dirty).toBe(false);
    expect(s1.filesChanged).toBe(1);
    expect(s1.insertions).toBe(2);
    expect(s1.deletions).toBe(0);

    // Advance base (main) by one commit => behind becomes 1
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "x\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);

    // Uncommitted edit in the worktree => dirty true
    fs.writeFileSync(path.join(info.path, "scratch.txt"), "wip\n");

    const s2 = await mgr.status(info.path, "main");
    expect(s2.ahead).toBe(1);
    expect(s2.behind).toBe(1);
    expect(s2.dirty).toBe(true);
  });
});

describe("WorktreeManager.status — mergeability", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("reports mergeable=true with no conflicts for a non-overlapping change", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "cleanmerge01",
      slug: "clean",
    });
    fs.writeFileSync(path.join(info.path, "NEWFILE.md"), "fresh\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "add new file"], info.path);

    const s = await mgr.status(info.path, "main");
    expect(s.mergeable).toBe(true);
    expect(s.conflicts).toEqual([]);
  });

  it("reports mergeable=false and lists the conflicted file on overlapping edits", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "conflict0001",
      slug: "conflict",
    });
    // Worktree edits README line
    fs.writeFileSync(path.join(info.path, "README.md"), "worktree edit\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt edit"], info.path);
    // Base (main) edits the SAME line differently
    fs.writeFileSync(path.join(repoRoot, "README.md"), "main edit\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main edit"], repoRoot);

    const s = await mgr.status(info.path, "main");
    expect(s.mergeable).toBe(false);
    expect(s.conflicts).toEqual(["README.md"]);
  });
});

describe("WorktreeManager.remove & prune", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("removes the worktree dir and drops it from list", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "removeme0001",
      slug: "gone",
    });
    expect(fs.existsSync(info.path)).toBe(true);

    await mgr.remove(repoRoot, info.path);
    expect(fs.existsSync(info.path)).toBe(false);
    const paths = (await mgr.list(repoRoot)).map((w) => w.path);
    expect(paths).not.toContain(info.path);
  });

  it("deletes the branch too when deleteBranch is set", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "delbranch001",
      slug: "byebye",
    });
    await mgr.remove(repoRoot, info.path, { deleteBranch: true });
    const branches = git(["branch", "--list", info.branch], repoRoot);
    expect(branches).toBe("");
  });

  it("prune runs without throwing", async () => {
    await expect(mgr.prune(repoRoot)).resolves.toBeUndefined();
  });
});

describe("WorktreeManager — full lifecycle", () => {
  it("create → commit → status → remove(deleteBranch) leaves a clean repo", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj",
      taskId: "lifecycle001",
      slug: "End To End",
    });
    fs.writeFileSync(
      path.join(info.path, "feature.ts"),
      "export const x = 1;\n"
    );
    git(["add", "."], info.path);
    git(["commit", "-m", "feature"], info.path);

    const s = await mgr.status(info.path, "main");
    expect(s.ahead).toBe(1);
    expect(s.mergeable).toBe(true);
    expect(s.filesChanged).toBe(1);

    await mgr.remove(repoRoot, info.path, { deleteBranch: true });
    await mgr.prune(repoRoot);

    expect(fs.existsSync(info.path)).toBe(false);
    expect(git(["branch", "--list", info.branch], repoRoot)).toBe("");
    // Only the main worktree remains
    expect((await mgr.list(repoRoot)).map((w) => w.path)).toEqual([repoRoot]);
  });
});
