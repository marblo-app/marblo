/**
 * Mission Replay — 비트 매퍼/병합 테스트.
 *
 * 핀하는 계약:
 *   - 소속 판정은 **`tasks.contextId === missionId` 단독**(§2.1 1급 조인키).
 *     `mission.taskIds` 에 들어 있어도 contextId 가 다르면 안 들어온다.
 *   - `audit_logs`/`projectAuditLog`/`merge_history` 는 taskId 로만 붙고,
 *     귀속 불가한 행은 억지로 넣지 않고 버린다(설계 C1).
 *   - 비트 id 는 결정적이다 — 같은 입력이면 같은 id, 재집계해도 안 흔들린다.
 *   - 시간순 정렬 + 동시각은 id 로 안정 정렬(입력 도착 순서와 무관).
 *   - ★비트가 **담지 않는 것**: audit_logs.params, merge_history 의
 *     repoRoot/branch/headSha, 사람의 uid·실명. 담지 않으면 레닭션이 실수할
 *     표면 자체가 없다.
 *   - 익명 별칭은 미션 안에서의 등장 순서다(R2b/R2c/R10).
 */
import { describe, expect, it } from "vitest";
import {
  buildAuditLogBeats,
  buildMergeBeats,
  buildProjectAuditBeats,
  buildReplayBeats,
  createReplayAliases,
  replayBeatId,
  resolveAuditTaskId,
  selectMissionTasks,
  type MissionReplaySources,
} from "../../src/lib/replay/beats";
import type { Mission } from "../../src/types/mission";
import type { Task } from "../../src/types/task";

const T0 = new Date("2026-08-01T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "proj-1",
    goal: "완료이력 탭에 Replay 뷰 붙이기",
    templateId: "feature",
    status: "completed",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a"],
    contextLog: [],
    launchedAt: T0,
    lastActivityAt: at(60),
    completedAt: at(60),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-a",
    projectId: "proj-1",
    contextId: "mission-1",
    title: "타임라인 컴포넌트",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-x",
    claimedAt: at(5),
    scope: ["src/components/replay/ReplayTimeline.tsx"],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: at(1),
    updatedAt: at(50),
    ...overrides,
  };
}

function sourcesOf(
  overrides: Partial<MissionReplaySources> = {},
): MissionReplaySources {
  return {
    mission: makeMission(),
    tasks: [makeTask()],
    ...overrides,
  };
}

describe("selectMissionTasks — contextId 단독 판정", () => {
  it("contextId 가 missionId 인 태스크만 고른다", () => {
    const mission = makeMission();
    const mine = makeTask({ id: "mine", contextId: "mission-1" });
    const board = makeTask({ id: "board", contextId: "board" });
    const lane = makeTask({ id: "lane", contextId: "lane:abc" });
    const other = makeTask({ id: "other", contextId: "mission-2" });
    expect(
      selectMissionTasks(mission, [mine, board, lane, other]).map((t) => t.id),
    ).toEqual(["mine"]);
  });

  it("mission.taskIds 에 있어도 contextId 가 다르면 안 들어온다 (드리프트 방어)", () => {
    const mission = makeMission({ taskIds: ["drifted"] });
    const drifted = makeTask({ id: "drifted", contextId: "mission-99" });
    expect(selectMissionTasks(mission, [drifted])).toEqual([]);
  });
});

describe("replayBeatId — 결정적 id", () => {
  it("같은 (source, sourceId) 는 항상 같은 id", () => {
    expect(replayBeatId("task", "task-a:created")).toBe(
      replayBeatId("task", "task-a:created"),
    );
  });

  it("소스가 다르면 id 가 다르다", () => {
    expect(replayBeatId("task", "x")).not.toBe(
      replayBeatId("task.activity", "x"),
    );
  });

  it("원본 문서 id 를 그대로 노출하지 않는다 (R16)", () => {
    const id = replayBeatId("task.activity", "aBcDeFgH123456789012");
    expect(id).not.toContain("aBcDeFgH123456789012");
    expect(id).toMatch(/^act-[0-9a-f]{16}$/);
  });

  it("재집계해도 비트 id 집합이 동일하다", () => {
    const sources = sourcesOf({
      mission: makeMission({
        contextLog: [
          { ts: at(2), type: "step.started", payload: { stepIndex: 0 } },
        ],
      }),
    });
    const first = buildReplayBeats(sources).map((b) => b.id);
    const second = buildReplayBeats(sources).map((b) => b.id);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length); // 충돌 없음
  });
});

