/**
 * Format-aware session-file parsers for cost tracking.
 *
 * Each supported CLI persists token usage in its own JSONL dialect. These
 * pure functions turn a snapshot of file lines + prior parse state into an
 * incremental token delta, so `CostTracker` stays format-agnostic.
 *
 *   - claude : one `assistant` line per turn with `message.usage` — SUM the
 *              usage of every new line (each API call is billed separately).
 *   - gemini : one `gemini` line per turn with a `tokens` object — SUM, same
 *              as claude. `tokens.input` INCLUDES `cached`; `total =
 *              input + output + thoughts`, so reasoning ("thoughts") is NOT
 *              part of `output` and must be folded in.
 *   - codex  : `event_msg`→`token_count` events whose `info.total_token_usage`
 *              is CUMULATIVE for the whole session. We watermark the latest
 *              cumulative and emit the difference. `total = input + output`,
 *              so `reasoning_output_tokens` is already inside `output_tokens`;
 *              `cached_input_tokens` is a subset of `input_tokens`.
 *   - grok   : ACP `session/update` stream (`updates.jsonl`); the
 *              `turn_completed` update carries `usage` for THAT PROMPT — SUM
 *              across turns, same as claude. See `grokLineUsage` for the
 *              vendor-documented field policy.
 *
 * In every format we normalise to the same shape as the Claude path:
 *   input     = billable prompt tokens, cache EXCLUDED
 *   cacheRead = cached/cache-read tokens
 *   output    = billable completion tokens, reasoning INCLUDED
 *   cacheWrite= cache-creation tokens (only Claude reports these)
 */

export type SessionFormat = "claude" | "codex" | "gemini" | "grok";

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Subscription / rate-limit snapshot. Codex emits this from its rollout
 * `rate_limits` events; claude gets it from the account-global get_usage
 * probe (claude-usage-probe.ts) — its session JSONL carries no rate-limit
 * data, so the claude parser always leaves `ParseState.rateLimit` null.
 * Gemini has no source.
 */
export interface RateLimitInfo {
  planType: string | null; // e.g. "plus", "pro"
  primaryPercent: number | null; // short (~5h) window used %
  primaryResetAt: number | null; // epoch seconds
  primaryWindowDurationMins?: number | null;
  secondaryPercent: number | null; // weekly window used %
  secondaryResetAt: number | null;
  secondaryWindowDurationMins?: number | null;
}

export interface ParseState {
  /** Number of lines already consumed (line-count watermark). */
  lastLineCount: number;
  /**
   * Mapped cumulative totals — only meaningful for cumulative formats
   * (codex), where the delta is `latest cumulative − this`.
   */
  cumulative: TokenTotals;
  /** Last model id observed in the file (null until seen). */
  model: string | null;
  /** Latest rate-limit snapshot (codex only; null otherwise). */
  rateLimit: RateLimitInfo | null;
}

export interface ParseDelta {
  delta: TokenTotals;
  newState: ParseState;
}

const ZERO: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function newParseState(): ParseState {
  return {
    lastLineCount: 0,
    cumulative: { ...ZERO },
    model: null,
    rateLimit: null,
  };
}

/**
 * Map a Marblo agent CLI model id to its session-file format. Returns null
 * for models we cannot parse from JSONL (antigravity uses protobuf; custom
 * has no known format) — callers fall back to PTY parsing for those.
 */
export function formatForModel(
  model: string | null | undefined,
): SessionFormat | null {
  switch (model) {
    case "claude":
      return "claude";
    case "gpt":
      return "codex";
    case "gemini":
      return "gemini";
    case "grok":
      return "grok";
    default:
      return null;
  }
}

/**
 * Harnesses whose usage lives in a **per-agent CLI home** that the cost
 * tracker self-resolves (`CostTracker.trackCliSession`), as opposed to claude
 * (a concrete `~/.claude` path known at launch) or antigravity (SQLite store).
 *
 * ★SSOT on purpose. This list used to be spelled out inline in three places —
 * the tracker's routing branch, the spawn-time kickoff in agent-manager, and
 * the session callback in main — and `grok` landed in only two of them
 * (#630). The tracker knew how to read grok's `updates.jsonl`, but nothing
 * ever *started* it on a fresh spawn, so grok wrote 0 cost_logs rows and fell
 * out of the Usage tab's vendor→sub-model breakdown entirely while still
 * showing up on the events-sourced axes. Adding a harness must not require
 * remembering three call sites.
 */
