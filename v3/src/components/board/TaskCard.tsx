import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../../types/task";
import { getPresenceStatus, type PresenceStatus } from "../../types/user";
import { useAgentStore } from "../../stores/agentStore";
import { usePresence } from "../../hooks/usePresence";
import { unclaimTask } from "../../services/taskService";
import FlowKanbanLink from "../flows/FlowKanbanLink";

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: "bg-green-400",
  idle: "bg-yellow-400",
  offline: "bg-gray-500",
};

const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "온라인",
  idle: "유휴",
  offline: "오프라인",
};

/**
 * Returns true for `durationMs` after `key` changes (skipping the first
 * render so cards don't all pulse on initial mount). Each TaskCard owns its
 * own hook instance, so 5 cards changing in the same Firestore snapshot get
 * 5 independent timers — exactly what the cmux-style "pane changed" cue
 * needs.
 *
 * The pulse visual itself is a CSS-only `opacity` animation
 * (`mb-card-pulse-overlay` in index.css) which keeps the work on the
 * compositor. `prefers-reduced-motion` users get a static ring for the
 * same window with no motion.
 */
function usePulseOnChange(key: number | string, durationMs = 1400): boolean {
  const [pulsing, setPulsing] = useState(false);
  const firstRender = useRef(true);
  const prevKey = useRef(key);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      prevKey.current = key;
      return;
    }
    if (prevKey.current === key) return;
    prevKey.current = key;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), durationMs);
    return () => clearTimeout(t);
  }, [key, durationMs]);

  return pulsing;
}

const ROLE_COLORS: Record<string, string> = {
  backend: "bg-orange-500/20 text-orange-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  test: "bg-pink-500/20 text-pink-400",
  devops: "bg-emerald-500/20 text-emerald-400",
};

const ROLE_ICONS: Record<string, string> = {
  backend: "⚙️",
  frontend: "🎨",
  test: "🧪",
  devops: "🚀",
};

const PRIORITY_CONFIG: Record<number, { label: string; color: string }> = {
  5: { label: "P5", color: "bg-red-500/20 text-red-400" },
  4: { label: "P4", color: "bg-orange-500/20 text-orange-400" },
  3: { label: "P3", color: "bg-yellow-500/20 text-yellow-400" },
  2: { label: "P2", color: "bg-blue-500/20 text-blue-400" },
  1: { label: "P1", color: "bg-gray-500/20 text-gray-400" },
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
  onFlowNavigate?: (flowId: string, nodeId: string) => void;
}

export function TaskCard({ task, onClick, onFlowNavigate }: TaskCardProps) {
  return (
    <TaskCardContent
      task={task}
      onClick={onClick}
      onFlowNavigate={onFlowNavigate}
    />
  );
}

interface DraggableTaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
  onFlowNavigate?: (flowId: string, nodeId: string) => void;
}

