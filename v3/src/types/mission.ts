// Mission — 사용자 의도의 영속적 컨테이너. orchestrator가 owner로 책임지고
// 끝까지 가져간다. 자세한 명세: v3/docs/MISSIONS-SPEC.md §3-4.

export type MissionStatus =
  | "planning"
  | "active"
  | "waiting_for_human"
  | "sleeping"
  | "completed"
  | "abandoned";

/** 사용자가 런치 다이얼로그에서 고를 수 있는 자동화 템플릿. */
export type MissionLaunchTemplateId =
  | "quick-fix"
  | "polish"
  | "feature"
  | "full-feature"
  | "research";

/**
 * 미션 문서가 실을 수 있는 templateId 전부.
 *
 * `"adhoc"` 은 **암묵적 미션**(오케가 ad-hoc 보드 배치에 붙인 라벨) 전용이라
 * 런치 목록(`listTemplates`)에 나오지 않는다. 두 타입을 갈라 둔 덕에 런치
 * 다이얼로그가 "adhoc" 을 실행 가능한 템플릿으로 내놓는 회귀가 타입으로 막힌다.
 */
export type MissionTemplateId = MissionLaunchTemplateId | "adhoc";

/**
 * 미션의 출처. 생략/`"explicit"` = 기존 명시적 미션(엔진·지휘자 구동 대상).
 *
 * `"implicit"` = 오케가 dispatch 시점에 부여한 라벨로 만들어진 가벼운 미션.
 * 실행 계획(steps)이 없고, **미션 엔진이 절대 구동하지 않는다** — 이 마커가
 * 곧 엔진 픽업 경로(`wire.ts` 부팅 복구/planning 구독, `event-forwarder`)의
 * 제외 근거다. 설계: `docs/MISSION-REPLAY-DESIGN.md` §2.1.
 */
export type MissionKind = "explicit" | "implicit";

export type MissionAccessMode = "read" | "write" | "pr" | "commit";

export interface MissionTargetRepository {
  projectId: string;
  localPath: string;
  repoUrl: string | null;
  defaultBranch: string | null;
}

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

  /** 생략 = "explicit"(기존 미션). "implicit" 은 엔진 구동 대상이 아니다. */
  missionKind?: MissionKind;
  /** 암묵적 미션의 라벨 — 오케가 배치에 붙인 이름. 합류 판정의 키. */
  implicitLabel?: string;

  ownerOrchestratorSessionId: string;
  steps: MissionStep[];
  currentStepIndex: number;
  taskIds: string[];
  contextLog: TimelineEvent[];
  targetRepository?: MissionTargetRepository;
  targetBranch?: string;
  targetAccessMode?: MissionAccessMode;

  /** 이 미션의 '대표 보드 카드'(tasks/*) id. 지휘자가 미션 시작 시 1개 만들고 진행을
   *  activity 로 쌓는다. 한 번 만들면 재생성하지 않는 멱등 키. */
  missionCardTaskId?: string;

  launchedAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  abandonedReason?: string;
}

/** 암묵적 미션인가 — 엔진 구동 제외/Replay 라벨 표시의 단일 판정. */
export function isImplicitMission(mission: {
  missionKind?: MissionKind | string | null;
}): boolean {
  return mission.missionKind === "implicit";
}
