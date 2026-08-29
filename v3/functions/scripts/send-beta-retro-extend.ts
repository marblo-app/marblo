#!/usr/bin/env node
/**
 * 베타 1개월 → 3개월 **소급 연장 + 복귀 안내 메일** 실행 경로 — 티켓
 * F8PAS6bMofxjujDCgPfE.
 *
 * scripts/send-churn-interview-emails.ts 와 같은 규약이다: Cloud Function 신규
 * 배포 대신 로컬 실행(1회성 캠페인에 배포 리스크를 얹지 않는다). 인증은
 * backfill-founder-pro-grants.mjs 와 동일하게 ADC OAuth + REST.
 *
 * 읽기 전용 드라이런본(dryrun-founder-beta-retro-extend.mjs)이 판단 재료를
 * 뽑았고, 이 스크립트가 **승인 후의 실행**을 맡는다. 판정 로직은 복제하지 않고
 * src/betaRetroExtend.ts 한 곳에서 가져온다.
 *
 * 미리보기(기본 — 0통 발송, 0건 쓰기):
 *   GCLOUD_PROJECT=marblo-2253d npm run retro:beta-extend
 *
 * ★소급 쓰기(사장님 승인 후):
 *   GCLOUD_PROJECT=marblo-2253d npm run retro:beta-extend -- \
 *     --apply --confirm-apply=APPLY-BETA-RETRO-EXTEND-2026-08
 *
 * ★실발송(사장님 승인 후):
 *   GCLOUD_PROJECT=marblo-2253d npm run retro:beta-extend -- \
 *     --send --confirm-send=SEND-BETA-RETRO-EXTEND-2026-08 [--limit=5]
 *
 * ── 안전 규약 ────────────────────────────────────────────────────────
 *  - 기본이 dry-run 이다. --apply/--send 는 각자 **자기 확인 문구**를 요구한다.
 *    하나의 플래그가 두 가지 되돌릴 수 없는 일을 동시에 하지 않는다.
 *  - ★메일은 되돌릴 수 없다. --limit 으로 소수 발송 후 확인하는 경로를 둔다.
 *  - 현역 유료 구독은 대상에서 빠지고, 쓰기 직전에 **한 번 더** 판정한다
 *    (드라이런 시점과 실행 시점 사이에 결제가 시작될 수 있다).
 *  - 구독 쓰기는 읽은 시점의 updateTime 을 precondition 으로 걸어 낙관적
 *    트랜잭션으로 만든다 — 그 사이 누가 쓰면 커밋이 실패하고 우리는 건너뛴다.
 *  - 수신동의 철회자에게는 어떤 플래그로도 메일이 나가지 않는다. 단 **접근권
 *    소급은 간다**(메일을 못 보내는 것과 권리를 뺏는 것은 다른 문제).
 *  - 발송 성공 건만 founders 문서에 스탬프 → 재실행이 중복 발송을 하지 않는다.
 *  - PII·시크릿 미출력: 이메일은 마스킹, 사람은 sha256 앞 10자, 토큰/API 키는
 *    어떤 경로로도 찍지 않는다. ★완료보고에는 개수와 언어 분포만 쓴다.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildUnsubscribeUrl,
  contactIdForEmail,
  normalizeMarketingEmail,
} from "../src/marketingContacts";
import { resolveGrantPlanType } from "../src/grantPlan";
import {
  BETA_RETRO_APPLY_CONFIRM,
  BETA_RETRO_EXTEND_APPLIED_AT_FIELD,
  BETA_RETRO_EXTEND_COHORT_FIELD,
  BETA_RETRO_EXTEND_REASON,
  BETA_RETRO_EXTEND_SENT_AT_FIELD,
  BETA_RETRO_EXTEND_SENT_FIELD,
  BETA_RETRO_SEND_CONFIRM,
  RETRO_BETA_MONTHS,
  addMonthsMs,
  buildBetaRetroExtendEmail,
  selectRetroAudience,
  toExpiresOn,
  type RetroCandidate,
  type RetroCohort,
  type RetroEmailContent,
  type RetroLocale,
  type RetroSubscriptionFacts,
} from "../src/betaRetroExtend";

// ─── CLI 인자 ────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const has = (flag: string): boolean => ARGV.includes(flag);
const valueOf = (name: string): string | null => {
  const hit = ARGV.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const APPLY = has("--apply");
const SEND = has("--send");
const APPLY_CONFIRM_OK =
  valueOf("--confirm-apply") === BETA_RETRO_APPLY_CONFIRM;
const SEND_CONFIRM_OK = valueOf("--confirm-send") === BETA_RETRO_SEND_CONFIRM;
const PRINT_HTML = has("--print-html");
const LIMIT_RAW = valueOf("--limit");
const LIMIT = LIMIT_RAW === null ? Number.POSITIVE_INFINITY : Number(LIMIT_RAW);
if (LIMIT_RAW !== null && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  throw new Error("--limit 은 1 이상의 정수여야 한다");
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
const SEND_INTERVAL_MS = 250;
const PAGE_SIZE = 300;

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
// ★발신 주소는 team@marblo.app 로 통일한다(사장님 방침 · index.ts 와 같은 기본값).
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
  if ("timestampValue" in value) {
    return new Date(value.timestampValue as string);
  }
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
  updateTime?: string;
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

async function getRawDoc(documentPath: string): Promise<FirestoreDoc | null> {
  try {
    return (await fetchJson(
      firestoreUrl(documentPath),
    )) as unknown as FirestoreDoc;
  } catch (err) {
    if (String((err as Error).message).startsWith("404 ")) return null;
    throw err;
  }
}

async function listCollection(collection: string): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await fetchJson(`${firestoreUrl(collection)}?${params}`);
    docs.push(...((json.documents as FirestoreDoc[]) || []));
    pageToken = (json.nextPageToken as string) || "";
  } while (pageToken);
  return docs;
}

// ─── 로그 위생 ───────────────────────────────────────────────────────
const idHashOf = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 10);

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

const asString = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;

function normalizeRetroLocale(raw: unknown): RetroLocale {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v.startsWith("en")) return "en";
  if (v.startsWith("ja")) return "ja";
  return "ko"; // 알 수 없는 값은 한국어 기본(index.ts normalizeFounderLocale 과 같다)
}

/**
 * 결제 흔적 — toss/paddle/portone 전부. ★index.ts hasPaymentEvidence 는 portone
 * 키를 보지 않는다(실측 사례: portoneBillingKey 를 가진 현역 결제자가 "흔적 없음"
 * 으로 판정됐다). 여기서는 넓게 본다 — 오판 방향을 "안 건드림"쪽으로 둔다.
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

function subscriptionFacts(
  sub: Record<string, unknown> | null,
): RetroSubscriptionFacts | null {
  if (!sub) return null;
  return {
    status: asString(sub.status),
    founderGrant: sub.founderGrant === true,
    paymentProvider: asString(sub.paymentProvider),
    hasPaymentEvidence: hasAnyPaymentEvidence(sub),
    currentPeriodEndMs: toMillis(sub.currentPeriodEnd),
  };
}

// ─── Auth ────────────────────────────────────────────────────────────
interface AuthUser {
  localId: string;
  email?: string;
  disabled?: boolean;
}

async function lookupUserByEmail(email: string): Promise<AuthUser | null> {
  try {
    const json = await fetchJson(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
        PROJECT_ID,
      )}/accounts:lookup`,
      { method: "POST", body: JSON.stringify({ email: [email] }) },
    );
    return ((json.users as AuthUser[]) || [])[0] || null;
  } catch {
    return null;
  }
}

// ─── 후보 수집 ───────────────────────────────────────────────────────
interface Collected {
  candidates: RetroCandidate[];
  founderDocs: number;
  operatorExcluded: number;
  /** 구독/컨택트 조회에 실패해 판정을 못 한 건. 0 이 아니면 실행하면 안 된다. */
  lookupErrors: number;
}

