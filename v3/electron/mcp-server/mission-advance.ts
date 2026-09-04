/**
 * 미션 전진 신호의 **결정 코어** (티켓 Sf8Id64jLeyDvWIS4cub).
 *
 * 설계 단일소스: `v3/docs/mission-advance-signal-design-2026-09-04.md`.
 * 사장님 지시: _"이게 그 미션을 닫는 최종 태스크인지 아님 그중 하나인지가 체크되면서,
 * 그중 하나면 다음 태스크를 연달아 오케한테 알아서 스폰하도록 하는 메시지가 오케한테
 * 들어가야 폐루프가 돌 것 같은데"_.
 *
 * ── 이 모듈이 답하는 것 ────────────────────────────────────────────────────
 *   방금 DONE 된 티켓이  ①어느 미션 소속인가 → ②그 미션의 마지막인가 →
 *   ③아니면 무엇을 오케에게 알려야 다음을 집을 수 있나.
 *
 * ── 이 모듈이 하지 않는 것 ─────────────────────────────────────────────────
 *   • 명시 미션(steps>0)은 건드리지 않는다 — 지휘자(conductor-driver)가 이미
 *     grant/`mission_step_done` 루프로 운전한다. 두 경로는 `missionKind` 하나로
 *     **구조적으로 배타**라 이중 스폰이 성립할 수 없다(설계 §6).
 *   • 새 태스크를 만들지 않는다. 이미 있는 형제 티켓을 오케에게 **분류해서**
 *     보여줄 뿐이다. 암묵 미션의 라벨은 라벨로 남는다.
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase 를 import 하지 않는다. Firestore I/O 는 `tools.ts` 가 하고, 판정은
 * 전부 여기 순수 함수로 있다(`tests/unit/mission-advance-signal.test.ts`).
 */
import { isLaneContextId } from "./context.js";
import {
  isImplicitMissionComplete,
  isImplicitMissionDoc,
} from "./implicit-mission.js";
import {
  alreadySignaled,
  detectApprovalSignals,
  evaluateAdvanceGuards,
  evaluateSlotPressure,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
} from "./advance-guards.js";

// ── 입력 모양 ───────────────────────────────────────────────────────────────

/** 형제 티켓의 읽기용 모양 — 판정에 필요한 필드만. */
export interface AdvanceSiblingTask {
  id: string;
  title?: string | null;
  status?: string | null;
  role?: string | null;
  priority?: number | null;
  claimedBy?: string | null;
  dependsOn?: readonly string[] | null;
  /** `get_available_tasks` 가 쓰는 바로 그 readiness 플래그. */
  dependsOnCompleted?: boolean | null;
  description?: string | null;
  comment?: string | null;
  notes?: readonly string[] | null;
  deleted?: boolean | null;
}

/** 미션 문서의 읽기용 모양. */
export interface AdvanceMissionDoc {
  id: string;
  status?: string | null;
  missionKind?: string | null;
  implicitLabel?: string | null;
  goal?: string | null;
  /** 명시 미션이면 길이>0. 지휘자 소유 판정의 보조 근거. */
  steps?: readonly unknown[] | null;
}

export interface AdvanceInput {
  /** 방금 DONE 으로 닫힌 티켓. */
  finishedTaskId: string;
  finishedTaskTitle?: string | null;
  /** 그 티켓의 contextId — 미션 귀속의 유일한 근거. */
  contextId?: string | null;
  /** contextId 로 읽은 미션 문서. 없으면 null(=미션 아님). */
  mission: AdvanceMissionDoc | null;
  /** 같은 미션에 속한 전체 티켓(방금 닫힌 것 포함). */
  siblings: readonly AdvanceSiblingTask[];
  /** 미션의 자율 진행 상태. */
  state: AdvanceStateSnapshot;
  /** 미해결 오너 질문 또는 미소비 오너 인바운드가 있는가. */
  ownerInputPending: boolean;
  /** 플래그. false 면 아무것도 읽지 않고 끝난다(기본 OFF). */
  enabled: boolean;
  caps?: AdvanceCaps;
}

