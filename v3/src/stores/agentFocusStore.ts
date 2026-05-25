import { create } from "zustand";

/**
 * 하단 AgentListPanel 의 FocusView 가 어떤 row 를 보여줄지 결정하는 단일
 * source of truth. 패널 내부 단일 select(클릭) + 외부 컴포넌트(상단 Fleet
 * 그리드 등) 의 cross-panel drill-in 둘 다 같은 store 로 통일.
 *
 * 왜 store 인가:
 *   - 상단 그리드 셀이 Enter / 더블클릭 → 하단 FocusView 로 점프할 때
 *     prop drilling 없이 패널을 깊은 곳에서 제어할 수 있어야 함.
 *   - navigationStore.requestJump 는 "다른 탭으로 이동" 시맨틱이라 (Layout
 *     이 setActiveTab) 본 용도에 안 맞음. 별도 store 로 책임 분리.
 *
 * id 의미: row id — agent doc id (isAgent=true) 또는 terminal sessionId
 * (isAgent=false). AgentListPanel.rows 와 동일한 키 공간.
 */

interface AgentFocusState {
  focusedAgentId: string | null;
  setFocusedAgent: (id: string | null) => void;
  clear: () => void;
}

export const useAgentFocusStore = create<AgentFocusState>((set) => ({
  focusedAgentId: null,
  setFocusedAgent: (id) => set({ focusedAgentId: id }),
  clear: () => set({ focusedAgentId: null }),
}));
