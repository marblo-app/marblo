import OrchestratorPanel from "../orchestrator/OrchestratorPanel";
import { AgentListPanel } from "../agents/list-panel/AgentListPanel";
import { t } from "../../lib/i18n";

/**
 * The fixed LEFT column of the IDE split shell: the orchestrator (Claude) PTY
 * on top and the agent terminals below it. Both are reused verbatim
 * (OrchestratorPanel + AgentListPanel) — no PTY re-wiring. They each own their
 * height via their internal resize handles, so the column simply scrolls if the
 * two stacked panels exceed its height.
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
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-gray-900">
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

      {/* Stacked terminals. Each panel self-manages its height; the column
          scrolls if their combined height exceeds the viewport. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <OrchestratorPanel />
        <AgentListPanel
          onJumpToAgent={onOpenAgents}
          onSpawnClick={onOpenAgents}
        />
      </div>
    </div>
  );
}
