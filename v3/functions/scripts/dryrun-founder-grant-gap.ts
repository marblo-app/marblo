#!/usr/bin/env node
/**
 * 선정 65 vs 접근권 34 — **왜 31명에게 grant 가 안 붙었나** 드라이런.
 * 티켓 cw6lqyiFtspyx3LONt8y.
 *
 * ★읽기 전용이다. `--apply` 플래그가 **아예 없고**, Firestore/Identity Toolkit
 * 에 대한 쓰기 호출(PATCH/POST 문서쓰기)을 하나도 하지 않는다. 되살리기는
 * 사장님 승인 사안이라, 이 스크립트가 실수로 실행본이 될 여지를 남기지 않는다.
 * (#1305 의 dryrun-founder-beta-retro-extend.mjs 와 같은 규약.)
 *
 * 실행:
 *   GCLOUD_PROJECT=marblo-2253d npm run dryrun:founder-grant-gap
 *
 * ★실측 결과와 근본 수리 제안: docs/founder-grant-gap-2026-08-29.md
 *   (요약: 갭 30 = 계정 없음 30, 100%. 되살리기 대상이 #1305 와 동일 집합이라
 *    별도 백필 실행은 권하지 않는다. 진짜 결함은 window_expired 의 조용한 스킵.)
 *
 * ★⑥절은 그 근본 수리(R1)의 전/후 시뮬레이션이다 — 배포본과 **같은 함수**
 * (resolveFounderGrantWindowAtMaterialization)를 태워 "지금 가입하면 무엇을
 * 받나"를 수리 전/후로 나란히 찍는다. 수리 리포트: docs/founder-grant-anchor-repair-2026-08-29.md
 *
 * Auth: gcloud ADC OAuth + Firestore/Identity Toolkit REST
 *       (backfill-founder-pro-grants.mjs 와 동일).
 *
 * ── ★판정 로직을 여기 복제하지 않는다 ──────────────────────────────────────
 * #1305 가 남긴 교훈이다: dryrun 의 .mjs 복제본과 src 의 실행본이 갈리면 드라이런
 * 숫자가 실행과 어긋나 판단 근거가 되지 못한다. 판정의 단일 소스는
 * `src/founderGrantGap.ts` 이고 이 스크립트는 **조회와 출력만** 한다.
 *
 * ── PII ────────────────────────────────────────────────────────────────────
 * 원문 이메일·uid 를 출력하지 않는다. 사람은 sha256 앞 10자, uid 는 앞 6자만.
 * 토큰은 어떤 경로로도 찍지 않는다. ★완료보고에는 개수와 분포만 쓴다.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  FOUNDER_BETA_MONTHS,
  FOUNDER_LEGACY_BETA_MONTHS,
} from "../src/founderLadder";
import {
  FounderGrantWindowDecision,
  GapAccountFacts,
  GapFounderFacts,
  GapSubscriptionFacts,
  GrantGapDiagnosis,
  SELECTED_GAP_APPLY_CONFIRM,
  SELECTED_GAP_BACKFILL_AT_FIELD,
  SELECTED_GAP_BACKFILL_REASON,
  diagnoseGrantGap,
  isFounderGrantSubscription,
  isMissingAccess,
  planGrantBackfill,
  resolveFounderGrantWindowAtMaterialization,
  resolveGrantWindowEndMs,
} from "../src/founderGrantGap";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE_SIZE = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

if (!PROJECT_ID) {
  throw new Error(
    "Missing project id. Set GCLOUD_PROJECT=marblo-2253d before running.",
  );
}

function getAccessToken(): string {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN)
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  return execFileSync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
}

const token = getAccessToken();

function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 10);
}

// ─── Firestore REST ──────────────────────────────────────────────────────────

type FirestoreValue = Record<string, unknown>;
interface FirestoreDoc {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

function firestoreUrl(documentPath: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${documentPath}`;
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok)
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return (await res.json()) as T;
}

function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return new Date(String(value.timestampValue));
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  return undefined;
}

function documentData(doc: FirestoreDoc): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(doc.fields || {}).map(([k, v]) => [
      k,
      fromFirestoreValue(v),
    ]),
  );
}

function docId(name: string | undefined): string {
  return (name || "").split("/").at(-1) || "";
}

async function listCollection(path: string): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await fetchJson<{
      documents?: FirestoreDoc[];
      nextPageToken?: string;
    }>(`${firestoreUrl(path)}?${params.toString()}`);
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return docs;
}

interface IdentityUser {
  localId?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

async function lookupUserByEmail(email: string): Promise<IdentityUser | null> {
  try {
    const json = await fetchJson<{ users?: IdentityUser[] }>(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
        PROJECT_ID,
      )}/accounts:lookup`,
      { method: "POST", body: JSON.stringify({ email: [email] }) },
    );
    return (json.users || [])[0] || null;
  } catch {
    return null;
  }
}

async function getSubscription(
  uid: string,
): Promise<Record<string, unknown> | null> {
  try {
    return documentData(
      await fetchJson<FirestoreDoc>(
        firestoreUrl(`subscriptions/${encodeURIComponent(uid)}`),
      ),
    );
  } catch (err) {
    if (String((err as Error).message || err).startsWith("404 ")) return null;
    throw err;
  }
}

// ─── 사실 추출 ───────────────────────────────────────────────────────────────

function ms(value: unknown): number | null {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.getTime()
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * ★결제 흔적은 index.ts hasPaymentEvidence 보다 **넓게** 본다. 그 함수는 portone
 * 키를 일부만 보고(churnOutreach 주석의 실측 사례: portone billingKey 를 가진
 * 현역 결제자를 "결제 흔적 없음"으로 판정), 여기서 좁게 보면 현역 결제자를
 * 백필 대상에 넣는 방향으로 틀린다. 오판은 안전쪽(=건드리지 않음)으로 둔다.
 */
