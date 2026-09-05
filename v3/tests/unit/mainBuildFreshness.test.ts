/**
 * Truth table for the main-process staleness verdict
 * (electron/main-build-freshness.ts, ticket 4HMJGUJBo0tKPU4mgHyr).
 *
 * The feature's whole value rests on this function being right in BOTH
 * directions: a missed "stale" costs a debugging session (#1418, #1420, #1422
 * on 2026-09-05), and a spurious "stale" costs the banner its credibility,
 * after which the next real one is ignored too. So every row below is pinned —
 * including the three ways the answer is legitimately "cannot tell".
 */
import { describe, expect, it } from "vitest";

import {
  BUILD_SETTLE_MS,
  compareMainBuild,
  diffSnapshots,
  type MainBuildSnapshot,
} from "../../electron/main-build-freshness";

/** Build a snapshot from `path → contentHash`; mtimes are filled in as noise. */
function snapshot(
  hashes: Record<string, string>,
  opts: { mtimeMs?: number } = {},
): MainBuildSnapshot {
  const mtimeMs = opts.mtimeMs ?? 1_000;
  const files = Object.fromEntries(
    Object.entries(hashes).map(([rel, hash]) => [
      rel,
      { hash, sizeBytes: hash.length, mtimeMs },
    ]),
  );
  return { files, newestMtimeMs: mtimeMs, scannedAtMs: mtimeMs };
}

const NOW = 10_000_000;
/** Long enough ago that the settle window has elapsed. */
const SETTLED_SINCE = NOW - BUILD_SETTLE_MS;

describe("compareMainBuild — cannot-tell rows", () => {
  it("reports unknown when the boot scan never produced a baseline", () => {
    const report = compareMainBuild({
      boot: null,
      disk: snapshot({ "main.js": "a" }),
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("unknown");
    expect(report.reason).toBe("no-boot-snapshot");
    expect(report.changedModules).toEqual([]);
  });

  it("reports unknown when the current scan failed", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a" }),
      disk: null,
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("unknown");
    expect(report.reason).toBe("no-disk-snapshot");
  });

  it("reports unknown — not stale — when a scan came back empty", () => {
    // An empty tree means we are not looking at a build output at all.
    // Calling that "everything changed" would be the loudest false alarm
    // available.
    expect(
      compareMainBuild({
        boot: snapshot({}),
        disk: snapshot({ "main.js": "a" }),
        diskStableSinceMs: SETTLED_SINCE,
        nowMs: NOW,
      }),
    ).toMatchObject({ verdict: "unknown", reason: "empty-scan" });

    expect(
      compareMainBuild({
        boot: snapshot({ "main.js": "a" }),
        disk: snapshot({}),
        diskStableSinceMs: SETTLED_SINCE,
        nowMs: NOW,
      }),
    ).toMatchObject({ verdict: "unknown", reason: "empty-scan" });
  });

  it("holds the verdict while a build is still being written", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a" }),
      disk: snapshot({ "main.js": "b" }),
      diskStableSinceMs: NOW - (BUILD_SETTLE_MS - 1),
      nowMs: NOW,
    });
    expect(report.verdict).toBe("unknown");
    expect(report.reason).toBe("build-in-flight");
    expect(report.changedModules).toEqual([]);
  });

  it("treats 'stability not established yet' as still moving", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a" }),
      disk: snapshot({ "main.js": "b" }),
      diskStableSinceMs: null,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("unknown");
    expect(report.reason).toBe("build-in-flight");
  });
});

