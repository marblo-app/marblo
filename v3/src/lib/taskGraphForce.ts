import type { TaskGraphLayout } from "./taskGraphLayout";

/**
 * 그래프 뷰의 **포스-다이렉티드 시뮬레이터** — 순수 모듈, DOM/RAF/캔버스 무관.
 *
 * 왜 d3-force 를 안 끌어왔나: 이 파일이 하는 일은 반발·스프링·앵커 세 힘을
 * 적분하는 것뿐이고, 그건 200줄이면 끝난다. 반면 새 npm 의존은 lock 재생성과
 * optional-dep CI 를 건드리고(이 저장소가 이미 데인 적 있는 자리), 오프라인
 * 설치 표면도 넓힌다. taskGraphLayout 이 dagre/elk 를 마다한 것과 같은 판단이다.
 *
 * ★RAF 를 여기 두지 않는 게 핵심이다. 시간을 프레임이 아니라 `step()` 호출 수로
 * 세기 때문에 테스트가 "300틱 뒤에 이 그래프는 이렇게 정착한다" 를 그대로 단언할
 * 수 있다. 애니메이션은 뷰의 일이고 수렴은 여기 일이다.
 *
 * ★결정론: Math.random 을 쓰지 않는다. 초기 좌표는 인덱스에서 황금각으로 뽑고,
 * 겹친 노드를 떼는 흔들기조차 인덱스에서 각도를 뽑는다. 같은 보드를 두 번 열면
 * 같은 그림이 나와야 사용자가 위치를 기억으로 쓸 수 있다.
 *
 * ★시드가 이 파일의 제일 중요한 결정이다 — 자세한 이유는 `computeSeeds` 주석.
 * 요약하면: 레이아웃의 level 은 "의존 깊이" 라 의존이 없는 티켓은 **전부** 0 이다.
 * 실데이터가 1207태스크/82의존이라 1100개 넘는 고립 노드가 level 0 한 컬럼에
 * 세로로 쌓이고, x-앵커가 그걸 계속 붙들어 화면이 세로 일자가 됐다. 그래서 시드를
 * "레벨당 세로 한 컬럼" 에서 "면적을 채우는 원반" 으로 바꾸고, 고립 노드에서는
 * x-앵커를 아예 뗐다.
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
   * ★레이어 x 앵커 — **컴포넌트 중심 기준 상대 좌표**다. 이 앵커가 없으면 순수
   * 포스가 사슬을 아무 방향으로나 굽혀서 "왼쪽이 먼저" 라는 읽기 규칙이 사라진다.
   *
   * 절대 좌표(level * 간격)로 두면 안 되는 이유: 서로 무관한 컴포넌트 수십 개가
   * 전부 같은 x 컬럼으로 끌려와 겹친다. 컴포넌트마다 자기 중심에서 좌→우로
   * 펼치면 읽기 규칙은 그대로 두고 덩어리끼리는 흩어진다.
   *
   * ★`null` = 고립 노드(degree 0). 앵커가 없다 — 이웃이 없어 방향을 읽을 것도
   * 없는데 x 로 당기면 한 줄로 뭉치기만 한다. 대신 약한 2D 중력만 받는다.
   */
  anchorX: number | null;
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

/** 황금각(≈137.5°) — phyllotaxis 와 흔들기가 같이 쓴다. */
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * 시드 원반에서 노드 하나가 차지하는 평균 면적의 한 변(px) — 하한.
 *
 * 반지름 9~26px짜리 원 + 라벨이 들어앉을 만큼은 되고, 스프링 자연 길이(120)
 * 보다는 촘촘해야 한다 — 연결된 덩어리가 시드 단계에서 이미 "뭉쳐 보여야"
 * 포스가 그걸 흩기 전에 클러스터로 읽힌다.
 */
const SEED_SPACING = 64;
/**
 * 실제 간격은 `max(SEED_SPACING, 평균 지름 + 이 여백)` 이다. 노드 크기는
 * 우선순위·피의존 수에 따라 9~26px 로 변하는데, 간격을 상수로 못 박으면 큰
 * 노드만 모인 보드에서 충돌 해소가 영원히 이기지 못하고 부글거린다.
 */
const SEED_GAP = 32;
/** 컴포넌트 안에서 레벨(열) 간 간격. 좌→우 읽기 규칙을 만드는 값. */
const LEVEL_SPACING = 168;

