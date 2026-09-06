/**
 * Pure scoring functions for smart agent dispatch.
 * Extracted from BridgeServer for testability.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  graphBiasForModel,
  type RoutingGraph,
  type GraphContext,
} from "./routing-graph";
import { classifyWorkloadTag } from "./workload-tags";

export type ModelType =
  | "claude"
  | "gemini"
  | "gpt"
  | "grok"
  | "antigravity"
  | "local"
  | "custom";
export type AgentStatus = "idle" | "working" | "error" | "stopped";

export interface AgentInfo {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  status: AgentStatus;
  restartCount: number;
}

export interface ScoredAgent {
  agent: AgentInfo;
  score: number;
  reason: string;
}

export interface ModelBudgetInfo {
  /** Account-global utilization percentage, 0-100. null/undefined = no data. */
  usedPercent?: number | null;
}

export type ModelBudgetSnapshot = Partial<Record<ModelType, ModelBudgetInfo>>;

export interface BudgetBiasResult {
  /** null means the model is budget-exhausted and must be excluded. */
  bias: number | null;
  reason: string;
}

export function isLaneContextId(contextId: string | undefined): boolean {
  return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}

/**
 * Dispatch reuse/restart context gate.
 *
 * Lane agents carry MARBLO_CONTEXT=lane:<id> and must never be reused by board
 * dispatches. A lane dispatch is stricter: only an agent from the same lane
 * context may be reused. Non-lane requests keep the old behavior for non-lane
 * agents.
 */
export function isAgentContextReusable(
  agentContextId: string | undefined,
  requestContextId: string | undefined,
): boolean {
  const agentIsLane = isLaneContextId(agentContextId);
  const requestIsLane = isLaneContextId(requestContextId);
  if (agentIsLane) return requestIsLane && agentContextId === requestContextId;
  if (requestIsLane) return false;
  return true;
}

// ── Patent claim 9 [식 1] 가중합: 매칭점수 = Σ (w_i × Index_i) ──
//
// 명세서 [식 1]: 매칭점수 = (w1 × 역할매칭지표) + (w2 × 부하균등지표)
//                          + (w3 × 비용효율지표)
//
// 청구항 9 자체는 "1 이상에 기초" 만 요구하지만, [식 1] 표기와 코드를
// 1:1 매핑해 두면 침해 분석/심사관 대응 시 즉시 인용 가능. 실제 가중치는
// hard gate (역할 미매치 = filter out) 와 soft bonus 의 혼합으로
// 운용된다 — `WEIGHTS` 상수로 한 곳에 모아 튜닝/문서화 단일화.
//
// 추가 항 (model preference, tag bonus, restart penalty, reuse bonus) 은
// [식 1] 의 본질에는 영향 없는 보조 신호 — 같은 가중합 패턴으로 합산하지만
// 청구항 9 의 3대 지표와 분리해서 reason 문자열에 별도 표기한다.
export const WEIGHTS = {
  /** w1 — 역할매칭지표는 hard gate 이지만 매칭 시 base score 100 부여 */
  role: 100,
  /** w2 — 부하균등지표 (status: idle 가장 높고 error 가장 낮음) */
  loadBalance: 1,
  /** w3 — 비용효율지표 (모델 단가 + 구독 한도 인지) */
  costEfficiency: 1,
  /** 보조: 사용자가 명시한 선호 모델과 일치 시 */
  modelPreference: 20,
  /** 보조: 에이전트 이름 태그가 task 태그와 일치 시 (per match) */
  tagBonus: 10,
  /** 보조: 재시작 이력 페널티 (per restart) */
  restartPenalty: -5,
  /**
   * 보조: 기존 에이전트 reuse 시 추가 보너스. 새 spawn 의 base score
   * (MODEL_BASE_SCORE 45-50) 보다 reuse 가 항상 우위에 서도록 — Marblo
   * 운용 정책상 기존 에이전트 컨텍스트 재활용이 새 spawn 보다 거의 항상
   * 더 효율적 (PTY 부팅 비용 + 컨텍스트 재구축 비용 회피).
   */
  reuseBonus: 30,
} as const;

// ── Patent 청구항 9 — 3대 지표 계산기 ───────────────────────

/** 역할매칭지표: agent.role === task.role 이면 1, 아니면 0 (hard gate). */
export function roleMatchIndex(agent: AgentInfo, role: string): 0 | 1 {
  return agent.role === role ? 1 : 0;
}

/**
 * 부하균등지표: 현재 에이전트의 작업부하에 반비례.
 * idle (가장 가벼움) > stopped (재시작 가능) > working (mid-task) > error.
 * 명세서 단락 173: "특정 에이전트에 태스크가 과도하게 집중되는 것을 방지".
 */
export function loadBalanceIndex(agent: AgentInfo): number {
  switch (agent.status) {
    case "idle":
      return 50;
    case "stopped":
      return 30;
    case "working":
      return 10;
    case "error":
      return 5;
    default:
      // status 는 타입상 위 4개로 닫혀 있지만, IPC/디스크/구버전 enum 등에서
      // 들어온 예상 밖 값(undefined·오타)이면 switch 가 어떤 case 도 못 맞춰
      // undefined 를 반환하고, 호출부의 가중합 `WEIGHTS.loadBalance * lIdx` 이
      // NaN 으로 오염된다. 가장 보수적인 부하값(error 와 동일한 5)으로 대체해
      // NaN 전파를 차단하고, 알 수 없는 상태의 후보에는 낮은 우선순위를 준다.
      return 5;
  }
}

// ── Cost-efficiency table (patent 청구항 9: 비용효율지표) ──────
//
// Patent claim 9 calls out three explicit components of the per-task,
// per-agent matching score:
//   - 역할매칭지표 (role match)
//   - 부하균등지표 (load balance)
//   - 비용효율지표 (cost efficiency)
//
// The first two are encoded inline below (role gate + status-based load).
// This table backs the third: a coarse $/1M-token weight per model that
// `costEfficiencyScore()` converts into a score bonus. Keep the numbers
// roughly proportional to cost-tracker's MODEL_PRICING but bucketed —
// exact pricing changes shouldn't churn dispatch behavior, only relative
// ordering matters.
//
// Higher COST_EFFICIENCY_WEIGHT == cheaper-per-quality model preferred
// when other signals are tied. Custom models default to the median.
// Base values intentionally sit comfortably below COST_EFFICIENCY_MAX so
// the tag amplifier in `costEfficiencyScore` has room to push without
// being clamped on the very first cheap tag.
const COST_EFFICIENCY_WEIGHT: Record<ModelType, number> = {
  // Claude: highest accuracy but expensive (Opus ~$15/$75 per 1M)
  claude: 3,
  // Gemini: mid-tier flash/pro (~$0.15-1.25 input)
  gemini: 8,
  // Codex/GPT: cheapest mainstream (gpt-4.1-nano ~$0.10, mini ~$0.40)
  gpt: 10,
  grok: 8,
  // Antigravity (agy): Gemini 3.5 Flash backed (similar tier to gemini),
  // free at launch (2026-05-19). Slightly higher cost-efficiency than
  // gemini due to agentic optimizations + free-tier window.
  antigravity: 9,
  // Local (Ollama / LM Studio / llama.cpp etc.): free at point of use, but
  // capability varies wildly with the loaded weights. Treat as median to
  // avoid biasing dispatch toward an unknown model.
  local: 5,
  // Custom: assume mid-tier
  custom: 5,
};

// Cap on how much the cost-efficiency component can move the score.
// Smaller than the role/load components so cost alone never overrides
// role mismatch (role is the gate per claim 9).
const COST_EFFICIENCY_MAX = 15;

const BUDGET_BIAS_MAX = 20;

/**
 * 잔여 쿼터(%) → 프로바이더 축 bias. **구간상수가 아니라 연속(단조) 곡선**이다.
 *
 * ★왜 바꿨나(라이브 측정, 2026-08-01): 종전 4구간 상수(+6/+2/-8/-16)는 잔여
 * 50% 를 1%만 지나도 claude 가 tie-band 50% 에서 0% 로 떨어지는 절벽을 만들고,
 * 정작 잔여 25~50% 구간은 +2 로 평평해 아무것도 안 움직이는 죽은 구간이었다.
 * 절벽은 "쿼터가 조금 줄었다" 를 "하네스를 통째로 갈아탄다" 로 번역하고, 죽은
 * 구간은 사장님이 원한 "주요 팩터" 를 그 구간에서 무력화한다. 곡선을 연속으로
 * 만들면 두 병이 같이 사라진다 — 잔여가 줄수록 **점진적으로** 밀린다.
 *
 * 마디값(잔여 기준):
 *   · ≥50%  → +6 **평평**. ★과반응 금지 지점이다. 쿼터가 넉넉할 땐 라우팅을
 *             능력·단가·KG 가 주도해야 하고 쿼터는 발언권이 없어야 한다.
 *             종전과 **같은 값**이라 이 구간은 무회귀다.
 *   · 25%   →  0  — 부호가 바뀌는 **변곡점**. 여기부터 쿼터가 감점으로 돈다.
 *   · 10%   → -12
 *   ·  0%   → -20 (= BUDGET_BIAS_MAX). graphBias 와 같은 ±20 스케일의 끝까지
 *             쓴다 — 이 지점의 쿼터는 다른 어떤 정적신호보다 우선해야 한다
 *             (base 최대차 20, costEff 최대차 12 를 혼자 뒤집는 크기).
 *
 * 0% 는 도달 전에 `remaining <= 0` 하드게이트(bias=null)가 먼저 잡는다.
 */
