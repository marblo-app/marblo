import type { Task, TaskStatus } from "../types/task";
import type { TaskGraphLayout } from "./taskGraphLayout";

/**
 * 그래프 뷰의 **운영 분석기** — 순수 함수, DOM/스토어/캔버스 무관.
 *
 * 레이아웃(taskGraphLayout)이 "어디에 그리나" 를 답한다면 여기는 "무엇을 봐야
 * 하나" 를 답한다. 노드를 예쁘게 띄우는 것만으로는 오케가 얻는 게 없다. 보드를
 * 열었을 때 실제로 알고 싶은 건 딱 둘이다:
 *
 *   ① **지금 당장 던질 수 있는 티켓이 뭔가** (ready) — 놀고 있는 병렬성
 *   ② **끝나는 시점을 결정하는 사슬이 뭔가** (critical path) — 병목
 *
 * 둘 다 dependsOn 만 보면 기계적으로 나오는데, 사람이 카드를 하나씩 열어 보는
 * 방식으로는 절대 안 나온다. 그래서 계산을 뷰에서 떼어 순수 함수로 두고
 * 테스트로 고정한다(tests/unit/task-graph-critical-path.test.ts).
 *
 * ★입력이 `Task[]` 가 아니라 `TaskGraphLayout` 인 이유: 의존 해석(자기참조·
 * dangling·중복 제거)과 **순환 간선 판정**을 레이아웃이 이미 한 번 했다. 여기서
 * 다시 DFS 를 돌리면 back edge 집합이 미묘하게 갈려서, 화면엔 점선(순환)으로
 * 그려진 간선을 크리티컬 패스는 실선으로 타고 지나가는 모순이 생긴다. 계산과
 * 렌더가 같은 간선 목록을 보게 만드는 게 이 시그니처의 목적이다.
 */

/**
 * 티켓 하나의 **운영 상태**. status 와 겹치는 축이 아니라 "의존을 감안하면
 * 지금 이 티켓은 어떤 처지인가" 다. status=TODO 두 장이 하나는 즉시 착수
 * 가능이고 하나는 3주 뒤에나 풀린다면, 보드에서 같은 회색으로 보이면 안 된다.
 */
export type TaskReadiness =
  /** 끝났다. 더 이상 누구도 막지 않는다. */
  | "done"
  /** 누가 붙어서 굴러가는 중 (CLAIMED/IN_PROGRESS/REVIEW). */
  | "active"
  /** 사람이 봐야 한다 (BLOCKED/FAILED). 의존과 무관하게 멈춰 있다. */
  | "stuck"
  /** ★의존이 전부 끝났고 아직 아무도 안 잡은 TODO — 지금 던질 수 있다. */
  | "ready"
  /** 미완 선행이 하나라도 남은 TODO — 기다리는 것 말곤 할 게 없다. */
  | "waiting";

/**
 * status → hex. 캔버스는 Tailwind 클래스를 못 쓰므로 hex 가 따로 필요하다.
 *
 * ★값은 KanbanColumn 의 `STATUS_CONFIG[...].bg` 클래스를 그대로 푼 것이다
 * (bg-gray-500 → #6b7280 …). 칸반의 REVIEW 와 그래프의 REVIEW 가 다른 보라색이면
 * 색이 정보가 아니라 장식이 된다. 상태가 새로 생겼는데 여기만 빠지는 드리프트는
 * 테스트가 잡는다(키 집합 일치 단언).
 */
export const STATUS_HEX: Record<TaskStatus, string> = {
  TODO: "#6b7280", // gray-500
  CLAIMED: "#eab308", // yellow-500
  IN_PROGRESS: "#3b82f6", // blue-500
  REVIEW: "#a855f7", // purple-500
  BLOCKED: "#f97316", // orange-500
  FAILED: "#ef4444", // red-500
  DONE: "#22c55e", // green-500
};

/**
 * readiness → 링 색. 채움은 status 가 쓰므로 readiness 는 **테두리**로만 말한다.
 *
 * `active`/`done` 이 null 인 건 의도다. 굴러가는 티켓과 끝난 티켓에까지 링을
 * 두르면 화면 전체가 테두리 범벅이 돼서, 정작 봐야 할 ready/waiting 대비가
 * 죽는다. 링은 "네가 개입할 여지가 있는 노드" 에만 붙는다.
 */
export const READINESS_RING: Record<TaskReadiness, string | null> = {
  done: null,
  active: null,
  stuck: "#ef4444", // red-500
  ready: "#34d399", // emerald-400 — 즉시 착수 가능
  waiting: "#f59e0b", // amber-500 — 점선으로 그린다(대기)
};

