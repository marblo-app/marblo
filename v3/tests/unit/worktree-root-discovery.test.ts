import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  discoverWorktreeRoots,
  repoRootFromGitdirPointer,
} from "../../electron/worktree-root-discovery";

let tmp: string;

/** Create `<pool>/<projectId>/<name>` with a worktree `.git` pointer at `owner`. */
function makeWorktree(
  pool: string,
  projectId: string,
  name: string,
  owner: string
): void {
  const dir = path.join(pool, projectId, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".git"),
    `gitdir: ${path.join(owner, ".git", "worktrees", name)}\n`,
    "utf-8"
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-root-discovery-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("repoRootFromGitdirPointer", () => {
  it("recovers the owning clone from an absolute pointer", () => {
    expect(
      repoRootFromGitdirPointer(
        "gitdir: /Users/x/Documents/programming/marblo/.git/worktrees/abc\n",
        "/pool/proj/abc"
      )
    ).toBe("/Users/x/Documents/programming/marblo");
  });

  it("anchors a relative pointer at the worktree directory", () => {
    expect(
      repoRootFromGitdirPointer(
        "gitdir: ../../clone/.git/worktrees/abc",
        "/pool/proj/abc"
      )
    ).toBe("/pool/clone");
  });

  it("returns null for a pointer that names no worktree", () => {
    expect(
      repoRootFromGitdirPointer("gitdir: /some/repo/.git", "/d")
    ).toBeNull();
    expect(repoRootFromGitdirPointer("", "/d")).toBeNull();
    expect(repoRootFromGitdirPointer("gitdir:   ", "/d")).toBeNull();
  });
});

describe("discoverWorktreeRoots", () => {
  it("recovers EVERY owning clone, not just one (ticket NHCsWfnp)", () => {
    // The measured production shape: one projectId's pool split across two
    // clones of the same repo. Before this module the app knew only `bound`,
    // so the 74 worktrees owned by `other` were never enumerated at all.
    const bound = path.join(tmp, "Marblo", "marblo");
    const other = path.join(tmp, "Documents", "programming", "marblo");
    fs.mkdirSync(bound, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    const pool = path.join(tmp, "pool");

    for (let i = 0; i < 74; i++) makeWorktree(pool, "P1", `other-${i}`, other);
    for (let i = 0; i < 7; i++) makeWorktree(pool, "P1", `bound-${i}`, bound);

    const found = discoverWorktreeRoots(pool, "P1");

    expect(found.onDiskCount).toBe(81);
    expect(found.owned).toHaveLength(81);
    expect(found.unresolved).toEqual([]);
    // Sorted most-worktrees-first, so the majority owner leads.
    expect(found.roots.map((r) => r.repoRoot)).toEqual([other, bound]);
    expect(found.roots.map((r) => r.worktreeCount)).toEqual([74, 7]);
    expect(found.roots.every((r) => r.exists)).toBe(true);
  });

  it("flags a dangling pointer's clone as missing instead of dropping it", () => {
    const gone = path.join(tmp, "deleted-clone");
    const pool = path.join(tmp, "pool");
    makeWorktree(pool, "P1", "a", gone);

    const found = discoverWorktreeRoots(pool, "P1");

    expect(found.roots).toHaveLength(1);
    expect(found.roots[0].repoRoot).toBe(gone);
    expect(found.roots[0].exists).toBe(false);
  });

  it("reports directories with no recoverable owner as unresolved", () => {
    const pool = path.join(tmp, "pool");
    const owner = path.join(tmp, "clone");
    fs.mkdirSync(owner, { recursive: true });
    makeWorktree(pool, "P1", "good", owner);
    // A stray directory with no .git at all.
    fs.mkdirSync(path.join(pool, "P1", "stray"), { recursive: true });
    // A nested standalone clone: .git is a real directory, not a pointer file.
    fs.mkdirSync(path.join(pool, "P1", "nested", ".git"), { recursive: true });

    const found = discoverWorktreeRoots(pool, "P1");

    expect(found.onDiskCount).toBe(3);
    // Only the real worktree is "owned"; the stray and the nested clone are not
    // worktrees and must never be counted as missing ones.
    expect(found.owned.map((o) => path.basename(o.dir))).toEqual(["good"]);
    expect(found.roots).toHaveLength(1);
    expect(found.unresolved.map((p) => path.basename(p)).sort()).toEqual([
      "nested",
      "stray",
    ]);
  });

  it("never throws when the pool is absent or the projectId is empty", () => {
    expect(discoverWorktreeRoots(path.join(tmp, "nope"), "P1")).toEqual({
      projectId: "P1",
      onDiskCount: 0,
      owned: [],
      roots: [],
      unresolved: [],
    });
    expect(discoverWorktreeRoots(tmp, "").onDiskCount).toBe(0);
  });
});
