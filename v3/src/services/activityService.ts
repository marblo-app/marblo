import { where, type Unsubscribe } from 'firebase/firestore';
import type { Activity } from '../types/activity';
import {
  queryDocuments,
  createDocument,
  subscribeToCollection,
  toTimestamp,
  convertTimestamps,
} from './firestore';

const COLLECTION = 'activities';
const DATE_FIELDS = ['createdAt'];

function toActivity(raw: Record<string, unknown>): Activity {
  return convertTimestamps<Activity>(raw, DATE_FIELDS);
}

export async function getActivities(taskId: string): Promise<Activity[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where('taskId', '==', taskId),
  );
  return docs.map(toActivity).sort((a, b) => +a.createdAt - +b.createdAt);
}

export async function addActivity(
  taskId: string,
  agentId: string,
  message: string,
): Promise<string> {
  return createDocument(COLLECTION, {
    taskId,
    agentId,
    message,
    createdAt: toTimestamp(new Date()),
  });
}

export function subscribeToActivities(
  taskId: string,
  callback: (activities: Activity[]) => void,
): Unsubscribe {
  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where('taskId', '==', taskId)],
    (docs) => callback(docs.map(toActivity).sort((a, b) => +a.createdAt - +b.createdAt)),
  );
}
