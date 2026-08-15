import { useCallback, useEffect, useMemo, useState } from "react";
import { closePlanFor } from "../../lib/agentEntryClose";
import { useTranslation } from "../../lib/i18n";
import type { Agent, AgentStatus } from "../../types/agent";
import type { Task } from "../../types/task";
import TeamSummary from "../agents/TeamSummary";
import { CloseConfirmModal } from "../agents/list-panel/CloseConfirmModal";
import { BEGINNER_ROLE_ICON, SectionLabel } from "./beginnerUi";

/** 에이전트 목록에서 오케스트레이터를 뺀다 — 어드밴스드 AgentListPanel 과 동일. */
function isWorkerAgent(agent: Agent): boolean {
  return agent.role !== "orchestrator";
}

/**
 * ★미니 에이전트 탭 — 하단 2분할의 오른쪽 열.
 *
 * 예전에는 라이브 스트립 **안**에 `TeamSummary compact` 한 덩이(도넛 + 상태
 * 개수)만 있었다. "몇 명이 붙었나" 까지는 말해 주지만 사장님이 시연에서 물은
 * 건 그 다음이다 — **누가 뭘 하고 있나.** 그래서 요약 아래에 에이전트별 한 줄을
 * 깐다: 역할 아이콘 / 이름 / 지금 상태 / 지금 붙은 티켓.
 *
 * 요약 덩이는 새로 그리지 않고 어드밴스드 에이전트 탭의 `TeamSummary` 를
 * `compact` 로 그대로 재사용한다(중복 구현 금지) — 미니 뷰가 자기 계산을 갖는
 * 순간 두 화면의 숫자가 갈라진다.
 *
 * ★추상화 수준은 유지한다: 모델명·하네스 버전·세션 id·비용은 그리지 않는다.
 * 그건 승격 후 에이전트 탭에서 배우는 것이고, 비기너에게 정확한 해상도는
 * "누가, 무슨 일에, 지금 붙어 있나" 딱 셋이다. 티켓 줄을 누르면 미니 보드의
 * 카드를 누른 것과 **같은** 상세가 열린다 — 두 입구가 한 곳으로 모여야 한다.
 *
 * ★행 자체를 누르면 그 에이전트의 **터미널**이 열린다(`onAgentClick`). 시연에서
 * 사장님이 에이전트를 누르셨을 때 아무 일도 없던 자리다 — 상태 점까지 보여
 * 놓고 "그래서 지금 뭐 하는데?" 에 답하지 않으면, 이 패널도 미니 보드가 그랬듯
 * 그림으로 읽힌다. 한 행 안에 목적지가 둘(행=터미널 / 티켓 줄=티켓 상세)이라
 * 티켓 줄은 클릭을 **삼킨다**(stopPropagation) — 안 그러면 티켓을 누를 때마다
 * 터미널이 함께 열린다.
 *
 * ★그 위에 행마다 두 개의 작은 액션이 붙는다 — **작업 화면**(터미널)과
 * **끄기**(X). 종전엔 "눌러서 보기" 라는 안내 한 줄만 있었는데, 그건 문으로
 * 읽히지 않았고(사장님 테스트에서 그대로 재현) 무엇보다 **끌 방법이 아예 없었다**
 * — 심플 모드에는 어드밴스드의 에이전트 목록이 없으니, 한 번 붙은 팀원은 이
 * 화면에서 영원히 남는다. 안내 문구 자리를 액션 줄로 바꾸므로 줄 수는 그대로다
 * (과밀 금지).
 *
 * ★두 액션 모두 **새 로직이 아니다**:
 *   - 작업 화면 = 행 클릭과 같은 `onAgentClick` → 셸의 터미널 모달(어드밴스드와
 *     같은 PTY 세션을 문다).
 *   - 끄기 = `lib/agentEntryClose` 의 `closePlanFor` 판정 + 어드밴스드 목록과
 *     **같은** `CloseConfirmModal`. 실제 자원 회수(agent:stop → agent:remove →
 *     문서 삭제 → PTY/세션 회수)는 셸이 넘겨 주는 `onAgentKill` 이 든다 — 이
 *     패널은 스토어를 직접 만지지 않는다(순수 프레젠테이션 유지).
 * 작업 중(working) 팀원만 확인 모달을 거친다. idle/stopped 까지 확인을 받으면
 * 정리하려는 사람에게 매번 모달을 되던지는 꼴이다.
 */
