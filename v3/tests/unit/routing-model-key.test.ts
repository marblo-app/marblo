/**
 * P2-2 — 지식그래프 모델축 해상도(`routing-model-key.ts`) + 구키 폴백 다단 조회
 * (`routing-graph.ts`).
 *
 * 이 파일이 못박는 것 세 가지:
 *  1. 읽기 키와 쓰기 키가 **같은 정책**에서 나온다(갈라지면 학습이 조용히 죽는다).
 *  2. 기존 학습(프로바이더 키)이 새 키로 옮겨간 뒤에도 **원래 무게 그대로** 쓰이고,
 *     새 키에 관측이 차면 자동으로 비중이 옮겨간다(중간에 데이터가 증발하지 않는다).
 *  3. 승인 게이트 칸(max/ultra)이 예측 키로 새어 나오지 않는다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatModelKey,
  graphModelKeys,
  modelKeyFromSpawn,
  predictedModelKey,
  type TierModelResolver,
} from "../../electron/routing-model-key";
import { modelTierForComplexity } from "../../electron/agent-config";
import {
  applyOutcome,
  emptyRoutingGraph,
  graphBiasForModel,
  graphBiasDetailForModel,
  cellKeysForContext,
  factorKeysForContext,
  ROUTING_WEIGHT,
  SHRINKAGE_K,
  type GraphContext,
} from "../../electron/routing-graph";

const T0 = Date.parse("2026-07-25T00:00:00Z");

/** 테스트용 티어 정책 — 실제 agent-config 와 같은 모양의 답을 결정적으로 준다. */
const FAKE_TIER: TierModelResolver = (provider, tier) => {
  if (provider === "claude") {
    return {
      claudeModel:
        tier === "simple"
          ? "claude-sonnet-5"
          : tier === "complex"
            ? "claude-fable-5"
            : "claude-opus-5",
    };
  }
  if (provider === "gpt") {
    return {
      codexReasoning:
        tier === "simple" ? "low" : tier === "complex" ? "high" : "medium",
    };
  }
  return {};
};

describe("formatModelKey", () => {
  it("effort 가 있으면 model@effort, 없으면 model 만", () => {
    expect(formatModelKey("gpt-5.5", "medium")).toBe("gpt-5.5@medium");
    expect(formatModelKey("claude-opus-5")).toBe("claude-opus-5");
    expect(formatModelKey("claude-opus-5", "")).toBe("claude-opus-5");
  });

  it("공백/대문자를 정규화한다 — 같은 모델이 두 셀로 쪼개지지 않게", () => {
    expect(formatModelKey("  GPT-5.5 ", " Medium ")).toBe("gpt-5.5@medium");
    expect(formatModelKey("   ")).toBe("");
  });
});

describe("modelKeyFromSpawn (쓰기 경로 = argv 관측)", () => {
  it("claude alias 를 구체 id 로 접는다(같은 모델이 alias/id 두 셀로 갈리지 않게)", () => {
    expect(modelKeyFromSpawn("claude", { modelId: "opus" })).toBe(
      "claude-opus-5",
    );
    expect(modelKeyFromSpawn("claude", { modelId: "claude-fable-5" })).toBe(
      "claude-fable-5",
    );
  });

  it("★codex 는 모델을 핀하지 않으므로 effort 만 온다 → 상속 기본모델로 채운다", () => {
    // 오늘의 스폰 argv 는 `-c model_reasoning_effort="medium"` 뿐이고 모델은
    // 사용자 config.toml 값이다. 사다리의 inheritedModel 이 바로 그 사실이다.
    expect(modelKeyFromSpawn("gpt", { effort: "medium" })).toBe(
      "gpt-5.5@medium",
    );
  });

  it("모델을 명시 핀한 스폰(#601)은 그 모델이 사실이다", () => {
    expect(
      modelKeyFromSpawn("gpt", { modelId: "gpt-5.6-sol", effort: "xhigh" }),
    ).toBe("gpt-5.6-sol@xhigh");
  });

  it("★관측이 없으면 null — 난도에서 모델을 역추론하지 않는다", () => {
    expect(modelKeyFromSpawn("claude", {})).toBeNull();
    expect(modelKeyFromSpawn("claude", null)).toBeNull();
    // 사다리가 없는 벤더는 effort 만 있어도 모델을 지어내지 않는다.
    expect(modelKeyFromSpawn("antigravity", { effort: "high" })).toBeNull();
  });
});

