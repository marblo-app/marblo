/**
 * Build identity for the running MCP server, and detection of the failure mode
 * where a process outlives the build it was started from.
 *
 * BUG (this module's reason to exist, ticket SsHpTM43EqqPTM1ZWQVA): PR#486 fixed
 * `get_all_tasks` on 2026-07-18 and the symptom kept reproducing. The reason was
 * not the fix — it was that nothing in the system could answer "which build is
 * this process actually running?". A long-lived MCP server keeps executing the
 * bundle it loaded at spawn time; rebuilding `dist-mcp` on disk does nothing to
 * it, and there was no signal anywhere that the two had diverged. On the host
 * that reported the bug, 43 MCP processes were live and 23 of them were orphans
 * (ppid=1) started days before the fix existed, indistinguishable from healthy
 * ones. Every future `dist-mcp` change had the same trap waiting.
 *
 * So: bake the build identity into the bundle, state it at boot, and compare it
 * against the bundle on disk so a stale process reports itself instead of
 * silently serving old behaviour.
 *
 * Everything here is pure except `readDiskBuiltAtMs`, so the policy is testable
 * without a filesystem.
 */

/**
 * Injected by `scripts/bundle-mcp.mjs` via esbuild `define` as a JSON string.
 * Absent when the TypeScript is run unbundled (vitest, `tsc`-only output) —
 * every read goes through `typeof` so that case stays a normal fallback rather
 * than a ReferenceError.
 */
declare const __MARBLO_MCP_BUILD__: string | undefined;

export interface BuildStamp {
  /** Short git SHA at build time, or "unknown" when git was unavailable. */
  commit: string;
  /** Epoch ms when the bundle was produced. */
  builtAtMs: number;
  /**
   * How we learned the above. `baked` is the trustworthy case: the value was
   * compiled into the bundle, so it describes the CODE THIS PROCESS IS RUNNING
   * and cannot be changed by a later rebuild. `mtime`/`unknown` mean we are
   * running unbundled and cannot detect staleness at all.
   */
  source: "baked" | "mtime" | "unknown";
}

/** Parse the injected JSON. Returns null for anything malformed. */
export function parseBuildStamp(
  raw: unknown,
): Omit<BuildStamp, "source"> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { commit, builtAtMs } = parsed as Record<string, unknown>;
    if (typeof builtAtMs !== "number" || !Number.isFinite(builtAtMs))
      return null;
    return {
      commit: typeof commit === "string" && commit ? commit : "unknown",
      builtAtMs,
    };
  } catch {
    return null;
  }
}

/** The stamp compiled into this bundle, if there is one. */
export function bakedBuildStamp(): BuildStamp | null {
  const raw =
    typeof __MARBLO_MCP_BUILD__ === "string" ? __MARBLO_MCP_BUILD__ : undefined;
  const parsed = parseBuildStamp(raw);
  return parsed ? { ...parsed, source: "baked" } : null;
}

/**
 * Clock skew / filesystem-timestamp granularity slack. A rebuild that races the
 * spawn of a process can leave the on-disk mtime a moment ahead of the baked
 * stamp without the process being meaningfully stale, and warning on that would
 * train people to ignore the warning.
 */
export const STALE_TOLERANCE_MS = 60_000;

export interface Freshness {
  stale: boolean;
  /** How far the on-disk build is ahead of ours, in ms (0 when not stale). */
  driftMs: number;
  /** Human-readable line, or null when there is nothing to say. */
  message: string | null;
}

/**
 * Decide whether this process is running code older than what is on disk.
 *
 * Only `baked` stamps can answer this: an mtime-derived stamp reads the same
 * file we would compare against, so it is stale-by-construction-blind and must
 * report `stale: false` rather than a false negative dressed as a check.
 */
export function describeBuildFreshness(input: {
  stamp: BuildStamp | null;
  diskBuiltAtMs: number | null;
  toleranceMs?: number;
}): Freshness {
  const { stamp, diskBuiltAtMs } = input;
  const tolerance = input.toleranceMs ?? STALE_TOLERANCE_MS;
  const fresh: Freshness = { stale: false, driftMs: 0, message: null };

  if (!stamp || stamp.source !== "baked") return fresh;
  if (diskBuiltAtMs === null || !Number.isFinite(diskBuiltAtMs)) return fresh;

  const driftMs = diskBuiltAtMs - stamp.builtAtMs;
  if (driftMs <= tolerance) return fresh;

  return {
    stale: true,
    driftMs,
    message:
      `⚠️ This marblo MCP server is running a STALE build: loaded ` +
      `${stamp.commit} built ${new Date(stamp.builtAtMs).toISOString()}, but ` +
      `dist-mcp on disk was rebuilt ${new Date(diskBuiltAtMs).toISOString()} ` +
      `(${formatDuration(driftMs)} newer). Tool behaviour here predates that ` +
      `build — restart Marblo (or the agent's MCP connection) to pick it up.`,
  };
}

