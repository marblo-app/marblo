/**
 * 다요소 **모델 칸 자동선택**(난도 티어 상수를 대체한다).
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────────
 * 모델 결정은 두 층인데 **둘째 층이 상수**였다.
 *
 *   1층(프로바이더/하네스) `dispatch-scoring.scoreModelsDetailed`
 *       — 태그·비용효율·budgetBias·graphBias 로 경쟁한다(이미 다요소).
 *   2층(그 하네스 **안의 어느 칸**) `agent-config.modelTierForComplexity`
 *       — simple→sonnet5 / standard→**opus5** / complex→fable5 **고정 리터럴**.
 *
 * 오케 dispatch 의 난도 기본값이 `standard` 라, 1층이 claude 를 고르는 순간 2층은
 * 언제나 opus5 였다. 라이브 관측이 그대로였다("지금 거의 opus5만 스폰됨"). 이 파일이
 * 그 2층을 **근거 기반 선택**으로 바꾼다. 강제 분산이 아니다 — 아래 성분들의
 * 가산합이고, 근거가 없으면(콜드) 종전 티어 진입칸이 그대로 이긴다.
 *
 * ── 성분(전부 기존 단일소스에서 파생, 새 사실 0) ─────────────────────────
 *   · 난도적합  `model-ladder` 의 티어 **진입칸에서 몇 칸 떨어졌나**. 사다리 순서
 *               자체가 "능력등급 오름 + 같은 등급이면 싼 것" 이라는 정책이므로,
 *               거리만으로 난도 축이 표현된다(여기서 새 순서를 만들지 않는다).
 *   · 단가      `model-ladder.costIndexForModel`(레지스트리 실단가 blended).
 *               **배수(log2)** 로 센다 — "절반 값이면 +N점" 이라야 $3 과 $10 의
 *               차이가 티어를 넘나들며 일관된 의미를 갖는다.
 *   · 능력      SWE-bench 대표 점수 — ★`get_model_guidance`(obPe, #650)가 서빙하는
 *               그 페이로드(`model-guidance.modelGuidanceStatic()`)를 그대로 읽고,
 *               티어 라벨도 그쪽 순수 함수(`mcp-server/model-tier`)로 파생한다.
 *               점수가 없는 모델은 **0(중립)** 이고 능력등급 차이로 폴백한다 —
 *               없는 숫자를 지어내지 않는다.
 *               ★티어(premier/standard/value)는 점수에 **더하지 않고** 근거 문자열에만
 *               싣는다. 그 라벨은 이미 벤치+단가에서 파생된 값이라, 점수에 또 넣으면
 *               같은 사실을 두 번 세는 것이다.
 *   · KG효과    `routing-graph.graphBiasForModel` 을 **model@effort 키**로 조회한
 *               ±20 성분(성공/실패 관측의 감쇠 가중합). P2-2 가 이미 그 해상도로
 *               학습·조회하도록 키를 올려놨다 — 여기서는 그 키를 그대로 쓴다.
 *   · 다양성    `MARBLO_ROUTING_DIVERSITY` 계수의 UCB1 형 저표본 보너스.
 *               exploitation 점수 자체에 상시로 들어가므로 85% top-score 경로도
 *               아직 덜 본 `model@effort` 셀을 조금 끌어올린다. 읽는 셀은 실제
 *               스폰할 그 키라 P2-2 해상도와 쓰기 경로가 맞는다.
 *   · 잔여예산  계정 쿼터 잔량이 적을수록 **단가 가중치를 키운다**. budgetBias 는
 *               프로바이더 축(1층)이라 한 하네스 안의 칸들을 가르지 못한다. 잔량이
 *               라우팅을 실제로 바꾸는 자리는 여기다.
 *   · 가용성    후보 자체를 거른다(주입된 `modelAvailable`). 하네스 축의 인증은
 *               1층(`model-availability.ts`)이 거른다.
 *
 * ── ★자기강화 루프와 exploration ────────────────────────────────────────
 * 스폰 결과는 cost_logs·task_outcomes → BQ → 라우팅 그래프로 돌아와 위 KG 성분이
 * 된다. 그래서 **항상 역대 최고만 뽑으면 그 칸의 데이터만 쌓여 비교가 불가능해진다**
 * (다른 칸은 영원히 n=0 → 영원히 콜드 → 영원히 선택되지 않는 자기충족 예언).
 * 두 가지로 비교데이터를 만든다:
 *   1. **tie-band 회전** — 점수차가 `TIE_BAND` 안이면 근거상 동률이므로 회전한다.
 *      1층 스코어러가 이미 쓰는 패턴(`dispatch-scoring.TIED_SCORE_BAND`)과 같다.
 *   2. **ε-greedy** — 확률 ε 로 인접 칸 중 **관측이 가장 적은 칸**을 고른다.
 *      무작위로 아무 칸이나 고르지 않는다. 목적이 "다양성" 이 아니라 "빈 셀 채우기"
 *      이기 때문이다(그래야 다음 판단이 실제로 좋아진다).
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **모델 사실을 새로 적지 않는다.** id·단가·effort·SWE·능력등급은 전부 조회다.
 * 2. **승인게이트 칸(max/ultra)은 후보가 아니다.** `usableRungs()` 를 승인 레코드
 *    없이 부르므로 구조적으로 닿지 않는다 — 자동선택이 고비용 상한을 우회하면
 *    #602 승인 왕복이 무의미해진다.
 * 3. **`agent-config` 를 import 하지 않는다.**(routing-model-key 와 같은 규율)
 *    가용성 판정·핀 해석은 주입/호출자 몫이라 이 모듈은 CLI·키체인·env 없이
 *    결정적으로 유닛테스트된다.
 * 4. **자동선택만 모델을 핀한다.** codex 사다리는 `pinsModel=true` 이므로
 *    자동선택이 고른 gpt-5.6 변종이 `-c model=...` 로 실제 스폰된다. 명시 모델
 *    또는 사용자 직접 launch 는 이 모듈을 타지 않아 사용자 config.toml 을 존중한다.
 */

