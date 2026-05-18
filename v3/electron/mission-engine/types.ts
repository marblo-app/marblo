// Mission engine 전용 타입.
// frontend `src/types/mission.ts` 와 의도적으로 미러링 — electron tsconfig 가
// rootDir 밖 import 를 거부하므로 (`agent-manager.ts`, `flow-engine/types.ts` 패턴),
// 자체 사본을 둔다. 양쪽이 발산하지 않도록 PR 시 함께 갱신할 것.

export type MissionStatus =
  | "planning"
  | "active"
  | "waiting_for_human"
  | "sleeping"
  | "completed"
  | "abandoned";

export type MissionTemplateId =
  | "quick-fix"
  | "polish"
  | "feature"
  | "full-feature"
  | "research";

export type MissionStepType = "gstack" | "dispatch" | "wait" | "fix";

export type MissionStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export type MissionStepFailurePolicy = "retry" | "escalate" | "continue";

export interface MissionStep {
  index: number;
  type: MissionStepType;
  skill?: string;
  args?: string;
  onFailure?: MissionStepFailurePolicy;
  status: MissionStepStatus;
  output?: unknown;
  error?: string;
  retryCount?: number;
  startedAt?: Date;
  completedAt?: Date;
}

export type TimelineEventType =
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "user.input"
  | "user.decision"
  | "agent.dispatched"
  | "agent.completed"
  | "agent.stuck"
  | "mission.paused"
  | "mission.resumed"
  | "supervisor.note";

export interface TimelineEvent {
  ts: Date;
  type: TimelineEventType;
  payload: Record<string, unknown>;
}

export interface Mission {
  id: string;
  projectId: string;
  goal: string;
  templateId: MissionTemplateId;
  status: MissionStatus;

  ownerOrchestratorSessionId: string;
  steps: MissionStep[];
  currentStepIndex: number;
  taskIds: string[];
  contextLog: TimelineEvent[];

  launchedAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  abandonedReason?: string;
}

// 허용 슬래시 명령 — Step 5 run_skill MCP 와 sync. injection 방지.
export const ALLOWED_SKILLS = [
  "/review",
  "/qa",
  "/ship",
  "/investigate",
  "/plan-ceo-review",
  "/plan-eng-review",
  "/plan-design-review",
  "/design-review",
  "/office-hours",
  "/autoplan",
] as const;

export type AllowedSkill = (typeof ALLOWED_SKILLS)[number];

export function isAllowedSkill(s: string): s is AllowedSkill {
  return (ALLOWED_SKILLS as readonly string[]).includes(s);
}
