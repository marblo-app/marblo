import { useEffect, useMemo, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { RefreshCw } from "lucide-react";
import type { Task, TaskStatus, AgentRole } from "../../types/task";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useAuth } from "../../hooks/useAuth";
import { KanbanColumn } from "./KanbanColumn";
import { StuckLane } from "./StuckLane";
import { TaskGraphView } from "./TaskGraphView";
import { TaskCard } from "./TaskCard";
import { TaskCreateModal } from "./TaskCreateModal";
import { TaskDetailModal } from "./TaskDetailModal";
import { OrchestratorChat } from "../orchestrator/OrchestratorChat";
import { FirstShareNudge } from "../work-history/FirstMissionShareNudge";
import { getNextStatuses, canTransition } from "../../services/stateMachine";
import { updateTaskStatus } from "../../services/taskService";
import { useStuckLane } from "../../hooks/useStuckLane";
import { useTranslation } from "../../lib/i18n";

const COLUMN_STATUSES: TaskStatus[] = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
];
const ROLES: AgentRole[] = ["backend", "frontend", "test", "devops"];

/**
 * 보드를 그리는 두 방식. 칸반은 "지금 어느 단계인가", 그래프는 "무엇이 무엇을
 * 막고 있나" 를 답한다 — 같은 티켓 집합의 다른 축이라 필터·상세 모달·스토어
 * 구독은 전부 공유하고 렌더만 갈린다.
 */
type BoardViewMode = "kanban" | "graph";
const VIEW_MODE_KEY = "boardViewMode";

function readViewMode(): BoardViewMode {
  if (typeof window === "undefined") return "kanban";
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "graph"
      ? "graph"
      : "kanban";
  } catch {
    return "kanban";
  }
}

export function KanbanBoard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectsLoading = useProjectStore((s) => s.loading);
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.loading);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);

  const canUse = useSubscriptionStore((s) => s.canUse);

  const [roleFilters, setRoleFilters] = useState<Set<AgentRole>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOrchestrator, setShowOrchestrator] = useState(false);
  const [viewMode, setViewMode] = useState<BoardViewMode>(readViewMode);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* quota / disabled — best-effort */
    }
  }, [viewMode]);

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

  const handleRefreshBoard = useCallback(() => {
    if (!currentProject || loading) return;
    refreshTasks(currentProject.id).catch((err) => {
      console.error("Failed to refresh board tasks:", err);
    });
  }, [currentProject, loading, refreshTasks]);

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

  // 활성 컬럼 / 정체 레인 / 감춤(보관·삭제) 한 번에 가른다. 컬럼별로 다시
  // 판정하지 않으므로 같은 티켓이 두 곳에 뜨거나 어디에도 안 뜨는 일이 없다.
  //
  // BLOCKED/FAILED 는 예전엔 IN_PROGRESS 컬럼에 폴백으로 얹혀 있었다 — 진행
  // 중인 일과 멈춘 일이 한 칸에 섞여 "지금 굴러가는 게 몇 개인가" 를 셀 수
  // 없었다. 이제 둘 다 정체 레인으로 빠지고 활성 4컬럼은 정말 활성만 센다.
  const { active: activeTasks, stuck, hidden } = useStuckLane(filteredTasks);

  const visibleCount = activeTasks.length + stuck.total;

  // 그래프가 그리는 티켓 = 필터를 통과한 것 중 감춤(보관·삭제)만 뺀 전부.
  // 활성/정체 구분은 쓰지 않는다 — 의존 관계는 상태와 직교하고, 막힌 티켓이야
  // 말로 "무엇이 무엇을 기다리나" 를 볼 때 가장 봐야 할 노드다. 대신 칸반에서
  // 안 보이는 것(감춤)을 그래프에서만 되살리지는 않는다.
  //
  // filteredTasks 를 그대로 쓰지 않고 다시 거르는 이유는 참조 안정성이다:
  // 매 렌더 새 배열이 넘어가면 TaskGraphView 의 레이아웃 useMemo 가 매번 깨진다.
  const graphTasks = useMemo(() => {
    const hiddenIds = new Set(hidden.map((task) => task.id));
    return tasks.filter(
      (task) =>
        !hiddenIds.has(task.id) &&
        (roleFilters.size === 0 || roleFilters.has(task.role)),
    );
  }, [tasks, hidden, roleFilters]);

  const tasksByColumn = (columnStatus: TaskStatus) =>
    activeTasks.filter((t) => t.status === columnStatus);

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
        <div className="max-w-sm text-center">
          {/* Folder-connect is the first onboarding step: the pick auto-creates
              the project and boots the orchestrator, so lead with it visually. */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400">
            <svg
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-200">
            {t("board.noProjects.title")}
          </p>
          <p className="mx-auto mt-1.5 text-sm text-gray-500">
            {t("board.noProjects.desc")}
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("marblo:select-folder"))
            }
            className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
          >
            {t("board.noProjects.cta")}
          </button>
          <p className="mt-3 text-xs text-gray-600">
            {t("board.noProjects.hint")}
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
      <div className="px-4 pt-3">
        <FirstShareNudge
          projectId={currentProject.id}
          surface="board"
          enabled={currentProject.ownerId === user?.uid}
        />
      </div>

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

        {/* View switcher — kanban (status columns) vs graph (dependsOn DAG).
            Agents 탭의 List/Grid 토글과 같은 형태·같은 지속 방식. */}
        <div className="flex items-center rounded border border-gray-700 bg-gray-800/50 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            aria-pressed={viewMode === "kanban"}
            title={t("board.view.kanbanTip")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "kanban"
                ? "bg-gray-700 text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            ▤ {t("board.view.kanban")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            aria-pressed={viewMode === "graph"}
            title={t("board.view.graphTip")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "graph"
                ? "bg-gray-700 text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            ⑃ {t("board.view.graph")}
          </button>
        </div>

        {/* Task count — 보관/삭제로 감춘 티켓은 빠진다(화면에 없는 걸 세지
            않는다). 정체분은 여전히 보드 위에 있으므로 포함. */}
        <span className="text-xs text-gray-500">
          {visibleCount} task{visibleCount !== 1 ? "s" : ""}
        </span>

        <button
          type="button"
          onClick={handleRefreshBoard}
          disabled={loading}
          title={loading ? "Refreshing board..." : "Refresh board"}
          aria-label={loading ? "Refreshing board" : "Refresh board"}
          className="flex h-8 w-8 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>

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

      {/* Board body — 뷰 토글에 따라 칸반 컬럼 또는 의존 그래프. 두 뷰가 같은
          selectedTask 를 쓰므로 상세는 아래 TaskDetailModal 하나로 끝난다. */}
      {viewMode === "graph" ? (
        <div className="min-h-0 flex-1">
          <TaskGraphView tasks={graphTasks} onSelect={setSelectedTask} />
        </div>
      ) : (
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
              {/* DONE 우측 — 드롭 타깃이 아니다. 정체는 사용자가 끌어다 놓는
                컬럼이 아니라 판정 결과라, 끌어다 놓아도 판정이 그대로면 즉시
                되돌아온다. */}
              <StuckLane
                groups={stuck}
                hidden={hidden}
                onTaskClick={setSelectedTask}
              />
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
      )}

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
