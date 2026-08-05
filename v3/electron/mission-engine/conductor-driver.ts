import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
} from "./types";
import type {
  MissionBoardPort,
  MissionEngineEvent,
  MissionEventBus,
  MissionNotifier,
  MissionStore,
  OrchestratorRegistry,
  TaskStatusLite,
} from "./ports";
import { assertMissionTransition, isTerminalMission } from "./state-machine";

// Conductor (지휘자) — B안(orchestrator-driven mission) 의 운전 위임 계층.
// 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §3.2 / §5.1 / §8.
//
// A안(현재·기본): MissionEngine 이 결정적 advance-loop 로 미션을 직접 운전한다.
// B안: 미션 오케스트레이터(Claude 세션)가 스텝 *안* 을 자율 운전하고, 얇은
//      지휘자(Conductor)는 스텝 *사이* 의 순서·품질 게이트만 보장한다
//      ("스텝 안은 오케의 자율, 스텝 사이는 지휘자의 결정성" — §3.2).
//
// ── Phase 2 (이 파일): 실제 운전 루프 ──
//   requestAdvance → grantStep(현재 스텝만 오케에 허가) → (오케가 작업 후
//   mission_step_done MCP 호출) → 'mission.step_reported' 이벤트 → onStepReport
//   → 게이트 검증(verifyStepGate) → pass 면 다음 스텝 허가, fail 면 retry/escalate.
//   진실원(missions/*)·상태머신은 지휘자가 계속 소유(A안 인프라 재사용).
//
// ★계약 (다른 에이전트가 만드는 파일과는 import/이벤트로만 연동):
//   - P2-B `gates.ts` : `verifyStepGate(step, { getTaskStatuses, mission })
//       => Promise<{pass, reason?}>`. 통합 시 ConductorDriverDeps.verifyStepGate
//       로 주입. 미주입이면 내장 deterministic 기본 게이트로 폴백한다(아래).
//   - P2-C `mcp-server/tools.ts` : `mission_step_done` MCP 가 MissionEventBus 로
//       `{ type: 'mission.step_reported', missionId, payload: {stepIndex, result} }`
//       를 emit. Conductor 는 그 이벤트를 구독해 onStepReport 로 처리한다.

/**
 * 미션 운전 주체.
 *   - `engine`       : A안 — MissionEngine advance-loop 가 운전 (기본). 6월 런칭 경로.
 *   - `orchestrator` : B안 — 미션 오케스트레이터가 운전 + Conductor 가 게이트 보장.
 */
export type MissionDriver = "engine" | "orchestrator";

const DEFAULT_DRIVER: MissionDriver = "engine";

/**
 * 환경변수에서 미션 드라이버를 읽는다. 기본은 `engine` (A안, 회귀 0).
 * `orchestrator` 로 **정확히** 일치할 때만 B안으로 전환 — 오타/미설정/빈 값은 모두
 * 안전하게 engine 으로 떨어진다. main 프로세스라 process.env 를 읽으며,
 * 렌더러 측 설정과의 호환을 위해 VITE_ prefix 도 fallback 으로 본다.
 */
export function getMissionDriver(): MissionDriver {
  const raw = (
    process.env.MISSION_DRIVER ??
    process.env.VITE_MISSION_DRIVER ??
    DEFAULT_DRIVER
  )
    .trim()
    .toLowerCase();
  return raw === "orchestrator" ? "orchestrator" : DEFAULT_DRIVER;
}

/** 오케스트레이터 → 지휘자 스텝완료 보고 (§8.4 보고 채널). */
export interface StepReport {
  missionId: string;
  stepIndex: number;
  /** 오케스트레이터가 보고한 스텝 결과. */
  status: "success" | "failed";
  /** 게이트 검증에 쓰일 산출물 요약 (예: PR URL, review 통과 여부). */
  output?: unknown;
  error?: string;
}

/** 게이트 검증 결과 — 결정적 코드로 평가 (§5.1). */
export interface GateResult {
  /** 게이트 통과 시 다음 스텝 진행 허가. */
  passed: boolean;
  /** 미통과/보류 사유 (타임라인·디버깅용). */
  reason?: string;
}

/** P2-B `gates.ts` 의 verifyStepGate 가 받는 컨텍스트 (§5.1). */
export interface StepGateContext {
  /**
   * 미션이 거느린 task 들의 상태 일괄 조회 — wait 게이트가 "전부 DONE" 판정에 사용.
   * 기존 dispatcher.getTaskStatuses 를 재사용해 주입한다.
   */
  getTaskStatuses: (
    taskIds: string[]
  ) => Promise<Record<string, TaskStatusLite>>;
  /** 게이트 평가 시점의 미션 스냅샷 (taskIds / 직전 step output 등). */
  mission: Mission;
}

/**
 * 스텝 게이트 검증 함수 — **P2-B `gates.ts` 와의 계약**.
 * `gates.ts` 가 `export async function verifyStepGate(step, ctx)` 형태로 구현하며,
 * 통합(오케) 시 ConductorDriverDeps.verifyStepGate 로 주입된다. 미주입 시 Conductor
 * 는 내장 deterministic 기본 게이트(defaultStepGate)로 폴백한다.
 *
 * 격리 워크트리에서는 `gates.ts` 가 아직 없으므로 정적 `import` 대신 이 타입 계약 +
 * 주입으로 연동한다(빌드/타입 회귀 0). 시그니처는 계약 그대로:
 *   verifyStepGate(step, { getTaskStatuses, mission }) => { pass, reason? }
 */
export type VerifyStepGate = (
  step: MissionStep,
  ctx: StepGateContext
) => Promise<{ pass: boolean; reason?: string }>;

/**
 * 오케스트레이터 → 지휘자 스텝완료 보고를 실어 나르는 MissionEventBus 이벤트 타입.
 * P2-C `mcp-server/tools.ts` 의 `mission_step_done` MCP 가 이 type 으로 emit:
 *   { type: 'mission.step_reported', missionId, payload: { stepIndex, result } }
 * (result = { status, output?, error? }). MissionEngineEventType(ports.ts) 의
 * 별개 layer 라, Conductor 는 String 비교로 방어적으로 narrow 한다.
 */
export const MISSION_STEP_REPORTED_EVENT = "mission.step_reported";

