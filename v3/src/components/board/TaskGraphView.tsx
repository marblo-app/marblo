import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Task } from "../../types/task";
import type { Agent } from "../../types/agent";
import { useAgentStore } from "../../stores/agentStore";
import { spawnedModelLabel } from "../../lib/spawnedModelLabel";
import { useTranslation, type TFunction } from "../../lib/i18n";
import {
  layoutTaskGraph,
  type TaskGraphLayout,
} from "../../lib/taskGraphLayout";
import {
  CONFLICT_HEX,
  CRITICAL_HEX,
  ISOLATED_ALPHA,
  MAX_CONFLICT_EDGES,
  READINESS_RING,
  STATUS_HEX,
  STUCK_HEX,
  classifyTaskReadiness,
  computeCriticalPath,
  computeScopeConflicts,
  computeStuckImpact,
  conflictLinks,
  countDependents,
  findIsolatedNodes,
  graphNodeRadius,
  isActiveStatus,
  summarizeReadiness,
  type ScopeConflictEdge,
  type StuckImpactResult,
  type TaskReadiness,
} from "../../lib/taskGraphAnalysis";
import {
  createTaskGraphSimulation,
  fitGraphToViewport,
  hitTest,
  recommendedWarmUpTicks,
  warmUp,
  type ForceNode,
  type TaskGraphSimulation,
} from "../../lib/taskGraphForce";
import { ROLE_ICONS } from "./TaskCard";
import { STATUS_CONFIG } from "./KanbanColumn";

/**
 * 보드의 **그래프 뷰** — 같은 티켓들을 컬럼이 아니라 의존 관계(dependsOn)로
 * 그린다.
 *
 * 칸반은 "지금 어느 단계인가" 를 답하지만 "무엇이 무엇을 막고 있나" 는 못
 * 답한다. 그래프는 그 질문만 전담한다. Phase 2 에서 답하는 질문이 둘 더 늘었다:
 * **지금 던질 수 있는 티켓이 뭔가**(준비/대기 구분)와 **끝나는 시점을 결정하는
 * 사슬이 뭔가**(크리티컬 패스). 판정은 전부 taskGraphAnalysis 의 순수 함수가
 * 하고 여기는 칠하기만 한다.
 *
 * ★Phase 3 에서 이 뷰는 **조율 도구**가 된다. 실보드가 1207태스크/82의존이라
 * dependsOn 만으론 노드의 90% 가 고립점이고, 그러면 그래프는 예쁘기만 하고
 * 아무 결정도 못 돕는다. 그래서 관계를 하나 더 그린다: **scope 겹침**. 두 티켓의
 * `scope[]` 가 같은 파일 영역을 가리키면 병렬로 던지는 순간 머지 충돌이므로,
 * 의존과 **구별되는** 주황 점선(화살표 없음 — 방향이 없는 관계다)으로 잇는다.
 * 여기에 정체(stuck) 티켓의 폭발 반경과 "간선 0" 노드의 배경화가 얹혀서,
 * 화면이 답하는 질문이 넷이 된다:
 *   ① 지금 던질 수 있는 게 뭔가  ② 끝을 결정하는 사슬이 뭔가
 *   ③ 같이 던지면 깨지는 게 뭔가  ④ 막힌 하나가 몇 장을 세우고 있나
 *
 * ★렌더가 DOM 이 아니라 캔버스인 이유: 포스 시뮬이 매 프레임 노드 좌표를 전부
 * 바꾸기 때문이다. 노드가 DOM 박스면 프레임마다 수십~수백 개의 스타일 재계산이
 * 걸려 60fps 가 안 나오고, 글로우(shadowBlur)도 캔버스에서만 싸다.
 *
 * ★대신 **접근성·테스트용 노드 목록을 sr-only DOM 으로 병행**한다. 캔버스는
 * 스크린리더에 아무것도 아니고 키보드로 짚을 수도 없어서, 캔버스만 두면 이 뷰는
 * 마우스 전용 화면이 된다. 목록의 버튼은 포커스되면 캔버스 쪽 강조까지 켜서
 * 키보드 사용자도 "지금 어느 노드인지" 를 눈으로 확인할 수 있다.
 *
 * ★상세는 여기서 그리지 않는다. 노드 클릭은 `onSelect` 로 올려 보드가 이미
 * 쓰는 TaskDetailModal 을 그대로 연다 — 뷰마다 다른 상세 화면이 생기면 어느
 * 쪽이 정본인지 갈린다.
 *
 * ★색은 앱 다크 고정이다. prefers-color-scheme 을 보지 않는다 — 이 앱에 라이트
 * 테마가 없어서, 미디어 쿼리를 붙이면 OS 가 라이트인 사용자에게만 캔버스가
 * 뒤집혀 보드와 색이 갈린다.
 */
interface TaskGraphViewProps {
  tasks: Task[];
  onSelect: (task: Task) => void;
}

/**
 * ★0.2 였다가 내렸다. 포스 시드가 "세로 한 컬럼" 에서 "면적을 채우는 원반" 으로
 * 바뀌면서 그래프의 실제 크기가 √(노드 수)에 비례하게 됐다 — 1200 티켓이면 한
 * 변이 3000px 쯤 된다. 800px 뷰포트에 넣으려면 0.23 배가 필요한데 하한이 0.2 면
 * 아슬아슬하고, 티켓이 더 늘면 하한에 걸려 **화면 맞춤이 조용히 잘린다**(가장자리
 * 노드가 영영 안 보인다). 하한은 사용자 휠 줌이 뒤집히지 않을 정도만 있으면 된다.
 */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;
