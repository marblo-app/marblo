import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  BEGINNER_BOARD_COLUMNS,
  beginnerBoardColumnFor,
  type BeginnerBoardColumn,
} from "../../lib/beginnerMode";
import type { Agent } from "../../types/agent";
import type { Task } from "../../types/task";
import { BEGINNER_ROLE_ICON, SectionLabel } from "./beginnerUi";

const COLUMN_LABEL_KEY: Record<
  BeginnerBoardColumn,
  "beginner.board.todo" | "beginner.board.doing" | "beginner.board.done"
> = {
  todo: "beginner.board.todo",
  doing: "beginner.board.doing",
  done: "beginner.board.done",
};

/**
 * 미니 보드 티켓 상세 — 비기너 판.
 *
 * 미니 보드는 지금까지 **정적**이었다. 카드가 움직이는 건 보이는데 눌러도 아무
 * 일이 없어서, "저건 그림이구나" 로 읽혔다(사장님 시연 피드백 ②). 그렇다고
 * 어드밴스드 `TaskDetailModal` 을 그대로 띄울 수는 없다 — 거기에는 워크트리 pill,
 * diff 진입, PR 링크, 모델 스탬프, 상태 머신 7칸이 다 들어 있다. 비기너 화면의
 * 차별점이 정확히 그것들을 **안 보여주는 것**이라, 카드를 누른 순간 그 전부가
 * 쏟아지면 심플 모드는 그 자리에서 무너진다.
 *
 * 그래서 이 모달이 답하는 건 셋뿐이다:
 *
 *   1. 이건 무슨 일인가 (제목 + 요청 내용)
 *   2. 지금 어디까지 왔나 (할 일 / 진행 중 / 완료, 그리고 막혔는가)
 *   3. 누가 붙어 있나 (역할 — 모델명이 아니라)
 *
 * 그리고 유일한 액션은 **오케에게 말 거는 것**이다. 비기너에게 티켓을 직접
 * 옮기거나 재배정하는 손잡이를 주면 그건 이미 보드 사용법이고, 심플 모드의
 * 조작 모델은 하나여야 한다 — "말로 시킨다". 버튼을 누르면 상단 대화창이 그
 * 티켓에 대한 문장으로 채워지고(전송은 유저가 누른다) 모달이 닫힌다.
 */
