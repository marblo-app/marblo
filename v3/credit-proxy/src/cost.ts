/**
 * Cache arithmetic — the number that decides L2.
 *
 * Design doc §4-A: with the measured per-ticket token mix (#885 §3), preserving
 * the prompt cache costs $9.85 per ticket and breaking it costs $63.10 — 6.4x.
 * A 30% markup earns ~$3 per ticket, so a broken cache costs 17x the margin it
 * was supposed to protect. `cacheBreakMultiplier` is that ratio, computed from
 * whatever usage we actually observe, so the PoC reports a measured number
 * rather than the design doc's estimate.
 */

import { totalInputTokens, type UsageSnapshot } from "./types";

/** Anthropic cache multipliers, applied to the model's *input* rate (#883 §3-F). */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;

export interface TokenRates {
  /** USD per 1M input tokens. */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens. */
  outputPerMTokUsd: number;
}

/**
 * Rates mirrored from `v3/electron/model-registry.ts` (the live single source of
 * truth for pricing — see memo `model_pricing_truth_and_kg_cold_seed`). Copied
 * rather than imported because this package deploys to Cloud Run without the
 * Electron tree; the PoC doc records the drift risk.
 */
export const MODEL_RATES: Readonly<Record<string, TokenRates>> = {
  "claude-opus-5": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  "claude-sonnet-5": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  "claude-haiku-4-5-20251001": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
};

export const DEFAULT_RATES: TokenRates = MODEL_RATES["claude-opus-5"];

export function ratesForModel(model: string | null): TokenRates {
  if (model === null) return DEFAULT_RATES;
  return MODEL_RATES[model] ?? DEFAULT_RATES;
}

/** What this request actually costs us, with cache multipliers applied. */
export function costUsd(usage: UsageSnapshot, rates: TokenRates): number {
  const input = usage.inputTokens * rates.inputPerMTokUsd;
  const cacheRead =
    usage.cacheReadInputTokens * rates.inputPerMTokUsd * CACHE_READ_MULTIPLIER;
  const cacheWrite =
    usage.cacheCreationInputTokens *
    rates.inputPerMTokUsd *
    CACHE_WRITE_5M_MULTIPLIER;
  const output = usage.outputTokens * rates.outputPerMTokUsd;
  return (input + cacheRead + cacheWrite + output) / 1_000_000;
}

/**
 * Counterfactual: the same turn if the cache had been broken, i.e. every
 * input token re-prefilled at full price. This is what we pay if the proxy
 * perturbs the prefix.
 */
export function costIfCacheBrokenUsd(
  usage: UsageSnapshot,
  rates: TokenRates,
): number {
  const input = totalInputTokens(usage) * rates.inputPerMTokUsd;
  const output = usage.outputTokens * rates.outputPerMTokUsd;
  return (input + output) / 1_000_000;
}

/**
 * ★ costIfCacheBroken / cost. 1.0 means the cache bought us nothing on this
 * turn; the design doc's estimate for a whole ticket is 6.4.
 */
export function cacheBreakMultiplier(
  usage: UsageSnapshot,
  rates: TokenRates,
): number {
  const preserved = costUsd(usage, rates);
  if (preserved <= 0) return 1;
  return costIfCacheBrokenUsd(usage, rates) / preserved;
}

/** Micro-USD is the ledger unit (§6-F). Rounded up so we never under-charge. */
export function toMicroUsd(usd: number): number {
  return Math.ceil(usd * 1_000_000);
}

/**
 * Per-ticket token mix measured in #885 §3 (n=1,371), used by the design doc's
 * §4-A table. Kept here so the arithmetic is executable and testable rather
 * than a number in a markdown cell.
 */
export const MEASURED_TICKET_MIX: UsageSnapshot = {
  inputTokens: 74_300,
  cacheReadInputTokens: 11_900_000,
  cacheCreationInputTokens: 249_000,
  outputTokens: 79_000,
};
