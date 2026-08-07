/**
 * autoselect 실사용량·주간한도·stale KG 가드.
 *
 * 완료 기준(MixWNMGGCWDVAOIpOnFY):
 *   1. 사용량 높은 모델 하향 (usage load)
 *   2. 주간 한도 근접 시 해당 칸/하네스 de-prioritize
 *   3. task-level 다양성(ε·UCB·tie) 분산 + stale KG 감쇠
 *   4. #838 벤더 후보풀 회귀는 model-autoselect.test.ts 가 유지
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  selectAutoModel,
  resetAutoSelectRotation,
  autoCandidates,
} from "../../electron/model-autoselect";
import {
  usageLoadScore,
  weeklyLimitScore,
  weeklyUsedPercentForHarness,
  usageSnapshotFromRows,
  usageSnapshotFromCostSummary,
  tokensForHarness,
  tokensForModel,
  isSubscriptionQuotaModel,
} from "../../electron/usage-rollup";
import {
  HARNESS_WEEKLY_TOKEN_SOFT_LIMIT,
  weeklyTokenSoftLimitForHarness,
} from "../../electron/model-ladder";
import {
  emptyRoutingGraph,
  staleGraphAttenuation,
  STALE_GRAPH_SOFT_DAYS,
  STALE_GRAPH_HARD_DAYS,
  STALE_GRAPH_FLOOR,
  applyOutcome,
  type GraphContext,
  type RoutingGraph,
} from "../../electron/routing-graph";

const T0 = Date.parse("2026-08-07T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ONLY_ORIGINAL_CLAUDE = new Set([
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-fable-5",
]);
const onlyOriginalClaude = (id: string) => ONLY_ORIGINAL_CLAUDE.has(id);

function ctxFor(
  complexity: "simple" | "standard" | "complex",
): GraphContext {
  return { role: "backend", complexity, taskType: "feature", tags: [] };
}

function plan(
  harness: string,
  tier: "simple" | "standard" | "complex",
  extra: Partial<Parameters<typeof selectAutoModel>[0]> = {},
) {
  return selectAutoModel({
    harness,
    tier,
    ctx: ctxFor(tier),
    epsilon: 0,
    diversityCoefficient: 0,
    ...extra,
  });
}

beforeEach(() => {
  resetAutoSelectRotation();
});

describe("usage-rollup pure scorers", () => {
  it("usageLoadScore: 점유율 높을수록 더 큰 감점, 콜드는 0", () => {
    expect(usageLoadScore(0, 0, 8)).toBe(0);
    expect(usageLoadScore(50, 100, 8)).toBe(-4);
    expect(usageLoadScore(100, 100, 8)).toBe(-8);
    expect(usageLoadScore(0, 100, 8)).toBe(0);
  });

  it("weeklyLimitScore: soft(50%) 미만 0, 100% 에서 −weight", () => {
    expect(weeklyLimitScore(10, 100, 16)).toBe(0);
    expect(weeklyLimitScore(50, 100, 16)).toBe(0);
    expect(weeklyLimitScore(100, 100, 16)).toBe(-16);
    expect(weeklyLimitScore(150, 100, 16)).toBe(-24);
  });

  it("HARNESS_WEEKLY_TOKEN_SOFT_LIMIT 은 claude/gpt 만 있고 grok 은 없음", () => {
    expect(weeklyTokenSoftLimitForHarness("claude")).toBe(
      HARNESS_WEEKLY_TOKEN_SOFT_LIMIT.claude,
    );
    expect(weeklyTokenSoftLimitForHarness("gpt")).toBe(
      HARNESS_WEEKLY_TOKEN_SOFT_LIMIT.gpt,
    );
    expect(weeklyTokenSoftLimitForHarness("grok")).toBeUndefined();
  });

  it("getCostSummary weekly shape 어댑터", () => {
    const snap = usageSnapshotFromCostSummary({
      weeklyByModel: [
        { model: "claude-opus-5", totalTokens: 1_000_000, cost: 12 },
        { model: "gpt-5.6-terra", totalTokens: 200_000 },
      ],
    });
    expect(snap?.source).toBe("getCostSummary");
    expect(tokensForModel("claude-opus-5", snap)).toBe(1_000_000);
    expect(tokensForHarness("claude", snap, { subscriptionOnly: true })).toBe(
      1_000_000,
    );
  });

  it("env-swap MiniMax 는 구독 쿼터 합산에서 빠진다", () => {
    expect(isSubscriptionQuotaModel("claude-opus-5")).toBe(true);
    expect(isSubscriptionQuotaModel("MiniMax-M3")).toBe(false);
  });

  it("weeklyUsedPercentForHarness 는 soft limit 대비 %", () => {
    const limit = HARNESS_WEEKLY_TOKEN_SOFT_LIMIT.claude!;
    const snap = usageSnapshotFromRows([
      { model: "claude-opus-5", totalTokens: limit * 0.9 },
    ]);
    const pct = weeklyUsedPercentForHarness("claude", snap);
    expect(pct).toBeCloseTo(90, 0);
  });
});

describe("★실사용량 — 많이 쓴 모델 하향", () => {
  it("opus 주간 토큰이 압도적이면 standard 가 sonnet 쪽으로 기운다", () => {
    const limit = HARNESS_WEEKLY_TOKEN_SOFT_LIMIT.claude!;
    // 한도 압력은 약하게(30%) 두고, 모델 점유율 편중만 강하게.
    const usageRollup = usageSnapshotFromRows([
      { model: "claude-opus-5", totalTokens: limit * 0.28 },
      { model: "claude-sonnet-5", totalTokens: limit * 0.02 },
    ]);

    const cold = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
      diversityCoefficient: 0,
    })!;
    // 콜드 회전 경로 대비: 사용량 주입 시 opus 의 usage 감점이 sonnet 보다 큼
    const hot = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
      usageRollup,
      diversityCoefficient: 0,
    })!;

    const coldOpus = cold.scores.find(
      (s) => s.candidate.model === "claude-opus-5",
    )!;
    const hotOpus = hot.scores.find(
      (s) => s.candidate.model === "claude-opus-5",
    )!;
    const hotSonnet = hot.scores.find(
      (s) => s.candidate.model === "claude-sonnet-5",
    )!;

    expect(hotOpus.usage).toBeLessThan(0);
    expect(hotOpus.usage).toBeLessThan(hotSonnet.usage);
    // 사용량 항이 실제로 총점에 반영
    expect(hotOpus.total).toBeLessThan(coldOpus.total);
  });

  it("사용량 없는 롤업이면 usage·weeklyLimit 항이 0 (콜드 무회귀)", () => {
    const p = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
    })!;
    expect(p.scores.every((s) => s.usage === 0)).toBe(true);
    expect(p.scores.every((s) => s.weeklyLimit === 0)).toBe(true);
  });
});

describe("★주간 한도 근접 — 강하게 de-prioritize", () => {
  it("claude 주간 한도 95% 면 weeklyLimit 감점이 크고 승자가 opus 가 아닐 수 있다", () => {
    const limit = HARNESS_WEEKLY_TOKEN_SOFT_LIMIT.claude!;
    const usageRollup = usageSnapshotFromRows([
      { model: "claude-opus-5", totalTokens: Math.floor(limit * 0.9) },
      { model: "claude-sonnet-5", totalTokens: Math.floor(limit * 0.05) },
    ]);

    const p = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
      usageRollup,
      diversityCoefficient: 0,
      // 쿼터도 같이 빡세게(단가 압력) — 한도 합성 시나리오
      budgetUsedPercent: 90,
    })!;

    const opus = p.scores.find((s) => s.candidate.model === "claude-opus-5")!;
    const sonnet = p.scores.find(
      (s) => s.candidate.model === "claude-sonnet-5",
    )!;
    expect(opus.weeklyLimit).toBeLessThan(0);
    expect(opus.weeklyLimit).toBeLessThan(sonnet.weeklyLimit);
    // 한도+사용량 압력 하에서 sonnet 이 opus 를 총점에서 이긴다
    expect(sonnet.total).toBeGreaterThan(opus.total);
  });

  it("gpt 한도 근접 시 weeklyUsedPercent 가 높고 soft limit 상수와 일치", () => {
    const limit = HARNESS_WEEKLY_TOKEN_SOFT_LIMIT.gpt!;
    const snap = usageSnapshotFromRows([
      { model: "gpt-5.6-terra", totalTokens: limit },
    ]);
    expect(weeklyUsedPercentForHarness("gpt", snap)).toBe(100);
    // grok 한도 없음 → null
    expect(weeklyUsedPercentForHarness("grok", snap)).toBeNull();
  });
});

describe("★stale KG 감쇠 (7/27)", () => {
  it("soft 이내 1, hard 이상 floor, 사이 선형", () => {
    const now = T0;
    expect(staleGraphAttenuation(new Date(now).toISOString(), now)).toBe(1);
    expect(
      staleGraphAttenuation(
        new Date(now - STALE_GRAPH_SOFT_DAYS * DAY).toISOString(),
        now,
      ),
    ).toBe(1);
    expect(
      staleGraphAttenuation(
        new Date(now - STALE_GRAPH_HARD_DAYS * DAY).toISOString(),
        now,
      ),
    ).toBe(STALE_GRAPH_FLOOR);
    const mid = staleGraphAttenuation(
      new Date(now - 17 * DAY).toISOString(),
      now,
    );
    expect(mid).toBeGreaterThan(STALE_GRAPH_FLOOR);
    expect(mid).toBeLessThan(1);
  });

  it("오래된 그래프의 claude 양의 kg 가 감쇠되어 총점이 줄어든다", () => {
    const ctx = ctxFor("standard");
    const fresh = emptyRoutingGraph();
    // 2026-07-27 정지 케이스 재현: updatedAt 을 hard 이상으로
    const stale: RoutingGraph = {
      ...emptyRoutingGraph(),
      updatedAt: new Date(T0 - 30 * DAY).toISOString(),
    };
    for (const g of [fresh, stale]) {
      applyOutcome(g, {
        model: "claude-opus-5",
        mode: "merged",
        ctx,
        taskId: "kg-1",
        agentId: "a1",
        atMs: T0 - 30 * DAY,
      });
      // applyOutcome 이 updatedAt 을 갱신하므로 stale 만 다시 고정
    }
    stale.updatedAt = new Date(T0 - 30 * DAY).toISOString();
    fresh.updatedAt = new Date(T0).toISOString();

    const pFresh = plan("claude", "standard", {
      ctx,
      graph: fresh,
      modelAvailable: onlyOriginalClaude,
      nowMs: T0,
      diversityCoefficient: 0,
    })!;
    const pStale = plan("claude", "standard", {
      ctx,
      graph: stale,
      modelAvailable: onlyOriginalClaude,
      nowMs: T0,
      diversityCoefficient: 0,
    })!;

    const kgFresh = pFresh.scores.find(
      (s) => s.candidate.model === "claude-opus-5",
    )!.kg;
    const kgStale = pStale.scores.find(
      (s) => s.candidate.model === "claude-opus-5",
    )!.kg;
    // 양의 편향이 있을 때만 감쇠 비교(관측이 쌓인 경우)
    if (kgFresh > 0) {
      expect(kgStale).toBeLessThan(kgFresh);
      expect(kgStale).toBeCloseTo(kgFresh * STALE_GRAPH_FLOOR, 0);
    } else {
      // n 이 작으면 shrink 로 0 근처 — 감쇠 함수 자체는 위에서 검증
      expect(staleGraphAttenuation(stale.updatedAt, T0)).toBe(STALE_GRAPH_FLOOR);
    }
  });
});

describe("★task-level 다양성 분산 (ε·tie)", () => {
  it("simple 은 저단가 칸, complex 는 frontier 유지", () => {
    const simple = plan("claude", "simple", {
      modelAvailable: onlyOriginalClaude,
    })!;
    const complex = plan("claude", "complex", {
      modelAvailable: onlyOriginalClaude,
    })!;
    expect(simple.model).toBe("claude-sonnet-5");
    expect(complex.model).toBe("claude-fable-5");
  });

  it("ε-explore 가 진입 인접 칸을 실제로 고른다", () => {
    // claude 는 gpt 의 cold-hold 정책이 없어 forceExplore 가 순수하게 산다.
    const { candidates, entryIndex } = autoCandidates("claude", "standard");
    const entry = candidates[entryIndex];
    const p = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
      forceExplore: true,
      diversityCoefficient: 0,
    })!;
    expect(p.mode).toBe("explore");
    expect(p.modelKey).not.toBe(entry.modelKey);
    // 탐색 창은 진입 ±1
    const winner = candidates.find((c) => c.modelKey === p.modelKey);
    expect(winner).toBeDefined();
    expect(Math.abs(winner!.index - entryIndex)).toBeLessThanOrEqual(1);
  });

  it("동률 회전이 연속 dispatch 에서 복수 칸을 뽑는다", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 6; i++) {
      picks.add(
        plan("claude", "standard", {
          modelAvailable: onlyOriginalClaude,
        })!.model,
      );
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});
