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
  getDoc,
  getDocs,
  query,
  where,
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

// ── Context classification (Quick Lanes 눈/브레인 분리) ──────────
// contextId 한 필드로 task 출처를 가른다:
//   board  : "board" | "" | undefined
//   lane   : "lane" | "lane:<laneId>"   (Quick Lane)
//   mission: 그 외(= missionId raw, 접두사 없음 — dispatcher-impl 의 contextId: missionId)
// src/lib/laneContext.ts(렌더러의 단일 소스)의 복제본이다 — MCP 서버는
// electron/mcp-server/tsconfig(rootDir 격리)로 빌드돼 src/ 를 import 할 수 없다.
// 동작 동치를 유지할 것. tools.ts 가 레인 task 의 '진행' notify(update_status/
// add_activity/dependency-resolved)를 오케 PTY 로 안 보내도록 이 술어로 게이트한다.
export function isLaneContext(contextId: string | undefined): boolean {
  return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}

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
  /**
   * 트랜잭션 내부에서 다시 읽은 실제 oldStatus 가 전이 가능한 상태인지 검사.
   * false 면 throw → 트랜잭션 abort (TOCTOU 방어). 핸들러가 트랜잭션 밖에서 한
   * status 검사는 동시 claim/update race 를 못 막는다 (둘 다 통과 후 마지막 write
   * 가 이김). 같은 술어를 넘겨 트랜잭션 안에서 재검사하면 두 번째 커밋이 거부된다.
   * 미지정 시 검사 생략 — add_activity 처럼 status 안 바꾸는 경로, 그리고
   * update_task_status(force=true) 같은 문서화된 escape hatch 가 여기로 온다.
   * 즉 force 는 'validateFrom 을 안 넘긴다' 로 관통한다: 핸들러가 트랜잭션 밖
   * 검사를 건너뛰었으면 이 in-txn 재검사도 함께 꺼져야 escape hatch 가 산다.
   */
  validateFrom?: (from: TaskStatus) => boolean;
}

/**
 * 미션 task 들의 status 를 한 번에 읽어 statusCounts 맵을 만든다.
 * Firestore client SDK 트랜잭션은 쿼리를 못 돌리므로 (txn.get 은 단일 doc 만),
 * mission projection 이 아직 seed 되지 않았을 때 1회성 전체 재계산용으로 쓴다.
 */
async function recomputeMissionCounts(
  db: Firestore,
  missionId: string,
): Promise<Record<string, number>> {
  const snap = await getDocs(
    query(collection(db, "tasks"), where("missionId", "==", missionId)),
  );
  const counts: Record<string, number> = {};
  snap.forEach((d) => {
    const s = (d.data() as { status?: string }).status;
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  });
  return counts;
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

  // bug_003 seed: dispatcher 는 task 생성 시 mission 문서를 안 건드리므로
  // missions/{mid}.projection.statusCounts 가 처음엔 비어 있다. 그 상태에서 delta
  // (±1) 만 돌리면 TODO 총원이 복원되지 않아 (Math.max(0,-1)=0) 카운트가 틀어진다.
  // client SDK 트랜잭션은 쿼리를 못 돌리므로, 미초기화를 감지하면 트랜잭션 진입
  // '전에' sibling task 전체를 한 번 읽어 권위 있는 카운트를 seed 한다. 1회성이고
  // 이후 호출은 트랜잭션 내 delta 경로(동시성 안전)를 탄다.
  let seedCounts: Record<string, number> | undefined;
  const preTask = await getDoc(taskRef);
  const preMissionId = preTask.exists()
    ? (preTask.data() as { missionId?: string }).missionId
    : undefined;
  if (preMissionId) {
    const preMission = await getDoc(doc(db, "missions", preMissionId));
    if (
      preMission.exists() &&
      (preMission.data() as { projection?: MissionProjection }).projection
        ?.statusCounts === undefined
    ) {
      seedCounts = await recomputeMissionCounts(db, preMissionId);
    }
  }

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

    // bug_005 TOCTOU 가드: 트랜잭션 안에서 다시 읽은 '실제' status 로 전이 가능성을
    // 재검사. 핸들러가 트랜잭션 밖에서 한 검사는 동시 claim/update race 를 못 막는다.
    if (mut.newStatus && mut.validateFrom && !mut.validateFrom(oldStatus)) {
      throw new Error(
        `Task ${taskId} cannot transition from ${oldStatus} to ${mut.newStatus}`,
      );
    }

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
      // seed 우선순위: 트랜잭션 내 실제 값 > 진입 전 재계산 seed. seedCounts 는 이
      // task 가 아직 oldStatus 인 현재 상태를 반영하므로, delta 가 old→new 를 마저
      // 적용하면 최종 카운트가 맞다.
      const base = mData.projection?.statusCounts ?? seedCounts;
      const nextCounts = mut.newStatus
        ? applyMissionStatusDelta(base, oldStatus, mut.newStatus)
        : { ...(base ?? {}) };
      txn.update(missionRef, {
        "projection.statusCounts": nextCounts,
        "projection.lastTaskActivityAt": now,
      });
    }
  });
}

