/**
 * The training-sample row shape and the pure turn → row mapping.
 *
 * Split out of `training-capture.ts` on purpose: that module owns the network
 * (Firebase callable) and the disk spool, which makes it unimportable from a
 * plain unit test. Everything decidable without IO — the row contract, the size
 * policy, what counts as truncated — lives here and is tested directly.
 *
 * ★This row carries RAW text (code, paths, possibly secrets the user typed).
 * It is written ONLY to the admin-scoped `marblo_training` BigQuery dataset via
 * `logTrainingSamples`. It must never be handed to `electron/telemetry.ts`,
 * `logTelemetry`, Sentry, or any renderer path — see the isolation guard test.
 */

import type { SessionFormat } from "./session-parsers";
import type { TranscriptTurn } from "./session-transcripts";

/** Stamped on every row. Bump when the row shape changes. */
export const TRAINING_SAMPLE_SCHEMA_VERSION = 1;

// ── Size policy ─────────────────────────────────────────────────────────
//
// A BigQuery streaming request caps at 10MB, and a row containing a 40MB file
// dump is worthless as training data anyway. Model-authored text (prompt,
// completion, reasoning) gets a generous cap; tool IO — dominated by
// whole-file reads — is stored as a preview. In every case the TRUE length is
// recorded alongside, so an analyst sees that something was cut instead of
// silently trusting a half sample.
export const MAX_TEXT_CHARS = 200_000;
export const MAX_THINKING_CHARS = 100_000;
export const MAX_TOOL_IO_CHARS = 4_000;
export const MAX_TOOL_CALLS = 32;

export interface TrainingCaptureMeta {
  agentId: string | null;
  /** Which surface produced the turns. */
  source: "agent" | "orchestrator";
  projectId: string | null;
  taskId: string | null;
  /** Marblo agent role (backend/frontend/…) when known. */
  role: string | null;
  /** Concrete model id observed by the cost tracker (`claude-opus-5`). */
  model: string | null;
  parentAgentId: string | null;
  sessionId: string | null;
  cwd: string | null;
  appVersion: string | null;
}

export interface TrainingSample {
  schemaVersion: number;
  /** `<sessionId>:<turnKey>` — stable across re-reads, so duplicate rows from
   *  a replayed file are detectable downstream (BigQuery streaming has no
   *  unique constraint; dedupe is a query-time concern). */
  sampleId: string;
  capturedAt: string;
  turnTimestamp: string | null;
  harness: SessionFormat;
  source: "agent" | "orchestrator";
  messageRole: "user" | "assistant";
  turnKey: string;
  parentKey: string | null;
  isSidechain: boolean;
  sessionId: string | null;
  agentId: string | null;
  parentAgentId: string | null;
  projectId: string | null;
  taskId: string | null;
  role: string | null;
  model: string | null;
  cwd: string | null;
  text: string;
  thinking: string;
  /** JSON array of `{name, input}` — null when the turn called no tools. */
  toolCalls: string | null;
  /** JSON array of tool-output previews — null when there were none. */
  toolResults: string | null;
  /** True (pre-cap) lengths. */
  textChars: number;
  thinkingChars: number;
  truncated: boolean;
  appVersion: string | null;
}

export function buildTrainingSample(
  turn: TranscriptTurn,
  harness: SessionFormat,
  meta: TrainingCaptureMeta,
  capturedAt: string,
): TrainingSample {
  const sessionId = turn.sessionId ?? meta.sessionId;
  const text = cap(turn.text, MAX_TEXT_CHARS);
  const thinking = cap(turn.thinking, MAX_THINKING_CHARS);
  const toolCalls = turn.toolCalls.slice(0, MAX_TOOL_CALLS).map((c) => ({
    name: c.name,
    input: cap(safeJson(c.input), MAX_TOOL_IO_CHARS).value,
  }));
  const toolResults = turn.toolResults
    .slice(0, MAX_TOOL_CALLS)
    .map((r) => cap(r, MAX_TOOL_IO_CHARS).value);

  return {
    schemaVersion: TRAINING_SAMPLE_SCHEMA_VERSION,
    sampleId: `${sessionId ?? meta.agentId ?? "unknown"}:${turn.turnKey}`,
    capturedAt,
    turnTimestamp: turn.timestamp,
    harness,
    source: meta.source,
    messageRole: turn.role,
    turnKey: turn.turnKey,
    parentKey: turn.parentKey,
    isSidechain: turn.isSidechain,
    sessionId,
    agentId: meta.agentId,
    parentAgentId: meta.parentAgentId,
    projectId: meta.projectId,
    taskId: meta.taskId,
    role: meta.role,
    // The file's own model attribution wins over the launch-time guess.
    model: turn.model ?? meta.model,
    cwd: meta.cwd,
    text: text.value,
    thinking: thinking.value,
    toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
    toolResults: toolResults.length > 0 ? JSON.stringify(toolResults) : null,
    textChars: turn.text.length,
    thinkingChars: turn.thinking.length,
    truncated:
      text.truncated ||
      thinking.truncated ||
      turn.toolCalls.length > MAX_TOOL_CALLS ||
      turn.toolResults.length > MAX_TOOL_CALLS,
    appVersion: meta.appVersion,
  };
}

function cap(
  value: string,
  limit: number,
): { value: string; truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit), truncated: true };
}

function safeJson(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    // Circular / unserializable tool input — record nothing rather than throw
    // inside a capture path that must never break the agent it observes.
    return "";
  }
}
