import { describe, expect, it } from "vitest";
import {
  isPathUnder,
  mergeAccountWindowSession,
  mergeAccountWindowSessionIntoState,
  resolveRestoreRoots,
  scrubRemovedRoots,
  selectPersistableWindows,
  sessionForAccount,
} from "../../electron/windowSession";

/**
 * selectPersistableWindows decides which open windows belong in the on-disk
 * multi-window session that restoreWindowSession() reopens on next launch.
 *
 * Regression (6-windows-of-the-same-project bug): popping out Board/Code tabs
 * created detached sub-windows seeded with the PARENT project's rootPath. Those
 * detached entries were persisted alongside the parent and — because the
 * detached view type was never saved — restored as FULL duplicate windows. A
 * couple of pop-outs ballooned into ~6 identical project windows on relaunch.
 *
 * The fix: detached pop-out windows are NEVER persisted, and the persisted set
 * is deduped by rootPath so a project can reopen at most once.
 */
describe("selectPersistableWindows", () => {
  it("excludes detached pop-out windows from the persisted session", () => {
    const result = selectPersistableWindows([
      { rootPath: "/proj/a", projectId: "a" },
      { rootPath: "/proj/a", projectId: "a", detached: true }, // popped-out Board
      { rootPath: "/proj/a", projectId: "a", detached: true }, // popped-out Code
    ]);
    expect(result).toEqual([{ rootPath: "/proj/a", projectId: "a" }]);
  });

  it("dedupes full windows by rootPath (no runaway duplicates on restore)", () => {
    const result = selectPersistableWindows([
      { rootPath: "/proj/a", projectId: "a" },
      { rootPath: "/proj/a", projectId: "a" },
      { rootPath: "/proj/a", projectId: "a" },
    ]);
    expect(result).toEqual([{ rootPath: "/proj/a", projectId: "a" }]);
  });

  it("keeps genuinely distinct projects as separate windows", () => {
    const result = selectPersistableWindows([
      { rootPath: "/proj/a", projectId: "a" },
      { rootPath: "/proj/b", projectId: "b" },
    ]);
    expect(result).toEqual([
      { rootPath: "/proj/a", projectId: "a" },
      { rootPath: "/proj/b", projectId: "b" },
    ]);
  });

  it("drops windows without a rootPath (can't be restored)", () => {
    const result = selectPersistableWindows([
      { projectId: "a" },
      { rootPath: "", projectId: "b" },
      { rootPath: "/proj/c", projectId: "c" },
    ]);
    expect(result).toEqual([{ rootPath: "/proj/c", projectId: "c" }]);
  });

  it("omits projectId when absent rather than writing undefined", () => {
    const result = selectPersistableWindows([{ rootPath: "/proj/a" }]);
    expect(result).toEqual([{ rootPath: "/proj/a" }]);
    expect("projectId" in result[0]).toBe(false);
  });

  it("tolerates null/garbage entries from a corrupted app-state.json", () => {
    const result = selectPersistableWindows([
      null as unknown as { rootPath?: string },
      undefined as unknown as { rootPath?: string },
      { rootPath: "/proj/a", projectId: "a" },
    ]);
    expect(result).toEqual([{ rootPath: "/proj/a", projectId: "a" }]);
  });

  it("filters persistable windows by explicit uid", () => {
    const result = selectPersistableWindows(
      [
        { uid: "A", rootPath: "/proj/a", projectId: "pA" },
        { uid: "B", rootPath: "/proj/b", projectId: "pB" },
        { rootPath: "/proj/legacy", projectId: "legacy" },
      ],
      "B",
    );
    expect(result).toEqual([{ rootPath: "/proj/b", projectId: "pB" }]);
  });
});

