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
  initialActiveTab,
  parseStoredCollapsed,
  isRightTab,
  isTerminalCollapsed,
  ratioFromPointer,
  clampVerticalRatio,
  parseStoredVerticalRatio,
  verticalRatioFromPointer,
  visibleRightTabs,
  BOARD_MIN_WIDTH,
  BOARD_COLUMN_COUNT,
  BOARD_COLUMN_MIN_WIDTH,
  BOARD_COLUMN_GAP,
  BOARD_PADDING,
  DIVIDER_WIDTH,
  ACTIVITY_PANEL_WIDTH,
  ACTIVITY_MIN_PANEL_WIDTH,
  ACTIVITY_COLLAPSE_BREAKPOINT,
  activityPanelWidth,
  ratioWithActivityOpen,
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
    expect(isRightTab("nope")).toBe(false);
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

  // Parity guard: `agents` and `settings` were once excluded on the theory
  // that the left column / the Header overlay already covered them. Both were
  // wrong and shipped as user-visible regressions (ZdgQMxW7, 0JVQcUxd), so the
  // whole legacy TabBar set must stay reachable from the shell.
  it("covers every legacy TabBar tab", () => {
    const LEGACY_TABS = [
      "guide",
      "board",
      "lanes",
      "missions",
      "code",
      "agents",
      "usage",
      "flows",
      "deploy",
      "worktrees",
      "history",
      "store",
      "harness",
      "settings",
    ];
    for (const tab of LEGACY_TABS) {
      expect(RIGHT_TABS as readonly string[]).toContain(tab);
      expect(isRightTab(tab)).toBe(true);
    }
  });

  it("leads with the onboarding tab", () => {
    expect(RIGHT_TABS[0]).toBe("startHere");
    expect(visibleRightTabs([])[0]).toBe("startHere");
  });

  // Quick Lanes was promoted out of the tail of the bar (it used to sit after
  // `history`, six tabs deep, where it read as an archive view). The whole
  // point of the tab is to be the FAST path — spawn a parallel worker on the
  // improvement you just noticed, without leaving the file you're in — so it
  // has to sit next to `code`. Pinned here so a future tab insertion doesn't
  // quietly bury it again; if the product decision changes, change this test
  // deliberately.
  it("★places Quick Lanes immediately after Code", () => {
    const codeIndex = RIGHT_TABS.indexOf("code");
    expect(codeIndex).toBeGreaterThanOrEqual(0);
    expect(RIGHT_TABS[codeIndex + 1]).toBe("lanes");
  });

  // The Store was a section buried inside the Harness tab, under the required
  // CLI/vendor connection setup — a browsable catalog behind a settings screen.
  // It was promoted to its own tab placed immediately BEFORE Harness so the
  // pair reads as "what you must connect" → "what you may add". Pinned so a
  // future insertion doesn't split them or push Store back behind Harness.
  it("★places Store immediately before Harness", () => {
    const harnessIndex = RIGHT_TABS.indexOf("harness");
    expect(harnessIndex).toBeGreaterThan(0);
    expect(RIGHT_TABS[harnessIndex - 1]).toBe("store");
  });

  it("★Store is always visible — never dev-flag gated", () => {
    expect(DEV_ONLY_RIGHT_TABS.has("store")).toBe(false);
    expect(visibleRightTabs([])).toContain("store");
  });

  it("★Quick Lanes stays adjacent to Code once dev-only tabs are hidden", () => {
    // Neither `code` nor `lanes` is dev-gated, so the adjacency has to survive
    // the production filter too — the bar users actually see.
    const visible = visibleRightTabs([]);
    expect(visible[visible.indexOf("code") + 1]).toBe("lanes");
  });
});

describe("initialActiveTab", () => {
  it("always honors a persisted choice — no forced redirect to onboarding", () => {
    expect(initialActiveTab("code", true)).toBe("code");
    expect(initialActiveTab("board", true)).toBe("board");
    expect(initialActiveTab("startHere", false)).toBe("startHere");
  });

  it("lands a fresh, unfinished onboarding on the Start Here tab", () => {
    expect(initialActiveTab(null, true)).toBe("startHere");
    expect(initialActiveTab(undefined, true)).toBe("startHere");
    expect(initialActiveTab("bogus", true)).toBe("startHere");
  });

  it("falls back to the board once onboarding no longer wants the landing", () => {
    expect(initialActiveTab(null, false)).toBe("board");
    expect(initialActiveTab("bogus", false)).toBe("board");
  });

  it("graduates a persisted startHere to board once onboarding is complete", () => {
    expect(initialActiveTab("startHere", false, true)).toBe("board");
  });

  it("keeps a persisted startHere while onboarding is still unfinished", () => {
    expect(initialActiveTab("startHere", true, false)).toBe("startHere");
  });

  it("never touches a persisted non-startHere tab, complete or not", () => {
    expect(initialActiveTab("code", true, true)).toBe("code");
    expect(initialActiveTab("board", true, true)).toBe("board");
  });
});

