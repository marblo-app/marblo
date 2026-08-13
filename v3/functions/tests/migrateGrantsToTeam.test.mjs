// migrate-founder-grants-to-team.mjs 의 선별 로직(classify) 단위테스트.
// 에뮬레이터 불필요 — 순수 판정 함수만 돌린다.
// 실행: npm run test:migrate-grants
//
// ★이 테스트의 존재 이유: 마이그레이션의 안전장치는 "유료 결제 구독을 절대
// 건드리지 않는다" 하나다. 프로덕션 데이터에 --apply 를 하기 전에 그 가드가
// 주장이 아니라 검증된 사실이어야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/migrate-founder-grants-to-team.mjs";

const migrates = (sub) => classify(sub).action === "migrate";
const skipReason = (sub) => classify(sub).reason;

// ── 대상 ────────────────────────────────────────────────────────────────────

test("★founderGrant=true + planType=pro 는 마이그레이션 대상", () => {
  assert.ok(
    migrates({
      planType: "pro",
      status: "active",
      founderGrant: true,
      paymentProvider: "founder_grant",
      founderGrantReason: "beta_selected",
    }),
  );
});

test("만료(canceled)된 pro grant 도 대상 — 재부여 시 team 으로 살아난다", () => {
  assert.ok(
    migrates({
      planType: "pro",
      status: "canceled",
      founderGrant: true,
      paymentProvider: "founder_grant",
    }),
  );
});

test("founderGrant 플래그 없이 paymentProvider 만 있는 레거시 grant 도 대상", () => {
  assert.ok(migrates({ planType: "pro", paymentProvider: "founder_grant" }));
});

// ── ★유료 구독 보호 (이 스크립트의 핵심 가드) ──────────────────────────────

test("★유료 결제 구독(toss)은 pro 여도 절대 대상이 아니다", () => {
  const sub = {
    planType: "pro",
    status: "active",
    paymentProvider: "toss",
    tossBillingKey: "REDACTED",
  };
  assert.equal(migrates(sub), false);
  assert.equal(skipReason(sub), "not_a_grant");
});

test("★유료 결제 구독(paddle/portone)도 대상이 아니다", () => {
  assert.equal(
    migrates({
      planType: "pro",
      status: "active",
      paymentProvider: "paddle",
      paddleSubscriptionId: "sub_x",
    }),
    false,
  );
  assert.equal(
    migrates({
      planType: "pro",
      status: "active",
      paymentProvider: "portone",
      portoneBillingKey: "REDACTED",
    }),
    false,
  );
});

test("★해지한 前결제자(결제 흔적만 남은 doc)도 대상이 아니다", () => {
  // status=canceled + tossBillingKey 잔재. grant 가 아니므로 건드리지 않는다.
  assert.equal(
    migrates({
      planType: "pro",
      status: "canceled",
      paymentProvider: "toss",
      tossBillingKey: "REDACTED",
    }),
    false,
  );
});

test("★grant 인데 결제 흔적이 섞인 문서는 자동 처리하지 않고 사람에게 넘긴다", () => {
  // 과거 stomp 잔재. 무료/유료 정체성이 섞였으므로 스크립트가 판단하지 않는다.
  const sub = {
    planType: "pro",
    status: "active",
    founderGrant: true,
    paymentProvider: "toss",
    tossBillingKey: "REDACTED",
  };
  assert.equal(migrates(sub), false);
  assert.equal(skipReason(sub), "grant_with_payment_evidence_manual");
});

// ── 멱등 / 범위 밖 ─────────────────────────────────────────────────────────

test("★이미 team 인 grant 는 스킵(멱등 — 수동 승격된 계정 포함)", () => {
  const sub = { planType: "team", founderGrant: true };
  assert.equal(migrates(sub), false);
  assert.equal(skipReason(sub), "already_team");
});

test("team_plus grant 는 강등되지 않는다", () => {
  const sub = { planType: "team_plus", founderGrant: true };
  assert.equal(migrates(sub), false);
  assert.equal(skipReason(sub), "plan_not_migratable:team_plus");
});

test("free 로 강등된 grant 는 승격 대상이 아니다", () => {
  // 만료 회수 등으로 free 가 된 문서를 team 으로 올리면 없던 권한이 생긴다.
  const sub = { planType: "free", founderGrant: true };
  assert.equal(migrates(sub), false);
  assert.equal(skipReason(sub), "plan_not_migratable:free");
});

test("planType 이 없는 grant doc 은 스킵하고 이유를 남긴다", () => {
  assert.equal(skipReason({ founderGrant: true }), "plan_not_migratable:none");
});

test("구독 doc 이 비어도 터지지 않는다", () => {
  assert.equal(skipReason({}), "not_a_grant");
  assert.equal(skipReason(null), "not_a_grant");
  assert.equal(skipReason(undefined), "not_a_grant");
});
