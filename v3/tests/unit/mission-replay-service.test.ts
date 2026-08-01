/**
 * Mission Replay — 구독 계층(`missionReplayService`) 테스트.
 *
 * 핀하는 계약:
 *   - 완료 미션만, 최근 완료순으로 목록에 오른다. 1회 읽기 게이트가 통과한
 *     뒤에야 실시간 구독이 열린다.
 *   - **`denied`(권한 없음) ≠ 빈 목록**. 목록도 단건도 이 둘을 안 섞는다.
 *   - ★C2 권한저하: `projectAuditLog` 가 owner/admin 전용이라 막혀도 Replay 는
 *     터지지 않고 나머지 레인으로 만들어지며, human 레인은 `provenance` 에
 *     `denied` 로 정직하게 표기된다("아무도 안 했다"로 그리지 않기 위해).
 *   - 권한 외 실패(네트워크 등)는 `denied` 로 위장하지 않고 `sourceErrors` 로
 *     따로 올라간다.
 *   - activities 상한 밖 태스크는 **키를 만들지 않는다** — heuristic 분모
 *     (`stats.reportsScanned`)가 부풀지 않아야 한다.
 *   - 구독 해제 후에는 늦게 도착한 로드가 콜백을 부르지 않는다.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * `lib/firebase` 는 모듈 로드 시점에 `initializeAuth` 를 부른다 — VITE_FIREBASE_*
 * 없이는 import 만으로 죽는다(`useProjectAuditLog.test.ts` 와 같은 이유). 테스트는
 * 페이크 deps 를 주입하므로 실제 Firestore 배선은 한 번도 호출되지 않는다.
 */
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));

const {
  selectActivityTasks,
  selectReplayableMissions,
  subscribeToMissionReplay,
  subscribeToReplayableMissions,
} = await import("../../src/services/missionReplayService");
type MissionReplayDeps =
  import("../../src/services/missionReplayService").MissionReplayDeps;
type MissionReplayState =
  import("../../src/services/missionReplayService").MissionReplayState;
type ReplayMissionsState =
  import("../../src/services/missionReplayService").ReplayMissionsState;
import type { Activity } from "../../src/types/activity";
import type { Agent } from "../../src/types/agent";
import type { MergeHistoryEntry } from "../../src/types/mergeHistory";
import type { Mission } from "../../src/types/mission";
import type { ProjectAuditEvent } from "../../src/types/projectAudit";
import type { Task } from "../../src/types/task";
import type { ReplayAuditLogRow } from "../../src/lib/replay/beats";

const T0 = new Date("2026-08-01T09:00:00Z");
const NOW = new Date("2026-08-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** Firestore 가 던지는 모양 그대로(code 로 판정된다). */
function permissionDenied(): Error & { code: string } {
  const err = new Error("Missing or insufficient permissions.") as Error & {
    code: string;
  };
  err.code = "permission-denied";
  return err;
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "proj-1",
    goal: "Replay 구독 계층",
    templateId: "feature",
    status: "completed",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a"],
    contextLog: [
      {
        type: "step.completed",
        ts: at(10),
        payload: { stepIndex: 0, agentId: "agent-x" },
      },
    ],
    launchedAt: T0,
    lastActivityAt: at(90),
    completedAt: at(90),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-a",
    projectId: "proj-1",
    contextId: "mission-1",
    title: "구독 계층",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-x",
    claimedAt: at(5),
    scope: ["src/services/missionReplayService.ts"],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: at(1),
    updatedAt: at(80),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-x",
    projectId: "proj-1",
    ownerId: "uid-owner",
    name: "frontend-1",
    model: "claude",
    role: "frontend",
    status: "idle",
    currentTaskId: null,
    command: "claude",
    skillFile: "frontend.md",
    createdAt: T0,
    ...overrides,
  };
}

const REPORT = [
  "✅ 완료 보고",
  "- 문제: 완료 미션을 볼 방법이 없었다",
  "- 접근: 구독 계층 추가",
  "- 검증: vitest 통과",
  "- PR: https://github.com/melocream/marblo/pull/901",
].join("\n");

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    taskId: "task-a",
    agentId: "agent-x",
    message: REPORT,
    createdAt: at(70),
    ...overrides,
  };
}

function makeAuditRow(
  overrides: Partial<ReplayAuditLogRow> = {},
): ReplayAuditLogRow {
  return {
    id: "led-1",
    agentId: "agent-x",
    toolName: "update_task_status",
    params: { task_id: "task-a" },
    success: true,
    duration: 12,
    createdAt: at(60),
    ...overrides,
  };
}

