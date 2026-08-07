import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  groupBeginnerBoard,
  summarizeBeginnerProgress,
  type BeginnerBoardColumn,
  type BeginnerProgressView,
} from "../../lib/beginnerMode";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskStore } from "../../stores/taskStore";
import { KanbanColumn } from "../board/KanbanColumn";
import TeamSummary from "../agents/TeamSummary";

/**
 * ★S4 해결 표면 — 챗 **안**의 미니 라이브.
 *
 * 활성화 진단 §S4 가 관측한 유일한 실 dead-end 는 "첫 티켓이 성공적으로 전달됐는데
 * 화면에서 아무 일도 일어나지 않음" 이었다(같은 버튼 14초 간격 3연타 → 이탈).
 * 근인 중 하나는 오케가 일하는 곳(터미널·보드)이 그 화면에 아예 없었다는 것이다.
 *
 * 그래서 이 컴포넌트는 **유저를 다른 탭으로 보내지 않는다.** 대화창 바로 위에서
 * 지금 오케/에이전트가 뭘 하고 있는지 말한다. 세 층이다:
 *
 *   1. 한 줄 헤드라인 — 국면 판정은 순수함수
 *      (`lib/beginnerMode.summarizeBeginnerProgress`)에 있고 여기서는 스토어를
 *      물려 그리기만 한다. 라이브 확인이 실계정을 요구하는 구간이라 규칙은
 *      유닛테스트로 못박아야 한다.
 *   2. ★미니 보드 — 티켓이 할 일 → 진행 중 → 완료로 **움직이는 것**. 보드는
 *      마블로의 핵심이라, 축소판이라도 첫날부터 보여 준다.
 *   3. ★미니 에이전트 뷰 — 몇 명이 붙어 있고 지금 일하는 중인가.
 *
 * ★2·3 은 새로 만든 컴포넌트가 아니다. 어드밴스드 보드의 `KanbanColumn` 과
 * 에이전트 탭의 `TeamSummary` 를 `compact` 로 그대로 재사용한다 — 미니 보드가
 * 자기만의 카드 렌더를 갖는 순간 두 화면이 갈라지고, 갈라진 쪽은 반드시 낡는다.
 *
 * 추상화 수준은 여전히 낮게 유지한다: 워크트리·diff·모델명·담당 에이전트 이름은
 * compact 프롭이 걷어낸다. 비기너에게 정확한 해상도는 "일감이 움직인다 / 누가
 * 붙어 있다" 이고, 세부는 승격 후 보드에서 본다.
 */
export function BeginnerLiveStrip({
  sentAt,
  onResend,
  resending,
}: {
  /** 마지막으로 오케에 **실제 전달**된 시각(ms). 0 = 아직 안 보냄. */
  sentAt: number;
  onResend: () => void;
  resending: boolean;
}) {
  const { t } = useTranslation();
  const tasks = useTaskStore((s) => s.tasks);
  const agents = useAgentStore((s) => s.agents);

  // `thinking → stalled` 는 시간이 흘러야 일어나는 전이라, 스토어 변화만으로는
  // 절대 다시 렌더되지 않는다(티켓이 0개면 tasks 도 안 바뀐다). 보낸 뒤에만 도는
  // 5초 틱이 그 전이를 깨운다 — 안 보낸 상태에선 타이머를 아예 걸지 않는다.
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

  const columns = useMemo(() => groupBeginnerBoard(tasks), [tasks]);

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
      className={`rounded-lg border px-4 py-3 ${
        view.phase === "stalled"
          ? "border-[#f9e2af]/35 bg-[#f9e2af]/10"
          : "border-[#313244] bg-[#181825]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7f849c]">
          {t("beginner.live.label")}
        </span>

        <span className="flex items-center gap-2 text-sm font-medium text-[#cdd6f4]">
          <Pulse phase={view.phase} />
          {headline}
        </span>

        {view.totalTasks > 0 && (
          <span
            data-testid="beginner-live-counts"
            className="text-xs text-[#a6adc8]"
          >
            {t("beginner.live.progress", {
              done: view.completedTasks,
              total: view.totalTasks,
            })}
          </span>
        )}
      </div>

      {/* 막힘 안내 — 진단 §7 P1-2 ④. 90초가 지나도 티켓이 없으면 "기다리세요" 로
          방치하지 않고 다음 행동을 준다. */}
      {view.showStallHelp && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-[#a6adc8]">
            {t("beginner.live.stalledHelp")}
          </p>
          <button
            type="button"
            data-testid="beginner-live-resend"
            onClick={onResend}
            disabled={resending}
            className="shrink-0 rounded-md border border-[#45475a] px-2.5 py-1 text-xs font-medium text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-60"
          >
            {resending ? t("beginner.ask.sending") : t("beginner.ask.resend")}
          </button>
        </div>
      )}

      {/* ★미니 보드 — 티켓이 하나라도 생긴 뒤에만. 티켓 0개일 때 빈 3칸을 띄우면
          "아무 일도 안 일어난다" 는 인상을 오히려 강화한다(그 국면의 답은 위
          헤드라인의 '읽는 중' 이다). */}
      {view.totalTasks > 0 && (
        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7f849c]">
            {t("beginner.board.label")}
          </span>
          <div
            data-testid="beginner-mini-board"
            className="mt-1.5 flex max-h-40 gap-2"
          >
            {columns.map((col) => (
              <KanbanColumn
                key={col.column}
                compact
                status={col.status}
                label={t(COLUMN_LABEL_KEY[col.column])}
                tasks={col.tasks}
                count={col.total}
                hiddenCount={col.hiddenCount}
              />
            ))}
          </div>
        </div>
      )}

      {/* ★미니 에이전트 뷰 — 에이전트가 실제로 붙은 뒤에만. */}
      {agents.length > 0 && (
        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7f849c]">
            {t("beginner.agents.label")}
          </span>
          <div className="mt-1.5">
            <TeamSummary compact agents={agents} tasks={tasks} />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 압축 컬럼 → 라벨 키. 어드밴스드 보드의 영문 상태명(TODO/IN PROGRESS/DONE)을
 * 그대로 쓰지 않는 이유는, 그것들이 상태 머신의 이름이지 사람 말이 아니라서다.
 */
const COLUMN_LABEL_KEY: Record<
  BeginnerBoardColumn,
  "beginner.board.todo" | "beginner.board.doing" | "beginner.board.done"
> = {
  todo: "beginner.board.todo",
  doing: "beginner.board.doing",
  done: "beginner.board.done",
};

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
