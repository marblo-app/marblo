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
  // 시도된 agent id 를 set 으로 추적. 이전엔 boolean 1회 가드였는데, Firestore
  // onSnapshot 의 partial-snapshot race 때문에 agents.length=1 일 때 reconnect 가
  // 발화하고 attemptedRef 가 true 로 잠겨버려서, 그 이후 snapshot 으로 들어오는
  // 추가 agents 가 영영 reconnect 시도되지 않는 버그가 있었다 (UI 는 "러닝"
  // stale, 들어가면 PTY 빈 셀). per-agent set 으로 바꿔서 새 agent 가 추가될
  // 때마다 그 agent 만 reconnect 시도.
  const attemptedAgentIdsRef = useRef<Set<string>>(new Set());

  const reconnect = useCallback(
    async (targetAgents?: typeof agents) => {
      if (!currentProject || !rootPath) return;
      const list = targetAgents ?? agents;
      if (list.length === 0) return;

      try {
        const agentData = list.map((a) => ({
          id: a.id,
          name: a.name,
          model: a.model,
          role: a.role,
          command: a.command,
        }));
        const results = await window.electronAPI.agent.reconnect(
          agentData,
          rootPath,
          currentProject.id,
        );

        for (const result of results) {
          if (result.reconnected && result.ptySessionId) {
            const agent = agents.find((a) => a.id === result.agentId);
            const icon = agent ? MODEL_ICONS[agent.model] || "⚪" : "⚪";
            const label = agent ? `${icon} ${agent.name}` : result.agentId;
            attachSession(result.ptySessionId, label);
            continue;
          }

          // main 메모리에 PTY 가 이미 살아있는 경우 (renderer 만 reload 된
          // 시나리오). reconnected:false 지만 ptySessionId 가 넘어오므로
          // 기존 터미널에 다시 attach 한다. 이걸 안 하면 워커 셀이 빈 채로
          // 보여 "끊긴 것처럼" 느껴짐.
          if (
            result.skippedReason === "already-running" &&
            result.ptySessionId
          ) {
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
                  err,
                );
              });
            continue;
          }

          // 그 외 (정의되지 않은 skippedReason / 에러) 는 안전한 디폴트로 status
          // 를 건드리지 않고 로그만 남긴다.
          console.warn(
            "[Reconnect] Agent not reconnected:",
            result.agentId,
            result.skippedReason ?? "(unknown)",
          );
        }

        const reconnectedCount = results.filter((r) => r.reconnected).length;
        if (reconnectedCount > 0) {
          // 분모는 이번에 시도한 배치 크기 (list.length). 전체 agents.length 대신
          // 이걸 써야 partial-snapshot 으로 여러 번 호출돼도 각 호출이 정직히
          // "이번 배치에서 N/M" 형태로 표시된다.
          console.log(
            `[Reconnect] ${reconnectedCount}/${list.length} agents reconnected`,
          );
        }
      } catch (err) {
        console.error("[Reconnect] Failed:", err);
      }
    },
    [agents, currentProject, rootPath, attachSession],
  );

  const reconnectOrchestrator = useCallback(async () => {
    if (!currentProject || !rootPath) return;
    if (orchestratorStatus === "running" || orchestratorStatus === "starting")
      return;

    try {
      setOrchestratorStatus("starting");
      // Resolve via label OR content signature so wake-reconnect works even
      // without a labels file (the common case).
      const priorId =
        await window.electronAPI.orchestratorSession.resolvePrevious(rootPath);
      if (!priorId) {
        setOrchestratorStatus("stopped");
        return;
      }
      const result = await window.electronAPI.orchestratorSession.launch(
        currentProject.id,
        rootPath,
        priorId,
      );
      if (result) {
        setSession(result.sessionId, result.ptySessionId);
        setOrchestratorStatus("running");
        console.log("[Reconnect] Orchestrator re-attached:", priorId);
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

  // 프로젝트 전환 시 attempted set 을 비운다. A → B 로 옮기면 A 시점에 시도된
  // agentId 들은 B 에선 무의미하고, B 의 agents 가 처음 들어왔을 때 다시
  // reconnect 시도해야 한다.
  const lastProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = currentProject?.id ?? null;
    if (lastProjectIdRef.current !== id) {
      attemptedAgentIdsRef.current = new Set();
      lastProjectIdRef.current = id;
    }
  }, [currentProject?.id]);

  // Initial / on-agents-change reconnect: 시도된 적 없는 agent 만 골라서
  // 그 배치로 reconnect 호출. Firestore onSnapshot 의 partial-snapshot 으로
  // agents 가 [a] → [a,b,c] 순차 도착해도 a 는 1차에, b·c 는 2차에 처리됨.
  useEffect(() => {
    if (!currentProject || !rootPath || agents.length === 0) return;
    const pending = agents.filter(
      (a) => !attemptedAgentIdsRef.current.has(a.id),
    );
    if (pending.length === 0) return;
    for (const a of pending) attemptedAgentIdsRef.current.add(a.id);
    reconnect(pending);
  }, [agents, currentProject, rootPath, reconnect]);

  // Re-reconnect on system wake from sleep. Wake 시점엔 모든 agent 를 재시도
  // 해야 하므로 attempted set 을 비우고 다음 effect 가 처음부터 처리하도록
  // 둔다. (effect 의존성에 agents 가 있어 set 비우면 자동 재발화)
  useEffect(() => {
    const handleWake = () => {
      console.log("[Reconnect] System wake detected — attempting reconnect");
      attemptedAgentIdsRef.current = new Set();
      reconnect();
      reconnectOrchestrator();
    };
    window.electronAPI.system.onWake(handleWake);
    return () => {
      window.electronAPI.system.offWake();
    };
  }, [reconnect, reconnectOrchestrator]);
}
