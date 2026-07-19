/**
 * Task listing order/completeness policy (pure module — no firebase import, so it
 * unit-tests in isolation).
 *
 * BUG (this module's reason to exist): get_all_tasks used to bound its read with
 * a single `orderBy("priority","desc") + limit(N)` query and then apply the
 * "open tasks first" rule as an in-memory sort. That is a **membership** bug, not
 * an ordering one: Firestore truncates by priority BEFORE the open-first sort can
 * run, so on a board with 613 DONE vs 68 open tasks the priority window is
 * consumed almost entirely by completed tasks and today's open tickets never
 * enter the result at all. Raising `limit` cannot fix it — the collection (690
 * docs) is larger than the 500 max.
 *
 * The fix is to make openness a QUERY predicate instead of a sort key: fetch open
 * tasks with `status in OPEN_TASK_STATUSES` (a small, bounded set — 68 of 690
 * here), then spend any leftover row budget on completed tasks as a tail.
 */

/**
 * How many open rows the Firestore page may read, independent of the caller's
 * `limit`.
 *
 * PR#486 made openness a query predicate but still bounded that query with the
 * caller's `rowLimit`. Firestore applies `limit` BEFORE the in-memory predicates
 * `get_all_tasks` still has to run (soft-delete, `contextId` scope), so the row
 * budget was spent on rows that were then thrown away — the *same* membership
 * bug one layer down. Measured on board evx9sK8lc6OX3vYEP4Ld (2026-07-19): 57
 * open tickets, `limit` default 50 → Firestore returned 50, the in-memory
 * filters cut them to 37, and the 13-row shortfall was backfilled with DONE
 * rows. The caller saw a full-looking 50-row board that was missing 20 open
 * tickets with no indication anything had been dropped.
 *
 * Fetching the whole open set instead is both correct and cheap: the set is
 * small and bounded by definition (57 of ~1000 docs here), and it is the only
 * way the priority sort can be meaningful — sorting an arbitrary Firestore page
 * of 50 unordered open docs never yielded "the top 50 by priority" either.
 * 500 is Firestore's per-query maximum.
 */
export const OPEN_FETCH_CAP = 500;

/** Statuses that are still actionable. Complement of TERMINAL_TASK_STATUSES. */
export const OPEN_TASK_STATUSES = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
] as const;

/** Statuses that close a task. `get_all_tasks` renders these at the tail. */
export const TERMINAL_TASK_STATUSES = ["DONE", "FAILED"] as const;

export function isTerminalStatus(s: unknown): boolean {
  return s === "DONE" || s === "FAILED";
}

/**
 * Priority as a comparable number.
 *
 * Real board data has mixed types: 687 docs store an integer 0-5 but 3 legacy
 * docs store the string "high". Two things broke on those:
 *  - Firestore orders by type first, so in a DESC scan every string sorts AHEAD
 *    of every number and steals rows from the window.
 *  - The old in-memory comparator `(b.priority ?? 0) - (a.priority ?? 0)`
 *    evaluates to NaN for a string, and a comparator returning NaN leaves the
 *    surrounding run in an unspecified order.
 * Mapping the known string labels onto the numeric scale makes both paths total.
 */
const PRIORITY_LABELS: Record<string, number> = {
  urgent: 5,
  critical: 5,
  high: 4,
  medium: 3,
  normal: 3,
  low: 1,
  none: 0,
};

export function normalizePriority(p: unknown): number {
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (typeof p === "string") {
    const label = PRIORITY_LABELS[p.trim().toLowerCase()];
    if (label !== undefined) return label;
    const n = Number(p);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Open tasks first; within a group, priority descending. Total and stable. */
export function compareTasksForListing(
  a: { status?: unknown; priority?: unknown },
  b: { status?: unknown; priority?: unknown },
): number {
  const ta = isTerminalStatus(a.status) ? 1 : 0;
  const tb = isTerminalStatus(b.status) ? 1 : 0;
  if (ta !== tb) return ta - tb;
  return normalizePriority(b.priority) - normalizePriority(a.priority);
}

/**
 * Merge the open-task page and the completed-task tail into one bounded list.
 *
 * Open rows are never dropped in favour of a completed row: completed tasks only
 * consume the budget left over after every open task has a slot. Dedupes by id
 * because the completed-tail query is not status-filtered (it reuses the existing
 * `(projectId, priority)` composite index rather than requiring a new one).
 */
export function mergeListedTasks<T extends { id: string; status?: unknown }>(
  openDocs: T[],
  terminalDocs: T[],
  rowLimit: number,
): T[] {
  return summarizeListing(openDocs, terminalDocs, rowLimit).rows;
}

/** `mergeListedTasks` plus the counts needed to describe what was withheld. */
export interface ListingSummary<T> {
  /** Open rows (all of them) followed by whatever completed tail fits. */
  rows: T[];
  /** Open rows that exist after filtering — may exceed `rowLimit`. */
  openTotal: number;
  /** Open rows the caller's `rowLimit` will hide when `rows` is rendered. */
  openHidden: number;
}

/**
 * Same merge as `mergeListedTasks`, but also reports how many open rows the
 * caller's limit will hide.
 *
 * Silent truncation is what made this bug invisible for a week: a short board
 * and a truncated board looked identical, so the orchestrator treated a partial
 * list as the whole board. Callers render the count so "there is more" is
 * always stated rather than inferred.
 */
export function summarizeListing<T extends { id: string; status?: unknown }>(
  openDocs: T[],
  terminalDocs: T[],
  rowLimit: number,
): ListingSummary<T> {
  const open = openDocs.filter((t) => !isTerminalStatus(t.status));
  const seen = new Set(open.map((t) => t.id));
  const tail = terminalDocs.filter(
    (t) => isTerminalStatus(t.status) && !seen.has(t.id),
  );
  const room = Math.max(0, rowLimit - open.length);
  return {
    rows: [
      ...open.sort(compareTasksForListing),
      ...tail.sort(compareTasksForListing).slice(0, room),
    ],
    openTotal: open.length,
    openHidden: Math.max(0, open.length - rowLimit),
  };
}
