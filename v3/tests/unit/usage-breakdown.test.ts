/**
 * 사용량 탭 하위모델 분해(`src/lib/usageBreakdown.ts`) 회귀 가드.
 *
 * 두 층을 본다:
 *   1. **단일소스 게이트** — 벤더↔모델 인덱스가 정말 `electron/model-registry`
 *      파생인가. 레지스트리에 행을 추가했는데 사용량 탭이 그 모델을 "미등록" 으로
 *      떨구면 여기서 깨진다. (렌더러엔 모델 id 리터럴이 없어야 한다는 규율의 집행)
 *   2. **집계·매핑 규칙** — 벤더별 합산, 정렬, 근거 우선순위, 그리고 ★"모르면
 *      지어내지 않는다"(근거 없는 모델 칸은 null).
 */
import { describe, it, expect } from "vitest";
import { quickLaneVendorCatalog } from "../../electron/model-selection";
import { MODEL_REGISTRY } from "../../electron/model-registry";
import {
  ALL_PERIOD_DAYS,
  aggregateUsageByVendor,
  buildVendorModelIndex,
  guessVendorFromModelId,
  mapAgentsToModels,
  periodById,
  resolveModel,
  stripEffortSuffix,
  vendorColor,
  NEUTRAL_VENDOR_COLOR,
  USAGE_PERIODS,
} from "../../src/lib/usageBreakdown";
import type { UsageEntry } from "../../src/lib/usageBreakdown";

/** main 이 얹는 필드(available/missingEnvKeys)까지 채운 렌더러 모양. */
function rendererGroups(): QuickLaneVendorGroup[] {
  return quickLaneVendorCatalog().map((g) => ({
    ...g,
    missingEnvKeys: [],
    available: true,
  })) as unknown as QuickLaneVendorGroup[];
}

const INDEX = buildVendorModelIndex(rendererGroups());

function entry(model: string, over: Partial<UsageEntry> = {}): UsageEntry {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    ...over,
  };
}

describe("벤더↔모델 인덱스 = 레지스트리 단일소스", () => {
  it("레지스트리의 active 모델이 하나도 빠짐없이 인덱스에 있다", () => {
    const active = MODEL_REGISTRY.filter((m) => m.status === "active");
    expect(active.length).toBeGreaterThan(0);
    for (const m of active) {
      const resolved = resolveModel(m.id, INDEX);
      expect(
        resolved.registered,
        `${m.id} 가 인덱스에 없다 — 카탈로그 파생이 끊겼다`,
      ).toBe(true);
      expect(resolved.vendor).toBe(m.provider);
    }
  });

  it("★같은 claude 하네스라도 env-swap 벤더는 anthropic 과 분리된다", () => {
    // 이 티켓이 고친 버그 그 자체: harness 로 접으면 셋이 한 칸이 된다.
    const glm = MODEL_REGISTRY.find((m) => m.provider === "zai");
    const mm = MODEL_REGISTRY.find((m) => m.provider === "minimax");
    const anthropic = MODEL_REGISTRY.find((m) => m.provider === "anthropic");
    expect(glm && mm && anthropic).toBeTruthy();
    // 셋 다 harness 는 claude 인데 벤더는 갈라져야 한다.
    expect(glm!.harness).toBe("claude");
    expect(mm!.harness).toBe("claude");
    const vendors = new Set(
      [glm!, mm!, anthropic!].map((m) => resolveModel(m.id, INDEX).vendor),
    );
    expect(vendors.size).toBe(3);
  });

  it("대소문자를 가리지 않는다(MiniMax-M3 ↔ minimax-m3)", () => {
    const mm = MODEL_REGISTRY.find((m) => m.provider === "minimax")!;
    const lower = resolveModel(mm.id.toLowerCase(), INDEX);
    expect(lower.registered).toBe(true);
    expect(lower.vendor).toBe("minimax");
  });

  it("모르는 id 는 registered=false 로 표시되고 추정 벤더를 단다", () => {
    // 구세대 로그에 남아 있는 id — 레지스트리엔 없다.
    const legacy = resolveModel("claude-opus-4-7", INDEX);
    expect(legacy.registered).toBe(false);
    expect(legacy.vendor).toBe("anthropic");
  });

  it("빈 모델 문자열은 벤더를 지어내지 않는다", () => {
    const empty = resolveModel("", INDEX);
    expect(empty.registered).toBe(false);
    expect(empty.vendor).toBe("unknown");
  });
});

