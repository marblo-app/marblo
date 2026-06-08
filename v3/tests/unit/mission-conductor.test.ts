import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MissionEngine,
  InProcessMissionEventBus,
  createConductorDriver,
  instantiateSteps,
  MISSION_STEP_REPORTED_EVENT,
} from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  MissionTemplateId,
  TimelineEvent,
} from "../../electron/mission-engine/types";
import type {
  FixRunner,
  MissionEngineEvent,
  MissionNotifier,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  SkillResult,
  SkillRunner,
  TaskDispatcher,
  TaskStatusLite,
  VerifyStepGate,
} from "../../electron/mission-engine/ports";

// B안 Phase 2 — ConductorDriver(지휘자) 운전 루프 검증.
// in-memory fake ports 로 grant → report → gate → advance 루프를 풀로 돌린다.
// 게이트(P2-B gates.ts)·보고 MCP(P2-C tools.ts)는 계약(verifyStepGate 시그니처,
// 'mission.step_reported' 이벤트)으로만 연동 — 여기선 주입/emit 으로 모사한다.

// ──────────────────────────── fakes ────────────────────────────

class InMemoryStore implements MissionStore {
  private docs = new Map<string, Mission>();
  private nextId = 1;

  async getMission(id: string): Promise<Mission | null> {
    const m = this.docs.get(id);
    return m ? structuredClone(m) : null;
  }
  async createMission(
    data: Omit<Mission, "id" | "launchedAt" | "lastActivityAt" | "completedAt">
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
    patch: Partial<Omit<Mission, "id" | "launchedAt">>
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    this.docs.set(id, { ...cur, ...patch, lastActivityAt: new Date() });
  }
  async appendTimelineEvent(id: string, event: TimelineEvent): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    cur.contextLog.push(event);
  }
  async updateMissionStep(
    id: string,
    stepIndex: number,
    patch: Partial<MissionStep>
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    if (stepIndex < 0 || stepIndex >= cur.steps.length) {
      throw new Error("step OOB");
    }
    cur.steps[stepIndex] = { ...cur.steps[stepIndex], ...patch };
  }
  async setMissionStatus(
    id: string,
    status: MissionStatus,
    extras?: { completedAt?: Date; abandonedReason?: string }
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    cur.status = status;
    if (extras?.completedAt) cur.completedAt = extras.completedAt;
    if (extras?.abandonedReason) cur.abandonedReason = extras.abandonedReason;
  }
  raw(id: string): Mission | undefined {
    return this.docs.get(id);
  }
}

function makeOrch(opts?: { alive?: boolean }): {
  registry: OrchestratorRegistry;
  posts: string[];
  setAlive: (v: boolean) => void;
} {
  const posts: string[] = [];
  let alive = opts?.alive ?? true;
  const ref: OrchestratorRef = {
    sessionId: "sess-1",
    ptySessionId: "pty-1",
    isAlive: () => alive,
    postMessage: vi.fn(async (m: string) => {
      posts.push(m);
    }),
  };
  const registry: OrchestratorRegistry = {
    async ensureSession() {
      return ref;
    },
    getSession: (sid) => (sid === "sess-1" ? ref : null),
  };
  return { registry, posts, setAlive: (v) => (alive = v) };
}

interface BuildOpts {
  verifyStepGate?: VerifyStepGate;
  notifier?: MissionNotifier;
  maxRetries?: number;
  orchAlive?: boolean;
}

function buildConductor(opts: BuildOpts = {}): {
  store: InMemoryStore;
  bus: InProcessMissionEventBus;
  conductor: ConductorDriver;
  posts: string[];
  taskStatuses: Record<string, TaskStatusLite>;
} {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const orch = makeOrch({ alive: opts.orchAlive ?? true });
  const taskStatuses: Record<string, TaskStatusLite> = {};
  const conductor = createConductorDriver({
    store,
    orchestrators: orch.registry,
    eventBus: bus,
    getTaskStatuses: async (ids) => {
      const out: Record<string, TaskStatusLite> = {};
      for (const id of ids) if (taskStatuses[id]) out[id] = taskStatuses[id];
      return out;
    },
    maxRetries: opts.maxRetries ?? 2,
    notifier: opts.notifier,
    verifyStepGate: opts.verifyStepGate,
    logger: () => {},
  });
  return { store, bus, conductor, posts: orch.posts, taskStatuses };
}