function makeProjectAuditEvent(
  overrides: Partial<ProjectAuditEvent> = {},
): ProjectAuditEvent {
  return {
    id: "hum-1",
    projectId: "proj-1",
    actorUid: "uid-owner",
    actorName: "사장님",
    type: "task.status_changed",
    taskId: "task-a",
    targetId: "task-a",
    metadata: { from: "REVIEW", to: "DONE" },
    createdAt: at(85),
    ...overrides,
  };
}

function makeMergeEntry(
  overrides: Partial<MergeHistoryEntry> = {},
): MergeHistoryEntry {
  return {
    id: "mrg-1",
    projectId: "proj-1",
    taskId: "task-a",
    repoRoot: "/repo",
    branch: "feat/x",
    baseRef: "main",
    headSha: "deadbeef",
    mode: "manual",
    mergedAt: at(88),
    filesChanged: 3,
    linesAdded: 120,
    linesDeleted: 4,
    ...overrides,
  };
}

interface FakeOverrides extends Partial<MissionReplayDeps> {
  missions?: Mission[];
  tasks?: Task[];
  agents?: Agent[];
  activities?: Record<string, Activity[]>;
  auditLogs?: ReplayAuditLogRow[];
  projectAuditEvents?: ProjectAuditEvent[];
  mergeHistory?: MergeHistoryEntry[];
}

/** 기본은 전부 성공하는 배선. 테스트는 필요한 칸만 실패로 갈아끼운다. */
function makeDeps(overrides: FakeOverrides = {}): MissionReplayDeps {
  const missions = overrides.missions ?? [makeMission()];
  const tasks = overrides.tasks ?? [makeTask()];
  const activities = overrides.activities ?? { "task-a": [makeActivity()] };
  return {
    loadMissions: async () => missions,
    subscribeToMissions: () => () => {},
    loadMission: async (missionId) =>
      missions.find((m) => m.id === missionId) ?? null,
    subscribeToMission: () => () => {},
    loadTasks: async () => tasks,
    loadAgents: async () => overrides.agents ?? [makeAgent()],
    loadActivities: async (taskId) => activities[taskId] ?? [],
    loadAuditLogs: async () => overrides.auditLogs ?? [makeAuditRow()],
    loadProjectAuditEvents: async () =>
      overrides.projectAuditEvents ?? [makeProjectAuditEvent()],
    loadMergeHistory: async () => overrides.mergeHistory ?? [makeMergeEntry()],
    ...stripFixtures(overrides),
  };
}

/** fixture 전용 키를 걷어내고 deps 오버라이드만 남긴다. */
function stripFixtures(overrides: FakeOverrides): Partial<MissionReplayDeps> {
  const {
    missions: _m,
    tasks: _t,
    agents: _a,
    activities: _ac,
    auditLogs: _al,
    projectAuditEvents: _pa,
    mergeHistory: _mh,
    ...deps
  } = overrides;
  return deps;
}

/** 마이크로태스크 큐를 비운다(로드 체인이 2단계라 넉넉히 돈다). */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

// ── 순수 선별 함수 ──────────────────────────────────────────────

describe("selectReplayableMissions", () => {
  it("완료 미션만 최근 완료순으로 남긴다", () => {
    const list = selectReplayableMissions([
      makeMission({ id: "old", completedAt: at(10) }),
      makeMission({ id: "running", status: "running", completedAt: null }),
      makeMission({ id: "new", completedAt: at(100) }),
      makeMission({ id: "abandoned", status: "abandoned" }),
    ]);
    expect(list.map((m) => m.id)).toEqual(["new", "old"]);
  });
});

describe("selectActivityTasks", () => {
  it("최근 갱신순 상위 N건만 고른다 — 나머지는 애초에 읽지 않는다", () => {
    const tasks = [
      makeTask({ id: "t1", updatedAt: at(10) }),
      makeTask({ id: "t2", updatedAt: at(30) }),
      makeTask({ id: "t3", updatedAt: at(20) }),
    ];
    expect(selectActivityTasks(tasks, 2).map((t) => t.id)).toEqual([
      "t2",
      "t3",
    ]);
    expect(selectActivityTasks(tasks, 0)).toEqual([]);
  });
});

// ── 목록 구독 ───────────────────────────────────────────────────

