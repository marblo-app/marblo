import { statusPill } from "../stores/worktreeStore";
import type { Task } from "../types/task";
import type { Worktree, WorktreeStatusPill } from "../types/worktree";

/**
 * Lane 행에 보이는 상태 pill 의 단일 진실의 원천.
 *
 * 배경(버그): 과거 Lanes 탭은 행 상태를 worktree 의 git 상태만 보는
 * {@link statusPill} 로 직접 표시했다. statusPill 은 연결된 task 의 상태를
 * 전혀 모르므로, task 가 DONE/REVIEW/FAILED 로 끝났는데도 worktree 가 기본
 * 버킷(ahead=0·behind=0·충돌없음 — 워커가 작업을 마치고 PTY 가 조용해지면
 * 흔한 상태)이면 ⚪ "작업중"(working)을 영구히 반환했다. 그 결과 이미 완료된
 * 레인이 계속 "작업중"으로 남아 멈춘(stall) 것처럼 보였다.
 *
 * 이 헬퍼가 task 상태와 worktree 상태를 한곳에서 조정한다:
 *
 *   1. 충돌(danger) — 진짜 차단 신호이지 stall 오탐이 아니다. 완료 이후에도
 *      그대로 노출해 사용자가 해소/정리(삭제)하도록 둔다.
 *   2. 터미널 task 상태(DONE/REVIEW/FAILED) — 레인이 끝났다는 단일 진실.
 *      git 기반 "작업중"을 덮어써서 완료된 레인의 거짓 stall 을 제거한다.
 *   3. 그 외(진행 중) — 기존 git 상태 pill 을 따른다(뒤처짐/머지가능/작업중/
 *      stale). IN_PROGRESS 인데 PTY 가 멈춘 "진짜" stall 판정은 별개 레이어
 *      (electron/agent-manager 의 IDLE_INACTIVITY)가 담당하며 여기서 손대지
 *      않는다 — 오탐만 제거한다.
 */
export type LaneStatusTone =
  | WorktreeStatusPill["tone"]
  | "done"
  | "review"
  | "failed";

export interface LaneStatusPill {
  icon: string;
  label: string;
  tone: LaneStatusTone;
}

const TERMINAL_PILL: Partial<Record<Task["status"], LaneStatusPill>> = {
  DONE: { icon: "✅", label: "완료", tone: "done" },
  REVIEW: { icon: "🔵", label: "리뷰", tone: "review" },
  FAILED: { icon: "⛔", label: "실패", tone: "failed" },
};

export function laneStatusPill(
  task: Pick<Task, "status">,
  worktree: Worktree | null,
): LaneStatusPill {
  const git = worktree ? statusPill(worktree) : null;

  // 1. 충돌은 완료 여부와 무관하게 노출(진짜 차단 신호, stall 아님).
  if (git && git.tone === "danger") return git;

  // 2. 터미널 task 상태가 완료 표시의 단일 진실 — git "작업중" 영구 표시(거짓
  //    stall)를 덮어쓴다.
  const terminal = TERMINAL_PILL[task.status];
  if (terminal) return terminal;

  // 3. 진행 중 레인 → git 상태를 따른다. worktree 가 아직 없으면 "준비 중".
  return git ?? { icon: "⚪", label: "준비 중", tone: "idle" };
}
