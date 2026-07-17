import { describe, expect, it } from "vitest";
import {
  calculateWorktreeMenuPosition,
  describeRootView,
  filterWorktreesByProject,
  findMainWorktree,
  isActiveTaskWorktree,
  isStrayWorktreeContainerRoot,
  resolveLocalMainPath,
  resolveRootSwitch,
  treeSignature,
} from "../../src/lib/fileTreeView";
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

  it("ignores a trailing separator when matching a worktree path", () => {
    const worktrees = [
      wt({ path: "/repo/.worktrees/abc", branch: "marblo/foo", taskId: "T1" }),
    ];
    const view = describeRootView("/repo/.worktrees/abc/", worktrees, "/repo");
    expect(view?.kind).toBe("worktree");
    expect(view?.label).toBe("marblo/foo");
  });

  it(
    "labels the main checkout as a worktree when reached via a non-canonical " +
      "(symlinked/foreign) project-folder path — the multi-machine ROOT bug",
    () => {
      // git worktree list realpath'd the main entry (/private/...), but rootPath
      // and folderPath stay raw (the symlinked /Users/... the picker returned).
      const rawFolder = "/Users/me/dev/marblo";
      const canonicalMain = "/private/Users/me/dev/marblo";
      const worktrees = [
        wt({
          id: "main",
          path: canonicalMain,
          repoRoot: rawFolder,
          branch: "메인 WT",
          taskId: null,
        }),
      ];
      const view = describeRootView(rawFolder, worktrees, rawFolder);
      // Was degrading to kind "project" (the "ROOT" badge). Now surfaces the
      // main branch, matching the canonical-path machine.
      expect(view?.kind).toBe("worktree");
      expect(view?.label).toBe("메인 WT");
      expect(view?.detail).toBeUndefined();
    },
  );

  it("still reports kind project when no worktree list is available yet", () => {
    // Worktrees not loaded → no main entry to borrow a branch from.
    const view = describeRootView("/repo", [], "/repo");
    expect(view?.kind).toBe("project");
    expect(view?.label).toBe("repo");
  });
});

describe("findMainWorktree", () => {
  it("returns null when there is no taskId-less entry", () => {
    const task = wt({ path: "/repo/.worktrees/a", taskId: "T1" });
    expect(findMainWorktree([task], "/repo")).toBeNull();
  });

  it("finds the main checkout by taskId even when path !== repoRoot (symlink)", () => {
    const main = wt({
      id: "main",
      path: "/private/repo",
      repoRoot: "/repo",
      taskId: null,
    });
    expect(findMainWorktree([main], "/repo")?.id).toBe("main");
  });

  it("prefers the entry matching the project folder over other taskId-less ones", () => {
    const adhoc = wt({
      id: "adhoc",
      path: "/repo/.claude/worktrees/feat-x",
      repoRoot: "/repo",
      taskId: null,
    });
    const main = wt({
      id: "main",
      path: "/repo",
      repoRoot: "/repo",
      taskId: null,
    });
    // Order deliberately puts the ad-hoc entry first.
    expect(findMainWorktree([adhoc, main], "/repo")?.id).toBe("main");
  });
});

describe("resolveLocalMainPath", () => {
  it("prefers the local (canonical) main worktree path over the project folder", () => {
    const main = wt({
      id: "main",
      path: "/private/repo",
      repoRoot: "/repo",
      taskId: null,
    });
    expect(resolveLocalMainPath([main], "/repo")).toBe("/private/repo");
  });

  it("falls back to the project folder when no main entry exists", () => {
    expect(resolveLocalMainPath([], "/repo")).toBe("/repo");
  });

  it("returns null when neither is known", () => {
    expect(resolveLocalMainPath([], null)).toBeNull();
  });
});

