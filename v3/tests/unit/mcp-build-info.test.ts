import { describe, it, expect } from "vitest";
import {
  parseBuildStamp,
  describeBuildFreshness,
  describeSourceFreshness,
  mcpSourceDirForEntry,
  formatBootBanner,
  formatDuration,
  shouldEmitStaleNotice,
  STALE_TOLERANCE_MS,
  SOURCE_STALE_TOLERANCE_MS,
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

/*
 * The SECOND staleness axis: bundle-on-disk vs the sources it is built from.
 *
 * Ticket leS1OxfWKcemVfujMoBg. `describeBuildFreshness` above answers "is this
 * PROCESS older than the bundle on disk?", which only becomes true once
 * somebody rebuilds. The failure that actually bit on 2026-09-04 was the case
 * where nobody rebuilds: `electron/mcp-server` moved (an edit, or a merge
 * bringing a newer `tools.ts`), `dist-mcp` never did, and so the bundle's mtime
 * never moved either — leaving the process/disk check reporting `fresh` while
 * every server spawned from that bundle served pre-edit behaviour. These cases
 * pin the axis that catches it.
 */
describe("describeSourceFreshness", () => {
  const BUILT = 1_000_000_000_000;

  it("flags a bundle built before the sources changed", () => {
    const f = describeSourceFreshness({
      diskBuiltAtMs: BUILT,
      newestSourceMtimeMs: BUILT + 2 * 3_600_000,
      newestSourceName: "tools.ts",
    });
    expect(f.stale).toBe(true);
    expect(f.driftMs).toBe(2 * 3_600_000);
    expect(f.message).toContain("STALE ON DISK");
    expect(f.message).toContain("tools.ts");
    // The remedy must be REBUILD, not restart — restarting re-reads the same
    // stale bundle, which is exactly the loop this ticket exists to break.
    expect(f.message).toContain("build:mcp");
  });

  it("stays quiet when the bundle is newer than every source", () => {
    expect(
      describeSourceFreshness({
        diskBuiltAtMs: BUILT + 60_000,
        newestSourceMtimeMs: BUILT,
      }),
    ).toEqual({ stale: false, driftMs: 0, message: null });
  });

  it("absorbs timestamp granularity and clock skew inside the tolerance", () => {
    expect(
      describeSourceFreshness({
        diskBuiltAtMs: BUILT,
        newestSourceMtimeMs: BUILT + SOURCE_STALE_TOLERANCE_MS,
      }).stale,
    ).toBe(false);
    expect(
      describeSourceFreshness({
        diskBuiltAtMs: BUILT,
        newestSourceMtimeMs: BUILT + SOURCE_STALE_TOLERANCE_MS + 1,
      }).stale,
    ).toBe(true);
  });

  it("reports fresh — not a guess — when either side is unreadable", () => {
    for (const input of [
      { diskBuiltAtMs: null, newestSourceMtimeMs: BUILT },
      { diskBuiltAtMs: BUILT, newestSourceMtimeMs: null },
      { diskBuiltAtMs: Number.NaN, newestSourceMtimeMs: BUILT },
      { diskBuiltAtMs: BUILT, newestSourceMtimeMs: Number.NaN },
    ]) {
      expect(describeSourceFreshness(input).stale).toBe(false);
    }
  });

  it("does not need a build stamp — an unbundled process can still answer", () => {
    // This axis is a statement about FILES, so unlike describeBuildFreshness it
    // must not go blind when `__MARBLO_MCP_BUILD__` was never injected.
    const f = describeSourceFreshness({
      diskBuiltAtMs: BUILT,
      newestSourceMtimeMs: BUILT + 86_400_000,
    });
    expect(f.stale).toBe(true);
    expect(f.message).toContain("1d");
  });
});

describe("mcpSourceDirForEntry", () => {
  it("finds the sources that sit beside a dev bundle", () => {
    expect(mcpSourceDirForEntry("/repo/v3/dist-mcp/index.js")).toBe(
      "/repo/v3/electron/mcp-server",
    );
  });

  it("returns null in a packaged app, where no source tree ships", () => {
    // Resources/dist-mcp/index.js has no sibling electron/ tree. Returning a
    // path that merely fails to exist would make every packaged tool call pay
    // a doomed readdir; null says "unanswerable here" up front.
    expect(
      mcpSourceDirForEntry("/Applications/Marblo.app/Contents/Resources/x.js"),
    ).toBeNull();
  });

  it("returns null when the entry is not a dist-mcp bundle at all", () => {
    expect(mcpSourceDirForEntry("/repo/v3/dist-electron/main.js")).toBeNull();
    expect(mcpSourceDirForEntry(null)).toBeNull();
  });
});
