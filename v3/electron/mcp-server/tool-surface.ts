export const CODEX_ORCH_REQUIRED_MCP_TOOLS = [
  "get_agent_skill",
  "get_all_tasks",
  "create_task",
  "create_tasks_bulk",
  "dispatch_task",
  "add_activity",
  "update_task_status",
  "get_agents",
] as const;

export const CODEX_ORCH_REQUIRED_MCP_TOOL_COUNT =
  CODEX_ORCH_REQUIRED_MCP_TOOLS.length;
