import { describe, expect, it } from "vitest";
import {
  GRAPH_COL_GAP,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  GRAPH_PADDING,
  GRAPH_ROW_GAP,
  layoutTaskGraph,
} from "../../src/lib/taskGraphLayout";
import type { Task } from "../../src/types/task";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

function task(id: string, dependsOn: string[] = []): Task {
  return {
    id,
    projectId: "p",
    contextId: "board",
    title: id,
    description: "",
    status: "TODO",
    role: "frontend",
    priority: 3,
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

/** id → level 로 눌러 담아 비교하기 쉽게. */
function levelsOf(tasks: Task[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const node of layoutTaskGraph(tasks).nodes) out[node.id] = node.level;
  return out;
}

describe("layoutTaskGraph — 위상 레벨", () => {
  it("의존이 없는 태스크는 전부 level 0 노드로 남는다", () => {
    const layout = layoutTaskGraph([task("a"), task("b"), task("c")]);
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(layout.nodes.every((n) => n.level === 0)).toBe(true);
    expect(layout.edges).toEqual([]);
    expect(layout.levelCount).toBe(1);
  });

  it("체인은 의존 깊이만큼 레벨이 깊어진다", () => {
    expect(levelsOf([task("a"), task("b", ["a"]), task("c", ["b"])])).toEqual({
      a: 0,
      b: 1,
      c: 2,
    });
  });

  it("입력 순서가 뒤집혀도(후행이 먼저 와도) 레벨은 같다", () => {
    expect(levelsOf([task("c", ["b"]), task("b", ["a"]), task("a")])).toEqual({
      a: 0,
      b: 1,
      c: 2,
    });
  });

  it("선행이 여럿이면 가장 깊은 선행 + 1", () => {
    // a → b → c, a → c : c 는 b(1) 를 따라 2 여야 한다(a 만 보고 1 이 아니라).
    expect(
      levelsOf([task("a"), task("b", ["a"]), task("c", ["a", "b"])]),
    ).toEqual({ a: 0, b: 1, c: 2 });
  });

  it("빈 목록에서 크래시하지 않는다", () => {
    const layout = layoutTaskGraph([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.levelCount).toBe(0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
    expect(layout.hasCycle).toBe(false);
  });
});

describe("layoutTaskGraph — 엣지 생성", () => {
  it("dependsOn 하나당 선행→후행 엣지 하나", () => {
    const layout = layoutTaskGraph([
      task("a"),
      task("b", ["a"]),
      task("c", ["a", "b"]),
    ]);
    expect(layout.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      "a->b",
      "a->c",
      "b->c",
    ]);
    expect(layout.edges.every((e) => e.cycle === false)).toBe(true);
  });

  it("그래프에 없는 태스크를 가리키는 dependsOn 은 엣지도 레벨도 만들지 않는다", () => {
    const layout = layoutTaskGraph([task("b", ["ghost"])]);
    expect(layout.edges).toEqual([]);
    expect(layout.nodes[0].level).toBe(0);
  });

  it("중복 dependsOn 과 자기참조는 한 번만/아예 세지 않는다", () => {
    const layout = layoutTaskGraph([task("a"), task("b", ["a", "a", "b"])]);
    expect(layout.edges.map((e) => e.id)).toEqual(["a→b"]);
    expect(layout.nodes.find((n) => n.id === "b")?.level).toBe(1);
  });

  it("엣지 좌표는 선행 노드 오른쪽 중앙 → 후행 노드 왼쪽 중앙", () => {
    const layout = layoutTaskGraph([task("a"), task("b", ["a"])]);
    const [edge] = layout.edges;
    const a = layout.nodes.find((n) => n.id === "a")!;
    const b = layout.nodes.find((n) => n.id === "b")!;
    expect(edge.fromX).toBe(a.x + GRAPH_NODE_WIDTH);
    expect(edge.fromY).toBe(a.y + GRAPH_NODE_HEIGHT / 2);
    expect(edge.toX).toBe(b.x);
    expect(edge.toY).toBe(b.y + GRAPH_NODE_HEIGHT / 2);
  });
});

describe("layoutTaskGraph — 사이클 안전", () => {
  it("2노드 순환에서 무한루프 없이 끝나고 되돌림 간선만 cycle 로 표시", () => {
    const layout = layoutTaskGraph([task("a", ["b"]), task("b", ["a"])]);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
    expect(layout.hasCycle).toBe(true);
    // 한 방향만 되돌림 간선이 된다 — 나머지는 정상 순서로 살아남는다.
    expect(layout.edges.filter((e) => e.cycle)).toHaveLength(1);
  });

  it("3노드 순환도 종료하고 모든 노드가 좌표를 갖는다", () => {
    const layout = layoutTaskGraph([
      task("a", ["c"]),
      task("b", ["a"]),
      task("c", ["b"]),
    ]);
    expect(layout.nodes).toHaveLength(3);
    expect(
      layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
    ).toBe(true);
    expect(layout.hasCycle).toBe(true);
    expect(layout.edges).toHaveLength(3);
  });

  it("자기 자신을 의존해도 엣지 없이 level 0", () => {
    const layout = layoutTaskGraph([task("a", ["a"])]);
    expect(layout.edges).toEqual([]);
    expect(layout.nodes[0].level).toBe(0);
    expect(layout.hasCycle).toBe(false);
  });

  it("순환에 매달린 정상 체인도 레벨이 계산된다", () => {
    // a↔b 순환 + c 는 b 를 기다린다 → c 가 사라지지 않아야 한다.
    const layout = layoutTaskGraph([
      task("a", ["b"]),
      task("b", ["a"]),
      task("c", ["b"]),
    ]);
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(layout.nodes.find((n) => n.id === "c")!.level).toBeGreaterThan(0);
  });

  it("긴 체인(2000개)에서도 스택 오버플로 없이 끝난다", () => {
    const tasks = [task("t0")];
    for (let i = 1; i < 2000; i++) tasks.push(task(`t${i}`, [`t${i - 1}`]));
    const layout = layoutTaskGraph(tasks);
    expect(layout.nodes[1999].level).toBe(1999);
  });
});

describe("layoutTaskGraph — 좌표·캔버스", () => {
  it("같은 레벨은 세로로, 다음 레벨은 가로로 배치된다", () => {
    const layout = layoutTaskGraph([task("a"), task("b"), task("c", ["a"])]);
    const a = layout.nodes.find((n) => n.id === "a")!;
    const b = layout.nodes.find((n) => n.id === "b")!;
    const c = layout.nodes.find((n) => n.id === "c")!;
    expect(a.x).toBe(GRAPH_PADDING);
    expect(b.x).toBe(GRAPH_PADDING);
    expect(b.y).toBe(GRAPH_PADDING + GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP);
    expect(c.x).toBe(GRAPH_PADDING + GRAPH_NODE_WIDTH + GRAPH_COL_GAP);
    expect(c.y).toBe(GRAPH_PADDING);
  });

  it("캔버스 크기는 모든 노드를 패딩까지 포함해 감싼다", () => {
    const layout = layoutTaskGraph([task("a"), task("b"), task("c", ["a"])]);
    for (const node of layout.nodes) {
      expect(node.x + GRAPH_NODE_WIDTH + GRAPH_PADDING).toBeLessThanOrEqual(
        layout.width,
      );
      expect(node.y + GRAPH_NODE_HEIGHT + GRAPH_PADDING).toBeLessThanOrEqual(
        layout.height,
      );
    }
  });
});