async function makeMission(
  store: InMemoryStore,
  opts: {
    templateId?: MissionTemplateId;
    steps?: MissionStep[];
    taskIds?: string[];
    goal?: string;
  } = {}
): Promise<string> {
  const templateId = opts.templateId ?? "research";
  return store.createMission({
    projectId: "p1",
    goal: opts.goal ?? "drive me",
    templateId,
    status: "active",
    ownerOrchestratorSessionId: "sess-1",
    steps: opts.steps ?? instantiateSteps(templateId),
    currentStepIndex: 0,
    taskIds: opts.taskIds ?? [],
    contextLog: [],
  });
}

function reportEvent(
  missionId: string,
  stepIndex: number,
  status: "success" | "failed",
  extra?: { output?: unknown; error?: string }
): MissionEngineEvent {
  return {
    type: MISSION_STEP_REPORTED_EVENT,
    missionId,
    payload: {
      stepIndex,
      result: { status, output: extra?.output, error: extra?.error },
    },
  } as unknown as MissionEngineEvent;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 5
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// firebase mock 은 파일 간 state 를 공유하므로 리셋(다른 스위트와의 격리).
beforeEach(async () => {
  const mocks = (await import("../mocks/firebase-firestore")) as unknown as {
    __resetStore?: () => void;
  };
  mocks.__resetStore?.();
});

// ──────────────────────── grant (스텝 권한 부여) ────────────────────────

describe("ConductorDriver — grantStep", () => {
  it("requestAdvance 는 현재 스텝을 running 마킹하고 오케 PTY 에 허가 메시지를 1회 주입한다", async () => {
    const { store, conductor, posts } = buildConductor();
    const id = await makeMission(store, { templateId: "research" });

    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");

    expect(store.raw(id)!.steps[0].status).toBe("running");
    expect(posts).toHaveLength(1);
    // §3.2 — '한 번에 하나' 허가 + mission_step_done 보고 + 스스로 advance 금지.
    expect(posts[0]).toContain("현재 스텝 0");
    expect(posts[0]).toContain("/office-hours");
    expect(posts[0]).toContain("mission_step_done");
    expect(posts[0]).toContain("스스로 넘어가지 마세요");
    // step.started 타임라인이 driver=orchestrator 로 남는다.
    const started = store
      .raw(id)!
      .contextLog.find((e) => e.type === "step.started");
    expect((started?.payload as { driver?: string })?.driver).toBe(
      "orchestrator"
    );
  });

  it("이미 running 인 스텝에 grantStep 재호출은 허가 메시지를 중복 주입하지 않는다", async () => {
    const { store, conductor, posts } = buildConductor();
    const id = await makeMission(store, { templateId: "research" });
    conductor.requestAdvance(id);
    await waitFor(() => posts.length === 1);
    await conductor.grantStep(id, 0); // 중복 grant
    expect(posts).toHaveLength(1);
  });

  it("살아있는 owner 세션이 없어도 best-effort — running 마킹은 하되 throw 하지 않는다", async () => {
    const { store, conductor, posts } = buildConductor({ orchAlive: false });
    const id = await makeMission(store, { templateId: "research" });
    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");
    expect(posts).toHaveLength(0); // 주입 스킵
    expect(store.raw(id)!.steps[0].status).toBe("running");
  });
});

// ──────────────────────── report → gate → advance 루프 ────────────────────

describe("ConductorDriver — 보고 → 게이트 → 전진 루프", () => {
  it("성공 보고 + 게이트 통과 → 현재 스텝 success, currentStepIndex++ 후 다음 스텝 허가", async () => {
    const { store, bus, conductor, posts } = buildConductor();
    const id = await makeMission(store, { templateId: "research" });

    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");

    bus.emit(reportEvent(id, 0, "success"));
    await waitFor(() => store.raw(id)!.steps[1].status === "running");

    const m = store.raw(id)!;
    expect(m.steps[0].status).toBe("success");
    expect(m.currentStepIndex).toBe(1);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain("현재 스텝 1");
    expect(posts[1]).toContain("/plan-ceo-review");
  });

  it("모든 스텝 성공 보고 → 미션 completed (전체 루프 end-to-end)", async () => {
    const { store, bus, conductor } = buildConductor();
    const id = await makeMission(store, { templateId: "research" });

    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");
    bus.emit(reportEvent(id, 0, "success"));
    await waitFor(() => store.raw(id)!.steps[1].status === "running");
    bus.emit(reportEvent(id, 1, "success"));
    await waitFor(() => store.raw(id)!.status === "completed");

    const m = store.raw(id)!;
    expect(m.status).toBe("completed");
    expect(m.completedAt).toBeInstanceOf(Date);
    expect(m.steps.every((s) => s.status === "success")).toBe(true);
    expect(
      m.contextLog.some(
        (e) =>
          e.type === "supervisor.note" &&
          String((e.payload as { message?: string }).message).includes(
            "completed"
          )
      )
    ).toBe(true);
  });

  it("보고된 output 은 step.output 으로 반영되고 게이트 컨텍스트가 본다", async () => {
    const seen: unknown[] = [];
    const gate: VerifyStepGate = async (step) => {
      seen.push(step.output);
      return { pass: true };
    };
    const { store, bus, conductor } = buildConductor({ verifyStepGate: gate });
    const id = await makeMission(store, { templateId: "research" });
    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");
    bus.emit(reportEvent(id, 0, "success", { output: "PR: http://x/pull/1" }));
    await waitFor(() => store.raw(id)!.steps[0].status === "success");
    expect(seen[0]).toBe("PR: http://x/pull/1");
    expect(store.raw(id)!.steps[0].output).toBe("PR: http://x/pull/1");
  });

  it("현재 스텝과 다른 인덱스의 보고는 무시(stale) — 전진하지 않는다", async () => {
    const { store, bus, conductor } = buildConductor();
    const id = await makeMission(store, { templateId: "research" });
    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");

    bus.emit(reportEvent(id, 5, "success"));
    await new Promise((r) => setTimeout(r, 80));
    const m = store.raw(id)!;
    expect(m.currentStepIndex).toBe(0);
    expect(m.steps[0].status).toBe("running");
  });
});

// ──────────────────────── 게이트 보류 (§5.1 핵심 리스크) ────────────────────

describe("ConductorDriver — 게이트 보류 시 전진 차단", () => {
  it("성공 보고여도 주입 게이트가 거부하면 다음 스텝으로 넘어가지 않고 retry(재허가)", async () => {
    let calls = 0;
    const gate: VerifyStepGate = async () => {
      calls += 1;
      return calls === 1
        ? { pass: false, reason: "still cooking" }
        : { pass: true };
    };
    const steps: MissionStep[] = [
      {
        index: 0,
        type: "gstack",
        skill: "/review",
        onFailure: "retry",
        status: "pending",
      },
    ];
    const { store, bus, conductor, posts } = buildConductor({
      verifyStepGate: gate,
    });
    const id = await makeMission(store, { steps });

    conductor.requestAdvance(id);
    await waitFor(() => posts.length === 1);

    // 1차 보고 → 게이트 거부 → retry → 재허가(running, retryCount 1).
    bus.emit(reportEvent(id, 0, "success"));
    await waitFor(() => (store.raw(id)!.steps[0].retryCount ?? 0) === 1);
    expect(store.raw(id)!.steps[0].status).toBe("running");
    expect(store.raw(id)!.currentStepIndex).toBe(0); // 전진 안 함
    await waitFor(() => posts.length === 2); // 재허가 메시지

    // gate_failed 타임라인이 남는다.
    expect(
      store
        .raw(id)!
        .contextLog.some(
          (e) => (e.payload as { kind?: string }).kind === "gate_failed"
        )
    ).toBe(true);

    // 2차 보고 → 게이트 통과 → 단일 스텝이라 완료.
    bus.emit(reportEvent(id, 0, "success"));
    await waitFor(() => store.raw(id)!.status === "completed");
    expect(calls).toBe(2);
  });

  it("내장 기본 게이트: wait 스텝은 taskIds 가 전부 DONE 일 때만 통과한다", async () => {
    const steps: MissionStep[] = [
      { index: 0, type: "wait", onFailure: "retry", status: "pending" },
    ];
    const { store, bus, conductor, taskStatuses, posts } = buildConductor();
    const id = await makeMission(store, { steps, taskIds: ["t1", "t2"] });
    taskStatuses.t1 = "DONE";
    taskStatuses.t2 = "IN_PROGRESS";

    // P3-A: wait 스텝은 오케에 grant 하지 않는다 — 지휘자가 task 완료를 폴링한다(§8-3).
    // requestAdvance → running 마킹 + 즉시 게이트 1회 평가(미완료라 보류).
    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");
    // grant 평가가 완전히 정착하도록 짧게 비운다(미완료라 어떤 전이도 일어나지 않음).
    await new Promise((r) => setTimeout(r, 30));

    // 미완료 task 존재 → 게이트 보류 → 전진/완료/재시도 없이 running 유지.
    // wait 은 grant 메시지를 PTY 로 주입하지 않으므로 posts 는 0 (gstack grant 와 구분).
    expect(posts.length).toBe(0);
    expect(store.raw(id)!.currentStepIndex).toBe(0);
    expect(store.raw(id)!.steps[0].status).toBe("running");
    // task-게이트 스텝은 재dispatch 중복 방지를 위해 retry 하지 않는다(§8-3).
    expect(store.raw(id)!.steps[0].retryCount ?? 0).toBe(0);

    // task 완료 후 외부 이벤트(agent.completed) wakeup → wait 게이트 재평가 → 통과 → 전진.
    taskStatuses.t2 = "DONE";
    bus.emit({ type: "agent.completed", missionId: id, payload: {} });
    await waitFor(() => store.raw(id)!.status === "completed");
    expect(store.raw(id)!.steps[0].status).toBe("success");
  });

  it("내장 기본 게이트: /ship 스텝은 output 에 PR URL 이 있어야 통과한다", async () => {
    const shipStep = (): MissionStep[] => [
      {
        index: 0,
        type: "gstack",
        skill: "/ship",
        onFailure: "continue", // 게이트 보류 시 escalate 대신 skip 으로 단순화
        status: "pending",
      },
    ];
    // (a) PR URL 없는 output → 보류
    {
      const { store, bus, conductor } = buildConductor();
      const id = await makeMission(store, { steps: shipStep() });
      conductor.requestAdvance(id);
      await waitFor(() => store.raw(id)!.steps[0].status === "running");
      bus.emit(reportEvent(id, 0, "success", { output: "merged locally" }));
      // continue 정책 → 게이트 보류 시 skipped 로 마감되며 완료.
      await waitFor(() => store.raw(id)!.status === "completed");
      expect(store.raw(id)!.steps[0].status).toBe("skipped");
    }
    // (b) PR URL 있는 output → 통과(success)
    {
      const { store, bus, conductor } = buildConductor();
      const id = await makeMission(store, { steps: shipStep() });
      conductor.requestAdvance(id);
      await waitFor(() => store.raw(id)!.steps[0].status === "running");
      bus.emit(
        reportEvent(id, 0, "success", {
          output: "PR: https://github.com/x/y/pull/9",
        })
      );
      await waitFor(() => store.raw(id)!.status === "completed");
      expect(store.raw(id)!.steps[0].status).toBe("success");
    }
  });
});

// ──────────────────────── 실패 보고 → retry / escalate ────────────────────

describe("ConductorDriver — 실패 보고 처리 (engine 정책 미러)", () => {
  it("retry 정책 스텝: 실패 보고 → 재허가, maxRetries 소진 후 waiting_for_human + 알림", async () => {
    const notices: Array<{ kind: string }> = [];
    const steps: MissionStep[] = [
      {
        index: 0,
        type: "gstack",
        skill: "/review",
        onFailure: "retry",
        status: "pending",
      },
    ];
    const { store, bus, conductor, posts } = buildConductor({
      maxRetries: 2,
      notifier: (n) => notices.push(n),
    });
    const id = await makeMission(store, { steps });

    conductor.requestAdvance(id);
    await waitFor(() => posts.length === 1);

    bus.emit(reportEvent(id, 0, "failed", { error: "boom1" }));
    await waitFor(() => (store.raw(id)!.steps[0].retryCount ?? 0) === 1);
    await waitFor(() => posts.length === 2);

    bus.emit(reportEvent(id, 0, "failed", { error: "boom2" }));
    await waitFor(() => (store.raw(id)!.steps[0].retryCount ?? 0) === 2);
    await waitFor(() => posts.length === 3);

    // 3번째 실패 → retry 소진 → escalate.
    bus.emit(reportEvent(id, 0, "failed", { error: "boom3" }));
    await waitFor(() => store.raw(id)!.status === "waiting_for_human");

    const m = store.raw(id)!;
    expect(m.steps[0].status).toBe("failed");
    expect(m.steps[0].retryCount).toBe(2);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[notices.length - 1].kind).toBe("escalate");
  });

  it("escalate 정책 스텝: 첫 실패 보고에 즉시 waiting_for_human + notifier(kind=escalate)", async () => {
    const notices: Array<{ kind: string; missionId: string }> = [];
    const { store, bus, conductor } = buildConductor({
      notifier: (n) => notices.push(n),
    });
    // quick-fix 첫 스텝 /investigate 는 onFailure='escalate'.
    const id = await makeMission(store, { templateId: "quick-fix" });

    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");
    bus.emit(reportEvent(id, 0, "failed", { error: "cannot investigate" }));
    await waitFor(() => store.raw(id)!.status === "waiting_for_human");

    expect(store.raw(id)!.steps[0].status).toBe("failed");
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("escalate");
    expect(notices[0].missionId).toBe(id);
  });

  it("continue 정책 스텝: 실패 보고 → skipped 후 다음 스텝 진행", async () => {
    const steps: MissionStep[] = [
      {
        index: 0,
        type: "gstack",
        skill: "/review",
        onFailure: "continue",
        status: "pending",
      },
      {
        index: 1,
        type: "gstack",
        skill: "/qa",
        onFailure: "continue",
        status: "pending",
      },
    ];
    const { store, bus, conductor } = buildConductor();
    const id = await makeMission(store, { steps });
    conductor.requestAdvance(id);
    await waitFor(() => store.raw(id)!.steps[0].status === "running");
    bus.emit(reportEvent(id, 0, "failed", { error: "skip me" }));
    await waitFor(() => store.raw(id)!.steps[1].status === "running");
    expect(store.raw(id)!.steps[0].status).toBe("skipped");
    expect(store.raw(id)!.currentStepIndex).toBe(1);
  });
});

