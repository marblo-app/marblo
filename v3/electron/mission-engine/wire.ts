import type { AgentManager } from "../agent-manager";
import type {
  DispatchTaskRequest,
  DispatchTaskResponse,
} from "../bridge-server";
import type { OrchestratorManager } from "../orchestrator-manager";
import type { PtyManager } from "../pty-manager";
import type { TaskDecomposer } from "../orchestrator/task-decomposer";
import { MissionEngine, InProcessMissionEventBus } from "./index";
import type { MissionNotifier } from "./ports";
import { getMissionFirebaseApp } from "./firebase-app";
import { createMissionStore } from "./store-impl";
import { createTaskDispatcher } from "./dispatcher-impl";
import { createSkillRunner } from "./skill-runner-impl";
import { createPtySkillRunner } from "./pty-skill-runner-impl";
import { createFixRunner } from "./fix-runner-impl";
import { createOrchestratorRegistry } from "./orch-registry-impl";
import { MissionEventForwarder } from "./event-forwarder";
import { createConductorDriver, getMissionDriver } from "./conductor-driver";
import { verifyStepGate } from "./gates";
import { isImplicitMission } from "./types";
import { chunkProjectIds } from "./mission-project-scope";

// MissionEngine 팩토리 — main.ts wiring 진입점.
//
// 호출자 (main.ts) 는 이 한 함수만 호출하고 반환된 engine / forwarder /
// pickupPlanningMissions 만 사용하면 된다. ports 구현체들은 wire 내부에서
// 조립.

export interface BuildMissionEngineDeps {
  agentManager: AgentManager;
  // Lazy 게터 — dispatch 시점에 호출되어 키 없이도 앱이 시작될 수 있게 한다.
  // (TaskDecomposer 생성자는 LLM 키가 없으면 throw.)
  taskDecomposer: () => TaskDecomposer;
  orchestrators: Map<string, OrchestratorManager>;
  createOrchestratorInstance: (projectId: string) => OrchestratorManager;
  // main.ts 가 제공하는 미션 오케스트레이터 단일 launch 경로 — forwarding(PTY
  // 출력 → renderer) + kind 별 resume + rootPath 해석을 포함한다. 미션 엔진의
  // ensureSession 이 이걸 통해 launch 해야 PTY 패널에 출력이 흐르고 재시작 후
  // 세션이 이어진다. 미지정 시 registry 가 자체 launch(테스트 fallback).
  ensureOrchestratorLaunched?: (
    projectId: string,
    missionId?: string,
  ) => OrchestratorManager;
  // 미션이 사용자 개입을 요구할 때 OS 알림 / 인앱으로 surface. 미지정 시 no-op.
  notifier?: MissionNotifier;
  ptyManager: PtyManager;
  bridgePort: () => number;
  dispatchOne: (params: DispatchTaskRequest) => DispatchTaskResponse;
  /**
   * 이 사용자가 멤버인 프로젝트 id 들 — missions 구독/조회의 스코프.
   *
   * ★missions 룰이 멤버 스코프가 되면서 필수가 됐다(티켓 Ciriq5ASEvAlA8TnKxhW).
   *   예전엔 `where("status","==","planning")` 무스코프로 쐈고 룰이
   *   `isAuthenticated()` 뿐이라 통과했지만, 지금 그 모양은 통째로 거부된다.
   *   main.ts 가 `currentRealUserUid()` + projects(members array-contains)로
   *   공급한다 — listAssistantTriggerProjects 와 같은 경로다.
   */
  memberProjectIds: () => Promise<readonly string[]>;
}

export interface BuiltMissionEngine {
  engine: MissionEngine;
  eventBus: InProcessMissionEventBus;
  forwarder: MissionEventForwarder;
  /**
   * app.whenReady 이후 호출 — status='planning' 미션을 engine 에 픽업시킨다.
   * 초기 1회 startup 조회 + 이후 Firestore 구독으로 런타임 신규 planning 미션도 자동 픽업.
   */
  pickupPlanningMissions: () => Promise<void>;
  /** AgentManager.onStatusChange 안에서 호출 — agent 상태 변화를 미션으로 forward. */
  forwardAgentStatus: (agentId: string, status: string) => void;
  /** app shutdown 시 호출. */
  dispose: () => void;
}

