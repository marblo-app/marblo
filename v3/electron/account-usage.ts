/**
 * Account-level rate-limit snapshots — independent of any running agent.
 *
 * The Usage tab must show Claude/Codex plan utilization whenever the user is
 * logged into those CLIs, even with ZERO agents spawned. The per-agent cost
 * docs (the path CostTracker writes rateLimitPercent to) can't satisfy that:
 * with no agent there is no doc, and CostTracker's claude probe only runs
 * while a claude session tracker is alive. These helpers read the SAME
 * account-global sources directly, decoupled from agents:
 *
 *   - claude: the headless `get_usage` control-protocol probe
 *     (claude-usage-probe.ts) — account-global plan utilization, no message
 *     sent. Probed against resolveClaudeBinary() so a stale shadow install is
 *     never used.
 *   - codex/gpt: the authenticated `codex app-server --stdio`
 *     account/rateLimits/read RPC (codex-usage-probe.ts), with rollout JSONL
 *     parsing as fallback for older/failed CLIs.
 *
 * null always means "no information" (logged out / probe failed / no rollout),
 * NEVER zero usage. Results are TTL-cached so a UI mount doesn't spawn a probe
 * on every render.
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  probeClaudeUsage,
  type ClaudeUsageSnapshot,
} from "./claude-usage-probe";
import { probeCodexUsage } from "./codex-usage-probe";
import { resolveClaudeBinary, CONFIG_DIR } from "./agent-config";
import {
  parseSessionDelta,
  newParseState,
  type RateLimitInfo,
} from "./session-parsers";

export interface AccountRateLimits {
  claude: RateLimitInfo | null;
  gpt: RateLimitInfo | null;
}

// Serve a cached claude snapshot for this long before re-probing (the probe
// spawns a short-lived CLI, so we don't want one per UI render).
const CLAUDE_FRESH_MS = 60_000;
// If a re-probe fails, a cached snapshot is still served until this old, after
// which we report null ("no information") rather than a stale value.
const CLAUDE_STALE_MS = 5 * 60_000;
// Codex rollout scan is a cheap file walk; cache briefly to debounce mounts.
const GPT_FRESH_MS = 30_000;

let claudeCache: ClaudeUsageSnapshot | null = null;
let claudeInFlight: Promise<RateLimitInfo | null> | null = null;
let gptCache: { at: number; info: RateLimitInfo | null } | null = null;
let gptInFlight: Promise<RateLimitInfo | null> | null = null;

function snapToInfo(s: ClaudeUsageSnapshot): RateLimitInfo {
  return {
    planType: s.planType,
    primaryPercent: s.primaryPercent,
    primaryResetAt: s.primaryResetAt,
    secondaryPercent: s.secondaryPercent,
    secondaryResetAt: s.secondaryResetAt,
  };
}

/**
 * Account-global Claude plan utilization, or null when there's no information.
 * TTL-cached; coalesces concurrent callers onto a single in-flight probe.
 */
export async function getAccountClaudeRateLimit(): Promise<RateLimitInfo | null> {
  if (claudeCache && Date.now() - claudeCache.capturedAt < CLAUDE_FRESH_MS) {
    return snapToInfo(claudeCache);
  }
  if (claudeInFlight) return claudeInFlight;
  claudeInFlight = (async () => {
    try {
      const snap = await probeClaudeUsage(resolveClaudeBinary().command);
      if (snap) claudeCache = snap;
      // Probe failed but a recent snapshot exists → serve it until it's stale;
      // beyond that, null ("no information") rather than asserting old data.
      const useSnap =
        snap ??
        (claudeCache && Date.now() - claudeCache.capturedAt < CLAUDE_STALE_MS
          ? claudeCache
          : null);
      return useSnap ? snapToInfo(useSnap) : null;
    } finally {
      claudeInFlight = null;
    }
  })();
  return claudeInFlight;
}