export const CLI_HOME_TRACKED_MODELS = ["gpt", "gemini", "grok"] as const;

export type CliHomeTrackedModel = (typeof CLI_HOME_TRACKED_MODELS)[number];

/** True when this harness is cost-tracked from its per-agent CLI home. */
export function isCliHomeTracked(
  model: string | null | undefined,
): model is CliHomeTrackedModel {
  return CLI_HOME_TRACKED_MODELS.includes(model as CliHomeTrackedModel);
}

export function parseSessionDelta(
  format: SessionFormat,
  lines: string[],
  state: ParseState,
): ParseDelta {
  switch (format) {
    case "claude":
      return parseLineSummed(lines, state, claudeLineUsage);
    case "gemini":
      return parseLineSummed(lines, state, geminiLineUsage);
    case "grok":
      return parseLineSummed(lines, state, grokLineUsage);
    case "codex":
      return parseCodexCumulative(lines, state);
  }
}

// ── Line-summed formats (claude, gemini) ────────────────────────────────

type LineUsage = (entry: unknown) => {
  usage: TokenTotals;
  model: string | null;
} | null;

function parseLineSummed(
  lines: string[],
  state: ParseState,
  extract: LineUsage,
): ParseDelta {
  const delta: TokenTotals = { ...ZERO };
  let model = state.model;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    if (lineNum <= state.lastLineCount) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }
    const got = extract(entry);
    if (!got) continue;
    delta.input += got.usage.input;
    delta.output += got.usage.output;
    delta.cacheRead += got.usage.cacheRead;
    delta.cacheWrite += got.usage.cacheWrite;
    if (got.model) model = got.model;
  }

  const cumulative: TokenTotals = {
    input: state.cumulative.input + delta.input,
    output: state.cumulative.output + delta.output,
    cacheRead: state.cumulative.cacheRead + delta.cacheRead,
    cacheWrite: state.cumulative.cacheWrite + delta.cacheWrite,
  };
  return {
    delta,
    newState: {
      lastLineCount: lineNum,
      cumulative,
      model,
      rateLimit: state.rateLimit,
    },
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pctOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.min(100, Math.max(0, n));
}

function readWindowDurationMins(v: Record<string, unknown>): number | null {
  return numOrNull(
    v.windowDurationMins ??
      v.window_duration_mins ??
      v.windowMinutes ??
      v.window_minutes,
  );
}

function classifyRateLimitWindows(
  first: {
    percent: number | null;
    resetAt: number | null;
    windowDurationMins: number | null;
  },
  second: {
    percent: number | null;
    resetAt: number | null;
    windowDurationMins: number | null;
  },
  previous: RateLimitInfo | null,
): Omit<RateLimitInfo, "planType"> {
  let primary = first;
  let secondary = second;
  if (
    first.windowDurationMins !== null &&
    second.windowDurationMins !== null &&
    first.windowDurationMins > second.windowDurationMins
  ) {
    primary = second;
    secondary = first;
  } else if (
    first.windowDurationMins !== null &&
    second.percent === null &&
    first.windowDurationMins >= 7 * 24 * 60
  ) {
    primary = { percent: null, resetAt: null, windowDurationMins: null };
    secondary = first;
  }

  return {
    primaryPercent: primary.percent ?? previous?.primaryPercent ?? null,
    primaryResetAt: primary.resetAt ?? previous?.primaryResetAt ?? null,
    primaryWindowDurationMins:
      primary.windowDurationMins ?? previous?.primaryWindowDurationMins ?? null,
    secondaryPercent: secondary.percent ?? previous?.secondaryPercent ?? null,
    secondaryResetAt: secondary.resetAt ?? previous?.secondaryResetAt ?? null,
    secondaryWindowDurationMins:
      secondary.windowDurationMins ??
      previous?.secondaryWindowDurationMins ??
      null,
  };
}

function claudeLineUsage(entry: unknown): ReturnType<LineUsage> {
  const e = entry as {
    type?: string;
    message?: { model?: string; usage?: Record<string, unknown> };
  };
  if (e?.type !== "assistant" || !e.message?.usage) return null;
  const u = e.message.usage;
  return {
    usage: {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
    },
    model: e.message.model ?? null,
  };
}

