import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InProcessMissionEventBus,
  createConductorDriver,
} from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  MissionStepFailurePolicy,
  MissionStepType,
  TimelineEvent,
} from "../../electron/mission-engine/types";
import type {
  MissionEngineEvent,
  MissionNotifier,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  TaskStatusLite,
  VerifyStepGate,
} from "../../electron/mission-engine/ports";

// ────────────────────────────────────────────────────────────────────────────
// B안 Phase 4-C — 타임라인 *합성*(timeline synthesis) 단위테스트.
//
// 버스 task 이벤트(task.status_changed / task.activity_logged) → 지휘자(Conductor)
// onEvent → mission.contextLog 에 TimelineEvent append + key 기반 dedup 경로를 고정한다.
//
// ★계약 (P4-A 엔진 동작 — 이 워크트리엔 아직 미반영일 수 있음):
//   - 버스 'task.status_changed'  payload = { taskId, from, to, taskTitle }
//   - 버스 'task.activity_logged' payload = { taskId, message, agentId, taskTitle,
//                                             activityAtMillis }
//   - 지휘자가 contextLog 에 append:
//       type 'task.status'   payload { taskId, from, to, taskTitle,
//                                      key: `task.status:${taskId}:${to}` }
//       type 'task.activity' payload { taskId, message, agentId, taskTitle,
//                                      activityAtMillis,
//                                      key: `task.activity:${taskId}:${activityAtMillis}` }
//   - dedup = payload.key 가 동일하면 skip (재emit 무시).
//
// 통합 주의: origin/main(940b8b6) conductor onEvent 은 wait-게이트 wakeup 만 하고
// 위 합성 로직은 아직 없다(P4-A 미머지). 따라서 합성 단정(it 1~4 + it 5 의 합성 부분)은
// P4-A 통합 전까지 **계약대로 실패**할 수 있다 — 그건 정상이며 오케가 P4-A 시그니처에
// 맞춰 최종 정합한다. 단, 하니스/문법 오류로 인한 실패는 없어야 하고(아래 하니스는
// mission-b-e2e.test.ts 와 동일 패턴), 기존 미션 테스트엔 영향이 없다(신규 파일만 추가).
//
// 큐 직렬화(enqueue) 보장: 지휘자는 버스 이벤트를 미션별로 직렬 처리하므로,
// "나중 이벤트가 처리됐다"는 사실은 "그 앞 이벤트도 이미 처리됐다"를 함의한다.
// dedup 단정은 이 성질을 이용해(센티넬 이벤트로 큐를 밀어) flush 타이밍에 의존하지 않는다.
// ────────────────────────────────────────────────────────────────────────────

// ──────────────────────────── fakes (e2e 하니스 재사용) ────────────────────────────

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