describe("BOARD_MIN_WIDTH", () => {
  // Pins the constant to the board's own Tailwind classes. If KanbanColumn's
  // min-w or KanbanBoard's gap/padding changes without this constant following,
  // the shell would keep reserving the wrong width and the REVIEW column would
  // quietly slide back behind the horizontal scroll.
  it("equals the four-column minimum it claims to be", () => {
    expect(BOARD_COLUMN_COUNT).toBe(4);
    expect(
      BOARD_COLUMN_COUNT * BOARD_COLUMN_MIN_WIDTH +
        (BOARD_COLUMN_COUNT - 1) * BOARD_COLUMN_GAP +
        2 * BOARD_PADDING,
    ).toBe(BOARD_MIN_WIDTH);
  });
});

describe("activityPanelWidth", () => {
  it("returns the preferred width on a wide work area", () => {
    expect(activityPanelWidth(2400)).toBe(ACTIVITY_PANEL_WIDTH);
    expect(activityPanelWidth(1600)).toBe(ACTIVITY_PANEL_WIDTH);
  });

  it("never exceeds 30% of the work area in the mid band", () => {
    // 900 * 0.3 = 270 — narrower than the preferred 280.
    expect(activityPanelWidth(900)).toBe(270);
    expect(activityPanelWidth(900)).toBeLessThan(ACTIVITY_PANEL_WIDTH);
  });

  it("floors at the minimum panel width", () => {
    const w = activityPanelWidth(ACTIVITY_COLLAPSE_BREAKPOINT);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThanOrEqual(ACTIVITY_MIN_PANEL_WIDTH);
  });

  it("collapses to the rail below the breakpoint", () => {
    expect(activityPanelWidth(ACTIVITY_COLLAPSE_BREAKPOINT - 1)).toBeNull();
    expect(activityPanelWidth(320)).toBeNull();
  });

  it("answers the preferred width while unmeasured", () => {
    // First frame before the ResizeObserver reports — must not flash collapsed.
    expect(activityPanelWidth(0)).toBe(ACTIVITY_PANEL_WIDTH);
    expect(activityPanelWidth(-1)).toBe(ACTIVITY_PANEL_WIDTH);
    expect(activityPanelWidth(Number.NaN)).toBe(ACTIVITY_PANEL_WIDTH);
  });

  it("is monotonic in the available width", () => {
    const widths = [700, 800, 900, 1000, 1200, 1600, 2400];
    const seen = widths.map((w) => activityPanelWidth(w) ?? 0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });
});

describe("ratioWithActivityOpen", () => {
  // The whole point: the work view keeps BOARD_MIN_WIDTH so the board's four
  // columns (TODO / CLAIMED / IN PROGRESS / REVIEW) all stay on screen.
  function workViewWidth(splitWidth: number, ratio: number): number {
    return splitWidth * (1 - ratio) - DIVIDER_WIDTH;
  }

  it("leaves a ratio that already fits untouched", () => {
    // 3000 * 0.6 - 4 = 1796 ≫ 880 — no cap needed.
    expect(ratioWithActivityOpen(0.4, 3000)).toBe(0.4);
  });

  it("caps the terminal ratio so the board keeps its four columns", () => {
    // 1200 * 0.6 - 4 = 716 — 36px short of the four-column minimum, so the
    // terminal column has to give those 36px back.
    const splitWidth = 1200;
    const capped = ratioWithActivityOpen(DEFAULT_RATIO, splitWidth);
    expect(capped).toBeLessThan(DEFAULT_RATIO);
    expect(workViewWidth(splitWidth, capped)).toBeGreaterThanOrEqual(
      BOARD_MIN_WIDTH,
    );
  });

  it("preserves the board minimum across the realistic width band", () => {
    for (let splitWidth = 1000; splitWidth <= 3000; splitWidth += 100) {
      const r = ratioWithActivityOpen(MAX_RATIO, splitWidth);
      expect(workViewWidth(splitWidth, r)).toBeGreaterThanOrEqual(
        BOARD_MIN_WIDTH,
      );
    }
  });

  it("never drops below MIN_RATIO even when the board cannot fit", () => {
    // 600px of split cannot host a 752px board at any ratio — the terminal
    // column stops shrinking at MIN_RATIO and the board scrolls, exactly as it
    // already does at that width with the panel closed.
    expect(ratioWithActivityOpen(0.4, 600)).toBe(MIN_RATIO);
    expect(ratioWithActivityOpen(0.4, 100)).toBe(MIN_RATIO);
  });

  it("never widens the terminal column beyond what was stored", () => {
    for (const stored of [0.2, 0.3, 0.4, 0.55, 0.7]) {
      expect(ratioWithActivityOpen(stored, 4000)).toBeLessThanOrEqual(stored);
    }
  });

  it("falls back to the clamped stored ratio when unmeasured", () => {
    expect(ratioWithActivityOpen(0.4, 0)).toBe(0.4);
    expect(ratioWithActivityOpen(0.4, Number.NaN)).toBe(0.4);
    expect(ratioWithActivityOpen(9, 0)).toBe(MAX_RATIO);
  });
});
