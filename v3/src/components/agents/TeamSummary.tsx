import type { Agent, AgentStatus } from "../../types/agent";
import type { Task } from "../../types/task";
import { useTranslation } from "../../lib/i18n";

interface TeamSummaryProps {
  agents: Agent[];
  tasks: Task[];
  /**
   * ★경량 렌더. 비기너 모드의 미니 에이전트 뷰가 이 컴포넌트를 **그대로**
   * 재사용한다(중복 구현 금지).
   *
   * 도넛은 작아지고, 티켓 통계 블록은 통째로 빠진다 — 비기너 화면에서는 바로
   * 옆 미니 보드가 이미 티켓 흐름을 그리고 있어서 같은 숫자를 두 번 말하게
   * 된다. 여기 남는 질문은 하나다: "몇 명이 붙어 있고 지금 일하는 중인가."
   *
   * ★compact 는 자기 테두리·배경을 갖지 않는다. 이 뷰는 이미 라이브 패널
   * **안**의 한 블록이라, 카드 안에 카드를 또 그리면(중첩 상자) 화면이 곧바로
   * 성기고 크루드해진다 — 구분은 패널의 헤어라인이 이미 하고 있다.
   */
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; bg: string }
> = {
  working: { label: "Active", color: "text-green-400", bg: "bg-green-500" },
  idle: { label: "Idle", color: "text-yellow-400", bg: "bg-yellow-500" },
  error: { label: "Error", color: "text-red-400", bg: "bg-red-500" },
  stopped: { label: "Stopped", color: "text-gray-500", bg: "bg-gray-600" },
};

export default function TeamSummary({
  agents,
  tasks,
  compact,
}: TeamSummaryProps) {
  const { t } = useTranslation();
  const statusCounts: Record<AgentStatus, number> = {
    working: 0,
    idle: 0,
    error: 0,
    stopped: 0,
  };
  for (const agent of agents) {
    statusCounts[agent.status]++;
  }

  const doneTasks = tasks.filter((t) => t.status === "DONE").length;
  const inProgressTasks = tasks.filter(
    (t) => t.status === "IN_PROGRESS" || t.status === "CLAIMED",
  ).length;

  // Donut chart data
  const total = agents.length || 1;
  const segments = (["working", "idle", "error", "stopped"] as AgentStatus[])
    .filter((s) => statusCounts[s] > 0)
    .map((s) => ({
      status: s,
      count: statusCounts[s],
      pct: (statusCounts[s] / total) * 100,
      ...STATUS_CONFIG[s],
    }));

  let cumulativePct = 0;
  const donutSegments = segments.map((seg) => {
    const offset = cumulativePct;
    cumulativePct += seg.pct;
    return { ...seg, offset };
  });

  // compact 는 0 인 상태를 지운다. "오류 0 / 중지 0" 을 항상 띄우면 처음 쓰는
  // 사람에게는 아무 일도 없는데 오류 항목이 보이는 화면이 된다.
  const visibleStatuses = (
    ["working", "idle", "error", "stopped"] as AgentStatus[]
  ).filter((s) => !compact || statusCounts[s] > 0);

  return (
    <div
      data-testid={compact ? "beginner-mini-agents" : "team-summary"}
      className={
        compact ? "" : "rounded-lg border border-gray-700 bg-gray-800 p-4"
      }
    >
      <div className={`flex items-center ${compact ? "gap-3" : "gap-6"}`}>
        {/* Donut Chart */}
        <div
          className={`relative shrink-0 ${compact ? "h-10 w-10" : "h-20 w-20"}`}
        >
          <svg
            viewBox="0 0 36 36"
            className={`-rotate-90 ${compact ? "h-10 w-10" : "h-20 w-20"}`}
          >
            {agents.length === 0 ? (
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke={compact ? "#313244" : "#374151"}
                strokeWidth="4"
              />
            ) : (
              donutSegments.map((seg) => (
                <circle
                  key={seg.status}
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke={seg.bg.replace("bg-", "")}
                  strokeWidth="4"
                  strokeDasharray={`${seg.pct * 0.88} ${88 - seg.pct * 0.88}`}
                  strokeDashoffset={`${-seg.offset * 0.88}`}
                  className={seg.bg.replace("bg-", "stroke-")}
                />
              ))
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`font-bold ${compact ? "text-xs leading-none tabular-nums text-[#cdd6f4]" : "text-lg text-gray-100"}`}
            >
              {agents.length}
            </span>
            <span
              className={
                compact
                  ? "text-[8px] leading-none text-[#6c7086]"
                  : "text-[10px] text-gray-500"
              }
            >
              {compact ? t("agents.summary.unit") : "agents"}
            </span>
          </div>
        </div>

        {/* Status Breakdown */}
        <div
          className={
            compact
              ? "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
              : "grid grid-cols-2 gap-x-6 gap-y-2"
          }
        >
          {visibleStatuses.map((status) => (
            <div key={status} className="flex items-center gap-1.5">
              <div
                className={`rounded-full ${compact ? "h-1.5 w-1.5" : "h-2.5 w-2.5"} ${STATUS_CONFIG[status].bg}`}
              />
              <span
                className={
                  compact
                    ? "text-xs font-medium tabular-nums text-[#cdd6f4]"
                    : `text-sm ${STATUS_CONFIG[status].color}`
                }
              >
                {statusCounts[status]}
              </span>
              <span
                className={
                  compact
                    ? "text-[11px] text-[#7f849c]"
                    : "text-xs text-gray-500"
                }
              >
                {compact
                  ? t(`agents.status.${status}`)
                  : STATUS_CONFIG[status].label}
              </span>
            </div>
          ))}
          {/* 에이전트가 아직 하나도 없을 때: compact 는 항목이 전부 걸러져
              빈 칸이 되므로 한 줄로 설명한다(아직 아무도 안 붙었다는 것도
              정보다). */}
          {compact && visibleStatuses.length === 0 && (
            <span className="text-[11px] text-[#7f849c]">
              {t("agents.summary.none")}
            </span>
          )}
        </div>

        {/* Separator */}
        {!compact && <div className="h-14 w-px bg-gray-700" />}

        {/* Task Stats — compact 에서는 아예 렌더하지 않는다. 바로 옆 미니 보드가
            같은 숫자를 이미 그리고 있어서, 감추기만 하면(display:none) 스크린
            리더에는 안 들려도 DOM 에는 남아 중복 소스가 된다. */}
        {!compact && (
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-xl font-bold text-blue-400">
                {inProgressTasks}
              </div>
              <div className="text-xs text-gray-500">
                {t("agents.stats.inProgress")}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-400">
                {doneTasks}
              </div>
              <div className="text-xs text-gray-500">
                {t("agents.stats.done")}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-400">
                {tasks.length}
              </div>
              <div className="text-xs text-gray-500">
                {t("agents.summary.totalTasks")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
