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
    data: Omit<Mission, "id" | "launchedAt" | "lastActivityAt" | "completedAt">
  ): Promise<string>;
  updateMission(
    missionId: string,
    patch: Partial<Omit<Mission, "id" | "launchedAt">>
  ): Promise<void>;
  appendTimelineEvent(missionId: string, event: TimelineEvent): Promise<void>;
  updateMissionStep(
    missionId: string,
    stepIndex: number,
    patch: Partial<MissionStep>
  ): Promise<void>;
  setMissionStatus(
    missionId: string,
    status: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string }
  ): Promise<void>;
}

/**
 * 미션 대표 보드 카드 포트 (conductor-driven). 지휘자가 미션 시작 시 보드에 '미션
 * 대표 카드'(tasks/*, isMissionCard:true, contextId=missionId)를 만들고, 스텝 진행을
 * 댓글(activity)로 쌓고, 상태를 동기화한다. 오케(LLM)가 dispatch/fix 스텝에서 만드는
 * 실제 작업 카드와 별개이며, 대표 카드는 wait-게이트(findMissionTaskIds)에서 제외된다.
 * 미주입 시 conductor 는 카드 동작을 건너뛴다(테스트/하위호환 불변).
 */
export interface MissionBoardPort {
  /** 미션 대표 카드 생성 후 taskId 반환. idempotency 는 호출자(conductor)가 mission.missionCardTaskId 로 보장. */
  createMissionCard(mission: Mission): Promise<string>;
  /** 카드에 진행 댓글(activity) 추가 — applyProjection 으로 activities + projection 갱신. best-effort. */
  addCardActivity(taskId: string, message: string): Promise<void>;
  /** 카드 상태 동기화. status 는 보드 task 상태 문자열 ("IN_PROGRESS" | "DONE" | "FAILED" 등). */
  setCardStatus(taskId: string, status: string): Promise<void>;
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
    // 직전 gstack step 들의 결과 요약 (e.g. /investigate, /plan-eng-review).
    // decomposer 가 더 풍부한 task 분해를 생성하고, 각 task description 에 컨텍스트
    // 가 포함되도록 보강용.
    priorContext?: string;
  }): Promise<string[]>;

  // wait step: 현재 미션이 거느린 task 들의 상태를 일괄 조회.
  getTaskStatuses(taskIds: string[]): Promise<Record<string, TaskStatusLite>>;

  // 미션에 이미 생성된 (비종료) task id 들. 앱 재시작 후 dispatch step 이 다시
  // 실행될 때, 이미 만든 task 를 재연결하고 중복 dispatch 를 막는 멱등 복구용.
  findMissionTaskIds(missionId: string): Promise<string[]>;

  // abandon: 진행 중 task 의 에이전트를 정리.
  killAgentsForTasks(taskIds: string[]): Promise<void>;
}

export interface SkillResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  /**
   * PTY 출력의 끝부분에 사용자 입력 요청 패턴이 감지된 경우 그 텍스트.
   * 예: `/ship` 이 "Create PR? (y/n)" 묻고 멈춘 케이스.
   * engine 은 이 값이 있으면 다음 step 으로 advance 하기 전에 mission 을
   * waiting_for_human 으로 전이 + 알림 카드 표시.
   */
  userInputDetected?: string;
}

export interface SkillRunner {
  runSkill(input: {
    missionId: string;
    projectId: string;
    skill: string; // ALLOWED_SKILLS 중 하나 — runner 가 다시 검증
    args?: string;
    timeoutMs?: number;
    // 진행 중 출력 콜백 — runner 가 stdout/stderr tail 을 throttle 해서 호출.
    // engine 이 이걸 받아 mission step.liveOutput 으로 write 한다.
    onProgress?: (chunk: string) => void;
    // 슬래시 명령 직전에 PTY 로 먼저 주입할 자유 텍스트. 보통 직전 step output 요약.
    // claude 가 brief ack 한 후 실제 슬래시 명령 실행 → 컨텍스트 연결 효과.
    chainPrelude?: string;
  }): Promise<SkillResult>;
  // 자유 텍스트 메시지를 PTY 로 전달 (slash command 가 아닌 경우).
  // 최종 종합 보고서 생성 같이 슬래시 allowlist 밖의 작업에 쓰임.
  // 구현체는 PTY 가 없는 headless runner 에서는 reject 해도 됨.
  runRawMessage?(input: {
    missionId: string;
    projectId: string;
    prompt: string;
    timeoutMs?: number;
    onProgress?: (chunk: string) => void;
  }): Promise<SkillResult>;
}