/**
 * Conductor 가 의존하는 포트. 진실원(missions/*) 은 store, 오케스트레이터 세션
 * 제어(스텝 권한 주입)는 orchestrators, 보고/wakeup 수신은 eventBus 로 한다 —
 * A안 엔진과 동일 인프라 재사용.
 */
export interface ConductorDriverDeps {
  store: MissionStore;
  orchestrators: OrchestratorRegistry;
  /** 스텝완료 보고('mission.step_reported') + 외부 wakeup 이벤트 구독 채널. */
  eventBus: MissionEventBus;
  /** wait 게이트용 task 상태 조회 — dispatcher.getTaskStatuses 재사용해 주입. */
  getTaskStatuses: (
    taskIds: string[]
  ) => Promise<Record<string, TaskStatusLite>>;
  /**
   * 오케스트레이터가 MCP(`create_task`/`dispatch_task`)로 만든 미션 task 의 **비종료**
   * id 들을 역추적 (dispatcher.findMissionTaskIds 재사용해 주입, §5.2).
   *
   * B안에선 task 를 **오케가 직접** 만들기 때문에(지휘자가 만들지 않음) 지휘자의
   * `mission.taskIds` 는 비어 있다. wait/dispatch 게이트 검증 직전 이 헬퍼로
   * `mission.taskIds` 를 동기화해, `getTaskStatuses` 가 오케 생성 task 를 보고
   * "전부 DONE" 판정을 내릴 수 있게 한다 (§5.2 / §8-3). 오케 `create_task` 는 B1-3 로
   * `missionId` 가 태깅돼 있어 단일 필드 쿼리로 잡힌다.
   *
   * 미주입 시 동기화는 no-op — 지휘자는 `mission.taskIds` 를 그대로 사용한다
   * (Phase 2 호환: 게이트가 직접 주입된 fake 든 default 든 동작 불변).
   */
  findMissionTaskIds?: (missionId: string) => Promise<string[]>;
  /**
   * P2-B `gates.ts` 의 게이트 검증기. 통합 시
   *   `import { verifyStepGate } from "./gates"` 로 주입.
   * 미주입 시 내장 deterministic 기본 게이트(defaultStepGate) 폴백.
   */
  verifyStepGate?: VerifyStepGate;
  /** 실패 정책 retry 한도 (engine 과 동일 default 2 — D10). */
  maxRetries?: number;
  /** escalate / 사용자 개입 필요 시 호출 (engine 과 동일 알림 채널). */
  notifier?: MissionNotifier;
  /**
   * 미션 대표 보드 카드 포트 (선택). 주입되면 지휘자가 미션 시작 시 대표 카드를
   * 만들고 스텝 진행을 카드 activity 로 쌓고 상태를 동기화한다. 미주입 시 카드
   * 동작은 모두 건너뛴다(테스트/하위호환 불변). dispatcher-impl 이 구현 → wire.ts 주입.
   */
  board?: MissionBoardPort;
  /**
   * 보고-감시(report watchdog) nudge 간격 ms. grantStep 후 이 간격마다 보고가
   * 없으면 오케에 "끝났으면 mission_step_done 보고하라"를 주입한다. 기본 240s
   * (run_skill 타임아웃 10분 고려 — 진행 중 nudge 는 큐잉돼도 무해). 테스트는 짧게.
   */
  reportNudgeIntervalMs?: number;
  /** 최대 nudge 횟수. 초과하면 escalate(waiting_for_human + 사용자 알림). 기본 3. */
  maxReportNudges?: number;
  now?: () => Date;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * 지휘자 인터페이스 (B안). MissionEngine 이 orchestrator 모드일 때 advance-loop
 * 대신 이 드라이버로 운전을 위임한다.
 */
export interface ConductorDriver {
  /**
   * 미션 운전 시작/재개 — 현재 스텝 진행을 오케스트레이터에 허가하는 진입점.
   * A안 `MissionEngine.scheduleAdvance` 의 B안 대응 (launch / resume 가 호출).
   */
  requestAdvance(missionId: string): void;

  /**
   * 현재 스텝 진행 권한을 오케스트레이터에 **한 번에 하나** 부여한다 (§3.2/§5.1).
   * 오케스트레이터는 이 스텝만 진행하고, 끝나면 onStepReport 로 보고한다.
   */
  grantStep(missionId: string, stepIndex: number): Promise<void>;

  /**
   * 오케스트레이터의 스텝완료 보고 처리 → 게이트 검증 후 다음 스텝 허가 또는 보류
   * (§8.4). 게이트 미통과면 보류하고 retry/escalate.
   */
  onStepReport(report: StepReport): Promise<void>;

  /**
   * 스텝 게이트 검증 — 결정적 (예: wait=task 전부 DONE, ship=PR URL 존재) (§5.1).
   * LLM 자율에 맡기지 않고 코드로 보장한다.
   */
  verifyGate(missionId: string, stepIndex: number): Promise<GateResult>;

  /**
   * 외부 이벤트(agent.completed 등) wakeup → 다음 게이트 평가 (§3 이벤트 wakeup).
   * A안에서 onEvent → scheduleAdvance 였던 경로의 B안 대응.
   */
  onEvent(event: MissionEngineEvent): Promise<void>;

