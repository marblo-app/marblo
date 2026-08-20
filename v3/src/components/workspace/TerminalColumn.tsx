import { useCallback, useRef } from "react";
import OrchestratorPanel from "../orchestrator/OrchestratorPanel";
import { AgentListPanel } from "../agents/list-panel/AgentListPanel";
import { FirstSpawnGuide } from "../onboarding/FirstSpawnGuide";
import { t } from "../../lib/i18n";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { verticalRatioFromPointer } from "../../lib/splitWorkspaceLayout";

/**
 * The fixed LEFT column of the IDE split shell: the orchestrator (Claude) PTY
 * on top and the agent terminals below it, as a vertical 50/50 split (default)
 * with a draggable horizontal divider between them. Both panels are reused
 * verbatim (OrchestratorPanel + AgentListPanel) in their `fill` mode — no PTY
 * re-wiring — so each stretches to fill its half instead of owning a fixed
 * height. The column packs to the very bottom (no scroll gap), and the agent
 * xterm fits to the bottom on first mount via TerminalView's own ResizeObserver
 * (the panes have a definite flex height from frame one).
 *
 * ★ This column lives in its own DOM subtree, sibling to the right work-view.
 * Switching a right tab re-renders only the right subtree, so the terminals
 * here are never remounted or scrolled — the core UX moat.
 *
 * Collapsed → a slim rail with an expand affordance so the terminals are always
 * one click away without eating horizontal space (used on narrow windows too).
 */
export function TerminalColumn({
  collapsed,
  onToggle,
  onOpenAgents,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenAgents: () => void;
}) {
  const verticalRatio = useSplitWorkspaceStore((s) => s.verticalRatio);
  const setVerticalRatio = useSplitWorkspaceStore((s) => s.setVerticalRatio);
  const splitRef = useRef<HTMLDivElement | null>(null);

  // Divider drag → set the orchestrator (top) height fraction, clamped to the
  // legal band. Measured against the split container, not the whole column, so
  // the header above the split doesn't skew the fraction.
  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = splitRef.current;
      if (!el) return;
      const move = (ev: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        setVerticalRatio(
          verticalRatioFromPointer(ev.clientY, rect.top, rect.height)
        );
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [setVerticalRatio]
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-9 flex-shrink-0 flex-col items-center border-r border-gray-700 bg-gray-800 py-2">
        <button
          type="button"
          onClick={onToggle}
          title={t("workspace.expandTerminals")}
          aria-label={t("workspace.expandTerminals")}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
        <div
          className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
          style={{ writingMode: "vertical-rl" }}
        >
          {t("workspace.terminals")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-visible bg-gray-900">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-700 bg-gray-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {t("workspace.terminals")}
        </span>
        <button
          type="button"
          onClick={onToggle}
          title={t("workspace.collapseTerminals")}
          aria-label={t("workspace.collapseTerminals")}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      {/* The rail owns a fixed single-line slot. Its expanded guide is an
          upward absolute overlay, so this split keeps the same dimensions. */}
      <div
        data-testid="terminal-first-spawn-guide-anchor"
        className="relative shrink-0 px-2 pt-2"
      >
        <FirstSpawnGuide />
      </div>

      {/* Vertical split: orchestrator (top) · draggable divider · agents
          (bottom). Each panel runs in `fill` mode so it stretches to fill its
          half — the two flex-basis fractions sum to 100%, packing the column to
          the bottom with no scroll gap. */}
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-hidden"
          style={{
            flexBasis: `${verticalRatio * 100}%`,
            flexGrow: 0,
            flexShrink: 0,
          }}
        >
          <OrchestratorPanel fill />
        </div>

        <div
          onMouseDown={onDividerDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("workspace.resizeTerminals")}
          className="h-1 flex-shrink-0 cursor-row-resize bg-gray-700 transition-colors hover:bg-blue-600"
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          <AgentListPanel
            fill
            onJumpToAgent={onOpenAgents}
            onSpawnClick={onOpenAgents}
          />
        </div>
      </div>
    </div>
  );
}
