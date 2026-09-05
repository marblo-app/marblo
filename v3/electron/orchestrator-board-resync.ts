/**
 * 보드 → 오케스트레이터 주기 재동기화 (티켓 tHQzXPvFaR29fy0I82rM).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 폐루프의 완료 통보는 지금까지 전부 **밀어넣기(push) 1회**에 걸려 있었다:
 * mcp-server `notifyOrchestrator` → bridge `/notify-orchestrator` →
 * `PtyManager.writeAndSubmit`. 이 사슬의 어느 고리가 끊겨도(오케 세션 재시작 창,
 * 컴포저 오염, busy 스트림에 CR 미등록) 알림은 사라지고, 사라졌다는 사실조차
 * 남지 않았다. 2026-09-01 하루에만 REVIEW 제출 3건이 그렇게 증발했다.
 *
 * 이 모듈은 그 사슬을 신뢰하지 않는다. ★보드(Firestore tasks)가 진실원이다:
 * "오케의 행동이 필요한 상태(REVIEW·FAILED·BLOCKED·고아 티켓·체인 READY)에
 * 머물러 있는 항목" 을 주기적으로 다시 읽어, 이 오케 세션이 아직 통보받지 못한
 * 것만 골라 PTY 로 밀어준다. 개별 알림이 전부 유실돼도 이 스위프만 살아 있으면
 * 루프는 닫힌다.
 *
 * ── 폭주 방지: "본 것" 의 기준 ──────────────────────────────────────────────
 * 재동기화가 이미 처리된 것까지 다시 밀면 오케가 같은 것을 두 번 검증한다.
 * 기준은 **오케 PTY 세션 단위**다: (ptySessionId → 통보한 key 집합)을 들고,
 *   - 주입이 성공(injectMessage=true)한 항목만 seen 으로 기록한다. 실패하면
 *     기록하지 않으므로 다음 틱에 자동 재시도된다 — 조용한 실패 경로가 없다.
 *   - 오케가 재시작되면 ptySessionId 가 바뀌고 seen 집합은 빈 상태로 시작한다.
 *     새 세션은 아무것도 본 적이 없으므로 미처리분 전체를 다시 통보받는다 —
 *     2026-09-01 "앱 재시작 후 아무도 몰랐다" 블랙아웃의 직접 수리다.
 *   - 같은 세션에는 같은 (task,status) 를 다시 밀지 않는다. REVIEW 가 반려 후
 *     재제출되는 경우는 직접 알림([Review Submitted])이 1차 경로로 남아 있고,
 *     그 알림까지 유실되면 오케 세션이 갈릴 때 재통보된다(알려진 트레이드오프).
 *
 * minAgeMs: 상태 전이 직후는 직접 알림이 도착했을 가능성이 높은 구간이다.
 * 그 구간을 건너뛰어 정상 경로와의 이중 통보를 줄인다. 고아 판정은 더 보수적으로
 * (orphanMinAgeMs) — 다른 머신의 에이전트는 로컬 플릿에 안 보이므로, 보드 활동이
 * 한동안 없는 티켓만 고아로 부른다(agent-watchdog 의 15분 규율과 같은 이유).
 *
 * ── 설계 규율 ────────────────────────────────────────────────────────────────
 * PR #1354(BrowserPaneOpenUrlDelivery)를 따라 타이머·시계를 의존성 주입받아
 * electron 없이 유닛 테스트한다. 스위프는 절대 throw 하지 않고, 프로젝트 하나의
 * 실패가 다른 프로젝트의 재동기화를 막지 않는다.
 *
 * v1 범위: 보드 오케만. 미션 티켓은 컨덕터의 report-watchdog 이 소유하므로
 * **다이제스트 축에서는** 제외한다(포함하면 두 감시자가 같은 티켓을 다르게 흔든다).
 *
 * ── ★자율 픽업 패스 (티켓 6hWxqjbzGQs1hzTUTihx) ────────────────────────────
 * 위 "미션 티켓은 컨덕터 소관" 이라는 근거가 **암묵 미션에는 성립하지 않는다.**
 * 컨덕터의 report-watchdog 은 `grantStep` 이 거는 스텝별 타이머라 명시 미션에만
 * 있는데, 암묵 미션 티켓에도 `missionId` 가 박히므로 `isMission` 이 true 다.
 * 결과: 암묵 미션의 REVIEW 는 스위프도 컨덕터도 보지 않았고, 2026-09-05 에
 * 19장이 그렇게 쌓였다. 게다가 seen 집합은 **배달**만 세므로, 한 번 밀고 나면
 * 오케가 그때 바빴어도 그 세션 동안 다시 말해지지 않는다.
 *
 * 그 두 구멍을 이 틱의 **두 번째 패스**가 메운다(새 타이머를 만들지 않는다).
 * 판정은 전부 `orchestrator-idle-pickup.ts` 의 순수 함수가 하고, 한도·플래그·
 * 승인필요 분류는 #1414/#1416 의 것을 **그대로** 쓴다 — 새 한도도 새 환경변수도
 * 만들지 않는다. 설계: `v3/docs/orch-idle-pickup-design-2026-09-05.md`.
 */

import { isLaneContextId } from "./mcp-server/context";
import {
  emptyAdvanceState,
  type AdvanceStateSnapshot,
  type HarnessQuotaReading,
} from "./mcp-server/advance-guards";
import {
  classifyIdlePickup,
  evaluateIdlePickup,
  isOrchBusy,
  type IdlePickupCandidate,
  type IdlePickupInput,
} from "./orchestrator-idle-pickup";
import {
  evaluateActiveStall,
  type ActiveStallProgress,
} from "./orchestrator-active-stall";
import {
  evaluateUnsubmittedWork,
  isUnsurfacedWork,
  type UnsubmittedCandidate,
  type UnsurfacedGitFacts,
} from "./orchestrator-unsubmitted-work";

/** 스위프가 보드에서 읽어 오는 티켓 1행. I/O 포트가 채운다. */
export interface ResyncTaskRow {
  taskId: string;
  projectId: string;
  status: string;
  title?: string;
  role?: string;
  prUrl?: string | null;
  contextId?: string;
  /** 미션 소속이면 true — 컨덕터 소관이라 스위프가 건드리지 않는다. */
  isMission?: boolean;
  claimedBy?: string | null;
  /**
   * 마지막 보드 활동(projection.lastActivityAt → claimedAt → updatedAt →
   * createdAt 폴백)으로부터의 경과 ms. 아무 타임스탬프도 없으면 null —
   * 그 경우 나이 게이트를 통과시킨다(모른다고 조용히 숨기지 않는다).
   */
  ageMs: number | null;
  /** 이 티켓의 git 브랜치(Firestore `tasks.branch`). 없으면 null. */
  branch?: string | null;
}

/** 워크체인에서 READY 로 파생된 항목 1행. */
export interface ResyncChainReadyRow {
  itemId: string;
  what: string;
}

export type ResyncAttentionKind = "review" | "failed" | "blocked" | "orphan";

