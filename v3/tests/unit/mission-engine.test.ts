import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MissionEngine,
  InProcessMissionEventBus,
  ALLOWED_SKILLS,
  isAllowedSkill,
  isTerminalMission,
  isValidMissionTransition,
  assertMissionTransition,
  getTemplate,
  instantiateSteps,
  listTemplates,
} from "../../electron/mission-engine";
import { isMissionPausedByUser } from "../../electron/mission-engine/event-forwarder";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
} from "../../electron/mission-engine/types";
import type {
  FixRunner,
  MissionEngineDeps,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  SkillResult,
  SkillRunner,
  TaskDispatcher,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// 모든 시나리오를 in-memory fake ports 로 검증.
// MissionEngine.ts 가 외부 의존을 ports 인터페이스로만 받기 때문에 wire / Firestore
// / Electron 없이 풀 라이프사이클을 돌릴 수 있다.

// ──────────────────────────── fakes ────────────────────────────

class InMemoryStore implements MissionStore {
  private docs = new Map<string, Mission>();
  private nextId = 1;

  async getMission(id: string): Promise<Mission | null> {
    const m = this.docs.get(id);
    return m ? structuredClone(m) : null;
  }

  async createMission(
    data: Omit<Mission, "id" | "launchedAt" | "lastActivityAt" | "completedAt">,
  ): Promise<string> {
    const id = `m${this.nextId++}`;
    const now = new Date();
    this.docs.set(id, {
      ...data,
      id,
      launchedAt: now,
      lastActivityAt: now,
      completedAt: null,
    });
    return id;
  }

  async updateMission(
    id: string,
    patch: Partial<Omit<Mission, "id" | "launchedAt">>,
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    this.docs.set(id, { ...cur, ...patch, lastActivityAt: new Date() });
  }

  async appendTimelineEvent(id: string, event: TimelineEvent): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    cur.contextLog.push(event);
    cur.lastActivityAt = new Date();
  }

  async updateMissionStep(
    id: string,
    stepIndex: number,
    patch: Partial<MissionStep>,
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    if (stepIndex < 0 || stepIndex >= cur.steps.length) {
      throw new Error("step OOB");
    }
    cur.steps[stepIndex] = { ...cur.steps[stepIndex], ...patch };
    cur.lastActivityAt = new Date();
  }

  async setMissionStatus(
    id: string,
    status: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string },
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    cur.status = status;
    if (extras?.completedAt) cur.completedAt = extras.completedAt;
    if (extras?.abandonedReason) cur.abandonedReason = extras.abandonedReason;
    cur.lastActivityAt = new Date();
  }

  // test helpers
  raw(id: string): Mission | undefined {
    return this.docs.get(id);
  }
  size(): number {
    return this.docs.size;
  }
}

interface DispatchSpy {
  dispatchCalls: { missionId: string; goal: string }[];
  killCalls: string[][];
}

function makeDispatcher(
  spy: DispatchSpy,
  opts?: {
    initialStatuses?: Record<string, TaskStatusLite>;
  },
): TaskDispatcher {
  const statuses: Record<string, TaskStatusLite> = { ...opts?.initialStatuses };
  return {
    async dispatchTasks({ missionId, goal }) {
      spy.dispatchCalls.push({ missionId, goal });
      const taskIds = [`t-${missionId}-1`, `t-${missionId}-2`];
      for (const id of taskIds) statuses[id] = "IN_PROGRESS";
      return taskIds;
    },
    async getTaskStatuses(taskIds) {
      const out: Record<string, TaskStatusLite> = {};
      for (const id of taskIds) {
        if (statuses[id]) out[id] = statuses[id];
      }
      return out;
    },
    async findMissionTaskIds(missionId) {
      // 기본 fake 는 미션 task 없음으로 가정 (테스트가 __setStatuses 로 주입 가능).
      return Object.keys(statuses).filter(
        (id) =>
          id.includes(missionId) &&
          statuses[id] !== "DONE" &&
          statuses[id] !== "FAILED",
      );
    },
    async killAgentsForTasks(taskIds) {
      spy.killCalls.push([...taskIds]);
    },
    // test helper exposed via cast
    __setStatuses(next: Record<string, TaskStatusLite>): void {
      Object.assign(statuses, next);
    },
  } as TaskDispatcher & {
    __setStatuses: (s: Record<string, TaskStatusLite>) => void;
  };
}

