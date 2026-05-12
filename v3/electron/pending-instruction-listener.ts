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
      where("isDelivered", "==", false)
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
          err
        );
      }
    );

    this.unsubscribers.set(agentId, unsub);
    console.log(
      `[PendingInstructionListener] attached agent=${agentId} pty=${ptySessionId}`
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
    ptySessionId: string
  ): Promise<void> {
    const ref = docSnap.ref;
    let message = "";
    let won = false;

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
        err
      );
      return;
    }

    if (!won) return;

    if (!message) {
      console.warn(
        `[PendingInstructionListener] empty message for ${ref.id} — skip PTY inject`
      );
      return;
    }

    try {
      this.ptyManager.writeAndSubmit(ptySessionId, message);
      console.log(
        `[PendingInstructionListener] injected to pty=${ptySessionId}: ${message.slice(
          0,
          80
        )}`
      );
    } catch (err) {
      // PTY injection failed AFTER we already marked delivered. Don't
      // revert: reverting would let a subsequent snapshot tick re-attempt
      // injection on a possibly-different PTY. Log loudly so an operator
      // can re-issue the instruction manually.
      console.error(
        `[PendingInstructionListener] PTY inject failed for ${ref.id} (already marked delivered):`,
        err
      );
    }
  }
}