import {
  EFFORT_LADDER,
  HARNESS_NATIVE_VENDOR,
  getModel,
  type CapabilityTier,
  type EffortLevel,
  type HarnessId,
} from "./model-registry";
import {
  costIndexForModel,
  entryRung,
  ladderFor,
  usableRungs,
  type LadderTier,
} from "./model-ladder";
import { isApprovalGatedEffort } from "./mcp-server/escalation-approval";
import {
  modelGuidanceStatic,
  type ModelGuidanceStaticRow,
} from "./model-guidance";
import { withModelTiers, type ModelTier } from "./mcp-server/model-tier";
import { formatModelKey } from "./routing-model-key";
import {
  graphBiasForModel,
  observationCountForModel,
  type GraphContext,
  type RoutingGraph,
} from "./routing-graph";

// ─────────────────────────────────────────────────────────────────────────
// 가중치 — 왜 이 값인지가 주석에 남는다(튜닝은 이 표 한 곳에서)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 진입칸에서 한 칸 벗어날 때의 감점. **비대칭**이다:
 *   · simple 에서 위로(비싼 쪽)는 크게 벌한다 — 쉬운 티켓의 비용 폭발이 이 티켓이
 *     막으려는 바로 그 증상이다.
 *   · complex 에서 아래로(싼 쪽)는 크게 벌한다 — 어려운 티켓의 실패는 재작업이라
 *     절약분보다 비싸다.
 *   · standard 는 양쪽이 완만하다. 근거(단가·KG)가 조금만 있어도 칸이 움직이는
 *     구간이고, opus5 편중이 실제로 풀리는 자리다.
 */
const FIT_PENALTY: Readonly<Record<LadderTier, { up: number; down: number }>> =
  {
    simple: { up: 14, down: 3 },
    standard: { up: 9, down: 5 },
    // complex 의 up=6 은 TIE_BAND(5)보다 **한 칸 크게** 잡은 값이다. 그래야 진입칸
    // 위의 칸이 동률 회전만으로 뽑히지 않는다 — 상향은 근거(KG·벤치) 없이
    // 일어나면 안 되는 비용 증가다(반대로 하향은 회전으로도 시도할 만하다).
    complex: { up: 6, down: 12 },
  };

/** 단가 **반값당** 점수. 쉬운 일일수록 값이 크다(품질 여유가 크므로). */
const COST_WEIGHT: Readonly<Record<LadderTier, number>> = {
  simple: 12,
  standard: 7,
  complex: 2,
};

/** SWE-bench **10pt 당** 점수. 어려운 일일수록 값이 크다. */
const BENCH_WEIGHT: Readonly<Record<LadderTier, number>> = {
  simple: 1,
  standard: 4,
  complex: 8,
};

/**
 * 벤치 점수가 없을 때의 **콜드 폴백** — 능력등급 한 단계당 점수.
 * BENCH_WEIGHT 보다 훨씬 작다: 등급은 4칸짜리 거친 축이라 같은 무게를 주면
 * 사다리 거리(FIT)와 이중계상된다.
 */
const CAPABILITY_WEIGHT: Readonly<Record<LadderTier, number>> = {
  simple: 0.5,
  standard: 2,
  complex: 3,
};

const CAPABILITY_ORDER: Readonly<Record<CapabilityTier, number>> = {
  cheap: 0,
  mid: 1,
  top: 2,
  frontier: 3,
};

const SUBSCRIPTION_HARNESSES: ReadonlySet<HarnessId> = new Set([
  "claude",
  "gpt",
  "grok",
]);

/**
 * 잔여 쿼터 → 구독형 effective 단가 배수.
 *
 * 경제 논리:
 *   · claude/codex/grok 같은 CLI 계정 구독은 이미 낸 정액권이다. 쿼터가 남아 있으면
 *     지금 한 번 더 쓰는 한계비용은 사실상 0 이므로 list price 로 env-swap 과
 *     비교하면 안 된다.
 *   · env-swap(zai/minimax/moonshot)은 API 키 종량제라 매번 실제 증분지출이 난다.
 *     그래서 단가를 낮춰 보정하지 않는다.
 *   · 구독 쿼터가 마르면 아껴야 할 자원이 되므로 effective 단가를 급격히 올린다.
 *
 * 이 값은 별도 budgetBias 성분이 아니라 `costIndex` 자체에 곱한다. 그래야 단가 성분
 * 안에서 "구독(쿼터有) > env-swap > 구독(소진)" 서열이 결정되고, 단가 외 성분이
 * 같은 사실을 두 번 세지 않는다.
 */
