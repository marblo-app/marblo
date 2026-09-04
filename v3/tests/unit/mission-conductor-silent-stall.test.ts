import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InProcessMissionEventBus,
  createConductorDriver,
} from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
} from "../../electron/mission-engine/types";
import type {
  MissionNotifier,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// ────────────────────────────────────────────────────────────────────────────
// 폐루프 정지 재현 — 티켓 wUPbx6EKWSpXaUsOAI9q
//
// 진단 문서: v3/docs/mission-closed-loop-diagnosis-2026-09-04.md
//
// 사장님 관찰("미션이 태스크로 떨어지고 완료되면 다음을 이어서 분해하는 폐루프가
// 안 돈다")의 코드상 근거를 **두 갈래로 갈라서** 고정한다. 둘 다 "보고(mission_
// step_done)가 오지 않아 미션이 전진하지 않는다"는 같은 증상이지만, 관측 가능성이
// 정반대다 — 그리고 조용히 멈추는 쪽이 나쁘다:
//
//   [A] 오케 세션이 죽어 grant 가 배달되지 않은 경우 (conductor-driver.ts
//       grantStep 의 "no live owner orchestrator session" 조기 return).
//       스텝은 이미 running 으로 마킹되고 step.started 도 찍힌 뒤 return 하는데,
//       그 return 이 startReportWatch **앞**에 있다. 즉 감시 타이머가 아예 안 걸린다.
//       → nudge 도 escalate 도 영원히 없고, 타임라인에는 "시작됨"만 남는다.
//          미션은 active·running 인 채로 무한정 서 있고 화면·저널 어디에도 사유가
//          없다. 이것이 **조용한 정지**다.
//
//   [B] 오케 세션은 살아 있는데 보고만 누락된 경우.
//       → watchdog 이 nudge 를 반복하고 한도 초과 시 waiting_for_human 으로
//          escalate 하며 타임라인에 "report timeout (no mission_step_done)" 을
//          남긴다. 미션은 여전히 멈추지만 **사유가 남는 정지**다.
//
// 기존 스위트(mission-conductor.test.ts / mission-b-e2e.test.ts)는 [A] 에 대해
// "throw 하지 않고 running 마킹은 한다"까지만 단언한다 — 그 뒤로 아무 일도 일어나지
// 않는다는 사실(= 조용한 정지)은 아무도 고정하지 않았다. 이 파일이 그 공백을 메운다.
//
// ★이 테스트는 **현재 동작을 고정하는 재현 테스트**다. [A] 가 조용한 것은 버그이며
//   수정은 후속 티켓 몫이다(진단 문서 §6). 고칠 때 이 테스트가 빨간불이 되는 것이
//   의도된 신호다.
//
// 시계: vi.useFakeTimers() 로 watchdog 타이머를 결정적으로 돌리고, 타임라인 ts 는
// deps.now 에 물린 가짜 시계를 쓴다(실시간 sleep 없음).
// ────────────────────────────────────────────────────────────────────────────

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
 * 가짜 오케 PTY. `alive` 로 "세션이 죽었다"([A])와 "살아 있다"([B])를 가른다.
 * postMessage 는 grant / nudge / 안내를 전부 posts 에 모은다.
 */
function makeOrch(alive: boolean): {
  registry: OrchestratorRegistry;
  posts: string[];
} {
  const posts: string[] = [];
  const ref: OrchestratorRef = {
    sessionId: "sess-1",
    ptySessionId: "pty-1",
    isAlive: () => alive,
    postMessage: async (m: string) => {
      posts.push(m);
    },
  };
  const registry: OrchestratorRegistry = {
    // 죽은 세션은 ensureSession 도 되살리지 못하는 상황을 재현한다(앱은 살아 있는데
    // 그 미션의 오케 PTY 만 사라진 경우 = grantStep 의 두 번째 isAlive 가드에 걸린다).
    async ensureSession() {
      return ref;
    },
    getSession: (sid) => (sid === "sess-1" ? ref : null),
  };
  return { registry, posts };
}

const NUDGE_MS = 1_000;
const MAX_NUDGES = 3;
/** watchdog 이 escalate 까지 가고도 한참 남는 시간 — "그래도 아무 일 없음"의 근거. */
const LONG_AFTER_MS = NUDGE_MS * (MAX_NUDGES + 2) * 20;

interface Harness {
  store: InMemoryStore;
  bus: InProcessMissionEventBus;
  conductor: ConductorDriver;
  posts: string[];
  notices: string[];
  /** 가짜 시계 — deps.now 가 이걸 읽는다. */
  advanceClock: (ms: number) => void;
}

function buildHarness(opts: {
  orchAlive: boolean;
  taskStatuses?: Record<string, TaskStatusLite>;
}): Harness {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const orch = makeOrch(opts.orchAlive);
  const notices: string[] = [];
  const notifier: MissionNotifier = (n) => notices.push(n.kind);
  const taskStatuses = opts.taskStatuses ?? {};
  let clock = new Date("2026-09-04T02:43:00.000Z").getTime();
  const conductor = createConductorDriver({
    store,
    orchestrators: orch.registry,
    eventBus: bus,
    getTaskStatuses: async (
      ids: string[],
    ): Promise<Record<string, TaskStatusLite>> => {
      const out: Record<string, TaskStatusLite> = {};
      for (const id of ids) if (taskStatuses[id]) out[id] = taskStatuses[id];
      return out;
    },
    notifier,
    reportNudgeIntervalMs: NUDGE_MS,
    maxReportNudges: MAX_NUDGES,
    now: () => new Date(clock),
    logger: () => {},
  });
  return {
    store,
    bus,
    conductor,
    posts: orch.posts,
    notices,
    advanceClock: (ms) => {
      clock += ms;
    },
  };
}

/** gstack 스텝 1개짜리 미션 — 보고(mission_step_done)로만 전진하는 최소 형태. */
async function makeOneStepMission(store: InMemoryStore): Promise<string> {
  return store.createMission({
    projectId: "GFB8JnJrrX6AgahqmGB3",
    goal: "폐루프가 도는지 본다",
    templateId: "feature",
    status: "active",
    ownerOrchestratorSessionId: "sess-1",
    steps: [
      {
        index: 0,
        type: "gstack",
        skill: "/investigate",
        status: "pending",
        retryCount: 0,
      },
    ],
    currentStepIndex: 0,
    taskIds: [],
    contextLog: [],
  });
}

/** 가짜 시계와 타이머를 함께 밀어 watchdog 을 결정적으로 돌린다. */
async function tick(h: Harness, ms: number): Promise<void> {
  h.advanceClock(ms);
  await vi.advanceTimersByTimeAsync(ms);
}

function timelineTypes(m: Mission): string[] {
  return m.contextLog.map((e) => String(e.type));
}

/** contextLog 전체를 문자열로 눌러 "사유가 한 글자라도 남았는가"를 본다. */
function timelineBlob(m: Mission): string {
  return JSON.stringify(m.contextLog);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("폐루프 정지 — [A] 오케 세션 사망 시 미션은 사유 없이 조용히 선다", () => {
  it("grant 가 배달되지 않으면 watchdog 자체가 안 걸려 nudge·escalate·사유가 영원히 없다", async () => {
    const h = buildHarness({ orchAlive: false });
    const id = await makeOneStepMission(h.store);

    h.conductor.requestAdvance(id);
    await tick(h, 1);

    // grantStep 은 running 마킹 + step.started 까지 하고 주입 직전에 return 한다.
    expect(h.store.raw(id).steps[0].status).toBe("running");
    expect(timelineTypes(h.store.raw(id))).toEqual(["step.started"]);
    expect(h.posts).toHaveLength(0); // grant 가 오케에 닿지 않았다.

    // ★핵심: nudge 한도를 한참 넘겨도 아무 일도 일어나지 않는다.
    await tick(h, LONG_AFTER_MS);

    const m = h.store.raw(id);
    // 미션은 여전히 '진행 중'으로 보인다 — 멈춘 게 아니라 도는 것처럼 보인다.
    expect(m.status).toBe("active");
    expect(m.steps[0].status).toBe("running");
    expect(m.currentStepIndex).toBe(0);

    // 감시가 안 걸렸으므로 nudge 도 escalate 도 없다.
    expect(h.posts).toHaveLength(0);
    expect(h.notices).toHaveLength(0);

    // 그리고 타임라인에는 "시작됨" 하나뿐 — 왜 멈췄는지 말해주는 것이 전혀 없다.
    // (step.started 의 payload.driver 는 "누가 운전하나"이지 정지 사유가 아니다.)
    expect(timelineTypes(m)).toEqual(["step.started"]);
    expect(timelineBlob(m)).not.toContain("report timeout");
    // 사유를 실어 나르는 통로가 전부 비어 있다: 실패 이벤트도, 지휘자 메모도,
    // 스텝에 남은 error 문자열도 없다.
    expect(m.contextLog.some((e) => e.type === "step.failed")).toBe(false);
    expect(m.contextLog.some((e) => e.type === "supervisor.note")).toBe(false);
    expect(m.steps[0].error).toBeUndefined();
  });
});

describe("폐루프 정지 — [C] 재시작으로 남은 running wait 스텝은 재평가되지 않는다", () => {
  // 앱 재시작 시 wire.ts → engine.recoverInFlight 는 wait 스텝만 running 그대로
  // 두고 resume 한다(A안 engine 의 runWait 가 재폴링한다는 전제). B안에는 runWait
  // 가 없다 — 지휘자는 task 이벤트가 올 때만 wait 게이트를 재평가한다. 그런데
  // grantStep 의 `step.status === "running"` 중복-grant 가드가 wait 분기(=grant
  // 시점 1회 게이트 평가)보다 **앞**에 있어, 재시작 후의 re-grant 는 통째로
  // 삼켜진다. 앱이 꺼져 있는 동안 task 가 전부 끝났다면 깨워 줄 이벤트가 다시는
  // 오지 않으므로, 게이트가 통과 조건을 이미 만족했는데도 미션은 영원히 선다.
  it("게이트가 이미 충족돼 있어도 re-grant 가 running 가드에 삼켜져 전진하지 않는다", async () => {
    const h = buildHarness({ orchAlive: true, taskStatuses: { t1: "DONE" } });
    // 재시작 직후 상태 재현: wait 스텝이 running 인 채로 남아 있고 그 task 는
    // 앱이 꺼져 있는 사이 이미 DONE 이 됐다.
    const id = await h.store.createMission({
      projectId: "GFB8JnJrrX6AgahqmGB3",
      goal: "분해된 task 가 끝나기를 기다린다",
      templateId: "feature",
      status: "active",
      ownerOrchestratorSessionId: "sess-1",
      steps: [
        { index: 0, type: "wait", status: "running", retryCount: 0 },
        {
          index: 1,
          type: "gstack",
          skill: "/ship",
          status: "pending",
          retryCount: 0,
        },
      ],
      currentStepIndex: 0,
      taskIds: ["t1"],
      contextLog: [],
    });

    // 부팅 복구의 resume → requestAdvance.
    h.conductor.requestAdvance(id);
    await tick(h, LONG_AFTER_MS);

    // 게이트는 통과 조건(t1=DONE)을 이미 만족한다 — 그런데 아무 일도 없다.
    expect(await h.conductor.verifyGate(id, 0)).toMatchObject({ passed: true });
    expect(h.store.raw(id).currentStepIndex).toBe(0);
    expect(h.store.raw(id).steps[0].status).toBe("running");
    expect(h.store.raw(id).contextLog).toHaveLength(0); // 사유도 없다.

    // 정지의 원인이 "게이트 미충족"이 아니라 "재평가가 트리거되지 않음"임을 고정한다:
    // 뒤늦은 task 이벤트가 하나라도 오면 즉시 전진한다.
    h.bus.emit({
      type: "task.status_changed",
      missionId: id,
      payload: { taskId: "t1", from: "IN_PROGRESS", to: "DONE" },
    });
    await tick(h, 1);
    expect(h.store.raw(id).currentStepIndex).toBe(1);
  });
});

describe("폐루프 정지 — [B] 오케는 살아 있는데 보고만 누락되면 사유가 남는다", () => {
  it("보고가 없으면 nudge 를 반복하고 한도 초과 시 'report timeout' 을 남기고 escalate 한다", async () => {
    const h = buildHarness({ orchAlive: true });
    const id = await makeOneStepMission(h.store);

    h.conductor.requestAdvance(id);
    await tick(h, 1);

    // grant 는 정상 배달됐다.
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toContain("mission_step_done");
    expect(h.store.raw(id).steps[0].status).toBe("running");

    // 보고를 끝내 하지 않는다 → watchdog 이 nudge 를 반복한다.
    await tick(h, NUDGE_MS * MAX_NUDGES);
    const nudges = h.posts.filter((p) => p.includes("【Conductor】"));
    expect(nudges.length).toBe(MAX_NUDGES);

    // 한도 초과 → escalate.
    await tick(h, NUDGE_MS * 2);

    const m = h.store.raw(id);
    expect(m.status).toBe("waiting_for_human");
    expect(h.notices).toContain("escalate");

    // [A] 와 갈리는 지점 — 저널에 사유가 남는다.
    const failed = m.contextLog.find((e) => e.type === "step.failed");
    expect(failed).toBeTruthy();
    expect((failed!.payload as { error?: string }).error).toBe(
      "report timeout (no mission_step_done)",
    );
    expect((failed!.payload as { notifyUser?: boolean }).notifyUser).toBe(true);
  });
});
