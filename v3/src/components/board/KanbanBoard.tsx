import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Task, TaskStatus, AgentRole } from "../../types/task";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { KanbanColumn } from "./KanbanColumn";
import { TaskCard } from "./TaskCard";
import { TaskCreateModal } from "./TaskCreateModal";
import { TaskDetailModal } from "./TaskDetailModal";
import { OrchestratorChat } from "../orchestrator/OrchestratorChat";
import { getNextStatuses, canTransition } from "../../services/stateMachine";
import { updateTaskStatus } from "../../services/taskService";
import { useTranslation } from "../../lib/i18n";

const COLUMN_STATUSES: TaskStatus[] = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
];

// BLOCKED/FAILED 태스크가 표시될 폴백 컬럼 (직전 상태 기준)
const FALLBACK_COLUMN: Record<string, TaskStatus> = {
  BLOCKED: "IN_PROGRESS",
  FAILED: "IN_PROGRESS",
};
const ROLES: AgentRole[] = ["backend", "frontend", "test", "devops"];

export function KanbanBoard() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectsLoading = useProjectStore((s) => s.loading);
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.loading);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);

  const canUse = useSubscriptionStore((s) => s.canUse);

  const [roleFilters, setRoleFilters] = useState<Set<AgentRole>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOrchestrator, setShowOrchestrator] = useState(false);

  // Drag-and-drop state
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [validDropStatuses, setValidDropStatuses] = useState<Set<TaskStatus>>(
    new Set(),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    if (!task) return;
    setActiveTask(task);
    setValidDropStatuses(new Set(getNextStatuses(task.status)));
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setValidDropStatuses(new Set());

    if (!over) return;

    const task = active.data.current?.task as Task | undefined;
    const targetStatus = over.data.current?.status as TaskStatus | undefined;
    if (!task || !targetStatus) return;
    if (task.status === targetStatus) return;
    if (!canTransition(task.status, targetStatus)) return;

    try {
      await updateTaskStatus(task.id, targetStatus);
      // Notify assigned agent about drag-drop status change
      if (task.claimedBy) {
        const isCancelled =
          targetStatus === "BLOCKED" || targetStatus === "FAILED";
        window.electronAPI.bridge
          .injectMessage({
            targetAgent: task.claimedBy,
            tag: isCancelled ? "Task Cancelled" : "Task Status Changed",
            message: `상태 변경: ${task.status} → ${targetStatus}`,
            taskId: task.id,
            taskTitle: task.title,
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Failed to update task status:", err);
    }
  }, []);

  // Subscribe to tasks when project changes
  useEffect(() => {
    if (!currentProject) return;
    const unsub = subscribeToTasks(currentProject.id);
    return unsub;
  }, [currentProject?.id, subscribeToTasks]);

  // Update selectedTask when tasks change (real-time sync)
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find((t) => t.id === selectedTask.id);
      if (updated) {
        setSelectedTask(updated);
      }
    }
  }, [tasks]);

  // Consume cross-tab jump targets (e.g. Activity Stream "📋 태스크 열기").
  // Layout has already switched to the board tab by the time we mount; we
  // grab the latched target, find the task in store, open the detail modal,
  // and clear the latch so it doesn't fire again.
  //
  // If tasks haven't arrived yet (subscribe in flight, length 0), we leave
  // the latch alone and retry on the next snapshot. Once tasks are present
  // we consume even if the id wasn't found — otherwise a deleted-or-cross-
  // project target would keep the latch dangling indefinitely.
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump || pendingJump.type !== "task") return;
    if (tasks.length === 0) return;
    const task = tasks.find((t) => t.id === pendingJump.id);
    if (task) setSelectedTask(task);
    consumeJump();
  }, [pendingJump, tasks, consumeJump]);

  const toggleRole = (role: AgentRole) => {
    setRoleFilters((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  const filteredTasks = tasks.filter((t) => {
    if (roleFilters.size > 0 && !roleFilters.has(t.role)) return false;
    return true;
  });

  const tasksByColumn = (columnStatus: TaskStatus) =>
    filteredTasks.filter((t) => {
      if (t.status === columnStatus) return true;
      // BLOCKED/FAILED → 폴백 컬럼에 표시
      const fallback = FALLBACK_COLUMN[t.status];
      return fallback === columnStatus;
    });

  if (!currentProject) {
    // Distinguish "still loading on cold start" from "genuinely no project".
    // Until the projects store has hydrated (or while it's actively loading),
    // show a spinner rather than a false "No Projects" empty state.
    if (!projectsHydrated || projectsLoading) {
      return (
        <div className="flex h-full items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm">Loading projects...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="text-center">
          <p className="text-lg font-medium">No Projects</p>
          <p className="mt-1 text-sm text-gray-500">
            Create a project to start using the board.
          </p>
        </div>
      </div>
    );
  }

  if (loading && tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm">Loading board...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-700/50 flex-shrink-0">
        {/* Project name (read-only, selection now in Header) */}
        <span className="text-sm font-medium text-gray-300">
          {currentProject.name}
        </span>

        {/* Role Filters */}
        <div className="flex items-center gap-2">
          {ROLES.map((role) => (
            <label
              key={role}
              className="flex items-center gap-1 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={roleFilters.has(role)}
                onChange={() => toggleRole(role)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-xs text-gray-400">{role}</span>
            </label>
          ))}
        </div>

        <div className="flex-1" />

        {/* Task count */}
        <span className="text-xs text-gray-500">
          {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
        </span>

        {/* AI Decompose button */}
        {canUse("orchestrator") && (
          <button
            onClick={() => setShowOrchestrator(true)}
            className="flex items-center gap-1.5 rounded border border-purple-500/50 bg-purple-500/10 px-3 py-1.5 text-sm font-medium text-purple-400 hover:bg-purple-500/20"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            {t("board.aiBreakdown")}
          </button>
        )}

        {/* Create button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          + New Task
        </button>
      </div>

      {/* Board columns */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div className="flex gap-4 h-full">
            {COLUMN_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={tasksByColumn(status)}
                onTaskClick={setSelectedTask}
                isDropTarget={validDropStatuses.has(status)}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeTask && (
            <div className="w-[220px] opacity-90">
              <TaskCard task={activeTask} onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Modals */}
      {showCreateModal && currentProject && (
        <TaskCreateModal
          projectId={currentProject.id}
          onClose={() => setShowCreateModal(false)}
        />
      )}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
      {showOrchestrator && (
        <OrchestratorChat onClose={() => setShowOrchestrator(false)} />
      )}
    </div>
  );
}
