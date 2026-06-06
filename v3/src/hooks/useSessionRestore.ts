import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import {
  resolveRestoreSource,
  type RestoreSource,
  type PerWindowRestore,
  type GlobalRestore,
} from "../lib/sessionRestore";

/**
 * Restores the last active rootPath + project on app startup / renderer reload.
 *
 * The hard case is a renderer reload — macOS sleep/wake can discard a
 * background window's renderer, and on wake Chromium reloads it with fresh
 * (empty) in-memory state. We must reconnect EACH window to the project it had,
 * not just the primary one. The main process survives sleep/wake and keeps a
 * per-window record (keyed by webContents.id), so we ask it first.
 *
 * Precedence (see resolveRestoreSource):
 *  1. Per-window state from main → reconnect (works for new windows too).
 *  2. Fresh "new window" (Cmd+Shift+N) with nothing saved → folder picker.
 *  3. Primary window cold start → global app-state.json.
 *
 * `restoreSettled` lets Layout hold off the new-window folder picker until we
 * know whether this is a fresh new window or one reconnecting after wake — so a
 * woken window doesn't flash the picker before its project comes back.
 */
export function useSessionRestore() {
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const rootPath = useEditorStore((s) => s.rootPath);
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const clearCurrentProject = useProjectStore((s) => s.clearCurrentProject);
  const findByPathOrRemote = useProjectStore((s) => s.findByPathOrRemote);

  const [isNewWindow, setIsNewWindow] = useState(() =>
    window.electronAPI.window.isNewWindow(),
  );
  const [restoreSettled, setRestoreSettled] = useState(false);
  const [restoreSource, setRestoreSource] = useState<RestoreSource | null>(
    null,
  );
  const phase1StartedRef = useRef(false);
  const projectResolvedRef = useRef(false);

  // Legacy backup: main can flag a window as "new" at runtime. The argv-based
  // flag (read above) is authoritative, so this just keeps older builds honest.
  useEffect(() => {
    window.electronAPI.on("window:isNew", () => setIsNewWindow(true));
    return () => {
      window.electronAPI.off("window:isNew");
    };
  }, []);

  // Phase 1 — figure out the restore SOURCE (which folder/project this window
  // should reopen) as early as possible, independent of Firestore loading. This
  // is what decides folder-picker vs reconnect for a new window.
  useEffect(() => {
    if (phase1StartedRef.current) return;
    phase1StartedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        // Per-window state survives a sleep/wake reload (kept in main).
        const perWindow: PerWindowRestore =
          (await window.electronAPI.window
            .getRestoreState()
            .catch(() => ({}))) ?? {};

        // Global app-state is only a cold-start fallback for the primary
        // window — skip the read when it can't apply.
        const global: GlobalRestore =
          perWindow.rootPath || isNewWindow
            ? {}
            : await window.electronAPI.appState.load().catch(() => ({}));

        const source = resolveRestoreSource({ perWindow, isNewWindow, global });
        if (cancelled) return;

        setRestoreSource(source);
        if (source.rootPath) {
          // Setting rootPath drops Layout's folder-picker branch immediately.
          if (!rootPath) setRootPath(source.rootPath);
        } else if (isNewWindow) {
          // Truly fresh new window → folder picker, no project.
          clearCurrentProject();
        }
      } finally {
        if (!cancelled) setRestoreSettled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // rootPath is read but guarded by phase1StartedRef; deps kept minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewWindow]);

  // Phase 2 — once projects are loaded and we have a source folder, resolve it
  // to a project. Folder is the source of truth (path + git-remote match);
  // fall back to the saved projectId only when no folder match exists.
  useEffect(() => {
    if (projectResolvedRef.current) return;
    if (!restoreSource?.rootPath || projects.length === 0) return;
    projectResolvedRef.current = true;

    const restoreRoot = restoreSource.rootPath;
    (async () => {
      try {
        let target: (typeof projects)[number] | undefined;
        try {
          const remoteUrl =
            await window.electronAPI.fs.gitRemoteUrl(restoreRoot);
          target = findByPathOrRemote(restoreRoot, remoteUrl);
        } catch {
          target = projects.find((p) => p.folderPath === restoreRoot);
        }

        if (!target && restoreSource.projectId) {
          target = projects.find((p) => p.id === restoreSource.projectId);
        }

        if (target && currentProject?.id !== target.id) {
          setCurrentProject(target);
        }

        console.log(
          "[SessionRestore] Restored:",
          restoreRoot,
          target?.id ?? null,
        );
      } catch (err) {
        console.error("[SessionRestore] Failed:", err);
      }
    })();
  }, [
    restoreSource,
    projects,
    currentProject,
    setCurrentProject,
    findByPathOrRemote,
  ]);

  // Persist this window's rootPath + project in main (per-window, survives a
  // reload). Mirrors the global appState.save below but keyed by webContents.id
  // so multiple open windows each reconnect to their OWN project after wake.
  // Skips empty values so a transient null on reload never wipes the record.
  useEffect(() => {
    if (!rootPath && !currentProject) return;
    window.electronAPI.window
      .registerRestore({
        ...(rootPath ? { rootPath } : {}),
        ...(currentProject ? { projectId: currentProject.id } : {}),
      })
      .catch(() => {});
  }, [rootPath, currentProject]);

  // Save state whenever rootPath or currentProject changes (global app-state —
  // the primary window's cold-start fallback).
  useEffect(() => {
    if (!rootPath && !currentProject) return;
    window.electronAPI.appState
      .save({
        ...(rootPath ? { lastRootPath: rootPath } : {}),
        ...(currentProject ? { lastProjectId: currentProject.id } : {}),
      })
      .catch(() => {});
  }, [rootPath, currentProject]);

  return { isNewWindow, restoreSettled };
}
