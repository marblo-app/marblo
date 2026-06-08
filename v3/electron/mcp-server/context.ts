/**
 * Eyes/brain context policy (Quick Lanes 눈/브레인 분리).
 *
 * READ vs WRITE defaults are intentionally asymmetric:
 *  - WRITE always labels a task ("board" fallback) so nothing is unlabeled.
 *  - READ only scopes when MARBLO_CONTEXT is explicitly set. Callers that do
 *    NOT set it (mission orchestrator, plain agents, external CLI) stay
 *    unscoped → zero behavior change. Only the board orchestrator sets
 *    MARBLO_CONTEXT="board", so only it becomes context-scoped.
 *
 * Pure module — no firebase import — so it unit-tests in isolation. Env is a
 * parameter (defaults to process.env) so tests never mutate global state.
 */
type Env = Record<string, string | undefined>;

/** Read-scope context. "" means "do not filter by context" (unscoped). */
export function resolveContext(env: Env = process.env): string {
  return env.MARBLO_CONTEXT || "";
}

/** Write label for a new task's contextId. Always concrete ("board" fallback). */
export function resolveContextForWrite(env: Env = process.env): string {
  return resolveContext(env) || "board";
}

/** True when a contextId belongs to a Quick Lane, not a mission. */
export function isLaneContextId(contextId: string | undefined): boolean {
  return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}

/**
 * Raw mission context from MARBLO_CONTEXT.
 *
 * Board and lane contexts keep their existing contextId-only behavior. Any
 * other explicit context is a missionId and must also be written to missionId.
 */
export function resolveMissionContextForWrite(
  env: Env = process.env,
): string | null {
  const contextId = resolveContext(env);
  if (!contextId || contextId === "board" || isLaneContextId(contextId)) {
    return null;
  }
  return contextId;
}

/** contextId to filter get_all_tasks by; "" = no context constraint. */
export function contextReadFilter(
  allContexts: boolean,
  env: Env = process.env,
): string {
  return allContexts ? "" : resolveContext(env);
}

/**
 * MARBLO_CONTEXT value to inject for an orchestrator of the given kind.
 *
 * NOTE: OrchestratorManager injects this into the Marblo MCP env while patching
 * MARBLO_BRIDGE_PORT / MARBLO_PROJECT, only when non-empty.
 */
export function contextForKind(kind: string): string {
  return kind === "board" ? "board" : "";
}

/** Compute contextId backfill for tasks missing it. missionId wins, else "board". */
export function computeContextIdBackfill(
  tasks: { id: string; contextId?: string; missionId?: string }[],
): { id: string; contextId: string }[] {
  return tasks
    .filter((t) => !t.contextId)
    .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
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
export function resolveMissionIdFromContext(
  env: Env = process.env,
): string | null {
  return resolveMissionContextForWrite(env);
}

/** 오케스트레이터가 보고한 스텝 결과 (MissionEventBus 'mission.step_reported' payload). */
export interface MissionStepResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * MissionEventBus 'mission.step_reported' 이벤트 (mcp-server 측 미러).
 * mission-engine/ports.ts 의 `MissionEngineEvent` 와 구조 동일: `{ type, missionId, payload }`.
 * 지휘자(P2-A)는 `event.missionId` + `event.payload.{stepIndex,result}` 로 읽는다.
 */
export interface MissionStepReportedEvent {
  type: "mission.step_reported";
  missionId: string;
  payload: { stepIndex: number; result: MissionStepResult };
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
export function buildMissionStepReportedEvent(
  stepIndex: number | undefined,
  result: MissionStepResult | undefined,
  env: Env = process.env,
): MissionStepReportedEvent | null {
  const missionId = resolveMissionIdFromContext(env);
  if (!missionId) return null;
  return {
    type: "mission.step_reported",
    missionId,
    payload: {
      stepIndex: stepIndex ?? UNSPECIFIED_STEP_INDEX,
      result: result ?? { success: true },
    },
  };
}
