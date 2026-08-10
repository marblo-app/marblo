import type { TaskGraphLayout } from "./taskGraphLayout";

/**
 * 그래프 뷰의 **포스-다이렉티드 시뮬레이터** — 순수 모듈, DOM/RAF/캔버스 무관.
 *
 * 왜 d3-force 를 안 끌어왔나: 이 파일이 하는 일은 반발·스프링·앵커 세 힘을
 * 적분하는 것뿐이고, 그건 200줄이면 끝난다. 반면 새 npm 의존은 lock 재생성과
 * optional-dep CI 를 건드리고(이 저장소가 이미 데인 적 있는 자리), 오프라인
 * 설치 표면도 넓힌다. taskGraphLayout 이 dagre/elk 를 마다한 것과 같은 판단이다.
 * 노드가 수백을 넘어가 O(n²) 반발이 아파지면 그때 쿼드트리를 이 파일 안에
 * 넣으면 된다 — 호출부 계약(step/nodes/bounds)은 안 바뀐다.
 *
 * ★RAF 를 여기 두지 않는 게 핵심이다. 시간을 프레임이 아니라 `step()` 호출 수로
 * 세기 때문에 테스트가 "300틱 뒤에 이 그래프는 이렇게 정착한다" 를 그대로 단언할
 * 수 있다. 애니메이션은 뷰의 일이고 수렴은 여기 일이다.
 *
 * ★결정론: Math.random 을 쓰지 않는다. 초기 좌표는 레이아웃(레이어드 DAG)이
 * 준 값이고, 겹친 노드를 떼는 흔들기조차 인덱스에서 각도를 뽑는다. 같은 보드를
 * 두 번 열면 같은 그림이 나와야 사용자가 위치를 기억으로 쓸 수 있다.
 */

export interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 충돌 반경 겸 그리기 반경. */
  radius: number;
  /**
   * ★레이어드 레이아웃이 준 x. 이 앵커가 없으면 순수 포스가 사슬을 아무 방향
   * 으로나 굽혀서 "왼쪽이 먼저" 라는 MVP 의 읽기 규칙이 사라진다. 예쁘지만 못
   * 읽는 그래프가 되는 자리라, 반발·스프링과 같은 급으로 취급한다.
   */
  anchorX: number;
  /** 사용자가 잡고 있는 동안 true — 힘을 무시하고 좌표를 그대로 유지한다. */
  pinned: boolean;
}

export interface ForceSimulationOptions {
  /**
   * 이전 시뮬의 좌표(id → x,y). 티켓이 한 장 추가됐다고 화면 전체가 다시
   * 흩어지면 사용자는 매번 그래프를 새로 읽어야 한다. 살아남은 노드는 있던
   * 자리에서 이어 간다.
   */
  previous?: ReadonlyMap<string, { x: number; y: number }>;
  /** id → 반지름. 생략하면 전부 기본값. */
  radiusOf?: (id: string) => number;
}

/**
 * ★레벨(열) 간격과 같은 레벨 안의 행 간격 — **원 기준**으로 다시 잡은 값이다.
 *
 * taskGraphLayout 의 픽셀 좌표(GRAPH_NODE_WIDTH 220 + 간격 72 = 열당 292px)를
 * 그대로 시드로 쓰면 화면이 가로로만 늘어난 전선이 된다. 저 값은 220px짜리
 * 카드 상자를 세우려고 고른 것이고, 여기 노드는 지름 20~50px짜리 원이라 열
 * 간격이 노드 대비 10배쯤 과하다. 재사용하는 건 레이아웃의 **위상 배정**
 * (level·indexInLevel)이지 카드용 픽셀 치수가 아니다.
 */
const LEVEL_SPACING = 168;
const ROW_SPACING = 92;

/** 스프링의 자연 길이. 노드 지름 대비 넉넉해야 라벨이 겹치지 않는다. */
const LINK_DISTANCE = 120;
const LINK_STRENGTH = 0.09;
/** 반발 상수. 거리² 로 나눠 쓰므로 값 자체는 크다. */
const REPULSION = 14000;
/** 반발 계산 시 거리 하한 — 0 근처에서 힘이 폭발하는 걸 막는다. */
const MIN_DISTANCE = 12;
/** 이 거리를 넘으면 반발을 아예 건너뛴다(먼 노드는 어차피 무시할 만한 힘). */
const REPULSION_CUTOFF = 520;
/** x 앵커(레이어 유지) 강도. */
const ANCHOR_X_STRENGTH = 0.075;
/** y 중심 모으기 — 세로로 무한정 퍼지는 걸 막는 약한 힘. */
const CENTER_Y_STRENGTH = 0.006;
/** 속도 감쇠(d3 의 velocityDecay 0.4 와 같은 의미: v *= 0.6). */
const VELOCITY_DECAY = 0.4;
/** 한 틱에 낼 수 있는 최대 속도 — 수치 폭주 방지. */
const MAX_VELOCITY = 45;

