import { useEffect, useState } from "react";
import { useTranslation, type TFunction } from "../../lib/i18n";
import {
  BEGINNER_BOARD_COLUMNS,
  beginnerBoardColumnFor,
  type BeginnerBoardColumn,
} from "../../lib/beginnerMode";
import { taskBodyParts } from "../../lib/taskBody";
import { subscribeToActivities } from "../../services/activityService";
import type { Activity } from "../../types/activity";
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
 * 일이 없어서, "저건 그림이구나" 로 읽혔다(사장님 시연 피드백 ②). 그래서 카드를
 * 눌리게 만들고, 이 창이 그 도착지가 됐다.
 *
 * ★그 다음 피드백이 이 파일의 현재 모양을 정했다(티켓 8s7W0hgy): 창은 열리는데
 * **내용이 없다**. 종전 판은 제목·상태칩·description·진행 3단계·담당자·물어보기
 * 버튼이 전부라, 보드에서 열던 상세(목표·변경·완료기준·범위·선행 일감·진행 기록)에
 * 견주면 정보가 빠진 축소뷰였다. 사장님 지시는 "기존 모달처럼" 이다.
 *
 * 그렇다고 어드밴스드 `TaskDetailModal` 을 그대로 띄우지는 않는다. 거기에는
 * 워크트리 pill, diff 진입, PR 링크, 모델 스탬프, 상태 머신 7칸, 편집·삭제 폼이
 * 함께 들어 있고 — 그것들은 이 티켓이 요구한 "상세" 목록에 없다. 심플 모드의
 * 차별점이 정확히 그 손잡이들을 **안 보여주는 것**이라, 카드를 누른 순간 전부
 * 쏟아지면 심플 모드는 그 자리에서 무너진다.
 *
 * 그래서 규칙은 이렇게 갈린다:
 *
 *   **정보는 표준과 같게** — 목표/변경·접근/완료 기준/제약(구조화 본문은
 *   `lib/taskBody` 규칙을 어드밴스드와 **공유**한다), 손대는 곳(scope),
 *   먼저 끝나야 하는 일(dependsOn), 메모(comment), 그리고 진행 기록(활동로그).
 *
 *   **손잡이는 하나만** — 상태를 옮기거나 재배정·삭제하는 버튼은 없다. 심플
 *   모드의 조작 모델은 "말로 시킨다" 하나여야 한다. 기존 '진행상황 물어보기'는
 *   그대로 남아, 상세를 읽은 그 자리에서 오케에게 문장을 채워 준다.
 *
 * 진행 기록은 읽기 전용이다 — 어드밴스드 모달의 코멘트/PM 활동 입력칸은 여기
 * 없다. 티켓에 말을 거는 통로가 둘(모달 입력칸 / 대화창)이면 심플 모드가
 * 없애려던 종류의 선택이 다시 생긴다.
 */
