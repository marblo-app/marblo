import { useState } from 'react';
import type { AgentRole } from '../../types/task';
import { createTask } from '../../services/taskService';

interface TaskCreateModalProps {
  projectId: string;
  onClose: () => void;
}

const ROLES: AgentRole[] = ['backend', 'frontend', 'test', 'devops'];

export function TaskCreateModal({ projectId, onClose }: TaskCreateModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState<AgentRole>('backend');
  const [priority, setPriority] = useState(3);
  const [scope, setScope] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createTask({
        projectId,
        title: title.trim(),
        description: description.trim(),
        status: 'TODO',
        role,
        priority,
        dependsOn: [],
        dependsOnCompleted: false,
        claimedBy: null,
        claimedAt: null,
        scope: scope.trim() ? scope.split(',').map((s) => s.trim()) : [],
        comment: '',
        prUrl: '',
        hasPmFeedback: false,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-gray-800 border border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-100">Create Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              placeholder="Task title"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              rows={3}
              placeholder="Task description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Role *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AgentRole)}
                className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Priority (1-5)</label>
              <input
                type="number"
                min={1}
                max={5}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Scope (comma-separated)</label>
            <input
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full rounded bg-gray-700 border border-gray-600 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              placeholder="src/api.ts, src/utils.ts"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
