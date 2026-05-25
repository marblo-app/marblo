import { memo } from "react";
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
}

function AgentFleetCellImpl({
  agent,
  lastActivityMessage,
  restartCount = 0,
  lastExitCode = null,
}: AgentFleetCellProps) {
  const modelInfo = MODEL_ICONS[agent.model] ?? MODEL_ICONS.custom;
  const statusInfo = STATUS_DOTS[agent.status] ?? STATUS_DOTS.idle;

  // agentSessionMap 은 launch 시점에 등록 — 미등록이어도 deterministic
  // "agent-${id}" fallback 으로 떨어진다.
  const sessionId = useAgentSessionMap((s) => s.get(agent.id));

  const handleOpen = () => {
    const label = `${modelInfo.icon} ${agent.name}`;
    // 단일 store 헬퍼로 묶어둠 — attach + setActive + focus 이벤트 발행.
    useTerminalStore.getState().openTerminalForSession(sessionId, label);
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group text-left rounded-lg border border-[#313244] bg-[#181825] p-2.5 hover:border-[#585b70] hover:bg-[#1e1e2e] transition-colors focus:outline-none focus:ring-2 focus:ring-[#cba6f7]"
      style={{ borderLeftColor: modelInfo.color, borderLeftWidth: 3 }}
      title={`${agent.name} — 클릭해서 터미널 열기`}
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

export const AgentFleetCell = memo(AgentFleetCellImpl);
export default AgentFleetCell;
