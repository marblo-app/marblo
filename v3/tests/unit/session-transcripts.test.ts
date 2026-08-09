/**
 * Transcript extraction — the RAW-text half of the session files the cost
 * tracker already reads (ticket IqcXHVbT0rXnHloXpV7n).
 *
 * Every fixture below mirrors a shape recorded off a live session file on a
 * dev machine, not a shape inferred from docs: claude's string-vs-blocks user
 * content, codex's `event_msg` envelopes, grok's ACP chunk stream.
 */
import { describe, expect, it } from "vitest";
import {
  extractTranscriptTurns,
  newTranscriptState,
  transcriptCaptureSupported,
} from "../../electron/session-transcripts";

const jsonl = (...entries: unknown[]): string[] =>
  entries.map((e) => JSON.stringify(e));

describe("claude transcripts", () => {
  it("reads a typed prompt (content is a bare string)", () => {
    const lines = jsonl({
      type: "user",
      uuid: "u1",
      parentUuid: null,
      sessionId: "sess-1",
      timestamp: "2026-08-09T00:00:00.000Z",
      message: { role: "user", content: "add a retry to the uploader" },
    });
    const { turns } = extractTranscriptTurns(
      "claude",
      lines,
      newTranscriptState(),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      role: "user",
      text: "add a retry to the uploader",
      turnKey: "u1",
      sessionId: "sess-1",
    });
  });

  it("splits assistant text, thinking and tool calls", () => {
    const lines = jsonl({
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      sessionId: "sess-1",
      message: {
        role: "assistant",
        model: "claude-opus-5",
        content: [
          { type: "thinking", thinking: "the uploader has no backoff" },
          { type: "text", text: "I'll add exponential backoff." },
          { type: "tool_use", name: "Edit", input: { file: "up.ts" } },
        ],
      },
    });
    const { turns } = extractTranscriptTurns(
      "claude",
      lines,
      newTranscriptState(),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("I'll add exponential backoff.");
    expect(turns[0].thinking).toBe("the uploader has no backoff");
    expect(turns[0].model).toBe("claude-opus-5");
    expect(turns[0].toolCalls).toEqual([
      { name: "Edit", input: { file: "up.ts" } },
    ]);
  });

  it("captures tool results delivered on a user line", () => {
    const lines = jsonl({
      type: "user",
      uuid: "u2",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: [{ type: "text", text: "ok, 3 files" }],
          },
        ],
      },
    });
    const { turns } = extractTranscriptTurns(
      "claude",
      lines,
      newTranscriptState(),
    );
    expect(turns[0].toolResults).toEqual(["ok, 3 files"]);
  });

  it("ignores non-conversation lines and malformed JSON", () => {
    const lines = [
      ...jsonl(
        { type: "mode", mode: "default", sessionId: "s" },
        { type: "file-history-snapshot", messageId: "m" },
        {
          type: "assistant",
          uuid: "empty",
          message: { role: "assistant", content: [] },
        },
      ),
      "{ this is not json",
    ];
    const { turns } = extractTranscriptTurns(
      "claude",
      lines,
      newTranscriptState(),
    );
    expect(turns).toEqual([]);
  });

  it("labels sub-agent (sidechain) turns rather than dropping them", () => {
    const lines = jsonl({
      type: "assistant",
      uuid: "a9",
      isSidechain: true,
      message: { role: "assistant", content: [{ type: "text", text: "sub" }] },
    });
    const { turns } = extractTranscriptTurns(
      "claude",
      lines,
      newTranscriptState(),
    );
    expect(turns[0].isSidechain).toBe(true);
  });
});

