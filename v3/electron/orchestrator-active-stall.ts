/**
 * "활성 정체(active stall)" 판정 — 바쁜데 진전이 없는 구간을 감지한다
 * (티켓 Z4095CT4CpAuTVtnAp9l).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * `orchestrator-board-resync.ts` 의 두 패스(다이제스트·자율 픽업)는 전부
 * **오케가 유휴일 때만** PTY 를 민다(`isOrchBusy` 게이트). 2026-09-05, 사장님이
 * 세 번째로 같은 지적을 하셨을 때("지금 티켓 열려서 작업하는게 없는데? 리뷰들도
 * 17개 있는데 너 멈춰있어") 오케(보드 오케)는 사장님과 대화 중이었다 — 턴은
 * 활발히 돌고 있었으므로 유휴가 아니었고, 그래서 두 패스 모두 밀기 대상에서
 * 아예 제외됐다. 옛 구조가 감지하는 것은 **"멈춘 오케"**(유휴) 하나뿐이다.
 *
 * 실제로 문제가 되는 상태는 하나 더 있다 — **바쁜데 일이 안 늘어나는 오케**:
 * 턴은 돌고 말은 하는데, 티켓 상태 전이도 dispatch 도 PR 진전도 없는 구간.
 * 이건 유휴가 아니므로 옛 구조에선 영원히 안 보인다. 이 모듈이 그 사각을 메운다.
 *
 * ── 유휴 축과의 경계 ─────────────────────────────────────────────────────────
 * `orchIdleForMs`/`isOrchBusy` 정의는 재사용한다(새로 만들지 않는다). 이 판정은
 * **오케가 busy 일 때만** 켜진다 — 오케가 idle 이면 그건 이 모듈이 아니라
 * 유휴 스위프·자율 픽업의 일이다. 두 축은 배타적이라 이중 감시가 성립하지 않는다.
 *
 * ── 왜 시간 기반인가 (오늘 이미 밟은 함정을 다시 안 밟는다) ───────────────────
 * `composer-gate.ts` 의 `OCCUPANCY_CLAIM_STALE_MS` 도입 전, 관측 유효기간을
 * **흘러간 PTY 출력 문자 수**로 쟀다 — 오케가 조용하면 출력이 0이라 계량기가
 * 안 돌아 낡은 관측이 영원히 "지금"으로 남았다(27분·494회 교착). 같은 함정이
 * 여기도 있을 수 있다 — "정체 여부"를 스위프 틱 횟수나 출력량으로 재면, 조용해서
 * 안 도는 오케와 바쁘게 헛도는 오케를 구분하지 못한다.
 *
 * 그래서 이 판정은 **벽시계**로만 잰다: 활성 구간이 시작된 시각(마지막으로 유휴
 * 에서 busy 로 전환된 순간)과, 세 축 각각의 마지막 진전 시각. 둘 다 실제 사건이
 * 찍은 시각이지 카운터가 아니라서, 조용한 시간이 지나도 저절로 "방금 진전이
 * 있었다"로 굳지 않는다 — 오히려 반대로, 시간이 지날수록 정직하게 정체 쪽으로
 * 기운다.
 *
 * ── 세 축과 근거 ────────────────────────────────────────────────────────────
 *   ticketTransition  보드 티켓의 status/claimedBy 가 바뀌었다(닫혀서 관심
 *                      목록에서 사라진 것도 포함) — 스위프가 매 틱 이미 읽어
 *                      오는 attention 행을 이전 틱과 diff 해서 얻는다(새 I/O 없음).
 *   dispatch          그 diff 에서 claimedBy 가 비어 있다가 채워진 것 — 새
 *                      에이전트가 이 티켓을 집었다. ticketTransition 의 부분집합
 *                      이지만 "누가 뭘 하고 있나"를 오케에게 따로 보여줄 값어치가
 *                      있어 축을 나눴다.
 *   prStateChange     그 diff 에서 prUrl 이 새로 붙거나 값이 바뀐 것.
 *                      ★한계(정직하게 적는다): PR 이 열리거나 갈릴 때만 보이고,
 *                      체크 통과·리뷰 코멘트만으로는 이 필드가 안 바뀐다 —
 *                      GitHub 폴링을 새로 붙이지 않았다(이 티켓의 범위 밖).
 *                      이 축을 배선하지 않은 호출부는 `undefined` 를 준다 —
 *                      **모름은 0 이 아니다.** 판정에서 빠질 뿐, 모른다는 이유로
 *                      거짓 "정체"를 만들지도 거짓 "진행중"을 만들지도 않는다.
 *
 * ── 한도는 새로 만들지 않는다 ────────────────────────────────────────────────
 * `advance-guards.ts` 의 `evaluateAdvanceGuards`(연속 5·정체 2)를 그대로 부른다.
 * 새 신호는 기존 캡 **아래**에 있어야 한다는 티켓 지시 그대로다. 사장님 개입은
 * 같은 방식으로 한도를 리셋한다(호출부가 세션 상태를 관리 — `mission-advance.ts`
 * ·`orchestrator-idle-pickup.ts` 와 같은 규율).
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase/electron 을 import 하지 않는다. 라이브 보드 없이 진리표로 고정된다
 * (`tests/unit/orchestrator-active-stall.test.ts`).
 */

