/**
 * ★Z.ai GLM env-swap 편입 (MTtCVCP4) — 첫 (B)형 벤더.
 *
 * 증명해야 하는 것:
 *
 *  (1) **등록** — GLM 행이 provider=zai / harness=claude 로 레지스트리에 있고,
 *      배선값(엔드포인트·모델 id)이 벤더 공식문서 실측값 그대로다.
 *  (2) **주입** — 키가 있으면 그 프로파일이 claude 스폰 env 에 얹히고, 보호 키는
 *      거부된다. 키가 없으면 **전부-아니면-전무**로 아무것도 안 얹힌다(부분 주입
 *      금지 — 우리 Anthropic 크레덴셜이 남의 엔드포인트로 나가는 사고 봉쇄).
 *  (3) **회귀 0** — claude/codex 네이티브 스폰의 argv·env 가 그대로다.
 *  (4) **시크릿 비노출** — 코드·로그·공개 API 어디에도 토큰 값이 없다.
 *
 * ★라이브 스폰(실제로 GLM 이 응답하는가)은 Z.ai 구독키가 있어야 하므로 여기 없다.
 * 그 검증 경로는 `npm run verify:models` 의 [vendor] 섹션이다(키 없으면 skip).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  HARNESS_NATIVE_VENDOR,
  MODEL_REGISTRY,
  envProfileForModel,
  getModel,
  harnessForModel,
  modelsByHarness,
  modelsByVendor,
  vendorEnvSecretKeys,
  vendorEnvSecretRef,
  vendorForModel,
} from "../../electron/model-registry";
import {
  AgentConfigGenerator,
  applyVendorEnv,
  harnessForLaunch,
  mergeVendorEnv,
  resolveVendorEnvProfile,
  vendorEnvReadiness,
} from "../../electron/agent-config";
import {
  claudeOrchestratorChoices,
  parseModelSpec,
  resolveModelPin,
} from "../../electron/model-selection";
import { LADDER_EXCLUSIONS, ladderFor } from "../../electron/model-ladder";
import { useVerifiedClaudeCli } from "../fixtures/verified-claude-cli";

useVerifiedClaudeCli();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-glm-"));

/** 실측 엔드포인트(docs.z.ai/devpack/tool/claude · /devpack/latest-model). */
const ZAI_ANTHROPIC_ENDPOINT = "https://api.z.ai/api/anthropic";
/** 시크릿 값은 테스트에서도 실제 키를 쓰지 않는다 — 형태만 있으면 충분하다. */
const FAKE_KEY = "test-zai-key-not-a-real-secret";

/** ZAI_API_KEY 를 켠 상태로 fn 실행(테스트 격리 — 원래 값 복원). */
function withZaiKey<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.ZAI_API_KEY;
  if (value === undefined) delete process.env.ZAI_API_KEY;
  else process.env.ZAI_API_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ZAI_API_KEY;
    else process.env.ZAI_API_KEY = prev;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubEnv("MARBLO_BRIDGE_TOKEN", "test-bridge-token");
});

// ─────────────────────────────────────────────────────────────────────────
// (1) 등록
// ─────────────────────────────────────────────────────────────────────────

