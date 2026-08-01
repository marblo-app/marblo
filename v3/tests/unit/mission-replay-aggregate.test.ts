/**
 * Mission Replay — 집계(`buildMissionReplay`) 정확도 테스트.
 *
 * 핀하는 계약:
 *   - 완료 미션(`status === "completed"`)만 Replay 를 만든다. 나머지는 null.
 *   - 통계는 미션 소속 태스크(contextId 조인)만 센다. 남의 태스크·남의 병합
 *     이력이 수치에 섞이지 않는다.
 *   - `provenance` 는 `denied`(권한 없음)와 `empty`(기록 0건)를 가른다 —
 *     빈 레인을 "아무도 안 했다"로 그리지 않기 위한 근거(설계 C2/R4).
 *   - 완료보고를 **읽은** 태스크만 heuristic 분모에 들어간다(리스너 상한).
 *   - 캐스트는 벤더/모델 3축을 그대로 남기고 사람 식별자는 남기지 않는다.
 *   - 집계 시각은 주입 가능하다(골든 스냅샷 전제).
 */
import { describe, expect, it } from "vitest";
import {
  buildMissionReplay,
  isReplayableMission,
} from "../../src/lib/replay/missionReplay";
import type { MissionReplaySources } from "../../src/lib/replay/beats";
import type { Mission, MissionStatus } from "../../src/types/mission";
import type { Task } from "../../src/types/task";

const T0 = new Date("2026-08-01T09:00:00Z");
const NOW = new Date("2026-08-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "proj-1",
    goal: "Replay 집계 코어",
    templateId: "feature",
    status: "completed",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a", "task-b"],
    contextLog: [],
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
    title: "집계 코어",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-x",
    claimedAt: at(5),
    scope: ["src/lib/replay/missionReplay.ts"],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: at(1),
    updatedAt: at(80),
    ...overrides,
  };
}

const REPORT = [
  "✅ 완료 보고",
  "- 문제: 완료 미션을 볼 방법이 없었다",
  "- 접근: 순수 집계 함수 추가",
  "- 검증: vitest 통과 + tsc green",
  "- PR: https://github.com/melocream/marblo/pull/900",
].join("\n");

function build(
  sources: Partial<MissionReplaySources> = {},
  options?: Parameters<typeof buildMissionReplay>[1],
) {
  return buildMissionReplay(
    {
      mission: makeMission(),
      tasks: [makeTask()],
      ...sources,
    },
    { now: NOW, ...options },
  );
}

describe("Replay 대상 판정", () => {
  it("완료 미션만 Replay 를 만든다", () => {
    const others: MissionStatus[] = [
      "planning",
      "active",
      "waiting_for_human",
      "sleeping",
      "abandoned",
    ];
    for (const status of others) {
      expect(isReplayableMission({ status }), status).toBe(false);
      expect(build({ mission: makeMission({ status }) }), status).toBeNull();
    }
    expect(isReplayableMission({ status: "completed" })).toBe(true);
    expect(build()).not.toBeNull();
  });
});

describe("헤드라인", () => {
  it("미션 문서를 그대로 옮긴다 + 소요시간은 launched→completed", () => {
    const replay = build()!;
    expect(replay.replayVersion).toBe(1);
    expect(replay.missionId).toBe("mission-1");
    expect(replay.projectId).toBe("proj-1");
    expect(replay.goal).toBe("Replay 집계 코어");
    expect(replay.templateId).toBe("feature");
    expect(replay.stats.durationMs).toBe(90 * 60_000);
  });

  it("completedAt 이 비면 lastActivityAt 으로 떨어진다", () => {
    const replay = build({
      mission: makeMission({ completedAt: null, lastActivityAt: at(30) }),
    })!;
    expect(replay.completedAt).toBeNull();
    expect(replay.stats.durationMs).toBe(30 * 60_000);
  });

  it("시계 역전(음수 구간)은 0 으로 접는다", () => {
    const replay = build({
      mission: makeMission({ launchedAt: at(50), completedAt: at(10) }),
    })!;
    expect(replay.stats.durationMs).toBe(0);
  });

  it("집계 시각은 주입한 값이 그대로 쓰인다", () => {
    expect(build()!.provenance.generatedAt).toEqual(NOW);
  });
});

