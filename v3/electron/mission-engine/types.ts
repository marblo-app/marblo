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

/** 사용자가 런치 다이얼로그에서 고를 수 있는 자동화 템플릿(=실행 계획이 있는 것). */
export type MissionLaunchTemplateId =
  | "quick-fix"
  | "polish"
  | "feature"
  | "full-feature"
  | "research";

/**
 * 미션 문서가 실을 수 있는 templateId 전부. `"adhoc"` 은 암묵적 미션 전용이며
 * `MISSION_TEMPLATES` 에 없다 — 실행 계획이 없기 때문이다.
 */
export type MissionTemplateId = MissionLaunchTemplateId | "adhoc";

/**
 * 미션의 출처. 생략/`"explicit"` = 기존 미션(엔진·지휘자 구동 대상).
 * `"implicit"` = 오케가 ad-hoc 배치에 붙인 라벨. **엔진은 구동하지 않는다.**
 * 설계: `docs/MISSION-REPLAY-DESIGN.md` §2.1.
 */
export type MissionKind = "explicit" | "implicit";

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
  // 실시간 진행 출력 — running 중인 step 의 stdout/stderr tail.
  // skill-runner 가 throttled 로 mission doc 에 write. 종료 시 final output 으로 정리.
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
  // B안 Phase 4-A — 지휘자(Conductor)가 forwarder 의 task 신호(task.status_changed /
  // task.activity_logged)를 contextLog 의 TimelineEvent 로 "합성"해 하나의 서사를
  // 만든다. 단일 writer = 지휘자(orchestrator 모드 전용). 발원지: conductor-driver.onEvent.
  //   task.status   payload { taskId, from, to, taskTitle, key }
  //   task.activity payload { taskId, message, agentId, taskTitle, key }
  // dedup = payload.key 동일하면 skip. 렌더러 미러(src/types/mission.ts)도 함께
  // 갱신(P4-B). 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §3.3 / §5.4 / §8-5.
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

  /** 생략 = "explicit". "implicit" 은 엔진 픽업 대상이 아니다. */
  missionKind?: MissionKind;
  /** 암묵적 미션의 라벨(오케가 배치에 붙인 이름). */
  implicitLabel?: string;

  ownerOrchestratorSessionId: string;
  steps: MissionStep[];
  currentStepIndex: number;
  taskIds: string[];
  contextLog: TimelineEvent[];

  /** 이 미션의 '대표 보드 카드'(tasks/*) id. 지휘자가 미션 시작 시 1개 만들고 진행을
   *  activity 로 쌓는다. 한 번 만들면 재생성하지 않는 멱등 키. */
  missionCardTaskId?: string;

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

/** 암묵적 미션인가 — 엔진 픽업 경로의 단일 제외 판정. */
export function isImplicitMission(mission: {
  missionKind?: MissionKind | string | null;
}): boolean {
  return mission.missionKind === "implicit";
}
