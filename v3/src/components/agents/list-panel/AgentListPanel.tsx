import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { useAgentStore } from "../../../stores/agentStore";
import { useTerminalStore } from "../../../stores/terminalStore";
import { useNavigationStore } from "../../../stores/navigationStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useAgentFocusStore } from "../../../stores/agentFocusStore";
import { AgentRow } from "./AgentRow";
import { EmptyState } from "./EmptyState";
import { FocusView } from "./FocusView";
import { VENDOR_VISUALS, type AgentRowData, type VendorKind } from "./types";

// Panel height (drag-resizable, persisted to localStorage). MIN of 180 keeps
// header (~30) + handle (4) + EmptyState legible; previous 120 clipped it.
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 800;
const HEIGHT_STORAGE_KEY = "marblo:v3:agentListPanel:height";

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

// Module-level so re-renders don't reset the count and "Terminal 1" doesn't
// get spawned twice. Matches the prior TerminalPanel behavior — see also
// Layout.tsx's terminal:new event listener which has its own counter.
let terminalSpawnCounter = 0;

export function AgentListPanel({ onJumpToAgent, onSpawnClick }: Props) {
  const agents = useAgentStore((s) => s.agents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const restartAgent = useAgentStore((s) => s.restartAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const sessions = useTerminalStore((s) => s.sessions);
  const createTerminalSession = useTerminalStore((s) => s.createSession);
  const requestJump = useNavigationStore((s) => s.requestJump);
  const projectId = useProjectStore((s) => s.currentProject?.id) ?? "";
  const [startingId, setStartingId] = useState<string | null>(null);
  // Single-select focus model (Claude /agents style). When set, the panel
  // body switches from the row list to a fullscreen-in-panel FocusView for
  // that agent. null = list view.
  //
  // 외부 패널(상단 Fleet 그리드의 Enter / dblclick) 도 같은 focus 를 set
  // 할 수 있도록 zustand store 로 lift. 상태 단일화 + cross-panel drill-in.
  const focusedId = useAgentFocusStore((s) => s.focusedAgentId);
  const setFocusedId = useAgentFocusStore((s) => s.setFocusedAgent);

  // Drag-resizable panel height (persisted). Mirrors OrchestratorPanel's
  // handle right above for muscle-memory consistency.
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_HEIGHT;
    const saved = Number(window.localStorage.getItem(HEIGHT_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_HEIGHT && saved <= MAX_HEIGHT) {
      return saved;
    }
    return DEFAULT_HEIGHT;
  });
  const panelHeightRef = useRef(panelHeight);
  useEffect(() => {
    panelHeightRef.current = panelHeight;
  }, [panelHeight]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeightRef.current;

    const onMouseMove = (moveEvent: MouseEvent) => {
      // Dragging up grows the panel — invert delta since the handle sits
      // on the top edge.
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, startHeight + delta)
      );
      setPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem(
          HEIGHT_STORAGE_KEY,
          String(panelHeightRef.current)
        );
      } catch {
        // private mode / quota — ignore
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handleSpawnTerminal = useCallback(async () => {
    terminalSpawnCounter++;
    try {
      const id = await createTerminalSession(
        `Terminal ${terminalSpawnCounter}`
      );
      setFocusedId(id);
    } catch (err) {
      console.error("[AgentListPanel] Failed to spawn terminal:", err);
      terminalSpawnCounter--;
    }
  }, [createTerminalSession]);

  // Subscribe to agents independently. Without this, the panel only shows
  // data when another consumer (AgentsTab / TeamDashboard) has activated
  // the subscription — invisible until the user happens to visit those.
  useEffect(() => {
    if (!projectId) return;
    return subscribeToAgents(projectId);
  }, [projectId, subscribeToAgents]);

  // The Orchestrator has its own dedicated panel (OrchestratorPanel)
  // directly above this one — don't double-render it as just another row.
  const realAgents = useMemo(
    () => agents.filter((a) => a.role !== "orchestrator"),
    [agents]
  );

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
    const agentRows: AgentRowData[] = realAgents.map((a) => {
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
  }, [realAgents, sessions]);

  const recent = useMemo(
    () =>
      realAgents
        .filter((a) => a.status === "stopped")
        .slice(0, 3)
        .map((a) => ({
          id: a.id,
          vendor: VENDOR_VISUALS[a.model as VendorKind]?.label ?? a.model,
          ageLabel: formatAge(a.costUpdatedAt ?? a.createdAt),
        })),
    [realAgents]
  );

  // When the focused row disappears (agent deleted, terminal closed, etc.)
  // bounce back to the list rather than rendering a stale empty FocusView.
  useEffect(() => {
    if (focusedId && !rows.some((r) => r.id === focusedId)) {
      setFocusedId(null);
    }
  }, [focusedId, rows]);

  const focusedIndex = focusedId
    ? rows.findIndex((r) => r.id === focusedId)
    : -1;
  const focusedRow = focusedIndex >= 0 ? rows[focusedIndex] : null;

  // 외부 store(zustand) 는 함수형 setter 가 없어서 functional update 대신
  // getState() 로 현재 값 직접 읽어서 다음 id 계산.
  const handlePrev = useCallback(() => {
    if (rows.length === 0) return;
    const current = useAgentFocusStore.getState().focusedAgentId;
    const i = current ? rows.findIndex((r) => r.id === current) : -1;
    const next = i < 0 ? 0 : (i - 1 + rows.length) % rows.length;
    setFocusedId(rows[next].id);
  }, [rows, setFocusedId]);

  const handleNext = useCallback(() => {
    if (rows.length === 0) return;
    const current = useAgentFocusStore.getState().focusedAgentId;
    const i = current ? rows.findIndex((r) => r.id === current) : -1;
    const next = i < 0 ? 0 : (i + 1) % rows.length;
    setFocusedId(rows[next].id);
  }, [rows, setFocusedId]);

  const handleDoubleClick = useCallback(
    (row: AgentRowData) => {
      if (row.isAgent) {
        requestJump({ type: "agent", id: row.id });
        onJumpToAgent(row.id);
      }
    },
    [requestJump, onJumpToAgent]
  );

  const handleStartFocused = useCallback(
    async (id: string) => {
      setStartingId(id);
      try {
        await restartAgent(id);
      } catch (err) {
        console.error("[AgentListPanel] start failed:", err);
      } finally {
        setStartingId(null);
      }
    },
    [restartAgent]
  );

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      await updateAgent(id, { name: newName });
    },
    [updateAgent]
  );

  return (
    <div
      className="flex flex-col flex-shrink-0 bg-[#181825] border-t border-[#313244]"
      style={{ height: panelHeight }}
    >
      {/* Resize handle — drag up to grow, down to shrink. */}
      <div
        onMouseDown={handleDragStart}
        className="h-1 flex-shrink-0 cursor-row-resize bg-[#313244] hover:bg-[#89b4fa] transition-colors"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize agent list panel"
      />
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[#6c7086] border-b border-[#313244]">
        <span>
          {focusedRow ? (
            <>Focused Agent</>
          ) : (
            <>
              Active Agents{" "}
              <span className="text-[#cdd6f4] font-medium">
                ({rows.length})
              </span>
            </>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSpawnTerminal}
            className="rounded px-2 py-0.5 text-[10px] text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
            title="Spawn a shell terminal in the project folder"
          >
            + Terminal
          </button>
          <button
            onClick={onSpawnClick}
            className="rounded px-2 py-0.5 text-[10px] text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
            title="Spawn an AI agent — opens Agents tab"
          >
            + Agent
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {focusedRow ? (
          <FocusView
            row={focusedRow}
            index={focusedIndex}
            total={rows.length}
            onPrev={handlePrev}
            onNext={handleNext}
            onBack={() => setFocusedId(null)}
            onRename={(newName) => handleRename(focusedRow.id, newName)}
            onStart={
              focusedRow.isAgent
                ? () => handleStartFocused(focusedRow.id)
                : undefined
            }
            isStarting={startingId === focusedRow.id}
          />
        ) : rows.length === 0 ? (
          <EmptyState recent={recent} onSpawnClick={onSpawnClick} />
        ) : (
          <div className="h-full overflow-auto">
            {rows.map((row) => (
              <AgentRow
                key={row.id}
                row={row}
                isExpanded={false}
                onSelect={() => setFocusedId(row.id)}
                onDoubleClick={() => handleDoubleClick(row)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
