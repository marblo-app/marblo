import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InProcessMissionEventBus,
  createConductorDriver,
  MISSION_STEP_REPORTED_EVENT,
} from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
// ★회귀 가치의 핵심: 손으로 step 배열을 짜지 않고 *실제 프로덕션 템플릿*과 *실제
//   프로덕션 게이트*를 그대로 끌어와 구동한다. 템플릿/게이트가 바뀌면 이 테스트가
//   깨져 "데모 시나리오가 결정적으로 끝까지 돈다"는 계약 회귀를 잡는다.
import { instantiateSteps } from "../../electron/mission-engine/templates";
import { verifyStepGate as realVerifyStepGate } from "../../electron/mission-engine/gates";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  MissionTemplateId,
  TimelineEvent,
  TimelineEventType,
} from "../../electron/mission-engine/types";
import type {
  MissionEngineEvent,
  MissionNotifier,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// ════════════════════════════════════════════════════════════════════════════
// B안 Phase 5-A — *데모 시나리오* 회귀 e2e (게이트 순서·건너뛰기 불가).
//
// 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §5.6 / §8-6.
//
// mission-b-e2e.test.ts 가 Conductor 의 *운전 루프 메커닉*(grant/report/gate/retry/
// escalate/wait)을 손으로 짠 step 배열로 검증한다면, 이 스위트는 한 단계 위 —
// **실제 자동화 템플릿**(instantiateSteps)을 **실제 게이트**(gates.ts.verifyStepGate)로
// 끝까지 구동해, "지휘자(Conductor)가 데모를 결정적으로 완주하고 LLM 오케스트레이터가
// 단계를 건너뛸 수 없다"를 회귀로 고정한다.
//
// 검증 명제 (작업 지시 1~5):
//   1) 정상 풀루프: full-feature(10스텝)·feature(6스텝)를 순서대로 success 보고하며
//      전진 → completed, currentStepIndex === steps.length.
//   2) 게이트 순서 보장: 항상 '한 번에 하나'만 running. /ship 은 PR URL 없는 output
//      으로는 완료되지 않는다.
//   3) 건너뛰기 불가(적대적): (a) 현재보다 앞선 인덱스 보고 → stale 무시(전진無),
//      (b) gstack 게이트 미통과(빈 output) → 전진無(retry/hold).
//   4) 완료정의: full-feature 는 최종 /ship(PR URL) 보고 후에만 completed.
//   5) 단일 타임라인 서사: contextLog 에 step.started/step.completed 가 순서대로 +
//      payload.driver === 'orchestrator'.
//
// 게이트 통과 output 형식은 *추측이 아니라 gates.ts 실제 구현*에 맞춘다:
//   - gstack(비-review/비-ship) : output.trim().length > 0  (비어있지 않은 산출물)
//   - /review                   : REVIEW_FAIL 류 마커가 *없으면* 통과 (negative gate)
//   - /ship                     : github PR URL 정규식 매치 필요
//   - dispatch / wait           : mission.taskIds 가 전부 "DONE"
// ════════════════════════════════════════════════════════════════════════════

// ──────────────────────────── fakes (mission-b-e2e 와 동일 골격) ───────────────

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

/** 오케스트레이터 PTY 세션 fake — postMessage 를 spy 로 노출. */
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

/**
 * 하니스 — mission-b-e2e 와 달리 **항상 실제 gates.ts.verifyStepGate 를 주입**한다.
 * conductor 내장 defaultStepGate 는 비-ship gstack 을 성공 보고만으로 통과시켜
 * "빈 output → 게이트 미통과"(작업 지시 3b)를 검증할 수 없으므로, 데모 회귀는 반드시
 * 프로덕션 게이트로 돌려야 한다.
 */
function buildHarness(opts: { maxRetries?: number } = {}): Harness {
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
    verifyStepGate: realVerifyStepGate,
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

/** 실제 프로덕션 템플릿으로 미션을 만든다(손으로 step 배열 금지). */
async function makeMission(
  store: InMemoryStore,
  templateId: MissionTemplateId,
  opts: { taskIds?: string[]; goal?: string } = {},
): Promise<string> {
  return store.createMission({
    projectId: "p1",
    goal: opts.goal ?? "ship the thing",
    templateId,
    status: "active",
    ownerOrchestratorSessionId: "sess-1",
    steps: instantiateSteps(templateId),
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

function timelineCount(m: Mission, type: TimelineEventType): number {
  return m.contextLog.filter((e) => e.type === type).length;
}

/** 한 시점에 running 인 스텝 수 — '한 번에 하나' 불변식 검사용. */
function runningCount(m: Mission): number {
  return m.steps.filter((s) => s.status === "running").length;
}

function hasNote(m: Mission, kind: string): boolean {
  return m.contextLog.some(
    (e) =>
      e.type === "supervisor.note" &&
      (e.payload as { kind?: string }).kind === kind,
  );
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
beforeEach(async () => {
  const mocks = (await import("../mocks/firebase-firestore")) as unknown as {
    __resetStore?: () => void;
  };
  mocks.__resetStore?.();
});

// ════════════════════════ 1) 정상 풀루프 → completed ════════════════════════

describe("B안 Phase 5-A — 실제 템플릿을 끝까지 구동하면 completed 로 마감한다", () => {
  it("full-feature(10스텝)를 순서대로 보고하면 최종 /ship(PR URL) 후 completed 가 된다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "full-feature", {
      taskIds: ["t1", "t2"],
    });
    // dispatch/wait 게이트(taskIds 전부 DONE)가 통과하도록 task 는 전부 DONE.
    h.taskStatuses.t1 = "DONE";
    h.taskStatuses.t2 = "DONE";

    // 템플릿 형상 자체도 회귀로 고정(스텝 수/타입/마지막 ship).
    expect(h.store.raw(id).steps).toHaveLength(10);
    expect(h.store.raw(id).steps[4].type).toBe("dispatch");
    expect(h.store.raw(id).steps[5].type).toBe("wait");
    expect(h.store.raw(id).steps[9].skill).toBe("/ship");

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    expect(runningCount(h.store.raw(id))).toBe(1);

    // 0 /office-hours → 1 /plan-ceo-review (gstack: 비어있지 않은 output 필요)
    emitReport(h.bus, id, 0, "success", {
      output: "office-hours: 요구사항 정리 완료",
    });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");

    emitReport(h.bus, id, 1, "success", { output: "CEO 리뷰: 스코프 확정" });
    await waitFor(() => h.store.raw(id).steps[2].status === "running");

    emitReport(h.bus, id, 2, "success", { output: "eng 리뷰: 아키텍처 확정" });
    await waitFor(() => h.store.raw(id).steps[3].status === "running");

    emitReport(h.bus, id, 3, "success", { output: "design 리뷰: UX 확정" });
    await waitFor(() => h.store.raw(id).steps[4].status === "running");
    expect(h.store.raw(id).steps[4].type).toBe("dispatch");

    // 4 dispatch → 게이트(t1·t2 DONE) → 5 wait 즉시 자동통과 → 6 /review 까지 전진.
    emitReport(h.bus, id, 4, "success", { output: "작업 분해·할당 완료" });
    await waitFor(() => h.store.raw(id).steps[6].status === "running");
    expect(h.store.raw(id).steps[4].status).toBe("success");
    expect(h.store.raw(id).steps[5].status).toBe("success"); // wait 자동통과.
    expect(h.store.raw(id).currentStepIndex).toBe(6);

    // 6 /review — REVIEW_FAIL 류 마커가 없으면 통과(negative gate).
    emitReport(h.bus, id, 6, "success", {
      output: "review ok — 모든 항목 통과",
    });
    await waitFor(() => h.store.raw(id).steps[7].status === "running");

    // 7 /qa (gstack: 비어있지 않은 output 필요)
    emitReport(h.bus, id, 7, "success", { output: "QA: 결함 0" });
    await waitFor(() => h.store.raw(id).steps[8].status === "running");

    // 8 /design-review — /review 와 달리 gstack 게이트(비어있지 않은 output) 적용.
    emitReport(h.bus, id, 8, "success", { output: "design-review: 통과" });
    await waitFor(() => h.store.raw(id).steps[9].status === "running");
    expect(h.store.raw(id).steps[9].skill).toBe("/ship");

    // ── 완료정의(작업 지시 4): /ship 보고 *전* 엔 절대 completed 가 아니다 ──
    expect(h.store.raw(id).status).toBe("active");
    expect(h.store.raw(id).completedAt).toBeNull();

    // 9 /ship — github PR URL 이 있어야만 게이트 통과 → 완료.
    emitReport(h.bus, id, 9, "success", {
      output: "shipped: https://github.com/acme/marblo/pull/128",
    });
    await waitFor(() => h.store.raw(id).status === "completed");

    const m = h.store.raw(id);
    expect(m.status).toBe("completed");
    expect(m.completedAt).toBeInstanceOf(Date);
    expect(m.steps.every((s) => s.status === "success")).toBe(true);
    // 끝까지 전진 → currentStepIndex === steps.length.
    expect(m.currentStepIndex).toBe(m.steps.length);
    expect(m.currentStepIndex).toBe(10);

    // 정상 풀루프엔 retry 가 없으므로 grant/완료 카운트가 스텝 수와 정확히 일치.
    expect(timelineCount(m, "step.started")).toBe(10);
    expect(timelineCount(m, "step.completed")).toBe(10);
  });

  it("feature(6스텝)도 동일하게 끝까지 구동돼 completed 가 된다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "feature", { taskIds: ["t1"] });
    h.taskStatuses.t1 = "DONE";

    expect(h.store.raw(id).steps).toHaveLength(6);

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    // 0 /plan-eng-review
    emitReport(h.bus, id, 0, "success", { output: "eng 계획 확정" });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).steps[1].type).toBe("dispatch");

    // 1 dispatch → 게이트(t1 DONE) → 2 wait 자동통과 → 3 /review.
    emitReport(h.bus, id, 1, "success", { output: "할당 완료" });
    await waitFor(() => h.store.raw(id).steps[3].status === "running");
    expect(h.store.raw(id).steps[2].status).toBe("success"); // wait 자동통과.

    emitReport(h.bus, id, 3, "success", { output: "review ok" });
    await waitFor(() => h.store.raw(id).steps[4].status === "running");

    emitReport(h.bus, id, 4, "success", { output: "QA 통과" });
    await waitFor(() => h.store.raw(id).steps[5].status === "running");
    expect(h.store.raw(id).steps[5].skill).toBe("/ship");

    emitReport(h.bus, id, 5, "success", {
      output: "shipped: https://github.com/acme/marblo/pull/77",
    });
    await waitFor(() => h.store.raw(id).status === "completed");

    const m = h.store.raw(id);
    expect(m.status).toBe("completed");
    expect(m.currentStepIndex).toBe(m.steps.length);
    expect(m.steps.every((s) => s.status === "success")).toBe(true);
  });
});

