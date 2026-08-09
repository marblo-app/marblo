import assert from "node:assert/strict";
import test from "node:test";

import { SseMessageAssembler, assembleFromJson } from "../src/messageAssembler";

function sse(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

const TOOL_STREAM =
  sse("message_start", {
    message: {
      id: "msg_1",
      role: "assistant",
      model: "m",
      usage: { input_tokens: 5 },
    },
  }) +
  sse("content_block_start", {
    index: 0,
    content_block: { type: "text", text: "" },
  }) +
  sse("content_block_delta", {
    index: 0,
    delta: { type: "text_delta", text: "Checking" },
  }) +
  sse("content_block_stop", { index: 0 }) +
  sse("content_block_start", {
    index: 1,
    content_block: {
      type: "tool_use",
      id: "toolu_1",
      name: "lookup",
      input: {},
    },
  }) +
  sse("content_block_delta", {
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"serv' },
  }) +
  sse("content_block_delta", {
    index: 1,
    delta: { type: "input_json_delta", partial_json: 'ice":"credit-proxy"}' },
  }) +
  sse("content_block_stop", { index: 1 }) +
  sse("message_delta", {
    delta: { stop_reason: "tool_use" },
    usage: { output_tokens: 20 },
  }) +
  sse("message_stop", {});

test("reassembles a tool_use input split across deltas", () => {
  const assembler = new SseMessageAssembler();
  assembler.push(Buffer.from(TOOL_STREAM, "utf8"));
  const message = assembler.finish();

  assert.equal(message.id, "msg_1");
  assert.equal(message.stopReason, "tool_use");
  assert.equal(message.malformedToolInputs, 0);
  assert.equal(message.content.length, 2);
  assert.deepEqual(message.content[0], { type: "text", text: "Checking" });
  assert.deepEqual(message.content[1], {
    type: "tool_use",
    id: "toolu_1",
    name: "lookup",
    input: { service: "credit-proxy" },
  });
});

test("reassembly is independent of chunk boundaries", () => {
  const bytes = Buffer.from(TOOL_STREAM, "utf8");
  for (const size of [1, 5, 37, 256]) {
    const assembler = new SseMessageAssembler();
    for (let i = 0; i < bytes.length; i += size) {
      assembler.push(bytes.subarray(i, i + size));
    }
    const message = assembler.finish();
    assert.equal(message.malformedToolInputs, 0, `chunk size ${size}`);
    assert.deepEqual(
      message.content[1].input,
      { service: "credit-proxy" },
      `chunk size ${size}`,
    );
  }
});

test("blocks keep their stream order even if events interleave by index", () => {
  const interleaved =
    sse("message_start", { message: { role: "assistant" } }) +
    sse("content_block_start", {
      index: 1,
      content_block: { type: "text", text: "" },
    }) +
    sse("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    }) +
    sse("content_block_delta", {
      index: 1,
      delta: { type: "text_delta", text: "second" },
    }) +
    sse("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: "first" },
    }) +
    sse("message_delta", { delta: { stop_reason: "end_turn" } }) +
    sse("message_stop", {});

  const assembler = new SseMessageAssembler();
  assembler.push(interleaved);
  const message = assembler.finish();

  assert.equal(message.content[0].text, "first");
  assert.equal(message.content[1].text, "second");
});

test("a truncated tool input is counted, not silently accepted", () => {
  const truncated =
    sse("message_start", { message: { role: "assistant" } }) +
    sse("content_block_start", {
      index: 0,
      content_block: { type: "tool_use", id: "t1", name: "lookup", input: {} },
    }) +
    sse("content_block_delta", {
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"service":"cre' },
    }) +
    sse("message_delta", { delta: { stop_reason: "tool_use" } });

  const assembler = new SseMessageAssembler();
  assembler.push(truncated);
  const message = assembler.finish();

  assert.equal(message.malformedToolInputs, 1);
  assert.deepEqual(message.content[0].input, {});
});

test("a tool call with no arguments yields an empty input object", () => {
  const noArgs =
    sse("message_start", { message: { role: "assistant" } }) +
    sse("content_block_start", {
      index: 0,
      content_block: { type: "tool_use", id: "t1", name: "ping", input: {} },
    }) +
    sse("content_block_stop", { index: 0 }) +
    sse("message_delta", { delta: { stop_reason: "tool_use" } }) +
    sse("message_stop", {});

  const assembler = new SseMessageAssembler();
  assembler.push(noArgs);
  const message = assembler.finish();
  assert.equal(message.malformedToolInputs, 0);
  assert.deepEqual(message.content[0].input, {});
});

test("assembles the same shape from a non-streaming body", () => {
  const message = assembleFromJson(
    JSON.stringify({
      id: "msg_2",
      role: "assistant",
      model: "m",
      content: [
        { type: "tool_use", id: "t1", name: "lookup", input: { service: "x" } },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 3,
        cache_read_input_tokens: 900,
        output_tokens: 7,
      },
    }),
  );

  assert.equal(message.stopReason, "tool_use");
  assert.equal(message.observation.usage.cacheReadInputTokens, 900);
  assert.deepEqual(message.observation.contentBlockTypes, ["tool_use"]);
  assert.deepEqual(message.content[0].input, { service: "x" });
});

test("an unparseable body yields an empty message rather than throwing", () => {
  const message = assembleFromJson("<html>502</html>");
  assert.deepEqual(message.content, []);
  assert.equal(message.stopReason, null);
});
