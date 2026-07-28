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
import {
  modelFactSheet,
  modelFactSheetPayload,
  pickBenchRecords,
} from "../../electron/model-fact-sheet";
import { MODEL_REGISTRY, getModel } from "../../electron/model-registry";
import { BENCHMARK_IDS } from "../../electron/model-bench-reference";

const rows = modelFactSheet();
const byId = new Map(rows.map((r) => [r.modelId, r]));

function expectBenchSource(source: string, modelId: string): void {
  if (source === "BenchLM (benchlm.ai/benchmarks/swePro)") return;
  expect(source, modelId).toMatch(/^https:\/\//);
}

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

describe("model-fact-sheet / 벤치 칸(변형 고정)", () => {
  it("★칸의 변형은 **요청한 변형**이다 — 다른 변형으로 새지 않는다", () => {
    // 이게 이 티켓이 고친 버그의 회귀 가드다. 예전엔 모델마다 "점수가 있는 첫
    // 변형" 을 골라서 Claude 칸엔 Verified, GPT 칸엔 Pro 가 들어갔다.
    for (const row of rows) {
      for (const id of BENCHMARK_IDS) {
        const cell = row.benchByVariant[id];
        expect(cell.benchmark, `${row.modelId}/${id}`).toBe(id);
        for (const alt of cell.alternates) {
          expect(alt.benchmark, `${row.modelId}/${id} alt`).toBe(id);
        }
        if (cell.primary) {
          expect(cell.primary.benchmark, `${row.modelId}/${id}`).toBe(id);
        }
      }
    }
  });

  it("★Verified 를 고르면 gpt 계열은 낮은 점수가 아니라 빈칸이다", () => {
    // OpenAI 는 Verified 를 공개하지 않는다(2026-07-28 실측: 공식 발표문에도,
    // swebench.com 리더보드에도 없다). 그 사실이 "64.6" 으로 둔갑하면 안 된다.
    const sol = byId.get("gpt-5.6-sol")!;
    expect(sol.benchByVariant["swe-bench-verified"].primary?.score).toBeNull();
    expect(sol.benchByVariant["swe-bench-verified"].primary?.note).toContain(
      "no official number",
    );
    // 같은 모델의 Pro 칸엔 값이 있다 — 빈 것은 모델이 아니라 그 **기준**이다.
    expect(sol.benchByVariant["swe-bench-pro"].primary?.score).toBe(64.6);
  });

  it("★Pro 기준에선 claude 와 gpt 가 같은 자로 재진다(96 vs 64.6 오독의 수리)", () => {
    const pro = (id: string) =>
      byId.get(id)?.benchByVariant["swe-bench-pro"].primary?.score ?? null;
    // 예전 표는 opus-5 96(Verified) 옆에 gpt-5.6-sol 64.6(Pro) 을 세웠다.
    // 같은 Pro 축에선 79.2 vs 64.6 — 차이가 32pt 가 아니라 14.6pt 다.
    expect(pro("claude-opus-5")).toBe(79.2);
    expect(pro("gpt-5.6-sol")).toBe(64.6);
    expect(
      byId.get("claude-opus-5")?.benchByVariant["swe-bench-verified"].primary
        ?.score,
    ).toBe(96.0);
  });

  it("빈 칸이 두 종류로 구분된다(행이 없다 vs 찾았는데 수치가 없다)", () => {
    // k3: Moonshot 이 SWE-bench 를 아예 안 쓴다 → 행은 있고 score 만 null.
    const k3 = byId.get("k3")!.benchByVariant["swe-bench-verified"];
    expect(k3.primary).not.toBeNull();
    expect(k3.primary?.score).toBeNull();
    expect(k3.primary?.note).toContain("no official number");
    expect(k3.primary?.source).toMatch(/^https:\/\//);

    // 같은 모델의 Multilingual: 참조 행 자체가 없다 → primary 가 null.
    expect(
      byId.get("k3")!.benchByVariant["swe-bench-multilingual"].primary,
    ).toBeNull();
  });

  it("★같은 변형의 다른 하네스 점수를 함께 내린다(순위 착시 방지)", () => {
    // haiku 4.5 는 벤더 스캐폴드 73.3 과 공식 리더보드 66.6 을 둘 다 갖는다.
    // 대표는 벤더 수치(열의 성격을 통일), 리더보드는 alternates 로 같이 보인다.
    const cell = byId.get("claude-haiku-4-5-20251001")!.benchByVariant[
      "swe-bench-verified"
    ];
    expect(cell.primary?.score).toBe(73.3);
    expect(cell.alternates.map((a) => a.score)).toEqual([66.6]);
    expect(cell.alternates[0]?.harness).toBe("mini-SWE-agent@2.0.0");
  });

  it("변형 라벨은 **대표 출처가 적은 표기** 그대로다(대조 가능해야 한다)", () => {
    // BenchLM 리더보드 행이 Pro 대표가 되므로 리더보드 표기를 따른다.
    expect(
      byId.get("gpt-5.6-sol")!.benchByVariant["swe-bench-pro"].variantLabel,
    ).toBe("SWE-bench Pro");
    expect(
      byId.get("MiniMax-M3")!.benchByVariant["swe-bench-pro"].variantLabel,
    ).toBe("SWE-bench Pro");
    // 표준 표기와 같은 출처는 표준 표기가 그대로 나온다.
    expect(
      byId.get("claude-opus-5")!.benchByVariant["swe-bench-pro"].variantLabel,
    ).toBe("SWE-bench Pro");
  });

  it("Grok 4.5 는 레지스트리 id 로 조회된다(참조행 → registry 행 전환)", () => {
    expect(
      byId.get("grok-4.5")?.benchByVariant["swe-bench-pro"].primary?.score,
    ).toBe(64.7);
  });

  it("점수가 있는 칸은 전부 출처·하네스·일자를 달고 있다", () => {
    for (const row of rows) {
      for (const id of BENCHMARK_IDS) {
        const b = row.benchByVariant[id].primary;
        if (!b || b.score === null) continue;
        expect(b.harness, row.modelId).toBeTruthy();
        expectBenchSource(b.source, row.modelId);
        expect(b.asOf, row.modelId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("model-fact-sheet / 기본 기준(변형) 파생", () => {
  const payload = modelFactSheetPayload();

  it("★기본 기준은 하드코딩이 아니라 커버리지 1위다", () => {
    const best = [...payload.variants].sort(
      (a, b) => b.scoredModels - a.scoredModels,
    )[0];
    expect(payload.defaultBenchmark).toBe(best.benchmark);
    expect(payload.variants[0].benchmark).toBe(payload.defaultBenchmark);
  });

  it("지금 데이터에선 Pro 가 1위다(claude·gpt·grok·glm·MiniMax 가 모두 있는 유일한 축)", () => {
    // 이 단언이 깨지면 벤더가 보고 벤치를 갈아탄 것이다 — 코드가 아니라 세상이
    // 바뀐 것이므로, 그때는 파생이 새 1위를 자동으로 집는지 확인하고 여기를 고친다.
    expect(payload.defaultBenchmark).toBe("swe-bench-pro");
    const pro = payload.variants.find((v) => v.benchmark === "swe-bench-pro")!;
    const verified = payload.variants.find(
      (v) => v.benchmark === "swe-bench-verified",
    )!;
    expect(pro.scoredModels).toBeGreaterThan(verified.scoredModels);
  });

  it("고를 수 있는 변형은 전부 최소 한 모델의 점수를 갖는다(빈 축을 못 고르게)", () => {
    for (const v of payload.variants) {
      expect(v.scoredModels, v.benchmark).toBeGreaterThan(0);
      expect(v.totalModels).toBe(payload.rows.length);
      expect(v.label, v.benchmark).toBeTruthy();
      expect(v.short, v.benchmark).toBeTruthy();
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

/**
 * ★티어용 **대표 벤치** — 표 셀과 갈라 둔 필드.
 *
 * 티어(프리미어/일반/가성비)는 모델 고유 속성이라 사용자가 벤치 탭을 토글해도
 * 안 바뀌어야 하고, 오케(`get_model_guidance`)가 듣는 판정과도 같아야 한다.
 * 그래서 대표는 **변형 선택과 무관**하게 `pickBenchRecords` 한 곳에서만 나온다.
 */
describe("model-fact-sheet / 대표 벤치(티어용)", () => {
  it("모든 행이 대표 칸을 들고 있다(pickBenchRecords 와 같은 행)", () => {
    for (const row of rows) {
      const { representative } = pickBenchRecords(row.modelId);
      if (!representative) {
        expect(row.representativeBench, row.modelId).toBeNull();
        continue;
      }
      expect(row.representativeBench?.benchmark, row.modelId).toBe(
        representative.benchmark,
      );
      expect(row.representativeBench?.score, row.modelId).toBe(
        representative.score,
      );
      expect(row.representativeBench?.source, row.modelId).toBe(
        representative.source,
      );
    }
  });

  it("★대표는 변형 선택과 무관하다(벤치 탭을 바꿔도 티어 입력이 안 흔들린다)", () => {
    // 표 셀은 변형마다 다르지만(그게 규율), 대표는 같은 행에 하나뿐이다.
    // fable-5 가 이 티켓의 실증 사례다: Verified 칸은 비어 있고 Pro 에만 점수가
    // 있어서, 선택된 변형을 티어에 먹이면 Verified 탭에서 근거가 사라졌다.
    const fable = byId.get("claude-fable-5");
    expect(fable, "claude-fable-5 행이 표에 있어야 한다").toBeTruthy();
    expect(fable!.representativeBench?.score).not.toBeNull();
    // 두 번 호출해도 같은 값(순수) — 변형 상태가 끼어들 자리가 없다.
    const again = new Map(
      modelFactSheet().map((r) => [r.modelId, r.representativeBench]),
    );
    for (const row of rows) {
      expect(again.get(row.modelId), row.modelId).toEqual(
        row.representativeBench,
      );
    }
  });

  it("점수가 없으면 지어내지 않는다(대표도 null 이거나 score:null 이다)", () => {
    for (const row of rows) {
      const b = row.representativeBench;
      if (!b || b.score === null) continue;
      expectBenchSource(b.source, row.modelId);
      expect(b.asOf, row.modelId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