// ════════════════════════ 2) 게이트 순서 보장 ════════════════════════════════

describe("B안 Phase 5-A — 게이트 순서: 한 번에 하나, /ship 은 PR URL 필수", () => {
  it("스텝은 항상 한 번에 하나만 running 이고, 보고 전엔 다음 스텝을 grant 하지 않는다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "feature", { taskIds: ["t1"] });
    // dispatch 가 자동통과하지 않도록 task 를 미완료로 둔다(running 유지 관찰).
    h.taskStatuses.t1 = "IN_PROGRESS";

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    // 스텝 0만 running, 나머지는 전부 pending — '한 번에 하나'.
    expect(runningCount(h.store.raw(id))).toBe(1);
    expect(
      h.store
        .raw(id)
        .steps.slice(1)
        .every((s) => s.status === "pending"),
    ).toBe(true);
    expect(timelineCount(h.store.raw(id), "step.started")).toBe(1);

    // 0 보고 → 1 dispatch 만 running 으로 전진(2개가 동시에 running 되지 않음).
    emitReport(h.bus, id, 0, "success", { output: "eng 계획 확정" });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    expect(h.store.raw(id).steps[1].type).toBe("dispatch");
    expect(runningCount(h.store.raw(id))).toBe(1);
    expect(h.store.raw(id).steps[0].status).toBe("success");
    expect(h.store.raw(id).currentStepIndex).toBe(1);

    // dispatch 성공 보고여도 t1 미완료 → task게이트 보류: retry 없이 running 유지,
    // 다음 스텝(wait)으로 넘기지 않는다("완료대기는 지휘자가" — §8-3).
    emitReport(h.bus, id, 1, "success", { output: "할당 완료" });
    await waitFor(() => hasNote(h.store.raw(id), "awaiting_tasks"));
    expect(runningCount(h.store.raw(id))).toBe(1);
    expect(h.store.raw(id).steps[1].status).toBe("running");
    expect(h.store.raw(id).steps[1].retryCount ?? 0).toBe(0); // 재할당 안 함.
    expect(h.store.raw(id).currentStepIndex).toBe(1);
  });

  it("/ship 스텝은 PR URL 없는 output 으론 완료되지 않고 escalate(waiting_for_human) 한다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "feature", { taskIds: ["t1"] });
    h.taskStatuses.t1 = "DONE";

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");
    emitReport(h.bus, id, 0, "success", { output: "eng 계획 확정" });
    await waitFor(() => h.store.raw(id).steps[1].status === "running");
    emitReport(h.bus, id, 1, "success", { output: "할당 완료" });
    await waitFor(() => h.store.raw(id).steps[3].status === "running");
    emitReport(h.bus, id, 3, "success", { output: "review ok" });
    await waitFor(() => h.store.raw(id).steps[4].status === "running");
    emitReport(h.bus, id, 4, "success", { output: "QA 통과" });
    await waitFor(() => h.store.raw(id).steps[5].status === "running");
    expect(h.store.raw(id).steps[5].skill).toBe("/ship");

    // /ship 인데 PR URL 이 없는 output → 게이트 거부 → onFailure='escalate' →
    // 즉시 waiting_for_human. 절대 completed 로 가지 않는다.
    emitReport(h.bus, id, 5, "success", {
      output: "배포를 시도했으나 PR 링크가 아직 없습니다",
    });
    await waitFor(() => h.store.raw(id).status === "waiting_for_human");

    const m = h.store.raw(id);
    expect(m.status).not.toBe("completed");
    expect(m.steps[5].status).toBe("failed");
    expect(m.currentStepIndex).toBe(5); // 전진하지 않음.
    expect(h.notices.at(-1)).toMatchObject({ kind: "escalate", missionId: id });
  });
});