export interface ResyncAttentionEntry {
  kind: ResyncAttentionKind;
  row: ResyncTaskRow;
}

export interface OrchSessionRef {
  ptySessionId: string;
  status: string;
}

export interface BoardResyncDeps {
  /** 보드 오케가 배선된 프로젝트 id 목록(세션 유무와 무관 — 세션은 아래로 판정). */
  listBoardOrchestratorProjects(): string[];
  /** 지금 이 프로젝트의 보드 오케 세션. 없으면 null. */
  getOrchestratorSession(projectId: string): OrchSessionRef | null;
  /**
   * 오케 행동이 필요할 수 있는 티켓 전체(모든 프로젝트, status in
   * REVIEW/FAILED/BLOCKED/CLAIMED/IN_PROGRESS). 실패 시 throw 해도 된다 —
   * 틱이 삼키고 다음 주기에 재시도한다.
   */
  listAttentionTasks(): Promise<ResyncTaskRow[]>;
  /** 이 에이전트가 로컬 플릿에 살아 있는가(stopped/error/부재 → false). */
  isAgentAliveInFleet(agentId: string): boolean;
  /** 이 프로젝트 워크체인의 READY 항목. 실패 시 throw 가능(틱이 삼킨다). */
  listReadyChainItems(projectId: string): Promise<ResyncChainReadyRow[]>;
  /**
   * 오케 PTY 주입. `OrchestratorManager.injectMessage` — 정직한 boolean 을
   * 돌려주는 경로만 쓴다(브리지 fire-and-forget 경로를 다시 타지 않는다).
   */
  inject(projectId: string, message: string): Promise<boolean>;
  log?(message: string): void;
  logError?(message: string): void;
  /** 테스트 주입점 — PR #1354 규율. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  intervalMs?: number;
  minAgeMs?: number;
  orphanMinAgeMs?: number;
  maxDigestItems?: number;

  // ── 자율 픽업 패스 (티켓 6hWxqjbzGQs1hzTUTihx) ────────────────────────────
  // 전부 선택 의존이다. 하나도 주지 않으면 픽업은 **꺼진 채로** 동작한다 —
  // 기존 호출부(테스트 포함)의 동작이 한 줄도 바뀌지 않는다.

  /**
   * 자율 픽업이 켜져 있는가. 호출부가 `isAdvanceSignalEnabled()`(=
   * `MISSION_ADVANCE_SIGNAL` 정확히 `on`)를 넘긴다 — ★전진 신호와 **같은 플래그
   * 하나**를 공유하고, 이 경로는 자기 환경변수를 가지지 않는다(#1416 금지).
   * 미지정이면 OFF.
   */
  idlePickupEnabled?: () => boolean;
  /** 이 프로젝트에 미션 오케가 도는가. 돌면 미션 티켓의 주인이 있다는 뜻. */
  isMissionOrchestratorRunning?: (projectId: string) => boolean;
  /** 미소비 오너 인바운드가 있는가 — 사장님 지시가 자율 진행보다 항상 우선. */
  isOwnerInputPending?: (projectId: string) => Promise<boolean>;
  /**
   * 토큰 잔여 — **사용량 탭이 그리는 그 실측**을 읽는다(#1416 의 게이트가 쓰는
   * 소스 그대로). ★밀 후보가 있고 오케가 한가할 때만 호출된다 — 조용한 틱에
   * 프로브를 돌리지 않는다. 실패하면 호출부가 삼키고 "안 읽음"으로 진행한다.
   */
  readQuota?: () => Promise<{
    rows: HarnessQuotaReading[];
    reservePct: number;
  }>;
  /** 테스트 주입점 — 픽업 쿨다운·유휴 판정이 시계를 본다. */
  now?: () => number;
  /** 오케 유휴 판정 창(ms). 미지정이면 픽업 모듈의 턴 경계 기본값. */
  idleQuietWindowMs?: number;

  // ── 활성 정체 패스 (티켓 Z4095CT4CpAuTVtnAp9l) ────────────────────────────
  // 전부 선택 의존이다. 하나도 주지 않으면 이 패스는 **꺼진 채로** 동작한다 —
  // 기존 호출부(테스트 포함)의 동작이 한 줄도 바뀌지 않는다.

  /**
   * 활성 정체 감지가 켜져 있는가. ★자율 픽업과 **같은 플래그 하나**를 공유한다
   * (`isAdvanceSignalEnabled()`) — 이 경로도 자기 환경변수를 가지지 않는다
   * (#1416 금지 규율 그대로). 미지정이면 OFF.
   */
  activeStallEnabled?: () => boolean;
  /** 활성 정체 판정 창(ms). 미지정이면 `ACTIVE_STALL_WINDOW_MS`(10분). */
  activeStallWindowMs?: number;

  // ── 미제출 작업 패스 (티켓 Z4095CT4CpAuTVtnAp9l, PM 피드백) ────────────────
  // 전부 선택 의존이다. 하나도 주지 않으면 이 패스는 **꺼진 채로** 동작한다.
  // ★활성 정체와 상태·쿨다운을 공유하지 않는다 — 별도 세션 상태, 별도 쿨다운
  //   맵(taskId 기준). 한 축이 오판해도 다른 축을 의심할 필요가 없다.

  /**
   * 미제출 작업 감지가 켜져 있는가. ★활성 정체·자율 픽업과 **같은 플래그
   * 하나**를 공유한다(#1416 금지 규율 그대로). 미지정이면 OFF.
   */
  unsubmittedEnabled?: () => boolean;
  /**
   * git/GitHub 실측 — 이 축의 유일한 I/O. `row.branch` 가 없으면 호출되지
   * 않는다(호출부가 이미 안다). ★절대 throw 하지 않아야 한다 — 실패하면
   * `null` 을 돌려주고, 판정 모듈은 그 `null` 을 오탐 방지 쪽으로 접는다.
   */
  getUnsurfacedGitFacts?: (row: {
    projectId: string;
    taskId: string;
    branch: string;
  }) => Promise<UnsurfacedGitFacts | null>;
  /** 미제출 판정의 나이 게이트(ms). 미지정이면 `orphanMinAgeMs` 를 그대로 쓴다(새 숫자 없음). */
  unsubmittedStaleAfterMs?: number;
}

export const BOARD_RESYNC_DEFAULT_INTERVAL_MS = 120_000;
/** 직접 알림(정상 경로)이 먼저 도착할 시간을 준다 — 이중 통보 축소. */
export const BOARD_RESYNC_DEFAULT_MIN_AGE_MS = 180_000;
/** 다른 머신의 에이전트를 고아로 오판하지 않도록 보드 침묵을 길게 요구한다. */
export const BOARD_RESYNC_DEFAULT_ORPHAN_MIN_AGE_MS = 600_000;
export const BOARD_RESYNC_DEFAULT_MAX_DIGEST_ITEMS = 15;

/**
 * 티켓 1행의 재동기화 축 판정. null 이면 이 스위프의 관심사가 아니다.
 * 순수 — 테스트가 조합을 직접 고정한다.
 */