export const ALPHA_MIN = 0.008;
const ALPHA_DECAY = 0.021;

export interface TaskGraphSimulation {
  nodes: ForceNode[];
  /** 현재 온도. 1 에서 시작해 ALPHA_MIN 아래로 식으면 정착. */
  readonly alpha: number;
  /** 한 틱 적분하고 새 alpha 를 돌려준다. */
  step: () => number;
  /** `alpha <= ALPHA_MIN` — 뷰가 RAF 를 멈춰도 되는 시점. */
  settled: () => boolean;
  /** 다시 데운다(노드를 끌었을 때·수동 재배치). */
  reheat: (alpha?: number) => void;
  /** id → 노드. 히트 테스트/이웃 강조에서 쓴다. */
  byId: ReadonlyMap<string, ForceNode>;
  /** 현재 노드들을 감싸는 사각형(반지름 포함). 화면 맞춤(fit)용. */
  bounds: () => { minX: number; minY: number; maxX: number; maxY: number };
  /** 좌표 스냅샷 — 다음 시뮬의 `previous` 로 넘긴다. */
  snapshot: () => Map<string, { x: number; y: number }>;
}

/** 겹친 두 노드를 떼기 위한 결정론적 오프셋(각도는 인덱스에서 뽑는다). */
function jitter(index: number): { dx: number; dy: number } {
  const angle = index * 2.399963229728653; // 황금각 — 인덱스가 몰려도 방향이 갈린다
  return { dx: Math.cos(angle) * 0.5, dy: Math.sin(angle) * 0.5 };
}

/**
 * 레이어드 레이아웃 → 포스 시뮬.
 *
 * 시드 좌표는 레이아웃이 준 노드 상자의 **중심**이다. 무작위 배치에서 출발하면
 * 수백 틱을 태워도 사슬이 꼬인 채로 정착하는 경우가 있는데, 위상 정렬된 시드에서
 * 출발하면 대개 100틱 안에 읽히는 모양이 나온다.
 */
