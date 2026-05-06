import { useEffect, useMemo } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  ACTIVITY_TYPE_ICON,
  ACTIVITY_TYPE_LABEL,
  type ActivityEntry,
} from "../../services/activityStreamService";

const STATUS_DOT: Record<string, string> = {
  working: "bg-[#a6e3a1]",
  idle: "bg-[#89b4fa]",
  error: "bg-[#f38ba8]",
  stopped: "bg-[#6c7086]",
};

const TASK_STATUS_LABEL = [
  { key: "TODO", label: "TODO", color: "text-[#6c7086]" },
  { key: "CLAIMED", label: "CLAIMED", color: "text-[#89b4fa]" },
  { key: "IN_PROGRESS", label: "WIP", color: "text-[#fab387]" },
  { key: "REVIEW", label: "REVIEW", color: "text-[#f9e2af]" },
  { key: "DONE", label: "DONE", color: "text-[#a6e3a1]" },
  { key: "BLOCKED", label: "BLOCK", color: "text-[#f38ba8]" },
] as const;

interface MacroViewProps {
  entries: ActivityEntry[];
  onSelectAgent: (agentId: string) => void;
}

export function MacroView({ entries, onSelectAgent }: MacroViewProps) {
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);

  // Drive our own subscriptions while macro view is mounted — other tabs may
  // not have subscribed yet (e.g. user is on the Code tab and opens the
  // panel). When the view unmounts, listeners are torn down.
  useEffect(() => {
    if (!currentProject?.id) return;
    const ua = subscribeToAgents(currentProject.id);
    const ut = subscribeToTasks(currentProject.id);
    return () => {
      ua();
      ut();
    };
  }, [currentProject?.id, subscribeToAgents, subscribeToTasks]);

  const taskCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of tasks) out[t.status] = (out[t.status] ?? 0) + 1;
    return out;
  }, [tasks]);

  const totalCost = useMemo(
    () => agents.reduce((sum, a) => sum + (a.totalCost ?? 0), 0),
    [agents]
  );
  const totalTokens = useMemo(
    () =>
      agents.reduce(
        (sum, a) =>
          sum + (a.totalInputTokens ?? 0) + (a.totalOutputTokens ?? 0),
        0
      ),
    [agents]
  );

  // Errors / recent counts derived from the audit_logs window. One hour =
  // 3,600,000 ms. The stream is capped at 100 so this is naturally bounded.
  const oneHourAgo = Date.now() - 3_600_000;
  const recentEntries = useMemo(
    () => entries.filter((e) => e.createdAt.getTime() >= oneHourAgo),
    [entries, oneHourAgo]
  );
  const errorCount = recentEntries.filter((e) => e.type === "error").length;
  const lastError = recentEntries.find((e) => e.type === "error");

  const recentTypeCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of recentEntries) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }, [recentEntries]);
  const topRecent = Object.entries(recentTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3">
      {/* Task status grid */}
      <section>
        <h3 className="mb-1 px-1 text-[10px] uppercase tracking-wide text-[#6c7086]">
          Tasks
        </h3>
        <div className="grid grid-cols-3 gap-1">
          {TASK_STATUS_LABEL.map((s) => (
            <div
              key={s.key}
              className="rounded border border-[#313244] bg-[#11111b] px-2 py-1.5"
            >
              <div className={`text-base font-semibold ${s.color}`}>
                {taskCounts[s.key] ?? 0}
              </div>
              <div className="text-[9px] uppercase text-[#6c7086]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Active agents */}
      <section>
        <h3 className="mb-1 px-1 text-[10px] uppercase tracking-wide text-[#6c7086]">
          Agents · {agents.length}
        </h3>
        {agents.length === 0 && (
          <p className="px-1 py-2 text-[10px] text-[#6c7086]">
            활성 에이전트가 없습니다.
          </p>
        )}
        <div className="space-y-0.5">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAgent(a.id)}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-[#262640] transition-colors"
              title={`${a.role} · ${a.model}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  STATUS_DOT[a.status] ?? STATUS_DOT.stopped
                }`}
              />
              <span className="flex-1 truncate text-[11px] text-[#cdd6f4]">
                {a.name}
              </span>
              <span className="text-[10px] text-[#6c7086]">{a.model}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Cost / tokens summary */}
      <section className="rounded border border-[#313244] bg-[#11111b] p-2">
        <h3 className="mb-1 text-[10px] uppercase tracking-wide text-[#6c7086]">
          Usage (cumulative)
        </h3>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <div>
            <div className="text-[#cdd6f4] font-medium">
              ${totalCost.toFixed(2)}
            </div>
            <div className="text-[9px] text-[#6c7086]">cost</div>
          </div>
          <div>
            <div className="text-[#cdd6f4] font-medium">
              {(totalTokens / 1000).toFixed(1)}k
            </div>
            <div className="text-[9px] text-[#6c7086]">tokens</div>
          </div>
        </div>
      </section>

      {/* Recent activity (last hour) */}
      <section>
        <h3 className="mb-1 px-1 text-[10px] uppercase tracking-wide text-[#6c7086]">
          Last hour · {recentEntries.length}
        </h3>
        <div className="space-y-1">
          {topRecent.length === 0 ? (
            <p className="px-1 text-[10px] text-[#6c7086]">최근 활동 없음.</p>
          ) : (
            topRecent.map(([type, n]) => (
              <div
                key={type}
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px]"
              >
                <span>
                  {ACTIVITY_TYPE_ICON[type as keyof typeof ACTIVITY_TYPE_ICON]}
                </span>
                <span className="flex-1 text-[#bac2de] truncate">
                  {
                    ACTIVITY_TYPE_LABEL[
                      type as keyof typeof ACTIVITY_TYPE_LABEL
                    ]
                  }
                </span>
                <span className="text-[#6c7086]">{n}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Errors */}
      {errorCount > 0 && (
        <section className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 p-2">
          <h3 className="mb-1 text-[10px] uppercase tracking-wide text-[#f38ba8]">
            Errors · {errorCount}
          </h3>
          {lastError && (
            <p className="text-[10px] text-[#bac2de] line-clamp-2 break-all">
              <span className="text-[#6c7086]">{lastError.toolName}:</span>{" "}
              {lastError.result.slice(0, 120) || "no detail"}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
