import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

export function BranchNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as { condition?: string };

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-cyan-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">🔀</span>
        <span className="text-sm font-medium text-cyan-400">{d.label || 'Branch'}</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[11px] text-gray-400 font-mono truncate">
          {config.condition || 'condition === true'}
        </p>
        <div className="flex justify-between mt-2 text-[10px]">
          <span className="text-green-400">True</span>
          <span className="text-red-400">False</span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: '30%' }}
        className="!w-3 !h-3 !bg-green-400 !border-green-600"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '70%' }}
        className="!w-3 !h-3 !bg-red-400 !border-red-600"
      />
    </div>
  );
}
