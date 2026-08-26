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
  shouldShowLanesMissionSection,
  BOARD_MIN_WIDTH,
  BOARD_COLUMN_COUNT,
  BOARD_COLUMN_MIN_WIDTH,
  BOARD_COLUMN_GAP,
  BOARD_PADDING,
  DIVIDER_WIDTH,
  ACTIVITY_PANEL_WIDTH,
  ACTIVITY_MIN_PANEL_WIDTH,
  ACTIVITY_MAX_FRACTION,
  ACTIVITY_COLLAPSE_BREAKPOINT,
  MAX_TERMINAL_YIELD,
  WORK_VIEW_MIN_WIDTH,
  activityPanelWidth,
  ratioWithActivityOpen,
  storedRatioFromDrag,
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

  // The Project tab (members · roles · workload) answers "who is on this
  // project and what is each one carrying". It sits next to `agents` — the
  // machine fleet — so the two populations read as a pair. Before it existed
  // the three halves of that answer were scattered (invites in Settings →
  // Team, counts on the Agents dashboard, merges in History).
  it("★places Project immediately after Agents", () => {
    const agentsIndex = RIGHT_TABS.indexOf("agents");
    expect(agentsIndex).toBeGreaterThanOrEqual(0);
    expect(RIGHT_TABS[agentsIndex + 1]).toBe("project");
  });

  it("★Project is always visible — never dev-flag gated", () => {
    expect(DEV_ONLY_RIGHT_TABS.has("project")).toBe(false);
    expect(visibleRightTabs([])).toContain("project");
    // Neither neighbour is dev-gated, so the adjacency survives the
    // production filter — the bar users actually see.
    const visible = visibleRightTabs([]);
    expect(visible[visible.indexOf("agents") + 1]).toBe("project");
  });

  it("★Quick Lanes stays adjacent to Code once dev-only tabs are hidden", () => {
    // Neither `code` nor `lanes` is dev-gated, so the adjacency has to survive
    // the production filter too — the bar users actually see.
    const visible = visibleRightTabs([]);
    expect(visible[visible.indexOf("code") + 1]).toBe("lanes");
  });
});

