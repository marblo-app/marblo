/**
 * 무료 grant(founderGrant=true) 가 부여할 planType 판정 — 순수 함수, 의존성 0.
 *
 * ─── 왜 pro 가 아니라 team 인가 ───────────────────────────────────────
 * 베타/파운더 grant 는 "제품을 제대로 써보게 하는 것"이 목적이다. 그런데 협업·
 * 멤버 초대(PLAN_FEATURES 의 "team_members", PLAN_LIMITS 의 hasTeamCollab)는
 * team 부터 열린다 — pro 로 부여하면 베타 유저가 정작 팀 기능을 한 번도 못 만져
 * 보고 베타가 끝난다. 그래서 베타/파운더 reason 은 team 을 부여한다.
 *
 * ─── 왜 reason 별 표인가(전부 team 이 아니고) ─────────────────────────
 * upsertProSubscription 은 베타/파운더 grant 전용이 아니다 — 경험공유 설문
 * 보상(experience_share_reward)도 같은 함수를 탄다. 그건 "Pro 몇 개월"로 공지된
 * 보상이라 의미가 다르므로 기본값(pro)을 유지한다. reason 이 부여 플랜을
 * 결정하는 단일 지점을 여기 두어, 새 reason 이 생겨도 판정이 흩어지지 않게 한다.
 *
 * ─── 왜 강등 금지 가드가 필요한가 ─────────────────────────────────────
 * upsertProSubscription 은 기존 doc 에 merge 한다. beta_signup 으로 team 을 받은
 * 베타 유저가 나중에 경험공유 보상(pro)을 받으면, 가드가 없으면 그 merge 가
 * planType 을 team → pro 로 **강등**시켜 협업 기능이 조용히 사라진다. 기간을
 * 줄이지 않는 기존 불변식(periodEnd = max)과 같은 이유로 플랜도 내리지 않는다.
 *
 * ★가드는 "기존 문서가 무료 grant 일 때"만 적용한다. 해지·실효한 前결제자의
 * team_plus 잔재 doc 까지 max 로 계승하면, 무료 grant 가 결제한 적 없는 상위
 * 플랜을 영구 부여하는 오버그랜트가 된다(#943 과 같은 계열의 사고).
 */

/** 팀 기능(협업·멤버)까지 열어야 하는 grant reason. 베타/파운더 부여 3종. */
export const TEAM_GRANT_REASONS: readonly string[] = [
  "beta_selected",
  "beta_signup",
  "founder_backfill",
];

/** 팀 grant 가 부여하는 플랜. */
export const TEAM_GRANT_PLAN = "team";

/** 표에 없는 reason(경험공유 보상 등)의 기본 부여 플랜. */
export const DEFAULT_GRANT_PLAN = "pro";

/**
 * 플랜 서열. 강등 금지 비교에만 쓴다 — 값 자체는 대소 비교 외 의미가 없다.
 * 미지의 플랜 문자열은 -1 로 취급해 계승 대상에서 빠진다(모르는 걸 보존하다
 * 오버그랜트하지 않는다).
 */
const PLAN_RANK: Record<string, number> = {
  free: 0,
  pro: 1,
  team: 2,
  team_plus: 3,
  enterprise: 4,
};

export function planRank(plan: unknown): number {
  if (typeof plan !== "string") return -1;
  const rank = PLAN_RANK[plan];
  return typeof rank === "number" ? rank : -1;
}

/** 이 reason 이 부여해야 하는 플랜(기존 구독 무시한 순수 매핑). */
export function grantPlanTypeForReason(reason: unknown): string {
  if (typeof reason !== "string") return DEFAULT_GRANT_PLAN;
  return TEAM_GRANT_REASONS.includes(reason.trim())
    ? TEAM_GRANT_PLAN
    : DEFAULT_GRANT_PLAN;
}

/** 강등 금지 가드가 참조하는 기존 구독 스냅샷(필요한 필드만). */
export interface ExistingGrantSnapshot {
  planType?: unknown;
  founderGrant?: unknown;
  paymentProvider?: unknown;
}

/** index.ts isFounderGrantSubscription 과 동일 규칙(무료 grant 문서인가). */
function isFounderGrantDoc(sub: ExistingGrantSnapshot | undefined): boolean {
  if (!sub) return false;
  return sub.founderGrant === true || sub.paymentProvider === "founder_grant";
}

/**
 * 실제로 doc 에 쓸 planType.
 *
 * reason 매핑을 기본으로 하되, 기존 문서가 **무료 grant** 이고 그 플랜이 더
 * 상위면 그대로 유지한다(강등 금지). 유료·미지 문서의 플랜은 계승하지 않는다.
 */
export function resolveGrantPlanType(
  reason: unknown,
  existing?: ExistingGrantSnapshot | null,
): string {
  const target = grantPlanTypeForReason(reason);
  const prev = existing ?? undefined;
  if (!isFounderGrantDoc(prev)) return target;
  return planRank(prev?.planType) > planRank(target)
    ? (prev?.planType as string)
    : target;
}
