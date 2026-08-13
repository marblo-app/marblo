// grantPlan 순수 로직 단위테스트 (betaSegments.test.ts 규약).
// 실행:
//   tsc src/grantPlan.ts src/grantPlan.test.ts \
//       --outDir .test-out/grant-plan --module commonjs --target es2020 \
//       --esModuleInterop --strict --skipLibCheck \
//   && node --test .test-out/grant-plan/grantPlan.test.js
// package.json: npm run test:grant-plan
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  grantPlanTypeForReason,
  resolveGrantPlanType,
  planRank,
  TEAM_GRANT_REASONS,
  TEAM_GRANT_PLAN,
  DEFAULT_GRANT_PLAN,
} from "./grantPlan";

// ── reason → 플랜 매핑 ──────────────────────────────────────────────────────

test("★베타/파운더 grant reason 은 team 을 부여한다", () => {
  // 이 티켓의 본체: pro 로 부여하면 베타 유저가 협업·멤버 기능을 못 만진다.
  assert.equal(grantPlanTypeForReason("beta_selected"), "team");
  assert.equal(grantPlanTypeForReason("beta_signup"), "team");
  assert.equal(grantPlanTypeForReason("founder_backfill"), "team");
});

test("TEAM_GRANT_REASONS 표의 모든 reason 이 team 으로 매핑된다", () => {
  // 표에 reason 을 추가하고 매핑을 잊는 drift 를 막는다.
  for (const reason of TEAM_GRANT_REASONS) {
    assert.equal(grantPlanTypeForReason(reason), TEAM_GRANT_PLAN);
  }
});

test("표 밖 reason 은 기본값 pro 를 유지한다", () => {
  // 경험공유 보상은 "Pro 몇 개월"로 공지된 별개 보상이다.
  assert.equal(grantPlanTypeForReason("experience_share_reward"), "pro");
  assert.equal(grantPlanTypeForReason("something_new"), DEFAULT_GRANT_PLAN);
  assert.equal(grantPlanTypeForReason(""), "pro");
  assert.equal(grantPlanTypeForReason(undefined), "pro");
  assert.equal(grantPlanTypeForReason(null), "pro");
  assert.equal(grantPlanTypeForReason(123), "pro");
});

test("reason 의 앞뒤 공백은 매핑을 깨지 않는다", () => {
  assert.equal(grantPlanTypeForReason("  beta_signup  "), "team");
});

// ── 플랜 서열 ───────────────────────────────────────────────────────────────

test("planRank 는 알려진 플랜만 서열화하고 미지 값은 -1", () => {
  assert.ok(planRank("team") > planRank("pro"));
  assert.ok(planRank("team_plus") > planRank("team"));
  assert.ok(planRank("pro") > planRank("free"));
  assert.equal(planRank("wat"), -1);
  assert.equal(planRank(undefined), -1);
  assert.equal(planRank(42), -1);
});

// ── 신규 부여 ───────────────────────────────────────────────────────────────

test("★신규 베타 grant(기존 doc 없음) → team", () => {
  assert.equal(resolveGrantPlanType("beta_selected", undefined), "team");
  assert.equal(resolveGrantPlanType("beta_signup", null), "team");
  assert.equal(resolveGrantPlanType("founder_backfill", {}), "team");
});

test("기존 pro grant 에 베타 reason 재부여 → team 으로 승격", () => {
  // 마이그레이션과 별개로, 재선정/재부여가 지나가면 자연히 team 이 된다.
  assert.equal(
    resolveGrantPlanType("beta_selected", {
      planType: "pro",
      founderGrant: true,
    }),
    "team",
  );
});

// ── ★강등 금지 가드 ────────────────────────────────────────────────────────

test("★team grant 보유자가 pro 보상을 받아도 team 을 유지한다(강등 금지)", () => {
  // 가드가 없으면 merge 가 planType 을 team→pro 로 내려 협업 기능이 조용히 사라진다.
  assert.equal(
    resolveGrantPlanType("experience_share_reward", {
      planType: "team",
      founderGrant: true,
    }),
    "team",
  );
});

test("paymentProvider=founder_grant 만 있는 레거시 grant doc 도 가드 대상", () => {
  // founderGrant 플래그가 없던 시절 문서. 판정은 index.ts 와 동일 규칙.
  assert.equal(
    resolveGrantPlanType("experience_share_reward", {
      planType: "team",
      paymentProvider: "founder_grant",
    }),
    "team",
  );
});

test("★유료 구독 잔재의 상위 플랜은 계승하지 않는다(오버그랜트 방지)", () => {
  // 해지·실효한 前 team_plus 결제자에게 무료 grant 가 team_plus 를 영구
  // 부여하면 결제한 적 없는 상위 플랜을 주는 것이다.
  assert.equal(
    resolveGrantPlanType("experience_share_reward", {
      planType: "team_plus",
      paymentProvider: "toss",
    }),
    "pro",
  );
  assert.equal(
    resolveGrantPlanType("beta_selected", {
      planType: "team_plus",
      paymentProvider: "toss",
    }),
    "team",
  );
});

test("미지의 planType 을 든 grant doc 은 계승하지 않고 표대로 부여한다", () => {
  assert.equal(
    resolveGrantPlanType("beta_signup", {
      planType: "legacy_unlimited",
      founderGrant: true,
    }),
    "team",
  );
  assert.equal(
    resolveGrantPlanType("experience_share_reward", {
      planType: undefined,
      founderGrant: true,
    }),
    "pro",
  );
});

test("free 로 강등됐던 grant doc 은 표대로 다시 올라온다", () => {
  assert.equal(
    resolveGrantPlanType("beta_selected", {
      planType: "free",
      founderGrant: true,
    }),
    "team",
  );
});
