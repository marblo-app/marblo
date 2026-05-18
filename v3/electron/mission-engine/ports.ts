import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
} from "./types";

// Mission engine 은 ports 인터페이스만 의존한다.
// 실제 구현체 (Firestore / OrchestratorManager / AgentManager / MCP run_skill) 는
// Step 5 main.ts wiring 에서 주입. 테스트는 in-memory fake 로 대체.

export interface MissionStore {
  getMission(missionId: string): Promise<Mission | null>;
  createMission(
    data: Omit<Mission, "id" | "launchedAt" | "lastActivityAt" | "completedAt">,
  ): Promise<string>;
  updateMission(
    missionId: string,
    patch: Partial<Omit<Mission, "id" | "launchedAt">>,
  ): Promise<void>;
  appendTimelineEvent(missionId: string, event: TimelineEvent): Promise<void>;
  updateMissionStep(
    missionId: string,
    stepIndex: number,
    patch: Partial<MissionStep>,
  ): Promise<void>;
  setMissionStatus(
    missionId: string,
    status: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string },
  ): Promise<void>;
}

export type TaskStatusLite =
  | "TODO"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "DONE";

export interface TaskDispatcher {
  // dispatch step: 미션 goal 을 task 들로 분해 + agent spawn 까지 책임지고
  // 새로 만들어진 task id 들을 반환. 내부적으로 orchestrator/task-decomposer +
  // agent-manager 를 호출하게 된다 (Step 5 wiring).
  dispatchTasks(input: {
    missionId: string;
    projectId: string;
    goal: string;
  }): Promise<string[]>;

  // wait step: 현재 미션이 거느린 task 들의 상태를 일괄 조회.
  getTaskStatuses(taskIds: string[]): Promise<Record<string, TaskStatusLite>>;

  // abandon: 진행 중 task 의 에이전트를 정리.
  killAgentsForTasks(taskIds: string[]): Promise<void>;
}

export interface SkillResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface SkillRunner {
  runSkill(input: {
    missionId: string;
    skill: string; // ALLOWED_SKILLS 중 하나 — runner 가 다시 검증
    args?: string;
    timeoutMs?: number;
  }): Promise<SkillResult>;
}

export interface FixRunner {
  // 자율 코딩 step. quick-fix 의 'fix' 슬롯이 사용.
  // 실제 구현은 dispatch → wait 와 유사한 task 1 개 spawn 패턴이 자연스러움.
  runFix(input: {
    missionId: string;
    projectId: string;
    goal: string;
  }): Promise<{ success: boolean; error?: string }>;
}

export interface OrchestratorRef {
  sessionId: string;
  isAlive(): boolean;
  postMessage(message: string): Promise<void>;
}

export interface OrchestratorRegistry {
  // 미션 owner orchestrator 세션을 보장. 기존 세션이 살아있으면 reuse,
  // 없거나 죽어있으면 새로 만든다.
  ensureSession(input: {
    missionId: string;
    projectId: string;
  }): Promise<OrchestratorRef>;

  getSession(sessionId: string): OrchestratorRef | null;
}

// Engine 외부에서 들어오는 신호 — task 상태 변화, agent stuck 등.
// orchestrator timeline 의 TimelineEventType 과는 별개 layer.
export type MissionEngineEventType =
  | "task.status_changed"
  | "agent.stuck"
  | "agent.completed"
  | "user.input_received"
  | "mission.wakeup_request";

export interface MissionEngineEvent {
  type: MissionEngineEventType;
  missionId: string;
  payload: Record<string, unknown>;
}

export type MissionEventHandler = (
  event: MissionEngineEvent,
) => void | Promise<void>;

export interface MissionEventBus {
  on(handler: MissionEventHandler): () => void; // returns unsubscribe
  emit(event: MissionEngineEvent): void;
}

export interface MissionEngineDeps {
  store: MissionStore;
  dispatcher: TaskDispatcher;
  skillRunner: SkillRunner;
  fixRunner: FixRunner;
  eventBus: MissionEventBus;
  orchestrators: OrchestratorRegistry;
  // D10 결정: retry default 2 회 (1-2회 후 알림 카드).
  maxRetries?: number;
  // 테스트 / 로깅용
  now?: () => Date;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}
