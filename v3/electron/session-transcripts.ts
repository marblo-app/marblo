/**
 * Transcript extraction from CLI session files — the RAW prompt/completion
 * text, as opposed to `session-parsers.ts` which reads only token counts from
 * the very same lines.
 *
 * Why this file exists (ticket IqcXHVbT0rXnHloXpV7n): the BigQuery `events`
 * table stores `promptHash`/`promptLength` and nothing else, by design — that
 * sink is 비식별(de-identified) and always-on. Generative fine-tuning needs the
 * actual text, which that sink must never carry. So the text is extracted here
 * and routed through a SEPARATE, consent-gated, admin-scoped path
 * (`training-capture.ts` → `logTrainingSamples` → `marblo_training`). Nothing in
 * this module may be imported by the telemetry path; `tests/unit/
 * training-capture-isolation.test.ts` enforces that as a drift guard.
 *
 * These functions are pure (no fs, no network, no clock) so they can be
 * unit-tested against real recorded line shapes.
 *
 * Formats — every shape below was read off live session files on a dev machine,
 * not inferred from documentation:
 *
 *   - claude : one JSON object per line. `type:"user"` carries the human turn
 *              (`message.content` is a plain STRING for a typed prompt, or an
 *              array of `tool_result` blocks when it is a tool round-trip).
 *              `type:"assistant"` carries `message.content` blocks of
 *              `text` / `thinking` / `tool_use`.
 *   - codex  : `event_msg` envelopes. `payload.type:"user_message"` →
 *              `payload.message`, `payload.type:"agent_message"` →
 *              `payload.message`, `payload.type:"agent_reasoning"` →
 *              `payload.text`. The parallel `response_item` records repeat the
 *              same content in API shape, so we read ONE of the two (event_msg)
 *              and never both — reading both would double every sample.
 *   - grok   : ACP `session/update` STREAM. Text arrives as
 *              `user_message_chunk` / `agent_message_chunk` /
 *              `agent_thought_chunk` fragments that must be concatenated, and a
 *              turn is only complete at `turn_completed`. Hence the carry-over
 *              state below: a turn that straddles two polls must not be emitted
 *              twice in halves.
 *   - gemini : NOT implemented. No gemini session exists on any dev machine, so
 *              the text shape is unverified — inventing a parser for it would
 *              be a guess, and a wrong guess here silently poisons training
 *              data. Cost tracking for gemini is unaffected (that path is in
 *              session-parsers.ts and stays as-is).
 */

import type { SessionFormat } from "./session-parsers";

export type TranscriptRole = "user" | "assistant";

export interface TranscriptToolCall {
  name: string;
  /** Raw tool input, as recorded. Serialized (and capped) by the caller. */
  input: unknown;
}

export interface TranscriptTurn {
  /**
   * Stable identity of this turn WITHIN its session. Combined with the
   * sessionId it forms the sample id, so a re-read of the same file produces
   * the same key and duplicates stay detectable downstream.
   */
  turnKey: string;
  role: TranscriptRole;
  /** Plain user/assistant text (all text blocks joined). "" when none. */
  text: string;
  /** Reasoning/thinking text, kept separate so SFT can include or drop it. */
  thinking: string;
  toolCalls: TranscriptToolCall[];
  /** Tool outputs delivered back on this turn (claude tool_result lines). */
  toolResults: string[];
  model: string | null;
  /** ISO timestamp from the file, or null when the format records none. */
  timestamp: string | null;
  sessionId: string | null;
  /** Parent turn key, when the format records a conversation DAG (claude). */
  parentKey: string | null;
  /** claude sub-agent (Task tool) turns. Kept, but labelled. */
  isSidechain: boolean;
}

/**
 * Carry-over state for streaming formats. `grok` emits a turn as a run of
 * chunk records terminated by `turn_completed`; when a poll boundary lands in
 * the middle of that run the partial text must survive to the next call rather
 * than being emitted as its own truncated sample.
 */
