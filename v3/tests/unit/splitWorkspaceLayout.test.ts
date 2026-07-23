import { describe, it, expect } from "vitest";
import {
  RIGHT_TABS,
  DEV_ONLY_RIGHT_TABS,
  MIN_RATIO,
  MAX_RATIO,
  DEFAULT_RATIO,
  MIN_V_RATIO,
  MAX_V_RATIO,
  DEFAULT_V_RATIO,
  NARROW_BREAKPOINT,
  clampRatio,
  parseStoredRatio,
  parseStoredTab,
  parseStoredCollapsed,
  isRightTab,
  isTerminalCollapsed,
  ratioFromPointer,
  clampVerticalRatio,
  parseStoredVerticalRatio,
  verticalRatioFromPointer,
  visibleRightTabs,
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

describe("clampVerticalRatio", () => {
  it("clamps below MIN_V and above MAX_V", () => {
    expect(clampVerticalRatio(0)).toBe(MIN_V_RATIO);
    expect(clampVerticalRatio(-3)).toBe(MIN_V_RATIO);
    expect(clampVerticalRatio(1)).toBe(MAX_V_RATIO);
    expect(clampVerticalRatio(42)).toBe(MAX_V_RATIO);
  });

  it("passes an in-band value through and defaults to an even split", () => {
    expect(clampVerticalRatio(0.5)).toBe(0.5);
    expect(DEFAULT_V_RATIO).toBe(0.5);
  });

  it("falls back to DEFAULT_V_RATIO for non-finite input", () => {
    expect(clampVerticalRatio(Number.NaN)).toBe(DEFAULT_V_RATIO);
    expect(clampVerticalRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_V_RATIO);
  });
});

describe("parseStoredVerticalRatio", () => {
  it("returns DEFAULT_V for null/undefined/garbage", () => {
    expect(parseStoredVerticalRatio(null)).toBe(DEFAULT_V_RATIO);
    expect(parseStoredVerticalRatio(undefined)).toBe(DEFAULT_V_RATIO);
    expect(parseStoredVerticalRatio("nope")).toBe(DEFAULT_V_RATIO);
  });

  it("parses and clamps a persisted string", () => {
    expect(parseStoredVerticalRatio("0.6")).toBe(0.6);
    expect(parseStoredVerticalRatio("0.01")).toBe(MIN_V_RATIO);
    expect(parseStoredVerticalRatio("0.99")).toBe(MAX_V_RATIO);
  });
});

describe("verticalRatioFromPointer", () => {
  it("maps pointer Y within the column to a clamped fraction", () => {
    // column: top=200, height=800 → pointer at 600 → (600-200)/800 = 0.5
    expect(verticalRatioFromPointer(600, 200, 800)).toBe(0.5);
  });

  it("clamps a drag past the edges into the legal band", () => {
    expect(verticalRatioFromPointer(200, 200, 800)).toBe(MIN_V_RATIO); // frac 0
    expect(verticalRatioFromPointer(1000, 200, 800)).toBe(MAX_V_RATIO); // frac 1
  });

  it("returns DEFAULT_V when height is degenerate", () => {
    expect(verticalRatioFromPointer(600, 200, 0)).toBe(DEFAULT_V_RATIO);
  });
});

describe("visibleRightTabs", () => {
  it("hides dev-only tabs when no dev features are enabled", () => {
    const visible = visibleRightTabs([]);
    for (const t of DEV_ONLY_RIGHT_TABS) expect(visible).not.toContain(t);
    // Non-dev tabs always show.
    expect(visible).toContain("board");
    expect(visible).toContain("usage");
    expect(visible).toContain("harness");
  });

  it("surfaces a dev-only tab only when its id is enabled", () => {
    const visible = visibleRightTabs(["flows"]);
    expect(visible).toContain("flows");
    expect(visible).not.toContain("missions");
    expect(visible).not.toContain("deploy");
  });

  it("preserves RIGHT_TABS order and never invents ids", () => {
    const visible = visibleRightTabs(["missions", "flows", "deploy"]);
    expect(visible).toEqual([...RIGHT_TABS]);
  });

  it("excludes agents (terminals live in the left column)", () => {
    expect(RIGHT_TABS as readonly string[]).not.toContain("agents");
    expect(isRightTab("agents")).toBe(false);
  });
});
