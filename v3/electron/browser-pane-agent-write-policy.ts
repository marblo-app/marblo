import { classifyInAppBrowserNavigation } from "./in-app-browser-policy";

/**
 * Stage 3a of the web-tab agent surface (ticket m6pSfPKMgNog8qonXsu4, design
 * doc docs/wiki/20-constraints/browser-session-approval-boundary.md §Stage 3):
 * agents may perform REVERSIBLE writes (typing into an input/textarea, filling
 * a form field) on a pane the owner has already logged into by hand — never
 * click, submit, or otherwise dispatch an irreversible action. This module is
 * the pure decision core, mirroring `browser-pane-agent-read-policy.ts` so it
 * stays unit-testable without booting a WebContentsView.
 *
 * ★The core design tension this ticket had to resolve: the design doc's (라)
 * option requires a pane the OWNER has already logged into — but Stage 1/2's
 * boundary was "never touch the owner's pane". Those two do not actually
 * conflict once "touch" is read the way Stage 1 already defined it: Stage 1
 * reads the owner's live pane too (not an isolated copy) and resolves the
 * tension with a per-pane, default-denied, owner-flippable GRANT — the
 * safety line is consent, not which pane. This ticket draws the same line for
 * writes: reuses the OWNER's `persist:marblo-browser-tab` pane (so the login
 * session it needs to be useful for actually exists, and so the owner
 * literally sees the typed value land on their own screen in real time —
 * there is no separate hidden surface to worry about showing them), gated by
 * a SEPARATE grant (`agentWriteGrantedPanes`, independent of the read grant —
 * per the design doc's explicit requirement that read-allowed must not imply
 * write-allowed). What stays off the table regardless of grant is anything
 * that leaves the browser (`actionKind: "submit"`, see below) — that line is
 * enforced in code, not by convention, so it is provable by test rather than
 * by comment.
 */

export type AgentWriteDenyReason =
  | "pane-not-found"
  | "global-stop"
  | "action-not-reversible"
  | "not-granted"
  | "rate-limited"
  | "sensitive-navigation"
  | "google-host";

export type AgentWriteDecision =
  | { allowed: true }
  | { allowed: false; reason: AgentWriteDenyReason };

/**
 * `"fill"` sets an input/textarea/contenteditable value and dispatches
 * input/change — never submits, clicks, or presses Enter. `"submit"` names
 * the boundary this ticket refuses to cross: no executor for it exists in
 * `browser-pane-agent-write.ts`, and this classifier denies it unconditionally
 * so that even if one is added later by mistake, the policy gate still stops
 * it before it can run. `"submit"` exists as a value here specifically so
 * that refusal is a tested branch, not an absence nobody can assert on.
 */
export type AgentWriteActionKind = "fill" | "submit";

export interface AgentWriteRequestInput {
  /** False if the paneId no longer resolves to a live BrowserPaneRecord. */
  paneExists: boolean;
  /** Per-pane owner grant for WRITE — independent of the read grant. */
  granted: boolean;
  /** The global stop switch (shared with Stage 1/2 reads/navigation). */
  globalStopActive: boolean;
  /** Result of a write-scoped rate limiter's `.allow()` for this request. */
  rateLimitOk: boolean;
  /** The pane's current URL at the moment of the write request. */
  currentUrl: string;
  actionKind: AgentWriteActionKind;
}

/**
 * Order is deliberate, like the read policy's:
 * 1. A vanished pane is checked first so "gone" and "stop" are never
 *    confused in a caller's error message.
 * 2. The global switch overrides everything below it, including a grant.
 * 3. `submit` is refused before the grant/rate-limit/page checks even run —
 *    an owner grant and a quiet moment can never combine into permission to
 *    submit, because that permission does not exist at any point in this
 *    chain.
 * 4. Grant, then rate limit, then page classification — same shape as reads.
 * 5. Google hosts are excluded last but unconditionally (product-owner
 *    directive, 2026-09-06: "구글로그인 제외하고 다른것들은 에이전트가
 *    할수있도록 가자"). `classifyInAppBrowserNavigation` already routes
 *    Google OAuth to `external`, so on most Google surfaces this branch is
 *    redundant with `sensitive-navigation` — but Gmail/Drive/etc. content
 *    pages are NOT auth/payment pages and would otherwise pass that check,
 *    so this is not decorative: it is what actually keeps Google itself out
 *    of 3a's scope.
 */
export function classifyAgentWriteRequest(
  input: AgentWriteRequestInput,
): AgentWriteDecision {
  if (!input.paneExists) return { allowed: false, reason: "pane-not-found" };
  if (input.globalStopActive) return { allowed: false, reason: "global-stop" };
  if (input.actionKind === "submit") {
    return { allowed: false, reason: "action-not-reversible" };
  }
  if (!input.granted) return { allowed: false, reason: "not-granted" };
  if (!input.rateLimitOk) return { allowed: false, reason: "rate-limited" };
  const navigation = classifyInAppBrowserNavigation(input.currentUrl);
  if (navigation.action !== "allow") {
    return { allowed: false, reason: "sensitive-navigation" };
  }
  if (isGoogleHost(input.currentUrl)) {
    return { allowed: false, reason: "google-host" };
  }
  return { allowed: true };
}

/**
 * Broader than `classifyInAppBrowserNavigation`'s OAuth-only Google check on
 * purpose: this excludes the whole product surface (search, Gmail, Drive,
 * YouTube), not just the sign-in host, because the owner's directive was
 * "구글은 제외" for this stage, not "except the login screen". Mirrors the
 * host set Aside's own docs treat as one Google identity
 * (docs.aside.com/help/passwords: "google.com, youtube.com, gmail.com").
 */
export function isGoogleHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const suffixes = [
    "google.com",
    "gmail.com",
    "youtube.com",
    "googleusercontent.com",
    "googlevideo.com",
    "ytimg.com",
  ];
  return suffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/** Bounds how much text a single fill can inject; a page's form field is
 * never an unbounded sink for agent-generated text. */
export const MAX_AGENT_FILL_VALUE_CHARS = 5_000;

export function capFillValue(value: string): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= MAX_AGENT_FILL_VALUE_CHARS) {
    return { value, truncated: false };
  }
  return {
    value: value.slice(0, MAX_AGENT_FILL_VALUE_CHARS),
    truncated: true,
  };
}
