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
import { useTranslation } from "../../lib/i18n";
import {
  buildDocGraph,
  docNodeRadius,
  layoutDocGraph,
  type DocGraph,
  type DocGraphNode,
  type DocSource,
  DOC_ORPHAN_ALPHA,
} from "../../lib/docGraphAnalysis";
import {
  createTaskGraphSimulation,
  fitGraphToViewport,
  hitTest,
  recommendedWarmUpTicks,
  warmUp,
  type ForceNode,
  type TaskGraphSimulation,
} from "../../lib/taskGraphForce";

/**
 * 프로젝트 md 문서 관계 그래프 뷰 — 옵시디언식.
 *
 * ★포스·히트테스트·화면맞춤은 `taskGraphForce` 를 **그대로** 재사용한다.
 * 태스크 전용 운영 레이어(크리티컬 패스·scope 충돌)는 빼고, 문서 관계에 맞는
 * 백링크 강조·고아 디엠퍼사이즈·special(index/log) 색만 얹는다.
 */

interface DocGraphViewProps {
  sources: readonly DocSource[];
  /** 노드 클릭 시 문서 경로(원본 path). */
  onOpenDoc: (path: string) => void;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;
const FIT_PADDING = 40;
const MAX_FIT_ZOOM = 1.2;
const RESEED_TICKS = 30;
const LABEL_ZOOM = 0.55;
const ISOLATED_LABEL_ZOOM = 1.05;
const IDLE_FRAMES_BEFORE_STOP = 40;
const CLICK_SLOP = 4;

const EDGE_COLOR = "#4b5563";
const BACKLINK_EDGE = "#38bdf8"; // sky-400 — 백링크 강조
const LABEL_COLOR = "#cbd5e1";
const DIM_ALPHA = 0.09;

const NODE_FILL = {
  default: "#64748b", // slate-500
  index: "#22d3ee", // cyan-400 — 목록 허브
  log: "#fbbf24", // amber-400 — 타임라인 허브
  orphan: "#475569", // slate-600
} as const;

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

interface Scene {
  graph: DocGraph;
  nodeById: Map<string, DocGraphNode>;
  isolatedIds: Set<string>;
  focusIds: Set<string> | null;
  /** 호버 노드로 들어오는 간선(백링크) 강조용. */
  backlinkEdgeKeys: Set<string> | null;
  hoveredId: string | null;
}

export function DocGraphView({ sources, onOpenDoc }: DocGraphViewProps) {
  const { t } = useTranslation();

  const graph = useMemo(() => buildDocGraph(sources), [sources]);
  const layout = useMemo(() => layoutDocGraph(graph), [graph]);
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );
  const isolatedIds = graph.orphanIds;

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      const set = map.get(a);
      if (set) set.add(b);
      else map.set(a, new Set([b]));
    };
    for (const edge of graph.edges) {
      add(edge.from, edge.to);
      add(edge.to, edge.from);
    }
    return map;
  }, [graph]);

  const graphSignature = useMemo(
    () =>
      graph.nodes
        .map((n) => n.id)
        .sort()
        .join("|"),
    [graph],
  );

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
  const sceneRef = useRef<Scene | null>(null);
  const dragRef = useRef<{
    mode: "none" | "pan" | "node";
    startX: number;
    startY: number;
    moved: number;
    nodeId: string | null;
  }>({ mode: "none", startX: 0, startY: 0, moved: 0, nodeId: null });

  const focusIds = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    for (const id of neighbors.get(hoveredId) ?? []) set.add(id);
    return set;
  }, [hoveredId, neighbors]);

  const backlinkEdgeKeys = useMemo(() => {
    if (!hoveredId) return null;
    const keys = new Set<string>();
    for (const e of graph.edges) {
      if (e.to === hoveredId) keys.add(e.id);
    }
    return keys;
  }, [hoveredId, graph.edges]);

  sceneRef.current = {
    graph,
    nodeById,
    isolatedIds,
    focusIds,
    backlinkEdgeKeys,
    hoveredId,
  };

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

  const draw = useCallback(
    (_now: number) => {
      const sim = simRef.current;
      const scene = sceneRef.current;
      const ctx = getCtx();
      if (!sim || !scene || !ctx) return;

      const { width, height, dpr } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const view = viewRef.current;
      const { focusIds: focus, backlinkEdgeKeys: blEdges } = scene;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);
      ctx.lineCap = "round";

      for (const edge of scene.graph.edges) {
        const from = sim.byId.get(edge.from);
        const to = sim.byId.get(edge.to);
        if (!from || !to) continue;

        const isBacklink = blEdges?.has(edge.id) ?? false;
        const inFocus =
          !focus || (focus.has(edge.from) && focus.has(edge.to));
        ctx.globalAlpha = inFocus ? 1 : DIM_ALPHA;
        ctx.strokeStyle = isBacklink ? BACKLINK_EDGE : EDGE_COLOR;
        ctx.fillStyle = isBacklink ? BACKLINK_EDGE : EDGE_COLOR;
        ctx.lineWidth = isBacklink ? 2.4 : focus && inFocus ? 2 : 1.3;
        ctx.shadowBlur = isBacklink ? 12 : 0;
        ctx.shadowColor = BACKLINK_EDGE;
        drawEdge(ctx, from, to);
        ctx.shadowBlur = 0;
      }

      for (const node of sim.nodes) {
        const doc = scene.nodeById.get(node.id);
        if (!doc) continue;
        const inFocus = !focus || focus.has(node.id);
        const isolated = scene.isolatedIds.has(node.id);
        const baseAlpha = inFocus
          ? isolated
            ? DOC_ORPHAN_ALPHA
            : 1
          : DIM_ALPHA;
        ctx.globalAlpha = baseAlpha;

        const fill = nodeFill(doc, isolated);
        const hovered = scene.hoveredId === node.id;
        const radius = node.radius;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.shadowBlur = hovered ? 26 : inFocus ? 14 : 0;
        ctx.shadowColor = fill;
        ctx.fill();
        ctx.shadowBlur = 0;

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

        // 백링크가 있는 노드 — 호버 시 링
        if (hovered && (scene.graph.backlinks.get(node.id)?.length ?? 0) > 0) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = BACKLINK_EDGE;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (hovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 10, 0, Math.PI * 2);
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.restore();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.font =
        "500 11px ui-sans-serif, -apple-system, 'Apple SD Gothic Neo', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(3,7,18,0.95)";
      ctx.shadowBlur = 4;
      for (const node of sim.nodes) {
        const inFocus = !focus || focus.has(node.id);
        if (!inFocus) continue;
        const hovered = scene.hoveredId === node.id;
        if (view.k < LABEL_ZOOM && !hovered) continue;
        if (
          scene.isolatedIds.has(node.id) &&
          !hovered &&
          view.k < ISOLATED_LABEL_ZOOM
        ) {
          continue;
        }
        const doc = scene.nodeById.get(node.id);
        if (!doc) continue;
        const screenX = node.x * view.k + view.x;
        const screenY = (node.y + node.radius) * view.k + view.y + 10;
        if (
          screenX < -80 ||
          screenX > width + 80 ||
          screenY < -20 ||
          screenY > height + 20
        ) {
          continue;
        }
        ctx.fillStyle = hovered ? "#f1f5f9" : LABEL_COLOR;
        ctx.fillText(truncate(doc.title, 18), screenX, screenY);
      }
      ctx.shadowBlur = 0;
    },
    [getCtx],
  );

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

  useEffect(() => {
    const previous = simRef.current?.snapshot();
    const radii = new Map<string, number>();
    for (const n of graph.nodes) {
      radii.set(n.id, docNodeRadius(n, !isolatedIds.has(n.id)));
    }
    const sim = createTaskGraphSimulation(layout, {
      previous,
      radiusOf: (id) => radii.get(id) ?? 12,
    });
    const budget = recommendedWarmUpTicks(layout.nodes.length);
    warmUp(
      sim,
      previous && previous.size > 0 ? Math.min(RESEED_TICKS, budget) : budget,
    );
    simRef.current = sim;
    requestDraw();
  }, [layout, graph.nodes, isolatedIds, requestDraw]);

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature]);

  useEffect(() => {
    requestDraw();
  }, [hoveredId, requestDraw]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    },
    [],
  );

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
        const doc = nodeById.get(clickedId);
        if (doc) onOpenDoc(doc.path);
      }
      requestDraw();
    },
    [onOpenDoc, requestDraw, nodeById],
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

  if (graph.nodes.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-xs text-gray-500"
        data-testid="doc-graph-empty"
      >
        <span>{t("code.docGraph.empty")}</span>
        <span className="text-[11px] text-gray-600">
          {t("code.docGraph.emptyHint")}
        </span>
      </div>
    );
  }

  const hoveredDoc = tooltip ? nodeById.get(tooltip.id) : undefined;
  const backlinkCount = hoveredDoc
    ? (graph.backlinks.get(hoveredDoc.id)?.length ?? 0)
    : 0;

  return (
    <div className="flex h-full flex-col" data-testid="doc-graph-view">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-700/80 px-2 py-1.5 text-[10px] text-gray-500">
        <span>
          {t("code.docGraph.summary", {
            nodes: graph.nodes.length,
            edges: graph.edges.length,
          })}
        </span>
        {isolatedIds.size > 0 && (
          <span className="text-gray-600">
            {t("code.docGraph.orphans", { count: isolatedIds.size })}
          </span>
        )}
        <button
          type="button"
          onClick={fitToView}
          title={t("code.docGraph.fit")}
          className="ml-auto rounded border border-gray-700 px-1.5 py-0.5 font-medium text-gray-400 transition-colors hover:text-gray-200"
        >
          ⤢ {Math.round(zoomLabel * 100)}%
        </button>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-2 py-1 text-[10px] text-gray-500">
        <LegendDot color={NODE_FILL.default} label={t("code.docGraph.legend.doc")} />
        <LegendDot color={NODE_FILL.index} label={t("code.docGraph.legend.index")} />
        <LegendDot color={NODE_FILL.log} label={t("code.docGraph.legend.log")} />
        <LegendDot
          color={NODE_FILL.orphan}
          small
          label={t("code.docGraph.legend.orphan")}
        />
        <LegendLine
          color={BACKLINK_EDGE}
          label={t("code.docGraph.legend.backlink")}
        />
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          data-testid="doc-graph-canvas"
          data-node-count={graph.nodes.length}
          data-edge-count={graph.edges.length}
          data-orphan-count={isolatedIds.size}
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

        {tooltip && hoveredDoc && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-[200px] rounded-lg border border-gray-700 bg-gray-900/95 p-2 text-[11px] shadow-xl"
            style={{
              left: (() => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return 0;
                const left = tooltip.x - rect.left + 12;
                return rect && left > rect.width - 180
                  ? left - 200
                  : left;
              })(),
              top: (() => {
                const rect = containerRef.current?.getBoundingClientRect();
                return rect ? tooltip.y - rect.top + 12 : 0;
              })(),
            }}
          >
            <div className="mb-0.5 line-clamp-2 font-medium text-gray-100">
              {hoveredDoc.title}
            </div>
            <div className="truncate text-gray-500">{hoveredDoc.path}</div>
            <div className="mt-1 text-gray-400">
              {t("code.docGraph.tooltip.links", {
                out: hoveredDoc.outDegree,
                back: backlinkCount,
              })}
            </div>
            {hoveredDoc.special === "index" && (
              <div className="text-cyan-300">{t("code.docGraph.tooltip.index")}</div>
            )}
            {hoveredDoc.special === "log" && (
              <div className="text-amber-300">{t("code.docGraph.tooltip.log")}</div>
            )}
            {isolatedIds.has(hoveredDoc.id) && (
              <div className="text-gray-500">
                {t("code.docGraph.tooltip.orphan")}
              </div>
            )}
          </div>
        )}

        <DocNodeList
          nodes={graph.nodes}
          orphanIds={isolatedIds}
          backlinks={graph.backlinks}
          onOpenDoc={onOpenDoc}
          onFocusNode={setHoveredId}
        />
      </div>
    </div>
  );
}

