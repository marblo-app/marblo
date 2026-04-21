import { useState } from 'react';

const ROLE_COLORS: Record<string, string> = {
  backend: 'bg-green-500/20 text-green-400 border-green-500/30',
  frontend: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  test: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  devops: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const ROLES = ['backend', 'frontend', 'test', 'devops'] as const;

interface TaskPreviewProps {
  tasks: DecomposedTaskDTO[];
  dag: { nodes: string[]; edges: [string, string][] };
  onUpdate: (tasks: DecomposedTaskDTO[]) => void;
  onCreateAll: () => void;
  creating: boolean;
}

export function TaskPreview({ tasks, dag, onUpdate, onCreateAll, creating }: TaskPreviewProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  // Compute layers for DAG visualization
  const layers = computeLayers(tasks, dag);

  const handleFieldChange = (idx: number, field: keyof DecomposedTaskDTO, value: unknown) => {
    const updated = tasks.map((t, i) => (i === idx ? { ...t, [field]: value } : t));
    onUpdate(updated);
  };

  const handleDelete = (idx: number) => {
    const taskId = `TASK-${String(idx + 1).padStart(3, '0')}`;
    const updated = tasks
      .filter((_, i) => i !== idx)
      .map((t) => ({
        ...t,
        depends_on: t.depends_on.filter((d) => d.toUpperCase() !== taskId.toUpperCase()),
      }));
    onUpdate(updated);
  };

  const handleAdd = () => {
    onUpdate([
      ...tasks,
      {
        title: '새 태스크',
        description: '',
        role: 'backend',
        priority: 3,
        depends_on: [],
        scope: [],
        estimatedHours: 1,
      },
    ]);
  };

  return (
    <div className="space-y-4">
      {/* DAG Mini View */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
        <h4 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">실행 레이어 (DAG)</h4>
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {layers.map((layer, layerIdx) => (
            <div key={layerIdx} className="flex flex-col items-center gap-2">
              <span className="text-[10px] font-medium text-gray-500">Layer {layerIdx + 1}</span>
              <div className="flex flex-col gap-1.5">
                {layer.map((taskIdx) => {
                  const task = tasks[taskIdx];
                  if (!task) return null;
                  return (
                    <div
                      key={taskIdx}
                      className={`rounded border px-2 py-1 text-[11px] ${ROLE_COLORS[task.role] || ROLE_COLORS.backend}`}
                    >
                      T-{taskIdx + 1}
                    </div>
                  );
                })}
              </div>
              {layerIdx < layers.length - 1 && (
                <svg className="h-4 w-4 text-gray-600 -mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {tasks.map((task, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-gray-700 bg-gray-800 p-3"
          >
            {editingIdx === idx ? (
              /* Edit mode */
              <div className="space-y-2">
                <input
                  value={task.title}
                  onChange={(e) => handleFieldChange(idx, 'title', e.target.value)}
                  className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                />
                <textarea
                  value={task.description}
                  onChange={(e) => handleFieldChange(idx, 'description', e.target.value)}
                  rows={2}
                  className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                  placeholder="설명..."
                />
                <div className="flex items-center gap-3">
                  <select
                    value={task.role}
                    onChange={(e) => handleFieldChange(idx, 'role', e.target.value)}
                    className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    P:
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={task.priority}
                      onChange={(e) => handleFieldChange(idx, 'priority', parseInt(e.target.value) || 3)}
                      className="w-12 rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-xs text-gray-200"
                    />
                  </label>
                  <button
                    onClick={() => setEditingIdx(null)}
                    className="ml-auto rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    완료
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">T-{idx + 1}</span>
                    <span className="text-sm font-medium text-gray-200 truncate">{task.title}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${ROLE_COLORS[task.role] || ROLE_COLORS.backend}`}>
                      {task.role}
                    </span>
                    <span className="text-[10px] text-gray-500">P{task.priority}</span>
                    {task.depends_on.length > 0 && (
                      <span className="text-[10px] text-gray-500">
                        deps: {task.depends_on.join(', ')}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-500">{task.estimatedHours}h</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingIdx(idx)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                    title="편집"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(idx)}
                    className="rounded p-1 text-gray-400 hover:bg-red-900/30 hover:text-red-400"
                    title="삭제"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleAdd}
          className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          + 태스크 추가
        </button>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">{tasks.length}개 태스크</span>
        <button
          onClick={onCreateAll}
          disabled={creating || tasks.length === 0}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? '생성 중...' : '칸반에 생성'}
        </button>
      </div>
    </div>
  );
}

/** Compute parallel execution layers from DAG using Kahn's algorithm */
function computeLayers(
  tasks: DecomposedTaskDTO[],
  dag: { nodes: string[]; edges: [string, string][] },
): number[][] {
  const n = tasks.length;
  if (n === 0) return [];

  const inDegree = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (const [from, to] of dag.edges) {
    const fi = parseInt(from.replace(/^TASK-/i, ''), 10) - 1;
    const ti = parseInt(to.replace(/^TASK-/i, ''), 10) - 1;
    if (fi >= 0 && fi < n && ti >= 0 && ti < n) {
      adj[fi].push(ti);
      inDegree[ti]++;
    }
  }

  const layers: number[][] = [];
  let queue = inDegree.map((d, i) => (d === 0 ? i : -1)).filter((i) => i >= 0);

  while (queue.length > 0) {
    layers.push(queue);
    const next: number[] = [];
    for (const node of queue) {
      for (const neighbor of adj[node]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          next.push(neighbor);
        }
      }
    }
    queue = next;
  }

  return layers;
}
