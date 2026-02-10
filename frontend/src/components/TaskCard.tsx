"use client";

import { Task, ROLE_COLORS, TaskStatus } from "@/lib/types";

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getPriorityIndicator(priority: number): {
  label: string;
  color: string;
} {
  if (priority >= 8) return { label: "Critical", color: "text-red-400" };
  if (priority >= 5) return { label: "High", color: "text-orange-400" };
  if (priority >= 3) return { label: "Medium", color: "text-yellow-400" };
  return { label: "Low", color: "text-gray-400" };
}

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const priority = getPriorityIndicator(task.priority);
  const isBlocked =
    task.status === TaskStatus.BLOCKED ||
    (task.depends_on &&
      task.depends_on.length > 0 &&
      !task.depends_on_completed);

  return (
    <div
      onClick={() => onClick(task)}
      className="group cursor-pointer rounded-lg border border-gray-800 bg-gray-900 p-3 transition-all hover:border-gray-700 hover:bg-gray-850"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-100 line-clamp-2">
          {task.title}
        </h3>
        <span className={`shrink-0 text-xs font-medium ${priority.color}`}>
          {priority.label}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${ROLE_COLORS[task.role]}`}
        >
          {task.role}
        </span>
        {isBlocked && (
          <span className="inline-flex rounded border border-red-500/30 bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-400">
            Blocked
          </span>
        )}
        {task.pr_url && (
          <span className="inline-flex rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-xs font-medium text-blue-400">
            PR
          </span>
        )}
      </div>

      {task.activities && task.activities.length > 0 && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {task.activities.length}
          </span>
          <span className="truncate text-gray-600">
            {task.activities[task.activities.length - 1].message}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        {task.claimed_by ? (
          <span className="truncate" title={task.claimed_by}>
            {task.claimed_by}
          </span>
        ) : (
          <span className="italic">Unclaimed</span>
        )}
        <span>{timeAgo(task.created_at)}</span>
      </div>
    </div>
  );
}
