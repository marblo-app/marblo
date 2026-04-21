import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-400 bg-green-900/30',
  POST: 'text-blue-400 bg-blue-900/30',
  PUT: 'text-yellow-400 bg-yellow-900/30',
  DELETE: 'text-red-400 bg-red-900/30',
};

export function APINode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as Record<string, any>;
  const method = config.method || 'GET';
  const headers = (config.headers as { key: string; value: string }[]) || [];

  return (
    <div
      className={`w-[260px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-orange-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">🌐</span>
        <span className="text-sm font-medium text-orange-400">{d.label || 'API'}</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
              METHOD_COLORS[method] || 'text-gray-400 bg-gray-700'
            }`}
          >
            {method}
          </span>
          <span className="text-[11px] text-gray-400 truncate flex-1">
            {config.url || 'https://...'}
          </span>
        </div>
        {headers.length > 0 && (
          <div className="text-[11px] text-gray-500">{headers.length} header(s)</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-orange-400 !border-orange-600" />
    </div>
  );
}
