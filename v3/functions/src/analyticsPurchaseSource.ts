/**
 * Firestore 결제 원장 → analyticsPurchase 매퍼 입력. **읽기 전용**이다.
 *
 * 이 티켓은 결제 흐름을 건드리지 않는다 — 여기서 Firestore 에 쓰는 코드는
 * 한 줄도 없어야 한다(스캔 커서도 메모리에만 둔다).
 *
 * 컬렉션 경로는 상수로 모은다. 페이지네이션은 documentId 오름차순 + startAfter
 * 로만 한다 — 복합 인덱스를 요구하지 않고, 도중에 실패해도 같은 순서로 다시
 * 읽으면 같은 집합이 나온다.
 */

import * as admin from "firebase-admin";

import {
  collect,
  mapBillingCharge,
  mapLecturePurchase,
  mapSubscriptionEvent,
  type BillingChargeSource,
  type BuildResult,
  type LecturePurchaseSource,
  type PurchaseMapContext,
  type SubscriptionSource,
} from "./analyticsPurchase";

/** 소스 컬렉션 경로(단일 진실). */
export const PURCHASE_SOURCE_COLLECTIONS = {
  charges: "billingCharges",
  lectures: "lecturePurchases",
  subscriptions: "subscriptions",
} as const;

/** 한 번에 읽는 문서 수. Firestore 페이지 한도(1MB/요청) 안쪽으로 둔다. */
const PAGE_SIZE = 500;

/**
 * Firestore Timestamp/Date/number/string → ms. 못 읽으면 null.
 * index.ts 의 동명 헬퍼와 같은 규약(그쪽은 private 이라 재사용할 수 없다).
 */
export function tsToMillis(x: unknown): number | null {
  if (x instanceof admin.firestore.Timestamp) return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const t = new Date(x).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** documentId 순으로 컬렉션 전체를 훑는다(읽기 전용). */
async function scanCollection(
  db: admin.firestore.Firestore,
  collectionId: string,
  onDoc: (doc: admin.firestore.QueryDocumentSnapshot) => void,
  limit?: number
): Promise<number> {
  let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
  let seen = 0;
  for (;;) {
    let q: admin.firestore.Query = db
      .collection(collectionId)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      onDoc(doc);
      seen++;
      if (limit && seen >= limit) return seen;
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  return seen;
}

/** 소스별 원본 문서 수 — 백필 대조("Firestore 와 건수가 맞나")의 기준값. */
export interface SourceCounts {
  charges: number;
  lectures: number;
  subscriptions: number;
}

export interface PurchaseSources {
  charges: BillingChargeSource[];
  lectures: LecturePurchaseSource[];
  subscriptions: SubscriptionSource[];
  counts: SourceCounts;
}

/**
 * 세 소스를 전부 읽어 정규화한다.
 *
 * ★값을 여기서 검증하지 않는다 — 버리는 판단은 전부 순수 매퍼가 하고 사유를
 * 세어 돌려준다. 여기서 조용히 필터하면 "왜 건수가 안 맞지" 를 추적할 수 없다.
 */
export async function readPurchaseSources(
  db: admin.firestore.Firestore,
  opts: { limit?: number } = {}
): Promise<PurchaseSources> {
  const charges: BillingChargeSource[] = [];
  const lectures: LecturePurchaseSource[] = [];
  const subscriptions: SubscriptionSource[] = [];

  const counts: SourceCounts = {
    charges: await scanCollection(
      db,
      PURCHASE_SOURCE_COLLECTIONS.charges,
      (doc) => {
        const d = doc.data();
        charges.push({
          docId: doc.id,
          userId: d.userId,
          status: d.status,
          reason: d.reason,
          amount: d.amount,
          planType: d.planType,
          provider: d.provider,
          orderId: d.orderId,
          paymentId: d.paymentId,
          createdAtMs: tsToMillis(d.createdAt),
          updatedAtMs: tsToMillis(d.updatedAt),
        });
      },
      opts.limit
    ),
    lectures: await scanCollection(
      db,
      PURCHASE_SOURCE_COLLECTIONS.lectures,
      (doc) => {
        const d = doc.data();
        lectures.push({
          docId: doc.id,
          userId: d.userId,
          lectureSlug: d.lectureSlug,
          amount: d.amount,
          orderId: d.orderId,
          provider: d.provider,
          purchasedAtMs: tsToMillis(d.purchasedAt),
        });
      },
      opts.limit
    ),
    subscriptions: await scanCollection(
      db,
      PURCHASE_SOURCE_COLLECTIONS.subscriptions,
      (doc) => {
        const d = doc.data();
        subscriptions.push({
          docId: doc.id,
          // 구독 문서 ID 가 uid 지만, userId 필드가 있으면 그쪽을 우선한다.
          userId: typeof d.userId === "string" ? d.userId : doc.id,
          status: d.status,
          planType: d.planType,
          paymentProvider: d.paymentProvider,
          founderGrant: d.founderGrant,
          billingFailedCount: d.billingFailedCount,
          createdAtMs: tsToMillis(d.createdAt),
          canceledAtMs: tsToMillis(d.canceledAt),
          updatedAtMs: tsToMillis(d.updatedAt),
        });
      },
      opts.limit
    ),
  };

  return { charges, lectures, subscriptions, counts };
}

/** 정규화된 소스 → BigQuery 행 + 스킵 사유 집계. */
export function buildPurchaseRows(
  sources: PurchaseSources,
  ctx: PurchaseMapContext
): BuildResult {
  const out = collect(sources.charges.map((c) => mapBillingCharge(c, ctx)));
  collect(
    sources.lectures.map((l) => mapLecturePurchase(l, ctx)),
    out
  );
  collect(
    sources.subscriptions.map((s) => mapSubscriptionEvent(s, ctx)),
    out
  );
  return out;
}
