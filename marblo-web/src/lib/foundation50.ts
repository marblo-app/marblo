// Foundation 50 (KO: 베타 얼리버드 50 / 초기 베타테스터 50인) shared config.
//
// Signup now writes directly to Firestore (collection: betatester50_waitlist)
// via BetaTester50SignupForm — no Google Form involved.
//
// HOW TO TURN OFF the promo bar (after the cohort fills up):
//   Set NEXT_PUBLIC_FOUNDATION50_OPEN=false in the environment and redeploy.
//   The foundation50 landing page itself stays live; only the site-wide
//   promo bar disappears.

export function isPromoBarOpen(): boolean {
  // Default to true so the bar is visible until explicitly turned off.
  const flag = process.env.NEXT_PUBLIC_FOUNDATION50_OPEN;
  return flag === undefined || flag === "" || flag === "true";
}

export const PROMO_BAR_DISMISS_KEY = "foundation50-promo-dismissed";
