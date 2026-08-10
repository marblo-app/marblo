import { useMemo } from "react";
import type { Task } from "../../types/task";
import { useAgentStore } from "../../stores/agentStore";
import { spawnedModelLabel } from "../../lib/spawnedModelLabel";
import { useTranslation } from "../../lib/i18n";
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutTaskGraph,
  type TaskGraphEdge,
} from "../../lib/taskGraphLayout";
import { MODEL_ICONS, ROLE_COLORS, ROLE_ICONS } from "./TaskCard";
import { STATUS_CONFIG } from "./KanbanColumn";

/**
 * 보드의 **그래프 뷰** — 같은 티켓들을 컬럼이 아니라 의존 관계(dependsOn)로
 * 그린다.
 *
 * 칸반은 "지금 어느 단계인가" 를 답하지만 "무엇이 무엇을 막고 있나" 는 못
 * 답한다. 카드의 🔗 배지는 의존이 있다는 사실만 알려줄 뿐 누구를 기다리는지는
 * 카드를 열어야 안다. 그래프는 그 한 질문만 전담한다: 왼쪽이 먼저, 화살표가
 * 가리키는 쪽이 나중.
 *
 * ★상세는 여기서 그리지 않는다. 노드 클릭은 `onSelect` 로 올려 보드가 이미
 * 쓰는 TaskDetailModal 을 그대로 연다 — 뷰마다 다른 상세 화면이 생기면 어느
 * 쪽이 정본인지 갈린다.
 */
interface TaskGraphViewProps {
  tasks: Task[];
  onSelect: (task: Task) => void;
}

/**
 * 직선 대신 완만한 3차 베지어. 노드가 세로로 어긋나 있을 때 직선은 노드 상자를
 * 가로질러 어느 노드에 붙은 선인지 읽기 어렵다.
 */
function edgePath(edge: TaskGraphEdge): string {
  const dx = Math.max(32, (edge.toX - edge.fromX) / 2);
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX + dx} ${edge.fromY}, ${
    edge.toX - dx
  } ${edge.toY}, ${edge.toX} ${edge.toY}`;
}

export function TaskGraphView({ tasks, onSelect }: TaskGraphViewProps) {
  const { t } = useTranslation();
  const agents = useAgentStore((s) => s.agents);

  const layout = useMemo(() => layoutTaskGraph(tasks), [tasks]);

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

  if (layout.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {t("board.graph.empty")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 범례 — 노드/엣지 수와 순환 경고. 순환은 조용히 넘기면 "왜 순서가
          이상한가" 를 사용자가 영영 모른다. */}
      <div className="flex flex-shrink-0 items-center gap-3 px-4 pt-3 text-xs text-gray-500">
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
        <span className="ml-auto">{t("board.graph.hint")}</span>
      </div>

      {/* MVP 는 팬/줌 없이 스크롤만 — 캔버스 크기는 레이아웃이 계산한다. */}
      <div className="flex-1 overflow-auto p-1">
        <div
          className="relative"
          style={{
            width: layout.width,
            height: layout.height,
            minWidth: "100%",
          }}
        >
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={layout.width}
            height={layout.height}
            aria-hidden
          >
            <defs>
              <marker
                id="task-graph-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
              </marker>
              <marker
                id="task-graph-arrow-cycle"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
              </marker>
            </defs>
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edgePath(edge)}
                fill="none"
                stroke={edge.cycle ? "#f59e0b" : "#4b5563"}
                strokeWidth={1.5}
                strokeDasharray={edge.cycle ? "5 4" : undefined}
                markerEnd={
                  edge.cycle
                    ? "url(#task-graph-arrow-cycle)"
                    : "url(#task-graph-arrow)"
                }
              />
            ))}
          </svg>

          {layout.nodes.map((node) => {
            const task = node.task;
            const status = STATUS_CONFIG[task.status];
            const roleColor =
              ROLE_COLORS[task.role] ?? "bg-gray-500/20 text-gray-400";
            const roleIcon = ROLE_ICONS[task.role] ?? "📋";
            const agent = task.claimedBy
              ? agentByKey.get(task.claimedBy)
              : undefined;
            const modelLabel = agent
              ? (spawnedModelLabel(agent.spawnedModel) ?? agent.model)
              : null;

            return (
              <button
                key={node.id}
                type="button"
                data-testid="task-graph-node"
                data-task-status={task.status}
                onClick={() => onSelect(task)}
                title={task.title}
                className="absolute flex flex-col items-start gap-1.5 overflow-hidden rounded-lg border border-gray-700/50 bg-gray-800 p-2.5 text-left shadow transition-colors hover:border-gray-500 hover:bg-gray-750"
                style={{
                  left: node.x,
                  top: node.y,
                  width: GRAPH_NODE_WIDTH,
                  height: GRAPH_NODE_HEIGHT,
                }}
              >
                <div className="flex w-full items-start gap-1.5">
                  <span
                    aria-hidden
                    className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${status.bg}`}
                  />
                  <span className="line-clamp-2 flex-1 text-xs font-medium leading-4 text-gray-200">
                    {task.title}
                  </span>
                </div>
                <div className="flex w-full items-center gap-1 overflow-hidden">
                  <span
                    className={`inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${roleColor}`}
                  >
                    {roleIcon} {task.role}
                  </span>
                  <span
                    className={`flex-shrink-0 text-[10px] font-medium ${status.color}`}
                  >
                    {status.label}
                  </span>
                  {modelLabel ? (
                    <span
                      className="ml-auto inline-flex min-w-0 items-center gap-0.5 rounded bg-gray-500/20 px-1 py-0.5 text-[10px] text-gray-300"
                      title={agent?.name ?? undefined}
                    >
                      <span aria-hidden>
                        {MODEL_ICONS[agent?.model ?? ""] ?? "⚪"}
                      </span>
                      <span className="truncate font-mono">{modelLabel}</span>
                    </span>
                  ) : (
                    <span className="ml-auto flex-shrink-0 text-[10px] text-gray-600">
                      {t("board.taskCard.unassigned")}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TaskGraphView;
