/**
 * 작업내역(완료이력) 탭 필터의 순수 로직 테스트.
 *
 * 핀하는 계약:
 *   - 기간 컷오프: 7/30 은 자르고 "전체" 는 안 자른다. 경계는 포함.
 *   - updatedAt 없는 태스크는 컷오프가 걸린 기간에서 제외, "전체" 에서만 보인다.
 *   - 역할·검색은 AND 로 결합되고, 결과는 항상 updatedAt DESC.
 *   - DONE 이 아닌 태스크는 어떤 필터에서도 나오지 않는다.
 *   - isFilterActive: 기본값(30d/all/빈검색)에서만 false.
 *
 * UI(세그먼트 컨트롤/셀렉트)는 통합 영역이라 여기선 필터 함수만 본다.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORK_HISTORY_FILTER,
  filterDoneTasks,
  isFilterActive,
  periodCutoff,
  type WorkHistoryFilter,
} from "../../src/lib/workHistoryFilter";
import type { Task } from "../../src/types/task";

const NOW = new Date("2026-07-28T00:00:00.000Z");
const DAY = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

function makeTask(over: Partial<Task>): Task {
  return {
    id: "t1",
    projectId: "p1",
    contextId: "board",
    title: "t",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: daysAgo(100),
    updatedAt: daysAgo(1),
    ...over,
  };
}

function filter(over: Partial<WorkHistoryFilter> = {}): WorkHistoryFilter {
  return { ...DEFAULT_WORK_HISTORY_FILTER, ...over };
}

describe("periodCutoff", () => {
  it("7d/30d 는 컷오프를 주고, 전체는 null(자르지 않음)", () => {
    expect(periodCutoff("7d", NOW)).toEqual(new Date(NOW.getTime() - 7 * DAY));
    expect(periodCutoff("30d", NOW)).toEqual(
      new Date(NOW.getTime() - 30 * DAY),
    );
    expect(periodCutoff("all", NOW)).toBeNull();
  });
});

describe("filterDoneTasks — 기간", () => {
  const tasks = [
    makeTask({ id: "d3", updatedAt: daysAgo(3) }),
    makeTask({ id: "d20", updatedAt: daysAgo(20) }),
    makeTask({ id: "d200", updatedAt: daysAgo(200) }),
  ];

  it("7일은 최근 7일만", () => {
    expect(
      filterDoneTasks(tasks, filter({ periodId: "7d" }), NOW).map((t) => t.id),
    ).toEqual(["d3"]);
  });

  it("30일은 30일 이내만", () => {
    expect(
      filterDoneTasks(tasks, filter({ periodId: "30d" }), NOW).map((t) => t.id),
    ).toEqual(["d3", "d20"]);
  });

  it("전체는 오래된 것까지 전부", () => {
    expect(
      filterDoneTasks(tasks, filter({ periodId: "all" }), NOW).map((t) => t.id),
    ).toEqual(["d3", "d20", "d200"]);
  });

  it("컷오프 경계(정확히 7일 전)는 포함", () => {
    const edge = [makeTask({ id: "edge", updatedAt: daysAgo(7) })];
    expect(
      filterDoneTasks(edge, filter({ periodId: "7d" }), NOW).map((t) => t.id),
    ).toEqual(["edge"]);
  });

  it("updatedAt 없는 태스크는 기간 필터에선 빠지고 전체에서만 보인다", () => {
    const undated = [
      makeTask({ id: "undated", updatedAt: undefined as unknown as Date }),
    ];
    expect(filterDoneTasks(undated, filter({ periodId: "30d" }), NOW)).toEqual(
      [],
    );
    expect(
      filterDoneTasks(undated, filter({ periodId: "all" }), NOW).map(
        (t) => t.id,
      ),
    ).toEqual(["undated"]);
  });
});

describe("filterDoneTasks — 역할·검색·상태", () => {
  const tasks = [
    makeTask({
      id: "fe",
      role: "frontend",
      title: "완료이력 탭 기간 필터",
      updatedAt: daysAgo(1),
    }),
    makeTask({
      id: "be",
      role: "backend",
      title: "BigQuery 집계 쿼리",
      description: "task_outcomes 조인",
      updatedAt: daysAgo(2),
    }),
    makeTask({ id: "open", status: "IN_PROGRESS", updatedAt: daysAgo(1) }),
  ];

  it("DONE 이 아닌 태스크는 절대 안 나온다", () => {
    const ids = filterDoneTasks(tasks, filter({ periodId: "all" }), NOW).map(
      (t) => t.id,
    );
    expect(ids).not.toContain("open");
  });

  it("역할로 좁힌다", () => {
    expect(
      filterDoneTasks(tasks, filter({ role: "backend" }), NOW).map((t) => t.id),
    ).toEqual(["be"]);
  });

  it("검색은 제목·설명 모두, 대소문자 무시", () => {
    expect(
      filterDoneTasks(tasks, filter({ query: "BIGQUERY" }), NOW).map(
        (t) => t.id,
      ),
    ).toEqual(["be"]);
    expect(
      filterDoneTasks(tasks, filter({ query: "task_outcomes" }), NOW).map(
        (t) => t.id,
      ),
    ).toEqual(["be"]);
    expect(
      filterDoneTasks(tasks, filter({ query: "기간 필터" }), NOW).map(
        (t) => t.id,
      ),
    ).toEqual(["fe"]);
  });

  it("공백만 있는 검색어는 미적용", () => {
    expect(
      filterDoneTasks(tasks, filter({ query: "   " }), NOW).map((t) => t.id),
    ).toEqual(["fe", "be"]);
  });

  it("역할과 검색은 AND", () => {
    expect(
      filterDoneTasks(
        tasks,
        filter({ role: "frontend", query: "BigQuery" }),
        NOW,
      ),
    ).toEqual([]);
  });

  it("결과는 항상 최신순", () => {
    const shuffled = [
      makeTask({ id: "old", updatedAt: daysAgo(5) }),
      makeTask({ id: "new", updatedAt: daysAgo(1) }),
      makeTask({ id: "mid", updatedAt: daysAgo(3) }),
    ];
    expect(
      filterDoneTasks(shuffled, filter({ periodId: "all" }), NOW).map(
        (t) => t.id,
      ),
    ).toEqual(["new", "mid", "old"]);
  });
});

describe("isFilterActive", () => {
  it("기본값(30일/전체역할/빈검색)은 비활성", () => {
    expect(isFilterActive(DEFAULT_WORK_HISTORY_FILTER)).toBe(false);
    expect(isFilterActive(filter({ query: "  " }))).toBe(false);
  });

  it("한 칸이라도 바뀌면 활성", () => {
    expect(isFilterActive(filter({ periodId: "7d" }))).toBe(true);
    expect(isFilterActive(filter({ role: "devops" }))).toBe(true);
    expect(isFilterActive(filter({ query: "x" }))).toBe(true);
  });
});
