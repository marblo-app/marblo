export type ModelType =
  | "claude"
  | "gemini"
  | "gpt"
  | "antigravity"
  | "local"
  | "custom";
export type AgentStatus = "idle" | "working" | "error" | "stopped";

export interface Agent {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  model: ModelType;
  role: string;
  status: AgentStatus;
  currentTaskId: string | null;
  command: string;
  skillFile: string;
  createdAt: Date;
  // Stable id of the machine that launched this agent (shared-account safety).
  // Stamped by electron-main when this machine runs the agent. Boot-restore and
  // reap are scoped to docs whose machineId matches the local machine; foreign
  // docs are read-only. Absent on legacy docs created before this field — those
  // are treated as possibly-foreign (not auto-launched). See reconnect-manager.
  machineId?: string;
  // Rolling cost totals updated by useCostWriter on every cost:update IPC.
  // Optional — agents created before this field existed simply read 0/undefined.
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  costUpdatedAt?: Date;
  // Subscription / rate-limit signals. Codex exposes these in its session
  // rollout (plan_type + rate_limits.used_percent); claude/agy don't, so they
  // stay undefined and the UI falls back to the declared plan + token activity.
  detectedPlanType?: string; // e.g. "plus", "pro" (codex plan_type)
  rateLimitPercent?: number; // 0-100, codex primary window used_percent
  rateLimitResetAt?: number; // epoch seconds, codex primary window reset
  rateLimitWeeklyPercent?: number; // 0-100, weekly(7d/secondary) window used %
  rateLimitWeeklyResetAt?: number; // epoch seconds, weekly window reset
}
