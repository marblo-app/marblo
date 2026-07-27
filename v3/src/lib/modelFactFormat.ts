/**
 * 모델 정보표(사용량 탭 상단)의 숫자 표기 — 순수 함수만.
 *
 * 컴포넌트가 아니라 여기 있는 이유: 이 레포엔 렌더러 컴포넌트 테스트 하네스가
 * 없다(jsdom/testing-library 미도입). 표기 규칙은 **사실을 지우지 않는 것**이
 * 목적이라 회귀 가드가 꼭 필요하므로, 렌더 없이 검증할 수 있게 분리한다.
 */

/** 벤치 id → 화면 표기. 고유명사라 번역하지 않는다(출처 화면 표기와 대조 가능해야 한다). */
export const BENCHMARK_SHORT: Readonly<Record<string, string>> = {
  "swe-bench-verified": "SWE-bench Verified",
  "swe-bench-pro": "SWE-bench Pro",
  "swe-bench-multilingual": "SWE-bench Multilingual",
  "swe-bench-multimodal": "SWE-bench Multimodal",
};

/** 모르는 벤치 id 는 접지 않고 그대로 보인다(조용히 사라지는 것보다 낫다). */
export function benchmarkLabel(id: string): string {
  return BENCHMARK_SHORT[id] ?? id;
}

/** $/1M 표기. 소수 둘째자리 — $0.75 / $2.50 처럼 벤더 가격표와 같은 모양. */
export function formatRate(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * 컨텍스트 토큰 표기.
 *
 * ★반올림으로 사실을 지우지 않는다: OpenAI 의 1,050,000 은 "1M" 이 아니라
 * `1.05M`, MiniMax 의 204,800 은 "200K" 가 아니라 `204.8K` 로 적는다. 두 값을
 * 1M/200K 로 접으면 화면이 벤더 문서와 다른 숫자를 말하게 된다.
 */
export function formatContextTokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}K`;
  return `${n}`;
}

/**
 * 하네스 문자열을 칸에 들어갈 길이로 줄인다. 원문은 호출자가 `title` 로 남긴다 —
 * 줄인 이름만 남으면 "어느 스캐폴드였나" 가 사라지고, 그게 이 표의 핵심 단서다.
 */
export function shortHarness(harness: string): string {
  return harness
    .replace(/^vendor-internal \(([^)]+)\)$/, "$1")
    .replace(/^vendor scaffold \(([^)]+)\)$/, "$1");
}
