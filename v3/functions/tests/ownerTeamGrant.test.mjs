// grant-owner-team-collab-test.mjs pure safety tests.
// No emulator required; these tests exercise the write/no-write decisions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyGrant,
  classifyRevoke,
  isLivePaidSubscription,
} from "../scripts/grant-owner-team-collab-test.mjs";

const now = new Date("2026-08-29T00:00:00.000Z");

test("free or missing subscription is upgraded to active team grant", () => {
  const verdict = classifyGrant({ sub: null, exists: false, now, months: 1 });
  assert.equal(verdict.action, "grant");
  assert.equal(verdict.direction, "upgrade");
  assert.deepEqual(verdict.after, {
    planType: "team",
    status: "active",
    paymentProvider: "founder_grant",
    founderGrant: true,
    currentPeriodEnd: "2026-09-29T00:00:00.000Z",
  });
  assert.equal(verdict.rollback.exists, false);
});

test("active paid subscription is never overwritten", () => {
  const sub = {
    planType: "pro",
    status: "active",
    paymentProvider: "portone",
    portoneBillingKey: "REDACTED",
  };
  const verdict = classifyGrant({ sub, exists: true, now, months: 1 });
  assert.equal(isLivePaidSubscription(sub), true);
  assert.equal(verdict.action, "skip");
  assert.equal(verdict.reason, "live_paid_guard");
  assert.equal(verdict.after.paymentProvider, "portone");
});

test("past_due paid subscription is also protected", () => {
  const verdict = classifyGrant({
    sub: {
      planType: "team",
      status: "past_due",
      paymentProvider: "toss",
      tossBillingKey: "REDACTED",
    },
    exists: true,
    now,
    months: 1,
  });
  assert.equal(verdict.action, "skip");
  assert.equal(verdict.reason, "live_paid_guard");
});

test("existing team_plus grant is not downgraded to team", () => {
  const verdict = classifyGrant({
    sub: {
      planType: "team_plus",
      status: "active",
      paymentProvider: "founder_grant",
      founderGrant: true,
    },
    exists: true,
    now,
    months: 1,
  });
  assert.equal(verdict.action, "grant");
  assert.equal(verdict.direction, "unchanged");
  assert.equal(verdict.after.planType, "team_plus");
});

test("grant preserves a later existing expiry", () => {
  const verdict = classifyGrant({
    sub: {
      planType: "pro",
      status: "canceled",
      currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    },
    exists: true,
    now,
    months: 1,
  });
  assert.equal(verdict.action, "grant");
  assert.equal(verdict.after.currentPeriodEnd, "2026-12-01T00:00:00.000Z");
});

test("revoke only touches this script's marked grant", () => {
  const unmarked = classifyRevoke({
    sub: {
      planType: "team",
      status: "active",
      paymentProvider: "founder_grant",
      founderGrant: true,
      founderGrantReason: "beta_selected",
    },
  });
  assert.equal(unmarked.action, "skip");

  const marked = classifyRevoke({
    sub: {
      planType: "team",
      status: "active",
      paymentProvider: "founder_grant",
      founderGrant: true,
      founderGrantReason: "beta_selected",
      grantOperation: "owner_team_collab_test",
      grantTargetEmail: "john.kim@hypemarc.com",
      ownerTeamGrantRollback: {
        exists: true,
        planType: "free",
        status: "canceled",
        paymentProvider: null,
        founderGrant: false,
        currentPeriodEnd: null,
      },
    },
  });
  assert.equal(marked.action, "restore_subscription");
  assert.equal(marked.after.planType, "free");
});
