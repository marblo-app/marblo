import { where, arrayUnion, arrayRemove } from "firebase/firestore";
import type { Project } from "../types/project";
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
} from "./firestore";

export async function findProjectByPath(
  folderPath: string,
  userId: string,
): Promise<Project | null> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("folderPath", "==", folderPath),
    where("members", "array-contains", userId),
  );
  return docs.length > 0 ? toProject(docs[0]) : null;
}

export function normalizeGitRemoteUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let s = url.trim().toLowerCase();
  if (!s) return null;

  // git@host:path
  let m = s.match(/^git@([^:]+):(.+)$/);
  if (m) s = `${m[1]}/${m[2]}`;
  else {
    // ssh://git@host/path | https://host/path | http://host/path | git://host/path
    m = s.match(/^(?:(?:ssh:\/\/)?git@|https?:\/\/|git:\/\/)([^/]+)\/(.+)$/);
    if (m) s = `${m[1]}/${m[2]}`;
  }
  return s.replace(/\.git$/, "");
}

// Match a project by git remote URL (priority 1) or folder path (priority 2),
// scoped to the given user. Falls back to folder path when remote URL is null
// or no remote-based match exists. Non-git folders rely on folderPath alone.
export async function findProjectByPathOrRemote(
  folderPath: string,
  gitRemoteUrl: string | null | undefined,
  userId: string,
): Promise<Project | null> {
  const normalized = normalizeGitRemoteUrl(gitRemoteUrl);
  if (normalized) {
    const userProjects = await queryDocuments<Record<string, unknown>>(
      COLLECTION,
      where("members", "array-contains", userId),
    );
    for (const raw of userProjects) {
      const candidate = normalizeGitRemoteUrl(
        raw.gitRemoteUrl as string | undefined,
      );
      if (candidate && candidate === normalized) {
        return toProject(raw);
      }
    }
  }
  return findProjectByPath(folderPath, userId);
}

const COLLECTION = "projects";
const DATE_FIELDS = ["createdAt", "updatedAt"];

function toProject(raw: Record<string, unknown>): Project {
  return convertTimestamps<Project>(raw, DATE_FIELDS);
}

export async function getProjects(userId: string): Promise<Project[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("members", "array-contains", userId),
  );
  return docs.map(toProject);
}

export async function getProject(projectId: string): Promise<Project | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, projectId);
  return raw ? toProject(raw) : null;
}

export async function createProject(
  data: Omit<Project, "id" | "createdAt" | "updatedAt">,
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
  data: Partial<Omit<Project, "id" | "createdAt">>,
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
