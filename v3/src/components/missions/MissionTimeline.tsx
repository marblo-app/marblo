import type { TimelineEvent, TimelineEventType } from "../../types/mission";

const ICONS: Record<TimelineEventType, string> = {
  "step.started": "▶",
  "step.completed": "✅",
  "step.failed": "⚠️",
  "user.input": "💬",
  "user.decision": "✋",
  "agent.dispatched": "🚀",
  "agent.completed": "✅",
  "agent.stuck": "🆘",
  "mission.paused": "⏸",
  "mission.resumed": "▶",
  "supervisor.note": "📝",
};

interface MissionTimelineProps {
  events: TimelineEvent[];
  emptyHint?: string;
}

export function MissionTimeline({ events, emptyHint }: MissionTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 text-center text-sm text-gray-400">
        {emptyHint ?? "아직 활동이 없습니다."}
      </div>
    );
  }
  // 최근 항목이 위로 — orchestrator 가 가장 최근 한 일을 먼저 보여주는 게 자연스럽다.
  const ordered = [...events].sort(
    (a, b) => toDate(b.ts).getTime() - toDate(a.ts).getTime(),
  );
  return (
    <ol className="space-y-1.5">
      {ordered.map((ev, i) => (
        <li
          key={i}
          className="flex gap-3 rounded-lg border border-gray-700/60 bg-gray-800/40 p-2.5 text-sm"
        >
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-base leading-none">
            {ICONS[ev.type] ?? "·"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-gray-200">
                {formatType(ev.type)}
              </span>
              <time className="flex-shrink-0 text-xs text-gray-500">
                {formatTime(ev.ts)}
              </time>
            </div>
            <div className="mt-0.5 truncate text-xs text-gray-400">
              {describe(ev)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string | number);
}

function formatType(t: TimelineEventType): string {
  return t
    .split(".")
    .map((seg) => seg[0].toUpperCase() + seg.slice(1))
    .join(" · ");
}

function formatTime(ts: Date): string {
  return toDate(ts).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function describe(ev: TimelineEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.type) {
    case "step.started":
      return `Step ${num(p.index) + 1} · ${p.skill ?? p.type ?? ""}${
        p.attempt ? ` · 시도 ${p.attempt}` : ""
      }`;
    case "step.completed":
      return `Step ${num(p.index) + 1} · ${p.skill ?? p.type ?? ""}`;
    case "step.failed":
      return `Step ${num(p.index) + 1} · ${p.error ?? "unknown"}${
        p.willRetry ? " · 재시도 예정" : p.policy ? ` · ${p.policy}` : ""
      }`;
    case "agent.dispatched":
      return `Task ${str(p.taskId)}`;
    case "agent.stuck":
      return `Agent ${str(p.agentId)} stuck`;
    case "agent.completed":
      return `Task ${str(p.taskId)}`;
    case "supervisor.note":
      return str(p.message);
    case "mission.paused":
      return `${str(p.kind)}${p.reason ? ` · ${p.reason}` : ""}`;
    case "mission.resumed":
      return `From ${str(p.from)}`;
    case "user.input":
      return str(p.message);
    case "user.decision":
      return str(p.decision);
    default:
      return "";
  }
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
