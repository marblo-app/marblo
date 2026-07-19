import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findMainWorktree,
  resolveLocalMainPath,
  resolveLocalMainTarget,
  resolveMainWorktree,
  resolveRootSwitch,
} from "../../src/lib/fileTreeView";
import { useWorktreeStore } from "../../src/stores/worktreeStore";
import type { Worktree } from "../../src/types/worktree";

/**
 * Regression guard for the "home button goes to another worktree" report.
 *
 * Measured root cause: `findMainWorktree` had no evidence of what "main" is. It
 * filtered on `taskId == null` (which is derived from whether the *projectId*
 * appears in the worktree path — so it is null for EVERY entry whenever the
 * grouping projectId differs from the one baked into the paths), then preferred
 * `path === repoRoot` (repoRoot is the main process's session rootPath, which is
 * routinely a task worktree), and finally returned `mains[0]` unverified.
 *
 * The fix makes git the authority: `git worktree list` lists the main worktree
 * first, and the store stamps that as `isMain` on both the full and the light
 * (#495 `listLight`) enumeration paths.
 */

const MAIN = "/Users/dev/Documents/programming/Marblo";
const PROJECT = "GFB8JnJrrX6AgahqmGB3";
const WT_A = `/Users/dev/.marblo/worktrees/${PROJECT}/yJgz7s03JAgCrTKY0Do7`;
const WT_B = `/Users/dev/.marblo/worktrees/${PROJECT}/xjUVJw6z0a7cko21qNGq`;

function wt(over: Partial<Worktree>): Worktree {
  return {
    id: `p1:${over.path ?? MAIN}`,
    taskId: null,
    projectId: "p1",
    agentId: null,
    branch: "main",
    baseRef: "origin/main",
    path: MAIN,
    repoRoot: MAIN,
    createdAt: null,
    ...over,
  };
}

/** Enumeration in git order (main first), as the store now stamps it. */
function enumerated(paths: string[], repoRoot: string): Worktree[] {
  return paths.map((path, index) =>
    wt({
      path,
      repoRoot,
      isMain: index === 0,
      taskId: index === 0 ? null : `task-${index}`,
      branch: index === 0 ? "main" : `marblo/branch-${index}`,
    }),
  );
}

/**
 * Same enumeration, but with `taskId` null on EVERY entry — the state the store
 * actually produces whenever the grouping projectId is absent from the worktree
 * paths (`inferTaskId` finds nothing to key on). This is the condition under
 * which the old heuristics had zero signal left and elected an arbitrary
 * worktree, so the measured-failure cases below must use it.
 */
function enumeratedNoTaskIds(paths: string[], repoRoot: string): Worktree[] {
  return enumerated(paths, repoRoot).map((w) => ({ ...w, taskId: null }));
}

describe("resolveMainWorktree — git's isMain is authoritative", () => {
  it("picks the isMain entry even when repoRoot points at a task worktree", () => {
    // repoRoot = an orchestrator session root that happens to be a worktree.
    // The old `path === repoRoot` preference elected WT_A as "main" here.
    const worktrees = enumeratedNoTaskIds([MAIN, WT_A, WT_B], WT_A);
    expect(findMainWorktree(worktrees, MAIN)?.path).toBe(MAIN);
    expect(resolveLocalMainPath(worktrees, MAIN)).toBe(MAIN);
  });

  it("picks the isMain entry when projectRootPath is unknown (foreign-machine folderPath)", () => {
    // Project.folderPath is optional and is written by whichever machine
    // registered the project, so on another machine it is null / non-matching.
    // This is the exact combination measured as returning a task worktree.
    const worktrees = enumeratedNoTaskIds([MAIN, WT_A, WT_B], WT_A);
    expect(findMainWorktree(worktrees, null)?.path).toBe(MAIN);
    expect(resolveLocalMainPath(worktrees, null)).toBe(MAIN);
  });

  it("picks the isMain entry when the projectId is absent from every path", () => {
    // Grouping projectId != the id baked into the worktree paths, so inferTaskId
    // returns null for all of them and every entry became a "main" candidate.
    const worktrees = [MAIN, WT_A, WT_B].map((path, index) =>
      wt({ path, repoRoot: WT_A, isMain: index === 0, taskId: null }),
    );
    expect(findMainWorktree(worktrees, null)?.path).toBe(MAIN);
  });

  it("never elects a task worktree as main", () => {
    const worktrees = enumeratedNoTaskIds([MAIN, WT_A, WT_B], WT_A);
    for (const projectRoot of [MAIN, null, "/some/foreign/machine/path"]) {
      expect([WT_A, WT_B]).not.toContain(
        findMainWorktree(worktrees, projectRoot)?.path,
      );
    }
  });

  it("prefers the project-folder match when duplicate groups flag two mains", () => {
    // Same projectId enumerated under two repoRoots yields the main entry twice.
    const worktrees = [
      wt({ path: "/other/checkout", repoRoot: "/other/checkout", isMain: true }),
      wt({ path: MAIN, repoRoot: MAIN, isMain: true }),
    ];
    expect(findMainWorktree(worktrees, MAIN)?.path).toBe(MAIN);
  });
});

