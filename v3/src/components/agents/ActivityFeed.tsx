import { useState, useEffect, useRef } from "react";
import { where, limit } from "firebase/firestore";
import type { Agent } from "../../types/agent";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../../services/firestore";
import { useTranslation } from "../../lib/i18n";

type TFn = ReturnType<typeof useTranslation>["t"];

interface ActivityFeedProps {
  projectId: string;
  agents: Agent[];
}

interface ProjectActivity {
  id: string;
  taskId: string;
  agentId: string;
  message: string;
  createdAt: Date;
}

const DATE_FIELDS = ["createdAt"];

function toActivity(raw: Record<string, unknown>): ProjectActivity {
  return convertTimestamps<ProjectActivity>(raw, DATE_FIELDS);
}

export default function ActivityFeed({ projectId, agents }: ActivityFeedProps) {
  const { t, locale } = useTranslation();
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  // Agent lookup map
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  useEffect(() => {
    if (!projectId) {
      setActivities([]);
      setLoading(false);
      return;
    }

    // Subscribe to recent activities across all tasks in the project
    // We get all activities and filter by agents belonging to this project
    setLoading(true);

    const agentIds = agents.map((a) => a.id);
    if (agentIds.length === 0) {
      setActivities([]);
      setLoading(false);
      return;
    }

    // Firestore 'in' query supports up to 30 items
    const queryAgentIds = agentIds.slice(0, 30);

    const unsubscribe = subscribeToCollection<Record<string, unknown>>(
      "activities",
      [where("agentId", "in", queryAgentIds), limit(50)],
      (docs) => {
        setActivities(
          docs
            .map(toActivity)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        );
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [projectId, agents]);

  // Auto-scroll to top on new activities
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [activities.length]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-300">
          Activity Feed
        </h3>
        <div className="flex items-center justify-center py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-300">Activity Feed</h3>

      {activities.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-600">
          {t("activity.ui.feedEmptyShort")}
        </p>
      ) : (
        <div ref={feedRef} className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {activities.map((activity) => {
            const agent = agentMap.get(activity.agentId);
            return (
              <div
                key={activity.id}
                className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-700"
              >
                {/* Agent icon */}
                <div className="mt-0.5 shrink-0">
                  {agent ? (
                    <span className="text-sm">
                      {agent.model === "claude"
                        ? "🟣"
                        : agent.model === "gemini"
                          ? "🔵"
                          : agent.model === "gpt"
                            ? "🟢"
                            : "⚪"}
                    </span>
                  ) : (
                    <span className="text-sm">⚪</span>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-300">
                      {agent?.name || activity.agentId}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {formatTime(activity.createdAt, t, locale)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400 break-words">
                    {activity.message}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTime(date: Date, t: TFn, locale: string): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("activity.time.justNow");
  if (mins < 60) return t("activity.time.minutesAgo", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("activity.time.hoursAgo", { n: hrs });
  return date.toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
  });
}
