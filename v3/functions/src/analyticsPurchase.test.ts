// analytics_purchase 순수 로직 단위테스트 (analyticsPseudonym.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:analytics-purchase
//
// ★이 파일이 지키는 것 세 가지 — 티켓 6EnTiEzL7T2NpjOnTTSj 의 ★ 세 조항:
//   1. user_key 는 **주입된 공용 HMAC 함수**로만 만들어진다. 주입이 없으면
//      행이 나오지 않는다(임시 해시로 메꾸는 변경을 빨갛게 만든다).
//   2. 재실행이 중복을 만들지 않는다 — 같은 입력은 같은 row_id.
//   3. 결제 데이터가 새지 않는다 — 원시 uid·주문번호·PG 응답 원문이 행 어디에도
//      없다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ANALYTICS_PURCHASE_COLUMNS,
  ANALYTICS_PURCHASE_SCHEMA,
  CANCEL_BILLING_FAILURE_THRESHOLD,
  REJECTED_FIELDS,
  classifyCharge,
  classifySubscriptionEvent,
  collect,
  dedupeRows,
  mapBillingCharge,
  mapLecturePurchase,
  mapSubscriptionEvent,
  pseudonymizeOrderId,
  purchaseRowId,
  toNdjson,
  type BillingChargeSource,
  type LecturePurchaseSource,
  type PurchaseMapContext,
  type PurchaseRow,
  type SubscriptionSource,
} from "./analyticsPurchase";
import { MAX_BILLING_RETRIES } from "./billing";
import { buildMergeSql } from "./analyticsPurchaseLoad";

const SALT = "test-salt-not-a-real-secret";
const RAW_UID = "firebase-uid-abc123";
const RAW_ORDER = "sub_first_firebase-uid-abc123_pro_monthly";

/**
 * 공용 HMAC 함수 **자리**. 테스트에서는 결정적인 가짜를 넣는다 — 실제 구현은
 * 사람 축(PR #1084)이 한 벌만 내보내고(analyticsPseudonym 의 `user` kind),
 * 이 모듈은 analyticsUserKey.ts 를 거쳐 그걸 주입받기만 한다.
 * ★가짜를 쓰는 이유: 이 파일이 재는 것은 매핑 규칙이지 키의 값이 아니다.
 *   실제 배선이 공용 함수와 같은 값을 내는지는 analyticsUserKey.test.ts 가 잰다.
 */
const fakeUserKey = (uid: string): string =>
  `uk_${uid.length}_${uid.slice(-3)}`;

const CTX: PurchaseMapContext = {
  salt: SALT,
  deriveUserKey: fakeUserKey,
  ingestedAt: new Date("2026-08-21T00:00:00.000Z"),
};

const CHARGE: BillingChargeSource = {
  docId: `${RAW_UID}_1750000000000`,
  userId: RAW_UID,
  status: "succeeded",
  reason: "renewal",
  amount: 19000,
  planType: "pro",
  provider: undefined,
  orderId: RAW_ORDER,
  paymentId: undefined,
  createdAtMs: Date.parse("2026-07-01T04:30:00.000Z"),
  updatedAtMs: Date.parse("2026-07-01T04:30:05.000Z"),
};

function okRow(result: ReturnType<typeof mapBillingCharge>): PurchaseRow {
  assert.equal(result.ok, true, `매핑이 실패했다: ${JSON.stringify(result)}`);
  return (result as { ok: true; row: PurchaseRow }).row;
}

// ─── ★1. user_key 는 공용 함수로만 ──────────────────────────────────────────

test("★공용 HMAC 함수가 주입되지 않으면 행을 만들지 않는다(임시 해시 금지)", () => {
  const r = mapBillingCharge(CHARGE, { ...CTX, deriveUserKey: null });
  assert.equal(r.ok, false);
  assert.equal((r as { ok: false; reason: string }).reason, "no_user_key");
});

test("★공용 함수가 키를 못 만들면(빈 문자열/null) 행을 만들지 않는다", () => {
  for (const bad of [null, ""]) {
    const r = mapBillingCharge(CHARGE, {
      ...CTX,
      deriveUserKey: () => bad as string | null,
    });
    assert.equal(r.ok, false);
    assert.equal((r as { ok: false; reason: string }).reason, "no_user_key");
  }
});

test("user_key 는 주입된 함수의 결과 그대로다 — 이 모듈이 다시 해싱하지 않는다", () => {
  const row = okRow(mapBillingCharge(CHARGE, CTX));
  assert.equal(row.user_key, fakeUserKey(RAW_UID));
});

