// Mock firebase/firestore for testing

const store = new Map<string, Map<string, Record<string, unknown>>>();

function getCollection(collectionPath: string): Map<string, Record<string, unknown>> {
  if (!store.has(collectionPath)) {
    store.set(collectionPath, new Map());
  }
  return store.get(collectionPath)!;
}

export function getFirestore(_app?: unknown) {
  return { type: 'mock-firestore' };
}

export function collection(_db: unknown, path: string) {
  return { path, type: 'collection' };
}

export function doc(_db: unknown, collectionPath: string, docId: string) {
  return { collectionPath, docId, type: 'doc' };
}

export async function getDoc(ref: { collectionPath: string; docId: string }) {
  const col = getCollection(ref.collectionPath);
  const data = col.get(ref.docId);
  return {
    exists: () => !!data,
    id: ref.docId,
    data: () => data || null,
  };
}

export async function getDocs(_query: unknown) {
  return { empty: true, docs: [], size: 0 };
}

export async function addDoc(ref: { path: string }, data: Record<string, unknown>) {
  const col = getCollection(ref.path);
  const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  col.set(id, data);
  return { id };
}

export async function setDoc(ref: { collectionPath: string; docId: string }, data: Record<string, unknown>) {
  const col = getCollection(ref.collectionPath);
  col.set(ref.docId, data);
}

export async function updateDoc(ref: { collectionPath: string; docId: string }, data: Record<string, unknown>) {
  const col = getCollection(ref.collectionPath);
  const existing = col.get(ref.docId) || {};
  col.set(ref.docId, { ...existing, ...data });
}

export function query(_collection: unknown, ..._constraints: unknown[]) {
  return { type: 'query' };
}

export function where(_field: string, _op: string, _value: unknown) {
  return { type: 'where' };
}

export function orderBy(_field: string, _direction?: string) {
  return { type: 'orderBy' };
}

export function onSnapshot(_query: unknown, callback: (snap: unknown) => void) {
  return () => {}; // unsubscribe
}

export class Timestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() {
    return new Timestamp(Math.floor(Date.now() / 1000), 0);
  }
  static fromDate(date: Date) {
    return new Timestamp(Math.floor(date.getTime() / 1000), 0);
  }
  toDate() {
    return new Date(this.seconds * 1000);
  }
}

export function serverTimestamp() {
  return Timestamp.now();
}

// Reset store between tests
export function __resetStore() {
  store.clear();
}

export type { } from 'firebase/firestore';
