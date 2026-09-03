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
import type { Agent } from "../../types/agent";
import type { Task, TaskStatus, AgentRole } from "../../types/task";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useAuth } from "../../hooks/useAuth";
import { KanbanColumn } from "./KanbanColumn";
import {
  StuckLane,
  loadStuckLaneExpanded,
  persistStuckLaneExpanded,
} from "./StuckLane";
import { TaskGraphView } from "./TaskGraphView";
import { TaskCard } from "./TaskCard";
import { TaskCreateModal } from "./TaskCreateModal";
import { TaskDetailModal } from "./TaskDetailModal";
import { OrchestratorChat } from "../orchestrator/OrchestratorChat";
import { FirstShareNudge } from "../work-history/FirstMissionShareNudge";
import { getNextStatuses, canTransition } from "../../services/stateMachine";
import { updateTaskStatus } from "../../services/taskService";
import { useStuckLane } from "../../hooks/useStuckLane";
import { useBoardPan } from "../../hooks/useBoardPan";
import { sortDoneTasks } from "../../lib/boardSort";
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

export interface KanbanBoardProps {
  /**
   * ★비기너 셸 임베드. 보기는 마블로와 동일(5단계 칸반 + 그래프 토글)이고
   * 조작만 줄인다 — New Task / AI 분해 / 역할 필터 / DnD 를 끄고 카드는
   * compact 로 그린다. 상세 모달은 `onTaskClick` 이 있으면 호스트가 연다.
   */
  simplified?: boolean;
  /** 카드만 compact (simplified 와 함께 쓰면 기본 true). */
  compactCards?: boolean;
  /** 외부 상세 핸들러. 있으면 내부 TaskDetailModal 을 띄우지 않는다. */
  onTaskClick?: (task: Task) => void;
  /** compact 카드의 담당 에이전트 칩 → 터미널. */
  onAgentClick?: (agent: Agent) => void;
  /** compact 카드의 "바뀐 코드 보기" 진입. */
  showWorktreeDiff?: boolean;
}

