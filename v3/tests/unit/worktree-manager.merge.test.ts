import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";
// Reuse the temp-git fixture helpers from the sibling suite (same patterns).
import { git, makeRepo } from "./worktree-manager.test";

/** True when a rebase is mid-flight in the given worktree (sequencer dir present). */
function rebaseInProgress(worktreePath: string): boolean {
  const gitDir = git(["rev-parse", "--git-path", "."], worktreePath);
  const root = path.isAbsolute(gitDir)
    ? path.dirname(gitDir)
    : path.join(worktreePath, path.dirname(gitDir));
  return (
    fs.existsSync(path.join(root, "rebase-merge")) ||
    fs.existsSync(path.join(root, "rebase-apply"))
  );
}

describe("WorktreeManager.rebaseOntoBase", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("rebases cleanly onto an advanced base and replays worktree commits", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "rebaseclean1",
      slug: "rebase",
    });
    // Worktree commit (non-overlapping file)
    fs.writeFileSync(path.join(info.path, "FEATURE.md"), "feature\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt feature"], info.path);
    // Base advances on a different file → clean rebase
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "other\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);

    const res = await mgr.rebaseOntoBase(info.path, "main");

    expect(res.ok).toBe(true);
    // After rebase the worktree HEAD sits on top of main → contains OTHER.md
    expect(fs.existsSync(path.join(info.path, "OTHER.md"))).toBe(true);
    expect(fs.existsSync(path.join(info.path, "FEATURE.md"))).toBe(true);
    // Worktree is behind 0 once rebased onto main
    const st = await mgr.status(info.path, "main");
    expect(st.behind).toBe(0);
    expect(st.ahead).toBe(1);
    expect(rebaseInProgress(info.path)).toBe(false);
  });

  it("aborts on conflict, returning conflicts and preserving the working tree", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "rebaseconf01",
      slug: "rebase",
    });
    // Worktree edits README
    fs.writeFileSync(path.join(info.path, "README.md"), "worktree edit\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt edit"], info.path);
    // Base edits the SAME line differently → conflict
    fs.writeFileSync(path.join(repoRoot, "README.md"), "main edit\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main edit"], repoRoot);

    const res = await mgr.rebaseOntoBase(info.path, "main");

    expect(res.ok).toBe(false);
    expect(res.conflicts).toContain("README.md");
    // Abort cleaned up the in-progress rebase → working tree restored
    expect(rebaseInProgress(info.path)).toBe(false);
    expect(fs.readFileSync(path.join(info.path, "README.md"), "utf8")).toBe(
      "worktree edit\n",
    );
    // Branch still checked out, commit intact
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], info.path)).toBe(
      info.branch,
    );
  });
});

describe("WorktreeManager.squashMergeToBase", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("clean path: rebase → squash onto base → reflect change + cleanup worktree/branch", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "squashclean1",
      slug: "squash",
    });
    fs.writeFileSync(path.join(info.path, "NEWFILE.md"), "fresh\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "add new file"], info.path);
    // Base advances non-conflicting so the rebase step actually replays.
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "other\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "main",
      info.branch,
    );

    expect(res.ok).toBe(true);
    // The worktree's change landed on main (working tree + history).
    expect(fs.existsSync(path.join(repoRoot, "NEWFILE.md"))).toBe(true);
    const log = git(["log", "--oneline", "main"], repoRoot);
    expect(log).toMatch(/NEWFILE|squash|squash/i);
    expect(fs.readFileSync(path.join(repoRoot, "NEWFILE.md"), "utf8")).toBe(
      "fresh\n",
    );
    // Cleanup: worktree dir gone, branch deleted, only main worktree remains.
    expect(fs.existsSync(info.path)).toBe(false);
    expect(git(["branch", "--list", info.branch], repoRoot)).toBe("");
    expect((await mgr.list(repoRoot)).map((w) => w.path)).toEqual([repoRoot]);
  });

  it("conflict path: stops at rebase with needsResolve and preserves both trees", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "squashconf01",
      slug: "squash",
    });
    fs.writeFileSync(path.join(info.path, "README.md"), "worktree edit\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt edit"], info.path);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "main edit\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main edit"], repoRoot);

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "main",
      info.branch,
    );

    expect(res.ok).toBe(false);
    expect(res.needsResolve).toBe(true);
    expect(res.conflicts).toContain("README.md");
    // Worktree intact (not removed), its content preserved.
    expect(fs.existsSync(info.path)).toBe(true);
    expect(fs.readFileSync(path.join(info.path, "README.md"), "utf8")).toBe(
      "worktree edit\n",
    );
    // Base (main) untouched — no squash commit, still its own edit.
    expect(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")).toBe(
      "main edit\n",
    );
    expect(git(["branch", "--list", info.branch], repoRoot)).not.toBe("");
  });
});