function budgetBiasCurve(remaining: number): number {
  // 구간 [저잔여, 고잔여] → [저잔여 bias, 고잔여 bias] 선형보간.
  const lerp = (lo: number, hi: number, at: number, to: number): number =>
    at + ((remaining - lo) / (hi - lo)) * (to - at);
  if (remaining >= 50) return 6;
  if (remaining >= 25) return lerp(25, 50, 0, 6);
  if (remaining >= 10) return lerp(10, 25, -12, 0);
  return lerp(0, 10, -20, -12);
}

/**
 * Real-time budget signal for dispatch scoring. This is intentionally separate
 * from costEfficiencyScore(): cost-eff is static/unit-price prior, while this
 * reads the current account quota headroom. Missing data is neutral.
 *
 * ★no-data 는 0(중립)이지 0% 잔여가 아니다. grok 이 오늘 여기로 온다 —
 * Grok Build CLI 0.2.117 에 usage/quota 명령이 없어(#713) account-usage 가
 * null 을 주고, 그 null 은 bridge-server 스냅샷에서 아예 빠진다. 즉 grok 은
 * **budget 팩터 밖**이며 그게 정상이다(없는 숫자를 지어내지 않는다). grok 이
 * usage 를 노출하면 스냅샷에 grok 을 넣는 것만으로 이 곡선을 그대로 탄다.
 */
export function budgetBiasScore(
  model: ModelType,
  budgets?: ModelBudgetSnapshot,
): BudgetBiasResult {
  const used = budgets?.[model]?.usedPercent;
  if (typeof used !== "number" || !Number.isFinite(used)) {
    return { bias: 0, reason: "budget +0(no-data)" };
  }

  const clampedUsed = Math.min(100, Math.max(0, used));
  const remaining = 100 - clampedUsed;
  if (remaining <= 0) {
    return { bias: null, reason: "budget exhausted" };
  }

  const bias = Math.round(budgetBiasCurve(remaining) * 10) / 10;
  const safeBias = Math.max(-BUDGET_BIAS_MAX, Math.min(BUDGET_BIAS_MAX, bias));
  const sign = safeBias >= 0 ? "+" : "";
  return {
    bias: safeBias,
    reason: `budget ${sign}${safeBias}(${Math.round(remaining)}% left)`,
  };
}

// ── ★near-limit 예비(reserve) 게이트 ────────────────────────────────────
//
// 왜 bias 만으로는 부족한가(라이브 측정 2026-08-07, 티켓 AS4noeJq): budgetBias 의
// 바닥은 -20 인데 1층 점수에는 그보다 큰 성분들이 있다. gpt 잔여 5%(bias -16) 라도
//
//     gpt   45(base) + 25(simple-fix) + 13(costEff×tag) − 16 = 67
//     claude 50(base) +  0            +  4              +  6 = 60
//
// 이라 **태그 하나가 쿼터를 이긴다**. 실제 관측이 그랬다 — 완전소진(잔여 0%)만
// 하드차단되고, 임박 구간에서는 codex 로 계속 스폰됐다.
//
// 그래서 임박 구간은 "점수를 더 깎는" 게 아니라 **후보에서 뺀다**. 잔여 한 자릿수를
// 태워 티켓을 시작하면 대개 도중에 0 을 만나 PTY 하나를 안고 죽는데, 그 실패는
// 재작업이라 절약분보다 비싸다(FIT_PENALTY 주석과 같은 논리).
//
// ★두 가지 안전장치:
//   1. **대안이 있을 때만** 뺀다. 후보가 전부 임박이면 아무도 빼지 않는다 —
//      게이트가 dispatch 자체를 죽이면 사용자는 "왜 아무것도 안 뜨지" 만 본다.
//   2. **no-data 는 임박이 아니다**(grok). 없는 숫자를 0% 잔여로 접지 않는다는
//      budgetBiasScore 의 규율을 그대로 따른다.
//
// 명시 모델 핀은 이 게이트를 타지 않는다(설계상 예외). 그 경로의 방어선은
// `get_model_guidance` 가 노출하는 하네스별 잔여다.

/** 잔여가 이 %p 이하면 "곧 마른다". `MARBLO_QUOTA_RESERVE_PCT` 로 조정. */
export const DEFAULT_QUOTA_RESERVE_PCT = 10;

/**
 * env 로 reserve 를 조정한다. `0` = 끄기(소진 하드게이트만 남는다).
 * 미설정(빈 문자열)·비수·범위 밖(0~100 아님)은 기본값 — `Number("")===0` 때문에
 * 미설정을 0 으로 접으면 게이트가 조용히 꺼진다(resolveEpsilon 과 같은 함정).
 */
export function resolveQuotaReservePct(raw?: string): number {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_QUOTA_RESERVE_PCT;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return DEFAULT_QUOTA_RESERVE_PCT;
  }
  return value;
}

/** 이 하네스의 잔여 쿼터(%). 데이터가 없으면 null(= 모름, 0% 아님). */
export function remainingQuotaPercent(
  model: ModelType,
  budgets?: ModelBudgetSnapshot,
): number | null {
  const used = budgets?.[model]?.usedPercent;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  return 100 - Math.min(100, Math.max(0, used));
}

/**
 * 잔여가 reserve 이하인 하네스들. 데이터 없는 하네스는 들어가지 않는다.
 * 중복 항목(프리셋 가중치용 반복)이 있어도 집합이라 한 번만 담긴다.
 */
export function nearLimitModels(
  models: readonly ModelType[],
  budgets?: ModelBudgetSnapshot,
  reservePct: number = DEFAULT_QUOTA_RESERVE_PCT,
): Set<ModelType> {
  const near = new Set<ModelType>();
  if (!(reservePct > 0)) return near;
  for (const model of models) {
    const remaining = remainingQuotaPercent(model, budgets);
    if (remaining !== null && remaining <= reservePct) near.add(model);
  }
  return near;
}

/**
 * near-limit 항목을 후보에서 뺀다 — **단, 남는 게 있을 때만**.
 *
 * 모델 목록에도, 재사용 후보(에이전트) 목록에도 같은 술어를 쓰라고 제네릭이다.
 * 전부 near-limit 이면 `dropped` 는 비고 `kept` 가 입력 그대로다.
 */
export function reserveQuotaGate<T>(
  items: readonly T[],
  keyOf: (item: T) => ModelType,
  nearLimit: ReadonlySet<ModelType>,
): { kept: T[]; dropped: T[] } {
  if (nearLimit.size === 0) return { kept: [...items], dropped: [] };
  const kept = items.filter((item) => !nearLimit.has(keyOf(item)));
  if (kept.length === 0) return { kept: [...items], dropped: [] };
  return { kept, dropped: items.filter((item) => nearLimit.has(keyOf(item))) };
}

/**
 * 이 bias 가 "쿼터가 실제 제약이 됐다" 를 뜻하는가.
 *
 * 곡선의 변곡점(잔여 25%)을 넘어 **감점 구간**에 들어왔다는 뜻이다. 이 술어가
 * 필요한 이유는 budget 의 중립값이 0 이 아니기 때문이다 — 잔여가 넉넉해도 +6 이
 * 붙으므로 graphBias 처럼 `!== 0` 으로 "신호 있음" 을 판정하면 쿼터 데이터가
 * 있는 모든 기기에서 항상 참이 된다(= 다양성 회전이 영구 사망).
 */
function budgetIsConstraining(bias: number | null): boolean {
  return typeof bias === "number" && bias < 0;
}

/**
 * Cost-efficiency score for the patent claim 9 비용효율지표.
 *
 * Two-tier:
 *   1. Subscription-aware (Claude Max, ChatGPT Plus 등): 사용자가
 *      `~/.marblo/subscription-plans.json` 에 등록한 모델은 한도 내에서
 *      incremental cost = 0 → 비용효율을 MAX 로 부여. 토큰 단가 기반
 *      모델보다 항상 우위.
 *   2. Per-token (default): 기존 `COST_EFFICIENCY_WEIGHT` 테이블 기반,
 *      cheap-workload tags (simple-fix 등) 가 amplify, expensive-workload
 *      tags (architecture 등) 가 dampen.
 *
 * 결과 값: 0 ~ COST_EFFICIENCY_MAX (역할/부하 매칭이 항상 dominant).
 */
export function costEfficiencyScore(model: ModelType, tags: string[]): number {
  // Tier 1: 사용자가 이 모델을 구독제로 등록했으면 cost-eff = MAX.
  // 한도 초과 (overage 모드) 인지는 dispatch 시점에 알 수 없으므로 보수적으로
  // "구독 = 한도 내" 가정. 한도 초과 빈도가 잦으면 사용자가 plan 을 지우면 됨.
  if (hasSubscriptionPlan(model)) {
    return COST_EFFICIENCY_MAX;
  }

  // Tier 2: per-token rate 기반 (기존 동작)
  const base = COST_EFFICIENCY_WEIGHT[model] ?? COST_EFFICIENCY_WEIGHT.custom;
  // ★어휘는 `workload-tags.ts` 한 벌이다 — 2층 칸 선택(`model-autoselect`)이
  // 같은 목록을 읽는다. 종전엔 여기 인라인 리터럴뿐이라 2층이 같은 판단을
  // 하려면 목록을 베껴야 했고, 베낀 목록은 말없이 갈라진다.
  let multiplier = 1.0;
  for (const tag of tags) {
    const workload = classifyWorkloadTag(tag);
    if (workload === "cheap") {
      multiplier += 0.3;
    } else if (workload === "heavy") {
      multiplier -= 0.3;
    }
  }
  multiplier = Math.max(0, multiplier);
  return Math.min(COST_EFFICIENCY_MAX, Math.round(base * multiplier));
}

// ── Subscription plan loader (cost-tracker 와 동일 파일 공유) ────

