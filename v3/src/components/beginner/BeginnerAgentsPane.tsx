import { useTranslation } from "../../lib/i18n";
import type { Agent, AgentStatus } from "../../types/agent";
import type { Task } from "../../types/task";
import TeamSummary from "../agents/TeamSummary";
import { BEGINNER_ROLE_ICON, SectionLabel } from "./beginnerUi";

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
 */
export function BeginnerAgentsPane({
  agents,
  tasks,
  onTaskClick,
  onAgentClick,
}: {
  agents: Agent[];
  tasks: Task[];
  /** 에이전트가 붙은 티켓을 눌렀을 때. 생략하면 줄이 클릭 불가가 된다. */
  onTaskClick?: (task: Task) => void;
  /** 에이전트 행을 눌렀을 때(터미널 열기). 생략하면 행이 클릭 불가가 된다. */
  onAgentClick?: (agent: Agent) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#313244] px-4 py-2">
        <SectionLabel
          className="flex-1"
          trailing={
            agents.length > 0 ? (
              <span data-testid="beginner-agents-count">
                {`${agents.length}${t("agents.summary.unit")}`}
              </span>
            ) : null
          }
        >
          {t("beginner.agents.label")}
        </SectionLabel>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {agents.length === 0 ? (
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
            <TeamSummary compact agents={agents} tasks={tasks} />

            <ul className="mt-3 flex flex-col gap-1.5">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  task={
                    tasks.find((task) => task.id === agent.currentTaskId) ??
                    null
                  }
                  onTaskClick={onTaskClick}
                  onAgentClick={onAgentClick}
                />
              ))}
            </ul>
          </>
        )}
      </div>
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
}: {
  agent: Agent;
  task: Task | null;
  onTaskClick?: (task: Task) => void;
  onAgentClick?: (agent: Agent) => void;
}) {
  const { t } = useTranslation();
  const taskClickable = !!task && !!onTaskClick;
  const rowClickable = !!onAgentClick;

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
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[agent.status]} ${
            agent.status === "working" ? "animate-pulse" : ""
          }`}
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

      {/* 행이 눌린다는 사실을 말로 한 번 더 — 커서만으로는 "여기 뭐가 있나" 가
          안 읽힌다. 이 패널에서 유일하게 늘어나는 어포던스라 작게 둔다. */}
      {rowClickable && (
        <p
          data-testid="beginner-agent-open-terminal"
          className="mt-1 text-[10px] leading-4 text-[#585b70]"
        >
          {t("beginner.agents.openTerminal")}
        </p>
      )}
    </li>
  );
}