test("솔트가 없으면(fail-safe) 행을 만들지 않는다 — 원시값 폴백 없음", () => {
  const r = mapBillingCharge(CHARGE, { ...CTX, salt: null });
  assert.equal(r.ok, false);
  assert.equal((r as { ok: false; reason: string }).reason, "no_salt");
});

// ─── ★2. 멱등 ──────────────────────────────────────────────────────────────

test("★같은 소스 문서는 몇 번을 매핑해도 같은 row_id 다(재실행 중복 방지의 뿌리)", () => {
  const a = okRow(mapBillingCharge(CHARGE, CTX));
  const b = okRow(
    mapBillingCharge(CHARGE, { ...CTX, ingestedAt: new Date("2026-09-01") })
  );
  assert.equal(a.row_id, b.row_id, "적재 시각이 row_id 에 새어들었다");
});

test("★청구가 실패→성공으로 바뀌어도 row_id 가 같다(행이 둘로 늘지 않는다)", () => {
  const failed = mapBillingCharge({ ...CHARGE, status: "failed" }, CTX);
  assert.equal(failed.ok, false, "실패한 청구가 매출로 적재됐다");
  const succeeded = okRow(mapBillingCharge(CHARGE, CTX));
  const again = okRow(
    mapBillingCharge(
      { ...CHARGE, updatedAtMs: CHARGE.updatedAtMs! + 5000 },
      CTX
    )
  );
  assert.equal(succeeded.row_id, again.row_id);
});

test("★해지 행의 row_id 에 시각이 들어가지 않는다 — updatedAt 이 흔들려도 한 줄", () => {
  const sub: SubscriptionSource = {
    docId: RAW_UID,
    userId: RAW_UID,
    status: "canceled",
    planType: "pro",
    paymentProvider: "toss",
    founderGrant: false,
    billingFailedCount: 0,
    canceledAtMs: Date.parse("2026-07-10T00:00:00.000Z"),
    updatedAtMs: Date.parse("2026-07-10T00:00:01.000Z"),
  };
  const a = okRow(mapSubscriptionEvent(sub, CTX));
  const b = okRow(
    mapSubscriptionEvent(
      { ...sub, updatedAtMs: Date.parse("2026-08-01T00:00:00.000Z") },
      CTX
    )
  );
  assert.equal(a.row_id, b.row_id);
});

test("서로 다른 소스 문서는 서로 다른 row_id 다", () => {
  const a = okRow(mapBillingCharge(CHARGE, CTX));
  const b = okRow(
    mapBillingCharge({ ...CHARGE, docId: `${RAW_UID}_1760000000000` }, CTX)
  );
  assert.notEqual(a.row_id, b.row_id);
});

test("★한 배치에 같은 row_id 가 둘이면 접힌다(MERGE 가 통째로 실패하는 걸 막는다)", () => {
  const row = okRow(mapBillingCharge(CHARGE, CTX));
  const deduped = dedupeRows([row, { ...row, amount: 29000 }]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].amount, 29000, "마지막 값이 이겨야 한다");
});

test("★MERGE SQL 은 row_id 로 매치하고 값이 달라졌을 때만 UPDATE 한다", () => {
  const sql = buildMergeSql("marblo-2253d", "marblo_telemetry");
  assert.match(sql, /ON T\.row_id = S\.row_id/);
  assert.match(sql, /WHEN NOT MATCHED THEN/);
  // NULL 안전 비교 — `!=` 만 쓰면 NULL 이 낀 갱신이 영영 반영되지 않는다.
  assert.match(sql, /IS DISTINCT FROM/);
  assert.equal(
    sql.includes("T.ingested_at IS DISTINCT FROM S.ingested_at"),
    false,
    "ingested_at 이 비교에 들어가면 no-op 재실행도 항상 UPDATE 가 된다"
  );
  // DELETE 절이 없어야 한다 — 배치에 없는 과거 행을 지우면 매출이 사라진다.
  assert.equal(sql.includes("DELETE"), false);
  for (const col of ANALYTICS_PURCHASE_COLUMNS) {
    assert.ok(sql.includes(`S.${col}`), `${col} 이 MERGE 에서 빠졌다`);
  }
});

// ─── ★3. 결제 데이터가 새지 않는다 ──────────────────────────────────────────

