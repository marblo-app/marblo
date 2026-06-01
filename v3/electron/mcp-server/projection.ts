// Orchestrator Live Awareness — Layer A (Projection).
// Spec: v3/docs/specs/2026-05-28-orch-live-awareness-design.md §2, §13.3
//
// MCP 도구 4종 (claim_task / update_task_status / submit_for_review / add_activity)
// 이 호출 직후 같은 트랜잭션에서 tasks/{tid}.projection 과
// missions/{mid}.projection (있으면) 을 갱신한다. orch 가 "지금 상태?" 물을 때
// LLM 을 깨우지 않고 read 한 번으로 답할 수 있는 "사실 저장소".
//
// 의도적으로 별도 컬렉션 신설 X — 기존 task/mission 문서 안의 nested map field
// 로 둔다 (spec §16 P1 context: "별도 컬렉션 안 만들고 한 문서로"). 같은
// 트랜잭션에서 함께 갱신되므로 status 와 projection 이 절대 어긋나지 않는다.

import {
  doc,
  collection,
  runTransaction,
  Timestamp,
  type Firestore,
} from "firebase/firestore";

export type TaskStatus =
  | "TODO"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "DONE";

export interface TaskProjection {
  currentStatus: TaskStatus;
  lastAgentId: string;
  lastActivityAt: Timestamp;
  lastActivitySummary: string;
  milestonesPassed: string[];
  blockerSummary?: string;
}

export interface MissionProjection {
  statusCounts: Record<string, number>;
  lastTaskActivityAt: Timestamp;
}

export interface ProjectionMutation {
  /** 새 상태로 전이 (claim/update_status/submit_for_review). 미지정 시 현재 상태 유지 (add_activity). */
  newStatus?: TaskStatus;
  /** projection.lastAgentId 로 기록. 빈 문자열이면 이전 값 유지. */
  lastAgentId: string;
  /** 200자 자름. 미지정 시 이전 값 유지. */
  lastActivitySummary?: string;
  /** submit_for_review 일 때 true — milestonesPassed 에 taskId append (중복 방지). */
  appendMilestone?: boolean;
  /** update_task_status(BLOCKED) 일 때 set. BLOCKED 를 벗어나는 전이면 빈 문자열로 자동 clear. */
  blockerSummary?: string;
}

/**
 * Pure — projection 의 다음 값 계산. I/O 없음.
 * 테스트가 직접 호출하고, applyProjection 의 트랜잭션 내부에서도 사용.
 */
export function computeTaskProjection(
  prev: TaskProjection | undefined,
  currentStatus: TaskStatus,
  taskId: string,
  now: Timestamp,
  mut: ProjectionMutation,
): TaskProjection {
  const nextStatus = mut.newStatus ?? currentStatus;
  const milestonesPassed = prev?.milestonesPassed ?? [];
  const summary = mut.lastActivitySummary?.slice(0, 200);
  const next: TaskProjection = {
    currentStatus: nextStatus,
    lastAgentId: mut.lastAgentId || prev?.lastAgentId || "",
    lastActivityAt: now,
    lastActivitySummary: summary ?? prev?.lastActivitySummary ?? "",
    milestonesPassed:
      mut.appendMilestone && !milestonesPassed.includes(taskId)
        ? [...milestonesPassed, taskId]
        : milestonesPassed,
  };
  if (mut.blockerSummary !== undefined) {
    next.blockerSummary = mut.blockerSummary;
  } else if (
    mut.newStatus &&
    nextStatus !== "BLOCKED" &&
    prev?.blockerSummary !== undefined &&
    prev.blockerSummary !== ""
  ) {
    // BLOCKED 를 벗어나는 전이 — Firestore client SDK 의 FieldValue.delete()
    // 를 nested map 안에서 호출하기 까다로워 빈 문자열 sentinel 로 clear.
    // UI 는 truthy 체크로 거름.
    next.blockerSummary = "";
  } else if (prev?.blockerSummary !== undefined) {
    next.blockerSummary = prev.blockerSummary;
  }
  return next;
}

/**
 * Pure — mission 의 statusCounts 점진 갱신.
 * 같은 상태로의 no-op 전이는 prev 의 사본 그대로.
 */
export function applyMissionStatusDelta(
  prev: Record<string, number> | undefined,
  oldStatus: TaskStatus,
  newStatus: TaskStatus,
): Record<string, number> {
  const next = { ...(prev ?? {}) };
  if (oldStatus === newStatus) return next;
  next[oldStatus] = Math.max(0, (next[oldStatus] ?? 0) - 1);
  next[newStatus] = (next[newStatus] ?? 0) + 1;
  return next;
}

export interface ApplyProjectionInput extends ProjectionMutation {
  /** task 본체 doc 에 함께 쓸 필드 — claim 의 claimedBy, status 변경의 comment 등. */
  extraTaskFields?: Record<string, unknown>;
  /** add_activity — 같은 트랜잭션에서 activities/{auto} 도 set. */
  activityPayload?: { agentId: string; message: string };
}

/**
 * 트랜잭션 wrapper. tools.ts 의 4개 핸들러가 호출.
 *
 * 효과:
 *   1. tasks/{taskId}.projection 갱신 + extraTaskFields merge + (newStatus 면) status update
 *   2. activityPayload 있으면 activities/{auto} set
 *   3. task.missionId 가 있고 mission doc 이 존재하면 missions/{mid}.projection 갱신
 */
export async function applyProjection(
  db: Firestore,
  taskId: string,
  mut: ApplyProjectionInput,
): Promise<void> {
  const taskRef = doc(db, "tasks", taskId);
  const activityRef = mut.activityPayload
    ? doc(collection(db, "activities"))
    : null;

  await runTransaction(db, async (txn) => {
    const taskSnap = await txn.get(taskRef);
    if (!taskSnap.exists()) {
      throw new Error(`Task ${taskId} not found`);
    }
    const taskData = taskSnap.data() as Record<string, unknown> & {
      status: TaskStatus;
      missionId?: string;
      projection?: TaskProjection;
    };
    const oldStatus = taskData.status;
    const missionId = taskData.missionId;
    const missionRef = missionId ? doc(db, "missions", missionId) : null;
    // Firestore 트랜잭션은 모든 read 가 첫 write 이전이어야 함.
    const missionSnap = missionRef ? await txn.get(missionRef) : null;

    const now = Timestamp.now();

    const projection = computeTaskProjection(
      taskData.projection,
      oldStatus,
      taskId,
      now,
      mut,
    );

    const taskUpdate: Record<string, unknown> = {
      ...(mut.extraTaskFields ?? {}),
      projection,
      updatedAt: now,
    };
    if (mut.newStatus) taskUpdate.status = mut.newStatus;
    txn.update(taskRef, taskUpdate);

    if (activityRef && mut.activityPayload) {
      txn.set(activityRef, {
        taskId,
        agentId: mut.activityPayload.agentId,
        message: mut.activityPayload.message,
        createdAt: now,
      });
    }

    if (missionRef && missionSnap?.exists()) {
      const mData = missionSnap.data() as { projection?: MissionProjection };
      const nextCounts = mut.newStatus
        ? applyMissionStatusDelta(
            mData.projection?.statusCounts,
            oldStatus,
            mut.newStatus,
          )
        : { ...(mData.projection?.statusCounts ?? {}) };
      txn.update(missionRef, {
        "projection.statusCounts": nextCounts,
        "projection.lastTaskActivityAt": now,
      });
    }
  });
}