export interface FixRunner {
  // 자율 코딩 step. quick-fix 의 'fix' 슬롯이 사용.
  // 실제 구현은 dispatch → wait 와 유사한 task 1 개 spawn 패턴이 자연스러움.
  runFix(input: {
    missionId: string;
    projectId: string;
    goal: string;
    // 직전 step (보통 /investigate) 의 출력 요약. 코딩 agent 의 task description
    // 에 포함되어 조사 결과를 그대로 반영해 작업.
    priorContext?: string;
  }): Promise<{ success: boolean; error?: string }>;
}

export interface OrchestratorRef {
  sessionId: string;
  // PTY session 식별자 — PtySkillRunner 가 ptyManager.onData / writeAndSubmit 의
  // 대상으로 사용. ensureSession 직후 set 됨. orchestrator 가 아직 launch 중이라
  // null 이면 caller 가 재시도해야 함.
  ptySessionId: string | null;
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
  // task 상태 전이 wakeup 신호. 발원지=event-forwarder(Firestore tasks 구독). A안의
  // wait-step wakeup 이자 B안에서 지휘자가 'task.status' TimelineEvent 로 합성하는
  // 원천. 페이로드(B안 Phase 4-A 로 taskTitle 추가):
  //   payload: { taskId, from, to, taskTitle }
  | "task.status_changed"
  | "agent.stuck"
  | "agent.completed"
  | "user.input_received"
  | "mission.wakeup_request"
  // B안 Phase 2 (보고 채널) — 미션 오케스트레이터가 스텝 완료/실패를 지휘자
  // (Conductor) 에 보고하는 신호. MCP 도구 `mission_step_done` 이 발원지이며,
  // 메인 프로세스 bridge 가 이 이벤트로 변환해 emit 한다. 페이로드는
  //   payload: { stepIndex: number; result: { success: boolean; output?: unknown; error?: string } }
  // (missionId 는 다른 이벤트들과 동일하게 최상위 필드). 지휘자(P2-A)가 이 이벤트를
  // 구독해 onStepReport 로 처리 — result.success → StepReport.status 매핑.
  // 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §4 / §8.4.
  | "mission.step_reported"
  // B안 Phase 4-A (타임라인 합성) — task 에 add_activity 내레이션이 기록될 때(즉
  // projection.lastActivityAt 가 갱신될 때)의 신호. 발원지=event-forwarder 이며,
  // 오케스트레이터(B) 모드에서만 발행한다(A안 engine 의 generic onEvent 가 이 이벤트를
  // supervisor.note + scheduleAdvance 로 처리하지 않도록 = A안 무영향). 페이로드:
  //   payload: { taskId, message, agentId, taskTitle, activityAtMillis }
  // 지휘자가 구독해 'task.activity' TimelineEvent 로 contextLog 에 합성한다.
  // 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §3.3 / §5.4 / §8-5.
  | "task.activity_logged";

export interface MissionEngineEvent {
  type: MissionEngineEventType;
  missionId: string;
  payload: Record<string, unknown>;
}

export type MissionEventHandler = (
  event: MissionEngineEvent
) => void | Promise<void>;

export interface MissionEventBus {
  on(handler: MissionEventHandler): () => void; // returns unsubscribe
  emit(event: MissionEngineEvent): void;
}

// 미션이 사용자 개입을 요구할 때 (waiting_for_human + notifyUser) 의 알림 페이로드.
// gstack 스킬은 상호작용(AskUserQuestion 등) 이 잦아 PTY 패널을 안 보고 있으면
// 미션이 멈춘 줄 모른다 → main.ts wiring 이 OS 알림 / 인앱 뱃지로 surface.
export interface MissionNeedsInputNotice {
  missionId: string;
  projectId: string;
  goal: string;
  kind: "pty_input_required" | "escalate";
  question?: string;
  skill?: string | null;
}

export type MissionNotifier = (notice: MissionNeedsInputNotice) => void;

export interface MissionEngineDeps {
  store: MissionStore;
  dispatcher: TaskDispatcher;
  skillRunner: SkillRunner;
  fixRunner: FixRunner;
  eventBus: MissionEventBus;
  orchestrators: OrchestratorRegistry;
  // D10 결정: retry default 2 회 (1-2회 후 알림 카드).
  maxRetries?: number;
  // 미션이 사용자 개입을 요구할 때 호출 (OS 알림 / 인앱). 미지정 시 no-op.
  notifier?: MissionNotifier;
  // 테스트 / 로깅용
  now?: () => Date;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}
