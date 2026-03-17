"use client";

import { useState, useMemo } from "react";
import { Task, TaskRole, TaskStatus, COLUMN_STATUSES } from "@/lib/types";
import { deleteTask, archiveDoneTasks, cleanupStaleTodos, mergeProjects } from "@/lib/api";
import KanbanColumn from "./KanbanColumn";
import TaskDetailModal from "./TaskDetailModal";

interface KanbanBoardProps {
  tasks: Task[];
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
  onToast?: (message: string, type: "info" | "success" | "warning") => void;
  style?: React.CSSProperties;
}

export default function KanbanBoard({
  tasks,
  onTaskUpdated,
  onTaskDeleted,
  onToast,
  style,
}: KanbanBoardProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const handleQuickDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      onTaskDeleted(taskId);
    } catch {
      // silently fail — user can retry via modal
    }
  };
  const [roleFilter, setRoleFilter] = useState<TaskRole | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [mergeOpen, setMergeOpen] = useState(false);

  const projects = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.project_id) set.add(t.project_id);
    });
    const all = Array.from(set).sort();
    if (showArchived) return all;
    return all.filter((p) => !p.endsWith(":archived"));
  }, [tasks, showArchived]);

  const hasArchivedProjects = useMemo(() => {
    return tasks.some((t) => t.project_id?.endsWith(":archived"));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    // Hide archived projects by default
    if (!showArchived && projectFilter === "all") {
      result = result.filter((t) => !t.project_id?.endsWith(":archived"));
    }
    if (roleFilter !== "all") {
      result = result.filter((t) => t.role === roleFilter);
    }
    if (projectFilter !== "all") {
      result = result.filter((t) => t.project_id === projectFilter);
    }
    return result;
  }, [tasks, roleFilter, projectFilter, showArchived]);

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

  const handleArchive = async () => {
    const target = projectFilter !== "all" ? projectFilter : null;
    if (!target) {
      onToast?.("프로젝트를 선택해주세요", "warning");
      return;
    }
    if (!confirm(`"${target}" 프로젝트의 DONE 티켓을 아카이브합니다.`)) return;
    try {
      const { archived_count } = await archiveDoneTasks(target);
      onToast?.(`${archived_count}개 티켓 아카이브됨`, "success");
    } catch {
      onToast?.("아카이브 실패", "warning");
    }
  };

  const handleCleanupStale = async () => {
    if (!confirm("24시간 이상 방치된 TODO 티켓을 FAILED 처리합니다.")) return;
    try {
      const project = projectFilter !== "all" ? projectFilter : undefined;
      const { cleaned_count } = await cleanupStaleTodos(24, project);
      onToast?.(`${cleaned_count}개 티켓 정리됨`, "success");
    } catch {
      onToast?.("정리 실패", "warning");
    }
  };

  const handleMerge = async (targetProject: string) => {
    setMergeOpen(false);
    if (projectFilter === "all") {
      onToast?.("프로젝트를 먼저 선택해주세요", "warning");
      return;
    }
    const sourceCount = tasks.filter((t) => t.project_id === projectFilter).length;
    if (
      !confirm(
        `'${projectFilter}' 프로젝트를 '${targetProject}'로 병합합니다. ${sourceCount}개 태스크가 이동됩니다.`,
      )
    )
      return;
    try {
      const { merged_count } = await mergeProjects(projectFilter, targetProject);
      onToast?.(`${merged_count}개 태스크 병합됨`, "success");
      setProjectFilter(targetProject);
    } catch {
      onToast?.("병합 실패", "warning");
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={style}>
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

        {/* Show archived toggle */}
        {hasArchivedProjects && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-gray-600"
            />
            Show archived
          </label>
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={handleCleanupStale}
          className="rounded-lg border border-red-800/50 bg-red-900/30 px-3 py-1 text-xs text-red-400 hover:bg-red-900/50"
        >
          Cleanup Stale
        </button>
        {/* Merge Project */}
        <div className="relative">
          <button
            onClick={() => {
              if (projectFilter === "all") {
                onToast?.("프로젝트를 먼저 선택해주세요", "warning");
                return;
              }
              setMergeOpen((prev) => !prev);
            }}
            className="rounded-lg border border-blue-800/50 bg-blue-900/30 px-3 py-1 text-xs text-blue-400 hover:bg-blue-900/50"
          >
            Merge Project
          </button>
          {mergeOpen && projectFilter !== "all" && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
              <div className="px-3 py-1.5 text-xs text-gray-500">
                Merge &apos;{projectFilter}&apos; into:
              </div>
              {projects
                .filter((p) => p !== projectFilter)
                .map((p) => (
                  <button
                    key={p}
                    onClick={() => handleMerge(p)}
                    className="block w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800"
                  >
                    {p}
                  </button>
                ))}
              {projects.filter((p) => p !== projectFilter).length === 0 && (
                <div className="px-3 py-1.5 text-xs text-gray-600">
                  No other projects
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={handleArchive}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          Archive Done
        </button>
      </div>

      {/* Columns */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-6">
        {COLUMN_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus.get(status) || []}
            onTaskClick={setSelectedTask}
            onTaskDelete={handleQuickDelete}
            collapsible={status === TaskStatus.DONE}
            collapsed={status === TaskStatus.DONE ? doneCollapsed : undefined}
            onToggleCollapse={
              status === TaskStatus.DONE
                ? () => setDoneCollapsed((prev) => !prev)
                : undefined
            }
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
