// Pure helpers for the multi-window session that persists across restarts.
//
// The main process keeps a per-window restore record (windowRestore, keyed by
// webContents.id). persistWindowSession() snapshots it to app-state.json so a
// full restart can reopen every project window; restoreWindowSession() reads it
// back. The logic for WHICH windows belong in that snapshot lives here so it can
// be unit-tested without booting Electron.

import path from "node:path";

export interface WindowRestoreEntry {
  rootPath?: string;
  projectId?: string;
  // Detached Board/Code pop-out windows are transient sub-panels of a parent
  // window (see createDetachedWindow). They are seeded with the PARENT's
  // rootPath, so persisting them would reopen the same project as extra full
  // windows on the next launch — that was the "6 identical windows" bug.
  detached?: boolean;
}

export interface PersistedWindow {
  rootPath: string;
  projectId?: string;
}

/**
 * Select which windows belong in the persisted multi-window session.
 *
 * - Excludes detached pop-out windows (they ride on their parent project).
 * - Requires a rootPath — a window with no folder can't be restored.
 * - Dedupes by rootPath so a single project reopens at most one window, even if
 *   a stale/corrupted app-state.json already holds duplicates.
 */
export function selectPersistableWindows(
  entries: Iterable<WindowRestoreEntry | null | undefined>,
): PersistedWindow[] {
  const seen = new Set<string>();
  const out: PersistedWindow[] = [];
  for (const e of entries) {
    if (!e || e.detached) continue;
    if (!e.rootPath) continue;
    if (seen.has(e.rootPath)) continue;
    seen.add(e.rootPath);
    out.push({
      rootPath: e.rootPath,
      ...(e.projectId ? { projectId: e.projectId } : {}),
    });
  }
  return out;
}

export interface ResolvedWindow extends PersistedWindow {
  /** Set when `rootPath` is a substitute because the saved one was gone. */
  fellBackFrom?: string;
}

export interface ResolveRestoreRootsResult {
  /** Windows that can actually be opened (saved root, or a live fallback). */
  windows: ResolvedWindow[];
  /** Saved windows with no usable root — the user gets the folder picker. */
  dropped: PersistedWindow[];
}

/**
 * Drop or re-point saved windows whose rootPath no longer exists on disk.
 *
 * A window pointed at a removed git worktree (`~/.marblo/worktrees/**`) is the
 * common case since "이 워크트리 보기" started switching roots for real
 * (#476/#489): the tree gets cleaned up, the window keeps the dead path, and
 * every PTY spawned under it dies instantly with no visible error. Worse, the
 * dead path is re-persisted at quit, so it survives a restart.
 *
 * Fallback order for a dead root, most specific first:
 *   1. another surviving window on the SAME projectId — an exact main checkout
 *   2. `defaultRootPath` (app-state `lastRootPath`), if it still exists
 * Neither available → the window is dropped rather than opened on a lie.
 *
 * Pure: `exists` is injected so this is unit-testable without touching disk.
 */
export function resolveRestoreRoots(
  windows: Iterable<PersistedWindow>,
  exists: (rootPath: string) => boolean,
  opts?: { defaultRootPath?: string },
): ResolveRestoreRootsResult {
  const all = [...windows];
  const live = all.filter((w) => exists(w.rootPath));
  const fallbackDefault =
    opts?.defaultRootPath && exists(opts.defaultRootPath)
      ? opts.defaultRootPath
      : undefined;

  const out: ResolvedWindow[] = [];
  const dropped: PersistedWindow[] = [];
  const claimed = new Set<string>();

  for (const w of all) {
    if (exists(w.rootPath)) {
      if (claimed.has(w.rootPath)) continue;
      claimed.add(w.rootPath);
      out.push(w);
      continue;
    }
    const sibling = w.projectId
      ? live.find((l) => l.projectId === w.projectId)?.rootPath
      : undefined;
    const replacement = sibling ?? fallbackDefault;
    // Deduping against `claimed` matters here: several dead worktrees of one
    // project would otherwise all collapse onto the same fallback root and
    // reopen it as N identical windows.
    if (!replacement || claimed.has(replacement)) {
      dropped.push(w);
      continue;
    }
    claimed.add(replacement);
    out.push({
      rootPath: replacement,
      ...(w.projectId ? { projectId: w.projectId } : {}),
      fellBackFrom: w.rootPath,
    });
  }

  return { windows: out, dropped };
}

/**
 * True when `child` is `parent` itself or lives underneath it.
 *
 * Used to decide which open windows a `git worktree remove` just invalidated.
 * Compares resolved paths segment-wise so a sibling with a shared prefix
 * (`/wt/foo-2` vs removed `/wt/foo`) is NOT treated as a match — a plain
 * `startsWith` would wrongly evict it.
 */
export function isPathUnder(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

export interface RemovedRootScrub<K> {
  key: K;
  /** Replacement root, or undefined → this window must show the folder picker. */
  rootPath?: string;
  /** The just-deleted path this window was pointing at. */
  removedRootPath: string;
}

/**
 * Find the open windows whose rootPath a worktree removal just invalidated, and
 * pick each one's replacement root.
 *
 * This is the cause-side half of the fix. Without it, removing a worktree the
 * user is currently viewing leaves that window pointing at a deleted directory:
 * every PTY spawned under it dies instantly, and — because the window set is
 * re-snapshotted to app-state.json at quit — the dead path is persisted and
 * reopened on the next launch. Scrubbing at removal time keeps the bad path from
 * ever reaching disk. `resolveRestoreRoots` is the belt-and-braces counterpart
 * for paths that die while the app is closed.
 *
 * Replacement order matches resolveRestoreRoots: a surviving window on the same
 * projectId (its main checkout), then `defaultRootPath`. Detached pop-outs are
 * skipped — they ride on their parent window's root and are never persisted.
 *
 * Pure: `exists` is injected so this is unit-testable without touching disk.
 */
export function scrubRemovedRoots<K>(
  entries: Iterable<[K, WindowRestoreEntry]>,
  removedPaths: Iterable<string>,
  opts: { exists: (rootPath: string) => boolean; defaultRootPath?: string },
): RemovedRootScrub<K>[] {
  const removed = [...removedPaths].filter(Boolean);
  if (removed.length === 0) return [];

  const all = [...entries];
  const isDead = (rootPath: string): boolean =>
    removed.some((r) => isPathUnder(rootPath, r));
  // Survivors are the windows still usable as a fallback target.
  const live = all.filter(
    ([, e]) => e.rootPath && !isDead(e.rootPath) && opts.exists(e.rootPath),
  );
  const fallbackDefault =
    opts.defaultRootPath &&
    !isDead(opts.defaultRootPath) &&
    opts.exists(opts.defaultRootPath)
      ? opts.defaultRootPath
      : undefined;

  const out: RemovedRootScrub<K>[] = [];
  for (const [key, e] of all) {
    if (!e.rootPath || e.detached) continue;
    if (!isDead(e.rootPath)) continue;
    const sibling = e.projectId
      ? live.find(([, l]) => l.projectId === e.projectId)?.[1].rootPath
      : undefined;
    const replacement = sibling ?? fallbackDefault;
    out.push({
      key,
      ...(replacement ? { rootPath: replacement } : {}),
      removedRootPath: e.rootPath,
    });
  }
  return out;
}