// ── 출력 모양 ───────────────────────────────────────────────────────────────

export type AdvanceAction =
  /** 아무 신호도 내지 않는다(정상). */
  | "NO_SIGNAL"
  /** 이 티켓이 마지막이었다 — 미션을 닫는다. 신호는 나가지 않는다. */
  | "CLOSE_MISSION"
  /** 중간이다 — 오케에게 다음을 밀어준다. */
  | "SIGNAL_ADVANCE"
  /** 안전장치에 걸렸다 — 자율 진행을 멈추고 **사유를 남긴다**. */
  | "HALT";

export type AdvanceCode =
  | "flag-off"
  | "not-a-mission"
  | "mission-missing"
  | "conductor-owned"
  | "mission-terminal"
  | "duplicate-completion"
  | "mission-complete"
  | "advance"
  | GuardCode;

/** 형제 티켓을 4갈래로 가른 결과 — 신호 본문의 실체(설계 §5). */
export interface AdvanceBuckets {
  /** 지금 바로 dispatch 해도 되는 것. `get_available_tasks` 와 같은 조건. */
  readyNow: AdvanceSiblingTask[];
  /** 선행 의존이 아직 안 풀린 것. 손대면 안 된다. */
  blocked: AdvanceSiblingTask[];
  /** 이미 도는 것. 또 뽑으면 중복이다. */
  inFlight: AdvanceSiblingTask[];
  /** 사장님 승인이 필요한 것. **자율 스폰 대상이 아니다.** */
  needsOwnerApproval: AdvanceSiblingTask[];
}

export interface AdvanceVerdict {
  action: AdvanceAction;
  code: AdvanceCode;
  /** 사람이 읽는 사유. HALT 면 반드시 비어 있지 않다(조용한 정지 금지). */
  reason: string;
  /** 미션의 열린 티켓 수(방금 닫힌 것 제외 후). */
  openCount: number;
  buckets: AdvanceBuckets;
  /** SIGNAL_ADVANCE / HALT 일 때 오케 PTY 로 보낼 본문. 그 외엔 "". */
  message: string;
  /**
   * 신호가 **실제로 배달됐을 때** 미션 문서에 저장할 상태.
   * 배달 실패(failed)면 저장하지 않는다 — 닿지도 않은 신호를 한도에 세면
   * 미션이 진행 없이 한도만 태우고 멈춘다(설계 §7).
   */
  nextState?: {
    consecutiveSignals: number;
    stagnantSignals: number;
    lastOpenCount: number;
    signaledTaskId: string;
  };
  /** HALT 일 때 미션 문서에 박을 사유. */
  haltReason?: string;
}

// ── 귀속 판정 ───────────────────────────────────────────────────────────────

/**
 * 이 contextId 가 미션인가. `board` 와 Quick Lane 은 미션이 아니다 —
 * 그런 티켓은 단발 작업이라 전진 신호의 대상이 아니다.
 */
export function isMissionContextId(
  contextId: string | null | undefined,
): boolean {
  if (!contextId) return false;
  const id = contextId.trim();
  if (!id || id === "board") return false;
  return !isLaneContextId(id);
}

const TERMINAL_MISSION_STATUSES = new Set(["completed", "abandoned", "failed"]);
const IN_FLIGHT_STATUSES = new Set(["CLAIMED", "IN_PROGRESS", "REVIEW"]);

function isOpenTask(t: AdvanceSiblingTask): boolean {
  const s = String(t.status ?? "");
  return s !== "DONE" && s !== "FAILED";
}

// ── 4갈래 분류 ──────────────────────────────────────────────────────────────

