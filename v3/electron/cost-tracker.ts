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
  grokSessionsDir,
  resolveClaudeBinary,
} from "./agent-config";
import { getModel, isHarnessFamilyId, registryPricing } from "./model-registry";
import {
  probeClaudeUsage,
  type ClaudeUsageSnapshot,
} from "./claude-usage-probe";
import {
  formatForModel,
  isCliHomeTracked,
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
  "subscription-plans.json"
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
      err instanceof Error ? err.message : err
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

  // ★NO `default` ROW. See `resolvePerTokenRate` below — an unmatched model id
  // now costs 0 and is reported, never silently billed at some other model's rate.
};

/** Rate charged when nothing matched. Zero — never a guess. */
export const UNMATCHED_RATE: Readonly<RawTokenRate> = {
  inputPer1M: 0,
  outputPer1M: 0,
};

/** How a rate was resolved (`unmatched` = nothing matched, rate is zero). */
export type RateMatchKind =
  | "exact"
  | "registry"
  | "prefix"
  | "prefix-ci"
  | "unmatched";

export interface RateResolution {
  rate: RawTokenRate;
  /** false ⇒ rate is {0,0} and this lookup must be surfaced, not billed. */
  matched: boolean;
  kind: RateMatchKind;
  /** Pricing-table key / registry id that supplied the rate (undefined when unmatched). */
  matchedKey?: string;
}

/**
 * Resolve the per-token rate for a model id. **Pure** — the unmatched counter
 * is bumped by the charging path (`recordUnmatchedPricing`), not by a lookup,
 * so tests and dashboards can probe the table without polluting telemetry.
 *
 * ── ★Why there is no longer a Sonnet-shaped fallback (ghost cost, P1) ──────
 * The table used to end in `default: {3, 15}` — Sonnet's rate. Anything that
 * matched no row was billed as if it were Sonnet, silently. That was tolerable
 * when every model we ran was Anthropic's; it stopped being tolerable the
 * moment the registry grew grok(xai) / GLM(zai) / MiniMax rows, because:
 *
 *   - `MiniMax-M3` is registered under the vendor's own mixed-case id, but the
 *     table lookup and the prefix scan are BOTH case-sensitive. A session that
 *     reported `minimax-m3` matched nothing → billed $3/$15 instead of its real
 *     $0.6/$2.4. Overcharged 5x on input, 6.25x on output — invented money.
 *   - `grok`, `opus`, `fable`… are CLI *aliases*, not ids. They matched no row
 *     either, so a Fable5 agent seen by its alias was billed at Sonnet's rate.
 *
 * Both directions are corrupting: cost-vs-effect routing learns from these
 * numbers, so a fabricated rate teaches the router a fabricated preference.
 * The rule now is that we bill only what we can source, and make the gap loud.
 *
 * Resolution order (first hit wins):
 *   1. `exact`     — verbatim row in MODEL_PRICING (covers `MiniMax-M3`).
 *   2. `registry`  — model-registry lookup: alias-aware AND case-insensitive.
 *                    This is the ★single source (PR#598); we re-ask it rather
 *                    than duplicating rates here.
 *   3. `prefix`    — longest-prefix over the table (legacy/family rows:
 *                    `claude-3-*`, `gpt-4o`, `gemini-*`, generic `gpt-5`).
 *   4. `prefix-ci` — same scan, case-folded, for vendor ids that arrive in a
 *                    different casing than the row was written in.
 *   5. `unmatched` — rate 0. Caller warns + counts. NEVER a borrowed rate.
 */