/** 스프링의 자연 길이. 노드 지름 대비 넉넉해야 라벨이 겹치지 않는다. */
const LINK_DISTANCE = 120;
const LINK_STRENGTH = 0.09;
/** 반발 상수. 거리² 로 나눠 쓰므로 값 자체는 크다. */
const REPULSION = 14000;
/** 반발 계산 시 거리 하한 — 0 근처에서 힘이 폭발하는 걸 막는다. */
const MIN_DISTANCE = 12;
/**
 * 이 거리를 넘으면 반발을 아예 건너뛴다.
 *
 * ★값을 줄인 건(520 → 300) 성능이 아니라 **모양** 때문이다. 반발의 먼 꼬리는
 * 1/r² 이라 개별로는 약해도 노드 1000개가 더해지면 원반 가장자리를 바깥으로
 * 계속 밀어낸다(중심부는 사방에서 상쇄돼 안 밀린다). 그러면 원반이 도넛처럼
 * 부풀어 화면 맞춤 배율이 바닥을 친다. 간격 결정은 어차피 가까운 이웃이 하므로
 * 꼬리를 잘라도 촘촘함은 그대로다.
 */
const REPULSION_CUTOFF = 300;
/** x 앵커(레이어 유지) 강도 — 연결된 노드에만 걸린다. */
const ANCHOR_X_STRENGTH = 0.075;
/** y 중심 모으기 — 세로로 무한정 퍼지는 걸 막는 약한 힘. */
const CENTER_Y_STRENGTH = 0.006;
/**
 * 고립 노드를 붙드는 2D 중력. x·y 에 같은 세기로 걸어야 **등방(等方)** 이다 —
 * 한 축만 세게 당기면 그 축으로 납작해진 띠가 되고, 그게 정확히 고치려는 증상이다.
 *
 * ★원반 **밖에서만** 걸린다(안에서는 0). 어디서나 중심으로 당기면 반발과 균형이
 * 맞는 지점이 노드 수에 따라 달라져서, 티켓이 늘수록 밀도가 올라가고 결국 큰
 * 노드들이 겹친 채 부글거린다. 벽만 세우면 밀도가 시드 밀도 그대로 유지된다.
 */
const ISOLATED_GRAVITY = 0.02;
/** 속도 감쇠(d3 의 velocityDecay 0.4 와 같은 의미: v *= 0.6). */
const VELOCITY_DECAY = 0.4;
/** 한 틱에 낼 수 있는 최대 속도 — 수치 폭주 방지. */
const MAX_VELOCITY = 45;

export const ALPHA_MIN = 0.008;
const ALPHA_DECAY = 0.021;

/** 충돌 해소에서 두 원 사이에 남기는 여백. */
const COLLISION_PADDING = 4;

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
  const angle = index * GOLDEN_ANGLE; // 인덱스가 몰려도 방향이 갈린다
  return { dx: Math.cos(angle) * 0.5, dy: Math.sin(angle) * 0.5 };
}

/**
 * 황금각 phyllotaxis — `count` 개의 점을 반지름 `radius` 원반에 고르게 깐다.
 *
 * 해바라기 씨앗 배열과 같은 규칙이다. 무작위 배치는 뭉침과 빈 구멍이 생기지만
 * (그리고 Math.random 은 결정론을 깬다) 황금각은 인덱스만으로 어떤 개수에서든
 * 균등에 가까운 배치를 준다. r ∝ √index 라 고리마다 면적이 같아진다 — 이게
 * "세로 한 줄" 대신 "면적을 채우는" 배치의 정체다.
 */
