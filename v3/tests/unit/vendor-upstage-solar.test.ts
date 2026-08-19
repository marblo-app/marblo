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
  parseModelSpec,
  quickLaneVendorCatalog,
  resolveModelPin,
  resolveVendorShorthand,
} from "../../electron/model-selection";
import { ladderFor } from "../../electron/model-ladder";

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
      : undefined
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
        envProfileForModel(SOLAR_ID)
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
      expect(configToml).toContain('wire_api = "chat"');
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
      (r) => r.model === SOLAR_ID
    );
    expect(solarRungs.map((r) => r.effort)).toEqual(["low", "medium", "high"]);
  });

  it("오케스트레이터 후보에서는 빠진다(네이티브 Codex 만 오케 후보)", () => {
    const choices = codexOrchestratorChoices();
    expect(choices.map((c) => c.modelId)).not.toContain(SOLAR_ID);
    expect(choices.every((c) => c.vendor === "openai")).toBe(true);
  });

  it("퀵레인/벤더 키 UI 계약에는 Upstage 카드가 파생된다", () => {
    const upstage = quickLaneVendorCatalog().find(
      (group) => group.vendor === "upstage"
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
      MODEL_REGISTRY.filter((entry) => entry.provider === "upstage")
    );
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
