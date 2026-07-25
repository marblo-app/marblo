// P3-1 사다리 ↔ 라이브 스폰 경로의 계약.
//
// 두 가지를 동시에 못박는다. 둘은 서로를 견제한다:
//
//   A. **비용 무회귀** — 사다리를 데이터로 만들었지만 오늘의 티어 선택은 한
//      바이트도 안 바뀐다. 설계문서 §4 검증법이 요구하는 "정책 변경 전후 비용
//      비교" 의 코드판이다. (사다리 데이터를 고치다 진입 칸을 올리면 여기서
//      즉시 깨진다 — simple 티켓 비용이 조용히 오르는 사고를 막는다.)
//   B. **★게이트 집행** — 어떤 env 조합으로도 max/ultra 가 스폰 인자에 나타나지
//      않는다. 승인 게이트가 "문서상의 약속" 이 아니라 코드 사실이라는 증명.
//
// ★CLI 버전은 반드시 주입한다(model-tier-complexity.test.ts 의 교훈): 주입하지
// 않으면 설치된 claude 버전에 따라 결과가 달라져, 코드를 안 고쳐도 깨진다.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  modelTierForComplexity,
  resolveSimpleCodexReasoning,
  resolveTopCodexReasoning,
} from "../../electron/agent-config";
import {
  APPROVAL_GATED_EFFORTS,
  entryRung,
  isApprovalGatedEffort,
} from "../../electron/model-ladder";
import { EFFORT_LADDER } from "../../electron/model-registry";

const CLI = "2.1.220"; // 설계문서 §1.1 프로브를 돌린 버전

const ENV_KEYS = [
  "MARBLO_TOP_CLAUDE_MODEL",
  "MARBLO_TOP_CODEX_REASONING",
  "MARBLO_FABLE5_MIN_CLI",
  "MARBLO_SIMPLE_CLAUDE_MODEL",
  "MARBLO_SIMPLE_CODEX_REASONING",
  "MARBLO_STANDARD_CLAUDE_MODEL",
];

describe("사다리 ↔ 라이브 티어 정책", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  // ── A. 무회귀 ──────────────────────────────────────────────────────
  it("★claude 세 티어 선택이 사다리 진입 칸과 정확히 일치한다", () => {
    for (const tier of ["simple", "standard", "complex"] as const) {
      expect(modelTierForComplexity("claude", tier, CLI).claudeModel).toBe(
        entryRung("claude", tier)!.model,
      );
    }
  });

  it("★gpt effort 가 사다리 진입 칸의 effort 와 일치한다 = 종전 low/medium/high", () => {
    expect(modelTierForComplexity("gpt", "simple").codexReasoning).toBe("low");
    expect(modelTierForComplexity("gpt", "standard").codexReasoning).toBe(
      "medium",
    );
    expect(modelTierForComplexity("gpt", "complex").codexReasoning).toBe(
      "high",
    );
    // 그리고 그 값이 리터럴이 아니라 사다리에서 온다는 것.
    for (const tier of ["simple", "standard", "complex"] as const) {
      expect(modelTierForComplexity("gpt", tier).codexReasoning).toBe(
        entryRung("gpt", tier)!.effort,
      );
    }
  });

  it("★사다리는 codex 모델 id 를 아직 강제하지 않는다(오늘 배선 없음 = 무회귀)", () => {
    // 사다리의 simple 칸은 gpt-5.6-luna 를 권장하지만, 오늘 스폰은 effort 만
    // 넘긴다. 그 사실이 반환값에 그대로 드러나야 한다(모델 키 부재).
    const out = modelTierForComplexity("gpt", "simple");
    expect(out.codexReasoning).toBe("low");
    expect(Object.keys(out)).toEqual(["codexReasoning"]);
  });

  it("complexity 미지정은 여전히 빈 객체(오케 경로 무영향)", () => {
    expect(modelTierForComplexity("claude", undefined)).toEqual({});
    expect(modelTierForComplexity("gpt", undefined)).toEqual({});
  });

  // ── B. 게이트 집행 ────────────────────────────────────────────────
  it("★어떤 env 값으로도 max/ultra 가 스폰 인자에 나오지 않는다", () => {
    for (const effort of EFFORT_LADDER) {
      process.env.MARBLO_SIMPLE_CODEX_REASONING = effort;
      process.env.MARBLO_TOP_CODEX_REASONING = effort;
      const simple = modelTierForComplexity("gpt", "simple").codexReasoning!;
      const complex = modelTierForComplexity("gpt", "complex").codexReasoning!;
      for (const picked of [simple, complex]) {
        expect(
          isApprovalGatedEffort(picked),
          `env=${effort} 인데 게이트 칸 ${picked} 가 새어 나왔다`,
        ).toBe(false);
      }
    }
  });

  it("max/ultra env 는 티어 기본값으로 떨어지고 경고를 남긴다(조용히 열리지 않음)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const gated of APPROVAL_GATED_EFFORTS) {
      process.env.MARBLO_TOP_CODEX_REASONING = gated;
      expect(resolveTopCodexReasoning()).toBe("high");
      process.env.MARBLO_SIMPLE_CODEX_REASONING = gated;
      expect(resolveSimpleCodexReasoning()).toBe("low");
    }
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(logged).toContain("refusing gated codex effort from env");
  });

  it("게이트 아래 칸(xhigh)은 env 로 열린다 — 명시적 opt-in 은 존중한다", () => {
    process.env.MARBLO_TOP_CODEX_REASONING = "xhigh";
    expect(resolveTopCodexReasoning()).toBe("xhigh");
    process.env.MARBLO_SIMPLE_CODEX_REASONING = "XHIGH"; // 대소문자 무관
    expect(resolveSimpleCodexReasoning()).toBe("xhigh");
  });

  it("무효값은 종전대로 티어 기본값 폴백(무회귀)", () => {
    process.env.MARBLO_TOP_CODEX_REASONING = "nonsense";
    expect(resolveTopCodexReasoning()).toBe("high");
    process.env.MARBLO_SIMPLE_CODEX_REASONING = "  ";
    expect(resolveSimpleCodexReasoning()).toBe("low");
  });
});
