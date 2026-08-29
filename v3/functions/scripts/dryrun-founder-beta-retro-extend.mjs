#!/usr/bin/env node
/**
 * 베타 1개월 → 3개월 소급 연장 **드라이런**.
 *
 * 사장님 지시(티켓 WTy5dfUmGGfJJa4GBAMA): 30일에 만료된 파운더를 되살릴지는
 * 승인 사안이다. 이 스크립트는 **읽기 전용**이다 — `--apply` 플래그가 아예 없고
 * Firestore 에 대한 쓰기 호출(PATCH/POST)을 하나도 하지 않는다. 승인이 나면
 * 별도 스크립트를 만들되, 그때도 backfill-founder-pro-grants.mjs 와 같은
 * `--apply --confirm=` 이중 게이트를 달아야 한다.
 *
 * 실행:
 *   GCLOUD_PROJECT=marblo-2253d node scripts/dryrun-founder-beta-retro-extend.mjs
 *
 * Auth: gcloud ADC OAuth + Firestore REST. 원문 이메일은 절대 출력하지 않고
 * SHA-256 앞 10자만 쓴다(backfill-founder-pro-grants.mjs 와 같은 규칙).
 *
 * ─── 무엇을 계산하나 ──────────────────────────────────────────────────
 * "구 정책(accessGrantedAt + 1개월)으로 창이 닫힌 파운더에게 새 정책
 * (accessGrantedAt + 3개월)을 적용하면 무엇이 어떻게 바뀌는가"를 분류한다.
 *
 * ★대상 판정은 upsertProSubscription 의 보호 규칙을 **그대로** 복제한다.
 *   · 현역 유료 구독(active/past_due + 결제 흔적)은 제외 — 덮어쓰면 과금이 끊긴다.
 *   · 기존 만료일이 새 목표보다 뒤면 제외 — 기간을 줄이는 부여는 없다(max 규칙).
 *   · founderGrant 가 아닌 구독은 grant 로 오인하지 않는다.
 * 이 규칙을 여기서 다르게 쓰면 드라이런 숫자가 실제 실행과 어긋나 판단 근거가
 * 되지 못한다.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE_SIZE = 300;

/** 구 정책 — 이 값으로 창이 닫혔다. */
const OLD_BETA_MONTHS = 1;
/** 새 정책 — src/founderLadder.ts 의 FOUNDER_BETA_MONTHS 와 같아야 한다. */
const NEW_BETA_MONTHS = 3;
/** 소급 실행 시 박을 사유 마커. 나중에 코호트에서 분리하기 위한 것. */
const RETRO_REASON = "beta_window_retro_extend_2026_08";

if (!PROJECT_ID) {
  throw new Error(
    "Missing project id. Set GCLOUD_PROJECT=marblo-2253d before running."
  );
}

function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }
  return execFileSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  ).trim();
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
    PROJECT_ID
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
      ])
    );
  }
  return undefined;
}

function documentData(doc) {
  return Object.fromEntries(
    Object.entries(doc.fields || {}).map(([key, value]) => [
      key,
      fromFirestoreValue(value),
    ])
  );
}

function docId(name) {
  return name.split("/").at(-1) || name;
}

