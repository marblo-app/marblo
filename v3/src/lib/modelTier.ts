/**
 * 모델 **티어** 파생 — 순수 함수만. (사용량 탭 정보표 + 나중에 에이전트 탭)
 *
 * ── 이 모듈이 답하는 질문 ────────────────────────────────────────────────
 * 정보표(#629)는 모델당 단가·개략 SWE-bench·컨텍스트를 정확히 보여주지만, 19줄을
 * 눈으로 훑어 "그래서 뭘 골라야 하나" 를 스스로 계산해야 한다. 티어는 그 한 단계를
 * 대신 밟아 준다:
 *   · `premier`  프리미어 — 최고 성능이 필요할 때 고르는 칸
 *   · `standard` 일반작업 — 중간
 *   · `value`    가성비   — 저단가인데 성능이 준수한 칸
 *
 * ── ★하드코딩 목록을 만들지 않는다 ──────────────────────────────────────
 * 티어는 모델 id 목록이 아니라 **행의 사실에서 파생**된다. 그래서 레지스트리에
 * 새 모델이 한 줄 늘면 이 모듈이 손대지 않아도 알아서 티어를 받는다. id 를 적는
 * 순간 신규 모델은 전부 잘못된 티어로 떨어지고(=목록에 없으니까), 그 사실을
 * 아무도 눈치채지 못한다.
 *
 * 두 재료만 쓴다:
 *   1. `capability` — 레지스트리가 이미 들고 있는 능력등급(frontier/top/mid/cheap).
 *      이게 기본 티어를 정한다.
 *   2. **가성비 heuristic** — 벤치 점수 대비 output 단가. `mid` 등급 중 "싼데
 *      성능이 준수한" 행만 `value` 로 끌어올린다.
 *
 * ── ★왜 `top`/`frontier` 는 heuristic 으로 내리지 않나 ───────────────────
 * 프리미어 묶음의 약속은 "최고 성능이 필요하면 여기서 고르면 된다" 이다. 값이
 * 싸다는 이유로 grok-4.5 를 가성비로 옮기면 그 약속이 깨진다(싼 프리미어는
 * 그냥 **싼 프리미어**지 다른 급이 아니다). 그래서 heuristic 은 한 방향으로만
 * 움직인다: `mid` → `value`. `cheap` 은 언제나 `value` 다.
 *
 * ── ★벤치 점수를 벤치끼리 비교하지 않는다 ───────────────────────────────
 * SWE-bench 는 문제집합이 다른 4종이고(Verified/Pro/…), Verified 85 와 Pro 62 는
 * 서로 비교 대상이 아니다. 그래서 raw 점수를 쓰지 않고 **같은 벤치 안의 최고점
 * 대비 비율**로 정규화한 뒤 단가로 나눈다. 그래도 "개략" 이다 — 스캐폴드가 다르면
 * 같은 벤치·같은 모델도 6~13pt 움직인다(`electron/model-bench-reference.ts`).
 * 화면은 이 값을 순위표가 아니라 **묶음 라벨**로만 쓴다.
 *
 * ── ★점수가 없으면 올리지 않는다 ────────────────────────────────────────
 * 벤치 참조표에 짝이 없는 행(k3·kimi-for-coding·gpt-5.4 …)은 단가가 아무리 싸도
 * heuristic 승격 대상이 아니다. "싸다" 는 알아도 "성능이 준수하다" 는 모르기
 * 때문이다. 없는 근거로 가성비 딱지를 붙이는 건 표 전체의 규율(없는 숫자를
 * 지어내지 않는다)을 어기는 것과 같다 — 그런 행은 `capability` 가 정한 자리에
 * 그대로 둔다.
 */

export type ModelTier = "premier" | "standard" | "value";

/** 화면 정렬 순서(위 → 아래). */
export const MODEL_TIER_ORDER: readonly ModelTier[] = [
  "premier",
  "standard",
  "value",
] as const;

export type ModelCapability = "cheap" | "mid" | "top" | "frontier";

/**
 * 티어를 파생하는 데 필요한 최소 재료. `ModelFactRow` 가 이걸 만족하지만,
 * 에이전트 탭처럼 다른 모양의 행을 쓰는 화면도 이 구조만 맞추면 그대로 쓴다.
 */
export interface ModelTierFacts {
  capability: ModelCapability;
  /** $/1M. ★input 이 아니라 output 을 쓴다 — 코딩 에이전트 비용은 출력이 지배한다. */
  outputPer1M: number;
  /** 대표 벤치 한 칸. `score: null` 은 "0점" 이 아니라 "공식 수치 없음". */
  bench: { benchmark: string; score: number | null } | null;
}

/** 왜 이 티어인가. 화면이 툴팁으로 근거를 말할 수 있게 같이 내린다. */
export type ModelTierReason =
  /** 레지스트리 능력등급이 그대로 티어가 됐다. */
  | "capability"
  /** `mid` 인데 단가·성능비가 좋아 가성비로 올라왔다. */
  | "value-heuristic";

export interface ModelTierVerdict {
  tier: ModelTier;
  reason: ModelTierReason;
  /**
   * 정규화 점수(같은 벤치 최고점 대비) ÷ output 단가. 클수록 "돈 대비 성능".
   * 벤치 점수가 없으면 `null` — 화면은 이 값을 숫자로 자랑하지 않고, 있으면
   * 툴팁 근거로만 쓴다(벤치 조건이 모델마다 달라 정밀도가 없다).
   */
  valueRatio: number | null;
}

