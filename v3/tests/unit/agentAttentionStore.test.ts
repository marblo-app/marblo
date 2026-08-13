import { describe, it, expect, beforeEach } from "vitest";
import {
  useAgentAttentionStore,
  selectWaitingAgents,
  type AgentInputWaitEvent,
} from "../../src/stores/agentAttentionStore";

/**
 * 우상단 알림의 상태 계약.
 *
 * 핵심은 "에이전트당 하나" 다. 티켓이 요구한 중복방지인데, 여기서는 규칙이
 * 아니라 자료구조로 지킨다 — 그래서 같은 에이전트가 몇 번 신호를 보내든 카드
 * 수가 늘지 않는다는 것을 직접 확인한다.
 */

function ev(over: Partial<AgentInputWaitEvent> = {}): AgentInputWaitEvent {
  return {
    agentId: "a1",
    agentName: "frontend-1",
    taskId: "t1",
    waiting: true,
    reason: "confirm",
    since: 1_000,
    ...over,
  };
}

describe("agentAttentionStore", () => {
  beforeEach(() => {
    useAgentAttentionStore.getState().clearAll();
  });

  it("기다림을 담고 목록으로 낸다", () => {
    useAgentAttentionStore.getState().apply(ev());
    const items = selectWaitingAgents(useAgentAttentionStore.getState());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      agentId: "a1",
      agentName: "frontend-1",
      reason: "confirm",
      since: 1_000,
    });
  });

  it("같은 에이전트가 몇 번을 보내도 카드는 하나다", () => {
    const s = useAgentAttentionStore.getState();
    s.apply(ev());
    s.apply(ev());
    s.apply(ev({ since: 9_999 }));
    const items = selectWaitingAgents(useAgentAttentionStore.getState());
    expect(items).toHaveLength(1);
    // 시작 시각은 첫 신호를 지킨다 — 갱신하면 "3분째 대기" 가 영영 "방금" 이 된다.
    expect(items[0].since).toBe(1_000);
  });

  it("사유가 바뀌면 카드 내용은 갱신하되 여전히 하나다", () => {
    const s = useAgentAttentionStore.getState();
    s.apply(ev({ reason: "prompt" }));
    s.apply(ev({ reason: "confirm", since: 2_000 }));
    const items = selectWaitingAgents(useAgentAttentionStore.getState());
    expect(items).toHaveLength(1);
    expect(items[0].reason).toBe("confirm");
  });

  it("에이전트가 여럿이면 각각 하나씩, 오래 기다린 순으로 낸다", () => {
    const s = useAgentAttentionStore.getState();
    s.apply(ev({ agentId: "a2", agentName: "backend-1", since: 5_000 }));
    s.apply(ev({ agentId: "a1", since: 1_000 }));
    const items = selectWaitingAgents(useAgentAttentionStore.getState());
    expect(items.map((i) => i.agentId)).toEqual(["a1", "a2"]);
  });

  it("waiting:false 는 철회다", () => {
    const s = useAgentAttentionStore.getState();
    s.apply(ev());
    s.apply(ev({ waiting: false, reason: null, since: null }));
    expect(selectWaitingAgents(useAgentAttentionStore.getState())).toHaveLength(
      0,
    );
  });

  it("없던 것을 철회해도 상태 참조가 흔들리지 않는다", () => {
    const before = useAgentAttentionStore.getState().waiting;
    useAgentAttentionStore
      .getState()
      .apply(ev({ waiting: false, reason: null }));
    expect(useAgentAttentionStore.getState().waiting).toBe(before);
  });

  it("사용자가 치우면 사라진다", () => {
    const s = useAgentAttentionStore.getState();
    s.apply(ev());
    s.dismiss("a1");
    expect(selectWaitingAgents(useAgentAttentionStore.getState())).toHaveLength(
      0,
    );
  });

  it("치운 뒤 같은 신호가 다시 와도 되살아나지 않는다는 전제(=전이만 온다)", () => {
    // main 이 전이에서만 쏘므로 치운 직후 같은 이벤트는 오지 않는다. 다만
    // 새 신호가 오면 다시 떠야 한다 — 그건 새 기다림이기 때문이다.
    const s = useAgentAttentionStore.getState();
    s.apply(ev());
    s.dismiss("a1");
    s.apply(ev({ reason: "prompt", since: 7_000 }));
    const items = selectWaitingAgents(useAgentAttentionStore.getState());
    expect(items).toHaveLength(1);
    expect(items[0].reason).toBe("prompt");
  });

  it("agentId 가 비면 무시한다", () => {
    useAgentAttentionStore.getState().apply(ev({ agentId: "" }));
    expect(selectWaitingAgents(useAgentAttentionStore.getState())).toHaveLength(
      0,
    );
  });
});
