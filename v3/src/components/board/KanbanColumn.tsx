import { useDroppable } from "@dnd-kit/core";
import type { Task, TaskStatus } from "../../types/task";
import { DraggableTaskCard } from "./TaskCard";
import { useTranslation } from "../../lib/i18n";

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; bg: string }
> = {
  TODO: { label: "TODO", color: "text-gray-400", bg: "bg-gray-500" },
  CLAIMED: { label: "CLAIMED", color: "text-yellow-400", bg: "bg-yellow-500" },
  IN_PROGRESS: {
    label: "IN PROGRESS",
    color: "text-blue-400",
    bg: "bg-blue-500",
  },
  REVIEW: { label: "REVIEW", color: "text-purple-400", bg: "bg-purple-500" },
  BLOCKED: { label: "BLOCKED", color: "text-orange-400", bg: "bg-orange-500" },
  FAILED: { label: "FAILED", color: "text-red-400", bg: "bg-red-500" },
  DONE: { label: "DONE", color: "text-green-400", bg: "bg-green-500" },
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  isDropTarget?: boolean;
}

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  isDropTarget,
}: KanbanColumnProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  const highlight = isOver && isDropTarget;
  const invalid = isOver && !isDropTarget;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-1 min-w-[200px] rounded-lg border transition-colors ${
        highlight
          ? "bg-blue-500/10 border-blue-500/50"
          : invalid
            ? "bg-red-500/5 border-red-500/30"
            : isDropTarget
              ? "bg-gray-900/50 border-blue-500/20"
              : "bg-gray-900/50 border-gray-700/50"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <span className={`text-sm font-semibold ${config.color}`}>
          {config.label}
        </span>
        <span
          className={`inline-flex items-center justify-center min-w-[20px] h-5 rounded-full px-1.5 text-xs font-medium text-white ${config.bg}`}
        >
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.map((task) => (
          <DraggableTaskCard key={task.id} task={task} onClick={onTaskClick} />
        ))}
        {tasks.length === 0 && (
          <div
            className={`py-4 text-center text-xs ${highlight ? "text-blue-400" : "text-gray-600"}`}
          >
            <p>
              {highlight
                ? t("board.column.dropHere")
                : t("board.column.noTasks")}
            </p>
            {/* Subtle next-action hint on the entry column only — keeps the
                empty board from being a silent dead-end without adding noise
                to every column. */}
            {!highlight && status === "TODO" && (
              <p className="mt-1 text-gray-700">{t("board.column.todoHint")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
