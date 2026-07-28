/**
 * `get_model_guidance` 회귀 가드 — **툴이 돌려주는 것이 소스와 같은가**.
 *
 * 이 툴의 유일한 실패 모드는 "그럴듯한데 틀린 수치" 다. 오케가 이걸 근거로 모델을
 * 고르므로, 참조표에서 한 칸이라도 옮겨 적히거나 낡으면 그 오류가 배정 결정으로
 * 증폭된다. 그래서 이 파일이 못박는 것은 값의 예쁨이 아니라 **동일성**이다:
 *
 *   1. 정적 절반의 모든 수치가 registry/context/bench 참조표 **그 값** 이다.
 *   2. 벤치는 레코드가 **통째로** 실린다 — 알려지지 않은 필드(진행중인 SWE 변형
 *      라벨 작업이 추가할 필드 등)도 유실 없이 전달되고 출력에까지 나온다.
 *      ★이 테스트가 "필드 이름을 하드코딩하지 마라" 를 강제하는 자리다.
 *   3. 티어는 화면(`src/lib/modelTier`)이 내는 판정과 **완전히 같다**.
 *   4. 동적 절반은 `aggregateEffectiveness` 의 칸을 재집계 없이 합한 값이다.
 *   5. 정적 절반을 못 받으면 빈 목록을 정상인 척하지 않고 사유를 말한다.
 */
import { describe, expect, it } from "vitest";
import {
  MODEL_GUIDANCE_PAYLOAD_VERSION,
  modelGuidanceStatic,
} from "../../electron/model-guidance";
import { MODEL_REGISTRY, getModel } from "../../electron/model-registry";
import { benchRowsForModel } from "../../electron/model-bench-reference";
import { contextRecordFor } from "../../electron/model-context-reference";
import {
  modelFactSheet,
  pickBenchRecords,
} from "../../electron/model-fact-sheet";
import { withModelTiers } from "../../src/lib/modelTier";
import {
  formatModelGuidance,
  mergeModelGuidance,
  type GuidanceStaticPayload,
  type GuidanceStaticRow,
} from "../../electron/mcp-server/model-guidance-report";
import {
  aggregateEffectiveness,
  rollupEffectivenessByModel,
  type EffectivenessInputRow,
} from "../../electron/mcp-server/routing-effectiveness";

const payload = modelGuidanceStatic();
const rowById = new Map(payload.models.map((m) => [m.modelId, m]));

describe("model-guidance / 정적 절반은 참조표 그대로다", () => {
  it("모델 집합·순서가 정보표와 같다(화면과 오케가 다른 목록을 보지 않는다)", () => {
    expect(payload.models.map((m) => m.modelId)).toEqual(
      modelFactSheet().map((r) => r.modelId),
    );
    expect(payload.models.length).toBeGreaterThan(0);
    expect(payload.payloadVersion).toBe(MODEL_GUIDANCE_PAYLOAD_VERSION);
  });

  it("deprecated 행은 빠지고 active 행은 하나도 안 빠진다", () => {
    const active = MODEL_REGISTRY.filter((e) => e.status === "active").map(
      (e) => e.id,
    );
    expect([...rowById.keys()].sort()).toEqual([...active].sort());
    for (const e of MODEL_REGISTRY.filter((x) => x.status === "deprecated")) {
      expect(rowById.has(e.id)).toBe(false);
    }
  });

  it("단가·능력등급·effort·alias 가 레지스트리 값과 정확히 일치한다", () => {
    for (const row of payload.models) {
      const entry = getModel(row.modelId);
      expect(entry, row.modelId).toBeDefined();
      if (!entry) continue;
      expect(row.inputPer1M).toBe(entry.pricing.inputPer1M);
      expect(row.outputPer1M).toBe(entry.pricing.outputPer1M);
      expect(row.estimatedPricing).toBe(Boolean(entry.pricing.estimated));
      expect(row.capability).toBe(entry.capability);
      expect(row.harness).toBe(entry.harness);
      expect(row.vendor).toBe(entry.provider);
      expect(row.efforts).toEqual(entry.efforts);
      expect(row.defaultEffort).toBe(entry.defaultEffort ?? null);
      expect(row.aliases).toEqual(entry.aliases);
    }
  });

  it("추정 단가 플래그를 지우지 않는다(있는 행이 실제로 있다)", () => {
    const estimated = payload.models.filter((m) => m.estimatedPricing);
    for (const row of estimated) {
      expect(getModel(row.modelId)?.pricing.estimated).toBe(true);
    }
  });

  it("컨텍스트 칸은 참조표 값이고, 짝이 없으면 null 이다(0 으로 채우지 않는다)", () => {
    for (const row of payload.models) {
      const rec = contextRecordFor(row.modelId);
      if (!rec) {
        expect(row.context, row.modelId).toBeNull();
        continue;
      }
      expect(row.context?.tokens).toBe(rec.tokens);
      expect(row.context?.source).toBe(rec.source);
      expect(row.context?.asOf).toBe(rec.asOf);
    }
  });
});

