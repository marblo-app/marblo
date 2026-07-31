#!/usr/bin/env node
/**
 * 3.0.19 제품 업데이트 공지 메일 발송 경로(로컬 운영 스크립트) — 서비스/정보성.
 *
 * #681 send-release-announcement.ts(마케팅 공지)를 클론·변형했다. Cloud Function
 * 신규 배포 대신 로컬 실행으로 간다 — 1회성 공지에 배포 리스크를 얹지 않기
 * 위해서다. 인증은 동일하게 ADC OAuth + REST.
 *
 * 미리보기(기본 — 0통 발송):
 *   GCLOUD_PROJECT=marblo-2253d npm run announce:update
 *   GCLOUD_PROJECT=marblo-2253d npm run announce:update -- --dry-run --print-html
 *
 * 실발송(★사장님/오케 승인 후에만):
 *   GCLOUD_PROJECT=marblo-2253d npm run announce:update -- \
 *     --send --confirm=SEND-UPDATE-3-0-19
 *
 * 안전 규약:
 *  - 기본이 dry-run 이다. --send 와 --confirm 이 **둘 다** 있어야 발송한다.
 *  - 대상 = beta_active(파운더 그랜트 활성) ∩ (하드옵트아웃/무효주소 아님) ∩ 미발송.
 *    ★마케팅 동의(isEmailable)는 적용하지 않는다 — 광고가 아니라 서비스 공지다.
 *    marketing_contacts.unsubscribe.status==="unsubscribed" 만 하드옵트아웃으로
 *    본다(전체 수신거부). 이 저장소엔 별도 하드바운스 트래킹이 없어 이메일
 *    형식 불량만 무효주소로 판정한다.
 *  - 발송 성공 건만 founders 문서에 쿨다운 스탬프를 찍는다(releaseUpdate_3_0_19_
 *    SentAt — 마케팅 공지의 releaseAnnouncement_3_0_19_SentAt 과는 별개 키).
 *  - PII·시크릿 미출력: 이메일은 마스킹, 토큰/API 키는 어떤 경로로도 찍지 않는다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

import {
  contactIdForEmail,
  normalizeMarketingEmail,
} from "../src/marketingContacts";
import {
  RELEASE_UPDATE_CONFIRM,
  RELEASE_UPDATE_COOLDOWN_DAYS,
  RELEASE_UPDATE_SENT_AT_FIELD,
  RELEASE_UPDATE_SENT_FIELD,
  RELEASE_UPDATE_VERSION,
  buildReleaseUpdateEmail,
  classifyFounderGrant,
  domainDistribution,
  selectReleaseUpdateAudience,
  serviceMailGate,
  type ReleaseUpdateAudienceCandidate,
  type ReleaseEmailContent,
} from "../src/releaseUpdateAnnouncement";

// ─── CLI 인자 ────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const has = (flag: string) => ARGV.includes(flag);
const valueOf = (name: string): string | null => {
  const hit = ARGV.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const SEND = has("--send");
const CONFIRM_OK = valueOf("--confirm") === RELEASE_UPDATE_CONFIRM;
const PRINT_HTML = has("--print-html");
const LIMIT_RAW = valueOf("--limit");
const LIMIT = LIMIT_RAW ? Number(LIMIT_RAW) : undefined;
const COOLDOWN_DAYS = Number(
  valueOf("--cooldown-days") ?? RELEASE_UPDATE_COOLDOWN_DAYS,
);

if (LIMIT_RAW && (!Number.isFinite(LIMIT) || (LIMIT as number) <= 0)) {
  throw new Error(`--limit 은 양수여야 한다: ${LIMIT_RAW}`);
}
if (!Number.isFinite(COOLDOWN_DAYS) || COOLDOWN_DAYS < 0) {
  throw new Error("--cooldown-days 는 0 이상이어야 한다");
}

/**
 * functions 패키지 루트. ★컴파일 산출물이 .script-out/release-update/scripts/
 * 아래로 들어가므로 __dirname 상대 고정 경로는 틀린다(그러면 .env 를 못 찾아
 * --send 가 RESEND_API_KEY 미설정으로 죽는다). package.json name 으로 실제
 * 루트를 찾는다.
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
async function collectCandidates(nowMs: number): Promise<{
  candidates: ReleaseUpdateAudienceCandidate[];
  founderDocs: number;
}> {
  const docs = await listCollection("founders");
  const candidates: ReleaseUpdateAudienceCandidate[] = [];

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

    // 하드옵트아웃/무효주소 게이트는 그랜트 통과자에 대해서만 조회한다(불필요한 읽기 절약).
    let gateOk = false;
    let gateReason = "skipped";
    if (grant === "beta_active") {
      const verdict = await hardOptOutGate(email);
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
      lastSentAtMs: toMillis(data[RELEASE_UPDATE_SENT_AT_FIELD]),
    });
  }

  return { candidates, founderDocs: docs.length };
}

/**
 * 하드옵트아웃/무효주소 게이트 — marketing_contacts.unsubscribe.status 만 본다.
 * ★emailMarketingConsent(마케팅 동의)는 절대 조회·참조하지 않는다 — 이건
 * 서비스 공지지 광고가 아니다. 조회 실패는 발송 불가로 처리한다(오발송보다
 * 미발송이 낫다 — releaseAnnouncement.ts 와 동일 원칙).
 */
