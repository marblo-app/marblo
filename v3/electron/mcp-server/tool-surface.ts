export const CODEX_ORCH_REQUIRED_MCP_TOOLS = [
  "get_agent_skill",
  "get_all_tasks",
  "create_task",
  "create_tasks_bulk",
  "dispatch_task",
  "add_activity",
  "update_task_status",
  "get_agents",
  // Merge-time closeout. Listed here so the Codex orchestrator is told the tool
  // exists at boot: without it the orch falls back to `gh pr merge` alone and
  // the ticket + worktree are never closed out (ticket pn2m5cVx).
  "merge_and_close",
] as const;

export const CODEX_ORCH_REQUIRED_MCP_TOOL_COUNT =
  CODEX_ORCH_REQUIRED_MCP_TOOLS.length;

/**
 * What a tool promises to do with a `project_id` argument.
 *
 * Ticket IuucvLemDFvbh4UYmL1o: every read/query tool accepted `project_id` and
 * silently threw it away, so the orchestrator constitution's "pass project_id
 * and verify the result" procedure was not a real guarantee. There are now
 * exactly two honest contracts, and `project-lock-surface.test.ts` fails if a
 * tool declares `project_id` without picking one:
 *
 *   • "locked"  — the argument is honored, but a project other than the bound
 *     session project is refused with an actionable ProjectLockError. Never
 *     answers for a different project than the caller named.
 *   • "cross-project-create" — W7 writes that may deliberately file into another
 *     project. They already honor the argument (resolveProjectForCreate) and
 *     warn on any fallback, so they were never a silent-ignore path.
 *
 * There is deliberately no "ignored" contract. Accepting an argument and not
 * using it is the one behavior this registry exists to prevent.
 */
export type ProjectIdContract = "locked" | "cross-project-create";

export const PROJECT_ID_TOOL_CONTRACTS: Readonly<
  Record<string, ProjectIdContract>
> = {
  get_all_tasks: "locked",
  get_available_tasks: "locked",
  check_feedback: "locked",
  search_tasks: "locked",
  get_agents: "locked",
  create_flow: "locked",
  get_flows: "locked",
  add_pending_instruction: "locked",
  create_task: "cross-project-create",
  create_tasks_bulk: "cross-project-create",
};
