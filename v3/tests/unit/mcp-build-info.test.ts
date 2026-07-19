import { describe, it, expect } from "vitest";
import {
  parseBuildStamp,
  describeBuildFreshness,
  formatBootBanner,
  formatDuration,
  shouldEmitStaleNotice,
  STALE_TOLERANCE_MS,
  type BuildStamp,
} from "../../electron/mcp-server/build-info";

const baked = (builtAtMs: number, commit = "abc1234"): BuildStamp => ({
  commit,
  builtAtMs,
  source: "baked",
});

describe("parseBuildStamp", () => {
  it("reads the JSON esbuild injects", () => {
    expect(parseBuildStamp('{"commit":"deadbee","builtAtMs":1000}')).toEqual({
      commit: "deadbee",
      builtAtMs: 1000,
    });
  });

  it("keeps a usable timestamp when git was unavailable at build time", () => {
    expect(parseBuildStamp('{"builtAtMs":1000}')).toEqual({
      commit: "unknown",
      builtAtMs: 1000,
    });
  });

  it("rejects anything without a finite timestamp rather than guessing", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "{}",
      '{"builtAtMs":"1000"}',
      '{"builtAtMs":null}',
      "[]",
      '"a string"',
    ]) {
      expect(parseBuildStamp(raw)).toBeNull();
    }
  });
});

describe("describeBuildFreshness — the SsHpTM43 stale-process trap", () => {
  // The measured incident: processes spawned 2026-07-12/14/16 kept serving
  // get_all_tasks after the 07-18 fix was built, with nothing reporting it.
  const spawnedJul16 = Date.UTC(2026, 6, 16, 8, 1);
  const rebuiltJul19 = Date.UTC(2026, 6, 19, 14, 23);

  it("flags a process older than the bundle on disk", () => {
    const f = describeBuildFreshness({
      stamp: baked(spawnedJul16),
      diskBuiltAtMs: rebuiltJul19,
    });
    expect(f.stale).toBe(true);
    expect(f.driftMs).toBe(rebuiltJul19 - spawnedJul16);
    expect(f.message).toContain("STALE build");
    expect(f.message).toContain("restart");
  });

  it("stays quiet when the process loaded the build that is on disk", () => {
    const f = describeBuildFreshness({
      stamp: baked(rebuiltJul19),
      diskBuiltAtMs: rebuiltJul19,
    });
    expect(f).toEqual({ stale: false, driftMs: 0, message: null });
  });

  it("tolerates small skew so the warning keeps its meaning", () => {
    const f = describeBuildFreshness({
      stamp: baked(rebuiltJul19),
      diskBuiltAtMs: rebuiltJul19 + STALE_TOLERANCE_MS - 1,
    });
    expect(f.stale).toBe(false);
  });

  it("does not claim freshness it cannot verify when unbundled", () => {
    // An mtime-derived stamp reads the same file it would be compared against,
    // so it can never detect drift; it must not masquerade as a real check.
    const f = describeBuildFreshness({
      stamp: { commit: "unknown", builtAtMs: spawnedJul16, source: "mtime" },
      diskBuiltAtMs: rebuiltJul19,
    });
    expect(f.stale).toBe(false);
    expect(f.message).toBeNull();
  });

  it("is inert when the disk build time cannot be read", () => {
    for (const disk of [null, NaN]) {
      expect(
        describeBuildFreshness({
          stamp: baked(spawnedJul16),
          diskBuiltAtMs: disk,
        }).stale,
      ).toBe(false);
    }
  });

  it("never reports an older disk build as stale", () => {
    const f = describeBuildFreshness({
      stamp: baked(rebuiltJul19),
      diskBuiltAtMs: spawnedJul16,
    });
    expect(f.stale).toBe(false);
  });
});

describe("formatDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatDuration(3 * 86_400_000)).toBe("3d");
    expect(formatDuration(5 * 3_600_000)).toBe("5h");
    expect(formatDuration(7 * 60_000)).toBe("7m");
    expect(formatDuration(9_000)).toBe("9s");
  });
});

describe("formatBootBanner", () => {
  it("states the build identity", () => {
    const line = formatBootBanner(
      baked(Date.UTC(2026, 6, 19), "abc1234"),
      "/x/index.js",
    );
    expect(line).toContain("abc1234");
    expect(line).toContain("2026-07-19");
    expect(line).toContain("/x/index.js");
  });

  it("admits when staleness cannot be detected instead of staying silent", () => {
    const line = formatBootBanner(null, "/x/index.js");
    expect(line).toContain("unstamped");
    expect(line).toContain("unavailable");
  });
});

describe("shouldEmitStaleNotice", () => {
  it("always speaks the first time", () => {
    expect(shouldEmitStaleNotice(null, 1_000)).toBe(true);
  });

  it("throttles repeats so the warning does not become noise", () => {
    expect(shouldEmitStaleNotice(1_000, 1_000 + 60_000, 30 * 60_000)).toBe(
      false,
    );
  });

  it("speaks again after the interval", () => {
    expect(shouldEmitStaleNotice(1_000, 1_000 + 30 * 60_000, 30 * 60_000)).toBe(
      true,
    );
  });
});
