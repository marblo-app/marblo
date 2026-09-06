/**
 * "PROCEED 무반응 재호출" 판정 — 미션 핸드오프가 오케에게 "지금 진행하라"
 * (PROCEED, `mission-handoff.ts`)를 넣었는데 그 후보 티켓이 그대로 TODO 로
 * 남아 있으면 다시 부른다 (티켓 xKhErJdSwDH3LIItFe42, P2→P1 격상, 사장님
 * 지시 2026-09-06 "2층 3,4는 최대한 가보자").
 *
 * ── 먼저 확인한 것 — 기존 셋으로 덮이지 않는다 ──────────────────────────────
 * `orchestrator-idle-pickup.ts`/`orchestrator-active-stall.ts` 는 둘 다
 * `OrchestratorBoardResync.tickOnce` 가 읽는 같은 `rows`(=`listAttentionTasks()`
 * 의 결과)를 본다. 그 쿼리는 `RESYNC_ATTENTION_STATUSES`
 * (REVIEW/FAILED/BLOCKED/CLAIMED/IN_PROGRESS)로 좁혀져 있고 **TODO 가 없다**
 * (`notify-resync-coverage.ts` — "DONE 과 TODO 가 없다는 것이 이 목록의
 * 핵심"). PROCEED 가 지목한 다음 후보 티켓은 오케가 아직 claim 하지 않았으면
 * TODO 로 남아 있으므로, 두 축 모두 그 행 자체를 보지 못한다.
 * `orchestrator-commitment-stall.ts` 는 오케가 **스스로 쓴** 약속 문장
 * (`work-chain-capture.ts` 의 source="auto" 포착)만 본다 — PROCEED 후보는
 * 이미 워크체인에 있던 항목(주로 manual/owner)이라 이 축의 포착 대상이
 * 아니다. 세 축 다 이 갭을 우연히만 덮을 뿐 보장하지 않는다.
 *
 * ── ★쿼리를 넓히지 않는다 ────────────────────────────────────────────────────
 * `listAttentionTasks()` 를 "TODO 포함"으로 넓히면 그 프로젝트의 평범한 TODO
 * 백로그 전체가 매 틱 후보가 된다 — 알림 폭주로 사람이 경고를 무시하게
 * 만드는 바로 그 실패 모드다. 좁히는 열쇠는 status 가 아니라
 * `missions/{id}.advanceState`(mission-handoff.ts 가 PROCEED 때 이미 적어
 * 두는 `handoffOutcome`/`handoffAskedAt`, 그리고 이 티켓이 추가하는
 * `handoffNextTaskId`)다 — 후보는 "PROCEED 를 낸 이 미션이 지목한 티켓
 * 한 건" 으로 정확히 좁혀진다.
 *
 * ── "안 움직였다" 를 프로젝트 전체 진전 diff 로 재지 않는다 ───────────────────
 * `orchestrator-active-stall.ts` 가 이미 계산해 두는 프로젝트 전역 진전
 * (티켓 전이·dispatch·PR)을 재사용하는 방법도 검토했지만 기각했다 — 그러면
 * PROCEED 후보와 무관한 다른 티켓 하나만 움직여도 "해결됨"으로 오판한다
 * (바쁜 보드일수록 더 자주 틀린다, false negative). 그래서 호출부는 이
 * 후보의 **근거 티켓 하나**의 현재 status 를 직접 읽어(`getTaskStatus`,
 * `fbGetDoc` 단건 읽기 — 새 쿼리도 새 인덱스도 아니다) 아직 `TODO` 인지만
 * 확인하고, 그 결과(이미 걸러진 "아직 정체인 미션" 목록)만 이 모듈에 넘긴다.
 *
 * ── 한도·플래그는 새로 안 만든다 ─────────────────────────────────────────────
 * `evaluateAdvanceGuards`(연속 5·정체 2)를 그대로 쓴다. 창은
 * `orchestrator-active-stall.ts` 의 `ACTIVE_STALL_WINDOW_MS`(10분, "사장님
 * 시나리오")를 그대로 import 해서 쓴다 — 새 숫자가 아니다. 플래그도 자율
 * 픽업·활성 정체·약속 정체와 같은 `MISSION_ADVANCE_SIGNAL` 하나를 공유한다.
 *
 * ── ★이 축만의 새 동작 — 조용히 포기하지 않는다 ─────────────────────────────
 * 다른 네 축은 HALT 되면 오케 PTY 에 한 번 알리고 그 세션 동안 조용해진다.
 * 이 축은 다르다 — PROCEED 는 "사장님 승인 없이 진행한다"는 자동 결정이라,
 * 그게 무반응으로 끝나면 사람이 몰라야 할 이유가 없다. `evaluateAdvanceGuards`
 * 가 HALT 를 낼 때(=연속/정체 한도를 다 썼다 = N 회 재호출에도 무반응) 호출부는
 * 오케 PTY 알림에 **더해** 사장님 채널로 1회 에스컬레이션한다(새 전송 채널이
 * 아니다 — `main.ts` 의 `AgentWatchdog.escalate` 가 이미 쓰는
 * `telegramPoller.sendMessage` 그대로).
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase/electron 을 import 하지 않는다. 라이브 보드 없이 진리표로 고정된다
 * (`tests/unit/orchestrator-mission-recall.test.ts`).
 */

