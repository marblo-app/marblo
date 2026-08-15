import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_DIVERSITY_C,
  autoCandidates,
  diversityBonus,
  resetAutoSelectRotation,
  resolveDiversityC,
  selectAutoModel,
} from "../../electron/model-autoselect";
import {
  applyOutcome,
  cellKeysForContext,
  emptyRoutingGraph,
  type GraphContext,
  type OutcomeMode,
  type RoutingGraph,
} from "../../electron/routing-graph";

const T0 = Date.parse("2026-07-20T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function ctxFor(complexity: "simple" | "standard" | "complex"): GraphContext {
  return { role: "backend", complexity, taskType: "feature", tags: [] };
}

function feed(
  graph: RoutingGraph,
  modelKey: string,
  mode: OutcomeMode,
  count: number,
  ctx: GraphContext,
): RoutingGraph {
  for (let i = 0; i < count; i++) {
    applyOutcome(graph, {
      model: modelKey,
      mode,
      ctx,
      taskId: `D-${modelKey}-${mode}-${i}`,
      agentId: `a-${i}`,
      atMs: T0 + i * DAY,
    });
  }
  return graph;
}

function setNeutralObservations(
  graph: RoutingGraph,
  modelKey: string,
  count: number,
  ctx: GraphContext,
): RoutingGraph {
  for (const key of cellKeysForContext(modelKey, ctx)) {
    graph.cells[key] = {
      raw: {},
      decayed: {},
      n: count,
      firstSeen: new Date(T0).toISOString(),
      lastSeen: new Date(T0).toISOString(),
    };
  }
  return graph;
}

function plan(extra: Partial<Parameters<typeof selectAutoModel>[0]> = {}) {
  return selectAutoModel({
    harness: "gpt",
    tier: "standard",
    ctx: ctxFor("standard"),
    epsilon: 0,
    // 이 스위트는 native Codex rung 사이의 diversity 성분을 검증한다. Solar 는
    // gpt 하네스지만 키 조건부 env-swap 벤더라 여기서는 제외해 비교 대상을 고정한다.
    modelAvailable: (id) => id !== "solar-pro4",
    ...extra,
  });
}

function entropy(counts: readonly number[]): number {
  const total = counts.reduce((sum, n) => sum + n, 0);
  return counts.reduce((sum, n) => {
    if (n <= 0 || total <= 0) return sum;
    const p = n / total;
    return sum - p * Math.log2(p);
  }, 0);
}

beforeEach(() => {
  resetAutoSelectRotation();
});

describe("model-autoselect diversity bonus", () => {
  it("resolveDiversityC 는 env 계수를 파싱하고 잘못된 값은 기본값으로 되돌린다", () => {
    expect(resolveDiversityC("0")).toBe(0);
    expect(resolveDiversityC("2.5")).toBe(2.5);
    expect(resolveDiversityC("abc")).toBe(DEFAULT_DIVERSITY_C);
    expect(resolveDiversityC("-1")).toBe(DEFAULT_DIVERSITY_C);
    expect(resolveDiversityC(undefined)).toBe(DEFAULT_DIVERSITY_C);
  });

  it("성능 성분이 동일하면 관측이 적은 실제 model@effort 셀이 이긴다", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    const { candidates, entryIndex } = autoCandidates("gpt", "standard");
    const entry = candidates[entryIndex];
    const lean = candidates.find((c) => c.index === entryIndex + 1)!;

    setNeutralObservations(graph, entry.modelKey, 1_000, ctx);

    const p = plan({ ctx, graph })!;
    expect(p.modelKey).toBe(lean.modelKey);

    const leanScore = p.scores.find(
      (s) => s.candidate.modelKey === lean.modelKey,
    )!;
    const entryScore = p.scores.find(
      (s) => s.candidate.modelKey === entry.modelKey,
    )!;
    expect(leanScore.observations).toBe(0);
    expect(entryScore.observations).toBeGreaterThan(0);
    expect(leanScore.diversity).toBeGreaterThan(entryScore.diversity);
    expect(p.reason).toMatch(/diversity \+\d+(\.\d)? \(n=0, tot=\d+\)/);
  });

  it("n 이 커지면 같은 total 규모에서 보너스가 0 으로 수렴한다", () => {
    const fresh = diversityBonus(0, 1000, DEFAULT_DIVERSITY_C);
    const mature = diversityBonus(10_000, 10_000, DEFAULT_DIVERSITY_C);
    expect(fresh).toBeGreaterThan(10);
    expect(mature).toBeLessThan(0.2);
  });

  it("C_DIVERSITY=0 이면 #654 선택 경로가 회귀하지 않는다", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    const { candidates, entryIndex } = autoCandidates("gpt", "standard");
    const entry = candidates[entryIndex];
    const lean = candidates.find((c) => c.index === entryIndex - 1)!;

    setNeutralObservations(graph, entry.modelKey, 1_000, ctx);

    const disabled = plan({ ctx, graph, diversityCoefficient: 0 })!;
    expect(disabled.modelKey).toBe(entry.modelKey);
    expect(disabled.modelKey).not.toBe(lean.modelKey);
    expect(disabled.scores.every((s) => s.diversity === 0)).toBe(true);
  });

  it("반복 dispatch 에서 관측 분포가 더 균형화되어 엔트로피가 오른다", () => {
    const ctx = ctxFor("standard");
    const { candidates, entryIndex } = autoCandidates("gpt", "standard");
    const entry = candidates[entryIndex];
    const keys = candidates.map((c) => c.modelKey);
    const initialCounts = keys.map((key) => (key === entry.modelKey ? 30 : 0));

    const graph = emptyRoutingGraph();
    setNeutralObservations(graph, entry.modelKey, 30, ctx);
    const before = entropy(initialCounts);

    const afterCounts = new Map<string, number>(
      keys.map((key, index) => [key, initialCounts[index]]),
    );
    for (let i = 0; i < 18; i++) {
      const p = plan({ ctx, graph, epsilon: 0, diversityCoefficient: 6 })!;
      afterCounts.set(p.modelKey, (afterCounts.get(p.modelKey) ?? 0) + 1);
      setNeutralObservations(
        graph,
        p.modelKey,
        afterCounts.get(p.modelKey)!,
        ctx,
      );
    }

    const after = entropy(keys.map((key) => afterCounts.get(key) ?? 0));
    expect(after).toBeGreaterThan(before);
    expect(
      keys.filter((key) => (afterCounts.get(key) ?? 0) > 0).length,
    ).toBeGreaterThan(1);
  });
});
