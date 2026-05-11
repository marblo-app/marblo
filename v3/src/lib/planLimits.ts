/**
 * Per-plan resource limits — client-side enforcement.
 *
 * Source-of-truth: v3.1 launch master plan §2.2 SKU 기능 매트릭스.
 *
 *   free       — 2 concurrent agents (try-before-buy)
 *   pro        — 5 concurrent agents
 *   team       — unlimited
 *   team_plus  — unlimited (when PlanType is extended)
 *   enterprise — unlimited
 *
 * Server side will eventually re-validate (untrusted client), but for the
 * baseline launch this stops the most common cases:
 *  - Free users spawning a dozen agents that drain Claude credits
 *  - Pro users accidentally fanning out and burning their token allowance
 *
 * "Active" = an agent in `idle` or `working` status. Stopped / error
 * agents do NOT count toward the limit — they're already not consuming
 * resources, and re-counting them would punish recovery.
 */
import type { Agent, AgentStatus } from "../types/agent";
import type { PlanType } from "../types/subscription";

/** -1 means unlimited. */
export const AGENT_CONCURRENCY_LIMIT: Record<string, number> = {
  free: 2,
  pro: 5,
  team: -1,
  team_plus: -1,
  enterprise: -1,
};

const ACTIVE_STATUSES: AgentStatus[] = ["idle", "working"];

/** Limit for the given plan, defaulting unknown / future plans to unlimited. */
export function getAgentLimit(plan: PlanType | string): number {
  const limit = AGENT_CONCURRENCY_LIMIT[plan];
  return limit === undefined ? -1 : limit;
}

/** Count agents that currently consume a slot. */
export function countActiveAgents(agents: Agent[]): number {
  return agents.filter((a) => ACTIVE_STATUSES.includes(a.status)).length;
}

export interface ThrottleCheck {
  allowed: boolean;
  /** Human-readable reason when blocked, suitable for inline UI display. */
  reason?: string;
  /** Current active count and the limit, so UI can render "N/M agents". */
  active: number;
  limit: number;
}

/**
 * Check whether a new spawn is allowed under the user's plan.
 *
 * Pass the array of agents owned by the current user / project. If the
 * caller is uncertain whether an agent counts (e.g. the orchestrator
 * itself), pass it through anyway — its status field decides.
 */
export function checkAgentSpawn(
  plan: PlanType | string,
  agents: Agent[]
): ThrottleCheck {
  const limit = getAgentLimit(plan);
  const active = countActiveAgents(agents);
  if (limit < 0) {
    return { allowed: true, active, limit };
  }
  if (active < limit) {
    return { allowed: true, active, limit };
  }
  return {
    allowed: false,
    active,
    limit,
    reason:
      plan === "free"
        ? `Free 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성). Pro로 업그레이드하면 5개, Team부터 무제한입니다.`
        : plan === "pro"
        ? `Pro 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성). Team / Team Plus는 무제한입니다.`
        : `현재 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성).`,
  };
}
