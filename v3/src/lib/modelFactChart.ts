/**
 * 모델 정보표 **막대차트**의 계산 — 순수 함수만(렌더 없음).
 *
 * `modelFactFormat.ts` 와 같은 이유로 컴포넌트 밖에 있다: 이 레포엔 렌더러 컴포넌트
 * 테스트 하네스가 없어서(jsdom/testing-library 미도입), 차트가 "사실을 왜곡하지
 * 않는다" 는 성질은 렌더 없이 검증할 수 있는 자리에 있어야 회귀 가드가 붙는다.
 *
 * ── ★차트가 지켜야 하는 것(표보다 엄격하다) ─────────────────────────────
 * 표는 숫자를 그대로 적으므로 읽는 사람이 조건을 따져볼 수 있다. 막대는 **길이가
 * 곧 주장**이라 조건을 따질 틈을 주지 않는다. 그래서 셋을 강제한다:
 *
 *   1. **한 축에 한 변형만.** 변형이 다른 점수는 애초에 이 모듈에 들어오지 않는다
 *      (`chartRows` 가 변형을 인자로 받고, 그 변형의 칸만 읽는다). Verified 96 과
 *      Pro 64.6 을 같은 막대 축에 놓는 것은 표에서보다 차트에서 더 나쁘다 —
 *      32pt 길이 차가 눈으로 먼저 들어오기 때문이다.
 *   2. **빈 칸은 길이 0 이 아니다.** 공식 수치가 없는 모델은 막대를 그리지 않고
 *      "확인 필요" 로 남는다. 0 짜리 막대는 "성능이 0" 이라는 거짓말이다.
 *   3. **단가와 점수는 축을 공유하지 않는다.** $/1M 과 %resolved 는 단위가 달라
 *      한 그림에 두 축을 놓으면 없는 상관을 지어낸다. 두 패널로 나누고 모델 행만
 *      맞춘다(small multiples).
 */

/** 차트 한 줄. 표의 행에서 **선택된 변형** 하나만 뽑아 평평하게 편 것. */
export interface ChartRow {
  modelId: string;
  label: string;
  vendor: string;
  vendorLabel: string;
  inputPer1M: number;
  outputPer1M: number;
  estimatedPricing: boolean;
  /** 선택 변형 기준 점수. ★null 은 "0점" 이 아니라 "공식 수치 없음". */
  score: number | null;
  /** 점수를 낸 스캐폴드(`name@version`) — 있으면 툴팁이 조건을 같이 말한다. */
  harness: string | null;
  /** 점수가 없으면 왜 없는지(툴팁). */
  note: string | null;
}

/**
 * 표 행 → 차트 행. `benchmark` 로 **변형을 고정**하고 그 칸만 읽는다.
 *
 * 정렬: 점수 내림차순, 점수 없는 모델은 뒤로(입력 순서 유지). 이 정렬은 **선택된
 * 한 변형 안에서의 순위**라 정당하다 — 이 티켓이 금지하는 것은 변형이 다른 점수를
 * 나란히 세우는 것이지, 같은 자로 잰 값을 정렬하는 것이 아니다. 오히려 "한눈 비교"
 * 라는 이 차트의 목적이 정렬을 요구한다.
 */
export function chartRows(
  rows: readonly ModelFactRow[],
  benchmark: BenchmarkVariantId,
): ChartRow[] {
  const mapped = rows.map((row, i) => {
    const cell = row.benchByVariant?.[benchmark];
    const primary = cell?.primary ?? null;
    return {
      i,
      row: {
        modelId: row.modelId,
        label: row.label,
        vendor: row.vendor,
        vendorLabel: row.vendorLabel,
        inputPer1M: row.inputPer1M,
        outputPer1M: row.outputPer1M,
        estimatedPricing: row.estimatedPricing,
        score: primary?.score ?? null,
        harness: primary?.harness ?? null,
        note: primary?.note ?? null,
      } satisfies ChartRow,
    };
  });

  return mapped
    .sort((a, b) => {
      const sa = a.row.score;
      const sb = b.row.score;
      // 점수 없는 행은 항상 뒤. 둘 다 없으면 원래 순서(벤더 묶음)를 유지한다.
      if (sa === null && sb === null) return a.i - b.i;
      if (sa === null) return 1;
      if (sb === null) return -1;
      if (sb !== sa) return sb - sa;
      return a.i - b.i;
    })
    .map((m) => m.row);
}

/**
 * 단가 축의 상한. **눈금이 읽히는 수**로 올림한다(1·2·2.5·5·10 × 10ⁿ).
 *
 * 왜 실제 최댓값을 그대로 안 쓰나: 축 상한이 $37.50 이면 눈금이 $9.375 같은
 * 수가 되어 사람이 막대 길이를 수로 환산하지 못한다. 상한을 $40 으로 올리면
 * 눈금이 $10 단위가 되고, 가장 비싼 막대가 축을 꽉 채우지 않는 대신 **읽힌다**.
 */
export function niceCeil(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const pow = Math.pow(10, exp);
  const frac = max / pow;
  const step =
    frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * 단가 축 상한 — output 과 input **둘 다** 보고 정한다.
 *
 * output 만 보면 안 되는 이유: 두 막대가 같은 축을 쓰는데 상한을 output 으로만
 * 잡으면, input 이 더 비싼 모델(있을 수 있다 — 캐시 쓰기 단가 구조가 다른 벤더)이
 * 축 밖으로 나가 막대가 잘린다.
 */
export function priceAxisMax(rows: readonly ChartRow[]): number {
  const max = rows.reduce(
    (m, r) => Math.max(m, r.inputPer1M, r.outputPer1M),
    0,
  );
  return niceCeil(max);
}

/** 눈금 값들(0 포함, 5칸). 축 라벨과 격자선이 같은 배열을 쓴다. */
export function axisTicks(max: number, divisions = 4): number[] {
  return Array.from({ length: divisions + 1 }, (_, i) => (max / divisions) * i);
}

/**
 * 막대 길이(%). ★음수·NaN·축 초과를 0..100 으로 가둔다 — 레지스트리에 이상한
 * 단가가 들어와도 막대가 옆 칸을 침범해 레이아웃을 부수지는 않게 한다.
 */
export function barPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * SWE-bench 축은 **항상 0..100 고정**이다.
 *
 * 데이터 최댓값에 맞춰 축을 좁히면(예: 최고점 80 → 상한 80) 1위 모델이 축을 꽉
 * 채워 "만점" 처럼 보이고, 모델 간 차이도 실제보다 커 보인다. % resolved 는 0~100
 * 이 자연스러운 정의역이므로 그대로 쓰는 것이 유일하게 정직한 축이다.
 */
export const BENCH_AXIS_MAX = 100;
