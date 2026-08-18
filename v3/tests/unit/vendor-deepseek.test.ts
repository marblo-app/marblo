/**
 * DeepSeek V3/R1 env-swap 편입 (JrxWAAGq) — OpenAI 호환 (B)형 벤더.
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
  parseModelSpec,
  quickLaneVendorCatalog,
  resolveModelPin,
  resolveVendorShorthand,
} from "../../electron/model-selection";
import { LADDER_EXCLUSIONS } from "../../electron/model-ladder";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-deepseek-"));
const CHAT_ID = "deepseek-chat";
const REASONER_ID = "deepseek-reasoner";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1";
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
    expect(getModel(CHAT_ID)).toMatchObject({
      id: CHAT_ID,
      provider: "deepseek",
      harness: "gpt",
      status: "active",
      capability: "mid",
      defaultEffort: "medium",
    });
    expect(getModel(REASONER_ID)).toMatchObject({
      id: REASONER_ID,
      provider: "deepseek",
      harness: "gpt",
      status: "active",
      capability: "mid",
      defaultEffort: "medium",
    });
    expect(harnessForModel(CHAT_ID)).toBe("gpt");
    expect(vendorForModel(REASONER_ID)).toBe("deepseek");
    expect(harnessForLaunch("gpt", REASONER_ID)).toBe("gpt");
  });

  it("OpenAI 호환 envProfile 이 base URL 과 DEEPSEEK_API_KEY 참조만 담는다", () => {
    expect(envProfileForModel(CHAT_ID)).toEqual({
      OPENAI_BASE_URL: DEEPSEEK_ENDPOINT,
      OPENAI_API_KEY: "${DEEPSEEK_API_KEY}",
    });
    expect(envProfileForModel(REASONER_ID)).toEqual(
      envProfileForModel(CHAT_ID),
    );
    expect(vendorEnvSecretKeys(CHAT_ID)).toEqual(["DEEPSEEK_API_KEY"]);
    expect(vendorEnvSecretRef("${DEEPSEEK_API_KEY}")).toBe("DEEPSEEK_API_KEY");
    expect(vendorEnvSecretRef(DEEPSEEK_ENDPOINT)).toBeUndefined();
  });

  it("alias 와 벤더 숏핸드는 구체 DeepSeek 모델로 해석된다", () => {
    expect(getModel("deepseek-v3")?.id).toBe(CHAT_ID);
    expect(parseModelSpec("deepseek-r1")?.modelId).toBe(REASONER_ID);
    expect(resolveModelPin("deepseek-r1")?.codexModel).toBe(REASONER_ID);
    expect(resolveVendorShorthand("deepseek")?.id).toBe(CHAT_ID);
  });

  it("단가는 레지스트리 단일소스로 흘러간다", () => {
    expect(getModel(CHAT_ID)!.pricing).toEqual({
      inputPer1M: 0.27,
      outputPer1M: 1.1,
      estimated: true,
    });
    expect(registryPricing()[REASONER_ID]).toEqual({
      inputPer1M: 0.55,
      outputPer1M: 2.19,
    });
  });
});

describe("DeepSeek 주입 — OPENAI_* 전부-or-전무", () => {
  it("키가 없으면 프로파일 전체가 빠지고 Codex 스폰 자체는 유지된다", () => {
    withDeepSeekKey(undefined, () => {
      expect(vendorEnvReadiness(CHAT_ID)).toEqual({
        vendor: "deepseek",
        hasProfile: true,
        requiredEnvKeys: ["DEEPSEEK_API_KEY"],
        missingEnvKeys: ["DEEPSEEK_API_KEY"],
        ready: false,
      });
      const { cfg } = launchDeepSeek(CHAT_ID);
      expect(cfg.command).toBe("codex");
      expect(cfg.args).toContain("-c");
      expect(cfg.args).toContain(`model="${CHAT_ID}"`);
      expect(cfg.env.OPENAI_BASE_URL).toBeUndefined();
      expect(cfg.env.OPENAI_API_KEY).toBeUndefined();
    });
  });

  it("키가 있으면 OPENAI_BASE_URL 과 OPENAI_API_KEY 가 함께 주입된다", () => {
    withDeepSeekKey(FAKE_KEY, () => {
      const { resolved, missing } = resolveVendorEnvProfile(
        envProfileForModel(REASONER_ID),
      );
      expect(missing).toEqual([]);
      expect(resolved).toEqual({
        OPENAI_BASE_URL: DEEPSEEK_ENDPOINT,
        OPENAI_API_KEY: FAKE_KEY,
      });
      expect(vendorEnvReadiness(REASONER_ID).ready).toBe(true);

      const { cfg } = launchDeepSeek(REASONER_ID);
      expect(cfg.env.OPENAI_BASE_URL).toBe(DEEPSEEK_ENDPOINT);
      expect(cfg.env.OPENAI_API_KEY).toBe(FAKE_KEY);
      expect(cfg.env.CODEX_HOME).toBeTruthy();
    });
  });

  it("applyVendorEnv 는 키 없을 때 부분 주입하지 않는다", () => {
    withDeepSeekKey(undefined, () => {
      const base = { OPENAI_API_KEY: "original-openai-key" };
      expect(applyVendorEnv(base, CHAT_ID)).toBe(base);
      expect(base.OPENAI_API_KEY).toBe("original-openai-key");
      expect(base.OPENAI_BASE_URL).toBeUndefined();
    });
  });
});

describe("DeepSeek 라우팅/오케 경계", () => {
  it("자동선택 사다리에서는 빠지고 명시 스폰/퀵레인 전용으로 남는다", () => {
    expect(LADDER_EXCLUSIONS[CHAT_ID]).toContain("스폰/퀵레인");
    expect(LADDER_EXCLUSIONS[REASONER_ID]).toContain("스폰 전용");
  });

  it("오케스트레이터 후보에서는 빠진다(네이티브 Codex 만 오케 후보)", () => {
    const choices = codexOrchestratorChoices();
    expect(choices.map((c) => c.modelId)).not.toContain(CHAT_ID);
    expect(choices.map((c) => c.modelId)).not.toContain(REASONER_ID);
    expect(choices.every((c) => c.vendor === "openai")).toBe(true);
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
    expect(deepseek?.models.map((m) => m.modelId)).toEqual([
      CHAT_ID,
      REASONER_ID,
    ]);
  });

  it("레지스트리에 시크릿 값처럼 생긴 리터럴이 없다", () => {
    const serialized = JSON.stringify(
      MODEL_REGISTRY.filter((entry) => entry.provider === "deepseek"),
    );
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