describe("resolveRootSwitch", () => {
  const main = wt({
    id: "main",
    path: "/repo",
    repoRoot: "/repo",
    branch: "main",
    taskId: null,
  });
  const taskA = wt({
    id: "a",
    path: "/repo/.worktrees/a",
    repoRoot: "/repo",
    branch: "marblo/a",
    taskId: "T1",
  });
  const taskB = wt({
    id: "b",
    path: "/repo/.worktrees/b",
    repoRoot: "/repo",
    branch: "marblo/b",
    taskId: "T2",
  });

  it("returns null when no main worktree or project path is known", () => {
    expect(resolveRootSwitch("/repo/.worktrees/a", [taskA], null)).toBeNull();
  });

  it("returns null on main when there is no task worktree to switch to", () => {
    expect(resolveRootSwitch("/repo", [main], "/repo")).toBeNull();
  });

  it("offers task worktrees when viewing main", () => {
    const sw = resolveRootSwitch("/repo", [main, taskB, taskA], "/repo");
    expect(sw?.toMain).toBeNull();
    expect(sw?.mainPath).toBe("/repo");
    // Sorted by label.
    expect(sw?.toTasks.map((t) => t.path)).toEqual([
      "/repo/.worktrees/a",
      "/repo/.worktrees/b",
    ]);
    expect(sw?.toTasks[0]).toMatchObject({ label: "marblo/a", taskId: "T1" });
  });

  it("offers jump-to-main and other tasks when viewing a task worktree", () => {
    const sw = resolveRootSwitch(
      "/repo/.worktrees/a",
      [main, taskA, taskB],
      "/repo",
    );
    expect(sw?.toMain).toBe("/repo");
    // The currently-viewed worktree is excluded from the task list.
    expect(sw?.toTasks.map((t) => t.path)).toEqual(["/repo/.worktrees/b"]);
  });

  it("falls back to the project path when main worktree entry is absent", () => {
    const sw = resolveRootSwitch("/repo/.worktrees/a", [taskA], "/repo");
    expect(sw?.mainPath).toBe("/repo");
    expect(sw?.toMain).toBe("/repo");
    expect(sw?.toTasks).toEqual([]);
  });

  it("excludes stale worktrees from the switch targets", () => {
    const staleTask = wt({
      id: "stale",
      path: "/repo/.worktrees/stale",
      repoRoot: "/repo",
      branch: "marblo/stale",
      taskId: "T9",
      stale: true,
    });
    const sw = resolveRootSwitch("/repo", [main, taskA, staleTask], "/repo");
    expect(sw?.toTasks.map((t) => t.path)).toEqual(["/repo/.worktrees/a"]);
  });

  it("excludes a manually-archived task worktree via overrides", () => {
    const sw = resolveRootSwitch("/repo", [main, taskA, taskB], "/repo", {
      "/repo/.worktrees/a": "archived",
    });
    expect(sw?.toTasks.map((t) => t.path)).toEqual(["/repo/.worktrees/b"]);
  });

  it("re-includes a merged worktree that was manually restored via overrides", () => {
    const mergedTask = wt({
      id: "merged",
      path: "/repo/.worktrees/merged",
      repoRoot: "/repo",
      branch: "marblo/merged",
      taskId: "T7",
      stale: true,
    });
    // Auto-archived (stale) → hidden by default…
    expect(
      resolveRootSwitch("/repo", [main, mergedTask], "/repo")?.toTasks ?? [],
    ).toEqual([]);
    // …but a manual "active" override brings it back.
    const sw = resolveRootSwitch("/repo", [main, mergedTask], "/repo", {
      "/repo/.worktrees/merged": "active",
    });
    expect(sw?.toTasks.map((t) => t.path)).toEqual(["/repo/.worktrees/merged"]);
  });

  it("excludes worktrees with no taskId (ad-hoc feat/fix branches)", () => {
    const adhoc = wt({
      id: "adhoc",
      path: "/repo/.claude/worktrees/feat-x",
      repoRoot: "/repo",
      branch: "feat/x",
      taskId: null,
    });
    const sw = resolveRootSwitch("/repo", [main, taskA, adhoc], "/repo");
    expect(sw?.toTasks.map((t) => t.path)).toEqual(["/repo/.worktrees/a"]);
  });

  it("includes a healthy active task worktree", () => {
    const sw = resolveRootSwitch("/repo", [main, taskA], "/repo");
    expect(sw?.toTasks).toEqual([
      { path: "/repo/.worktrees/a", label: "marblo/a", taskId: "T1" },
    ]);
  });

  it("returns null on main when every worktree is filtered out", () => {
    const adhoc = wt({
      id: "adhoc",
      path: "/repo/.claude/worktrees/feat-x",
      repoRoot: "/repo",
      branch: "feat/x",
      taskId: null,
    });
    const staleTask = wt({
      id: "stale",
      path: "/repo/.worktrees/stale",
      repoRoot: "/repo",
      branch: "marblo/stale",
      taskId: "T9",
      stale: true,
    });
    expect(
      resolveRootSwitch("/repo", [main, adhoc, staleTask], "/repo"),
    ).toBeNull();
  });

  it("resolves mainPath to the canonical worktree path when it differs (symlink)", () => {
    // Main entry realpath'd to /private/repo; folderPath still raw /repo.
    const canonicalMain = wt({
      id: "main",
      path: "/private/repo",
      repoRoot: "/repo",
      branch: "main",
      taskId: null,
    });
    const task = wt({
      id: "a",
      path: "/repo/.worktrees/a",
      repoRoot: "/repo",
      branch: "marblo/a",
      taskId: "T1",
    });
    // Viewing the task worktree → "home" must target the CANONICAL main so the
    // switch actually lands on the tree the app loads (and no-op is avoided).
    const sw = resolveRootSwitch(
      "/repo/.worktrees/a",
      [canonicalMain, task],
      "/repo",
    );
    expect(sw?.mainPath).toBe("/private/repo");
    expect(sw?.toMain).toBe("/private/repo");
  });

  it("treats the raw project-folder path as on-main (no misleading home button)", () => {
    const canonicalMain = wt({
      id: "main",
      path: "/private/repo",
      repoRoot: "/repo",
      branch: "main",
      taskId: null,
    });
    const task = wt({
      id: "a",
      path: "/repo/.worktrees/a",
      repoRoot: "/repo",
      branch: "marblo/a",
      taskId: "T1",
    });
    // rootPath is the raw folderPath (/repo), mainPath is canonical
    // (/private/repo) — still "on main", so we offer tasks, not a home jump.
    const sw = resolveRootSwitch("/repo", [canonicalMain, task], "/repo");
    expect(sw?.toMain).toBeNull();
    expect(sw?.toTasks.map((t) => t.path)).toEqual(["/repo/.worktrees/a"]);
  });
});

