import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InProcessMissionEventBus,
  createConductorDriver,
  MISSION_STEP_REPORTED_EVENT,
} from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  MissionStepFailurePolicy,
  MissionStepType,
  TimelineEvent,
  TimelineEventType,
} from "../../electron/mission-engine/types";
import type {
  MissionEngineEvent,
  MissionNotifier,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  StepReport,
  TaskStatusLite,
  VerifyStepGate,
} from "../../electron/mission-engine/ports";

// ────────────────────────────────────────────────────────────────────────────
// B안 Phase 3 — orchestrator-driven 미션 Conductor *풀 루프* e2e 통합 테스트.
//
// MISSION_DRIVER=orchestrator 모드에서 Conductor 가 운전하는 전 구간을
// in-memory fake 로 end-to-end 검증한다:
//   미션 시작(requestAdvance) → grantStep(오케 PTY 로 grant 메시지 주입, spy 확인)
//   → eventBus 'mission.step_reported'{stepIndex,result} emit → onStepReport
//   → 게이트 검증 pass → 다음 스텝 grant → … → 마지막 스텝 후 completeMission.
//   + 게이트 fail → retry 재허가 / escalate(waiting_for_human),
//   + wait 스텝 → getTaskStatuses 일부 미완료=보류 / 전부 DONE=advance.
//
// ★Phase2 unit(mission-conductor.test.ts)과의 분담:
//   거긴 grant 문구("현재 스텝 0", "/office-hours", "mission_step_done")를
//   하드코딩 검증한다. 여긴 P3-A 가 grantStep 을 step-type 별 문구로 바꾸는 중이라
//   '타입 무관 풀 루프 동작'에만 집중한다. 따라서 루프 전진은 store 상태 +
//   step.started/step.completed 타임라인(grantStep 이 postMessage best-effort *이전*
//   에 항상 기록 → 타입/문구와 무관한 grant 카운터)으로 검증하고, postMessage spy 는
//   "grant 메시지(비어있지 않은 문자열)가 PTY 로 주입됐다"는 사실 확인까지만 쓴다.
//   (postMessage 총 호출수는 grant + completeMission/escalate 알림이 섞여 있으니
//    grant 카운터로 쓰지 않는다.)
//
// 연동은 conductor-driver.ts 의 실제 export 계약으로만:
//   - createConductorDriver(deps) => ConductorDriver
//   - 보고 채널: eventBus 'mission.step_reported'
//       payload { stepIndex, result: { status:'success'|'failed', output?, error? } }
//   - 게이트:   verifyStepGate(step, { getTaskStatuses, mission }) => { pass, reason? }
//             (미주입 시 conductor 내장 defaultStepGate 폴백)
// ────────────────────────────────────────────────────────────────────────────

// ──────────────────────────── fakes ────────────────────────────

class InMemoryStore implements MissionStore {
  private docs = new Map<string, Mission>();
  private nextId = 1;

  async getMission(id: string): Promise<Mission | null> {
    const m = this.docs.get(id);
    // 방어적 복제 — conductor 가 받은 스냅샷을 변형해도 진실원이 오염되지 않게.
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
  }
  async updateMissionStep(
    id: string,
    stepIndex: number,
    patch: Partial<MissionStep>,
  ): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`Mission ${id} not found`);
    if (stepIndex < 0 || stepIndex >= cur.steps.length) {
      throw new Error("step index out of bounds");
    }
    cur.steps[stepIndex] = { ...cur.steps[stepIndex], ...patch };
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
  }
  /** 테스트 검사용 — 진실원 직접 읽기. */
  raw(id: string): Mission {
    const m = this.docs.get(id);
    if (!m) throw new Error(`Mission ${id} not found`);
    return m;
  }
}

/**
 * 오케스트레이터 PTY 세션 fake. postMessage 는 vi.fn() spy 로 노출 —
 * grant 메시지 주입을 호출/인자로 확인할 수 있게 한다.
 */
function makeOrch(opts?: { alive?: boolean }): {
  registry: OrchestratorRegistry;
  postMessage: ReturnType<typeof vi.fn>;
  posts: string[];
  setAlive: (v: boolean) => void;
} {
  const posts: string[] = [];
  let alive = opts?.alive ?? true;
  const postMessage = vi.fn(async (m: string) => {
    posts.push(m);
  });
  const ref: OrchestratorRef = {
    sessionId: "sess-1",
    ptySessionId: "pty-1",
    isAlive: () => alive,
    postMessage,
  };
  const registry: OrchestratorRegistry = {
    async ensureSession() {
      return ref;
    },
    getSession: (sid) => (sid === "sess-1" ? ref : null),
  };
  return { registry, postMessage, posts, setAlive: (v) => (alive = v) };
}