function geminiLineUsage(entry: unknown): ReturnType<LineUsage> {
  const e = entry as {
    type?: string;
    model?: string;
    tokens?: Record<string, unknown>;
  };
  if (e?.type !== "gemini" || !e.tokens) return null;
  const t = e.tokens;
  const input = num(t.input);
  const cached = num(t.cached);
  return {
    usage: {
      // `input` includes cached; bill only the non-cached remainder.
      input: Math.max(0, input - cached),
      // `total = input + output + thoughts` → reasoning is separate.
      output: num(t.output) + num(t.thoughts),
      cacheRead: cached,
      cacheWrite: 0,
    },
    model: e.model ?? null,
  };
}

/**
 * Grok Build (xAI native harness) — `<GROK_HOME>/sessions/<encoded-cwd>/
 * <session-id>/updates.jsonl`, the ACP session-update stream.
 *
 * The only billable-token record in the whole session tree is the
 * `turn_completed` update:
 *
 *   {"timestamp":…, "method":"session/update", "params":{"sessionId":…,
 *     "update":{"sessionUpdate":"turn_completed", "prompt_id":…,
 *       "stop_reason":"end_turn",
 *       "usage":{"inputTokens":1325602,"outputTokens":13590,
 *                "totalTokens":1339192,"cachedReadTokens":1194752,
 *                "reasoningTokens":3167,"modelCalls":16,
 *                "costUsdTicks":7016656000,
 *                "modelUsage":{"grok-4.5-build":{…}},"numTurns":16}}}}
 *
 * ★Field policy is the vendor's, not our inference — grok ships its own docs
 * at `<GROK_HOME>/docs/user-guide/14-headless-mode.md`, and the live sessions
 * on this machine arithmetically agree with them:
 *
 *   - `usage` sums ONE PROMPT (subagents that finished inside it included),
 *     not the session. So turn_completed records are deltas → SUM them.
 *     That is why this rides `parseLineSummed` and not the codex
 *     cumulative-watermark path; summing a cumulative stream, or diffing a
 *     per-prompt one, would both be wrong by orders of magnitude.
 *   - the ACP `usage.inputTokens` is the FULL prompt input, cache INCLUDED
 *     ("only the headless projector subtracts cache"). Verified:
 *     inputTokens + outputTokens === totalTokens, and cachedReadTokens is a
 *     subset of inputTokens. We bill the uncached remainder, matching every
 *     other format in this file.
 *   - `reasoningTokens` ⊆ `outputTokens` (the doc's own example arithmetic:
 *     total = input + cache_read + output, with reasoning left out). Adding
 *     it — as the gemini path must for `thoughts` — would double-count.
 *   - grok reports no cache-CREATION tokens, so `cacheWrite` stays 0.
 *
 * Two shapes we must survive, both observed live:
 *   - a turn that never reached the model (`stop_reason:"error"`, e.g. the 401
 *     from the auth-propagation bug) carries NO `usage` key at all → null.
 *   - `_meta.totalTokens` on `agent_thought_chunk` lines is CONTEXT-window
 *     occupancy, not billable spend. Matching only `turn_completed` keeps it
 *     out; never widen this to any line with a token-ish field.
 *
 * ★`costUsdTicks` (1 USD = 10^10 ticks) is deliberately NOT read here. It is
 * the vendor's exact stamped cost and would beat our estimated `grok-4.5`
 * rate — but it only appears when the server reported a COMPLETE cost, which
 * on the subscription/OAuth path it usually does not (`costIsPartial`, or the
 * field simply absent). Mixing a sometimes-present vendor bill with a
 * sometimes-computed one would make cost_logs mean two different things per
 * row, and plumbing it end-to-end needs a cost_logs schema column. Cost stays
 * on the existing pricing path; tokens — which is what was missing — land now.
 *
 * Model attribution: `modelUsage` is keyed by the model the server actually
 * served (`grok-4.5`, `grok-4.5-build`, …) and a single prompt may span more
 * than one. `CostEntry` carries one model id, so we report the key with the
 * most tokens; the pricing table resolves `grok-4.5-build` onto the
 * `grok-4.5` registry row by longest-prefix, so a build-variant turn is
 * priced, not billed at 0.
 */
function grokLineUsage(entry: unknown): ReturnType<LineUsage> {
  const e = entry as {
    params?: {
      update?: {
        sessionUpdate?: string;
        usage?: Record<string, unknown> | null;
      } | null;
    } | null;
  };
  const update = e?.params?.update;
  if (update?.sessionUpdate !== "turn_completed") return null;
  const u = update.usage;
  if (!u || typeof u !== "object") return null; // errored turn — no spend

  const inputTokens = num(u.inputTokens);
  const cached = num(u.cachedReadTokens);
  return {
    usage: {
      // `inputTokens` includes cache reads; bill the remainder.
      input: Math.max(0, inputTokens - cached),
      // reasoning is already inside output — do NOT add reasoningTokens.
      output: num(u.outputTokens),
      cacheRead: cached,
      cacheWrite: 0,
    },
    model: dominantGrokModel(u.modelUsage),
  };
}