export function subscriptionCostScaleForHeadroom(
  usedPercent?: number | null,
): number {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
    return 0.02;
  }
  const remaining = 100 - Math.min(100, Math.max(0, usedPercent));
  return geoScale(remaining);
}

/**
 * 잔여(%) → 구독 effective 단가 배수. **기하보간(연속·단조)** 이다.
 *
 * ★왜 기하인가: 이 값은 `log2Ratio` 안으로 들어간다. 로그 안에서 기하보간은
 * 점수 축에서 **선형**이 된다 — 즉 잔여가 1%p 줄 때마다 단가 성분이 일정하게
 * 움직인다. 산술보간이면 저잔여 구간에서만 점수가 폭발한다.
 *
 * ★왜 바꿨나(라이브 측정, 2026-08-01): 종전 구간상수는 잔여 25~50% 에서 0.08 로
 * 평평해 **아무 칸도 안 움직였고**, 실제 이동은 잔여 20% 에서 절벽처럼 한 번에
 * 일어났다(opus5 → minimax-m2.7). 사장님 요구는 "25% 부터 체감이 더 크게" 이므로
 * 25% 마디를 종전 <25% 값(0.35)까지 끌어올리고 그 사이를 연속으로 이었다.
 *
 * 마디값(잔여 기준):
 *   · ≥50% → 0.02 **평평** — ★과반응 금지. 종전과 같은 값이라 무회귀다.
 *   ·  25% → 0.35 (종전엔 잔여 10~25% 에서야 닿던 값)
 *   ·  10% → 2.0
 *   ·   0% → 12   (종전 소진값과 동일)
 */
function geoScale(remaining: number): number {
  // [lo,hi] 구간의 기하보간. 로그공간 선형 = 점수공간 선형.
  const geo = (lo: number, hi: number, at: number, to: number): number =>
    at * Math.pow(to / at, (remaining - lo) / (hi - lo));
  if (remaining >= 50) return 0.02;
  if (remaining >= 25) return geo(25, 50, 0.35, 0.02);
  if (remaining >= 10) return geo(10, 25, 2, 0.35);
  return geo(0, 10, 12, 2);
}

/**
 * 잔여 쿼터 → 단가 민감도 배수. 이 값도 cost 항 안에서만 쓰며, 별도 budget 점수로
 * 더하지 않는다. 구독 쿼터가 마를수록 같은 구독형 내부의 고단가 칸도 더 강하게
 * 벌해야 해서 effective 단가 스케일과 함께 cost log-ratio 를 증폭한다.
 *
 * scale 과 마찬가지로 연속·단조다. 마디: 잔여 ≥50% → 1(평평, ★과반응 금지 +
 * 무회귀) / 25% → 1.5 / 10% → 2.2 / 0% → 3.2.
 *
 * ★상한을 2.6 → 3.2 로 올린 이유는 측정이다: complex 티어(COST_WEIGHT=2)에서
 * 종전 상한은 FIT down 감점(12/칸)을 어떤 잔여에서도 못 이겨 claude-fable-5 가
 * 잔여 1% 까지 고정이었다(사다리 전 구간 이동 0건). 다만 이것만으로 complex 가
 * 뒤집히지는 않는다 — complex 의 quota 방어선은 **1층**(하네스를 아예 안 고름)
 * 이고, 그게 맞다(어려운 티켓을 약한 모델로 돌린 실패는 재작업이라 절약분보다
 * 비싸다 — FIT_PENALTY 주석과 같은 논리).
 */
export function costPressureForHeadroom(usedPercent?: number | null): number {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
    return 1;
  }
  const remaining = 100 - Math.min(100, Math.max(0, usedPercent));
  const lerp = (lo: number, hi: number, at: number, to: number): number =>
    at + ((remaining - lo) / (hi - lo)) * (to - at);
  if (remaining >= 50) return 1;
  if (remaining >= 25) return lerp(25, 50, 1.5, 1);
  if (remaining >= 10) return lerp(10, 25, 2.2, 1.5);
  return lerp(0, 10, 3.2, 2.2);
}

export function isSubscriptionMeteredModel(modelId: string): boolean {
  const entry = getModel(modelId);
  if (!entry) return false;
  return (
    SUBSCRIPTION_HARNESSES.has(entry.harness) &&
    entry.provider === HARNESS_NATIVE_VENDOR[entry.harness]
  );
}