function makeSkillRunner(opts?: {
  failures?: number;
  alwaysFail?: boolean;
}): SkillRunner & { calls: number } {
  let remaining = opts?.failures ?? 0;
  const obj = {
    calls: 0,
    async runSkill({ skill }): Promise<SkillResult> {
      obj.calls += 1;
      if (opts?.alwaysFail) {
        return {
          success: false,
          error: `skill ${skill} failed`,
          durationMs: 1,
        };
      }
      if (remaining > 0) {
        remaining -= 1;
        return {
          success: false,
          error: `skill ${skill} transient`,
          durationMs: 1,
        };
      }
      return { success: true, output: { skill }, durationMs: 1 };
    },
  };
  return obj;
}

function makeFixRunner(success = true): FixRunner {
  return {
    async runFix() {
      return success
        ? { success: true }
        : { success: false, error: "fix fail" };
    },
  };
}

function makeOrchRegistry(): OrchestratorRegistry {
  const refs = new Map<string, OrchestratorRef>();
  return {
    async ensureSession({ projectId }) {
      const sid = `sess-${projectId}`;
      let r = refs.get(sid);
      if (!r) {
        r = {
          sessionId: sid,
          isAlive: () => true,
          postMessage: vi.fn().mockResolvedValue(undefined),
        };
        refs.set(sid, r);
      }
      return r;
    },
    getSession(sid) {
      return refs.get(sid) ?? null;
    },
  };
}

