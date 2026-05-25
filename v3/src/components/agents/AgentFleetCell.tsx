import { forwardRef, memo, useCallback } from "react";
import type { Agent, ModelType, AgentStatus } from "../../types/agent";
import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import MiniTerminal from "./MiniTerminal";
import AgentStatusLabel from "./AgentStatusLabel";
import AttentionBadge from "./AttentionBadge";

const MODEL_ICONS: Record<ModelType, { icon: string; color: string }> = {
  claude: { icon: "🟣", color: "#a855f7" },
  gemini: { icon: "🔵", color: "#3b82f6" },
  gpt: { icon: "🟢", color: "#22c55e" },
  custom: { icon: "⚪", color: "#6b7280" },
};

const STATUS_DOTS: Record<AgentStatus, { dot: string; textColor: string }> = {
  idle: { dot: "🟡", textColor: "text-yellow-400" },
  working: { dot: "🟢", textColor: "text-green-400" },
  error: { dot: "🔴", textColor: "text-red-400" },
  stopped: { dot: "⚫", textColor: "text-gray-500" },
};

interface AgentFleetCellProps {
  agent: Agent;
  /** add_activity 기반 마지막 메시지 — 없으면 PTY tail 로 fallback. */
  lastActivityMessage?: string;
  /** restart 뱃지용. */
  restartCount?: number;
  /** error 뱃지 details. */
  lastExitCode?: number | null;
  /** Roving tabindex 패턴 — 그리드에서 현재 포커스된 셀만 tabIndex=0. */
  isFocused?: boolean;
  /** 셀이 포커스되었을 때 (클릭/Tab) 부모 그리드의 focusedIndex 동기화용. */
  onFocus?: () => void;
}

const AgentFleetCellImpl = forwardRef<HTMLButtonElement, AgentFleetCellProps>(
  function AgentFleetCellImpl(
    {
      agent,
      lastActivityMessage,
      restartCount = 0,
      lastExitCode = null,
      isFocused = false,
      onFocus,
    },
    ref
  ) {
    const modelInfo = MODEL_ICONS[agent.model] ?? MODEL_ICONS.custom;
    const statusInfo = STATUS_DOTS[agent.status] ?? STATUS_DOTS.idle;

    // agentSessionMap 은 launch 시점에 등록 — 미등록이어도 deterministic
    // "agent-${id}" fallback 으로 떨어진다.
    const sessionId = useAgentSessionMap((s) => s.get(agent.id));

    // 파일 매니저 패턴:
    //   - 단일 click  = select (focus) 만. onFocus 가 부모 그리드의 활성
    //     셀 인덱스를 동기화 → 이어지는 ←→↑↓ 가 자연스럽게 이어짐.
    //   - Enter / Space / 더블클릭 = "drill-in" → 하단 AgentListPanel 의
    //     FocusView 로 점프. setFocusedAgent 만 하면 패널이 자동 전환.
    //   - 별도 터미널 탭은 만들지 않음 (구 openTerminalForSession 경로는
    //     리스너가 사라져 no-op 이었고, 의미적으로도 그리드의 액션은
    //     하단 패널을 채우는 게 맞음).
    const drillIn = useCallback(() => {
      useAgentFocusStore.getState().setFocusedAgent(agent.id);
    }, [agent.id]);

    // button 의 native 핸들링: Enter/Space → onClick 발사. 그래서 onClick 을
    // drillIn 으로 라우팅하지 않고, click 만 별도로 no-op + focus 만 하도록
    // onKeyDown 에서 Enter/Space 를 명시적으로 drillIn 으로 라우팅. (단일
    // click 은 select 만, 키보드 Enter 는 drill-in 으로 구분하기 위함.)
    const handleClick = useCallback(() => {
      // 의도적 no-op — focus 는 브라우저 default 가 처리, drill-in 은 Enter /
      // 더블클릭 전용. 사용자가 키보드 네비를 시작하기 전 셀을 "선택"만
      // 해두고 싶을 때 single click 으로 끊고 마우스를 떼는 흐름을 보존.
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          // ↑↓←→ 는 부모 그리드(div) 핸들러에서 처리. preventDefault 가
          // 그리드 화살표를 막지 않도록 Enter / Space 만 가로챔.
          e.preventDefault();
          drillIn();
        }
      },
      [drillIn]
    );

    return (
      <button
        type="button"
        ref={ref}
        role="gridcell"
        tabIndex={isFocused ? 0 : -1}
        onClick={handleClick}
        onDoubleClick={drillIn}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        aria-label={`${agent.name} — Enter 또는 더블클릭으로 상세보기`}
        data-session-id={sessionId}
        className="group text-left rounded-lg border border-[#313244] bg-[#181825] p-2.5 hover:border-[#585b70] hover:bg-[#1e1e2e] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cba6f7]"
        style={{ borderLeftColor: modelInfo.color, borderLeftWidth: 3 }}
        title={`${agent.name} — 단일 클릭=선택, Enter/더블클릭=하단 상세보기`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm">{modelInfo.icon}</span>
            <span className="text-xs font-medium text-[#cdd6f4] truncate">
              {agent.name}
            </span>
            <span
              className={`text-[9px] ${statusInfo.textColor} flex-shrink-0`}
              aria-label={agent.status}
            >
              {statusInfo.dot}
            </span>
          </div>
          <AttentionBadge
            status={agent.status}
            sessionId={sessionId}
            restartCount={restartCount}
            lastExitCode={lastExitCode}
          />
        </div>

        {/* Mini terminal preview */}
        <MiniTerminal sessionId={sessionId} maxLines={8} />

        {/* Status label */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-[#6c7086] flex-shrink-0">
            {agent.role}
          </span>
          <AgentStatusLabel
            agent={agent}
            sessionId={sessionId}
            lastActivityMessage={lastActivityMessage}
          />
        </div>
      </button>
    );
  }
);

export const AgentFleetCell = memo(AgentFleetCellImpl);
export default AgentFleetCell;
