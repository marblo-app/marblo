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
 *
 * ## 자동 포착 (티켓 lW9iiLGWlO0lVoy4khSM)
 * `captureWorkChainPromises` / `captureMergeHoldFollowUp` 는 **쓰는 쪽의 자발성을
 * 없앤 경로**다. 감지 규칙은 `work-chain-capture.ts`(순수), 여기는 그걸 체인에
 * 실제로 넣는 I/O 다. 쓰기 경로지만 **읽기와 같은 fail-open** 이다 — 자동 기록이
 * 실패해도 원래 도구(머지 마감·사장님 보고·답변)는 그대로 성공해야 한다. 다만
 * ★실패를 삼키지는 않는다: 실패 사실은 결과 문장으로 돌려준다. 삼키면 오케는
 * "적혔다" 고 믿고 지나가고, 그건 안 적은 것보다 나쁘다(현재 프로덕션에
 * workChains 규칙이 미배포라 permission-denied 가 실제로 난다).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import {
  buildOwnerMissions,
  dedupeAgainstChain,
  detectFollowUpPromises,
  formatCaptureNote,
  formatOwnerMissionNote,
  ownerMissionVeto,
  type CaptureSurface,
  type CapturedPromise,
  type CreatedTaskFact,
  type OwnerMissionVeto,
} from "./work-chain-capture.js";
import { markOwnerInboundConsumed, readOwnerInbound } from "./owner-inbound.js";
import {
  isImplicitMissionDoc,
  missionLabelKey,
  normalizeMissionLabel,
} from "./implicit-mission.js";
import {
  WORK_CHAIN_COLLECTION,
  WORK_CHAIN_OPEN_ITEMS_MAX,
  buildMissionMembership,
  buildWorkChainItem,
  deriveWorkChain,
  evidenceTaskIds,
  insertItem,
  newWorkChainItemId,
  normalizeWorkChainItems,
  referencedTaskIds,
  rejectDropReason,
  rejectSelfReportReason,
  validateNewItem,
  workChainNudgeForTaskChange,
  type DerivedWorkChain,
  type MissionMemberTask,
  type MissionMembershipLookup,
  type MissionMembershipSource,
  type NewWorkChainItemInput,
  type TaskStatusLookup,
  type WorkChainClosedKind,
  type WorkChainDoneWhen,
  type WorkChainItem,
  type WorkChainTaskStatus,
} from "./work-chain-core.js";
import {
  addFallbackEntry,
  enqueueWorkChainFallback,
  replaceWorkChainFallbacks,
  takeWorkChainFallbacks,
  updateFallbackEntry,
  type WorkChainSpoolEntry,
} from "./work-chain-spool.js";

export interface WorkChainSnapshot {
  projectId: string;
  items: WorkChainItem[];
  /** Items moved out of the active queue but retained for audit/reopen. */
  archivedItems?: WorkChainItem[];
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
  membership: MissionMembershipLookup;
}

const MISSIONS_COLLECTION = "missions";
const TASKS_COLLECTION = "tasks";

function chainRef(db: Firestore, projectId: string) {
  return doc(db, WORK_CHAIN_COLLECTION, projectId);
}

