import { useState } from "react";
import { Archive, ChevronDown, ChevronRight, RotateCw, X } from "lucide-react";
import type { Task } from "../../types/task";
import type { StuckGroups, StuckKind, StuckVerdict } from "../../lib/stuckLane";
import { useStuckTaskActions } from "../../hooks/useStuckTaskActions";
import { TaskCard } from "./TaskCard";
import { useTranslation } from "../../lib/i18n";
import { StateBlock } from "../common/StateBlock";
import type { FailedState } from "../common/loadState";

const EXPANDED_STORAGE_KEY = "marblo.board.stuckLane.expanded";

/**
 * 기본은 접힘. 사용자가 편 상태는 세션을 넘어 유지된다.
 *
 * ★펼침 상태의 주인은 이 컴포넌트가 아니라 보드(KanbanBoard)다: 활성 컬럼의
 * "n건이 정체 레인에 있습니다" 흔적을 누르면 레인이 펴져야 하는데, 상태가
 * 레인 안에 갇혀 있으면 그 경로가 존재할 수 없다. 그래서 로드·저장만 여기서
 * 내보내고 상태 자체는 보드가 쥔다.
 */
export function loadStuckLaneExpanded(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistStuckLaneExpanded(expanded: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    /* best-effort */
  }
}

const SUBGROUP_STYLE: Record<
  StuckKind,
  { icon: string; color: string; bg: string }
> = {
  BLOCKED: { icon: "🚫", color: "text-orange-400", bg: "bg-orange-500" },
  FAILED: { icon: "✕", color: "text-red-400", bg: "bg-red-500" },
  STALE: { icon: "⏳", color: "text-amber-400", bg: "bg-amber-500" },
};

interface StuckLaneProps {
  groups: StuckGroups;
  /** 보관·삭제로 감춘 티켓 — 복구 서랍에만 쓰인다. */
  hidden: Task[];
  onTaskClick: (task: Task) => void;
  /** 펼침 여부. 상태의 주인은 보드다({@link loadStuckLaneExpanded} 주석 참조). */
  expanded: boolean;
  onToggleExpanded: () => void;
}

/** 접힌 레인에 세울 그룹 순서 — 펼친 뒤 서브그룹 순서와 같아야 한다. */
const SUBGROUP_ORDER: StuckKind[] = ["BLOCKED", "FAILED", "STALE"];

/**
 * DONE 우측의 **가상** 정체 레인.
 *
 * 여기 있는 카드는 status 가 바뀐 게 아니다 — BLOCKED/FAILED 는 원래 그
 * status 이고 STALE 은 순수 파생이다(lib/stuckLane). 레인을 펴면 근거가
 * 3그룹으로 갈려 보이고, 정체가 풀리면(에이전트 재기동·활동 재개) 카드는
 * 아무 write 없이 원래 컬럼으로 돌아간다.
 */