describe("isStrayWorktreeContainerRoot", () => {
  const p1 = wt({
    id: "p1",
    projectId: "p1",
    path: "/Users/me/.marblo/worktrees/p1/T1",
    repoRoot: "/repo",
    taskId: "T1",
  });

  it("flags the shared worktrees container root", () => {
    expect(
      isStrayWorktreeContainerRoot(
        "/Users/me/.marblo/worktrees",
        [p1],
        "/repo",
      ),
    ).toBe(true);
  });

  it("flags a per-project bucket inside the container", () => {
    expect(
      isStrayWorktreeContainerRoot(
        "/Users/me/.marblo/worktrees/p1",
        [p1],
        "/repo",
      ),
    ).toBe(true);
  });

  it("does NOT flag a concrete leaf worktree path", () => {
    expect(
      isStrayWorktreeContainerRoot(
        "/Users/me/.marblo/worktrees/p1/T1",
        [p1],
        "/repo",
      ),
    ).toBe(false);
  });

  it("does NOT flag a recognised worktree entry even if list is loaded", () => {
    const container = wt({
      id: "c",
      path: "/Users/me/.marblo/worktrees",
      repoRoot: "/repo",
      taskId: null,
    });
    // A (contrived) worktree entry AT the container path is recognised → not stray.
    expect(
      isStrayWorktreeContainerRoot(
        "/Users/me/.marblo/worktrees",
        [container],
        "/repo",
      ),
    ).toBe(false);
  });

  it("does NOT flag an intentionally browsed arbitrary folder", () => {
    expect(
      isStrayWorktreeContainerRoot("/Users/me/dev/some-lib", [p1], "/repo"),
    ).toBe(false);
  });

  it("does NOT flag paths inside the project folder", () => {
    expect(isStrayWorktreeContainerRoot("/repo/src", [p1], "/repo")).toBe(
      false,
    );
  });

  it("returns false for a null root", () => {
    expect(isStrayWorktreeContainerRoot(null, [p1], "/repo")).toBe(false);
  });
});