// ════════════════════════ 3) 건너뛰기 불가(적대적) ══════════════════════════

describe("B안 Phase 5-A — 오케스트레이터는 단계를 건너뛸 수 없다(적대적)", () => {
  it("현재 스텝보다 앞선 인덱스로 success 보고해도 stale 무시되어 전진하지 않는다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "full-feature", {
      taskIds: ["t1", "t2"],
    });
    h.taskStatuses.t1 = "DONE";
    h.taskStatuses.t2 = "DONE";

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    // 현재 0인데 5(미래 스텝)을 성공 보고 → '한 번에 하나' 위반이라 stale 무시.
    emitReport(h.bus, id, 5, "success", {
      output: "건너뛰기 시도: https://github.com/x/y/pull/9",
    });
    await flush();

    const m = h.store.raw(id);
    expect(m.currentStepIndex).toBe(0); // 불변.
    expect(m.steps[0].status).toBe("running");
    expect(m.steps[5].status).toBe("pending"); // 미래 스텝은 손대지 않음.
    expect(timelineCount(m, "step.completed")).toBe(0); // 아무 스텝도 완료 안 됨.
  });

  it("gstack 게이트 미통과(빈 output)면 성공 보고여도 전진하지 않고 같은 스텝을 재허가(retry)한다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "feature");

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    // 0 /plan-eng-review 에 빈 output 으로 성공 보고 → gstack 게이트 "no output yet"
    // 거부 → onFailure 미지정(=retry) → 같은 스텝을 다시 허가(running), 전진無.
    emitReport(h.bus, id, 0, "success", { output: "" });
    await waitFor(
      () =>
        (h.store.raw(id).steps[0].retryCount ?? 0) === 1 &&
        h.store.raw(id).steps[0].status === "running",
    );

    const m = h.store.raw(id);
    expect(m.currentStepIndex).toBe(0); // 전진하지 않음.
    expect(m.steps[1].status).toBe("pending"); // 다음 스텝 grant 안 됨.
    expect(timelineCount(m, "step.started")).toBe(2); // 초기 grant + 재허가.
    expect(timelineCount(m, "step.completed")).toBe(0); // 완료 마킹 없음.
    expect(hasNote(m, "gate_failed")).toBe(true); // 게이트 보류 마커.
  });
});

