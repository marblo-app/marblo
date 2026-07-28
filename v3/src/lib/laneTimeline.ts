import type { Activity } from "../types/activity";
import type { Task, TaskStatus } from "../types/task";

/**
 * 레인 상세 드로우의 **히스토리** — 활동로그 + 상태전이를 한 줄기로 병합한다.
 *
 * ── 왜 "전이 로그"를 읽지 않고 파생하나 ──────────────────────────────────────
 * 태스크 상태 전이는 per-task 로 저장되는 곳이 없다. 확인한 사실:
 *   · services/taskService.updateTaskStatus → telemetry.taskStatusChanged (BQ)
 *   · electron/mcp-server/tools.ts update_task_status → applyProjection 이
 *     tasks/{id} 를 덮어쓰고, 감사 흔적은 project 스코프 `audit_logs` 에만 남는다
 *     (taskId 는 params 안, 최근 100행 캡 — 오래된 레인은 조용히 비어 보인다).
 * 그래서 audit_logs 를 taskId 로 걸러 "전이 이력"인 척 보여주면 캡을 넘긴 순간
 * **거짓으로 빈 이력**이 된다. 대신 task doc 이 확실히 아는 것만 마커로 세운다:
 * 생성(createdAt) → 선점(claimedAt/claimedBy) → 현재 상태(updatedAt/status).
 * 지어내지 않고, 아는 만큼만 정확히 말한다.
 *
 * 활동로그는 실제 `activities` 컬렉션(에이전트가 add_activity 로 남기는 진짜
 * 기록)을 그대로 쓴다 — 완료이력 탭과 동일한 소스.
 */
export type LaneTimelineKind = "created" | "claimed" | "status" | "activity";

export interface LaneTimelineEntry {
  id: string;
  kind: LaneTimelineKind;
  at: Date;
  /** activity 본문 (kind === "activity"). */
  message?: string;
  /** 활동 주체(activity) 또는 선점자(claimed). */
  actor?: string;
  /** 상태 마커가 가리키는 status. */
  status?: TaskStatus;
}

/**
 * 오름차순(오래된 것 먼저) — TaskDetailModal 의 Activity 탭과 같은 방향이라
 * 두 화면을 오가도 읽는 순서가 뒤집히지 않는다.
 *
 * 중복 억제 규칙 두 가지:
 *   1. status === "TODO" 면 현재-상태 마커를 세우지 않는다. 생성 직후 상태라
 *      "생성됨 / TODO" 두 줄이 같은 말을 반복한다.
 *   2. status === "CLAIMED" 이고 선점 마커가 이미 있으면 현재-상태 마커를
 *      생략한다 — 선점 줄이 이미 그 전이를 말하고 있다.
 */
export function buildLaneTimeline(
  task: Pick<
    Task,
    "id" | "status" | "createdAt" | "updatedAt" | "claimedAt" | "claimedBy"
  >,
  activities: Activity[],
): LaneTimelineEntry[] {
  const entries: LaneTimelineEntry[] = [];

  if (task.createdAt) {
    entries.push({
      id: `${task.id}:created`,
      kind: "created",
      at: task.createdAt,
      status: "TODO",
    });
  }

  const claimed = Boolean(task.claimedAt && task.claimedBy);
  if (task.claimedAt && task.claimedBy) {
    entries.push({
      id: `${task.id}:claimed`,
      kind: "claimed",
      at: task.claimedAt,
      actor: task.claimedBy,
      status: "CLAIMED",
    });
  }

  for (const act of activities) {
    entries.push({
      id: act.id,
      kind: "activity",
      at: act.createdAt,
      message: act.message,
      actor: act.agentId,
    });
  }

  const redundant =
    task.status === "TODO" || (task.status === "CLAIMED" && claimed);
  if (task.updatedAt && !redundant) {
    entries.push({
      id: `${task.id}:status`,
      kind: "status",
      at: task.updatedAt,
      status: task.status,
    });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}
