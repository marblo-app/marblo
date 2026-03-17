"use client";

import { ReactNode } from "react";
import { Task, TaskStatus, STATUS_LABELS, STATUS_COLORS } from "@/lib/types";
import TaskCard from "./TaskCard";

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onTaskDelete: (taskId: string) => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  headerAction?: ReactNode;
}

export default function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  onTaskDelete,
  collapsible,
  collapsed,
  onToggleCollapse,
  headerAction,
}: KanbanColumnProps) {
  if (collapsible && collapsed) {
    return (
      <div
        className="flex min-w-[48px] max-w-[48px] cursor-pointer flex-col rounded-xl border border-gray-800 bg-gray-900/50"
        onClick={onToggleCollapse}
      >
        <div
          className={`flex items-center justify-center rounded-t-xl px-1 py-3 ${STATUS_COLORS[status]}`}
        >
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-medium text-white">
            {tasks.length}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <span
            className="text-xs font-semibold text-gray-400"
            style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-[280px] flex-1 flex-col rounded-xl border border-gray-800 bg-gray-900/50">
      <div
        className={`flex items-center justify-between rounded-t-xl px-4 py-3 ${STATUS_COLORS[status]}`}
      >
        <div className="flex items-center gap-2">
          {collapsible && (
            <button
              onClick={onToggleCollapse}
              className="text-white/70 hover:text-white"
              title="Collapse"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          <h2 className="text-sm font-semibold text-white">
            {STATUS_LABELS[status]}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-medium text-white">
            {tasks.length}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" style={{ maxHeight: "var(--column-max-height, calc(100vh - 200px))" }}>
        {tasks.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-600">No tasks</p>
        ) : (
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} onDelete={onTaskDelete} />
          ))
        )}
      </div>
    </div>
  );
}