// ════════════════════════ 5) 단일 타임라인 서사 ══════════════════════════════

describe("B안 Phase 5-A — 단일 타임라인: step.started/step.completed 순서 + driver", () => {
  it("full-feature 완주 후 contextLog 가 스텝별 started→completed 로 순서대로 쌓이고 모두 driver=orchestrator 다", async () => {
    const h = buildHarness();
    const id = await makeMission(h.store, "full-feature", {
      taskIds: ["t1", "t2"],
    });
    h.taskStatuses.t1 = "DONE";
    h.taskStatuses.t2 = "DONE";

    const outputs: Record<number, string> = {
      0: "office-hours done",
      1: "ceo done",
      2: "eng done",
      3: "design done",
      4: "dispatch done",
      6: "review ok",
      7: "qa ok",
      8: "design-review ok",
      9: "shipped: https://github.com/acme/marblo/pull/200",
    };

    h.conductor.requestAdvance(id);
    await waitFor(() => h.store.raw(id).steps[0].status === "running");

    // 오케가 보고하는 스텝(=wait 제외)만 순서대로 보고. dispatch(4) 보고가 wait(5)을
    // 자동통과시켜 6 까지 전진한다.
    for (const idx of [0, 1, 2, 3, 4, 6, 7, 8, 9]) {
      await waitFor(() => h.store.raw(id).steps[idx].status === "running");
      emitReport(h.bus, id, idx, "success", { output: outputs[idx] });
    }
    await waitFor(() => h.store.raw(id).status === "completed");

    const m = h.store.raw(id);

    // 단일 서사: step.started/step.completed 만 추려 (type,index) 시퀀스를 만들면
    // 0..9 가 started→completed 로 완벽히 교차·정렬돼야 한다(건너뜀/뒤섞임 없음).
    const seq = m.contextLog
      .filter((e) => e.type === "step.started" || e.type === "step.completed")
      .map((e) => `${e.type}#${(e.payload as { index?: number }).index}`);
    const expected: string[] = [];
    for (let i = 0; i < 10; i++) {
      expected.push(`step.started#${i}`, `step.completed#${i}`);
    }
    expect(seq).toEqual(expected);

    // 모든 운전 타임라인은 driver='orchestrator' (A안 engine 경로와 구분).
    expect(
      m.contextLog
        .filter((e) => e.type === "step.started" || e.type === "step.completed")
        .every(
          (e) => (e.payload as { driver?: string }).driver === "orchestrator",
        ),
    ).toBe(true);
  });
});