interface SubscriptionPlanEntry {
  modelPrefix: string;
  monthlyFlatUsd: number;
  monthlyTokenAllowance?: number;
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

const SUBSCRIPTION_PLANS_FILE = path.join(
  os.homedir(),
  ".marblo",
  "subscription-plans.json",
);

let _subPlanCache: SubscriptionPlanEntry[] | null = null;
let _subPlanMtime = 0;

function loadSubscriptionPlans(): SubscriptionPlanEntry[] {
  try {
    if (!fs.existsSync(SUBSCRIPTION_PLANS_FILE)) {
      _subPlanCache = [];
      return [];
    }
    const stat = fs.statSync(SUBSCRIPTION_PLANS_FILE);
    if (_subPlanCache && stat.mtimeMs === _subPlanMtime) return _subPlanCache;
    const raw = fs.readFileSync(SUBSCRIPTION_PLANS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SubscriptionPlanEntry[];
    _subPlanCache = Array.isArray(parsed) ? parsed : [];
    _subPlanMtime = stat.mtimeMs;
    return _subPlanCache;
  } catch {
    _subPlanCache = [];
    return [];
  }
}

/**
 * 사용자가 이 모델을 구독제로 등록했는지 확인. 모델 ID 가 plan 의
 * modelPrefix 로 시작하면 매치. cost-tracker 의 findPricing 과 동일 파일을
 * 읽으므로 두 모듈이 같은 view 를 공유.
 *
 * Note: ModelType ("claude" / "gemini" / "gpt") 는 dispatch 단계에서만
 * 알 수 있는 거친 카테고리 — 사용자가 등록한 prefix (예: "claude-opus") 가
 * 어떤 ModelType 에 속하는지는 prefix 의 첫 토큰으로 매칭.
 */
function hasSubscriptionPlan(model: ModelType): boolean {
  const plans = loadSubscriptionPlans();
  if (plans.length === 0) return false;
  // modelPrefix 의 첫 토큰을 ModelType 으로 매핑
  // "claude-opus" → "claude", "gpt-5" → "gpt", "gemini-2.5" → "gemini"
  const modelTokenMap: Record<string, ModelType> = {
    claude: "claude",
    gemini: "gemini",
    gpt: "gpt",
    o3: "gpt",
    o4: "gpt",
    antigravity: "antigravity",
    agy: "antigravity",
  };
  for (const p of plans) {
    const firstToken = p.modelPrefix.split(/[-_.]/)[0].toLowerCase();
    if (modelTokenMap[firstToken] === model) return true;
  }
  return false;
}

// ── Model strengths for heterogeneous scoring ───────────────

export const MODEL_TAG_BONUSES: Record<string, Record<string, number>> = {
  claude: {
    // Strong but not crushing — leave room for Codex/Grok/Gemini to win on
    // evidence-backed peers or their own specialty tags.
    architecture: 25,
    "multi-file": 25,
    coding: 22,
    design: 20,
    mcp: 20,
    refactor: 20,
  },
  gemini: {
    "large-context": 30,
    research: 25,
    analysis: 20,
    documentation: 20,
    "fast-response": 15,
  },
  gpt: {
    // General coding should be a Claude/Codex tie-band, not a Claude lock:
    // SWE-bench Pro has gpt-5.6-sol close enough to Opus 4.8 that the live
    // budget/diversity signals should decide borderline coding tasks.
    coding: 20,
    github: 25,
    "simple-fix": 25,
    "quick-edit": 20,
    "fast-execution": 20,
    test: 15,
    boilerplate: 15,
  },
  // Grok's bonuses are scoped to the axis where it has actually produced work.
  // Live observation (fleet log): grok drives orchestration, simple edits and
  // open-ended/creative work fine, but **complex in-repo coding runs ended with
  // no output**. It used to also carry multi-file / complex-edit / refactor
  // bonuses (15 each), which is the one place that record contradicts: with
  // `complex-edit` it won outright (grok 66 vs claude 52) because Claude has no
  // bonus on that tag. Those three are removed — not down-weighted — because
  // there is no evidence behind them, and a spawn on that axis costs a whole
  // ticket's rework. coding (20) stays: it only ties Claude/Codex into the
  // tie-band rotation, it never dominates.
  grok: {
    coding: 20,
    agentic: 20,
    autonomous: 15,
  },
  antigravity: {
    // Antigravity (agy) is purpose-built for multi-step autonomous flows
    // with sub-agents. Strong on agentic / autonomous tags, secondary on
    // research/documentation (shared with Gemini, weaker bonus since
    // Gemini is the established research workhorse).
    agentic: 30,
    "multi-agent": 25,
    autonomous: 25,
    research: 15,
    documentation: 15,
  },
};

export const MODEL_TAG_PENALTIES: Record<string, Record<string, number>> = {
  gemini: { "multi-file": -10, "complex-edit": -10 },
  gpt: { architecture: -10, "large-refactor": -10 },
};

/**
 * 한 모델의 태그 가점이 **몇 개까지** 서로 독립한 근거로 세어지나.
 *
 * ── 무엇이 문제였나 (라이브 측정 2026-08-13, 티켓 sgeSFIh6NAnNHKMIRNpf) ──
 * 태그 가점은 **상한 없이 그냥 더해졌다.** 그래서 한 모델 열에서 태그 3개가
 * 맞으면 그 모델이 다른 축 전부를 합친 것보다 큰 리드를 갖는다:
 *
 *   tags=["architecture","multi-file","coding"]  (오케 스킬이 "복잡한 코딩"에
 *   달라고 지시하던 그 세트) →  claude 25+25+22 = **72**, grok 20, gpt 20−10.
 *   총점 claude 123 vs grok 68 vs gpt 59 — 격차 55.
 *
 * 이 격차는 `TIED_SCORE_BAND`(5)는 물론이고 **다른 모든 축의 사거리 밖**이다:
 * budgetBias 는 ±16, graphBias 는 ±20, costEff 는 ~12 다. 즉 claude 쿼터가 1%
 * 남아도, 지식그래프가 이 맥락에서 claude 실패를 학습해 뒀어도, 그 태그 세트가
 * 붙은 순간 1층은 **claude 100%** 로 고정된다(300회 스코어링 실측). 2층은 정상
 * 작동하는데(무태그 standard 에서 opus5 는 14%뿐) 1층이 claude 를 잠그고 같은
 * 태그가 2층 workloadIntensity 까지 최댓값으로 밀어 opus5 86% 가 된다.
 *
 * ── 왜 포화인가 ─────────────────────────────────────────────────────────
 * 2층은 이미 같은 실패모드를 `model-autoselect.WORKLOAD_TAG_SATURATION` 으로
 * 막아 뒀고 그 주석이 이유를 적어 뒀다 — "한 개로 축이 최대가 되면 태그 하나
 * 오타·습관이 라우팅을 끝까지 밀어 버린다. 서로 동의하는 태그 2개는 실제
 * 신호다." **같은 태그 목록을 읽는 1층에만 그 포화가 없었다.**
 *
 * 태그는 사람이 티켓마다 새로 재는 값이 아니라 오케가 한 번 정한 편집 행위다.
 * 그러니 태그 **개수**는 독립 근거가 아니다. 가장 강한 매치는 온전히 세고,
 * 둘째는 절반만 세고, 셋째부터는 세지 않는다 — "이건 설계 작업이다" 를 세 가지
 * 말로 반복한 것이 세 개의 사실이 되지 않게.
 *
 * ★가점을 **깎는 것이 아니다**: 단일 태그 dispatch 는 비트 단위로 종전과 같고
 * (`saturatedTagBonus([25]) === 25`), 여러 태그일 때도 최강 매치는 그대로 남는다.
 * 바뀌는 것은 "리드가 다른 축의 사거리 안에 머무는가" 하나다. 위 세트에서
 * claude 는 여전히 이기지만(88.5 vs 68) 격차가 20.5 라, 쿼터가 마르거나 그래프가
 * 반대를 학습하면 실제로 뒤집힌다.
 */
export const TAG_BONUS_SATURATION = 2;

/**
 * 한 모델이 받은 태그 가점들을 포화 합산한다(강한 순으로 1, 1/2, 그 이후 0).
 *
 * 감점(`MODEL_TAG_PENALTIES`)에는 적용하지 않는다 — 포화가 막으려는 것은 "근거
 * 없이 커지는 리드" 이고, 감점은 리드를 만들지 않는다. 게다가 감점을 포화시키면
 * "이 모델은 이 축에서 두 번 약하다" 는 관측을 우리가 지우는 셈이 된다.
 */
export function saturatedTagBonus(matched: readonly number[]): number {
  const sorted = [...matched].sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(sorted.length, TAG_BONUS_SATURATION); i++) {
    total += sorted[i] / (i + 1);
  }
  return total;
}

// Base scores raised for Gemini and GPT so they compete on their own
// tags instead of being shut out by Claude's larger baseline. The
// previous 50/40/35 spread meant a "research" task scored gemini 40+20=60
// vs claude 50+0=50 — a real lead — but a "simple-fix" task scored
// gpt 35+15=50, tied with claude 50, and the iteration order picked
// claude every time.
export const MODEL_BASE_SCORE: Record<string, number> = {
  claude: 50,
  gemini: 45,
  gpt: 45,
  // Antigravity: same base as Gemini/GPT — proves itself via tag bonuses
  // for agentic workloads rather than being shoo-in for everything.
  antigravity: 45,
  grok: 45,
  // Local: capability varies with the loaded weights, so we anchor below
  // the hosted-model tier. User can override via custom command + tags.
  local: 35,
  custom: 30,
};

// When the top model wins by less than this many points, treat it as
// effectively tied and round-robin among the close contenders. Keeps
// the model fleet diverse on borderline tasks instead of always
// snapping to Claude.
const TIED_SCORE_BAND = 5;

// ── Model Presets ──────────────────────────────────────────

export type ModelPreset =
  | "auto"
  | "cost-saver"
  | "balanced"
  | "claude-only"
  | "codex-only"
  | "grok-only"
  | "antigravity-only";

// ★A preset is the ONLY live source of dispatch candidates.
//
// `BridgeServer.dispatchTask` resolves enabledModels as
//   request body → per-project lookup → resolvePreset(MARBLO_MODEL_PRESET).
// The middle link is dead wiring: main.ts's `orchestratorSession:launch`
// handler accepts `enabledModels`, but preload's launch() has no such
// parameter and nothing in src/ ever sets it — so `projectEnabledModels` is
// permanently empty. With no saved preset either, every live dispatch runs on
// `recommended`. That is why a harness missing from these lists never spawns:
// it isn't losing the score, it never enters the competition.
//
// Grok was exactly that dead cell — registered in model-registry (verified),
// on the ladder, with tag bonuses, base score, an orchestrator setting and a
// harness-catalog "recommended" row, yet present in no multi-model preset.
// Measured live (dist-electron, 200 dispatch scorings per row): grok 0% across
// every tag set and complexity.
//
// Adding it is safe by construction: `filterAvailableHarnesses` drops an
// unauthenticated/uninstalled harness BEFORE scoring (preserving duplicates),
// so on a machine without `grok login` the resulting mix is byte-identical to
// the old table. The change only takes effect once grok can actually spawn.
/**
 * ★한 프리셋이 라우팅에 거는 것은 **두 가지뿐**이다.
 *
 *   `models` — 1층(하네스) 후보집합. **중복 항목이 곧 고정 가중치**다: 태그가
 *     없는 dispatch(오케 기본 경로)는 `scoreModelsDetailed` 의 순수 round-robin
 *     분기를 타는데, 그 회전 목록이 중복을 그대로 보존하기 때문이다.
 *   `budgetUsedFloorPercent` — 2층(`model-autoselect`)이 볼 **최소 소진율**.
 *     아래 cost-saver 주석 참고. 없으면(=대부분) 2층은 실측 잔여만 본다.
 *
 * 그 외의 모든 것(태그 적합, 실단가, SWE, 잔여쿼터, 주간한도, 사용량, 지식그래프,
 * 다양성)은 프리셋이 정하지 않는다 — 매 dispatch 마다 근거로 계산된다. 그래서
 * "추천"이 고정 퍼센트일 이유가 없다(그게 `auto` 가 `recommended` 를 대체한 이유다).
 */
export interface ModelPresetEntry {
  label: string;
  models: ModelType[];
  description: string;
  /**
   * 2층에 주입할 **소진율 바닥**(0-100). "구독 쿼터를 아껴 쓰라"를 표현하는
   * 유일한 정직한 레버다 — cost-saver 주석 참고.
   */
  budgetUsedFloorPercent?: number;
}

// ★A preset is the ONLY live source of dispatch candidates.
//
// `BridgeServer.dispatchTask` resolves enabledModels as
//   request body → per-project lookup → resolvePreset(MARBLO_MODEL_PRESET).
// The middle link is dead wiring: main.ts's `orchestratorSession:launch`
// handler accepts `enabledModels`, but preload's launch() has no such
// parameter and nothing in src/ ever sets it — so `projectEnabledModels` is
// permanently empty. With no saved preset either, every live dispatch runs on
// the default below. That is why a harness missing from these lists never
// spawns: it isn't losing the score, it never enters the competition.
//
// Grok was exactly that dead cell — registered in model-registry (verified),
// on the ladder, with tag bonuses, base score, an orchestrator setting and a
// harness-catalog "recommended" row, yet present in no multi-model preset.
// Measured live (dist-electron, 200 dispatch scorings per row): grok 0% across
// every tag set and complexity.
//
// Adding a harness is safe by construction: `filterAvailableHarnesses` drops an
// unauthenticated/uninstalled harness BEFORE scoring (preserving duplicates),
// so on a machine without `grok login` the mix falls back to what can spawn.
export const MODEL_PRESETS: Record<ModelPreset, ModelPresetEntry> = {
  /**
   * ★기본값이자 추천. 종전 "Marblo Recommended" 의 고정 60/20/20(실제 표는
   * claude×3 + antigravity + gpt + grok = 50/17/17/17)을 대체한다.
   *
   * 왜 고정 퍼센트를 버리나: 그 숫자는 **아무것도 관측하지 않는다.** claude 주간
   * 한도가 95% 차 있어도, 이번 티켓이 research 태그를 달고 있어도, 지식그래프가
   * 이 맥락에서 gpt 승률을 학습해 뒀어도 50/17/17/17 은 그대로다. 그 신호들은
   * 전부 이미 스코어러 안에 있다(#841 사용량·주간한도·다양성, #853 잔여쿼터).
   * 프리셋이 할 일은 "누가 경쟁에 들어오나" 뿐이고, 승자는 근거가 정한다.
   *
   * 왜 이 셋인가: claude/gpt/grok 만이 **양쪽 층 모두** 근거를 갖는다 —
   * `MODEL_LADDERS` 에 사다리가 있고(2층이 칸을 고를 수 있다), 레지스트리에 실단가·
   * SWE 가 있으며, `getAccountRateLimits` 가 잔여 쿼터를 실제로 프로브한다.
   * env-swap 벤더(MiniMax/GLM/Kimi)는 별도 하네스가 아니라 **claude 사다리의 칸**
   * 이므로 여기 claude 가 있는 것만으로 후보가 된다(2층이 고른다).
   *
   * Antigravity 는 여기 없다 — 사다리·실단가·쿼터 프로브가 셋 다 없어서 2층이
   * 아예 판단하지 못하고(`selectAutoModel` → null = CLI 기본값), 1층에서도 잔여
   * 쿼터 신호가 안 붙는다. 근거 기반 프리셋의 기본값에 근거 없는 칸을 끼우면
   * 그 자리에서만 라우팅이 눈을 감는다. Balanced / 전용 프리셋에는 그대로 있다.
   */
  auto: {
    label: "Auto (Marblo Recommended)",
    models: ["claude", "gpt", "grok"],
    description:
      "Evidence-based smart routing — no fixed percentages. Each dispatch scores tags, live quota headroom, weekly token limits, observed usage and the routing graph, then picks both the harness and the rung. Claude / Codex / Grok compete; env-swap vendors (MiniMax, GLM, Kimi) ride the Claude ladder.",
  },
  /**
   * "비용절감". env-swap 벤더는 **별도 하네스가 아니므로** 1층 후보목록으로는
   * 표현할 수 없다 — 레버는 2층에 있어야 한다.
   *
   * ★단가 가중치를 키우는 방식은 역효과다. `subscriptionCostScaleForHeadroom` 은
   * 잔여가 넉넉한 구독(claude/codex/grok)의 effective 단가를 0.02배로 깎는다 —
   * 이미 낸 정액권의 한계비용이 0 이라는 정직한 계산이다. 그 위에서 단가 민감도만
   * 올리면 종량제인 env-swap 이 **더** 불리해진다.
   *
   * 그래서 레버는 "소진율 바닥"이다: 2층이 구독 잔여를 실측보다 낮게(=아껴야 할
   * 자원으로) 보게 만든다. 그러면 같은 함수 하나로 env-swap 칸이 경쟁력을 얻는다.
   *
   * ★90% 인 이유는 **측정**이다(사다리·레지스트리 실단가로 전 조합 스윕,
   * `tests/unit/model-autoselect.test.ts` 의 "프리셋 소진율 바닥" 블록이 그
   * 관측을 고정한다). 바닥별로 claude 사다리가 실제로 이렇게 움직인다:
   *
   *   바닥     키有 simple/standard        키無 simple/standard      complex
   *   없음     sonnet5 / opus5             sonnet5 / opus5          fable5
   *   80       MiniMax-M2.7 / M2.7         sonnet5 / **opus5**      fable5
   *   85·90    MiniMax-M2.7 / M2.7         sonnet5 / **sonnet5**    fable5
   *   95       MiniMax-M2.7 / M2.7         sonnet5 / sonnet5        **k3-256k**
   *
   * 즉 80 은 벤더 키가 **없는** 기기에서 아무것도 안 바꾸고(=대다수 기기에서
   * "비용절감"이 이름뿐인 프리셋이 된다), 95 는 complex 진입칸(fable5)까지
   * 무너뜨린다 — 어려운 티켓을 약한 칸으로 돌린 실패는 재작업이라 절약분보다
   * 비싸다(FIT_PENALTY 주석과 같은 논리). 90 은 키 유무와 무관하게 절약이
   * 일어나면서 complex 는 지켜지는 유일한 구간이다.
   *
   * ★codex/grok 하네스는 이 바닥으로 **움직이지 않는다**(측정 확인). 그 사다리는
   * 통째로 한 구독이라 더 싼 칸을 골라도 같은 쿼터를 먹는다 — 아낄 자원이 없다.
   * 절약은 claude 사다리(=env-swap 칸이 사는 곳)에서만 일어난다.
   */
  "cost-saver": {
    label: "Cost Saver (spare subscription quota)",
    models: ["claude", "gpt", "grok"],
    budgetUsedFloorPercent: 90,
    description:
      "Same fleet as Auto, but the rung selector treats subscription quota as scarce, so cheap env-swap rungs (MiniMax / GLM / Kimi) win on the Claude ladder. Without vendor API keys it drops to the cheaper native rung (Sonnet instead of Opus) instead. Complex tickets keep the frontier rung either way, and the Codex / Grok ladders are unaffected — one subscription, nothing to spare.",
  },
  /**
   * 전 fleet 균등 회전. Antigravity 가 사는 자리다 — 2층이 판단하지 못하는 칸이라
   * 근거 기반 기본값(`auto`)에서는 뺐지만, 계정이 있으면 쓸 이유는 충분하다.
   */
  balanced: {
    label: "Balanced (whole fleet)",
    models: ["claude", "gpt", "grok", "antigravity"],
    description:
      "Equal rotation across Claude / Codex / Grok / Antigravity. Antigravity has no ladder, pricing or quota probe, so it joins the rotation but the rung selector cannot reason about it (it spawns on the CLI default).",
  },
  "claude-only": {
    label: "Claude 100%",
    models: ["claude"],
    description:
      "All agents use the Claude CLI (highest quality). The rung selector still picks the model inside it, including env-swap vendors when their keys are present.",
  },
  "codex-only": {
    label: "Codex 100%",
    models: ["gpt"],
    description:
      "All agents use OpenAI Codex (model id 'gpt'); the rung selector picks the gpt-5.6 variant and effort.",
  },
  "grok-only": {
    label: "Grok 100%",
    models: ["grok"],
    description: "All agents use xAI Grok Build.",
  },
  "antigravity-only": {
    label: "Antigravity 100%",
    models: ["antigravity"],
    description: "All agents use Google Antigravity (agy).",
  },
};

/** 기본 프리셋 — 저장값·env 가 없거나 알 수 없을 때. */
export const DEFAULT_MODEL_PRESET: ModelPreset = "auto";

/**
 * 폐기된 프리셋 id → 현행 id. 저장된 앱 상태(`appState.modelPreset`)와 env 를
 * 마이그레이션 없이 계속 읽을 수 있게 한다 — 사용자가 고른 적 있는 값이 조용히
 * 기본값으로 되돌아가면 "설정이 안 먹는다"로 보인다.
 */
const LEGACY_PRESET_ALIASES: Readonly<Record<string, ModelPreset>> = {
  // 고정 60/20/20 추천 → 근거 기반 추천.
  recommended: "auto",
};

/** 사용자 지정 프리셋 표기: `custom:claude,gpt,grok`. */
export const CUSTOM_PRESET_PREFIX = "custom:";

/** custom 프리셋에서 고를 수 있는 하네스 축(전용 프리셋이 있는 것들과 같다). */
export const CUSTOM_PRESET_HARNESSES: readonly ModelType[] = [
  "claude",
  "gpt",
  "grok",
  "antigravity",
];

/**
 * `custom:...` 표기를 하네스 배열로. 알 수 없는 토큰은 **버린다**(에러가 아니라)
 * — 하네스가 하나 사라져도 나머지 선택은 살아 있어야 한다. 유효 토큰이 하나도
 * 없으면 null 을 돌려 호출자가 기본 프리셋으로 폴백하게 한다.
 */
export function parseCustomPreset(preset?: string): ModelType[] | null {
  if (!preset || !preset.startsWith(CUSTOM_PRESET_PREFIX)) return null;
  const seen = new Set<ModelType>();
  for (const raw of preset.slice(CUSTOM_PRESET_PREFIX.length).split(",")) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    // "codex"/"agy" 같은 별칭도 그대로 받는다(normalizeModel 이 단일소스).
    const model = normalizeModel(token);
    if (model && CUSTOM_PRESET_HARNESSES.includes(model)) seen.add(model);
  }
  return seen.size > 0 ? [...seen] : null;
}

