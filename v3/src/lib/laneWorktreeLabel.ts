import type { MessageKey } from "../locales/ko";
import type { TaskStatus } from "../types/task";
import type { Worktree } from "../types/worktree";

export type LaneWorktreeLabel =
  | { kind: "branch"; branch: string }
  | { kind: "label"; labelKey: MessageKey; tone: "muted" | "complete" };

/**
 * Lanes row branch/worktree copy. Pure so DONE-with-reaped-worktree and
 * not-yet-created-worktree cannot collapse into the same "preparing" string.
 */
export function laneWorktreeLabel(
  task: { status: TaskStatus },
  worktree: Pick<Worktree, "branch"> | null,
): LaneWorktreeLabel {
  if (worktree) return { kind: "branch", branch: worktree.branch };
  if (task.status === "DONE") {
    return {
      kind: "label",
      labelKey: "lanes.row.worktreeCompleted",
      tone: "complete",
    };
  }
  return {
    kind: "label",
    labelKey: "lanes.row.worktreePreparing",
    tone: "muted",
  };
}
