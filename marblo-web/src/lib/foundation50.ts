// Founder beta (KO: 마블로 파운더 100인 무료 베타) shared config.
// NOTE: internal identifiers (foundation50 route, betatester50_waitlist
// collection, NEXT_PUBLIC_FOUNDATION50_OPEN env) keep the legacy "50" name
// to preserve existing links and signup data — only user-facing copy says 100.
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
