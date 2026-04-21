import { where, orderBy } from 'firebase/firestore';
import type { GcpConfig, Deployment } from '../types/deploy';
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  setDocument,
  subscribeToCollection,
  subscribeToDocument,
  toTimestamp,
  convertTimestamps,
} from './firestore';

// --- GCP Config ---

const CONFIG_COLLECTION = 'projects';
const DEPLOY_COLLECTION = 'deployments';
const DATE_FIELDS = ['startedAt', 'completedAt', 'lastChecked', 'lastDeployedAt', 'lastRunAt', 'nextRunAt'];

function toDeployment(raw: Record<string, unknown>): Deployment {
  return convertTimestamps<Deployment>(raw, DATE_FIELDS);
}

export async function getGcpConfig(projectId: string): Promise<GcpConfig | null> {
  const raw = await getDocument<Record<string, unknown>>(
    `${CONFIG_COLLECTION}/${projectId}/deploy`,
    'config',
  );
  return raw ? convertTimestamps<GcpConfig>(raw, DATE_FIELDS) : null;
}

export async function saveGcpConfig(
  projectId: string,
  config: Omit<GcpConfig, 'lastChecked'>,
): Promise<void> {
  await setDocument(`${CONFIG_COLLECTION}/${projectId}/deploy`, 'config', {
    ...config,
    lastChecked: toTimestamp(new Date()),
  });
}

export function subscribeToGcpConfig(
  projectId: string,
  callback: (config: GcpConfig | null) => void,
): () => void {
  return subscribeToDocument<Record<string, unknown>>(
    `${CONFIG_COLLECTION}/${projectId}/deploy`,
    'config',
    (raw) => {
      callback(raw ? convertTimestamps<GcpConfig>(raw, DATE_FIELDS) : null);
    },
  );
}

// --- Deployments ---

export async function getDeployments(projectId: string): Promise<Deployment[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    DEPLOY_COLLECTION,
    where('projectId', '==', projectId),
    orderBy('startedAt', 'desc'),
  );
  return docs.map(toDeployment);
}

export async function createDeployment(
  data: Omit<Deployment, 'id' | 'completedAt' | 'error'>,
): Promise<string> {
  return createDocument(DEPLOY_COLLECTION, {
    ...data,
    startedAt: toTimestamp(data.startedAt),
    completedAt: null,
    error: null,
  });
}

export async function updateDeployment(
  id: string,
  data: Partial<Deployment>,
): Promise<void> {
  const update: Record<string, unknown> = { ...data };
  if (data.completedAt) update.completedAt = toTimestamp(data.completedAt);
  if (data.startedAt) update.startedAt = toTimestamp(data.startedAt);
  await updateDocument(DEPLOY_COLLECTION, id, update);
}

export function subscribeToDeployments(
  projectId: string,
  callback: (deployments: Deployment[]) => void,
): () => void {
  return subscribeToCollection<Record<string, unknown>>(
    DEPLOY_COLLECTION,
    [where('projectId', '==', projectId), orderBy('startedAt', 'desc')],
    (docs) => callback(docs.map(toDeployment)),
  );
}