import {
  evaluateAdvanceGuards,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
} from "./mcp-server/advance-guards";

/** 활성 정체로 부르기까지 요구하는 무진전 시간 — 사장님 시나리오(10분)를 기본값으로 잡는다. */
export const ACTIVE_STALL_WINDOW_MS = 10 * 60_000;

export interface ActiveStallProgress {
  /** 이번 활성 구간 안 마지막 티켓 상태 전이 시각. 한 번도 없었으면 null. */
  lastTicketTransitionAt: number | null;
  /** 이번 활성 구간 안 마지막 dispatch(신규 claim) 시각. 없으면 null. */
  lastDispatchAt: number | null;
  /**
   * 이번 활성 구간 안 마지막 PR 상태 변화 시각. **배선 안 됐으면 undefined**
   * (모름 — 0 으로 접지 않는다). 배선됐는데 한 번도 없었으면 null.
   */
  lastPrStateChangeAt: number | null | undefined;
}

function axisIsQuiet(
  at: number | null | undefined,
  now: number,
  windowMs: number,
): boolean {
  if (at === undefined) return true; // 모름 — 이 축은 정체 판정을 막지 않는다
  if (at === null) return true; // 이번 활성 구간에 한 번도 없었다
  return now - at >= windowMs;
}

/** 세 축 중 하나라도 알려져 있는가. 전부 모르면 정체를 주장할 근거가 없다. */
function hasKnownAxis(p: ActiveStallProgress): boolean {
  return (
    p.lastTicketTransitionAt !== undefined ||
    p.lastDispatchAt !== undefined ||
    p.lastPrStateChangeAt !== undefined
  );
}

/**
 * 지금이 활성 정체인가 — 순수 판정.
 *
 * @param orchBusy 오케가 지금 busy 인가(`isOrchBusy` 를 그대로 쓴다 — 새 정의 없음).
 * @param activeSince 지금 활성 구간이 시작된 시각. 모르면(유휴 등) null.
 * @param progress 세 축의 마지막 진전 시각.
 * @param windowMs 판정 창(기본 10분).
 */
