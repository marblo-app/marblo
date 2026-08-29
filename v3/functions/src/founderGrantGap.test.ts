import assert from "node:assert/strict";
import test from "node:test";

import {
  FOUNDER_BETA_MONTHS,
  FOUNDER_LEGACY_BETA_MONTHS,
} from "./founderLadder";
import { TEAM_GRANT_REASONS } from "./grantPlan";
import {
  GapAccountFacts,
  GapFounderFacts,
  GapSubscriptionFacts,
  SELECTED_GAP_BACKFILL_REASON,
  diagnoseGrantGap,
  isMissingAccess,
  planGrantBackfill,
  resolveGrantWindowEndMs,
} from "./founderGrantGap";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-29T00:00:00.000Z");

function founder(over: Partial<GapFounderFacts> = {}): GapFounderFacts {
  return {
    status: "selected",
    accessGrantedAtMs: Date.parse("2026-06-01T00:00:00.000Z"),
    betaExpiresAtMs: null,
    proExpiresAtMs: null,
    proSubscriptionUid: null,
    ...over,
  };
}

function account(over: Partial<GapAccountFacts> = {}): GapAccountFacts {
  return {
    uid: "uid-1",
    createdAtMs: Date.parse("2026-06-02T00:00:00.000Z"),
    ...over,
  };
}

function sub(over: Partial<GapSubscriptionFacts> = {}): GapSubscriptionFacts {
  return {
    status: "active",
    planType: "pro",
    founderGrant: false,
    paymentProvider: null,
    hasPaymentEvidence: false,
    currentPeriodEndMs: null,
    founderGrantReason: null,
    ...over,
  };
}

// ─── 마커 등록 ────────────────────────────────────────────────────────────
// 마커가 TEAM_GRANT_REASONS 에 없으면 백필된 인원만 pro 를 받아 협업 기능이
// 안 열린다. 조용히 갈리는 종류의 사고라 테스트로 못 박는다.
test("백필 마커는 TEAM_GRANT_REASONS 에 등록돼 있다(= team 부여)", () => {
  assert.ok(
    TEAM_GRANT_REASONS.includes(SELECTED_GAP_BACKFILL_REASON),
    `${SELECTED_GAP_BACKFILL_REASON} 이 TEAM_GRANT_REASONS 에 없다 — 이 코호트만 pro 로 부여된다`,
  );
});

// ─── 창 재구성 ────────────────────────────────────────────────────────────

test("betaExpiresAt 이 있으면 그 값이 창이다", () => {
  const end = Date.parse("2026-09-14T00:00:00.000Z");
  assert.equal(
    resolveGrantWindowEndMs(
      founder({ betaExpiresAtMs: end }),
      FOUNDER_LEGACY_BETA_MONTHS,
    ),
    end,
  );
});

test("beta/pro 둘 다 있으면 더 늦은 쪽이 창이다", () => {
  const beta = Date.parse("2026-09-01T00:00:00.000Z");
  const pro = Date.parse("2026-11-01T00:00:00.000Z");
  assert.equal(
    resolveGrantWindowEndMs(
      founder({ betaExpiresAtMs: beta, proExpiresAtMs: pro }),
      FOUNDER_LEGACY_BETA_MONTHS,
    ),
    pro,
  );
});

test("legacy 문서(창 없음)는 accessGrantedAt + 1개월로 재구성된다 — 3개월이 아니다", () => {
  const granted = Date.parse("2026-06-01T00:00:00.000Z");
  assert.equal(
    resolveGrantWindowEndMs(
      founder({ accessGrantedAtMs: granted }),
      FOUNDER_LEGACY_BETA_MONTHS,
    ),
    Date.parse("2026-07-01T00:00:00.000Z"),
  );
  // ★여기가 3이 되면 legacy 선정자 전원의 창이 조용히 늘어난다(승인 없는 소급).
  assert.notEqual(FOUNDER_LEGACY_BETA_MONTHS, FOUNDER_BETA_MONTHS);
});

// ─── 진단 ─────────────────────────────────────────────────────────────────

test("반려·미선정은 분모에서 빠진다", () => {
  assert.equal(
    diagnoseGrantGap(founder({ status: "rejected" }), null, null, 1),
    "not_selected",
  );
  assert.equal(
    diagnoseGrantGap(founder({ accessGrantedAtMs: null }), null, null, 1),
    "not_selected",
  );
});

test("grant 문서가 있으면 갭이 아니다 — 만료된 grant 도 마찬가지", () => {
  assert.equal(
    diagnoseGrantGap(
      founder(),
      account(),
      sub({ founderGrant: true, status: "canceled" }),
      1,
    ),
    "grant_present",
  );
  assert.equal(
    diagnoseGrantGap(
      founder(),
      account(),
      sub({ paymentProvider: "founder_grant" }),
      1,
    ),
    "grant_present",
  );
});

test("★현역 유료는 paid_live — grant 마커가 없어 34 에서 빠지지만 접근권은 있다", () => {
  const d = diagnoseGrantGap(
    founder(),
    account(),
    sub({
      status: "active",
      paymentProvider: "toss",
      hasPaymentEvidence: true,
    }),
    1,
  );
  assert.equal(d, "paid_live");
  assert.equal(
    isMissingAccess(d),
    false,
    "유료 사용자를 '못 쓰는 사람'으로 세면 안 된다",
  );
});