interface Harness {
  store: InMemoryStore;
  bus: InProcessMissionEventBus;
  conductor: ConductorDriver;
  postMessage: ReturnType<typeof vi.fn>;
  posts: string[];
  taskStatuses: Record<string, TaskStatusLite>;
  notices: Array<{ kind: string; missionId: string }>;
}

function buildHarness(
  opts: {
    verifyStepGate?: VerifyStepGate;
    maxRetries?: number;
    orchAlive?: boolean;
  } = {},
): Harness {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const orch = makeOrch({ alive: opts.orchAlive ?? true });
  const taskStatuses: Record<string, TaskStatusLite> = {};
  const notices: Array<{ kind: string; missionId: string }> = [];
  const notifier: MissionNotifier = (n) =>
    notices.push({ kind: n.kind, missionId: n.missionId });
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
    notifier,
    verifyStepGate: opts.verifyStepGate,
    logger: () => {},
  });
  return {
    store,
    bus,
    conductor,
    postMessage: orch.postMessage,
    posts: orch.posts,
    taskStatuses,
    notices,
  };
}

function step(
  index: number,
  type: MissionStepType,
  extra: { skill?: string; onFailure?: MissionStepFailurePolicy } = {},
): MissionStep {
  return {
    index,
    type,
    skill: extra.skill,
    onFailure: extra.onFailure,
    status: "pending",
    retryCount: 0,
  };
}

async function makeMission(
  store: InMemoryStore,
  steps: MissionStep[],
  opts: { taskIds?: string[]; goal?: string } = {},
): Promise<string> {
  return store.createMission({
    projectId: "p1",
    goal: opts.goal ?? "ship the thing",
    templateId: "feature",
    status: "active",
    ownerOrchestratorSessionId: "sess-1",
    steps,
    currentStepIndex: 0,
    taskIds: opts.taskIds ?? [],
    contextLog: [],
  });
}

/** 실제 보고 채널(eventBus 'mission.step_reported')을 통한 스텝완료 보고 emit. */
function emitReport(
  bus: InProcessMissionEventBus,
  missionId: string,
  stepIndex: number,
  status: "success" | "failed",
  extra: { output?: unknown; error?: string } = {},
): void {
  const event: MissionEngineEvent = {
    type: MISSION_STEP_REPORTED_EVENT as MissionEngineEvent["type"],
    missionId,
    payload: {
      stepIndex,
      result: { status, output: extra.output, error: extra.error },
    },
  };
  bus.emit(event);
}

/** 타임라인 이벤트 개수 — grant(step.started)/완료(step.completed) 카운트용. */
function timelineCount(m: Mission, type: TimelineEventType): number {
  return m.contextLog.filter((e) => e.type === type).length;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** conductor 가 미션별 작업을 직렬화(enqueue)하므로, 짧게 비워 race 안정화. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 40));
}

// firebase mock 은 파일 간 state 를 공유하므로 리셋(다른 스위트와의 격리).
// 본 스위트의 store 는 in-memory fake 라 직접 의존은 없지만, index 배럴이 끌어오는
// 모듈들의 잔여 state 가 다른 스위트로 새지 않도록 동일 위생 절차를 따른다.
beforeEach(async () => {
  const mocks = (await import("../mocks/firebase-firestore")) as unknown as {
    __resetStore?: () => void;
  };
  mocks.__resetStore?.();
});

// ════════════════════════════ 1) 풀 루프 (타입 혼합) ════════════════════════