function nodeFill(doc: DocGraphNode, isolated: boolean): string {
  if (isolated) return NODE_FILL.orphan;
  if (doc.special === "index") return NODE_FILL.index;
  if (doc.special === "log") return NODE_FILL.log;
  return NODE_FILL.default;
}

function LegendDot({
  color,
  label,
  small,
}: {
  color: string;
  label: string;
  small?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={small ? "h-1 w-1 rounded-full" : "h-2 w-2 rounded-full"}
        style={{
          background: color,
          opacity: small ? 0.6 : 1,
        }}
      />
      {label}
    </span>
  );
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="h-0 w-3"
        style={{ borderTop: `2px solid ${color}` }}
      />
      {label}
    </span>
  );
}

const DocNodeList = memo(function DocNodeList({
  nodes,
  orphanIds,
  backlinks,
  onOpenDoc,
  onFocusNode,
}: {
  nodes: readonly DocGraphNode[];
  orphanIds: Set<string>;
  backlinks: Map<string, string[]>;
  onOpenDoc: (path: string) => void;
  onFocusNode: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul
      className="sr-only"
      aria-label={t("code.docGraph.nodeListLabel", { count: nodes.length })}
    >
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            data-testid="doc-graph-node"
            data-doc-path={node.path}
            data-doc-orphan={orphanIds.has(node.id) ? "true" : "false"}
            data-doc-special={node.special ?? ""}
            data-doc-backlinks={backlinks.get(node.id)?.length ?? 0}
            onClick={() => onOpenDoc(node.path)}
            onFocus={() => onFocusNode(node.id)}
            onBlur={() => onFocusNode(null)}
          >
            <span>{node.title}</span>
            <span>{node.path}</span>
            <span>
              {t("code.docGraph.tooltip.links", {
                out: node.outDegree,
                back: backlinks.get(node.id)?.length ?? 0,
              })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});

function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: ForceNode,
  to: ForceNode,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const curve = Math.min(28, len * 0.12);
  const cx = (from.x + to.x) / 2 + (-dy / len) * curve;
  const cy = (from.y + to.y) / 2 + (dx / len) * curve;

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

  const head = 6;
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default DocGraphView;
