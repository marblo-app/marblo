/**
 * P2-4 — 모델별 효과집계(`mcp-server/routing-effectiveness.ts`).
 *
 * 이 테스트가 지키는 것은 숫자 하나하나가 아니라 **"없는 걸 만들지 않는다"** 는
 * 규율이다: 진행중 티켓을 실패로 세지 않고, 비용 미측정을 0원으로 세지 않고,
 * 프로바이더 해상도 행을 model@effort 행과 섞지 않고, 0 나눗셈을 ∞ 로 만들지 않는다.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateEffectiveness,
  formatEffectivenessReport,
  type EffectivenessInputRow,
} from "../../electron/mcp-server/routing-effectiveness";

function row(over: Partial<EffectivenessInputRow> = {}): EffectivenessInputRow {
  return {
    taskId: "T",
    status: "DONE",
    spawnedModelKey: "gpt-5.5@medium",
    provider: "gpt",
    complexity: "standard",
    taskType: "feature",
    costTotal: 1,
    ...over,
  };
}

describe("aggregateEffectiveness — 그룹핑", () => {
  it("(model@effort × 난도 × taskType) 삼중키로 묶는다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a" }),
      row({ taskId: "b" }),
      row({ taskId: "c", complexity: "simple" }),
      row({ taskId: "d", taskType: "bug-fix" }),
      row({ taskId: "e", spawnedModelKey: "gpt-5.5@low" }),
    ]);
    expect(r.cells).toHaveLength(4);
    const top = r.cells[0];
    expect(top).toMatchObject({
      modelKey: "gpt-5.5@medium",
      complexity: "standard",
      taskType: "feature",
      n: 2,
    });
  });

  it("성공/실패 라벨은 터미널 상태에서만 파생된다(DONE=성공, FAILED/BLOCKED=실패)", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", status: "DONE" }),
      row({ taskId: "b", status: "FAILED" }),
      row({ taskId: "c", status: "BLOCKED" }),
    ]);
    expect(r.cells[0]).toMatchObject({ n: 3, successes: 1, failures: 2 });
    expect(r.cells[0].successRate).toBeCloseTo(1 / 3, 10);
  });

  it("★진행중 티켓은 실패가 아니라 제외 — 그 수를 보고한다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", status: "IN_PROGRESS" }),
      row({ taskId: "b", status: "REVIEW" }),
      row({ taskId: "c", status: "DONE" }),
    ]);
    expect(r.skipped.nonTerminal).toBe(2);
    expect(r.totals.counted).toBe(1);
    expect(r.cells[0].n).toBe(1);
  });

  it("★모델 축이 없는 티켓은 제외 + 카운트(조용히 사라지지 않는다)", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", spawnedModelKey: null, provider: null }),
      row({ taskId: "b", spawnedModelKey: null, provider: "  " }),
      row({ taskId: "c" }),
    ]);
    expect(r.skipped.noModel).toBe(2);
    expect(r.cells).toHaveLength(1);
  });

  it("null 축은 '-' 로 라벨링돼 실제 값과 섞이지 않는다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", taskType: null, complexity: null }),
    ]);
    expect(r.cells[0]).toMatchObject({ taskType: "-", complexity: "-" });
  });

  it("대소문자 차이로 칸이 쪼개지지 않는다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", spawnedModelKey: "GPT-5.5@Medium" }),
      row({ taskId: "b", spawnedModelKey: "gpt-5.5@medium" }),
    ]);
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0].n).toBe(2);
  });
});

describe("aggregateEffectiveness — 해상도", () => {
  it("★spawnedModelKey 가 없으면 provider 해상도로 표시된다(섞지 않는다)", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", spawnedModelKey: null }),
      row({ taskId: "b" }),
    ]);
    const byKey = new Map(r.cells.map((c) => [c.modelKey, c]));
    expect(byKey.get("gpt")?.resolution).toBe("provider");
    expect(byKey.get("gpt-5.5@medium")?.resolution).toBe("model@effort");
    // 두 칸이며, provider 칸이 변종 칸에 합산되지 않는다.
    expect(r.cells).toHaveLength(2);
  });
});

describe("aggregateEffectiveness — 비용", () => {
  it("비용 미측정 행은 분모에서 빠지고 커버리지로 보고된다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", costTotal: 2 }),
      row({ taskId: "b", costTotal: null }),
      row({ taskId: "c", costTotal: 4 }),
      row({ taskId: "d", costTotal: undefined }),
    ]);
    const c = r.cells[0];
    expect(c.n).toBe(4);
    expect(c.costedN).toBe(2);
    expect(c.costTotal).toBe(6);
    expect(c.avgCost).toBe(3); // 6/2 — 미측정 2건을 0원으로 세지 않는다
    expect(c.costCoverage).toBe(0.5);
  });

  it("비정상 비용값(NaN/Infinity/음수)은 미측정으로 취급한다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", costTotal: Number.NaN }),
      row({ taskId: "b", costTotal: Number.POSITIVE_INFINITY }),
      row({ taskId: "c", costTotal: -5 }),
    ]);
    expect(r.cells[0].costedN).toBe(0);
    expect(r.cells[0].avgCost).toBeNull();
    expect(r.cells[0].successPerDollar).toBeNull();
  });

  it("★비용당성공의 분자는 비용측정 부분집합의 성공 수다", () => {
    const r = aggregateEffectiveness([
      // 비용 측정된 성공 1건($2) + 비용 미측정 성공 3건.
      row({ taskId: "a", status: "DONE", costTotal: 2 }),
      row({ taskId: "b", status: "DONE", costTotal: null }),
      row({ taskId: "c", status: "DONE", costTotal: null }),
      row({ taskId: "d", status: "DONE", costTotal: null }),
    ]);
    const c = r.cells[0];
    expect(c.costedSuccesses).toBe(1);
    // 전체 성공 4를 $2 로 나누면 2.0/$ 로 과대평가된다. 0.5/$ 가 정직한 값이다.
    expect(c.successPerDollar).toBe(0.5);
  });

  it("비용 합이 0 이면 비용당성공은 null(∞ 아님)", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", status: "DONE", costTotal: 0 }),
    ]);
    expect(r.cells[0].costedN).toBe(1);
    expect(r.cells[0].avgCost).toBe(0);
    expect(r.cells[0].successPerDollar).toBeNull();
  });
});

describe("aggregateEffectiveness — 결정성 / 총계", () => {
  it("입력 순서가 달라도 같은 리포트가 나온다", () => {
    const rows = [
      row({ taskId: "a" }),
      row({ taskId: "b", complexity: "simple" }),
      row({
        taskId: "c",
        spawnedModelKey: "claude-opus-5",
        provider: "claude",
      }),
    ];
    const a = aggregateEffectiveness(rows);
    const b = aggregateEffectiveness([...rows].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("총계가 칸 합과 일치한다", () => {
    const r = aggregateEffectiveness([
      row({ taskId: "a", status: "DONE", costTotal: 1 }),
      row({ taskId: "b", status: "FAILED", costTotal: 2 }),
      row({ taskId: "c", status: "TODO" }),
    ]);
    expect(r.totals).toMatchObject({
      rows: 3,
      counted: 2,
      successes: 1,
      failures: 1,
      costedN: 2,
      costTotal: 3,
    });
    expect(r.cells.reduce((s, c) => s + c.n, 0)).toBe(r.totals.counted);
  });

  it("빈 입력은 빈 리포트(0 이 아니라 '칸 없음')", () => {
    const r = aggregateEffectiveness([]);
    expect(r.cells).toEqual([]);
    expect(formatEffectivenessReport(r)).toContain("칸이 없다");
  });
});

describe("formatEffectivenessReport", () => {
  it("상한에 걸리면 '더 오래된 티켓은 없다' 를 명시한다(조용한 절단 금지)", () => {
    const r = aggregateEffectiveness([row()]);
    const out = formatEffectivenessReport(r, { scanned: 500, cap: 500 });
    expect(out).toContain("상한 500");
  });

  it("미측정 비용을 0 으로 인쇄하지 않는다", () => {
    const r = aggregateEffectiveness([row({ costTotal: null })]);
    const out = formatEffectivenessReport(r, { scanned: 1, cap: 500 });
    expect(out).toContain("미측정");
    expect(out).not.toContain("$0.0000");
  });

  it("해상도·커버리지 읽는 법을 리포트가 스스로 설명한다", () => {
    const out = formatEffectivenessReport(aggregateEffectiveness([row()]), {
      scanned: 1,
      cap: 500,
    });
    expect(out).toContain("model@effort");
    expect(out).toContain("비용커버리지");
    expect(out).toContain("판정");
  });
});
