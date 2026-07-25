/**
 * Cost tracker — two strategies:
 *   1. JSONL session files (claude / codex / gemini): parse per-format token
 *      usage incrementally (accurate). See session-parsers.ts.
 *   2. Other CLIs (antigravity / custom): parse PTY output for token/cost
 *      patterns (best-effort).
 * Read-only observer: does not affect PTY data flow.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { encodeClaudeProjectDir } from "./claude-paths";
import {
  codexSessionsDir,
  geminiTmpDir,
  resolveClaudeBinary,
} from "./agent-config";
import { registryPricing } from "./model-registry";
import {
  probeClaudeUsage,
  type ClaudeUsageSnapshot,
} from "./claude-usage-probe";
import {
  formatForModel,
  newParseState,
  parseSessionDelta,
  type ParseState,
  type RateLimitInfo,
  type SessionFormat,
  type TokenTotals,
} from "./session-parsers";
import { readAgyDbDelta, resolveAgyStore } from "./agy-usage";

export interface CostEntry {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
  // Delta (incremental) values for this poll interval
  deltaInputTokens: number;
  deltaOutputTokens: number;
  deltaCacheReadTokens: number;
  deltaCacheWriteTokens: number;
  deltaCost: number;
  // Subscription / rate-limit (codex only; undefined otherwise). Latest
  // snapshot, not a delta — the writer SETs these on the agent doc.
  detectedPlanType?: string;
  rateLimitPercent?: number; // 5h(primary) window used %
  rateLimitResetAt?: number;
  // Weekly(7-day / secondary) window. Provider-agnostic field names so a
  // future Claude statusline-capture source (Phase 1b) reuses the same pipe.
  rateLimitWeeklyPercent?: number;
  rateLimitWeeklyResetAt?: number;
}

// Patent claim 8 (단락 256-264): 서로 다른 과금체계가 적용되는 2 이상의
// 에이전트별로, 사용량과 과금체계에 기초하여 개별 과금량을 산출하고,
// 이를 합산해 통합과금량을 산출한다. 명세서는 "특정 에이전트는 구독제로
// 요금이 책정될 수 있고, 다른 에이전트는 토큰 수에 따라 비용이 부과될 수
// 있다" 를 명시 — 그래서 두 종류의 PricingScheme 을 분리해 모델링한다.
export type PricingScheme = "per-token" | "subscription";

interface PerTokenPricing {
  scheme: "per-token";
  inputPer1M: number;
  outputPer1M: number;
}

interface SubscriptionPricing {
  scheme: "subscription";
  /** Stable key for sharing monthly allowance accounting across sessions. */
  monthlyScopeKey: string;
  /** Flat monthly fee in USD (e.g. Claude Max $200, ChatGPT Plus $20). */
  monthlyFlatUsd: number;
  /**
   * Optional soft monthly token allowance. Below this we attribute usage
   * against the flat fee (no incremental cost). Above it we fall back to
   * `overagePerToken` for the excess.
   */
  monthlyTokenAllowance?: number;
  /** Per-token pricing applied only when allowance is exceeded. */
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

type ModelPricing = PerTokenPricing | SubscriptionPricing;

/** Raw per-token rate row in the literal MODEL_PRICING table (sans the
 * `scheme` discriminator — that's lifted in by `findPricing`). */
type RawTokenRate = { inputPer1M: number; outputPer1M: number };

// Active subscription plans the user has declared via settings. Keyed
// by model prefix (matched longest-first by `findPricing`). Loaded from
// `~/.marblo/subscription-plans.json` at app start so the per-agent
// MCP servers see the same plan map (they re-load the file on first
// pricing lookup).
const SUBSCRIPTION_PLANS_FILE = path.join(
  os.homedir(),
  ".marblo",
  "subscription-plans.json",
);

