import assert from "node:assert/strict";
import test from "node:test";

import { cacheHitRatio, emptyUsage } from "../src/types";
import {
  SseUsageExtractor,
  extractUsageFromJson,
  mergeUsage,
} from "../src/usage";

function sse(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

const CACHED_STREAM =
  sse("message_start", {
    message: {
      id: "msg_1",
      role: "assistant",
      usage: {
        input_tokens: 42,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 2700,
        output_tokens: 1,
      },
    },
  }) +
  sse("content_block_start", {
    index: 0,
    content_block: { type: "text", text: "" },
  }) +
  sse("content_block_delta", {
    index: 0,
    delta: { type: "text_delta", text: "OK" },
  }) +
  sse("content_block_stop", { index: 0 }) +
  sse("message_delta", {
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 5 },
  }) +
  sse("message_stop", {});

test("extracts cache-read usage from a streamed response", () => {
  const extractor = new SseUsageExtractor();
  extractor.push(Buffer.from(CACHED_STREAM, "utf8"));
  const obs = extractor.finish();

  assert.equal(obs.usage.inputTokens, 42);
  assert.equal(obs.usage.cacheReadInputTokens, 2700);
  assert.equal(obs.usage.outputTokens, 5);
  assert.equal(obs.stopReason, "end_turn");
  assert.ok(obs.sawMessageStart && obs.sawMessageStop);
  assert.deepEqual(obs.contentBlockTypes, ["text"]);
  assert.ok(Math.abs(cacheHitRatio(obs.usage) - 2700 / 2742) < 1e-9);
});

test("produces the same result no matter where chunk boundaries fall", () => {
  const bytes = Buffer.from(CACHED_STREAM, "utf8");
  const reference = (() => {
    const e = new SseUsageExtractor();
    e.push(bytes);
    return e.finish();
  })();

  // Every single-byte split, then a few pathological sizes.
  for (const size of [1, 2, 3, 7, 13, 64, 511]) {
    const extractor = new SseUsageExtractor();
    for (let i = 0; i < bytes.length; i += size) {
      extractor.push(bytes.subarray(i, i + size));
    }
    const obs = extractor.finish();
    assert.deepEqual(
      obs.usage,
      reference.usage,
      `usage differs at chunk size ${size}`,
    );
    assert.equal(obs.stopReason, "end_turn");
  }
});

test("survives a chunk boundary inside a multi-byte character", () => {
  const stream =
    sse("message_start", {
      message: {
        role: "assistant",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 1000,
          output_tokens: 1,
        },
      },
    }) +
    sse("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    }) +
    sse("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: "캐시 보존 확인" },
    }) +
    sse("message_delta", {
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 7 },
    }) +
    sse("message_stop", {});

  const bytes = Buffer.from(stream, "utf8");
  const extractor = new SseUsageExtractor();
  // 1-byte chunks guarantee splits mid-UTF-8-sequence.
  for (let i = 0; i < bytes.length; i += 1)
    extractor.push(bytes.subarray(i, i + 1));
  const obs = extractor.finish();

  assert.equal(obs.usage.cacheReadInputTokens, 1000);
  assert.equal(obs.usage.outputTokens, 7);
  assert.equal(obs.stopReason, "end_turn");
});

test("handles CRLF framing and a final line with no trailing newline", () => {
  const crlf =
    "event: message_start\r\n" +
    `data: ${JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 5, cache_read_input_tokens: 100 } },
    })}\r\n\r\n` +
    `data: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 2 },
    })}`; // no trailing newline on purpose

  const extractor = new SseUsageExtractor();
  extractor.push(Buffer.from(crlf, "utf8"));
  const obs = extractor.finish();

  assert.equal(obs.usage.cacheReadInputTokens, 100);
  assert.equal(obs.usage.outputTokens, 2);
  assert.equal(obs.stopReason, "end_turn");
});

test("ignores malformed and [DONE] data lines instead of throwing", () => {
  const extractor = new SseUsageExtractor();
  extractor.push("data: {not json\n\n");
  extractor.push("data: [DONE]\n\n");
  extractor.push(
    sse("message_start", { message: { usage: { input_tokens: 9 } } }),
  );
  const obs = extractor.finish();
  assert.equal(obs.usage.inputTokens, 9);
  assert.equal(obs.errorType, null);
});

test("records an upstream error event", () => {
  const extractor = new SseUsageExtractor();
  extractor.push(
    sse("error", { error: { type: "overloaded_error", message: "busy" } }),
  );
  assert.equal(extractor.finish().errorType, "overloaded_error");
});

test("output_tokens is last-wins, not summed", () => {
  const extractor = new SseUsageExtractor();
  extractor.push(
    sse("message_start", { message: { usage: { output_tokens: 1 } } }),
  );
  extractor.push(sse("message_delta", { usage: { output_tokens: 40 } }));
  extractor.push(sse("message_delta", { usage: { output_tokens: 91 } }));
  assert.equal(extractor.finish().usage.outputTokens, 91);
});

test("mergeUsage tolerates missing and non-numeric fields", () => {
  const usage = emptyUsage();
  mergeUsage(usage, { input_tokens: "42", cache_read_input_tokens: 7 });
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.cacheReadInputTokens, 7);
  mergeUsage(usage, null);
  assert.equal(usage.cacheReadInputTokens, 7);
});

test("parses a non-streaming response body", () => {
  const obs = extractUsageFromJson(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 30,
        cache_creation_input_tokens: 2700,
        cache_read_input_tokens: 0,
        output_tokens: 4,
      },
    }),
  );

  assert.equal(obs.usage.cacheCreationInputTokens, 2700);
  assert.equal(obs.stopReason, "end_turn");
  assert.deepEqual(obs.contentBlockTypes, ["text"]);
  assert.equal(cacheHitRatio(obs.usage), 0);
});

test("parses an error envelope", () => {
  const obs = extractUsageFromJson(
    JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }),
  );
  assert.equal(obs.errorType, "rate_limit_error");
});

test("cacheHitRatio returns 0 rather than NaN on an empty turn", () => {
  assert.equal(cacheHitRatio(emptyUsage()), 0);
});