async function collectCandidates(): Promise<Collected> {
  const founderDocs = await listCollection("founders");
  const candidates: RetroCandidate[] = [];
  let operatorExcluded = 0;
  let lookupErrors = 0;

  for (const doc of founderDocs) {
    const data = documentData(doc);
    const docId = doc.name.split("/").pop() || doc.name;
    const email = normalizeMarketingEmail(asString(data.email) ?? docId);
    if (!email.includes("@")) {
      lookupErrors++;
      continue;
    }

    let uid = asString(data.proSubscriptionUid);
    let disabled = false;
    if (!uid) {
      const authUser = await lookupUserByEmail(email);
      uid = authUser?.localId ?? null;
      disabled = authUser?.disabled === true;
    }

    // 운영자(ADMIN_UID)는 모수에서 뺀다. ★값은 어디에도 출력하지 않는다.
    if (uid && ADMIN_UID && uid === ADMIN_UID) {
      operatorExcluded++;
      continue;
    }

    let sub: Record<string, unknown> | null = null;
    let contact: Record<string, unknown> | null = null;
    try {
      if (uid) {
        const raw = await getRawDoc(`subscriptions/${encodeURIComponent(uid)}`);
        sub = raw ? documentData(raw) : null;
      }
      const contactRaw = await getRawDoc(
        `marketing_contacts/${contactIdForEmail(email)}`,
      );
      contact = contactRaw ? documentData(contactRaw) : null;
    } catch (err) {
      // ★조회가 실패한 사람을 "동의 없음"으로 조용히 처리하면 안 된다. 세고
      //   보고한 뒤, 하나라도 있으면 실행을 막는다.
      console.warn(
        `[beta-retro] 조회 실패 ${idHashOf(email)}: ${(err as Error).message}`,
      );
      lookupErrors++;
      continue;
    }

    const consent = (contact?.emailMarketingConsent ?? null) as {
      status?: string;
    } | null;
    const unsub = (contact?.unsubscribe ?? null) as { status?: string } | null;

    candidates.push({
      docId,
      idHash: idHashOf(email),
      email,
      uid,
      locale: normalizeRetroLocale(data.locale ?? contact?.locale),
      founder: {
        status: asString(data.status),
        accessGrantedAtMs: toMillis(data.accessGrantedAt),
        betaExpiresAtMs: toMillis(data.betaExpiresAt),
        proExpiresAtMs: toMillis(data.proExpiresAt),
      },
      sub: subscriptionFacts(sub),
      contact: {
        hasEmail: !disabled,
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
      },
      lastSentAtMs: toMillis(data[BETA_RETRO_EXTEND_SENT_AT_FIELD]),
    });
  }

  return {
    candidates,
    founderDocs: founderDocs.length,
    operatorExcluded,
    lookupErrors,
  };
}

