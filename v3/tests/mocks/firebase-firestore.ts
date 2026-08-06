// Mock firebase/firestore for testing

const store = new Map<string, Map<string, Record<string, unknown>>>();

function getCollection(
  collectionPath: string,
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

export const getDocFromServer = getDoc;

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
      w.op === "==" ? data[w.field as string] === w.value : true,
    );
    if (ok) docs.push({ id, data: () => data });
  }
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (
      cb: (d: { id: string; data: () => Record<string, unknown> }) => void,
    ) => docs.forEach(cb),
  };
}

export async function addDoc(
  ref: { path: string },
  data: Record<string, unknown>,
) {
  const col = getCollection(ref.path);
  const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  col.set(id, data);
  return { id };
}

export async function setDoc(
  ref: { collectionPath: string; docId: string },
  data: Record<string, unknown>,
) {
  const col = getCollection(ref.collectionPath);
  col.set(ref.docId, data);
}

export async function updateDoc(
  ref: { collectionPath: string; docId: string },
  data: Record<string, unknown>,
) {
  const col = getCollection(ref.collectionPath);
  const existing = col.get(ref.docId) || {};
  col.set(ref.docId, applyUpdate(existing, data));
}

export async function deleteDoc(ref: {
  collectionPath: string;
  docId: string;
}) {
  const col = getCollection(ref.collectionPath);
  col.delete(ref.docId);
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

// Atomic numeric add, matching firebase/firestore's FieldValue.increment().
// applyUpdate() resolves the sentinel against the stored value, so tests
// exercise real accumulate semantics — a sentinel that merely got stored
// verbatim would make per-task cost/retry rollups look correct while
// accumulating nothing.
const INCREMENT = Symbol.for("mock.increment");

interface IncrementSentinel {
  [INCREMENT]: true;
  by: number;
}

function isIncrement(value: unknown): value is IncrementSentinel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[INCREMENT] === true
  );
}

export function increment(by: number): IncrementSentinel {
  return { [INCREMENT]: true, by };
}

function resolveValue(existing: unknown, value: unknown): unknown {
  if (!isIncrement(value)) return value;
  const base = typeof existing === "number" ? existing : 0;
  return base + value.by;
}

// Apply a Firestore-style update: keys containing "." are nested field paths
// (e.g. "projection.statusCounts"), everything else is a shallow top-level set.
function applyUpdate(
  existing: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(data)) {
    if (!key.includes(".")) {
      next[key] = resolveValue(next[key], value);
      continue;
    }
    const parts = key.split(".");
    let cursor = next as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      cursor[p] = { ...((cursor[p] as Record<string, unknown>) ?? {}) };
      cursor = cursor[p] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    cursor[leaf] = resolveValue(cursor[leaf], value);
  }
  return next;
}

// 백엔드 ack 대기 — 실물은 로컬 쓰기가 서버에 반영될 때까지 기다린다. 목에선
// 즉시 resolve 로 충분하다. ★없으면 안 되는 이유: tools.ts 의 감사 원장 sink 가
// 이걸 호출하므로, 미구현 시 모든 감사 write 가 TypeError 로 실패해 스풀에 쌓이고
// 그 경고가 **모든 툴 출력 앞에 prepend** 된다 — 툴 출력 문자열을 검사하는 테스트가
// 실제 결함 없이 깨진다(question-channel-tools 4번 케이스가 이걸로 깨졌다).
export async function waitForPendingWrites(_db?: unknown): Promise<void> {}

export function orderBy(_field: string, _direction?: string) {
  return { type: "orderBy" };
}

// 제약을 값으로 되돌려준다 — 서버 사이드 필터/정렬/limit 이 실제로 쿼리에 실렸는지
// 검사하는 테스트(projectAuditService)가 이 모양에 의존한다. 없으면 `limit(...)`
// 이 undefined 호출이 되어 TypeError 로 죽는다.
export function limit(count: number) {
  return { type: "limit", count };
}

export function onSnapshot(
  _query: unknown,
  _callback: (snap: unknown) => void,
) {
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
      data: Record<string, unknown>,
    ) => void;
  }) => Promise<T>,
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
      data: Record<string, unknown>,
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
