import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

export function OutputNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as { format?: string; preview?: string };

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-pink-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">📤</span>
        <span className="text-sm font-medium text-pink-400">{d.label || 'Output'}</span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Format</span>
          <span className="text-xs text-gray-300">{config.format || 'text'}</span>
        </div>
        {config.preview && (
          <div className="mt-1 p-1.5 bg-gray-900 rounded text-[11px] text-gray-400 font-mono max-h-16 overflow-hidden">
            {config.preview}
          </div>
        )}
      </div>
    </div>
  );
}