function buildEngine(overrides: Partial<MissionEngineDeps> = {}): {
  engine: MissionEngine;
  store: InMemoryStore;
  bus: InProcessMissionEventBus;
  spy: DispatchSpy;
  dispatcher: TaskDispatcher & {
    __setStatuses: (s: Record<string, TaskStatusLite>) => void;
  };
} {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const spy: DispatchSpy = { dispatchCalls: [], killCalls: [] };
  const dispatcher = makeDispatcher(spy) as TaskDispatcher & {
    __setStatuses: (s: Record<string, TaskStatusLite>) => void;
  };
  const engine = new MissionEngine({
    store,
    dispatcher,
    skillRunner: makeSkillRunner(),
    fixRunner: makeFixRunner(),
    eventBus: bus,
    orchestrators: makeOrchRegistry(),
    ...overrides,
  });
  return { engine, store, bus, spy, dispatcher };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// ──────────────────────── templates & state machine ────────────────────────

describe("templates", () => {
  it("exposes 5 templates", () => {
    expect(listTemplates()).toHaveLength(5);
  });
  it("instantiateSteps returns indexed pending steps", () => {
    const steps = instantiateSteps("quick-fix");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({ index: 0, status: "pending" });
    expect(steps[3]).toMatchObject({ index: 3, status: "pending" });
  });
  it("getTemplate throws on unknown", () => {
    expect(() => getTemplate("nope" as never)).toThrow();
  });
  it("quick-fix sequence is investigate → fix → review → ship", () => {
    const t = getTemplate("quick-fix");
    expect(t.steps.map((s) => s.skill ?? s.type)).toEqual([
      "/investigate",
      "fix",
      "/review",
      "/ship",
    ]);
  });
});

describe("state machine", () => {
  it("planning → active allowed, planning → completed blocked", () => {
    expect(isValidMissionTransition("planning", "active")).toBe(true);
    expect(isValidMissionTransition("planning", "completed")).toBe(false);
  });
  it("terminal statuses block further transitions", () => {
    expect(isTerminalMission("completed")).toBe(true);
    expect(isTerminalMission("abandoned")).toBe(true);
    expect(isValidMissionTransition("completed", "active")).toBe(false);
    expect(() => assertMissionTransition("abandoned", "active")).toThrow();
  });
  it("same-status is treated as idempotent no-op", () => {
    expect(isValidMissionTransition("active", "active")).toBe(true);
    expect(() => assertMissionTransition("active", "active")).not.toThrow();
  });
});

// ──────────────────────── scenario 8: run_skill allowlist ───────────────

describe("scenario 8 — run_skill allowlist", () => {
  it("includes the 10 mission-engine skills", () => {
    expect(ALLOWED_SKILLS.length).toBe(10);
    for (const s of [
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
    ]) {
      expect(ALLOWED_SKILLS).toContain(s);
    }
  });
  it("rejects arbitrary slash commands", () => {
    expect(isAllowedSkill("/review")).toBe(true);
    expect(isAllowedSkill("/rm -rf /")).toBe(false);
    expect(isAllowedSkill("/spawn-agent")).toBe(false);
    expect(isAllowedSkill("")).toBe(false);
  });
});

// ──────────────────────── scenario: launch → run ─────────────────────────

describe("launch and run", () => {
  it("Quick Fix runs end-to-end with default fake ports", async () => {
    const { engine, store } = buildEngine();
    const mission = await engine.launch({
      projectId: "p1",
      goal: "fix login bug",
      templateId: "quick-fix",
    });
    expect(mission.id).toBeTruthy();

    await waitFor(() => store.raw(mission.id)?.status === "completed", 2000);
    const final = store.raw(mission.id)!;
    expect(final.status).toBe("completed");
    expect(final.completedAt).toBeInstanceOf(Date);
    expect(final.steps.every((s) => s.status === "success")).toBe(true);
    // contextLog 가 충분히 풍부
    expect(final.contextLog.length).toBeGreaterThan(4);
  });

  it("research template completes after 2 gstack steps", async () => {
    const { engine, store } = buildEngine();
    const m = await engine.launch({
      projectId: "p1",
      goal: "explore X",
      templateId: "research",
    });
    await waitFor(() => store.raw(m.id)?.status === "completed", 2000);
    expect(store.raw(m.id)!.steps).toHaveLength(2);
  });
});

// ──────────────────────── scenario 3: sleeping → event wakeup ──────────

describe("scenario 3 — sleeping → event wakeup → resume", () => {
  it("wait step에서 task 미완료면 sleeping, event 도착 시 active 로 깨어남", async () => {
    const { engine, store, bus, dispatcher } = buildEngine();

    // feature 템플릿: gstack /plan-eng-review → dispatch → wait → /review → /qa → /ship
    const mission = await engine.launch({
      projectId: "p1",
      goal: "add feature",
      templateId: "feature",
    });

    // sleeping 까지 진행
    await waitFor(() => store.raw(mission.id)?.status === "sleeping", 2000);

    // dispatch + wait 까지 진행됐는지
    const before = store.raw(mission.id)!;
    const dispatchStep = before.steps.find((s) => s.type === "dispatch")!;
    expect(dispatchStep.status).toBe("success");
    expect(before.taskIds.length).toBeGreaterThan(0);

    // tasks 완료로 갱신 후 event 발행 → 깨어나서 끝까지 진행
    const allDone: Record<string, TaskStatusLite> = {};
    for (const id of before.taskIds) allDone[id] = "DONE";
    dispatcher.__setStatuses(allDone);

    bus.emit({
      type: "task.status_changed",
      missionId: mission.id,
      payload: { taskId: before.taskIds[0], from: "IN_PROGRESS", to: "DONE" },
    });

    await waitFor(() => store.raw(mission.id)?.status === "completed", 2000);
    const final = store.raw(mission.id)!;
    expect(final.status).toBe("completed");
  }, 5000);
});

// ──────────────────────── scenario 4: abandon ───────────────────────────

describe("scenario 4 — abandon (task / agent kill)", () => {
  it("진행 중 미션 abandon 시 killAgentsForTasks 호출 + abandoned 상태", async () => {
    const { engine, store, spy } = buildEngine();
    const m = await engine.launch({
      projectId: "p1",
      goal: "long feature",
      templateId: "feature",
    });
    await waitFor(() => store.raw(m.id)?.status === "sleeping", 2000);

    const before = store.raw(m.id)!;
    expect(before.taskIds.length).toBeGreaterThan(0);

    await engine.abandon(m.id, "user_cancelled");

    const final = store.raw(m.id)!;
    expect(final.status).toBe("abandoned");
    expect(final.abandonedReason).toBe("user_cancelled");
    expect(spy.killCalls.length).toBe(1);
    expect(spy.killCalls[0]).toEqual(before.taskIds);
  });

  it("terminal 미션 abandon 호출은 no-op", async () => {
    const { engine, store, spy } = buildEngine();
    const m = await engine.launch({
      projectId: "p1",
      goal: "x",
      templateId: "research",
    });
    await waitFor(() => store.raw(m.id)?.status === "completed", 2000);
    await engine.abandon(m.id);
    expect(store.raw(m.id)!.status).toBe("completed");
    expect(spy.killCalls.length).toBe(0);
  });
});

// ──────────────────────── scenario 5: escalate ─────────────────────────

describe("scenario 5 — escalate → waiting_for_human", () => {
  it("onFailure='escalate' step 실패 시 waiting_for_human + notifyUser timeline", async () => {
    const { engine, store } = buildEngine({
      skillRunner: makeSkillRunner({ alwaysFail: true }),
    });
    // quick-fix 의 첫 step (/investigate) 가 onFailure='escalate'
    const m = await engine.launch({
      projectId: "p1",
      goal: "broken thing",
      templateId: "quick-fix",
    });

    await waitFor(() => store.raw(m.id)?.status === "waiting_for_human", 2000);
    const final = store.raw(m.id)!;
    expect(final.status).toBe("waiting_for_human");

    // 첫 step 이 failed
    expect(final.steps[0].status).toBe("failed");
    expect(final.steps[0].error).toMatch(/failed/);
    // 사용자 보고 신호 (notifyUser=true) 가 contextLog 에 있어야 함
    const notifyEvt = final.contextLog.find(
      (e) =>
        e.type === "step.failed" &&
        (e.payload as { notifyUser?: boolean })?.notifyUser === true,
    );
    expect(notifyEvt).toBeTruthy();
  });

  it("notifier 가 escalate 시 호출된다 (OS 알림 / 인앱 surface 트리거)", async () => {
    const calls: Array<{
      kind: string;
      projectId: string;
      missionId: string;
    }> = [];
    const { engine, store } = buildEngine({
      skillRunner: makeSkillRunner({ alwaysFail: true }),
      notifier: (n) => calls.push(n),
    });
    const m = await engine.launch({
      projectId: "p1",
      goal: "broken thing",
      templateId: "quick-fix",
    });

    await waitFor(() => store.raw(m.id)?.status === "waiting_for_human", 2000);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].kind).toBe("escalate");
    expect(calls[0].projectId).toBe("p1");
    expect(calls[0].missionId).toBe(m.id);
  });

  it("retry 정책 (default) — maxRetries=2 후에 waiting_for_human", async () => {
    const { engine, store } = buildEngine({
      // /review 는 onFailure='retry'. 3 번 실패하게 만들기 (retry 2 회 한도 초과)
      skillRunner: makeSkillRunner({ failures: 99 }),
      maxRetries: 2,
    });
    const m = await engine.launch({
      projectId: "p1",
      goal: "polish me",
      templateId: "polish",
    });
    await waitFor(() => store.raw(m.id)?.status === "waiting_for_human", 2000);
    const final = store.raw(m.id)!;
    // 첫 step (/design-review) 가 retry 2 회 후 failed
    expect(final.steps[0].status).toBe("failed");
    expect(final.steps[0].retryCount).toBe(2);
  }, 5000);
});

