import assert from "node:assert/strict";
import test from "node:test";

import { buildDownstreamHeaders, buildUpstreamHeaders } from "../src/headers";

const OPTS = {
  upstreamApiKey: "sk-server-side",
  defaultAnthropicVersion: "2023-06-01",
};

test("forwards the anthropic-* headers that change semantics", () => {
  const out = buildUpstreamHeaders(
    {
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "extended-cache-ttl-2025-04-11,claude-code-20250219",
      "content-type": "application/json",
      accept: "text/event-stream",
      "user-agent": "claude-cli/1.0",
      "x-stainless-lang": "js",
    },
    OPTS,
  );

  assert.equal(
    out["anthropic-beta"],
    "extended-cache-ttl-2025-04-11,claude-code-20250219",
  );
  assert.equal(out["anthropic-version"], "2023-06-01");
  assert.equal(out.accept, "text/event-stream");
  assert.equal(out["user-agent"], "claude-cli/1.0");
  assert.equal(out["x-stainless-lang"], "js");
});

test("replaces every client credential with our server key", () => {
  const out = buildUpstreamHeaders(
    {
      authorization: "Bearer marblo-credit-token",
      "x-api-key": "sk-user-supplied",
      cookie: "session=abc",
    },
    OPTS,
  );

  assert.equal(out["x-api-key"], "sk-server-side");
  assert.equal(out.authorization, undefined);
  assert.equal(out.cookie, undefined);
});

test("a forwarded x-api-key cannot shadow the injected one", () => {
  // Header order in the object is attacker-influenced; the key is written last.
  const out = buildUpstreamHeaders(
    { "x-api-key": "sk-attacker", "anthropic-version": "2023-06-01" },
    OPTS,
  );
  assert.equal(out["x-api-key"], "sk-server-side");
});

test("drops hop-by-hop and framing headers", () => {
  const out = buildUpstreamHeaders(
    {
      connection: "keep-alive",
      "transfer-encoding": "chunked",
      "content-length": "123",
      host: "api.marblo.app",
      "accept-encoding": "gzip",
      te: "trailers",
    },
    OPTS,
  );

  for (const name of [
    "connection",
    "transfer-encoding",
    "content-length",
    "host",
    "accept-encoding",
    "te",
  ]) {
    assert.equal(out[name], undefined, `${name} should not be forwarded`);
  }
});

test("drops unknown client headers rather than passing them to the vendor", () => {
  const out = buildUpstreamHeaders(
    { "x-marblo-user-id": "uid-123", "x-forwarded-for": "1.2.3.4" },
    OPTS,
  );
  assert.equal(out["x-marblo-user-id"], undefined);
  assert.equal(out["x-forwarded-for"], undefined);
});

test("supplies anthropic-version and content-type when the client omits them", () => {
  const out = buildUpstreamHeaders({}, OPTS);
  assert.equal(out["anthropic-version"], "2023-06-01");
  assert.equal(out["content-type"], "application/json");
});

test("joins repeated header values instead of dropping them", () => {
  const out = buildUpstreamHeaders(
    { "anthropic-beta": ["a-2024", "b-2025"] },
    OPTS,
  );
  assert.equal(out["anthropic-beta"], "a-2024, b-2025");
});

test("downstream keeps rate-limit and retry hints, drops re-framed headers", () => {
  const upstream = new Headers({
    "content-type": "text/event-stream",
    "content-length": "999",
    "content-encoding": "gzip",
    "retry-after": "30",
    "anthropic-ratelimit-requests-remaining": "42",
    "request-id": "req_abc",
    connection: "keep-alive",
  });

  const out = buildDownstreamHeaders(upstream, "proxy-req-1");

  assert.equal(out["content-type"], "text/event-stream");
  assert.equal(out["retry-after"], "30");
  assert.equal(out["anthropic-ratelimit-requests-remaining"], "42");
  assert.equal(out["request-id"], "req_abc");
  assert.equal(out["content-length"], undefined);
  assert.equal(out["content-encoding"], undefined);
  assert.equal(out.connection, undefined);
  assert.equal(out["x-marblo-proxy-request-id"], "proxy-req-1");
});
