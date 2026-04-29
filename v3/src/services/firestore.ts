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
} from 'firebase/firestore';
import { db } from '../lib/firebase';

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

// 실시간 리스너 (컬렉션 쿼리)
// Defer Firestore state updates to idle time — no timeout so it only runs
// when the main thread is truly idle (not during typing/IME composition)
const deferUpdate = typeof requestIdleCallback !== 'undefined'
  ? (fn: () => void) => requestIdleCallback(fn)
  : (fn: () => void) => setTimeout(fn, 0);

export function subscribeToCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[],
  callback: (items: T[]) => void,
): Unsubscribe {
  const ref = collection(db, collectionName);
  const q = query(ref, ...constraints);
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    deferUpdate(() => callback(items));
  }, (error) => {
    console.error(`[Firestore] subscribeToCollection(${collectionName}) error:`, error);
    callback([]);
  });
}

// 실시간 리스너 (단일 문서)
export function subscribeToDocument<T>(
  collectionName: string,
  docId: string,
  callback: (item: T | null) => void,
): Unsubscribe {
  const ref = doc(db, collectionName, docId);
  return onSnapshot(ref, (snapshot) => {
    if (!snapshot.exists()) {
      deferUpdate(() => callback(null));
      return;
    }
    const item = { id: snapshot.id, ...snapshot.data() } as T;
    deferUpdate(() => callback(item));
  });
}
