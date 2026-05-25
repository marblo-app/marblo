import { useMemo, useState, useCallback } from "react";
import { useAgentStore } from "../../../stores/agentStore";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useNavigationStore } from "../../../stores/navigationStore";
import { AgentRow } from "./AgentRow";
import { EmptyState } from "./EmptyState";
import { VENDOR_VISUALS, type AgentRowData, type VendorKind } from "./types";

function formatAge(date?: Date): string {
  if (!date) return "—";
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
  const sessions = useTerminalStore((s) => s.sessions);
  const requestJump = useNavigationStore((s) => s.requestJump);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo<AgentRowData[]>(() => {
    const agentRows: AgentRowData[] = agents.map((a) => ({
      id: a.id,
      vendor: a.model as VendorKind,
      displayName: a.name,
      taskId: a.currentTaskId,
      status: a.status === "working" ? "running" : a.status,
      lastActivityLabel: formatAge(a.costUpdatedAt ?? a.createdAt),
      isAgent: true,
    }));

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
          title="Spawn new agent (⌘N)"
        >
          + New
          <span className="ml-1 text-[#585b70]">⌘N</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState recent={recent} onSpawnClick={onSpawnClick} />
        ) : (
          rows.map((row) => (
            <AgentRow
              key={row.id}
              row={row}
              isSelected={selectedId === row.id}
              onSelect={() => setSelectedId(row.id)}
              onDoubleClick={() => handleDoubleClick(row)}
            />
          ))
        )}
      </div>
    </div>
  );
}
