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
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const projects = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.project_id) set.add(t.project_id);
    });
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (roleFilter !== "all") {
      result = result.filter((t) => t.role === roleFilter);
    }
    if (projectFilter !== "all") {
      result = result.filter((t) => t.project_id === projectFilter);
    }
    return result;
  }, [tasks, roleFilter, projectFilter]);

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
      <div className="flex items-center gap-4 border-b border-gray-800 bg-gray-950 px-6 py-3">
        {/* Project filter */}
        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Project:</span>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

        {/* Role filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Role:</span>
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
