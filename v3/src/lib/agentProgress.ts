import type { Agent } from "../types/agent";

/**
 * 에이전트가 **실제로 일을 하고 있다** 는 관측 — 과금 토큰 카운터의 증가.
 *
 * ── 왜 이 축이 필요한가 ────────────────────────────────────────────────────
 * 정체 레인의 무진척 시계(lib/stuckLane)는 `projection.lastActivityAt` /
 * `updatedAt` / `claimedAt` 만 본다. 셋 다 **보드에 write 가 일어난 시각**이다.
 * 그래서 한 시간짜리 일을 성실히 하는 에이전트가 그동안 add_activity 를 안
 * 남기면 20분(P4+)째에 no-progress 로 찍혀 활성 컬럼에서 빠진다 — 열심히
 * 일할수록 보드에서 사라지는 구조였다(티켓 AYJyHabfdG1DqeUvun9H).
 *
 * ── 왜 하필 토큰 카운터인가 ────────────────────────────────────────────────
 * 렌더러가 오늘 쥘 수 있는 신호 중 **PTY 바이트 파생이 아닌** 유일한 진행
 * 증거다. agents/<id>.total{Input,Output,CacheRead,CacheWrite}Tokens 는
 * useCostWriter 가 main 의 cost:update 마다 increment 하고, 그 delta 는
 * cost-tracker 가 CLI **자신의 세션 JSONL** 을 15초 주기로 읽어 만든다.
 *  · 끝난 CLI 는 assistant 턴을 더 쓰지 않으므로 카운터가 멈춘다 —
 *    "끝난 CLI 가 영구 working" 이라는 PTY 축의 오판이 구조적으로 불가능하다.
 *  · 추론 중인 에이전트는 턴이 닫히는 순간 카운터가 오른다 — "추론 중이 idle"
 *    이라는 반대쪽 오판도 없다.
 * ★그래서 이 축은 PTY working/idle 을 **대체하지 않고 보완한다**. 판정은
 * 여전히 stuckLane 이 하고, 이 축은 그 시계에 "진척" 후보 하나를 더할 뿐이다.
 *
 * ── 왜 `costUpdatedAt` 을 그대로 안 쓰나 (중요) ────────────────────────────
 * 같은 write 에 실려 오는 `costUpdatedAt` 이 더 편해 보이지만 쓰면 안 된다.
 * cost-tracker.emit() 은 토큰 델타가 **없어도** rate-limit % 가 움직이면
 * emit 한다. 그 % 는 claude 계정 전역 프로브(5분 주기)가 만들고 **다른**
 * 에이전트가 태운 사용량으로도 바뀐다. 즉 아무 일도 안 하는 에이전트의
 * costUpdatedAt 이 5분마다 신선해질 수 있고, 그걸 진척으로 믿으면 정체 판정이
 * 영원히 안 뜬다 — 이 티켓과 정확히 반대 방향의 사고다. 카운터의 **증가**만
 * 본다.
 *
 * ── 한계(정직하게) ─────────────────────────────────────────────────────────
 *  · 텔레메트리 옵트아웃 시 useCostWriter 가 write 를 아예 건너뛴다 → 관측 0건.
 *  · 앱을 켠 뒤부터만 관측한다(아래 "첫 관측은 기준선일 뿐" 참조).
 * 두 경우 모두 이 축이 **없는 것과 같아지고**, 판정은 종전 동작으로 떨어진다.
 * 이 축은 티켓을 정체에서 구해내기만 하고 정체로 몰지는 않는다 — 없어서
 * 나빠지는 방향이 없다는 뜻이다.
 */

