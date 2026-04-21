import { where } from 'firebase/firestore';
import type { Flow } from '../types/flow';
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
} from './firestore';

const COLLECTION = 'flows';
const DATE_FIELDS = ['createdAt', 'updatedAt'];

function toFlow(raw: Record<string, unknown>): Flow {
  return convertTimestamps<Flow>(raw, DATE_FIELDS);
}

export async function getFlows(projectId: string): Promise<Flow[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where('projectId', '==', projectId),
  );
  return docs.map(toFlow);
}

export async function getFlow(flowId: string): Promise<Flow | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, flowId);
  return raw ? toFlow(raw) : null;
}

export async function createFlow(
  data: Omit<Flow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const now = new Date();
  return createDocument(COLLECTION, {
    ...data,
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });
}

export async function updateFlow(
  flowId: string,
  data: Partial<Omit<Flow, 'id' | 'createdAt'>>,
): Promise<void> {
  await updateDocument(COLLECTION, flowId, {
    ...data,
    updatedAt: toTimestamp(new Date()),
  });
}

export async function deleteFlow(flowId: string): Promise<void> {
  await deleteDocument(COLLECTION, flowId);
}
