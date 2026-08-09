/**
 * Usage extraction — how the proxy learns what to charge without touching the
 * bytes it relays.
 *
 * ★ Design invariant P2 (§5-B): the debit is computed from the *upstream
 * response's own `usage`*, never from `cost_logs` (15s poll deltas, no
 * idempotency key — memo `cost_axis_userid_spaces_and_reread_dupes`).
 *
 * With `stream: true` the usage arrives in two places:
 *   - `message_start` : input_tokens, cache_creation_input_tokens,
 *                       cache_read_input_tokens  ← ★ the cache evidence
 *   - `message_delta` : cumulative output_tokens, plus stop_reason
 * so the relay tees the byte stream: the client gets every chunk unchanged and
 * this extractor reads a copy.
 */

import { SseEventReader } from "./sse";
import {
  emptyObservation,
  type ResponseObservation,
  type UsageSnapshot,
} from "./types";

/** Narrow, tolerant reads of unknown JSON. */
function readNumber(source: unknown, key: string): number | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readObject(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return null;
  return (source as Record<string, unknown>)[key] ?? null;
}

/**
 * Merge a raw `usage` object into a snapshot.
 *
 * Every field is last-wins, not summed. `input_tokens` and the two cache
 * counters are reported once in `message_start`; `output_tokens` is reported by
 * `message_delta` as a running total. Summing either would double-count.
 */
export function mergeUsage(target: UsageSnapshot, raw: unknown): void {
  const input = readNumber(raw, "input_tokens");
  if (input !== null) target.inputTokens = input;

  const output = readNumber(raw, "output_tokens");
  if (output !== null) target.outputTokens = output;

  const cacheWrite = readNumber(raw, "cache_creation_input_tokens");
  if (cacheWrite !== null) target.cacheCreationInputTokens = cacheWrite;

  const cacheRead = readNumber(raw, "cache_read_input_tokens");
  if (cacheRead !== null) target.cacheReadInputTokens = cacheRead;
}

/** Apply one decoded event to an observation. */
export function applyEvent(obs: ResponseObservation, event: unknown): void {
  switch (readString(event, "type")) {
    case "message_start": {
      obs.sawMessageStart = true;
      const message = readObject(event, "message");
      mergeUsage(obs.usage, readObject(message, "usage"));
      const stop = readString(message, "stop_reason");
      if (stop !== null) obs.stopReason = stop;
      break;
    }
    case "content_block_start": {
      const blockType = readString(readObject(event, "content_block"), "type");
      if (blockType !== null) obs.contentBlockTypes.push(blockType);
      break;
    }
    case "message_delta": {
      mergeUsage(obs.usage, readObject(event, "usage"));
      const stop = readString(readObject(event, "delta"), "stop_reason");
      if (stop !== null) obs.stopReason = stop;
      break;
    }
    case "message_stop":
      obs.sawMessageStop = true;
      break;
    case "error":
      obs.errorType =
        readString(readObject(event, "error"), "type") ?? "unknown_error";
      break;
    default:
      break;
  }
}

/** Incremental SSE usage reader. Feed every relayed chunk; call {@link finish} at end of stream. */
export class SseUsageExtractor {
  private readonly reader = new SseEventReader();
  private readonly observation = emptyObservation();

  push(chunk: Buffer | string): void {
    for (const event of this.reader.push(chunk)) {
      applyEvent(this.observation, event);
    }
  }

  finish(): ResponseObservation {
    for (const event of this.reader.finish()) {
      applyEvent(this.observation, event);
    }
    return this.observation;
  }

  /** Current state without ending the stream. */
  peek(): ResponseObservation {
    return this.observation;
  }
}

/** Parse a complete non-streaming `/v1/messages` response body. */
export function extractUsageFromJson(body: string): ResponseObservation {
  const obs = emptyObservation();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return obs;
  }

  mergeUsage(obs.usage, readObject(parsed, "usage"));

  const stop = readString(parsed, "stop_reason");
  if (stop !== null) obs.stopReason = stop;

  const content = readObject(parsed, "content");
  if (Array.isArray(content)) {
    for (const block of content) {
      const blockType = readString(block, "type");
      if (blockType !== null) obs.contentBlockTypes.push(blockType);
    }
  }

  // Error envelopes arrive with HTTP 4xx/5xx and `{"type":"error", ...}`.
  if (readString(parsed, "type") === "error") {
    obs.errorType =
      readString(readObject(parsed, "error"), "type") ?? "unknown_error";
  }

  return obs;
}
