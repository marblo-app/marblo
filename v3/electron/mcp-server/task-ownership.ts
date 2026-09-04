export interface ClaimOwnershipInput {
  claimedBy?: string | null;
  actorAgentId?: string | null;
  force?: boolean;
}

export const CLAIM_OWNERSHIP_ERROR_PREFIX = "Task is claimed by agent";

export function formatClaimOwnershipError(claimedBy: string): string {
  return `${CLAIM_OWNERSHIP_ERROR_PREFIX} ${claimedBy}; only the claiming agent can update it`;
}

export function getClaimOwnershipError(
  input: ClaimOwnershipInput,
): string | null {
  if (input.force) return null;
  const claimedBy = input.claimedBy;
  if (!claimedBy) return null;
  if (input.actorAgentId === claimedBy) return null;
  return formatClaimOwnershipError(claimedBy);
}

export function shouldReleaseClaimForStoppedAgent(input: {
  claimedBy?: string | null;
  stoppedAgentId: string;
}): boolean {
  return !!input.stoppedAgentId && input.claimedBy === input.stoppedAgentId;
}

/**
 * 죽은 claim 을 회수할 때 티켓 상태를 무엇으로 되돌릴 것인가.
 *
 * ★진단 §5.3-b — 이게 없어서 회수가 무의미했다. `releaseTaskClaimsForDeadAgent`
 * 는 `claimedBy`/`claimedAt` 만 지우고 `status` 는 `IN_PROGRESS` 그대로 뒀는데,
 * 양쪽 입구가 전부 TODO 만 받는다:
 *   · `get_available_tasks` → `where("status","==","TODO")` — 피드에 안 잡힌다.
 *   · `claim_task` → TODO 가 아니면 "not available for claiming" 으로 거부한다.
 * 즉 **회수돼도 아무도 다시 집을 수 없었다.** 클레임만 풀린 유령 티켓이 된다.
 *
 * 되돌리는 대상은 "집혔지만 아직 제출되지 않은" 두 상태뿐이다:
 *   · CLAIMED     — 집기만 하고 시작 전
 *   · IN_PROGRESS — 진행 중이었다
 *
 * 나머지는 손대지 않는다. 특히:
 *   · REVIEW  — 산출물이 이미 제출됐다. TODO 로 되돌리면 그 작업이 사라진다.
 *   · BLOCKED — 답을 기다리는 중이다. 되돌리면 막힌 맥락이 지워진 채 재배포된다.
 *   · DONE / FAILED — 종결 상태다.
 *
 * 되돌릴 필요가 없으면 null 을 준다(호출자는 status 를 쓰지 않는다).
 */
export function taskStatusAfterClaimRelease(
  status: unknown,
): "TODO" | null {
  return status === "IN_PROGRESS" || status === "CLAIMED" ? "TODO" : null;
}
