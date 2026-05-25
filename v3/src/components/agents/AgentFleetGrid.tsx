import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent } from "../../types/agent";
import type { TerminalSession } from "../../stores/terminalStore";
import AgentFleetCell from "./AgentFleetCell";
import TerminalFleetCell from "./TerminalFleetCell";

const MIN_CELL_WIDTH = 240;
const GRID_GAP_PX = 10; // gap-2.5 → 0.625rem → ~10px (Tailwind default base 16px)

interface AgentFleetGridProps {
  agents: Agent[];
  /** 사용자 spawn 셸 터미널 (isAgent=false). 그리드 끝에 에이전트와 같은
   * 키보드 nav 인덱스 공간에 함께 배치. */
  terminals?: TerminalSession[];
  /** Agent id → 마지막 activity 메시지 (옵션). 부모가 ActivityFeed 로부터 매핑. */
  activityByAgent?: Record<string, string>;
}

/**
 * Agents 탭의 그리드 뷰. CSS grid auto-fill — 컨테이너 폭에 따라 N×M 자동
 * 배치. 컨테이너가 좁아져 셀이 한 줄에 1개만 들어갈 정도라면 카드 뷰로 자동
 * fallback 하는 게 사용성에 좋아서, breakpoint 를 본 컴포넌트가 직접 측정.
 *
 * 셀 종류:
 *   1. AgentFleetCell — Firestore agents (role !== orchestrator)
 *   2. TerminalFleetCell — 사용자 spawn 셸 (terminalStore.sessions where !isAgent)
 *   둘은 같은 cellRefs 인덱스 공간에 평탄화되어 ←→↑↓ 가 자연스럽게 이어짐.
 *
 * 키보드: roving tabindex. ←→↑↓ 셀 이동, Enter/Space/dblclick = 셀 자체
 * 처리 (drill-in to FocusView). Home/End = 첫·끝 셀. 활성 컬럼 수는
 * ResizeObserver 로 실시간 계산.
 */
export default function AgentFleetGrid({
  agents,
  terminals = [],
  activityByAgent,
}: AgentFleetGridProps) {
  const totalCount = agents.length + terminals.length;

  const [tooNarrow, setTooNarrow] = useState(false);
  const [cols, setCols] = useState(1);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setTooNarrow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // 컨테이너 폭 → 현재 렌더된 컬럼 수. ↑↓ 화살표 점프 거리 계산용.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const recompute = (width: number) => {
      if (tooNarrow) {
        setCols(1);
        return;
      }
      const n = Math.max(
        1,
        Math.floor((width + GRID_GAP_PX) / (MIN_CELL_WIDTH + GRID_GAP_PX))
      );
      setCols(n);
    };
    recompute(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) recompute(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tooNarrow]);

  // 셀이 줄어들 때 focusedIndex 가 범위를 벗어나면 마지막 셀로 clamp.
  useEffect(() => {
    if (focusedIndex >= totalCount && totalCount > 0) {
      setFocusedIndex(totalCount - 1);
    }
  }, [totalCount, focusedIndex]);

  const moveFocus = useCallback(
    (next: number) => {
      if (totalCount === 0) return;
      const clamped = Math.max(0, Math.min(totalCount - 1, next));
      if (clamped === focusedIndex) return;
      setFocusedIndex(clamped);
      cellRefs.current.get(clamped)?.focus();
    },
    [totalCount, focusedIndex]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (totalCount === 0) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          moveFocus(focusedIndex + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveFocus(focusedIndex - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          moveFocus(focusedIndex + cols);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(focusedIndex - cols);
          break;
        case "Home":
          e.preventDefault();
          moveFocus(0);
          break;
        case "End":
          e.preventDefault();
          moveFocus(totalCount - 1);
          break;
      }
    },
    [totalCount, cols, focusedIndex, moveFocus]
  );

  const registerCell = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      if (el) cellRefs.current.set(index, el);
      else cellRefs.current.delete(index);
    },
    []
  );

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#6c7086]">
        <p className="text-sm">에이전트가 없습니다</p>
        <p className="text-xs mt-1">상단 Add Agent 버튼으로 추가하세요</p>
      </div>
    );
  }

  // 좁은 화면에선 단일 열.
  const columnStyle = tooNarrow
    ? { gridTemplateColumns: "1fr" }
    : {
        gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CELL_WIDTH}px, 1fr))`,
      };

  return (
    <div
      ref={containerRef}
      role="grid"
      aria-label="에이전트 그리드 — 화살표로 이동, Enter 로 상세보기"
      onKeyDown={handleKeyDown}
      className="grid gap-2.5 p-3"
      style={columnStyle}
    >
      {agents.map((agent, i) => (
        <AgentFleetCell
          key={agent.id}
          ref={registerCell(i)}
          agent={agent}
          lastActivityMessage={activityByAgent?.[agent.id]}
          isFocused={i === focusedIndex}
          onFocus={() => setFocusedIndex(i)}
        />
      ))}
      {terminals.map((terminal, j) => {
        const i = agents.length + j;
        return (
          <TerminalFleetCell
            key={terminal.id}
            ref={registerCell(i)}
            sessionId={terminal.id}
            name={terminal.name}
            isFocused={i === focusedIndex}
            onFocus={() => setFocusedIndex(i)}
          />
        );
      })}
    </div>
  );
}
