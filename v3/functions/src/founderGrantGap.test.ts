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
  GrantConsumptionFacts,
  SELECTED_GAP_BACKFILL_REASON,
  diagnoseGrantGap,
  isGrantConsumed,
  isMissingAccess,
  planGrantBackfill,
  resolveFounderGrantWindowAtMaterialization,
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

// ════════════════════════════════════════════════════════════════════════════
// 3. ★근본 수리(R1) — 부여 시점 앵커
// ════════════════════════════════════════════════════════════════════════════

const GRANT_AT = Date.parse("2026-08-29T00:00:00.000Z");
/** GRANT_AT + FOUNDER_BETA_MONTHS(3). 재앵커가 줘야 하는 값. */
const REANCHORED = Date.parse("2026-11-29T00:00:00.000Z");

function consumption(
  over: Partial<GrantConsumptionFacts> = {},
): GrantConsumptionFacts {
  return {
    proSubscriptionUid: null,
    proSubscriptionGrantedAtMs: null,
    hasFounderGrantSubscription: false,
    ...over,
  };
}

function decide(
  f: GapFounderFacts,
  c: GrantConsumptionFacts,
  grantAtMs = GRANT_AT,
) {
  return resolveFounderGrantWindowAtMaterialization(
    f,
    c,
    grantAtMs,
    FOUNDER_LEGACY_BETA_MONTHS,
    FOUNDER_BETA_MONTHS,
  );
}

// ─── 소비 판정 ────────────────────────────────────────────────────────────

test("소비 증거 3종은 각각 단독으로 '소비'를 뜻한다(OR)", () => {
  assert.equal(isGrantConsumed(consumption()), false);
  assert.equal(
    isGrantConsumed(consumption({ proSubscriptionUid: "uid-1" })),
    true,
  );
  assert.equal(
    isGrantConsumed(consumption({ proSubscriptionGrantedAtMs: GRANT_AT })),
    true,
  );
  assert.equal(
    isGrantConsumed(consumption({ hasFounderGrantSubscription: true })),
    true,
  );
});

test("빈 문자열 proSubscriptionUid 는 소비가 아니다(스탬프 없음과 같다)", () => {
  assert.equal(isGrantConsumed(consumption({ proSubscriptionUid: "" })), false);
});

// ─── ★미소비 × 창 닫힘 = 이 티켓의 본체 ────────────────────────────────────

test("★미소비 + 창 닫힘 → 조용히 스킵하지 않고 가입 시점 앵커로 3개월을 준다", () => {
  // 실측 18명의 모양: 07-14 선정 → legacy 창 08-14 마감 → 오늘 가입.
  // 수리 전에는 window_expired 로 부여가 0이었다.
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-07-14T00:00:00.000Z"),
      betaExpiresAtMs: Date.parse("2026-08-14T00:00:00.000Z"),
    }),
    consumption(),
  );
  assert.equal(d.kind, "grant");
  assert.equal(d.kind === "grant" && d.anchor, "signup_reanchor");
  assert.equal(d.kind === "grant" && d.windowEndMs, REANCHORED);
  assert.equal(
    d.kind === "grant" && d.previousWindowEndMs,
    Date.parse("2026-08-14T00:00:00.000Z"),
  );
});

test("★미소비 + 창은 아직 열림이지만 잔여가 짧다 → 잔여가 아니라 3개월을 준다", () => {
  // 실측 12명의 모양: 09-05 마감 창을 들고 오늘 가입. 수리 전에는 7일만 받았다.
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-08-05T00:00:00.000Z"),
      betaExpiresAtMs: Date.parse("2026-09-05T00:00:00.000Z"),
    }),
    consumption(),
  );
  assert.equal(d.kind === "grant" && d.anchor, "signup_reanchor");
  assert.equal(d.kind === "grant" && d.windowEndMs, REANCHORED);
});

test("★미소비 + betaExpiresAt 없는 legacy 문서도 3개월을 받는다", () => {
  // legacy 재구성 창은 accessGrantedAt + 1개월이라 이미 닫혀 있다.
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
      betaExpiresAtMs: null,
    }),
    consumption(),
  );
  assert.equal(d.kind === "grant" && d.anchor, "signup_reanchor");
  assert.equal(d.kind === "grant" && d.windowEndMs, REANCHORED);
});

// ─── ★소비된 grant 의 앵커는 옮기지 않는다(티켓 제약) ──────────────────────

test("★소비 + 창 열림 → 만료일이 뒤로 밀리지 않는다", () => {
  // 08-20 선정, 11-20 마감. 재앵커였다면 11-29 로 9일 밀렸을 것이다.
  const openEnd = Date.parse("2026-11-20T00:00:00.000Z");
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-08-20T00:00:00.000Z"),
      betaExpiresAtMs: openEnd,
    }),
    consumption({ proSubscriptionUid: "uid-1" }),
  );
  assert.equal(d.kind === "grant" && d.anchor, "existing_window");
  assert.equal(d.kind === "grant" && d.windowEndMs, openEnd);
  assert.ok(
    (d.kind === "grant" ? d.windowEndMs : 0) < REANCHORED,
    "소비자의 창이 재앵커 값으로 늘어나면 승인 없는 소급 연장이다",
  );
});