export function StuckLane({
  groups,
  hidden,
  onTaskClick,
  expanded,
  onToggleExpanded,
}: StuckLaneProps) {
  const { t } = useTranslation();
  const [showHidden, setShowHidden] = useState(false);
  const actions = useStuckTaskActions();

  const { blocked, failed, stale, total } = groups;

  // 접힌 채로도 **무엇이** 몇 건인지 보여야 한다. 총계 하나만 보이면
  // "실패한 작업이 조용히 사라진" 상태와 "정체 몇 건" 이 같은 배지로 뭉개진다.
  const counts: Record<StuckKind, number> = {
    BLOCKED: blocked.length,
    FAILED: failed.length,
    STALE: stale.length,
  };
  const nonEmpty = SUBGROUP_ORDER.filter((kind) => counts[kind] > 0);
  // 스크린리더도 같은 사실을 듣는다 — 배지는 시각 전용이 아니다.
  const breakdown = nonEmpty
    .map((kind) => `${t(`board.stuck.group.${kind}`)} ${counts[kind]}`)
    .join(", ");

  return (
    <div
      className={`flex flex-col rounded-lg border transition-[width,background-color] ${
        expanded
          ? "flex-1 min-w-[220px] border-gray-700/50 bg-gray-900/50"
          : "w-[52px] flex-none border-gray-700/50 bg-gray-900/30"
      } ${total > 0 ? "border-amber-500/30" : ""}`}
      data-testid="stuck-lane"
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={
          breakdown
            ? `${t("board.stuck.title")} (${total}) — ${breakdown}`
            : `${t("board.stuck.title")} (${total})`
        }
        title={t("board.stuck.tooltip")}
        className={`flex items-center gap-1.5 px-2 py-2 text-left hover:bg-gray-800/50 ${
          expanded
            ? "justify-between border-b border-gray-700/50 px-3"
            : // 접힘: 세로 라벨이 컬럼 높이 전체를 쓰도록 — 위쪽에 헤더만 뜨고
              // 아래가 텅 빈 52px 기둥이 되는 걸 막는다.
              "h-full flex-col justify-start"
        }`}
      >
        <span className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
          )}
          {expanded && (
            <span className="text-sm font-semibold text-amber-400">
              {t("board.stuck.title")}
            </span>
          )}
        </span>
        <span
          className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium text-white ${
            total > 0 ? "bg-amber-500" : "bg-gray-600"
          }`}
        >
          {total}
        </span>
        {/* 접힌 상태에서도 무엇의 개수인지 알 수 있게 세로 레이블을 남긴다. */}
        {!expanded && (
          <span
            className="mt-1 text-[10px] font-semibold tracking-wider text-amber-400/80"
            style={{ writingMode: "vertical-rl" }}
          >
            {t("board.stuck.title")}
          </span>
        )}
        {/* ★접힌 레인의 그룹별 건수. 세 그룹 중 무엇이 몇 건인지 펴지 않고도
            보인다 — BLOCKED 는 사람을 기다리는 것이고 FAILED 는 이미 실패한
            것이라, 둘이 같은 총계 배지 뒤에 숨으면 "조용히 사라진 실패" 가
            된다. 0건 그룹은 그리지 않는다(없는 것을 세는 배지는 소음이다). */}
        {!expanded && nonEmpty.length > 0 && (
          <span className="mt-2 flex flex-col items-center gap-1">
            {nonEmpty.map((kind) => (
              <span
                key={kind}
                data-testid={`stuck-collapsed-count-${kind}`}
                title={`${t(`board.stuck.group.${kind}`)} ${counts[kind]}`}
                className="flex flex-col items-center leading-none"
              >
                <span aria-hidden className="text-[10px]">
                  {SUBGROUP_STYLE[kind].icon}
                </span>
                <span
                  className={`text-[10px] font-semibold tabular-nums ${SUBGROUP_STYLE[kind].color}`}
                >
                  {counts[kind]}
                </span>
              </span>
            ))}
          </span>
        )}
      </button>

      {expanded && (
        <div className="flex-1 space-y-3 overflow-y-auto p-2">
          {(actions.error || actions.message) && (
            <div
              role="status"
              onClick={actions.clearFeedback}
              className={`cursor-pointer rounded border px-2 py-1.5 text-xs ${
                actions.error
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {actions.error ?? actions.message}
            </div>
          )}

          {total === 0 && (
            <p className="py-4 text-center text-xs text-gray-600">
              {t("board.stuck.empty")}
            </p>
          )}

          <StuckSubgroup
            kind="BLOCKED"
            tasks={blocked}
            groups={groups}
            actions={actions}
            onTaskClick={onTaskClick}
          />
          <StuckSubgroup
            kind="FAILED"
            tasks={failed}
            groups={groups}
            actions={actions}
            onTaskClick={onTaskClick}
          />
          <StuckSubgroup
            kind="STALE"
            tasks={stale}
            groups={groups}
            actions={actions}
            onTaskClick={onTaskClick}
          />

          {/* 복구 서랍 — 보관/삭제는 되돌릴 수 있어야 액션이지, 되돌릴 수
              없으면 함정이다. 감춘 티켓이 0이면 아예 안 보인다. */}
          {hidden.length > 0 && (
            <section className="border-t border-gray-700/50 pt-2">
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                aria-expanded={showHidden}
                className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs text-gray-500 hover:bg-gray-800/50 hover:text-gray-300"
              >
                {showHidden ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {t("board.stuck.hiddenToggle", { count: hidden.length })}
              </button>
              {showHidden && (
                <ul className="mt-1 space-y-1">
                  {hidden.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center gap-1 rounded bg-gray-800/50 px-2 py-1"
                    >
                      <span className="flex-1 truncate text-xs text-gray-400">
                        {task.deleted ? "🗑" : "🗄"} {task.title}
                      </span>
                      <button
                        type="button"
                        disabled={actions.busy !== null}
                        onClick={() => actions.restore(task)}
                        className="flex-none rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-300 hover:bg-blue-500/10 disabled:opacity-50"
                      >
                        {t("board.stuck.action.restore")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

interface StuckSubgroupProps {
  kind: StuckKind;
  tasks: Task[];
  groups: StuckGroups;
  actions: ReturnType<typeof useStuckTaskActions>;
  onTaskClick: (task: Task) => void;
}

function StuckSubgroup({
  kind,
  tasks,
  groups,
  actions,
  onTaskClick,
}: StuckSubgroupProps) {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;
  const style = SUBGROUP_STYLE[kind];

  return (
    <section>
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        <span aria-hidden>{style.icon}</span>
        <span className={`text-xs font-semibold ${style.color}`}>
          {t(`board.stuck.group.${kind}`)}
        </span>
        <span
          className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium text-white ${style.bg}`}
        >
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <StuckTaskCard
            key={task.id}
            task={task}
            verdict={groups.verdicts.get(task.id)}
            actions={actions}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
    </section>
  );
}

interface StuckTaskCardProps {
  task: Task;
  verdict: StuckVerdict | undefined;
  actions: ReturnType<typeof useStuckTaskActions>;
  onTaskClick: (task: Task) => void;
}

/**
 * 보드 카드 + "왜 정체인지" 근거 + 원클릭 액션 3종.
 *
 * 카드 본체는 활성 컬럼과 **같은** TaskCard 를 쓴다 — 정체 레인으로 옮겨졌다고
 * 다른 카드처럼 보이면 사용자가 "이건 뭔가 다른 티켓" 으로 읽는다. 달라지는
 * 건 근거 한 줄과 액션 바뿐이다. 카드는 드래그되지 않는다: 정체는 사용자가
 * 끌어다 놓은 컬럼이 아니라 판정 결과라, 여기서 끌어내도 판정이 그대로면 즉시
 * 돌아온다.
 */
function StuckTaskCard({
  task,
  verdict,
  actions,
  onTaskClick,
}: StuckTaskCardProps) {
  const { t } = useTranslation();
  const busy = actions.busy?.taskId === task.id ? actions.busy.action : null;
  const disabled = busy !== null;

  // ★STALE 은 "멈춘 것 같다" 다 — 빨간 점이 아니라 **다음 행동이 있는 상태**로
  // 그린다(components/common/loadState 의 `failed`: 사유 + 재시도가 타입상 필수).
  // 재시도 = 정체 레인의 기존 retry(담당 재기동/재디스패치)와 같은 행동이므로
  // 아래 액션 바의 재시도 버튼은 STALE 에서 배너로 이동한다(같은 버튼 둘 금지).
  // 워치독이 오케에게 올리는 "조용하다" 신호와 같은 임계(agent-stall-policy)로
  // 같은 시각에 같은 카드가 여기로 온다.
  const staleState: FailedState | null =
    verdict?.kind === "STALE"
      ? {
          kind: "failed",
          title:
            verdict.idleMs !== undefined
              ? {
                  key: "board.stuck.stateTitle",
                  vars: { minutes: Math.floor(verdict.idleMs / 60_000) },
                }
              : "board.stuck.stateTitleNoClock",
          reasonCode: `board.stuck.reason.${verdict.staleReason ?? "no-progress"}`,
          retry: () => actions.retry(task),
        }
      : null;

  return (
    <div className="rounded-lg border border-gray-700/50">
      <TaskCard task={task} onClick={onTaskClick} />
      {staleState && (
        <div
          className="px-2 pt-1.5"
          data-testid="stuck-stale-state"
          onClick={(event) => event.stopPropagation()}
        >
          <StateBlock variant="banner" state={staleState} />
        </div>
      )}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {!staleState && (
          <StuckActionButton
            label={t("board.stuck.action.retry")}
            icon={<RotateCw className="h-3 w-3" />}
            running={busy === "retry"}
            disabled={disabled}
            tone="text-blue-300 hover:bg-blue-500/10"
            onClick={() => actions.retry(task)}
          />
        )}
        <StuckActionButton
          label={t("board.stuck.action.archive")}
          icon={<Archive className="h-3 w-3" />}
          running={busy === "archive"}
          disabled={disabled}
          tone="text-gray-300 hover:bg-gray-500/10"
          onClick={() => actions.archive(task)}
        />
        <StuckActionButton
          label={t("board.stuck.action.delete")}
          icon={<X className="h-3 w-3" />}
          running={busy === "delete"}
          disabled={disabled}
          tone="text-red-300 hover:bg-red-500/10"
          onClick={() => actions.softDelete(task)}
        />
      </div>
    </div>
  );
}

interface StuckActionButtonProps {
  label: string;
  icon: React.ReactNode;
  running: boolean;
  disabled: boolean;
  tone: string;
  onClick: () => void;
}

function StuckActionButton({
  label,
  icon,
  running,
  disabled,
  tone,
  onClick,
}: StuckActionButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        // 카드 자체의 onClick(상세 모달)이 같이 터지지 않게 막는다.
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      <span className={running ? "animate-spin" : ""}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
