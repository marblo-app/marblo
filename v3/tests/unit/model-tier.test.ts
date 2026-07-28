/**
 * `src/lib/modelTier.ts` 회귀 가드 — 정보표 티어 파생.
 *
 * 이 모듈이 지켜야 할 약속은 넷이다:
 *   1. **하드코딩 목록이 없다** — 레지스트리에 없던 모양의 행을 넣어도 티어가
 *      붙는다(신규 모델 자동 반영).
 *   2. **한 행은 정확히 한 티어** — 묶음의 합이 입력과 1:1.
 *   3. **근거 없는 승격 금지** — 벤치 점수가 없으면 아무리 싸도 가성비가 아니다.
 *   4. **벤치를 벤치끼리 비교하지 않는다** — Verified 85 와 Pro 62 를 같은 자로
 *      재지 않는다(같은 벤치 최고점 대비 정규화).
 */

import { describe, expect, it } from "vitest";
import {
  groupModelsByTier,
  modelFleetStats,
  modelTierOf,
  withModelTiers,
  type ModelTierFacts,
} from "../../src/lib/modelTier";
import { modelFactSheetPayload } from "../../electron/model-fact-sheet";

/**
 * 실제 정보표 행 + **선택된 한 변형**의 벤치 칸(= 화면이 티어에 먹이는 것 그대로).
 *
 * ★변형을 고정해서 넣는 것이 이 하네스의 핵심이다. 예전엔 행마다 다른 변형이
 * 섞여 들어갔고, 그러면 가성비 판정의 분모(같은 벤치 최고점)가 행마다 다른
 * 시험의 최고점이 된다. 화면과 같은 방식(payload 의 기본 축)으로 고정한다.
 */
const payload = modelFactSheetPayload();
const factRows = payload.rows.map((row) => ({
  ...row,
  bench: row.benchByVariant[payload.defaultBenchmark].primary,
}));
const tierById = new Map(
  withModelTiers(factRows).map((a) => [a.row.modelId, a]),
);

function facts(
  capability: ModelTierFacts["capability"],
  outputPer1M: number,
  bench?: { benchmark: string; score: number | null },
): ModelTierFacts {
  return { capability, outputPer1M, bench: bench ?? null };
}

