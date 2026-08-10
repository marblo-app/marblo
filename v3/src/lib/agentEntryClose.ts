/**
 * 에이전트/터미널 항목 "닫기(X)" 의 판정 규칙 — AgentListPanel 의 행 리스트와
 * FocusView 헤더가 공유한다.
 *
 * 닫기는 세 갈래로 갈리고, 갈래마다 **자원을 정리하는 주체가 다르다**:
 *
 *   terminal    셸 터미널. 이 창이 소유자다 → terminalStore.closeSession 이
 *               pty:kill 까지 부른다(main 의 ptyManager.kill 이 프로세스 트리
 *               시그널 + destroy + orphan master fd closeSync 를 수행).
 *   agent-live  아직 살아 있는 에이전트. PTY 소유자는 AgentManager 다 →
 *               반드시 agent-manager 초크포인트(agent:stop → agent:remove,
 *               kill_agent 와 같은 경로)로만 죽인다. 렌더러가 같은 세션에
 *               pty:kill 을 또 부르면 이미 destroy 된 pty 를 두 번 만지고
 *               (기존 create() 의 stale 가드와도) 경합한다.
 *   agent-dead  PTY 가 이미 죽은 에이전트(stopped/error). 죽일 게 없으므로
 *               문서/인메모리 엔트리 제거 + 렌더러 세션 detach 뿐이다.
 *
 * 확인 모달은 **작업 중(working/running) 에이전트에만** 붙인다. idle 이나 이미
 * 종료된 항목까지 확인을 받으면, 정리하려고 X 를 누른 사용자에게 매번 모달을
 * 되던지는 꼴이라 "닫을 방법이 없다" 의 다음 판본이 된다.
 */

export type CloseKind = "terminal" | "agent-live" | "agent-dead";

export interface ClosableEntry {
  id: string;
  isAgent: boolean;
  /** AgentRowData["status"] 와 같은 축 (working 은 패널에서 running 으로 접힌다). */
  status: string;
}

export interface ClosePlan {
  kind: CloseKind;
  /** 작업 손실 경고 모달을 먼저 띄워야 하는가. */
  needsConfirm: boolean;
}

/** PTY 가 이미 끝난 상태 — 새로 죽일 자원이 없다. */
const DEAD_STATUSES = new Set(["stopped", "error"]);
/** 사용자 작업이 진행 중이라 닫으면 손실이 생기는 상태. */
const BUSY_STATUSES = new Set(["working", "running"]);

export function closePlanFor(entry: ClosableEntry): ClosePlan {
  if (!entry.isAgent) return { kind: "terminal", needsConfirm: false };
  if (DEAD_STATUSES.has(entry.status)) {
    return { kind: "agent-dead", needsConfirm: false };
  }
  return {
    kind: "agent-live",
    needsConfirm: BUSY_STATUSES.has(entry.status),
  };
}

/**
 * 닫은 뒤 포커스가 갈 인접 항목. 다음 항목 → 없으면 이전 항목 → 마지막 하나였다면
 * null(빈 상태). VS Code 의 탭 닫기와 같은 감각이고, "닫을 때마다 목록 맨 앞으로
 * 튕긴다" 를 막는다.
 *
 * 목록에 없는 id 를 주면 null — 호출부가 이미 사라진 행을 닫는 경우다.
 */
export function neighborIdAfterClose(
  entries: readonly { id: string }[],
  closingId: string,
): string | null {
  const index = entries.findIndex((e) => e.id === closingId);
  if (index < 0) return null;
  if (index + 1 < entries.length) return entries[index + 1].id;
  if (index - 1 >= 0) return entries[index - 1].id;
  return null;
}
