/**
 * Decision core for the `merge_and_close` MCP tool (ticket pn2m5cVx).
 *
 * Why a separate, dependency-free module: the tool's job is to close a ticket
 * automatically at merge time, and the failure modes are wildly asymmetric.
 *
 *   • A wrong DONE flip silently closes work that is NOT finished. "코드 머지 ≠
 *     작업 완료": the PR lands, but the ticket's actual goal still needs a
 *     secret, an approval, or a live re-run. Two real tickets are exactly this
 *     — N8sAY4Tj (marketing_contacts 백필 미실행: PR #585 MERGED, ticket still
 *     REVIEW because the backfill was never run) and 84tDu7UW (Sentry alert
 *     rules awaiting approval). Auto-DONE on those destroys the only signal a
 *     human had that the work is outstanding.
 *   • A wrong HOLD just leaves the ticket in REVIEW, where the orchestrator and
 *     the board both still show it.
 *
 * So every rule here is biased toward holding, and the whole decision is a pure
 * function over plain data — no Firestore, no git, no gh — so the branch can be
 * pinned by unit tests instead of only being exercised against a live board.
 */
import type { TaskStatus } from "./state-machine.js";

/** Merge state of the PR backing a ticket, as resolved from `gh`. */
export type MergeState = "MERGED" | "OPEN" | "CLOSED" | "UNKNOWN";

export interface MergeVerdict {
  state: MergeState;
  prNumber?: number;
  url?: string;
  /** gh `mergeStateStatus` — "DIRTY" means the PR currently conflicts. */
  mergeStateStatus?: string;
  /** Free-form context for the caller's message (e.g. why it's UNKNOWN). */
  detail?: string;
}

export interface FollowupTextSources {
  /**
   * The ticket's `comment` — written at each status change, so it reflects
   * CURRENT state. This is the primary live-signal surface.
   */
  comment?: string | null;
  /**
   * The ticket body. Immutable creation-time spec (the completion protocol says
   * so explicitly), therefore scanned ONLY for a deliberate opt-in marker and
   * never for incidental planning language like "실행 전 승인 필수" — which
   * appears in the 제약·주의 section of nearly every ticket, including ones
   * that shipped DONE.
   */
  description?: string | null;
  /** Structured notes; treated as live state, same as `comment`. */
  notes?: readonly string[] | null;
}

export interface CloseoutInput extends FollowupTextSources {
  status: TaskStatus;
  merge: MergeVerdict;
}

export type CloseoutAction = "FLIP_DONE" | "HOLD_REVIEW" | "NO_CHANGE";

export interface CloseoutVerdict {
  action: CloseoutAction;
  /**
   * Statuses to apply in order. Every hop is a legal edge in state-machine.ts,
   * so the caller never needs `force=true` — the escape hatch stays reserved
   * for humans, and the existing state machine remains the single authority.
   */
  path: TaskStatus[];
  /** Human-readable rationale; surfaced to the orchestrator and written as the
   *  ticket comment on a hold. */
  reason: string;
  /** Which followup markers matched, for the hold comment. */
  followupSignals: string[];
  /**
   * Whether to attempt worktree reap. True even on HOLD_REVIEW: the PR is
   * merged, so the branch's commits live on origin and the reap is provably
   * lossless (WorktreeManager.reapSafety still vetoes dirty / unpushed trees on
   * its own). Holding the ticket is about the WORK being unfinished, not about
   * the worktree still being needed.
   */
  reapWorktree: boolean;
}

export const WIKI_DECISION_PENDING_MARKER = "[wiki-decision:pending]";
export const WIKI_DECISION_RESOLVED_MARKER = "[wiki-decision:resolved]";

export interface MergeWikiDecisionPromptInput {
  taskId: string;
  pendingUnresolvedCount?: number;
  pendingExamples?: readonly string[];
  recordError?: string;
}

export function isWikiDecisionResolvedMessage(message: string): boolean {
  const normalized = normalize(message);
  if (normalized.includes(WIKI_DECISION_PENDING_MARKER)) return false;
  return (
    normalized.includes(WIKI_DECISION_RESOLVED_MARKER) ||
    normalized.includes("wiki-skip") ||
    normalized.includes("위키 스킵") ||
    normalized.includes("/wiki-note") ||
    normalized.includes("wiki_ingest")
  );
}

/**
 * A wiki decision belongs to a merged change, not to whether its worktree was
 * still present long enough to reap. Once an explicit decision was recorded,
 * repeating the prompt trains the orchestrator to ignore it.
 */
export function shouldPromptForMergeWikiDecision(input: {
  mergeState: MergeState;
  alreadyResolved: boolean;
}): boolean {
  return input.mergeState === "MERGED" && !input.alreadyResolved;
}

