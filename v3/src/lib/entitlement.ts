/**
 * 구독 엔타이틀먼트 판정 — 단일 규칙(순수 함수, 의존성 0).
 *
 * ★이 파일은 v3/functions/src/entitlement.ts 와 **바이트 단위로 동일한 규칙**을
 * 구현한다. functions 는 별도 npm 패키지라 렌더러 src 를 import 할 수 없어
 * (Cloud Build npm ci 가 깨진다) 부득이 두 벌을 둔다. 대신 drift 를 주석이 아니라
 * 테스트로 막는다 — tests/unit/subscription-entitlement.test.ts 가 두 구현을 모두
 * import 해 동일 케이스표에서 판정이 일치하는지 검증한다. 한쪽만 고치면 red 다.
 *
 * ─── 왜 status 단독으로는 안 되는가 ───────────────────────────────────
 * 토스 자발 해지(cancelTossSubscription)는 status="canceled" 만 쓰고 planType 은
 * 건드리지 않는다. status 단독 판정이면 결제 2일차에 해지한 사용자가 즉시 free 로
 * 강등돼 이미 낸 잔여 29일을 잃는다(환불도 없다). 해지는 "다음 결제를 멈추는 것"
 * 이지 "이미 산 기간을 몰수하는 것"이 아니다.
 *
 * ─── 왜 status 를 active 로 남기지 않는가 ─────────────────────────────
 * 토스 정기결제는 pull 모델이다. 토스 쪽에 recurring 객체가 있는 게 아니라 우리가
 * billingKey 로 매 사이클 직접 청구한다(scheduledChargeSubscriptions). 그 청구
 * 대상 선정(billing.ts selectDueForCharge)이 status==="active"|"past_due" 를
 * 조건으로 쓰므로, 해지 후 status 를 active 로 남기면 기간 말에 **해지한 사용자가
 * 다시 청구된다**. 따라서 status 는 canceled 그대로 두고 판정만 기간을 본다.
 *
 * ─── planType:"free" 는 하드 킬스위치다 ───────────────────────────────
 * "즉시 접근을 끊어야 하는" 경로는 모두 status=canceled 와 함께 planType:"free"
 * 를 쓴다 — 토스 환불 웹훅, 청구 3회 실패 해지, Paddle subscription.canceled.
 * 아래 규칙이 planType==="free" 를 무조건 free 로 떨어뜨리므로 그 경로들은 이
 * 변경의 영향을 받지 않는다(잔여기간을 얻는 건 자발 해지뿐).
 */

/** 갱신 크론(scheduledChargeSubscriptions)은 하루 1회(04:30 KST) 돈다. 만료
 *  경계와 크론 실행 사이에는 최대 ~24h 의 정상 시차가 있고, 그 구간의 사용자는
 *  이탈자가 아니라 갱신 대기자다. status 가 아직 active 인 동안만 이 유예를 주어
 *  정상 결제자가 매달 몇 시간씩 free 로 떨어지는 걸 막는다. 크론이 며칠 죽어도
 *  무한정 유료가 되지는 않도록 상한을 둔다(청구 실패 시엔 status 가 past_due/
 *  canceled 로 바뀌므로 이 유예는 애초에 적용되지 않는다). */
export const RENEWAL_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RENEWAL_GRACE_MS = RENEWAL_GRACE_DAYS * DAY_MS;

export interface EntitlementSnapshot {
  status?: string | null;
  planType?: string | null;
  /** Firestore Timestamp | Date 는 호출부에서 ms 로 정규화해 넘긴다. */
  currentPeriodEndMs?: number | null;
}

/**
 * 지금 이 구독이 부여하는 플랜을 돌려준다. 자격이 없으면 "free".
 *
 * 규칙:
 *  - planType 이 없거나 "free" → free (하드 킬스위치)
 *  - active  → 기간 미상(레거시 문서)이면 유료 유지(현행 무회귀),
 *              기간이 있으면 만료 + 갱신유예까지 유료
 *  - canceled → 기간이 **명시돼 있고 아직 안 지난** 경우에만 유료. 유예 없음
 *               (스스로 떠난 사용자에게 산 적 없는 기간을 줄 이유가 없다).
 *               기간 미상이면 free — 없는 기간을 지어내지 않는다.
 *  - past_due / trialing / 그 외 → free (현행 동작 그대로 유지)
 */
export function resolveEntitledPlan(
  sub: EntitlementSnapshot | null | undefined,
  nowMs: number,
): string {
  if (!sub) return "free";
  const planType = typeof sub.planType === "string" ? sub.planType : "";
  if (!planType || planType === "free") return "free";

  const endMs =
    typeof sub.currentPeriodEndMs === "number" &&
    Number.isFinite(sub.currentPeriodEndMs)
      ? sub.currentPeriodEndMs
      : null;

  switch (sub.status) {
    case "active":
      // 레거시(기간 미기록) 문서는 현행대로 유료 유지 — 유료 사용자를 이 변경으로
      // 강등시키지 않는다.
      if (endMs === null) return planType;
      return endMs + RENEWAL_GRACE_MS > nowMs ? planType : "free";
    case "canceled":
      return endMs !== null && endMs > nowMs ? planType : "free";
    default:
      return "free";
  }
}

/** 해지했지만 아직 결제한 기간이 남아 "유료 접근 중"인 상태인가. UI 배지·문구용. */
export function isCanceledButStillEntitled(
  sub: EntitlementSnapshot | null | undefined,
  nowMs: number,
): boolean {
  if (!sub || sub.status !== "canceled") return false;
  return resolveEntitledPlan(sub, nowMs) !== "free";
}
