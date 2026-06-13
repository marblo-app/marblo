export type AgentStatusLabel = "idle" | "working" | "error" | "stopped";

export function formatAgentTaskRoleLabel(
  taskRole: string,
  agentRole?: string | null,
): string {
  const normalizedTaskRole = taskRole.trim() || "unknown";
  const normalizedAgentRole = agentRole?.trim();
  if (!normalizedAgentRole || normalizedAgentRole === normalizedTaskRole) {
    return `role=${normalizedAgentRole || normalizedTaskRole}`;
  }
  return `agentRole=${normalizedAgentRole}, taskRole=${normalizedTaskRole}`;
}

export function normalizeFirestoreFallbackAgentStatus(status: unknown): {
  status: AgentStatusLabel;
  staleActive: boolean;
} {
  if (status === "error" || status === "stopped") {
    return { status, staleActive: false };
  }
  if (status === "idle" || status === "working") {
    return { status: "stopped", staleActive: true };
  }
  return { status: "stopped", staleActive: false };
}
