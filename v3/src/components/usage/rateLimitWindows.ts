/**
 * Rate-limit window resolution for the Usage panel.
 *
 * A provider's account snapshot may carry a 5-hour window, a weekly window,
 * both, or (for plans like Codex `prolite`) only a weekly window. The panel
 * must render a gauge ONLY for windows that genuinely exist for that plan.
 *
 * The subtle bug this guards against: when the account snapshot authoritatively
 * has no 5-hour window, a stale per-agent doc (`rep`) must NOT resurrect that
 * window with a bogus percent. Historically `live = accountLive ?? rep.percent`
 * did exactly that — a weekly-only plan showed an empty/wrong 5h gauge from a
 * leftover agent-doc value.
 *
 * Windows are identified by `windowDurationMins` (≈300 → 5h, ≈10080 → weekly),
 * matching the classification the Codex probe emits. See
 * codex_cli_0144_appserver_probe_drift.
 */

export type RateLimitWindowKind = "fiveHour" | "weekly";

/** Structural view of the account snapshot fields this module reads. A full
 * `RateLimitSnapshot` (which also carries `planType`) is assignable to this. */
export interface AccountRateLimitWindows {
  primaryPercent: number | null;
  primaryResetAt: number | null;
  primaryWindowDurationMins?: number | null;
  secondaryPercent: number | null;
  secondaryResetAt: number | null;
  secondaryWindowDurationMins?: number | null;
}

/** Per-agent doc fallback values (only used when no account snapshot exists). */
export interface RepRateLimitValues {
  rateLimitPercent?: number | null;
  rateLimitResetAt?: number | null;
  rateLimitWeeklyPercent?: number | null;
  rateLimitWeeklyResetAt?: number | null;
}

export interface ResolvedRateLimitWindows {
  /** 5-hour window utilization %. undefined = this plan has no 5h window. */
  live?: number;
  liveReset?: number;
  /** weekly (7-day) window utilization %. undefined = no weekly window. */
  weekly?: number;
  weeklyReset?: number;
  /** true when the account authoritatively carries a weekly window but NO
   * 5-hour window (e.g. Codex `prolite`) — cue for a "weekly-only" hint. */
  weeklyOnly: boolean;
  /** true when at least one real window value is available to render. */
  hasData: boolean;
}

/** Classify a window by its duration in minutes. Returns null when unknown. */
export function windowKindByDuration(
  durationMins: number | null | undefined,
): RateLimitWindowKind | null {
  if (typeof durationMins !== "number" || !Number.isFinite(durationMins)) {
    return null;
  }
  if (Math.abs(durationMins - 10080) <= 60) return "weekly";
  if (Math.abs(durationMins - 300) <= 60) return "fiveHour";
  if (durationMins >= 7 * 24 * 60) return "weekly";
  return "fiveHour";
}

/** Resolve the account snapshot's value for one window kind, or null when the
 * snapshot does not carry that window. */
export function readAccountWindow(
  acct: AccountRateLimitWindows | null | undefined,
  kind: RateLimitWindowKind,
): { percent: number; resetAt?: number } | null {
  if (!acct) return null;
  const primaryKind = windowKindByDuration(acct.primaryWindowDurationMins);
  const secondaryKind = windowKindByDuration(acct.secondaryWindowDurationMins);
  if (primaryKind === kind && typeof acct.primaryPercent === "number") {
    return {
      percent: acct.primaryPercent,
      resetAt: acct.primaryResetAt ?? undefined,
    };
  }
  if (secondaryKind === kind && typeof acct.secondaryPercent === "number") {
    return {
      percent: acct.secondaryPercent,
      resetAt: acct.secondaryResetAt ?? undefined,
    };
  }
  // Legacy convention when neither window declares a duration: primary is the
  // 5h window, secondary is the weekly window (pre-duration Claude captures).
  if (
    primaryKind === null &&
    secondaryKind === null &&
    kind === "fiveHour" &&
    typeof acct.primaryPercent === "number"
  ) {
    return {
      percent: acct.primaryPercent,
      resetAt: acct.primaryResetAt ?? undefined,
    };
  }
  if (
    primaryKind === null &&
    secondaryKind === null &&
    kind === "weekly" &&
    typeof acct.secondaryPercent === "number"
  ) {
    return {
      percent: acct.secondaryPercent,
      resetAt: acct.secondaryResetAt ?? undefined,
    };
  }
  if (
    secondaryKind === null &&
    kind === "weekly" &&
    typeof acct.secondaryPercent === "number"
  ) {
    return {
      percent: acct.secondaryPercent,
      resetAt: acct.secondaryResetAt ?? undefined,
    };
  }
  return null;
}

/** True when the account snapshot classifies at least one window by duration —
 * i.e. the set of windows it carries is authoritative. When true, a window kind
 * it does NOT carry genuinely does not exist for this plan. */
function accountIsDurationAware(
  acct: AccountRateLimitWindows | null | undefined,
): boolean {
  if (!acct) return false;
  return (
    windowKindByDuration(acct.primaryWindowDurationMins) !== null ||
    windowKindByDuration(acct.secondaryWindowDurationMins) !== null
  );
}

function numOrUndef(v: number | null | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Resolve the 5h + weekly windows to render for one provider.
 *
 * The account snapshot is canonical. The per-agent doc (`rep`) is consulted
 * ONLY when the account snapshot is not duration-aware (logged out / probe gave
 * no window data) — never to override or invent a window the account already
 * spoke to. This is what stops a weekly-only plan from rendering a bogus 5h
 * gauge sourced from a stale agent doc.
 */
export function resolveRateLimitWindows(
  acct: AccountRateLimitWindows | null | undefined,
  rep: RepRateLimitValues | null | undefined,
): ResolvedRateLimitWindows {
  const accountLive = readAccountWindow(acct, "fiveHour");
  const accountWeekly = readAccountWindow(acct, "weekly");
  const durationAware = accountIsDurationAware(acct);

  const live =
    accountLive?.percent ??
    (durationAware ? undefined : numOrUndef(rep?.rateLimitPercent));
  const liveReset =
    accountLive?.resetAt ??
    (durationAware ? undefined : numOrUndef(rep?.rateLimitResetAt));
  const weekly =
    accountWeekly?.percent ??
    (durationAware ? undefined : numOrUndef(rep?.rateLimitWeeklyPercent));
  const weeklyReset =
    accountWeekly?.resetAt ??
    (durationAware ? undefined : numOrUndef(rep?.rateLimitWeeklyResetAt));

  return {
    live,
    liveReset,
    weekly,
    weeklyReset,
    weeklyOnly:
      durationAware && typeof weekly === "number" && typeof live !== "number",
    hasData: typeof live === "number" || typeof weekly === "number",
  };
}
