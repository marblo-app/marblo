import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

export function InputNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as Record<string, string>;

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <div className="h-1 bg-green-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">📥</span>
        <span className="text-sm font-medium text-green-400">{d.label || 'Input'}</span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Variable</span>
          <span className="text-xs text-gray-300">{config.variableName || 'input'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Type</span>
          <span className="text-xs text-gray-300">{config.inputType || 'text'}</span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-green-400 !border-green-600"
      />
    </div>
  );
}
