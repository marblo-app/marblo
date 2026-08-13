#!/usr/bin/env node
/**
 * 기존 베타/파운더 grant 를 planType=pro → team 으로 올린다.
 *
 * 왜: 협업·멤버 기능(PLAN_FEATURES "team_members")은 team 부터 열린다. 신규
 * 부여는 src/grantPlan.ts 가 team 을 주도록 바뀌었지만, 이미 pro 로 받은
 * grantee 는 그대로 남아 팀 기능을 못 쓴다. 이 스크립트가 그 격차를 메운다.
 *
 * ★범위: founderGrant===true 인 구독만. 유료 결제 구독은 절대 건드리지 않는다
 * (스캔 단계에서 결제 흔적/현역 유료를 명시적으로 배제하고 그 이유를 집계한다).
 *
 * Dry run (기본 — 아무것도 쓰지 않는다):
 *   GCLOUD_PROJECT=marblo-2253d node scripts/migrate-founder-grants-to-team.mjs
 *
 * 승인 후 실제 적용:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/migrate-founder-grants-to-team.mjs \
 *     --apply --confirm=migrate-founder-grants-to-team
 *
 * Auth: backfill-founder-pro-grants.mjs 와 동일하게 ADC OAuth + Firestore REST.
 * 액세스 토큰·이메일 원문은 절대 출력하지 않는다. 유저 식별은 uid 의 안정적인
 * SHA-256 접두사로만 보고한다(대사 가능, PII 노출 없음).
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const APPLY = process.argv.includes("--apply");
const CONFIRM = process.argv.includes(
  "--confirm=migrate-founder-grants-to-team",
);
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE_SIZE = 300;

/** 이 스크립트가 부여하는 목표 플랜. src/grantPlan.ts TEAM_GRANT_PLAN 과 동일. */
const TARGET_PLAN = "team";
/** team 으로 올릴 대상 플랜. 이미 team 이상은 건드리지 않는다. */
const MIGRATABLE_PLANS = new Set(["pro"]);

// ★프로젝트 확인·토큰 발급은 main() 안에서만 한다(모듈 로드 시점이 아니라).
// classify() 를 테스트에서 import 할 수 있어야 하기 때문이다 — 이 스크립트의
// 안전장치("유료 구독은 절대 건드리지 않는다")는 주장이 아니라 검증 대상이어야
// 한다. migrate-founder-grants-to-team.test.mjs 가 그 표를 돌린다.
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

function hashId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
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

function toStringField(value) {
  return { stringValue: value };
}

function toTimestampField(date) {
  return { timestampValue: date.toISOString() };
}

// ── 판정(index.ts / backfill 스크립트와 동일 규칙) ──────────────────────────

function hasPaymentEvidence(sub) {
  if (!sub) return false;
  return Boolean(
    sub.tossBillingKey ||
    sub.tossCustomerKey ||
    sub.paddleSubscriptionId ||
    sub.portoneBillingKey ||
    sub.paymentProvider === "toss" ||
    sub.paymentProvider === "paddle" ||
    sub.paymentProvider === "portone",
  );
}

function isFounderGrantSubscription(sub) {
  if (!sub) return false;
  return sub.founderGrant === true || sub.paymentProvider === "founder_grant";
}

/**
 * 이 구독을 team 으로 올릴 것인가.
 *
 * ★게이트 순서가 곧 안전장치다. founderGrant 확인을 가장 먼저 두어, 그 뒤의
 * 어떤 판단도 유료 구독에는 도달하지 못하게 한다.
 */