describe("통계 — 미션 소속만 센다", () => {
  it("남의 태스크와 남의 병합 이력은 수치에 섞이지 않는다", () => {
    const replay = build({
      tasks: [
        makeTask({ id: "task-a", status: "DONE", claimedBy: "agent-x" }),
        makeTask({ id: "task-b", status: "REVIEW", claimedBy: "agent-y" }),
        makeTask({ id: "outsider", contextId: "board", claimedBy: "agent-z" }),
      ],
      mergeHistory: [
        {
          id: "m1",
          projectId: "proj-1",
          taskId: "task-a",
          repoRoot: "/r",
          branch: "b",
          baseRef: "main",
          headSha: "s",
          mode: "auto",
          mergedAt: at(70),
          filesChanged: 4,
          linesAdded: 120,
          linesDeleted: 8,
        },
        {
          id: "m2",
          projectId: "proj-1",
          taskId: "outsider",
          repoRoot: "/r",
          branch: "b",
          baseRef: "main",
          headSha: "s",
          mode: "auto",
          mergedAt: at(71),
          filesChanged: 999,
          linesAdded: 999,
          linesDeleted: 999,
        },
        {
          id: "m3",
          projectId: "proj-1",
          taskId: null,
          repoRoot: "/r",
          branch: "b",
          baseRef: "main",
          headSha: "s",
          mode: "manual",
          mergedAt: at(72),
          filesChanged: 7,
        },
      ],
    })!;

    expect(replay.stats.tasks).toBe(2);
    expect(replay.stats.tasksDone).toBe(1);
    expect(replay.stats.agents).toBe(2);
    expect(replay.stats.filesChanged).toBe(4);
    expect(replay.stats.linesAdded).toBe(120);
    expect(replay.stats.linesDeleted).toBe(8);
  });

  it("retries 는 합, costTotal 은 값이 하나도 없으면 null", () => {
    const none = build({
      tasks: [makeTask({ id: "task-a", retriesCount: 2 })],
    })!;
    expect(none.stats.retries).toBe(2);
    expect(none.stats.costTotal).toBeNull();

    const some = build({
      tasks: [
        makeTask({ id: "task-a", costTotal: 1.5 }),
        makeTask({ id: "task-b", costTotal: 0.25 }),
      ],
    })!;
    expect(some.stats.costTotal).toBeCloseTo(1.75, 6);
  });

  it("PR 은 완료보고와 task.prUrl 양쪽에서 모으고 중복을 접는다", () => {
    const replay = build({
      tasks: [
        makeTask({ id: "task-a" }),
        makeTask({
          id: "task-b",
          prUrl: "https://github.com/melocream/marblo/pull/901",
        }),
      ],
      activitiesByTaskId: {
        "task-a": [
          {
            id: "act-1",
            taskId: "task-a",
            agentId: "agent-x",
            message: REPORT,
            createdAt: at(75),
          },
        ],
      },
    })!;
    expect(replay.prUrls).toEqual([
      "https://github.com/melocream/marblo/pull/900",
      "https://github.com/melocream/marblo/pull/901",
    ]);
    expect(replay.stats.prs).toBe(2);
  });

  it("완료보고를 읽은 태스크만 heuristic 분모에 들어간다", () => {
    // ★"1건 통과"를 1/2 로 읽을지 1/1 로 읽을지가 갈리는 자리다. 구독하지
    // 못한 task-b 는 분모(reportsScanned)에서 빠져야 한다 — 구독 계층이
    // 리스너 상한 때문에 최신 N건만 읽기 때문에(설계 R5) 현실에서 흔하다.
    const replay = build({
      tasks: [makeTask({ id: "task-a" }), makeTask({ id: "task-b" })],
      activitiesByTaskId: {
        "task-a": [
          {
            id: "act-1",
            taskId: "task-a",
            agentId: "agent-x",
            message: REPORT,
            createdAt: at(75),
          },
        ],
      },
    })!;
    expect(replay.stats.testsPassed).toBe(1);
    expect(replay.stats.reportsScanned).toBe(1);
    expect(replay.stats.tasksDone).toBe(2);
  });

  it("완료보고가 없는 것과 안 읽은 것을 가른다", () => {
    // 값이 빈 배열 = "읽었는데 보고가 없더라" → 분모에 들어간다.
    const scanned = build({
      tasks: [makeTask({ id: "task-a" })],
      activitiesByTaskId: { "task-a": [] },
    })!;
    expect(scanned.stats.reportsScanned).toBe(1);
    expect(scanned.stats.testsPassed).toBe(0);

    // 키 자체가 없음 = "아직 안 읽었다" → 분모에서 빠진다.
    const unscanned = build({
      tasks: [makeTask({ id: "task-a" })],
      activitiesByTaskId: {},
    })!;
    expect(unscanned.stats.reportsScanned).toBe(0);
  });

  it("완료보고가 여러 건이면 마지막 것을 쓴다", () => {
    const stale = REPORT.replace("- PR: ", "- PR: https://old.example/1 ");
    const replay = build({
      activitiesByTaskId: {
        "task-a": [
          {
            id: "act-2",
            taskId: "task-a",
            agentId: "agent-x",
            message: stale,
            createdAt: at(70),
          },
          {
            id: "act-1",
            taskId: "task-a",
            agentId: "agent-x",
            message: REPORT,
            createdAt: at(76),
          },
        ],
      },
    })!;
    expect(replay.prUrls).toEqual([
      "https://github.com/melocream/marblo/pull/900",
    ]);
  });
});

