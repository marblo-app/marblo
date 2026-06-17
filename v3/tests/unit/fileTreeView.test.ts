import { describe, expect, it } from "vitest";
import { describeRootView, treeSignature } from "../../src/lib/fileTreeView";
import type { Worktree } from "../../src/types/worktree";

function wt(partial: Partial<Worktree>): Worktree {
  return {
    id: "wt1",
    taskId: null,
    projectId: "p1",
    agentId: null,
    branch: "feature/x",
    baseRef: "main",
    path: "/repo/.worktrees/x",
    repoRoot: "/repo",
    createdAt: null,
    ...partial,
  };
}

describe("describeRootView", () => {
  it("returns null for a null root", () => {
    expect(describeRootView(null, [], "/repo")).toBeNull();
  });

  it("identifies the project root", () => {
    const view = describeRootView("/repo", [], "/repo");
    expect(view).toEqual({
      label: "repo",
      fullPath: "/repo",
      kind: "project",
    });
  });

  it("identifies a worktree by exact path and surfaces branch + taskId", () => {
    const worktrees = [
      wt({ path: "/repo/.worktrees/abc", branch: "marblo/foo", taskId: "T42" }),
    ];
    const view = describeRootView("/repo/.worktrees/abc", worktrees, "/repo");
    expect(view).toEqual({
      label: "marblo/foo",
      fullPath: "/repo/.worktrees/abc",
      kind: "worktree",
      detail: "T42",
    });
  });

  it("falls back to the basename label when a worktree has no branch", () => {
    const worktrees = [wt({ path: "/repo/.worktrees/abc", branch: "" })];
    const view = describeRootView("/repo/.worktrees/abc", worktrees, "/repo");
    expect(view?.kind).toBe("worktree");
    expect(view?.label).toBe("abc");
    expect(view?.detail).toBeUndefined();
  });

  it("treats an unknown path that is not the project root as a folder", () => {
    const view = describeRootView("/some/other/dir", [], "/repo");
    expect(view).toEqual({
      label: "dir",
      fullPath: "/some/other/dir",
      kind: "folder",
    });
  });

  it("prefers worktree classification over project match", () => {
    // A worktree whose path also equals the project root would be a worktree.
    const worktrees = [wt({ path: "/repo", branch: "main", taskId: null })];
    const view = describeRootView("/repo", worktrees, "/repo");
    expect(view?.kind).toBe("worktree");
  });
});

describe("treeSignature", () => {
  it("is stable for identical inputs and differs when content changes", () => {
    const a = treeSignature([{ path: "/a" }], { "/a": "M" });
    const b = treeSignature([{ path: "/a" }], { "/a": "M" });
    const c = treeSignature([{ path: "/a" }], { "/a": "??" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
