import { classifyInAppBrowserNavigation } from "./in-app-browser-policy";

/**
 * Stage 1 of the web-tab agent surface (ticket FQ7nshXHjDWOvD0WWUVV):
 * agents may only READ a pane's current page, never click/type/submit. This
 * module is the pure decision core for that read path — no Electron import,
 * so every rule is unit-testable without booting a WebContentsView.
 *
 * Design answers this module encodes (full rationale in
 * docs/wiki/20-constraints/browser-session-approval-boundary.md):
 *
 * 1. Session: reads happen against the SAME `persist:marblo-browser-tab`
 *    pane the owner already has open (not an isolated/headless session) —
 *    because the one real workflow gap identified is "읽어야 하는데 로그인
 *    없이는 못 보는 화면", which an isolated session can't satisfy. The
 *    safety trade this creates is answered by (2): nothing is readable by
 *    default, per pane, until the owner explicitly grants it.
 * 2. Approval: read access is granted per-pane (not per-session, not
 *    globally) and defaults to denied. A grant only covers the ONE pane the
 *    owner flipped, not the shared partition — closing/reusing a pane drops
 *    it. Auth/payment pages are never readable even if the surrounding pane
 *    is granted (reuses `classifyInAppBrowserNavigation`, the same
 *    allow/external split that already keeps those pages out of the pane).
 * 3. Contention: the owner's use of the pane is untouched by an agent read —
 *    a read is a point-in-time snapshot (`executeJavaScript`), not a
 *    takeover, and never blocks or redirects the owner's own navigation.
 *    See `browser-pane-agent-read.ts` for why this ruled out attaching the
 *    Chrome DevTools Protocol (`webContents.debugger`).
 */

export type AgentReadDenyReason =
  | "pane-not-found"
  | "global-stop"
  | "not-granted"
  | "rate-limited"
  | "sensitive-navigation";

export type AgentReadDecision =
  | { allowed: true }
  | { allowed: false; reason: AgentReadDenyReason };

export interface AgentReadRequestInput {
  /** False if the paneId no longer resolves to a live BrowserPaneRecord. */
  paneExists: boolean;
  /** Per-pane owner grant (default false — see design note 2 above). */
  granted: boolean;
  /** The global stop switch (design doc §B) — overrides every grant. */
  globalStopActive: boolean;
  /** Result of `AgentReadRateLimiter.allow()` for this request. */
  rateLimitOk: boolean;
  /** The pane's current URL at the moment of the read request. */
  currentUrl: string;
}

/**
 * Order is deliberate and load-bearing (each branch is a distinct test case):
 * a vanished pane is checked before the global switch so "stop everything"
 * and "pane already closed" never get confused in a caller's error message;
 * the global switch is checked before the per-pane grant so tripping it
 * denies reads even on panes that were already granted; sensitive-page
 * classification runs last because it is the one check that still applies
 * even to a granted, non-rate-limited, non-suspended read.
 */
export function classifyAgentReadRequest(
  input: AgentReadRequestInput,
): AgentReadDecision {
  if (!input.paneExists) return { allowed: false, reason: "pane-not-found" };
  if (input.globalStopActive) return { allowed: false, reason: "global-stop" };
  if (!input.granted) return { allowed: false, reason: "not-granted" };
  if (!input.rateLimitOk) return { allowed: false, reason: "rate-limited" };
  const navigation = classifyInAppBrowserNavigation(input.currentUrl);
  if (navigation.action !== "allow") {
    return { allowed: false, reason: "sensitive-navigation" };
  }
  return { allowed: true };
}

/** One in-flight read the global stop must be able to cancel for real. */
export interface AgentReadInFlightEntry {
  paneId: string;
  agentId: string;
  ticketId?: string;
  /** Aborts the underlying `executeJavaScript` call (AbortController-style). */
  abort: () => void;
}

/**
 * The global kill switch (design doc §B, "★전역 중지 버튼"). Tripping it
 * must not just block future reads — it must reach into whatever is already
 * running, which is why `suspend()` walks and aborts every registered
 * in-flight read and reports how many it actually stopped, instead of just
 * flipping a boolean nobody was blocked by.
 */