describe("account window sessions", () => {
  it("keeps project restore slots separated by uid", () => {
    const afterA = mergeAccountWindowSession(undefined, "A", {
      lastRootPath: "/proj/a",
      lastProjectId: "pA",
      windows: [{ rootPath: "/proj/a", projectId: "pA" }],
    });
    const afterB = mergeAccountWindowSession(afterA, "B", {
      lastRootPath: "/proj/b",
      lastProjectId: "pB",
      windows: [{ rootPath: "/proj/b", projectId: "pB" }],
    });

    expect(sessionForAccount(afterB, "B")).toEqual({
      lastRootPath: "/proj/b",
      lastProjectId: "pB",
      windows: [{ rootPath: "/proj/b", projectId: "pB" }],
    });
    expect(sessionForAccount(afterB, "A")).toEqual({
      lastRootPath: "/proj/a",
      lastProjectId: "pA",
      windows: [{ rootPath: "/proj/a", projectId: "pA" }],
    });
    expect(sessionForAccount(afterB, "C")).toEqual({});
  });

  it("does not attach A's folder to first-time B, but restores it when A returns", () => {
    const sessions = mergeAccountWindowSession(undefined, "A", {
      lastRootPath: "/proj/a",
      lastProjectId: "pA",
      windows: [{ rootPath: "/proj/a", projectId: "pA" }],
    });

    expect(sessionForAccount(sessions, "B")).toEqual({});
    expect(sessionForAccount(sessions, "A")).toEqual({
      lastRootPath: "/proj/a",
      lastProjectId: "pA",
      windows: [{ rootPath: "/proj/a", projectId: "pA" }],
    });
  });

  it("preserves device-scoped app state while updating an account restore slot", () => {
    const state = mergeAccountWindowSessionIntoState(
      {
        machineId: "machine-1",
        staticServerPort: 48123,
        preventSleepWhileWorking: false,
      },
      "A",
      { lastRootPath: "/proj/a", lastProjectId: "pA" },
    );

    expect(state.machineId).toBe("machine-1");
    expect(state.staticServerPort).toBe(48123);
    expect(state.preventSleepWhileWorking).toBe(false);
    expect(state.accountWindowSessions.A).toEqual({
      lastRootPath: "/proj/a",
      lastProjectId: "pA",
    });
  });
});

/**
 * resolveRestoreRoots / scrubRemovedRoots close the two halves of the
 * "orchestrator silently won't attach" bug (ticket 4xSVtpGzt5NJE4FISfmj).
 *
 * A window whose rootPath points at a REMOVED git worktree is not obviously
 * broken: every PTY spawned under it dies in ~6ms with exit=1 and no error, so
 * the orchestrator reads it as a crash and relaunches into the same dead path.
 * Because the open window set is re-snapshotted to app-state.json at quit, the
 * dead path is persisted and reopened on the next launch — the failure survives
 * a restart. scrubRemovedRoots fixes the cause (removal time); resolveRestoreRoots
 * catches paths that died while the app was closed.
 */
const alive =
  (...live: string[]) =>
  (p: string) =>
    live.includes(p);

