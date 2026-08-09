import assert from "node:assert/strict";
import test from "node:test";

import {
  MEASURED_TICKET_MIX,
  cacheBreakMultiplier,
  costIfCacheBrokenUsd,
  costUsd,
  ratesForModel,
  toMicroUsd,
} from "../src/cost";

const OPUS = ratesForModel("claude-opus-5");

/**
 * ★ Locks design doc §4-A. If someone "simplifies" the cache multipliers, this
 * fails with the exact dollars the L2 go/no-go was argued on.
 */
test("reproduces the §4-A per-ticket cost table", () => {
  const preserved = costUsd(MEASURED_TICKET_MIX, OPUS);
  const broken = costIfCacheBrokenUsd(MEASURED_TICKET_MIX, OPUS);

  assert.ok(
    Math.abs(preserved - 9.85) < 0.01,
    `cache preserved should be ~$9.85, got $${preserved.toFixed(4)}`,
  );
  assert.ok(
    Math.abs(broken - 63.09) < 0.02,
    `cache broken should be ~$63.09, got $${broken.toFixed(4)}`,
  );
  assert.ok(
    Math.abs(cacheBreakMultiplier(MEASURED_TICKET_MIX, OPUS) - 6.4) < 0.02,
    "the multiplier the whole PoC exists to defend should be ~6.4x",
  );
});

test("a 30% markup earns far less than a broken cache costs", () => {
  // §4-A: margin ~$3/ticket vs +$53 exposure. The ratio, not the absolutes.
  const preserved = costUsd(MEASURED_TICKET_MIX, OPUS);
  const margin = preserved * 0.3;
  const exposure = costIfCacheBrokenUsd(MEASURED_TICKET_MIX, OPUS) - preserved;
  assert.ok(exposure / margin > 15, "exposure should dwarf the markup");
});

test("cache read is billed at 0.1x and cache write at 1.25x the input rate", () => {
  const readOnly = costUsd(
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    },
    OPUS,
  );
  const writeOnly = costUsd(
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 0,
    },
    OPUS,
  );
  const plain = costUsd(
    {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    OPUS,
  );

  assert.equal(plain, 5);
  assert.ok(Math.abs(readOnly - 0.5) < 1e-9);
  assert.ok(Math.abs(writeOnly - 6.25) < 1e-9);
});

test("a turn with no cache has a break multiplier of 1", () => {
  const usage = {
    inputTokens: 1000,
    outputTokens: 100,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  assert.ok(Math.abs(cacheBreakMultiplier(usage, OPUS) - 1) < 1e-9);
});

test("an empty turn does not divide by zero", () => {
  const empty = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  assert.equal(cacheBreakMultiplier(empty, OPUS), 1);
});

test("unknown models fall back to the opus rate rather than charging zero", () => {
  assert.deepEqual(ratesForModel("some-future-model"), OPUS);
  assert.deepEqual(ratesForModel(null), OPUS);
});

test("micro-USD rounds up so the ledger never under-charges", () => {
  assert.equal(toMicroUsd(0.0000001), 1);
  assert.equal(toMicroUsd(1.5), 1_500_000);
});
