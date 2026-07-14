import { describe, expect, it } from "vitest";
import {
  resolveRateLimitWindows,
  windowKindByDuration,
  type AccountRateLimitWindows,
  type RepRateLimitValues,
} from "../../src/components/usage/rateLimitWindows";

const FIVE_HOUR_MINS = 300;
const WEEKLY_MINS = 10080;

describe("windowKindByDuration", () => {
  it("classifies 5h and weekly durations, tolerating drift", () => {
    expect(windowKindByDuration(FIVE_HOUR_MINS)).toBe("fiveHour");
    expect(windowKindByDuration(WEEKLY_MINS)).toBe("weekly");
    expect(windowKindByDuration(320)).toBe("fiveHour");
    expect(windowKindByDuration(10050)).toBe("weekly");
  });

  it("returns null when the duration is unknown", () => {
    expect(windowKindByDuration(null)).toBeNull();
    expect(windowKindByDuration(undefined)).toBeNull();
    expect(windowKindByDuration(Number.NaN)).toBeNull();
  });
});

describe("resolveRateLimitWindows", () => {
  it("Codex prolite: weekly-only account never renders a 5h gauge from a stale agent doc", () => {
    // prolite: primary is the weekly window (10080), secondary absent.
    const acct: AccountRateLimitWindows = {
      primaryPercent: 30,
      primaryResetAt: 111,
      primaryWindowDurationMins: WEEKLY_MINS,
      secondaryPercent: null,
      secondaryResetAt: null,
      secondaryWindowDurationMins: null,
    };
    // A leftover per-agent doc still carries a 5h percent from an older probe.
    const rep: RepRateLimitValues = {
      rateLimitPercent: 42,
      rateLimitResetAt: 999,
    };

    const r = resolveRateLimitWindows(acct, rep);
    expect(r.live).toBeUndefined(); // the bug: was 42
    expect(r.liveReset).toBeUndefined();
    expect(r.weekly).toBe(30);
    expect(r.weeklyReset).toBe(111);
    expect(r.weeklyOnly).toBe(true);
    expect(r.hasData).toBe(true);
  });

  it("Claude-style plan with both windows renders 5h and weekly (no regression)", () => {
    const acct: AccountRateLimitWindows = {
      primaryPercent: 20,
      primaryResetAt: 100,
      primaryWindowDurationMins: FIVE_HOUR_MINS,
      secondaryPercent: 60,
      secondaryResetAt: 200,
      secondaryWindowDurationMins: WEEKLY_MINS,
    };

    const r = resolveRateLimitWindows(acct, null);
    expect(r.live).toBe(20);
    expect(r.liveReset).toBe(100);
    expect(r.weekly).toBe(60);
    expect(r.weeklyReset).toBe(200);
    expect(r.weeklyOnly).toBe(false);
    expect(r.hasData).toBe(true);
  });

  it("legacy account with no window durations keeps primary=5h / secondary=weekly", () => {
    const acct: AccountRateLimitWindows = {
      primaryPercent: 15,
      primaryResetAt: 100,
      secondaryPercent: 55,
      secondaryResetAt: 200,
    };

    const r = resolveRateLimitWindows(acct, null);
    expect(r.live).toBe(15);
    expect(r.weekly).toBe(55);
    expect(r.weeklyOnly).toBe(false); // not duration-aware → no weekly-only claim
  });

  it("falls back to the per-agent doc only when there is no account snapshot", () => {
    const rep: RepRateLimitValues = {
      rateLimitPercent: 12,
      rateLimitResetAt: 100,
      rateLimitWeeklyPercent: 48,
      rateLimitWeeklyResetAt: 200,
    };

    const r = resolveRateLimitWindows(null, rep);
    expect(r.live).toBe(12);
    expect(r.liveReset).toBe(100);
    expect(r.weekly).toBe(48);
    expect(r.weeklyReset).toBe(200);
    expect(r.weeklyOnly).toBe(false); // no account → cannot assert weekly-only
    expect(r.hasData).toBe(true);
  });

  it("reports no data when neither source has any window", () => {
    const r = resolveRateLimitWindows(null, null);
    expect(r.live).toBeUndefined();
    expect(r.weekly).toBeUndefined();
    expect(r.weeklyOnly).toBe(false);
    expect(r.hasData).toBe(false);
  });
});
