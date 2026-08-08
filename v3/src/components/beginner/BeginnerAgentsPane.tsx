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
 */
export function BeginnerAgentsPane({
  agents,
  tasks,
  onTaskClick,
}: {
  agents: Agent[];
  tasks: Task[];
  /** 에이전트가 붙은 티켓을 눌렀을 때. 생략하면 줄이 클릭 불가가 된다. */
  onTaskClick?: (task: Task) => void;
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
}: {
  agent: Agent;
  task: Task | null;
  onTaskClick?: (task: Task) => void;
}) {
  const { t } = useTranslation();
  const clickable = !!task && !!onTaskClick;

  return (
    <li
      data-testid="beginner-agent-row"
      data-agent-status={agent.status}
      className="rounded-md border border-[#313244] bg-[#1e1e2e] px-2.5 py-2"
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
          disabled={!clickable}
          onClick={clickable ? () => onTaskClick!(task) : undefined}
          title={task.title}
          className={`mt-1 block w-full truncate text-left text-[11px] leading-4 text-[#7f849c] ${
            clickable ? "hover:text-[#89b4fa]" : "cursor-default"
          }`}
        >
          {task.title}
        </button>
      ) : (
        <p className="mt-1 truncate text-[11px] leading-4 text-[#585b70]">
          {t("beginner.agents.noTask")}
        </p>
      )}
    </li>
  );
}
