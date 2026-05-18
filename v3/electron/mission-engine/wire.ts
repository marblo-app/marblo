import type { AgentManager } from "../agent-manager";
import type {
  DispatchTaskRequest,
  DispatchTaskResponse,
} from "../bridge-server";
import type { OrchestratorManager } from "../orchestrator-manager";
import type { PtyManager } from "../pty-manager";
import type { TaskDecomposer } from "../orchestrator/task-decomposer";
import { MissionEngine, InProcessMissionEventBus } from "./index";
import { getMissionFirebaseApp } from "./firebase-app";
import { createMissionStore } from "./store-impl";
import { createTaskDispatcher } from "./dispatcher-impl";
import { createSkillRunner } from "./skill-runner-impl";
import { createFixRunner } from "./fix-runner-impl";
import { createOrchestratorRegistry } from "./orch-registry-impl";
import { MissionEventForwarder } from "./event-forwarder";

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
  ptyManager: PtyManager;
  bridgePort: () => number;
  dispatchOne: (params: DispatchTaskRequest) => DispatchTaskResponse;
}

export interface BuiltMissionEngine {
  engine: MissionEngine;
  eventBus: InProcessMissionEventBus;
  forwarder: MissionEventForwarder;
  /** app.whenReady 이후 호출 — status='planning' 미션을 engine 에 픽업시킨다. */
  pickupPlanningMissions: () => Promise<void>;
  /** AgentManager.onStatusChange 안에서 호출 — agent 상태 변화를 미션으로 forward. */
  forwardAgentStatus: (agentId: string, status: string) => void;
  /** app shutdown 시 호출. */
  dispose: () => void;
}

export function buildMissionEngine(
  deps: BuildMissionEngineDeps
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
  const skillRunner = createSkillRunner({});
  const fixRunner = createFixRunner({
    app,
    authReady,
    dispatchOne: deps.dispatchOne,
  });
  const orchRegistry = createOrchestratorRegistry({
    orchestrators: deps.orchestrators,
    createInstance: deps.createOrchestratorInstance,
    ptyManager: deps.ptyManager,
    bridgePort: deps.bridgePort,
  });

  const engine = new MissionEngine({
    store,
    dispatcher,
    skillRunner,
    fixRunner,
    eventBus,
    orchestrators: orchRegistry,
  });

  const forwarder = new MissionEventForwarder({ app, authReady, eventBus });

  // Planning 미션 픽업 — UI 가 status='planning' 으로 만들어 둔 미션을 engine.resume
  // 으로 이어 받는다. Firestore 직접 쿼리.
  async function pickupPlanningMissions(): Promise<void> {
    await authReady;
    try {
      const { getFirestore, collection, query, where, getDocs } = await import(
        "firebase/firestore"
      );
      const db = getFirestore(app);
      const q = query(
        collection(db, "missions"),
        where("status", "==", "planning")
      );
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        engine
          .resume(docSnap.id)
          .catch((err) =>
            console.error(
              "[MissionEngine] planning pickup failed",
              docSnap.id,
              err
            )
          );
      }
      if (!snap.empty) {
        console.log(
          `[MissionEngine] picked up ${snap.size} planning mission(s)`
        );
      }
    } catch (err) {
      console.warn("[MissionEngine] planning pickup query failed:", err);
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