export function resolvePerTokenRate(model: string): RateResolution {
  const raw = (model ?? "").trim();
  if (!raw)
    return { rate: { ...UNMATCHED_RATE }, matched: false, kind: "unmatched" };

  // 1. exact row
  const exact = MODEL_PRICING[raw];
  if (exact)
    return { rate: exact, matched: true, kind: "exact", matchedKey: raw };

  // 2. registry re-lookup (alias → concrete id, case-insensitive)
  const entry = getModel(raw);
  if (entry) {
    return {
      rate: {
        inputPer1M: entry.pricing.inputPer1M,
        outputPer1M: entry.pricing.outputPer1M,
      },
      matched: true,
      kind: "registry",
      matchedKey: entry.id,
    };
  }

  // 3/4. longest-prefix over the table — case-sensitive first, then folded.
  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (raw.startsWith(key))
      return {
        rate: MODEL_PRICING[key],
        matched: true,
        kind: "prefix",
        matchedKey: key,
      };
  }
  const lowered = raw.toLowerCase();
  for (const key of keys) {
    if (lowered.startsWith(key.toLowerCase()))
      return {
        rate: MODEL_PRICING[key],
        matched: true,
        kind: "prefix-ci",
        matchedKey: key,
      };
  }

  // 5. nothing. Zero, and let the caller make the miss visible.
  return { rate: { ...UNMATCHED_RATE }, matched: false, kind: "unmatched" };
}

/**
 * Per-token rate for a model id. Thin, pure wrapper over
 * `resolvePerTokenRate` — an unmatched id yields {0, 0}, not a stand-in rate.
 *
 * Exported so the rate table is unit-testable without standing up a
 * CostTracker (`findPricing` sits behind subscription-plan resolution and
 * filesystem state). The under-reporting bugs this file already repaired
 * (Fable5 at Sonnet's rate, gpt-5.5 output at $20) were invisible precisely
 * because nothing could assert on this table.
 */
export function perTokenRateFor(model: string): RawTokenRate {
  return resolvePerTokenRate(model).rate;
}

/**
 * 트래커 씨앗으로 쓸 **구체 모델 id** 만 통과시킨다. 하네스족 이름(`claude`,
 * `gpt`…)이나 빈 값은 null — 모델 자리에 족을 넣는 것이 이 파일이 고치는 결함
 * 자체다(`cost_logs.model='claude'` + 단가 미매칭 $0 청구).
 *
 * `model@effort` 로 들어와도 effort 는 벗긴다: 단가·집계 축은 모델 id 다.
 */
export function normalizeSeedModel(
  candidate: string | null | undefined
): string | null {
  const raw = (candidate ?? "").trim();
  if (!raw) return null;
  const id = raw.split("@")[0].trim();
  if (!id || isHarnessFamilyId(id)) return null;
  return id;
}

// ── Unmatched-model visibility (ghost-cost detector) ─────────────────────
// A model we cannot price is a real operational fact — a vendor row we never
// added, an env-swap profile leaking an unregistered id (the failure mode
// model-registry.ts guards against in its `ANTHROPIC_DEFAULT_*_MODEL` notes),
// or a CLI that renamed a model under us. Billing it at 0 keeps the ledger
// honest; this counter keeps the gap from being *quiet*, which is the other
// half of the bug.

export interface UnmatchedPricingEvent {
  /** Model id exactly as the session/PTY reported it. */
  model: string;
  /** Times this id has been seen unmatched in this process (cumulative). */
  count: number;
  /** True on the first sighting of this id. */
  firstSeen: boolean;
}

const unmatchedPricingCounts = new Map<string, number>();
let unmatchedPricingSink: ((ev: UnmatchedPricingEvent) => void) | null = null;

/**
 * Register the telemetry sink for unmatched-model pricing lookups (main.ts
 * wires this to `mainTelemetry.pricingUnmatched`). One sink; re-registering
 * replaces it. Pass null to detach.
 */
export function onUnmatchedPricing(
  sink: ((ev: UnmatchedPricingEvent) => void) | null
): void {
  unmatchedPricingSink = sink;
}

/** Cumulative unmatched counts by model id — for rollups/tests. */
export function unmatchedPricingCounters(): Record<string, number> {
  return Object.fromEntries(unmatchedPricingCounts);
}

/** Test hook: forget every unmatched sighting (and the once-per-id warn latch). */
export function resetUnmatchedPricing(): void {
  unmatchedPricingCounts.clear();
}

