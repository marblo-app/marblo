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
import { doc, collection, getDoc, getDocs, query, where, runTransaction, Timestamp, } from "firebase/firestore";
// ── Context classification (Quick Lanes 눈/브레인 분리) ──────────
// contextId 한 필드로 task 출처를 가른다:
//   board  : "board" | "" | undefined
//   lane   : "lane" | "lane:<laneId>"   (Quick Lane)
//   mission: 그 외(= missionId raw, 접두사 없음 — dispatcher-impl 의 contextId: missionId)
// src/lib/laneContext.ts(렌더러의 단일 소스)의 복제본이다 — MCP 서버는
// electron/mcp-server/tsconfig(rootDir 격리)로 빌드돼 src/ 를 import 할 수 없다.
// 동작 동치를 유지할 것. tools.ts 가 레인 task 의 '진행' notify(update_status/
// add_activity/dependency-resolved)를 오케 PTY 로 안 보내도록 이 술어로 게이트한다.
export function isLaneContext(contextId) {
    return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}
/**
 * Pure — projection 의 다음 값 계산. I/O 없음.
 * 테스트가 직접 호출하고, applyProjection 의 트랜잭션 내부에서도 사용.
 */
export function computeTaskProjection(prev, currentStatus, taskId, now, mut) {
    const nextStatus = mut.newStatus ?? currentStatus;
    const milestonesPassed = prev?.milestonesPassed ?? [];
    const summary = mut.lastActivitySummary?.slice(0, 200);
    const next = {
        currentStatus: nextStatus,
        lastAgentId: mut.lastAgentId || prev?.lastAgentId || "",
        lastActivityAt: now,
        lastActivitySummary: summary ?? prev?.lastActivitySummary ?? "",
        milestonesPassed: mut.appendMilestone && !milestonesPassed.includes(taskId)
            ? [...milestonesPassed, taskId]
            : milestonesPassed,
    };
    if (mut.blockerSummary !== undefined) {
        next.blockerSummary = mut.blockerSummary;
    }
    else if (mut.newStatus &&
        nextStatus !== "BLOCKED" &&
        prev?.blockerSummary !== undefined &&
        prev.blockerSummary !== "") {
        // BLOCKED 를 벗어나는 전이 — Firestore client SDK 의 FieldValue.delete()
        // 를 nested map 안에서 호출하기 까다로워 빈 문자열 sentinel 로 clear.
        // UI 는 truthy 체크로 거름.
        next.blockerSummary = "";
    }
    else if (prev?.blockerSummary !== undefined) {
        next.blockerSummary = prev.blockerSummary;
    }
    return next;
}
/**
 * Pure — mission 의 statusCounts 점진 갱신.
 * 같은 상태로의 no-op 전이는 prev 의 사본 그대로.
 */
export function applyMissionStatusDelta(prev, oldStatus, newStatus) {
    const next = { ...(prev ?? {}) };
    if (oldStatus === newStatus)
        return next;
    next[oldStatus] = Math.max(0, (next[oldStatus] ?? 0) - 1);
    next[newStatus] = (next[newStatus] ?? 0) + 1;
    return next;
}
/**
 * 미션 task 들의 status 를 한 번에 읽어 statusCounts 맵을 만든다.
 * Firestore client SDK 트랜잭션은 쿼리를 못 돌리므로 (txn.get 은 단일 doc 만),
 * mission projection 이 아직 seed 되지 않았을 때 1회성 전체 재계산용으로 쓴다.
 */
async function recomputeMissionCounts(db, missionId) {
    const snap = await getDocs(query(collection(db, "tasks"), where("missionId", "==", missionId)));
    const counts = {};
    snap.forEach((d) => {
        const s = d.data().status;
        if (s)
            counts[s] = (counts[s] ?? 0) + 1;
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
export async function applyProjection(db, taskId, mut) {
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
    let seedCounts;
    const preTask = await getDoc(taskRef);
    const preMissionId = preTask.exists()
        ? preTask.data().missionId
        : undefined;
    if (preMissionId) {
        const preMission = await getDoc(doc(db, "missions", preMissionId));
        if (preMission.exists() &&
            preMission.data().projection
                ?.statusCounts === undefined) {
            seedCounts = await recomputeMissionCounts(db, preMissionId);
        }
    }
    await runTransaction(db, async (txn) => {
        const taskSnap = await txn.get(taskRef);
        if (!taskSnap.exists()) {
            throw new Error(`Task ${taskId} not found`);
        }
        const taskData = taskSnap.data();
        const oldStatus = taskData.status;
        // bug_005 TOCTOU 가드: 트랜잭션 안에서 다시 읽은 '실제' status 로 전이 가능성을
        // 재검사. 핸들러가 트랜잭션 밖에서 한 검사는 동시 claim/update race 를 못 막는다.
        if (mut.newStatus && mut.validateFrom && !mut.validateFrom(oldStatus)) {
            throw new Error(`Task ${taskId} cannot transition from ${oldStatus} to ${mut.newStatus}`);
        }
        const missionId = taskData.missionId;
        const missionRef = missionId ? doc(db, "missions", missionId) : null;
        // Firestore 트랜잭션은 모든 read 가 첫 write 이전이어야 함.
        const missionSnap = missionRef ? await txn.get(missionRef) : null;
        const now = Timestamp.now();
        const projection = computeTaskProjection(taskData.projection, oldStatus, taskId, now, mut);
        const taskUpdate = {
            ...(mut.extraTaskFields ?? {}),
            projection,
            updatedAt: now,
        };
        if (mut.newStatus)
            taskUpdate.status = mut.newStatus;
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
            const mData = missionSnap.data();
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
/**
 * 후행 task(`dependentId`)의 모든 선행 의존이 DONE 이면 `dependsOnCompleted` 를
 * 트랜잭션 안에서 멱등하게 true 로 flip 한다. `completedTaskId` 는 이 해소를
 * 촉발한(=방금 DONE 된) 선행 task 로, DONE 으로 간주해 재조회를 생략한다.
 *
 * 반환 `unblocked` 는 "이 호출이 실제로 flip 을 수행했는가" 이다 — 동시 완료
 * race 에서 단 하나의 호출만 true 를 받으므로 호출부의 notify 가 중복되지 않는다.
 */
export async function resolveDependentIfReady(db, dependentId, completedTaskId) {
    return runTransaction(db, async (txn) => {
        const depRef = doc(db, "tasks", dependentId);
        const depSnap = await txn.get(depRef);
        if (!depSnap.exists())
            return { unblocked: false };
        const depData = depSnap.data();
        // 멱등 가드: 이미 누군가(동시 완료 race 의 승자) 풀었으면 재-notify 금지.
        if (depData.dependsOnCompleted)
            return { unblocked: false };
        // 모든 선행 의존이 DONE 인지 같은 트랜잭션 스냅샷으로 확인.
        // (Firestore 규칙상 모든 read 는 첫 write 이전 — 아래 txn.update 는 루프 뒤.)
        const allDeps = depData.dependsOn ?? [];
        for (const depId of allDeps) {
            // 방금 이 해소를 촉발한 선행은 DONE 으로 간주(트리거 그 자체).
            if (depId === completedTaskId)
                continue;
            const upstream = await txn.get(doc(db, "tasks", depId));
            if (!upstream.exists() ||
                upstream.data().status !== "DONE") {
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
//# sourceMappingURL=projection.js.map