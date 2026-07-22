import { describe, it, expect } from "vitest";
import {
  emptyRoutingGraph,
  applyOutcome,
  graphBiasForModel,
  graphBiasDetailForModel,
  cellKeysForContext,
  isExcludedOutcome,
  ROUTING_WEIGHT,
  GRAPH_BIAS_MAX,
  SHRINKAGE_K,
  DEFAULT_HALF_LIFE_DAYS,
  type GraphContext,
  type OutcomeMode,
} from "../../electron/routing-graph";

// Fixed clock helpers (no wall-clock — spec §8.1 injects timestamps for
// deterministic decay).
const T0 = Date.parse("2026-07-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const CTX_COMPLEX_AGENTIC: GraphContext = {
  role: "backend",
  complexity: "complex",
  tags: ["agentic", "autonomous"],
};

function apply(
  graph: ReturnType<typeof emptyRoutingGraph>,
  mode: OutcomeMode,
  atMs: number,
  opts: { taskId?: string; agentId?: string; ctx?: GraphContext } = {},
) {
  return applyOutcome(graph, {
    model: "antigravity",
    mode,
    ctx: opts.ctx ?? CTX_COMPLEX_AGENTIC,
    taskId: opts.taskId ?? `T-${mode}-${atMs}`,
    agentId: opts.agentId ?? "agy-1",
    atMs,
  });
}

describe("cellKeysForContext", () => {
  it("expands role, taskType, complexity, and each tag into per-model keys", () => {
    const keys = cellKeysForContext("antigravity", {
      role: "backend",
      taskType: "feature",
      complexity: "complex",
      tags: ["agentic", "autonomous"],
    });
    expect(keys).toEqual([
      "role:backend|antigravity",
      "taskType:feature|antigravity",
      "complexity:complex|antigravity",
      "tag:agentic|antigravity",
      "tag:autonomous|antigravity",
    ]);
  });

  it("skips empty/absent factors", () => {
    expect(cellKeysForContext("claude", { tags: [] })).toEqual([]);
    expect(cellKeysForContext("claude", { role: "  " })).toEqual([]);
  });
});

describe("cold start (no regression)", () => {
  it("empty graph → graphBias 0 for any model/context", () => {
    const g = emptyRoutingGraph();
    expect(graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g)).toBe(0);
    expect(graphBiasForModel("claude", CTX_COMPLEX_AGENTIC, g)).toBe(0);
  });

  it("null/undefined graph → 0", () => {
    expect(graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, null)).toBe(0);
    expect(
      graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, undefined),
    ).toBe(0);
  });
});

describe("confidence shrinkage (single observation barely moves)", () => {
  it("one stale is shrunk to ~n/(n+K) of its weight", () => {
    const g = emptyRoutingGraph();
    apply(g, "no_activity_stale", T0);
    // One stale event touches 4 cells (role, complexity, 2 tags), each n=1,
    // decayed[stale] = -2. Per-cell bias = -2 * 1/(1+6). Sum over 4 cells.
    const bias = graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g);
    const perCell = ROUTING_WEIGHT.no_activity_stale * (1 / (1 + SHRINKAGE_K));
    expect(bias).toBeCloseTo(perCell * 4, 5);
    // Small in absolute terms — must NOT be a strong demotion.
    expect(Math.abs(bias)).toBeLessThan(2);
  });

  it("bias magnitude grows with repeated evidence (n ↑ → shrink → 1)", () => {
    const g = emptyRoutingGraph();
    const single = (() => {
      const one = emptyRoutingGraph();
      apply(one, "no_activity_stale", T0);
      return Math.abs(
        graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, one),
      );
    })();
    for (let i = 0; i < 6; i++) {
      apply(g, "no_activity_stale", T0 + i * DAY, { taskId: `T-${i}` });
    }
    const many = Math.abs(
      graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g),
    );
    expect(many).toBeGreaterThan(single * 3);
  });
});

describe("clamp to ±GRAPH_BIAS_MAX", () => {
  it("never exceeds the cap even under heavy repeated failure", () => {
    const g = emptyRoutingGraph();
    for (let i = 0; i < 40; i++) {
      apply(g, "crash_loop", T0 + i * DAY, { taskId: `T-${i}` });
    }
    const bias = graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g);
    expect(bias).toBeGreaterThanOrEqual(-GRAPH_BIAS_MAX);
    expect(bias).toBeLessThan(0);
    expect(bias).toBe(-GRAPH_BIAS_MAX);
  });
});

describe("idempotency (spec §8.5)", () => {
  it("the same (taskId, agentId, mode) is absorbed once", () => {
    const g = emptyRoutingGraph();
    apply(g, "no_activity_stale", T0, { taskId: "T1", agentId: "a1" });
    const after1 = graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g);
    // Re-deliver the identical outcome (retry / re-read) 3×.
    apply(g, "no_activity_stale", T0 + DAY, { taskId: "T1", agentId: "a1" });
    apply(g, "no_activity_stale", T0 + 2 * DAY, {
      taskId: "T1",
      agentId: "a1",
    });
    const after3 = graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g);
    expect(after3).toBe(after1);
    // n stayed 1 in each cell.
    for (const key of cellKeysForContext("antigravity", CTX_COMPLEX_AGENTIC)) {
      expect(g.cells[key].n).toBe(1);
    }
  });

  it("a DIFFERENT mode for the same task is a distinct observation", () => {
    const g = emptyRoutingGraph();
    apply(g, "no_activity_stale", T0, { taskId: "T1", agentId: "a1" });
    apply(g, "completed", T0 + DAY, { taskId: "T1", agentId: "a1" });
    const key = "complexity:complex|antigravity";
    expect(g.cells[key].n).toBe(2);
  });
});

