import type { Agent } from "../../types/agent";

export const CONNECTED_RATE_LIMIT_PACKAGES: Record<string, Agent["model"]> = {
  "cli-claude-code": "claude",
  "cli-codex": "gpt",
};

export function getRateLimitProviderModels(
  agents: Pick<Agent, "model">[],
  connectedModels: Agent["model"][],
): Agent["model"][] {
  const s = new Set<Agent["model"]>();
  for (const model of connectedModels) s.add(model);
  for (const a of agents) if (a.model) s.add(a.model);
  return Array.from(s);
}
