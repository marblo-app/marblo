/**
 * Task 출처를 contextId 한 필드로 구분한다. 칸반 보드는 세 종류의 task 를
 * 한 화면에 섞어 보여주므로(일반 보드 / Quick Lane / Mission), 각 출처를
 * 정확히 판별해 카드에 서로 다른 마킹을 붙인다.
 *
 *   - 일반 보드 : contextId === "board" (또는 미설정)
 *   - Quick Lane: contextId === "lane:<laneId>"
 *   - Mission   : contextId === <missionId> (raw, 접두사 없음)
 *
 * 미션 task 의 contextId 는 missionId 그 자체다(접두사 없음 — dispatcher-impl
 * 의 `contextId: input.missionId`). 따라서 "board 도 lane 도 아니면 mission"
 * 으로 판별한다. (접두사 통일은 MISSIONS-SPEC §6.6-A 대로 v3.1 보류.)
 */
const RESERVED_BOARD = "board";

/** Quick Lane contextId 의 규약 접두사. 단일 진실의 원천. */
export const LANE_CONTEXT_PREFIX = "lane:";

/**
 * Quick Lane task 의 contextId 를 만든다 — 규약 "lane:<laneId>".
 * laneId 는 레인별 고유 식별자(보통 uuid). 과거엔 "lane" 단일 리터럴을 쓰던
 * 분기가 있었으나(B1), 이제 항상 이 빌더를 거쳐 lane 마다 구별되는 contextId 를
 * 부여한다.
 */
export function buildLaneContextId(laneId: string): string {
  return `${LANE_CONTEXT_PREFIX}${laneId}`;
}

/**
 * Quick Lane context 여부 — "lane:" 접두사를 가진 contextId.
 * ("board" 는 "lane:" 로 시작하지 않으므로 RESERVED_BOARD 를 따로 검사하지
 *  않아도 안전하다 — by construction.)
 */
export function isLaneContext(contextId: string | undefined | null): boolean {
  return !!contextId && contextId.startsWith(LANE_CONTEXT_PREFIX);
}

/** "lane:<laneId>" 에서 laneId 추출, lane context 가 아니면 null. */
export function parseLaneContextId(
  contextId: string | undefined | null,
): string | null {
  return isLaneContext(contextId)
    ? contextId!.slice(LANE_CONTEXT_PREFIX.length)
    : null;
}

/**
 * Quick Lane task 판별 — 의미상 {@link isLaneContext} 와 동일하다(보드 카드
 * 마킹 등 기존 호출부 호환을 위해 이름 유지).
 */
export function isLaneTask(contextId: string | undefined): boolean {
  return isLaneContext(contextId);
}

/** Mission task — board 도 lane 도 아닌(= missionId 그 자체) contextId. */
export function isMissionTask(
  contextId: string | undefined,
): contextId is string {
  return (
    !!contextId && contextId !== RESERVED_BOARD && !isLaneContext(contextId)
  );
}

/** Mission task 의 missionId, 아니면 null. */
export function getMissionId(contextId: string | undefined): string | null {
  return isMissionTask(contextId) ? contextId : null;
}
