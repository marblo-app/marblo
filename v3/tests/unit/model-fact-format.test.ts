/**
 * 정보표 표기 규칙 회귀 가드.
 *
 * 이 파일이 지키는 것은 미학이 아니라 **사실성**이다: 표기 단계에서 반올림하면
 * 화면 숫자가 출처 문서와 달라지고, 그 순간 "1차 출처 대조 가능" 이라는 이 표의
 * 전제가 깨진다.
 */

import { describe, expect, it } from "vitest";
import {
  benchmarkLabel,
  formatContextTokens,
  formatRate,
  shortHarness,
} from "../../src/lib/modelFactFormat";

describe("formatRate", () => {
  it("벤더 가격표와 같은 모양(소수 둘째자리)", () => {
    expect(formatRate(5)).toBe("$5.00");
    expect(formatRate(2.5)).toBe("$2.50");
    expect(formatRate(0.75)).toBe("$0.75");
    expect(formatRate(0.3)).toBe("$0.30");
  });
});

describe("formatContextTokens", () => {
  it("★반올림으로 사실을 지우지 않는다", () => {
    // OpenAI 문서는 1,050,000 이라고 적는다. "1M" 으로 접으면 5만 토큰이 사라진다.
    expect(formatContextTokens(1_050_000)).toBe("1.05M");
    // MiniMax Anthropic API 문서는 204,800 이라고 적는다.
    expect(formatContextTokens(204_800)).toBe("204.8K");
  });

  it("딱 떨어지는 값은 군더더기 0 을 붙이지 않는다", () => {
    expect(formatContextTokens(1_000_000)).toBe("1M");
    expect(formatContextTokens(500_000)).toBe("500K");
    expect(formatContextTokens(256_000)).toBe("256K");
    expect(formatContextTokens(200_000)).toBe("200K");
    expect(formatContextTokens(400_000)).toBe("400K");
    expect(formatContextTokens(64_000)).toBe("64K");
  });

  it("1000 미만은 그대로", () => {
    expect(formatContextTokens(999)).toBe("999");
  });
});

describe("benchmarkLabel", () => {
  it("4종을 구분해 적는다(합치면 서로 비교되면 안 되는 값이 섞인다)", () => {
    expect(benchmarkLabel("swe-bench-verified")).toBe("SWE-bench Verified");
    expect(benchmarkLabel("swe-bench-pro")).toBe("SWE-bench Pro");
    expect(benchmarkLabel("swe-bench-multilingual")).toBe(
      "SWE-bench Multilingual",
    );
    expect(benchmarkLabel("swe-bench-multimodal")).toBe("SWE-bench Multimodal");
  });

  it("모르는 id 는 삼키지 않고 그대로 보인다", () => {
    expect(benchmarkLabel("swe-bench-future")).toBe("swe-bench-future");
  });
});

describe("shortHarness", () => {
  it("괄호 안 벤더명만 남긴다", () => {
    expect(shortHarness("vendor-internal (OpenAI)")).toBe("OpenAI");
    expect(
      shortHarness("vendor-internal (Anthropic system-card standard config)"),
    ).toBe("Anthropic system-card standard config");
    expect(shortHarness("vendor scaffold (Z.ai 제출)")).toBe("Z.ai 제출");
  });

  it("리더보드 하네스는 버전까지 그대로 남긴다(버전이 곧 실험 조건)", () => {
    expect(shortHarness("mini-SWE-agent@2.0.0")).toBe("mini-SWE-agent@2.0.0");
  });
});