describe("resolveMainWorktree — explicit failure instead of a silent wrong jump", () => {
  it("reports no-worktrees for an empty list", () => {
    expect(resolveMainWorktree([], null)).toEqual({
      ok: false,
      reason: "no-worktrees",
    });
  });

  it("reports ambiguous rather than guessing mains[0] on a pre-flag snapshot", () => {
    // No isMain (snapshot predates the flag), projectId absent from the paths so
    // every entry looks like a candidate, and no project folder to disambiguate.
    // The old code returned worktrees[0] regardless of evidence.
    const worktrees = [MAIN, WT_A, WT_B].map((path) =>
      wt({ path, repoRoot: WT_A, taskId: null }),
    );
    expect(resolveMainWorktree(worktrees, null)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
    expect(resolveLocalMainTarget(worktrees, null)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
    expect(resolveLocalMainPath(worktrees, null)).toBeNull();
  });

  it("still resolves a pre-flag snapshot when the project folder matches", () => {
    const worktrees = [MAIN, WT_A].map((path) =>
      wt({ path, repoRoot: WT_A, taskId: null }),
    );
    expect(findMainWorktree(worktrees, MAIN)?.path).toBe(MAIN);
  });

  it("falls back to the project folder when no worktrees are known", () => {
    expect(resolveLocalMainTarget([], MAIN)).toEqual({ ok: true, path: MAIN });
  });
});

describe("resolveRootSwitch — the home target the button actually uses", () => {
  it("offers main (not another worktree) while viewing a task worktree", () => {
    const worktrees = enumerated([MAIN, WT_A, WT_B], WT_A);
    const scenarios: (string | null)[] = [MAIN, null];
    for (const projectRoot of scenarios) {
      const sw = resolveRootSwitch(WT_A, worktrees, projectRoot);
      expect(sw?.toMain).toBe(MAIN);
      expect(sw?.mainPath).toBe(MAIN);
      // ...and the switch list must not offer main back as a "task" target.
      expect(sw?.toTasks.map((t) => t.path)).not.toContain(MAIN);
    }
  });
});

/**
 * End-to-end through the store: the light enumeration (#495 `worktree:listLight`)
 * must produce a snapshot whose home target is main. Requirement: the perf
 * rewrite's output has to satisfy the same invariant as the full sweep.
 */
describe("light enumeration (#495) — home still resolves to main", () => {
  interface LightGroup {
    projectId: string;
    repoRoot: string;
    baseRef: string;
    worktrees: { path: string; branch: string; head: string }[];
  }

  const listMock = vi.fn();
  const listLightMock = vi.fn<() => Promise<LightGroup[]>>();

  function group(
    paths: string[],
    repoRoot: string,
    projectId = PROJECT,
  ): LightGroup[] {
    return [
      {
        projectId,
        repoRoot,
        baseRef: "origin/main",
        worktrees: paths.map((path) => ({
          path,
          branch: path === MAIN ? "main" : `marblo/${path.split("/").pop()}`,
          head: "abc123",
        })),
      },
    ];
  }

  beforeEach(() => {
    listMock.mockReset();
    listLightMock.mockReset();
    vi.stubGlobal("window", {
      electronAPI: { worktree: { list: listMock, listLight: listLightMock } },
    });
    useWorktreeStore.setState({
      worktrees: [],
      loading: false,
      lastError: null,
      lastRefreshedAt: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps isMain on the first enumerated entry", async () => {
    listLightMock.mockResolvedValue(group([MAIN, WT_A, WT_B], MAIN));
    await useWorktreeStore.getState().refreshLight();
    const worktrees = useWorktreeStore.getState().worktrees;
    expect(worktrees.map((w) => w.isMain)).toEqual([true, false, false]);
  });

  it("home resolves to main even with a worktree repoRoot and no project folder", async () => {
    // The measured failure combination, now fed through the real light path.
    listLightMock.mockResolvedValue(group([MAIN, WT_A, WT_B], WT_A));
    await useWorktreeStore.getState().refreshLight();
    const worktrees = useWorktreeStore.getState().worktrees;
    expect(resolveLocalMainPath(worktrees, null)).toBe(MAIN);
    expect(resolveRootSwitch(WT_A, worktrees, null)?.toMain).toBe(MAIN);
  });

  it("home resolves to main when the group projectId is absent from the paths", async () => {
    // The full measured failure, end-to-end through the light path: the group's
    // projectId doesn't appear in the worktree paths, so inferTaskId returns
    // null for every entry and the old heuristics fell through to
    // `path === repoRoot` — electing WT_A, the worktree the user was viewing.
    listLightMock.mockResolvedValue(
      group([MAIN, WT_A, WT_B], WT_A, "someOtherProjectId"),
    );
    await useWorktreeStore.getState().refreshLight();
    const worktrees = useWorktreeStore.getState().worktrees;
    expect(worktrees.every((w) => w.taskId === null)).toBe(true);
    expect(resolveLocalMainPath(worktrees, null)).toBe(MAIN);
    expect(resolveRootSwitch(WT_A, worktrees, null)?.toMain).toBe(MAIN);
  });

  it("a second light refresh keeps isMain current (never carried from prev)", async () => {
    listLightMock.mockResolvedValueOnce(group([MAIN, WT_A], MAIN));
    await useWorktreeStore.getState().refreshLight();
    // Main checkout removed from enumeration (e.g. repo re-registered from a
    // different root): the flag must follow the new order, not the old snapshot.
    listLightMock.mockResolvedValueOnce(group([WT_B, WT_A], WT_B));
    await useWorktreeStore.getState().refreshLight();
    const worktrees = useWorktreeStore.getState().worktrees;
    expect(worktrees.map((w) => [w.path, w.isMain])).toEqual([
      [WT_B, true],
      [WT_A, false],
    ]);
  });

  it("the full path stamps isMain identically", async () => {
    listLightMock.mockResolvedValue(group([MAIN, WT_A], WT_A));
    listMock.mockResolvedValue([
      {
        projectId: PROJECT,
        repoRoot: WT_A,
        baseRef: "origin/main",
        worktrees: [MAIN, WT_A].map((path) => ({
          path,
          branch: path === MAIN ? "main" : "marblo/wt-a",
          head: "abc123",
          status: {
            branch: "main",
            baseRef: "origin/main",
            ahead: 0,
            behind: 0,
            dirty: false,
            mergeable: true,
            conflicts: [],
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
          },
        })),
      },
    ]);
    await useWorktreeStore.getState().refresh();
    const full = useWorktreeStore.getState().worktrees;
    expect(full.map((w) => w.isMain)).toEqual([true, false]);
    expect(resolveLocalMainPath(full, null)).toBe(MAIN);

    await useWorktreeStore.getState().refreshLight();
    const light = useWorktreeStore.getState().worktrees;
    expect(light.map((w) => w.isMain)).toEqual(full.map((w) => w.isMain));
  });
});
