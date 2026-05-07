import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_TYPE_ICON,
  ACTIVITY_TYPE_LABEL,
  type ActivityEntry,
  type ActivityType,
  subscribeToActivityStream,
} from "../../services/activityStreamService";
import {
  useActivityStreamStore,
  type ActivityFilter,
  type ActivityViewMode,
} from "../../stores/activityStreamStore";
import { useProjectStore } from "../../stores/projectStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { MacroView } from "./MacroView";

const FILTER_ORDER: ActivityFilter[] = [
  "all",
  "task:created",
  "task:claimed",
  "task:progress",
  "task:completed",
  "task:blocked",
  "agent:spawned",
  "pm:feedback",
  "activity:note",
  "error",
  "other",
];

const VIEW_MODES: { id: ActivityViewMode; label: string }[] = [
  { id: "stream", label: "Stream" },
  { id: "macro", label: "Macro" },
];

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Best-effort task id extraction from MCP tool params. */
function extractTaskId(entry: ActivityEntry): string | null {
  const p = entry.params;
  if (typeof p.task_id === "string") return p.task_id;
  if (typeof p.taskId === "string") return p.taskId as string;
  return null;
}

/** Latch a navigation request — Layout switches tab, the destination tab
 *  consumes the target on mount via useNavigationStore.consumeJump(). */
function jumpTo(target: { type: "task" | "agent"; id: string }) {
  useNavigationStore.getState().requestJump(target);
}

/**
 * One row in the stream. Click to expand inline detail (params + result).
 * `content-visibility: auto` lets the browser skip painting offscreen rows
 * — gives most of the benefit of a JS virtualizer with zero deps.
 */
