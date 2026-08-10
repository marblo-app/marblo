/**
 * 클라우드 라우팅 **shadow 서빙 스텁** — 순수 로직(BQ/Firebase 무의존).
 *
 * 티켓 6LH4Y1GC7xeWA94pW3Ar (브레인 라우팅 P1 배관).
 *
 * ── ★★ 명시적 비목표 (이 단계에서 하지 않는 것) ─────────────────────────────
 *   1. **학습을 하지 않는다.** 여기엔 모델도, 가중치 파일도, fine-tune 산출물도
 *      없다. 아래 휴리스틱은 로컬 `electron/model-autoselect.ts` 의 정책 상수를
 *      **손으로 옮겨 적은 것**이고, 그게 전부다.
 *   2. **실반영을 하지 않는다.** 이 함수의 출력은 어떤 스폰도 바꾸지 않는다.
 *      로컬이 이미 고른 칸으로 그대로 뜨고, 우리는 옆에서 "클라우드였다면 뭘
 *      골랐을까" 를 나란히 적기만 한다(shadow).
 *   3. **개인화하지 않는다.** 계정·사용자별 분기가 없다. 입력은 숫자·enum·모델
 *      id 뿐이다(프롬프트·티켓 본문·경로는 애초에 받지 않는다 — 아래 파서가
 *      모르는 필드를 통째로 버린다).
 *
 * 왜 이 단계인가: 외부 실사용이 사실상 0(오너 전용 텔레메트리)이라 학습 데이터가
 * 얇다. 그래서 지금 필요한 것은 모델이 아니라 **배관**이다 — 클라우드가 특징을
 * 받아 답을 돌려주는 왕복이 실제로 돌고, 그 답과 로컬 결정의 차이가 BigQuery 에
 * 쌓이기 시작해야, 나중에 진짜 모델을 끼울 때 "무엇이 좋아졌나" 를 잴 baseline 이
 * 존재한다. 지금 안 담은 날의 비교는 영원히 없다(스키마는 소급되지 않는다).
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 *   · `recommendRouting()` 은 **로컬 결정을 입력으로 받지 않는다.** 타입이 그걸
 *     막는다(`RoutingShadowFeatures` 에 그 필드가 없다). 비교는 그 뒤에 별도
 *     함수가 한다. 추천이 정답을 훔쳐보면 일치율이라는 지표 자체가 무의미해진다.
 *   · fail-safe 는 호출측 계약이다 — 이 모듈은 던지지 않고 `null` 을 돌려준다.
 *   · 순수 함수만 둔다(`node --test` 로 직접 검증: routingShadow.test.ts).
 */

/** 이 페이로드 계약의 버전. 스키마가 바뀌면 올린다(BQ 에 그대로 적힌다). */
export const ROUTING_SHADOW_SCHEMA_VERSION = 1;

/** 휴리스틱 자체의 버전. 정책을 바꾸면 올린다 — 일치율 시계열을 가르는 축. */
export const ROUTING_SHADOW_HEURISTIC_VERSION = "heuristic-v0-cost-fit";

export type RoutingShadowTier = "simple" | "standard" | "complex";

const TIERS: readonly RoutingShadowTier[] = ["simple", "standard", "complex"];

/**
 * 사다리 칸 하나. 클라이언트가 레지스트리에서 파생해 보낸다 — 모델 사실
 * (id·단가·순서)의 단일소스는 여전히 앱이고, 클라우드는 그걸 새로 만들지 않는다.
 */
export interface RoutingShadowRung {
  /** `model@effort` 표기(로컬 `formatModelKey` 와 같은 축). */
  modelKey: string;
  /** 사다리 위치(0=가장 아래). 난도적합 계산의 축. */
  index: number;
  /** 결정 시점 blended $/1M. 레지스트리에 없으면 생략(0 을 지어내지 않는다). */
  costIndex?: number;
}

/**
 * 클라우드가 추천을 만들 때 볼 수 있는 **전부**.
 *
 * ★여기에 `plannedModelKey`(로컬이 고른 칸)는 없다. 일부러 없다.
 */
export interface RoutingShadowFeatures {
  schemaVersion: number;
  tier: RoutingShadowTier;
  /** 1층에서 이미 정해진 하네스(claude/gpt/...). 2층 칸만 추천한다. */
  harness: string;
  /** 티어 진입칸의 사다리 위치. **정책 상수**(티어→진입칸)이지 로컬 결정이 아니다. */
  entryIndex: number;
  rungs: RoutingShadowRung[];
  /** 하네스 계정 쿼터 소진율(0-100). 없으면 null. */
  budgetUsedPercent?: number | null;
  /** 주간 토큰 중 이 하네스 몫(0-1). 없으면 null. */
  weeklyTokenShare?: number | null;
  activeAgentCount?: number | null;
  roleAgentCount?: number | null;
  /** 역할 라벨(backend/frontend/...). 오늘 휴리스틱은 안 쓴다 — 축만 열어 둔다. */
  role?: string | null;
  /** 경로파생 coarse 카테고리. 오늘 휴리스틱은 안 쓴다. */
  taskType?: string | null;
  /** ★태그 **개수**만. 태그 문자열은 사용자 자유입력이라 받지 않는다. */
  tagCount?: number | null;
}