export function classify(sub) {
  if (!isFounderGrantSubscription(sub)) {
    return { action: "skip", reason: "not_a_grant" };
  }
  // 무료 grant 인데 결제 흔적이 남아있는 문서(과거 stomp 잔재)는 자동 처리하지
  // 않고 사람이 보게 남긴다 — 무료/유료 정체성이 섞인 문서라 위험하다.
  if (hasPaymentEvidence(sub) && sub.paymentProvider !== "founder_grant") {
    return { action: "skip", reason: "grant_with_payment_evidence_manual" };
  }
  const planType = typeof sub.planType === "string" ? sub.planType : "";
  if (planType === TARGET_PLAN) {
    return { action: "skip", reason: "already_team" };
  }
  if (!MIGRATABLE_PLANS.has(planType)) {
    // free 로 강등된 만료 grant, team_plus 등. 승격 대상이 아니다.
    return {
      action: "skip",
      reason: `plan_not_migratable:${planType || "none"}`,
    };
  }
  return { action: "migrate" };
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

/**
 * planType 만 바꾼다. 기간(currentPeriodEnd)·status·founderGrant* 마커는 그대로
 * 둔다 — 이 마이그레이션은 "무엇을 주는가"만 바꾸지 "얼마나 오래"는 안 바꾼다.
 * updateMask 로 두 필드만 지정하므로 나머지 필드는 손대지 않는다.
 */
async function applyMigration(uid) {
  await patchDocument(`subscriptions/${encodeURIComponent(uid)}`, {
    planType: toStringField(TARGET_PLAN),
    updatedAt: toTimestampField(new Date()),
  });
}

async function main() {
  if (!PROJECT_ID) {
    throw new Error(
      "Missing project id. Set GCLOUD_PROJECT=marblo-2253d before running.",
    );
  }
  token = getAccessToken();

  const docs = await listCollection("subscriptions");
  const targets = [];
  const skipped = new Map();
  // 사람이 직접 판단해야 하는 문서는 개수만 세지 않고 근거까지 남긴다 —
  // 승인자가 "1건 스킵" 만 보고는 아무 결정도 못 한다.
  const manualReview = [];

  for (const doc of docs) {
    const uid = docId(doc.name);
    const sub = documentData(doc);
    const verdict = classify(sub);
    if (verdict.reason === "grant_with_payment_evidence_manual") {
      manualReview.push({
        key: hashId(uid),
        planType: sub.planType ?? null,
        status: sub.status ?? null,
        paymentProvider: sub.paymentProvider ?? null,
        grantReason:
          typeof sub.founderGrantReason === "string"
            ? sub.founderGrantReason
            : null,
        // 키 원문은 절대 출력하지 않는다 — 존재 여부만.
        hasTossBillingKey: Boolean(sub.tossBillingKey),
        hasTossCustomerKey: Boolean(sub.tossCustomerKey),
        hasPaddleSubscriptionId: Boolean(sub.paddleSubscriptionId),
        hasPortoneBillingKey: Boolean(sub.portoneBillingKey),
        periodEnd:
          sub.currentPeriodEnd instanceof Date
            ? sub.currentPeriodEnd.toISOString()
            : null,
      });
    }
    if (verdict.action === "migrate") {
      targets.push({
        key: hashId(uid),
        fromPlan: sub.planType,
        status: sub.status ?? null,
        grantReason:
          typeof sub.founderGrantReason === "string"
            ? sub.founderGrantReason
            : null,
        periodEnd:
          sub.currentPeriodEnd instanceof Date
            ? sub.currentPeriodEnd.toISOString()
            : null,
        _uid: uid,
      });
    } else {
      skipped.set(verdict.reason, (skipped.get(verdict.reason) || 0) + 1);
    }
  }

  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        dryRun: !APPLY,
        targetPlan: TARGET_PLAN,
        subscriptionsScanned: docs.length,
        grantsToMigrate: targets.length,
        skipped: Object.fromEntries([...skipped.entries()].sort()),
        manualReview,
        migrations: targets.map(({ _uid, ...row }) => row),
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log(
      "DRY RUN - no writes. Add --apply --confirm=migrate-founder-grants-to-team after approval.",
    );
    return;
  }

  if (!CONFIRM) {
    throw new Error(
      "Refusing to write without --confirm=migrate-founder-grants-to-team.",
    );
  }

  for (const target of targets) {
    await applyMigration(target._uid);
  }
  console.log(`Migrated ${targets.length} founder grant(s) to ${TARGET_PLAN}.`);
}

// 테스트가 import 할 때는 실행하지 않는다 — 직접 실행(node scripts/...)일 때만.
const invokedDirectly =
  process.argv[1] &&
  process.argv[1].endsWith("migrate-founder-grants-to-team.mjs");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