export function buildMissionEngine(
  deps: BuildMissionEngineDeps,
): BuiltMissionEngine {
  const { app, authReady } = getMissionFirebaseApp();
  const eventBus = new InProcessMissionEventBus();

  const store = createMissionStore({ app, authReady });
  const dispatcher = createTaskDispatcher({
    app,
    authReady,
    decomposer: deps.taskDecomposer,
    agentManager: deps.agentManager,
    dispatchOne: deps.dispatchOne,
  });
  const fixRunner = createFixRunner({
    app,
    authReady,
    dispatchOne: deps.dispatchOne,
  });
  const orchRegistry = createOrchestratorRegistry({
    orchestrators: deps.orchestrators,
    createInstance: deps.createOrchestratorInstance,
    ensureLaunched: deps.ensureOrchestratorLaunched,
    ptyManager: deps.ptyManager,
    bridgePort: deps.bridgePort,
  });
  // SkillRunner: env flag 로 PTY routing 또는 legacy headless spawn 선택.
  // 기본은 PTY (사용자 가시성 + 빌링 안전).
  const useHeadlessSkillRunner = process.env.MARBLO_SKILL_RUNNER === "headless";
  const skillRunner = useHeadlessSkillRunner
    ? createSkillRunner({})
    : createPtySkillRunner({
        orchestrators: orchRegistry,
        ptyManager: deps.ptyManager,
      });
  console.log(
    `[MissionEngine] skill runner mode: ${
      useHeadlessSkillRunner ? "headless" : "pty"
    }`,
  );

  // B안 미션 드라이버 토글 — 'engine'(기본, A안 advance-loop) | 'orchestrator'(B안
  // 지휘자). 기본 engine 이라 A 동작 100% 불변. orchestrator 는 Phase 1 에선 스텁
  // (no-op + log)이라 실제 미션이 진행되지 않는다(Phase 2~3 에서 채움).
  // 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §3, §8.
  const missionDriver = getMissionDriver();
  console.log(`[MissionEngine] driver mode: ${missionDriver}`);
  const conductor =
    missionDriver === "orchestrator"
      ? createConductorDriver({
          store,
          orchestrators: orchRegistry,
          eventBus,
          // wait 게이트용 task 상태 조회 — dispatcher 헬퍼 재사용.
          getTaskStatuses: (taskIds) => dispatcher.getTaskStatuses(taskIds),
          // 오케가 MCP 로 만든 미션 task 의 비종료 id 역추적 — 게이트가 보도록
          // mission.taskIds 동기화에 사용(§5.2). 대표 카드는 dispatcher 가 제외한다.
          findMissionTaskIds: (mid) => dispatcher.findMissionTaskIds(mid),
          // 미션 대표 보드 카드 포트 — dispatcher 구현을 주입. 지휘자가 미션 시작 시
          // 대표 카드를 만들고 스텝 진행을 activity 로 쌓고 상태를 동기화한다.
          board: {
            createMissionCard: (m) => dispatcher.createMissionCard(m),
            addCardActivity: (t, msg) => dispatcher.addCardActivity(t, msg),
            setCardStatus: (t, s) => dispatcher.setCardStatus(t, s),
          },
          notifier: deps.notifier,
          // 통합(P2-B): gates.ts 의 결정적 게이트 주입. (미주입 시 conductor
          // 내장 기본 게이트로 폴백.)
          verifyStepGate,
        })
      : undefined;

  const engine = new MissionEngine(
    {
      store,
      dispatcher,
      skillRunner,
      fixRunner,
      eventBus,
      orchestrators: orchRegistry,
      notifier: deps.notifier,
    },
    { driver: missionDriver, conductor },
  );

  const forwarder = new MissionEventForwarder({
    app,
    authReady,
    eventBus,
    memberProjectIds: deps.memberProjectIds,
  });

  // Planning 미션 픽업 — UI 가 status='planning' 으로 만들어 둔 미션을 engine.resume
  // 으로 이어 받는다. 1회 startup 조회 후 onSnapshot 으로 런타임 신규 mission 도 자동 픽업.
  // resume 은 inFlight set 으로 중복 호출 방지하므로 (initial getDocs + onSnapshot
  // added 이벤트가 동일 doc 으로 두 번 들어와도) 안전.
  // ★프로젝트 스코프 청크마다 구독이 하나씩 — missions 룰이 멤버 스코프라
  //   `in` 상한(30) 때문에 프로젝트가 많으면 구독이 쪼개진다.
  const planningUnsubs: Array<() => void> = [];
  const pickedUp = new Set<string>();

  async function pickupPlanningMissions(): Promise<void> {
    await authReady;
    if (planningUnsubs.length > 0) return; // idempotent — 두 번 호출돼도 한 번만 구독
    try {
      const { getFirestore, collection, query, where, onSnapshot, getDocs } =
        await import("firebase/firestore");
      const db = getFirestore(app);

      // ★프로젝트 스코프 — 룰이 멤버 스코프라 무스코프 쿼리는 거부된다.
      //   스코프가 비면(로그인 전 등) 아무것도 하지 않는다. 거부될 쿼리를 쏘고
      //   catch 로 삼키면 "미션이 없다"로 조용히 오인되는데, 그게 이 코드가
      //   피해야 하는 실패 모드다(mcp-server/project-scope.ts 상단 참조).
      const projectChunks = chunkProjectIds(await deps.memberProjectIds());
      if (projectChunks.length === 0) {
        console.log(
          "[MissionEngine] planning pickup skipped — no member projects in scope",
        );
        return;
      }

      // 1회성 in-flight 복구 — 앱이 꺼질 때 active/sleeping 이던 미션을 이어서
      // 진행한다. recoverInFlight 가 step type 별로 안전 처리(gstack 재실행 /
      // wait 폴링 / fix·dispatch 는 중복 생성 방지 위해 사용자 확인). planning 은
      // 아래 구독이 처리하므로 제외, waiting_for_human 은 사용자 답 대기라 제외.
      for (const status of ["active", "sleeping"] as const) {
        try {
          const snaps = await Promise.all(
            projectChunks.map((projectIds) =>
              getDocs(
                query(
                  collection(db, "missions"),
                  where("projectId", "in", projectIds),
                  where("status", "==", status),
                ),
              ),
            ),
          );
          for (const d of snaps.flatMap((snap) => snap.docs)) {
            if (pickedUp.has(d.id)) continue;
            // ★암묵적 미션(오케가 ad-hoc 배치에 붙인 Replay 라벨)은 실행 계획이
            // 없다(steps=[]). 엔진이 이어받으면 0-스텝 미션을 헛돌린다.
            if (isImplicitMission(d.data())) continue;
            pickedUp.add(d.id);
            console.log(
              `[MissionEngine] recovering in-flight mission ${d.id} (status=${status})`,
            );
            engine.recoverInFlight(d.id).catch((err) => {
              pickedUp.delete(d.id);
              console.error(
                "[MissionEngine] in-flight recovery failed",
                d.id,
                err,
              );
            });
          }
        } catch (err) {
          console.warn(
            `[MissionEngine] in-flight (${status}) recovery query failed:`,
            err,
          );
        }
      }

      for (const projectIds of projectChunks) {
      const q = query(
        collection(db, "missions"),
        where("projectId", "in", projectIds),
        where("status", "==", "planning"),
      );
      planningUnsubs.push(onSnapshot(
        q,
        (snap) => {
          console.log(
            `[MissionEngine] planning snapshot: size=${snap.size} changes=${
              snap.docChanges().length
            }`,
          );
          for (const change of snap.docChanges()) {
            if (change.type === "removed") {
              pickedUp.delete(change.doc.id);
              continue;
            }
            const id = change.doc.id;
            if (pickedUp.has(id)) continue;
            // 암묵적 미션은 planning 으로 만들어지지 않지만(생성 시 active),
            // 같은 이유로 여기서도 방어한다 — 엔진 픽업의 단일 제외 규칙.
            if (isImplicitMission(change.doc.data())) continue;
            pickedUp.add(id);
            console.log(
              `[MissionEngine] picking up planning mission ${id} (change=${change.type})`,
            );
            engine.resume(id).catch((err) => {
              pickedUp.delete(id); // 실패 시 다음 트리거에서 재시도 가능
              console.error("[MissionEngine] planning pickup failed", id, err);
            });
          }
        },
        (err) => console.warn("[MissionEngine] planning subscribe error:", err),
      ));
      }
      console.log(
        `[MissionEngine] planning subscription started (${projectChunks.length} project chunk(s))`,
      );
    } catch (err) {
      console.warn("[MissionEngine] planning pickup setup failed:", err);
    }
  }

  // Agent status → mission event 변환. agent 가 idle/stopped 로 전이하면 해당
  // 에이전트가 작업 중이던 task 가 끝났을 가능성이 높음 → 활성 미션에 신호.
  // 정확한 (taskId, missionId) 매핑은 forwarder 의 Firestore 구독이 잡지만
  // 같은 머신 안에서는 이 즉시 신호로 wait → active 전이가 더 빨라진다.
  function forwardAgentStatus(agentId: string, status: string): void {
    if (status !== "idle" && status !== "stopped") return;
    // 모든 활성 미션에 broadcast — engine.onEvent 가 mission 조회 후
    // sleeping 이면 active 로 깨움. 비활성/terminal 은 자체 가드로 무시.
    for (const missionId of forwarder.getActiveMissionIds()) {
      eventBus.emit({
        type: "agent.completed",
        missionId,
        payload: { agentId, status },
      });
    }
  }

  function dispose(): void {
    for (const unsub of planningUnsubs) {
      try {
        unsub();
      } catch {
        /* best-effort */
      }
    }
    planningUnsubs.length = 0;
    forwarder.stop();
    engine.dispose();
  }

  return {
    engine,
    eventBus,
    forwarder,
    pickupPlanningMissions,
    forwardAgentStatus,
    dispose,
  };
}
