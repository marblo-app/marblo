import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveTopClaudeModel,
  resolveTopClaudeModelDetailed,
  resolveTopCodexReasoning,
  cmpSemver,
  CLAUDE_MODEL_ALIASES,
  FALLBACK_TOP_CLAUDE_MODEL,
  DEFAULT_STANDARD_CLAUDE_MODEL,
  resolveStandardClaudeModelDetailed,
} from "../../electron/agent-config";

// SPAWN-MODEL-ALLOCATION-V2 §3 — 최상위 모델 견고화. env 주입 + CLI 버전가드 +
// 그레이스풀 폴백. resolveClaudeBinary().version 의존을 끊기 위해
// resolveTopClaudeModelDetailed(installedVersion) 의 주입 인자로 버전을 고정한다.
describe("model-policy resolver (§3)", () => {
  const TOP_KEYS = [
    "MARBLO_TOP_CLAUDE_MODEL",
    "MARBLO_TOP_CODEX_REASONING",
    "MARBLO_FABLE5_MIN_CLI",
    "MARBLO_STANDARD_CLAUDE_MODEL",
  ];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of TOP_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // 폴백 경로의 console.warn 노이즈 억제(구조화 로그 자체는 동작).
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of TOP_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  // ── cmpSemver ────────────────────────────────────────────────
  describe("cmpSemver", () => {
    it("정렬 부호를 올바르게 반환", () => {
      expect(cmpSemver("2.1.170", "2.1.163")).toBeGreaterThan(0);
      expect(cmpSemver("2.1.163", "2.1.170")).toBeLessThan(0);
      expect(cmpSemver("2.1.170", "2.1.170")).toBe(0);
      expect(cmpSemver("3.0.0", "2.9.9")).toBeGreaterThan(0);
      expect(cmpSemver("2.2.0", "2.1.999")).toBeGreaterThan(0);
    });
    it("누락 파트는 0 취급, 파싱 불가 토큰도 0", () => {
      expect(cmpSemver("2.1", "2.1.0")).toBe(0);
      expect(cmpSemver("2", "2.0.0")).toBe(0);
      expect(cmpSemver("x.y.z", "0.0.0")).toBe(0);
    });
  });

  // ── alias 테이블 (이제 model-registry 에서 파생) ──────────────
  it("CLAUDE_MODEL_ALIASES: 레지스트리 alias 가 그대로 노출된다", () => {
    expect(CLAUDE_MODEL_ALIASES.fable).toBe("claude-fable-5");
    // ★alias `opus` 가 claude-opus-5 를 가리킨다는 사실이 §1.3-① 결함의 원인.
    // 표에 명시해 둬야 "opus 리터럴을 쓰면 무슨 일이 나는지" 가 코드에 보인다.
    expect(CLAUDE_MODEL_ALIASES.opus).toBe("claude-opus-5");
    expect(CLAUDE_MODEL_ALIASES.sonnet).toBe("claude-sonnet-5");
  });

  // ── resolveTopClaudeModel 기본/알려진 id ─────────────────────
  // ★버전을 주입하지 않으면 설치된 CLI 를 실제로 읽어 결과가 머신마다 달라진다
  //   (종전 이 테스트가 CLI 업그레이드만으로 깨졌던 이유). 전부 주입한다.
  it("env 미설정(=fable) + 구형 CLI → opus 폴백(사유 포함)", () => {
    // 종전 이 테스트는 fallback:null 을 기대했는데, 같은 it 안 윗줄이 먼저
    // 깨지는 바람에 그 오기대가 한 번도 실행되지 않았다. 폴백이 일어났으면
    // 사유 메타가 반드시 있어야 한다(조용한 폴백 금지, §8.1).
    const r = resolveTopClaudeModelDetailed("2.1.163");
    expect(r.model).toBe("opus");
    expect(r.fallback).toMatchObject({
      reason: "fable5_version_guard",
      requested: "claude-fable-5",
      installed: "2.1.163",
      required: "2.1.170",
      fallbackTo: "opus",
    });
  });

  it("env 미설정 + 현행 CLI → claude-fable-5", () => {
    expect(resolveTopClaudeModelDetailed("2.1.220").model).toBe(
      "claude-fable-5",
    );
  });

  it("alias 명시는 구체 id 로 핀된다(검증된 CLI 범위에서)", () => {
    process.env.MARBLO_TOP_CLAUDE_MODEL = "sonnet";
    expect(resolveTopClaudeModelDetailed("2.1.220").model).toBe(
      "claude-sonnet-5",
    );
    process.env.MARBLO_TOP_CLAUDE_MODEL = "OPUS"; // 대소문자 무관
    expect(resolveTopClaudeModelDetailed("2.1.220").model).toBe(
      "claude-opus-5",
    );
  });

  it("미검증 CLI 구간에선 구체 id 를 강행하지 않고 alias 로 안전 폴백", () => {
    // minCli 의 의미는 "이 아래면 미지원" 이 아니라 "이 아래는 미검증" 이다.
    // 폴백 결과가 곧 이 변경 이전 동작이라 구형 CLI 에서도 무회귀다.
    process.env.MARBLO_TOP_CLAUDE_MODEL = "sonnet";
    const r = resolveTopClaudeModelDetailed("1.0.0");
    expect(r.model).toBe(FALLBACK_TOP_CLAUDE_MODEL);
    expect(r.fallback).toMatchObject({
      reason: "min_cli_unverified",
      requested: "claude-sonnet-5",
      installed: "1.0.0",
      fallbackTo: "opus",
    });
  });

  it("미지(검증 불가) 모델 → opus 폴백 + unknown_top_model 사유", () => {
    process.env.MARBLO_TOP_CLAUDE_MODEL = "claude-megatron-9";
    const r = resolveTopClaudeModelDetailed("2.1.170");
    expect(r.model).toBe(FALLBACK_TOP_CLAUDE_MODEL);
    expect(r.fallback?.reason).toBe("unknown_top_model");
    expect(r.fallback?.requested).toBe("claude-megatron-9");
    expect(r.fallback?.fallbackTo).toBe("opus");
    expect(console.warn).toHaveBeenCalled();
  });

  // ── Fable5 버전가드 (§3.4) ───────────────────────────────────
  describe("Fable5 version guard", () => {
    it("CLI 미달(2.1.163 < 2.1.170) → opus 폴백 + fable5_version_guard", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "fable";
      const r = resolveTopClaudeModelDetailed("2.1.163");
      expect(r.model).toBe("opus");
      expect(r.fallback).toMatchObject({
        reason: "fable5_version_guard",
        requested: "claude-fable-5",
        installed: "2.1.163",
        required: "2.1.170",
        fallbackTo: "opus",
      });
    });

    it("CLI 충족(2.1.170 ≥ 2.1.170) → claude-fable-5 활성", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "fable";
      const r = resolveTopClaudeModelDetailed("2.1.170");
      expect(r.model).toBe("claude-fable-5");
      expect(r.fallback).toBeNull();
    });

    it("CLI 상회(2.2.0 > 2.1.170) → claude-fable-5 활성", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "claude-fable-5"; // 정식 id 직접
      expect(resolveTopClaudeModelDetailed("2.2.0").model).toBe(
        "claude-fable-5",
      );
    });

    it("버전 파싱 실패(빈 문자열) → opus 폴백", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "fable";
      const r = resolveTopClaudeModelDetailed("");
      expect(r.model).toBe("opus");
      expect(r.fallback?.installed).toBe("unknown");
    });

    it("MARBLO_FABLE5_MIN_CLI 로 임계값 조정 가능", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "fable";
      process.env.MARBLO_FABLE5_MIN_CLI = "2.1.160"; // 임계값을 낮추면
      // 2.1.163 ≥ 2.1.160 → 활성.
      expect(resolveTopClaudeModelDetailed("2.1.163").model).toBe(
        "claude-fable-5",
      );
    });
  });

  // ── ★standard 티어 명시 핀 (P1-4) ────────────────────────────
  describe("standard 티어 핀", () => {
    it("기본값은 사장님 결정대로 claude-opus-5", () => {
      expect(DEFAULT_STANDARD_CLAUDE_MODEL).toBe("claude-opus-5");
      expect(resolveStandardClaudeModelDetailed("2.1.220")).toEqual({
        model: "claude-opus-5",
        fallback: null,
      });
    });

    it("MARBLO_STANDARD_CLAUDE_MODEL 로 덮어쓸 수 있다", () => {
      process.env.MARBLO_STANDARD_CLAUDE_MODEL = "claude-opus-4-8";
      expect(resolveStandardClaudeModelDetailed("2.1.220").model).toBe(
        "claude-opus-4-8",
      );
    });

    it("complex 티어(MARBLO_TOP_CLAUDE_MODEL)와 서로 간섭하지 않는다", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "fable";
      expect(resolveStandardClaudeModelDetailed("2.1.220").model).toBe(
        "claude-opus-5",
      );
      expect(resolveTopClaudeModel()).toBeTypeOf("string"); // 실 CLI 경로도 살아있음
    });

    it("미지 모델을 지정하면 opus 로 폴백(spawn 을 깨뜨리지 않는다)", () => {
      process.env.MARBLO_STANDARD_CLAUDE_MODEL = "claude-megatron-9";
      const r = resolveStandardClaudeModelDetailed("2.1.220");
      expect(r.model).toBe(FALLBACK_TOP_CLAUDE_MODEL);
      expect(r.fallback?.reason).toBe("unknown_top_model");
    });
  });

  // ── resolveTopCodexReasoning ─────────────────────────────────
  describe("resolveTopCodexReasoning", () => {
    it("env 미설정 → high (무회귀 기본값)", () => {
      expect(resolveTopCodexReasoning()).toBe("high");
    });
    it("유효값(low/medium/high)은 그대로, 대소문자 무관", () => {
      process.env.MARBLO_TOP_CODEX_REASONING = "low";
      expect(resolveTopCodexReasoning()).toBe("low");
      process.env.MARBLO_TOP_CODEX_REASONING = "Medium";
      expect(resolveTopCodexReasoning()).toBe("medium");
    });
    it("무효값 → high 로 폴백", () => {
      process.env.MARBLO_TOP_CODEX_REASONING = "ultra";
      expect(resolveTopCodexReasoning()).toBe("high");
    });
  });
});