export interface TranscriptState {
  pendingUserText: string;
  pendingAgentText: string;
  pendingThinking: string;
  pendingToolCalls: TranscriptToolCall[];
  /** Monotonic per-session counter — makes streaming turn keys unique. */
  turnSeq: number;
}

export function newTranscriptState(): TranscriptState {
  return {
    pendingUserText: "",
    pendingAgentText: "",
    pendingThinking: "",
    pendingToolCalls: [],
    turnSeq: 0,
  };
}

export interface TranscriptExtraction {
  turns: TranscriptTurn[];
  state: TranscriptState;
}

/**
 * Extract complete turns from NEW session-file lines.
 *
 * `lines` must be only the lines not yet seen (the cost tracker already
 * computes exactly that slice from its line watermark, so capture costs no
 * extra file IO). `state` carries streaming leftovers between calls.
 */
export function extractTranscriptTurns(
  format: SessionFormat,
  lines: string[],
  state: TranscriptState,
): TranscriptExtraction {
  switch (format) {
    case "claude":
      return { turns: extractClaudeTurns(lines), state };
    case "codex":
      return { turns: extractCodexTurns(lines), state };
    case "grok":
      return extractGrokTurns(lines, state);
    case "gemini":
      // Unverified shape — see the header. Emitting nothing is the honest
      // outcome; a guessed parser would write wrong text into training data.
      return { turns: [], state };
  }
}

/** True for formats we can actually read text out of. */
export function transcriptCaptureSupported(format: SessionFormat): boolean {
  return format === "claude" || format === "codex" || format === "grok";
}

function parseLines(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Half-written trailing line — the next poll sees it complete.
    }
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

// ── claude ──────────────────────────────────────────────────────────────

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

function claudeBlockText(content: unknown): {
  text: string;
  thinking: string;
  toolCalls: TranscriptToolCall[];
  toolResults: string[];
} {
  const out = {
    text: "",
    thinking: "",
    toolCalls: [] as TranscriptToolCall[],
    toolResults: [] as string[],
  };
  // A typed human prompt is a bare string; tool round-trips are block arrays.
  if (typeof content === "string") {
    out.text = content;
    return out;
  }
  if (!Array.isArray(content)) return out;

  const texts: string[] = [];
  const thoughts: string[] = [];
  for (const raw of content) {
    const block = asRecord(raw) as ClaudeContentBlock | null;
    if (!block) continue;
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") texts.push(block.text);
        break;
      case "thinking":
        if (typeof block.thinking === "string") thoughts.push(block.thinking);
        break;
      case "tool_use":
        out.toolCalls.push({
          name: typeof block.name === "string" ? block.name : "unknown",
          input: block.input ?? null,
        });
        break;
      case "tool_result":
        out.toolResults.push(flattenToolResult(block.content));
        break;
      default:
        break;
    }
  }
  out.text = texts.join("\n");
  out.thinking = thoughts.join("\n");
  return out;
}

