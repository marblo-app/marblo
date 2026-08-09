/**
 * End-to-end: the real proxy server in front of a mock upstream that implements
 * a real prefix cache.
 *
 * ★ This is the strongest evidence available without a pay-go key. It does not
 * assert that the proxy "should" preserve the cache — it sends the same bytes
 * twice through the proxy and checks that the upstream billed the second one as
 * a cache read. Any body mutation on our side changes the prefix hash and turns
 * these green tests red.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { evaluateCachePreservation } from "../src/gate";
import { cacheHitRatio } from "../src/types";
import { callMessages } from "../src/probe/client";
import { buildCacheProbeBody } from "../src/probe/payload";
import {
  startMockAnthropic,
  type MockUpstream,
} from "../src/mock/anthropicMock";
import { startProxy, type RunningProxy } from "./support/startProxy";

interface Harness {
  mock: MockUpstream;
  proxy: RunningProxy;
  close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const mock = await startMockAnthropic();
  const proxy = await startProxy({ upstreamBaseUrl: mock.baseUrl });
  return {
    mock,
    proxy,
    close: async () => {
      await proxy.close();
      await mock.close();
    },
  };
}

test("relays the request body byte-for-byte", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "byte-exactness",
    stream: false,
  });
  const sentSha = createHash("sha256").update(bytes).digest("hex");

  const result = await callMessages({
    baseUrl: h.proxy.baseUrl,
    apiKey: "marblo-credit-token",
    direct: false,
    bodyBytes: bytes,
    stream: false,
  });

  assert.equal(result.status, 200);
  assert.equal(h.mock.requests.length, 1);
  assert.equal(
    h.mock.requests[0].bodySha256,
    sentSha,
    "upstream must receive the exact bytes the client sent",
  );
  assert.equal(h.mock.requests[0].bodyBytes, bytes.length);
});

test("the cache_control breakpoint survives the relay", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "cache-control-survival",
    stream: false,
  });

  await callMessages({
    baseUrl: h.proxy.baseUrl,
    apiKey: "marblo-credit-token",
    direct: false,
    bodyBytes: bytes,
    stream: false,
  });

  const received = JSON.parse(h.mock.requests[0].rawBody.toString("utf8")) as {
    system: Array<Record<string, unknown>>;
  };
  const breakpoints = received.system.filter((b) => "cache_control" in b);
  assert.equal(breakpoints.length, 1);
  assert.deepEqual(breakpoints[0].cache_control, { type: "ephemeral" });
});

test("★ the same prefix sent twice through the proxy is a cache read", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "cache-preservation",
    stream: true,
  });

  const call = () =>
    callMessages({
      baseUrl: h.proxy.baseUrl,
      apiKey: "marblo-credit-token",
      direct: false,
      bodyBytes: bytes,
      stream: true,
    });

  const warm = await call();
  const read = await call();

  assert.equal(warm.status, 200);
  assert.equal(read.status, 200);

  assert.ok(
    warm.observation.usage.cacheCreationInputTokens > 0,
    "first call should write the cache",
  );
  assert.equal(warm.observation.usage.cacheReadInputTokens, 0);

  assert.ok(
    read.observation.usage.cacheReadInputTokens > 0,
    "second call should read the cache — a mutated prefix would miss",
  );
  assert.equal(read.observation.usage.cacheCreationInputTokens, 0);
  assert.ok(
    read.cacheHitRatio > 0.9,
    `expected a high cache hit ratio, got ${read.cacheHitRatio}`,
  );
});

test("★ G-P1 dry run: proxied and direct lanes score the same on the mock", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  // Distinct salts so one lane cannot warm the other's cache — the same
  // discipline the live probe uses.
  const runLane = async (salt: string, viaProxy: boolean) => {
    const { bytes } = buildCacheProbeBody({
      model: "claude-sonnet-5",
      salt,
      stream: true,
    });
    const opts = {
      baseUrl: viaProxy ? h.proxy.baseUrl : h.mock.baseUrl,
      apiKey: viaProxy ? "marblo-credit-token" : "sk-direct",
      direct: !viaProxy,
      bodyBytes: bytes,
      stream: true,
    };
    await callMessages(opts);
    const read = await callMessages(opts);
    return cacheHitRatio(read.observation.usage);
  };

  const directRatio = await runLane("gp1-direct", false);
  const proxiedRatio = await runLane("gp1-proxied", true);

  const gate = evaluateCachePreservation(directRatio, proxiedRatio);
  assert.equal(
    gate.verdict,
    "green",
    `G-P1 red on the mock: direct=${directRatio} proxied=${proxiedRatio}`,
  );
  assert.ok(
    Math.abs(gate.deltaPp) < 1,
    "lanes should score essentially identically",
  );
});

test("SSE bytes reach the client unchanged", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "sse-passthrough",
    stream: true,
  });

  const response = await fetch(`${h.proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: "Bearer marblo-credit-token",
    },
    body: bytes,
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );

  const received = Buffer.from(await response.arrayBuffer());
  const emitted = h.mock.emittedStreams[0];
  assert.equal(
    received.toString("utf8"),
    emitted.toString("utf8"),
    "the client must see exactly the bytes upstream emitted",
  );
});

test("streaming is incremental, not buffered to completion", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "sse-incremental",
    stream: true,
  });

  const response = await fetch(`${h.proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: "Bearer marblo-credit-token",
    },
    body: bytes,
  });

  const reader = response.body?.getReader();
  assert.ok(reader);

  // The first read must resolve with message_start before the stream ends —
  // a proxy that awaited the whole body would deliver everything in one chunk
  // after the fact, which still "works" but breaks the CLI's live rendering.
  const first = await reader.read();
  assert.equal(first.done, false);
  const firstText = Buffer.from(first.value ?? new Uint8Array()).toString(
    "utf8",
  );
  assert.match(firstText, /message_start/);

  // Drain the rest so the socket closes cleanly.
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
  }
});

test("the client's credential never reaches upstream", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "credential-swap",
    stream: false,
  });

  await fetch(`${h.proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer marblo-credit-token-should-not-leak",
      "x-api-key": "sk-user-supplied-should-not-leak",
      "anthropic-beta": "extended-cache-ttl-2025-04-11",
    },
    body: bytes,
  });

  const headers = h.mock.requests[0].headers;
  assert.equal(headers["x-api-key"], "sk-test-server-side-key");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["anthropic-beta"], "extended-cache-ttl-2025-04-11");
});

test("records usage and cache ratio for measurement, and no bodies", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const { bytes } = buildCacheProbeBody({
    model: "claude-sonnet-5",
    salt: "metrics",
    stream: true,
  });
  await callMessages({
    baseUrl: h.proxy.baseUrl,
    apiKey: "marblo-credit-token",
    direct: false,
    bodyBytes: bytes,
    stream: true,
  });

  // The relay resolves after res.end(); give the metrics ring a tick to record.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const records = h.proxy.metrics.list();
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.status, 200);
  assert.equal(record.model, "claude-sonnet-5");
  assert.equal(record.stream, true);
  assert.equal(record.stopReason, "end_turn");
  assert.ok(record.usage.cacheCreationInputTokens > 0);
  assert.equal(record.requestBytes, bytes.length);
  assert.equal(
    record.requestBodySha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  // ★ P4: prompts and responses are never in the record.
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("Reply with exactly the word OK"), false);
});

test("upstream error status and envelope pass through untouched", async (t) => {
  const mock = await startMockAnthropic({ forceStatus: 429 });
  const proxy = await startProxy({ upstreamBaseUrl: mock.baseUrl });
  t.after(async () => {
    await proxy.close();
    await mock.close();
  });

  const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer token",
    },
    body: Buffer.from(JSON.stringify({ model: "claude-sonnet-5" }), "utf8"),
  });

  assert.equal(response.status, 429);
  const body = (await response.json()) as { type: string };
  assert.equal(body.type, "error");
});

test("answers 503 rather than relaying without a server credential", async (t) => {
  const mock = await startMockAnthropic();
  const proxy = await startProxy({
    upstreamBaseUrl: mock.baseUrl,
    upstreamApiKey: "",
  });
  t.after(async () => {
    await proxy.close();
    await mock.close();
  });

  const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.from("{}", "utf8"),
  });

  assert.equal(response.status, 503);
  assert.equal(mock.requests.length, 0, "nothing should reach upstream");
});

test("rejects an oversized body instead of buffering it", async (t) => {
  const mock = await startMockAnthropic();
  const proxy = await startProxy({
    upstreamBaseUrl: mock.baseUrl,
    maxBodyBytes: 1024,
  });
  t.after(async () => {
    await proxy.close();
    await mock.close();
  });

  const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer token",
    },
    body: Buffer.alloc(4096, 0x61),
  });

  assert.equal(response.status, 413);
  assert.equal(mock.requests.length, 0);
});

test("healthz reports credential presence without revealing it", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const response = await fetch(`${h.proxy.baseUrl}/healthz`);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.upstreamConfigured, true);
  assert.equal(JSON.stringify(body).includes("sk-test-server-side-key"), false);
});

test("unknown paths 404 instead of being relayed", async (t) => {
  const h = await harness();
  t.after(() => h.close());

  const response = await fetch(`${h.proxy.baseUrl}/anything`);
  assert.equal(response.status, 404);
  assert.equal(h.mock.requests.length, 0);
});
