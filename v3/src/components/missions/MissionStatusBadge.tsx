import type { MissionStatus } from "../../types/mission";

const STYLES: Record<
  MissionStatus,
  { label: string; className: string; emoji: string }
> = {
  planning: {
    label: "Planning",
    className: "bg-gray-700/50 text-gray-300 border-gray-600",
    emoji: "🧭",
  },
  active: {
    label: "Active",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    emoji: "▶",
  },
  waiting_for_human: {
    label: "Needs You",
    className: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    emoji: "❓",
  },
  sleeping: {
    label: "Sleeping",
    className: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    emoji: "💤",
  },
  completed: {
    label: "Completed",
    className: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    emoji: "✅",
  },
  abandoned: {
    label: "Abandoned",
    className: "bg-red-500/10 text-red-400 border-red-500/30",
    emoji: "🛑",
  },
};

export function MissionStatusBadge({
  status,
  compact = false,
}: {
  status: MissionStatus;
  compact?: boolean;
}) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      <span>{s.emoji}</span>
      {!compact && <span>{s.label}</span>}
    </span>
  );
}
