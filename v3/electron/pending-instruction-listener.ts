import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  runTransaction,
  Timestamp,
  type Firestore,
  type Unsubscribe,
  type DocumentSnapshot,
} from "firebase/firestore";
import { PtyManager } from "./pty-manager";

const NAMED_APP = "pending-instruction-listener";

/**
 * 프로세스 수명 동안 같은 지시 doc 을 두 번 PTY 로 주입하지 않게 하는 in-process
 * 멱등 가드. 처음 보는 `id` 면 기록하고 true(=이번에 전달), 이후 호출엔 false.
 *
 * 왜 필요한가: 에이전트가 재시작되면 setAgentSpawnedHook 이 detach→attach 를
 * 다시 부르고, 새 onSnapshot 의 "초기 스냅샷"은 현재 매칭되는(isDelivered==false)
 * 모든 doc 을 type:"added" 로 한꺼번에 재방출한다. Firestore 의 latency
 * compensation 이 같은 앱 인스턴스 내에선 직전 tx.update(isDelivered:true) 를
 * 로컬 캐시에 즉시 반영해 주긴 하지만 — (a) 캐시 비활성/지연, (b) 향후 두 번째
 * attach 경로/별도 Firestore 앱 추가, (c) 같은 스냅샷 틱 내 중복 added — 같은
 * 회귀 벡터가 생기면 "터미널 재오픈/에이전트 재시작 시 재주입"이 되살아난다.
 * Firestore 트랜잭션은 교차-프로세스 once-only 의 durable 보증이고, 이 Set 은
 * in-process re-attach 재주입 창을 닫는 belt-and-suspenders 다.
 *
 * `max` 를 넘으면 가장 오래된 id 부터 FIFO 로 비운다(장수 프로세스의 무한 증식
 * 방지). 비워진 id 는 durable 한 Firestore isDelivered 플래그가 계속 막아준다.
 */
