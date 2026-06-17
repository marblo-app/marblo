import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

export function HumanNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as { message?: string };

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-yellow-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">👤</span>
        <span className="text-sm font-medium text-yellow-400">{d.label || 'Human'}</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[11px] text-gray-400 truncate">
          {config.message || 'Approval required'}
        </p>
        <div className="flex justify-between mt-2 text-[10px]">
          <span className="text-green-400">&#10003; Approved</span>
          <span className="text-red-400">&#10007; Rejected</span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="approved"
        style={{ left: '30%' }}
        className="!w-3 !h-3 !bg-green-400 !border-green-600"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="rejected"
        style={{ left: '70%' }}
        className="!w-3 !h-3 !bg-red-400 !border-red-600"
      />
    </div>
  );
}
