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
  // 이 에이전트가 **실제로 어떤 구체 모델로 떴는지** — `model`(벤더/프로바이더)
  // 과는 다른 축이다. 예: model="claude" + spawnedModel="claude-fable-5",
  // model="gpt" + spawnedModel="gpt-5.6-sol@high".
  //
  // 값의 출처는 요청이 아니라 사실이다: main 이 CLI 에 실제로 넘긴 argv 를
  // 되읽어(agent-manager.spawnedModelFromArgs) 스탬프한다. 지정 모델이
  // 버전가드로 폴백했거나 런타임 강등 재시작이 걸린 경우, 여기엔 요청값이
  // 아니라 서빙된 값이 남는다.
  //
  // 모델을 핀하지 않은 launch(오케 기본 경로 등)와 이 필드가 생기기 전에
  // 만들어진 구 doc 에는 없다 — UI 는 반드시 벤더 표시로 graceful fallback.
  spawnedModel?: string;
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
