/**
 * Pure rules for 비기너 모드 — the orchestrator-chat-first shell a brand new
 * install lands in (design: v3/docs/BEGINNER-MODE-DESIGN.md).
 *
 * Three decisions live here, all of them the kind that must not be re-derived
 * inside a component:
 *
 *  1. {@link resolveInitialBeginnerMode} — WHO becomes a beginner. Getting this
 *     wrong in the "advanced → beginner" direction is a regression that makes an
 *     existing user's board disappear, so the rule is deliberately conservative:
 *     a beginner only when EVERY marker of a prior install is absent.
 *  2. {@link shouldPromote} — when to offer the graduation to the full
 *     workspace shell.
 *  3. {@link summarizeBeginnerProgress} — ★the S4 fix: what the inline mini-live
 *     strip says while the orchestrator works, so "첫 티켓을 보냈는데 화면에서
 *     아무 일도 안 일어난다"(activation-friction-diagnosis §S4) stops happening.
 *  4. {@link groupBeginnerBoard} — how the 7-status board collapses into the
 *     3-column mini board a beginner sees.
 *
 * Everything is a pure function of its inputs (no DOM, no storage, no clock) so
 * the activation-critical branches are unit-testable in the node test env. The
 * store (`beginnerModeStore`) wires localStorage + Date.now() into these.
 */
import type { TaskStatus } from "../types/task";

export type BeginnerModeState = "beginner" | "advanced";

/**
 * localStorage key holding the serialized {@link BeginnerModeRecord} of an
 * install that has not yet been claimed by an account.
 *
 * ★It used to be THE key, machine-wide (ticket E3ywX1ftbVr5f1TrFsgp): a second
 * account signing in on the same Mac inherited the first account's "advanced"
 * verdict and never saw the simple shell. The authoritative record now lives
 * per-uid ({@link beginnerModeAccountKey}); this key survives only as the
 * machine-level evidence the FIRST account to sign in inherits.
 */
export const BEGINNER_MODE_KEY = "marblo.beginnerMode";

/**
 * localStorage key holding the uid that already inherited this machine's
 * evidence (the legacy record above + the {@link PriorInstallMarkers}).
 *
 * Everything that evidence proves — "somebody has used this install before" —
 * is true of exactly one account. Recording who took it is what lets a second
 * account be told apart from a restart, without deleting the evidence the first
 * account still depends on.
 */
export const BEGINNER_MODE_CLAIM_KEY = "marblo.beginnerMode.claimedBy";

/** Prefix of the per-account records. Kept public so test harnesses can sweep. */
export const BEGINNER_MODE_ACCOUNT_PREFIX = "marblo.beginnerMode.u.";

/** localStorage key holding this account's {@link BeginnerModeRecord}. */
export function beginnerModeAccountKey(uid: string): string {
  return `${BEGINNER_MODE_ACCOUNT_PREFIX}${uid}`;
}

export interface BeginnerModeRecord {
  state: BeginnerModeState;
  /** ms epoch the install was FIRST resolved as a beginner. 0 = never was. */
  enteredAt: number;
  /**
   * ms epoch of the first completion observed inside the beginner chat.
   * Written exactly once — it is the activation finish line and its telemetry
   * must not double-count on every re-render.
   */
  firstCompletionAt: number;
  /** ms epoch the promotion modal was shown. Non-zero → never show it again. */
  promotionShownAt: number;
}

export const EMPTY_BEGINNER_RECORD: BeginnerModeRecord = {
  state: "advanced",
  enteredAt: 0,
  firstCompletionAt: 0,
  promotionShownAt: 0,
};

function finiteAt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Parse the persisted record. Anything malformed degrades to "advanced" rather
 * than throwing or guessing — a corrupt entry must never strand a working
 * install in a shell with no board.
 */
export function parseBeginnerRecord(
  raw: string | null | undefined,
): BeginnerModeRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o.state !== "beginner" && o.state !== "advanced") return null;
  return {
    state: o.state,
    enteredAt: finiteAt(o.enteredAt),
    firstCompletionAt: finiteAt(o.firstCompletionAt),
    promotionShownAt: finiteAt(o.promotionShownAt),
  };
}

export function serializeBeginnerRecord(r: BeginnerModeRecord): string {
  return JSON.stringify(r);
}