describe("★GLM 행 등록 — provider=zai / harness=claude", () => {
  it.each(["glm-5.2", "glm-4.7"])(
    "%s 가 zai 벤더 + claude 하네스로 등록돼 있다",
    (id) => {
      const entry = getModel(id);
      expect(entry, id).toBeDefined();
      expect(entry!.id).toBe(id); // alias 가 아니라 구체 id 로 잡힌다
      expect(vendorForModel(id)).toBe("zai");
      expect(harnessForModel(id)).toBe("claude");
      expect(entry!.status).toBe("active");
      // claude 하네스엔 CLI 인자로 줄 effort 축이 없다.
      expect(entry!.efforts).toEqual([]);
    },
  );

  it("★배선값이 벤더 공식문서 실측값 그대로다(날조 0)", () => {
    expect(envProfileForModel("glm-5.2")).toEqual({
      ANTHROPIC_BASE_URL: ZAI_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",
    });
    expect(envProfileForModel("glm-4.7")).toEqual({
      ANTHROPIC_BASE_URL: ZAI_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-4.7",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4.7",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",
    });
  });

  it("★ANTHROPIC_DEFAULT_* 가 전부 레지스트리에 있는 GLM id 다(유령 비용 차단)", () => {
    // 미등록 id 가 스폰 env 로 새면 cost-tracker 가 단가를 몰라 비용이 0 으로
    // 집계된다. 벤더 문서가 권하는 id 라도 우리가 등록하지 않았으면 안 쓴다.
    for (const id of ["glm-5.2", "glm-4.7"]) {
      const profile = envProfileForModel(id);
      for (const key of [
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      ]) {
        const mapped = profile[key];
        expect(getModel(mapped), `${id}.${key}=${mapped}`).toBeDefined();
        expect(getModel(mapped)!.provider, `${id}.${key}`).toBe("zai");
      }
    }
  });

  it("★시크릿은 값이 아니라 env 키 이름으로만 있다", () => {
    expect(vendorEnvSecretRef("${ZAI_API_KEY}")).toBe("ZAI_API_KEY");
    expect(vendorEnvSecretRef(ZAI_ANTHROPIC_ENDPOINT)).toBeUndefined();
    expect(vendorEnvSecretKeys("glm-5.2")).toEqual(["ZAI_API_KEY"]);
    expect(vendorEnvSecretKeys("claude-opus-5")).toEqual([]);
    // 레지스트리 어느 행에도 키처럼 생긴 리터럴이 없다.
    for (const entry of MODEL_REGISTRY) {
      for (const [key, value] of Object.entries(entry.envProfile ?? {})) {
        if (!/token|key|secret/i.test(key)) continue;
        expect(vendorEnvSecretRef(value), `${entry.id}.${key}`).toBeTruthy();
      }
    }
  });

  it("★사다리에 들어간다(hyKsSYYM, 사장님 A안) — 키 있으면 워커 자동선택 후보", () => {
    // ★MTtCVCP4 당시엔 "명시 지정 전용"(LADDER_EXCLUSIONS)이었다. hyKsSYYM
    // (사장님 A안)이 그 배제를 풀었다 — env-swap 벤더도 키만 있으면 워커
    // 자동선택 사다리 칸이다. LADDER_EXCLUSIONS 에 남아 있으면 완결성 테스트
    // (사다리 XOR 제외)가 깨지므로, 여기 없다는 것 자체가 편입의 증거다.
    for (const id of ["glm-5.2", "glm-4.7"]) {
      expect(LADDER_EXCLUSIONS[id], id).toBeUndefined();
      expect(ladderFor("claude")!.rungs.some((r) => r.model === id)).toBe(true);
    }
  });

  it("하네스 필터엔 잡히고 벤더 필터로 갈린다", () => {
    const byHarness = modelsByHarness("claude").map((m) => m.id);
    expect(byHarness).toContain("glm-5.2");
    expect(byHarness).toContain("claude-opus-5");
    expect(
      modelsByVendor("zai")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["glm-4.7", "glm-5.2"]);
    expect(modelsByVendor("anthropic").map((m) => m.id)).not.toContain(
      "glm-5.2",
    );
  });

  it("★오케 셀렉터엔 안 선다 — 영구 저장되는 기본값에 조건부 크레덴셜을 얹지 않는다", () => {
    const choices = claudeOrchestratorChoices();
    expect(choices.map((c) => c.modelId)).not.toContain("glm-5.2");
    expect(choices.map((c) => c.modelId)).not.toContain("glm-4.7");
    // 네이티브 행 목록·표기는 종전 그대로(셀렉터 회귀 0).
    expect(choices.every((c) => c.vendor === "anthropic")).toBe(true);
    expect(choices.find((c) => c.modelId === "claude-opus-5")!.label).toBe(
      "Claude (Opus 5)",
    );
    // ★"Claude (Glm 5.2)" 같은 거짓 라벨이 만들어질 여지 자체가 없다.
    expect(choices.some((c) => /glm/i.test(c.label))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (2) 주입
// ─────────────────────────────────────────────────────────────────────────

describe("★벤더 env 주입 — 키가 있을 때", () => {
  it("프로파일이 claude 스폰 env 에 얹히고 우리 배선은 그대로다", () => {
    const base = {
      PATH: "/usr/bin",
      MARBLO_AGENT_ID: "ag-1",
      MARBLO_BRIDGE_TOKEN: "ours",
    };
    const merged = withZaiKey(FAKE_KEY, () => applyVendorEnv(base, "glm-4.7"));
    expect(merged).not.toBe(base); // 프로파일이 있으면 새 객체
    expect(merged.ANTHROPIC_BASE_URL).toBe(ZAI_ANTHROPIC_ENDPOINT);
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY); // 자리표시자가 해석됐다
    expect(merged.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-4.7");
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_AGENT_ID).toBe("ag-1");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(base.PATH).toBe("/usr/bin"); // 원본 불변
    expect(Object.keys(base)).toHaveLength(3);
  });

  it("★dispatch(model='glm-4.7') 가 claude 바이너리 + Z.ai env 로 스폰된다", () => {
    // dispatch 경로가 실제로 쓰는 두 함수를 그대로 통과시킨다.
    const spec = parseModelSpec("glm-4.7");
    expect(spec).toMatchObject({
      harness: "claude",
      vendor: "zai",
      modelId: "glm-4.7",
    });
    const pin = resolveModelPin("glm-4.7", "2.1.220");
    expect(pin).toMatchObject({ harness: "claude", claudeModel: "glm-4.7" });
    expect(pin!.fallback).toBeUndefined(); // 폴백 없이 GLM 이 살아남는다

    // 바이너리는 하네스가 고른다 — 벤더는 switch 를 늘리지 않는다.
    expect(harnessForLaunch("claude", pin!.claudeModel)).toBe("claude");

    const cfg = withZaiKey(FAKE_KEY, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-glm", model: "claude", role: "backend", command: "" },
        TMP,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        { claudeModel: pin!.claudeModel },
      ),
    );
    expect(cfg.model).toBe("claude");
    expect(cfg.args.slice(0, 3)).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "glm-4.7",
    ]);
    expect(cfg.env.ANTHROPIC_BASE_URL).toBe(ZAI_ANTHROPIC_ENDPOINT);
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY);
    // MCP 배선은 한 글자도 안 바뀐다 — 에이전트가 보드에서 사라지지 않는다.
    expect(cfg.args).toContain("--strict-mcp-config");
    expect(cfg.env.MARBLO_AGENT_ID).toBe("ag-glm");
    expect(cfg.env.MARBLO_BRIDGE_TOKEN).toBeTruthy();
  });

  it("★벤더 프로파일은 우리 보호 키를 덮어쓸 수 없다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const merged = mergeVendorEnv(
      { PATH: "/usr/bin", MARBLO_BRIDGE_TOKEN: "ours", CODEX_HOME: "/ours" },
      {
        PATH: "/evil",
        MARBLO_BRIDGE_TOKEN: "theirs",
        CODEX_HOME: "/theirs",
        VITE_FIREBASE_API_KEY: "theirs",
        ANTHROPIC_BASE_URL: ZAI_ANTHROPIC_ENDPOINT,
      },
      { model: "glm-4.7", vendor: "zai" },
    );
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(merged.CODEX_HOME).toBe("/ours");
    expect(merged.VITE_FIREBASE_API_KEY).toBeUndefined();
    expect(merged.ANTHROPIC_BASE_URL).toBe(ZAI_ANTHROPIC_ENDPOINT);
    expect(warn).toHaveBeenCalled(); // 조용히 버리지 않는다
  });

  it("readiness 가 준비완료를 보고한다(값이 아니라 키 이름으로)", () => {
    const r = withZaiKey(FAKE_KEY, () => vendorEnvReadiness("glm-5.2"));
    expect(r).toEqual({
      vendor: "zai",
      hasProfile: true,
      requiredEnvKeys: ["ZAI_API_KEY"],
      missingEnvKeys: [],
      ready: true,
    });
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });
});

