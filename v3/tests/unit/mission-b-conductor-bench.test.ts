import { beforeEach, describe, expect, it } from "vitest";
import {
  InProcessMissionEventBus,
  MISSION_STEP_REPORTED_EVENT,
  createConductorDriver,
  instantiateSteps,
} from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
  TimelineEventType,
} from "../../electron/mission-engine/types";
import type {
  MissionEngineEvent,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// ────────────────────────────────────────────────────────────────────────────
// B안 Phase 5-B — 지휘자(Conductor) 운전 사이클 *벤치*.  설계: §8-6 / §11.
//
// 목적: 지휘자 풀 루프(grant→report→gate→advance)의 오버헤드가 회귀로 늘지 않음을
//       **LLM 없이 결정적으로** 보장한다. 실제 토큰 비용은 단위테스트로 측정 불가
//       하므로(실 LLM 세션 필요), 여긴 (a) 정확성(전부 completed + 스텝 순서 보존)을
//       엄격히 단정하고, (b) 타이밍은 informational 로그 + **관대한** 스모크 실링
//       으로만 본다. 타이트한 perf 게이트는 CI flaky 의 원인이라 두지 않는다.
//
//   - 라이브 토큰/지연 벤치(실 오케 세션) 절차는 §11-(b) 문서를 따른다.
//   - mission-b-e2e(Phase3 풀루프) 와의 분담: 거긴 타입혼합·게이트분기·견고성을
//     소수 미션으로 검증한다. 여긴 full-feature(10스텝) 미션을 *다량*(N) 으로 끝까지
//     돌려 운전 사이클의 누적 오버헤드/회귀를 본다.
//
// 결정성: 랜덤/실시간 의존 없음. Date.now 는 (1) waitFor 데드라인, (2) 타이밍 로그,
//         (3) **관대한** 스모크 단정에만 쓴다(정확성 단정엔 일절 쓰지 않음).
//
// 연동은 conductor-driver.ts 실제 export 계약으로만(mission-b-e2e 와 동일):
//   - createConductorDriver(deps) => ConductorDriver
//   - 보고 채널: eventBus 'mission.step_reported' { stepIndex, result:{status,output?} }
//   - 내장 defaultStepGate 폴백(verifyStepGate 미주입): gstack(비-/ship)=항상 통과,
//     /ship=PR URL 필요, dispatch/wait=mission.taskIds 전부 DONE.
// ────────────────────────────────────────────────────────────────────────────

// full-feature 템플릿의 스텝 인덱스(가독성용 — templates.ts §5 와 정합).
//   0:/office-hours 1:/plan-ceo 2:/plan-eng 3:/plan-design 4:dispatch 5:wait
//   6:/review 7:/qa 8:/design-review 9:/ship
const FULL_FEATURE_STEP_COUNT = 10;

// 벤치 규모 — full-feature 미션 개수. 작게 잡아도 N*10 스텝을 끝까지 돌린다.
// (50미션 = 500스텝 = 450 success 보고). 더 키우려면 이 상수만 올리면 된다.
const BENCH_MISSIONS = 50;

// ──────────────────────────── fakes (mission-b-e2e 패턴 재사용) ────────────────

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

/** 오케스트레이터 PTY 세션 fake — 항상 alive, grant 메시지를 posts 로 수집. */
function makeOrch(): { registry: OrchestratorRegistry; posts: string[] } {
  const posts: string[] = [];
  const ref: OrchestratorRef = {
    sessionId: "sess-1",
    ptySessionId: "pty-1",
    isAlive: () => true,
    postMessage: async (m: string) => {
      posts.push(m);
    },
  };
  const registry: OrchestratorRegistry = {
    async ensureSession() {
      return ref;
    },
    getSession: (sid) => (sid === "sess-1" ? ref : null),
  };
  return { registry, posts };
}

interface Harness {
  store: InMemoryStore;
  bus: InProcessMissionEventBus;
  conductor: ConductorDriver;
  taskStatuses: Record<string, TaskStatusLite>;
  posts: string[];
}

function buildHarness(): Harness {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const orch = makeOrch();
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
    logger: () => {},
  });
  return { store, bus, conductor, taskStatuses, posts: orch.posts };
}