export function effectiveCostIndexForModel(
  modelId: string,
  budgetUsedPercent?: number | null,
): number | undefined {
  const entry = getModel(modelId);
  if (!entry) return undefined;
  const base = costIndexForModel(entry.id);
  if (typeof base !== "number") return undefined;
  return isSubscriptionMeteredModel(entry.id)
    ? base * subscriptionCostScaleForHeadroom(budgetUsedPercent)
    : base;
}

/** 동률로 볼 점수차. 1층 스코어러의 TIED_SCORE_BAND(5)와 같은 감각. */
export const TIE_BAND = 5;

/** ε 기본값 — 스폰 6~7건 중 1건꼴로 비교데이터를 만든다. */
export const DEFAULT_EPSILON = 0.15;

/**
 * UCB1 형 저표본 보너스 기본 계수. n=0, total≈10 에서 약 +6점이라 콜드 셀이
 * 동률 밴드 바깥으로 밀려난 경우도 한 번 끌어올릴 수 있고, n≈8~10 이후에는
 * +2점대로 내려가 KG·단가·성능 성분에 자리를 내준다.
 */
export const DEFAULT_DIVERSITY_C = 4;

/** exploration 이 넘볼 수 있는 최대 칸 거리(진입칸 기준). */
const EXPLORE_WINDOW = 1;

/**
 * `MARBLO_ROUTING_EXPLORE` 로 ε 를 조정한다(`0` = 끄기, 범위 밖·비수 = 기본값).
 *
 * ★미설정(빈 문자열)은 **기본값**이지 0 이 아니다. `Number("")` 이 0 이라 이 구분을
 * 안 하면 env 를 안 넣은 모든 기기에서 탐색이 조용히 꺼진다 — 자기강화 루프가
 * 아무 데서도 안 도는, 눈에 안 보이는 실패다.
 */
export function resolveEpsilon(raw?: string): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_EPSILON;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_EPSILON;
  return value;
}

/**
 * `MARBLO_ROUTING_DIVERSITY` 로 UCB1 저표본 보너스 계수를 조정한다(`0` = 끄기).
 * 음수·비수는 기본값으로 되돌린다.
 */
export function resolveDiversityC(raw?: string): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_DIVERSITY_C;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_DIVERSITY_C;
  return value;
}

export function diversityBonus(
  nCell: number,
  totalObs: number,
  coefficient: number,
): number {
  if (!(coefficient > 0)) return 0;
  const n = Number.isFinite(nCell) ? Math.max(0, nCell) : 0;
  const total = Number.isFinite(totalObs) ? Math.max(0, totalObs) : 0;
  return coefficient * Math.sqrt(Math.log(total + 1) / (n + 1));
}

// ─────────────────────────────────────────────────────────────────────────
// 정적 가이던스(단가 · SWE · 능력등급 · 티어) — ★obPe `get_model_guidance` 소비
//
// `get_model_guidance`(#650)는 MCP 툴이라 **다른 프로세스**에 있다. 그 툴이 서빙하는
// 정적 절반의 원산지는 `electron/model-guidance.modelGuidanceStatic()` 이고, 티어
// 파생은 `mcp-server/model-tier` 의 순수 함수다 — 우리는 그 **같은 두 소스**를
// in-process 로 부른다(툴을 부르려고 자기 MCP 서버에 붙는 것은 배선만 늘고 사실은
// 하나도 안 늘어난다). 대표 벤치 선정·티어 heuristic 을 여기서 다시 구현하지 않는
// 것이 요점이다: 오케가 툴로 보는 숫자와 라우터가 고르는 숫자가 같아야 한다.
// ─────────────────────────────────────────────────────────────────────────

export interface ModelGuidance {
  modelId: string;
  capability: CapabilityTier;
  /** blended $/1M(레지스트리). 미등록 모델은 undefined. */
  costIndex?: number;
  /** 대표 SWE-bench 점수. **없으면 undefined**(0 으로 만들지 않는다). */
  benchScore?: number;
  /** 그 점수가 어느 벤치였나(로그·감사용). */
  benchmark?: string;
  /** 화면·오케와 **같은** 티어 라벨(premier/standard/value). */
  tier: ModelTier;
}

let _guidanceCache: Map<string, ModelGuidance> | null = null;

/**
 * 모델 하나의 정적 가이던스(캐시). 페이로드는 프로세스 수명 동안 불변이다 —
 * 재료가 전부 컴파일된 참조표라 런타임에 바뀌지 않는다.
 */
export function modelGuidance(modelId: string): ModelGuidance | undefined {
  if (!_guidanceCache) {
    _guidanceCache = new Map();
    const rows = modelGuidanceStatic().models;
    // 티어는 **전체 행**으로 계산해야 한다(중앙값 기준). 부분집합으로 부르면
    // 필터를 걸 때마다 같은 모델의 티어가 달라진다 — model-tier.modelTierOf 주석.
    const tiers = withModelTiers(
      rows.map((row) => ({
        capability: row.capability as CapabilityTier,
        outputPer1M: row.outputPer1M,
        bench: representativeBench(row),
      })),
    );
    rows.forEach((row, i) => {
      const rep = representativeBench(row);
      _guidanceCache!.set(row.modelId, {
        modelId: row.modelId,
        capability: row.capability as CapabilityTier,
        ...(typeof costIndexForModel(row.modelId) === "number"
          ? { costIndex: costIndexForModel(row.modelId) }
          : {}),
        ...(rep && typeof rep.score === "number"
          ? { benchScore: rep.score, benchmark: rep.benchmark }
          : {}),
        tier: tiers[i].tier,
      });
    });
  }
  return _guidanceCache.get(modelId);
}