describe("subscribeToReplayableMissions", () => {
  it("1회 읽기 게이트를 통과한 뒤에만 실시간 구독을 연다", async () => {
    const subscribeToMissions = vi.fn(() => () => {});
    const states: ReplayMissionsState[] = [];
    const sub = subscribeToReplayableMissions("proj-1", (s) => states.push(s), {
      deps: makeDeps({ subscribeToMissions }),
    });

    expect(states[0]).toEqual({ status: "loading" });
    expect(subscribeToMissions).not.toHaveBeenCalled();

    await flush();
    expect(states.at(-1)).toMatchObject({ status: "ready" });
    expect(subscribeToMissions).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it("권한 거부를 빈 목록으로 위장하지 않는다", async () => {
    const states: ReplayMissionsState[] = [];
    const sub = subscribeToReplayableMissions("proj-1", (s) => states.push(s), {
      deps: makeDeps({
        loadMissions: async () => {
          throw permissionDenied();
        },
      }),
    });
    await flush();
    expect(states.at(-1)).toEqual({ status: "denied" });
    sub.unsubscribe();
  });

  it("완료 미션이 0건인 것은 에러가 아니라 빈 ready 다", async () => {
    const states: ReplayMissionsState[] = [];
    const sub = subscribeToReplayableMissions("proj-1", (s) => states.push(s), {
      deps: makeDeps({ missions: [makeMission({ status: "running" })] }),
    });
    await flush();
    expect(states.at(-1)).toEqual({ status: "ready", missions: [] });
    sub.unsubscribe();
  });

  it("권한 외 실패는 error 로 구분해 올린다", async () => {
    const states: ReplayMissionsState[] = [];
    const sub = subscribeToReplayableMissions("proj-1", (s) => states.push(s), {
      deps: makeDeps({
        loadMissions: async () => {
          throw new Error("network down");
        },
      }),
    });
    await flush();
    expect(states.at(-1)).toEqual({
      status: "error",
      message: "network down",
    });
    sub.unsubscribe();
  });
});

// ── 단건 Replay 조립 ────────────────────────────────────────────

async function loadReplay(
  overrides: FakeOverrides = {},
  missionId = "mission-1",
): Promise<{ states: MissionReplayState[]; last: MissionReplayState }> {
  const states: MissionReplayState[] = [];
  const sub = subscribeToMissionReplay(
    { missionId, projectId: "proj-1" },
    (s) => states.push(s),
    { deps: makeDeps(overrides), now: () => NOW },
  );
  await flush();
  sub.unsubscribe();
  return { states, last: states[states.length - 1] };
}

describe("subscribeToMissionReplay", () => {
  it("여섯 소스를 모아 Replay 를 조립한다", async () => {
    const { last } = await loadReplay();
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;

    const { replay } = last;
    expect(replay.missionId).toBe("mission-1");
    expect(replay.provenance.generatedAt).toEqual(NOW);
    expect(replay.provenance.sources).toEqual({
      "mission.contextLog": "ok",
      task: "ok",
      "task.activity": "ok",
      audit_logs: "ok",
      projectAuditLog: "ok",
      merge_history: "ok",
    });
    // 네 레인이 다 살아 있다.
    expect(new Set(replay.beats.map((b) => b.lane))).toEqual(
      new Set(["orchestrator", "agent", "human", "system"]),
    );
    expect(replay.stats.filesChanged).toBe(3);
    expect(replay.stats.reportsScanned).toBe(1);
    expect(replay.prUrls).toEqual([
      "https://github.com/melocream/marblo/pull/901",
    ]);
    expect(replay.cast[0]?.vendor).toBe("claude");
    expect(last.sourceErrors).toEqual({});
  });

  it("★C2: projectAuditLog 가 막혀도 터지지 않고 denied 로 표기한다", async () => {
    const { last } = await loadReplay({
      loadProjectAuditEvents: async () => {
        throw permissionDenied();
      },
    });
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;

    expect(last.replay.provenance.sources.projectAuditLog).toBe("denied");
    // human 레인은 통째로 비지만 나머지는 그대로 산다.
    expect(last.replay.beats.some((b) => b.lane === "human")).toBe(false);
    expect(last.replay.beats.some((b) => b.lane === "agent")).toBe(true);
    // 권한 문제는 에러가 아니다 — 화면에 빨간 박스를 띄우지 않는다.
    expect(last.sourceErrors).toEqual({});
  });

  it("원장이 막힌 미인증 세션에서도 부분 데이터로 완주한다", async () => {
    const { last } = await loadReplay({
      loadAuditLogs: async () => {
        throw permissionDenied();
      },
      loadProjectAuditEvents: async () => {
        throw permissionDenied();
      },
      loadActivities: async () => {
        throw permissionDenied();
      },
    });
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;

    const sources = last.replay.provenance.sources;
    expect(sources.audit_logs).toBe("denied");
    expect(sources.projectAuditLog).toBe("denied");
    expect(sources["task.activity"]).toBe("denied");
    expect(sources.task).toBe("ok");
    expect(sources.merge_history).toBe("ok");
    // 읽지 못한 완료보고를 "0건 통과"로 세지 않는다 — 분모가 0 이다.
    expect(last.replay.stats.reportsScanned).toBe(0);
  });

  it("권한 외 실패는 denied 로 위장하지 않고 sourceErrors 로 올린다", async () => {
    const { last } = await loadReplay({
      loadMergeHistory: async () => {
        throw new Error("network down");
      },
    });
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;

    expect(last.replay.provenance.sources.merge_history).toBe("empty");
    expect(last.sourceErrors.merge_history).toBe("network down");
    expect(last.replay.stats.filesChanged).toBe(0);
  });

  it("agents 로드 실패는 레인을 죽이지 않고 벤더만 unknown 으로 떨어뜨린다", async () => {
    const { last } = await loadReplay({
      loadAgents: async () => {
        throw new Error("boom");
      },
    });
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;

    expect(last.replay.cast[0]?.vendor).toBe("unknown");
    // agents 는 ReplaySource 가 아니므로 어떤 소스 칸도 오염되지 않는다.
    expect(last.sourceErrors).toEqual({});
    expect(last.replay.provenance.sources.task).toBe("ok");
  });

  it("상한 밖 태스크는 키를 만들지 않아 완료보고 분모가 부풀지 않는다", async () => {
    const states: MissionReplayState[] = [];
    const tasks = [
      makeTask({ id: "t-new", updatedAt: at(80) }),
      makeTask({ id: "t-old", updatedAt: at(20) }),
    ];
    const loadActivities = vi.fn(async (taskId: string) =>
      taskId === "t-new" ? [makeActivity({ taskId: "t-new" })] : [],
    );
    const sub = subscribeToMissionReplay(
      { missionId: "mission-1", projectId: "proj-1" },
      (s) => states.push(s),
      {
        deps: makeDeps({ tasks, loadActivities }),
        now: () => NOW,
        activityTaskCap: 1,
      },
    );
    await flush();
    sub.unsubscribe();

    const last = states[states.length - 1];
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;
    expect(loadActivities).toHaveBeenCalledTimes(1);
    expect(loadActivities).toHaveBeenCalledWith("t-new");
    // 태스크는 2건이지만 보고를 읽어본 것은 1건뿐이다.
    expect(last.replay.stats.tasks).toBe(2);
    expect(last.replay.stats.reportsScanned).toBe(1);
  });

  it("남의 미션 태스크는 조인에서 빠진다(contextId 단독 판정)", async () => {
    const { last } = await loadReplay({
      tasks: [makeTask(), makeTask({ id: "other", contextId: "mission-2" })],
    });
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;
    expect(last.replay.stats.tasks).toBe(1);
  });

  it("미션이 없으면 not-found, 완료 전이면 not-completed", async () => {
    const missing = await loadReplay({ missions: [] }, "mission-404");
    expect(missing.last).toEqual({
      status: "unavailable",
      reason: "not-found",
    });

    const running = await loadReplay({
      missions: [makeMission({ status: "running", completedAt: null })],
    });
    expect(running.last).toEqual({
      status: "unavailable",
      reason: "not-completed",
    });
  });

  it("미션 문서 자체가 막히면 denied — 빈 Replay 로 위장하지 않는다", async () => {
    const { last } = await loadReplay({
      loadMission: async () => {
        throw permissionDenied();
      },
    });
    expect(last).toEqual({ status: "unavailable", reason: "denied" });
  });

  it("해제 뒤 도착한 로드는 콜백을 부르지 않는다", async () => {
    const states: MissionReplayState[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sub = subscribeToMissionReplay(
      { missionId: "mission-1", projectId: "proj-1" },
      (s) => states.push(s),
      {
        deps: makeDeps({
          loadTasks: async () => {
            await gate;
            return [makeTask()];
          },
        }),
        now: () => NOW,
      },
    );
    await flush();
    sub.unsubscribe();
    const seen = states.length;
    release?.();
    await flush();
    expect(states.length).toBe(seen);
    expect(states.some((s) => s.status === "ready")).toBe(false);
  });

  it("미션 문서만 실시간으로 따라간다 — 갱신되면 다시 그린다", async () => {
    const states: MissionReplayState[] = [];
    let push: ((mission: Mission | null) => void) | null = null;
    const sub = subscribeToMissionReplay(
      { missionId: "mission-1", projectId: "proj-1" },
      (s) => states.push(s),
      {
        deps: makeDeps({
          subscribeToMission: (_missionId, callback) => {
            push = callback;
            return () => {};
          },
        }),
        now: () => NOW,
      },
    );
    await flush();
    expect(states.at(-1)?.status).toBe("ready");

    push?.(
      makeMission({
        contextLog: [
          {
            type: "step.completed",
            ts: at(10),
            payload: { agentId: "agent-x" },
          },
          { type: "mission.completed", ts: at(95), payload: {} },
        ],
      }),
    );
    const last = states[states.length - 1];
    expect(last.status).toBe("ready");
    if (last.status !== "ready") return;
    expect(
      last.replay.beats.filter((b) => b.source === "mission.contextLog").length,
    ).toBe(2);
    sub.unsubscribe();
  });
});