test("★소비 + 창 닫힘 → 부활시키지 않고 window_expired 로 스킵한다", () => {
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
      betaExpiresAtMs: Date.parse("2026-06-01T00:00:00.000Z"),
    }),
    consumption({ proSubscriptionUid: "uid-1" }),
  );
  assert.equal(d.kind, "skip");
  assert.equal(d.kind === "skip" && d.reason, "window_expired");
  // ★스킵해도 창 값은 돌려준다 — 로그·스탬프에 찍혀야 조용한 실패가 아니다.
  assert.equal(
    d.kind === "skip" && d.windowEndMs,
    Date.parse("2026-06-01T00:00:00.000Z"),
  );
});

test("★스탬프는 없고 구독만 있는 만료 grant 도 '소비'다 — 재앵커로 부활하지 않는다", () => {
  // 옛 백필 경로가 남긴 모양. 이 증거를 안 보면 만료된 소비 grant 가 되살아난다.
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
      betaExpiresAtMs: Date.parse("2026-06-01T00:00:00.000Z"),
      proSubscriptionUid: null,
    }),
    consumption({ hasFounderGrantSubscription: true }),
  );
  assert.equal(d.kind === "skip" && d.reason, "window_expired");
});

// ─── 기간을 줄이지 않는다 ─────────────────────────────────────────────────

test("★미소비라도 기존 창이 더 길면 줄이지 않는다(설문 보상 5개월)", () => {
  const surveyEnd = Date.parse("2027-01-01T00:00:00.000Z");
  const d = decide(
    founder({
      accessGrantedAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
      proExpiresAtMs: surveyEnd,
    }),
    consumption(),
  );
  assert.equal(d.kind === "grant" && d.anchor, "existing_window");
  assert.equal(d.kind === "grant" && d.windowEndMs, surveyEnd);
});

// ─── 정상 선정에서 재앵커 로그가 뜨지 않는다 ──────────────────────────────

test("★신규 선정(창 = 부여시각 + 3개월)은 existing_window 다 — 재앵커 로그 노이즈 없음", () => {
  // markFounderSelectedInternal 이 betaExpiresAt 을 betaStartedAt+3 으로 잡고
  // 같은 betaStartedAt 을 grantStartedAt 으로 넘기므로 두 값이 정확히 같다.
  const d = decide(
    founder({ accessGrantedAtMs: GRANT_AT, betaExpiresAtMs: REANCHORED }),
    consumption(),
  );
  assert.equal(d.kind === "grant" && d.anchor, "existing_window");
  assert.equal(d.kind === "grant" && d.windowEndMs, REANCHORED);
});

// ─── 반려 게이트 ──────────────────────────────────────────────────────────

test("★반려자는 재앵커로 되살아나지 않는다", () => {
  // revokeFounderGrant 는 betaExpiresAt 을 즉시만료로 당겨 이중으로 막는데,
  // 재앵커가 들어오면 만료는 더 이상 장벽이 아니다. status 게이트가 그 한 겹이다.
  const d = decide(
    founder({
      status: "rejected",
      accessGrantedAtMs: Date.parse("2026-07-14T00:00:00.000Z"),
      betaExpiresAtMs: Date.parse("2026-07-20T00:00:00.000Z"),
    }),
    consumption(),
  );
  assert.equal(d.kind, "skip");
  assert.equal(d.kind === "skip" && d.reason, "not_selected");
});

test("accessGrantedAt 이 없으면 대상이 아니다", () => {
  const d = decide(
    founder({ accessGrantedAtMs: null, betaExpiresAtMs: null }),
    consumption(),
  );
  assert.equal(d.kind === "skip" && d.reason, "not_selected");
});

test("설문 제출(status=feedback_submitted)은 선정 상태를 잃지 않는다", () => {
  const d = decide(
    founder({
      status: "feedback_submitted",
      accessGrantedAtMs: Date.parse("2026-07-14T00:00:00.000Z"),
      betaExpiresAtMs: Date.parse("2026-08-14T00:00:00.000Z"),
    }),
    consumption(),
  );
  assert.equal(d.kind === "grant" && d.anchor, "signup_reanchor");
});

// ─── 어떤 경우에도 만료일이 앞당겨지지 않는다(불변식) ──────────────────────

test("★불변식: 부여 결정은 기존 창보다 이른 만료일을 절대 만들지 않는다", () => {
  const windows = [
    Date.parse("2026-06-01T00:00:00.000Z"), // 닫힘
    Date.parse("2026-09-05T00:00:00.000Z"), // 열림·짧음
    Date.parse("2027-06-01T00:00:00.000Z"), // 열림·김
  ];
  for (const w of windows) {
    for (const c of [consumption(), consumption({ proSubscriptionUid: "u" })]) {
      const d = decide(
        founder({
          accessGrantedAtMs: Date.parse("2026-05-01T00:00:00.000Z"),
          betaExpiresAtMs: w,
        }),
        c,
      );
      if (d.kind === "grant") {
        assert.ok(
          d.windowEndMs >= w,
          `창이 ${new Date(w).toISOString()} → ${new Date(
            d.windowEndMs,
          ).toISOString()} 로 앞당겨졌다`,
        );
      }
    }
  }
});
