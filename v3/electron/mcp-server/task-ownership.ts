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