// ── Task dependency DAG resolution (N4 race fix) ───────────────
//
// `dependsOnCompleted` 는 "이 후행 task 의 모든 선행 의존이 DONE 인가" 플래그다.
// 어떤 선행 task 가 DONE 되면, 그것을 의존하는 각 후행 task 에 대해 이 함수를
// 호출해 "모든 의존이 DONE 이면 플래그를 단 한 번만 true 로 뒤집고, 그때만
// unblocked=true 를 돌려준다". 호출부는 unblocked=true 일 때만 오케스트레이터에
// notify 하므로 notify(=디스패치)가 정확히 한 번 발사된다.
//
// N4 버그: 예전엔 tools.ts 가 트랜잭션 없이 getDocs 스냅샷의
// `if (dependsOnCompleted) continue` 를 읽고 → 그 뒤 updateDoc 으로 뒤집었다.
// T 가 D1·D2 에 의존하고 D1·D2 가 동시에 완료되면 두 핸들러가 모두 stale 한
// false 를 읽어 둘 다 flip + 둘 다 notify → 같은 T 가 중복 디스패치됐다
// (check-then-act 비원자성).
//
// 수정: flip 을 트랜잭션 안에서 재검사한다(멱등 가드). 트랜잭션 내부에서 다시
// 읽은 dependsOnCompleted 가 이미 true 면(=race 의 패자) 아무 write 도 안 하고
// unblocked=false 를 돌려준다. 모든 의존의 DONE 여부도 같은 트랜잭션 스냅샷으로
// 확인해 TOCTOU 를 닫는다 (applyProjection 의 bug_005 가드와 같은 결).
export interface DependencyResolution {
  /** 이 호출이 후행 task 를 막 unblock 했는가(=notify 를 보내야 하는가). */
  unblocked: boolean;
  /** unblock 된 후행 task 의 표시용 메타(호출부 notify 메시지에 사용). */
  title?: string;
  role?: string;
}

/**
 * 후행 task(`dependentId`)의 모든 선행 의존이 DONE 이면 `dependsOnCompleted` 를
 * 트랜잭션 안에서 멱등하게 true 로 flip 한다. `completedTaskId` 는 이 해소를
 * 촉발한(=방금 DONE 된) 선행 task 로, DONE 으로 간주해 재조회를 생략한다.
 *
 * 반환 `unblocked` 는 "이 호출이 실제로 flip 을 수행했는가" 이다 — 동시 완료
 * race 에서 단 하나의 호출만 true 를 받으므로 호출부의 notify 가 중복되지 않는다.
 */
export async function resolveDependentIfReady(
  db: Firestore,
  dependentId: string,
  completedTaskId: string,
): Promise<DependencyResolution> {
  return runTransaction(db, async (txn) => {
    const depRef = doc(db, "tasks", dependentId);
    const depSnap = await txn.get(depRef);
    if (!depSnap.exists()) return { unblocked: false };

    const depData = depSnap.data() as {
      dependsOn?: string[];
      dependsOnCompleted?: boolean;
      title?: string;
      role?: string;
    };

    // 멱등 가드: 이미 누군가(동시 완료 race 의 승자) 풀었으면 재-notify 금지.
    if (depData.dependsOnCompleted) return { unblocked: false };

    // 모든 선행 의존이 DONE 인지 같은 트랜잭션 스냅샷으로 확인.
    // (Firestore 규칙상 모든 read 는 첫 write 이전 — 아래 txn.update 는 루프 뒤.)
    const allDeps = depData.dependsOn ?? [];
    for (const depId of allDeps) {
      // 방금 이 해소를 촉발한 선행은 DONE 으로 간주(트리거 그 자체).
      if (depId === completedTaskId) continue;
      const upstream = await txn.get(doc(db, "tasks", depId));
      if (
        !upstream.exists() ||
        (upstream.data() as { status?: string }).status !== "DONE"
      ) {
        return { unblocked: false };
      }
    }

    // 여기 도달한 트랜잭션만 단독 승자 — 멱등하게 true 로 flip.
    txn.update(depRef, {
      dependsOnCompleted: true,
      updatedAt: Timestamp.now(),
    });
    return { unblocked: true, title: depData.title, role: depData.role };
  });
}
