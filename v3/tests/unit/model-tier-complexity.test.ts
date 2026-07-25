import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  modelTierForComplexity,
  resolveSimpleClaudeModel,
  resolveSimpleCodexReasoning,
  resolveStandardClaudeModel,
  DEFAULT_STANDARD_CLAUDE_MODEL,
  FALLBACK_TOP_CLAUDE_MODEL,
} from "../../electron/agent-config";
import { isKnownModelId, isModelAlias } from "../../electron/model-registry";

// 작업 complexity → 프로바이더별 모델/레벨. 디스패치 에이전트 비용 절감(quota):
// claude=--model, gpt(codex)=reasoning(low/medium/high). complexity
// 미지정(오케스트레이터 경로)이면 override 없음 → 기본 모델 유지.
//
// ★2026-07-25(라우팅 P1-4): claude 세 티어가 전부 model-registry 를 경유해
// **구체 id** 를 반환한다. 서빙 모델은 설계문서 §1.1 CLI 프로브 기준 종전과
// 동일하고, 달라진 건 그 선택이 alias(이동표적)가 아니라는 점뿐이다.
//
// ★테스트는 CLI 버전을 반드시 **주입**한다. 주입 없이 짠 종전 유닛은 설치된
// claude 를 실제로 읽었기 때문에, 우리가 코드를 한 줄도 안 고쳤는데 CLI 가
// 2.1.163 → 2.1.220 으로 올라간 것만으로 깨졌다(사전존재 실패 2건). 그게 바로
// 이 티켓이 고치는 "조용한 승격" 의 테스트판이라, 같은 함정을 되풀이하지 않는다.
const CLI = "2.1.220"; // §1.1 프로브를 돌린 버전
const OLD_CLI = "2.1.163"; // Claude 5 세대 이전(미검증 구간)