// ─── upsertProSubscription 의 보호 규칙 복제 ─────────────────────────
// src/index.ts 의 hasPaymentEvidence / isLivePaidSubscription 과 동일해야 한다.

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
      sub.paymentProvider === "portone"
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
      PROJECT_ID
    )}/accounts:lookup`,
    { method: "POST", body: JSON.stringify({ email: [email] }) }
  );
  return (json.users || [])[0] || null;
}

async function getSubscription(uid) {
  try {
    const doc = await fetchJson(
      firestoreUrl(`subscriptions/${encodeURIComponent(uid)}`)
    );
    return documentData(doc);
  } catch (err) {
    if (String(err.message || err).startsWith("404 ")) return null;
    throw err;
  }
}

function iso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "-");
}

function days(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * 한 파운더에 대해 "소급하면 무슨 일이 일어나는가"를 판정한다.
 * 쓰기는 하지 않는다 — 판정만 돌려준다.
 */
function classify(founder, sub, now) {
  const accessGrantedAt =
    founder.accessGrantedAt instanceof Date ? founder.accessGrantedAt : null;
  const betaExpiresAt =
    founder.betaExpiresAt instanceof Date ? founder.betaExpiresAt : null;
  const proExpiresAt =
    founder.proExpiresAt instanceof Date ? founder.proExpiresAt : null;
  const existingEnd =
    sub?.currentPeriodEnd instanceof Date ? sub.currentPeriodEnd : null;

  if (founder.status === "rejected")
    return { action: "skip", reason: "rejected" };
  if (!accessGrantedAt) return { action: "skip", reason: "no_access_grant" };

  // 새 정책을 적용했을 때의 베타 창. pro 보상을 이미 받은 사람은 그쪽이 더 길다.
  const newBetaEnd = addMonths(accessGrantedAt, NEW_BETA_MONTHS);
  const oldBetaEnd =
    betaExpiresAt || addMonths(accessGrantedAt, OLD_BETA_MONTHS);
  const target =
    proExpiresAt && proExpiresAt > newBetaEnd ? proExpiresAt : newBetaEnd;

  // ★현역 유료 구독은 절대 건드리지 않는다(과금 중단 사고).
  if (isLivePaidSubscription(sub)) {
    return { action: "skip", reason: "live_paid_guard", oldBetaEnd, target };
  }
  // 새 창이 이미 지났으면 소급해도 되살아나지 않는다.
  if (target <= now) {
    return {
      action: "skip",
      reason: "still_expired_after_retro",
      oldBetaEnd,
      target,
    };
  }
  // 기간을 줄이는 부여는 없다(upsertProSubscription 의 max 규칙).
  if (existingEnd && existingEnd >= target) {
    return {
      action: "skip",
      reason: "already_longer",
      oldBetaEnd,
      target,
      existingEnd,
    };
  }
  // 아직 안 끊긴 사람 — 되살리는 게 아니라 연장이다. 구분해서 센다.
  const wasCutOff = !existingEnd || existingEnd <= now;
  return {
    action: wasCutOff ? "revive" : "extend",
    oldBetaEnd,
    target,
    existingEnd,
    addedDays: existingEnd ? days(existingEnd, target) : days(now, target),
  };
}

async function main() {
  const now = new Date();
  console.log("═".repeat(72));
  console.log("베타 소급 연장 드라이런 (READ-ONLY — 쓰기 호출 없음)");
  console.log(
    `project=${PROJECT_ID} db=${DATABASE_ID} now=${now.toISOString()}`
  );
  console.log(`정책: ${OLD_BETA_MONTHS}개월 → ${NEW_BETA_MONTHS}개월`);
  console.log(`소급 시 사유 마커: founderGrantReason="${RETRO_REASON}"`);
  console.log("═".repeat(72));

  const founderDocs = await listCollection("founders");
  console.log(`founders 문서: ${founderDocs.length}건\n`);

  const buckets = new Map();
  const rows = [];

  for (const doc of founderDocs) {
    const founder = documentData(doc);
    const email = String(founder.email || docId(doc.name))
      .trim()
      .toLowerCase();
    let sub = null;
    let uid =
      typeof founder.proSubscriptionUid === "string"
        ? founder.proSubscriptionUid
        : null;
    if (!uid) {
      const authUser = await lookupUserByEmail(email).catch(() => null);
      uid = authUser?.localId || null;
    }
    if (uid) sub = await getSubscription(uid);

    const verdict = classify(founder, sub, now);
    const bucket =
      verdict.action === "skip" ? `skip:${verdict.reason}` : verdict.action;
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    rows.push({
      id: hashEmail(email),
      uid: uid ? uid.slice(0, 6) : "-",
      ...verdict,
    });
  }

  console.log("── 분류 요약 ──────────────────────────────────────────────");
  for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  const actionable = rows.filter((r) => r.action !== "skip");
  console.log(
    `\n── 소급 대상 상세 (${actionable.length}건) ─────────────────────`
  );
  console.log(
    "  id          uid     action   기존만료     →  소급후만료   +일수"
  );
  for (const r of actionable.sort((a, b) => b.addedDays - a.addedDays)) {
    console.log(
      `  ${r.id}  ${r.uid.padEnd(6)}  ${r.action.padEnd(7)}  ` +
        `${iso(r.existingEnd).padEnd(11)} → ${iso(r.target).padEnd(11)}  ` +
        `+${r.addedDays}일`
    );
  }

  // ★"되살아남"을 계정 유무로 쪼갠다. 이 구분이 판단을 가른다:
  //   · 계정 O = subscriptions 문서가 실제로 있고 만료된 사람. 소급하면 구독이
  //     되살아나 **D30 코호트가 실제로 요동친다**. 오케가 센 26건이 여기 속한다.
  //   · 계정 X = 선정 메일은 받았지만 가입한 적이 없는 사람. 되살릴 구독 자체가
  //     없고 founders.betaExpiresAt 만 늘어난다. 나중에 가입하면 그때 부여된다.
  //     지표 영향이 없고, 성격상 "소급"이 아니라 "창을 열어두기"다.
  const reviveWithAccount = actionable.filter(
    (r) => r.action === "revive" && r.uid !== "-"
  ).length;
  const reviveNoAccount = actionable.filter(
    (r) => r.action === "revive" && r.uid === "-"
  ).length;
  const extend = actionable.filter((r) => r.action === "extend").length;
  console.log("\n── 판단 재료 ──────────────────────────────────────────────");
  console.log(
    `  되살아남 · 계정 O: ${reviveWithAccount}명 — ★구독이 실제로 부활. D30 코호트가 요동칠 인원`
  );
  console.log(
    `  되살아남 · 계정 X: ${reviveNoAccount}명 — 가입 이력 없음. 되살릴 구독이 없어 지표 영향 없음`
  );
  console.log(`  단순 연장(아직 살아있음): ${extend}명 — 지표 영향 작음`);
  console.log(
    `  현역 유료 보호로 제외:    ${buckets.get("skip:live_paid_guard") || 0}명`
  );
  console.log(
    `  소급해도 이미 만료:       ${
      buckets.get("skip:still_expired_after_retro") || 0
    }명`
  );
  console.log(
    `  이미 더 긴 기간 보유:     ${buckets.get("skip:already_longer") || 0}명`
  );
  console.log("\n★실행하지 않았다. 승인 후 별도 apply 스크립트가 필요하다.");
}

main().catch((err) => {
  console.error("드라이런 실패:", err.message || err);
  process.exit(1);
});