/** 저장/전달용 custom 프리셋 문자열. */
export function formatCustomPreset(models: ModelType[]): string {
  return `${CUSTOM_PRESET_PREFIX}${models.join(",")}`;
}

/**
 * 프리셋 문자열 → 카탈로그 id. custom 표기는 정규화된 형태로, 알 수 없는 값은
 * 기본값으로 접는다. 저장 경로(`modelPreset:set`)가 이 함수를 지나므로 앱 상태에
 * 쓰레기 문자열이 남지 않는다.
 */
export function normalizePresetId(preset?: string): string {
  const custom = parseCustomPreset(preset);
  if (custom) return formatCustomPreset(custom);
  const key = (preset ?? "").trim();
  if (key in MODEL_PRESETS) return key;
  if (key in LEGACY_PRESET_ALIASES) return LEGACY_PRESET_ALIASES[key];
  return DEFAULT_MODEL_PRESET;
}

export function resolvePreset(preset?: string): ModelType[] {
  const custom = parseCustomPreset(preset);
  if (custom) return custom;
  return MODEL_PRESETS[normalizePresetId(preset) as ModelPreset].models;
}

/**
 * 이 프리셋이 2층에 요구하는 소진율 바닥(없으면 undefined = 실측 그대로).
 * `bridge-server` 가 `selectAutoModel({ minBudgetUsedPercent })` 로 넘긴다.
 */
