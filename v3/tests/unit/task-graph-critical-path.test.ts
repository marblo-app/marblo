/**
 * 그래프 뷰 **운영 레이어**의 순수 함수 회귀 — 크리티컬 패스와 준비/대기 판정.
 *
 * 이 두 계산이 이 뷰의 값어치 전부다. 화려한 렌더는 눈이 잡아내지만, "강조된
 * 사슬이 정말 최장인가", "이 회색 노드가 정말 지금 던질 수 있는 티켓인가" 는
 * 화면을 봐서는 절대 못 검증한다. 그래서 렌더와 분리해 여기서 못 박는다.
 *
 * ★사이클 안전이 최우선 요구사항이다. dependsOn 은 사용자와 에이전트가 자유롭게
 * 쓰는 필드라 A→B→A 가 언제든 들어오고, 최장경로 계산은 순환을 만나면 무한
 * 루프로 앱을 통째로 얼린다.
 */
import { describe, expect, it } from "vitest";
import { layoutTaskGraph } from "../../src/lib/taskGraphLayout";
import {
  classifyTaskReadiness,
  computeCriticalPath,
  countDependents,
  graphNodeRadius,
  summarizeReadiness,
  GRAPH_MAX_RADIUS,
  GRAPH_MIN_RADIUS,
} from "../../src/lib/taskGraphAnalysis";
import type { Task, TaskStatus } from "../../src/types/task";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

function task(
  id: string,
  dependsOn: string[] = [],
  status: TaskStatus = "TODO",
  priority = 3,
): Task {
  return {
    id,
    projectId: "p",
    contextId: "board",
    title: id,
    description: "",
    status,
    role: "frontend",
    priority,
    dependsOn,
    dependsOnCompleted: dependsOn.length === 0,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  } as Task;
}

const pathOf = (tasks: Task[]) =>
  computeCriticalPath(layoutTaskGraph(tasks)).ids;
const readinessOf = (tasks: Task[]) => {
  const map = classifyTaskReadiness(layoutTaskGraph(tasks));
  return Object.fromEntries(map);
};

