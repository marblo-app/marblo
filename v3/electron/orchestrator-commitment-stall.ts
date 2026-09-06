/**
 * "약속 정체(commitment stall)" 판정 — 오케가 "하겠습니다" 해놓고 그 항목만
 * 멈추는 것을 잡는다 (티켓 WLC9OjIJ8lbCAuz6WlNG).
 *
 * ── 사장님 지시 ──────────────────────────────────────────────────────────────
 * "오케가 한다고 하고 멈추는 경우 오케에게 다음 진행을 하고 있냐고 물어보는
 * 와치독도 있어야 할 것 같아. 중간중간." 실제로 2026-09-06 하루에 두 번 났다:
 * "별도로 정리해서 드리겠습니다" 가 다음 메시지에 끌려가 안 돌아왔고, 네이버
 * 티켓을 만들어놓고 배치를 안 했다. ★사장님이 지적하실 때까지 아무도 몰랐다.
 *
 * ── 재료는 이미 있다 ─────────────────────────────────────────────────────────
 * `work-chain-capture.ts` 가 오케의 약속 어미를 이미 자동 포착해 워크체인에
 * 남긴다(source="auto"). 이 모듈은 **새 포착기가 아니다** — 그 리스트를
 * 근거로 "그게 됐는지" 확인하는 층이다.
 *
 * ── "멈춤" 을 무엇으로 재나 ───────────────────────────────────────────────────
 * `orchestrator-active-stall.ts` 는 **보드 전체**(티켓 전이·dispatch·PR)가
 * 안 늘어나는 것을 본다 — 오케가 계속 다른 일을 해도 상관없다. 이 모듈은
 * **다른 축**이다: 오케가 계속 바쁘게 다른 일을 해도, 자기가 한 약속 하나가
 * 안 움직이면 그것만으로 정체다. 두 축을 합치지 않는다(§orchestrator-active-stall.ts
 * 의 "왜 새 축인가" 와 같은 이유 — 하나가 조용해도 다른 하나가 사각을 만든다).
 *
 * 진전의 정의는 **그 항목의 `updatedAt`** 이다 — 새 신호를 만들지 않는다.
 * `updateWorkChainItem` 은 어떤 필드를 바꾸든(taskIds 부착·note·close 등)
 * `updatedAt` 을 반드시 갱신한다(work-chain.ts). 즉 "포착된 이후 아무도 그
 * 항목을 안 건드렸다" 가 곧 "그 약속에 대해 아무 일도 안 했다" 다. 티켓 생성
 * 자체는 세지 않는다 — 티켓이 생겨도 `update_work_chain_item(add_task_ids=…)`
 * 로 그 항목에 붙이지 않으면 약속과 결과가 이어지지 않는다(실측 사례 2가
 * 정확히 이 모양: 티켓은 생겼지만 항목은 그대로였다).
 *
 * ── 오탐이 이 기능을 죽인다 ──────────────────────────────────────────────────
 * 이 모듈은 **포착 여부를 재판정하지 않는다** — 호출부가 이미 `source==="auto"`
 * 이고 열려 있는(closed 아닌) 항목만 넘긴다고 가정한다. 포착 정확도는
 * `work-chain-capture.ts` 의 책임이고(티켓 9lT62MMHjLMWd3kIEXt7 이 대부분을
 * 잡았고, 이 티켓이 redaction gap 하나를 더 잡았다), 이 모듈이 오탐을 늘리지
 * 않는 방법은 **묻는 빈도를 낮게 유지하는 것**뿐이다: 같은 항목은 쿨다운
 * 안에 다시 안 묻는다(호출부의 `askedAt` 맵), 한 틱에 다이제스트 1통뿐이다
 * (개별 항목마다 메시지를 쏘지 않는다), 그리고 `evaluateAdvanceGuards` 의
 * 기존 한도(연속 신호·정체 신호)를 그대로 써서 무한 반복이면 HALT 한다.
 *
 * ── 물어보는 것까지다 ────────────────────────────────────────────────────────
 * ★자동 재전송·자동 실행을 만들지 않는다. 이 모듈이 만드는 것은 오케 PTY 로
 * 들어가는 **질문**뿐이다 — 대신 티켓을 닫거나 update_work_chain_item 을
 * 대신 호출하지 않는다. 오케가 그 질문을 실제로 받아 행동하는지는 **이
 * 모듈이 보장할 수 없다** — 그건 사람(오케)의 판단이다. 대신 durable 흔적은
 * 두 겹이다: 워크체인 항목 자체가 이미 보드 옆에 남아 있고(포착 시점부터),
 * 이 질문도 물을 때마다 사장님이 보는 표면(오케 PTY)에 남는다. "탐지가
 * 먼저다, 전달 보장이 아니다" — `notify-resync-coverage.ts` 와 같은 원칙.
 *
 * ── 범위 ─────────────────────────────────────────────────────────────────────
 * 보드 오케 한정이다(다른 세 패스와 같은 스코프). 미션 오케·manual/owner
 * 항목의 정체는 이 티켓 밖이다 — source="auto" 항목만 본다(§목표).
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase/electron 을 import 하지 않는다. 라이브 보드 없이 진리표로 고정된다
 * (`tests/unit/orchestrator-commitment-stall.test.ts`).
 */

