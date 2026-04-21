import { where, orderBy, limit, type Unsubscribe } from 'firebase/firestore';
import { subscribeToCollection, convertTimestamps } from './firestore';
import type { AuditLog } from '../types/audit';

const COLLECTION = 'audit_logs';
const DATE_FIELDS = ['createdAt'];

function toAuditLog(raw: Record<string, unknown>): AuditLog {
  return convertTimestamps<AuditLog>(raw, DATE_FIELDS);
}

export function subscribeToAuditLogs(
  projectId: string,
  callback: (logs: AuditLog[]) => void,
  filters?: { agentId?: string; toolName?: string },
  maxResults: number = 100,
): Unsubscribe {
  const constraints = [
    where('projectId', '==', projectId),
    orderBy('createdAt', 'desc'),
    limit(maxResults),
  ];

  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    constraints,
    (docs) => {
      let logs = docs.map(toAuditLog);
      // Client-side filtering for toolName (Firestore composite index limitation)
      if (filters?.toolName) {
        logs = logs.filter(l => l.toolName === filters.toolName);
      }
      if (filters?.agentId) {
        logs = logs.filter(l => l.agentId === filters.agentId);
      }
      callback(logs);
    },
  );
}
