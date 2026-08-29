#!/usr/bin/env node
/**
 * Give the project owner a temporary team grant for team-collab testing.
 *
 * Dry run (default, no writes):
 *   GCLOUD_PROJECT=marblo-2253d node scripts/grant-owner-team-collab-test.mjs
 *
 * Apply after explicit approval:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/grant-owner-team-collab-test.mjs \
 *     --apply --confirm=grant-owner-team-collab-test
 *
 * Dry-run revoke plan:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/grant-owner-team-collab-test.mjs --revoke
 *
 * Revoke after explicit approval:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/grant-owner-team-collab-test.mjs \
 *     --revoke --apply --confirm=revoke-owner-team-collab-test
 *
 * Auth: same shape as backfill-founder-pro-grants.mjs: ADC OAuth + REST.
 * Email -> uid lookup tries Identity Toolkit accounts:lookup first. If that is
 * forbidden, it falls back to a Firestore users collection query by email.
 *
 * Scope is deliberately one account only: john.kim@hypemarc.com.
 * Do not grant datagadapida@gmail.com; the team-member free path must stay free.
 */
import { execFileSync } from "node:child_process";

const TARGET_EMAIL = "john.kim@hypemarc.com";
const TARGET_REASON = "beta_selected";
const TARGET_PLAN = "team";
const OPERATION = "owner_team_collab_test";
const APPLY_CONFIRM = "grant-owner-team-collab-test";
const REVOKE_CONFIRM = "revoke-owner-team-collab-test";
const DEFAULT_GRANT_MONTHS = 1;

const APPLY = process.argv.includes("--apply");
const REVOKE = process.argv.includes("--revoke");
const CONFIRM_ARG = process.argv.find((arg) => arg.startsWith("--confirm="));
const CONFIRM = CONFIRM_ARG ? CONFIRM_ARG.slice("--confirm=".length) : "";
const MONTHS_ARG = process.argv.find((arg) => arg.startsWith("--months="));
const GRANT_MONTHS = MONTHS_ARG
  ? Number(MONTHS_ARG.slice("--months=".length))
  : DEFAULT_GRANT_MONTHS;
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";

const PLAN_RANK = {
  free: 0,
  pro: 1,
  team: 2,
  team_plus: 3,
  enterprise: 4,
};

function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }

  return execFileSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

let token = "";

function addMonths(base, months) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function firestoreUrl(documentPath = "") {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;
  return documentPath ? `${base}/${documentPath}` : base;
}

function firestoreCommitUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;
}

function firestoreBeginTransactionUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:beginTransaction`;
}

function firestoreRunQueryUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:runQuery`;
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${res.status} ${res.statusText}: ${body}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

function fromFirestoreValue(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [
        key,
        fromFirestoreValue(child),
      ]),
    );
  }
  return undefined;
}

function toFirestoreValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .map(([key, child]) => [key, toFirestoreValue(child)])
            .filter(([, child]) => child !== undefined),
        ),
      },
    };
  }
  return undefined;
}

function documentData(doc) {
  return Object.fromEntries(
    Object.entries(doc?.fields || {}).map(([key, value]) => [
      key,
      fromFirestoreValue(value),
    ]),
  );
}

function docId(name) {
  return name.split("/").at(-1) || name;
}

function planRank(plan) {
  if (typeof plan !== "string") return -1;
  const rank = PLAN_RANK[plan];
  return typeof rank === "number" ? rank : -1;
}

function hasPaymentEvidence(sub) {
  if (!sub) return false;
  return Boolean(
    sub.tossBillingKey ||
      sub.tossCustomerKey ||
      sub.paddleSubscriptionId ||
      sub.portoneBillingKey ||
      sub.portonePaymentId ||
      sub.paymentProvider === "toss" ||
      sub.paymentProvider === "paddle" ||
      sub.paymentProvider === "portone",
  );
}

function isFounderGrantSubscription(sub) {
  if (!sub) return false;
  return sub.founderGrant === true || sub.paymentProvider === "founder_grant";
}

function isLivePaidSubscription(sub) {
  if (!sub) return false;
  if (isFounderGrantSubscription(sub)) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  return hasPaymentEvidence(sub);
}

function resolveTargetPlan(sub) {
  if (!isFounderGrantSubscription(sub)) return TARGET_PLAN;
  return planRank(sub?.planType) > planRank(TARGET_PLAN)
    ? sub.planType
    : TARGET_PLAN;
}

