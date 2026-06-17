import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'o3': 'o3',
  'o4-mini': 'o4-mini',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
};

function formatModelName(model?: string): string {
  if (!model) return 'Claude';
  return MODEL_LABELS[model] || model;
}

export function LLMNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as { model?: string; temperature?: number; maxTokens?: number; prompt?: string };

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-purple-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">🧠</span>
        <span className="text-sm font-medium text-purple-400">{d.label || 'LLM'}</span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Model</span>
          <span className="text-xs text-gray-300">{formatModelName(config.model)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Temp</span>
          <span className="text-xs text-gray-300">{config.temperature ?? 0.7}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Max tokens</span>
          <span className="text-xs text-gray-300">{config.maxTokens || 4096}</span>
        </div>
        {config.prompt && (
          <p className="text-[11px] text-gray-500 truncate mt-1">{config.prompt}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-purple-400 !border-purple-600" />
    </div>
  );
}
