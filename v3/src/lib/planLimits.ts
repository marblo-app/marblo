/**
 * Per-plan resource limits & feature matrix — the SINGLE source of truth for
 * the desktop app's gating. `services/billingService` re-exports `getPlanLimits`
 * from here (no second copy) and `stores/subscriptionStore` imports PLAN_FEATURES
 * from here, so the numbers AND feature flags are derived from one place.
 *
 * Confirmed tiers (대표 확정 + CEO 리뷰, 티켓 ULyUorgd):
 *   free       — 1 project,        5 concurrent agents (fair-use cap)
 *   pro        — unlimited projects, unlimited agents (fair use)
 *   team       — unlimited / unlimited (machine-bounded)
 *   team_plus  — unlimited / unlimited
 *   enterprise — unlimited / unlimited
 *
 * These constants are intentionally the ONE place values live so the CEO can
 * adjust a tier without hunting through the codebase.
 *
 * Agents run on the user's own model credentials (BYOK), so the Free agent cap
 * is NOT about our token cost — it's a fair-use ceiling that prevents a single
 * free account from abusing shared local/infra resources. Paid tiers are
 * effectively unlimited (fair use); the cap is never reached in practice.
 *
 * Server side re-validates the untrusted client (firestore rules +
 * `enforceProjectLimit` Cloud Function) — most importantly for the project cap,
 * which blocks a Free user's 2nd+ project even via a direct Firestore write.
 *
 * "Active" agent = one in `idle` or `working` status. Stopped / error agents do
 * NOT count toward the limit — they're already not consuming resources, and
 * re-counting them would punish recovery.
 */
import type { Agent, AgentStatus } from "../types/agent";
import type { PlanType, PlanLimits } from "../types/subscription";

export type TeamCollabPlan = Extract<
  PlanType,
  "team" | "team_plus" | "enterprise"
>;

export interface TeamSeatEntitlement {
  /**
   * Seats included before paid overage. Enforced (ticket gT9EXiONpzqFwY1xjc3n)
   * at the invite choke points: `functions/src/orgOnboarding.ts`
   * `checkTeamSeatForInvite` (createOrgInvitation callable) rejects over-seat
   * invites, and `firestore.rules` gates invitation creation + non-owner task
   * writes on the owner's team-collab plan.
   */
  includedSeats: number;
  /**
   * Read-only viewers do not consume paid seats. Owner/admin/member do.
   */
  viewerConsumesSeat: boolean;
}

/**
 * Canonical per-plan limits. `Infinity` = unlimited.
 * 마스터플랜 §2.2 SKU 기능 매트릭스 + 대표 확정 티어 기준.
 */
export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxProjects: 1,
    maxAgents: 5, // fair-use cap (BYOK; not a cost limit)
    hasFlowEditor: false,
    hasTeamCollab: false,
    hasOrchestrator: false,
    hasPrioritySupport: false,
  },
  pro: {
    maxProjects: Infinity,
    maxAgents: Infinity, // unlimited (fair use)
    hasFlowEditor: true,
    hasTeamCollab: false,
    hasOrchestrator: true,
    hasPrioritySupport: false, // Team Plus부터 우선 지원
  },
  team: {
    maxProjects: Infinity,
    maxAgents: Infinity,
    hasFlowEditor: true,
    hasTeamCollab: true,
    hasOrchestrator: true,
    hasPrioritySupport: false, // Team Plus부터 우선 지원
  },
  team_plus: {
    maxProjects: Infinity,
    maxAgents: Infinity,
    hasFlowEditor: true,
    hasTeamCollab: true,
    hasOrchestrator: true,
    hasPrioritySupport: true,
  },
  enterprise: {
    maxProjects: Infinity,
    maxAgents: Infinity,
    hasFlowEditor: true,
    hasTeamCollab: true,
    hasOrchestrator: true,
    hasPrioritySupport: true,
  },
};

/**
 * Canonical seat-count policy for team collaboration.
 *
 * ★MIRROR — `v3/functions/src/githubApp.ts` keeps the same values because
 * functions cannot import the desktop src package. Drift is pinned by
 * `githubApp.test.ts` and `tests/planLimits.test.ts`. The team-collab plan
 * *list* has a third copy in `firestore.rules` (`planGrantsTeamCollab`) —
 * that drift is pinned by `tests/unit/task-write-role-drift.test.ts`.
 *
 * This is intentionally only a count/policy constant, not billing code.
 * Enforcement (ticket gT9EXiONpzqFwY1xjc3n) lives at the invite choke points:
 * `orgOnboarding.checkTeamSeatForInvite` in the createOrgInvitation callable,
 * plus the firestore.rules plan gates on invitation creation and non-owner
 * task writes.
 */
export const TEAM_SEAT_ENTITLEMENTS: Readonly<
  Record<TeamCollabPlan, TeamSeatEntitlement>
