import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeGa4BridgeFreshness,
  formatBridgeSyncKst,
  type Ga4BridgeFreshness,
} from "./ga4BridgeFreshness";

function freshness(
  over: Partial<Ga4BridgeFreshness> & Pick<Ga4BridgeFreshness, "status">
): Ga4BridgeFreshness {
  return {
    lastSyncedAt: null,
    rowCount: 0,
    distinctGaKeys: 0,
    minFirstVisitDate: null,
    maxFirstVisitDate: null,
    visitLagDays: null,
    lastSyncLagDays: null,
    rangeDays: null,
    scanned: null,
    inserted: null,
    skippedExisting: null,
    reason: null,
    ok: null,
    errorMessage: null,
    ...over,
  };
}

test("payload 없으면 카피를 만들지 않는다 (구버전 함수)", () => {
  assert.equal(describeGa4BridgeFreshness(undefined), null);
  assert.equal(describeGa4BridgeFreshness(null), null);
});

test("미적재: 빈 표 ≠ 유입 0", () => {
  const c = describeGa4BridgeFreshness(freshness({ status: "not_ingested" }));
  assert.ok(c);
  assert.match(c.headline, /미적재/);
  assert.match(c.detail, /유입 0이 아니라/);
  assert.equal(c.tone, "missing");
});

test("적재됨: 마지막 동기 시각과 행 수를 말한다", () => {
  const c = describeGa4BridgeFreshness(
    freshness({
      status: "loaded",
      lastSyncedAt: "2026-08-23T20:30:08.000Z",
      rowCount: 100,
      maxFirstVisitDate: "2026-08-22",
      inserted: 30,
    })
  );
  assert.ok(c);
  assert.match(c.headline, /마지막 동기/);
  assert.match(c.headline, /2026-08-24 05:30 KST/);
  assert.match(c.detail, /적재 100명/);
  assert.match(c.detail, /최신 방문일 2026-08-22/);
  assert.match(c.detail, /이번 적재 30명/);
  assert.match(c.detail, /미적재가 아닙니다/);
  assert.equal(c.tone, "ok");
});

test("적재됨 + 0행: 동기 기록이 있으면 유입 0이다", () => {
  const c = describeGa4BridgeFreshness(
    freshness({
      status: "loaded",
      lastSyncedAt: "2026-08-24T06:00:00.000Z",
      rowCount: 0,
      inserted: 0,
    })
  );
  assert.ok(c);
  assert.match(c.detail, /유입 0/);
  assert.doesNotMatch(c.detail, /미적재/);
});

test("stale: 멈춘 것으로 보이고 빈 표를 유입 0으로 읽지 말라고 한다", () => {
  const c = describeGa4BridgeFreshness(
    freshness({
      status: "stale",
      lastSyncedAt: "2026-08-21T20:30:00.000Z",
      rowCount: 100,
      maxFirstVisitDate: "2026-08-20",
    })
  );
  assert.ok(c);
  assert.match(c.headline, /멈춘 것으로 보입니다/);
  assert.match(c.detail, /유입 0이 아니라/);
  assert.equal(c.tone, "warn");
});

test("formatBridgeSyncKst 는 UTC 20:30 을 다음날 05:30 KST 로 적는다", () => {
  assert.equal(
    formatBridgeSyncKst("2026-08-23T20:30:08.000Z"),
    "2026-08-24 05:30 KST"
  );
});
