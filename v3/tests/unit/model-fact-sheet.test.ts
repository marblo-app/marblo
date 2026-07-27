/**
 * `electron/model-fact-sheet.ts` 회귀 가드 — 사용량 탭 정보표의 조인.
 *
 * 이 모듈이 지켜야 할 약속은 셋이다:
 *   1. **사실을 새로 만들지 않는다** — 단가는 레지스트리 값 **그대로**여야 한다.
 *      (표가 자기만의 단가표를 갖는 순간 PR#596 이 고친 이중소스가 되살아난다.)
 *   2. **레지스트리가 늘면 표도 는다** — 행 수가 활성 모델 수와 같아야 한다.
 *   3. **없는 숫자를 지어내지 않는다** — 참조표에 짝이 없으면 null 로 내려간다.
 */

import { describe, expect, it } from "vitest";
import { modelFactSheet } from "../../electron/model-fact-sheet";
import { MODEL_REGISTRY, getModel } from "../../electron/model-registry";

const rows = modelFactSheet();
const byId = new Map(rows.map((r) => [r.modelId, r]));

describe("model-fact-sheet / 단일소스", () => {
  it("활성 레지스트리 모델과 1:1 이다(deprecated 는 뺀다)", () => {
    const active = MODEL_REGISTRY.filter((m) => m.status === "active").map(
      (m) => m.id,
    );
    expect(rows.map((r) => r.modelId).sort()).toEqual([...active].sort());
  });

  it("단가는 레지스트리 값 그대로다(표가 자기 단가표를 갖지 않는다)", () => {
    for (const row of rows) {
      const entry = getModel(row.modelId);
      expect(row.inputPer1M, row.modelId).toBe(entry?.pricing.inputPer1M);
      expect(row.outputPer1M, row.modelId).toBe(entry?.pricing.outputPer1M);
      expect(row.estimatedPricing, row.modelId).toBe(
        Boolean(entry?.pricing.estimated),
      );
    }
  });

  it("추정 단가 행에만 estimated 가 선다", () => {
    // grok/glm/MiniMax/kimi 는 정액 경로라 상한 추정, claude/gpt 는 확정 단가.
    expect(byId.get("claude-opus-5")?.estimatedPricing).toBe(false);
    expect(byId.get("gpt-5.4")?.estimatedPricing).toBe(false);
    expect(byId.get("glm-5.2")?.estimatedPricing).toBe(true);
    expect(byId.get("k3")?.estimatedPricing).toBe(true);
  });

  it("벤더/하네스 축이 레지스트리와 같다(같은 claude 바이너리라도 벤더는 다르다)", () => {
    const glm = byId.get("glm-4.7");
    expect(glm?.harness).toBe("claude");
    expect(glm?.vendor).toBe("zai");
    expect(glm?.vendorLabel).toBe("Z.ai GLM");
  });
});

describe("model-fact-sheet / 컨텍스트 칸", () => {
  it("모든 행에 출처가 붙은 컨텍스트가 있다", () => {
    for (const row of rows) {
      expect(row.context, row.modelId).not.toBeNull();
      expect(row.context?.source, row.modelId).toMatch(/^https:\/\//);
      expect(row.context?.asOf, row.modelId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("1,050,000 을 1M 으로 접지 않는다", () => {
    expect(byId.get("gpt-5.6-sol")?.context?.tokens).toBe(1_050_000);
  });
});

describe("model-fact-sheet / 벤치 칸", () => {
  it("Verified 가 있으면 Verified 를 대표로 잡는다", () => {
    const opus5 = byId.get("claude-opus-5")?.bench;
    expect(opus5?.benchmark).toBe("swe-bench-verified");
    expect(opus5?.score).toBe(96.0);
    expect(opus5?.source).toMatch(/^https:\/\//);
  });

  it("Verified 가 비어 있으면 Pro 로 내려간다(빈 칸을 0 으로 만들지 않는다)", () => {
    // OpenAI 는 Verified 를 공개하지 않는다 — 그래서 gpt 행의 대표는 Pro 다.
    const sol = byId.get("gpt-5.6-sol")?.bench;
    expect(sol?.benchmark).toBe("swe-bench-pro");
    expect(sol?.score).toBe(64.6);

    // GLM-5.2 도 같은 모양(벤더가 Verified 를 안 싣는다).
    expect(byId.get("glm-5.2")?.bench?.benchmark).toBe("swe-bench-pro");
    expect(byId.get("glm-5.2")?.bench?.score).toBe(62.1);
  });

  it("점수가 하나도 없으면 **왜 비었는지**를 나르는 빈 행을 대표로 둔다", () => {
    const k3 = byId.get("k3")?.bench;
    expect(k3?.score).toBeNull();
    expect(k3?.note).toContain("no official number");
    expect(k3?.source).toMatch(/^https:\/\//);

    const kfc = byId.get("kimi-for-coding")?.bench;
    expect(kfc?.score).toBeNull();
    expect(kfc?.note).toContain("no official number");
  });

  it("★같은 벤치의 다른 하네스 점수를 함께 내린다(순위 착시 방지)", () => {
    // haiku 4.5 는 벤더 스캐폴드 73.3 과 공식 리더보드 66.6 을 둘 다 갖는다.
    // 대표는 벤더 수치(열의 성격을 통일), 리더보드는 alternates 로 같이 보인다.
    const haiku = byId.get("claude-haiku-4-5-20251001");
    expect(haiku?.bench?.score).toBe(73.3);
    expect(haiku?.benchAlternates.map((a) => a.score)).toEqual([66.6]);
    expect(haiku?.benchAlternates[0]?.harness).toBe("mini-SWE-agent@2.0.0");
  });

  it("alternates 는 **같은 벤치**끼리만 묶인다(Verified 와 Pro 를 섞지 않는다)", () => {
    for (const row of rows) {
      for (const alt of row.benchAlternates) {
        expect(alt.benchmark, row.modelId).toBe(row.bench?.benchmark);
      }
    }
  });

  it("Grok 4.5 는 레지스트리 id 로 조회된다(참조행 → registry 행 전환)", () => {
    const grok = byId.get("grok-4.5")?.bench;
    expect(grok?.benchmark).toBe("swe-bench-pro");
    expect(grok?.score).toBe(64.7);
  });

  it("점수가 있는 칸은 전부 출처·하네스·일자를 달고 있다", () => {
    for (const row of rows) {
      const b = row.bench;
      if (!b || b.score === null) continue;
      expect(b.harness, row.modelId).toBeTruthy();
      expect(b.source, row.modelId).toMatch(/^https:\/\//);
      expect(b.asOf, row.modelId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("model-fact-sheet / 정렬", () => {
  it("벤더 묶음이 흩어지지 않는다", () => {
    const seen = new Set<string>();
    let prev = "";
    for (const row of rows) {
      if (row.vendor !== prev) {
        expect(
          seen.has(row.vendor),
          `${row.vendor} 그룹이 두 번 나타난다`,
        ).toBe(false);
        seen.add(row.vendor);
        prev = row.vendor;
      }
    }
  });

  it("벤더 안에서는 능력등급 높은 순이다", () => {
    const order = { frontier: 0, top: 1, mid: 2, cheap: 3 } as const;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].vendor !== rows[i - 1].vendor) continue;
      expect(order[rows[i].capability]).toBeGreaterThanOrEqual(
        order[rows[i - 1].capability],
      );
    }
  });
});