/**
 * Markers that prove this install has been used before. Each is a localStorage
 * key some earlier surface writes; the caller passes "does this key exist".
 *
 * ★They are all `boolean` (existence), never the parsed value: a user who
 * explicitly turned the workspace shell OFF wrote "0", and that is every bit as
 * much a prior-use marker as "1".
 */
export interface PriorInstallMarkers {
  /** `marblo.onboarding.progress` — the Start Here checklist has a record. */
  onboardingProgress: boolean;
  /** `marblo.workspaceSplit.activeTab` — the shell has persisted a tab. */
  workspaceTab: boolean;
  /**
   * `marblo.workspaceMode.enabled` — the shell toggle was touched. The toggle
   * itself is gone (the shell is now unconditional), so nothing writes this key
   * anymore — but installs that predate the removal still carry it, which is
   * exactly the prior-use evidence this marker is for.
   */
  workspaceModeFlag: boolean;
  /** `marblo.cliSetupGateDismissed` — the legacy modal was dismissed. */
  legacyGateDismissed: boolean;
  /**
   * Reading localStorage threw (private mode / storage disabled). We cannot
   * tell new from old → keep the existing experience.
   */
  storageUnavailable: boolean;
}

/**
 * WHO becomes a beginner.
 *
 * A stored decision always wins — once resolved, the mode never re-derives
 * itself (otherwise clearing an unrelated key could yank a promoted user back).
 * With no stored decision, it takes ALL of the prior-install markers being
 * absent to enter beginner mode.
 *
 * The asymmetry is intentional. A false "advanced" for a genuine newcomer costs
 * them the same screen they would have had before this feature existed. A false
 * "beginner" for an existing user hides their board — a real regression. So the
 * rule errs toward advanced on every ambiguity, storage failure included
 * (mirroring workspaceModeStore's "read failure → default experience").
 */
export function resolveInitialBeginnerMode(
  stored: BeginnerModeRecord | null,
  markers: PriorInstallMarkers,
): BeginnerModeState {
  if (stored) return stored.state;
  if (markers.storageUnavailable) return "advanced";
  if (
    markers.onboardingProgress ||
    markers.workspaceTab ||
    markers.workspaceModeFlag ||
    markers.legacyGateDismissed
  ) {
    return "advanced";
  }
  return "beginner";
}

// ── ★계정 귀속 판정 (티켓 E3ywX1ftbVr5f1TrFsgp) ─────────────────────────────

/**
 * 이번 계정 채택이 무엇을 한 것인가.
 *
 *   kept    — 이 계정의 레코드가 이미 있었다(재부팅/토큰 갱신).
 *   claimed — 기기에 남은 흔적을 이 계정이 물려받았다(설치당 첫 계정, 업그레이드).
 *   fresh   — 다른 계정이 이미 물려받은 뒤다 → 이 계정에겐 첫 실행이다.
 */
export type BeginnerAccountOutcome = "kept" | "claimed" | "fresh";

export interface BeginnerAccountInput {
  /** 지금 채택하는 계정. */
  uid: string;
  /** 이 uid 의 레코드(`beginnerModeAccountKey`). */
  accountRecord: BeginnerModeRecord | null;
  /** 아직 아무도 안 가져간 기기 단위 레코드(`BEGINNER_MODE_KEY`). */
  legacyRecord: BeginnerModeRecord | null;
  /** 기기 흔적을 이미 가져간 uid. null = 미청구. */
  claimedBy: string | null;
  /** 기기 단위 이전-사용 마커. `claimedBy` 가 남이면 **남의 흔적**이다. */
  markers: PriorInstallMarkers;
  /** 새 레코드에 찍을 시각. */
  now: number;
}

export interface BeginnerAccountResolution {
  record: BeginnerModeRecord;
  outcome: BeginnerAccountOutcome;
}