/**
 * 페이로드가 지목한 **대표 벤치** 행. 색인이 없으면(참조표에 행이 없거나 대표를
 * 못 고름) null — 여기서 다른 행을 고르지 않는다. 그 선정 정책은 화면·오케와
 * 공유해야 하는 것이라 페이로드가 이미 정해서 내려준 값이다.
 */
function representativeBench(
  row: ModelGuidanceStaticRow,
): { benchmark: string; score: number | null } | null {
  if (row.representativeIndex === null) return null;
  const rec = row.benchRecords[row.representativeIndex];
  return rec ? { benchmark: rec.benchmark, score: rec.score } : null;
}

/** 테스트/리로드용 — 가이던스 캐시를 비운다. */
export function clearGuidanceCache(): void {
  _guidanceCache = null;
}

// ─────────────────────────────────────────────────────────────────────────
// 후보 만들기
// ─────────────────────────────────────────────────────────────────────────

/** 자동선택이 고를 수 있는 한 칸. */
export interface AutoCandidate {
  model: string;
  effort?: EffortLevel;
  /** 후보 배열에서의 위치(낮음 → 높음). 난도적합 계산의 축. */
  index: number;
  /** 그래프 조회/기록 키(`claude-opus-5`, `gpt-5.5@medium`). */
  modelKey: string;
}

/**
 * 이 하네스에서 자동선택이 고를 수 있는 칸들 + 티어 진입칸의 위치.
 *
 * ★두 모양이 있다:
 *   · `pinsModel=true`(claude/gpt/grok) — 사다리 칸 그대로(모델 축이 실제로 핀된다).
 *   · `pinsModel=false` — **상속 모델의 effort 칸들**. 모델은 사용자 config 가
 *     정하므로 우리가 고를 수 있는 것은 effort 뿐이고, 그래서 단가·벤치가 후보
 *     전체에서 동일하다(그 사실이 점수에 정직하게 반영된다).
 */
export function autoCandidates(
  harness: string,
  tier: LadderTier,
): { candidates: AutoCandidate[]; entryIndex: number; pinsModel: boolean } {
  const ladder = ladderFor(harness as never);
  if (!ladder) return { candidates: [], entryIndex: 0, pinsModel: false };

  const entry = entryRung(harness as never, tier);

  if (ladder.pinsModel) {
    // 승인 레코드를 넘기지 않는다 = 게이트 칸(max/ultra)은 애초에 후보가 아니다.
    const rungs = usableRungs(harness as never);
    const candidates = rungs.map((r, index) => ({
      model: r.model,
      ...(r.effort ? { effort: r.effort } : {}),
      index,
      modelKey: formatModelKey(r.model, r.effort),
    }));
    const entryIndex = entry
      ? Math.max(
          0,
          candidates.findIndex(
            (c) => c.model === entry.model && c.effort === entry.effort,
          ),
        )
      : 0;
    return { candidates, entryIndex, pinsModel: true };
  }

  const inherited = ladder.inheritedModel;
  const inheritedEntry = inherited ? getModel(inherited) : undefined;
  if (!inherited || !inheritedEntry) {
    return { candidates: [], entryIndex: 0, pinsModel: false };
  }
  const efforts = EFFORT_LADDER.filter(
    (e) => inheritedEntry.efforts.includes(e) && !isApprovalGatedEffort(e),
  );
  const candidates = efforts.map((effort, index) => ({
    model: inherited,
    effort,
    index,
    modelKey: formatModelKey(inherited, effort),
  }));
  const entryIndex = Math.max(
    0,
    entry?.effort ? efforts.indexOf(entry.effort) : 0,
  );
  return { candidates, entryIndex, pinsModel: false };
}

// ─────────────────────────────────────────────────────────────────────────
// 스코어링
// ─────────────────────────────────────────────────────────────────────────

export interface AutoScoreBreakdown {
  candidate: AutoCandidate;
  /** 난도적합(진입칸 거리 감점, ≤0). */
  fit: number;
  /** 단가(진입칸 대비 배수, 잔여예산 압력 반영). */
  cost: number;
  /** SWE-bench 차이. 벤치가 없으면 0 이고 `capability` 가 대신 움직인다. */
  bench: number;
  /** 벤치 결측 시의 콜드 폴백(능력등급 차이). */
  capability: number;
  /** 라우팅 그래프 관측(±20). 콜드면 0. */
  kg: number;
  /** UCB1 형 저표본 다양성 보너스(≥0). */
  diversity: number;
  /** 현 ctx 후보 관측 합(UCB1 totalObs). */
  totalObservations: number;
  /** 이 칸의 그래프 관측 수(exploration 이 "빈 셀" 을 찾는 근거). */
  observations: number;
  total: number;
}