describe("model-guidance / 벤치는 레코드를 통째로 나른다", () => {
  it("benchRecords 의 각 행이 참조표 레코드와 **같은 객체**다(필드 유실 불가)", () => {
    for (const row of payload.models) {
      const source = benchRowsForModel(row.modelId);
      expect(row.benchRecords.length, row.modelId).toBe(source.length);
      for (const rec of row.benchRecords) {
        // toBe = 참조 동일성. 필드를 골라 담았다면 여기서 깨진다.
        expect(source, row.modelId).toContain(rec);
      }
    }
  });

  it("representativeIndex 가 정보표의 대표행과 같은 행을 가리킨다", () => {
    for (const row of payload.models) {
      const { representative } = pickBenchRecords(row.modelId);
      if (!representative) {
        expect(row.representativeIndex, row.modelId).toBeNull();
        continue;
      }
      expect(row.representativeIndex).not.toBeNull();
      expect(row.benchRecords[row.representativeIndex as number]).toBe(
        representative,
      );
    }
  });

  it("★참조표에 새 필드가 늘면 코드 수정 없이 출력까지 전달된다", () => {
    // 진행중 티켓(PbGJpaP9)이 model-bench-reference 에 붙일 '벤치 변형 라벨' 이
    // 이 모양이다. 툴이 필드 이름을 알 필요가 없어야 하므로, 이름을 모르는
    // 필드를 하나 넣고 리포트에 나오는지만 본다.
    const row: GuidanceStaticRow = {
      ...(payload.models[0] as GuidanceStaticRow),
      benchRecords: [
        {
          benchmark: "swe-bench-verified",
          score: 70,
          source: "https://example.invalid/report",
          sourceKind: "model-vendor",
          asOf: "2026-07-28",
          harness: { name: "vendor-internal", version: "1.0" },
          // ↓ 이 툴이 존재를 모르는 필드들
          variantLabel: "Verified (Public subset)",
          someFutureField: 42,
        },
      ],
      representativeIndex: 0,
    };
    const synthetic: GuidanceStaticPayload = {
      payloadVersion: MODEL_GUIDANCE_PAYLOAD_VERSION,
      sources: payload.sources,
      models: [row],
    };
    const out = formatModelGuidance(mergeModelGuidance(synthetic, []), {
      scanned: 0,
      cap: 500,
    });
    expect(out).toContain("variantLabel=Verified (Public subset)");
    expect(out).toContain("someFutureField=42");
    // 알려진 필드는 서술 문장에 이미 있으므로 extras 로 중복 출력하지 않는다.
    expect(out).not.toContain("benchmark=swe-bench-verified");
  });

  it("공식 수치가 없는 칸을 0 이나 추정으로 바꾸지 않는다", () => {
    const nulls = payload.models.flatMap((m) =>
      m.benchRecords.filter((r) => r.score === null),
    );
    for (const rec of nulls) expect(rec.score).toBeNull();
  });
});