export interface ModelTierAssignment<T> extends ModelTierVerdict {
  row: T;
}

export interface ModelTierGroup<T> {
  tier: ModelTier;
  rows: ModelTierAssignment<T>[];
}

/**
 * 묶음 전체를 봐야 정해지는 기준값들. ★고정 임계값(예: "$5 이하면 싸다")을 박지
 * 않는 이유: 단가는 해마다 한 자릿수씩 내려가는데 상수는 안 따라간다. 대신
 * **지금 우리 레지스트리 안에서의 중앙값**을 기준으로 삼으면, 모델이 싸지면
 * 기준도 같이 내려간다.
 */
export interface ModelFleetStats {
  /** output 단가 중앙값. 이보다 비싸면 "저단가" 가 아니다. */
  medianOutputPer1M: number;
  /** 벤치별 최고점(정규화 분모). */
  benchBest: Readonly<Record<string, number>>;
  /** 점수를 가진 행들의 valueRatio 중앙값. 표본이 없으면 null. */
  medianValueRatio: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 같은 벤치 최고점 대비 비율 ÷ output 단가. 재료가 없으면 null. */
function rawValueRatio(
  row: ModelTierFacts,
  benchBest: Readonly<Record<string, number>>,
): number | null {
  const bench = row.bench;
  if (!bench || bench.score === null) return null;
  if (!(row.outputPer1M > 0)) return null; // 0/음수 단가 = 단가 미상. 나누지 않는다.
  const best = benchBest[bench.benchmark];
  if (!best || best <= 0) return null;
  return bench.score / best / row.outputPer1M;
}

/** 묶음 기준값 계산. 같은 배열로 두 번 부르면 같은 값이 나온다(순수). */
export function modelFleetStats(
  rows: readonly ModelTierFacts[],
): ModelFleetStats {
  const benchBest: Record<string, number> = {};
  for (const row of rows) {
    const bench = row.bench;
    if (!bench || bench.score === null) continue;
    const prev = benchBest[bench.benchmark];
    if (prev === undefined || bench.score > prev) {
      benchBest[bench.benchmark] = bench.score;
    }
  }

  const prices = rows.map((r) => r.outputPer1M).filter((p) => p > 0);
  const ratios = rows
    .map((r) => rawValueRatio(r, benchBest))
    .filter((r): r is number => r !== null);

  return {
    medianOutputPer1M: median(prices) ?? 0,
    benchBest,
    medianValueRatio: median(ratios),
  };
}

const BASE_TIER: Readonly<Record<ModelCapability, ModelTier>> = {
  // frontier 는 top 보다 위지만 화면 묶음은 셋뿐이다 — "최고 성능이 필요할 때"
  // 라는 질문에는 둘 다 같은 답이다. 등급 자체는 행에 그대로 남아 있다.
  frontier: "premier",
  top: "premier",
  mid: "standard",
  cheap: "value",
};

/**
 * 한 행의 티어. `stats` 는 `modelFleetStats(전체 행)` 결과여야 한다 — 중앙값
 * 기준이라 부분집합으로 계산하면 필터를 걸 때마다 티어가 바뀐다.
 */
export function modelTierOf(
  row: ModelTierFacts,
  stats: ModelFleetStats,
): ModelTierVerdict {
  const valueRatio = rawValueRatio(row, stats.benchBest);
  const base = BASE_TIER[row.capability] ?? "standard";
  if (base !== "standard")
    return { tier: base, reason: "capability", valueRatio };

  // 승격 조건 둘 다 만족해야 한다: **싸고**(중앙값 이하) **효율이 좋다**
  // (성능/단가가 중앙값 이상). 하나만 맞는 건 그냥 싼 모델이거나 그냥 좋은 모델이다.
  const cheapEnough =
    row.outputPer1M > 0 && row.outputPer1M <= stats.medianOutputPer1M;
  const efficientEnough =
    valueRatio !== null &&
    stats.medianValueRatio !== null &&
    valueRatio >= stats.medianValueRatio;

  return cheapEnough && efficientEnough
    ? { tier: "value", reason: "value-heuristic", valueRatio }
    : { tier: base, reason: "capability", valueRatio };
}

/** 행 순서를 유지한 채 티어 판정을 붙인다. */
export function withModelTiers<T extends ModelTierFacts>(
  rows: readonly T[],
): ModelTierAssignment<T>[] {
  const stats = modelFleetStats(rows);
  return rows.map((row) => ({ row, ...modelTierOf(row, stats) }));
}

/**
 * 티어 묶음. **빈 묶음은 내리지 않는다** — 헤더만 있고 줄이 없는 그룹은 화면에서
 * "이 티어에 모델이 없다" 가 아니라 "고장" 처럼 읽힌다. 묶음 안의 행 순서는 입력
 * 순서 그대로다(정보표는 이미 벤더 묶음 → 능력등급 순으로 정렬해 내려온다).
 */
export function groupModelsByTier<T extends ModelTierFacts>(
  rows: readonly T[],
): ModelTierGroup<T>[] {
  const assignments = withModelTiers(rows);
  return MODEL_TIER_ORDER.map((tier) => ({
    tier,
    rows: assignments.filter((a) => a.tier === tier),
  })).filter((group) => group.rows.length > 0);
}