import {
  evaluateAdvanceGuards,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
} from "./mcp-server/advance-guards";

/**
 * 정체로 부르기까지 요구하는 무진전 시간. `orchestrator-active-stall.ts` 의
 * `ACTIVE_STALL_WINDOW_MS` 와 같은 10분을 그대로 쓴다 — 새 숫자를 만들지
 * 않는다(같은 저장소 안에서 "오케가 이 정도 조용하면 정체로 본다"는 판단은
 * 이미 한 번 내려져 있다).
 */
export const COMMITMENT_STALL_WINDOW_MS = 10 * 60_000;

export interface CommitmentItem {
  /** 워크체인 항목 id. */
  id: string;
  /** 항목 제목 — 질문 본문에 그대로 실린다. */
  what: string;
  /** epoch ms. */
  createdAt: number;
  /** epoch ms — 이 항목이 마지막으로 편집된 시각. */
  updatedAt: number;
}

/** 지금 시각 기준으로 이 항목이 정체인가. 순수 판정. */
export function isCommitmentStalled(
  item: CommitmentItem,
  now: number,
  windowMs: number = COMMITMENT_STALL_WINDOW_MS,
): boolean {
  return now - item.updatedAt >= windowMs;
}

/**
 * 지금 정체인 항목 중 **다시 물어도 되는 것**만 남긴다.
 *
 * `askedAt` 은 호출부(세션 상태)가 들고 있는 "이 세션에서 이 항목을 마지막
 * 으로 물은 시각" 맵이다 — 같은 항목을 쿨다운 안에 또 묻지 않는다(폭주 방지,
 * 다른 세 패스의 `pickedAt`/`lastSignaledAt` 과 같은 규율).
 */
