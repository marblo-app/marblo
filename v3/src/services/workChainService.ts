/**
 * 오케 워크체인 — 렌더러 Firestore 서비스 (티켓 fQtXQ2NzyYs0MRpqByTS).
 *
 * `workChains/{projectId}` 한 문서를 구독하고, 사장님이 화면에서 항목을 더하거나
 * 내리는 쓰기를 트랜잭션으로 한다. MCP 쪽(`electron/mcp-server/work-chain.ts`)과
 * 같은 문서·같은 항목 모델(`work-chain-core.ts`)을 쓰므로 오케가 적은 것과
 * 사장님이 적은 것이 한 목록이다.
 *
 * 화면은 **완료를 적지 않는다** — 완료는 보드 티켓 상태가 판정한다. 화면에서 할 수
 * 있는 쓰기는 '항목 추가' 와 '더 이상 유효하지 않음(dropped, 사유 필수)' 둘뿐이다.
 */
import {
  doc,
  onSnapshot,
  runTransaction,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { subscribeToMissions } from "./missionService";
import type { Mission } from "../types/mission";
import {
  WORK_CHAIN_COLLECTION,
  buildWorkChainItem,
  insertItem,
  newWorkChainItemId,
  normalizeWorkChainItems,
  validateNewItem,
  type NewWorkChainItemInput,
  type WorkChainItem,
} from "../lib/workChain";

export interface WorkChainSnapshot {
  projectId: string;
  items: WorkChainItem[];
  rev: number;
  /** 문서가 아직 없으면 false — 빈 체인과 구분(둘 다 items=[] 이지만 안내가 다르다). */
  exists: boolean;
}

export type WorkChainSubscribeResult =
  | { kind: "data"; snapshot: WorkChainSnapshot }
  | { kind: "error"; error: Error; reason: "permission" | "load" };

type WorkChainTestHarness = {
  subscribe: (
    projectId: string,
    callback: (result: WorkChainSubscribeResult) => void,
  ) => Unsubscribe;
};

function testHarness(): WorkChainTestHarness | null {
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  const value = (
    window as unknown as { __marbloTest?: { workChain?: unknown } }
  ).__marbloTest?.workChain;
  return value &&
    typeof (value as WorkChainTestHarness).subscribe === "function"
    ? (value as WorkChainTestHarness)
    : null;
}

function subscriptionFailureReason(error: Error): "permission" | "load" {
  const code = (error as Error & { code?: unknown }).code;
  return code === "permission-denied" ||
    code === "unauthenticated" ||
    /permission|insufficient permissions/i.test(error.message)
    ? "permission"
    : "load";
}

function combinedItems(data: {
  items?: unknown;
  archivedItems?: unknown;
}): WorkChainItem[] {
  const active = normalizeWorkChainItems(data.items);
  const archived = normalizeWorkChainItems(data.archivedItems);
  const activeIds = new Set(active.map((item) => item.id));
  return [...active, ...archived.filter((item) => !activeIds.has(item.id))];
}

/**
 * 체인 미션 소속 판정용 — implicit 라벨만 읽는다. 미션 엔진을 켜지 않는다.
 */
export function subscribeWorkChainMissions(
  projectId: string,
  callback: (missions: Mission[]) => void,
): Unsubscribe {
  return subscribeToMissions(projectId, callback);
}

/** 실시간 구독. 에러는 콜백으로 전달한다(화면이 failed 상태를 그려야 하므로 삼키지 않는다). */
export function subscribeWorkChain(
  projectId: string,
  callback: (result: WorkChainSubscribeResult) => void,
): Unsubscribe {
  // Tier-2 Electron tests seed a deterministic snapshot before the panel mounts.
  // Production and non-test launches always take the Firestore listener below.
  const harness = testHarness();
  if (harness) return harness.subscribe(projectId, callback);
  const ref = doc(db, WORK_CHAIN_COLLECTION, projectId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback({
          kind: "data",
          snapshot: { projectId, items: [], rev: 0, exists: false },
        });
        return;
      }
      const data = snap.data() as {
        items?: unknown;
        archivedItems?: unknown;
        rev?: unknown;
      };
      callback({
        kind: "data",
        snapshot: {
          projectId,
          items: combinedItems(data),
          rev: typeof data.rev === "number" ? data.rev : 0,
          exists: true,
        },
      });
    },
    (error) => {
      console.error("[workChainService] subscribe error:", error);
      callback({
        kind: "error",
        error,
        reason: subscriptionFailureReason(error),
      });
    },
  );
}

function currentActor(): string {
  return auth.currentUser?.uid ?? "";
}

async function mutateItems(
  projectId: string,
  mutate: (items: WorkChainItem[]) => WorkChainItem[] | string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const by = currentActor();
  if (!by) return { ok: false, error: "not signed in" };
  const ref = doc(db, WORK_CHAIN_COLLECTION, projectId);
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    const data = snap.exists()
      ? (snap.data() as { items?: unknown; rev?: unknown })
      : undefined;
    const items = normalizeWorkChainItems(data?.items);
    const rev = typeof data?.rev === "number" ? data.rev : 0;
    const result = mutate([...items]);
    if (typeof result === "string")
      return { ok: false as const, error: result };
    const payload = {
      projectId,
      items: result,
      rev: rev + 1,
      updatedBy: by,
      updatedAt: Timestamp.now(),
    };
    if (snap.exists()) txn.update(ref, payload);
    else txn.set(ref, { ...payload, createdAt: Timestamp.now() });
    return { ok: true as const };
  });
}

/** 사장님이 화면에서 항목을 더한다 — 오케가 다음 재열람 때 같이 본다. */
export async function addWorkChainItemFromUi(
  projectId: string,
  input: NewWorkChainItemInput,
  position?: number,
): Promise<{ ok: true; itemId: string } | { ok: false; error: string }> {
  const invalid = validateNewItem(input);
  if (invalid) return { ok: false, error: invalid };
  const id = newWorkChainItemId();
  const res = await mutateItems(projectId, (items) =>
    insertItem(
      items,
      buildWorkChainItem(input, { id, now: Date.now(), by: currentActor() }),
      position,
    ),
  );
  return res.ok ? { ok: true, itemId: id } : res;
}

/** 더 이상 유효하지 않은 항목을 내린다(dropped). 사유는 필수 — "왜 내렸는지" 가 곧 이력이다. */
export async function dropWorkChainItemFromUi(
  projectId: string,
  itemId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = reason.trim();
  if (!r) return { ok: false, error: "reason required" };
  return mutateItems(projectId, (items) => {
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx < 0) return `item ${itemId} not found`;
    const next: WorkChainItem = {
      ...items[idx],
      updatedAt: Date.now(),
      closed: {
        kind: "dropped",
        reason: r,
        at: Date.now(),
        by: currentActor(),
      },
    };
    return items.map((it, i) => (i === idx ? next : it));
  });
}

/** Remove a genuinely missing board ticket from an item's evidence in place.
 * This never marks the item complete; completion remains board-derived. */
export async function removeWorkChainEvidenceTaskFromUi(
  projectId: string,
  itemId: string,
  taskId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return mutateItems(projectId, (items) => {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) return `item ${itemId} not found`;
    const item = items[index];
    if (!item.taskIds.includes(taskId)) return `ticket ${taskId} not found`;
    const next: WorkChainItem = {
      ...item,
      taskIds: item.taskIds.filter((id) => id !== taskId),
      updatedAt: Date.now(),
    };
    return items.map((candidate, candidateIndex) =>
      candidateIndex === index ? next : candidate,
    );
  });
}