// ──────────────────────── verifyGate / dispose ────────────────────────

describe("ConductorDriver — verifyGate API & dispose", () => {
  it("verifyGate 는 주입된 게이트 결과를 GateResult 로 매핑한다", async () => {
    const gate: VerifyStepGate = async () => ({
      pass: false,
      reason: "nope",
    });
    const { store, conductor } = buildConductor({ verifyStepGate: gate });
    const id = await makeMission(store, { templateId: "research" });
    const r = await conductor.verifyGate(id, 0);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("nope");
  });

  it("dispose 는 버스 구독을 해제한다", async () => {
    const bus = new InProcessMissionEventBus();
    expect(bus.size()).toBe(0);
    const conductor = createConductorDriver({
      store: new InMemoryStore(),
      orchestrators: makeOrch().registry,
      eventBus: bus,
      getTaskStatuses: async () => ({}),
      logger: () => {},
    });
    expect(bus.size()).toBe(1);
    conductor.dispose();
    expect(bus.size()).toBe(0);
  });
});

// ──────────────────────── engine(기본 A안) 경로 회귀 0 ────────────────────

describe("MissionEngine — orchestrator 모드는 conductor 에 위임, engine advance-loop 미동작", () => {
  function minimalEngineDeps(
    store: InMemoryStore,
    bus: InProcessMissionEventBus,
    orch: OrchestratorRegistry
  ) {
    const dispatcher: TaskDispatcher = {
      async dispatchTasks() {
        return [];
      },
      async getTaskStatuses() {
        return {};
      },
      async findMissionTaskIds() {
        return [];
      },
      async killAgentsForTasks() {},
    };
    const skillRunner: SkillRunner = {
      async runSkill(): Promise<SkillResult> {
        return { success: true, durationMs: 1 };
      },
    };
    const fixRunner: FixRunner = {
      async runFix() {
        return { success: true };
      },
    };
    return {
      store,
      dispatcher,
      skillRunner,
      fixRunner,
      eventBus: bus,
      orchestrators: orch,
    };
  }

  function stubConductor(): ConductorDriver & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      requestAdvance: (id: string) => {
        calls.push(id);
      },
      grantStep: async () => {},
      onStepReport: async () => {},
      verifyGate: async () => ({ passed: true }),
      onEvent: async () => {},
      dispose: () => {},
    };
  }

  it("orchestrator 모드 launch 는 conductor.requestAdvance 만 호출하고 엔진이 스텝을 직접 돌리지 않는다", async () => {
    const store = new InMemoryStore();
    const bus = new InProcessMissionEventBus();
    const orch = makeOrch();
    const conductor = stubConductor();
    const engine = new MissionEngine(
      minimalEngineDeps(store, bus, orch.registry),
      {
        driver: "orchestrator",
        conductor,
      }
    );

    const mission = await engine.launch({
      projectId: "p1",
      goal: "B mode",
      templateId: "research",
    });

    // 엔진 advance-loop 가 아니라 conductor 위임.
    expect(conductor.calls).toContain(mission.id);
    // 스텁 conductor 라 실제 진행은 없음 — 스텝은 pending, 미션은 active 유지.
    await new Promise((r) => setTimeout(r, 60));
    const m = store.raw(mission.id)!;
    expect(m.status).toBe("active");
    expect(m.steps.every((s) => s.status === "pending")).toBe(true);
    engine.dispose();
  });

  it("orchestrator 모드 onEvent 는 엔진 타임라인을 오염시키지 않는다(이중 처리 없음)", async () => {
    const store = new InMemoryStore();
    const bus = new InProcessMissionEventBus();
    const orch = makeOrch();
    const conductor = stubConductor();
    const engine = new MissionEngine(
      minimalEngineDeps(store, bus, orch.registry),
      {
        driver: "orchestrator",
        conductor,
      }
    );
    const id = await store.createMission({
      projectId: "p1",
      goal: "B mode",
      templateId: "research",
      status: "active",
      ownerOrchestratorSessionId: "sess-1",
      steps: instantiateSteps("research"),
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [],
    });
    const before = store.raw(id)!.contextLog.length;
    bus.emit({
      type: "task.status_changed",
      missionId: id,
      payload: { taskId: "t1", to: "DONE" },
    });
    await new Promise((r) => setTimeout(r, 60));
    // 엔진은 orchestrator 모드에서 onEvent no-op — append 하지 않는다.
    expect(store.raw(id)!.contextLog.length).toBe(before);
    engine.dispose();
  });
});