describe("shouldShowLanesMissionSection", () => {
  it("hides the LanesTab mission summary when the missions tab is hidden", () => {
    expect(shouldShowLanesMissionSection([])).toBe(false);
    expect(shouldShowLanesMissionSection(["flows", "deploy"])).toBe(false);
  });

  it("shows the LanesTab mission summary only with the missions feature flag", () => {
    expect(shouldShowLanesMissionSection(["missions"])).toBe(true);
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

  it("stays inside the narrow band the CEO asked for (ticket PJ8Hz66n)", () => {
    // The panel is a glanceable feed, not a work surface. If a future change
    // wants it wider than this, that is a product decision, not a tweak.
    expect(ACTIVITY_PANEL_WIDTH).toBeLessThanOrEqual(280);
    expect(ACTIVITY_MIN_PANEL_WIDTH).toBeLessThanOrEqual(ACTIVITY_PANEL_WIDTH);
  });

  it("never exceeds its max fraction of the work area in the mid band", () => {
    // 900 * 0.25 = 225 — narrower than the preferred 260.
    expect(activityPanelWidth(900)).toBe(
      Math.floor(900 * ACTIVITY_MAX_FRACTION),
    );
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
  // The whole point (ticket PJ8Hz66n): opening the Activity panel takes its
  // width out of the WORK VIEW, not out of the terminal column. The terminal —
  // the pane the user is actually working in — may give up at most
  // MAX_TERMINAL_YIELD of itself, and only when the work view would otherwise
  // be starved past WORK_VIEW_MIN_WIDTH.
  function terminalPx(splitWidth: number, ratio: number): number {
    return splitWidth * ratio;
  }
  function workViewWidth(splitWidth: number, ratio: number): number {
    return splitWidth * (1 - ratio) - DIVIDER_WIDTH;
  }
  /** The terminal's pixel width before the panel docked. */
  function closedTerminalPx(workArea: number, stored: number): number {
    return workArea * stored;
  }

  it("the work-view floor is one board column plus the board's padding", () => {
    expect(WORK_VIEW_MIN_WIDTH).toBe(
      BOARD_COLUMN_MIN_WIDTH + 2 * BOARD_PADDING,
    );
    // Deliberately far below the comfortable four-column width: the board
    // scrolls, the terminal does not.
    expect(WORK_VIEW_MIN_WIDTH).toBeLessThan(BOARD_MIN_WIDTH);
  });

  it("keeps the terminal's pixel width — the panel comes out of the work view", () => {
    const workArea = 1600;
    const panel = activityPanelWidth(workArea)!;
    const splitWidth = workArea - panel;
    const r = ratioWithActivityOpen(DEFAULT_RATIO, splitWidth, panel);

    // Same pixels as before the panel docked, at a larger fraction of a
    // smaller split.
    expect(terminalPx(splitWidth, r)).toBeCloseTo(
      closedTerminalPx(workArea, DEFAULT_RATIO),
      6,
    );
    expect(r).toBeGreaterThan(DEFAULT_RATIO);
    // The work view is what absorbed the panel.
    const closedWorkView = workViewWidth(workArea, DEFAULT_RATIO);
    expect(closedWorkView - workViewWidth(splitWidth, r)).toBeCloseTo(panel, 6);
  });

  it("is the regression it exists to prevent: no 60% amputation", () => {
    // The old rule reserved BOARD_MIN_WIDTH for the work view, which cut a
    // 480px terminal down to 184px on a 1200px work area. Now it keeps 480.
    const workArea = 1200;
    const panel = activityPanelWidth(workArea)!;
    const splitWidth = workArea - panel;
    const r = ratioWithActivityOpen(DEFAULT_RATIO, splitWidth, panel);
    expect(terminalPx(splitWidth, r)).toBeCloseTo(480, 6);
  });

  it("never yields more than MAX_TERMINAL_YIELD across the realistic band", () => {
    for (let workArea = 900; workArea <= 3000; workArea += 50) {
      const panel = activityPanelWidth(workArea);
      if (panel == null) continue;
      const splitWidth = workArea - panel;
      // Below the breakpoint the column is a rail and this ratio is unused.
      if (splitWidth < NARROW_BREAKPOINT) continue;
      for (const stored of [MIN_RATIO, 0.3, DEFAULT_RATIO, 0.55, MAX_RATIO]) {
        const r = ratioWithActivityOpen(stored, splitWidth, panel);
        const closed = closedTerminalPx(workArea, stored);
        expect(terminalPx(splitWidth, r)).toBeGreaterThanOrEqual(
          closed * (1 - MAX_TERMINAL_YIELD) - 0.5,
        );
        expect(workViewWidth(splitWidth, r)).toBeGreaterThan(0);
      }
    }
  });

  it("gives ground only as far as the work-view floor needs", () => {
    // 880 split + 260 panel, stored 0.65 → the terminal wants 741px but the
    // work view floor only leaves 675px, so it yields exactly that much (8.9%)
    // — under the 10% cap, so the floor is honoured.
    const panel = 260;
    const splitWidth = 880;
    const stored = 0.65;
    const r = ratioWithActivityOpen(stored, splitWidth, panel);
    const closed = closedTerminalPx(splitWidth + panel, stored);
    expect(terminalPx(splitWidth, r)).toBeLessThan(closed);
    expect(workViewWidth(splitWidth, r)).toBeGreaterThanOrEqual(
      WORK_VIEW_MIN_WIDTH,
    );
    expect(terminalPx(splitWidth, r)).toBeGreaterThan(
      closed * (1 - MAX_TERMINAL_YIELD),
    );
  });

  it("stops at the 10% floor even when the work view is still starved", () => {
    // A 10% cap a narrow window can talk you out of is not a cap: here the
    // work view stays under its floor and the board scrolls instead.
    const panel = 260;
    const splitWidth = 900;
    const r = ratioWithActivityOpen(MAX_RATIO, splitWidth, panel);
    const closed = closedTerminalPx(splitWidth + panel, MAX_RATIO);
    expect(terminalPx(splitWidth, r)).toBeCloseTo(
      closed * (1 - MAX_TERMINAL_YIELD),
      6,
    );
    expect(workViewWidth(splitWidth, r)).toBeLessThan(WORK_VIEW_MIN_WIDTH);
    expect(workViewWidth(splitWidth, r)).toBeGreaterThan(0);
  });

  it("is a no-op when no panel is docked (closed-state geometry preserved)", () => {
    // The shell only calls this while the panel is open, but a zero panel must
    // still answer "the terminal was already this wide".
    expect(ratioWithActivityOpen(DEFAULT_RATIO, 1200, 0)).toBeCloseTo(
      DEFAULT_RATIO,
      6,
    );
    expect(ratioWithActivityOpen(MAX_RATIO, 3000, 0)).toBeCloseTo(MAX_RATIO, 6);
  });

  it("never drops below MIN_RATIO", () => {
    for (const splitWidth of [100, 600, 900, 1400, 3000]) {
      expect(
        ratioWithActivityOpen(MIN_RATIO, splitWidth, 260),
      ).toBeGreaterThanOrEqual(MIN_RATIO);
    }
  });

  it("leaves room for the divider even at absurd widths", () => {
    for (const splitWidth of [10, 100, 300]) {
      const r = ratioWithActivityOpen(MAX_RATIO, splitWidth, 260);
      expect(terminalPx(splitWidth, r)).toBeLessThanOrEqual(splitWidth);
    }
  });

  it("falls back to the clamped stored ratio when unmeasured", () => {
    expect(ratioWithActivityOpen(0.4, 0)).toBe(0.4);
    expect(ratioWithActivityOpen(0.4, Number.NaN)).toBe(0.4);
    expect(ratioWithActivityOpen(9, 0)).toBe(MAX_RATIO);
  });
});

describe("storedRatioFromDrag", () => {
  it("round-trips through ratioWithActivityOpen — no jump on release", () => {
    const panel = 260;
    const splitWidth = 1340;
    for (const pointer of [0.25, 0.35, 0.5, 0.6]) {
      const stored = storedRatioFromDrag(pointer, splitWidth, panel);
      // Where the pointer left it is where it stays once the drag ends.
      expect(ratioWithActivityOpen(stored, splitWidth, panel)).toBeCloseTo(
        pointer,
        6,
      );
    }
  });

  it("stores a fraction of the work area, not of the split", () => {
    const stored = storedRatioFromDrag(0.5, 1340, 260);
    expect(stored).toBeCloseTo((0.5 * 1340) / 1600, 6);
    expect(stored).toBeLessThan(0.5);
  });

  it("keeps the stored value inside the legal band", () => {
    for (const pointer of [-1, 0, 0.05, 0.5, 0.95, 2]) {
      const stored = storedRatioFromDrag(pointer, 1340, 260);
      expect(stored).toBeGreaterThanOrEqual(MIN_RATIO);
      expect(stored).toBeLessThanOrEqual(MAX_RATIO);
    }
  });

  it("degrades to the clamped pointer ratio when unmeasured", () => {
    expect(storedRatioFromDrag(0.4, 0, 0)).toBe(0.4);
    expect(storedRatioFromDrag(0.4, Number.NaN, 260)).toBe(0.4);
    expect(storedRatioFromDrag(9, 0, 0)).toBe(MAX_RATIO);
  });
});
