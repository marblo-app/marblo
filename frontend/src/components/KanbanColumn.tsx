"use client";

import { Task, TaskStatus, STATUS_LABELS, STATUS_COLORS } from "@/lib/types";
import TaskCard from "./TaskCard";

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export default function KanbanColumn({
  status,
  tasks,
  onTaskClick,
}: KanbanColumnProps) {
  return (
    <div className="flex min-w-[280px] flex-1 flex-col rounded-xl border border-gray-800 bg-gray-900/50">
      <div
        className={`flex items-center justify-between rounded-t-xl px-4 py-3 ${STATUS_COLORS[status]}`}
      >
        <h2 className="text-sm font-semibold text-white">
          {STATUS_LABELS[status]}
        </h2>
        <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-medium text-white">
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" style={{ maxHeight: "calc(100vh - 200px)" }}>
        {tasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-600">No tasks</p>
        ) : (
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} />
          ))
        )}
      </div>
    </div>
  );
}
