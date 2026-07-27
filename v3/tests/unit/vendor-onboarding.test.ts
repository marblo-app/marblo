/**
 * 시작하기 탭 **벤더 카드 ↔ 모델 레지스트리 단일소스 게이트**.
 *
 * 이 테스트가 지키는 것은 화면 문구가 아니라 불변식 하나다: **시작하기 탭의 벤더
 * 목록은 레지스트리에서 파생된다.** 레지스트리에 벤더 행을 넣으면 카드가 저절로
 * 생겨야 하고, 렌더러 어딘가에 벤더 배열이 되살아나면 여기서 깨져야 한다.
 *
 * 그래서 입력을 실제 카탈로그 함수(`quickLaneVendorCatalog`)로 만든다 — 픽스처를
 * 손으로 적으면 "레지스트리와 같은가" 를 검사할 수 없다.
 */
import { describe, it, expect } from "vitest";
import { quickLaneVendorCatalog } from "../../electron/model-selection";
import {
  MODEL_REGISTRY,
  HARNESS_NATIVE_VENDOR,
  vendorEnvSecretKeys,
} from "../../electron/model-registry";
import {
  additionalVendorCards,
  vendorReadyCount,
  vendorSetupCards,
  type CliRowLike,
  type VendorCatalogGroupLike,
  type VendorSetupInput,
} from "../../src/lib/vendorOnboarding";

/** `cliSetupStore.ROWS` / `ORCHESTRATOR_CLI_IDS` 의 사본(렌더러 store 를 안 끌어온다). */
const CLI_ROWS: CliRowLike[] = [
  { id: "cli-claude-code", model: "claude" },
  { id: "cli-codex", model: "codex" },
  { id: "cli-grok", model: "grok" },
  { id: "cli-antigravity", model: "antigravity" },
];
const ORCHESTRATOR_ROW_IDS = ["cli-claude-code", "cli-codex"];

/** 렌더러가 받는 모양(available/missingEnvKeys 는 main 이 얹는다)으로 접는다. */
function catalogGroups(
  presentEnv: Record<string, string> = {},
): VendorCatalogGroupLike[] {
  return quickLaneVendorCatalog().map((g) => {
    const missingEnvKeys = g.requiredEnvKeys.filter((k) => !presentEnv[k]);
    return {
      vendor: g.vendor,
      label: g.label,
      harness: g.harness,
      command: g.command,
      requiredEnvKeys: [...g.requiredEnvKeys],
      missingEnvKeys,
      available: missingEnvKeys.length === 0,
      models: g.models.map((m) => ({ modelId: m.modelId })),
    };
  });
}

function input(over: Partial<VendorSetupInput> = {}): VendorSetupInput {
  return {
    cliRows: CLI_ROWS,
    orchestratorRowIds: ORCHESTRATOR_ROW_IDS,
    cliStates: {},
    vendorSecrets: null,
    ...over,
  };
}

/** 레지스트리에서 직접 뽑은 "env-swap 벤더" 집합 = envProfile 을 가진 행들의 벤더. */
const ENV_SWAP_VENDORS = new Set(
  MODEL_REGISTRY.filter((m) => m.status === "active" && m.envProfile).map(
    (m) => m.provider,
  ),
);

describe("vendorSetupCards — 레지스트리 파생", () => {
  it("활성 레지스트리 벤더를 하나도 빠뜨리지 않는다", () => {
    const cards = vendorSetupCards(catalogGroups(), input());
    const fromRegistry = new Set(
      MODEL_REGISTRY.filter((m) => m.status === "active").map(
        (m) => m.provider,
      ),
    );
    expect(new Set(cards.map((c) => c.vendor))).toEqual(fromRegistry);
  });

  it("카드의 모델 id 는 그 벤더의 활성 레지스트리 행과 정확히 같다", () => {
    for (const card of vendorSetupCards(catalogGroups(), input())) {
      const expected = MODEL_REGISTRY.filter(
        (m) =>
          m.status === "active" &&
          m.provider === card.vendor &&
          m.harness === card.harness,
      ).map((m) => m.id);
      expect([...card.modelIds].sort()).toEqual([...expected].sort());
      // dispatch 예시는 반드시 실재하는 id 여야 한다(존재하지 않는 id 를 예시로
      // 주면 사용자가 그대로 복사해 유령 모델로 스폰한다).
      expect(card.modelIds).toContain(card.exampleModelId);
    }
  });

  it("envProfile 을 가진 벤더만 envSwap 으로 분류한다", () => {
    for (const card of vendorSetupCards(catalogGroups(), input())) {
      expect(card.kind === "envSwap").toBe(ENV_SWAP_VENDORS.has(card.vendor));
      // 분류 근거는 벤더 이름이 아니라 "필요한 키가 있는가" 하나다.
      expect(card.requiredEnvKeys.length > 0).toBe(card.kind === "envSwap");
    }
  });

  it("오케 후보 CLI(①②단계)는 orchestratorCli 로 접히고 목록에서 빠진다", () => {
    const cards = vendorSetupCards(catalogGroups(), input());
    const orchestratorVendors = cards
      .filter((c) => c.kind === "orchestratorCli")
      .map((c) => c.vendor);
    // 오케 후보 = 그 하네스의 네이티브 벤더(claude→anthropic, codex→openai).
    expect(orchestratorVendors.sort()).toEqual(
      [HARNESS_NATIVE_VENDOR.claude, HARNESS_NATIVE_VENDOR.gpt].sort(),
    );
    const shown = additionalVendorCards(cards).map((c) => c.vendor);
    for (const v of orchestratorVendors) expect(shown).not.toContain(v);
  });

  it("자기 CLI 로 붙는 비-오케 벤더는 nativeCli 이고 ROWS 행을 물고 온다", () => {
    const native = vendorSetupCards(catalogGroups(), input()).filter(
      (c) => c.kind === "nativeCli",
    );
    expect(native.length).toBeGreaterThan(0);
    for (const card of native) {
      expect(card.requiredEnvKeys).toEqual([]);
      // 행이 없으면 설치/로그인 UI 를 붙일 곳이 없다 — 조용히 빈 카드가 된다.
      expect(card.cliRowId).toBeTruthy();
      expect(CLI_ROWS.map((r) => r.id)).toContain(card.cliRowId);
    }
  });
});