describe("B안 e2e — orchestrator-driven 풀 루프 (grant→report→gate→advance→complete)", () => {
  it("타입 혼합 5스텝 미션을 보고 이벤트만으로 끝까지 운전해 completed 로 마감한다", async () => {
    // gstack → dispatch → wait → gstack(/review) → gstack(/ship): 4개 타입이 섞인
    // 미션을 내장 기본 게이트로 끝까지 돌린다. 풀 루프가 타입에 무관하게 도는지 확인.
    const steps = [
      step(0, "gstack", { skill: "/plan-eng-review" }),
      step(1, "dispatch"),
      step(2, "wait"),
      step(3, "gstack", { skill: "/review", onFailure: "retry" }),
      step(4, "gstack", { skill: "/ship", onFailure: "escalate" }),
    ];
    const h = buildHarness();
    const id = await makeMission(h.store, steps, { taskIds: ["t1", "t2"] });
    // wait 게이트(내장)가 통과하도록 task 는 전부 DONE.
    h.taskStatuses.t1 = "DONE";
    h.taskStatuses.t2 = "DONE";

    // ── 미션 시작 → 스텝 0 grant ──
    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    // grant 메시지가 PTY 로 주입됐다는 사실만 확인(문구는 P3-A 가 타입별로 바꾸므로 비단정).
    expect(h.postMessage).toHaveBeenCalled();
    expect(typeof h.posts[0]).toBe("string");
    expect(h.posts[0].length).toBeGreaterThan(0);

    // ── 스텝 0→1→2→3 을 success 보고로 순차 전진 (전진은 store 상태로 검증) ──
    for (let i = 0; i < 4; i++) {
      emitReport(h.bus, id, i, "success", { output: `step ${i} output` });
      await waitFor(() => h.store.raw(id).steps[i + 1].status === "running");
      const m = h.store.raw(id);
      expect(m.steps[i].status).toBe("success");
      expect(m.currentStepIndex).toBe(i + 1);
    }

    // ── 마지막 스텝(4, /ship): 내장 게이트가 PR URL 을 요구 → URL 포함 output 보고 ──
    emitReport(h.bus, id, 4, "success", {
      output: "shipped: https://github.com/acme/repo/pull/42",
    });
    await waitFor(() => h.store.raw(id).status === "completed");

    const m = h.store.raw(id);
    expect(m.status).toBe("completed");
    expect(m.completedAt).toBeInstanceOf(Date);
    expect(m.steps.every((s) => s.status === "success")).toBe(true);
    expect(m.currentStepIndex).toBe(5);
    // 5스텝 = grant(step.started) 5회 + 완료(step.completed) 5회 — 타입/문구 무관 카운터.
    expect(timelineCount(m, "step.started")).toBe(5);
    expect(timelineCount(m, "step.completed")).toBe(5);
    // 모든 운전 타임라인은 driver=orchestrator (A안 engine 경로와 구분).
    expect(
      m.contextLog
        .filter((e) => e.type === "step.started" || e.type === "step.completed")
        .every(
          (e) => (e.payload as { driver?: string }).driver === "orchestrator",
        ),
    ).toBe(true);
    // 완료 supervisor.note 마커.
    expect(
      m.contextLog.some(
        (e) =>
          e.type === "supervisor.note" &&
          String((e.payload as { message?: string }).message).includes(
            "completed",
          ),
      ),
    ).toBe(true);
  });

  it("스텝 사이에만 게이트가 걸린다 — 보고 전엔 다음 스텝을 grant 하지 않는다('한 번에 하나')", async () => {
    const steps = [
      step(0, "gstack", { skill: "/plan-eng-review" }),
      step(1, "gstack", { skill: "/review", onFailure: "retry" }),
    ];
    const h = buildHarness();
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    // 아직 0 보고 전 — 스텝 1 은 pending, step.started 는 0번 스텝 하나뿐.
    await flush();
    expect(h.store.raw(id).steps[1].status).toBe("pending");
    expect(h.store.raw(id).currentStepIndex).toBe(0);
    expect(timelineCount(h.store.raw(id), "step.started")).toBe(1);

    emitReport(h.bus, id, 0, "success", { output: "plan done" });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).currentStepIndex).toBe(1);
    expect(timelineCount(h.store.raw(id), "step.started")).toBe(2);
  });
});

// ════════════════════════ 2) 게이트 주입 계약 검증 ═══════════════════════════

describe("B안 e2e — verifyStepGate 주입 계약 (step, {getTaskStatuses, mission})", () => {
  it("주입 게이트는 계약 시그니처대로 step 과 {getTaskStatuses, mission} 컨텍스트를 받는다", async () => {
    const seen: Array<{
      stepIndex: number;
      hasGetTaskStatuses: boolean;
      missionId: string;
      output: unknown;
    }> = [];
    const gate: VerifyStepGate = async (s, ctx) => {
      seen.push({
        stepIndex: s.index,
        hasGetTaskStatuses: typeof ctx.getTaskStatuses === "function",
        missionId: ctx.mission.id,
        output: s.output,
      });
      return { pass: true };
    };
    const steps = [
      step(0, "gstack", { skill: "/review", onFailure: "retry" }),
      step(1, "gstack", { skill: "/qa", onFailure: "retry" }),
    ];
    const h = buildHarness({ verifyStepGate: gate });
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    emitReport(h.bus, id, 0, "success", { output: "review ok" });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    emitReport(h.bus, id, 1, "success", { output: "qa ok" });
    await waitFor(() => h.store.raw(id).status === "completed");

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      stepIndex: 0,
      hasGetTaskStatuses: true,
      missionId: id,
      output: "review ok", // 보고 output 이 게이트 평가 전에 step.output 으로 반영됨.
    });
    expect(seen[1].stepIndex).toBe(1);
  });

  it("verifyGate() API 는 주입 게이트 결과를 GateResult{passed,reason} 로 매핑한다", async () => {
    const gate: VerifyStepGate = async () => ({ pass: false, reason: "nope" });
    const h = buildHarness({ verifyStepGate: gate });
    const id = await makeMission(h.store, [
      step(0, "gstack", { skill: "/review" }),
    ]);
    const r = await h.conductor.verifyGate(id, 0);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("nope");
  });
});