/** Compact duration for operator-facing messages. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const day = 86_400_000;
  const hour = 3_600_000;
  const min = 60_000;
  if (abs >= day) return `${Math.floor(abs / day)}d`;
  if (abs >= hour) return `${Math.floor(abs / hour)}h`;
  if (abs >= min) return `${Math.floor(abs / min)}m`;
  return `${Math.floor(abs / 1000)}s`;
}

/** One-line boot identity, written to stderr (never stdout — see index.ts). */
export function formatBootBanner(
  stamp: BuildStamp | null,
  entryPath: string | null,
): string {
  if (!stamp) {
    return (
      `[MCP] build=unstamped entry=${entryPath ?? "?"} — running unbundled; ` +
      `stale-build detection is unavailable.`
    );
  }
  return `[MCP] build=${stamp.commit} builtAt=${new Date(
    stamp.builtAtMs,
  ).toISOString()} source=${stamp.source} entry=${entryPath ?? "?"}`;
}

/**
 * Throttle for the stale notice.
 *
 * Staleness persists until restart, so notifying on every tool call would be
 * pure noise and would get filtered out by the reader — the exact outcome this
 * feature exists to prevent. Say it once, then at a slow heartbeat.
 */
export const STALE_NOTICE_INTERVAL_MS = 30 * 60_000;

export function shouldEmitStaleNotice(
  lastEmittedAtMs: number | null,
  nowMs: number,
  intervalMs: number = STALE_NOTICE_INTERVAL_MS,
): boolean {
  if (lastEmittedAtMs === null) return true;
  return nowMs - lastEmittedAtMs >= intervalMs;
}

// ── runtime glue (the only impure part) ─────────────────────────────────────

/** The bundle this process was launched from. */
export function entryPath(): string | null {
  const entry = process.argv[1];
  return typeof entry === "string" && entry ? entry : null;
}

/**
 * mtime of the bundle on disk *right now* — which is not necessarily the bundle
 * this process is executing, and that difference is the whole point.
 */
export async function readDiskBuiltAtMs(): Promise<number | null> {
  const entry = entryPath();
  if (!entry) return null;
  try {
    const { stat } = await import("node:fs/promises");
    const s = await stat(entry);
    return s.mtimeMs;
  } catch {
    return null; // deleted/replaced bundle — nothing to compare against
  }
}

let lastStaleNoticeAtMs: number | null = null;
let staleCheckInFlight: Promise<Freshness> | null = null;
let cachedFreshness: Freshness | null = null;
let cachedAtMs = 0;

/** Re-stat at most this often; staleness is a slow-moving property. */
const FRESHNESS_CACHE_MS = 60_000;

async function currentFreshness(nowMs: number): Promise<Freshness> {
  if (cachedFreshness && nowMs - cachedAtMs < FRESHNESS_CACHE_MS) {
    return cachedFreshness;
  }
  if (!staleCheckInFlight) {
    staleCheckInFlight = (async () => {
      const diskBuiltAtMs = await readDiskBuiltAtMs();
      const f = describeBuildFreshness({
        stamp: bakedBuildStamp(),
        diskBuiltAtMs,
      });
      cachedFreshness = f;
      cachedAtMs = Date.now();
      return f;
    })().finally(() => {
      staleCheckInFlight = null;
    });
  }
  return staleCheckInFlight;
}

/**
 * A one-line warning to prepend to a tool result when this process is serving
 * code older than what is on disk, or null when there is nothing to report.
 *
 * Surfaced through tool output rather than logs alone because stderr is exactly
 * where the original week-long miss happened: nobody reads a background
 * process's log, but the orchestrator reads every tool result.
 */
export async function staleBuildNotice(): Promise<string | null> {
  try {
    const now = Date.now();
    const freshness = await currentFreshness(now);
    if (!freshness.stale || !freshness.message) return null;
    if (!shouldEmitStaleNotice(lastStaleNoticeAtMs, now)) return null;
    lastStaleNoticeAtMs = now;
    return freshness.message;
  } catch {
    return null; // never let the health check break the tool it is watching
  }
}

/** Test seam: drop memoized state between cases. */
export function __resetBuildInfoCacheForTests(): void {
  lastStaleNoticeAtMs = null;
  staleCheckInFlight = null;
  cachedFreshness = null;
  cachedAtMs = 0;
}
