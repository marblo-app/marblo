/**
 * 오케 자율 진행 — **깨울 조건의 판정 코어** (티켓 6hWxqjbzGQs1hzTUTihx).
 *
 * 설계 단일소스: `v3/docs/orch-idle-pickup-design-2026-09-05.md`.
 *
 * ── 사장님이 짚으신 것 ─────────────────────────────────────────────────────
 * _"리뷰티켓들 19개나 있는데 그것들 체크도 안하고 너는 서있잖아."_ 그리고
 * _"턴을 멈추지 말고 계속 돌아라라는 stdin 주입을 계속 줘야 되나?"_
 *
 * ★뒤의 처방은 그대로 만들지 않았다. "계속 돌아라"를 반복 주입하면 할 일이
 * 없을 때도 턴이 돌아 토큰이 나가고, 오케가 바쁠 때도 들어가 큐만 쌓이며,
 * #1416 이 세운 무한루프 방지 설계(연속 5·정체 2 에서 HALT)와 정면으로
 * 부딪힌다. 이 모듈이 답하는 것은 **"무엇이 있을 때 스스로 집는가"** 하나다.
 *
 * ── 왜 이 층이 필요한가 (실측 3건, 설계 §2) ────────────────────────────────
 *   ① 주기 스위프는 **이미 있다** — `orchestrator-board-resync.ts` 가 120초마다
 *      REVIEW/FAILED/BLOCKED/고아/체인READY 를 민다.
 *   ② ★그 스위프가 미션 티켓을 통째로 건너뛴다(`if (row.isMission) return null`).
 *      근거는 "컨덕터 report-watchdog 소관" 인데, 그 워치독은 `grantStep` 이 거는
 *      스텝별 타이머라 **명시 미션에만** 있다. 암묵 미션 티켓에도 `missionId` 가
 *      박히므로(`tools.ts` 의 implicit 채택), 암묵 미션의 REVIEW 는 스위프도
 *      컨덕터도 보지 않는 사각지대다 — 그게 19장의 정체다.
 *   ③ seen 집합은 **배달**만 센다. 세션당 1회 주입 후 다시 말하지 않으므로,
 *      오케가 그때 바빴으면 그 항목은 그 세션 동안 영영 재통보되지 않는다.
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase 도 electron 도 import 하지 않는다. I/O(보드 조회·PTY 주입)는
 * `OrchestratorBoardResync` 가 하고 판정은 전부 여기 있다 — `mission-advance.ts`
 * 와 `advance-guards.ts` 가 나뉜 것과 같은 규율이며, 그래서 깨울/안 깨울 조건이
 * 라이브 보드 없이 진리표로 고정된다(`tests/unit/orchestrator-idle-pickup.test.ts`).
 */

import {
  detectApprovalSignals,
  evaluateAdvanceGuards,
  evaluateSlotPressure,
  evaluateTokenBudgetGate,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
  type HarnessQuotaReading,
} from "./mcp-server/advance-guards";
import type {
  ResyncAttentionKind,
  ResyncTaskRow,
} from "./orchestrator-board-resync";

// ── 조율 상수 ───────────────────────────────────────────────────────────────

/**
 * 오케가 조용해진 뒤 "턴이 끝났다"로 보기까지의 창.
 *
 * ★새 정의를 만들지 않았다 — 텔레그램/슬랙 인바운드 nudge 가 답장 없는 메시지를
 * 다시 찌를 때 쓰는 **바로 그 턴 경계**(각 폴러의 `DEFAULT_NUDGE_IDLE_DEBOUNCE_MS`)
 * 와 같은 값이다. "오케의 턴이 끝났다"는 판정이 두 벌이면 어느 쪽이 진짜인지
 * 아무도 모른다. 실제 픽업 주기는 어차피 스위프 틱(120초)이 상한이라, 이 창은
 * "방금까지 타이핑 중이었나"만 가른다.
 */
export const IDLE_PICKUP_QUIET_WINDOW_MS = 6_000;

/**
 * 오케가 지금 작업 중인가. ★판정을 여기 한 자리에 둔다 — 호출부(스위프)도
 * "프로브를 돌릴지" 정할 때 같은 술어를 봐야 하고, 정의가 두 벌이면 바쁜데
 * 프로브만 돌리는(또는 그 반대의) 어긋남이 생긴다.
 *
 * `null`(부팅 후 busy 를 한 번도 못 봄)은 **모름이지 바쁨이 아니다.**
 */
