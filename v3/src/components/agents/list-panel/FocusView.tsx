import { useEffect, useRef, useState, useCallback } from "react";
import { VENDOR_VISUALS, STATUS_PILL, type AgentRowData } from "./types";
import TerminalView from "../../terminal/TerminalView";

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

  // Keyboard nav. Scoped to the focus container — if the terminal has
  // focus, xterm consumes most key events before they reach here (stopped
  // at the terminal wrapper), so this only fires when the user is in the
  // header / not actively typing in xterm.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const isInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA";
      if (isInput) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onBack();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        // Only intercept Ctrl/Cmd+R inside this panel — don't break the
        // browser-level page reload elsewhere.
        if (row.isAgent) {
          e.preventDefault();
          setEditing(true);
        }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [editing, onBack, onPrev, onNext, row.isAgent]);

  // Ensure the container can receive key events without a tab stop hunt —
  // focus it on mount and on row change.
  useEffect(() => {
    containerRef.current?.focus();
  }, [row.id]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex h-full flex-col bg-[#11111b] outline-none"
    >
      <div className="flex items-center gap-2 border-b border-[#313244] bg-[#181825] px-3 py-2">
        <button
          onClick={onBack}
          className="rounded px-2 py-0.5 text-[11px] text-[#6c7086] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
          title="목록으로 (Esc)"
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

        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={total <= 1}
            className="rounded px-1.5 py-0.5 text-[11px] text-[#6c7086] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4] disabled:opacity-30"
            title="이전 에이전트 (←)"
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

      <div className="relative flex-1 min-h-0">
        {row.ptySessionId ? (
          <TerminalView sessionId={row.ptySessionId} isActive={true} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-[#6c7086]">
            <div>
              이 에이전트에 연결된 터미널이 없습니다.
              <br />
              Start를 눌러 새 세션을 시작하세요.
            </div>
            {row.isAgent && onStart && (
              <button
                onClick={onStart}
                disabled={isStarting}
                className="rounded border border-[#585b70] px-3 py-1 text-[11px] text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-50"
              >
                {isStarting ? "Starting…" : "Start"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
