#!/usr/bin/env node
/**
 * Firestore 결제 원장 → BigQuery `analytics_purchase` **과거분 백필**.
 * (ticket 6EnTiEzL7T2NpjOnTTSj)
 *
 * 기본은 dry-run 이며 BigQuery 에 아무것도 쓰지 않는다.
 *   GCLOUD_PROJECT=marblo-2253d npm run backfill:analytics-purchase
 *
 * 실적재는 오케/사장님 승인 후 운영자 ADC 로만 실행한다.
 *   GCLOUD_PROJECT=marblo-2253d ANALYTICS_ID_SALT=... \
 *     npm run backfill:analytics-purchase -- --apply
 *
 * 대조만 다시 보고 싶으면(적재 없이 BQ 현재 상태를 Firestore 와 맞춰본다):
 *   GCLOUD_PROJECT=marblo-2253d npm run backfill:analytics-purchase -- --verify
 *
 * ★이 스크립트는 Firestore 에 **쓰지 않는다.** 읽기 전용이다.
 * ★금액·주문번호·PG 응답 원문을 출력하지 않는다. 건수와 사유 코드만 찍는다.
 * ★멱등: 같은 인자로 두 번 돌리면 두 번째의 `affected` 가 0 이다. 그게 중복이
 *   생기지 않았다는 증거다(BigQuery MERGE 가 바꾼 행 수).
 * ★user_key 공용 HMAC 함수는 사람 축(PR #1084)이 넣었고 analyticsUserKey.ts 가
 *   그걸 이어 준다. 그 배선이 빠지면 `--apply` 가 **거부**된다 — 그 거부는 남겨
 *   둔 규율이지 미완성 표시가 아니다. 임시 해시로 메꾸지 않는다.
 */
import { BigQuery } from "@google-cloud/bigquery";
import * as admin from "firebase-admin";

import {
  ANALYTICS_PURCHASE_TABLE,
  tallyPurchaseRows,
  type PurchaseMapContext,
} from "../src/analyticsPurchase";
import { loadPurchaseRows, type BqLike } from "../src/analyticsPurchaseLoad";
import {
  buildPurchaseRows,
  readPurchaseSources,
} from "../src/analyticsPurchaseSource";
import {
  ANALYTICS_USER_KEY_BLOCKER,
  resolveAnalyticsUserKeyFn,
} from "../src/analyticsUserKey";
import { readAnalyticsIdSalt } from "../src/analyticsPseudonym";

const ARGV = process.argv.slice(2);
const has = (flag: string) => ARGV.includes(flag);
const APPLY = has("--apply");
const VERIFY_ONLY = has("--verify");
const LIMIT_RAW = ARGV.find((a) => a.startsWith("--limit="))?.slice(8);
const LIMIT = LIMIT_RAW ? Number(LIMIT_RAW) : undefined;

if (APPLY && has("--dry-run")) {
  throw new Error("--apply 와 --dry-run 은 함께 쓸 수 없다");
}
if (LIMIT_RAW && (!Number.isFinite(LIMIT) || (LIMIT as number) <= 0)) {
  throw new Error(`--limit 은 양수여야 한다: ${LIMIT_RAW}`);
}

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "marblo-2253d";
const DATASET = "marblo_telemetry";
// index.ts 의 BQ_LOCATION 과 같아야 한다 — 데이터셋이 US 에 있다.
const LOCATION = "US";

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const bigquery = new BigQuery({ projectId: PROJECT_ID, location: LOCATION });

/** BQ 쪽 현재 상태 — 대조용. 금액은 합계만(개별 값은 찍지 않는다). */
interface BqTally {
  total: number;
  byKind: Record<string, number>;
  amountKnownRows: number;
}

async function readBqTally(): Promise<BqTally | null> {
  const table = bigquery.dataset(DATASET).table(ANALYTICS_PURCHASE_TABLE);
  const [exists] = await table.exists();
  if (!exists) return null;
  const [rows] = await bigquery.query({
    query: `
      SELECT kind, COUNT(*) AS n, COUNTIF(amount_known) AS known
      FROM \`${PROJECT_ID}.${DATASET}.${ANALYTICS_PURCHASE_TABLE}\`
      GROUP BY kind
      ORDER BY kind
    `,
    location: LOCATION,
  });
  const tally: BqTally = { total: 0, byKind: {}, amountKnownRows: 0 };
  for (const r of rows as { kind: string; n: number; known: number }[]) {
    const n = Number(r.n);
    tally.byKind[r.kind] = n;
    tally.total += n;
    tally.amountKnownRows += Number(r.known);
  }
  return tally;
}

function printTally(label: string, tally: BqTally | null): void {
  if (!tally) {
    console.log(`${label}: 테이블 없음`);
    return;
  }
  const kinds = Object.entries(tally.byKind)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  console.log(
    `${label}: total=${tally.total} ${kinds} amount_known=${tally.amountKnownRows}`
  );
}