function phyllotaxis(
  index: number,
  count: number,
  radius: number,
): { x: number; y: number } {
  if (count <= 1) return { x: 0, y: 0 };
  const r = radius * Math.sqrt((index + 0.5) / count);
  const angle = index * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

interface Seed {
  x: number;
  y: number;
  anchorX: number | null;
}

interface SeedField {
  byId: Map<string, Seed>;
  /**
   * 고립 노드를 가두는 원반 반지름. 시드 밀도를 그대로 유지하는 "무른 벽" 이고,
   * 이게 곧 화면에 뜨는 그래프의 크기 = 대략 정사각형 bounds 의 한 변/2 다.
   */
  containRadius: number;
}

/**
 * 레이아웃 → 시드 좌표 + x 앵커.
 *
 * ★여기가 "세로 일자" 를 고치는 자리다. 예전 시드는 `x = level * 간격`,
 * `y = 레벨 안 순번 * 간격` 이었다. level 은 **의존 깊이**라 의존이 없는 티켓은
 * 전부 0 이고, 실보드는 1207태스크에 의존이 82개뿐이라 1100개 넘는 노드가 level 0
 * 한 컬럼에 세로로 쌓였다. 게다가 x-앵커가 그 컬럼으로 계속 되당겨서, 반발로
 * 밀려나도 다시 줄을 섰다.
 *
 * 새 규칙은 셋이다:
 *   ① **컴포넌트 단위 배치.** 연결 요소를 먼저 나누고, 컴포넌트 *중심*을
 *      phyllotaxis 로 원반에 깐다. 원반 반지름은 √(노드 수)에 비례해서, 티켓이
 *      늘어도 밀도는 그대로고 종횡비는 정사각형에 수렴한다.
 *   ② **컴포넌트 안은 다시 phyllotaxis.** 같은 덩어리는 처음부터 한 자리에
 *      모여서 출발하고, 스프링이 그걸 더 조인다 → 의존 있는 티켓이 눈에 띄는
 *      클러스터로 보인다(이 뷰의 값어치).
 *   ③ **x 앵커는 컴포넌트 중심 상대.** 절대 좌표면 컴포넌트 수십 개가 같은
 *      컬럼으로 끌려와 다시 겹친다. 고립 노드(size 1)는 앵커 자체가 없다.
 *
 * 큰 덩어리를 먼저(=원반 안쪽에) 놓는 건 시선이 먼저 닿는 자리에 제일 읽을 게
 * 많은 그림이 오게 하려는 것이다. 정렬 tie-break 는 입력 순서라 결정론이 유지된다.
 */
function computeSeeds(layout: TaskGraphLayout, spacing: number): SeedField {
  const seeds = new Map<string, Seed>();
  const total = layout.nodes.length;
  if (total === 0) return { byId: seeds, containRadius: 0 };

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  // 무향 인접 — 컴포넌트 분해용. 순환 간선도 포함한다(순환은 레벨 계산에서만
  // 빼는 것이지, 두 티켓이 무관하다는 뜻이 아니다).
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const edge of layout.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }

  // BFS 로 연결 요소를 뽑는다. 재귀 대신 배열 커서 — 1000개짜리 사슬에서도
  // 스택이 안 터진다(taskGraphLayout 이 같은 이유로 명시적 스택을 쓴다).
  const visited = new Set<string>();
  const components: {
    ids: string[];
    minLevel: number;
    maxLevel: number;
    firstIndex: number;
  }[] = [];
  layout.nodes.forEach((node, index) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const ids = [node.id];
    let minLevel = node.level;
    let maxLevel = node.level;
    for (let head = 0; head < ids.length; head += 1) {
      for (const next of adjacency.get(ids[head]) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        ids.push(next);
        const level = nodeById.get(next)?.level ?? 0;
        if (level < minLevel) minLevel = level;
        if (level > maxLevel) maxLevel = level;
      }
    }
    components.push({ ids, minLevel, maxLevel, firstIndex: index });
  });

  components.sort(
    (a, b) => b.ids.length - a.ids.length || a.firstIndex - b.firstIndex,
  );

  // 노드 수에 비례한 원반 — 면적 ∝ 노드 수라 밀도가 개수와 무관하게 일정하다.
  const outerRadius = spacing * Math.sqrt(total / Math.PI);

  components.forEach((component, componentIndex) => {
    const center = phyllotaxis(componentIndex, components.length, outerRadius);
    const size = component.ids.length;
    const innerRadius = spacing * Math.sqrt(size / Math.PI);
    // 레벨 범위의 가운데를 0 으로 잡아야 컴포넌트가 자기 중심에서 좌우로
    // 균형 있게 펼쳐진다(왼쪽 끝을 0 으로 잡으면 전부 오른쪽으로 흘러간다).
    const levelMid = (component.minLevel + component.maxLevel) / 2;
    component.ids.forEach((id, indexInComponent) => {
      const offset = phyllotaxis(indexInComponent, size, innerRadius);
      const level = nodeById.get(id)?.level ?? 0;
      seeds.set(id, {
        x: center.x + offset.x,
        y: center.y + offset.y,
        anchorX:
          size === 1 ? null : center.x + (level - levelMid) * LEVEL_SPACING,
      });
    });
  });

  return { byId: seeds, containRadius: outerRadius };
}