// ════════════════════════ 3) 게이트 fail → retry / escalate ══════════════════

describe("B안 e2e — 게이트 미통과 시 전진 차단 → retry 재허가 / escalate", () => {
  it("성공 보고여도 게이트가 거부하면 다음 스텝으로 넘기지 않고 같은 스텝을 재허가(retry)한다", async () => {
    let calls = 0;
    const gate: VerifyStepGate = async () => {
      calls += 1;
      // 1차 거부 → retry, 2차 통과.
      return calls === 1
        ? { pass: false, reason: "not ready" }
        : { pass: true };
    };
    const steps = [
      step(0, "gstack", { skill: "/review", onFailure: "retry" }),
      step(1, "gstack", { skill: "/qa", onFailure: "retry" }),
    ];
    const h = buildHarness({ verifyStepGate: gate });
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    // 1차 보고 → 게이트 거부 → 전진 안 함, retryCount 1, 같은 스텝 재허가(running).
    emitReport(h.bus, id, 0, "success", { output: "attempt 1" });
    await waitFor(() => (h.store.raw(id).steps[0].retryCount ?? 0) === 1);
    expect(h.store.raw(id).currentStepIndex).toBe(0);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    // 같은 스텝을 두 번 grant → step.started 2개(재허가 증거, 문구 무관).
    expect(timelineCount(h.store.raw(id), "step.started")).toBe(2);
    // gate_failed 타임라인 마커.
    expect(
      h.store
        .raw(id)
        .contextLog.some(
          (e) => (e.payload as { kind?: string }).kind === "gate_failed",
        ),
    ).toBe(true);

    // 2차 보고 → 게이트 통과 → 스텝 1 로 전진.
    emitReport(h.bus, id, 0, "success", { output: "attempt 2" });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).currentStepIndex).toBe(1);
    expect(calls).toBe(2);
  });

  it("onFailure='escalate' 스텝은 게이트 첫 거부에서 즉시 waiting_for_human + notifier(escalate)", async () => {
    const gate: VerifyStepGate = async () => ({
      pass: false,
      reason: "blocked",
    });
    const steps = [
      step(0, "gstack", { skill: "/ship", onFailure: "escalate" }),
    ];
    const h = buildHarness({ verifyStepGate: gate });
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    emitReport(h.bus, id, 0, "success", { output: "no pr" });
    await waitFor(() => h.store.raw(id).status === "waiting_for_human");

    const m = h.store.raw(id);
    expect(m.steps[0].status).toBe("failed");
    expect(m.currentStepIndex).toBe(0); // 전진하지 않음.
    expect(h.notices.at(-1)).toMatchObject({ kind: "escalate", missionId: id });
  });

  it("retry 한도 소진 후 실패 보고가 계속되면 escalate(waiting_for_human) 로 전이한다", async () => {
    const steps = [step(0, "gstack", { skill: "/review", onFailure: "retry" })];
    const h = buildHarness({ maxRetries: 2 });
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    emitReport(h.bus, id, 0, "failed", { error: "boom1" });
    await waitFor(() => (h.store.raw(id).steps[0].retryCount ?? 0) === 1);
    emitReport(h.bus, id, 0, "failed", { error: "boom2" });
    await waitFor(() => (h.store.raw(id).steps[0].retryCount ?? 0) === 2);
    emitReport(h.bus, id, 0, "failed", { error: "boom3" });
    await waitFor(() => h.store.raw(id).status === "waiting_for_human");

    const m = h.store.raw(id);
    expect(m.steps[0].status).toBe("failed");
    expect(m.steps[0].retryCount).toBe(2);
    expect(h.notices.at(-1)?.kind).toBe("escalate");
  });
});

// ════════════════════════ 4) wait 스텝 (task 완료 게이트) ════════════════════

