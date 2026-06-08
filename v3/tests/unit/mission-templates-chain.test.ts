import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MissionEngine,
  InProcessMissionEventBus,
  listTemplates,
  getTemplate,
} from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  MissionTemplateId,
  TimelineEvent,
} from "../../electron/mission-engine/types";
import type {
  FixRunner,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  SkillResult,
  SkillRunner,
  TaskDispatcher,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// 5개 미션 템플릿의 step chain + synthesis 가 제대로 흘러가는지 검증.
// PtySkillRunner / 실제 PTY 없이 fake 만으로 ports 인터페이스를 통한 흐름을 확인.

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

  raw(id: string): Mission | undefined {
    return this.docs.get(id);
  }
}

interface SkillCall {
  skill: string;
  chainPrelude?: string;
  projectId: string;
  missionId: string;
}
interface RawCall {
  prompt: string;
  projectId: string;
  missionId: string;
}

function makeSkillRunner(): SkillRunner & {
  calls: SkillCall[];
  rawCalls: RawCall[];
} {
  const calls: SkillCall[] = [];
  const rawCalls: RawCall[] = [];
  return {
    calls,
    rawCalls,
    async runSkill(input): Promise<SkillResult> {
      calls.push({
        skill: input.skill,
        chainPrelude: input.chainPrelude,
        projectId: input.projectId,
        missionId: input.missionId,
      });
      return {
        success: true,
        output: `[FAKE ${input.skill} output]\nResult of ${input.skill}.`,
        durationMs: 1,
      };
    },
    async runRawMessage(input): Promise<SkillResult> {
      rawCalls.push({
        prompt: input.prompt,
        projectId: input.projectId,
        missionId: input.missionId,
      });
      // synthesis 응답 — 마지막에 path 출력하는 형식.
      return {
        success: true,
        output: `Synthesis summary text.\n\ndocs/missions/test-mission-abc123/SUMMARY.md`,
        durationMs: 1,
      };
    },
  };
}

interface DispatchCall {
  goal: string;
  priorContext?: string;
}

function makeDispatcher(calls: DispatchCall[]): TaskDispatcher {
  const statuses: Record<string, TaskStatusLite> = {};
  return {
    async dispatchTasks(input) {
      calls.push({ goal: input.goal, priorContext: input.priorContext });
      const taskIds = [`t-${input.missionId}-1`];
      statuses[taskIds[0]] = "DONE"; // 즉시 완료로 wait step 도 통과
      return taskIds;
    },
    async getTaskStatuses(taskIds) {
      const out: Record<string, TaskStatusLite> = {};
      for (const id of taskIds) if (statuses[id]) out[id] = statuses[id];
      return out;
    },
    async findMissionTaskIds(missionId) {
      // 실제 구현과 동일 의미 — 이 미션의 비종료(DONE/FAILED 아님) task id.
      // fake 는 dispatch 즉시 DONE 으로 두므로 보통 [] → runDispatch 멱등 검사 통과.
      return Object.keys(statuses).filter(
        (id) =>
          id.includes(missionId) &&
          statuses[id] !== "DONE" &&
          statuses[id] !== "FAILED",
      );
    },
    async killAgentsForTasks() {},
  };
}

interface FixCall {
  goal: string;
  priorContext?: string;
}

