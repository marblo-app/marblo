import { useEffect, useRef, useState, useCallback } from "react";
import { VENDOR_VISUALS, STATUS_PILL, type AgentRowData } from "./types";

// FocusView renders ONLY the header (← All / name / nav buttons). The
// terminal body slot lives in AgentListPanel so TerminalView instances
// can be kept mounted across focus card switches and list↔focus
// transitions — xterm preserves its alt-screen / scrollback / cursor
// state in-memory, so just toggling visibility (no re-mount) gives
// the "same as before" UX that Claude's /agents view has. The empty
// state for an agent without a PTY also lives in AgentListPanel.

interface Props {
  row: AgentRowData;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onBack: () => void;
  onRename: (newName: string) => Promise<void> | void;
  onStart?: () => Promise<void> | void;
  isStarting?: boolean;
}

export function FocusView({
  row,
  index,
  total,
  onPrev,
  onNext,
  onBack,
  onRename,
  onStart,
  isStarting,
}: Props) {
  const vendor = VENDOR_VISUALS[row.vendor];
  const pill = STATUS_PILL[row.status];

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(row.displayName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraftName(row.displayName);
    setEditing(false);
  }, [row.id, row.displayName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(async () => {
    const next = draftName.trim();
    setEditing(false);
    if (!next || next === row.displayName) {
      setDraftName(row.displayName);
      return;
    }
    try {
      await onRename(next);
    } catch (err) {
      console.error("[FocusView] rename failed:", err);
      setDraftName(row.displayName);
    }
  }, [draftName, onRename, row.displayName]);

  // Keyboard nav. Registered on document so a single click into the
  // terminal area doesn't trap the user — pre-hoist this listener sat on a
  // container that wrapped both header AND terminal, so it picked up any
  // focus-state inside. After 7d7c3bd hoisted TerminalView into
  // AgentListPanel, the FocusView container is just the header; once xterm
  // grabs focus, a container-scoped listener never fires and ← stops
  // returning to the list. Document-level catches every header/list/panel
  // path, while TerminalView's own keydown stopPropagation at the terminal
  // wrapper still keeps in-terminal arrows local (Claude CLI cursor moves
  // are not hijacked — they never reach this listener).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      // Another handler upstream already claimed this key — e.g., the
      // AgentFleetGrid in the top panel preventDefault()'s ← / → for its
      // own cell-to-cell navigation. Without this guard, our document
      // listener would still fire and onBack() the user out of focus
      // mode whenever they moved focus within the top grid.
      if (e.defaultPrevented) return;
      const tgt = e.target as HTMLElement | null;
      if (!tgt) return;
      // Defensive: even with stopPropagation at the terminal wrapper, an
      // event listened on document during the capture phase could still
      // see in-terminal keys. We register in bubble phase so this guard
      // is belt-and-suspenders.
      if (tgt.closest(".xterm")) return;
      const tag = tgt.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" || e.key === "ArrowLeft") {
        e.preventDefault();
        onBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        if (row.isAgent) {
          e.preventDefault();
          setEditing(true);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, onBack, onNext, row.isAgent]);

  // Ensure the container can receive key events without a tab stop hunt —
  // focus it on mount and on row change.
  useEffect(() => {
    containerRef.current?.focus();
  }, [row.id]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex-shrink-0 outline-none"
    >
      <div className="flex items-center gap-2 border-b border-[#313244] bg-[#181825] px-3 py-2">
        <button
          onClick={onBack}
          className="rounded px-2 py-0.5 text-[11px] text-[#6c7086] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
          title="목록으로 (← / Esc)"
        >
          ← All
        </button>

        <span
          aria-hidden
          className="ml-1"
          style={{ width: 3, height: 14, backgroundColor: vendor.stripeColor }}
        />
        <span
          className="font-mono text-[10px] font-bold text-[#cdd6f4]"
          style={{ minWidth: 22 }}
          title={vendor.label}
        >
          {vendor.monogram}
        </span>

        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                setDraftName(row.displayName);
              }
            }}
            className="flex-1 rounded border border-[#585b70] bg-[#1e1e2e] px-2 py-0.5 text-sm text-[#cdd6f4] outline-none focus:border-[#cba6f7]"
          />
        ) : (
          <button
            onClick={() => row.isAgent && setEditing(true)}
            disabled={!row.isAgent}
            className="flex-1 truncate text-left text-sm text-[#cdd6f4] disabled:cursor-default"
            title={row.isAgent ? "이름 변경 (Ctrl+R)" : undefined}
          >
            {row.displayName}
          </button>
        )}

        {row.taskId && (
          <span className="font-mono text-[11px] text-[#89b4fa]">
            {row.taskId}
          </span>
        )}

        <span
          className="flex items-center gap-1 text-[11px]"
          style={{ color: pill.color }}
        >
          <span
            aria-hidden
            className="inline-block rounded-full"
            style={{ width: 6, height: 6, backgroundColor: pill.color }}
          />
          {pill.label}
        </span>

        {row.isAgent && onStart && (
          <button
            onClick={onStart}
            disabled={isStarting}
            className="rounded border border-[#585b70] px-2 py-0.5 text-[10px] text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-50"
            title="현재 PTY 종료 후 새 CLI 세션 시작"
          >
            {isStarting ? "Starting…" : "+ New Session"}
          </button>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={total <= 1}
            className="rounded px-1.5 py-0.5 text-[11px] text-[#6c7086] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] disabled:opacity-30"
            title="이전 에이전트"
          >
            ‹
          </button>
          <span className="text-[10px] text-[#6c7086] tabular-nums">
            {index + 1} / {total}
          </span>
          <button
            onClick={onNext}
            disabled={total <= 1}
            className="rounded px-1.5 py-0.5 text-[11px] text-[#6c7086] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] disabled:opacity-30"
            title="다음 에이전트 (→)"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
