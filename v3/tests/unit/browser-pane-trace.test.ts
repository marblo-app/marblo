import { describe, expect, it } from "vitest";
import {
  BROWSER_PANE_TRACE_STAGES,
  type BrowserPaneTraceMarks,
  computeBrowserPaneTraceSegments,
  formatBrowserPaneTrace,
  isBrowserPaneTraceComplete,
  totalBrowserPaneTraceMs,
} from "../../electron/browser-pane-trace";

const FULL_MARKS: BrowserPaneTraceMarks = {
  attachRequestedAt: 1_000,
  viewConstructedAt: 1_010,
  loadUrlCalledAt: 1_012,
  didStartLoadingAt: 1_040,
  domReadyAt: 1_300,
  didFinishLoadAt: 1_500,
  firstVisibleAt: 1_520,
};

describe("computeBrowserPaneTraceSegments", () => {
  it("produces one delta per consecutive pair of present marks, in stage order", () => {
    expect(computeBrowserPaneTraceSegments(FULL_MARKS)).toEqual([
      { from: "attach-requested", to: "view-constructed", ms: 10 },
      { from: "view-constructed", to: "load-url-called", ms: 2 },
      { from: "load-url-called", to: "did-start-loading", ms: 28 },
      { from: "did-start-loading", to: "dom-ready", ms: 260 },
      { from: "dom-ready", to: "did-finish-load", ms: 200 },
      { from: "did-finish-load", to: "first-visible(paint-proxy)", ms: 20 },
    ]);
  });

  it("skips marks that never fired instead of producing a bogus delta", () => {
    const partial: BrowserPaneTraceMarks = {
      attachRequestedAt: 1_000,
      loadUrlCalledAt: 1_012,
      didFinishLoadAt: 1_500,
    };
    expect(computeBrowserPaneTraceSegments(partial)).toEqual([
      { from: "attach-requested", to: "load-url-called", ms: 12 },
      { from: "load-url-called", to: "did-finish-load", ms: 488 },
    ]);
  });

  it("orders by wall-clock time, not by the fixed stage list, when a mark races ahead", () => {
    // first-visible landing before did-finish-load is a real, expected race
    // (main sets bounds/visible off a separate IPC than the load events).
    const racing: BrowserPaneTraceMarks = {
      loadUrlCalledAt: 1_000,
      firstVisibleAt: 1_050,
      didFinishLoadAt: 1_200,
    };
    expect(computeBrowserPaneTraceSegments(racing)).toEqual([
      { from: "load-url-called", to: "first-visible(paint-proxy)", ms: 50 },
      { from: "first-visible(paint-proxy)", to: "did-finish-load", ms: 150 },
    ]);
  });

  it("returns no segments for zero or one mark", () => {
    expect(computeBrowserPaneTraceSegments({})).toEqual([]);
    expect(
      computeBrowserPaneTraceSegments({ attachRequestedAt: 1_000 }),
    ).toEqual([]);
  });
});

describe("totalBrowserPaneTraceMs", () => {
  it("is the span from the earliest to the latest mark", () => {
    expect(totalBrowserPaneTraceMs(FULL_MARKS)).toBe(520);
  });

  it("is 0 with fewer than two marks", () => {
    expect(totalBrowserPaneTraceMs({})).toBe(0);
    expect(totalBrowserPaneTraceMs({ attachRequestedAt: 1_000 })).toBe(0);
  });
});

describe("isBrowserPaneTraceComplete", () => {
  it("requires both did-finish-load and first-visible", () => {
    expect(isBrowserPaneTraceComplete(FULL_MARKS)).toBe(true);
    expect(isBrowserPaneTraceComplete({ didFinishLoadAt: 1_500 })).toBe(false);
    expect(isBrowserPaneTraceComplete({ firstVisibleAt: 1_500 })).toBe(false);
    expect(isBrowserPaneTraceComplete({})).toBe(false);
  });
});

describe("formatBrowserPaneTrace", () => {
  it("includes the pane id, total, and every segment", () => {
    const line = formatBrowserPaneTrace("pane-1", FULL_MARKS);
    expect(line).toContain("pane=pane-1");
    expect(line).toContain("total=520ms");
    expect(line).toContain("attach-requested→view-constructed=10ms");
    expect(line).toContain("did-finish-load→first-visible(paint-proxy)=20ms");
  });
});

describe("BROWSER_PANE_TRACE_STAGES", () => {
  it("has one entry per BrowserPaneTraceMarks field, each with a distinct label", () => {
    const keys = BROWSER_PANE_TRACE_STAGES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = BROWSER_PANE_TRACE_STAGES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