function makeFixRunner(calls: FixCall[]): FixRunner {
  return {
    async runFix(input) {
      calls.push({ goal: input.goal, priorContext: input.priorContext });
      return { success: true };
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
          ptySessionId: `pty-${sid}`,
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

async function launchAndCompleteMission(
  templateId: MissionTemplateId,
): Promise<{
  store: InMemoryStore;
  mission: Mission;
  skillRunner: ReturnType<typeof makeSkillRunner>;
  dispatchCalls: DispatchCall[];
  fixCalls: FixCall[];
}> {
  const store = new InMemoryStore();
  const bus = new InProcessMissionEventBus();
  const skillRunner = makeSkillRunner();
  const dispatchCalls: DispatchCall[] = [];
  const fixCalls: FixCall[] = [];
  const dispatcher = makeDispatcher(dispatchCalls);
  const fixRunner = makeFixRunner(fixCalls);
  const engine = new MissionEngine({
    store,
    dispatcher,
    skillRunner,
    fixRunner,
    eventBus: bus,
    orchestrators: makeOrchRegistry(),
  });
  const mission = await engine.launch({
    projectId: "p1",
    goal: "테스트 미션 목표",
    templateId,
  });
  // 완료까지 대기 (모든 step 즉시 success → 빠르게 종료).
  await waitFor(() => {
    const m = store.raw(mission.id);
    return !!m && (m.status === "completed" || m.status === "abandoned");
  });
  const final = store.raw(mission.id)!;
  return { store, mission: final, skillRunner, dispatchCalls, fixCalls };
}

// ──────────────────────────── tests ────────────────────────────

describe("templates · 모든 5개 카드 end-to-end chain", () => {
  it("listTemplates() 가 정확히 5개 노출", () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids.sort()).toEqual(
      ["quick-fix", "polish", "feature", "full-feature", "research"].sort(),
    );
  });

  for (const t of listTemplates()) {
    it(`[${t.id}] launch → 모든 step success → completed`, async () => {
      const { mission } = await launchAndCompleteMission(t.id);
      expect(mission.status).toBe("completed");
      expect(mission.completedAt).toBeTruthy();
      // 모든 step 이 success 또는 skipped 로 끝남.
      const terminal = mission.steps.every(
        (s) => s.status === "success" || s.status === "skipped",
      );
      expect(terminal).toBe(true);
    });

    it(`[${t.id}] step 2+ gstack 호출 시 chainPrelude 가 직전 step output 을 포함`, async () => {
      const { skillRunner } = await launchAndCompleteMission(t.id);
      // 적어도 gstack step 이 2개 이상 있는 템플릿에서는 chainPrelude 가 비어있지 않아야.
      const template = getTemplate(t.id);
      const gstackPositions = template.steps
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.type === "gstack");
      if (gstackPositions.length < 2) return; // 1개 이하면 chain 불가 — research 등.
      // 두 번째 이후 gstack 호출은 chainPrelude 가 있어야 함.
      // skill 이름 매칭으로 호출 찾음 (synthesis 의 rawMessage 는 calls 에 안 들어옴).
      for (let i = 1; i < gstackPositions.length; i += 1) {
        const skill = gstackPositions[i].s.skill!;
        const call = skillRunner.calls.find((c) => c.skill === skill);
        expect(call, `call for ${skill} not found`).toBeTruthy();
        expect(
          call!.chainPrelude,
          `${skill} should have chainPrelude`,
        ).toBeTruthy();
        expect(call!.chainPrelude!.length).toBeGreaterThan(20);
      }
    });

    it(`[${t.id}] 완료 후 synthesis (runRawMessage) 가 정확히 1번 호출됨`, async () => {
      const { skillRunner } = await launchAndCompleteMission(t.id);
      expect(skillRunner.rawCalls.length).toBe(1);
      expect(skillRunner.rawCalls[0].prompt).toMatch(
        /Marblo Mission Synthesis/,
      );
      expect(skillRunner.rawCalls[0].prompt).toMatch(/SUMMARY\.md/);
      expect(skillRunner.rawCalls[0].prompt).toMatch(/docs\/missions\//);
    });

    it(`[${t.id}] 완료 후 supervisor.note 에 synthesisPath 가 기록됨`, async () => {
      const { mission } = await launchAndCompleteMission(t.id);
      const finalNote = [...mission.contextLog]
        .reverse()
        .find(
          (e) =>
            e.type === "supervisor.note" &&
            (e.payload as { synthesisPath?: unknown }).synthesisPath,
        );
      expect(finalNote).toBeTruthy();
      const path = (finalNote!.payload as { synthesisPath?: string })
        .synthesisPath;
      expect(path).toMatch(/^docs\/missions\/.+\/SUMMARY\.md$/);
    });
  }

  it("[quick-fix] fix step 이 priorContext (직전 /investigate 결과) 를 받는다", async () => {
    const { fixCalls } = await launchAndCompleteMission("quick-fix");
    expect(fixCalls.length).toBe(1);
    expect(
      fixCalls[0].priorContext,
      "fix call must have priorContext",
    ).toBeTruthy();
    expect(fixCalls[0].priorContext).toMatch(/investigate/);
  });

  it("[feature] dispatch step 이 priorContext (직전 /plan-eng-review 결과) 를 받는다", async () => {
    const { dispatchCalls } = await launchAndCompleteMission("feature");
    expect(dispatchCalls.length).toBe(1);
    expect(dispatchCalls[0].priorContext).toBeTruthy();
    expect(dispatchCalls[0].priorContext).toMatch(/plan-eng-review/);
  });

  it("[full-feature] dispatch step 이 priorContext (직전 plan step 결과) 를 받는다", async () => {
    const { dispatchCalls } = await launchAndCompleteMission("full-feature");
    expect(dispatchCalls.length).toBe(1);
    expect(dispatchCalls[0].priorContext).toBeTruthy();
    expect(dispatchCalls[0].priorContext).toMatch(
      /plan-design-review|plan-eng-review/,
    );
  });

  it("[research] gstack 2 step 모두 chainPrelude / output 정상", async () => {
    const { mission, skillRunner } = await launchAndCompleteMission("research");
    expect(mission.steps).toHaveLength(2);
    expect(mission.steps.every((s) => s.status === "success")).toBe(true);
    // 2번째 skill 호출에 chainPrelude 가 있어야.
    const second = skillRunner.calls.find(
      (c) => c.skill === "/plan-ceo-review",
    );
    expect(second).toBeTruthy();
    expect(second!.chainPrelude).toBeTruthy();
  });
});

describe("synthesis · supervisor.note 의 synthesisPath / synthesisExcerpt 보장", () => {
  it("synthesisExcerpt 가 응답 마지막 4000자를 포함", async () => {
    const { mission } = await launchAndCompleteMission("polish");
    const finalNote = [...mission.contextLog]
      .reverse()
      .find(
        (e) =>
          e.type === "supervisor.note" &&
          (e.payload as { synthesisExcerpt?: unknown }).synthesisExcerpt,
      );
    expect(finalNote).toBeTruthy();
    const excerpt = (finalNote!.payload as { synthesisExcerpt?: string })
      .synthesisExcerpt;
    expect(excerpt).toBeTruthy();
    expect(excerpt!.length).toBeLessThanOrEqual(4000);
    expect(excerpt!).toMatch(/Synthesis summary text/);
  });

  it("synthesisPath 가 마지막 docs/missions/.../SUMMARY.md 줄에서 파싱됨", async () => {
    const { mission } = await launchAndCompleteMission("polish");
    const finalNote = [...mission.contextLog]
      .reverse()
      .find(
        (e) =>
          e.type === "supervisor.note" &&
          (e.payload as { synthesisPath?: unknown }).synthesisPath,
      );
    const path = (finalNote!.payload as { synthesisPath?: string })
      .synthesisPath;
    expect(path).toBe("docs/missions/test-mission-abc123/SUMMARY.md");
  });
});