/** 화면 맞춤에서 가장자리 노드가 창에 붙지 않도록 남기는 여백(px). */
const FIT_PADDING = 56;
/** 노드 두어 개짜리 보드를 억지로 확대하지 않게 하는 상한. */
const MAX_FIT_ZOOM = 1.1;
/** 이어받은 배치에 새 노드만 끼워 넣을 때의 틱 수(예산 상한 안에서). */
const RESEED_TICKS = 30;
/** 라벨을 그리기 시작하는 줌 — 이보다 작으면 글자가 죽처럼 뭉친다. */
const LABEL_ZOOM = 0.55;
/**
 * 독립(간선 0) 노드의 라벨은 여기서부터 나온다.
 *
 * 실보드에서 독립 노드가 1100장이라 일반 임계로 두면 라벨이 화면을 덮어 정작
 * 연결 클러스터의 이름이 안 읽힌다. 배경으로 물린 것에는 이름도 배경만큼만 준다
 * — 대신 확대하거나 호버하면 언제든 읽을 수 있다.
 */
const ISOLATED_LABEL_ZOOM = 1.05;
const PULSE_PERIOD_MS = 1700;
/** 펄스 전용 프레임 간격(≈22fps). 정착 후에도 60fps 로 태우지 않는다. */
const PULSE_FRAME_MS = 45;
/** 이만큼 유휴 프레임이 지나면 RAF 를 끊는다(전기 아끼기). */
const IDLE_FRAMES_BEFORE_STOP = 40;
/** 이 픽셀 이상 움직였으면 클릭이 아니라 드래그로 친다. */
const CLICK_SLOP = 4;

const EDGE_COLOR = "#4b5563"; // gray-600
const CYCLE_COLOR = "#f59e0b"; // amber-500
const LABEL_COLOR = "#cbd5e1"; // slate-300
const DIM_ALPHA = 0.09;

/** readiness → 범례·스크린리더가 쓰는 라벨 키. */
const READINESS_LABEL_KEY = {
  ready: "board.graph.readiness.ready",
  waiting: "board.graph.readiness.waiting",
  active: "board.graph.readiness.active",
  stuck: "board.graph.readiness.stuck",
  done: "board.graph.readiness.done",
} as const;

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/**
 * 캔버스가 매 프레임 읽어야 하는 것 전부. React state 를 클로저로 잡지 않는다 —
 * draw 를 state 에 의존시키면 호버 한 번에 RAF 루프를 통째로 재생성해야 한다.
 */
interface Scene {
  layout: TaskGraphLayout;
  /** id → task. 매 프레임 노드 배열을 find 로 훑으면 O(n²)가 된다. */
  taskById: Map<string, Task>;
  readiness: Map<string, TaskReadiness>;
  criticalNodes: Set<string>;
  criticalEdges: Set<string>;
  showCritical: boolean;
  conflictEdges: ScopeConflictEdge[];
  showConflicts: boolean;
  stuck: StuckImpactResult;
  isolatedIds: Set<string>;
  focusIds: Set<string> | null;
  hoveredId: string | null;
}

