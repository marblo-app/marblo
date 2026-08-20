/**
 * 난도→모델 에스컬레이션 사다리 (P3-1, v3/docs/INTELLIGENT-ROUTING-PLAN.md §4).
 *
 * 지금까지 "어느 난도에 무엇을 쓸까"는 `agent-config.modelTierForComplexity` 안의
 * if/else 세 줄이었다. 그래서 (a) 신규 모델을 티어에 끼우려면 코드 분기를 고쳐야
 * 했고, (b) "부족하면 한 단계 위" 라는 상향 재시도가 참조할 **순서** 자체가
 * 코드 어디에도 없었다. 이 파일은 그 순서를 데이터로 만든다.
 *
 * ── 이 파일이 model-registry.ts 와 갈라지는 이유 ─────────────────────────
 * 레지스트리는 스스로 규율을 적어 뒀다 — "사실만 담는다. 정책은 담지 않는다."
 * 모델 id·단가·지원 effort·검증이력은 사실이고, **티어별 순서는 정책**이다.
 * 그래서 사다리는 별 파일에 두고, 모델의 사실은 단 하나도 다시 적지 않는다:
 * 아래 모든 rung 은 `MODEL_REGISTRY` 를 조회해 검증되며(모듈 로드시 throw),
 * 순서 근거인 단가도 레지스트리 행에서 읽는다. 사다리에 없는 id·지원하지 않는
 * effort 를 적으면 앱이 부팅하다 죽는다 — 날조된 칸이 조용히 사는 것보다 낫다.
 *
 * ── ★초기 순서는 실단가 기반이다 ("gpt=저가" 가정 금지) ──────────────────
 * 사내 전제였던 "쉬운 건 gpt(저가), 어려운 건 claude" 는 현 설정에서 거짓이다.
 * 우리 codex 기본 모델은 `gpt-5.5` = $5/$30 로, `claude-sonnet-5`($3/$15)보다
 * **2배 비싸다**(PR#596/#598 확정 단가). 그래서 사다리 순서는 브랜드 감각이
 * 아니라 아래 두 규칙으로만 정했다:
 *
 *   1. **상향 축은 능력등급**(cheap → mid → top → frontier). 사다리를 오르는 건
 *      "더 비싼 걸 쓰자"가 아니라 "더 센 걸 쓰자" 이므로.
 *   2. **같은 능력등급 안에서는 실단가가 싼 모델이 그 칸을 차지한다.**
 *      → gpt top 칸이 `gpt-5.5`($5/$30) 가 아니라 `gpt-5.6-terra`($2.5/$15)인
 *        이유가 이 규칙이다. 능력등급이 같고 단가는 3.5배 싸다.
 *
 * 임계값(“simple 은 luna@low 로 충분한가”)은 여기서 정하지 않는다 — 설계문서 §9
 * 대로 그건 데이터가 쌓인 뒤(P2-4 모델별 효과집계, 8wBiVzwI 그래프)의 판정이다.
 * 이 파일은 **출발 순서**만 준다.
 *
 * ── graphBias 와 싸우지 않는다 (§4 넷-뉴 3) ──────────────────────────────
 * `routing-graph.graphBiasForModel` 은 `ModelType`(=프로바이더: claude/gpt/…)
 * 단위의 ±20 tie-breaker 다. 즉 **프로바이더 선택** 층이고, 이 사다리는 선택된
 * 프로바이더 **안에서의 칸 선택** 층이다. 두 층이 겹치지 않으므로 서로를
 * 덮어쓸 일이 없다. P2-2 가 그래프 cell key 를 `model@effort` 로 올리면 그래프가
 * 이 사다리 안의 선호를 흔들게 되는데, 그때도 그래프는 `usableRungs()` 가
 * 돌려주는 칸 안에서만 흔들어야 한다 — 승인 게이트(아래)를 그래프 편향이
 * 우회하면 비용 상한이 무의미해진다.
 *
 * ── ★승인 게이트 (사장님 결정 2026-07-25) ───────────────────────────────
 * 5.6 계열은 high 위에 `xhigh/max/ultra` 가 더 있다(§1.2 실측). 사장님 지시는
 * "구독형이면 포함하되 자주 쓰지 말고, 오케가 사용자 승인을 받고 쓸 것".
 * 그래서 `max`/`ultra` 칸은 사다리에 **존재하지만 잠겨 있다**: 승인 레코드가
 * 없으면 `gateRung()` 이 그 아래 최고 칸으로 강등한다. 승인은 1회용이고
 * 티켓당 예산이 있다(§4 넷-뉴 2 의 "상향 1회 제한" 과 같은 계정).
 */

import {
  EFFORT_LADDER,
  MODEL_REGISTRY,
  getModel,
  type CapabilityTier,
  type EffortLevel,
  type HarnessId,
  type ModelRate,
  type ModelRegistryEntry,
} from "./model-registry";
import {
  APPROVAL_GATED_EFFORTS,
  EFFORT_NAMES,
  GATED_LADDER_RUNGS,
  MAX_GATED_APPROVALS_PER_TASK,
  approvalBudgetSpent,
  deniedRecordFor,
  isApprovalGatedEffort,
  rungSpecLabel,
  usableApproval as usableApprovalFor,
  type EscalationApprovalRecord,
} from "./mcp-server/escalation-approval";

/**
 * 작업 난도. `agent-config.TaskComplexity` 와 **같은 집합**이며, 그쪽이
 * 컴파일타임 양방향 단언으로 고정한다(레지스트리의 ModelProvider↔ModelType 과
 * 같은 방식). 여기서 agent-config 를 import 하지 않는 이유는 순환 의존
 * (agent-config → model-ladder → agent-config)을 만들지 않기 위해서다.
 */
export type LadderTier = "simple" | "standard" | "complex";

export const LADDER_TIERS: readonly LadderTier[] = [
  "simple",
  "standard",
  "complex",
] as const;