export function BeginnerTaskModal({
  task,
  agents,
  tasks,
  onAsk,
  onClose,
}: {
  task: Task;
  agents: Agent[];
  /**
   * 현재 보고 있는 티켓 목록 — 선행 일감(dependsOn)의 **제목**을 찾는 데만 쓴다.
   * 비기너 화면에서 `a1b2c3d4...` 같은 id 조각은 아무 것도 말해 주지 않는다.
   * 못 찾으면 짧은 id 로 떨어진다(목록 밖에서 온 티켓·프리뷰 카드).
   */
  tasks?: readonly Task[];
  /** 상단 대화창에 문장을 채운다(보내지는 않는다). */
  onAsk: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<Activity[]>([]);

  // Esc 로 닫기. 모달을 겹겹이 띄우지 않는 화면이라 캡처 단계까지 갈 필요는 없다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 진행 기록 — 어드밴스드 모달과 **같은** 구독이다(services/activityService).
  // 구독이 실패해도 창은 열려 있어야 한다: 기록 한 칸이 비는 것과 상세 전체가
  // 안 뜨는 것은 사용자에게 전혀 다른 사건이다.
  useEffect(() => {
    setActivities([]);
    try {
      return subscribeToActivities(task.id, setActivities);
    } catch {
      return undefined;
    }
  }, [task.id]);

  const column = beginnerBoardColumnFor(task.status);
  const stuck = task.status === "BLOCKED" || task.status === "FAILED";
  const owner = agents.find((a) => a.currentTaskId === task.id) ?? null;
  const body = taskBodyParts(task);
  const scope = (task.scope ?? []).filter((s) => s.trim().length > 0);
  const dependsOn = task.dependsOn ?? [];

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
        // ★상세가 다 들어오면서 창이 화면보다 길어질 수 있다. 바깥에서 잘리면
        //  "왜 중간에 끊기지" 가 되므로 높이를 묶고 **본문만** 스크롤한다 —
        //  물어보기/닫기는 아래에 고정돼 언제든 손이 닿는다.
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-[#45475a] bg-[#181825] shadow-2xl"
      >
        {/* ── 머리 — 무슨 일인가 ──────────────────────────────────────────
            ★이 화면이 무엇인지 먼저 말한다. 재시연에서 사장님은 카드를 누르고
            열린 이 창을 "티켓 상세" 가 아니라 "물어보기 창" 으로 읽으셨다 —
            제목 한 줄과 큰 파란 버튼만 눈에 들어오면 그렇게 읽힌다. 눈썹 라벨과
            아래 진행 스텝이 "여기는 그 일감의 상태를 보는 곳" 이라고 못박는다. */}
        <div className="flex-shrink-0 px-6 pb-4 pt-6">
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
                    index === current
                      ? "current"
                      : passed
                        ? "passed"
                        : "upcoming"
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
        </div>

        {/* ── 본문 — 여기서부터가 "기존 모달처럼" 이다 ──────────────────── */}
        <div
          data-testid="beginner-task-modal-body"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-[#313244] px-6 py-4"
        >
          {/* 목표·변경·완료기준·제약. 구조화 섹션이 없으면 description 을
              그대로(어드밴스드 `TaskBodySections` 와 **같은** 규칙). */}
          {body.structured ? (
            <>
              {body.goal && (
                <DetailSection title={t("board.section.goal")}>
                  <p
                    data-testid="beginner-task-modal-goal"
                    className="whitespace-pre-wrap text-xs leading-5 text-[#cdd6f4]"
                  >
                    {body.goal}
                  </p>
                </DetailSection>
              )}
              {body.changes.length > 0 && (
                <DetailSection title={t("board.section.changes")}>
                  <ul
                    data-testid="beginner-task-modal-changes"
                    className="space-y-1 text-xs leading-5 text-[#a6adc8]"
                  >
                    {body.changes.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="text-[#6c7086]">
                          •
                        </span>
                        <span className="min-w-0">{c}</span>
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
              {body.acceptance.length > 0 && (
                <DetailSection title={t("board.section.acceptance")}>
                  <ul
                    data-testid="beginner-task-modal-acceptance"
                    className="space-y-1 text-xs leading-5 text-[#a6adc8]"
                  >
                    {body.acceptance.map((a, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="text-[#6c7086]">
                          ☐
                        </span>
                        <span className="min-w-0">{a}</span>
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
              {body.notes.length > 0 && (
                <DetailSection title={t("board.section.notes")}>
                  <ul
                    data-testid="beginner-task-modal-notes"
                    className="space-y-1 text-xs leading-5 text-[#7f849c]"
                  >
                    {body.notes.map((n, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="text-[#6c7086]">
                          •
                        </span>
                        <span className="min-w-0">{n}</span>
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
            </>
          ) : (
            body.description && (
              <DetailSection title={t("beginner.taskDetail.description")}>
                <p
                  data-testid="beginner-task-modal-description"
                  className="whitespace-pre-wrap text-xs leading-5 text-[#a6adc8]"
                >
                  {body.description}
                </p>
              </DetailSection>
            )
          )}

          {/* 손대는 곳 — 어드밴스드의 Scope. 파일 경로라 심플 모드에서도 그대로
              보여준다: "무엇이 바뀌는지" 를 대신 말해 줄 더 쉬운 말이 없다. */}
          {scope.length > 0 && (
            <DetailSection title={t("beginner.taskDetail.scope")}>
              <div
                data-testid="beginner-task-modal-scope"
                className="flex flex-wrap gap-1"
              >
                {scope.map((s) => (
                  <span
                    key={s}
                    className="rounded border border-[#89b4fa]/20 bg-[#89b4fa]/10 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-[#89b4fa]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </DetailSection>
          )}

          {/* 먼저 끝나야 하는 일 — id 가 아니라 **제목**으로 (위 prop 주석). */}
          {dependsOn.length > 0 && (
            <DetailSection title={t("beginner.taskDetail.dependsOn")}>
              <ul
                data-testid="beginner-task-modal-depends"
                className="space-y-1 text-xs leading-5 text-[#a6adc8]"
              >
                {dependsOn.map((depId) => {
                  const dep = tasks?.find((x) => x.id === depId) ?? null;
                  return (
                    <li key={depId} className="flex gap-2" data-dep-id={depId}>
                      <span aria-hidden className="text-[#6c7086]">
                        ↳
                      </span>
                      <span className="min-w-0">
                        {dep ? dep.title : depId.slice(0, 8)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p
                data-testid="beginner-task-modal-depends-state"
                className={`mt-1.5 text-[11px] leading-4 ${
                  task.dependsOnCompleted ? "text-[#a6e3a1]" : "text-[#f9e2af]"
                }`}
              >
                {t(
                  task.dependsOnCompleted
                    ? "beginner.taskDetail.depsReady"
                    : "beginner.taskDetail.depsWaiting",
                )}
              </p>
            </DetailSection>
          )}

          {/* 메모 — 상태를 바꾼 쪽이 남긴 한 줄(차단 사유 등). */}
          {task.comment && (
            <DetailSection title={t("beginner.taskDetail.note")}>
              <p
                data-testid="beginner-task-modal-comment"
                className="whitespace-pre-wrap rounded-md bg-[#1e1e2e] px-3 py-2 text-xs leading-5 text-[#a6adc8]"
              >
                {task.comment}
              </p>
            </DetailSection>
          )}

          {/* 진행 기록 — 읽기 전용(위 파일 주석). 최신이 아래로 쌓이는 건
              어드밴스드와 같은 정렬이다(activityService 가 오름차순으로 준다). */}
          <DetailSection title={t("beginner.taskDetail.activity")}>
            {activities.length === 0 ? (
              <p
                data-testid="beginner-task-modal-activity-empty"
                className="text-xs leading-5 text-[#6c7086]"
              >
                {t("beginner.taskDetail.activityEmpty")}
              </p>
            ) : (
              <ul
                data-testid="beginner-task-modal-activity"
                className="space-y-1.5"
              >
                {activities.map((act) => (
                  <li
                    key={act.id}
                    className="rounded-md border-l-2 border-[#45475a] bg-[#1e1e2e] px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-[11px] font-medium text-[#89b4fa]">
                        {act.agentId}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[#6c7086]">
                        {relativeTime(act.createdAt, t)}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-[#a6adc8]">
                      {act.message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
        </div>

        {/* ── 발 — 유일한 액션은 여전히 "말로 시킨다" ───────────────────── */}
        <div className="flex flex-shrink-0 flex-col gap-2 border-t border-[#313244] px-6 py-4">
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

/**
 * 상세 한 블록 — 눈썹 라벨 + 내용. 섹션마다 제목 크기·여백을 따로 들면 상세가
 * 길어질수록 화면이 성겨진다(비기너 셸이 `beginnerUi` 를 둔 것과 같은 이유).
 */
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section data-section={title}>
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/**
 * 진행 기록의 시각. 심플 모드에서 절대 시각(2026-08-13 14:02)은 읽는 부담만
 * 늘린다 — 유저가 알고 싶은 건 "방금인가, 어제인가" 다.
 */
function relativeTime(date: Date, t: TFunction): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t("beginner.taskDetail.time.justNow");
  if (minutes < 60)
    return t("beginner.taskDetail.time.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("beginner.taskDetail.time.hoursAgo", { n: hours });
  return t("beginner.taskDetail.time.daysAgo", { n: Math.floor(hours / 24) });
}
