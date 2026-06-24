import { useEffect, useRef, useState, useMemo } from "react";
import { Agent, ModelType } from "../../types";
import { Activity } from "../../types";
import { subscribeToCollection } from "../../services/firestore";
import { where, limit } from "firebase/firestore";
import { useTranslation } from "../../lib/i18n";

type TFn = ReturnType<typeof useTranslation>["t"];

interface UnifiedActivityFeedProps {
  agents: Agent[];
}

const memberColors: string[] = [
  "border-purple-500",
  "border-blue-500",
  "border-green-500",
  "border-yellow-500",
  "border-pink-500",
  "border-cyan-500",
  "border-orange-500",
  "border-red-500",
];

const memberTextColors: string[] = [
  "text-purple-400",
  "text-blue-400",
  "text-green-400",
  "text-yellow-400",
  "text-pink-400",
  "text-cyan-400",
  "text-orange-400",
  "text-red-400",
];

const modelEmoji: Record<ModelType, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
  custom: "⚪",
};

function formatRelativeTime(date: Date, t: TFn): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("activity.time.justNow");
  if (diffMin < 60) return t("activity.time.minutesAgo", { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("activity.time.hoursAgo", { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  return t("activity.time.daysAgo", { n: diffDay });
}

type FilterType = "all" | string; // 'all' or agentId

export default function UnifiedActivityFeed({
  agents,
}: UnifiedActivityFeedProps) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Map agent IDs to color indices for consistent color coding
  const agentColorMap = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach((a, i) => map.set(a.id, i % memberColors.length));
    return map;
  }, [agents]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    agents.forEach((a) => map.set(a.id, a));
    return map;
  }, [agents]);

  // Subscribe to activities from all agents
  useEffect(() => {
    if (agents.length === 0) return;

    const agentIds = agents.map((a) => a.id);
    // Firestore 'in' queries support max 30 items
    const chunks: string[][] = [];
    for (let i = 0; i < agentIds.length; i += 30) {
      chunks.push(agentIds.slice(i, i + 30));
    }

    const unsubscribers: (() => void)[] = [];

    chunks.forEach((chunk) => {
      const unsub = subscribeToCollection<Activity>(
        "activities",
        [where("agentId", "in", chunk), limit(100)],
        (items) => {
          setActivities((prev) => {
            // Merge and deduplicate
            const merged = new Map<string, Activity>();
            prev.forEach((a) => merged.set(a.id, a));
            items.forEach((a) => merged.set(a.id, a));
            return Array.from(merged.values()).sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );
          });
        },
      );
      unsubscribers.push(unsub);
    });

    return () => unsubscribers.forEach((u) => u());
  }, [agents]);

  // Auto-scroll to top (latest) on new activities
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activities.length]);

  const filteredActivities = useMemo(() => {
    if (filter === "all") return activities;
    return activities.filter((a) => a.agentId === filter);
  }, [activities, filter]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100">
          {t("activity.ui.feedTitle")}
        </h3>
        <span className="text-xs text-gray-500">
          {t("activity.ui.feedCount", { count: filteredActivities.length })}
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
            filter === "all"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
          }`}
        >
          {t("activity.ui.feedAll")}
        </button>
        {agents.map((agent) => {
          const isActive = filter === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => setFilter(agent.id)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
              }`}
            >
              {modelEmoji[agent.model]} {agent.name}
            </button>
          );
        })}
      </div>

      {/* Activity list */}
      <div ref={scrollRef} className="max-h-80 overflow-y-auto space-y-1.5">
        {filteredActivities.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            {t("activity.ui.feedEmpty")}
          </div>
        ) : (
          filteredActivities.map((activity) => {
            const agent = agentMap.get(activity.agentId);
            const colorIdx = agentColorMap.get(activity.agentId) ?? 0;

            return (
              <div
                key={activity.id}
                className={`rounded border-l-2 ${memberColors[colorIdx]} bg-gray-750 px-3 py-2`}
                style={{ backgroundColor: "rgb(38, 42, 51)" }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {agent && (
                    <span
                      className={`text-xs font-medium ${memberTextColors[colorIdx]}`}
                    >
                      {modelEmoji[agent.model]} {agent.name}
                    </span>
                  )}
                  <span className="text-xs text-gray-600">·</span>
                  <span className="text-xs text-gray-500">
                    {formatRelativeTime(activity.createdAt, t)}
                  </span>
                </div>
                <p className="text-sm text-gray-300">{activity.message}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