// ─── 수신거부 부속 ───────────────────────────────────────────────────
//
// index.ts marketingEmailDelivery 와 같은 원클릭(RFC 8058)을 쓰되, 시크릿이
// 없으면 mailto 폴백(RFC 2369)으로 간다 — send-churn-interview-emails.ts 와 같은
// 이유다(MARKETING_UNSUB_SECRET 이 프로덕션에 없다는 실측). ★수신거부 경로가
// 없는 발송은 하지 않는다.
interface UnsubscribeDelivery {
  kind: "one_click" | "mailto";
  headers: Record<string, string>;
  footerHtml: string;
  footerText: string;
}

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

/** index.ts withUnsubscribeFooter 와 같은 규약(</body> 직전 삽입). */
function withFooter(
  content: RetroEmailContent,
  delivery: { footerHtml: string; footerText: string },
): RetroEmailContent {
  const html = content.html.includes("</body>")
    ? content.html.replace("</body>", `${delivery.footerHtml}</body>`)
    : content.html + delivery.footerHtml;
  return {
    subject: content.subject,
    html,
    text: content.text + delivery.footerText,
  };
}

/** index.ts postResendEmail 과 동일한 요청 형태. 새 발송기를 만들지 않는다. */
async function sendOne(
  email: string,
  content: RetroEmailContent,
  headers: Record<string, string>,
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
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }),
    });
    if (!resp.ok) {
      console.warn(
        `[beta-retro] resend HTTP ${resp.status} — ${maskEmail(email)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[beta-retro] 발송 실패 ${maskEmail(email)}: ${(err as Error).message}`,
    );
    return false;
  }
}