export interface RoutingShadowScore {
  modelKey: string;
  fit: number;
  cost: number;
  total: number;
}

export interface RoutingShadowRecommendation {
  modelKey: string;
  heuristicVersion: string;
  /** 선택 칸의 성분 분해(감사용). 후보 전체는 `scores`. */
  scores: RoutingShadowScore[];
  /** 무엇이 이 추천을 움직였나 — `fit` | `cost` | `entry`(성분 0 = 진입칸 유지). */
  decidedBy: "fit" | "cost" | "entry";
  /** 사람이 읽을 한 줄. */
  reason: string;
}

// ── 정책 상수 — ★로컬 `electron/model-autoselect.ts` 에서 옮겨 적은 값 ──────
//
// 왜 복제인가: functions 는 electron 과 다른 tsconfig·다른 런타임이라 그 모듈을
// import 할 수 없다(그 파일은 model-registry/model-ladder 를 끌고 온다). 값을
// 옮겨 적되 **출처를 못 박아** 두 곳이 갈리면 눈에 보이게 한다. 갈리는 것 자체는
// 사고가 아니다 — 이 스텁의 존재 이유가 "클라우드와 로컬이 어디서 갈리나" 를
// 재는 것이기 때문이다. 다만 갈리는 이유가 **의도**여야지 방치여선 안 된다.

/** 진입칸에서 한 칸 벗어날 때의 감점(비대칭). local FIT_PENALTY 와 동일. */
const FIT_PENALTY: Readonly<
  Record<RoutingShadowTier, { up: number; down: number }>
> = {
  simple: { up: 14, down: 3 },
  standard: { up: 9, down: 5 },
  complex: { up: 6, down: 12 },
};

/** 단가 반값당 점수. local COST_WEIGHT 와 동일. */
const COST_WEIGHT: Readonly<Record<RoutingShadowTier, number>> = {
  simple: 12,
  standard: 7,
  complex: 2,
};

/**
 * 잔여 쿼터 → 단가 민감도 배수. local `costPressureForHeadroom` 과 동일한
 * 연속·단조 보간(마디: 잔여 ≥50%→1 / 25%→1.5 / 10%→2.2 / 0%→3.2).
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

function log2Ratio(from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return 0;
  return Math.log2(from / to);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 특징 → 추천 칸.
 *
 * ★의도적으로 **로컬의 부분집합**이다. 로컬은 8성분(fit·cost·bench·capability·
 * kg·diversity·usage·weeklyLimit)으로 고르는데 여기엔 fit·cost 둘뿐이다.
 * 나머지 여섯은 클라우드에 **없는 사실**이기 때문이다:
 *   · bench/capability — 벤치 참조표가 앱 안에 있다(레지스트리 파생).
 *   · kg/diversity     — 라우팅 지식그래프가 기기 로컬 파일이다.
 *   · usage/weeklyLimit— 사용량 롤업이 기기 로컬 거울이다.
 * 그래서 이 스텁의 불일치는 랜덤 노이즈가 아니라 **"클라우드가 못 보는 신호가
 * 결정을 움직인 순간"** 을 정확히 가리킨다. 그 목록이 곧 다음 단계에서 클라우드로
 * 올려야 할 특징의 우선순위다(audit 문서 §갭 참조).
 *
 * 후보가 없거나 티어/사다리가 말이 안 되면 `null` — 지어내지 않는다.
 */
export function recommendRouting(
  features: RoutingShadowFeatures,
): RoutingShadowRecommendation | null {
  const rungs = features.rungs;
  if (!Array.isArray(rungs) || rungs.length === 0) return null;
  const tier = features.tier;
  if (!TIERS.includes(tier)) return null;

  const entryIndex = Number.isFinite(features.entryIndex)
    ? features.entryIndex
    : 0;
  const entry = rungs.find((r) => r.index === entryIndex) ?? rungs[0];
  const entryCost = entry?.costIndex;

  const fitWeights = FIT_PENALTY[tier];
  const costWeight =
    COST_WEIGHT[tier] * costPressureForHeadroom(features.budgetUsedPercent);

  const scores: RoutingShadowScore[] = rungs.map((rung) => {
    const steps = rung.index - entryIndex;
    const fit =
      steps === 0
        ? 0
        : steps > 0
          ? -fitWeights.up * steps
          : fitWeights.down * steps;
    const cost =
      typeof entryCost === "number" && typeof rung.costIndex === "number"
        ? costWeight * log2Ratio(entryCost, rung.costIndex)
        : 0;
    return {
      modelKey: rung.modelKey,
      fit: round1(fit),
      cost: round1(cost),
      total: round1(fit + cost),
    };
  });

  // 동점이면 사다리 순서가 낮은(= 싼) 칸이 이긴다. 클라우드엔 회전 상태가 없고,
  // 상태 없는 결정론이 shadow 지표를 읽기 쉽게 만든다(로컬의 tie-rotate 와
  // 갈리는 것은 의도 — 그 차이도 세는 값이다).
  let winner = scores[0];
  for (const s of scores) {
    if (s.total > winner.total) winner = s;
  }

  const decidedBy: RoutingShadowRecommendation["decidedBy"] =
    Math.abs(winner.fit) === 0 && Math.abs(winner.cost) === 0
      ? "entry"
      : Math.abs(winner.cost) > Math.abs(winner.fit)
        ? "cost"
        : "fit";

  return {
    modelKey: winner.modelKey,
    heuristicVersion: ROUTING_SHADOW_HEURISTIC_VERSION,
    scores,
    decidedBy,
    reason:
      `cloud-shadow[${tier}] ${winner.modelKey} ` +
      `(entry ${entry?.modelKey ?? "?"}; fit ${winner.fit}, cost ${winner.cost}; ` +
      `total ${winner.total}, by=${decidedBy})`,
  };
}