describe("dependency_stuck is EXCLUDED (spec §3.1 / §8.2)", () => {
  it("is flagged excluded and carries 0 routing weight", () => {
    expect(isExcludedOutcome("dependency_stuck")).toBe(true);
    expect(ROUTING_WEIGHT.dependency_stuck).toBe(0);
  });

  it("repeated dependency_stuck NEVER moves graphBias off 0", () => {
    const g = emptyRoutingGraph();
    for (let i = 0; i < 10; i++) {
      apply(g, "dependency_stuck", T0 + i * DAY, { taskId: `dep-${i}` });
    }
    expect(graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g)).toBe(0);
    // Raw count IS recorded (audit) but n / decayed stay empty.
    const key = "complexity:complex|antigravity";
    expect(g.cells[key].raw.dependency_stuck).toBe(10);
    expect(g.cells[key].n).toBe(0);
    expect(Object.keys(g.cells[key].decayed)).toHaveLength(0);
  });

  it("does not mask a real model-fault signal in the same context", () => {
    const g = emptyRoutingGraph();
    // Interleave 5 orchestrator-bug stalls with 3 genuine stales.
    for (let i = 0; i < 5; i++) {
      apply(g, "dependency_stuck", T0 + i * DAY, { taskId: `dep-${i}` });
    }
    for (let i = 0; i < 3; i++) {
      apply(g, "no_activity_stale", T0 + (i + 5) * DAY, { taskId: `st-${i}` });
    }
    const bias = graphBiasForModel("antigravity", CTX_COMPLEX_AGENTIC, g);
    // Only the 3 genuine stales count → negative, and n reflects only them.
    expect(bias).toBeLessThan(0);
    expect(g.cells["complexity:complex|antigravity"].n).toBe(3);
  });
});

describe("time decay (spec §8.1)", () => {
  it("model-behaviour weight halves after one model half-life", () => {
    const g = emptyRoutingGraph();
    // Two stales in the SAME cell path a full model half-life apart. The first
    // is decayed by ~1/2 when the second lands.
    apply(g, "no_activity_stale", T0, { taskId: "T1" });
    const hl = DEFAULT_HALF_LIFE_DAYS.model;
    apply(g, "no_activity_stale", T0 + hl * DAY, { taskId: "T2" });
    const key = "complexity:complex|antigravity";
    // decayed[stale] = (-2 * 0.5) + (-2) = -3 (first aged one half-life).
    expect(g.cells[key].decayed.no_activity_stale).toBeCloseTo(-3, 4);
  });

  it("host-bucket failures decay much faster than model-bucket", () => {
    const modelG = emptyRoutingGraph();
    const hostG = emptyRoutingGraph();
    apply(modelG, "no_activity_stale", T0, { taskId: "m1" });
    apply(hostG, "spawn_failed", T0, { taskId: "h1" });
    // Age both by the HOST half-life (2d) via a second same-cell touch.
    const hostHl = DEFAULT_HALF_LIFE_DAYS.host;
    apply(modelG, "no_activity_stale", T0 + hostHl * DAY, { taskId: "m2" });
    apply(hostG, "spawn_failed", T0 + hostHl * DAY, { taskId: "h2" });
    const key = "complexity:complex|antigravity";
    // Host halved (-2*0.5 -2 = -3); model barely decayed over 2d of a 21d hl.
    expect(hostG.cells[key].decayed.spawn_failed).toBeCloseTo(-3, 4);
    const modelDecayFactor = Math.pow(
      2,
      -hostHl / DEFAULT_HALF_LIFE_DAYS.model,
    );
    expect(modelG.cells[key].decayed.no_activity_stale).toBeCloseTo(
      -2 * modelDecayFactor - 2,
      4,
    );
  });

  it("backwards timestamps (clock skew) never amplify a signal", () => {
    const g = emptyRoutingGraph();
    apply(g, "no_activity_stale", T0 + 5 * DAY, { taskId: "T1" });
    apply(g, "no_activity_stale", T0, { taskId: "T2" }); // earlier than lastSeen
    const key = "complexity:complex|antigravity";
    // Δt clamped to 0 → simple sum, no growth beyond -4.
    expect(g.cells[key].decayed.no_activity_stale).toBeCloseTo(-4, 4);
  });
});

describe("graphBiasDetailForModel", () => {
  it("returns a factor+mode note when bias is non-zero", () => {
    const g = emptyRoutingGraph();
    for (let i = 0; i < 5; i++) {
      apply(g, "no_activity_stale", T0 + i * DAY, { taskId: `T-${i}` });
    }
    const detail = graphBiasDetailForModel(
      "antigravity",
      CTX_COMPLEX_AGENTIC,
      g,
    );
    expect(detail.bias).toBeLessThan(0);
    expect(detail.note).toContain("no_activity_stale");
  });

  it("cold start → empty note, 0 bias", () => {
    const detail = graphBiasDetailForModel(
      "antigravity",
      CTX_COMPLEX_AGENTIC,
      emptyRoutingGraph(),
    );
    expect(detail).toEqual({ bias: 0, note: "" });
  });
});