/**
 * 형제 티켓을 오케가 행동할 수 있는 4갈래로 가른다.
 *
 * ★`readyNow` 의 조건은 `get_available_tasks` 의 쿼리와 **정확히 같다**
 * (`status=="TODO"` ∧ `dependsOnCompleted==true` ∧ 미클레임). 새 readiness
 * 개념을 만들지 않았다 — 피드가 "집을 수 있다"고 말하는 것과 신호가 "집을 수
 * 있다"고 말하는 것이 어긋나면 그게 버그다.
 *
 * 승인 필요 티켓은 다른 어느 갈래보다 **먼저** 빠진다. TODO 이고 의존이 다
 * 풀렸어도 배포/메일/결제/심사화면이면 자율 스폰 대상이 아니다.
 */
export function classifySiblings(
  siblings: readonly AdvanceSiblingTask[],
  finishedTaskId: string,
): AdvanceBuckets {
  const buckets: AdvanceBuckets = {
    readyNow: [],
    blocked: [],
    inFlight: [],
    needsOwnerApproval: [],
  };
  for (const t of siblings) {
    if (t.deleted) continue;
    if (t.id === finishedTaskId) continue;
    if (!isOpenTask(t)) continue;

    const status = String(t.status ?? "");
    if (IN_FLIGHT_STATUSES.has(status)) {
      buckets.inFlight.push(t);
      continue;
    }

    // ★승인 필요는 다른 판정보다 앞선다 — 자율 경로가 절대 집지 않게.
    if (
      detectApprovalSignals({
        title: t.title,
        description: t.description,
        comment: t.comment,
        notes: t.notes,
      }).length > 0
    ) {
      buckets.needsOwnerApproval.push(t);
      continue;
    }

    if (status === "TODO" && t.dependsOnCompleted === true && !t.claimedBy) {
      buckets.readyNow.push(t);
      continue;
    }
    // TODO 인데 의존 미충족 / BLOCKED / 클레임만 남은 잔여 — 전부 "지금은 아니다".
    buckets.blocked.push(t);
  }
  return buckets;
}

// ── 신호 본문 ───────────────────────────────────────────────────────────────

/**
 * 티켓 한 줄. ★id·제목·역할·상태만 나간다 — PTY 원문도, 주입 메시지 본문도,
 * 토큰도 넣지 않는다(#1412 가 세운 규약). 제목은 보드에 이미 공개된 값이다.
 */
function line(t: AdvanceSiblingTask, extra?: string): string {
  const meta: string[] = [];
  if (t.role) meta.push(String(t.role));
  if (typeof t.priority === "number") meta.push(`prio ${t.priority}`);
  const metaNote = meta.length > 0 ? ` (${meta.join(", ")})` : "";
  const title = (t.title ?? "").trim() || "(제목 없음)";
  return `  - [${t.id}] "${title}"${metaNote}${extra ?? ""}`;
}

/**
 * 오케가 **이 메시지만 읽고** 다음 dispatch 를 결정할 수 있어야 한다 —
 * 그게 이 티켓의 완료 기준이다. 그래서 남은 목록이 아니라 4갈래를 담는다.
 */
