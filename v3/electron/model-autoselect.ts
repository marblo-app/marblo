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
 *   · 워크로드  **티켓 내용**(tags · taskType)이 말하는 무게. 난도적합과 같은
 *               축(진입칸 거리) 위에 얹혀 그 감점을 깎거나 키운다. 어휘는
 *               `workload-tags.ts` 한 벌이라 1층 비용효율과 같은 목록을 읽는다.
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
 *               스폰할 그 키라 P2-2 해상도와 쓰기 경로가 맞는다. 관측 수는
 *               **dispatch 환산**으로 세고(맥락 축 개수로 나눈다), 보너스는
 *               ε-greedy 와 같은 근접창 규율로 감쇠한다 — 아래 §UCB1 회계.
 *   · 실사용량  cost_logs 거울(`usage-rollup`) / getCostSummary.weeklyByModel.
 *               같은 창에서 토큰 비중이 큰 모델은 하향(로드밸런싱). 콜드=0.
 *   · 주간한도  `HARNESS_WEEKLY_TOKEN_SOFT_LIMIT` 근접 시 구독 계열 칸을 강하게
 *               de-prioritize. bridge 는 같은 신호를 budget used% 와 max 합성해
 *               1층도 fleet(grok/minimax) 로 넘긴다.
 *   · stale KG  graph.updatedAt 이 7~27일 지나면 kg 항을 감쇠 — 7/27 정지 그래프의
 *               claude 편중이 영구 고정되는 것을 막는다.
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
 * ── ★UCB1 회계 — "관측 1건" 이 무엇인가 ─────────────────────────────────
 * 그래프는 dispatch 결과 **1건**을 맥락 축(role · taskType · complexity · tag…)
 * **마다** 한 셀씩 기록한다. `observationCountForModel` 은 그 셀들의 n 을 더해
 * 돌려주므로, 태그 2개짜리 티켓의 결과 1건은 n=5 로 세어진다. 그러면
 *   (a) 저표본 보너스의 감쇠 속도가 **티켓이 태그를 몇 개 달았느냐에 따라** 달라지고
 *   (b) `DEFAULT_DIVERSITY_C` 주석이 말하는 보정("n=0, total≈10 에서 약 +6점")이
 *       실제로는 dispatch 2~3건 만에 지나가 버린다 — 상수의 근거와 코드가 갈린다.
 * 그래서 여기서 관측 수를 **맥락 축 개수로 나눠 dispatch 환산**으로 본다. 읽는 셀
 * 자체는 그대로다(읽는 셀 = 쓰는 셀 불변식은 건드리지 않는다) — 세는 단위만 맞춘다.
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
  weeklyTokenSoftLimitForHarness,
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
  factorKeysForContext,
  graphBiasForModel,
  observationCountForModel,
  staleGraphAttenuation,
  type GraphContext,
  type RoutingGraph,
} from "./routing-graph";
import { classifyWorkloadTag } from "./workload-tags";
import {
  tokensForHarness,
  tokensForModel,
  usageLoadScore,
  weeklyLimitScore,
  type UsageRollupSnapshot,
} from "./usage-rollup";

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