/**
 * 이 **계정**은 비기너인가 — 기기가 아니라.
 *
 * ★왜 "계정이 바뀌면 마커를 지운다" 가 아닌가:
 *   지우면 그 흔적을 근거로 advanced 를 유지하던 **원래 유저**가 다음 부팅에
 *   비기너로 떨어진다. 그건 쓰던 사람의 보드가 사라지는 사고이고,
 *   {@link resolveInitialBeginnerMode} 의 비대칭 규율이 대놓고 막는 방향이다.
 *   게다가 계정 채택은 최초 마운트에서도 일어나므로(로그인 상태로 앱을 켜면
 *   undefined → uid) "바뀔 때 지우기" 는 사실상 매 부팅 지우기다.
 *   그래서 흔적은 **남겨 두고 임자를 적어 둔다.**
 *
 * 규칙 셋:
 *   ① 이 계정의 레코드가 있으면 그것이 이긴다 — 기기 흔적은 쳐다보지도 않는다.
 *   ② 기기 흔적이 미청구(또는 임자가 나)면 상속한다. 기존 판정식을 그대로 태워
 *      쓰므로, 업그레이드하는 기존 유저의 화면은 1픽셀도 안 바뀐다.
 *   ③ 임자가 남이면 그 흔적은 남의 것이다 → 이 계정의 첫 실행 = 비기너.
 *      계측 타임스탬프도 물려받지 않는다(남의 퍼널이 새 계정으로 새면 안 된다).
 */
export function resolveBeginnerModeForAccount(
  input: BeginnerAccountInput,
): BeginnerAccountResolution {
  if (input.accountRecord) {
    return { record: input.accountRecord, outcome: "kept" };
  }

  const unclaimed = input.claimedBy === null || input.claimedBy === input.uid;
  if (unclaimed) {
    const state = resolveInitialBeginnerMode(input.legacyRecord, input.markers);
    const inherited: BeginnerModeRecord = input.legacyRecord ?? {
      ...EMPTY_BEGINNER_RECORD,
      enteredAt: state === "beginner" ? input.now : 0,
    };
    return { record: { ...inherited, state }, outcome: "claimed" };
  }

  return {
    record: {
      ...EMPTY_BEGINNER_RECORD,
      state: "beginner",
      enteredAt: input.now,
    },
    outcome: "fresh",
  };
}

// ── 승격 ────────────────────────────────────────────────────────────────────

/** 완료 N건 트리거 임계. 1건은 우연일 수 있고, 3건이면 흐름을 이해한 것. */
export const PROMOTION_MIN_COMPLETED = 3;
/** 사용 일수 트리거 임계(일). 완료가 없어도 사흘째면 화면이 좁은 것일 수 있다. */
export const PROMOTION_MIN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PromotionTrigger = "completed" | "merged" | "days";

export interface PromotionSignals {
  /** 이 프로젝트에서 DONE 으로 끝난 티켓 수. */
  completedTasks: number;
  /**
   * 머지까지 간 티켓 수. ★현재 호출부는 0 을 흘린다(설계 §9 F1) — merge_history
   * 구독이 App.tsx 안에 있고 스토어가 없어서다. 규칙은 미리 받아 둔다: 배선이
   * 붙는 순간 이 파일도 테스트도 안 바뀐다.
   */
  mergedTasks: number;
  /** 비기너로 확정된 뒤 지난 시간(ms). */
  elapsedMs: number;
}

/**
 * 승격 제안을 띄울 것인가 — 셋 중 하나라도 넘고, 아직 한 번도 안 띄웠을 때만.
 *
 * 이미 띄운 적이 있으면(`alreadyShown`) 절대 다시 띄우지 않는다. "지금은 그대로"
 * 를 고른 유저를 며칠 뒤 또 붙잡는 건 조르는 것이고, 되돌아가는 문(설정 토글)은
 * 이미 열려 있다.
 */
export function shouldPromote(
  signals: PromotionSignals,
  alreadyShown: boolean,
): PromotionTrigger | null {
  if (alreadyShown) return null;
  if (signals.mergedTasks >= 1) return "merged";
  if (signals.completedTasks >= PROMOTION_MIN_COMPLETED) return "completed";
  if (signals.elapsedMs >= PROMOTION_MIN_DAYS * DAY_MS) return "days";
  return null;
}

// ── ★S4: 챗 안 인라인 진행 ──────────────────────────────────────────────────

/**
 * 오케가 티켓을 만드는 데 걸리는 시간의 상한선. 이걸 넘도록 티켓이 하나도 안
 * 보이면 "막힌 것"으로 보고 다시 보내기/도움말을 띄운다.
 * (진단 §7 P1-2 ④ 권고 그대로 90초.)
 */
export const STALL_THRESHOLD_MS = 90_000;

