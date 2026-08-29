import type { Agent } from "../types/agent";

export interface AgentVisibilityContext {
  projectOwnerId?: string | null;
  viewerUserId?: string | null;
  localMachineId?: string | null;
}

export type AgentVisibilityQueryScope =
  | { kind: "project" }
  | { kind: "machine"; machineId: string }
  | { kind: "none" };

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isProjectOwnerViewer({
  projectOwnerId,
  viewerUserId,
}: AgentVisibilityContext): boolean {
  return (
    hasText(projectOwnerId) &&
    hasText(viewerUserId) &&
    projectOwnerId === viewerUserId
  );
}

/**
 * Agents are machine-owned PTYs, not project-wide shared resources.
 *
 * Project owners keep the full fleet view because they operate the orchestrator
 * and cleanup surfaces. Non-owner teammates see only agents launched on this
 * machine; foreign/legacy docs are hidden instead of shown read-only because
 * their name/model/task fields are still information disclosure.
 */
export function canViewProjectAgent(
  agent: Pick<Agent, "machineId">,
  context: AgentVisibilityContext,
): boolean {
  if (isProjectOwnerViewer(context)) return true;
  return (
    hasText(context.localMachineId) &&
    agent.machineId === context.localMachineId
  );
}

export function projectAgentQueryScope(
  context: AgentVisibilityContext,
): AgentVisibilityQueryScope {
  if (isProjectOwnerViewer(context)) return { kind: "project" };
  return hasText(context.localMachineId)
    ? { kind: "machine", machineId: context.localMachineId }
    : { kind: "none" };
}

export function filterVisibleProjectAgents<T extends Pick<Agent, "machineId">>(
  agents: T[],
  context: AgentVisibilityContext,
): T[] {
  return agents.filter((agent) => canViewProjectAgent(agent, context));
}