describe("isActiveTaskWorktree", () => {
  it("accepts a worktree with a taskId that is not stale", () => {
    expect(isActiveTaskWorktree(wt({ taskId: "T1", stale: false }))).toBe(true);
  });

  it("rejects a worktree without a taskId", () => {
    expect(isActiveTaskWorktree(wt({ taskId: null }))).toBe(false);
  });

  it("rejects a stale worktree even with a taskId", () => {
    expect(isActiveTaskWorktree(wt({ taskId: "T1", stale: true }))).toBe(false);
  });

  it("respects a manual archive override", () => {
    const active = wt({
      path: "/repo/.worktrees/x",
      taskId: "T1",
      stale: false,
    });
    expect(
      isActiveTaskWorktree(active, { "/repo/.worktrees/x": "archived" }),
    ).toBe(false);
  });

  it("respects a manual restore override on a stale worktree", () => {
    const stale = wt({ path: "/repo/.worktrees/y", taskId: "T1", stale: true });
    expect(
      isActiveTaskWorktree(stale, { "/repo/.worktrees/y": "active" }),
    ).toBe(true);
  });
});

describe("filterWorktreesByProject", () => {
  it("excludes worktrees from other projects", () => {
    const p1Main = wt({ id: "p1-main", projectId: "p1", path: "/repo" });
    const p1Task = wt({
      id: "p1-task",
      projectId: "p1",
      path: "/repo/.worktrees/a",
    });
    const p2Task = wt({
      id: "p2-task",
      projectId: "p2",
      path: "/other/.worktrees/b",
    });

    expect(
      filterWorktreesByProject([p1Main, p2Task, p1Task], "p1").map(
        (worktree) => worktree.id,
      ),
    ).toEqual(["p1-main", "p1-task"]);
  });

  it("returns an empty list without a current project", () => {
    expect(filterWorktreesByProject([wt({ projectId: "p1" })], null)).toEqual(
      [],
    );
  });
});

describe("calculateWorktreeMenuPosition", () => {
  it("opens rightwards from a narrow left-sidebar trigger without clipping", () => {
    // Narrow sidebar button: left 220, right 280. Wide viewport.
    const pos = calculateWorktreeMenuPosition(
      { left: 220, right: 280, bottom: 40 },
      1440,
    );
    const width = Math.max(260, Math.min(360, 1440 * 0.8)); // 360
    // Left-aligned to the button, no clamp needed → stays on screen.
    expect(pos).toEqual({ left: 220, top: 44 });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + width).toBeLessThanOrEqual(1440);
  });

  it("clamps to the right edge when the trigger is near the viewport edge", () => {
    const width = Math.max(260, Math.min(360, 1440 * 0.8)); // 360
    expect(
      calculateWorktreeMenuPosition(
        { left: 1400, right: 1430, bottom: 40 },
        1440,
      ),
    ).toEqual({
      left: 1440 - width - 8, // 1072
      top: 44,
    });
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
