import { describe, it, expect } from "vitest";
import {
  scoreModelsDetailed,
  type ModelType,
} from "../../electron/dispatch-scoring";
import {
  emptyRoutingGraph,
  applyOutcome,
  type GraphContext,
  type OutcomeMode,
} from "../../electron/routing-graph";

/**
 * §9 walkthrough: the antigravity "no-activity stale" edge case. A repeated
 * negative label on (complex + agentic) antigravity should accumulate into a
 * routing prior that demotes antigravity below its rivals — but only after
 * enough evidence (a single stale must NOT demote), and it must self-heal when
 * successes return + old stales decay.
 */

const T0 = Date.parse("2026-07-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// The motivating dispatch shape: a complex, autonomous ticket where antigravity
// is the incumbent winner (agentic +30 tag bonus).
const ENABLED: ModelType[] = ["claude", "gpt", "antigravity"];
const TAGS = ["agentic", "autonomous"];
const CTX: GraphContext = {
  role: "backend",
  complexity: "complex",
  tags: TAGS,
};

function feed(
  graph: ReturnType<typeof emptyRoutingGraph>,
  mode: OutcomeMode,
  count: number,
  startMs: number,
) {
  for (let i = 0; i < count; i++) {
    applyOutcome(graph, {
      model: "antigravity",
      mode,
      ctx: CTX,
      taskId: `T-${mode}-${i}-${startMs}`,
      agentId: `agy-${i}`,
      atMs: startMs + i * DAY,
    });
  }
  return graph;
}

function agyBias(graph: ReturnType<typeof emptyRoutingGraph>): number {
  const sel = scoreModelsDetailed(
    ENABLED,
    TAGS,
    "complex",
    undefined,
    CTX,
    graph,
  );
  return sel.scores.find((s) => s.model === "antigravity")!.graphBias;
}

describe("§9 antigravity stale → demote → recover", () => {
  it("baseline: with no graph, antigravity wins the agentic ticket", () => {
    const sel = scoreModelsDetailed(ENABLED, TAGS, "complex");
    const agy = sel.scores.find((s) => s.model === "antigravity")!;
    expect(agy.graphBias).toBe(0);
    // agentic(+30) + multi-agent-less → antigravity tops the agentic ticket.
    expect(agy.total).toBeGreaterThanOrEqual(
      sel.scores.find((s) => s.model === "claude")!.total,
    );
  });

  it("cold graph is byte-identical to no graph (no regression)", () => {
    const cold = emptyRoutingGraph();
    const withGraph = scoreModelsDetailed(
      ENABLED,
      TAGS,
      "complex",
      undefined,
      CTX,
      cold,
    );
    const without = scoreModelsDetailed(ENABLED, TAGS, "complex");
    // Same per-model totals (graphBias all 0).
    for (const s of withGraph.scores) {
      const ref = without.scores.find((r) => r.model === s.model)!;
      expect(s.total).toBe(ref.total);
      expect(s.graphBias).toBe(0);
    }
  });

  it("a SINGLE stale barely moves the bias (does not demote)", () => {
    const g = feed(emptyRoutingGraph(), "no_activity_stale", 1, T0);
    const bias = agyBias(g);
    expect(bias).toBeLessThan(0);
    expect(Math.abs(bias)).toBeLessThan(2); // shrunk — not a demotion
    // Antigravity still wins/ties the agentic ticket after just one stale.
    const sel = scoreModelsDetailed(
      ENABLED,
      TAGS,
      "complex",
      undefined,
      CTX,
      g,
    );
    const agy = sel.scores.find((s) => s.model === "antigravity")!;
    const claude = sel.scores.find((s) => s.model === "claude")!;
    expect(agy.total).toBeGreaterThan(claude.total);
  });

  it("REPEATED stales accumulate → antigravity total drops by the learned prior", () => {
    const cold = scoreModelsDetailed(ENABLED, TAGS, "complex");
    const coldAgy = cold.scores.find((s) => s.model === "antigravity")!.total;

    const g = feed(emptyRoutingGraph(), "no_activity_stale", 6, T0);
    const bias = agyBias(g);
    expect(bias).toBeLessThan(-8); // strong, accumulated negative prior
    const sel = scoreModelsDetailed(
      ENABLED,
      TAGS,
      "complex",
      undefined,
      CTX,
      g,
    );
    const agy = sel.scores.find((s) => s.model === "antigravity")!;
    // The prior lowers antigravity's total by exactly the (clamped) graphBias.
    expect(agy.total).toBe(coldAgy + agy.graphBias);
    expect(agy.total).toBeLessThan(coldAgy);
    // Safety: on a STRONGLY-agentic ticket antigravity's +55 tag lead is bigger
    // than the ±20 lean, so the graph does NOT veto it — it's a lean, not an
    // override (spec §9.4 "여전히 tie-band면 antigravity가 뽑힐 수도").
    expect(agy.total).toBeGreaterThan(
      sel.scores.find((s) => s.model === "claude")!.total,
    );
  });

  it("in a CLOSE race, the accumulated prior flips the selection to a rival", () => {
    // Neutral-tag standard ticket: claude/gpt/antigravity are within the tie
    // band, so antigravity would normally share the round-robin. The prior is
    // fed on role+complexity cells (no tag bonuses in play), which is exactly
    // where a ±20 lean is decisive.
    const tieTags: string[] = [];
    const tieCtx: GraphContext = { role: "backend", complexity: "standard" };
    const g = emptyRoutingGraph();
    for (let i = 0; i < 6; i++) {
      applyOutcome(g, {
        model: "antigravity",
        mode: "no_activity_stale",
        ctx: tieCtx,
        taskId: `tie-${i}`,
        agentId: `agy-${i}`,
        atMs: T0 + i * DAY,
      });
    }
    const sel = scoreModelsDetailed(
      ENABLED,
      tieTags,
      "standard",
      undefined,
      tieCtx,
      g,
    );
    const agy = sel.scores.find((s) => s.model === "antigravity")!;
    expect(agy.graphBias).toBeLessThan(-8);
    // Antigravity is pushed out of the contender band → never selected.
    expect(sel.contenders).not.toContain("antigravity");
    expect(sel.selected).not.toBe("antigravity");
  });

  it("self-heals: later successes + decay pull the bias back toward 0", () => {
    const g = feed(emptyRoutingGraph(), "no_activity_stale", 6, T0);
    const demoted = agyBias(g);
    expect(demoted).toBeLessThan(-8);

    // Weeks later, antigravity succeeds repeatedly on the same shape. Each
    // merge both adds positive weight AND ages the old stales (21d half-life).
    feed(g, "merged", 8, T0 + 30 * DAY);
    const recovered = agyBias(g);
    expect(recovered).toBeGreaterThan(demoted);
    // Recovered materially — no longer a strong demotion.
    expect(recovered).toBeGreaterThan(-4);
  });

  it("the graph bias can NEVER overturn the role hard-gate", () => {
    // Pile on failures well past the clamp.
    const g = feed(emptyRoutingGraph(), "crash_loop", 30, T0);
    const sel = scoreModelsDetailed(
      ENABLED,
      TAGS,
      "complex",
      undefined,
      CTX,
      g,
    );
    const agy = sel.scores.find((s) => s.model === "antigravity")!;
    // graphBias is clamped to −20; base(45)+agentic(30) still keeps the total
    // positive — a role-matched candidate is never driven below a role
    // MISMATCH (which never even enters scoring). i.e. bias is a lean, not a veto.
    expect(agy.graphBias).toBe(-20);
    expect(agy.total).toBeGreaterThan(0);
  });
});