  /** 구독/타이머 정리. MissionEngine.dispose 에서 호출. */
  dispose(): void;
}

const PR_URL_RE = /https?:\/\/\S+/;

/**
 * task 완료 게이트가 걸리는 스텝 타입 — wait / dispatch (gates.ts 의
 * verifyTaskCompletionGate 와 동일 분류). 이 스텝들은 (a) 게이트 검증 직전
 * `findMissionTaskIds` 로 taskIds 를 동기화하고, (b) 성공 보고여도 task 가 아직
 * 완료 전이면 retry(재할당) 하지 않고 **running 유지 + 이벤트로 재평가**한다
 * (재dispatch 로 중복 task 가 생기는 걸 막는다 — §5.2 / §8-3).
 */
function isTaskGatedStep(step: MissionStep): boolean {
  return step.type === "wait" || step.type === "dispatch";
}

/**
 * 내장 기본 게이트 — §5.1 결정적 예시. P2-B gates.ts 미주입 시 폴백한다.
 *   - wait/dispatch : mission.taskIds 가 전부 DONE 이어야 통과 (미완료 있으면 보류).
 *   - /ship         : 스텝 output 에 PR URL 이 있어야 통과.
 *   - 그 외          : 오케스트레이터의 성공 보고를 신뢰(통과).
 */
const defaultStepGate: VerifyStepGate = async (step, ctx) => {
  if (isTaskGatedStep(step)) {
    const ids = ctx.mission.taskIds ?? [];
    if (ids.length === 0) return { pass: true };
    const statuses = await ctx.getTaskStatuses(ids);
    const notDone = ids.filter((id) => statuses[id] !== "DONE");
    if (notDone.length > 0) {
      return {
        pass: false,
        reason: `${step.type} gate: ${notDone.length}/${ids.length} task(s) not DONE`,
      };
    }
    return { pass: true };
  }
  if (step.type === "gstack" && step.skill === "/ship") {
    const out =
      typeof step.output === "string"
        ? step.output
        : step.output != null
        ? JSON.stringify(step.output)
        : "";
    if (PR_URL_RE.test(out)) return { pass: true };
    return {
      pass: false,
      reason: "ship gate: PR URL not found in step output",
    };
  }
  return { pass: true };
};

/**
 * 스텝 타입별 '현재 스텝만' 허가 지시 메시지 (§3.2 / §8-3). 오케스트레이터 PTY 에
 * 주입되며, 스텝 안에서 무엇을 어떤 도구로 하고 어떻게 보고할지를 결정적으로 못박는다.
 *   - gstack    : 그 스킬을 `run_skill` 로 직접 실행 → `mission_step_done(success)`.
 *   - fix/dispatch : `create_task`/`dispatch_task` 로 분해·할당(missionId 자동태깅)
 *                    → `mission_step_done`. task 완료 대기는 지휘자 몫.
 *   - wait      : 여기로 오지 않는다(오케 grant 없이 지휘자가 폴링) — grantStep 에서 분기.
 * 어느 경우든 "스스로 다음 스텝으로 넘어가지 마세요" 를 포함해 순서·게이트 권한이
 * 지휘자에 있음을 명시한다.
 */
function buildGrantMessage(
  mission: Mission,
  step: MissionStep,
  stepIndex: number
): string {
  if (step.type === "gstack") {
    const skill = step.skill ?? "(skill not specified)";
    // gstack 스킬(특히 /investigate)은 '무엇을' 대상으로 돌릴지 목표가 있어야 의미가
    // 있다. 목표 없이 grant 하면 스킬이 clarify 만 반복한다 → 미션 goal 을 함께 싣는다.
    // step.args 가 있으면 그게 더 구체적인 대상이므로 우선.
    const target = step.args?.trim() || mission.goal;
    return (
      `【Marblo Mission】 Current step ${stepIndex}: ${skill} (gstack)\n` +
      `Mission goal: ${target}\n` +
      `Instruction: Run ${skill} directly with run_skill against the goal above. Producing an artifact such as investigation or review results completes this step; do not wait for a user decision.\n` +
      `★Required: Immediately after completion, report by calling mission_step_done({success:true, output:"summary of key results"}). The conductor must receive this report before it can grant the next step; without the report, the mission will remain stuck. Even if the result requires a direction choice, first report with mission_step_done, including the summary and recommendation in output, then wait for the next grant.\n` +
      `Do not start the next step yourself before reporting; the conductor owns ordering and gates. On failure, report with mission_step_done({success:false, error:"reason"}).`
    );
  }
  // fix / dispatch — 작업 분해·할당 스텝. 목표는 step.args(있으면) 우선, 없으면 미션 goal.
  const goal = step.args?.trim() || mission.goal;
  return (
    `【Marblo Mission】 Current step ${stepIndex}: ${step.type} (task decomposition and assignment)\n` +
    `Step goal: ${goal}\n` +
    `Decompose and assign the work with create_task and dispatch_task (missionId is tagged automatically).\n` +
    `★Required: After assignment is complete, report by calling mission_step_done({success:true, output:"assignment summary"}). The conductor must receive this report before it can proceed; without the report, the mission will remain stuck. The conductor waits for the decomposed tasks to finish, so report and then wait.\n` +
    `Do not start the next step yourself before reporting; the conductor owns ordering and gates. On failure, report with mission_step_done({success:false, error:"reason"}).`
  );
}

/**
 * Conductor — orchestrator-driven 운전 루프 (Phase 2 골격 + Phase 3 운전 완성).
 * 기본 driver 가 engine 이라 명시적으로 orchestrator 를 켜야만 생성·호출된다.
 */
export function createConductorDriver(
  deps: ConductorDriverDeps
): ConductorDriver {
  const log =
    deps.logger ??
    ((m: string, meta?: Record<string, unknown>) =>
      console.log(`[Conductor] ${m}`, meta ?? ""));
  const now = deps.now ?? (() => new Date());
  const maxRetries = deps.maxRetries ?? 2;
  const verify: VerifyStepGate = deps.verifyStepGate ?? defaultStepGate;
  const reportNudgeIntervalMs = deps.reportNudgeIntervalMs ?? 240_000;
  const maxReportNudges = deps.maxReportNudges ?? 3;

  // ── 보고-감시(report watchdog) ──
  // gstack/fix/dispatch 스텝을 grant 한 뒤, 오케가 끝났는데도 mission_step_done 을
  // 빠뜨려(특히 멀티턴 사용자 상호작용 뒤) 미션이 영구 stall 하는 걸 막는다. 스텝당
  // 타이머를 걸어 일정 간격마다 "끝났으면 보고하라" nudge 를 주입하고, 한도 초과 시
  // escalate(waiting_for_human). 보고 수신/스텝 전진/완료/dispose 시 해제한다.
  // key = `${missionId}:${stepIndex}`.
  const reportWatch = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; nudges: number }
  >();

  // ── 미션별 작업 직렬화 ──
  // 이벤트 폭주(task.status_changed 버스트)나 launch + 이벤트 동시 도착 시
  // 동시 grant / 중복 advance race 를 막는다. engine 의 inFlight Set 과 같은 의도.
  const chains = new Map<string, Promise<unknown>>();
  function enqueue(missionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = chains.get(missionId) ?? Promise.resolve();
    // then(fn, fn): 직전 작업이 성공/실패든 다음 작업을 실행(큐가 막히지 않게).
    const next = prev
      .then(fn, fn)
      .catch((err) =>
        log("mission chain error", { missionId, err: String(err) })
      );
    chains.set(missionId, next);
    void next.finally(() => {
      if (chains.get(missionId) === next) chains.delete(missionId);
    });
    return next;
  }