export function BeginnerAgentsPane({
  agents,
  tasks,
  onTaskClick,
  onAgentClick,
  onAgentKill,
}: {
  agents: Agent[];
  tasks: Task[];
  /** 에이전트가 붙은 티켓을 눌렀을 때. 생략하면 줄이 클릭 불가가 된다. */
  onTaskClick?: (task: Task) => void;
  /** 에이전트 행/작업 화면 버튼을 눌렀을 때(터미널 열기). 생략하면 행이 클릭 불가가 된다. */
  onAgentClick?: (agent: Agent) => void;
  /**
   * 끄기(X) 확정 시 실제 회수를 수행한다. 생략하면 끄기 버튼이 그려지지 않는다
   * — 없는 문을 그려 놓는 것보다 낫다.
   */
  onAgentKill?: (agent: Agent) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  // ★오케는 대화창이 전담. 여기 리스트에 섞이면 팀원처럼 보이고 끄기/터미널
  // 대상이 된다 — role 로 걸러 워커만 남긴다(AgentListPanel 과 같은 규칙).
  const workerAgents = useMemo(() => agents.filter(isWorkerAgent), [agents]);
  // 확인이 필요한 끄기는 여기서 대기한다(작업 중 팀원). 대상은 객체로 든다 —
  // 모달 문구에 이름이 들어가야 해서다.
  const [pendingKill, setPendingKill] = useState<Agent | null>(null);
  const [killingIds, setKillingIds] = useState<Set<string>>(() => new Set());

  const setKilling = useCallback((id: string, on: boolean) => {
    setKillingIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const performKill = useCallback(
    async (agent: Agent) => {
      if (!onAgentKill) return;
      setKilling(agent.id, true);
      try {
        await onAgentKill(agent);
      } catch (err) {
        // 실패하면 행이 그대로 남는다 — 조용히 삼키면 "눌렀는데 아무 일도
        // 없다" 가 되므로 최소한 콘솔에는 남긴다.
        console.error("[BeginnerAgentsPane] kill failed:", err);
      } finally {
        setKilling(agent.id, false);
      }
    },
    [onAgentKill, setKilling]
  );

  const requestKill = useCallback(
    (agent: Agent) => {
      if (killingIds.has(agent.id)) return;
      const plan = closePlanFor({
        id: agent.id,
        isAgent: true,
        status: agent.status,
      });
      if (plan.needsConfirm) {
        setPendingKill(agent);
        return;
      }
      void performKill(agent);
    },
    [killingIds, performKill]
  );

  const confirmKill = useCallback(() => {
    const target = pendingKill;
    if (!target) return;
    setPendingKill(null);
    void performKill(target);
  }, [pendingKill, performKill]);

  // 대상이 목록에서 사라졌으면(다른 표면에서 이미 종료) 확인 모달도 닫는다 —
  // 이미 없는 팀원에게 "정말 끌까요?" 를 묻고 있을 이유가 없다.
  useEffect(() => {
    if (pendingKill && !workerAgents.some((a) => a.id === pendingKill.id)) {
      setPendingKill(null);
    }
  }, [workerAgents, pendingKill]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#313244] px-4 py-2">
        <SectionLabel
          className="flex-1"
          trailing={
            workerAgents.length > 0 ? (
              <span data-testid="beginner-agents-count">
                {`${workerAgents.length}${t("agents.summary.unit")}`}
              </span>
            ) : null
          }
        >
          {t("beginner.agents.label")}
        </SectionLabel>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {workerAgents.length === 0 ? (
          // 빈 상태를 "없음" 으로 끝내지 않는다. 에이전트는 유저가 만드는 게
          // 아니라 오케가 붙이는 것이라, 지금 할 일이 없다는 사실 자체가 답이다.
          <p
            data-testid="beginner-agents-empty"
            className="text-xs leading-5 text-[#6c7086]"
          >
            {t("beginner.agents.empty")}
          </p>
        ) : (
          <>
            <TeamSummary compact agents={workerAgents} tasks={tasks} />

            <ul className="mt-3 flex flex-col gap-1.5">
              {workerAgents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  task={
                    tasks.find((task) => task.id === agent.currentTaskId) ??
                    null
                  }
                  onTaskClick={onTaskClick}
                  onAgentClick={onAgentClick}
                  onAgentKill={onAgentKill ? requestKill : undefined}
                  killing={killingIds.has(agent.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 손실 경고는 어드밴스드 목록과 **같은** 모달이다. 그 모달은 자기 부모를
          기준으로 `absolute inset-0` 이라, 19rem 짜리 이 패널 안에 그대로 두면
          좁게 눌리고 세로로 잘린다(이 패널은 세로 스택일 때 14rem 이다). 그래서
          화면 전체를 잡는 fixed 칸에 담아 중앙에 세운다 — 모달 자체는 손대지
          않는다. */}
      {pendingKill && (
        <div
          className="fixed inset-0 z-[70]"
          data-testid="beginner-agent-kill-confirm"
        >
          <CloseConfirmModal
            name={pendingKill.name}
            busy={killingIds.has(pendingKill.id)}
            onConfirm={confirmKill}
            onCancel={() => setPendingKill(null)}
          />
        </div>
      )}
    </div>
  );
}

/** 상태 점 색 — 미니 보드/스트립과 같은 팔레트. */
const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-[#a6e3a1]",
  idle: "bg-[#f9e2af]",
  error: "bg-[#f38ba8]",
  stopped: "bg-[#6c7086]",
};

const STATUS_LABEL_KEY = {
  working: "agents.status.working",
  idle: "agents.status.idle",
  error: "agents.status.error",
  stopped: "agents.status.stopped",
} as const;

function AgentRow({
  agent,
  task,
  onTaskClick,
  onAgentClick,
  onAgentKill,
  killing,
}: {
  agent: Agent;
  task: Task | null;
  onTaskClick?: (task: Task) => void;
  onAgentClick?: (agent: Agent) => void;
  /** 끄기 요청(확인 판정은 부모가 든다). 생략하면 X 가 그려지지 않는다. */
  onAgentKill?: (agent: Agent) => void;
  /** 회수가 진행 중 — 버튼을 잠그고 진행 중임을 보인다. */
  killing?: boolean;
}) {
  const { t } = useTranslation();
  const taskClickable = !!task && !!onTaskClick;
  const rowClickable = !!onAgentClick;
  const killable = !!onAgentKill;

  return (
    <li
      data-testid="beginner-agent-row"
      data-agent-status={agent.status}
      // 행 전체가 터미널로 가는 문이다. 목록에서 이름만 누르게 하면 타깃이
      // 11px 텍스트만큼으로 줄어드는데, 이 패널은 폭이 19rem 뿐이라 그 여백까지
      // 다 눌리는 편이 낫다.
      onClick={rowClickable ? () => onAgentClick!(agent) : undefined}
      className={`rounded-md border border-[#313244] bg-[#1e1e2e] px-2.5 py-2 ${
        rowClickable ? "cursor-pointer hover:border-[#45475a]" : ""
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="text-[11px] leading-4">
          {BEGINNER_ROLE_ICON[agent.role] ?? "🤖"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4 text-[#cdd6f4]">
          {agent.name}
        </span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            STATUS_DOT[agent.status]
          } ${agent.status === "working" ? "animate-pulse" : ""}`}
        />
        <span className="shrink-0 text-[10px] leading-4 text-[#a6adc8]">
          {t(STATUS_LABEL_KEY[agent.status])}
        </span>
      </div>

      {/* "무슨 일에 붙어 있나" — 이 한 줄이 이 패널의 존재 이유다. */}
      {task ? (
        <button
          type="button"
          data-testid="beginner-agent-task"
          disabled={!taskClickable}
          // ★행 클릭(터미널)을 삼킨다 — 티켓 줄의 목적지는 티켓 상세다.
          onClick={
            taskClickable
              ? (e) => {
                  e.stopPropagation();
                  onTaskClick!(task);
                }
              : undefined
          }
          title={task.title}
          className={`mt-1 block w-full truncate text-left text-[11px] leading-4 text-[#7f849c] ${
            taskClickable ? "hover:text-[#89b4fa]" : "cursor-default"
          }`}
        >
          {task.title}
        </button>
      ) : (
        <p className="mt-1 truncate text-[11px] leading-4 text-[#585b70]">
          {t("beginner.agents.noTask")}
        </p>
      )}

      {/* 액션 줄 — 종전엔 "눌러서 보기" 안내 문구가 있던 자리다. 문구는 문으로
          읽히지 않았고, 끄기는 심플 모드에 아예 없었다. 줄 수는 그대로 유지한다.
          두 버튼 모두 행 클릭(터미널)을 삼킨다 — 특히 X 는 삼키지 않으면 끄면서
          동시에 터미널이 열린다. */}
      {(rowClickable || killable) && (
        <div className="mt-1 flex items-center justify-end gap-1">
          {rowClickable && (
            <button
              type="button"
              data-testid="beginner-agent-open-terminal"
              onClick={(e) => {
                e.stopPropagation();
                onAgentClick!(agent);
              }}
              title={t("beginner.agents.openTerminal")}
              className="rounded border border-[#313244] px-1.5 py-0.5 text-[10px] leading-4 text-[#7f849c] transition-colors hover:border-[#45475a] hover:text-[#89b4fa]"
            >
              <span aria-hidden className="mr-0.5">
                ▸
              </span>
              {t("beginner.agents.terminalAction")}
            </button>
          )}

          {killable && (
            <button
              type="button"
              data-testid="beginner-agent-kill"
              disabled={killing}
              onClick={(e) => {
                e.stopPropagation();
                onAgentKill!(agent);
              }}
              aria-label={t("beginner.agents.killAria", { name: agent.name })}
              title={t("beginner.agents.killTitle")}
              className="flex h-[18px] w-[18px] items-center justify-center rounded border border-[#313244] text-[10px] leading-4 text-[#7f849c] transition-colors hover:border-[#f38ba8]/50 hover:text-[#f38ba8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {killing ? (
                "…"
              ) : (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
