/**
 * G-P2 against the mock upstream: a real multi-turn tool loop driven through the
 * proxy, streamed, with the tool arguments split across `input_json_delta`
 * chunks. Reassembling those arguments only works if the SSE relay was lossless
 * and in order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { driveToolLoop } from "../src/probe/toolLoop";
import { startMockAnthropic } from "../src/mock/anthropicMock";
import { startProxy } from "./support/startProxy";

test("★ a streamed tool loop completes through the proxy", async (t) => {
  const mock = await startMockAnthropic();
  const proxy = await startProxy({ upstreamBaseUrl: mock.baseUrl });
  t.after(async () => {
    await proxy.close();
    await mock.close();
  });

  const run = await driveToolLoop({
    baseUrl: proxy.baseUrl,
    apiKey: "marblo-credit-token",
    direct: false,
    model: "claude-sonnet-5",
    stream: true,
  });

  assert.equal(run.result.verdict, "green", run.result.reason);
  assert.equal(run.result.toolCalls, 1);
  assert.equal(run.result.finalStopReason, "end_turn");
  assert.equal(
    run.malformedToolInputs,
    0,
    "a split tool_use input that fails to reassemble means the relay dropped bytes",
  );
  assert.equal(run.turns.length, 2);
  assert.deepEqual(run.turns[0].toolNames, ["lookup_build_status"]);
});

test("the non-streaming tool loop completes too", async (t) => {
  const mock = await startMockAnthropic();
  const proxy = await startProxy({ upstreamBaseUrl: mock.baseUrl });
  t.after(async () => {
    await proxy.close();
    await mock.close();
  });

  const run = await driveToolLoop({
    baseUrl: proxy.baseUrl,
    apiKey: "marblo-credit-token",
    direct: false,
    model: "claude-sonnet-5",
    stream: false,
  });

  assert.equal(run.result.verdict, "green", run.result.reason);
  assert.equal(run.result.finalStopReason, "end_turn");
});

test("tool definitions are part of the cached prefix and survive the relay", async (t) => {
  const mock = await startMockAnthropic();
  const proxy = await startProxy({ upstreamBaseUrl: mock.baseUrl });
  t.after(async () => {
    await proxy.close();
    await mock.close();
  });

  await driveToolLoop({
    baseUrl: proxy.baseUrl,
    apiKey: "marblo-credit-token",
    direct: false,
    model: "claude-sonnet-5",
    stream: true,
  });

  const received = JSON.parse(mock.requests[0].rawBody.toString("utf8")) as {
    tools: Array<{ name: string; input_schema: unknown }>;
  };
  assert.equal(received.tools.length, 1);
  assert.equal(received.tools[0].name, "lookup_build_status");
  assert.ok(received.tools[0].input_schema, "the schema must arrive intact");
});
