import { forwardRef, memo, useCallback } from "react";
import type { Agent, ModelType, AgentStatus } from "../../types/agent";
import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useTerminalStore } from "../../stores/terminalStore";
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

    const openTerminal = useCallback(() => {
      const label = `${modelInfo.icon} ${agent.name}`;
      // 단일 store 헬퍼로 묶어둠 — attach + setActive + focus 이벤트 발행.
      useTerminalStore.getState().openTerminalForSession(sessionId, label);
    }, [agent.name, modelInfo.icon, sessionId]);

    // 파일 매니저 패턴: 단일 클릭은 select(focus) 만, Enter / Space /
    // dblclick 이 실제 액션(터미널 오픈). 버튼은 native 로 Enter/Space →
    // onClick 을 발사하므로 그쪽으로 라우팅하지 않고, 단일 click 은 의도적
    // 으로 no-op — 브라우저 default focus 만 적용되도록 둔다.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openTerminal();
      }
    };

    return (
      <button
        type="button"
        ref={ref}
        role="gridcell"
        tabIndex={isFocused ? 0 : -1}
        onFocus={onFocus}
        onDoubleClick={openTerminal}
        onKeyDown={handleKeyDown}
        aria-label={`${agent.name} — Enter 또는 더블클릭으로 터미널 열기`}
        className="group text-left rounded-lg border border-[#313244] bg-[#181825] p-2.5 hover:border-[#585b70] hover:bg-[#1e1e2e] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cba6f7]"
        style={{ borderLeftColor: modelInfo.color, borderLeftWidth: 3 }}
        title={`${agent.name} — Enter / 더블클릭으로 터미널 열기`}
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
