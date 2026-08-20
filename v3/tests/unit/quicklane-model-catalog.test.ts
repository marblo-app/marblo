/**
 * 퀵레인 모델 카탈로그 ↔ 모델 레지스트리 **단일소스 게이트**.
 *
 * 오케 셀렉터(`orchestrator-model-options.test.ts`)와 다른 점: 그쪽은 렌더러의
 * 미러 배열을 레지스트리 파생값과 대조한다. 퀵레인엔 미러가 없다 — 목록이 런타임
 * IPC(`models:quickLaneCatalog`)로 내려오기 때문이다. 그래서 여기서 검증하는 것은
 * "미러가 안 벌어졌나" 가 아니라 **"카탈로그가 정말 레지스트리에서 파생되나"** 다:
 * 레지스트리 행이 하나도 빠지지 않고, 하드코딩된 모델 목록이 끼어들지 않았는지.
 */
import { describe, it, expect } from "vitest";
import { quickLaneVendorCatalog } from "../../electron/model-selection";
import {
  MODEL_REGISTRY,
  HARNESS_NATIVE_VENDOR,
  vendorEnvSecretKeys,
  vendorEnvSecretRef,
} from "../../electron/model-registry";
import {
  buildModelPin,
  carryEffort,
  defaultSelection,
  selectionFor,
} from "../../src/lib/quickLaneModel";

/** 렌더러가 받는 모양(available/missingEnvKeys 는 main 이 얹는다)으로 접는다. */
function asRendererGroups(
  present: Record<string, string> = {},
): QuickLaneVendorGroupShape[] {
  return quickLaneVendorCatalog().map((g) => {
    const missingEnvKeys = g.requiredEnvKeys.filter((k) => !present[k]);
    return { ...g, missingEnvKeys, available: missingEnvKeys.length === 0 };
  });
}

// 렌더러 쪽 전역 타입(vite-env.d.ts)은 이 테스트 프로그램에 없다 — 같은 모양을
// 로컬로 선언해 헬퍼에 넘긴다. 필드가 벌어지면 컴파일이 여기서 깨진다.
type QuickLaneVendorGroupShape = ReturnType<
  typeof quickLaneVendorCatalog
>[number] & {
  missingEnvKeys: string[];
  available: boolean;
};

