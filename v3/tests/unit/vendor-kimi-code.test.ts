/**
 * ★Kimi Code env-swap 편입 (tUobgoQF) — 세 번째 (B)형 벤더.
 *
 * `vendor-minimax.test.ts` 의 복제다. 같은 네 가지를 증명한다:
 *
 *  (1) **등록** — Kimi 행이 provider=moonshot / harness=claude 로 있고,
 *      배선값(엔드포인트·모델 id)이 벤더 공식문서 실측값 그대로다.
 *  (2) **주입** — 키가 있으면 프로파일이 claude 스폰 env 에 얹히고 보호 키는
 *      거부된다. 키가 없으면 **전부-아니면-전무**로 아무것도 안 얹힌다.
 *  (3) **회귀 0** — claude/codex 네이티브 스폰과 **GLM·MiniMax 행**이 그대로다.
 *  (4) **시크릿 비노출** — 코드·로그·공개 API 어디에도 토큰 값이 없다.
 *
 * + Kimi 에만 있는 축 둘:
 *   - ★**판별 회귀 가드**: 이 티켓의 1단계 산출물은 "(A)형 신규 하네스가 아니라
 *     (B)형 env-swap 이다" 였다. 그 판별이 코드에 남는 방식은 `HarnessId` 에
 *     `"kimi"` 가 **없다**는 것이다 — 누군가 나중에 하네스를 늘리면 여기서 깨진다.
 *   - ★벤더 문서가 GLM/MiniMax 에 없던 키 둘(FABLE·SUBAGENT)을 더 요구한다.
 *     안 접으면 그 경로가 Anthropic 모델명 그대로 Kimi 로 나가 실패한다.
 *
 * ★라이브 스폰(실제로 Kimi 가 **응답**하는가)은 Kimi 멤버십 구독키가 있어야 하므로
 * 여기 없다. 그 검증 경로는 `npm run verify:models` 의 [vendor] 섹션이다.
 * 다만 "엔드포인트가 실재하고 Anthropic 프로토콜을 말한다" 는 티켓 작업 중
 * 라이브로 확인했다(model-registry 의 KIMI_CODE_PROBE 주석에 재현 절차 기록).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  HARNESS_IDS,
  MODEL_REGISTRY,
  VENDOR_IDS,
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
import { useVerifiedClaudeCli } from "../fixtures/verified-claude-cli";

useVerifiedClaudeCli();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-kimi-"));

/**
 * 실측 엔드포인트 — www.kimi.com/code/docs/en/ 의 "Service Endpoint" 표
 * (Anthropic Compatible Base URL) + /third-party-tools/claude-code.html 설정 예시.
 * ★말미 슬래시까지 원문 그대로다. claude CLI 가 여기에 `v1/messages` 를 붙인다.
 */
const KIMI_ANTHROPIC_ENDPOINT = "https://api.kimi.com/coding/";
/** 시크릿 값은 테스트에서도 실제 키를 쓰지 않는다 — 형태만 있으면 충분하다. */
const FAKE_KEY = "test-kimi-key-not-a-real-secret";

const KIMI_IDS = ["k3", "k3-256k", "kimi-for-coding"] as const;

/** KIMI_API_KEY 를 켠 상태로 fn 실행(테스트 격리 — 원래 값 복원). */
function withKimiKey<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.KIMI_API_KEY;
  if (value === undefined) delete process.env.KIMI_API_KEY;
  else process.env.KIMI_API_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.KIMI_API_KEY;
    else process.env.KIMI_API_KEY = prev;
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
// (0) ★1단계 판별 회귀 가드 — (B)형이지 (A)형이 아니다
// ─────────────────────────────────────────────────────────────────────────

