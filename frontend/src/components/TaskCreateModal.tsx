"use client";

import { useState } from "react";
import { TaskRole, Task } from "@/lib/types";
import { createTask } from "@/lib/api";

interface TaskCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (task: Task) => void;
  existingTasks: Task[];
}

export default function TaskCreateModal({
  isOpen,
  onClose,
  onCreated,
  existingTasks,
}: TaskCreateModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState<TaskRole>(TaskRole.backend);
  const [priority, setPriority] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const task = await createTask({
        title,
        description: description || undefined,
        role,
        priority,
        depends_on: dependsOn.length > 0 ? dependsOn : undefined,
        project_id: projectId.trim() || undefined,
      });
      onCreated(task);
      // Reset form
      setTitle("");
      setDescription("");
      setRole(TaskRole.backend);
      setPriority(0);
      setProjectId("");
      setDependsOn([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDependency = (id: string) => {
    setDependsOn((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Create New Task</h2>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Task title..."
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Task description..."
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Project
              </label>
              <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. my-app, youtube-insight"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-300">
                  Role *
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as TaskRole)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {Object.values(TaskRole).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-300">
                  Priority (0-10)
                </label>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) =>
                    setPriority(Math.max(0, Math.min(10, Number(e.target.value))))
                  }
                  min={0}
                  max={10}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {existingTasks.length > 0 && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-300">
                  Depends On
                </label>
                <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-2">
                  {existingTasks.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={dependsOn.includes(t.id)}
                        onChange={() => toggleDependency(t.id)}
                        className="rounded border-gray-600"
                      />
                      <span className="truncate text-xs text-gray-300">
                        {t.title}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