describe("캐스트", () => {
  it("벤더/spawnedModel/detectedModelId 3축을 따로 남긴다", () => {
    const replay = build({
      tasks: [makeTask({ id: "task-a", claimedBy: "agent-x", status: "DONE" })],
      agents: [
        {
          id: "agent-x",
          projectId: "proj-1",
          ownerId: "owner-uid-secret",
          name: "frontend-1",
          model: "claude",
          spawnedModel: "claude-fable-5",
          detectedModelId: "claude-opus-5",
          role: "frontend",
          status: "idle",
          currentTaskId: null,
          command: "claude",
          skillFile: "frontend",
          createdAt: T0,
        },
      ],
    })!;
    expect(replay.cast).toHaveLength(1);
    expect(replay.cast[0]).toMatchObject({
      agentRef: "agent-1 · claude",
      vendor: "claude",
      spawnedModel: "claude-fable-5",
      detectedModelId: "claude-opus-5",
      role: "frontend",
      tasksCompleted: 1,
    });
    expect(replay.cast[0].beats).toBeGreaterThan(0);
  });

  it("에이전트 문서가 없으면 태스크 역할로 떨어지고 벤더는 unknown", () => {
    const replay = build()!;
    expect(replay.cast[0]).toMatchObject({
      vendor: "unknown",
      role: "frontend",
      spawnedModel: null,
      detectedModelId: null,
    });
  });

  it("에이전트 실 id 는 캐스트에 남지 않는다 (별칭만)", () => {
    const blob = JSON.stringify(build()!.cast);
    expect(blob).not.toContain("agent-x");
    expect(blob).toContain("agent-1 · unknown");
  });
});

describe("provenance — denied 와 empty 를 가른다", () => {
  it("권한 거부는 empty 로 뭉개지 않는다 (설계 C2)", () => {
    const replay = build({}, { sourceAccess: { projectAuditLog: "denied" } })!;
    expect(replay.provenance.sources.projectAuditLog).toBe("denied");
  });

  it("기록이 없으면 empty, 있으면 ok", () => {
    const replay = build({
      mission: makeMission({
        contextLog: [{ ts: at(3), type: "step.started", payload: {} }],
      }),
    })!;
    expect(replay.provenance.sources["mission.contextLog"]).toBe("ok");
    expect(replay.provenance.sources.task).toBe("ok");
    expect(replay.provenance.sources.audit_logs).toBe("empty");
    expect(replay.provenance.sources.merge_history).toBe("empty");
    expect(replay.provenance.sources.projectAuditLog).toBe("empty");
  });

  it("소스가 있어도 이 미션에 귀속되지 않으면 empty", () => {
    const replay = build({
      auditLogs: [
        {
          id: "l1",
          toolName: "add_activity",
          params: { task_id: "someone-else" },
          createdAt: at(9),
        },
      ],
    })!;
    expect(replay.provenance.sources.audit_logs).toBe("empty");
  });

  it("여섯 칸이 항상 전부 채워진다", () => {
    expect(Object.keys(build()!.provenance.sources).sort()).toEqual([
      "audit_logs",
      "merge_history",
      "mission.contextLog",
      "projectAuditLog",
      "task",
      "task.activity",
    ]);
  });
});

describe("결정성", () => {
  it("같은 입력이면 같은 결과 (generatedAt 고정 시)", () => {
    const sources: Partial<MissionReplaySources> = {
      mission: makeMission({
        contextLog: [
          { ts: at(3), type: "step.started", payload: { stepIndex: 0 } },
          { ts: at(85), type: "step.completed", payload: { stepIndex: 0 } },
        ],
      }),
      tasks: [makeTask({ id: "task-a" }), makeTask({ id: "task-b" })],
      activitiesByTaskId: {
        "task-a": [
          {
            id: "act-1",
            taskId: "task-a",
            agentId: "agent-x",
            message: REPORT,
            createdAt: at(75),
          },
        ],
      },
    };
    expect(JSON.stringify(build(sources))).toBe(JSON.stringify(build(sources)));
  });
});
