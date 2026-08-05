/**
 * 티켓 상태 색 — **한 벌만 둔다.**
 *
 * 보드 상세(TaskDetailModal)와 감사 로그의 관리자 뷰가 같은 상태를 서로 다른
 * 색으로 칠하면, 두 화면이 같은 제품으로 안 읽힌다("FAILED 가 여기선 빨강,
 * 저기선 주황"). 팔레트를 각자 들고 있으면 그 드리프트는 시간 문제라서, 색을
 * 쓰는 쪽이 두 곳이 된 시점에 여기로 뺐다.
 *
 * 순수 상수 모듈이다(react/firebase 없음) — 감사 뷰모델과 같은 이유로, 나중에
 * 웹 관리자 콘솔이 그대로 가져다 쓸 수 있어야 한다.
 */

import type { TaskStatus } from "../types/task";

/** 상태 점/pill 배경. 보드와 감사 화면이 공유한다. */
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-gray-600",
  CLAIMED: "bg-yellow-600",
  IN_PROGRESS: "bg-blue-600",
  REVIEW: "bg-purple-600",
  BLOCKED: "bg-orange-600",
  FAILED: "bg-red-600",
  DONE: "bg-green-600",
};

/**
 * 상태 pill 의 배경. 상태를 **모르는** 경우(티켓 문서를 못 읽음)는 색을 주지
 * 않고 점선 테두리로 떨어뜨린다 — 모르는 것을 아는 척하는 색을 칠하지 않는다.
 */
export function taskStatusPillClass(status: TaskStatus | null): string {
  return status
    ? `${TASK_STATUS_COLORS[status]} text-white`
    : "border border-dashed border-gray-600 text-gray-400";
}
