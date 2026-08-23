/** One shared vocabulary: routing observations and task-cost labels must join unchanged. */
export type OutcomeMode =
  | "spawn_failed" | "auth_failed" | "tool_zero" | "crash_loop"
  | "crashed" | "no_activity_stale" | "dependency_stuck" | "blocked"
  | "failed" | "review_rejected" | "completed" | "merged";

export const OUTCOME_MODES: readonly OutcomeMode[] = [
  "spawn_failed", "auth_failed", "tool_zero", "crash_loop", "crashed",
  "no_activity_stale", "dependency_stuck", "blocked", "failed",
  "review_rejected", "completed", "merged",
] as const;
