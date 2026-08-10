/**
 * 라우팅 **shadow 비교**의 클라이언트 절반 (티켓 6LH4Y1GC7xeWA94pW3Ar).
 *
 * ── ★★ 비목표를 먼저 못 박는다 ────────────────────────────────────────────
 * 이 파일은 **라우팅을 바꾸지 않는다.** 학습도, 실반영도, fine-tune 도 아니다.
 * 로컬 `model-autoselect.selectAutoModel` 이 이미 고른 칸으로 에이전트는 그대로
 * 뜨고, 여기서는 그 결정의 **특징만** 클라우드에 보내 "너였다면?" 을 물은 뒤
 * 답을 나란히 기록한다(shadow). 응답을 읽어 스폰을 바꾸는 코드는 이 파일에도,
 * 호출측에도 없다 — 있으면 그건 이 티켓의 불변식 위반이다.
 *
 * ── 왜 이 배관이 지금 필요한가 ──────────────────────────────────────────
 * 학습형 라우팅으로 가려면 언젠가 "클라우드가 고른 칸" 과 "로컬이 고른 칸" 을
 * 비교해야 한다. 그 비교의 baseline 은 **소급되지 않는다** — 오늘 안 담은 날의
 * 일치율은 영원히 없다. 그래서 모델이 없는 지금 단계에서도 왕복과 기록만은
 * 먼저 돌려 둔다(`docs/routing/label-capture-audit-2026-08-10.md` §7).
 *
 * ── fail-safe 계약 ──────────────────────────────────────────────────────
 *   · 이 모듈의 공개 함수는 **던지지 않는다**. 못 만들면 `null` 이다.
 *   · 발신은 fire-and-forget 이다(호출측이 await 하지 않는다). 창이 없거나
 *     렌더러가 죽어 있으면 조용한 no-op — dispatch 는 그 사실을 모른다.
 *   · 클라우드 왕복 자체는 **렌더러**가 한다(`src/services/routingShadowService`).
 *     그래야 기존 텔레메트리 동의 게이트·PII scrub·조인키 가명화를 그대로 탄다.
 *     메인이 직접 콜러블을 부르면 그 세 가지를 우회하는 두 번째 외부 송신
 *     경로가 생긴다.
 *
 * ── 페이로드에 담기는 것 / 안 담기는 것 ─────────────────────────────────
 *   · 담는다 — 티어, 하네스, 사다리 칸(model@effort)과 그 단가·위치, 결정 시점
 *     상태 숫자(예산 소진율·주간 점유·활성 수), 역할, taskType, 태그 **개수**.
 *   · 안 담는다 — 프롬프트, 티켓 본문, 경로, 태그 **문자열**(자유입력이라 뺀다).
 */

import { costIndexForModel, type LadderTier } from "./model-ladder";
import type { AutoModelPlan } from "./model-autoselect";

/** 서버 `functions/src/routingShadow.ts` 의 계약 버전과 같이 움직인다. */
export const ROUTING_SHADOW_SCHEMA_VERSION = 1;

/** 사다리 칸 하나(클라우드가 볼 수 있는 전부). */
export interface ShadowRung {
  modelKey: string;
  index: number;
  costIndex?: number;
}

/** 클라우드 추천이 볼 특징. ★로컬이 고른 칸은 여기 없다 — 일부러 없다. */
export interface ShadowFeatures {
  schemaVersion: number;
  tier: LadderTier;
  harness: string;
  entryIndex: number;
  rungs: ShadowRung[];
  budgetUsedPercent?: number | null;
  weeklyTokenShare?: number | null;
  activeAgentCount?: number | null;
  roleAgentCount?: number | null;
  role?: string | null;
  taskType?: string | null;
  tagCount?: number | null;
}

/** 메인 → 렌더러로 넘기는 shadow 요청 한 건. */
export interface ShadowRequest {
  features: ShadowFeatures;
  /**
   * ★로컬이 **실제로** 고른 칸. 비교에만 쓰이며 추천 함수에는 넘어가지 않는다
   * (서버가 `recommendRouting(features)` 를 먼저 부르고 그 뒤에 비교한다).
   */
  localModelKey: string;
  /** 로컬 선택의 모드/결정자 — 불일치가 어느 성분에서 났는지 사후 분해용. */
  localMode: string;
  localDecidedBy: string;
  /** 로컬 결정이 진입칸을 벗어났는가. */
  localMovedFromEntry: boolean;
  /** 그래프 관측이 하나도 없었나(콜드 = 클라우드와 조건이 가장 비슷한 경우). */
  localColdStart: boolean;
  /** 조인 키. 익명 세계 규약대로 서버가 가명화해 적재한다. */
  taskId?: string | null;
  agentId?: string | null;
}

