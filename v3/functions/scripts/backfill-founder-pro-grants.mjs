#!/usr/bin/env node
/**
 * Backfill missing founder Pro grants.
 *
 * Dry run (default):
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-founder-pro-grants.mjs
 *
 * Apply after explicit approval:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/backfill-founder-pro-grants.mjs --apply --confirm=backfill-founder-pro-grants
 *
 * Auth: uses ADC OAuth through gcloud and Firestore/Identity Toolkit REST.
 * The script never prints access tokens or raw emails; per-user output uses a
 * stable SHA-256 prefix for reconciliation without exposing PII.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const APPLY = process.argv.includes("--apply");
const CONFIRM = process.argv.includes("--confirm=backfill-founder-pro-grants");
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE_SIZE = 300;
const FOUNDER_BETA_MONTHS = 1;

if (!PROJECT_ID) {
  throw new Error(
    "Missing project id. Set GCLOUD_PROJECT=marblo-2253d before running.",
  );
}

function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }

  return execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const token = getAccessToken();

function hashEmail(email) {
  return crypto.createHash("sha256").update(email).digest("hex").slice(0, 10);
}

function addMonths(base, months) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function firestoreUrl(documentPath) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${documentPath}`;
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
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
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

function documentData(doc) {
  return Object.fromEntries(
    Object.entries(doc.fields || {}).map(([key, value]) => [
      key,
      fromFirestoreValue(value),
    ]),
  );
}

function docId(name) {
  return name.split("/").at(-1) || name;
}

function toTimestampField(date) {
  return { timestampValue: date.toISOString() };
}

function toStringField(value) {
  return { stringValue: value };
}

function toBooleanField(value) {
  return { booleanValue: value };
}

function resolveWindowEnd(founder) {
  const betaEnd = founder.betaExpiresAt instanceof Date ? founder.betaExpiresAt : null;
  const proEnd = founder.proExpiresAt instanceof Date ? founder.proExpiresAt : null;
  if (betaEnd && proEnd) return betaEnd > proEnd ? betaEnd : proEnd;
  if (betaEnd || proEnd) return betaEnd || proEnd;

  const accessGrantedAt =
    founder.accessGrantedAt instanceof Date ? founder.accessGrantedAt : null;
  return accessGrantedAt ? addMonths(accessGrantedAt, FOUNDER_BETA_MONTHS) : null;
}

function hasPaymentEvidence(sub) {
  if (!sub) return false;
  return Boolean(
    sub.tossBillingKey ||
      sub.tossCustomerKey ||
      sub.paddleSubscriptionId ||
      sub.paymentProvider === "toss" ||
      sub.paymentProvider === "paddle",
  );
}

function isFounderGrantSubscription(sub) {
  if (!sub) return false;
  return sub.founderGrant === true || sub.paymentProvider === "founder_grant";
}

function isLivePaidSubscription(sub) {
  if (!sub || isFounderGrantSubscription(sub)) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  return hasPaymentEvidence(sub);
}

async function listCollection(path) {
  const docs = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await fetchJson(`${firestoreUrl(path)}?${params.toString()}`);
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function lookupUserByEmail(email) {
  const json = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID,
    )}/accounts:lookup`,
    {
      method: "POST",
      body: JSON.stringify({ email: [email] }),
    },
  );
  return (json.users || [])[0] || null;
}

async function getSubscription(uid) {
  try {
    const doc = await fetchJson(firestoreUrl(`subscriptions/${encodeURIComponent(uid)}`));
    return documentData(doc);
  } catch (err) {
    if (String(err.message || err).startsWith("404 ")) return null;
    throw err;
  }
}

function computePlan(founderDoc, authUser, sub) {
  const founder = documentData(founderDoc);
  const email = String(founder.email || docId(founderDoc.name)).trim().toLowerCase();
  const uid = authUser?.localId || null;
  const windowEnd = resolveWindowEnd(founder);
  const existingEnd =
    sub?.currentPeriodEnd instanceof Date ? sub.currentPeriodEnd : null;
  const periodEnd =
    existingEnd && windowEnd && existingEnd > windowEnd ? existingEnd : windowEnd;

  if (founder.status !== "selected" || !founder.accessGrantedAt) {
    return { action: "skip", reason: "not_selected", email, uid, windowEnd };
  }
  if (!uid) return { action: "skip", reason: "missing_auth", email, uid, windowEnd };
  if (typeof founder.proSubscriptionUid === "string" && founder.proSubscriptionUid) {
    return { action: "skip", reason: "already_materialized", email, uid, windowEnd };
  }
  if (!windowEnd || windowEnd <= new Date()) {
    return { action: "skip", reason: "window_expired", email, uid, windowEnd };
  }
  if (isFounderGrantSubscription(sub)) {
    return { action: "skip", reason: "already_granted", email, uid, windowEnd };
  }
  if (isLivePaidSubscription(sub)) {
    return { action: "skip", reason: "live_paid_guard", email, uid, windowEnd };
  }

  return {
    action: "grant",
    email,
    uid,
    windowEnd,
    periodEnd,
    hadSubscription: Boolean(sub),
    hadPaymentEvidence: hasPaymentEvidence(sub),
  };
}

async function patchDocument(path, fields) {
  const url = new URL(firestoreUrl(path));
  for (const key of Object.keys(fields)) {
    url.searchParams.append("updateMask.fieldPaths", key);
  }
  await fetchJson(url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

async function applyGrant(plan) {
  const now = new Date();
  await patchDocument(`subscriptions/${encodeURIComponent(plan.uid)}`, {
    userId: toStringField(plan.uid),
    // ★team — 이 스크립트는 founder_backfill grant 경로다. src/grantPlan.ts 의
    // TEAM_GRANT_REASONS 와 같은 규칙(베타/파운더 grant 는 협업·멤버 기능이
    // 열리는 team). 여기만 pro 로 남으면 부여 경로별로 플랜이 갈린다.
    planType: toStringField("team"),
    status: toStringField("active"),
    paymentProvider: toStringField("founder_grant"),
    founderGrant: toBooleanField(true),
    founderGrantReason: toStringField("founder_backfill"),
    founderGrantStartedAt: toTimestampField(now),
    currentPeriodEnd: toTimestampField(plan.periodEnd),
    currentPeriodStart: toTimestampField(now),
    updatedAt: toTimestampField(now),
  });

  await patchDocument(`founders/${encodeURIComponent(plan.email)}`, {
    proSubscriptionUid: toStringField(plan.uid),
    proSubscriptionEnd: toTimestampField(plan.periodEnd),
    proSubscriptionGrantedAt: toTimestampField(now),
  });
}

async function main() {
  const founders = await listCollection("founders");
  const plans = [];
  const skipped = new Map();

  for (const founderDoc of founders) {
    const founder = documentData(founderDoc);
    const email = String(founder.email || docId(founderDoc.name)).trim().toLowerCase();
    const authUser = email ? await lookupUserByEmail(email) : null;
    const sub = authUser?.localId ? await getSubscription(authUser.localId) : null;
    const plan = computePlan(founderDoc, authUser, sub);
    if (plan.action === "grant") {
      plans.push(plan);
    } else {
      skipped.set(plan.reason, (skipped.get(plan.reason) || 0) + 1);
    }
  }

  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        dryRun: !APPLY,
        foundersScanned: founders.length,
        grantsToMaterialize: plans.length,
        skipped: Object.fromEntries([...skipped.entries()].sort()),
        grants: plans.map((plan) => ({
          key: hashEmail(plan.email),
          windowEnd: plan.windowEnd.toISOString(),
          periodEnd: plan.periodEnd.toISOString(),
          hadSubscription: plan.hadSubscription,
          hadPaymentEvidence: plan.hadPaymentEvidence,
        })),
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log("DRY RUN - no writes. Add --apply --confirm=backfill-founder-pro-grants after approval.");
    return;
  }

  if (!CONFIRM) {
    throw new Error("Refusing to write without --confirm=backfill-founder-pro-grants.");
  }

  for (const plan of plans) {
    await applyGrant(plan);
  }
  console.log(`Applied founder Pro grant backfill to ${plans.length} user(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