export function TaskGraphView({ tasks, onSelect }: TaskGraphViewProps) {
  const { t } = useTranslation();
  const agents = useAgentStore((s) => s.agents);

  const layout = useMemo(() => layoutTaskGraph(tasks), [tasks]);
  const taskById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node.task])),
    [layout],
  );
  const readiness = useMemo(() => classifyTaskReadiness(layout), [layout]);
  const readinessCounts = useMemo(
    () => summarizeReadiness(readiness),
    [readiness],
  );
  const critical = useMemo(() => computeCriticalPath(layout), [layout]);
  const dependents = useMemo(() => countDependents(layout), [layout]);
  /** scope 겹침 — 열린 티켓끼리만. DONE 은 이미 머지돼 누구와도 안 부딪힌다. */
  const conflicts = useMemo(
    () => computeScopeConflicts(layout, readiness),
    [layout, readiness],
  );
  const stuck = useMemo(
    () => computeStuckImpact(layout, readiness),
    [layout, readiness],
  );
  /** 의존도 scope 겹침도 없는 노드 = 백로그 필드(작게·흐리게). */
  const isolatedIds = useMemo(
    () => findIsolatedNodes(layout, conflicts),
    [layout, conflicts],
  );

  /** id → 직접 이웃(선행 + 후행). 호버 강조가 매번 엣지를 훑지 않도록. */
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      const set = map.get(a);
      if (set) set.add(b);
      else map.set(a, new Set([b]));
    };
    for (const edge of layout.edges) {
      add(edge.from, edge.to);
      add(edge.to, edge.from);
    }
    return map;
  }, [layout]);

  /** 노드 집합이 바뀌었는지 판단하는 서명 — 바뀔 때만 화면 맞춤을 다시 한다. */
  const graphSignature = useMemo(
    () =>
      layout.nodes
        .map((node) => node.id)
        .sort()
        .join("|"),
    [layout],
  );

  const [showCritical, setShowCritical] = useState(true);
  const [showConflicts, setShowConflicts] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoomLabel, setZoomLabel] = useState(1);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const simRef = useRef<TaskGraphSimulation | null>(null);
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const dirtyRef = useRef(true);
  const idleFramesRef = useRef(0);
  const lastPulseRef = useRef(0);
  const hasPulseRef = useRef(false);
  const sceneRef = useRef<Scene | null>(null);
  /** 드래그 상태 — pan(빈 곳) / node(노드 끌기) / none. */
  const dragRef = useRef<{
    mode: "none" | "pan" | "node";
    startX: number;
    startY: number;
    moved: number;
    nodeId: string | null;
  }>({ mode: "none", startX: 0, startY: 0, moved: 0, nodeId: null });

  // claimedBy 는 두 경로로 저장된다: 수동 UI 할당은 agent.name, MCP claim_task
  // 는 agent.id (TaskCard 와 같은 규칙). 노드마다 agents 를 훑지 않도록 한 번만
  // 색인한다.
  const agentByKey = useMemo(() => {
    const map = new Map<string, (typeof agents)[number]>();
    for (const agent of agents) {
      map.set(agent.id, agent);
      if (agent.name) map.set(agent.name, agent);
    }
    return map;
  }, [agents]);

  /**
   * 호버 강조 대상 — 의존 이웃 **과** scope 겹침 이웃 둘 다.
   *
   * 한쪽만 켜면 거짓말이 된다. "이 티켓을 지금 던져도 되나" 의 답은 선행이 끝났는
   * 지(의존)와 같은 파일을 누가 잡고 있는지(scope) 둘을 다 봐야 나온다.
   */
  const focusIds = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    for (const id of neighbors.get(hoveredId) ?? []) set.add(id);
    if (showConflicts) {
      for (const id of conflicts.neighbors.get(hoveredId) ?? []) set.add(id);
    }
    return set;
  }, [hoveredId, neighbors, conflicts, showConflicts]);

  // 매 렌더 최신 장면을 ref 에 밀어 넣는다. draw() 는 이것만 본다.
  sceneRef.current = {
    layout,
    taskById,
    readiness,
    criticalNodes: critical.idSet,
    criticalEdges: critical.edgeIds,
    showCritical,
    conflictEdges: conflicts.edges,
    showConflicts,
    stuck,
    isolatedIds,
    focusIds,
    hoveredId,
  };
  // 펄스가 필요한가 = 굴러가는 노드 또는 정체 여파 고리가 하나라도 있는가.
  // 없으면 RAF 는 정착 후 스스로 멈춘다(데스크톱 앱이라 보드를 열어 둔 채
  // 자리를 비우는 게 정상 사용이다).
  hasPulseRef.current =
    stuck.downstreamIds.size > 0 ||
    layout.nodes.some((node) => isActiveStatus(node.task.status));

  /**
   * 2D 컨텍스트. jsdom(테스트)에는 캔버스 구현이 없어 getContext 가 던지거나
   * null 을 준다 — 여기서 한 번 잡아 두면 렌더 경로 전체가 조용히 접힌다.
   * 캔버스가 죽어도 sr-only 목록은 살아 있어야 뷰가 완전히 사라지지 않는다.
   */
  const getCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (ctxRef.current) return ctxRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    try {
      ctxRef.current = canvas.getContext("2d");
    } catch {
      ctxRef.current = null;
    }
    return ctxRef.current;
  }, []);

  // ── 그리기 ─────────────────────────────────────────────────────────────
  const draw = useCallback(
    (now: number) => {
      const sim = simRef.current;
      const scene = sceneRef.current;
      const ctx = getCtx();
      if (!sim || !scene || !ctx) return;

      const { width, height, dpr } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const view = viewRef.current;
      const {
        focusIds: focus,
        criticalEdges,
        criticalNodes,
        taskById: tasksById,
      } = scene;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);
      ctx.lineCap = "round";

      const pulse = Math.sin((now / PULSE_PERIOD_MS) * Math.PI * 2);

      // ⓪ scope 겹침 — 의존 간선보다도 아래에 깐다. 개수가 많을 수 있어서
      //    위에 두면 의존 구조를 덮는다. 화살표를 안 그리는 게 핵심이다:
      //    "A 다음에 B" 가 아니라 "A 와 B 를 동시에 하지 마라" 라서 방향이 없다.
      if (scene.showConflicts) {
        ctx.setLineDash([5, 6]);
        ctx.shadowBlur = 0;
        for (const edge of scene.conflictEdges) {
          const from = sim.byId.get(edge.a);
          const to = sim.byId.get(edge.b);
          if (!from || !to) continue;
          const inFocus = !focus || (focus.has(edge.a) && focus.has(edge.b));
          ctx.globalAlpha = inFocus ? (focus ? 0.95 : 0.5) : DIM_ALPHA;
          ctx.strokeStyle = CONFLICT_HEX;
          ctx.lineWidth = focus && inFocus ? 2.4 : 1.5;
          drawPlainLink(ctx, from, to);
        }
        ctx.setLineDash([]);
      }

      // ① 간선 — 노드 밑에 깔린다.
      for (const edge of scene.layout.edges) {
        const from = sim.byId.get(edge.from);
        const to = sim.byId.get(edge.to);
        if (!from || !to) continue;

        const onCritical = scene.showCritical && criticalEdges.has(edge.id);
        // 정체 여파 = 막힌 티켓에서 아래로 뻗은 간선. 크리티컬보다 먼저 칠한다
        // — "이 선을 따라 사람이 손대야 풀린다" 가 더 급한 정보다.
        const onBlast = scene.stuck.edgeIds.has(edge.id);
        const inFocus = !focus || (focus.has(edge.from) && focus.has(edge.to));
        ctx.globalAlpha = inFocus ? 1 : DIM_ALPHA;

        const color = edge.cycle
          ? CYCLE_COLOR
          : onBlast
            ? STUCK_HEX
            : onCritical
              ? CRITICAL_HEX
              : EDGE_COLOR;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth =
          onCritical || onBlast ? 2.6 : focus && inFocus ? 2 : 1.3;
        ctx.setLineDash(edge.cycle ? [6, 5] : []);
        // 글로우는 강조된 선에만. 전부 번지게 하면 화면이 안개가 된다.
        ctx.shadowBlur = onCritical || onBlast ? 14 : 0;
        ctx.shadowColor = color;

        drawEdge(ctx, from, to);
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
      }

      // ② 노드.
      for (const node of sim.nodes) {
        const task = tasksById.get(node.id);
        if (!task) continue;
        const inFocus = !focus || focus.has(node.id);
        // 간선 0 = 백로그 필드. 지우지 않고 배경으로 물린다 — 안 보이면
        // "내 티켓이 사라졌다" 가 되고, 그대로 두면 연결 클러스터를 덮는다.
        const isolated = scene.isolatedIds.has(node.id);
        const baseAlpha = inFocus ? (isolated ? ISOLATED_ALPHA : 1) : DIM_ALPHA;
        ctx.globalAlpha = baseAlpha;

        const statusColor = STATUS_HEX[task.status] ?? EDGE_COLOR;
        const active = isActiveStatus(task.status);
        const radius = active ? node.radius * (1 + 0.07 * pulse) : node.radius;
        const onCritical = scene.showCritical && criticalNodes.has(node.id);
        const hovered = scene.hoveredId === node.id;
        const value = scene.readiness.get(node.id) ?? "waiting";

        // 정체(빨강)의 여파. 막힌 티켓 자신은 readiness 링이 이미 빨간색이라,
        // 여기서는 **그것에 막혀 있는 후행**을 칠한다 — BLOCKED 하나가 40장을
        // 세우고 있는 것과 아무도 안 기다리는 것은 다른 사건인데, 점 색깔만으론
        // 둘이 똑같이 생겼다. 펄스로 숨 쉬게 해서 정적인 링과도 구분한다.
        if (scene.stuck.downstreamIds.has(node.id)) {
          ctx.globalAlpha = baseAlpha * (0.45 + 0.25 * pulse);
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = STUCK_HEX;
          ctx.lineWidth = 1.6;
          ctx.setLineDash([2.5, 3.5]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = baseAlpha;
        }

        // 굴러가는 노드는 바깥으로 번지는 고리를 하나 더 두른다 — 크기 변화만
        // 으론 작은 노드에서 펄스가 안 읽힌다.
        if (active) {
          ctx.globalAlpha = baseAlpha * 0.3 * (0.55 + 0.45 * pulse);
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 7 + pulse * 3, 0, Math.PI * 2);
          ctx.fillStyle = statusColor;
          ctx.fill();
          ctx.globalAlpha = baseAlpha;
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.shadowBlur = hovered ? 26 : inFocus ? 16 : 0;
        ctx.shadowColor = statusColor;
        ctx.fill();
        ctx.shadowBlur = 0;

        // 안쪽 하이라이트 — 평평한 원보다 입체감이 살고, 겹쳐도 개수가 세진다.
        ctx.beginPath();
        ctx.arc(
          node.x - radius * 0.22,
          node.y - radius * 0.22,
          radius * 0.42,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fill();

        // readiness 링 — 준비(실선 emerald) / 대기(점선 amber) / 정체(red).
        const ring = READINESS_RING[value];
        if (ring) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3.2, 0, Math.PI * 2);
          ctx.strokeStyle = ring;
          ctx.lineWidth = 2;
          ctx.setLineDash(value === "waiting" ? [3, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 크리티컬 패스 후광.
        if (onCritical) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 7, 0, Math.PI * 2);
          ctx.strokeStyle = CRITICAL_HEX;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 16;
          ctx.shadowColor = CRITICAL_HEX;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        if (hovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 11, 0, Math.PI * 2);
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.restore();

      // ③ 라벨은 **화면 좌표계**에서 그린다. 월드 좌표에 그리면 줌 배율만큼
      //    글자가 같이 커지고 작아져서, 축소하면 못 읽고 확대하면 화면을 덮는다.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.font =
        "500 11px ui-sans-serif, -apple-system, 'Apple SD Gothic Neo', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // 어두운 후광 — 라벨이 간선이나 다른 노드 위에 얹혀도 읽힌다. 캔버스에는
      // text-shadow 가 없어서 그림자로 대신한다.
      ctx.shadowColor = "rgba(3,7,18,0.95)";
      ctx.shadowBlur = 4;
      for (const node of sim.nodes) {
        const inFocus = !focus || focus.has(node.id);
        if (!inFocus) continue;
        const onCritical = scene.showCritical && criticalNodes.has(node.id);
        const hovered = scene.hoveredId === node.id;
        // 축소 상태에서는 강조된 노드의 이름만 남긴다.
        if (view.k < LABEL_ZOOM && !hovered && !onCritical) continue;
        // 백로그 필드의 이름은 한참 확대해야 나온다 — 실보드에서 이게 1100장
        // 이라, 일반 임계로 두면 연결 클러스터의 이름을 통째로 덮는다.
        if (
          scene.isolatedIds.has(node.id) &&
          !hovered &&
          view.k < ISOLATED_LABEL_ZOOM
        ) {
          continue;
        }
        const task = tasksById.get(node.id);
        if (!task) continue;
        const screenX = node.x * view.k + view.x;
        // +10 은 펄스 고리(반지름 +7)까지 피해 앉히는 여백이다.
        const screenY = (node.y + node.radius) * view.k + view.y + 10;
        if (
          screenX < -80 ||
          screenX > width + 80 ||
          screenY < -20 ||
          screenY > height + 20
        ) {
          continue;
        }
        ctx.fillStyle = hovered || onCritical ? "#f1f5f9" : LABEL_COLOR;
        ctx.fillText(truncate(task.title, 20), screenX, screenY);
      }
      ctx.shadowBlur = 0;
    },
    [getCtx],
  );

  /**
   * 다시 그려 달라고 표시하고, 필요하면 RAF 루프를 되살린다.
   *
   * 루프는 할 일이 없으면 스스로 멈춘다(IDLE_FRAMES_BEFORE_STOP). 데스크톱
   * 앱이라 보드를 열어 둔 채 자리를 비우는 게 정상 사용인데, 정착한 그래프를
   * 60fps 로 계속 태우면 그동안 팬만 돈다.
   */
  const requestDraw = useCallback(() => {
    dirtyRef.current = true;
    idleFramesRef.current = 0;
    if (runningRef.current) return;

    const tick = (now: number) => {
      const sim = simRef.current;
      let needsDraw = dirtyRef.current;
      if (sim && !sim.settled()) {
        sim.step();
        needsDraw = true;
      }
      if (!needsDraw && hasPulseRef.current) {
        if (now - lastPulseRef.current >= PULSE_FRAME_MS) {
          lastPulseRef.current = now;
          needsDraw = true;
        }
      }
      if (needsDraw) {
        dirtyRef.current = false;
        idleFramesRef.current = 0;
        draw(now);
      } else {
        idleFramesRef.current += 1;
        if (idleFramesRef.current > IDLE_FRAMES_BEFORE_STOP) {
          runningRef.current = false;
          rafRef.current = null;
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    runningRef.current = true;
    rafRef.current = requestAnimationFrame(tick);
  }, [draw]);

  // ── 크기 추적 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      requestDraw();
    };
    apply();
    // jsdom 에는 ResizeObserver 가 없다 — 없으면 window resize 로 내려앉는다.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestDraw]);

  const fitToView = useCallback(() => {
    const sim = simRef.current;
    const { width, height } = sizeRef.current;
    if (!sim || sim.nodes.length === 0 || width === 0 || height === 0) return;
    const next = fitGraphToViewport(sim.bounds(), width, height, {
      padding: FIT_PADDING,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxFitZoom: MAX_FIT_ZOOM,
    });
    viewRef.current = next;
    setZoomLabel(next.k);
    requestDraw();
  }, [requestDraw]);

  // ── 시뮬 (재)생성 ──────────────────────────────────────────────────────
  useEffect(() => {
    const previous = simRef.current?.snapshot();
    const radii = new Map<string, number>();
    for (const node of layout.nodes) {
      radii.set(
        node.id,
        graphNodeRadius(
          node.task,
          dependents.get(node.id) ?? 0,
          !isolatedIds.has(node.id),
        ),
      );
    }
    // ★scope 겹침은 `showConflicts` 와 무관하게 **항상** 시뮬에 들어간다.
    // 토글은 그리기만 끄는 스위치다 — 토글 한 번에 배치가 통째로 재배열되면
    // 사용자는 켜고 끌 때마다 그래프를 새로 읽어야 한다.
    const sim = createTaskGraphSimulation(layout, {
      previous,
      radiusOf: (id) => radii.get(id) ?? 12,
      extraLinks: conflictLinks(conflicts),
    });
    // 첫 프레임 전에 미리 익힌다. 이어받는 경우엔 이미 자리를 잡고 있으므로
    // 살짝만 데워서 새 노드만 끼워 넣는다. 예열 틱 수는 노드 수에 반비례하는
    // 예산제 — 1000장 넘는 보드에서 이 동기 루프가 곧 프리즈 시간이다.
    const budget = recommendedWarmUpTicks(layout.nodes.length);
    warmUp(
      sim,
      previous && previous.size > 0 ? Math.min(RESEED_TICKS, budget) : budget,
    );
    simRef.current = sim;
    requestDraw();
  }, [layout, dependents, conflicts, isolatedIds, requestDraw]);

  // 노드 집합이 바뀐 첫 순간에만 화면을 맞춘다. 매 스냅샷마다 맞추면 사용자가
  // 잡아 둔 팬/줌이 계속 초기화된다(티켓은 몇 초마다 갱신된다).
  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature]);

  // 강조 토글·호버 같은 상태 변화도 다시 그려야 한다.
  useEffect(() => {
    requestDraw();
  }, [showCritical, showConflicts, hoveredId, requestDraw]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    },
    [],
  );

  // ── 포인터 ─────────────────────────────────────────────────────────────
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - view.x) / view.k,
      y: (clientY - rect.top - view.y) / view.k,
    };
  }, []);

  const nodeAt = useCallback(
    (clientX: number, clientY: number): ForceNode | null => {
      const sim = simRef.current;
      if (!sim) return null;
      const world = toWorld(clientX, clientY);
      return hitTest(sim.nodes, world.x, world.y, 5);
    },
    [toWorld],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const hit = nodeAt(event.clientX, event.clientY);
      dragRef.current = {
        mode: hit ? "node" : "pan",
        startX: event.clientX,
        startY: event.clientY,
        moved: 0,
        nodeId: hit?.id ?? null,
      };
      if (hit) hit.pinned = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [nodeAt],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const sim = simRef.current;

      if (drag.mode === "none") {
        const hit = nodeAt(event.clientX, event.clientY);
        const nextId = hit?.id ?? null;
        if (nextId !== hoveredId) setHoveredId(nextId);
        setTooltip(
          hit ? { x: event.clientX, y: event.clientY, id: hit.id } : null,
        );
        return;
      }

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.startX = event.clientX;
      drag.startY = event.clientY;

      if (drag.mode === "pan") {
        viewRef.current = {
          ...viewRef.current,
          x: viewRef.current.x + dx,
          y: viewRef.current.y + dy,
        };
        requestDraw();
        return;
      }

      if (drag.nodeId && sim) {
        const node = sim.byId.get(drag.nodeId);
        if (node) {
          const world = toWorld(event.clientX, event.clientY);
          node.x = world.x;
          node.y = world.y;
          node.vx = 0;
          node.vy = 0;
          // 끌린 노드를 따라 이웃이 다시 정렬되도록 살짝 데운다.
          sim.reheat(0.4);
          requestDraw();
        }
      }
    },
    [hoveredId, nodeAt, requestDraw, toWorld],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const sim = simRef.current;
      if (drag.mode === "node" && drag.nodeId && sim) {
        const node = sim.byId.get(drag.nodeId);
        // 놓으면 다시 힘에 맡긴다(옵시디언과 같은 감각 — 고정은 안 남는다).
        if (node) node.pinned = false;
      }
      const wasClick = drag.mode !== "none" && drag.moved <= CLICK_SLOP;
      const clickedId = drag.nodeId;
      dragRef.current = {
        mode: "none",
        startX: 0,
        startY: 0,
        moved: 0,
        nodeId: null,
      };
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (wasClick && clickedId) {
        const task = taskById.get(clickedId);
        if (task) onSelect(task);
      }
      requestDraw();
    },
    [onSelect, requestDraw, taskById],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const view = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
      // 커서 아래 월드 좌표가 제자리에 남도록 이동량을 보정한다.
      viewRef.current = {
        k,
        x: px - ((px - view.x) / view.k) * k,
        y: py - ((py - view.y) / view.k) * k,
      };
      setZoomLabel(k);
      requestDraw();
    },
    [requestDraw],
  );

  if (layout.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {t("board.graph.empty")}
      </div>
    );
  }

  const hoveredTask = tooltip ? taskById.get(tooltip.id) : undefined;
  const criticalAvailable = critical.length > 1;
  const conflictCount = conflicts.edges.length;
  const conflictAvailable = conflictCount > 0;
  const clusterCount = conflicts.clusters.length;

  return (
    <div className="flex h-full flex-col">
      {/* 요약 + 운영 토글. 순환은 조용히 넘기면 "왜 순서가 이상한가" 를
          사용자가 영영 모른다. */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-4 pt-3 text-xs text-gray-500">
        <span>
          {t("board.graph.summary", {
            nodes: layout.nodes.length,
            edges: layout.edges.length,
          })}
        </span>
        {layout.hasCycle && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-300">
            ⚠ {t("board.graph.cycle")}
          </span>
        )}

        <button
          type="button"
          onClick={() => setShowCritical((prev) => !prev)}
          aria-pressed={showCritical}
          disabled={!criticalAvailable}
          data-testid="task-graph-critical-toggle"
          title={
            criticalAvailable
              ? t("board.graph.criticalTip", { count: critical.weight })
              : t("board.graph.criticalNone")
          }
          className={`rounded border px-1.5 py-0.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            showCritical && criticalAvailable
              ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
              : "border-gray-700 text-gray-400 hover:text-gray-200"
          }`}
        >
          ⟶ {t("board.graph.critical")}
          {criticalAvailable ? ` · ${critical.weight}` : ""}
        </button>

        {/* ★충돌위험 토글. 기본이 켜짐인 건 이 뷰를 조율 도구로 쓰는 사람이
            제일 먼저 봐야 할 게 "지금 같이 던지면 깨지는 쌍" 이기 때문이다.
            간선 수가 많아 답답할 때 끌 수 있게만 열어 둔다(배치는 안 바뀐다). */}
        <button
          type="button"
          onClick={() => setShowConflicts((prev) => !prev)}
          aria-pressed={showConflicts}
          disabled={!conflictAvailable}
          data-testid="task-graph-conflict-toggle"
          title={
            conflictAvailable
              ? t("board.graph.conflictTip", {
                  count: conflictCount,
                  clusters: clusterCount,
                })
              : t("board.graph.conflictNone")
          }
          className={`rounded border px-1.5 py-0.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            showConflicts && conflictAvailable
              ? "border-orange-400/60 bg-orange-400/15 text-orange-200"
              : "border-gray-700 text-gray-400 hover:text-gray-200"
          }`}
        >
          ⇄ {t("board.graph.conflict")}
          {conflictAvailable ? ` · ${conflictCount}` : ""}
        </button>

        {conflicts.truncated && (
          <span
            data-testid="task-graph-conflict-truncated"
            className="rounded bg-orange-500/15 px-1.5 py-0.5 font-medium text-orange-300"
          >
            {t("board.graph.conflictTruncated", { count: MAX_CONFLICT_EDGES })}
          </span>
        )}

        <button
          type="button"
          onClick={fitToView}
          title={t("board.graph.fit")}
          className="rounded border border-gray-700 px-1.5 py-0.5 font-medium text-gray-400 transition-colors hover:text-gray-200"
        >
          ⤢ {Math.round(zoomLabel * 100)}%
        </button>

        <span className="ml-auto">{t("board.graph.hint")}</span>
      </div>

      {/* 범례 — 색이 무슨 뜻인지 모르면 화려한 점 잔치일 뿐이다. 준비/대기가
          맨 앞에 오는 건 그게 이 뷰에서 제일 쓸모 있는 구분이기 때문이다. */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 px-4 pt-2 text-[11px] text-gray-400">
        <LegendRing
          color={READINESS_RING.ready ?? EDGE_COLOR}
          label={t("board.graph.legend.ready", {
            count: readinessCounts.ready,
          })}
        />
        <LegendRing
          color={READINESS_RING.waiting ?? EDGE_COLOR}
          dashed
          label={t("board.graph.legend.waiting", {
            count: readinessCounts.waiting,
          })}
        />
        <LegendDot
          color={STATUS_HEX.IN_PROGRESS}
          label={t("board.graph.legend.active", {
            count: readinessCounts.active,
          })}
        />
        <LegendRing
          color={READINESS_RING.stuck ?? EDGE_COLOR}
          label={t("board.graph.legend.stuck", {
            count: readinessCounts.stuck,
          })}
        />
        <LegendDot
          color={STATUS_HEX.DONE}
          label={t("board.graph.legend.done", { count: readinessCounts.done })}
        />
        {criticalAvailable && showCritical && (
          <LegendDot
            color={CRITICAL_HEX}
            label={t("board.graph.legend.critical", { count: critical.weight })}
          />
        )}
        {conflictAvailable && showConflicts && (
          <LegendLine
            color={CONFLICT_HEX}
            label={t("board.graph.legend.conflict", { count: conflictCount })}
          />
        )}
        {stuck.downstreamIds.size > 0 && (
          <LegendRing
            color={STUCK_HEX}
            dashed
            label={t("board.graph.legend.blast", {
              count: stuck.downstreamIds.size,
            })}
          />
        )}
        {isolatedIds.size > 0 && (
          <LegendDot
            color={EDGE_COLOR}
            small
            label={t("board.graph.legend.isolated", {
              count: isolatedIds.size,
            })}
          />
        )}
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 p-1">
        <canvas
          ref={canvasRef}
          data-testid="task-graph-canvas"
          data-node-count={layout.nodes.length}
          data-edge-count={layout.edges.length}
          data-critical-length={critical.length}
          data-conflict-count={conflicts.edges.length}
          data-conflict-clusters={clusterCount}
          data-isolated-count={isolatedIds.size}
          data-blast-count={stuck.downstreamIds.size}
          className="absolute inset-0 h-full w-full touch-none select-none"
          style={{ cursor: hoveredId ? "pointer" : "grab" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            setHoveredId(null);
            setTooltip(null);
          }}
          onWheel={handleWheel}
        />

        {/* 호버 카드 — 캔버스에 글자를 더 그리는 대신 HTML 로 띄운다. 캔버스
            텍스트는 줄바꿈·말줄임을 직접 계산해야 하고 선택도 안 된다. */}
        {tooltip && hoveredTask && (
          <TaskGraphTooltip
            task={hoveredTask}
            readiness={readiness.get(tooltip.id) ?? "waiting"}
            onCritical={showCritical && critical.idSet.has(tooltip.id)}
            dependents={dependents.get(tooltip.id) ?? 0}
            conflictCount={conflicts.neighbors.get(tooltip.id)?.size ?? 0}
            conflictPaths={conflictPathsFor(conflicts.edges, tooltip.id)}
            onBlast={stuck.downstreamIds.has(tooltip.id)}
            isolated={isolatedIds.has(tooltip.id)}
            container={containerRef.current}
            clientX={tooltip.x}
            clientY={tooltip.y}
            t={t}
          />
        )}

        <GraphNodeList
          layout={layout}
          readiness={readiness}
          criticalIds={critical.idSet}
          conflictNeighbors={conflicts.neighbors}
          blastIds={stuck.downstreamIds}
          isolatedIds={isolatedIds}
          agentByKey={agentByKey}
          onSelect={onSelect}
          onFocusNode={setHoveredId}
          t={t}
        />
      </div>
    </div>
  );
}

