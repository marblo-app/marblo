/**
 * The two gates from design doc §11. Both must be green for L2 to exist; if
 * G-P1 is red, changing vendors does not save it (the failure is in our proxy,
 * not the vendor).
 *
 *  G-P1  cache preservation — proxied cacheRead/totalInput within ±10 points of
 *        a direct call on the same prefix.
 *  G-P2  tool-loop completion — a real multi-turn tool session finishes through
 *        the proxy (tool_use round-trips, streaming, terminal stop_reason).
 */

import { cacheHitRatio } from "./types";
import type { ResponseObservation, UsageSnapshot } from "./types";

/** §11 G-P1 threshold, in percentage points. */
export const G_P1_TOLERANCE_PP = 10;

export type GateVerdict = "green" | "red" | "not_measured";

export interface CachePreservationResult {
  directRatio: number;
  proxiedRatio: number;
  /** (proxied − direct) × 100. Negative means the proxy lost cache. */
  deltaPp: number;
  /** Doc-literal reading of §11: |delta| ≤ tolerance. */
  withinTolerance: boolean;
  /**
   * ★ The reading we actually gate on: only a *drop* is a failure.
   * A proxied ratio above direct is not a defect — it happens when a shared
   * upstream account already holds the prefix another user warmed (§5-F). The
   * doc's "±10%p" is symmetric; we keep both numbers and explain the asymmetry
   * in the PoC report rather than silently picking one.
   */
  preserved: boolean;
  verdict: GateVerdict;
}

/**
 * @param directRatio  cacheRead/totalInput measured calling the vendor directly
 * @param proxiedRatio the same measurement through our proxy
 */
export function evaluateCachePreservation(
  directRatio: number | null,
  proxiedRatio: number | null,
  tolerancePp: number = G_P1_TOLERANCE_PP,
): CachePreservationResult {
  if (directRatio === null || proxiedRatio === null) {
    return {
      directRatio: directRatio ?? 0,
      proxiedRatio: proxiedRatio ?? 0,
      deltaPp: 0,
      withinTolerance: false,
      preserved: false,
      verdict: "not_measured",
    };
  }

  const deltaPp = (proxiedRatio - directRatio) * 100;
  const withinTolerance = Math.abs(deltaPp) <= tolerancePp;
  const preserved = deltaPp >= -tolerancePp;

  return {
    directRatio,
    proxiedRatio,
    deltaPp,
    withinTolerance,
    preserved,
    verdict: preserved ? "green" : "red",
  };
}

/** Convenience: run the gate straight off two usage snapshots. */
export function evaluateCachePreservationFromUsage(
  direct: UsageSnapshot,
  proxied: UsageSnapshot,
  tolerancePp: number = G_P1_TOLERANCE_PP,
): CachePreservationResult {
  return evaluateCachePreservation(
    cacheHitRatio(direct),
    cacheHitRatio(proxied),
    tolerancePp,
  );
}

/** Terminal stop reasons — the model finished rather than being cut off. */
const TERMINAL_STOP_REASONS = new Set([
  "end_turn",
  "stop_sequence",
  "max_tokens",
]);

export interface ToolLoopResult {
  turns: number;
  toolCalls: number;
  finalStopReason: string | null;
  streamed: boolean;
  verdict: GateVerdict;
  /** Why the verdict is what it is — surfaced verbatim in the report. */
  reason: string;
}

export interface ToolLoopInput {
  /** One entry per assistant response in the loop, in order. */
  observations: ResponseObservation[];
  /** True when the loop was driven with `stream: true`. */
  streamed: boolean;
}

/**
 * ★ G-P2. A tool loop "completes" only if all three hold:
 *   1. the model actually asked for a tool at least once (otherwise we proved
 *      nothing about tool_use round-tripping),
 *   2. the last response ends on a terminal stop_reason, and
 *   3. no response carried an error event.
 * `max_tokens` counts as terminal: the loop mechanics worked, the budget ran out.
 */
export function evaluateToolLoop(input: ToolLoopInput): ToolLoopResult {
  const { observations, streamed } = input;
  const toolCalls = observations.filter((o) =>
    o.contentBlockTypes.includes("tool_use"),
  ).length;
  const last = observations[observations.length - 1] ?? null;
  const finalStopReason = last?.stopReason ?? null;

  const base = {
    turns: observations.length,
    toolCalls,
    finalStopReason,
    streamed,
  };

  if (observations.length === 0) {
    return { ...base, verdict: "not_measured", reason: "no turns recorded" };
  }

  const errored = observations.find((o) => o.errorType !== null);
  if (errored) {
    return {
      ...base,
      verdict: "red",
      reason: `upstream error event: ${errored.errorType}`,
    };
  }

  if (toolCalls === 0) {
    return {
      ...base,
      verdict: "not_measured",
      reason: "model never emitted tool_use — the loop was not exercised",
    };
  }

  if (finalStopReason === null || !TERMINAL_STOP_REASONS.has(finalStopReason)) {
    return {
      ...base,
      verdict: "red",
      reason: `loop did not terminate cleanly (stop_reason=${
        finalStopReason ?? "none"
      })`,
    };
  }

  if (
    streamed &&
    !observations.every((o) => o.sawMessageStart && o.sawMessageStop)
  ) {
    return {
      ...base,
      verdict: "red",
      reason:
        "a streamed turn was missing message_start/message_stop — the SSE relay truncated it",
    };
  }

  return {
    ...base,
    verdict: "green",
    reason: `${toolCalls} tool round-trip(s), terminated on ${finalStopReason}`,
  };
}