async function hardOptOutGate(
  email: string,
): Promise<{ ok: boolean; reason: string }> {
  try {
    const contact = await getDoc(
      `marketing_contacts/${encodeURIComponent(contactIdForEmail(email))}`,
    );
    const unsubscribe = contact?.unsubscribe as { status?: string } | undefined;
    return serviceMailGate({
      email,
      unsubscribed: unsubscribe?.status === "unsubscribed",
    });
  } catch (err) {
    console.warn(
      `[release-update] 게이트 조회 실패 — 발송 차단: ${maskEmail(email)} (${
        (err as Error).message
      })`,
    );
    return { ok: false, reason: "gate_error" };
  }
}

// ─── 발송 ────────────────────────────────────────────────────────────
/** Resend 단건 발송. non-throwing — 실패는 false 로 흡수한다. */
async function sendOne(
  email: string,
  content: ReleaseEmailContent,
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
      }),
    });
    if (!resp.ok) {
      console.warn(
        `[release-update] resend HTTP ${resp.status} — ${maskEmail(email)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[release-update] 발송 실패 ${maskEmail(email)}: ${
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
      `?updateMask.fieldPaths=${RELEASE_UPDATE_SENT_AT_FIELD}` +
      `&updateMask.fieldPaths=${RELEASE_UPDATE_SENT_FIELD}`;
    await fetchJson(
      `${firestoreUrl(`founders/${encodeURIComponent(id)}`)}${mask}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          fields: {
            [RELEASE_UPDATE_SENT_AT_FIELD]: {
              timestampValue: sentAt.toISOString(),
            },
            [RELEASE_UPDATE_SENT_FIELD]: { booleanValue: true },
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
  const content = buildReleaseUpdateEmail();

  console.log(
    `\n=== 마블로 ${RELEASE_UPDATE_VERSION} 제품 업데이트 공지 ${
      SEND ? "**실발송**" : "dry-run(발송 0통)"
    } (서비스/정보성 — 마케팅 동의게이트 미적용) ===`,
  );
  console.log(`project=${PROJECT_ID}  env=${path.basename(ENV_FILE)}`);
  console.log(
    `RESEND_API_KEY=${RESEND_API_KEY ? "set" : "MISSING"}  ` +
      `from=${FROM_EMAIL}  reply-to=${REPLY_TO}`,
  );

  const { candidates, founderDocs } = await collectCandidates(nowMs);
  const result = selectReleaseUpdateAudience(candidates, {
    nowMs,
    cooldownMs,
    limit: LIMIT,
  });

  console.log(`\n[대상 산출] founders 문서 ${founderDocs}건`);
  console.log(
    `  발송 대상(beta_active ∩ 게이트통과 ∩ 미발송): ${result.eligible.length}명`,
  );
  console.log(`  제외 — 선정 아님        : ${result.skipped.notSelected}`);
  console.log(`  제외 — 그랜트 만료      : ${result.skipped.grantExpired}`);
  console.log(`  제외 — 그랜트 없음/비활성: ${result.skipped.noActiveGrant}`);
  console.log(`  제외 — 하드옵트아웃/무효주소: ${result.skipped.gateBlocked}`);
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
    `release-update-${RELEASE_UPDATE_VERSION}.html`,
  );
  writeFileSync(previewPath, content.html, "utf8");

  console.log(`\n[메일 미리보기]`);
  console.log(`  제목: ${content.subject}`);
  console.log(`  HTML: ${previewPath} (${content.html.length} bytes)`);
  console.log(`  ── 텍스트 본문 ──\n`);
  console.log(
    content.text
      .split("\n")
      .map((l) => `  | ${l}`)
      .join("\n"),
  );
  if (PRINT_HTML) {
    console.log(`\n  ── HTML ──\n${content.html}\n`);
  }

  if (!SEND) {
    console.log(
      `\n✅ dry-run 종료 — 0통 발송. 실발송하려면 승인 후:\n` +
        `   npm run announce:update -- --send --confirm=${RELEASE_UPDATE_CONFIRM}\n`,
    );
    return;
  }

  // ── 실발송 경로 — 2차 게이트 ──
  if (!CONFIRM_OK) {
    throw new Error(
      `실발송하려면 --confirm=${RELEASE_UPDATE_CONFIRM} 가 필요하다(오발송 방지). ` +
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
    const ok = await sendOne(target.email, content);
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
  console.error(`[release-update] 중단: ${(err as Error).message}`);
  process.exitCode = 1;
});