/**
 * 워크로드 신호의 **한 칸당** 점수. `fit` 과 **같은 축**(진입칸 거리) 위에 얹혀
 * 그 감점을 깎거나 키운다 — 무거운 티켓이면 위로 가는 감점이 줄고 아래로 가는
 * 감점이 커진다(가벼우면 반대).
 *
 * ── 왜 이 성분이 필요한가 (★이 티켓의 핵심) ────────────────────────────
 * 2층이 보는 난도 축은 `tier` 하나뿐인데, **dispatch 의 기본값이 `standard` 다**
 * (`bridge-server.ts` 의 `complexity = "standard"` 기본 인자). 그래서 아키텍처
 * 개편 티켓과 오타 수정 티켓이 **같은 티어로 같은 점수판**을 받는다. 정작 그 차이를
 * 아는 신호(tags · taskType)는 이미 dispatch 가 나르고 있고, 1층은 그것으로
 * 비용효율을 증폭/감쇠하는데(`dispatch-scoring.costEfficiencyScore`) 2층만
 * 통째로 버렸다. KG 가 언젠가 배우긴 하지만 그건 **그 태그 조합의 셀이 찰 때까지**
 * 이고, audit(`docs/routing/label-capture-audit-2026-08-10.md` §6 G9)이 못 박은
 * 대로 표본은 얇다 — 즉 실사용 대부분의 시간 동안 태그는 칸을 못 움직인다.
 *
 * ── 크기의 근거 (각 티어의 FIT_PENALTY 와 TIE_BAND=5 대비) ──────────────
 *   · standard(6) — up 9 / down 5. 무거우면 up 3·down 11 이 되어 **위 칸이 근거로
 *     닿는 거리**가 되고, 가벼우면 up 15·down −1 이라 값싼 칸이 회전 운(運)이
 *     아니라 티켓 내용으로 이긴다. opus5 편중이 실제로 풀려야 하는 그 자리다.
 *   · simple(4) < up 14 — 태그가 아무리 무거워도 simple 티켓의 상향 감점을
 *     뒤집지 못한다(10/칸이 남는다). 진짜 무거우면 dispatch 가 난도를 올려야지
 *     태그가 비용 폭발의 뒷문이 되면 안 된다.
 *   · complex(4) < down 12 — 가벼운 태그가 complex 를 무너뜨리지 못한다(8/칸이
 *     남는다). "어려운 티켓의 실패는 재작업이라 절약분보다 비싸다"(FIT_PENALTY).
 * 어느 방향이든 **fit 을 이기지 못하도록** 티어별로 fit 의 작은 쪽보다 작게 잡았다.
 */
const WORKLOAD_STEP_WEIGHT: Readonly<Record<LadderTier, number>> = {
  simple: 4,
  standard: 6,
  complex: 4,
};

/**
 * 워크로드 축이 포화하는 **순 태그 개수**. 한 개로 축이 최대가 되면 태그 하나
 * 오타·습관이 라우팅을 끝까지 밀어 버린다. 서로 동의하는 태그 2개는 실제 신호다.
 */
export const WORKLOAD_TAG_SATURATION = 2;

/**
 * 워크로드 신호가 **몇 칸까지** 발언권을 갖나. 그 너머의 칸에도 신호는 실리지만
 * 크기가 더 자라지 않아서, 남은 거리는 `fit` 감점이 그대로 다 받는다.
 *
 * ★왜 상한이 필요한가: 이 성분은 `fit` 과 같은 축이라 칸당 선형이다. standard
 * (fit down 5 / 칸)에서 가벼운 신호가 최대치면 칸당 +6 이 되어 **아래로 갈수록
 * 총점이 계속 오른다** — 즉 "가벼운 티켓" 하나가 사다리 바닥까지 미끄러진다.
 * 티켓이 말한 것은 "이건 더 가볍다" 이지 "가장 싼 칸이면 뭐든 좋다" 가 아니다.
 * 2칸으로 묶으면 이웃 칸 경쟁은 신호가 정하고, 더 먼 칸은 단가·벤치·KG 가 스스로
 * 이겨서 와야 한다(ε-greedy 의 `EXPLORE_WINDOW` 와 같은 "이웃까지만" 규율).
 */
const WORKLOAD_STEP_CAP = 2;

/**
 * taskType 만으로 주는 **약한** 사전값(태그 하나의 절반).
 *
 * ★`docs`/`chore` 만 넣는다. 이 둘은 분류기(`mcp-server/task-type.ts`)가 티켓
 * 본문에서 뽑는 라벨이고, "문서·잡무는 프론티어 칸이 필요 없다" 는 판단은 되돌리기
 * 쉬운 쪽으로 틀린다(틀려도 재작업 1건, 맞으면 상시 절감).
 *
 * ★나머지 5종(bug-fix/feature/refactor/test/infra)은 **일부러 중립**이다. 버그
 * 수정은 한 줄일 수도 사흘짜리 디버깅일 수도 있어서 어느 쪽으로 밀어도 근거가
 * 없고, 근거 없는 사전값은 KG 가 배우기 전까지 라우팅을 계속 왜곡한다. 이 축을
 * 채우는 것은 사전값이 아니라 관측(`kg`)의 몫이다.
 */