/** 크리티컬 패스 강조색. status/readiness 어느 색과도 안 겹치게 고른 cyan. */
export const CRITICAL_HEX = "#67e8f9"; // cyan-300

/** 굴러가는 중 = 펄스 대상. 렌더와 분석이 같은 정의를 쓰도록 여기서 판정한다. */
const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
]);

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * 티켓별 운영 상태 판정.
 *
 * 순환 간선도 **의존으로 친다**: A↔B 가 서로를 기다리면 실제로 둘 다 못 나가는
 * 게 맞고, 그게 `waiting` 으로 보여야 사용자가 순환을 발견한다. 레이아웃은
 * 좌표를 뽑으려고 back edge 를 빼지만, 그건 그리기 사정이지 운영 사정이 아니다.
 */
export function classifyTaskReadiness(
  layout: TaskGraphLayout,
): Map<string, TaskReadiness> {
  const statusById = new Map<string, TaskStatus>();
  for (const node of layout.nodes) statusById.set(node.id, node.task.status);

  // to → [from...] (후행 → 선행들). 순환 간선 포함.
  const depsByTask = new Map<string, string[]>();
  for (const edge of layout.edges) {
    const list = depsByTask.get(edge.to);
    if (list) list.push(edge.from);
    else depsByTask.set(edge.to, [edge.from]);
  }

  const out = new Map<string, TaskReadiness>();
  for (const node of layout.nodes) {
    const status = node.task.status;
    if (status === "DONE") {
      out.set(node.id, "done");
      continue;
    }
    if (status === "BLOCKED" || status === "FAILED") {
      out.set(node.id, "stuck");
      continue;
    }
    if (isActiveStatus(status)) {
      out.set(node.id, "active");
      continue;
    }
    // 여기 남는 건 TODO 뿐 — 의존이 갈라 준다.
    const deps = depsByTask.get(node.id) ?? [];
    const waiting = deps.some((depId) => statusById.get(depId) !== "DONE");
    out.set(node.id, waiting ? "waiting" : "ready");
  }
  return out;
}

/** 각 readiness 가 몇 장인지 — 범례 배지에 그대로 박힌다. */
export function summarizeReadiness(
  readiness: ReadonlyMap<string, TaskReadiness>,
): Record<TaskReadiness, number> {
  const out: Record<TaskReadiness, number> = {
    done: 0,
    active: 0,
    stuck: 0,
    ready: 0,
    waiting: 0,
  };
  for (const value of readiness.values()) out[value] += 1;
  return out;
}

export interface CriticalPathResult {
  /** 선행 → 후행 순서의 티켓 id 사슬. 노드가 없으면 빈 배열. */
  ids: string[];
  /** 노드 강조용 조회 집합. */
  idSet: Set<string>;
  /** 간선 강조용 조회 집합 (`from→to` 키, layout.edges.id 와 같은 형식). */
  edgeIds: Set<string>;
  /** 사슬의 **남은** 무게 = 사슬 위 미완 티켓 수. */
  weight: number;
  /** 사슬 길이(완료분 포함 노드 수). */
  length: number;
}

const edgeKey = (from: string, to: string) => `${from}→${to}`;

/**
 * DAG **최장 의존 사슬**(크리티컬 패스).
 *
 * ★무게는 "노드 수" 가 아니라 **미완 노드 수**다 (DONE=0, 나머지=1). 운영에서
 * 던지는 질문은 "이 프로젝트가 언제 끝나나" 이고, 이미 끝난 티켓은 그 답을 1도
 * 늦추지 않는다. 노드 수로 재면 완료된 긴 꼬리가 달린 사슬이 정작 남은 일이
 * 몰린 짧은 사슬을 이겨서, 강조가 병목이 아니라 과거를 가리킨다.
 *
 * 동점 처리는 (남은 무게 → 사슬 길이 → 입력 순서) 로 결정론적이다. 같은 보드를
 * 두 번 열었을 때 강조되는 사슬이 바뀌면 사용자는 그걸 신호로 오해한다.
 *
 * 사이클 안전: `edge.cycle` 로 표시된 back edge 는 타지 않는다. 레이아웃의 DFS 가
 * back edge 를 걷어낸 나머지는 정의상 비순환이므로 여기서 무한 루프는 불가능하지만,
 * 입력이 손으로 조립된 경우까지 감안해 방문 중 표시로 한 번 더 막는다.
 */
