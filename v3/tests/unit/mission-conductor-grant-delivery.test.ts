import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConductorDriver } from "../../electron/mission-engine";
import { InProcessMissionEventBus } from "../../electron/mission-engine";
import type { ConductorDriver } from "../../electron/mission-engine";
import type {
  Mission,
  MissionStatus,
  MissionStep,
  TimelineEvent,
} from "../../electron/mission-engine/types";
import type {
  MissionInjectRefusal,
  MissionInjectResult,
  MissionNotifier,
  MissionStore,
  OrchestratorRef,
  OrchestratorRegistry,
  TaskStatusLite,
} from "../../electron/mission-engine/ports";

// ────────────────────────────────────────────────────────────────────────────
// grant 배달의 정직성 — 티켓 nzkdcE7W6P2uGYqCa3rU (진단 §4-D)
//
// 문제였던 것: `OrchestratorRef.postMessage` 아래의 `injectMessage` 는 네 가지
// 이유로 **throw 하지 않고 false 를** 돌려준다(부팅 게이트 / 세션 소실 / 미션 변경 /
// PTY 컴포저 점유). 어댑터가 그 boolean 을 버렸기 때문에 지휘자는 배달이 0건인데도
// "granted to orchestrator" 를 찍었다. 진짜 원인은 최소 4×240초 ≈ 16분 뒤
// `report timeout` 이라는 **엉뚱한 이름**으로만 드러났다.
//
// 이 파일이 고정하는 계약:
//   (1) 거부된 주입은 절대 성공으로 기록되지 않는다 — 미션이 전진하지 않는다.
//   (2) 거부 사유 4갈래가 각각 그 이름 그대로 저널에 남는다.
//   (3) 사유 축으로 나가는 것은 **고정 어휘뿐**이다 — PTY 원문도, 주입하려던
//       지시 본문도 저널에 실리지 않는다.
//   (4) postMessageDetailed 를 구현하지 않은 ref(기존 테스트 fake / 구버전 어댑터)는
//       예전 그대로 동작한다 — resolve = 성공.
// ────────────────────────────────────────────────────────────────────────────

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
  raw(id: string): Mission {
    const m = this.docs.get(id);
    if (!m) throw new Error(`Mission ${id} not found`);
    return m;
  }
}

const NUDGE_MS = 1_000;
const MAX_NUDGES = 3;

interface Harness {
  store: InMemoryStore;
  conductor: ConductorDriver;
  /** 실제로 PTY 까지 **배달된** 메시지들. 거부된 것은 여기 안 들어온다. */
  delivered: string[];
  notices: string[];
  advanceClock: (ms: number) => void;
}

/**
 * 오케 fake. `refusal` 이 주어지면 postMessageDetailed 가 그 사유로 거부한다
 * (= injectMessage 가 false 를 돌려주는 상황). `detailed: false` 면 아예
 * postMessageDetailed 를 구현하지 않아 구버전 어댑터를 재현한다.
 */
function buildHarness(opts: {
  refusal?: MissionInjectRefusal | null;
  detailed?: boolean;
}): Harness {
  const store = new InMemoryStore();
  const delivered: string[] = [];
  const notices: string[] = [];
  const refusal = opts.refusal ?? null;
  const detailed = opts.detailed ?? true;
  let clock = new Date("2026-09-04T02:43:00.000Z").getTime();

  const ref: OrchestratorRef = {
    sessionId: "sess-1",
    ptySessionId: "pty-1",
    isAlive: () => true, // ★세션은 멀쩡히 살아 있다 — 그래서 [A] 와 다른 갈래다.
    postMessage: async (m: string) => {
      delivered.push(m);
    },
    ...(detailed
      ? {
          postMessageDetailed: async (
            m: string,
          ): Promise<MissionInjectResult> => {
            if (refusal) return { ok: false, refusal };
            delivered.push(m);
            return { ok: true, refusal: null };
          },
        }
      : {}),
  };
  const registry: OrchestratorRegistry = {
    async ensureSession() {
      return ref;
    },
    getSession: (sid) => (sid === "sess-1" ? ref : null),
  };

  const conductor = createConductorDriver({
    store,
    orchestrators: registry,
    eventBus: new InProcessMissionEventBus(),
    getTaskStatuses: async (): Promise<Record<string, TaskStatusLite>> => ({}),
    notifier: ((n) => notices.push(n.kind)) as MissionNotifier,
    reportNudgeIntervalMs: NUDGE_MS,
    maxReportNudges: MAX_NUDGES,
    now: () => new Date(clock),
    logger: () => {},
  });

  return {
    store,
    conductor,
    delivered,
    notices,
    advanceClock: (ms) => {
      clock += ms;
    },
  };
}

