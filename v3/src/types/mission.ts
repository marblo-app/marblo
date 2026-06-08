// Mission — 사용자 의도의 영속적 컨테이너. orchestrator가 owner로 책임지고
// 끝까지 가져간다. 자세한 명세: v3/docs/MISSIONS-SPEC.md §3-4.

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

export type MissionStepType =
  | "gstack" // /review, /qa, /ship, /plan-* 등 슬래시 명령
  | "dispatch" // dispatch_task로 task 분해 + 에이전트 할당
  | "wait" // 모든 dispatch된 task 완료 대기
  | "fix"; // 에이전트 작업 (자율 코딩)

export type MissionStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

// D10 결정: 자동화 미션이므로 default는 'retry' (1-2회 후 알림 카드로 통지).
export type MissionStepFailurePolicy = "retry" | "escalate" | "continue";

export interface MissionStep {
  index: number;
  type: MissionStepType;
  skill?: string;
  args?: string;
  onFailure?: MissionStepFailurePolicy;
  status: MissionStepStatus;
  output?: unknown;
  // 실시간 진행 출력 — running 중인 step 의 stdout/stderr tail.
  liveOutput?: string;
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
  | "supervisor.note"
  // 지휘자(B안)가 오케 task 의 상태전이/진행 내레이션을 미션 서사로 합성해 넣는다.
  | "task.status"
  | "task.activity";

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
