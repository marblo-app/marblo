#!/usr/bin/env node
/**
 * 3.0.19 릴리스 공지 메일 발송 경로(로컬 운영 스크립트).
 *
 * Cloud Function 신규 배포 대신 로컬 실행으로 간다 — 1회성 공지에 배포 리스크를
 * 얹지 않기 위해서다(functions 배포 함정: 반쪽함수/IAM/Cloud Build).
 * 인증은 backfill-founder-pro-grants.mjs 와 동일하게 ADC OAuth + REST.
 *
 * 미리보기(기본 — 0통 발송):
 *   GCLOUD_PROJECT=marblo-2253d npm run announce:release
 *   GCLOUD_PROJECT=marblo-2253d npm run announce:release -- --dry-run --print-html
 *
 * 실발송(★사장님/오케 승인 후에만):
 *   GCLOUD_PROJECT=marblo-2253d npm run announce:release -- \
 *     --send --confirm=SEND-RELEASE-3-0-19
 *
 * 안전 규약:
 *  - 기본이 dry-run 이다. --send 와 --confirm 이 **둘 다** 있어야 발송한다.
 *  - 대상 = beta_active(파운더 그랜트 활성) ∩ marketing_contacts 동의 ∩ 미발송.
 *    동의 게이트는 어떤 플래그로도 우회할 수 없다.
 *  - 발송 성공 건만 founders 문서에 쿨다운 스탬프를 찍는다(재실행 시 중복 방지).
 *  - PII·시크릿 미출력: 이메일은 마스킹, 토큰/API 키는 어떤 경로로도 찍지 않는다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

import {
  contactIdForEmail,
  isEmailable,
  normalizeMarketingEmail,
  buildUnsubscribeUrl,
  type MarketingContactDoc,
} from "../src/marketingContacts";
import {
  RELEASE_ANNOUNCEMENT_CONFIRM,
  RELEASE_ANNOUNCEMENT_COOLDOWN_DAYS,
  RELEASE_ANNOUNCEMENT_SENT_AT_FIELD,
  RELEASE_ANNOUNCEMENT_SENT_FIELD,
  RELEASE_ANNOUNCEMENT_VERSION,
  buildReleaseAnnouncementEmail,
  classifyFounderGrant,
  domainDistribution,
  selectReleaseAudience,
  type ReleaseAudienceCandidate,
  type ReleaseEmailContent,
} from "../src/releaseAnnouncement";

// ─── CLI 인자 ────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const has = (flag: string) => ARGV.includes(flag);
const valueOf = (name: string): string | null => {
  const hit = ARGV.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const SEND = has("--send");
const CONFIRM_OK = valueOf("--confirm") === RELEASE_ANNOUNCEMENT_CONFIRM;
const PRINT_HTML = has("--print-html");
const LIMIT_RAW = valueOf("--limit");
const LIMIT = LIMIT_RAW ? Number(LIMIT_RAW) : undefined;
const COOLDOWN_DAYS = Number(
  valueOf("--cooldown-days") ?? RELEASE_ANNOUNCEMENT_COOLDOWN_DAYS,
);

if (LIMIT_RAW && (!Number.isFinite(LIMIT) || (LIMIT as number) <= 0)) {
  throw new Error(`--limit 은 양수여야 한다: ${LIMIT_RAW}`);
}
if (!Number.isFinite(COOLDOWN_DAYS) || COOLDOWN_DAYS < 0) {
  throw new Error("--cooldown-days 는 0 이상이어야 한다");
}

/**
 * functions 패키지 루트. ★컴파일 산출물이 .script-out/release/scripts/ 아래로
 * 들어가므로 __dirname 상대 고정 경로는 틀린다(그러면 .env 를 못 찾아 --send 가
 * RESEND_API_KEY 미설정으로 죽는다). package.json name 으로 실제 루트를 찾는다.
 */
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
const PAGE_SIZE = 300;
/** 실발송 시 메일 간 간격(ms) — ESP 레이트리밋 여유. */
const SEND_INTERVAL_MS = 250;

