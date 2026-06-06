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

/** Quick Lane task — "lane:" 접두사를 가진 contextId. */
export function isLaneTask(contextId: string | undefined): boolean {
  return !!contextId && contextId.startsWith("lane:");
}

/** Mission task — board 도 lane 도 아닌(= missionId 그 자체) contextId. */
export function isMissionTask(contextId: string | undefined): boolean {
  return (
    !!contextId &&
    contextId !== RESERVED_BOARD &&
    !contextId.startsWith("lane:")
  );
}

/** Mission task 의 missionId, 아니면 null. */
export function getMissionId(contextId: string | undefined): string | null {
  return isMissionTask(contextId) ? (contextId as string) : null;
}
