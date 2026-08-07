/**
 * 쿠폰 할인 표시 계산 — 서버 applyCouponDiscount(v3/functions/src/billing.ts) 의 미러.
 *
 * ★두 곳이 갈리면 화면 금액과 실청구가 달라진다. 예전엔 체크아웃이
 * discountPercent 만 봤기 때문에, 첫 결제를 전액 면제하는 free_trial /
 * plan_upgrade 쿠폰을 넣어도 총액이 정가로 남아 있었다(₩19,000 이라 써놓고
 * ₩0 을 청구). 서버 switch 와 같은 규칙을 여기 한 곳에만 둔다.
 *
 * 단, 여기서 계산한 금액은 어디까지나 **표시용 예상액**이다. 실청구액은 서버가
 * 청구 후 돌려주는 chargedAmount / 구독 문서의 lastChargeAmount 가 정본이다 —
 * 쿠폰이 만료·소진·중복이면 서버가 정가로 폴백하기 때문이다.
 */
export interface CouponLike {
  type?: string;
  discountPercent?: number;
}

export function couponDiscountAmount(
  baseAmount: number,
  coupon: CouponLike | null | undefined,
): number {
  if (!coupon || baseAmount <= 0) return 0;
  switch (coupon.type) {
    case "discount":
      return Math.min(
        baseAmount,
        Math.round((baseAmount * (coupon.discountPercent || 0)) / 100),
      );
    // 첫 결제 면제형 — 총액 0원.
    case "free_trial":
    case "plan_upgrade":
      return baseAmount;
    default:
      // 타입이 없는 구형 쿠폰 문서는 percent 로 취급(서버 default 는 0원 할인이나,
      // validateCoupon 이 discountPercent 만 주던 시절 문서와의 호환).
      return coupon.discountPercent
        ? Math.min(
            baseAmount,
            Math.round((baseAmount * coupon.discountPercent) / 100),
          )
        : 0;
  }
}

/** 이 쿠폰이 첫 결제를 전액 면제하는가(화면에 "무료" 로 표기). */
export function isFullyComped(
  baseAmount: number,
  coupon: CouponLike | null | undefined,
): boolean {
  return (
    baseAmount > 0 && couponDiscountAmount(baseAmount, coupon) >= baseAmount
  );
}