describe("상태 판정", () => {
  it("env-swap 벤더는 키가 채워지면 ready 로 바뀐다", () => {
    const before = additionalVendorCards(
      vendorSetupCards(catalogGroups(), input()),
    ).filter((c) => c.kind === "envSwap");
    expect(before.length).toBeGreaterThan(0);
    for (const card of before) {
      expect(card.status).toBe("needsKey");
      expect(card.missingEnvKeys).toEqual(card.requiredEnvKeys);
    }

    // 모든 env-swap 키를 채운 머신.
    const present: Record<string, string> = {};
    for (const entry of MODEL_REGISTRY) {
      for (const key of vendorEnvSecretKeys(entry.id)) present[key] = "x";
    }
    const after = vendorSetupCards(catalogGroups(present), input()).filter(
      (c) => c.kind === "envSwap",
    );
    for (const card of after) expect(card.status).toBe("ready");
  });

  it("키체인 스냅샷이 process.env 판정을 이긴다(#624 로 등록한 키)", () => {
    const groups = catalogGroups(); // process.env 에는 아무 키도 없다
    const envSwap = vendorSetupCards(groups, input()).filter(
      (c) => c.kind === "envSwap",
    );
    const target = envSwap[0];
    const cards = vendorSetupCards(
      groups,
      input({
        vendorSecrets: {
          vendors: [
            {
              vendor: target.vendor,
              ready: true,
              keys: target.requiredEnvKeys.map((envKey) => ({
                envKey,
                source: "store",
              })),
            },
          ],
        },
      }),
    );
    const got = cards.find((c) => c.vendor === target.vendor);
    expect(got?.status).toBe("ready");
    expect(got?.missingEnvKeys).toEqual([]);
    // 스냅샷에 없는 벤더는 카탈로그 판정 그대로 남는다.
    for (const other of envSwap.slice(1)) {
      expect(cards.find((c) => c.vendor === other.vendor)?.status).toBe(
        "needsKey",
      );
    }
  });

  it("CLI 벤더는 프로브 결과에 따라 설치/로그인/사용가능으로 갈린다", () => {
    const groups = catalogGroups();
    const nativeCard = vendorSetupCards(groups, input()).find(
      (c) => c.kind === "nativeCli",
    );
    const rowId = nativeCard!.cliRowId!;

    // 프로브 전 = 단정하지 않는다.
    expect(nativeCard!.status).toBe("unknown");

    const statusWith = (state: {
      installed: boolean;
      authenticated: boolean;
      checking?: boolean;
    }) =>
      vendorSetupCards(groups, input({ cliStates: { [rowId]: state } })).find(
        (c) => c.cliRowId === rowId,
      )!.status;

    expect(statusWith({ installed: false, authenticated: false })).toBe(
      "needsInstall",
    );
    expect(statusWith({ installed: true, authenticated: false })).toBe(
      "needsLogin",
    );
    expect(statusWith({ installed: true, authenticated: true })).toBe("ready");
    // 프로브 중에는 이전 결과로 단정하지 않는다.
    expect(
      statusWith({ installed: false, authenticated: false, checking: true }),
    ).toBe("unknown");
  });

  it("vendorReadyCount 는 ready 카드만 센다", () => {
    const cards = additionalVendorCards(
      vendorSetupCards(catalogGroups(), input()),
    );
    expect(vendorReadyCount(cards)).toBe(
      cards.filter((c) => c.status === "ready").length,
    );
  });
});
