/**
 * 오케스트레이터 워크체인 — Firestore I/O (티켓 fQtXQ2NzyYs0MRpqByTS).
 *
 * 모델·판정 규칙은 `work-chain-core.ts`(순수). 여기는 `workChains/{projectId}` 한
 * 문서를 읽고, 트랜잭션으로 항목을 넣고 고치고, 연결 티켓의 라이브 status 를 읽어
 * 파생 상태를 만드는 것까지다. tools.ts 의 세 도구(get/add/update_work_chain_item)와
 * 상태 전이 도구들의 "체인을 다시 봐라" 푸터가 이 모듈을 쓴다.
 *
 * ★모든 읽기 경로는 fail-open 이다 — 체인 부기가 깨져도 상태 전이(update_task_status
 * 등)는 절대 막지 않는다(projection.ts 의 seed 블록과 같은 규율). 그래서 푸터
 * 계산은 전부 try/catch 로 감싸고 실패하면 "" 를 돌려준다.
 */
import {
  doc,
  getDoc,
  runTransaction,
  Timestamp,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import {
  WORK_CHAIN_COLLECTION,
  WORK_CHAIN_ITEMS_MAX,
  buildWorkChainItem,
  deriveWorkChain,
  insertItem,
  newWorkChainItemId,
  normalizeWorkChainItems,
  referencedTaskIds,
  rejectSelfReportReason,
  validateNewItem,
  workChainNudgeForTaskChange,
  type DerivedWorkChain,
  type NewWorkChainItemInput,
  type TaskStatusLookup,
  type WorkChainClosedKind,
  type WorkChainDoneWhen,
  type WorkChainItem,
  type WorkChainTaskStatus,
} from "./work-chain-core.js";

export interface WorkChainSnapshot {
  projectId: string;
  items: WorkChainItem[];
  rev: number;
  exists: boolean;
}

export interface WorkChainTaskFacts {
  statuses: TaskStatusLookup;
  titles: Record<string, string>;
}

export interface LoadedWorkChain extends WorkChainSnapshot {
  derived: DerivedWorkChain;
  facts: WorkChainTaskFacts;
}

function chainRef(db: Firestore, projectId: string) {
  return doc(db, WORK_CHAIN_COLLECTION, projectId);
}

function snapshotFromData(
  projectId: string,
  data: Record<string, unknown> | undefined,
): WorkChainSnapshot {
  if (!data) return { projectId, items: [], rev: 0, exists: false };
  return {
    projectId,
    items: normalizeWorkChainItems(data.items),
    rev: typeof data.rev === "number" ? data.rev : 0,
    exists: true,
  };
}

/** 체인 문서 1회 읽기. 없으면 빈 체인(exists=false). */
export async function readWorkChain(
  db: Firestore,
  projectId: string,
): Promise<WorkChainSnapshot> {
  const snap = await getDoc(chainRef(db, projectId));
  return snapshotFromData(
    projectId,
    snap.exists() ? (snap.data() as Record<string, unknown>) : undefined,
  );
}

/**
 * 연결 티켓들의 라이브 status/title. 없는 문서는 null — "보드에 없다" 가 파생
 * 상태에 그대로 드러나야 한다(근거가 사라진 항목을 조용히 ready 로 두지 않는다).
 * 개별 getDoc 이다: 클라이언트 SDK 는 `in` 쿼리가 10~30개 상한이고, 체인이 참조하는
 * 티켓은 보통 한 자릿수라 단순 병렬 읽기가 맞다.
 */
export async function loadTaskFacts(
  db: Firestore,
  taskIds: readonly string[],
  /** 이미 손에 든 티켓(get_all_tasks 결과 등) — 있으면 재조회를 건너뛴다. */
  known?: ReadonlyMap<string, { status: string; title?: string }>,
): Promise<WorkChainTaskFacts> {
  const statuses: TaskStatusLookup = {};
  const titles: Record<string, string> = {};
  const toFetch: string[] = [];
  for (const id of taskIds) {
    const k = known?.get(id);
    if (k) {
      statuses[id] = k.status as WorkChainTaskStatus;
      if (k.title) titles[id] = k.title;
    } else {
      toFetch.push(id);
    }
  }
  await Promise.all(
    toFetch.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "tasks", id));
        if (!snap.exists()) {
          statuses[id] = null;
          return;
        }
        const d = snap.data() as {
          status?: string;
          title?: string;
          deleted?: boolean;
        };
        // soft-delete 된 티켓은 보드에 없는 것과 같다.
        statuses[id] = d.deleted
          ? null
          : ((d.status as WorkChainTaskStatus) ?? null);
        if (d.title) titles[id] = d.title;
      } catch {
        // 읽기 실패는 "없음" 과 구분해 주고 싶지만, 파생 판정에선 둘 다 "근거 없음" 이다.
        statuses[id] = null;
      }
    }),
  );
  return { statuses, titles };
}

