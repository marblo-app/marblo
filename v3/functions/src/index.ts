import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";
import {
  enforce as enforceRateLimit,
  extractIp,
  COUPON_RULES_UID,
  COUPON_RULES_IP,
} from "./rateLimit";
import { reconcileTossPending, reconcilePaddlePending } from "./reconciliation";
import { redactSecrets } from "./redact";
import {
  parseIncludeAdmin,
  parseMetricMode,
  metricCountExpr,
  EMPTY_EXCLUSION,
  buildOnboardingFunnel,
  ONBOARDING_FUNNEL_STEPS,
  ONBOARDING_FAILURE_EVENTS,
  buildKpiCockpit,
  buildCliSetupSummary,
  buildReleaseHealth,
  buildModelBreakdown,
  buildCostByDayModel,
  buildRetentionCohorts,
  buildActiveUserMetrics,
  buildActivationGateFunnel,
  ACTIVATION_GATE_STEPS,
  type ReasonRow,
  type CliSetupStepRow,
  type ReleaseVersionSourceRow,
  type ReleaseAdoptionSourceRow,
  type ModelBridgeSourceRow,
  type HarnessAgentRow,
  type CostByDayModelSourceRow,
  type RetentionCohortSourceRow,
  type ActiveByDaySourceRow,
  type ThirtyDayRetentionSourceRow,
} from "./adminAnalytics";
import { buildProjectAudit, toMillis } from "./projectAudit";
import {
  verifyPaddleSignature,
  classifyTossPaymentResponse,
  resolveTossWebhookAction,
  type TossPaymentQueryResult,
} from "./webhookVerify";
import {
  MARKETING_CONTACTS_COLLECTION,
  CONSENT_EVENTS_SUBCOLLECTION,
  MARKETING_CONTACTS_BQ_SCHEMA,
  contactIdForEmail,
  emailDomainOf,
  encryptEmail,
  parseEncKey,
  sha256Hex,
  normalizeMarketingEmail,
  unsubscribeTokenForContact,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  isEmailable,
  deriveLifecycleStage,
  deriveSegments,
  contactToBqRow,
  mergeEmailConsent,
  decideMarketingConsentSync,
  backfillConsentGrantFromUserDoc,
  decideWaitlistConsentGrant,
  marketingConsentStatusResponse,
  type UserDocRaw,
  type WaitlistDocRaw,
  type ContactFlags,
  type ContactSource,
  type ContactSubscription,
  type MarketingContactDoc,
  type EmailMarketingConsent,
} from "./marketingContacts";
import {
  planAmountKRW,
  normalizeBillingCycle,
  applyCouponDiscount,
  nextPeriodEnd,
  billingChargeDocId,
  billingOrderId,
  firstChargeLedgerId,
  firstChargeOrderId,
  firstChargePortoneNonce,
  resolveFirstChargeGeneration,
  isAlreadySubscribed,
  selectDueForCharge,
  applyChargeSuccess,
  applyChargeFailure,
  hasPaymentEvidence as hasBillingPaymentEvidence,
  type SubscriptionSnapshot,
  type BillingCycle,
  type FirstChargeProvider,
} from "./billing";
import {
  portoneChargeDocId,
  portoneExpectedAmount,
  portonePaymentId,
  validatePortOnePaidPayment,
  type PortOnePaymentLike,
} from "./portone";
import { resolveEntitledPlan } from "./entitlement";
import { MAX_COST_LOGS_LIMIT, normalizeCostLogsLimit } from "./costLogsLimit";

function getFirebaseProjectId(): string | undefined {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GCP_PROJECT) return process.env.GCP_PROJECT;

  const rawConfig = process.env.FIREBASE_CONFIG;
  if (!rawConfig) return undefined;

  try {
    const parsed = JSON.parse(rawConfig) as { projectId?: unknown };
    return typeof parsed.projectId === "string" ? parsed.projectId : undefined;
  } catch {
    return undefined;
  }
}

const firebaseProjectId = getFirebaseProjectId();
const customTokenServiceAccountId =
  process.env.CUSTOM_TOKEN_SERVICE_ACCOUNT_ID ||
  (firebaseProjectId ? `${firebaseProjectId}@appspot.gserviceaccount.com` : "");

admin.initializeApp(
  customTokenServiceAccountId
    ? { serviceAccountId: customTokenServiceAccountId }
    : undefined,
);
const db = admin.firestore();
const BQ_LOCATION = "US";
const bigquery = new BigQuery({ location: BQ_LOCATION });

const BQ_DATASET = "marblo_telemetry";
const BQ_EVENTS_TABLE = "events";
const BQ_COST_TABLE = "cost_logs";
const ADMIN_ANALYTICS_RUNTIME_OPTIONS: functions.RuntimeOptions = {
  timeoutSeconds: 60,
  memory: "512MB",
};
const GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN =
  process.env.GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN || "";

type BigQueryRow = Record<string, unknown>;
type BigQueryRows = BigQueryRow[];

interface AdminAnalyticsQuerySpec {
  name: string;
  query: string;
  params: Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runAdminAnalyticsQueries(
  specs: readonly AdminAnalyticsQuerySpec[],
): Promise<BigQueryRows[]> {
  const settled = await Promise.allSettled(
    specs.map((spec) =>
      bigquery.query({
        query: spec.query,
        params: spec.params,
        location: BQ_LOCATION,
      }),
    ),
  );

  return settled.map((result, index) => {
    const spec = specs[index];
    if (result.status === "fulfilled") {
      const [rows] = result.value;
      return rows as BigQueryRows;
    }

    functions.logger.error("Admin analytics BigQuery query failed", {
      queryName: spec?.name ?? `query_${index}`,
      error: errorMessage(result.reason),
    });
    return [];
  });
}

type MergeChangeType =
  | "docs"
  | "test"
  | "config"
  | "code"
  | "mixed"
  | "unknown";

interface GitHubMergeHistoryPayload {
  prNumber?: unknown;
  taskId?: unknown;
  taskId8?: unknown;
  mergedAt?: unknown;
  branch?: unknown;
  baseRef?: unknown;
  headSha?: unknown;
  repository?: unknown;
  owner?: unknown;
  filesChanged?: unknown;
  linesAdded?: unknown;
  linesDeleted?: unknown;
  paths?: unknown;
}

function parseMarbloTaskPrefix(branch: string): string | null {
  const normalized = branch.replace(/^refs\/heads\//, "");
  const match = normalized.match(/^marblo\/[^/\s]+-([A-Za-z0-9]{8})$/);
  return match?.[1] ?? null;
}

function sanitizeDocIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 160);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n >= 0 ? n : null;
}

function categorizeMergePath(p: string): "docs" | "test" | "config" | "code" {
  const lower = p.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    /(^|\/)(tests?|__tests__|e2e|__mocks__)(\/|$)/.test(lower)
  ) {
    return "test";
  }
  if (
    /\.(md|mdx|markdown|rst|txt|adoc)$/.test(base) ||
    /(^|\/)docs?(\/|$)/.test(lower) ||
    /^(readme|changelog|license|contributing|authors)\b/.test(base)
  ) {
    return "docs";
  }
  if (
    /\.(json|ya?ml|toml|ini|cfg|conf|lock|env|properties)$/.test(base) ||
    /\.(config|rc)\.[cm]?[jt]s$/.test(base) ||
    /^\.[a-z]/.test(base) ||
    /(^|\/)(dockerfile|makefile)$/.test(lower)
  ) {
    return "config";
  }
  return "code";
}

function classifyMergeChangeType(paths: string[]): MergeChangeType {
  const categories = new Set<string>();
  for (const p of paths) {
    if (p.trim()) categories.add(categorizeMergePath(p));
  }
  if (categories.size === 0) return "unknown";
  if (categories.has("code")) return "code";
  if (categories.size === 1) return [...categories][0] as MergeChangeType;
  return "mixed";
}

async function resolveFullTaskIdFromPrefix(taskId8: string): Promise<{
  taskId: string;
  projectId: string;
} | null> {
  const end = `${taskId8}\uf8ff`;
  const snap = await db
    .collection("tasks")
    .where(admin.firestore.FieldPath.documentId(), ">=", taskId8)
    .where(admin.firestore.FieldPath.documentId(), "<=", end)
    .limit(2)
    .get();

  if (snap.empty) return null;
  if (snap.size > 1) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Ambiguous task prefix: ${taskId8}`,
    );
  }

  const doc = snap.docs[0];
  const projectId = asNonEmptyString(doc.get("projectId"));
  if (!projectId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Task ${doc.id} has no projectId`,
    );
  }
  return { taskId: doc.id, projectId };
}

// ═══════════════════════════════════════════════════════════════════
// Agent Firebase Auth
// ═══════════════════════════════════════════════════════════════════

export const issueAgentCustomToken = functions.https.onCall(
  async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    let customToken: string;
    try {
      customToken = await admin
        .auth()
        .createCustomToken(context.auth.uid, { marbloAgentAuth: true });
    } catch (err) {
      const code =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        typeof (err as { code?: unknown }).code === "string"
          ? (err as { code: string }).code
          : "unknown";
      console.error(
        `[issueAgentCustomToken] createCustomToken failed (${code})`,
      );
      throw new functions.https.HttpsError(
        "internal",
        `Agent custom token signing failed (${code}).`,
      );
    }

    return {
      customToken,
      uid: context.auth.uid,
    };
  },
);

/**
 * GitHub PR merge capture for the gh/Actions path that bypasses Electron's
 * in-app Merge button. Converges on the same sinks and de-identified fields as
 * electron/main.ts recordMergeHistory: Firestore `merge_history` +
 * BigQuery `events` event=`task:merged`.
 */
export const recordGitHubMergeHistory = functions.https.onRequest(
  async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST").status(405).send("Method Not Allowed");
      return;
    }

    if (!GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN) {
      functions.logger.warn(
        "[recordGitHubMergeHistory] webhook token is not configured",
      );
      res.status(503).json({ ok: false, error: "webhook_not_configured" });
      return;
    }

    const auth = req.header("authorization") || "";
    const expected = `Bearer ${GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN}`;
    if (auth !== expected) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const body = (req.body || {}) as GitHubMergeHistoryPayload;
    const branch = asNonEmptyString(body.branch);
    const parsedPrefix = branch ? parseMarbloTaskPrefix(branch) : null;
    const providedPrefix =
      asNonEmptyString(body.taskId8) || asNonEmptyString(body.taskId);
    const taskId8 = parsedPrefix || providedPrefix;

    // External or manually named PRs do not carry the Marblo task id prefix.
    if (!branch || !taskId8 || taskId8.length !== 8) {
      res.status(200).json({ ok: true, skipped: "unparseable_branch" });
      return;
    }

    const prNumber = asNonNegativeInt(body.prNumber);
    const mergedAtRaw = asNonEmptyString(body.mergedAt);
    const mergedAt = mergedAtRaw ? new Date(mergedAtRaw) : null;
    const owner = asNonEmptyString(body.owner) || "unknown-owner";
    const repository = asNonEmptyString(body.repository) || "unknown-repo";
    const baseRef = asNonEmptyString(body.baseRef) || "main";
    const headSha = asNonEmptyString(body.headSha) || "";
    const filesChanged = asNonNegativeInt(body.filesChanged);
    const linesAdded = asNonNegativeInt(body.linesAdded);
    const linesDeleted = asNonNegativeInt(body.linesDeleted);
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p): p is string => typeof p === "string")
      : [];
    const changeType = classifyMergeChangeType(paths);

    if (prNumber === null || !mergedAt || Number.isNaN(mergedAt.getTime())) {
      res.status(400).json({ ok: false, error: "invalid_merge_payload" });
      return;
    }

    let task;
    try {
      task = await resolveFullTaskIdFromPrefix(taskId8);
    } catch (err) {
      if (err instanceof functions.https.HttpsError) {
        res.status(409).json({ ok: false, error: err.message });
        return;
      }
      throw err;
    }

    if (!task) {
      res.status(200).json({ ok: true, skipped: "task_not_found", taskId8 });
      return;
    }

    const mergeDocId = [
      "github",
      sanitizeDocIdPart(owner),
      sanitizeDocIdPart(repository),
      String(prNumber),
    ].join("_");
    const mergeRef = db.collection("merge_history").doc(mergeDocId);
    const mergeDoc = {
      projectId: task.projectId,
      taskId: task.taskId,
      repoRoot: `${owner}/${repository}`,
      branch,
      baseRef,
      headSha,
      mode: "auto",
      mergedAt: admin.firestore.Timestamp.fromDate(mergedAt),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      filesChanged: filesChanged ?? null,
      linesAdded: linesAdded ?? null,
      linesDeleted: linesDeleted ?? null,
      changeType,
      source: "github-actions",
      prNumber,
    };

    const created = await db.runTransaction(async (tx) => {
      const existing = await tx.get(mergeRef);
      if (existing.exists) return false;
      tx.create(mergeRef, mergeDoc);
      return true;
    });

    if (!created) {
      res.status(200).json({
        ok: true,
        skipped: "already_recorded",
        taskId: task.taskId,
        prNumber,
      });
      return;
    }

    const linesChanged = (linesAdded ?? 0) + (linesDeleted ?? 0);
    await bigquery
      .dataset(BQ_DATASET)
      .table(BQ_EVENTS_TABLE)
      .insert([
        {
          event: "task:merged",
          userId: "github-actions",
          appVersion: "github-actions",
          projectId: task.projectId,
          agentId: null,
          taskId: task.taskId,
          flowId: null,
          model: null,
          role: null,
          status: null,
          fromStatus: null,
          toStatus: null,
          durationMs: null,
          tokensInput: null,
          tokensOutput: null,
          cost: null,
          success: true,
          exitCode: null,
          nodeType: null,
          nodeCount: null,
          metadata: JSON.stringify({
            mergeMode: "auto",
            source: "github-actions",
            prNumber,
            branch,
            linesAdded: linesAdded ?? 0,
            linesDeleted: linesDeleted ?? 0,
            changeType,
          }),
          taskType: changeType,
          taskComplexity: null,
          filesChanged: filesChanged ?? null,
          linesChanged,
          errorCategory: null,
          errorMessage: null,
          promptHash: null,
          promptLength: null,
          parentAgentId: null,
          retryOf: null,
          timestamp: mergedAt.toISOString(),
        },
      ]);

    res.status(200).json({
      ok: true,
      recorded: true,
      taskId: task.taskId,
      prNumber,
    });
  },
);

// ─── Config ──────────────────────────────────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY!;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET!;
const PADDLE_API_BASE = "https://api.paddle.com";

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY!;
const TOSS_API_BASE = "https://api.tosspayments.com/v1";

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET || "";
const PORTONE_STORE_ID = process.env.PORTONE_STORE_ID || "";
const PORTONE_INICIS_ONETIME_CHANNEL_KEY =
  process.env.PORTONE_INICIS_ONETIME_CHANNEL_KEY || "";
const PORTONE_INICIS_BILLING_CHANNEL_KEY =
  process.env.PORTONE_INICIS_BILLING_CHANNEL_KEY || "";
const PORTONE_API_BASE = "https://api.portone.io";

// ─── SendGrid (파운더 접근 안내 이메일) ──────────────────────────────
// 전부 선택값 — 미설정 시 발송만 스킵하고 배포·선정은 정상 동작한다.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
// ★모든 아웃바운드 이메일 발신·답장·푸터 문의처는 team@marblo.app 로 단일화
// (사장님 지시 2026-07-17, cf memory marblo_outbound_email_team_address).
// 이전 founders@/support@ 혼재를 하나로 통일. env override 는 유지하되 기본값을 team@ 로.
// ⚠️ ESP(Resend) 에 team@marblo.app 이 verified sender 로 등록돼 있어야 실발송이 통과한다.
const FOUNDER_FROM_EMAIL = process.env.FOUNDER_FROM_EMAIL || "team@marblo.app";
const FOUNDER_FROM_NAME = process.env.FOUNDER_FROM_NAME || "Marblo";
// 답장 주소도 team@marblo.app 로 고정(수신함 일원화).
const FOUNDER_REPLY_TO = process.env.FOUNDER_REPLY_TO || "team@marblo.app";
const FOUNDER_SUPPORT_EMAIL = "team@marblo.app";
const DISCORD_INVITE_URL = process.env.DISCORD_INVITE_URL || ""; // 설정 시에만 초대 링크 노출

// ─── marketing_contacts SoT config ──────────────────────────────────
// 값 출력 금지 — 존재 여부만 로그. 이름만 문서화(docs/MARKETING_CONTACTS.md).
//  - MARKETING_EMAIL_ENC_KEY: base64 32바이트. 컨택트 이메일 AES-256-GCM 암호화 키.
//  - MARKETING_UNSUB_SECRET: unsubscribe 토큰 HMAC 시크릿(stateless 검증).
const MARKETING_EMAIL_ENC_KEY = process.env.MARKETING_EMAIL_ENC_KEY || "";
const MARKETING_UNSUB_SECRET = process.env.MARKETING_UNSUB_SECRET || "";
// unsubscribe 링크가 가리킬 함수 베이스 URL (region=us-central1 고정 배포).
const FUNCTIONS_BASE_URL =
  process.env.FUNCTIONS_BASE_URL ||
  (firebaseProjectId
    ? `https://us-central1-${firebaseProjectId}.cloudfunctions.net`
    : "");
const SITE_BASE = "https://marblo.app";
const FOUNDER_COURSE_COUPON = "FOUNDER50"; // 강의 50% 할인 쿠폰 코드

// PLAN_PRICES_KRW 는 ./billing 로 이관(단일소스). import 참조.

// Map Paddle Price IDs to plan types (set in Firebase environment config)
const PADDLE_PRICE_TO_PLAN: Record<string, string> = {
  [process.env.PADDLE_PRO_PRICE_ID || ""]: "pro",
  [process.env.PADDLE_TEAM_PRICE_ID || ""]: "team",
};

// ═══════════════════════════════════════════════════════════════════
// Paddle Integration (해외 결제)
// ═══════════════════════════════════════════════════════════════════

// ─── Cancel Paddle Subscription ──────────────────────────────────
export const cancelPaddleSubscription = functions.https.onCall(
  async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const userId = context.auth.uid;
    const subSnap = await db.collection("subscriptions").doc(userId).get();

    if (!subSnap.exists || !subSnap.data()?.paddleSubscriptionId) {
      throw new functions.https.HttpsError(
        "not-found",
        "구독 정보를 찾을 수 없습니다.",
      );
    }

    const paddleSubId = subSnap.data()!.paddleSubscriptionId;

    const response = await fetch(
      `${PADDLE_API_BASE}/subscriptions/${paddleSubId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PADDLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ effective_from: "next_billing_period" }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Paddle cancel failed:", error);
      throw new functions.https.HttpsError(
        "internal",
        "구독 취소에 실패했습니다.",
      );
    }

    return { success: true };
  },
);

// ─── Webhook signature verification (H1) ─────────────────────────
//
// 위조된 웹훅으로 구독 상태를 조작하는 것을 막는다. 검증 로직은
// webhookVerify.ts 로 추출해 단위 테스트(tests/webhookVerify.test.mjs)로
// 커버한다 — 시크릿은 아래 호출부에서 env 상수로 주입한다.

// ─── Paddle Webhook ──────────────────────────────────────────────
export const paddleWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // H1: 서명 검증. 기존 코드는 헤더 '존재'만 확인해(`!signature && SECRET`)
  // 아무 값이나 넣으면 통과했다 — 서명 값 자체를 HMAC 으로 검증한다.
  const signature = (req.headers["paddle-signature"] as string) || "";
  if (!verifyPaddleSignature(signature, req.rawBody, PADDLE_WEBHOOK_SECRET)) {
    res.status(401).send("Invalid webhook signature");
    return;
  }

  const { event_type, data } = req.body;

  switch (event_type) {
    // Subscription activated (first payment successful)
    case "subscription.activated":
    case "subscription.created": {
      const customData = data.custom_data || {};
      const userId = customData.userId;
      if (!userId) break;

      // Determine plan type from price ID
      const priceId = data.items?.[0]?.price?.id || "";
      const planType = PADDLE_PRICE_TO_PLAN[priceId] || "pro";

      const currentPeriodStart = data.current_billing_period?.starts_at
        ? new Date(data.current_billing_period.starts_at)
        : new Date();
      const currentPeriodEnd = data.current_billing_period?.ends_at
        ? new Date(data.current_billing_period.ends_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db
        .collection("subscriptions")
        .doc(userId)
        .set({
          userId,
          planType,
          status: "active",
          paymentProvider: "paddle",
          paddleCustomerId: data.customer_id || null,
          paddleSubscriptionId: data.id,
          currentPeriodStart:
            admin.firestore.Timestamp.fromDate(currentPeriodStart),
          currentPeriodEnd:
            admin.firestore.Timestamp.fromDate(currentPeriodEnd),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      break;
    }

    // Subscription updated (plan change, renewal)
    case "subscription.updated": {
      const subscriptionId = data.id;

      const snap = await db
        .collection("subscriptions")
        .where("paddleSubscriptionId", "==", subscriptionId)
        .limit(1)
        .get();

      if (!snap.empty) {
        const docRef = snap.docs[0].ref;
        const update: Record<string, unknown> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (data.status === "active") update.status = "active";
        if (data.status === "past_due") update.status = "past_due";

        if (data.current_billing_period) {
          if (data.current_billing_period.starts_at) {
            update.currentPeriodStart = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.starts_at),
            );
          }
          if (data.current_billing_period.ends_at) {
            update.currentPeriodEnd = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.ends_at),
            );
          }
        }

        // Check if plan changed
        const priceId = data.items?.[0]?.price?.id || "";
        const newPlan = PADDLE_PRICE_TO_PLAN[priceId];
        if (newPlan) update.planType = newPlan;

        await docRef.update(update);
      }
      break;
    }

    // Subscription canceled
    case "subscription.canceled": {
      const subscriptionId = data.id;

      const snap = await db
        .collection("subscriptions")
        .where("paddleSubscriptionId", "==", subscriptionId)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: "canceled",
          planType: "free",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }

    // Payment failed
    case "transaction.payment_failed": {
      const subscriptionId = data.subscription_id;
      if (!subscriptionId) break;

      const snap = await db
        .collection("subscriptions")
        .where("paddleSubscriptionId", "==", subscriptionId)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }

    default:
      console.log(`Unhandled Paddle event: ${event_type}`);
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════════════
// TossPayments Integration (국내 결제)
// ═══════════════════════════════════════════════════════════════════

// ─── Create Toss Checkout ────────────────────────────────────────
export const createTossCheckout = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const { planType, billing } = data as {
      planType: string;
      billing?: string;
    };
    // 현재 호출부가 없는 경로지만(구독은 issueBillingKey 를 탄다) 여기서 월정가를
    // 직접 읽어두면 나중에 배선될 때 같은 버그가 되살아난다 — 금액은 예외 없이
    // planAmountKRW 로만 구한다.
    const billingCycle = normalizeBillingCycle(billing);
    const amount = planAmountKRW(planType, billingCycle);
    if (!amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 플랜입니다.",
      );
    }

    const userId = context.auth.uid;
    const orderId = `marblo_${planType}_${userId}_${Date.now()}`;

    await db.collection("pendingOrders").doc(orderId).set({
      userId,
      planType,
      billingCycle,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { orderId, amount, planType, billingCycle };
  },
);

// ─── Confirm Toss Payment ────────────────────────────────────────
export const confirmTossPayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const { orderId, paymentKey, amount } = data as {
      orderId: string;
      paymentKey: string;
      amount: number;
    };

    const orderSnap = await db.collection("pendingOrders").doc(orderId).get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "주문을 찾을 수 없습니다.",
      );
    }

    const order = orderSnap.data()!;
    // IDOR 가드: 본인 주문만 확인할 수 있다. orderId 는 클라이언트가 넘기고
    // 형식이 열거 가능(`marblo_<plan>_<uid>_<ts>`)하므로, 소유권 확인이 없으면
    // 인증된 사용자가 남의 orderId 로 구독을 활성화/덮어쓸 수 있다(그 doc 의
    // userId 로 subscriptions 가 기록됨). 실 익스플로잇은 유효 paymentKey 가
    // 게이트하지만, 방어심층으로 호출자 uid 와 주문 소유자를 대조한다.
    if (order.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다.",
      );
    }
    if (order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다.",
      );
    }

    const authHeader = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");

    const response = await fetch(`${TOSS_API_BASE}/payments/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("TossPayments confirm failed:", error);
      throw new functions.https.HttpsError(
        "internal",
        error.message || "결제 승인에 실패했습니다.",
      );
    }

    const payment = await response.json();
    const userId = order.userId;
    const planType = order.planType;

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db
      .collection("subscriptions")
      .doc(userId)
      .set({
        userId,
        planType,
        status: "active",
        paymentProvider: "toss",
        tossPaymentKey: paymentKey,
        tossCustomerKey: payment.customerKey || null,
        tossBillingKey: payment.card?.billingKey || null,
        currentPeriodStart: admin.firestore.Timestamp.fromDate(now),
        currentPeriodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    await db.collection("pendingOrders").doc(orderId).update({
      status: "confirmed",
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true };
  },
);

// ═══════════════════════════════════════════════════════════════════
// PortOne V2 Integration (KG이니시스 테스트모드)
// ═══════════════════════════════════════════════════════════════════

function assertPortOneServerConfig(): void {
  if (!PORTONE_API_SECRET || !PORTONE_STORE_ID) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "PortOne 서버 설정이 필요합니다.",
    );
  }
}

function assertPortOneCheckoutConfig(kind: "one_time" | "subscription"): string {
  assertPortOneServerConfig();
  const channelKey =
    kind === "subscription"
      ? PORTONE_INICIS_BILLING_CHANNEL_KEY
      : PORTONE_INICIS_ONETIME_CHANNEL_KEY;
  if (!channelKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "PortOne 채널 설정이 필요합니다.",
    );
  }
  return channelKey;
}

function objectField(data: unknown, key: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  return (data as Record<string, unknown>)[key];
}

function stringField(data: unknown, key: string): string | null {
  const value = objectField(data, key);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function fetchPortOnePayment(
  paymentId: string,
): Promise<PortOnePaymentLike> {
  assertPortOneServerConfig();
  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `PortOne ${PORTONE_API_SECRET}` },
    },
  );
  if (!res.ok) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "PortOne 결제내역 조회에 실패했습니다.",
    );
  }
  return (await res.json()) as PortOnePaymentLike;
}

async function payPortOneBillingKey(params: {
  paymentId: string;
  billingKey: string;
  channelKey: string;
  orderName: string;
  amount: number;
  customerId: string;
  customerEmail: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}): Promise<PortOnePaymentLike> {
  assertPortOneServerConfig();
  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(
      params.paymentId,
    )}/billing-key`,
    {
      method: "POST",
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storeId: PORTONE_STORE_ID,
        channelKey: params.channelKey,
        billingKey: params.billingKey,
        orderName: params.orderName,
        amount: { total: params.amount },
        currency: "KRW",
        customer: {
          id: params.customerId,
          email: params.customerEmail || undefined,
          // PortOne V2: name is { full: "..." }; missing name/phone can 500 on billing-key charge.
          name: params.customerName
            ? { full: params.customerName }
            : undefined,
          phoneNumber: params.customerPhone || undefined,
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof objectField(body, "message") === "string"
        ? String(objectField(body, "message")).slice(0, 300)
        : "PortOne 빌링키 결제에 실패했습니다.";
    throw new functions.https.HttpsError("internal", message);
  }
  // 즉시청구 POST 요약본은 top-level 필드 없어 검증불가, canonical GET 사용
  return fetchPortOnePayment(params.paymentId);
}

export const getPortOneCheckoutConfig = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }

    const kind =
      stringField(data, "kind") === "one_time" ? "one_time" : "subscription";
    const channelKey = assertPortOneCheckoutConfig(kind);
    return {
      storeId: PORTONE_STORE_ID,
      channelKey,
      oneTimeChannelKey: PORTONE_INICIS_ONETIME_CHANNEL_KEY || null,
      billingChannelKey: PORTONE_INICIS_BILLING_CHANNEL_KEY || null,
    };
  },
);

export const createPortOnePaymentIntent = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    assertPortOneCheckoutConfig("one_time");
    const planType = stringField(data, "planType");
    if (!planType) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "planType이 필요합니다.",
      );
    }
    const expected = portoneExpectedAmount(planType, stringField(data, "billing"));
    if (!expected) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 플랜입니다.",
      );
    }
    const paymentId = portonePaymentId(
      context.auth.uid,
      "one_time",
      `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    const orderName = `Marblo ${planType} 단건 결제`;
    await db.collection("pendingPortOneOrders").doc(paymentId).set({
      userId: context.auth.uid,
      planType,
      billingCycle: expected.billingCycle,
      amount: expected.amount,
      orderName,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      paymentId,
      orderName,
      amount: expected.amount,
      currency: "KRW",
    };
  },
);

export const completePortOnePayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    const paymentId = stringField(data, "paymentId");
    if (!paymentId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "paymentId가 필요합니다.",
      );
    }

    const orderSnap = await db
      .collection("pendingPortOneOrders")
      .doc(paymentId)
      .get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "PortOne 주문을 찾을 수 없습니다.",
      );
    }
    const order = orderSnap.data() || {};
    if (order.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다.",
      );
    }
    const planType =
      typeof order.planType === "string" ? order.planType : "pro";
    const billingCycle = normalizeBillingCycle(order.billingCycle);
    const amount = typeof order.amount === "number" ? order.amount : 0;
    if (amount <= 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "주문 금액이 유효하지 않습니다.",
      );
    }

    const chargeRef = db
      .collection("billingCharges")
      .doc(portoneChargeDocId(paymentId));
    const shouldApply = await db.runTransaction(async (tx) => {
      const snap = await tx.get(chargeRef);
      if (snap.exists && snap.data()?.status === "succeeded") return false;
      tx.set(
        chargeRef,
        {
          userId: context.auth!.uid,
          provider: "portone",
          paymentId,
          amount,
          planType,
          reason: "one_time",
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return true;
    });

    if (!shouldApply) return { success: true, idempotent: true };

    const payment = await fetchPortOnePayment(paymentId);
    const validation = validatePortOnePaidPayment(payment, {
      paymentId,
      storeId: PORTONE_STORE_ID,
      amount,
      currency: "KRW",
    });
    if (!validation.ok) {
      await chargeRef.update({
        status: "failed",
        error: validation.reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new functions.https.HttpsError(
        "failed-precondition",
        "PortOne 결제 검증에 실패했습니다.",
      );
    }

    const now = new Date();
    await db.collection("subscriptions").doc(context.auth.uid).set(
      {
        userId: context.auth.uid,
        planType,
        billingCycle,
        status: "active",
        paymentProvider: "portone",
        portonePaymentId: paymentId,
        currentPeriodStart: now,
        currentPeriodEnd: nextPeriodEnd(now, billingCycle),
        billingFailedCount: 0,
        nextRetryAt: null,
        createdAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await chargeRef.update({
      status: "succeeded",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await orderSnap.ref.update({
      status: "confirmed",
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, idempotent: false };
  },
);

// ─── TossPayments Webhook ────────────────────────────────────────
// H1(재수정): Toss 결제 웹훅(PAYMENT_STATUS_CHANGED)은 서명 헤더가 없다 — HMAC
// 서명은 정산/셀러 웹훅(payout.changed) 전용(`tosspayments-webhook-signature`).
// 따라서 서명으로는 검증할 수 없고, body 의 status 를 신뢰하면 위조 요청으로
// 임의 구독을 canceled/past_due 로 바꿀 수 있다. 위조 방지의 정석은 body 를
// 믿지 않고 paymentKey 로 Payment 조회 API 를 재호출해 Toss 가 알려주는 실제
// status 로만 구독을 바꾸는 것. 위조·유령 paymentKey 는 재조회에서 실제 상태
// 불일치 또는 404(미존재)로 무해화된다.
//
// PAYMENT_STATUS_CHANGED 검증용 재조회. GET /v1/payments/{paymentKey} 를
// Basic 인증으로 호출한다. 성공(2xx+status) → { status }, 실패/미존재(404)/
// 미설정/네트워크오류 → null 을 돌려 호출부가 "구독 변경 안 함"으로 안전
// 처리하게 한다. body 의 status 는 절대 참조하지 않는다.
async function fetchTossPaymentStatus(
  paymentKey: string,
): Promise<TossPaymentQueryResult> {
  if (!TOSS_SECRET_KEY) return null;
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/payments/${encodeURIComponent(paymentKey)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64",
          )}`,
        },
      },
    );
    const body = res.ok
      ? ((await res.json().catch(() => null)) as unknown)
      : null;
    return classifyTossPaymentResponse(res.ok, body);
  } catch (err) {
    console.warn("[tossWebhook] payment re-query error:", err);
    return null;
  }
}

export const tossWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { eventType, data: eventData } = req.body ?? {};

  switch (eventType) {
    case "PAYMENT_STATUS_CHANGED": {
      // body.status 는 신뢰하지 않는다 — paymentKey 로 재조회한 실제 status 만 사용.
      const paymentKey =
        typeof eventData?.paymentKey === "string" ? eventData.paymentKey : "";
      if (!paymentKey) {
        // 재조회 식별자가 없으면 검증 불가 → 안전 무시.
        console.warn(
          "[tossWebhook] PAYMENT_STATUS_CHANGED without paymentKey; ignoring",
        );
        break;
      }

      const query = await fetchTossPaymentStatus(paymentKey);
      const action = resolveTossWebhookAction(query);
      if (!query) {
        // 재조회 실패/미존재(위조 포함) → 구독 변경 없이 무시(+로그).
        console.warn(
          "[tossWebhook] payment re-query failed or not found; no subscription change",
        );
        break;
      }
      if (action.type === "none") break;

      // 재조회로 확인된 실제 상태가 해지/부분취소일 때만 구독을 조회·변경.
      // 멱등: 동일 상태 재수신은 같은 값 write → 무해(scheduledReconcileToss·
      // 갱신 크론과 컬렉션이 달라 충돌 없음).
      const snap = await db
        .collection("subscriptions")
        .where("tossPaymentKey", "==", paymentKey)
        .limit(1)
        .get();
      if (snap.empty) break;
      const docRef = snap.docs[0].ref;
      if (action.type === "cancel") {
        await docRef.update({
          status: "canceled",
          planType: "free",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (action.type === "past_due") {
        await docRef.update({
          status: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }

    default:
      console.log(`Unhandled Toss event: ${eventType}`);
  }

  res.json({ received: true });
});

// ============================================
// 정기결제 (Billing Key) Functions
// ============================================

// ─── 정기결제 청구 헬퍼(멱등) ────────────────────────────────────────
// Toss 빌링 청구 1회. billingCharges/{userId}_{cycleAnchorMs} claim 문서 +
// 결정적 orderId 로 "같은 사이클 중복청구"를 이중으로 막는다. 첫 청구·수동
// 청구·갱신 크론이 전부 이 헬퍼를 공유한다. amount<=0(쿠폰 전액할인/무료)은
// 실 PG 호출 없이 comped 처리.
const STALE_PENDING_MS = 15 * 60 * 1000; // 크래시 잔재 pending 재청구 허용 임계

type ChargeResult =
  | { status: "charged"; paymentKey: string }
  | { status: "comped" }
  | { status: "skipped"; reason?: "already_done" | "in_flight" | "unknown" }
  | { status: "failed"; error: string };

// Firestore Timestamp/Date/number/string 을 ms 로 정규화(비교용).
function tsToMillis(x: unknown): number | null {
  if (x instanceof admin.firestore.Timestamp) return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const t = new Date(x).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

async function chargeSubscriptionIdempotent(params: {
  userId: string;
  billingKey: string;
  customerKey: string;
  amount: number;
  planType: string;
  cycleAnchorMs: number;
  reason: "first" | "renewal" | "manual";
  /** 첫청구 등 결정적 문서 ID 강제(기본: userId_cycleAnchorMs). */
  chargeDocIdOverride?: string;
  /** 첫청구 등 결정적 orderId 강제. */
  orderIdOverride?: string;
}): Promise<ChargeResult> {
  const { userId, billingKey, customerKey, amount, planType, cycleAnchorMs } =
    params;
  const docId =
    params.chargeDocIdOverride || billingChargeDocId(userId, cycleAnchorMs);
  const orderId =
    params.orderIdOverride || billingOrderId(userId, cycleAnchorMs);
  const chargeRef = db.collection("billingCharges").doc(docId);

  // 1) 트랜잭션으로 청구권 claim — 이미 성공/진행중이면 재청구하지 않는다.
  const proceed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(chargeRef);
    if (snap.exists) {
      const data = snap.data() || {};
      const st = data.status as string | undefined;
      if (st === "succeeded" || st === "comped") return false;
      if (st === "pending") {
        // 진행 중이면 중복 방지 위해 대기. 단, 오래된 pending 은 크래시 잔재로
        // 보고 재시도 허용(결정적 orderId 덕에 실 성공분은 PG 가 재청구 거절).
        const updatedMs = tsToMillis(data.updatedAt);
        if (updatedMs != null && Date.now() - updatedMs < STALE_PENDING_MS) {
          return false;
        }
      }
      // status === "failed" 또는 stale pending → 재청구 허용.
    }
    tx.set(
      chargeRef,
      {
        userId,
        orderId,
        amount,
        planType,
        reason: params.reason,
        status: "pending",
        cycleAnchorMs,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });

  if (!proceed) {
    const snap = await chargeRef.get();
    const st = snap.data()?.status as string | undefined;
    if (st === "succeeded" || st === "comped") {
      return { status: "skipped", reason: "already_done" };
    }
    if (st === "pending") {
      return { status: "skipped", reason: "in_flight" };
    }
    return { status: "skipped", reason: "unknown" };
  }

  // 2) 금액 0 이하 → 실 결제 없이 comped(쿠폰 전액할인/무료 플랜).
  if (amount <= 0) {
    await chargeRef.update({
      status: "comped",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "comped" };
  }

  // 3) 실제 Toss 빌링 청구.
  try {
    const response = await fetch(
      `https://api.tosspayments.com/v1/billing/${billingKey}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64",
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerKey,
          amount,
          orderId,
          orderName: `Marblo ${planType} 구독`,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = String(error?.message || `HTTP ${response.status}`).slice(
        0,
        500,
      );
      await chargeRef.update({
        status: "failed",
        error: msg,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { status: "failed", error: msg };
    }

    const responseData = await response.json();
    await chargeRef.update({
      status: "succeeded",
      paymentKey: responseData.paymentKey || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "charged", paymentKey: responseData.paymentKey };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(
      0,
      500,
    );
    await chargeRef.update({
      status: "failed",
      error: msg,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "failed", error: msg };
  }
}

// ─── PortOne 정기결제 청구 헬퍼(멱등) ─────────────────────────────────
// Toss chargeSubscriptionIdempotent 미러. billingCharges/portone_{paymentId}
// claim + payPortOneBillingKey + validatePortOnePaidPayment. paymentId 는
// portonePaymentId(uid,"subscription", cycleAnchorMs) 로 결정적 — 같은 사이클
// 중복 청구를 막는다. 갱신 크론(scheduledChargePortOneSubscriptions) 전용.
async function chargePortOneSubscriptionIdempotent(params: {
  userId: string;
  billingKey: string;
  amount: number;
  planType: string;
  cycleAnchorMs: number;
  reason: "first" | "renewal" | "manual";
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** 첫청구 결정적 paymentId (기본: cycleAnchorMs 기반). */
  paymentIdOverride?: string;
  /** 첫청구 결정적 billingCharges doc id (기본: portone_{paymentId}). */
  chargeDocIdOverride?: string;
}): Promise<ChargeResult> {
  const {
    userId,
    billingKey,
    amount,
    planType,
    cycleAnchorMs,
    customerEmail,
    customerName,
    customerPhone,
  } = params;
  const paymentId =
    params.paymentIdOverride ||
    portonePaymentId(userId, "subscription", String(cycleAnchorMs));
  const chargeRef = db
    .collection("billingCharges")
    .doc(params.chargeDocIdOverride || portoneChargeDocId(paymentId));

  const proceed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(chargeRef);
    if (snap.exists) {
      const data = snap.data() || {};
      const st = data.status as string | undefined;
      if (st === "succeeded" || st === "comped") return false;
      if (st === "pending") {
        const updatedMs = tsToMillis(data.updatedAt);
        if (updatedMs != null && Date.now() - updatedMs < STALE_PENDING_MS) {
          return false;
        }
      }
    }
    tx.set(
      chargeRef,
      {
        userId,
        provider: "portone",
        paymentId,
        amount,
        planType,
        reason: params.reason,
        status: "pending",
        cycleAnchorMs,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });

  if (!proceed) {
    const snap = await chargeRef.get();
    const st = snap.data()?.status as string | undefined;
    if (st === "succeeded" || st === "comped") {
      return { status: "skipped", reason: "already_done" };
    }
    if (st === "pending") {
      return { status: "skipped", reason: "in_flight" };
    }
    return { status: "skipped", reason: "unknown" };
  }

  if (amount <= 0) {
    await chargeRef.update({
      status: "comped",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "comped" };
  }

  try {
    const channelKey = assertPortOneCheckoutConfig("subscription");
    const payment = await payPortOneBillingKey({
      paymentId,
      billingKey,
      channelKey,
      orderName: `Marblo ${planType} 구독`,
      amount,
      customerId: userId,
      customerEmail,
      customerName,
      customerPhone,
    });
    const validation = validatePortOnePaidPayment(payment, {
      paymentId,
      storeId: PORTONE_STORE_ID,
      amount,
      currency: "KRW",
    });
    if (!validation.ok) {
      // 재시도 시 PG 가 이미 PAID 인데 응답 형태가 다를 수 있음 → GET 재조회로 수렴.
      const converged = await tryConvergePortOnePaid({
        paymentId,
        amount,
        chargeRef,
      });
      if (converged) return converged;
      await chargeRef.update({
        status: "failed",
        error: validation.reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { status: "failed", error: validation.reason };
    }
    await chargeRef.update({
      status: "succeeded",
      portonePaymentId: paymentId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // ChargeResult.paymentKey 슬롯에 paymentId 를 실어 호출부가 구독 문서에 쓴다.
    return { status: "charged", paymentKey: paymentId };
  } catch (err) {
    // 네트워크/타임아웃 후에도 PG 측 PAID 일 수 있음 → GET 로 멱등 수렴.
    const converged = await tryConvergePortOnePaid({
      paymentId,
      amount,
      chargeRef,
    });
    if (converged) return converged;
    const msg = (
      err instanceof functions.https.HttpsError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
    ).slice(0, 500);
    await chargeRef.update({
      status: "failed",
      error: msg,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "failed", error: msg };
  }
}

/** PortOne GET 이 PAID 면 charge 문서를 succeeded 로 수렴(이중청구 방지). */
async function tryConvergePortOnePaid(params: {
  paymentId: string;
  amount: number;
  chargeRef: admin.firestore.DocumentReference;
}): Promise<ChargeResult | null> {
  try {
    const payment = await fetchPortOnePayment(params.paymentId);
    const validation = validatePortOnePaidPayment(payment, {
      paymentId: params.paymentId,
      storeId: PORTONE_STORE_ID,
      amount: params.amount,
      currency: "KRW",
    });
    if (!validation.ok) return null;
    await params.chargeRef.update({
      status: "succeeded",
      portonePaymentId: params.paymentId,
      convergedFromGet: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { status: "charged", paymentKey: params.paymentId };
  } catch {
    return null;
  }
}

async function loadSubscriptionGuard(userId: string): Promise<{
  status?: string;
  currentPeriodEndMs: number | null;
  data: admin.firestore.DocumentData | undefined;
}> {
  const snap = await db.collection("subscriptions").doc(userId).get();
  const data = snap.data();
  return {
    status: typeof data?.status === "string" ? data.status : undefined,
    currentPeriodEndMs: tsToMillis(data?.currentPeriodEnd),
    data,
  };
}

function assertNotAlreadySubscribed(
  sub: { status?: string; currentPeriodEndMs: number | null },
  nowMs: number,
): void {
  if (
    isAlreadySubscribed(
      { status: sub.status, currentPeriodEndMs: sub.currentPeriodEndMs },
      nowMs,
    )
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "already_subscribed",
    );
  }
}

type ChargeStatusLabel =
  | "succeeded"
  | "comped"
  | "pending"
  | "failed"
  | "missing";

async function pickFirstChargeGeneration(
  provider: FirstChargeProvider,
  userId: string,
  planType: string,
  cycle: BillingCycle,
): Promise<number> {
  const statuses: ChargeStatusLabel[] = [];
  for (let g = 0; g < 8; g++) {
    const docId = firstChargeLedgerId(provider, userId, planType, cycle, g);
    const snap = await db.collection("billingCharges").doc(docId).get();
    if (!snap.exists) {
      statuses.push("missing");
      break;
    }
    const st = snap.data()?.status as string | undefined;
    if (st === "succeeded" || st === "comped" || st === "pending" || st === "failed") {
      statuses.push(st);
    } else {
      statuses.push("failed");
    }
  }
  return resolveFirstChargeGeneration(statuses);
}

async function savePendingFirstCharge(params: {
  userId: string;
  planType: string;
  billingCycle: BillingCycle;
  provider: "toss" | "portone";
  error: string;
  tossBillingKey?: string | null;
  tossCustomerKey?: string | null;
  portoneBillingKey?: string | null;
  portoneCustomerName?: string | null;
  portoneCustomerPhone?: string | null;
  portoneCustomerEmail?: string | null;
  firstChargeGeneration?: number;
}): Promise<void> {
  // entitlement 는 free 유지 — status pending_first_charge 는 resolveEntitledPlan 에서 free.
  const patch: Record<string, unknown> = {
    userId: params.userId,
    planType: params.planType,
    billingCycle: params.billingCycle,
    status: "pending_first_charge",
    paymentProvider: params.provider,
    firstChargeError: params.error.slice(0, 500),
    firstChargeGeneration: params.firstChargeGeneration ?? 0,
    // 유료 기간 부여 금지(₩0 활성 GAP A 방지).
    currentPeriodStart: null,
    currentPeriodEnd: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (params.provider === "toss") {
    patch.tossBillingKey = params.tossBillingKey || null;
    patch.tossCustomerKey = params.tossCustomerKey || null;
  } else {
    patch.portoneBillingKey = params.portoneBillingKey || null;
    patch.portoneCustomerName = params.portoneCustomerName || null;
    patch.portoneCustomerPhone = params.portoneCustomerPhone || null;
    patch.portoneCustomerEmail = params.portoneCustomerEmail || null;
  }
  await db.collection("subscriptions").doc(params.userId).set(patch, {
    merge: true,
  });
}

// 첫 청구용 쿠폰 검증·할인 계산. 유효하지 않으면 정가로 폴백(throw 하지 않음 —
// 쿠폰 문제로 결제 자체가 깨지면 안 됨). 반환된 appliedCoupon 은 청구 성공
// 후에만 소진 기록한다.
async function resolveFirstChargeAmount(
  userId: string,
  baseAmount: number,
  couponCode: unknown,
): Promise<{
  finalAmount: number;
  appliedCoupon: { code: string } | null;
}> {
  if (!couponCode || typeof couponCode !== "string") {
    return { finalAmount: baseAmount, appliedCoupon: null };
  }
  const couponDoc = await db.collection("coupons").doc(couponCode).get();
  if (!couponDoc.exists)
    return { finalAmount: baseAmount, appliedCoupon: null };
  const c = couponDoc.data()!;
  const notExpired = !c.expiresAt || c.expiresAt.toDate() >= new Date();
  const underMax = !(c.usedCount >= c.maxUses);
  const already = await db
    .collection("couponRedemptions")
    .where("couponCode", "==", couponCode)
    .where("userId", "==", userId)
    .limit(1)
    .get();
  if (!notExpired || !underMax || !already.empty) {
    return { finalAmount: baseAmount, appliedCoupon: null };
  }
  const { finalAmount } = applyCouponDiscount(baseAmount, c);
  return { finalAmount, appliedCoupon: { code: couponCode } };
}

export const completePortOneBillingKey = functions.https.onCall(
  async (data, context) => {
    const userId = context.auth?.uid;
    if (!userId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    const authEmail =
      typeof context.auth?.token.email === "string"
        ? context.auth.token.email
        : null;
    const billingKey = stringField(data, "billingKey");
    const planType = stringField(data, "planType") || "pro";
    const customerName = stringField(data, "customerName");
    const customerPhone = stringField(data, "customerPhone");
    // KG이니시스 빌링 청구는 customer.email REQUIRED.
    // 클라이언트가 넘긴 customerEmail 우선, 없으면 auth token email 폴백.
    const customerEmailRaw = stringField(data, "customerEmail");
    const customerEmail =
      (customerEmailRaw && customerEmailRaw.trim()) || authEmail || null;
    if (!billingKey) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "billingKey가 필요합니다.",
      );
    }
    if (!customerEmail) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "결제에 이메일이 필요합니다",
      );
    }

    assertPortOneCheckoutConfig("subscription");
    const expected = portoneExpectedAmount(
      planType,
      stringField(data, "billing"),
    );
    if (!expected) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`,
      );
    }

    const nowMs = Date.now();
    const existingSub = await loadSubscriptionGuard(userId);
    assertNotAlreadySubscribed(existingSub, nowMs);

    const { finalAmount, appliedCoupon } = await resolveFirstChargeAmount(
      userId,
      expected.amount,
      stringField(data, "coupon"),
    );

    // 결정적 첫청구 키 — Date.now() 앵커 금지(동시 호출 이중청구 방지).
    const generation = await pickFirstChargeGeneration(
      "portone",
      userId,
      planType,
      expected.billingCycle,
    );
    const chargeDocId = firstChargeLedgerId(
      "portone",
      userId,
      planType,
      expected.billingCycle,
      generation,
    );
    const paymentId = portonePaymentId(
      userId,
      "subscription",
      firstChargePortoneNonce(planType, expected.billingCycle, generation),
    );

    // 이미 성공한 첫청구 문서면 재청구 없이 구독 복구 + idempotent.
    {
      const prior = await db.collection("billingCharges").doc(chargeDocId).get();
      const priorSt = prior.data()?.status as string | undefined;
      if (priorSt === "succeeded" || priorSt === "comped") {
        const now = new Date(nowMs);
        await db.collection("subscriptions").doc(userId).set(
          {
            userId,
            planType,
            billingCycle: expected.billingCycle,
            status: "active",
            paymentProvider: "portone",
            portoneBillingKey: billingKey,
            portoneCustomerName: customerName,
            portoneCustomerPhone: customerPhone,
            portoneCustomerEmail: customerEmail,
            portonePaymentId:
              priorSt === "comped"
                ? null
                : prior.data()?.portonePaymentId || paymentId,
            currentPeriodStart: now,
            currentPeriodEnd: nextPeriodEnd(now, expected.billingCycle),
            billingFailedCount: 0,
            nextRetryAt: null,
            firstChargeGeneration: generation,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return {
          success: true,
          idempotent: true,
          charged: priorSt === "comped" ? "comped" : "charged",
        };
      }
    }

    const charge = await chargePortOneSubscriptionIdempotent({
      userId,
      billingKey,
      amount: finalAmount,
      planType,
      cycleAnchorMs: 0,
      reason: "first",
      customerEmail,
      customerName,
      customerPhone,
      paymentIdOverride: paymentId,
      chargeDocIdOverride: chargeDocId,
    });

    if (charge.status === "skipped" && charge.reason === "already_done") {
      const now = new Date(nowMs);
      await db.collection("subscriptions").doc(userId).set(
        {
          userId,
          planType,
          billingCycle: expected.billingCycle,
          status: "active",
          paymentProvider: "portone",
          portoneBillingKey: billingKey,
          portoneCustomerName: customerName,
          portoneCustomerPhone: customerPhone,
          portoneCustomerEmail: customerEmail,
          portonePaymentId: finalAmount <= 0 ? null : paymentId,
          currentPeriodStart: now,
          currentPeriodEnd: nextPeriodEnd(now, expected.billingCycle),
          billingFailedCount: 0,
          nextRetryAt: null,
          firstChargeGeneration: generation,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { success: true, idempotent: true, charged: "charged" };
    }

    if (charge.status === "skipped" && charge.reason === "in_flight") {
      throw new functions.https.HttpsError(
        "aborted",
        "payment_in_progress",
      );
    }

    if (charge.status === "failed") {
      await savePendingFirstCharge({
        userId,
        planType,
        billingCycle: expected.billingCycle,
        provider: "portone",
        error: charge.error,
        portoneBillingKey: billingKey,
        portoneCustomerName: customerName,
        portoneCustomerPhone: customerPhone,
        portoneCustomerEmail: customerEmail,
        firstChargeGeneration: generation,
      });
      throw new functions.https.HttpsError(
        "failed-precondition",
        "first_charge_failed",
      );
    }

    const now = new Date(nowMs);
    await db.collection("subscriptions").doc(userId).set(
      {
        userId,
        planType,
        billingCycle: expected.billingCycle,
        status: "active",
        paymentProvider: "portone",
        portoneBillingKey: billingKey,
        // KG이니시스 갱신 청구는 매 사이클 name/phone/email 을 요구한다 — 구독 문서에
        // 저장해 scheduledChargePortOneSubscriptions 가 재사용한다.
        portoneCustomerName: customerName,
        portoneCustomerPhone: customerPhone,
        portoneCustomerEmail: customerEmail,
        portonePaymentId:
          charge.status === "comped"
            ? null
            : charge.status === "charged"
              ? charge.paymentKey
              : paymentId,
        currentPeriodStart: now,
        currentPeriodEnd: nextPeriodEnd(now, expected.billingCycle),
        billingFailedCount: 0,
        nextRetryAt: null,
        firstChargeGeneration: generation,
        couponCode: appliedCoupon?.code || null,
        createdAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (appliedCoupon) {
      await db
        .collection("coupons")
        .doc(appliedCoupon.code)
        .update({ usedCount: admin.firestore.FieldValue.increment(1) });
      await db.collection("couponRedemptions").add({
        couponCode: appliedCoupon.code,
        userId,
        redeemedAt: new Date(),
        context: "portone_subscription_first_charge",
      });
    }

    return {
      success: true,
      idempotent: false,
      charged:
        charge.status === "comped"
          ? "comped"
          : charge.status === "charged"
            ? "charged"
            : charge.status,
    };
  },
);

// 빌링키 발급 + 첫 결제 청구(원자적). 청구 실패 시 구독을 active 로 만들지
// 않는다 — GAP A(₩0 무료 활성) 방지의 핵심. 실패 시 pending_first_charge 로
// 키를 보존해 retryFirstCharge 가 재시도한다.
export const issueBillingKey = functions.https.onCall(async (data, context) => {
  const { authKey, customerKey, plan, coupon, billing } = data;
  const userId = context.auth?.uid;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  const planType = plan || "pro";
  // ★결제 주기를 여기서 받아 금액·기간 양쪽에 반영한다. 이 인자가 없던 시절엔
  // 연간을 고른 사용자에게 ₩190,000 을 보여주고 ₩19,000·1개월을 청구했다.
  const billingCycle = normalizeBillingCycle(billing);
  const baseAmount = planAmountKRW(planType, billingCycle);
  if (!baseAmount) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Plan '${planType}' is not chargeable`,
    );
  }

  const nowMs = Date.now();
  const existingSub = await loadSubscriptionGuard(userId);
  assertNotAlreadySubscribed(existingSub, nowMs);

  // 1) 빌링키 발급.
  const response = await fetch(
    "https://api.tosspayments.com/v1/billing/authorizations/issue",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
          "base64",
        )}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authKey, customerKey }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new functions.https.HttpsError(
      "internal",
      error.message || "Failed to issue billing key",
    );
  }

  const responseData = await response.json();
  const billingKey = responseData.billingKey;

  // 2) 쿠폰 할인(첫 청구에만 적용).
  const { finalAmount, appliedCoupon } = await resolveFirstChargeAmount(
    userId,
    baseAmount,
    coupon,
  );

  // 3) 결정적 첫청구 멱등 키(Date.now 금지).
  const generation = await pickFirstChargeGeneration(
    "toss",
    userId,
    planType,
    billingCycle,
  );
  const chargeDocId = firstChargeLedgerId(
    "toss",
    userId,
    planType,
    billingCycle,
    generation,
  );
  const orderId = firstChargeOrderId(
    userId,
    planType,
    billingCycle,
    generation,
  );

  // 이미 성공 분 → 재청구 없이 구독 복구.
  {
    const prior = await db.collection("billingCharges").doc(chargeDocId).get();
    const priorSt = prior.data()?.status as string | undefined;
    if (priorSt === "succeeded" || priorSt === "comped") {
      const now = new Date(nowMs);
      await db.collection("subscriptions").doc(userId).set(
        {
          userId,
          planType,
          billingCycle,
          status: "active",
          paymentProvider: "toss",
          tossBillingKey: billingKey,
          tossCustomerKey: customerKey,
          tossPaymentKey: prior.data()?.paymentKey || null,
          currentPeriodStart: now,
          currentPeriodEnd: nextPeriodEnd(now, billingCycle),
          billingFailedCount: 0,
          nextRetryAt: null,
          firstChargeGeneration: generation,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        success: true,
        billingKey,
        charged: priorSt,
        idempotent: true,
      };
    }
  }

  const charge = await chargeSubscriptionIdempotent({
    userId,
    billingKey,
    customerKey,
    amount: finalAmount,
    planType,
    cycleAnchorMs: 0,
    reason: "first",
    chargeDocIdOverride: chargeDocId,
    orderIdOverride: orderId,
  });

  if (charge.status === "skipped" && charge.reason === "already_done") {
    const now = new Date(nowMs);
    await db.collection("subscriptions").doc(userId).set(
      {
        userId,
        planType,
        billingCycle,
        status: "active",
        paymentProvider: "toss",
        tossBillingKey: billingKey,
        tossCustomerKey: customerKey,
        currentPeriodStart: now,
        currentPeriodEnd: nextPeriodEnd(now, billingCycle),
        billingFailedCount: 0,
        nextRetryAt: null,
        firstChargeGeneration: generation,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { success: true, billingKey, charged: "charged", idempotent: true };
  }

  if (charge.status === "skipped" && charge.reason === "in_flight") {
    throw new functions.https.HttpsError("aborted", "payment_in_progress");
  }

  if (charge.status === "failed") {
    await savePendingFirstCharge({
      userId,
      planType,
      billingCycle,
      provider: "toss",
      error: charge.error,
      tossBillingKey: billingKey,
      tossCustomerKey: customerKey,
      firstChargeGeneration: generation,
    });
    throw new functions.https.HttpsError(
      "failed-precondition",
      "first_charge_failed",
    );
  }

  // 4) 청구 성공/comped → 구독 active 저장 + 쿠폰 소진 기록.
  const now = new Date(nowMs);
  const periodEnd = nextPeriodEnd(now, billingCycle);
  await db
    .collection("subscriptions")
    .doc(userId)
    .set(
      {
        userId,
        planType,
        billingCycle,
        status: "active",
        paymentProvider: "toss",
        tossBillingKey: billingKey,
        tossCustomerKey: customerKey,
        tossPaymentKey: charge.status === "charged" ? charge.paymentKey : null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        billingFailedCount: 0,
        nextRetryAt: null,
        firstChargeGeneration: generation,
        couponCode: appliedCoupon?.code || null,
        createdAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  if (appliedCoupon) {
    await db
      .collection("coupons")
      .doc(appliedCoupon.code)
      .update({ usedCount: admin.firestore.FieldValue.increment(1) });
    await db.collection("couponRedemptions").add({
      couponCode: appliedCoupon.code,
      userId,
      redeemedAt: new Date(),
      context: "subscription_first_charge",
    });
  }

  return {
    success: true,
    billingKey,
    charged: charge.status,
    idempotent: false,
  };
});

// 빌링키 발급 성공 · 첫 청구 실패 후 재시도. pending_first_charge 만 허용.
// 같은 결정적 first-charge ledger 키로 멱등 청구한다.
export const retryFirstCharge = functions.https.onCall(
  async (_data, context) => {
    const userId = context.auth?.uid;
    if (!userId) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const subRef = db.collection("subscriptions").doc(userId);
    const subSnap = await subRef.get();
    const sub = subSnap.data();
    if (!subSnap.exists || sub?.status !== "pending_first_charge") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "not_pending_first_charge",
      );
    }

    const planType = (sub.planType as string) || "pro";
    const billingCycle = normalizeBillingCycle(sub.billingCycle);
    const baseAmount = planAmountKRW(planType, billingCycle);
    if (!baseAmount) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`,
      );
    }

    const provider =
      sub.paymentProvider === "portone" ? "portone" : "toss";
    const generation =
      typeof sub.firstChargeGeneration === "number"
        ? sub.firstChargeGeneration
        : await pickFirstChargeGeneration(
            provider,
            userId,
            planType,
            billingCycle,
          );
    const chargeDocId = firstChargeLedgerId(
      provider,
      userId,
      planType,
      billingCycle,
      generation,
    );
    const nowMs = Date.now();
    // 쿠폰은 첫 시도 시 이미 검증됨 — 재시도는 정가(쿠폰 재적용 없음, 이중 소진 방지).
    // 이전 시도가 쿠폰 적용 금액으로 claim 됐으면 그 amount 가 문서에 남아 재사용됨.
    const priorCharge = await db
      .collection("billingCharges")
      .doc(chargeDocId)
      .get();
    const amountFromPrior =
      typeof priorCharge.data()?.amount === "number"
        ? (priorCharge.data()!.amount as number)
        : baseAmount;
    const finalAmount = amountFromPrior;

    let charge: ChargeResult;
    if (provider === "portone") {
      const billingKey = sub.portoneBillingKey as string | undefined;
      if (!billingKey) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "missing_billing_key",
        );
      }
      const paymentId = portonePaymentId(
        userId,
        "subscription",
        firstChargePortoneNonce(planType, billingCycle, generation),
      );
      charge = await chargePortOneSubscriptionIdempotent({
        userId,
        billingKey,
        amount: finalAmount,
        planType,
        cycleAnchorMs: 0,
        reason: "first",
        customerEmail:
          (typeof sub.portoneCustomerEmail === "string"
            ? sub.portoneCustomerEmail
            : null) ||
          (typeof context.auth?.token.email === "string"
            ? context.auth.token.email
            : null),
        customerName:
          typeof sub.portoneCustomerName === "string"
            ? sub.portoneCustomerName
            : null,
        customerPhone:
          typeof sub.portoneCustomerPhone === "string"
            ? sub.portoneCustomerPhone
            : null,
        paymentIdOverride: paymentId,
        chargeDocIdOverride: chargeDocId,
      });
    } else {
      const billingKey = sub.tossBillingKey as string | undefined;
      const customerKey = sub.tossCustomerKey as string | undefined;
      if (!billingKey || !customerKey) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "missing_billing_key",
        );
      }
      charge = await chargeSubscriptionIdempotent({
        userId,
        billingKey,
        customerKey,
        amount: finalAmount,
        planType,
        cycleAnchorMs: 0,
        reason: "first",
        chargeDocIdOverride: chargeDocId,
        orderIdOverride: firstChargeOrderId(
          userId,
          planType,
          billingCycle,
          generation,
        ),
      });
    }

    if (charge.status === "skipped" && charge.reason === "in_flight") {
      throw new functions.https.HttpsError("aborted", "payment_in_progress");
    }

    if (charge.status === "failed") {
      await subRef.set(
        {
          firstChargeError: charge.error.slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      throw new functions.https.HttpsError(
        "failed-precondition",
        "first_charge_failed",
      );
    }

    // succeeded / comped / already_done
    const now = new Date(nowMs);
    const activePatch: Record<string, unknown> = {
      status: "active",
      planType,
      billingCycle,
      currentPeriodStart: now,
      currentPeriodEnd: nextPeriodEnd(now, billingCycle),
      billingFailedCount: 0,
      nextRetryAt: null,
      firstChargeError: null,
      firstChargeGeneration: generation,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (provider === "portone" && charge.status === "charged") {
      activePatch.portonePaymentId = charge.paymentKey;
    }
    if (provider === "toss" && charge.status === "charged") {
      activePatch.tossPaymentKey = charge.paymentKey;
    }
    await subRef.set(activePatch, { merge: true });

    return {
      success: true,
      charged: charge.status === "comped" ? "comped" : "charged",
      idempotent: charge.status === "skipped",
    };
  },
);

// 빌링키로 정기결제 실행(수동 트리거). 갱신 크론과 동일한 멱등 헬퍼를 공유해
// 같은 사이클 중복청구를 막는다.
export const chargeBillingKey = functions.https.onCall(
  async (_data, context) => {
    // C1: 인증 필수 + 결제 파라미터는 전부 서버에서 유도한다.
    // 기존엔 인증 없이 userId/amount/billingKey 를 클라이언트 data 에서
    // 받아, 임의 사용자의 빌링키로 임의 금액을 청구할 수 있었다(무인증+IDOR).
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // 호출자 본인의 구독 문서에서 billingKey/customerKey/plan 을 읽는다 —
    // 클라이언트 입력은 신뢰하지 않는다.
    const subRef = db.collection("subscriptions").doc(userId);
    const subSnap = await subRef.get();
    const sub = subSnap.data();
    if (!subSnap.exists || !sub?.tossBillingKey || !sub?.tossCustomerKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No billing key registered for this account",
      );
    }

    const planType: string = sub.planType || "pro";
    // 주기는 구독 문서에서 읽는다(클라이언트 입력 아님) — 연간 구독자는 연간가로
    // 청구하고 연간 기간을 다시 부여해야 주기가 유지된다.
    const billingCycle = normalizeBillingCycle(sub.billingCycle);
    const amount = planAmountKRW(planType, billingCycle);
    if (!amount) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`,
      );
    }

    // 사이클 앵커 = 현재 만료 경계(없으면 now). 같은 주기 재호출은 멱등하게 skip.
    const cycleAnchorMs = tsToMillis(sub.currentPeriodEnd) ?? Date.now();
    const charge = await chargeSubscriptionIdempotent({
      userId,
      billingKey: sub.tossBillingKey as string,
      customerKey: sub.tossCustomerKey as string,
      amount,
      planType,
      cycleAnchorMs,
      reason: "manual",
    });

    if (charge.status === "failed") {
      throw new functions.https.HttpsError(
        "internal",
        charge.error || "Failed to charge billing key",
      );
    }

    // 성공/comped/skipped → 구독 기간 연장(멱등 재적용 안전).
    const success = applyChargeSuccess(Date.now(), billingCycle);
    await subRef.update({
      status: success.status,
      currentPeriodStart: success.currentPeriodStart,
      currentPeriodEnd: success.currentPeriodEnd,
      billingCycle: success.billingCycle,
      billingFailedCount: 0,
      nextRetryAt: null,
      ...(charge.status === "charged"
        ? { tossPaymentKey: charge.paymentKey }
        : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      paymentKey: charge.status === "charged" ? charge.paymentKey : null,
      charged: charge.status,
    };
  },
);

// 토스 정기결제 취소 = "다음 결제를 멈춘다". 이미 결제한 기간은 끝까지 쓴다.
//
// ★해지(cancel)와 중도 환불(refund)은 다른 행위다. 여기서는 환불하지 않으므로
// 접근권도 즉시 끊지 않는다 — 그 둘을 뭉개면 "접근은 끊고 환불도 안 하는" 최악의
// 조합이 된다(이 함수의 원래 버그).
//
// 다음 결제가 실제로 멈추는 근거: 토스 정기결제는 pull 모델이라 토스 쪽에
// recurring 객체가 없고, 우리가 billingKey 로 매 사이클 직접 청구한다. 그 청구
// 대상 선정(billing.ts selectDueForCharge)이 status==="active"|"past_due" 만
// 통과시키므로, status="canceled" 를 쓰는 순간 청구는 멈춘다. 그래서 status 를
// active 로 남기는 설계(= cancelAtPeriodEnd 플래그)를 쓰면 안 된다 — 기간 말에
// 해지한 사용자가 다시 청구된다.
//
// 잔여 기간의 접근권은 currentPeriodEnd 를 함께 보는 entitlement.ts 규칙이
// 부여한다(렌더러/functions 공통).
export const cancelTossSubscription = functions.https.onCall(
  async (_data, context) => {
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    const subRef = db.collection("subscriptions").doc(userId);
    const snap = await subRef.get();
    if (!snap.exists)
      throw new functions.https.HttpsError(
        "not-found",
        "No subscription to cancel",
      );

    await subRef.update({
      status: "canceled",
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 사용자에게 "언제까지 쓸 수 있는지"를 돌려준다. 기간이 기록돼 있지 않은
    // 레거시 문서는 잔여 기간을 줄 근거가 없으므로 즉시 종료로 안내한다(없는
    // 기간을 지어내지 않는다).
    const accessUntilMs = tsToMillis(snap.get("currentPeriodEnd"));
    return {
      success: true,
      accessUntil:
        accessUntilMs != null ? new Date(accessUntilMs).toISOString() : null,
    };
  },
);

// ============================================
// 강의 (Lecture) Functions
// ============================================

// 강의 주문 생성
export const createLectureOrder = functions.https.onCall(
  async (data, context) => {
    const { lectureSlug } = data;
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // Check if already purchased
    const existingPurchase = await db
      .collection("lecturePurchases")
      .where("userId", "==", userId)
      .where("lectureSlug", "==", lectureSlug)
      .get();

    if (!existingPurchase.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Already purchased this lecture",
      );
    }

    // Get lecture info
    const lectureDoc = await db.collection("lectures").doc(lectureSlug).get();
    if (!lectureDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Lecture not found");
    }
    const lecture = lectureDoc.data()!;
    const amount = lecture.price;

    const orderId = `LECTURE-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const orderName = lecture.title_ko || lecture.title || lectureSlug;

    await db.collection("pendingOrders").doc(orderId).set({
      userId,
      type: "lecture",
      lectureSlug,
      amount,
      orderName,
      createdAt: new Date(),
    });

    return { orderId, amount, orderName };
  },
);

// 강의 단건결제 확인
export const confirmLecturePayment = functions.https.onCall(
  async (data, context) => {
    const { paymentKey, orderId, amount } = data;
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // 주문 소유권/금액/멱등을 PG confirm 전에 검증한다(confirmTossPayment 와 동일
    // 방어). orderId 는 클라이언트가 넘기고 열거 가능하므로, 소유권 확인이 없으면
    // 인증된 사용자가 남의 주문을 확정해 강의를 자기 계정에 붙일 수 있다. 또한
    // confirm 전에 검증해야 실패 시 불필요한 결제승인을 하지 않는다.
    const orderDoc = await db.collection("pendingOrders").doc(orderId).get();
    if (!orderDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Order not found");
    }
    const order = orderDoc.data()!;
    if (order.userId !== userId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다.",
      );
    }
    if (typeof amount === "number" && order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다.",
      );
    }

    // 멱등: 이미 이 강의를 구매했으면 재확정하지 않는다(중복 구매행/쿠폰 방지).
    const existingPurchase = await db
      .collection("lecturePurchases")
      .where("userId", "==", userId)
      .where("lectureSlug", "==", order.lectureSlug)
      .limit(1)
      .get();
    if (!existingPurchase.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Already purchased this lecture",
      );
    }

    // Confirm with TossPayments (금액은 서버가 보관한 주문 금액을 신뢰).
    const response = await fetch(
      "https://api.tosspayments.com/v1/payments/confirm",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64",
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paymentKey, orderId, amount: order.amount }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Payment confirmation failed",
      );
    }

    // Create lecture purchase
    await db.collection("lecturePurchases").add({
      userId,
      lectureSlug: order.lectureSlug,
      purchasedAt: new Date(),
      orderId,
      amount: order.amount,
    });

    // Delete pending order
    await db.collection("pendingOrders").doc(orderId).delete();

    // Auto-issue lecture coupon
    await issueLectureCouponInternal(userId);

    return { success: true };
  },
);

// ============================================
// 쿠폰 (Coupon) Functions
// ============================================

// 쿠폰 검증
export const validateCoupon = functions.https.onCall(async (data, context) => {
  const { code, userId } = data;
  if (!code)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Coupon code required",
    );

  // Rate limit: stops brute-force code guessing. Per-uid (5/min, 30/5min)
  // AND per-IP (20/min, 100/10min). Both must pass.
  const ip = extractIp(context.rawRequest);
  const uidKey = userId ? `coupon:uid:${userId}` : `coupon:anon:${ip}`;
  const ipKey = `coupon:ip:${ip}`;
  const uidCheck = await enforceRateLimit(uidKey, COUPON_RULES_UID);
  if (!uidCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`,
    );
  }
  const ipCheck = await enforceRateLimit(ipKey, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`,
    );
  }

  const couponDoc = await db.collection("coupons").doc(code).get();
  if (!couponDoc.exists) {
    return { valid: false, reason: "Coupon not found" };
  }

  const coupon = couponDoc.data()!;

  // Check expiry
  if (coupon.expiresAt && coupon.expiresAt.toDate() < new Date()) {
    return { valid: false, reason: "Coupon expired" };
  }

  // Check max uses
  if (coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: "Coupon usage limit reached" };
  }

  // Check if user already used this coupon
  if (userId) {
    const redemption = await db
      .collection("couponRedemptions")
      .where("couponCode", "==", code)
      .where("userId", "==", userId)
      .get();
    if (!redemption.empty) {
      return { valid: false, reason: "Coupon already used" };
    }
  }

  return {
    valid: true,
    type: coupon.type,
    discountPercent: coupon.discountPercent,
    freeDays: coupon.freeDays,
    targetPlan: coupon.targetPlan,
  };
});

// 쿠폰 적용
export const applyCoupon = functions.https.onCall(async (data, context) => {
  const { code, userId, baseAmount } = data;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  // Rate limit: applyCoupon is the higher-cost endpoint (writes to coupons
  // counter + redemption record). Same per-uid + per-IP limits as validate
  // — an attacker bypassing validate by going straight to apply still hits
  // the same shared keys.
  const ip = extractIp(context.rawRequest);
  const uidCheck = await enforceRateLimit(
    `coupon:uid:${userId}`,
    COUPON_RULES_UID,
  );
  if (!uidCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`,
    );
  }
  const ipCheck = await enforceRateLimit(`coupon:ip:${ip}`, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`,
    );
  }

  // Validate first
  const couponDoc = await db.collection("coupons").doc(code).get();
  if (!couponDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Invalid coupon");
  }
  const coupon = couponDoc.data()!;

  let finalAmount = baseAmount;
  let discountAmount = 0;

  switch (coupon.type) {
    case "discount":
      discountAmount = Math.round(
        (baseAmount * (coupon.discountPercent || 0)) / 100,
      );
      finalAmount = baseAmount - discountAmount;
      break;
    case "free_trial":
      finalAmount = 0;
      discountAmount = baseAmount;
      break;
    case "plan_upgrade":
      finalAmount = 0;
      discountAmount = baseAmount;
      break;
  }

  // Increment usage
  await db
    .collection("coupons")
    .doc(code)
    .update({
      usedCount: admin.firestore.FieldValue.increment(1),
    });

  // Record redemption
  await db.collection("couponRedemptions").add({
    couponCode: code,
    userId,
    redeemedAt: new Date(),
  });

  return { finalAmount, discountAmount, couponType: coupon.type };
});

// 쿠폰 일괄 생성 (관리자용)
export const createCouponBatch = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);

    const { coupons } = data;
    if (!Array.isArray(coupons) || coupons.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Coupons array required",
      );
    }

    const batch = db.batch();
    for (const coupon of coupons) {
      const ref = db.collection("coupons").doc(coupon.code);
      batch.set(ref, {
        code: coupon.code,
        type: coupon.type,
        discountPercent: coupon.discountPercent || null,
        freeDays: coupon.freeDays || null,
        targetPlan: coupon.targetPlan || null,
        maxUses: coupon.maxUses,
        usedCount: 0,
        expiresAt: new Date(coupon.expiresAt),
        createdAt: new Date(),
      });
    }

    await batch.commit();
    return { created: coupons.length };
  },
);

// 강의 구매 → 앱 쿠폰 자동 발급 (내부 함수)
async function issueLectureCouponInternal(userId: string) {
  const couponCode = "LECTURE2026";

  // Check if already redeemed
  const existing = await db
    .collection("couponRedemptions")
    .where("couponCode", "==", couponCode)
    .where("userId", "==", userId)
    .get();

  if (!existing.empty) return;

  // Record the coupon grant
  await db.collection("couponRedemptions").add({
    couponCode,
    userId,
    redeemedAt: new Date(),
    autoIssued: true,
  });
}

// 강의 구매 → 앱 쿠폰 자동 발급 (callable)
export const issueLectureCoupon = functions.https.onCall(
  async (_data, context) => {
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    await issueLectureCouponInternal(userId);
    return { couponCode: "LECTURE2026" };
  },
);

// ═══════════════════════════════════════════════════════════════════
// Founder Beta (파운더 100인 무료 베타) — V2 설문/루브릭 → Pro 무료 부여
// ═══════════════════════════════════════════════════════════════════
//
// 흐름:
//   1) 어드민이 betatester50_waitlist 검토 후 markFounderSelected({email}) 로 선정.
//      founders/{normalizedEmail} 생성, betaExpiresAt = 선정/활성화 + 1개월.
//   2) 파운더가 같은 (이메일 인증된) 계정으로 로그인 → /beta-survey
//      7문항 제출 → submitFounderFeedback(): 선정 여부 + 중복 제출 검증 후
//      founder_feedback 저장. 제출만으로 보상은 확정하지 않는다.
//   3) 운영자가 루브릭 채점(reviewFounderFeedback) → 기준 통과 시 Pro 총 3개월.
//   4) 운영자가 상위 응답자에게 인터뷰 요청(requestFounderInterview) 후 완료 처리
//      (markFounderInterviewed) → Pro 총 6개월로 연장.
//
// 어드민 식별: triggerReconcile 과 동일하게 ADMIN_UID env 단일 체크.

const FOUNDER_BETA_MONTHS = 1;
const FOUNDER_PRO_MONTHS = 3;
const FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS = 6;
const FOUNDER_PRO_RUBRIC_MIN_TOTAL = 10;
const FOUNDER_INTERVIEW_MIN_TOTAL = 14;
const FOUNDER_FIELD_MAX = 5000;
const FOUNDER_FEEDBACK_COLLECTION = "founder_feedback";
const FOUNDERS_COLLECTION = "founders";
const EXPERIENCE_SHARE_SURVEY_COLLECTION = "experience_share_surveys";
const EXPERIENCE_SHARE_REWARD_MONTHS = 5;
// 신청 목록 조회/반려 매칭이 스캔하는 최대 신청 수. 이메일 정규화 기준으로
// 매칭·중복제거하려면 doc 을 읽어봐야 해서 쿼리 필터 대신 스캔 상한을 둔다.
const WAITLIST_SCAN_LIMIT = 1000;
const WAITLIST_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AUTO_FOUNDER_COHORT_CAP = Number.parseInt(
  process.env.AUTO_FOUNDER_COHORT_CAP || "100",
  10,
);
const WAITLIST_TEST_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "test.co",
  "invalid.test",
]);
const WAITLIST_TYPO_DOMAINS = new Set([
  "gamil.com",
  "gmial.com",
  "gmai.com",
  "gmail.co",
  "hotmial.com",
  "hotmai.com",
  "hotnail.com",
  "outlok.com",
  "outllok.com",
  "icloud.con",
  "naver.con",
  "nvaer.com",
  "daum.con",
]);
/** 백필의 users/{uid} 동의 조회 배치 크기(getAll 1회당 문서 수). */
const USER_CONSENT_READ_CHUNK = 200;

interface FounderSurveyAnswers {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  q7: string;
}

interface FounderRubricScore {
  total: number;
  specificity: number;
  usageEvidence: number;
  insightQuality: number;
  actionability: number;
  icpFit: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function classifyWaitlistEmail(
  rawEmail: string,
): { ok: true; email: string } | { ok: false; email: string; reason: string } {
  const email = normalizeEmail(rawEmail);
  if (!email || !WAITLIST_EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, email, reason: "invalid_email" };
  }
  const [local, domain] = email.split("@");
  if (/^(qa-|verify-)/i.test(local)) {
    return { ok: false, email, reason: "test_local_prefix" };
  }
  if (WAITLIST_TEST_DOMAINS.has(domain)) {
    return { ok: false, email, reason: "test_domain" };
  }
  if (WAITLIST_TYPO_DOMAINS.has(domain)) {
    return { ok: false, email, reason: "typo_domain" };
  }
  return { ok: true, email };
}

function normalizeShortText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function requireAdmin(context: functions.https.CallableContext): void {
  const adminUid = process.env.ADMIN_UID?.trim();
  if (!adminUid) {
    functions.logger.warn(
      "[requireAdmin] ADMIN_UID is not configured; rejecting admin callable as server misconfiguration.",
    );
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Admin configuration is missing.",
    );
  }

  if (context.auth?.uid !== adminUid) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
}

// 구독 doc 를 Pro/active 로 upsert 한다. 기간(currentPeriodEnd)은 기존 값과
// targetEnd 중 더 나중을 유지 — 멱등: 이미 더 긴 기간이 있으면 절대 줄이지 않는다.
// 베타 선정(1개월)·예외승인(3개월)·인터뷰(6개월) 부여가 전부 이 경로로 수렴한다.
// paymentProvider="founder_grant" 로 표기해 갱신 크론(scheduledChargeSubscriptions,
// paymentProvider=="toss" 만 대상)에서 제외되고, 만료는 scheduledExpireBetaGrants
// 가 처리한다(1회성 부여, 자동 갱신 없음).
// ─── 유료/grant 판정 ────────────────────────────────────────────────
//
// 이 구독 doc 하나를 두고 두 방향의 질문이 오간다. 판정식이 하나면 한쪽을
// 고칠 때 반대쪽이 반드시 과교정되므로(실제로 그랬다) 셋으로 나눈다.
//   1) hasPaymentEvidence  — "결제한 흔적이 있나" (해지 후에도 남는다)
//   2) isLivePaidSubscription — "지금 돈 내고 있나" (부여/보존 판정)
//   3) isFounderGrantSubscription — "이건 무료 grant 인가" (회수 판정)

// 결제 흔적. ★"현재 유료" 가 아니다 — cancelTossSubscription 과 결제실패 강등은
// status 만 canceled/free 로 내리고 paymentProvider="toss" 와 tossBillingKey 를
// 그대로 남긴다. 그래서 이 함수만으로 "건드리지 마" 판정을 하면 해지·실효한
// 前결제자가 영구히 유료로 오판돼 파운더로 뽑혀도 Pro 를 못 받는다.
function hasPaymentEvidence(sub: Record<string, unknown> | undefined): boolean {
  if (!sub) return false;
  if (typeof sub.tossBillingKey === "string" && sub.tossBillingKey) return true;
  if (typeof sub.tossCustomerKey === "string" && sub.tossCustomerKey) {
    return true;
  }
  if (
    typeof sub.paddleSubscriptionId === "string" &&
    sub.paddleSubscriptionId
  ) {
    return true;
  }
  return sub.paymentProvider === "toss" || sub.paymentProvider === "paddle";
}

// 무료 파운더 grant 인가. founderGrant 플래그가 authoritative 마커다 —
// 결제 흔적(옛 billingKey)보다 우선한다. 안 그러면 "해지했다가 grant 를 받은"
// doc 이 stale billingKey 때문에 유료로 오판돼 반려해도 회수되지 않는다.
function isFounderGrantSubscription(
  sub: Record<string, unknown> | undefined,
): boolean {
  if (!sub) return false;
  return sub.founderGrant === true || sub.paymentProvider === "founder_grant";
}

// 지금 살아있는 유료 구독인가 = 결제 흔적 AND 현역 status.
// 이게 true 인 구독만 "건드리지 말 것"(grant 로 덮어쓰기 금지) 대상이다.
// past_due 도 현역 — 재시도 중인 결제라 grant 로 덮으면 과금이 끊긴다.
function isLivePaidSubscription(
  sub: Record<string, unknown> | undefined,
): boolean {
  if (!sub) return false;
  if (isFounderGrantSubscription(sub)) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  return hasPaymentEvidence(sub);
}

// grant 부여 결과. ★granted 를 반드시 호출부에 돌려준다 — 예전엔 "uid 를 찾았다"
// 를 곧 "부여했다" 로 계산해서, 부여가 스킵돼도 어드민에 성공으로 보고하는
// 조용한 실패가 있었다.
type ProGrantOutcome = {
  granted: boolean;
  periodEnd: Date;
  skippedReason: "live_paid" | null;
};

async function upsertProSubscription(
  userId: string,
  targetEnd: Date,
  reason: string,
  grantStartedAt: Date,
): Promise<ProGrantOutcome> {
  const now = new Date();
  const subRef = db.collection("subscriptions").doc(userId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(subRef);
    const data = snap.data();
    const existingEnd =
      data?.currentPeriodEnd &&
      typeof data.currentPeriodEnd.toDate === "function"
        ? data.currentPeriodEnd.toDate()
        : null;
    const periodEnd =
      existingEnd && existingEnd > targetEnd ? existingEnd : targetEnd;

    // ★ 현역 유료 구독은 결제 정체성을 절대 덮어쓰지 않는다.
    //
    // 예전엔 paymentProvider 를 무조건 founder_grant 로 stomp 했는데, 돈 내던
    // 유저가 파운더로 선정되면:
    //   1) billing.selectDueForCharge 가 paymentProvider!=="toss" 와
    //      founderGrant===true 양쪽으로 걸러서 재과금이 영구 정지되고(무료 영구),
    //   2) 반려/만료 로직이 그 doc 을 grant 로 오인해 취소·기간절단까지 한다.
    // 유료 유저는 이미 Pro 라 grant 로 덮어쓸 이유 자체가 없다. 파운더 자격은
    // founders/{email} doc 이 SoT 로 들고 있으므로 구독은 건드리지 않는다.
    //
    // ★ 단 "현역"(active/past_due) 일 때만. 해지·실효한 前결제자는 billingKey 가
    // 남아있을 뿐 지금 Pro 가 아니므로 정상적으로 grant 를 부여해야 한다.
    // 트랜잭션 안에서 판정해 결제 생성과 grant 생성의 race 에서도 stomp 하지 않는다.
    if (isLivePaidSubscription(data)) {
      console.log(
        `[upsertProSubscription] 현역 유료 구독(${userId}, status=${data?.status}) — grant(${reason}) 로 덮어쓰지 않고 결제 유지`,
      );
      return {
        granted: false,
        periodEnd: existingEnd ?? periodEnd,
        skippedReason: "live_paid",
      };
    }

    const payload: Record<string, unknown> = {
      userId,
      planType: "pro",
      status: "active",
      paymentProvider: "founder_grant",
      founderGrant: true,
      founderGrantReason: reason,
      founderGrantStartedAt: admin.firestore.Timestamp.fromDate(grantStartedAt),
      currentPeriodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      payload.currentPeriodStart = admin.firestore.Timestamp.fromDate(now);
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.set(subRef, payload, { merge: true });
    return { granted: true, periodEnd, skippedReason: null };
  });
}

async function grantFounderProTotalInternal(
  userId: string,
  totalMonths: number,
  reason: string,
  grantStartedAt: Date,
): Promise<Date> {
  const outcome = await upsertProSubscription(
    userId,
    addMonths(grantStartedAt, totalMonths),
    reason,
    grantStartedAt,
  );
  return outcome.periodEnd;
}

export const submitExperienceShareSurvey = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const uid = context.auth.uid;
    const rating = Number((data as { rating?: unknown }).rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "rating must be 1..5",
      );
    }

    const liked = normalizeShortText((data as { liked?: unknown }).liked, 1000);
    const improvements = normalizeShortText(
      (data as { improvements?: unknown }).improvements,
      1000,
    );
    if (!liked && !improvements) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "liked or improvements is required",
      );
    }

    const shareUrl = normalizeHttpUrl(
      (data as { shareUrl?: unknown }).shareUrl,
    );
    if (!shareUrl) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "shareUrl must be an http(s) URL",
      );
    }

    const sessionCountRaw = Number(
      (data as { sessionCount?: unknown }).sessionCount,
    );
    const sessionCount =
      Number.isFinite(sessionCountRaw) && sessionCountRaw > 0
        ? Math.trunc(sessionCountRaw)
        : null;
    const ref = db.collection(EXPERIENCE_SHARE_SURVEY_COLLECTION).doc(uid);
    const existing = await ref.get();
    if (existing.exists) {
      const existingData = existing.data() ?? {};
      const periodEnd = timestampToDate(existingData.rewardPeriodEnd);
      return {
        ok: true,
        id: ref.id,
        rewardMonths: EXPERIENCE_SHARE_REWARD_MONTHS,
        reviewStatus: "already_submitted",
        grantApplied: existingData.rewardGrantApplied === true,
        periodEnd: periodEnd?.toISOString(),
      };
    }

    const now = new Date();
    const rewardEnd = addMonths(now, EXPERIENCE_SHARE_REWARD_MONTHS);
    const grantOutcome = await upsertProSubscription(
      uid,
      rewardEnd,
      "experience_share_reward",
      now,
    );

    await ref.set({
      userId: uid,
      rating,
      liked,
      improvements,
      shareUrl,
      sessionCount,
      rewardMonths: EXPERIENCE_SHARE_REWARD_MONTHS,
      rewardPlanType: "pro",
      rewardGrantApplied: grantOutcome.granted,
      rewardSkippedReason: grantOutcome.skippedReason,
      rewardPeriodEnd: admin.firestore.Timestamp.fromDate(
        grantOutcome.periodEnd,
      ),
      reviewStatus: "pending_review",
      adminReviewRequired: true,
      spamReviewFlag: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      id: ref.id,
      rewardMonths: EXPERIENCE_SHARE_REWARD_MONTHS,
      reviewStatus: "pending_review",
      grantApplied: grantOutcome.granted,
      periodEnd: grantOutcome.periodEnd.toISOString(),
    };
  },
);

function timestampToDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  return null;
}

function laterDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function resolveFounderGrantWindowEnd(
  founder: Record<string, unknown>,
): Date | null {
  const betaEnd = timestampToDate(founder.betaExpiresAt);
  const proEnd = timestampToDate(founder.proExpiresAt);
  const explicitWindowEnd = laterDate(betaEnd, proEnd);
  if (explicitWindowEnd) return explicitWindowEnd;

  // Legacy selected docs may have accessGrantedAt but no betaExpiresAt. The
  // intended base grant is one month from access grant, so reconstruct it.
  const accessGrantedAt = timestampToDate(founder.accessGrantedAt);
  return accessGrantedAt
    ? addMonths(accessGrantedAt, FOUNDER_BETA_MONTHS)
    : null;
}

type FounderGrantMaterializationResult = {
  granted: boolean;
  uid: string;
  windowEnd: Date | null;
  skippedReason: ProGrantOutcome["skippedReason"] | "window_expired";
};

async function materializeFounderProGrantForUid(
  founderRef: admin.firestore.DocumentReference,
  founder: Record<string, unknown>,
  uid: string,
  reason: string,
  grantStartedAt: Date,
): Promise<FounderGrantMaterializationResult> {
  const windowEnd = resolveFounderGrantWindowEnd(founder);
  if (!windowEnd || windowEnd <= new Date()) {
    return {
      granted: false,
      uid,
      windowEnd,
      skippedReason: "window_expired",
    };
  }

  const outcome = await upsertProSubscription(
    uid,
    windowEnd,
    reason,
    grantStartedAt,
  );

  // 실제 founder_grant 구독을 만들었을 때만 grant 흔적을 남긴다. 현역 유료 구독
  // 스킵을 성공처럼 기록하면 반려/만료 경로가 유료 구독을 grant 로 오인한다.
  if (outcome.granted) {
    await founderRef.set(
      {
        proSubscriptionUid: uid,
        proSubscriptionEnd: admin.firestore.Timestamp.fromDate(windowEnd),
        proSubscriptionGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return {
    granted: outcome.granted,
    uid,
    windowEnd,
    skippedReason: outcome.skippedReason,
  };
}

// 이메일로 Firebase Auth 계정의 uid 를 찾는다. 미가입/조회 실패는 null(비-throw) —
// 선정(이메일 기준)은 가입 이전에도 일어나므로 uid 부재가 정상 흐름이다.
async function lookupUidByEmail(email: string): Promise<string | null> {
  try {
    const user = await admin.auth().getUserByEmail(email);
    return user.uid;
  } catch {
    return null;
  }
}

// ─── 파운더 접근 안내 이메일 (SendGrid) ──────────────────────────────
//
// 선정된 파운더에게 ①선정 축하 ②베타 다운로드 ③피드백(필수·3일) ④강의 50%
// 쿠폰(FOUNDER50) ⑤디스코드(env 있을 때만) 를 ko/en/ja 로 발송한다.
// 반드시 non-throwing — API 키 미설정/발송 실패 시 console.warn 후 false 반환.
// (이메일 실패로 선정 자체가 깨지면 안 된다.)

type FounderLocale = "ko" | "en" | "ja";

function normalizeFounderLocale(locale: string): FounderLocale {
  if (locale === "en" || locale === "ja") return locale;
  return "ko"; // 알 수 없는 값은 한국어 기본
}

interface FounderEmailContent {
  subject: string;
  html: string;
  text: string;
}

// export 는 테스트의 dry 렌더용. 트리거가 아니므로(=__endpoint 없음)
// firebase-functions 의 배포 discovery 는 이 export 를 건너뛴다.
export function buildFounderAccessEmail(
  locale: FounderLocale,
): FounderEmailContent {
  const downloadUrl = `${SITE_BASE}/${locale}/download`;
  const feedbackUrl = `${SITE_BASE}/${locale}/beta-survey`;
  const coupon = FOUNDER_COURSE_COUPON;
  const hasDiscord = !!DISCORD_INVITE_URL;

  if (locale === "en") {
    const discordHtml = hasDiscord
      ? `<p>Talk with other founders in real time, get product updates first, and share bugs or feedback directly with the team.</p>
        <p><a href="${DISCORD_INVITE_URL}" style="color:#4f46e5;font-weight:600">Join the Founders Discord →</a></p>`
      : `<p style="color:#666">A separate Discord invite will follow shortly.</p>`;
    const discordText = hasDiscord
      ? [
          `Join the Founders Discord: ${DISCORD_INVITE_URL}`,
          "   Talk with other founders in real time, get product updates first,",
          "   and share bugs or feedback directly with the team.",
        ].join("\n")
      : `A separate Discord invite will follow shortly.`;
    return {
      subject: "🎉 You're a Marblo Founder — Access Details Inside",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">🎉 Welcome, Founder!</h1>
        <p>You've been selected as one of our founding members. Founders shape Marblo from day one — thank you for joining us.</p>
        <h2 style="font-size:17px;margin:24px 0 8px">1. Get the beta</h2>
        <p>Download Marblo here: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a></p>
        <h2 style="font-size:17px;margin:24px 0 8px">2. Survey after your 1-month beta</h2>
        <p>Please submit the beta survey here: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
        Thoughtful survey responses that pass rubric review extend your beta to <strong>up to 3 months total, including your 1-month beta</strong>. A small set of top responses may be invited to a video interview; completing it extends Pro to <strong>6 months total</strong>.</p>
        <h2 style="font-size:17px;margin:24px 0 8px">3. 50% off the course</h2>
        <p>The Marblo course is coming soon. When it launches, coupon code <strong style="font-family:monospace;background:#f1f1f1;padding:2px 6px;border-radius:4px">${coupon}</strong> gets you <strong>50% off</strong> — double the 25% early-bird discount. Hold on to the code until then.</p>
        <h2 style="font-size:17px;margin:24px 0 8px">4. Community</h2>
        ${discordHtml}
      `),
      text: [
        "Welcome, Founder!",
        "",
        "You've been selected as one of our founding members.",
        "",
        `1. Get the beta: ${downloadUrl}`,
        "",
        `2. Beta survey: ${feedbackUrl}`,
        "   Thoughtful responses that pass rubric review extend your beta to up to 3 months total, including your 1-month beta.",
        "   Top responses may be invited to a video interview; completion extends Pro to 6 months total.",
        "",
        `3. 50% off the course — the course is coming soon. At launch, coupon code: ${coupon} gets you 50% off (double the 25% early-bird discount).`,
        "",
        `4. ${discordText}`,
      ].join("\n"),
    };
  }

  if (locale === "ja") {
    const discordHtml = hasDiscord
      ? `<p>他のファウンダーとリアルタイムで交流し、製品アップデートをいち早く受け取り、バグやフィードバックをチームに直接お寄せいただけます。</p>
        <p><a href="${DISCORD_INVITE_URL}" style="color:#4f46e5;font-weight:600">ファウンダー Discord に参加する →</a></p>`
      : `<p style="color:#666">Discord の招待は追ってご案内します。</p>`;
    const discordText = hasDiscord
      ? [
          `ファウンダー Discord: ${DISCORD_INVITE_URL}`,
          "   他のファウンダーとリアルタイムで交流し、製品アップデートをいち早く受け取り、",
          "   バグやフィードバックをチームに直接お寄せいただけます。",
        ].join("\n")
      : `Discord の招待は追ってご案内します。`;
    return {
      subject: "🎉 Marblo ファウンダーに選ばれました — アクセス案内",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">🎉 ファウンダー選定おめでとうございます！</h1>
        <p>あなたは Marblo のファウンダーに選ばれました。ファウンダーは初日から Marblo を形づくる存在です。ご参加ありがとうございます。</p>
        <h2 style="font-size:17px;margin:24px 0 8px">1. ベータ版を入手</h2>
        <p>こちらからダウンロード: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a></p>
        <h2 style="font-size:17px;margin:24px 0 8px">2. 1ヶ月ベータ後のアンケート</h2>
        <p>ベータアンケートはこちら: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
        ルーブリック審査を通過した丁寧な回答は、<strong>ベータ1ヶ月を含む最大3ヶ月まで</strong> Pro を延長します。上位回答者の一部にはビデオインタビューを依頼し、完了すると Pro を <strong>合計6ヶ月</strong> に延長します。</p>
        <h2 style="font-size:17px;margin:24px 0 8px">3. 講座 50% 割引</h2>
        <p>講座は近日公開予定です。公開時にクーポンコード <strong style="font-family:monospace;background:#f1f1f1;padding:2px 6px;border-radius:4px">${coupon}</strong> をご利用いただくと <strong>50% OFF</strong> — アーリーバード 25% の2倍です。公開までコードを大切に保管してください。</p>
        <h2 style="font-size:17px;margin:24px 0 8px">4. コミュニティ</h2>
        ${discordHtml}
      `),
      text: [
        "ファウンダー選定おめでとうございます！",
        "",
        "あなたは Marblo のファウンダーに選ばれました。",
        "",
        `1. ベータ版を入手: ${downloadUrl}`,
        "",
        `2. ベータアンケート: ${feedbackUrl}`,
        "   ルーブリック審査を通過した丁寧な回答は、ベータ1ヶ月を含む最大3ヶ月まで Pro を延長します。",
        "   上位回答者の一部にはビデオインタビューを依頼し、完了すると Pro を合計6ヶ月に延長します。",
        "",
        `3. 講座 50% 割引 — 講座は近日公開予定です。公開時にクーポンコード: ${coupon} で 50% OFF（アーリーバード 25% の2倍）。`,
        "",
        `4. ${discordText}`,
      ].join("\n"),
    };
  }

  // 기본: 한국어
  const discordHtml = hasDiscord
    ? `<p>다른 파운더들과 실시간으로 이야기 나누고, 제품 업데이트를 가장 먼저 받아보고, 버그·피드백을 팀에 바로 전해 주세요.</p>
      <p><a href="${DISCORD_INVITE_URL}" style="color:#4f46e5;font-weight:600">파운더 디스코드 참여하기 →</a></p>`
    : `<p style="color:#666">디스코드 초대는 곧 별도로 안내드리겠습니다.</p>`;
  const discordText = hasDiscord
    ? [
        `파운더 디스코드: ${DISCORD_INVITE_URL}`,
        "   다른 파운더들과 실시간으로 이야기 나누고, 제품 업데이트를 가장 먼저 받아보고,",
        "   버그·피드백을 팀에 바로 전해 주세요.",
      ].join("\n")
    : `디스코드 초대는 곧 별도로 안내드리겠습니다.`;
  return {
    subject: "🎉 마블로 파운더로 선정되셨습니다 — 접근 안내",
    html: founderHtmlShell(`
      <h1 style="font-size:22px;margin:0 0 16px">🎉 파운더로 선정되셨습니다!</h1>
      <p>마블로의 파운더로 선정되신 것을 축하드립니다. 파운더는 첫날부터 마블로를 함께 만들어가는 분들입니다. 함께해 주셔서 감사합니다.</p>
      <h2 style="font-size:17px;margin:24px 0 8px">1. 베타 접근</h2>
      <p>여기에서 마블로를 다운로드하세요: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a></p>
      <h2 style="font-size:17px;margin:24px 0 8px">2. 1개월 베타 후 설문</h2>
      <p>베타 설문은 여기에서 제출해 주세요: <a href="${feedbackUrl}" style="color:#4f46e5">${feedbackUrl}</a><br/>
      루브릭 검토를 통과한 성실 응답은 <strong>베타 1개월을 최대 3개월까지</strong> 연장해 드립니다(기존 베타 1개월 포함, 총 3개월). 상위 응답자 일부에게는 화상 인터뷰를 별도로 요청하며, 완료 시 Pro를 <strong>총 6개월</strong>로 연장합니다.</p>
      <h2 style="font-size:17px;margin:24px 0 8px">3. 강의 50% 할인 쿠폰</h2>
      <p>강의는 곧 공개 예정입니다. 출시되면 쿠폰 코드 <strong style="font-family:monospace;background:#f1f1f1;padding:2px 6px;border-radius:4px">${coupon}</strong> 로 <strong>50% 할인</strong>해 드립니다 — 얼리버드 25%의 2배 혜택입니다. 출시까지 코드를 잘 보관해 주세요.</p>
      <h2 style="font-size:17px;margin:24px 0 8px">4. 커뮤니티</h2>
      ${discordHtml}
    `),
    text: [
      "파운더로 선정되셨습니다!",
      "",
      "마블로의 파운더로 선정되신 것을 축하드립니다.",
      "",
      `1. 베타 접근(다운로드): ${downloadUrl}`,
      "",
      `2. 베타 설문: ${feedbackUrl}`,
      "   루브릭 검토를 통과한 성실 응답은 베타 1개월을 최대 3개월까지 연장해 드립니다(기존 베타 1개월 포함, 총 3개월).",
      "   상위 응답자 일부에게는 화상 인터뷰를 별도로 요청하며, 완료 시 Pro를 총 6개월로 연장합니다.",
      "",
      `3. 강의 50% 할인 — 강의는 곧 공개 예정입니다. 출시 시 쿠폰 코드: ${coupon} 로 50% 할인(얼리버드 25%의 2배).`,
      "",
      `4. ${discordText}`,
    ].join("\n"),
  };
}

// ─── 설문 회신 유도 리마인더 이메일 (Resend) ────────────────────────
//
// 초기 접근 안내(buildFounderAccessEmail)와 별개로, "베타는 활성화했지만 아직
// 설문 미회신"인 파운더에게 "성실 설문 회신 시 운영자 검토 후 기존 베타 1개월 포함
// 총 3개월까지 연장"을 다시 안내하는 전용 리마인더. ★1차 채널은 이메일(사장님 채널 피벗): 인앱 팝업은
// 앱을 여는 활성 사용자만 닿기 때문. 이 메일의 대상은 "활성화 O, 설문 X"이고,
// 미활성 선정자 팔로업(별도 티켓 WjGoowu1rjLH4K2PNIXb)과 audience 가 겹치지 않게
// feedbackSubmittedAt==null AND 활성 신호로 세그먼트한다(중복 발송 방지).
//
// export 는 테스트의 dry 렌더용(트리거 아님 → 배포 discovery 스킵).
export function buildFounderSurveyOfferEmail(
  locale: FounderLocale,
): FounderEmailContent {
  const feedbackUrl = `${SITE_BASE}/${locale}/beta-survey`;

  if (locale === "en") {
    return {
      subject: "Your Marblo beta survey — extend beta to 3 months total",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">Got 5 minutes? Extend your beta to up to 3 months total</h1>
        <p>Thanks for trying the Marblo beta. When you're ready, please share a thoughtful 7-question survey about your experience.</p>
        <p><a href="${feedbackUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none">Answer the survey →</a></p>
        <p style="color:#666;font-size:13px">Responses that pass rubric review extend your beta to <strong>up to 3 months total, including your 1-month beta</strong>. Submitting alone isn't an automatic grant, and any active paid subscription you have is never affected.</p>
      `),
      text: [
        "Got 5 minutes? Extend your beta to up to 3 months total",
        "",
        "Thanks for trying the Marblo beta. When you're ready, please share a thoughtful 7-question survey about your experience.",
        "",
        `Answer the survey: ${feedbackUrl}`,
        "",
        "Responses that pass rubric review extend your beta to up to 3 months total, including your 1-month beta. Submitting alone isn't an automatic grant, and any active paid subscription you have is never affected.",
      ].join("\n"),
    };
  }

  if (locale === "ja") {
    return {
      subject: "Marblo ベータアンケート — ベータ最大3ヶ月まで",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">5分でベータ最大3ヶ月まで</h1>
        <p>Marblo ベータのお試しありがとうございます。よろしければ、7問の誠実なアンケートで体験をお聞かせください。</p>
        <p><a href="${feedbackUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none">アンケートに回答する →</a></p>
        <p style="color:#666;font-size:13px">ルーブリック審査を通過した回答は、<strong>ベータ1ヶ月を含む最大3ヶ月まで</strong> Pro を延長します。提出だけで自動付与されるわけではなく、現在お支払い中のサブスクリプションには影響しません。</p>
      `),
      text: [
        "5分でベータ最大3ヶ月まで",
        "",
        "Marblo ベータのお試しありがとうございます。よろしければ、7問の誠実なアンケートで体験をお聞かせください。",
        "",
        `アンケートに回答する: ${feedbackUrl}`,
        "",
        "ルーブリック審査を通過した回答は、ベータ1ヶ月を含む最大3ヶ月まで Pro を延長します。提出だけで自動付与されるわけではなく、現在お支払い中のサブスクリプションには影響しません。",
      ].join("\n"),
    };
  }

  // 기본: 한국어
  return {
    subject: "마블로 베타 설문 — 베타 최대 3개월까지",
    html: founderHtmlShell(`
      <h1 style="font-size:22px;margin:0 0 16px">5분이면 베타를 최대 3개월까지</h1>
      <p>마블로 베타를 사용해 주셔서 감사합니다. 준비되시면 7문항 성실 설문으로 사용 경험을 들려주세요.</p>
      <p><a href="${feedbackUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none">설문 회신하기 →</a></p>
      <p style="color:#666;font-size:13px">루브릭 검토를 통과한 응답은 <strong>베타 1개월을 최대 3개월까지</strong> 연장해 드립니다(기존 베타 1개월 포함, 총 3개월). 제출만으로 자동 지급되지는 않으며, 현재 결제 중인 구독은 절대 영향받지 않습니다.</p>
    `),
    text: [
      "5분이면 베타를 최대 3개월까지",
      "",
      "마블로 베타를 사용해 주셔서 감사합니다. 준비되시면 7문항 성실 설문으로 사용 경험을 들려주세요.",
      "",
      `설문 회신하기: ${feedbackUrl}`,
      "",
      "루브릭 검토를 통과한 응답은 베타 1개월을 최대 3개월까지 연장해 드립니다(기존 베타 1개월 포함, 총 3개월). 제출만으로 자동 지급되지는 않으며, 현재 결제 중인 구독은 절대 영향받지 않습니다.",
    ].join("\n"),
  };
}

// 공통 HTML 래퍼 (간단·인라인 스타일).
function founderHtmlShell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f6f6">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;background:#ffffff">
    ${inner}
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px"/>
    <p style="font-size:12px;color:#999;margin:0">Marblo · ${FOUNDER_SUPPORT_EMAIL}</p>
  </div></body></html>`;
}

/**
 * Resend 공통 발송 경로. 모든 파운더 계열 이메일이 여기로 모여
 * From/Reply-To 를 team@marblo.app 로 단일화한다(단일소스).
 * ★non-throwing 은 호출부 try/catch 책임 — 여기선 HTTP 실패만 false 로 흡수.
 */
async function postResendEmail(
  to: string,
  content: FounderEmailContent,
  logPrefix: string,
  // 마케팅 메일용 추가 헤더(List-Unsubscribe 등). transactional 은 생략.
  extraHeaders?: Record<string, string>,
): Promise<boolean> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FOUNDER_FROM_NAME} <${FOUNDER_FROM_EMAIL}>`,
      reply_to: [FOUNDER_REPLY_TO],
      to: [to],
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(extraHeaders && Object.keys(extraHeaders).length > 0
        ? { headers: extraHeaders }
        : {}),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn(`[${logPrefix}] resend HTTP ${resp.status}: ${body}`);
    return false;
  }
  return true;
}

/**
 * 파운더 접근 안내 이메일 발송. 반드시 non-throwing.
 * - RESEND_API_KEY 미설정 시 console.warn 후 false 반환(스킵).
 * - 발송 성공 시 true, 그 외 false.
 */
async function sendFounderAccessEmail(
  email: string,
  locale: string,
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn("[founder-email] RESEND_API_KEY 미설정 — 발송 스킵:", email);
      return false;
    }
    const content = buildFounderAccessEmail(normalizeFounderLocale(locale));
    return await postResendEmail(email, content, "founder-email");
  } catch (err) {
    console.warn("[founder-email] 발송 실패:", email, err);
    return false;
  }
}

/**
 * 설문 회신 유도 리마인더 이메일 발송. sendFounderAccessEmail 과 동일 규약
 * (non-throwing, RESEND_API_KEY 없으면 스킵). 대상 세그먼트 판정은 호출부가
 * 책임진다(여기선 단일 발송만).
 */
async function sendFounderSurveyOfferEmail(
  email: string,
  locale: string,
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn(
        "[founder-email] RESEND_API_KEY 미설정 — 설문 리마인더 발송 스킵:",
        maskEmailForLog(email),
      );
      return false;
    }
    const content = buildFounderSurveyOfferEmail(
      normalizeFounderLocale(locale),
    );
    // 마케팅 메일 — one-click unsubscribe 헤더+푸터(CAN-SPAM/RFC 8058).
    const delivery = marketingEmailDelivery(email);
    return await postResendEmail(
      email,
      delivery ? withUnsubscribeFooter(content, delivery) : content,
      "founder-email",
      delivery?.headers,
    );
  } catch (err) {
    console.warn(
      "[founder-email] 설문 리마인더 발송 실패:",
      maskEmailForLog(email),
      err,
    );
    return false;
  }
}

// 로그/보고용 이메일 마스킹 — PII 대량 노출 금지. a***@ex***.com 형태.
function maskEmailForLog(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot >= 0 ? domain.slice(dot) : "";
  const dname = dot >= 0 ? domain.slice(0, dot) : domain;
  const maskPart = (s: string): string => (s.length <= 1 ? "*" : `${s[0]}***`);
  return `${maskPart(local)}@${maskPart(dname)}${tld}`;
}

// waitlist 에서 해당 이메일의 locale 을 조회(없으면 'ko').
async function lookupFounderLocale(email: string): Promise<string> {
  try {
    const snap = await db
      .collection("betatester50_waitlist")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!snap.empty) {
      const loc = snap.docs[0].data()?.locale;
      if (typeof loc === "string" && loc) return loc;
    }
  } catch (err) {
    console.warn("[founder-email] locale 조회 실패:", email, err);
  }
  return "ko";
}

// 신청 doc 의 email 은 클라가 직접 쓴 원문이라 대소문자/공백이 섞여 있다.
// 정규화 기준으로 매칭해야 중복 신청(동일 이메일 여러 건)까지 함께 잡힌다.
// 쿼리 필터로는 정규화 비교가 안 돼서 스캔 후 필터한다(어드민 저빈도 액션).
async function findWaitlistDocsByEmail(
  email: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snap = await db
    .collection("betatester50_waitlist")
    .limit(WAITLIST_SCAN_LIMIT)
    .get();
  return snap.docs.filter((d) => {
    const v = d.data() as Record<string, unknown>;
    return typeof v.email === "string" && normalizeEmail(v.email) === email;
  });
}

// 파운더 선정 핵심 로직 (내부) — waitlist 이메일을 founders 로 승격.
// accessGrantedAt 이 1개월 베타 시작 기준. resetWindow=true 면 베타 기간 재시작.
// markFounderSelected onCall 과 Telegram 승인 웹훅 양쪽에서 재사용한다.
async function markFounderSelectedInternal(
  rawEmail: string,
  resetWindow = false,
): Promise<{
  ok: true;
  email: string;
  emailSent: boolean;
  betaExpiresAt: string;
  // 승인=Pro 부여. 실제로 구독을 부여했을 때만 true.
  //  - 미가입(uid 없음) → false. 가입 시 grantBetaProOnSignup 이 뒤늦게 부여.
  //  - 이미 현역 유료 구독 → false + skippedReason="live_paid" (덮어쓰면 과금이
  //    끊기므로 정상 스킵. 이미 Pro 라 접근엔 문제 없음)
  // ★"uid 를 찾았다"를 "부여했다"로 계산하면 조용한 실패가 된다.
  subscriptionGranted: boolean;
  subscriptionSkippedReason: string | null;
  subscriptionUid: string | null;
}> {
  const email = normalizeEmail(rawEmail);
  const ref = db.collection(FOUNDERS_COLLECTION).doc(email);
  const snap = await ref.get();
  const betaStartedAt = new Date();
  let betaExpiresAt = addMonths(betaStartedAt, FOUNDER_BETA_MONTHS);

  const update: Record<string, unknown> = {
    email,
    status: "selected",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    update.selectedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  // 반려됐던 파운더의 재선정은 "새 선정" 으로 본다.
  // markFounderRejected 가 betaExpiresAt 를 즉시만료(now)로 박아두기 때문에,
  // accessGrantedAt 이 남아있다는 이유로 기존 값을 유지하면 status 만 selected 로
  // 바뀌고 만료일은 과거 그대로 = 어드민 UI 는 "선정됨" 인데 실제 접근은 만료인
  // 허위표시가 된다. 어드민 UI 는 resetWindow 를 보내지 않으므로(기본 false)
  // 백엔드가 스스로 리셋해야 텔레그램 승인 경로까지 함께 복구된다.
  const wasRejected = snap.data()?.status === "rejected";
  if (wasRejected) {
    update.rejectedAt = admin.firestore.FieldValue.delete();
  }
  if (
    !snap.exists ||
    !snap.data()?.accessGrantedAt ||
    resetWindow ||
    wasRejected
  ) {
    update.accessGrantedAt = admin.firestore.FieldValue.serverTimestamp();
    update.betaExpiresAt = admin.firestore.Timestamp.fromDate(betaExpiresAt);
  } else {
    const existingBetaExpiresAt = snap.data()?.betaExpiresAt;
    if (
      existingBetaExpiresAt &&
      typeof existingBetaExpiresAt.toDate === "function"
    ) {
      betaExpiresAt = existingBetaExpiresAt.toDate();
    }
  }
  await ref.set(update, { merge: true });

  // 반려 되돌림 — 선정은 반려의 역방향이므로 신청 doc 의 rejected 마킹도 푼다.
  // 안 풀면 재선정된 사람이 대기자 기본 목록에서 계속 빠져 "반려됨" 으로 보인다
  // (markFounderRejected 가 붙인 마킹과 대칭).
  for (const doc of await findWaitlistDocsByEmail(email)) {
    if (doc.data().status !== "rejected") continue;
    await doc.ref.set(
      {
        status: admin.firestore.FieldValue.delete(),
        rejectedAt: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
  }

  // 선정 직후 접근 안내 이메일 자동 발송. 이메일 실패가 선정을 깨면 안 되므로
  // sendFounderAccessEmail 은 non-throwing 이고 결과만 기록한다.
  const locale = await lookupFounderLocale(email);
  const emailSent = await sendFounderAccessEmail(email, locale);
  await ref.set(
    {
      accessEmailSent: emailSent,
      accessEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 승인 = Pro 부여. 베타 유저가 즉시 Pro 기능을 쓰려면 subscriptions/{uid}
  // (planType=pro, active) doc 이 있어야 한다(앱 subscriptionStore 게이팅). 이메일로
  // 계정을 찾아 구독을 materialize 한다. 아직 미가입(선정→다운로드 예정)이면 uid 가
  // 없으므로 founders/{email}.betaExpiresAt 를 SoT 로 남기고, 가입하는 순간
  // grantBetaProOnSignup(auth onCreate) 이 뒤늦게 부여한다. 멱등: upsertProSubscription
  // 이 기존 기간을 줄이지 않으므로 중복 승인/재선정도 이중부여가 아니다.
  let subscriptionUid: string | null = null;
  let subscriptionGranted = false;
  // 부여를 건너뛴 이유(있으면). "이미 현역 유료라 Pro 를 덧씌울 필요 없음" 은
  // 실패가 아니라 정상 스킵이지만, 어드민이 성공/스킵을 구분할 수 있어야 한다.
  let subscriptionSkippedReason: string | null = null;
  const uid = await lookupUidByEmail(email);
  if (uid) {
    const existingFounder = snap.data() || {};
    const founderForGrant: Record<string, unknown> = {
      ...existingFounder,
      ...update,
      betaExpiresAt: admin.firestore.Timestamp.fromDate(betaExpiresAt),
    };
    founderForGrant.accessGrantedAt = update.accessGrantedAt
      ? admin.firestore.Timestamp.fromDate(betaStartedAt)
      : existingFounder.accessGrantedAt;
    const outcome = await materializeFounderProGrantForUid(
      ref,
      founderForGrant,
      uid,
      "beta_selected",
      betaStartedAt,
    );
    subscriptionUid = outcome.uid;
    subscriptionGranted = outcome.granted;
    subscriptionSkippedReason = outcome.skippedReason;
  }

  return {
    ok: true,
    email,
    emailSent,
    betaExpiresAt: betaExpiresAt.toISOString(),
    subscriptionGranted,
    subscriptionSkippedReason,
    subscriptionUid,
  };
}

// 파운더 선정 (관리자용) — waitlist 이메일을 founders 로 승격.
export const markFounderSelected = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }
    const resetWindow = data?.resetWindow === true;
    return markFounderSelectedInternal(email, resetWindow);
  },
);

// 파운더 반려 (관리자용) — markFounderSelected 의 역방향.
//
// 1) betatester50_waitlist 의 해당 이메일 신청을 전부 status="rejected" 로 마킹
//    → getFounderWaitlist 기본 목록에서 빠져 재선정 대상에서 제외된다.
// 2) 이미 선정된 이메일이면 founders/{email} grant 를 회수한다.
//    status="rejected" 는 getMyFounderAccess/submitFounderFeedback 이 이미 쓰는
//    게이트 값이라 그대로 재사용하고, betaExpiresAt 도 즉시 만료로 당겨 이중으로 막는다.
// 3) 부여했던 Pro 구독은 scheduledExpireBetaGrants 와 동일하게 status="canceled".
//    ★ paymentProvider==="founder_grant" 인 구독만 건드린다 — 유료(toss) 결제자가
//    파운더로도 선정됐던 경우 반려가 유료 구독까지 취소하면 안 된다.
async function revokeFounderGrant(
  email: string,
): Promise<{ founderRevoked: boolean; subscriptionRevoked: boolean }> {
  const ref = db.collection(FOUNDERS_COLLECTION).doc(email);
  const snap = await ref.get();
  if (!snap.exists) {
    return { founderRevoked: false, subscriptionRevoked: false };
  }

  const fd = snap.data() ?? {};
  await ref.set(
    {
      status: "rejected",
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      betaExpiresAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 구독 회수 — 선정 시 기록해둔 proSubscriptionUid 우선, 없으면 이메일로 재조회.
  const uid =
    typeof fd.proSubscriptionUid === "string" && fd.proSubscriptionUid
      ? fd.proSubscriptionUid
      : await lookupUidByEmail(email);
  let subscriptionRevoked = false;
  if (uid) {
    const subRef = db.collection("subscriptions").doc(uid);
    const subSnap = await subRef.get();
    const sub = subSnap.data();
    // 무료 grant 만 회수한다. 판정은 founderGrant 마커가 authoritative —
    // 결제 흔적(옛 billingKey)으로 판정하면 "해지했다가 grant 를 받은" 유저의
    // 무료 Pro 가 stale billingKey 때문에 회수되지 않는다(어드민엔 "즉시 회수"
    // 라고 해놓고 안 회수 = 약속 위반). 반대로 현역 유료 구독은 애초에
    // founderGrant 마커가 없으므로(stomp 를 막았다) 여기 걸리지 않는다.
    if (subSnap.exists && isFounderGrantSubscription(sub)) {
      // 레거시 경보: stomp 를 막기 전에 유료 구독이 grant 로 덮인 doc 이라면
      // 결제 흔적이 남아있다. 회수는 하되(무료 grant 로 보이므로) 사람이
      // 확인할 수 있게 남긴다 — 필드만으론 "해지후 grant" 와 구분 불가.
      if (hasPaymentEvidence(sub)) {
        console.warn(
          `[markFounderRejected] ★결제 흔적이 남은 grant doc 회수 (uid=${uid}) — 과거 stomp 로 유료구독이 grant 로 덮인 건이면 수동 확인 필요`,
        );
      }
      if (sub?.status === "active") {
        await subRef.set(
          {
            status: "canceled",
            canceledAt: admin.firestore.FieldValue.serverTimestamp(),
            currentPeriodEnd: admin.firestore.Timestamp.fromDate(new Date()),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      subscriptionRevoked = true;
    } else if (subSnap.exists) {
      console.log(
        `[markFounderRejected] grant 아님 — 구독 보존(취소하지 않음). status=${sub?.status}, paymentProvider=${sub?.paymentProvider}`,
      );
    }
  }
  return { founderRevoked: true, subscriptionRevoked };
}

export const markFounderRejected = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }

    const targets = await findWaitlistDocsByEmail(email);
    for (const doc of targets) {
      await doc.ref.set(
        {
          status: "rejected",
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const { founderRevoked, subscriptionRevoked } =
      await revokeFounderGrant(email);
    console.log(
      `[markFounderRejected] email=${email} waitlist=${targets.length} founderRevoked=${founderRevoked} subRevoked=${subscriptionRevoked}`,
    );
    return {
      ok: true as const,
      email,
      waitlistRejected: targets.length,
      founderRevoked,
      subscriptionRevoked,
    };
  },
);

// 파운더 접근 안내 이메일 재발송 (관리자용) — /admin 에서 수동 재발송용.
export const resendFounderAccessEmail = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }
    const locale = await lookupFounderLocale(email);
    const emailSent = await sendFounderAccessEmail(email, locale);
    await db.collection(FOUNDERS_COLLECTION).doc(email).set(
      {
        accessEmailSent: emailSent,
        accessEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, emailSent };
  },
);

// 설문 오퍼 이메일 재발송 쿨다운(일). 같은 사람에게 반복 발송 방지.
const FOUNDER_SURVEY_OFFER_COOLDOWN_DAYS = 14;

// ─── 설문 회신 오퍼 이메일: audience 산출 + dry-run 발송 (관리자용) ────
//
// ★1차 채널=이메일(사장님 채널 피벗). 이 콜러블은 "설문 회신 시 기존 베타 1개월
// 포함 총 3개월까지 연장" 리마인더를 보낼 대상을 산출하고, 기본 dry-run 으로 미리보기만 한다.
//
// 대상 세그먼트(중복 발송 방지):
//   audience   = 선정(accessGrantedAt) · 미반려 · 계정연결(proSubscriptionUid) ·
//                설문 미회신(feedbackSubmittedAt 없음)  → 이 캠페인이 보낼 대상
//   noAccount  = 선정 · 미회신 · 계정 미연결  → 미활성 팔로업(WjGoowu…) 담당,
//                여기선 제외해 audience 가 겹치지 않게 한다
//   submitted  = 이미 설문 회신  → 대상 아님
//
// ★실발송은 confirmSend===true AND env FOUNDER_SURVEY_EMAIL_SEND_ENABLED==="true"
// 이중 게이트를 모두 통과할 때만. 사장님 승인 전까지 env 를 켜지 않는다.
// 보고는 집계 + 마스킹 샘플만(PII 원문 대량 노출 금지).
//
// ★쿨다운(중복 발송 방지): 최근 FOUNDER_SURVEY_OFFER_COOLDOWN_DAYS 안에
//   surveyOfferEmailSentAt 이 찍힌 대상은 audience 에서 제외(cooledDown 로 집계).
//   재발송이 필요하면 data.ignoreCooldown===true 로만 해제(승인 후 의도적 재캠페인).
//   sendFounderFollowupEmails 의 쿨다운과 동일한 안전장치.
export const previewFounderSurveyOffer = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const limit =
      typeof data?.limit === "number" && Number.isInteger(data.limit)
        ? Math.min(Math.max(data.limit, 1), 2000)
        : 1000;
    const confirmSend = data?.confirmSend === true;
    const sendEnabled =
      process.env.FOUNDER_SURVEY_EMAIL_SEND_ENABLED === "true";
    const willSend = confirmSend && sendEnabled;
    const ignoreCooldown = data?.ignoreCooldown === true;
    const now = Date.now();
    const cooldownMs = FOUNDER_SURVEY_OFFER_COOLDOWN_DAYS * 86400000;

    const snap = await db.collection(FOUNDERS_COLLECTION).limit(limit).get();

    const audience: { email: string; locale: string }[] = [];
    let scanned = 0;
    let selectedNotRejected = 0;
    let alreadySubmitted = 0;
    let noAccountNotSubmitted = 0;
    let cooledDown = 0;

    for (const doc of snap.docs) {
      scanned += 1;
      const v = doc.data() as Record<string, unknown>;
      const email = typeof v.email === "string" ? v.email : doc.id;
      const rejected = v.status === "rejected";
      const selected = !!v.accessGrantedAt && !rejected;
      if (!selected) continue;
      selectedNotRejected += 1;

      const submitted = !!v.feedbackSubmittedAt;
      if (submitted) {
        alreadySubmitted += 1;
        continue;
      }
      // 미회신. 계정 연결 여부로 세그먼트 분기.
      const hasAccount =
        typeof v.proSubscriptionUid === "string" && !!v.proSubscriptionUid;
      if (!hasAccount) {
        noAccountNotSubmitted += 1;
        continue;
      }
      // 쿨다운: 최근 발송자는 제외(ignoreCooldown 으로만 해제).
      const lastSent = timestampToDate(v.surveyOfferEmailSentAt);
      if (
        !ignoreCooldown &&
        lastSent &&
        now - lastSent.getTime() < cooldownMs
      ) {
        cooledDown += 1;
        continue;
      }
      const locale =
        typeof v.locale === "string" ? normalizeFounderLocale(v.locale) : "ko";
      audience.push({ email: normalizeEmail(email), locale });
    }

    // 발송(이중 게이트 통과 시에만).
    let sent = 0;
    let failed = 0;
    let skippedNoConsent = 0;
    if (willSend) {
      for (const target of audience) {
        // 동의 게이트: marketing_contacts 에서 emailable 아니면 발송 제외.
        const gate = await marketingEmailGate(target.email);
        if (!gate.ok) {
          skippedNoConsent++;
          continue;
        }
        const ok = await sendFounderSurveyOfferEmail(
          target.email,
          target.locale,
        );
        if (ok) {
          sent += 1;
          await db.collection(FOUNDERS_COLLECTION).doc(target.email).set(
            {
              surveyOfferEmailSent: true,
              surveyOfferEmailSentAt:
                admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } else {
          failed += 1;
        }
      }
    }

    const localeBreakdown = audience.reduce<Record<string, number>>(
      (acc, a) => {
        acc[a.locale] = (acc[a.locale] ?? 0) + 1;
        return acc;
      },
      {},
    );
    // 도메인 집계(개수만 — PII 원문 아님). 발송 규모/스팸필터 사전 점검용.
    const domainBreakdown = audience.reduce<Record<string, number>>(
      (acc, a) => {
        const at = a.email.lastIndexOf("@");
        const domain = at >= 0 ? a.email.slice(at + 1) : "(invalid)";
        acc[domain] = (acc[domain] ?? 0) + 1;
        return acc;
      },
      {},
    );

    return {
      ok: true,
      dryRun: !willSend,
      sendGate: { confirmSend, sendEnabled },
      cooldownDays: FOUNDER_SURVEY_OFFER_COOLDOWN_DAYS,
      ignoreCooldown,
      counts: {
        scanned,
        selectedNotRejected,
        alreadySubmitted,
        audience: audience.length,
        noAccountNotSubmitted,
        cooledDown,
      },
      localeBreakdown,
      domainBreakdown,
      // PII 보호: 마스킹된 표본만 노출(최대 10건).
      sampleMasked: audience.slice(0, 10).map((a) => maskEmailForLog(a.email)),
      sent,
      failed,
      skippedNoConsent,
    };
  },
);

// ═══════════════════════════════════════════════════════════════════
// 파운더 선정자 활성화 리포트 + 미활성자 팔로업 (티켓 WjGoowu1rjLH4K2PNIXb)
// ═══════════════════════════════════════════════════════════════════
//
// 배경: 2차까지 ~35명 선정(founders, accessGrantedAt 존재)인데 활성 구독은
// 11명뿐. "나머지는 다운로드를 안 받은 건가?"를 데이터로 규명한다.
//
// 조인 모델(식별 가능한 신호만):
//   · 선정 = founders/{email}, status!=="rejected" && accessGrantedAt 존재.
//   · 계정존재(=로그인 이력 있음) = admin.auth().getUserByEmail 성공.
//     (waitlist 신청은 Firestore 직접쓰기라 Auth 계정을 만들지 않는다 — 계정
//      존재는 실제 로그인이 1회 이상 발생했다는 뜻.)
//   · 활성 구독 = subscriptions/{uid}, status==="active" && 기간 미만료.
//   ★한계: 앱 다운로드-only(로그인 안 함) 흔적은 logHeartbeat 익명 clientId(BQ)라
//    email/uid 로 조인 불가. 그래서 "미다운로드"와 "다운로드했으나 미로그인"은
//    식별 데이터로 분해할 수 없어 둘 다 no_account(계정 없음)로 합산 보고한다.
//
// 세그먼트(FounderSegment):
//   active         — 계정 O + 활성 구독 O            → 팔로업 불필요
//   sub_expired    — 계정 O + 구독 doc 존재하나 만료/취소 → 재활성 팔로업(계정 O)
//   account_no_sub — 계정 O + 구독 doc 자체가 없음(grant 미부여) → 재활성 팔로업(계정 O)
//   no_account     — 계정 X (미가입=미다운로드/미로그인)          → 다운로드 팔로업

type FounderSegment =
  | "active"
  | "sub_expired"
  | "account_no_sub"
  | "no_account";

// 순수 분류기(테스트용 export). 부수효과 없음.
export function classifyFounderActivation(opts: {
  hasAccount: boolean;
  subExists: boolean;
  subStatus: string | null;
  subPeriodEndMs: number | null;
  nowMs: number;
}): FounderSegment {
  const { hasAccount, subExists, subStatus, subPeriodEndMs, nowMs } = opts;
  const activeSub =
    subExists &&
    subStatus === "active" &&
    (subPeriodEndMs == null || subPeriodEndMs > nowMs);
  if (activeSub) return "active";
  if (!hasAccount) return "no_account";
  if (subExists) return "sub_expired";
  return "account_no_sub";
}

// 팔로업 메일 세그먼트(2종) — 계정 유무로 갈린다.
//   download  — ④ 계정없음(미가입): 다운로드+온보딩 유도. ★실제 발송 대상.
//   activated — ③ 계정O·구독미부여였던 유저용 "Pro 활성화" 안내(선택).
// ★grant 백필(별도 티켓 bi1zzeidtqm6sxzgguyP, PR#468) 라이브 실행 완료 →
//  ③은 전원 active founder_grant 구독으로 materialize 됨(2026-07-17 실측 ③=0).
//  따라서 activated 세그먼트는 현재 사실상 비어 있고, 발송 대상은 ④뿐이다.
// ★사장님 결정: download 메일은 ④에게만. ③에겐 절대 다운로드 메일 금지.
type FollowupSegment = "download" | "activated";
function toFollowupSegment(seg: FounderSegment): FollowupSegment | null {
  if (seg === "no_account") return "download";
  if (seg === "sub_expired" || seg === "account_no_sub") return "activated";
  return null; // active → 팔로업 대상 아님
}

// 미활성 선정자 1인의 내부 분류 레코드(이메일 포함 — 로그/응답에 원문 노출 금지).
interface FounderActivationRecord {
  email: string;
  segment: FounderSegment;
}

// founders + Auth + subscriptions 를 교차해 선정자 전원을 분류한다(내부 전용).
// 저빈도 어드민 액션이라 per-email Auth lookup(35건 규모)로 충분하다.
async function computeFounderActivation(): Promise<FounderActivationRecord[]> {
  const snap = await db.collection(FOUNDERS_COLLECTION).limit(10000).get();
  const nowMs = Date.now();
  const out: FounderActivationRecord[] = [];
  for (const doc of snap.docs) {
    const v = doc.data() as Record<string, unknown>;
    // 선정 기준 = getMyFounderAccess/grantBetaProOnSignup 과 동일.
    if (v.status === "rejected" || v.accessGrantedAt == null) continue;
    const email = normalizeEmail(
      typeof v.email === "string" ? v.email : doc.id,
    );
    const uid = await lookupUidByEmail(email);
    let subExists = false;
    let subStatus: string | null = null;
    let subPeriodEndMs: number | null = null;
    if (uid) {
      const sub = await db.collection("subscriptions").doc(uid).get();
      if (sub.exists) {
        subExists = true;
        const sv = sub.data() as Record<string, unknown>;
        subStatus = typeof sv.status === "string" ? sv.status : null;
        subPeriodEndMs = tsToMillis(sv.currentPeriodEnd);
      }
    }
    out.push({
      email,
      segment: classifyFounderActivation({
        hasAccount: !!uid,
        subExists,
        subStatus,
        subPeriodEndMs,
        nowMs,
      }),
    });
  }
  return out;
}

// 이메일 도메인 분포(집계) — 개인식별 방지: count<2 도메인은 (other)로 묶는다.
function domainDistribution(emails: string[]): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const e of emails) {
    const dom = e.includes("@") ? e.split("@").pop() || "(none)" : "(none)";
    raw[dom] = (raw[dom] || 0) + 1;
  }
  const out: Record<string, number> = {};
  let other = 0;
  for (const [dom, n] of Object.entries(raw)) {
    if (n < 2) other += n;
    else out[dom] = n;
  }
  if (other > 0) out["(other)"] = other;
  return out;
}

/**
 * getFounderActivationReport — 선정자 활성화 현황(어드민, 읽기전용).
 *
 * PII 미노출: 이메일 원문은 절대 반환하지 않고 카운트/세그먼트/도메인집계만 낸다.
 * "35 선정 vs 11 활성"의 실제 내역을 라이브로 재현 가능한 리포트.
 */
export const getFounderActivationReport = functions.https.onCall(
  async (_data, context) => {
    requireAdmin(context);
    const records = await computeFounderActivation();
    const bySegment: Record<FounderSegment, number> = {
      active: 0,
      sub_expired: 0,
      account_no_sub: 0,
      no_account: 0,
    };
    for (const r of records) bySegment[r.segment]++;
    const inactive = records.filter((r) => r.segment !== "active");
    return {
      generatedAt: new Date().toISOString(),
      totalSelected: records.length,
      active: bySegment.active,
      inactive: inactive.length,
      bySegment,
      followupTargets: {
        // ④ 계정 X(다운로드/온보딩 유도) — ★실제 발송 대상.
        download: bySegment.no_account,
        // ③ 계정 O·구독 미부여 — grant 백필로 대체(별도 티켓). 안내 메일은 opt-in.
        activated: bySegment.sub_expired + bySegment.account_no_sub,
      },
      inactiveDomainDistribution: domainDistribution(
        inactive.map((r) => r.email),
      ),
    };
  },
);

// ─── 미활성 선정자 팔로업 메일 (Resend) ──────────────────────────────
//
// 세그먼트별 본문:
//   download  — ④ 선정됐지만 아직 시작 전(계정 없음): 다운로드+로그인 유도.
//   activated — ③ 로그인은 했으나 Pro 미부여였던 유저. grant 백필(별도 티켓)이
//               Pro 를 이미 부여했으므로 "다운로드 유도"가 아니라 "Pro 활성화됐어요,
//               앱을 열어 바로 쓰세요" 안내. downloadUrl 은 앱 열기용(재설치 아님).
// sendFounderAccessEmail 과 동일 정책: 반드시 non-throwing, RESEND_API_KEY
// 미설정 시 스킵(false).

// export 는 테스트/초안 dry 렌더용(buildFounderAccessEmail 과 동일 — 트리거가
// 아니라 배포 discovery 가 건너뛴다).
export function buildFounderFollowupEmail(
  locale: FounderLocale,
  segment: FollowupSegment,
): FounderEmailContent {
  const downloadUrl = `${SITE_BASE}/${locale}/download`;
  const support = FOUNDER_SUPPORT_EMAIL;

  if (segment === "download") {
    if (locale === "en") {
      return {
        subject:
          "Your Marblo Founder seat is still open — let's get you started",
        html: founderHtmlShell(`
          <h1 style="font-size:22px;margin:0 0 16px">Your Founder seat is waiting 🚀</h1>
          <p>You were selected as a Marblo Founder, but it looks like you haven't started yet. Your access is still open — nothing has expired.</p>
          <p><strong>Two steps to activate:</strong></p>
          <p>1. Download Marblo: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a><br/>
          2. Sign in with this email — your Founder Pro switches on automatically on first sign-in.</p>
          <p>Founders shape Marblo from day one. We'd love to see you on the inside soon.</p>
          <p style="color:#666">Any trouble or questions? Just reply to this email, or reach us at ${support}.</p>
        `),
        text: [
          "Your Founder seat is still open 🚀",
          "",
          "Hi! You were selected as a Marblo Founder but haven't started yet.",
          "Your access is still open — nothing has expired.",
          "",
          "Two steps to get started:",
          `1. Download Marblo: ${downloadUrl}`,
          "2. Sign in with this email — Founder Pro switches on automatically on first sign-in.",
          "",
          "Founders shape Marblo from day one. We'd love to see you on the inside soon.",
          "",
          `Any trouble or questions? Reply to this email, or reach us at ${support}.`,
        ].join("\n"),
      };
    }
    if (locale === "ja") {
      return {
        subject: "Marblo ファウンダーの席はまだ空いています — はじめましょう",
        html: founderHtmlShell(`
          <h1 style="font-size:22px;margin:0 0 16px">ファウンダーの席をご用意しています 🚀</h1>
          <p>あなたは Marblo ファウンダーに選ばれましたが、まだ開始されていないようです。アクセスは有効なまま、何も期限切れになっていません。</p>
          <p><strong>2ステップで有効化:</strong></p>
          <p>1. Marblo をダウンロード: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a><br/>
          2. このメールアドレスでサインイン — 初回サインインでファウンダー Pro が自動的に有効になります。</p>
          <p>ファウンダーは初日から Marblo を形づくる存在です。中でお会いできるのを楽しみにしています。</p>
          <p style="color:#666">うまくいかない場合やご不明な点があれば、このメールにご返信いただくか ${support} までご連絡ください。</p>
        `),
        text: [
          "ファウンダーの席はまだ空いています 🚀",
          "",
          "こんにちは！あなたは Marblo ファウンダーに選ばれましたが、まだ開始されていないようです。",
          "アクセスは有効なまま、何も期限切れになっていません。",
          "",
          "2ステップではじめられます:",
          `1. Marblo をダウンロード: ${downloadUrl}`,
          "2. このメールでサインイン — 初回サインインでファウンダー Pro が自動的に有効になります。",
          "",
          "ファウンダーは初日から Marblo を形づくる存在です。中でお会いできるのを楽しみにしています。",
          "",
          `お困りの際やご不明な点があれば、このメールに返信するか ${support} まで。`,
        ].join("\n"),
      };
    }
    return {
      subject: "🚀 마블로 파운더 자리가 아직 기다리고 있어요",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">파운더 자리가 그대로 열려 있어요 🚀</h1>
        <p>안녕하세요! 마블로 파운더로 선정되셨는데 아직 시작 전이신 것 같아요. 파운더 접근 권한은 그대로 열려 있고, 아무것도 만료되지 않았어요.</p>
        <p><strong>두 단계면 바로 시작할 수 있어요:</strong></p>
        <p>1. 마블로 다운로드: <a href="${downloadUrl}" style="color:#4f46e5">${downloadUrl}</a><br/>
        2. 이 이메일 주소로 로그인 — 첫 로그인과 동시에 파운더 Pro가 자동으로 켜집니다.</p>
        <p>파운더는 마블로를 처음부터 함께 만들어가는 분들이에요. 안에서 곧 뵙기를 기대할게요.</p>
        <p style="color:#666">잘 안 되거나 궁금한 점이 있으면 이 메일에 그대로 답장하시거나 ${support} 로 알려주세요.</p>
      `),
      text: [
        "파운더 자리가 그대로 열려 있어요 🚀",
        "",
        "안녕하세요! 마블로 파운더로 선정되셨는데 아직 시작 전이신 것 같아요.",
        "파운더 접근 권한은 그대로 열려 있고, 아무것도 만료되지 않았어요.",
        "",
        "두 단계면 바로 시작할 수 있어요:",
        `1. 마블로 다운로드: ${downloadUrl}`,
        "2. 이 이메일 주소로 로그인 — 첫 로그인과 동시에 파운더 Pro가 자동으로 켜집니다.",
        "",
        "파운더는 마블로를 처음부터 함께 만들어가는 분들이에요. 안에서 곧 뵙기를 기대할게요.",
        "",
        `잘 안 되거나 궁금한 점이 있으면 이 메일에 그대로 답장하시거나 ${support} 로 알려주세요.`,
      ].join("\n"),
    };
  }

  // segment === "activated" — grant 백필로 Pro 가 이미 부여된 유저 안내.
  if (locale === "en") {
    return {
      subject: "🎉 Your Marblo Founder Pro is now active",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">Your Founder Pro is now active 🎉</h1>
        <p>Good news — we've activated your Marblo Founder Pro plan. It's live on your account now, so there's nothing you need to do.</p>
        <p><a href="${downloadUrl}" style="color:#4f46e5">Open Marblo</a> and your Pro features are ready to go.</p>
        <p style="color:#666">If Pro doesn't show up, just reply to this email or reach ${support} — we'll sort it out right away.</p>
      `),
      text: [
        "Your Founder Pro is now active.",
        "",
        "Good news — we've activated your Marblo Founder Pro plan. It's live on your account now, nothing to do.",
        "",
        `Open Marblo and your Pro features are ready: ${downloadUrl}`,
        "",
        `If Pro doesn't show up, reply here or reach ${support}.`,
      ].join("\n"),
    };
  }
  if (locale === "ja") {
    return {
      subject: "🎉 Marblo ファウンダー Pro が有効になりました",
      html: founderHtmlShell(`
        <h1 style="font-size:22px;margin:0 0 16px">ファウンダー Pro が有効になりました 🎉</h1>
        <p>朗報です — あなたの Marblo ファウンダー Pro プランを有効化しました。すでにアカウントに反映されているので、追加の操作は必要ありません。</p>
        <p><a href="${downloadUrl}" style="color:#4f46e5">Marblo を開く</a>と、Pro 機能がすぐにお使いいただけます。</p>
        <p style="color:#666">Pro が表示されない場合は、このメールにご返信いただくか ${support} までご連絡ください。すぐに対応します。</p>
      `),
      text: [
        "ファウンダー Pro が有効になりました。",
        "",
        "朗報です — あなたの Marblo ファウンダー Pro プランを有効化しました。すでに反映済みで、追加の操作は不要です。",
        "",
        `Marblo を開くと Pro 機能がすぐ使えます: ${downloadUrl}`,
        "",
        `表示されない場合は、このメールに返信するか ${support} まで。`,
      ].join("\n"),
    };
  }
  return {
    subject: "🎉 마블로 파운더 Pro가 활성화됐어요",
    html: founderHtmlShell(`
      <h1 style="font-size:22px;margin:0 0 16px">파운더 Pro가 활성화됐어요 🎉</h1>
      <p>좋은 소식이에요 — 마블로 파운더 Pro 플랜을 활성화해 드렸어요. 이미 계정에 반영돼 있으니 따로 하실 일은 없습니다.</p>
      <p><a href="${downloadUrl}" style="color:#4f46e5">마블로를 열면</a> Pro 기능을 바로 쓰실 수 있어요.</p>
      <p style="color:#666">혹시 Pro가 안 보이면 이 메일에 회신하시거나 ${support} 로 알려주세요. 바로 처리해 드릴게요.</p>
    `),
    text: [
      "파운더 Pro가 활성화됐어요.",
      "",
      "좋은 소식이에요 — 마블로 파운더 Pro 플랜을 활성화해 드렸어요. 이미 계정에 반영돼 있어 따로 하실 일은 없습니다.",
      "",
      `마블로를 열면 Pro 기능을 바로 쓸 수 있어요: ${downloadUrl}`,
      "",
      `혹시 Pro가 안 보이면 ${support} 로 알려주세요.`,
    ].join("\n"),
  };
}

/** 팔로업 메일 발송. 반드시 non-throwing(sendFounderAccessEmail 과 동일 정책). */
async function sendFounderFollowupEmail(
  email: string,
  locale: string,
  segment: FollowupSegment,
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn(
        "[founder-followup] RESEND_API_KEY 미설정 — 발송 스킵:",
        segment,
      );
      return false;
    }
    const content = buildFounderFollowupEmail(
      normalizeFounderLocale(locale),
      segment,
    );
    // 마케팅 메일 — one-click unsubscribe 헤더+푸터(CAN-SPAM/RFC 8058).
    const delivery = marketingEmailDelivery(email);
    return await postResendEmail(
      email,
      delivery ? withUnsubscribeFooter(content, delivery) : content,
      "founder-followup",
      delivery?.headers,
    );
  } catch (err) {
    console.warn("[founder-followup] 발송 실패:", segment, err);
    return false;
  }
}

// 팔로업 재발송 쿨다운(일). 같은 사람에게 반복 발송 방지.
const FOUNDER_FOLLOWUP_COOLDOWN_DAYS = 7;
// 실발송을 켜려면 반드시 이 확인 문자열을 명시(오발송 방지 2차 게이트).
const FOUNDER_FOLLOWUP_CONFIRM = "SEND-FOLLOWUP";

/**
 * sendFounderFollowupEmails — 미활성 선정자 배치 팔로업(어드민).
 *
 * ★기본 dryRun=true — 발송하지 않고 대상 카운트/세그먼트/도메인집계만 반환한다.
 * ★실발송은 dryRun===false 이고 confirm==="SEND-FOLLOWUP" 일 때만. 승인 전까지
 *  절대 켜지지 않는다. PII(이메일 원문)는 어떤 경우에도 반환하지 않는다.
 *
 * ★사장님 결정(2026-07-17): 실제 발송 대상은 ④ 계정없음(download)뿐. ③ 계정O·
 *  구독미부여는 별도 티켓(bi1zzeidtqm6sxzgguyP) grant 백필로 Pro 가 자동 부여되므로
 *  다운로드 메일에서 제외한다. 그래서 segment 기본값은 "download"(④만) — ③에게
 *  "Pro 활성화" 안내를 보내려면 segment:"activated" 를 명시적으로 opt-in 해야 한다.
 *
 * params: {
 *   dryRun?: boolean=true,
 *   segment?: "download"|"activated"|"all"="download",  // 기본 ④만
 *   cooldownDays?: number=7,
 *   confirm?: string,   // 실발송 시 "SEND-FOLLOWUP" 필수
 *   limit?: number,     // 배치 상한(안전장치)
 * }
 */
export const sendFounderFollowupEmails = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const dryRun = data?.dryRun !== false; // 기본 true
    // 기본 세그먼트 = "download"(④ 계정없음)만. ③(activated)은 명시 opt-in.
    const segmentFilter =
      data?.segment === "activated" || data?.segment === "all"
        ? (data.segment as "activated" | "all")
        : "download";
    const cooldownDays =
      typeof data?.cooldownDays === "number" && data.cooldownDays >= 0
        ? data.cooldownDays
        : FOUNDER_FOLLOWUP_COOLDOWN_DAYS;
    const limit =
      typeof data?.limit === "number" && data.limit > 0
        ? Math.floor(data.limit)
        : Infinity;

    // 대상 산출: 미활성 선정자 → 팔로업 세그먼트 매핑.
    const records = await computeFounderActivation();
    const nowMs = Date.now();
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;

    const eligible: Array<{ email: string; fseg: FollowupSegment }> = [];
    let skippedCooldown = 0;
    let skippedNoConsent = 0;
    for (const r of records) {
      const fseg = toFollowupSegment(r.segment);
      if (!fseg) continue; // active
      if (segmentFilter !== "all" && fseg !== segmentFilter) continue;
      // 쿨다운: founders/{email}.founderFollowupSentAt 최근 발송 제외.
      const doc = await db.collection(FOUNDERS_COLLECTION).doc(r.email).get();
      const lastMs = tsToMillis(doc.data()?.founderFollowupSentAt);
      if (lastMs != null && nowMs - lastMs < cooldownMs) {
        skippedCooldown++;
        continue;
      }
      // 동의 게이트: marketing_contacts 에서 emailable 아니면 제외
      // (컨택트 없음/동의 없음/수신거부 전부 발송 불가 — consent-based).
      const gate = await marketingEmailGate(r.email);
      if (!gate.ok) {
        skippedNoConsent++;
        continue;
      }
      eligible.push({ email: r.email, fseg });
    }

    const countBy = (fs: FollowupSegment) =>
      eligible.filter((e) => e.fseg === fs).length;
    const preview = {
      dryRun,
      totalSelected: records.length,
      eligibleTotal: eligible.length,
      segmentFilter,
      eligibleBySegment: {
        download: countBy("download"),
        activated: countBy("activated"),
      },
      skippedCooldown,
      skippedNoConsent,
      cooldownDays,
      domainDistribution: domainDistribution(eligible.map((e) => e.email)),
    };

    if (dryRun) {
      return { ...preview, sent: 0, note: "dry-run: 발송하지 않음" };
    }

    // ── 실발송 경로 — 2차 게이트 ──────────────────────────────────────
    if (data?.confirm !== FOUNDER_FOLLOWUP_CONFIRM) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `실발송하려면 confirm="${FOUNDER_FOLLOWUP_CONFIRM}" 필요(오발송 방지). ` +
          "그 전에 dryRun 으로 대상을 확인하고 사장님 승인을 받으세요.",
      );
    }

    let sent = 0;
    let failed = 0;
    const sentBySegment: Record<FollowupSegment, number> = {
      download: 0,
      activated: 0,
    };
    for (const { email, fseg } of eligible) {
      if (sent + failed >= limit) break;
      const locale = await lookupFounderLocale(email);
      const ok = await sendFounderFollowupEmail(email, locale, fseg);
      if (ok) {
        sent++;
        sentBySegment[fseg]++;
        await db.collection(FOUNDERS_COLLECTION).doc(email).set(
          {
            founderFollowupSent: true,
            founderFollowupSegment: fseg,
            founderFollowupSentAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        failed++;
      }
    }
    return { ...preview, sent, failed, sentBySegment };
  },
);

// ─── 신청 즉시 접근 부여 자동화 (Resend) ──────────────────────────────
//
// /founders 신청 시 클라가 betatester50_waitlist 에 직접 doc 을 쓴다.
// 수동 markFounderSelected 대기 없이 생성 즉시 기존 선정 내부 로직을 재사용한다.
// 스팸/테스트/오타 도메인은 먼저 suppressed 처리해 접근 부여와 메일을 막는다.

async function sendFounderCohortCapAlert(count: number): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn(
        "[founder-auto-select] RESEND_API_KEY 미설정 — cap 알림 발송 스킵",
      );
      return false;
    }
    const cap = Number.isFinite(AUTO_FOUNDER_COHORT_CAP)
      ? AUTO_FOUNDER_COHORT_CAP
      : 100;
    return await postResendEmail(
      FOUNDER_SUPPORT_EMAIL,
      {
        subject: `[Marblo] Founder cohort cap exceeded (${count}/${cap})`,
        html: founderHtmlShell(`
          <h1 style="font-size:20px;margin:0 0 16px">Founder cohort cap exceeded</h1>
          <p>자동 접근 부여된 founder 수가 설정 cap 을 초과했습니다.</p>
          <p><strong>Selected founders:</strong> ${count}<br/><strong>Cap:</strong> ${cap}</p>
          <p>필요하면 NEXT_PUBLIC_FOUNDATION50_OPEN=false 로 신청 노출을 끄거나 AUTO_FOUNDER_COHORT_CAP 을 조정하세요.</p>
        `),
        text: [
          "Founder cohort cap exceeded",
          "",
          `Selected founders: ${count}`,
          `Cap: ${cap}`,
          "",
          "If needed, turn off signup exposure with NEXT_PUBLIC_FOUNDATION50_OPEN=false or adjust AUTO_FOUNDER_COHORT_CAP.",
        ].join("\n"),
      },
      "founder-auto-select",
    );
  } catch (err) {
    console.warn("[founder-auto-select] cap 알림 발송 실패:", err);
    return false;
  }
}

async function alertFounderCohortCapIfNeeded(): Promise<void> {
  const cap = Number.isFinite(AUTO_FOUNDER_COHORT_CAP)
    ? AUTO_FOUNDER_COHORT_CAP
    : 100;
  if (cap <= 0) return;

  const countSnap = await db
    .collection(FOUNDERS_COLLECTION)
    .where("status", "==", "selected")
    .count()
    .get();
  const count = countSnap.data().count;
  if (count <= cap) return;

  const alertRef = db
    .collection("system_alerts")
    .doc(`founder_auto_cap_${cap}`);
  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(alertRef);
    if (existing.exists) {
      tx.set(
        alertRef,
        {
          lastCount: count,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return false;
    }
    tx.set(alertRef, {
      kind: "founder_auto_cap_exceeded",
      cap,
      firstCount: count,
      lastCount: count,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (created) {
    const sent = await sendFounderCohortCapAlert(count);
    await alertRef.set(
      {
        emailSent: sent,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

// 신청 자동 접근 부여 트리거 — waitlist doc 생성 시 1회 처리.
// betatester50_waitlist 는 클라가 직접 쓰므로 콜러블이 아닌 onCreate 가 정석.
// 트리거 재시도 폭주를 막기 위해 절대 throw 하지 않는다(에러는 삼키고 종료).
export const sendApplyConfirmOnWaitlist = functions.firestore
  .document("betatester50_waitlist/{docId}")
  .onCreate(async (snap) => {
    try {
      const data = snap.data() || {};
      const rawEmail = typeof data.email === "string" ? data.email : "";
      const classified = classifyWaitlistEmail(rawEmail);
      if (!classified.ok) {
        await snap.ref.set(
          {
            status: "suppressed",
            suppressedReason: classified.reason,
            suppressedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        console.warn(
          "[founder-auto-select] waitlist suppressed:",
          snap.id,
          classified.reason,
        );
        return;
      }
      if (data.agreed !== true) {
        await snap.ref.set(
          {
            status: "suppressed",
            suppressedReason: "missing_required_consent",
            suppressedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        console.warn(
          "[founder-auto-select] agreed=false — 자동 접근 부여 스킵:",
          snap.id,
        );
        return;
      }

      const founderSnap = await db
        .collection(FOUNDERS_COLLECTION)
        .doc(classified.email)
        .get();
      const founder = founderSnap.exists ? founderSnap.data() || {} : {};
      if (
        founder.status === "selected" &&
        founder.accessGrantedAt &&
        (founder.accessEmailSent === true || founder.accessEmailSentAt)
      ) {
        await snap.ref.set(
          {
            status: "duplicate_selected",
            duplicateSelectedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        console.warn(
          "[founder-auto-select] duplicate selected email — access email resend skipped:",
          snap.id,
        );
        await alertFounderCohortCapIfNeeded().catch((err) =>
          console.warn("[founder-auto-select] cap 확인 실패:", snap.id, err),
        );
        return;
      }

      const result = await markFounderSelectedInternal(classified.email, false);
      await snap.ref.set(
        {
          status: "auto_selected",
          autoSelectedAt: admin.firestore.FieldValue.serverTimestamp(),
          autoAccessEmailSent: result.emailSent,
          autoBetaExpiresAt: result.betaExpiresAt,
          autoSubscriptionGranted: result.subscriptionGranted,
          autoSubscriptionSkippedReason: result.subscriptionSkippedReason,
        },
        { merge: true },
      );
      await alertFounderCohortCapIfNeeded().catch((err) =>
        console.warn("[founder-auto-select] cap 확인 실패:", snap.id, err),
      );
    } catch (err) {
      // 트리거 재시도 폭주 방지 — 모든 에러를 삼킨다.
      console.warn("[founder-auto-select] 트리거 처리 실패:", snap.id, err);
    }
  });

// ═══════════════════════════════════════════════════════════════════
// Project-count plan enforcement (서버측 방어)
// ═══════════════════════════════════════════════════════════════════
// 클라이언트 게이팅(projectStore.createProject / FileTree)을 직접 Firestore
// write 로 우회하는 것을 서버에서 되돌린다. Free 플랜 소유자가 한도(1개)를 넘겨
// 프로젝트를 만들면 초과분(가장 최근 것)을 삭제한다. 유료 플랜은 무제한이라
// 손대지 않는다. 트리거 재시도 폭주 방지를 위해 절대 throw 하지 않는다.
//
// 값은 src/lib/planLimits.ts(PLAN_LIMITS.maxProjects)와 정합을 맞춘다.
// (functions 는 렌더러 src 를 import 하지 않으므로 여기서 상수를 재선언한다 —
//  drift 시 두 곳을 함께 갱신할 것.)
const PROJECT_LIMIT_BY_PLAN: Record<string, number> = {
  free: 1,
  // pro / team / team_plus / enterprise = 무제한 (미정의 → 아래에서 skip)
};

function millisOf(v: unknown): number {
  // Firestore Timestamp | Date | number 를 모두 ms 로. 값 없으면 0(=가장 오래된
  // 것으로 취급 → 정당한 첫 프로젝트를 우선 보존).
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const ts = v as { toMillis?: () => number; seconds?: number };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

export const enforceProjectLimit = functions.firestore
  .document("projects/{projectId}")
  .onCreate(async (snap) => {
    try {
      const data = snap.data() || {};
      const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
      if (!ownerId) return;

      // 소유자 플랜 조회. 판정은 entitlement.ts 단일 규칙에 위임한다 — 렌더러
      // getPlan() 과 **같은 규칙**이어야 하고(그 일치는 v3 유닛테스트가 강제),
      // status 단독으로 보면 해지한 사용자의 잔여 결제 기간 중에 이 트리거가
      // 프로젝트를 삭제해 버린다.
      const subSnap = await db.collection("subscriptions").doc(ownerId).get();
      const sub = subSnap.exists ? subSnap.data() || {} : {};
      const plan = resolveEntitledPlan(
        {
          status: typeof sub.status === "string" ? sub.status : null,
          planType: typeof sub.planType === "string" ? sub.planType : null,
          currentPeriodEndMs: tsToMillis(sub.currentPeriodEnd),
        },
        Date.now(),
      );

      const limit = PROJECT_LIMIT_BY_PLAN[plan];
      if (limit === undefined) return; // 무제한 플랜 → 방어 불필요

      // 이 소유자의 모든 프로젝트를 createdAt 오름차순으로 정렬해, 앞의 `limit`
      // 개만 유효로 본다. 방금 생성된 이 문서가 초과분이면 삭제한다. (오래된 것을
      // 보존하므로 동시 생성/우회 시도에도 정당한 프로젝트가 살아남는다.)
      const owned = await db
        .collection("projects")
        .where("ownerId", "==", ownerId)
        .get();
      if (owned.size <= limit) return; // 한도 이내

      const sorted = owned.docs.slice().sort((a, b) => {
        const am = millisOf(a.get("createdAt"));
        const bm = millisOf(b.get("createdAt"));
        if (am !== bm) return am - bm;
        // createdAt 동률이면 문서 id 로 안정 정렬.
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      const allowedIds = new Set(sorted.slice(0, limit).map((d) => d.id));
      if (allowedIds.has(snap.id)) return; // 이 문서는 유효 범위 내

      await snap.ref.delete();
      console.warn(
        `[enforceProjectLimit] ${plan} 한도(${limit}) 초과 프로젝트 삭제: ` +
          `owner=${ownerId} project=${snap.id} (owned=${owned.size})`,
      );
    } catch (err) {
      // 트리거 재시도 폭주 방지 — 모든 에러를 삼킨다.
      console.warn("[enforceProjectLimit] 처리 실패:", snap.id, err);
    }
  });

function parseFounderSurveyAnswers(raw: unknown): FounderSurveyAnswers {
  if (!raw || typeof raw !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "설문 답변이 필요합니다.",
    );
  }
  const answers = raw as Record<string, unknown>;
  const str = (v: unknown): string =>
    typeof v === "string" ? v.trim().slice(0, FOUNDER_FIELD_MAX) : "";
  const parsed: FounderSurveyAnswers = {
    q1: str(answers.q1),
    q2: str(answers.q2),
    q3: str(answers.q3),
    q4: str(answers.q4),
    q5: str(answers.q5),
    q6: str(answers.q6),
    q7: str(answers.q7),
  };
  const missing = Object.entries(parsed)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `필수 7문항을 모두 입력해 주세요. 누락: ${missing.join(", ")}`,
    );
  }
  return parsed;
}

function parseFounderRubricScore(raw: unknown): FounderRubricScore {
  if (!raw || typeof raw !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "rubricScore is required",
    );
  }
  const input = raw as Record<string, unknown>;
  const dimension = (key: keyof Omit<FounderRubricScore, "total">): number => {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 3
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `${key} must be an integer from 0 to 3`,
      );
    }
    return value;
  };
  const specificity = dimension("specificity");
  const usageEvidence = dimension("usageEvidence");
  const insightQuality = dimension("insightQuality");
  const actionability = dimension("actionability");
  const icpFit = dimension("icpFit");
  const total =
    specificity * 2 +
    usageEvidence * 2 +
    insightQuality +
    actionability +
    icpFit;

  const suppliedTotal = input.total;
  if (
    suppliedTotal !== undefined &&
    (!Number.isInteger(suppliedTotal) || suppliedTotal !== total)
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `rubricScore.total must equal ${total}`,
    );
  }

  return {
    total,
    specificity,
    usageEvidence,
    insightQuality,
    actionability,
    icpFit,
  };
}

async function getFounderFeedbackBySelector(
  selector: unknown,
): Promise<admin.firestore.DocumentSnapshot | null> {
  if (!selector || typeof selector !== "object") return null;
  const data = selector as Record<string, unknown>;
  if (typeof data.feedbackId === "string" && data.feedbackId.trim()) {
    const snap = await db
      .collection(FOUNDER_FEEDBACK_COLLECTION)
      .doc(data.feedbackId.trim())
      .get();
    return snap.exists ? snap : null;
  }
  const email =
    typeof data.email === "string" ? normalizeEmail(data.email) : "";
  if (!email) return null;
  const snap = await db
    .collection(FOUNDER_FEEDBACK_COLLECTION)
    .where("email", "==", email)
    .get();
  if (snap.empty) return null;
  const toMillis = (x: unknown): number =>
    x && typeof (x as { toMillis?: unknown }).toMillis === "function"
      ? (x as { toMillis: () => number }).toMillis()
      : 0;
  return snap.docs.reduce((a, b) =>
    toMillis(b.data().createdAt) > toMillis(a.data().createdAt) ? b : a,
  );
}

// 구조화 설문 제출 (파운더 본인) — 검증 후 7문항 저장. 보상은 운영자 채점 후 확정.
export const submitFounderFeedback = functions.https.onCall(
  async (data, context) => {
    const uid = context.auth?.uid;
    const token = context.auth?.token;
    if (!uid || !token?.email) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    // 무료 Pro 부여 경계 — 이메일 소유권 위조 방지를 위해 인증된 이메일만 허용.
    if (token.email_verified !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "이메일 인증이 완료된 계정만 제출할 수 있습니다.",
      );
    }
    const email = normalizeEmail(token.email);
    const answers = parseFounderSurveyAnswers(data?.answers);
    const fRef = db.collection(FOUNDERS_COLLECTION).doc(email);
    let betaExpiresAt: admin.firestore.Timestamp | null = null;

    // 트랜잭션으로 선정·윈도우·중복제출 검증 + 제출 마킹을 원자적으로 처리
    // (중복 클릭에 의한 중복 설문 방지).
    await db.runTransaction(async (tx) => {
      const s = await tx.get(fRef);
      if (!s.exists || s.data()?.status === "rejected") {
        throw new functions.https.HttpsError(
          "permission-denied",
          "선정된 파운더가 아닙니다. 선정 안내 이메일의 계정으로 로그인했는지 확인해 주세요.",
        );
      }
      const fd = s.data()!;
      if (fd.feedbackSubmittedAt) {
        throw new functions.https.HttpsError(
          "already-exists",
          "이미 설문을 제출하셨습니다.",
        );
      }
      const granted =
        fd.accessGrantedAt && typeof fd.accessGrantedAt.toDate === "function"
          ? fd.accessGrantedAt.toDate()
          : null;
      if (!granted) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "접근 권한이 아직 부여되지 않았습니다.",
        );
      }
      betaExpiresAt =
        fd.betaExpiresAt && typeof fd.betaExpiresAt.toDate === "function"
          ? fd.betaExpiresAt
          : admin.firestore.Timestamp.fromDate(
              addMonths(granted, FOUNDER_BETA_MONTHS),
            );
      tx.set(
        fRef,
        {
          userId: uid,
          status: "feedback_submitted",
          feedbackSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    const fbRef = await db.collection(FOUNDER_FEEDBACK_COLLECTION).add({
      email,
      userId: uid,
      locale: normalizeFounderLocale(
        typeof data?.locale === "string" ? data.locale : "ko",
      ),
      answers,
      rubricScore: null,
      reviewedBy: null,
      reviewedAt: null,
      proGrantedMonths: 0,
      interviewRequested: false,
      interviewRequestedAt: null,
      interviewCompleted: false,
      interviewCompletedAt: null,
      betaExpiresAt,
      proExpiresAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await fRef.set(
      {
        feedbackId: fbRef.id,
        betaExpiresAt,
        proGrantedMonths: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      feedbackId: fbRef.id,
      status: "pending_review",
      betaExpiresAt: betaExpiresAt
        ? (betaExpiresAt as admin.firestore.Timestamp).toDate().toISOString()
        : null,
    };
  },
);

// 내 파운더 선정 상태(본인 조회) — founders 컬렉션은 클라 직접 read 차단이라
// /download 소프트 게이트가 "이 사용자가 선정됐는지"를 확인할 경로가 필요하다.
// 인증된 본인 이메일로 founders/{normalizedEmail} 만 조회한다(타인 조회 불가).
export const getMyFounderAccess = functions.https.onCall(
  async (_data, context) => {
    const uid = context.auth?.uid;
    const token = context.auth?.token;
    if (!uid || !token?.email) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    const email = normalizeEmail(token.email);
    const snap = await db.collection(FOUNDERS_COLLECTION).doc(email).get();
    const fd = snap.exists ? snap.data() : null;
    // 선정 = accessGrantedAt 존재 + rejected 아님 (submitFounderFeedback 과 동일 기준).
    const accessGrantedAt =
      fd && fd.status !== "rejected" ? tsToIso(fd.accessGrantedAt) : null;
    const betaExpiresAt =
      fd && fd.status !== "rejected" ? tsToIso(fd.betaExpiresAt) : null;
    // 설문 회신 여부 — 인앱 "설문 회신 시 Pro 연장" 팝업을 "미회신 파운더"로만
    // 게이팅하려면 이 신호가 필요하다. feedbackSubmittedAt 은 submitFounderFeedback
    // 이 제출 시점에 원자적으로 마킹한다(제출·심사·지급 어느 단계든 true 유지).
    const feedbackSubmitted = !!(fd && fd.feedbackSubmittedAt);
    return {
      hasAccess: !!accessGrantedAt,
      accessGrantedAt,
      betaExpiresAt,
      feedbackSubmitted,
    };
  },
);

// 루브릭 채점 및 Pro 3개월 지급 확정 (관리자용).
export const reviewFounderFeedback = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const feedbackSnap = await getFounderFeedbackBySelector(data);
    if (!feedbackSnap?.exists) {
      throw new functions.https.HttpsError("not-found", "feedback not found");
    }
    const feedback = feedbackSnap.data() as Record<string, unknown>;
    const userId = typeof feedback.userId === "string" ? feedback.userId : "";
    const email =
      typeof feedback.email === "string" ? normalizeEmail(feedback.email) : "";
    if (!userId || !email) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "feedback is missing userId or email",
      );
    }

    const rubricScore = parseFounderRubricScore(data?.rubricScore);
    const grantPro =
      rubricScore.total >= FOUNDER_PRO_RUBRIC_MIN_TOTAL ||
      data?.overrideGrantPro === true;
    const existingGranted =
      typeof feedback.proGrantedMonths === "number"
        ? feedback.proGrantedMonths
        : 0;
    const grantStartedAt =
      feedback.createdAt &&
      typeof (feedback.createdAt as { toDate?: unknown }).toDate === "function"
        ? (feedback.createdAt as { toDate: () => Date }).toDate()
        : new Date();

    let proExpiresAt: Date | null = null;
    if (grantPro && existingGranted < FOUNDER_PRO_MONTHS) {
      proExpiresAt = await grantFounderProTotalInternal(
        userId,
        FOUNDER_PRO_MONTHS,
        "founder_survey_rubric",
        grantStartedAt,
      );
    } else {
      proExpiresAt =
        feedback.proExpiresAt &&
        typeof (feedback.proExpiresAt as { toDate?: unknown }).toDate ===
          "function"
          ? (feedback.proExpiresAt as { toDate: () => Date }).toDate()
          : null;
    }

    const update: Record<string, unknown> = {
      rubricScore,
      reviewedBy: context.auth?.uid ?? null,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (grantPro) {
      update.proGrantedMonths = Math.max(existingGranted, FOUNDER_PRO_MONTHS);
      update.proExpiresAt = proExpiresAt
        ? admin.firestore.Timestamp.fromDate(proExpiresAt)
        : null;
    }
    await feedbackSnap.ref.set(update, { merge: true });

    await db
      .collection(FOUNDERS_COLLECTION)
      .doc(email)
      .set(
        {
          status: grantPro ? "pro_granted" : "survey_reviewed",
          rubricScore,
          feedbackId: feedbackSnap.id,
          proGrantedMonths: grantPro
            ? Math.max(existingGranted, FOUNDER_PRO_MONTHS)
            : existingGranted,
          proExpiresAt: proExpiresAt
            ? admin.firestore.Timestamp.fromDate(proExpiresAt)
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    return {
      ok: true,
      feedbackId: feedbackSnap.id,
      grantPro,
      proMonths: grantPro
        ? Math.max(existingGranted, FOUNDER_PRO_MONTHS)
        : existingGranted,
      proExpiresAt: proExpiresAt?.toISOString() ?? null,
    };
  },
);

// 루브릭 상위 응답자 조회 (관리자용). 복합 인덱스 부담을 줄이기 위해 점수 필터는
// 메모리에서 적용하되, 운영용 표본 한도만 둔다.
export const listTopFounderFeedback = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const limit =
      typeof data?.limit === "number" && Number.isInteger(data.limit)
        ? Math.min(Math.max(data.limit, 1), 100)
        : 10;
    const minScore =
      typeof data?.minScore === "number"
        ? data.minScore
        : FOUNDER_INTERVIEW_MIN_TOTAL;
    const snap = await db
      .collection(FOUNDER_FEEDBACK_COLLECTION)
      .limit(1000)
      .get();
    const items = snap.docs
      .map((doc) => {
        const v = doc.data() as Record<string, unknown>;
        const score = v.rubricScore as Record<string, unknown> | undefined;
        return {
          id: doc.id,
          userId: typeof v.userId === "string" ? v.userId : "",
          email: typeof v.email === "string" ? v.email : "",
          locale: typeof v.locale === "string" ? v.locale : null,
          rubricScore: score ?? null,
          total:
            score && typeof score.total === "number"
              ? score.total
              : Number.NEGATIVE_INFINITY,
          usageEvidence:
            score && typeof score.usageEvidence === "number"
              ? score.usageEvidence
              : 0,
          actionability:
            score && typeof score.actionability === "number"
              ? score.actionability
              : 0,
          icpFit: score && typeof score.icpFit === "number" ? score.icpFit : 0,
          interviewRequested: v.interviewRequested === true,
          interviewCompleted: v.interviewCompleted === true,
          createdAt: tsToIso(v.createdAt),
          reviewedAt: tsToIso(v.reviewedAt),
        };
      })
      .filter((item) => item.total >= minScore)
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        if (b.icpFit !== a.icpFit) return b.icpFit - a.icpFit;
        if (b.usageEvidence !== a.usageEvidence) {
          return b.usageEvidence - a.usageEvidence;
        }
        return b.actionability - a.actionability;
      })
      .slice(0, limit);
    return { items };
  },
);

// 인터뷰 요청 마킹 (관리자용). 점수만으로 자동 선정하지 않고 운영자 명시 호출만 허용.
export const requestFounderInterview = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const feedbackSnap = await getFounderFeedbackBySelector(data);
    if (!feedbackSnap?.exists) {
      throw new functions.https.HttpsError("not-found", "feedback not found");
    }
    const feedback = feedbackSnap.data() as Record<string, unknown>;
    const email =
      typeof feedback.email === "string" ? normalizeEmail(feedback.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "feedback is missing email",
      );
    }
    await feedbackSnap.ref.set(
      {
        interviewRequested: true,
        interviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await db.collection(FOUNDERS_COLLECTION).doc(email).set(
      {
        status: "interview_requested",
        interviewRequested: true,
        interviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, feedbackId: feedbackSnap.id };
  },
);

// 인터뷰 완료 마킹 (관리자용) — 요청받은 사용자의 Pro를 총 6개월로 연장.
// 피드백 제출로 계정이 연결(userId)된 파운더만 대상.
export const markFounderInterviewed = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const feedbackSnap = await getFounderFeedbackBySelector(data);
    if (!feedbackSnap?.exists) {
      throw new functions.https.HttpsError("not-found", "feedback not found");
    }
    const feedback = feedbackSnap.data() as Record<string, unknown>;
    const email =
      typeof feedback.email === "string" ? normalizeEmail(feedback.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "feedback is missing email",
      );
    }
    const fRef = db.collection(FOUNDERS_COLLECTION).doc(email);
    const fSnap = await fRef.get();
    if (!fSnap.exists) {
      throw new functions.https.HttpsError("not-found", "founder not found");
    }
    const f = fSnap.data()!;
    const uid =
      typeof feedback.userId === "string"
        ? feedback.userId
        : typeof f.userId === "string"
          ? f.userId
          : "";
    if (!uid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "설문 제출 전이라 계정이 연결되지 않았습니다. 설문 제출 후 진행하세요.",
      );
    }
    if (feedback.interviewCompleted === true || f.interviewCompleted === true) {
      throw new functions.https.HttpsError(
        "already-exists",
        "이미 인터뷰 보상이 적용되었습니다.",
      );
    }
    if (feedback.interviewRequested !== true && f.interviewRequested !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "인터뷰 요청 대상자만 완료 처리할 수 있습니다.",
      );
    }
    const grantStartedAt =
      feedback.createdAt &&
      typeof (feedback.createdAt as { toDate?: unknown }).toDate === "function"
        ? (feedback.createdAt as { toDate: () => Date }).toDate()
        : new Date();
    const periodEnd = await grantFounderProTotalInternal(
      uid,
      FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
      "founder_interview",
      grantStartedAt,
    );
    await feedbackSnap.ref.set(
      {
        interviewCompleted: true,
        interviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        proGrantedMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(periodEnd),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await fRef.set(
      {
        status: "interviewed",
        interviewCompleted: true,
        interviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        interviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        proGrantedMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(periodEnd),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return {
      ok: true,
      proMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
      currentPeriodEnd: periodEnd.toISOString(),
    };
  },
);

// Timestamp → ISO 문자열(없거나 형식이 아니면 null). 어드민 read 함수 공용.
function tsToIso(v: unknown): string | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

// 좌석 카운터(공개) — 홈 BetaTester50 섹션이 클라 getCountFromServer 대신 호출.
// admin SDK aggregate count 로 이메일 노출 없이 신청 수만 반환.
export const getWaitlistCount = functions.https.onCall(async () => {
  const snap = await db.collection("betatester50_waitlist").count().get();
  return { count: snap.data().count };
});

// 신청 목록(어드민) — betatester50_waitlist 직접 클라 조회 차단 대체.
//
// 동일인이 여러 번 신청하면 doc 이 여러 개 생긴다(클라가 직접 쓰므로 중복 방지 없음).
// 정규화 이메일 기준으로 1건(최신)만 남기고 접어서 내려준다 — 어드민이 같은 사람을
// 두 번 선정하는 실수를 막는다. status="rejected"(markFounderRejected) 는 기본 제외.
export const getFounderWaitlist = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const includeRejected = data?.includeRejected === true;
    const snap = await db
      .collection("betatester50_waitlist")
      .orderBy("createdAt", "desc")
      .limit(WAITLIST_SCAN_LIMIT)
      .get();

    // createdAt desc 정렬이므로 각 이메일의 첫 등장이 최신 신청 = 대표 항목.
    const byEmail = new Map<
      string,
      {
        id: string;
        email: string;
        normalizedEmail: string;
        locale: string | null;
        source: string | null;
        createdAt: string | null;
        status: string | null;
        duplicateCount: number;
      }
    >();
    for (const d of snap.docs) {
      const v = d.data() as Record<string, unknown>;
      const email = typeof v.email === "string" ? v.email : "";
      if (!email) continue;
      const normalizedEmail = normalizeEmail(email);
      const existing = byEmail.get(normalizedEmail);
      if (existing) {
        existing.duplicateCount++;
        // 중복 중 하나라도 반려면 그 이메일은 반려로 본다(반려는 전 신청에 일괄
        // 적용되지만, 반려 후 재신청한 doc 이 섞여도 안전하게 걸러지도록).
        if (v.status === "rejected") {
          existing.status = "rejected";
        }
        continue;
      }
      byEmail.set(normalizedEmail, {
        id: d.id,
        email,
        normalizedEmail,
        locale: typeof v.locale === "string" ? v.locale : null,
        source: typeof v.source === "string" ? v.source : null,
        createdAt: tsToIso(v.createdAt),
        status: typeof v.status === "string" ? v.status : null,
        duplicateCount: 1,
      });
    }

    const all = [...byEmail.values()];
    const items = includeRejected
      ? all
      : all.filter((i) => i.status !== "rejected");
    return { items, rejectedCount: all.length - items.length };
  },
);

// 파운더 현황(어드민) — founders 컬렉션 전체 요약. 상태·시각·Pro개월 등.
export const listFounders = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db.collection(FOUNDERS_COLLECTION).limit(1000).get();
  const items = snap.docs.map((d) => {
    const v = d.data() as Record<string, unknown>;
    const feedbackId = typeof v.feedbackId === "string" ? v.feedbackId : null;
    const score = v.rubricScore as Record<string, unknown> | undefined;
    return {
      email: typeof v.email === "string" ? v.email : d.id,
      status: typeof v.status === "string" ? v.status : null,
      accessGrantedAt: tsToIso(v.accessGrantedAt),
      betaExpiresAt: tsToIso(v.betaExpiresAt),
      feedbackSubmittedAt: tsToIso(v.feedbackSubmittedAt),
      rubricScore: score ?? null,
      interviewRequested: v.interviewRequested === true,
      interviewRequestedAt: tsToIso(v.interviewRequestedAt),
      interviewCompleted: v.interviewCompleted === true,
      interviewCompletedAt: tsToIso(v.interviewCompletedAt),
      proExpiresAt: tsToIso(v.proExpiresAt),
      proGrantedMonths:
        typeof v.proGrantedMonths === "number" ? v.proGrantedMonths : 0,
      feedbackId,
      hasFeedback: !!feedbackId,
    };
  });
  return { items };
});

// 이메일별 7문항 설문 열람(어드민) — founder_feedback 최신 1건.
export const getFounderFeedbackByEmail = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const email =
      typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email required",
      );
    }
    // orderBy 제거 — (email + createdAt) 복합 인덱스 없이 동작하도록 클라이언트 정렬.
    // 선례: src/services/chatService.ts subscribeToMessages. createdAt 은 Firestore
    // Timestamp 이거나 undefined 일 수 있어 toMillis 가드로 안전 비교 후 최신 1건 선택.
    const snap = await db
      .collection(FOUNDER_FEEDBACK_COLLECTION)
      .where("email", "==", email)
      .get();
    if (snap.empty) {
      return { feedback: null };
    }
    const toMillis = (x: unknown): number =>
      x && typeof (x as { toMillis?: unknown }).toMillis === "function"
        ? (x as { toMillis: () => number }).toMillis()
        : 0;
    const latest = snap.docs.reduce((a, b) =>
      toMillis(b.data().createdAt) > toMillis(a.data().createdAt) ? b : a,
    );
    const v = latest.data() as Record<string, unknown>;
    const a = (v.answers as Record<string, unknown>) || {};
    const str = (x: unknown): string => (typeof x === "string" ? x : "");
    return {
      feedback: {
        id: latest.id,
        userId: typeof v.userId === "string" ? v.userId : null,
        email: typeof v.email === "string" ? v.email : null,
        locale: typeof v.locale === "string" ? v.locale : null,
        answers: {
          q1: str(a.q1),
          q2: str(a.q2),
          q3: str(a.q3),
          q4: str(a.q4),
          q5: str(a.q5),
          q6: str(a.q6),
          q7: str(a.q7),
        },
        rubricScore: v.rubricScore ?? null,
        reviewedBy: typeof v.reviewedBy === "string" ? v.reviewedBy : null,
        reviewedAt: tsToIso(v.reviewedAt),
        proGrantedMonths:
          typeof v.proGrantedMonths === "number" ? v.proGrantedMonths : 0,
        betaExpiresAt: tsToIso(v.betaExpiresAt),
        proExpiresAt: tsToIso(v.proExpiresAt),
        interviewRequested: v.interviewRequested === true,
        interviewRequestedAt: tsToIso(v.interviewRequestedAt),
        interviewCompleted: v.interviewCompleted === true,
        interviewCompletedAt: tsToIso(v.interviewCompletedAt),
        createdAt: tsToIso(v.createdAt),
      },
    };
  },
);

// ─── In-app Bug Reports (사용자 버그 신고) ─────────────────────
// 데스크톱 앱 'Report a bug' → submitBugReport(): 로그인 사용자가 자유 서술 +
// 자동수집 컨텍스트(앱버전/플랫폼/라우트/에이전트 스냅샷)를 제출한다. founder
// feedback 과 달리 1인 1회 제한이 없고(여러 건 허용) 가벼운 rate-guard 만 둔다.
// 서버에서 uid/email/createdAt 을 각인하고 bugReports/ 에 기록.
const BUG_REPORT_DESC_MAX = 5000;
const BUG_REPORT_CTX_FIELD_MAX = 10000;
const BUG_REPORT_MIN_INTERVAL_MS = 5000; // 연타 방지
const BUG_REPORT_DAILY_MAX = 30; // 유저당 하루 상한
const BUG_REPORT_STATUSES = ["new", "triaged", "resolved"] as const;

export const submitBugReport = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "로그인이 필요합니다.",
    );
  }
  // 이메일은 서버가 토큰에서 각인(클라 입력 불신). 인증 이메일 없으면 null.
  const email =
    typeof context.auth?.token?.email === "string"
      ? normalizeEmail(context.auth.token.email)
      : null;

  const description =
    typeof data?.description === "string"
      ? data.description.trim().slice(0, BUG_REPORT_DESC_MAX)
      : "";
  if (!description) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "버그 설명을 입력해 주세요.",
    );
  }

  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const appVersion = str(data?.appVersion, 100);
  const platform = str(data?.platform, 100);

  const ctxIn = (
    data?.context && typeof data.context === "object" ? data.context : {}
  ) as Record<string, unknown>;
  // recentLogs / agentSnapshot 은 자동수집 로그라 토큰·API 키가 섞일 수 있다.
  // 저장 직전 시크릿 패턴을 레닥션한다(베스트-에포트). route 는 앱 내부 경로라 제외.
  const reportContext = {
    recentLogs: redactSecrets(str(ctxIn.recentLogs, BUG_REPORT_CTX_FIELD_MAX)),
    route: str(ctxIn.route, 500),
    agentSnapshot: redactSecrets(
      str(ctxIn.agentSnapshot, BUG_REPORT_CTX_FIELD_MAX),
    ),
  };

  // 가벼운 rate-guard — 연타/스팸 방지. 전용 throttle 문서를 트랜잭션으로 갱신해
  // (uid+createdAt 복합 인덱스 없이) 최근 제출 간격과 일일 카운트를 강제한다.
  const throttleRef = db.collection("bugReportThrottle").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const now = Date.now();
    const d = snap.exists ? snap.data()! : {};
    const lastAt = typeof d.lastAtMs === "number" ? d.lastAtMs : 0;
    if (now - lastAt < BUG_REPORT_MIN_INTERVAL_MS) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "잠시 후 다시 시도해 주세요.",
      );
    }
    const dayStart = typeof d.dayStartMs === "number" ? d.dayStartMs : 0;
    const dayRolledOver = now - dayStart > 24 * 60 * 60 * 1000;
    const dayCount = dayRolledOver
      ? 0
      : typeof d.dayCount === "number"
        ? d.dayCount
        : 0;
    if (dayCount >= BUG_REPORT_DAILY_MAX) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "하루 제출 한도를 초과했습니다. 내일 다시 시도해 주세요.",
      );
    }
    tx.set(
      throttleRef,
      {
        lastAtMs: now,
        dayStartMs: dayRolledOver ? now : dayStart || now,
        dayCount: dayCount + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  const reportRef = await db.collection("bugReports").add({
    uid,
    email,
    description,
    appVersion: appVersion || null,
    platform: platform || null,
    context: reportContext,
    status: "new",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, id: reportRef.id };
});

// 어드민 트리아지 — bugReports 최신순 조회. status 필터는 어드민 UI 에서 적용
// (status+createdAt 복합 인덱스 회피를 위해 서버는 항상 최신순 전량 반환).
export const listBugReports = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db
    .collection("bugReports")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  const s = (x: unknown): string => (typeof x === "string" ? x : "");
  const items = snap.docs.map((doc) => {
    const v = doc.data() as Record<string, unknown>;
    const c = (v.context as Record<string, unknown>) || {};
    return {
      id: doc.id,
      uid: s(v.uid),
      email: typeof v.email === "string" ? v.email : null,
      description: s(v.description),
      appVersion: typeof v.appVersion === "string" ? v.appVersion : null,
      platform: typeof v.platform === "string" ? v.platform : null,
      context: {
        recentLogs: s(c.recentLogs),
        route: s(c.route),
        agentSnapshot: s(c.agentSnapshot),
      },
      status: typeof v.status === "string" ? v.status : "new",
      createdAt: tsToIso(v.createdAt),
    };
  });
  return { items };
});

// 어드민 트리아지 — 신고 status 변경(new → triaged → resolved). 클라 직접
// update 는 규칙으로 차단되어 있으므로 이 콜러블(Admin SDK)만 status 를 바꾼다.
export const updateBugReportStatus = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const id = typeof data?.id === "string" ? data.id.trim() : "";
    const status = typeof data?.status === "string" ? data.status : "";
    if (!id) {
      throw new functions.https.HttpsError("invalid-argument", "id required");
    }
    if (!(BUG_REPORT_STATUSES as readonly string[]).includes(status)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 상태값입니다.",
      );
    }
    const ref = db.collection("bugReports").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "신고를 찾을 수 없습니다.",
      );
    }
    await ref.set(
      {
        status,
        triagedBy: context.auth?.uid ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);

// ─── Telemetry → BigQuery ─────────────────────────────────────

interface TelemetryRow {
  event: string;
  /** Anonymous per-install id (see telemetryService.getClientId). Stored in
   *  place of the Firebase uid so the events table stays 비식별(익명). */
  clientId?: string;
  appVersion: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  flowId?: string;
  model?: string;
  role?: string;
  status?: string;
  fromStatus?: string;
  toStatus?: string;
  durationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  success?: boolean;
  exitCode?: number;
  nodeType?: string;
  nodeCount?: number;
  metadata?: string;
  timestamp: string;
  // ML-ready columns
  taskType?: string;
  taskComplexity?: number;
  filesChanged?: number;
  linesChanged?: number;
  errorCategory?: string;
  errorMessage?: string;
  promptHash?: string;
  promptLength?: number;
  parentAgentId?: string;
  retryOf?: string;
  // ── dispatch:decision event fields (DISPATCH-DECISION-TELEMETRY) ──
  // The model-dispatch decision snapshot ("어떤 모델을 어떤 태스크에 왜 배치했나").
  // These arrive top-level on the dispatch:decision event; we fold them into the
  // existing `metadata` STRING column as JSON rather than add dedicated BigQuery
  // columns — see the mapping note below for why.
  reuseVsSpawn?: string;
  selectedModel?: string;
  complexity?: string;
  tags?: string[];
  eligibleModels?: string[];
  explicitModel?: boolean;
  decisionReason?: string;
  modelSelectionMode?: string;
  perModelScores?: unknown;
  agentScore?: number;
  /** ★P2-3 — 실제 스폰된 구체 모델·effort("claude-opus-5", "gpt-5.6-terra@max").
   * selectedModel 은 프로바이더까지만 말하므로 그것과 별개 축이다. */
  spawnedModel?: string;
  /** 지정 모델이 CLI 버전가드에 걸려 폴백했을 때의 사유 코드. */
  modelFallbackReason?: string;
}

// dispatch:decision fields that get folded into the `metadata` JSON column.
// `model`/`agentId`/`taskId`/`role` are NOT here — they map to first-class
// columns already (selectedModel is also sent as `model` for GROUP BY model).
const DISPATCH_DECISION_META_KEYS = [
  "reuseVsSpawn",
  "selectedModel",
  "complexity",
  "tags",
  "eligibleModels",
  "explicitModel",
  "decisionReason",
  "modelSelectionMode",
  "perModelScores",
  "agentScore",
  // ★이 목록은 화이트리스트다 — 여기 없는 필드는 metadata 에 접히지 않고 조용히
  // 사라진다. P2-3 의 model@effort 기록이 BigQuery 까지 살아 가려면 반드시 등재.
  "spawnedModel",
  "modelFallbackReason",
] as const;

/**
 * Build the `metadata` STRING column value for an event.
 *
 * For dispatch:decision we merge the decision-specific fields (perModelScores,
 * reuseVsSpawn, selection mode, …) into the metadata JSON. Design choice: a
 * single JSON STRING column instead of flattened per-field BigQuery columns.
 *   - Backward compatible: no ALTER TABLE on a streaming-insert table (adding
 *     columns there risks insert failures until the schema change propagates,
 *     and would break replay of existing rows). Deploy = `firebase deploy`
 *     for the function only; no BigQuery migration required.
 *   - Query-friendly: analysts use JSON_VALUE(metadata,'$.reuseVsSpawn'),
 *     JSON_VALUE(metadata,'$.selectedModel'), JSON_QUERY(metadata,
 *     '$.perModelScores') to slice/join against cost_logs.taskId + outcomes.
 */
function buildMetadata(e: TelemetryRow, accountUserId?: string): string | null {
  const base =
    e.metadata != null
      ? typeof e.metadata === "string"
        ? safeParseObject(e.metadata)
        : (e.metadata as Record<string, unknown>)
      : {};
  const withAccountUser =
    accountUserId != null && accountUserId !== ""
      ? { ...base, accountUserId }
      : base;

  if (e.event === "dispatch:decision") {
    const decision: Record<string, unknown> = { ...withAccountUser };
    const row = e as unknown as Record<string, unknown>;
    for (const key of DISPATCH_DECISION_META_KEYS) {
      const v = row[key];
      if (v !== undefined) decision[key] = v;
    }
    return Object.keys(decision).length > 0 ? JSON.stringify(decision) : null;
  }

  return Object.keys(withAccountUser).length > 0
    ? JSON.stringify(withAccountUser)
    : null;
}

/** Parse a JSON object string, returning {} on anything non-object/invalid. */
function safeParseObject(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const logTelemetryBatch = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const events: TelemetryRow[] = data.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "events array required",
      );
    }

    if (events.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Max 100 events per batch",
      );
    }

    // Auth is required for anti-abuse, but we deliberately DO NOT persist the
    // uid. The events table is 비식별(익명): the `userId` column now holds the
    // client-supplied anonymous install id, never the Firebase account uid.
    const now = new Date().toISOString();
    const accountUserId = context.auth.uid;

    const rows = events.map((e) => ({
      event: e.event,
      userId: e.clientId || "anon",
      // Record the client-supplied version verbatim, or null when absent. The
      // old "3.0.0" fallback masked every event as a single stale version and
      // made per-release analysis impossible; null honestly means "unknown".
      appVersion: e.appVersion || null,
      projectId: e.projectId || null,
      agentId: e.agentId || null,
      taskId: e.taskId || null,
      flowId: e.flowId || null,
      model: e.model || null,
      role: e.role || null,
      status: e.status || null,
      fromStatus: e.fromStatus || null,
      toStatus: e.toStatus || null,
      durationMs: e.durationMs ?? null,
      tokensInput: e.tokensInput ?? null,
      tokensOutput: e.tokensOutput ?? null,
      cost: e.cost ?? null,
      success: e.success ?? null,
      exitCode: e.exitCode ?? null,
      nodeType: e.nodeType || null,
      nodeCount: e.nodeCount ?? null,
      metadata: buildMetadata(e, accountUserId),
      // ML-ready columns
      taskType: e.taskType || null,
      taskComplexity: e.taskComplexity ?? null,
      filesChanged: e.filesChanged ?? null,
      linesChanged: e.linesChanged ?? null,
      errorCategory: e.errorCategory || null,
      errorMessage: e.errorMessage
        ? String(e.errorMessage).slice(0, 500)
        : null,
      promptHash: e.promptHash || null,
      promptLength: e.promptLength ?? null,
      parentAgentId: e.parentAgentId || null,
      retryOf: e.retryOf || null,
      timestamp: now,
    }));

    await bigquery.dataset(BQ_DATASET).table(BQ_EVENTS_TABLE).insert(rows);

    return { inserted: rows.length };
  },
);

interface CostRow {
  projectId: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  // ML-ready columns
  taskId?: string;
  taskType?: string;
  sessionId?: string;
  pricingSnapshot?: string;
}

interface CostSummaryByDayRow {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

interface CostSummaryWeeklyByModelRow {
  model: string;
  totalTokens: number;
  cost: number;
}

interface CostSummaryAggregateRow {
  date?: string;
  model?: string;
  inputTokens?: number | string;
  outputTokens?: number | string;
  cacheReadTokens?: number | string;
  cacheWriteTokens?: number | string;
  totalTokens?: number | string;
  cost?: number | string;
}

const toNumber = (value: number | string | undefined): number =>
  Number(value ?? 0);

export const logCostBatch = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const entries: CostRow[] = data.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "entries array required",
    );
  }

  const userId = context.auth.uid;
  const now = new Date().toISOString();

  const rows = entries.map((e) => ({
    userId,
    projectId: e.projectId || null,
    agentId: e.agentId || null,
    model: e.model || null,
    inputTokens: e.inputTokens ?? 0,
    outputTokens: e.outputTokens ?? 0,
    cacheReadTokens: e.cacheReadTokens ?? 0,
    cacheWriteTokens: e.cacheWriteTokens ?? 0,
    totalCost: e.totalCost ?? 0,
    // ML-ready columns
    taskId: e.taskId || null,
    taskType: e.taskType || null,
    sessionId: e.sessionId || null,
    pricingSnapshot: e.pricingSnapshot || null,
    timestamp: now,
  }));

  await bigquery.dataset(BQ_DATASET).table(BQ_COST_TABLE).insert(rows);

  return { inserted: rows.length };
});

// Query cost logs from BigQuery for dashboard display
export const getCostLogs = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const projectId: string = data.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "projectId required",
    );
  }

  const userId = context.auth.uid;
  const { limit, capped } = normalizeCostLogsLimit(data.limit);
  if (capped) {
    functions.logger.warn("[getCostLogs] limit capped to protect BigQuery", {
      requestedLimit: Number(data.limit),
      maxLimit: MAX_COST_LOGS_LIMIT,
    });
  }

  const query = `
    SELECT agentId, model, inputTokens, outputTokens,
           cacheReadTokens, cacheWriteTokens, totalCost, timestamp
    FROM \`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\`
    WHERE userId = @userId AND projectId = @projectId
    ORDER BY timestamp DESC
    LIMIT @limit
  `;

  const [rows] = await bigquery.query({
    query,
    params: { userId, projectId, limit },
    location: BQ_LOCATION,
  });

  return { logs: rows };
});

// Query aggregated cost summary from BigQuery for dashboard charts
export const getCostSummary = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const projectId: string = data.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "projectId required",
    );
  }

  const requestedDays = Number(data.days ?? 30);
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "days must be a positive integer",
    );
  }

  const userId = context.auth.uid;
  const weeklyDays = 7;

  const byDayQuery = `
    SELECT
      FORMAT_DATE('%F', DATE(timestamp)) AS date,
      COALESCE(model, '') AS model,
      SUM(COALESCE(inputTokens, 0)) AS inputTokens,
      SUM(COALESCE(outputTokens, 0)) AS outputTokens,
      SUM(COALESCE(cacheReadTokens, 0)) AS cacheReadTokens,
      SUM(COALESCE(cacheWriteTokens, 0)) AS cacheWriteTokens,
      SUM(
        COALESCE(inputTokens, 0) +
        COALESCE(outputTokens, 0) +
        COALESCE(cacheReadTokens, 0) +
        COALESCE(cacheWriteTokens, 0)
      ) AS totalTokens,
      SUM(COALESCE(totalCost, 0)) AS cost
    FROM \`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\`
    WHERE userId = @userId
      AND projectId = @projectId
      AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY date, model
    ORDER BY date ASC, model ASC
  `;

  const weeklyByModelQuery = `
    SELECT
      COALESCE(model, '') AS model,
      SUM(
        COALESCE(inputTokens, 0) +
        COALESCE(outputTokens, 0) +
        COALESCE(cacheReadTokens, 0) +
        COALESCE(cacheWriteTokens, 0)
      ) AS totalTokens,
      SUM(COALESCE(totalCost, 0)) AS cost
    FROM \`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\`
    WHERE userId = @userId
      AND projectId = @projectId
      AND timestamp >= TIMESTAMP_SUB(
        CURRENT_TIMESTAMP(),
        INTERVAL @weeklyDays DAY
      )
    GROUP BY model
    ORDER BY model ASC
  `;

  const [[byDayRows], [weeklyByModelRows]] = await Promise.all([
    bigquery.query({
      query: byDayQuery,
      params: { userId, projectId, days: requestedDays },
      location: BQ_LOCATION,
    }),
    bigquery.query({
      query: weeklyByModelQuery,
      params: { userId, projectId, weeklyDays },
      location: BQ_LOCATION,
    }),
  ]);

  const byDay: CostSummaryByDayRow[] = (
    byDayRows as CostSummaryAggregateRow[]
  ).map((row) => ({
    date: row.date ?? "",
    model: row.model ?? "",
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    cacheReadTokens: toNumber(row.cacheReadTokens),
    cacheWriteTokens: toNumber(row.cacheWriteTokens),
    totalTokens: toNumber(row.totalTokens),
    cost: toNumber(row.cost),
  }));

  const weeklyByModel: CostSummaryWeeklyByModelRow[] = (
    weeklyByModelRows as CostSummaryAggregateRow[]
  ).map((row) => ({
    model: row.model ?? "",
    totalTokens: toNumber(row.totalTokens),
    cost: toNumber(row.cost),
  }));

  const weeklyTotalTokens = weeklyByModel.reduce(
    (total, row) => total + row.totalTokens,
    0,
  );
  const weeklyCost = weeklyByModel.reduce((total, row) => total + row.cost, 0);

  return {
    byDay,
    weeklyByModel,
    weeklyTotalTokens,
    weeklyCost,
    rangeDays: requestedDays,
  };
});

// ─── Task Outcomes → BigQuery ────────────────────────────────

const BQ_TASK_OUTCOMES_TABLE = "task_outcomes";

export const logTaskOutcome = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const d = data.outcome;
  if (!d || !d.taskId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "outcome with taskId required",
    );
  }

  // 비식별: store the anonymous client id, not the account uid (anti-abuse
  // auth above is enough — the row itself stays de-identified).
  const now = new Date().toISOString();

  const row = {
    userId: d.clientId || "anon",
    taskId: d.taskId,
    projectId: d.projectId || null,
    taskType: d.taskType || null,
    taskComplexity: d.taskComplexity ?? null,
    role: d.role || null,
    model: d.model || null,
    promptLength: d.promptLength ?? null,
    scopeFileCount: d.scopeFileCount ?? null,
    success: d.success ?? null,
    durationMs: d.durationMs ?? null,
    totalInputTokens: d.totalInputTokens ?? null,
    totalOutputTokens: d.totalOutputTokens ?? null,
    totalCost: d.totalCost ?? null,
    retriesCount: d.retriesCount ?? 0,
    errorCategory: d.errorCategory || null,
    createdAt: d.createdAt || now,
    completedAt: d.completedAt || now,
  };

  await bigquery
    .dataset(BQ_DATASET)
    .table(BQ_TASK_OUTCOMES_TABLE)
    .insert([row]);

  return { inserted: 1 };
});

// ─── Agent Heartbeats → BigQuery ─────────────────────────────

const BQ_HEARTBEATS_TABLE = "agent_heartbeats";

export const logHeartbeat = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const beats = data.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "beats array required",
    );
  }

  if (beats.length > 50) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Max 50 beats per batch",
    );
  }

  // 비식별: heartbeats carry the anonymous client id, not the account uid.
  const now = new Date().toISOString();

  const rows = beats.map((b: Record<string, unknown>) => ({
    userId: (b.clientId as string) || "anon",
    agentId: b.agentId || "",
    projectId: b.projectId || null,
    status: b.status || null,
    tokensAccumulated: (b.tokensAccumulated as number) ?? null,
    costAccumulated: (b.costAccumulated as number) ?? null,
    lastActivityType: b.lastActivityType || null,
    timestamp: (b.timestamp as string) || now,
  }));

  await bigquery.dataset(BQ_DATASET).table(BQ_HEARTBEATS_TABLE).insert(rows);

  return { inserted: rows.length };
});

// ─── Flow Executions → BigQuery ──────────────────────────────

const BQ_FLOW_EXECUTIONS_TABLE = "flow_executions";

export const logFlowExecution = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const d = data.execution;
    if (!d || !d.flowId || !d.runId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "execution with flowId and runId required",
      );
    }

    const userId = context.auth.uid;
    const now = new Date().toISOString();

    const row = {
      userId,
      flowId: d.flowId,
      runId: d.runId,
      projectId: d.projectId || null,
      nodeCount: d.nodeCount ?? null,
      nodesExecuted: d.nodesExecuted
        ? typeof d.nodesExecuted === "string"
          ? d.nodesExecuted
          : JSON.stringify(d.nodesExecuted)
        : null,
      status: d.status || null,
      totalDurationMs: d.totalDurationMs ?? null,
      success: d.success ?? null,
      timestamp: now,
    };

    await bigquery
      .dataset(BQ_DATASET)
      .table(BQ_FLOW_EXECUTIONS_TABLE)
      .insert([row]);

    return { inserted: 1 };
  },
);

// ============================================
// Scheduled Reconciliation (P0-11)
// ============================================
// Daily cron at 04:00 KST (low-traffic window). Picks up payments that
// succeeded on the PG side but never made it into Firestore due to a
// dropped webhook. See reconciliation.ts for the decision tree.

export const scheduledReconcileToss = functions.pubsub
  .schedule("0 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const result = await reconcileTossPending();
    console.log("[Recon Toss]", JSON.stringify(result));
    return null;
  });

export const scheduledReconcilePaddle = functions.pubsub
  .schedule("15 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const result = await reconcilePaddlePending();
    console.log("[Recon Paddle]", JSON.stringify(result));
    return null;
  });

// ─── 정기결제 갱신 크론(GAP A) ────────────────────────────────────────
// 매일 04:30 KST. active/past_due 토스 구독 중 만료 도래분을 chargeBillingKey
// 헬퍼로 청구한다. 성공 → 기간 연장(멱등), 실패 → past_due/재시도 백오프,
// 누적 실패 MAX 도달 → 해지(free 강등). 복합 인덱스 회피를 위해 paymentProvider
// 단일 동등 쿼리 + 코드 필터(reconcilePaddlePending 선례).
export const scheduledChargeSubscriptions = functions.pubsub
  .schedule("30 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const nowMs = Date.now();
    const result = {
      scanned: 0,
      due: 0,
      charged: 0,
      comped: 0,
      extended: 0,
      failed: 0,
      suspended: 0,
      skipped: 0,
    };
    const snap = await db
      .collection("subscriptions")
      .where("paymentProvider", "==", "toss")
      .get();
    result.scanned = snap.size;

    for (const doc of snap.docs) {
      const sub = doc.data();
      const currentPeriodEndMs = tsToMillis(sub.currentPeriodEnd);
      const snapshot: SubscriptionSnapshot = {
        paymentProvider: sub.paymentProvider,
        status: sub.status,
        planType: sub.planType,
        billingCycle: sub.billingCycle,
        tossBillingKey: sub.tossBillingKey,
        tossCustomerKey: sub.tossCustomerKey,
        founderGrant: sub.founderGrant === true,
        currentPeriodEndMs,
        billingFailedCount: sub.billingFailedCount || 0,
        nextRetryAtMs: tsToMillis(sub.nextRetryAt),
      };
      if (!selectDueForCharge(snapshot, nowMs)) continue;
      result.due++;

      const planType = sub.planType || "pro";
      // 갱신 주기는 구독 문서가 단일 진실 — 연간 구독자는 매년 연간가로만
      // 청구된다. 레거시 문서(billingCycle 부재)는 월간으로 읽혀 기존 동작 유지.
      const billingCycle = normalizeBillingCycle(sub.billingCycle);
      const amount = planAmountKRW(planType, billingCycle);
      if (!amount) {
        result.skipped++;
        continue;
      }

      // 사이클 앵커 = 만료 경계(currentPeriodEndMs 는 selectDueForCharge 통과로
      // 반드시 number). 같은 사이클 중복청구를 멱등 문서가 막는다.
      const cycleAnchorMs = currentPeriodEndMs as number;
      const charge = await chargeSubscriptionIdempotent({
        userId: doc.id,
        billingKey: sub.tossBillingKey as string,
        customerKey: sub.tossCustomerKey as string,
        amount,
        planType,
        cycleAnchorMs,
        reason: "renewal",
      });

      if (charge.status === "failed") {
        const f = applyChargeFailure(snapshot, nowMs);
        await doc.ref.update({
          status: f.status,
          billingFailedCount: f.billingFailedCount,
          nextRetryAt:
            f.nextRetryAtMs != null
              ? admin.firestore.Timestamp.fromMillis(f.nextRetryAtMs)
              : null,
          ...(f.planType ? { planType: f.planType } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (f.status === "canceled") result.suspended++;
        else result.failed++;
        continue;
      }

      // charged/comped/skipped(이미 succeeded) → 기간 연장. skipped 도 연장해야
      // "청구 성공했으나 직전 실행이 기간갱신 전 죽은" 구독의 무한 재선정을 막는다.
      const s = applyChargeSuccess(nowMs, billingCycle);
      await doc.ref.update({
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        billingCycle: s.billingCycle,
        billingFailedCount: 0,
        nextRetryAt: null,
        ...(charge.status === "charged"
          ? { tossPaymentKey: charge.paymentKey }
          : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      result.extended++;
      if (charge.status === "charged") result.charged++;
      else if (charge.status === "comped") result.comped++;
      else result.skipped++;
    }

    console.log("[Billing Cron]", JSON.stringify(result));
    return null;
  });

// ─── PortOne 정기결제 갱신 크론 ───────────────────────────────────────
// 매일 05:00 KST. 토스 크론(scheduledChargeSubscriptions) 미러 —
// paymentProvider=="portone" 쿼리 + payPortOneBillingKey 청구.
// selectDueForCharge / applyChargeSuccess / applyChargeFailure / planAmountKRW
// 는 billing.ts 헬퍼 재사용. 토스 크론은 건드리지 않는다.
export const scheduledChargePortOneSubscriptions = functions.pubsub
  .schedule("0 5 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const nowMs = Date.now();
    const result = {
      scanned: 0,
      due: 0,
      charged: 0,
      comped: 0,
      extended: 0,
      failed: 0,
      suspended: 0,
      skipped: 0,
    };
    const snap = await db
      .collection("subscriptions")
      .where("paymentProvider", "==", "portone")
      .get();
    result.scanned = snap.size;

    for (const doc of snap.docs) {
      const sub = doc.data();
      const currentPeriodEndMs = tsToMillis(sub.currentPeriodEnd);
      const snapshot: SubscriptionSnapshot = {
        paymentProvider: sub.paymentProvider,
        status: sub.status,
        planType: sub.planType,
        billingCycle: sub.billingCycle,
        portoneBillingKey: sub.portoneBillingKey,
        founderGrant: sub.founderGrant === true,
        currentPeriodEndMs,
        billingFailedCount: sub.billingFailedCount || 0,
        nextRetryAtMs: tsToMillis(sub.nextRetryAt),
      };
      if (!selectDueForCharge(snapshot, nowMs)) continue;
      result.due++;

      const planType = sub.planType || "pro";
      const billingCycle = normalizeBillingCycle(sub.billingCycle);
      const amount = planAmountKRW(planType, billingCycle);
      if (!amount) {
        result.skipped++;
        continue;
      }

      const billingKey =
        typeof sub.portoneBillingKey === "string"
          ? sub.portoneBillingKey
          : null;
      const customerName =
        typeof sub.portoneCustomerName === "string"
          ? sub.portoneCustomerName
          : null;
      const customerPhone =
        typeof sub.portoneCustomerPhone === "string"
          ? sub.portoneCustomerPhone
          : null;
      // 구독 문서에 저장된 email 우선, 없으면 Auth 폴백.
      let customerEmail: string | null =
        typeof sub.portoneCustomerEmail === "string" &&
        sub.portoneCustomerEmail.trim()
          ? sub.portoneCustomerEmail.trim()
          : null;
      if (!customerEmail) {
        try {
          const userRecord = await admin.auth().getUser(doc.id);
          customerEmail =
            typeof userRecord.email === "string" ? userRecord.email : null;
        } catch {
          customerEmail = null;
        }
      }
      // KG이니시스 갱신 청구는 name/phone/email 필수 — 미저장 레거시는 스킵(해지 방지).
      if (!billingKey || !customerName || !customerPhone || !customerEmail) {
        console.warn(
          "[PortOne Billing Cron] missing billingKey/name/phone/email, skip",
          doc.id,
        );
        result.skipped++;
        continue;
      }

      const cycleAnchorMs = currentPeriodEndMs as number;
      const charge = await chargePortOneSubscriptionIdempotent({
        userId: doc.id,
        billingKey,
        amount,
        planType,
        cycleAnchorMs,
        reason: "renewal",
        customerEmail,
        customerName,
        customerPhone,
      });

      if (charge.status === "failed") {
        const f = applyChargeFailure(snapshot, nowMs);
        await doc.ref.update({
          status: f.status,
          billingFailedCount: f.billingFailedCount,
          nextRetryAt:
            f.nextRetryAtMs != null
              ? admin.firestore.Timestamp.fromMillis(f.nextRetryAtMs)
              : null,
          ...(f.planType ? { planType: f.planType } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (f.status === "canceled") result.suspended++;
        else result.failed++;
        continue;
      }

      const s = applyChargeSuccess(nowMs, billingCycle);
      await doc.ref.update({
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        billingCycle: s.billingCycle,
        billingFailedCount: 0,
        nextRetryAt: null,
        ...(charge.status === "charged"
          ? { portonePaymentId: charge.paymentKey }
          : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      result.extended++;
      if (charge.status === "charged") result.charged++;
      else if (charge.status === "comped") result.comped++;
      else result.skipped++;
    }

    console.log("[PortOne Billing Cron]", JSON.stringify(result));
    return null;
  });

// Manual trigger for ad-hoc runs (operator only — guarded by ADMIN_UID).
export const triggerReconcile = functions.https.onCall(
  async (data, context) => {
    const adminUid = process.env.ADMIN_UID;
    if (!adminUid || context.auth?.uid !== adminUid) {
      throw new functions.https.HttpsError("permission-denied", "Admin only");
    }
    const provider = (data?.provider as string) || "toss";
    if (provider === "paddle") return reconcilePaddlePending();
    return reconcileTossPending();
  },
);

// ═══════════════════════════════════════════════════════════════════
// ─── Founder Beta Telegram 승인 ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
//
// 파운더 베타 신청/설문 제출을 관리자 텔레그램으로 알리고, 인라인 버튼으로
// 승인/스킵/예외 Pro 부여를 처리한다. 기존 선정·부여 로직(markFounderSelectedInternal,
// grantFounderProTotalInternal)을 그대로 재사용 — 알림+버튼 레이어만 얹는다.
//
// 안전 정책(기존 RESEND 패턴과 동일):
//  - env(TELEGRAM_BETA_*) 미설정 시 알림/웹훅은 조용히 스킵 → 기존 흐름 무영향.
//  - 텔레그램 API 호출은 전부 non-throwing(에러 삼킴) — 트리거 재시도 폭주 방지.
//  - 웹훅은 시크릿 헤더 검증 + 관리자 chat/from 확인 + 멱등 처리 후 항상 200 반환.

const TELEGRAM_BETA_BOT_TOKEN = process.env.TELEGRAM_BETA_BOT_TOKEN || "";
const TELEGRAM_BETA_ADMIN_CHAT_ID =
  process.env.TELEGRAM_BETA_ADMIN_CHAT_ID || "";
const TELEGRAM_BETA_WEBHOOK_SECRET =
  process.env.TELEGRAM_BETA_WEBHOOK_SECRET || "";

type TgInlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
type TgInlineKeyboard = TgInlineButton[][];

interface TgCallbackQuery {
  id: string;
  from?: { id?: number | string };
  message?: { message_id?: number; chat?: { id?: number | string } };
  data?: string;
}

// 텔레그램 Bot API 호출(공통) — 토큰 없으면 스킵, 절대 throw 하지 않음.
async function tgCall(
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!TELEGRAM_BETA_BOT_TOKEN) return;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BETA_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[tg] ${method} 실패:`, resp.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn(`[tg] ${method} 예외:`, err);
  }
}

// 관리자 chatId 로 메시지 발송(옵션 인라인 키보드). chatId 미설정 시 스킵.
// 사용자 입력을 그대로 담으므로 parse_mode 없이 평문 전송(포맷 400/인젝션 회피).
async function tgSend(
  text: string,
  inlineKeyboard?: TgInlineKeyboard,
): Promise<void> {
  if (!TELEGRAM_BETA_ADMIN_CHAT_ID) return;
  const payload: Record<string, unknown> = {
    chat_id: TELEGRAM_BETA_ADMIN_CHAT_ID,
    text,
    disable_web_page_preview: true,
  };
  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  await tgCall("sendMessage", payload);
}

// 콜백 쿼리 로딩 상태 해제(+토스트 텍스트).
async function tgAnswerCallbackQuery(id: string, text: string): Promise<void> {
  await tgCall("answerCallbackQuery", { callback_query_id: id, text });
}

// 원 메시지 본문 교체 — 처리 결과(무엇을/언제)를 남긴다.
async function tgEditMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  await tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  });
}

// 사용자 텍스트를 max 자로 발췌(트림 + 말줄임).
function tgSummarize(v: unknown, max = 200): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ─── 트리거 1: 신규 신청 → 관리자 정보성 알림 ────────────────────────
export const notifyAdminOnWaitlistApply = functions.firestore
  .document("betatester50_waitlist/{docId}")
  .onCreate(async (snap) => {
    try {
      if (!TELEGRAM_BETA_BOT_TOKEN || !TELEGRAM_BETA_ADMIN_CHAT_ID) return;
      const data = snap.data() || {};
      const email = typeof data.email === "string" ? data.email : "";
      const name = typeof data.name === "string" ? data.name : "";
      const selectedCountSnap = await db
        .collection(FOUNDERS_COLLECTION)
        .where("status", "==", "selected")
        .count()
        .get();
      const selectedCount = selectedCountSnap.data().count;
      const lines = [
        "✅ 자동 선정 완료 — 조치 불필요",
        name ? `이름: ${name}` : "",
        `이메일: ${email || "(없음)"}`,
        `선정 코호트: ${selectedCount}명`,
      ].filter(Boolean);
      await tgSend(lines.join("\n"));
    } catch (err) {
      // 트리거 재시도 폭주 방지 — 알림 실패는 삼킨다.
      console.warn("[tg-waitlist] 알림 실패:", snap.id, err);
    }
  });

// ─── 트리거 2: 설문 제출 → 관리자 알림([예외 Pro3개월][/admin 정밀채점]) ──
export const notifyAdminOnFounderFeedback = functions.firestore
  .document("founder_feedback/{docId}")
  .onCreate(async (snap) => {
    try {
      if (!TELEGRAM_BETA_BOT_TOKEN || !TELEGRAM_BETA_ADMIN_CHAT_ID) return;
      const data = snap.data() || {};
      const email = typeof data.email === "string" ? data.email : "";
      const answers =
        data.answers && typeof data.answers === "object"
          ? (data.answers as Record<string, unknown>)
          : {};
      const q6 = tgSummarize(answers.q6, 80);
      const q1 = tgSummarize(answers.q1, 160);
      const lines = [
        "📝 파운더 설문 제출",
        `이메일: ${email || "(없음)"}`,
        q6 ? `q6: ${q6}` : "",
        q1 ? `q1: ${q1}` : "",
      ].filter(Boolean);
      await tgSend(lines.join("\n"), [
        [{ text: "⭐ 예외승인 Pro3개월", callback_data: `pro:${snap.id}` }],
        [{ text: "📝 /admin 정밀채점", url: `${SITE_BASE}/ko/admin` }],
      ]);
    } catch (err) {
      console.warn("[tg-feedback] 알림 실패:", snap.id, err);
    }
  });

// ─── 웹훅 핸들러: 선정(sel) ─────────────────────────────────────────
async function handleTgSelect(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string,
): Promise<void> {
  const snap = await db.collection("betatester50_waitlist").doc(docId).get();
  if (!snap.exists) {
    await tgAnswerCallbackQuery(cqId, "신청서를 찾을 수 없음");
    return;
  }
  const data = snap.data() || {};
  const email =
    typeof data.email === "string" ? normalizeEmail(data.email) : "";
  if (!email) {
    await tgAnswerCallbackQuery(cqId, "이메일 없음");
    return;
  }
  // 멱등: 이미 선정된 파운더면 재실행하지 않는다.
  const fSnap = await db.collection(FOUNDERS_COLLECTION).doc(email).get();
  if (fSnap.exists && fSnap.data()?.status === "selected") {
    await tgAnswerCallbackQuery(cqId, "이미 선정됨");
    if (messageId) {
      await tgEditMessageText(chatId, messageId, `✅ 이미 선정됨 — ${email}`);
    }
    return;
  }
  const result = await markFounderSelectedInternal(email);
  await tgAnswerCallbackQuery(cqId, "선정 완료");
  if (messageId) {
    const proNote = result.subscriptionGranted
      ? "Pro 즉시부여"
      : "Pro 가입시 자동부여";
    await tgEditMessageText(
      chatId,
      messageId,
      `✅ 선정 (1개월, ${proNote}, 접근이메일 ${
        result.emailSent ? "발송" : "발송 스킵"
      }) — ${email}\n처리: ${new Date().toISOString()}`,
    );
  }
}

// ─── 웹훅 핸들러: 스킵(skip) ────────────────────────────────────────
async function handleTgSkip(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string,
): Promise<void> {
  const ref = db.collection("betatester50_waitlist").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    await tgAnswerCallbackQuery(cqId, "신청서를 찾을 수 없음");
    return;
  }
  if (snap.data()?.skipped === true) {
    await tgAnswerCallbackQuery(cqId, "이미 스킵됨");
    return;
  }
  await ref.set(
    {
      skipped: true,
      skippedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await tgAnswerCallbackQuery(cqId, "스킵 처리됨");
  if (messageId) {
    await tgEditMessageText(
      chatId,
      messageId,
      `⏭️ 스킵됨 — 처리: ${new Date().toISOString()}`,
    );
  }
}

// ─── 웹훅 핸들러: 예외 Pro 3개월 부여(pro) ──────────────────────────
async function handleTgProGrant(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string,
): Promise<void> {
  const ref = db.collection(FOUNDER_FEEDBACK_COLLECTION).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    await tgAnswerCallbackQuery(cqId, "피드백을 찾을 수 없음");
    return;
  }
  const data = snap.data() || {};
  const userId = typeof data.userId === "string" ? data.userId : "";
  const email =
    typeof data.email === "string" ? normalizeEmail(data.email) : "";
  if (!userId || !email) {
    await tgAnswerCallbackQuery(cqId, "userId/email 누락");
    return;
  }
  // 멱등: 이미 Pro 부여된 피드백은 재부여하지 않는다.
  const existingGranted =
    typeof data.proGrantedMonths === "number" ? data.proGrantedMonths : 0;
  if (existingGranted > 0) {
    await tgAnswerCallbackQuery(cqId, "이미 부여됨");
    if (messageId) {
      await tgEditMessageText(
        chatId,
        messageId,
        `⭐ 이미 Pro 부여됨 (${existingGranted}개월) — ${email}`,
      );
    }
    return;
  }
  const proExpiresAt = await grantFounderProTotalInternal(
    userId,
    FOUNDER_PRO_MONTHS,
    "telegram_override",
    new Date(),
  );
  await ref.set(
    {
      proGrantedMonths: FOUNDER_PRO_MONTHS,
      proExpiresAt: admin.firestore.Timestamp.fromDate(proExpiresAt),
      reviewedBy: "telegram",
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db
    .collection(FOUNDERS_COLLECTION)
    .doc(email)
    .set(
      {
        proGrantedMonths: FOUNDER_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(proExpiresAt),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  await tgAnswerCallbackQuery(cqId, "Pro 3개월 부여 완료");
  if (messageId) {
    await tgEditMessageText(
      chatId,
      messageId,
      `⭐ Pro 3개월 부여 (예외승인) — ${email}\n처리: ${new Date().toISOString()}`,
    );
  }
}

// ─── 웹훅: 텔레그램 인라인 버튼 콜백 처리 ───────────────────────────
// setWebhook 시 secret_token 을 등록하고, 텔레그램이 매 요청 헤더로 돌려준다.
export const betaTelegramWebhook = functions.https.onRequest(
  async (req, res) => {
    // env 미설정이면 웹훅 자체가 동작 불가 — 503 으로 명시.
    if (
      !TELEGRAM_BETA_BOT_TOKEN ||
      !TELEGRAM_BETA_WEBHOOK_SECRET ||
      !TELEGRAM_BETA_ADMIN_CHAT_ID
    ) {
      res.status(503).send("telegram webhook not configured");
      return;
    }
    // 시크릿 헤더 검증 — 불일치면 즉시 401.
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== TELEGRAM_BETA_WEBHOOK_SECRET) {
      res.status(401).send("unauthorized");
      return;
    }

    try {
      const body = (req.body || {}) as { callback_query?: TgCallbackQuery };
      const cq = body.callback_query;
      // 콜백 쿼리 외 업데이트(메시지 등)는 무시하고 200.
      if (!cq || typeof cq.id !== "string") {
        res.status(200).send("ok");
        return;
      }

      const fromId = cq.from?.id != null ? String(cq.from.id) : "";
      const chatId =
        cq.message?.chat?.id != null ? String(cq.message.chat.id) : "";
      const messageId =
        typeof cq.message?.message_id === "number" ? cq.message.message_id : 0;

      // 관리자(chat/from) 아니면 무영향 처리.
      if (
        fromId !== TELEGRAM_BETA_ADMIN_CHAT_ID &&
        chatId !== TELEGRAM_BETA_ADMIN_CHAT_ID
      ) {
        await tgAnswerCallbackQuery(cq.id, "권한 없음");
        res.status(200).send("ok");
        return;
      }

      const raw = typeof cq.data === "string" ? cq.data : "";
      const sep = raw.indexOf(":");
      const action = sep >= 0 ? raw.slice(0, sep) : raw;
      const id = sep >= 0 ? raw.slice(sep + 1) : "";
      if (!id) {
        await tgAnswerCallbackQuery(cq.id, "잘못된 요청");
        res.status(200).send("ok");
        return;
      }

      if (action === "sel") {
        await handleTgSelect(cq.id, chatId, messageId, id);
      } else if (action === "skip") {
        await handleTgSkip(cq.id, chatId, messageId, id);
      } else if (action === "pro") {
        await handleTgProGrant(cq.id, chatId, messageId, id);
      } else {
        await tgAnswerCallbackQuery(cq.id, "알 수 없는 작업");
      }
    } catch (err) {
      console.error("[betaTelegramWebhook] 처리 실패:", err);
    }
    // 텔레그램 재전송 폭주 방지 — 어떤 경우에도 200.
    res.status(200).send("ok");
  },
);

// ─── 트리거: 신규 가입 → 선정된 베타 파운더면 Pro 구독 materialize ─────
//
// 선정(markFounderSelected/텔레그램 [선정])은 이메일 기준이라, 유저가 아직
// 미가입이면 uid 가 없어 subscriptions/{uid} 를 만들 수 없다. 선정 후 접근 이메일을
// 받고 유저가 가입하는 것이 일반적 순서이므로, 가입하는 순간 이 트리거가
// founders/{email} 을 조회해 베타/예외 부여 창(window)만큼 Pro 를 부여한다.
// (선정 시점에 이미 계정이 있으면 markFounderSelectedInternal 이 즉시 부여하고,
//  이 트리거는 그 케이스에서 발화하지 않는다 — 둘이 시점만 다른 동일 부여.)
// non-throwing: 부여 실패가 가입 자체를 깨면 안 된다.
export const grantBetaProOnSignup = functions.auth
  .user()
  .onCreate(async (user) => {
    try {
      if (!user.email) return;
      const email = normalizeEmail(user.email);
      const snap = await db.collection(FOUNDERS_COLLECTION).doc(email).get();
      if (!snap.exists) return;
      const fd = snap.data() || {};
      // 선정 기준 = getMyFounderAccess 와 동일(rejected 아님 + accessGrantedAt 존재).
      if (fd.status === "rejected" || !fd.accessGrantedAt) return;

      await materializeFounderProGrantForUid(
        snap.ref,
        fd,
        user.uid,
        "beta_signup",
        new Date(),
      );
    } catch (err) {
      console.warn("[grantBetaProOnSignup] 부여 실패:", user.uid, err);
    }
  });

// ─── 스케줄: 만료된 베타/파운더 부여(founder_grant) → free 강등 ────────
//
// 베타 Pro 는 1회성(자동 갱신 없음, scheduledChargeSubscriptions 는 toss 만 대상).
// currentPeriodEnd 경과 후 아무도 status 를 내리지 않으면 영구 Pro 가 되므로, 이
// 스윕이 만료된 founder_grant 구독의 status 를 canceled 로 내린다. 앱 getPlan 은
// status!=='active' → free 이고 실시간 리스너로 즉시 반영되므로 별도 앱 변경 불필요.
// 복합 인덱스 회피: paymentProvider 단일 동등 쿼리 + 코드 필터(기존 크론 선례).
export const scheduledExpireBetaGrants = functions.pubsub
  .schedule("15 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const nowMs = Date.now();
    const snap = await db
      .collection("subscriptions")
      .where("paymentProvider", "==", "founder_grant")
      .get();
    let expired = 0;
    for (const doc of snap.docs) {
      const sub = doc.data();
      if (sub.status !== "active") continue;
      const endMs = tsToMillis(sub.currentPeriodEnd);
      if (endMs == null || endMs > nowMs) continue;
      await doc.ref.set(
        {
          status: "canceled",
          canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      expired++;
    }
    console.log(
      `[expireBetaGrants] scanned=${snap.size} expired→canceled=${expired}`,
    );
    return null;
  });

// ============================================
// Admin Analytics Dashboard (v1) — 크로스유저 집계
// ============================================
// 기획: docs/analytics-dashboard-plan.md
//
// 기존 getCostSummary/getCostLogs 는 전부 `WHERE userId = @uid` 자기조회라
// 어드민 전체 집계가 불가능하다. 아래 콜러블은 그 uid 필터를 제거/그룹바이한
// requireAdmin 게이트 전용 집계기다.
//
// 프라이버시(§5): PII(이메일·이름·전화·개별 uid) 절대 미노출. 집계·카운트·비율만
// 반환하고 개별 row 는 내리지 않는다. events/task_outcomes/heartbeats 는 익명
// clientId 공간이므로 개인 식별을 시도하지 않는다.
//
// 데이터 세계 분리(§0):
//   (A) 사업 데이터 = Firestore(subscriptions/founders/waitlist) + BQ cost_logs
//       — 항상 켜짐, 식별 가능(신뢰축).
//   (B) 익명 제품사용 = BQ events/task_outcomes/agent_heartbeats
//       — 기본 OFF + 옵트인/도그푸드만 송신 → 프로덕션 희소(6/22 이후 공백).
//       콜러블은 빈 구간도 안전 처리하고, 표본 크기를 함께 반환해 UI 가
//       "옵트인 N 기준" 라벨을 달 수 있게 한다.

// 조회 기간(일)을 안전하게 파싱한다. 기본 30, 상한 365(BQ 스캔·비용 가드).
function parseAnalyticsDays(data: unknown, def = 30): number {
  const raw = (data as { days?: unknown } | null | undefined)?.days;
  const n = Number(raw ?? def);
  if (!Number.isInteger(n) || n <= 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "days must be a positive integer",
    );
  }
  return Math.min(n, 365);
}

// 드릴다운 대상 날짜(YYYY-MM-DD, UTC)를 안전하게 파싱한다.
function parseAnalyticsDate(data: unknown): string {
  const raw = (data as { date?: unknown } | null | undefined)?.date;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "date must be YYYY-MM-DD",
    );
  }
  return s;
}

// 드릴다운 세그먼트 키. 빈 값/과길이는 거절(BQ 파라미터로만 들어가므로 인젝션은
// 불가하지만, 무의미한 스캔을 막는다).
function parseSegmentKey(data: unknown): string {
  const raw = (data as { key?: unknown } | null | undefined)?.key;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 200) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "key is required (max 200 chars)",
    );
  }
  return s;
}

// ── 운영자(어드민) 자기계정 제외 ───────────────────────────────────────────────
// 대시보드는 "고객 지표"를 봐야 하는데 도그푸드 표본이 30 수준이라(§0-B) 운영자
// 본인 활동이 그대로 KPI 를 오염시킨다. 아래 헬퍼로 어드민 uid 를 집계에서 뺀다.
//
// ⚠️ ADMIN_UID 는 절대 응답/로그로 반환하지 않는다. 제외 "건수"만 노출한다.
//
// 소스별 제외 가능성(§0 데이터 세계 분리):
//   - Firestore subscriptions/agents/founders + BQ cost_logs → uid 를 직접
//     보관하므로 정확히 제외 가능.
//   - BQ events/task_outcomes → userId 컬럼이 익명 clientId 라 uid 로는 못
//     지운다. 단 cost_logs(uid 보유) 와 agentId 가 같은 공간이라, 어드민이
//     소유한 agentId 로 events 를 역참조하면 어드민 clientId 를 유추할 수 있다.
//     그 유추분만 제외한다(실패해도 대시보드는 살아야 하므로 fail-open).
const DEFAULT_DOGFOOD_UID = "RSALO1rljtWBSZ70MoBiaeFORxr1";

function getAdminExclusionUid(): string | null {
  const uid = process.env.ADMIN_UID?.trim();
  return uid ? uid : DEFAULT_DOGFOOD_UID;
}

// 어드민 uid 가 소유한 agentId → events.userId(익명 clientId) 역참조.
// 실패(권한/테이블 공백/스키마 드리프트)하면 빈 배열 — 제외를 포기하고 계속한다.
async function resolveAdminClientIds(rangeDays: number): Promise<string[]> {
  const adminUid = getAdminExclusionUid();
  if (!adminUid) return [];
  const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
  const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;
  // 조회 윈도우보다 넉넉히 뒤로 본다 — 어드민 clientId 는 윈도우 밖에서 이미
  // 확정돼 있을 수 있고, 놓치면 제외가 통째로 새어나간다.
  const lookbackDays = Math.min(Math.max(rangeDays, 90), 365);
  const query = `
    SELECT DISTINCT e.userId AS clientId
    FROM ${eventsTable} AS e
    JOIN (
      SELECT DISTINCT agentId
      FROM ${costTable}
      WHERE userId = @adminUid
        AND agentId IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
    ) AS c
    ON e.agentId = c.agentId
    WHERE e.userId IS NOT NULL
      AND e.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
    LIMIT 100
  `;
  try {
    const [rows] = await bigquery.query({
      query,
      params: { adminUid, lookbackDays },
      location: BQ_LOCATION,
    });
    return (rows as Array<Record<string, unknown>>)
      .map((r) => String(r.clientId ?? ""))
      .filter((s) => s.length > 0);
  } catch {
    // uid 와 원시 에러 메시지는 로그에도 남기지 않는다.
    console.warn(
      "[analytics] admin clientId resolution failed; proceeding without " +
        "telemetry self-exclusion",
    );
    return [];
  }
}

// 익명 텔레메트리 테이블용 제외 절 + 파라미터. clientId 가 하나도 없으면
// 빈 절을 돌려준다(빈 ARRAY 파라미터 타입 이슈 회피).
function adminClientExclusion(clientIds: string[]): {
  clause: string;
  params: Record<string, unknown>;
} {
  if (clientIds.length === 0) return { clause: "", params: {} };
  return {
    clause: " AND (userId IS NULL OR userId NOT IN UNNEST(@excludeClients))",
    params: { excludeClients: clientIds },
  };
}

// events 테이블 전용 제외 절. 신규 row 는 metadata.accountUserId 로 존킴/어드민을
// 정확 제외하고, 과거 row 는 clientId 역참조 목록으로 제외한다.
function adminEventExclusion(clientIds: string[]): {
  clause: string;
  params: Record<string, unknown>;
} {
  const clientEx = adminClientExclusion(clientIds);
  const adminUid = getAdminExclusionUid();
  if (!adminUid) return clientEx;
  return {
    clause:
      clientEx.clause +
      " AND (JSON_VALUE(metadata, '$.accountUserId') IS NULL" +
      " OR JSON_VALUE(metadata, '$.accountUserId') != @excludeAccountUserId)",
    params: { ...clientEx.params, excludeAccountUserId: adminUid },
  };
}

// cost_logs 는 실제 uid 를 보관 → 정확 제외.
function adminUidExclusion(): {
  clause: string;
  params: Record<string, unknown>;
} {
  const adminUid = getAdminExclusionUid();
  if (!adminUid) return { clause: "", params: {} };
  return {
    clause: " AND (userId IS NULL OR userId != @adminUid)",
    params: { adminUid },
  };
}

// BQ 집계 행을 { key → count } 분포로 접는다(빈 결과 안전).
function foldDistribution(
  rows: Array<Record<string, unknown>>,
  keyCol: string,
  countCol = "n",
): Array<{ key: string; count: number }> {
  return rows.map((r) => ({
    key: r[keyCol] == null || r[keyCol] === "" ? "(none)" : String(r[keyCol]),
    count: toNumber(r[countCol] as number | string | undefined),
  }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dayKeyFromMs(ms: number): string {
  return new Date(startOfUtcDay(ms)).toISOString().slice(0, 10);
}

function makeBusinessTrendBuckets(
  rangeDays: number,
  nowMs: number,
): Array<{ date: string; active: number; new: number; churned: number }> {
  const todayStartMs = startOfUtcDay(nowMs);
  const firstDayMs = todayStartMs - (rangeDays - 1) * DAY_MS;
  return Array.from({ length: rangeDays }, (_, i) => ({
    date: new Date(firstDayMs + i * DAY_MS).toISOString().slice(0, 10),
    active: 0,
    new: 0,
    churned: 0,
  }));
}

function isPaidPlan(plan: string): boolean {
  return plan === "pro" || plan === "team" || plan === "team_plus";
}

function isCurrentActiveSubscription(
  status: string,
  currentPeriodEndMs: number | null,
  nowMs: number,
): boolean {
  return (
    status === "active" &&
    currentPeriodEndMs != null &&
    currentPeriodEndMs > nowMs
  );
}

function activeAtDayEnd(
  status: string,
  createdMs: number | null,
  canceledMs: number | null,
  currentPeriodEndMs: number | null,
  dayEndMs: number,
): boolean {
  if (currentPeriodEndMs == null || currentPeriodEndMs <= dayEndMs)
    return false;
  if (createdMs != null && createdMs > dayEndMs) return false;
  if (status === "active") return true;
  return canceledMs != null && canceledMs > dayEndMs;
}

type ChargeLedgerRow = {
  userId: string;
  status: string;
  cycleAnchorMs: number;
};

type ConsecutiveBillingMetrics = {
  tossOnly: true;
  subscribers: number;
  maxCycleCount: number;
  averageCycleCount: number;
  byCycleCount: Record<string, number>;
  paddleGap: string;
};

function computeConsecutiveBillingMetrics(
  rows: ChargeLedgerRow[],
): ConsecutiveBillingMetrics {
  const byUser = new Map<string, ChargeLedgerRow[]>();
  for (const row of rows) {
    const existing = byUser.get(row.userId) || [];
    existing.push(row);
    byUser.set(row.userId, existing);
  }

  const byCycleCount: Record<string, number> = {};
  let subscribers = 0;
  let totalCycleCount = 0;
  let maxCycleCount = 0;

  for (const charges of byUser.values()) {
    charges.sort((a, b) => a.cycleAnchorMs - b.cycleAnchorMs);
    let currentStreak = 0;
    for (const charge of charges) {
      if (charge.status === "succeeded") {
        currentStreak++;
      } else if (charge.status === "failed") {
        currentStreak = 0;
      }
    }
    if (currentStreak < 2) continue;
    subscribers++;
    totalCycleCount += currentStreak;
    maxCycleCount = Math.max(maxCycleCount, currentStreak);
    const bucket = currentStreak >= 6 ? "6+" : String(currentStreak);
    byCycleCount[bucket] = (byCycleCount[bucket] || 0) + 1;
  }

  return {
    tossOnly: true,
    subscribers,
    maxCycleCount,
    averageCycleCount: subscribers > 0 ? totalCycleCount / subscribers : 0,
    byCycleCount,
    paddleGap:
      "billingCharges is populated by Toss billing-key charges; Paddle cycles are not represented in this ledger yet.",
  };
}

/**
 * getAdminBusinessSummary — 사업 KPI(🟢 Firestore, 항상 켜짐·식별 가능).
 *
 * subscriptions/founders/waitlist 를 카운트/비율로만 집계하고, agents 라이브
 * 로스터 + 롤링 비용을 덧붙인다. 이메일 등 PII 는 절대 select 하지 않는다.
 *
 * params: { days?: number } — 신규 가입/이탈 윈도우(기본 30).
 * returns: {
 *   rangeDays, generatedAt,
 *   subscriptions: { total, byStatus, byPlanActive, byProviderActive,
 *     paidProActive, founderGrantActive, newInWindow, churnedInWindow,
 *     activeCurrent, paidCurrent, trendByDay, consecutiveBilling,
 *     pastDue, proConversionRateVsSubscribers, proConversionRateVsWaitlist },
 *   founders: { total, accessGranted, interviewCompleted, feedbackSubmitted },
 *   waitlist: { total, newInWindow },
 *   agents: { liveCount, byStatus, rollingTotalCost, rollingTotalTokens },
 * }
 */
export const getAdminBusinessSummary = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const adminUid = getAdminExclusionUid();
    // 제외 건수만 집계(uid 자체는 절대 반환하지 않는다).
    const adminExcluded = {
      subscriptions: 0,
      billingCharges: 0,
      founders: 0,
      agents: 0,
    };
    const nowMs = Date.now();
    const cutoffMs = nowMs - rangeDays * DAY_MS;
    const trendByDay = makeBusinessTrendBuckets(rangeDays, nowMs);
    const trendIndex = new Map(trendByDay.map((d, i) => [d.date, i]));
    const firstTrendDayMs = startOfUtcDay(nowMs) - (rangeDays - 1) * DAY_MS;

    // ── 구독(subscriptions) — 티어/상태/제공자 분포 + 전환·이탈 ────────────
    const subSnap = await db.collection("subscriptions").limit(10000).get();
    const byStatus: Record<string, number> = {};
    const byPlanActive: Record<string, number> = {};
    const byProviderActive: Record<string, number> = {};
    let paidProActive = 0;
    let founderGrantActive = 0;
    let newInWindow = 0;
    let churnedInWindow = 0;
    let pastDue = 0;
    let activeCurrent = 0;
    let paidCurrent = 0;
    let paddleActiveCurrent = 0;

    for (const doc of subSnap.docs) {
      // subscriptions doc id == uid → 운영자 본인 구독은 KPI 에서 제외한다.
      if (adminUid && doc.id === adminUid) {
        adminExcluded.subscriptions++;
        continue;
      }
      const v = doc.data() as Record<string, unknown>;
      const status = typeof v.status === "string" ? v.status : "unknown";
      const plan = typeof v.planType === "string" ? v.planType : "unknown";
      const provider =
        typeof v.paymentProvider === "string" ? v.paymentProvider : "unknown";
      const currentPeriodEndMs = tsToMillis(v.currentPeriodEnd);

      byStatus[status] = (byStatus[status] || 0) + 1;
      if (status === "past_due") pastDue++;

      if (status === "active") {
        byPlanActive[plan] = (byPlanActive[plan] || 0) + 1;
        byProviderActive[provider] = (byProviderActive[provider] || 0) + 1;
        if (isPaidPlan(plan) && hasBillingPaymentEvidence(v)) {
          paidProActive++;
        }
        if (provider === "founder_grant") founderGrantActive++;
      }
      if (isCurrentActiveSubscription(status, currentPeriodEndMs, nowMs)) {
        activeCurrent++;
        if (isPaidPlan(plan) && hasBillingPaymentEvidence(v)) paidCurrent++;
        if (provider === "paddle") paddleActiveCurrent++;
      }

      const createdMs = tsToMillis(v.createdAt);
      if (createdMs != null && createdMs >= cutoffMs) {
        newInWindow++;
        const idx = trendIndex.get(dayKeyFromMs(createdMs));
        if (idx != null) trendByDay[idx].new++;
      }
      const canceledMs = tsToMillis(v.canceledAt);
      if (
        (status === "canceled" || status === "past_due") &&
        canceledMs != null &&
        canceledMs >= cutoffMs
      ) {
        churnedInWindow++;
        const idx = trendIndex.get(dayKeyFromMs(canceledMs));
        if (idx != null) trendByDay[idx].churned++;
      }

      for (let i = 0; i < trendByDay.length; i++) {
        const dayEndMs = firstTrendDayMs + i * DAY_MS + DAY_MS - 1;
        if (
          activeAtDayEnd(
            status,
            createdMs,
            canceledMs,
            currentPeriodEndMs,
            dayEndMs,
          )
        ) {
          trendByDay[i].active++;
        }
      }
    }

    const chargeSnap = await db.collection("billingCharges").limit(10000).get();
    const chargeRows: ChargeLedgerRow[] = [];
    for (const doc of chargeSnap.docs) {
      const v = doc.data() as Record<string, unknown>;
      const userId = typeof v.userId === "string" ? v.userId : "";
      if (adminUid && userId === adminUid) {
        adminExcluded.billingCharges++;
        continue;
      }
      const status = typeof v.status === "string" ? v.status : "";
      const cycleAnchorMs =
        typeof v.cycleAnchorMs === "number"
          ? v.cycleAnchorMs
          : tsToMillis(v.createdAt);
      if (!userId || !status || cycleAnchorMs == null) continue;
      chargeRows.push({ userId, status, cycleAnchorMs });
    }
    const consecutiveBilling = computeConsecutiveBillingMetrics(chargeRows);

    // ── 파운더(founders) ────────────────────────────────────────────────
    const founderSnap = await db
      .collection(FOUNDERS_COLLECTION)
      .limit(10000)
      .get();
    let accessGranted = 0;
    let interviewCompleted = 0;
    let feedbackSubmitted = 0;
    for (const doc of founderSnap.docs) {
      const v = doc.data() as Record<string, unknown>;
      // founders doc id 는 이메일 — 계정 연결(proSubscriptionUid)로만 식별된다.
      if (adminUid && v.proSubscriptionUid === adminUid) {
        adminExcluded.founders++;
        continue;
      }
      if (v.accessGrantedAt != null) accessGranted++;
      if (v.interviewCompleted === true) interviewCompleted++;
      if (v.feedbackSubmittedAt != null || v.feedbackId != null) {
        feedbackSubmitted++;
      }
    }

    // ── 대기자(waitlist) — 이메일 미노출, 카운트만 ────────────────────────
    const waitlistTotalSnap = await db
      .collection("betatester50_waitlist")
      .count()
      .get();
    const waitlistTotal = waitlistTotalSnap.data().count;
    // 신규 신청(윈도우) — createdAt 인덱스 존재(getFounderWaitlist orderBy 선례).
    const waitlistNewSnap = await db
      .collection("betatester50_waitlist")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(cutoffMs))
      .count()
      .get();
    const waitlistNewInWindow = waitlistNewSnap.data().count;

    // ── 에이전트 라이브 로스터 + 롤링 비용 ──────────────────────────────
    // ⚠️ agents/<id> 는 라이브 상태 doc(가변, 스폰당 불변 로그 아님) — 전체
    // 스폰 이력이 아니라 "현재 로스터 + 롤링 누적비용"만 신뢰 가능(§1.5).
    const agentSnap = await db.collection("agents").limit(10000).get();
    const agentsByStatus: Record<string, number> = {};
    let rollingTotalCost = 0;
    let rollingTotalTokens = 0;
    for (const doc of agentSnap.docs) {
      const v = doc.data() as Record<string, unknown>;
      if (adminUid && v.ownerId === adminUid) {
        adminExcluded.agents++;
        continue;
      }
      const status = typeof v.status === "string" ? v.status : "unknown";
      agentsByStatus[status] = (agentsByStatus[status] || 0) + 1;
      rollingTotalCost += toNumber(v.totalCost as number | undefined);
      const t =
        (v.totalTokens as number | undefined) ??
        ((v.totalInputTokens as number | undefined) ?? 0) +
          ((v.totalOutputTokens as number | undefined) ?? 0);
      rollingTotalTokens += toNumber(t as number | undefined);
    }

    // Pro 전환율(§2.1). "활성 사용자" 정확 분모는 익명 BQ 라 계정단위 불가 →
    // 신뢰 가능한 식별 분모(구독 총계·대기자)로 두 개의 비율을 명시 반환한다.
    // 분모도 운영자 제외분을 뺀 값이어야 비율이 왜곡되지 않는다.
    const subscriptionTotal = subSnap.size - adminExcluded.subscriptions;
    const founderTotal = founderSnap.size - adminExcluded.founders;
    const agentTotal = agentSnap.size - adminExcluded.agents;
    const proConversionRateVsSubscribers =
      subscriptionTotal > 0 ? paidProActive / subscriptionTotal : 0;
    const proConversionRateVsWaitlist =
      waitlistTotal > 0 ? paidProActive / waitlistTotal : 0;

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      // 운영자 자기계정 제외 — 제외 "건수"만(uid 미노출). UI 라벨용.
      adminExcluded,
      subscriptions: {
        total: subscriptionTotal,
        byStatus,
        byPlanActive,
        byProviderActive,
        paidProActive,
        founderGrantActive,
        activeCurrent,
        paidCurrent,
        paddleActiveCurrent,
        pastDue,
        newInWindow,
        churnedInWindow,
        trendByDay,
        consecutiveBilling,
        proConversionRateVsSubscribers,
        proConversionRateVsWaitlist,
      },
      founders: {
        total: founderTotal,
        accessGranted,
        interviewCompleted,
        feedbackSubmitted,
      },
      waitlist: {
        total: waitlistTotal,
        newInWindow: waitlistNewInWindow,
      },
      agents: {
        liveCount: agentTotal,
        byStatus: agentsByStatus,
        rollingTotalCost,
        rollingTotalTokens,
      },
    };
  },
);

/**
 * getAdminUsageSummary — 제품 사용/활성(🟡 BQ events + task_outcomes).
 *
 * userId 필터 없이 전체 집계. userId 컬럼은 익명 clientId 공간이므로 개인 식별을
 * 하지 않고, DISTINCT 카운트(표본 크기)만 노출한다. 표본이 옵트인/도그푸드
 * 편향임을 UI 가 라벨할 수 있도록 sampleClientCount 를 함께 반환한다.
 * 6/22 이후 데이터 공백이어도 전부 빈 배열/0 으로 안전 반환.
 *
 * params: { days?: number } (기본 30)
 */
export const getAdminUsageSummary = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const outcomesTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_TASK_OUTCOMES_TABLE}\``;
    const since = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    // 운영자 자기활동 제외 — cost_logs 로 역참조한 어드민 clientId 만 뺀다.
    // includeAdmin(기본 false)=제외, true=포함. 포함 모드에서도 clientId 는 계속
    // 해석해서 "제외했다면 몇 개가 빠졌을지"를 adminExcluded 로 노출한다(두 수치 비교).
    const includeAdmin = parseIncludeAdmin(data);
    // 분포 렌즈 — 'events'(COUNT(*), 기본) vs 'clients'(COUNT(DISTINCT userId)).
    // 상위이벤트·스폰(역할/모델)별 3개 분포에만 적용한다(DAU/스폰추이/태스크는
    // 이미 고정 의미라 무관). userId = 익명 clientId, 개인식별 아님(카운트만).
    const metricMode = parseMetricMode(data);
    const metricExpr = metricCountExpr(metricMode, "userId");
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const ex = includeAdmin
      ? EMPTY_EXCLUSION
      : adminEventExclusion(adminClientIds);
    // BQ events/task_outcomes 의 timestamp/completedAt 은 STRING 으로 적재돼
    // 있어 TIMESTAMP 리터럴과 직접 비교하면 타입 불일치로 쿼리가 실패한다.
    // SAFE_CAST 로 감싸 비교·DATE() 추출이 동작하게 한다(파싱 실패는 NULL→제외).
    const eventTs = "SAFE_CAST(timestamp AS TIMESTAMP)";
    const completedAtTs = "SAFE_CAST(completedAt AS TIMESTAMP)";

    // DAU(일별 고유 clientId) + 일별 총 이벤트(히스토리 사용량)
    const activeByDayQuery = `
      SELECT
        FORMAT_DATE('%F', DATE(${eventTs})) AS date,
        COUNT(DISTINCT userId) AS dau,
        COUNT(*) AS events
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}${ex.clause}
      GROUP BY date
      ORDER BY date ASC
    `;
    // WAU + 윈도우 전체 표본 크기(고유 clientId)
    const sampleQuery = `
      SELECT
        COUNT(DISTINCT userId) AS sampleClients,
        COUNT(DISTINCT IF(
          ${eventTs} >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY),
          userId, NULL)) AS wau
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}${ex.clause}
    `;
    // 상위 이벤트 랭킹 — metricMode 로 count 식 결정(events=COUNT(*),
    // clients=COUNT(DISTINCT userId)). clients 모드에선 정렬도 같은 식 기준.
    const topEventsQuery = `
      SELECT COALESCE(event, '(none)') AS event, ${metricExpr} AS n
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}${ex.clause}
      GROUP BY event
      ORDER BY n DESC
      LIMIT 25
    `;
    // 에이전트 스폰수(일별=고정 COUNT(*) 추이; 역할별·모델별=metricMode 적용)
    const spawnsByDayQuery = `
      SELECT FORMAT_DATE('%F', DATE(${eventTs})) AS date, COUNT(*) AS n
      FROM ${eventsTable}
      WHERE event = 'agent:spawned' AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY date ORDER BY date ASC
    `;
    const spawnsByRoleQuery = `
      SELECT role AS key, ${metricExpr} AS n
      FROM ${eventsTable}
      WHERE event = 'agent:spawned' AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY role ORDER BY n DESC
    `;
    const spawnsByModelQuery = `
      SELECT model AS key, ${metricExpr} AS n
      FROM ${eventsTable}
      WHERE event = 'agent:spawned' AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY model ORDER BY n DESC
    `;
    // 태스크 성공률·완료시간(task_outcomes 전체)
    const taskSummaryQuery = `
      SELECT
        COUNT(*) AS total,
        COUNTIF(success = true) AS succeeded,
        AVG(durationMs) AS avgDurationMs
      FROM ${outcomesTable}
      WHERE ${completedAtTs} >= ${since}${ex.clause}
    `;

    const params = { days: rangeDays, ...ex.params };
    const q = (query: string) =>
      bigquery.query({ query, params, location: BQ_LOCATION });

    const [
      [activeByDayRows],
      [sampleRows],
      [topEventsRows],
      [spawnsByDayRows],
      [spawnsByRoleRows],
      [spawnsByModelRows],
      [taskSummaryRows],
    ] = await Promise.all([
      q(activeByDayQuery),
      q(sampleQuery),
      q(topEventsQuery),
      q(spawnsByDayQuery),
      q(spawnsByRoleQuery),
      q(spawnsByModelQuery),
      q(taskSummaryQuery),
    ]);

    const activeByDay = (activeByDayRows as Array<Record<string, unknown>>).map(
      (r) => ({
        date: String(r.date ?? ""),
        dau: toNumber(r.dau as number | string | undefined),
        events: toNumber(r.events as number | string | undefined),
      }),
    );
    const sample = (sampleRows as Array<Record<string, unknown>>)[0] ?? {};
    const taskRow =
      (taskSummaryRows as Array<Record<string, unknown>>)[0] ?? {};
    const taskTotal = toNumber(taskRow.total as number | string | undefined);
    const taskSucceeded = toNumber(
      taskRow.succeeded as number | string | undefined,
    );

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      // 분포(상위이벤트·스폰역할·스폰모델)에 적용된 렌즈 — web 이 세그먼트 라벨링.
      metricMode,
      // 운영자 제외 현황 — clientId 값은 노출하지 않고 개수만.
      // applied=이번 응답에 실제로 제외가 적용됐는지(토글 상태). false 면 전체 포함.
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      // 표본 신뢰도 라벨링(§0-B, T0-3): 옵트인/도그푸드 편향 표본 크기.
      sampleClientCount: toNumber(
        sample.sampleClients as number | string | undefined,
      ),
      wau: toNumber(sample.wau as number | string | undefined),
      activeByDay,
      topEvents: foldDistribution(
        topEventsRows as Array<Record<string, unknown>>,
        "event",
      ),
      spawnsByDay: (spawnsByDayRows as Array<Record<string, unknown>>).map(
        (r) => ({
          date: String(r.date ?? ""),
          count: toNumber(r.n as number | string | undefined),
        }),
      ),
      spawnsByRole: foldDistribution(
        spawnsByRoleRows as Array<Record<string, unknown>>,
        "key",
      ),
      spawnsByModel: foldDistribution(
        spawnsByModelRows as Array<Record<string, unknown>>,
        "key",
      ),
      tasks: {
        total: taskTotal,
        succeeded: taskSucceeded,
        successRate: taskTotal > 0 ? taskSucceeded / taskTotal : 0,
        avgDurationMs: toNumber(
          taskRow.avgDurationMs as number | string | undefined,
        ),
      },
    };
  },
);

/**
 * getAdminOnboardingFunnel — 온보딩 24h 활성화 퍼널(🟡 BQ events).
 *
 * app:first_run → auth:login_attempt → auth:login_success →
 * onboarding:folder_connected → onboarding:orchestrator_opened → agent:spawned
 * 의 단계별 순차 도달 고유 identity(accountUserId 우선, 과거 clientId 폴백)와
 * 인접 단계 이탈을 집계하고, 실패-분기
 * (login_failed / folder_connect_failed / orchestrator_blocked / agent:crashed)를
 * errorCategory 로 분해한다(★orchestrator_blocked 의 cli_auth vs launch_error 등).
 *
 * 측정·한계는 buildOnboardingFunnel 의 note 참조(auth-gated flush).
 * 신규 row 는 서버가 metadata.accountUserId 를 주입해 계정 기준으로 dedup 하고,
 * 과거 row 는 익명 clientId 로 폴백한다. 운영자 제외는 includeAdmin(기본 false=제외)
 * 토글을 따른다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 제외)
 */
export const getAdminOnboardingFunnel = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const since = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    const includeAdmin = parseIncludeAdmin(data);
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const ex = includeAdmin
      ? EMPTY_EXCLUSION
      : adminEventExclusion(adminClientIds);
    // events.timestamp 는 BigQuery TIMESTAMP 컬럼이다. 컬럼을 함수로 감싸면
    // 파티션/클러스터 프루닝이 약해질 수 있어 직접 비교한다.
    const eventTs = "timestamp";

    // 순차 퍼널: identity(accountUserId 우선, 과거 row 는 익명 clientId 폴백)별
    // 최초 이벤트 시각을 만든 뒤, 각 단계가 직전 단계 이후에 발생한 사용자만 센다.
    // 가입~활성화 창은 24h 로 현실화한다. d_task_completed 는 헤드라인 분자와 같다.
    const funnelEventNames = Array.from(
      new Set([
        ...ONBOARDING_FUNNEL_STEPS.map((s) => s.event),
        ...ONBOARDING_FAILURE_EVENTS.map((f) => f.event),
      ]),
    );
    const inList = funnelEventNames.map((_, i) => `@ev${i}`).join(", ");
    const eventParams: Record<string, unknown> = {};
    funnelEventNames.forEach((name, i) => {
      eventParams[`ev${i}`] = name;
    });

    const funnelQuery = `
      WITH raw AS (
        SELECT
          COALESCE(NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''), userId)
            AS identity,
          event,
          ${eventTs} AS ts,
          DATE(${eventTs}) AS activity_date,
          projectId
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${since}
          AND event IN (${inList})
          AND userId IS NOT NULL${ex.clause}
      ),
      marks AS (
        SELECT
          identity,
          MIN(IF(event = 'app:first_run', ts, NULL)) AS first_run_ts,
          MIN(IF(event = 'auth:login_attempt', ts, NULL)) AS login_attempt_ts,
          MIN(IF(event = 'auth:login_success', ts, NULL)) AS login_success_ts,
          MIN(IF(event = 'onboarding:folder_connected', ts, NULL))
            AS folder_connected_ts,
          MIN(IF(event = 'onboarding:orchestrator_opened', ts, NULL))
            AS orchestrator_opened_ts,
          MIN(IF(event = 'agent:spawned', ts, NULL)) AS agent_spawned_ts,
          MIN(IF(event = 'task:completed', ts, NULL)) AS task_completed_ts,
          COUNTIF(event = 'app:first_run') AS n_first_run,
          COUNTIF(event = 'auth:login_attempt') AS n_login_attempt,
          COUNTIF(event = 'auth:login_success') AS n_login_success,
          COUNTIF(event = 'onboarding:folder_connected') AS n_folder_connected,
          COUNTIF(event = 'onboarding:orchestrator_opened')
            AS n_orchestrator_opened,
          COUNTIF(event = 'agent:spawned') AS n_agent_spawned,
          COUNTIF(event = 'task:completed') AS n_task_completed,
          COUNTIF(event = 'auth:login_failed') AS n_login_failed,
          COUNTIF(event = 'onboarding:folder_connect_failed')
            AS n_folder_connect_failed,
          COUNTIF(event = 'onboarding:orchestrator_blocked')
            AS n_orchestrator_blocked,
          COUNTIF(event = 'agent:crashed') AS n_agent_crashed
        FROM raw
        GROUP BY identity
      ),
      seq AS (
        SELECT
          *,
          first_run_ts IS NOT NULL AS reached_first_run,
          first_run_ts IS NOT NULL
            AND login_attempt_ts BETWEEN first_run_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AS reached_login_attempt,
          first_run_ts IS NOT NULL
            AND login_attempt_ts BETWEEN first_run_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND login_success_ts BETWEEN login_attempt_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AS reached_login_success,
          first_run_ts IS NOT NULL
            AND login_attempt_ts BETWEEN first_run_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND login_success_ts BETWEEN login_attempt_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_success_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AS reached_folder_connected,
          first_run_ts IS NOT NULL
            AND login_attempt_ts BETWEEN first_run_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND login_success_ts BETWEEN login_attempt_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_success_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AND orchestrator_opened_ts BETWEEN folder_connected_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AS reached_orchestrator_opened,
          first_run_ts IS NOT NULL
            AND login_attempt_ts BETWEEN first_run_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND login_success_ts BETWEEN login_attempt_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_success_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AND orchestrator_opened_ts BETWEEN folder_connected_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AND agent_spawned_ts BETWEEN orchestrator_opened_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AS reached_agent_spawned,
          first_run_ts IS NOT NULL
            AND login_attempt_ts BETWEEN first_run_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND login_success_ts BETWEEN login_attempt_ts
              AND TIMESTAMP_ADD(first_run_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_success_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AND orchestrator_opened_ts BETWEEN folder_connected_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AND agent_spawned_ts BETWEEN orchestrator_opened_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AND task_completed_ts BETWEEN agent_spawned_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AS reached_task_completed
        FROM marks
      ),
      sessions AS (
        SELECT
          r.identity,
          COUNT(DISTINCT CONCAT(
            COALESCE(r.projectId, '(none)'),
            ':',
            FORMAT_DATE('%F', r.activity_date)
          )) AS sessionish_count,
          COUNT(DISTINCT r.projectId) AS project_count
        FROM raw r
        JOIN seq s ON s.identity = r.identity
        WHERE s.reached_task_completed
          AND r.ts BETWEEN s.login_success_ts
            AND TIMESTAMP_ADD(s.login_success_ts, INTERVAL 7 DAY)
        GROUP BY r.identity
      )
      SELECT
        COUNTIF(reached_first_run) AS d_first_run,
        SUM(IF(reached_first_run, n_first_run, 0)) AS n_first_run,
        COUNTIF(reached_login_attempt) AS d_login_attempt,
        SUM(IF(reached_login_attempt, n_login_attempt, 0)) AS n_login_attempt,
        COUNTIF(reached_login_success) AS d_login_success,
        SUM(IF(reached_login_success, n_login_success, 0)) AS n_login_success,
        COUNTIF(reached_folder_connected) AS d_folder_connected,
        SUM(IF(reached_folder_connected, n_folder_connected, 0))
          AS n_folder_connected,
        COUNTIF(reached_orchestrator_opened) AS d_orchestrator_opened,
        SUM(IF(reached_orchestrator_opened, n_orchestrator_opened, 0))
          AS n_orchestrator_opened,
        COUNTIF(reached_agent_spawned) AS d_agent_spawned,
        SUM(IF(reached_agent_spawned, n_agent_spawned, 0)) AS n_agent_spawned,
        COUNTIF(reached_task_completed) AS d_task_completed,
        SUM(IF(reached_task_completed, n_task_completed, 0))
          AS n_task_completed,
        COUNTIF(reached_task_completed AND n_agent_spawned >= 2)
          AS d_core_experience,
        COUNTIF(reached_task_completed AND (
          SELECT COALESCE(MAX(
            IF(sessionish_count >= 2 OR project_count >= 2, 1, 0)
          ), 0)
          FROM sessions ss
          WHERE ss.identity = seq.identity
        ) = 1) AS d_retained_7d,
        COUNTIF(n_login_failed > 0) AS d_login_failed,
        SUM(n_login_failed) AS n_login_failed,
        COUNTIF(n_folder_connect_failed > 0) AS d_folder_connect_failed,
        SUM(n_folder_connect_failed) AS n_folder_connect_failed,
        COUNTIF(n_orchestrator_blocked > 0) AS d_orchestrator_blocked,
        SUM(n_orchestrator_blocked) AS n_orchestrator_blocked,
        COUNTIF(n_agent_crashed > 0) AS d_agent_crashed,
        SUM(n_agent_crashed) AS n_agent_crashed,
        COUNTIF(reached_login_success) AS d_signup_base,
        COUNTIF(reached_task_completed) AS d_activated_30m
      FROM seq
    `;

    // 실패 이벤트의 errorCategory 분해(cli_auth / launch_error / crash 카테고리 등).
    const failureInList = ONBOARDING_FAILURE_EVENTS.map(
      (_, i) => `@fev${i}`,
    ).join(", ");
    const failureParams: Record<string, unknown> = {};
    ONBOARDING_FAILURE_EVENTS.forEach((f, i) => {
      failureParams[`fev${i}`] = f.event;
    });
    const reasonQuery = `
      SELECT
        event,
        COALESCE(errorCategory, '(none)') AS category,
        COUNT(*) AS n,
        COUNT(DISTINCT COALESCE(
          NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''),
          userId
        )) AS clients
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}
        AND event IN (${failureInList})${ex.clause}
      GROUP BY event, category
      ORDER BY n DESC
    `;

    const [funnelRows, reasonRows] = await runAdminAnalyticsQueries([
      {
        name: "onboarding.funnel",
        query: funnelQuery,
        params: { days: rangeDays, ...eventParams, ...ex.params },
      },
      {
        name: "onboarding.failureReasons",
        query: reasonQuery,
        params: { days: rangeDays, ...failureParams, ...ex.params },
      },
    ]);

    const funnel = buildOnboardingFunnel(
      funnelRows[0] as Record<string, unknown> | undefined,
      reasonRows as ReasonRow[],
    );

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      ...funnel,
    };
  });

/**
 * getAdminRetentionCohorts — account user 기준 리텐션 코호트 + 순차 활성화 게이트.
 *
 * 활성유저 identity 규칙:
 *   - cost_logs.userId 는 clean account uid 로 사용한다.
 *   - events.userId 는 agent/client UUID 오염이 있어 사용하지 않고,
 *     metadata.accountUserId 가 있는 row 만 account activity 로 본다.
 *   - ADMIN_UID 와 UUID 형태 agent identity 는 제외한다(includeAdmin=true 면 ADMIN_UID 포함).
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 제외)
 */
export const getAdminRetentionCohorts = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const lookbackDays = Math.min(rangeDays + 35, 400);
    const includeAdmin = parseIncludeAdmin(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;
    const adminUid = getAdminExclusionUid();
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const adminClause =
      !includeAdmin && adminUid ? " AND user_id != @excludeAccountUserId" : "";
    const adminParams =
      !includeAdmin && adminUid ? { excludeAccountUserId: adminUid } : {};
    const identityCleanClause = `
      AND user_id IS NOT NULL
      AND user_id != ''
      AND NOT REGEXP_CONTAINS(
        user_id,
        r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      )${adminClause}
    `;

    const activityCte = `
      WITH activity AS (
        SELECT
          NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') AS user_id,
          timestamp AS ts,
          DATE(timestamp) AS active_date,
          event
        FROM ${eventsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
          AND NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') IS NOT NULL
        UNION ALL
        SELECT
          userId AS user_id,
          SAFE_CAST(timestamp AS TIMESTAMP) AS ts,
          DATE(SAFE_CAST(timestamp AS TIMESTAMP)) AS active_date,
          'cost:usage' AS event
        FROM ${costTable}
        WHERE SAFE_CAST(timestamp AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
          AND userId IS NOT NULL
      ),
      clean_activity AS (
        SELECT user_id, ts, active_date, event
        FROM activity
        WHERE ts IS NOT NULL${identityCleanClause}
      )
    `;

    const retentionQuery = `
      ${activityCte},
      firsts AS (
        SELECT user_id, MIN(active_date) AS first_active_date
        FROM clean_activity
        GROUP BY user_id
      ),
      cohorts AS (
        SELECT user_id, first_active_date
        FROM firsts
        WHERE first_active_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
      ),
      user_returns AS (
        SELECT
          c.user_id,
          c.first_active_date,
          MAX(IF(a.active_date = DATE_ADD(c.first_active_date, INTERVAL 1 DAY), 1, 0)) AS d1,
          MAX(IF(a.active_date = DATE_ADD(c.first_active_date, INTERVAL 7 DAY), 1, 0)) AS d7,
          MAX(IF(a.active_date = DATE_ADD(c.first_active_date, INTERVAL 14 DAY), 1, 0)) AS d14,
          MAX(IF(a.active_date = DATE_ADD(c.first_active_date, INTERVAL 30 DAY), 1, 0)) AS d30
        FROM cohorts c
        LEFT JOIN clean_activity a ON a.user_id = c.user_id
        GROUP BY c.user_id, c.first_active_date
      )
      SELECT
        'day' AS period,
        FORMAT_DATE('%F', first_active_date) AS cohort,
        COUNT(*) AS cohortUsers,
        SUM(d1) AS d1Users,
        SUM(d7) AS d7Users,
        SUM(d14) AS d14Users,
        SUM(d30) AS d30Users
      FROM user_returns
      GROUP BY cohort
      UNION ALL
      SELECT
        'week' AS period,
        FORMAT_DATE('%F', DATE_TRUNC(first_active_date, WEEK(MONDAY))) AS cohort,
        COUNT(*) AS cohortUsers,
        SUM(d1) AS d1Users,
        SUM(d7) AS d7Users,
        SUM(d14) AS d14Users,
        SUM(d30) AS d30Users
      FROM user_returns
      GROUP BY cohort
    `;

    const gateEventNames = Array.from(
      new Set(ACTIVATION_GATE_STEPS.map((s) => s.event)),
    );
    const gateInList = gateEventNames.map((_, i) => `@gateEv${i}`).join(", ");
    const gateParams: Record<string, unknown> = {};
    gateEventNames.forEach((name, i) => {
      gateParams[`gateEv${i}`] = name;
    });
    const gateQuery = `
      WITH raw AS (
        SELECT
          NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') AS user_id,
          event,
          timestamp AS ts
        FROM ${eventsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
          AND event IN (${gateInList})
          AND NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') IS NOT NULL
      ),
      clean AS (
        SELECT user_id, event, ts
        FROM raw
        WHERE ts IS NOT NULL${identityCleanClause}
      ),
      marks AS (
        SELECT
          user_id,
          COALESCE(
            MIN(IF(event = 'app:installed', ts, NULL)),
            MIN(IF(event = 'app:first_run', ts, NULL))
          ) AS install_ts,
          MIN(IF(event = 'app:first_run', ts, NULL)) AS first_run_ts,
          MIN(IF(event = 'auth:login_success', ts, NULL)) AS login_ts,
          MIN(IF(event = 'onboarding:folder_connected', ts, NULL)) AS folder_connected_ts,
          MIN(IF(event = 'onboarding:orchestrator_opened', ts, NULL)) AS orchestrator_opened_ts,
          MIN(IF(event = 'agent:spawned', ts, NULL)) AS agent_spawned_ts,
          MIN(IF(event = 'task:completed', ts, NULL)) AS first_ticket_complete_ts
        FROM clean
        GROUP BY user_id
      ),
      seq AS (
        SELECT
          *,
          install_ts IS NOT NULL AS reached_install,
          install_ts IS NOT NULL
            AND first_run_ts BETWEEN install_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AS reached_first_run,
          install_ts IS NOT NULL
            AND first_run_ts BETWEEN install_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND login_ts BETWEEN first_run_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AS reached_login,
          install_ts IS NOT NULL
            AND first_run_ts BETWEEN install_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND login_ts BETWEEN first_run_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AS reached_folder_connected,
          install_ts IS NOT NULL
            AND first_run_ts BETWEEN install_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND login_ts BETWEEN first_run_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AND orchestrator_opened_ts BETWEEN folder_connected_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AS reached_orchestrator_opened,
          install_ts IS NOT NULL
            AND first_run_ts BETWEEN install_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND login_ts BETWEEN first_run_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AND orchestrator_opened_ts BETWEEN folder_connected_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AND agent_spawned_ts BETWEEN orchestrator_opened_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AS reached_agent_spawned,
          install_ts IS NOT NULL
            AND first_run_ts BETWEEN install_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND login_ts BETWEEN first_run_ts AND TIMESTAMP_ADD(install_ts, INTERVAL 24 HOUR)
            AND folder_connected_ts BETWEEN login_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AND orchestrator_opened_ts BETWEEN folder_connected_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AND agent_spawned_ts BETWEEN orchestrator_opened_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AND first_ticket_complete_ts BETWEEN agent_spawned_ts AND TIMESTAMP_ADD(login_ts, INTERVAL 24 HOUR)
            AS reached_first_ticket_complete
        FROM marks
      )
      SELECT
        COUNTIF(reached_install) AS d_install,
        COUNTIF(reached_first_run) AS d_first_run,
        COUNTIF(reached_login) AS d_login,
        COUNTIF(reached_folder_connected) AS d_folder_connected,
        COUNTIF(reached_orchestrator_opened) AS d_orchestrator_opened,
        COUNTIF(reached_agent_spawned) AS d_agent_spawned,
        COUNTIF(reached_first_ticket_complete) AS d_first_ticket_complete
      FROM seq
    `;

    const params = {
      days: rangeDays,
      lookbackDays,
      ...adminParams,
    };
    const [cohortRows, gateRows] = await runAdminAnalyticsQueries([
      { name: "retention.cohorts", query: retentionQuery, params },
      {
        name: "retention.activationGate",
        query: gateQuery,
        params: { lookbackDays, ...gateParams, ...adminParams },
      },
    ]);

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      cohorts: buildRetentionCohorts(
        cohortRows as RetentionCohortSourceRow[],
      ),
      activationGate: buildActivationGateFunnel(gateRows[0]),
    };
  });

/**
 * getAdminActiveUserMetrics — DAU/WAU/MAU stickiness + 30일+ 잔존 추이.
 *
 * getAdminUsageSummary 의 activeByDay 의미를 account user 기준으로 재구성한다.
 * events.userId 는 쓰지 않고 metadata.accountUserId 와 cost_logs.userId 만 합산한다.
 */
export const getAdminActiveUserMetrics = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const lookbackDays = Math.min(Math.max(rangeDays + 35, 65), 400);
    const includeAdmin = parseIncludeAdmin(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;
    const adminUid = getAdminExclusionUid();
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const adminClause =
      !includeAdmin && adminUid ? " AND user_id != @excludeAccountUserId" : "";
    const adminParams =
      !includeAdmin && adminUid ? { excludeAccountUserId: adminUid } : {};
    const identityCleanClause = `
      AND user_id IS NOT NULL
      AND user_id != ''
      AND NOT REGEXP_CONTAINS(
        user_id,
        r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      )${adminClause}
    `;
    const activityCte = `
      WITH activity AS (
        SELECT
          NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') AS user_id,
          timestamp AS ts,
          DATE(timestamp) AS active_date
        FROM ${eventsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
          AND NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') IS NOT NULL
        UNION ALL
        SELECT
          userId AS user_id,
          SAFE_CAST(timestamp AS TIMESTAMP) AS ts,
          DATE(SAFE_CAST(timestamp AS TIMESTAMP)) AS active_date
        FROM ${costTable}
        WHERE SAFE_CAST(timestamp AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookbackDays DAY)
          AND userId IS NOT NULL
      ),
      clean_activity AS (
        SELECT user_id, ts, active_date
        FROM activity
        WHERE ts IS NOT NULL${identityCleanClause}
      )
    `;

    const activeByDayQuery = `
      ${activityCte}
      SELECT
        FORMAT_DATE('%F', active_date) AS date,
        COUNT(DISTINCT user_id) AS dau,
        COUNT(*) AS events
      FROM clean_activity
      WHERE active_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
      GROUP BY date
      ORDER BY date ASC
    `;
    const scalarQuery = `
      ${activityCte}
      SELECT
        COUNT(DISTINCT IF(active_date = CURRENT_DATE(), user_id, NULL)) AS dau,
        COUNT(DISTINCT IF(
          active_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY),
          user_id, NULL
        )) AS wau,
        COUNT(DISTINCT IF(
          active_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY),
          user_id, NULL
        )) AS mau
      FROM clean_activity
    `;
    const thirtyDayRetentionQuery = `
      ${activityCte},
      firsts AS (
        SELECT user_id, MIN(active_date) AS first_active_date
        FROM clean_activity
        GROUP BY user_id
      )
      SELECT
        FORMAT_DATE('%F', first_active_date) AS date,
        COUNT(*) AS eligibleUsers,
        COUNT(DISTINCT IF(a.active_date > DATE_ADD(f.first_active_date, INTERVAL 30 DAY), f.user_id, NULL))
          AS retainedUsers
      FROM firsts f
      LEFT JOIN clean_activity a ON a.user_id = f.user_id
      WHERE f.first_active_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
        AND f.first_active_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
      GROUP BY date
      ORDER BY date ASC
    `;

    const params = {
      days: rangeDays,
      lookbackDays,
      ...adminParams,
    };
    const [activeRows, scalarRows, retentionRows] =
      await runAdminAnalyticsQueries([
        { name: "activeUsers.byDay", query: activeByDayQuery, params },
        { name: "activeUsers.scalars", query: scalarQuery, params },
        {
          name: "activeUsers.thirtyDayRetention",
          query: thirtyDayRetentionQuery,
          params,
        },
      ]);

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      ...buildActiveUserMetrics(
        activeRows as ActiveByDaySourceRow[],
        scalarRows[0],
        retentionRows as ThirtyDayRetentionSourceRow[],
      ),
    };
  });

/**
 * getAdminKpiCockpit — 지표기반 베타종료 게이지 + 신규 온보딩 이벤트(설문·데모·
 * 동의·CLI셋업) + 재사용/리텐션 + 스폰 헬스(🟡 BQ events).
 *
 * mDzHRyX4(온보딩 퍼널) 위에 확장한 별도 콜러블 — 기존 콜러블은 손대지 않아
 * 하위호환을 유지한다. 순수 조립은 adminAnalytics.buildKpiCockpit 이 담당하고,
 * 여기선 BQ 스칼라/분포만 뽑아 넘긴다.
 *
 * ★신규 온보딩 이벤트(onboarding:cli_setup_step·survey_first_project·survey_cli_fail·
 * demo_started/completed/cta_click·marketing_consent_shown/granted)는 3.0.19 렌더러
 * 빌드+실사용 전엔 값 0 — 쿼리는 미발화여도 안전하게 0/빈배열을 돌려준다(구조 먼저).
 *
 * 신규 row 는 accountUserId 기준, 과거 row 는 익명 clientId 기준으로 카운트한다.
 * 개별 uid/clientId 는 미노출하며, 운영자 제외는 includeAdmin(기본 false=제외)
 * 토글을 따른다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 제외)
 */
export const getAdminKpiCockpit = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const since = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    const week = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)";
    const includeAdmin = parseIncludeAdmin(data);
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const ex = includeAdmin
      ? EMPTY_EXCLUSION
      : adminEventExclusion(adminClientIds);
    // events.timestamp 는 BigQuery TIMESTAMP 컬럼이다. 컬럼을 함수로 감싸면
    // 파티션/클러스터 프루닝이 약해질 수 있어 직접 비교한다.
    const eventTs = "timestamp";

    // ── (1) 헤드라인: 가입(login_success) 후 24h내 첫 티켓 완료 활성화율 ──
    // 게이지 분모(d_signup_base) + 분자(d_activated_30m). getAdminOnboardingFunnel
    // 의 headlineQuery 와 동일 로직(단일 소스 오브 트루스는 순수 빌더 쪽 규약).
    const headlineQuery = `
      WITH raw AS (
        SELECT
          COALESCE(NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''), userId)
            AS identity,
          event,
          ${eventTs} AS ts
        FROM ${eventsTable}
        WHERE event IN ('auth:login_success', 'task:completed')
          AND ${eventTs} >= ${since}
          AND userId IS NOT NULL${ex.clause}
      ),
      signup AS (
        SELECT identity, MIN(ts) AS signup_ts
        FROM raw
        WHERE event = 'auth:login_success'
        GROUP BY identity
      ),
      firstTask AS (
        SELECT identity, MIN(ts) AS task_ts
        FROM raw
        WHERE event = 'task:completed'
        GROUP BY identity
      )
      SELECT
        COUNT(DISTINCT s.identity) AS d_signup_base,
        COUNT(DISTINCT IF(
          t.task_ts IS NOT NULL
          AND t.task_ts >= s.signup_ts
          AND t.task_ts <= TIMESTAMP_ADD(s.signup_ts, INTERVAL 24 HOUR),
          s.identity, NULL)) AS d_activated_30m
      FROM signup s
      LEFT JOIN firstTask t ON t.identity = s.identity
    `;

    // ── (2) 7일 잔존: 가입자 중 7일내 2파생세션/2프로젝트 도달 고유 identity ──
    const retainedQuery = `
      WITH win AS (
        SELECT
          COALESCE(NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''), userId)
            AS identity,
          ${eventTs} AS ts,
          DATE(${eventTs}) AS activity_date,
          projectId,
          event
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${since}
          AND userId IS NOT NULL${ex.clause}
      ),
      signup AS (
        SELECT identity, MIN(ts) AS signup_ts
        FROM win
        WHERE event = 'auth:login_success'
        GROUP BY identity
      )
      SELECT COUNT(*) AS d_retained_7d
      FROM (
        SELECT w.identity
        FROM win w
        JOIN signup s ON s.identity = w.identity
        WHERE w.ts BETWEEN s.signup_ts AND TIMESTAMP_ADD(s.signup_ts, INTERVAL 7 DAY)
        GROUP BY w.identity
        HAVING COUNT(DISTINCT CONCAT(
                  COALESCE(w.projectId, '(none)'),
                  ':',
                  FORMAT_DATE('%F', w.activity_date)
                )) >= 2
            OR COUNT(DISTINCT w.projectId) >= 2
      )
    `;

    // ── (3) 활동 스캔(단일): 첫티켓 완료 distinct + 스폰 헬스 카운트 ──
    const activityQuery = `
      SELECT
        COUNT(DISTINCT IF(event = 'task:completed', userId, NULL))
          AS d_task_completed,
        COUNTIF(event = 'task:completed') AS n_task_completed,
        COUNTIF(event = 'agent:spawned') AS n_spawned,
        COUNTIF(event = 'agent:crashed') AS n_crashed,
        COUNTIF(event = 'agent:restarted') AS n_restarted
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}
        AND event IN ('task:completed', 'agent:spawned',
                      'agent:crashed', 'agent:restarted')${ex.clause}
    `;

    // ── (4) CLI 셋업 위저드 단계 분해(step×phase). metadata 는 JSON STRING ──
    // 게이지의 CLI 인증 성공률·첫프로젝트 실행률도 이 분해에서 파생한다(별도 쿼리
    // 안 돌리고 buildCliSetupSummary 결과에서 connect/project 단계 값을 뽑아 씀).
    const cliSetupQuery = `
      SELECT
        JSON_VALUE(metadata, '$.step') AS step,
        JSON_VALUE(metadata, '$.phase') AS phase,
        COUNT(DISTINCT userId) AS clients,
        COUNT(*) AS events
      FROM ${eventsTable}
      WHERE event = 'onboarding:cli_setup_step'
        AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY step, phase
    `;

    // ── (5) 첫프로젝트 설문 별점 분포(survey_first_project.metadata.rating) ──
    const starRatingQuery = `
      SELECT
        JSON_VALUE(metadata, '$.rating') AS rating,
        COUNT(*) AS count
      FROM ${eventsTable}
      WHERE event = 'onboarding:survey_first_project'
        AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY rating
    `;

    // ── (6) CLI 실패 마이크로설문 사유(survey_cli_fail.metadata.reason) ──
    const cliFailQuery = `
      SELECT
        COALESCE(JSON_VALUE(metadata, '$.reason'), '(none)') AS key,
        COUNT(*) AS count
      FROM ${eventsTable}
      WHERE event = 'onboarding:survey_cli_fail'
        AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY key
      ORDER BY count DESC
    `;

    // ── (7) 데모 퍼널 + 마케팅 동의(단일 스캔) ──
    const demoConsentQuery = `
      SELECT
        COUNT(DISTINCT IF(event = 'onboarding:demo_started', userId, NULL))
          AS demo_started_clients,
        COUNTIF(event = 'onboarding:demo_started') AS demo_started_events,
        COUNT(DISTINCT IF(event = 'onboarding:demo_completed', userId, NULL))
          AS demo_completed_clients,
        COUNTIF(event = 'onboarding:demo_completed') AS demo_completed_events,
        COUNT(DISTINCT IF(event = 'onboarding:demo_cta_click', userId, NULL))
          AS demo_cta_clients,
        COUNTIF(event = 'onboarding:demo_cta_click') AS demo_cta_events,
        COUNT(DISTINCT IF(
          event = 'onboarding:marketing_consent_shown', userId, NULL))
          AS consent_shown_clients,
        COUNTIF(event = 'onboarding:marketing_consent_shown')
          AS consent_shown_events,
        COUNT(DISTINCT IF(
          event = 'onboarding:marketing_consent_granted', userId, NULL))
          AS consent_granted_clients,
        COUNTIF(event = 'onboarding:marketing_consent_granted')
          AS consent_granted_events
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}
        AND event IN ('onboarding:demo_started', 'onboarding:demo_completed',
                      'onboarding:demo_cta_click',
                      'onboarding:marketing_consent_shown',
                      'onboarding:marketing_consent_granted')${ex.clause}
    `;

    // ── (8) 재사용(주간): 활성 프로젝트·완료 티켓·WAU(최근 7일 창) ──
    const weeklyQuery = `
      SELECT
        COUNT(DISTINCT projectId) AS weekly_active_projects,
        COUNTIF(event = 'task:completed') AS weekly_completed_tasks,
        COUNT(DISTINCT userId) AS wau
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${week}${ex.clause}
    `;

    // ── (9) 2번째 파생세션/프로젝트 도달(윈도우 전체) + 평균 DAU ──
    const secondSessionQuery = `
      SELECT COUNT(*) AS d_second_session
      FROM (
        SELECT userId
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${since}
          AND userId IS NOT NULL${ex.clause}
        GROUP BY userId
        HAVING COUNT(DISTINCT CONCAT(
                  COALESCE(projectId, '(none)'),
                  ':',
                  FORMAT_DATE('%F', DATE(${eventTs}))
                )) >= 2
            OR COUNT(DISTINCT projectId) >= 2
      )
    `;
    const avgDauQuery = `
      SELECT AVG(dau) AS avg_dau
      FROM (
        SELECT FORMAT_DATE('%F', DATE(${eventTs})) AS d,
               COUNT(DISTINCT userId) AS dau
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${since}${ex.clause}
        GROUP BY d
      )
    `;

    // 대부분 쿼리는 @days(윈도우)+제외절 파라미터를 참조한다. 단 weeklyQuery 는
    // 고정 7일 창(@days 미참조)이라, 미참조 파라미터를 넘기면 BQ 가 거부하므로
    // (위 getAdminModelSummary 의 uid/client 분리와 동일 사유) 제외절 파라미터만
    // 넘긴다.
    const daysParams = { days: rangeDays, ...ex.params };
    const [
      headRows,
      retainedRows,
      activityRows,
      cliSetupRows,
      starRows,
      cliFailRows,
      demoConsentRows,
      weeklyRows,
      secondSessionRows,
      avgDauRows,
    ] = await runAdminAnalyticsQueries([
      { name: "kpi.headline", query: headlineQuery, params: daysParams },
      { name: "kpi.retained7d", query: retainedQuery, params: daysParams },
      { name: "kpi.activity", query: activityQuery, params: daysParams },
      { name: "kpi.cliSetup", query: cliSetupQuery, params: daysParams },
      { name: "kpi.starRating", query: starRatingQuery, params: daysParams },
      { name: "kpi.cliFail", query: cliFailQuery, params: daysParams },
      {
        name: "kpi.demoConsent",
        query: demoConsentQuery,
        params: daysParams,
      },
      { name: "kpi.weekly", query: weeklyQuery, params: ex.params },
      {
        name: "kpi.secondSession",
        query: secondSessionQuery,
        params: daysParams,
      },
      { name: "kpi.avgDau", query: avgDauQuery, params: daysParams },
    ]);

    const first = (rows: BigQueryRows): Record<string, unknown> =>
      rows[0] ?? {};
    const headRow = first(headRows);
    const retainedRow = first(retainedRows);
    const activityRow = first(activityRows);
    const demoConsentRow = first(demoConsentRows);
    const weeklyRow = first(weeklyRows);
    const secondSessionRow = first(secondSessionRows);
    const avgDauRow = first(avgDauRows);

    // CLI 셋업 단계 요약 → 게이지의 CLI 인증/첫프로젝트 분자·분모 파생.
    const cliRows = (cliSetupRows as Array<Record<string, unknown>>).map(
      (r) => ({
        step: r.step,
        phase: r.phase,
        clients: r.clients,
        events: r.events,
      }),
    ) as CliSetupStepRow[];
    const cliSummary = buildCliSetupSummary(cliRows);
    const connect = cliSummary.find((s) => s.step === "connect");
    const project = cliSummary.find((s) => s.step === "project");

    // 게이지 분자/분모 스칼라 묶음(순수 빌더가 d_<col> 로 읽는다).
    const gaugeRow: Record<string, unknown> = {
      d_signup_base: headRow.d_signup_base,
      d_activated_30m: headRow.d_activated_30m,
      d_task_completed: headRow.d_activated_30m,
      d_retained_7d: retainedRow.d_retained_7d,
      d_cli_connect_enter: connect?.clients.enter ?? 0,
      d_cli_connect_success: connect?.clients.success ?? 0,
      d_cli_project_success: project?.clients.success ?? 0,
    };

    const cockpit = buildKpiCockpit({
      gaugeRow,
      starRatingRows: (starRows as Array<Record<string, unknown>>).map((r) => ({
        rating: r.rating,
        count: r.count,
      })),
      cliSetupRows: cliRows,
      cliFailReasonRows: (cliFailRows as Array<Record<string, unknown>>).map(
        (r) => ({ key: r.key, count: r.count }),
      ),
      demo: {
        startedClients: demoConsentRow.demo_started_clients,
        completedClients: demoConsentRow.demo_completed_clients,
        ctaClients: demoConsentRow.demo_cta_clients,
        startedEvents: demoConsentRow.demo_started_events,
        completedEvents: demoConsentRow.demo_completed_events,
        ctaEvents: demoConsentRow.demo_cta_events,
      },
      consent: {
        shownClients: demoConsentRow.consent_shown_clients,
        grantedClients: demoConsentRow.consent_granted_clients,
        shownEvents: demoConsentRow.consent_shown_events,
        grantedEvents: demoConsentRow.consent_granted_events,
      },
      reuse: {
        weeklyActiveProjects: weeklyRow.weekly_active_projects,
        weeklyCompletedTasks: weeklyRow.weekly_completed_tasks,
        secondSessionClients: secondSessionRow.d_second_session,
        signupBase: headRow.d_signup_base,
        avgDau: avgDauRow.avg_dau,
        wau: weeklyRow.wau,
      },
      spawn: {
        spawned: activityRow.n_spawned,
        crashed: activityRow.n_crashed,
        restarted: activityRow.n_restarted,
        completed: activityRow.n_task_completed,
      },
    });

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      ...cockpit,
    };
  });

/**
 * getAdminModelSummary — 모델 선정/라우팅 지표(🟡 BQ).
 *
 * (1) cost_logs 모델별 비용(admin 버전 = getCostSummary 의 uid 필터 제거)
 * (2) 일별 총비용(히스토리 비용/사용)
 * (3) task_outcomes 모델×role 성공률·완료시간·평균비용 + 비용대비효율
 * (4) events.metadata(JSON STRING) 의 dispatch:decision 라우팅 결정 분포
 *
 * params: { days?: number } (기본 30)
 */
export const getAdminModelSummary = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;
    const outcomesTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_TASK_OUTCOMES_TABLE}\``;
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const sinceTs = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    // 운영자 제외: cost_logs 는 실제 uid 보유 → 정확 제외.
    // events/task_outcomes 는 익명 clientId → 역참조로 추정된 것만 제외.
    // includeAdmin(기본 false)=제외, true=포함(두 제외절 모두 비활성).
    const includeAdmin = parseIncludeAdmin(data);
    const uidEx = includeAdmin ? EMPTY_EXCLUSION : adminUidExclusion();
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const clientEx = includeAdmin
      ? EMPTY_EXCLUSION
      : adminClientExclusion(adminClientIds);
    // cost_logs/events 의 timestamp, task_outcomes 의 completedAt 은 STRING 적재라
    // TIMESTAMP 비교 전 SAFE_CAST 필요(위 getAdminUsageSummary 와 동일 사유).
    const tsCast = "SAFE_CAST(timestamp AS TIMESTAMP)";
    const completedAtTs = "SAFE_CAST(completedAt AS TIMESTAMP)";

    // (1) 모델별 비용(전체 사용자 — 자기조회 uid 필터 제거, 운영자만 제외)
    const costByModelQuery = `
      SELECT
        COALESCE(model, '(none)') AS model,
        SUM(COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0) +
            COALESCE(cacheReadTokens, 0) + COALESCE(cacheWriteTokens, 0))
          AS totalTokens,
        SUM(COALESCE(totalCost, 0)) AS cost,
        COUNT(*) AS n
      FROM ${costTable}
      WHERE ${tsCast} >= ${sinceTs}${uidEx.clause}
      GROUP BY model
      ORDER BY cost DESC
    `;
    // (2) 일별 총비용(히스토리)
    const costByDayQuery = `
      SELECT
        FORMAT_DATE('%F', DATE(${tsCast})) AS date,
        SUM(COALESCE(totalCost, 0)) AS cost
      FROM ${costTable}
      WHERE ${tsCast} >= ${sinceTs}${uidEx.clause}
      GROUP BY date
      ORDER BY date ASC
    `;
    // (3) task_outcomes 모델×role 성공률·완료시간·평균비용
    const modelRoleQuery = `
      SELECT
        COALESCE(model, '(none)') AS model,
        COALESCE(role, '(none)') AS role,
        COUNT(*) AS total,
        COUNTIF(success = true) AS succeeded,
        AVG(durationMs) AS avgDurationMs,
        AVG(totalCost) AS avgCost
      FROM ${outcomesTable}
      WHERE ${completedAtTs} >= ${sinceTs}${clientEx.clause}
      GROUP BY model, role
      ORDER BY total DESC
    `;
    const outcomeByModelQuery = `
      SELECT
        COALESCE(model, '(none)') AS model,
        COUNT(*) AS total,
        COUNTIF(success = true) AS succeeded,
        SUM(COALESCE(totalCost, 0)) AS totalCost,
        AVG(totalCost) AS avgCost,
        SUM(COALESCE(retriesCount, 0)) AS reworkCount,
        COUNTIF(COALESCE(retriesCount, 0) > 0) AS retriedTasks
      FROM ${outcomesTable}
      WHERE ${completedAtTs} >= ${sinceTs}${clientEx.clause}
      GROUP BY model
      ORDER BY total DESC
    `;
    // (3-b) 일별 × 모델 비용 — 위 costByDayQuery 는 총합만이라 "그날 어느 모델이
    // 비용을 만들었나"를 못 본다. 같은 필터·같은 제외절로 모델 축만 추가한다.
    const costByDayModelQuery = `
      SELECT
        FORMAT_DATE('%F', DATE(${tsCast})) AS date,
        COALESCE(model, '(none)') AS model,
        SUM(COALESCE(totalCost, 0)) AS cost
      FROM ${costTable}
      WHERE ${tsCast} >= ${sinceTs}${uidEx.clause}
      GROUP BY date, model
      ORDER BY date ASC
    `;

    // (3-c) ★하위모델 분해 — 스폰축(events.model = 하네스 claude/gpt/grok…)과
    // 비용축(cost_logs.model = 구체 id claude-opus-4-8/MiniMax-M3…)은 해상도가
    // 다르다. agentId 로 조인해야 "하네스 claude 밑에서 실제로 무엇이 돌았나"가
    // 보인다(env-swap 벤더는 우리 claude 바이너리를 그대로 쓰므로 하네스 축만
    // 보면 Anthropic 과 한 칸에 섞인다).
    //
    // ★제외절이 두 축으로 갈린다: events 는 익명 clientId(clientEx), cost_logs 는
    // 실 uid(uidEx). 각 절은 bare `userId` 를 참조하므로 JOIN 바깥이 아니라 각
    // 서브쿼리 **안**에서 적용해 컬럼 모호성을 피한다. 두 파라미터 집합이 모두
    // 참조되므로 이 쿼리에는 합쳐서 넘긴다(미참조 파라미터 없음).
    const harnessBridgeQuery = `
      WITH spawns AS (
        SELECT DISTINCT agentId, COALESCE(model, '(none)') AS harness
        FROM ${eventsTable}
        WHERE event = 'agent:spawned'
          AND agentId IS NOT NULL
          AND ${tsCast} >= ${sinceTs}${clientEx.clause}
      ),
      costs AS (
        SELECT
          agentId,
          COALESCE(model, '(none)') AS model,
          SUM(COALESCE(totalCost, 0)) AS cost,
          SUM(COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0) +
              COALESCE(cacheReadTokens, 0) + COALESCE(cacheWriteTokens, 0))
            AS tokens,
          COUNT(*) AS costRows
        FROM ${costTable}
        WHERE agentId IS NOT NULL
          AND ${tsCast} >= ${sinceTs}${uidEx.clause}
        GROUP BY agentId, model
      )
      SELECT
        s.harness AS harness,
        COALESCE(c.model, '(비용 미적재)') AS model,
        COUNT(DISTINCT s.agentId) AS agents,
        SUM(COALESCE(c.cost, 0)) AS cost,
        SUM(COALESCE(c.tokens, 0)) AS tokens,
        SUM(COALESCE(c.costRows, 0)) AS costRows
      FROM spawns AS s
      LEFT JOIN costs AS c ON c.agentId = s.agentId
      GROUP BY harness, model
      ORDER BY cost DESC
    `;
    // 하네스 그레인 고유 에이전트 수 — 위 (harness,model) 행의 agents 를 합치면
    // 한 에이전트가 모델 2종을 태운 경우 중복 계상된다. 정확한 분모를 따로 센다.
    const harnessAgentsQuery = `
      SELECT COALESCE(model, '(none)') AS harness,
             COUNT(DISTINCT agentId) AS agents
      FROM ${eventsTable}
      WHERE event = 'agent:spawned'
        AND agentId IS NOT NULL
        AND ${tsCast} >= ${sinceTs}${clientEx.clause}
      GROUP BY harness
    `;

    // (4) dispatch:decision 라우팅 결정 분포(metadata JSON STRING 파싱)
    const routingQuery = (jsonPath: string) => `
      SELECT JSON_VALUE(metadata, '${jsonPath}') AS key, COUNT(*) AS n
      FROM ${eventsTable}
      WHERE event = 'dispatch:decision' AND ${tsCast} >= ${sinceTs}${clientEx.clause}
      GROUP BY key ORDER BY n DESC
    `;
    const routingScoreBucketsQuery = `
      WITH decisions AS (
        SELECT
          COALESCE(model, JSON_VALUE(metadata, '$.selectedModel'), '(none)') AS selectedModel,
          JSON_VALUE(metadata, '$.reuseVsSpawn') AS reuseVsSpawn,
          SAFE_CAST(JSON_VALUE(metadata, '$.agentScore') AS FLOAT64) AS agentScore,
          JSON_QUERY_ARRAY(metadata, '$.perModelScores') AS scores
        FROM ${eventsTable}
        WHERE event = 'dispatch:decision' AND ${tsCast} >= ${sinceTs}${clientEx.clause}
      ),
      expanded AS (
        SELECT
          COALESCE(JSON_VALUE(score, '$.model'), selectedModel, '(none)') AS model,
          COALESCE(
            SAFE_CAST(JSON_VALUE(score, '$.total') AS FLOAT64),
            agentScore
          ) AS score,
          COALESCE(reuseVsSpawn, '(none)') AS reuseVsSpawn
        FROM decisions
        LEFT JOIN UNNEST(
          IF(scores IS NULL OR ARRAY_LENGTH(scores) = 0, [CAST(NULL AS STRING)], scores)
        ) AS score
      )
      SELECT
        model,
        CASE
          WHEN score IS NULL THEN '(missing)'
          WHEN score < 50 THEN '<50'
          WHEN score < 100 THEN '50-99'
          WHEN score < 150 THEN '100-149'
          WHEN score < 200 THEN '150-199'
          ELSE '200+'
        END AS scoreBucket,
        reuseVsSpawn,
        COUNT(*) AS n
      FROM expanded
      GROUP BY model, scoreBucket, reuseVsSpawn
      ORDER BY model ASC, scoreBucket ASC, reuseVsSpawn ASC
    `;

    // 쿼리마다 참조하는 제외 파라미터가 달라(uid vs clientId) 공용 params 를
    // 쓰면 미참조 파라미터가 섞인다 — 쿼리별로 명시 전달한다.
    const q = (query: string, extra: Record<string, unknown>) =>
      bigquery.query({
        query,
        params: { days: rangeDays, ...extra },
        location: BQ_LOCATION,
      });
    const qCost = (query: string) => q(query, uidEx.params);
    const qClient = (query: string) => q(query, clientEx.params);
    // 브릿지 쿼리만 두 축의 제외절을 모두 참조한다(각 서브쿼리 안에서 적용).
    const qBoth = (query: string) =>
      q(query, { ...uidEx.params, ...clientEx.params });

    const [
      [costByModelRows],
      [costByDayRows],
      [costByDayModelRows],
      [harnessBridgeRows],
      [harnessAgentRows],
      [modelRoleRows],
      [outcomeByModelRows],
      [routingSelectedRows],
      [routingReasonRows],
      [routingReuseRows],
      [routingModeRows],
      [routingScoreBucketRows],
    ] = await Promise.all([
      qCost(costByModelQuery),
      qCost(costByDayQuery),
      qCost(costByDayModelQuery),
      qBoth(harnessBridgeQuery),
      qClient(harnessAgentsQuery),
      qClient(modelRoleQuery),
      qClient(outcomeByModelQuery),
      qClient(routingQuery("$.selectedModel")),
      qClient(routingQuery("$.decisionReason")),
      qClient(routingQuery("$.reuseVsSpawn")),
      qClient(routingQuery("$.modelSelectionMode")),
      qClient(routingScoreBucketsQuery),
    ]);

    const costByModel = (costByModelRows as Array<Record<string, unknown>>).map(
      (r) => ({
        model: String(r.model ?? "(none)"),
        totalTokens: toNumber(r.totalTokens as number | string | undefined),
        cost: toNumber(r.cost as number | string | undefined),
        count: toNumber(r.n as number | string | undefined),
      }),
    );

    const modelRoleStats = (
      modelRoleRows as Array<Record<string, unknown>>
    ).map((r) => {
      const total = toNumber(r.total as number | string | undefined);
      const succeeded = toNumber(r.succeeded as number | string | undefined);
      const avgCost = toNumber(r.avgCost as number | string | undefined);
      const successRate = total > 0 ? succeeded / total : 0;
      return {
        model: String(r.model ?? "(none)"),
        role: String(r.role ?? "(none)"),
        total,
        succeeded,
        successRate,
        avgDurationMs: toNumber(r.avgDurationMs as number | string | undefined),
        avgCost,
        // 비용대비효율(성공률 ÷ 평균비용). 평균비용 0/미기록이면 null.
        costEfficiency: avgCost > 0 ? successRate / avgCost : null,
      };
    });

    const outcomeByModel = (
      outcomeByModelRows as Array<Record<string, unknown>>
    ).map((r) => {
      const total = toNumber(r.total as number | string | undefined);
      const succeeded = toNumber(r.succeeded as number | string | undefined);
      return {
        model: String(r.model ?? "(none)"),
        total,
        succeeded,
        successRate: total > 0 ? succeeded / total : 0,
        totalCost: toNumber(r.totalCost as number | string | undefined),
        avgCost: toNumber(r.avgCost as number | string | undefined),
        reworkCount: toNumber(r.reworkCount as number | string | undefined),
        retriedTasks: toNumber(r.retriedTasks as number | string | undefined),
      };
    });

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      costByModel,
      costByDay: (costByDayRows as Array<Record<string, unknown>>).map((r) => ({
        date: String(r.date ?? ""),
        cost: toNumber(r.cost as number | string | undefined),
      })),
      // 일별 × 모델(기간별 분해) — 상위 6종 + '그 외'로 접되 총합은 보존한다.
      costByDayModel: buildCostByDayModel(
        costByDayModelRows as CostByDayModelSourceRow[],
        6,
      ),
      // ★하위모델 분해(하네스 → 구체 모델).
      modelBreakdown: buildModelBreakdown(
        harnessBridgeRows as ModelBridgeSourceRow[],
        harnessAgentRows as HarnessAgentRow[],
      ),
      modelRoleStats,
      outcomeByModel,
      routing: {
        bySelectedModel: foldDistribution(
          routingSelectedRows as Array<Record<string, unknown>>,
          "key",
        ),
        byDecisionReason: foldDistribution(
          routingReasonRows as Array<Record<string, unknown>>,
          "key",
        ),
        byReuseVsSpawn: foldDistribution(
          routingReuseRows as Array<Record<string, unknown>>,
          "key",
        ),
        byModelSelectionMode: foldDistribution(
          routingModeRows as Array<Record<string, unknown>>,
          "key",
        ),
        scoreBuckets: (
          routingScoreBucketRows as Array<Record<string, unknown>>
        ).map((r) => ({
          model: String(r.model ?? "(none)"),
          scoreBucket: String(r.scoreBucket ?? "(missing)"),
          reuseVsSpawn: String(r.reuseVsSpawn ?? "(none)"),
          count: toNumber(r.n as number | string | undefined),
        })),
      },
    };
  },
);

/**
 * getAdminReleaseHealth — 앱 빌드/릴리스·버전 축(🟡 BQ events).
 *
 * ★전용 이벤트가 없다: 앱 버전은 `lifecycle:app-version` 같은 이벤트가 아니라
 * events 테이블의 **appVersion 컬럼**(telemetryService 가 flush 시 모든 이벤트에
 * 주입)에서 파생한다. 그래서 이벤트 필터가 아니라 컬럼 GROUP BY 다.
 *
 * (1) 버전별 채택/헬스 — 고유 clientId·세션·스폰·크래시·크래시율·관측기간
 * (2) 버전별 일자 채택 추이(고유 clientId)
 *
 * 크래시율은 agent:crashed / agent:spawned 이며, 스폰 0 인 버전은 null 로 둔다
 * (0% 로 오도 금지). 순수 조립은 adminAnalytics.buildReleaseHealth 가 담당한다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30 / 제외)
 */
export const getAdminReleaseHealth = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const since = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    const includeAdmin = parseIncludeAdmin(data);
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const ex = includeAdmin
      ? EMPTY_EXCLUSION
      : adminClientExclusion(adminClientIds);
    // events.timestamp 는 STRING 적재라 비교 전 SAFE_CAST(다른 어드민 콜러블과 동일).
    const eventTs = "SAFE_CAST(timestamp AS TIMESTAMP)";
    // NULL appVersion 은 컬럼 도입 이전 텔레메트리 — 버리지 않고 빈 문자열로 모아
    // 순수 빌더가 '(미기록)' 으로 라벨한다(있는 데이터를 화면에서 지우지 않는다).
    const versionExpr = "COALESCE(appVersion, '')";

    const versionQuery = `
      SELECT
        ${versionExpr} AS version,
        COUNT(DISTINCT userId) AS clients,
        COUNT(*) AS events,
        COUNTIF(event = 'session:started') AS sessions,
        COUNTIF(event = 'agent:spawned') AS spawned,
        COUNTIF(event = 'agent:crashed') AS crashed,
        FORMAT_DATE('%F', MIN(DATE(${eventTs}))) AS firstSeen,
        FORMAT_DATE('%F', MAX(DATE(${eventTs}))) AS lastSeen
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}${ex.clause}
      GROUP BY version
    `;
    const adoptionQuery = `
      SELECT
        FORMAT_DATE('%F', DATE(${eventTs})) AS date,
        ${versionExpr} AS version,
        COUNT(DISTINCT userId) AS clients
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}${ex.clause}
      GROUP BY date, version
      ORDER BY date ASC
    `;

    const run = (query: string) =>
      bigquery.query({
        query,
        params: { days: rangeDays, ...ex.params },
        location: BQ_LOCATION,
      });

    const [[versionRows], [adoptionRows]] = await Promise.all([
      run(versionQuery),
      run(adoptionQuery),
    ]);

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        clientIdCount: adminClientIds.length,
      },
      ...buildReleaseHealth(
        versionRows as ReleaseVersionSourceRow[],
        adoptionRows as ReleaseAdoptionSourceRow[],
      ),
    };
  });

// ============================================
// Admin Analytics Drilldown — 차트 클릭 → 상세 분해
// ============================================
// 대시보드의 모든 차트는 집계치라 "왜 이 날 튀었나"를 답하지 못한다. 이 콜러블은
// (a) 특정 날(UTC) 또는 (b) 특정 세그먼트(이벤트/모델/역할/플랜 등) 하나를
// 받아 그 조각만 다시 분해한다.
//
// 응답은 스코프마다 다른 필드를 만들지 않고 아래 제네릭 봉투 하나로 통일한다 —
// 프론트 모달이 스코프별 분기 없이 그대로 렌더할 수 있게 하기 위함(§UI).
//
// 프라이버시: 상위 집계와 동일 규칙. 개별 row·PII·uid·clientId 는 절대 내리지
// 않고 카테고리 카운트만 반환한다. 운영자(ADMIN_UID) 자기활동은 동일하게 제외.

type DrilldownFormat = "int" | "cost" | "pct" | "duration";

type DrilldownStat = {
  label: string;
  value: number;
  format: DrilldownFormat;
};

type DrilldownBreakdown = {
  title: string;
  rows: Array<{ key: string; count: number }>;
  format: DrilldownFormat;
};

type DrilldownResult = {
  scope: string;
  date: string | null;
  key: string | null;
  rangeDays: number;
  generatedAt: string;
  title: string;
  note: string;
  stats: DrilldownStat[];
  breakdowns: DrilldownBreakdown[];
  trend: Array<{ date: string; value: number }> | null;
  trendLabel: string | null;
  trendFormat: DrilldownFormat;
};

const DRILLDOWN_SCOPES = [
  "usage:day",
  "spawn:day",
  "cost:day",
  "subscription:day",
  "segment:event",
  "segment:model",
  "segment:role",
  "segment:plan",
  "segment:status",
  "segment:provider",
] as const;

type DrilldownScope = (typeof DRILLDOWN_SCOPES)[number];

function parseDrilldownScope(data: unknown): DrilldownScope {
  const raw = (data as { scope?: unknown } | null | undefined)?.scope;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!(DRILLDOWN_SCOPES as readonly string[]).includes(s)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `scope must be one of: ${DRILLDOWN_SCOPES.join(", ")}`,
    );
  }
  return s as DrilldownScope;
}

/**
 * getAdminDrilldown — 차트 데이터포인트/막대 클릭 시의 상세 분해.
 *
 * params:
 *   { scope: "usage:day" | "spawn:day" | "cost:day" | "subscription:day",
 *     date: "YYYY-MM-DD" }                       — 해당 날(UTC) 분해
 *   { scope: "segment:*", key: string, days?: number }  — 해당 세그먼트 분해
 */
export const getAdminDrilldown = functions.https.onCall(
  async (data, context): Promise<DrilldownResult> => {
    requireAdmin(context);
    const scope = parseDrilldownScope(data);
    const rangeDays = parseAnalyticsDays(data);
    const isDayScope = scope.endsWith(":day");
    const date = isDayScope ? parseAnalyticsDate(data) : null;
    const key = isDayScope ? null : parseSegmentKey(data);

    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const outcomesTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_TASK_OUTCOMES_TABLE}\``;
    const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;

    // 날짜 스코프는 [자정, 다음날 자정) UTC 반개구간 — 파티션 프루닝 유지.
    const dayWindow = (col: string) =>
      `${col} >= TIMESTAMP(@date) AND ${col} < TIMESTAMP_ADD(TIMESTAMP(@date), INTERVAL 1 DAY)`;
    const sinceTs = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";

    // includeAdmin(기본 false)=제외, true=포함. 상위 차트 토글과 같은 값을 받아
    // 드릴다운도 동일 모집단을 분해하게 한다.
    const includeAdmin = parseIncludeAdmin(data);
    const uidEx = includeAdmin ? EMPTY_EXCLUSION : adminUidExclusion();
    const adminClientIds = await resolveAdminClientIds(rangeDays);
    const clientEx = includeAdmin
      ? EMPTY_EXCLUSION
      : adminClientExclusion(adminClientIds);

    // 스코프마다 참조하는 파라미터가 달라서(@date vs @days vs @key vs 제외절)
    // 후보를 모아두고 쿼리 본문이 실제로 참조하는 것만 넘긴다 — 미참조
    // 파라미터를 섞어 보내지 않기 위함.
    const runQuery = async (
      query: string,
      extra: Record<string, unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      const candidates: Record<string, unknown> = {
        ...(date != null ? { date } : {}),
        days: rangeDays,
        ...extra,
      };
      const params: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(candidates)) {
        if (value !== undefined && query.includes(`@${name}`)) {
          params[name] = value;
        }
      }
      const [rows] = await bigquery.query({
        query,
        params,
        location: BQ_LOCATION,
      });
      return rows as Array<Record<string, unknown>>;
    };

    const base = {
      scope,
      date,
      key,
      rangeDays,
      generatedAt: new Date().toISOString(),
      trend: null as DrilldownResult["trend"],
      trendLabel: null as string | null,
      trendFormat: "int" as DrilldownFormat,
    };

    // ── (a) 하루 분해 — events ─────────────────────────────────────────────
    if (scope === "usage:day" || scope === "spawn:day") {
      const spawnOnly = scope === "spawn:day";
      const eventFilter = spawnOnly ? " AND event = 'agent:spawned'" : "";
      const where = `WHERE ${dayWindow("timestamp")}${eventFilter}${
        clientEx.clause
      }`;

      const dist = (col: string, limit = 25) => `
        SELECT COALESCE(CAST(${col} AS STRING), '(none)') AS key, COUNT(*) AS n
        FROM ${eventsTable}
        ${where}
        GROUP BY key ORDER BY n DESC LIMIT ${limit}
      `;
      const totalsQuery = `
        SELECT
          COUNT(*) AS events,
          COUNT(DISTINCT userId) AS clients,
          COUNT(DISTINCT agentId) AS agents,
          COUNT(DISTINCT projectId) AS projects
        FROM ${eventsTable}
        ${where}
      `;
      const hourQuery = `
        SELECT FORMAT_TIMESTAMP('%H시', timestamp) AS key, COUNT(*) AS n
        FROM ${eventsTable}
        ${where}
        GROUP BY key ORDER BY key ASC
      `;

      const [totals, byHour, byEvent, byRole, byModel, byVersion] =
        await Promise.all([
          runQuery(totalsQuery, clientEx.params),
          runQuery(hourQuery, clientEx.params),
          // spawn:day 는 event 가 agent:spawned 하나로 고정 — 분해할 게 없다.
          spawnOnly
            ? Promise.resolve([] as Array<Record<string, unknown>>)
            : runQuery(dist("event"), clientEx.params),
          runQuery(dist("role"), clientEx.params),
          runQuery(dist("model"), clientEx.params),
          runQuery(dist("appVersion"), clientEx.params),
        ]);

      const t = totals[0] ?? {};
      return {
        ...base,
        title: `${date} · ${spawnOnly ? "에이전트 스폰" : "제품 사용"} 분해`,
        note: "UTC 기준 하루 · 익명 텔레메트리(옵트인 표본)",
        stats: [
          {
            label: spawnOnly ? "스폰 수" : "총 이벤트",
            value: toNumber(t.events as number | string | undefined),
            format: "int",
          },
          {
            label: "고유 클라이언트",
            value: toNumber(t.clients as number | string | undefined),
            format: "int",
          },
          {
            label: "고유 에이전트",
            value: toNumber(t.agents as number | string | undefined),
            format: "int",
          },
          {
            label: "고유 프로젝트",
            value: toNumber(t.projects as number | string | undefined),
            format: "int",
          },
        ],
        breakdowns: [
          ...(spawnOnly
            ? []
            : [
                {
                  title: "이벤트별",
                  rows: foldDistribution(byEvent, "key"),
                  format: "int" as DrilldownFormat,
                },
              ]),
          {
            title: "역할별",
            rows: foldDistribution(byRole, "key"),
            format: "int",
          },
          {
            title: "모델별",
            rows: foldDistribution(byModel, "key"),
            format: "int",
          },
          {
            title: "앱 버전별",
            rows: foldDistribution(byVersion, "key"),
            format: "int",
          },
          {
            title: "시간대별 (UTC)",
            rows: foldDistribution(byHour, "key"),
            format: "int",
          },
        ],
      };
    }

    // ── (a) 하루 분해 — cost_logs ─────────────────────────────────────────
    if (scope === "cost:day") {
      const where = `WHERE ${dayWindow("timestamp")}${uidEx.clause}`;
      const totalsQuery = `
        SELECT
          SUM(COALESCE(totalCost, 0)) AS cost,
          SUM(COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0) +
              COALESCE(cacheReadTokens, 0) + COALESCE(cacheWriteTokens, 0))
            AS tokens,
          COUNT(*) AS calls,
          COUNT(DISTINCT userId) AS users
        FROM ${costTable}
        ${where}
      `;
      const costBy = (col: string) => `
        SELECT COALESCE(CAST(${col} AS STRING), '(none)') AS key,
               SUM(COALESCE(totalCost, 0)) AS n
        FROM ${costTable}
        ${where}
        GROUP BY key ORDER BY n DESC LIMIT 25
      `;
      const hourQuery = `
        SELECT FORMAT_TIMESTAMP('%H시', timestamp) AS key,
               SUM(COALESCE(totalCost, 0)) AS n
        FROM ${costTable}
        ${where}
        GROUP BY key ORDER BY key ASC
      `;

      const [totals, byModel, byTaskType, byHour] = await Promise.all([
        runQuery(totalsQuery, uidEx.params),
        runQuery(costBy("model"), uidEx.params),
        runQuery(costBy("taskType"), uidEx.params),
        runQuery(hourQuery, uidEx.params),
      ]);

      const t = totals[0] ?? {};
      return {
        ...base,
        title: `${date} · 비용 분해`,
        note: "UTC 기준 하루 · cost_logs(운영자 제외)",
        stats: [
          {
            label: "총 비용",
            value: toNumber(t.cost as number | string | undefined),
            format: "cost",
          },
          {
            label: "총 토큰",
            value: toNumber(t.tokens as number | string | undefined),
            format: "int",
          },
          {
            label: "호출 수",
            value: toNumber(t.calls as number | string | undefined),
            format: "int",
          },
          {
            label: "지출 사용자",
            value: toNumber(t.users as number | string | undefined),
            format: "int",
          },
        ],
        breakdowns: [
          {
            title: "모델별 비용",
            rows: foldDistribution(byModel, "key"),
            format: "cost",
          },
          {
            title: "태스크 유형별 비용",
            rows: foldDistribution(byTaskType, "key"),
            format: "cost",
          },
          {
            title: "시간대별 비용 (UTC)",
            rows: foldDistribution(byHour, "key"),
            format: "cost",
          },
        ],
      };
    }

    // ── (a) 하루 분해 — 구독(Firestore) ───────────────────────────────────
    if (scope === "subscription:day") {
      const dayStartMs = Date.parse(`${date}T00:00:00Z`);
      const dayEndMs = dayStartMs + DAY_MS;
      const adminUid = getAdminExclusionUid();
      const snap = await db.collection("subscriptions").limit(10000).get();

      const newByPlan: Record<string, number> = {};
      const newByProvider: Record<string, number> = {};
      const churnedByPlan: Record<string, number> = {};
      const churnedByProvider: Record<string, number> = {};
      let newCount = 0;
      let churnedCount = 0;
      let activeAtEnd = 0;

      const bump = (m: Record<string, number>, k: string) => {
        m[k] = (m[k] || 0) + 1;
      };

      for (const doc of snap.docs) {
        if (adminUid && doc.id === adminUid) continue;
        const v = doc.data() as Record<string, unknown>;
        const status = typeof v.status === "string" ? v.status : "unknown";
        const plan = typeof v.planType === "string" ? v.planType : "unknown";
        const provider =
          typeof v.paymentProvider === "string" ? v.paymentProvider : "unknown";
        const createdMs = tsToMillis(v.createdAt);
        const canceledMs = tsToMillis(v.canceledAt);
        const periodEndMs = tsToMillis(v.currentPeriodEnd);

        if (
          createdMs != null &&
          createdMs >= dayStartMs &&
          createdMs < dayEndMs
        ) {
          newCount++;
          bump(newByPlan, plan);
          bump(newByProvider, provider);
        }
        if (
          (status === "canceled" || status === "past_due") &&
          canceledMs != null &&
          canceledMs >= dayStartMs &&
          canceledMs < dayEndMs
        ) {
          churnedCount++;
          bump(churnedByPlan, plan);
          bump(churnedByProvider, provider);
        }
        if (
          activeAtDayEnd(
            status,
            createdMs,
            canceledMs,
            periodEndMs,
            dayEndMs - 1,
          )
        ) {
          activeAtEnd++;
        }
      }

      const toRows = (m: Record<string, number>) =>
        Object.entries(m)
          .map(([k, count]) => ({ key: k, count }))
          .sort((a, b) => b.count - a.count);

      return {
        ...base,
        title: `${date} · 구독 변동 분해`,
        note: "UTC 기준 하루 · Firestore subscriptions(운영자 제외)",
        stats: [
          { label: "신규", value: newCount, format: "int" },
          { label: "이탈", value: churnedCount, format: "int" },
          { label: "순증", value: newCount - churnedCount, format: "int" },
          { label: "당일 마감 활성", value: activeAtEnd, format: "int" },
        ],
        breakdowns: [
          { title: "신규 — 플랜별", rows: toRows(newByPlan), format: "int" },
          {
            title: "신규 — 결제수단별",
            rows: toRows(newByProvider),
            format: "int",
          },
          {
            title: "이탈 — 플랜별",
            rows: toRows(churnedByPlan),
            format: "int",
          },
          {
            title: "이탈 — 결제수단별",
            rows: toRows(churnedByProvider),
            format: "int",
          },
        ],
      };
    }

    // ── (b) 세그먼트 분해 — 구독(Firestore) ───────────────────────────────
    if (
      scope === "segment:plan" ||
      scope === "segment:status" ||
      scope === "segment:provider"
    ) {
      const adminUid = getAdminExclusionUid();
      const snap = await db.collection("subscriptions").limit(10000).get();
      const nowMs = Date.now();
      const cutoffMs = nowMs - rangeDays * DAY_MS;
      const trendBuckets = makeBusinessTrendBuckets(rangeDays, nowMs);
      const firstTrendDayMs = startOfUtcDay(nowMs) - (rangeDays - 1) * DAY_MS;

      const byStatus: Record<string, number> = {};
      const byPlan: Record<string, number> = {};
      const byProvider: Record<string, number> = {};
      let matched = 0;
      let newInWindow = 0;
      let churnedInWindow = 0;
      let activeCurrent = 0;

      const bump = (m: Record<string, number>, k: string) => {
        m[k] = (m[k] || 0) + 1;
      };

      for (const doc of snap.docs) {
        if (adminUid && doc.id === adminUid) continue;
        const v = doc.data() as Record<string, unknown>;
        const status = typeof v.status === "string" ? v.status : "unknown";
        const plan = typeof v.planType === "string" ? v.planType : "unknown";
        const provider =
          typeof v.paymentProvider === "string" ? v.paymentProvider : "unknown";

        const field =
          scope === "segment:plan"
            ? plan
            : scope === "segment:status"
              ? status
              : provider;
        if (field !== key) continue;

        matched++;
        bump(byStatus, status);
        bump(byPlan, plan);
        bump(byProvider, provider);

        const createdMs = tsToMillis(v.createdAt);
        const canceledMs = tsToMillis(v.canceledAt);
        const periodEndMs = tsToMillis(v.currentPeriodEnd);
        if (createdMs != null && createdMs >= cutoffMs) newInWindow++;
        if (
          (status === "canceled" || status === "past_due") &&
          canceledMs != null &&
          canceledMs >= cutoffMs
        ) {
          churnedInWindow++;
        }
        if (isCurrentActiveSubscription(status, periodEndMs, nowMs)) {
          activeCurrent++;
        }
        for (let i = 0; i < trendBuckets.length; i++) {
          const dayEndMs = firstTrendDayMs + i * DAY_MS + DAY_MS - 1;
          if (
            activeAtDayEnd(status, createdMs, canceledMs, periodEndMs, dayEndMs)
          ) {
            trendBuckets[i].active++;
          }
        }
      }
      const toRows = (m: Record<string, number>) =>
        Object.entries(m)
          .map(([k, count]) => ({ key: k, count }))
          .sort((a, b) => b.count - a.count);

      const label =
        scope === "segment:plan"
          ? "플랜"
          : scope === "segment:status"
            ? "상태"
            : "결제수단";

      return {
        ...base,
        title: `${label} "${key}" 분해`,
        note: `Firestore subscriptions · 최근 ${rangeDays}일 창(운영자 제외)`,
        stats: [
          { label: "해당 구독 수", value: matched, format: "int" },
          { label: "현재 활성", value: activeCurrent, format: "int" },
          { label: `신규(${rangeDays}일)`, value: newInWindow, format: "int" },
          {
            label: `이탈(${rangeDays}일)`,
            value: churnedInWindow,
            format: "int",
          },
        ],
        breakdowns: [
          { title: "상태 분포", rows: toRows(byStatus), format: "int" },
          { title: "플랜 분포", rows: toRows(byPlan), format: "int" },
          { title: "결제수단 분포", rows: toRows(byProvider), format: "int" },
        ],
        trend: trendBuckets.map((d) => ({ date: d.date, value: d.active })),
        trendLabel: "활성 구독 추이",
        trendFormat: "int",
      };
    }

    // ── (b) 세그먼트 분해 — 이벤트/역할(events + task_outcomes) ───────────
    if (scope === "segment:event" || scope === "segment:role") {
      const isEvent = scope === "segment:event";
      const match = isEvent ? "event = @key" : "role = @key";
      const where = `WHERE ${match} AND timestamp >= ${sinceTs}${clientEx.clause}`;
      const params = { key, ...clientEx.params };

      const totalsQuery = `
        SELECT COUNT(*) AS n, COUNT(DISTINCT userId) AS clients,
               COUNT(DISTINCT agentId) AS agents
        FROM ${eventsTable} ${where}
      `;
      const trendQuery = `
        SELECT FORMAT_DATE('%F', DATE(timestamp)) AS date, COUNT(*) AS n
        FROM ${eventsTable} ${where}
        GROUP BY date ORDER BY date ASC
      `;
      const dist = (col: string) => `
        SELECT COALESCE(CAST(${col} AS STRING), '(none)') AS key, COUNT(*) AS n
        FROM ${eventsTable} ${where}
        GROUP BY key ORDER BY n DESC LIMIT 25
      `;
      const outcomesQuery = `
        SELECT COUNT(*) AS total, COUNTIF(success = true) AS succeeded,
               AVG(durationMs) AS avgDurationMs
        FROM ${outcomesTable}
        WHERE role = @key AND completedAt >= ${sinceTs}${clientEx.clause}
      `;

      const [totals, trendRows, byModel, byVersion, bySecond, outcomeRows] =
        await Promise.all([
          runQuery(totalsQuery, params),
          runQuery(trendQuery, params),
          runQuery(dist("model"), params),
          runQuery(dist("appVersion"), params),
          runQuery(dist(isEvent ? "role" : "event"), params),
          isEvent
            ? Promise.resolve([] as Array<Record<string, unknown>>)
            : runQuery(outcomesQuery, params),
        ]);

      const t = totals[0] ?? {};
      const o = outcomeRows[0] ?? {};
      const outcomeTotal = toNumber(o.total as number | string | undefined);
      const outcomeOk = toNumber(o.succeeded as number | string | undefined);

      return {
        ...base,
        title: `${isEvent ? "이벤트" : "역할"} "${key}" 분해`,
        note: `최근 ${rangeDays}일 · 익명 텔레메트리(옵트인 표본)`,
        stats: [
          {
            label: "발생 수",
            value: toNumber(t.n as number | string | undefined),
            format: "int",
          },
          {
            label: "고유 클라이언트",
            value: toNumber(t.clients as number | string | undefined),
            format: "int",
          },
          {
            label: "고유 에이전트",
            value: toNumber(t.agents as number | string | undefined),
            format: "int",
          },
          ...(isEvent
            ? []
            : [
                {
                  label: "태스크 성공률",
                  value: outcomeTotal > 0 ? outcomeOk / outcomeTotal : 0,
                  format: "pct" as DrilldownFormat,
                },
                {
                  label: "평균 완료시간",
                  value: toNumber(
                    o.avgDurationMs as number | string | undefined,
                  ),
                  format: "duration" as DrilldownFormat,
                },
              ]),
        ],
        breakdowns: [
          {
            title: "모델별",
            rows: foldDistribution(byModel, "key"),
            format: "int",
          },
          {
            title: isEvent ? "역할별" : "이벤트별",
            rows: foldDistribution(bySecond, "key"),
            format: "int",
          },
          {
            title: "앱 버전별",
            rows: foldDistribution(byVersion, "key"),
            format: "int",
          },
        ],
        trend: (trendRows as Array<Record<string, unknown>>).map((r) => ({
          date: String(r.date ?? ""),
          value: toNumber(r.n as number | string | undefined),
        })),
        trendLabel: "일별 발생 추이",
        trendFormat: "int",
      };
    }

    // ── (b) 세그먼트 분해 — 모델(cost_logs + task_outcomes + events) ──────
    // scope === "segment:model"
    const costWhere = `WHERE model = @key AND timestamp >= ${sinceTs}${uidEx.clause}`;
    const costParams = { key, ...uidEx.params };
    const clientParams = { key, ...clientEx.params };

    const costTotalsQuery = `
      SELECT SUM(COALESCE(totalCost, 0)) AS cost,
             SUM(COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0) +
                 COALESCE(cacheReadTokens, 0) + COALESCE(cacheWriteTokens, 0))
               AS tokens,
             COUNT(*) AS calls
      FROM ${costTable} ${costWhere}
    `;
    const costTrendQuery = `
      SELECT FORMAT_DATE('%F', DATE(timestamp)) AS date,
             SUM(COALESCE(totalCost, 0)) AS n
      FROM ${costTable} ${costWhere}
      GROUP BY date ORDER BY date ASC
    `;
    const costByTaskTypeQuery = `
      SELECT COALESCE(taskType, '(none)') AS key,
             SUM(COALESCE(totalCost, 0)) AS n
      FROM ${costTable} ${costWhere}
      GROUP BY key ORDER BY n DESC LIMIT 25
    `;
    const modelOutcomesQuery = `
      SELECT COUNT(*) AS total, COUNTIF(success = true) AS succeeded,
             AVG(durationMs) AS avgDurationMs
      FROM ${outcomesTable}
      WHERE model = @key AND completedAt >= ${sinceTs}${clientEx.clause}
    `;
    const outcomesByRoleQuery = `
      SELECT COALESCE(role, '(none)') AS key, COUNT(*) AS n
      FROM ${outcomesTable}
      WHERE model = @key AND completedAt >= ${sinceTs}${clientEx.clause}
      GROUP BY key ORDER BY n DESC LIMIT 25
    `;
    const spawnsByRoleQuery = `
      SELECT COALESCE(role, '(none)') AS key, COUNT(*) AS n
      FROM ${eventsTable}
      WHERE event = 'agent:spawned' AND model = @key
        AND timestamp >= ${sinceTs}${clientEx.clause}
      GROUP BY key ORDER BY n DESC LIMIT 25
    `;

    const [
      costTotals,
      costTrend,
      costByTaskType,
      modelOutcomes,
      outcomesByRole,
      spawnsByRole,
    ] = await Promise.all([
      runQuery(costTotalsQuery, costParams),
      runQuery(costTrendQuery, costParams),
      runQuery(costByTaskTypeQuery, costParams),
      runQuery(modelOutcomesQuery, clientParams),
      runQuery(outcomesByRoleQuery, clientParams),
      runQuery(spawnsByRoleQuery, clientParams),
    ]);

    const ct = costTotals[0] ?? {};
    const mo = modelOutcomes[0] ?? {};
    const moTotal = toNumber(mo.total as number | string | undefined);
    const moOk = toNumber(mo.succeeded as number | string | undefined);

    return {
      ...base,
      title: `모델 "${key}" 분해`,
      note: `최근 ${rangeDays}일 · cost_logs(운영자 제외) + task_outcomes`,
      stats: [
        {
          label: "총 비용",
          value: toNumber(ct.cost as number | string | undefined),
          format: "cost",
        },
        {
          label: "총 토큰",
          value: toNumber(ct.tokens as number | string | undefined),
          format: "int",
        },
        {
          label: "태스크 성공률",
          value: moTotal > 0 ? moOk / moTotal : 0,
          format: "pct",
        },
        {
          label: "평균 완료시간",
          value: toNumber(mo.avgDurationMs as number | string | undefined),
          format: "duration",
        },
      ],
      breakdowns: [
        {
          title: "태스크 유형별 비용",
          rows: foldDistribution(costByTaskType, "key"),
          format: "cost",
        },
        {
          title: "역할별 태스크 수",
          rows: foldDistribution(outcomesByRole, "key"),
          format: "int",
        },
        {
          title: "역할별 스폰 수",
          rows: foldDistribution(spawnsByRole, "key"),
          format: "int",
        },
      ],
      trend: costTrend.map((r) => ({
        date: String(r.date ?? ""),
        value: toNumber(r.n as number | string | undefined),
      })),
      trendLabel: "일별 비용 추이",
      trendFormat: "cost",
    };
  },
);

// ═══════════════════════════════════════════════════════════════════
// marketing_contacts SoT — Firestore 운영 SoT + BigQuery 분석 미러
// ═══════════════════════════════════════════════════════════════════
//
// 설계(cf 감사 qFEzBLhBCpGIBnJJg9Xg, 티켓 kKgzB91jskKwAgxT5Ukp):
//  - Firestore marketing_contacts/{sha256(email)} 가 운영 SoT.
//    평문 이메일은 저장하지 않는다 — AES-256-GCM 암호문(emailEnc) + 해시만.
//  - BQ marblo_marketing.contacts_daily 는 분석 미러(스냅샷 append) —
//    암호문조차 내보내지 않는다(해시·도메인·상태·세그먼트만).
//  - 마케팅 발송 게이트(emailable)의 단일소스 = marketingContacts.isEmailable.
//  - ★Auth 계정 대부분은 custom-token(에이전트) — providerData 에
//    google.com/password 가 있는 실가입만 컨택트로 취급한다.
const REAL_SIGNUP_PROVIDERS = new Set(["google.com", "password"]);

function isRealSignupUser(user: admin.auth.UserRecord): boolean {
  if (!user.email) return false;
  return user.providerData.some((p) => REAL_SIGNUP_PROVIDERS.has(p.providerId));
}

function marketingContactRef(
  contactId: string,
): admin.firestore.DocumentReference {
  return db.collection(MARKETING_CONTACTS_COLLECTION).doc(contactId);
}

export interface MarketingContactUpsertInput {
  email: string;
  uid?: string | null;
  source?: ContactSource;
  locale?: string | null;
  signupAt?: Date | null;
  /** undefined = 변경 없음, null = 명시적 해제 */
  founderStatus?: string | null;
  subscription?: ContactSubscription | null;
  /** 동의 부여 요청 — 기존 상태가 unknown/pending 일 때만 적용(revoked 는 절대 되살리지 않음) */
  grantConsent?: {
    source: string;
    version: string;
    legalBasis: EmailMarketingConsent["legalBasis"];
    consentedAt?: unknown | null;
  } | null;
  /**
   * 재동의 대상 풀 편입(unknown → pending). 마케팅 동의가 아니다 — 발송 불가
   * 상태 그대로이며, 정식 재동의 캠페인에서 grantConsent 로만 granted 가 된다.
   * (waitlist 폼 체크박스 = 활동/인용 동의, COMPLIANCE-AUDIT.md D2)
   */
  markPending?: {
    source: string;
    detail: string;
  } | null;
  /**
   * 동의 철회(granted|pending → revoked). 설정 화면에서 마케팅 동의를 끄는
   * 경로가 여기로 온다. ★철회는 동의를 이긴다 — 같은 요청에 grantConsent 가
   * 함께 와도 revoke 가 적용된다(mergeEmailConsent).
   */
  revokeConsent?: {
    source: string;
    detail: string;
  } | null;
  /** consent_events.actor — "system" | "backfill" | admin uid 등 */
  actor: string;
}

export interface MarketingContactUpsertResult {
  contactId: string;
  created: boolean;
  consentGranted: boolean;
  consentPending: boolean;
  consentRevoked: boolean;
}

/**
 * 컨택트 upsert 의 단일 경로. 훅 4개와 백필이 전부 여기로 수렴한다.
 * 병합 규칙:
 *  - consent: unknown|pending → granted, unknown → pending 만 허용.
 *    revoked 는 훅으로 되살리지 않는다(재동의는 별도 명시 경로에서만).
 *  - signupAt: 더 이른 값을 유지(멱등).
 *  - uid/founderStatus/subscription: 들어온 값이 있으면 갱신.
 *  - emailEnc: 최초 1회 암호화 저장. 키 미설정 환경에선 null(해시로만 운영,
 *    키 설정 후 백필 재실행으로 채움).
 */
export async function upsertMarketingContact(
  input: MarketingContactUpsertInput,
): Promise<MarketingContactUpsertResult> {
  const normalized = normalizeMarketingEmail(input.email);
  if (!normalized || !normalized.includes("@")) {
    throw new Error("invalid email for marketing contact");
  }
  const contactId = contactIdForEmail(normalized);
  const ref = marketingContactRef(contactId);
  const snap = await ref.get();
  const existing = snap.exists
    ? (snap.data() as Partial<MarketingContactDoc>)
    : null;

  // ── consent 병합 ──
  // 판정은 순수 모듈(mergeEmailConsent)이 단독으로 한다 — 우선순위·불변식은
  // 거기서 단위테스트된다. 여기서는 serverTimestamp 센티넬만 주입한다.
  const merged = mergeEmailConsent(
    existing?.emailMarketingConsent,
    {
      grant: input.grantConsent,
      pending: input.markPending,
      revoke: input.revokeConsent,
    },
    admin.firestore.FieldValue.serverTimestamp(),
  );
  const consent = merged.consent;
  const consentGranted = merged.event?.type === "granted";
  const consentPending = merged.event?.type === "pending_init";
  const consentRevoked = merged.event?.type === "revoked";

  // ── unsubscribe 초기화(기존 값 보존) ──
  const unsubscribe = existing?.unsubscribe ?? {
    status: "subscribed" as const,
    tokenHash: MARKETING_UNSUB_SECRET
      ? sha256Hex(unsubscribeTokenForContact(contactId, MARKETING_UNSUB_SECRET))
      : null,
    unsubscribedAt: null,
  };

  // ── emailEnc: 최초 1회만 생성 ──
  let emailEnc = existing?.emailEnc ?? null;
  if (!emailEnc && parseEncKey(MARKETING_EMAIL_ENC_KEY)) {
    emailEnc = encryptEmail(normalized, MARKETING_EMAIL_ENC_KEY);
  }

  // ── signupAt: 더 이른 값 유지 ──
  const existingSignupMs = tsToMillis(existing?.signupAt);
  const inputSignupMs = input.signupAt ? input.signupAt.getTime() : null;
  let signupAt: unknown | null = existing?.signupAt ?? null;
  if (
    inputSignupMs != null &&
    (existingSignupMs == null || inputSignupMs < existingSignupMs)
  ) {
    signupAt = admin.firestore.Timestamp.fromMillis(inputSignupMs);
  }

  const uid = input.uid ?? existing?.uid ?? null;
  const founderStatus =
    input.founderStatus !== undefined
      ? input.founderStatus
      : (existing?.founderStatus ?? null);
  const subscription: ContactSubscription = input.subscription ??
    existing?.subscription ?? {
      plan: null,
      status: null,
      provider: null,
      periodEnd: null,
    };

  // ── 파생: lifecycle·세그먼트 ──
  const existingSegments = Array.isArray(existing?.segments)
    ? (existing?.segments as string[])
    : [];
  const flags: ContactFlags = {
    hasWaitlist:
      existingSegments.includes("waitlist") || input.source === "waitlist",
    hasAuthAccount: !!uid,
    isFounder: founderStatus != null && founderStatus !== "rejected",
    founderRejected: founderStatus === "rejected",
    hasActivePaidSubscription:
      subscription.status === "active" &&
      (subscription.provider === "toss" || subscription.provider === "paddle"),
    hasActiveFounderGrant:
      subscription.status === "active" &&
      subscription.provider === "founder_grant",
  };

  const docPatch: Partial<MarketingContactDoc> & Record<string, unknown> = {
    uid,
    normalizedEmailHash: contactId,
    emailEnc,
    emailDomain: emailDomainOf(normalized),
    source: existing?.source ?? input.source ?? "manual",
    locale: existing?.locale ?? input.locale ?? "ko",
    signupAt,
    founderStatus,
    subscription,
    emailMarketingConsent: consent,
    unsubscribe,
    segments: deriveSegments(flags),
    lifecycleStage: deriveLifecycleStage(flags),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(existing
      ? {}
      : {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }),
  };
  await ref.set(docPatch, { merge: true });

  // 상태가 실제로 바뀐 경우에만 감사 이벤트를 남긴다(멱등 — 재실행해도 중복 없음).
  if (merged.event) {
    await ref
      .collection(CONSENT_EVENTS_SUBCOLLECTION)
      .add({
        type: merged.event.type,
        channel: "email",
        source: merged.event.source,
        actor: input.actor,
        detail: merged.event.detail,
        at: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch((err) =>
        console.warn(
          "[marketing-contacts] consent_events 기록 실패:",
          contactId.slice(0, 8),
          err,
        ),
      );
  }

  return {
    contactId,
    created: !existing,
    consentGranted,
    consentPending,
    consentRevoked,
  };
}

/**
 * 마케팅 발송 게이트 — 발송 직전 단일 판정.
 * 컨택트 없음/동의 없음/수신거부 전부 발송 불가(consent-based, 안전 기본값).
 * 게이트 조회 실패도 발송 불가로 처리한다(오발송보다 미발송이 낫다).
 */
async function marketingEmailGate(
  email: string,
): Promise<{ ok: boolean; reason: string }> {
  try {
    const snap = await marketingContactRef(contactIdForEmail(email)).get();
    const verdict = isEmailable(
      snap.exists ? (snap.data() as MarketingContactDoc) : null,
    );
    return { ok: verdict.ok, reason: verdict.reason };
  } catch (err) {
    console.warn(
      "[marketing-contacts] 게이트 조회 실패 — 발송 차단:",
      maskEmailForLog(email),
      err,
    );
    return { ok: false, reason: "gate_error" };
  }
}

/**
 * 마케팅 메일 배송 부속(one-click unsubscribe): List-Unsubscribe 헤더 + 푸터.
 * 시크릿/베이스URL 미설정이면 null — 호출부는 그대로 발송하되 배포 체크리스트에
 * 시크릿 설정이 포함돼야 한다(docs/MARKETING_CONTACTS.md).
 */
function marketingEmailDelivery(email: string): {
  headers: Record<string, string>;
  footerHtml: string;
  footerText: string;
} | null {
  if (!MARKETING_UNSUB_SECRET || !FUNCTIONS_BASE_URL) return null;
  const contactId = contactIdForEmail(email);
  const url = buildUnsubscribeUrl(
    FUNCTIONS_BASE_URL,
    contactId,
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

/** 마케팅 메일 본문에 수신거부 푸터를 덧붙인다(HTML 은 </body> 직전 삽입 시도). */
function withUnsubscribeFooter(
  content: FounderEmailContent,
  delivery: { footerHtml: string; footerText: string },
): FounderEmailContent {
  const html = content.html.includes("</body>")
    ? content.html.replace("</body>", `${delivery.footerHtml}</body>`)
    : content.html + delivery.footerHtml;
  return {
    subject: content.subject,
    html,
    text: content.text + delivery.footerText,
  };
}

// ─── write 훅 1: 실가입 Auth 계정 생성 → 컨택트 upsert ────────────────
// custom-token(에이전트) 계정은 providerData 가 비어 걸러진다.
// 마케팅 동의 증거가 없으므로 consent 는 부여하지 않는다(unknown → 발송 불가).
export const syncMarketingContactOnAuthCreate = functions.auth
  .user()
  .onCreate(async (user) => {
    try {
      if (!isRealSignupUser(user)) return;
      const creation = user.metadata.creationTime
        ? new Date(user.metadata.creationTime)
        : null;
      await upsertMarketingContact({
        email: user.email as string,
        uid: user.uid,
        source: "auth_signup",
        signupAt: creation,
        actor: "system:auth_onCreate",
      });
    } catch (err) {
      console.warn(
        "[marketing-contacts] auth onCreate 훅 실패:",
        user.uid,
        err,
      );
    }
  });

// ─── write 훅 1b: users/{uid} 마케팅 동의 → 컨택트 consent 동기화 ─────
//
// ★이 훅이 "가입 시 받은 동의"를 발송 게이트까지 잇는 유일한 경로다.
// 가입 폼(marblo-web signup)과 설정 화면(my/privacy)이 둘 다
// users/{uid}.webPrivacyConsent 에 저장하므로 두 경로가 여기로 수렴한다.
//
// ★순서 무관(핵심): auth onCreate 훅과 가입 폼의 saveConsent 는 실행 순서가
// 보장되지 않는다. 어느 쪽이 먼저여도 최종 상태는 granted 로 수렴한다.
//   - onCreate 먼저: 컨택트가 unknown 으로 생성 → 이 훅이 unknown→granted 승격
//   - saveConsent 먼저: 이 훅이 컨택트를 granted 로 생성 → 뒤늦은 onCreate 는
//     grantConsent 없이 upsert 하므로 mergeEmailConsent 가 granted 를 보존
//
// ★PIPA: marketing 이 false 인 사용자는 절대 건드리지 않는다(승격도, 철회도).
// true→false 전이만 철회로 본다. 철회는 되돌릴 수 없는 방향으로만 적용된다.
export const syncMarketingConsentOnUserWrite = functions.firestore
  .document("users/{uid}")
  .onWrite(async (change, context) => {
    const uid = context.params.uid as string;
    try {
      if (!change.after.exists) return; // 삭제는 미러하지 않음(감사 이력 보존)
      const action = decideMarketingConsentSync(
        change.before.exists ? (change.before.data() as UserDocRaw) : null,
        change.after.data() as UserDocRaw,
      );
      if (action.kind === "none") return;

      // 이메일은 users 문서가 아니라 Auth 를 SoT 로 삼는다(문서에 email 필드가
      // 없을 수 있고, 있어도 클라이언트가 쓰는 값이라 신뢰하지 않는다).
      // 에이전트 custom-token 계정은 isRealSignupUser 가 걸러낸다.
      const user = await admin.auth().getUser(uid);
      if (!isRealSignupUser(user)) return;

      if (action.kind === "grant") {
        await upsertMarketingContact({
          email: user.email as string,
          uid,
          source: "auth_signup",
          locale: action.locale,
          grantConsent: {
            source: "web_privacy_consent",
            version: action.version,
            legalBasis: "explicit_opt_in",
            consentedAt: action.consentedAt,
          },
          actor: "system:userConsent_onWrite",
        });
      } else {
        await upsertMarketingContact({
          email: user.email as string,
          uid,
          source: "auth_signup",
          revokeConsent: {
            source: "web_privacy_consent",
            detail: "user unchecked marketing consent in webPrivacyConsent",
          },
          actor: "system:userConsent_onWrite",
        });
      }
    } catch (err) {
      // auth/user-not-found 는 정상 케이스(계정 삭제 후 남은 문서 write 등).
      const code = (err as { code?: string }).code;
      if (code === "auth/user-not-found") return;
      console.warn("[marketing-contacts] users onWrite 훅 실패:", uid, err);
    }
  });

// ─── 조회: 내 마케팅 동의 상태(재동의 배너 게이트) ────────────────────
//
// 앱의 재동의 배너는 "아직 아무 결정도 안 한 파운더" 에게만 떠야 한다. 그런데
// marketing_contacts 는 Firestore 룰에서 클라이언트 접근 전면 차단(Admin SDK
// 전용)이라 렌더러가 직접 못 읽는다 — 그래서 상태 플래그만 돌려주는 이 얇은
// onCall 을 둔다.
//
// ★쓰기는 하지 않는다. 이 호출은 순수 read 이고, 동의 grant 는 여전히
//   users/{uid}.webPrivacyConsent.marketing → 훅 1b 경로 하나뿐이다(새 훅 없음).
// ★응답에 이메일은 없다 — 평문도, emailEnc 도, 해시도. 배너 판정에 불필요하다.
// ★판정은 순수 함수 marketingContacts.marketingConsentStatusResponse 로 수렴
//   (단위테스트로 고정) — 여기선 IO 와 에러 경계만 책임진다.
export const getMyMarketingConsentStatus = functions.https.onCall(
  async (_data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다.",
      );
    }
    // 이메일은 Auth 를 SoT 로 삼는다(훅 1b 와 동일). custom-token 에이전트
    // 계정은 isRealSignupUser 가 걸러낸다 — 배너 대상이 아니다.
    let user: admin.auth.UserRecord;
    try {
      user = await admin.auth().getUser(uid);
    } catch (err) {
      if ((err as { code?: string }).code === "auth/user-not-found") {
        return marketingConsentStatusResponse(null);
      }
      console.warn("[getMyMarketingConsentStatus] auth lookup failed", {
        uid,
        code: (err as { code?: string }).code ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new functions.https.HttpsError(
        "unavailable",
        "마케팅 동의 상태를 확인할 수 없습니다.",
      );
    }
    if (!isRealSignupUser(user)) {
      return marketingConsentStatusResponse(null);
    }

    const contactId = contactIdForEmail(user.email as string);
    let snap: admin.firestore.DocumentSnapshot;
    try {
      snap = await marketingContactRef(contactId).get();
    } catch (err) {
      console.warn("[getMyMarketingConsentStatus] contact read failed", {
        uid,
        code: (err as { code?: string }).code ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new functions.https.HttpsError(
        "unavailable",
        "마케팅 동의 상태를 확인할 수 없습니다.",
      );
    }

    try {
      return marketingConsentStatusResponse(
        snap.exists ? (snap.data() as Partial<MarketingContactDoc>) : null,
      );
    } catch (err) {
      console.warn("[getMyMarketingConsentStatus] contact view failed", {
        uid,
        contactDocExists: snap.exists,
        code: (err as { code?: string }).code ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new functions.https.HttpsError(
        "data-loss",
        "마케팅 동의 상태 데이터 형식이 올바르지 않습니다.",
      );
    }
  },
);

// ─── write 훅 2: waitlist 신청 → 컨택트 upsert ───────────────────────
// ★waitlist 폼의 agreed=true 는 "활동/인용 동의"이지 마케팅 수신동의가 아니다
// (marblo-web/docs/COMPLIANCE-AUDIT.md D2, PIPA Med — 처리방침 링크·수집목적
// 미명시). 그것만으로는 granted 로 승격하지 않고 pending(재동의 대상 풀)으로만
// 적재한다.
// ★폼에 별도 마케팅 수신동의 체크박스(marketingConsent, 기본 unchecked)가
// 추가됐다(zaLMLwYf) — 이것만 explicit_opt_in grant 의 근거다. 판정은
// decideWaitlistConsentGrant 단일 함수로 한다(단위테스트 가능, marketingContacts.ts).
// agreed 를 grant 근거로 끌어오지 말 것 — 동의의 출처가 다르다.
export const syncMarketingContactOnWaitlistCreate = functions.firestore
  .document("betatester50_waitlist/{docId}")
  .onCreate(async (snap) => {
    try {
      const data = snap.data() || {};
      const email = typeof data.email === "string" ? data.email : "";
      if (!email) return;
      const decision = decideWaitlistConsentGrant(data as WaitlistDocRaw);
      await upsertMarketingContact({
        email,
        source: "waitlist",
        locale: typeof data.locale === "string" ? data.locale : null,
        grantConsent:
          decision.kind === "grant"
            ? {
                source: "waitlist_form_marketing_optin",
                version: decision.version,
                legalBasis: "explicit_opt_in",
                consentedAt: decision.consentedAt,
              }
            : null,
        markPending:
          decision.kind === "pending"
            ? {
                source: "waitlist_form",
                detail:
                  "activity/quote agreement only (COMPLIANCE-AUDIT D2) — not marketing consent; re-consent required",
              }
            : null,
        actor: "system:waitlist_onCreate",
      });
    } catch (err) {
      console.warn("[marketing-contacts] waitlist 훅 실패:", snap.id, err);
    }
  });

// ─── write 훅 3: founders/{email} 변경 → founderStatus 미러 ──────────
export const syncMarketingContactOnFounderWrite = functions.firestore
  .document("founders/{email}")
  .onWrite(async (change, context) => {
    try {
      const email = context.params.email as string;
      if (!email || !email.includes("@")) return;
      if (!change.after.exists) return; // 삭제는 미러하지 않음(감사 이력 보존)
      const fd = change.after.data() || {};
      const founderStatus =
        typeof fd.status === "string"
          ? fd.status
          : fd.accessGrantedAt
            ? "selected"
            : "pending";
      await upsertMarketingContact({
        email,
        source: "founder",
        locale: typeof fd.locale === "string" ? fd.locale : null,
        founderStatus,
        actor: "system:founder_onWrite",
      });
    } catch (err) {
      console.warn(
        "[marketing-contacts] founders 훅 실패:",
        context.params.email,
        err,
      );
    }
  });

// ─── write 훅 4: subscriptions/{uid} 변경 → 구독 블록 미러 ───────────
export const syncMarketingContactOnSubscriptionWrite = functions.firestore
  .document("subscriptions/{uid}")
  .onWrite(async (change, context) => {
    try {
      if (!change.after.exists) return;
      const uid = context.params.uid as string;
      const user = await admin
        .auth()
        .getUser(uid)
        .catch(() => null);
      if (!user || !isRealSignupUser(user)) return; // 에이전트 계정 제외
      const sub = change.after.data() || {};
      await upsertMarketingContact({
        email: user.email as string,
        uid,
        source: "subscription",
        subscription: {
          plan: typeof sub.planType === "string" ? sub.planType : null,
          status: typeof sub.status === "string" ? sub.status : null,
          provider:
            typeof sub.paymentProvider === "string"
              ? sub.paymentProvider
              : null,
          periodEnd: sub.currentPeriodEnd ?? null,
        },
        actor: "system:subscription_onWrite",
      });
    } catch (err) {
      console.warn(
        "[marketing-contacts] subscriptions 훅 실패:",
        context.params.uid,
        err,
      );
    }
  });

// ─── 백필: Auth(실가입만)·waitlist·founders·subscriptions → 컨택트 ────
// 어드민 전용. dryRun 기본 true — 실적재 전 대상 규모를 확인한다.
// ★Auth 5,025 중 custom-token(에이전트) 계정을 반드시 걸러낸다(실측 2026-07-24:
//   실가입 56, 나머지 4,969 는 에이전트 계정).
// ★consent: users/{uid}.webPrivacyConsent.marketing === true 인 실가입자만
//   granted(explicit_opt_in)로 올린다(1b 단계). waitlist agreed 는 pending
//   까지만 — 마케팅 수신동의가 아니다(COMPLIANCE-AUDIT D2). 그 외 소스는
//   consent 를 건드리지 않는다.
export const backfillMarketingContacts = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);
    const dryRun = data?.dryRun !== false; // 기본 true

    if (!dryRun && !parseEncKey(MARKETING_EMAIL_ENC_KEY)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "MARKETING_EMAIL_ENC_KEY(base64 32B)가 설정돼야 실적재 가능 — 이메일은 암호화 저장만 허용",
      );
    }
    if (!MARKETING_UNSUB_SECRET) {
      console.warn(
        "[marketing-backfill] MARKETING_UNSUB_SECRET 미설정 — unsubscribe tokenHash 없이 적재됨(시크릿 설정 후 재실행 권장)",
      );
    }

    // 1) Auth 실가입 수집
    const realUsers: Array<{
      uid: string;
      email: string;
      creationTime: string | undefined;
    }> = [];
    let authScanned = 0;
    let pageToken: string | undefined = undefined;
    do {
      const page: admin.auth.ListUsersResult = await admin
        .auth()
        .listUsers(1000, pageToken);
      authScanned += page.users.length;
      for (const u of page.users) {
        if (isRealSignupUser(u)) {
          realUsers.push({
            uid: u.uid,
            email: u.email as string,
            creationTime: u.metadata.creationTime,
          });
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);

    // 1b) users/{uid}.webPrivacyConsent → 명시 동의 조회
    //
    // ★왜 필요한가: 동의를 SoT 로 잇는 훅(syncMarketingConsentOnUserWrite)은
    //   users 문서가 "다시 써질 때"만 발화한다. 훅 배포(2026-07-22) 이전에
    //   동의한 사용자는 문서가 재기록되지 않는 한 영영 미동기로 남는다.
    //   백필이 이 갭을 메우지 않으면 granted 증가분이 0 이라 무의미하다.
    // ★판정은 훅과 같은 함수(backfillConsentGrantFromUserDoc →
    //   decideMarketingConsentSync)로만 한다. marketing === true 인 사람만
    //   granted 가 되고, 동의 기록이 없는 사람은 unknown 그대로다.
    // ★쿼리가 아니라 uid 지정 getAll 이다 — 중첩 필드 단일 인덱스 유무나
    //   인덱스 예외 설정에 결과가 좌우되면 안 되는 판정이다(누락 = 미동기 잔존,
    //   과잉 = 규제 위반).
    const explicitConsentByUid = new Map<
      string,
      NonNullable<ReturnType<typeof backfillConsentGrantFromUserDoc>>
    >();
    for (let i = 0; i < realUsers.length; i += USER_CONSENT_READ_CHUNK) {
      const chunk = realUsers.slice(i, i + USER_CONSENT_READ_CHUNK);
      if (chunk.length === 0) continue;
      const snaps = await db.getAll(
        ...chunk.map((u) => db.collection("users").doc(u.uid)),
      );
      snaps.forEach((snap, idx) => {
        if (!snap.exists) return;
        const consent = backfillConsentGrantFromUserDoc(
          snap.data() as UserDocRaw,
        );
        if (consent) explicitConsentByUid.set(chunk[idx].uid, consent);
      });
    }

    // 2) waitlist
    const waitlistSnap = await db
      .collection("betatester50_waitlist")
      .limit(WAITLIST_SCAN_LIMIT)
      .get();
    const waitlistRows = waitlistSnap.docs
      .map((d) => d.data() || {})
      .filter((v) => typeof v.email === "string" && v.email.includes("@"));

    // 3) founders
    const foundersSnap = await db.collection(FOUNDERS_COLLECTION).get();
    const founderRows = foundersSnap.docs
      .filter((d) => d.id.includes("@"))
      .map((d) => ({ email: d.id, data: d.data() || {} }));

    // 4) subscriptions (실가입 uid 만)
    const subRows: Array<{
      uid: string;
      email: string;
      sub: Record<string, unknown>;
    }> = [];
    for (const u of realUsers) {
      const subSnap = await db.collection("subscriptions").doc(u.uid).get();
      if (subSnap.exists) {
        subRows.push({
          uid: u.uid,
          email: u.email,
          sub: subSnap.data() || {},
        });
      }
    }

    const uniqueEmails = new Set<string>();
    for (const u of realUsers)
      uniqueEmails.add(normalizeMarketingEmail(u.email));
    for (const w of waitlistRows) {
      uniqueEmails.add(normalizeMarketingEmail(w.email as string));
    }
    for (const f of founderRows)
      uniqueEmails.add(normalizeMarketingEmail(f.email));

    const stats = {
      dryRun,
      authScanned,
      authRealUsers: realUsers.length,
      authSkippedNonReal: authScanned - realUsers.length,
      // ★granted 로 승격될 예정 인원 = users/{uid}.webPrivacyConsent.marketing
      // 이 true 인 실가입자. dry-run 에서 이 값을 먼저 확인하고 실적재한다
      // (실적재 후 consentGranted 는 이미 granted 인 사람을 뺀 값이라 이보다
      // 작거나 같다).
      authExplicitConsent: explicitConsentByUid.size,
      waitlistRows: waitlistRows.length,
      // ★pending(재동의 대상) 편입 예정 수 — granted 아님. 발송 가능 모수가
      // 아니다(emailable 은 explicit_opt_in 재동의 후에만 늘어난다).
      waitlistPendingEligible: waitlistRows.filter((w) => w.agreed === true)
        .length,
      founderRows: founderRows.length,
      subscriptionRows: subRows.length,
      uniqueEmails: uniqueEmails.size,
      created: 0,
      updated: 0,
      consentGranted: 0,
      consentPending: 0,
    };

    if (dryRun) {
      return {
        ...stats,
        note: "dry-run: 적재하지 않음. dryRun=false 로 실적재.",
      };
    }

    // 실적재 — 소스별 순서: auth(uid·signupAt) → waitlist(동의) → founders → subs
    const apply = async (input: MarketingContactUpsertInput) => {
      const r = await upsertMarketingContact(input);
      if (r.created) stats.created++;
      else stats.updated++;
      if (r.consentGranted) stats.consentGranted++;
      if (r.consentPending) stats.consentPending++;
      return r;
    };
    for (const u of realUsers) {
      // ★동의 기록이 있는 사람만 grantConsent 가 실린다. 없으면 null 이라
      // unknown 그대로 — 백필이 동의를 만들어내는 일은 없다.
      const consent = explicitConsentByUid.get(u.uid) ?? null;
      await apply({
        email: u.email,
        uid: u.uid,
        source: "auth_signup",
        locale: consent?.locale ?? null,
        signupAt: u.creationTime ? new Date(u.creationTime) : null,
        grantConsent: consent?.grant ?? null,
        actor: "backfill",
      });
    }
    for (const w of waitlistRows) {
      // ★pending 으로만 적재 — waitlist agreed 는 마케팅 수신동의가 아니다
      // (COMPLIANCE-AUDIT D2). emailable 모수가 작게 나오는 게 정상이다.
      await apply({
        email: w.email as string,
        source: "waitlist",
        locale: typeof w.locale === "string" ? w.locale : null,
        markPending:
          w.agreed === true
            ? {
                source: "backfill_waitlist",
                detail:
                  "activity/quote agreement only (COMPLIANCE-AUDIT D2) — not marketing consent; re-consent required",
              }
            : null,
        actor: "backfill",
      });
    }
    for (const f of founderRows) {
      const fd = f.data;
      await apply({
        email: f.email,
        source: "founder",
        locale: typeof fd.locale === "string" ? fd.locale : null,
        founderStatus:
          typeof fd.status === "string"
            ? fd.status
            : fd.accessGrantedAt
              ? "selected"
              : "pending",
        actor: "backfill",
      });
    }
    for (const s of subRows) {
      await apply({
        email: s.email,
        uid: s.uid,
        source: "subscription",
        subscription: {
          plan: typeof s.sub.planType === "string" ? s.sub.planType : null,
          status: typeof s.sub.status === "string" ? s.sub.status : null,
          provider:
            typeof s.sub.paymentProvider === "string"
              ? s.sub.paymentProvider
              : null,
          periodEnd: s.sub.currentPeriodEnd ?? null,
        },
        actor: "backfill",
      });
    }

    console.log(
      `[marketing-backfill] done: unique=${stats.uniqueEmails} created=${stats.created} updated=${stats.updated} granted=${stats.consentGranted} pending=${stats.consentPending}`,
    );
    return stats;
  },
);

// ─── one-click unsubscribe (RFC 8058) ────────────────────────────────
// GET  = 확인 페이지(버튼 1개), POST = 실제 수신거부 처리(one-click 포함).
// 토큰은 HMAC 파생·stateless 검증 — 무효 토큰이면 컨택트 존재 여부와 무관하게
// 동일한 실패 페이지(열거 방지).
const UNSUB_PAGE = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marblo</title></head><body style="font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#222">${body}<hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px"/><p style="font-size:12px;color:#999">Marblo · team@marblo.app</p></body></html>`;

export const unsubscribeMarketingEmail = functions.https.onRequest(
  async (req, res) => {
    try {
      const contactId = String(req.query.c ?? req.body?.c ?? "");
      const token = String(req.query.t ?? req.body?.t ?? "");
      const valid =
        !!MARKETING_UNSUB_SECRET &&
        verifyUnsubscribeToken(contactId, token, MARKETING_UNSUB_SECRET);

      if (!valid) {
        res
          .status(400)
          .send(
            UNSUB_PAGE(
              '<h1 style="font-size:20px">링크가 유효하지 않습니다</h1><p>수신거부 링크가 만료됐거나 잘못됐어요. team@marblo.app 으로 회신 주시면 수동으로 처리해 드립니다.</p><p style="color:#666">This unsubscribe link is invalid. Reply to team@marblo.app and we\'ll handle it manually.</p>',
            ),
          );
        return;
      }

      if (req.method === "GET") {
        const action = `?c=${encodeURIComponent(
          contactId,
        )}&t=${encodeURIComponent(token)}`;
        res
          .status(200)
          .send(
            UNSUB_PAGE(
              `<h1 style="font-size:20px">마케팅 이메일 수신거부</h1><p>버튼을 누르면 마블로의 마케팅 이메일을 더 이상 받지 않습니다. (서비스·결제 관련 필수 안내는 계속 발송될 수 있어요.)</p><form method="POST" action="${action}"><button type="submit" style="background:#111;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:15px;cursor:pointer">수신거부 / Unsubscribe</button></form>`,
            ),
          );
        return;
      }

      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      const ref = marketingContactRef(contactId);
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data() as Partial<MarketingContactDoc>;
        if (data.unsubscribe?.status !== "unsubscribed") {
          const prevConsent = data.emailMarketingConsent;
          await ref.set(
            {
              emailMarketingConsent: {
                status: "revoked",
                source: "unsubscribe_link",
                version: prevConsent?.version ?? "",
                consentedAt: prevConsent?.consentedAt ?? null,
                revokedAt: admin.firestore.FieldValue.serverTimestamp(),
                legalBasis: prevConsent?.legalBasis ?? "none",
              },
              unsubscribe: {
                status: "unsubscribed",
                tokenHash: sha256Hex(token),
                unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          await ref
            .collection(CONSENT_EVENTS_SUBCOLLECTION)
            .add({
              type: "unsubscribed",
              channel: "email",
              source: "unsubscribe_link",
              actor: "unsubscribe_link",
              detail: `method=${req.method} oneClick=${
                req.body?.["List-Unsubscribe"] === "One-Click"
              }`,
              at: admin.firestore.FieldValue.serverTimestamp(),
            })
            .catch((err) =>
              console.warn(
                "[unsubscribe] consent_events 기록 실패:",
                contactId.slice(0, 8),
                err,
              ),
            );
        }
      }
      // 컨택트가 없어도 성공 응답(열거 방지 + 멱등).
      res
        .status(200)
        .send(
          UNSUB_PAGE(
            '<h1 style="font-size:20px">수신거부가 완료됐습니다</h1><p>마케팅 이메일을 더 이상 보내지 않습니다. 언제든 team@marblo.app 으로 연락 주세요.</p><p style="color:#666">You\'ve been unsubscribed from Marblo marketing emails.</p>',
          ),
        );
    } catch (err) {
      console.warn("[unsubscribe] 처리 실패:", err);
      res
        .status(500)
        .send(
          UNSUB_PAGE(
            '<h1 style="font-size:20px">일시적인 오류가 발생했습니다</h1><p>잠시 후 다시 시도하거나 team@marblo.app 으로 회신해 주세요.</p>',
          ),
        );
    }
  },
);

// ─── BigQuery 미러: marblo_marketing.contacts_daily (+ contacts_latest 뷰) ──
// 일1회 전체 스냅샷 append(파티션=snapshot_date). PII 최소화 — 평문 이메일과
// emailEnc 는 절대 미러하지 않는다(contactToBqRow 가 구조적으로 배제).
const BQ_MARKETING_DATASET = "marblo_marketing";
const BQ_CONTACTS_TABLE = "contacts_daily";

export async function mirrorMarketingContactsToBqInternal(): Promise<{
  snapshotDate: string;
  rows: number;
}> {
  // KST 기준 스냅샷 날짜
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const snapshotDate = kstNow.toISOString().slice(0, 10);

  const dataset = bigquery.dataset(BQ_MARKETING_DATASET);
  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    await dataset.create();
  }
  const table = dataset.table(BQ_CONTACTS_TABLE);
  const [tableExists] = await table.exists();
  if (!tableExists) {
    await table.create({
      schema: MARKETING_CONTACTS_BQ_SCHEMA as unknown as {
        name: string;
        type: string;
      }[],
      timePartitioning: { type: "DAY", field: "snapshot_date" },
    });
  }

  const snap = await db.collection(MARKETING_CONTACTS_COLLECTION).get();
  const rows = snap.docs.map((d) =>
    contactToBqRow(
      d.id,
      d.data() as Partial<MarketingContactDoc>,
      snapshotDate,
    ),
  );

  // 같은 날 재실행 멱등: 해당 파티션 선삭제 후 적재.
  // ★스트리밍 버퍼 제약: 직전 ~90분 내 insert 된 행이 있으면 DELETE 가 실패한다.
  //   그 경우 여기서 throw 로 중단하는 게 맞다 — 삭제 실패 후 insert 를 강행하면
  //   같은 파티션에 중복 행이 쌓여 contacts_latest 가 뻥튀기된다.
  await bigquery.query({
    query: `DELETE FROM \`${BQ_MARKETING_DATASET}.${BQ_CONTACTS_TABLE}\` WHERE snapshot_date = @d`,
    params: { d: snapshotDate },
    location: BQ_LOCATION,
  });
  for (let i = 0; i < rows.length; i += 500) {
    await table.insert(rows.slice(i, i + 500));
  }

  // 최신 스냅샷 뷰 갱신(분석·세그먼트 쿼리 진입점).
  await bigquery.query({
    query: `CREATE OR REPLACE VIEW \`${BQ_MARKETING_DATASET}.contacts_latest\` AS
      SELECT * FROM \`${BQ_MARKETING_DATASET}.${BQ_CONTACTS_TABLE}\`
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM \`${BQ_MARKETING_DATASET}.${BQ_CONTACTS_TABLE}\`)`,
    location: BQ_LOCATION,
  });

  console.log(
    `[marketing-bq-mirror] snapshot=${snapshotDate} rows=${rows.length}`,
  );
  return { snapshotDate, rows: rows.length };
}

export const scheduledMirrorMarketingContacts = functions.pubsub
  .schedule("45 4 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    try {
      await mirrorMarketingContactsToBqInternal();
    } catch (err) {
      console.warn("[marketing-bq-mirror] 실패:", err);
    }
    return null;
  });

// 수동 트리거(어드민) — 백필 직후 첫 미러 등.
export const mirrorMarketingContactsToBq = functions.https.onCall(
  async (_data, context) => {
    requireAdmin(context);
    return mirrorMarketingContactsToBqInternal();
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 어드민 프로젝트 감사 (읽기 전용) — marblo.app/admin "프로젝트 감사" 탭
// ════════════════════════════════════════════════════════════════════════════
// 앱(Electron)의 ProjectAuditPanel 계열이 주던 프로젝트 운영 관찰가능성을 웹
// 어드민으로 넓힌다. 기존 어드민 표면은 전부 비즈니스 축(파운더·대기자·버그·BQ)
// 이라 tasks/agents/missions/원장은 웹에서 아예 볼 수 없었다.
//
// ★왜 콜러블인가 (클라 직접 Firestore read 가 아니라)
//   Firestore 룰은 쿼리 결과의 **모든** 문서가 통과해야 쿼리를 허용한다. 웹 클라에
//   admin 분기를 열면 클라 쿼리 제약이 룰과 조금이라도 어긋나는 순간 쿼리 전체가
//   permission-denied 로 죽는다(#406/#428 의 실패 모드). 그래서 **룰은 한 줄도
//   건드리지 않고**, 서버가 Admin SDK 로 읽어 조립한 뷰만 내려보낸다.
//
// ★범위: Phase1 = read only. 이 핸들러에는 write 경로가 아예 없다.
// ★판정·집계·마스킹은 전부 projectAudit.ts(순수, node --test)에 있다. 여기서는
//   Firestore fetch 와 실패 격리만 한다.

/** 컬렉션당 스캔 상한. 감사 뷰는 최근 활동을 보는 화면이라 전량 스캔하지 않는다. */
const AUDIT_TASK_SCAN_LIMIT = 500;
const AUDIT_AGENT_SCAN_LIMIT = 300;
const AUDIT_ACTIVITY_SCAN_LIMIT = 500;
const AUDIT_LEDGER_SCAN_LIMIT = 500;
const AUDIT_MISSION_SCAN_LIMIT = 200;
const AUDIT_MERGE_SCAN_LIMIT = 200;
const AUDIT_PROJECT_SCAN_LIMIT = 200;

function auditDocs(
  snap: FirebaseFirestore.QuerySnapshot,
): Array<Record<string, unknown> & { id: string }> {
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/**
 * 쿼리 하나가 실패해도(인덱스 부재 등) 화면 전체를 죽이지 않는다 — 감사 뷰에서
 * 조용한 누락은 나쁘지만, 한 소스 때문에 나머지를 못 보는 것도 나쁘다. 실패는
 * 빈 배열 + `ok:false` 로 돌려 호출부가 notes 에 그 사실을 **밝히게** 한다.
 */
async function auditQuery(
  label: string,
  run: () => Promise<FirebaseFirestore.QuerySnapshot>,
): Promise<{
  ok: boolean;
  docs: Array<Record<string, unknown> & { id: string }>;
}> {
  try {
    return { ok: true, docs: auditDocs(await run()) };
  } catch (err) {
    functions.logger.warn(
      `[getAdminProjectAudit] ${label} 조회 실패: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ok: false, docs: [] };
  }
}

export const getAdminProjectAudit = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);

    const requestedProjectId =
      typeof data?.projectId === "string" && data.projectId.trim() !== ""
        ? data.projectId.trim()
        : null;
    const timelineLimit = Math.min(
      500,
      Math.max(20, Math.floor(Number(data?.timelineLimit) || 0) || 200),
    );

    // 1) 프로젝트 목록 — 셀렉터용. 정렬은 최신 갱신순.
    const projectsRes = await auditQuery("projects", () =>
      db
        .collection("projects")
        .orderBy("updatedAt", "desc")
        .limit(AUDIT_PROJECT_SCAN_LIMIT)
        .get(),
    );
    // orderBy 가 인덱스/필드 부재로 실패하면 무정렬로 한 번 더 시도한다 —
    // 정렬 실패 때문에 프로젝트 목록 자체가 비면 화면이 통째로 못 뜬다.
    const projects = projectsRes.ok
      ? projectsRes.docs
      : (
          await auditQuery("projects(unordered)", () =>
            db.collection("projects").limit(AUDIT_PROJECT_SCAN_LIMIT).get(),
          )
        ).docs;

    // 요청이 없으면 첫 프로젝트를 기본 선택(빈 화면 대신 무언가 보이게).
    const projectId =
      requestedProjectId ?? (projects.length > 0 ? projects[0].id : null);

    if (!projectId) {
      return buildProjectAudit({
        projects,
        projectId: null,
        tasks: [],
        agents: [],
        activities: [],
        ledger: [],
        missions: [],
        merges: [],
        agentsLoaded: true,
        timelineLimit,
      });
    }

    // 2) 프로젝트 축 소스들. 서로 독립이라 병렬로 읽는다.
    const [tasksRes, agentsRes, missionsRes, ledgerRes, mergesRes] =
      await Promise.all([
        auditQuery("tasks", () =>
          db
            .collection("tasks")
            .where("projectId", "==", projectId)
            .limit(AUDIT_TASK_SCAN_LIMIT)
            .get(),
        ),
        auditQuery("agents", () =>
          db
            .collection("agents")
            .where("projectId", "==", projectId)
            .limit(AUDIT_AGENT_SCAN_LIMIT)
            .get(),
        ),
        auditQuery("missions", () =>
          db
            .collection("missions")
            .where("projectId", "==", projectId)
            .limit(AUDIT_MISSION_SCAN_LIMIT)
            .get(),
        ),
        auditQuery("audit_logs", () =>
          db
            .collection("audit_logs")
            .where("projectId", "==", projectId)
            .orderBy("createdAt", "desc")
            .limit(AUDIT_LEDGER_SCAN_LIMIT)
            .get(),
        ),
        auditQuery("merge_history", () =>
          db
            .collection("merge_history")
            .where("projectId", "==", projectId)
            .limit(AUDIT_MERGE_SCAN_LIMIT)
            .get(),
        ),
      ]);

    // 3) 활동은 taskId 축이라 이 프로젝트의 티켓 id 로 조회한다.
    //    `in` 절은 30개 상한이라 청크로 나눈다. 티켓이 많으면 최근 갱신순 상위만
    //    본다 — 잘린 사실은 아래 notes 에 남긴다.
    const taskIds = tasksRes.docs.map((t) => t.id);
    const ACTIVITY_TASK_CAP = 90; // 30 × 3 청크
    const orderedTaskIds = [...tasksRes.docs]
      .sort((a, b) => {
        const av = toMillis(a.updatedAt) ?? 0;
        const bv = toMillis(b.updatedAt) ?? 0;
        return bv - av;
      })
      .map((t) => t.id);
    const activityTaskIds = orderedTaskIds.slice(0, ACTIVITY_TASK_CAP);

    const activityChunks: string[][] = [];
    for (let i = 0; i < activityTaskIds.length; i += 30) {
      activityChunks.push(activityTaskIds.slice(i, i + 30));
    }
    const activityResults = await Promise.all(
      activityChunks.map((chunk, i) =>
        auditQuery(`activities[${i}]`, () =>
          db
            .collection("activities")
            .where("taskId", "in", chunk)
            .limit(AUDIT_ACTIVITY_SCAN_LIMIT)
            .get(),
        ),
      ),
    );
    const activities = activityResults.flatMap((r) => r.docs);

    const result = buildProjectAudit({
      projects,
      projectId,
      tasks: tasksRes.docs,
      agents: agentsRes.docs,
      activities,
      ledger: ledgerRes.docs,
      missions: missionsRes.docs,
      merges: mergesRes.docs,
      // ★에이전트 조회가 실패했으면 "살아있는 에이전트가 없다"가 아니라
      //   "모른다" 다. 그 구분이 고아 클레임 오경보를 막는다.
      agentsLoaded: agentsRes.ok,
      timelineLimit,
    });

    // 4) 부분 실패·절단을 화면에 정직하게 밝힌다(조용한 누락 금지).
    const failed: string[] = [];
    if (!tasksRes.ok) failed.push("티켓");
    if (!agentsRes.ok) failed.push("에이전트");
    if (!missionsRes.ok) failed.push("미션");
    if (!ledgerRes.ok) failed.push("원장");
    if (!mergesRes.ok) failed.push("머지 내역");
    if (activityResults.some((r) => !r.ok)) failed.push("활동");
    if (failed.length > 0) {
      result.notes.push(
        `일부 소스를 읽지 못했다: ${failed.join(", ")}. 해당 칸은 비어 보일 수 있다(0 이 아니라 '모름').`,
      );
    }
    if (taskIds.length > activityTaskIds.length) {
      result.notes.push(
        `활동 타임라인은 최근 갱신 티켓 ${activityTaskIds.length}건 기준이다(전체 ${taskIds.length}건).`,
      );
    }
    if (tasksRes.docs.length >= AUDIT_TASK_SCAN_LIMIT) {
      result.notes.push(
        `티켓 스캔이 상한 ${AUDIT_TASK_SCAN_LIMIT}건에서 잘렸다 — 요약 수치는 이 표본 기준이다.`,
      );
    }

    return result;
  },
);