/** 에이전트 하나에 대한 마지막 토큰 관측. */
export interface AgentTokenObservation {
  /** 마지막으로 본 누적 토큰 합. */
  tokens: number;
  /**
   * 카운터가 **오르는 것을 본** 시각(epoch ms). 처음 본 에이전트는 null 이다.
   *
   * ★첫 관측에 시각을 찍으면 안 된다: 앱을 켜는 순간 모든 에이전트가 "방금
   * 진척" 으로 보여 정체 판정이 임계만큼 통째로 잠긴다. 첫 관측은 기준선만
   * 잡고, 그 기준선이 움직였을 때 비로소 시각이 생긴다.
   */
  at: number | null;
}

export type AgentTokenObservations = ReadonlyMap<string, AgentTokenObservation>;

/** 이 에이전트가 지금까지 태운 토큰 총합. 없는 필드는 0. */
export function totalBilledTokens(
  agent: Pick<
    Agent,
    | "totalInputTokens"
    | "totalOutputTokens"
    | "totalCacheReadTokens"
    | "totalCacheWriteTokens"
  >,
): number {
  return (
    (agent.totalInputTokens ?? 0) +
    (agent.totalOutputTokens ?? 0) +
    (agent.totalCacheReadTokens ?? 0) +
    (agent.totalCacheWriteTokens ?? 0)
  );
}

export type AgentTokenSnapshot = Pick<
  Agent,
  | "id"
  | "totalInputTokens"
  | "totalOutputTokens"
  | "totalCacheReadTokens"
  | "totalCacheWriteTokens"
>;

/**
 * 새 에이전트 스냅샷을 접어 관측 맵을 갱신한다. **순수 함수** — 같은 입력을
 * 두 번 접어도 결과가 같다(카운터가 안 움직였으므로 시각도 안 움직인다).
 * 목록에서 사라진 에이전트는 떨군다.
 */
export function foldAgentTokenObservations(
  prev: AgentTokenObservations,
  agents: readonly AgentTokenSnapshot[],
  now: number,
): Map<string, AgentTokenObservation> {
  const next = new Map<string, AgentTokenObservation>();
  for (const agent of agents) {
    const tokens = totalBilledTokens(agent);
    const before = prev.get(agent.id);
    if (!before) {
      next.set(agent.id, { tokens, at: null });
      continue;
    }
    // 카운터는 increment 라 단조 증가해야 하지만, 문서 교체·재생성으로 줄어들
    // 수도 있다. 줄어든 것은 진척이 아니므로 기준선만 다시 잡는다.
    if (tokens > before.tokens) {
      next.set(agent.id, { tokens, at: now });
    } else if (tokens < before.tokens) {
      next.set(agent.id, { tokens, at: before.at });
    } else {
      next.set(agent.id, before);
    }
  }
  return next;
}

/** agentId → 마지막 진척 관측 시각. 관측이 없는 에이전트는 키 자체가 없다. */
export function agentActivityMap(
  observations: AgentTokenObservations,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const [id, observation] of observations) {
    if (observation.at !== null) map.set(id, observation.at);
  }
  return map;
}

// ── 앱 전역 관측 슬롯 ───────────────────────────────────────────────────────
//
// 훅 안의 ref 가 아니라 모듈 슬롯인 이유: 보드는 탭 전환으로 언마운트된다.
// ref 에 두면 탭을 오갈 때마다 기준선이 초기화돼 관측이 영영 쌓이지 않는다.
// 스토어가 아니라 평범한 모듈 변수인 이유: 이 값은 그 자체로 렌더를 유발할
// 필요가 없다(정체 판정은 이미 1분 틱과 agents 스냅샷으로 다시 돈다).

let shared: AgentTokenObservations = new Map();

/** 스냅샷 하나를 관측에 반영하고 갱신된 맵을 돌려준다. */
export function observeAgentTokens(
  agents: readonly AgentTokenSnapshot[],
  now: number,
): AgentTokenObservations {
  shared = foldAgentTokenObservations(shared, agents, now);
  return shared;
}

/** 테스트·프로젝트 전환용 초기화. */
export function resetAgentTokenObservations(): void {
  shared = new Map();
}