/** 체인 + 연결 티켓 사실 + 파생 상태 한 번에. */
export async function loadWorkChain(
  db: Firestore,
  projectId: string,
  known?: ReadonlyMap<string, { status: string; title?: string }>,
): Promise<LoadedWorkChain> {
  const snap = await readWorkChain(db, projectId);
  const facts = await loadTaskFacts(db, referencedTaskIds(snap.items), known);
  return {
    ...snap,
    facts,
    derived: deriveWorkChain(snap.items, facts.statuses),
  };
}

/** 트랜잭션 안에서 문서를 읽고 items 를 바꿔 쓰는 공통 틀. */
async function mutateChain(
  db: Firestore,
  projectId: string,
  by: string,
  mutate: (
    items: WorkChainItem[],
    txn: Transaction,
  ) => WorkChainItem[] | string,
): Promise<{ items: WorkChainItem[]; rev: number } | { error: string }> {
  const ref = chainRef(db, projectId);
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    const current = snapshotFromData(
      projectId,
      snap.exists() ? (snap.data() as Record<string, unknown>) : undefined,
    );
    const result = mutate([...current.items], txn);
    if (typeof result === "string") return { error: result };
    if (result.length > WORK_CHAIN_ITEMS_MAX) {
      return {
        error: `체인 항목이 ${WORK_CHAIN_ITEMS_MAX}개를 넘는다 — 닫힌 항목을 정리하거나 굵게 묶어라.`,
      };
    }
    const rev = current.rev + 1;
    const payload = {
      projectId,
      items: result,
      rev,
      updatedBy: by,
      updatedAt: Timestamp.now(),
    };
    if (snap.exists()) txn.update(ref, payload);
    else txn.set(ref, { ...payload, createdAt: Timestamp.now() });
    return { items: result, rev };
  });
}

export interface AddWorkChainItemResult {
  item?: WorkChainItem;
  items?: WorkChainItem[];
  rev?: number;
  error?: string;
}

export async function addWorkChainItem(
  db: Firestore,
  projectId: string,
  by: string,
  input: NewWorkChainItemInput,
  position?: number,
  now: number = Date.now(),
): Promise<AddWorkChainItemResult> {
  const invalid = validateNewItem(input);
  if (invalid) return { error: invalid };
  const item = buildWorkChainItem(input, { id: newWorkChainItemId(), now, by });
  const res = await mutateChain(db, projectId, by, (items) => {
    // 선행 항목 id 는 실제로 있어야 한다 — 없는 id 를 걸면 영원히 waiting 이다.
    const known = new Set(items.map((i) => i.id));
    const unknown = item.afterItemIds.filter((id) => !known.has(id));
    if (unknown.length)
      return `after_item_ids 에 없는 항목 id: ${unknown.join(", ")} — get_work_chain 으로 id 를 확인해라.`;
    return insertItem(items, item, position);
  });
  if ("error" in res) return { error: res.error };
  return { item, items: res.items, rev: res.rev };
}

export interface UpdateWorkChainItemInput {
  what?: string;
  why?: string;
  note?: string;
  /** 교체. */
  taskIds?: string[];
  /** 추가(중복 무시). */
  addTaskIds?: string[];
  afterTaskIds?: string[];
  afterItemIds?: string[];
  doneWhen?: WorkChainDoneWhen;
  /** 명시적 종료. dropped 는 사유, self_reported 는 근거(reason)가 필요. */
  close?: WorkChainClosedKind;
  reason?: string;
  /** 닫힌 항목을 다시 연다(closed 제거). close 와 함께 줄 수 없다. */
  reopen?: boolean;
  /** 배열 내 위치 이동(0-base). */
  position?: number;
}

export interface UpdateWorkChainItemResult {
  item?: WorkChainItem;
  items?: WorkChainItem[];
  rev?: number;
  error?: string;
}

