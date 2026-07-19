import type { Agent } from "../types/agent";
import type { Task } from "../types/task";

/**
 * Pure builders for {@link ArchiveSignals} — the renderer-side inputs to the
 * worktree archive verdict that the git hygiene pass cannot know.
 *
 * Deliberately store-free. The React binding lives in `hooks/useArchiveSignals`;
 * keeping the logic here means it can be unit-tested without dragging
 * agentStore → services/firestore → a live Firebase config into the test.
 */

/** Agent states that mean "this agent is holding its worktree right now". */
const HOLDING_STATUSES: ReadonlySet<Agent["status"]> = new Set([
  "working",
  "idle",
]);

/**
 * Task ids whose ticket is DONE.
 *
 * DONE only. FAILED and BLOCKED tickets are explicitly NOT included: those are
 * exactly the worktrees someone still has to come back to, and hiding them is
 * how a blocked task quietly becomes an abandoned one.
 */
export function buildDoneTaskIds(tasks: Task[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const task of tasks) {
    if (task.status === "DONE") out.add(task.id);
  }
  return out;
}

/**
 * Task ids an agent is currently attached to.
 *
 * `stopped` and `error` agents are excluded — they are not working, and a
 * crashed agent should not pin its worktree visible forever. `idle` counts as
 * holding: an idle agent is still live and still bound to its task (the PTY is
 * up, it is between turns), and the worktree is its cwd.
 */
export function buildBusyTaskIds(agents: Agent[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const agent of agents) {
    if (agent.currentTaskId && HOLDING_STATUSES.has(agent.status)) {
      out.add(agent.currentTaskId);
    }
  }
  return out;
}