interface SubscriptionPlanEntry {
  /** Model id prefix this plan applies to (e.g. "claude-opus", "gpt-5") */
  modelPrefix: string;
  monthlyFlatUsd: number;
  monthlyTokenAllowance?: number;
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

let subscriptionPlanCache: SubscriptionPlanEntry[] | null = null;
let subscriptionPlanCacheMtime = 0;

function loadSubscriptionPlans(): SubscriptionPlanEntry[] {
  try {
    if (!fs.existsSync(SUBSCRIPTION_PLANS_FILE)) {
      subscriptionPlanCache = [];
      return [];
    }
    const stat = fs.statSync(SUBSCRIPTION_PLANS_FILE);
    if (subscriptionPlanCache && stat.mtimeMs === subscriptionPlanCacheMtime) {
      return subscriptionPlanCache;
    }
    const raw = fs.readFileSync(SUBSCRIPTION_PLANS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SubscriptionPlanEntry[];
    subscriptionPlanCache = Array.isArray(parsed) ? parsed : [];
    subscriptionPlanCacheMtime = stat.mtimeMs;
    return subscriptionPlanCache;
  } catch (err) {
    console.error(
      "[CostTracker] Failed to load subscription plans:",
      err instanceof Error ? err.message : err,
    );
    subscriptionPlanCache = [];
    return [];
  }
}

// Per-token rates, keyed by model-id PREFIX (longest match wins — see
// findPricing). Two layers:
//
//   1. `registryPricing()` — every CLI-verified current model, straight from
//      the vendor-neutral single source (electron/model-registry.ts). Adding a
//      new model there is enough; nothing here needs editing.
//   2. The legacy rows below — retired models the registry deliberately does
//      not carry (Claude 3.x/4.x, gpt-4o, o3, gemini) but that still appear in
//      historical session logs, plus generic family fallbacks.
//
// Registry rows are spread LAST so the single source always wins a key clash.
//
// ★2026-07-25 pricing repair (routing P1-3). What was wrong before:
//   - `claude-fable-5` / `claude-opus-5` / `claude-sonnet-5` had NO row and
//     prefix-matched nothing, so they fell through to `default` $3/$15. The
//     complex tier's default is Fable5 ($10/$50) → its OUTPUT cost was under-
//     reported 3.3x. The most expensive workload was the most under-reported.
//   - `gpt-5.5` said $5/$20; the real rate is $5/$30 (output under-reported 33%).
// Both distortions pointed the same way — cheap-looking expensive work — which
// is exactly the failure mode that would poison the routing epic's cost-vs-
// effect learning. Sources: ticket 150oZRiD / PR#596 official-docs crawl.
const MODEL_PRICING: Record<string, RawTokenRate> = {
  // ── Legacy / retired (not in the registry, still in historical logs) ──
  // Claude 4.x family
  "claude-opus-4-7": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-0": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-sonnet-4-0": { inputPer1M: 3, outputPer1M: 15 },
  // Haiku 4.5 is $1/$5 (the old $0.8/$4 row here was Haiku 3.5's rate). The
  // registry carries the dated id `claude-haiku-4-5-20251001` that alias
  // `haiku` actually resolves to; this undated prefix catches any other spelling.
  "claude-haiku-4-5": { inputPer1M: 1, outputPer1M: 5 },
  // Claude 3.x family (legacy)
  "claude-3-5-sonnet": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4 },
  "claude-3-opus": { inputPer1M: 15, outputPer1M: 75 },
  // OpenAI — Codex-CLI-only model (api ✗, so not a routing candidate and not
  // in the registry), but it does show up in session logs.
  "gpt-5.3-codex": { inputPer1M: 1.75, outputPer1M: 14 },
  // Generic gpt-5.x fallback for variants we haven't catalogued. Set to the
  // gpt-5.5 rate rather than the old $5/$20 so an unknown 5.x errs toward
  // OVER-reporting; specific rows (registry included) still win by length.
  "gpt-5": { inputPer1M: 5, outputPer1M: 30 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },
  o3: { inputPer1M: 10, outputPer1M: 40 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  // Gemini
  "gemini-3-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-3-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // ── Single source: every CLI-verified current model ───────────────────
  ...registryPricing(),

  // Fallback for a model id that matches nothing above. Kept at Sonnet's rate
  // for continuity, but note it is now a genuine last resort — every model we
  // actually route to has a real row.
  default: { inputPer1M: 3, outputPer1M: 15 },
};

/**
 * Per-token rate for a model id, by longest-prefix match over MODEL_PRICING
 * (the sentinel `default` row is the last resort, never a prefix candidate).
 *
 * Exported as a pure function so the rate table is unit-testable without
 * standing up a CostTracker — `findPricing` is a private method behind
 * subscription-plan resolution and filesystem state. The under-reporting bugs
 * this repairs (Fable5 charged at Sonnet's rate, gpt-5.5 output at $20) were
 * invisible precisely because nothing could assert on this table.
 */
export function perTokenRateFor(model: string): RawTokenRate {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const keys = Object.keys(MODEL_PRICING)
    .filter((k) => k !== "default")
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return MODEL_PRICING[key];
  }
  return MODEL_PRICING["default"];
}

// Regex patterns for PTY output parsing (non-Claude CLIs)
const COST_PATTERN =
  /(?:Total cost|Cost|Session cost)[:\s]*\$([0-9]+\.?[0-9]*)/i;
const INPUT_TOKENS_PATTERN = /(?:input)[\s]*(?:tokens)?[:\s]*([0-9,]+)/i;
const OUTPUT_TOKENS_PATTERN = /(?:output)[\s]*(?:tokens)?[:\s]*([0-9,]+)/i;

const MAX_BUFFER_SIZE = 2048;
const SESSION_POLL_INTERVAL_MS = 15_000; // poll JSONL every 15s

// ── Claude account rate-limit probe cadence (Phase 1b) ──────────────────
// Plan limits move slowly; one headless get_usage probe per 5 minutes is
// plenty and costs no tokens. A snapshot older than 3 missed polls is stale
// and must NOT be re-emitted (the dashboard keeps showing the last-written
// value, but we stop asserting it as current). After 3 consecutive probe
// failures (old CLI without get_usage, auth problem, …) back off for 30
// minutes so we don't spawn a doomed process every 5 minutes forever.
const CLAUDE_PROBE_INTERVAL_MS = 5 * 60_000;
const CLAUDE_PROBE_STALE_MS = 3 * CLAUDE_PROBE_INTERVAL_MS;
const CLAUDE_PROBE_BACKOFF_MS = 30 * 60_000;
const CLAUDE_PROBE_MAX_FAILURES = 3;

const ZERO_TOTALS: TokenTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/**
 * Read a JSONL file into its lines, matching `readline` semantics: a trailing
 * newline does NOT yield a final empty element, so line indices stay stable as
 * complete records are appended (the line-count watermark relies on this).
 */
function readJsonlLines(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw) return [];
  const lines = raw.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

interface SessionTracker {
  agentId: string;
  format: SessionFormat;
  // claude: fixed JSONL path. codex/gemini: the currently-tracked newest
  // session file under searchRoot ("" until the CLI writes one).
  filePath: string;
  // codex/gemini: directory tree to scan for the newest session file
  // ("" for claude, which uses a fixed filePath).
  searchRoot: string;
  // Per-current-file parse state (line watermark + cumulative + model).
  state: ParseState;
  // Cross-file running totals that drive the emitted rollup — survives a file
  // rotation (codex/gemini start a fresh file on resume) so no data is lost.
  accumulated: TokenTotals;
  // Current model id for pricing / display (refined as the file is parsed).
  model: string;
  // Agent/session-scoped running cost. Subscription allowance accounting is
  // monthly-scoped separately; this remains the total emitted for this tracker.
  totalCostUsd: number;
  // Last rate-limit % emitted — so we only re-emit on change (codex), not
  // every 15s tick when only the rate-limit (and no tokens) is present.
  lastRlPercent?: number;
  // Same for the weekly (7-day / secondary) window — re-emit when it moves
  // even if the 5h primary and token totals didn't.
  lastRlWeeklyPercent?: number;
  timer: ReturnType<typeof setInterval>;
}

// Antigravity tracker. agy stores token usage in a per-conversation SQLite
// store (protobuf blobs), polled incrementally by gen_metadata row idx — a
// different mechanism from the JSONL `SessionTracker`, so it gets its own map.
interface AgyTracker {
  agentId: string;
  /** Highest gen_metadata.idx already counted (-1 = none yet). */
  lastIdx: number;
  accumulated: TokenTotals;
  model: string;
  totalCostUsd: number;
  /** true once we discover only a legacy .pb store (tokens not decodable). */
  limited: boolean;
  loggedLimited: boolean;
  timer: ReturnType<typeof setInterval>;
}

export class CostTracker {
  private buffers: Map<string, string> = new Map();
  private sessions: Map<string, SessionTracker> = new Map();
  private agySessions: Map<string, AgyTracker> = new Map();
  private monthlySubscriptionTokens: Map<string, TokenTotals> = new Map();
  private onCostDetected?: (agentId: string, cost: CostEntry) => void;

