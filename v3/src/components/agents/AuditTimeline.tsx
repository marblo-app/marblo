import { useState, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { subscribeToAuditLogs } from '../../services/auditService';
import type { AuditLog } from '../../types/audit';
import { displayableLedgerParams } from '../../lib/auditParamsPolicy';

export default function AuditTimeline() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [toolFilter, setToolFilter] = useState<string>('');

  useEffect(() => {
    if (!currentProject) return;
    setLoading(true);
    const unsub = subscribeToAuditLogs(
      currentProject.id,
      (newLogs) => {
        setLogs(newLogs);
        setLoading(false);
      },
    );
    return unsub;
  }, [currentProject]);

  const agentIds = useMemo(() => [...new Set(logs.map(l => l.agentId))], [logs]);
  const toolNames = useMemo(() => [...new Set(logs.map(l => l.toolName))].sort(), [logs]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (agentFilter && l.agentId !== agentFilter) return false;
      if (toolFilter && l.toolName !== toolFilter) return false;
      return true;
    });
  }, [logs, agentFilter, toolFilter]);

  const grouped = useMemo(() => {
    const groups: Record<string, AuditLog[]> = {};
    for (const log of filtered) {
      const date = log.createdAt instanceof Date
        ? log.createdAt.toLocaleDateString('ko-KR')
        : new Date(log.createdAt).toLocaleDateString('ko-KR');
      if (!groups[date]) groups[date] = [];
      groups[date].push(log);
    }
    return groups;
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        <span className="ml-2 text-sm">Loading audit logs...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All Agents</option>
          {agentIds.map((id) => (
            <option key={id} value={id}>{id.slice(0, 12)}...</option>
          ))}
        </select>
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All Tools</option>
          {toolNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} entries</span>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          No audit logs found.
        </div>
      ) : (
        Object.entries(grouped).map(([date, dateLogs]) => (
          <div key={date} className="space-y-1">
            <div className="sticky top-0 bg-gray-900 py-1 text-xs font-medium text-gray-500">
              {date}
            </div>
            {dateLogs.map((log) => (
              <AuditEntry key={log.id} log={log} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function AuditEntry({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  // ★원문을 그대로 뿌리던 자리다(티켓 yJLfoRpqvCcvarIXcT23). 정책 표식이 없는
  // 옛 문서에는 지시문·티켓 본문·자격증명이 그대로 들어 있고 원장은 불변이라
  // 지울 수 없으므로, 화면이 게이트다.
  const shownParams = displayableLedgerParams(log);

  const timeStr = log.createdAt instanceof Date
    ? log.createdAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : new Date(log.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div
      className={`rounded border ${
        log.success ? 'border-gray-700' : 'border-red-800/50'
      } bg-gray-800 px-3 py-2 cursor-pointer transition-colors hover:border-gray-600`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs ${log.success ? 'text-green-400' : 'text-red-400'}`}>
            {log.success ? '\u2713' : '\u2717'}
          </span>
          <span className="text-xs font-mono text-blue-400 truncate">{log.toolName}</span>
          <span className="text-[10px] text-gray-600">{log.agentId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[10px] text-gray-500">{log.duration}ms</span>
          <span className="text-[10px] text-gray-600">{timeStr}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1 border-t border-gray-700 pt-2">
          <div>
            <span className="text-[10px] text-gray-500">Params:</span>
            <pre className="mt-0.5 rounded bg-gray-900 p-1.5 text-[10px] text-gray-400 overflow-x-auto max-h-24 overflow-y-auto">
              {JSON.stringify(shownParams.params, null, 2)}
            </pre>
            {shownParams.withheld && (
              <p data-testid='audit-params-withheld' className='mt-0.5 text-[10px] text-amber-600/80'>
                정책 이전 기록이라 인자 원문은 표시하지 않는다. 원장은 불변이라 문서에서 지울 수는 없다.
              </p>
            )}
          </div>
          <div>
            <span className="text-[10px] text-gray-500">Result:</span>
            <pre className="mt-0.5 rounded bg-gray-900 p-1.5 text-[10px] text-gray-400 overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap">
              {log.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