  // 오케가 MCP 로 만든 task 를 게이트가 보도록 mission.taskIds 를 동기화한다(§5.2).
  // B안에선 지휘자가 task 를 만들지 않으므로 mission.taskIds 가 비어 있다 →
  // findMissionTaskIds(missionId) 로 비종료 task id 를 끌어와 **머지**한다.
  //   · 머지(덮어쓰기 아님): 이미 DONE 으로 빠져 findMissionTaskIds 가 더는 안 주는
  //     task id 도 mission.taskIds 에 보존 → 게이트가 getTaskStatuses 로 실제 상태를
  //     읽어 "전부 DONE" 을 정확히 판정(빈 목록의 vacuous pass 방지) + abandon/진행률용
  //     이력 유지. engine 의 dispatch 누적/재연결 머지(index.ts)와 같은 컨벤션.
  //   · findMissionTaskIds 미주입(Phase 2 경로)이거나 새 id 가 없으면 no-op.
  async function syncMissionTaskIds(missionId: string): Promise<void> {
    if (!deps.findMissionTaskIds) return;
    let found: string[];
    try {
      found = await deps.findMissionTaskIds(missionId);
    } catch (err) {
      log("syncMissionTaskIds — findMissionTaskIds failed (keep existing)", {
        missionId,
        err: String(err),
      });
      return;
    }
    if (found.length === 0) return;
    const fresh = await deps.store.getMission(missionId);
    if (!fresh) return;
    const merged = Array.from(new Set([...fresh.taskIds, ...found]));
    if (merged.length === fresh.taskIds.length) return; // 새로 붙일 게 없음
    await deps.store.updateMission(missionId, { taskIds: merged });
    log("syncMissionTaskIds — merged orchestrator-created task ids", {
      missionId,
      total: merged.length,
      added: merged.length - fresh.taskIds.length,
    });
  }

  // ── 미션 대표 보드 카드 라이프사이클 (deps.board 주입 시에만; 모두 best-effort) ──
  // 미션 첫 advance 시 대표 카드를 1회 만들고 missionCardTaskId 를 영속화한다. 이후
  // 스텝 진행/완료를 카드 activity 로 쌓고 미션 완료 시 카드 상태를 DONE 으로 동기화한다.
  // 카드 호출은 절대 throw 로 미션 진행을 깨지 않는다(try/catch 로 흡수).
  async function ensureMissionCard(mission: Mission): Promise<void> {
    if (!deps.board) return;
    if (mission.missionCardTaskId) return;
    try {
      const id = await deps.board.createMissionCard(mission);
      await deps.store.updateMission(mission.id, { missionCardTaskId: id });
      await deps.board.addCardActivity(id, `Mission started · ${mission.goal}`);
      log("mission card created", { missionId: mission.id, cardId: id });
    } catch (err) {
      log("ensureMissionCard failed (best-effort)", {
        missionId: mission.id,
        err: String(err),
      });
    }
  }
  async function cardActivity(
    mission: Mission,
    message: string
  ): Promise<void> {
    if (!deps.board || !mission.missionCardTaskId) return;
    try {
      await deps.board.addCardActivity(mission.missionCardTaskId, message);
    } catch (err) {
      log("cardActivity failed (best-effort)", {
        missionId: mission.id,
        err: String(err),
      });
    }
  }

  // ── 보고-감시 watchdog 헬퍼 ──
  function buildReportNudge(stepIndex: number, step: MissionStep): string {
    return (
      `【Conductor】 No report has been received yet for step ${stepIndex} (${
        step.skill ?? step.type
      }).\n` +
      `If this step is already complete, report now with mission_step_done({success:true, output:"summary of key results"}); the mission can move to the next step only after that report.\n` +
      `If you are still working or waiting for a user answer, ignore this message.`
    );
  }

  // missionId(+stepIndex 지정 시 그 스텝만) 의 watchdog 타이머 해제.
  function clearReportWatch(missionId: string, stepIndex?: number): void {
    const prefix = `${missionId}:`;
    for (const [key, w] of reportWatch) {
      if (!key.startsWith(prefix)) continue;
      if (stepIndex !== undefined && key !== `${missionId}:${stepIndex}`)
        continue;
      clearTimeout(w.timer);
      reportWatch.delete(key);
    }
  }

