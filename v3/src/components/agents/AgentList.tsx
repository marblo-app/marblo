import type { Agent, ModelType, AgentStatus } from "../../types/agent";

interface AgentListProps {
  agents: Agent[];
  loading: boolean;
  onAddAgent: () => void;
  onStop: (agentId: string) => void;
  onRestart: (agentId: string) => void;
}

const MODEL_ICONS: Record<ModelType, { icon: string; color: string }> = {
  claude: { icon: "🟣", color: "#a855f7" },
  gemini: { icon: "🔵", color: "#3b82f6" },
  gpt: { icon: "🟢", color: "#22c55e" },
  antigravity: { icon: "🟠", color: "#f97316" },
  local: { icon: "⚫", color: "#737373" },
  custom: { icon: "⚪", color: "#6b7280" },
};

const STATUS_BADGES: Record<
  AgentStatus,
  { label: string; dot: string; textColor: string }
> = {
  idle: { label: "Idle", dot: "🟡", textColor: "text-yellow-400" },
  working: { label: "Active", dot: "🟢", textColor: "text-green-400" },
  error: { label: "Error", dot: "🔴", textColor: "text-red-400" },
  stopped: { label: "Stopped", dot: "⚫", textColor: "text-gray-500" },
};

export default function AgentList({
  agents,
  loading,
  onAddAgent,
  onStop,
  onRestart,
}: AgentListProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          <p className="mt-3 text-sm">에이전트 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-100">Agents</h2>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          onClick={onAddAgent}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M7 2v10M2 7h10" />
          </svg>
          Add Agent
        </button>
      </div>

      {/* Agent Cards */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <svg
            className="h-12 w-12 mb-3 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 01-1.59.659H9.06a2.25 2.25 0 01-1.591-.659L5 14.5m14 0V7a2 2 0 00-2-2H7a2 2 0 00-2 2v7.5"
            />
          </svg>
          <p className="text-sm">에이전트가 없습니다</p>
          <button
            className="mt-3 px-4 py-2 text-sm rounded border border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors"
            onClick={onAddAgent}
          >
            + 첫 에이전트 추가
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {agents.map((agent) => {
            // Fallback when an agent doc carries an unexpected model /
            // status — same defensive pattern as AgentStatusCard.
            const modelInfo = MODEL_ICONS[agent.model] ?? MODEL_ICONS.custom;
            const statusInfo =
              STATUS_BADGES[agent.status] ?? STATUS_BADGES.idle;
            const isRunning =
              agent.status === "idle" || agent.status === "working";

            return (
              <div
                key={agent.id}
                className="rounded-lg bg-gray-800 border border-gray-700 p-4"
                style={{ borderLeftColor: modelInfo.color, borderLeftWidth: 4 }}
              >
                <div className="flex items-start justify-between">
                  {/* Left: Info */}
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-xl mt-0.5">{modelInfo.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-100 truncate">
                          {agent.name}
                        </span>
                        <span
                          className={`flex items-center gap-1 text-xs ${statusInfo.textColor}`}
                        >
                          <span className="text-[10px]">{statusInfo.dot}</span>
                          {statusInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="px-1.5 py-0.5 rounded bg-gray-700">
                          {agent.role}
                        </span>
                        <span className="font-mono">{agent.command}</span>
                      </div>
                      {agent.currentTaskId && (
                        <div className="mt-1.5 text-xs text-gray-400 truncate">
                          Task: {agent.currentTaskId}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    {isRunning ? (
                      <button
                        className="px-3 py-1 text-xs font-medium rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/30 transition-colors"
                        onClick={() => onStop(agent.id)}
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        className="px-3 py-1 text-xs font-medium rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-600/30 transition-colors"
                        onClick={() => onRestart(agent.id)}
                      >
                        Restart
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
