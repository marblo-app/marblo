/**
 * ★MiniMax env-swap 편입 (tg6U7MKt) — 두 번째 (B)형 벤더.
 *
 * `vendor-glm-zai.test.ts` 의 복제다. 같은 네 가지를 증명한다:
 *
 *  (1) **등록** — MiniMax 행이 provider=minimax / harness=claude 로 있고,
 *      배선값(엔드포인트·모델 id)이 벤더 공식문서 실측값 그대로다.
 *  (2) **주입** — 키가 있으면 프로파일이 claude 스폰 env 에 얹히고 보호 키는
 *      거부된다. 키가 없으면 **전부-아니면-전무**로 아무것도 안 얹힌다.
 *  (3) **회귀 0** — claude/codex 네이티브 스폰과 **GLM 행**이 그대로다.
 *  (4) **시크릿 비노출** — 코드·로그·공개 API 어디에도 토큰 값이 없다.
 *
 * + MiniMax 에만 있는 축 하나: 벤더 공식 id 가 **대소문자 혼합**(`MiniMax-M3`)이라
 *   레지스트리 조회가 케이스를 안 가려야 한다. 안 그러면 `getModel` 이 영구 miss
 *   하고 프로파일이 조용히 미주입된다(= 스폰이 Anthropic 으로 새는 실패모드).
 *
 * ★라이브 스폰(실제로 MiniMax 가 응답하는가)은 Token Plan 구독키가 있어야 하므로
 * 여기 없다. 그 검증 경로는 `npm run verify:models` 의 [vendor] 섹션이다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  MODEL_REGISTRY,
  envProfileForModel,
  getModel,
  harnessForModel,
  modelsByHarness,
  modelsByVendor,
  registryPricing,
  resolveModelAlias,
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
  looseIndexCollisions,
  parseModelSpec,
  resolveModelPin,
} from "../../electron/model-selection";
import { LADDER_EXCLUSIONS, ladderFor } from "../../electron/model-ladder";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-minimax-"));

/**
 * 실측 엔드포인트 — platform.minimax.io/docs/token-plan/other-tools.md 의
 * "Anthropic-Compatible Protocol" 표, /token-plan/claude-code.md 의 설정 예시.
 */
const MINIMAX_ANTHROPIC_ENDPOINT = "https://api.minimax.io/anthropic";
/** 시크릿 값은 테스트에서도 실제 키를 쓰지 않는다 — 형태만 있으면 충분하다. */
const FAKE_KEY = "test-minimax-key-not-a-real-secret";

const MINIMAX_IDS = ["MiniMax-M3", "MiniMax-M2.7"] as const;