function makeOrch(opts?: { alive?: boolean }): {
  registry: OrchestratorRegistry;
  postMessage: ReturnType<typeof vi.fn>;
  posts: string[];
} {
  const posts: string[] = [];
  const alive = opts?.alive ?? true;
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
  return { registry, postMessage, posts };
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
  opts: { verifyStepGate?: VerifyStepGate; maxRetries?: number } = {},
): Harness {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const orch = makeOrch({ alive: true });
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

// ──────────────────────────── 합성 전용 헬퍼 ────────────────────────────

// P4-A 통합 전엔 합성 항목이 생기지 않으므로 합성-존재 단정은 이 timeout 으로
// "계약대로 실패"한다(지휘자 처리 자체는 인메모리라 수 ms — 통과 시엔 즉시 반환).
const SYNTH_TIMEOUT = 1000;

/** 버스 이벤트 빌더. type 을 string 으로 받아(리터럴-유니온 overlap 캐스트 회피),
 *  아직 MissionEngineEventType 에 없는 'task.activity_logged' 도 안전하게 emit 한다. */
function busEvent(
  type: string,
  missionId: string,
  payload: Record<string, unknown>,
): MissionEngineEvent {
  return { type: type as MissionEngineEvent["type"], missionId, payload };
}

function emitStatusChanged(
  bus: InProcessMissionEventBus,
  missionId: string,
  args: { taskId: string; from: string; to: string; taskTitle?: string },
): void {
  bus.emit(busEvent("task.status_changed", missionId, { ...args }));
}

function emitActivityLogged(
  bus: InProcessMissionEventBus,
  missionId: string,
  args: {
    taskId: string;
    message: string;
    agentId?: string;
    taskTitle?: string;
    activityAtMillis: number;
  },
): void {
  bus.emit(busEvent("task.activity_logged", missionId, { ...args }));
}

/** type 별 합성 타임라인 항목. ('task.status'/'task.activity' 는 P4-A 가 추가하는
 *  TimelineEventType 이라, 현재 유니온과의 비교 overlap 을 피하려 string 캐스트.) */
function synthEntries(
  m: Mission,
  type: "task.status" | "task.activity",
): TimelineEvent[] {
  return m.contextLog.filter((e) => (e.type as string) === type);
}

/** status + activity 합성 항목 전체 — contextLog 순서 보존. */
function allSynthEntries(m: Mission): TimelineEvent[] {
  return m.contextLog.filter(
    (e) =>
      (e.type as string) === "task.status" ||
      (e.type as string) === "task.activity",
  );
}

function keyOf(e: TimelineEvent): string {
  return String((e.payload as { key?: unknown }).key);
}

function keyCount(m: Mission, key: string): number {
  return allSynthEntries(m).filter((e) => keyOf(e) === key).length;
}

/** it 1~4 공용: 미션 active + gstack 스텝 running 으로 만들어 합성 경로만 격리한다.
 *  (wait 가 아니면 onEvent 가 게이트/advance 를 건드리지 않으므로 합성만 관찰된다.) */
async function runningGstackMission(): Promise<{ h: Harness; id: string }> {
  const h = buildHarness();
  const id = await makeMission(h.store, [
    step(0, "gstack", { skill: "/review" }),
  ]);
  h.conductor.requestAdvance(id);
  await waitFor(() => h.store.raw(id).steps[0].status === "running");
  return { h, id };
}

// firebase mock 은 파일 간 state 를 공유하므로 리셋(다른 스위트와의 격리) — e2e 와 동일 위생.
beforeEach(async () => {
  const mocks = (await import("../mocks/firebase-firestore")) as unknown as {
    __resetStore?: () => void;
  };
  mocks.__resetStore?.();
});

// ════════════════════════ 1) status 합성 ════════════════════════

describe("B안 P4-C — task.status_changed → contextLog 'task.status' 합성", () => {
  it("버스 status 이벤트를 type 'task.status' + key=`task.status:${taskId}:${to}` 단일 항목으로 합성한다", async () => {
    const { h, id } = await runningGstackMission();

    emitStatusChanged(h.bus, id, {
      taskId: "t1",
      from: "IN_PROGRESS",
      to: "DONE",
      taskTitle: "Build X",
    });

    await waitFor(
      () => synthEntries(h.store.raw(id), "task.status").length === 1,
      SYNTH_TIMEOUT,
    );
    const e = synthEntries(h.store.raw(id), "task.status")[0];
    expect(keyOf(e)).toBe("task.status:t1:DONE");
    expect(e.payload).toMatchObject({
      taskId: "t1",
      from: "IN_PROGRESS",
      to: "DONE",
      taskTitle: "Build X",
    });
    expect(e.ts).toBeInstanceOf(Date);
  });

  it("동일 status 이벤트를 재emit 해도 같은 key 는 한 번만 합성된다(dedup)", async () => {
    const { h, id } = await runningGstackMission();

    emitStatusChanged(h.bus, id, {
      taskId: "t1",
      from: "IN_PROGRESS",
      to: "DONE",
      taskTitle: "Build X",
    });
    await waitFor(
      () => keyCount(h.store.raw(id), "task.status:t1:DONE") === 1,
      SYNTH_TIMEOUT,
    );

    // 정확히 동일한 이벤트(같은 key) 재emit → skip 되어야 한다.
    emitStatusChanged(h.bus, id, {
      taskId: "t1",
      from: "IN_PROGRESS",
      to: "DONE",
      taskTitle: "Build X",
    });
    // 센티넬(다른 key) — 큐가 직렬화되므로 이게 처리됐으면 위 dup 도 이미 처리됨.
    emitStatusChanged(h.bus, id, {
      taskId: "t1",
      from: "DONE",
      to: "REVIEW",
      taskTitle: "Build X",
    });
    await waitFor(
      () => keyCount(h.store.raw(id), "task.status:t1:REVIEW") === 1,
      SYNTH_TIMEOUT,
    );

    expect(keyCount(h.store.raw(id), "task.status:t1:DONE")).toBe(1); // dup 미추가.
    expect(synthEntries(h.store.raw(id), "task.status")).toHaveLength(2); // DONE + REVIEW 뿐.
  });
});

// ════════════════════════ 2) activity 합성 + dedup ════════════════════════

describe("B안 P4-C — task.activity_logged → contextLog 'task.activity' 합성", () => {
  it("버스 activity 이벤트를 type 'task.activity' + key=`task.activity:${taskId}:${activityAtMillis}` 로 합성하고 동일 key 는 dedup 한다", async () => {
    const { h, id } = await runningGstackMission();

    emitActivityLogged(h.bus, id, {
      taskId: "t1",
      message: "작업 시작",
      agentId: "a1",
      taskTitle: "Build X",
      activityAtMillis: 1000,
    });
    await waitFor(
      () => synthEntries(h.store.raw(id), "task.activity").length === 1,
      SYNTH_TIMEOUT,
    );
    const e = synthEntries(h.store.raw(id), "task.activity")[0];
    expect(keyOf(e)).toBe("task.activity:t1:1000");
    expect(e.payload).toMatchObject({
      taskId: "t1",
      message: "작업 시작",
      agentId: "a1",
      taskTitle: "Build X",
      activityAtMillis: 1000,
    });

    // 같은 activityAtMillis(=같은 key) 재emit → skip.
    emitActivityLogged(h.bus, id, {
      taskId: "t1",
      message: "작업 시작",
      agentId: "a1",
      taskTitle: "Build X",
      activityAtMillis: 1000,
    });
    // 센티넬(다른 activityAtMillis) — 직렬 큐를 밀어 dup 처리 완료를 보장.
    emitActivityLogged(h.bus, id, {
      taskId: "t1",
      message: "두번째 활동",
      agentId: "a1",
      taskTitle: "Build X",
      activityAtMillis: 2000,
    });
    await waitFor(
      () => keyCount(h.store.raw(id), "task.activity:t1:2000") === 1,
      SYNTH_TIMEOUT,
    );

    expect(keyCount(h.store.raw(id), "task.activity:t1:1000")).toBe(1); // dup 미추가.
    expect(synthEntries(h.store.raw(id), "task.activity")).toHaveLength(2);
  });
});

// ════════════════════════ 3) status + activity 혼합 시간순 누적 ════════════════════════

describe("B안 P4-C — status·activity 혼합 시간순 누적", () => {
  it("여러 이벤트를 섞어 보내면 보낸 순서대로 contextLog 에 누적된다", async () => {
    const { h, id } = await runningGstackMission();

    emitStatusChanged(h.bus, id, {
      taskId: "t1",
      from: "TODO",
      to: "IN_PROGRESS",
      taskTitle: "Build X",
    });
    emitActivityLogged(h.bus, id, {
      taskId: "t1",
      message: "코딩 중",
      agentId: "a1",
      taskTitle: "Build X",
      activityAtMillis: 1000,
    });
    emitStatusChanged(h.bus, id, {
      taskId: "t1",
      from: "IN_PROGRESS",
      to: "DONE",
      taskTitle: "Build X",
    });
    emitActivityLogged(h.bus, id, {
      taskId: "t2",
      message: "리뷰 시작",
      agentId: "a2",
      taskTitle: "Review Y",
      activityAtMillis: 1500,
    });

    await waitFor(
      () => allSynthEntries(h.store.raw(id)).length === 4,
      SYNTH_TIMEOUT,
    );
    const keys = allSynthEntries(h.store.raw(id)).map(keyOf);
    expect(keys).toEqual([
      "task.status:t1:IN_PROGRESS",
      "task.activity:t1:1000",
      "task.status:t1:DONE",
      "task.activity:t2:1500",
    ]);
  });
});

// ════════════════════════ 4) wait 스텝: 합성 + 게이트 통과 advance ════════════════════════

describe("B안 P4-C — wait 스텝에서 task DONE 이벤트: 합성 append + 게이트 통과 advance", () => {
  it("마지막 task 가 DONE 되면(미션 taskIds 전부 DONE) status 합성과 wait 게이트 통과 advance 가 함께 일어난다", async () => {
    const steps = [
      step(0, "wait", { onFailure: "retry" }),
      step(1, "gstack", { skill: "/ship", onFailure: "escalate" }),
    ];
    const h = buildHarness(); // 내장 기본 게이트: wait = taskIds 전부 DONE.
    const id = await makeMission(h.store, steps, { taskIds: ["t1", "t2"] });
    h.taskStatuses.t1 = "DONE";
    h.taskStatuses.t2 = "IN_PROGRESS"; // 아직 미완료 → wait 게이트 보류(running 유지).

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    expect(h.store.raw(id).currentStepIndex).toBe(0);

    // 마지막 task 완료 → 버스 status 이벤트 wakeup.
    h.taskStatuses.t2 = "DONE";
    emitStatusChanged(h.bus, id, {
      taskId: "t2",
      from: "IN_PROGRESS",
      to: "DONE",
      taskTitle: "Task 2",
    });

    // (1) 게이트 통과 advance — 다음 스텝(1)이 grant 되어 running.
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).steps[0].status).toBe("success");
    expect(h.store.raw(id).currentStepIndex).toBe(1);

    // (2) 합성 — 그 wakeup 이벤트가 timeline 에 task.status 단일 항목으로 남는다.
    expect(keyCount(h.store.raw(id), "task.status:t2:DONE")).toBe(1);
  });
});