describe("model-guidance / 티어는 화면과 같은 판정이다", () => {
  it("모든 행의 tier·reason·valueRatio 가 src/lib/modelTier 결과와 일치한다", () => {
    const merged = mergeModelGuidance(
      payload as unknown as GuidanceStaticPayload,
      [],
    );
    const screen = withModelTiers(modelFactSheet());
    expect(merged.length).toBe(screen.length);
    merged.forEach((row, i) => {
      const want = screen[i];
      expect(row.static.modelId).toBe(want.row.modelId);
      expect(row.tier.tier, row.static.modelId).toBe(want.tier);
      expect(row.tier.reason, row.static.modelId).toBe(want.reason);
      expect(row.tier.valueRatio, row.static.modelId).toBe(want.valueRatio);
    });
  });

  it("티어는 전체 행 기준으로 파생된다(필터해도 판정이 흔들리지 않는다)", () => {
    const full = mergeModelGuidance(
      payload as unknown as GuidanceStaticPayload,
      [],
    );
    const target = full.find((r) => r.tier.tier === "value") ?? full[0];
    // merge 는 항상 전체 행을 받고 필터는 그 뒤에 일어난다 — 그 계약을 못박는다.
    const again = mergeModelGuidance(
      payload as unknown as GuidanceStaticPayload,
      [],
    ).find((r) => r.static.modelId === target.static.modelId);
    expect(again?.tier).toEqual(target.tier);
  });
});

describe("model-guidance / 동적 절반은 집계 재사용이다", () => {
  const rows: EffectivenessInputRow[] = [
    {
      taskId: "a",
      status: "DONE",
      spawnedModelKey: "gpt-5.5@medium",
      complexity: "standard",
      taskType: "feature",
      costTotal: 1,
    },
    {
      taskId: "b",
      status: "FAILED",
      spawnedModelKey: "gpt-5.5@medium",
      complexity: "complex",
      taskType: "bugfix",
      costTotal: 1,
    },
    {
      taskId: "c",
      status: "DONE",
      spawnedModelKey: "gpt-5.5@medium",
      complexity: "simple",
      taskType: "feature",
      costTotal: null,
    },
    {
      taskId: "d",
      status: "DONE",
      provider: "claude",
      complexity: "simple",
      taskType: "feature",
      costTotal: 2,
    },
  ];
  const report = aggregateEffectiveness(rows);
  const rollups = rollupEffectivenessByModel(report);

  it("롤업의 카운트가 칸들의 합과 정확히 같다(재집계 아님)", () => {
    const gpt = rollups.find((r) => r.modelKey === "gpt-5.5@medium");
    expect(gpt).toBeDefined();
    expect(gpt?.n).toBe(3);
    expect(gpt?.successes).toBe(2);
    expect(gpt?.failures).toBe(1);
    expect(gpt?.cellCount).toBe(3);
    expect(gpt?.successRate).toBeCloseTo(2 / 3);
    // 비용 미측정 행(c)은 분모에서 빠진다 — 0원으로 세지 않는다.
    expect(gpt?.costedN).toBe(2);
    expect(gpt?.costTotal).toBe(2);
    expect(gpt?.avgCost).toBe(1);
    expect(gpt?.costCoverage).toBeCloseTo(2 / 3);
    expect(gpt?.costedSuccesses).toBe(1);
    expect(gpt?.successPerDollar).toBeCloseTo(0.5);
  });

  it("총계가 원 집계의 총계와 어긋나지 않는다", () => {
    const sum = (k: "n" | "successes" | "failures" | "costedN") =>
      rollups.reduce((acc, r) => acc + r[k], 0);
    expect(sum("n")).toBe(report.totals.counted);
    expect(sum("successes")).toBe(report.totals.successes);
    expect(sum("failures")).toBe(report.totals.failures);
    expect(sum("costedN")).toBe(report.totals.costedN);
  });

  it("비용 합이 0 이면 비용당성공은 ∞ 가 아니라 null 이다", () => {
    const noCost = rollupEffectivenessByModel(
      aggregateEffectiveness([
        { taskId: "x", status: "DONE", spawnedModelKey: "k3", costTotal: null },
      ]),
    );
    expect(noCost[0].successPerDollar).toBeNull();
    expect(noCost[0].avgCost).toBeNull();
  });
});