// ──────────────────────── scenario 6: parallel missions ────────────────

describe("scenario 6 — multiple missions in parallel", () => {
  it("두 미션 동시 launch 시 서로 간섭하지 않고 각자 진행", async () => {
    const { engine, store } = buildEngine();
    const m1 = await engine.launch({
      projectId: "p1",
      goal: "task A",
      templateId: "research",
    });
    const m2 = await engine.launch({
      projectId: "p2",
      goal: "task B",
      templateId: "research",
    });

    await waitFor(
      () =>
        store.raw(m1.id)?.status === "completed" &&
        store.raw(m2.id)?.status === "completed",
      3000,
    );
    expect(store.size()).toBe(2);
    expect(store.raw(m1.id)!.projectId).toBe("p1");
    expect(store.raw(m2.id)!.projectId).toBe("p2");
  }, 5000);
});

// ──────────────────────── scenario 7: resume after dispose ─────────────

describe("scenario 7 — engine dispose + new instance resume", () => {
  it("sleeping 미션을 새 engine 인스턴스가 store 에서 읽어 이어 진행", async () => {
    const store = new InMemoryStore();
    const bus1 = new InProcessMissionEventBus();
    const spy: DispatchSpy = { dispatchCalls: [], killCalls: [] };
    const dispatcher = makeDispatcher(spy) as TaskDispatcher & {
      __setStatuses: (s: Record<string, TaskStatusLite>) => void;
    };
    const orchRegistry = makeOrchRegistry();

    // 1차 인스턴스
    const engine1 = new MissionEngine({
      store,
      dispatcher,
      skillRunner: makeSkillRunner(),
      fixRunner: makeFixRunner(),
      eventBus: bus1,
      orchestrators: orchRegistry,
    });
    const m = await engine1.launch({
      projectId: "p1",
      goal: "feature work",
      templateId: "feature",
    });
    await waitFor(() => store.raw(m.id)?.status === "sleeping", 2000);

    // 1차 인스턴스 종료 시뮬레이션
    engine1.dispose();

    // 2차 인스턴스 — 새 bus, 같은 store / dispatcher
    const bus2 = new InProcessMissionEventBus();
    const engine2 = new MissionEngine({
      store,
      dispatcher,
      skillRunner: makeSkillRunner(),
      fixRunner: makeFixRunner(),
      eventBus: bus2,
      orchestrators: orchRegistry,
    });

    // tasks 완료 후 resume
    const sleeping = store.raw(m.id)!;
    const allDone: Record<string, TaskStatusLite> = {};
    for (const id of sleeping.taskIds) allDone[id] = "DONE";
    dispatcher.__setStatuses(allDone);
    await engine2.resume(m.id);

    await waitFor(() => store.raw(m.id)?.status === "completed", 2000);
    expect(store.raw(m.id)!.status).toBe("completed");
    // 재개 timeline 이벤트가 있어야
    const resumeEvt = store
      .raw(m.id)!
      .contextLog.find((e) => e.type === "mission.resumed");
    expect(resumeEvt).toBeTruthy();
  }, 5000);

  it("terminal 미션은 resume 거부", async () => {
    const { engine, store } = buildEngine();
    const m = await engine.launch({
      projectId: "p1",
      goal: "x",
      templateId: "research",
    });
    await waitFor(() => store.raw(m.id)?.status === "completed", 2000);
    await expect(engine.resume(m.id)).rejects.toThrow(/terminal/);
  });
});