/**
 * Count one unmatched pricing lookup and make it visible.
 *
 * Log volume is bounded on purpose: the poller ticks every 15s per agent, so
 * warning on every sighting would bury the signal it exists to raise. We warn
 * (and emit telemetry) on the first sighting and then at each order of
 * magnitude — enough to show both "this happened" and "this is happening a
 * lot", without a log flood. The exact count is always available via
 * `unmatchedPricingCounters()`.
 */
function recordUnmatchedPricing(model: string): void {
  const id = (model ?? "").trim() || "(empty)";
  const count = (unmatchedPricingCounts.get(id) ?? 0) + 1;
  unmatchedPricingCounts.set(id, count);

  const isMilestone = count === 1 || Math.log10(count) % 1 === 0;
  if (!isMilestone) return;

  console.warn(
    `[CostTracker] ★UNMATCHED MODEL PRICING: "${id}" is in neither the ` +
      `pricing table nor the model registry (alias/case-folded lookups also ` +
      `missed). Billing it at $0 — cost for this model is UNDER-REPORTED, not ` +
      `estimated. Seen ${count}x. Fix: add a verified row to ` +
      `electron/model-registry.ts (never invent a rate).`
  );
  unmatchedPricingSink?.({ model: id, count, firstSeen: count === 1 });
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
   * table. ★An id that resolves to nothing is billed at 0 and counted as
   * unmatched — see `resolvePerTokenRate` for why no fallback rate is safe.
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
    // 2. Per-token rate. This is the money path, so an unmatched id is
    //    recorded here (the resolver itself stays pure).
    const resolved = resolvePerTokenRate(model);
    if (!resolved.matched) recordUnmatchedPricing(model);
    return {
      scheme: "per-token",
      inputPer1M: resolved.rate.inputPer1M,
      outputPer1M: resolved.rate.outputPer1M,
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
    deltaCacheWriteTokens = 0
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
      totalAfter - Math.max(totalBefore, allowance)
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
    pricing: SubscriptionPricing
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
        delta.cacheWrite
      );
    }

    return this.computeIncrementalCost(
      pricing,
      delta.input,
      delta.output,
      0,
      0,
      delta.cacheRead,
      delta.cacheWrite
    );
  }

  private recordMonthlySubscriptionUsage(
    pricing: ModelPricing,
    delta: TokenTotals
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
    /**
     * ★이 launch 의 argv 에서 되읽은 **구체 모델 id**(`claude-opus-5`). 없으면
     * undefined — 지어내지 않는다.
     *
     * 왜 필요한가: `model` 은 하네스족(`claude`)이지 모델 id 가 아니다. 종전엔 그
     * 족 문자열이 트래커의 초기 모델이 되어 (a) 세션 JSONL 이 첫 assistant 턴을
     * 쓰기 전에 나가는 emit — 특히 토큰 0 인 rate-limit 전용 emit — 이 전부
     * `cost_logs.model='claude'` 로 적재됐고, (b) `findPricing("claude")` 가
     * 단가표·레지스트리 양쪽에서 미매칭이라 그 구간이 $0 로 청구됐다(고스트 비용).
     * 씨앗을 구체 모델로 주면 첫 emit 부터 모델 id 와 정상 단가가 붙는다. 파일에서
     * 실제 과금 모델이 읽히면 그 관측이 여전히 씨앗을 덮는다(pollSessionFile).
     */
    spawnedModelId?: string
  ): void {
    // Don't double-track
    if (this.sessions.has(agentId)) {
      this.stopSession(agentId);
    }

    // Codex / Gemini / Grok: file-based tracking from the per-agent CLI home
    // dir. These never resolve to a ~/.claude path, so route them out early.
    //
    // ★`grok` used to be dropped by the skip branch below instead, on the
    // (correct) ground that it writes no ~/.claude JSONL. The cost of that was
    // total invisibility: 0 cost_logs rows, so grok work showed up in
    // task_outcomes as done but in the Usage tab / KG / BigQuery as if it had
    // spent nothing. The xAI CLI does report per-prompt usage after all — in
    // its ACP `updates.jsonl` under the isolated GROK_HOME, see `grokLineUsage`
    // in session-parsers.ts — so it belongs on this path, reading only its own
    // home. (Being tracked also stops the PTY scraper from inventing
    // model:"unknown" rows off grok's terminal output.)
    if (isCliHomeTracked(model)) {
      this.trackCliSession(agentId, model, spawnedModelId);
      return;
    }

    // Antigravity: token usage lives in protobuf blobs in a per-conversation
    // SQLite store, attributed via agentId → conversationUUID. Separate
    // subsystem (not JSONL) — see trackAgySession.
    if (model === "antigravity") {
      this.trackAgySession(agentId);
      return;
    }

    // ★Harnesses that do NOT write a ~/.claude JSONL must not fall through to
    // the claude reader below (ghost cost, adjacent to the P1 pricing fix).
    //
    //   - `custom` has no known session format at all — session-parsers'
    //     `formatForModel` already documents that these fall back to PTY
    //     parsing.
    //
    // Falling through was not merely useless, it MISATTRIBUTED: the
    // no-sessionId branch below picks the most recently modified JSONL in the
    // project dir, which on the reconnect path (main.ts `--continue`, where
    // candidate.sessionId is null) is some *other* agent's live Claude
    // session. That charged one agent's real Anthropic tokens to a different
    // agent — the same "bill something we cannot source" failure as the Sonnet
    // default rate, except the dollars are real and double-counted.
    //
    // Not tracking is the honest outcome: PTY parsing still runs for these
    // (processOutput skips only agents with a live tracker), so a CLI that
    // prints its own cost is still captured.
    if (model === "custom") {
      console.log(
        `[CostTracker] agent=${agentId} model=${model} writes no ~/.claude ` +
          `JSONL — skipping file tracking (PTY fallback still applies). ` +
          `Wiring a real ${model} usage source is a separate task.`
      );
      return;
    }

    const encodedPath = encodeClaudeProjectDir(rootPath);
    const projectDir = path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath
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
          `[CostTracker] No sessionId — using most recent: ${files[0].name}`
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
        `[CostTracker] Session file not present yet, will poll until it appears: ${filePath}`
      );
    }

    const tracker: SessionTracker = {
      agentId,
      format: "claude",
      filePath,
      searchRoot: "",
      state: newParseState(),
      accumulated: { ...ZERO_TOTALS },
      // 구체 모델이 관측됐으면 그것으로, 아니면 종전대로 하네스족. 족으로 남는
      // 경우는 argv 에 모델을 핀하지 않은 launch 뿐이고, 그때도 첫 assistant 턴이
      // 파싱되는 순간 pollSessionFile 이 실제 모델로 덮는다.
      model: normalizeSeedModel(spawnedModelId) ?? model,
      totalCostUsd: 0,
      timer: setInterval(
        () => this.pollSessionFile(agentId),
        SESSION_POLL_INTERVAL_MS
      ),
    };

    this.sessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking session file for agent=${agentId}: ${filePath}`
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
      CLAUDE_PROBE_INTERVAL_MS
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
            `7d=${snap.secondaryPercent}% plan=${snap.planType ?? "?"}`
        );
      } else {
        this.claudeProbeFailures++;
        if (this.claudeProbeFailures >= CLAUDE_PROBE_MAX_FAILURES) {
          this.claudeProbeBackoffUntil = Date.now() + CLAUDE_PROBE_BACKOFF_MS;
          this.claudeProbeFailures = 0;
          console.warn(
            `[CostTracker] Claude rate-limit probe failed ${CLAUDE_PROBE_MAX_FAILURES}x — ` +
              `backing off ${CLAUDE_PROBE_BACKOFF_MS / 60_000}min`
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
   * Start file-based tracking for a Codex (gpt), Gemini or Grok agent. Unlike
   * the Claude path, the session file may not exist yet at launch — the poller
   * re-resolves the newest session file under the per-agent CLI home on every
   * tick, so it picks the file up as soon as the CLI writes it. No data is
   * lost: the file persists, and a reconnect re-scans it from scratch.
   *
   *   Codex:  <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl
   *   Gemini: <GEMINI_CLI_HOME>/.gemini/tmp/<hash>/chats/session-*.jsonl
   *   Grok:   <GROK_HOME>/sessions/<url-encoded-cwd>/<session-uuid>/updates.jsonl
   */
  private trackCliSession(
    agentId: string,
    model: "gpt" | "gemini" | "grok",
    spawnedModelId?: string
  ): void {
    // SSOT: model→session-format mapping lives in session-parsers.formatForModel.
    // `model` is narrowed to "gpt" | "gemini" | "grok" here, so it always maps
    // to a concrete format ("codex" | "gemini" | "grok") — never the null
    // (antigravity/custom) branch — hence the non-null assertion.
    const format: SessionFormat = formatForModel(model)!;
    const searchRoot =
      format === "codex"
        ? codexSessionsDir(agentId)
        : format === "grok"
        ? grokSessionsDir(agentId)
        : geminiTmpDir(agentId);

    const tracker: SessionTracker = {
      agentId,
      format,
      filePath: "",
      searchRoot,
      state: newParseState(),
      accumulated: { ...ZERO_TOTALS },
      // 관측된 스폰 모델이 있으면 그것이 최선의 씨앗이다(codex `-c model="…"` 핀).
      // 없으면 하네스별 기본 추정값 — 세션이 실제 모델 id 를 기록하는 순간 덮인다.
      // grok 은 이 기본값이 스폰 시 핀하는 id(agent-config GROK_DEFAULT_MODEL)라,
      // modelUsage breakdown 없는 턴도 unmatched 대신 레지스트리 행에 가격 매겨진다.
      // 어느 경우든 하네스족 문자열은 절대 모델 자리에 들어가지 않는다.
      model:
        normalizeSeedModel(spawnedModelId) ??
        (format === "codex"
          ? "gpt-5.5"
          : format === "grok"
          ? "grok-4.5"
          : "gemini-2.5-pro"),
      totalCostUsd: 0,
      timer: setInterval(
        () => this.pollSessionFile(agentId),
        SESSION_POLL_INTERVAL_MS
      ),
    };

    this.sessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking ${format} session for agent=${agentId} under ${searchRoot}`
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
        tracker.state
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
        err
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
    rateLimit?: RateLimitInfo | null
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
        `cache_read=${acc.cacheRead.toLocaleString()} cache_write=${acc.cacheWrite.toLocaleString()}`
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
          // ★grok nests a full child session dir per subagent under
          // `<session>/subagents/`, each with its own updates.jsonl. The
          // PARENT's turn_completed usage already includes every subagent that
          // finished inside the turn (vendor doc, headless-mode §Usage notes),
          // so descending here would double-count that spend — and the newest
          // file in the tree is often the subagent's, which would also make
          // the tracker hop off the real session mid-run.
          if (tracker.format === "grok" && entry.name === "subagents") continue;
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const matches =
          tracker.format === "codex"
            ? entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")
            : tracker.format === "grok"
            ? entry.name === "updates.jsonl"
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
        SESSION_POLL_INTERVAL_MS
      ),
    };
    this.agySessions.set(agentId, tracker);
    console.log(
      `[CostTracker] Tracking antigravity store for agent=${agentId}`
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
              `token capture limited (no decode); relying on PTY signals.`
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
        err
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
        `in=${acc.input.toLocaleString()} out=${acc.output.toLocaleString()}`
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
        // ★PTY scraping gives us token counts with NO model attribution — we
        // literally do not know what produced them. This used to bill them at
        // the "default" (= Sonnet) rate, which invented a dollar figure out of
        // a number we could not attribute. Now it costs 0 and registers as
        // unmatched, same rule as an unknown model id.
        recordUnmatchedPricing("unknown");
        const pricing: ModelPricing = {
          scheme: "per-token",
          inputPer1M: UNMATCHED_RATE.inputPer1M,
          outputPer1M: UNMATCHED_RATE.outputPer1M,
        };
        const cost = this.computeIncrementalCost(
          pricing,
          inputTokens,
          outputTokens
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