export async function updateWorkChainItem(
  db: Firestore,
  projectId: string,
  by: string,
  itemId: string,
  input: UpdateWorkChainItemInput,
  now: number = Date.now(),
): Promise<UpdateWorkChainItemResult> {
  if (input.close && input.reopen)
    return { error: "close 와 reopen 을 함께 줄 수 없다." };
  let updated: WorkChainItem | undefined;
  const res = await mutateChain(db, projectId, by, (items) => {
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx < 0)
      return `체인에 항목 ${itemId} 가 없다 — get_work_chain 으로 id 를 확인해라.`;
    const prev = items[idx];
    const next: WorkChainItem = { ...prev, updatedAt: now };
    if (input.what !== undefined) {
      const w = input.what.trim();
      if (!w) return "what 을 빈 값으로 바꿀 수 없다.";
      next.what = w;
    }
    if (input.why !== undefined) {
      const w = input.why.trim();
      if (!w) return "why 를 빈 값으로 바꿀 수 없다.";
      next.why = w;
    }
    if (input.note !== undefined) {
      const n = input.note.trim();
      if (n) next.note = n;
      else delete next.note;
    }
    if (input.taskIds !== undefined)
      next.taskIds = [
        ...new Set(input.taskIds.map((s) => s.trim()).filter(Boolean)),
      ];
    if (input.addTaskIds?.length)
      next.taskIds = [
        ...new Set([
          ...next.taskIds,
          ...input.addTaskIds.map((s) => s.trim()).filter(Boolean),
        ]),
      ];
    if (input.afterTaskIds !== undefined)
      next.afterTaskIds = [
        ...new Set(input.afterTaskIds.map((s) => s.trim()).filter(Boolean)),
      ];
    if (input.afterItemIds !== undefined) {
      const ids = [
        ...new Set(input.afterItemIds.map((s) => s.trim()).filter(Boolean)),
      ];
      const known = new Set(items.map((i) => i.id));
      const unknown = ids.filter((id) => !known.has(id) || id === itemId);
      if (unknown.length)
        return `after_item_ids 에 없는(또는 자기 자신) 항목 id: ${unknown.join(", ")}.`;
      next.afterItemIds = ids;
    }
    if (input.doneWhen !== undefined) next.doneWhen = input.doneWhen;
    if (input.reopen) delete next.closed;
    if (input.close) {
      const reason = (input.reason ?? "").trim();
      if (input.close === "dropped") {
        if (!reason)
          return "dropped 로 닫으려면 reason(왜 더 이상 유효하지 않은지)을 적어라.";
      } else {
        const rejected = rejectSelfReportReason(next, reason);
        if (rejected) return rejected;
      }
      next.closed = { kind: input.close, reason, at: now, by };
    }
    const out = items.filter((_, i) => i !== idx);
    updated = next;
    return insertItem(
      out,
      next,
      input.position !== undefined ? input.position : idx,
    );
  });
  if ("error" in res) return { error: res.error };
  return { item: updated, items: res.items, rev: res.rev };
}

/**
 * 티켓 status 전이 직후 오케에게 붙일 체인 메모. 이 티켓을 참조하는 항목이 없거나
 * 상태 변화가 없으면 "". ★절대 throw 하지 않는다 — 전이 결과 텍스트에 덧붙이는
 * 부기일 뿐이다.
 */
export async function workChainNudgeAfterTransition(
  db: Firestore,
  projectId: string,
  taskId: string,
  oldStatus: WorkChainTaskStatus,
  newStatus: WorkChainTaskStatus,
): Promise<string> {
  if (!projectId) return "";
  try {
    const snap = await readWorkChain(db, projectId);
    if (snap.items.length === 0) return "";
    const touches = snap.items.some(
      (i) => i.taskIds.includes(taskId) || i.afterTaskIds.includes(taskId),
    );
    if (!touches) return "";
    const facts = await loadTaskFacts(db, referencedTaskIds(snap.items));
    // 방금 쓴 전이는 자기 자신이 읽을 때 이미 반영돼 있다(같은 클라이언트). 그래도
    // before/after 를 명시적으로 만들어 "이 전이가 바꾼 것" 만 말한다.
    const after = { ...facts.statuses, [taskId]: newStatus };
    const before = { ...facts.statuses, [taskId]: oldStatus };
    return workChainNudgeForTaskChange(
      deriveWorkChain(snap.items, before),
      deriveWorkChain(snap.items, after),
      taskId,
    );
  } catch (err) {
    console.error("[work-chain] nudge skipped:", err);
    return "";
  }
}
