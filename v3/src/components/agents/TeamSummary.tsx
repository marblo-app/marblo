import type { Agent, AgentStatus } from '../../types/agent';
import type { Task } from '../../types/task';

interface TeamSummaryProps {
  agents: Agent[];
  tasks: Task[];
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; bg: string }> = {
  working: { label: 'Active', color: 'text-green-400', bg: 'bg-green-500' },
  idle: { label: 'Idle', color: 'text-yellow-400', bg: 'bg-yellow-500' },
  error: { label: 'Error', color: 'text-red-400', bg: 'bg-red-500' },
  stopped: { label: 'Stopped', color: 'text-gray-500', bg: 'bg-gray-600' },
};

export default function TeamSummary({ agents, tasks }: TeamSummaryProps) {
  const statusCounts: Record<AgentStatus, number> = {
    working: 0,
    idle: 0,
    error: 0,
    stopped: 0,
  };
  for (const agent of agents) {
    statusCounts[agent.status]++;
  }

  const doneTasks = tasks.filter((t) => t.status === 'DONE').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'CLAIMED').length;

  // Donut chart data
  const total = agents.length || 1;
  const segments = (['working', 'idle', 'error', 'stopped'] as AgentStatus[])
    .filter((s) => statusCounts[s] > 0)
    .map((s) => ({
      status: s,
      count: statusCounts[s],
      pct: (statusCounts[s] / total) * 100,
      ...STATUS_CONFIG[s],
    }));

  let cumulativePct = 0;
  const donutSegments = segments.map((seg) => {
    const offset = cumulativePct;
    cumulativePct += seg.pct;
    return { ...seg, offset };
  });

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-center gap-6">
        {/* Donut Chart */}
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
            {agents.length === 0 ? (
              <circle
                cx="18" cy="18" r="14"
                fill="none" stroke="#374151" strokeWidth="4"
              />
            ) : (
              donutSegments.map((seg) => (
                <circle
                  key={seg.status}
                  cx="18" cy="18" r="14"
                  fill="none"
                  stroke={seg.bg.replace('bg-', '')}
                  strokeWidth="4"
                  strokeDasharray={`${seg.pct * 0.88} ${88 - seg.pct * 0.88}`}
                  strokeDashoffset={`${-seg.offset * 0.88}`}
                  className={seg.bg.replace('bg-', 'stroke-')}
                />
              ))
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-gray-100">{agents.length}</span>
            <span className="text-[10px] text-gray-500">agents</span>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {(['working', 'idle', 'error', 'stopped'] as AgentStatus[]).map((status) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${STATUS_CONFIG[status].bg}`} />
              <span className={`text-sm ${STATUS_CONFIG[status].color}`}>
                {statusCounts[status]}
              </span>
              <span className="text-xs text-gray-500">{STATUS_CONFIG[status].label}</span>
            </div>
          ))}
        </div>

        {/* Separator */}
        <div className="h-14 w-px bg-gray-700" />

        {/* Task Stats */}
        <div className="flex gap-6">
          <div className="text-center">
            <div className="text-xl font-bold text-blue-400">{inProgressTasks}</div>
            <div className="text-xs text-gray-500">진행 중</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-400">{doneTasks}</div>
            <div className="text-xs text-gray-500">완료</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-gray-400">{tasks.length}</div>
            <div className="text-xs text-gray-500">전체 태스크</div>
          </div>
        </div>
      </div>
    </div>
  );
}