export function isOrchBusy(
  orchIdleForMs: number | null,
  quietWindowMs: number = IDLE_PICKUP_QUIET_WINDOW_MS,
): boolean {
  return orchIdleForMs !== null && orchIdleForMs < quietWindowMs;
}

// ── 입력 모양 ───────────────────────────────────────────────────────────────

/** 픽업 후보 한 줄. 스위프가 이미 읽어 온 행에 판정 근거만 얹는다. */
export interface IdlePickupCandidate {
  row: ResyncTaskRow;
  kind: ResyncAttentionKind;
  /**
   * 왜 이 항목이 후보인가 — 설계 §3 의 두 조건.
   *   `unowned-mission` : 미션 티켓인데 미션 오케가 안 돈다(아무도 안 본다)
   *   `stale`           : 이미 통보했는데 보드가 그대로다(전했지만 안 움직였다)
   */
  why: IdlePickupReason;
}

export type IdlePickupReason = "unowned-mission" | "stale";

export interface IdlePickupInput {
  /** `isAdvanceSignalEnabled()` — 전진 신호와 **같은 플래그 하나**를 공유한다. */
  enabled: boolean;
  /** 이 프로젝트의 오케 세션이 running 인가. */
  sessionRunning: boolean;
  /**
   * 오케가 마지막 busy 신호 이후 조용한 시간(ms). `null` 은 **모름**이다
   * (부팅 후 busy 를 한 번도 못 봄) — 바쁨으로 접지 않는다. 모름을 차단으로
   * 읽으면 관측이 없는 기기에서 폐루프가 영영 멈춘다(토큰 게이트 `no-data` 와
   * 같은 판단).
   */
  orchIdleForMs: number | null;
  /** 이번 틱에 스위프가 이미 주입했는가 — 방금 바쁘게 만든 자리에 또 넣지 않는다. */
  resyncInjectedThisTick: boolean;
  /** 이 프로젝트의 픽업 후보 전체(승인필요 포함 — 가르는 것은 이 모듈이 한다). */
  candidates: readonly IdlePickupCandidate[];
  /** 이 프로젝트의 열린 attention 항목 수 — 진행 없음 판정의 근거. */
  openCount: number;
  /** 지금 도는 티켓 수(CLAIMED/IN_PROGRESS) — 슬롯 back-pressure 의 근거. */
  inFlightCount: number;
  /** 미소비 오너 인바운드가 있는가. 사장님 지시가 자율 진행보다 **항상 우선**. */
  ownerInputPending: boolean;
  /** 이 오케 PTY 세션의 자율 진행 상태(인메모리 — 설계 §5-1). */
  state: AdvanceStateSnapshot;
  /**
   * 토큰 잔여. ★새 게이트가 아니라 #1416 의 `evaluateTokenBudgetGate` 를 그대로
   * 부른다 — 사용량 탭이 그리는 그 실측(`account-usage.getAccountRateLimits`)이
   * 유일한 소스다. `null` 은 **안 읽었다**는 뜻이고 소진이 아니다(모름을 소진으로
   * 접으면 프로브가 없는 기기에서 폐루프가 영영 멈춘다).
   */
  quota?: { rows: readonly HarnessQuotaReading[]; reservePct: number } | null;
  quietWindowMs?: number;
  caps?: AdvanceCaps;
}

// ── 출력 모양 ───────────────────────────────────────────────────────────────

export type IdlePickupAction = "NO_PICKUP" | "PICKUP" | "HALT";

export type IdlePickupCode =
  | "flag-off"
  | "no-session"
  | "orch-busy"
  | "resync-just-injected"
  | "nothing-stale"
  | "token-insufficient"
  | "pickup"
  | GuardCode;

export interface IdlePickupDecision {
  action: IdlePickupAction;
  code: IdlePickupCode;
  /** 사람이 읽는 사유. HALT/PICKUP 이면 반드시 비어 있지 않다(조용한 정지 금지). */
  reason: string;
  /** 자율로 밀 항목. **승인필요는 여기 절대 안 들어간다.** */
  picked: IdlePickupCandidate[];
  /** 승인필요라 자율 대상에서 뺀 항목 — 정보로만 싣는다. */
  withheld: IdlePickupCandidate[];
  /** PICKUP/HALT 일 때 오케 PTY 로 보낼 본문. 그 외엔 "". */
  message: string;
  /** 픽업이 **배달됐을 때** 저장할 다음 상태. 배달 실패면 저장하지 않는다. */
  nextState?: {
    consecutiveSignals: number;
    stagnantSignals: number;
    lastOpenCount: number;
  };
  /** HALT 일 때 세션 상태에 박을 사유. */
  haltReason?: string;
}