describe("modelTier / 파생 규칙", () => {
  it("capability 가 기본 티어를 정한다(frontier·top → 프리미어, cheap → 가성비)", () => {
    const rows = [
      facts("frontier", 50),
      facts("top", 25),
      facts("mid", 15),
      facts("cheap", 5),
    ];
    const stats = modelFleetStats(rows);
    expect(rows.map((r) => modelTierOf(r, stats).tier)).toEqual([
      "premier",
      "premier",
      "standard",
      "value",
    ]);
  });

  it("★싸다는 이유로 top/frontier 를 가성비로 내리지 않는다", () => {
    // 프리미어 묶음의 약속은 "최고 성능이 필요하면 여기서 고른다" 이다.
    // 싼 프리미어는 그냥 싼 프리미어지 다른 급이 아니다.
    const rows = [
      facts("top", 1, { benchmark: "b", score: 100 }), // 말도 안 되게 싸고 좋은 top
      facts("frontier", 1, { benchmark: "b", score: 100 }),
      facts("mid", 40, { benchmark: "b", score: 10 }),
    ];
    const stats = modelFleetStats(rows);
    expect(rows.map((r) => modelTierOf(r, stats).tier)).toEqual([
      "premier",
      "premier",
      "standard",
    ]);
  });

  it("mid 는 **싸고 효율 좋을 때만** 가성비로 올라간다(둘 중 하나만이면 안 올라간다)", () => {
    const rows = [
      facts("mid", 1, { benchmark: "b", score: 90 }), // 싸다 + 효율 좋다 → 승격
      facts("mid", 30, { benchmark: "b", score: 100 }), // 성능 최고지만 비싸다
      facts("mid", 2, { benchmark: "b", score: 5 }), // 싸지만 성능이 바닥
      facts("mid", 20, { benchmark: "b", score: 50 }),
    ];
    const stats = modelFleetStats(rows);
    const verdicts = rows.map((r) => modelTierOf(r, stats));
    expect(verdicts.map((v) => v.tier)).toEqual([
      "value",
      "standard",
      "standard",
      "standard",
    ]);
    expect(verdicts[0].reason).toBe("value-heuristic");
  });

  it("★점수가 없으면 아무리 싸도 승격하지 않는다(없는 근거로 딱지를 붙이지 않는다)", () => {
    const rows = [
      facts("mid", 0.1), // 벤치 행 자체가 없다
      facts("mid", 0.1, { benchmark: "b", score: null }), // 행은 있는데 공식 수치 없음
      facts("mid", 0.5, { benchmark: "b", score: 90 }),
      facts("mid", 30, { benchmark: "b", score: 60 }),
      facts("mid", 20, { benchmark: "b", score: 50 }),
    ];
    const stats = modelFleetStats(rows);
    const tiers = rows.map((r) => modelTierOf(r, stats).tier);
    expect(tiers[0]).toBe("standard");
    expect(tiers[1]).toBe("standard");
    expect(tiers[2]).toBe("value");
  });

  it("★서로 다른 벤치를 한 자로 재지 않는다(같은 벤치 최고점 대비 정규화)", () => {
    // Verified 85(최고 96) 와 Pro 62(최고 64) — raw 로 비교하면 Verified 쪽이
    // 압도적이지만, 정규화하면 Pro 쪽(0.97)이 오히려 높다.
    const verified = facts("mid", 10, {
      benchmark: "verified",
      score: 85,
    });
    const pro = facts("mid", 10, { benchmark: "pro", score: 62 });
    const rows = [
      verified,
      pro,
      facts("top", 25, { benchmark: "verified", score: 96 }),
      facts("top", 25, { benchmark: "pro", score: 64 }),
    ];
    const stats = modelFleetStats(rows);
    expect(stats.benchBest).toEqual({ verified: 96, pro: 64 });
    const rv = modelTierOf(verified, stats).valueRatio!;
    const rp = modelTierOf(pro, stats).valueRatio!;
    expect(rp).toBeGreaterThan(rv); // raw 였다면 반대로 나왔을 자리
  });

  it("단가가 0/미상이면 나누지 않는다(Infinity 승격 금지)", () => {
    const rows = [
      facts("mid", 0, { benchmark: "b", score: 90 }),
      facts("mid", 5, { benchmark: "b", score: 50 }),
    ];
    const stats = modelFleetStats(rows);
    const v = modelTierOf(rows[0], stats);
    expect(v.valueRatio).toBeNull();
    expect(v.tier).toBe("standard");
  });

  it("기준값은 묶음 중앙값에서 나온다(고정 임계값이 박혀 있지 않다)", () => {
    // 모든 단가를 10배로 올려도 서로의 상대는 그대로 → 티어도 그대로여야 한다.
    const base = [
      facts("mid", 1, { benchmark: "b", score: 90 }),
      facts("mid", 30, { benchmark: "b", score: 95 }),
      facts("mid", 20, { benchmark: "b", score: 40 }),
      facts("top", 25, { benchmark: "b", score: 100 }),
    ];
    const scaled = base.map((r) => ({ ...r, outputPer1M: r.outputPer1M * 10 }));
    expect(withModelTiers(scaled).map((a) => a.tier)).toEqual(
      withModelTiers(base).map((a) => a.tier),
    );
  });
});