  // Claude plan rate-limits are ACCOUNT-global (all spawned claude agents
  // share ~/.claude auth), so one probe + one snapshot serves every claude
  // tracker. See claude-usage-probe.ts for why this is the official source.
  private claudeUsage: ClaudeUsageSnapshot | null = null;
  private claudeProbeTimer: ReturnType<typeof setInterval> | null = null;
  private claudeProbeInFlight = false;
  private claudeProbeFailures = 0;
  private claudeProbeBackoffUntil = 0;

  constructor(onCostDetected?: (agentId: string, cost: CostEntry) => void) {
    this.onCostDetected = onCostDetected;
  }

  /**
   * Resolve the pricing scheme for a model.
   *
   * Subscription plans declared in `~/.marblo/subscription-plans.json`
   * win over per-token defaults — patent claim 8 explicitly contemplates
   * mixing 구독제 and 토큰단위 across agents in one orchestration. If the
   * model has no subscription declared, fall back to the per-token rate
   * table (longest-prefix match). Sentinel "default" row is the last
   * resort so unknown models still produce a sensible cost figure.
   */
  private findPricing(model: string): ModelPricing {
    // 1. Subscription plans win when the user has declared one for this model.
    const plans = loadSubscriptionPlans();
    const matchedPlan = plans
      .filter((p) => model.startsWith(p.modelPrefix))
      .sort((a, b) => b.modelPrefix.length - a.modelPrefix.length)[0];
    if (matchedPlan) {
      return {
        scheme: "subscription",
        monthlyScopeKey: matchedPlan.modelPrefix,
        monthlyFlatUsd: matchedPlan.monthlyFlatUsd,
        monthlyTokenAllowance: matchedPlan.monthlyTokenAllowance,
        overagePerToken: matchedPlan.overagePerToken,
      };
    }
    // 2. Per-token rate (default).
    const r = perTokenRateFor(model);
    return {
      scheme: "per-token",
      inputPer1M: r.inputPer1M,
      outputPer1M: r.outputPer1M,
    };
  }