describe("퀵레인 모델 카탈로그 ↔ 레지스트리", () => {
  const catalog = quickLaneVendorCatalog();
  const activeEntries = MODEL_REGISTRY.filter((m) => m.status === "active");

  it("★활성 레지스트리 행이 하나도 빠지지 않는다(하드코딩 목록이면 못 지킨다)", () => {
    const catalogIds = catalog
      .flatMap((g) => g.models.map((m) => m.modelId))
      .sort();
    const registryIds = activeEntries.map((m) => m.id).sort();
    expect(catalogIds).toEqual(registryIds);
  });

  it("★레지스트리에 없는 모델을 지어내지 않는다", () => {
    const known = new Set(MODEL_REGISTRY.map((m) => m.id));
    for (const group of catalog) {
      for (const model of group.models) {
        expect(known.has(model.modelId), model.modelId).toBe(true);
      }
    }
  });

  it("★완료기준: 4개 하네스(claude/gpt/grok) + env-swap 벤더가 전부 선다", () => {
    const vendors = catalog.map((g) => g.vendor);
    for (const v of [
      "anthropic",
      "openai",
      "xai",
      "zai",
      "minimax",
      "moonshot",
      "upstage",
      "deepseek",
    ]) {
      expect(vendors, v).toContain(v);
    }
  });

  it("★완료기준: 구체 하위모델이 실제로 고를 수 있다", () => {
    const ids = catalog.flatMap((g) => g.models.map((m) => m.modelId));
    for (const id of [
      "claude-fable-5",
      "claude-opus-5",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "grok-4.6",
      "grok-4.5",
      "glm-4.7",
      "glm-5.2",
      "MiniMax-M3",
      "MiniMax-M2.7",
      "solar-pro4",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("★env-swap 벤더는 필요한 env 키 이름을 싣는다(값은 절대 아님)", () => {
    const zai = catalog.find((g) => g.vendor === "zai");
    const minimax = catalog.find((g) => g.vendor === "minimax");
    const upstage = catalog.find((g) => g.vendor === "upstage");
    const deepseek = catalog.find((g) => g.vendor === "deepseek");
    expect(zai?.requiredEnvKeys).toEqual(["ZAI_API_KEY"]);
    expect(minimax?.requiredEnvKeys).toEqual(["MINIMAX_API_KEY"]);
    expect(upstage?.requiredEnvKeys).toEqual(["UPSTAGE_API_KEY"]);
    expect(deepseek?.requiredEnvKeys).toEqual(["DEEPSEEK_API_KEY"]);
    // 키 이름은 레지스트리 프로파일에서 파생돼야 한다(별도 표 금지).
    expect(zai?.requiredEnvKeys).toEqual(vendorEnvSecretKeys("glm-5.2"));
    expect(upstage?.requiredEnvKeys).toEqual(vendorEnvSecretKeys("solar-pro4"));
    expect(deepseek?.requiredEnvKeys).toEqual(
      vendorEnvSecretKeys("deepseek-v4-flash"),
    );
  });

  it("★각 vendor+harness 그룹의 requiredEnvKeys 는 envProfile ${...} 참조에서 파생된다", () => {
    for (const group of catalog) {
      const expected = new Set<string>();
      for (const entry of activeEntries) {
        if (
          entry.provider !== group.vendor ||
          entry.harness !== group.harness
        ) {
          continue;
        }
        for (const value of Object.values(entry.envProfile ?? {})) {
          const ref = vendorEnvSecretRef(value);
          if (ref) expected.add(ref);
        }
      }
      expect(group.requiredEnvKeys, `${group.vendor}/${group.harness}`).toEqual(
        [...expected].sort(),
      );
    }
  });

  it("★네이티브 벤더는 env 키를 요구하지 않는다(CLI 자기 로그인)", () => {
    for (const group of catalog) {
      if (HARNESS_NATIVE_VENDOR[group.harness] !== group.vendor) continue;
      expect(group.requiredEnvKeys, group.vendor).toEqual([]);
    }
  });

  it("★승인게이트 effort(max/ultra)는 퀵레인에도 안 나온다 — #602", () => {
    for (const group of catalog) {
      for (const model of group.models) {
        expect(model.efforts, model.modelId).not.toContain("max");
        expect(model.efforts, model.modelId).not.toContain("ultra");
      }
    }
  });

  it("codex 계열만 effort 축을 갖는다(claude 하네스는 CLI 인자가 없다)", () => {
    for (const group of catalog) {
      for (const model of group.models) {
        if (group.harness === "gpt") {
          expect(model.efforts.length, model.modelId).toBeGreaterThan(0);
        } else {
          expect(model.efforts, model.modelId).toEqual([]);
        }
      }
    }
  });

  it("모델은 능력등급 높음 → 낮음으로 선다", () => {
    const rank = { cheap: 0, mid: 1, top: 2, frontier: 3 } as const;
    for (const group of catalog) {
      const ranks = group.models.map((m) => rank[m.capability]);
      expect(
        [...ranks].sort((a, b) => b - a),
        group.vendor,
      ).toEqual(ranks);
    }
  });

  it("네이티브 벤더가 env-swap 벤더보다 앞에 선다", () => {
    const isNative = catalog.map(
      (g) => HARNESS_NATIVE_VENDOR[g.harness] === g.vendor,
    );
    const lastNative = isNative.lastIndexOf(true);
    const firstSwap = isNative.indexOf(false);
    if (firstSwap >= 0 && lastNative >= 0) {
      expect(firstSwap).toBeGreaterThan(lastNative);
    }
  });

  it("스폰 command 가 하네스 단일소스에서 온다", () => {
    const byVendor = Object.fromEntries(catalog.map((g) => [g.vendor, g]));
    expect(byVendor.anthropic.command).toBe("claude");
    expect(byVendor.openai.command).toBe("codex");
    expect(byVendor.xai.command).toBe("grok");
    // env-swap 벤더는 **우리 claude 바이너리**를 그대로 띄운다(신규 하네스 0).
    expect(byVendor.zai.command).toBe("claude");
    expect(byVendor.zai.harness).toBe("claude");
    expect(byVendor.minimax.harness).toBe("claude");
    // OpenAI 호환 env-swap 은 Codex 하네스의 OPENAI_BASE_URL 을 스왑한다.
    expect(byVendor.upstage.command).toBe("codex");
    expect(byVendor.upstage.harness).toBe("gpt");
    expect(byVendor.deepseek.command).toBe("codex");
    expect(byVendor.deepseek.harness).toBe("gpt");
  });
});

describe("퀵레인 선택 헬퍼", () => {
  it("★키가 없는 벤더는 기본 선택이 되지 않는다", () => {
    // 키를 하나도 안 준 상태 = 오늘 이 Mac 의 실제 상태(GLM/MiniMax 미등록).
    const groups = asRendererGroups();
    const selection = defaultSelection(groups);
    expect(selection).not.toBeNull();
    const chosen = groups.find((g) => g.vendor === selection?.vendor);
    expect(chosen?.available).toBe(true);
    expect(chosen?.requiredEnvKeys).toEqual([]);
  });

  it("키를 넣으면 그 벤더가 available 로 바뀐다(목록에서 사라지지 않는다)", () => {
    const without = asRendererGroups();
    const withKey = asRendererGroups({ ZAI_API_KEY: "x" });
    expect(without.find((g) => g.vendor === "zai")?.available).toBe(false);
    expect(withKey.find((g) => g.vendor === "zai")?.available).toBe(true);
    // 비활성이어도 목록에는 있다 — "지원 안 함" 이 아니라 "키만 넣으면 켜짐".
    expect(without.map((g) => g.vendor)).toContain("zai");
  });

  it("★effort 축이 없는 모델엔 effort 가 붙지 않는다(핀 문자열까지)", () => {
    const groups = asRendererGroups();
    const claude = groups.find((g) => g.vendor === "anthropic")!;
    const sel = selectionFor(claude, claude.models[0], "high");
    expect(sel.effort).toBe("");
    expect(buildModelPin(sel)).toBe(claude.models[0].modelId);
  });

  it("codex 모델은 effort 를 핀 문자열에 싣는다", () => {
    const groups = asRendererGroups();
    const codex = groups.find((g) => g.vendor === "openai")!;
    const model = codex.models.find((m) => m.efforts.includes("high"))!;
    const sel = selectionFor(codex, model, "high");
    expect(buildModelPin(sel)).toBe(`${model.modelId}@high`);
  });

  it("모델을 갈아탈 때 effort 는 지원할 때만 이월된다", () => {
    const groups = asRendererGroups();
    const codex = groups.find((g) => g.vendor === "openai")!;
    const claude = groups.find((g) => g.vendor === "anthropic")!;
    expect(carryEffort(codex.models[0], "high")).toBe("high");
    expect(carryEffort(claude.models[0], "high")).toBe("");
    // 승인게이트 칸은 이월 대상조차 아니다.
    expect(carryEffort(codex.models[0], "ultra")).toBe("");
  });

  it("선택은 하네스와 command 를 그룹에서 그대로 가져간다", () => {
    const groups = asRendererGroups();
    const grok = groups.find((g) => g.vendor === "xai")!;
    const sel = selectionFor(grok, grok.models[0], "");
    expect(sel.harness).toBe("grok");
    expect(sel.command).toBe("grok");
    // 그룹의 첫 칸 = 신형(레지스트리 등재 순서 보존).
    expect(sel.modelId).toBe("grok-4.6");
  });
});
