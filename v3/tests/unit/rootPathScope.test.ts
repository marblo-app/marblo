/**
 * @vitest-environment jsdom
 *
 * `isForeignPlatformPath`/`canBeGlobalRoot` read `navigator.userAgent` (the
 * renderer-side host-OS check). vitest's default "node" environment has no
 * `navigator` — Node only adds one itself from v21, so borrowing that ambient
 * global silently broke this suite on Node 20 (this repo's CI/release target,
 * engines: ">=20 <23"). Pin jsdom explicitly so the real thing is always
 * there, independent of which Node version runs the suite.
 */
import { describe, it, expect } from "vitest";
import {
  canBeGlobalRoot,
  isAgentWorktreePath,
  isForeignPlatformPath,
} from "../../src/lib/rootPathScope";

describe("isAgentWorktreePath (renderer)", () => {
  it("matches the agent worktree pool on both separators", () => {
    expect(isAgentWorktreePath("/Users/t/.marblo/worktrees/proj/task")).toBe(
      true,
    );
    expect(isAgentWorktreePath("C:\\Users\\t\\.marblo\\worktrees\\p\\t")).toBe(
      true,
    );
  });

  it("does not match a lookalike folder name", () => {
    expect(isAgentWorktreePath("/Users/t/my.marblo/worktrees-notes")).toBe(
      false,
    );
    expect(isAgentWorktreePath("/Users/t/.marblo/agents/x")).toBe(false);
  });

  it("handles null/empty", () => {
    expect(isAgentWorktreePath(null)).toBe(false);
    expect(isAgentWorktreePath("")).toBe(false);
  });
});

describe("canBeGlobalRoot", () => {
  // This is the regression guard for the every-boot popup: clicking
  // "이 워크트리 보기" used to overwrite the global cold-start fallback with a
  // per-task worktree that the sweep then reaped.
  it("refuses an agent worktree", () => {
    expect(canBeGlobalRoot("/Users/t/.marblo/worktrees/GFB8/AOHK")).toBe(false);
  });

  it("refuses a foreign-OS path", () => {
    if (navigator.userAgent.includes("Windows")) return;
    expect(canBeGlobalRoot("C:\\Users\\meloc\\music_composer")).toBe(false);
  });

  it("accepts an ordinary local project root", () => {
    if (navigator.userAgent.includes("Windows")) return;
    expect(canBeGlobalRoot("/Users/t/Documents/programming/marblo")).toBe(true);
  });

  it("refuses null/empty", () => {
    expect(canBeGlobalRoot(null)).toBe(false);
    expect(canBeGlobalRoot("")).toBe(false);
  });
});

describe("isForeignPlatformPath (renderer)", () => {
  it("agrees with the main-process rule on the observed bad path", () => {
    if (navigator.userAgent.includes("Windows")) return;
    expect(
      isForeignPlatformPath(
        "C:\\Users\\meloc\\OneDrive\\Documents\\programming\\music_composer",
      ),
    ).toBe(true);
  });
});