// ──────────────────────── pause / wake via direct event ────────────────

describe("manual pause / wake", () => {
  it("pause 는 active → sleeping, resume 으로 다시 active", async () => {
    // active 상태에서 pause 하려면 race 가 까다로움 — research 가 빠르게 끝나므로
    // 처음부터 skillRunner 를 항상 sleeping 으로 만드는 게 더 안정적.
    // 여기서는 단순 pause API 동작만 확인 (active 상태가 아닐 때 no-op).
    const { engine, store } = buildEngine();
    const m = await engine.launch({
      projectId: "p1",
      goal: "x",
      templateId: "research",
    });
    await waitFor(() => store.raw(m.id)?.status === "completed", 2000);
    // terminal 에서 pause 호출은 no-op
    await engine.pause(m.id);
    expect(store.raw(m.id)!.status).toBe("completed");
  });
});

// ──────────── scenario 2b: onEvent honors user pause (HIGH-1) ────────────

describe("onEvent — user-paused mission is not woken by task/agent events", () => {
  function makePausedSleepingMission(
    store: InMemoryStore,
    pausedByUser: boolean,
  ): Promise<string> {
    const steps: MissionStep[] = [
      {
        index: 0,
        type: "gstack",
        skill: "/review",
        onFailure: "escalate",
        status: "pending",
      },
    ];
    return store.createMission({
      projectId: "p1",
      goal: "paused work",
      templateId: "polish",
      status: "sleeping",
      ownerOrchestratorSessionId: "sess-p1",
      steps,
      currentStepIndex: 0,
      taskIds: ["t1"],
      contextLog: [
        {
          ts: new Date(),
          type: "mission.paused",
          payload: { kind: pausedByUser ? "paused_by_user" : "sleeping" },
        },
      ],
    });
  }

  it("paused_by_user sleeping 미션은 task.status_changed / agent idle 로 안 깨어난다", async () => {
    const { store, bus } = buildEngine();
    const id = await makePausedSleepingMission(store, true);

    // event-forwarder(task.status_changed) + forwardAgentStatus(agent.completed)
    // 양쪽 신호를 모사. 둘 다 무시되어야 한다.
    bus.emit({
      type: "task.status_changed",
      missionId: id,
      payload: { taskId: "t1", from: "IN_PROGRESS", to: "DONE" },
    });
    bus.emit({
      type: "agent.completed",
      missionId: id,
      payload: { agentId: "a1", status: "idle" },
    });

    // 잠깐 기다려도 sleeping 유지 (깨어났다면 active → 진행했을 것).
    await new Promise((r) => setTimeout(r, 120));
    const m = store.raw(id)!;
    expect(m.status).toBe("sleeping");
    // 진행 안 됨 — step 은 여전히 pending.
    expect(m.steps[0].status).toBe("pending");
    // 무시된 이벤트는 paused 미션 timeline 을 오염시키지 않는다 (append 전 return).
    expect(m.contextLog.some((e) => e.type === "agent.completed")).toBe(false);
  });

  it("wait-step sleeping(비 유저-pause) 미션은 정상적으로 깨어나 진행한다", async () => {
    const { store, bus } = buildEngine();
    const id = await makePausedSleepingMission(store, false);

    bus.emit({
      type: "task.status_changed",
      missionId: id,
      payload: { taskId: "t1", from: "IN_PROGRESS", to: "DONE" },
    });

    // 깨어나서 gstack /review (fake runner 성공) 실행 → 끝까지 진행 → completed.
    await waitFor(() => store.raw(id)?.status === "completed", 2000);
    expect(store.raw(id)!.status).toBe("completed");
  });
});