function snapshotFromData(
  projectId: string,
  data: Record<string, unknown> | undefined,
): WorkChainSnapshot {
  if (!data)
    return { projectId, items: [], archivedItems: [], rev: 0, exists: false };
  const rawItems = normalizeWorkChainItems(data.items);
  const rawArchived = normalizeWorkChainItems(data.archivedItems);
  const archivedIds = new Set(rawArchived.map((item) => item.id));
  for (const item of rawItems) {
    if (item.archived) archivedIds.add(item.id);
  }
  const archivedItems = [
    ...rawArchived,
    ...rawItems.filter(
      (item) =>
        item.archived &&
        !rawArchived.some((archived) => archived.id === item.id),
    ),
  ];
  return {
    projectId,
    // Legacy documents stored all items in `items`. New documents split the
    // active queue from the archive, but the MCP read path exposes both to
    // preserve the existing include_closed/read API.
    items: [
      ...rawItems.filter((item) => !archivedIds.has(item.id)),
      ...archivedItems,
    ],
    archivedItems,
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

/**
 * 체인 항목의 미션 라벨 → 보드 티켓 소속. 실패하면 {} (파생은 unsplit 로 보인다).
 * 미션 엔진을 켜지 않는다 — implicit 문서·contextId 조인만 읽는다.
 */
export async function loadMissionMembership(
  db: Firestore,
  projectId: string,
  items: readonly WorkChainItem[],
): Promise<MissionMembershipLookup> {
  const labeled = items.filter((item) => item.missionLabel);
  if (labeled.length === 0) return {};
  try {
    const missionsSnap = await getDocs(
      query(
        collection(db, MISSIONS_COLLECTION),
        where("projectId", "==", projectId),
      ),
    );
    const missions: MissionMembershipSource[] = missionsSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        missionKind:
          typeof data.missionKind === "string" ? data.missionKind : undefined,
        implicitLabel:
          typeof data.implicitLabel === "string"
            ? data.implicitLabel
            : undefined,
        status: typeof data.status === "string" ? data.status : undefined,
      };
    });
    const wantedKeys = new Set(
      labeled.map((item) => missionLabelKey(item.missionLabel as string)),
    );
    // ★같은 키의 미션을 전부 모은다(가). 최근 1개만 고르면(나) 과거 배치가
    // 빠지고, 사장님이 건 덩어리의 3/7 대신 다른 숫자를 답하게 된다.
    // 합산 자체는 맞다 — 조용한 합산이 틀리다. missionCount 가 2+ 이면
    // derive 가 "미션 N개 합산" 을 펼침/MCP 에 싣는다.
    const wantedMissionIds: string[] = [];
    for (const mission of missions) {
      if (!isImplicitMissionDoc(mission)) continue;
      const label = normalizeMissionLabel(mission.implicitLabel ?? null);
      if (!label) continue;
      if (!wantedKeys.has(missionLabelKey(label))) continue;
      wantedMissionIds.push(mission.id);
    }
    if (wantedMissionIds.length === 0) {
      return buildMissionMembership(missions, []);
    }
    const tasks: MissionMemberTask[] = [];
    await Promise.all(
      wantedMissionIds.map(async (missionId) => {
        const snap = await getDocs(
          query(
            collection(db, TASKS_COLLECTION),
            where("projectId", "==", projectId),
            where("contextId", "==", missionId),
          ),
        );
        for (const d of snap.docs) {
          const data = d.data() as { deleted?: boolean };
          tasks.push({
            id: d.id,
            contextId: missionId,
            deleted: !!data.deleted,
          });
        }
      }),
    );
    return buildMissionMembership(missions, tasks);
  } catch (err) {
    console.error("[work-chain] mission membership skipped:", err);
    return {};
  }
}

/** 체인 + 연결 티켓 사실 + 파생 상태 한 번에. */
export async function loadWorkChain(
  db: Firestore,
  projectId: string,
  known?: ReadonlyMap<string, { status: string; title?: string }>,
): Promise<LoadedWorkChain> {
  const snap = await readWorkChain(db, projectId);
  const membership = await loadMissionMembership(db, projectId, snap.items);
  const facts = await loadTaskFacts(
    db,
    referencedTaskIds(snap.items, membership),
    known,
  );
  return {
    ...snap,
    facts,
    membership,
    derived: deriveWorkChain(snap.items, facts.statuses, membership),
  };
}

interface PartitionedWorkChainItems {
  active: WorkChainItem[];
  archived: WorkChainItem[];
}

function partitionWorkChainItems(
  items: readonly WorkChainItem[],
): PartitionedWorkChainItems {
  return {
    active: items.filter((item) => !item.archived),
    archived: items.filter((item) => Boolean(item.archived)),
  };
}

/**
 * Move already-finished history out of the active array without deleting it.
 * The first write after deployment also migrates legacy documents that stored
 * every historical item in `items`. The archive lives in the same Firestore
 * document so existing project rules continue to apply and `reopen` remains
 * a reversible operation.
 */
async function archiveClosedWorkChainItems(
  db: Firestore,
  projectId: string,
  by: string,
  now: number,
): Promise<number> {
  const chain = await loadWorkChain(db, projectId);
  const candidates = new Map<string, "done" | "dropped">();
  for (const derived of chain.derived.items) {
    if (derived.item.archived) continue;
    if (derived.state === "done" || derived.state === "dropped")
      candidates.set(derived.item.id, derived.state);
  }
  if (candidates.size === 0) return 0;

  const ref = chainRef(db, projectId);
  await runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    const current = snapshotFromData(
      projectId,
      snap.exists() ? (snap.data() as Record<string, unknown>) : undefined,
    );
    const next = current.items.map((item) => {
      const state = candidates.get(item.id);
      if (!state || item.archived) return item;
      return { ...item, archived: { at: now, state } };
    });
    const partitioned = partitionWorkChainItems(next);
    const payload = {
      projectId,
      items: partitioned.active,
      archivedItems: partitioned.archived,
      rev: current.rev + 1,
      updatedBy: by,
      updatedAt: Timestamp.now(),
    };
    if (snap.exists()) txn.update(ref, payload);
    else txn.set(ref, { ...payload, createdAt: Timestamp.now() });
  });
  return candidates.size;
}

