/**
 * English — `agents.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { agents as koAgents } from "../ko/agents";

export const agents: Record<keyof typeof koAgents, string> = {
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "Add Agent",
  "agents.dashboard.cleanup": "Cleanup",
  "agents.dashboard.cleanupConfirm":
    "Delete {count} inactive agents?\n(working agents are kept)",
  "agents.dashboard.loading": "Loading agents...",
};
