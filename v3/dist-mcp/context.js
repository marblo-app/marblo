/** Read-scope context. "" means "do not filter by context" (unscoped). */
export function resolveContext(env = process.env) {
    return env.MARBLO_CONTEXT || "";
}
/** Write label for a new task's contextId. Always concrete ("board" fallback). */
export function resolveContextForWrite(env = process.env) {
    return resolveContext(env) || "board";
}
/** True when a contextId belongs to a Quick Lane, not a mission. */
export function isLaneContextId(contextId) {
    return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}
/** Canonical Quick Lane contextId. Mirrors the renderer's buildLaneContextId. */
export function buildLaneContextId(laneId) {
    return `lane:${laneId}`;
}
/**
 * 보드/미션 오케스트레이터의 MARBLO_AGENT_ID 규약 판별.
 *
 * orchestrator-manager 는 sessionId(`orchestrator-<projectId>` 또는
 * `orchestrator-<kind>-<projectId>`)를 그대로 MARBLO_AGENT_ID 로 주입한다.
 * 오케는 task 를 '대신' 갱신(상태 전이/auto-claim)할 뿐 실제 작업자가
 * 아니므로, 담당자(claimedBy)·작업자(projection.lastAgentId) 귀속에서
 * 제외해야 한다. 그러지 않으면 get_all_tasks/보드가 다수 task 의 담당자를
 * 이 단일 공유 id 로 표시해 부하분산이 과부하로 오인한다.
 */
export function isOrchestratorAgentId(agentId) {
    return !!agentId && agentId.startsWith("orchestrator-");
}
/**
 * Raw mission context from MARBLO_CONTEXT.
 *
 * Board and lane contexts keep their existing contextId-only behavior. Any
 * other explicit context is a missionId and must also be written to missionId.
 */
export function resolveMissionContextForWrite(env = process.env) {
    const contextId = resolveContext(env);
    if (!contextId || contextId === "board" || isLaneContextId(contextId)) {
        return null;
    }
    return contextId;
}
/** contextId to filter get_all_tasks by; "" = no context constraint. */
export function contextReadFilter(allContexts, env = process.env) {
    return allContexts ? "" : resolveContext(env);
}
/**
 * MARBLO_CONTEXT value to inject for an orchestrator of the given kind.
 *
 * NOTE: OrchestratorManager injects this into the Marblo MCP env while patching
 * MARBLO_BRIDGE_PORT / MARBLO_PROJECT, only when non-empty.
 */
export function contextForKind(kind) {
    if (kind === "board")
        return "board";
    if (kind === "lane" || kind.startsWith("lane:"))
        return kind;
    return "";
}
/** Compute contextId backfill for tasks missing it. missionId wins, else "board". */
export function computeContextIdBackfill(tasks) {
    return tasks
        .filter((t) => !t.contextId)
        .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
}
/**
 * Effective contextId of a task on the READ path. Applies the same backfill
 * rule as computeContextIdBackfill (missionId wins, else "board") in memory,
 * without mutating the doc. This is what lets legacy/externally-created tasks
 * that were stored without a contextId still resolve to the board context
 * instead of disappearing from it.
 */
export function effectiveContextId(task) {
    return task.contextId || (task.missionId ?? "board");
}
/**
 * Whether a task is visible under the given read-scope context.
 *  - "" (unscoped) → every task is visible (no context filter).
 *  - "board" → tasks effectively on the board, INCLUDING legacy tasks stored
 *    without a contextId (effectiveContextId backfills them to "board"). This is
 *    the regression fix: a single Firestore `==` cannot express
 *    "contextId == 'board' OR contextId unset", so the board read must filter in
 *    memory. A lane (lane:*) or mission task carries an explicit, non-board
 *    contextId, so it never matches "board" — the lane-isolation invariant holds.
 *  - any other context (lane:* / missionId) → exact effective-contextId match.
 */
export function isTaskInReadContext(task, contextId) {
    if (!contextId)
        return true;
    return effectiveContextId(task) === contextId;
}
// ── Mission step report (B안 Phase 2 — 오케스트레이터 → 지휘자 보고 채널) ──
// 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §4 / §8.4.
//
// mcp-server 는 별도 프로세스 + 격리 컴파일(rootDir)이라 mission-engine/ports 의
// MissionEngineEvent 를 import 할 수 없다. 그래서 'mission.step_reported' 이벤트의
// 페이로드 계약을 여기 순수 모듈에 미러한다 (firebase 미의존 → 단위테스트 격리).
/**
 * 현재 MCP 호출 컨텍스트의 missionId. board / Quick Lane / 미설정이면 `null`
 * (= 미션 컨텍스트가 아니므로 스텝 보고 불가). `resolveMissionContextForWrite` 와
 * 동일 규칙의 의미상 별칭 — 보고(report) 경로에서 의도를 분명히 하려고 분리했다.
 */
export function resolveMissionIdFromContext(env = process.env) {
    return resolveMissionContextForWrite(env);
}
/**
 * 미지정 stepIndex 의 sentinel. 오케스트레이터가 stepIndex 를 생략하면 지휘자가
 * 미션의 현재 스텝(mission.currentStep)으로 해석하라는 신호.
 */
export const UNSPECIFIED_STEP_INDEX = -1;
/**
 * 스텝완료 보고 이벤트 빌더 (순수). 미션 컨텍스트가 아니면 `null` 을 반환해 거부한다.
 *  - `stepIndex` 미지정 → `UNSPECIFIED_STEP_INDEX` (지휘자가 현재 스텝으로 해석).
 *  - `result` 미지정 → `{ success: true }` (도구명 'done' = 성공 보고가 기본).
 */
export function buildMissionStepReportedEvent(stepIndex, result, env = process.env) {
    const missionId = resolveMissionIdFromContext(env);
    if (!missionId)
        return null;
    return {
        type: "mission.step_reported",
        missionId,
        payload: {
            stepIndex: stepIndex ?? UNSPECIFIED_STEP_INDEX,
            result: result ?? { success: true },
        },
    };
}
//# sourceMappingURL=context.js.map