interface GraphNodeListProps {
  layout: TaskGraphLayout;
  readiness: Map<string, TaskReadiness>;
  criticalIds: Set<string>;
  /** id → scope 가 겹치는 상대들. 캔버스의 주황 점선과 같은 정보다. */
  conflictNeighbors: Map<string, Set<string>>;
  blastIds: Set<string>;
  isolatedIds: Set<string>;
  agentByKey: Map<string, Agent>;
  onSelect: (task: Task) => void;
  onFocusNode: (id: string | null) => void;
  t: TFunction;
}

/**
 * ★접근성·테스트 계약. 캔버스는 스크린리더에 빈 사각형이고 키보드로 짚을 수도
 * 없어서, 노드마다 진짜 버튼을 하나씩 둔다. 포커스가 오면 캔버스 강조도 같이
 * 켜져서 키보드 사용자가 어느 노드인지 눈으로 확인할 수 있다.
 *
 * memo 로 감싼 이유: 호버 툴팁은 마우스가 움직일 때마다 부모를 다시 렌더하는데,
 * 그때마다 노드 수백 개짜리 목록까지 재조립되면 캔버스 60fps 를 DOM 이 깎아먹는다.
 */
const GraphNodeList = memo(function GraphNodeList({
  layout,
  readiness,
  criticalIds,
  conflictNeighbors,
  blastIds,
  isolatedIds,
  agentByKey,
  onSelect,
  onFocusNode,
  t,
}: GraphNodeListProps) {
  return (
    <ul
      className="sr-only"
      aria-label={t("board.graph.nodeListLabel", {
        count: layout.nodes.length,
      })}
    >
      {layout.nodes.map((node) => {
        const task = node.task;
        const status = STATUS_CONFIG[task.status];
        const value = readiness.get(node.id) ?? "waiting";
        const agent = task.claimedBy
          ? agentByKey.get(task.claimedBy)
          : undefined;
        const modelLabel = agent
          ? (spawnedModelLabel(agent.spawnedModel) ?? agent.model)
          : null;
        const conflictCount = conflictNeighbors.get(node.id)?.size ?? 0;
        return (
          <li key={node.id}>
            <button
              type="button"
              data-testid="task-graph-node"
              data-task-status={task.status}
              data-task-readiness={value}
              data-task-critical={criticalIds.has(node.id) ? "true" : "false"}
              data-task-conflicts={conflictCount}
              data-task-blast={blastIds.has(node.id) ? "true" : "false"}
              data-task-isolated={isolatedIds.has(node.id) ? "true" : "false"}
              onClick={() => onSelect(task)}
              onFocus={() => onFocusNode(node.id)}
              onBlur={() => onFocusNode(null)}
            >
              <span>{task.title}</span>
              <span>{status.label}</span>
              <span>{task.role}</span>
              <span>{t(READINESS_LABEL_KEY[value])}</span>
              {/* 충돌·여파는 캔버스에서 색으로만 말하므로, 스크린리더에는
                  글자로 한 번 더 말해 줘야 같은 정보를 얻는다. */}
              {conflictCount > 0 && (
                <span>
                  {t("board.graph.tooltip.conflicts", { count: conflictCount })}
                </span>
              )}
              {blastIds.has(node.id) && (
                <span>{t("board.graph.tooltip.blast")}</span>
              )}
              {modelLabel ? (
                <span>{modelLabel}</span>
              ) : (
                <span>{t("board.taskCard.unassigned")}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
});

function LegendDot({
  color,
  label,
  small,
}: {
  color: string;
  label: string;
  /** 독립 노드 범례용 — 화면의 그 점이 실제로 작고 흐리다는 걸 그대로 보인다. */
  small?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={small ? "h-1 w-1 rounded-full" : "h-2 w-2 rounded-full"}
        style={{
          background: color,
          boxShadow: small ? undefined : `0 0 6px ${color}`,
          opacity: small ? 0.6 : 1,
        }}
      />
      {label}
    </span>
  );
}

/** 간선 범례 — 점(노드)이 아니라 선(관계)을 설명하는 자리. */
function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="h-0 w-4"
        style={{ borderTop: `2px dashed ${color}` }}
      />
      {label}
    </span>
  );
}

function LegendRing({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-full"
        style={{ border: `1.5px ${dashed ? "dashed" : "solid"} ${color}` }}
      />
      {label}
    </span>
  );
}

/**
 * 이 티켓이 어떤 경로 때문에 남과 부딪히는지 — 툴팁 한 줄용.
 *
 * 개수만 보여 주면 "3건 겹침" 에서 손이 멈춘다. 정작 알아야 할 건 *어디서*
 * 겹치는지고, 그걸 알아야 scope 를 갈라 병렬로 되돌릴 수 있다.
 */
function conflictPathsFor(
  edges: readonly ScopeConflictEdge[],
  id: string,
): string[] {
  const out: string[] = [];
  for (const edge of edges) {
    if (edge.a !== id && edge.b !== id) continue;
    for (const path of edge.paths) {
      if (!out.includes(path)) out.push(path);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

interface TooltipProps {
  task: Task;
  readiness: TaskReadiness;
  onCritical: boolean;
  dependents: number;
  conflictCount: number;
  conflictPaths: string[];
  onBlast: boolean;
  isolated: boolean;
  container: HTMLDivElement | null;
  clientX: number;
  clientY: number;
  t: TFunction;
}

function TaskGraphTooltip({
  task,
  readiness,
  onCritical,
  dependents,
  conflictCount,
  conflictPaths,
  onBlast,
  isolated,
  container,
  clientX,
  clientY,
  t,
}: TooltipProps) {
  const rect = container?.getBoundingClientRect();
  const left = rect ? clientX - rect.left + 14 : 0;
  const top = rect ? clientY - rect.top + 14 : 0;
  const status = STATUS_CONFIG[task.status];
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-[240px] rounded-lg border border-gray-700 bg-gray-900/95 p-2 text-[11px] shadow-xl"
      style={{
        left,
        top,
        // 오른쪽 끝에서 잘리지 않도록 커서 왼편으로 되접는다.
        transform:
          rect && left > rect.width - 250
            ? "translateX(calc(-100% - 28px))"
            : undefined,
      }}
    >
      <div className="mb-1 line-clamp-2 font-medium text-gray-100">
        {task.title}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-gray-400">
        <span className={status.color}>{status.label}</span>
        <span>
          {ROLE_ICONS[task.role] ?? "📋"} {task.role}
        </span>
        <span>P{task.priority}</span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5 text-gray-400">
        <span>{t(READINESS_LABEL_KEY[readiness])}</span>
        {dependents > 0 && (
          <span>{t("board.graph.tooltip.blocks", { count: dependents })}</span>
        )}
        {onCritical && (
          <span className="text-cyan-300">⟶ {t("board.graph.critical")}</span>
        )}
        {onBlast && (
          <span className="text-red-400">{t("board.graph.tooltip.blast")}</span>
        )}
        {conflictCount > 0 && (
          <span className="text-orange-300">
            ⇄ {t("board.graph.tooltip.conflicts", { count: conflictCount })}
          </span>
        )}
        {conflictPaths.length > 0 && (
          <span className="break-all text-orange-200/80">
            {t("board.graph.tooltip.conflictPaths", {
              paths: conflictPaths.join(", "),
            })}
          </span>
        )}
        {isolated && <span>{t("board.graph.tooltip.isolated")}</span>}
      </div>
    </div>
  );
}

/**
 * 간선 하나 — 살짝 휜 2차 베지어 + 화살촉.
 *
 * 직선을 쓰면 A→B 와 B→A 가 완전히 겹쳐 한 줄로 보이고(순환을 못 읽는다),
 * 노드가 촘촘할 때 어느 선이 어디에 붙었는지도 안 보인다. 약한 곡률 하나로 둘
 * 다 해결된다.
 */
function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: ForceNode,
  to: ForceNode,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  // 제어점을 진행 방향의 왼쪽으로 밀어 곡선을 만든다.
  const curve = Math.min(28, len * 0.12);
  const cx = (from.x + to.x) / 2 + (-dy / len) * curve;
  const cy = (from.y + to.y) / 2 + (dx / len) * curve;

  // 노드 반지름만큼 양끝을 잘라 원 안으로 선이 파고들지 않게 한다.
  const startAngle = Math.atan2(cy - from.y, cx - from.x);
  const endAngle = Math.atan2(to.y - cy, to.x - cx);
  const sx = from.x + Math.cos(startAngle) * (from.radius + 2);
  const sy = from.y + Math.sin(startAngle) * (from.radius + 2);
  const headGap = to.radius + 9;
  const ex = to.x - Math.cos(endAngle) * headGap;
  const ey = to.y - Math.sin(endAngle) * headGap;

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(cx, cy, ex, ey);
  ctx.stroke();

  // 화살촉 — 방향이 없으면 "무엇이 무엇을 막는가" 를 못 읽는다.
  const head = 7;
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(endAngle) * head, ey + Math.sin(endAngle) * head);
  ctx.lineTo(
    ex + Math.cos(endAngle + 2.5) * head,
    ey + Math.sin(endAngle + 2.5) * head,
  );
  ctx.lineTo(
    ex + Math.cos(endAngle - 2.5) * head,
    ey + Math.sin(endAngle - 2.5) * head,
  );
  ctx.closePath();
  ctx.fill();
}

/**
 * 무향 관계선(scope 겹침) — 화살촉 없는 곡선.
 *
 * `drawEdge` 와 갈라 둔 이유가 정확히 화살촉이다. 충돌은 "A 다음에 B" 가 아니라
 * "A 와 B 를 동시에 하지 마라" 라서 방향이 없고, 화살표를 붙이면 사용자가 이걸
 * 의존으로 읽는다. 곡률 부호도 의존과 반대로 준다 — 같은 두 티켓이 의존이면서
 * 충돌이기도 하면 두 선이 겹쳐 한 줄로 보인다.
 */
function drawPlainLink(
  ctx: CanvasRenderingContext2D,
  from: ForceNode,
  to: ForceNode,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const curve = Math.min(28, len * 0.12);
  const cx = (from.x + to.x) / 2 + (dy / len) * curve;
  const cy = (from.y + to.y) / 2 + (-dx / len) * curve;

  const startAngle = Math.atan2(cy - from.y, cx - from.x);
  const endAngle = Math.atan2(cy - to.y, cx - to.x);
  ctx.beginPath();
  ctx.moveTo(
    from.x + Math.cos(startAngle) * (from.radius + 2),
    from.y + Math.sin(startAngle) * (from.radius + 2),
  );
  ctx.quadraticCurveTo(
    cx,
    cy,
    to.x + Math.cos(endAngle) * (to.radius + 2),
    to.y + Math.sin(endAngle) * (to.radius + 2),
  );
  ctx.stroke();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default TaskGraphView;