/** Every codex `sessions` root that could hold an account rollout. */
function codexSessionRoots(): string[] {
  const roots = [path.join(os.homedir(), ".codex", "sessions")];
  try {
    for (const name of fs.readdirSync(CONFIG_DIR)) {
      if (name.startsWith("codex-home-")) {
        roots.push(path.join(CONFIG_DIR, name, "sessions"));
      }
    }
  } catch {
    // CONFIG_DIR may not exist yet — the user's own ~/.codex is enough.
  }
  return roots;
}

/**
 * Newest `rollout-*.jsonl` under a codex sessions root
 * (`sessions/YYYY/MM/DD/rollout-*.jsonl`), by mtime. null when the tree has
 * none. Walks at most 3 dir levels deep (Y/M/D), so it stays cheap.
 */
function newestRollout(root: string): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null;
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3) walk(full, depth + 1);
      } else if (
        depth === 3 &&
        e.isFile() &&
        e.name.startsWith("rollout-") &&
        e.name.endsWith(".jsonl")
      ) {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (!best || m > best.mtime) best = { path: full, mtime: m };
        } catch {
          // unreadable file — skip
        }
      }
    }
  };
  walk(root, 0);
  return best;
}

/**
 * Account-global Codex (gpt) plan utilization from the newest rollout across
 * all codex homes, or null when there's no usable reading.
 */
function readGptRateLimitFromRollouts(): RateLimitInfo | null {
  let best: { path: string; mtime: number } | null = null;
  for (const root of codexSessionRoots()) {
    const r = newestRollout(root);
    if (r && (!best || r.mtime > best.mtime)) best = r;
  }

  let info: RateLimitInfo | null = null;
  if (best) {
    try {
      const raw = fs.readFileSync(best.path, "utf-8");
      const lines = raw ? raw.split("\n").filter(Boolean) : [];
      const { newState } = parseSessionDelta("codex", lines, newParseState());
      const rl = newState.rateLimit;
      // Only count it as data when at least one window % was actually present.
      if (rl && (rl.primaryPercent !== null || rl.secondaryPercent !== null)) {
        info = rl;
      }
    } catch {
      info = null;
    }
  }
  return info;
}

function mergeRateLimitInfo(
  primary: RateLimitInfo | null,
  fallback: RateLimitInfo | null,
): RateLimitInfo | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    planType: primary.planType ?? fallback.planType,
    primaryPercent: primary.primaryPercent ?? fallback.primaryPercent,
    primaryResetAt: primary.primaryResetAt ?? fallback.primaryResetAt,
    secondaryPercent: primary.secondaryPercent ?? fallback.secondaryPercent,
    secondaryResetAt: primary.secondaryResetAt ?? fallback.secondaryResetAt,
  };
}

/**
 * Account-global Codex (gpt) plan utilization, or null when there's no
 * information. Uses the headless app-server probe first so the value appears
 * even before any Codex agent/session has produced a rollout; falls back to
 * the historic rollout parser when the probe is unavailable or unauthenticated.
 * TTL-cached; coalesces concurrent callers onto a single in-flight probe.
 */
export async function getAccountGptRateLimit(): Promise<RateLimitInfo | null> {
  if (gptCache && Date.now() - gptCache.at < GPT_FRESH_MS) return gptCache.info;
  if (gptInFlight) return gptInFlight;

  gptInFlight = (async () => {
    try {
      const snap = await probeCodexUsage();
      const probed = snap ? snapToInfo(snap) : null;
      const needsRolloutFill =
        !probed ||
        probed.primaryPercent === null ||
        probed.secondaryPercent === null;
      const info = needsRolloutFill
        ? mergeRateLimitInfo(probed, readGptRateLimitFromRollouts())
        : probed;
      gptCache = { at: Date.now(), info };
      return info;
    } finally {
      gptInFlight = null;
    }
  })();
  return gptInFlight;
}

/** Both account-level snapshots for the Usage tab rate-limit panel. */
export async function getAccountRateLimits(): Promise<AccountRateLimits> {
  const [claude, gpt] = await Promise.all([
    getAccountClaudeRateLimit(),
    getAccountGptRateLimit(),
  ]);
  return { claude, gpt };
}
