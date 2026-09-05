/**
 * Filesystem behaviour of the main-process staleness guard
 * (electron/main-build-scan.ts, ticket 4HMJGUJBo0tKPU4mgHyr).
 *
 * The truth table is pinned without a filesystem in mainBuildFreshness.test.ts.
 * What this file proves is the part that can only be shown against real files:
 * that a rebuild which only moves timestamps produces NO alarm, that a real
 * content change does, and that the notice is delivered exactly once.
 *
 * No electron, no window — a temp directory standing in for `dist-electron`.
 */
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  compareMainBuild,
  diffSnapshots,
} from "../../electron/main-build-freshness";
import {
  scanMainBuild,
  startMainBuildWatcher,
} from "../../electron/main-build-scan";

let dist: string;

beforeEach(async () => {
  dist = await mkdtemp(path.join(tmpdir(), "marblo-dist-electron-"));
});

afterEach(async () => {
  await rm(dist, { recursive: true, force: true });
});

describe("scanMainBuild", () => {
  it("returns null when the build directory is not there at all", async () => {
    expect(await scanMainBuild(path.join(dist, "nope"))).toBeNull();
  });

  it("fingerprints compiled .js and ignores debug/type/build artifacts", async () => {
    await writeFile(path.join(dist, "main.js"), "module.exports = 1;");
    await writeFile(path.join(dist, "main.js.map"), "{}");
    await writeFile(path.join(dist, "main.d.ts"), "export {};");
    await writeFile(path.join(dist, ".tsbuildinfo"), "{}");

    const snap = await scanMainBuild(dist);
    expect(Object.keys(snap?.files ?? {})).toEqual(["main.js"]);
  });

  it("walks nested output but skips the CLI-only scripts/ subtree", async () => {
    // dist-electron/scripts/* are standalone entry points (`npm run
    // worktree:reap`, verify:models, bench). The same tsc --watch rebuilds
    // them, but the running main process never requires them — counting them
    // would be a false alarm by construction.
    await writeFile(path.join(dist, "main.js"), "1");
    await mkdir(path.join(dist, "mission-engine"), { recursive: true });
    await writeFile(path.join(dist, "mission-engine", "engine.js"), "1");
    await mkdir(path.join(dist, "scripts"), { recursive: true });
    await writeFile(path.join(dist, "scripts", "reap-worktrees.js"), "1");

    const snap = await scanMainBuild(dist);
    expect(Object.keys(snap?.files ?? {}).sort()).toEqual([
      "main.js",
      "mission-engine/engine.js",
    ]);
  });

  it("★sees no change when a rebuild only moved the timestamp", async () => {
    // This is the false positive the ticket singles out, and the reason the
    // axis is content and not mtime: `tsc` with incremental:true rewrites
    // unchanged output, and a git checkout of identical content bumps mtime.
    const file = path.join(dist, "main.js");
    await writeFile(file, "module.exports = 1;");
    const boot = await scanMainBuild(dist);

    const later = new Date(Date.now() + 60_000);
    await utimes(file, later, later);
    const disk = await scanMainBuild(dist, boot);

    expect(disk?.newestMtimeMs).toBeGreaterThan(boot?.newestMtimeMs ?? 0);
    expect(diffSnapshots(boot!, disk!)).toEqual([]);
    expect(
      compareMainBuild({
        boot,
        disk,
        diskStableSinceMs: 0,
        nowMs: 1_000_000,
      }).verdict,
    ).toBe("fresh");
  });

  it("sees a real content change", async () => {
    await writeFile(path.join(dist, "local-models.js"), "exports.tier = 1;");
    const boot = await scanMainBuild(dist);
    await writeFile(
      path.join(dist, "local-models.js"),
      "exports.memoryTier = 'high';",
    );
    const disk = await scanMainBuild(dist, boot);
    expect(diffSnapshots(boot!, disk!)).toEqual(["local-models.js"]);
  });
});

describe("startMainBuildWatcher", () => {
  it("reports a settled content change once, then stops watching", async () => {
    await writeFile(path.join(dist, "main.js"), "exports.v = 1;");

    const seen: number[] = [];
    const watcher = startMainBuildWatcher({
      distDir: dist,
      pollMs: 60_000, // never fires during the test; we drive it by hand
      settleMs: 0,
      onStale: (report) => seen.push(report.changedCount),
    });

    // Baseline: what this "process" loaded.
    expect((await watcher.checkNow()).verdict).toBe("fresh");

    await writeFile(path.join(dist, "main.js"), "exports.v = 2; // rebuilt");
    const stale = await watcher.checkNow();
    expect(stale.verdict).toBe("stale");
    expect(stale.changedModules).toEqual(["main.js"]);
    expect(seen).toEqual([1]);

    // Staleness cannot clear without a restart, so a second change must not
    // produce a second notice — repeating it would only teach the reader to
    // tune the banner out.
    await writeFile(path.join(dist, "other.js"), "exports.v = 3;");
    await watcher.checkNow();
    expect(seen).toEqual([1]);

    watcher.stop();
  });

  it("stays quiet while the build is still moving", async () => {
    await writeFile(path.join(dist, "main.js"), "exports.v = 1;");
    const seen: number[] = [];
    const watcher = startMainBuildWatcher({
      distDir: dist,
      pollMs: 60_000,
      settleMs: 60_000, // nothing can settle inside this test
      onStale: (report) => seen.push(report.changedCount),
    });

    await watcher.checkNow();
    await writeFile(path.join(dist, "main.js"), "exports.v = 2; // rebuilt");
    const report = await watcher.checkNow();

    expect(report.verdict).toBe("unknown");
    expect(report.reason).toBe("build-in-flight");
    expect(seen).toEqual([]);
    watcher.stop();
  });

  it("says 'cannot tell' rather than 'stale' when there is no build tree", async () => {
    const watcher = startMainBuildWatcher({
      distDir: path.join(dist, "missing"),
      pollMs: 60_000,
      settleMs: 0,
      onStale: () => {
        throw new Error("must not fire without evidence");
      },
    });
    const report = await watcher.checkNow();
    expect(report.verdict).toBe("unknown");
    watcher.stop();
  });
});
