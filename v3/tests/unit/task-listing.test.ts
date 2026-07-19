import { describe, it, expect } from "vitest";
import {
  OPEN_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  isTerminalStatus,
  normalizePriority,
  compareTasksForListing,
  mergeListedTasks,
  summarizeListing,
  OPEN_FETCH_CAP,
} from "../../electron/mcp-server/task-listing";

type Row = { id: string; status: string; priority: unknown };

describe("normalizePriority", () => {
  it("passes numbers through", () => {
    expect(normalizePriority(5)).toBe(5);
    expect(normalizePriority(0)).toBe(0);
  });

  it("maps the legacy label strings found in production data", () => {
    // 3 board docs store priority as stringValue "high" rather than an integer.
    expect(normalizePriority("high")).toBe(4);
    expect(normalizePriority("HIGH")).toBe(4);
    expect(normalizePriority("urgent")).toBe(5);
    expect(normalizePriority("low")).toBe(1);
  });

  it("falls back to 0 for missing/garbage instead of producing NaN", () => {
    for (const v of [undefined, null, "", "banana", {}]) {
      expect(normalizePriority(v)).toBe(0);
    }
  });
});

describe("compareTasksForListing", () => {
  it("never returns NaN for mixed priority types", () => {
    const rows: Row[] = [
      { id: "a", status: "TODO", priority: "high" },
      { id: "b", status: "TODO", priority: 5 },
      { id: "c", status: "TODO", priority: undefined },
    ];
    for (const x of rows)
      for (const y of rows)
        expect(Number.isNaN(compareTasksForListing(x, y))).toBe(false);
  });

  it("orders open before terminal, then by descending priority", () => {
    const rows: Row[] = [
      { id: "done-hi", status: "DONE", priority: 5 },
      { id: "todo-lo", status: "TODO", priority: 0 },
      { id: "todo-hi", status: "TODO", priority: 5 },
    ];
    expect(rows.sort(compareTasksForListing).map((r) => r.id)).toEqual([
      "todo-hi",
      "todo-lo",
      "done-hi",
    ]);
  });

  it("classifies every declared status consistently", () => {
    for (const s of OPEN_TASK_STATUSES) expect(isTerminalStatus(s)).toBe(false);
    for (const s of TERMINAL_TASK_STATUSES)
      expect(isTerminalStatus(s)).toBe(true);
  });
});

describe("mergeListedTasks — the get_all_tasks membership regression", () => {
  // Mirrors the real board that surfaced the bug: 613 DONE vs 68 open, where
  // the DONE tasks hold the *highest* priorities. Under the old
  // "orderBy(priority) + limit, then sort open-first in memory" strategy the
  // fetched window was 100% DONE and not one open task was reachable at any
  // limit, because the collection is larger than Firestore's 500 max.
  const done: Row[] = Array.from({ length: 613 }, (_, i) => ({
    id: `done-${i}`,
    status: "DONE",
    priority: 5,
  }));
  const open: Row[] = Array.from({ length: 68 }, (_, i) => ({
    id: `open-${i}`,
    status: i % 4 === 0 ? "REVIEW" : "TODO",
    priority: 1,
  }));

  it("lists every open task even though completed tasks outrank them", () => {
    const merged = mergeListedTasks(open, done, 50);
    expect(merged.filter((r) => !isTerminalStatus(r.status))).toHaveLength(68);
  });

  it("spends leftover budget on completed tasks only", () => {
    const merged = mergeListedTasks(open.slice(0, 10), done, 50);
    expect(merged).toHaveLength(50);
    expect(merged.slice(0, 10).every((r) => !isTerminalStatus(r.status))).toBe(
      true,
    );
    expect(merged.slice(10).every((r) => isTerminalStatus(r.status))).toBe(
      true,
    );
  });

  it("renders no completed rows when open tasks already fill the budget", () => {
    const merged = mergeListedTasks(open, done, 50);
    expect(merged.every((r) => !isTerminalStatus(r.status))).toBe(true);
  });

  it("dedupes: the completed tail query is not status-filtered", () => {
    // The tail read reuses the (projectId, priority) index and therefore
    // re-reads open rows; they must not appear twice.
    const merged = mergeListedTasks(open.slice(0, 5), [...open, ...done], 50);
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
    expect(merged.filter((r) => !isTerminalStatus(r.status))).toHaveLength(5);
  });

  it("returns an empty list when there is nothing to show", () => {
    expect(mergeListedTasks([], [], 50)).toEqual([]);
  });
});

describe("summarizeListing — silent truncation (ticket SsHpTM43)", () => {
  // The board that still reproduced after PR#486: 57 open tickets, default
  // limit 50. Firestore's limit ran before the in-memory soft-delete/context
  // filters, so 50 fetched rows became 37 open rows and the shortfall was
  // backfilled with DONE — a full-looking board missing 20 open tickets.
  const open = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `open-${i}`,
      status: "TODO",
      priority: 1,
    }));
  const done = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `done-${i}`,
      status: "DONE",
      priority: 5,
    }));

  it("reports how many open rows the limit will hide", () => {
    const s = summarizeListing(open(57), done(457), 50);
    expect(s.openTotal).toBe(57);
    expect(s.openHidden).toBe(7);
  });

  it("never backfills completed rows while open rows are being withheld", () => {
    // This is the regression that made the bug invisible: a DONE row must never
    // occupy a slot that an unrendered open row was entitled to.
    const s = summarizeListing(open(57), done(457), 50);
    expect(s.rows.every((r) => !isTerminalStatus(r.status))).toBe(true);
  });

  it("reports nothing hidden when every open row fits", () => {
    const s = summarizeListing(open(10), done(457), 50);
    expect(s.openHidden).toBe(0);
    expect(s.openTotal).toBe(10);
    expect(s.rows).toHaveLength(50); // leftover budget goes to the DONE tail
  });

  it("counts open rows after terminal rows are excluded", () => {
    const s = summarizeListing([...open(5), ...done(3)], done(10), 50);
    expect(s.openTotal).toBe(5);
  });

  it("agrees with mergeListedTasks", () => {
    expect(summarizeListing(open(20), done(100), 50).rows).toEqual(
      mergeListedTasks(open(20), done(100), 50),
    );
  });

  it("caps the open page at Firestore's per-query maximum", () => {
    expect(OPEN_FETCH_CAP).toBe(500);
  });
});
