import { forwardRef, memo, useCallback, useState } from "react";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import { useTerminalStore } from "../../stores/terminalStore";
import MiniTerminal from "./MiniTerminal";

interface TerminalFleetCellProps {
  /** PTY session id — MiniTerminal 의 채널 키이자 store 에서의 id. */
  sessionId: string;
  /** 사용자가 본 터미널 탭 이름 (예: "Terminal 1"). */
  name: string;
  /** Roving tabindex — 그리드에서 현재 포커스된 셀만 tabIndex=0. */
  isFocused?: boolean;
  /** 클릭/Tab focus 시 부모 그리드 focusedIndex 동기화. */
  onFocus?: () => void;
}

/**
 * 사용자 spawn 셸 터미널을 그리드에 표시하는 셀. AgentFleetCell 과 동일한
 * 시각/UX 패턴 (단일 클릭=select, Enter/dblclick=하단 FocusView drill-in)
 * 이지만 에이전트 특유의 model/role/AttentionBadge 가 없고, 액션도 🗑 만
 * 노출 (셸은 살아있거나 닫혔거나 둘 중 하나라 ▶ Start 가 의미 없음).
 */
const TerminalFleetCellImpl = forwardRef<
  HTMLButtonElement,
  TerminalFleetCellProps
>(function TerminalFleetCellImpl(
  { sessionId, name, isFocused = false, onFocus },
  ref
) {
  const closeSession = useTerminalStore((s) => s.closeSession);
  const [deleting, setDeleting] = useState(false);

  const drillIn = useCallback(() => {
    useAgentFocusStore.getState().setFocusedAgent(sessionId);
  }, [sessionId]);

  const handleClick = useCallback(() => {
    // no-op — focus 만, drill-in 은 Enter / dblclick 전용.
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        drillIn();
      }
    },
    [drillIn]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm(`터미널 "${name}" 을 닫을까요?`)) return;
      setDeleting(true);
      try {
        await closeSession(sessionId);
      } catch (err) {
        console.error("[TerminalFleetCell] closeSession failed:", err);
        setDeleting(false);
      }
      // 성공 시 컴포넌트 unmount.
    },
    [closeSession, name, sessionId]
  );

  return (
    <div className="relative group">
      <button
        type="button"
        ref={ref}
        role="gridcell"
        tabIndex={isFocused ? 0 : -1}
        onClick={handleClick}
        onDoubleClick={drillIn}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        aria-label={`${name} 터미널 — Enter 또는 더블클릭으로 상세보기`}
        data-session-id={sessionId}
        className="w-full text-left rounded-lg border border-[#313244] bg-[#181825] p-2.5 hover:border-[#585b70] hover:bg-[#1e1e2e] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cba6f7]"
        style={{ borderLeftColor: "#64748b", borderLeftWidth: 3 }}
        title={`${name} — 단일 클릭=선택, Enter/더블클릭=하단 상세보기`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-mono text-[#94a3b8]">$</span>
            <span className="text-xs font-medium text-[#cdd6f4] truncate">
              {name}
            </span>
            <span
              className="text-[9px] text-green-400 flex-shrink-0"
              aria-label="running"
            >
              🟢
            </span>
          </div>
        </div>

        {/* Mini terminal preview */}
        <MiniTerminal sessionId={sessionId} maxLines={8} />

        {/* Status label */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-[#6c7086] flex-shrink-0">
            shell
          </span>
        </div>
      </button>

      {/* Action toolbar — 터미널은 🗑 만 (▶ Start 없음).
          Hover/focus 시 노출, absolute z-index 로 셀 위에 띄움. */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10">
        <button
          type="button"
          tabIndex={-1}
          onClick={handleDelete}
          disabled={deleting}
          title="터미널 닫기 (PTY kill + 영속 entry 제거)"
          aria-label={`${name} 터미널 닫기`}
          className="rounded border border-[#f38ba8]/40 bg-[#11111b]/90 px-1.5 py-0.5 text-[10px] text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/15 disabled:opacity-40"
        >
          {deleting ? "…" : "🗑"}
        </button>
      </div>
    </div>
  );
});

export const TerminalFleetCell = memo(TerminalFleetCellImpl);
export default TerminalFleetCell;
