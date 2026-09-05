/**
 * Latency instrumentation for the Web-tab open path (ticket r70lKKYAN8syX9sLpcFj:
 * "웹탭도 너무 오래 걸린다" — measure before optimizing).
 *
 * Pure by design so the segment math is unit-testable without booting
 * Electron. `main.ts` owns the *when* (which IPC handler / webContents event
 * fired); this module only owns the *arithmetic* (turn a bag of epoch-ms
 * marks into ordered, human-readable deltas).
 *
 * Boundary coverage: this starts at "attach requested" (the renderer mounted
 * the pane and asked main to create/attach the native view), not at the
 * original link click. The click → openUrl delivery path is owned by
 * `BrowserPaneOpenUrlDelivery` in `in-app-browser-policy.ts` (recently
 * changed by #1413) and threading a click timestamp through its `{ url,
 * requestId }` wire payload would mean editing that contract — deliberately
 * left alone here. "링크 클릭 → 탭 생성" is a fixed, small React-effect-
 * scheduling cost (see openLinkInWebTab.ts) and is not where the ticket's
 * complaint points.
 *
 * "첫 페인트" has no direct Electron signal for an on-screen WebContentsView
 * (Chromium only exposes a `paint` event for offscreen rendering). We use
 * `firstVisibleAt` — the first time the view is actually handed non-zero
 * bounds and `setVisible(true)` — combined with `didFinishLoadAt` as the
 * documented proxy: paint can only happen once both are true.
 */

export interface BrowserPaneTraceMarks {
  attachRequestedAt?: number;
  viewConstructedAt?: number;
  loadUrlCalledAt?: number;
  didStartLoadingAt?: number;
  domReadyAt?: number;
  didFinishLoadAt?: number;
  firstVisibleAt?: number;
}

interface BrowserPaneTraceStage {
  key: keyof BrowserPaneTraceMarks;
  label: string;
}

/** Fixed emission order — NOT the order marks necessarily arrive in
 * (`firstVisibleAt` and `didFinishLoadAt` race each other in practice). */
export const BROWSER_PANE_TRACE_STAGES: readonly BrowserPaneTraceStage[] = [
  { key: "attachRequestedAt", label: "attach-requested" },
  { key: "viewConstructedAt", label: "view-constructed" },
  { key: "loadUrlCalledAt", label: "load-url-called" },
  { key: "didStartLoadingAt", label: "did-start-loading" },
  { key: "domReadyAt", label: "dom-ready" },
  { key: "didFinishLoadAt", label: "did-finish-load" },
  { key: "firstVisibleAt", label: "first-visible(paint-proxy)" },
];

export interface BrowserPaneTraceSegment {
  from: string;
  to: string;
  ms: number;
}

/**
 * A pane's initial-load trace is "complete" once we have both signals a real
 * paint could depend on: the document finished loading, and the native view
 * was actually made visible with real bounds at least once. Either can land
 * first.
 */
export function isBrowserPaneTraceComplete(
  marks: BrowserPaneTraceMarks,
): boolean {
  return (
    typeof marks.didFinishLoadAt === "number" &&
    typeof marks.firstVisibleAt === "number"
  );
}

/**
 * Orders whichever marks are present by wall-clock time (not by the fixed
 * stage list — a mark that fires out of the "expected" order, e.g. the view
 * becoming visible before the page finishes loading, must still produce a
 * correctly-signed delta) and returns the consecutive deltas between them.
 */
export function computeBrowserPaneTraceSegments(
  marks: BrowserPaneTraceMarks,
): BrowserPaneTraceSegment[] {
  const present = BROWSER_PANE_TRACE_STAGES.filter(
    (stage) => typeof marks[stage.key] === "number",
  )
    .map((stage) => ({ stage, at: marks[stage.key] as number }))
    .sort((a, b) => a.at - b.at);

  const segments: BrowserPaneTraceSegment[] = [];
  for (let i = 1; i < present.length; i++) {
    const prev = present[i - 1];
    const curr = present[i];
    segments.push({
      from: prev.stage.label,
      to: curr.stage.label,
      ms: curr.at - prev.at,
    });
  }
  return segments;
}

/** Total elapsed time from the first mark recorded to the last. */
export function totalBrowserPaneTraceMs(marks: BrowserPaneTraceMarks): number {
  const values = BROWSER_PANE_TRACE_STAGES.map(
    (stage) => marks[stage.key],
  ).filter((v): v is number => typeof v === "number");
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

/** One console-friendly line: `attach-requested→view-constructed=3ms ...`. */
export function formatBrowserPaneTrace(
  paneId: string,
  marks: BrowserPaneTraceMarks,
): string {
  const segments = computeBrowserPaneTraceSegments(marks);
  const totalMs = totalBrowserPaneTraceMs(marks);
  const parts = segments.map((s) => `${s.from}→${s.to}=${s.ms}ms`);
  return `[BrowserPaneTrace] pane=${paneId} total=${totalMs}ms ${parts.join(" ")}`;
}