  // grant 후 보고 감시 시작. 스텝이 여전히 running 이면 nudge, 한도 초과면 escalate.
  function startReportWatch(missionId: string, stepIndex: number): void {
    const key = `${missionId}:${stepIndex}`;
    clearReportWatch(missionId, stepIndex); // 같은 스텝 재grant 시 중복 방지
    const schedule = (nudges: number): void => {
      const timer = setTimeout(() => {
        void tick(nudges);
      }, reportNudgeIntervalMs);
      // 이벤트 루프를 붙잡지 않게(테스트/종료 시 dangling 타이머 방지).
      timer.unref?.();
      reportWatch.set(key, { timer, nudges });
    };
    const tick = async (nudges: number): Promise<void> => {
      if (!reportWatch.has(key)) return; // 그 사이 해제됨
      const mission = await deps.store.getMission(missionId);
      if (!mission || mission.status !== "active") {
        clearReportWatch(missionId, stepIndex);
        return;
      }
      const step = mission.steps[stepIndex];
      // 스텝이 이미 전진/완료/실패(=보고 처리됨)면 감시 종료.
      if (
        !step ||
        mission.currentStepIndex !== stepIndex ||
        step.status !== "running"
      ) {
        clearReportWatch(missionId, stepIndex);
        return;
      }
      if (nudges >= maxReportNudges) {
        // 한도 초과 — 보고가 끝내 안 옴 → escalate(사용자 호출). 상태 전이는 enqueue
        // 로 직렬화해 onStepReport 등과 race 하지 않는다.
        clearReportWatch(missionId, stepIndex);
        log("reportWatch — max nudges, escalating", { missionId, stepIndex });
        void enqueue(missionId, async () => {
          const m = await deps.store.getMission(missionId);
          if (!m || m.status !== "active") return;
          const s = m.steps[stepIndex];
          if (
            !s ||
            m.currentStepIndex !== stepIndex ||
            s.status !== "running"
          ) {
            return;
          }
          deps.notifier?.({
            missionId,
            projectId: m.projectId,
            goal: m.goal,
            kind: "escalate",
            question: `Step ${stepIndex} (${
              s.skill ?? s.type
            }) has no completion report. Confirmation is required.`,
            skill: s.skill ?? null,
          });
          await deps.store.appendTimelineEvent(missionId, {
            ts: now(),
            type: "step.failed",
            payload: {
              index: stepIndex,
              error: "report timeout (no mission_step_done)",
              policy: "escalate",
              notifyUser: true,
              driver: "orchestrator",
            },
          });
          await transition(missionId, m.status, "waiting_for_human");
          notifyOrchestrator(
            m,
            `⏸️ [Marblo Mission] User confirmation was requested because step ${stepIndex} has no completion report. If it is complete, report with mission_step_done.`
          );
        });
        return;
      }
      // nudge 주입(best-effort) — injectMessage 직렬화 경유라 부팅/grant 와 안 겹침.
      const ref = deps.orchestrators.getSession(
        mission.ownerOrchestratorSessionId
      );
      if (ref?.isAlive()) {
        void ref.postMessage(buildReportNudge(stepIndex, step)).catch((err) =>
          log("reportWatch — nudge failed (best-effort)", {
            missionId,
            stepIndex,
            err: String(err),
          })
        );
        log("reportWatch — nudged orchestrator to report", {
          missionId,
          stepIndex,
          nudge: nudges + 1,
        });
      }
      schedule(nudges + 1);
    };
    schedule(0);
  }

  // ──────────────────────────── 운전 루프 ────────────────────────────

