import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useProjectSetup } from "./useProjectSetup";
import { useOrchestratorAutoLaunch } from "./useOrchestratorAutoLaunch";
import { useAgentReconnect } from "./useAgentReconnect";
import { useAgentSessionMapSync } from "./useAgentSessionMapSync";
import { useTerminalRestore } from "./useTerminalRestore";
import { useSessionRestore } from "./useSessionRestore";
import { useCostWriter } from "./useCostWriter";
import { usePresenceHeartbeat } from "./usePresenceHeartbeat";

/**
 * App-level lifecycle shared by the shells.
 *
 * The legacy Layout hosts all of these hooks + IPC listeners inline. The
 * Workspace shell renders INSTEAD of Layout when the flag is ON, so without
 * this the orchestrator wouldn't auto-launch, agents wouldn't reconnect, the
 * session wouldn't restore, etc. This hook re-runs that same lifecycle for the
 * shell.
 *
 * ★ Intentionally a SEPARATE copy rather than a refactor of Layout: this
 * ticket must leave the flag-OFF path (Layout) byte-for-byte unchanged. Only
 * one of {Layout, WorkspaceShell} is ever mounted per window, so there is no
 * double-registration — and because every listener here cleans up on unmount
 * (`.off()` / unsubscribe), toggling the flag tears the old shell's watchers
 * down before the new shell wires its own (UX-1 PR#476 transition pattern).
 */
export function useAppLifecycle() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const attachSession = useTerminalStore((s) => s.attachSession);
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);
  const detachAllSessions = useTerminalStore((s) => s.detachAllSessions);
  const createSession = useTerminalStore((s) => s.createSession);

  // Restore last session (rootPath + project) on startup.
  const { isNewWindow, restoreSettled } = useSessionRestore();
  const rootPath = useEditorStore((s) => s.rootPath);

  // Core lifecycle hooks (same set Layout mounts).
  useOrchestratorAutoLaunch();
  useAgentReconnect();
  useAgentSessionMapSync();
  useTerminalRestore();
  useCostWriter();
  usePresenceHeartbeat();

  const projectSetup = useProjectSetup();
  const { handleSelectDirectory } = projectSetup;

  // Register this window's current project with main so per-project events are
  // scoped to this window.
  useEffect(() => {
    window.electronAPI.window
      .registerProject(currentProject?.id ?? "")
      .catch(() => {});
  }, [currentProject?.id]);

  // On project switch, clean up window-local UI state tied to the old project.
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newId = currentProject?.id ?? null;
    const prevId = prevProjectIdRef.current;
    if (prevId !== null && prevId !== newId) {
      closeAllFiles();
      detachAllSessions().catch(() => {});
    }
    prevProjectIdRef.current = newId;
  }, [currentProject?.id, closeAllFiles, detachAllSessions]);

  // marblo:select-folder → unified folder pick (board/agents empty-state CTAs).
  useEffect(() => {
    const onSelectFolder = () => void handleSelectDirectory();
    window.addEventListener("marblo:select-folder", onSelectFolder);
    return () =>
      window.removeEventListener("marblo:select-folder", onSelectFolder);
  }, [handleSelectDirectory]);

  // terminal:new (menu) → create a terminal tab.
  useEffect(() => {
    let counter = 0;
    window.electronAPI.on("terminal:new", () => {
      counter++;
      createSession(`Terminal ${counter}`);
    });
    return () => {
      window.electronAPI.off("terminal:new");
    };
  }, [createSession]);

  // agent:needsAuth → open the CLI setup gate.
  useEffect(() => {
    window.electronAPI.on("agent:needsAuth", () => {
      window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
    });
    return () => {
      window.electronAPI.off("agent:needsAuth");
    };
  }, []);

  // agent:deleted → delete from Firestore (stop already done in main).
  useEffect(() => {
    window.electronAPI.on("agent:deleted", (data: unknown) => {
      const { agentId } = data as { agentId: string; agentName: string };
      import("../services/agentService").then(({ deleteAgent: fsDelete }) => {
        fsDelete(agentId).catch(() => {});
      });
    });
    return () => {
      window.electronAPI.off("agent:deleted");
    };
  }, []);

  // agent:spawned → auto-attach terminal, register session map, upsert doc.
  useEffect(() => {
    window.electronAPI.orchestratorSession.onAgentSpawned(async (data) => {
      attachSession(data.ptySessionId, `Agent: ${data.name}`);

      const { useAgentSessionMap } = await import("../stores/agentSessionMap");
      useAgentSessionMap.getState().set(data.agentId, data.ptySessionId);

      if (currentProject) {
        try {
          const { doc, setDoc, serverTimestamp } =
            await import("firebase/firestore");
          const { db } = await import("../lib/firebase");
          await setDoc(
            doc(db, "agents", data.agentId),
            {
              projectId: currentProject.id,
              ownerId: "orchestrator",
              name: data.name,
              model: data.model,
              // 구체 모델은 있을 때만 쓴다. undefined 를 실으면 merge 가 기존
              // 스탬프(예: MCP 층이 먼저 쓴 값)를 지울 수 있고, 모델을 핀하지
              // 않은 스폰에 빈 배지를 만들게 된다.
              ...(data.spawnedModel ? { spawnedModel: data.spawnedModel } : {}),
              role: data.role || "agent",
              status: "working",
              currentTaskId: null,
              command:
                data.model === "gpt"
                  ? "codex"
                  : data.model === "antigravity"
                    ? "agy"
                    : data.model,
              skillFile: "",
              createdAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch (err) {
          console.warn(
            "[useAppLifecycle] Firestore agent upsert failed (non-fatal):",
            err,
          );
        }
      }
    });
    return () => {
      window.electronAPI.off("agent:spawned");
    };
  }, [attachSession, currentProject]);

  return { projectSetup, isNewWindow, restoreSettled, rootPath };
}