export function formatMergeWikiDecisionPrompt(
  input: MergeWikiDecisionPromptInput,
): string {
  const pending =
    input.pendingUnresolvedCount === undefined
      ? "미판정 누적: 확인 실패 — 이번 머지는 막지 않는다."
      : `미판정 누적: ${input.pendingUnresolvedCount}건`;
  const examples =
    input.pendingExamples && input.pendingExamples.length > 0
      ? `\n- 미판정 예: ${input.pendingExamples.join(", ")}`
      : "";
  const recordError = input.recordError
    ? `\n- 기록 경고: ${input.recordError} — 이번 머지는 막지 않는다.`
    : "";
  return [
    "",
    "위키 판정:",
    "- 질문: 이번 변경이 다음 작업에도 반복될 규칙인가?",
    "- 예: docs/wiki 노트를 쓰거나 기존 노트를 고친다. 초안 제안은 가능하지만 사람 반영이 기준이다.",
    "- 아니오: docs/wiki/_meta/WIKI-SKIP.md 에 한 줄 사유를 남긴다.",
    `- 판정 뒤 기록: add_activity(task_id="${input.taskId}", message="${WIKI_DECISION_RESOLVED_MARKER} <노트 경로 또는 WIKI-SKIP 사유>")`,
    `- ${pending}${examples}${recordError}`,
  ].join("\n");
}

/**
 * Deliberate opt-in markers. Unambiguous enough to honor anywhere, including
 * the immutable ticket body — someone typed these on purpose.
 */
const EXPLICIT_MARKERS = [
  "needs_followup",
  "needs-followup",
  "needs followup",
  "후속필요",
  "후속 필요",
  "done 금지",
  "done금지",
] as const;

/**
 * Live-state hold language. Scanned in `comment`/`notes` ONLY — these words are
 * normal in a *plan* and only mean "still outstanding" when written as the
 * ticket's current status.
 */
const LIVE_HOLD_MARKERS = [
  "done 아님",
  "승인 대기",
  "승인 미수령",
  "승인 필요",
  "라이브 검증 대기",
  "실행 대기",
  "미실행",
  "보류",
  "차단",
  "블로커",
  "blocker",
  "awaiting approval",
  "pending approval",
  "follow-up required",
] as const;

/**
 * Tokens that flip a hold marker into its opposite when they follow closely
 * ("차단 없음", "blocker: none", "블로커 해소됨"). Without this, a comment that
 * explicitly reports the absence of blockers would pin the ticket at REVIEW.
 */
const NEGATIONS = [
  "없음",
  "없다",
  "없습니다",
  "해소",
  "해제",
  "none",
  "no ",
  "cleared",
  "resolved",
] as const;

/** How far past a marker we look for a negation. Wide enough for "차단: 없음"
 *  and "blocker: none", narrow enough not to swallow the next sentence. */
const NEGATION_WINDOW = 12;

const normalize = (s: string): string => s.toLowerCase();

function containsAt(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return hits;
    hits.push(i);
    from = i + needle.length;
  }
}

function isNegated(text: string, start: number, len: number): boolean {
  const tail = text.slice(start + len, start + len + NEGATION_WINDOW);
  return NEGATIONS.some((n) => tail.includes(n));
}

function scan(
  text: string | null | undefined,
  markers: readonly string[],
  { allowNegation }: { allowNegation: boolean },
): string[] {
  if (!text) return [];
  const hay = normalize(text);
  const found: string[] = [];
  for (const m of markers) {
    const hits = containsAt(hay, m);
    if (hits.length === 0) continue;
    // A marker counts if ANY occurrence is un-negated: "차단 없음" is clean, but
    // "차단 없음 … 승인은 차단 중" must still hold.
    const live = allowNegation
      ? hits.some((i) => !isNegated(hay, i, m.length))
      : true;
    if (live) found.push(m);
  }
  return found;
}

/**
 * Which "this ticket is not actually finished" signals are present.
 *
 * Returns the matched marker strings (deduped, lower-cased) so the caller can
 * quote them back in the hold comment — an unexplained hold is as confusing as
 * a wrong flip.
 */
export function detectFollowupSignals(src: FollowupTextSources): string[] {
  const notesText = (src.notes ?? []).join("\n");
  const signals = [
    // Explicit opt-in: honored on every surface, body included.
    ...scan(src.comment, EXPLICIT_MARKERS, { allowNegation: true }),
    ...scan(src.description, EXPLICIT_MARKERS, { allowNegation: true }),
    ...scan(notesText, EXPLICIT_MARKERS, { allowNegation: true }),
    // Live state only — deliberately NOT src.description.
    ...scan(src.comment, LIVE_HOLD_MARKERS, { allowNegation: true }),
    ...scan(notesText, LIVE_HOLD_MARKERS, { allowNegation: true }),
  ];
  return [...new Set(signals)];
}