describe("modelTier / 묶기", () => {
  it("한 행은 정확히 한 묶음에 들어간다", () => {
    const groups = groupModelsByTier(factRows);
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(factRows.length);
    const ids = groups.flatMap((g) => g.rows.map((a) => a.row.modelId));
    expect(new Set(ids).size).toBe(factRows.length);
  });

  it("빈 묶음은 내려보내지 않는다(헤더만 뜬 그룹 = 고장처럼 보인다)", () => {
    const groups = groupModelsByTier([facts("cheap", 1)]);
    expect(groups.map((g) => g.tier)).toEqual(["value"]);
  });

  it("묶음 순서는 프리미어 → 일반 → 가성비 고정이다", () => {
    const order = groupModelsByTier(factRows).map((g) => g.tier);
    expect(order).toEqual(
      ["premier", "standard", "value"].filter((t) =>
        order.includes(t as never),
      ),
    );
  });

  it("묶음 안의 행 순서는 입력 순서를 그대로 지킨다(벤더 묶음이 흩어지지 않게)", () => {
    for (const group of groupModelsByTier(factRows)) {
      const idx = group.rows.map((a) =>
        factRows.findIndex((r) => r.modelId === a.row.modelId),
      );
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
});

describe("modelTier / 실제 레지스트리 위에서", () => {
  it("모든 활성 모델이 티어를 받는다(누락 없음)", () => {
    expect(tierById.size).toBe(factRows.length);
    for (const [id, a] of tierById) {
      expect(["premier", "standard", "value"], id).toContain(a.tier);
    }
  });

  it("★레지스트리에 새 모델이 늘어도 자동으로 티어가 붙는다", () => {
    // 이 모듈이 모델 id 목록을 들고 있다면 이 행은 티어를 못 받는다.
    const unseen = {
      modelId: "brand-new-model-9",
      capability: "mid" as const,
      outputPer1M: 0.5,
      bench: { benchmark: "swe-bench-verified", score: 82 },
    };
    const assigned = withModelTiers([...factRows, unseen]);
    const row = assigned.find((a) => a.row.modelId === unseen.modelId);
    expect(row?.tier).toBe("value");
    expect(row?.reason).toBe("value-heuristic");
  });

  it("최고 성능 칸은 프리미어에 있다", () => {
    expect(tierById.get("claude-opus-5")?.tier).toBe("premier");
    expect(tierById.get("gpt-5.6-terra")?.tier).toBe("premier");
    expect(tierById.get("grok-4.5")?.tier).toBe("premier");
  });

  it("★비싼 최상급을 가성비로 부르지 않는다", () => {
    // fable5 는 $10/$50 로 표에서 가장 비싸다. capability 도 frontier 다.
    expect(tierById.get("claude-fable-5")?.tier).toBe("premier");
    expect(tierById.get("gpt-5.6-sol")?.tier).toBe("premier");
  });

  it("sonnet-5 는 일반작업이다(중간 등급 + 단가 효율이 중앙값 아래)", () => {
    expect(tierById.get("claude-sonnet-5")?.tier).toBe("standard");
  });

  it("cheap 등급은 언제나 가성비다", () => {
    expect(tierById.get("claude-haiku-4-5-20251001")?.tier).toBe("value");
    expect(tierById.get("gpt-5.4-mini")?.tier).toBe("value");
  });

  it("싸고 점수도 준수한 mid 는 heuristic 으로 가성비가 된다", () => {
    for (const id of ["MiniMax-M2.7", "gpt-5.6-luna"]) {
      const a = tierById.get(id);
      expect(a?.tier, id).toBe("value");
      expect(a?.reason, id).toBe("value-heuristic");
    }
  });

  it("★선택된 기준에 점수가 없으면 다른 변형의 점수를 빌려 승격하지 않는다", () => {
    // glm-4.7 은 $2.2 로 표에서 가장 싼 축이고 Verified 73.8 을 갖고 있다.
    // 하지만 기본 기준인 Pro 로는 Z.ai 가 이 모델의 수치를 낸 적이 없다
    // (5.2 세대부터 Pro 로 갈아탔다). 예전 구현은 여기서 Verified 로 fallback 해
    // 승격시켰는데, 그건 **다른 시험 점수로 이 기준의 성능을 주장**하는 것이다.
    // 지금은 근거 없음으로 취급해 capability 자리에 그대로 둔다(모듈 규율 3).
    const glm = tierById.get("glm-4.7");
    expect(glm?.row.bench).toBeNull();
    expect(glm?.valueRatio).toBeNull();
    expect(glm?.tier).toBe("standard");
    expect(glm?.reason).toBe("capability");
  });

  it("벤치 참조 행이 없는 mid 는 승격되지 않는다(단가만으로 판단하지 않는다)", () => {
    // kimi-for-coding 은 $0.95/$4.0 로 싸지만 공식 벤치 수치가 없다.
    const kfc = tierById.get("kimi-for-coding");
    expect(kfc?.row.bench?.score ?? null).toBeNull();
    expect(kfc?.tier).toBe("standard");
    expect(kfc?.valueRatio).toBeNull();
  });
});