describe("modelTierForComplexity", () => {
  // resolver 가 읽는 env 를 각 테스트가 깨끗한 상태에서 시작하도록 보존/복원.
  const TOP_KEYS = [
    "MARBLO_TOP_CLAUDE_MODEL",
    "MARBLO_TOP_CODEX_REASONING",
    "MARBLO_FABLE5_MIN_CLI",
    "MARBLO_SIMPLE_CLAUDE_MODEL",
    "MARBLO_SIMPLE_CODEX_REASONING",
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

  it("claude 기본 매핑: simple→sonnet5, standard→opus5, complex→fable5", () => {
    expect(modelTierForComplexity("claude", "simple", CLI).claudeModel).toBe(
      "claude-sonnet-5",
    );
    expect(modelTierForComplexity("claude", "standard", CLI).claudeModel).toBe(
      "claude-opus-5",
    );
    expect(modelTierForComplexity("claude", "complex", CLI).claudeModel).toBe(
      "claude-fable-5",
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

  // ─────────────────────────────────────────────────────────────────────
  // ★P1-4 회귀 가드 — alias 리터럴의 조용한 세대 승격 방지.
  //
  // 원래 결함(설계문서 §1.3-①): standard 가 `{ claudeModel: "opus" }` 리터럴이라
  // claude CLI 업데이트로 alias `opus` 의 의미가 opus-4.x → claude-opus-5 로
  // 바뀌자, "표준작업 비용 무변동" 이라는 주석 그대로의 설계 의도가 코드 변경
  // 없이 깨졌다. 아래 두 테스트가 그 부류의 재발을 막는다.
  // ─────────────────────────────────────────────────────────────────────
  describe("★조용한 승격 방지 (P1-4)", () => {
    it("세 티어의 주 선택값이 전부 '구체 registry id' 다 — alias 리터럴 금지", () => {
      for (const complexity of ["simple", "standard", "complex"] as const) {
        const picked = modelTierForComplexity(
          "claude",
          complexity,
          CLI,
        ).claudeModel;
        expect(picked).toBeDefined();
        // alias 면 CLI 가 뜻을 바꿀 때 우리 선택이 따라 움직인다 → 금지.
        expect(isModelAlias(picked!)).toBe(false);
        // 레지스트리가 모르는 id 면 CLI-verified 규율이 깨진 것 → 금지.
        expect(isKnownModelId(picked!)).toBe(true);
      }
    });

    it("standard 는 사장님 결정대로 claude-opus-5 에 핀된다", () => {
      expect(DEFAULT_STANDARD_CLAUDE_MODEL).toBe("claude-opus-5");
      expect(resolveStandardClaudeModel(CLI)).toBe("claude-opus-5");
      expect(
        modelTierForComplexity("claude", "standard", CLI).claudeModel,
      ).toBe("claude-opus-5");
    });

    it("폴백만 alias 다 — 그리고 그건 의도된 예외로 명시돼 있다", () => {
      // 안전 바닥은 이동표적이어야 한다: CLI 버전을 못 믿는 구간에서 "CLI 가
      // 아는 최선" 으로 떨어지는 게 목적이기 때문.
      expect(isModelAlias(FALLBACK_TOP_CLAUDE_MODEL)).toBe(true);
      // 미검증 CLI 구간에선 구체 id 를 강행하지 않고 그 alias 로 떨어진다
      // = 이 변경 이전의 동작 그대로 → 구형 CLI 무회귀.
      expect(
        modelTierForComplexity("claude", "standard", OLD_CLI).claudeModel,
      ).toBe(FALLBACK_TOP_CLAUDE_MODEL);
      expect(
        modelTierForComplexity("claude", "simple", OLD_CLI).claudeModel,
      ).toBe(FALLBACK_TOP_CLAUDE_MODEL);
    });

    it("standard 는 MARBLO_STANDARD_CLAUDE_MODEL 로만 움직인다(다른 티어 env 와 독립)", () => {
      process.env.MARBLO_TOP_CLAUDE_MODEL = "sonnet";
      process.env.MARBLO_SIMPLE_CLAUDE_MODEL = "haiku";
      expect(
        modelTierForComplexity("claude", "standard", CLI).claudeModel,
      ).toBe("claude-opus-5");
      process.env.MARBLO_STANDARD_CLAUDE_MODEL = "claude-opus-4-8";
      expect(
        modelTierForComplexity("claude", "standard", CLI).claudeModel,
      ).toBe("claude-opus-4-8");
    });
  });

  // ── ★결정1: MARBLO_TOP_CLAUDE_MODEL 은 complex 에만 영향 ──────────

  it("MARBLO_TOP_CLAUDE_MODEL 은 complex claude 만 바꾸고 standard 는 opus5 유지", () => {
    process.env.MARBLO_TOP_CLAUDE_MODEL = "sonnet";
    // complex 만 resolver → alias 는 구체 id 로 정규화된다.
    expect(modelTierForComplexity("claude", "complex", CLI).claudeModel).toBe(
      "claude-sonnet-5",
    );
    // standard 는 별도 핀 — env 영향 없음.
    expect(modelTierForComplexity("claude", "standard", CLI).claudeModel).toBe(
      "claude-opus-5",
    );
    // simple 도 영향 없음.
    expect(modelTierForComplexity("claude", "simple", CLI).claudeModel).toBe(
      "claude-sonnet-5",
    );
  });

  it("MARBLO_TOP_CLAUDE_MODEL=opus 명시 시 complex=claude-opus-5", () => {
    process.env.MARBLO_TOP_CLAUDE_MODEL = "opus";
    expect(modelTierForComplexity("claude", "complex", CLI).claudeModel).toBe(
      "claude-opus-5",
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

  // ── §B: simple cheap 모델 env-configurable (isolate 물리스폰에서 사용) ──────

  it("MARBLO_SIMPLE_CLAUDE_MODEL 은 simple claude 만 바꾸고 standard/complex 유지", () => {
    process.env.MARBLO_SIMPLE_CLAUDE_MODEL = "haiku";
    expect(modelTierForComplexity("claude", "simple", CLI).claudeModel).toBe(
      "claude-haiku-4-5-20251001",
    );
    // standard/complex 은 영향 없음.
    expect(modelTierForComplexity("claude", "standard", CLI).claudeModel).toBe(
      "claude-opus-5",
    );
    expect(modelTierForComplexity("claude", "complex", CLI).claudeModel).toBe(
      "claude-fable-5",
    );
  });

  it("MARBLO_SIMPLE_CODEX_REASONING 은 simple codex 만 바꾸고 무효값은 low 폴백", () => {
    process.env.MARBLO_SIMPLE_CODEX_REASONING = "medium";
    expect(modelTierForComplexity("gpt", "simple").codexReasoning).toBe(
      "medium",
    );
    process.env.MARBLO_SIMPLE_CODEX_REASONING = "bogus";
    expect(modelTierForComplexity("gpt", "simple").codexReasoning).toBe("low");
  });

  it("resolveSimpleClaudeModel: env 미설정=sonnet5, 빈값도 sonnet5 폴백", () => {
    expect(resolveSimpleClaudeModel(CLI)).toBe("claude-sonnet-5");
    process.env.MARBLO_SIMPLE_CLAUDE_MODEL = "   ";
    expect(resolveSimpleClaudeModel(CLI)).toBe("claude-sonnet-5");
    process.env.MARBLO_SIMPLE_CLAUDE_MODEL = "OPUS"; // 대소문자 무관
    expect(resolveSimpleClaudeModel(CLI)).toBe("claude-opus-5");
  });

  it("resolveSimpleCodexReasoning: env 미설정=low(무회귀), 유효값만 통과", () => {
    expect(resolveSimpleCodexReasoning()).toBe("low");
    process.env.MARBLO_SIMPLE_CODEX_REASONING = "HIGH";
    expect(resolveSimpleCodexReasoning()).toBe("high");
    process.env.MARBLO_SIMPLE_CODEX_REASONING = "nonsense";
    expect(resolveSimpleCodexReasoning()).toBe("low");
  });
});
