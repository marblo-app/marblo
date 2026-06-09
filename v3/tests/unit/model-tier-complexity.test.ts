import { describe, it, expect } from "vitest";
import { modelTierForComplexity } from "../../electron/agent-config";

// 작업 complexity → 프로바이더별 모델/레벨. 디스패치 에이전트 비용 절감(quota):
// claude=--model(sonnet/opus), gpt(codex)=reasoning(low/medium/high). complexity
// 미지정(오케스트레이터 경로)이면 override 없음 → 기본 모델 유지.
describe("modelTierForComplexity", () => {
  it("claude: standard/simple → sonnet, complex → opus", () => {
    expect(modelTierForComplexity("claude", "simple").claudeModel).toBe(
      "sonnet",
    );
    expect(modelTierForComplexity("claude", "standard").claudeModel).toBe(
      "sonnet",
    );
    expect(modelTierForComplexity("claude", "complex").claudeModel).toBe(
      "opus",
    );
  });

  it("gpt(codex): simple→low, standard→medium, complex→high", () => {
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
});