export type AutoSelectMode =
  | "single" // 후보가 하나뿐(선택의 여지 없음)
  | "top-score" // 근거상 단독 우위
  | "tie-rotate" // 동률 밴드 회전(비교데이터 생성)
  | "explore"; // ε-greedy 탐색(관측이 가장 적은 인접 칸)

export interface AutoModelPlan {
  harness: string;
  model: string;
  effort?: EffortLevel;
  /** `model@effort` 표기(그래프 키 · 로그). */
  modelKey: string;
  /** 이 하네스가 모델 축을 실제로 핀하는가(gpt 포함 pinsModel=true 는 `-c model`까지 넘긴다). */
  pinsModel: boolean;
  mode: AutoSelectMode;
  /** 티어 진입칸(= 종전 고정 동작). 선택이 이것과 다르면 그게 이 티켓의 효과다. */
  entryModelKey: string;
  /** 선택이 진입칸과 다른가. */
  movedFromEntry: boolean;
  /** 그래프에 이 맥락의 관측이 하나도 없나(콜드 = 정적신호로만 판단했다). */
  coldStart: boolean;
  /** 무엇이 결정했나 — 난이도/단가/능력/효과/다양성/탐색/동률. */
  decidedBy:
    | "fit"
    | "cost"
    | "bench"
    | "capability"
    | "kg"
    | "diversity"
    | AutoSelectMode;
  scores: AutoScoreBreakdown[];
  /** dispatchReason 에 그대로 붙는 한 줄. */
  reason: string;
}

export interface AutoSelectInput {
  harness: string;
  tier: LadderTier;
  ctx: GraphContext;
  graph?: RoutingGraph | null;
  /** 이 하네스 계정의 쿼터 사용률(0-100). 없으면 중립. */
  budgetUsedPercent?: number | null;
  /** 구체 모델 id 가 지금 이 기기에서 스폰 가능한가(벤더 크레덴셜 등). */
  modelAvailable?: (modelId: string) => boolean;
  /** ε. 미지정이면 env(`MARBLO_ROUTING_EXPLORE`) → DEFAULT_EPSILON. */
  epsilon?: number;
  /** UCB1 저표본 보너스 계수. 미지정이면 env(`MARBLO_ROUTING_DIVERSITY`) → 기본값. */
  diversityCoefficient?: number;
  /** 결정적 테스트용 난수(0 이상 1 미만). 미지정이면 Math.random. */
  random?: () => number;
  /** 이 dispatch 가 이미 탐색으로 결정됐는가(하네스별 롤을 나누지 않기 위한 주입). */
  forceExplore?: boolean;
}

/**
 * 동률 회전 카운터 — 1층 스코어러의 `modelRoundRobin` 과 같은 역할이되 **하네스별**
 * 이다. 한 dispatch 는 후보 하네스마다 이 함수를 한 번씩 부르므로(claude·gpt…),
 * 전역 카운터 하나를 공유하면 호출 수가 밴드 크기의 배수가 되어 회전이 제자리를
 * 돈다 — claude 밴드 2칸 × dispatch 당 2호출 = 매번 같은 칸(회전이 죽는다).
 */
const rotations = new Map<string, number>();

function nextRotation(harness: string): number {
  const current = rotations.get(harness) ?? 0;
  rotations.set(harness, current + 1);
  return current;
}

/** 테스트용 — 회전 카운터를 0 으로. */
export function resetAutoSelectRotation(): void {
  rotations.clear();
}

function log2Ratio(from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return 0;
  return Math.log2(from / to);
}

/**
 * 이 하네스에서 **어느 칸으로 띄울지** 를 다요소로 고른다.
 *
 * 사다리가 없는 하네스(gemini/antigravity/local/custom)는 `null` — 그 벤더의 모델
 * 사실이 아직 레지스트리에 없어서 고를 근거가 없다. 그때는 호출자가 종전 경로
 * (핀 없음 = CLI 기본값)를 그대로 탄다(무회귀).
 */
