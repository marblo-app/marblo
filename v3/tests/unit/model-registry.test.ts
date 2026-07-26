import { describe, it, expect } from "vitest";
import {
  EFFORT_LADDER,
  MODEL_REGISTRY,
  cmpSemver,
  estimatedPricingModelIds,
  getModel,
  isKnownModelId,
  isModelAlias,
  meetsMinCli,
  modelsByHarness,
  registryPricing,
  resolveModelAlias,
  supportsEffort,
} from "../../electron/model-registry";
import { perTokenRateFor } from "../../electron/cost-tracker";

// 벤더중립 모델 레지스트리(라우팅 P1-2/P1-3). 두 가지를 지킨다:
//   1. 레지스트리가 v3/docs/INTELLIGENT-ROUTING-PLAN.md §1 의 CLI 프로브 결과를
//      그대로 재현한다(그 표를 fixture 로 고정 — 설계문서 §2 검증법).
//   2. 그 사실이 cost-tracker 단가표까지 실제로 흘러간다(P1-3 수리 증명).
describe("model-registry", () => {
  describe("구조 불변식", () => {
    it("id 와 alias 는 레지스트리 전체에서 유일하고 서로 겹치지 않는다", () => {
      const ids = MODEL_REGISTRY.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);

      const aliases = MODEL_REGISTRY.flatMap((m) => m.aliases);
      expect(new Set(aliases).size).toBe(aliases.length);

      // alias 가 다른 모델의 구체 id 와 같으면 조회가 모호해진다.
      for (const alias of aliases) expect(ids).not.toContain(alias);
    });

    it("모든 항목이 검증 이력과 양수 단가를 갖는다", () => {
      for (const m of MODEL_REGISTRY) {
        expect(m.verified.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(m.verified.cli).not.toBe("");
        expect(m.verified.method).not.toBe("");
        expect(m.pricing.inputPer1M).toBeGreaterThan(0);
        expect(m.pricing.outputPer1M).toBeGreaterThan(0);
      }
    });

    it("effort 는 사다리에 있는 값만 쓰고, defaultEffort 는 지원목록 안에 있다", () => {
      for (const m of MODEL_REGISTRY) {
        for (const e of m.efforts) expect(EFFORT_LADDER).toContain(e);
        if (m.defaultEffort) expect(m.efforts).toContain(m.defaultEffort);
        // claude 는 effort 축이 없다 → 기본 effort 도 없어야 한다.
        if (m.harness === "claude") {
          expect(m.efforts).toEqual([]);
          expect(m.defaultEffort).toBeUndefined();
        }
      }
    });
  });

  // ── §1.1 CLI 프로브 표를 fixture 로 고정 ────────────────────────────
  //   입력 alias → 실제 서빙 모델 (claude CLI 2.1.220, 2026-07-25)
  describe("alias 해석 (설계문서 §1.1 실측표)", () => {
    const PROBE_TABLE: Array<[string, string]> = [
      ["fable", "claude-fable-5"],
      ["opus", "claude-opus-5"], // ★4-8 이 아니다 — 이 사실이 §1.3-① 결함의 원인
      ["sonnet", "claude-sonnet-5"],
      ["haiku", "claude-haiku-4-5-20251001"],
    ];

    it.each(PROBE_TABLE)("alias %s → %s", (alias, id) => {
      expect(resolveModelAlias(alias)).toBe(id);
      expect(getModel(alias)?.id).toBe(id);
    });

    it("대소문자·공백 무관", () => {
      expect(resolveModelAlias("  OPUS ")).toBe("claude-opus-5");
      expect(getModel("Claude-Opus-5")?.id).toBe("claude-opus-5");
    });

    it("미지 문자열은 삼키지 않고 그대로 돌려준다(폴백 판단은 호출자 몫)", () => {
      expect(getModel("claude-megatron-9")).toBeUndefined();
      expect(resolveModelAlias("claude-megatron-9")).toBe("claude-megatron-9");
    });

    it("isKnownModelId / isModelAlias 가 구체 id 와 alias 를 갈라준다", () => {
      expect(isKnownModelId("claude-opus-5")).toBe(true);
      expect(isKnownModelId("opus")).toBe(false); // alias 는 구체 id 가 아니다
      expect(isModelAlias("opus")).toBe(true);
      expect(isModelAlias("claude-opus-5")).toBe(false);
      expect(isModelAlias("claude-megatron-9")).toBe(false);
    });
  });

  // ── §1.2 codex models_cache 표 ──────────────────────────────────────
  describe("codex effort 축 (설계문서 §1.2 실측표)", () => {
    it("5.6 계열만 max/ultra 를 갖고, luna 는 ultra 가 없다", () => {
      expect(supportsEffort("gpt-5.6-sol", "ultra")).toBe(true);
      expect(supportsEffort("gpt-5.6-terra", "ultra")).toBe(true);
      expect(supportsEffort("gpt-5.6-luna", "max")).toBe(true);
      expect(supportsEffort("gpt-5.6-luna", "ultra")).toBe(false);
      // 5.5 이하는 xhigh 까지.
      expect(supportsEffort("gpt-5.5", "xhigh")).toBe(true);
      expect(supportsEffort("gpt-5.5", "max")).toBe(false);
    });

    it("기본 effort — sol=low, terra/luna/5.5=medium", () => {
      expect(getModel("gpt-5.6-sol")?.defaultEffort).toBe("low");
      expect(getModel("gpt-5.6-terra")?.defaultEffort).toBe("medium");
      expect(getModel("gpt-5.6-luna")?.defaultEffort).toBe("medium");
      expect(getModel("gpt-5.5")?.defaultEffort).toBe("medium");
    });

    it("claude 는 effort 축이 없다(비대칭이 명시적으로 표현됨)", () => {
      expect(supportsEffort("claude-opus-5", "high")).toBe(false);
    });
  });

  // ── minCli 게이트 ───────────────────────────────────────────────────
  describe("meetsMinCli", () => {
    it("minCli 미달이면 false, 충족/상회면 true", () => {
      expect(meetsMinCli("claude-fable-5", "2.1.163")).toBe(false);
      expect(meetsMinCli("claude-fable-5", "2.1.170")).toBe(true);
      expect(meetsMinCli("claude-fable-5", "2.2.0")).toBe(true);
    });
    it("버전 감지 실패(빈 문자열)는 미검증 취급 → false", () => {
      expect(meetsMinCli("claude-fable-5", "")).toBe(false);
    });
    it("minCli 없는 항목은 게이트 없음", () => {
      expect(getModel("gpt-5.5")?.minCli).toBeUndefined();
      expect(meetsMinCli("gpt-5.5", "")).toBe(true);
    });
    it("override 가 항목 값을 이긴다(MARBLO_FABLE5_MIN_CLI 경로)", () => {
      expect(meetsMinCli("claude-fable-5", "2.1.163", "2.1.160")).toBe(true);
    });
    it("cmpSemver: 누락/파싱불가 파트는 0 취급", () => {
      expect(cmpSemver("2.1", "2.1.0")).toBe(0);
      expect(cmpSemver("x.y.z", "0.0.0")).toBe(0);
      expect(cmpSemver("2.2.0", "2.1.999")).toBeGreaterThan(0);
    });
  });

  describe("modelsByHarness", () => {
    it("능력등급 오름차순(cheap → frontier)으로 준다", () => {
      // 사전순이 아니라 등급 랭크순이어야 한다(에스컬레이션 사다리의 재료).
      const RANK = { cheap: 0, mid: 1, top: 2, frontier: 3 } as const;
      const ranks = modelsByHarness("claude").map((m) => RANK[m.capability]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(modelsByHarness("claude")[0].capability).toBe("cheap");
      expect(modelsByHarness("claude").at(-1)?.capability).toBe("frontier");
    });
    it("아직 CLI-verified 모델이 없는 하네스는 빈 배열(에러 아님)", () => {
      expect(modelsByHarness("antigravity")).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★P1-3 단가 수리 증명. 이 블록이 "비용 축이 틀려 있으면 어떤 라우팅 학습도
// 잘못된 결론으로 수렴한다"(설계문서 §1.3-③)를 막는 회귀 가드다.
// ─────────────────────────────────────────────────────────────────────────
describe("MODEL_PRICING 실단가 (P1-3)", () => {
  const DEFAULT_RATE = { inputPer1M: 3, outputPer1M: 15 }; // 폴백 sentinel

  it("★Fable5 가 더 이상 default($3/$15)로 안 잡힌다 — 출력 3.3배 과소보고 수리", () => {
    const r = perTokenRateFor("claude-fable-5");
    expect(r).toEqual({ inputPer1M: 10, outputPer1M: 50 });
    expect(r.outputPer1M / DEFAULT_RATE.outputPer1M).toBeCloseTo(3.333, 2);
  });

  it("★Opus 급이 더 이상 Sonnet 단가로 안 잡힌다", () => {
    expect(perTokenRateFor("claude-opus-5")).toEqual({
      inputPer1M: 5,
      outputPer1M: 25,
    });
    // Opus 4.8 = Opus 5 동일 단가.
    expect(perTokenRateFor("claude-opus-4-8")).toEqual({
      inputPer1M: 5,
      outputPer1M: 25,
    });
    for (const id of ["claude-opus-5", "claude-opus-4-8"]) {
      expect(perTokenRateFor(id)).not.toEqual(DEFAULT_RATE);
    }
  });

  it("★gpt-5.5 output 이 $20 → $30 실단가로 교정됐다", () => {
    expect(perTokenRateFor("gpt-5.5")).toEqual({
      inputPer1M: 5,
      outputPer1M: 30,
    });
  });

  it("gpt-5.6 3변종 실단가 — terra/luna 는 5.5 보다 싸다", () => {
    expect(perTokenRateFor("gpt-5.6-sol")).toEqual({
      inputPer1M: 5,
      outputPer1M: 30,
    });
    expect(perTokenRateFor("gpt-5.6-terra")).toEqual({
      inputPer1M: 2.5,
      outputPer1M: 15,
    });
    expect(perTokenRateFor("gpt-5.6-luna")).toEqual({
      inputPer1M: 1,
      outputPer1M: 6,
    });
    // ★"GPT=저가" 전제 반증: 우리 fleet 기본 gpt-5.5 출력이 sonnet5 의 2배다.
    expect(perTokenRateFor("gpt-5.5").outputPer1M).toBe(
      perTokenRateFor("claude-sonnet-5").outputPer1M * 2,
    );
  });

  it("Sonnet5 / Haiku4.5 실단가", () => {
    expect(perTokenRateFor("claude-sonnet-5")).toEqual({
      inputPer1M: 3,
      outputPer1M: 15,
    });
    // alias `haiku` 가 실제로 해석되는 날짜형 id 로도, 무날짜 프리픽스로도 $1/$5.
    expect(perTokenRateFor("claude-haiku-4-5-20251001")).toEqual({
      inputPer1M: 1,
      outputPer1M: 5,
    });
    expect(perTokenRateFor("claude-haiku-4-5")).toEqual({
      inputPer1M: 1,
      outputPer1M: 5,
    });
  });

  it("라우팅 후보 모델은 전부 실단가 행을 갖는다(default 폴백 0건)", () => {
    for (const m of MODEL_REGISTRY) {
      expect(perTokenRateFor(m.id)).toEqual({
        inputPer1M: m.pricing.inputPer1M,
        outputPer1M: m.pricing.outputPer1M,
      });
    }
  });

  it("legacy/구형 행은 보존된다(과거 세션로그 소급 계산)", () => {
    expect(perTokenRateFor("claude-opus-4-7")).toEqual({
      inputPer1M: 15,
      outputPer1M: 75,
    });
    expect(perTokenRateFor("gpt-4o-mini")).toEqual({
      inputPer1M: 0.15,
      outputPer1M: 0.6,
    });
    expect(perTokenRateFor("gemini-3-pro")).toEqual({
      inputPer1M: 1.25,
      outputPer1M: 10,
    });
  });

  it("미지 모델은 여전히 default 로 떨어진다(비용 계산이 멈추진 않게)", () => {
    expect(perTokenRateFor("totally-unknown-model")).toEqual(DEFAULT_RATE);
  });

  it("최장 프리픽스 매칭이 유지된다 — gpt-5.4-mini 가 gpt-5.4/gpt-5 를 이긴다", () => {
    expect(perTokenRateFor("gpt-5.4-mini")).toEqual({
      inputPer1M: 0.75,
      outputPer1M: 4.5,
    });
    // 미등록 5.x 변종은 보수적으로 gpt-5.5 요율.
    expect(perTokenRateFor("gpt-5.9-experimental")).toEqual({
      inputPer1M: 5,
      outputPer1M: 30,
    });
  });

  it("registryPricing() 이 단가표에 그대로 흘러간다(단일소스)", () => {
    for (const [id, rate] of Object.entries(registryPricing())) {
      expect(perTokenRateFor(id)).toEqual(rate);
    }
  });

  it("추정 단가는 estimated 로 표시돼 사실로 위장하지 않는다", () => {
    // gpt-5.4  — PR#596 크롤이 본체 행 단가를 미확정.
    // glm-*    — 공식 API 리스트 단가는 확인했지만(docs.z.ai/guides/overview/pricing)
    //            우리 접근 경로가 정액 Coding Plan 이라 per-token 이 실비용이 아니다.
    //            상한으로 잡아두고 쿼터 기반 비용축(서베이 V1-5)에서 확정한다.
    expect(estimatedPricingModelIds()).toEqual([
      "gpt-5.4",
      "glm-5.2",
      "glm-4.7",
    ]);
    // 추정치는 과소보고를 피하려고 보수적으로(=5.5 와 동일하게) 잡는다.
    expect(perTokenRateFor("gpt-5.4").outputPer1M).toBeGreaterThanOrEqual(
      perTokenRateFor("gpt-5.5").outputPer1M,
    );
  });
});