test("★행 어디에도 원시 uid·주문번호가 남지 않는다", () => {
  const rows = [
    okRow(mapBillingCharge(CHARGE, CTX)),
    okRow(
      mapBillingCharge(
        {
          ...CHARGE,
          provider: "portone",
          paymentId: "mb_s_" + RAW_UID,
          orderId: undefined,
        },
        CTX
      )
    ),
  ];
  const serialized = JSON.stringify(rows);
  for (const secret of [RAW_UID, RAW_ORDER]) {
    assert.equal(
      serialized.includes(secret),
      false,
      `원시값 ${secret} 이 행에 남아 있다`
    );
  }
});

test("★스키마에 결제 원문·직접 식별자 컬럼이 없다", () => {
  const names = new Set(ANALYTICS_PURCHASE_COLUMNS);
  for (const field of REJECTED_FIELDS) {
    assert.equal(
      names.has(field),
      false,
      `${field} 가 스키마에 들어왔다 — 결제 원문/식별자는 웨어하우스에 두지 않는다`
    );
  }
});

test("order_id 는 가명(od_ 접두)이고, 같은 주문번호는 같은 가명이다", () => {
  const a = pseudonymizeOrderId(RAW_ORDER, SALT);
  const b = pseudonymizeOrderId(RAW_ORDER, SALT);
  assert.equal(a, b);
  assert.match(String(a), /^od_[0-9a-f]{24}$/);
  assert.notEqual(pseudonymizeOrderId(RAW_ORDER, "another-salt"), a);
});

test("주문번호가 없으면 order_id 는 null(정상값) — 빈 문자열을 해싱하지 않는다", () => {
  assert.equal(pseudonymizeOrderId(null, SALT), null);
  assert.equal(pseudonymizeOrderId("", SALT), null);
  assert.equal(pseudonymizeOrderId("   ", SALT), null);
});

test("row_id 는 pu_ 가명이고 솔트가 없으면 null", () => {
  assert.match(
    String(purchaseRowId("billingCharges/x", SALT)),
    /^pu_[0-9a-f]{24}$/
  );
  assert.equal(purchaseRowId("billingCharges/x", null), null);
});

// ─── kind 분류 ──────────────────────────────────────────────────────────────

test("청구 원장 → kind: first=paid / renewal=renew / manual=paid / one_time=paid", () => {
  assert.deepEqual(classifyCharge("succeeded", "first"), {
    kind: "paid",
    reason: "first",
  });
  assert.deepEqual(classifyCharge("succeeded", "renewal"), {
    kind: "renew",
    reason: "renewal",
  });
  assert.deepEqual(classifyCharge("succeeded", "manual"), {
    kind: "paid",
    reason: "manual",
  });
  assert.deepEqual(classifyCharge("succeeded", "one_time"), {
    kind: "paid",
    reason: "one_time",
  });
});

test("reason 이 없는 레거시 청구는 첫 결제로 읽는다(renewal 은 항상 명시돼 있다)", () => {
  assert.deepEqual(classifyCharge("succeeded", undefined), {
    kind: "paid",
    reason: "first",
  });
});

test("comped(쿠폰 전액할인)는 trial 이고 금액은 '아는 0' 이다", () => {
  const row = okRow(
    mapBillingCharge(
      { ...CHARGE, status: "comped", reason: "first", amount: 0 },
      CTX
    )
  );
  assert.equal(row.kind, "trial");
  assert.equal(row.amount, 0);
  assert.equal(
    row.amount_known,
    true,
    "실제로 0원이 청구된 건은 미상이 아니다"
  );
});

test("★pending/failed 청구는 매출로 적재되지 않는다", () => {
  for (const st of ["pending", "failed", "", null, undefined]) {
    assert.equal(classifyCharge(st, "first"), null);
    const r = mapBillingCharge({ ...CHARGE, status: st }, CTX);
    assert.equal(r.ok, false);
    assert.equal((r as { ok: false; reason: string }).reason, "not_revenue");
  }
});

test("PortOne 청구는 paymentId 를, 토스 청구는 orderId 를 주문번호로 쓴다", () => {
  const toss = okRow(mapBillingCharge(CHARGE, CTX));
  assert.equal(toss.provider, "toss");
  assert.equal(toss.order_id, pseudonymizeOrderId(RAW_ORDER, SALT));

  const portone = okRow(
    mapBillingCharge(
      { ...CHARGE, provider: "portone", paymentId: "mb_s_x1", orderId: null },
      CTX
    )
  );
  assert.equal(portone.provider, "portone");
  assert.equal(portone.order_id, pseudonymizeOrderId("mb_s_x1", SALT));
});

