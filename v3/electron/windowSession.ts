// Pure helpers for the multi-window session that persists across restarts.
//
// The main process keeps a per-window restore record (windowRestore, keyed by
// webContents.id). persistWindowSession() snapshots it to app-state.json so a
// full restart can reopen every project window; restoreWindowSession() reads it
// back. The logic for WHICH windows belong in that snapshot lives here so it can
// be unit-tested without booting Electron.

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
