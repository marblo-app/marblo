import { useState } from "react";
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
        <TimelineRow key={i} event={ev} />
      ))}
    </ol>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const ev = event;
  const isExpandable =
    ev.type === "supervisor.note" ||
    ev.type === "step.completed" ||
    ev.type === "step.failed";
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      className={`flex gap-3 rounded-lg border border-gray-700/60 bg-gray-800/40 p-2.5 text-sm ${
        isExpandable ? "cursor-pointer hover:bg-gray-800/70" : ""
      }`}
      onClick={() => isExpandable && setExpanded((v) => !v)}
    >
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-base leading-none">
        {ICONS[ev.type] ?? "·"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-gray-200">
            {formatType(ev.type)}
          </span>
          <div className="flex flex-shrink-0 items-center gap-2 text-xs text-gray-500">
            {isExpandable && <span>{expanded ? "▾" : "▸"}</span>}
            <time>{formatTime(ev.ts)}</time>
          </div>
        </div>
        <div
          className={`mt-0.5 text-xs text-gray-400 ${
            ev.type === "supervisor.note" || expanded
              ? "whitespace-pre-wrap break-words"
              : "truncate"
          }`}
        >
          {describe(ev)}
        </div>
        {expanded && (
          <pre className="mt-2 max-h-96 overflow-y-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">
            {prettyPayload(ev.payload)}
          </pre>
        )}
      </div>
    </li>
  );
}

function prettyPayload(p: Record<string, unknown>): string {
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return String(p);
  }
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
    case "supervisor.note": {
      const parts = [str(p.message)];
      if (p.templateLabel) parts.push(`· ${str(p.templateLabel)}`);
      if (p.goal) parts.push(`· "${str(p.goal)}"`);
      return parts.filter(Boolean).join(" ");
    }
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