describe("★판별 결과 고정 — Kimi 는 env-swap 벤더지 신규 하네스가 아니다", () => {
  it("★`HarnessId` 에 kimi 가 없다(스폰할 새 바이너리가 없다)", () => {
    // 이 케이스가 깨졌다면 누군가 (A)형 하네스를 늘린 것이다. 그 자체가 틀린
    // 일은 아니지만, 그 순간 grok 3겹(argv 네이티브화 / 격리홈 auth 전파 /
    // command 정규화)이 **전부 필요해진다** — 이 파일이 그 신호를 낸다.
    expect(HARNESS_IDS).not.toContain("kimi");
    expect(HARNESS_IDS).not.toContain("moonshot");
    for (const id of KIMI_IDS) {
      expect(harnessForModel(id), id).toBe("claude");
    }
  });

  it("moonshot 은 **벤더** 축에만 있다", () => {
    expect(VENDOR_IDS).toContain("moonshot");
    // 축 분리의 요지: 벤더가 늘어도 하네스 유니온은 그대로다.
    expect(HARNESS_IDS.length).toBe(7);
  });

  it("★Kimi 편입으로 늘어난 코드가 없다 — 전부 레지스트리 데이터다", () => {
    // 벤더별 switch/case 가 생겼다면 `harnessForLaunch` 가 claude 아닌 값을
    // 돌려주기 시작한다. 세 행 모두 claude 바이너리로 접혀야 한다.
    for (const id of KIMI_IDS) {
      expect(harnessForLaunch("claude", id), id).toBe("claude");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (1) 등록
// ─────────────────────────────────────────────────────────────────────────

describe("★Kimi 행 등록 — provider=moonshot / harness=claude", () => {
  it.each(KIMI_IDS)(
    "%s 가 moonshot 벤더 + claude 하네스로 등록돼 있다",
    (id) => {
      const entry = getModel(id);
      expect(entry, id).toBeDefined();
      expect(entry!.id).toBe(id); // alias 가 아니라 구체 id 로 잡힌다
      expect(vendorForModel(id)).toBe("moonshot");
      expect(harnessForModel(id)).toBe("claude");
      expect(entry!.status).toBe("active");
      // K3 는 reasoning_effort 가 있지만 그 축은 세션 내(`/effort`)이지 우리
      // 스폰 argv 가 아니다 — claude 하네스엔 effort 인자가 없다.
      expect(entry!.efforts).toEqual([]);
    },
  );

  it("★배선값이 벤더 공식문서 실측값 그대로다(날조 0)", () => {
    expect(envProfileForModel("k3")).toEqual({
      ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "k3",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "k3",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "k3",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
      CLAUDE_CODE_SUBAGENT_MODEL: "k3",
    });
    expect(envProfileForModel("k3-256k")).toEqual({
      ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "k3-256k",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "k3-256k",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "k3-256k",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
      CLAUDE_CODE_SUBAGENT_MODEL: "k3-256k",
    });
    expect(envProfileForModel("kimi-for-coding")).toEqual({
      ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_ENDPOINT,
      ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "kimi-for-coding",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-for-coding",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-for-coding",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
      CLAUDE_CODE_SUBAGENT_MODEL: "kimi-for-coding",
    });
  });

  it("★엔드포인트는 Kimi **Code**(구독) 쪽이다 — Platform(pay-go) 이 아니다", () => {
    // 두 백엔드는 키도 모델 id 도 다르다. 여기를 api.moonshot.ai 로 적으면
    // 구독 크레덴셜이 종량제 엔드포인트로 나간다.
    for (const id of KIMI_IDS) {
      const url = envProfileForModel(id).ANTHROPIC_BASE_URL;
      expect(url, id).toBe("https://api.kimi.com/coding/");
      expect(url, id).not.toContain("moonshot.ai");
      expect(url, id).not.toContain("moonshot.cn");
    }
  });

  it("★모델 id 는 Kimi Code 표기지 Platform 표기가 아니다", () => {
    // Platform 쪽 id 는 `kimi-k3` / `kimi-k2.7-code` 다. 베이스 URL 이 다르면
    // id 도 다르다 — 섞어 쓰면 우리가 만든 문자열을 남의 API 로 보내는 셈이다.
    expect(getModel("kimi-k3")).toBeUndefined();
    expect(getModel("kimi-k2.7-code")).toBeUndefined();
    expect(getModel("k3")!.id).toBe("k3");
    expect(getModel("kimi-for-coding")!.id).toBe("kimi-for-coding");
  });

  it("★`[1m]` 대괄호 변종은 등록하지 않았다(GLM·MiniMax 와 같은 규율)", () => {
    // 그 표기는 CLAUDE_CODE_AUTO_COMPACT_WINDOW 동반을 요구하는데 라이브 미확인이다.
    expect(getModel("k3[1m]")).toBeUndefined();
    expect(JSON.stringify(MODEL_REGISTRY)).not.toContain("[1m]");
    // 미검증 컨텍스트 노브가 프로파일에 새지 않았다.
    for (const id of KIMI_IDS) {
      const profile = envProfileForModel(id);
      expect(profile.CLAUDE_CODE_AUTO_COMPACT_WINDOW, id).toBeUndefined();
      expect(profile.CLAUDE_CODE_MAX_CONTEXT_TOKENS, id).toBeUndefined();
    }
  });

  it("★highspeed 판은 등록하지 않았다(같은 성능에 쿼터 3배)", () => {
    expect(getModel("kimi-for-coding-highspeed")).toBeUndefined();
  });

  it("★ANTHROPIC_DEFAULT_*·SUBAGENT 가 전부 레지스트리에 있는 Kimi id 다(유령 비용 차단)", () => {
    // 미등록 id 가 스폰 env 로 새면 cost-tracker 가 단가를 몰라 비용이 0 으로
    // 집계된다. 벤더 문서가 권하는 id 라도 우리가 등록하지 않았으면 안 쓴다.
    for (const id of KIMI_IDS) {
      const profile = envProfileForModel(id);
      for (const key of [
        "ANTHROPIC_DEFAULT_FABLE_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "CLAUDE_CODE_SUBAGENT_MODEL",
      ]) {
        const mapped = profile[key];
        expect(getModel(mapped), `${id}.${key}=${mapped}`).toBeDefined();
        expect(getModel(mapped)!.provider, `${id}.${key}`).toBe("moonshot");
        // 단가표(cost-tracker 의 단일소스)에 행이 있다.
        expect(registryPricing()[mapped], `${id}.${key}`).toBeDefined();
      }
    }
  });

  it("★FABLE·SUBAGENT 키를 빠뜨리지 않았다 — 벤더 경계를 전부 닫는다", () => {
    // 우리 fleet 엔 claude-fable-5 행이 실재하고 Task 서브에이전트도 뜬다.
    // 이 둘을 안 접으면 그 경로가 Anthropic 모델명 그대로 Kimi 로 나가 실패한다.
    // (GLM/MiniMax 문서엔 없던 키라 복사만 하면 조용히 빠지는 자리다.)
    for (const id of KIMI_IDS) {
      const profile = envProfileForModel(id);
      expect(profile.ANTHROPIC_DEFAULT_FABLE_MODEL, id).toBeTruthy();
      expect(profile.CLAUDE_CODE_SUBAGENT_MODEL, id).toBeTruthy();
    }
  });

  it("★단가는 벤더 공식 가격표 값이고 estimated 로 표시된다", () => {
    // platform.kimi.ai/docs/pricing — cache-miss 입력 / 출력.
    expect(getModel("k3")!.pricing).toEqual({
      inputPer1M: 3.0,
      outputPer1M: 15.0,
      estimated: true,
    });
    expect(getModel("kimi-for-coding")!.pricing).toEqual({
      inputPer1M: 0.95,
      outputPer1M: 4.0,
      estimated: true,
    });
    // 우리 접근 경로는 정액 구독이라 실 한계비용은 이 값이 아니다 → 전부 estimated.
    for (const id of KIMI_IDS) {
      expect(getModel(id)!.pricing.estimated, id).toBe(true);
    }
  });

  it("★시크릿은 값이 아니라 env 키 이름으로만 있다", () => {
    expect(vendorEnvSecretRef("${KIMI_API_KEY}")).toBe("KIMI_API_KEY");
    expect(vendorEnvSecretRef(KIMI_ANTHROPIC_ENDPOINT)).toBeUndefined();
    for (const id of KIMI_IDS) {
      expect(vendorEnvSecretKeys(id), id).toEqual(["KIMI_API_KEY"]);
    }
    // ★Platform 키 이름과 섞이지 않았다 — 다른 계정의 다른 키다.
    expect(JSON.stringify(MODEL_REGISTRY)).not.toContain("MOONSHOT_API_KEY");
    // 레지스트리 어느 행에도 키처럼 생긴 리터럴이 없다.
    for (const entry of MODEL_REGISTRY) {
      for (const [key, value] of Object.entries(entry.envProfile ?? {})) {
        if (!/token|key|secret/i.test(key)) continue;
        expect(vendorEnvSecretRef(value), `${entry.id}.${key}`).toBeTruthy();
      }
    }
    expect(JSON.stringify(MODEL_REGISTRY)).not.toMatch(/sk-[a-z]{2}-/i);
  });

  it("★사다리에 들어간다(hyKsSYYM, 사장님 A안) — 키 있으면 워커 자동선택 후보", () => {
    // ★tUobgoQF 당시엔 "명시 지정 전용"(LADDER_EXCLUSIONS)이었다. hyKsSYYM
    // (사장님 A안)이 그 배제를 풀었다 — Kimi Code 도 키만 있으면 워커 자동선택
    // 사다리 칸이다. LADDER_EXCLUSIONS 에 남아 있으면 완결성 테스트(사다리 XOR
    // 제외)가 깨지므로, 여기 없다는 것 자체가 편입의 증거다.
    for (const id of KIMI_IDS) {
      expect(LADDER_EXCLUSIONS[id], id).toBeUndefined();
      expect(ladderFor("claude")!.rungs.some((r) => r.model === id)).toBe(true);
    }
  });

  it("하네스 필터엔 잡히고 벤더 필터로 갈린다", () => {
    const byHarness = modelsByHarness("claude").map((m) => m.id);
    for (const id of KIMI_IDS) expect(byHarness, id).toContain(id);
    expect(byHarness).toContain("claude-opus-5");
    expect(
      modelsByVendor("moonshot")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["k3", "k3-256k", "kimi-for-coding"]);
    // 벤더 축이 앞선 두 env-swap 벤더와 섞이지 않는다.
    expect(
      modelsByVendor("zai")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["glm-4.7", "glm-5.2"]);
    expect(
      modelsByVendor("minimax")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["MiniMax-M2.7", "MiniMax-M3"]);
    expect(modelsByVendor("anthropic").map((m) => m.id)).not.toContain("k3");
  });

  it("★오케 셀렉터엔 안 선다 — 영구 저장되는 기본값에 조건부 크레덴셜을 얹지 않는다", () => {
    const choices = claudeOrchestratorChoices();
    for (const id of KIMI_IDS) {
      expect(choices.map((c) => c.modelId)).not.toContain(id);
    }
    expect(choices.every((c) => c.vendor === "anthropic")).toBe(true);
    expect(choices.some((c) => /kimi|moonshot/i.test(c.label))).toBe(false);
  });

  it("느슨한 인덱스가 충돌 없이 만들어진다(Kimi 행이 기존 표기를 가리지 않는다)", () => {
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
    const merged = withKimiKey(FAKE_KEY, () => applyVendorEnv(base, "k3"));
    expect(merged).not.toBe(base); // 프로파일이 있으면 새 객체
    expect(merged.ANTHROPIC_BASE_URL).toBe(KIMI_ANTHROPIC_ENDPOINT);
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY); // 자리표시자가 해석됐다
    expect(merged.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("k3");
    expect(merged.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("kimi-for-coding");
    expect(merged.CLAUDE_CODE_SUBAGENT_MODEL).toBe("k3");
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_AGENT_ID).toBe("ag-1");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(base.PATH).toBe("/usr/bin"); // 원본 불변
    expect(Object.keys(base)).toHaveLength(3);
  });

  it("★dispatch(model='kimi-for-coding') 가 claude 바이너리 + Kimi env 로 스폰된다", () => {
    // dispatch 경로가 실제로 쓰는 두 함수를 그대로 통과시킨다.
    const spec = parseModelSpec("kimi-for-coding");
    expect(spec).toMatchObject({
      harness: "claude",
      vendor: "moonshot",
      modelId: "kimi-for-coding",
    });
    const pin = resolveModelPin("kimi-for-coding", "2.1.220");
    expect(pin).toMatchObject({
      harness: "claude",
      claudeModel: "kimi-for-coding",
    });
    expect(pin!.fallback).toBeUndefined(); // 폴백 없이 Kimi 가 살아남는다

    const cfg = withKimiKey(FAKE_KEY, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-kimi", model: "claude", role: "backend", command: "" },
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
    // ★argv 에 나가는 값이 벤더 문서 표기 그대로다.
    expect(cfg.args.slice(0, 3)).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "kimi-for-coding",
    ]);
    expect(cfg.env.ANTHROPIC_BASE_URL).toBe(KIMI_ANTHROPIC_ENDPOINT);
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe(FAKE_KEY);
    // ★ANTHROPIC_API_KEY 는 안 쓴다 — claude CLI 의 "이 API 키를 쓸까요?" 승인
    // 경로를 건드리는 축이라, 대화형 스폰이 프롬프트에서 멈출 수 있다.
    expect(cfg.env.ANTHROPIC_API_KEY).toBeUndefined();
    // MCP 배선은 한 글자도 안 바뀐다 — 에이전트가 보드에서 사라지지 않는다.
    expect(cfg.args).toContain("--strict-mcp-config");
    expect(cfg.env.MARBLO_AGENT_ID).toBe("ag-kimi");
    expect(cfg.env.MARBLO_BRIDGE_TOKEN).toBeTruthy();
  });

  it("대소문자를 섞어 지정해도 같은 스폰이 된다(사람이 치는 표기 흡수)", () => {
    for (const spelling of ["K3", "  k3  ", "KIMI-FOR-CODING"]) {
      const resolved = resolveModelAlias(spelling);
      expect(getModel(spelling), spelling).toBeDefined();
      expect(envProfileForModel(spelling).ANTHROPIC_BASE_URL, spelling).toBe(
        KIMI_ANTHROPIC_ENDPOINT,
      );
      expect(resolved, spelling).toBe(resolved.trim());
    }
    expect(resolveModelPin("K3", "2.1.220")!.claudeModel).toBe("k3");
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
        ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_ENDPOINT,
      },
      { model: "k3", vendor: "moonshot" },
    );
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.MARBLO_BRIDGE_TOKEN).toBe("ours");
    expect(merged.CODEX_HOME).toBe("/ours");
    expect(merged.VITE_FIREBASE_API_KEY).toBeUndefined();
    expect(merged.ANTHROPIC_BASE_URL).toBe(KIMI_ANTHROPIC_ENDPOINT);
    expect(warn).toHaveBeenCalled(); // 조용히 버리지 않는다
  });

  it("readiness 가 준비완료를 보고한다(값이 아니라 키 이름으로)", () => {
    const r = withKimiKey(FAKE_KEY, () => vendorEnvReadiness("k3"));
    expect(r).toEqual({
      vendor: "moonshot",
      hasProfile: true,
      requiredEnvKeys: ["KIMI_API_KEY"],
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
    const merged = withKimiKey(undefined, () => applyVendorEnv(base, "k3"));
    // 참조 동일성 — env 를 한 바이트도 안 건드렸다.
    expect(merged).toBe(base);
    // ★엔드포인트만 얹히면 우리 Anthropic 크레덴셜이 Kimi 로 나간다. 그게 없다.
    expect(merged.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(warn).toHaveBeenCalled(); // 조용히 넘어가지 않는다
  });

  it("★스폰은 계속된다(throw 없음) — 티켓이 멈추는 것보다 낫다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = withKimiKey(undefined, () =>
      new AgentConfigGenerator().getLaunchConfig(
        { id: "ag-kimi-nokey", model: "claude", role: "backend", command: "" },
        TMP,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        { claudeModel: "k3" },
      ),
    );
    expect(cfg.command).toBeTruthy();
    expect(cfg.args).toContain("--model");
    expect(
      Object.keys(cfg.env).filter((k) => k.startsWith("ANTHROPIC_")),
    ).toEqual([]);
    // SUBAGENT 키도 함께 빠진다(전부-아니면-전무는 프로파일 **전체**에 걸린다).
    expect(cfg.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it("빈 문자열·공백만 있는 키도 '미설정' 이다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of ["", "   "]) {
      const r = withKimiKey(value, () => vendorEnvReadiness("k3"));
      expect(r.ready, JSON.stringify(value)).toBe(false);
      expect(r.missingEnvKeys).toEqual(["KIMI_API_KEY"]);
    }
  });

  it("readiness 가 '무엇을 넣어야 켜지나' 를 키 이름으로 알려준다", () => {
    const r = withKimiKey(undefined, () =>
      vendorEnvReadiness("kimi-for-coding"),
    );
    expect(r).toEqual({
      vendor: "moonshot",
      hasProfile: true,
      requiredEnvKeys: ["KIMI_API_KEY"],
      missingEnvKeys: ["KIMI_API_KEY"],
      ready: false,
      notReadyReason: "missing-credentials",
    });
  });

  it("resolveVendorEnvProfile 이 시크릿 아닌 값은 그대로 통과시킨다", () => {
    const out = withKimiKey(undefined, () =>
      resolveVendorEnvProfile({
        ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_ENDPOINT,
        ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
      }),
    );
    expect(out.resolved).toEqual({
      ANTHROPIC_BASE_URL: KIMI_ANTHROPIC_ENDPOINT,
    });
    expect(out.missing).toEqual(["KIMI_API_KEY"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (3) 회귀 0 — Kimi 행이 생겨도 기존 벤더는 그대로다
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
    const cfg = withKimiKey(FAKE_KEY, () => launch("claude"));
    expect(cfg.args.slice(0, 3)).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "claude-opus-5",
    ]);
    // ★키가 설정돼 있어도 anthropic 행에는 아무것도 안 붙는다.
    expect(
      Object.keys(cfg.env).filter((k) => k.startsWith("ANTHROPIC_")),
    ).toEqual([]);
    expect(cfg.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it("codex 스폰 argv·env 가 종전과 같다", () => {
    const cfg = withKimiKey(FAKE_KEY, () => launch("gpt"));
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

  it("★GLM·MiniMax 행이 Kimi 키로는 안 켜진다(벤더별 크레덴셜이 섞이지 않는다)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { PATH: "/usr/bin" };
    const prevZai = process.env.ZAI_API_KEY;
    const prevMm = process.env.MINIMAX_API_KEY;
    delete process.env.ZAI_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
      withKimiKey(FAKE_KEY, () => {
        expect(applyVendorEnv(base, "glm-4.7")).toBe(base);
        expect(applyVendorEnv(base, "MiniMax-M3")).toBe(base);
      });
    } finally {
      if (prevZai !== undefined) process.env.ZAI_API_KEY = prevZai;
      if (prevMm !== undefined) process.env.MINIMAX_API_KEY = prevMm;
    }
    // 반대로 두 벤더의 프로파일 자체는 종전 값 그대로다.
    expect(envProfileForModel("glm-4.7").ANTHROPIC_BASE_URL).toBe(
      "https://api.z.ai/api/anthropic",
    );
    expect(envProfileForModel("MiniMax-M3").ANTHROPIC_BASE_URL).toBe(
      "https://api.minimax.io/anthropic",
    );
  });

  it("★Kimi 행이 Kimi 키만으로 켜진다(다른 벤더 키로는 안 켜진다)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { PATH: "/usr/bin" };
    const prevZai = process.env.ZAI_API_KEY;
    process.env.ZAI_API_KEY = "some-other-vendor-key";
    try {
      // KIMI_API_KEY 가 없으면 ZAI 키가 있어도 Kimi 는 미주입이다.
      const merged = withKimiKey(undefined, () => applyVendorEnv(base, "k3"));
      expect(merged).toBe(base);
    } finally {
      if (prevZai === undefined) delete process.env.ZAI_API_KEY;
      else process.env.ZAI_API_KEY = prevZai;
    }
  });
});
