import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";

/**
 * Restores the last active rootPath + project on app startup / page reload.
 * Skips restore for new windows (Cmd+Shift+N) — returns isNewWindow flag
 * so Layout can show a folder picker.
 */
export function useSessionRestore() {
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const rootPath = useEditorStore((s) => s.rootPath);
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const findByPathOrRemote = useProjectStore((s) => s.findByPathOrRemote);
  const restoredRef = useRef(false);
  const [isNewWindow, setIsNewWindow] = useState(false);

  // Listen for new window flag from main process
  useEffect(() => {
    window.electronAPI.on("window:isNew", () => {
      setIsNewWindow(true);
      restoredRef.current = true; // Skip restore
    });
    return () => {
      window.electronAPI.off("window:isNew");
    };
  }, []);

  // On startup: once projects are loaded from Firestore, restore last state
  useEffect(() => {
    if (restoredRef.current || projects.length === 0 || rootPath) return;

    const restore = async () => {
      try {
        const state = await window.electronAPI.appState.load();
        if (!state.lastRootPath) return;

        setRootPath(state.lastRootPath);

        // Folder is source of truth — find the project bound to the restored
        // folder via path+git-remote match (same lookup used by FileTree's
        // folder picker). Fall back to saved lastProjectId only when no
        // folder match exists (e.g., project without a folderPath yet).
        let target: (typeof projects)[number] | undefined;
        try {
          const remoteUrl = await window.electronAPI.fs.gitRemoteUrl(
            state.lastRootPath,
          );
          target = findByPathOrRemote(state.lastRootPath, remoteUrl);
        } catch {
          target = projects.find((p) => p.folderPath === state.lastRootPath);
        }

        if (!target && state.lastProjectId) {
          target = projects.find((p) => p.id === state.lastProjectId);
        }

        if (target && currentProject?.id !== target.id) {
          setCurrentProject(target);
        }

        console.log(
          "[SessionRestore] Restored:",
          state.lastRootPath,
          target?.id ?? null,
        );
      } catch (err) {
        console.error("[SessionRestore] Failed:", err);
      }
    };

    restoredRef.current = true;
    restore();
  }, [
    projects,
    rootPath,
    currentProject,
    setRootPath,
    setCurrentProject,
    findByPathOrRemote,
  ]);

  // Save state whenever rootPath or currentProject changes
  useEffect(() => {
    if (!rootPath && !currentProject) return;
    window.electronAPI.appState
      .save({
        ...(rootPath ? { lastRootPath: rootPath } : {}),
        ...(currentProject ? { lastProjectId: currentProject.id } : {}),
      })
      .catch(() => {});
  }, [rootPath, currentProject]);

  return { isNewWindow };
}