import {
  evaluateAdvanceGuards,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
} from "./mcp-server/advance-guards";
import { ACTIVE_STALL_WINDOW_MS } from "./orchestrator-active-stall";

/**
 * PROCEED 이후 최소 이만큼은 기다린 뒤에야 "무반응"으로 본다.
 * `ACTIVE_STALL_WINDOW_MS` 와 같은 10분을 그대로 쓴다 — 새 숫자를 만들지
 * 않는다(이미 이 저장소에서 "이 정도 조용하면 정체로 본다"는 판단이 내려져
 * 있다).
 */
export const MISSION_RECALL_WINDOW_MS = ACTIVE_STALL_WINDOW_MS;

/**
 * 재호출 후보 1건 — 호출부가 이미 "PROCEED 를 냈고 근거 티켓이 아직 TODO"
 * 임을 확인한 미션만 여기로 넘긴다. status 판정은 이 모듈의 일이 아니다
 * (호출부의 `getTaskStatus` 단건 읽기가 이미 걸렀다).
 */
export interface StalledProceedMission {
  /** missions/{id}. */
  missionId: string;
  /** 사람이 읽는 라벨 — 신호/에스컬레이션 문장에 싣는다. */
  label: string;
  /** PROCEED 가 나간 시각(epoch ms) — `advanceState.handoffAskedAt`. */
  handoffAskedAt: number;
  /** PROCEED 가 지목한 1순위 후보의 근거 티켓 id. */
  nextTaskId: string;
  /** 문맥용 — 그 후보의 제목. 없으면 null. */
  nextWhat: string | null;
}

/** 이 미션의 PROCEED 가 창(windowMs) 이상 지났는가 — 아직이면 판단할 때가 아니다. */
export function isProceedOverdue(
  mission: StalledProceedMission,
  now: number,
  windowMs: number = MISSION_RECALL_WINDOW_MS,
): boolean {
  return now - mission.handoffAskedAt >= windowMs;
}

/**
 * 지금 다시 불러도 되는 것만 남긴다 — 창을 넘겼고, 쿨다운(같은 미션을 매 틱
 * 다시 부르지 않는다) 도 지났을 때만.
 */
