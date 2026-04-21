import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  getDocs,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Task } from '../types/task';
import type { FileLock, ActiveEditor, UserPresence } from '../types/collaboration';

const LOCKS_COLLECTION = 'locks';
const PRESENCE_COLLECTION = 'presence';
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30분

// ─── File Locking ────────────────────────────────────────────────

export async function lockFile(
  projectId: string,
  filePath: string,
  userId: string,
  displayName: string,
): Promise<boolean> {
  const lockId = `${projectId}_${filePath.replace(/\//g, '_')}`;
  const ref = doc(db, LOCKS_COLLECTION, lockId);

  // 기존 잠금 확인
  const locksSnap = await getDocs(
    query(
      collection(db, LOCKS_COLLECTION),
      where('projectId', '==', projectId),
      where('filePath', '==', filePath),
    ),
  );

  const now = Date.now();
  for (const lockDoc of locksSnap.docs) {
    const data = lockDoc.data();
    const expiresAt = (data.expiresAt as Timestamp).toMillis();
    // 다른 사용자가 아직 유효한 잠금을 보유 중
    if (data.userId !== userId && expiresAt > now) {
      return false;
    }
  }

  const lockedAt = new Date();
  const expiresAt = new Date(now + LOCK_DURATION_MS);

  await setDoc(ref, {
    projectId,
    filePath,
    userId,
    displayName,
    lockedAt: Timestamp.fromDate(lockedAt),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  return true;
}

export async function unlockFile(
  projectId: string,
  filePath: string,
  userId: string,
): Promise<void> {
  const lockId = `${projectId}_${filePath.replace(/\//g, '_')}`;
  const ref = doc(db, LOCKS_COLLECTION, lockId);

  // 본인의 잠금만 해제 — 소유자 확인
  const { getDoc } = await import('firebase/firestore');
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().userId === userId) {
    await deleteDoc(ref);
  }
}

export async function getLockedFiles(projectId: string): Promise<FileLock[]> {
  const q = query(
    collection(db, LOCKS_COLLECTION),
    where('projectId', '==', projectId),
  );
  const snap = await getDocs(q);
  const now = Date.now();

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        projectId: data.projectId,
        filePath: data.filePath,
        userId: data.userId,
        displayName: data.displayName,
        lockedAt: (data.lockedAt as Timestamp).toDate(),
        expiresAt: (data.expiresAt as Timestamp).toDate(),
      } as FileLock;
    })
    .filter((lock) => lock.expiresAt.getTime() > now);
}

// ─── Scope Conflict Check ────────────────────────────────────────

export function checkScopeConflict(taskA: Task, taskB: Task): boolean {
  if (!taskA.scope?.length || !taskB.scope?.length) return false;
  return taskA.scope.some((pathA) =>
    taskB.scope.some(
      (pathB) => pathA === pathB || pathA.startsWith(pathB) || pathB.startsWith(pathA),
    ),
  );
}

// ─── Active Editors ──────────────────────────────────────────────

export function subscribeToActiveEditors(
  projectId: string,
  callback: (editors: ActiveEditor[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, LOCKS_COLLECTION),
    where('projectId', '==', projectId),
  );

  return onSnapshot(q, (snap) => {
    const now = Date.now();
    const editors: ActiveEditor[] = [];

    for (const d of snap.docs) {
      const data = d.data();
      const expiresAt = (data.expiresAt as Timestamp).toMillis();
      if (expiresAt > now) {
        editors.push({
          userId: data.userId,
          filePath: data.filePath,
          displayName: data.displayName,
          photoURL: data.photoURL ?? '',
        });
      }
    }

    callback(editors);
  });
}

// ─── Presence ────────────────────────────────────────────────────

export async function updatePresence(
  projectId: string,
  userId: string,
  location: string,
  displayName: string,
  photoURL: string,
): Promise<void> {
  const ref = doc(db, PRESENCE_COLLECTION, projectId, 'users', userId);
  await setDoc(ref, {
    userId,
    displayName,
    photoURL,
    location,
    lastSeen: serverTimestamp(),
  });
}

export function subscribeToPresence(
  projectId: string,
  callback: (presence: UserPresence[]) => void,
): Unsubscribe {
  const ref = collection(db, PRESENCE_COLLECTION, projectId, 'users');

  return onSnapshot(ref, (snap) => {
    const STALE_MS = 5 * 60 * 1000; // 5분 이상이면 오프라인 간주
    const now = Date.now();

    const presence: UserPresence[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const lastSeen = data.lastSeen
        ? (data.lastSeen as Timestamp).toMillis()
        : 0;

      if (now - lastSeen < STALE_MS) {
        presence.push({
          userId: data.userId,
          displayName: data.displayName,
          photoURL: data.photoURL ?? '',
          location: data.location,
          lastSeen: new Date(lastSeen),
        });
      }
    }

    callback(presence);
  });
}