export function BeginnerTaskModal({
  task,
  agents,
  onAsk,
  onClose,
}: {
  task: Task;
  agents: Agent[];
  /** 상단 대화창에 문장을 채운다(보내지는 않는다). */
  onAsk: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Esc 로 닫기. 모달을 겹겹이 띄우지 않는 화면이라 캡처 단계까지 갈 필요는 없다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const column = beginnerBoardColumnFor(task.status);
  const stuck = task.status === "BLOCKED" || task.status === "FAILED";
  const owner = agents.find((a) => a.currentTaskId === task.id) ?? null;

  const statusLabel = t(
    column === "done"
      ? "beginner.board.done"
      : column === "todo"
        ? "beginner.board.todo"
        : "beginner.board.doing",
  );

  // 물어볼 문장은 국면마다 다르다. 막힌 티켓에 "어떻게 돼가?" 를 보내는 건
  // 이미 화면이 답한 걸 다시 묻는 것이고, 유저가 실제로 알고 싶은 건 "왜 멈췄고
  // 내가 뭘 하면 되나" 다.
  const askKey = stuck
    ? "beginner.taskDetail.askStuck"
    : column === "done"
      ? "beginner.taskDetail.askDone"
      : "beginner.taskDetail.askProgress";
  const askLabelKey = stuck
    ? "beginner.taskDetail.askStuckCta"
    : column === "done"
      ? "beginner.taskDetail.askDoneCta"
      : "beginner.taskDetail.askProgressCta";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        data-testid="beginner-task-modal"
        data-task-id={task.id}
        data-task-status={task.status}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-[#45475a] bg-[#181825] p-6 shadow-2xl"
      >
        {/* ★이 화면이 무엇인지 먼저 말한다. 재시연에서 사장님은 카드를 누르고
            열린 이 창을 "티켓 상세" 가 아니라 "물어보기 창" 으로 읽으셨다 —
            제목 한 줄과 큰 파란 버튼만 눈에 들어오면 그렇게 읽힌다. 눈썹 라벨과
            아래 진행 스텝이 "여기는 그 일감의 상태를 보는 곳" 이라고 못박는다. */}
        <SectionLabel>{t("beginner.taskDetail.label")}</SectionLabel>

        <div className="mt-2 flex items-center gap-2">
          <span
            data-testid="beginner-task-modal-status"
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              column === "done"
                ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                : column === "todo"
                  ? "bg-[#89b4fa]/15 text-[#89b4fa]"
                  : "bg-[#cba6f7]/15 text-[#cba6f7]"
            }`}
          >
            {statusLabel}
          </span>
          {stuck && (
            <span className="rounded-full bg-[#f9e2af]/15 px-2 py-0.5 text-[11px] font-medium text-[#f9e2af]">
              ⚠ {t("board.taskCard.stuck")}
            </span>
          )}
        </div>

        <h2 className="mt-2.5 text-base font-semibold leading-6 text-[#cdd6f4]">
          {task.title}
        </h2>

        {task.description && (
          // 설명은 오케가 쓴 스펙이라 길 수 있다. 모달이 화면을 넘기지 않도록
          // 여기서 스크롤을 가둔다 — 잘라서 숨기면 "왜 중간에 끊기지" 가 된다.
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[#a6adc8]">
            {task.description}
          </p>
        )}

        {/* ── 진행 3단계 — "지금 어디까지 왔나" 를 한 눈에 ────────────────
            상태 칩 하나로는 "그래서 남은 게 뭔데" 가 안 읽힌다. 미니 보드의
            세 레인과 **같은 이름**을 쓴다 — 카드가 어느 칸에서 어느 칸으로
            넘어가는 중인지가 이 화면에서도 같은 말로 이어져야 한다. */}
        <ol
          data-testid="beginner-task-modal-steps"
          className="mt-4 flex items-center gap-1.5"
        >
          {BEGINNER_BOARD_COLUMNS.map((step) => {
            const index = BEGINNER_BOARD_COLUMNS.indexOf(step);
            const current = BEGINNER_BOARD_COLUMNS.indexOf(column);
            const passed = index <= current;
            return (
              <li
                key={step}
                data-step={step}
                data-step-state={
                  index === current ? "current" : passed ? "passed" : "upcoming"
                }
                className="flex min-w-0 flex-1 flex-col gap-1"
              >
                <span
                  aria-hidden
                  className={`h-1 rounded-full ${
                    passed
                      ? stuck && index === current
                        ? "bg-[#f9e2af]"
                        : "bg-[#89b4fa]"
                      : "bg-[#313244]"
                  }`}
                />
                <span
                  className={`truncate text-[10px] leading-4 ${
                    index === current ? "text-[#cdd6f4]" : "text-[#6c7086]"
                  }`}
                >
                  {t(COLUMN_LABEL_KEY[step])}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-3 flex items-center gap-1.5 text-xs leading-5 text-[#7f849c]">
          <span aria-hidden>{BEGINNER_ROLE_ICON[task.role] ?? "📋"}</span>
          {owner ? (
            <span data-testid="beginner-task-modal-owner">
              {t("beginner.taskDetail.owner", { name: owner.name })}
            </span>
          ) : (
            <span data-testid="beginner-task-modal-owner">
              {t("beginner.taskDetail.noOwner")}
            </span>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            data-testid="beginner-task-modal-ask"
            onClick={() => {
              onAsk(t(askKey, { title: task.title }));
              onClose();
            }}
            className="w-full rounded-md bg-[#89b4fa] px-3 py-2.5 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
          >
            {t(askLabelKey)}
          </button>
          <button
            type="button"
            data-testid="beginner-task-modal-close"
            onClick={onClose}
            className="w-full rounded-md border border-[#45475a] px-3 py-2 text-sm text-[#cdd6f4] transition-colors hover:bg-[#313244]"
          >
            {t("beginner.taskDetail.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