describe("predictedModelKey / graphModelKeys (읽기 경로 = 예측)", () => {
  it("난도별로 실제 스폰될 model@effort 를 예측한다", () => {
    expect(predictedModelKey("claude", "simple", FAKE_TIER)).toBe(
      "claude-sonnet-5",
    );
    expect(predictedModelKey("claude", "standard", FAKE_TIER)).toBe(
      "claude-opus-5",
    );
    expect(predictedModelKey("gpt", "standard", FAKE_TIER)).toBe(
      "gpt-5.5@medium",
    );
    expect(predictedModelKey("gpt", "simple", FAKE_TIER)).toBe("gpt-5.5@low");
  });

  it("난도가 없으면 예측하지 않는다(스폰이 모델 인자를 안 붙여 CLI 기본이 뜬다)", () => {
    expect(predictedModelKey("claude", undefined, FAKE_TIER)).toBeNull();
    expect(graphModelKeys("claude", undefined, FAKE_TIER)).toEqual(["claude"]);
  });

  it("모델 사실이 없는 벤더는 프로바이더 키 하나 = 무회귀", () => {
    expect(predictedModelKey("antigravity", "complex", FAKE_TIER)).toBeNull();
    expect(graphModelKeys("antigravity", "complex", FAKE_TIER)).toEqual([
      "antigravity",
    ]);
    expect(graphModelKeys("gemini", "simple", FAKE_TIER)).toEqual(["gemini"]);
  });

  it("★구키(프로바이더)를 항상 폴백 칸으로 함께 넘긴다 — 순서는 구체적인 것부터", () => {
    expect(graphModelKeys("gpt", "standard", FAKE_TIER)).toEqual([
      "gpt-5.5@medium",
      "gpt",
    ]);
  });

  it("★승인 게이트 effort(max/ultra)는 예측 키로 새지 않는다", () => {
    const gated: TierModelResolver = () => ({ codexReasoning: "max" });
    expect(predictedModelKey("gpt", "complex", gated)).toBeNull();
    expect(graphModelKeys("gpt", "complex", gated)).toEqual(["gpt"]);
  });

  it("티어 정책이 throw 해도 dispatch 를 깨뜨리지 않고 구키로 떨어진다", () => {
    const boom: TierModelResolver = () => {
      throw new Error("ladder misconfigured");
    };
    expect(graphModelKeys("gpt", "standard", boom)).toEqual(["gpt"]);
  });
});

describe("★읽기 예측과 라이브 티어 정책의 일치(agent-config 실함수)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("env 튜닝이 걸린 상태에서도 예측 키가 그 env 결과를 따른다", () => {
    // 이 검증이 중요한 이유: 사다리 데이터만 보고 예측하면 complex claude 를
    // 항상 fable5 로 예측하지만, MARBLO_TOP_CLAUDE_MODEL 이 걸려 있으면 실제
    // 스폰은 opus5 다. 그러면 읽는 셀과 쓰는 셀이 갈려 학습이 조용히 죽는다.
    vi.stubEnv("MARBLO_TOP_CLAUDE_MODEL", "opus");
    const live: TierModelResolver = (provider, tier) =>
      modelTierForComplexity(provider as never, tier, "2.1.220");
    expect(predictedModelKey("claude", "complex", live)).toBe("claude-opus-5");

    vi.stubEnv("MARBLO_TOP_CLAUDE_MODEL", "");
    expect(predictedModelKey("claude", "complex", live)).toBe("claude-fable-5");
  });

  it("★쓰기 키(argv) 와 읽기 키(예측)가 같은 문자열이다 — 같은 셀을 본다", () => {
    vi.stubEnv("MARBLO_SIMPLE_CODEX_REASONING", "");
    const live: TierModelResolver = (provider, tier) =>
      modelTierForComplexity(provider as never, tier, "2.1.220");
    const predicted = predictedModelKey("gpt", "simple", live);
    // 스폰 시 argv 에 실제로 들어가는 effort 는 같은 resolver 의 값이다.
    const spawnEffort = modelTierForComplexity(
      "gpt",
      "simple",
      "2.1.220",
    ).codexReasoning;
    expect(modelKeyFromSpawn("gpt", { effort: spawnEffort })).toBe(predicted);
  });
});

