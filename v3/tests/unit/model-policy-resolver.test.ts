import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveTopClaudeModel,
  resolveTopClaudeModelDetailed,
  resolveTopCodexReasoning,
  cmpSemver,
  CLAUDE_MODEL_ALIASES,
  FALLBACK_TOP_CLAUDE_MODEL,
} from "../../electron/agent-config";

// SPAWN-MODEL-ALLOCATION-V2 §3 — 최상위 모델 견고화. env 주입 + CLI 버전가드 +
// 그레이스풀 폴백. resolveClaudeBinary().version 의존을 끊기 위해
// resolveTopClaudeModelDetailed(installedVersion) 의 주입 인자로 버전을 고정한다.
describe("model-policy resolver (§3)", () => {
  const TOP_KEYS = [
    "MARBLO_TOP_CLAUDE_MODEL",
    "MARBLO_TOP_CODEX_REASONING",
    "MARBLO_FABLE5_MIN_CLI",
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

  // ── alias 테이블 ─────────────────────────────────────────────
  it("CLAUDE_MODEL_ALIASES: fable → claude-fable-5", () => {
    expect(CLAUDE_MODEL_ALIASES.fable).toBe("claude-fable-5");
  });

  // ── resolveTopClaudeModel 기본/알려진 id ─────────────────────
  it("env 미설정 → opus (무회귀 기본값)", () => {
    expect(resolveTopClaudeModel()).toBe("opus");
    expect(resolveTopClaudeModelDetailed("2.1.163")).toEqual({
      model: "opus",
      fallback: null,
    });
  });

  it("opus/sonnet 명시는 버전 무관하게 통과", () => {
    process.env.MARBLO_TOP_CLAUDE_MODEL = "sonnet";
    expect(resolveTopClaudeModelDetailed("1.0.0").model).toBe("sonnet");
    process.env.MARBLO_TOP_CLAUDE_MODEL = "OPUS"; // 대소문자 무관
    expect(resolveTopClaudeModelDetailed("1.0.0").model).toBe("opus");
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