/** tool_result content is a string, or blocks of {type:"text",text}. */
function flattenToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (block && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function extractClaudeTurns(lines: string[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const entry of parseLines(lines)) {
    const e = asRecord(entry);
    if (!e) continue;
    const type = e.type;
    if (type !== "user" && type !== "assistant") continue;
    const message = asRecord(e.message);
    if (!message) continue;

    const parts = claudeBlockText(message.content);
    // A line with no text at all AND no tool activity carries no signal.
    if (
      !parts.text &&
      !parts.thinking &&
      parts.toolCalls.length === 0 &&
      parts.toolResults.length === 0
    ) {
      continue;
    }

    turns.push({
      turnKey: str(e.uuid) ?? `${type}:${turns.length}`,
      role: type,
      text: parts.text,
      thinking: parts.thinking,
      toolCalls: parts.toolCalls,
      toolResults: parts.toolResults,
      model: str(message.model),
      timestamp: str(e.timestamp),
      sessionId: str(e.sessionId),
      parentKey: str(e.parentUuid),
      isSidechain: e.isSidechain === true,
    });
  }
  return turns;
}

// ── codex ───────────────────────────────────────────────────────────────

function extractCodexTurns(lines: string[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let seq = 0;
  for (const entry of parseLines(lines)) {
    const e = asRecord(entry);
    if (!e || e.type !== "event_msg") continue;
    const payload = asRecord(e.payload);
    if (!payload) continue;
    const timestamp = str(e.timestamp);

    switch (payload.type) {
      case "user_message": {
        const text = str(payload.message);
        if (!text) break;
        turns.push(
          codexTurn("user", `user:${seq++}`, timestamp, { text, thinking: "" }),
        );
        break;
      }
      case "agent_message": {
        const text = str(payload.message);
        if (!text) break;
        turns.push(
          codexTurn("assistant", `agent:${seq++}`, timestamp, {
            text,
            thinking: "",
          }),
        );
        break;
      }
      case "agent_reasoning": {
        const thinking = str(payload.text);
        if (!thinking) break;
        turns.push(
          codexTurn("assistant", `reasoning:${seq++}`, timestamp, {
            text: "",
            thinking,
          }),
        );
        break;
      }
      default:
        break;
    }
  }
  return turns;
}

function codexTurn(
  role: TranscriptRole,
  turnKey: string,
  timestamp: string | null,
  parts: { text: string; thinking: string },
): TranscriptTurn {
  return {
    turnKey,
    role,
    text: parts.text,
    thinking: parts.thinking,
    toolCalls: [],
    toolResults: [],
    model: null,
    timestamp,
    sessionId: null,
    parentKey: null,
    isSidechain: false,
  };
}

// ── grok (streaming chunks) ─────────────────────────────────────────────

function extractGrokTurns(
  lines: string[],
  state: TranscriptState,
): TranscriptExtraction {
  const turns: TranscriptTurn[] = [];
  const next: TranscriptState = {
    ...state,
    pendingToolCalls: [...state.pendingToolCalls],
  };

  for (const entry of parseLines(lines)) {
    const e = asRecord(entry);
    const params = asRecord(e?.params);
    const update = asRecord(params?.update);
    if (!update) continue;
    const timestamp = str(e?.timestamp);

    switch (update.sessionUpdate) {
      case "user_message_chunk":
        next.pendingUserText += chunkText(update.content);
        break;
      case "agent_message_chunk":
        next.pendingAgentText += chunkText(update.content);
        break;
      case "agent_thought_chunk":
        next.pendingThinking += chunkText(update.content);
        break;
      case "tool_call": {
        const name = str(update.title);
        if (name) {
          next.pendingToolCalls.push({ name, input: update.rawInput ?? null });
        }
        break;
      }
      case "turn_completed": {
        const seq = next.turnSeq++;
        const sessionId = str(params?.sessionId);
        if (next.pendingUserText) {
          turns.push({
            turnKey: `user:${seq}`,
            role: "user",
            text: next.pendingUserText,
            thinking: "",
            toolCalls: [],
            toolResults: [],
            model: null,
            timestamp,
            sessionId,
            parentKey: null,
            isSidechain: false,
          });
        }
        if (
          next.pendingAgentText ||
          next.pendingThinking ||
          next.pendingToolCalls.length > 0
        ) {
          turns.push({
            turnKey: `agent:${seq}`,
            role: "assistant",
            text: next.pendingAgentText,
            thinking: next.pendingThinking,
            toolCalls: next.pendingToolCalls,
            toolResults: [],
            model: null,
            timestamp,
            sessionId,
            parentKey: null,
            isSidechain: false,
          });
        }
        next.pendingUserText = "";
        next.pendingAgentText = "";
        next.pendingThinking = "";
        next.pendingToolCalls = [];
        break;
      }
      default:
        break;
    }
  }

  return { turns, state: next };
}

/** ACP chunk content is `{type:"text", text:"…"}`. */
function chunkText(content: unknown): string {
  const block = asRecord(content);
  if (block && typeof block.text === "string") return block.text;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const b = asRecord(c);
        return b && typeof b.text === "string" ? b.text : "";
      })
      .join("");
  }
  return "";
}