export function classifyResyncAttention(
  row: ResyncTaskRow,
  isAgentAliveInFleet: (agentId: string) => boolean,
  minAgeMs: number,
  orphanMinAgeMs: number,
  opts?: {
    /**
     * 미션 티켓도 분류할 것인가. ★기본값 false — 다이제스트 축의 동작은 그대로다.
     * 자율 픽업 패스만 true 로 부른다: 그 패스는 미션 오케가 **안 도는** 경우에만
     * 미션 행을 후보로 삼으므로(설계 §3-A) 컨덕터와 이중 감시가 되지 않는다.
     * 상태→축 매핑을 두 벌로 만들지 않으려고 새 분류기 대신 플래그로 넓혔다.
     */
    includeMission?: boolean;
  },
): ResyncAttentionKind | null {
  // 미션 티켓은 컨덕터 소관 — 이중 감시 금지(픽업 패스만 예외로 넓힌다).
  if (row.isMission && !opts?.includeMission) return null;
  const lane = isLaneContextId(row.contextId);
  // 나이를 모르면(null) 게이트를 통과시킨다 — 모른다는 이유로 숨기면 그게 곧
  // 새로운 조용한 유실이다.
  const aged = row.ageMs === null || row.ageMs >= minAgeMs;
  switch (row.status) {
    case "REVIEW":
      // 레인도 REVIEW 만은 보드 오케의 검증 게이트다(P4 — submit_for_review 는
      // 레인이 오케를 깨우는 유일한 이벤트).
      return aged ? "review" : null;
    case "FAILED":
    case "BLOCKED":
      // 레인의 FAILED/BLOCKED 는 보드 카드 이벤트다(P4) — PTY 로 밀지 않는다.
      if (lane) return null;
      return aged ? (row.status === "FAILED" ? "failed" : "blocked") : null;
    case "CLAIMED":
    case "IN_PROGRESS": {
      if (lane) return null;
      const orphanAged = row.ageMs === null || row.ageMs >= orphanMinAgeMs;
      if (!orphanAged) return null;
      // claim 이 풀렸거나(ghost reclaim 이 claimedBy 를 지운 채 status 는 남긴
      // 경우) claim 한 에이전트가 플릿에 없으면 그 티켓은 고아다.
      const claimant = (row.claimedBy ?? "").trim();
      if (!claimant) return "orphan";
      return isAgentAliveInFleet(claimant) ? null : "orphan";
    }
    default:
      return null;
  }
}

/** seen 집합의 키. 같은 세션에 같은 사실을 두 번 밀지 않기 위한 단위. */
export function resyncSeenKey(entry: ResyncAttentionEntry): string {
  if (entry.kind === "orphan") {
    // 같은 티켓이라도 다른 에이전트가 claim 했다가 또 죽으면 새 사건이다.
    return `orphan:${entry.row.taskId}:${entry.row.status}:${
      entry.row.claimedBy ?? ""
    }`;
  }
  return `${entry.kind}:${entry.row.taskId}:${entry.row.status}`;
}

export function chainSeenKey(item: ResyncChainReadyRow): string {
  return `chain:${item.itemId}`;
}

/**
 * 직접 알림(/notify-orchestrator)이 **주입 성공**했을 때 그 알림이 커버하는
 * seen 키들. 스위프가 같은 사실을 다이제스트로 또 밀지 않게 한다(이중 검증
 * 방지 — 티켓의 "알림 폭주 주의" 항).
 *
 * taskId 는 파싱이 아니라 브리지 프로토콜 필드로 온다(견고성). 메시지 접두사와
 * 전이 화살표만 본다 — 이 포맷은 notify-routing 테스트가 이미 계약으로 고정한
 * 것과 같은 어휘다. 모르는 포맷이면 빈 배열: 잘못 mark 해서 정당한 재통보를
 * 삼키는 것보다, 중복 한 번이 안전하다(fail-open).
 */
export function directDeliverySeenKeys(
  taskId: string | undefined,
  message: string,
): string[] {
  if (!taskId) return [];
  const trimmed = message.trim();
  if (trimmed.startsWith("[Review Submitted]")) {
    return [`review:${taskId}:REVIEW`];
  }
  if (trimmed.startsWith("[Task Update]")) {
    const match = trimmed.match(/\s→\s([A-Z_]+)\b/);
    if (match?.[1] === "FAILED") return [`failed:${taskId}:FAILED`];
    if (match?.[1] === "BLOCKED") return [`blocked:${taskId}:BLOCKED`];
  }
  return [];
}

const KIND_LINE: Record<ResyncAttentionKind, (row: ResyncTaskRow) => string> = {
  review: (r) =>
    `· REVIEW 대기: "${r.title ?? r.taskId}" (id=${r.taskId}${
      r.role ? `, ${r.role}` : ""
    }${r.prUrl ? `, PR: ${r.prUrl}` : ""}) — 검증/머지 또는 반려가 필요합니다`,
  failed: (r) =>
    `· FAILED: "${r.title ?? r.taskId}" (id=${
      r.taskId
    }) — 원인 확인 후 재시도/재배정 판단이 필요합니다`,
  blocked: (r) =>
    `· BLOCKED: "${r.title ?? r.taskId}" (id=${
      r.taskId
    }) — 무엇을 기다리는지 확인해 풀어주세요`,
  orphan: (r) =>
    `· 고아 티켓: "${r.title ?? r.taskId}" (id=${r.taskId}, status=${
      r.status
    }, claimedBy=${
      r.claimedBy || "없음"
    }) — claim 한 에이전트가 플릿에 없습니다. 워치독 회복 대상일 수 있으니 get_task 로 확인 후 재배정하세요`,
};

/**
 * 한 틱에 오케 1명에게 보내는 다이제스트 1통. 항목별 N통이 아니라 1통이다 —
 * 알림 폭주 방지의 두 번째 축.
 */
export function buildBoardResyncDigest(
  entries: readonly ResyncAttentionEntry[],
  chainItems: readonly ResyncChainReadyRow[],
  maxItems: number,
): string {
  const lines: string[] = [];
  for (const e of entries) lines.push(KIND_LINE[e.kind](e.row));
  for (const c of chainItems) {
    lines.push(
      `· 체인 READY: '${c.what}' (item=${c.itemId}) — 선행이 끝났습니다. 다음 태스크로 이어주세요(get_work_chain 참조)`,
    );
  }
  const total = lines.length;
  const shown = lines.slice(0, maxItems);
  const omitted = total - shown.length;
  return (
    `[보드 재동기화] 오케가 아직 통보받지 못한 보드 항목 ${total}건 — ` +
    `개별 알림이 유실됐을 수 있어 보드 상태 기준으로 다시 알립니다.\n` +
    shown.join("\n") +
    (omitted > 0
      ? `\n· …외 ${omitted}건 — get_all_tasks 로 나머지를 확인하세요`
      : "") +
    `\n(이미 처리 중인 항목이면 무시해도 됩니다. 같은 오케 세션에는 같은 항목을 다시 알리지 않습니다.)`
  );
}

