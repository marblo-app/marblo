import { create } from "zustand";

/**
 * 지금 **사람을 기다리고 있는** 에이전트들 — 우상단 알림의 유일한 데이터원.
 *
 * 신호는 main 이 만든다(electron/agent-input-wait.ts). 이 스토어는 그 신호를
 * 화면이 쓸 모양으로 들고 있을 뿐, 판정하지 않는다.
 *
 * ★에이전트당 정확히 하나. 자료구조가 agentId 키 맵이라 중복이 "규칙" 이 아니라
 * **구조적으로 불가능**하다 — 같은 에이전트가 두 번 신호를 보내도 카드는 하나다.
 * (main 쪽도 전이(edge)에서만 쏘므로 애초에 스트림이 오지 않는다. 두 겹의 방어는
 * 의도적이다: 한쪽 규약이 깨져도 사용자 화면에 알림이 쌓이지는 않는다.)
 *
 * ★`since` 는 첫 신호의 값을 지킨다. 같은 사유로 신호가 다시 오더라도 시작 시각을
 * 갱신하면 "3분째 기다리는 중" 이 영원히 "방금" 으로 되돌아간다.
 */

export type AgentInputWaitReason = "confirm" | "prompt";

export interface AgentInputWait {
  agentId: string;
  agentName: string;
  taskId: string | null;
  reason: AgentInputWaitReason;
  /** epoch-ms — 이 기다림이 시작된 시각. */
  since: number;
}

/** main → preload 가 넘겨주는 원본 이벤트(vite-env.d.ts AgentInputWaitEventDTO). */
export interface AgentInputWaitEvent {
  agentId: string;
  agentName: string;
  projectId?: string;
  taskId: string | null;
  waiting: boolean;
  reason: AgentInputWaitReason | null;
  since: number | null;
}

interface AgentAttentionState {
  /** agentId → 기다림. 키가 곧 중복방지다. */
  waiting: Record<string, AgentInputWait>;
  /** main 이 보낸 전이 하나를 반영한다(waiting:false 는 철회). */
  apply: (event: AgentInputWaitEvent) => void;
  /**
   * 사용자가 직접 치운다(알림의 ✕, 또는 해당 터미널을 열었을 때).
   *
   * ★다시 안 뜨게 하는 래치를 따로 두지 않는다. main 이 전이에서만 쏘므로,
   * 치운 뒤 그 에이전트가 계속 같은 상태로 서 있어도 같은 알림이 되살아나지
   * 않는다. 새 신호(다른 기다림)가 생기면 그때는 뜨는 게 맞다.
   */
  dismiss: (agentId: string) => void;
  /** 프로젝트 전환 등 — 화면의 맥락이 통째로 바뀔 때. */
  clearAll: () => void;
}

export const useAgentAttentionStore = create<AgentAttentionState>(
  (set, get) => ({
    waiting: {},

    apply: (event) => {
      const { agentId } = event;
      if (!agentId) return;
      const current = get().waiting;

      // 철회 — 없던 것을 지우는 경우엔 참조를 그대로 둬서 헛 렌더를 막는다.
      if (!event.waiting || event.reason === null) {
        if (!current[agentId]) return;
        const next = { ...current };
        delete next[agentId];
        set({ waiting: next });
        return;
      }

      const prev = current[agentId];
      // 같은 에이전트·같은 사유가 다시 오면 시작 시각을 지킨다(위 주석).
      if (prev && prev.reason === event.reason) return;

      set({
        waiting: {
          ...current,
          [agentId]: {
            agentId,
            agentName: event.agentName || agentId,
            taskId: event.taskId ?? null,
            reason: event.reason,
            since: event.since ?? Date.now(),
          },
        },
      });
    },

    dismiss: (agentId) => {
      const current = get().waiting;
      if (!current[agentId]) return;
      const next = { ...current };
      delete next[agentId];
      set({ waiting: next });
    },

    clearAll: () => {
      if (Object.keys(get().waiting).length === 0) return;
      set({ waiting: {} });
    },
  }),
);

/** 화면이 그릴 목록 — 오래 기다린 순. 셀렉터로 뽑아 쓴다. */
export function selectWaitingAgents(
  state: Pick<AgentAttentionState, "waiting">,
): AgentInputWait[] {
  return Object.values(state.waiting).sort((a, b) => a.since - b.since);
}
