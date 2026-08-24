#!/usr/bin/env node
/**
 * 이탈 사유 청취 메일 발송 경로(로컬 운영 스크립트) — 티켓 qcwgC4h3XPm2IZQrhntq.
 *
 * send-release-announcement.ts 와 같은 규약이다: Cloud Function 신규 배포 대신
 * 로컬 실행으로 간다(1회성 캠페인에 배포 리스크를 얹지 않는다). 인증은
 * backfill-founder-pro-grants.mjs 와 동일하게 ADC OAuth + REST.
 *
 * 미리보기(기본 — 0통 발송):
 *   GCLOUD_PROJECT=marblo-2253d npm run outreach:churn
 *   GCLOUD_PROJECT=marblo-2253d npm run outreach:churn -- --consent-basis=relationship
 *
 * 실발송(★사장님/오케 승인 후에만):
 *   GCLOUD_PROJECT=marblo-2253d npm run outreach:churn -- \
 *     --consent-basis=relationship --send --confirm=SEND-CHURN-INTERVIEW-2026-08
 *
 * 안전 규약:
 *  - 기본이 dry-run 이다. --send 와 --confirm 이 **둘 다** 있어야 발송한다.
 *  - 수신동의 철회자는 어떤 플래그로도 통과하지 못한다.
 *  - `--consent-basis` 기본값은 `granted_only` 다. pending 까지 보내려면
 *    호출자가 `relationship` 을 **명시**해야 한다 — 조용히 넓어지는 경로는 없다.
 *  - 결제 흔적이 있는 구독은 대상에서 빠진다(그랜트가 결제를 덮어쓰는 사고 방지).
 *  - 실효 연장이 0일인 사람은 빠진다 — "3개월"이라 써놓고 0일을 주지 않는다.
 *  - 발송 성공 건만 founders 문서에 스탬프(재실행 시 중복 방지).
 *  - PII·시크릿 미출력: 이메일은 마스킹, uid 는 sha256 앞 8자리, 토큰/API 키는
 *    어떤 경로로도 찍지 않는다.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  contactIdForEmail,
  normalizeMarketingEmail,
  buildUnsubscribeUrl,
} from "../src/marketingContacts";
import {
  CHURN_INTERVIEW_CONFIRM,
  CHURN_INTERVIEW_COOLDOWN_DAYS,
  CHURN_INTERVIEW_SENT_AT_FIELD,
  CHURN_INTERVIEW_SENT_FIELD,
  CHURN_OFFER_MONTHS,
  buildChurnInterviewEmail,
  selectChurnAudience,
  type ChurnAudienceCandidate,
  type ChurnEmailContent,
  type ChurnOutreachFacts,
  type ChurnOutreachLocale,
  type ConsentBasis,
} from "../src/churnOutreach";

// ─── CLI 인자 ────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const has = (flag: string): boolean => ARGV.includes(flag);
const valueOf = (name: string): string | null => {
  const hit = ARGV.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const SEND = has("--send");
const CONFIRM_OK = valueOf("--confirm") === CHURN_INTERVIEW_CONFIRM;
const PRINT_HTML = has("--print-html");
const CONSENT_BASIS_RAW = valueOf("--consent-basis") ?? "granted_only";
if (
  CONSENT_BASIS_RAW !== "granted_only" &&
  CONSENT_BASIS_RAW !== "relationship"
) {
  throw new Error(
    `--consent-basis 는 granted_only | relationship 만 허용한다: ${CONSENT_BASIS_RAW}`,
  );
}
const CONSENT_BASIS: ConsentBasis = CONSENT_BASIS_RAW;
const COOLDOWN_DAYS = Number(
  valueOf("--cooldown-days") ?? CHURN_INTERVIEW_COOLDOWN_DAYS,
);
if (!Number.isFinite(COOLDOWN_DAYS) || COOLDOWN_DAYS < 0) {
  throw new Error("--cooldown-days 는 0 이상이어야 한다");
}

/** functions 패키지 루트(컴파일 산출물 깊이와 무관하게 찾는다). */
function resolveFunctionsDir(): string {
  for (const start of [process.cwd(), __dirname]) {
    let dir = path.resolve(start);
    for (let depth = 0; depth < 8; depth++) {
      const pkg = path.join(dir, "package.json");
      if (existsSync(pkg)) {
        try {
          const parsed = JSON.parse(readFileSync(pkg, "utf8")) as {
            name?: string;
          };
          if (parsed.name === "marblo-functions") return dir;
        } catch {
          // 파싱 실패는 무시하고 계속 올라간다.
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

const FUNCTIONS_DIR = resolveFunctionsDir();
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "marblo-2253d";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const BQ_DATASET = "marblo_telemetry";
const BQ_COST_TABLE = "cost_logs";
const BQ_LOCATION = process.env.BQ_LOCATION || "US";
const SEND_INTERVAL_MS = 250;

// ─── env 로드 — 값은 절대 출력하지 않는다 ─────────────────────────────
function loadEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ENV_FILE =
  valueOf("--env-file") ?? path.join(FUNCTIONS_DIR, `.env.${PROJECT_ID}`);
const FILE_ENV = loadEnvFile(ENV_FILE);
const envOf = (key: string): string => process.env[key] || FILE_ENV[key] || "";

const RESEND_API_KEY = envOf("RESEND_API_KEY");
const FROM_EMAIL = envOf("FOUNDER_FROM_EMAIL") || "team@marblo.app";
const FROM_NAME = envOf("FOUNDER_FROM_NAME") || "Marblo";
const REPLY_TO = envOf("FOUNDER_REPLY_TO") || "team@marblo.app";
const MARKETING_UNSUB_SECRET = envOf("MARKETING_UNSUB_SECRET");
const FUNCTIONS_BASE_URL =
  envOf("FUNCTIONS_BASE_URL") ||
  `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
const ADMIN_UID = envOf("ADMIN_UID");

// ─── ADC REST ────────────────────────────────────────────────────────
let cachedToken: string | null = null;
function accessToken(): string {
  if (cachedToken) return cachedToken;
  cachedToken =
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN ||
    execFileSync(
      "gcloud",
      ["auth", "application-default", "print-access-token"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  return cachedToken;
}

function redactUrl(url: string): string {
  const q = url.indexOf("?");
  const base = q >= 0 ? url.slice(0, q) : url;
  return base.replace(/\/[^/]+$/, "/***");
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "x-goog-user-project": PROJECT_ID,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    // 본문에 토큰/이메일이 섞일 수 있어 상태코드만 노출한다.
    throw new Error(`${res.status} ${res.statusText} @ ${redactUrl(url)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function firestoreUrl(documentPath: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${documentPath}`;
}

type FirestoreValue = Record<string, unknown>;

function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value)
    return new Date(value.timestampValue as string);
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    const arr =
      (value.arrayValue as { values?: FirestoreValue[] }).values || [];
    return arr.map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    const fields =
      (value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ||
      {};
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, fromFirestoreValue(v)]),
    );
  }
  return undefined;
}

interface FirestoreDoc {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

function documentData(doc: FirestoreDoc): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(doc.fields || {}).map(([k, v]) => [
      k,
      fromFirestoreValue(v),
    ]),
  );
}

async function getDoc(
  documentPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const doc = (await fetchJson(
      firestoreUrl(documentPath),
    )) as unknown as FirestoreDoc;
    return documentData(doc);
  } catch (err) {
    if (String((err as Error).message).startsWith("404 ")) return null;
    throw err;
  }
}

async function listCollection(collection: string): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "300" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await fetchJson(`${firestoreUrl(collection)}?${params}`);
    docs.push(...((json.documents as FirestoreDoc[]) || []));
    pageToken = (json.nextPageToken as string) || "";
  } while (pageToken);
  return docs;
}

// ─── 로그 위생 ───────────────────────────────────────────────────────
const uidHashOf = (uid: string): string =>
  createHash("sha256").update(uid).digest("hex").slice(0, 8);

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.length <= 1 ? "*" : `${local[0]}***`;
  return `${head}@${domain}`;
}

const toMillis = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

// ─── 사용량(BigQuery cost_logs) ──────────────────────────────────────
interface UsageRow {
  uid: string;
  totalTokens: number;
  costUsd: number;
  lastUsageAtMs: number | null;
}

/**
 * cost_logs 는 **원시 uid** 를 보관하는 유일한 원장이다(분석 표의 user_key 는
 * 가명이라 연락에 못 쓴다). 여기서 uid 를 얻어 Auth·Firestore 와 잇는다.
 */
async function loadUsage(): Promise<UsageRow[]> {
  const query = `
    SELECT userId,
           SUM(inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens) AS totalTokens,
           SUM(totalCost) AS costUsd,
           MAX(timestamp) AS lastUsageAt
    FROM \`${PROJECT_ID}.${BQ_DATASET}.${BQ_COST_TABLE}\`
    GROUP BY userId
    ORDER BY totalTokens DESC
  `;
  const json = await fetchJson(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
      PROJECT_ID,
    )}/queries`,
    {
      method: "POST",
      body: JSON.stringify({
        query,
        useLegacySql: false,
        location: BQ_LOCATION,
        timeoutMs: 60_000,
      }),
    },
  );
  if (json.jobComplete === false) {
    throw new Error("BigQuery 쿼리가 시간 내에 끝나지 않았다 — 재시도해라.");
  }
  const rows = (json.rows as Array<{ f: Array<{ v: string | null }> }>) || [];
  return rows.map((r) => ({
    uid: r.f[0]?.v ?? "",
    totalTokens: Number(r.f[1]?.v ?? 0),
    costUsd: Number(r.f[2]?.v ?? 0),
    lastUsageAtMs: r.f[3]?.v ? Number(r.f[3].v) * 1000 : null,
  }));
}

interface AuthUser {
  localId: string;
  email?: string;
  emailVerified?: boolean;
  lastLoginAt?: string;
  lastRefreshAt?: string;
  disabled?: boolean;
}

async function lookupAuthUsers(uids: string[]): Promise<Map<string, AuthUser>> {
  if (uids.length === 0) return new Map();
  const json = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID,
    )}/accounts:lookup`,
    { method: "POST", body: JSON.stringify({ localId: uids }) },
  );
  const users = (json.users as AuthUser[]) || [];
  return new Map(users.map((u) => [u.localId, u]));
}

// ─── 후보 수집 ───────────────────────────────────────────────────────
interface Collected {
  candidates: ChurnAudienceCandidate[];
  scannedUsers: number;
  operatorExcluded: number;
  noFounderDoc: number;
}

async function collectCandidates(): Promise<Collected> {
  const usage = await loadUsage();
  const scannedUsers = usage.length;

  // 운영자(ADMIN_UID)는 모수에서 뺀다. ★값은 어디에도 출력하지 않는다.
  const nonOperator = usage.filter((u) => u.uid && u.uid !== ADMIN_UID);
  const operatorExcluded = scannedUsers - nonOperator.length;

  const authByUid = await lookupAuthUsers(nonOperator.map((u) => u.uid));

  // founders 는 이메일이 doc id 다. uid 로도 이을 수 있게 양방향 색인을 만든다.
  const founderDocs = await listCollection("founders");
  const founderByEmail = new Map<
    string,
    { docId: string; data: Record<string, unknown> }
  >();
  const founderByUid = new Map<
    string,
    { docId: string; data: Record<string, unknown> }
  >();
  for (const doc of founderDocs) {
    const docId = doc.name.split("/").pop() || doc.name;
    const data = documentData(doc);
    const email = normalizeMarketingEmail(
      typeof data.email === "string" ? data.email : docId,
    );
    const entry = { docId, data };
    founderByEmail.set(email, entry);
    const uid =
      typeof data.proSubscriptionUid === "string"
        ? data.proSubscriptionUid
        : typeof data.userId === "string"
          ? data.userId
          : "";
    if (uid) founderByUid.set(uid, entry);
  }

  const candidates: ChurnAudienceCandidate[] = [];
  let noFounderDoc = 0;

  for (const u of nonOperator) {
    const auth = authByUid.get(u.uid);
    const email = auth?.email ? normalizeMarketingEmail(auth.email) : "";
    const founder =
      founderByUid.get(u.uid) ??
      (email ? founderByEmail.get(email) : undefined);
    if (!founder) {
      // founders 문서가 없으면 스탬프를 찍을 곳이 없다 → 중복 발송을 못 막는다.
      noFounderDoc++;
      continue;
    }

    const sub = await getDoc(`subscriptions/${encodeURIComponent(u.uid)}`);
    const contact = email
      ? await getDoc(`marketing_contacts/${contactIdForEmail(email)}`)
      : null;

    const consent = (contact?.emailMarketingConsent ?? null) as {
      status?: string;
    } | null;
    const unsub = (contact?.unsubscribe ?? null) as { status?: string } | null;

    const lastSeenAtMs = Math.max(
      Number(auth?.lastLoginAt ?? 0),
      auth?.lastRefreshAt ? new Date(auth.lastRefreshAt).getTime() : 0,
    );

    const facts: ChurnOutreachFacts = {
      hasEmail: Boolean(email) && auth?.disabled !== true,
      totalTokens: u.totalTokens,
      lastUsageAtMs: u.lastUsageAtMs,
      lastSeenAtMs: lastSeenAtMs > 0 ? lastSeenAtMs : null,
      marketingConsentStatus:
        consent?.status === "granted" ||
        consent?.status === "pending" ||
        consent?.status === "revoked"
          ? consent.status
          : null,
      unsubscribeStatus:
        unsub?.status === "unsubscribed" || unsub?.status === "subscribed"
          ? unsub.status
          : null,
      currentPeriodEndMs: toMillis(sub?.currentPeriodEnd),
      subscriptionStatus:
        typeof sub?.status === "string" ? (sub.status as string) : null,
      hasPaymentEvidence: hasAnyPaymentEvidence(sub),
    };

    const localeRaw =
      (typeof founder.data.locale === "string" ? founder.data.locale : "") ||
      (typeof contact?.locale === "string" ? (contact.locale as string) : "");
    const locale: ChurnOutreachLocale = localeRaw.startsWith("en")
      ? "en"
      : "ko";

    candidates.push({
      docId: founder.docId,
      uidHash: uidHashOf(u.uid),
      email,
      locale,
      facts,
      lastSentAtMs: toMillis(founder.data[CHURN_INTERVIEW_SENT_AT_FIELD]),
    });
  }

  return { candidates, scannedUsers, operatorExcluded, noFounderDoc };
}

/**
 * 결제 흔적 — toss/paddle/portone 전부. ★index.ts hasPaymentEvidence 는
 * portone 을 보지 않는다(실측: portoneBillingKey 를 가진 현역 결제자가 "흔적
 * 없음"으로 판정된다). 이 캠페인은 그 사람에게 절대 그랜트를 넣으면 안 되므로
 * 여기서 넓게 본다. 근본 수정은 별도 티켓.
 */
function hasAnyPaymentEvidence(sub: Record<string, unknown> | null): boolean {
  if (!sub) return false;
  const keys = [
    "tossBillingKey",
    "tossCustomerKey",
    "paddleSubscriptionId",
    "portoneBillingKey",
    "portonePaymentId",
  ];
  for (const k of keys) {
    if (typeof sub[k] === "string" && sub[k]) return true;
  }
  return (
    sub.paymentProvider === "toss" ||
    sub.paymentProvider === "paddle" ||
    sub.paymentProvider === "portone"
  );
}

// ─── 발송 ────────────────────────────────────────────────────────────
interface UnsubscribeDelivery {
  /** "one_click"(RFC 8058 https) | "mailto"(RFC 2369 회신형). */
  kind: "one_click" | "mailto";
  headers: Record<string, string>;
  footerHtml: string;
  footerText: string;
}

/**
 * 수신거부 부속. 두 형태가 있고, **없는 경우는 없다**.
 *
 *  - one_click : MARKETING_UNSUB_SECRET 이 있을 때. index.ts
 *                marketingEmailDelivery 와 동일한 https 원클릭(RFC 8058).
 *  - mailto    : 시크릿이 없을 때의 폴백. List-Unsubscribe 는 mailto 도 정식으로
 *                허용한다(RFC 2369). 자동 처리는 안 되지만 team@marblo.app 수신함
 *                으로 오므로 사람이 처리할 수 있다.
 *
 * ★왜 폴백을 두는가: 실측 결과 MARKETING_UNSUB_SECRET 이 **프로덕션 어디에도
 * 설정돼 있지 않다**(unsubscribeMarketingEmail 함수 env 에도 없다). 원클릭만
 * 고집하면 대상 2명짜리 캠페인이 없는 인프라 때문에 멈춘다. 그렇다고 수신거부
 * 없이 보내는 건 동의 pending 대상에게 보낼 근거를 스스로 없애는 짓이다.
 * 그래서 "자동은 못 해도 경로는 반드시 준다"로 간다.
 */
function unsubscribeDelivery(email: string): UnsubscribeDelivery {
  if (MARKETING_UNSUB_SECRET && FUNCTIONS_BASE_URL) {
    const url = buildUnsubscribeUrl(
      FUNCTIONS_BASE_URL,
      contactIdForEmail(email),
      MARKETING_UNSUB_SECRET,
    );
    return {
      kind: "one_click",
      headers: {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      footerHtml: `<p style="font-size:12px;color:#999;margin:16px 0 0">더 이상 이런 메일을 원치 않으시면 <a href="${url}" style="color:#999">수신거부</a>를 눌러주세요. / <a href="${url}" style="color:#999">Unsubscribe</a></p>`,
      footerText: `\n\n수신거부(Unsubscribe): ${url}`,
    };
  }

  const mailto = `mailto:${REPLY_TO}?subject=${encodeURIComponent("수신거부")}`;
  return {
    kind: "mailto",
    headers: { "List-Unsubscribe": `<${mailto}>` },
    footerHtml: `<p style="font-size:12px;color:#999;margin:16px 0 0">더 이상 이런 메일을 원치 않으시면 이 메일에 "수신거부"라고만 답장해 주세요. / To unsubscribe, just reply with "unsubscribe".</p>`,
    footerText: `\n\n수신거부: 이 메일에 "수신거부"라고만 답장해 주세요. (Unsubscribe: reply with "unsubscribe")`,
  };
}

function withFooter(
  content: ChurnEmailContent,
  delivery: { footerHtml: string; footerText: string },
): ChurnEmailContent {
  const html = content.html.includes("</body>")
    ? content.html.replace("</body>", `${delivery.footerHtml}</body>`)
    : content.html + delivery.footerHtml;
  return {
    subject: content.subject,
    html,
    text: content.text + delivery.footerText,
  };
}

async function sendOne(
  email: string,
  content: ChurnEmailContent,
  headers?: Record<string, string>,
): Promise<boolean> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        reply_to: [REPLY_TO],
        to: [email],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      }),
    });
    if (!resp.ok) {
      console.warn(
        `[churn-outreach] resend HTTP ${resp.status} — ${maskEmail(email)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[churn-outreach] 발송 실패 ${maskEmail(email)}: ${(err as Error).message}`,
    );
    return false;
  }
}