  // 현재 스텝 진행을 오케에 허가하는 진입점. 미션이 active 가 아니면(planning 외)
  // 진행하지 않는다 — paused/escalate(sleeping/waiting_for_human)는 resume 으로만 깨움.
  async function advance(missionId: string): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    if (mission.status !== "active") {
      log("advance skipped — mission not active", {
        missionId,
        status: mission.status,
      });
      return;
    }
    if (mission.currentStepIndex >= mission.steps.length) {
      await completeMission(missionId);
      return;
    }
    // 첫 advance 에서 대표 카드를 1회 만들고 missionCardTaskId 를 영속화한다 →
    // 이후 grantStep 의 re-fetch 가 카드 id 를 본다(best-effort, no-op if board 미주입).
    await ensureMissionCard(mission);
    await grantStep(missionId, mission.currentStepIndex);
  }

  async function grantStep(
    missionId: string,
    stepIndex: number
  ): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    const step = mission.steps[stepIndex];
    if (!step) {
      log("grantStep — step out of range", { missionId, stepIndex });
      return;
    }

    // running 마킹 + step.started 타임라인. 이미 running 이면(중복 grant) 같은 허가를
    // 오케에 두 번 주입하지 않는다 — 중복 grant 는 조용히 무시.
    if (step.status === "running") {
      log("grantStep — step already running, skip re-grant", {
        missionId,
        stepIndex,
      });
      return;
    }
    const startedAt = now();
    await deps.store.updateMissionStep(missionId, stepIndex, {
      status: "running",
      startedAt,
      error: undefined,
    });
    await deps.store.appendTimelineEvent(missionId, {
      ts: startedAt,
      type: "step.started",
      payload: {
        index: stepIndex,
        type: step.type,
        skill: step.skill ?? null,
        attempt: (step.retryCount ?? 0) + 1,
        driver: "orchestrator",
      },
    });
    // 대표 카드에 스텝 시작 댓글(best-effort, no-op if board 미주입/카드 미생성).
    await cardActivity(
      mission,
      `Step ${stepIndex} started · ${step.skill ?? step.type}`
    );

    // wait 스텝: 오케에 grant 하지 않는다 — 지휘자가 task 완료를 폴링한다(§8-3).
    // running 마킹 후, 직전 dispatch 의 task 가 이미 전부 DONE 인 경우를 위해 즉시
    // 게이트를 1회 평가해 통과하면 바로 전진한다. 미통과면 running 으로 남아 task
    // 이벤트(onEvent)/보고(onStepReport)로 재평가된다.
    if (step.type === "wait") {
      log("grantStep — wait step: conductor polls (no orchestrator grant)", {
        missionId,
        stepIndex,
      });
      const gate = await verifyGateInternal(missionId, stepIndex);
      if (gate.passed) {
        log("grantStep — wait gate already satisfied at grant, advancing", {
          missionId,
          stepIndex,
        });
        await passStepAndAdvance(missionId, stepIndex);
      }
      return;
    }

    // gstack / fix / dispatch — 미션 오케 PTY 에 스텝 타입별 '현재 스텝만' 지시 주입
    // (best-effort). 메시지는 스텝 타입별로 무엇을 어떤 도구로 하고 어떻게 보고할지
    // 못박는다(§3.2 / §8-3).
    let ref = deps.orchestrators.getSession(mission.ownerOrchestratorSessionId);
    if (!ref || !ref.isAlive()) {
      // UI 직접 생성 경로(MissionsTab.handleLaunch → missionService.createMission)는
      // engine.launch() 의 ensureSession 을 안 거쳐 ownerOrchestratorSessionId 가
      // "pending" 으로 남는다 → getSession 매칭 실패 → 첫 스텝(/investigate)이 영영
      // grant 되지 않는다. ensureSession 으로 미션 오케를 띄우고(idempotent reuse) 실제
      // 세션으로 영속 바인딩한다.
      try {
        ref = await deps.orchestrators.ensureSession({
          missionId,
          projectId: mission.projectId,
        });
      } catch (err) {
        log("grantStep — ensureSession failed (best-effort skip)", {
          missionId,
          stepIndex,
          err: String(err),
        });
        return;
      }
      if (ref.sessionId !== mission.ownerOrchestratorSessionId) {
        await deps.store.updateMission(missionId, {
          ownerOrchestratorSessionId: ref.sessionId,
        });
        log("grantStep — bound mission to live orchestrator session", {
          missionId,
          stepIndex,
          sessionId: ref.sessionId,
        });
      }
    }
    if (!ref || !ref.isAlive()) {
      log("grantStep — no live owner orchestrator session (best-effort skip)", {
        missionId,
        stepIndex,
        sessionId: mission.ownerOrchestratorSessionId,
      });
      return;
    }
    try {
      await ref.postMessage(buildGrantMessage(mission, step, stepIndex));
      log("grantStep — granted to orchestrator", {
        missionId,
        stepIndex,
        type: step.type,
        skill: step.skill ?? null,
      });
    } catch (err) {
      log("grantStep — postMessage failed (best-effort)", {
        missionId,
        stepIndex,
        err: String(err),
      });
    }
    // 보고 감시 시작 — 오케가 이 스텝을 끝내고 mission_step_done 을 빠뜨리면
    // nudge → 한도 초과 시 escalate. (wait 스텝은 위에서 return 했으니 여기 안 옴.)
    startReportWatch(missionId, stepIndex);
  }

  async function onStepReport(report: StepReport): Promise<void> {
    const mission = await deps.store.getMission(report.missionId);
    if (!mission || isTerminalMission(mission.status)) {
      log("onStepReport — mission missing/terminal, ignored", {
        missionId: report.missionId,
        stepIndex: report.stepIndex,
      });
      return;
    }
    // active 가 아니면(예: 사용자 pause → sleeping, escalate → waiting_for_human)
    // 뒤늦은/잘못된 보고이므로 무시. resume 이 운전을 다시 잡는다.
    if (mission.status !== "active") {
      log("onStepReport — mission not active, ignored", {
        missionId: report.missionId,
        status: mission.status,
        stepIndex: report.stepIndex,
      });
      return;
    }
    const idx = mission.currentStepIndex;
    // 한 번에 하나만 허가하므로 현재 스텝과 다른 보고는 stale/중복 → 무시.
    if (report.stepIndex !== idx) {
      log("onStepReport — stale step report ignored", {
        missionId: report.missionId,
        reported: report.stepIndex,
        current: idx,
      });
      return;
    }
    // 유효 보고 수신 → 이 스텝의 보고-감시 nudge 중단(성공/실패 모두).
    clearReportWatch(report.missionId, idx);

    if (report.status === "failed") {
      await handleStepFailure(
        report.missionId,
        idx,
        report.error ?? "orchestrator reported step failure"
      );
      return;
    }

    // 성공 보고 → output 반영 후 게이트 검증 (게이트가 step.output 을 읽음).
    // verifyGateInternal 은 task-게이트 스텝이면 직전에 findMissionTaskIds 로
    // mission.taskIds 를 동기화한다(§5.2) — 오케가 MCP 로 만든 task 가 보이도록.
    if (report.output !== undefined) {
      await deps.store.updateMissionStep(report.missionId, idx, {
        output: report.output,
      });
    }
    const gate = await verifyGateInternal(report.missionId, idx);
    if (gate.passed) {
      await passStepAndAdvance(report.missionId, idx);
      return;
    }

    // 게이트 미통과 — 스텝 타입에 따라 분기한다.
    const step = mission.steps[idx];
    if (isTaskGatedStep(step)) {
      // dispatch/wait: 분해·할당은 됐지만 task 가 아직 완료 전이다. retry(재할당)하면
      // 중복 task 가 생기므로 **재시도하지 않는다** — 스텝을 running 으로 유지하고
      // task 이벤트(onEvent)/추가 보고(onStepReport)로 게이트를 재평가해 전부 DONE
      // 되면 전진한다("완료대기는 지휘자가" — §8-3). 다음 스텝으로 넘기지 않는다.
      await deps.store.appendTimelineEvent(report.missionId, {
        ts: now(),
        type: "supervisor.note",
        payload: {
          message: `awaiting task completion at step ${idx}: ${
            gate.reason ?? "(tasks pending)"
          }`,
          index: idx,
          kind: "awaiting_tasks",
        },
      });
      log("onStepReport — task-gated step pending, waiting (no retry)", {
        missionId: report.missionId,
        stepIndex: idx,
        reason: gate.reason,
      });
      return;
    }

    // gstack/fix: 보고는 성공이라 했지만 결정적 게이트가 거부 → 실패와 동일하게
    // retry(재허가)/escalate. 다음 스텝으로 절대 넘기지 않는다(§5.1 핵심).
    await deps.store.appendTimelineEvent(report.missionId, {
      ts: now(),
      type: "supervisor.note",
      payload: {
        message: `gate held at step ${idx}: ${gate.reason ?? "(no reason)"}`,
        index: idx,
        kind: "gate_failed",
      },
    });
    await handleStepFailure(
      report.missionId,
      idx,
      `gate not passed: ${gate.reason ?? ""}`
    );
  }

  // 현재 스텝을 success 마킹하고 다음 스텝 허가(또는 미션 완료). gate pass 후 +
  // 외부 이벤트로 wait 게이트가 충족됐을 때 공유하는 단일 전진 지점.
  async function passStepAndAdvance(
    missionId: string,
    stepIndex: number
  ): Promise<void> {
    await markStepSuccess(missionId, stepIndex);
    const fresh = await deps.store.getMission(missionId);
    if (!fresh) return;
    // 대표 카드에 스텝 완료 댓글(best-effort, no-op if board 미주입/카드 미생성).
    await cardActivity(fresh, `Step ${stepIndex} complete`);
    const nextIdx = stepIndex + 1;
    await deps.store.updateMission(missionId, { currentStepIndex: nextIdx });
    if (nextIdx >= fresh.steps.length) {
      await completeMission(missionId);
    } else {
      await grantStep(missionId, nextIdx);
    }
  }

  async function markStepSuccess(
    missionId: string,
    stepIndex: number
  ): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    const step = mission?.steps[stepIndex];
    const completedAt = now();
    await deps.store.updateMissionStep(missionId, stepIndex, {
      status: "success",
      completedAt,
      error: undefined,
      liveOutput: undefined,
    });
    await deps.store.appendTimelineEvent(missionId, {
      ts: completedAt,
      type: "step.completed",
      payload: {
        index: stepIndex,
        type: step?.type ?? null,
        skill: step?.skill ?? null,
        driver: "orchestrator",
      },
    });
  }

  // 실패(보고 실패 또는 게이트 미통과) 처리 — engine.handleFailure 정책 미러:
  //   continue → skip + 다음 스텝, retry(한도 내) → 같은 스텝 재허가,
  //   escalate/retry 소진 → waiting_for_human + 알림.
  async function handleStepFailure(
    missionId: string,
    stepIndex: number,
    error: string
  ): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    const step = mission.steps[stepIndex];
    if (!step) return;
    const policy = step.onFailure ?? "retry";
    const retries = step.retryCount ?? 0;
    const completedAt = now();

    if (policy === "continue") {
      await deps.store.updateMissionStep(missionId, stepIndex, {
        status: "skipped",
        error,
        completedAt,
        liveOutput: undefined,
      });
      await deps.store.appendTimelineEvent(missionId, {
        ts: completedAt,
        type: "step.failed",
        payload: {
          index: stepIndex,
          error,
          policy: "continue",
          driver: "orchestrator",
        },
      });
      const nextIdx = stepIndex + 1;
      await deps.store.updateMission(missionId, { currentStepIndex: nextIdx });
      if (nextIdx >= mission.steps.length) {
        await completeMission(missionId);
      } else {
        await grantStep(missionId, nextIdx);
      }
      return;
    }

    if (policy === "retry" && retries < maxRetries) {
      await deps.store.updateMissionStep(missionId, stepIndex, {
        status: "pending",
        retryCount: retries + 1,
        error,
        startedAt: undefined,
        liveOutput: undefined,
      });
      await deps.store.appendTimelineEvent(missionId, {
        ts: completedAt,
        type: "step.failed",
        payload: {
          index: stepIndex,
          error,
          attempt: retries + 1,
          willRetry: true,
          driver: "orchestrator",
        },
      });
      // 같은 스텝을 다시 허가 — 오케가 재시도(pending → grantStep 이 running 재마킹).
      await grantStep(missionId, stepIndex);
      return;
    }

    // escalate (또는 retry 소진) → waiting_for_human + 알림 카드.
    await deps.store.updateMissionStep(missionId, stepIndex, {
      status: "failed",
      error,
      completedAt,
      liveOutput: undefined,
    });
    await deps.store.appendTimelineEvent(missionId, {
      ts: completedAt,
      type: "step.failed",
      payload: {
        index: stepIndex,
        error,
        policy: policy === "retry" ? "retry_exhausted" : "escalate",
        notifyUser: true,
        driver: "orchestrator",
      },
    });
    deps.notifier?.({
      missionId,
      projectId: mission.projectId,
      goal: mission.goal,
      kind: "escalate",
      question: error ? `Step failed: ${error}` : undefined,
      skill: step.skill ?? null,
    });
    await transition(missionId, mission.status, "waiting_for_human");
    notifyOrchestrator(
      mission,
      `⏸️ [Marblo Mission] Waiting for user confirmation at step ${stepIndex} (${
        step.skill ?? step.type
      }): ${error}`
    );
  }

  async function completeMission(missionId: string): Promise<void> {
    const mission = await deps.store.getMission(missionId);
    if (!mission || isTerminalMission(mission.status)) return;
    clearReportWatch(missionId);
    const completedAt = now();
    await transition(missionId, mission.status, "completed", { completedAt });
    await deps.store.appendTimelineEvent(missionId, {
      ts: completedAt,
      type: "supervisor.note",
      payload: {
        message: "Mission completed (orchestrator-driven)",
        driver: "orchestrator",
      },
    });
    // 대표 카드 상태를 DONE 으로 동기화 + 완료 댓글(best-effort — throw 로 완료를 깨지 않음).
    if (deps.board && mission.missionCardTaskId) {
      try {
        await deps.board.setCardStatus(mission.missionCardTaskId, "DONE");
        await deps.board.addCardActivity(
          mission.missionCardTaskId,
          "Mission complete ✅"
        );
      } catch (err) {
        log("completeMission card sync failed", {
          missionId,
          err: String(err),
        });
      }
    }
    notifyOrchestrator(
      mission,
      `✅ [Marblo Mission] All steps are complete; the mission is complete.`
    );
  }

  // best-effort 안내 주입 — 살아있는 owner 세션이 없거나 실패해도 상태 전이를 막지
  // 않는다. fire-and-forget (상태 전이 흐름을 blocking 하지 않음).
  function notifyOrchestrator(mission: Mission, message: string): void {
    const ref = deps.orchestrators.getSession(
      mission.ownerOrchestratorSessionId
    );
    if (!ref || !ref.isAlive()) return;
    void ref.postMessage(message).catch((err) =>
      log("notifyOrchestrator failed (best-effort)", {
        missionId: mission.id,
        err: String(err),
      })
    );
  }

  async function transition(
    missionId: string,
    fromStatus: MissionStatus,
    next: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string }
  ): Promise<void> {
    if (fromStatus === next) return;
    assertMissionTransition(fromStatus, next);
    await deps.store.setMissionStatus(missionId, next, extras);
  }

  async function verifyGateInternal(
    missionId: string,
    stepIndex: number
  ): Promise<GateResult> {
    let mission = await deps.store.getMission(missionId);
    if (!mission) return { passed: false, reason: "mission not found" };
    let step = mission.steps[stepIndex];
    if (!step) return { passed: false, reason: "step out of range" };
    // task-게이트 스텝(wait/dispatch)은 검증 직전 오케 생성 task 를 동기화한다(§5.2).
    // getTaskStatuses 가 오케가 MCP 로 만든 task 의 상태를 봐야 "전부 DONE" 을 판정
    // 가능하므로, 게이트 평가에 쓸 mission 스냅샷도 동기화 후로 다시 읽는다.
    if (isTaskGatedStep(step)) {
      await syncMissionTaskIds(missionId);
      mission = await deps.store.getMission(missionId);
      if (!mission) return { passed: false, reason: "mission not found" };
      step = mission.steps[stepIndex] ?? step;
    }
    try {
      const r = await verify(step, {
        getTaskStatuses: deps.getTaskStatuses,
        mission,
      });
      return { passed: r.pass, reason: r.reason };
    } catch (err) {
      // 게이트가 throw 하면 통과시키지 않는다(결정성 우선) — 보류로 처리.
      return { passed: false, reason: `gate threw: ${String(err)}` };
    }
  }

  async function onEvent(event: MissionEngineEvent): Promise<void> {
    // 스텝완료 보고가 onEvent 로 직접 들어온 경우(방어적 라우팅) → onStepReport 위임.
    if (String(event.type) === MISSION_STEP_REPORTED_EVENT) {
      await onStepReport(parseStepReport(event));
      return;
    }
    const mission = await deps.store.getMission(event.missionId);
    // 미션이 active 가 아니면(또는 terminal/없음) 합성·재평가 모두 하지 않는다 —
    // 합성 append 는 지휘자가 운전 중(active)일 때만(단일 writer 원칙·기존 가드).
    if (!mission || mission.status !== "active") return;

    // ── B안 Phase 4-A: 타임라인 합성(단일 writer = 지휘자) ──
    // forwarder 가 보내는 task.status_changed / task.activity_logged 를 contextLog 의
    // TimelineEvent 로 합성해 하나의 서사를 만든다. dedup(payload.key)으로 앱 재시작
    // 시 forwarder 가 현재 상태를 재emit 해도 중복 합성을 막는다. onEvent 는 미션별
    // enqueue 로 직렬화되므로 read-check-append race 가 없다(mission 스냅샷이 일관).
    await synthesizeTimeline(event, mission);

    // 외부 wakeup (agent.completed / task.status_changed 등): 현재 스텝이 wait 이고
    // running 이면 게이트를 재평가해, 오케의 명시 보고 없이도 task 완료로 진행될 수
    // 있게 한다 (§3 이벤트 wakeup). 그 외 스텝은 오케 보고(onStepReport)로만 전진.
    // (task.status_changed 는 위 합성 + 이 재평가를 둘 다 트리거한다.)
    const idx = mission.currentStepIndex;
    const step = mission.steps[idx];
    if (!step || step.type !== "wait" || step.status !== "running") return;
    const gate = await verifyGateInternal(event.missionId, idx);
    if (gate.passed) {
      log("onEvent — wait gate satisfied by external event, advancing", {
        missionId: event.missionId,
        stepIndex: idx,
        eventType: event.type,
      });
      await passStepAndAdvance(event.missionId, idx);
    }
  }

  // forwarder task 신호 → contextLog TimelineEvent 합성. 합성 대상이 아니면 no-op.
  // dedup: 동일 payload.key 가 이미 contextLog 에 있으면 skip(재emit 중복 방지).
  // mission 스냅샷은 onEvent 가 방금 읽은 일관 스냅샷을 그대로 받는다(직렬화 보장).
  async function synthesizeTimeline(
    event: MissionEngineEvent,
    mission: Mission
  ): Promise<void> {
    const entry = buildSynthTimelineEvent(event);
    if (!entry) return;
    const key = (entry.payload as { key?: unknown }).key;
    if (
      typeof key === "string" &&
      mission.contextLog.some(
        (e) => (e.payload as { key?: unknown }).key === key
      )
    ) {
      log("synthesizeTimeline — dedup skip (key already in contextLog)", {
        missionId: event.missionId,
        key,
      });
      return;
    }
    await deps.store.appendTimelineEvent(event.missionId, entry);
  }

  // task.status_changed → 'task.status' / task.activity_logged → 'task.activity'.
  // 그 외 이벤트는 null(합성 대상 아님). payload.key 는 멱등 dedup 키다.
  function buildSynthTimelineEvent(
    event: MissionEngineEvent
  ): TimelineEvent | null {
    const p = event.payload ?? {};
    if (event.type === "task.status_changed") {
      const taskId = String(p.taskId ?? "");
      const to = p.to == null ? "" : String(p.to);
      return {
        ts: now(),
        type: "task.status",
        payload: {
          taskId,
          from: p.from ?? null,
          to: p.to ?? null,
          taskTitle: p.taskTitle ?? null,
          key: `task.status:${taskId}:${to}`,
        },
      };
    }
    if (event.type === "task.activity_logged") {
      const taskId = String(p.taskId ?? "");
      const activityAtMillis =
        typeof p.activityAtMillis === "number" ? p.activityAtMillis : null;
      return {
        ts: now(),
        type: "task.activity",
        payload: {
          taskId,
          message: typeof p.message === "string" ? p.message : "",
          agentId: p.agentId ?? null,
          taskTitle: p.taskTitle ?? null,
          key: `task.activity:${taskId}:${activityAtMillis}`,
        },
      };
    }
    return null;
  }

  function parseStepReport(event: MissionEngineEvent): StepReport {
    const payload = (event.payload ?? {}) as {
      stepIndex?: unknown;
      result?: { status?: unknown; output?: unknown; error?: unknown };
    };
    const result = payload.result ?? {};
    return {
      missionId: event.missionId,
      stepIndex: Number(payload.stepIndex ?? -1),
      status: result.status === "failed" ? "failed" : "success",
      output: result.output,
      error: typeof result.error === "string" ? result.error : undefined,
    };
  }

  // ── 보고/wakeup 수신: MissionEventBus 'mission.step_reported' 구독 (★계약) ──
  // 같은 버스를 엔진도 구독하지만, orchestrator 모드에선 엔진 onEvent 가 no-op 라
  // (index.ts) 이중 처리는 없다. enqueue 로 미션별 직렬화.
  const unsubscribe = deps.eventBus.on((event) =>
    enqueue(event.missionId, () =>
      String(event.type) === MISSION_STEP_REPORTED_EVENT
        ? onStepReport(parseStepReport(event))
        : onEvent(event)
    )
  );

  log("created (Phase 2 — orchestrator-driven 운전 루프 활성)");

  return {
    requestAdvance(missionId: string): void {
      void enqueue(missionId, () => advance(missionId));
    },
    grantStep,
    onStepReport,
    async verifyGate(
      missionId: string,
      stepIndex: number
    ): Promise<GateResult> {
      return verifyGateInternal(missionId, stepIndex);
    },
    onEvent,
    dispose(): void {
      unsubscribe();
      for (const w of reportWatch.values()) clearTimeout(w.timer);
      reportWatch.clear();
      chains.clear();
      log("disposed");
    },
  };
}