/** `buildShadowRequest` 입력 — 전부 dispatch 가 이미 손에 들고 있는 값이다. */
export interface ShadowRequestInput {
  plan: AutoModelPlan | undefined | null;
  tier: LadderTier | undefined;
  role?: string | null;
  taskType?: string | null;
  tagCount?: number | null;
  budgetUsedPercent?: number | null;
  weeklyTokenShare?: number | null;
  activeAgentCount?: number | null;
  roleAgentCount?: number | null;
  taskId?: string | null;
  agentId?: string | null;
}

/**
 * 로컬 결정 → shadow 요청. 만들 수 없으면 `null`(던지지 않는다).
 *
 * `null` 이 되는 경우와 그 이유:
 *   · 자동선택이 안 돌았다(명시 모델 핀·사다리 없는 하네스) → 비교할 **로컬
 *     2층 결정 자체가 없다**. 클라우드에 물어봐야 비교 대상이 없다.
 *   · 티어가 없다 → 난도적합 축이 성립하지 않는다. 지어내지 않는다.
 */
export function buildShadowRequest(
  input: ShadowRequestInput,
): ShadowRequest | null {
  const { plan, tier } = input;
  if (!plan || !tier) return null;
  if (!Array.isArray(plan.scores) || plan.scores.length === 0) return null;

  // 사다리 칸은 **점수 순이 아니라 사다리 순**으로 보낸다. 점수 순으로 보내면
  // 순서 자체가 로컬 판단의 누설이다(클라우드가 0번을 우대할 이유가 생긴다).
  const rungs: ShadowRung[] = plan.scores
    .map((s) => {
      const cost = costIndexForModel(s.candidate.model);
      return {
        modelKey: s.candidate.modelKey,
        index: s.candidate.index,
        // 레지스트리에 단가가 없으면 넣지 않는다 — 0 은 "공짜" 라는 거짓
        // 근거가 된다(bridge-server 의 candidateCostIndex 와 같은 규율).
        ...(typeof cost === "number" && cost > 0 ? { costIndex: cost } : {}),
      };
    })
    .sort((a, b) => a.index - b.index);

  const entry = rungs.find((r) => r.modelKey === plan.entryModelKey);

  return {
    features: {
      schemaVersion: ROUTING_SHADOW_SCHEMA_VERSION,
      tier,
      harness: plan.harness,
      // 진입칸이 후보에서 걸러졌으면(가용성 필터) 사다리 최하단을 기준으로
      // 둔다 — 없는 칸의 위치를 지어내지 않고, 남은 칸들 사이의 상대 거리는
      // 그대로 보존된다.
      entryIndex: entry?.index ?? rungs[0].index,
      rungs,
      budgetUsedPercent: input.budgetUsedPercent ?? null,
      weeklyTokenShare: input.weeklyTokenShare ?? null,
      activeAgentCount: input.activeAgentCount ?? null,
      roleAgentCount: input.roleAgentCount ?? null,
      role: input.role ?? null,
      taskType: input.taskType ?? null,
      tagCount: input.tagCount ?? null,
    },
    localModelKey: plan.modelKey,
    localMode: plan.mode,
    localDecidedBy: plan.decidedBy,
    localMovedFromEntry: plan.movedFromEntry,
    localColdStart: plan.coldStart,
    taskId: input.taskId ?? null,
    agentId: input.agentId ?? null,
  };
}

/**
 * env 킬스위치. `MARBLO_ROUTING_SHADOW=0` 이면 shadow 왕복을 아예 만들지 않는다.
 *
 * ★미설정(빈 문자열)은 **켜짐**이다 — `Number("")===0` 함정을 피하려고 문자열로
 * 비교한다(`model-autoselect.resolveEpsilon` 과 같은 이유·같은 규약).
 */
export function routingShadowEnabled(raw?: string): boolean {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return true;
  return trimmed !== "0" && trimmed.toLowerCase() !== "false";
}
