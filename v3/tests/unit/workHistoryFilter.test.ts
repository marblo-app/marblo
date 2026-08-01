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
 * 회귀("기간을 바꿔도 완료리스트·Shipped 메시지가 안 변한다") 이후 추가된 계약:
 *   - 날짜 정규화(toTaskMillis): Date/Timestamp/ISO/epoch 를 한 축으로 접고,
 *     판정 불가는 0 이 아니라 null → 컷 걸린 기간에서 fail-closed 로 제외.
 *   - 공유카드 수치는 **필터 결과 전체**를 따라간다(리스너 창이 아니라).
 *
 * UI(세그먼트 컨트롤/셀렉트)는 통합 영역이라 여기선 순수 함수만 본다.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORK_HISTORY_FILTER,
  filterDoneTasks,
  isFilterActive,
  periodCutoff,
  taskPeriodMillis,
  toTaskMillis,
  type WorkHistoryFilter,
} from "../../src/lib/workHistoryFilter";
import { computeShareStats } from "../../src/lib/shareCard";
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

/** Firestore Timestamp 최소 대역 — 렌더러 로더가 Date 로 정규화하기 **전** 모양. */
function timestampLike(date: Date) {
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => date,
  };
}

describe("toTaskMillis — 날짜 단일소스 정규화", () => {
  it("Date / Timestamp / ISO 문자열 / epoch 숫자를 같은 ms 로 접는다", () => {
    const date = daysAgo(10);
    const ms = date.getTime();

    expect(toTaskMillis(date)).toBe(ms);
    expect(toTaskMillis(timestampLike(date))).toBe(ms);
    expect(toTaskMillis(date.toISOString())).toBe(ms);
    expect(toTaskMillis(ms)).toBe(ms);
    // toDate() 없는 평문 `{seconds}` — 다중 SDK 번들에서 instanceof 가 깨진 모양.
    expect(toTaskMillis({ seconds: Math.floor(ms / 1000) })).toBe(
      Math.floor(ms / 1000) * 1000,
    );
  });

  it("판정 불가는 0 이 아니라 null (0 은 '1970년' 이라는 판정이다)", () => {
    for (const bad of [null, undefined, "", "not-a-date", NaN, {}, []]) {
      expect(toTaskMillis(bad)).toBeNull();
    }
  });

  it("taskPeriodMillis 는 컷오프가 보는 축과 같은 값을 준다", () => {
    expect(taskPeriodMillis(makeTask({ updatedAt: daysAgo(5) }))).toBe(
      daysAgo(5).getTime(),
    );
  });
});

describe("filterDoneTasks — 날짜 타입이 어긋나도 컷오프는 살아 있다", () => {
  // ★예전 구현은 `task.updatedAt.getTime()` 을 직접 불렀다. 로더가 Date 로 못
  // 접은 값이 섞이면 두 갈래로 터진다 — Timestamp/평문 객체면 `getTime is not a
  // function` 으로 탭이 렌더 중 죽고, Invalid Date 면 `NaN < cutoff` 가 false 라
  // 컷오프가 조용히 무효화되어 200일 전 태스크가 "7일" 을 통과한다.
  // (이 블록은 수정 전 구현에 대고 돌리면 실제로 3건 실패한다.)
  const raw = [
    makeTask({
      id: "ts-recent",
      updatedAt: timestampLike(daysAgo(2)) as unknown as Date,
    }),
    makeTask({
      id: "ts-old",
      updatedAt: timestampLike(daysAgo(200)) as unknown as Date,
    }),
  ];

  it("Timestamp 로 들어와도 7일 컷이 걸린다", () => {
    expect(
      filterDoneTasks(raw, filter({ periodId: "7d" }), NOW).map((t) => t.id),
    ).toEqual(["ts-recent"]);
  });

  it("전체에서는 둘 다 최신순으로 남는다", () => {
    expect(
      filterDoneTasks(raw, filter({ periodId: "all" }), NOW).map((t) => t.id),
    ).toEqual(["ts-recent", "ts-old"]);
  });

  it("파싱 불가 문자열도 fail-closed (컷 기간에서 제외)", () => {
    const junk = [
      makeTask({ id: "junk", updatedAt: "yesterday" as unknown as Date }),
    ];
    expect(filterDoneTasks(junk, filter({ periodId: "30d" }), NOW)).toEqual([]);
    expect(
      filterDoneTasks(junk, filter({ periodId: "all" }), NOW).map((t) => t.id),
    ).toEqual(["junk"]);
  });

  it("혼합 타입에서도 정렬은 최신순", () => {
    const mixed = [
      makeTask({ id: "old", updatedAt: daysAgo(9) }),
      makeTask({
        id: "newest",
        updatedAt: timestampLike(daysAgo(1)) as unknown as Date,
      }),
      makeTask({
        id: "mid",
        updatedAt: daysAgo(3).toISOString() as unknown as Date,
      }),
    ];
    expect(
      filterDoneTasks(mixed, filter({ periodId: "all" }), NOW).map((t) => t.id),
    ).toEqual(["newest", "mid", "old"]);
  });
});

describe("공유카드(Shipped) 수치는 필터 결과를 따라간다", () => {
  // 신고 증상의 나머지 절반. 카드가 "최신 50건" 슬라이스를 집계하던 동안엔 기간을
  // 좁혀도(좁힌 기간에 50건 이상 남으면) 수치가 한 칸도 안 움직였다.
  const tasks = [
    makeTask({
      id: "a",
      updatedAt: daysAgo(3),
      claimedBy: "agent-1",
      scope: ["a.ts"],
    }),
    makeTask({
      id: "b",
      updatedAt: daysAgo(20),
      claimedBy: "agent-2",
      scope: ["b.ts"],
    }),
    makeTask({
      id: "c",
      updatedAt: daysAgo(200),
      claimedBy: "agent-3",
      scope: ["c.ts"],
    }),
  ];

  it("기간을 좁히면 집계도 함께 줄어든다", () => {
    const at = (periodId: WorkHistoryFilter["periodId"]) =>
      computeShareStats(filterDoneTasks(tasks, filter({ periodId }), NOW), {});

    expect([
      at("all").doneTasks,
      at("30d").doneTasks,
      at("7d").doneTasks,
    ]).toEqual([3, 2, 1]);
    expect([at("all").agents, at("30d").agents, at("7d").agents]).toEqual([
      3, 2, 1,
    ]);
    expect([at("all").files, at("30d").files, at("7d").files]).toEqual([
      3, 2, 1,
    ]);
  });

  it("heuristic 축의 분모(reportsScanned)를 집계 규모와 따로 보고한다", () => {
    // 보고를 읽은 건 1건뿐 — "3건 집계" 와 같은 분모인 척하면 안 된다.
    // 값 null(=읽었는데 보고 없음)과 키 부재(=아직 안 읽음)를 가른다.
    const stats = computeShareStats(tasks, { a: null });
    expect(stats.doneTasks).toBe(3);
    expect(stats.reportsScanned).toBe(1);
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
