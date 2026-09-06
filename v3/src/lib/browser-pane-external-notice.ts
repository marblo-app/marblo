/**
 * What the Web tab shows when a navigation was pushed out to the system
 * browser — and, crucially, what the user can do next.
 *
 * The problem this fixes (사장님 2026-09-06: "이건 안 들어가져"). A Web tab
 * sitting on `claude.ai/login` offers two sign-ins. Clicking the top one,
 * "Continue with Google", navigates to `accounts.google.com`, which
 * `classifyInAppBrowserNavigation` classifies `google-auth` → external. The
 * pane cancels the navigation, records a notice, and — because
 * `shouldShowNativeBrowserView` hides the native view for ANY notice — the
 * still-loaded sign-in page vanishes behind a full-pane failure block whose
 * only action is "외부 브라우저로 열기". Signing in over there does not sign
 * the user in here (different session), and nothing on screen says so or
 * leads back. The tab is a dead end.
 *
 * Two facts make the way out concrete, and both are observed, not assumed:
 *
 *  1. Google really does refuse embedded OAuth user agents
 *     (`disallowed_useragent`), so that half is not ours to fix — see
 *     docs/wiki/20-constraints/in-app-link-routing.md.
 *  2. The SAME page offers `<input type="email">` + "Continue with email", an
 *     ordinary form post that never leaves `claude.ai`. That path is
 *     classified `allow`, completes inside the pane, and its cookies persist
 *     in `persist:marblo-browser-tab` — so the site opens signed in next
 *     time. (Stage 3 (라) in
 *     docs/wiki/20-constraints/browser-session-approval-boundary.md, the one
 *     option judged to hold today.)
 *
 * So a sign-in externalization needs different copy from a payment or a
 * `mailto:`, and — whenever the pane still has a live page behind the block —
 * a way back to it. That decision is a pure function so the rules are pinned
 * by unit tests instead of by reading JSX.
 */

/** The one-sentence reason shown on the block, as an i18n key. */
export type BrowserPaneExternalReasonKey =
  | "workspace.browser.external.reason"
  | "workspace.browser.external.signInReason";

export interface BrowserPaneExternalNoticeInput {
  code: BrowserPaneNoticeCode;
  /**
   * Does the pane still hold a rendered page behind the block? True only
   * once the native view has been shown for a real URL: the notice paths
   * that matter here (`will-navigate` → preventDefault) leave the previous
   * page loaded and merely hidden, so returning to it is a no-op navigation.
   */
  hasPageBehind: boolean;
}

export interface BrowserPaneExternalNotice {
  reasonKey: BrowserPaneExternalReasonKey;
  /** Offer "back to the page" — only meaningful when a page is behind it. */
  canReturnToPage: boolean;
}

/**
 * Codes that mean "we handed this URL to the system browser instead of
 * rendering it here", i.e. the ones that take over the whole pane. Every
 * other code (load-failed, blocked-url, …) stays a dismissible bottom bar.
 */
const EXTERNAL_CODES: readonly BrowserPaneNoticeCode[] = [
  "google-auth-external",
  "auth-external",
  "payment-external",
  "external-protocol",
  "tab-open-failed",
];

/** Sign-in externalizations — the only ones with an in-app alternative. */
const SIGN_IN_CODES: readonly BrowserPaneNoticeCode[] = [
  "google-auth-external",
  "auth-external",
];

export function isBrowserPaneExternalNotice(
  code: BrowserPaneNoticeCode,
): boolean {
  return EXTERNAL_CODES.includes(code);
}

/** Null when `code` is not an externalization (caller keeps the bottom bar). */
export function browserPaneExternalNotice(
  input: BrowserPaneExternalNoticeInput,
): BrowserPaneExternalNotice | null {
  if (!isBrowserPaneExternalNotice(input.code)) return null;
  return {
    reasonKey: SIGN_IN_CODES.includes(input.code)
      ? "workspace.browser.external.signInReason"
      : "workspace.browser.external.reason",
    canReturnToPage: input.hasPageBehind,
  };
}
