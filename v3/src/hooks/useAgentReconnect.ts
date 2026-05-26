import { useEffect, useRef, useCallback } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import * as agentService from "../services/agentService";
import type { AgentStatus } from "../types/agent";

const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
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

      for (const result of results) {
        if (result.reconnected && result.ptySessionId) {
          const agent = agents.find((a) => a.id === result.agentId);
          const icon = agent ? MODEL_ICONS[agent.model] || "⚪" : "⚪";
          const label = agent ? `${icon} ${agent.name}` : result.agentId;
          attachSession(result.ptySessionId, label);
          continue;
        }

        // Reconnect 실패 처리. main 의 agent:reconnect 핸들러는 후보 세션을
        // 못 찾았을 때 skippedReason: "no-session" 으로 응답한다 (PTY 도 안
        // 띄움). 이 경우 Firestore 의 status 가 종료 전 값 (idle/working) 인
        // 채 남아 사용자 입장에서는 "워커가 살아있는 듯 보이는데 사실은 죽음"
        // 처럼 보였음 → status 를 stopped 로 명시적으로 마킹해서 ▶ Start
        // 버튼을 누르게 유도.
        if (result.skippedReason === "no-session") {
          agentService
            .updateAgent(result.agentId, {
              status: "stopped" as AgentStatus,
            })
            .catch((err) => {
              console.warn(
                "[Reconnect] Failed to mark agent as stopped:",
                result.agentId,
                err
              );
            });
          continue;
        }

        // 그 외 (정의되지 않은 skippedReason / 에러) 는 안전한 디폴트로 status
        // 를 건드리지 않고 로그만 남긴다.
        console.warn(
          "[Reconnect] Agent not reconnected:",
          result.agentId,
          result.skippedReason ?? "(unknown)"
        );
      }

      const reconnectedCount = results.filter((r) => r.reconnected).length;
      if (reconnectedCount > 0) {
        console.log(
          `[Reconnect] ${reconnectedCount}/${agents.length} agents reconnected`
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
