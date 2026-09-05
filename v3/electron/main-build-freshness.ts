/**
 * Is the running MAIN process executing older code than what is on disk?
 *
 * BUG (this module's reason to exist, ticket 4HMJGUJBo0tKPU4mgHyr): in dev,
 * `npm run dev` runs `vite` and `tsc -p electron/tsconfig.json --watch` side by
 * side. A source edit reaches the renderer immediately through Vite HMR, but the
 * main process keeps executing whatever `dist-electron/*.js` it `require`d at
 * spawn time — `tsc --watch` writes new files that nobody re-reads. The two
 * halves of the app then run DIFFERENT GENERATIONS of the same commit, and
 * nothing anywhere says so. On 2026-09-05 that cost three separate debugging
 * sessions:
 *   1. #1418 (web-tab coordinate fix) — merged, but the app ran pre-merge main.
 *   2. #1420 (closed-loop switch) — the flag only reached MCP config after a
 *      restart.
 *   3. #1422 (telegram queue) — app booted 11:45:02, dist built 14:21:32; the
 *      fix was reported working while not actually loaded.
 * Each time the diagnosis was a human manually cross-checking `ps -o lstart=`
 * against `stat` on dist-electron. This module makes the machine say it.
 *
 * ── Why content hashes and not timestamps ──────────────────────────────────
 * The obvious axis is "process start time vs. newest dist mtime", and it is
 * wrong in the direction that matters. `electron/tsconfig.json` sets
 * `incremental: true`, and tsc still rewrites output files whose *content* is
 * unchanged when an upstream declaration moves; a `git checkout` of the same
 * content bumps mtime too. Every one of those is a warning shown to a person
 * who then finds nothing wrong — and a warning that cries wolf is worse than no
 * warning at all, because it trains the reader to skip the real one.
 *
 * A baked build stamp (what `mcp-server/build-info.ts` does for dist-mcp) is
 * the other accurate option, but it needs a bundler: esbuild `define` injects
 * the stamp there. `dist-electron` is produced by plain `tsc --watch`, which
 * has no injection hook and no post-build step to add one — the watch rebuild
 * is exactly the case we must catch, so a stamp written by a wrapper script
 * would be absent precisely when it is needed.
 *
 * So: hash the file contents. Two scans of the same bytes compare equal no
 * matter how many times they were rewritten, which removes the false-positive
 * class entirely rather than tuning a tolerance against it.
 *
 * ── This file is PURE ──────────────────────────────────────────────────────
 * No `fs`, no `crypto`, no `electron`. The filesystem walk lives in
 * `main-build-scan.ts`; the renderer imports the types and the verdict from
 * here (same pattern as `src/lib/ansi.ts` → `electron/ansi.ts`), so the truth
 * table is fixed by unit tests with no filesystem and no window.
 */

/** One file's identity in a scan. */
export interface MainBuildFileFingerprint {
  /**
   * Content hash. ★The ONLY field the verdict reads — see the header on why
   * timestamps are not an axis.
   */
  hash: string;
  /** Scanner cache key only (skip re-hashing an untouched file). */
  sizeBytes: number;
  /** Scanner cache key only. Never compared to decide staleness. */
  mtimeMs: number;
}

/** The state of `dist-electron` at one moment. */
export interface MainBuildSnapshot {
  /** Relative POSIX path → fingerprint. */
  files: Record<string, MainBuildFileFingerprint>;
  /** Newest mtime in the scan, epoch ms; 0 when empty. Diagnostics only. */
  newestMtimeMs: number;
  /** When this scan ran, epoch ms. */
  scannedAtMs: number;
}

/**
 * Three outcomes, not two. `unknown` is a first-class answer: when we cannot
 * see the build tree, or a build is still being written, the honest report is
 * "cannot tell", never a guess in either direction.
 */
export type MainBuildVerdict = "fresh" | "stale" | "unknown";

/** Why the verdict came out the way it did — asserted in tests, shown in logs. */
export type MainBuildReason =
  /** unknown — the boot scan never completed, so there is no baseline. */
  | "no-boot-snapshot"
  /** unknown — the current scan failed (dist-electron gone mid-session). */
  | "no-disk-snapshot"
  /** unknown — a scan saw no files at all; nothing real to compare. */
  | "empty-scan"
  /** unknown — content differs but is still moving; a build is in flight. */
  | "build-in-flight"
  /** fresh — byte-identical to what this process loaded. */
  | "identical"
  /** stale — settled content that differs from what this process loaded. */
  | "content-changed";

/** What main sends to the renderer. Plain data — crosses IPC as-is. */
export interface MainBuildReport {
  verdict: MainBuildVerdict;
  reason: MainBuildReason;
  /** Changed module paths, sorted and capped at `maxModulesListed`. */
  changedModules: string[];
  /** Total number changed — `changedModules` may be a truncated view of this. */
  changedCount: number;
  /** Newest mtime in the boot scan, epoch ms; null when there was no scan. */
  bootBuiltAtMs: number | null;
  /** Newest mtime on disk now, epoch ms; null when there was no scan. */
  diskBuiltAtMs: number | null;
}