const LIGHT_TASK_TYPES: ReadonlySet<string> = new Set(["docs", "chore"]);
const LIGHT_TASK_TYPE_PRIOR = -0.5;

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
 * 실사용량 로드밸런싱 가중(주간 토큰 점유율 → 감점).
 * simple 은 분산 여유, complex 는 품질 우선이라 약하게.
 */
const USAGE_LOAD_WEIGHT: Readonly<Record<LadderTier, number>> = {
  simple: 10,
  standard: 8,
  complex: 4,
};

/**
 * 주간 한도 근접 가중. 한도 100% 에서 −weight.
 * standard 가 opus 편중의 주 전장이라 가장 세게.
 */
const WEEKLY_LIMIT_WEIGHT: Readonly<Record<LadderTier, number>> = {
  simple: 12,
  standard: 16,
  complex: 10,
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

/**
 * 프리셋이 요구하는 **소진율 바닥**을 실측 위에 얹는다.
 *
 * 왜 이 모양인가: "비용절감" 프리셋(`dispatch-scoring.MODEL_PRESETS["cost-saver"]`)
 * 이 표현하려는 것은 "구독 쿼터를 아껴 쓰라" 이고, 그 뜻은 이미 이 파일 안에
 * `subscriptionCostScaleForHeadroom` / `costPressureForHeadroom` 두 함수로
 * 정확히 모델링돼 있다. 새 성분을 더하는 대신 그 함수들이 보는 **입력 하나**를
 * 바닥으로 눌러 주면, 절약 의도가 단가 항 안에서만 표현되고 다른 성분이 같은
 * 사실을 두 번 세지 않는다(이 파일의 이중계상 금지 규율).
 *
 * ★실측이 바닥보다 이미 나쁘면 실측이 이긴다(`Math.max`) — 절약 프리셋이 진짜
 * 소진 상황을 낙관적으로 덮어쓰면 안 된다. 쿼터 데이터가 아예 없으면 바닥이
 * 그대로 값이 된다(그게 이 레버의 주 사용처다 — 프로브가 없는 기기).
 */
export function applyBudgetUsedFloor(
  usedPercent: number | null | undefined,
  floorPercent: number | null | undefined,
): number | null | undefined {
  if (typeof floorPercent !== "number" || !Number.isFinite(floorPercent)) {
    return usedPercent;
  }
  const floor = Math.min(100, Math.max(0, floorPercent));
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
    return floor;
  }
  return Math.max(usedPercent, floor);
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

/**
 * **명시 태그**만으로 센 순 무게(무거운 태그 +1, 가벼운 태그 −1). 0 = 태그가
 * 없거나 서로 상쇄.
 *
 * taskType 사전값과 분리해 두는 이유: 태그는 **사람이 그 티켓에 직접 단 선언**
 * 이고 taskType 은 티켓 본문에서 **추론한 라벨**이다. 정책 게이트를 여는 것 같은
 * 되돌리기 어려운 판단은 선언에만 맡긴다(아래 gpt 진입칸 보류 해제).
 */
export function workloadTagNet(ctx: GraphContext | null | undefined): number {
  const tags = Array.isArray(ctx?.tags) ? ctx.tags : [];
  let net = 0;
  for (const tag of tags) {
    const workload = classifyWorkloadTag(tag);
    if (workload === "heavy") net += 1;
    else if (workload === "cheap") net -= 1;
  }
  return net;
}

/**
 * 이 dispatch 가 **얼마나 무거운 일인가** — `[-1, +1]`. 0 = 중립(무회귀).
 *
 * 재료는 둘 다 이미 ctx 에 실려 오는 것이다(새 사실 0):
 *   · `tags` — `workload-tags.ts` 어휘(1층 비용효율과 **같은 목록**). 무거운 태그
 *     +1, 가벼운 태그 −1 로 세고 `WORKLOAD_TAG_SATURATION` 으로 나눈다.
 *   · `taskType` — `docs`/`chore` 에만 약한 사전값(`LIGHT_TASK_TYPE_PRIOR`).
 *
 * 둘은 **더한다**: 태그 `architecture` 가 붙은 docs 티켓(설계문서 개편)은 순
 * +0.5 로 남아야지, taskType 이 태그를 덮어써서 "문서니까 싼 칸" 이 되면 안 된다.
 *
 * ★fail-safe: IPC 로 들어온 값이라 배열·문자열 여부를 여기서 확인한다. 모르는
 * 태그는 중립이고(추측 금지), 값이 이상하면 0 = 종전 동작이다.
 */
export function workloadIntensity(
  ctx: GraphContext | null | undefined,
): number {
  let intensity = workloadTagNet(ctx) / WORKLOAD_TAG_SATURATION;
  const taskType =
    typeof ctx?.taskType === "string" ? ctx.taskType.trim().toLowerCase() : "";
  if (LIGHT_TASK_TYPES.has(taskType)) intensity += LIGHT_TASK_TYPE_PRIOR;
  if (!Number.isFinite(intensity)) return 0;
  return Math.max(-1, Math.min(1, intensity));
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
  /** 티켓 내용(tags·taskType)이 말하는 무게 × 진입칸 거리. 중립 ctx 면 0. */
  workload: number;
  /** 단가(진입칸 대비 배수, 잔여예산 압력 반영). */
  cost: number;
  /** SWE-bench 차이. 벤치가 없으면 0 이고 `capability` 가 대신 움직인다. */
  bench: number;
  /** 벤치 결측 시의 콜드 폴백(능력등급 차이). */
  capability: number;
  /** 라우팅 그래프 관측(±20, stale 감쇠 후). 콜드면 0. */
  kg: number;
  /** UCB1 형 저표본 다양성 보너스(≥0). */
  diversity: number;
  /** 실사용량 점유율 감점(≤0). 콜드/무롤업이면 0. */
  usage: number;
  /** 주간 토큰 한도 근접 감점(≤0). 한도 없는 fleet 은 0. */
  weeklyLimit: number;
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
  /** 무엇이 결정했나 — 난이도/무게/단가/능력/효과/다양성/사용량/한도/탐색/동률. */
  decidedBy:
    | "fit"
    | "workload"
    | "cost"
    | "bench"
    | "capability"
    | "kg"
    | "diversity"
    | "usage"
    | "weeklyLimit"
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
  /**
   * 프리셋이 요구하는 **최소 소진율**(0-100). "비용절감" 프리셋이 구독 쿼터를
   * 아껴 쓰게 만드는 유일한 레버다 — `applyBudgetUsedFloor` 주석 참고.
   * 미지정이면 실측만 본다(무회귀).
   */
  minBudgetUsedPercent?: number | null;
  /**
   * 실사용량 롤업(cost_logs 로컬 거울 / getCostSummary.weeklyByModel).
   * 없으면 사용량·주간한도 항 = 0 (콜드 무회귀).
   */
  usageRollup?: UsageRollupSnapshot | null;
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
  /** stale KG 감쇠 기준 시각(테스트 주입). 미지정이면 Date.now(). */
  nowMs?: number;
}

/**
 * 동률 회전 카운터 — 1층 스코어러의 `modelRoundRobin` 과 같은 역할이되 **하네스별**
 * 이다. 한 dispatch 는 후보 하네스마다 이 함수를 한 번씩 부르므로(claude·gpt…),
 * 전역 카운터 하나를 공유하면 호출 수가 밴드 크기의 배수가 되어 회전이 제자리를
 * 돈다 — claude 밴드 2칸 × dispatch 당 2호출 = 매번 같은 칸(회전이 죽는다).
 *
 * ★키가 하네스만이 아니라 **(하네스 · 티어 · 역할)** 인 이유: 회전이 사려는 것은
 * "같은 맥락이 반복될 때 후보 칸들을 고루 관측하는 것" 이다. 카운터가 하네스
 * 하나면 backend/standard 스트림과 frontend/simple 스트림이 **같은 카운터를 서로
 * 밀어** 각 스트림 입장에서는 회전이 round-robin 이 아니라 임의 점프가 된다(밴드
 * 크기가 서로 다르면 특정 칸이 영영 안 뽑히기도 한다). 맥락별로 카운터를 나누면
 * 각 스트림이 자기 밴드를 정확히 한 바퀴씩 돈다. dispatch 당 호출 수는 그대로
 * 하네스당 1회라 위 "제자리 회전" 문제도 그대로 막힌다.
 */
const rotations = new Map<string, number>();

/**
 * 회전 스트림 키. 그래프 셀 축(role)과 사다리 축(tier)을 그대로 쓴다 — 여기서
 * 새 분류를 만들지 않는다. tag/taskType 까지 넣지 않는 이유는 반대쪽 실패다:
 * 스트림을 잘게 쪼갤수록 각 스트림의 dispatch 수가 줄어 카운터가 늘 0 근처에
 * 머물고, 그러면 회전이 "항상 첫 칸" 으로 퇴화한다.
 */
function rotationStreamKey(
  harness: string,
  tier: LadderTier,
  ctx: GraphContext | null | undefined,
): string {
  const role =
    typeof ctx?.role === "string" ? ctx.role.trim().toLowerCase() : "";
  return `${harness}|${tier}|${role}`;
}

function nextRotation(streamKey: string): number {
  const current = rotations.get(streamKey) ?? 0;
  rotations.set(streamKey, current + 1);
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
    usageRollup,
    modelAvailable,
    random = Math.random,
    nowMs = Date.now(),
  } = input;

  // ★프리셋의 절약 의도는 여기서 **한 번만** 적용된다. 아래 모든 단가/압력/보존
  // 판정(`effectiveCostIndexForModel`, `costPressureForHeadroom`, `conserving`,
  // 근거 문자열)이 이 값을 쓰므로, 절약 프리셋에서 탐색·동률회전이 멈추는 것도
  // 같은 한 줄에서 따라나온다(잔량이 부족할 땐 비교데이터를 사지 않는다).
  const budgetUsedPercent = applyBudgetUsedFloor(
    input.budgetUsedPercent,
    input.minBudgetUsedPercent,
  );

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
  const intensity = workloadIntensity(ctx);
  const workloadWeight = WORKLOAD_STEP_WEIGHT[tier];
  // ★쿼터가 마르면 **탐색도 회전도 사지 않는다**(pressure > 1 = 잔량 50% 미만).
  // 탐색은 "미래의 판단을 좋게 하려고 지금 조금 더 쓰는 것" 인데, 잔량이 부족한
  // 순간엔 그 지출이 다음 티켓의 스폰 자체를 못 하게 만들 수 있다. 그때는 근거상
  // 최선(=대개 더 싼 칸)만 그대로 쓴다.
  //
  // ★같은 이유로 UCB1 저표본 보너스도 여기서 0 이 된다. 그 보너스는 방향이
  // 없어서(안 본 칸이면 비싼 칸도 끌어올린다) 절약 국면에 켜 두면 "탐색은 안
  // 사는데 탐색값은 점수에 남아 있는" 모순이 된다 — mode 만 top-score 로 바뀌고
  // 실제로는 여전히 탐색 편향이 이기는 상태였다.
  const conserving = costPressureForHeadroom(budgetUsedPercent) > 1;
  const benchWeight = BENCH_WEIGHT[tier];
  const capWeight = CAPABILITY_WEIGHT[tier];
  const usageWeight = USAGE_LOAD_WEIGHT[tier];
  const weeklyWeight = WEEKLY_LIMIT_WEIGHT[tier];
  const diversityCoefficient =
    input.diversityCoefficient ??
    resolveDiversityC(process.env.MARBLO_ROUTING_DIVERSITY);
  const kgAttenuation = graph
    ? staleGraphAttenuation(graph.updatedAt, nowMs)
    : 1;

  // 후보 풀 전체 주간 토큰(로드밸런싱 분모). 전역 총합이 아니라 **이 하네스
  // 후보들의 합**이라 다른 하네스 사용량이 칸 순위를 왜곡하지 않는다.
  const poolTokens = usable.reduce(
    (sum, c) => sum + tokensForModel(c.model, usageRollup),
    0,
  );
  const harnessWeeklyTokens = tokensForHarness(harness, usageRollup, {
    subscriptionOnly: true,
  });
  const weeklyLimit = weeklyTokenSoftLimitForHarness(harness);

  // ★dispatch 환산(§UCB1 회계) — 결과 1건이 맥락 축 개수만큼 셀에 기록되므로
  // 그 개수로 나눠야 "관측 n 건" 이 "dispatch n 건" 을 뜻한다. 축이 하나도 없는
  // ctx(전부 빈 문자열)면 1 로 둔다 — 0 으로 나누지 않는다(fail-safe).
  const contextFactorCount = Math.max(1, factorKeysForContext(ctx).length);
  const observed = new Map<string, number>();
  for (const candidate of usable) {
    observed.set(
      candidate.modelKey,
      graph
        ? observationCountForModel(candidate.modelKey, ctx, graph) /
            contextFactorCount
        : 0,
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

    // 워크로드는 fit 과 **같은 축** 위에 부호만 반대로 얹힌다: 무거우면(양수)
    // 위로 갈 때 감점을 깎고 아래로 갈 때 더 벌한다. 중립(0)이면 정확히 0 이라
    // 태그·taskType 이 없는 종전 dispatch 는 비트 단위로 같은 점수를 받는다.
    // 거리는 `WORKLOAD_STEP_CAP` 까지만 센다(먼 칸으로의 미끄럼 방지).
    const workloadSteps = Math.max(
      -WORKLOAD_STEP_CAP,
      Math.min(WORKLOAD_STEP_CAP, steps),
    );
    const workload = workloadWeight * intensity * workloadSteps;

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
    const kgRaw = graph
      ? graphBiasForModel([candidate.modelKey, harness], ctx, graph)
      : 0;
    const kg = kgRaw * kgAttenuation;
    const observations = observed.get(candidate.modelKey) ?? 0;
    // 저표본 보너스는 ε-greedy 와 **같은 근접창 규율**을 받는다. ε-greedy 는
    // 이미 진입칸 ±EXPLORE_WINDOW 로 탐색 범위를 묶어 뒀는데(complex 티켓이
    // simple 칸으로 떨어지는 사고 방지), 상시로 켜져 있는 이 보너스에는 그 규율이
    // 없어서 **먼 칸이 n=0 이라는 이유만으로** 큰 보너스를 받았다 — 같은 목적을
    // 가진 두 장치가 서로 다른 안전선을 쓰고 있었던 셈이다. 창 밖은 거리에 반비례로
    // 감쇠시킨다(끊지 않는다 — 언젠가는 그 칸도 비교데이터가 필요하다).
    const diversity = conserving
      ? 0
      : diversityBonus(observations, totalObservations, diversityCoefficient) *
        explorationProximity(steps);

    // 실사용량 하향 — 후보 풀 안에서 토큰 점유율이 큰 칸을 벌한다.
    const modelTok = tokensForModel(candidate.model, usageRollup);
    const usage = usageLoadScore(modelTok, poolTokens, usageWeight);

    // 주간 한도 — 모델별 점유 비중이 높을수록 한도 압력을 더 받는다
    // (opus 가 주를 먹었으면 opus 만 크게 깎고 sonnet 은 상대적으로 산다).
    // 한도 없는 하네스(grok 등) → 0. 콜드 롤업 → 0.
    let weeklyLimitPenalty = 0;
    if (
      typeof weeklyLimit === "number" &&
      weeklyLimit > 0 &&
      harnessWeeklyTokens > 0
    ) {
      const harnessPenalty = weeklyLimitScore(
        harnessWeeklyTokens,
        weeklyLimit,
        weeklyWeight,
      );
      // 모델 점유율로 분배: 많이 쓴 칸이 한도 벌점을 더 진다.
      const share =
        harnessWeeklyTokens > 0
          ? Math.min(1, Math.max(0, modelTok / harnessWeeklyTokens))
          : 0;
      // 최소 20% 균등 + 80% 점유 가중 — 완전 0 점유 칸도 하네스 한도의 영향을 약하게 받는다.
      weeklyLimitPenalty = harnessPenalty * (0.2 + 0.8 * share);
    }

    const total =
      fit +
      workload +
      cost +
      bench +
      capability +
      kg +
      diversity +
      usage +
      weeklyLimitPenalty;
    return {
      candidate,
      fit: round1(fit),
      workload: round1(workload),
      cost: round1(cost),
      bench: round1(bench),
      capability: round1(capability),
      kg: round1(kg),
      diversity: round1(diversity),
      usage: round1(usage),
      weeklyLimit: round1(weeklyLimitPenalty),
      totalObservations: round1(totalObservations),
      observations: round1(observations),
      total: round1(Number.isFinite(total) ? total : 0),
    };
  });

  scores.sort((a, b) => b.total - a.total);
  const coldStart = scores.every((s) => s.observations === 0);

  let mode: AutoSelectMode;
  let winner = scores[0];

  const rotationKey = rotationStreamKey(harness, tier, ctx);

  const entryScore = scores.find(
    (s) => s.candidate.modelKey === entryCandidate?.modelKey,
  );

  const gptShouldHoldEntry =
    harness === "gpt" &&
    entryScore &&
    !input.forceExplore &&
    scores.every((s) => s.kg === 0) &&
    workloadTagNet(ctx) === 0 &&
    (coldStart || diversityCoefficient === 0);

  if (gptShouldHoldEntry) {
    // gpt-5.6 변종 편입 직후에는 변종별 KG가 없다. 이때 비용 동률 회전이
    // standard→terra, complex→sol 진입 정책을 흔들면 사다리 자체가 말한
    // 난도별 기본 변종이 사라진다. KG·diversity·명시 탐색 근거가 있으면
    // 아래 경로로 간다.
    //
    // ★**명시 워크로드 태그**도 그 "근거" 다. 이 보류가 막으려던 것은 **근거 없는
    // 회전**이지 근거 있는 이동이 아니다 — 티켓이 스스로 무겁다/가볍다고 말했는데도
    // 진입칸을 붙들면, 이 티켓이 심은 신호가 gpt 사다리 전체에서 통째로 죽는다.
    //
    // ★단 taskType 사전값(추론 라벨)만으로는 안 연다. gpt 사다리는 luna 가 단가에서
    // terra 를 크게 앞서 있어서, 이 게이트가 열리는 순간 진입칸이 아니라 **최하위
    // 변종**까지 한 번에 간다. 그만한 이동을 추론 라벨 하나에 맡기지 않는다.
    winner = entryScore;
    mode = "top-score";
  } else if (scores.length === 1 || conserving) {
    mode = scores.length === 1 ? "single" : "top-score";
  } else {
    const epsilon =
      input.epsilon ?? resolveEpsilon(process.env.MARBLO_ROUTING_EXPLORE);
    const exploring = input.forceExplore ?? (epsilon > 0 && random() < epsilon);
    const explorePick = exploring
      ? pickExploration(scores, winner.candidate, entryIndex, rotationKey)
      : undefined;
    if (explorePick) {
      winner = explorePick;
      mode = "explore";
    } else {
      const band = scores.filter((s) => winner.total - s.total <= TIE_BAND);
      if (band.length > 1) {
        winner = band[nextRotation(rotationKey) % band.length];
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
  plan.reason = formatAutoReason(
    plan,
    winner,
    tier,
    budgetUsedPercent,
    budgetUsedPercent !== input.budgetUsedPercent
      ? input.minBudgetUsedPercent
      : undefined,
  );
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
  rotationKey: string,
): AutoScoreBreakdown | undefined {
  const pool = scores.filter(
    (s) =>
      s.candidate.modelKey !== winner.modelKey &&
      Math.abs(s.candidate.index - entryIndex) <= EXPLORE_WINDOW,
  );
  if (pool.length === 0) return undefined;
  const minObs = Math.min(...pool.map((s) => s.observations));
  const leanest = pool.filter((s) => s.observations === minObs);
  return leanest[nextRotation(rotationKey) % leanest.length];
}

/**
 * 진입칸에서 멀어질수록 저표본 보너스를 줄이는 계수(1 → 1/2 → 1/3 …).
 *
 * ε-greedy 의 `EXPLORE_WINDOW` 와 **같은 상수**를 쓴다. 두 장치의 목적이 같기
 * 때문이다 — 사고 싶은 것은 "비교 가능한 이웃 칸의 데이터" 이지 티어를 건너뛴
 * 칸의 데이터가 아니다. 창 안(≤1칸)은 감쇠 없음, 밖은 거리에 반비례.
 */
function explorationProximity(steps: number): number {
  const distance = Math.abs(steps);
  return distance <= EXPLORE_WINDOW ? 1 : EXPLORE_WINDOW / distance;
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
    ["workload", Math.abs(winner.workload)],
    ["cost", Math.abs(winner.cost)],
    ["bench", Math.abs(winner.bench)],
    ["capability", Math.abs(winner.capability)],
    ["kg", Math.abs(winner.kg)],
    ["diversity", Math.abs(winner.diversity)],
    ["usage", Math.abs(winner.usage)],
    ["weeklyLimit", Math.abs(winner.weeklyLimit)],
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
  /**
   * 값이 오면 이 잔여는 **실측이 아니라 프리셋이 눌러 놓은 바닥**이라는 뜻이다.
   * 감사 로그가 "20% left" 를 관측치로 읽히게 두면 안 된다.
   */
  presetFloorPercent?: number | null,
): string {
  const headroom =
    typeof budgetUsedPercent === "number" && Number.isFinite(budgetUsedPercent)
      ? `${Math.round(100 - Math.min(100, Math.max(0, budgetUsedPercent)))}% left${
          typeof presetFloorPercent === "number" &&
          Number.isFinite(presetFloorPercent)
            ? ` (preset floor ${presetFloorPercent}% used)`
            : ""
        }`
      : "no-data";
  // 티어 라벨(premier/standard/value)은 **점수가 아니라 표기**다 — 벤치+단가에서
  // 파생된 값이라 점수에 또 넣으면 이중계상이고, 사람이 읽을 땐 "이건 가성비 칸"
  // 한 마디가 숫자 다섯 개보다 빠르다.
  const tierLabel = modelGuidance(plan.model)?.tier;
  const factors = [
    `fit ${signed(winner.fit)}`,
    // 워크로드는 **중립이면 아예 안 적는다**. 0 을 적으면 태그가 없는 dispatch 의
    // 로그가 통째로 길어지고, 그 한 줄은 사람이 읽는 감사 로그다.
    winner.workload !== 0 ? `workload ${signed(winner.workload)}` : "",
    `cost ${signed(winner.cost)}`,
    winner.bench !== 0 ? `swe ${signed(winner.bench)}` : "",
    winner.capability !== 0 ? `cap ${signed(winner.capability)}` : "",
    tierLabel ? `tier=${tierLabel}` : "",
    `kg ${signed(winner.kg)}${plan.coldStart ? "(cold)" : `(n=${winner.observations})`}`,
    `diversity ${signed(winner.diversity)} (n=${winner.observations}, tot=${winner.totalObservations})`,
    winner.usage !== 0 ? `usage ${signed(winner.usage)}` : "",
    winner.weeklyLimit !== 0 ? `weekly ${signed(winner.weeklyLimit)}` : "",
    `budget ${headroom}`,
  ]
    .filter(Boolean)
    .join(", ");
  const moved = plan.movedFromEntry
    ? `entry ${plan.entryModelKey} → ${plan.modelKey}`
    : `entry ${plan.entryModelKey} 유지`;
  return `auto-model[${tier}] ${plan.modelKey} (${moved}; ${factors}; total ${winner.total}; mode=${plan.mode}, by=${plan.decidedBy})`;
}