export function selectAskableStalledCommitments(
  items: readonly CommitmentItem[],
  now: number,
  askedAt: ReadonlyMap<string, number>,
  windowMs: number = COMMITMENT_STALL_WINDOW_MS,
  cooldownMs: number = COMMITMENT_STALL_WINDOW_MS,
): CommitmentItem[] {
  return items.filter((item) => {
    if (!isCommitmentStalled(item, now, windowMs)) return false;
    const lastAsked = askedAt.get(item.id);
    if (lastAsked === undefined) return true;
    return now - lastAsked >= cooldownMs;
  });
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

export type CommitmentStallAction = "NO_SIGNAL" | "SIGNAL" | "HALT";

export type CommitmentStallCode =
  | "flag-off"
  | "no-session"
  | "no-candidates"
  | "already-halted"
  | "asking"
  | GuardCode;

export interface CommitmentStallInput {
  /** ★전진 신호·자율 픽업·활성 정체와 **같은 플래그 하나**를 공유한다. */
  enabled: boolean;
  sessionRunning: boolean;
  now: number;
  /** source==="auto" 이고 열려 있는(closed 아닌) 항목 전체 — 호출부가 거른다. */
  items: readonly CommitmentItem[];
  /** 이 세션에서 항목 id → 마지막으로 물은 시각. */
  askedAt: ReadonlyMap<string, number>;
  /** 미해결 오너 질문 또는 미소비 오너 인바운드가 있는가. */
  ownerInputPending: boolean;
  state: AdvanceStateSnapshot;
  caps?: AdvanceCaps;
  windowMs?: number;
  /** 같은 항목 재질문 최소 간격. 기본값 = windowMs(새 숫자를 만들지 않는다). */
  cooldownMs?: number;
}

export interface CommitmentStallDecision {
  action: CommitmentStallAction;
  code: CommitmentStallCode;
  /** 사람이 읽는 사유. SIGNAL/HALT 면 반드시 비어 있지 않다. */
  reason: string;
  /** SIGNAL/HALT 일 때 오케 PTY 로 보낼 본문. 그 외엔 "". */
  message: string;
  /** SIGNAL 일 때만 — 이번에 실제로 물은 항목 id(호출부가 askedAt 갱신용). */
  askedIds: string[];
  nextState?: {
    consecutiveSignals: number;
    stagnantSignals: number;
    lastOpenCount: number;
  };
  haltReason?: string;
}

function no(
  code: CommitmentStallCode,
  reason: string,
): CommitmentStallDecision {
  return { action: "NO_SIGNAL", code, reason, message: "", askedIds: [] };
}

function minutes(ms: number): number {
  return Math.floor(ms / 60_000);
}

/**
 * 오케에게 **묻는다** — 대신 닫거나 대신 붙이지 않는다. 다이제스트 1통에
 * 여러 항목을 담아(다른 패스와 같은 반-폭주 규율) 한 번에 묻는다.
 */
export function formatCommitmentStallQuestion(
  items: readonly CommitmentItem[],
  now: number,
): string {
  const lines = items.map(
    (item) =>
      `· "${item.what}" (id=${item.id}) — ${minutes(
        now - item.updatedAt,
      )}분째 그대로`,
  );
  return (
    `[약속 확인] 네가 직접 말했던 다음 할 일인데(워크체인 자동 포착), ` +
    `아래는 최근 변화가 없다:\n${lines.join("\n")}\n` +
    `지금 진행 중인가? 진행 중이면 update_work_chain_item(add_task_ids=[...]) ` +
    `로 티켓을 붙여라. 더 이상 유효하지 않으면 update_work_chain_item(close="dropped", ` +
    `reason=...) 로 닫아라. 이미 끝났는데 항목만 남았으면 근거(티켓/보드 사실)를 ` +
    `붙여 닫아라.`
  );
}

/** HALT 본문 — 왜 이 감시가 멈췄는지 반드시 사람이 볼 곳에 남긴다. */
export function formatCommitmentStallHalt(reason: string): string {
  return (
    `[약속 확인] ⏸ 자동 확인 정지\n` +
    `사유: ${reason}\n` +
    `이 오케 세션에서는 약속 정체 질문을 더 하지 않는다. 사장님 지시가 오면 해제된다.`
  );
}

/**
 * 약속 정체의 전체 판정. **판정 순서가 곧 우선순위다**:
 *
 *   0. 플래그 OFF        — 아무것도 읽지 않는다(기본값 OFF, 회귀 0)
 *   1. 세션 없음/미실행
 *   2. ★이미 HALT        — 메시지 없이 조용히 빠진다
 *   3. 물을 후보 없음     — 정체 항목이 없거나 전부 쿨다운 중
 *   4. 한도(evaluateAdvanceGuards) → HALT | hold
 *   5. → SIGNAL(다이제스트 1통)
 */
export function evaluateCommitmentStall(
  input: CommitmentStallInput,
): CommitmentStallDecision {
  if (!input.enabled) {
    return no("flag-off", "약속 정체 감지가 꺼져 있다(기본값 OFF).");
  }
  if (!input.sessionRunning) {
    return no("no-session", "이 프로젝트의 오케 세션이 실행 중이 아니다.");
  }
  if ((input.state.haltReason ?? "").trim()) {
    return no(
      "already-halted",
      `약속 확인이 이미 정지 상태다 — ${input.state.haltReason}`,
    );
  }

  const windowMs = input.windowMs ?? COMMITMENT_STALL_WINDOW_MS;
  const cooldownMs = input.cooldownMs ?? windowMs;
  const askable = selectAskableStalledCommitments(
    input.items,
    input.now,
    input.askedAt,
    windowMs,
    cooldownMs,
  );
  if (askable.length === 0) {
    return no(
      "no-candidates",
      `정체 항목이 없거나(최근 ${minutes(windowMs)}분 안에 갱신됨) 전부 쿨다운 중이다.`,
    );
  }

  const guard = evaluateAdvanceGuards({
    state: input.state,
    openCount: askable.length,
    ownerInputPending: input.ownerInputPending,
    caps: input.caps,
  });
  if (guard.outcome === "halt") {
    return {
      action: "HALT",
      code: guard.code,
      reason: guard.reason,
      message: formatCommitmentStallHalt(guard.reason),
      askedIds: [],
      haltReason: guard.reason,
    };
  }
  if (guard.outcome === "hold") {
    return no(guard.code, guard.reason);
  }

  return {
    action: "SIGNAL",
    code: "asking",
    reason: `약속 정체 감지 — ${askable.length}건 질문.`,
    message: formatCommitmentStallQuestion(askable, input.now),
    askedIds: askable.map((item) => item.id),
    nextState: {
      consecutiveSignals: input.state.consecutiveSignals + 1,
      stagnantSignals: guard.nextStagnantSignals,
      lastOpenCount: askable.length,
    },
  };
}