describe("routing-graph — 구키 폴백 다단 조회", () => {
  const CTX: GraphContext = { role: "backend", complexity: "standard" };

  function seedLegacy(mergedCount: number) {
    const g = emptyRoutingGraph();
    for (let i = 0; i < mergedCount; i++) {
      applyOutcome(g, {
        model: "gpt", // 종전 프로바이더 키로 쌓인 이력
        mode: "merged",
        ctx: CTX,
        taskId: `legacy-${i}`,
        agentId: "a1",
        atMs: T0,
      });
    }
    return g;
  }

  it("factorKeysForContext 와 cellKeysForContext 가 같은 factor 목록을 쓴다", () => {
    const ctx: GraphContext = {
      role: "backend",
      taskType: "feature",
      complexity: "complex",
      tags: ["agentic"],
    };
    expect(factorKeysForContext(ctx)).toEqual([
      "role:backend",
      "taskType:feature",
      "complexity:complex",
      "tag:agentic",
    ]);
    expect(cellKeysForContext("gpt-5.5@medium", ctx)).toEqual([
      "role:backend|gpt-5.5@medium",
      "taskType:feature|gpt-5.5@medium",
      "complexity:complex|gpt-5.5@medium",
      "tag:agentic|gpt-5.5@medium",
    ]);
  });

  it("★새 키가 비어 있으면 구키의 학습이 그대로 쓰인다(94건 증발 없음)", () => {
    const g = seedLegacy(20);
    const legacyOnly = graphBiasForModel("gpt", CTX, g);
    expect(legacyOnly).toBeGreaterThan(0);
    // 새 키 + 구키 폴백 = 구키 단독과 같은 값. 이게 마이그레이션의 무손실 조건이다.
    expect(graphBiasForModel(["gpt-5.5@medium", "gpt"], CTX, g)).toBeCloseTo(
      legacyOnly,
      10,
    );
  });

  it("키 하나만 넘기면 종전 동작과 바이트 동일(기존 유닛 보존의 근거)", () => {
    const g = seedLegacy(5);
    expect(graphBiasForModel(["gpt"], CTX, g)).toBe(
      graphBiasForModel("gpt", CTX, g),
    );
  });

  it("★새 키에 부정 관측이 쌓이면 구키의 양성 이력을 밀어낸다", () => {
    const g = seedLegacy(20);
    const before = graphBiasForModel(["gpt-5.5@medium", "gpt"], CTX, g);
    for (let i = 0; i < 12; i++) {
      applyOutcome(g, {
        model: "gpt-5.5@medium",
        mode: "review_rejected",
        ctx: CTX,
        taskId: `new-${i}`,
        agentId: "a2",
        atMs: T0,
      });
    }
    const after = graphBiasForModel(["gpt-5.5@medium", "gpt"], CTX, g);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(0);
    // 같은 컨텍스트의 다른 변종은 구키 이력만 보므로 여전히 양성이다 —
    // 이게 "변종별 변별력" 이 처음으로 생겼다는 증거다.
    expect(graphBiasForModel(["gpt-5.5@high", "gpt"], CTX, g)).toBeGreaterThan(
      0,
    );
  });

  it("한 관측이 두 키에 동시 계상되지 않는다(쓰기는 키 하나)", () => {
    const g = emptyRoutingGraph();
    applyOutcome(g, {
      model: "gpt-5.5@medium",
      mode: "merged",
      ctx: { role: "backend" },
      taskId: "T1",
      agentId: "a1",
      atMs: T0,
    });
    expect(Object.keys(g.cells)).toEqual(["role:backend|gpt-5.5@medium"]);
    // 구키 셀은 만들어지지 않았으므로 다단 조회 값 = 새 셀 단독 값.
    const expected = (ROUTING_WEIGHT.merged * 1) / (1 + SHRINKAGE_K); // n=1 축소
    expect(
      graphBiasForModel(["gpt-5.5@medium", "gpt"], { role: "backend" }, g),
    ).toBeCloseTo(expected, 10);
  });

  it("detail 의 note 는 신호를 가진 가장 구체적인 tier 를 가리킨다", () => {
    const g = seedLegacy(10);
    const legacyNote = graphBiasDetailForModel(
      ["gpt-5.5@medium", "gpt"],
      CTX,
      g,
    );
    expect(legacyNote.note).toContain("merged");
    applyOutcome(g, {
      model: "gpt-5.5@medium",
      mode: "review_rejected",
      ctx: CTX,
      taskId: "N1",
      agentId: "a2",
      atMs: T0,
    });
    const preciseNote = graphBiasDetailForModel(
      ["gpt-5.5@medium", "gpt"],
      CTX,
      g,
    );
    expect(preciseNote.note).toContain("review_rejected");
  });
});
