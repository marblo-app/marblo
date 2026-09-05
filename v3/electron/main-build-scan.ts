/**
 * Filesystem half of the main-process staleness guard (ticket
 * 4HMJGUJBo0tKPU4mgHyr). Reads `dist-electron`, hands snapshots to the pure
 * verdict in `main-build-freshness.ts`, and polls until it has something to
 * say. Kept apart from that module so the truth table stays testable with no
 * filesystem, and so the renderer can import the types without dragging
 * `node:fs` into the Vite bundle.
 *
 * Nothing here runs in a packaged app — `main.ts` gates the whole watcher on
 * `!app.isPackaged`. See `startMainBuildWatcher` for why.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  BUILD_SETTLE_MS,
  compareMainBuild,
  diffSnapshots,
  type MainBuildFileFingerprint,
  type MainBuildReport,
  type MainBuildSnapshot,
} from "./main-build-freshness";

/**
 * Subtrees of `dist-electron` excluded from the scan.
 *
 * `scripts/` holds standalone CLI entry points (`npm run worktree:reap`,
 * `verify:models`, the bench harness). The same `tsc --watch` rebuilds them,
 * but the running main process never `require`s them — warning that the app
 * needs a restart because a CLI script recompiled would be a false alarm by
 * construction.
 */
const SKIPPED_DIRS = new Set(["scripts", "node_modules"]);

/** Short content hash. Collision risk is irrelevant for "did this change?". */
function hashContent(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/**
 * Fingerprint every `.js` file the main process could load out of `distDir`.
 *
 * `previous` is a pure optimization: a file whose size AND mtime both match the
 * earlier scan is assumed to hold the same bytes, so its hash is copied instead
 * of re-read. That keeps the steady-state poll to `readdir`/`stat` syscalls
 * over ~200 files instead of re-hashing several megabytes every cycle. The
 * assumption can only fail for a rewrite that lands in the same millisecond AND
 * preserves the byte count, which `tsc` output does not do; and the cost of
 * being wrong is a missed notice, never a false one.
 *
 * Returns null when `distDir` cannot be read at all — the caller reports that
 * as "cannot tell", not as a change.
 */
export async function scanMainBuild(
  distDir: string,
  previous?: MainBuildSnapshot | null,
): Promise<MainBuildSnapshot | null> {
  const files: Record<string, MainBuildFileFingerprint> = {};
  let newestMtimeMs = 0;
  let readAnything = false;

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // vanished mid-walk — treated as "no files here"
    }
    readAnything = true;
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (relDir === "" && SKIPPED_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      // `.js` only: `.js.map` and `.d.ts` are debug/type artifacts that no
      // require() reads, and `.tsbuildinfo` changes on every no-op rebuild.
      if (!entry.name.endsWith(".js")) continue;

      try {
        const st = await stat(abs);
        const cached = previous?.files[rel];
        const hash =
          cached &&
          cached.sizeBytes === st.size &&
          cached.mtimeMs === st.mtimeMs
            ? cached.hash
            : hashContent(await readFile(abs));
        files[rel] = { hash, sizeBytes: st.size, mtimeMs: st.mtimeMs };
        if (st.mtimeMs > newestMtimeMs) newestMtimeMs = st.mtimeMs;
      } catch {
        // A file that disappeared between readdir and stat is mid-rebuild.
        // Skipping it makes this scan differ from the last one, which keeps
        // the settle window open — exactly the right behaviour.
      }
    }
  }

  await walk(distDir, "");
  if (!readAnything) return null;
  return { files, newestMtimeMs, scannedAtMs: Date.now() };
}

export interface MainBuildWatcher {
  /** Most recent verdict. Safe to call before the first scan completes. */
  latest(): MainBuildReport;
  /** Run one scan + verdict now. Exposed for tests and for eager first checks. */
  checkNow(): Promise<MainBuildReport>;
  /** Stop polling. Idempotent. */
  stop(): void;
}

