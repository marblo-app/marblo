import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  summarizeBeginnerProgress,
  type BeginnerProgressView,
} from "../../lib/beginnerMode";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskStore } from "../../stores/taskStore";
import type { Agent } from "../../types/agent";
import type { Task } from "../../types/task";
import { KanbanBoard } from "../board/KanbanBoard";
import { BLOCK, BUTTON_GHOST, SectionLabel } from "./beginnerUi";

/**
 * ★S4 해결 표면 — 챗 **안**의 라이브.
 *
 * 종전은 3단계 세로 미니보드(할 일/진행 중/완료)였지만, 사장님 피드백으로
 * **마블로 모드 Board(`KanbanBoard`)를 그대로** 얹는다 — 5단계 칸반
 * (TODO·CLAIMED·IN_PROGRESS·REVIEW·DONE) + 그래프 토글. 보기는 마블로와
 * 같고, 조작만 `simplified`/`compactCards` 로 줄인다(중복 보드 구현 금지).
 *
 * 헤드라인(thinking/stalled/working)은 그대로 둔다 — 보드가 채워지기 전
 * "아무 일도 안 일어난다" 를 막는 S4 계약이다.
 */
export function BeginnerLiveStrip({
  sentAt,
  onResend,
  resending,
  onTaskClick,
  showWorktreeDiff,
  onAgentClick,
}: {
  /** 마지막으로 오케에 **실제 전달**된 시각(ms). 0 = 아직 안 보냄. */
  sentAt: number;
  onResend: () => void;
  resending: boolean;
  /** 보드 카드 클릭 → 비기너 티켓 상세 모달. */
  onTaskClick?: (task: Task) => void;
  showWorktreeDiff?: boolean;
  onAgentClick?: (agent: Agent) => void;
}) {
  const { t } = useTranslation();
  const tasks = useTaskStore((s) => s.tasks);
  const agents = useAgentStore((s) => s.agents);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sentAt <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [sentAt]);

  const view: BeginnerProgressView = useMemo(
    () =>
      summarizeBeginnerProgress({
        sentAt,
        now,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((task) => task.status === "DONE").length,
        workingAgents: agents.filter((a) => a.status === "working").length,
      }),
    [sentAt, now, tasks, agents],
  );

  if (view.phase === "idle") return null;

  const headline =
    view.phase === "thinking"
      ? t("beginner.live.thinking")
      : view.phase === "stalled"
        ? t("beginner.live.stalled")
        : view.phase === "working"
          ? t("beginner.live.working", { count: view.workingAgents })
          : view.phase === "completed"
            ? t("beginner.live.completed", { count: view.completedTasks })
            : t("beginner.live.planned", { count: view.totalTasks });

  return (
    <section
      data-testid="beginner-live-strip"
      data-phase={view.phase}
      className={`flex min-h-0 flex-1 flex-col divide-y overflow-hidden rounded-lg border ${
        view.phase === "stalled"
          ? "divide-[#f9e2af]/25 border-[#f9e2af]/35 bg-[#f9e2af]/10"
          : "divide-[#313244] border-[#313244] bg-[#181825]"
      }`}
    >
      <div className={BLOCK}>
        <SectionLabel
          trailing={
            view.totalTasks > 0 ? (
              <span data-testid="beginner-live-counts">
                {t("beginner.live.progress", {
                  done: view.completedTasks,
                  total: view.totalTasks,
                })}
              </span>
            ) : null
          }
        >
          {t("beginner.live.label")}
        </SectionLabel>

        <p className="mt-1.5 flex items-center gap-2 text-sm font-medium leading-5 text-[#cdd6f4]">
          <Pulse phase={view.phase} />
          {headline}
        </p>

        {view.showStallHelp && (
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs leading-5 text-[#a6adc8]">
              {t("beginner.live.stalledHelp")}
            </p>
            <button
              type="button"
              data-testid="beginner-live-resend"
              onClick={onResend}
              disabled={resending}
              className={BUTTON_GHOST}
            >
              {resending ? t("beginner.ask.sending") : t("beginner.ask.resend")}
            </button>
          </div>
        )}
      </div>

      {/* ★마블로 Board 그대로 — 5단계 칸반 + 그래프. 옛 3열 미니보드 제거. */}
      <div
        data-testid="beginner-mini-board"
        className="min-h-0 flex-1 overflow-hidden"
      >
        <KanbanBoard
          simplified
          compactCards
          onTaskClick={onTaskClick}
          showWorktreeDiff={showWorktreeDiff}
          onAgentClick={onAgentClick}
        />
      </div>
    </section>
  );
}

function Pulse({ phase }: { phase: BeginnerProgressView["phase"] }) {
  const color =
    phase === "completed"
      ? "bg-[#a6e3a1]"
      : phase === "stalled"
        ? "bg-[#f9e2af]"
        : "bg-[#89b4fa]";
  const animate =
    phase === "thinking" || phase === "working" ? "animate-pulse" : "";
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-full ${color} ${animate}`}
    />
  );
}
