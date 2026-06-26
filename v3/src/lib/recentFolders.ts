/**
 * Pure helpers for the "Open Folder" recents list shown next to the FileTree
 * header button.
 *
 * The list is persisted in localStorage so a user can quickly re-open a folder
 * they browsed before. Everything here is intentionally side-effect free so the
 * merge/dedupe/sort logic can be unit-tested without a DOM; the thin
 * localStorage read/write wrappers live at the bottom and degrade to no-ops when
 * storage is unavailable.
 */

/** localStorage key holding the JSON array of recent folder paths. */
export const RECENT_FOLDERS_KEY = "marblo:recentFolders";

/** How many recent folders we keep (newest-first). */
export const MAX_RECENT_FOLDERS = 5;

/** Display label for a folder path — its basename, falling back to the path. */
export function folderLabel(path: string): string {
  // Strip trailing separators, then take the last segment. Splits on both POSIX
  // (/) and Windows (\) separators so native Windows paths don't show in full.
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed || path;
}

/**
 * Merge a newly opened folder into the existing recents list.
 *
 * - the new path moves to the front (most-recent-first)
 * - duplicates of the same path are removed (so re-opening just reorders)
 * - blank/whitespace paths are ignored (returns the list unchanged)
 * - the result is capped at `max` entries
 */
export function mergeRecentFolders(
  existing: string[],
  newPath: string,
  max: number = MAX_RECENT_FOLDERS,
): string[] {
  const path = newPath?.trim();
  if (!path) return dedupe(existing).slice(0, max);
  const rest = dedupe(existing).filter((p) => p !== path);
  return [path, ...rest].slice(0, max);
}

/** Drop duplicates while preserving first-seen order. */
function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (typeof p !== "string") continue;
    const v = p.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Parse a raw localStorage value into a clean recents list. Tolerates null,
 * malformed JSON, and non-array/non-string entries by returning a safe subset.
 */
export function parseRecentFolders(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupe(
      parsed.filter((p): p is string => typeof p === "string"),
    ).slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
}

/** Read + parse the recents list from localStorage (no-op safe). */
export function loadRecentFolders(): string[] {
  try {
    return parseRecentFolders(
      globalThis.localStorage?.getItem(RECENT_FOLDERS_KEY) ?? null,
    );
  } catch {
    return [];
  }
}

/** Merge `newPath` in, persist, and return the updated list (no-op safe). */
export function saveRecentFolder(newPath: string): string[] {
  const next = mergeRecentFolders(loadRecentFolders(), newPath);
  try {
    globalThis.localStorage?.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / unavailable storage — recents are best-effort
  }
  return next;
}
