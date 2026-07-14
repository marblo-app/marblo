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
 *
 * In every format we normalise to the same shape as the Claude path:
 *   input     = billable prompt tokens, cache EXCLUDED
 *   cacheRead = cached/cache-read tokens
 *   output    = billable completion tokens, reasoning INCLUDED
 *   cacheWrite= cache-creation tokens (only Claude reports these)
 */

export type SessionFormat = "claude" | "codex" | "gemini";

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
    default:
      return null;
  }
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
