"use client";

import { useState, useMemo } from "react";
import { Task, TaskRole, COLUMN_STATUSES } from "@/lib/types";
import KanbanColumn from "./KanbanColumn";
import TaskDetailModal from "./TaskDetailModal";

interface KanbanBoardProps {
  tasks: Task[];
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
}

export default function KanbanBoard({
  tasks,
  onTaskUpdated,
  onTaskDeleted,
}: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [roleFilter, setRoleFilter] = useState<TaskRole | "all">("all");

  const filteredTasks = useMemo(() => {
    if (roleFilter === "all") return tasks;
    return tasks.filter((t) => t.role === roleFilter);
  }, [tasks, roleFilter]);

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const status of COLUMN_STATUSES) {
      map.set(
        status,
        filteredTasks.filter((t) => t.status === status),
      );
    }
    return map;
  }, [filteredTasks]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-950 px-6 py-3">
        <span className="text-sm text-gray-400">Filter:</span>
        <button
          onClick={() => setRoleFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            roleFilter === "all"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          All
        </button>
        {Object.values(TaskRole).map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(role)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              roleFilter === role
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {role}
          </button>
        ))}
      </div>

      {/* Columns */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-6">
        {COLUMN_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus.get(status) || []}
            onTaskClick={setSelectedTask}
          />
        ))}
      </div>

      {/* Detail modal */}
      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdated={(updated) => {
          onTaskUpdated(updated);
          setSelectedTask(null);
        }}
        onDeleted={(id) => {
          onTaskDeleted(id);
          setSelectedTask(null);
        }}
      />
    </div>
  );
}
