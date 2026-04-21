import { where } from 'firebase/firestore';
import type { Agent } from '../types/agent';
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
} from './firestore';

const COLLECTION = 'agents';
const DATE_FIELDS = ['createdAt'];

function toAgent(raw: Record<string, unknown>): Agent {
  return convertTimestamps<Agent>(raw, DATE_FIELDS);
}

export async function getAgents(projectId: string): Promise<Agent[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where('projectId', '==', projectId),
  );
  return docs.map(toAgent);
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, agentId);
  return raw ? toAgent(raw) : null;
}

export async function createAgent(
  data: Omit<Agent, 'id' | 'createdAt'>,
): Promise<string> {
  return createDocument(COLLECTION, {
    ...data,
    createdAt: toTimestamp(new Date()),
  });
}

export async function updateAgent(
  agentId: string,
  data: Partial<Omit<Agent, 'id' | 'createdAt'>>,
): Promise<void> {
  await updateDocument(COLLECTION, agentId, data);
}

export async function deleteAgent(agentId: string): Promise<void> {
  await deleteDocument(COLLECTION, agentId);
}