test("★grant 로 시작해 나중에 결제한 사람은 grant_present 로 남는다(순서 검증)", () => {
  // founderGrant=true 가 남아 있으면 유료 판정보다 grant 판정이 먼저 걸려야 한다.
  assert.equal(
    diagnoseGrantGap(
      founder(),
      account(),
      sub({
        founderGrant: true,
        paymentProvider: "toss",
        hasPaymentEvidence: true,
      }),
      1,
    ),
    "grant_present",
  );
});

test("해지된 前결제자는 유료 보호 대상이 아니다 — 갭에 남는다", () => {
  const d = diagnoseGrantGap(
    founder(),
    account({ createdAtMs: Date.parse("2026-06-02T00:00:00.000Z") }),
    sub({
      status: "canceled",
      paymentProvider: "toss",
      hasPaymentEvidence: true,
    }),
    1,
  );
  assert.equal(d, "account_no_grant_window_open");
  assert.equal(isMissingAccess(d), true);
});

test("계정이 없으면 no_account — 붙일 uid 자체가 없다", () => {
  assert.equal(diagnoseGrantGap(founder(), null, null, 1), "no_account");
});

test("★창이 닫힌 뒤 가입 → signup_after_window (onCreate 가 조용히 스킵한 자리)", () => {
  // 6/1 선정, legacy 창은 7/1 에 닫힘. 8/10 에 가입 → 가입해도 부여 0.
  assert.equal(
    diagnoseGrantGap(
      founder({ accessGrantedAtMs: Date.parse("2026-06-01T00:00:00.000Z") }),
      account({ createdAtMs: Date.parse("2026-08-10T00:00:00.000Z") }),
      null,
      FOUNDER_LEGACY_BETA_MONTHS,
    ),
    "signup_after_window",
  );
});

test("창이 열려 있는데도 grant 가 없으면 미확인 잔여로 남긴다", () => {
  assert.equal(
    diagnoseGrantGap(
      founder({ accessGrantedAtMs: Date.parse("2026-08-20T00:00:00.000Z") }),
      account({ createdAtMs: Date.parse("2026-08-21T00:00:00.000Z") }),
      null,
      FOUNDER_LEGACY_BETA_MONTHS,
    ),
    "account_no_grant_window_open",
  );
});

test("가입 시각을 모르면 두 칸으로 가르지 않고 미확인으로 둔다", () => {
  assert.equal(
    diagnoseGrantGap(founder(), account({ createdAtMs: null }), null, 1),
    "account_no_grant_unknown_signup",
  );
});

// ─── 백필 계획 ────────────────────────────────────────────────────────────

test("★계정 O 백필의 앵커는 now 다 — accessGrantedAt 이 아니다", () => {
  // 6/1 선정. accessGrantedAt 앵커였다면 9/1 만료(=3일)로 사실상 무의미하다.
  const plan = planGrantBackfill(
    founder({ accessGrantedAtMs: Date.parse("2026-06-01T00:00:00.000Z") }),
    account(),
    null,
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action, "grant");
  if (plan.action !== "grant") return;
  assert.equal(plan.periodEndMs, Date.parse("2026-11-29T00:00:00.000Z"));
  assert.ok(
    plan.addedDays > 80,
    `앵커가 now 면 3개월이 통째로 붙는다 (실제 ${plan.addedDays}일)`,
  );
});

test("★백필은 team 을 부여한다 — 협업 기능이 열려야 베타의 목적이 선다", () => {
  const plan = planGrantBackfill(
    founder(),
    account(),
    null,
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action === "grant" && plan.planType, "team");
});

test("★현역 유료는 어떤 경우에도 건드리지 않는다", () => {
  const plan = planGrantBackfill(
    founder(),
    account(),
    sub({
      status: "active",
      paymentProvider: "toss",
      hasPaymentEvidence: true,
    }),
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action === "skip" && plan.reason, "live_paid_guard");
});

test("이미 grant 가 있으면 건너뛴다(멱등 — 재실행이 이중부여가 아니다)", () => {
  const plan = planGrantBackfill(
    founder(),
    account(),
    sub({ founderGrant: true }),
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action === "skip" && plan.reason, "already_granted");
});

test("기간을 줄이는 부여는 없다 — 더 긴 기간 보유자는 건너뛴다", () => {
  const plan = planGrantBackfill(
    founder(),
    account(),
    sub({ status: "canceled", currentPeriodEndMs: NOW + 400 * DAY }),
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action === "skip" && plan.reason, "already_longer");
});

test("★계정 X 는 grant 가 아니라 창 열기다 — 붙일 uid 가 없다", () => {
  const plan = planGrantBackfill(
    founder({ betaExpiresAtMs: Date.parse("2026-07-01T00:00:00.000Z") }),
    null,
    null,
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action, "open_window");
  if (plan.action !== "open_window") return;
  assert.equal(plan.newBetaExpiresAtMs, Date.parse("2026-11-29T00:00:00.000Z"));
  assert.equal(
    plan.previousBetaExpiresAtMs,
    Date.parse("2026-07-01T00:00:00.000Z"),
  );
  assert.ok(
    plan.newBetaExpiresAtMs > NOW,
    "창을 열지 않으면 가입해도 window_expired 로 부여가 0이다",
  );
});

test("반려자는 백필 대상이 아니다", () => {
  const plan = planGrantBackfill(
    founder({ status: "rejected" }),
    account(),
    null,
    NOW,
    FOUNDER_BETA_MONTHS,
  );
  assert.equal(plan.action === "skip" && plan.reason, "not_selected");
});
