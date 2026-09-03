import {
  collection,
  doc,
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  addDoc as firestoreAddDoc,
  setDoc as firestoreSetDoc,
  updateDoc as firestoreUpdateDoc,
  deleteDoc as firestoreDeleteDoc,
  query,
  onSnapshot,
  Timestamp,
  type QueryConstraint,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { createDeferredSnapshotScheduler } from "./firestoreScheduler";

/** A listener failure is not an empty snapshot: callers must preserve it. */
export type FirestoreSubscriptionError = {
  code: string | null;
};

function toSubscriptionError(error: unknown): FirestoreSubscriptionError {
  const code = (error as { code?: unknown })?.code;
  return { code: typeof code === "string" ? code : null };
}

// Firestore Timestamp → Date 변환
export function toDate(value: unknown): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return new Date(value as string | number);
}

// Date → Firestore Timestamp 변환
export function toTimestamp(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

// Document 데이터에서 Timestamp 필드를 Date로 일괄 변환
export function convertTimestamps<T extends DocumentData>(
  data: DocumentData,
  dateFields: string[],
): T {
  const result = { ...data } as Record<string, unknown>;
  for (const field of dateFields) {
    if (result[field] != null) {
      result[field] = toDate(result[field]);
    }
  }
  return result as T;
}

// 단일 문서 조회
export async function getDocument<T>(
  collectionName: string,
  docId: string,
): Promise<T | null> {
  const ref = doc(db, collectionName, docId);
  const snapshot = await firestoreGetDoc(ref);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as T;
}

// 컬렉션 쿼리 조회
export async function queryDocuments<T>(
  collectionName: string,
  ...constraints: QueryConstraint[]
): Promise<T[]> {
  const ref = collection(db, collectionName);
  const q = query(ref, ...constraints);
  const snapshot = await firestoreGetDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

// 문서 생성 (자동 ID)
export async function createDocument(
  collectionName: string,
  data: DocumentData,
): Promise<string> {
  const ref = collection(db, collectionName);
  const docRef = await firestoreAddDoc(ref, data);
  return docRef.id;
}

// 문서 생성 (지정 ID)
export async function setDocument(
  collectionName: string,
  docId: string,
  data: DocumentData,
): Promise<void> {
  const ref = doc(db, collectionName, docId);
  await firestoreSetDoc(ref, data);
}

/**
 * 문서 병합 기록 (setDoc merge:true).
 *
 * ★`updateDocument` 와 결정적으로 다르다: `updateDoc` 에 중첩 객체를 주면 그
 * 맵을 **통째로 교체**하지만, `setDoc(merge:true)` 는 **재귀 병합**해서 보내지
 * 않은 하위 키를 보존한다. 기기별 프로젝트 경로(`folderPaths`)처럼 여러 기기가
 * 각자 자기 칸만 써야 하는 맵에는 반드시 이쪽을 써야 한다 — 그러지 않으면 한
 * 기기가 경로를 정할 때 다른 기기의 칸이 사라진다(티켓 sHyHC9RoutYHDt97UOEm).
 */
export async function mergeDocument(
  collectionName: string,
  docId: string,
  data: DocumentData,
): Promise<void> {
  const ref = doc(db, collectionName, docId);
  await firestoreSetDoc(ref, data, { merge: true });
}

// 문서 수정
export async function updateDocument(
  collectionName: string,
  docId: string,
  data: Partial<DocumentData>,
): Promise<void> {
  const ref = doc(db, collectionName, docId);
  await firestoreUpdateDoc(ref, data);
}

// 문서 삭제
export async function deleteDocument(
  collectionName: string,
  docId: string,
): Promise<void> {
  const ref = doc(db, collectionName, docId);
  await firestoreDeleteDoc(ref);
}

export function subscribeToCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[],
  callback: (items: T[]) => void,
  onError?: (error: FirestoreSubscriptionError) => void,
): Unsubscribe {
  const ref = collection(db, collectionName);
  const q = query(ref, ...constraints);
  const scheduler = createDeferredSnapshotScheduler();
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      scheduler.schedule(() => callback(items));
    },
    (error) => {
      console.error(
        `[Firestore] subscribeToCollection(${collectionName}) error:`,
        error,
      );
      scheduler.cancel();
      onError?.(toSubscriptionError(error));
    },
  );
  return () => {
    scheduler.cancel();
    unsubscribe();
  };
}

// 실시간 리스너 (단일 문서)
export function subscribeToDocument<T>(
  collectionName: string,
  docId: string,
  callback: (item: T | null) => void,
): Unsubscribe {
  const ref = doc(db, collectionName, docId);
  const scheduler = createDeferredSnapshotScheduler();
  const unsubscribe = onSnapshot(ref, (snapshot) => {
    if (!snapshot.exists()) {
      scheduler.schedule(() => callback(null));
      return;
    }
    const item = { id: snapshot.id, ...snapshot.data() } as T;
    scheduler.schedule(() => callback(item));
  });
  return () => {
    scheduler.cancel();
    unsubscribe();
  };
}