describe("프리픽스 추정(레지스트리 미등록 전용)", () => {
  it.each([
    ["glm-9.9", "zai"],
    ["MiniMax-M9", "minimax"],
    ["grok-9", "xai"],
    ["kimi-k9", "moonshot"],
    ["claude-opus-3", "anthropic"],
    ["gemini-3-flash", "google"],
    ["gpt-9", "openai"],
    ["o3-mini", "openai"],
    ["codex-mini", "openai"],
    ["totally-made-up", "unknown"],
    ["", "unknown"],
  ])("%s → %s", (id, vendor) => {
    expect(guessVendorFromModelId(id)).toBe(vendor);
  });
});

describe("벤더 색 — 엔티티 고정(순위 아님)", () => {
  it("등록 벤더는 서로 다른 색을 받는다", () => {
    const vendors = ["anthropic", "openai", "zai", "minimax", "xai"];
    const colors = vendors.map(vendorColor);
    expect(new Set(colors).size).toBe(vendors.length);
  });

  it("미상/사용자 지정은 카테고리 색이 아니라 중립 회색이다", () => {
    expect(vendorColor("unknown")).toBe(NEUTRAL_VENDOR_COLOR);
    expect(vendorColor("custom")).toBe(NEUTRAL_VENDOR_COLOR);
  });

  it("대소문자·공백에 흔들리지 않는다", () => {
    expect(vendorColor(" Anthropic ")).toBe(vendorColor("anthropic"));
  });
});

describe("aggregateUsageByVendor", () => {
  const glm = MODEL_REGISTRY.find((m) => m.provider === "zai")!.id;
  const opus = MODEL_REGISTRY.find((m) => m.provider === "anthropic")!.id;

  it("같은 모델의 여러 날 행을 하나로 합산한다", () => {
    const { vendors, totals } = aggregateUsageByVendor(
      [
        entry(opus, { totalTokens: 100, inputTokens: 100, cost: 1 }),
        entry(opus, { totalTokens: 50, inputTokens: 50, cost: 0.5 }),
      ],
      INDEX,
    );
    expect(vendors).toHaveLength(1);
    expect(vendors[0].models).toHaveLength(1);
    expect(vendors[0].tokens).toBe(150);
    expect(vendors[0].cost).toBeCloseTo(1.5);
    expect(totals.tokens).toBe(150);
    expect(totals.inputTokens).toBe(150);
  });

  it("벤더별로 갈라 담고 토큰 내림차순으로 정렬한다", () => {
    const { vendors } = aggregateUsageByVendor(
      [entry(opus, { totalTokens: 10 }), entry(glm, { totalTokens: 90 })],
      INDEX,
    );
    expect(vendors.map((v) => v.vendor)).toEqual(["zai", "anthropic"]);
  });

  it("색은 정렬 순서가 아니라 벤더 id 를 따라간다", () => {
    const big = aggregateUsageByVendor(
      [entry(opus, { totalTokens: 1 }), entry(glm, { totalTokens: 99 })],
      INDEX,
    );
    const flipped = aggregateUsageByVendor(
      [entry(opus, { totalTokens: 99 }), entry(glm, { totalTokens: 1 })],
      INDEX,
    );
    const colorOf = (rows: typeof big.vendors, vendor: string) =>
      rows.find((v) => v.vendor === vendor)!.color;
    expect(colorOf(big.vendors, "anthropic")).toBe(
      colorOf(flipped.vendors, "anthropic"),
    );
    expect(colorOf(big.vendors, "zai")).toBe(colorOf(flipped.vendors, "zai"));
  });

  it("totalTokens 가 비면 네 부분의 합으로 되살린다(구 행 호환)", () => {
    const { totals } = aggregateUsageByVendor(
      [
        entry(opus, {
          totalTokens: 0,
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
        }),
      ],
      INDEX,
    );
    expect(totals.tokens).toBe(10);
  });

  it("빈 입력은 빈 결과 — 0 을 지어내 채우지 않는다", () => {
    const { vendors, totals } = aggregateUsageByVendor([], INDEX);
    expect(vendors).toEqual([]);
    expect(totals.tokens).toBe(0);
  });

  it("추정 단가 플래그가 모델 행까지 전달된다", () => {
    const { vendors } = aggregateUsageByVendor(
      [entry(glm, { totalTokens: 1 })],
      INDEX,
    );
    const registryRow = MODEL_REGISTRY.find((m) => m.id === glm)!;
    expect(vendors[0].models[0].estimatedPricing).toBe(
      Boolean(registryRow.pricing.estimated),
    );
  });
});