export function selectRecallableMissions(
  missions: readonly StalledProceedMission[],
  now: number,
  recalledAt: ReadonlyMap<string, number>,
  windowMs: number = MISSION_RECALL_WINDOW_MS,
  cooldownMs: number = MISSION_RECALL_WINDOW_MS,
): StalledProceedMission[] {
  return missions.filter((m) => {
    if (!isProceedOverdue(m, now, windowMs)) return false;
    const last = recalledAt.get(m.missionId);
    if (last === undefined) return true;
    return now - last >= cooldownMs;
  });
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

export type MissionRecallAction = "NO_SIGNAL" | "SIGNAL" | "HALT";

export type MissionRecallCode =
  | "flag-off"
  | "no-session"
  | "already-halted"
  | "no-candidates"
  | "recalling"
  | GuardCode;

export interface MissionRecallInput {
  /** ★전진 신호·자율 픽업·활성 정체·약속 정체와 **같은 플래그 하나**를 공유한다. */
  enabled: boolean;
  sessionRunning: boolean;
  now: number;
  /** 호출부가 이미 "PROCEED 후보가 아직 TODO" 임을 확인한 미션 전체. */
  missions: readonly StalledProceedMission[];
  /** 이 세션에서 missionId → 마지막으로 재호출한 시각. */
  recalledAt: ReadonlyMap<string, number>;
  /** 미해결 오너 질문 또는 미소비 오너 인바운드가 있는가. */
  ownerInputPending: boolean;
  state: AdvanceStateSnapshot;
  caps?: AdvanceCaps;
  windowMs?: number;
  /** 같은 미션 재호출 최소 간격. 기본값 = windowMs(새 숫자를 만들지 않는다). */
  cooldownMs?: number;
}

export interface MissionRecallDecision {
  action: MissionRecallAction;
  code: MissionRecallCode;
  /** 사람이 읽는 사유. SIGNAL/HALT 면 반드시 비어 있지 않다. */
  reason: string;
  /** SIGNAL/HALT 일 때 오케 PTY 로 보낼 본문. 그 외엔 "". */
  message: string;
  /** SIGNAL 일 때만 — 이번에 실제로 재호출한 missionId(호출부가 recalledAt 갱신용). */
  recalledIds: string[];
  nextState?: {
    consecutiveSignals: number;
    stagnantSignals: number;
    lastOpenCount: number;
  };
  haltReason?: string;
  /**
   * ★HALT 일 때만 채워진다 — 사장님 채널로 보낼 에스컬레이션 본문. 조용한
   * 포기 금지가 이 축의 핵심 요구라, HALT 는 PTY 알림과 별개로 이 문구를
   * 반드시 들고 있다.
   */
  ownerEscalationMessage: string;
}

function no(code: MissionRecallCode, reason: string): MissionRecallDecision {
  return {
    action: "NO_SIGNAL",
    code,
    reason,
    message: "",
    recalledIds: [],
    ownerEscalationMessage: "",
  };
}

function minutes(ms: number): number {
  return Math.floor(ms / 60_000);
}

/** 오케에게 재호출 — 대신 실행하지 않는다, 대신 dispatch/claim 하지 않는다. */
export function formatMissionRecall(
  missions: readonly StalledProceedMission[],
  now: number,
): string {
  const lines = missions.map(
    (m) =>
      `· 미션 "${m.label}"(id=${m.missionId}) — ${minutes(
        now - m.handoffAskedAt,
      )}분 전 승인 없이 진행하라고 알렸는데${
        m.nextWhat ? ` ("${m.nextWhat}" 진행 지시)` : ""
      } 근거 티켓(id=${m.nextTaskId})이 아직 TODO 로 남아 있습니다`,
  );
  return (
    `[PROCEED 재호출] 토큰 잔여가 넉넉해 승인 없이 진행하라고 이미 알린 미션인데 ` +
    `아직 시작되지 않았습니다:\n${lines.join("\n")}\n` +
    `지금 바로 위 후보 티켓을 dispatch/claim 하거나, 진행할 수 없는 사유가 있으면 ` +
    `add_activity 로 남겨라. 계속 반응이 없으면 사장님께 에스컬레이션됩니다.`
  );
}

/** HALT 본문 — 왜 이 재호출이 멈췄는지 반드시 사람이 볼 곳에 남긴다. */
export function formatMissionRecallHalt(reason: string): string {
  return (
    `[PROCEED 재호출] ⏸ 재호출 정지\n` +
    `사유: ${reason}\n` +
    `이 오케 세션에서는 이 미션들의 PROCEED 재호출을 더 하지 않는다 — 사장님께 ` +
    `이미 알렸다. 사장님 지시가 오면 해제된다.`
  );
}

/**
 * ★조용한 포기 금지 — 사장님 채널로 나가는 에스컬레이션 본문.
 * `main.ts` 의 `AgentWatchdog.escalate` 와 같은 어조(사실 + 무엇이 필요한지).
 */
export function formatMissionRecallEscalation(
  missions: readonly StalledProceedMission[],
  now: number,
): string {
  const lines = missions.map(
    (m) =>
      `· "${m.label}"(id=${m.missionId}) — ${minutes(
        now - m.handoffAskedAt,
      )}분째 무반응`,
  );
  return (
    `🚨 [PROCEED 무반응] 오케에게 승인 없이 진행하라고 여러 번 알렸는데 ` +
    `반응이 없습니다:\n${lines.join("\n")}\n확인해 주세요.`
  );
}

/**
 * PROCEED 재호출의 전체 판정. **판정 순서가 곧 우선순위다**
 * (다른 네 축과 같은 순서):
 *
 *   0. 플래그 OFF        — 아무것도 읽지 않는다(기본값 OFF, 회귀 0)
 *   1. 세션 없음/미실행
 *   2. ★이미 HALT        — 메시지 없이 조용히 빠진다(에스컬레이션도 이미 갔다)
 *   3. 재호출할 후보 없음 — 창을 안 넘겼거나 전부 쿨다운 중이거나 이미 해소됨
 *   4. 한도(evaluateAdvanceGuards) → HALT | hold
 *   5. → SIGNAL(다이제스트 1통)
 */
export function evaluateMissionRecall(
  input: MissionRecallInput,
): MissionRecallDecision {
  if (!input.enabled) {
    return no("flag-off", "PROCEED 재호출이 꺼져 있다(기본값 OFF).");
  }
  if (!input.sessionRunning) {
    return no("no-session", "이 프로젝트의 오케 세션이 실행 중이 아니다.");
  }
  if ((input.state.haltReason ?? "").trim()) {
    return no(
      "already-halted",
      `PROCEED 재호출이 이미 정지 상태다 — ${input.state.haltReason}`,
    );
  }

  const windowMs = input.windowMs ?? MISSION_RECALL_WINDOW_MS;
  const cooldownMs = input.cooldownMs ?? windowMs;
  const recallable = selectRecallableMissions(
    input.missions,
    input.now,
    input.recalledAt,
    windowMs,
    cooldownMs,
  );
  if (recallable.length === 0) {
    return no(
      "no-candidates",
      `재호출할 PROCEED 무반응 미션이 없다(창 ${minutes(
        windowMs,
      )}분을 안 넘겼거나, 전부 쿨다운 중이거나, 이미 해소됐다).`,
    );
  }

  const guard = evaluateAdvanceGuards({
    state: input.state,
    openCount: recallable.length,
    ownerInputPending: input.ownerInputPending,
    caps: input.caps,
  });
  if (guard.outcome === "halt") {
    return {
      action: "HALT",
      code: guard.code,
      reason: guard.reason,
      message: formatMissionRecallHalt(guard.reason),
      recalledIds: [],
      haltReason: guard.reason,
      ownerEscalationMessage: formatMissionRecallEscalation(
        recallable,
        input.now,
      ),
    };
  }
  if (guard.outcome === "hold") {
    return no(guard.code, guard.reason);
  }

  return {
    action: "SIGNAL",
    code: "recalling",
    reason: `PROCEED 무반응 재호출 — ${recallable.length}건.`,
    message: formatMissionRecall(recallable, input.now),
    recalledIds: recallable.map((m) => m.missionId),
    nextState: {
      consecutiveSignals: input.state.consecutiveSignals + 1,
      stagnantSignals: guard.nextStagnantSignals,
      lastOpenCount: recallable.length,
    },
    ownerEscalationMessage: "",
  };
}