export type BeginnerPhase =
  /** 아직 아무 요청도 보내지 않음 — 스트립을 그리지 않는다. */
  | "idle"
  /** 보냈고, 오케가 읽는 중(티켓 아직 없음). */
  | "thinking"
  /** 보냈는데 90초가 지나도록 티켓이 안 보임 — 막힘 안내. */
  | "stalled"
  /** 티켓은 생겼는데 아직 일하는 에이전트가 없음. */
  | "planned"
  /** 에이전트가 일하는 중. */
  | "working"
  /** 완료된 티켓이 있음. */
  | "completed";

export interface BeginnerProgressInput {
  /** 첫(또는 최근) 요청을 오케에 **실제로 전달**한 시각(ms). 0 = 아직 안 보냄. */
  sentAt: number;
  now: number;
  /** 이 프로젝트의 티켓 총 수. */
  totalTasks: number;
  /** DONE 티켓 수. */
  completedTasks: number;
  /** status === "working" 인 에이전트 수. */
  workingAgents: number;
}

export interface BeginnerProgressView {
  phase: BeginnerPhase;
  totalTasks: number;
  completedTasks: number;
  workingAgents: number;
  /** 막힘 안내(다시 보내기 / 도움말)를 함께 보여야 하는가. */
  showStallHelp: boolean;
}

/**
 * 챗 안 미니 라이브의 국면 판정.
 *
 * ★단조 증가가 아니다: 완료 뒤 새 요청을 보내면 `sentAt` 이 갱신되고 티켓이 아직
 * 안 늘었으면 다시 `thinking` 으로 내려간다. "한 번 completed 면 영원히
 * completed" 로 접으면 두 번째 요청이 또 dead-end 가 된다 — 그게 이 화면이
 * 고치려는 바로 그 증상이다.
 *
 * 판정 순서(강한 신호 우선): 완료 → 작업중 → 티켓생성 → 대기/막힘.
 * 완료가 있어도 새로 일하는 에이전트가 있으면 "일하는 중" 이 더 정확한 현재형이라
 * 그쪽이 이긴다.
 */
export function summarizeBeginnerProgress(
  input: BeginnerProgressInput,
): BeginnerProgressView {
  const base = {
    totalTasks: input.totalTasks,
    completedTasks: input.completedTasks,
    workingAgents: input.workingAgents,
    showStallHelp: false,
  };

  if (input.sentAt <= 0 && input.totalTasks === 0) {
    return { ...base, phase: "idle" };
  }

  if (input.workingAgents > 0) return { ...base, phase: "working" };
  if (input.completedTasks > 0) return { ...base, phase: "completed" };
  if (input.totalTasks > 0) return { ...base, phase: "planned" };

  // 티켓이 아직 하나도 없다 — 오케가 읽는 중이거나, 막혔거나.
  const elapsed = input.sentAt > 0 ? input.now - input.sentAt : 0;
  if (input.sentAt > 0 && elapsed >= STALL_THRESHOLD_MS) {
    return { ...base, phase: "stalled", showStallHelp: true };
  }
  return { ...base, phase: input.sentAt > 0 ? "thinking" : "idle" };
}

// ── ★미니 보드: 7상태 → 3컬럼 압축 ──────────────────────────────────────────

/**
 * 비기너가 보는 컬럼. 어드밴스드 보드의 5컬럼(+정체 레인)을 셋으로 접는다.
 *
 * 접는 기준은 "유저가 지금 할 수 있는 게 뭔가" 다. CLAIMED/IN_PROGRESS/REVIEW
 * 의 차이는 에이전트 워크플로의 내부 사정이라 비기너에게는 전부 "진행 중" 이고,
 * 어느 칸에 있든 유저가 할 일은 똑같이 없다.
 */
export const BEGINNER_BOARD_COLUMNS = ["todo", "doing", "done"] as const;
export type BeginnerBoardColumn = (typeof BEGINNER_BOARD_COLUMNS)[number];

/**
 * 압축 컬럼을 대표하는 원래 상태. 미니 보드가 어드밴스드 `KanbanColumn` 을
 * 그대로 재사용하기 때문에(중복 구현 금지) 컬럼 색·카운트 배지는 이 상태에서
 * 나온다 — 라벨만 비기너 문구로 덮어쓴다.
 */