describe("B안 e2e — wait 스텝: 내장 게이트가 task 전부 DONE 을 요구", () => {
  it("일부 task 미완료면 보류(retry), 전부 DONE 된 뒤 외부 wakeup 이벤트로 advance 한다", async () => {
    // 내장 기본 게이트 사용(주입 안 함): wait = mission.taskIds 전부 DONE.
    const steps = [step(0, "wait", { onFailure: "retry" })];
    const h = buildHarness();
    const id = await makeMission(h.store, steps, { taskIds: ["t1", "t2"] });
    h.taskStatuses.t1 = "DONE";
    h.taskStatuses.t2 = "IN_PROGRESS"; // 미완료.

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    // 오케가 success 보고해도 미완료 task 가 있어 게이트 보류 → retry(재허가).
    emitReport(h.bus, id, 0, "success");
    await waitFor(() => (h.store.raw(id).steps[0].retryCount ?? 0) === 1);
    expect(h.store.raw(id).currentStepIndex).toBe(0);
    expect(h.store.raw(id).status).toBe("active");

    // task 완료 → 외부 이벤트(agent.completed) wakeup → wait 게이트 재평가 → 통과 → 완료.
    h.taskStatuses.t2 = "DONE";
    h.bus.emit({
      type: "agent.completed",
      missionId: id,
      payload: { taskId: "t2" },
    });
    await waitFor(() => h.store.raw(id).status === "completed");
    expect(h.store.raw(id).steps[0].status).toBe("success");
  });

  it("taskIds 가 전부 DONE 이면 success 보고 한 번으로 wait 게이트를 통과해 advance 한다", async () => {
    const steps = [
      step(0, "wait", { onFailure: "retry" }),
      step(1, "gstack", { skill: "/ship", onFailure: "escalate" }),
    ];
    const h = buildHarness();
    const id = await makeMission(h.store, steps, { taskIds: ["t1"] });
    h.taskStatuses.t1 = "DONE";

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    emitReport(h.bus, id, 0, "success");
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).steps[0].status).toBe("success");
    expect(h.store.raw(id).currentStepIndex).toBe(1);
  });
});

// ════════════════════════ 5) 직접 onStepReport API + 견고성 ══════════════════

describe("B안 e2e — onStepReport 직접 호출 & 견고성", () => {
  it("타입드 StepReport 로 onStepReport 직접 호출해도 동일하게 전진한다", async () => {
    const steps = [
      step(0, "gstack", { skill: "/review" }),
      step(1, "gstack", { skill: "/qa" }),
    ];
    const h = buildHarness();
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    const report: StepReport = {
      missionId: id,
      stepIndex: 0,
      status: "success",
      output: "direct api",
    };
    await h.conductor.onStepReport(report);
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).currentStepIndex).toBe(1);
  });

  it("현재 스텝과 다른 인덱스의 보고는 무시(stale)되어 전진하지 않는다", async () => {
    const steps = [
      step(0, "gstack", { skill: "/review" }),
      step(1, "gstack", { skill: "/qa" }),
    ];
    const h = buildHarness();
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    emitReport(h.bus, id, 5, "success"); // 존재하지 않는 스텝.
    await flush();
    expect(h.store.raw(id).currentStepIndex).toBe(0);
    expect(h.store.raw(id).steps[0].status).toBe("running");
  });

  it("살아있는 owner 세션이 없으면 grant 메시지를 주입하지 않되 running 마킹은 한다(best-effort)", async () => {
    const steps = [step(0, "gstack", { skill: "/review" })];
    const h = buildHarness({ orchAlive: false });
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    expect(h.postMessage).not.toHaveBeenCalled();
    expect(h.store.raw(id).steps[0].status).toBe("running");
    // grant 시도 자체는 기록(step.started) — 주입만 best-effort 스킵.
    expect(timelineCount(h.store.raw(id), "step.started")).toBe(1);
  });

  it("dispose 후에는 버스 이벤트가 더 이상 conductor 를 깨우지 않는다", async () => {
    const steps = [
      step(0, "gstack", { skill: "/review" }),
      step(1, "gstack", { skill: "/qa" }),
    ];
    const h = buildHarness();
    const id = await makeMission(h.store, steps);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    expect(h.bus.size()).toBe(1);
    h.conductor.dispose();
    expect(h.bus.size()).toBe(0);

    emitReport(h.bus, id, 0, "success");
    await flush();
    // 구독 해제됐으므로 전진하지 않는다.
    expect(h.store.raw(id).currentStepIndex).toBe(0);
  });
});