/** Ticket states a merge-time closeout may act on at all. */
const CLOSEABLE: readonly TaskStatus[] = ["REVIEW", "IN_PROGRESS"];

/**
 * The full merge_and_close decision. Order matters and encodes the ticket's
 * invariants:
 *   1. already DONE  → idempotent no-op (but still worth reaping the worktree)
 *   2. not REVIEW/IN_PROGRESS → not a closeout candidate
 *   3. PR not merged → change NOTHING (never force a merge or a status)
 *   4. followup signals → hold at REVIEW with the reason
 *   5. otherwise → DONE via legal transitions only
 */
export function evaluateMergeCloseout(input: CloseoutInput): CloseoutVerdict {
  const { status, merge } = input;

  if (status === "DONE") {
    return {
      action: "NO_CHANGE",
      path: [],
      reason: "티켓이 이미 DONE — 상태는 그대로 두고 워크트리 정리만 시도한다.",
      followupSignals: [],
      reapWorktree: true,
    };
  }

  if (!CLOSEABLE.includes(status)) {
    return {
      action: "NO_CHANGE",
      path: [],
      reason: `티켓이 ${status} 상태 — merge_and_close 는 REVIEW/IN_PROGRESS 티켓만 마감한다.`,
      followupSignals: [],
      reapWorktree: false,
    };
  }

  if (merge.state !== "MERGED") {
    const pr = merge.prNumber ? `PR #${merge.prNumber}` : "PR";
    const conflicted =
      (merge.mergeStateStatus ?? "").toUpperCase() === "DIRTY"
        ? " (충돌 상태)"
        : "";
    // Trim trailing sentence punctuation so the composed reason doesn't read
    // "…넘겨라.. 아무 상태도".
    const detail = merge.detail
      ? ` — ${merge.detail.trim().replace(/[.。]+$/, "")}`
      : "";
    const reason =
      merge.state === "UNKNOWN"
        ? `${pr} 머지 여부를 확인하지 못했다${detail}. 아무 상태도 바꾸지 않는다.`
        : `${pr} 가 아직 ${merge.state}${conflicted}${detail}. ` +
          `머지 전이므로 티켓·워크트리 모두 그대로 둔다.`;
    return {
      action: "NO_CHANGE",
      path: [],
      reason,
      followupSignals: [],
      reapWorktree: false,
    };
  }

  const followupSignals = detectFollowupSignals(input);
  if (followupSignals.length > 0) {
    return {
      action: "HOLD_REVIEW",
      // An IN_PROGRESS followup ticket is still brought up to REVIEW: the code
      // did land, so REVIEW ("merged, awaiting the rest") is the honest state.
      path: status === "IN_PROGRESS" ? ["REVIEW"] : [],
      reason:
        `PR 는 머지됐지만 후속 작업이 남아 있어 DONE 으로 넘기지 않는다 ` +
        `(감지된 신호: ${followupSignals.join(", ")}). ` +
        `코드 머지 ≠ 작업 완료 — 후속을 마치고 사람이 DONE 으로 닫아야 한다.`,
      followupSignals,
      reapWorktree: true,
    };
  }

  return {
    action: "FLIP_DONE",
    path: status === "IN_PROGRESS" ? ["REVIEW", "DONE"] : ["DONE"],
    reason: merge.prNumber
      ? `PR #${merge.prNumber} 머지 확인 — 티켓을 DONE 으로 마감한다.`
      : "PR 머지 확인 — 티켓을 DONE 으로 마감한다.",
    followupSignals: [],
    reapWorktree: true,
  };
}

/** `https://github.com/<owner>/<repo>/pull/585[/files]` → 585. */
export function parsePrNumber(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * True when `branch` is the worktree branch of `taskId`.
 *
 * WorktreeManager.branchName builds `marblo/<slug>-<taskId.slice(0,8)>` and
 * widens the id suffix when that collides, so the stable part is the id suffix
 * — match on that rather than on the (free-form, user-supplied) slug.
 */
export function branchMatchesTask(branch: string, taskId: string): boolean {
  if (!branch || !taskId || taskId.length < 8) return false;
  const m = /-([A-Za-z0-9]+)$/.exec(branch);
  if (!m) return false;
  const suffix = m[1];
  // Require at least the canonical 8 chars so a short trailing token in a slug
  // ("...-fix", "-v2") can never be read as a task id.
  if (suffix.length < 8) return false;
  return taskId.startsWith(suffix);
}