async function main(): Promise<void> {
  const salt = readAnalyticsIdSalt();
  const deriveUserKey = resolveAnalyticsUserKeyFn();

  if (VERIFY_ONLY) {
    printTally("BigQuery analytics_purchase", await readBqTally());
    const sources = await readPurchaseSources(db, { limit: LIMIT });
    console.log(
      `Firestore 원본 문서수: billingCharges=${sources.counts.charges} ` +
        `lecturePurchases=${sources.counts.lectures} ` +
        `subscriptions=${sources.counts.subscriptions}`
    );
    return;
  }

  // ★내부(운영자) 계정 축 — 사람이 아니라 성격으로 가른다. 원시 uid 는 여기서
  //   가명키로 바뀌고 그 뒤로는 어디에도 안 나간다(로그·행 포함).
  //   못 구하면 null 을 넘겨 "판정 불가" 를 그대로 남긴다 — 빈 Set 으로 접으면
  //   모든 행이 external(=실매출)로 승격된다.
  const adminUid = process.env.ADMIN_UID?.trim() ?? "";
  const adminKey =
    adminUid && deriveUserKey ? deriveUserKey(adminUid) : null;
  const internalUserKeys = adminKey ? new Set([adminKey]) : null;

  const ctx: PurchaseMapContext = {
    salt,
    deriveUserKey,
    internalUserKeys,
    ingestedAt: new Date(),
  };

  console.log(
    `[analytics_purchase] mode=${APPLY ? "APPLY" : "DRY-RUN"} ` +
      `project=${PROJECT_ID} dataset=${DATASET}${
        LIMIT ? ` limit=${LIMIT}` : ""
      }`
  );

  const sources = await readPurchaseSources(db, { limit: LIMIT });
  console.log(
    `Firestore 읽음: billingCharges=${sources.counts.charges} ` +
      `lecturePurchases=${sources.counts.lectures} ` +
      `subscriptions=${sources.counts.subscriptions}`
  );

  const built = buildPurchaseRows(sources, ctx);
  const skipped = Object.entries(built.skipped)
    .map(([k, n]) => `${k}=${n}`)
    .sort()
    .join(" ");
  console.log(`매핑: rows=${built.rows.length} 스킵[${skipped || "없음"}]`);

  // ★갈라낸 결과를 건수로 찍는다. 값(금액 개별·uid)은 안 찍는다.
  const t = tallyPurchaseRows(built.rows);
  console.log(
    `갈라내기: 실매출(external)=${t.externalRevenue}원/${t.externalRevenueRows}건 ` +
      `내부(internal)=${t.internalRows}건 그랜트=${t.grantRows}건 ` +
      `미분류=${t.unclassifiedRows}건 금액미상=${t.amountUnknownRows}건`
  );
  if (!internalUserKeys) {
    console.warn(
      "★ADMIN_UID 미설정 — 내부 계정 판정을 못 했다. 전 행이 미분류(null)이고, " +
        "매출로 승격되지 않는다."
    );
  }

  // ★게이트. 여기서 멈추는 것이 정상 동작이다 — 임시 해시로 메꾸지 않는다.
  if (!deriveUserKey) {
    console.error(`\n★적재 중단: ${ANALYTICS_USER_KEY_BLOCKER}`);
    console.error(
      "  사람 축 티켓이 공용 함수를 내보내면 src/analyticsUserKey.ts 한 곳만 배선하면 된다."
    );
    process.exitCode = APPLY ? 1 : 0;
    return;
  }
  if (!salt) {
    console.error(
      "\n★적재 중단: ANALYTICS_ID_SALT 미설정 — 가명키를 만들 수 없다."
    );
    process.exitCode = APPLY ? 1 : 0;
    return;
  }

  if (!APPLY) {
    console.log(
      "\ndry-run 이므로 BigQuery 를 건드리지 않았다. --apply 로 실적재."
    );
    return;
  }

  const before = await readBqTally();
  printTally("적재 전", before);

  const outcome = await loadPurchaseRows(bigquery as unknown as BqLike, {
    projectId: PROJECT_ID,
    datasetId: DATASET,
    location: LOCATION,
    rows: built.rows,
  });
  console.log(
    `적재: table=${outcome.tableState} staged=${outcome.staged} ` +
      `배치내중복접힘=${outcome.collapsed} MERGE영향행=${outcome.affected}`
  );

  const after = await readBqTally();
  printTally("적재 후", after);
  if (before && after) {
    console.log(`증가분 = ${after.total - before.total}`);
  }
  console.log(
    "\n★멱등 확인: 같은 인자로 한 번 더 돌려라. MERGE영향행=0 이면 중복이 생기지 않은 것이다."
  );
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    // PG 응답이 섞일 수 있는 원문 대신 메시지 첫 줄만 남긴다.
    const msg = err instanceof Error ? err.message.split("\n")[0] : "unknown";
    console.error(`[analytics_purchase] 백필 실패: ${msg}`);
    process.exit(1);
  });