export function computeCriticalPath(
  layout: TaskGraphLayout,
): CriticalPathResult {
  const empty: CriticalPathResult = {
    ids: [],
    idSet: new Set(),
    edgeIds: new Set(),
    weight: 0,
    length: 0,
  };
  if (layout.nodes.length === 0) return empty;

  const order = layout.nodes.map((node) => node.id);
  const weightById = new Map<string, number>();
  for (const node of layout.nodes) {
    weightById.set(node.id, node.task.status === "DONE" ? 0 : 1);
  }

  // to → [from...] — 순환 간선은 제외한다(화면에서 점선인 간선은 안 탄다).
  const depsByTask = new Map<string, string[]>();
  for (const edge of layout.edges) {
    if (edge.cycle) continue;
    const list = depsByTask.get(edge.to);
    if (list) list.push(edge.from);
    else depsByTask.set(edge.to, [edge.from]);
  }

  /** 이 노드에서 **끝나는** 최적 사슬. */
  interface Best {
    weight: number;
    length: number;
    prev: string | null;
  }
  const best = new Map<string, Best>();
  /** 0=미방문, 1=방문 중, 2=확정. 방어적 순환 차단용. */
  const state = new Map<string, 0 | 1 | 2>();

  // 명시적 스택 DFS — 긴 체인에서 재귀는 스택을 넘긴다(레이아웃과 같은 이유).
  for (const rootId of order) {
    if (state.get(rootId) === 2) continue;
    const stack: { id: string; cursor: number }[] = [{ id: rootId, cursor: 0 }];
    state.set(rootId, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = depsByTask.get(frame.id) ?? [];

      if (frame.cursor < deps.length) {
        const depId = deps[frame.cursor];
        frame.cursor += 1;
        const depState = state.get(depId) ?? 0;
        if (depState !== 0) continue; // 방문 중(방어) 또는 확정 — 값을 그대로 쓴다
        state.set(depId, 1);
        stack.push({ id: depId, cursor: 0 });
        continue;
      }

      const own = weightById.get(frame.id) ?? 1;
      let chosen: Best = { weight: own, length: 1, prev: null };
      for (const depId of deps) {
        const depBest = best.get(depId);
        if (!depBest) continue; // 방어적으로 끊은 간선
        const weight = depBest.weight + own;
        const length = depBest.length + 1;
        // 엄격 비교라 동점이면 먼저 만난 선행(= 입력 순서)이 이긴다.
        if (
          weight > chosen.weight ||
          (weight === chosen.weight && length > chosen.length)
        ) {
          chosen = { weight, length, prev: depId };
        }
      }
      best.set(frame.id, chosen);
      state.set(frame.id, 2);
      stack.pop();
    }
  }

  let endId = order[0];
  let endBest = best.get(endId) ?? { weight: 0, length: 1, prev: null };
  for (const id of order) {
    const candidate = best.get(id);
    if (!candidate) continue;
    if (
      candidate.weight > endBest.weight ||
      (candidate.weight === endBest.weight && candidate.length > endBest.length)
    ) {
      endId = id;
      endBest = candidate;
    }
  }

  const ids: string[] = [];
  for (let cursor: string | null = endId; cursor; ) {
    ids.push(cursor);
    cursor = best.get(cursor)?.prev ?? null;
  }
  ids.reverse();

  const edgeIds = new Set<string>();
  for (let i = 1; i < ids.length; i += 1) {
    edgeIds.add(edgeKey(ids[i - 1], ids[i]));
  }

  return {
    ids,
    idSet: new Set(ids),
    edgeIds,
    weight: endBest.weight,
    length: ids.length,
  };
}

/** 노드 반지름 하한/상한 — 시뮬의 충돌 반경이자 그리기 반경. */
export const GRAPH_MIN_RADIUS = 9;
export const GRAPH_MAX_RADIUS = 26;

/**
 * 노드 크기 = **우선순위 + 피의존 수**.
 *
 * 둘 중 하나만 쓰면 반쪽이다. 우선순위만 보면 P5 고아 티켓이 제일 크게 뜨고,
 * 피의존 수만 보면 아무도 급하다고 안 한 허브가 화면을 지배한다. 크기가 답해야
 * 하는 질문은 "이거 늦으면 얼마나 아픈가" 라서 둘을 더한다.
 */
export function graphNodeRadius(task: Task, dependentCount: number): number {
  const priority = Number.isFinite(task.priority) ? task.priority : 3;
  const clampedPriority = Math.min(5, Math.max(1, priority));
  const raw =
    GRAPH_MIN_RADIUS +
    (clampedPriority - 1) * 1.6 +
    Math.sqrt(Math.max(0, dependentCount)) * 4.2;
  return Math.min(GRAPH_MAX_RADIUS, raw);
}

/** id → 이 티켓을 기다리는 티켓 수(피의존). 크기 계산의 입력. */
export function countDependents(layout: TaskGraphLayout): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of layout.nodes) out.set(node.id, 0);
  for (const edge of layout.edges) {
    out.set(edge.from, (out.get(edge.from) ?? 0) + 1);
  }
  return out;
}
