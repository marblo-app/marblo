/**
 * Generate deterministic session names for agents and orchestrator.
 * Used for reconnection after app restart.
 */

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().slice(0, 30);
}

export function generateSessionName(projectName: string, agentName: string, role: string): string {
  return `${sanitize(projectName)}-${sanitize(agentName)}-${sanitize(role)}`;
}

export function generateOrchestratorSessionName(projectName: string): string {
  return `${sanitize(projectName)}-orchestrator`;
}