> = Object.freeze({
  team: Object.freeze({
    includedSeats: 1,
    viewerConsumesSeat: false,
  }),
  team_plus: Object.freeze({
    includedSeats: 5,
    viewerConsumesSeat: false,
  }),
  enterprise: Object.freeze({
    includedSeats: Infinity,
    viewerConsumesSeat: false,
  }),
});

/** Full limits for a plan, defaulting unknown / future plans to `free`. */
export function getPlanLimits(plan: PlanType | string): PlanLimits {
  return PLAN_LIMITS[plan as PlanType] ?? PLAN_LIMITS.free;
}

/**
 * Feature gating sets by plan — string feature flags consumed by
 * `PlanGate` / `subscriptionStore.canUse`. This is the SINGLE source; the
 * subscription store imports it (no second copy). Kept consistent with the
 * PlanLimits booleans above (hasFlowEditor ↔ 'flows', unlimited projects ↔
 * 'unlimited_projects').
 *
 * Free intentionally includes 'agents' + 'activity_timeline' so the core
 * multi-agent board is usable (the aha moment) and the decision/activity
 * timeline is a visible teaser at every tier. Retention/export of that
 * timeline ('audit_logs') stays Team Plus+. Free excludes flows / missions /
 * orchestrator / unlimited_projects.
 *
 * 신규 feature 추가 시 5개 tier 전부 명시 (Record<PlanType> 가 누락 시 컴파일 에러).
 */
export const PLAN_FEATURES: Record<PlanType, ReadonlySet<string>> = {
  free: new Set(["board", "terminal", "editor", "agents", "activity_timeline"]),
  pro: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "activity_timeline",
    "flows",
    "missions",
    "unlimited_projects",
  ]),
  team: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "activity_timeline",
    "flows",
    "missions",
    "unlimited_projects",
    "team_members",
    "priority_support",
  ]),
  team_plus: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "activity_timeline",
    "flows",
    "missions",
    "unlimited_projects",
    "team_members",
    "priority_support",
    "sso",
    "audit_logs",
    "slack_support",
  ]),
  enterprise: new Set([
    "board",
    "terminal",
    "editor",
    "agents",
    "activity_timeline",
    "flows",
    "missions",
    "unlimited_projects",
    "team_members",
    "priority_support",
    "sso",
    "audit_logs",
    "slack_support",
    "saml",
    "on_prem",
    "sla",
    "dedicated_manager",
  ]),
};

/** Whether the given plan unlocks a feature flag (unknown plans → Free set). */
export function planCanUse(plan: PlanType | string, feature: string): boolean {
  const set = PLAN_FEATURES[plan as PlanType] ?? PLAN_FEATURES.free;
  return set.has(feature);
}

const ACTIVE_STATUSES: AgentStatus[] = ["idle", "working"];

/**
 * Agent concurrency limit for the given plan. Returns `-1` for unlimited so the
 * existing `checkAgentSpawn` sentinel logic keeps working. Unknown plan strings
 * default to Free's limit (restrictive) via `getPlanLimits` — corrupted data
 * can't buy unlimited concurrency. Real callers always pass a valid PlanType.
 */
export function getAgentLimit(plan: PlanType | string): number {
  const max = getPlanLimits(plan).maxAgents;
  return max === Infinity ? -1 : max;
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
  agents: Agent[],
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
        ? `Free 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성, 공정사용 상한). Pro로 업그레이드하면 무제한입니다.`
        : `현재 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성).`,
  };
}

export interface ProjectCreateCheck {
  allowed: boolean;
  /** Human-readable reason when blocked, suitable for inline UI display. */
  reason?: string;
  /** Current project count and the limit, so UI can render "N/M projects". */
  current: number;
  limit: number;
}

/**
 * Check whether creating one more project is allowed under the user's plan.
 *
 * `currentCount` = the number of projects the user already owns/has. The first
 * project is always allowed on Free (limit 1); the 2nd+ is blocked until Pro.
 */
export function checkProjectCreate(
  plan: PlanType | string,
  currentCount: number,
): ProjectCreateCheck {
  const limit = getPlanLimits(plan).maxProjects;
  if (limit === Infinity || currentCount < limit) {
    return { allowed: true, current: currentCount, limit };
  }
  return {
    allowed: false,
    current: currentCount,
    limit,
    reason:
      plan === "free"
        ? `Free 플랜은 프로젝트를 ${limit}개까지 만들 수 있습니다 (현재 ${currentCount}개). Pro로 업그레이드하면 무제한입니다.`
        : `현재 플랜은 프로젝트를 ${limit}개까지 만들 수 있습니다 (현재 ${currentCount}개).`,
  };
}

/**
 * Thrown by the project store's `createProject` choke point when the plan's
 * project limit is reached. The UI catches it (by `name`) and opens the
 * UpgradeModal instead of surfacing a raw error.
 */
export class ProjectLimitError extends Error {
  readonly check: ProjectCreateCheck;
  constructor(check: ProjectCreateCheck) {
    super(check.reason ?? "Project limit reached");
    this.name = "ProjectLimitError";
    this.check = check;
  }
}
