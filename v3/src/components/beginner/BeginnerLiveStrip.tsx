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
import type { Task } from "../../types/task";
import { KanbanColumn } from "../board/KanbanColumn";
import { BLOCK, BUTTON_GHOST, SectionLabel } from "./beginnerUi";

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
 *      마블로의 핵심이라, 축소판이라도 첫날부터 보여 준다. ★카드는 누를 수
 *      있다(`onTaskClick`) — 움직이기만 하고 눌리지 않는 보드는 그림으로 읽힌다.
 *
 * ★2 는 새로 만든 컴포넌트가 아니다. 어드밴스드 보드의 `KanbanColumn` 을
 * `compact` 로 그대로 재사용한다 — 미니 보드가 자기만의 카드 렌더를 갖는 순간
 * 두 화면이 갈라지고, 갈라진 쪽은 반드시 낡는다.
 *
 * ★"누가 붙어 있나"(예전의 3층 미니 에이전트 뷰)는 이 스트립을 떠나
 * `BeginnerAgentsPane` 으로 갔다 — 하단 2분할의 오른쪽 열이다. 여기 두면 스트립이
 * 세로로 계속 자라 정작 대화창(이 화면의 주인공)을 아래로 밀어냈고, 요약만으로는
 * "누가 **뭘** 하나" 에 답하지 못했다.
 *
 * 추상화 수준은 여전히 낮게 유지한다: 워크트리·diff·모델명은 compact 프롭이
 * 걷어낸다. 비기너에게 정확한 해상도는 "일감이 움직인다" 이고, 세부는 승격 후
 * 보드에서 본다.
 */
export function BeginnerLiveStrip({
  sentAt,
  onResend,
  resending,
  onTaskClick,
}: {
  /** 마지막으로 오케에 **실제 전달**된 시각(ms). 0 = 아직 안 보냄. */
  sentAt: number;
  onResend: () => void;
  resending: boolean;
  /** 미니 보드 카드 클릭. 생략하면 카드가 눌리지 않는다(종전 동작). */
  onTaskClick?: (task: Task) => void;
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
      // ★한 장의 패널 안에서 블록을 헤어라인으로 나눈다. 예전엔 헤드라인·미니
      // 보드·미니 팀뷰가 각자 `mt-3` 로 떠 있어 경계가 없는 채로 벌어졌다 —
      // 그게 "성기다" 의 정체였다. divide-y 는 간격을 0 으로 줄이는 대신 줄을
      // 그어 위계를 만든다.
      className={`flex flex-col divide-y overflow-hidden rounded-lg border ${
        view.phase === "stalled"
          ? "divide-[#f9e2af]/25 border-[#f9e2af]/35 bg-[#f9e2af]/10"
          : "divide-[#313244] border-[#313244] bg-[#181825]"
      }`}
    >
      {/* ── 헤드라인 블록 ─────────────────────────────────────────────── */}
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

        {/* 막힘 안내 — 진단 §7 P1-2 ④. 90초가 지나도 티켓이 없으면 "기다리세요"
            로 방치하지 않고 다음 행동을 준다. */}
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

      {/* ── ★미니 보드 — 티켓이 하나라도 생긴 뒤에만. 티켓 0개일 때 빈 3칸을
          띄우면 "아무 일도 안 일어난다" 는 인상을 오히려 강화한다(그 국면의
          답은 위 헤드라인의 '읽는 중' 이다). ───────────────────────────── */}
      {view.totalTasks > 0 && (
        <div className={BLOCK}>
          <SectionLabel>{t("beginner.board.label")}</SectionLabel>
          {/* 세로 레인 셋. 상한(BEGINNER_COLUMN_LIMIT=4)이 있어도 세 레인이 다
              차면 12장이라, 챗을 화면 밖으로 밀지 않게 여기서 한 번 더 자른다.
              17rem 은 임의의 수가 아니다 — 흔한 국면(티켓 대여섯 건, 그중 막힌
              카드 하나 = 실측 244px)이 **잘리지 않고** 다 들어가는 높이다.
              그보다 낮게 잡으면 마지막 '완료' 레인이 반쯤 잘려 보이는데, 티켓이
              완료로 넘어가는 걸 보여 주는 게 이 화면의 목적이라 그 잘림은 특히
              나쁘다. 여기서 자리를 더 내줘도 되는 이유는 미니 보드가 뜨는
              시점에는 위 첫 요청 카드가 이미 한 줄로 접혀 있기 때문이다
              (보드 = 전달 후에만 생기는 티켓의 결과). */}
          <div
            data-testid="beginner-mini-board"
            className="mt-2 flex max-h-[17rem] flex-col gap-2 overflow-y-auto"
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
                onTaskClick={onTaskClick}
              />
            ))}
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
