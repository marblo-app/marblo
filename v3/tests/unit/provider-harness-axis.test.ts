/**
 * ★provider ≠ harness 축분리 (USbdRV4k) — 이 티켓의 완료기준 본체.
 *
 * 증명해야 하는 것이 정확히 두 가지다.
 *
 *  (A) **회귀 0** — 기존 벤더(claude/codex)가 **같은 바이너리·같은 env** 로 뜬다.
 *      축을 쪼갠 리팩터라 "타입은 통과하는데 스폰이 달라졌다" 가 가장 무서운
 *      실패모드다. 그래서 argv 를 골든값으로 박고, env 는 **참조 동일성**까지 본다
 *      (프로파일이 없으면 새 객체조차 만들지 않는다는 계약).
 *
 *  (B) **표현 가능** — `{ provider: "zai", harness: "claude" }` 형태의 행을 레지스트리
 *      스키마로 적을 수 있고, 그 프로파일이 claude 스폰 env 에 정확히 얹힌다.
 *      ★실제 GLM 편입은 후속 티켓(MTtCVCP4)이므로 여기서는 레지스트리에 행을
 *      넣지 않는다 — 대신 타입이 붙는 합성 행 + 순수 머지 함수로 증명한다.
 *      (이 파일이 컴파일된다는 사실 자체가 축이 둘이라는 증거다: 축이 하나였다면
 *      `provider: "zai"` 가 타입에러였다.)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  ENV_PROFILE_SUPPORTED_HARNESSES,
  HARNESS_IDS,
  HARNESS_NATIVE_VENDOR,
  MODEL_REGISTRY,
  VENDOR_IDS,
  envProfileForModel,
  getModel,
  harnessForModel,
  modelsByHarness,
  modelsByVendor,
  vendorForModel,
  type HarnessId,
  type ModelRegistryEntry,
} from "../../electron/model-registry";
import {
  AgentConfigGenerator,
  CLAUDE_MODEL_ALIASES,
  applyVendorEnv,
  harnessForLaunch,
  mergeVendorEnv,
} from "../../electron/agent-config";
import {
  parseModelSpec,
  resolveModelPin,
} from "../../electron/model-selection";
import { ladderFor } from "../../electron/model-ladder";
import type { ModelType } from "../../electron/agent-manager";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-axis-"));

/**
 * 하네스 네이티브 벤더 행(= CLI 자기 로그인으로 붙는 행). 회귀 0 단언의 대상이다.
 * env-swap 벤더 행(GLM 등)은 정의상 env 를 바꾸므로 여기서 제외되고, 그쪽은
 * `vendor-glm-zai.test.ts` 가 따로 본다.
 */
const NATIVE_ROWS = MODEL_REGISTRY.filter(
  (m) => m.provider === HARNESS_NATIVE_VENDOR[m.harness],
);

afterEach(() => {
  vi.restoreAllMocks();
});

