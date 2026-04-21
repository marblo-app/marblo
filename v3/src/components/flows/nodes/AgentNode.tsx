import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

export function AgentNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as Record<string, any>;
  const isExisting = config.connectionMode === 'existing';

  const handleDoubleClick = () => {
    const agentName = config.agentName || config.name || '';
    if (agentName) {
      window.dispatchEvent(new CustomEvent('flow:focusAgent', { detail: { agentName } }));
    }
  };

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
      onDoubleClick={handleDoubleClick}
      title="Double-click to view agent terminal"
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-blue-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">🤖</span>
        <span className="text-sm font-medium text-blue-400">{d.label || 'Agent'}</span>
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
          isExisting ? 'bg-green-900/40 text-green-400' : 'bg-blue-900/40 text-blue-400'
        }`}>
          {isExisting ? 'live' : 'spawn'}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Agent</span>
          <span className="text-xs text-gray-300 truncate ml-2">{config.agentName || 'unnamed'}</span>
        </div>
        {config.role && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Role</span>
            <span className="text-xs text-gray-300">{config.role}</span>
          </div>
        )}
        {config.model && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Model</span>
            <span className="text-xs text-gray-300">{config.model}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Timeout</span>
          <span className="text-xs text-gray-300">{config.timeout || 30}min</span>
        </div>
        {config.taskDescription && (
          <p className="text-[11px] text-gray-500 truncate mt-1">{config.taskDescription}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-blue-400 !border-blue-600" />
    </div>
  );
}
