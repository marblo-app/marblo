import OrchestratorPanel from "../orchestrator/OrchestratorPanel";

/**
 * Collapsible left "spine" hosting the orchestrator. Reuses OrchestratorPanel
 * verbatim (the real board PTY + controls) rather than reimplementing it. When
 * collapsed it's a slim rail with an expand affordance so the orchestrator is
 * always one click away without eating horizontal space.
 */
export function OrchestratorSpine({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <div className="flex h-full w-9 flex-shrink-0 flex-col items-center border-r border-gray-700 bg-gray-800 py-2">
        <button
          type="button"
          onClick={onToggle}
          title="Expand orchestrator"
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
          Orchestrator
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[360px] flex-shrink-0 flex-col overflow-hidden border-r border-gray-700 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Orchestrator
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <OrchestratorPanel />
      </div>
    </div>
  );
}
