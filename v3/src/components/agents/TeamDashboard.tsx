import { useEffect, useMemo } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import MemberCard from "./MemberCard";
import UnifiedActivityFeed from "./UnifiedActivityFeed";
import { t, useTranslation } from "../../lib/i18n";

function formatAvgTime(
  tasks: { claimedAt: Date | null; updatedAt: Date }[],
): string {
  const completed = tasks.filter((t) => t.claimedAt);
  if (completed.length === 0) return "-";
  const totalMs = completed.reduce((sum, t) => {
    return (
      sum +
      (t.updatedAt.getTime() -
        (t.claimedAt?.getTime() ?? t.updatedAt.getTime()))
    );
  }, 0);
  const avgMin = Math.round(totalMs / completed.length / 60000);
  if (avgMin < 60) return t("agents.time.minutes", { count: avgMin });
  const hours = Math.floor(avgMin / 60);
  const mins = avgMin % 60;
  return t("agents.time.hoursMinutes", { hours, mins });
}

export default function TeamDashboard() {
  const agents = useAgentStore((s) => s.agents);
  const loading = useAgentStore((s) => s.loading);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const currentProject = useProjectStore((s) => s.currentProject);
  const { t, locale } = useTranslation();

  // Subscribe to real-time data
  useEffect(() => {
    if (!currentProject?.id) return;
    const unsubAgents = subscribeToAgents(currentProject.id);
    const unsubTasks = subscribeToTasks(currentProject.id);
    return () => {
      unsubAgents();
      unsubTasks();
    };
  }, [currentProject?.id, subscribeToAgents, subscribeToTasks]);

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const doneTasks = tasks.filter((t) => t.status === "DONE");
    const doneToday = doneTasks.filter((t) => t.updatedAt >= todayStart);
    const doneThisWeek = doneTasks.filter((t) => t.updatedAt >= weekStart);

    const onlineCount = agents.filter(
      (a) => a.status === "working" || a.status === "idle",
    ).length;

    return {
      totalMembers: agents.length,
      onlineCount,
      doneToday: doneToday.length,
      doneThisWeek: doneThisWeek.length,
      avgTime: formatAvgTime(doneTasks),
      inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
    };
    // locale: re-run formatAvgTime when the UI language changes.
  }, [agents, tasks, locale]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">
            {t("agents.team.title")}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {currentProject?.name ?? t("agents.team.project")} ·{" "}
            {t("agents.team.members", { count: stats.totalMembers })} ·{" "}
            <span className="text-green-400">
              {t("agents.team.online", { count: stats.onlineCount })}
            </span>
          </p>
        </div>
      </div>

      {/* Performance stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t("agents.team.doneToday")}
          value={stats.doneToday}
          accent="text-green-400"
        />
        <StatCard
          label={t("agents.team.doneThisWeek")}
          value={stats.doneThisWeek}
          accent="text-blue-400"
        />
        <StatCard
          label={t("agents.stats.inProgress")}
          value={stats.inProgress}
          accent="text-yellow-400"
        />
        <StatCard
          label={t("agents.team.avgTime")}
          value={stats.avgTime}
          accent="text-purple-400"
        />
      </div>

      {/* Member grid */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-300">
          {t("agents.team.membersHeading")}
        </h3>
        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 py-12 text-center text-sm text-gray-500">
            {t("agents.team.noAgents")}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <MemberCard key={agent.id} agent={agent} tasks={tasks} />
            ))}
          </div>
        )}
      </div>

      {/* Unified activity feed */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-300">
          {t("agents.team.activity")}
        </h3>
        <UnifiedActivityFeed agents={agents} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