export function formatAdvanceSignal(input: {
  missionId: string;
  label: string;
  finishedTaskId: string;
  finishedTaskTitle?: string | null;
  openCount: number;
  buckets: AdvanceBuckets;
  slotNote?: string;
}): string {
  const { buckets } = input;
  const title = (input.finishedTaskTitle ?? "").trim() || "(제목 없음)";
  const out: string[] = [
    `[Mission Advance] '${input.label}' 전진 — 방금 닫힘: "${title}" (id=${input.finishedTaskId})`,
    `미션 ${input.missionId} · 남음 ${input.openCount}건 / 지금 가능 ${buckets.readyNow.length}건 / ` +
      `대기 ${buckets.blocked.length}건 / 진행중 ${buckets.inFlight.length}건 / ` +
      `승인필요 ${buckets.needsOwnerApproval.length}건`,
  ];

  if (buckets.readyNow.length > 0) {
    out.push(
      `▶ 지금 집을 수 있음 (${buckets.readyNow.length}) — 선행 의존 충족·미클레임:`,
    );
    for (const t of buckets.readyNow) out.push(line(t));
  }
  if (buckets.blocked.length > 0) {
    out.push(`⏸ 아직 막힘 (${buckets.blocked.length}) — 지금 집지 마라:`);
    for (const t of buckets.blocked) {
      const waits = (t.dependsOn ?? []).filter(Boolean);
      const why =
        waits.length > 0
          ? ` ← 대기: ${waits.join(", ")}`
          : ` ← ${String(t.status ?? "")}`;
      out.push(line(t, why));
    }
  }
  if (buckets.inFlight.length > 0) {
    out.push(`⚙ 진행중 (${buckets.inFlight.length}) — 또 뽑지 마라:`);
    for (const t of buckets.inFlight) out.push(line(t, ` (${t.status})`));
  }
  if (buckets.needsOwnerApproval.length > 0) {
    out.push(
      `🔒 사장님 승인 필요 (${buckets.needsOwnerApproval.length}) — ★자율 스폰 대상 아님. 사장님께 여쭤라:`,
    );
    for (const t of buckets.needsOwnerApproval) out.push(line(t));
  }

  if (input.slotNote) {
    out.push(`권고: ${input.slotNote}`);
  } else if (buckets.readyNow.length > 0) {
    out.push(
      `권고: 위 "지금 집을 수 있음" ${buckets.readyNow.length}건을 dispatch 하라. 나머지는 건드리지 마라.`,
    );
  } else if (buckets.inFlight.length > 0) {
    out.push(
      `권고: 지금 집을 수 있는 것이 없다 — 진행중 ${buckets.inFlight.length}건이 끝나기를 기다려라.`,
    );
  } else {
    out.push(
      `권고: 지금 집을 수 있는 것이 없다 — 위 대기/승인필요 항목의 선행 조건을 먼저 풀어야 한다.`,
    );
  }
  return out.join("\n");
}