function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const icon = ACTIVITY_TYPE_ICON[entry.type];
  const label = ACTIVITY_TYPE_LABEL[entry.type];
  const taskId = extractTaskId(entry);
  const agentId =
    entry.agentId && entry.agentId !== "unknown" ? entry.agentId : null;

  const summary =
    entry.toolName === "add_activity" &&
    typeof entry.params.message === "string"
      ? (entry.params.message as string)
      : entry.toolName === "create_task" &&
        typeof entry.params.title === "string"
      ? (entry.params.title as string)
      : entry.toolName === "update_task_status" &&
        typeof entry.params.status === "string"
      ? `→ ${entry.params.status}`
      : entry.toolName === "claim_task" && taskId
      ? `task ${taskId.slice(0, 8)}`
      : entry.result.slice(0, 80) || entry.toolName;

  return (
    <div
      className={`rounded border border-transparent transition-colors ${
        expanded
          ? "bg-[#262640] border-[#313244]"
          : "hover:bg-[#262640] hover:border-[#313244]"
      }`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 56px" }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-2 py-1.5"
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 text-sm leading-none"
            aria-label={label}
            title={label}
          >
            {icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-medium text-[#cdd6f4] truncate">
                {label}
              </span>
              <span className="text-[10px] text-[#6c7086] truncate">
                {entry.agentId.slice(0, 12)}
              </span>
              <span className="ml-auto text-[10px] text-[#6c7086] flex-shrink-0">
                {timeAgo(entry.createdAt)}
              </span>
            </div>
            <p className="text-[11px] text-[#bac2de] line-clamp-2 break-all">
              {summary}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 text-[10px]">
          <div>
            <span className="text-[#6c7086]">tool:</span>{" "}
            <code className="text-[#89b4fa]">{entry.toolName}</code>
            <span className="text-[#6c7086] ml-2">{entry.duration}ms</span>
            {!entry.success && (
              <span className="ml-2 rounded bg-[#f38ba8]/20 px-1 text-[#f38ba8]">
                failed
              </span>
            )}
          </div>
          {Object.keys(entry.params).length > 0 && (
            <div>
              <div className="text-[#6c7086]">params:</div>
              <pre className="mt-0.5 rounded bg-[#11111b] p-1.5 text-[#cdd6f4] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {JSON.stringify(entry.params, null, 2)}
              </pre>
            </div>
          )}
          {entry.result && (
            <div>
              <div className="text-[#6c7086]">result:</div>
              <pre className="mt-0.5 rounded bg-[#11111b] p-1.5 text-[#cdd6f4] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {entry.result}
              </pre>
            </div>
          )}
          {(taskId || agentId) && (
            <div className="flex gap-1.5 pt-0.5">
              {taskId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpTo({ type: "task", id: taskId });
                  }}
                  className="rounded bg-[#89b4fa]/20 px-2 py-1 text-[10px] text-[#89b4fa] hover:bg-[#89b4fa]/30"
                >
                  📋 태스크 열기
                </button>
              )}
              {agentId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpTo({ type: "agent", id: agentId });
                  }}
                  className="rounded bg-[#cba6f7]/20 px-2 py-1 text-[10px] text-[#cba6f7] hover:bg-[#cba6f7]/30"
                >
                  🤖 에이전트 보기
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivityStreamPanel() {
  const { open, filter, setFilter, toggle, viewMode, setViewMode } =
    useActivityStreamStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  // Live-subscribe only while panel is open. Saves a Firestore listener
  // when the stream isn't visible — onSnapshot keeps a websocket frame
  // open for every active subscriber.
  useEffect(() => {
    if (!open) return;
    const projectId = currentProject?.id ?? "";
    const unsub = subscribeToActivityStream(projectId, setEntries, 100);
    return () => unsub();
  }, [open, currentProject?.id]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.type === filter);
  }, [entries, filter]);

  const counts = useMemo(() => {
    const c: Partial<Record<ActivityType, number>> = {};
    for (const e of entries) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [entries]);

  if (!open) return null;

  return (
    <aside
      className="flex h-full w-[320px] flex-col border-l border-[#313244] bg-[#181825] flex-shrink-0"
      aria-label="Activity stream"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#cdd6f4]">
            Activity Stream
          </span>
          <span className="text-[10px] text-[#6c7086]">{entries.length}</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="rounded p-1 text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
          title="Close (⌘⇧A)"
          aria-label="Close activity stream"
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* View mode toggle */}
      <div className="flex border-b border-[#313244]">
        {VIEW_MODES.map((m) => {
          const active = viewMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setViewMode(m.id)}
              className={`flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-[#262640] text-[#89b4fa] border-b-2 border-[#89b4fa]"
                  : "text-[#6c7086] hover:bg-[#262640] hover:text-[#cdd6f4]"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {viewMode === "macro" ? (
        <MacroView
          entries={entries}
          onSelectAgent={(id) => jumpTo({ type: "agent", id })}
        />
      ) : (
        <>
          {/* Filter chips */}
          <div className="flex flex-wrap gap-1 border-b border-[#313244] px-2 py-1.5">
            {FILTER_ORDER.map((f) => {
              const active = filter === f;
              const count = f === "all" ? entries.length : counts[f] ?? 0;
              const icon = f === "all" ? "•" : ACTIVITY_TYPE_ICON[f];
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    active
                      ? "bg-[#89b4fa]/20 text-[#89b4fa]"
                      : "text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
                  }`}
                  title={f === "all" ? "All" : ACTIVITY_TYPE_LABEL[f]}
                >
                  <span>{icon}</span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Stream */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-[#6c7086]">
                {entries.length === 0
                  ? "활동이 아직 없습니다. 에이전트가 MCP 도구를 호출하면 여기 표시됩니다."
                  : "이 필터에 해당하는 항목이 없습니다."}
              </p>
            )}
            {filtered.map((e) => (
              <ActivityRow key={e.id} entry={e} />
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="border-t border-[#313244] px-3 py-1.5 text-[10px] text-[#6c7086]">
        Source: audit_logs · 최근 100건 · ⌘⇧A 토글
      </div>
    </aside>
  );
}
