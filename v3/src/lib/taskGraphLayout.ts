import type { Task } from "../types/task";

/**
 * 보드 그래프 뷰의 **레이아웃 계산기** — 순수 함수, DOM/스토어 무관.
 *
 * 왜 손으로 짜나: 노드 수십 개짜리 레이어드 DAG 하나를 그리려고 dagre/elk 를
 * 새 의존성으로 끌어오면 오프라인 설치와 번들이 같이 무거워진다. 여기서 필요한
 * 건 "의존 깊이 = 열, 열 안의 순서 = 행" 딱 하나라 60줄이면 끝난다. 팬/줌·
 * 교차 최소화 같은 건 후속이고, 그때 라이브러리를 얹어도 이 함수의 출력
 * (노드 좌표 + 엣지 목록)이 계약이라 호출부는 안 바뀐다.
 *
 * ★사이클 안전이 이 파일의 핵심 요구사항이다. dependsOn 은 사용자가/에이전트가
 * 자유롭게 쓰는 필드라 A→B→A 가 언제든 들어온다. 재귀+방문표시 대신 명시적
 * 스택으로 순회하고(긴 체인에서 스택 오버플로 방지), 되돌아가는 간선(back
 * edge)은 레벨 계산에서 제외한 뒤 `cycle: true` 로 표시해 화면에 점선으로
 * 남긴다 — 조용히 지우면 사용자는 왜 순서가 이상한지 알 수 없다.
 */

/** 노드 상자 크기·간격. 뷰(TaskGraphView)와 좌표계를 공유한다. */
export const GRAPH_NODE_WIDTH = 220;
export const GRAPH_NODE_HEIGHT = 88;
export const GRAPH_COL_GAP = 72;
export const GRAPH_ROW_GAP = 20;
export const GRAPH_PADDING = 24;

export interface TaskGraphNode {
  id: string;
  task: Task;
  /** 의존 깊이. 의존이 없거나 전부 사이클 간선이면 0. */
  level: number;
  /** 같은 레벨 안에서의 순번(입력 순서 유지). */
  indexInLevel: number;
  x: number;
  y: number;
}

export interface TaskGraphEdge {
  id: string;
  /** 선행 태스크(먼저 끝나야 하는 쪽). */
  from: string;
  /** 후행 태스크(dependsOn 을 선언한 쪽). */
  to: string;
  /** 레벨 계산에서 제외된 되돌림 간선인가(= 순환의 일부). */
  cycle: boolean;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface TaskGraphLayout {
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  /** 레벨(열) 개수. 노드가 없으면 0. */
  levelCount: number;
  /** 캔버스 크기 — 패딩 포함. */
  width: number;
  height: number;
  /** 순환 간선이 하나라도 있는가(뷰 경고 배너용). */
  hasCycle: boolean;
}

const edgeKey = (from: string, to: string) => `${from}→${to}`;

/**
 * 이 태스크가 **그래프 안에 실제로 존재하는** 선행 태스크들. 중복과 자기참조,
 * 다른 프로젝트/삭제된 티켓을 가리키는 dangling 참조를 여기서 한 번에 턴다.
 */
function resolveDeps(task: Task, byId: Map<string, Task>): string[] {
  const seen = new Set<string>();
  const deps: string[] = [];
  for (const depId of task.dependsOn ?? []) {
    if (depId === task.id) continue;
    if (!byId.has(depId)) continue;
    if (seen.has(depId)) continue;
    seen.add(depId);
    deps.push(depId);
  }
  return deps;
}

/**
 * 태스크 목록 → 레이어드 DAG 좌표.
 *
 * 레벨(열) = 선행 태스크 깊이의 최댓값 + 1. 의존이 없는 태스크도 level 0 노드로
 * 반드시 포함된다(엣지 없는 티켓이 화면에서 사라지지 않는다).
 */
export function layoutTaskGraph(tasks: readonly Task[]): TaskGraphLayout {
  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.id, task);

