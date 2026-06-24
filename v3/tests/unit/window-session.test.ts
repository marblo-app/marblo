import { describe, expect, it } from "vitest";
import { selectPersistableWindows } from "../../electron/windowSession";

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
});