/** 한 오케 세션의 자율 픽업 상태. */
interface PickupSessionState {
  /** 한도 판정이 읽는 상태 — `AdvanceStateSnapshot` 모양 그대로라 판정 코드가 한 벌이다. */
  advance: AdvanceStateSnapshot;
  /**
   * seenKey → 마지막으로 자율 픽업에 실은 시각. ★쿨다운의 근거다. 이게 없으면
   * 정체 항목이 틱마다(120초) 다시 실려 그게 정확히 "폴링형 계속 돌아라"가 된다.
   * 간격 기준은 `staleAfterMs`(=orphanMinAgeMs) 를 그대로 쓴다 — 새 숫자 없음.
   */
  pickedAt: Map<string, number>;
}

/** 한 오케 세션의 활성 정체 상태. */
interface ActiveStallSessionState {
  advance: AdvanceStateSnapshot;
  /** 이 판정이 마지막으로 신호를 낸 시각 — 쿨다운 근거. */
  lastSignaledAt: number | null;
}

/** 한 프로젝트 안에서 활성 정체 판정이 지켜보는 세 축의 마지막 진전 시각. */
interface ActiveStallProjectProgress {
  lastTicketTransitionAt: number | null;
  lastDispatchAt: number | null;
  lastPrStateChangeAt: number | null;
}

/** 진전 diff 가 쓰는 티켓 1행의 얕은 스냅샷. */
interface ActiveStallRowSnapshot {
  status: string;
  claimedBy: string | null;
  prUrl: string | null;
}

export class OrchestratorBoardResync {
  private readonly deps: BoardResyncDeps;
  private readonly intervalMs: number;
  private readonly minAgeMs: number;
  private readonly orphanMinAgeMs: number;
  private readonly maxDigestItems: number;
  /** ptySessionId → 이 세션에 주입 성공한 key 집합. 세션이 갈리면 자연 리셋. */
  private seenBySession = new Map<string, Set<string>>();
  /**
   * ptySessionId → 자율 픽업의 한도 상태 + 항목별 마지막 픽업 시각.
   * ★seen 집합과 **같은 수명**이다(세션이 갈리면 빈 상태) — 인메모리로 두는
   * 근거가 그것이다(설계 §5-1). 미션 쪽 `advanceState` 는 Firestore 에 있지만
   * 보드 단위 픽업에는 걸 미션 문서가 없고, 새 컬렉션을 만들 이유도 없다.
   */
  private pickupBySession = new Map<string, PickupSessionState>();
  /** projectId → 마지막 busy 신호 시각. 없으면 "모름"(바쁨이 아니다). */
  private lastBusyAt = new Map<string, number>();
  /**
   * ptySessionId → 활성 정체의 한도 상태 + 마지막 신호 시각.
   * ★seen/pickup 과 같은 수명이다(세션이 갈리면 빈 상태).
   */
  private activeStallBySession = new Map<string, ActiveStallSessionState>();
  /**
   * projectId → 지금 활성 구간이 시작된 시각. `markOrchestratorActivity` 가
   * 유휴→busy 전환을 감지했을 때만 갱신한다 — 세션이 아니라 **프로젝트** 단위다
   * (busy 신호는 오케 PTY 세션과 무관하게 계속 관측되므로).
   */
  private activeStallSinceByProject = new Map<string, number>();
  /** projectId → 이번 활성 구간의 세 축 마지막 진전 시각. */
  private activeStallProgressByProject = new Map<
    string,
    ActiveStallProjectProgress
  >();
  /** projectId → 직전 틱에서 본 attention 행의 얕은 스냅샷(diff 의 기준선). */
  private activeStallRowSnapshotByProject = new Map<
    string,
    Map<string, ActiveStallRowSnapshot>
  >();
  /**
   * ptySessionId → 미제출 작업의 한도 상태. ★활성 정체와 **별도**다 — 같은
   * 파일이 아니므로 상태도 별도라야 한 축의 오판이 다른 축을 의심하게
   * 만들지 않는다.
   */
  private unsubmittedBySession = new Map<string, AdvanceStateSnapshot>();
  /**
   * taskId → 마지막으로 미제출 알림을 실은 시각. `orphanMinAgeMs` 를 쿨다운
   * 으로 재사용한다(새 숫자 없음) — 같은 티켓을 매 틱(120초) 다시 알리지 않는다.
   */
  private unsubmittedPickedAt = new Map<string, number>();
  private timer: unknown = null;
  private ticking = false;

  constructor(deps: BoardResyncDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? BOARD_RESYNC_DEFAULT_INTERVAL_MS;
    this.minAgeMs = deps.minAgeMs ?? BOARD_RESYNC_DEFAULT_MIN_AGE_MS;
    this.orphanMinAgeMs =
      deps.orphanMinAgeMs ?? BOARD_RESYNC_DEFAULT_ORPHAN_MIN_AGE_MS;
    this.maxDigestItems =
      deps.maxDigestItems ?? BOARD_RESYNC_DEFAULT_MAX_DIGEST_ITEMS;
  }

  start(): void {
    if (this.timer !== null) return;
    const schedule = this.deps.setInterval ?? setInterval;
    this.timer = schedule(() => {
      void this.tickOnce();
    }, this.intervalMs);
    // 프로덕션 타이머는 앱 종료를 막지 않는다(주입 안 한 기본 경로만).
    (this.timer as { unref?: () => void } | null)?.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    const cancel =
      this.deps.clearInterval ??
      ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
    cancel(this.timer);
    this.timer = null;
  }

  /** 테스트/진단용 — 이 세션에 기록된 seen 키 수. */
  seenCount(ptySessionId: string): number {
    return this.seenBySession.get(ptySessionId)?.size ?? 0;
  }

  /**
   * 직접 알림이 오케 PTY 에 주입 성공했다는 브리지의 관찰
   * (BridgeServer.setNotifyDeliveredObserver). ★지금 running 인 세션에만
   * 기록한다 — 세션을 모르면 어느 오케가 봤는지 모르는 것이므로 기록하지
   * 않는다(잘못 mark 해 정당한 재통보를 삼키는 쪽이 더 나쁘다).
   */
  noteDirectDelivery(
    projectId: string,
    taskId: string | undefined,
    message: string,
  ): void {
    const keys = directDeliverySeenKeys(taskId, message);
    if (keys.length === 0) return;
    const session = this.deps.getOrchestratorSession(projectId);
    if (!session || session.status !== "running") return;
    let seen = this.seenBySession.get(session.ptySessionId);
    if (!seen) {
      seen = new Set<string>();
      this.seenBySession.set(session.ptySessionId, seen);
    }
    for (const key of keys) seen.add(key);
  }

