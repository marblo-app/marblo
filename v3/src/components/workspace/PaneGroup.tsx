import { useState } from "react";
import {
  usePaneStore,
  paneDisplayTitle,
  type GroupNode,
} from "../../stores/paneStore";
import { PaneContent } from "./PaneContent";

const DND_MIME = "application/x-marblo-pane";

/**
 * One leaf of the split tree: a chrome-style tab strip over a single visible
 * pane. Tabs can be dragged to reorder or to move into another group; the
 * strip is itself a drop target. Header controls split the group (right/down),
 * add a new tab, and close it.
 */
export function PaneGroup({
  group,
  isFocused,
}: {
  group: GroupNode;
  isFocused: boolean;
}) {
  const panes = usePaneStore((s) => s.panes);
  const setActivePane = usePaneStore((s) => s.setActivePane);
  const closePane = usePaneStore((s) => s.closePane);
  const movePane = usePaneStore((s) => s.movePane);
  const addPane = usePaneStore((s) => s.addPane);
  const splitGroup = usePaneStore((s) => s.splitGroup);
  const focusGroup = usePaneStore((s) => s.focusGroup);

  const [dragOver, setDragOver] = useState(false);

  const activePane = group.activePaneId ? panes[group.activePaneId] : null;

  const onDropToStrip = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paneId = e.dataTransfer.getData(DND_MIME);
    if (paneId) movePane(paneId, group.id);
  };

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-col ${
        isFocused ? "ring-1 ring-inset ring-blue-600/40" : ""
      }`}
      onMouseDown={() => focusGroup(group.id)}
    >
      {/* Tab strip */}
      <div
        className={`flex items-center border-b border-gray-700 bg-gray-800 ${
          dragOver ? "bg-blue-950/40" : ""
        }`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_MIME)) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropToStrip}
      >
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {group.paneIds.map((paneId) => {
            const pane = panes[paneId];
            if (!pane) return null;
            const isActive = paneId === group.activePaneId;
            return (
              <div
                key={paneId}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, paneId);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => setActivePane(group.id, paneId)}
                className={`group flex cursor-pointer items-center gap-1.5 border-r border-gray-700 px-3 py-1.5 text-[13px] ${
                  isActive
                    ? "border-b-2 border-b-blue-500 bg-gray-700 text-white"
                    : "text-gray-400 hover:bg-gray-700/50 hover:text-gray-200"
                }`}
                /* The visible label is the host, truncated — the tooltip is
                   where the full URL goes, as in a browser's tab strip. */
                title={pane.url ?? paneDisplayTitle(pane)}
              >
                <span className="max-w-[120px] truncate">
                  {paneDisplayTitle(pane)}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(paneId);
                  }}
                  className="ml-1 rounded p-0.5 opacity-0 hover:bg-gray-600 group-hover:opacity-100"
                  aria-label="Close pane"
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </span>
              </div>
            );
          })}
        </div>

        {/* Group controls */}
        <div className="relative flex flex-shrink-0 items-center gap-0.5 px-1">
          {/* "+" opens a blank web tab, the way a browser's does. It used to
              open a menu of every pane kind (Board, Code, Agents, …) from
              when this tree was meant to replace the whole right-hand tab
              bar; inside the Web tab those are duplicates of tabs that
              already exist next door. */}
          <button
            type="button"
            onClick={() => addPane("browser", { groupId: group.id })}
            title="New tab"
            aria-label="New tab"
            className="rounded px-1.5 py-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => splitGroup(group.id, "row")}
            title="Split right"
            className="rounded px-1.5 py-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <rect x="3" y="4" width="8" height="16" strokeWidth={2} rx="1" />
              <rect x="13" y="4" width="8" height="16" strokeWidth={2} rx="1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => splitGroup(group.id, "column")}
            title="Split down"
            className="rounded px-1.5 py-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <rect x="4" y="3" width="16" height="8" strokeWidth={2} rx="1" />
              <rect x="4" y="13" width="16" height="8" strokeWidth={2} rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Active pane content. Panes stay mounted (hidden) so switching tabs
          doesn't tear down terminals / editors — matches the legacy behavior
          where a single tab tree persists. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {group.paneIds.map((paneId) => {
          const pane = panes[paneId];
          if (!pane) return null;
          const isActive = paneId === group.activePaneId;
          return (
            <div
              key={paneId}
              className="absolute inset-0"
              style={{ display: isActive ? "block" : "none" }}
            >
              <PaneContent pane={pane} />
            </div>
          );
        })}
        {!activePane && (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            Empty pane — use + to add a tab
          </div>
        )}
      </div>
    </div>
  );
}