describe("buildReplayBeats — 병합과 정렬", () => {
  it("여섯 소스를 시간순 한 줄기로 합친다", () => {
    const beats = buildReplayBeats(
      sourcesOf({
        mission: makeMission({
          contextLog: [
            { ts: at(3), type: "step.started", payload: { stepIndex: 0 } },
            { ts: at(55), type: "step.completed", payload: { stepIndex: 0 } },
          ],
        }),
        activitiesByTaskId: {
          "task-a": [
            {
              id: "act-1",
              taskId: "task-a",
              agentId: "agent-x",
              message: "구현 시작",
              createdAt: at(10),
            },
          ],
        },
        auditLogs: [
          {
            id: "led-1",
            agentId: "agent-x",
            toolName: "submit_for_review",
            params: { task_id: "task-a" },
            success: true,
            duration: 120,
            createdAt: at(45),
          },
        ],
        mergeHistory: [
          {
            id: "mrg-1",
            projectId: "proj-1",
            taskId: "task-a",
            repoRoot: "/Users/someone/code/marblo",
            branch: "feature/x",
            baseRef: "main",
            headSha: "abc123",
            mode: "auto",
            mergedAt: at(58),
            filesChanged: 4,
            linesAdded: 120,
            linesDeleted: 8,
            changeType: "code",
          },
        ],
      }),
    );

    const times = beats.map((b) => b.ts.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(beats.map((b) => b.source)).toContain("mission.contextLog");
    expect(beats.map((b) => b.source)).toContain("merge_history");
    expect(beats.map((b) => b.source)).toContain("audit_logs");
  });

  it("동시각 비트는 입력 도착 순서와 무관하게 같은 순서로 나온다", () => {
    const activities = [
      {
        id: "act-1",
        taskId: "task-a",
        agentId: "agent-x",
        message: "A",
        createdAt: at(10),
      },
      {
        id: "act-2",
        taskId: "task-a",
        agentId: "agent-x",
        message: "B",
        createdAt: at(10),
      },
    ];
    const forward = buildReplayBeats(
      sourcesOf({ activitiesByTaskId: { "task-a": activities } }),
    ).map((b) => b.id);
    const reversed = buildReplayBeats(
      sourcesOf({
        activitiesByTaskId: { "task-a": [...activities].reverse() },
      }),
    ).map((b) => b.id);
    expect(reversed).toEqual(forward);
  });

  it("모든 비트에 민감도가 붙어 있다 (집계 시점 분류)", () => {
    const beats = buildReplayBeats(
      sourcesOf({
        mission: makeMission({
          contextLog: [
            { ts: at(3), type: "supervisor.note", payload: { note: "메모" } },
          ],
        }),
      }),
    );
    expect(beats.length).toBeGreaterThan(0);
    for (const beat of beats) {
      expect(["private", "process", "summary", "detail"]).toContain(
        beat.sensitivity,
      );
    }
  });
});

describe("태스크 라이프사이클 비트", () => {
  it("생성 / 선점 / 현재 상태 마커를 세운다", () => {
    const beats = buildReplayBeats(sourcesOf()).filter(
      (b) => b.source === "task",
    );
    expect(beats.map((b) => b.kind)).toEqual([
      "task.created",
      "task.claimed",
      "task.status",
    ]);
  });

  it("TODO 는 현재-상태 마커를 세우지 않는다 (생성 줄과 같은 말)", () => {
    const beats = buildReplayBeats(
      sourcesOf({
        tasks: [makeTask({ status: "TODO", claimedBy: null, claimedAt: null })],
      }),
    ).filter((b) => b.source === "task");
    expect(beats.map((b) => b.kind)).toEqual(["task.created"]);
  });

  it("CLAIMED + 선점 마커가 있으면 상태 마커를 생략한다", () => {
    const beats = buildReplayBeats(
      sourcesOf({ tasks: [makeTask({ status: "CLAIMED" })] }),
    ).filter((b) => b.source === "task");
    expect(beats.map((b) => b.kind)).toEqual(["task.created", "task.claimed"]);
  });
});

describe("완료보고 비트", () => {
  const report = [
    "✅ 완료 보고",
    "- 문제: 타임라인이 비어 보였다",
    "- 접근: 비트 매퍼 추가",
    "- 검증: vitest + tsc",
    "- PR: https://github.com/x/y/pull/1",
  ].join("\n");

  it("완료보고는 구조화 비트(summary), 일반 activity 는 private", () => {
    const beats = buildReplayBeats(
      sourcesOf({
        activitiesByTaskId: {
          "task-a": [
            {
              id: "act-1",
              taskId: "task-a",
              agentId: "agent-x",
              message: "진행 중",
              createdAt: at(10),
            },
            {
              id: "act-2",
              taskId: "task-a",
              agentId: "agent-x",
              message: report,
              createdAt: at(48),
            },
          ],
        },
      }),
    ).filter((b) => b.source === "task.activity");

    const [progress, done] = beats;
    expect(progress.kind).toBe("task.activity");
    expect(progress.sensitivity).toBe("private");
    expect(done.kind).toBe("task.completion_report");
    expect(done.sensitivity).toBe("summary");
    expect(done.detail).toContain("problem: 타임라인이 비어 보였다");
  });
});

describe("원장(audit_logs) 비트 — taskId 로만 붙는다", () => {
  const missionTaskIds = new Set(["task-a"]);
  const aliases = createReplayAliases(sourcesOf());

  it("params.task_id 로 폴백해 귀속한다", () => {
    expect(
      resolveAuditTaskId({
        id: "l",
        toolName: "x",
        params: { task_id: " task-a " },
        createdAt: T0,
      }),
    ).toBe("task-a");
  });

  it("귀속 불가한 행(taskId 없음 / 남의 태스크)은 버린다", () => {
    const beats = buildAuditLogBeats(
      [
        { id: "l1", toolName: "get_agents", params: {}, createdAt: at(5) },
        {
          id: "l2",
          toolName: "add_activity",
          params: { task_id: "someone-else" },
          createdAt: at(6),
        },
        {
          id: "l3",
          toolName: "add_activity",
          taskId: "task-a",
          createdAt: at(7),
        },
      ],
      missionTaskIds,
      aliases,
    );
    expect(beats.map((b) => b.id.startsWith("led-"))).toEqual([true]);
    expect(beats[0].taskId).toBe("task-a");
  });

  it("★params 를 비트에 싣지 않는다 (지시문·경로·시크릿 표면 제거)", () => {
    const beats = buildAuditLogBeats(
      [
        {
          id: "l1",
          toolName: "spawn_agent",
          taskId: "task-a",
          params: {
            task_id: "task-a",
            instruction: "sk-ant-super-secret-key-value",
            cwd: "/Users/realname/code",
          },
          success: true,
          duration: 42,
          createdAt: at(9),
        },
      ],
      missionTaskIds,
      aliases,
    );
    const blob = JSON.stringify(beats);
    expect(blob).not.toContain("sk-ant-super-secret");
    expect(blob).not.toContain("/Users/realname");
    expect(beats[0].title).toBe("spawn_agent");
    expect(beats[0].detail).toBe("42ms");
  });

  it("실패한 툴 호출은 title 에 표시된다", () => {
    const beats = buildAuditLogBeats(
      [
        {
          id: "l1",
          toolName: "claim_task",
          taskId: "task-a",
          success: false,
          createdAt: at(9),
        },
      ],
      missionTaskIds,
      aliases,
    );
    expect(beats[0].title).toBe("claim_task · failed");
  });
});

describe("사람 행위(projectAuditLog) 비트", () => {
  it("uid·실명 대신 member-N 별칭만 싣는다 (R2b)", () => {
    const sources = sourcesOf({
      projectAuditEvents: [
        {
          id: "h1",
          projectId: "proj-1",
          actorUid: "uid-secret-123",
          actorName: "김동원",
          type: "task.status_changed",
          taskId: "task-a",
          targetId: "task-a",
          metadata: { from: "REVIEW", to: "DONE" },
          createdAt: at(52),
        },
      ],
    });
    const beats = buildProjectAuditBeats(
      sources.projectAuditEvents,
      new Set(["task-a"]),
      createReplayAliases(sources),
    );
    expect(beats[0].actorRef).toBe("member-1");
    expect(beats[0].lane).toBe("human");
    expect(beats[0].title).toBe("task.status_changed · REVIEW → DONE");
    const blob = JSON.stringify(beats);
    expect(blob).not.toContain("uid-secret-123");
    expect(blob).not.toContain("김동원");
  });
});

describe("병합(merge_history) 비트 — 비식별 수치만", () => {
  it("repoRoot / branch / headSha 를 담지 않는다 (R11/R12)", () => {
    const beats = buildMergeBeats(
      [
        {
          id: "m1",
          projectId: "proj-1",
          taskId: "task-a",
          repoRoot: "/Users/realname/code/marblo",
          branch: "marblo/secret-feature",
          baseRef: "main",
          headSha: "deadbeefcafe",
          mode: "auto",
          mergedAt: at(58),
          filesChanged: 4,
          linesAdded: 120,
          linesDeleted: 8,
          changeType: "code",
        },
      ],
      new Set(["task-a"]),
    );
    const blob = JSON.stringify(beats);
    expect(blob).not.toContain("/Users/realname");
    expect(blob).not.toContain("secret-feature");
    expect(blob).not.toContain("deadbeefcafe");
    expect(beats[0].title).toBe("+120/-8 · 4 files");
    expect(beats[0].lane).toBe("system");
  });

  it("수치가 없는 옛 행도 비트는 만든다", () => {
    const beats = buildMergeBeats(
      [
        {
          id: "m1",
          projectId: "proj-1",
          taskId: "task-a",
          repoRoot: "/r",
          branch: "b",
          baseRef: "main",
          headSha: "sha",
          mode: "manual",
          mergedAt: at(58),
        },
      ],
      new Set(["task-a"]),
    );
    expect(beats[0].title).toBe("merge");
  });
});

describe("익명 별칭", () => {
  it("등장 순서대로 agent-N 을 매기고 벤더는 남긴다 (R2c)", () => {
    const sources = sourcesOf({
      tasks: [
        makeTask({ id: "task-a", claimedBy: "agent-late", claimedAt: at(30) }),
        makeTask({ id: "task-b", claimedBy: "agent-early", claimedAt: at(5) }),
      ],
      agents: [
        {
          id: "agent-early",
          projectId: "proj-1",
          ownerId: "o",
          name: "frontend-1",
          model: "claude",
          role: "frontend",
          status: "idle",
          currentTaskId: null,
          command: "claude",
          skillFile: "frontend",
          createdAt: T0,
        },
        {
          id: "agent-late",
          projectId: "proj-1",
          ownerId: "o",
          name: "backend-1",
          model: "gpt",
          role: "backend",
          status: "idle",
          currentTaskId: null,
          command: "codex",
          skillFile: "backend",
          createdAt: T0,
        },
      ],
    });
    const aliases = createReplayAliases(sources);
    expect(aliases.agentRef("agent-early")).toBe("agent-1 · claude");
    expect(aliases.agentRef("agent-late")).toBe("agent-2 · gpt");
  });

  it("에이전트 문서가 없으면 벤더가 unknown 으로 떨어진다", () => {
    const aliases = createReplayAliases(sourcesOf());
    expect(aliases.agentRef("agent-x")).toBe("agent-1 · unknown");
  });

  it("미션에 등장하지 않은 id 는 별칭이 없다", () => {
    const aliases = createReplayAliases(sourcesOf());
    expect(aliases.agentRef("stranger")).toBeNull();
    expect(aliases.agentRef(null)).toBeNull();
    expect(aliases.actorRef(undefined)).toBeNull();
  });
});
