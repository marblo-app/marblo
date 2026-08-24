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
import {
  InstructionDeliveryQueue,
  type InstructionDeliveryFailure,
  type InstructionDeliverySuccess,
} from "./instruction-delivery-queue";

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
export interface PendingInstructionListenerHooks {
  /**
   * ★전달 실패 싱크. 트랜잭션에서 이미 delivered 로 마킹된 지시가 끝내 PTY 에
   * 못 들어갔을 때 호출된다. 배선하는 쪽(main.ts)이 오케에 알려 사람이 개입할
   * 수 있게 한다 — 조용히 사라지는 경로를 남기지 않기 위한 마지막 관문.
   */
  onDeliveryFailure?: (failure: InstructionDeliveryFailure) => void;
  /** 전달 성공 훅(관측용). */
  onDelivered?: (result: InstructionDeliverySuccess) => void;
}

export class PendingInstructionListener {
  private db: Firestore;
  private unsubscribers: Map<string, Unsubscribe> = new Map();
  private ptyManager: PtyManager;
  // 프로세스 수명 멱등 가드 — 이미 PTY 로 주입한 지시 doc id 집합. re-attach
  // (에이전트 재시작) 초기 스냅샷이 같은 doc 을 다시 added 로 올려도 재주입 0.
  private deliveredDocIds: Set<string> = new Set();
  // agentId → 현재 붙어 있는 PTY 세션. attach 때 갱신되며, 재시도는 캡처된
  // sid 가 아니라 이 맵을 다시 읽는다(전달 대기 중 PTY 가 바뀌어도 따라가게).
  private ptyByAgent: Map<string, string> = new Map();
  private queue: InstructionDeliveryQueue;
  /** `PtyManager.onComposerFree` 구독 해제. */
  private unsubscribeComposerFree: () => void;

  constructor(
    ptyManager: PtyManager,
    hooks: PendingInstructionListenerHooks = {},
  ) {
    this.db = getDb();
    this.ptyManager = ptyManager;
    this.queue = new InstructionDeliveryQueue({
      writer: {
        writeAndSubmit: (sessionId, text) =>
          this.ptyManager.writeAndSubmit(sessionId, text),
        // ★쓰기 전에 컴포저를 본다(티켓 RtyOMpOArfI7a5JNSzsg). writeAndSubmit
        // 안에도 같은 게이트가 있지만, 여기서 먼저 물어야 "실패" 와 "일부러 안
        // 씀(보류)" 을 갈라 사유를 발신자에게 정확히 돌려줄 수 있다.
        composerVerdict: (sessionId) =>
          this.ptyManager.composerVerdict(sessionId),
      },
      resolvePty: (agentId) => this.ptyByAgent.get(agentId),
      onDelivered: hooks.onDelivered,
      onFailure: hooks.onDeliveryFailure,
    });

    // ★재시도 정책의 심장: 컴포저가 **풀리는 순간** 보류분을 흘려보낸다.
    // 폴링도, 타이머도, 사람의 개입도 없다 — 초안의 주인이 자기 손으로 엔터를
    // 치거나 다이얼로그를 닫는 그때가 재시도 시각이다.
    this.unsubscribeComposerFree = this.ptyManager.onComposerFree(
      (sessionId) => {
        for (const [agentId, sid] of this.ptyByAgent) {
          if (sid !== sessionId) continue;
          if (this.queue.pendingCount(agentId) === 0) continue;
          void this.queue.flush(agentId).catch((err) => {
            console.error(
              `[PendingInstructionListener] composer-free flush failed for ${agentId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        }
      },
    );
  }

  /** 미전달로 남아 있는 지시 수 — 진단/테스트용. */
  undeliveredCount(agentId?: string): number {
    return this.queue.pendingCount(agentId);
  }

  /**
   * Subscribe for pending instructions targeting `agentId`, injecting any
   * undelivered ones into `ptySessionId`. Idempotent: calling twice for
   * the same `agentId` is a no-op.
   */
  attach(agentId: string, ptySessionId: string): void {
    // PTY 맵은 구독 여부와 무관하게 항상 최신으로 — 재시도가 이 값을 읽는다.
    this.ptyByAgent.set(agentId, ptySessionId);
    // 직전 라운드에서 주입에 실패해 메모리에 남은 지시를 새 PTY 로 재주입한다.
    // (에이전트 재시작 창에 도착한 답변이 살아 돌아오는 경로.)
    void this.queue.flush(agentId);

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
          await this.deliver(change.doc, agentId);
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
    // PTY 매핑은 항상 지운다 — 죽은 세션 id 로 재시도해 봐야 유실만 확정된다.
    // 미전달 버퍼는 남긴다: 에이전트가 다시 뜨면(attach) 그때 재주입한다.
    this.ptyByAgent.delete(agentId);
    const unsub = this.unsubscribers.get(agentId);
    if (!unsub) return;
    unsub();
    this.unsubscribers.delete(agentId);
    const undelivered = this.queue.pendingCount(agentId);
    console.log(
      `[PendingInstructionListener] detached agent=${agentId}` +
        (undelivered > 0 ? ` (undelivered kept: ${undelivered})` : ""),
    );
  }

  /** Detach all listeners. Called on app shutdown. */
  detachAll(): void {
    for (const [agentId, unsub] of this.unsubscribers) {
      unsub();
      console.log(`[PendingInstructionListener] detached agent=${agentId}`);
    }
    this.unsubscribers.clear();
    this.ptyByAgent.clear();
    this.unsubscribeComposerFree();
    // 앱 종료 시점에 남은 미전달분은 프로세스와 함께 사라진다 — 조용히 지나가지
    // 않도록 마지막으로 원문째 남긴다(수동 복구 근거).
    const stranded = this.queue.pendingSummary();
    for (const s of stranded) {
      console.error(
        `[PendingInstructionListener] shutdown with UNDELIVERED instruction doc=${s.docId} agent=${s.agentId} attempts=${s.attempts}: ${s.message}`,
      );
    }
  }

  private async deliver(
    docSnap: DocumentSnapshot,
    agentId: string,
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

    // ★P5-2: 여기가 답변 유실의 진범이었다. writeAndSubmit 은 실패를 throw 가
    // 아니라 `false` 로 알린다(세션 없음 / 위험명령 차단 / CR 미등록) — 예전
    // 코드는 반환값을 안 보고 try/catch 만 둬서 catch 가 영원히 안 걸렸고,
    // 원장엔 delivered, 로그엔 "injected", 실제 답변은 증발했다.
    // 이제는 결과를 await 해 판정하고, 실패하면 큐가 (a) 현재 PTY 를 다시
    // 해석해 재시도하고 (b) 그래도 안 되면 메모리에 보관해 다음 attach 때
    // 재주입하며 (c) 예산을 소진하면 onDeliveryFailure 로 명시 보고한다.
    // Firestore 로 되돌리는(isDelivered=false) 재큐잉은 보안룰이 막고 있어
    // (false→true 단방향 1회) 재시도 상태는 프로세스 안에서 산다.
    const delivered = await this.queue.deliver(agentId, ref.id, message);
    if (delivered) {
      console.log(
        `[PendingInstructionListener] injected agent=${agentId}: ${message.slice(
          0,
          80,
        )}`,
      );
    }
  }
}