async function stampSent(docId: string, sentAt: Date): Promise<void> {
  const mask =
    `?updateMask.fieldPaths=${CHURN_INTERVIEW_SENT_AT_FIELD}` +
    `&updateMask.fieldPaths=${CHURN_INTERVIEW_SENT_FIELD}`;
  await fetchJson(
    `${firestoreUrl(`founders/${encodeURIComponent(docId)}`)}${mask}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          [CHURN_INTERVIEW_SENT_AT_FIELD]: {
            timestampValue: sentAt.toISOString(),
          },
          [CHURN_INTERVIEW_SENT_FIELD]: { booleanValue: true },
        },
      }),
    },
  );
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ─── main ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const nowMs = Date.now();
  const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  console.log(
    `\n=== 이탈 사유 청취 메일 ${
      SEND ? "**실발송**" : "dry-run(발송 0통)"
    } ===`,
  );
  console.log(`project=${PROJECT_ID}  env=${path.basename(ENV_FILE)}`);
  console.log(
    `RESEND_API_KEY=${RESEND_API_KEY ? "set" : "MISSING"}  ` +
      `ADMIN_UID=${ADMIN_UID ? "set" : "MISSING"}  ` +
      `from=${FROM_EMAIL}  reply-to=${REPLY_TO}  ` +
      `unsubscribe=${
        MARKETING_UNSUB_SECRET
          ? "one-click(RFC 8058)"
          : "mailto 폴백(MARKETING_UNSUB_SECRET 미설정)"
      }`,
  );
  console.log(
    `consent-basis=${CONSENT_BASIS}  cooldown=${COOLDOWN_DAYS}일  offer=${CHURN_OFFER_MONTHS}개월`,
  );

  if (!ADMIN_UID) {
    throw new Error(
      "ADMIN_UID 미설정 — 운영자를 모수에서 뺄 수 없다. 사장님께 메일이 갈 수 있으므로 중단한다.",
    );
  }

  const { candidates, scannedUsers, operatorExcluded, noFounderDoc } =
    await collectCandidates();
  const result = selectChurnAudience(candidates, {
    nowMs,
    cooldownMs,
    consentBasis: CONSENT_BASIS,
  });

  console.log(`\n[대상 산출] cost_logs 사용자 ${scannedUsers}명`);
  console.log(`  운영자 제외              : ${operatorExcluded}`);
  console.log(`  founders 문서 없음 제외  : ${noFounderDoc}`);
  console.log(`  후보                     : ${candidates.length}명`);
  console.log(`  ★발송 대상               : ${result.eligible.length}명`);
  console.log(
    `  제외 사유 분포           : ${JSON.stringify(result.reasonCounts)}`,
  );
  console.log(`  쿨다운 제외              : ${result.cooledDown}`);
  console.log(`  실효 연장 0일 제외       : ${result.zeroValueGrant}`);

  console.log(
    `\n[발송 대상 상세] — uid 해시·마스킹 이메일만 (수신거부=${
      unsubscribeDelivery("preview@example.com").kind
    })`,
  );
  for (const e of result.eligible) {
    console.log(
      `  ${e.uidHash}  ${maskEmail(e.email)}  locale=${e.locale}  ` +
        `segment=${e.segment}  +${e.grant.addedDays}일 → ` +
        `${new Date(e.grant.projectedEndMs).toISOString().slice(0, 10)}`,
    );
  }
  if (result.excluded.length > 0) {
    console.log(`\n[제외 상세]`);
    for (const x of result.excluded) {
      console.log(
        `  ${x.uidHash}  ${x.reasons.join(", ") || "zero_value_grant"}`,
      );
    }
  }

  // ── 미리보기 ──
  const previewDir = path.join(FUNCTIONS_DIR, ".preview");
  mkdirSync(previewDir, { recursive: true });
  for (const segment of ["deep_churn", "light_trial"] as const) {
    const content = buildChurnInterviewEmail("ko", segment);
    const preview = withFooter(
      content,
      unsubscribeDelivery("preview@example.com"),
    );
    const file = path.join(previewDir, `churn-interview-${segment}.html`);
    writeFileSync(file, preview.html, "utf8");
    console.log(`\n[미리보기 ${segment}]`);
    console.log(`  제목: ${content.subject}`);
    console.log(`  HTML: ${file} (${preview.html.length} bytes)`);
    console.log(
      content.text
        .split("\n")
        .map((l) => `  | ${l}`)
        .join("\n"),
    );
    if (PRINT_HTML) console.log(`\n  ── HTML ──\n${preview.html}\n`);
  }

  // ── 발송 차단 조건(선행 점검) ──────────────────────────────────────
  //
  // dry-run 에서도 **같은 목록**을 계산해 출력한다. "승인받고 --send 했는데
  // 그제서야 막힌다"가 이 캠페인에서 제일 나쁜 실패다(A 의 grant 가 곧 만료라
  // 시한이 있다). 막힐 이유는 미리 보여야 한다.
  const blockers: string[] = [];
  if (!RESEND_API_KEY) {
    blockers.push(
      `RESEND_API_KEY 미설정 — ${path.basename(
        ENV_FILE,
      )} 또는 환경변수를 확인해라(값 미출력).`,
    );
  }
  // ★동의 pending 인 사람에게 보내는 근거는 "수신거부 경로가 있다"에 기대고 있다.
  // 그래서 경로가 없으면 막는다 — 다만 mailto 폴백이 항상 있으므로 실무상 이
  // 게이트가 걸리는 경우는 REPLY_TO 가 비는 설정 사고뿐이다.
  if (CONSENT_BASIS === "relationship" && !REPLY_TO) {
    blockers.push(
      "수신거부 경로 없음 — consent-basis=relationship 은 수신거부 수단이 " +
        "반드시 있어야 한다(REPLY_TO 미설정).",
    );
  }
  if (result.eligible.length === 0) {
    blockers.push("발송 대상 0명.");
  }

  if (blockers.length > 0) {
    console.log(`\n[★발송 차단 조건]`);
    for (const b of blockers) console.log(`  - ${b}`);
  }

  if (!SEND) {
    console.log(
      `\n✅ dry-run 종료 — 0통 발송. 실발송하려면 승인 후:\n` +
        `   npm run outreach:churn -- --consent-basis=${CONSENT_BASIS} ` +
        `--send --confirm=${CHURN_INTERVIEW_CONFIRM}\n`,
    );
    return;
  }

  // ── 실발송 경로 — 2차 게이트 ──
  if (!CONFIRM_OK) {
    throw new Error(
      `실발송하려면 --confirm=${CHURN_INTERVIEW_CONFIRM} 가 필요하다(오발송 방지). ` +
        "그 전에 dry-run 으로 대상을 확인하고 승인을 받아라.",
    );
  }
  if (blockers.length > 0) {
    throw new Error(
      `발송 차단 — 아래를 먼저 해결해라:\n  - ${blockers.join("\n  - ")}`,
    );
  }

  let sent = 0;
  let failed = 0;
  for (const target of result.eligible) {
    const content = buildChurnInterviewEmail(target.locale, target.segment);
    const delivery = unsubscribeDelivery(target.email);
    const ok = await sendOne(
      target.email,
      withFooter(content, delivery),
      delivery?.headers,
    );
    if (ok) {
      sent++;
      await stampSent(target.docId, new Date());
      console.log(`  ✅ ${target.uidHash} 발송·스탬프 완료`);
    } else {
      failed++;
      console.log(
        `  ❌ ${target.uidHash} 발송 실패(스탬프 없음 — 재실행 가능)`,
      );
    }
    if (sent + failed < result.eligible.length) await sleep(SEND_INTERVAL_MS);
  }

  console.log(`\n📮 발송 완료 — 성공 ${sent} / 실패 ${failed}`);
  console.log(
    `\n다음: 답장이 오면 사장님 계정으로 grantChurnInterviewPro({email}) 를 호출한다.\n` +
      `      (배포 필요 — docs/churn-interview-outreach-2026-08-24.md 4절)`,
  );
}

main().catch((err) => {
  console.error(`[churn-outreach] 중단: ${(err as Error).message}`);
  process.exitCode = 1;
});