  /**
   * Compute USD cost for a given (input, output) token bundle under the
   * resolved pricing scheme. Single chokepoint so subscription / per-token
   * math lives in one place — patent claim 8 통합과금량 산출 시 호출자가
   * scheme 별 분기를 신경쓰지 않게 한다.
   *
   * For subscription scheme:
   *   - within `monthlyTokenAllowance`: incremental cost = 0 (the flat
   *     monthly fee covers it; the fee itself is reported as a separate
   *     rollup line, not per-call)
   *   - over allowance: charge `overagePerToken` rate for excess only
   *   - allowance accounting requires `accumulatedTokens` (cumulative for
   *     the month so far) so the caller can detect the crossover
   */
  computeIncrementalCost(
    pricing: ModelPricing,
    deltaInputTokens: number,
    deltaOutputTokens: number,
    accumulatedInputTokens = 0,
    accumulatedOutputTokens = 0,
    deltaCacheReadTokens = 0,
    deltaCacheWriteTokens = 0,
  ): number {
    if (pricing.scheme === "per-token") {
      // API-equivalent value INCLUDING cache. Cache rates aren't in the table;
      // derive from the input rate via the standard Anthropic ratios (cache
      // read = 0.1×input, 5-min cache write = 1.25×input) as a model-agnostic
      // approximation. Without this, cache-heavy models (Claude routinely has
      // 90%+ of its tokens as cache reads) get costed at ~4% of real value,
      // which made Codex look pricier than Claude.
      const cacheReadPer1M = pricing.inputPer1M * 0.1;
      const cacheWritePer1M = pricing.inputPer1M * 1.25;
      return (
        (deltaInputTokens * pricing.inputPer1M +
          deltaOutputTokens * pricing.outputPer1M +
          deltaCacheReadTokens * cacheReadPer1M +
          deltaCacheWriteTokens * cacheWritePer1M) /
        1_000_000
      );
    }
    // subscription
    if (!pricing.monthlyTokenAllowance || !pricing.overagePerToken) {
      // Pure flat-fee plan with no overage — incremental cost is 0;
      // the flat monthly fee is rolled up separately.
      return 0;
    }
    const totalAfter =
      accumulatedInputTokens +
      accumulatedOutputTokens +
      deltaInputTokens +
      deltaOutputTokens;
    const totalBefore = accumulatedInputTokens + accumulatedOutputTokens;
    const allowance = pricing.monthlyTokenAllowance;
    if (totalAfter <= allowance) return 0;
    // Some or all of this delta crossed the allowance. Charge only the
    // portion above allowance, split proportionally across input/output.
    const overageDelta = Math.min(
      deltaInputTokens + deltaOutputTokens,
      totalAfter - Math.max(totalBefore, allowance),
    );
    if (overageDelta <= 0) return 0;
    const totalDelta = deltaInputTokens + deltaOutputTokens || 1;
    const overInput = (deltaInputTokens / totalDelta) * overageDelta;
    const overOutput = (deltaOutputTokens / totalDelta) * overageDelta;
    return (
      (overInput * pricing.overagePerToken.inputPer1M +
        overOutput * pricing.overagePerToken.outputPer1M) /
      1_000_000
    );
  }

