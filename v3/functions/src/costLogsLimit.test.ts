import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COST_LOGS_LIMIT,
  MAX_COST_LOGS_LIMIT,
  normalizeCostLogsLimit,
} from "./costLogsLimit";

test("caps oversized cost log limits at 1000", () => {
  assert.deepEqual(normalizeCostLogsLimit(1001), {
    limit: MAX_COST_LOGS_LIMIT,
    capped: true,
  });
  assert.deepEqual(normalizeCostLogsLimit("5000"), {
    limit: MAX_COST_LOGS_LIMIT,
    capped: true,
  });
});

test("passes normal positive limits through", () => {
  assert.deepEqual(normalizeCostLogsLimit(25), { limit: 25, capped: false });
  assert.deepEqual(normalizeCostLogsLimit(25.9), { limit: 25, capped: false });
});

test("uses the default for missing, negative, and non-finite limits", () => {
  for (const value of [
    undefined,
    null,
    -1,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.deepEqual(normalizeCostLogsLimit(value), {
      limit: DEFAULT_COST_LOGS_LIMIT,
      capped: false,
    });
  }
});