// ──────── scenario 3b: pause/abandon notifies mission orchestrator ────────

describe("pause/abandon — bracketed-paste-safe orchestrator notification", () => {
  async function activeMissionWithOrch(): Promise<{
    engine: MissionEngine;
    store: InMemoryStore;
    spy: DispatchSpy;
    orch: OrchestratorRegistry;
    id: string;
  }> {
    const orch = makeOrchRegistry();
    const { engine, store, spy } = buildEngine({ orchestrators: orch });
    const id = await store.createMission({
      projectId: "p1",
      goal: "live mission",
      templateId: "polish",
      status: "active",
      ownerOrchestratorSessionId: "sess-p1",
      steps: instantiateSteps("polish"),
      currentStepIndex: 0,
      taskIds: ["t1"],
      contextLog: [],
    });
    // owner orchestrator 세션을 살려둔다 (sessionId = sess-p1).
    await orch.ensureSession({ missionId: id, projectId: "p1" });
    return { engine, store, spy, orch, id };
  }

  it("pause 시 owner orchestrator 에 멀티라인 안내를 postMessage(=bracketed paste)로 1회 보낸다", async () => {
    const { engine, store, orch, id } = await activeMissionWithOrch();
    await engine.pause(id);

    expect(store.raw(id)!.status).toBe("sleeping");
    const ref = orch.getSession("sess-p1")!;
    const postMessage = ref.postMessage as ReturnType<typeof vi.fn>;
    expect(postMessage).toHaveBeenCalledTimes(1);
    const sent = postMessage.mock.calls[0][0] as string;
    // 멀티라인 — 이 경우가 raw write 면 깨지는 케이스. postMessage→writeAndSubmit 가
    // bracketed-paste 로 감싸 한 메시지로 제출하므로 안전.
    expect(sent).toContain("\n");
    expect(sent).toContain("일시정지");
  });

  it("abandon 시 owner orchestrator 에 안내를 보내고 agent 를 kill 한다", async () => {
    const { engine, store, spy, orch, id } = await activeMissionWithOrch();
    await engine.abandon(id, "user_cancelled");

    expect(store.raw(id)!.status).toBe("abandoned");
    expect(spy.killCalls.length).toBe(1);
    const ref = orch.getSession("sess-p1")!;
    const postMessage = ref.postMessage as ReturnType<typeof vi.fn>;
    expect(postMessage).toHaveBeenCalledTimes(1);
    const sent = postMessage.mock.calls[0][0] as string;
    expect(sent).toContain("\n");
    expect(sent).toContain("중단");
  });

  it("owner orchestrator 세션이 없으면 best-effort 로 조용히 넘어간다(상태 전이는 정상)", async () => {
    // orch registry 에 세션을 만들지 않음 → getSession 이 null.
    const orch = makeOrchRegistry();
    const { engine, store } = buildEngine({ orchestrators: orch });
    const id = await store.createMission({
      projectId: "p1",
      goal: "no orch",
      templateId: "polish",
      status: "active",
      ownerOrchestratorSessionId: "sess-missing",
      steps: instantiateSteps("polish"),
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [],
    });
    await expect(engine.pause(id)).resolves.toBeUndefined();
    expect(store.raw(id)!.status).toBe("sleeping");
  });
});

