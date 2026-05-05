import { useState, useEffect, useRef } from "react";
import type { Agent, ModelType, AgentStatus } from "../../types/agent";
import type { Task } from "../../types/task";
import { useTerminalStore } from "../../stores/terminalStore";
import { useEditorStore } from "../../stores/editorStore";
import { useCostStore } from "../../stores/costStore";

interface SessionInfo {
  id: string;
  updatedAt: number;
  sizeKB: number;
  label?: string;
  agentId?: string;
}

interface AgentStatusCardProps {
  agent: Agent;
  tasks: Task[];
  onStop: (agentId: string) => void;
  onRestart: (agentId: string) => void;
  onDelete: (agentId: string) => void;
}

const MODEL_ICONS: Record<ModelType, { icon: string; color: string }> = {
  claude: { icon: "🟣", color: "#a855f7" },
  gemini: { icon: "🔵", color: "#3b82f6" },
  gpt: { icon: "🟢", color: "#22c55e" },
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

function useElapsedTime(startDate: Date | null): string {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startDate) {
      setElapsed("");
      return;
    }

    function update() {
      const diff = Date.now() - startDate!.getTime();
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      if (hrs > 0) {
        setElapsed(`${hrs}h ${mins % 60}m`);
      } else {
        setElapsed(`${mins}m`);
      }
    }

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [startDate]);

  return elapsed;
}