async function makeMission(store: InMemoryStore): Promise<string> {
  return store.createMission({
    projectId: "GFB8JnJrrX6AgahqmGB3",
    goal: "주입 거부가 성공으로 둔갑하지 않는지 본다",
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

async function tick(h: Harness, ms: number): Promise<void> {
  h.advanceClock(ms);
  await vi.advanceTimersByTimeAsync(ms);
}

function noteOf(m: Mission): Record<string, unknown> | null {
  const e = m.contextLog.find(
    (x) =>
      x.type === "supervisor.note" &&
      (x.payload as { kind?: string }).kind === "grant_undelivered",
  );
  return e ? (e.payload as Record<string, unknown>) : null;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("주입 거부 4갈래 — 지휘자가 사유를 그대로 받는다", () => {
  const REFUSALS: MissionInjectRefusal[] = [
    "boot-gate-unstable",
    "session-gone",
    "mission-changed",
    "pty-refused",
  ];

  for (const refusal of REFUSALS) {
    it(`${refusal} — 배달 0건인데 'granted' 로 기록되지 않고 사유가 남는다`, async () => {
      const h = buildHarness({ refusal });
      const id = await makeMission(h.store);

      h.conductor.requestAdvance(id);
      await tick(h, 1);

      // 아무것도 배달되지 않았다.
      expect(h.delivered).toHaveLength(0);
      // 그리고 그 사실이 **그 이름 그대로** 저널에 남는다.
      expect(noteOf(h.store.raw(id))).toMatchObject({
        kind: "grant_undelivered",
        reason: refusal,
        index: 0,
      });
      // 미션은 전진하지 않는다 — 거부는 성공이 아니다.
      expect(h.store.raw(id).currentStepIndex).toBe(0);
      expect(
        h.store.raw(id).contextLog.some((e) => e.type === "step.completed"),
      ).toBe(false);
    });
  }

  it("거부돼도 감시는 걸려 있어 결국 escalate 로 이어진다 (16분 침묵이 아니다)", async () => {
    const h = buildHarness({ refusal: "pty-refused" });
    const id = await makeMission(h.store);

    h.conductor.requestAdvance(id);
    await tick(h, 1);
    // 사유는 **즉시** 나온다.
    expect(noteOf(h.store.raw(id))).toMatchObject({ reason: "pty-refused" });

    await tick(h, NUDGE_MS * (MAX_NUDGES + 2));
    expect(h.store.raw(id).status).toBe("waiting_for_human");
    expect(h.notices).toContain("escalate");
  });

  it("사유 축에는 분류값만 나간다 — 지시 본문·목표 문자열이 저널에 없다", async () => {
    const h = buildHarness({ refusal: "boot-gate-unstable" });
    const id = await makeMission(h.store);

    h.conductor.requestAdvance(id);
    await tick(h, 1);

    const blob = JSON.stringify(h.store.raw(id).contextLog);
    expect(blob).toContain("boot-gate-unstable");
    expect(blob).not.toContain("mission_step_done({success");
    expect(blob).not.toContain(h.store.raw(id).goal);
  });
});

describe("정상 배달 / 구버전 어댑터 — 회귀 0", () => {
  it("거부가 없으면 예전처럼 배달되고 grant_undelivered 는 남지 않는다", async () => {
    const h = buildHarness({ refusal: null });
    const id = await makeMission(h.store);

    h.conductor.requestAdvance(id);
    await tick(h, 1);

    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]).toContain("mission_step_done");
    expect(noteOf(h.store.raw(id))).toBeNull();
  });

  it("postMessageDetailed 미구현 ref 는 postMessage 로 폴백한다 (resolve = 성공)", async () => {
    const h = buildHarness({ detailed: false });
    const id = await makeMission(h.store);

    h.conductor.requestAdvance(id);
    await tick(h, 1);

    expect(h.delivered).toHaveLength(1);
    expect(noteOf(h.store.raw(id))).toBeNull();
  });
});
