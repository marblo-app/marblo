import { useDroppable } from "@dnd-kit/core";
import type { Task, TaskStatus } from "../../types/task";
import { DraggableTaskCard, TaskCard } from "./TaskCard";
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
  /** 생략하면 카드를 클릭해도 아무 일도 없다(비기너 미니 보드엔 상세가 없다). */
  onTaskClick?: (task: Task) => void;
  isDropTarget?: boolean;
  /**
   * ★경량 **레인**. 비기너 모드 미니 보드가 이 컬럼을 **그대로** 재사용한다
   * (중복 구현 금지). 드래그·드롭 힌트·빈칸 안내를 빼고, 카드도 compact 로
   * 그린다.
   *
   * ★가로 컬럼이 아니라 세로 레인이다: 라벨+개수가 왼쪽 고정폭에 서고 카드가
   * 오른쪽으로 흐른다. 비기너 화면에서 컬럼 셋을 나란히 세우면 폭이 넓을수록
   * 칸이 옆으로 벌어져 카드 몇 장이 허공에 떠 있는 성긴 보드가 됐다(3칸 ×
   * 최대 4장). 레인은 폭을 먹지 않고 세로로만 자라서 셸의 세로 흐름에 붙고,
   * 라벨이 한 열에 정렬돼 훑기도 쉽다. 높이는 부모가 정한다.
   */
  compact?: boolean;
  /**
   * 헤더 라벨 덮어쓰기. 미니 보드는 7상태를 3칸으로 접기 때문에 대표 상태
   * (IN_PROGRESS)의 색은 쓰되 라벨은 "진행 중" 처럼 접힌 이름이어야 한다.
   */
  label?: string;
  /** 라벨 옆 배지에 쓸 개수. 생략하면 `tasks.length`(=그려진 카드 수). */
  count?: number;
  /** 상한 때문에 안 그린 카드 수. 0 초과일 때만 "+N" 를 붙인다. */
  hiddenCount?: number;
}

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  isDropTarget,
  compact,
  label,
  count,
  hiddenCount = 0,
}: KanbanColumnProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];

  // compact 는 DndContext 밖에서 마운트된다. useDroppable 은 기본 컨텍스트
  // (dispatch=noop)로 안전하게 떨어지므로 훅 순서를 흔들지 않고 그대로 둔다 —
  // isOver 가 영원히 false 라 드롭 하이라이트는 자연히 죽는다.
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  const highlight = !compact && isOver && isDropTarget;
  const invalid = !compact && isOver && !isDropTarget;

  if (compact) {
    return (
      <div
        data-testid="beginner-mini-column"
        data-column-status={status}
        className="flex min-w-0 items-start gap-3"
      >
        {/* 고정폭 라벨 열 — 레인 셋의 라벨과 개수가 한 열에 정렬된다. */}
        <div className="flex w-[5.5rem] shrink-0 items-center gap-1.5 pt-1">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.bg}`}
          />
          <span className="truncate text-[11px] font-medium text-[#a6adc8]">
            {label ?? config.label}
          </span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#6c7086]">
            {count ?? tasks.length}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} compact />
          ))}
          {hiddenCount > 0 && (
            <p className="pl-0.5 text-[10px] text-[#6c7086]">
              {t("beginner.board.more", { count: hiddenCount })}
            </p>
          )}
          {tasks.length === 0 && (
            <p className="pt-1 text-[11px] leading-4 text-[#45475a]">—</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      // The floor is 168px, not 200: a column only ever reaches it when the
      // board pane is tight, and at that point four narrow-but-readable
      // columns beat three wide ones plus a REVIEW column hidden behind the
      // horizontal scroll. Cards truncate/reflow, so nothing clips.
      // ★ splitWorkspaceLayout.BOARD_MIN_WIDTH is derived from this number —
      // change one and change the other (a test pins the arithmetic).
      className={`flex flex-col flex-1 min-w-[168px] rounded-lg border transition-colors ${
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