  const depsById = new Map<string, string[]>();
  for (const task of tasks) depsById.set(task.id, resolveDeps(task, byId));

  const levels = new Map<string, number>();
  /** 0=미방문, 1=방문 중(스택 위), 2=확정 */
  const state = new Map<string, 0 | 1 | 2>();
  const cycleEdges = new Set<string>();

  // 명시적 스택 DFS. frame.cursor 는 이 노드의 몇 번째 선행을 처리 중인지.
  for (const root of tasks) {
    if (state.get(root.id) === 2) continue;
    const stack: { id: string; cursor: number }[] = [
      { id: root.id, cursor: 0 },
    ];
    state.set(root.id, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = depsById.get(frame.id) ?? [];

      if (frame.cursor < deps.length) {
        const depId = deps[frame.cursor];
        frame.cursor += 1;
        const depState = state.get(depId) ?? 0;
        if (depState === 1) {
          // 스택 위에 있는 조상으로 돌아가는 간선 = 순환. 레벨 계산에서 뺀다.
          cycleEdges.add(edgeKey(depId, frame.id));
          continue;
        }
        if (depState === 2) continue; // 이미 확정 — 레벨을 그대로 쓴다
        state.set(depId, 1);
        stack.push({ id: depId, cursor: 0 });
        continue;
      }

      // 선행을 모두 처리했다 → 이 노드의 레벨을 확정한다.
      let level = 0;
      for (const depId of deps) {
        if (cycleEdges.has(edgeKey(depId, frame.id))) continue;
        const depLevel = levels.get(depId);
        if (depLevel === undefined) continue;
        level = Math.max(level, depLevel + 1);
      }
      levels.set(frame.id, level);
      state.set(frame.id, 2);
      stack.pop();
    }
  }

  // 레벨별로 묶는다. 입력 순서를 유지해 스냅샷마다 노드가 튀지 않는다.
  const perLevelCount = new Map<number, number>();
  const nodes: TaskGraphNode[] = tasks.map((task) => {
    const level = levels.get(task.id) ?? 0;
    const indexInLevel = perLevelCount.get(level) ?? 0;
    perLevelCount.set(level, indexInLevel + 1);
    return {
      id: task.id,
      task,
      level,
      indexInLevel,
      x: GRAPH_PADDING + level * (GRAPH_NODE_WIDTH + GRAPH_COL_GAP),
      y: GRAPH_PADDING + indexInLevel * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges: TaskGraphEdge[] = [];
  for (const task of tasks) {
    for (const depId of depsById.get(task.id) ?? []) {
      const from = nodeById.get(depId);
      const to = nodeById.get(task.id);
      if (!from || !to) continue;
      edges.push({
        id: edgeKey(depId, task.id),
        from: depId,
        to: task.id,
        cycle: cycleEdges.has(edgeKey(depId, task.id)),
        fromX: from.x + GRAPH_NODE_WIDTH,
        fromY: from.y + GRAPH_NODE_HEIGHT / 2,
        toX: to.x,
        toY: to.y + GRAPH_NODE_HEIGHT / 2,
      });
    }
  }

  const levelCount = perLevelCount.size;
  const maxRows = Math.max(0, ...perLevelCount.values());
  const maxLevel =
    nodes.length === 0 ? -1 : Math.max(...nodes.map((n) => n.level));

  return {
    nodes,
    edges,
    levelCount,
    width:
      nodes.length === 0
        ? 0
        : GRAPH_PADDING * 2 +
          (maxLevel + 1) * GRAPH_NODE_WIDTH +
          maxLevel * GRAPH_COL_GAP,
    height:
      nodes.length === 0
        ? 0
        : GRAPH_PADDING * 2 +
          maxRows * GRAPH_NODE_HEIGHT +
          Math.max(0, maxRows - 1) * GRAPH_ROW_GAP,
    hasCycle: cycleEdges.size > 0,
  };
}