export function DraggableTaskCard({
  task,
  onClick,
  onFlowNavigate,
}: DraggableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task-${task.id}`,
      data: { task },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <TaskCardContent
        task={task}
        onClick={onClick}
        onFlowNavigate={onFlowNavigate}
        isDragging={isDragging}
      />
    </div>
  );
}

function TaskCardContent({
  task,
  onClick,
  onFlowNavigate,
  isDragging,
}: TaskCardProps & { isDragging?: boolean }) {
  const priority = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG[1];
  const roleColor = ROLE_COLORS[task.role] ?? "bg-gray-500/20 text-gray-400";
  const roleIcon = ROLE_ICONS[task.role] ?? "📋";

  const isBlocked = task.status === "BLOCKED";
  const isFailed = task.status === "FAILED";
  const statusHighlight = isBlocked
    ? "border-l-2 border-l-orange-500"
    : isFailed
      ? "border-l-2 border-l-red-500"
      : "";

  // Pulse the card whenever Firestore reports a change (status, claimedBy,
  // hasPmFeedback, prUrl, etc — they all bump updatedAt). Each card owns its
  // own pulse timer so simultaneous changes pulse independently.
  const updatedKey =
    task.updatedAt instanceof Date ? task.updatedAt.getTime() : 0;
  const pulsing = usePulseOnChange(updatedKey);

  // Resolve the claimant agent → owner userId so we can show whose machine
  // is currently hosting the agent and whether that teammate is online.
  // When `claimedBy` is unset, all hooks short-circuit (usePresence handles
  // undefined as "no subscription").
  const agents = useAgentStore((s) => s.agents);
  // claimedBy 는 두 경로로 저장됨: 수동 UI 할당은 agent.name, MCP claim_task 는
  // agent.id. 매칭은 양쪽을 모두 받아야 한다 (TaskDetailModal 의 AgentAssign 과
  // 동일). 한쪽만 보면 다른 경로로 들어온 케이스에서 ownerId 가 잡히지 않아
  // presence 가 무조건 offline 으로 떨어진다.
  const claimingAgent = task.claimedBy
    ? agents.find((a) => a.name === task.claimedBy || a.id === task.claimedBy)
    : undefined;
  const ownerId = claimingAgent?.ownerId;
  const lastHeartbeatAt = usePresence(ownerId);
  // Presence 1차 판정은 에이전트 프로세스의 직접 시그널(agent.status)을 본다.
  // - working/idle 이면 inject_message 가 즉시 잡힐 거라 online
  // - stopped/error 면 오프라인 배너로 회수 권유
  // - 에이전트 doc 매칭 실패(레거시·미지 status)일 때만 owner 사용자의 in-app
  //   heartbeat 으로 폴백 → 팀 협업 시 "owner 가 마블로 앱을 닫아둠" 시나리오
  //   도 그대로 잡힌다.
  let presence: PresenceStatus | null = null;
  if (task.claimedBy) {
    const status = claimingAgent?.status;
    if (status === "working" || status === "idle") {
      presence = "online";
    } else if (status === "stopped" || status === "error") {
      presence = "offline";
    } else {
      presence = getPresenceStatus(lastHeartbeatAt);
    }
  }

  return (
    <div
      className={`relative cursor-pointer rounded-lg bg-gray-800 p-3 shadow hover:bg-gray-750 transition-colors border border-gray-700/50 hover:border-gray-600 ${statusHighlight} ${
        isDragging ? "ring-2 ring-blue-500" : ""
      }`}
      onClick={() => onClick(task)}
    >
      {pulsing && <span aria-hidden="true" className="mb-card-pulse-overlay" />}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium text-gray-200 line-clamp-2 flex-1">
          {task.title}
        </h4>
        {task.dependsOn.length > 0 && (
          <span
            className="text-gray-500 flex-shrink-0"
            title={`${task.dependsOn.length} dependencies`}
          >
            🔗
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${roleColor}`}
        >
          {roleIcon} {task.role}
        </span>
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${priority.color}`}
        >
          {priority.label}
        </span>
        {isBlocked && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-orange-500/20 text-orange-400">
            BLOCKED
          </span>
        )}
        {isFailed && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-red-500/20 text-red-400">
            FAILED
          </span>
        )}
        {task.hasPmFeedback && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400">
            💬 FB
          </span>
        )}
        {task.prUrl && (
          <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-green-500/20 text-green-400">
            PR
          </span>
        )}
        {task.flowId && (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-400">
            ⚡ Flow
          </span>
        )}
      </div>

      {task.flowId && task.flowNodeId && (
        <div className="mt-2">
          <FlowKanbanLink
            flowId={task.flowId}
            flowNodeId={task.flowNodeId}
            onNavigate={onFlowNavigate}
          />
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          {task.claimedBy && presence ? (
            <span
              aria-label={`담당자 ${PRESENCE_LABEL[presence]}`}
              title={`담당자 ${PRESENCE_LABEL[presence]}`}
              className={`inline-block h-2 w-2 rounded-full ${PRESENCE_DOT[presence]}`}
            />
          ) : null}
          <span>
            {task.claimedBy
              ? `👤 ${claimingAgent?.name || task.claimedBy}`
              : "Unclaimed"}
          </span>
        </span>
        <span>{timeAgo(task.createdAt)}</span>
      </div>

      {/* DONE 상태 카드는 추가 지시 보낼 일이 없으므로 오프라인 배지/회수 버튼 숨김.
          FAILED 는 retry 가능성 (PM 이 추가 지시 → TODO 환원) 이 있어 그대로 표시. */}
      {task.claimedBy && presence === "offline" && task.status !== "DONE" && (
        <div className="mt-1.5 flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          <span aria-hidden="true">⏸</span>
          <span className="flex-1">
            담당자 오프라인 — 새 지시는 큐에 적재되어 복귀 시 전달됩니다
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              unclaimTask(task.id).catch((err) => {
                console.error("[TaskCard] unclaim failed:", err);
              });
            }}
            className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200 hover:bg-amber-500/30"
            title="claim 회수하고 TODO로 돌리기"
          >
            회수
          </button>
        </div>
      )}
    </div>
  );
}
