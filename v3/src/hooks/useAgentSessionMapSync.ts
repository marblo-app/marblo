import { useEffect } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useAgentSessionMap } from "../stores/agentSessionMap";
import { computeSessionMapUpdates } from "../lib/sessionMapMatch";

/**
 * `agentSessionMap` 을 `terminalStore.sessions` 와 reactively 동기화한다.
 *
 * 배경: agentSessionMap.set 은 여러 spawn/attach 경로(Layout.onAgentSpawned,
 * useAgentReconnect, agentStore.restartAgent, AgentsTab.handleLaunch 등)에서
 * 각자 호출한다. 그 중 한 군데라도 빠지면 — 새로운 IPC 경로, 다른 윈도우의
 * attach broadcast, MCP-only spawn 등 — 그리드 셀의 MiniTerminal 이 fallback
 * id `agent-${id}` 로 죽은 채널을 구독해서 빈 화면이 된다.
 *
 * 이 훅은 그 빈틈을 메우는 **수렴 루프**: agents 와 sessions 가 바뀔 때마다
 * AgentListPanel 이 row 매칭에 쓰는 것과 똑같은 name-suffix 휴리스틱으로
 * (agent, session) 쌍을 찾고, sessionMap 에 그 매핑이 없거나 다르면 set 한다.
 *
 * 매칭 로직 자체는 src/lib/sessionMapMatch.ts 에 순수 함수로 분리 — vitest
 * 환경에서 firebase 체인 없이 단위 테스트 가능.
 */
export function useAgentSessionMapSync(): void {
  const agents = useAgentStore((s) => s.agents);
  const sessions = useTerminalStore((s) => s.sessions);

  useEffect(() => {
    if (agents.length === 0 || sessions.length === 0) return;
    const { map, set } = useAgentSessionMap.getState();
    const updates = computeSessionMapUpdates(agents, sessions, map);
    for (const [agentId, sessionId] of updates) set(agentId, sessionId);
  }, [agents, sessions]);
}
