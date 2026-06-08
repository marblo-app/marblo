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
  // 지휘자가 합성한 오케 task 이벤트. status 는 payload.to 에 따라 iconFor() 에서
  // 동적으로 덮어쓴다(DONE ✅ / FAILED ⚠️) — 여기 값은 그 외 상태의 fallback.
  "task.status": "🔄",
  "task.activity": "⚙️",
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
    (a, b) => toDate(b.ts).getTime() - toDate(a.ts).getTime()
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
        {iconFor(ev)}
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
          className={`mt-0.5 text-xs ${bodyTone(ev)} ${
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
    case "task.status": {
      // 오케 task 상태전이: from → to + taskTitle. 색상은 bodyTone() 이 담당.
      const from = str(p.from);
      const to = str(p.to);
      const transition = from ? `${from} → ${to}` : to;
      const parts = [transition];
      if (p.taskTitle) parts.push(`· ${str(p.taskTitle)}`);
      return parts.filter(Boolean).join(" ");
    }
    case "task.activity": {
      // 에이전트 내레이션: message 본문 + 보조표시(taskTitle / agentId).
      const aux = [str(p.taskTitle), str(p.agentId)].filter(Boolean);
      const parts = [str(p.message)];
      if (aux.length) parts.push(`· ${aux.join(" · ")}`);
      return parts.filter(Boolean).join(" ");
    }
    default:
      return "";
  }
}

// task.status 는 결과(payload.to)에 따라 아이콘을 동적으로 — 그 외는 ICONS 맵.
function iconFor(ev: TimelineEvent): string {
  if (ev.type === "task.status") {
    const to = str((ev.payload as Record<string, unknown>).to);
    if (to === "DONE") return "✅";
    if (to === "FAILED") return "⚠️";
    return ICONS["task.status"];
  }
  return ICONS[ev.type] ?? "·";
}

// task.status 본문 색상: DONE 성공색 / FAILED 경고색 / 그 외 기본.
function bodyTone(ev: TimelineEvent): string {
  if (ev.type === "task.status") {
    const to = str((ev.payload as Record<string, unknown>).to);
    if (to === "DONE") return "text-emerald-300";
    if (to === "FAILED") return "text-red-300";
  }
  return "text-gray-400";
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
