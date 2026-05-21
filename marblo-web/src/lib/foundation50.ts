// Foundation 50 (KO: 베타 얼리버드 50) shared config.
//
// HOW TO ACTIVATE the live Google Form:
//   1. Create the form at https://forms.google.com — questions and consent
//      copy live in docs/HANDOFF_foundation50.md
//   2. Click "Send" → "Link" tab → copy the share URL (it looks like
//      https://docs.google.com/forms/d/e/<ID>/viewform) and paste it into
//      GOOGLE_FORM_URL below
//   3. To find EMAIL_ENTRY_ID:
//      - Open the form, right-click the email question → "Get pre-filled link"
//      - Fill any value in the email field, click "Get link", then "Copy link"
//      - The URL contains "entry.<number>=..." — use that "entry.<number>"
//        string (e.g. "entry.1234567890") as EMAIL_ENTRY_ID
//
// HOW TO TURN OFF the promo bar (after the cohort fills up):
//   - Set NEXT_PUBLIC_FOUNDATION50_OPEN=false in the environment and redeploy.
//   - The foundation50 landing page itself stays live (so existing waitlist
//     members can still reach it); only the site-wide promo bar disappears.

export const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/d/e/REPLACE_ME/viewform";

export const EMAIL_ENTRY_ID = "entry.REPLACE_ME";

export function buildPrefillUrl(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return GOOGLE_FORM_URL;
  try {
    const url = new URL(GOOGLE_FORM_URL);
    url.searchParams.set("usp", "pp_url");
    url.searchParams.set(EMAIL_ENTRY_ID, trimmed);
    return url.toString();
  } catch {
    return GOOGLE_FORM_URL;
  }
}

export function isPromoBarOpen(): boolean {
  // Default to true so the bar is visible until explicitly turned off.
  const flag = process.env.NEXT_PUBLIC_FOUNDATION50_OPEN;
  return flag === undefined || flag === "" || flag === "true";
}

export const PROMO_BAR_DISMISS_KEY = "foundation50-promo-dismissed";
