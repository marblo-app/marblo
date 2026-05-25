import { useEffect, useRef, useCallback } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import * as agentService from "../services/agentService";

const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  custom: "⚪",
};

export function useAgentReconnect() {
  const agents = useAgentStore((s) => s.agents);
  const currentProject = useProjectStore((s) => s.currentProject);
  const rootPath = useEditorStore((s) => s.rootPath);
  const attachSession = useTerminalStore((s) => s.attachSession);
  const orchestratorStatus = useOrchestratorStore((s) => s.status);
  const setSession = useOrchestratorStore((s) => s.setSession);
  const setOrchestratorStatus = useOrchestratorStore((s) => s.setStatus);
  const attemptedRef = useRef(false);

  const reconnect = useCallback(async () => {
    if (!currentProject || !rootPath || agents.length === 0) return;

    try {
      const agentData = agents.map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        role: a.role,
        command: a.command,
      }));
      const results = await window.electronAPI.agent.reconnect(
        agentData,
        rootPath,
        currentProject.id
      );

      // Lazy import — agentSessionMap is only needed when we actually have
      // reconnect results, and avoids pulling sessionStorage at module load.
      const { useAgentSessionMap } = await import("../stores/agentSessionMap");
      for (const result of results) {
        if (result.reconnected && result.ptySessionId) {
          const agent = agents.find((a) => a.id === result.agentId);
          const icon = agent ? MODEL_ICONS[agent.model] || "⚪" : "⚪";
          const label = agent ? `${icon} ${agent.name}` : result.agentId;
          attachSession(result.ptySessionId, label);
          // Fleet 그리드 MiniTerminal 이 새 ptySessionId 로 IPC 채널 구독할
          // 수 있도록 매핑 갱신. 앱 재시작 후 첫 진입에서 필수.
          useAgentSessionMap
            .getState()
            .set(result.agentId, result.ptySessionId);
        } else if (result.skippedReason === "no-session") {
          // Policy change (PR #9): resumable 세션 없는 에이전트는 fresh-launch
          // 안 함 → Firestore status 가 stale 한 "working"/"idle" 이면 그리드
          // 셀에서 ▶ Start 버튼이 안 뜸 (canStart=stopped|error). UI 정합을
          // 위해 stopped 로 동기화. 이미 stopped/error 면 그대로 두고 굳이
          // write 트리거 안 함 (Firestore I/O 절감).
          const agent = agents.find((a) => a.id === result.agentId);
          if (agent && agent.status !== "stopped" && agent.status !== "error") {
            agentService
              .updateAgent(result.agentId, { status: "stopped" })
              .catch((err) => {
                console.warn(
                  "[Reconnect] status→stopped sync failed (non-fatal):",
                  err
                );
              });
          }
        }
      }

      const reconnectedCount = results.filter((r) => r.reconnected).length;
      const skippedNoSession = results.filter(
        (r) => r.skippedReason === "no-session"
      ).length;
      if (reconnectedCount > 0 || skippedNoSession > 0) {
        console.log(
          `[Reconnect] ${reconnectedCount}/${agents.length} reconnected, ${skippedNoSession} skipped (no resumable session — ▶ Start 수동)`
        );
      }
    } catch (err) {
      console.error("[Reconnect] Failed:", err);
    }
  }, [agents, currentProject, rootPath, attachSession]);

  const reconnectOrchestrator = useCallback(async () => {
    if (!currentProject || !rootPath) return;
    if (orchestratorStatus === "running" || orchestratorStatus === "starting")
      return;

    try {
      setOrchestratorStatus("starting");
      const list = await window.electronAPI.orchestratorSession.listSessions(
        rootPath
      );
      const orchSession = list.find(
        (s: { label?: string }) => s.label === "Orchestrator"
      );
      if (!orchSession) {
        setOrchestratorStatus("stopped");
        return;
      }
      const result = await window.electronAPI.orchestratorSession.launch(
        currentProject.id,
        rootPath,
        orchSession.id
      );
      if (result) {
        setSession(result.sessionId, result.ptySessionId);
        setOrchestratorStatus("running");
        console.log("[Reconnect] Orchestrator re-attached:", orchSession.id);
      }
    } catch (err) {
      console.error("[Reconnect] Orchestrator reconnect failed:", err);
      setOrchestratorStatus("error");
    }
  }, [
    currentProject,
    rootPath,
    orchestratorStatus,
    setSession,
    setOrchestratorStatus,
  ]);

  // Reset the once-per-project attempt flag when the user switches project
  // in this window. Without this, switching from Project A → B leaves
  // `attemptedRef.current = true` from the A startup, and B's agents never
  // auto-reattach to the terminal panel.
  const lastProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = currentProject?.id ?? null;
    if (lastProjectIdRef.current !== id) {
      attemptedRef.current = false;
      lastProjectIdRef.current = id;
    }
  }, [currentProject?.id]);

  // Initial / on-project-change reconnect
  useEffect(() => {
    if (
      attemptedRef.current ||
      !currentProject ||
      !rootPath ||
      agents.length === 0
    )
      return;
    attemptedRef.current = true;
    reconnect();
  }, [agents, currentProject, rootPath, reconnect]);

  // Re-reconnect on system wake from sleep
  useEffect(() => {
    const handleWake = () => {
      console.log("[Reconnect] System wake detected — attempting reconnect");
      reconnect();
      reconnectOrchestrator();
    };
    window.electronAPI.system.onWake(handleWake);
    return () => {
      window.electronAPI.system.offWake();
    };
  }, [reconnect, reconnectOrchestrator]);
}
