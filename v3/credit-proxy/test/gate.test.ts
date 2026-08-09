import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCachePreservation,
  evaluateCachePreservationFromUsage,
  evaluateToolLoop,
} from "../src/gate";
import { emptyObservation, type ResponseObservation } from "../src/types";

function observation(over: Partial<ResponseObservation>): ResponseObservation {
  return { ...emptyObservation(), ...over };
}

test("G-P1 is green when the proxy keeps the cache", () => {
  const result = evaluateCachePreservation(0.97, 0.965);
  assert.equal(result.verdict, "green");
  assert.ok(result.withinTolerance && result.preserved);
  assert.ok(Math.abs(result.deltaPp + 0.5) < 1e-6);
});

test("G-P1 is red when the proxy loses more than 10 points of cache", () => {
  const result = evaluateCachePreservation(0.97, 0.0);
  assert.equal(result.verdict, "red");
  assert.equal(result.preserved, false);
  assert.ok(Math.abs(result.deltaPp + 97) < 1e-6);
});

test("a proxied ratio ABOVE direct is not a failure", () => {
  // Shared upstream account: another session may already have warmed the prefix
  // (§5-F). The doc's symmetric ±10 flags it, the gate we act on does not.
  const result = evaluateCachePreservation(0.5, 0.95);
  assert.equal(result.withinTolerance, false);
  assert.equal(result.preserved, true);
  assert.equal(result.verdict, "green");
});

test("exactly at the tolerance boundary still passes", () => {
  const result = evaluateCachePreservation(0.9, 0.8);
  assert.ok(Math.abs(result.deltaPp + 10) < 1e-9);
  assert.equal(result.verdict, "green");
});

test("an unmeasured lane is not_measured, never a silent pass", () => {
  assert.equal(evaluateCachePreservation(null, 0.9).verdict, "not_measured");
  assert.equal(evaluateCachePreservation(0.9, null).verdict, "not_measured");
});

test("G-P1 can be evaluated straight from two usage snapshots", () => {
  const result = evaluateCachePreservationFromUsage(
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 900,
    },
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 900,
    },
  );
  assert.equal(result.verdict, "green");
  assert.equal(result.deltaPp, 0);
});

test("G-P2 is green for a completed tool round-trip", () => {
  const result = evaluateToolLoop({
    streamed: true,
    observations: [
      observation({
        contentBlockTypes: ["tool_use"],
        stopReason: "tool_use",
        sawMessageStart: true,
        sawMessageStop: true,
      }),
      observation({
        contentBlockTypes: ["text"],
        stopReason: "end_turn",
        sawMessageStart: true,
        sawMessageStop: true,
      }),
    ],
  });
  assert.equal(result.verdict, "green");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.finalStopReason, "end_turn");
});

test("G-P2 is not_measured when the model never called a tool", () => {
  const result = evaluateToolLoop({
    streamed: false,
    observations: [
      observation({ contentBlockTypes: ["text"], stopReason: "end_turn" }),
    ],
  });
  assert.equal(result.verdict, "not_measured");
});

test("G-P2 is red when the loop never terminates cleanly", () => {
  const result = evaluateToolLoop({
    streamed: false,
    observations: [
      observation({ contentBlockTypes: ["tool_use"], stopReason: "tool_use" }),
      observation({ contentBlockTypes: ["tool_use"], stopReason: "tool_use" }),
    ],
  });
  assert.equal(result.verdict, "red");
});

test("G-P2 is red when a streamed turn is missing its message_stop", () => {
  // This is the fingerprint of an SSE relay that truncated the stream.
  const result = evaluateToolLoop({
    streamed: true,
    observations: [
      observation({
        contentBlockTypes: ["tool_use"],
        stopReason: "tool_use",
        sawMessageStart: true,
        sawMessageStop: true,
      }),
      observation({
        contentBlockTypes: ["text"],
        stopReason: "end_turn",
        sawMessageStart: true,
        sawMessageStop: false,
      }),
    ],
  });
  assert.equal(result.verdict, "red");
  assert.match(result.reason, /message_start\/message_stop/);
});

test("G-P2 is red when any turn carried an upstream error event", () => {
  const result = evaluateToolLoop({
    streamed: true,
    observations: [
      observation({
        contentBlockTypes: ["tool_use"],
        stopReason: "tool_use",
        errorType: "overloaded_error",
      }),
    ],
  });
  assert.equal(result.verdict, "red");
  assert.match(result.reason, /overloaded_error/);
});

test("max_tokens counts as a clean termination", () => {
  const result = evaluateToolLoop({
    streamed: false,
    observations: [
      observation({ contentBlockTypes: ["tool_use"], stopReason: "tool_use" }),
      observation({ contentBlockTypes: ["text"], stopReason: "max_tokens" }),
    ],
  });
  assert.equal(result.verdict, "green");
});
