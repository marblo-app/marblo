import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { modelTierForComplexity } from "../../electron/agent-config";

// 작업 complexity → 프로바이더별 모델/레벨. 디스패치 에이전트 비용 절감(quota):
// claude=--model(sonnet/opus), gpt(codex)=reasoning(low/medium/high). complexity
// 미지정(오케스트레이터 경로)이면 override 없음 → 기본 모델 유지.
//
// SPAWN-MODEL-ALLOCATION-V2 §3 이후: complex 티어만 env 주입 resolver 를 탄다
// (★사용자 결정1). standard 는 "opus" 리터럴 고정. env 미설정 시 complex 도
// opus/high 로 떨어져 현행과 byte-identical(무회귀).
describe("modelTierForComplexity", () => {
  // resolver 가 읽는 env 를 각 테스트가 깨끗한 상태에서 시작하도록 보존/복원.
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
  });
  afterEach(() => {
    for (const k of TOP_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("claude: simple → sonnet, standard/complex → opus (env 미설정 = 현행 무회귀)", () => {
    expect(modelTierForComplexity("claude", "simple").claudeModel).toBe(
      "sonnet",
    );
    expect(modelTierForComplexity("claude", "standard").claudeModel).toBe(
      "opus",
    );
    expect(modelTierForComplexity("claude", "complex").claudeModel).toBe(
      "opus",
    );
  });

  it("gpt(codex): simple→low, standard→medium, complex→high (env 미설정 = 무회귀)", () => {
    expect(modelTierForComplexity("gpt", "simple").codexReasoning).toBe("low");
    expect(modelTierForComplexity("gpt", "standard").codexReasoning).toBe(
      "medium",
    );
    expect(modelTierForComplexity("gpt", "complex").codexReasoning).toBe(
      "high",
    );
  });

  it("complexity 미지정 → 빈 객체(override 없음 = 기본 모델 유지, 오케 경로)", () => {
    expect(modelTierForComplexity("claude", undefined)).toEqual({});
    expect(modelTierForComplexity("gpt", undefined)).toEqual({});
  });

  it("gemini/antigravity 등은 레벨 플래그 없음(빈 객체)", () => {
    expect(modelTierForComplexity("gemini", "complex")).toEqual({});
    expect(modelTierForComplexity("antigravity", "standard")).toEqual({});
  });

  // ── ★결정1: MARBLO_TOP_CLAUDE_MODEL 은 complex 에만 영향 ──────────

  it("MARBLO_TOP_CLAUDE_MODEL 은 complex claude 만 바꾸고 standard 는 opus 유지", () => {
    // sonnet 은 검증된 알려진 id 라 resolver 를 통과(버전가드 무관, 결정적).
    process.env.MARBLO_TOP_CLAUDE_MODEL = "sonnet";
    // complex 만 resolver → "sonnet".
    expect(modelTierForComplexity("claude", "complex").claudeModel).toBe(
      "sonnet",
    );
    // standard 는 리터럴 "opus" 고정 — env 영향 없음(표준작업 비용 무변동).
    expect(modelTierForComplexity("claude", "standard").claudeModel).toBe(
      "opus",
    );
    // simple 도 영향 없음.
    expect(modelTierForComplexity("claude", "simple").claudeModel).toBe(
      "sonnet",
    );
  });

  it("MARBLO_TOP_CLAUDE_MODEL=opus 명시 시 complex=opus (무변동)", () => {
    process.env.MARBLO_TOP_CLAUDE_MODEL = "opus";
    expect(modelTierForComplexity("claude", "complex").claudeModel).toBe(
      "opus",
    );
  });

  it("MARBLO_TOP_CODEX_REASONING 은 complex codex 만 바꾸고 standard/simple 유지", () => {
    process.env.MARBLO_TOP_CODEX_REASONING = "medium";
    expect(modelTierForComplexity("gpt", "complex").codexReasoning).toBe(
      "medium",
    );
    // standard/simple 은 고정 매핑.
    expect(modelTierForComplexity("gpt", "standard").codexReasoning).toBe(
      "medium",
    );
    expect(modelTierForComplexity("gpt", "simple").codexReasoning).toBe("low");
  });
});