describe("compareMainBuild — match", () => {
  it("reports fresh when the content is identical", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a", "pty-manager.js": "b" }),
      disk: snapshot({ "main.js": "a", "pty-manager.js": "b" }),
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("fresh");
    expect(report.reason).toBe("identical");
    expect(report.changedCount).toBe(0);
  });

  it("★does not fire on a rebuild that only moved the timestamps", () => {
    // The false positive the whole design exists to exclude: `tsc` with
    // `incremental: true` still rewrites files whose bytes did not change, and
    // a `git checkout` of the same content bumps mtime too. Only hashes are
    // compared, so both are a no-op here.
    const boot = snapshot(
      { "main.js": "a", "local-models.js": "b" },
      {
        mtimeMs: 1_000,
      },
    );
    const disk = snapshot(
      { "main.js": "a", "local-models.js": "b" },
      {
        mtimeMs: 9_999_999,
      },
    );
    const report = compareMainBuild({
      boot,
      disk,
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("fresh");
    expect(report.reason).toBe("identical");
  });

  it("answers 'identical' immediately, without waiting out the settle window", () => {
    // A build that lands byte-identical is fresh the moment we see it; making
    // the user wait for that answer would only delay a "no".
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a" }),
      disk: snapshot({ "main.js": "a" }),
      diskStableSinceMs: null,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("fresh");
  });
});

describe("compareMainBuild — mismatch", () => {
  it("reports stale once settled content differs", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a", "local-models.js": "b" }),
      disk: snapshot({ "main.js": "a", "local-models.js": "B2" }),
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("stale");
    expect(report.reason).toBe("content-changed");
    expect(report.changedModules).toEqual(["local-models.js"]);
    expect(report.changedCount).toBe(1);
  });

  it("counts a file that appeared and one that vanished", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a", "gone.js": "g" }),
      disk: snapshot({ "main.js": "a", "added.js": "n" }),
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.verdict).toBe("stale");
    expect(report.changedModules).toEqual(["added.js", "gone.js"]);
    expect(report.changedCount).toBe(2);
  });

  it("fires exactly at the settle boundary, not one tick later", () => {
    const at = compareMainBuild({
      boot: snapshot({ "main.js": "a" }),
      disk: snapshot({ "main.js": "b" }),
      diskStableSinceMs: NOW - BUILD_SETTLE_MS,
      nowMs: NOW,
    });
    expect(at.verdict).toBe("stale");
  });

  it("caps the listed modules but keeps the true total", () => {
    const boot = snapshot({ "a.js": "1", "b.js": "1", "c.js": "1" });
    const disk = snapshot({ "a.js": "2", "b.js": "2", "c.js": "2" });
    const report = compareMainBuild({
      boot,
      disk,
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
      maxModulesListed: 2,
    });
    expect(report.changedModules).toEqual(["a.js", "b.js"]);
    expect(report.changedCount).toBe(3);
  });

  it("carries both build timestamps for the operator-facing message", () => {
    const report = compareMainBuild({
      boot: snapshot({ "main.js": "a" }, { mtimeMs: 111 }),
      disk: snapshot({ "main.js": "b" }, { mtimeMs: 222 }),
      diskStableSinceMs: SETTLED_SINCE,
      nowMs: NOW,
    });
    expect(report.bootBuiltAtMs).toBe(111);
    expect(report.diskBuiltAtMs).toBe(222);
  });
});

describe("diffSnapshots", () => {
  it("returns modified, added and removed paths, sorted", () => {
    const boot = snapshot({ "z.js": "1", "m.js": "1", "removed.js": "1" });
    const disk = snapshot({ "z.js": "2", "m.js": "1", "added.js": "1" });
    expect(diffSnapshots(boot, disk)).toEqual([
      "added.js",
      "removed.js",
      "z.js",
    ]);
  });

  it("is empty for equal content regardless of size/mtime noise", () => {
    const boot: MainBuildSnapshot = {
      files: { "main.js": { hash: "h", sizeBytes: 10, mtimeMs: 1 } },
      newestMtimeMs: 1,
      scannedAtMs: 1,
    };
    const disk: MainBuildSnapshot = {
      files: { "main.js": { hash: "h", sizeBytes: 99, mtimeMs: 999 } },
      newestMtimeMs: 999,
      scannedAtMs: 999,
    };
    expect(diffSnapshots(boot, disk)).toEqual([]);
  });
});
