import { describe, it, expect } from "vitest";
import path from "path";
import {
  diagnoseRootPath,
  describeRootPathFailure,
  isAgentWorktreePath,
  isForeignPlatformPath,
} from "../../electron/rootPathHealth";

const HOME = "/Users/tester";
const POOL = path.join(HOME, ".marblo", "worktrees");

describe("isAgentWorktreePath", () => {
  it("matches the pool itself and anything under it", () => {
    expect(isAgentWorktreePath(POOL, HOME)).toBe(true);
    expect(isAgentWorktreePath(path.join(POOL, "proj", "task"), HOME)).toBe(
      true,
    );
  });

  it("does not match a sibling that merely shares the prefix", () => {
    // A plain startsWith would wrongly claim this one.
    expect(isAgentWorktreePath(`${POOL}-backup`, HOME)).toBe(false);
  });

  it("does not match an ordinary project folder", () => {
    expect(
      isAgentWorktreePath("/Users/tester/Documents/programming/marblo", HOME),
    ).toBe(false);
  });
});

describe("isForeignPlatformPath", () => {
  // The observed bug: a Windows path reached a macOS machine via Firestore.
  it("flags a Windows path when not running on Windows", () => {
    if (process.platform === "win32") return;
    expect(
      isForeignPlatformPath("C:\\Users\\meloc\\Documents\\music_composer"),
    ).toBe(true);
    expect(isForeignPlatformPath("\\\\server\\share\\proj")).toBe(true);
  });

  it("accepts a native path on the current platform", () => {
    if (process.platform === "win32") return;
    expect(isForeignPlatformPath("/Users/tester/proj")).toBe(false);
  });

  it("treats empty input as not foreign", () => {
    expect(isForeignPlatformPath("")).toBe(false);
  });
});

describe("diagnoseRootPath", () => {
  it("classifies a foreign-OS path as foreign-platform, not missing", () => {
    if (process.platform === "win32") return;
    const d = diagnoseRootPath("C:\\Users\\meloc\\music_composer", {
      homeDir: HOME,
    });
    expect(d.failure).toBe("foreign-platform");
  });

  it("classifies a reaped agent worktree as worktree-removed", () => {
    const d = diagnoseRootPath(path.join(POOL, "proj", "task"), {
      homeDir: HOME,
    });
    expect(d.failure).toBe("worktree-removed");
  });

  it("classifies anything else as missing", () => {
    const d = diagnoseRootPath("/Users/tester/gone", { homeDir: HOME });
    expect(d.failure).toBe("missing");
  });

  it("carries a fallback through, but never one equal to the dead path", () => {
    const dead = path.join(POOL, "proj", "task");
    expect(
      diagnoseRootPath(dead, { homeDir: HOME, fallbackRootPath: "/Users/x" })
        .fallbackRootPath,
    ).toBe("/Users/x");
    expect(
      diagnoseRootPath(dead, { homeDir: HOME, fallbackRootPath: dead })
        .fallbackRootPath,
    ).toBeUndefined();
  });
});

describe("describeRootPathFailure", () => {
  it("does NOT claim a foreign path was deleted", () => {
    const msg = describeRootPathFailure({
      failure: "foreign-platform",
      rootPath: "C:\\Users\\meloc\\music_composer",
    });
    // The old copy said "사라졌습니다" for this case, which was simply false.
    expect(msg.title).not.toContain("사라졌");
    expect(msg.body).not.toContain("사라졌");
    expect(msg.body).toContain("다른 기기");
    expect(msg.body).toContain("C:\\Users\\meloc\\music_composer");
  });

  it("frames a reaped worktree as normal cleanup, not data loss", () => {
    const msg = describeRootPathFailure({
      failure: "worktree-removed",
      rootPath: path.join(POOL, "p", "t"),
    });
    expect(msg.body).toContain("정상적인 정리");
  });

  it("offers a recovery label only when a fallback exists", () => {
    const withFallback = describeRootPathFailure({
      failure: "missing",
      rootPath: "/gone",
      fallbackRootPath: "/live",
    });
    expect(withFallback.fallbackLabel).toBeTruthy();
    expect(withFallback.body).toContain("/live");

    const without = describeRootPathFailure({
      failure: "missing",
      rootPath: "/gone",
    });
    expect(without.fallbackLabel).toBeUndefined();
  });

  it("always names the offending path so the user can act on it", () => {
    for (const failure of [
      "foreign-platform",
      "worktree-removed",
      "missing",
    ] as const) {
      const msg = describeRootPathFailure({ failure, rootPath: "/some/root" });
      expect(msg.body).toContain("/some/root");
    }
  });
});
