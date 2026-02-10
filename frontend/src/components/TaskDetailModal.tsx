"use client";

import { useState, useEffect, useRef } from "react";
import {
  Task,
  TaskStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  ROLE_COLORS,
  ActivityLog,
  getAgentColor,
} from "@/lib/types";
import {
  updateTask,
  deleteTask,
  approveTask,
  rejectTask,
  getTaskActivities,
  addTaskActivity,
} from "@/lib/api";

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

function isSystemActivity(activity: ActivityLog): boolean {
  if (!activity.agent_id) return true;
  const systemPrefixes = ["status changed", "task created", "task claimed", "submitted for review", "task approved", "task rejected"];
  return systemPrefixes.some((p) => activity.message.toLowerCase().startsWith(p));
}

interface TaskDetailModalProps {
  task: Task | null;
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (taskId: string) => void;
}

export default function TaskDetailModal({
  task,
  onClose,
  onUpdated,
  onDeleted,
}: TaskDetailModalProps) {
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [activityComment, setActivityComment] = useState("");
  const [activityLoading, setActivityLoading] = useState(false);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Fetch activities when task changes
  useEffect(() => {
    if (!task) {
      setActivities([]);
      return;
    }
    // Use activities from task object if available, otherwise fetch
    if (task.activities && task.activities.length > 0) {
      setActivities(task.activities);
    } else {
      getTaskActivities(task.id)
        .then(setActivities)
        .catch(() => setActivities([]));
    }
  }, [task]);

  // Sync when task.activities updates from SSE
  useEffect(() => {
    if (task?.activities) {
      setActivities(task.activities);
    }
  }, [task?.activities]);

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  const handleAddComment = async () => {
    if (!task || !activityComment.trim()) return;
    setActivityLoading(true);
    try {
      const newActivity = await addTaskActivity(task.id, activityComment.trim(), "pm");
      setActivities((prev) => {
        if (prev.some((a) => a.id === newActivity.id)) return prev;
        return [...prev, newActivity];
      });
      setActivityComment("");
    } catch {
      // silently fail
    } finally {
      setActivityLoading(false);
    }
  };

  if (!task) return null;

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await approveTask(task.id);
      onUpdated(updated);
      setComment("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!comment.trim()) {
      setError("A comment is required when rejecting a task");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await rejectTask(task.id, comment);
      onUpdated(updated);
      setComment("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onDeleted(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setLoading(false);
    }
  };

  const handleResolveBlock = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await updateTask(task.id, {
        status: TaskStatus.TODO,
        comment: comment || "Unblocked",
      });
      onUpdated(updated);
      setComment("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold text-white ${STATUS_COLORS[task.status]}`}
            >
              {STATUS_LABELS[task.status]}
            </span>
            <span
              className={`rounded border px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[task.role]}`}
            >
              {task.role}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          <h2 className="mb-4 text-xl font-semibold text-white">{task.title}</h2>

          {task.description && (
            <div className="mb-4">
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Description
              </h3>
              <p className="whitespace-pre-wrap text-sm text-gray-300">
                {task.description}
              </p>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Priority
              </h3>
              <p className="text-sm text-gray-200">{task.priority}</p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Claimed By
              </h3>
              <p className="text-sm text-gray-200">
                {task.claimed_by || "Unclaimed"}
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Created
              </h3>
              <p className="text-sm text-gray-200">
                {formatDate(task.created_at)}
              </p>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Updated
              </h3>
              <p className="text-sm text-gray-200">
                {formatDate(task.updated_at)}
              </p>
            </div>
          </div>

          {task.depends_on && task.depends_on.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Dependencies
              </h3>
              <div className="flex flex-wrap gap-1">
                {task.depends_on.map((dep) => (
                  <span
                    key={dep}
                    className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
                  >
                    {dep.slice(0, 8)}...
                  </span>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {task.depends_on_completed
                  ? "All dependencies met"
                  : "Dependencies pending"}
              </p>
            </div>
          )}

          {task.pr_url && (
            <div className="mb-4">
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Pull Request
              </h3>
              <a
                href={task.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:underline"
              >
                {task.pr_url}
              </a>
            </div>
          )}

          {task.comment && (
            <div className="mb-4">
              <h3 className="mb-1 text-sm font-medium text-gray-400">
                Comment
              </h3>
              <p className="whitespace-pre-wrap rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm text-gray-300">
                {task.comment}
              </p>
            </div>
          )}

          {/* Activity Log */}
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-gray-400">
              Activity Log
              {activities.length > 0 && (
                <span className="ml-2 rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-500">
                  {activities.length}
                </span>
              )}
            </h3>
            <div className="rounded-lg border border-gray-800 bg-gray-900/50">
              <div className="max-h-64 overflow-y-auto p-3">
                {activities.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-600">
                    No activity yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activities.map((activity) => {
                      const system = isSystemActivity(activity);
                      const colors = getAgentColor(activity.agent_id);
                      return (
                        <div
                          key={activity.id}
                          className={`flex gap-3 ${system ? "opacity-60" : ""}`}
                        >
                          {/* Agent indicator */}
                          <div className="flex flex-col items-center pt-0.5">
                            <div
                              className={`h-6 w-6 shrink-0 rounded-full ${system ? "bg-gray-700" : colors.bg} flex items-center justify-center`}
                            >
                              {system ? (
                                <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              ) : (
                                <span className="text-xs font-bold text-white">
                                  {(activity.agent_id || "?")[0].toUpperCase()}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Content */}
                          <div
                            className={`min-w-0 flex-1 rounded-lg px-3 py-2 ${
                              system
                                ? "bg-transparent"
                                : `border-l-2 ${colors.border} bg-gray-800/50`
                            }`}
                          >
                            <div className="mb-0.5 flex items-center gap-2">
                              <span
                                className={`text-xs font-medium ${system ? "text-gray-500" : colors.text}`}
                              >
                                {activity.agent_id || "system"}
                              </span>
                              <span className="text-xs text-gray-600">
                                {timeAgo(activity.created_at)}
                              </span>
                            </div>
                            <p
                              className={`text-sm ${system ? "text-gray-500 italic" : "text-gray-300"}`}
                            >
                              {activity.message}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={activityEndRef} />
                  </div>
                )}
              </div>
              {/* Comment input */}
              <div className="flex gap-2 border-t border-gray-800 p-3">
                <input
                  type="text"
                  value={activityComment}
                  onChange={(e) => setActivityComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  placeholder="Add a comment as PM..."
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddComment}
                  disabled={activityLoading || !activityComment.trim()}
                  className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Comment input for actions */}
          {(task.status === TaskStatus.REVIEW ||
            task.status === TaskStatus.BLOCKED) && (
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Comment
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Add a comment..."
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-800 px-6 py-4">
          {task.status === TaskStatus.REVIEW && (
            <>
              <button
                onClick={handleReject}
                disabled={loading || !comment.trim()}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={loading}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
              >
                Approve
              </button>
            </>
          )}

          {task.status === TaskStatus.TODO && (
            <button
              onClick={handleDelete}
              disabled={loading}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              Delete
            </button>
          )}

          {task.status === TaskStatus.BLOCKED && (
            <button
              onClick={handleResolveBlock}
              disabled={loading}
              className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-500 disabled:opacity-50"
            >
              Resolve Block
            </button>
          )}

          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