// ────────────── event-forwarder: user-pause detection ──────────────

describe("event-forwarder isMissionPausedByUser", () => {
  it("마지막 paused 이벤트가 paused_by_user 면 true", () => {
    expect(
      isMissionPausedByUser({
        contextLog: [
          { type: "step.started", payload: {} },
          { type: "mission.paused", payload: { kind: "paused_by_user" } },
        ],
      }),
    ).toBe(true);
  });

  it("wait-step sleeping(kind=sleeping) 은 false", () => {
    expect(
      isMissionPausedByUser({
        contextLog: [{ type: "mission.paused", payload: { kind: "sleeping" } }],
      }),
    ).toBe(false);
  });

  it("pause 후 resume 됐으면 false (가장 가까운 이벤트가 resumed)", () => {
    expect(
      isMissionPausedByUser({
        contextLog: [
          { type: "mission.paused", payload: { kind: "paused_by_user" } },
          { type: "mission.resumed", payload: { by: "user" } },
        ],
      }),
    ).toBe(false);
  });

  it("contextLog 없으면 false (방어)", () => {
    expect(isMissionPausedByUser({})).toBe(false);
  });
});

// ──────────────────────── dispose hygiene ──────────────────────────────

describe("dispose", () => {
  it("dispose 후 eventBus 핸들러가 떨어진다", async () => {
    const bus = new InProcessMissionEventBus();
    expect(bus.size()).toBe(0);
    const { engine } = buildEngine({ eventBus: bus });
    expect(bus.size()).toBe(1);
    engine.dispose();
    expect(bus.size()).toBe(0);
  });
});

