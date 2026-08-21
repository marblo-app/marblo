#!/usr/bin/env node
/**
 * ★멱등 자가검증 — 실제 BigQuery 에서 "재실행해도 중복이 생기지 않는다" 를 증명한다.
 * (ticket 6EnTiEzL7T2NpjOnTTSj 완료기준 2)
 *
 *   GCLOUD_PROJECT=marblo-2253d npm run verify:analytics-purchase
 *
 * 단위테스트는 row_id 가 결정적이라는 것까지만 보장한다. 진짜 위험은 그 다음
 * 단계 — 로드 잡 + MERGE 가 실제 BigQuery 에서 의도대로 도는가 — 에 있고,
 * 그건 실물로만 확인된다(스키마 타입 수용, NUMERIC/BOOL 파싱, IS DISTINCT FROM,
 * numDmlAffectedRows).
 *
 * ★운영 테이블을 건드리지 않는다. `analytics_purchase_selftest*` 라는 별도
 *   테이블 쌍을 만들어 쓰고 **끝나면 지운다.** 운영 결제 데이터도 읽지 않는다
 *   (Firestore 에 접속조차 하지 않고 합성 행만 쓴다).
 * ★합성 행이라 금액·주문번호는 전부 가짜다 — 실제 결제 값이 로그에 찍히지 않는다.
 *
 * 검증 순서:
 *   1. 3행 적재  → 행수 3, MERGE 영향행 3
 *   2. 같은 3행 재적재 → 행수 3, MERGE 영향행 **0**  ← 멱등의 증거
 *   3. 1행의 금액만 바꿔 적재 → 행수 3(그대로), MERGE 영향행 1 ← 갱신은 된다
 *   4. 테이블 삭제
 */
import { BigQuery } from "@google-cloud/bigquery";

import {
  ANALYTICS_PURCHASE_TABLE,
  type PurchaseRow,
} from "../src/analyticsPurchase";
import { loadPurchaseRows, type BqLike } from "../src/analyticsPurchaseLoad";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "marblo-2253d";
const DATASET = "marblo_telemetry";
const LOCATION = "US";
const TARGET = `${ANALYTICS_PURCHASE_TABLE}_selftest`;
const STAGING = `${ANALYTICS_PURCHASE_TABLE}_selftest_staging`;

const bigquery = new BigQuery({ projectId: PROJECT_ID, location: LOCATION });

/** 합성 행 — 실제 결제 데이터가 아니다. */
function synthetic(n: number, amount: number): PurchaseRow {
  return {
    row_id: `pu_selftest${String(n).padStart(16, "0")}`,
    user_key: `uk_selftest_${n}`,
    event_at: `2026-0${n}-01T00:00:00.000Z`,
    kind: n === 3 ? "refund" : "paid",
    plan: "pro",
    amount: n === 3 ? null : amount,
    amount_known: n !== 3,
    currency: n === 3 ? null : "KRW",
    provider: "portone",
    order_id: n === 3 ? null : `od_selftest${n}`,
    reason: n === 3 ? "pg_cancel" : "first",
    account_class: "external",
    source: "selftest",
    ingested_at: new Date().toISOString(),
  };
}

async function countRows(): Promise<number> {
  const [rows] = await bigquery.query({
    query: `SELECT COUNT(*) AS n FROM \`${PROJECT_ID}.${DATASET}.${TARGET}\``,
    location: LOCATION,
  });
  return Number((rows as { n: number }[])[0]?.n ?? 0);
}

async function run(
  label: string,
  rows: PurchaseRow[]
): Promise<{ affected: number; total: number }> {
  const outcome = await loadPurchaseRows(bigquery as unknown as BqLike, {
    projectId: PROJECT_ID,
    datasetId: DATASET,
    location: LOCATION,
    rows,
    targetTable: TARGET,
    stagingTable: STAGING,
  });
  const total = await countRows();
  console.log(
    `${label}: table=${outcome.tableState} staged=${outcome.staged} ` +
      `MERGE영향행=${outcome.affected} 테이블행수=${total}`
  );
  return { affected: outcome.affected, total };
}

async function cleanup(): Promise<void> {
  for (const t of [TARGET, STAGING]) {
    await bigquery
      .dataset(DATASET)
      .table(t)
      .delete({ ignoreNotFound: true } as never)
      .catch(() => undefined);
  }
  console.log(`정리 완료: ${TARGET}, ${STAGING} 삭제`);
}

async function main(): Promise<void> {
  console.log(
    `[selftest] project=${PROJECT_ID} dataset=${DATASET} target=${TARGET}`
  );
  // 이전 실행 잔재가 있으면 결과가 오염된다.
  await cleanup();

  const batch = [synthetic(1, 19000), synthetic(2, 29000), synthetic(3, 0)];

  const first = await run("1) 최초 적재", batch);
  const second = await run("2) 같은 배치 재적재", batch);
  const changed = [synthetic(1, 19000), synthetic(2, 39000), synthetic(3, 0)];
  const third = await run("3) 1행 금액 변경 후 적재", changed);

  const failures: string[] = [];
  if (first.total !== 3) failures.push(`최초 적재 행수 ${first.total} ≠ 3`);
  if (second.total !== 3)
    failures.push(`★재적재로 행이 늘었다: ${second.total} ≠ 3 (중복 적재)`);
  if (second.affected !== 0)
    failures.push(
      `★재적재가 행을 건드렸다: affected=${second.affected} ≠ 0 (멱등 아님)`
    );
  if (third.total !== 3)
    failures.push(`갱신이 행을 늘렸다: ${third.total} ≠ 3`);
  if (third.affected !== 1)
    failures.push(`갱신 반영이 안 됐다: affected=${third.affected} ≠ 1`);

  await cleanup();

  if (failures.length > 0) {
    console.error("\n❌ 멱등 검증 실패:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    "\n✅ 멱등 검증 통과 — 재실행이 행을 늘리지도, 건드리지도 않는다. 값이 바뀐 행만 갱신된다."
  );
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message.split("\n")[0] : "unknown";
  console.error(`[selftest] 실패: ${msg}`);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