/** HALT 본문 — 사람이 개입해야 풀리므로 반드시 오케를 깨운다. */
export function formatAdvanceHalt(input: {
  missionId: string;
  label: string;
  reason: string;
}): string {
  return (
    `[Mission Advance] ⏸ '${input.label}' 자율 전진 정지 (미션 ${input.missionId})\n` +
    `사유: ${input.reason}\n` +
    `자율 스폰은 여기서 멈춘다. 사장님 확인 없이 재개하지 마라.`
  );
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

function emptyBuckets(): AdvanceBuckets {
  return { readyNow: [], blocked: [], inFlight: [], needsOwnerApproval: [] };
}

function no(
  code: AdvanceCode,
  reason: string,
  openCount = 0,
  buckets = emptyBuckets(),
): AdvanceVerdict {
  return { action: "NO_SIGNAL", code, reason, openCount, buckets, message: "" };
}

/**
 * 완료 후크의 전체 판정. 설계 §8 의 순서를 그대로 따른다 —
 * **한도 판정이 전진 판정보다 위에 있다**(안전장치가 아래에 깔린다).
 */
export function evaluateMissionAdvance(input: AdvanceInput): AdvanceVerdict {
  // 0. 기본값 OFF. 꺼져 있으면 아무것도 읽지 않고 끝난다(회귀 0).
  if (!input.enabled) {
    return no("flag-off", "자율 전진 신호가 꺼져 있다(기본값 OFF).");
  }

  // 1. 귀속 — board / lane 단발 티켓은 미션 소속이 아니다.
  if (!isMissionContextId(input.contextId)) {
    return no(
      "not-a-mission",
      "미션에 속하지 않는 단발 티켓이라 전진 신호 대상이 아니다.",
    );
  }
  const mission = input.mission;
  if (!mission) {
    return no("mission-missing", "contextId 에 해당하는 미션 문서가 없다.");
  }

  // 2. ★지휘자 소유 경계 — 명시 미션은 grant 루프가 이미 운전한다. 여기서
  //    신호를 내면 그게 정확히 이중 스폰이다(설계 §6).
  if (
    !isImplicitMissionDoc({ missionKind: mission.missionKind ?? undefined })
  ) {
    return no(
      "conductor-owned",
      "명시 미션(steps 보유)은 지휘자 grant/mission_step_done 루프가 운전한다 — 완료후크는 개입하지 않는다.",
    );
  }

  if (TERMINAL_MISSION_STATUSES.has(String(mission.status ?? ""))) {
    return no(
      "mission-terminal",
      "미션이 이미 종료 상태라 전진 신호를 내지 않는다.",
    );
  }

  // 3. 같은 완료 재유입 — 신호는 티켓당 1회.
  if (alreadySignaled(input.state, input.finishedTaskId)) {
    return no(
      "duplicate-completion",
      `이 티켓(${input.finishedTaskId})의 완료로는 이미 신호를 냈다 — 중복 스폰을 막기 위해 다시 내지 않는다.`,
    );
  }

  const openTasks = input.siblings.filter((t) => !t.deleted && isOpenTask(t));
  const openCount = openTasks.length;
  const buckets = classifySiblings(input.siblings, input.finishedTaskId);
  const label =
    (mission.implicitLabel ?? "").trim() ||
    (mission.goal ?? "").trim() ||
    mission.id;

  // 4. 종결 판정 — 마지막 태스크였으면 미션을 닫고 **신호는 나가지 않는다**.
  //    판정은 기존 순수 함수를 그대로 쓴다(닫는 조건을 두 벌로 만들지 않는다).
  if (
    isImplicitMissionComplete(
      input.siblings
        .filter((t) => !t.deleted)
        .map((t) => ({ status: String(t.status ?? "") })),
    )
  ) {
    return {
      action: "CLOSE_MISSION",
      code: "mission-complete",
      reason: `이 묶음의 마지막 티켓이다 — 미션 '${label}' 을 닫는다. 전진 신호는 나가지 않는다.`,
      openCount,
      buckets,
      message: "",
    };
  }

  // 5. ★안전장치 — 전진 로직보다 먼저 판정한다.
  const guard = evaluateAdvanceGuards({
    state: input.state,
    openCount,
    ownerInputPending: input.ownerInputPending,
    caps: input.caps,
  });
  if (guard.outcome === "halt") {
    return {
      action: "HALT",
      code: guard.code,
      reason: guard.reason,
      openCount,
      buckets,
      message: formatAdvanceHalt({
        missionId: mission.id,
        label,
        reason: guard.reason,
      }),
      haltReason: guard.reason,
    };
  }
  if (guard.outcome === "hold") {
    return no(guard.code, guard.reason, openCount, buckets);
  }

  // 6. 전진 — 슬롯이 포화면 readyNow 를 비운다(back-pressure, HALT 아님).
  const pressure = evaluateSlotPressure(buckets.inFlight.length, input.caps);
  const emitted: AdvanceBuckets = pressure.saturated
    ? { ...buckets, readyNow: [] }
    : buckets;

  return {
    action: "SIGNAL_ADVANCE",
    code: "advance",
    reason: pressure.saturated
      ? (pressure.reason ?? "슬롯 포화")
      : `남은 ${openCount}건 중 ${buckets.readyNow.length}건을 지금 집을 수 있다.`,
    openCount,
    buckets: emitted,
    message: formatAdvanceSignal({
      missionId: mission.id,
      label,
      finishedTaskId: input.finishedTaskId,
      finishedTaskTitle: input.finishedTaskTitle,
      openCount,
      buckets: emitted,
      slotNote: pressure.reason,
    }),
    nextState: {
      consecutiveSignals: input.state.consecutiveSignals + 1,
      stagnantSignals: guard.nextStagnantSignals,
      lastOpenCount: openCount,
      signaledTaskId: input.finishedTaskId,
    },
  };
}
