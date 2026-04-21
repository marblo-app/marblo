import { useState } from 'react';
import type { Flow, FlowNode, FlowEdge } from '../../types/flow';

interface FlowListProps {
  flows: Flow[];
  selectedFlowId: string | null;
  onSelect: (flowId: string) => void;
  onCreate: (name: string, preset?: { nodes: FlowNode[]; edges: FlowEdge[]; description?: string }) => Promise<string>;
  onDelete: (flowId: string) => Promise<void>;
}

export function FlowList({ flows, selectedFlowId, onSelect, onCreate, onDelete }: FlowListProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName('');
    setCreating(false);
  };

  const handleDelete = async (flowId: string) => {
    await onDelete(flowId);
    setDeleteConfirm(null);
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Flows
        </h3>
        <button
          onClick={() => setCreating(!creating)}
          className="text-gray-400 hover:text-gray-200 transition-colors"
          title="New flow"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {creating && (
        <div className="mb-3 flex gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Flow name..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 transition-colors"
          >
            Add
          </button>
        </div>
      )}

      <div className="space-y-1">
        {flows.length === 0 && !creating && (
          <p className="text-xs text-gray-500 text-center py-4">No flows yet</p>
        )}
        {flows.map((flow) => (
          <div
            key={flow.id}
            onClick={() => onSelect(flow.id)}
            className={`group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors ${
              selectedFlowId === flow.id
                ? 'bg-blue-600/20 border border-blue-500/30'
                : 'hover:bg-gray-700/50'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-200 truncate">{flow.name}</p>
              {flow.description && (
                <p className="text-[11px] text-gray-500 truncate">{flow.description}</p>
              )}
              <p className="text-[11px] text-gray-600">
                {flow.nodes.length} nodes · {flow.edges.length} edges · {flow.status}
              </p>
            </div>
            {deleteConfirm === flow.id ? (
              <div className="flex gap-1 ml-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(flow.id); }}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Yes
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                  className="text-xs text-gray-400 hover:text-gray-300"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(flow.id); }}
                className="hidden group-hover:block text-gray-500 hover:text-red-400 ml-2 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