export const BEGINNER_COLUMN_STATUS: Record<BeginnerBoardColumn, TaskStatus> = {
  todo: "TODO",
  doing: "IN_PROGRESS",
  done: "DONE",
};

/** 컬럼당 그리는 카드 수 상한. 넘치면 "+N" 로만 알린다. */
export const BEGINNER_COLUMN_LIMIT = 4;

/**
 * ★BLOCKED/FAILED 는 "진행 중" 으로 접는다.
 *
 * 감추는 선택지는 없다 — 막힌 티켓이 화면에서 사라지는 것이야말로 이 화면이
 * 고치려는 dead-end 다. 그렇다고 "실패" 컬럼을 따로 세우면 비기너에게 처음
 * 보이는 게 빨간 칸이 된다. 그래서 칸은 "아직 안 끝난 일" 로 두고, 막혔다는
 * 사실은 카드 자체가(테두리 + 막힘 칩) 말한다.
 */
export function beginnerBoardColumnFor(
  status: TaskStatus,
): BeginnerBoardColumn {
  if (status === "DONE") return "done";
  if (status === "TODO") return "todo";
  return "doing";
}

export interface BeginnerBoardColumnView<T> {
  column: BeginnerBoardColumn;
  /** 재사용하는 `KanbanColumn` 에 넘길 대표 상태. */
  status: TaskStatus;
  /** 상한까지 자른 카드들. 입력 순서를 유지한다. */
  tasks: T[];
  /** 자르기 **전** 총 개수 — 배지는 항상 진짜 개수를 보여야 한다. */
  total: number;
  /** 상한 때문에 안 그린 수. 0 이면 "+N" 를 숨긴다. */
  hiddenCount: number;
}

/**
 * 티켓을 3컬럼으로 접고 컬럼당 상한까지 자른다.
 *
 * 자르기는 여기서 한다(컴포넌트가 아니라): 티켓 200개짜리 프로젝트에서 비기너
 * 셸의 미니 보드가 챗을 화면 밖으로 밀어내면 안 되고, "총 개수는 진짜, 그린
 * 개수는 상한" 이라는 규칙은 눈으로 확인하기 어려워 테스트로 못박아야 한다.
 */
export function groupBeginnerBoard<T extends { status: TaskStatus }>(
  tasks: readonly T[],
  limit: number = BEGINNER_COLUMN_LIMIT,
): BeginnerBoardColumnView<T>[] {
  const buckets: Record<BeginnerBoardColumn, T[]> = {
    todo: [],
    doing: [],
    done: [],
  };
  for (const task of tasks)
    buckets[beginnerBoardColumnFor(task.status)].push(task);

  return BEGINNER_BOARD_COLUMNS.map((column) => {
    const all = buckets[column];
    const capped = limit >= 0 ? all.slice(0, limit) : all;
    return {
      column,
      status: BEGINNER_COLUMN_STATUS[column],
      tasks: capped,
      total: all.length,
      hiddenCount: all.length - capped.length,
    };
  });
}

// ── 대화 표면은 하나여야 한다 ────────────────────────────────────────────────

export interface BeginnerComposerInput {
  /** 오케가 **실제로 받은** 횟수(useBeginnerAsk.sentCount). 0 = 아직 첫 마디 전. */
  sentCount: number;
  /** 지금 보드에 있는 티켓 수 — 재시작해도 남는 "대화가 이미 있었다" 의 흔적. */
  totalTasks: number;
  /** 티켓 상세가 채워 준 문장. 비어 있지 않으면 무조건 보여야 한다. */
  draft: string;
}

/**
 * 상단 컴포저의 국면.
 *
 *   hidden   — 안 그린다. 대화는 아래 오케 대화창(실 PTY) 하나로 흐른다.
 *   intro    — "무엇을 만들까요?" — 첫 마디를 받는 화면(안내문 + 예시 칩).
 *   followUp — 티켓 상세가 채워 준 문장을 들고 잠깐 다시 나온 컴포저.
 */
export type BeginnerComposerMode = "hidden" | "intro" | "followUp";