describe("codex transcripts", () => {
  it("reads user_message / agent_message / agent_reasoning", () => {
    const lines = jsonl(
      { type: "session_meta", payload: { session_id: "x" } },
      {
        type: "event_msg",
        timestamp: "2026-08-09T00:00:01.000Z",
        payload: { type: "user_message", message: "Reply with exactly: PONG" },
      },
      {
        type: "event_msg",
        timestamp: "2026-08-09T00:00:02.000Z",
        payload: { type: "agent_reasoning", text: "trivial request" },
      },
      {
        type: "event_msg",
        timestamp: "2026-08-09T00:00:03.000Z",
        payload: { type: "agent_message", message: "PONG" },
      },
    );
    const { turns } = extractTranscriptTurns(
      "codex",
      lines,
      newTranscriptState(),
    );
    expect(turns.map((t) => [t.role, t.text, t.thinking])).toEqual([
      ["user", "Reply with exactly: PONG", ""],
      ["assistant", "", "trivial request"],
      ["assistant", "PONG", ""],
    ]);
  });

  it("does NOT double-count the parallel response_item records", () => {
    // codex writes the same content twice: once as event_msg, once as
    // response_item. Reading both would duplicate every sample.
    const lines = jsonl(
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "done" },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "done" }],
        },
      },
    );
    const { turns } = extractTranscriptTurns(
      "codex",
      lines,
      newTranscriptState(),
    );
    expect(turns).toHaveLength(1);
  });
});

describe("grok transcripts (streaming chunks)", () => {
  const chunk = (kind: string, text: string) => ({
    params: {
      sessionId: "grok-sess",
      update: { sessionUpdate: kind, content: { type: "text", text } },
    },
  });
  const completed = {
    params: {
      sessionId: "grok-sess",
      update: { sessionUpdate: "turn_completed", usage: { inputTokens: 10 } },
    },
  };

  it("joins chunks and emits only at turn_completed", () => {
    const lines = jsonl(
      chunk("user_message_chunk", "why is "),
      chunk("user_message_chunk", "CI red?"),
      chunk("agent_thought_chunk", "check the lockfile"),
      chunk("agent_message_chunk", "The lock"),
      chunk("agent_message_chunk", "file drifted."),
      completed,
    );
    const { turns } = extractTranscriptTurns(
      "grok",
      lines,
      newTranscriptState(),
    );
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", text: "why is CI red?" });
    expect(turns[1]).toMatchObject({
      role: "assistant",
      text: "The lockfile drifted.",
      thinking: "check the lockfile",
      sessionId: "grok-sess",
    });
  });

  it("carries a half-streamed turn across a poll boundary", () => {
    // This is the whole reason the extractor is stateful: a 15s poll lands
    // mid-turn constantly, and emitting halves would poison the training data.
    const first = extractTranscriptTurns(
      "grok",
      jsonl(chunk("agent_message_chunk", "part one ")),
      newTranscriptState(),
    );
    expect(first.turns).toEqual([]);

    const second = extractTranscriptTurns(
      "grok",
      jsonl(chunk("agent_message_chunk", "part two"), completed),
      first.state,
    );
    expect(second.turns).toHaveLength(1);
    expect(second.turns[0].text).toBe("part one part two");
  });

  it("resets pending text after a completed turn", () => {
    const first = extractTranscriptTurns(
      "grok",
      jsonl(chunk("agent_message_chunk", "one"), completed),
      newTranscriptState(),
    );
    const second = extractTranscriptTurns(
      "grok",
      jsonl(chunk("agent_message_chunk", "two"), completed),
      first.state,
    );
    expect(second.turns[0].text).toBe("two");
    // Turn keys advance, so the two turns are distinguishable downstream.
    expect(second.turns[0].turnKey).not.toBe(first.turns[0].turnKey);
  });
});

describe("gemini", () => {
  it("captures nothing — the text shape is unverified, so we do not guess", () => {
    expect(transcriptCaptureSupported("gemini")).toBe(false);
    const { turns } = extractTranscriptTurns(
      "gemini",
      jsonl({ type: "gemini", model: "gemini-2.5-pro", tokens: { input: 1 } }),
      newTranscriptState(),
    );
    expect(turns).toEqual([]);
  });
});