/**
 * 레이어드 레이아웃 → 포스 시뮬.
 *
 * 시드는 `computeSeeds` 가 만든 원반 좌표다. 무작위 배치에서 출발하면 수백 틱을
 * 태워도 사슬이 꼬인 채로 정착하지만, 컴포넌트별로 미리 모아 둔 시드에서
 * 출발하면 대개 100틱 안에 읽히는 모양이 나온다.
 */
export function createTaskGraphSimulation(
  layout: TaskGraphLayout,
  options: ForceSimulationOptions = {},
): TaskGraphSimulation {
  const { previous, radiusOf } = options;

  // 시드 간격은 실제 노드 크기를 보고 정한다 — 상수로 못 박으면 큰 노드만 모인
  // 보드에서 충돌 해소가 매 틱 싸우기만 하고 정착하지 못한다.
  let radiusSum = 0;
  for (const node of layout.nodes) radiusSum += radiusOf?.(node.id) ?? 12;
  const meanRadius =
    layout.nodes.length === 0 ? 12 : radiusSum / layout.nodes.length;
  const spacing = Math.max(SEED_SPACING, meanRadius * 2 + SEED_GAP);

  const seeds = computeSeeds(layout, spacing);

  const nodes: ForceNode[] = layout.nodes.map((node, index) => {
    const seed = seeds.byId.get(node.id);
    const carried = previous?.get(node.id);
    const offset = jitter(index);
    return {
      id: node.id,
      x: (carried?.x ?? seed?.x ?? 0) + offset.dx,
      y: (carried?.y ?? seed?.y ?? 0) + offset.dy,
      vx: 0,
      vy: 0,
      radius: radiusOf?.(node.id) ?? 12,
      anchorX: seed?.anchorX ?? null,
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

  // 중력이 향하는 점 — 시드(또는 이어받은 좌표)의 무게중심. 원점으로 못 박으면
  // previous 를 이어받아 화면 한쪽으로 옮겨 간 그래프가 매번 원점으로 끌려온다.
  let centerX = 0;
  let centerY = 0;
  if (nodes.length > 0) {
    for (const node of nodes) {
      centerX += node.x;
      centerY += node.y;
    }
    centerX /= nodes.length;
    centerY /= nodes.length;
  }

  const { containRadius } = seeds;

  // 충돌 격자의 셀 크기 — 제일 큰 두 원이 닿는 거리. 반지름은 생성 시 고정이라
  // 한 번만 구하면 된다.
  let maxRadius = 0;
  for (const node of nodes) maxRadius = Math.max(maxRadius, node.radius);
  const collisionCell = Math.max(1, maxRadius * 2 + COLLISION_PADDING);

  let alpha = 1;

  function step(): number {
    if (nodes.length === 0) {
      alpha = 0;
      return alpha;
    }
    alpha += (0 - alpha) * ALPHA_DECAY;

    applyRepulsion(nodes, alpha);

    // ② 스프링 — 간선은 자연 길이로 수렴한다. 연결된 노드가 서로 당겨 클러스터가
    //    되는 힘이라, 이 뷰에서 "의존이 있다" 를 눈에 보이게 만드는 게 이거다.
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

    // ③ 붙드는 힘. 연결된 노드는 레이어 앵커(x) + 느슨한 세로 모으기(y),
    //    고립 노드는 원반 밖으로 나갈 때만 걸리는 등방 2D 중력. 고립 노드에
    //    x 앵커를 걸면 이웃도 없는 점 수백 개가 한 컬럼에 줄을 선다 — 원래 버그.
    for (const node of nodes) {
      if (node.anchorX === null) {
        const dx = node.x - centerX;
        const dy = node.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > containRadius) {
          const pull =
            ((dist - containRadius) * ISOLATED_GRAVITY * alpha) / dist;
          node.vx -= dx * pull;
          node.vy -= dy * pull;
        }
      } else {
        node.vx += (node.anchorX - node.x) * ANCHOR_X_STRENGTH * alpha;
        node.vy += (centerY - node.y) * CENTER_Y_STRENGTH * alpha;
      }
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
    resolveCollisions(nodes, collisionCell);

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

// ── 공간 격자 ────────────────────────────────────────────────────────────────
//
// ★반발과 충돌은 원래 모든 쌍을 훑었다(O(n²)). 실보드가 1207노드라 틱당 72만
// 쌍 × 2회 × warmUp 140틱 ≈ 2억 회 — 뷰가 뜰 때 눈에 보이는 프리즈가 난다.
// 둘 다 "일정 거리 밖은 어차피 버리는" 힘이라, 균일 격자로 후보를 걸러 내면
// 결과는 그대로 두고 비용만 O(n·이웃)으로 떨어진다. 쿼드트리(Barnes-Hut)까지
// 갈 수도 있지만 그건 먼 힘을 **근사**하는 것이라 그림이 바뀐다. 격자는 컷오프
// 안의 쌍을 하나도 빠뜨리지 않으므로 근사가 아니다.
//
// ★결정론: 셀 배정은 좌표만 보고, 셀 안 순서는 노드 인덱스 오름차순(카운팅
// 정렬)이며, 셀 순회 순서도 고정이다 → 덧셈 순서가 매번 같다.

interface SpatialGrid {
  cell: number;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  /** 셀 c 의 구성원은 order[start[c] .. start[c+1]) 이다. */
  start: Int32Array;
  order: Int32Array;
}

/** 격자가 메모리를 먹지 않도록 한 변을 이만큼으로 제한한다. */
const MAX_GRID_SIDE = 256;

function cellCoord(
  value: number,
  min: number,
  cell: number,
  limit: number,
): number {
  const index = Math.floor((value - min) / cell);
  // NaN 은 두 비교를 모두 통과하지 못한다 → 0 번 셀로 떨어진다(발산 방지).
  if (!(index >= 0)) return 0;
  if (index >= limit) return limit - 1;
  return index;
}

function buildGrid(nodes: ForceNode[], preferredCell: number): SpatialGrid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const cell = Math.max(
    preferredCell,
    width / MAX_GRID_SIDE,
    height / MAX_GRID_SIDE,
    1,
  );
  const cols = Math.max(1, Math.floor(width / cell) + 1);
  const rows = Math.max(1, Math.floor(height / cell) + 1);

  const start = new Int32Array(cols * rows + 1);
  const owner = new Int32Array(nodes.length);
  for (let i = 0; i < nodes.length; i += 1) {
    const cx = cellCoord(nodes[i].x, minX, cell, cols);
    const cy = cellCoord(nodes[i].y, minY, cell, rows);
    const index = cy * cols + cx;
    owner[i] = index;
    start[index + 1] += 1;
  }
  for (let c = 0; c < cols * rows; c += 1) start[c + 1] += start[c];
  const cursor = start.slice(0, cols * rows);
  const order = new Int32Array(nodes.length);
  for (let i = 0; i < nodes.length; i += 1) {
    order[cursor[owner[i]]] = i;
    cursor[owner[i]] += 1;
  }

  return { cell, cols, rows, minX, minY, start, order };
}

/**
 * ① 반발 — 컷오프 안의 모든 쌍. 격자로 후보만 훑는다.
 *
 * 한 행에서 이웃 세 열은 `start` 위에서 연속 구간이라 한 번의 슬라이스로 걷는다.
 */
function applyRepulsion(nodes: ForceNode[], alpha: number): void {
  const grid = buildGrid(nodes, REPULSION_CUTOFF);
  const { cols, rows, cell, minX, minY, start, order } = grid;
  const cutoffSq = REPULSION_CUTOFF * REPULSION_CUTOFF;

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const cx = cellCoord(a.x, minX, cell, cols);
    const cy = cellCoord(a.y, minY, cell, rows);
    const loRow = cy > 0 ? cy - 1 : 0;
    const hiRow = cy + 1 < rows ? cy + 1 : rows - 1;
    const loCol = cx > 0 ? cx - 1 : 0;
    const hiCol = cx + 1 < cols ? cx + 1 : cols - 1;

    for (let gy = loRow; gy <= hiRow; gy += 1) {
      const base = gy * cols;
      const from = start[base + loCol];
      const to = start[base + hiCol + 1];
      for (let k = from; k < to; k += 1) {
        const j = order[k];
        if (j <= i) continue;
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq > cutoffSq) continue;
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
  }
}

/** 반지름이 겹치는 쌍을 절반씩 밀어 뗀다(핀 고정 노드는 안 움직인다). */
function resolveCollisions(nodes: ForceNode[], collisionCell: number): void {
  const grid = buildGrid(nodes, collisionCell);
  const { cols, rows, cell, minX, minY, start, order } = grid;

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const cx = cellCoord(a.x, minX, cell, cols);
    const cy = cellCoord(a.y, minY, cell, rows);
    const loRow = cy > 0 ? cy - 1 : 0;
    const hiRow = cy + 1 < rows ? cy + 1 : rows - 1;
    const loCol = cx > 0 ? cx - 1 : 0;
    const hiCol = cx + 1 < cols ? cx + 1 : cols - 1;

    for (let gy = loRow; gy <= hiRow; gy += 1) {
      const base = gy * cols;
      const from = start[base + loCol];
      const to = start[base + hiCol + 1];
      for (let k = from; k < to; k += 1) {
        const j = order[k];
        if (j <= i) continue;
        const b = nodes[j];
        const minDist = a.radius + b.radius + COLLISION_PADDING;
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
}

/** 작은 보드에서 쓰는 예열 틱 수(= 예산이 남아돌 때의 상한). */
const WARM_UP_MAX_TICKS = 140;
/** 아주 큰 보드에서도 이만큼은 돌린다 — 시드가 이미 읽히는 그림이라 충분하다. */
const WARM_UP_MIN_TICKS = 40;
/** 예열 예산: (틱 수 × 노드 수). 한 틱 비용이 노드 수에 비례하므로 곱이 곧 시간. */
const WARM_UP_BUDGET = WARM_UP_MAX_TICKS * 400;

/**
 * 첫 프레임 전에 미리 돌릴 틱 수 — **노드 수에 반비례하는 예산제**.
 *
 * 예열은 `useEffect` 안에서 동기로 돈다. 상수 140틱으로 두면 티켓이 1000장을
 * 넘는 순간 뷰를 여는 데 눈에 보이는 멈춤이 생긴다. 반대로 무작정 줄이면 작은
 * 보드가 덜 익은 채 떠서 점들이 모여드는 게 보인다. 시드가 이미 원반으로 깔려
 * 있어 큰 보드일수록 예열이 덜 필요하다는 점을 그대로 값으로 옮긴 것이다.
 */
export function recommendedWarmUpTicks(nodeCount: number): number {
  if (nodeCount <= 0) return 0;
  const budgeted = Math.round(WARM_UP_BUDGET / nodeCount);
  return Math.min(WARM_UP_MAX_TICKS, Math.max(WARM_UP_MIN_TICKS, budgeted));
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

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GraphViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface FitOptions {
  /** 가장자리 노드가 창에 딱 붙지 않도록 남기는 화면 여백(px). */
  padding: number;
  minZoom: number;
  maxZoom: number;
  /** 노드 몇 개짜리 보드를 억지로 확대하지 않게 하는 상한. */
  maxFitZoom: number;
}

/**
 * 그래프 bounds → 화면 변환(팬 + 줌). 순수 함수라서 캔버스 없이 테스트된다.
 *
 * ★뷰에서 떼어낸 이유: 시드가 원반으로 바뀌면서 그래프의 한 변이 √(노드 수)에
 * 비례하게 됐고(1200 티켓 ≈ 3000px), "정말 화면 안에 다 들어오나" 가 회귀
 * 대상이 됐다. jsdom 은 레이아웃이 없어 캔버스 렌더 테스트로는 이걸 못 잰다.
 *
 * 짧은 변에 맞춰야(min) 양축이 모두 들어온다 — max 로 잡으면 긴 쪽이 잘린다.
 */
export function fitGraphToViewport(
  bounds: GraphBounds,
  width: number,
  height: number,
  options: FitOptions,
): GraphViewTransform {
  const { padding, minZoom, maxZoom, maxFitZoom } = options;
  const graphW = Math.max(1, bounds.maxX - bounds.minX);
  const graphH = Math.max(1, bounds.maxY - bounds.minY);
  // 여백이 뷰포트보다 크면(아주 좁은 패널) 0 이하가 되어 배율이 뒤집힌다.
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const k = Math.min(
    maxZoom,
    Math.max(minZoom, Math.min(usableW / graphW, usableH / graphH, maxFitZoom)),
  );
  return {
    k,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * k,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * k,
  };
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
