// Mock firebase/firestore for testing

const store = new Map<string, Map<string, Record<string, unknown>>>();

function getCollection(
  collectionPath: string
): Map<string, Record<string, unknown>> {
  if (!store.has(collectionPath)) {
    store.set(collectionPath, new Map());
  }
  return store.get(collectionPath)!;
}

export function getFirestore(_app?: unknown) {
  return { type: "mock-firestore" };
}

export function collection(_db: unknown, path: string) {
  return { path, type: "collection" };
}

export function doc(_db: unknown, collectionPath: string, docId: string) {
  return { collectionPath, docId, type: "doc" };
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

export async function getDocs(q: {
  path?: string;
  constraints?: Array<{
    type: string;
    field?: string;
    op?: string;
    value?: unknown;
  }>;
}) {
  const col = q?.path ? getCollection(q.path) : new Map();
  const wheres = (q?.constraints ?? []).filter((c) => c.type === "where");
  const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
  for (const [id, data] of col.entries()) {
    const ok = wheres.every((w) =>
      w.op === "==" ? data[w.field as string] === w.value : true
    );
    if (ok) docs.push({ id, data: () => data });
  }
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (
      cb: (d: { id: string; data: () => Record<string, unknown> }) => void
    ) => docs.forEach(cb),
  };
}

export async function addDoc(
  ref: { path: string },
  data: Record<string, unknown>
) {
  const col = getCollection(ref.path);
  const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  col.set(id, data);
  return { id };
}

export async function setDoc(
  ref: { collectionPath: string; docId: string },
  data: Record<string, unknown>
) {
  const col = getCollection(ref.collectionPath);
  col.set(ref.docId, data);
}

export async function updateDoc(
  ref: { collectionPath: string; docId: string },
  data: Record<string, unknown>
) {
  const col = getCollection(ref.collectionPath);
  const existing = col.get(ref.docId) || {};
  col.set(ref.docId, applyUpdate(existing, data));
}

export function query(
  collection: { path?: string },
  ...constraints: unknown[]
) {
  return { type: "query", path: collection?.path, constraints };
}

export function where(field: string, op: string, value: unknown) {
  return { type: "where", field, op, value };
}

// Apply a Firestore-style update: keys containing "." are nested field paths
// (e.g. "projection.statusCounts"), everything else is a shallow top-level set.
function applyUpdate(
  existing: Record<string, unknown>,
  data: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(data)) {
    if (!key.includes(".")) {
      next[key] = value;
      continue;
    }
    const parts = key.split(".");
    let cursor = next as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      cursor[p] = { ...((cursor[p] as Record<string, unknown>) ?? {}) };
      cursor = cursor[p] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return next;
}

export function orderBy(_field: string, _direction?: string) {
  return { type: "orderBy" };
}

export function onSnapshot(_query: unknown, _callback: (snap: unknown) => void) {
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
  static fromMillis(ms: number) {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.seconds * 1000);
  }
}

export function serverTimestamp() {
  return Timestamp.now();
}

// Minimal transaction mock — enough for applyProjection() integration tests.
// Reads/writes go straight to the in-memory store; no isolation/retry.
export async function runTransaction<T>(
  _db: unknown,
  updateFn: (txn: {
    get: (ref: { collectionPath: string; docId: string }) => Promise<unknown>;
    set: (ref: Record<string, unknown>, data: Record<string, unknown>) => void;
    update: (
      ref: { collectionPath: string; docId: string },
      data: Record<string, unknown>
    ) => void;
  }) => Promise<T>
): Promise<T> {
  const txn = {
    get: (ref: { collectionPath: string; docId: string }) => getDoc(ref),
    set: (ref: Record<string, unknown>, data: Record<string, unknown>) => {
      if (typeof ref.docId === "string") {
        getCollection(ref.collectionPath as string).set(ref.docId, data);
      } else {
        const id = `mock-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        getCollection((ref.path as string) ?? "_auto").set(id, data);
      }
    },
    update: (
      ref: { collectionPath: string; docId: string },
      data: Record<string, unknown>
    ) => {
      const col = getCollection(ref.collectionPath);
      col.set(ref.docId, applyUpdate(col.get(ref.docId) || {}, data));
    },
  };
  return updateFn(txn);
}

// Reset store between tests
export function __resetStore() {
  store.clear();
}

export type {} from "firebase/firestore";