describe("에이전트 ↔ 실제 실행 모델", () => {
  const opus = MODEL_REGISTRY.find((m) => m.provider === "anthropic")!.id;

  it("detectedModelId(과금 관측)가 spawnedModel 보다 우선한다", () => {
    const [row] = mapAgentsToModels(
      [
        {
          id: "a1",
          name: "agent-1",
          model: "claude",
          spawnedModel: "claude-sonnet-5",
          detectedModelId: opus,
        },
      ],
      INDEX,
    );
    expect(row.modelId).toBe(opus);
    expect(row.source).toBe("detected");
  });

  it("detected 가 없으면 spawnedModel 로 떨어진다", () => {
    const [row] = mapAgentsToModels(
      [
        {
          id: "a1",
          name: "agent-1",
          model: "gpt",
          spawnedModel: "gpt-5.5@high",
        },
      ],
      INDEX,
    );
    expect(row.modelId).toBe("gpt-5.5@high");
    expect(row.source).toBe("spawned");
    // 표시는 원문 유지, 조회만 effort 를 벗긴다 → 벤더가 제대로 잡혀야 한다.
    expect(row.vendor).toBe("openai");
    expect(row.registered).toBe(true);
  });

  it("★근거가 하나도 없으면 모델을 추측하지 않는다", () => {
    const [row] = mapAgentsToModels(
      [{ id: "a1", name: "agent-1", model: "claude" }],
      INDEX,
    );
    expect(row.modelId).toBeNull();
    expect(row.modelLabel).toBeNull();
    expect(row.source).toBe("none");
    // 하네스가 claude 라고 해서 anthropic 으로 접지 않는다(env-swap 이 있으므로).
    expect(row.vendor).toBe("unknown");
    expect(row.color).toBe(NEUTRAL_VENDOR_COLOR);
  });

  it("근거 있는 행이 먼저, 그 안에서 이름순", () => {
    const rows = mapAgentsToModels(
      [
        { id: "c", name: "zeta", model: "claude" },
        { id: "b", name: "beta", model: "claude" },
        { id: "a", name: "omega", model: "claude", detectedModelId: opus },
      ],
      INDEX,
    );
    expect(rows.map((r) => r.name)).toEqual(["omega", "beta", "zeta"]);
  });

  it("공백만 있는 값은 근거로 치지 않는다", () => {
    const [row] = mapAgentsToModels(
      [{ id: "a1", name: "n", model: "claude", detectedModelId: "   " }],
      INDEX,
    );
    expect(row.source).toBe("none");
    expect(row.modelId).toBeNull();
  });
});

describe("stripEffortSuffix", () => {
  it.each([
    ["gpt-5.6-sol@max", "gpt-5.6-sol"],
    ["claude-opus-5", "claude-opus-5"],
    ["@weird", "@weird"], // 선두 @ 는 접미사가 아니다 — 자르지 않는다
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(stripEffortSuffix(input)).toBe(expected);
  });
});

describe("기간 선택기", () => {
  it("7 / 30 / 전체 세 칸이고 days 는 전부 양의 정수다", () => {
    // getCostSummary 가 days 를 양의 정수로만 받는다(아니면 invalid-argument).
    expect(USAGE_PERIODS.map((p) => p.id)).toEqual(["7d", "30d", "all"]);
    for (const p of USAGE_PERIODS) {
      expect(Number.isInteger(p.days)).toBe(true);
      expect(p.days).toBeGreaterThan(0);
    }
  });

  it("'전체' 는 첫 cost_logs 행보다 앞서는 창이다", () => {
    // 2026년에 시작한 로그를 전부 덮으려면 최소 몇 년은 되어야 한다.
    expect(periodById("all").days).toBe(ALL_PERIOD_DAYS);
    expect(ALL_PERIOD_DAYS).toBeGreaterThan(365 * 5);
  });

  it("모르는 id 는 기본 30일로 떨어진다", () => {
    expect(periodById("nope" as never).days).toBe(30);
  });
});
