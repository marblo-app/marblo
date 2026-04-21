const ROLE_COLORS: Record<string, string> = {
  backend: 'text-green-400',
  frontend: 'text-blue-400',
  test: 'text-yellow-400',
  devops: 'text-purple-400',
};

interface DecompositionResultProps {
  projectName: string;
  tasks: DecomposedTaskDTO[];
  dag: { nodes: string[]; edges: [string, string][] };
  layers: number[][];
}

export function DecompositionResult({ projectName, tasks, dag, layers }: DecompositionResultProps) {
  // Count roles
  const roleCounts: Record<string, number> = {};
  for (const t of tasks) {
    roleCounts[t.role] = (roleCounts[t.role] || 0) + 1;
  }

  const totalHours = tasks.reduce((sum, t) => sum + t.estimatedHours, 0);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-200">분해 결과</h4>
        <span className="text-xs text-gray-500">{projectName}</span>
      </div>

      <div className="grid grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-2xl font-bold text-white">{tasks.length}</p>
          <p className="text-[10px] text-gray-500">태스크</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{layers.length}</p>
          <p className="text-[10px] text-gray-500">레이어</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{dag.edges.length}</p>
          <p className="text-[10px] text-gray-500">의존성</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{totalHours}h</p>
          <p className="text-[10px] text-gray-500">예상 시간</p>
        </div>
      </div>

      {/* Role breakdown */}
      <div className="mt-3 flex items-center gap-3">
        {Object.entries(roleCounts).map(([role, count]) => (
          <span key={role} className={`text-xs ${ROLE_COLORS[role] || 'text-gray-400'}`}>
            {role}: {count}
          </span>
        ))}
      </div>

      {/* Mini DAG */}
      <div className="mt-3 flex items-center gap-1 overflow-x-auto">
        {layers.map((layer, li) => (
          <div key={li} className="flex items-center gap-1">
            <div className="flex gap-0.5">
              {layer.map((idx) => (
                <div
                  key={idx}
                  className="h-2.5 w-2.5 rounded-sm bg-blue-500/60"
                  title={tasks[idx]?.title || `T-${idx + 1}`}
                />
              ))}
            </div>
            {li < layers.length - 1 && (
              <span className="text-gray-600 text-[10px]">&rarr;</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
