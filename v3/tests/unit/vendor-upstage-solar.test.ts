/**
 * Upstage Solar Pro env-swap 편입 (tUlSJc0J) — OpenAI 호환 (B)형 벤더.
 *
 * GLM/MiniMax/Kimi 와 같은 데이터 편입이지만, Anthropic 호환이 아니라 Codex(gpt)
 * 하네스의 OPENAI_BASE_URL 스왑 경로를 탄다.
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
  normalizeOrchestratorModelSetting,
  ORCHESTRATOR_RUNTIME_GATED_VENDORS,
  parseModelSpec,
  quickLaneVendorCatalog,
  resolveModelPin,
  resolveVendorShorthand,
} from "../../electron/model-selection";
import { ladderFor } from "../../electron/model-ladder";
import {
  resolveCodexVendorProviderOverride,
  upstageNeedsChatBridge,
} from "../../electron/codex-vendor-provider";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-upstage-"));
const SOLAR_ID = "solar-pro4";
const UPSTAGE_ENDPOINT = "https://api.upstage.ai/v1";
const FAKE_KEY = "test-upstage-key-not-a-real-secret";

function withUpstageKey<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.UPSTAGE_API_KEY;
  if (value === undefined) delete process.env.UPSTAGE_API_KEY;
  else process.env.UPSTAGE_API_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.UPSTAGE_API_KEY;
    else process.env.UPSTAGE_API_KEY = prev;
  }
}

function launchSolar() {
  const pin = resolveModelPin(SOLAR_ID);
  const gen = new AgentConfigGenerator();
  const cfg = gen.getLaunchConfig(
    {
      id: `solar-${Math.random().toString(36).slice(2)}`,
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

describe("Upstage Solar 등록 — provider=upstage / harness=gpt", () => {
  it("벤더 축만 늘고 하네스는 Codex(gpt) 를 재사용한다", () => {
    expect(VENDOR_IDS).toContain("upstage");
    expect(getModel(SOLAR_ID)).toMatchObject({
      id: SOLAR_ID,
      provider: "upstage",
      harness: "gpt",
      status: "active",
      capability: "mid",
      defaultEffort: "medium",
    });
    expect(harnessForModel(SOLAR_ID)).toBe("gpt");
    expect(vendorForModel(SOLAR_ID)).toBe("upstage");
    expect(harnessForLaunch("gpt", SOLAR_ID)).toBe("gpt");
  });

  it("OpenAI 호환 envProfile 이 공식 base URL 과 UPSTAGE_API_KEY 참조만 담는다", () => {
    expect(envProfileForModel(SOLAR_ID)).toEqual({
      OPENAI_BASE_URL: UPSTAGE_ENDPOINT,
      OPENAI_API_KEY: "${UPSTAGE_API_KEY}",
    });
    expect(vendorEnvSecretKeys(SOLAR_ID)).toEqual(["UPSTAGE_API_KEY"]);
    expect(vendorEnvSecretRef("${UPSTAGE_API_KEY}")).toBe("UPSTAGE_API_KEY");
    expect(vendorEnvSecretRef(UPSTAGE_ENDPOINT)).toBeUndefined();
  });

  it("티켓 예시 solar-pro 는 alias 로만 받고 API/cost_logs 로 나가는 id 는 solar-pro4 다", () => {
    expect(getModel("solar-pro")?.id).toBe(SOLAR_ID);
    expect(parseModelSpec("solar-pro")?.modelId).toBe(SOLAR_ID);
    expect(resolveModelPin("solar-pro")?.codexModel).toBe(SOLAR_ID);
    expect(resolveVendorShorthand("solar")?.id).toBe(SOLAR_ID);
    expect(resolveVendorShorthand("upstage")?.id).toBe(SOLAR_ID);
  });

  it("단가는 공식 Solar Pro 4 정가이고 cost-tracker 단일소스로 흘러간다", () => {
    expect(getModel(SOLAR_ID)!.pricing).toEqual({
      inputPer1M: 0.3,
      outputPer1M: 1.2,
    });
    expect(registryPricing()[SOLAR_ID]).toEqual({
      inputPer1M: 0.3,
      outputPer1M: 1.2,
    });
  });
});

describe("Upstage Solar 주입 — OPENAI_* 전부-or-전무", () => {
  it("키가 없으면 프로파일 전체가 빠지고 Codex 스폰 자체는 유지된다", () => {
    withUpstageKey(undefined, () => {
      expect(vendorEnvReadiness(SOLAR_ID)).toEqual({
        vendor: "upstage",
        hasProfile: true,
        requiredEnvKeys: ["UPSTAGE_API_KEY"],
        missingEnvKeys: ["UPSTAGE_API_KEY"],
        ready: false,
      });
      const { cfg } = launchSolar();
      expect(cfg.command).toBe("codex");
      expect(cfg.args).toContain("-c");
      expect(cfg.args).toContain(`model="${SOLAR_ID}"`);
      expect(cfg.env.OPENAI_BASE_URL).toBeUndefined();
      expect(cfg.env.OPENAI_API_KEY).toBeUndefined();
    });
  });

  it("키가 있으면 OPENAI_* 주입 + Codex model_provider=upstage 강제", () => {
    withUpstageKey(FAKE_KEY, () => {
      const { resolved, missing } = resolveVendorEnvProfile(
        envProfileForModel(SOLAR_ID),
      );
      expect(missing).toEqual([]);
      expect(resolved).toEqual({
        OPENAI_BASE_URL: UPSTAGE_ENDPOINT,
        OPENAI_API_KEY: FAKE_KEY,
      });
      expect(vendorEnvReadiness(SOLAR_ID).ready).toBe(true);

      const { cfg } = launchSolar();
      expect(cfg.env.OPENAI_BASE_URL).toBe(UPSTAGE_ENDPOINT);
      expect(cfg.env.OPENAI_API_KEY).toBe(FAKE_KEY);
      // Codex env_key=UPSTAGE_API_KEY 경로 — ChatGPT 계정 우회용
      expect(cfg.env.UPSTAGE_API_KEY).toBe(FAKE_KEY);
      expect(cfg.env.CODEX_HOME).toBeTruthy();
      expect(cfg.args).toContain(`model_provider="upstage"`);

      const configToml = fs.readFileSync(
        path.join(String(cfg.env.CODEX_HOME), "config.toml"),
        "utf-8",
      );
      expect(configToml).toMatch(/model_provider\s*=\s*"upstage"/);
      expect(configToml).toContain("[model_providers.upstage]");
      expect(configToml).toContain('env_key = "UPSTAGE_API_KEY"');
      // codex 0.148.0 은 wire_api="chat" 을 설정 로드 단계에서 거부한다
      // (`no longer supported`, EXIT=1). Upstage 는 /v1/chat/completions 만
      // 열려 있으므로 responses + 로컬 브리지가 유일한 통로다.
      expect(configToml).toContain('wire_api = "responses"');
      expect(configToml).not.toContain('wire_api = "chat"');
      // ★여기 base_url 이 upstream 인 것은 정상이 아니라 **테스트 한정**이다:
      //   VITEST=true 라 buildCodexVendorProviderToml 의 skipBridge 가 켜져
      //   브리지를 안 띄운다. 실제 스폰에서 base_url 이 localhost 브리지를
      //   가리키는지는 agent-config-codex-chat-bridge.test.ts 가 skipBridge 를
      //   꺼놓고 단언한다.
      expect(process.env.VITEST).toBe("true");
      expect(configToml).toContain(`base_url = "${UPSTAGE_ENDPOINT}"`);
      expect(configToml).toContain('preferred_auth_method = "apikey"');
      expect(configToml).toContain('forced_login_method = "api"');
      expect(configToml).toContain("requires_openai_auth = false");
      // ChatGPT auth.json must not be linked for vendor override.
      expect(
        fs.existsSync(path.join(String(cfg.env.CODEX_HOME), "auth.json")),
      ).toBe(false);
    });
  });

  it("applyVendorEnv 는 키 없을 때 부분 주입하지 않는다", () => {
    withUpstageKey(undefined, () => {
      const base = { OPENAI_API_KEY: "original-openai-key" };
      expect(applyVendorEnv(base, SOLAR_ID)).toBe(base);
      expect(base.OPENAI_API_KEY).toBe("original-openai-key");
      expect(base.OPENAI_BASE_URL).toBeUndefined();
    });
  });
});

describe("Upstage Solar 라우팅/오케 경계", () => {
  it("gpt 사다리에 있어 워커 자동선택 후보가 될 수 있다", () => {
    const solarRungs = ladderFor("gpt")!.rungs.filter(
      (r) => r.model === SOLAR_ID,
    );
    expect(solarRungs.map((r) => r.effort)).toEqual(["low", "medium", "high"]);
  });

  it("★오케스트레이터 후보에서는 여전히 빠진다 — DeepSeek 예외가 여기로 안 샌다", () => {
    // 2026-08-21(7HthjBEf) 회귀 락. 그날 오케 셀렉터의 "네이티브 벤더만" 필터가
    // 처음으로 열렸지만, 열린 것은 **DeepSeek 하나뿐**이다. Solar 가 같이 열리면
    // 안 되는 이유는 취향이 아니라 사실이다:
    //
    //   · 예외의 전제는 "조건부성을 런타임에 관측할 수 있다" 인데, Upstage 는
    //     잔여 쿼터 조회 API 를 공개하지 않아 `vendor-balance.BALANCE_PROBES` 에
    //     항목이 없다(`src/lib/vendorBilling.ts` 의 `quotaApi: null`).
    //   · 그래서 Solar 를 열면 "키가 빠진 순간부터 매 재시작이 말없이 네이티브
    //     백엔드로 새는" 원래의 실패모드가 그대로 돌아온다 — 이 레포가 Solar 로
    //     하루를 태운 그 실패다.
    //
    // 이 단언이 깨지는 날은 Upstage 에 소진 관측이 생긴 날이어야 한다.
    const choices = codexOrchestratorChoices();
    expect(choices.map((c) => c.modelId)).not.toContain(SOLAR_ID);
    expect(choices.some((c) => c.vendor === "upstage")).toBe(false);
    // 오케 후보로 선 벤더는 네이티브(openai) 아니면 런타임 게이트 벤더뿐이다.
    for (const c of choices) {
      expect(
        c.vendor === "openai" ||
          ORCHESTRATOR_RUNTIME_GATED_VENDORS.has(c.vendor!),
        c.value,
      ).toBe(true);
    }
    // 저장값·env·손편집으로 들어온 Solar 핀도 종전대로 강등된다(두 문이 같은 술어).
    expect(normalizeOrchestratorModelSetting(`codex:${SOLAR_ID}`)).toBe(
      "codex",
    );
  });

  it("퀵레인/벤더 키 UI 계약에는 Upstage 카드가 파생된다", () => {
    const upstage = quickLaneVendorCatalog().find(
      (group) => group.vendor === "upstage",
    );
    expect(upstage).toMatchObject({
      vendor: "upstage",
      label: "Upstage Solar",
      harness: "gpt",
      command: "codex",
      requiredEnvKeys: ["UPSTAGE_API_KEY"],
    });
    expect(upstage?.models.map((m) => m.modelId)).toEqual([SOLAR_ID]);
  });

  it("레지스트리에 시크릿 값처럼 생긴 리터럴이 없다", () => {
    const serialized = JSON.stringify(
      MODEL_REGISTRY.filter((entry) => entry.provider === "upstage"),
    );
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★티켓 pW7c7b0p2FdAmhaLj1Xq — 브리지 on/off 축.
//
// Upstage 가 Codex 용 /v1/responses 를 공식 지원한다고 공지했다
// (console.upstage.ai/docs/integrations/codex). 공식 launcher(codex-solar.sh)
// 라이브 실측: wire_api="responses" 가 브리지 없이 base_url=https://api.upstage.ai/v1
// 를 직접 가리킨다 — 즉 저쪽 스크립트는 우리 로컬 브리지를 쓰지 않는다.
// 그렇다고 우리 기본값을 바로 뒤집지 않는다: 2026-08-20 라운드(3/12)가 유일한
// 검증된 실측치이고, 그 조건(브리지 경유)에서 나온 숫자다. 이 축은 **켜고
// 끄는 것**이지 **뒤집는 것**이 아니다 — 삭제 없이 되돌릴 수 있어야 한다.
// ─────────────────────────────────────────────────────────────────────────
describe("upstageNeedsChatBridge / resolveCodexVendorProviderOverride — 브리지 토글", () => {
  const KEY = "MARBLO_UPSTAGE_NATIVE_RESPONSES";

  afterEach(() => {
    delete process.env[KEY];
  });

  it("기본값(env 없음)은 브리지가 필요하다 — 라이브 미검증 상태의 안전 기본값", () => {
    expect(upstageNeedsChatBridge()).toBe(true);
  });

  it("env=1 이면 브리지 불필요로 뒤집힌다", () => {
    process.env[KEY] = "1";
    expect(upstageNeedsChatBridge()).toBe(false);
  });

  it("env=true 문자열도 켠다", () => {
    process.env[KEY] = "true";
    expect(upstageNeedsChatBridge()).toBe(false);
  });

  it("다른 값(빈 문자열·0·대문자·오타)은 켜지지 않는다 — 실수로 조건이 안 바뀐다", () => {
    for (const v of ["0", "", "TRUE", "yes", "on"]) {
      process.env[KEY] = v;
      expect(upstageNeedsChatBridge()).toBe(true);
    }
  });

  it("resolveCodexVendorProviderOverride 의 needsChatBridge 가 토글을 그대로 반영한다", () => {
    withUpstageKey(FAKE_KEY, () => {
      expect(resolveCodexVendorProviderOverride(SOLAR_ID)).toMatchObject({
        providerId: "upstage",
        needsChatBridge: true,
      });
      process.env[KEY] = "1";
      expect(resolveCodexVendorProviderOverride(SOLAR_ID)).toMatchObject({
        providerId: "upstage",
        needsChatBridge: false,
      });
    });
  });

  it("DeepSeek 는 이미 브리지가 없으므로 이 토글의 영향을 받지 않는다", () => {
    process.env[KEY] = "1";
    withUpstageKey(FAKE_KEY, () => {
      // DeepSeek 은 별도 env 키가 필요하므로 여기서는 upstage override 가
      // DeepSeek 판정 함수 자체를 건드리지 않는다는 것만 확인한다(교차오염 방지).
      expect(
        resolveCodexVendorProviderOverride(SOLAR_ID)?.needsChatBridge,
      ).toBe(false);
    });
  });
});