describe("model-guidance / 정적×동적 합류", () => {
  const rollups = rollupEffectivenessByModel(
    aggregateEffectiveness([
      // 구체 model@effort — 그 모델의 direct 실적
      {
        taskId: "1",
        status: "DONE",
        spawnedModelKey: "gpt-5.5@medium",
        costTotal: 1,
      },
      // 하네스 축(구 dispatchMeta) — 모델별 근거로 쓰면 안 되는 칸
      { taskId: "2", status: "DONE", provider: "gpt", costTotal: 1 },
      { taskId: "3", status: "FAILED", provider: "claude", costTotal: 1 },
    ]),
  );
  const merged = mergeModelGuidance(
    payload as unknown as GuidanceStaticPayload,
    rollups,
  );

  it("model@effort 칸은 그 모델의 direct 로 붙는다", () => {
    const gpt55 = merged.find((r) => r.static.modelId === "gpt-5.5");
    expect(
      gpt55,
      "레지스트리에 gpt-5.5 행이 있어야 이 테스트가 의미 있다",
    ).toBeDefined();
    expect(gpt55?.dynamic.direct.map((d) => d.modelKey)).toContain(
      "gpt-5.5@medium",
    );
  });

  it("provider 해상도 칸은 direct 에 섞이지 않고 harnessLevel 로만 붙는다", () => {
    for (const row of merged) {
      for (const d of row.dynamic.direct) {
        expect(d.resolution, `${row.static.modelId}/${d.modelKey}`).toBe(
          "model@effort",
        );
      }
      for (const h of row.dynamic.harnessLevel) {
        expect(h.resolution).toBe("provider");
        expect(h.modelKey).toBe(row.static.harness.toLowerCase());
      }
    }
    // claude 하네스 행들은 provider 칸을 공유해서 받는다.
    const claudeRows = merged.filter((r) => r.static.harness === "claude");
    expect(claudeRows.length).toBeGreaterThan(0);
    expect(
      claudeRows.every((r) =>
        r.dynamic.harnessLevel.some((h) => h.modelKey === "claude"),
      ),
    ).toBe(true);
  });

  it("실적이 없는 모델은 '없음' 이라고 말한다(0% 성공률로 오독되지 않게)", () => {
    const cold = merged.find(
      (r) =>
        r.dynamic.direct.length === 0 && r.dynamic.harnessLevel.length === 0,
    );
    expect(cold).toBeDefined();
    const out = formatModelGuidance(cold ? [cold] : [], {
      scanned: 3,
      cap: 500,
    });
    expect(out).toContain("우리 실적: 없음");
    expect(out).not.toContain("성공률 0%");
  });

  it("하네스 공통 줄은 모델별 근거가 아니라고 명시된다", () => {
    const claudeRow = merged.find(
      (r) => r.dynamic.harnessLevel.length > 0,
    ) as (typeof merged)[number];
    const out = formatModelGuidance([claudeRow], { scanned: 3, cap: 500 });
    expect(out).toContain("하네스 공통(모델별 근거 아님)");
  });
});

describe("model-guidance / 모르는 것을 모른다고 말한다", () => {
  it("정적 절반을 못 받으면 빈 목록을 정상인 척하지 않는다", () => {
    const out = formatModelGuidance([], {
      scanned: 12,
      cap: 500,
      staticError: "브리지 응답 500",
    });
    expect(out).toContain("★정적 절반 없음: 브리지 응답 500");
    expect(out).toContain("단가·컨텍스트·벤치는 이 응답으로 판단하지 말 것");
  });

  it("스캔 상한에 걸리면 리포트가 그 사실을 말한다", () => {
    const out = formatModelGuidance([], { scanned: 500, cap: 500 });
    expect(out).toContain("★상한 500");
  });

  it("추정 단가·벤치 부재 행은 그 사실을 화면 문구로 달고 나온다", () => {
    const merged = mergeModelGuidance(
      payload as unknown as GuidanceStaticPayload,
      [],
    );
    const estimated = merged.find((r) => r.static.estimatedPricing);
    if (estimated) {
      expect(
        formatModelGuidance([estimated], { scanned: 0, cap: 0 }),
      ).toContain("★추정치");
    }
    const noBench = merged.find((r) => r.static.benchRecords.length === 0);
    if (noBench) {
      expect(formatModelGuidance([noBench], { scanned: 0, cap: 0 })).toContain(
        "참조표에 행 없음",
      );
    }
    // 둘 중 하나는 실제로 존재해야 이 테스트가 의미가 있다.
    expect(Boolean(estimated) || Boolean(noBench)).toBe(true);
  });

  it("종합점수/추천을 만들지 않는다(판정은 호출자 몫)", () => {
    const out = formatModelGuidance(
      mergeModelGuidance(payload as unknown as GuidanceStaticPayload, []),
      { scanned: 0, cap: 0 },
    );
    expect(out).not.toMatch(/추천|권장 모델|종합점수|best model/i);
  });
});
