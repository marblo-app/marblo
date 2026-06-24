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
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import { useAgentStore } from "../../stores/agentStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { MacroView } from "./MacroView";
import { formatActivity } from "../../services/activityFormatters";
import { useTranslation } from "../../lib/i18n";
import type { Agent } from "../../types/agent";

const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
  custom: "⚪",
};

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

function extractSpawnedAgentId(entry: ActivityEntry): string | null {
  if (entry.toolName !== "spawn_agent") return null;
  const match = /Agent ID:\s*([^\s]+)/.exec(entry.result);
  return match ? match[1] : null;
}

function strParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveActivityAgent(
  entry: ActivityEntry,
  agents: Agent[],
  taskId: string | null,
): Agent | null {
  const candidates = [
    extractSpawnedAgentId(entry),
    strParam(entry.params, "agentId"),
    strParam(entry.params, "agent_id"),
    entry.agentId !== "unknown" ? entry.agentId : null,
    strParam(entry.params, "name"),
  ].filter((v): v is string => !!v);

  const realAgents = agents.filter((a) => a.role !== "orchestrator");
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    const found = realAgents.find(
      (a) =>
        a.id === candidate ||
        a.name === candidate ||
        a.name.toLowerCase() === normalized,
    );
    if (found) return found;
  }

  if (taskId) {
    const byTask = realAgents.find((a) => a.currentTaskId === taskId);
    if (byTask) return byTask;
  }

  return null;
}

/**
 * 점프 라우팅:
 *   - task: Board 탭으로 setActiveTab + 카드 선택 → navigationStore.requestJump
 *   - agent: 하단 AgentListPanel 은 Layout 에서 항상 마운트되어 있으므로
 *     agentFocusStore 만 set 하면 즉시 FocusView 로 전환. 탭 전환은 불필요.
 *     (예전엔 Agents 탭으로 점프했는데 UX 가 어색해서 변경)
 *
 *   PTY attach 도 함께 — 이 윈도우의 terminalStore 에 세션이 없으면
 *   FocusView 가 "터미널이 없습니다" empty state 만 보이고 활성 채팅이
 *   안 떴다. attachSession 으로 row.ptySessionId 가 잡혀야 TerminalView
 *   가 렌더된다.
 */
function jumpTo(target: { type: "task" | "agent"; id: string }) {
  if (target.type === "agent") {
    // activity.agentId 는 보통 Firestore agent doc id 와 같지만, 일부
    // 경로(MARBLO_AGENT_ID env 가 AgentManager UUID 로 들어간 케이스 등)
    // 에서 doc id 와 다를 수 있다. 그 상태에서 그대로 setFocus 하면
    // AgentListPanel 의 reconcile effect 가 focusedId 를 즉시 null 로
    // 되돌리고 FocusView 가 안 뜬다. id → name 순으로 resolve 해서 실제
    // row.id 로 통일한다.
    const agents = useAgentStore.getState().agents;
    const resolved =
      agents.find((a) => a.id === target.id) ||
      agents.find((a) => a.name === target.id);
    if (!resolved) {
      console.warn(
        "[ActivityStream] jumpTo agent: id not found in agentStore",
        target.id,
      );
      return;
    }
    useAgentFocusStore.getState().setFocusedAgent(resolved.id);
    const icon = MODEL_ICONS[resolved.model] || "⚪";
    useTerminalStore
      .getState()
      .openTerminalForSession(
        `agent-${resolved.id}`,
        `${icon} ${resolved.name}`,
      );
    return;
  }
  useNavigationStore.getState().requestJump(target);
}

/**
 * One row in the stream. Click to expand inline detail (params + result).
 * `content-visibility: auto` lets the browser skip painting offscreen rows
 * — gives most of the benefit of a JS virtualizer with zero deps.
 */
function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const agents = useAgentStore((s) => s.agents);
  const icon = ACTIVITY_TYPE_ICON[entry.type];
  const label = t(ACTIVITY_TYPE_LABEL[entry.type]);
  const taskId = extractTaskId(entry);
  const agent = resolveActivityAgent(entry, agents, taskId);

  // 헤드라인 + detail 모두 activityFormatters 가 담당 —
  // raw result/params 노출 방지 + 'Category: action payload' 통일 포맷.
  // 빈 헤드라인(예: type=other) 이면 toolName 으로 안전망.
  const { headline, details } = formatActivity(entry, t);
  const summary = headline || entry.toolName;

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
          {details.length > 0 && (
            <dl className="space-y-1">
              {details.map((row) => (
                <div key={row.label}>
                  <dt className="text-[#6c7086]">{row.label}:</dt>
                  <dd className="mt-0.5 rounded bg-[#11111b] p-1.5 text-[#cdd6f4] whitespace-pre-wrap break-words max-h-32 overflow-auto">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {(taskId || agent) && (
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
                  📋 {t("activity.ui.openTask")}
                </button>
              )}
              {agent && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpTo({ type: "agent", id: agent.id });
                  }}
                  className="rounded bg-[#cba6f7]/20 px-2 py-1 text-[10px] text-[#cba6f7] hover:bg-[#cba6f7]/30"
                >
                  🤖 {t("activity.ui.viewAgent")}
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
  const { t } = useTranslation();
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
              const count = f === "all" ? entries.length : (counts[f] ?? 0);
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
                  title={f === "all" ? "All" : t(ACTIVITY_TYPE_LABEL[f])}
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
                  ? t("activity.ui.emptyNoActivity")
                  : t("activity.ui.emptyNoFilterMatch")}
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
        {t("activity.ui.footer", { count: 100 })}
      </div>
    </aside>
  );
}