/** getLaunchConfig 를 돌려 실제 스폰 인자를 얻는다(공개 경로 — private 우회 없음). */
function launch(model: "claude" | "gpt", complexity?: "standard") {
  const gen = new AgentConfigGenerator();
  return gen.getLaunchConfig(
    { id: `ag-axis-${model}`, model, role: "backend", command: "" },
    TMP,
    undefined,
    undefined,
    undefined,
    false,
    complexity,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// (A) 회귀 0
// ─────────────────────────────────────────────────────────────────────────

describe("★회귀 0 — 기존 벤더(claude/codex) 스폰이 그대로다", () => {
  it("모든 기존 행의 하네스가 종전 ModelType 값을 그대로 승계했다", () => {
    // 축분리 전 `ModelProvider` 의 값 집합. 하네스가 이걸 통째로 물려받았기
    // 때문에 Firestore 에이전트 문서·그래프 셀키·텔레메트리가 갈라지지 않는다.
    expect([...HARNESS_IDS]).toEqual([
      "claude",
      "gemini",
      "gpt",
      "antigravity",
      "local",
      "custom",
    ]);
    // 컴파일타임 가드(agent-config)의 런타임 짝: ModelType 값이 전부 하네스다.
    const modelTypes: ModelType[] = [
      "claude",
      "gemini",
      "gpt",
      "antigravity",
      "local",
      "custom",
    ];
    for (const m of modelTypes) expect(HARNESS_IDS).toContain(m as HarnessId);
  });

  it("claude 행 = harness claude / vendor anthropic, gpt 행 = harness gpt / vendor openai", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(HARNESS_IDS, entry.id).toContain(entry.harness);
      expect(VENDOR_IDS, entry.id).toContain(entry.provider);
      if (entry.id.startsWith("claude-")) {
        expect(entry.harness, entry.id).toBe("claude");
        expect(entry.provider, entry.id).toBe("anthropic");
      }
      if (entry.id.startsWith("gpt-")) {
        expect(entry.harness, entry.id).toBe("gpt");
        expect(entry.provider, entry.id).toBe("openai");
      }
    }
  });

  it("★벤더-네이티브 행(anthropic/openai)엔 envProfile 이 없다 — 그 행들의 env 주입은 완전한 no-op", () => {
    // ★MTtCVCP4 이후 레지스트리엔 프로파일을 가진 행이 존재한다(GLM). 회귀 0 의
    // 주장은 "프로파일이 하나도 없다" 가 아니라 **"기존 벤더 행은 그대로다"** 로
    // 좁혀진다 — 그 경계를 여기서 명시적으로 고정한다.
    for (const entry of NATIVE_ROWS) {
      expect(entry.envProfile, entry.id).toBeUndefined();
      expect(envProfileForModel(entry.id), entry.id).toEqual({});
    }
  });

  it("★applyVendorEnv 가 기존 모델에 대해 base 를 **같은 객체 그대로** 돌려준다", () => {
    const base = { MARBLO_AGENT_ID: "a1", PATH: "/usr/bin" };
    for (const entry of NATIVE_ROWS) {
      // 참조 동일성 = "env 를 한 바이트도 안 건드렸다" 의 가장 강한 형태.
      expect(applyVendorEnv(base, entry.id), entry.id).toBe(base);
      for (const alias of entry.aliases) {
        expect(applyVendorEnv(base, alias), alias).toBe(base);
      }
    }
    expect(applyVendorEnv(base)).toBe(base);
    expect(applyVendorEnv(base, "레지스트리에-없는-모델")).toBe(base);
  });

  it("★harnessForLaunch 가 오늘은 항상 항등이다(바이너리 선택 무변경)", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(harnessForLaunch(entry.harness, entry.id), entry.id).toBe(
        entry.harness,
      );
    }
    // 핀 없음 / 미지 모델 / 폴백 alias("opus") 전부 입력을 그대로 돌려준다.
    for (const model of ["claude", "gpt", "antigravity", "custom"] as const) {
      expect(harnessForLaunch(model)).toBe(model);
      expect(harnessForLaunch(model, "모르는모델")).toBe(model);
    }
    expect(harnessForLaunch("claude", "opus")).toBe("claude");
  });

  it("★claude 스폰 argv 가 종전과 같다(--model 구체 id, MCP 배선 그대로)", () => {
    const cfg = launch("claude", "standard");
    expect(cfg.args.slice(0, 3)).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "claude-opus-5", // standard 티어 핀(#598 이후 값) — 축분리로 바뀌지 않는다
    ]);
    expect(cfg.args).toContain("--strict-mcp-config");
    expect(cfg.args).toContain("--mcp-config");
    // 벤더 env 가 새지 않았다.
    expect(
      Object.keys(cfg.env).filter((k) => k.startsWith("ANTHROPIC_")),
    ).toEqual([]);
    expect(Object.keys(cfg.env).sort()).toEqual([
      "MARBLO_AGENT_ID",
      "MARBLO_BRIDGE_PORT",
      "MARBLO_BRIDGE_TOKEN",
      "MARBLO_FIREBASE_CUSTOM_TOKEN",
      "MARBLO_PROJECT",
      "MARBLO_SKILLS_DIR",
      "PATH",
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_APP_ID",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_STORAGE_BUCKET",
    ]);
  });

  it("★codex 스폰 argv·env 가 종전과 같다(CODEX_HOME 포함)", () => {
    const cfg = launch("gpt", "standard");
    expect(cfg.args).toEqual([
      "-c",
      'approval_policy="never"',
      "-c",
      'sandbox_mode="danger-full-access"',
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    expect(cfg.env.CODEX_HOME).toBeTruthy();
    expect(Object.keys(cfg.env).sort()).toEqual([
      "CODEX_HOME",
      "MARBLO_AGENT_ID",
      "MARBLO_BRIDGE_PORT",
      "MARBLO_BRIDGE_TOKEN",
      "MARBLO_FIREBASE_CUSTOM_TOKEN",
      "MARBLO_PROJECT",
      "MARBLO_SKILLS_DIR",
      "PATH",
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_APP_ID",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_STORAGE_BUCKET",
    ]);
  });

  it("alias 표·사다리·셀렉터 파생이 하네스 기준으로 종전과 같다", () => {
    expect(CLAUDE_MODEL_ALIASES).toMatchObject({
      fable: "claude-fable-5",
      opus: "claude-opus-5",
      sonnet: "claude-sonnet-5",
      haiku: "claude-haiku-4-5-20251001",
    });
    expect(ladderFor("claude")!.harness).toBe("claude");
    expect(ladderFor("gpt")!.harness).toBe("gpt");
    // ★두 축이 실제로 갈라졌다: claude 하네스에는 anthropic 아닌 벤더가 함께 선다.
    // (축이 하나였다면 이 두 집합은 영원히 같았을 것이다.)
    expect(modelsByHarness("claude").map((m) => m.id)).toEqual(
      expect.arrayContaining(modelsByVendor("anthropic").map((m) => m.id)),
    );
    expect(modelsByHarness("claude").length).toBeGreaterThan(
      modelsByVendor("anthropic").length,
    );
    // 벤더 필터는 그 벤더 행만 준다 — 하네스가 같아도 섞이지 않는다.
    for (const m of modelsByVendor("anthropic"))
      expect(m.provider).toBe("anthropic");
    expect(modelsByHarness("gpt").map((m) => m.id)).toEqual(
      modelsByVendor("openai").map((m) => m.id),
    );
    // 사다리는 여전히 anthropic 행만 태운다(GLM 은 LADDER_EXCLUSIONS).
    for (const rung of ladderFor("claude")!.rungs) {
      expect(getModel(rung.model)!.provider, rung.model).toBe("anthropic");
    }
  });

  it("파서·핀이 두 축을 함께 돌려주되 하네스 값은 종전 그대로다", () => {
    // 기존 호출자(bridge-server dispatch)는 이 값을 ModelType 자리에 그대로 쓴다.
    expect(parseModelSpec("codex")).toMatchObject({ harness: "gpt" });
    expect(parseModelSpec("codex")!.vendor).toBeUndefined(); // 하네스만 말했다
    expect(parseModelSpec("opus5")).toMatchObject({
      harness: "claude",
      vendor: "anthropic",
      modelId: "claude-opus-5",
    });
    expect(resolveModelPin("gpt-5.6-terra@high", "2.1.220")).toMatchObject({
      harness: "gpt",
      vendor: "openai",
      codexModel: "gpt-5.6-terra",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (B) 표현 가능 — provider=zai / harness=claude
// ─────────────────────────────────────────────────────────────────────────

/**
 * Z.ai GLM 형태의 **합성** 행. 축분리 자체(두 축이 독립이라는 것)를 레지스트리
 * 데이터와 무관하게 증명하는 것이 목적이라, 실제 편입(MTtCVCP4 로 레지스트리에
 * 들어간 `glm-5.2`/`glm-4.7`) 이후에도 그대로 둔다 — 이 파일은 "표현 가능한가",
 * `vendor-glm-zai.test.ts` 는 "실제로 등록·주입되는가" 를 본다.
 *
 * 배선값 출처: docs.z.ai/devpack/tool/claude.
 * ★토큰은 값이 아니라 자리표시자다 — 시크릿을 코드에 박지 않는다.
 */
const GLM_ROW: ModelRegistryEntry = {
  id: "glm-5.2",
  harness: "claude", // 우리 claude 바이너리를 그대로 스폰한다
  provider: "zai", // 붙는 백엔드는 Anthropic 이 아니라 Z.ai 다
  envProfile: {
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_AUTH_TOKEN: "<glm-coding-plan-key>",
  },
  aliases: [],
  capability: "mid",
  efforts: [],
  pricing: { inputPer1M: 0, outputPer1M: 0, estimated: true },
  verified: {
    at: "2026-07-25",
    cli: "n/a",
    method: "서베이 문서 크롤(docs.z.ai) — 실제 편입 전 라이브 검증 필요",
  },
  status: "active",
};

describe("★표현 가능 — provider=zai / harness=claude 형태 레코드", () => {
  it("두 축이 서로 다른 값을 가질 수 있다(축이 하나였다면 이 파일이 컴파일되지 않는다)", () => {
    expect(GLM_ROW.harness).toBe("claude");
    expect(GLM_ROW.provider).toBe("zai");
    expect(GLM_ROW.harness as string).not.toBe(GLM_ROW.provider as string);
    // 하네스는 ModelType 집합 안 → 스폰 switch 에 case 를 추가할 필요가 없다.
    expect(HARNESS_IDS).toContain(GLM_ROW.harness);
    // 벤더는 새 값이지만 하네스 유니온을 건드리지 않았다.
    expect(VENDOR_IDS).toContain(GLM_ROW.provider);
  });

  it("이 하네스엔 벤더 env 주입 배선이 실제로 있다(조용히 버려지지 않는다)", () => {
    expect(ENV_PROFILE_SUPPORTED_HARNESSES).toContain(GLM_ROW.harness);
  });

  it("★프로파일이 claude 스폰 env 에 정확히 얹힌다 — 우리 배선은 그대로", () => {
    const base = {
      PATH: "/usr/bin",
      MARBLO_AGENT_ID: "ag-1",
      MARBLO_BRIDGE_TOKEN: "tok",
    };
    const merged = mergeVendorEnv(base, GLM_ROW.envProfile, {
      model: GLM_ROW.id,
      vendor: GLM_ROW.provider,
    });
    expect(merged).not.toBe(base); // 프로파일이 있으면 새 객체
    expect(merged.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBe("<glm-coding-plan-key>");
    // 우리 배선은 한 글자도 안 바뀐다.
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_AGENT_ID).toBe("ag-1");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("tok");
    expect(base).toEqual({
      PATH: "/usr/bin",
      MARBLO_AGENT_ID: "ag-1",
      MARBLO_BRIDGE_TOKEN: "tok",
    }); // 원본 불변
  });

  it("★벤더 프로파일은 우리 보호 키를 덮어쓸 수 없다(에이전트가 보드에서 사라지는 실패 봉쇄)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = {
      PATH: "/usr/bin",
      MARBLO_BRIDGE_TOKEN: "ours",
      CODEX_HOME: "/ours/codex",
    };
    const merged = mergeVendorEnv(base, {
      PATH: "/evil",
      MARBLO_BRIDGE_TOKEN: "theirs",
      CODEX_HOME: "/theirs",
      VITE_FIREBASE_API_KEY: "theirs",
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    });
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(merged.CODEX_HOME).toBe("/ours/codex");
    expect(merged.VITE_FIREBASE_API_KEY).toBeUndefined();
    // 벤더가 정당하게 필요로 하는 키는 통과한다.
    expect(merged.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(warn).toHaveBeenCalled(); // 조용히 버리지 않는다
  });

  it("harness 를 읽는 헬퍼들이 벤더가 아니라 바이너리를 돌려준다", () => {
    // 기존 행으로 확인 — 같은 헬퍼가 GLM 행에서는 "claude" 를 돌려주게 된다.
    expect(harnessForModel("claude-opus-5")).toBe("claude");
    expect(vendorForModel("claude-opus-5")).toBe("anthropic");
    expect(harnessForModel("gpt-5.6-sol")).toBe("gpt");
    expect(vendorForModel("gpt-5.6-sol")).toBe("openai");
    expect(harnessForModel("없는모델")).toBeUndefined();
    expect(vendorForModel("없는모델")).toBeUndefined();
    // 스폰 switch 가 보는 값은 harness 다 → GLM 행이면 claude 분기로 접힌다.
    expect(getModel("claude-opus-5")!.harness).toBe(GLM_ROW.harness);
  });
});
