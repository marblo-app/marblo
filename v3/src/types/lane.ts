import type { Agent } from "./agent";
import type { Task } from "./task";
import type { Worktree } from "./worktree";

/**
 * 퀵레인 한 건 = 티켓 + 그 티켓을 물고 있는 에이전트 + 격리 워크트리.
 *
 * 세 스토어(taskStore/agentStore/worktreeStore)에서 조인된 뷰 모델이라 별도
 * Firestore 문서가 없다. LanesTab 지역 타입이었으나 상세 드로우와 그룹핑
 * 헬퍼가 같은 모양을 받아야 해서 타입만 여기로 올렸다 — 조인 자체는 여전히
 * LanesTab 이 한 곳에서 수행한다(데이터소스 중복 없음).
 */
export interface LaneRow {
  task: Task;
  agent: Agent | null;
  worktree: Worktree | null;
}