/** 사다리 한 칸. `model` 은 레지스트리 id, `effort` 는 그 모델이 지원하는 값. */
export interface LadderRung {
  /** 레지스트리 구체 id(alias 금지 — 이동표적은 핀이 될 수 없다). */
  model: string;
  /**
   * ★스폰할 바이너리(벤더가 아니다 — USbdRV4k 축분리). 사다리는 "어느 CLI 안에서
   * 어느 칸을 오르나" 의 자료구조라 하네스로 묶인다. 벤더는 칸마다 고정이 아니라
   * 모델의 사실이므로 `rungVendor()` 로 레지스트리에서 읽는다(사실 중복 금지).
   */
  harness: HarnessId;
  /** effort 축이 있는 프로바이더만. claude 계열은 undefined. */
  effort?: EffortLevel;
  /** 이 칸이 왜 여기 있는지(리뷰어가 순서를 검증할 수 있게 근거를 남긴다). */
  why: string;
}

export interface HarnessLadder {
  harness: HarnessId;
  /** 낮은 칸 → 높은 칸. 상향 재시도는 이 배열의 인덱스를 +1 한다. */
  rungs: readonly LadderRung[];
  /** 티어별 **진입 칸**(rung index). 상향은 여기서 시작해 위로 간다. */
  entry: Readonly<Record<LadderTier, number>>;
  /**
   * 이 프로바이더에서 우리가 모델 id 를 **실제로 강제하는가**.
   *
   * claude = true (`--model <id>`).
   * gpt = true — 오늘 codex 스폰은 `-c model=...` 과
   * `-c model_reasoning_effort=...` 를 함께 넘긴다
   * (`agent-config.buildCLICommand` case "gpt"). 그래서 gpt rung 의 `model` 은
   * 실제 서빙되는 모델이고, `inheritedModel` 은 gpt-5.6 변종 도입 전
   * `gpt-5.5@effort` 관측을 그래프 폴백 키로 읽기 위한 호환 축이다.
   */
  pinsModel: boolean;
  /** pinsModel=false 일 때 오늘 실측되는 기본 모델(비용추정·그래프 키 용도). */
  inheritedModel?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 주간 토큰 soft limit — 자동선택 부하분산 정책 (하드 차단 아님)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Claude(Max 계열)·Codex 구독의 **라우팅용** 주간 토큰 한도.
 *
 * 하드 캡이 아니다 — `usage-rollup` / `model-autoselect` 가 한도 근접 시
 * 해당 하네스를 de-prioritize 하고, 여력 있는 fleet(grok·MiniMax env-swap)으로
 * 자연 전환하기 위한 soft 상수다. 계정 rate-limit % 와 max 합성된다.
 *
 * 값은 관측 가능 규모(수천만~억 토큰/주) 감각으로 잡았고, 실측이 쌓이면
 * 이 표만 바꾸면 된다(코드 분기 없음). grok/minimax 는 항목 없음 = 한도 압력 0.
 */
export const HARNESS_WEEKLY_TOKEN_SOFT_LIMIT: Readonly<
  Partial<Record<HarnessId, number>>
> = {
  // Claude Max 급 주간 여유를 soft 상한으로 — 근접 시 opus 편중을 깨고 env-swap/grok 로.
  claude: 80_000_000,
  // Codex / ChatGPT 주간 창 — 근접 시 gpt 칸 하향 + 1층 budget 압력.
  gpt: 60_000_000,
};

/** 하네스 soft 한도. 미등록·0 → undefined(압력 없음). */
export function weeklyTokenSoftLimitForHarness(
  harness: HarnessId | string,
): number | undefined {
  const n = HARNESS_WEEKLY_TOKEN_SOFT_LIMIT[harness as HarnessId] ?? undefined;
  return typeof n === "number" && n > 0 ? n : undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// 비용 지표 — 순서의 근거
// ─────────────────────────────────────────────────────────────────────────

/**
 * 모델 비교용 단가 지표. **입력·출력 단가의 단순 평균**이다.
 *
 * 왜 가중평균이 아닌가: 가중치를 쓰려면 "우리 트래픽의 입출력 토큰 비"라는
 * 숫자가 필요한데 그건 아직 측정되지 않았다(P2-4 `task_outcomes ⋈ cost_logs`
 * 가 낼 값이다). 없는 숫자를 그럴듯하게 박는 것이 설계문서 §9 가 금지한 바로
 * 그 행위이므로, 여기서는 어느 쪽으로도 기울지 않는 중립 프록시를 쓰고
 * **모델 간 상대비교에만** 사용한다. 실측 토큰비가 나오면 이 함수만 교체한다.
 *
 * ★effort 는 단가를 바꾸지 않는다(레지스트리 주석). 같은 모델의 higher effort 가
 * 더 비싼 것은 토큰 수량 때문이므로, 사다리 안에서 effort 상향은 "같은 단가,
 * 더 많은 토큰" 으로 이해해야 한다.
 */
export function blendedCostIndex(pricing: ModelRate): number {
  return (pricing.inputPer1M + pricing.outputPer1M) / 2;
}

/** 레지스트리 id 의 비용 지표(미등록 id 는 undefined). */
export function costIndexForModel(id: string): number | undefined {
  const entry = getModel(id);
  return entry ? blendedCostIndex(entry.pricing) : undefined;
}

const CAPABILITY_ORDER: Readonly<Record<CapabilityTier, number>> = {
  cheap: 0,
  mid: 1,
  top: 2,
  frontier: 3,
};

/**
 * 능력등급이 같은 활성 모델들을 실단가 싼 순으로. 사다리의 각 능력칸에 어느
 * 모델을 앉힐지 정한 근거를 **런타임에 재현**할 수 있게 노출한다(테스트가 이걸로
 * 사다리 데이터를 검증한다 — 근거와 데이터가 따로 놀지 않게).
 */
export function cheapestByCapability(
  harness: HarnessId,
  capability: CapabilityTier,
): ModelRegistryEntry[] {
  return MODEL_REGISTRY.filter(
    (m) =>
      m.harness === harness &&
      m.status === "active" &&
      m.capability === capability,
  ).sort((a, b) => blendedCostIndex(a.pricing) - blendedCostIndex(b.pricing));
}

// ─────────────────────────────────────────────────────────────────────────
// 승인 게이트
//
// ★순수 로직(레코드 복원·예산·1회용 소진·요청 표기 검증)은
// `./mcp-server/escalation-approval.ts` 에 있다. 그쪽에 둔 이유는 MCP 툴
// (`request_model_escalation`/`resolve_model_escalation`)도 같은 규칙을 써야
// 하는데, `electron/mcp-server/tsconfig.json` 이 `rootDir: "."` 이라 MCP 번들은
// 이 파일을 import 할 수 없기 때문이다(반대 방향은 tool-surface.ts 선례대로 열려
// 있다). 여기서는 그 순수 로직에 **모델의 사실**(사다리 순서·강등 대상)을 붙인다.
// ─────────────────────────────────────────────────────────────────────────

export {
  APPROVAL_GATED_EFFORTS,
  MAX_GATED_APPROVALS_PER_TASK,
  approvalBudgetSpent,
  consumeApproval,
  isApprovalGatedEffort,
  readEscalationApprovals,
  type EscalationApprovalRecord,
} from "./mcp-server/escalation-approval";

export function rungNeedsApproval(rung: LadderRung): boolean {
  return isApprovalGatedEffort(rung.effort);
}

/** 이 칸에 쓸 수 있는 **미소진 승인**(정확히 같은 model+effort 만 인정). */
export function usableApproval(
  records: readonly EscalationApprovalRecord[],
  rung: LadderRung,
): EscalationApprovalRecord | undefined {
  return usableApprovalFor(records, rung.model, rung.effort);
}

export type GateOutcome =
  | {
      allowed: true;
      rung: LadderRung;
      /** 게이트를 통과시킨 승인(무게이트 칸이면 undefined). */
      approval?: EscalationApprovalRecord;
    }
  | {
      allowed: false;
      /** 요청한 칸. */
      requested: LadderRung;
      /** 강등해서 실제로 쓸 칸(사다리에 그 아래 칸이 없으면 undefined). */
      rung?: LadderRung;
      reason: "needs-approval" | "approval-denied" | "budget-exhausted";
      /** 사람에게 그대로 보여줄 한 줄. */
      message: string;
    };

/**
 * 요청된 칸을 승인 게이트에 통과시킨다. **거절이 아니라 강등**이 기본값이다 —
 * 상향을 못 해서 한 칸 아래로 도는 것은 손실이 크지 않지만, 스폰 자체가 막히면
 * 티켓이 멈춘다(레지스트리 minCli 게이트와 같은 철학).
 */
export function gateRung(
  requested: LadderRung,
  records: readonly EscalationApprovalRecord[] = [],
): GateOutcome {
  if (!rungNeedsApproval(requested)) return { allowed: true, rung: requested };

  const approval = usableApproval(records, requested);
  if (approval) return { allowed: true, rung: requested, approval };

  const fallback = highestUngatedRungAtOrBelow(requested);
  const label = rungLabel(requested);
  const denied = deniedRecordFor(records, requested.model, requested.effort);
  const exhausted =
    approvalBudgetSpent(records) >= MAX_GATED_APPROVALS_PER_TASK;
  const reason: "needs-approval" | "approval-denied" | "budget-exhausted" =
    denied
      ? "approval-denied"
      : exhausted
        ? "budget-exhausted"
        : "needs-approval";
  const why =
    reason === "approval-denied"
      ? `${label} 는 사용자가 거부했습니다`
      : reason === "budget-exhausted"
        ? `${label} 는 고비용 승인 예산(티켓당 ${MAX_GATED_APPROVALS_PER_TASK}건)을 이미 소진했습니다`
        : `${label} 는 사용자 승인이 필요한 고비용 칸입니다(request_model_escalation 으로 승인 왕복)`;
  return {
    allowed: false,
    requested,
    rung: fallback,
    reason,
    message: fallback
      ? `${why} → ${rungLabel(fallback)} 로 강등합니다.`
      : `${why} → 강등할 하위 칸이 없어 상향을 포기합니다.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 사다리 데이터
//
// ★모든 model id/effort 는 아래 buildLadder() 가 레지스트리와 대조한다.
//   틀린 값은 모듈 로드 시점에 throw — 날조된 칸은 살 수 없다.
// ─────────────────────────────────────────────────────────────────────────

/**
 * claude 사다리. effort 축이 없으므로(레지스트리) 칸 = 모델 하나.
 * **진입칸**(entry.simple/standard/complex) 세 개는 현행 라이브 티어 매핑과
 * **정확히 같다** — sonnet5/opus5/fable5. 이 티켓(hyKsSYYM, 사장님 A안)이
 * 하는 일은 그 옆에 **env-swap 벤더(키 있으면) 칸**을 끼워 넣는 것이지,
 * 진입칸 자체를 옮기는 것이 아니다: "강제 배치 말고 점수가 결정" — env-swap
 * 칸은 각자의 능력등급 그룹 안에서 sonnet5/opus5 **옆**(같은 능력등급, 다른
 * 인덱스)에 앉고, 단가 압도(`model-autoselect.COST_WEIGHT`)가 simple/standard
 * 승부를 실제로 가른다.
 *
 * ★sonnet5→opus5 는 **여전히 인접 칸**(인덱스 차 1)이다 — mid 그룹의 새 칸은
 * 전부 sonnet5 **앞**에, top 그룹의 새 칸은 전부 opus5 **뒤**에 둔다. 그래야
 * (a) 능력등급 비내림차순 불변식(mid…mid,top…top,frontier)이 유지되고
 * (b) 크레덴셜이 없어 env-swap 이 전부 걸러진 기기에서는 `steps = candidate.index
 * - entryIndex` 가 이 티켓 이전과 **비트 단위로 같다** — `candidate.index` 는
 * `autoCandidates()` 가 **필터 이전** 절대 위치로 굳히므로, sonnet5/opus5 사이에
 * 무언가를 끼우면 credential 필터로 그 칸이 나중에 빠지더라도 둘 사이의 거리
 * 자체가 이미 벌어져 있다(무회귀가 아니게 된다) — 그래서 끼우지 않는다.
 * complex 진입칸(fable5) 은 사다리 맨 끝이라 다른 모든 칸이 그 아래라
 * 무거운 `down`(12) 감점을 받는다(complex 하향 비대칭 감점, FIT_PENALTY 주석).
 *
 * ★키 가드는 여기 없다 — **구조적으로 후보다**(승인게이트처럼 사다리에서
 * 자체를 빼지 않는다). 크레덴셜 필터는 호출자 축(`AutoSelectInput.modelAvailable`,
 * `bridge-server.ts` 가 `vendorEnvReadiness(id).ready` 로 이미 배선)에서
 * 런타임에 거른다 — #660 유출 게이트와 이중 안전. 키가 없는 기기에서는 이 칸들이
 * `usable` 목록에서 빠지고 sonnet5/opus5/fable5 만 경쟁한다(무회귀).
 */
const CLAUDE_RUNGS: LadderRung[] = [
  {
    model: "MiniMax-M2.7",
    harness: "claude",
    why: "mid 등급 최저단가($0.3/$1.2, 지표 0.75). sonnet5 **앞**(인덱스가 낮음, down 감점만 받음)이라 simple 단가경쟁에서 압도적으로 유리하다 — 키 있으면(사장님 A안).",
  },
  {
    model: "glm-4.7",
    harness: "claude",
    why: "mid 등급 2번째 최저단가($0.6/$2.2, 지표 1.4). GLM 5.2 의 하위 모델. 키 있으면(사장님 A안).",
  },
  {
    model: "kimi-for-coding",
    harness: "claude",
    why: "mid 등급($0.95/$4.0, 지표 2.475). Kimi K2.7 Code — 플랜 게이트 없이 전 멤버가 쓸 수 있는 칸(k3 시리즈와 달리 Moderato 이상 불필요). 키(KIMI_API_KEY) 있으면(사장님 A안).",
  },
  {
    model: "claude-sonnet-5",
    harness: "claude",
    why: "mid 칸 최저단가($3/$15). haiku($1/$5)가 더 싸지만 현행 simple 바닥이 sonnet5 이고 하향은 이 티켓 범위가 아니다(비용 회귀 가드는 상향만 본다). ★sonnet5 자신은 **진입칸**(entry.simple)이자 opus5 의 바로 앞 칸(인덱스 차 1, 무회귀 보존) — 위 3개 env-swap 칸은 이 칸보다 인덱스가 낮아 시장가 우위만으로 이 칸을 이겨야 한다(강제 배치가 아니다).",
  },
  {
    model: "claude-opus-5",
    harness: "claude",
    why: "top 칸($5/$25). opus-4-8 과 동일단가·동일등급이라 중복 칸을 만들지 않았다. standard 진입점(사장님 결정 2026-07-25). ★sonnet5 의 바로 다음 칸(인덱스 차 1) — 아래 4개 top 등급 env-swap 칸은 전부 이 칸 **뒤**에 둬서 sonnet5↔opus5 거리를 건드리지 않는다.",
  },
  {
    model: "MiniMax-M3",
    harness: "claude",
    why: "top 등급 최저단가($0.6/$2.4, 지표 1.5). SWE-bench Verified 80.5(자체보고) — top 칸(opus5 96.0) 대비 낮아도 standard 경쟁에서 단가 우위가 크다. opus5 **뒤**(up 감점을 받지만 단가차가 압도적이라 이겨도 됨) — 키 있으면(사장님 A안).",
  },
  {
    model: "glm-5.2",
    harness: "claude",
    why: "top 등급($1.4/$4.4, 지표 2.9). Verified 미보고(SWE-bench Pro 62.1 만 발표) — 벤치 비교불가라 능력등급 폴백으로만 opus5 와 겨룬다. 키 있으면(사장님 A안).",
  },
  {
    model: "k3",
    harness: "claude",
    why: "top 등급($3.0/$15.0, 지표 9.0) — opus5(15) 보다는 싸다. SWE-bench 4종 전부 미보고(벤더가 자체 벤치로 전환)라 능력등급 폴백. 키(KIMI_API_KEY, Moderato 이상 플랜) 있으면(사장님 A안).",
  },
  {
    model: "k3-256k",
    harness: "claude",
    why: "k3 와 동일 단가·동일 게이트 — 컨텍스트만 256k. 키 있으면(사장님 A안).",
  },
  {
    model: "claude-fable-5",
    harness: "claude",
    why: "frontier 칸($10/$50) — 우리가 가진 가장 비싼 칸. complex 진입점(현행 유지). 사다리의 다른 모든 칸(env-swap 포함)이 이 칸보다 인덱스가 낮아 complex 에서는 무거운 down(12) 감점을 받는다 — SWE 우위와 무관하게도 하향이 억제된다.",
  },
];

/**
 * gpt(codex) 사다리. ★사장님 지시대로 gpt-5.6 3변종을 **모두** 넣고 난도별로
 * 변주한다 — luna(빠름·저렴)=simple, terra(밸런스)=standard, sol(프론티어)=complex.
 *
 * 각 변종 안에서는 effort 로 세 칸을 올리고, 변종을 넘어갈 때 능력등급이 오른다.
 * 진입 effort(low/medium/high)가 현행 라이브 매핑과 같고, 모델 축도 핀한다.
 *
 * ★"gpt=저가" 가정을 명시적으로 깬 자리: top 칸이 `gpt-5.5`($5/$30)가 아니라
 * `gpt-5.6-terra`($2.5/$15)다. 능력등급이 같고 단가는 3.5배 싸다(지표 8.75 vs
 * 17.5). 그리고 simple 칸의 luna(지표 3.5)조차 `claude-sonnet-5`(9)보다 싸지만,
 * 기존 gpt-5.5 학습은 `inheritedModel` 폴백 키로 남겨 두어, 변종별 새 셀이
 * 차기 관측을 쌓는 동안에도 종전 관측을 잃지 않는다.
 */
const GPT_RUNGS: LadderRung[] = [
  {
    model: "gpt-5.6-luna",
    harness: "gpt",
    effort: "low",
    why: "mid 칸 최저단가($1/$6, 지표 3.5). 5.4-mini 가 더 싸지만 코딩 에이전트 적합성이 미검증이라 진입점으로 쓰지 않는다.",
  },
  {
    model: "gpt-5.6-luna",
    harness: "gpt",
    effort: "medium",
    why: "같은 모델 effort 상향 — 단가 동일, 토큰만 늘어난다(가장 값싼 상향).",
  },
  {
    model: "gpt-5.6-luna",
    harness: "gpt",
    effort: "high",
    why: "mid 칸의 천장. 여기서 부족하면 능력등급을 올린다.",
  },
  {
    model: "solar-pro4",
    harness: "gpt",
    effort: "low",
    why: "Upstage Solar Pro 4 env-swap(OpenAI 호환) mid 칸. 공식 단가 $0.30/$1.20(지표 0.75)으로 gpt mid 중 최저지만, 키 조건부 벤더라 luna 진입칸 자체는 옮기지 않고 점수가 결정한다.",
  },
  {
    model: "solar-pro4",
    harness: "gpt",
    effort: "medium",
    why: "Solar Pro 4 reasoning_effort 기본 예시(medium). Codex 하네스의 OPENAI_BASE_URL env-swap 으로 스폰되며, UPSTAGE_API_KEY 가 있을 때만 후보로 살아남는다.",
  },
  {
    model: "solar-pro4",
    harness: "gpt",
    effort: "high",
    why: "Solar Pro 4 mid 칸의 상향 effort. max/ultra 는 Upstage 공식 예제에 없으므로 등록하지 않는다(추측 금지).",
  },
  {
    model: "gpt-5.6-terra",
    harness: "gpt",
    effort: "medium",
    why: "top 칸($2.5/$15, 지표 8.75) — 같은 등급 gpt-5.5(17.5)보다 3.5배 싸서 이 칸을 차지한다. standard 진입점(effort medium = 현행 라이브와 동일).",
  },
  {
    model: "gpt-5.6-terra",
    harness: "gpt",
    effort: "high",
    why: "top 칸 effort 상향.",
  },
  {
    model: "gpt-5.6-terra",
    harness: "gpt",
    effort: "xhigh",
    why: "top 칸 천장. xhigh 는 5.5 계열에도 있던 기존 칸이라 승인 게이트 대상이 아니다(§1.2).",
  },
  {
    model: "gpt-5.6-sol",
    harness: "gpt",
    effort: "high",
    why: "frontier 칸($5/$30, 지표 17.5). complex 진입점(effort high = 현행 라이브와 동일).",
  },
  {
    model: "gpt-5.6-sol",
    harness: "gpt",
    effort: "xhigh",
    why: "frontier effort 상향 — 승인 없이 갈 수 있는 마지막 칸.",
  },
  {
    model: "gpt-5.6-sol",
    harness: "gpt",
    effort: "max",
    why: "★고비용 상단 — 사용자 승인 필요(사장님 결정 2026-07-25).",
  },
  {
    model: "gpt-5.6-sol",
    harness: "gpt",
    effort: "ultra",
    why: "★최상단 — 사용자 승인 필요. luna 는 ultra 를 지원하지 않으므로(레지스트리) 이 칸은 sol/terra 계열에만 존재한다.",
  },
];

/**
 * grok(Grok Build) 사다리 — 레지스트리에 grok 행이 둘(4.6/4.5)이 됐지만 칸은
 * 여전히 **하나**(grok-4.6)다. 4.5 는 `LADDER_EXCLUSIONS` 로 내렸다. 사유는
 * 그 표의 항목에 적어 뒀다 — 요약하면 단가·컨텍스트·능력등급이 4.6 과 **완전히
 * 동일**해서(둘 다 500k/$2/$6/top) 자동선택이 4.5 를 고를 근거가 존재하지 않고,
 * 같은 값의 칸을 둘 두면 사다리 순서가 무의미해지기 때문이다(claude-opus-4-8 을
 * 내린 것과 같은 원칙). 4.5 는 명시 핀(`grok:grok-4.5`)으로 계속 닿는다.
 *
 * 칸이 하나면 고를 것이 없는데 왜 사다리를 만드는가:
 *
 * 사다리가 없으면 `selectAutoModel` 이 `null` 을 돌려주고(=계획 없음),
 * `bridge-server.graphKeysFor` 는 그때 `predictedModelKey` 로 떨어진다. 그런데 그
 * 함수는 claude/gpt 축만 알아서 grok 에는 `null` 을 주고, 결국 라우팅 그래프가
 * **읽는 셀이 `"grok"`**(하네스 이름)이 된다. 반면 결과를 **쓰는** 쪽은
 * `spawnedModelKey`(= argv 에서 되읽은 `grok-4.5`)라, 같은 스폰의 읽기·쓰기가 서로
 * 다른 셀을 가리켰다 — 관측이 아무리 쌓여도 그 근거가 다음 선택에 도달하지 못하는
 * 자기강화 루프의 단선이다(`model-autoselect` 상단의 "읽는 셀 = 쓰는 셀" 불변식).
 * 게다가 `"grok"` 은 `isHarnessFamilyId` 가 잡아내는 "모델미상" 문자열이라
 * 레지스트리·단가표 어디에도 없는 유령 셀이다.
 *
 * 칸이 하나이므로 **스폰 argv 는 한 바이트도 바뀌지 않는다**: 자동선택이
 * `grok-4.6` 을 고르면 `nativeModel` 핀이 되어 `-m grok-4.6` 이 붙는데, 그것은
 * `buildCLICommand` 의 grok 분기가 핀 없이도 넣던 기본값(`GROK_DEFAULT_MODEL`)과
 * 같은 값이다. 바뀌는 것은 그래프 셀 키뿐이다.
 *
 * ★난도 3티어가 같은 칸을 가리키는 것도 사실 그대로다 — 4.5 는 4.6 과 값이 같아
 * 티어를 가를 축이 되지 못한다. 변종(grok-code-fast 등)이나 세대가 갈리는 단가가
 * CLI-verified 로 등록되면 그때 칸이 늘고 티어 진입점이 갈린다.
 */
const GROK_RUNGS: LadderRung[] = [
  {
    model: "grok-4.6",
    harness: "grok",
    why: "grok 하네스의 최신 CLI-verified 행이자 `grok models` 가 찍는 default(top 등급). 4.5 와 단가·컨텍스트가 같아 아래 칸을 둘 이유가 없다. 핀 값이 buildCLICommand 의 기본 -m 값과 같아 argv 무변경이고, 사다리가 있어야 라우팅 그래프의 읽는 셀이 실제 스폰 키(grok-4.6)와 일치한다.",
  },
];

/**
 * 사다리에 **의도적으로 넣지 않은** 활성 모델과 그 이유.
 *
 * 이 표가 있는 이유: 레지스트리에 행을 추가한 사람이 사다리 갱신을 잊으면
 * 그 모델은 "라우팅이 절대 고르지 않는 유령" 이 된다. 완결성 테스트
 * (`model-ladder.test.ts`)가 "모든 활성 모델은 사다리에 있거나 여기 이유가
 * 적혀 있다" 를 강제하므로, 누락이 침묵하지 못한다.
 */
export const LADDER_EXCLUSIONS: Readonly<Record<string, string>> = {
  "claude-haiku-4-5-20251001":
    "현행 simple 바닥은 sonnet5 다. 더 아래 칸을 만드는 것은 하향(강등) 정책이고 이 티켓(상향 사다리) 범위가 아니다 — 별 티켓에서 비용회귀 측정과 함께.",
  "claude-opus-4-8":
    "claude-opus-5 와 동일 능력등급·동일 단가($5/$25). 같은 칸을 둘로 만들면 사다리 순서가 무의미해진다. env(MARBLO_STANDARD_CLAUDE_MODEL)로는 여전히 선택 가능.",
  "gpt-5.5":
    "gpt-5.6 변종 도입 전 codex 기본 모델(HarnessLadder.inheritedModel 폴백 키)이다. top 등급이 같은 terra 가 3.5배 싸므로 **권장 칸**으로 올릴 근거가 없다.",
  "gpt-5.4":
    "단가가 추정치(pricing.estimated) 다. 추정 단가로 순서를 정하면 '실단가 기반 사다리' 라는 이 파일의 전제가 깨진다 — db3qs0o6 서베이가 실단가를 확정하면 편입 검토.",
  "gpt-5.4-mini":
    "cheap 등급 최저단가($0.75/$4.5)지만 코딩 에이전트로서의 적합성이 한 번도 측정되지 않았다. 진입점으로 쓰면 simple 티켓 실패율이 오를 수 있고, 그 판정은 P2-4 효과집계의 몫이다.",
  "grok-4.5":
    "grok-4.6 과 능력등급·단가·컨텍스트가 **완전히 동일**하다(top / $2·$6 / 500k, 2026-08-20 docs.x.ai 카드 실측). 같은 값의 칸을 둘 만들면 사다리 순서가 무의미해진다(claude-opus-4-8 과 같은 사유). 자동선택은 항상 신형인 4.6 을 쓰고, 4.5 는 명시 핀 `grok:grok-4.5` / dispatch_task(model=\"grok-4.5\") 로 계속 닿는다.",
  // ── ★env-swap 벤더(GLM/MiniMax/Kimi) — 이 티켓(hyKsSYYM, 사장님 A안)으로
  // 위 CLAUDE_RUNGS 에 편입됐다. "명시 지정 전용" 배제는 여기서 끝났다:
  // glm-5.2·glm-4.7·MiniMax-M3·MiniMax-M2.7·k3·k3-256k·kimi-for-coding 은
  // 더 이상 이 표에 없다 — 사다리 완결성 테스트가 "사다리에 있거나 여기 있거나"
  // 를 요구하므로, 편입된 모델을 여기 남겨 두면 중복(사다리+제외 동시)이 된다.
  // 키 없는 기기에서의 안전은 이 표가 아니라 `AutoSelectInput.modelAvailable`
  // (= `vendorEnvReadiness(id).ready`, bridge-server.ts 배선)이 런타임에 맡는다.
  "deepseek-v4-flash":
    "티켓 JrxWAAGqgnso5Rik6svk 범위는 DeepSeek 스폰/퀵레인 벤더 추가다. 오케 후보가 아니며 자동선택 사다리도 네이티브 Codex 진입칸을 흔들지 않는다 — 명시 선택/퀵레인으로만 닿는다.",
  "deepseek-v4-pro":
    "deepseek-v4-flash 와 같은 사유. V4 Pro 모델이지만 이 티켓은 자동 라우팅 정책 편입이 아니라 스폰 전용 env-swap 편입이다.",
};

/** rung 을 레지스트리와 대조해 검증한다(불일치 = 모듈 로드 실패). */
function buildLadder(
  harness: HarnessId,
  rungs: LadderRung[],
  entry: Record<LadderTier, number>,
  extra: { pinsModel: boolean; inheritedModel?: string },
): HarnessLadder {
  rungs.forEach((rung, i) => {
    const model = getModel(rung.model);
    if (!model) {
      throw new Error(
        `[model-ladder] ${harness} rung#${i}: 레지스트리에 없는 모델 id "${rung.model}". ` +
          "model-registry.ts 에 CLI-verified 행을 먼저 추가하세요(추론으로 id 를 쓰지 않는다).",
      );
    }
    if (model.id !== rung.model) {
      throw new Error(
        `[model-ladder] ${harness} rung#${i}: "${rung.model}" 은 alias 입니다(→ ${model.id}). ` +
          "사다리 칸은 구체 id 만 쓴다 — alias 는 CLI 가 뜻을 바꾸는 이동표적이다.",
      );
    }
    if (model.harness !== harness) {
      throw new Error(
        `[model-ladder] ${harness} rung#${i}: "${rung.model}" 의 harness 는 ${model.harness} 입니다(벤더는 ${model.provider}).`,
      );
    }
    if (model.status !== "active") {
      throw new Error(
        `[model-ladder] ${harness} rung#${i}: "${rung.model}" 은 ${model.status} 입니다.`,
      );
    }
    if (rung.effort === undefined) {
      if (model.efforts.length > 0) {
        throw new Error(
          `[model-ladder] ${harness} rung#${i}: "${rung.model}" 은 effort 축이 있는 모델인데 칸에 effort 가 없습니다.`,
        );
      }
    } else if (!model.efforts.includes(rung.effort)) {
      throw new Error(
        `[model-ladder] ${harness} rung#${i}: "${rung.model}" 은 effort "${
          rung.effort
        }" 를 지원하지 않습니다(지원: ${model.efforts.join(", ") || "없음"}).`,
      );
    }
  });

  for (const tier of LADDER_TIERS) {
    const idx = entry[tier];
    if (!Number.isInteger(idx) || idx < 0 || idx >= rungs.length) {
      throw new Error(
        `[model-ladder] ${harness} entry.${tier}=${idx} 가 rung 범위(0..${
          rungs.length - 1
        }) 밖입니다.`,
      );
    }
    if (rungNeedsApproval(rungs[idx])) {
      throw new Error(
        `[model-ladder] ${harness} entry.${tier} 이 승인 게이트 칸(${rungLabel(
          rungs[idx],
        )})을 가리킵니다 — 진입점은 승인 없이 써야 하므로 금지.`,
      );
    }
  }

  return {
    harness,
    rungs,
    entry,
    pinsModel: extra.pinsModel,
    ...(extra.inheritedModel ? { inheritedModel: extra.inheritedModel } : {}),
  };
}

