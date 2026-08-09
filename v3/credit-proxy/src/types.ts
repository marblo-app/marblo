/**
 * Shared types for the L2 metering proxy PoC.
 *
 * ★ Prompt caching, in one paragraph (design doc §4-A):
 * Anthropic's prompt cache does NOT cache the model's output. It caches the
 * *input prefix* — system prompt, tool definitions, conversation history, file
 * contents — up to a `cache_control` breakpoint. If the next request carries a
 * byte-identical prefix, the vendor skips re-prefilling it and bills those
 * tokens at 0.1x. Our workload is ~99% input (11.9M cache-read tokens vs 79k
 * output per ticket, #885 §3), so a proxy that perturbs the prefix by a single
 * byte turns every turn into a full-price re-prefill: $9.85 -> $63.10 per
 * ticket (6.4x). That is the one number this PoC exists to measure.
 */

/** Anthropic `usage` object, normalized (missing fields become 0). */
export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written into the cache this request (billed at 1.25x for the 5m TTL). */
  cacheCreationInputTokens: number;
  /** Tokens served from cache this request (billed at 0.1x). ★ the metric that matters. */
  cacheReadInputTokens: number;
}

export function emptyUsage(): UsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

/** Total input-side tokens, regardless of how they were billed. */
export function totalInputTokens(usage: UsageSnapshot): number {
  return (
    usage.inputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}

/**
 * ★ The G-P1 metric: what share of this request's input came from cache.
 * Returns 0 when there was no input at all (rather than NaN) so callers can
 * average a series without special-casing empty turns.
 */
export function cacheHitRatio(usage: UsageSnapshot): number {
  const total = totalInputTokens(usage);
  if (total <= 0) return 0;
  return usage.cacheReadInputTokens / total;
}

/** What we learned from a single upstream response (streaming or not). */
export interface ResponseObservation {
  usage: UsageSnapshot;
  stopReason: string | null;
  /** Streaming only: did we see `message_start` / `message_stop`? */
  sawMessageStart: boolean;
  sawMessageStop: boolean;
  /** Set when the upstream emitted an `error` SSE event or an error envelope. */
  errorType: string | null;
  /** Content block types seen, in order (`text`, `tool_use`, `thinking`, …). */
  contentBlockTypes: string[];
}

export function emptyObservation(): ResponseObservation {
  return {
    usage: emptyUsage(),
    stopReason: null,
    sawMessageStart: false,
    sawMessageStop: false,
    errorType: null,
    contentBlockTypes: [],
  };
}

/**
 * One relayed request, as recorded for PoC measurement.
 * ★ Design invariant P4: no prompt or response *body* is ever recorded here —
 * only shapes, counts and ids.
 */
export interface RelayRecord {
  proxyRequestId: string;
  method: string;
  path: string;
  /** Upstream HTTP status, or 0 if the upstream call never completed. */
  status: number;
  /** Model as declared in the request body, if we could sniff it. */
  model: string | null;
  stream: boolean;
  requestBytes: number;
  /** sha256 of the request body we *sent upstream*. Byte-exactness evidence. */
  requestBodySha256: string;
  usage: UsageSnapshot;
  cacheHitRatio: number;
  stopReason: string | null;
  /** ms until the first upstream byte reached the client. */
  ttfbMs: number;
  totalMs: number;
  /** Set only on transport failures (upstream unreachable, aborted, timeout). */
  transportError: string | null;
}