/** full-feature(10스텝) 미션 생성 + 그 미션의 dispatch task 를 DONE 으로 등록. */
async function makeFullFeatureMission(
  h: Harness,
  index: number,
): Promise<string> {
  const taskId = `bench-task-${index}`;
  const id = await h.store.createMission({
    projectId: "p1",
    goal: `ship full feature #${index}`,
    templateId: "full-feature",
    status: "active",
    ownerOrchestratorSessionId: "sess-1",
    steps: instantiateSteps("full-feature"),
    currentStepIndex: 0,
    // dispatch/wait 게이트(내장)가 "전부 DONE" 으로 통과하도록 미리 DONE 등록.
    taskIds: [taskId],
    contextLog: [],
  });
  h.taskStatuses[taskId] = "DONE";
  return id;
}

/** 실제 보고 채널(eventBus 'mission.step_reported')을 통한 스텝완료 보고 emit. */
function emitReport(
  bus: InProcessMissionEventBus,
  missionId: string,
  stepIndex: number,
  output: string,
): void {
  const event: MissionEngineEvent = {
    type: MISSION_STEP_REPORTED_EVENT as MissionEngineEvent["type"],
    missionId,
    payload: {
      stepIndex,
      result: { status: "success", output },
    },
  };
  bus.emit(event);
}

function timelineCount(m: Mission, type: TimelineEventType): number {
  return m.contextLog.filter((e) => e.type === type).length;
}

