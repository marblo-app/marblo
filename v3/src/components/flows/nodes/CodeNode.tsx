import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

const LANG_ICONS: Record<string, string> = {
  python: '🐍',
  shell: '🖥️',
  node: '🟢',
  typescript: '🔷',
};

export function CodeNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as Record<string, any>;
  const lang = config.language || 'python';

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-emerald-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">{LANG_ICONS[lang] || '💻'}</span>
        <span className="text-sm font-medium text-emerald-400">{d.label || 'Code'}</span>
        <span className="ml-auto text-[10px] bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded">
          {lang}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1">
        {config.script ? (
          <pre className="text-[11px] text-gray-400 font-mono bg-gray-900/50 rounded px-2 py-1.5 max-h-[60px] overflow-hidden whitespace-pre-wrap">
            {config.script.slice(0, 120)}{config.script.length > 120 ? '...' : ''}
          </pre>
        ) : (
          <p className="text-[11px] text-gray-500 italic">클릭하여 코드 작성</p>
        )}
        {config.timeout && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Timeout</span>
            <span className="text-xs text-gray-300">{config.timeout}s</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-emerald-400 !border-emerald-600" />
    </div>
  );
}