export function KanbanBoard({
  simplified = false,
  compactCards,
  onTaskClick,
  onAgentClick,
  showWorktreeDiff,
}: KanbanBoardProps = {}) {
  const useCompactCards = compactCards ?? simplified;
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectsLoading = useProjectStore((s) => s.loading);
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.loading);
  const subscriptionError = useTaskStore((s) => s.subscriptionError);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);

  const canUse = useSubscriptionStore((s) => s.canUse);

  const [roleFilters, setRoleFilters] = useState<Set<AgentRole>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showOrchestrator, setShowOrchestrator] = useState(false);
  const [viewMode, setViewMode] = useState<BoardViewMode>(readViewMode);
  // 정체 레인의 펼침 상태는 보드가 쥔다 — 활성 컬럼의 "n건 정체" 흔적을 눌러
  // 레인을 펼 수 있어야 하는데, 상태가 레인 안에 갇혀 있으면 그 경로가 없다.
  const [stuckExpanded, setStuckExpanded] = useState(loadStuckLaneExpanded);
  useEffect(() => {
    persistStuckLaneExpanded(stuckExpanded);
  }, [stuckExpanded]);
  const revealStuck = useCallback(() => setStuckExpanded(true), []);

  const handleTaskClick = useCallback(
    (task: Task) => {
      if (onTaskClick) {
        onTaskClick(task);
        return;
      }
      // simplified 임베드는 호스트 상세 모달을 쓰므로, 핸들러가 없으면
      // 카드가 "눌러지는 것처럼" 보이면 안 된다(시연 피드백 ②).
      if (simplified) return;
      setSelectedTask(task);
    },
    [onTaskClick, simplified],
  );

  /** 컬럼/그래프에 넘길 클릭 — simplified 이고 호스트 핸들러 없으면 undefined. */
  const columnTaskClick =
    onTaskClick || !simplified ? handleTaskClick : undefined;

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
    if (task) handleTaskClick(task);
    consumeJump();
  }, [pendingJump, tasks, consumeJump, handleTaskClick]);

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
  const {
    active: activeTasks,
    stuck,
    hidden,
    stuckByStatus,
  } = useStuckLane(filteredTasks);

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

  // 컬럼별 카드. 정렬은 DONE 만 건다 — 나머지 컬럼은 스토어가 넘긴 priority
  // 순서가 곧 "무엇부터 볼 것인가" 라 그대로 두고, 완료 컬럼만 "방금 끝난 게
  // 어디 있나" 가 질문이라 최근 완료순(completedAt, 없으면 updatedAt 폴백)이다.
  // lib/boardSort.ts 참조.
  const tasksByColumn = (columnStatus: TaskStatus) => {
    const column = activeTasks.filter((t) => t.status === columnStatus);
    return columnStatus === "DONE" ? sortDoneTasks(column) : column;
  };

  // 빈 배경 드래그로 보드 좌우 이동. 카드 DnD(dnd-kit)와는 훅 안에서 가른다 —
  // 카드·버튼 위에서 시작한 포인터는 손대지 않는다. hooks/useBoardPan.ts 참조.
  const { isPanning, containerProps: panProps } = useBoardPan();

  // 비기너 첫 실행은 아직 폴더를 고르기 전일 수 있다. simplified 보드는 이
  // 시점에도 "앞으로 여기에 일이 보인다"는 빈 5열을 보여 주는 표면이라
  // project가 없어도 렌더할 수 있다(구독/새 티켓/새로고침은 모두 no-op).
  // 일반 보드는 프로젝트 이름·생성 액션을 쓰므로 종전의 선택-폴더 안내를 유지한다.
  if (!currentProject && !simplified) {
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

  if (subscriptionError && tasks.length === 0) {
    const authRequired = subscriptionError === "AUTH_REQUIRED";
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-gray-300"
        data-testid="kanban-board-read-error"
        role="alert"
      >
        <div className="max-w-md text-center">
          <p className="text-base font-semibold text-amber-200">
            {t(
              authRequired
                ? "board.authRequired.title"
                : "board.readFailed.title",
            )}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            {t(
              authRequired
                ? "board.authRequired.desc"
                : "board.readFailed.desc",
            )}
          </p>
        </div>
      </div>
    );
  }

  const kanbanColumns = (
    <div
      data-testid="kanban-scroll"
      {...panProps}
      // pan 중: 잡은 손 커서 + 텍스트 선택 금지. 끌기는 포인터와 1:1 이라
      // 애니메이션이 없다 — prefers-reduced-motion 에서 줄일 움직임이 없다.
      className={`flex-1 overflow-x-auto overflow-y-hidden ${simplified ? "p-2" : "p-4"} ${
        isPanning ? "cursor-grabbing select-none" : ""
      }`}
    >
      <div className={`flex h-full ${simplified ? "gap-2" : "gap-4"}`}>
        {COLUMN_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByColumn(status)}
            onTaskClick={columnTaskClick}
            isDropTarget={!simplified && validDropStatuses.has(status)}
            cardCompact={useCompactCards}
            showWorktreeDiff={showWorktreeDiff}
            onAgentClick={onAgentClick}
            stuckAwayCount={stuckByStatus.get(status) ?? 0}
            onRevealStuck={revealStuck}
          />
        ))}
        {/* DONE 우측 — 드롭 타깃이 아니다. 정체는 사용자가 끌어다 놓는
            컬럼이 아니라 판정 결과라, 끌어다 놓아도 판정이 그대로면 즉시
            되돌아온다. simplified 에서도 보여 마블로와 같은 5+정체 구성을 유지. */}
        <StuckLane
          groups={stuck}
          hidden={hidden}
          onTaskClick={columnTaskClick ?? (() => {})}
          expanded={stuckExpanded}
          onToggleExpanded={() => setStuckExpanded((v) => !v)}
        />
      </div>
    </div>
  );

  return (
    <div
      className="flex flex-col h-full"
      data-testid={simplified ? "beginner-marblo-board" : "kanban-board"}
      data-simplified={simplified ? "true" : undefined}
    >
      {!simplified && (
        <div className="px-4 pt-3">
          <FirstShareNudge
            projectId={currentProject!.id}
            surface="board"
            enabled={currentProject!.ownerId === user?.uid}
          />
        </div>
      )}

      {/* Toolbar — simplified 는 칸반↔그래프 토글·개수·새로고침만 남긴다. */}
      <div
        className={`flex flex-shrink-0 items-center border-b border-gray-700/50 ${
          simplified ? "gap-2 px-2 py-1.5" : "gap-4 px-4 py-3"
        }`}
      >
        {!simplified && (
          <>
            <span className="text-sm font-medium text-gray-300">
              {currentProject!.name}
            </span>

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
          </>
        )}

        <div className="flex-1" />

        {/* View switcher — kanban (status columns) vs graph (dependsOn DAG).
            Agents 탭의 List/Grid 토글과 같은 형태·같은 지속 방식. */}
        <div className="flex items-center rounded border border-gray-700 bg-gray-800/50 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            aria-pressed={viewMode === "kanban"}
            title={t("board.view.kanbanTip")}
            data-testid="board-view-kanban"
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
            data-testid="board-view-graph"
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "graph"
                ? "bg-gray-700 text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            ⑃ {t("board.view.graph")}
          </button>
        </div>

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

        {!simplified && canUse("orchestrator") && (
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

        {!simplified && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            + New Task
          </button>
        )}
      </div>

      {/* Board body — 뷰 토글에 따라 칸반 컬럼 또는 의존 그래프. */}
      {viewMode === "graph" ? (
        <div className="min-h-0 flex-1">
          <TaskGraphView
            tasks={graphTasks}
            onSelect={columnTaskClick ?? (() => {})}
          />
        </div>
      ) : simplified ? (
        kanbanColumns
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {kanbanColumns}
          <DragOverlay>
            {activeTask && (
              <div className="w-[220px] opacity-90">
                <TaskCard task={activeTask} onClick={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Modals — simplified + onTaskClick 이면 호스트(비기너 셸)가 상세를 연다. */}
      {!simplified && showCreateModal && currentProject && (
        <TaskCreateModal
          projectId={currentProject.id}
          onClose={() => setShowCreateModal(false)}
        />
      )}
      {!onTaskClick && selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
      {!simplified && showOrchestrator && (
        <OrchestratorChat onClose={() => setShowOrchestrator(false)} />
      )}
    </div>
  );
}