/**
 * How long the on-disk content must hold still before a difference counts.
 *
 * `tsc --watch` emits a recompile as a burst of individual file writes; polling
 * into the middle of one sees a half-written generation. Reporting on that
 * would fire a banner during every save — the "ignored warning" failure the
 * ticket names. `scripts/dev-electron.mjs` guards its own torn-read window with
 * 700 ms; this is the same idea with room for a full-tree rebuild, and costs
 * nothing but a few seconds of latency on a notice about restarting the app.
 */
export const BUILD_SETTLE_MS = 4_000;

/**
 * Cap on the module list in the notice. The point is to hint at WHAT did not
 * take effect, not to print a build log at the user — the action is the same
 * for one changed file or eighty.
 */
export const MAX_CHANGED_MODULES_LISTED = 6;

/**
 * Paths whose fingerprints differ between two scans, sorted.
 *
 * Counts all three kinds of difference — modified, added, removed — because a
 * pulled commit that deletes a module is the same hazard as one that edits it:
 * the running process still holds the old one.
 */
export function diffSnapshots(
  boot: MainBuildSnapshot,
  disk: MainBuildSnapshot,
): string[] {
  const changed: string[] = [];
  for (const [rel, fp] of Object.entries(boot.files)) {
    const now = disk.files[rel];
    if (!now || now.hash !== fp.hash) changed.push(rel);
  }
  for (const rel of Object.keys(disk.files)) {
    if (!(rel in boot.files)) changed.push(rel);
  }
  return changed.sort();
}

export interface CompareMainBuildInput {
  /** The generation this process loaded. */
  boot: MainBuildSnapshot | null;
  /** The generation on disk right now. */
  disk: MainBuildSnapshot | null;
  /**
   * Epoch ms at which `disk` first showed its current content, from the
   * poller. `null` means the poller has not established stability yet, which
   * is treated as "still moving" — the conservative direction.
   */
  diskStableSinceMs: number | null;
  nowMs: number;
  settleMs?: number;
  maxModulesListed?: number;
}

/**
 * The whole decision, as one pure function.
 *
 * Truth table (fixed by tests/unit/mainBuildFreshness.test.ts):
 *
 *   boot missing                      → unknown / no-boot-snapshot
 *   disk missing                      → unknown / no-disk-snapshot
 *   either scan empty                 → unknown / empty-scan
 *   same content                      → fresh   / identical
 *   different, not settled            → unknown / build-in-flight
 *   different, settled                → stale   / content-changed
 *
 * Note the order: `identical` is decided BEFORE the settle window. A build
 * that finishes byte-identical to what we loaded is fresh the moment we see
 * it, and making the user wait 4 s for that answer would only delay a "no".
 */
export function compareMainBuild(
  input: CompareMainBuildInput,
): MainBuildReport {
  const {
    boot,
    disk,
    diskStableSinceMs,
    nowMs,
    settleMs = BUILD_SETTLE_MS,
    maxModulesListed = MAX_CHANGED_MODULES_LISTED,
  } = input;

  const bootBuiltAtMs = boot ? boot.newestMtimeMs : null;
  const diskBuiltAtMs = disk ? disk.newestMtimeMs : null;
  const undecided = (reason: MainBuildReason): MainBuildReport => ({
    verdict: "unknown",
    reason,
    changedModules: [],
    changedCount: 0,
    bootBuiltAtMs,
    diskBuiltAtMs,
  });

  if (!boot) return undecided("no-boot-snapshot");
  if (!disk) return undecided("no-disk-snapshot");

  // An empty scan is not evidence of anything. It means we are pointed at a
  // directory that is not a build output (wiped dist, wrong path), and calling
  // that "everything changed" would be a false alarm of the loudest kind.
  if (
    Object.keys(boot.files).length === 0 ||
    Object.keys(disk.files).length === 0
  ) {
    return undecided("empty-scan");
  }

  const changed = diffSnapshots(boot, disk);
  if (changed.length === 0) {
    return {
      verdict: "fresh",
      reason: "identical",
      changedModules: [],
      changedCount: 0,
      bootBuiltAtMs,
      diskBuiltAtMs,
    };
  }

  const settled =
    diskStableSinceMs !== null && nowMs - diskStableSinceMs >= settleMs;
  if (!settled) return undecided("build-in-flight");

  return {
    verdict: "stale",
    reason: "content-changed",
    changedModules: changed.slice(0, Math.max(0, maxModulesListed)),
    changedCount: changed.length,
    bootBuiltAtMs,
    diskBuiltAtMs,
  };
}