/** MINIMAX_API_KEY 를 켠 상태로 fn 실행(테스트 격리 — 원래 값 복원). */
function withMinimaxKey<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.MINIMAX_API_KEY;
  if (value === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = prev;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// (1) 등록
// ─────────────────────────────────────────────────────────────────────────

describe("★MiniMax 행 등록 — provider=minimax / harness=claude", () => {
  it.each(MINIMAX_IDS)(
    "%s 가 minimax 벤더 + claude 하네스로 등록돼 있다",
    (id) => {
      const entry = getModel(id);
      expect(entry, id).toBeDefined();
      expect(entry!.id).toBe(id); // alias 가 아니라 구체 id 로 잡힌다
      expect(vendorForModel(id)).toBe("minimax");
      expect(harnessForModel(id)).toBe("claude");
      expect(entry!.status).toBe("active");
      // claude 하네스엔 CLI 인자로 줄 effort 축이 없다.
      expect(entry!.efforts).toEqual([]);
    },
  );

  it("★배선값이 벤더 공식문서 실측값 그대로다(날조 0)", () => {
    expect(envProfileForModel("MiniMax-M3")).toEqual({
      ANTHROPIC_BASE_URL: MINIMAX_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M3",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M3",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
    });
    expect(envProfileForModel("MiniMax-M2.7")).toEqual({
      ANTHROPIC_BASE_URL: MINIMAX_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
    });
  });

  it("★모델 id 는 벤더 문서 표기 그대로다(우리가 만든 문자열을 남의 API 로 보내지 않는다)", () => {
    // 소문자로 접어 등록하면 `--model minimax-m3` 이 나가는데, 그게 유효한지
    // 확인할 방법이 구독키 없이는 없다. 원문 표기가 유일하게 검증된 값이다.
    expect(getModel("MiniMax-M3")!.id).toBe("MiniMax-M3");
    expect(getModel("MiniMax-M2.7")!.id).toBe("MiniMax-M2.7");
  });

  it("★조회는 대소문자를 안 가린다 — 그래야 프로파일이 조용히 미주입되지 않는다", () => {
    // 이 케이스가 깨지면 `getModel` 이 miss → envProfile 이 빈 객체 → 스폰이
    // Anthropic 으로 샌다(축 분리가 막으려던 바로 그 실패모드).
    for (const spelling of ["minimax-m3", "MINIMAX-M3", "  MiniMax-M3  "]) {
      expect(getModel(spelling)?.id, spelling).toBe("MiniMax-M3");
      expect(resolveModelAlias(spelling), spelling).toBe("MiniMax-M3");
      expect(envProfileForModel(spelling).ANTHROPIC_BASE_URL, spelling).toBe(
        MINIMAX_ANTHROPIC_ENDPOINT,
      );
    }
    // 기존 소문자 id 들은 종전 그대로 잡힌다(회귀 0).
    expect(getModel("claude-opus-5")?.id).toBe("claude-opus-5");
    expect(getModel("opus")?.id).toBe("claude-opus-5"); // alias 도 그대로
  });

  it("★ANTHROPIC_DEFAULT_* 가 전부 레지스트리에 있는 MiniMax id 다(유령 비용 차단)", () => {
    // 미등록 id 가 스폰 env 로 새면 cost-tracker 가 단가를 몰라 비용이 0 으로
    // 집계된다. 벤더 문서가 권하는 id 라도 우리가 등록하지 않았으면 안 쓴다.
    for (const id of MINIMAX_IDS) {
      const profile = envProfileForModel(id);
      for (const key of [
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      ]) {
        const mapped = profile[key];
        expect(getModel(mapped), `${id}.${key}=${mapped}`).toBeDefined();
        expect(getModel(mapped)!.provider, `${id}.${key}`).toBe("minimax");
        // 단가표(cost-tracker 의 단일소스)에 **원문 표기 그대로** 행이 있다.
        expect(registryPricing()[mapped], `${id}.${key}`).toBeDefined();
      }
    }
  });

  it("★시크릿은 값이 아니라 env 키 이름으로만 있다", () => {
    expect(vendorEnvSecretRef("${MINIMAX_API_KEY}")).toBe("MINIMAX_API_KEY");
    expect(vendorEnvSecretRef(MINIMAX_ANTHROPIC_ENDPOINT)).toBeUndefined();
    for (const id of MINIMAX_IDS) {
      expect(vendorEnvSecretKeys(id), id).toEqual(["MINIMAX_API_KEY"]);
    }
    // 레지스트리 어느 행에도 키처럼 생긴 리터럴이 없다(GLM 행 포함).
    for (const entry of MODEL_REGISTRY) {
      for (const [key, value] of Object.entries(entry.envProfile ?? {})) {
        if (!/token|key|secret/i.test(key)) continue;
        expect(vendorEnvSecretRef(value), `${entry.id}.${key}`).toBeTruthy();
      }
    }
    // sk-cp-… 같은 실제 키 접두가 소스에 박혀 있지 않다.
    expect(JSON.stringify(MODEL_REGISTRY)).not.toMatch(/sk-[a-z]{2}-/i);
  });

  it("★사다리엔 안 들어간다 — 자동 선택이 아니라 명시 지정 전용이다", () => {
    for (const id of MINIMAX_IDS) {
      expect(LADDER_EXCLUSIONS[id], id).toBeTruthy();
      expect(ladderFor("claude")!.rungs.some((r) => r.model === id)).toBe(
        false,
      );
    }
  });

  it("하네스 필터엔 잡히고 벤더 필터로 갈린다", () => {
    const byHarness = modelsByHarness("claude").map((m) => m.id);
    expect(byHarness).toContain("MiniMax-M3");
    expect(byHarness).toContain("claude-opus-5");
    expect(
      modelsByVendor("minimax")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["MiniMax-M2.7", "MiniMax-M3"]);
    // 벤더 축이 GLM 과 섞이지 않는다.
    expect(
      modelsByVendor("zai")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["glm-4.7", "glm-5.2"]);
    expect(modelsByVendor("anthropic").map((m) => m.id)).not.toContain(
      "MiniMax-M3",
    );
  });

  it("★오케 셀렉터엔 안 선다 — 영구 저장되는 기본값에 조건부 크레덴셜을 얹지 않는다", () => {
    const choices = claudeOrchestratorChoices();
    for (const id of MINIMAX_IDS) {
      expect(choices.map((c) => c.modelId)).not.toContain(id);
    }
    expect(choices.every((c) => c.vendor === "anthropic")).toBe(true);
    expect(choices.some((c) => /minimax/i.test(c.label))).toBe(false);
  });

  it("느슨한 인덱스가 충돌 없이 만들어진다(MiniMax 행이 기존 표기를 가리지 않는다)", () => {
    expect(looseIndexCollisions()).toEqual([]);
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
    const merged = withMinimaxKey(FAKE_KEY, () =>
      applyVendorEnv(base, "MiniMax-M3"),
    );
    expect(merged).not.toBe(base); // 프로파일이 있으면 새 객체
    expect(merged.ANTHROPIC_BASE_URL).toBe(MINIMAX_ANTHROPIC_ENDPOINT);
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY); // 자리표시자가 해석됐다
    expect(merged.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("MiniMax-M3");
    expect(merged.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("MiniMax-M2.7");
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_AGENT_ID).toBe("ag-1");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(base.PATH).toBe("/usr/bin"); // 원본 불변
    expect(Object.keys(base)).toHaveLength(3);
  });

  it("★dispatch(model='MiniMax-M3') 가 claude 바이너리 + MiniMax env 로 스폰된다", () => {
    // dispatch 경로가 실제로 쓰는 두 함수를 그대로 통과시킨다.
    const spec = parseModelSpec("MiniMax-M3");
    expect(spec).toMatchObject({
      harness: "claude",
      vendor: "minimax",
      modelId: "MiniMax-M3",
    });
    const pin = resolveModelPin("MiniMax-M3", "2.1.220");
    expect(pin).toMatchObject({
      harness: "claude",
      claudeModel: "MiniMax-M3",
    });
    expect(pin!.fallback).toBeUndefined(); // 폴백 없이 MiniMax 가 살아남는다

    // 바이너리는 하네스가 고른다 — 벤더는 switch 를 늘리지 않는다.
    expect(harnessForLaunch("claude", pin!.claudeModel)).toBe("claude");

    const cfg = withMinimaxKey(FAKE_KEY, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-mm", model: "claude", role: "backend", command: "" },
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
    // ★argv 에 나가는 값이 벤더 문서 표기 그대로다(소문자로 접히지 않았다).
    expect(cfg.args.slice(0, 3)).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "MiniMax-M3",
    ]);
    expect(cfg.env.ANTHROPIC_BASE_URL).toBe(MINIMAX_ANTHROPIC_ENDPOINT);
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY);
    // MCP 배선은 한 글자도 안 바뀐다 — 에이전트가 보드에서 사라지지 않는다.
    expect(cfg.args).toContain("--strict-mcp-config");
    expect(cfg.env.MARBLO_AGENT_ID).toBe("ag-mm");
    expect(cfg.env.MARBLO_BRIDGE_TOKEN).toBeTruthy();
  });

  it("소문자로 지정해도 같은 스폰이 된다(사람이 치는 표기 흡수)", () => {
    const pin = resolveModelPin("minimax-m3", "2.1.220");
    expect(pin!.claudeModel).toBe("MiniMax-M3"); // 원문 표기로 정규화
    const cfg = withMinimaxKey(FAKE_KEY, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-mm-lc", model: "claude", role: "backend", command: "" },
        TMP,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        { claudeModel: pin!.claudeModel },
      ),
    );
    expect(cfg.env.ANTHROPIC_BASE_URL).toBe(MINIMAX_ANTHROPIC_ENDPOINT);
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY);
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
        ANTHROPIC_BASE_URL: MINIMAX_ANTHROPIC_ENDPOINT,
      },
      { model: "MiniMax-M3", vendor: "minimax" },
    );
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(merged.CODEX_HOME).toBe("/ours");
    expect(merged.VITE_FIREBASE_API_KEY).toBeUndefined();
    expect(merged.ANTHROPIC_BASE_URL).toBe(MINIMAX_ANTHROPIC_ENDPOINT);
    expect(warn).toHaveBeenCalled(); // 조용히 버리지 않는다
  });

  it("readiness 가 준비완료를 보고한다(값이 아니라 키 이름으로)", () => {
    const r = withMinimaxKey(FAKE_KEY, () => vendorEnvReadiness("MiniMax-M3"));
    expect(r).toEqual({
      vendor: "minimax",
      hasProfile: true,
      requiredEnvKeys: ["MINIMAX_API_KEY"],
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
    const merged = withMinimaxKey(undefined, () =>
      applyVendorEnv(base, "MiniMax-M3"),
    );
    // 참조 동일성 — env 를 한 바이트도 안 건드렸다.
    expect(merged).toBe(base);
    // ★엔드포인트만 얹히면 우리 Anthropic 크레덴셜이 MiniMax 로 나간다. 그게 없다.
    expect(merged.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(warn).toHaveBeenCalled(); // 조용히 넘어가지 않는다
  });

  it("★스폰은 계속된다(throw 없음) — 티켓이 멈추는 것보다 낫다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = withMinimaxKey(undefined, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-mm-nokey", model: "claude", role: "backend", command: "" },
        TMP,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        { claudeModel: "MiniMax-M3" },
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
      const r = withMinimaxKey(value, () => vendorEnvReadiness("MiniMax-M3"));
      expect(r.ready, JSON.stringify(value)).toBe(false);
      expect(r.missingEnvKeys).toEqual(["MINIMAX_API_KEY"]);
    }
  });

  it("readiness 가 '무엇을 넣어야 켜지나' 를 키 이름으로 알려준다", () => {
    const r = withMinimaxKey(undefined, () =>
      vendorEnvReadiness("MiniMax-M2.7"),
    );
    expect(r).toEqual({
      vendor: "minimax",
      hasProfile: true,
      requiredEnvKeys: ["MINIMAX_API_KEY"],
      missingEnvKeys: ["MINIMAX_API_KEY"],
      ready: false,
    });
  });

  it("resolveVendorEnvProfile 이 시크릿 아닌 값은 그대로 통과시킨다", () => {
    const out = withMinimaxKey(undefined, () =>
      resolveVendorEnvProfile({
        ANTHROPIC_BASE_URL: MINIMAX_ANTHROPIC_ENDPOINT,
        ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}",
      }),
    );
    expect(out.resolved).toEqual({
      ANTHROPIC_BASE_URL: MINIMAX_ANTHROPIC_ENDPOINT,
    });
    expect(out.missing).toEqual(["MINIMAX_API_KEY"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (3) 회귀 0 — MiniMax 행이 생겨도 기존 벤더(claude/codex/GLM)는 그대로다
// ─────────────────────────────────────────────────────────────────────────

describe("★회귀 0 — 기존 벤더 스폰 무변경", () => {
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
    const cfg = withMinimaxKey(FAKE_KEY, () => launch("claude"));
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
    const cfg = withMinimaxKey(FAKE_KEY, () => launch("gpt"));
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

  it("★GLM 행이 MiniMax 키로는 안 켜진다(벤더별 크레덴셜이 섞이지 않는다)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { PATH: "/usr/bin" };
    // MINIMAX_API_KEY 만 있고 ZAI_API_KEY 가 없으면 GLM 은 미주입이어야 한다.
    const prevZai = process.env.ZAI_API_KEY;
    delete process.env.ZAI_API_KEY;
    try {
      const merged = withMinimaxKey(FAKE_KEY, () =>
        applyVendorEnv(base, "glm-4.7"),
      );
      expect(merged).toBe(base);
    } finally {
      if (prevZai !== undefined) process.env.ZAI_API_KEY = prevZai;
    }
    // 반대로 GLM 프로파일 자체는 종전 값 그대로다.
    expect(envProfileForModel("glm-4.7").ANTHROPIC_BASE_URL).toBe(
      "https://api.z.ai/api/anthropic",
    );
  });
});
