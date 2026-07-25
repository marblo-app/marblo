/**
 * Cold-start prior seeding (routing-graph.ts § Cold-start priors).
 *
 * The properties that make seeding safe to point at the live graph:
 *   - a seed is a BELIEF, never evidence (never touches n / raw)
 *   - it is bounded, and over-bound requests are refused not silently shrunk
 *   - evidence DISPLACES it as n grows (Bayesian blend, not addition)
 *   - it is idempotent (re-running the seed is a no-op → diffs are meaningful)
 *   - it is fully reversible in one call
 *   - un-seeded graphs behave exactly as before (no regression)
 */
import { describe, it, expect } from "vitest";
import {
  GRAPH_BIAS_MAX,
  SEED_PRIOR_MAX,
  SHRINKAGE_K,
  applyColdStartPriors,
  applyOutcome,
  clampSeedPrior,
  emptyRoutingGraph,
  graphBiasDetailForModel,
  graphBiasForModel,
  removeColdStartPriors,
  type ColdStartPrior,
} from "../../electron/routing-graph";

const T0 = Date.parse("2026-07-25T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const seed = (over: Partial<ColdStartPrior> = {}): ColdStartPrior => ({
  factorType: "complexity",
  factorValue: "complex",
  model: "claude",
  prior: 2,
  ...over,
});

describe("clampSeedPrior", () => {
  it("bounds to ±SEED_PRIOR_MAX and treats junk as 0", () => {
    expect(clampSeedPrior(2)).toBe(2);
    expect(clampSeedPrior(99)).toBe(SEED_PRIOR_MAX);
    expect(clampSeedPrior(-99)).toBe(-SEED_PRIOR_MAX);
    expect(clampSeedPrior(undefined)).toBe(0);
    expect(clampSeedPrior(NaN)).toBe(0);
  });
});