// ─── 쓰기 ────────────────────────────────────────────────────────────

/**
 * founders/{docId} 의 베타 창을 늘린다. ★계정 유무와 무관하게 항상 쓴다 —
 * 이 값이 없으면 계정 X 가 가입해도 grantBetaProOnSignup 이 window_expired 로
 * 스킵한다(betaRetroExtend.ts 상단 주석).
 */
async function writeFounderWindow(
  docId: string,
  targetMs: number,
): Promise<void> {
  const mask =
    `?updateMask.fieldPaths=betaExpiresAt` +
    `&updateMask.fieldPaths=${BETA_RETRO_EXTEND_APPLIED_AT_FIELD}` +
    `&updateMask.fieldPaths=betaRetroExtendReason`;
  await fetchJson(
    `${firestoreUrl(`founders/${encodeURIComponent(docId)}`)}${mask}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          betaExpiresAt: {
            timestampValue: new Date(targetMs).toISOString(),
          },
          [BETA_RETRO_EXTEND_APPLIED_AT_FIELD]: {
            timestampValue: new Date().toISOString(),
          },
          // ★마커. 나중에 코호트에서 이 인원을 분리하기 위한 표식.
          betaRetroExtendReason: { stringValue: BETA_RETRO_EXTEND_REASON },
        },
      }),
    },
  );
}

type UpsertOutcome =
  | { kind: "granted"; planType: string }
  | { kind: "skipped"; reason: string };

/**
 * subscriptions/{uid} upsert — index.ts upsertProSubscription 규칙 그대로.
 *  · 현역 유료 미덮어쓰기 (쓰기 **직전에** 다시 판정한다)
 *  · 기간 축소 없음 (periodEnd = max(기존, target))
 *  · 강등 금지 (resolveGrantPlanType 을 그대로 import 해서 쓴다)
 *  · paymentProvider 보존은 "현역 유료면 아예 안 쓴다"로 달성된다
 *
 * ★트랜잭션 대용: 읽은 시점의 updateTime 을 precondition 으로 걸어 낙관적
 * 동시성을 만든다. 조회~쓰기 사이에 결제 웹훅이 끼어들면 커밋이 400/409 로
 * 실패하고 우리는 건너뛴다 — 조용히 덮어쓰는 경로가 없다.
 */
async function upsertRetroSubscription(
  uid: string,
  targetMs: number,
): Promise<UpsertOutcome> {
  const raw = await getRawDoc(`subscriptions/${encodeURIComponent(uid)}`);
  const data = raw ? documentData(raw) : null;
  const facts = subscriptionFacts(data);

  // ★드라이런 시점과 실행 시점 사이에 결제가 시작될 수 있다. 여기서 다시 본다.
  if (
    facts &&
    !(facts.founderGrant || facts.paymentProvider === "founder_grant") &&
    (facts.status === "active" || facts.status === "past_due") &&
    facts.hasPaymentEvidence
  ) {
    return { kind: "skipped", reason: "live_paid" };
  }

  const existingEndMs = facts?.currentPeriodEndMs ?? null;
  const periodEndMs =
    typeof existingEndMs === "number" && existingEndMs > targetMs
      ? existingEndMs
      : targetMs;
  const planType = resolveGrantPlanType(BETA_RETRO_EXTEND_REASON, data ?? null);

  const nowIso = new Date().toISOString();
  const fields: Record<string, unknown> = {
    userId: { stringValue: uid },
    planType: { stringValue: planType },
    status: { stringValue: "active" },
    paymentProvider: { stringValue: "founder_grant" },
    founderGrant: { booleanValue: true },
    founderGrantReason: { stringValue: BETA_RETRO_EXTEND_REASON },
    founderGrantStartedAt: { timestampValue: nowIso },
    currentPeriodEnd: {
      timestampValue: new Date(periodEndMs).toISOString(),
    },
    updatedAt: { timestampValue: nowIso },
  };
  const paths = Object.keys(fields);
  if (!raw) {
    fields.currentPeriodStart = { timestampValue: nowIso };
    fields.createdAt = { timestampValue: nowIso };
    paths.push("currentPeriodStart", "createdAt");
  }

  const params = new URLSearchParams();
  for (const p of paths) params.append("updateMask.fieldPaths", p);
  // 낙관적 동시성: 읽은 그 버전에만 쓴다.
  if (raw?.updateTime) {
    params.set("currentDocument.updateTime", raw.updateTime);
  } else {
    params.set("currentDocument.exists", "false");
  }

  await fetchJson(
    `${firestoreUrl(`subscriptions/${encodeURIComponent(uid)}`)}?${params}`,
    { method: "PATCH", body: JSON.stringify({ fields }) },
  );
  return { kind: "granted", planType };
}

async function stampSent(docId: string, cohort: RetroCohort): Promise<void> {
  const mask =
    `?updateMask.fieldPaths=${BETA_RETRO_EXTEND_SENT_AT_FIELD}` +
    `&updateMask.fieldPaths=${BETA_RETRO_EXTEND_SENT_FIELD}` +
    `&updateMask.fieldPaths=${BETA_RETRO_EXTEND_COHORT_FIELD}`;
  await fetchJson(
    `${firestoreUrl(`founders/${encodeURIComponent(docId)}`)}${mask}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          [BETA_RETRO_EXTEND_SENT_AT_FIELD]: {
            timestampValue: new Date().toISOString(),
          },
          [BETA_RETRO_EXTEND_SENT_FIELD]: { booleanValue: true },
          [BETA_RETRO_EXTEND_COHORT_FIELD]: { stringValue: cohort },
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
  const mode =
    APPLY || SEND
      ? `**실행** (apply=${APPLY ? "ON" : "off"} send=${SEND ? "ON" : "off"})`
      : "dry-run (0건 쓰기 · 0통 발송)";

  console.log(`\n=== 베타 소급 연장 + 복귀 안내 메일 — ${mode} ===`);
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
    `베타 ${RETRO_BETA_MONTHS}개월 · 소급 마커="${BETA_RETRO_EXTEND_REASON}"` +
      (Number.isFinite(LIMIT) ? `  발송 상한=${LIMIT}통` : ""),
  );

  const { candidates, founderDocs, operatorExcluded, lookupErrors } =
    await collectCandidates();
  const result = selectRetroAudience(candidates, {
    nowMs,
    betaMonths: RETRO_BETA_MONTHS,
  });

  console.log(`\n[대상 산출] founders 문서 ${founderDocs}건`);
  console.log(`  운영자 제외        : ${operatorExcluded}`);
  console.log(`  조회 실패          : ${lookupErrors}`);
  console.log(`  후보               : ${candidates.length}명`);
  console.log(`  ★소급 쓰기 대상    : ${result.appliable.length}명`);
  console.log(`  ★메일 발송 대상    : ${result.mailable.length}명`);
  console.log(`  소급 비대상(skip)  : ${JSON.stringify(result.skipCounts)}`);
  console.log(`  발송 제외 사유     : ${JSON.stringify(result.reasonCounts)}`);

  const applyAccount = result.appliable.filter(
    (a) => a.upsertSubscriptionUid !== null,
  ).length;
  console.log(
    `  소급 쓰기 내역     : 계정 O ${applyAccount}명(구독 부활) · ` +
      `계정 X ${result.appliable.length - applyAccount}명(창만 연장 — 가입 시 부여)`,
  );

  console.log(`\n[발송 대상 코호트 × 언어 분포 — ★보고에 쓰는 유일한 인적 정보]`);
  for (const cohort of ["account", "no_account"] as const) {
    const d = result.distribution[cohort];
    console.log(
      `  ${cohort.padEnd(10)} ko=${d.ko} en=${d.en} ja=${d.ja}  (계 ${
        d.ko + d.en + d.ja
      })`,
    );
  }

  console.log(`\n[발송 대상 상세] — 해시·마스킹만`);
  for (const e of result.mailable) {
    console.log(
      `  ${e.idHash}  ${maskEmail(e.email)}  ${e.cohort.padEnd(10)} ` +
        `locale=${e.locale}  ${e.action.padEnd(6)} +${e.addedDays}일 → ${toExpiresOn(
          e.targetMs,
        )}  basis=${e.consentBasis}`,
    );
  }
  if (result.excluded.length > 0) {
    console.log(`\n[제외 상세]`);
    for (const x of result.excluded) {
      console.log(`  ${x.idHash}  ${x.reasons.join(", ")}`);
    }
  }

  // ── 미리보기 6벌(ko/en/ja × 계정O/X) ──
  const previewDir = path.join(FUNCTIONS_DIR, ".preview");
  mkdirSync(previewDir, { recursive: true });
  // ★미리보기 만료일은 실제 대상자의 값을 쓴다. nowMs 를 쓰면 "오늘까지 열려
  // 있습니다"가 되어 문안을 승인하는 사람을 오도한다. 대상이 없으면 정책상
  // 최소값(now + 베타 개월)으로 그린다.
  const previewParams = {
    expiresOn: toExpiresOn(
      result.mailable[0]?.targetMs ?? addMonthsMs(nowMs, RETRO_BETA_MONTHS),
    ),
  };
  for (const locale of ["ko", "en", "ja"] as const) {
    for (const cohort of ["account", "no_account"] as const) {
      const content = buildBetaRetroExtendEmail(locale, cohort, previewParams);
      const preview = withFooter(
        content,
        unsubscribeDelivery("preview@example.com"),
      );
      const file = path.join(
        previewDir,
        `beta-retro-extend-${cohort}-${locale}.html`,
      );
      writeFileSync(file, preview.html, "utf8");
      if (locale === "ko") {
        console.log(`\n[미리보기 ${cohort}/${locale}] ${file}`);
        console.log(`  제목: ${content.subject}`);
        console.log(
          content.text
            .split("\n")
            .map((l) => `  | ${l}`)
            .join("\n"),
        );
        if (PRINT_HTML) console.log(`\n  ── HTML ──\n${preview.html}\n`);
      } else {
        console.log(`[미리보기 ${cohort}/${locale}] ${file}`);
      }
    }
  }

  // ── 차단 조건(선행 점검) ───────────────────────────────────────────
  // dry-run 에서도 **같은 목록**을 계산해 출력한다. "승인받고 실행했는데 그제서야
  // 막힌다"가 이 캠페인에서 제일 나쁜 실패다.
  const blockers: string[] = [];
  if (lookupErrors > 0) {
    blockers.push(
      `조회 실패 ${lookupErrors}건 — 판정을 못 한 사람이 있다. 원인을 먼저 해결해라.`,
    );
  }
  // ★ADMIN_UID 는 **발송** 게이트다. 소급 쓰기까지 막을 이유는 없다 — 운영자
  // 본인의 베타 창이 늘어나는 건 사고가 아니지만, 운영자에게 복귀 안내 메일이
  // 가는 건 사고다.
  if (SEND && !ADMIN_UID) {
    blockers.push(
      "ADMIN_UID 미설정 — 운영자를 모수에서 뺄 수 없다(사장님께 메일이 갈 수 있다).",
    );
  }
  if (SEND && !RESEND_API_KEY) {
    blockers.push(
      `RESEND_API_KEY 미설정 — ${path.basename(ENV_FILE)} 를 확인해라(값 미출력).`,
    );
  }
  if (SEND && !REPLY_TO) {
    blockers.push("수신거부 경로 없음 — REPLY_TO 가 비어 있다.");
  }
  if (blockers.length > 0) {
    console.log(`\n[★차단 조건]`);
    for (const b of blockers) console.log(`  - ${b}`);
  }

  if (!APPLY && !SEND) {
    console.log(
      `\n✅ dry-run 종료 — 0건 쓰기, 0통 발송.\n` +
        `   ★메일은 되돌릴 수 없다. 사장님 확인 후에만 아래를 실행한다.\n` +
        `   소급 쓰기: npm run retro:beta-extend -- --apply --confirm-apply=${BETA_RETRO_APPLY_CONFIRM}\n` +
        `   실발송   : npm run retro:beta-extend -- --send  --confirm-send=${BETA_RETRO_SEND_CONFIRM} [--limit=5]\n`,
    );
    return;
  }

  if (blockers.length > 0) {
    throw new Error(
      `실행 차단 — 아래를 먼저 해결해라:\n  - ${blockers.join("\n  - ")}`,
    );
  }

  // ── 소급 쓰기 ──────────────────────────────────────────────────────
  if (APPLY) {
    if (!APPLY_CONFIRM_OK) {
      throw new Error(
        `소급 쓰기에는 --confirm-apply=${BETA_RETRO_APPLY_CONFIRM} 가 필요하다.`,
      );
    }
    let applied = 0;
    let granted = 0;
    let skipped = 0;
    let failed = 0;
    for (const plan of result.appliable) {
      try {
        await writeFounderWindow(plan.docId, plan.writeFounderWindowMs);
        applied++;
        if (plan.upsertSubscriptionUid) {
          const outcome = await upsertRetroSubscription(
            plan.upsertSubscriptionUid,
            plan.writeFounderWindowMs,
          );
          if (outcome.kind === "granted") {
            granted++;
            console.log(
              `  ✅ ${plan.idHash} 창=${toExpiresOn(
                plan.writeFounderWindowMs,
              )} 구독부여(plan=${outcome.planType})`,
            );
          } else {
            skipped++;
            console.log(
              `  ⏭️  ${plan.idHash} 창=${toExpiresOn(
                plan.writeFounderWindowMs,
              )} 구독 스킵(${outcome.reason})`,
            );
          }
        } else {
          console.log(
            `  ✅ ${plan.idHash} 창=${toExpiresOn(
              plan.writeFounderWindowMs,
            )} (계정 X — 가입 시 grantBetaProOnSignup 이 부여)`,
          );
        }
      } catch (err) {
        failed++;
        console.log(`  ❌ ${plan.idHash} 쓰기 실패: ${(err as Error).message}`);
      }
    }
    console.log(
      `\n📦 소급 쓰기 — founders 창 ${applied} / 구독 부여 ${granted} / 구독 스킵 ${skipped} / 실패 ${failed}`,
    );
  }

  // ── 실발송 ─────────────────────────────────────────────────────────
  if (SEND) {
    if (!SEND_CONFIRM_OK) {
      throw new Error(
        `실발송에는 --confirm-send=${BETA_RETRO_SEND_CONFIRM} 가 필요하다. ` +
          "그 전에 dry-run 으로 대상을 확인하고 사장님 승인을 받아라.",
      );
    }
    if (result.mailable.length === 0) {
      console.log("\n발송 대상 0명 — 보낼 것이 없다.");
      return;
    }
    const targets = Number.isFinite(LIMIT)
      ? result.mailable.slice(0, LIMIT)
      : result.mailable;
    let sent = 0;
    let failed = 0;
    for (const target of targets) {
      const content = buildBetaRetroExtendEmail(target.locale, target.cohort, {
        expiresOn: toExpiresOn(target.targetMs),
      });
      const delivery = unsubscribeDelivery(target.email);
      const ok = await sendOne(
        target.email,
        withFooter(content, delivery),
        delivery.headers,
      );
      if (ok) {
        sent++;
        await stampSent(target.docId, target.cohort);
        console.log(`  ✅ ${target.idHash} 발송·스탬프 완료`);
      } else {
        failed++;
        console.log(
          `  ❌ ${target.idHash} 발송 실패(스탬프 없음 — 재실행 가능)`,
        );
      }
      if (sent + failed < targets.length) await sleep(SEND_INTERVAL_MS);
    }
    console.log(
      `\n📮 발송 완료 — 성공 ${sent} / 실패 ${failed}` +
        (targets.length < result.mailable.length
          ? ` (상한 ${LIMIT}통 — 남은 ${
              result.mailable.length - targets.length
            }명은 상한 없이 재실행하면 이어서 나간다)`
          : ""),
    );
  }
}

main().catch((err) => {
  console.error(`[beta-retro] 중단: ${(err as Error).message}`);
  process.exitCode = 1;
});