/**
 * 상단 컴포저(BeginnerChatBar)를 **지금 그릴 것인가, 어떤 얼굴로.**
 *
 * ★#879 이 상단을 지속 대화창으로 만들면서 입력면이 둘이 됐다: 위 컴포저와
 * 아래 오케 대화창(`OrchestratorPanel` = 실 PTY). 둘 다 같은 곳으로 흘러가지만,
 * 시연에서 사장님이 곧바로 물으신 게 "어디에 써야 하냐" 였다. 두 칸이 나란히
 * 있으면 유저는 매번 그 선택을 하게 되고, 그건 심플 모드가 없애려던 종류의
 * 선택이다. 그래서 대화 표면은 하나로 접는다.
 *
 * 규칙은 셋이다:
 *
 *   ① 첫 마디 전에는 **위**가 대화창이다. 아래 오케 PTY 는 비기너에게 "터미널"
 *      로 읽혀서, 거기 커서를 두고 한국어를 치라고 하면 아무도 안 친다. S4
 *      dead-end("무엇을 해야 할지 모르겠다")의 입구가 이 카드다.
 *   ② 오케가 첫 마디를 받은 뒤에는 **아래**가 대화창이다. 오케의 답이 거기
 *      흐르고 있으므로, 이어지는 말은 답이 보이는 곳에서 하는 게 맞다.
 *   ③ 예외 — 티켓 상세의 "물어보기" 가 문장을 채워 줬으면 다시 보인다. 그
 *      문장이 갈 곳이 없으면 그 버튼이 죽는다(PTY 는 프리필 대상이 아니다).
 *      단 그때의 얼굴은 `followUp` 이다: 하던 일 위에 "무엇을 만들까요?" 와
 *      예시 칩이 다시 깔리면, 그건 첫 화면이 아니라 뒤로 감긴 화면이다.
 *
 * `totalTasks` 를 함께 보는 이유: `sentCount` 는 세션 상태라 재시작하면 0 으로
 * 돌아간다. 티켓이 이미 있는 설치에서 "무엇을 만들까요?" 가 다시 뜨면, 그건
 * 첫 화면이 아니라 하던 일 위에 덮인 중복 입력칸이다.
 */
// ── 온보딩 안내 모달의 배타 ─────────────────────────────────────────────────

export interface BeginnerGuideGateInput {
  /** 원클릭 연결 모달(`BeginnerOneClickModal`)이 떠 있는가. */
  oneClickOpen: boolean;
  /** 캔드 데모(`DemoMode`)를 재생 중인가. */
  demoPlaying: boolean;
}

/**
 * 자기 판정으로 **알아서 뜨는** 온보딩 안내(M1 온램프 차단 · M2 자금 안내)를
 * 지금 그려도 되는가.
 *
 * ★데모가 빠져 있던 것이 이 티켓(E3ywX1ftbVr5f1TrFsgp)에서 잡힌 순서 결함이다.
 * 종전 가드는 `!showOneClick` 뿐이라, 유저가 "▶ 데모 보기" 를 눌러 재생을
 * 시작한 위로 M1("계정을 연결하세요")이 그대로 겹쳐 떴다. 데모는 **연결 전**
 * 화면에서 여는 것이고 M1 은 **연결이 없어서** 뜨는 것이라 둘의 전제가 정확히
 * 겹친다 — 즉 우연이 아니라 항상 겹친다. 그리고 그 순간 유저가 보고 있던 것은
 * 이 제품이 무엇인지 설명하는 대본인데, 그 위에 "연결하세요" 를 덮으면 설명은
 * 끝까지 가지 못한다.
 *
 * 같은 규율을 코치마크 투어는 이미 지키고 있었다(`BeginnerTour.blocked` 에
 * showDemo 가 들어 있다) — 이 함수는 그 규율을 안내 모달 쪽에도 맞춘 것이다.
 * 데모를 닫으면 두 안내는 즉시 자기 판정대로 다시 뜬다(억제일 뿐 소거가 아니다).
 */
export function shouldRenderOnboardingGuides({
  oneClickOpen,
  demoPlaying,
}: BeginnerGuideGateInput): boolean {
  return !oneClickOpen && !demoPlaying;
}

export function beginnerComposerMode({
  sentCount,
  totalTasks,
  draft,
}: BeginnerComposerInput): BeginnerComposerMode {
  if (sentCount === 0 && totalTasks === 0) return "intro";
  return draft.trim().length > 0 ? "followUp" : "hidden";
}
