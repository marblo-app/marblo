import { describe, it, expect } from "vitest";
import {
  RIGHT_TABS,
  MIN_RATIO,
  MAX_RATIO,
  DEFAULT_RATIO,
  NARROW_BREAKPOINT,
  clampRatio,
  parseStoredRatio,
  parseStoredTab,
  parseStoredCollapsed,
  isRightTab,
  isTerminalCollapsed,
  ratioFromPointer,
} from "../../src/lib/splitWorkspaceLayout";

describe("clampRatio", () => {
  it("clamps below MIN and above MAX", () => {
    expect(clampRatio(0)).toBe(MIN_RATIO);
    expect(clampRatio(-5)).toBe(MIN_RATIO);
    expect(clampRatio(1)).toBe(MAX_RATIO);
    expect(clampRatio(99)).toBe(MAX_RATIO);
  });

  it("passes through an in-band value unchanged", () => {
    expect(clampRatio(0.45)).toBe(0.45);
  });

  it("falls back to DEFAULT_RATIO for non-finite input", () => {
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIO);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RATIO);
  });
});

describe("parseStoredRatio", () => {
  it("returns DEFAULT for null/undefined/garbage", () => {
    expect(parseStoredRatio(null)).toBe(DEFAULT_RATIO);
    expect(parseStoredRatio(undefined)).toBe(DEFAULT_RATIO);
    expect(parseStoredRatio("not-a-number")).toBe(DEFAULT_RATIO);
  });

  it("parses and clamps a persisted string", () => {
    expect(parseStoredRatio("0.5")).toBe(0.5);
    expect(parseStoredRatio("0.05")).toBe(MIN_RATIO);
    expect(parseStoredRatio("0.95")).toBe(MAX_RATIO);
  });
});

describe("isRightTab / parseStoredTab", () => {
  it("accepts only known tab ids", () => {
    for (const t of RIGHT_TABS) expect(isRightTab(t)).toBe(true);
    expect(isRightTab("agents")).toBe(false);
    expect(isRightTab("")).toBe(false);
    expect(isRightTab(42)).toBe(false);
    expect(isRightTab(null)).toBe(false);
  });

  it("parseStoredTab falls back to board for unknown values", () => {
    expect(parseStoredTab("code")).toBe("code");
    expect(parseStoredTab("worktrees")).toBe("worktrees");
    expect(parseStoredTab(null)).toBe("board");
    expect(parseStoredTab("nope")).toBe("board");
  });
});

describe("parseStoredCollapsed", () => {
  it("is true only for exactly '1'", () => {
    expect(parseStoredCollapsed("1")).toBe(true);
    expect(parseStoredCollapsed("0")).toBe(false);
    expect(parseStoredCollapsed("true")).toBe(false);
    expect(parseStoredCollapsed(null)).toBe(false);
  });
});

describe("isTerminalCollapsed", () => {
  it("collapses when manually toggled regardless of width", () => {
    expect(isTerminalCollapsed(true, 1920)).toBe(true);
  });

  it("auto-collapses below the narrow breakpoint", () => {
    expect(isTerminalCollapsed(false, NARROW_BREAKPOINT - 1)).toBe(true);
    expect(isTerminalCollapsed(false, NARROW_BREAKPOINT)).toBe(false);
    expect(isTerminalCollapsed(false, 1440)).toBe(false);
  });
});

describe("ratioFromPointer", () => {
  it("maps pointer X within the container to a clamped fraction", () => {
    // container: left=100, width=1000 → pointer at 600 → (600-100)/1000 = 0.5
    expect(ratioFromPointer(600, 100, 1000)).toBe(0.5);
  });

  it("clamps a drag past the edges into the legal band", () => {
    expect(ratioFromPointer(100, 100, 1000)).toBe(MIN_RATIO); // frac 0
    expect(ratioFromPointer(1100, 100, 1000)).toBe(MAX_RATIO); // frac 1
  });

  it("returns DEFAULT when width is degenerate", () => {
    expect(ratioFromPointer(600, 100, 0)).toBe(DEFAULT_RATIO);
  });
});