export class GlobalBrowserAccessSwitch {
  private suspended = false;
  private readonly inFlight = new Map<string, AgentReadInFlightEntry>();

  isSuspended(): boolean {
    return this.suspended;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  register(requestId: string, entry: AgentReadInFlightEntry): void {
    this.inFlight.set(requestId, entry);
  }

  unregister(requestId: string): void {
    this.inFlight.delete(requestId);
  }

  /** Trips the stop. Returns how many in-flight reads it actually aborted,
   * so the caller can prove (and log) that the button did something. */
  suspend(): { abortedCount: number } {
    this.suspended = true;
    const entries = [...this.inFlight.values()];
    this.inFlight.clear();
    for (const entry of entries) {
      entry.abort();
    }
    return { abortedCount: entries.length };
  }

  resume(): void {
    this.suspended = false;
  }
}

export interface AgentReadRateLimiterOptions {
  /** Minimum gap between two reads of the SAME pane. */
  minIntervalMsPerPane?: number;
  /** Ceiling on reads across ALL panes in a trailing 60s window. */
  maxPerMinuteGlobal?: number;
  now?: () => number;
}

const DEFAULT_MIN_INTERVAL_MS = 2000;
const DEFAULT_MAX_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;

/**
 * Origin-agnostic throttle so an agent reading a webtab page can't look like
 * a scraping burst to the site it's reading (product-owner-flagged risk:
 * ad/CMS platforms lock accounts on abnormal request patterns from a live
 * login session). Deliberately crude — a fixed per-pane cooldown plus a
 * global per-minute cap — because the goal is "never bursts", not "optimal
 * throughput".
 */
export class AgentReadRateLimiter {
  private readonly minIntervalMs: number;
  private readonly maxPerMinute: number;
  private readonly now: () => number;
  private readonly lastReadAtByPane = new Map<string, number>();
  private globalReadTimestamps: number[] = [];

  constructor(opts: AgentReadRateLimiterOptions = {}) {
    this.minIntervalMs = opts.minIntervalMsPerPane ?? DEFAULT_MIN_INTERVAL_MS;
    this.maxPerMinute = opts.maxPerMinuteGlobal ?? DEFAULT_MAX_PER_MINUTE;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Pure check — does NOT consume budget. Callers must only call `record()`
   * once a read this returned true for actually proceeds, so a request
   * denied for an unrelated reason (not granted, global stop) never burns
   * rate-limit budget it didn't use.
   */
  allow(paneKey: string): boolean {
    const at = this.now();
    const last = this.lastReadAtByPane.get(paneKey);
    if (last !== undefined && at - last < this.minIntervalMs) return false;
    const windowStart = at - RATE_WINDOW_MS;
    const recentCount = this.globalReadTimestamps.filter(
      (t) => t > windowStart,
    ).length;
    return recentCount < this.maxPerMinute;
  }

  record(paneKey: string): void {
    const at = this.now();
    this.lastReadAtByPane.set(paneKey, at);
    this.globalReadTimestamps.push(at);
    const windowStart = at - RATE_WINDOW_MS;
    this.globalReadTimestamps = this.globalReadTimestamps.filter(
      (t) => t > windowStart,
    );
  }
}

/**
 * High-confidence secret shapes only (provider key prefixes, JWTs, PAN-like
 * digit runs) — this is a defense-in-depth net on top of the pane-grant
 * boundary, not a general PII scrubber. A page's ordinary visible text
 * (names, numbers, prose) is the entire point of the read and reaches the
 * agent regardless; this only strips the small set of tokens that are never
 * useful to hand an LLM and are unambiguously identifiable by shape.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:\d[ -]?){13,19}\b/g,
];

export interface RedactedText {
  text: string;
  redactedCount: number;
}

export function redactLikelySecrets(text: string): RedactedText {
  let redactedCount = 0;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      redactedCount += 1;
      return "<REDACTED>";
    });
  }
  return { text: out, redactedCount };
}

/** Bounds token/log cost per read; a page's full text is never unbounded. */
export const MAX_AGENT_READ_TEXT_CHARS = 20_000;

export interface CappedText {
  text: string;
  truncated: boolean;
}

export function capReadText(
  text: string,
  maxChars: number = MAX_AGENT_READ_TEXT_CHARS,
): CappedText {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
