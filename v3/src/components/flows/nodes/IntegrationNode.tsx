import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BaseNodeData } from './BaseNode';

export const INTEGRATION_SERVICES: Record<string, { icon: string; color: string; label: string }> = {
  slack:    { icon: '💬', color: 'text-[#E01E5A]', label: 'Slack' },
  notion:   { icon: '📝', color: 'text-gray-200',  label: 'Notion' },
  telegram: { icon: '✈️', color: 'text-[#26A5E4]', label: 'Telegram' },
  sheets:   { icon: '📊', color: 'text-[#34A853]', label: 'Google Sheets' },
  github:   { icon: '🐙', color: 'text-gray-200',  label: 'GitHub' },
  discord:  { icon: '🎮', color: 'text-[#5865F2]', label: 'Discord' },
  email:    { icon: '📧', color: 'text-red-400',    label: 'Email' },
  webhook:  { icon: '🔗', color: 'text-gray-400',   label: 'Webhook' },
};

export function IntegrationNode({ data, selected }: NodeProps) {
  const d = data as unknown as BaseNodeData;
  const config = d.config as Record<string, any>;
  const service = INTEGRATION_SERVICES[config.service] || INTEGRATION_SERVICES.webhook;

  return (
    <div
      className={`w-[240px] rounded-lg bg-gray-800 shadow-lg border border-gray-700 overflow-hidden ${
        selected ? 'ring-2 ring-white/40' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-gray-600" />
      <div className="h-1 bg-rose-500" />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <span className="text-base">{service.icon}</span>
        <span className={`text-sm font-medium ${service.color}`}>{d.label || service.label}</span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Service</span>
          <span className="text-xs text-gray-300">{service.label}</span>
        </div>
        {config.action && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Action</span>
            <span className="text-xs text-gray-300 truncate ml-2">{config.action}</span>
          </div>
        )}
        {config.channel && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Channel</span>
            <span className="text-xs text-gray-300 truncate ml-2">#{config.channel}</span>
          </div>
        )}
        {config.description && (
          <p className="text-[11px] text-gray-500 truncate mt-1">{config.description}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-rose-400 !border-rose-600" />
    </div>
  );
}