interface ChainMutationError {
  error: string;
  /** The mutation can succeed after compaction/rule recovery; spool it. */
  retryable?: boolean;
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
): Promise<{ items: WorkChainItem[]; rev: number } | ChainMutationError> {
  const ref = chainRef(db, projectId);
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    const current = snapshotFromData(
      projectId,
      snap.exists() ? (snap.data() as Record<string, unknown>) : undefined,
    );
    const result = mutate([...current.items], txn);
    if (typeof result === "string") return { error: result };
    const partitioned = partitionWorkChainItems(result);
    if (partitioned.active.length > WORK_CHAIN_OPEN_ITEMS_MAX) {
      return {
        error:
          `열린 체인 항목이 ${WORK_CHAIN_OPEN_ITEMS_MAX}개를 넘는다 — ` +
          `열린 지시는 임의로 지우지 않고 로컬 복구 대기열에 보존한다.`,
        retryable: true,
      };
    }
    const rev = current.rev + 1;
    const payload = {
      projectId,
      items: partitioned.active,
      archivedItems: partitioned.archived,
      rev,
      updatedBy: by,
      updatedAt: Timestamp.now(),
    };
    if (snap.exists()) txn.update(ref, payload);
    else txn.set(ref, { ...payload, createdAt: Timestamp.now() });
    return { items: [...partitioned.active, ...partitioned.archived], rev };
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
  persistFailure = true,
): Promise<AddWorkChainItemResult> {
  // A later successful tool call is a recovery opportunity even without an
  // MCP restart (for example immediately after rules are deployed).
  if (persistFailure) await restoreWorkChainFallbacks(db).catch(() => 0);
  const invalid = validateNewItem(input);
  if (invalid) return { error: invalid };
  const item = buildWorkChainItem(input, { id: newWorkChainItemId(), now, by });
  // Compact old DONE/DROPPED history before enforcing the active-queue cap.
  // Failure is intentionally non-fatal: mutateChain will either write or
  // enqueue this new instruction, so the instruction cannot disappear.
  try {
    await archiveClosedWorkChainItems(db, projectId, by, now);
  } catch (error) {
    console.error("[work-chain] closed-item compaction skipped:", error);
  }
  let res: Awaited<ReturnType<typeof mutateChain>>;
  try {
    res = await mutateChain(db, projectId, by, (items) => {
      // 선행 항목 id 는 실제로 있어야 한다 — 없는 id 를 걸면 영원히 waiting 이다.
      const known = new Set(items.map((i) => i.id));
      const unknown = item.afterItemIds.filter((id) => !known.has(id));
      if (unknown.length)
        return `after_item_ids 에 없는 항목 id: ${unknown.join(", ")} — get_work_chain 으로 id 를 확인해라.`;
      return insertItem(items, item, position);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (persistFailure) {
      try {
        await enqueueWorkChainFallback(
          addFallbackEntry(projectId, by, item, position),
        );
        return {
          error: `워크체인에 기록하지 못했습니다: ${detail}. 항목은 로컬 복구 대기열에 보존됐으며 권한 복구 뒤 자동 재시도됩니다.`,
        };
      } catch (spoolError) {
        const spoolDetail =
          spoolError instanceof Error ? spoolError.message : String(spoolError);
        return {
          error: `워크체인에 기록하지 못했습니다: ${detail}. 로컬 복구 대기열 저장도 실패했습니다: ${spoolDetail}`,
        };
      }
    }
    return { error: `워크체인 복구 재시도 실패: ${detail}` };
  }
  if ("error" in res) {
    if (res.retryable && persistFailure) {
      try {
        await enqueueWorkChainFallback(
          addFallbackEntry(projectId, by, item, position),
        );
        return {
          error:
            `${res.error} 항목은 로컬 복구 대기열에 보존됐으며 ` +
            `활성 항목이 줄어들면 자동 재시도됩니다.`,
        };
      } catch (spoolError) {
        const detail =
          spoolError instanceof Error ? spoolError.message : String(spoolError);
        return {
          error: `${res.error} 로컬 복구 대기열 저장도 실패했습니다: ${detail}`,
        };
      }
    }
    return { error: res.error };
  }
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
  /** 암묵 미션 라벨. 빈 문자열이면 제거. */
  missionLabel?: string;
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
  persistFailure = true,
): Promise<UpdateWorkChainItemResult> {
  if (persistFailure) await restoreWorkChainFallbacks(db).catch(() => 0);
  if (input.close && input.reopen)
    return { error: "close 와 reopen 을 함께 줄 수 없다." };
  let updated: WorkChainItem | undefined;
  let res: Awaited<ReturnType<typeof mutateChain>>;
  try {
    res = await mutateChain(db, projectId, by, (items) => {
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
      if (input.missionLabel !== undefined) {
        const label = normalizeMissionLabel(input.missionLabel);
        if (label) next.missionLabel = label;
        else delete next.missionLabel;
      }
      if (input.reopen) {
        delete next.closed;
        delete next.archived;
      }
      if (input.close) {
        const reason = (input.reason ?? "").trim();
        if (input.close === "dropped") {
          if (!reason)
            return "dropped 로 닫으려면 reason(왜 더 이상 유효하지 않은지)을 적어라.";
          // ★사장님 항목은 사유의 바닥이 더 높다(work-chain-core §rejectDropReason).
          const rejectedDrop = rejectDropReason(next, reason);
          if (rejectedDrop) return rejectedDrop;
        } else {
          const rejected = rejectSelfReportReason(next, reason);
          if (rejected) return rejected;
        }
        next.closed = { kind: input.close, reason, at: now, by };
        next.archived = {
          at: now,
          state: input.close === "dropped" ? "dropped" : "done",
        };
      }
      const out = items.filter((_, i) => i !== idx);
      updated = next;
      return insertItem(
        out,
        next,
        input.position !== undefined ? input.position : idx,
      );
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (persistFailure) {
      try {
        await enqueueWorkChainFallback(
          updateFallbackEntry(
            projectId,
            by,
            itemId,
            input as Record<string, unknown>,
          ),
        );
        return {
          error: `워크체인 항목을 갱신하지 못했습니다: ${detail}. 변경은 로컬 복구 대기열에 보존됐으며 권한 복구 뒤 자동 재시도됩니다.`,
        };
      } catch (spoolError) {
        const spoolDetail =
          spoolError instanceof Error ? spoolError.message : String(spoolError);
        return {
          error: `워크체인 항목을 갱신하지 못했습니다: ${detail}. 로컬 복구 대기열 저장도 실패했습니다: ${spoolDetail}`,
        };
      }
    }
    return { error: `워크체인 복구 재시도 실패: ${detail}` };
  }
  if ("error" in res) {
    if (res.retryable && persistFailure) {
      try {
        await enqueueWorkChainFallback(
          updateFallbackEntry(
            projectId,
            by,
            itemId,
            input as Record<string, unknown>,
          ),
        );
        return {
          error:
            `${res.error} 변경은 로컬 복구 대기열에 보존됐으며 ` +
            `활성 항목이 줄어들면 자동 재시도됩니다.`,
        };
      } catch (spoolError) {
        const detail =
          spoolError instanceof Error ? spoolError.message : String(spoolError);
        return {
          error: `${res.error} 로컬 복구 대기열 저장도 실패했습니다: ${detail}`,
        };
      }
    }
    return { error: res.error };
  }
  return { item: updated, items: res.items, rev: res.rev };
}

/** Replay durable failures in FIFO order. Stop at the first failure to retain ordering. */
export async function restoreWorkChainFallbacks(
  db: Firestore,
): Promise<number> {
  const entries = await takeWorkChainFallbacks();
  let restored = 0;
  const remaining: WorkChainSpoolEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const result =
      entry.kind === "add"
        ? await addWorkChainItem(
            db,
            entry.projectId,
            entry.by,
            entry.item,
            entry.position,
            entry.item.createdAt,
            false,
          )
        : await updateWorkChainItem(
            db,
            entry.projectId,
            entry.by,
            entry.itemId,
            entry.input as UpdateWorkChainItemInput,
            Date.now(),
            false,
          );
    if (result.error) {
      remaining.push(...entries.slice(index));
      break;
    }
    restored += 1;
  }
  if (remaining.length !== entries.length || entries.length === 0)
    await replaceWorkChainFallbacks(remaining);
  return restored;
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
    const membership = await loadMissionMembership(db, projectId, snap.items);
    const touches = snap.items.some(
      (i) =>
        evidenceTaskIds(i, membership).includes(taskId) ||
        i.afterTaskIds.includes(taskId),
    );
    if (!touches) return "";
    const facts = await loadTaskFacts(
      db,
      referencedTaskIds(snap.items, membership),
    );
    // 방금 쓴 전이는 자기 자신이 읽을 때 이미 반영돼 있다(같은 클라이언트). 그래도
    // before/after 를 명시적으로 만들어 "이 전이가 바꾼 것" 만 말한다.
    const after = { ...facts.statuses, [taskId]: newStatus };
    const before = { ...facts.statuses, [taskId]: oldStatus };
    return workChainNudgeForTaskChange(
      deriveWorkChain(snap.items, before, membership),
      deriveWorkChain(snap.items, after, membership),
      taskId,
    );
  } catch (err) {
    console.error("[work-chain] nudge skipped:", err);
    return "";
  }
}

// ── 자동 포착 (티켓 lW9iiLGWlO0lVoy4khSM) ─────────────────────────────────
//
// ★순환을 끊는 지점. 지금까지 체인에 "적는" 행위는 오케가 add_work_chain_item 을
// 부르기로 결심해야 일어났다 — 즉 "잊는 걸 고치는 장치가 안 잊어야 작동" 했다.
// 여기서는 오케가 **이미 도구 인자로 넘긴 문장**을 도구 층이 읽고 대신 적는다.
// 오케가 잊을 게 남지 않는다.

export interface CaptureWorkChainInput {
  projectId: string;
  /** 적은 주체(agentId). 항목의 createdBy 가 된다. */
  by: string;
  /** 어느 도구가 호출했나 — 항목에 sourceTool 로 남고 오탐 진단 축이 된다. */
  tool: string;
  surface: CaptureSurface;
  /** 오케가 실제로 쓴 텍스트(인자 원문). */
  text: string;
  /**
   * 이 호출이 다루고 있는 티켓. "A 가 끝나면 B" 처럼 선행 힌트가 있는데 문장에
   * 티켓 id 가 안 적혀 있으면 이 id 를 선행으로 건다 — dispatch 중에 말한
   * "이거 끝나면" 의 '이거' 가 바로 이 티켓이다.
   */
  contextTaskId?: string;
}

export interface CaptureWorkChainResult {
  /** 도구 결과에 덧붙일 문장. 아무것도 안 적었으면 "". */
  note: string;
  /** 실제로 적힌 항목들. */
  written: Array<{ id: string; what: string }>;
  /** 감지된 후보 수(중복 제거 전) — ★소음 실측 축. */
  detected: number;
  /** 중복이라 버린 수. */
  skippedDuplicate: number;
  /** 쓰기 실패 사유. 있으면 note 에도 경고가 들어간다. */
  error?: string;
}

const EMPTY_CAPTURE: CaptureWorkChainResult = {
  note: "",
  written: [],
  detected: 0,
  skippedDuplicate: 0,
};

/** 문장에서 뽑은 티켓 id 후보 중 **보드에 실제로 있는 것**만 남긴다. */
async function verifyTaskIds(
  db: Firestore,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const facts = await loadTaskFacts(db, ids);
  return ids.filter((id) => facts.statuses[id] != null);
}

/**
 * 오케가 쓴 텍스트에서 약속을 포착해 체인에 적는다.
 *
 * ★절대 throw 하지 않는다. 감지가 0건이면 Firestore 를 **읽지도 않는다** —
 * 약속이 없는 호출에는 비용도 소음도 0이어야 한다(그게 이 설계의 전제다).
 */
export async function captureWorkChainPromises(
  db: Firestore,
  input: CaptureWorkChainInput,
): Promise<CaptureWorkChainResult> {
  const { projectId, by, tool, surface, text, contextTaskId } = input;
  if (!projectId) return EMPTY_CAPTURE;
  let candidates: CapturedPromise[];
  try {
    candidates = detectFollowUpPromises(text, surface);
  } catch (err) {
    console.error("[work-chain] capture detection failed:", err);
    return EMPTY_CAPTURE;
  }
  if (candidates.length === 0) return EMPTY_CAPTURE;

  try {
    const snap = await readWorkChain(db, projectId);
    const fresh = dedupeAgainstChain(candidates, snap.items);
    if (fresh.length === 0) {
      return {
        ...EMPTY_CAPTURE,
        detected: candidates.length,
        skippedDuplicate: candidates.length,
      };
    }
    const written: Array<{ id: string; what: string }> = [];
    let error: string | undefined;
    for (const c of fresh) {
      // 선행은 **검증된 티켓만** 건다. 없는 id 를 걸면 항목이 영원히 waiting 이고,
      // 그건 체인이 조용히 죽는 방식이다.
      const afterTaskIds = c.hasDependencyHint
        ? await verifyTaskIds(
            db,
            c.taskIdHints.length > 0
              ? c.taskIdHints
              : contextTaskId
                ? [contextTaskId]
                : [],
          )
        : [];
      const res = await addWorkChainItem(db, projectId, by, {
        what: c.what,
        why: c.why,
        afterTaskIds,
        // ★티켓은 붙이지 않는다. 자동 포착은 "할 일" 을 잡은 것이지 "그 일의 티켓"
        // 을 아는 게 아니다. 티켓이 생기면 오케가 add_task_ids 로 붙이고, 그때부터
        // 보드가 완료를 판정한다(§7 설계 불변).
        doneWhen: "done",
        source: "auto",
        sourceTool: tool,
      });
      if (res.error) {
        error = res.error;
        break;
      }
      if (res.item) written.push({ id: res.item.id, what: res.item.what });
    }
    return {
      // 실패한 후보의 원문을 반드시 결과에 남긴다. 대기열 복구가 있어도 오케가
      // "이미 적혔다"고 오해하지 않고 즉시 확인/재지시할 수 있어야 한다.
      note: error
        ? captureFailureNote(fresh, error)
        : buildCaptureNote(written),
      written,
      detected: candidates.length,
      skippedDuplicate: candidates.length - fresh.length,
      ...(error ? { error } : {}),
    };
  } catch (err) {
    // ★삼키지 않는다. 지금 프로덕션은 workChains 규칙 미배포라 여기서
    // permission-denied 가 난다 — "적혔다" 고 믿게 두면 안 적은 것보다 나쁘다.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[work-chain] capture write failed:", err);
    return {
      note: captureFailureNote(candidates, message),
      written: [],
      detected: candidates.length,
      skippedDuplicate: 0,
      error: message,
    };
  }
}

function buildCaptureNote(
  written: ReadonlyArray<{ id: string; what: string }>,
  error?: string,
): string {
  const base = formatCaptureNote(written);
  if (!error) return base;
  const warn =
    `⚠️ 워크체인 자동 기록 실패: ${error}\n` +
    `  남은 약속은 add_work_chain_item(what, why) 로 직접 적어라.`;
  return base ? `${base}\n${warn}` : warn;
}

function captureFailureNote(
  candidates: readonly CapturedPromise[],
  message: string,
): string {
  const quoted = candidates.map((c) => `  · ${c.what}`).join("\n");
  return (
    `⚠️ 워크체인 자동 기록 실패 — ${message}\n` +
    `아래를 잡았지만 **적지 못했다.** 그대로 두면 사라진다:\n${quoted}\n` +
    `  add_work_chain_item(what, why) 로 직접 적거나, 규칙 배포 후 다시 말해라.`
  );
}

// ══ ★사장님 미션 포착 — 행동이 증거다 (티켓 wx9c4NeVtZ1SGcbEISpg) ══════════
//
// 감지 규칙과 훅 A/B/C 비교 근거는 `work-chain-capture.ts` 의 같은 이름 절에 있다.
// 여기는 그 판정을 체인에 실제로 넣는 I/O 다. 위의 자동 포착과 같은 규율:
// ★절대 throw 하지 않고, 원래 도구(create_task)를 절대 실패시키지 않는다.

/**
 * 사장님 메시지와 티켓 생성 사이의 창. 이 창을 벗어난 티켓은 사장님 지시가
 * 아니라 오케 자기 일로 본다.
 *
 * ★30분인 근거: 사장님 지시 한 통은 오케가 읽고 → 답하고 → 티켓 여러 개를
 * 만드는 데 실제로 수 분에서 십수 분이 걸린다(2026-08-24 미션 5건이 그랬다).
 * 너무 짧으면 그 실측을 못 덮고, 너무 길면 무관한 티켓이 사장님 항목으로
 * 오분류된다. 오분류의 비용은 **소비 1회 규칙**이 묶어 준다 — 한 메시지의 한
 * 묶음은 항목 하나만 만들고, 그 뒤 티켓은 새 항목이 아니라 근거로 붙는다.
 */
export const OWNER_MISSION_WINDOW_MS = 30 * 60 * 1000;

function ownerMissionWindowMs(): number {
  const raw = Number(process.env.MARBLO_OWNER_MISSION_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : OWNER_MISSION_WINDOW_MS;
}

export interface CaptureOwnerMissionInput {
  projectId: string;
  /** 적은 주체(agentId) — 항목의 createdBy. */
  by: string;
  /** 어느 도구가 티켓을 만들었나(create_task / create_tasks_bulk). */
  tool: string;
  /** 방금 생긴 티켓들 — ★행동 증거. */
  tasks: readonly CreatedTaskFact[];
  now?: number;
}

export interface CaptureOwnerMissionResult {
  note: string;
  /** 새로 적힌 사장님 미션 항목. */
  written: Array<{ id: string; what: string; taskIds: string[] }>;
  /** 이미 있던 항목에 근거 티켓만 붙인 것. */
  attached: Array<{ id: string; what: string; taskIds: string[] }>;
  /** 왜 안 잡았는가(진단). 잡았으면 undefined. */
  skipped?:
    | "no_inbound"
    | "out_of_window"
    | OwnerMissionVeto
    | "no_tasks"
    | "error";
  error?: string;
}

const EMPTY_OWNER_MISSION: CaptureOwnerMissionResult = {
  note: "",
  written: [],
  attached: [],
};

/**
 * ★사장님이 준 미션을 체인에 남긴다.
 *
 * 판정은 **행동**이다 — 사장님 메시지가 창 안에 있고 그 뒤 티켓이 생겼으면
 * 그게 미션이다. 사장님 한국어를 분류하지 않는다(거부권만 본다).
 *
 * 소비 1회: 같은 메시지의 같은 묶음(미션 라벨 키)은 항목을 하나만 만들고,
 * 그 뒤에 오는 같은 묶음의 티켓은 **그 항목의 근거 티켓으로 붙는다.** 항목이
 * 티켓 수만큼 늘어나면 체인이 보드의 사본이 되는데, 그건 §7 설계 위반이다.
 */
export async function captureOwnerMission(
  db: Firestore,
  input: CaptureOwnerMissionInput,
): Promise<CaptureOwnerMissionResult> {
  const { projectId, by, tool, tasks } = input;
  if (!projectId) return EMPTY_OWNER_MISSION;
  const usable = tasks.filter((t) => t.id);
  if (usable.length === 0)
    return { ...EMPTY_OWNER_MISSION, skipped: "no_tasks" };
  const now = input.now ?? Date.now();
  try {
    const entries = await readOwnerInbound(projectId);
    if (entries.length === 0)
      return { ...EMPTY_OWNER_MISSION, skipped: "no_inbound" };
    // 최신 인바운드 하나만 본다 — 그 앞의 메시지는 이미 자기 차례에 판정됐다.
    const entry = entries[0];
    if (now - entry.at > ownerMissionWindowMs())
      return { ...EMPTY_OWNER_MISSION, skipped: "out_of_window" };
    const veto = ownerMissionVeto(entry.text);
    if (veto) return { ...EMPTY_OWNER_MISSION, skipped: veto };

    const missions = buildOwnerMissions(
      {
        channel: entry.channel,
        from: entry.from,
        text: entry.text,
        at: entry.at,
      },
      usable,
    );
    if (missions.length === 0) return EMPTY_OWNER_MISSION;

    const snap = await readWorkChain(db, projectId);
    const written: Array<{ id: string; what: string; taskIds: string[] }> = [];
    const attached: Array<{ id: string; what: string; taskIds: string[] }> = [];
    let error: string | undefined;

    for (const mission of missions) {
      const existingId = entry.consumed?.[mission.groupKey];
      const existing = existingId
        ? snap.items.find((i) => i.id === existingId && !i.closed)
        : undefined;
      if (existing) {
        // 이미 이 묶음의 항목이 있다 — 새 티켓은 근거로 붙인다.
        const fresh = mission.taskIds.filter(
          (id) => !existing.taskIds.includes(id),
        );
        if (fresh.length === 0) continue;
        const res = await updateWorkChainItem(db, projectId, by, existing.id, {
          addTaskIds: fresh,
        });
        if (res.error) {
          error = res.error;
          break;
        }
        attached.push({
          id: existing.id,
          what: existing.what,
          taskIds: fresh,
        });
        continue;
      }
      const res = await addWorkChainItem(db, projectId, by, {
        what: mission.what,
        why: mission.why,
        taskIds: mission.taskIds,
        ...(mission.missionLabel ? { missionLabel: mission.missionLabel } : {}),
        doneWhen: "done",
        source: "owner",
        sourceTool: tool,
      });
      if (res.error) {
        error = res.error;
        break;
      }
      if (res.item) {
        written.push({
          id: res.item.id,
          what: res.item.what,
          taskIds: res.item.taskIds,
        });
        await markOwnerInboundConsumed(
          entry.key,
          mission.groupKey,
          res.item.id,
        );
      }
    }

    const note = error
      ? `⚠️ 사장님 미션을 워크체인에 적지 못했다 — ${error}\n` +
        `  사장님이 방금 주신 지시가 체인에 **없다.** add_work_chain_item 으로 직접 적어라.`
      : formatOwnerMissionNote(written, attached);
    return {
      note,
      written,
      attached,
      ...(error ? { error, skipped: "error" as const } : {}),
    };
  } catch (err) {
    // ★삼키지 않는다 — 사장님 지시가 조용히 사라지는 건 이 티켓이 고치려는
    // 실패 그 자체다.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[work-chain] owner mission capture failed:", err);
    return {
      note:
        `⚠️ 사장님 미션 자동 기록 실패 — ${message}\n` +
        `  방금 만든 티켓이 사장님 지시라면 add_work_chain_item 으로 직접 적어라.`,
      written: [],
      attached: [],
      skipped: "error",
      error: message,
    };
  }
}

/**
 * ★merge_and_close 가 HOLD_REVIEW 를 낼 때의 무조건 포착.
 *
 * 텍스트 감지가 아니다 — `evaluateMergeCloseout` 이 **이미 판정한 사실**
 * ("PR 은 머지됐는데 후속이 남아 있다")을 그대로 항목으로 옮긴다. 그래서
 *   · 오탐률 = 기존 detectFollowupSignals 의 오탐률(이미 프로덕션 판정),
 *   · 추가 감지 비용 0,
 *   · 그리고 **빠져나갈 인자가 없다** — 후속 때문에 티켓을 REVIEW 에 붙잡아
 *     놓으면서 그 후속을 체인에 안 남기는 경로가 존재하지 않게 된다.
 * 이게 이 티켓에서 유일하게 "무조건" 걸리는 자리다(그 근거는 위 세 줄이 전부다).
 *
 * 항목에는 그 티켓을 taskIds 로 붙인다 — 후속이 실제로 끝나 누군가 티켓을 DONE
 * 으로 넘기면 항목은 **보드 근거로** 자동으로 닫힌다. 오케 자기보고가 낄 자리가 없다.
 */
export async function captureMergeHoldFollowUp(
  db: Firestore,
  input: {
    projectId: string;
    by: string;
    taskId: string;
    taskTitle: string;
    signals: readonly string[];
    reason: string;
  },
): Promise<CaptureWorkChainResult> {
  const { projectId, by, taskId, taskTitle, signals, reason } = input;
  if (!projectId || !taskId) return EMPTY_CAPTURE;
  const what = `후속 마무리: ${taskTitle}`.slice(0, 200);
  try {
    const snap = await readWorkChain(db, projectId);
    // 같은 티켓을 이미 물고 있는 **열린** 항목이 있으면 다시 적지 않는다.
    // merge_and_close 는 재호출이 흔하다(멱등이어야 한다).
    const already = snap.items.some(
      (i) => !i.closed && i.taskIds.includes(taskId),
    );
    if (already) {
      return { ...EMPTY_CAPTURE, detected: 1, skippedDuplicate: 1 };
    }
    const res = await addWorkChainItem(db, projectId, by, {
      what,
      why:
        `merge_and_close 가 PR 머지를 확인하고도 DONE 으로 넘기지 않았다 — ` +
        `${reason} (감지 신호: ${signals.join(", ") || "없음"}). ` +
        `코드 머지 ≠ 작업 완료. 티켓 ${taskId} 가 실제로 DONE 이 되면 이 항목은 보드 근거로 닫힌다.`,
      taskIds: [taskId],
      doneWhen: "done",
      source: "auto",
      sourceTool: "merge_and_close",
    });
    if (res.error) {
      return {
        ...EMPTY_CAPTURE,
        detected: 1,
        note:
          `⚠️ 워크체인 자동 기록 실패 — ${res.error}\n` +
          `  "${what}" (티켓 ${taskId})는 아직 체인에 없습니다.`,
        error: res.error,
      };
    }
    const written = res.item ? [{ id: res.item.id, what: res.item.what }] : [];
    return {
      note: formatCaptureNote(written),
      written,
      detected: 1,
      skippedDuplicate: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[work-chain] merge-hold capture failed:", err);
    return {
      note:
        `⚠️ 워크체인 자동 기록 실패 — ${message}\n` +
        `  "${what}" 를 add_work_chain_item(what, why, task_ids=["${taskId}"]) 로 직접 적어라.`,
      written: [],
      detected: 1,
      skippedDuplicate: 0,
      error: message,
    };
  }
}
