import { useState } from "react";
import { Agent, AgentStatus, ModelType } from "../../types";
import { Task } from "../../types";

interface MemberCardProps {
  agent: Agent;
  tasks: Task[];
}

const statusConfig: Record<
  AgentStatus,
  { label: string; dot: string; bg: string; text: string }
> = {
  working: {
    label: "작업 중",
    dot: "bg-green-500",
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  idle: {
    label: "대기",
    dot: "bg-yellow-500",
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
  },
  error: {
    label: "오류",
    dot: "bg-red-500",
    bg: "bg-red-500/10",
    text: "text-red-400",
  },
  stopped: {
    label: "중지",
    dot: "bg-gray-600",
    bg: "bg-gray-600/10",
    text: "text-gray-500",
  },
};

const modelColors: Record<ModelType, string> = {
  claude: "#a855f7",
  gemini: "#3b82f6",
  gpt: "#22c55e",
  custom: "#6b7280",
};

const modelEmoji: Record<ModelType, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  custom: "⚪",
};

function getInitials(name: string): string {
  return name
    .split(/[\s-_]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

export default function MemberCard({ agent, tasks }: MemberCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Fallback when an agent doc has a status / model outside the expected
  // enum (e.g., older docs polluted with a versioned model id). Prevents
  // a malformed Firestore doc from crashing the entire Agents tab.
  const status = statusConfig[agent.status] ?? statusConfig.idle;
  const modelKey: ModelType =
    agent.model in modelColors ? agent.model : "custom";
  const completedTasks = tasks.filter(
    (t) => t.claimedBy === agent.id && t.status === "DONE",
  );
  const currentTask = tasks.find((t) => t.id === agent.currentTaskId);
  const inProgressTasks = tasks.filter(
    (t) =>
      t.claimedBy === agent.id &&
      (t.status === "IN_PROGRESS" || t.status === "CLAIMED"),
  );

  return (
    <div
      className="rounded-lg border border-gray-700 bg-gray-800 p-4 cursor-pointer transition-colors hover:border-gray-600"
      style={{ borderLeftColor: modelColors[modelKey], borderLeftWidth: 3 }}
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: modelColors[modelKey] + "33" }}
        >
          {getInitials(agent.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-100">
              {agent.name}
            </span>
            <span className="text-xs">{modelEmoji[modelKey]}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">
              {agent.role}
            </span>
          </div>
        </div>

        {/* Status badge */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-2 py-1 ${status.bg}`}
        >
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          <span className={`text-xs font-medium ${status.text}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Current task */}
      {currentTask && (
        <div className="mt-3 rounded border border-blue-800/40 bg-blue-900/20 px-3 py-2">
          <p className="text-xs text-gray-400">현재 작업</p>
          <p className="mt-0.5 truncate text-sm text-blue-400">
            {currentTask.title}
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
        <span>
          완료{" "}
          <span className="text-gray-300 font-medium">
            {completedTasks.length}
          </span>
        </span>
        <span>
          진행 중{" "}
          <span className="text-gray-300 font-medium">
            {inProgressTasks.length}
          </span>
        </span>
        <span className="ml-auto">{formatRelativeTime(agent.createdAt)}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 border-t border-gray-700 pt-3 space-y-2">
          <div className="text-xs text-gray-400">
            <span className="text-gray-500">모델:</span>{" "}
            <span className="text-gray-300">{agent.model}</span>
          </div>
          {completedTasks.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">최근 완료 작업</p>
              <div className="space-y-1">
                {completedTasks.slice(0, 3).map((t) => (
                  <div
                    key={t.id}
                    className="rounded bg-gray-700/50 px-2 py-1 text-xs text-gray-400 truncate"
                  >
                    ✓ {t.title}
                  </div>
                ))}
              </div>
            </div>
          )}
          {inProgressTasks.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">진행 중인 작업</p>
              <div className="space-y-1">
                {inProgressTasks.map((t) => (
                  <div
                    key={t.id}
                    className="rounded bg-blue-900/20 border border-blue-800/30 px-2 py-1 text-xs text-blue-400 truncate"
                  >
                    ● {t.title}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