export function createTaskGraphSimulation(
  layout: TaskGraphLayout,
  options: ForceSimulationOptions = {},
): TaskGraphSimulation {
  const { previous, radiusOf } = options;

  // 레벨별 노드 수 — 각 열을 0 을 중심으로 위아래로 펼치기 위해 먼저 센다.
  // 전부 아래로만 쌓으면(레이아웃의 원래 방식) 노드가 많은 열이 화면 밖으로
  // 흐르고, 포스가 그걸 되돌리는 데 수백 틱을 태운다.
  const perLevel = new Map<number, number>();
  for (const node of layout.nodes) {
    perLevel.set(node.level, (perLevel.get(node.level) ?? 0) + 1);
  }

  const nodes: ForceNode[] = layout.nodes.map((node, index) => {
    const anchorX = node.level * LEVEL_SPACING;
    const rows = perLevel.get(node.level) ?? 1;
    const seedY = (node.indexInLevel - (rows - 1) / 2) * ROW_SPACING;
    const carried = previous?.get(node.id);
    const offset = jitter(index);
    return {
      id: node.id,
      x: (carried?.x ?? anchorX) + offset.dx,
      y: (carried?.y ?? seedY) + offset.dy,
      vx: 0,
      vy: 0,
      radius: radiusOf?.(node.id) ?? 12,
      anchorX,
      pinned: false,
    };
  });

  const byId = new Map<string, ForceNode>();
  for (const node of nodes) byId.set(node.id, node);

  // 간선을 노드 참조로 미리 풀어 둔다 — 틱마다 Map 조회를 반복하지 않는다.
  // 순환 간선도 스프링으로는 살린다: 순환은 좌표 계산에서 빼야 하는 거지
  // (레이아웃), 서로 당기는 관계가 아니라는 뜻은 아니다.
  const links: { source: ForceNode; target: ForceNode }[] = [];
  for (const edge of layout.edges) {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!source || !target) continue;
    links.push({ source, target });
  }

  const centerY =
    nodes.length === 0
      ? 0
      : nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;

  let alpha = 1;

  function step(): number {
    if (nodes.length === 0) {
      alpha = 0;
      return alpha;
    }
    alpha += (0 - alpha) * ALPHA_DECAY;

    // ① 반발 — 모든 쌍. n 이 수백 규모라 O(n²) 로 충분하다(200개면 20k 쌍/틱).
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq > REPULSION_CUTOFF * REPULSION_CUTOFF) continue;
        if (distSq < 1e-6) {
          // 완전히 겹쳤다 — 결정론적 방향으로 떼어 놓는다(NaN 방지).
          const offset = jitter(i + j);
          dx = offset.dx;
          dy = offset.dy;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.max(MIN_DISTANCE, Math.sqrt(distSq));
        const force = (REPULSION / (dist * dist)) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // ② 스프링 — 간선은 자연 길이로 수렴한다.
    for (const link of links) {
      const { source, target } = link;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1e-3, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - LINK_DISTANCE) * LINK_STRENGTH * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    // ③ 레이어 앵커(x) + 느슨한 세로 중심 모으기(y).
    for (const node of nodes) {
      node.vx += (node.anchorX - node.x) * ANCHOR_X_STRENGTH * alpha;
      node.vy += (centerY - node.y) * CENTER_Y_STRENGTH * alpha;
    }

    // ④ 적분 + 감쇠.
    for (const node of nodes) {
      if (node.pinned) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx = clamp(node.vx * (1 - VELOCITY_DECAY), MAX_VELOCITY);
      node.vy = clamp(node.vy * (1 - VELOCITY_DECAY), MAX_VELOCITY);
      node.x += node.vx;
      node.y += node.vy;
    }

    // ⑤ 충돌 해소 — 힘이 아니라 위치를 직접 민다. 반지름이 우선순위·피의존
    //    수에 따라 제각각이라, 스프링만으로는 큰 노드끼리 겹친 채 정착한다.
    resolveCollisions(nodes);

    return alpha;
  }

  function bounds() {
    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.radius);
      minY = Math.min(minY, node.y - node.radius);
      maxX = Math.max(maxX, node.x + node.radius);
      maxY = Math.max(maxY, node.y + node.radius);
    }
    return { minX, minY, maxX, maxY };
  }

  return {
    nodes,
    get alpha() {
      return alpha;
    },
    step,
    settled: () => alpha <= ALPHA_MIN,
    reheat: (next = 0.75) => {
      alpha = Math.max(alpha, next);
    },
    byId,
    bounds,
    snapshot: () =>
      new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
  };
}

function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

/** 반지름이 겹치는 쌍을 절반씩 밀어 뗀다(핀 고정 노드는 안 움직인다). */
function resolveCollisions(nodes: ForceNode[]): void {
  const padding = 4;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const minDist = a.radius + b.radius + padding;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue;
      let dist = Math.sqrt(distSq);
      if (dist < 1e-6) {
        const offset = jitter(i + j);
        dx = offset.dx;
        dy = offset.dy;
        dist = Math.sqrt(dx * dx + dy * dy);
      }
      const push = (minDist - dist) / dist / 2;
      const ox = dx * push;
      const oy = dy * push;
      if (!a.pinned) {
        a.x -= ox;
        a.y -= oy;
      }
      if (!b.pinned) {
        b.x += ox;
        b.y += oy;
      }
    }
  }
}

/**
 * 여러 틱을 한 번에 돌린다 — 첫 프레임을 그리기 전에 "미리 익혀서" 사용자가
 * 흩어진 점들이 모여드는 과정을 안 보게 한다. 테스트에서도 그대로 쓴다.
 */
export function warmUp(sim: TaskGraphSimulation, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    if (sim.settled()) break;
    sim.step();
  }
}

/** 화면 좌표 → 월드 좌표에서 반지름 안에 들어오는 노드(위에 그려진 것 우선). */
export function hitTest(
  nodes: readonly ForceNode[],
  worldX: number,
  worldY: number,
  slop = 4,
): ForceNode | null {
  // 뒤에서부터 훑는다 — 그리기 순서상 나중 노드가 위에 있다.
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const dx = worldX - node.x;
    const dy = worldY - node.y;
    const reach = node.radius + slop;
    if (dx * dx + dy * dy <= reach * reach) return node;
  }
  return null;
}
