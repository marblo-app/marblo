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
import TerminalView from "../../terminal/TerminalView";
import { findAgentPtySessionId } from "../../../lib/agentTerminal";
import { useTranslation } from "../../../lib/i18n";

// Panel height (drag-resizable, persisted to localStorage). MIN of 180 keeps
// header (~30) + handle (4) + EmptyState legible; previous 120 clipped it.
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 800;
const HEIGHT_STORAGE_KEY = "marblo:v3:agentListPanel:height";
const KILL_ALL_LABEL = "전체 삭제";
const CLEANUP_STOPPED_LABEL = "stopped 정리";

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
  /**
   * Fill mode (Workspace shell vertical split): the panel stretches to fill its
   * parent flex cell instead of owning a fixed pixel height, and its own top
   * resize handle is suppressed (the shell's divider owns resizing). Default
   * false → legacy fixed-height behavior (pixel-identical to before).
   */
  fill?: boolean;
}

// Module-level so re-renders don't reset the count and "Terminal 1" doesn't
// get spawned twice. Matches the prior TerminalPanel behavior — see also
// Layout.tsx's terminal:new event listener which has its own counter.
let terminalSpawnCounter = 0;

export function AgentListPanel({
  onJumpToAgent,
  onSpawnClick,
  fill = false,
}: Props) {
  const { t } = useTranslation();
  const agents = useAgentStore((s) => s.agents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const restartAgent = useAgentStore((s) => s.restartAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const sessions = useTerminalStore((s) => s.sessions);
  const createTerminalSession = useTerminalStore((s) => s.createSession);
  const requestJump = useNavigationStore((s) => s.requestJump);
  const projectId = useProjectStore((s) => s.currentProject?.id) ?? "";
  const [startingId, setStartingId] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  // Single-select focus model (Claude /agents style). When set, the panel
  // body switches from the row list to a fullscreen-in-panel FocusView for
  // that agent. null = list view.
  //
  // 외부 패널(상단 Fleet 그리드의 Enter / dblclick) 도 같은 focus 를 set
  // 할 수 있도록 zustand store 로 lift. 상태 단일화 + cross-panel drill-in.
  const focusedId = useAgentFocusStore((s) => s.focusedAgentId);
  const setFocusedId = useAgentFocusStore((s) => s.setFocusedAgent);
  // Keyboard highlight in the list view. Moved by ↑/↓; Enter / → enters
  // FocusView for the highlighted row. Persists across focus exits so the
  // user lands back on the row they just inspected.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
        Math.max(MIN_HEIGHT, startHeight + delta),
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
          String(panelHeightRef.current),
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
        `Terminal ${terminalSpawnCounter}`,
      );
      setFocusedId(`terminal:${id}`);
    } catch (err) {
      console.error("[AgentListPanel] Failed to spawn terminal:", err);
      terminalSpawnCounter--;
    }
  }, [createTerminalSession, setFocusedId]);

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
    [agents],
  );

  const rows = useMemo<AgentRowData[]>(() => {
    // Agent rows: match each agent to its pty session by name suffix.
    // ★The matching rule lives in lib/agentTerminal (shared with the beginner
    // shell's agent terminal) — see that file for the label formats it covers
    // and the endsWith trade-off. Keeping a second copy here is how the two
    // screens drift the day another attachSession label appears.
    const agentRows: AgentRowData[] = realAgents.map((a) => {
      const matchedId = findAgentPtySessionId(sessions, a.name);
      // Firestore 에 들어온 model 값이 VENDOR_VISUALS 키에 없으면 (옛 값,
      // 빈 문자열, 신규 모델 미등록 등) AgentRow 에서 vendor.stripeColor 가
      // undefined 로 crash. 안전한 fallback 으로 "custom"(회색 X) 노출.
      const vendor: VendorKind =
        a.model && VENDOR_VISUALS[a.model as VendorKind]
          ? (a.model as VendorKind)
          : "custom";
      return {
        id: a.id,
        vendor,
        spawnedModel: a.spawnedModel,
        displayName: a.name,
        taskId: a.currentTaskId,
        status: a.status === "working" ? "running" : a.status,
        lastActivityLabel: formatAge(a.costUpdatedAt ?? a.createdAt),
        isAgent: true,
        ptySessionId: matchedId,
      };
    });

    const shellRows: AgentRowData[] = sessions
      .filter((s) => !s.isAgent)
      .map((s) => ({
        id: `terminal:${s.id}`,
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

  // Rows with a live PTY session — these get a persistent TerminalView each.
  // Mounted at the panel body level (below) so xterm instances survive focus
  // card switches AND list↔focus transitions. xterm keeps its own alt-screen
  // + scrollback + cursor state in-memory, so toggling visibility (not
  // unmount) reproduces the "exact same screen" UX of Claude's /agents view.
  const rowsWithPty = useMemo(
    () => rows.filter((r) => !!r.ptySessionId),
    [rows],
  );

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
    [realAgents],
  );

  const activeAgents = useMemo(
    () => realAgents.filter((a) => a.status !== "stopped"),
    [realAgents],
  );
  const stoppedAgents = useMemo(
    () => realAgents.filter((a) => a.status === "stopped"),
    [realAgents],
  );

  const setDeleting = useCallback((ids: string[], isDeleting: boolean) => {
    setDeletingIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => {
        if (isDeleting) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
  }, []);

  const handleKillAgent = useCallback(
    async (row: AgentRowData) => {
      if (!row.isAgent) return;
      const actionLabel = row.status === "stopped" ? "remove" : "kill";
      const confirmed = window.confirm(
        row.status === "stopped"
          ? `Remove stopped agent "${row.displayName}"?`
          : `Kill agent "${row.displayName}"?`,
      );
      if (!confirmed) return;

      setDeleting([row.id], true);
      try {
        if (row.status === "stopped") {
          await deleteAgent(row.id);
        } else {
          await stopAgent(row.id);
        }
        if (focusedId === row.id) {
          setFocusedId(null);
        }
      } catch (err) {
        console.error(`[AgentListPanel] ${actionLabel} failed:`, err);
      } finally {
        setDeleting([row.id], false);
      }
    },
    [deleteAgent, focusedId, setDeleting, setFocusedId, stopAgent],
  );

  const handleKillAllAgents = useCallback(async () => {
    if (activeAgents.length === 0) return;
    const confirmed = window.confirm(
      `Kill ${activeAgents.length} active agent${
        activeAgents.length === 1 ? "" : "s"
      }?`,
    );
    if (!confirmed) return;

    const ids = activeAgents.map((agent) => agent.id);
    setDeleting(ids, true);
    try {
      await Promise.all(ids.map((id) => stopAgent(id)));
      if (focusedId && ids.includes(focusedId)) {
        setFocusedId(null);
      }
    } catch (err) {
      console.error("[AgentListPanel] kill all failed:", err);
    } finally {
      setDeleting(ids, false);
    }
  }, [activeAgents, focusedId, setDeleting, setFocusedId, stopAgent]);

  const handleCleanupStoppedAgents = useCallback(async () => {
    if (stoppedAgents.length === 0) return;
    const confirmed = window.confirm(
      `Remove ${stoppedAgents.length} stopped agent${
        stoppedAgents.length === 1 ? "" : "s"
      }?`,
    );
    if (!confirmed) return;

    const ids = stoppedAgents.map((agent) => agent.id);
    setDeleting(ids, true);
    try {
      await Promise.all(ids.map((id) => deleteAgent(id)));
      if (focusedId && ids.includes(focusedId)) {
        setFocusedId(null);
      }
    } catch (err) {
      console.error("[AgentListPanel] cleanup stopped failed:", err);
    } finally {
      setDeleting(ids, false);
    }
  }, [deleteAgent, focusedId, setDeleting, setFocusedId, stoppedAgents]);

  // When the focused row disappears (agent deleted, terminal closed, etc.)
  // bounce back to the list rather than rendering a stale empty FocusView.
  useEffect(() => {
    if (focusedId && !rows.some((r) => r.id === focusedId)) {
      setFocusedId(null);
    }
  }, [focusedId, rows, setFocusedId]);

  // Initialize / clamp the keyboard highlight. When list re-mounts (after
  // returning from FocusView, or rows change), keep the highlight on the
  // previously focused row if still present; otherwise default to first.
  useEffect(() => {
    if (rows.length === 0) {
      if (highlightedId !== null) setHighlightedId(null);
      return;
    }
    if (!highlightedId || !rows.some((r) => r.id === highlightedId)) {
      setHighlightedId(focusedId ?? rows[0].id);
    }
  }, [rows, highlightedId, focusedId]);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Don't hijack typing in inputs that may be nested (none today, but
      // future-proof against EmptyState search etc.).
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (rows.length === 0) return;
      const currentIndex = highlightedId
        ? rows.findIndex((r) => r.id === highlightedId)
        : -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIndex < 0 ? 0 : (currentIndex + 1) % rows.length;
        setHighlightedId(rows[next].id);
        rowRefs.current[rows[next].id]?.scrollIntoView({
          block: "nearest",
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = currentIndex <= 0 ? rows.length - 1 : currentIndex - 1;
        setHighlightedId(rows[next].id);
        rowRefs.current[rows[next].id]?.scrollIntoView({
          block: "nearest",
        });
      } else if (
        e.key === "Enter" ||
        e.key === "ArrowRight" ||
        e.code === "Space" ||
        e.key === " "
      ) {
        e.preventDefault();
        const id =
          highlightedId ?? (currentIndex >= 0 ? rows[currentIndex].id : null);
        if (id) setFocusedId(id);
      }
    },
    [rows, highlightedId, setFocusedId],
  );

  const focusedIndex = focusedId
    ? rows.findIndex((r) => r.id === focusedId)
    : -1;
  const focusedRow = focusedIndex >= 0 ? rows[focusedIndex] : null;

  // Auto-focus the list container when we're not in FocusView, so ↑/↓ work
  // without an extra click. Declared after focusedRow to avoid TDZ on its
  // dep array. preventScroll keeps the page from jumping.
  useEffect(() => {
    if (!focusedRow) {
      listContainerRef.current?.focus({ preventScroll: true });
    }
  }, [focusedRow]);

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
    [requestJump, onJumpToAgent],
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
    [restartAgent],
  );

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      await updateAgent(id, { name: newName });
    },
    [updateAgent],
  );

  return (
    <div
      className={
        fill
          ? "flex h-full min-h-0 flex-col bg-[#181825] border-t border-[#313244]"
          : "flex flex-col flex-shrink-0 bg-[#181825] border-t border-[#313244]"
      }
      style={fill ? undefined : { height: panelHeight }}
    >
      {/* Resize handle — drag up to grow, down to shrink. Suppressed in fill
          mode (the shell's vertical divider owns resizing). */}
      {!fill && (
        <div
          onMouseDown={handleDragStart}
          className="h-1 flex-shrink-0 cursor-row-resize bg-[#313244] hover:bg-[#89b4fa] transition-colors"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize agent list panel"
        />
      )}
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[#6c7086] border-b border-[#313244]">
        <span className="inline-flex items-center gap-1.5">
          {/* Neutral agent glyph (inherits the muted gray) — deliberately plain
              so the accented Orchestrator badge above reads as the special one. */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="8" width="16" height="12" rx="2" />
            <path d="M12 8V4M9 13.5h.01M15 13.5h.01" />
          </svg>
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
            onClick={handleKillAllAgents}
            disabled={activeAgents.length === 0}
            className="rounded px-2 py-0.5 text-[10px] text-[#f38ba8] hover:text-[#fab387] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            title="Kill all active agents"
          >
            {KILL_ALL_LABEL}
          </button>
          <button
            onClick={handleCleanupStoppedAgents}
            disabled={stoppedAgents.length === 0}
            className="rounded px-2 py-0.5 text-[10px] text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            title="Remove stopped agents from the list"
          >
            {CLEANUP_STOPPED_LABEL}
          </button>
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

      <div className="flex-1 min-h-0 relative">
        {/* Persistent terminals layer — every row with a PTY gets its own
            TerminalView, mounted exactly once and kept across focus card
            switches AND list↔focus transitions. Only the active one is
            visible; the rest sit invisible at absolute inset-0, preserving
            xterm's grid / alt-screen / scrollback in-memory. The layer
            itself is always rendered (not gated on focusedRow) so xterms
            keep ingesting live PTY data even when the user is browsing the
            list view — returning to focus shows the latest screen instantly. */}
        <div className="absolute inset-0 flex flex-col bg-[#11111b]">
          {focusedRow && (
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
          )}
          <div className="flex-1 min-h-0 relative">
            {rowsWithPty.map((r) => (
              <TerminalView
                key={r.ptySessionId}
                sessionId={r.ptySessionId!}
                isActive={
                  !!focusedRow && focusedRow.ptySessionId === r.ptySessionId
                }
                onLeftWhenEmpty={() => setFocusedId(null)}
              />
            ))}
            {/* Focused-but-no-PTY empty state (agent never started yet) */}
            {focusedRow && !focusedRow.ptySessionId && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-[#6c7086]">
                <div>
                  {t("agents.listPanel.noTerminal")}
                  <br />
                  {t("agents.listPanel.startNewSession")}
                </div>
                {focusedRow.isAgent && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleStartFocused(focusedRow.id)}
                      disabled={startingId === focusedRow.id}
                      className="rounded border border-[#cba6f7] bg-[#cba6f7]/10 px-3 py-1 text-[11px] text-[#cba6f7] transition-colors hover:bg-[#cba6f7]/20 disabled:opacity-50"
                      title={t("agents.listPanel.newSessionTitle")}
                    >
                      {startingId === focusedRow.id
                        ? "Starting…"
                        : "+ New Session"}
                    </button>
                  </div>
                )}
                <div className="text-[10px] text-[#585b70]">
                  {t("agents.listPanel.cliHint")}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* List view overlay — opaque, covers terminals layer when no focus.
            Terminals stay mounted underneath so re-entering focus is instant. */}
        {!focusedRow && (
          <div className="absolute inset-0 bg-[#181825]">
            {rows.length === 0 ? (
              <EmptyState recent={recent} onSpawnClick={onSpawnClick} />
            ) : (
              <div
                ref={listContainerRef}
                tabIndex={0}
                onKeyDown={handleListKeyDown}
                className="h-full overflow-auto outline-none"
              >
                {rows.map((row) => (
                  <div
                    key={row.id}
                    ref={(el) => {
                      rowRefs.current[row.id] = el;
                    }}
                  >
                    <AgentRow
                      row={row}
                      isHighlighted={row.id === highlightedId}
                      onSelect={() => {
                        setHighlightedId(row.id);
                        setFocusedId(row.id);
                      }}
                      onDoubleClick={() => handleDoubleClick(row)}
                      onKill={() => handleKillAgent(row)}
                      isDeleting={deletingIds.has(row.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
