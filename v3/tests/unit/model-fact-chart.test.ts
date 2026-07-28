/**
 * `src/lib/modelFactChart.ts` 회귀 가드 — 정보표 막대차트의 계산.
 *
 * 표는 숫자를 그대로 적으므로 읽는 사람이 조건을 따질 수 있지만, 막대는 **길이가
 * 곧 주장**이라 그럴 틈을 주지 않는다. 그래서 차트 쪽 약속이 표보다 엄격하다:
 *   1. **한 축에 한 변형만** — 요청한 변형의 칸만 읽고 다른 변형으로 새지 않는다.
 *   2. **빈 칸은 길이 0 이 아니다** — 공식 수치가 없으면 막대를 안 그린다.
 *   3. **축이 데이터를 왜곡하지 않는다** — 벤치 축은 0..100 고정, 단가 축은
 *      input/output 둘 다 담는 "읽히는" 상한.
 */

import { describe, expect, it } from "vitest";
import {
  axisTicks,
  barPercent,
  chartRows,
  niceCeil,
  priceAxisMax,
  BENCH_AXIS_MAX,
} from "../../src/lib/modelFactChart";
import { modelFactSheetPayload } from "../../electron/model-fact-sheet";

const payload = modelFactSheetPayload();
const rows = payload.rows as unknown as ModelFactRow[];

describe("modelFactChart / 변형 고정", () => {
  it("요청한 변형의 점수만 싣는다(다른 변형으로 fallback 하지 않는다)", () => {
    const pro = chartRows(rows, "swe-bench-pro");
    const verified = chartRows(rows, "swe-bench-verified");
    const proById = new Map(pro.map((r) => [r.modelId, r]));
    const verById = new Map(verified.map((r) => [r.modelId, r]));

    // opus-5 는 두 변형에 다 값이 있고 **서로 다른 수**다.
    expect(proById.get("claude-opus-5")?.score).toBe(79.2);
    expect(verById.get("claude-opus-5")?.score).toBe(96.0);

    // gpt-5.6-sol 은 Pro 에만 있다 — Verified 를 고르면 빌려오지 않고 빈다.
    expect(proById.get("gpt-5.6-sol")?.score).toBe(64.6);
    expect(verById.get("gpt-5.6-sol")?.score).toBeNull();

    // glm-4.7 은 반대 모양(Verified 만) — 역방향으로도 안 샌다.
    expect(verById.get("glm-4.7")?.score).toBe(73.8);
    expect(proById.get("glm-4.7")?.score).toBeNull();
  });

  it("모든 모델이 한 줄씩 나온다(점수 없다고 빠지지 않는다)", () => {
    // 빠뜨리면 "이 모델은 존재하지 않는다" 로 읽힌다. 빈 채로 남아야 한다.
    expect(chartRows(rows, "swe-bench-pro")).toHaveLength(rows.length);
    expect(chartRows(rows, "swe-bench-multimodal")).toHaveLength(rows.length);
  });

  it("정렬은 점수 내림차순이고 점수 없는 모델은 뒤로 간다", () => {
    const out = chartRows(rows, "swe-bench-pro");
    const scored = out.filter((r) => r.score !== null);
    const unscored = out.filter((r) => r.score === null);

    // 점수 있는 행이 전부 앞에 몰려 있다.
    expect(out.slice(0, scored.length).every((r) => r.score !== null)).toBe(
      true,
    );
    expect(unscored.length).toBe(out.length - scored.length);

    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].score!).toBeGreaterThanOrEqual(scored[i].score!);
    }
  });

  it("점수 없는 행끼리는 입력 순서(벤더 묶음)를 유지한다", () => {
    const out = chartRows(rows, "swe-bench-pro");
    const order = new Map(rows.map((r, i) => [r.modelId, i]));
    const unscoredIdx = out
      .filter((r) => r.score === null)
      .map((r) => order.get(r.modelId)!);
    expect([...unscoredIdx].sort((a, b) => a - b)).toEqual(unscoredIdx);
  });

  it("단가는 레지스트리 값 그대로 실린다(차트가 자기 단가표를 갖지 않는다)", () => {
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    for (const r of chartRows(rows, "swe-bench-pro")) {
      expect(r.inputPer1M, r.modelId).toBe(byId.get(r.modelId)!.inputPer1M);
      expect(r.outputPer1M, r.modelId).toBe(byId.get(r.modelId)!.outputPer1M);
    }
  });
});

describe("modelFactChart / 축", () => {
  it("벤치 축은 0..100 고정이다(최고점에 맞춰 좁히지 않는다)", () => {
    expect(BENCH_AXIS_MAX).toBe(100);
    // 최고점이 80 이어도 막대는 80% 까지만 찬다 — 만점처럼 보이지 않는다.
    expect(barPercent(80, BENCH_AXIS_MAX)).toBe(80);
  });

  it("niceCeil 은 눈금이 읽히는 수로 올린다", () => {
    expect(niceCeil(50)).toBe(50);
    expect(niceCeil(37.5)).toBe(50);
    expect(niceCeil(21)).toBe(25);
    expect(niceCeil(4.4)).toBe(5);
    expect(niceCeil(0.9)).toBe(1);
    // 언제나 실제 최댓값 이상이어야 막대가 안 잘린다.
    for (const v of [0.3, 1.2, 6, 13, 47, 99, 260]) {
      expect(niceCeil(v), `${v}`).toBeGreaterThanOrEqual(v);
    }
  });

  it("단가 축 상한은 input 과 output 을 **둘 다** 담는다", () => {
    const inputHeavy = [
      {
        modelId: "x",
        label: "x",
        vendor: "v",
        vendorLabel: "V",
        inputPer1M: 90,
        outputPer1M: 5,
        estimatedPricing: false,
        score: null,
        harness: null,
        note: null,
      },
    ];
    expect(priceAxisMax(inputHeavy)).toBeGreaterThanOrEqual(90);
  });

  it("실제 레지스트리에서 어떤 막대도 축 밖으로 안 나간다", () => {
    const data = chartRows(rows, "swe-bench-pro");
    const max = priceAxisMax(data);
    for (const r of data) {
      expect(barPercent(r.inputPer1M, max), r.modelId).toBeLessThanOrEqual(100);
      expect(barPercent(r.outputPer1M, max), r.modelId).toBeLessThanOrEqual(
        100,
      );
    }
  });

  it("눈금은 0 에서 시작해 상한에서 끝난다(격자선과 같은 배열)", () => {
    expect(axisTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(50)[0]).toBe(0);
    expect(axisTicks(50).at(-1)).toBe(50);
  });

  it("★이상한 값이 들어와도 막대가 칸을 넘지 않는다", () => {
    expect(barPercent(-5, 100)).toBe(0);
    expect(barPercent(500, 100)).toBe(100);
    expect(barPercent(Number.NaN, 100)).toBe(0);
    expect(barPercent(10, 0)).toBe(0);
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(Number.NaN)).toBe(1);
  });
});