describe("computeCriticalPath — 최장 의존 사슬", () => {
  it("빈 보드에서 빈 결과를 준다", () => {
    const result = computeCriticalPath(layoutTaskGraph([]));
    expect(result.ids).toEqual([]);
    expect(result.weight).toBe(0);
    expect(result.length).toBe(0);
    expect(result.edgeIds.size).toBe(0);
  });

  it("일직선 사슬은 통째로 크리티컬 패스다", () => {
    const result = computeCriticalPath(
      layoutTaskGraph([task("a"), task("b", ["a"]), task("c", ["b"])]),
    );
    expect(result.ids).toEqual(["a", "b", "c"]);
    expect(result.weight).toBe(3);
    expect(result.length).toBe(3);
    // 간선 키는 layout.edges.id 와 같은 형식이어야 뷰가 조회할 수 있다.
    expect([...result.edgeIds].sort()).toEqual(["a→b", "b→c"]);
  });

  it("갈라진 가지 중 긴 쪽을 고른다", () => {
    // short: a → z          (2)
    // long : a → b → c → d  (4)
    expect(
      pathOf([
        task("a"),
        task("z", ["a"]),
        task("b", ["a"]),
        task("c", ["b"]),
        task("d", ["c"]),
      ]),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("의존이 하나도 없으면 노드 한 장이 사슬이다", () => {
    const result = computeCriticalPath(
      layoutTaskGraph([task("a"), task("b"), task("c")]),
    );
    expect(result.length).toBe(1);
    expect(result.weight).toBe(1);
  });

  it("★DONE 은 무게 0 — 완료된 긴 꼬리보다 남은 일이 몰린 짧은 사슬이 이긴다", () => {
    // 끝난 3장 + 남은 1장(무게 1) vs 남은 2장(무게 2).
    // 노드 수로 재면 위가 이기지만, 완료 시점을 늦추는 건 아래다.
    const result = computeCriticalPath(
      layoutTaskGraph([
        task("d1", [], "DONE"),
        task("d2", ["d1"], "DONE"),
        task("d3", ["d2"], "DONE"),
        task("x", ["d3"]),
        task("y1"),
        task("y2", ["y1"]),
      ]),
    );
    expect(result.ids).toEqual(["y1", "y2"]);
    expect(result.weight).toBe(2);
  });

  it("전부 완료된 보드는 무게 0 사슬을 돌려준다(폭발하지 않는다)", () => {
    const result = computeCriticalPath(
      layoutTaskGraph([
        task("a", [], "DONE"),
        task("b", ["a"], "DONE"),
        task("c", ["b"], "DONE"),
      ]),
    );
    expect(result.weight).toBe(0);
    // 무게가 같으면 더 긴 사슬이 이긴다 — 완료 이력은 그대로 보인다.
    expect(result.ids).toEqual(["a", "b", "c"]);
  });

  it("★순환이 있어도 멈추지 않고, 점선(순환) 간선은 타지 않는다", () => {
    const tasks = [task("a", ["c"]), task("b", ["a"]), task("c", ["b"])];
    const layout = layoutTaskGraph(tasks);
    const result = computeCriticalPath(layout);

    expect(layout.hasCycle).toBe(true);
    // 노드가 사슬에 두 번 들어가면 순환을 탄 것이다.
    expect(new Set(result.ids).size).toBe(result.ids.length);
    const cycleEdgeIds = new Set(
      layout.edges.filter((edge) => edge.cycle).map((edge) => edge.id),
    );
    for (const edgeId of result.edgeIds) {
      expect(cycleEdgeIds.has(edgeId)).toBe(false);
    }
  });

  it("자기 자신을 의존해도 안전하다", () => {
    const result = computeCriticalPath(layoutTaskGraph([task("a", ["a"])]));
    expect(result.ids).toEqual(["a"]);
  });

  it("삭제된 티켓을 가리키는 dangling 의존은 무시된다", () => {
    expect(pathOf([task("a", ["gone"]), task("b", ["a"])])).toEqual(["a", "b"]);
  });

  it("★결정론 — 같은 입력이면 같은 사슬, 동점이면 입력 순서가 이긴다", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c"), task("d", ["c"])];
    const first = pathOf(tasks);
    const second = pathOf(tasks);
    expect(first).toEqual(second);
    // a→b 와 c→d 는 무게·길이가 같다. 먼저 들어온 사슬이 강조된다.
    expect(first).toEqual(["a", "b"]);
  });

  it("여러 선행 중 더 무거운 쪽을 물고 올라간다", () => {
    // hub 는 (a→b) 와 (z) 둘을 기다린다 — 긴 쪽을 통해 이어져야 한다.
    const result = computeCriticalPath(
      layoutTaskGraph([
        task("a"),
        task("b", ["a"]),
        task("z"),
        task("hub", ["z", "b"]),
      ]),
    );
    expect(result.ids).toEqual(["a", "b", "hub"]);
    expect(result.weight).toBe(3);
  });
});

describe("classifyTaskReadiness — 준비 vs 대기", () => {
  it("의존 없는 TODO 는 지금 던질 수 있다(ready)", () => {
    expect(readinessOf([task("a")])).toEqual({ a: "ready" });
  });

  it("★미완 선행이 남은 TODO 는 대기(waiting) — 같은 회색으로 뭉뚱그리지 않는다", () => {
    expect(readinessOf([task("a"), task("b", ["a"])])).toEqual({
      a: "ready",
      b: "waiting",
    });
  });

  it("선행이 전부 DONE 이면 준비로 풀린다", () => {
    expect(readinessOf([task("a", [], "DONE"), task("b", ["a"])])).toEqual({
      a: "done",
      b: "ready",
    });
  });

  it("선행이 하나라도 안 끝났으면 여전히 대기다", () => {
    expect(
      readinessOf([
        task("a", [], "DONE"),
        task("b", [], "IN_PROGRESS"),
        task("c", ["a", "b"]),
      ]),
    ).toEqual({ a: "done", b: "active", c: "waiting" });
  });

  it("굴러가는 상태는 의존과 무관하게 active 다", () => {
    expect(
      readinessOf([
        task("a", [], "CLAIMED"),
        task("b", [], "IN_PROGRESS"),
        task("c", [], "REVIEW"),
      ]),
    ).toEqual({ a: "active", b: "active", c: "active" });
  });

  it("BLOCKED/FAILED 는 사람이 봐야 하는 정체(stuck)로 따로 센다", () => {
    expect(
      readinessOf([task("a", [], "BLOCKED"), task("b", [], "FAILED")]),
    ).toEqual({ a: "stuck", b: "stuck" });
  });

  it("★순환에 갇힌 TODO 는 대기로 보인다 — 실제로 아무도 못 나간다", () => {
    expect(readinessOf([task("a", ["b"]), task("b", ["a"])])).toEqual({
      a: "waiting",
      b: "waiting",
    });
  });

  it("범례 숫자는 판정 결과를 그대로 센다", () => {
    const layout = layoutTaskGraph([
      task("a"),
      task("b", ["a"]),
      task("c", [], "IN_PROGRESS"),
      task("d", [], "DONE"),
      task("e", [], "FAILED"),
    ]);
    expect(summarizeReadiness(classifyTaskReadiness(layout))).toEqual({
      ready: 1,
      waiting: 1,
      active: 1,
      done: 1,
      stuck: 1,
    });
  });
});

describe("노드 크기 — 우선순위 + 피의존 수", () => {
  it("피의존 수를 센다(자기를 기다리는 티켓 수)", () => {
    const counts = countDependents(
      layoutTaskGraph([
        task("hub"),
        task("a", ["hub"]),
        task("b", ["hub"]),
        task("c", ["a"]),
      ]),
    );
    expect(counts.get("hub")).toBe(2);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("c")).toBe(0);
  });

  it("우선순위가 높거나 많이 막고 있으면 커진다", () => {
    const low = graphNodeRadius(task("a", [], "TODO", 1), 0);
    const highPriority = graphNodeRadius(task("a", [], "TODO", 5), 0);
    const hub = graphNodeRadius(task("a", [], "TODO", 1), 9);
    expect(highPriority).toBeGreaterThan(low);
    expect(hub).toBeGreaterThan(low);
  });

  it("어떤 입력에도 반지름은 경계 안에 머문다", () => {
    const huge = graphNodeRadius(task("a", [], "TODO", 99), 10_000);
    expect(huge).toBeLessThanOrEqual(GRAPH_MAX_RADIUS);
    expect(
      graphNodeRadius(task("a", [], "TODO", -5), 0),
    ).toBeGreaterThanOrEqual(GRAPH_MIN_RADIUS);
    // priority 가 없는 옛 티켓(NaN)도 죽지 않는다.
    const legacy = { ...task("a"), priority: Number.NaN } as Task;
    expect(Number.isFinite(graphNodeRadius(legacy, 0))).toBe(true);
  });
});
