import type { Task } from "../types/task";

/**
 * 보드 컬럼 정렬 — 지금은 완료(DONE) 컬럼만 다룬다.
 *
 * ★다른 컬럼은 건드리지 않는다. 스토어가 넘기는 순서(taskService.subscribeToTasks
 * 의 priority 내림차순)가 곧 "무엇부터 볼 것인가" 라서 진행 중 컬럼의 순서는 이미
 * 의미가 있다. 완료 컬럼만 "방금 끝난 게 어디 있나" 가 질문이라 시간축으로 간다.
 */

/**
 * 완료 시각. `completedAt` 이 정본이고, 그 필드가 생기기 전에 완료된 티켓은
 * `updatedAt` 으로 폴백한다(백필하지 않는다 — types/task.ts 주석). 둘 다 없거나
 * 깨진 값이면 0 — 맨 아래로 간다.
 */
export function completedAtOf(
  task: Pick<Task, "completedAt" | "updatedAt">,
): number {
  const at = toMillis(task.completedAt) ?? toMillis(task.updatedAt);
  return at ?? 0;
}

function toMillis(value: Date | null | undefined): number | null {
  if (!value) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 완료 컬럼 순서: 최근 완료가 위. 같은 시각이면 입력 순서를 유지한다(안정 정렬) —
 * 폴백 시각이 우연히 같은 옛 티켓끼리 렌더마다 자리를 바꾸지 않게.
 * 입력 배열은 바꾸지 않는다.
 */
export function sortDoneTasks<
  T extends Pick<Task, "completedAt" | "updatedAt">,
>(tasks: readonly T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index, at: completedAtOf(task) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((entry) => entry.task);
}