describe("resolveRestoreRoots", () => {
  it("keeps windows whose rootPath still exists", () => {
    const { windows, dropped } = resolveRestoreRoots(
      [{ rootPath: "/proj/a", projectId: "a" }],
      alive("/proj/a"),
    );
    expect(windows).toEqual([{ rootPath: "/proj/a", projectId: "a" }]);
    expect(dropped).toEqual([]);
  });

  it("re-points a dead worktree to a surviving window of the same project", () => {
    const { windows, dropped } = resolveRestoreRoots(
      [
        { rootPath: "/wt/task-1", projectId: "a" },
        { rootPath: "/proj/a", projectId: "a" },
      ],
      alive("/proj/a"),
    );
    expect(dropped).toEqual([]);
    expect(windows).toEqual([
      { rootPath: "/proj/a", projectId: "a", fellBackFrom: "/wt/task-1" },
    ]);
  });

  it("falls back to defaultRootPath when no sibling survives", () => {
    const { windows, dropped } = resolveRestoreRoots(
      [{ rootPath: "/wt/task-1", projectId: "a" }],
      alive("/proj/main"),
      { defaultRootPath: "/proj/main" },
    );
    expect(dropped).toEqual([]);
    expect(windows).toEqual([
      { rootPath: "/proj/main", projectId: "a", fellBackFrom: "/wt/task-1" },
    ]);
  });

  it("drops a window rather than opening it on a path that is gone", () => {
    const { windows, dropped } = resolveRestoreRoots(
      [{ rootPath: "/wt/task-1", projectId: "a" }],
      alive(),
    );
    expect(windows).toEqual([]);
    expect(dropped).toEqual([{ rootPath: "/wt/task-1", projectId: "a" }]);
  });

  it("ignores a defaultRootPath that is itself gone", () => {
    const { windows, dropped } = resolveRestoreRoots(
      [{ rootPath: "/wt/task-1", projectId: "a" }],
      alive(),
      { defaultRootPath: "/proj/also-gone" },
    );
    expect(windows).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("does not collapse several dead worktrees onto duplicate fallback windows", () => {
    // Without the dedupe, three dead worktrees of one project would all resolve
    // to /proj/main and reopen it as three identical windows — the same class of
    // bug selectPersistableWindows already guards against.
    const { windows, dropped } = resolveRestoreRoots(
      [
        { rootPath: "/wt/t1", projectId: "a" },
        { rootPath: "/wt/t2", projectId: "a" },
        { rootPath: "/wt/t3", projectId: "a" },
      ],
      alive("/proj/main"),
      { defaultRootPath: "/proj/main" },
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].rootPath).toBe("/proj/main");
    expect(dropped).toHaveLength(2);
  });
});

describe("isPathUnder", () => {
  it("matches the path itself and its descendants", () => {
    expect(isPathUnder("/wt/foo", "/wt/foo")).toBe(true);
    expect(isPathUnder("/wt/foo/src/a.ts", "/wt/foo")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    // A plain startsWith would evict /wt/foo-2 when /wt/foo is removed.
    expect(isPathUnder("/wt/foo-2", "/wt/foo")).toBe(false);
    expect(isPathUnder("/wt/foobar", "/wt/foo")).toBe(false);
  });
});

describe("scrubRemovedRoots", () => {
  it("re-points a window that was viewing the removed worktree", () => {
    const scrubs = scrubRemovedRoots(
      [
        [1, { rootPath: "/wt/task-1", projectId: "a" }],
        [2, { rootPath: "/proj/a", projectId: "a" }],
      ],
      ["/wt/task-1"],
      { exists: alive("/proj/a") },
    );
    expect(scrubs).toEqual([
      { key: 1, rootPath: "/proj/a", removedRootPath: "/wt/task-1" },
    ]);
  });

  it("leaves a window with no surviving root rootPath-less (folder picker)", () => {
    const scrubs = scrubRemovedRoots(
      [[1, { rootPath: "/wt/task-1", projectId: "a" }]],
      ["/wt/task-1"],
      { exists: alive() },
    );
    expect(scrubs).toEqual([{ key: 1, removedRootPath: "/wt/task-1" }]);
    expect(scrubs[0].rootPath).toBeUndefined();
  });

  it("scrubs windows nested inside a removed worktree", () => {
    const scrubs = scrubRemovedRoots(
      [[1, { rootPath: "/wt/task-1/packages/app", projectId: "a" }]],
      ["/wt/task-1"],
      { exists: alive("/proj/main"), defaultRootPath: "/proj/main" },
    );
    expect(scrubs).toHaveLength(1);
    expect(scrubs[0].rootPath).toBe("/proj/main");
  });

  it("leaves unaffected windows alone, including prefix-sharing siblings", () => {
    const scrubs = scrubRemovedRoots(
      [
        [1, { rootPath: "/wt/task-1-extra", projectId: "a" }],
        [2, { rootPath: "/proj/a", projectId: "a" }],
      ],
      ["/wt/task-1"],
      { exists: alive("/wt/task-1-extra", "/proj/a") },
    );
    expect(scrubs).toEqual([]);
  });

  it("skips detached pop-outs — they ride on their parent and are never persisted", () => {
    const scrubs = scrubRemovedRoots(
      [[1, { rootPath: "/wt/task-1", projectId: "a", detached: true }]],
      ["/wt/task-1"],
      { exists: alive("/proj/main"), defaultRootPath: "/proj/main" },
    );
    expect(scrubs).toEqual([]);
  });

  it("never falls back onto a root that this same removal deleted", () => {
    // Bulk hygiene (cleanupStale) removes many worktrees at once and can delete
    // lastRootPath along with them.
    const scrubs = scrubRemovedRoots(
      [[1, { rootPath: "/wt/t1", projectId: "a" }]],
      ["/wt/t1", "/wt/t2"],
      { exists: alive("/wt/t2"), defaultRootPath: "/wt/t2" },
    );
    expect(scrubs).toEqual([{ key: 1, removedRootPath: "/wt/t1" }]);
  });

  it("is a no-op when nothing was removed", () => {
    expect(
      scrubRemovedRoots([[1, { rootPath: "/proj/a" }]], [], {
        exists: alive("/proj/a"),
      }),
    ).toEqual([]);
  });
});