export const MODEL_LADDERS: Readonly<
  Partial<Record<HarnessId, HarnessLadder>>
> = {
  claude: buildLadder(
    "claude",
    CLAUDE_RUNGS,
    { simple: 3, standard: 4, complex: 9 },
    { pinsModel: true },
  ),
  // gemini/antigravity/local/custom: CLI-verified 모델 사실이 아직 없어
  // 레지스트리 행부터 없다(레지스트리 하단 주석). 사다리도 만들지 않는다 —
  // 빈 사다리를 두면 "정책이 있는데 후보가 없다"는 착시가 생긴다.
  gpt: buildLadder(
    "gpt",
    GPT_RUNGS,
    { simple: 0, standard: 6, complex: 9 },
    { pinsModel: true, inheritedModel: "gpt-5.5" },
  ),
  // grok 은 argv 로 모델을 실제로 핀한다(`-m <id>`) — codex 처럼 사용자 config 를
  // 상속하는 축이 아니라 claude 와 같은 pinsModel=true 다.
  grok: buildLadder(
    "grok",
    GROK_RUNGS,
    { simple: 0, standard: 0, complex: 0 },
    { pinsModel: true },
  ),
};

// ─────────────────────────────────────────────────────────────────────────
// ★MCP 쪽 미러와의 일치 검증 (모듈 로드 시점)
//
// `mcp-server/escalation-approval.ts` 는 레지스트리를 읽을 수 없어 effort 목록과
// 게이트 칸 목록을 자기 상수로 갖는다. 그 미러가 이 파일의 사실과 갈라지면
// "MCP 는 승인을 요구하는데 스폰 경로는 그냥 통과" 같은 조용한 구멍이 생긴다.
// 그래서 여기서 양방향으로 대조하고, 어긋나면 부팅을 멈춘다.
// ─────────────────────────────────────────────────────────────────────────