  private monthKey(now = new Date()): string {
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${now.getFullYear()}-${month}`;
  }

  private monthlyUsageKey(pricing: SubscriptionPricing): string {
    return `${this.monthKey()}:${pricing.monthlyScopeKey}`;
  }

  private getMonthlySubscriptionTotals(
    pricing: SubscriptionPricing,
  ): TokenTotals {
    const key = this.monthlyUsageKey(pricing);
    const existing = this.monthlySubscriptionTokens.get(key);
    if (existing) return existing;
    const created = { ...ZERO_TOTALS };
    this.monthlySubscriptionTokens.set(key, created);
    return created;
  }

  private computeDeltaCost(pricing: ModelPricing, delta: TokenTotals): number {
    if (pricing.scheme === "subscription") {
      const monthly = this.getMonthlySubscriptionTotals(pricing);
      return this.computeIncrementalCost(
        pricing,
        delta.input,
        delta.output,
        monthly.input,
        monthly.output,
        delta.cacheRead,
        delta.cacheWrite,
      );
    }

    return this.computeIncrementalCost(
      pricing,
      delta.input,
      delta.output,
      0,
      0,
      delta.cacheRead,
      delta.cacheWrite,
    );
  }

  private recordMonthlySubscriptionUsage(
    pricing: ModelPricing,
    delta: TokenTotals,
  ): void {
    if (pricing.scheme !== "subscription") return;
    const monthly = this.getMonthlySubscriptionTotals(pricing);
    monthly.input += delta.input;
    monthly.output += delta.output;
    monthly.cacheRead += delta.cacheRead;
    monthly.cacheWrite += delta.cacheWrite;
  }

  // ── Strategy 1: JSONL Session File Tracking (claude / codex / gemini) ──

  /**
   * Start tracking an agent's session file for token usage.
   *
   * Claude writes a JSONL under `~/.claude/projects/<encoded>/<sessionId>.jsonl`
   * (a concrete file we can resolve immediately). Codex/Gemini write under a
   * per-agent CLI home that may not exist yet at launch — those route through
   * `trackCliSession`, whose poller self-resolves the newest file each tick.
   */
  trackSession(
    agentId: string,
    rootPath: string,
    sessionId: string | null | undefined,
    model: string,
  ): void {
    // Don't double-track
    if (this.sessions.has(agentId)) {
      this.stopSession(agentId);
    }

    // Codex / Gemini: file-based tracking from the per-agent CLI home dir.
    // These never resolve to a ~/.claude path, so route them out early.
    if (model === "gpt" || model === "gemini") {
      this.trackCliSession(agentId, model);
      return;
    }

    // Antigravity: token usage lives in protobuf blobs in a per-conversation
    // SQLite store, attributed via agentId → conversationUUID. Separate
    // subsystem (not JSONL) — see trackAgySession.
    if (model === "antigravity") {
      this.trackAgySession(agentId);
      return;
    }

    const encodedPath = encodeClaudeProjectDir(rootPath);
    const projectDir = path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
    );

    let filePath: string;
    if (sessionId) {
      filePath = path.join(projectDir, `${sessionId}.jsonl`);
    } else {
      // Find the most recently modified JSONL file
      try {
        const files = fs
          .readdirSync(projectDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => ({
            name: f,
            mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) {
          console.warn(`[CostTracker] No JSONL files found in ${projectDir}`);
          return;
        }
        filePath = path.join(projectDir, files[0].name);
        console.log(
          `[CostTracker] No sessionId — using most recent: ${files[0].name}`,
        );
      } catch {
        console.warn(`[CostTracker] Cannot read project dir: ${projectDir}`);
        return;
      }
    }

    // The file may not exist yet: a pinned fresh launch (claude --session-id)
    // wires tracking BEFORE Claude has written the JSONL. Set the tracker up
    // regardless — pollSessionFile no-ops until the file appears, then folds it
    // in (the no-sessionId branch above always resolves to an existing file).
    // Bailing here is exactly what left newly-spawned agents reading 0 tokens.
    if (!fs.existsSync(filePath)) {
      console.log(
        `[CostTracker] Session file not present yet, will poll until it appears: ${filePath}`,
      );
    }

    const tracker: SessionTracker = {
      agentId,
      format: "claude",
      filePath,
      searchRoot: "",
      state: newParseState(),
      accumulated: { ...ZERO_TOTALS },
      model,
      totalCostUsd: 0,
      timer: setInterval(
        () => this.pollSessionFile(agentId),
        SESSION_POLL_INTERVAL_MS,
      ),
    };

    this.sessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking session file for agent=${agentId}: ${filePath}`,
    );

    // Account-global rate-limit probe runs while any claude tracker lives.
    this.ensureClaudeProbe();

    // Do an initial scan right away
    this.pollSessionFile(agentId);
  }

  // ── Claude account rate-limit probe (Phase 1b) ──────────────────────

  private ensureClaudeProbe(): void {
    if (this.claudeProbeTimer) return;
    this.claudeProbeTimer = setInterval(
      () => void this.pollClaudeUsage(),
      CLAUDE_PROBE_INTERVAL_MS,
    );
    void this.pollClaudeUsage();
  }

  /** Stop probing when the last claude-format tracker is gone. */
  private stopClaudeProbeIfIdle(): void {
    if (!this.claudeProbeTimer) return;
    for (const t of this.sessions.values()) {
      if (t.format === "claude") return;
    }
    clearInterval(this.claudeProbeTimer);
    this.claudeProbeTimer = null;
  }

  private async pollClaudeUsage(): Promise<void> {
    if (this.claudeProbeInFlight) return;
    if (Date.now() < this.claudeProbeBackoffUntil) return;
    this.claudeProbeInFlight = true;
    try {
      const snap = await probeClaudeUsage(resolveClaudeBinary().command);
      if (snap) {
        this.claudeUsage = snap;
        this.claudeProbeFailures = 0;
        console.log(
          `[CostTracker] Claude rate-limit probe: 5h=${snap.primaryPercent}% ` +
            `7d=${snap.secondaryPercent}% plan=${snap.planType ?? "?"}`,
        );
      } else {
        this.claudeProbeFailures++;
        if (this.claudeProbeFailures >= CLAUDE_PROBE_MAX_FAILURES) {
          this.claudeProbeBackoffUntil = Date.now() + CLAUDE_PROBE_BACKOFF_MS;
          this.claudeProbeFailures = 0;
          console.warn(
            `[CostTracker] Claude rate-limit probe failed ${CLAUDE_PROBE_MAX_FAILURES}x — ` +
              `backing off ${CLAUDE_PROBE_BACKOFF_MS / 60_000}min`,
          );
        }
      }
    } finally {
      this.claudeProbeInFlight = false;
    }
  }