describe("applyColdStartPriors", () => {
  it("writes the prior WITHOUT inventing evidence", () => {
    const g = emptyRoutingGraph();
    const res = applyColdStartPriors(g, [seed()], T0);

    expect(res.rejected).toEqual([]);
    expect(res.applied).toEqual([
      { key: "complexity:complex|claude", prior: 2, created: true },
    ]);

    const cell = g.cells["complexity:complex|claude"];
    expect(cell.prior).toBe(2);
    // The whole point: a belief must never look like an observation.
    expect(cell.n).toBe(0);
    expect(cell.raw).toEqual({});
    expect(cell.decayed).toEqual({});
  });

  it("refuses an over-magnitude prior instead of silently clamping it", () => {
    const g = emptyRoutingGraph();
    const res = applyColdStartPriors(g, [seed({ prior: 20 })], T0);

    expect(res.applied).toEqual([]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toContain("exceeds SEED_PRIOR_MAX");
    // Nothing written — a refused seed must not leave a partial cell.
    expect(g.cells["complexity:complex|claude"]).toBeUndefined();
  });

  it("rejects empty factorValue and non-finite priors", () => {
    const g = emptyRoutingGraph();
    const res = applyColdStartPriors(
      g,
      [
        seed({ factorValue: "  " }),
        seed({ factorValue: "simple", prior: NaN }),
      ],
      T0,
    );
    expect(res.applied).toEqual([]);
    expect(res.rejected.map((r) => r.reason)).toEqual([
      "empty factorValue",
      expect.stringContaining("non-finite"),
    ]);
  });

  it("is idempotent — sets, does not accumulate", () => {
    const g = emptyRoutingGraph();
    applyColdStartPriors(g, [seed()], T0);
    applyColdStartPriors(g, [seed()], T0 + DAY);
    applyColdStartPriors(g, [seed()], T0 + 2 * DAY);
    expect(g.cells["complexity:complex|claude"].prior).toBe(2);
  });

  it("preserves observations when seeding a cell that already learned", () => {
    const g = emptyRoutingGraph();
    applyOutcome(g, {
      model: "claude",
      mode: "merged",
      ctx: { complexity: "complex" },
      taskId: "t1",
      agentId: "a1",
      atMs: T0,
    });
    const learned = { ...g.cells["complexity:complex|claude"] };

    applyColdStartPriors(g, [seed()], T0 + DAY);
    const after = g.cells["complexity:complex|claude"];

    expect(after.n).toBe(learned.n);
    expect(after.raw).toEqual(learned.raw);
    expect(after.decayed).toEqual(learned.decayed);
    expect(after.prior).toBe(2);
  });

  it("prior 0 clears an existing seed", () => {
    const g = emptyRoutingGraph();
    applyColdStartPriors(g, [seed()], T0);
    applyColdStartPriors(g, [seed({ prior: 0 })], T0);
    expect(g.cells["complexity:complex|claude"].prior).toBeUndefined();
  });
});

describe("cold-start prior → graphBias", () => {
  it("a seeded cold cell contributes its full prior", () => {
    const g = emptyRoutingGraph();
    applyColdStartPriors(g, [seed({ prior: -2 })], T0);
    expect(graphBiasForModel("claude", { complexity: "complex" }, g)).toBe(-2);
  });

  it("leaves un-seeded models and contexts at exactly 0 (no regression)", () => {
    const g = emptyRoutingGraph();
    applyColdStartPriors(g, [seed()], T0);
    expect(graphBiasForModel("gpt", { complexity: "complex" }, g)).toBe(0);
    expect(graphBiasForModel("claude", { complexity: "simple" }, g)).toBe(0);
    expect(graphBiasForModel("claude", { role: "backend" }, g)).toBe(0);
  });

  it("evidence DISPLACES the prior as n grows", () => {
    const ctx = { complexity: "complex" as const };
    const g = emptyRoutingGraph();
    // Seed a NEGATIVE prior, then feed positive outcomes: the sign must flip.
    applyColdStartPriors(g, [seed({ prior: -3 })], T0);
    expect(graphBiasForModel("claude", ctx, g)).toBe(-3);

    for (let i = 0; i < 20; i++) {
      applyOutcome(g, {
        model: "claude",
        mode: "merged",
        ctx,
        taskId: `t${i}`,
        agentId: `a${i}`,
        atMs: T0,
      });
    }
    const bias = graphBiasForModel("claude", ctx, g);
    expect(bias).toBeGreaterThan(0);

    // At n=20 the prior retains K/(n+K) weight and no more.
    const cell = g.cells["complexity:complex|claude"];
    const shrink = cell.n / (cell.n + SHRINKAGE_K);
    const expected = -3 * (1 - shrink) + 60 * shrink;
    expect(bias).toBeCloseTo(Math.min(GRAPH_BIAS_MAX, expected), 6);
  });

  it("at n = SHRINKAGE_K the prior and the evidence carry equal weight", () => {
    const ctx = { complexity: "standard" as const };
    const g = emptyRoutingGraph();
    applyColdStartPriors(g, [seed({ factorValue: "standard", prior: -2 })], T0);
    for (let i = 0; i < SHRINKAGE_K; i++) {
      applyOutcome(g, {
        model: "claude",
        mode: "blocked", // ROUTING_WEIGHT -0.3 — small, keeps us off the clamp
        ctx,
        taskId: `t${i}`,
        agentId: `a${i}`,
        atMs: T0,
      });
    }
    const cell = g.cells["complexity:standard|claude"];
    expect(cell.n).toBe(SHRINKAGE_K);
    const net = cell.decayed.blocked ?? 0;
    expect(graphBiasForModel("claude", ctx, g)).toBeCloseTo(
      -2 * 0.5 + net * 0.5,
      6,
    );
  });

  it("stays clamped to ±GRAPH_BIAS_MAX when many seeded cells stack", () => {
    const g = emptyRoutingGraph();
    applyColdStartPriors(
      g,
      [
        seed({ factorType: "complexity", factorValue: "complex", prior: 3 }),
        seed({ factorType: "role", factorValue: "backend", prior: 3 }),
        ...Array.from({ length: 20 }, (_, i) =>
          seed({ factorType: "tag", factorValue: `t${i}`, prior: 3 }),
        ),
      ],
      T0,
    );
    const ctx = {
      complexity: "complex" as const,
      role: "backend",
      tags: Array.from({ length: 20 }, (_, i) => `t${i}`),
    };
    expect(graphBiasForModel("claude", ctx, g)).toBe(GRAPH_BIAS_MAX);
  });

  it("names the seed in the decision note so the log explains the nudge", () => {
    const g = emptyRoutingGraph();
    applyColdStartPriors(g, [seed({ prior: -2 })], T0);
    const d = graphBiasDetailForModel("claude", { complexity: "complex" }, g);
    expect(d.bias).toBe(-2);
    expect(d.note).toContain("complex");
    expect(d.note).toContain("seed");
  });
});

describe("removeColdStartPriors", () => {
  it("drops seed-only cells and keeps cells that hold real evidence", () => {
    const g = emptyRoutingGraph();
    applyOutcome(g, {
      model: "claude",
      mode: "merged",
      ctx: { complexity: "complex" },
      taskId: "t1",
      agentId: "a1",
      atMs: T0,
    });
    applyColdStartPriors(
      g,
      [
        seed(), // onto the observed cell
        seed({ model: "antigravity", prior: -2 }), // seed-only
      ],
      T0 + DAY,
    );

    const { cleared, removed } = removeColdStartPriors(g, T0 + 2 * DAY);

    expect(cleared).toEqual(["complexity:complex|claude"]);
    expect(removed).toEqual(["complexity:complex|antigravity"]);
    expect(g.cells["complexity:complex|antigravity"]).toBeUndefined();
    expect(g.cells["complexity:complex|claude"].prior).toBeUndefined();
    expect(g.cells["complexity:complex|claude"].n).toBe(1);
  });

  it("round-trips: seed → revert restores the pre-seed bias exactly", () => {
    const ctx = { complexity: "complex" as const };
    const g = emptyRoutingGraph();
    applyOutcome(g, {
      model: "claude",
      mode: "merged",
      ctx,
      taskId: "t1",
      agentId: "a1",
      atMs: T0,
    });
    const beforeBias = graphBiasForModel("claude", ctx, g);
    const beforeCells = JSON.stringify(g.cells);

    applyColdStartPriors(g, [seed(), seed({ model: "gpt", prior: -1 })], T0);
    expect(graphBiasForModel("claude", ctx, g)).not.toBe(beforeBias);

    removeColdStartPriors(g, T0);
    expect(graphBiasForModel("claude", ctx, g)).toBe(beforeBias);
    expect(graphBiasForModel("gpt", ctx, g)).toBe(0);
    expect(JSON.stringify(g.cells)).toBe(beforeCells);
  });

  it("is a no-op on a graph that was never seeded", () => {
    const g = emptyRoutingGraph();
    applyOutcome(g, {
      model: "gpt",
      mode: "merged",
      ctx: { complexity: "simple" },
      taskId: "t1",
      agentId: "a1",
      atMs: T0,
    });
    const snapshot = JSON.stringify(g);
    expect(removeColdStartPriors(g, T0 + DAY)).toEqual({
      cleared: [],
      removed: [],
    });
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});
