/**
 * Shared logic for "comment on this code → send to the orchestrator".
 *
 * Why this module exists: the app renders diffs through TWO surfaces that are
 * not interchangeable —
 *
 *   - `components/workspace/DiffSurface` — a Monaco DiffEditor for ONE file,
 *     reading its baseline off the local filesystem (Code tab).
 *   - `components/board/DiffViewer` — a plain renderer for a pre-computed
 *     unified-diff STRING covering MANY files, used by TaskDetailModal and
 *     WorkHistoryTab (where the files may not even exist locally anymore).
 *
 * Neither can replace the other, so both keep their renderer. What was
 * genuinely duplicable — how a code selection turns into a message, and how
 * that message reaches the orchestrator — lives here and in
 * `hooks/useOrchestratorDiffComment`, so the two surfaces cannot drift.
 */

/** Which side of a unified diff a rendered line belongs to. */
export type DiffLineSide = "old" | "new" | "meta";

export interface AnnotatedDiffLine {
  text: string;
  /**
   * Line number in the real file this rendered line maps to — `new`-side for
   * additions/context, `old`-side for deletions. `null` for headers and hunk
   * markers, which have no file line of their own.
   */
  lineNo: number | null;
  side: DiffLineSide;
}

export interface DiffCommentRange {
  filePath: string;
  /** First/last real file line covered, or null when only headers were picked. */
  startLine: number | null;
  endLine: number | null;
  /** Raw diff text of the selection, already capped. */
  snippet: string[];
  truncated: boolean;
}

/** Hard cap on how much code we paste into an orchestrator message. */
export const MAX_SNIPPET_LINES = 40;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Walk one file's slice of a unified diff and attach the real file line number
 * to every content line.
 *
 * Note we deliberately do NOT special-case lines starting with `---`/`+++`
 * inside a hunk: a deleted source line whose content begins with `--` renders
 * as `---` and is a real deletion, not a header. Headers only ever appear
 * before the first `@@`, which the `inHunk` guard already covers.
 */
export function annotateDiffLines(lines: string[]): AnnotatedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  return lines.map((text): AnnotatedDiffLine => {
    const hunk = HUNK_HEADER.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { text, lineNo: null, side: "meta" };
    }
    // Everything before the first hunk is `diff --git` / `index` / `---` / `+++`.
    if (!inHunk || text === "") return { text, lineNo: null, side: "meta" };
    // "\ No newline at end of file" belongs to no line.
    if (text.startsWith("\\")) return { text, lineNo: null, side: "meta" };

    if (text.startsWith("+")) return { text, lineNo: newLine++, side: "new" };
    if (text.startsWith("-")) return { text, lineNo: oldLine++, side: "old" };

    // Context line — advances both sides; report the new-side number.
    oldLine++;
    return { text, lineNo: newLine++, side: "new" };
  });
}

/**
 * Turn a selected span of rendered diff lines into the range a comment quotes.
 * `start`/`end` are indices into `lines` and may arrive in any order.
 */
export function buildRangeFromSelection(
  filePath: string,
  lines: AnnotatedDiffLine[],
  start: number,
  end: number,
): DiffCommentRange {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(lines.length - 1, Math.max(start, end));
  const picked = lines.slice(lo, hi + 1);

  const truncated = picked.length > MAX_SNIPPET_LINES;
  const kept = truncated ? picked.slice(0, MAX_SNIPPET_LINES) : picked;

  // Line numbers come from the FULL selection, so a truncated snippet still
  // tells the orchestrator the real extent of what was highlighted.
  //
  // Report ONE side's numbering, never a mix: a selection spanning a deletion
  // and the addition replacing it would otherwise read as `file:11-12` with 11
  // an old-side line and 12 a new-side one, which points at nothing real. The
  // new side is what "this code" means to a reviewer; a pure-deletion
  // selection has no new side, so it falls back to the old numbering.
  const preferNew = picked.some((l) => l.side === "new");
  const numbered = picked.filter(
    (l) => l.lineNo !== null && l.side === (preferNew ? "new" : "old"),
  );

  return {
    filePath,
    startLine: numbered[0]?.lineNo ?? null,
    endLine: numbered[numbered.length - 1]?.lineNo ?? null,
    snippet: kept.map((l) => l.text),
    truncated,
  };
}

/** A single Monaco editor line (DiffSurface's gutter path) as a range. */
export function buildRangeFromLines(
  filePath: string,
  startLine: number,
  endLine: number,
  getLineContent: (line: number) => string,
): DiffCommentRange {
  const lo = Math.min(startLine, endLine);
  const hi = Math.max(startLine, endLine);
  const total = hi - lo + 1;
  const truncated = total > MAX_SNIPPET_LINES;
  const last = truncated ? lo + MAX_SNIPPET_LINES - 1 : hi;

  const snippet: string[] = [];
  for (let line = lo; line <= last; line++) snippet.push(getLineContent(line));

  return { filePath, startLine: lo, endLine: hi, snippet, truncated };
}

/** `path:12` for one line, `path:12-18` for a span, bare path when unknown. */
export function formatRangeLabel(range: DiffCommentRange): string {
  const { filePath, startLine, endLine } = range;
  if (startLine === null) return filePath;
  if (endLine === null || endLine === startLine)
    return `${filePath}:${startLine}`;
  return `${filePath}:${startLine}-${endLine}`;
}

/**
 * The message the orchestrator receives. The fenced `diff` block is what makes
 * the comment actionable — without the quoted code the orchestrator has no way
 * to know which code the reviewer meant.
 */
export function formatDiffComment(
  range: DiffCommentRange,
  comment: string,
): string {
  const out = [`[Code review] ${formatRangeLabel(range)}`];
  if (range.snippet.length > 0) {
    out.push("```diff", ...range.snippet, "```");
    if (range.truncated) {
      out.push(`… (snippet truncated to ${MAX_SNIPPET_LINES} lines)`);
    }
  }
  out.push("", comment.trim());
  return out.join("\n");
}