  /**
   * Latest account-global claude rate-limit snapshot, or null when we have
   * none / it has gone stale. Null means "no information" — emit() then
   * leaves the rate-limit fields untouched instead of asserting dead values.
   */
  private freshClaudeRateLimit(): RateLimitInfo | null {
    const s = this.claudeUsage;
    if (!s) return null;
    if (Date.now() - s.capturedAt > CLAUDE_PROBE_STALE_MS) return null;
    return {
      planType: s.planType,
      primaryPercent: s.primaryPercent,
      primaryResetAt: s.primaryResetAt,
      secondaryPercent: s.secondaryPercent,
      secondaryResetAt: s.secondaryResetAt,
    };
  }

  /**
   * Start file-based tracking for a Codex (gpt) or Gemini agent. Unlike the
   * Claude path, the session file may not exist yet at launch — the poller
   * re-resolves the newest session file under the per-agent CLI home on every
   * tick, so it picks the file up as soon as the CLI writes it. No data is
   * lost: the file persists, and a reconnect re-scans it from scratch.
   *
   *   Codex:  <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl
   *   Gemini: <GEMINI_CLI_HOME>/.gemini/tmp/<hash>/chats/session-*.jsonl
   */
  private trackCliSession(agentId: string, model: "gpt" | "gemini"): void {
    // SSOT: model→session-format mapping lives in session-parsers.formatForModel.
    // `model` is narrowed to "gpt" | "gemini" here, so it always maps to a
    // concrete format ("codex" | "gemini") — never the null (antigravity/custom)
    // branch — hence the non-null assertion.
    const format: SessionFormat = formatForModel(model)!;
    const searchRoot =
      format === "codex" ? codexSessionsDir(agentId) : geminiTmpDir(agentId);

    const tracker: SessionTracker = {
      agentId,
      format,
      filePath: "",
      searchRoot,
      state: newParseState(),
      accumulated: { ...ZERO_TOTALS },
      // Best-guess default until the session records its real model id.
      model: format === "codex" ? "gpt-5.5" : "gemini-2.5-pro",
      totalCostUsd: 0,
      timer: setInterval(
        () => this.pollSessionFile(agentId),
        SESSION_POLL_INTERVAL_MS,
      ),
    };

    this.sessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking ${format} session for agent=${agentId} under ${searchRoot}`,
    );

    // Initial scan (file may not exist yet — poller tolerates that).
    this.pollSessionFile(agentId);
  }

  stopSession(agentId: string): void {
    const tracker = this.sessions.get(agentId);
    if (tracker) {
      clearInterval(tracker.timer);
      this.sessions.delete(agentId);
    }
    this.stopAgySession(agentId);
    this.stopClaudeProbeIfIdle();
  }

  /**
   * Poll the tracked file once: resolve the active file (codex/gemini rotate),
   * parse the new lines via the format-specific parser, fold the delta into the
   * agent's running total, and emit. Synchronous — session files are bounded
   * and we only re-read on a 15s tick.
   */
  private pollSessionFile(agentId: string): void {
    const tracker = this.sessions.get(agentId);
    if (!tracker) return;

    try {
      // codex / gemini: re-resolve the newest session file each tick (it may
      // appear after launch, or rotate when the agent resumes). On a file
      // switch, reset the per-file parse state but KEEP `accumulated` so the
      // agent's cross-session running total is preserved (no data loss).
      if (tracker.format !== "claude") {
        const newest = this.findNewestSessionFile(tracker);
        if (!newest) return;
        if (newest !== tracker.filePath) {
          tracker.filePath = newest;
          tracker.state = newParseState();
        }
      }

      if (!tracker.filePath || !fs.existsSync(tracker.filePath)) return;

      const lines = readJsonlLines(tracker.filePath);
      const { delta, newState } = parseSessionDelta(
        tracker.format,
        lines,
        tracker.state,
      );
      tracker.state = newState;
      if (newState.model) tracker.model = newState.model;
      // Rate-limit source per format: codex carries it inside the rollout
      // JSONL (parsed into newState); claude JSONLs have none — the official
      // source is the account-global get_usage probe (null when stale/absent,
      // which emit() treats as "no information").
      const rateLimit =
        tracker.format === "claude"
          ? this.freshClaudeRateLimit()
          : newState.rateLimit;
      this.emit(tracker, delta, rateLimit);
    } catch (err) {
      console.error(
        `[CostTracker] Error polling session for agent=${agentId}:`,
        err,
      );
    }
  }

  /** Fold a token delta into the agent's running total and fire onCostDetected.
   * Also forwards the latest rate-limit snapshot (codex rollout / claude
   * get_usage probe) — emitted when tokens change OR the rate-limit % moves,
   * so flat polls don't spam the writer. */
  private emit(
    tracker: SessionTracker,
    delta: TokenTotals,
    rateLimit?: RateLimitInfo | null,
  ): void {
    const hasTokens =
      delta.input > 0 ||
      delta.output > 0 ||
      delta.cacheRead > 0 ||
      delta.cacheWrite > 0;
    const rlPercent = rateLimit?.primaryPercent ?? undefined;
    const rlWeeklyPercent = rateLimit?.secondaryPercent ?? undefined;
    const rlChanged =
      typeof rlPercent === "number" && rlPercent !== tracker.lastRlPercent;
    const rlWeeklyChanged =
      typeof rlWeeklyPercent === "number" &&
      rlWeeklyPercent !== tracker.lastRlWeeklyPercent;
    if (!hasTokens && !rlChanged && !rlWeeklyChanged) return;
    if (typeof rlPercent === "number") tracker.lastRlPercent = rlPercent;
    if (typeof rlWeeklyPercent === "number")
      tracker.lastRlWeeklyPercent = rlWeeklyPercent;

    const acc = tracker.accumulated;

    // Patent claim 8: route through pricing-scheme aware calculator.
    const pricing = this.findPricing(tracker.model);
    const deltaCost = this.computeDeltaCost(pricing, delta);
    this.recordMonthlySubscriptionUsage(pricing, delta);

    acc.input += delta.input;
    acc.output += delta.output;
    acc.cacheRead += delta.cacheRead;
    acc.cacheWrite += delta.cacheWrite;
    tracker.totalCostUsd += deltaCost;

    this.onCostDetected?.(tracker.agentId, {
      totalCost: tracker.totalCostUsd,
      inputTokens: acc.input,
      outputTokens: acc.output,
      cacheReadTokens: acc.cacheRead,
      cacheWriteTokens: acc.cacheWrite,
      model: tracker.model,
      timestamp: Date.now(),
      deltaInputTokens: delta.input,
      deltaOutputTokens: delta.output,
      deltaCacheReadTokens: delta.cacheRead,
      deltaCacheWriteTokens: delta.cacheWrite,
      deltaCost,
      detectedPlanType: rateLimit?.planType ?? undefined,
      rateLimitPercent: rlPercent,
      rateLimitResetAt: rateLimit?.primaryResetAt ?? undefined,
      rateLimitWeeklyPercent: rlWeeklyPercent,
      rateLimitWeeklyResetAt: rateLimit?.secondaryResetAt ?? undefined,
    });

    console.log(
      `[CostTracker] Agent=${tracker.agentId} model=${tracker.model} ` +
        `in=${acc.input.toLocaleString()} out=${acc.output.toLocaleString()} ` +
        `cache_read=${acc.cacheRead.toLocaleString()} cache_write=${acc.cacheWrite.toLocaleString()}`,
    );
  }

  /** Walk searchRoot and return the newest session file matching the format. */
  private findNewestSessionFile(tracker: SessionTracker): string | null {
    const root = tracker.searchRoot;
    if (!root || !fs.existsSync(root)) return null;
    let best: { path: string; mtime: number } | null = null;
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const matches =
          tracker.format === "codex"
            ? entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")
            : entry.name.startsWith("session-") &&
              entry.name.endsWith(".jsonl");
        if (!matches) continue;
        let mtime: number;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          continue;
        }
        if (!best || mtime > best.mtime) best = { path: full, mtime };
      }
    }
    return best ? best.path : null;
  }

  // ── Strategy 1b: Antigravity SQLite Store Tracking ─────────────

  /**
   * Start tracking an antigravity agent. The conversation `.db` is born after
   * the first turn and lives under the user's shared ~/.gemini, so the poller
   * re-resolves it (by agentId → conversationUUID) each tick and reads new
   * `gen_metadata` rows incrementally. Resilient to the file not existing yet
   * and to a reconnect (the watermark restarts at -1, re-summing the store).
   */
  private trackAgySession(agentId: string): void {
    if (this.agySessions.has(agentId)) this.stopAgySession(agentId);
    const tracker: AgyTracker = {
      agentId,
      lastIdx: -1,
      accumulated: { ...ZERO_TOTALS },
      model: "gemini-3-flash", // agy default; refined from the store
      totalCostUsd: 0,
      limited: false,
      loggedLimited: false,
      timer: setInterval(
        () => this.pollAgySession(agentId),
        SESSION_POLL_INTERVAL_MS,
      ),
    };
    this.agySessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking antigravity store for agent=${agentId}`,
    );
    this.pollAgySession(agentId);
  }

  private stopAgySession(agentId: string): void {
    const t = this.agySessions.get(agentId);
    if (t) {
      clearInterval(t.timer);
      this.agySessions.delete(agentId);
    }
  }

  private pollAgySession(agentId: string): void {
    const tracker = this.agySessions.get(agentId);
    if (!tracker) return;
    try {
      const store = resolveAgyStore(agentId);
      if (!store) return; // .db not written yet — try again next tick
      if (store.format === "pb") {
        // Legacy flat-protobuf store — token blobs aren't reliably decodable.
        // Mark limited (PTY parsing still captures rate-limit/exit signals).
        if (!tracker.loggedLimited) {
          tracker.limited = true;
          tracker.loggedLimited = true;
          console.warn(
            `[CostTracker] agy agent=${agentId} uses legacy .pb store — ` +
              `token capture limited (no decode); relying on PTY signals.`,
          );
        }
        return;
      }
      const delta = readAgyDbDelta(store.path, tracker.lastIdx);
      tracker.lastIdx = delta.maxIdx;
      if (delta.model) tracker.model = delta.model;
      this.emitAgy(tracker, delta.input, delta.output);
    } catch (err) {
      console.error(
        `[CostTracker] Error polling agy store for agent=${agentId}:`,
        err,
      );
    }
  }

  /** Fold an agy token delta into the running total and fire onCostDetected.
   * Mirrors `emit` but works off the standalone AgyTracker. agy reports no
   * separate cache tokens, so cacheRead/cacheWrite stay 0. */
  private emitAgy(tracker: AgyTracker, dInput: number, dOutput: number): void {
    if (dInput <= 0 && dOutput <= 0) return;
    const acc = tracker.accumulated;

    const pricing = this.findPricing(tracker.model);
    const delta: TokenTotals = {
      input: dInput,
      output: dOutput,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const deltaCost = this.computeDeltaCost(pricing, delta);
    this.recordMonthlySubscriptionUsage(pricing, delta);

    acc.input += dInput;
    acc.output += dOutput;
    tracker.totalCostUsd += deltaCost;

    this.onCostDetected?.(tracker.agentId, {
      totalCost: tracker.totalCostUsd,
      inputTokens: acc.input,
      outputTokens: acc.output,
      cacheReadTokens: acc.cacheRead,
      cacheWriteTokens: acc.cacheWrite,
      model: tracker.model,
      timestamp: Date.now(),
      deltaInputTokens: dInput,
      deltaOutputTokens: dOutput,
      deltaCacheReadTokens: 0,
      deltaCacheWriteTokens: 0,
      deltaCost,
    });

    console.log(
      `[CostTracker] Agent=${tracker.agentId} model=${tracker.model} (agy) ` +
        `in=${acc.input.toLocaleString()} out=${acc.output.toLocaleString()}`,
    );
  }

  // ── Strategy 2: PTY Output Parsing (antigravity / custom) ───────

  processOutput(agentId: string, data: string): void {
    // Skip if we're tracking this agent via a session file or the agy store —
    // double-counting PTY-scraped numbers on top of accurate file tracking
    // would inflate usage. (A limited .pb agy session stays tracked here, so
    // its PTY fallback still applies.)
    if (this.sessions.has(agentId)) return;
    const agy = this.agySessions.get(agentId);
    if (agy && !agy.limited) return;

    let buffer = (this.buffers.get(agentId) || "") + data;
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = buffer.slice(-MAX_BUFFER_SIZE);
    }
    this.buffers.set(agentId, buffer);

    this.tryParse(agentId, data);
  }

  private tryParse(agentId: string, data: string): void {
    const costMatch = COST_PATTERN.exec(data);
    if (costMatch) {
      const totalCost = parseFloat(costMatch[1]);
      if (totalCost > 0) {
        this.onCostDetected?.(agentId, {
          totalCost,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "unknown",
          timestamp: Date.now(),
          deltaInputTokens: 0,
          deltaOutputTokens: 0,
          deltaCacheReadTokens: 0,
          deltaCacheWriteTokens: 0,
          deltaCost: totalCost,
        });
      }
      return;
    }

    const inputMatch = INPUT_TOKENS_PATTERN.exec(data);
    const outputMatch = OUTPUT_TOKENS_PATTERN.exec(data);
    if (inputMatch || outputMatch) {
      const inputTokens = inputMatch
        ? parseInt(inputMatch[1].replace(/,/g, ""), 10)
        : 0;
      const outputTokens = outputMatch
        ? parseInt(outputMatch[1].replace(/,/g, ""), 10)
        : 0;

      if (inputTokens > 0 || outputTokens > 0) {
        // Unknown-model fallback: use the per-token "default" rate. We
        // don't try subscription matching here since we don't know which
        // model produced the tokens.
        const fallback = MODEL_PRICING["default"];
        const pricing: ModelPricing = {
          scheme: "per-token",
          inputPer1M: fallback.inputPer1M,
          outputPer1M: fallback.outputPer1M,
        };
        const cost = this.computeIncrementalCost(
          pricing,
          inputTokens,
          outputTokens,
        );

        this.onCostDetected?.(agentId, {
          totalCost: cost,
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "unknown",
          timestamp: Date.now(),
          deltaInputTokens: inputTokens,
          deltaOutputTokens: outputTokens,
          deltaCacheReadTokens: 0,
          deltaCacheWriteTokens: 0,
          deltaCost: cost,
        });
      }
    }
  }

  clearBuffer(agentId: string): void {
    this.buffers.delete(agentId);
  }

  clearAll(): void {
    this.buffers.clear();
    this.monthlySubscriptionTokens.clear();
    for (const tracker of this.sessions.values()) {
      clearInterval(tracker.timer);
    }
    this.sessions.clear();
    for (const tracker of this.agySessions.values()) {
      clearInterval(tracker.timer);
    }
    this.agySessions.clear();
    if (this.claudeProbeTimer) {
      clearInterval(this.claudeProbeTimer);
      this.claudeProbeTimer = null;
    }
    this.claudeUsage = null;
  }
}
