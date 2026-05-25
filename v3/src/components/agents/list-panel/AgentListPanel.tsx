import { useMemo, useState, useCallback, useEffect } from "react";
import { useAgentStore } from "../../../stores/agentStore";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useNavigationStore } from "../../../stores/navigationStore";
import { useProjectStore } from "../../../stores/projectStore";
import { AgentRow } from "./AgentRow";
import { EmptyState } from "./EmptyState";
import { VENDOR_VISUALS, type AgentRowData, type VendorKind } from "./types";
import TerminalView from "../../terminal/TerminalView";

function formatAge(date?: Date): string {
  // Defensive: Firestore docs occasionally arrive with a Timestamp instead
  // of a Date if a new date field is added but not registered in the
  // store's DATE_FIELDS conversion list. Falling through to .getTime()
  // would throw and crash the bottom panel (caught by ErrorBoundary).
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  const ms = Date.now() - date.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

interface Props {
  onJumpToAgent: (agentId: string) => void;
  onSpawnClick: () => void;
}

export function AgentListPanel({ onJumpToAgent, onSpawnClick }: Props) {
  const agents = useAgentStore((s) => s.agents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const restartAgent = useAgentStore((s) => s.restartAgent);
  const sessions = useTerminalStore((s) => s.sessions);
  const requestJump = useNavigationStore((s) => s.requestJump);
  const projectId = useProjectStore((s) => s.currentProject?.id) ?? "";
  const [restartingId, setRestartingId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Subscribe to agents independently. Without this, the panel only shows
  // data when another consumer (AgentsTab / TeamDashboard) has activated
  // the subscription — invisible until the user happens to visit those.
  useEffect(() => {
    if (!projectId) return;
    return subscribeToAgents(projectId);
  }, [projectId, subscribeToAgents]);

  const rows = useMemo<AgentRowData[]>(() => {
    // Agent rows: match each agent to its pty session by name suffix.
    // attachSession is called from 5+ sites with different label formats:
    //   "Agent: <name>"   (Layout.tsx initial spawn)
    //   "🟣 <name>"       (useAgentReconnect / restartAgent / AgentStatusCard)
    //   "🔵 <name>" / "🟢 <name>" (gemini / gpt+codex)
    // endsWith covers all of them. Trade-off: if one agent name is a suffix
    // of another (e.g. "foo-1" vs "x-foo-1") the wrong row matches; agent
    // names in practice are distinct enough for Phase 1. Long-term fix is
    // to store the canonical ptySessionId on the Agent Firestore doc.
    const agentRows: AgentRowData[] = agents.map((a) => {
      const matched = sessions.find(
        (s) => s.isAgent && s.name.endsWith(a.name)
      );
      return {
        id: a.id,
        vendor: a.model as VendorKind,
        displayName: a.name,
        taskId: a.currentTaskId,
        status: a.status === "working" ? "running" : a.status,
        lastActivityLabel: formatAge(a.costUpdatedAt ?? a.createdAt),
        isAgent: true,
        ptySessionId: matched?.id,
      };
    });

    const shellRows: AgentRowData[] = sessions
      .filter((s) => !s.isAgent)
      .map((s) => ({
        id: s.id,
        vendor: "internal" as VendorKind,
        displayName: s.name,
        taskId: null,
        status: "running",
        lastActivityLabel: "—",
        isAgent: false,
        ptySessionId: s.id,
      }));

    return [...agentRows, ...shellRows];
  }, [agents, sessions]);

  const recent = useMemo(
    () =>
      agents
        .filter((a) => a.status === "stopped")
        .slice(0, 3)
        .map((a) => ({
          id: a.id,
          vendor: VENDOR_VISUALS[a.model as VendorKind]?.label ?? a.model,
          ageLabel: formatAge(a.costUpdatedAt ?? a.createdAt),
        })),
    [agents]
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const handleDoubleClick = useCallback(
    (row: AgentRowData) => {
      if (row.isAgent) {
        requestJump({ type: "agent", id: row.id });
        onJumpToAgent(row.id);
      }
    },
    [requestJump, onJumpToAgent]
  );

  return (
    <div
      className="flex flex-col flex-shrink-0 bg-[#181825] border-t border-[#313244]"
      style={{ height: 250 }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[#6c7086] border-b border-[#313244]">
        <span>
          Active Agents{" "}
          <span className="text-[#cdd6f4] font-medium">({rows.length})</span>
        </span>
        <button
          onClick={onSpawnClick}
          className="rounded px-2 py-0.5 text-[10px] text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
          title="Open Agents tab to spawn (⌘N in Phase 2)"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState recent={recent} onSpawnClick={onSpawnClick} />
        ) : (
          rows.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <div key={row.id}>
                <AgentRow
                  row={row}
                  isExpanded={expanded}
                  onSelect={() => handleToggleExpand(row.id)}
                  onDoubleClick={() => handleDoubleClick(row)}
                />
                {expanded && row.ptySessionId && (
                  <div
                    className="relative bg-[#11111b] border-b border-[#313244]"
                    style={{ height: 180 }}
                  >
                    <TerminalView
                      sessionId={row.ptySessionId}
                      isActive={true}
                    />
                  </div>
                )}
                {expanded && !row.ptySessionId && (
                  <div className="flex items-center gap-3 px-4 py-3 text-[11px] text-[#6c7086] bg-[#11111b] border-b border-[#313244]">
                    <span className="flex-1">
                      Terminal not attached. The pty may have died after an app
                      restart, or reconnect hasn&apos;t fired yet.
                    </span>
                    {row.isAgent && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setRestartingId(row.id);
                          try {
                            await restartAgent(row.id);
                          } catch (err) {
                            console.error(
                              "[AgentListPanel] restartAgent failed:",
                              err
                            );
                          } finally {
                            setRestartingId(null);
                          }
                        }}
                        disabled={restartingId === row.id}
                        className="rounded border border-[#585b70] px-2 py-1 text-[10px] text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-50"
                      >
                        {restartingId === row.id ? "Restarting…" : "Restart"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
