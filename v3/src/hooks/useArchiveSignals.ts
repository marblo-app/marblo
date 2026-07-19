import { useMemo } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useTaskStore } from "../stores/taskStore";
import { buildBusyTaskIds, buildDoneTaskIds } from "../lib/archiveSignals";
import type { ArchiveSignals } from "../lib/worktreeHygiene";

/**
 * Live {@link ArchiveSignals} for the current project — the renderer-side
 * inputs to the worktree archive verdict, read from stores that are already
 * subscribed for other reasons.
 *
 * ── Why this is a hook and not an IPC call ───────────────────────────────────
 * A worktree's path encodes the task it belongs to
 * (`~/.marblo/worktrees/<projectId>/<taskId>`), and the store already reverses
 * that into `Worktree.taskId`. So "is this worktree's ticket DONE?" is a Set
 * lookup against data the board is live-subscribed to — not a query.
 *
 * Asking the backend per worktree would be the same shape of mistake #511 fixed
 * on the git side: a per-worktree probe that turns a constant-cost refresh into
 * an N-round-trip one. Here N is ~140 and the answer is already in memory. Two
 * single passes, memoised on the store arrays, and the archive filter gets a
 * signal that means more than any idle clock.
 */
export function useArchiveSignals(): ArchiveSignals {
  const tasks = useTaskStore((state) => state.tasks);
  const agents = useAgentStore((state) => state.agents);

  const doneTaskIds = useMemo(() => buildDoneTaskIds(tasks), [tasks]);
  const busyTaskIds = useMemo(() => buildBusyTaskIds(agents), [agents]);

  return useMemo(
    () => ({ doneTaskIds, busyTaskIds }),
    [doneTaskIds, busyTaskIds],
  );
}