/** step.started 타임라인의 스텝 인덱스 시퀀스 — 순서 보존 검증용. */
function startedIndices(m: Mission): number[] {
  return m.contextLog
    .filter((e) => e.type === "step.started")
    .map((e) => (e.payload as { index: number }).index);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

/**
 * 한 미션을 지휘자로 completed 까지 결정적으로 구동한다.
 *   - 현재 running 인 gstack/dispatch 스텝마다 success 보고를 emit (ship 은 PR URL 포함).
 *   - wait 스텝은 grant 시점에 내장 게이트(task 전부 DONE)로 자동 통과하므로 보고하지
 *     않는다 — 관측되면 잠깐 기다렸다 다음 스텝으로 넘어간다.
 *   - 보고 후 currentStepIndex 가 전진(또는 completed)할 때까지 대기.
 * 어떤 스텝타입이 와도(템플릿이 바뀌어도) 동작하도록 현재 상태 기반으로 운전한다.
 */
async function driveToCompletion(h: Harness, id: string): Promise<void> {
  h.conductor.requestAdvance(id);
  // 안전 가드: full-feature 는 9회 보고면 끝. 여유 있게 상한을 둔다(무한루프 방지).
  for (let guard = 0; guard < 64; guard++) {
    await waitFor(() => {
      const m = h.store.raw(id);
      if (m.status === "completed") return true;
      return m.steps[m.currentStepIndex]?.status === "running";
    });
    const m = h.store.raw(id);
    if (m.status === "completed") return;
    const idx = m.currentStepIndex;
    const step = m.steps[idx];
    // wait 스텝은 지휘자가 폴링·자동전진 — 보고 불필요. 잠깐 비우고 다음 루프에서 재평가.
    if (step.type === "wait") {
      await flush();
      continue;
    }
    const isShip = step.type === "gstack" && step.skill === "/ship";
    const output = isShip
      ? "shipped: https://github.com/acme/repo/pull/1"
      : `step ${idx} ok`;
    emitReport(h.bus, id, idx, output);
    await waitFor(() => {
      const mm = h.store.raw(id);
      return mm.status === "completed" || mm.currentStepIndex > idx;
    });
  }
  throw new Error(`driveToCompletion(${id}) exceeded guard without completing`);
}

/** 완주 미션의 정확성 불변식 — 전부 success + 순서 보존 + 타임라인 카운트. */
function assertCompletedFullFeature(m: Mission): void {
  expect(m.status).toBe("completed");
  expect(m.completedAt).toBeInstanceOf(Date);
  // 스텝 순서 보존: 마지막 스텝까지 정확히 소진.
  expect(m.steps.length).toBe(FULL_FEATURE_STEP_COUNT);
  expect(m.currentStepIndex).toBe(m.steps.length);
  expect(m.steps.every((s) => s.status === "success")).toBe(true);
  // grant(step.started)/완료(step.completed) 각 10회, 인덱스 0..9 오름차순(재시도 없음).
  expect(startedIndices(m)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(timelineCount(m, "step.completed")).toBe(FULL_FEATURE_STEP_COUNT);
  // 모든 운전 타임라인은 driver=orchestrator (A안 engine 경로와 구분).
  expect(
    m.contextLog
      .filter((e) => e.type === "step.started" || e.type === "step.completed")
      .every(
        (e) => (e.payload as { driver?: string }).driver === "orchestrator",
      ),
  ).toBe(true);
}

// firebase mock 은 파일 간 state 를 공유하므로 리셋(다른 스위트와의 격리) — e2e 와 동일.
// 본 스위트의 store 는 in-memory fake 라 직접 의존은 없지만, index 배럴이 끌어오는
// 모듈들의 잔여 state 가 새지 않도록 동일 위생 절차를 따른다.
beforeEach(async () => {
  const mocks = (await import("../mocks/firebase-firestore")) as unknown as {
    __resetStore?: () => void;
  };
  mocks.__resetStore?.();
});

// ════════════════════════════ 1) 단일 미션 정확성 ════════════════════════════

describe("B안 벤치 — full-feature(10스텝) 단일 미션을 지휘자로 completed 까지 구동", () => {
  it("스텝 순서가 보존되고 전부 success 로 마감한다", async () => {
    const h = buildHarness();
    const id = await makeFullFeatureMission(h, 0);

    await driveToCompletion(h, id);

    assertCompletedFullFeature(h.store.raw(id));
  });
});

// ════════════════════════════ 2) N미션 누적 벤치 ═════════════════════════════

describe("B안 벤치 — full-feature N미션 지휘자 풀루프 (정확성 + 관대한 스모크 실링)", () => {
  it(`${BENCH_MISSIONS}개 미션을 전부 completed 로 구동하고 운전 오버헤드를 로깅한다`, async () => {
    const h = buildHarness();
    const ids: string[] = [];
    for (let i = 0; i < BENCH_MISSIONS; i++) {
      ids.push(await makeFullFeatureMission(h, i));
    }

    // 동시 구동 — 단일 지휘자가 N미션을 미션별 직렬화로 운전(production 형태에 가까움).
    const startedAt = Date.now();
    await Promise.all(ids.map((id) => driveToCompletion(h, id)));
    const elapsedMs = Date.now() - startedAt;

    // ── 정확성(엄격): 전부 completed + 스텝 순서/상태 보존 ──
    for (const id of ids) {
      assertCompletedFullFeature(h.store.raw(id));
    }

    // ── 타이밍(informational): 절대 단정 기준 아님. 회귀 추적용 로그. ──
    const perMissionMs = elapsedMs / BENCH_MISSIONS;
    const perStepMs = elapsedMs / (BENCH_MISSIONS * FULL_FEATURE_STEP_COUNT);
    console.log(
      `[conductor-bench] full-feature ×${BENCH_MISSIONS} → 총 ${elapsedMs}ms · ` +
        `미션당(동시구동 amortized) ${perMissionMs.toFixed(2)}ms · ` +
        `스텝당 ${perStepMs.toFixed(2)}ms`,
    );

    // ── 관대한 스모크 실링: 미션당 400ms 예산(실측은 보통 한 자릿수 ms). ──
    // 타이트 perf 게이트가 아니라, 운전 루프가 O(n²)/블로킹으로 무너지는 catastrophic
    // 회귀만 잡는 안전망이다(§11). CI flaky 방지를 위해 의도적으로 느슨하게 둔다.
    const SMOKE_CEILING_MS = BENCH_MISSIONS * 400;
    expect(elapsedMs).toBeLessThan(SMOKE_CEILING_MS);
  });
});