  /**
   * 스위프 1회. ★절대 throw 하지 않는다. 프로젝트별 실패는 그 프로젝트만
   * 건너뛰고, 실패 사실은 logError 로 남긴다(조용한 실패 금지).
   */
  async tickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const projects = this.deps.listBoardOrchestratorProjects();
      if (projects.length === 0) return;

      let rows: ResyncTaskRow[];
      try {
        rows = await this.deps.listAttentionTasks();
      } catch (err) {
        this.error(
          `attention 티켓 조회 실패 — 이번 틱을 건너뜁니다: ${describe(err)}`,
        );
        return;
      }

      const liveSessionIds = new Set<string>();
      for (const projectId of projects) {
        try {
          await this.resyncProject(projectId, rows, liveSessionIds);
        } catch (err) {
          this.error(`project=${projectId} 재동기화 실패: ${describe(err)}`);
        }
      }
      // 죽은 세션의 seen 집합은 버린다 — 무한 증식 방지. 살아 있는 세션의
      // 집합만 유지하면 재시작 세션은 자동으로 빈 집합에서 시작한다.
      for (const sid of [...this.seenBySession.keys()]) {
        if (!liveSessionIds.has(sid)) this.seenBySession.delete(sid);
      }
      // 픽업 상태도 같은 규율로 버린다 — 죽은 세션의 한도를 새 세션이 물려받으면
      // 재시작이 리셋이라는 이 클래스의 유일한 수명 규칙이 깨진다.
      for (const sid of [...this.pickupBySession.keys()]) {
        if (!liveSessionIds.has(sid)) this.pickupBySession.delete(sid);
      }
      // 활성 정체 상태도 같은 규율로 버린다.
      for (const sid of [...this.activeStallBySession.keys()]) {
        if (!liveSessionIds.has(sid)) this.activeStallBySession.delete(sid);
      }
      // 미제출 작업 상태도 같은 규율로 버린다.
      for (const sid of [...this.unsubmittedBySession.keys()]) {
        if (!liveSessionIds.has(sid)) this.unsubmittedBySession.delete(sid);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async resyncProject(
    projectId: string,
    rows: readonly ResyncTaskRow[],
    liveSessionIds: Set<string>,
  ): Promise<void> {
    const session = this.deps.getOrchestratorSession(projectId);
    if (!session || session.status !== "running") return;
    liveSessionIds.add(session.ptySessionId);

    let seen = this.seenBySession.get(session.ptySessionId);
    if (!seen) {
      seen = new Set<string>();
      this.seenBySession.set(session.ptySessionId, seen);
    }

    const injectedThisTick = await this.digestProject(projectId, rows, seen);
    // ★두 번째 패스. 다이제스트가 아무것도 못 민 틱에도 돈다 — 오늘의 19장은
    //   정확히 "다이제스트가 밀 것이 없다고 판단한" 자리에 쌓였다.
    await this.idlePickupProject(projectId, rows, seen, session.ptySessionId, {
      resyncInjectedThisTick: injectedThisTick,
    });
    // ★세 번째 패스(티켓 Z4095CT4CpAuTVtnAp9l) — 오케가 **유휴가 아니라 busy**
    //   일 때만 켜진다. 위 두 패스와 배타적 축이라 같은 틱에 겹칠 일이 거의
    //   없지만, 혹시 겹치면(디제스트가 busy 여부를 안 보고 밀 수 있다) 방금
    //   밀어놓은 틱에 또 넣지 않는다 — 같은 틱 이중 통보 방지 규율 그대로.
    if (!injectedThisTick) {
      await this.activeStallProjectPass(projectId, rows, session.ptySessionId);
    }
    // ★네 번째 패스. 앞 세 패스와 축이 완전히 다르다(git/GitHub 실측) — 오케
    //   busy·idle 과 무관하게 매 틱 확인한다. 같은 틱에 이미 뭔가 밀었으면
    //   또 넣지 않는다(이중 통보 방지 규율 그대로) — 못 밀었어도 다음 틱에
    //   재시도되므로 이 축의 존재 이유(알림 실패에도 감지)는 안 깨진다.
    if (!injectedThisTick) {
      await this.unsubmittedProjectPass(projectId, rows, session.ptySessionId);
    }
  }

  /** 진전 diff 의 기준선을 만든다 — 이 프로젝트의 attention 행 얕은 스냅샷. */
  private snapshotActiveStallRows(
    rows: readonly ResyncTaskRow[],
  ): Map<string, ActiveStallRowSnapshot> {
    const snap = new Map<string, ActiveStallRowSnapshot>();
    for (const r of rows) {
      snap.set(r.taskId, {
        status: r.status,
        claimedBy: r.claimedBy ?? null,
        prUrl: r.prUrl ?? null,
      });
    }
    return snap;
  }

  /**
   * 이전 틱과 이번 틱의 attention 행을 diff 해서 세 축의 진전을 얻는다 —
   * 스위프가 매 틱 이미 읽어 오는 데이터라 새 I/O 가 없다. 첫 관측(이전 스냅샷
   * 없음)은 "새로 생겼다"로 세지 않는다 — 원래 있던 것을 지금 막 본 것뿐이라
   * 그걸 진전으로 세면 부팅 직후 거짓 "방금 움직였다"가 된다.
   */
  private diffActiveStallProgress(
    projectId: string,
    projectRows: readonly ResyncTaskRow[],
    now: number,
  ): void {
    const snapshot = this.snapshotActiveStallRows(projectRows);
    const prev = this.activeStallRowSnapshotByProject.get(projectId);
    this.activeStallRowSnapshotByProject.set(projectId, snapshot);
    if (!prev) return;

    let ticket = false;
    let dispatch = false;
    let pr = false;
    for (const [taskId, row] of snapshot) {
      const before = prev.get(taskId);
      if (!before) {
        ticket = true;
        if (row.claimedBy) dispatch = true;
        if (row.prUrl) pr = true;
        continue;
      }
      if (before.status !== row.status || before.claimedBy !== row.claimedBy) {
        ticket = true;
      }
      if (!before.claimedBy && row.claimedBy) dispatch = true;
      if (before.prUrl !== row.prUrl) pr = true;
    }
    for (const taskId of prev.keys()) {
      // attention 목록에서 사라졌다 — 대개 종결(DONE 등)이다.
      if (!snapshot.has(taskId)) ticket = true;
    }
    if (!ticket && !dispatch && !pr) return;

    const cur: ActiveStallProjectProgress =
      this.activeStallProgressByProject.get(projectId) ?? {
        lastTicketTransitionAt: null,
        lastDispatchAt: null,
        lastPrStateChangeAt: null,
      };
    if (ticket) cur.lastTicketTransitionAt = now;
    if (dispatch) cur.lastDispatchAt = now;
    if (pr) cur.lastPrStateChangeAt = now;
    this.activeStallProgressByProject.set(projectId, cur);
  }

  /**
   * 활성 정체 패스(티켓 Z4095CT4CpAuTVtnAp9l) — 오케가 busy 인데 티켓 전이·
   * dispatch·PR 진전이 판정 창(기본 10분) 동안 전부 0이면 오케 PTY 에 알린다.
   * ★절대 throw 하지 않는다.
   */
  private async activeStallProjectPass(
    projectId: string,
    rows: readonly ResyncTaskRow[],
    ptySessionId: string,
  ): Promise<void> {
    const enabled = this.deps.activeStallEnabled?.() ?? false;
    // ★꺼져 있으면 diff 도 안 돈다(기본값 OFF, 회귀 0).
    if (!enabled) return;

    const now = (this.deps.now ?? Date.now)();
    const projectRows = rows.filter((r) => r.projectId === projectId);
    this.diffActiveStallProgress(projectId, projectRows, now);

    const orchIdleForMsVal = this.orchIdleForMs(projectId, now);
    const orchBusy = isOrchBusy(orchIdleForMsVal, this.deps.idleQuietWindowMs);
    const activeSince = this.activeStallSinceByProject.get(projectId) ?? null;
    const projectProgress = this.activeStallProgressByProject.get(projectId);
    const progress: ActiveStallProgress = {
      lastTicketTransitionAt: projectProgress?.lastTicketTransitionAt ?? null,
      lastDispatchAt: projectProgress?.lastDispatchAt ?? null,
      // ★배선은 됐지만 아직 GitHub 폴링이 없다 — null(=이번 구간에 없었다)로
      //   적는다. undefined(모름)와는 다른 뜻이다: 이 축을 실제로 보고 있고,
      //   지금까지 못 봤다는 사실 자체가 값이다(위 파일 헤더의 "한계" 참조).
      lastPrStateChangeAt: projectProgress?.lastPrStateChangeAt ?? null,
    };

    let sess = this.activeStallBySession.get(ptySessionId);
    if (!sess) {
      sess = { advance: emptyAdvanceState(), lastSignaledAt: null };
      this.activeStallBySession.set(ptySessionId, sess);
    }

    let ownerInputPending = false;
    try {
      ownerInputPending =
        (await this.deps.isOwnerInputPending?.(projectId)) ?? false;
    } catch (err) {
      this.error(
        `project=${projectId} 활성 정체 — 오너 인바운드 조회 실패(계속): ${describe(
          err,
        )}`,
      );
    }
    if (
      ownerInputPending &&
      (sess.advance.consecutiveSignals > 0 || sess.advance.haltReason)
    ) {
      this.log(
        `project=${projectId} 사장님 개입 관측 — 활성 정체 한도/정지를 리셋합니다`,
      );
      sess.advance = {
        ...sess.advance,
        consecutiveSignals: 0,
        haltReason: null,
      };
    }

    const decision = evaluateActiveStall({
      enabled,
      sessionRunning: true,
      now,
      orchBusy,
      activeSince,
      progress,
      lastSignaledAt: sess.lastSignaledAt,
      ownerInputPending,
      state: sess.advance,
      openCount: projectRows.length,
      windowMs: this.deps.activeStallWindowMs,
    });

    if (decision.action === "NO_SIGNAL") return;

    if (decision.action === "HALT") {
      // ★HALT 는 배달 여부와 무관한 사실이므로 상태부터 박는다(#1414 규율).
      sess.advance = {
        ...sess.advance,
        haltReason: decision.haltReason ?? decision.reason,
      };
      this.error(
        `project=${projectId} 활성 정체 알림 정지 — ${decision.reason}`,
      );
    }

    const injected = await this.deps.inject(projectId, decision.message);
    if (!injected) {
      this.error(
        `project=${projectId} 활성 정체 알림 주입 실패 — 다음 틱에 재시도합니다`,
      );
      return;
    }
    if (decision.action === "HALT") return;

    sess.lastSignaledAt = now;
    if (decision.nextState) {
      sess.advance = {
        ...sess.advance,
        consecutiveSignals: decision.nextState.consecutiveSignals,
        stagnantSignals: decision.nextState.stagnantSignals,
        lastOpenCount: decision.nextState.lastOpenCount,
      };
    }
    this.log(`project=${projectId} 활성 정체 알림 주입 완료`);
  }

  /**
   * 미제출 작업 패스(티켓 Z4095CT4CpAuTVtnAp9l, PM 피드백) — REVIEW/IN_PROGRESS
   * 티켓인데 GitHub 어디에도 반영되지 않은 것을 알린다. ★활성 정체와 완전히
   * 분리된 축이다(파일·세션 상태·쿨다운 전부 별도) — 절대 throw 하지 않는다.
   */
  private async unsubmittedProjectPass(
    projectId: string,
    rows: readonly ResyncTaskRow[],
    ptySessionId: string,
  ): Promise<void> {
    const enabled = this.deps.unsubmittedEnabled?.() ?? false;
    // ★꺼져 있으면 git/GitHub 를 한 번도 조회하지 않는다(기본값 OFF, 회귀 0).
    if (!enabled || !this.deps.getUnsurfacedGitFacts) return;

    const now = (this.deps.now ?? Date.now)();
    const staleAfterMs =
      this.deps.unsubmittedStaleAfterMs ?? this.orphanMinAgeMs;
    const projectRows = rows.filter((r) => r.projectId === projectId);

    // 값싼 사전 필터부터 — status/branch/나이는 보드가 이미 아는 값이다.
    // git/GitHub 조회(비싼 I/O)는 이걸 통과한 행에만 돈다.
    const cheapCandidates = projectRows.filter(
      (r) =>
        (r.status === "REVIEW" || r.status === "IN_PROGRESS") &&
        !!r.branch &&
        (r.ageMs === null || r.ageMs >= staleAfterMs) &&
        // 쿨다운 — 같은 티켓을 매 틱 다시 조회·알리지 않는다.
        (() => {
          const last = this.unsubmittedPickedAt.get(r.taskId);
          return last === undefined || now - last >= staleAfterMs;
        })(),
    );
    if (cheapCandidates.length === 0) return;

    const facts = await Promise.all(
      cheapCandidates.map(async (row) => {
        try {
          const f = await this.deps.getUnsurfacedGitFacts!({
            projectId: row.projectId,
            taskId: row.taskId,
            branch: row.branch as string,
          });
          return { row, facts: f };
        } catch (err) {
          this.error(
            `project=${projectId} task=${
              row.taskId
            } 미제출 증거 조회 실패(모름으로 진행): ${describe(err)}`,
          );
          return { row, facts: null };
        }
      }),
    );

    const candidates: UnsubmittedCandidate[] = [];
    for (const { row, facts: f } of facts) {
      if (!f) continue; // 조회 실패 — 모름, 오탐 방지 우선(판정 모듈과 같은 규율)
      const flagged = isUnsurfacedWork(
        {
          status: row.status,
          ageMs: row.ageMs,
          ...f,
        },
        staleAfterMs,
      );
      if (!flagged) continue;
      candidates.push({
        row: {
          taskId: row.taskId,
          projectId: row.projectId,
          title: row.title,
          role: row.role,
          status: row.status,
          branch: row.branch,
          prUrl: row.prUrl,
        },
        neverHadPr: f.prExistsAnyState === false,
      });
    }
    if (candidates.length === 0) return;

    let sess = this.unsubmittedBySession.get(ptySessionId);
    if (!sess) {
      sess = emptyAdvanceState();
      this.unsubmittedBySession.set(ptySessionId, sess);
    }

    let ownerInputPending = false;
    try {
      ownerInputPending =
        (await this.deps.isOwnerInputPending?.(projectId)) ?? false;
    } catch (err) {
      this.error(
        `project=${projectId} 미제출 작업 — 오너 인바운드 조회 실패(계속): ${describe(
          err,
        )}`,
      );
    }
    if (ownerInputPending && (sess.consecutiveSignals > 0 || sess.haltReason)) {
      this.log(
        `project=${projectId} 사장님 개입 관측 — 미제출 작업 한도/정지를 리셋합니다`,
      );
      sess = { ...sess, consecutiveSignals: 0, haltReason: null };
      this.unsubmittedBySession.set(ptySessionId, sess);
    }

    const decision = evaluateUnsubmittedWork({
      enabled,
      sessionRunning: true,
      candidates,
      ownerInputPending,
      state: sess,
    });

    if (decision.action === "NO_SIGNAL") return;

    if (decision.action === "HALT") {
      sess = {
        ...sess,
        haltReason: decision.haltReason ?? decision.reason,
      };
      this.unsubmittedBySession.set(ptySessionId, sess);
      this.error(
        `project=${projectId} 미제출 작업 알림 정지 — ${decision.reason}`,
      );
    }

    const injected = await this.deps.inject(projectId, decision.message);
    if (!injected) {
      this.error(
        `project=${projectId} 미제출 작업 알림 주입 실패(${decision.picked.length}건) — 다음 틱에 재시도합니다`,
      );
      return;
    }
    if (decision.action === "HALT") return;

    for (const c of decision.picked)
      this.unsubmittedPickedAt.set(c.row.taskId, now);
    if (decision.nextState) {
      sess = {
        ...sess,
        consecutiveSignals: decision.nextState.consecutiveSignals,
        stagnantSignals: decision.nextState.stagnantSignals,
        lastOpenCount: decision.nextState.lastOpenCount,
      };
      this.unsubmittedBySession.set(ptySessionId, sess);
    }
    this.log(
      `project=${projectId} 미제출 작업 알림 주입 완료: ${decision.picked.length}건`,
    );
  }

  /** 다이제스트 축(v1). @returns 이번 틱에 실제로 주입했는가. */
  private async digestProject(
    projectId: string,
    rows: readonly ResyncTaskRow[],
    seen: Set<string>,
  ): Promise<boolean> {
    const entries: ResyncAttentionEntry[] = [];
    for (const row of rows) {
      if (row.projectId !== projectId) continue;
      const kind = classifyResyncAttention(
        row,
        this.deps.isAgentAliveInFleet,
        this.minAgeMs,
        this.orphanMinAgeMs,
      );
      if (!kind) continue;
      const entry = { kind, row };
      if (seen.has(resyncSeenKey(entry))) continue;
      entries.push(entry);
    }

    let chainItems: ResyncChainReadyRow[] = [];
    try {
      chainItems = (await this.deps.listReadyChainItems(projectId)).filter(
        (item) => !seen.has(chainSeenKey(item)),
      );
    } catch (err) {
      // 체인 읽기 실패가 티켓 재동기화를 막으면 안 된다 — 티켓 축만이라도 민다.
      this.error(
        `project=${projectId} 워크체인 READY 조회 실패(티켓 축은 계속): ${describe(
          err,
        )}`,
      );
    }

    if (entries.length === 0 && chainItems.length === 0) return false;

    const message = buildBoardResyncDigest(
      entries,
      chainItems,
      this.maxDigestItems,
    );
    const injected = await this.deps.inject(projectId, message);
    if (!injected) {
      // seen 에 기록하지 않는다 → 다음 틱에 재시도. 실패는 기록한다.
      this.error(
        `project=${projectId} 다이제스트 주입 실패(${
          entries.length + chainItems.length
        }건) — 다음 틱에 재시도합니다`,
      );
      return false;
    }
    for (const e of entries) seen.add(resyncSeenKey(e));
    for (const c of chainItems) seen.add(chainSeenKey(c));
    this.log(
      `project=${projectId} 재동기화 다이제스트 주입 완료: 티켓 ${entries.length}건, 체인 ${chainItems.length}건`,
    );
    return true;
  }

  // ── 자율 픽업 패스 (티켓 6hWxqjbzGQs1hzTUTihx) ──────────────────────────────

  /**
   * 유휴 오케에게 **아직 안 움직인 것**을 알린다. 판정은 전부 순수 함수가 하고
   * 여기는 후보를 모아 넘기고 결과를 배달·기록만 한다.
   *
   * ★절대 throw 하지 않는다 — 픽업이 깨져도 다이제스트 축(v1)은 이미 끝났다.
   */
  private async idlePickupProject(
    projectId: string,
    rows: readonly ResyncTaskRow[],
    seen: Set<string>,
    ptySessionId: string,
    ctx: { resyncInjectedThisTick: boolean },
  ): Promise<void> {
    const enabled = this.deps.idlePickupEnabled?.() ?? false;
    // ★꺼져 있으면 보드도 저널도 읽지 않는다(기본값 OFF, 회귀 0).
    if (!enabled) return;

    const now = (this.deps.now ?? Date.now)();
    const pickup = this.pickupState(ptySessionId);
    const missionOrchRunning =
      this.deps.isMissionOrchestratorRunning?.(projectId) ?? false;

    let ownerInputPending = false;
    try {
      ownerInputPending =
        (await this.deps.isOwnerInputPending?.(projectId)) ?? false;
    } catch (err) {
      // 저널을 못 읽는 것은 "입력이 없다"의 근거가 아니지만, 그것 때문에 픽업을
      // 영구히 막으면 그게 또 하나의 조용한 정지다(tools.ts 의 같은 판단).
      this.error(
        `project=${projectId} 오너 인바운드 조회 실패(픽업은 계속): ${describe(
          err,
        )}`,
      );
    }

    // ★사장님 개입은 한도를 푼다 — 인메모리라 사람이 만질 손잡이가 이것뿐이다
    //   (설계 §5-2). 연속 카운터 0 리셋은 #1414 와 같은 규율이고, HALT 해제는
    //   여기만의 것이다: 안 그러면 한 번 HALT 된 프로젝트가 앱 재시작까지 죽는다.
    if (ownerInputPending) {
      if (pickup.advance.consecutiveSignals > 0 || pickup.advance.haltReason) {
        this.log(
          `project=${projectId} 사장님 개입 관측 — 자율 픽업 한도/정지를 리셋합니다`,
        );
      }
      pickup.advance = {
        ...pickup.advance,
        consecutiveSignals: 0,
        haltReason: null,
      };
    }

    const projectRows = rows.filter((r) => r.projectId === projectId);
    const candidates: IdlePickupCandidate[] = [];
    let openCount = 0;
    let inFlightCount = 0;
    for (const row of projectRows) {
      openCount += 1;
      if (row.status === "CLAIMED" || row.status === "IN_PROGRESS") {
        inFlightCount += 1;
      }
      const kind = classifyResyncAttention(
        row,
        this.deps.isAgentAliveInFleet,
        this.minAgeMs,
        this.orphanMinAgeMs,
        { includeMission: true },
      );
      if (!kind) continue;
      const key = resyncSeenKey({ kind, row });
      // ★쿨다운 — 같은 항목을 틱마다(120초) 다시 싣지 않는다. 이게 없으면 이
      //   패스가 정확히 "폴링형 계속 돌아라"가 된다. 간격은 정체 기준을 그대로 쓴다.
      const lastPicked = pickup.pickedAt.get(key);
      if (lastPicked !== undefined && now - lastPicked < this.orphanMinAgeMs) {
        continue;
      }
      const why = classifyIdlePickup(
        row,
        kind,
        seen.has(key),
        missionOrchRunning,
        this.orphanMinAgeMs,
      );
      if (!why) continue;
      candidates.push({ row, kind, why });
    }

    const orchIdleForMs = this.orchIdleForMs(projectId, now);
    // ★프로브는 밀 이유가 있을 때만 돈다. 조용한 틱마다 계정 쿼터를 찌르면
    //   그게 "폴링형 계속 돌아라"의 비용 버전이다. 바쁨 판정은 순수 모듈의
    //   `isOrchBusy` 를 그대로 써 정의를 두 벌로 만들지 않는다.
    let quota: IdlePickupInput["quota"] = null;
    if (
      candidates.length > 0 &&
      !ctx.resyncInjectedThisTick &&
      !isOrchBusy(orchIdleForMs, this.deps.idleQuietWindowMs) &&
      !(pickup.advance.haltReason ?? "").trim()
    ) {
      try {
        quota = (await this.deps.readQuota?.()) ?? null;
      } catch (err) {
        // 못 읽는 것은 "잔여 0" 이 아니다. 게이트가 안 읽음으로 진행하고, 그
        // 사실은 로그에 남는다(조용한 실패 금지).
        this.error(
          `project=${projectId} 토큰 잔여 조회 실패(안 읽음으로 진행): ${describe(
            err,
          )}`,
        );
      }
    }

    const decision = evaluateIdlePickup({
      enabled,
      sessionRunning: true,
      orchIdleForMs,
      resyncInjectedThisTick: ctx.resyncInjectedThisTick,
      candidates,
      openCount,
      inFlightCount,
      ownerInputPending,
      state: pickup.advance,
      quota,
      quietWindowMs: this.deps.idleQuietWindowMs,
    });
    if (decision.code === "token-insufficient") {
      this.log(`project=${projectId} 자율 픽업 보류 — ${decision.reason}`);
    }

    if (decision.action === "NO_PICKUP") return;

    // ★HALT 는 배달 여부와 무관한 사실이므로 상태부터 박는다(#1414 와 같은 규율).
    if (decision.action === "HALT") {
      pickup.advance = {
        ...pickup.advance,
        haltReason: decision.haltReason ?? decision.reason,
      };
      this.error(`project=${projectId} 자율 픽업 정지 — ${decision.reason}`);
    }

    const injected = await this.deps.inject(projectId, decision.message);
    if (!injected) {
      // ★닿지 않은 픽업은 한도에 세지 않는다 — 닿지도 않은 신호로 한도를 태우면
      //   큐가 그대로인 채 자율 진행만 죽는다(#1414 의 배달 실패 규율 그대로).
      this.error(
        `project=${projectId} 자율 픽업 주입 실패(${decision.picked.length}건) — 다음 틱에 재시도합니다`,
      );
      return;
    }
    if (decision.action === "HALT") return;

    const next = decision.nextState;
    if (next) {
      pickup.advance = {
        ...pickup.advance,
        consecutiveSignals: next.consecutiveSignals,
        stagnantSignals: next.stagnantSignals,
        lastOpenCount: next.lastOpenCount,
      };
    }
    for (const c of decision.picked) {
      const key = resyncSeenKey({ kind: c.kind, row: c.row });
      pickup.pickedAt.set(key, now);
      // 픽업으로 알린 것도 "이 세션에 통보함"이다 — 다이제스트가 같은 사실을
      // 또 밀지 않게 한다(두 패스가 같은 seen 을 공유하는 이유).
      seen.add(key);
    }
    this.log(
      `project=${projectId} 자율 픽업 주입 완료: ${decision.picked.length}건 ` +
        `(승인필요 제외 ${decision.withheld.length}건, 연속 ${
          next?.consecutiveSignals ?? 0
        })`,
    );
  }

  private pickupState(ptySessionId: string): PickupSessionState {
    let s = this.pickupBySession.get(ptySessionId);
    if (!s) {
      s = { advance: emptyAdvanceState(), pickedAt: new Map<string, number>() };
      this.pickupBySession.set(ptySessionId, s);
    }
    return s;
  }

  /** null = 부팅 후 busy 를 한 번도 못 봄. **모름이지 바쁨이 아니다.** */
  private orchIdleForMs(projectId: string, now: number): number | null {
    const last = this.lastBusyAt.get(projectId);
    return last === undefined ? null : Math.max(0, now - last);
  }

  /**
   * 오케 PTY 가 busy 신호를 뱉었다(`isBusySignal`). main 이 오케 출력에서
   * 걸러 넘긴다 — ★텔레그램/슬랙 nudge 가 이미 쓰는 그 관측을 그대로 쓴다.
   * 새 프로브도 새 상태기계도 만들지 않는다.
   */
  markOrchestratorActivity(projectId: string): void {
    if (!projectId) return;
    const now = (this.deps.now ?? Date.now)();
    // ★활성 정체 패스가 꺼져 있으면 이 계산도 안 한다(회귀 0). 켜져 있을 때만
    //   "유휴→busy 전환" 을 감지해 새 활성 구간을 연다 — 지난 구간의 진전
    //   시각을 새 구간이 물려받으면 "예전에 움직였다"가 지금 정체를 가린다.
    if (this.deps.activeStallEnabled?.()) {
      const prevBusyAt = this.lastBusyAt.get(projectId);
      const wasBusy = isOrchBusy(
        prevBusyAt === undefined ? null : now - prevBusyAt,
        this.deps.idleQuietWindowMs,
      );
      if (!wasBusy) {
        this.activeStallSinceByProject.set(projectId, now);
        this.activeStallProgressByProject.delete(projectId);
      }
    }
    this.lastBusyAt.set(projectId, now);
  }

  private log(message: string): void {
    (this.deps.log ?? ((m: string) => console.log(`[BoardResync] ${m}`)))(
      message,
    );
  }

  private error(message: string): void {
    (
      this.deps.logError ?? ((m: string) => console.error(`[BoardResync] ${m}`))
    )(message);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