export function claimDeliveryOnce(
  seen: Set<string>,
  id: string,
  max = 5000,
): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > max) {
    // Set 은 삽입 순서를 보존하므로 첫 값이 가장 오래된 id.
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

function getDb(): Firestore {
  const config = {
    apiKey:
      process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "",
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      "",
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      "",
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      "",
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID ||
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      "",
    appId:
      process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "",
  };
  const existing = getApps();
  const fbApp: FirebaseApp =
    existing.find((a) => a.name === NAMED_APP) ||
    initializeApp(config, NAMED_APP);
  return getFirestore(fbApp);
}

/**
 * Bridges the cross-machine `pendingInstructions` queue to the local PTY.
 *
 * Each agent hosted on this machine gets a Firestore listener for
 * `where targetAgentId == agentId AND isDelivered == false`. When a new
 * undelivered doc appears, the listener atomically flips `isDelivered` to
 * true via a transaction and — only if the flip won the race — writes the
 * message to the agent's PTY stdin.
 *
 * The transaction is what makes this safe across machines: if two marblo
 * instances ever ended up subscribed to the same `targetAgentId`, only
 * the first transaction commits and only that listener injects into PTY.
 * Subsequent listeners observe `isDelivered == true` and skip.
 */
export class PendingInstructionListener {
  private db: Firestore;
  private unsubscribers: Map<string, Unsubscribe> = new Map();
  private ptyManager: PtyManager;
  // 프로세스 수명 멱등 가드 — 이미 PTY 로 주입한 지시 doc id 집합. re-attach
  // (에이전트 재시작) 초기 스냅샷이 같은 doc 을 다시 added 로 올려도 재주입 0.
  private deliveredDocIds: Set<string> = new Set();

  constructor(ptyManager: PtyManager) {
    this.db = getDb();
    this.ptyManager = ptyManager;
  }

  /**
   * Subscribe for pending instructions targeting `agentId`, injecting any
   * undelivered ones into `ptySessionId`. Idempotent: calling twice for
   * the same `agentId` is a no-op.
   */
  attach(agentId: string, ptySessionId: string): void {
    if (this.unsubscribers.has(agentId)) return;

    const q = query(
      collection(this.db, "pendingInstructions"),
      where("targetAgentId", "==", agentId),
      where("isDelivered", "==", false),
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        // Only react to newly added docs. Firestore re-delivers the full
        // matched set on each tick, so without this filter we'd reprocess
        // the same row repeatedly within a single attach lifetime. The
        // transaction handles cross-listener races; this filter handles
        // same-listener idempotency.
        const added = snap.docChanges().filter((c) => c.type === "added");
        added.sort((a, b) => {
          const at =
            (a.doc.data().createdAt as Timestamp | undefined)?.toMillis?.() ??
            0;
          const bt =
            (b.doc.data().createdAt as Timestamp | undefined)?.toMillis?.() ??
            0;
          return at - bt;
        });
        for (const change of added) {
          await this.deliver(change.doc, ptySessionId);
        }
      },
      (err) => {
        console.warn(
          `[PendingInstructionListener] subscribe error for agent ${agentId}:`,
          err,
        );
      },
    );

    this.unsubscribers.set(agentId, unsub);
    console.log(
      `[PendingInstructionListener] attached agent=${agentId} pty=${ptySessionId}`,
    );
  }

  /** Stop the listener for `agentId`. Safe to call when not attached. */
  detach(agentId: string): void {
    const unsub = this.unsubscribers.get(agentId);
    if (!unsub) return;
    unsub();
    this.unsubscribers.delete(agentId);
    console.log(`[PendingInstructionListener] detached agent=${agentId}`);
  }

  /** Detach all listeners. Called on app shutdown. */
  detachAll(): void {
    for (const [agentId, unsub] of this.unsubscribers) {
      unsub();
      console.log(`[PendingInstructionListener] detached agent=${agentId}`);
    }
    this.unsubscribers.clear();
  }

  private async deliver(
    docSnap: DocumentSnapshot,
    ptySessionId: string,
  ): Promise<void> {
    const ref = docSnap.ref;
    let message = "";
    let won = false;

    // In-process 멱등: 이번 프로세스에서 이미 주입한 doc 이면 즉시 중단(재주입 0).
    // durable 보증은 아래 트랜잭션의 isDelivered 플래그가, in-process re-attach
    // 재주입 창은 이 가드가 막는다. claimDeliveryOnce 는 "처음 본 것"일 때만 true.
    if (this.deliveredDocIds.has(ref.id)) return;

    try {
      won = await runTransaction(this.db, async (tx) => {
        const cur = await tx.get(ref);
        if (!cur.exists()) return false;
        const data = cur.data();
        if (!data || data.isDelivered) return false;
        message = String(data.message ?? "");
        tx.update(ref, {
          isDelivered: true,
          deliveredAt: Timestamp.now(),
        });
        return true;
      });
    } catch (err) {
      console.warn(
        `[PendingInstructionListener] delivery txn failed for ${ref.id}:`,
        err,
      );
      return;
    }

    if (!won) return;

    // 트랜잭션을 우리가 이겼다 = 우리가 전달 책임자. in-process 가드에 기록해
    // re-attach 초기 스냅샷이 같은 doc 을 다시 올려도 두 번 주입하지 않는다.
    // (트랜잭션 실패/미승리 시엔 기록하지 않아 정당한 재시도를 막지 않는다.)
    claimDeliveryOnce(this.deliveredDocIds, ref.id);

    if (!message) {
      console.warn(
        `[PendingInstructionListener] empty message for ${ref.id} — skip PTY inject`,
      );
      return;
    }

    try {
      this.ptyManager.writeAndSubmit(ptySessionId, message);
      console.log(
        `[PendingInstructionListener] injected to pty=${ptySessionId}: ${message.slice(
          0,
          80,
        )}`,
      );
    } catch (err) {
      // PTY injection failed AFTER we already marked delivered. Don't
      // revert: reverting would let a subsequent snapshot tick re-attempt
      // injection on a possibly-different PTY. Log loudly so an operator
      // can re-issue the instruction manually.
      console.error(
        `[PendingInstructionListener] PTY inject failed for ${ref.id} (already marked delivered):`,
        err,
      );
    }
  }
}
