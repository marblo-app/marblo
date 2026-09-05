/**
 * Renderer-side policy for the stale-main-process notice
 * (src/lib/staleMainBuild.ts, ticket 4HMJGUJBo0tKPU4mgHyr).
 *
 * Two contracts are pinned here. The banner must appear for `stale` and for
 * NOTHING else — "cannot tell" is not evidence of a problem, and a banner that
 * shows up mid-rebuild would train the reader to skip it. And the IPC payload
 * must be validated rather than trusted: the situation this feature reports on
 * is precisely one where the main process is older than the renderer, so it is
 * the one channel most likely to answer with a shape the UI does not expect.
 */
import { describe, expect, it } from "vitest";

import {
  parseMainBuildReport,
  shouldShowStaleBuildBanner,
  summarizeChangedModules,
  type MainBuildReport,
} from "../../src/lib/staleMainBuild";

const STALE: MainBuildReport = {
  verdict: "stale",
  reason: "content-changed",
  changedModules: ["local-models.js", "bridge-server.js"],
  changedCount: 2,
  bootBuiltAtMs: 1,
  diskBuiltAtMs: 2,
};

describe("shouldShowStaleBuildBanner", () => {
  it("shows for a stale verdict", () => {
    expect(
      shouldShowStaleBuildBanner({ report: STALE, dismissed: false }),
    ).toBe(true);
  });

  it("stays silent for fresh, for every unknown, and for no report at all", () => {
    const silent: Array<MainBuildReport | null> = [
      null,
      { ...STALE, verdict: "fresh", reason: "identical" },
      { ...STALE, verdict: "unknown", reason: "build-in-flight" },
      { ...STALE, verdict: "unknown", reason: "no-boot-snapshot" },
      { ...STALE, verdict: "unknown", reason: "no-disk-snapshot" },
      { ...STALE, verdict: "unknown", reason: "empty-scan" },
    ];
    for (const report of silent) {
      expect(
        shouldShowStaleBuildBanner({ report, dismissed: false }),
        `${report?.verdict ?? "null"}/${report?.reason ?? "-"} must not show`,
      ).toBe(false);
    }
  });

  it("stays dismissed — the condition cannot clear without the restart", () => {
    expect(shouldShowStaleBuildBanner({ report: STALE, dismissed: true })).toBe(
      false,
    );
  });
});

describe("parseMainBuildReport", () => {
  it("accepts a well-formed report", () => {
    expect(parseMainBuildReport({ ...STALE })).toEqual(STALE);
  });

  it("rejects anything that is not a report", () => {
    for (const bad of [
      null,
      undefined,
      "stale",
      42,
      {},
      { verdict: "stale" },
      { verdict: "nonsense", reason: "content-changed" },
      { verdict: "stale", reason: "nonsense" },
    ]) {
      expect(parseMainBuildReport(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("drops non-string entries from the module list", () => {
    const parsed = parseMainBuildReport({
      ...STALE,
      changedModules: ["ok.js", 7, null, "also-ok.js"],
    });
    expect(parsed?.changedModules).toEqual(["ok.js", "also-ok.js"]);
  });

  it("never lets the count contradict the list it came with", () => {
    // An older main process could send a count that disagrees with the array;
    // the summary line must not then claim a negative overflow.
    const parsed = parseMainBuildReport({
      ...STALE,
      changedModules: ["a.js", "b.js"],
      changedCount: 1,
    });
    expect(parsed?.changedCount).toBe(2);
  });

  it("falls back to the list length when the count is missing or absurd", () => {
    expect(
      parseMainBuildReport({
        verdict: "stale",
        reason: "content-changed",
        changedModules: ["a.js"],
      })?.changedCount,
    ).toBe(1);
    expect(
      parseMainBuildReport({ ...STALE, changedCount: Number.NaN })
        ?.changedCount,
    ).toBe(2);
  });

  it("normalizes non-numeric timestamps to null rather than NaN", () => {
    const parsed = parseMainBuildReport({
      ...STALE,
      bootBuiltAtMs: "yesterday",
      diskBuiltAtMs: Number.POSITIVE_INFINITY,
    });
    expect(parsed?.bootBuiltAtMs).toBeNull();
    expect(parsed?.diskBuiltAtMs).toBeNull();
  });
});

describe("summarizeChangedModules", () => {
  it("reports no overflow when the list is complete", () => {
    expect(summarizeChangedModules(STALE)).toEqual({
      names: ["local-models.js", "bridge-server.js"],
      overflowCount: 0,
    });
  });

  it("reports the remainder when the list was truncated", () => {
    expect(summarizeChangedModules({ ...STALE, changedCount: 9 })).toEqual({
      names: ["local-models.js", "bridge-server.js"],
      overflowCount: 7,
    });
  });

  it("is empty for no report", () => {
    expect(summarizeChangedModules(null)).toEqual({
      names: [],
      overflowCount: 0,
    });
  });
});