function assertMirrorsMatch(): void {
  const registryEfforts = EFFORT_LADDER.join(",");
  const mirrorEfforts = EFFORT_NAMES.join(",");
  if (registryEfforts !== mirrorEfforts) {
    throw new Error(
      `[model-ladder] effort 목록 불일치: registry=[${registryEfforts}] vs mcp-server/escalation-approval.EFFORT_NAMES=[${mirrorEfforts}]`,
    );
  }
  for (const effort of APPROVAL_GATED_EFFORTS) {
    if (!EFFORT_LADDER.includes(effort as EffortLevel)) {
      throw new Error(
        `[model-ladder] 게이트 effort "${effort}" 가 registry EFFORT_LADDER 에 없습니다.`,
      );
    }
  }
  const gatedInLadder = Object.values(MODEL_LADDERS)
    .flatMap((l) => (l ? [...l.rungs] : []))
    .filter((r) => rungNeedsApproval(r))
    .map((r) => rungLabel(r))
    .sort();
  const mirror = [...GATED_LADDER_RUNGS].sort();
  if (gatedInLadder.join(",") !== mirror.join(",")) {
    throw new Error(
      `[model-ladder] 게이트 칸 목록 불일치: 사다리=[${gatedInLadder.join(
        ", ",
      )}] vs mcp-server/escalation-approval.GATED_LADDER_RUNGS=[${mirror.join(
        ", ",
      )}]. 고비용 칸을 사다리에 넣거나 뺐으면 양쪽을 같이 고쳐야 한다.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 조회 API
// ─────────────────────────────────────────────────────────────────────────

/** `model@effort` 표기. P2-2 가 쓸 그래프 cell key 와 같은 모양으로 맞췄다. */
export function rungLabel(rung: LadderRung): string {
  return rungSpecLabel(rung.model, rung.effort);
}

export function ladderFor(harness: HarnessId): HarnessLadder | undefined {
  return MODEL_LADDERS[harness];
}

/** 티어 진입 칸. 사다리가 없는 하네스는 undefined(정책 override 없음 = 현행 상속). */
export function entryRung(
  harness: HarnessId,
  tier: LadderTier,
): LadderRung | undefined {
  const ladder = ladderFor(harness);
  return ladder?.rungs[ladder.entry[tier]];
}

/** 사다리에서 이 칸의 인덱스(모양이 같은 칸을 찾는다). 없으면 -1. */
export function rungIndex(harness: HarnessId, rung: LadderRung): number {
  const ladder = ladderFor(harness);
  if (!ladder) return -1;
  return ladder.rungs.findIndex(
    (r) => r.model === rung.model && r.effort === rung.effort,
  );
}

/**
 * 한 칸 위. 티어 경계를 넘어 계속 올라간다(§4 넷-뉴 1 의
 * `simple → … → standard → …` 그대로). 천장이면 undefined.
 *
 * ★상향 **횟수** 제한은 여기서 하지 않는다 — 그건 restartCount 예산과 같은
 * 계정에서 차감돼야 하는 호출자(P3-2)의 책임이고, 순수 조회 함수가 상태를
 * 숨겨 갖고 있으면 그 예산을 감사할 수 없다.
 */
export function nextRung(
  harness: HarnessId,
  current: LadderRung,
): LadderRung | undefined {
  const idx = rungIndex(harness, current);
  if (idx < 0) return undefined;
  return ladderFor(harness)?.rungs[idx + 1];
}

/** 이 칸(포함) 아래에서 승인 없이 쓸 수 있는 가장 높은 칸. */
export function highestUngatedRungAtOrBelow(
  rung: LadderRung,
): LadderRung | undefined {
  const ladder = ladderFor(rung.harness);
  if (!ladder) return undefined;
  const idx = rungIndex(rung.harness, rung);
  const from = idx < 0 ? ladder.rungs.length - 1 : idx;
  for (let i = from; i >= 0; i--) {
    if (!rungNeedsApproval(ladder.rungs[i])) return ladder.rungs[i];
  }
  return undefined;
}

/**
 * 지금 승인 상태에서 실제로 고를 수 있는 칸들. ★그래프 편향(P2-2)·셀렉터는
 * 반드시 이 목록 안에서만 골라야 한다 — 그러지 않으면 데이터 편향이 비용
 * 상한을 우회한다.
 */
export function usableRungs(
  harness: HarnessId,
  records: readonly EscalationApprovalRecord[] = [],
): LadderRung[] {
  const ladder = ladderFor(harness);
  if (!ladder) return [];
  return ladder.rungs.filter(
    (r) => !rungNeedsApproval(r) || !!usableApproval(records, r),
  );
}

/** 파서 — `"gpt-5.6-sol@max"` / `"claude-opus-5"` 를 칸으로. 검증 실패는 이유를 돌려준다. */
export function parseRung(
  spec: string,
): { ok: true; rung: LadderRung } | { ok: false; error: string } {
  const raw = spec.trim();
  if (!raw) return { ok: false, error: "빈 문자열입니다." };
  const at = raw.indexOf("@");
  const modelPart = at >= 0 ? raw.slice(0, at) : raw;
  const effortPart =
    at >= 0
      ? raw
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";
  const entry = getModel(modelPart);
  if (!entry) {
    return {
      ok: false,
      error: `모델 "${modelPart}" 은 레지스트리에 없습니다(CLI-verified 모델만 씁니다).`,
    };
  }
  if (!effortPart) {
    if (entry.efforts.length > 0) {
      return {
        ok: false,
        error: `"${
          entry.id
        }" 은 effort 가 필요합니다(지원: ${entry.efforts.join(", ")}). 예: ${
          entry.id
        }@${entry.efforts[0]}`,
      };
    }
    return {
      ok: true,
      rung: { model: entry.id, harness: entry.harness, why: "동적 지정" },
    };
  }
  if (!EFFORT_LADDER.includes(effortPart as EffortLevel)) {
    return {
      ok: false,
      error: `effort "${effortPart}" 는 유효하지 않습니다(${EFFORT_LADDER.join(
        ", ",
      )}).`,
    };
  }
  if (!entry.efforts.includes(effortPart as EffortLevel)) {
    return {
      ok: false,
      error: `"${
        entry.id
      }" 은 effort "${effortPart}" 를 지원하지 않습니다(지원: ${
        entry.efforts.join(", ") || "없음"
      }).`,
    };
  }
  return {
    ok: true,
    rung: {
      model: entry.id,
      harness: entry.harness,
      effort: effortPart as EffortLevel,
      why: "동적 지정",
    },
  };
}

/** 사다리를 사람이 읽는 표로. 오케/런북이 "무엇이 어디 있나" 를 물을 때. */
export function formatLadder(harness: HarnessId): string {
  const ladder = ladderFor(harness);
  if (!ladder) return `${harness}: 사다리 없음(CLI-verified 모델 미등록).`;
  const tierAt = new Map<number, LadderTier[]>();
  for (const tier of LADDER_TIERS) {
    const idx = ladder.entry[tier];
    tierAt.set(idx, [...(tierAt.get(idx) ?? []), tier]);
  }
  const lines = ladder.rungs.map((r, i) => {
    const tiers = tierAt.get(i);
    const marks = [
      tiers ? `← ${tiers.join("/")} 진입` : "",
      rungNeedsApproval(r) ? "★승인필요" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const idx = costIndexForModel(r.model);
    return `  ${i}. ${rungLabel(r)} (단가지표 ${
      idx ?? "?"
    }) ${marks}`.trimEnd();
  });
  const inheritedNote = ladder.inheritedModel
    ? `; 폴백 학습 키: ${ladder.inheritedModel}`
    : "";
  const pinNote = ladder.pinsModel
    ? `모델 핀: 예(--model/-c model)${inheritedNote}`
    : `모델 핀: 아니오 — 오늘 실제 서빙 모델은 ${
        ladder.inheritedModel ?? "CLI 기본값"
      }`;
  return [`${harness} 사다리 (${pinNote})`, ...lines].join("\n");
}

// 미러 대조는 사다리와 조회 API 가 모두 정의된 뒤 딱 한 번 돈다.
assertMirrorsMatch();

/** 능력등급 순 정렬 헬퍼 — 사다리 검증 테스트가 쓴다. */
export function capabilityRank(id: string): number | undefined {
  const entry = getModel(id);
  return entry ? CAPABILITY_ORDER[entry.capability] : undefined;
}