test("event_at 은 상태 확정 시각(updatedAt) 우선, 없으면 createdAt", () => {
  const withUpdated = okRow(mapBillingCharge(CHARGE, CTX));
  assert.equal(
    withUpdated.event_at,
    new Date(CHARGE.updatedAtMs!).toISOString()
  );
  const noUpdated = okRow(
    mapBillingCharge({ ...CHARGE, updatedAtMs: null }, CTX)
  );
  assert.equal(noUpdated.event_at, new Date(CHARGE.createdAtMs!).toISOString());
  const noTime = mapBillingCharge(
    { ...CHARGE, updatedAtMs: null, createdAtMs: null },
    CTX
  );
  assert.equal(noTime.ok, false);
  assert.equal(
    (noTime as { ok: false; reason: string }).reason,
    "missing_timestamp"
  );
});

// ─── 강의 단건(중복 제거) ───────────────────────────────────────────────────

const LECTURE: LecturePurchaseSource = {
  docId: "auto123",
  userId: RAW_UID,
  lectureSlug: "react-basics",
  amount: 49000,
  orderId: "order_lecture_1",
  provider: undefined,
  purchasedAtMs: Date.parse("2026-06-02T09:00:00.000Z"),
};

test("토스 단건 강의결제는 적재된다 — 이 경로만 billingCharges 를 거치지 않는다", () => {
  const row = okRow(mapLecturePurchase(LECTURE, CTX));
  assert.equal(row.kind, "paid");
  assert.equal(row.reason, "one_time");
  assert.equal(row.amount, 49000);
  assert.equal(row.source, "lecturePurchases");
  assert.equal(
    row.plan,
    "lecture:react-basics",
    "강의 slug 가 구독 플랜 축을 오염시키면 안 된다"
  );
});

test("★PortOne 단건은 lecturePurchases 쪽을 버린다 — billingCharges 와 이중 계상 방지", () => {
  const r = mapLecturePurchase({ ...LECTURE, provider: "portone" }, CTX);
  assert.equal(r.ok, false);
  assert.equal(
    (r as { ok: false; reason: string }).reason,
    "duplicate_portone_lecture"
  );
});

// ─── 해지 / 환불 ────────────────────────────────────────────────────────────

const CANCELED_SUB: SubscriptionSource = {
  docId: RAW_UID,
  userId: RAW_UID,
  status: "canceled",
  planType: "pro",
  paymentProvider: "toss",
  founderGrant: false,
  billingFailedCount: 0,
  canceledAtMs: null,
  updatedAtMs: Date.parse("2026-07-20T12:00:00.000Z"),
};

test("자발 해지(canceledAt 있음) → kind=cancel, reason=user_cancel", () => {
  const cls = classifySubscriptionEvent({
    ...CANCELED_SUB,
    canceledAtMs: Date.parse("2026-07-19T00:00:00.000Z"),
  });
  assert.deepEqual(cls, {
    kind: "cancel",
    reason: "user_cancel",
    atMs: Date.parse("2026-07-19T00:00:00.000Z"),
  });
});

test("청구 3회 실패 해지 → kind=cancel, reason=billing_failure (환불이 아니다)", () => {
  const cls = classifySubscriptionEvent({
    ...CANCELED_SUB,
    planType: "free",
    billingFailedCount: CANCEL_BILLING_FAILURE_THRESHOLD,
  });
  assert.equal(cls?.kind, "cancel");
  assert.equal(cls?.reason, "billing_failure");
});

test("★PG 취소(자발도 청구실패도 아닌 planType=free) → kind=refund", () => {
  const cls = classifySubscriptionEvent({ ...CANCELED_SUB, planType: "free" });
  assert.equal(cls?.kind, "refund");
  assert.equal(cls?.reason, "pg_cancel");
});

test("★환불 행의 금액은 0 이 아니라 '미상'이다 — 순매출이 총매출처럼 보이면 안 된다", () => {
  const row = okRow(
    mapSubscriptionEvent({ ...CANCELED_SUB, planType: "free" }, CTX)
  );
  assert.equal(row.kind, "refund");
  assert.equal(row.amount, null);
  assert.equal(
    row.amount_known,
    false,
    "환불 금액을 0 으로 적으면 '환불이 없었다'로 읽힌다"
  );
});