function hasPaymentEvidence(sub: Record<string, unknown>): boolean {
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

function toSubscriptionFacts(
  sub: Record<string, unknown> | null,
): GapSubscriptionFacts | null {
  if (!sub) return null;
  return {
    status: str(sub.status),
    planType: str(sub.planType),
    founderGrant: sub.founderGrant === true,
    paymentProvider: str(sub.paymentProvider),
    hasPaymentEvidence: hasPaymentEvidence(sub),
    currentPeriodEndMs: ms(sub.currentPeriodEnd),
    founderGrantReason: str(sub.founderGrantReason),
  };
}

function toFounderFacts(founder: Record<string, unknown>): GapFounderFacts {
  return {
    status: str(founder.status),
    accessGrantedAtMs: ms(founder.accessGrantedAt),
    betaExpiresAtMs: ms(founder.betaExpiresAt),
    proExpiresAtMs: ms(founder.proExpiresAt),
    proSubscriptionUid: str(founder.proSubscriptionUid),
  };
}

// ─── 출력 도우미 ─────────────────────────────────────────────────────────────

function iso(msValue: number | null): string {
  return typeof msValue === "number"
    ? new Date(msValue).toISOString().slice(0, 10)
    : "-";
}

function pad(n: number): string {
  return String(n).padStart(4);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

/** 진단 칸의 한국어 설명 — 표 하나로 원인이 읽혀야 한다. */
const DIAGNOSIS_LABEL: Record<GrantGapDiagnosis, string> = {
  not_selected: "선정자 아님(반려/accessGrantedAt 없음) — 분모에서 제외",
  grant_present: "grant 문서 있음 — 갭 아님(34 쪽)",
  paid_live: "★현역 유료 — 마커만 없고 접근권은 있다(갭 착시)",
  no_account: "★계정 없음 — 붙일 uid 자체가 없다",
  signup_after_window:
    "★창 닫힌 뒤 가입 — onCreate 가 window_expired 로 조용히 스킵",
  account_no_grant_window_open:
    "★계정 O·창 열림인데 없음 — 미확인(조용한 실패)",
  account_no_grant_unknown_signup: "계정 O·가입시각 미상 — 미확인",
};

interface Row {
  id: string;
  uid: string;
  diagnosis: GrantGapDiagnosis;
  accessGrantedAtMs: number | null;
  windowEndMs: number | null;
  accountCreatedAtMs: number | null;
  existingEndMs: number | null;
  /**
   * founders.accessEmailSent — 선정 안내 메일이 실제로 나갔는가.
   * ★"우리가 안 알렸다" 와 "알렸는데 안 왔다" 는 처방이 정반대라서 반드시 가른다.
   * (markFounderSelectedInternal 이 발송 결과를 이 필드에 기록한다.)
   */
  accessEmailSent: boolean | null;
  action: string;
  targetMs: number | null;
  planType: string | null;
  addedDays: number | null;
  /**
   * ★R1 시뮬레이션 — "이 사람이 **지금** 가입하면(=materialize 를 지금 태우면)
   * 무엇을 받는가". 수리 전/후를 같은 입력으로 나란히 돌린다.
   */
  currentGrantDays: number | null;
  repairedDecision: FounderGrantWindowDecision;
}

/** 수리 **전**(현재 배포본) materializeFounderProGrantForUid 의 판정 재현. */
function currentGrantDaysIfSignupNow(
  windowEndMs: number | null,
  nowMs: number,
): number | null {
  // `!windowEnd || windowEnd <= new Date()` → 조용한 스킵(부여 0).
  if (typeof windowEndMs !== "number" || windowEndMs <= nowMs) return null;
  return Math.round((windowEndMs - nowMs) / DAY_MS);
}

async function main(): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();

  console.log("═".repeat(78));
  console.log(
    "선정 vs 접근권 갭 진단 + 백필 드라이런 (READ-ONLY — 쓰기 호출 없음)",
  );
  console.log(
    `project=${PROJECT_ID} db=${DATABASE_ID} now=${now.toISOString()}`,
  );
  console.log(
    `정책: 백필 기간 ${FOUNDER_BETA_MONTHS}개월 · 앵커=now ` +
      `(legacy 창 재구성은 ${FOUNDER_LEGACY_BETA_MONTHS}개월 — 진단 전용)`,
  );
  console.log(`마커: founderGrantReason="${SELECTED_GAP_BACKFILL_REASON}"`);
  console.log("═".repeat(78));

  const founderDocs = await listCollection("founders");
  console.log(`founders 문서: ${founderDocs.length}건\n`);

  const diagnoses = new Map<string, number>();
  const actions = new Map<string, number>();
  const rows: Row[] = [];
  let selected = 0;
  // 34 라는 숫자가 어느 술어로 나온 값인지 확인한다. 두 술어가 갈리면 그 사실
  // 자체가 보고 대상이다(founderGrant 플래그 vs paymentProvider 문자열).
  let grantByFlag = 0;
  let grantByProvider = 0;
  let grantActive = 0;

  for (const doc of founderDocs) {
    const raw = documentData(doc);
    const email = String(raw.email || docId(doc.name))
      .trim()
      .toLowerCase();
    const founder = toFounderFacts(raw);

    let uid = founder.proSubscriptionUid;
    let createdAtMs: number | null = null;
    const authUser = email ? await lookupUserByEmail(email) : null;
    if (authUser?.localId) {
      uid = authUser.localId;
      const created = Number(authUser.createdAt);
      createdAtMs = Number.isFinite(created) && created > 0 ? created : null;
    }
    // ★proSubscriptionUid 만 있고 Auth 조회가 실패한 경우는 "계정 있음"으로
    // 세지 않는다 — 가입 시각을 모르면 창 판정을 못 하고, 계정 유무를 근거
    // 없이 낙관하면 처방이 뒤바뀐다.
    const account: GapAccountFacts | null = authUser?.localId
      ? { uid: authUser.localId, createdAtMs }
      : null;

    const sub = uid ? toSubscriptionFacts(await getSubscription(uid)) : null;

    if (
      founder.status !== "rejected" &&
      typeof founder.accessGrantedAtMs === "number"
    ) {
      selected++;
      if (sub?.founderGrant) grantByFlag++;
      if (sub?.paymentProvider === "founder_grant") grantByProvider++;
      if (
        (sub?.founderGrant || sub?.paymentProvider === "founder_grant") &&
        sub?.status === "active" &&
        (sub.currentPeriodEndMs == null || sub.currentPeriodEndMs > nowMs)
      ) {
        grantActive++;
      }
    }

    const diagnosis = diagnoseGrantGap(
      founder,
      account,
      sub,
      FOUNDER_LEGACY_BETA_MONTHS,
    );
    bump(diagnoses, diagnosis);

    const plan = planGrantBackfill(
      founder,
      account,
      sub,
      nowMs,
      FOUNDER_BETA_MONTHS,
    );
    const actionKey =
      plan.action === "skip" ? `skip:${plan.reason}` : plan.action;
    bump(actions, actionKey);

    rows.push({
      id: hashEmail(email),
      uid: account ? account.uid.slice(0, 6) : "-",
      diagnosis,
      accessGrantedAtMs: founder.accessGrantedAtMs,
      windowEndMs: resolveGrantWindowEndMs(founder, FOUNDER_LEGACY_BETA_MONTHS),
      accountCreatedAtMs: createdAtMs,
      existingEndMs: sub?.currentPeriodEndMs ?? null,
      accessEmailSent:
        typeof raw.accessEmailSent === "boolean"
          ? raw.accessEmailSent
          : raw.accessEmailSentAt instanceof Date
            ? true
            : null,
      action: actionKey,
      targetMs:
        plan.action === "grant"
          ? plan.periodEndMs
          : plan.action === "open_window"
            ? plan.newBetaExpiresAtMs
            : null,
      planType: plan.action === "grant" ? plan.planType : null,
      addedDays: plan.action === "grant" ? plan.addedDays : null,
      currentGrantDays: currentGrantDaysIfSignupNow(
        resolveGrantWindowEndMs(founder, FOUNDER_LEGACY_BETA_MONTHS),
        nowMs,
      ),
      // ★부여 경로가 실제로 쓰는 함수를 그대로 태운다. 여기서 규칙을 다시 적으면
      // 드라이런 숫자가 배포본과 갈려 판단 근거가 되지 못한다.
      repairedDecision: resolveFounderGrantWindowAtMaterialization(
        founder,
        {
          proSubscriptionUid: founder.proSubscriptionUid,
          proSubscriptionGrantedAtMs: ms(raw.proSubscriptionGrantedAt),
          hasFounderGrantSubscription: isFounderGrantSubscription(sub),
        },
        nowMs,
        FOUNDER_LEGACY_BETA_MONTHS,
        FOUNDER_BETA_MONTHS,
      ),
    });
  }

  // ── ① 사다리 재현 ─────────────────────────────────────────────────────────
  console.log(
    "── ① 사다리 재현 ──────────────────────────────────────────────",
  );
  console.log(`  선정(accessGrantedAt 존재 · 미반려):        ${pad(selected)}`);
  console.log(
    `  grant 문서 · founderGrant 플래그 기준:      ${pad(grantByFlag)}`,
  );
  console.log(
    `  grant 문서 · paymentProvider 문자열 기준:   ${pad(grantByProvider)}`,
  );
  console.log(
    `  그중 현재 유효(active · 미만료):            ${pad(grantActive)}`,
  );
  console.log(
    `  ★갭(선정 − grant 플래그):                  ${pad(selected - grantByFlag)}`,
  );
  if (grantByFlag !== grantByProvider) {
    console.log(
      "  ⚠ 두 술어의 수가 다르다 — 결제 전환으로 paymentProvider 가 덮인 문서가 있다는 뜻.",
    );
  }

  // ── ② 원인 진단 분포 ─────────────────────────────────────────────────────
  console.log(
    "\n── ② ★원인 진단 (상호배타 · 합 = founders 전체) ───────────────",
  );
  const order: GrantGapDiagnosis[] = [
    "grant_present",
    "paid_live",
    "no_account",
    "signup_after_window",
    "account_no_grant_window_open",
    "account_no_grant_unknown_signup",
    "not_selected",
  ];
  for (const key of order) {
    console.log(
      `  ${pad(diagnoses.get(key) || 0)}  ${key.padEnd(31)} ${DIAGNOSIS_LABEL[key]}`,
    );
  }
  const missing = rows.filter((r) => isMissingAccess(r.diagnosis)).length;
  console.log(`\n  ★실제로 접근권을 못 쓰는 인원: ${missing}명`);
  console.log(
    `    (갭 ${selected - grantByFlag}명 중 paid_live ${
      diagnoses.get("paid_live") || 0
    }명은 돈 내고 쓰는 중 — 되살릴 대상이 아니다)`,
  );

  // ── ③ 두 덩어리 ──────────────────────────────────────────────────────────
  const noAccount = diagnoses.get("no_account") || 0;
  const withAccount = missing - noAccount;
  console.log(
    "\n── ③ ★두 덩어리 (처방이 완전히 다르다) ────────────────────────",
  );
  console.log(
    `  계정 O : ${pad(withAccount)} — uid 가 있다. grant 만 붙이면 **즉시** 쓸 수 있다.`,
  );
  console.log(
    `  계정 X : ${pad(noAccount)} — uid 가 없다. 가입이 먼저다. grant 를 미리 못 만든다.`,
  );

  // ── ④ 백필 계획 ──────────────────────────────────────────────────────────
  console.log(
    "\n── ④ 백필 드라이런 결과 ───────────────────────────────────────",
  );
  for (const [k, v] of [...actions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(v)}  ${k}`);
  }

  const grants = rows.filter((r) => r.action === "grant");
  console.log(`\n  [계정 O] 즉시 부여 대상 ${grants.length}건 — 전/후`);
  console.log(
    "   id          uid     plan   기존만료      → 부여후만료    +일수",
  );
  for (const r of grants.sort(
    (a, b) => (b.addedDays || 0) - (a.addedDays || 0),
  )) {
    console.log(
      `   ${r.id}  ${r.uid.padEnd(6)}  ${(r.planType || "-").padEnd(5)}  ` +
        `${iso(r.existingEndMs).padEnd(12)} → ${iso(r.targetMs).padEnd(12)}  +${r.addedDays}일`,
    );
  }

  const opens = rows.filter((r) => r.action === "open_window");
  console.log(
    `\n  [계정 X] 창만 열기 ${opens.length}건 — 전/후 (구독은 안 생긴다)`,
  );
  console.log("   id          선정일        기존창        → 새 창");
  for (const r of opens.sort(
    (a, b) => (a.accessGrantedAtMs || 0) - (b.accessGrantedAtMs || 0),
  )) {
    console.log(
      `   ${r.id}  ${iso(r.accessGrantedAtMs).padEnd(12)}  ` +
        `${iso(r.windowEndMs).padEnd(12)} → ${iso(r.targetMs)}`,
    );
  }

  // ── ⑤ 근거 재료 ──────────────────────────────────────────────────────────
  console.log(
    "\n── ⑤ 판단 재료 ────────────────────────────────────────────────",
  );
  const missingRows = rows.filter((r) => isMissingAccess(r.diagnosis));
  const closedWindow = missingRows.filter(
    (r) => typeof r.windowEndMs === "number" && r.windowEndMs <= nowMs,
  ).length;

  // ★가설 검증: "이메일은 갔는데 안 눌렀다" vs "우리가 안 알렸다".
  // 처방이 정반대다 — 전자는 문면·재발송 문제이고, 후자는 발송 파이프라인
  // 장애다. 숫자를 보기 전에 둘 중 하나로 단정하면 안 된다.
  const mailSent = missingRows.filter((r) => r.accessEmailSent === true).length;
  const mailFailed = missingRows.filter(
    (r) => r.accessEmailSent === false,
  ).length;
  const mailUnknown = missingRows.length - mailSent - mailFailed;
  console.log(
    `  선정 안내 메일: 발송 O ${mailSent}명 · 발송 실패 ${mailFailed}명 · 기록 없음 ${mailUnknown}명`,
  );
  console.log(
    "    → 발송 O 가 대부분이면 '안 알렸다'가 아니라 '알렸는데 안 왔다' 다(문면·유인 문제).",
  );
  console.log(
    `  창이 이미 닫힌 미부여자: ${closedWindow}명 / ${missing}명 — ` +
      "★이들은 지금 가입해도 window_expired 로 부여가 0이다.",
  );
  console.log(
    "  → 계정 X 에게 안내 메일만 보내면 그 메일은 거짓이 된다. founders.betaExpiresAt 을",
  );
  console.log(
    "    먼저 열어야 '가입하시면 쓰실 수 있습니다'가 참이 된다(#1305 와 같은 함정).",
  );

  // ── ⑥ ★R1 시뮬레이션 — 수리 전/후, "지금 가입하면 무엇을 받나" ───────────
  //
  // 이 티켓의 완료 기준이자 #1305 발송의 선행조건이다. 창을 열지 않고 "가입
  // 하세요" 메일을 보내면 사용자가 시키는 대로 해도 아무것도 안 생긴다.
  console.log(
    "\n── ⑥ ★R1 시뮬레이션: 지금 가입하면 무엇을 받나 (수리 전 → 후) ─",
  );
  const beta = `${FOUNDER_BETA_MONTHS}개월`;
  const sim = missingRows;
  const beforeZero = sim.filter((r) => r.currentGrantDays === null).length;
  const beforeShort = sim.filter(
    (r) => typeof r.currentGrantDays === "number" && r.currentGrantDays < 80,
  ).length;
  const afterReanchor = sim.filter(
    (r) =>
      r.repairedDecision.kind === "grant" &&
      r.repairedDecision.anchor === "signup_reanchor",
  ).length;
  const afterSkip = sim.filter((r) => r.repairedDecision.kind === "skip").length;
  const afterFull = sim.filter(
    (r) =>
      r.repairedDecision.kind === "grant" &&
      r.repairedDecision.windowEndMs - nowMs >= 80 * DAY_MS,
  ).length;

  console.log(`  대상: 접근권을 못 쓰는 ${sim.length}명`);
  console.log(
    `  [수리 전] 부여 0(조용한 스킵): ${pad(beforeZero)}명 · 잔여만(<80일): ${pad(
      beforeShort,
    )}명`,
  );
  console.log(
    `  [수리 후] 재앵커(=${beta} 전액): ${pad(afterReanchor)}명 · 스킵: ${pad(
      afterSkip,
    )}명`,
  );
  console.log(
    `  ★${beta}(80일 이상) 를 받는 인원: 수리 전 ${
      sim.length - beforeZero - beforeShort
    }명 → 수리 후 ${afterFull}명`,
  );
  if (afterSkip > 0) {
    console.log(
      "  ⚠ 스킵이 남아 있다 — 소비 이력이 있는데 창이 닫힌 사람이다(앵커를 옮기지 않는 게 맞다).",
    );
  }
  console.log("\n   id          진단                  수리전       → 수리후");
  for (const r of sim.sort(
    (a, b) => (a.accessGrantedAtMs || 0) - (b.accessGrantedAtMs || 0),
  )) {
    const before =
      r.currentGrantDays === null ? "부여 0" : `${r.currentGrantDays}일`;
    const after =
      r.repairedDecision.kind === "skip"
        ? `skip:${r.repairedDecision.reason}`
        : `${Math.round(
            (r.repairedDecision.windowEndMs - nowMs) / DAY_MS,
          )}일 (${iso(r.repairedDecision.windowEndMs)}, ${
            r.repairedDecision.anchor
          })`;
    console.log(
      `   ${r.id}  ${r.diagnosis.padEnd(20)}  ${before.padEnd(10)} → ${after}`,
    );
  }

  // ★불변식 검사 — 수리가 **누구의 만료일도 앞당기지 않는다**. 선정자 전수로 본다.
  const shrunk = rows.filter(
    (r) =>
      r.repairedDecision.kind === "grant" &&
      typeof r.windowEndMs === "number" &&
      r.repairedDecision.windowEndMs < r.windowEndMs,
  ).length;
  const movedConsumed = rows.filter(
    (r) =>
      r.diagnosis === "grant_present" &&
      r.repairedDecision.kind === "grant" &&
      r.repairedDecision.anchor === "signup_reanchor",
  ).length;
  console.log(
    `\n  ★불변식 ① 만료일이 앞당겨지는 사람: ${shrunk}명 (0이어야 한다)`,
  );
  console.log(
    `  ★불변식 ② 이미 소비한(grant 보유) 사람의 앵커가 옮겨지는 건: ${movedConsumed}명 (0이어야 한다)`,
  );

  console.log(
    "\n── ⑦ 회수 경로 ────────────────────────────────────────────────",
  );
  console.log(
    `  마커: subscriptions.founderGrantReason == "${SELECTED_GAP_BACKFILL_REASON}"`,
  );
  console.log(
    `  스탬프: founders.${SELECTED_GAP_BACKFILL_AT_FIELD} (멱등키 · 재실행 방지)`,
  );
  console.log(
    "  회수: 위 마커로 조회 → status=canceled, currentPeriodEnd=now 로 되돌린다.",
  );
  console.log("        (markFounderRejected 의 grant 회수 경로와 동일한 모양)");
  console.log(
    "  ★코호트 분리: 이 마커 하나로 백필 인원을 리텐션 지표에서 떼어낼 수 있다.",
  );

  console.log("\n★실행하지 않았다. 이 스크립트에는 --apply 가 없다.");
  console.log(
    `  승인 후 별도 실행본이 필요하고, 그 실행본은 --confirm=${SELECTED_GAP_APPLY_CONFIRM} 를 요구해야 한다.`,
  );
}

main().catch((err: unknown) => {
  console.error("드라이런 실패:", (err as Error).message || err);
  process.exit(1);
});