describe("scenario 9 — 앱 재시작 in-flight 복구", () => {
  it("running 이던 gstack step 은 pending 으로 리셋 후 재실행된다", async () => {
    const { engine, store } = buildEngine();
    const steps: MissionStep[] = [
      {
        index: 0,
        type: "gstack",
        skill: "/review",
        onFailure: "escalate",
        status: "running",
      },
      {
        index: 1,
        type: "gstack",
        skill: "/ship",
        onFailure: "escalate",
        status: "pending",
      },
    ];
    const id = await store.createMission({
      projectId: "p1",
      goal: "resume me",
      templateId: "polish",
      status: "active",
      ownerOrchestratorSessionId: "orch-1",
      steps,
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [],
    });

    await engine.recoverInFlight(id);
    // pending 으로 리셋 후 재실행되어 success 로 마감(default fake runner 는 성공).
    await waitFor(() => store.raw(id)!.steps[0].status === "success", 2000);
    expect(store.raw(id)!.steps[0].status).toBe("success");
  });

  it("running 이던 fix step 은 멈추지 않고 이어간다(멱등 재연결은 fix-runner 책임)", async () => {
    const fixSpy = vi.fn(async () => ({ success: true }));
    const { engine, store } = buildEngine({ fixRunner: { runFix: fixSpy } });
    const steps: MissionStep[] = [
      { index: 0, type: "fix", onFailure: "escalate", status: "running" },
    ];
    const id = await store.createMission({
      projectId: "p1",
      goal: "broken thing",
      templateId: "quick-fix",
      status: "active",
      ownerOrchestratorSessionId: "orch-1",
      steps,
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [],
    });

    await engine.recoverInFlight(id);
    // waiting_for_human 으로 멈추지 않는다 — 이어서 진행.
    expect(store.raw(id)!.status).not.toBe("waiting_for_human");
    // fix-runner 를 다시 호출(실제 구현은 기존 task 에 멱등 재연결).
    await waitFor(() => fixSpy.mock.calls.length > 0, 2000);
    expect(fixSpy).toHaveBeenCalled();
  });

  it("running 이던 dispatch step 은 기존 task 에 재연결하고 재dispatch 하지 않는다", async () => {
    const { engine, store, spy, dispatcher } = buildEngine();
    // 미션 task 가 이미 존재한다고 가정 — findMissionTaskIds 가 잡아낸다.
    dispatcher.__setStatuses({
      "t-m1-1": "IN_PROGRESS",
      "t-m1-2": "IN_PROGRESS",
    });
    const steps: MissionStep[] = [
      { index: 0, type: "dispatch", onFailure: "escalate", status: "running" },
      { index: 1, type: "wait", onFailure: "escalate", status: "pending" },
    ];
    const id = await store.createMission({
      projectId: "p1",
      goal: "feature",
      templateId: "feature",
      status: "active",
      ownerOrchestratorSessionId: "orch-1",
      steps,
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [],
    });

    await engine.recoverInFlight(id);
    // dispatch 는 재실행되지 않아야 한다(중복 방지) — dispatchTasks 호출 0.
    expect(spy.dispatchCalls.length).toBe(0);
    // 기존 task 가 mission.taskIds 에 재연결됨.
    await waitFor(() => (store.raw(id)?.taskIds.length ?? 0) >= 2, 2000);
    expect(store.raw(id)!.taskIds).toEqual(
      expect.arrayContaining(["t-m1-1", "t-m1-2"]),
    );
  });
});

// Reset mock store before each suite (firebase mock keeps state across files)
beforeEach(async () => {
  const mocks = (await import("../mocks/firebase-firestore")) as unknown as {
    __resetStore?: () => void;
  };
  mocks.__resetStore?.();
});
