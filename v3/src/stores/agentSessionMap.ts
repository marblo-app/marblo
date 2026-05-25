import { create } from "zustand";

/**
 * agentId → ptySessionId 매핑.
 *
 * Fleet 그리드 셀이 agent 도큐먼트만 보고 해당 PTY 출력을 미러링할 수 있도록,
 * launch / attach 시점에 매핑을 박아둔다. AgentStatusCard 가 fallback 으로
 * 쓰는 "agent-${agentId}" 결정적 id 도 동일 인터페이스로 조회 가능하게 한다.
 *
 * 영속화는 sessionStorage(reload 안전, 탭 닫으면 사라짐) — Marblo app 은 단일
 * 윈도우 흐름이라 cross-tab 동기화는 불필요.
 */

const STORAGE_KEY = "marblo.agentSessionMap.v1";

interface AgentSessionMapState {
  map: Record<string, string>;
  set: (agentId: string, sessionId: string) => void;
  remove: (agentId: string) => void;
  get: (agentId: string) => string;
  clear: () => void;
}

function readPersisted(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePersisted(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled — best-effort */
  }
}

export const useAgentSessionMap = create<AgentSessionMapState>((set, get) => ({
  map: readPersisted(),

  set: (agentId, sessionId) => {
    set((s) => {
      if (s.map[agentId] === sessionId) return s;
      const next = { ...s.map, [agentId]: sessionId };
      writePersisted(next);
      return { map: next };
    });
  },

  remove: (agentId) => {
    set((s) => {
      if (!(agentId in s.map)) return s;
      const next = { ...s.map };
      delete next[agentId];
      writePersisted(next);
      return { map: next };
    });
  },

  // Deterministic fallback matches the pattern AgentStatusCard already uses
  // when no live ptySessionId is known — keeps the grid functional even for
  // agents that haven't been claimed by this window's launch flow.
  get: (agentId) => get().map[agentId] ?? `agent-${agentId}`,

  clear: () => {
    set({ map: {} });
    writePersisted({});
  },
}));

/**
 * Non-reactive lookup for places that just need the id once (e.g. click
 * handlers). For reactive consumption use a selector via `useAgentSessionMap`.
 */
export function getSessionIdForAgent(agentId: string): string {
  return useAgentSessionMap.getState().get(agentId);
}
