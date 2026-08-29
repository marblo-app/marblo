/**
 * Pure decision logic for restoring a window's last folder/project.
 *
 * A window can lose its in-memory state when its renderer reloads — most
 * commonly after a macOS sleep/wake where Chromium discards a background
 * window's renderer process. The main process survives sleep/wake and keeps a
 * per-window restore record (keyed by webContents.id, which is stable across a
 * reload), so on startup the renderer asks main "what did this window have?"
 * before deciding what to show.
 *
 * Precedence:
 *  1. Per-window state (main, survives reload) — window-specific, so it wins.
 *     Applies to ANY window (primary or "new window") → reconnect after wake.
 *  2. A freshly-opened "new window" (Cmd+Shift+N) with no saved state → folder
 *     picker, no restore. This is the intentional new-window behavior.
 *  3. Primary window's first launch → fall back to the global app-state.json
 *     (single slot — only adequate for cold start, not multi-window).
 */
export interface PerWindowRestore {
  uid?: string;
  rootPath?: string;
  projectId?: string;
}

export interface GlobalRestore {
  uid?: string;
  lastRootPath?: string;
  lastProjectId?: string;
}

export interface RestoreSource {
  /** Folder to reopen. Absent → show the new-window folder picker / no restore. */
  rootPath?: string;
  /** Project id hint, used only when the folder can't resolve a project. */
  projectId?: string;
}

export function resolveRestoreSource(input: {
  perWindow: PerWindowRestore;
  isNewWindow: boolean;
  global: GlobalRestore;
  currentUid?: string | null;
}): RestoreSource {
  const { perWindow, isNewWindow, global, currentUid } = input;
  const ownsCurrentAccount = (uid: string | undefined): boolean =>
    currentUid === undefined || uid === currentUid;

  // 1. Per-window state survives a sleep/wake renderer reload. Window-specific,
  //    so it takes precedence over the global single-slot app-state.
  if (perWindow.rootPath && ownsCurrentAccount(perWindow.uid)) {
    return { rootPath: perWindow.rootPath, projectId: perWindow.projectId };
  }

  // 2. Fresh "new window" with nothing saved → folder picker (no restore).
  if (isNewWindow) {
    return {};
  }

  // 3. Primary window cold start → global app-state.
  if (global.lastRootPath && ownsCurrentAccount(global.uid)) {
    return {
      rootPath: global.lastRootPath,
      projectId: ownsCurrentAccount(perWindow.uid)
        ? perWindow.projectId ?? global.lastProjectId
        : global.lastProjectId,
    };
  }

  return {};
}
