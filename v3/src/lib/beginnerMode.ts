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
 *
 * Everything is a pure function of its inputs (no DOM, no storage, no clock) so
 * the activation-critical branches are unit-testable in the node test env. The
 * store (`beginnerModeStore`) wires localStorage + Date.now() into these.
 */

export type BeginnerModeState = "beginner" | "advanced";

/** localStorage key holding the serialized {@link BeginnerModeRecord}. */
export const BEGINNER_MODE_KEY = "marblo.beginnerMode";

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
  /** `marblo.workspaceMode.enabled` — the shell opt-out toggle was touched. */
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
