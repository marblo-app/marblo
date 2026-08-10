import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent } from "../types/agent";
import type { Task } from "../types/task";

/**
 * 비기너 셸의 **상세 오버레이 선택 상태** — 어떤 티켓/에이전트를 열어 두었는가.
 *
 * ★이 훅이 따로 있는 이유는 두 가지다.
 *
 * ① **조용한 실패를 없앤다.** 종전 셸은 클릭을 `openTaskId`(문자열)로만 받아
 *    두고 `tasks.find(x => x.id === openTaskId)` 로 다시 찾았다. 그 재조회가
 *    빗나가면 — 데모/프리뷰 티켓처럼 스토어 밖에서 온 카드, 구독 재구독 사이의
 *    빈 스냅샷, 프로젝트 전환 직후 — 모달은 **아무 말 없이** 안 뜨고, 유저에게는
 *    "카드를 눌렀는데 아무 일도 안 일어난다" 만 남는다. 실제로 그 지문이 두 번
 *    보고됐고(#880, 그리고 그 뒤 프리뷰 재시연), 화면에 흔적이 없으니 재현도
 *    안 됐다. 그래서 **클릭된 티켓 객체 자체를 든다**: 스토어에 같은 id 가 있으면
 *    그 라이브 값이 이기고(구독이 갱신되면 모달도 같이 움직인다 — id 로만 들던
 *    원래 이유), 없으면 클릭 당시의 스냅샷으로 그린다. 눌렀는데 안 열리는 경우가
 *    구조적으로 사라진다.
 *
 * ② **테스트가 셸 배선을 베끼지 않게 한다.** #880 은 이 배선의 회귀 테스트를
 *    깔았지만, 그 테스트는 셸의 로직을 하네스에 **손으로 복사**했다. 그러면
 *    복사본이 맞는 한 테스트는 초록이고, 정작 셸에서만 어긋나는 결함은 못 잡는다.
 *    이제 셸과 테스트가 같은 훅을 부른다.
 *
 * 두 오버레이는 서로 **배타**다 — 겹쳐 띄우면 둘 다 z-[60] 이라 뒤엣것이 그냥
 * 가려지고, Esc 한 번이 어느 쪽을 닫는지 알 수 없다.
 */
export interface BeginnerDetailSelection {
  /** 열려 있는 티켓 상세. 라이브 스냅샷 우선, 없으면 클릭 당시의 객체. */
  openTask: Task | null;
  /** 열려 있는 에이전트 터미널의 에이전트. */
  openAgent: Agent | null;
  openTaskDetail: (task: Task) => void;
  closeTaskDetail: () => void;
  openAgentTerminal: (agent: Agent) => void;
  closeAgentTerminal: () => void;
}

export function useBeginnerDetail({
  tasks,
  agents,
  projectId,
}: {
  /** 현재 구독 스냅샷 — 라이브 갱신의 출처. */
  tasks: readonly Task[];
  agents: readonly Agent[];
  /**
   * 지금 보고 있는 프로젝트. 바뀌면 열린 상세를 닫는다 — 스냅샷 폴백이 생긴
   * 이상 "티켓이 목록에서 사라지면 모달도 닫힌다" 가 더는 저절로 성립하지 않아서,
   * 다른 프로젝트의 티켓 상세가 화면에 남는 것만은 여기서 명시적으로 끊는다.
   */
  projectId?: string;
}): BeginnerDetailSelection {
  // ★id 가 아니라 객체를 든다(위 ① 참조). 그리고 이 값은 **폴백**이지 렌더
  // 소스가 아니다 — 아래 useMemo 가 매번 라이브 목록을 먼저 본다.
  const [clickedTask, setClickedTask] = useState<Task | null>(null);
  // 에이전트는 id 로 든다. 터미널 모달은 살아 있는 PTY 세션에 붙는 창이라,
  // 목록에서 빠진 에이전트의 스냅샷을 그려 봐야 빈 껍데기다 — 종전대로 닫힌다.
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);

  const openTask = useMemo(() => {
    if (!clickedTask) return null;
    return tasks.find((x) => x.id === clickedTask.id) ?? clickedTask;
  }, [clickedTask, tasks]);

  const openAgent = useMemo(
    () =>
      openAgentId ? (agents.find((a) => a.id === openAgentId) ?? null) : null,
    [openAgentId, agents],
  );

  const openTaskDetail = useCallback((task: Task) => {
    setOpenAgentId(null);
    setClickedTask(task);
  }, []);
  const closeTaskDetail = useCallback(() => setClickedTask(null), []);

  const openAgentTerminal = useCallback((agent: Agent) => {
    setClickedTask(null);
    setOpenAgentId(agent.id);
  }, []);
  const closeAgentTerminal = useCallback(() => setOpenAgentId(null), []);

  useEffect(() => {
    setClickedTask(null);
    setOpenAgentId(null);
  }, [projectId]);

  return {
    openTask,
    openAgent,
    openTaskDetail,
    closeTaskDetail,
    openAgentTerminal,
    closeAgentTerminal,
  };
}