// ── 후보 판정 ───────────────────────────────────────────────────────────────

/**
 * 승인필요 표지가 잡히는가. ★새 분류기를 만들지 않았다 —
 * `advance-guards.ts :: detectApprovalSignals` 를 그대로 부른다. 배포·메일발송·
 * 결제·심사기간 화면이 자율 경로에서 빠지는 기준이 두 벌이면 그중 하나는 반드시
 * 느슨해진다.
 *
 * ★스캔 면이 좁다: 스위프 행에는 본문(description)이 없다. 그래서 여기서 놓친
 * 승인필요 티켓이 있을 수 있는데, 그 경우에도 자율 픽업이 하는 일은 **오케에게
 * 목록을 보여주는 것**뿐이고 스폰은 오케가 한다 — 그리고 오케가 스폰하려는
 * 순간 `classifySiblings`(본문까지 보는 넓은 스캔)가 다시 한 번 가른다.
 */
export function pickupNeedsApproval(row: ResyncTaskRow): boolean {
  return detectApprovalSignals({ title: row.title ?? null }).length > 0;
}

/**
 * 이 행이 픽업 후보인가 — 설계 §3 의 두 조건을 한 자리에서 판정한다.
 * 후보가 아니면 `null`.
 *
 * @param alreadyTold 이 오케 세션에 스위프가 이미 통보한 항목인가(seen 집합).
 * @param missionOrchRunning 이 프로젝트에 미션 오케가 도는가.
 * @param staleAfterMs 보드 활동이 이만큼 없으면 "안 움직였다". ★새 숫자가
 *        아니다 — 스위프의 기존 `orphanMinAgeMs`(600초) 를 그대로 받는다.
 */
export function classifyIdlePickup(
  row: ResyncTaskRow,
  kind: ResyncAttentionKind,
  alreadyTold: boolean,
  missionOrchRunning: boolean,
  staleAfterMs: number,
): IdlePickupReason | null {
  // A. 주인 없는 미션 티켓 — 스위프가 건너뛰었고 컨덕터도 안 본다(설계 §2-2).
  //    미션 오케가 돌고 있으면 그쪽이 주인이므로 건드리지 않는다(이중 감시 금지).
  if (row.isMission) {
    return missionOrchRunning ? null : "unowned-mission";
  }

  // B. 정체 — 통보는 갔는데 보드가 그대로다(설계 §2-3). 통보한 적이 없으면
  //    스위프가 이번 틱에 처음 밀 것이므로 픽업의 일이 아니다.
  if (!alreadyTold) return null;
  // 나이를 모르면(null) 정체라고 부르지 않는다. ★스위프의 나이 게이트와 방향이
  // 반대인 것이 의도다 — 저기서 모름은 "숨기지 않는다"(통과)이고 여기서 모름은
  // "안 움직였다는 근거가 없다"(제외)다. 첫 통보는 이미 갔으므로 유실이 아니다.
  if (row.ageMs === null) return null;
  return row.ageMs >= staleAfterMs ? "stale" : null;
}

// ── 신호 본문 ───────────────────────────────────────────────────────────────

const WHY_LINE: Record<IdlePickupReason, (c: IdlePickupCandidate) => string> = {
  "unowned-mission": (c) =>
    `· 미션 티켓(주인 없음): "${c.row.title ?? c.row.taskId}" (id=${
      c.row.taskId
    }, status=${c.row.status}` +
    `${c.row.role ? `, ${c.row.role}` : ""}${
      c.row.prUrl ? `, PR: ${c.row.prUrl}` : ""
    }) — ` +
    `미션 오케가 돌지 않아 이 티켓을 보는 감시자가 없습니다`,
  stale: (c) =>
    `· ${c.row.status} 정체: "${c.row.title ?? c.row.taskId}" (id=${
      c.row.taskId
    }` +
    `${c.row.role ? `, ${c.row.role}` : ""}${
      c.row.prUrl ? `, PR: ${c.row.prUrl}` : ""
    }) — ` +
    `${describeAge(c.row.ageMs)}째 그대로이고 이미 통보한 항목입니다`,
};

