/**
 * DeepSeek V4 env-swap 편입 (JrxWAAGq) — OpenAI 호환 (B)형 벤더.
 *
 * Upstage Solar 와 같은 Codex(gpt) 하네스 env-swap 경로를 탄다.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  MODEL_REGISTRY,
  VENDOR_IDS,
  envProfileForModel,
  getModel,
  harnessForModel,
  registryPricing,
  vendorEnvSecretKeys,
  vendorEnvSecretRef,
  vendorForModel,
} from "../../electron/model-registry";
import {
  AgentConfigGenerator,
  applyVendorEnv,
  harnessForLaunch,
  resolveVendorEnvProfile,
  vendorEnvReadiness,
} from "../../electron/agent-config";
import {
  codexOrchestratorChoices,
  orchestratorVendorGateTarget,
  parseModelSpec,
  quickLaneVendorCatalog,
  resolveModelPin,
  resolveVendorShorthand,
  selectableEfforts,
} from "../../electron/model-selection";
import { LADDER_EXCLUSIONS } from "../../electron/model-ladder";
import { resolveCodexVendorProviderOverride } from "../../electron/codex-vendor-provider";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-deepseek-"));
const FLASH_ID = "deepseek-v4-flash";
const PRO_ID = "deepseek-v4-pro";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com";
const FAKE_KEY = "test-deepseek-key-not-a-real-secret";

function withDeepSeekKey<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.DEEPSEEK_API_KEY;
  if (value === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
}

function launchDeepSeek(modelId: string) {
  const pin = resolveModelPin(modelId);
  const gen = new AgentConfigGenerator();
  const cfg = gen.getLaunchConfig(
    {
      id: `deepseek-${Math.random().toString(36).slice(2)}`,
      model: "gpt",
      role: "backend",
      command: "",
    },
    TMP,
    undefined,
    undefined,
    undefined,
    false,
    "standard",
    pin
      ? {
          codexModel: pin.codexModel,
          codexEffort: pin.codexEffort,
        }
      : undefined,
  );
  return { pin, cfg };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeepSeek 등록 — provider=deepseek / harness=gpt", () => {
  it("벤더 축만 늘고 하네스는 Codex(gpt) 를 재사용한다", () => {
    expect(VENDOR_IDS).toContain("deepseek");
    expect(getModel(FLASH_ID)).toMatchObject({
      id: FLASH_ID,
      provider: "deepseek",
      harness: "gpt",
      status: "active",
      capability: "mid",
      defaultEffort: "high",
    });
    expect(getModel(PRO_ID)).toMatchObject({
      id: PRO_ID,
      provider: "deepseek",
      harness: "gpt",
      status: "active",
      capability: "mid",
      defaultEffort: "high",
    });
    expect(harnessForModel(FLASH_ID)).toBe("gpt");
    expect(vendorForModel(PRO_ID)).toBe("deepseek");
    expect(harnessForLaunch("gpt", PRO_ID)).toBe("gpt");
  });

  it("OpenAI 호환 envProfile 이 base URL 과 DEEPSEEK_API_KEY 참조만 담는다", () => {
    expect(envProfileForModel(FLASH_ID)).toEqual({
      OPENAI_BASE_URL: DEEPSEEK_ENDPOINT,
      OPENAI_API_KEY: "${DEEPSEEK_API_KEY}",
    });
    expect(envProfileForModel(PRO_ID)).toEqual(envProfileForModel(FLASH_ID));
    expect(vendorEnvSecretKeys(FLASH_ID)).toEqual(["DEEPSEEK_API_KEY"]);
    expect(vendorEnvSecretRef("${DEEPSEEK_API_KEY}")).toBe("DEEPSEEK_API_KEY");
    expect(vendorEnvSecretRef(DEEPSEEK_ENDPOINT)).toBeUndefined();
  });

  it("alias 와 벤더 숏핸드는 구체 DeepSeek 모델로 해석된다", () => {
    expect(getModel("deepseek-chat")).toBeUndefined();
    expect(getModel("deepseek-reasoner")).toBeUndefined();
    expect(parseModelSpec(FLASH_ID)?.modelId).toBe(FLASH_ID);
    expect(resolveModelPin(PRO_ID)?.codexModel).toBe(PRO_ID);
    expect(resolveVendorShorthand("deepseek")?.id).toBe(FLASH_ID);
  });

  it("★effort 축이 DeepSeek 공식 models.json 과 일치한다 — low/high/max, 기본 high", () => {
    // 2026-08-21 재확인(티켓 giW7eJbD). DeepSeek 은 Codex 용 `models.json` 을 직접
    // 배포하고(api-docs.deepseek.com/quick_start/agent_integrations/codex) 거기서
    // 두 모델 모두 supported_reasoning_levels = low/high/max, default = high 다.
    //
    // ★종전 이 레지스트리는 low/medium/high + default medium 이었다. DeepSeek 은
    // `medium` 을 **정의하지 않는다** — 즉 우리가 매 스폰에 붙이던 기본 effort 가
    // 벤더에 없는 값이었다. 08-18 에 pricing 페이지만 보고 적었을 때 생긴 오차고,
    // 이 테스트가 그 회귀를 막는다. 값을 바꾸려면 공식 models.json 을 먼저 본다.
    for (const id of [FLASH_ID, PRO_ID]) {
      expect(getModel(id)!.efforts, id).toEqual(["low", "high", "max"]);
      expect(getModel(id)!.defaultEffort, id).toBe("high");
    }
  });

  it("★max 는 승인게이트 칸이라 셀렉터에는 서지 않는다(레지스트리엔 있다)", () => {
    // gpt 행들과 완전히 같은 취급이다. 레지스트리는 벤더 사실을 그대로 적고,
    // 고를 수 있는 칸을 줄이는 것은 `selectableEfforts` 의 몫이다.
    for (const id of [FLASH_ID, PRO_ID]) {
      expect(selectableEfforts(getModel(id)!), id).toEqual(["low", "high"]);
    }
  });

  it("단가는 레지스트리 단일소스로 흘러간다", () => {
    expect(getModel(FLASH_ID)!.pricing).toEqual({
      inputPer1M: 0.44,
      outputPer1M: 1.32,
    });
    expect(registryPricing()[PRO_ID]).toEqual({
      inputPer1M: 1.32,
      outputPer1M: 3.96,
    });
  });
});

describe("DeepSeek 주입 — OPENAI_* 전부-or-전무", () => {
  it("키가 없으면 프로파일 전체가 빠지고 Codex 스폰 자체는 유지된다", () => {
    withDeepSeekKey(undefined, () => {
      expect(vendorEnvReadiness(FLASH_ID)).toEqual({
        vendor: "deepseek",
        hasProfile: true,
        requiredEnvKeys: ["DEEPSEEK_API_KEY"],
        missingEnvKeys: ["DEEPSEEK_API_KEY"],
        ready: false,
        notReadyReason: "missing-credentials",
      });
      const { cfg } = launchDeepSeek(FLASH_ID);
      expect(cfg.command).toBe("codex");
      expect(cfg.args).toContain("-c");
      expect(cfg.args).toContain(`model="${FLASH_ID}"`);
      expect(cfg.env.OPENAI_BASE_URL).toBeUndefined();
      expect(cfg.env.OPENAI_API_KEY).toBeUndefined();
    });
  });

  it("키가 있으면 OPENAI_* 주입 + Codex model_provider=deepseek 강제", () => {
    withDeepSeekKey(FAKE_KEY, () => {
      const { resolved, missing } = resolveVendorEnvProfile(
        envProfileForModel(PRO_ID),
      );
      expect(missing).toEqual([]);
      expect(resolved).toEqual({
        OPENAI_BASE_URL: DEEPSEEK_ENDPOINT,
        OPENAI_API_KEY: FAKE_KEY,
      });
      expect(vendorEnvReadiness(PRO_ID).ready).toBe(true);

      const { cfg } = launchDeepSeek(PRO_ID);
      expect(cfg.env.OPENAI_BASE_URL).toBe(DEEPSEEK_ENDPOINT);
      expect(cfg.env.OPENAI_API_KEY).toBe(FAKE_KEY);
      expect(cfg.env.DEEPSEEK_API_KEY).toBe(FAKE_KEY);
      expect(cfg.env.CODEX_HOME).toBeTruthy();
      expect(cfg.args).toContain(`model_provider="deepseek"`);

      const configToml = fs.readFileSync(
        path.join(String(cfg.env.CODEX_HOME), "config.toml"),
        "utf-8",
      );
      expect(configToml).toMatch(/model_provider\s*=\s*"deepseek"/);
      expect(configToml).toContain("[model_providers.deepseek]");
      expect(configToml).toContain('env_key = "DEEPSEEK_API_KEY"');
      expect(configToml).toContain('wire_api = "responses"');
      expect(configToml).toContain(`base_url = "${DEEPSEEK_ENDPOINT}"`);
    });
  });

  it("applyVendorEnv 는 키 없을 때 부분 주입하지 않는다", () => {
    withDeepSeekKey(undefined, () => {
      const base = { OPENAI_API_KEY: "original-openai-key" };
      expect(applyVendorEnv(base, FLASH_ID)).toBe(base);
      expect(base.OPENAI_API_KEY).toBe("original-openai-key");
      expect(base.OPENAI_BASE_URL).toBeUndefined();
    });
  });
});

describe("DeepSeek 키 부재 — 조용히 실패하지 않는다", () => {
  // 완료기준(티켓 giW7eJbD): "키가 없을 때 조용히 실패하지 않는다 — 사유가 화면이나
  // 로그에 남을 것." Solar 때 브리지가 조용히 죽어 404 로 보였던 게 하루를 태웠다.
  //
  // ★이 계약은 **키가 없는 지금이 검증 적기**다. 키를 받은 뒤에는 이 경로를
  // 재현하려면 일부러 키를 빼야 한다.
  it("★벤더 모델인데 크레덴셜이 없으면 사유를 로그로 남기고 null 을 준다", () => {
    withDeepSeekKey(undefined, () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(resolveCodexVendorProviderOverride(FLASH_ID)).toBeNull();

      expect(spy).toHaveBeenCalled();
      const [message, detail] = spy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(message).toContain("codex-vendor-provider");
      expect(detail).toMatchObject({
        model: FLASH_ID,
        vendor: "deepseek",
        missingEnvKeys: ["DEEPSEEK_API_KEY"],
      });
      // 화면/로그에 **왜 위험한지**가 남아야 한다 — null 만 돌려주면 호출자는
      // model_provider 없이(=ChatGPT 백엔드로) 벤더 slug 를 물어보게 된다.
      expect(String(detail.effect)).toContain("400");
      expect(String(detail.fix)).toContain("DEEPSEEK_API_KEY");
    });
  });

  it("★그 로그에 시크릿 값은 절대 안 실린다 — 키 이름만", () => {
    withDeepSeekKey(undefined, () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      resolveCodexVendorProviderOverride(PRO_ID);
      const serialized = JSON.stringify(spy.mock.calls);
      expect(serialized).not.toContain(FAKE_KEY);
      expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
    });
  });

  it("키가 있으면 조용하다(정상 경로에 노이즈를 만들지 않는다)", () => {
    withDeepSeekKey(FAKE_KEY, () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(resolveCodexVendorProviderOverride(FLASH_ID)).toMatchObject({
        providerId: "deepseek",
        wireApi: "responses",
        needsChatBridge: false,
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("벤더가 아닌 모델은 로그도 안 남긴다(경고 인플레 방지)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveCodexVendorProviderOverride("gpt-5.5")).toBeNull();
    expect(resolveCodexVendorProviderOverride(undefined)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("DeepSeek 라우팅/오케 경계", () => {
  it("자동선택 사다리에서는 빠지고 명시 스폰/퀵레인 전용으로 남는다", () => {
    expect(LADDER_EXCLUSIONS[FLASH_ID]).toContain("스폰/퀵레인");
    expect(LADDER_EXCLUSIONS[PRO_ID]).toContain("스폰 전용");
  });

  it("★오케스트레이터 후보에 편입됐다 — 단, 런타임 잔액 게이트를 조건으로", () => {
    // 2026-08-21(7HthjBEf). 종전 이 테스트는 "빠진다" 를 주장했고 그 근거는
    // "영구 저장되는 기본값에 조건부 크레덴셜을 얹지 않는다" 였다. 그 근거는
    // **폐기되지 않았다** — 바뀐 것은 DeepSeek 의 조건부성을 런타임에 관측할 수
    // 있게 됐다는 사실 하나다(`vendor-balance` 의 `GET /user/balance`).
    //
    // 그래서 이 테스트가 보는 것은 "칸이 선다" 까지고, 그 칸이 실제로 뜰지는
    // `orchestrator-vendor-gate.test.ts` 가 본다. 둘을 한 테스트에 합치면
    // "목록에 있다 = 띄울 수 있다" 라는, 이 티켓이 부수려는 등식이 되살아난다.
    const choices = codexOrchestratorChoices();
    expect(choices.map((c) => c.modelId)).toContain(FLASH_ID);
    expect(choices.map((c) => c.modelId)).toContain(PRO_ID);
    // 벤더 표기 라벨 — 사용자가 "이건 내 키로 도는 벤더" 임을 목록에서 알아야 한다.
    const flash = choices.find((c) => c.modelId === FLASH_ID)!;
    expect(flash.label).toBe(`DeepSeek (${FLASH_ID})`);
    expect(flash.vendor).toBe("deepseek");
    expect(flash.runtimeGated).toBe(true);
    expect(flash.requiredEnvKeys).toEqual(["DEEPSEEK_API_KEY"]);
    // 네이티브 칸은 종전 그대로다(게이트가 안 붙는다 = 벤더 API 를 안 때린다).
    for (const c of choices.filter((x) => x.vendor === "openai")) {
      expect(c.runtimeGated, c.value).toBe(false);
      expect(c.requiredEnvKeys, c.value).toEqual([]);
    }
  });

  it("★게이트 대상 판정이 DeepSeek 핀에만 붙는다(네이티브 경로 무변경)", () => {
    // main 의 3번째 관문이 "이 스폰에 잔액을 물어봐야 하나" 를 이 함수로 묻는다.
    // 네이티브 칸이 null 이 아니게 되는 순간 모든 오케 스폰이 벤더 API 를 때린다.
    expect(orchestratorVendorGateTarget("codex:deepseek-v4-flash")).toMatchObject(
      {
        vendor: "deepseek",
        vendorLabel: "DeepSeek",
        modelId: FLASH_ID,
        requiredEnvKeys: ["DEEPSEEK_API_KEY"],
      },
    );
    for (const setting of [
      "claude",
      "codex",
      "grok",
      "antigravity",
      "claude:claude-opus-5",
      "codex:gpt-5.6-sol@high",
      "grok:grok-4.6",
    ]) {
      expect(orchestratorVendorGateTarget(setting), setting).toBeNull();
    }
  });

  it("퀵레인/벤더 키 UI 계약에는 DeepSeek 카드가 파생된다", () => {
    const deepseek = quickLaneVendorCatalog().find(
      (group) => group.vendor === "deepseek",
    );
    expect(deepseek).toMatchObject({
      vendor: "deepseek",
      label: "DeepSeek",
      harness: "gpt",
      command: "codex",
      requiredEnvKeys: ["DEEPSEEK_API_KEY"],
    });
    expect(deepseek?.models.map((m) => m.modelId)).toEqual([FLASH_ID, PRO_ID]);
  });

  it("레지스트리에 시크릿 값처럼 생긴 리터럴이 없다", () => {
    const serialized = JSON.stringify(
      MODEL_REGISTRY.filter((entry) => entry.provider === "deepseek"),
    );
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