// ── 비교(shadow 지표) ───────────────────────────────────────────────────

export interface RoutingShadowComparison {
  /** 클라우드 추천과 로컬 실제 선택이 같은가. 로컬 값이 없으면 null. */
  agree: boolean | null;
  cloudModelKey: string;
  localModelKey: string | null;
  /** 사다리 칸 차이(cloud − local). 둘 중 하나라도 사다리에 없으면 null. */
  rungDelta: number | null;
  /** 두 칸의 단가 차이(cloud − local, blended $/1M). 미상이면 null. */
  costDelta: number | null;
}

/**
 * 추천 vs 로컬 실제 선택. **추천이 끝난 뒤에** 부른다 — 순서가 계약이다.
 * `localModelKey` 를 `recommendRouting` 이 못 보게 하려고 함수를 나눴다.
 */
export function compareShadowRouting(
  features: RoutingShadowFeatures,
  recommendation: RoutingShadowRecommendation,
  localModelKey: unknown,
): RoutingShadowComparison {
  const local =
    typeof localModelKey === "string" && localModelKey.trim()
      ? localModelKey.trim()
      : null;
  const rungOf = (key: string | null): RoutingShadowRung | undefined =>
    key ? features.rungs.find((r) => r.modelKey === key) : undefined;
  const cloudRung = rungOf(recommendation.modelKey);
  const localRung = rungOf(local);
  return {
    agree: local === null ? null : local === recommendation.modelKey,
    cloudModelKey: recommendation.modelKey,
    localModelKey: local,
    rungDelta:
      cloudRung && localRung ? cloudRung.index - localRung.index : null,
    costDelta:
      typeof cloudRung?.costIndex === "number" &&
      typeof localRung?.costIndex === "number"
        ? Math.round((cloudRung.costIndex - localRung.costIndex) * 1000) / 1000
        : null,
  };
}

// ── 입력 파싱 — 서버는 클라이언트를 믿지 않는다 ──────────────────────────

/** 후보 칸 상한. 사다리는 한 자릿수라 넉넉하다(무한 배열 방어). */
export const MAX_RUNGS = 32;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * 요청 본문 → 특징. **화이트리스트**다: 여기서 안 읽는 키는 통째로 버려진다.
 * 그래서 클라이언트가 실수로 프롬프트를 실어 보내도 서버가 그걸 볼 일이 없다.
 *
 * 형태가 안 맞으면 `null` — 호출측은 invalid-argument 로 끝낸다(추측 금지).
 */
export function parseShadowFeatures(
  data: unknown,
): RoutingShadowFeatures | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  const tier = str(d.tier, 16);
  if (!tier || !TIERS.includes(tier as RoutingShadowTier)) return null;
  const harness = str(d.harness, 32);
  if (!harness) return null;

  const rawRungs = Array.isArray(d.rungs) ? d.rungs.slice(0, MAX_RUNGS) : [];
  const rungs: RoutingShadowRung[] = [];
  for (const raw of rawRungs) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const modelKey = str(r.modelKey, 128);
    const index = num(r.index);
    if (!modelKey || index === null) continue;
    const costIndex = num(r.costIndex);
    rungs.push({
      modelKey,
      index: Math.trunc(index),
      ...(costIndex !== null && costIndex > 0 ? { costIndex } : {}),
    });
  }
  if (rungs.length === 0) return null;

  return {
    schemaVersion: num(d.schemaVersion) ?? ROUTING_SHADOW_SCHEMA_VERSION,
    tier: tier as RoutingShadowTier,
    harness,
    entryIndex: Math.trunc(num(d.entryIndex) ?? 0),
    rungs,
    budgetUsedPercent: num(d.budgetUsedPercent),
    weeklyTokenShare: num(d.weeklyTokenShare),
    activeAgentCount: num(d.activeAgentCount),
    roleAgentCount: num(d.roleAgentCount),
    role: str(d.role, 64),
    taskType: str(d.taskType, 64),
    tagCount: num(d.tagCount),
  };
}