function describeAge(ageMs: number | null): string {
  if (ageMs === null) return "시간 미상";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

/**
 * 오케가 **이 메시지만 읽고** 다음 행동을 정할 수 있어야 한다 — #1414 의
 * `formatAdvanceSignal` 과 같은 요구다. 그래서 "돌아라"가 아니라 항목별로
 * **무엇이 왜 대기 중인지**를 싣는다.
 */
export function formatIdlePickup(input: {
  picked: readonly IdlePickupCandidate[];
  withheld: readonly IdlePickupCandidate[];
  slotNote?: string;
  maxItems: number;
}): string {
  const { picked, withheld } = input;
  const lines = picked.map((c) => WHY_LINE[c.why](c));
  const shown = lines.slice(0, input.maxItems);
  const omitted = lines.length - shown.length;

  const out: string[] = [
    `[자율 진행] 오케가 유휴 상태인데 아래 ${picked.length}건이 아직 움직이지 않았습니다 — ` +
      `개별 알림은 이미 갔거나(정체) 이 항목을 보는 감시자가 없습니다(주인 없는 미션).`,
    ...shown,
  ];
  if (omitted > 0) {
    out.push(`· …외 ${omitted}건 — get_all_tasks 로 나머지를 확인하세요`);
  }
  if (withheld.length > 0) {
    out.push(
      `🔒 사장님 승인 필요 (${withheld.length}) — ★자율 대상 아님. 집지 말고 사장님께 여쭤라:`,
    );
    for (const c of withheld.slice(0, input.maxItems)) {
      out.push(`· "${c.row.title ?? c.row.taskId}" (id=${c.row.taskId})`);
    }
  }
  out.push(
    input.slotNote
      ? `권고: ${input.slotNote} 위 항목은 새로 뽑지 말고 상태 확인·검증·반려로만 처리하라.`
      : `권고: 위 ${picked.length}건을 처리하라(검증/머지·반려·재배정). 자율 진행으로 집은 것은 ` +
          `add_activity 에 "자율 진행으로 집음" 을 남겨 사장님이 구분할 수 있게 하라.`,
  );
  return out.join("\n");
}

/** HALT 본문 — 자율 픽업이 멈췄다는 사실은 반드시 사람이 볼 곳에 남는다. */
export function formatIdlePickupHalt(reason: string): string {
  return (
    `[자율 진행] ⏸ 오케 자율 픽업 정지\n` +
    `사유: ${reason}\n` +
    `이 오케 세션에서는 자율 픽업을 더 하지 않는다. 사장님 지시가 오면 해제된다.`
  );
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

function no(code: IdlePickupCode, reason: string): IdlePickupDecision {
  return {
    action: "NO_PICKUP",
    code,
    reason,
    picked: [],
    withheld: [],
    message: "",
  };
}

/** 한 메시지에 싣는 항목 상한 — 스위프 다이제스트와 같은 규율(폭주 방지). */
export const IDLE_PICKUP_MAX_ITEMS = 15;

/**
 * 자율 픽업의 전체 판정. **판정 순서가 곧 우선순위다**(설계 §7):
 *
 *   0. 플래그 OFF        — 아무것도 읽지 않는다(기본값 OFF, 회귀 0)
 *   1. 세션 없음/미실행
 *   2. ★오케가 바쁨      — 한도 **앞**이다. 빈 틱·바쁜 틱이 한도를 태우면
 *                          할 일이 있을 때 정작 한도가 남아 있지 않다
 *   3. 스위프가 방금 주입 — 같은 틱에 두 번 넣지 않는다
 *   4. ★이미 HALT        — 메시지 없이 조용히 빠진다. #1414 는 매번 HALT 를
 *                          다시 알리지만 저긴 티켓 완료마다 한 번이고 여긴 120초
 *                          틱이라, 같은 정지를 하루 720번 떠들게 된다
 *   5. 후보 0            — 상태를 건드리지 않는다
 *   6. 한도(evaluateAdvanceGuards) → HALT | hold
 *   7. 토큰 잔여          — 예비선 이하면 이번엔 밀지 않는다(HALT 아님)
 *   8. 슬롯 back-pressure → PICKUP
 */
export function evaluateIdlePickup(input: IdlePickupInput): IdlePickupDecision {
  if (!input.enabled) {
    return no("flag-off", "자율 진행이 꺼져 있다(기본값 OFF).");
  }
  if (!input.sessionRunning) {
    return no("no-session", "이 프로젝트의 오케 세션이 실행 중이 아니다.");
  }

  const quiet = input.quietWindowMs ?? IDLE_PICKUP_QUIET_WINDOW_MS;
  // ★null 은 모름이지 바쁨이 아니다 — 통과시킨다(모듈 주석의 근거).
  if (isOrchBusy(input.orchIdleForMs, quiet)) {
    return no(
      "orch-busy",
      `오케가 아직 작업 중이다(마지막 활동 ${input.orchIdleForMs}ms 전, 기준 ${quiet}ms) — ` +
        `바쁜데 또 넣으면 큐만 쌓인다.`,
    );
  }
  if (input.resyncInjectedThisTick) {
    return no(
      "resync-just-injected",
      "이번 틱에 재동기화 다이제스트가 이미 주입됐다 — 방금 밀어놓고 또 밀지 않는다.",
    );
  }

  // ★이미 HALT 면 조용히 빠진다(위 4번). 사장님 개입은 아래 hold 가 아니라
  //   호출부가 상태를 리셋해 해제한다(설계 §5-2) — 인메모리라 사람이 만질
  //   손잡이가 없어서, 사장님 인바운드가 그 손잡이다.
  if ((input.state.haltReason ?? "").trim()) {
    return no(
      "already-halted",
      `자율 픽업이 이미 정지 상태다 — ${input.state.haltReason}`,
    );
  }

  const withheld = input.candidates.filter((c) => pickupNeedsApproval(c.row));
  const picked = input.candidates.filter((c) => !pickupNeedsApproval(c.row));

  if (picked.length === 0) {
    // ★상태를 건드리지 않는다. 빈 틱이 한도를 태우면 "할 일이 없어서 안 깨웠는데
    //   한도만 소진" 이라는 이상한 상태가 된다.
    return no(
      "nothing-stale",
      withheld.length > 0
        ? `자율로 집을 항목이 없다 — 후보 ${withheld.length}건은 전부 사장님 승인 필요라 자율 대상이 아니다.`
        : "지금 자율로 집을 항목이 없다.",
    );
  }

  // 한도 — #1414/#1416 과 **같은 함수, 같은 기본값**을 그대로 부른다.
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
      picked: [],
      withheld,
      message: formatIdlePickupHalt(guard.reason),
      haltReason: guard.reason,
    };
  }
  if (guard.outcome === "hold") {
    return no(guard.code, guard.reason);
  }

  // ★토큰 잔여 — 사장님 지시의 "잔여량 부족" 자리다. #1416 의 게이트를 그대로
  //   부른다(새 임계 없음: 예비선은 라우터가 near-limit 을 자르는 그 선이다).
  //   ★HALT 가 아니다 — 한도 창이 지나면 저절로 풀리는 상태를 사람이 풀어야 하는
  //   정지로 만들지 않는다(슬롯 back-pressure 와 같은 판단).
  if (input.quota) {
    const token = evaluateTokenBudgetGate(
      input.quota.rows,
      input.quota.reservePct,
    );
    if (!token.allowSpawn) {
      return no("token-insufficient", token.reason);
    }
  }

  // 슬롯 포화는 HALT 가 아니라 back-pressure — 티켓 하나가 끝나면 저절로 풀리는
  // 상태를 사람이 풀어야 하는 정지로 만들지 않는다(`evaluateSlotPressure` 주석).
  const pressure = evaluateSlotPressure(input.inFlightCount, input.caps);

  return {
    action: "PICKUP",
    code: "pickup",
    reason: pressure.saturated
      ? (pressure.reason ?? "슬롯 포화")
      : `유휴 오케에 미처리 ${picked.length}건을 알린다(승인필요 ${withheld.length}건 제외).`,
    picked,
    withheld,
    message: formatIdlePickup({
      picked,
      withheld,
      slotNote: pressure.reason,
      maxItems: IDLE_PICKUP_MAX_ITEMS,
    }),
    nextState: {
      consecutiveSignals: input.state.consecutiveSignals + 1,
      stagnantSignals: guard.nextStagnantSignals,
      lastOpenCount: input.openCount,
    },
  };
}