export function selectAutoModel(input: AutoSelectInput): AutoModelPlan | null {
  const {
    harness,
    tier,
    ctx,
    graph,
    budgetUsedPercent,
    modelAvailable,
    random = Math.random,
  } = input;

  const { candidates, entryIndex, pinsModel } = autoCandidates(harness, tier);
  const usable = candidates.filter(
    (c) => !modelAvailable || modelAvailable(c.model),
  );
  if (usable.length === 0) return null;

  const entryCandidate = candidates[entryIndex] ?? candidates[0];
  const entryGuidance = entryCandidate
    ? modelGuidance(entryCandidate.model)
    : undefined;
  const entryBench = entryGuidance?.benchScore;
  const entryCapability = entryGuidance
    ? CAPABILITY_ORDER[entryGuidance.capability]
    : undefined;

  const fitWeights = FIT_PENALTY[tier];
  const costWeight =
    COST_WEIGHT[tier] * costPressureForHeadroom(budgetUsedPercent);
  const benchWeight = BENCH_WEIGHT[tier];
  const capWeight = CAPABILITY_WEIGHT[tier];
  const diversityCoefficient =
    input.diversityCoefficient ??
    resolveDiversityC(process.env.MARBLO_ROUTING_DIVERSITY);

  const observed = new Map<string, number>();
  for (const candidate of usable) {
    observed.set(
      candidate.modelKey,
      graph ? observationCountForModel(candidate.modelKey, ctx, graph) : 0,
    );
  }
  const totalObservations = [...observed.values()].reduce(
    (sum, n) => sum + n,
    0,
  );

  const scores: AutoScoreBreakdown[] = usable.map((candidate) => {
    const steps = candidate.index - entryIndex;
    const fit =
      steps === 0
        ? 0
        : steps > 0
          ? -fitWeights.up * steps
          : fitWeights.down * steps; // steps<0 → 음수 유지

    const guidance = modelGuidance(candidate.model);
    const effectiveEntryCost = entryCandidate
      ? effectiveCostIndexForModel(entryCandidate.model, budgetUsedPercent)
      : undefined;
    const effectiveCandidateCost = effectiveCostIndexForModel(
      candidate.model,
      budgetUsedPercent,
    );
    const cost =
      typeof effectiveEntryCost === "number" &&
      typeof effectiveCandidateCost === "number"
        ? costWeight * log2Ratio(effectiveEntryCost, effectiveCandidateCost)
        : 0;
    // ★**같은 벤치끼리만** 뺀다. SWE-bench 는 문제집합이 다른 4종이고, 벤더마다
    // 보고하는 변형이 다르다(예: OpenAI 는 Verified 를 아예 안 낸다 — Pro 만).
    // Verified 96 에서 Pro 64.6 을 빼면 그건 능력차가 아니라 **다른 시험**의 차다.
    // 사다리 안의 비교는 대개 같은 벤더라 같은 벤치지만, 그 우연에 기대지 않는다.
    const comparableBench =
      typeof entryBench === "number" &&
      typeof guidance?.benchScore === "number" &&
      !!entryGuidance?.benchmark &&
      guidance.benchmark === entryGuidance.benchmark;
    const bench = comparableBench
      ? (benchWeight * (guidance!.benchScore! - entryBench!)) / 10
      : 0;
    // 비교 가능한 벤치가 없을 때만 능력등급으로 폴백한다(이중계상 방지).
    const capability =
      !comparableBench && typeof entryCapability === "number" && guidance
        ? capWeight * (CAPABILITY_ORDER[guidance.capability] - entryCapability)
        : 0;
    const kg = graph
      ? graphBiasForModel([candidate.modelKey, harness], ctx, graph)
      : 0;
    const observations = observed.get(candidate.modelKey) ?? 0;
    const diversity = diversityBonus(
      observations,
      totalObservations,
      diversityCoefficient,
    );

    const total = fit + cost + bench + capability + kg + diversity;
    return {
      candidate,
      fit: round1(fit),
      cost: round1(cost),
      bench: round1(bench),
      capability: round1(capability),
      kg: round1(kg),
      diversity: round1(diversity),
      totalObservations,
      observations,
      total: round1(Number.isFinite(total) ? total : 0),
    };
  });

  scores.sort((a, b) => b.total - a.total);
  const coldStart = scores.every((s) => s.observations === 0);

  let mode: AutoSelectMode;
  let winner = scores[0];

  // ★쿼터가 마르면 **탐색도 회전도 사지 않는다**(pressure > 1 = 잔량 50% 미만).
  // 탐색은 "미래의 판단을 좋게 하려고 지금 조금 더 쓰는 것" 인데, 잔량이 부족한
  // 순간엔 그 지출이 다음 티켓의 스폰 자체를 못 하게 만들 수 있다. 그때는 근거상
  // 최선(=대개 더 싼 칸)만 그대로 쓴다.
  const conserving = costPressureForHeadroom(budgetUsedPercent) > 1;

  const entryScore = scores.find(
    (s) => s.candidate.modelKey === entryCandidate?.modelKey,
  );

  const gptShouldHoldEntry =
    harness === "gpt" &&
    entryScore &&
    !input.forceExplore &&
    scores.every((s) => s.kg === 0) &&
    (coldStart || diversityCoefficient === 0);

  if (gptShouldHoldEntry) {
    // gpt-5.6 변종 편입 직후에는 변종별 KG가 없다. 이때 비용 동률 회전이
    // standard→terra, complex→sol 진입 정책을 흔들면 사다리 자체가 말한
    // 난도별 기본 변종이 사라진다. KG·diversity·명시 탐색 근거가 있으면
    // 아래 경로로 간다.
    winner = entryScore;
    mode = "top-score";
  } else if (scores.length === 1 || conserving) {
    mode = scores.length === 1 ? "single" : "top-score";
  } else {
    const epsilon =
      input.epsilon ?? resolveEpsilon(process.env.MARBLO_ROUTING_EXPLORE);
    const exploring = input.forceExplore ?? (epsilon > 0 && random() < epsilon);
    const explorePick = exploring
      ? pickExploration(scores, winner.candidate, entryIndex, harness)
      : undefined;
    if (explorePick) {
      winner = explorePick;
      mode = "explore";
    } else {
      const band = scores.filter((s) => winner.total - s.total <= TIE_BAND);
      if (band.length > 1) {
        winner = band[nextRotation(harness) % band.length];
        mode = "tie-rotate";
      } else {
        mode = "top-score";
      }
    }
  }

  const decidedBy = decideFactor(winner, mode);
  const entryModelKey = entryCandidate?.modelKey ?? winner.candidate.modelKey;
  const plan: AutoModelPlan = {
    harness,
    model: winner.candidate.model,
    ...(winner.candidate.effort ? { effort: winner.candidate.effort } : {}),
    modelKey: winner.candidate.modelKey,
    pinsModel,
    mode,
    entryModelKey,
    movedFromEntry: winner.candidate.modelKey !== entryModelKey,
    coldStart,
    decidedBy,
    scores,
    reason: "",
  };
  plan.reason = formatAutoReason(plan, winner, tier, budgetUsedPercent);
  return plan;
}

