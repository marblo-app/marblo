import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWaitlistBackfillPlan,
  waitlistTargetToUpsertInput,
} from "./waitlistMarketingBackfill";
import {
  contactIdForEmail,
  mergeEmailConsent,
  type EmailMarketingConsent,
} from "./marketingContacts";

test("buildWaitlistBackfillPlan selects valid unique waitlist emails", () => {
  const existing = new Set([contactIdForEmail("owner@example.com")]);
  const plan = buildWaitlistBackfillPlan(
    [
      {
        docId: "a",
        email: " Owner@Example.com ",
        locale: "ko",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        docId: "b",
        email: "owner@example.com",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      { docId: "bad", email: "not-an-email" },
    ],
    existing,
  );

  assert.equal(plan.targets.length, 1);
  assert.equal(plan.skippedInvalidEmail, 1);
  assert.equal(plan.duplicateRows, 1);
  assert.equal(plan.existingContacts, 1);
  assert.equal(plan.missingContacts, 0);
  assert.equal(plan.targets[0].normalizedEmail, "owner@example.com");
  assert.deepEqual(plan.targets[0].sourceDocIds, ["a", "b"]);
  assert.equal(
    plan.targets[0].signupAt?.toISOString(),
    "2026-01-01T00:00:00.000Z",
  );
});

test("waitlist consent mapping grants only from marketingConsent=true", () => {
  const plan = buildWaitlistBackfillPlan(
    [
      {
        docId: "grant",
        email: "grant@example.com",
        marketingConsent: true,
        marketingConsentVersion: "v759",
        marketingConsentAt: new Date("2026-02-01T00:00:00.000Z"),
      },
      { docId: "false", email: "false@example.com", marketingConsent: false },
      { docId: "missing", email: "missing@example.com" },
    ],
    new Set(),
  );

  assert.equal(plan.grantTargets, 1);
  assert.equal(plan.pendingTargets, 2);

  const grant = plan.targets.find((t) => t.normalizedEmail === "grant@example.com");
  const pending = plan.targets.find(
    (t) => t.normalizedEmail === "false@example.com",
  );
  assert.ok(grant);
  assert.ok(pending);

  assert.deepEqual(waitlistTargetToUpsertInput(grant).grantConsent, {
    source: "waitlist_form_marketing_optin",
    version: "v759",
    legalBasis: "explicit_opt_in",
    consentedAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(waitlistTargetToUpsertInput(pending).grantConsent, null);
  assert.equal(
    waitlistTargetToUpsertInput(pending).markPending?.source,
    "backfill_waitlist",
  );
});

test("pending backfill request does not downgrade granted consent", () => {
  const granted: EmailMarketingConsent = {
    status: "granted",
    source: "web_privacy_consent",
    version: "v1",
    consentedAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedAt: null,
    legalBasis: "explicit_opt_in",
  };

  const merged = mergeEmailConsent(
    granted,
    {
      pending: {
        source: "backfill_waitlist",
        detail: "waitlist marketingConsent is false/missing",
      },
    },
    new Date("2026-02-01T00:00:00.000Z"),
  );

  assert.equal(merged.consent.status, "granted");
  assert.equal(merged.event, null);
});