function formatDate(value) {
  return value instanceof Date ? value.toISOString() : null;
}

function snapshotSubscription(sub) {
  return {
    planType: sub?.planType ?? null,
    status: sub?.status ?? null,
    paymentProvider: sub?.paymentProvider ?? null,
    founderGrant: sub?.founderGrant ?? null,
    currentPeriodEnd: formatDate(sub?.currentPeriodEnd),
  };
}

const OVERWRITTEN_FIELDS = [
  "userId",
  "planType",
  "status",
  "paymentProvider",
  "founderGrant",
  "founderGrantReason",
  "founderGrantStartedAt",
  "currentPeriodEnd",
  "currentPeriodStart",
  "grantOperation",
  "grantTargetEmail",
  "ownerTeamGrantRollback",
];

function ownField(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function rollbackSnapshot(sub, exists) {
  const source = sub || {};
  const fields = Object.fromEntries(
    OVERWRITTEN_FIELDS.map((key) => [
      key,
      source[key] instanceof Date ? source[key].toISOString() : source[key],
    ]),
  );
  const fieldPresent = Object.fromEntries(
    OVERWRITTEN_FIELDS.map((key) => [key, ownField(source, key)]),
  );
  return {
    exists,
    fields,
    fieldPresent,
  };
}

function classifyGrant({ sub, exists, now, months }) {
  const current = snapshotSubscription(sub);
  const targetEnd = addMonths(now, months);
  const existingEnd =
    sub?.currentPeriodEnd instanceof Date ? sub.currentPeriodEnd : null;
  const periodEnd =
    existingEnd && existingEnd > targetEnd ? existingEnd : targetEnd;

  if (isLivePaidSubscription(sub)) {
    return {
      action: "skip",
      reason: "live_paid_guard",
      direction: "unchanged",
      current,
      after: current,
      paymentProviderPreserved: true,
    };
  }

  const nextPlan = resolveTargetPlan(sub);
  const direction =
    planRank(nextPlan) > planRank(sub?.planType)
      ? "upgrade"
      : planRank(nextPlan) < planRank(sub?.planType)
        ? "downgrade"
        : "unchanged";

  if (direction === "downgrade") {
    return {
      action: "skip",
      reason: "no_downgrade_guard",
      direction,
      current,
      after: current,
      paymentProviderPreserved: true,
    };
  }

  return {
    action: "grant",
    reason: null,
    direction,
    current,
    after: {
      planType: nextPlan,
      status: "active",
      paymentProvider: "founder_grant",
      founderGrant: true,
      currentPeriodEnd: periodEnd.toISOString(),
    },
    rollback: rollbackSnapshot(sub, exists),
  };
}

function isScriptGrant(sub) {
  return (
    sub?.founderGrant === true &&
    sub?.paymentProvider === "founder_grant" &&
    sub?.founderGrantReason === TARGET_REASON &&
    sub?.grantOperation === OPERATION &&
    sub?.grantTargetEmail === TARGET_EMAIL
  );
}

function classifyRevoke({ sub }) {
  const current = snapshotSubscription(sub);
  if (!isScriptGrant(sub)) {
    return {
      action: "skip",
      reason: "not_owner_team_collab_test_grant",
      current,
      after: current,
    };
  }

  const rollback = sub.ownerTeamGrantRollback || {};
  if (rollback.exists === false) {
    return {
      action: "delete_subscription",
      reason: null,
      current,
      after: null,
      rollback,
    };
  }

  return {
    action: "restore_subscription",
    reason: null,
    current,
    after: {
      planType: rollback.fields?.planType ?? rollback.planType ?? null,
      status: rollback.fields?.status ?? rollback.status ?? null,
      paymentProvider:
        rollback.fields?.paymentProvider ?? rollback.paymentProvider ?? null,
      founderGrant:
        rollback.fields?.founderGrant ?? rollback.founderGrant ?? null,
      currentPeriodEnd:
        rollback.fields?.currentPeriodEnd ?? rollback.currentPeriodEnd ?? null,
    },
    rollback,
  };
}

async function lookupUserByEmailViaIdentityToolkit(email) {
  const json = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID,
    )}/accounts:lookup`,
    {
      method: "POST",
      body: JSON.stringify({ email: [email] }),
    },
  );
  const user = (json.users || [])[0] || null;
  return user?.localId ? { uid: user.localId, source: "identitytoolkit" } : null;
}

async function lookupUserByEmailViaUsersCollection(email) {
  const query = {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "email" },
          op: "EQUAL",
          value: { stringValue: email },
        },
      },
      limit: 1,
    },
  };
  const rows = await fetchJson(firestoreRunQueryUrl(), {
    method: "POST",
    body: JSON.stringify(query),
  });
  const doc = rows.find((row) => row.document)?.document || null;
  if (!doc) return null;
  const data = documentData(doc);
  const uid =
    typeof data.uid === "string" && data.uid ? data.uid : docId(doc.name);
  return { uid, source: "users_collection_email_query" };
}

async function lookupUidByEmail(email) {
  try {
    const result = await lookupUserByEmailViaIdentityToolkit(email);
    if (result) return result;
    return { uid: null, source: "identitytoolkit_not_found" };
  } catch (err) {
    if (err.status !== 403) throw err;
    const fallback = await lookupUserByEmailViaUsersCollection(email);
    return (
      fallback || {
        uid: null,
        source: "users_collection_email_query_not_found_after_identity_403",
      }
    );
  }
}

async function getSubscription(uid, transaction) {
  try {
    const url = new URL(
      firestoreUrl(`subscriptions/${encodeURIComponent(uid)}`),
    );
    if (transaction) url.searchParams.set("transaction", transaction);
    const doc = await fetchJson(url.toString());
    return { exists: true, updateTime: doc.updateTime || null, data: documentData(doc) };
  } catch (err) {
    if (String(err.message || err).startsWith("404 ")) {
      return { exists: false, updateTime: null, data: null };
    }
    throw err;
  }
}

function documentFields(data) {
  return Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [key, toFirestoreValue(value)])
      .filter(([, value]) => value !== undefined),
  );
}

function documentName(uid) {
  return `${firestoreUrl()}/subscriptions/${encodeURIComponent(uid)}`;
}

function updateWrite(uid, data, deleteFieldPaths = []) {
  const fields = documentFields(data);
  const fieldPaths = [...Object.keys(fields), ...deleteFieldPaths];
  return {
    update: {
      name: documentName(uid),
      fields,
    },
    updateMask: { fieldPaths },
  };
}

async function beginTransaction() {
  const json = await fetchJson(firestoreBeginTransactionUrl(), {
    method: "POST",
    body: JSON.stringify({ options: { readWrite: {} } }),
  });
  return json.transaction;
}

async function commitWrites(transaction, writes) {
  await fetchJson(firestoreCommitUrl(), {
    method: "POST",
    body: JSON.stringify({ transaction, writes }),
  });
}

function buildGrantWrite(uid, verdict, now) {
  const payload = {
    userId: uid,
    planType: verdict.after.planType,
    status: verdict.after.status,
    paymentProvider: verdict.after.paymentProvider,
    founderGrant: true,
    founderGrantReason: TARGET_REASON,
    founderGrantStartedAt: now,
    currentPeriodEnd: new Date(verdict.after.currentPeriodEnd),
    updatedAt: now,
    grantOperation: OPERATION,
    grantTargetEmail: TARGET_EMAIL,
    ownerTeamGrantRollback: verdict.rollback,
  };
  if (verdict.rollback.exists === false) {
    payload.currentPeriodStart = now;
  }
  return updateWrite(uid, payload);
}

function buildRevokeWrite(uid, verdict) {
  if (verdict.action === "delete_subscription") {
    return { delete: documentName(uid) };
  }

  const rollback = verdict.rollback || {};
  const fields = rollback.fields || {};
  const fieldPresent = rollback.fieldPresent || {};
  const data = {};
  const deleteFieldPaths = [];
  for (const key of OVERWRITTEN_FIELDS) {
    if (key === "ownerTeamGrantRollback") {
      deleteFieldPaths.push(key);
      continue;
    }
    if (fieldPresent[key]) {
      const value = fields[key];
      data[key] =
        typeof value === "string" &&
        (key.endsWith("At") || key === "currentPeriodEnd" || key === "currentPeriodStart")
          ? new Date(value)
          : value;
    } else {
      deleteFieldPaths.push(key);
    }
  }
  data.updatedAt = new Date();
  return updateWrite(uid, data, deleteFieldPaths);
}

async function applyGrant(uid) {
  const transaction = await beginTransaction();
  const snap = await getSubscription(uid, transaction);
  const now = new Date();
  const verdict = classifyGrant({
    sub: snap.data,
    exists: snap.exists,
    now,
    months: GRANT_MONTHS,
  });
  if (verdict.action !== "grant") {
    return { applied: false, verdict };
  }
  await commitWrites(transaction, [buildGrantWrite(uid, verdict, now)]);
  return { applied: true, verdict };
}

async function applyRevoke(uid) {
  const transaction = await beginTransaction();
  const snap = await getSubscription(uid, transaction);
  const verdict = classifyRevoke({ sub: snap.data });
  if (verdict.action === "skip") {
    return { applied: false, verdict };
  }
  await commitWrites(transaction, [buildRevokeWrite(uid, verdict)]);
  return { applied: true, verdict };
}

function commandMode() {
  return REVOKE ? "revoke" : "grant";
}

function printPlan({ uid, lookupSource, verdict, applied }) {
  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        dryRun: !APPLY,
        mode: commandMode(),
        target: {
          uid,
          email: TARGET_EMAIL,
          emailLookup: lookupSource,
        },
        grantReason: TARGET_REASON,
        grantPlanReason: "TEAM_GRANT_REASONS includes beta_selected",
        grantMonths: REVOKE ? null : GRANT_MONTHS,
        operationMarker: OPERATION,
        action: verdict.action,
        skipReason: verdict.reason,
        current: verdict.current,
        after: verdict.after,
        direction: verdict.direction ?? null,
        guards: {
          noDowngrade: true,
          livePaidSubscriptionNotOverwritten: true,
          paymentProviderPreservedOnSkip:
            verdict.action === "skip"
              ? verdict.paymentProviderPreserved ?? true
              : null,
        },
        revokePath: {
          dryRun:
            "node scripts/grant-owner-team-collab-test.mjs --revoke",
          applyAfterApproval:
            "node scripts/grant-owner-team-collab-test.mjs --revoke --apply --confirm=revoke-owner-team-collab-test",
          safety:
            "revoke only touches grants with founderGrant=true, paymentProvider=founder_grant, founderGrantReason=beta_selected, grantOperation=owner_team_collab_test, grantTargetEmail=john.kim@hypemarc.com",
        },
        applied,
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (!PROJECT_ID) {
    throw new Error(
      "Missing project id. Set GCLOUD_PROJECT=marblo-2253d before running.",
    );
  }
  if (!Number.isInteger(GRANT_MONTHS) || GRANT_MONTHS <= 0) {
    throw new Error("--months must be a positive integer.");
  }
  if (APPLY && CONFIRM !== (REVOKE ? REVOKE_CONFIRM : APPLY_CONFIRM)) {
    throw new Error(
      `Refusing to write without --confirm=${
        REVOKE ? REVOKE_CONFIRM : APPLY_CONFIRM
      }.`,
    );
  }

  token = getAccessToken();

  const lookup = await lookupUidByEmail(TARGET_EMAIL);
  if (!lookup.uid) {
    printPlan({
      uid: null,
      lookupSource: lookup.source,
      verdict: {
        action: "skip",
        reason: "uid_not_found",
        current: snapshotSubscription(null),
        after: snapshotSubscription(null),
      },
      applied: false,
    });
    return;
  }

  if (APPLY) {
    const result = REVOKE
      ? await applyRevoke(lookup.uid)
      : await applyGrant(lookup.uid);
    printPlan({
      uid: lookup.uid,
      lookupSource: lookup.source,
      verdict: result.verdict,
      applied: result.applied,
    });
    return;
  }

  const snap = await getSubscription(lookup.uid);
  const now = new Date();
  const verdict = REVOKE
    ? classifyRevoke({ sub: snap.data })
    : classifyGrant({
        sub: snap.data,
        exists: snap.exists,
        now,
        months: GRANT_MONTHS,
      });
  printPlan({
    uid: lookup.uid,
    lookupSource: lookup.source,
    verdict,
    applied: false,
  });
  console.log(
    `DRY RUN - no writes. Add --apply --confirm=${
      REVOKE ? REVOKE_CONFIRM : APPLY_CONFIRM
    } after approval.`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  process.argv[1].endsWith("grant-owner-team-collab-test.mjs");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  classifyGrant,
  classifyRevoke,
  hasPaymentEvidence,
  isLivePaidSubscription,
  resolveTargetPlan,
};