export function isActiveStall(
  now: number,
  orchBusy: boolean,
  activeSince: number | null,
  progress: ActiveStallProgress,
  windowMs: number = ACTIVE_STALL_WINDOW_MS,
): boolean {
  if (!orchBusy || activeSince === null) return false;
  if (now - activeSince < windowMs) return false;
  if (!hasKnownAxis(progress)) return false;
  return (
    axisIsQuiet(progress.lastTicketTransitionAt, now, windowMs) &&
    axisIsQuiet(progress.lastDispatchAt, now, windowMs) &&
    axisIsQuiet(progress.lastPrStateChangeAt, now, windowMs)
  );
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

export type ActiveStallAction = "NO_SIGNAL" | "SIGNAL" | "HALT";

export type ActiveStallCode =
  | "flag-off"
  | "no-session"
  | "orch-idle"
  | "warming-up"
  | "making-progress"
  | "already-halted"
  | "cooldown"
  | "stalled"
  | GuardCode;

export interface ActiveStallInput {
  /** 이 신호가 켜져 있는가. ★전진 신호·자율 픽업과 **같은 플래그 하나**를 공유한다. */
  enabled: boolean;
  sessionRunning: boolean;
  now: number;
  orchBusy: boolean;
  /** 지금 활성 구간이 시작된 시각. 유휴거나 모르면 null. */
  activeSince: number | null;
  progress: ActiveStallProgress;
  /** 이 판정이 마지막으로 신호를 낸 시각(쿨다운 근거). 없으면 null. */
  lastSignaledAt: number | null;
  /** 미해결 오너 질문 또는 미소비 오너 인바운드가 있는가. */
  ownerInputPending: boolean;
  state: AdvanceStateSnapshot;
  /** 진행 없음 한도 판정의 근거 — 이 프로젝트의 열린 attention 항목 수. */
  openCount: number;
  /** 메시지 배경 수치. 판정에는 쓰지 않는다(정보 전달용). */
  context?: { reviewCount?: number; stuckPrCount?: number };
  caps?: AdvanceCaps;
  windowMs?: number;
  /** 신호 재발송 최소 간격. 기본값 = windowMs(새 숫자를 만들지 않는다). */
  cooldownMs?: number;
}

export interface ActiveStallDecision {
  action: ActiveStallAction;
  code: ActiveStallCode;
  /** 사람이 읽는 사유. SIGNAL/HALT 면 반드시 비어 있지 않다(조용한 정지 금지). */
  reason: string;
  /** SIGNAL/HALT 일 때 오케 PTY 로 보낼 본문. 그 외엔 "". */
  message: string;
  /** 신호가 **배달됐을 때** 저장할 다음 상태. 배달 실패면 저장하지 않는다. */
  nextState?: {
    consecutiveSignals: number;
    stagnantSignals: number;
    lastOpenCount: number;
  };
  /** HALT 일 때 세션 상태에 박을 사유. */
  haltReason?: string;
}

function no(code: ActiveStallCode, reason: string): ActiveStallDecision {
  return { action: "NO_SIGNAL", code, reason, message: "" };
}

function minutes(ms: number): number {
  return Math.floor(ms / 60_000);
}

/**
 * 오케가 **이 메시지만 읽고** 무엇을 해야 하는지 알 수 있어야 한다 — "계속
 * 돌아라"가 아니라 무엇이 멈춰 있는지를 담는다(#1414/#1416 과 같은 요구).
 */
export function formatActiveStall(input: {
  activeForMs: number;
  windowMs: number;
  context?: { reviewCount?: number; stuckPrCount?: number };
}): string {
  const ctx: string[] = [];
  if (input.context?.reviewCount) {
    ctx.push(`REVIEW 대기 ${input.context.reviewCount}건`);
  }
  if (input.context?.stuckPrCount) {
    ctx.push(`PR ${input.context.stuckPrCount}건 정체`);
  }
  const ctxLine = ctx.length > 0 ? ` — ${ctx.join(", ")}` : "";
  return (
    `[활성 정체] 오케가 활성 상태로 ${minutes(input.activeForMs)}분째인데 ` +
    `최근 ${minutes(input.windowMs)}분 동안 티켓 전이·dispatch·PR 진전이 ` +
    `0건입니다${ctxLine} — 턴은 돌고 있지만 보드 진전이 없습니다.\n` +
    `권고: 지금 붙잡고 있는 것이 진전을 못 내고 있는지 점검하고, 대기 중인 ` +
    `REVIEW·PR·티켓 중 지금 처리할 수 있는 것을 집으라. 자율 진행으로 판단해 ` +
    `처리한 것은 add_activity 에 "활성 정체 감지로 처리" 를 남겨 사장님이 구분할 수 있게 하라.`
  );
}

/** HALT 본문 — 자율 정체 알림이 멈췄다는 사실은 반드시 사람이 볼 곳에 남는다. */
export function formatActiveStallHalt(reason: string): string {
  return (
    `[활성 정체] ⏸ 자율 정체 알림 정지\n` +
    `사유: ${reason}\n` +
    `이 오케 세션에서는 활성 정체 알림을 더 하지 않는다. 사장님 지시가 오면 해제된다.`
  );
}

/**
 * 활성 정체의 전체 판정. **판정 순서가 곧 우선순위다**:
 *
 *   0. 플래그 OFF        — 아무것도 읽지 않는다(기본값 OFF, 회귀 0)
 *   1. 세션 없음/미실행
 *   2. ★오케가 유휴      — 이 축의 관심사가 아니다(유휴 스위프가 담당)
 *   3. 판정 창 미도달     — 활성 구간이 아직 windowMs 에 못 미쳤다
 *   4. 진전 있음         — 세 축 중 하나라도 창 안에 있었다
 *   5. ★이미 HALT        — 메시지 없이 조용히 빠진다(같은 정지를 매 틱 떠들지 않는다)
 *   6. 쿨다운            — 방금 알렸으면 다시 알리지 않는다(폭주 방지)
 *   7. 한도(evaluateAdvanceGuards) → HALT | hold
 *   8. → SIGNAL
 */
export function evaluateActiveStall(
  input: ActiveStallInput,
): ActiveStallDecision {
  if (!input.enabled) {
    return no("flag-off", "활성 정체 감지가 꺼져 있다(기본값 OFF).");
  }
  if (!input.sessionRunning) {
    return no("no-session", "이 프로젝트의 오케 세션이 실행 중이 아니다.");
  }
  if (!input.orchBusy) {
    return no("orch-idle", "오케가 유휴다 — 유휴 스위프/자율 픽업의 관심사다.");
  }

  const windowMs = input.windowMs ?? ACTIVE_STALL_WINDOW_MS;
  if (input.activeSince === null || input.now - input.activeSince < windowMs) {
    return no(
      "warming-up",
      `활성 구간이 아직 판정 창(${minutes(windowMs)}분)에 못 미쳤다.`,
    );
  }
  if (
    !isActiveStall(
      input.now,
      input.orchBusy,
      input.activeSince,
      input.progress,
      windowMs,
    )
  ) {
    return no(
      "making-progress",
      `판정 창(${minutes(
        windowMs,
      )}분) 안에 티켓 전이·dispatch·PR 변화 중 최소 하나가 있었다.`,
    );
  }

  if ((input.state.haltReason ?? "").trim()) {
    return no(
      "already-halted",
      `자율 진행이 이미 정지 상태다 — ${input.state.haltReason}`,
    );
  }

  const cooldownMs = input.cooldownMs ?? windowMs;
  if (
    input.lastSignaledAt !== null &&
    input.now - input.lastSignaledAt < cooldownMs
  ) {
    return no(
      "cooldown",
      `같은 정체를 쿨다운(${minutes(cooldownMs)}분) 안에 다시 알리지 않는다.`,
    );
  }

  const guard = evaluateAdvanceGuards({
    state: input.state,
    openCount: input.openCount,
    ownerInputPending: input.ownerInputPending,
    caps: input.caps,
  });
  if (guard.outcome === "halt") {
    return {
      action: "HALT",
      code: guard.code,
      reason: guard.reason,
      message: formatActiveStallHalt(guard.reason),
      haltReason: guard.reason,
    };
  }
  if (guard.outcome === "hold") {
    return no(guard.code, guard.reason);
  }

  const activeForMs = input.now - input.activeSince;
  return {
    action: "SIGNAL",
    code: "stalled",
    reason: `활성 정체 감지 — ${minutes(activeForMs)}분째 진전 없음.`,
    message: formatActiveStall({
      activeForMs,
      windowMs,
      context: input.context,
    }),
    nextState: {
      consecutiveSignals: input.state.consecutiveSignals + 1,
      stagnantSignals: guard.nextStagnantSignals,
      lastOpenCount: input.openCount,
    },
  };
}