test("해지 행에도 금액을 싣지 않는다(돈이 움직이지 않았다)", () => {
  const row = okRow(
    mapSubscriptionEvent(
      { ...CANCELED_SUB, canceledAtMs: CANCELED_SUB.updatedAtMs },
      CTX
    )
  );
  assert.equal(row.amount, null);
  assert.equal(row.amount_known, false);
});

test("PG 를 거치지 않은 구독(파운더 grant 전용)은 구매 행을 만들지 않는다", () => {
  assert.equal(
    classifySubscriptionEvent({
      ...CANCELED_SUB,
      founderGrant: true,
      paymentProvider: "founder_grant",
    }),
    null
  );
  assert.equal(
    classifySubscriptionEvent({ ...CANCELED_SUB, paymentProvider: null }),
    null
  );
});

test("★grant 플래그가 붙어 있어도 PG 를 거쳤으면 해지·환불을 잃지 않는다", () => {
  // 실측(2026-08-21): 운영 구독 34건이 전부 founderGrant=true 인데 그중 1건은
  // paymentProvider="portone" 인 실결제자다. founderGrant 만 보고 버리면 그
  // 사람의 해지/환불이 통째로 사라진다.
  const cls = classifySubscriptionEvent({
    ...CANCELED_SUB,
    founderGrant: true,
    paymentProvider: "portone",
    planType: "free",
  });
  assert.equal(cls?.kind, "refund");
});

test("활성 구독은 아무 행도 만들지 않는다(구독 소스는 해지/환불 전용)", () => {
  const r = mapSubscriptionEvent({ ...CANCELED_SUB, status: "active" }, CTX);
  assert.equal(r.ok, false);
  assert.equal((r as { ok: false; reason: string }).reason, "still_active");
});

test("해지 임계값이 billing.ts 의 MAX_BILLING_RETRIES 와 같다", () => {
  assert.equal(CANCEL_BILLING_FAILURE_THRESHOLD, MAX_BILLING_RETRIES);
});

// ─── 집계·직렬화 ────────────────────────────────────────────────────────────

test("★스킵은 사유별로 세어 돌려준다 — 조용히 버리지 않는다", () => {
  const out = collect([
    mapBillingCharge(CHARGE, CTX),
    mapBillingCharge({ ...CHARGE, status: "failed" }, CTX),
    mapBillingCharge({ ...CHARGE, status: "pending" }, CTX),
    mapBillingCharge({ ...CHARGE, userId: null }, CTX),
  ]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped.not_revenue, 2);
  assert.equal(out.skipped.missing_user, 1);
});

test("NDJSON 은 한 줄에 한 행이고 스키마 컬럼을 모두 담는다", () => {
  const row = okRow(mapBillingCharge(CHARGE, CTX));
  const lines = toNdjson([row, row]).split("\n");
  assert.equal(lines.length, 2);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  for (const col of ANALYTICS_PURCHASE_COLUMNS) {
    assert.ok(col in parsed, `${col} 이 직렬화에서 빠졌다`);
  }
  assert.equal(
    Object.keys(parsed).length,
    ANALYTICS_PURCHASE_COLUMNS.length,
    "스키마에 없는 컬럼이 직렬화에 섞였다"
  );
});

test("스키마의 REQUIRED 컬럼은 매핑 결과에서 절대 null 이 아니다", () => {
  const required = ANALYTICS_PURCHASE_SCHEMA.filter(
    (f) => f.mode === "REQUIRED"
  ).map((f) => f.name);
  const rows = [
    okRow(mapBillingCharge(CHARGE, CTX)),
    okRow(mapLecturePurchase(LECTURE, CTX)),
    okRow(mapSubscriptionEvent({ ...CANCELED_SUB, planType: "free" }, CTX)),
  ];
  for (const row of rows) {
    for (const col of required) {
      const v = (row as unknown as Record<string, unknown>)[col];
      assert.notEqual(
        v,
        null,
        `${col} 이 null 이다 — 로드 잡이 통째로 실패한다`
      );
      assert.notEqual(v, undefined, `${col} 이 undefined 다`);
    }
  }
});

test("음수·비숫자 금액은 행을 만들지 않는다(쓰레기 금액이 매출에 섞이지 않게)", () => {
  for (const bad of [-1, NaN, "19000", null, undefined]) {
    const r = mapBillingCharge({ ...CHARGE, amount: bad }, CTX);
    assert.equal(r.ok, false, `amount=${String(bad)} 이 통과했다`);
    assert.equal((r as { ok: false; reason: string }).reason, "missing_amount");
  }
});
