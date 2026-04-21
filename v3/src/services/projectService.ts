import { where, arrayUnion, arrayRemove } from 'firebase/firestore';
import type { Project } from '../types/project';
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
} from './firestore';

export async function findProjectByPath(
  folderPath: string,
  userId: string,
): Promise<Project | null> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where('folderPath', '==', folderPath),
    where('members', 'array-contains', userId),
  );
  return docs.length > 0 ? toProject(docs[0]) : null;
}

const COLLECTION = 'projects';
const DATE_FIELDS = ['createdAt', 'updatedAt'];

function toProject(raw: Record<string, unknown>): Project {
  return convertTimestamps<Project>(raw, DATE_FIELDS);
}

export async function getProjects(userId: string): Promise<Project[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where('members', 'array-contains', userId),
  );
  return docs.map(toProject);
}

export async function getProject(projectId: string): Promise<Project | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, projectId);
  return raw ? toProject(raw) : null;
}

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const now = new Date();
  return createDocument(COLLECTION, {
    ...data,
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });
}

export async function updateProject(
  projectId: string,
  data: Partial<Omit<Project, 'id' | 'createdAt'>>,
): Promise<void> {
  await updateDocument(COLLECTION, projectId, {
    ...data,
    updatedAt: toTimestamp(new Date()),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await deleteDocument(COLLECTION, projectId);
}

export async function addMember(
  projectId: string,
  userId: string,
): Promise<void> {
  await updateDocument(COLLECTION, projectId, {
    members: arrayUnion(userId),
    updatedAt: toTimestamp(new Date()),
  });
}

export async function removeMember(
  projectId: string,
  userId: string,
): Promise<void> {
  await updateDocument(COLLECTION, projectId, {
    members: arrayRemove(userId),
    updatedAt: toTimestamp(new Date()),
  });
}
