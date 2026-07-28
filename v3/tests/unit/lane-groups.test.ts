/**
 * 퀵레인 라인(상태 레인) 그룹핑 + 상세 드로우 히스토리 병합의 순수 규칙.
 *
 * 여기서 지키는 것 두 가지:
 *   1. **어떤 TaskStatus 도 라인 밖으로 새지 않는다.** status enum 이 늘었는데
 *      매핑을 빠뜨리면 그 상태의 레인이 화면에서 통째로 사라진다 — 카드가 안
 *      보이는 회귀는 사용자가 "레인이 지워졌다" 로 읽는다.
 *   2. **히스토리가 없는 이력을 지어내지 않는다.** 상태 전이는 per-task 로
 *      저장되지 않으므로(lib/laneTimeline 헤더 참조) task doc 이 아는 만큼만
 *      마커가 서야 하고, 같은 말이 두 줄로 반복되면 안 된다.
 */
import { describe, it, expect } from "vitest";
import {
  LANE_GROUPS,
  groupLaneRows,
  laneGroupDef,
  laneGroupOf,
} from "../../src/lib/laneGroups";
import { buildLaneTimeline } from "../../src/lib/laneTimeline";
import type { LaneRow } from "../../src/types/lane";
import type { Task, TaskStatus } from "../../src/types/task";
import type { Activity } from "../../src/types/activity";

const ALL_STATUSES: TaskStatus[] = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
];

function task(over: Partial<Task> & { id: string }): Task {
  return {
    projectId: "p1",
    contextId: `lane:${over.id}`,
    title: over.id,
    description: "",
    status: "TODO",
    role: "backend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "quick-lane",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  } as Task;
}

const row = (t: Task): LaneRow => ({ task: t, agent: null, worktree: null });

describe("laneGroupOf", () => {
  it("모든 TaskStatus 가 정확히 한 라인에 매핑된다", () => {
    for (const status of ALL_STATUSES) {
      const id = laneGroupOf(status);
      expect(LANE_GROUPS.map((g) => g.id)).toContain(id);
    }
  });

  it("터미널/주의 상태가 진행 중과 섞이지 않는다", () => {
    expect(laneGroupOf("IN_PROGRESS")).toBe("active");
    expect(laneGroupOf("CLAIMED")).toBe("active");
    expect(laneGroupOf("TODO")).toBe("active");
    expect(laneGroupOf("REVIEW")).toBe("review");
    expect(laneGroupOf("BLOCKED")).toBe("attention");
    expect(laneGroupOf("FAILED")).toBe("attention");
    expect(laneGroupOf("DONE")).toBe("done");
  });
});

describe("groupLaneRows", () => {
  it("빈 라인은 렌더 목록에서 빠진다", () => {
    const groups = groupLaneRows([row(task({ id: "a", status: "DONE" }))]);
    expect(groups).toHaveLength(1);
    expect(groups[0].def.id).toBe("done");
  });

  it("표시 순서는 진행 중 → 리뷰 → 주의 → 완료", () => {
    const groups = groupLaneRows([
      row(task({ id: "d", status: "DONE" })),
      row(task({ id: "b", status: "BLOCKED" })),
      row(task({ id: "a", status: "IN_PROGRESS" })),
      row(task({ id: "r", status: "REVIEW" })),
    ]);
    expect(groups.map((g) => g.def.id)).toEqual([
      "active",
      "review",
      "attention",
      "done",
    ]);
  });

  it("한 행도 잃지 않는다 (전 상태 투입 = 전 상태 회수)", () => {
    const rows = ALL_STATUSES.map((status, i) =>
      row(task({ id: `t${i}`, status })),
    );
    const flat = groupLaneRows(rows).flatMap((g) => g.rows);
    expect(flat).toHaveLength(rows.length);
    expect(new Set(flat.map((r) => r.task.id))).toEqual(
      new Set(rows.map((r) => r.task.id)),
    );
  });

  it("라인 안 정렬은 createdAt 내림차순 (새 레인이 위)", () => {
    const groups = groupLaneRows([
      row(
        task({
          id: "old",
          status: "IN_PROGRESS",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        }),
      ),
      row(
        task({
          id: "new",
          status: "IN_PROGRESS",
          createdAt: new Date("2026-07-05T00:00:00Z"),
        }),
      ),
    ]);
    expect(groups[0].rows.map((r) => r.task.id)).toEqual(["new", "old"]);
  });

  it("입력이 비면 라인도 없다", () => {
    expect(groupLaneRows([])).toEqual([]);
  });
});

describe("laneGroupDef", () => {
  it("id 로 정의를 집는다 (인덱스 의존 금지)", () => {
    expect(laneGroupDef("active").labelKey).toBe("lanes.group.active");
    expect(laneGroupDef("done").labelKey).toBe("lanes.group.done");
  });
});

describe("buildLaneTimeline", () => {
  const activity = (over: Partial<Activity> & { id: string }): Activity => ({
    taskId: "t1",
    agentId: "worker",
    message: "작업 중",
    createdAt: new Date("2026-07-01T01:00:00Z"),
    ...over,
  });

  it("활동로그와 상태 마커를 시간순으로 병합한다", () => {
    const t = task({
      id: "t1",
      status: "DONE",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      claimedAt: new Date("2026-07-01T00:30:00Z"),
      claimedBy: "worker",
      updatedAt: new Date("2026-07-01T02:00:00Z"),
    });
    const entries = buildLaneTimeline(t, [
      activity({ id: "a1", createdAt: new Date("2026-07-01T01:00:00Z") }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual([
      "created",
      "claimed",
      "activity",
      "status",
    ]);
    expect(entries.map((e) => e.at.getTime())).toEqual(
      [...entries]
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map((e) => e.at.getTime()),
    );
  });

  it("TODO 는 생성 마커와 같은 말이라 상태 마커를 세우지 않는다", () => {
    const entries = buildLaneTimeline(task({ id: "t1", status: "TODO" }), []);
    expect(entries.map((e) => e.kind)).toEqual(["created"]);
  });

  it("CLAIMED 는 선점 마커가 이미 말하므로 중복 세우지 않는다", () => {
    const t = task({
      id: "t1",
      status: "CLAIMED",
      claimedAt: new Date("2026-07-01T00:30:00Z"),
      claimedBy: "worker",
    });
    expect(buildLaneTimeline(t, []).map((e) => e.kind)).toEqual([
      "created",
      "claimed",
    ]);
  });

  it("선점 기록이 없으면 CLAIMED 상태 마커라도 남긴다 (전이를 삼키지 않는다)", () => {
    const t = task({
      id: "t1",
      status: "CLAIMED",
      updatedAt: new Date("2026-07-01T03:00:00Z"),
    });
    expect(buildLaneTimeline(t, []).map((e) => e.kind)).toEqual([
      "created",
      "status",
    ]);
  });

  it("활동로그가 없어도 티켓 수명 마커는 남는다", () => {
    const t = task({
      id: "t1",
      status: "FAILED",
      updatedAt: new Date("2026-07-01T04:00:00Z"),
    });
    const entries = buildLaneTimeline(t, []);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ kind: "status", status: "FAILED" });
  });
});
