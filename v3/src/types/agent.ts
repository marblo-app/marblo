export type ModelType = "claude" | "gemini" | "gpt" | "custom";
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
  // Rolling cost totals updated by useCostWriter on every cost:update IPC.
  // Optional — agents created before this field existed simply read 0/undefined.
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
  totalCacheWriteTokens?: number;
  costUpdatedAt?: Date;
}
