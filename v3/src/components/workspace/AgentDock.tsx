import { AgentListPanel } from "../agents/list-panel/AgentListPanel";

/**
 * Collapsible bottom dock hosting the agent list. Reuses AgentListPanel (the
 * same ambient monitoring rows as the legacy Layout). Collapsed → a slim bar
 * with a count; expanded → the full panel.
 */
export function AgentDock({
  collapsed,
  onToggle,
  onOpenAgent,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenAgent: () => void;
}) {
  if (collapsed) {
    return (
      <div className="flex flex-shrink-0 items-center gap-2 border-t border-gray-700 bg-gray-800 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          title="Expand agents"
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200"
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
              d="M5 15l7-7 7 7"
            />
          </svg>
          Agents
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-h-[45%] min-h-0 flex-shrink-0 flex-col border-t border-gray-700 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Agents
        </span>
        <button
          type="button"
          onClick={onToggle}
          title="Collapse"
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
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AgentListPanel
          onJumpToAgent={onOpenAgent}
          onSpawnClick={onOpenAgent}
        />
      </div>
    </div>
  );
}