/**
 * Pick the `modelUsage` key that accounts for the most tokens in this turn.
 * Ties keep the first key seen, so attribution is deterministic across polls.
 * Returns null when the turn carries no per-model breakdown — the caller then
 * keeps whatever model it already knew rather than inventing one.
 */
function dominantGrokModel(modelUsage: unknown): string | null {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  let best: string | null = null;
  let bestTokens = -1;
  for (const [id, raw] of Object.entries(
    modelUsage as Record<string, unknown>,
  )) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const tokens =
      num(row.totalTokens) || num(row.inputTokens) + num(row.outputTokens);
    if (tokens > bestTokens) {
      best = id;
      bestTokens = tokens;
    }
  }
  return best;
}

// ── Cumulative format (codex) ───────────────────────────────────────────

function parseCodexCumulative(lines: string[], state: ParseState): ParseDelta {
  let latest: TokenTotals | null = null;
  let model = state.model;
  let rateLimit = state.rateLimit;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    if (lineNum <= state.lastLineCount) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const e = entry as {
      type?: string;
      payload?: {
        type?: string;
        id?: string;
        model?: string;
        info?: { total_token_usage?: Record<string, unknown> | null } | null;
        rate_limits?: {
          plan_type?: string;
          primary?: Record<string, unknown> | null;
          secondary?: Record<string, unknown> | null;
        } | null;
      };
    };
    // Model id lives in `payload.model` — `session_meta` at session start and
    // `turn_context` events per turn (verified against codex cli 0.134). Grab
    // it wherever it appears so we attribute the real model, not the default.
    if (e.payload?.model) {
      model = e.payload.model;
      continue;
    }
    if (e?.type === "event_msg" && e.payload?.type === "token_count") {
      // rate_limits ride on token_count events — often the very ones with
      // info:null (a rate-limit-only ping). Capture before the token guard,
      // carrying prior values forward field-by-field.
      const rl = e.payload.rate_limits;
      if (rl) {
        const primary = rl.primary ?? null;
        const secondary = rl.secondary ?? null;
        const windows = classifyRateLimitWindows(
          {
            percent: primary ? pctOrNull(primary.used_percent) : null,
            resetAt: primary ? numOrNull(primary.resets_at) : null,
            windowDurationMins: primary
              ? readWindowDurationMins(primary)
              : null,
          },
          {
            percent: secondary ? pctOrNull(secondary.used_percent) : null,
            resetAt: secondary ? numOrNull(secondary.resets_at) : null,
            windowDurationMins: secondary
              ? readWindowDurationMins(secondary)
              : null,
          },
          rateLimit,
        );
        rateLimit = {
          planType:
            typeof rl.plan_type === "string"
              ? rl.plan_type
              : (rateLimit?.planType ?? null),
          ...windows,
        };
      }
      const total = e.payload.info?.total_token_usage;
      if (!total) continue; // info:null is a rate-limit-only event
      const inputTokens = num(total.input_tokens);
      const cached = num(total.cached_input_tokens);
      latest = {
        // `input_tokens` includes cached; bill the non-cached remainder.
        input: Math.max(0, inputTokens - cached),
        // `total = input + output` → reasoning already inside output_tokens.
        output: num(total.output_tokens),
        cacheRead: cached,
        cacheWrite: 0,
      };
    }
  }

  // No new cumulative reading → nothing to add, keep prior watermark.
  // (rateLimit may still have advanced — carry it forward.)
  if (!latest) {
    return {
      delta: { ...ZERO },
      newState: { ...state, lastLineCount: lineNum, model, rateLimit },
    };
  }

  const delta: TokenTotals = {
    input: Math.max(0, latest.input - state.cumulative.input),
    output: Math.max(0, latest.output - state.cumulative.output),
    cacheRead: Math.max(0, latest.cacheRead - state.cumulative.cacheRead),
    cacheWrite: Math.max(0, latest.cacheWrite - state.cumulative.cacheWrite),
  };
  return {
    delta,
    newState: { lastLineCount: lineNum, cumulative: latest, model, rateLimit },
  };
}