export interface MainBuildWatcherOptions {
  /** Directory holding the compiled main process, normally `__dirname`. */
  distDir: string;
  /**
   * Called once, the first time the verdict turns `stale`. Fired once and only
   * once: staleness cannot resolve without a restart, so repeating it would add
   * no information and would teach the reader to tune it out.
   */
  onStale: (report: MainBuildReport) => void;
  pollMs?: number;
  settleMs?: number;
  log?: (message: string) => void;
}

/**
 * Poll `distDir` until the running main process is provably behind it.
 *
 * Lifecycle, and why it is shaped this way:
 *  - The baseline is captured once at start. `scripts/dev-electron.mjs` only
 *    spawns electron after `dist-electron/main.js` has been quiet for 700 ms,
 *    so the tree on disk at that moment IS the generation this process loads.
 *  - Polling stops the moment `onStale` fires. The condition is monotone
 *    (nothing short of a restart clears it) and the required action never
 *    changes, so there is no second thing to learn by continuing to scan.
 *  - Dev only. In a packaged app the code lives inside `app.asar`, nothing
 *    rewrites it while the process runs, and electron-updater swaps the whole
 *    bundle on restart. The guard could therefore only produce false positives
 *    there, which is why `main.ts` never starts it when `app.isPackaged`.
 */
export function startMainBuildWatcher(
  options: MainBuildWatcherOptions,
): MainBuildWatcher {
  const {
    distDir,
    onStale,
    pollMs = 30_000,
    settleMs = BUILD_SETTLE_MS,
    log,
  } = options;

  let boot: MainBuildSnapshot | null = null;
  let disk: MainBuildSnapshot | null = null;
  let diskStableSinceMs: number | null = null;
  let reportedStale = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<MainBuildReport> | null = null;

  let latestReport: MainBuildReport = compareMainBuild({
    boot: null,
    disk: null,
    diskStableSinceMs: null,
    nowMs: Date.now(),
    settleMs,
  });

  async function runCheck(): Promise<MainBuildReport> {
    // The baseline doubles as the first disk reading, so one scan covers both
    // on the opening cycle.
    if (boot === null) boot = await scanMainBuild(distDir);

    const next = await scanMainBuild(distDir, disk);
    const now = Date.now();
    if (next) {
      // Restart the settle clock whenever the content moves. Comparing by
      // content (not mtime) means a rebuild that lands identical bytes does not
      // reset it, so an editor "save with no change" never delays the verdict.
      if (disk === null || diffSnapshots(disk, next).length > 0) {
        diskStableSinceMs = now;
      }
      disk = next;
    }

    latestReport = compareMainBuild({
      boot,
      disk,
      diskStableSinceMs,
      nowMs: now,
      settleMs,
    });

    if (latestReport.verdict === "stale" && !reportedStale) {
      reportedStale = true;
      log?.(
        `[main-build] STALE: ${latestReport.changedCount} compiled file(s) on ` +
          `disk differ from the ones this process loaded ` +
          `(${latestReport.changedModules.join(", ")}${
            latestReport.changedCount > latestReport.changedModules.length
              ? ", …"
              : ""
          }). Restart to pick them up.`,
      );
      try {
        onStale(latestReport);
      } catch {
        // A failing listener must not kill the watcher's own teardown below.
      }
      stop();
    }
    return latestReport;
  }

  function checkNow(): Promise<MainBuildReport> {
    // Scans overlap badly on a slow disk; fold concurrent callers into one.
    if (!inFlight) {
      inFlight = runCheck().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function stop(): void {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  timer = setInterval(() => {
    if (stopped) return;
    void checkNow().catch(() => {
      // Never let the health check break the app it is watching.
    });
  }, pollMs);
  // Node keeps the process alive for pending timers; this one must not hold
  // the app open during quit.
  timer.unref?.();

  // Establish the baseline immediately rather than waiting out the first
  // interval — a pull + rebuild seconds after launch is the common case.
  void checkNow().catch(() => {});

  return { latest: () => latestReport, checkNow, stop };
}