describe("★키가 없을 때 — graceful, 그리고 전부-아니면-전무", () => {
  it("★프로파일을 통째로 미주입한다(부분 주입 = 크레덴셜 유출 경로)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { PATH: "/usr/bin", MARBLO_AGENT_ID: "ag-1" };
    const merged = withZaiKey(undefined, () => applyVendorEnv(base, "glm-4.7"));
    // 참조 동일성 — env 를 한 바이트도 안 건드렸다.
    expect(merged).toBe(base);
    // ★엔드포인트만 얹히면 우리 Anthropic 크레덴셜이 Z.ai 로 나간다. 그게 없다.
    expect(merged.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(warn).toHaveBeenCalled(); // 조용히 넘어가지 않는다
  });

  it("★스폰은 계속된다(throw 없음) — 티켓이 멈추는 것보다 낫다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = withZaiKey(undefined, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-glm-nokey", model: "claude", role: "backend", command: "" },
        TMP,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        { claudeModel: "glm-4.7" },
      ),
    );
    expect(cfg.command).toBeTruthy();
    expect(cfg.args).toContain("--model");
    expect(
      Object.keys(cfg.env).filter((k) => k.startsWith("ANTHROPIC_")),
    ).toEqual([]);
  });

  it("빈 문자열·공백만 있는 키도 '미설정' 이다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of ["", "   "]) {
      const r = withZaiKey(value, () => vendorEnvReadiness("glm-4.7"));
      expect(r.ready, JSON.stringify(value)).toBe(false);
      expect(r.missingEnvKeys).toEqual(["ZAI_API_KEY"]);
    }
  });

  it("readiness 가 '무엇을 넣어야 켜지나' 를 키 이름으로 알려준다", () => {
    const r = withZaiKey(undefined, () => vendorEnvReadiness("glm-4.7"));
    expect(r).toEqual({
      vendor: "zai",
      hasProfile: true,
      requiredEnvKeys: ["ZAI_API_KEY"],
      missingEnvKeys: ["ZAI_API_KEY"],
      ready: false,
      notReadyReason: "missing-credentials",
    });
    // 프로파일이 없는 네이티브 행은 항상 ready(자기 CLI 로그인으로 붙는다).
    expect(vendorEnvReadiness("claude-opus-5")).toMatchObject({
      vendor: "anthropic",
      hasProfile: false,
      ready: true,
    });
    expect(vendorEnvReadiness()).toMatchObject({ hasProfile: false });
  });

  it("resolveVendorEnvProfile 이 시크릿 아닌 값은 그대로 통과시킨다", () => {
    const out = withZaiKey(undefined, () =>
      resolveVendorEnvProfile({
        ANTHROPIC_BASE_URL: ZAI_ANTHROPIC_ENDPOINT,
        ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
      }),
    );
    expect(out.resolved).toEqual({
      ANTHROPIC_BASE_URL: ZAI_ANTHROPIC_ENDPOINT,
    });
    expect(out.missing).toEqual(["ZAI_API_KEY"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (3) 회귀 0 — GLM 행이 생겨도 기존 벤더 스폰은 그대로다
// ─────────────────────────────────────────────────────────────────────────

describe("★회귀 0 — 네이티브 벤더 스폰 무변경", () => {
  const launch = (model: "claude" | "gpt") =>
    new AgentConfigGenerator().getLaunchConfig(
      { id: `ag-native-${model}`, model, role: "backend", command: "" },
      TMP,
      undefined,
      undefined,
      undefined,
      false,
      "standard",
    );

  it("claude 스폰에 벤더 env 가 새지 않는다", () => {
    const cfg = withZaiKey(FAKE_KEY, () => launch("claude"));
    expect(cfg.args.slice(0, 3)).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "claude-opus-5",
    ]);
    // ★키가 설정돼 있어도 anthropic 행에는 아무것도 안 붙는다.
    expect(
      Object.keys(cfg.env).filter((k) => k.startsWith("ANTHROPIC_")),
    ).toEqual([]);
  });

  it("codex 스폰 argv·env 가 종전과 같다", () => {
    const cfg = withZaiKey(FAKE_KEY, () => launch("gpt"));
    expect(cfg.args).toEqual([
      "-c",
      'approval_policy="never"',
      "-c",
      'sandbox_mode="danger-full-access"',
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    expect(
      Object.keys(cfg.env).filter((k) => k.startsWith("ANTHROPIC_")),
    ).toEqual([]);
    expect(cfg.env.CODEX_HOME).toBeTruthy();
  });

  it("★네이티브 벤더 행은 여전히 envProfile 이 없다", () => {
    for (const entry of MODEL_REGISTRY) {
      if (entry.provider === HARNESS_NATIVE_VENDOR[entry.harness]) {
        expect(entry.envProfile, entry.id).toBeUndefined();
      } else {
        // env-swap 행은 반드시 프로파일이 있어야 한다(없으면 부팅 가드가 throw).
        expect(entry.envProfile, entry.id).toBeDefined();
      }
    }
  });
});