// ─── env(.env.marblo-2253d) 로드 — 값은 절대 출력하지 않는다 ──────────
/**
 * functions 의 dotenv 단일소스에서 필요한 키만 읽는다. dotenv 의존성을 새로
 * 추가하지 않으려고 최소 파서를 쓴다(KEY=VALUE, 따옴표 제거, # 주석 무시).
 */
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

function firestoreUrl(documentPath: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${documentPath}`;
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
    // 응답 본문에 토큰/이메일이 섞일 수 있어 상태코드만 노출한다.
    throw new Error(`${res.status} ${res.statusText} @ ${redactUrl(url)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** 에러 메시지에 doc id(=이메일)가 새지 않도록 경로 마지막 세그먼트를 가린다. */
function redactUrl(url: string): string {
  const q = url.indexOf("?");
  const base = q >= 0 ? url.slice(0, q) : url;
  return base.replace(/\/[^/]+$/, "/***");
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

function docId(name: string): string {
  return name.split("/").pop() || name;
}

function toMillis(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
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

async function lookupUidByEmail(email: string): Promise<string | null> {
  try {
    const json = await fetchJson(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
        PROJECT_ID,
      )}/accounts:lookup`,
      { method: "POST", body: JSON.stringify({ email: [email] }) },
    );
    const users = (json.users as Array<{ localId?: string }>) || [];
    return users[0]?.localId || null;
  } catch {
    return null;
  }
}

// ─── 로그 위생 ───────────────────────────────────────────────────────
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.length <= 1 ? "*" : `${local[0]}***`;
  return `${head}@${domain}`;
}

// ─── 대상 수집 ───────────────────────────────────────────────────────
async function collectCandidates(
  nowMs: number,
): Promise<{ candidates: ReleaseAudienceCandidate[]; founderDocs: number }> {
  const docs = await listCollection("founders");
  const candidates: ReleaseAudienceCandidate[] = [];

  for (const doc of docs) {
    const id = docId(doc.name);
    const data = documentData(doc);
    const email = normalizeMarketingEmail(
      typeof data.email === "string" ? data.email : id,
    );
    // 선정 기준 = computeFounderActivation/getMyFounderAccess 와 동일.
    const selected = data.status !== "rejected" && data.accessGrantedAt != null;

    if (!selected) {
      candidates.push({
        docId: id,
        email,
        selected: false,
        grant: "no_active_grant",
        gateOk: false,
        gateReason: "not_selected",
        lastSentAtMs: null,
      });
      continue;
    }

    const uid = await lookupUidByEmail(email);
    const sub = uid
      ? await getDoc(`subscriptions/${encodeURIComponent(uid)}`)
      : null;
    const grant = classifyFounderGrant(
      sub
        ? {
            status: typeof sub.status === "string" ? sub.status : null,
            paymentProvider:
              typeof sub.paymentProvider === "string"
                ? sub.paymentProvider
                : null,
            currentPeriodEndMs: toMillis(sub.currentPeriodEnd),
          }
        : null,
      nowMs,
    );

    // 동의 게이트는 그랜트 통과자에 대해서만 조회한다(불필요한 읽기 절약).
    let gateOk = false;
    let gateReason = "skipped";
    if (grant === "beta_active") {
      const verdict = await marketingGate(email);
      gateOk = verdict.ok;
      gateReason = verdict.reason;
    }

    candidates.push({
      docId: id,
      email,
      selected: true,
      grant,
      gateOk,
      gateReason,
      lastSentAtMs: toMillis(data[RELEASE_ANNOUNCEMENT_SENT_AT_FIELD]),
    });
  }

  return { candidates, founderDocs: docs.length };
}

/**
 * 발송 게이트 — index.ts marketingEmailGate 와 동일 판정(isEmailable 단일소스).
 * 조회 실패도 발송 불가로 처리한다(오발송보다 미발송이 낫다).
 */
async function marketingGate(
  email: string,
): Promise<{ ok: boolean; reason: string }> {
  try {
    const contact = await getDoc(
      `marketing_contacts/${encodeURIComponent(contactIdForEmail(email))}`,
    );
    const verdict = isEmailable(
      contact
        ? (contact as unknown as Pick<
            MarketingContactDoc,
            "emailMarketingConsent" | "unsubscribe" | "emailEnc"
          >)
        : null,
    );
    return { ok: verdict.ok, reason: verdict.reason };
  } catch (err) {
    console.warn(
      `[release-announce] 게이트 조회 실패 — 발송 차단: ${maskEmail(email)} (${
        (err as Error).message
      })`,
    );
    return { ok: false, reason: "gate_error" };
  }
}

// ─── 발송 ────────────────────────────────────────────────────────────
/**
 * 마케팅 메일 배송 부속(one-click unsubscribe). 시크릿 미설정이면 null —
 * index.ts marketingEmailDelivery 와 동일 규약(없으면 헤더/푸터 없이 발송).
 */
function unsubscribeDelivery(email: string): {
  headers: Record<string, string>;
  footerHtml: string;
  footerText: string;
} | null {
  if (!MARKETING_UNSUB_SECRET || !FUNCTIONS_BASE_URL) return null;
  const url = buildUnsubscribeUrl(
    FUNCTIONS_BASE_URL,
    contactIdForEmail(email),
    MARKETING_UNSUB_SECRET,
  );
  return {
    headers: {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    footerHtml: `<p style="font-size:12px;color:#999;margin:16px 0 0">더 이상 이런 메일을 원치 않으시면 <a href="${url}" style="color:#999">수신거부</a>를 눌러주세요. / <a href="${url}" style="color:#999">Unsubscribe</a></p>`,
    footerText: `\n\n수신거부(Unsubscribe): ${url}`,
  };
}

function withFooter(
  content: ReleaseEmailContent,
  delivery: { footerHtml: string; footerText: string } | null,
): ReleaseEmailContent {
  if (!delivery) return content;
  const html = content.html.includes("</body>")
    ? content.html.replace("</body>", `${delivery.footerHtml}</body>`)
    : content.html + delivery.footerHtml;
  return {
    subject: content.subject,
    html,
    text: content.text + delivery.footerText,
  };
}

/** Resend 단건 발송. non-throwing — 실패는 false 로 흡수한다. */
async function sendOne(
  email: string,
  content: ReleaseEmailContent,
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
        `[release-announce] resend HTTP ${resp.status} — ${maskEmail(email)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[release-announce] 발송 실패 ${maskEmail(email)}: ${
        (err as Error).message
      }`,
    );
    return false;
  }
}

/** 발송 성공 문서에만 쿨다운 스탬프. 같은 이메일의 중복 문서 전부에 찍는다. */
async function stampSent(docIds: string[], sentAt: Date): Promise<void> {
  for (const id of docIds) {
    const mask =
      `?updateMask.fieldPaths=${RELEASE_ANNOUNCEMENT_SENT_AT_FIELD}` +
      `&updateMask.fieldPaths=${RELEASE_ANNOUNCEMENT_SENT_FIELD}`;
    await fetchJson(
      `${firestoreUrl(`founders/${encodeURIComponent(id)}`)}${mask}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fields: {
            [RELEASE_ANNOUNCEMENT_SENT_AT_FIELD]: {
              timestampValue: sentAt.toISOString(),
            },
            [RELEASE_ANNOUNCEMENT_SENT_FIELD]: { booleanValue: true },
          },
        }),
      },
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── main ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const nowMs = Date.now();
  const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const content = buildReleaseAnnouncementEmail();

  console.log(
    `\n=== 마블로 ${RELEASE_ANNOUNCEMENT_VERSION} 릴리스 공지 ${
      SEND ? "**실발송**" : "dry-run(발송 0통)"
    } ===`,
  );
  console.log(`project=${PROJECT_ID}  env=${path.basename(ENV_FILE)}`);
  console.log(
    `RESEND_API_KEY=${RESEND_API_KEY ? "set" : "MISSING"}  ` +
      `from=${FROM_EMAIL}  reply-to=${REPLY_TO}  ` +
      `unsubscribe-header=${
        MARKETING_UNSUB_SECRET ? "on" : "off(시크릿 미설정)"
      }`,
  );

  const { candidates, founderDocs } = await collectCandidates(nowMs);
  const result = selectReleaseAudience(candidates, {
    nowMs,
    cooldownMs,
    limit: LIMIT,
  });

  console.log(`\n[대상 산출] founders 문서 ${founderDocs}건`);
  console.log(
    `  발송 대상(beta_active ∩ 동의 ∩ 미발송): ${result.eligible.length}명`,
  );
  console.log(`  제외 — 선정 아님        : ${result.skipped.notSelected}`);
  console.log(`  제외 — 그랜트 만료      : ${result.skipped.grantExpired}`);
  console.log(`  제외 — 그랜트 없음/비활성: ${result.skipped.noActiveGrant}`);
  console.log(`  제외 — 동의 없음/수신거부: ${result.skipped.noConsent}`);
  console.log(
    `  제외 — 쿨다운(${COOLDOWN_DAYS}일 내 발송): ${result.skipped.cooldown}`,
  );
  if (result.duplicateDocs > 0) {
    console.log(`  중복 founders 문서 병합 : ${result.duplicateDocs}`);
  }
  if (result.overLimit > 0) {
    console.log(`  ★--limit 로 이번 배치서 제외: ${result.overLimit}`);
  }
  console.log(
    `  게이트 사유 분포        : ${JSON.stringify(result.gateReasonCounts)}`,
  );
  console.log(
    `  수신자 도메인 분포      : ${JSON.stringify(
      domainDistribution(result.eligible.map((e) => e.email)),
    )}`,
  );

  // ── 미리보기 ──
  const previewDir = path.join(FUNCTIONS_DIR, ".preview");
  mkdirSync(previewDir, { recursive: true });
  const previewPath = path.join(
    previewDir,
    `release-${RELEASE_ANNOUNCEMENT_VERSION}.html`,
  );
  const previewContent = withFooter(
    content,
    unsubscribeDelivery("preview@example.com"),
  );
  writeFileSync(previewPath, previewContent.html, "utf8");

  console.log(`\n[메일 미리보기]`);
  console.log(`  제목: ${content.subject}`);
  console.log(`  HTML: ${previewPath} (${previewContent.html.length} bytes)`);
  console.log(`  ── 텍스트 본문 ──\n`);
  console.log(
    content.text
      .split("\n")
      .map((l) => `  | ${l}`)
      .join("\n"),
  );
  if (PRINT_HTML) {
    console.log(`\n  ── HTML ──\n${previewContent.html}\n`);
  }

  if (!SEND) {
    console.log(
      `\n✅ dry-run 종료 — 0통 발송. 실발송하려면 승인 후:\n` +
        `   npm run announce:release -- --send --confirm=${RELEASE_ANNOUNCEMENT_CONFIRM}\n`,
    );
    return;
  }

  // ── 실발송 경로 — 2차 게이트 ──
  if (!CONFIRM_OK) {
    throw new Error(
      `실발송하려면 --confirm=${RELEASE_ANNOUNCEMENT_CONFIRM} 가 필요하다(오발송 방지). ` +
        "그 전에 dry-run 으로 대상을 확인하고 승인을 받아라.",
    );
  }
  if (!RESEND_API_KEY) {
    throw new Error(
      `RESEND_API_KEY 미설정 — ${path.basename(
        ENV_FILE,
      )} 를 확인해라(값은 출력하지 않는다).`,
    );
  }
  if (result.eligible.length === 0) {
    console.log("\n대상 0명 — 발송할 것이 없다.");
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const target of result.eligible) {
    const delivery = unsubscribeDelivery(target.email);
    const ok = await sendOne(
      target.email,
      withFooter(content, delivery),
      delivery?.headers,
    );
    if (ok) {
      sent++;
      await stampSent(target.docIds, new Date());
    } else {
      failed++;
    }
    if (sent + failed < result.eligible.length) await sleep(SEND_INTERVAL_MS);
  }

  console.log(`\n📮 발송 완료 — 성공 ${sent} / 실패 ${failed}`);
}

main().catch((err) => {
  console.error(`[release-announce] 중단: ${(err as Error).message}`);
  process.exitCode = 1;
});