export function resolvePresetBudgetFloor(preset?: string): number | undefined {
  if (parseCustomPreset(preset)) return undefined;
  return MODEL_PRESETS[normalizePresetId(preset) as ModelPreset]
    .budgetUsedFloorPercent;
}

/** 설정 화면이 그릴 프리셋 카탈로그 한 줄. */
export interface ModelPresetCatalogEntry extends ModelPresetEntry {
  id: ModelPreset;
}

/**
 * 설정 화면용 카탈로그(IPC `modelPreset:list`).
 *
 * ★종전엔 `SettingsPage.PRESETS` 가 이 표를 **2차 하드코딩**하고 있었다. 그 결과
 * 백엔드가 grok 을 편입하고 가중치를 바꾼 뒤에도 화면은 "Claude 60% + Antigravity
 * 20% + Codex 20%" 를 계속 광고했고, `grok-only` 프리셋은 화면에 행 자체가 없어
 * 고를 수 없었다. 목록을 여기서 서빙하면 그 벌어질 자리가 사라진다
 * (`ORCHESTRATOR_HARNESS_OPTIONS` 와 같은 규율).
 */
export function listModelPresets(): ModelPresetCatalogEntry[] {
  return (Object.keys(MODEL_PRESETS) as ModelPreset[]).map((id) => ({
    id,
    ...MODEL_PRESETS[id],
  }));
}

// ── Model alias normalization ───────────────────────────────
//
// The user-facing / orchestrator-facing name for OpenAI's CLI is "Codex"
// (the binary is literally `codex`); there is NO "gpt" CLI. Internally we
// still key everything off the ModelType `"gpt"`, so callers that say
// "codex" (the natural word a user/orchestrator uses) must be folded onto
// "gpt" before any spawn/score logic runs. Same idea for agy → antigravity.
// Folding aliases at the spawn chokepoint (bridge-server) is why an
// explicit "코덱스 스폰해줘" no longer silently mis-routes.
const MODEL_ALIASES: Record<string, ModelType> = {
  claude: "claude",
  codex: "gpt", // ← the important one: Codex CLI == ModelType "gpt"
  gpt: "gpt",
  grok: "grok",
  gemini: "gemini", // retained for back-compat with existing gemini agents
  antigravity: "antigravity",
  agy: "antigravity",
  local: "local",
  custom: "custom",
};

/**
 * Fold a free-form model string (e.g. "codex", "GPT", "agy") onto a canonical
 * ModelType. Returns undefined for unknown input so callers can fall back to
 * tag scoring instead of silently defaulting to a wrong model.
 */
export function normalizeModel(model?: string): ModelType | undefined {
  if (!model) return undefined;
  const key = model.trim().toLowerCase();
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];
  // "gpt-5", "gpt-4.1" 등 구체 모델 슬러그도 Codex(gpt)로 접는다.
  if (key.startsWith("gpt") || key.startsWith("codex")) return "gpt";
  return undefined;
}

// ── Constraints ─────────────────────────────────────────────

export const MAX_AGENTS = 5;
export const MAX_PER_ROLE = 2;

// ── NaN/비유한 방어 유틸 ─────────────────────────────────────
//
// 점수 입력(메트릭)이 결측·undefined·0나눗셈 등으로 NaN/Infinity 가 되면
// 가중합 한 항만 오염돼도 score 전체가 NaN 으로 번지고, 그 NaN 이
// results.sort 비교자 `(a, b) => b.score - a.score` 에 들어가면 비교 결과가
// NaN → 정렬 순서가 미정의가 돼 잘못된 에이전트가 선택된다. 모든 점수 성분을
// 합산 전에 이 가드로 통과시켜 유한수만 스코어링/정렬에 들어가게 한다.
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

// ── Scoring: existing agents ────────────────────────────────

