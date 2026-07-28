/**
 * First-run flow bookkeeping — "is this install still mid-onboarding?"
 *
 * The flow itself (language → privacy consent) lives in
 * `components/onboarding/FirstRunFlow.tsx`; only the persisted marker is here,
 * so `App` can ask the question without importing the component and so the
 * rule is unit-testable.
 */
import { hasChosenLocale } from "./i18n";

/**
 * Marks "the first-run flow has started but not finished". Set when the flow
 * opens, removed when it completes.
 *
 * Without it, quitting between the two steps would strand the user:
 * `hasChosenLocale()` is already true by then, so the flow would not re-open
 * and the consent step would silently fall back to the old post-sign-in
 * timing — the very staggering this flow exists to remove.
 */
const FIRST_RUN_FLOW_KEY = "marblo.firstRun.inProgress";

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Should the first-run flow run at all?
 *
 * True on a genuinely fresh install, and on one interrupted mid-flow. False
 * for every existing install — deliberately: the flow collects consent before
 * sign-in, and an already-consented user's record lives under a uid we cannot
 * read that early, so running it for them would re-ask everyone exactly once.
 * Those users keep going through PrivacyConsentGate (policy-bump re-prompt).
 */
export function isFirstRunFlowPending(): boolean {
  if (!hasChosenLocale()) return true;
  try {
    return safeStorage()?.getItem(FIRST_RUN_FLOW_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark the flow as started. Best-effort — never throws. */
export function markFirstRunFlowStarted(): void {
  try {
    safeStorage()?.setItem(FIRST_RUN_FLOW_KEY, "1");
  } catch {
    // Worst case an interrupted flow falls back to the old post-login timing.
  }
}

/** Mark the flow as finished. Best-effort — never throws. */
export function markFirstRunFlowFinished(): void {
  try {
    safeStorage()?.removeItem(FIRST_RUN_FLOW_KEY);
  } catch {
    // best-effort
  }
}
