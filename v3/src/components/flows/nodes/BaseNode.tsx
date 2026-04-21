import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeType } from '../../../types/flow';

export interface BaseNodeData {
  label: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
}

const NODE_STYLES: Record<NodeType, { color: string; bg: string; border: string; icon: string }> = {
  input:       { color: 'text-green-400',   bg: 'bg-green-900/30',   border: 'border-green-500/50',   icon: '📥' },
  llm:         { color: 'text-purple-400',  bg: 'bg-purple-900/30',  border: 'border-purple-500/50',  icon: '🧠' },
  agent:       { color: 'text-blue-400',    bg: 'bg-blue-900/30',    border: 'border-blue-500/50',    icon: '🤖' },
  code:        { color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-500/50', icon: '💻' },
  api:         { color: 'text-orange-400',  bg: 'bg-orange-900/30',  border: 'border-orange-500/50',  icon: '🌐' },
  integration: { color: 'text-rose-400',    bg: 'bg-rose-900/30',    border: 'border-rose-500/50',    icon: '🔗' },
  human:       { color: 'text-yellow-400',  bg: 'bg-yellow-900/30',  border: 'border-yellow-500/50',  icon: '👤' },
  branch:      { color: 'text-cyan-400',    bg: 'bg-cyan-900/30',    border: 'border-cyan-500/50',    icon: '🔀' },
  output:      { color: 'text-pink-400',    bg: 'bg-pink-900/30',    border: 'border-pink-500/50',    icon: '📤' },
};

const NODE_LABELS: Record<NodeType, string> = {
  input: 'Input',
  llm: 'LLM',
  agent: 'Agent',
  code: 'Code',
  api: 'API',
  integration: 'Integration',
  human: 'Human',
  branch: 'Branch',
  output: 'Output',
};

export function BaseNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as BaseNodeData;
  const nodeType = nodeData.nodeType ?? 'input';
  const style = NODE_STYLES[nodeType];
  const label = nodeData.label || NODE_LABELS[nodeType];

  return (
    <div
      className={`min-w-[160px] rounded-lg border ${style.border} ${style.bg} shadow-lg transition-all ${
        selected ? 'ring-2 ring-white/40 shadow-xl' : ''
      }`}
    >
      {/* Input handle */}
      {nodeType !== 'input' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-gray-400 !border-gray-600"
        />
      )}

      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${style.border}`}>
        <span className="text-base">{style.icon}</span>
        <span className={`text-sm font-medium ${style.color}`}>{label}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-gray-400 truncate">
          {nodeData.config && Object.keys(nodeData.config).length > 0
            ? JSON.stringify(nodeData.config).slice(0, 40)
            : 'Click to configure'}
        </p>
      </div>

      {/* Output handle */}
      {nodeType !== 'output' && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-gray-400 !border-gray-600"
        />
      )}

      {/* Branch has extra handle */}
      {nodeType === 'branch' && (
        <Handle
          type="source"
          position={Position.Right}
          id="false"
          className="!w-3 !h-3 !bg-red-400 !border-red-600"
        />
      )}
    </div>
  );
}