/**
 * ε-greedy 후보: **진입칸 근처(±EXPLORE_WINDOW)** 이면서 exploit 승자가 아닌 칸 중
 * **관측이 가장 적은** 칸. 관측이 같으면 회전으로 갈라 결정성을 유지한다.
 *
 * 창을 두는 이유: 탐색이 "아무 칸이나"가 되면 complex 티켓이 simple 칸으로 떨어지는
 * 사고가 15% 확률로 난다. 우리가 사고 싶은 것은 **비교 가능한 이웃 칸의 데이터**다.
 */
function pickExploration(
  scores: AutoScoreBreakdown[],
  winner: AutoCandidate,
  entryIndex: number,
  harness: string,
): AutoScoreBreakdown | undefined {
  const pool = scores.filter(
    (s) =>
      s.candidate.modelKey !== winner.modelKey &&
      Math.abs(s.candidate.index - entryIndex) <= EXPLORE_WINDOW,
  );
  if (pool.length === 0) return undefined;
  const minObs = Math.min(...pool.map((s) => s.observations));
  const leanest = pool.filter((s) => s.observations === minObs);
  return leanest[nextRotation(harness) % leanest.length];
}

/** 이 선택을 실제로 움직인 성분(모드가 우선 — 탐색/동률은 그 자체가 사유다). */
function decideFactor(
  winner: AutoScoreBreakdown,
  mode: AutoSelectMode,
): AutoModelPlan["decidedBy"] {
  if (mode === "explore" || mode === "tie-rotate" || mode === "single") {
    return mode;
  }
  const parts: [AutoModelPlan["decidedBy"], number][] = [
    ["fit", Math.abs(winner.fit)],
    ["cost", Math.abs(winner.cost)],
    ["bench", Math.abs(winner.bench)],
    ["capability", Math.abs(winner.capability)],
    ["kg", Math.abs(winner.kg)],
    ["diversity", Math.abs(winner.diversity)],
  ];
  parts.sort((a, b) => b[1] - a[1]);
  return parts[0][1] > 0 ? parts[0][0] : "top-score";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** dispatchReason 한 줄 — "무엇을 왜 골랐나" 가 감사 가능해야 한다. */
export function formatAutoReason(
  plan: AutoModelPlan,
  winner: AutoScoreBreakdown,
  tier: LadderTier,
  budgetUsedPercent?: number | null,
): string {
  const headroom =
    typeof budgetUsedPercent === "number" && Number.isFinite(budgetUsedPercent)
      ? `${Math.round(100 - Math.min(100, Math.max(0, budgetUsedPercent)))}% left`
      : "no-data";
  // 티어 라벨(premier/standard/value)은 **점수가 아니라 표기**다 — 벤치+단가에서
  // 파생된 값이라 점수에 또 넣으면 이중계상이고, 사람이 읽을 땐 "이건 가성비 칸"
  // 한 마디가 숫자 다섯 개보다 빠르다.
  const tierLabel = modelGuidance(plan.model)?.tier;
  const factors = [
    `fit ${signed(winner.fit)}`,
    `cost ${signed(winner.cost)}`,
    winner.bench !== 0 ? `swe ${signed(winner.bench)}` : "",
    winner.capability !== 0 ? `cap ${signed(winner.capability)}` : "",
    tierLabel ? `tier=${tierLabel}` : "",
    `kg ${signed(winner.kg)}${plan.coldStart ? "(cold)" : `(n=${winner.observations})`}`,
    `diversity ${signed(winner.diversity)} (n=${winner.observations}, tot=${winner.totalObservations})`,
    `budget ${headroom}`,
  ]
    .filter(Boolean)
    .join(", ");
  const moved = plan.movedFromEntry
    ? `entry ${plan.entryModelKey} → ${plan.modelKey}`
    : `entry ${plan.entryModelKey} 유지`;
  return `auto-model[${tier}] ${plan.modelKey} (${moved}; ${factors}; total ${winner.total}; mode=${plan.mode}, by=${plan.decidedBy})`;
}