export default function AgentStatusCard({
  agent,
  tasks,
  onStop,
  onRestart,
  onDelete,
}: AgentStatusCardProps) {
  // Fall back when an agent doc carries an unexpected model / status — e.g.
  // older docs written with a versioned model id ("claude-opus-4-7") instead
  // of the ModelType family. Without these fallbacks the .icon / .color
  // accesses below throw and take the whole Agents tab down.
  const modelInfo = MODEL_ICONS[agent.model] ?? MODEL_ICONS.custom;
  const statusInfo = STATUS_BADGES[agent.status] ?? STATUS_BADGES.idle;
  const isRunning = agent.status === "idle" || agent.status === "working";
  const rootPath = useEditorStore((s) => s.rootPath);

  // Health check state
  const [restartCount, setRestartCount] = useState(0);
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const costSummary = useCostStore((s) => s.summary);
  const agentCost = costSummary?.byAgent[agent.id]?.cost;

  useEffect(() => {
    const handleRestart = (data: {
      agentId: string;
      attempt: number;
      maxAttempts: number;
    }) => {
      if (data.agentId === agent.id) setRestartCount(data.attempt);
    };
    const handleFailed = (data: { agentId: string; exitCode: number }) => {
      if (data.agentId === agent.id) setLastExitCode(data.exitCode);
    };
    window.electronAPI.agent.onRestartAttempt(handleRestart);
    window.electronAPI.agent.onRestartFailed(handleFailed);
    return () => {
      window.electronAPI.off("agent:restartAttempt");
      window.electronAPI.off("agent:restartFailed");
    };
  }, [agent.id]);

  // Session picker state
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [agentSessions, setAgentSessions] = useState<SessionInfo[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close session picker on outside click
  useEffect(() => {
    if (!showSessionPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSessionPicker(false);
      }
    };
    const timer = setTimeout(
      () => document.addEventListener("click", handleClick),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [showSessionPicker]);

  const handleTerminalClick = async () => {
    const cwd = rootPath || "~";
    try {
      const allSessions =
        await window.electronAPI.orchestratorSession.listSessions(cwd);
      // Filter to only sessions belonging to this agent (by agentId or label)
      const mySessions = allSessions.filter(
        (s: SessionInfo) => s.agentId === agent.id || s.label === agent.name,
      );
      setAgentSessions(mySessions);
    } catch {
      /* ignore */
    }
    // Always show the session picker (user can pick current session, new, or past)
    setShowSessionPicker(true);
  };

  const handleSessionSelect = async (resumeSessionId: string) => {
    setShowSessionPicker(false);
    const cwd = rootPath || "~";
    console.log("[AgentStatusCard] handleSessionSelect:", {
      resumeSessionId,
      cwd,
      agentId: agent.id,
    });

    try {
      const result = await window.electronAPI.agent.launch(
        {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          role: agent.role,
          command: agent.command,
        },
        cwd,
        undefined,
        resumeSessionId,
      );
      if (result) {
        useTerminalStore
          .getState()
          .attachSession(
            result.ptySessionId,
            `${modelInfo.icon} ${agent.name}`,
          );
      }
    } catch (err) {
      console.error("[AgentStatusCard] Failed to resume session:", err);
    }
  };

  // Current task info
  const currentTask = agent.currentTaskId
    ? tasks.find((t) => t.id === agent.currentTaskId)
    : null;

  // Completed tasks by this agent
  const completedCount = tasks.filter(
    (t) => t.claimedBy === agent.id && t.status === "DONE",
  ).length;

  // Elapsed time for current task
  const elapsed = useElapsedTime(
    currentTask?.claimedAt ? new Date(currentTask.claimedAt) : null,
  );

  return (
    <div
      className="rounded-lg border border-gray-700 bg-gray-800 p-4 transition-colors hover:border-gray-600"
      style={{ borderLeftColor: modelInfo.color, borderLeftWidth: 4 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
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
              {restartCount > 0 && agent.status !== "error" && (
                <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                  Restarted {restartCount}x
                </span>
              )}
              {agent.status === "error" && lastExitCode !== null && (
                <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">
                  Crashed (exit {lastExitCode})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <span className="rounded bg-gray-700 px-1.5 py-0.5">
                {agent.role}
              </span>
              <span className="font-mono">{agent.command}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {isRunning ? (
            <>
              <div className="relative" ref={pickerRef}>
                <button
                  className="rounded border border-blue-600/30 bg-blue-600/20 px-3 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-600/30"
                  onClick={handleTerminalClick}
                >
                  Terminal
                </button>
                {showSessionPicker && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full right-0 mt-1 w-72 rounded-md border border-[#313244] bg-[#1e1e2e] shadow-lg z-50 overflow-hidden"
                  >
                    <div className="px-3 py-1.5 text-[10px] text-[#6c7086] border-b border-[#313244] uppercase tracking-wider">
                      Select Session
                    </div>
                    <button
                      onClick={() => {
                        setShowSessionPicker(false);
                        const sessionId = `agent-${agent.id}`;
                        useTerminalStore
                          .getState()
                          .attachSession(
                            sessionId,
                            `${modelInfo.icon} ${agent.name}`,
                          );
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[#a6e3a1] hover:bg-[#313244]/60 transition-colors flex items-center gap-2"
                    >
                      <span className="text-sm">&#9654;</span>
                      Current Session
                    </button>
                    <button
                      onClick={() => handleSessionSelect("new")}
                      className="w-full text-left px-3 py-2 text-xs text-[#a6e3a1] hover:bg-[#313244]/60 transition-colors flex items-center gap-2"
                    >
                      <span className="text-sm">+</span>
                      New Session
                    </button>
                    {agentSessions.length > 0 && (
                      <div className="border-t border-[#313244] max-h-48 overflow-y-auto">
                        {agentSessions.slice(0, 10).map((s, i) => {
                          const date = new Date(s.updatedAt);
                          const timeStr = date.toLocaleString("ko-KR", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                          return (
                            <button
                              key={s.id}
                              onClick={() =>
                                handleSessionSelect(i === 0 ? "latest" : s.id)
                              }
                              className="w-full text-left px-3 py-2 text-xs hover:bg-[#313244]/60 transition-colors flex items-center justify-between gap-2"
                            >
                              <span className="text-[#cdd6f4] truncate flex items-center gap-1.5">
                                {i === 0 && (
                                  <span className="text-[#89b4fa] text-[10px]">
                                    latest
                                  </span>
                                )}
                                <span className="text-[#6c7086] font-mono text-[10px]">
                                  {s.label || s.id.slice(0, 8) + "\u2026"}
                                </span>
                              </span>
                              <span className="text-[#6c7086] text-[10px] flex-shrink-0">
                                {timeStr} · {s.sizeKB}KB
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                className="rounded border border-red-600/30 bg-red-600/20 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30"
                onClick={() => onStop(agent.id)}
              >
                Stop
              </button>
              {agent.status === "idle" && (
                <button
                  className="rounded border border-gray-600/30 bg-gray-600/20 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-red-600/20 hover:text-red-400 hover:border-red-600/30"
                  onClick={() => {
                    if (confirm(`"${agent.name}" 에이전트를 삭제하시겠습니까?`))
                      onDelete(agent.id);
                  }}
                  title="에이전트 삭제"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              )}
            </>
          ) : (
            <>
              <div className="relative" ref={pickerRef}>
                <button
                  className="rounded border border-green-600/30 bg-green-600/20 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-600/30"
                  onClick={async () => {
                    const cwd = rootPath || "~";
                    try {
                      const allSessions =
                        await window.electronAPI.orchestratorSession.listSessions(
                          cwd,
                        );
                      const mySessions = allSessions.filter(
                        (s: SessionInfo) =>
                          s.agentId === agent.id || s.label === agent.name,
                      );
                      setAgentSessions(mySessions);
                    } catch {
                      /* ignore */
                    }
                    setShowSessionPicker(true);
                  }}
                >
                  Restart
                </button>
                {showSessionPicker && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full right-0 mt-1 w-72 rounded-md border border-[#313244] bg-[#1e1e2e] shadow-lg z-50 overflow-hidden"
                  >
                    <div className="px-3 py-1.5 text-[10px] text-[#6c7086] border-b border-[#313244] uppercase tracking-wider">
                      Select Session
                    </div>
                    <button
                      onClick={() => {
                        setShowSessionPicker(false);
                        onRestart(agent.id);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[#a6e3a1] hover:bg-[#313244]/60 transition-colors flex items-center gap-2"
                    >
                      <span className="text-sm">+</span>
                      New Session
                    </button>
                    {agentSessions.length > 0 && (
                      <div className="border-t border-[#313244] max-h-48 overflow-y-auto">
                        {agentSessions.slice(0, 10).map((s, i) => {
                          const date = new Date(s.updatedAt);
                          const timeStr = date.toLocaleString("ko-KR", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                          return (
                            <button
                              key={s.id}
                              onClick={() =>
                                handleSessionSelect(i === 0 ? "latest" : s.id)
                              }
                              className="w-full text-left px-3 py-2 text-xs hover:bg-[#313244]/60 transition-colors flex items-center justify-between gap-2"
                            >
                              <span className="text-[#cdd6f4] truncate flex items-center gap-1.5">
                                {i === 0 && (
                                  <span className="text-[#89b4fa] text-[10px]">
                                    latest
                                  </span>
                                )}
                                <span className="text-[#6c7086] font-mono text-[10px]">
                                  {s.label || s.id.slice(0, 8) + "\u2026"}
                                </span>
                              </span>
                              <span className="text-[#6c7086] text-[10px] flex-shrink-0">
                                {timeStr} · {s.sizeKB}KB
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                className="rounded border border-gray-600/30 bg-gray-600/20 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-red-600/20 hover:text-red-400 hover:border-red-600/30"
                onClick={() => {
                  if (confirm(`"${agent.name}" 에이전트를 삭제하시겠습니까?`))
                    onDelete(agent.id);
                }}
                title="에이전트 삭제"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Current Task */}
      {currentTask && (
        <div className="mt-3 rounded border border-blue-800/40 bg-blue-900/20 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <span className="text-xs text-gray-500">현재 태스크</span>
              <p className="truncate text-sm text-gray-200">
                {currentTask.title}
              </p>
            </div>
            {elapsed && (
              <span className="ml-2 shrink-0 text-xs text-blue-400">
                {elapsed}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Cost Gauge */}
      {agentCost !== undefined && agentCost > 0 && (
        <CostGauge cost={agentCost} />
      )}

      {/* Stats Row */}
      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            완료 <strong className="text-gray-300">{completedCount}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{formatDate(agent.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function CostGauge({ cost }: { cost: number }) {
  // Budget tiers: green < $1, yellow < $5, red >= $5
  const maxBudget = 10;
  const pct = Math.min((cost / maxBudget) * 100, 100);
  const color =
    cost < 1 ? "bg-green-500" : cost < 5 ? "bg-amber-500" : "bg-red-500";
  const textColor =
    cost < 1 ? "text-green-400" : cost < 5 ? "text-amber-400" : "text-red-400";

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">Cost</span>
        <span className={`text-xs font-mono font-medium ${textColor}`}>
          ${cost.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700">
        <div
          className={`h-1.5 rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatDate(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  return `${days}일 전`;
}