export function scoreAgents(
  agents: AgentInfo[],
  role: string,
  preferredModel?: ModelType,
  tags: string[] = [],
  budgets?: ModelBudgetSnapshot,
): ScoredAgent[] {
  const results: ScoredAgent[] = [];

  for (const agent of agents) {
    // Patent 청구항 9 [식 1]: 매칭점수 = (w1 × 역할매칭) + (w2 × 부하균등)
    //                                 + (w3 × 비용효율) + 보조 신호.
    // 역할 미매치는 hard gate (지표 = 0 → score = 0 → 사실상 filter out).
    const rIdx = roleMatchIndex(agent, role);
    if (rIdx === 0) continue;

    // 메트릭은 합산 전에 NaN/Infinity 가드를 통과시킨다. 비유한값이 한 항만
    // 섞여도 score 전체가 NaN 이 되어 정렬을 망가뜨린다. loadBalanceIndex 는
    // default 로 이미 유한값을 보장하지만 방어적으로 한 번 더 감싼다.
    const lIdx = finiteOr(loadBalanceIndex(agent), 0);
    const cIdx = finiteOr(costEfficiencyScore(agent.model, tags), 0);
    const budget = budgetBiasScore(agent.model, budgets);
    if (budget.bias === null) continue;
    const bIdx = finiteOr(budget.bias, 0);

    // Core: w1·역할 + w2·부하균등 + w3·비용효율 (특허 [식 1])
    let score =
      WEIGHTS.role * rIdx +
      WEIGHTS.loadBalance * lIdx +
      WEIGHTS.costEfficiency * cIdx +
      bIdx;

    const reasons: string[] = [
      `role=${role} (w1·${WEIGHTS.role}=${WEIGHTS.role * rIdx})`,
      `load=${agent.status} (w2·${lIdx}=${WEIGHTS.loadBalance * lIdx})`,
    ];
    if (cIdx > 0) {
      reasons.push(`cost-eff +${WEIGHTS.costEfficiency * cIdx}`);
    }
    reasons.push(budget.reason);

    // Reuse bonus — 기존 에이전트 재활용은 PTY 부팅/컨텍스트 재구축 비용을
    // 회피하므로 새 spawn (MODEL_BASE_SCORE 45-50) 보다 거의 항상 우위에
    // 서야 함. WEIGHTS.reuseBonus 가 그 격차를 명시적으로 보장.
    score += WEIGHTS.reuseBonus;
    reasons.push(`reuse +${WEIGHTS.reuseBonus}`);

    // 보조 1: 사용자가 명시한 선호 모델
    if (preferredModel && agent.model === preferredModel) {
      score += WEIGHTS.modelPreference;
      reasons.push(
        `model=${preferredModel} matched (+${WEIGHTS.modelPreference})`,
      );
    }

    // 보조 2: 에이전트 이름 태그가 task 태그와 일치 (예: "backend-auth")
    const agentTags = agent.name.split("-").map((t) => t.toLowerCase());
    let tagMatches = 0;
    for (const tag of tags) {
      if (agentTags.includes(tag.toLowerCase())) {
        score += WEIGHTS.tagBonus;
        tagMatches++;
      }
    }
    if (tagMatches > 0) {
      reasons.push(
        `${tagMatches} tag(s) matched (+${tagMatches * WEIGHTS.tagBonus})`,
      );
    }

    // 보조 3: 재시작 페널티 (음수 가중치). restartCount 가 NaN/비유한이면
    // 페널티를 더하지 않는다(곱셈이 NaN 으로 번지는 것을 차단).
    if (Number.isFinite(agent.restartCount) && agent.restartCount > 0) {
      const penalty = agent.restartCount * WEIGHTS.restartPenalty;
      score += penalty; // restartPenalty 자체가 음수
      reasons.push(`${agent.restartCount} restart(s) (${penalty})`);
    }

    // 최종 방어: 위 성분 가드를 모두 통과해도 어떤 경로로든 score 가 비유한값이면
    // 정렬 비교자를 오염시키므로 이 후보를 제외한다(후보 제외 전략). 정상 입력에선
    // 도달하지 않는 backstop 이지만, NaN 이 정렬·선택에 새어드는 것을 원천 차단한다.
    if (!Number.isFinite(score)) {
      continue;
    }

    results.push({
      agent,
      score,
      reason: `${agent.status} ${agent.model} agent '${
        agent.name
      }' (score=${score}: ${reasons.join(", ")})`,
    });
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Scoring: best model for new spawn ───────────────────────

// Round-robin counter for model selection when tags don't differentiate
let modelRoundRobin = 0;

// §C: complexity→provider 소프트 라우팅. 쉬운(simple) 작업에서 antigravity
// 활용도를 점진적으로 높이기 위한 env-tunable 가점. `MARBLO_AGY_SIMPLE_BIAS`
// (기본 "0" = off → 무회귀). 양수면 그만큼 antigravity 점수에 더한다. 작은 값
// (예: 6~10)이면 claude(50)와 tie-band 안에서 round-robin = "조금씩" 활용,
// 큰 값(예: 20)이면 simple 에서 antigravity 가 우위. 명시 model 힌트는 호출부
// (selectedModel = model || scoreModels)에서 이미 우선되므로, 여기 도달 = 힌트
// 없음. antigravity 가 enabledModels 에 없으면 0(없는 걸 편애하지 않음).
export function resolveSimpleAgyBias(): number {
  const n = Number((process.env.MARBLO_AGY_SIMPLE_BIAS || "0").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function simpleAgyBias(
  complexity: "simple" | "standard" | "complex" | undefined,
  enabledModels: ModelType[],
): number {
  if (complexity !== "simple") return 0;
  if (!enabledModels.includes("antigravity")) return 0;
  return resolveSimpleAgyBias();
}

// ── Per-model score breakdown (dispatch decision telemetry) ──
//
// scoreModels() collapses the model competition down to a single winner, but
// the *why* (each model's component scores + how the winner was picked) is the
// signal the dispatch-decision telemetry needs to answer "어떤 모델을 왜 골랐나".
// scoreModelsDetailed() exposes that breakdown; scoreModels() is now a thin
// wrapper over it (`.selected`) so every existing caller/test is byte-identical.
export interface PerModelScore {
  model: ModelType;
  /** MODEL_BASE_SCORE[model] */
  base: number;
  /**
   * matched MODEL_TAG_BONUSES 의 **포화 합**(≥0) — `saturatedTagBonus`.
   * 단일 매치는 그 값 그대로라 종전과 같고, 여러 매치는 강한 순 1·1/2·0 이다.
   */
  tagBonus: number;
  /** Σ matched MODEL_TAG_PENALTIES (≤0). */
  tagPenalty: number;
  /** costEfficiencyScore(model, tags) — patent claim 9 비용효율지표. */
  costEff: number;
  /** Real-time quota/headroom bias, same ±20 scale as KG graphBias. */
  budgetBias: number;
  /** §C simple→antigravity soft bias (0 unless it applies to this model). */
  agyBias: number;
  /**
   * Live knowledge-graph bias (spec 2026-07-22): learned, decaying prior from
   * observed (context × model) outcomes. Same ±20 scale as budgetBias —
   * coexists as one more additive component, never overrides the role gate /
   * reuse bonus. 0 when no graph passed OR cold start (no regression).
   */
  graphBias: number;
  /** Final weighted total used for ranking. */
  total: number;
}

/** How scoreModels picked the winner among the scored models. */
export type ModelSelectionMode =
  | "empty" // no enabled models → fallback
  | "all-budget-exhausted" // every candidate with budget data is exhausted
  | "top-score" // single clear winner
  | "round-robin-no-tags" // no differentiating signal → rotate for diversity
  | "tie-band-round-robin"; // near-tied top → rotate among contenders

export interface ModelSelection {
  selected: ModelType;
  /** Per-model component breakdown, sorted by total desc. */
  scores: PerModelScore[];
  mode: ModelSelectionMode;
  /** Models within TIED_SCORE_BAND of the top score (the round-robin pool). */
  contenders: ModelType[];
}

/**
 * Score the enabled models and return BOTH the selected model and the full
 * per-model breakdown + selection mode. Side-effect parity with the old
 * scoreModels(): the module-level round-robin counter advances exactly once
 * per call in the two round-robin branches (so repeated calls rotate
 * identically). Pure aside from that counter.
 */
export function scoreModelsDetailed(
  enabledModels: ModelType[],
  tags: string[],
  complexity?: "simple" | "standard" | "complex",
  budgets?: ModelBudgetSnapshot,
  ctx?: GraphContext,
  graph?: RoutingGraph | null,
  /**
   * P2-2 — 프로바이더 → 그래프 model key 들(구체적인 것부터). 주면 그래프를
   * model@effort 해상도로 읽고, 안 주면 프로바이더 키 단일 조회 = 종전 동작.
   * 이 모듈이 직접 해상도를 계산하지 않는 이유: 티어 정책 해석은 `agent-config`
   * (CLI 버전가드·env)의 몫이고, 순수 스코어러가 그걸 import 하면 테스트가
   * 설치된 CLI 에 의존하게 된다. 주입 지점은 bridge-server 다.
   */
  modelKeys?: (model: ModelType) => readonly string[],
): ModelSelection {
  const scored: PerModelScore[] = [];
  let hasTags = tags.length > 0;

  // §C: simple 작업의 antigravity 소프트 가점. 무태그여도 이 가점이 걸리면
  // 아래 "순수 round-robin"(점수 무시) 분기를 우회해 점수 기반 경쟁/타이밴드를
  // 타도록 hasTags 로 취급한다(0 이면 영향 없음 = 무회귀).
  const agyBias = simpleAgyBias(complexity, enabledModels);
  if (agyBias > 0) hasTags = true;

  for (const model of enabledModels) {
    const base = MODEL_BASE_SCORE[model] || 0;
    let tagBonus = 0;
    let tagPenalty = 0;

    // Custom models use base score only (no tag bonuses/penalties).
    if (model !== "custom") {
      const bonuses = MODEL_TAG_BONUSES[model] || {};
      // ★가점은 모아서 **포화 합산**한다(TAG_BONUS_SATURATION 주석). 단순 가산은
      // 동의어 태그 3개를 독립 근거 3개로 세어 다른 축 전부의 사거리 밖으로
      // 리드를 키운다 — 그게 opus 편중의 1층 기전이었다.
      const matched: number[] = [];
      for (const tag of tags) {
        if (bonuses[tag]) {
          matched.push(bonuses[tag]);
          hasTags = true;
        }
      }
      tagBonus = saturatedTagBonus(matched);
      const penalties = MODEL_TAG_PENALTIES[model] || {};
      for (const tag of tags) {
        if (penalties[tag]) {
          tagPenalty += penalties[tag];
          hasTags = true;
        }
      }
    }
    // Cost-efficiency component (patent claim 9: 비용효율지표). Adds a
    // small per-model bonus so cheaper models break ties on tasks where
    // expensive-model strengths don't apply. Same function as scoreAgents
    // for consistency between reuse and fresh-spawn paths.
    const costEff = costEfficiencyScore(model, tags);
    const budget = budgetBiasScore(model, budgets);
    if (budget.bias === null) continue;
    // ★쿼터 압박은 아래 "무태그 → 순수 round-robin" 분기를 우회한다.
    //
    // 라이브 측정(2026-08-01)에서 나온 결함: 태그 없는 dispatch(오케 기본 경로)는
    // hasTags=false 라 **점수를 통째로 무시**하고 회전만 했다. 그래서 claude 잔여가
    // 1% 여도(bias -16) claude 가 3분의 1 확률로 계속 뽑혔다 — budget 을 계산해
    // 놓고 버린 것이다. 헤드룸 0~99% 전 구간에서 분포가 한 톨도 안 변했다.
    //
    // graphBias·agyBias 에는 이미 같은 탈출구가 있다(바로 아래/위). budget 에만
    // 없었다. 다만 `!== 0` 이 아니라 **감점 구간일 때만** 연다: 잔여가 넉넉하면
    // +6 이 상시로 붙어 있어서 `!== 0` 로 열면 다양성 회전이 영구히 죽는다.
    // 즉 잔여 25% 밑으로 내려간 후보가 하나라도 있을 때만 회전을 멈추고 점수
    // 경쟁으로 간다. 그 위에서는 종전과 완전히 동일하다(무회귀).
    if (budgetIsConstraining(budget.bias)) hasTags = true;
    // §C: simple → antigravity 소프트 가점(0 이면 no-op).
    const thisAgyBias = model === "antigravity" ? agyBias : 0;
    // Live knowledge-graph learned prior (spec 2026-07-22). Same additive
    // pattern as budgetBias — one more ±20 component. 0 when no graph/ctx or
    // cold start, so this is a strict no-op until real outcomes accumulate.
    const graphBias =
      ctx && graph
        ? finiteOr(
            graphBiasForModel(modelKeys?.(model) ?? model, ctx, graph),
            0,
          )
        : 0;
    // A learned graph signal (even with no task tags) should route through the
    // score-based competition / tie-band instead of the tag-blind round-robin,
    // so the graph's lean is actually honored. Cold start (all 0) leaves
    // hasTags untouched → exactly current behavior (no regression).
    if (graphBias !== 0) hasTags = true;

    const rawTotal =
      base +
      tagBonus +
      tagPenalty +
      costEff +
      budget.bias +
      thisAgyBias +
      graphBias;
    // 방어: 비유한 점수는 아래 정렬/타이밴드 비교(topScore - s.total)를
    // 오염시키므로 0 으로 대체. 정상 입력에선 항상 유한값이라 no-op 이다.
    scored.push({
      model,
      base,
      tagBonus,
      tagPenalty,
      costEff,
      budgetBias: budget.bias,
      agyBias: thisAgyBias,
      graphBias,
      total: finiteOr(rawTotal, 0),
    });
  }

  if (scored.length === 0) {
    const anyBudgetData = enabledModels.some((m) => {
      const used = budgets?.[m]?.usedPercent;
      return typeof used === "number" && Number.isFinite(used);
    });
    return {
      selected: enabledModels[0] || "claude",
      scores: [],
      mode:
        enabledModels.length > 0 && anyBudgetData
          ? "all-budget-exhausted"
          : "empty",
      contenders: [],
    };
  }

  scored.sort((a, b) => b.total - a.total);
  const topScore = scored[0].total;
  const contenders = scored
    .filter((s) => topScore - s.total <= TIED_SCORE_BAND)
    .map((s) => s.model);

  // No tags at all → pure round-robin across enabled models for diversity.
  if (!hasTags && scored.length > 1) {
    const scoredModels = new Set(scored.map((s) => s.model));
    const roundRobinModels = enabledModels.filter((m) => scoredModels.has(m));
    const idx = modelRoundRobin % roundRobinModels.length;
    modelRoundRobin++;
    return {
      selected: roundRobinModels[idx],
      scores: scored,
      mode: "round-robin-no-tags",
      contenders,
    };
  }

  // Tied / near-tied at the top → round-robin among the contenders so we
  // don't always snap to whichever happened to be listed first. Without
  // this, a `simple-fix` tag that ties Claude and GPT (both at 70 in the
  // updated bonuses) would always pick Claude due to enabledModels order.
  if (contenders.length > 1) {
    const idx = modelRoundRobin % contenders.length;
    modelRoundRobin++;
    return {
      selected: contenders[idx],
      scores: scored,
      mode: "tie-band-round-robin",
      contenders,
    };
  }

  return {
    selected: scored[0].model,
    scores: scored,
    mode: "top-score",
    contenders,
  };
}

export function scoreModels(
  enabledModels: ModelType[],
  tags: string[],
  complexity?: "simple" | "standard" | "complex",
  budgets?: ModelBudgetSnapshot,
): ModelType {
  return scoreModelsDetailed(enabledModels, tags, complexity, budgets).selected;
}

// ── Worktree isolation gate (dispatch reuse / restart) ──────
//
// Reuse (idle agent) and restart (stopped agent) both re-use an EXISTING PTY
// in its current cwd — neither path routes through WorktreeCoordinator.prepare()
// the way a fresh spawn does. So when a dispatch targets an isolated worktree
// (~/.marblo/worktrees/<projectId>/<taskId>) but the candidate agent is sitting
// elsewhere — the main checkout, or another task's worktree — re-using it runs
// the work in the WRONG tree and pollutes it (proven: a stale wt reuse risked
// polluting the main checkout). dispatchTask uses this to drop such candidates
// so it falls through to a coordinator-routed fresh spawn, which lands in the
// correct worktree.
//
// Returns true when the candidate is SAFE to reuse for this target:
//   - no projectId OR no taskId → no concrete worktree to isolate against, so
//     reuse stays unrestricted (preserves non-isolated dispatch — no regression).
//   - otherwise → only when the agent's cwd IS the target worktree, i.e. its
//     path ends with <projectId>/<taskId> (same suffix the WorktreeCoordinator
//     uses to identify an existing worktree). Unknown cwd → treated as a
//     mismatch so we err toward a fresh, correctly-isolated spawn.
export function isWorktreeIsolated(
  agentCwd: string | undefined,
  projectId: string | undefined,
  taskId: string | undefined,
): boolean {
  if (!projectId || !taskId) return true;
  if (!agentCwd) return false;
  const suffix = path.sep + path.join(projectId, taskId);
  return agentCwd.endsWith(suffix);
}

// ── Plan-based concurrency cap (M2) ─────────────────────────
//
// Source-of-truth: src/lib/planLimits.ts (renderer). The renderer enforces
// this on user-initiated spawns (agentStore.createAgent / launchAgent, and
// LanesTab re-add cbd5500). The BACKEND dispatch/spawn paths (MCP spawn_agent,
// HTTP /dispatch-task) historically bypassed it once the old MAX_AGENTS /
// MAX_PER_ROLE caps were removed — so a free/pro user (or a runaway auto-
// dispatch) could fan out past their plan and drain credits. We re-apply the
// SAME free=2 / pro=5 ceiling here, electron-local (electron code doesn't
// import from src/, so we mirror the table instead of importing it — keep the
// two in sync; the values are the SKU matrix, master plan §2.2).
//
// "Active" = idle | working (a live PTY consuming resources). stopped / error
// don't count — they're already free and re-counting would punish recovery.
// -1 means unlimited.
export const AGENT_CONCURRENCY_LIMIT: Record<string, number> = {
  free: 2,
  pro: 5,
  team: -1,
  team_plus: -1,
  enterprise: -1,
};

const PLAN_ACTIVE_STATUSES: AgentStatus[] = ["idle", "working"];

/** Concurrency limit for a plan. Unknown / undefined / future plans → -1
 * (unlimited), so an unresolved plan never *false-blocks* a legitimate spawn. */
export function getPlanAgentLimit(plan: string | undefined): number {
  if (!plan) return -1;
  const limit = AGENT_CONCURRENCY_LIMIT[plan];
  return limit === undefined ? -1 : limit;
}

/** Count agents that currently consume a concurrency slot (idle | working). */
export function countActivePlanAgents(
  agents: ReadonlyArray<{ status: AgentStatus }>,
): number {
  return agents.filter((a) => PLAN_ACTIVE_STATUSES.includes(a.status)).length;
}

// ── Cap whitelist (M2) ──────────────────────────────────────
//
// The orchestrator and system-initiated spawns MUST never be blocked by the
// per-plan cap — if they were, capping a free user would freeze the whole
// fleet (the orchestrator couldn't keep its essential helpers/recovery agents
// running). Exemption is identified by EITHER:
//   1. role ∈ {orchestrator, internal}  — the orchestrator agent itself and
//      internal/logical sub-agents are infrastructure, not billable workers.
//   2. an explicit `system` dispatch flag — set by system-initiated spawns
//      that must proceed regardless of plan (e.g. merge-conflict resolver,
//      mission recovery). User-/worker-initiated dispatches never set it, so
//      they remain subject to the cap (the actual product gate).
// Everything else (role=backend/frontend/test/... with no system flag) is a
// billable worker and IS capped.
export const CAP_EXEMPT_ROLES: ReadonlySet<string> = new Set([
  "orchestrator",
  "internal",
]);

export function isCapExempt(
  role: string | undefined,
  system?: boolean,
): boolean {
  if (system === true) return true;
  if (!role) return false;
  return CAP_EXEMPT_ROLES.has(role.trim().toLowerCase());
}

export interface PlanConcurrencyCheck {
  /** true when the spawn may proceed (under limit OR exempt OR unlimited). */
  allowed: boolean;
  /** true when allowed purely because the request was whitelisted. */
  exempt: boolean;
  active: number;
  limit: number;
  /** Human-readable block reason (only set when allowed === false). */
  reason?: string;
}

/**
 * Gate a NET-NEW active agent (a fresh spawn, or a restart that re-activates a
 * stopped agent) against the plan's concurrency cap. Reuse of an already-active
 * (idle→working) agent adds no slot and should NOT be passed through here.
 *
 * `agents` should be the agents in the same scope the dispatch counts against
 * (e.g. the requesting project's agents) — counted BEFORE the new one is added.
 */
export function checkPlanConcurrency(
  plan: string | undefined,
  agents: ReadonlyArray<{ status: AgentStatus }>,
  opts: { role?: string; system?: boolean },
): PlanConcurrencyCheck {
  const active = countActivePlanAgents(agents);
  const limit = getPlanAgentLimit(plan);

  if (isCapExempt(opts.role, opts.system)) {
    return { allowed: true, exempt: true, active, limit };
  }
  if (limit < 0 || active < limit) {
    return { allowed: true, exempt: false, active, limit };
  }
  const reason =
    plan === "free"
      ? `Free 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성). Pro로 업그레이드하면 5개, Team부터 무제한입니다.`
      : plan === "pro"
        ? `Pro 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성). Team / Team Plus는 무제한입니다.`
        : `현재 플랜은 동시 ${limit}개까지 에이전트를 띄울 수 있습니다 (현재 ${active}개 활성).`;
  return { allowed: false, exempt: false, active, limit, reason };
}

// ── Dispatch constraint checks ──────────────────────────────

export function checkSpawnConstraints(
  agents: AgentInfo[],
  role: string,
): { allowed: boolean; error?: string } {
  const activeAgents = agents.filter(
    (a) => a.status !== "stopped" && a.status !== "error",
  );
  if (activeAgents.length >= MAX_AGENTS) {
    return {
      allowed: false,
      error: `Cannot spawn: max agents reached (${activeAgents.length}/${MAX_AGENTS}). Use kill_agent or cleanup_agents first.`,
    };
  }

  const roleAgents = activeAgents.filter((a) => a.role === role);
  if (roleAgents.length >= MAX_PER_ROLE) {
    return {
      allowed: false,
      error: `Cannot spawn: max agents for role '${role}' reached (${roleAgents.length}/${MAX_PER_ROLE}). Use kill_agent to free a slot.`,
    };
  }

  return { allowed: true };
}

// ── ★재사용 후보 탈락 사유 — 가시성(티켓 ndVIU4glmyuKaXPZrBWa) ──────────────
//
// 왜 필요한가: dispatch 의 reuse 판정은 여러 단계에서 후보를 **말없이**
// 떨어뜨린다 — `scoreAgents` 는 role 불일치·예산완전소진 에이전트를 `continue`
// 로 결과 배열에서 아예 빼버리고(그 에이전트는 이름조차 안 남는다), 남은 후보도
// 쿼터 예비선(near-limit)·모델 불일치·워크트리 격리·태스크 바인딩·점수 미달 중
// 아무 하나에 걸리면 조용히 스킵된다. 그 결과 호출자에게는 "No reusable agent
// found" 한 줄만 남고 **왜 0인지 알 방법이 없었다** — 실측(2026-09-06, 오케
// 세션): 같은 role · idle · 같은 프로젝트인 에이전트 3건이 매번 이 경로로 새
// 스폰을 낳았는데도 사유를 알 길이 없었다("Score: 0" 은 스폰 응답의 고정값이라
// 진짜 원인과 무관 — 아래 참고).
//
// 이 함수들은 스코어링 **결과를 바꾸지 않는다**(행동 무변경) — 호출자가 이미
// 들고 있는 스냅샷을 다시 걸러 탈락 사유 **문자열**만 만든다. 판정 로직은
// `isWorktreeIsolated`(파일 상단)와 같은 소스를 재사용해 두 판정이 갈릴 여지를
// 없앤다.

/** reuse 판정에 실제로 쓰인 값들의 읽기전용 스냅샷. `AgentInfo` 보다 넓다 —
 * 워크트리·태스크 바인딩 게이트가 필요로 하는 `cwd`/`currentTaskId` 를 담는다
 * (그 두 값은 `dispatch-scoring.ts` 밖, `AgentInstance` 에만 있다). */
export interface ReuseCandidateSnapshot {
  name: string;
  role: string;
  model: ModelType;
  status: AgentStatus;
  /** `scoreAgents` 가 이 에이전트를 결과에 넣었을 때의 점수. `scoreAgents` 가
   * role 불일치·예산완전소진으로 애초에 결과에서 뺀 경우는 `undefined` — "점수
   * 미달"과는 다른 원인이므로 구분해야 한다. */
  score?: number;
  cwd: string;
  currentTaskId: string | null;
}

export interface ReuseCandidateVerdict {
  name: string;
  eligible: boolean;
  reason: string;
}

/**
 * 스냅샷 하나를 실제 reuse 필터와 같은 조건으로 걸러 탈락 사유 하나를
 * 만든다. 전부 통과하면 `eligible: true` — 그런데도 호출자가 스폰으로
 * 넘어왔다면 이 함수 밖(호출부 배선)의 버그이고, `summarizeReuseCandidates`
 * 가 그 모순을 눈에 띄게 표시한다.
 */
export function explainReuseCandidate(
  candidate: ReuseCandidateSnapshot,
  opts: {
    role: string;
    model?: ModelType;
    projectId?: string;
    taskId?: string;
    nearLimit?: ReadonlySet<ModelType>;
  },
): ReuseCandidateVerdict {
  const name = candidate.name;
  if (candidate.role !== opts.role) {
    return {
      name,
      eligible: false,
      reason: `role 불일치 (agent=${candidate.role}, 요청=${opts.role})`,
    };
  }
  if (candidate.status !== "idle") {
    return {
      name,
      eligible: false,
      reason: `idle 아님 (status=${candidate.status})`,
    };
  }
  if (opts.nearLimit?.has(candidate.model)) {
    return {
      name,
      eligible: false,
      reason: `쿼터 예비선 이하로 제외됨 (model=${candidate.model})`,
    };
  }
  if (opts.model && candidate.model !== opts.model) {
    return {
      name,
      eligible: false,
      reason: `모델 불일치 (요청=${opts.model}, agent=${candidate.model})`,
    };
  }
  if (!isWorktreeIsolated(candidate.cwd, opts.projectId, opts.taskId)) {
    const expected =
      opts.projectId && opts.taskId
        ? `${path.sep}${path.join(opts.projectId, opts.taskId)}`
        : "(제약 없음)";
    return {
      name,
      eligible: false,
      reason: `워크트리 격리 불일치 (cwd=${
        candidate.cwd || "(없음)"
      }, 기대 접미사=${expected})`,
    };
  }
  if (candidate.currentTaskId && candidate.currentTaskId !== opts.taskId) {
    return {
      name,
      eligible: false,
      reason: `다른 태스크에 바인딩됨 (currentTaskId=${candidate.currentTaskId})`,
    };
  }
  if (candidate.score === undefined) {
    // role·idle·모델·워크트리·태스크 바인딩을 이미 다 통과했으므로, 남은
    // 원인은 `scoreAgents` 가 결과 자체에서 뺀 예산완전소진(budgetBiasScore
    // 의 null 분기)뿐이다.
    return {
      name,
      eligible: false,
      reason: `예산 완전소진으로 점수 산정에서 제외됨 (model=${candidate.model})`,
    };
  }
  if (candidate.score < 100) {
    return {
      name,
      eligible: false,
      reason: `점수 미달 (score=${candidate.score} < 100)`,
    };
  }
  return {
    name,
    eligible: true,
    reason: `재사용 가능 (score=${candidate.score})`,
  };
}

/** 여러 후보를 한 번에 설명한다. 순서는 입력 순서 그대로 — 정렬·요약은
 * `summarizeReuseCandidates` 가 한다. */
export function explainReuseCandidates(
  candidates: readonly ReuseCandidateSnapshot[],
  opts: {
    role: string;
    model?: ModelType;
    projectId?: string;
    taskId?: string;
    nearLimit?: ReadonlySet<ModelType>;
  },
): ReuseCandidateVerdict[] {
  return candidates.map((c) => explainReuseCandidate(c, opts));
}

/**
 * 진단 배열을 응답/로그에 그대로 실을 수 있는 한 문장으로 압축한다.
 * `maxItems` 로 문장 길이를 자른다 — 에이전트 fleet 이 커도 응답이 무한정
 * 길어지지 않게.
 */
export function summarizeReuseCandidates(
  verdicts: readonly ReuseCandidateVerdict[],
  maxItems = 5,
): string {
  if (verdicts.length === 0) {
    return "고려 대상 에이전트 없음(프로젝트/컨텍스트에 후보가 아예 없음)";
  }
  const eligible = verdicts.filter((v) => v.eligible);
  if (eligible.length > 0) {
    // 이 분기가 실제로 찍히면 그 자체가 신호다 — 재사용 가능한 후보가
    // 있었는데 호출부가 스폰으로 넘어갔다는 뜻(배선 버그).
    return (
      `⚠️ 재사용 가능한 후보 ${eligible.length}건이 있었는데 스폰으로 넘어옴 — ` +
      eligible.map((v) => v.name).join(", ")
    );
  }
  const shown = verdicts.slice(0, maxItems);
  const more =
    verdicts.length > shown.length
      ? ` 외 ${verdicts.length - shown.length}건`
      : "";
  return (
    `고려한 후보 ${verdicts.length}건, 재사용 가능 0건 — ` +
    shown.map((v) => `${v.name}: ${v.reason}`).join(" | ") +
    more
  );
}
