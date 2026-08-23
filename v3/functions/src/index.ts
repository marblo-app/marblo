import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";
import {
  enforce as enforceRateLimit,
  extractIp,
  COUPON_RULES_UID,
  COUPON_RULES_IP,
  ATTRIBUTION_RULES_IP,
} from "./rateLimit";
import {
  parseLinkInstallRequest,
  INSTALL_ATTRIBUTION_SCHEMA,
} from "./installAttribution";
import {
  GA4_BRIDGE_TABLE,
  GA4_BRIDGE_CURRENT_VIEW,
  GA4_BRIDGE_SCHEMA,
  GA4_SYNC_ROW_LIMIT,
  GA4_SYNC_DEFAULT_DAYS,
  buildGa4FirstTouchQuery,
  buildExistingKeysQuery,
  buildBridgeCurrentViewSql,
  toBridgeRow,
  selectNewBridgeRows,
  chunkRows,
  parseSyncDays,
  isGaClientId,
  isSafeBqIdentifier,
  type Ga4BridgeRow,
  type Ga4BridgeSourceRow,
} from "./ga4Bridge";
import {
  buildCountryFunnel,
  type InstallRow,
  type WebVisitorRow,
} from "./countryFunnel";
import { reconcileTossPending, reconcilePaddlePending } from "./reconciliation";
import { redactSecrets } from "./redact";
// GitHub App 자동상속 — 인가 판정·서명·검증은 전부 이 순수 모듈에 있다.
// (설계: v3/docs/github-app-installation-inheritance-design-2026-08-21.md)
import {
  buildAppJwt,
  buildAuditEntry,
  buildInstallUrl,
  evaluateInstallationTokenRequest,
  evaluateMintResponse,
  evaluatePushRef,
  evaluateRepoInstallationLookup,
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  installationTokenBudgetFor,
  negotiateInstallationAccess,
  normalizeInstallationId,
  normalizePrivateKeyPem,
  parseDefaultBranch,
  repoSlugKey,
  roleCanMerge,
  roleCanWriteRepo,
  SETUP_STATE_TTL_MS,
  signSetupState,
  verifySetupState,
  type ProjectRole,
  type ProjectSnapshotForIssue,
  type RepoAccess,
  type RepoSlug,
} from "./githubApp";
import {
  parseIncludeAdmin,
  parseMetricMode,
  metricCountExpr,
  EMPTY_EXCLUSION,
  buildOnboardingFunnel,
  ONBOARDING_FUNNEL_STEPS,
  ONBOARDING_FAILURE_EVENTS,
  type FunnelCoverageRow,
  buildKpiCockpit,
  buildCliSetupSummary,
  buildReleaseHealth,
  MODEL_BREAKDOWN_RETIRED,
  buildCostByDayModel,
  buildRetentionCohorts,
  buildActiveUserMetrics,
  buildActivationGateFunnel,
  ACTIVATION_GATE_STEPS,
  MODEL_CONNECT_ANCHOR_EVENTS,
  modelConnectedPredicateSql,
  type ReasonRow,
  type CliSetupStepRow,
  type ReleaseVersionSourceRow,
  type ReleaseAdoptionSourceRow,
  type CostByDayModelSourceRow,
  buildStreakRetention,
  STREAK_GRID_DAYS,
  type RetentionCohortSourceRow,
  type UnitDayActivityRow,
  type InstallAccountMappingRow,
  type ActiveByDaySourceRow,
  type ThirtyDayRetentionSourceRow,
} from "./adminAnalytics";
import {
  buildBetaSegmentUsage,
  type GrantHolderRow,
  type SegmentActivityRow,
} from "./betaSegments";
import {
  ACCOUNT_PROFILE_SCHEMA,
  ANALYTICS_DATASET,
  INSTALL_PROFILE_SCHEMA,
  TABLE_ACCOUNT_PROFILE,
  TABLE_INSTALL_PROFILE,
  TABLE_USER_DAILY,
  USER_DAILY_SCHEMA,
  assertAxisPurity,
  buildAccountProfileRows,
  buildInstallProfileRows,
  buildUserDailyRows,
  summarizeInstallRetention,
  type AccountBillingRow,
  type AccountCostRow,
  type BqField,
  type DailySourceRow,
  type InstallFirstTouchRow,
  type InstallMilestoneRow,
  type InstallProfileRow,
} from "./analyticsProfiles";
import {
  LINK_SOURCE_TELEMETRY_AUTH,
  PERSON_AXIS_LINK_POLICY_VERSION,
  buildPersonAxisCoverageSql,
  buildUserInstallInlineMergeSql,
  buildUserInstallMergeParams,
  computePersonAxisCoverage,
  planUserInstallLink,
  resolvePersonAxisGate,
  type PersonAxisBasis,
  type PersonAxisCoverage,
} from "./personAxis";
import {
  TEAM_USAGE_CACHE_COLLECTION,
  TEAM_USAGE_CACHE_SCHEMA_VERSION,
  TEAM_USAGE_CACHE_TTL_SECONDS,
  TEAM_USAGE_DEFAULT_RANGE_DAYS,
  TEAM_USAGE_MAX_PROJECTS_IN_SCOPE,
  TEAM_USAGE_MEMORY_TTL_SECONDS,
  TEAM_USAGE_NOT_PROVISIONED_OPERATOR_NOTE,
  buildSelfUsageDailyQuery,
  buildTeamUsageCacheDocId,
  buildTeamUsageDailyQuery,
  buildTeamUsageEnvelope,
  buildUnattributedRowsQuery,
  canManualRefresh,
  capProjectScope,
  canSeeTeamBreakdown,
  clampWindowToGate,
  computeUsageWindow,
  foldCachedTeamUsage,
  intersectProjectScope,
  isCacheUsable,
  resolveTeamUsageGate,
  resolveUsageScope,
  teamMemberKey,
  toCacheRows,
  type TeamRole,
  type TeamUsageCacheDoc,
  type TeamUsageDailyRow,
} from "./teamUsage";
import { buildMetadata } from "./telemetryMetadata";
import {
  ROUTING_SHADOW_SCHEMA_VERSION,
  compareShadowRouting,
  parseShadowFeatures,
  recommendRouting,
} from "./routingShadow";
import {
  ANALYTICS_ID_SALT_ENV,
  deriveGaKey,
  pseudonymizeAnalyticsId,
  pseudonymizeAnalyticsRow,
  readAnalyticsIdSalt,
} from "./analyticsPseudonym";
import { classifyIdScheme } from "./analyticsIdScheme";
import { resolveGrantPlanType } from "./grantPlan";
import { buildProjectAudit, toMillis } from "./projectAudit";
import {
  DEFAULT_TEAM_AUDIT_LIMIT,
  PROJECT_EVENT_TOOLS,
  decodeAuditCursor,
  deniedTeamAudit,
  narrowAuditForTeam,
  normalizeLimit,
  runtimeNote,
  scopeForRole,
  type LedgerEventInput,
  type MergeEventInput,
  type TeamAuditProjectRef,
  type TeamProjectAuditResult,
  type TeamProjectRole,
} from "./teamAudit";
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
  ANALYTICS_PURCHASE_TABLE,
  REVENUE_ACCOUNT_CLASS,
  REVENUE_KINDS,
  tallyPurchaseRows,
  type BuildResult,
  type PurchaseMapContext,
  type PurchaseTally,
} from "./analyticsPurchase";
import { loadPurchaseRows, type BqLike } from "./analyticsPurchaseLoad";
import {
  buildPurchaseRows,
  readPurchaseSources,
} from "./analyticsPurchaseSource";
import {
  ANALYTICS_USER_KEY_BLOCKER,
  resolveAnalyticsUserKeyFn,
} from "./analyticsUserKey";
import {
  planAmountKRW,
  normalizeBillingCycle,
  applyCouponDiscount,
  firstChargeReceipt,
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
  isTossEntryEnabled,
  TOSS_ENTRY_DISABLED_CODE,
  TOSS_ENTRY_DISABLED_MESSAGE,
  type FirstChargeReceipt,
  type SubscriptionSnapshot,
  type BillingCycle,
  type FirstChargeProvider,
} from "./billing";
import {
  portoneChargeDocId,
  portoneExpectedAmount,
  portonePaymentId,
  validatePortOnePaidPayment,
  needsBillingKeyConfirmation,
  normalizeEasyPayProvider,
  normalizePortOneBillingKeyMethod,
  resolveIssuedBillingKey,
  resolvePortOneBillingChannelKey,
  SUPPORTED_EASY_PAY_PROVIDERS,
  type PortOneBillingKeyMethod,
  type PortOnePaymentLike,
} from "./portone";
import { resolveEntitledPlan } from "./entitlement";
import { MAX_COST_LOGS_LIMIT, normalizeCostLogsLimit } from "./costLogsLimit";
import {
  MAX_SAMPLES_PER_BATCH,
  TRAINING_DATASET,
  TRAINING_SAMPLES_SCHEMA,
  TRAINING_SAMPLES_TABLE,
  resolveCaptureGate,
  toTrainingRows,
  type TrainingConsentDoc,
} from "./trainingCapture";

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
    : undefined
);
const db = admin.firestore();
const BQ_LOCATION = "US";
const bigquery = new BigQuery({ location: BQ_LOCATION });

const BQ_DATASET = "marblo_telemetry";
const BQ_EVENTS_TABLE = "events";
const BQ_COST_TABLE = "cost_logs";

// ── 익명 세계 조인키 가명화 솔트 (ticket U5OPOKf0D3I2TSRP8yUq) ────────────────
// events/task_outcomes/agent_heartbeats 에 적히는 projectId·agentId·taskId 는
// cost_logs(계정 uid 보유)와 **같은 원시 id 공간**이었다 — uid 컬럼이 없어도 그
// 세 키 중 하나로 조인하면 계정 재연결이 성립했다. 이제 익명 세계에는 이 솔트로
// 키드된 HMAC 가명만 적힌다(analyticsPseudonym.ts).
//
// 솔트는 함수 런타임 env 에만 있고 BigQuery 에는 없다 — 웨어하우스만 보는 쪽에서
// 조인이 성립하지 않게 하는 게 이 분리의 요점이다. 미설정이면 원시값으로
// 폴백하지 않고 조인키를 버린다(fail-safe). 배포는 check-deploy-env 가 막는다.
let analyticsIdSaltWarned = false;
function getAnalyticsIdSalt(): string | null {
  const salt = readAnalyticsIdSalt();
  if (!salt && !analyticsIdSaltWarned) {
    analyticsIdSaltWarned = true;
    // 솔트 값은 남기지 않는다 — 부재 사실만.
    functions.logger.error(
      `[analytics] ${ANALYTICS_ID_SALT_ENV} is not configured; ` +
        "join keys are dropped from de-identified telemetry rows"
    );
  }
  return salt;
}
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

interface AdminAnalyticsQueryResult {
  name: string;
  rows: BigQueryRows;
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeAnalyticsErrorMessage(error: unknown): string {
  return errorMessage(error).replace(/\s+/g, " ").slice(0, 300);
}

async function runAdminAnalyticsQueriesWithStatus(
  specs: readonly AdminAnalyticsQuerySpec[]
): Promise<AdminAnalyticsQueryResult[]> {
  const settled = await Promise.allSettled(
    specs.map((spec) =>
      bigquery.query({
        query: spec.query,
        params: spec.params,
        location: BQ_LOCATION,
      })
    )
  );

  return settled.map((result, index) => {
    const spec = specs[index];
    if (result.status === "fulfilled") {
      const [rows] = result.value;
      return {
        name: spec?.name ?? `query_${index}`,
        rows: rows as BigQueryRows,
        error: null,
      };
    }

    const error = safeAnalyticsErrorMessage(result.reason);
    functions.logger.error("Admin analytics BigQuery query failed", {
      queryName: spec?.name ?? `query_${index}`,
      error,
    });
    return {
      name: spec?.name ?? `query_${index}`,
      rows: [],
      error,
    };
  });
}

async function runAdminAnalyticsQueries(
  specs: readonly AdminAnalyticsQuerySpec[]
): Promise<BigQueryRows[]> {
  const results = await runAdminAnalyticsQueriesWithStatus(specs);
  return results.map((result) => result.rows);
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
      `Ambiguous task prefix: ${taskId8}`
    );
  }

  const doc = snap.docs[0];
  const projectId = asNonEmptyString(doc.get("projectId"));
  if (!projectId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Task ${doc.id} has no projectId`
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
        "로그인이 필요합니다."
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
        `[issueAgentCustomToken] createCustomToken failed (${code})`
      );
      throw new functions.https.HttpsError(
        "internal",
        `Agent custom token signing failed (${code}).`
      );
    }

    return {
      customToken,
      uid: context.auth.uid,
    };
  }
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
        "[recordGitHubMergeHistory] webhook token is not configured"
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
    // ★익명 세계로 들어가는 두 번째 writer 다 — logTelemetryBatch 와 똑같이
    // 조인키를 가명화해야 한다(가명화 안 하면 여기 한 경로로 다리가 되살아난다).
    await bigquery
      .dataset(BQ_DATASET)
      .table(BQ_EVENTS_TABLE)
      .insert([
        pseudonymizeAnalyticsRow(
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
          getAnalyticsIdSalt()
        ),
      ]);

    res.status(200).json({
      ok: true,
      recorded: true,
      taskId: task.taskId,
      prNumber,
    });
  }
);

// ─── Config ──────────────────────────────────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY!;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET!;
const PADDLE_API_BASE = "https://api.paddle.com";

// ★TOSS_SECRET_KEY 는 지우지 않는다 — 신규 결제를 닫아도 과거 원장 조회·
// 미반영 정산(reconcileTossPending)·웹훅 재조회에 여전히 쓰인다.
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY!;
const TOSS_API_BASE = "https://api.tosspayments.com/v1";

// ─── 토스 신규 진입 차단 게이트 ───────────────────────────────────────
// 신규로 돈이 움직이는 토스 경로 앞에만 세운다. 읽기·판정·해지·정산은 통과한다.
// 되돌리려면 TOSS_ENTRY_ENABLED="true" (기본 차단). 상세는 billing.ts 주석.
function assertTossEntryEnabled(): void {
  if (isTossEntryEnabled(process.env.TOSS_ENTRY_ENABLED)) return;
  throw new functions.https.HttpsError(
    "failed-precondition",
    TOSS_ENTRY_DISABLED_MESSAGE,
    { code: TOSS_ENTRY_DISABLED_CODE }
  );
}

const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET || "";
const PORTONE_STORE_ID = process.env.PORTONE_STORE_ID || "";
const PORTONE_INICIS_ONETIME_CHANNEL_KEY =
  process.env.PORTONE_INICIS_ONETIME_CHANNEL_KEY || "";
const PORTONE_INICIS_BILLING_CHANNEL_KEY =
  process.env.PORTONE_INICIS_BILLING_CHANNEL_KEY || "";
// 간편결제(토스페이) 전용 빌링 채널. 미설정이면 카드 빌링 채널로 폴백한다
// (KG이니시스 채널이 EasyPayProvider.TOSSPAY 를 지원).
const PORTONE_EASYPAY_BILLING_CHANNEL_KEY =
  process.env.PORTONE_EASYPAY_BILLING_CHANNEL_KEY || "";
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
        "로그인이 필요합니다."
      );
    }

    const userId = context.auth.uid;
    const subSnap = await db.collection("subscriptions").doc(userId).get();

    if (!subSnap.exists || !subSnap.data()?.paddleSubscriptionId) {
      throw new functions.https.HttpsError(
        "not-found",
        "구독 정보를 찾을 수 없습니다."
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
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Paddle cancel failed:", error);
      throw new functions.https.HttpsError(
        "internal",
        "구독 취소에 실패했습니다."
      );
    }

    return { success: true };
  }
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
              new Date(data.current_billing_period.starts_at)
            );
          }
          if (data.current_billing_period.ends_at) {
            update.currentPeriodEnd = admin.firestore.Timestamp.fromDate(
              new Date(data.current_billing_period.ends_at)
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
        "로그인이 필요합니다."
      );
    }
    // ★신규 토스 결제 진입 차단(1단계). 읽기·판정·해지·정산은 통과한다.
    assertTossEntryEnabled();

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
        "유효하지 않은 플랜입니다."
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
  }
);

// ─── Confirm Toss Payment ────────────────────────────────────────
export const confirmTossPayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    // ★신규 토스 결제 confirm 차단(1단계).
    assertTossEntryEnabled();

    const { orderId, paymentKey, amount } = data as {
      orderId: string;
      paymentKey: string;
      amount: number;
    };

    const orderSnap = await db.collection("pendingOrders").doc(orderId).get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "주문을 찾을 수 없습니다."
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
        "본인의 주문만 확인할 수 있습니다."
      );
    }
    if (order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다."
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
        error.message || "결제 승인에 실패했습니다."
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
  }
);

// ═══════════════════════════════════════════════════════════════════
// PortOne V2 Integration (KG이니시스 테스트모드)
// ═══════════════════════════════════════════════════════════════════

function assertPortOneServerConfig(): void {
  if (!PORTONE_API_SECRET || !PORTONE_STORE_ID) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "PortOne 서버 설정이 필요합니다."
    );
  }
}

/**
 * 결제 종류 + 빌링키 발급수단에 맞는 채널키.
 * ★간편결제 빌링키는 발급된 채널에 묶인다 — 첫청구도 갱신도 같은 채널키를
 * 써야 하므로, 호출부는 구독 문서에 저장된 발급수단(portoneBillingKeyMethod)을
 * 그대로 넘긴다.
 */
function assertPortOneCheckoutConfig(
  kind: "one_time" | "subscription",
  method: PortOneBillingKeyMethod = "CARD"
): string {
  assertPortOneServerConfig();
  const channelKey =
    kind === "subscription"
      ? resolvePortOneBillingChannelKey({
          method,
          cardChannelKey: PORTONE_INICIS_BILLING_CHANNEL_KEY,
          easyPayChannelKey: PORTONE_EASYPAY_BILLING_CHANNEL_KEY,
        })
      : PORTONE_INICIS_ONETIME_CHANNEL_KEY;
  if (!channelKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "PortOne 채널 설정이 필요합니다."
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
  paymentId: string
): Promise<PortOnePaymentLike> {
  assertPortOneServerConfig();
  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `PortOne ${PORTONE_API_SECRET}` },
    }
  );
  if (!res.ok) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "PortOne 결제내역 조회에 실패했습니다."
    );
  }
  return (await res.json()) as PortOnePaymentLike;
}

/**
 * 빌링키 발급 수동 승인 — 간편결제(토스페이) 축에만 있는 단계.
 *
 * 채널이 수동 승인으로 설정돼 있으면 브라우저 SDK 가 billingKey 자리에
 * 'NEEDS_CONFIRMATION' 을 주고 billingIssueToken 을 따로 넘긴다. 이 토큰으로
 * POST /billing-keys/confirm 을 호출해야 실제 빌링키가 발급된다.
 * 자동 승인 채널이면 애초에 토큰이 없으므로 이 경로를 타지 않는다.
 * (@portone/server-sdk payment.billingKey.confirmBillingKey 실측 미러)
 */
async function confirmPortOneBillingKey(
  billingIssueToken: string
): Promise<string> {
  assertPortOneServerConfig();
  const res = await fetch(`${PORTONE_API_BASE}/billing-keys/confirm`, {
    method: "POST",
    headers: {
      Authorization: `PortOne ${PORTONE_API_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      storeId: PORTONE_STORE_ID,
      billingIssueToken,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof objectField(body, "message") === "string"
        ? String(objectField(body, "message")).slice(0, 300)
        : "PortOne 빌링키 발급 승인에 실패했습니다.";
    throw new functions.https.HttpsError("failed-precondition", message);
  }
  const body = (await res.json().catch(() => ({}))) as unknown;
  const billingKey = resolveIssuedBillingKey(objectField(body, "billingKey"));
  if (!billingKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "billing_key_confirm_failed"
    );
  }
  return billingKey;
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
      params.paymentId
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
          name: params.customerName ? { full: params.customerName } : undefined,
          phoneNumber: params.customerPhone || undefined,
        },
      }),
    }
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
        "로그인이 필요합니다."
      );
    }

    const kind =
      stringField(data, "kind") === "one_time" ? "one_time" : "subscription";
    const channelKey = assertPortOneCheckoutConfig(kind);
    // 간편결제 채널이 실제로 붙어 있을 때만 체크아웃에 토스페이 옵션을 띄운다.
    // 전용 채널이 없으면 카드 빌링 채널로 폴백(KG이니시스가 TOSSPAY 지원).
    const easyPayBillingChannelKey =
      kind === "subscription"
        ? PORTONE_EASYPAY_BILLING_CHANNEL_KEY ||
          PORTONE_INICIS_BILLING_CHANNEL_KEY ||
          null
        : null;
    return {
      storeId: PORTONE_STORE_ID,
      channelKey,
      oneTimeChannelKey: PORTONE_INICIS_ONETIME_CHANNEL_KEY || null,
      billingChannelKey: PORTONE_INICIS_BILLING_CHANNEL_KEY || null,
      // ★응답 스키마 추가(재배포 필요) — 클라가 간편결제 지원 여부·채널을 안다.
      easyPayBillingChannelKey,
      easyPayProviders: easyPayBillingChannelKey
        ? [...SUPPORTED_EASY_PAY_PROVIDERS]
        : [],
    };
  }
);

export const createPortOnePaymentIntent = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    assertPortOneCheckoutConfig("one_time");
    const planType = stringField(data, "planType");
    if (!planType) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "planType이 필요합니다."
      );
    }
    const expected = portoneExpectedAmount(
      planType,
      stringField(data, "billing")
    );
    if (!expected) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "유효하지 않은 플랜입니다."
      );
    }
    const paymentId = portonePaymentId(
      context.auth.uid,
      "one_time",
      `${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    // 단건 결제가 무엇에 대한 권리인지는 주문에 실려야 한다 — 강의 결제인데
    // lectureSlug 를 안 실으면 확정 시점에 무엇을 지급할지 알 수 없어, 예전엔
    // 그 공백을 "구독 active" 로 메우고 있었다(단건이 구독을 열어주던 버그).
    const lectureSlug = stringField(data, "lectureSlug");
    const orderName = lectureSlug
      ? `Marblo 강의 단건 결제`
      : `Marblo ${planType} 단건 결제`;
    await db
      .collection("pendingPortOneOrders")
      .doc(paymentId)
      .set({
        userId: context.auth.uid,
        kind: "one_time",
        planType,
        lectureSlug: lectureSlug || null,
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
  }
);

export const completePortOnePayment = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    const paymentId = stringField(data, "paymentId");
    if (!paymentId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "paymentId가 필요합니다."
      );
    }

    const orderSnap = await db
      .collection("pendingPortOneOrders")
      .doc(paymentId)
      .get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "PortOne 주문을 찾을 수 없습니다."
      );
    }
    const order = orderSnap.data() || {};
    if (order.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "본인의 주문만 확인할 수 있습니다."
      );
    }
    const planType =
      typeof order.planType === "string" ? order.planType : "pro";
    const lectureSlug =
      typeof order.lectureSlug === "string" && order.lectureSlug.trim()
        ? order.lectureSlug.trim()
        : null;
    const amount = typeof order.amount === "number" ? order.amount : 0;
    if (amount <= 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "주문 금액이 유효하지 않습니다."
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
        { merge: true }
      );
      return true;
    });

    if (!shouldApply)
      return {
        success: true,
        idempotent: true,
        chargedAmount: amount,
        lectureSlug,
      };

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
        "PortOne 결제 검증에 실패했습니다."
      );
    }

    // ★단건 결제는 subscriptions 를 절대 건드리지 않는다.
    // 예전엔 여기서 구독을 active 로 세웠다 — 강의 한 번 결제한 사람이 정기
    // 구독자로 승격되고(공짜 Pro), 기존 구독자라면 빌링키·주기·기간 필드가 단건
    // 값으로 덮여 갱신 청구가 어긋났다. 정기구독을 여는 건 빌링키 경로
    // (completePortOneBillingKey / issueBillingKey) 하나뿐이다.
    const uid = context.auth.uid;
    const now = new Date();
    await db.collection("oneTimeEntitlements").doc(paymentId).set(
      {
        userId: uid,
        provider: "portone",
        paymentId,
        planType,
        lectureSlug,
        amount,
        grantedAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // 강의 단건이면 강의 수강권도 지급한다(Toss confirmLecturePayment 와 동일
    // 계약: userId+lectureSlug 1행 + 앱 쿠폰 자동발급).
    if (lectureSlug) {
      const existingPurchase = await db
        .collection("lecturePurchases")
        .where("userId", "==", uid)
        .where("lectureSlug", "==", lectureSlug)
        .limit(1)
        .get();
      if (existingPurchase.empty) {
        await db.collection("lecturePurchases").add({
          userId: uid,
          lectureSlug,
          purchasedAt: now,
          orderId: paymentId,
          amount,
          provider: "portone",
        });
        await issueLectureCouponInternal(uid);
      }
    }

    await chargeRef.update({
      status: "succeeded",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await orderSnap.ref.update({
      status: "confirmed",
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      success: true,
      idempotent: false,
      chargedAmount: amount,
      lectureSlug,
    };
  }
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
  paymentKey: string
): Promise<TossPaymentQueryResult> {
  if (!TOSS_SECRET_KEY) return null;
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/payments/${encodeURIComponent(paymentKey)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64"
          )}`,
        },
      }
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
          "[tossWebhook] PAYMENT_STATUS_CHANGED without paymentKey; ignoring"
        );
        break;
      }

      const query = await fetchTossPaymentStatus(paymentKey);
      const action = resolveTossWebhookAction(query);
      if (!query) {
        // 재조회 실패/미존재(위조 포함) → 구독 변경 없이 무시(+로그).
        console.warn(
          "[tossWebhook] payment re-query failed or not found; no subscription change"
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
  /** 실제 적용된 쿠폰 코드. 원장에 남겨 멱등 재진입 시 영수증을 복원한다. */
  couponCode?: string | null;
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
        couponCode: params.couponCode ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
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
            "base64"
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerKey,
          amount,
          orderId,
          orderName: `Marblo ${planType} 구독`,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = String(error?.message || `HTTP ${response.status}`).slice(
        0,
        500
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
      500
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
  /**
   * 빌링키 발급수단. 간편결제 빌링키는 발급 채널에 묶이므로 채널키 선택에
   * 쓴다. 미지정(레거시 구독 문서)은 카드.
   */
  billingKeyMethod?: PortOneBillingKeyMethod;
  /** 첫청구 결정적 paymentId (기본: cycleAnchorMs 기반). */
  paymentIdOverride?: string;
  /** 첫청구 결정적 billingCharges doc id (기본: portone_{paymentId}). */
  chargeDocIdOverride?: string;
  /** 실제 적용된 쿠폰 코드. 원장에 남겨 멱등 재진입 시 영수증을 복원한다. */
  couponCode?: string | null;
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
        couponCode: params.couponCode ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
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
    const channelKey = assertPortOneCheckoutConfig(
      "subscription",
      params.billingKeyMethod || "CARD"
    );
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
  nowMs: number
): void {
  if (
    isAlreadySubscribed(
      { status: sub.status, currentPeriodEndMs: sub.currentPeriodEndMs },
      nowMs
    )
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "already_subscribed"
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
  cycle: BillingCycle
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
    if (
      st === "succeeded" ||
      st === "comped" ||
      st === "pending" ||
      st === "failed"
    ) {
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
  portoneBillingKeyMethod?: PortOneBillingKeyMethod;
  portoneEasyPayProvider?: string | null;
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
    // 첫청구 재시도가 카드 채널로 새면 간편결제 빌링키가 거절된다.
    patch.portoneBillingKeyMethod = params.portoneBillingKeyMethod || "CARD";
    patch.portoneEasyPayProvider = params.portoneEasyPayProvider || null;
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
  couponCode: unknown
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

// 멱등 재진입(이미 성공한 첫청구)에서 "그때 실제로 얼마를 청구했나" 를 원장에서
// 복원한다. 이번 호출의 계산값이 아니라 원장이 정본이다 — 재진입 시 쿠폰이
// 소진돼 finalAmount 가 정가로 계산될 수 있는데, 실제로 긁힌 건 그때 금액이다.
function ledgerReceipt(
  data: FirebaseFirestore.DocumentData | undefined,
  fallbackAmount: number,
  requestedCouponCode: string | null
): FirstChargeReceipt {
  const d = data || {};
  const receipt = firstChargeReceipt({
    status: d.status === "comped" ? "comped" : "charged",
    amount: typeof d.amount === "number" ? d.amount : fallbackAmount,
    appliedCouponCode: typeof d.couponCode === "string" ? d.couponCode : null,
    requestedCouponCode,
  });
  // couponCode 필드가 아예 없는 구버전 원장은 "쿠폰 미적용" 을 단정할 수 없다 —
  // 잘못된 정가청구 고지를 띄우지 않는다.
  return "couponCode" in d ? receipt : { ...receipt, couponRejected: false };
}

export const completePortOneBillingKey = functions.https.onCall(
  async (data, context) => {
    const userId = context.auth?.uid;
    if (!userId) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    const authEmail =
      typeof context.auth?.token.email === "string"
        ? context.auth.token.email
        : null;
    const rawBillingKey = stringField(data, "billingKey");
    const planType = stringField(data, "planType") || "pro";
    const customerName = stringField(data, "customerName");
    const customerPhone = stringField(data, "customerPhone");
    // 빌링키 발급수단. 간편결제면 easyPayProvider(포트원 규약명)도 함께 받아
    // 구독 문서에 남긴다 — 갱신 크론이 같은 채널로 청구해야 하기 때문.
    const billingKeyMethod = normalizePortOneBillingKeyMethod(
      stringField(data, "billingKeyMethod")
    );
    const easyPayProvider =
      billingKeyMethod === "EASY_PAY"
        ? normalizeEasyPayProvider(stringField(data, "easyPayProvider"))
        : null;
    if (billingKeyMethod === "EASY_PAY" && !easyPayProvider) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "easy_pay_provider_unsupported"
      );
    }
    // KG이니시스 빌링 청구는 customer.email REQUIRED.
    // 클라이언트가 넘긴 customerEmail 우선, 없으면 auth token email 폴백.
    const customerEmailRaw = stringField(data, "customerEmail");
    const customerEmail =
      (customerEmailRaw && customerEmailRaw.trim()) || authEmail || null;

    // ★간편결제 승인 차이: 수동 승인 채널은 billingKey 대신
    // 'NEEDS_CONFIRMATION' + billingIssueToken 이 온다. 승인 API 를 태워야
    // 실제 빌링키가 나오고, 그 뒤로는 카드와 완전히 같은 경로를 탄다.
    const billingIssueToken = stringField(data, "billingIssueToken");
    const billingKey = needsBillingKeyConfirmation({
      billingKey: rawBillingKey,
      billingIssueToken,
    })
      ? await confirmPortOneBillingKey(billingIssueToken as string)
      : resolveIssuedBillingKey(rawBillingKey);
    if (!billingKey) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "billingKey가 필요합니다."
      );
    }
    if (!customerEmail) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "결제에 이메일이 필요합니다"
      );
    }

    assertPortOneCheckoutConfig("subscription", billingKeyMethod);
    const expected = portoneExpectedAmount(
      planType,
      stringField(data, "billing")
    );
    if (!expected) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`
      );
    }

    const nowMs = Date.now();
    const existingSub = await loadSubscriptionGuard(userId);
    assertNotAlreadySubscribed(existingSub, nowMs);

    const requestedCoupon = stringField(data, "coupon");
    const { finalAmount, appliedCoupon } = await resolveFirstChargeAmount(
      userId,
      expected.amount,
      requestedCoupon
    );

    // 결정적 첫청구 키 — Date.now() 앵커 금지(동시 호출 이중청구 방지).
    const generation = await pickFirstChargeGeneration(
      "portone",
      userId,
      planType,
      expected.billingCycle
    );
    const chargeDocId = firstChargeLedgerId(
      "portone",
      userId,
      planType,
      expected.billingCycle,
      generation
    );
    const paymentId = portonePaymentId(
      userId,
      "subscription",
      firstChargePortoneNonce(planType, expected.billingCycle, generation)
    );

    // 이미 성공한 첫청구 문서면 재청구 없이 구독 복구 + idempotent.
    {
      const prior = await db
        .collection("billingCharges")
        .doc(chargeDocId)
        .get();
      const priorSt = prior.data()?.status as string | undefined;
      if (priorSt === "succeeded" || priorSt === "comped") {
        const now = new Date(nowMs);
        const receipt = ledgerReceipt(
          prior.data(),
          finalAmount,
          requestedCoupon
        );
        await db
          .collection("subscriptions")
          .doc(userId)
          .set(
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
              portoneBillingKeyMethod: billingKeyMethod,
              portoneEasyPayProvider: easyPayProvider,
              portonePaymentId:
                priorSt === "comped"
                  ? null
                  : prior.data()?.portonePaymentId || paymentId,
              // 완료 페이지가 클라 계산액이 아니라 이 값을 표시한다(#6).
              lastChargeAmount: receipt.chargedAmount,
              couponCode: receipt.couponApplied || null,
              couponRejected: receipt.couponRejected,
              currentPeriodStart: now,
              currentPeriodEnd: nextPeriodEnd(now, expected.billingCycle),
              billingFailedCount: 0,
              nextRetryAt: null,
              firstChargeGeneration: generation,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        return {
          success: true,
          idempotent: true,
          charged: priorSt === "comped" ? "comped" : "charged",
          chargedAmount: receipt.chargedAmount,
          couponApplied: receipt.couponApplied,
          couponRejected: receipt.couponRejected,
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
      billingKeyMethod,
      paymentIdOverride: paymentId,
      chargeDocIdOverride: chargeDocId,
      couponCode: appliedCoupon?.code ?? null,
    });

    if (charge.status === "skipped" && charge.reason === "already_done") {
      const now = new Date(nowMs);
      const prior = await db
        .collection("billingCharges")
        .doc(chargeDocId)
        .get();
      const receipt = ledgerReceipt(prior.data(), finalAmount, requestedCoupon);
      await db
        .collection("subscriptions")
        .doc(userId)
        .set(
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
            portoneBillingKeyMethod: billingKeyMethod,
            portoneEasyPayProvider: easyPayProvider,
            portonePaymentId: finalAmount <= 0 ? null : paymentId,
            lastChargeAmount: receipt.chargedAmount,
            couponCode: receipt.couponApplied || null,
            couponRejected: receipt.couponRejected,
            currentPeriodStart: now,
            currentPeriodEnd: nextPeriodEnd(now, expected.billingCycle),
            billingFailedCount: 0,
            nextRetryAt: null,
            firstChargeGeneration: generation,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      return {
        success: true,
        idempotent: true,
        charged: "charged",
        chargedAmount: receipt.chargedAmount,
        couponApplied: receipt.couponApplied,
        couponRejected: receipt.couponRejected,
      };
    }

    if (charge.status === "skipped" && charge.reason === "in_flight") {
      throw new functions.https.HttpsError("aborted", "payment_in_progress");
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
        portoneBillingKeyMethod: billingKeyMethod,
        portoneEasyPayProvider: easyPayProvider,
        firstChargeGeneration: generation,
      });
      throw new functions.https.HttpsError(
        "failed-precondition",
        "first_charge_failed"
      );
    }

    const now = new Date(nowMs);
    // ★실청구 영수증(#6). 화면·GA4 는 클라가 계산한 금액이 아니라 이 값을 쓴다.
    // 쿠폰이 만료/소진/중복이면 resolveFirstChargeAmount 가 정가로 폴백하므로,
    // 사용자가 본 할인 총액과 실제 청구액이 갈릴 수 있다.
    const receipt = firstChargeReceipt({
      status: charge.status === "comped" ? "comped" : "charged",
      amount: finalAmount,
      appliedCouponCode: appliedCoupon?.code ?? null,
      requestedCouponCode: requestedCoupon,
    });
    await db
      .collection("subscriptions")
      .doc(userId)
      .set(
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
          // 간편결제 빌링키는 발급 채널에 묶인다 — 갱신 크론이 같은 채널로
          // 청구하도록 발급수단·간편결제사를 남긴다.
          portoneBillingKeyMethod: billingKeyMethod,
          portoneEasyPayProvider: easyPayProvider,
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
          // PortOne 구독은 이 callable 을 checkout 에서 호출하고 완료 페이지로는
          // 리다이렉트만 한다 — 응답이 완료 페이지에 닿지 않으므로 구독 문서에
          // 실청구 영수증을 남겨야 완료 페이지가 서버값을 읽을 수 있다.
          lastChargeAmount: receipt.chargedAmount,
          couponCode: receipt.couponApplied || null,
          couponRejected: receipt.couponRejected,
          createdAt: now,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
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
      chargedAmount: receipt.chargedAmount,
      couponApplied: receipt.couponApplied,
      couponRejected: receipt.couponRejected,
    };
  }
);

// 빌링키 발급 + 첫 결제 청구(원자적). 청구 실패 시 구독을 active 로 만들지
// 않는다 — GAP A(₩0 무료 활성) 방지의 핵심. 실패 시 pending_first_charge 로
// 키를 보존해 retryFirstCharge 가 재시도한다.
export const issueBillingKey = functions.https.onCall(async (data, context) => {
  const { authKey, customerKey, plan, coupon, billing } = data;
  const userId = context.auth?.uid;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  // ★토스 빌링키 신규 발급 차단(1단계) — 여기가 신규 정기결제의 실제 입구다.
  assertTossEntryEnabled();

  const planType = plan || "pro";
  // ★결제 주기를 여기서 받아 금액·기간 양쪽에 반영한다. 이 인자가 없던 시절엔
  // 연간을 고른 사용자에게 ₩190,000 을 보여주고 ₩19,000·1개월을 청구했다.
  const billingCycle = normalizeBillingCycle(billing);
  const baseAmount = planAmountKRW(planType, billingCycle);
  if (!baseAmount) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Plan '${planType}' is not chargeable`
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
          "base64"
        )}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authKey, customerKey }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new functions.https.HttpsError(
      "internal",
      error.message || "Failed to issue billing key"
    );
  }

  const responseData = await response.json();
  const billingKey = responseData.billingKey;

  // 2) 쿠폰 할인(첫 청구에만 적용).
  const requestedCoupon = typeof coupon === "string" ? coupon : null;
  const { finalAmount, appliedCoupon } = await resolveFirstChargeAmount(
    userId,
    baseAmount,
    coupon
  );

  // 3) 결정적 첫청구 멱등 키(Date.now 금지).
  const generation = await pickFirstChargeGeneration(
    "toss",
    userId,
    planType,
    billingCycle
  );
  const chargeDocId = firstChargeLedgerId(
    "toss",
    userId,
    planType,
    billingCycle,
    generation
  );
  const orderId = firstChargeOrderId(
    userId,
    planType,
    billingCycle,
    generation
  );

  // 이미 성공 분 → 재청구 없이 구독 복구.
  {
    const prior = await db.collection("billingCharges").doc(chargeDocId).get();
    const priorSt = prior.data()?.status as string | undefined;
    if (priorSt === "succeeded" || priorSt === "comped") {
      const now = new Date(nowMs);
      const receipt = ledgerReceipt(prior.data(), finalAmount, requestedCoupon);
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
            tossPaymentKey: prior.data()?.paymentKey || null,
            lastChargeAmount: receipt.chargedAmount,
            couponCode: receipt.couponApplied || null,
            couponRejected: receipt.couponRejected,
            currentPeriodStart: now,
            currentPeriodEnd: nextPeriodEnd(now, billingCycle),
            billingFailedCount: 0,
            nextRetryAt: null,
            firstChargeGeneration: generation,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      return {
        success: true,
        billingKey,
        charged: priorSt,
        idempotent: true,
        chargedAmount: receipt.chargedAmount,
        couponApplied: receipt.couponApplied,
        couponRejected: receipt.couponRejected,
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
    couponCode: appliedCoupon?.code ?? null,
  });

  if (charge.status === "skipped" && charge.reason === "already_done") {
    const now = new Date(nowMs);
    const priorSnap = await db
      .collection("billingCharges")
      .doc(chargeDocId)
      .get();
    const replayReceipt = ledgerReceipt(
      priorSnap.data(),
      finalAmount,
      requestedCoupon
    );
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
          lastChargeAmount: replayReceipt.chargedAmount,
          couponCode: replayReceipt.couponApplied || null,
          couponRejected: replayReceipt.couponRejected,
          currentPeriodStart: now,
          currentPeriodEnd: nextPeriodEnd(now, billingCycle),
          billingFailedCount: 0,
          nextRetryAt: null,
          firstChargeGeneration: generation,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return {
      success: true,
      billingKey,
      charged: "charged",
      idempotent: true,
      chargedAmount: replayReceipt.chargedAmount,
      couponApplied: replayReceipt.couponApplied,
      couponRejected: replayReceipt.couponRejected,
    };
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
      "first_charge_failed"
    );
  }

  // 4) 청구 성공/comped → 구독 active 저장 + 쿠폰 소진 기록.
  const now = new Date(nowMs);
  const periodEnd = nextPeriodEnd(now, billingCycle);
  // ★실청구 영수증(#6) — 쿠폰 폴백 시 화면 금액과 실청구가 갈리던 지점.
  const receipt = firstChargeReceipt({
    status: charge.status === "comped" ? "comped" : "charged",
    amount: finalAmount,
    appliedCouponCode: appliedCoupon?.code ?? null,
    requestedCouponCode: requestedCoupon,
  });
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
        lastChargeAmount: receipt.chargedAmount,
        couponCode: receipt.couponApplied || null,
        couponRejected: receipt.couponRejected,
        createdAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
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
    chargedAmount: receipt.chargedAmount,
    couponApplied: receipt.couponApplied,
    couponRejected: receipt.couponRejected,
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
        "not_pending_first_charge"
      );
    }

    const planType = (sub.planType as string) || "pro";
    const billingCycle = normalizeBillingCycle(sub.billingCycle);
    const baseAmount = planAmountKRW(planType, billingCycle);
    if (!baseAmount) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Plan '${planType}' is not chargeable`
      );
    }

    const provider = sub.paymentProvider === "portone" ? "portone" : "toss";
    // ★토스 첫청구 재시도만 차단한다. 포트원 재시도는 그대로 살린다 —
    // provider 구분 없이 막으면 유일하게 살아 있는 결제 경로가 끊긴다.
    if (provider === "toss") assertTossEntryEnabled();
    const generation =
      typeof sub.firstChargeGeneration === "number"
        ? sub.firstChargeGeneration
        : await pickFirstChargeGeneration(
            provider,
            userId,
            planType,
            billingCycle
          );
    const chargeDocId = firstChargeLedgerId(
      provider,
      userId,
      planType,
      billingCycle,
      generation
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
          "missing_billing_key"
        );
      }
      const paymentId = portonePaymentId(
        userId,
        "subscription",
        firstChargePortoneNonce(planType, billingCycle, generation)
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
        // 간편결제 빌링키 재시도가 카드 채널로 새면 PG 가 거절한다.
        billingKeyMethod: normalizePortOneBillingKeyMethod(
          sub.portoneBillingKeyMethod
        ),
        paymentIdOverride: paymentId,
        chargeDocIdOverride: chargeDocId,
      });
    } else {
      const billingKey = sub.tossBillingKey as string | undefined;
      const customerKey = sub.tossCustomerKey as string | undefined;
      if (!billingKey || !customerKey) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "missing_billing_key"
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
          generation
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
        { merge: true }
      );
      throw new functions.https.HttpsError(
        "failed-precondition",
        "first_charge_failed"
      );
    }

    // succeeded / comped / already_done
    const now = new Date(nowMs);
    // 재시도는 쿠폰을 다시 적용하지 않는다(이중 소진 방지) — 원장에 남은
    // 쿠폰/금액이 이 청구의 영수증이다. couponRejected 는 첫 시도의 판정을
    // 유지해야 하므로 여기서 덮어쓰지 않는다.
    const retryReceipt = firstChargeReceipt({
      status: charge.status === "comped" ? "comped" : "charged",
      amount: finalAmount,
      appliedCouponCode:
        typeof priorCharge.data()?.couponCode === "string"
          ? (priorCharge.data()!.couponCode as string)
          : null,
      requestedCouponCode: null,
    });
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
      lastChargeAmount: retryReceipt.chargedAmount,
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
      chargedAmount: retryReceipt.chargedAmount,
      couponApplied: retryReceipt.couponApplied,
    };
  }
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

    // ★토스 빌링키 수동 청구 차단(1단계) — 신규로 돈이 움직이는 경로다.
    assertTossEntryEnabled();

    // 호출자 본인의 구독 문서에서 billingKey/customerKey/plan 을 읽는다 —
    // 클라이언트 입력은 신뢰하지 않는다.
    const subRef = db.collection("subscriptions").doc(userId);
    const subSnap = await subRef.get();
    const sub = subSnap.data();
    if (!subSnap.exists || !sub?.tossBillingKey || !sub?.tossCustomerKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No billing key registered for this account"
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
        `Plan '${planType}' is not chargeable`
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
        charge.error || "Failed to charge billing key"
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
  }
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
//
// ★호환: 신규 클라이언트는 cancelSubscription 을 쓴다. 이 함수는 레거시 웹/앱
// 호출부를 위해 유지하며, pull 모델(toss/portone) 해지 본문은 공유 헬퍼로 통일.
export const cancelTossSubscription = functions.https.onCall(
  async (_data, context) => {
    return cancelPullModelSubscription(context);
  }
);

/**
 * 단일 해지 진입점 — provider 분기.
 * - toss / portone / 미지정(레거시): pull 모델 → status=canceled (planType 유지, 환불 없음)
 * - paddle: Paddle API cancel(next_billing_period) + 로컬 status=canceled (planType 유지)
 * past_due 도 허용(재시도 청구 중단). 이미 canceled 면 멱등 성공.
 * ★중도/부분 환불 자동화는 범위 밖.
 */
export const cancelSubscription = functions.https.onCall(
  async (_data, context) => {
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    const subRef = db.collection("subscriptions").doc(userId);
    const snap = await subRef.get();
    if (!snap.exists)
      throw new functions.https.HttpsError(
        "not-found",
        "No subscription to cancel"
      );

    const data = snap.data() ?? {};
    const status = typeof data.status === "string" ? data.status : "";
    const provider =
      typeof data.paymentProvider === "string" ? data.paymentProvider : "";
    const accessUntilMs = tsToMillis(data.currentPeriodEnd);
    const accessUntil =
      accessUntilMs != null ? new Date(accessUntilMs).toISOString() : null;

    // 멱등: 이미 해지된 구독은 재호출해도 성공.
    if (status === "canceled") {
      return {
        success: true,
        alreadyCanceled: true,
        provider: provider || null,
        accessUntil,
      };
    }

    // active / past_due / trialing 만 자발 해지 허용.
    // past_due: 재시도 청구를 멈추기 위해 취소 가능(환불 없음, 기간말 접근은 entitlement).
    if (status !== "active" && status !== "past_due" && status !== "trialing") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Subscription status '${status || "unknown"}' cannot be canceled`
      );
    }

    if (provider === "paddle") {
      const paddleSubId =
        typeof data.paddleSubscriptionId === "string"
          ? data.paddleSubscriptionId
          : "";
      if (paddleSubId) {
        const response = await fetch(
          `${PADDLE_API_BASE}/subscriptions/${paddleSubId}/cancel`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${PADDLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ effective_from: "next_billing_period" }),
          }
        );
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          console.error("Paddle cancel failed:", error);
          throw new functions.https.HttpsError(
            "internal",
            "구독 취소에 실패했습니다."
          );
        }
      }
      // 로컬도 즉시 canceled — UI/청구 대상 선정 정합. planType 은 유지해
      // 기간말까지 entitlement 유지(환불 없음). Paddle webhook 이 기간 말에
      // planType:free 로 내릴 수 있음(하드 킬스위치, 잔여 기간 종료 후).
      await subRef.update({
        status: "canceled",
        canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        success: true,
        alreadyCanceled: false,
        provider: "paddle",
        accessUntil,
      };
    }

    // toss / portone / 미지정(레거시 토스 경로 포함)
    await subRef.update({
      status: "canceled",
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      success: true,
      alreadyCanceled: false,
      provider: provider || "toss",
      accessUntil,
    };
  }
);

/** pull 모델(toss/portone) 해지 본문 — cancelTossSubscription 레거시 호환용. */
async function cancelPullModelSubscription(
  context: functions.https.CallableContext
): Promise<{ success: true; accessUntil: string | null }> {
  const userId = context.auth?.uid;
  if (!userId)
    throw new functions.https.HttpsError("unauthenticated", "Login required");

  const subRef = db.collection("subscriptions").doc(userId);
  const snap = await subRef.get();
  if (!snap.exists)
    throw new functions.https.HttpsError(
      "not-found",
      "No subscription to cancel"
    );

  await subRef.update({
    status: "canceled",
    canceledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const accessUntilMs = tsToMillis(snap.get("currentPeriodEnd"));
  return {
    success: true,
    accessUntil:
      accessUntilMs != null ? new Date(accessUntilMs).toISOString() : null,
  };
}

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
        "Already purchased this lecture"
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
  }
);

// 강의 단건결제 확인
export const confirmLecturePayment = functions.https.onCall(
  async (data, context) => {
    const { paymentKey, orderId, amount } = data;
    const userId = context.auth?.uid;
    if (!userId)
      throw new functions.https.HttpsError("unauthenticated", "Login required");

    // ★강의 단건 토스 confirm 차단(1단계). 강의 결제도 포트원
    // (completePortOnePayment)이 동일하게 수강권을 지급한다.
    assertTossEntryEnabled();

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
        "본인의 주문만 확인할 수 있습니다."
      );
    }
    if (typeof amount === "number" && order.amount !== amount) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "결제 금액이 일치하지 않습니다."
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
        "Already purchased this lecture"
      );
    }

    // Confirm with TossPayments (금액은 서버가 보관한 주문 금액을 신뢰).
    const response = await fetch(
      "https://api.tosspayments.com/v1/payments/confirm",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ":").toString(
            "base64"
          )}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paymentKey, orderId, amount: order.amount }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Payment confirmation failed"
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
  }
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
      "Coupon code required"
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
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`
    );
  }
  const ipCheck = await enforceRateLimit(ipKey, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`
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
    COUPON_RULES_UID
  );
  if (!uidCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts. Try again in ${uidCheck.retryAfter}s.`
    );
  }
  const ipCheck = await enforceRateLimit(`coupon:ip:${ip}`, COUPON_RULES_IP);
  if (!ipCheck.allowed) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Too many attempts from this network. Try again in ${ipCheck.retryAfter}s.`
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
        (baseAmount * (coupon.discountPercent || 0)) / 100
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
        "Coupons array required"
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
  }
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
  }
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
  10
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
  rawEmail: string
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
      "[requireAdmin] ADMIN_UID is not configured; rejecting admin callable as server misconfiguration."
    );
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Admin configuration is missing."
    );
  }

  if (context.auth?.uid !== adminUid) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }
}

// 구독 doc 를 grant 플랜/active 로 upsert 한다. 기간(currentPeriodEnd)은 기존 값과
// targetEnd 중 더 나중을 유지 — 멱등: 이미 더 긴 기간이 있으면 절대 줄이지 않는다.
// 베타 선정(1개월)·예외승인(3개월)·인터뷰(6개월) 부여가 전부 이 경로로 수렴한다.
// ★부여 플랜은 reason 이 결정한다(grantPlan.resolveGrantPlanType) — 베타/파운더
// reason 은 team(협업·멤버 기능이 team 부터 열린다), 그 외는 pro. 기간과 같은
// 이유로 플랜도 강등하지 않는다.
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
  sub: Record<string, unknown> | undefined
): boolean {
  if (!sub) return false;
  return sub.founderGrant === true || sub.paymentProvider === "founder_grant";
}

// 지금 살아있는 유료 구독인가 = 결제 흔적 AND 현역 status.
// 이게 true 인 구독만 "건드리지 말 것"(grant 로 덮어쓰기 금지) 대상이다.
// past_due 도 현역 — 재시도 중인 결제라 grant 로 덮으면 과금이 끊긴다.
function isLivePaidSubscription(
  sub: Record<string, unknown> | undefined
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
  /** 실제로 doc 에 쓴(또는 스킵 시 유지된) planType. 호출부가 기록·보고에 쓴다. */
  planType: string;
  skippedReason: "live_paid" | null;
};

async function upsertProSubscription(
  userId: string,
  targetEnd: Date,
  reason: string,
  grantStartedAt: Date
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
        `[upsertProSubscription] 현역 유료 구독(${userId}, status=${data?.status}) — grant(${reason}) 로 덮어쓰지 않고 결제 유지`
      );
      return {
        granted: false,
        periodEnd: existingEnd ?? periodEnd,
        planType: typeof data?.planType === "string" ? data.planType : "pro",
        skippedReason: "live_paid",
      };
    }

    // 트랜잭션 안에서 읽은 data 로 판정한다 — 강등 금지 가드가 참조하는 기존
    // 플랜이 커밋 시점과 어긋나면 안 된다.
    const planType = resolveGrantPlanType(reason, data);

    const payload: Record<string, unknown> = {
      userId,
      planType,
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
    return { granted: true, periodEnd, planType, skippedReason: null };
  });
}

async function grantFounderProTotalInternal(
  userId: string,
  totalMonths: number,
  reason: string,
  grantStartedAt: Date
): Promise<Date> {
  const outcome = await upsertProSubscription(
    userId,
    addMonths(grantStartedAt, totalMonths),
    reason,
    grantStartedAt
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
        "rating must be 1..5"
      );
    }

    const liked = normalizeShortText((data as { liked?: unknown }).liked, 1000);
    const improvements = normalizeShortText(
      (data as { improvements?: unknown }).improvements,
      1000
    );
    if (!liked && !improvements) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "liked or improvements is required"
      );
    }

    const shareUrl = normalizeHttpUrl(
      (data as { shareUrl?: unknown }).shareUrl
    );
    if (!shareUrl) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "shareUrl must be an http(s) URL"
      );
    }

    const sessionCountRaw = Number(
      (data as { sessionCount?: unknown }).sessionCount
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
      now
    );

    await ref.set({
      userId: uid,
      rating,
      liked,
      improvements,
      shareUrl,
      sessionCount,
      rewardMonths: EXPERIENCE_SHARE_REWARD_MONTHS,
      // 부여 플랜은 grantPlan 이 결정한다(기존 team grant 를 강등하지 않으므로
      // 항상 pro 인 게 아니다). 하드코딩하면 기록이 실제 doc 과 어긋난다.
      rewardPlanType: grantOutcome.planType,
      rewardGrantApplied: grantOutcome.granted,
      rewardSkippedReason: grantOutcome.skippedReason,
      rewardPeriodEnd: admin.firestore.Timestamp.fromDate(
        grantOutcome.periodEnd
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
  }
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
  founder: Record<string, unknown>
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
  grantStartedAt: Date
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
    grantStartedAt
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
      { merge: true }
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
  locale: FounderLocale
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
  locale: FounderLocale
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
  extraHeaders?: Record<string, string>
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
  locale: string
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
  locale: string
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn(
        "[founder-email] RESEND_API_KEY 미설정 — 설문 리마인더 발송 스킵:",
        maskEmailForLog(email)
      );
      return false;
    }
    const content = buildFounderSurveyOfferEmail(
      normalizeFounderLocale(locale)
    );
    // 마케팅 메일 — one-click unsubscribe 헤더+푸터(CAN-SPAM/RFC 8058).
    const delivery = marketingEmailDelivery(email);
    return await postResendEmail(
      email,
      delivery ? withUnsubscribeFooter(content, delivery) : content,
      "founder-email",
      delivery?.headers
    );
  } catch (err) {
    console.warn(
      "[founder-email] 설문 리마인더 발송 실패:",
      maskEmailForLog(email),
      err
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
  email: string
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
  resetWindow = false
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
      { merge: true }
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
    { merge: true }
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
      betaStartedAt
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
        "email required"
      );
    }
    const resetWindow = data?.resetWindow === true;
    return markFounderSelectedInternal(email, resetWindow);
  }
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
  email: string
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
    { merge: true }
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
          `[markFounderRejected] ★결제 흔적이 남은 grant doc 회수 (uid=${uid}) — 과거 stomp 로 유료구독이 grant 로 덮인 건이면 수동 확인 필요`
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
          { merge: true }
        );
      }
      subscriptionRevoked = true;
    } else if (subSnap.exists) {
      console.log(
        `[markFounderRejected] grant 아님 — 구독 보존(취소하지 않음). status=${sub?.status}, paymentProvider=${sub?.paymentProvider}`
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
        "email required"
      );
    }

    const targets = await findWaitlistDocsByEmail(email);
    for (const doc of targets) {
      await doc.ref.set(
        {
          status: "rejected",
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const { founderRevoked, subscriptionRevoked } = await revokeFounderGrant(
      email
    );
    console.log(
      `[markFounderRejected] email=${email} waitlist=${targets.length} founderRevoked=${founderRevoked} subRevoked=${subscriptionRevoked}`
    );
    return {
      ok: true as const,
      email,
      waitlistRejected: targets.length,
      founderRevoked,
      subscriptionRevoked,
    };
  }
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
        "email required"
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
      { merge: true }
    );
    return { ok: true, emailSent };
  }
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
          target.locale
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
            { merge: true }
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
      {}
    );
    // 도메인 집계(개수만 — PII 원문 아님). 발송 규모/스팸필터 사전 점검용.
    const domainBreakdown = audience.reduce<Record<string, number>>(
      (acc, a) => {
        const at = a.email.lastIndexOf("@");
        const domain = at >= 0 ? a.email.slice(at + 1) : "(invalid)";
        acc[domain] = (acc[domain] ?? 0) + 1;
        return acc;
      },
      {}
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
  }
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
      typeof v.email === "string" ? v.email : doc.id
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
        inactive.map((r) => r.email)
      ),
    };
  }
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
  segment: FollowupSegment
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
  segment: FollowupSegment
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY) {
      console.warn(
        "[founder-followup] RESEND_API_KEY 미설정 — 발송 스킵:",
        segment
      );
      return false;
    }
    const content = buildFounderFollowupEmail(
      normalizeFounderLocale(locale),
      segment
    );
    // 마케팅 메일 — one-click unsubscribe 헤더+푸터(CAN-SPAM/RFC 8058).
    const delivery = marketingEmailDelivery(email);
    return await postResendEmail(
      email,
      delivery ? withUnsubscribeFooter(content, delivery) : content,
      "founder-followup",
      delivery?.headers
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
          "그 전에 dryRun 으로 대상을 확인하고 사장님 승인을 받으세요."
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
          { merge: true }
        );
      } else {
        failed++;
      }
    }
    return { ...preview, sent, failed, sentBySegment };
  }
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
        "[founder-auto-select] RESEND_API_KEY 미설정 — cap 알림 발송 스킵"
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
      "founder-auto-select"
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
        { merge: true }
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
      { merge: true }
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
          { merge: true }
        );
        console.warn(
          "[founder-auto-select] waitlist suppressed:",
          snap.id,
          classified.reason
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
          { merge: true }
        );
        console.warn(
          "[founder-auto-select] agreed=false — 자동 접근 부여 스킵:",
          snap.id
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
          { merge: true }
        );
        console.warn(
          "[founder-auto-select] duplicate selected email — access email resend skipped:",
          snap.id
        );
        await alertFounderCohortCapIfNeeded().catch((err) =>
          console.warn("[founder-auto-select] cap 확인 실패:", snap.id, err)
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
        { merge: true }
      );
      await alertFounderCohortCapIfNeeded().catch((err) =>
        console.warn("[founder-auto-select] cap 확인 실패:", snap.id, err)
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
        Date.now()
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
          `owner=${ownerId} project=${snap.id} (owned=${owned.size})`
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
      "설문 답변이 필요합니다."
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
      `필수 7문항을 모두 입력해 주세요. 누락: ${missing.join(", ")}`
    );
  }
  return parsed;
}

function parseFounderRubricScore(raw: unknown): FounderRubricScore {
  if (!raw || typeof raw !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "rubricScore is required"
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
        `${key} must be an integer from 0 to 3`
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
      `rubricScore.total must equal ${total}`
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
  selector: unknown
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
    toMillis(b.data().createdAt) > toMillis(a.data().createdAt) ? b : a
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
        "로그인이 필요합니다."
      );
    }
    // 무료 Pro 부여 경계 — 이메일 소유권 위조 방지를 위해 인증된 이메일만 허용.
    if (token.email_verified !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "이메일 인증이 완료된 계정만 제출할 수 있습니다."
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
          "선정된 파운더가 아닙니다. 선정 안내 이메일의 계정으로 로그인했는지 확인해 주세요."
        );
      }
      const fd = s.data()!;
      if (fd.feedbackSubmittedAt) {
        throw new functions.https.HttpsError(
          "already-exists",
          "이미 설문을 제출하셨습니다."
        );
      }
      const granted =
        fd.accessGrantedAt && typeof fd.accessGrantedAt.toDate === "function"
          ? fd.accessGrantedAt.toDate()
          : null;
      if (!granted) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "접근 권한이 아직 부여되지 않았습니다."
        );
      }
      betaExpiresAt =
        fd.betaExpiresAt && typeof fd.betaExpiresAt.toDate === "function"
          ? fd.betaExpiresAt
          : admin.firestore.Timestamp.fromDate(
              addMonths(granted, FOUNDER_BETA_MONTHS)
            );
      tx.set(
        fRef,
        {
          userId: uid,
          status: "feedback_submitted",
          feedbackSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    const fbRef = await db.collection(FOUNDER_FEEDBACK_COLLECTION).add({
      email,
      userId: uid,
      locale: normalizeFounderLocale(
        typeof data?.locale === "string" ? data.locale : "ko"
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
      { merge: true }
    );

    return {
      ok: true,
      feedbackId: fbRef.id,
      status: "pending_review",
      betaExpiresAt: betaExpiresAt
        ? (betaExpiresAt as admin.firestore.Timestamp).toDate().toISOString()
        : null,
    };
  }
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
        "로그인이 필요합니다."
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
  }
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
        "feedback is missing userId or email"
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
        grantStartedAt
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
        { merge: true }
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
  }
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
  }
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
        "feedback is missing email"
      );
    }
    await feedbackSnap.ref.set(
      {
        interviewRequested: true,
        interviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection(FOUNDERS_COLLECTION).doc(email).set(
      {
        status: "interview_requested",
        interviewRequested: true,
        interviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, feedbackId: feedbackSnap.id };
  }
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
        "feedback is missing email"
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
        "설문 제출 전이라 계정이 연결되지 않았습니다. 설문 제출 후 진행하세요."
      );
    }
    if (feedback.interviewCompleted === true || f.interviewCompleted === true) {
      throw new functions.https.HttpsError(
        "already-exists",
        "이미 인터뷰 보상이 적용되었습니다."
      );
    }
    if (feedback.interviewRequested !== true && f.interviewRequested !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "인터뷰 요청 대상자만 완료 처리할 수 있습니다."
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
      grantStartedAt
    );
    await feedbackSnap.ref.set(
      {
        interviewCompleted: true,
        interviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        proGrantedMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
        proExpiresAt: admin.firestore.Timestamp.fromDate(periodEnd),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
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
      { merge: true }
    );
    return {
      ok: true,
      proMonths: FOUNDER_INTERVIEW_TOTAL_PRO_MONTHS,
      currentPeriodEnd: periodEnd.toISOString(),
    };
  }
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
  }
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
        "email required"
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
      toMillis(b.data().createdAt) > toMillis(a.data().createdAt) ? b : a
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
  }
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
      "로그인이 필요합니다."
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
      "버그 설명을 입력해 주세요."
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
      str(ctxIn.agentSnapshot, BUG_REPORT_CTX_FIELD_MAX)
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
        "잠시 후 다시 시도해 주세요."
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
        "하루 제출 한도를 초과했습니다. 내일 다시 시도해 주세요."
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
      { merge: true }
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
        "유효하지 않은 상태값입니다."
      );
    }
    const ref = db.collection("bugReports").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "신고를 찾을 수 없습니다."
      );
    }
    await ref.set(
      {
        status,
        triagedBy: context.auth?.uid ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true };
  }
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
  // ── ★라우팅 라벨 계측(#890 §7 F-1~F-4, 티켓 AdJ1Gon2) ────────────────
  // 전부 optional·비식별(숫자/enum/모델 id). 기존 행은 이 키들이 없을 뿐이고,
  // `metadata` 는 JSON STRING 컬럼이라 BigQuery 마이그레이션이 필요 없다.
  /** spawnedModel 의 근거(argv=우리가 넘긴 인자 / observed=과금 세션 관측). */
  spawnedModelSource?: string;
  /** 라우터가 **고른** 칸(model@effort) — 실현값(spawnedModel)과 다른 축. */
  plannedModelKey?: string;
  /** 비선택 후보까지 포함한 후보집합의 model@effort 키. */
  candidateKeys?: string[];
  /** 결정 시점 단가 스냅샷(modelKey → blended $/1M). */
  candidateCostIndex?: Record<string, number>;
  /** 결정 시점 상태(예산 소진율·주간 점유·활성 에이전트 수). */
  decisionState?: Record<string, unknown>;
  /** 선택 칸의 점수 8성분 + mode/decidedBy(문자열 파싱 대체). */
  decisionComponents?: Record<string, unknown>;
}

// events.metadata 조립은 telemetryMetadata.ts(순수 모듈)로 분리했다 —
// "events 에 계정 식별자를 넣지 않는다" 는 프라이버시 불변식을 단위테스트가
// 지킬 수 있는 자리에 두기 위해서다(ticket woXp2c70oR0tliGB8Vs6).

// ── 사람 축 링크 배선 (설계 §5.1 / 구현문서 §10-5) ─────────────────────────
//
// ★부여 시점은 **그 설치의 로그인 후 첫 인증 요청**이다. 텔레메트리 콜러블은
//   auth 강제라 이미 uid 를 갖고 있고(telemetryMetadata.ts 가 그걸 일부러
//   버린다), 우리는 그 uid 를 **저장하지 않고 파생만** 한다. 수집 항목은 늘지
//   않는다 — 클라이언트가 새로 보내는 값도 없다.
//
// ★forward-only. 배선 뒤에도 각 설치는 **다음에 인증할 때** 붙는다. 배포 직후
//   링크가 0 에 가까운 것은 장애가 아니라 설계다(PERSON_AXIS_FORWARD_ONLY_NOTE).
//
// ★이 경로가 events 적재를 죽이면 안 된다. 링크는 분석 편의이고 텔레메트리는
//   제품 기능이다 — 실패하면 사유만 남기고 요청은 성공시킨다.
//
// ★uid 도 user_key 도 **이벤트 행에는 붙지 않는다.** 링크표에만 간다.

/** 링크표가 사는 프로젝트. check-person-axis-isolation.ts 와 같은 규약. */
const PERSON_AXIS_PROJECT_ID =
  process.env.GCLOUD_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCP_PROJECT ??
  "marblo-2253d";

/**
 * 같은 (user_key, install_key) 를 다시 MERGE 하기까지 기다리는 시간.
 *
 * ★MERGE 자체는 멱등이라 몇 번을 돌려도 표는 같다. 이 창은 **정확성이 아니라
 * 비용·쿼터** 때문이다 — 텔레메트리는 배치마다 오는데 링크는 설치당 사실상
 * 한 번 정해지는 값이라, 배치마다 DML 을 돌리면 같은 한 줄을 하루에 수백 번
 * 다시 쓰게 되고 BQ 의 테이블당 DML 동시성에 그대로 부딪힌다.
 *
 * ★대신 `last_seen_at` 이 최대 이 창만큼 늦다. 그 컬럼은 소급 경계가 아니라
 * "최근 확인 시각" 이고(경계는 first_linked_at 이다), 6시간 해상도로 충분하다.
 *
 * ★두 번째 대가: MERGE 를 **await 한다**. 안 하면 Cloud Functions 가 응답 뒤
 * 인스턴스를 얼려서 쿼리가 중간에 죽는다. 그래서 이 창이 열리는 요청 하나는
 * MERGE 잡(수 초)만큼 느려진다 — 설치당 6시간에 한 번이라 감수한다. 실패해도
 * 이벤트는 이미 들어갔고 요청은 성공한다(호출측 try/catch).
 */
const PERSON_AXIS_LINK_TTL_MS = 6 * 60 * 60 * 1000;

/** 인스턴스 메모리 캐시 상한. 넘으면 통째로 비운다(비워도 MERGE 가 멱등이다). */
const PERSON_AXIS_LINK_CACHE_MAX = 5000;

/** key = `${user_key}|${install_key}` — ★원시 uid·설치 id 는 담기지 않는다. */
const personAxisLinkSeen = new Map<string, number>();

let personAxisGateWarned = false;

/**
 * 인증된 요청 하나에서 링크 한 줄을 MERGE 한다.
 *
 * 돌려주는 값은 로그·테스트용 사유 코드다. ★값에 식별자를 넣지 않는다 —
 * 이 문자열이 그대로 Cloud Logging 에 남는다.
 */
async function recordPersonAxisLink(
  uid: string,
  clientId: unknown,
  nowIso: string
): Promise<string> {
  const gate = resolvePersonAxisGate();
  if (!gate.open) {
    // ★게이트가 닫혀 있으면 **적재도** 막는다. 닫힌 채로 링크가 쌓이면 나중에
    //   여는 순간 고지 개정 전에 만들어진 링크가 소급에 참여한다(설계 §1).
    if (!personAxisGateWarned) {
      personAxisGateWarned = true;
      functions.logger.warn("[personAxis] gate closed — 링크를 만들지 않는다", {
        reasonCode: gate.reasonCode,
        reason: gate.reason,
      });
    }
    return `gate_closed:${gate.reasonCode}`;
  }

  const salt = getAnalyticsIdSalt();
  if (!salt) return "no_salt";

  const rawInstall = typeof clientId === "string" ? clientId.trim() : "";
  // "anon" 은 clientId 가 없을 때 events 가 쓰는 자리표시자다(위 rows 매핑).
  // 그걸 설치로 링크하면 서로 다른 사람이 한 설치를 공유한 것처럼 보인다.
  if (rawInstall.length === 0 || rawInstall === "anon") return "no_install_id";

  const userKey = pseudonymizeAnalyticsId("user", uid, salt);
  const installKey = pseudonymizeAnalyticsId("install", rawInstall, salt);
  if (typeof userKey !== "string" || typeof installKey !== "string") {
    return "pseudonym_failed";
  }

  const cacheKey = `${userKey}|${installKey}`;
  const nowMs = Date.parse(nowIso);
  const last = personAxisLinkSeen.get(cacheKey);
  if (last !== undefined && nowMs - last < PERSON_AXIS_LINK_TTL_MS) {
    return "throttled";
  }

  const planned = planUserInstallLink(
    {
      userKey,
      installKey,
      // ★스킴은 **원시 설치 id** 로 판정한다. 가명은 길이가 원시와 무관해서
      //   가명으로 재면 항상 unknown 이 나온다(analyticsProfiles.ts 주석 참조).
      idScheme: classifyIdScheme(rawInstall),
      linkSource: LINK_SOURCE_TELEMETRY_AUTH,
      observedAt: nowIso,
      policyVersion: PERSON_AXIS_LINK_POLICY_VERSION,
      salt,
    },
    gate
  );
  if (!planned.written) {
    functions.logger.info("[personAxis] 링크를 만들지 않았다", {
      reason: planned.reason,
    });
    return "not_written";
  }

  await bigquery.query({
    query: buildUserInstallInlineMergeSql(PERSON_AXIS_PROJECT_ID),
    params: buildUserInstallMergeParams(planned.row),
    location: BQ_LOCATION,
  });

  if (personAxisLinkSeen.size >= PERSON_AXIS_LINK_CACHE_MAX) {
    personAxisLinkSeen.clear();
  }
  personAxisLinkSeen.set(cacheKey, nowMs);
  return "merged";
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
        "events array required"
      );
    }

    if (events.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Max 100 events per batch"
      );
    }

    // Auth is required for anti-abuse, but we deliberately DO NOT persist the
    // uid — not in the `userId` column and not in `metadata` either. The events
    // table is 비식별(익명): its only identity is the client-supplied anonymous
    // install id, and journeys are correlated on that alone.
    //
    // History (ticket woXp2c70oR0tliGB8Vs6): the server used to merge
    // metadata.accountUserId = context.auth.uid so admin analytics could dedup
    // by account. That silently made a table the privacy policy describes as
    // carrying no account identifier carry one, so it was removed and the
    // account axis was retired instead of the promise. Account-linked usage
    // still exists — but only in cost_logs.userId, whose purpose is showing a
    // user their own spend back (see logCostBatch / getCostSummary).
    //
    // ★And dropping the uid was only half of it (ticket U5OPOKf0D3I2TSRP8yUq).
    // cost_logs keeps the raw projectId/agentId/taskId next to that uid, and
    // this table used to store the very same raw ids — so any of the three
    // joined an "anonymous" event straight back to an account. The join keys
    // written here are now salted HMAC pseudonyms (analyticsPseudonym.ts); the
    // salt lives in the function env, never in BigQuery.
    const now = new Date().toISOString();
    const idSalt = getAnalyticsIdSalt();

    const rows = events.map((e) =>
      pseudonymizeAnalyticsRow(
        {
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
          metadata: buildMetadata(e),
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
        },
        idSalt
      )
    );

    await bigquery.dataset(BQ_DATASET).table(BQ_EVENTS_TABLE).insert(rows);

    // ── 사람 축 링크 (설계 §5.1) ─────────────────────────────────────────
    // ★events 적재가 끝난 **뒤에** 한다. 링크는 분석 편의고 텔레메트리는 제품
    //   기능이라, 링크가 죽어도 이벤트는 들어가야 한다.
    // ★uid 는 여기서 소비되고 버려진다 — 이벤트 행에도, 응답에도 없다.
    let personAxisLink = "skipped";
    try {
      // 한 배치는 한 설치에서 온다(clientId 는 설치당 상수). 그래도 빈 값이
      // 섞일 수 있어 **처음 비어 있지 않은 것**을 쓴다.
      const batchClientId = events.find(
        (e) => typeof e.clientId === "string" && e.clientId.trim().length > 0
      )?.clientId;
      personAxisLink = await recordPersonAxisLink(
        context.auth.uid,
        batchClientId,
        now
      );
    } catch (err) {
      // 조용히 삼키지 않는다 — 사유는 남기고 요청은 성공시킨다.
      personAxisLink = "error";
      functions.logger.error("[personAxis] 링크 MERGE 실패", {
        message: safeAnalyticsErrorMessage(err),
      });
    }

    return { inserted: rows.length, personAxisLink };
  }
);

// ─── 라우팅 shadow 서빙 스텁 (ticket 6LH4Y1GC7xeWA94pW3Ar) ─────────────────
//
// ★★ 비목표를 먼저 적는다. 이 함수는 **학습하지 않고, 실반영하지 않는다.**
// 클라이언트는 로컬 `model-autoselect` 가 고른 칸으로 이미 스폰을 끝냈고, 여기에
// 묻는 것은 "클라우드였다면 뭘 골랐을까" 하나뿐이다. 응답은 어떤 스폰도 바꾸지
// 않으며(shadow), 실패해도 로컬 라우팅은 그대로 돈다(호출측이 fire-and-forget).
//
// 왜 쓰기(BigQuery insert)를 여기서 하지 않나: shadow 비교 결과는 **기존 텔레
// 메트리 경로**(렌더러 logTelemetry → logTelemetryBatch → events)로 적재된다.
// 그 경로에는 이미 (a) 사용자 동의 게이트, (b) PII scrub, (c) 조인키 가명화가
// 붙어 있다. 여기서 따로 insert 하면 그 세 가지를 우회하는 두 번째 쓰기 경로가
// 생긴다 — 새 테이블·새 IAM·새 프라이버시 표면을 만들 이유가 없다. 그래서 이
// 콜러블은 **읽기 전용**이다(BigQuery 를 건드리지 않는다).
//
// 페이로드: 숫자·enum·모델 id 뿐이다. parseShadowFeatures 가 화이트리스트라
// 그 밖의 키(프롬프트·경로·태그 문자열)는 서버가 보지도 않고 버린다.
export const getRoutingRecommendation = functions.https.onCall(
  async (data, context) => {
    // 인증은 anti-abuse 용이다 — uid 는 어디에도 적지 않는다(이 함수는 아무것도
    // 적지 않는다).
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }
    const features = parseShadowFeatures(data?.features);
    if (!features) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "features {tier, harness, rungs[]} required"
      );
    }
    // ★순서가 계약이다: 추천이 먼저, 비교가 나중. recommendRouting 은 로컬
    // 결정을 인자로 받지 않으므로 정답을 훔쳐볼 수 없다(routingShadow.test.ts).
    const recommendation = recommendRouting(features);
    if (!recommendation) {
      // 사다리가 비었거나 티어가 이상하다 = 추천할 근거가 없다. 지어내지 않고
      // "없음" 을 돌려준다 — 클라는 shadow 이벤트를 남기지 않고 끝낸다.
      return { schemaVersion: ROUTING_SHADOW_SCHEMA_VERSION, ok: false };
    }
    const comparison = compareShadowRouting(
      features,
      recommendation,
      data?.localModelKey
    );
    return {
      schemaVersion: ROUTING_SHADOW_SCHEMA_VERSION,
      ok: true,
      recommendation: {
        modelKey: recommendation.modelKey,
        heuristicVersion: recommendation.heuristicVersion,
        decidedBy: recommendation.decidedBy,
        reason: recommendation.reason,
        scores: recommendation.scores,
      },
      comparison,
    };
  }
);

// ─── 학습데이터 캡처 → BigQuery marblo_training (ticket IqcXHVbT0rXnHloXpV7n) ──
//
// 위 logTelemetryBatch 와 **의도적으로 다른 데이터셋**이다. events 는 비식별·
// 상시라 원문 텍스트를 못 담고(그래서 생성형 파인튜닝이 불가했다), 이 경로는
// 원문을 담되 admin 본인 + 명시 동의로만 열린다. 데이터셋을 나눠야 BigQuery IAM
// 에서 "분석용 텔레는 열고 전사(transcript)는 닫는" 분리가 가능하다.
//
// 게이트는 여기(서버)가 권위다. 클라도 자기 쪽에서 막지만(원문이 아예 기기 밖으로
// 안 나가게), 조작된 클라가 있어도 여기서 uid==ADMIN_UID + consent 를 다시 본다.

/** 사용자 문서에서 학습데이터 동의 플래그를 읽는다(문서 부재 = 미설정). */
async function readTrainingConsentDoc(
  uid: string
): Promise<TrainingConsentDoc | null> {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? (snap.data() as TrainingConsentDoc) : null;
  } catch (err) {
    functions.logger.warn("[trainingCapture] consent read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // 읽기 실패는 '동의'가 아니다 — 호출부가 fail-closed 로 처리하도록 null 이
    // 아닌 '미동의' 의미의 명시적 false 를 돌려준다.
    return { privacyConsent: { trainingDataCapture: false } };
  }
}

/**
 * 이 계정이 학습데이터를 캡처해도 되는지. 응답은 boolean 2개뿐 — ADMIN_UID 도,
 * 다른 사용자 정보도 절대 반환하지 않는다(클라가 admin uid 를 알 필요가 없다).
 */
export const getTrainingCaptureStatus = functions.https.onCall(
  async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }
    const uid = context.auth.uid;
    const adminUid = process.env.ADMIN_UID?.trim() ?? "";
    // 비적격(대다수 사용자)에겐 사용자 문서를 읽을 이유조차 없다.
    if (!adminUid || uid !== adminUid) {
      return { eligible: false, consent: false };
    }
    const gate = resolveCaptureGate(
      uid,
      adminUid,
      await readTrainingConsentDoc(uid)
    );
    return { eligible: gate.eligible, consent: gate.consent };
  }
);

let trainingTableReady = false;

/** 데이터셋/테이블을 최초 1회 생성한다(마케팅 미러와 같은 패턴). 수동 BigQuery
 *  마이그레이션 없이 배포 즉시 적재가 시작되도록 하기 위한 것. */
async function ensureTrainingTable(): Promise<void> {
  if (trainingTableReady) return;
  const dataset = bigquery.dataset(TRAINING_DATASET);
  const [datasetExists] = await dataset.exists();
  if (!datasetExists) await dataset.create({ location: BQ_LOCATION });
  const table = dataset.table(TRAINING_SAMPLES_TABLE);
  const [tableExists] = await table.exists();
  if (!tableExists) {
    await table.create({
      schema: TRAINING_SAMPLES_SCHEMA as unknown as {
        name: string;
        type: string;
      }[],
      timePartitioning: { type: "DAY", field: "ingestedAt" },
      clustering: { fields: ["harness", "model", "source"] },
    });
    functions.logger.info("[trainingCapture] created training_samples table");
  }
  trainingTableReady = true;
}

export const logTrainingSamples = functions
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }
    const uid = context.auth.uid;
    const gate = resolveCaptureGate(
      uid,
      process.env.ADMIN_UID,
      await readTrainingConsentDoc(uid)
    );
    if (!gate.allowed) {
      // 사유는 코드로만 남긴다(uid 로그 금지). 클라는 permission-denied 를 보면
      // 업로드를 멈추고 스풀을 보존한다.
      functions.logger.warn("[trainingCapture] insert refused", {
        reason: gate.reason,
      });
      throw new functions.https.HttpsError(
        "permission-denied",
        "Training capture is not enabled for this account."
      );
    }

    const samples = (data as { samples?: unknown })?.samples;
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "samples array required"
      );
    }
    if (samples.length > MAX_SAMPLES_PER_BATCH) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `Max ${MAX_SAMPLES_PER_BATCH} samples per batch`
      );
    }

    const ingestedAt = new Date().toISOString();
    const { rows, skipped } = toTrainingRows(samples, uid, ingestedAt);
    if (rows.length === 0) {
      // 전부 빈 샘플이었다 — 클라가 스풀을 비울 수 있게 성공으로 답하되 건수를
      // 정직하게 0 으로 돌려준다(조용한 성공 위장 금지).
      return { inserted: 0, skipped };
    }

    await ensureTrainingTable();
    await bigquery
      .dataset(TRAINING_DATASET)
      .table(TRAINING_SAMPLES_TABLE)
      .insert(rows);

    functions.logger.info("[trainingCapture] inserted", {
      rows: rows.length,
      skipped,
    });
    return { inserted: rows.length, skipped };
  });

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
      "entries array required"
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
      "projectId required"
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
      "projectId required"
    );
  }

  const requestedDays = Number(data.days ?? 30);
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "days must be a positive integer"
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
    0
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
      "outcome with taskId required"
    );
  }

  // 비식별: store the anonymous client id, not the account uid (anti-abuse
  // auth above is enough — the row itself stays de-identified).
  // ★조인키(taskId/projectId)는 cost_logs 와 같은 원시 공간이었다 → 가명화한다
  //   (ticket U5OPOKf0D3I2TSRP8yUq, analyticsPseudonym.ts).
  const now = new Date().toISOString();

  const row = pseudonymizeAnalyticsRow(
    {
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
    },
    getAnalyticsIdSalt()
  );

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
      "beats array required"
    );
  }

  if (beats.length > 50) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Max 50 beats per batch"
    );
  }

  // 비식별: heartbeats carry the anonymous client id, not the account uid.
  // ★조인키(agentId/projectId)는 cost_logs 와 같은 원시 공간이었다 → 가명화한다
  //   (ticket U5OPOKf0D3I2TSRP8yUq, analyticsPseudonym.ts).
  const now = new Date().toISOString();
  const idSalt = getAnalyticsIdSalt();

  const rows = beats.map((b: Record<string, unknown>) =>
    pseudonymizeAnalyticsRow(
      {
        userId: (b.clientId as string) || "anon",
        agentId: b.agentId || "",
        projectId: b.projectId || null,
        status: b.status || null,
        tokensAccumulated: (b.tokensAccumulated as number) ?? null,
        costAccumulated: (b.costAccumulated as number) ?? null,
        lastActivityType: b.lastActivityType || null,
        timestamp: (b.timestamp as string) || now,
      },
      idSalt
    )
  );

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
        "execution with flowId and runId required"
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
  }
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
    // ★토스 전용 갱신 크론 정지(1단계).
    // 안전 근거: 이 크론은 `paymentProvider=="toss"` 만 스캔하고, 포트원 갱신은
    // 별도 크론 scheduledChargePortOneSubscriptions(05:00 KST)가 처리한다 —
    // 여기서 멈춰도 살아 있는 결제 경로는 영향받지 않는다.
    // 함수 자체는 남긴다(배포에서 지우면 되살릴 때 스케줄 재생성이 필요하고
    // 실행 로그도 끊긴다). 되돌리려면 TOSS_ENTRY_ENABLED="true".
    if (!isTossEntryEnabled(process.env.TOSS_ENTRY_ENABLED)) {
      console.log(
        "[Billing Cron] toss entry disabled; skipping toss renewal sweep"
      );
      return null;
    }
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
      // KG이니시스 카드 갱신 청구는 name/phone/email 필수 — 미저장 레거시는
      // 스킵(해지 방지). 간편결제(토스페이)는 customer.id + email 만 요구하므로
      // name/phone 부재로 스킵하면 멀쩡한 구독이 갱신 없이 만료된다.
      const subBillingKeyMethod = normalizePortOneBillingKeyMethod(
        sub.portoneBillingKeyMethod
      );
      const missingCustomerFields =
        subBillingKeyMethod === "EASY_PAY"
          ? !customerEmail
          : !customerName || !customerPhone || !customerEmail;
      if (!billingKey || missingCustomerFields) {
        console.warn(
          "[PortOne Billing Cron] missing billingKey/name/phone/email, skip",
          doc.id
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
        // ★간편결제(EASY_PAY) 빌링키도 같은 경로로 청구하되, 발급 채널이
        // 다르므로 발급수단을 넘겨 채널키를 맞춘다. 필드 없는 레거시=카드.
        billingKeyMethod: subBillingKeyMethod,
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
  }
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
  payload: Record<string, unknown>
): Promise<void> {
  if (!TELEGRAM_BETA_BOT_TOKEN) return;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BETA_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
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
  inlineKeyboard?: TgInlineKeyboard
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
  text: string
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
  docId: string
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
      }) — ${email}\n처리: ${new Date().toISOString()}`
    );
  }
}

// ─── 웹훅 핸들러: 스킵(skip) ────────────────────────────────────────
async function handleTgSkip(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string
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
    { merge: true }
  );
  await tgAnswerCallbackQuery(cqId, "스킵 처리됨");
  if (messageId) {
    await tgEditMessageText(
      chatId,
      messageId,
      `⏭️ 스킵됨 — 처리: ${new Date().toISOString()}`
    );
  }
}

// ─── 웹훅 핸들러: 예외 Pro 3개월 부여(pro) ──────────────────────────
async function handleTgProGrant(
  cqId: string,
  chatId: string,
  messageId: number,
  docId: string
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
        `⭐ 이미 Pro 부여됨 (${existingGranted}개월) — ${email}`
      );
    }
    return;
  }
  const proExpiresAt = await grantFounderProTotalInternal(
    userId,
    FOUNDER_PRO_MONTHS,
    "telegram_override",
    new Date()
  );
  await ref.set(
    {
      proGrantedMonths: FOUNDER_PRO_MONTHS,
      proExpiresAt: admin.firestore.Timestamp.fromDate(proExpiresAt),
      reviewedBy: "telegram",
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
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
      { merge: true }
    );
  await tgAnswerCallbackQuery(cqId, "Pro 3개월 부여 완료");
  if (messageId) {
    await tgEditMessageText(
      chatId,
      messageId,
      `⭐ Pro 3개월 부여 (예외승인) — ${email}\n처리: ${new Date().toISOString()}`
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
  }
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
        new Date()
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
        { merge: true }
      );
      expired++;
    }
    console.log(
      `[expireBetaGrants] scanned=${snap.size} expired→canceled=${expired}`
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
      "days must be a positive integer"
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
      "date must be YYYY-MM-DD"
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
      "key is required (max 200 chars)"
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
//   - BQ events/task_outcomes/agent_heartbeats → userId 컬럼이 익명 clientId 라
//     uid 로는 못 지운다. **그리고 이제 유추할 방법도 없다** — 아래 참조.
//
// ── ★익명 세계의 운영자 자기제외는 은퇴했다 (ticket U5OPOKf0D3I2TSRP8yUq) ────
// 예전에는 resolveAdminClientIds 가 "어드민 uid 가 소유한 cost_logs.agentId →
// 같은 agentId 를 가진 events row → 어드민의 익명 clientId" 를 역참조해 제외
// 목록을 만들었다. 그 역참조는 편리한 만큼 정확히 **계정 재연결 그 자체**였고,
// 처리방침이 익명이라 부르는 테이블을 계정으로 되짚을 수 있다는 뜻이었다.
//
// 이제 익명 세계의 조인키는 가명이라(analyticsPseudonym.ts) 그 역참조가 성립하지
// 않는다. 다리를 남겨두고 "우리는 안 쓴다" 고 적는 대신 다리를 끊었다 —
// betaSegments 의 계정축 은퇴와 같은 판단이다. 대가:
//   - 익명 세계 집계에서 운영자 도그푸드가 더는 빠지지 않는다(신규 row 기준).
//     표본이 작을 때 KPI 가 낙관 편향된다는 뜻이라, UI 는 adminExcluded 로 그
//     사실을 그대로 노출한다(clientIdCount = 0).
//   - 하네스→실모델 비용 분해(getAdminModelBreakdown 의 harnessBridge)도 같은
//     조인이 필요해 함께 은퇴했다.
// cost_logs 쪽 uid 제외(adminUidExclusion)는 그대로다 — 그쪽은 원래 계정 원장이다.
const DEFAULT_DOGFOOD_UID = "RSALO1rljtWBSZ70MoBiaeFORxr1";

function getAdminExclusionUid(): string | null {
  const uid = process.env.ADMIN_UID?.trim();
  return uid ? uid : DEFAULT_DOGFOOD_UID;
}

// events 테이블 전용 제외 절 — **계정축 은퇴 이전 과거 row 전용**이다.
// (EVENTS_ACCOUNT_AXIS_RETIRED_ON 이전 row 에만 metadata.accountUserId 가 있다.
// 신규 row 에는 없어 절이 NULL 로 통과하고, 그때는 아무것도 제외되지 않는다 —
// 익명 clientId 역참조가 은퇴했기 때문이다. 위 블록 주석 참조.)
function adminEventExclusion(): {
  clause: string;
  params: Record<string, unknown>;
} {
  const adminUid = getAdminExclusionUid();
  if (!adminUid) return { clause: "", params: {} };
  return {
    clause:
      " AND (JSON_VALUE(metadata, '$.accountUserId') IS NULL" +
      " OR JSON_VALUE(metadata, '$.accountUserId') != @excludeAccountUserId)",
    params: { excludeAccountUserId: adminUid },
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
  countCol = "n"
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
  nowMs: number
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
  nowMs: number
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
  dayEndMs: number
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
  rows: ChargeLedgerRow[]
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
            dayEndMs
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
  }
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
    const ex = includeAdmin ? EMPTY_EXCLUSION : adminEventExclusion();
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
    // ★ex.clause 를 붙이지 않는다. adminEventExclusion() 은 events 전용 절로
    // JSON_VALUE(metadata,'$.accountUserId') 를 참조하는데, task_outcomes 에는
    // metadata 컬럼 자체가 없다(스키마: userId/…/completedAt). #907 익명화가
    // 제외절을 metadata 기반으로 바꾼 뒤 이 절이 outcomes 쿼리에도 붙어
    // "Unrecognized name: metadata" 로 이 콜러블 전체가 functions/internal 로
    // 죽었다(어드민 '제품 사용·활성' 패널 전면 에러). outcomes 에는
    // accountUserId 가 없어 운영자 개별 제외가 애초에 불가하므로 절을 뺀다.
    const taskSummaryQuery = `
      SELECT
        COUNT(*) AS total,
        COUNTIF(success = true) AS succeeded,
        AVG(durationMs) AS avgDurationMs
      FROM (SELECT * FROM ${outcomesTable}
            WHERE ${completedAtTs} >= ${since}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY ${completedAtTs} DESC) = 1)
      WHERE success IS NOT NULL
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
      })
    );
    const sample = (sampleRows as Array<Record<string, unknown>>)[0] ?? {};
    const taskRow =
      (taskSummaryRows as Array<Record<string, unknown>>)[0] ?? {};
    const taskTotal = toNumber(taskRow.total as number | string | undefined);
    const taskSucceeded = toNumber(
      taskRow.succeeded as number | string | undefined
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
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
      },
      // 표본 신뢰도 라벨링(§0-B, T0-3): 옵트인/도그푸드 편향 표본 크기.
      sampleClientCount: toNumber(
        sample.sampleClients as number | string | undefined
      ),
      wau: toNumber(sample.wau as number | string | undefined),
      activeByDay,
      topEvents: foldDistribution(
        topEventsRows as Array<Record<string, unknown>>,
        "event"
      ),
      spawnsByDay: (spawnsByDayRows as Array<Record<string, unknown>>).map(
        (r) => ({
          date: String(r.date ?? ""),
          count: toNumber(r.n as number | string | undefined),
        })
      ),
      spawnsByRole: foldDistribution(
        spawnsByRoleRows as Array<Record<string, unknown>>,
        "key"
      ),
      spawnsByModel: foldDistribution(
        spawnsByModelRows as Array<Record<string, unknown>>,
        "key"
      ),
      tasks: {
        total: taskTotal,
        succeeded: taskSucceeded,
        successRate: taskTotal > 0 ? taskSucceeded / taskTotal : 0,
        avgDurationMs: toNumber(
          taskRow.avgDurationMs as number | string | undefined
        ),
      },
    };
  }
);

/**
 * getAdminOnboardingFunnel — 온보딩 24h 활성화 퍼널(🟡 BQ events).
 *
 * 설치(app:installed∪app:first_run) → app:first_run → auth:login_attempt →
 * auth:login_success → onboarding:folder_connected →
 * onboarding:orchestrator_opened → [첫대화 onboarding:first_conversation ·
 * 첫티켓 onboarding:first_ticket] → agent:spawned → task:completed →
 * [첫머지 task:merged(7일 창)] → 핵심경험 → 7일 잔존.
 * 단계별 순차 도달 고유 identity(익명 설치 ID)와
 * 인접 단계 이탈/전환을 집계하고, 실패-분기(login_failed / folder_connect_failed /
 * orchestrator_blocked / agent:crashed / spawn_blocked / agent_needs_auth /
 * funding_guide_shown)를 errorCategory 로 분해한다
 * (★orchestrator_blocked 의 cli_auth vs launch_error 등).
 *
 * ★[]로 묶은 칸은 gating=false — 화면에는 보이되 하류 단계의 이탈률 기준선이
 * 되지 않는다. 계측이 늦게 생겼거나(첫대화·첫티켓) 시간창이 다른(첫머지) 칸이
 * 체인에 끼면 그 뒤가 통째로 0 이 되어 계측 공백이 제품 실패로 둔갑하기 때문이다.
 * 자세한 근거는 adminAnalytics.ONBOARDING_FUNNEL_STEPS 주석 참조.
 *
 * 측정·한계는 buildOnboardingFunnel 의 note 참조(auth-gated flush).
 * ★여정 상관키는 익명 설치 ID(events.userId = telemetryService.getClientId) 하나다.
 * 과거 row 에만 남아 있는 metadata.accountUserId 를 COALESCE 로 먼저 보긴 하지만,
 * 계정축 은퇴(EVENTS_ACCOUNT_AXIS_RETIRED_ON) 이후 row 에는 그 값이 없어 자연히
 * 설치 ID 로 수렴한다 — 즉 이 퍼널은 uid 부착 중단으로 깨지지 않는다. 대신 한 사람이
 * 두 기기에서 설치하면 두 명으로 세어진다(계정 dedup 포기의 대가).
 * 운영자 제외는 includeAdmin(기본 false=제외) 토글을 따른다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 제외)
 */
/**
 * 퍼널 확장(티켓 ygoWP1VJ)으로 raw 스캔에 **새로 들어온** 이벤트들.
 *
 * sessions CTE 는 (프로젝트×날짜) 조합 수로 "7일 내 2번째 세션"을 근사하므로,
 * 스캔하는 이벤트 종류가 늘면 d_retained_7d 가 저절로 올라간다. 그건 잔존이
 * 좋아진 게 아니라 분모를 바꾼 것이라, 잔존 계산에서는 이 목록을 제외한다.
 */
const FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION: readonly string[] = [
  "app:installed",
  "onboarding:first_conversation",
  "onboarding:first_ticket",
  "task:merged",
  "onboarding:spawn_blocked",
  "onboarding:agent_needs_auth",
  "onboarding:funding_guide_shown",
];

export const getAdminOnboardingFunnel = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const since = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    const includeAdmin = parseIncludeAdmin(data);
    const ex = includeAdmin ? EMPTY_EXCLUSION : adminEventExclusion();
    // events.timestamp 는 BigQuery TIMESTAMP 컬럼이다. 컬럼을 함수로 감싸면
    // 파티션/클러스터 프루닝이 약해질 수 있어 직접 비교한다.
    const eventTs = "timestamp";

    // 순차 퍼널: identity(익명 설치 ID. 과거 row 에 한해 accountUserId 폴백)별
    // 최초 이벤트 시각을 만든 뒤, 각 단계가 직전 단계 이후에 발생한 사용자만 센다.
    // 가입~활성화 창은 24h 로 현실화한다. d_task_completed 는 헤드라인 분자와 같다.
    const funnelEventNames = Array.from(
      new Set([
        ...ONBOARDING_FUNNEL_STEPS.map((s) => s.event),
        ...ONBOARDING_FAILURE_EVENTS.map((f) => f.event),
      ])
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
          MIN(IF(event = 'onboarding:first_conversation', ts, NULL))
            AS first_conversation_ts,
          MIN(IF(event = 'onboarding:first_ticket', ts, NULL))
            AS first_ticket_ts,
          MIN(IF(event = 'agent:spawned', ts, NULL)) AS agent_spawned_ts,
          MIN(IF(event = 'task:completed', ts, NULL)) AS task_completed_ts,
          MIN(IF(event = 'task:merged', ts, NULL)) AS first_merge_ts,
          -- ★설치 전용 이벤트(app:installed)는 아직 발신된 적이 없다(실측 0건).
          -- 없는 신호를 지어내지 않고, 있으면 쓰고 없으면 최초 실행으로 대체한다.
          COALESCE(
            MIN(IF(event = 'app:installed', ts, NULL)),
            MIN(IF(event = 'app:first_run', ts, NULL))
          ) AS install_ts,
          COUNTIF(event IN ('app:installed', 'app:first_run')) AS n_install,
          COUNTIF(event = 'app:first_run') AS n_first_run,
          COUNTIF(event = 'auth:login_attempt') AS n_login_attempt,
          COUNTIF(event = 'auth:login_success') AS n_login_success,
          COUNTIF(event = 'onboarding:folder_connected') AS n_folder_connected,
          COUNTIF(event = 'onboarding:orchestrator_opened')
            AS n_orchestrator_opened,
          COUNTIF(event = 'onboarding:first_conversation')
            AS n_first_conversation,
          COUNTIF(event = 'onboarding:first_ticket') AS n_first_ticket,
          COUNTIF(event = 'agent:spawned') AS n_agent_spawned,
          COUNTIF(event = 'task:completed') AS n_task_completed,
          COUNTIF(event = 'task:merged') AS n_first_merge,
          -- 실패 분기 카운트는 상수(ONBOARDING_FAILURE_EVENTS)에서 생성한다.
          -- 손으로 적던 시절엔 상수에 칸을 늘려도 SQL 이 안 따라와 조용히 0 이
          -- 나왔다(needsAuth/authedButUnfunded 가 그렇게 빠져 있었다).
          ${ONBOARDING_FAILURE_EVENTS.map(
            (f) => `COUNTIF(event = '${f.event}') AS n_${f.col}`
          ).join(",\n          ")}
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
      -- ★비-gating 칸(설치·첫대화·첫티켓·첫머지)은 별도 레이어에서 파생한다.
      -- 본선 체인 SQL 을 한 줄도 건드리지 않으므로 기존 단계 수치가 그대로 남고
      -- (회귀 방지), BigQuery 가 같은 SELECT 안의 별칭 참조를 허용하지 않아
      -- 어차피 레이어가 하나 더 필요하다.
      seq_ext AS (
        SELECT
          *,
          install_ts IS NOT NULL AS reached_install,
          reached_orchestrator_opened
            AND first_conversation_ts BETWEEN orchestrator_opened_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AS reached_first_conversation,
          reached_orchestrator_opened
            AND first_ticket_ts BETWEEN orchestrator_opened_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 24 HOUR)
            AS reached_first_ticket,
          -- 머지는 24h 안에 거의 안 일어난다 — 7일 창으로 잰다(라벨에 명시).
          reached_agent_spawned
            AND first_merge_ts BETWEEN agent_spawned_ts
              AND TIMESTAMP_ADD(login_success_ts, INTERVAL 7 DAY)
            AS reached_first_merge
        FROM seq
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
          -- ★이 티켓에서 raw 에 새로 들어온 이벤트는 잔존 계산에서 뺀다.
          -- sessions 는 (프로젝트×날짜) 조합 수로 '2번째 세션' 을 근사하므로,
          -- 이벤트 종류를 늘리면 d_retained_7d(베타종료 게이지 입력)가 조용히
          -- 올라간다. 퍼널 칸을 추가했다는 이유로 잔존 지표가 좋아지는 건
          -- 계측이 아니라 착시라 명시적으로 배제한다.
          AND r.event NOT IN (${FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION.map(
            (e) => `'${e}'`
          ).join(", ")})
        GROUP BY r.identity
      )
      SELECT
        COUNTIF(reached_install) AS d_install,
        SUM(IF(reached_install, n_install, 0)) AS n_install,
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
        COUNTIF(reached_first_conversation) AS d_first_conversation,
        SUM(IF(reached_first_conversation, n_first_conversation, 0))
          AS n_first_conversation,
        COUNTIF(reached_first_ticket) AS d_first_ticket,
        SUM(IF(reached_first_ticket, n_first_ticket, 0)) AS n_first_ticket,
        COUNTIF(reached_agent_spawned) AS d_agent_spawned,
        SUM(IF(reached_agent_spawned, n_agent_spawned, 0)) AS n_agent_spawned,
        COUNTIF(reached_task_completed) AS d_task_completed,
        SUM(IF(reached_task_completed, n_task_completed, 0))
          AS n_task_completed,
        COUNTIF(reached_first_merge) AS d_first_merge,
        SUM(IF(reached_first_merge, n_first_merge, 0)) AS n_first_merge,
        COUNTIF(reached_task_completed AND n_agent_spawned >= 2)
          AS d_core_experience,
        COUNTIF(reached_task_completed AND (
          SELECT COALESCE(MAX(
            IF(sessionish_count >= 2 OR project_count >= 2, 1, 0)
          ), 0)
          FROM sessions ss
          WHERE ss.identity = seq_ext.identity
        ) = 1) AS d_retained_7d,
        ${ONBOARDING_FAILURE_EVENTS.map(
          (f) =>
            `COUNTIF(n_${f.col} > 0) AS d_${f.col},\n        ` +
            `SUM(n_${f.col}) AS n_${f.col}`
        ).join(",\n        ")},
        COUNTIF(reached_login_success) AS d_signup_base,
        COUNTIF(reached_task_completed) AS d_activated_30m
      FROM seq_ext
    `;

    // 실패 이벤트의 errorCategory 분해(cli_auth / launch_error / crash 카테고리 등).
    const failureInList = ONBOARDING_FAILURE_EVENTS.map(
      (_, i) => `@fev${i}`
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

    // ── ★단계별 신호 커버리지 (ticket 4KqBDPkH) ───────────────────────────
    // 위 퍼널 쿼리는 "순차 체인을 통과한 사람" 만 센다. 그 값이 0 일 때 그게
    // "안 했다" 인지 "창 앞부분엔 신호가 없었다" 인지 화면이 구분할 근거가 없었다 —
    // 그래서 첫대화 0 · 첫티켓 0 · 스폰 2 라는 자기모순이 그려졌다.
    //
    // ★이 쿼리는 값을 고치지 않는다(소급 보정 금지). 이벤트별로
    //   (a) 전기간 최초 관측일  (b) 조회창 안 실제 발생 설치 수
    // 만 읽어 온다. 둘 다 BigQuery 원값이고, 화면은 이걸로 `0` 과 '미수집' 과
    // '부분 구간' 을 가른다.
    //
    // ★(a)는 조회창을 안 건다 — "전기간 한 번도 없었나" 를 물어야 하기 때문이다.
    //   events 는 timestamp 파티션 테이블이라 풀스캔이 되지만, 대상 이벤트가
    //   상수 IN 목록으로 좁혀져 있고 하루 한 번 보는 어드민 화면이라 감수한다.
    const coverageQuery = `
      WITH first_seen AS (
        SELECT event, MIN(DATE(${eventTs})) AS first_seen_day
        FROM ${eventsTable}
        WHERE event IN (${inList})${ex.clause}
        GROUP BY event
      ),
      in_window AS (
        SELECT
          event,
          COUNT(DISTINCT COALESCE(
            NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''),
            userId
          )) AS clients_in_window
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${since}
          AND event IN (${inList})
          AND userId IS NOT NULL${ex.clause}
        GROUP BY event
      )
      SELECT
        f.event AS event,
        FORMAT_DATE('%F', f.first_seen_day) AS first_seen_day,
        COALESCE(w.clients_in_window, 0) AS clients_in_window
      FROM first_seen f
      LEFT JOIN in_window w USING (event)
    `;

    // ★운영자 제외가 **실제로 걸리는 행이 남아 있는지** 를 센다.
    //   adminEventExclusion() 은 metadata.accountUserId 로만 거르는데, 계정축
    //   은퇴 이후 row 에는 그 필드가 없다 — 즉 절은 통과하고 아무도 안 빠진다.
    //   그런데 응답은 applied=true 를 그대로 내려보내고 있어서, 화면은 "운영자가
    //   빠졌다" 고 믿는다. 실측값을 같이 내려보내 그 믿음을 검증 가능하게 한다.
    const adminMatchableQuery = `
      SELECT COUNT(*) AS n
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}
        AND NULLIF(JSON_VALUE(metadata, '$.accountUserId'), '') IS NOT NULL
    `;

    const queryResults = await runAdminAnalyticsQueriesWithStatus([
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
      {
        name: "onboarding.coverage",
        query: coverageQuery,
        params: { days: rangeDays, ...eventParams, ...ex.params },
      },
      {
        name: "onboarding.adminMatchable",
        query: adminMatchableQuery,
        params: { days: rangeDays },
      },
    ]);
    const funnelResult = queryResults[0] ?? {
      name: "onboarding.funnel",
      rows: [],
      error: "missing query result",
    };
    const reasonResult = queryResults[1] ?? {
      name: "onboarding.failureReasons",
      rows: [],
      error: "missing query result",
    };
    const queryErrors = queryResults
      .filter((result) => result.error != null)
      .map((result) => ({
        name: result.name,
        error: result.error ?? "unknown query failure",
      }));

    const coverageResult = queryResults[2] ?? {
      name: "onboarding.coverage",
      rows: [],
      error: "missing query result",
    };
    const matchableResult = queryResults[3] ?? {
      name: "onboarding.adminMatchable",
      rows: [],
      error: "missing query result",
    };

    // ★커버리지 쿼리가 실패했으면 빈 배열이 아니라 undefined 를 넘긴다.
    //   빈 배열은 "전 이벤트 전기간 0건" 과 같은 뜻이 되어 화면이 통째로
    //   '미수집' 이 된다 — 조회 실패를 신호 공백으로 둔갑시키는 짓이다.
    const coverageRows =
      coverageResult.error == null
        ? (coverageResult.rows as unknown as FunnelCoverageRow[])
        : undefined;
    const windowStartDay =
      coverageRows != null
        ? new Date(Date.now() - rangeDays * 86400000)
            .toISOString()
            .slice(0, 10)
        : null;

    const funnel = buildOnboardingFunnel(
      funnelResult.rows[0] as Record<string, unknown> | undefined,
      reasonResult.rows as ReasonRow[],
      coverageRows,
      windowStartDay
    );

    // 조회창 안에 accountUserId 가 남아 있는 행 수. 0 이면 제외절이 걸릴 대상이
    // 아예 없다는 뜻 = 운영자가 사실상 안 빠진다.
    const adminMatchableRows =
      matchableResult.error == null
        ? toNumber(
            (matchableResult.rows[0] as Record<string, unknown> | undefined)
              ?.n as number | string | undefined
          )
        : null;

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
        // ★제외절이 걸릴 수 있는 행 수(실측). null=측정 실패.
        //   0 이면 applied=true 라도 실제로는 아무도 안 빠진 것이다.
        matchableRows: adminMatchableRows,
      },
      queryStatus: {
        ok: queryErrors.length === 0,
        errors: queryErrors,
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
 * ★계정축 은퇴(EVENTS_ACCOUNT_AXIS_RETIRED_ON, ticket woXp2c70oR0tliGB8Vs6):
 * events 에는 더 이상 accountUserId 가 붙지 않는다. 그래서 events 브랜치는
 * **과거 구간만** 채우고, 이후 구간의 계정 활동은 cost_logs 만 남는다. 브랜치를
 * 지우지 않는 이유는 과거 데이터가 여전히 유효하기 때문이고, 그 대신 응답의
 * note(EVENTS_ACCOUNT_AXIS_NOTE)가 "언제부터 왜 얇아지는지"를 화면에 말해 준다.
 * 설치 단위 동치 지표는 getAdminOnboardingFunnel / getAdminUsageSummary 에 있다.
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
      new Set(ACTIVATION_GATE_STEPS.map((s) => s.event))
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
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
      },
      cohorts: buildRetentionCohorts(cohortRows as RetentionCohortSourceRow[]),
      activationGate: buildActivationGateFunnel(gateRows[0]),
      // ★사람 축 커버리지 봉투(설계 §10.3). 우선순위상 셋째지만, 앞의 둘이
      //   실패해도 화면이 기준 라벨을 잃지 않도록 여기도 싣는다.
      personAxis: await loadPersonAxisCoverage(rangeDays),
    };
  });

/**
 * getAdminStreakRetention — D7/D14 리텐션 + 사용자별 연속사용(스트릭) 격자.
 *
 * 사장님이 D7·D14 를 "매우 중요한 지표" 라고 했는데 지금까지 이 숫자는 사람이
 * BQ 를 직접 쳐야만 나왔다(분석 티켓 9Ns5DYu2hTXlGimIUI8N). 그 조회를 화면으로
 * 옮긴다. 집계·판정은 전부 adminAnalytics.buildStreakRetention(순수 로직,
 * node --test 검증)이 하고, 여기서는 BQ 에서 (유닛 × 날짜) 신호만 뽑는다.
 *
 * ── 위의 getAdminRetentionCohorts 와 무엇이 다른가 ──────────────────────────
 * 그쪽은 계정 identity 한 축(events.metadata.accountUserId + cost_logs)만 보고,
 * 활동을 "행이 있었는가" 로 센다. 여기는 두 가지가 다르다:
 *   1) 설치 축과 계정 축을 **분리해서** 각각 낸다(한 표에 섞으면 단위가 섞인다).
 *   2) 설치 축의 활동을 status="working" 또는 이벤트로 정의한다 — 하트비트가
 *      떠 있기만 한 좀비 프로세스를 코호트에서 빼기 위해서다(실측에서 어떤
 *      설치가 14일 중 13일 "활동" 이었는데 working 0건·이벤트 0건이었다).
 * 그리고 모든 비율을 분자/분모와 함께 낸다 — 계정 5개, 유의미 사용 2개인
 * 표본에서 "50%" 만 띄우는 게 이 화면의 가장 큰 위험이다.
 *
 * ── 축별 소스 ──────────────────────────────────────────────────────────────
 *   설치 축 = agent_heartbeats(working/전체 하트비트) + events(이벤트 수).
 *             둘 다 userId 가 익명 설치 ID 다(index.ts:6555 userId = clientId).
 *   계정 축 = cost_logs.userId(=Firebase uid). ★events.metadata.accountUserId 는
 *             실측상 2026-08-06~08-10 5일간 uid 1개에만 존재해 축으로 쓸 수 없다
 *             (전 구간 null). flow_executions 는 코드상 계정 축이 맞지만 row 0.
 *
 * ★원시 식별자는 응답에 싣지 않는다. 조회한 uid/UUID 는 이 함수 안에서만 살고,
 * 밖으로 나가는 것은 buildStreakRetention 이 만든 안정 라벨(I-xxxxxx/A-xxxxxx)뿐이다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 운영자 제외)
 */
export const getAdminStreakRetention = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const includeAdmin = parseIncludeAdmin(data);
    // ★활동 이력은 조회 창이 아니라 **전 구간**을 봐야 한다. 첫 활동일과 최대
    // 연속일은 창을 자르는 순간 거짓이 된다(창 시작일이 첫 활동일로 둔갑한다).
    // rangeDays 는 "어느 코호트를 D7/D14 표에 넣을지" 만 정한다.
    const historyDays = 400;
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;
    const heartbeatsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_HEARTBEATS_TABLE}\``;

    // 설치 축: working 하트비트 / 전체 하트비트 / 이벤트를 (설치 × 날짜)로.
    // 세 신호를 나눠 담는 이유가 곧 좀비 판정이다 — presence 만 있고 working·
    // event 가 0 인 날은 "활동" 이 아니다.
    const installActivityQuery = `
      WITH beats AS (
        SELECT
          userId AS unit,
          DATE(timestamp) AS activity_date,
          COUNTIF(status = 'working') AS workingSignals,
          COUNT(*) AS presenceSignals,
          0 AS eventSignals
        FROM ${heartbeatsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @historyDays DAY)
          AND userId IS NOT NULL AND userId != '' AND userId != 'anon'
        GROUP BY unit, activity_date
      ),
      evs AS (
        SELECT
          userId AS unit,
          DATE(timestamp) AS activity_date,
          0 AS workingSignals,
          0 AS presenceSignals,
          COUNT(*) AS eventSignals
        FROM ${eventsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @historyDays DAY)
          AND userId IS NOT NULL AND userId != '' AND userId != 'anon'
        GROUP BY unit, activity_date
      )
      SELECT
        unit,
        FORMAT_DATE('%F', activity_date) AS date,
        SUM(workingSignals) AS workingSignals,
        SUM(presenceSignals) AS presenceSignals,
        SUM(eventSignals) AS eventSignals
      FROM (SELECT * FROM beats UNION ALL SELECT * FROM evs)
      GROUP BY unit, date
    `;

    // 계정 축: cost_logs 행 자체가 실사용의 증거다(과금된 모델 호출). 그래서
    // working/presence 를 같은 값으로 채운다 — 이 축에는 좀비가 없다.
    const accountActivityQuery = `
      SELECT
        userId AS unit,
        FORMAT_DATE('%F', DATE(timestamp)) AS date,
        COUNT(*) AS workingSignals,
        COUNT(*) AS presenceSignals,
        0 AS eventSignals
      FROM ${costTable}
      WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @historyDays DAY)
        AND userId IS NOT NULL AND userId != ''
      GROUP BY unit, date
    `;

    // 설치 ↔ 계정 다리. ★2026-08 부터 익명 세계의 agentId 는 HMAC 가명이라
    // (analyticsPseudonym.ts) 이 조인은 가명화 이전 과거 row 에서만 걸린다.
    // 즉 시간이 지날수록 "매핑 불가" 가 늘어난다 — 그 사실을 숨기지 않고
    // mapping.unmappedInstalls 로 화면에 그대로 내보낸다.
    // ★양쪽을 DISTINCT (userId, agentId) 로 먼저 접고 조인한다. 원본끼리 바로
    // 조인하면 agentId 하나가 하트비트 수만 건 × cost 수만 건의 곱집합으로
    // 터진다(한 설치가 하트비트 35,000건을 남긴 실측이 있다). 접고 나면
    // joins = 두 축이 공유하는 **서로 다른 agentId 수** 가 되어, 우세 계정을
    // 고르는 신호로도 곱집합보다 정직하다.
    const bridgeQuery = `
      WITH install_agents AS (
        SELECT DISTINCT userId AS installUnit, agentId
        FROM ${heartbeatsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @historyDays DAY)
          AND agentId IS NOT NULL AND agentId != ''
          AND userId IS NOT NULL AND userId != '' AND userId != 'anon'
      ),
      account_agents AS (
        SELECT DISTINCT userId AS accountUnit, agentId
        FROM ${costTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @historyDays DAY)
          AND agentId IS NOT NULL AND agentId != ''
          AND userId IS NOT NULL AND userId != ''
      )
      SELECT
        i.installUnit AS installUnit,
        a.accountUnit AS accountUnit,
        COUNT(DISTINCT i.agentId) AS joins
      FROM install_agents i
      JOIN account_agents a USING (agentId)
      GROUP BY installUnit, accountUnit
    `;

    const params = { historyDays };
    const [installRows, accountRows, bridgeRows] =
      await runAdminAnalyticsQueries([
        { name: "streak.installActivity", query: installActivityQuery, params },
        { name: "streak.accountActivity", query: accountActivityQuery, params },
        { name: "streak.installAccountBridge", query: bridgeQuery, params },
      ]);

    const mappingRows = bridgeRows as InstallAccountMappingRow[];

    // ── 운영자 제외 ──────────────────────────────────────────────────────────
    // 계정 축은 uid 로 정확히 빠진다. 설치 축은 그렇지 않다: 익명 세계에는 uid 가
    // 없어서 agentId 다리로 역추적해야 하고, 그 다리는 가명화 이후 끊겨 있다.
    // 그래서 설치 축의 제외는 **불완전**하고, 화면은 그 불완전성을 mapping 요약과
    // note 로 드러낸다(조용히 "제외했다" 고 말하는 쪽이 더 위험하다).
    //
    // 예외 하나: 2026-06-13 이전 설치 id 는 Firebase uid 그 자체였다(실측에서
    // 운영자의 옛 설치 id 가 운영자 uid 와 동일했다). 그건 다리 없이 직접 빠진다.
    const adminUid = includeAdmin ? null : getAdminExclusionUid();
    const adminInstallUnits: string[] = [];
    if (adminUid) {
      for (const row of mappingRows) {
        if (
          typeof row.accountUnit === "string" &&
          row.accountUnit === adminUid &&
          typeof row.installUnit === "string" &&
          row.installUnit !== ""
        ) {
          adminInstallUnits.push(row.installUnit);
        }
      }
      adminInstallUnits.push(adminUid);
    }

    const today = new Date().toISOString().slice(0, 10);
    const install = buildStreakRetention({
      axis: "install",
      today,
      rows: installRows as UnitDayActivityRow[],
      cohortWindowDays: rangeDays,
      adminUnits: Array.from(new Set(adminInstallUnits)),
      mappingRows,
      gridDays: STREAK_GRID_DAYS,
    });
    const account = buildStreakRetention({
      axis: "account",
      today,
      rows: accountRows as UnitDayActivityRow[],
      cohortWindowDays: rangeDays,
      adminUnits: adminUid ? [adminUid] : [],
      gridDays: STREAK_GRID_DAYS,
    });

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      historyDays,
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        // 익명 세계 자기제외는 은퇴했지만(U5OPOKf0D3I2TSRP8yUq), 이 지표는 가명화
        // 이전 과거 row 의 agentId 다리로 **부분적으로만** 되살린다. 몇 개를
        // 실제로 지웠는지 세어서 내보낸다 — 0 이면 설치 축은 운영자 도그푸드를
        // 포함한 숫자라는 뜻이다.
        clientIdCount: adminUid
          ? Math.max(0, new Set(adminInstallUnits).size - 1)
          : 0,
      },
      install,
      account,
      // ★사람 축 커버리지 봉투(설계 §10.3). 설치 축은 한 사람이 여러 대를 쓰면
      //   중복 계상되는데, 화면이 그 한계를 말하려면 커버리지를 알아야 한다.
      //   조회 창은 이 카드의 코호트 창과 같게 맞춘다.
      personAxis: await loadPersonAxisCoverage(rangeDays),
    };
  });

/**
 * getAdminActiveUserMetrics — DAU/WAU/MAU stickiness + 30일+ 잔존 추이.
 *
 * getAdminUsageSummary 의 activeByDay 의미를 account user 기준으로 재구성한다.
 * events.userId 는 쓰지 않고 metadata.accountUserId 와 cost_logs.userId 만 합산한다.
 *
 * ★계정축 은퇴(EVENTS_ACCOUNT_AXIS_RETIRED_ON) 이후 events 브랜치는 과거 구간만
 * 채운다 — 이후의 DAU/WAU/MAU 는 사실상 cost_logs 기준이다. 설치 단위 DAU 는
 * getAdminUsageSummary.activeByDay 쪽이 계속 온전하다.
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
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
      },
      ...buildActiveUserMetrics(
        activeRows as ActiveByDaySourceRow[],
        scalarRows[0],
        retentionRows as ThirtyDayRetentionSourceRow[]
      ),
    };
  });

/**
 * getAdminBetaSegmentUsage — 베타/파운더 grant 보유자 세그먼트 사용패턴
 * (🟡 BQ cost_logs / 🟢 Firestore subscriptions).
 *
 * TdlWmESR. 기존 어드민 분석은 "전체 계정" 모수를 보는데, 베타 운영에서 실제로
 * 궁금한 건 **grant 를 준 사람들이 실제로 쓰는가**다. 그래서 모수를 Firestore
 * grant 명단으로 고정하고 그 위에 관측률·재방문 리듬을 얹는다.
 *
 * 모수 정의:
 *   - subscriptions.founderGrant === true 인 계정 = 베타/파운더 grant 보유자.
 *     founderGrantReason 으로 파운더/베타선정/베타신청 세그먼트를 가른다
 *     (paymentProvider 로 판정하지 않는다 — founder_grant stomp 이슈).
 *   - 활동 identity = cost_logs.userId. events.userId 는 익명 설치 ID 라 계정
 *     귀속에 쓰지 않는다.
 *
 * ★프라이버시(§0-C, 메모리 telemetry_privacy_policy):
 *   - 응답에 uid·이메일 등 식별자는 어떤 필드로도 넣지 않는다. 세그먼트 단위
 *     집계만 내려간다.
 *   - 관측 계정이 MIN_COHORT_SIZE 미만인 세그먼트는 행동지표를 통째로 억제한다
 *     (betaSegments.buildBetaSegmentUsage). 소규모 베타에서 세그먼트를 쪼개면
 *     행동지표가 개인 지목으로 퇴화하기 때문.
 *   - 운영자 본인은 grant 보유자이기도 해서, includeAdmin=false(기본)면 명단
 *     단계에서 미리 빼고 BQ 에 넘긴다.
 *
 * ★events 계정축 은퇴(ticket woXp2c70oR0tliGB8Vs6): 이 콜러블은 원래
 * metadata.accountUserId 로 이벤트를 계정에 귀속시켜 기능사용·세션·기능채택을
 * 냈다. 그 필드는 서버가 붙이던 Firebase uid 였고, 처리방침이 events 를 익명이라
 * 고지하는 것과 어긋나 부착을 중단했다. grant 명단(uid)과 익명 설치 ID 를 잇는
 * 다리가 없어졌으므로 이벤트 3종 쿼리를 **아예 치지 않는다** — 빈 값을 0 으로
 * 꾸미지도, 설치 단위 수치를 계정 세그먼트인 척 붙이지도 않는다.
 * 응답의 eventAxisRetired=true 가 UI 에 그 사실을 그대로 전달한다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 제외)
 */
export const getAdminBetaSegmentUsage = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const includeAdmin = parseIncludeAdmin(data);
    const adminUid = getAdminExclusionUid();

    // ── 1) 모수: Firestore grant 명단 ────────────────────────────────────────
    // 항상 켜져 있는 소스라 텔레메트리 상태와 무관하게 정확하다.
    const grantSnap = await db
      .collection("subscriptions")
      .where("founderGrant", "==", true)
      .get();
    const grantHolders: GrantHolderRow[] = grantSnap.docs
      .map((doc) => {
        const d = doc.data() as {
          founderGrantReason?: unknown;
          status?: unknown;
        };
        return {
          uid: doc.id,
          founderGrantReason: d.founderGrantReason,
          status: d.status,
        };
      })
      // 운영자 자기계정 제외(기본). 명단 단계에서 빼면 BQ 절이 단순해지고
      // 응답 어디에도 uid 가 남지 않는다.
      .filter((h) => includeAdmin || !adminUid || h.uid !== adminUid);

    const grantUids = grantHolders.map((h) => h.uid);

    // grant 가 하나도 없으면 BQ 를 아예 치지 않는다(빈 ARRAY 파라미터 타입 이슈
    // 회피 — adminClientExclusion 과 동일 사유). 빈 결과도 구조는 유지된다.
    if (grantUids.length === 0) {
      return {
        rangeDays,
        generatedAt: new Date().toISOString(),
        adminExcluded: {
          applied: !includeAdmin,
          uidFiltered: adminUid != null,
          clientIdCount: 0,
        },
        queryStatus: { ok: true, errors: [] as string[] },
        ...buildBetaSegmentUsage({
          grantHolders,
          activityRows: [],
          eventRows: [],
          sessionRows: [],
        }),
      };
    }

    const costTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_COST_TABLE}\``;

    // ── 2) 계정별 활동일(cost_logs) — 관측률·재방문 리듬의 원천 ─────────────
    // 계정축 은퇴 전에는 여기에 events(metadata.accountUserId) 브랜치가 UNION 으로
    // 붙어 있었다. events 에 계정 식별자를 붙이지 않기로 하면서 그 브랜치는
    // 사라졌고, 남은 계정 단위 신호는 사용량 원장뿐이다.
    const activityQuery = `
      WITH activity AS (
        SELECT
          userId AS user_id,
          DATE(SAFE_CAST(timestamp AS TIMESTAMP)) AS active_date
        FROM ${costTable}
        WHERE SAFE_CAST(timestamp AS TIMESTAMP)
              >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
          AND userId IN UNNEST(@grantUids)
      )
      SELECT
        user_id AS userId,
        COUNT(DISTINCT active_date) AS activeDays,
        FORMAT_DATE('%F', MIN(active_date)) AS firstActiveDate,
        FORMAT_DATE('%F', MAX(active_date)) AS lastActiveDate,
        COUNT(*) AS events
      FROM activity
      WHERE active_date IS NOT NULL
      GROUP BY user_id
    `;

    // ── 3) 은퇴한 축 ────────────────────────────────────────────────────────
    // 기능별 사용(계정 × 이벤트종류)·세션(session:ended)은 events 를 grant 계정에
    // 귀속시켜야 나오는 지표라, 계정축 은퇴와 함께 쿼리를 걷어냈다. 빈 배열을
    // 넘겨 구조는 유지하되 값을 지어내지 않는다.
    const params = { days: rangeDays, grantUids };
    const queryResults = await runAdminAnalyticsQueriesWithStatus([
      { name: "betaSegment.activity", query: activityQuery, params },
    ]);
    // 쿼리 하나가 죽어도 나머지 지표는 살린다(빈 배열로 폴백).
    const rowsAt = (i: number): BigQueryRows => queryResults[i]?.rows ?? [];
    const queryErrors = queryResults
      .filter((result) => result.error != null)
      .map((result) => ({
        name: result.name,
        error: result.error ?? "unknown query failure",
      }));

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: adminUid != null,
        clientIdCount: 0,
      },
      queryStatus: { ok: queryErrors.length === 0, errors: queryErrors },
      ...buildBetaSegmentUsage({
        grantHolders,
        activityRows: rowsAt(0) as SegmentActivityRow[],
        eventRows: [],
        sessionRows: [],
      }),
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
 * ★identity 는 익명 설치 ID(events.userId) 다. COALESCE 로 과거 row 의
 * metadata.accountUserId 를 먼저 보긴 하지만 계정축 은퇴
 * (EVENTS_ACCOUNT_AXIS_RETIRED_ON) 이후 row 에는 그 값이 없어 설치 ID 로 수렴한다
 * — uid 부착 중단으로 이 코크핏이 깨지지 않는다는 뜻이다. 개별 uid/clientId 는
 * 미노출하며, 운영자 제외는 includeAdmin(기본 false=제외) 토글을 따른다.
 *
 * params: { days?: number, includeAdmin?: boolean } (기본 30, 제외)
 */
/**
 * ★제로마찰 KPI 이벤트(티켓 pWSnJeQN) — 잔존 계산의 스캔에서 제외한다.
 *
 * 코크핏의 잔존 쿼리는 (프로젝트×날짜) 조합 수로 "2번째 세션" 을 근사하므로,
 * 스캔에 들어오는 이벤트 **종류**가 늘면 잔존율이 저절로 올라간다(#895 가 퍼널
 * 쪽에서 닫은 것과 같은 함정). 계측을 추가했다는 이유로 베타종료 게이지가
 * 좋아지는 건 착시다.
 *
 * ★여기 담는 건 **이 티켓에서 새로 생긴 이벤트뿐**이다. 기존 이벤트까지 빼면
 * d_retained_7d 값이 소급해서 움직이는데, 그건 이 티켓이 요구한 변화가 아니다
 * (게이지를 조용히 옮기지 않는다).
 */
const KPI_RETENTION_EXCLUDED_EVENTS: readonly string[] = [
  "onboarding:multi_agent_active",
  "onboarding:multi_agent_success",
  "onboarding:first_multi_agent_success",
  "billing:subscription_active",
  // 앵커 이벤트도 같은 규율(티켓 Tw6m14gR) — 계측을 늘렸다는 이유로 잔존
  // 게이지가 좋아져서는 안 된다.
  "onboarding:model_connected",
];

export const getAdminKpiCockpit = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const since = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)";
    const week = "TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)";
    const includeAdmin = parseIncludeAdmin(data);
    const ex = includeAdmin ? EMPTY_EXCLUSION : adminEventExclusion();
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

    // ── (2) 잔존 D1/D7/D30: 가입자 중 N일내 2파생세션/2프로젝트 도달 identity ──
    //
    // ★D7 값은 이 재작성 전후로 **한 자리도 바뀌지 않는다**: 창을 30일로 넓힌 건
    // 바깥 필터뿐이고, 7일 칸은 내부 조건부 집계가 그대로 7일로 자른다. 세 칸이
    // 창 길이만 다른 같은 정의라야 D1<D7<D30 의 단조성이 지표의 사실이 된다.
    //
    // ★새 이벤트 제외: 이 CTE 는 (프로젝트×날짜) 조합 수로 '2번째 세션' 을
    // 근사하므로, 스캔에 들어오는 이벤트 종류가 늘면 잔존이 저절로 올라간다.
    // 퍼널에 칸을 추가했다는 이유로 잔존이 좋아지는 건 착시라 명시적으로 뺀다
    // (#895 FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION 과 같은 규율). 과거 값은
    // 이 이벤트들이 존재하지 않았으므로 영향받지 않는다.
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
          AND userId IS NOT NULL
          AND event NOT IN (${KPI_RETENTION_EXCLUDED_EVENTS.map(
            (e) => `'${e}'`
          ).join(", ")})${ex.clause}
      ),
      signup AS (
        SELECT identity, MIN(ts) AS signup_ts
        FROM win
        WHERE event = 'auth:login_success'
        GROUP BY identity
      ),
      per_identity AS (
        SELECT
          w.identity,
          ${[1, 7, 30]
            .map(
              (d) => `COUNT(DISTINCT IF(
            w.ts <= TIMESTAMP_ADD(s.signup_ts, INTERVAL ${d} DAY),
            CONCAT(
              COALESCE(w.projectId, '(none)'),
              ':',
              FORMAT_DATE('%F', w.activity_date)
            ),
            NULL
          )) AS sessionish_${d}d,
          COUNT(DISTINCT IF(
            w.ts <= TIMESTAMP_ADD(s.signup_ts, INTERVAL ${d} DAY),
            w.projectId,
            NULL
          )) AS projects_${d}d`
            )
            .join(",\n          ")}
        FROM win w
        JOIN signup s ON s.identity = w.identity
        WHERE w.ts BETWEEN s.signup_ts
          AND TIMESTAMP_ADD(s.signup_ts, INTERVAL 30 DAY)
        GROUP BY w.identity
      )
      SELECT
        ${[1, 7, 30]
          .map(
            (d) =>
              `COUNTIF(sessionish_${d}d >= 2 OR projects_${d}d >= 2) AS d_retained_${d}d`
          )
          .join(",\n        ")}
      FROM per_identity
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

    // ── (10) ★온보딩 스톨 — 구독/크레딧/인증 공백 (티켓 9dXgBdkGn1LyJokShh1g) ──
    //
    // 온램프 스파이크 #883/#885 의 공통 결론이 "무료→유료 투자 전에 **최초에
    // 멈추는 유저 수**부터 세야 하는데 그 이벤트가 BQ 에 0건" 이었다. 이제 5개
    // 이벤트가 들어오므로 여기서 규모를 뽑는다. 판정 로직은 전부 순수 빌더
    // (adminAnalytics.buildOnboardingStallSummary)에 있다.
    //
    // ★needs_auth 는 철회될 수 있어(readiness 도달 = 로그인화면 오탐) agentId
    // 단위로 철회분을 따로 센다 — 오탐을 스톨로 세면 문제 크기가 부풀려진다.
    // ★funding 은 정상(ok) 판정도 세야 "인증까지 온 설치 중 몇 %가 못 도는가" 의
    // 분모가 생긴다.
    const stallVerdict = "JSON_VALUE(metadata, '$.verdict')";
    const stallQuery = `
      SELECT
        COUNT(DISTINCT IF(event = 'onboarding:spawn_blocked', userId, NULL))
          AS spawn_blocked_clients,
        COUNTIF(event = 'onboarding:spawn_blocked') AS spawn_blocked_events,
        COUNT(DISTINCT IF(event = 'onboarding:agent_needs_auth', userId, NULL))
          AS needs_auth_clients,
        COUNT(DISTINCT IF(
          event = 'onboarding:agent_needs_auth', agentId, NULL))
          AS needs_auth_agents,
        COUNT(DISTINCT IF(
          event = 'onboarding:agent_auth_resolved', agentId, NULL))
          AS needs_auth_resolved_agents,
        COUNT(DISTINCT IF(
          event = 'onboarding:funding_probe' AND ${stallVerdict} = 'ok',
          userId, NULL)) AS funding_ok_clients,
        COUNT(DISTINCT IF(
          event = 'onboarding:funding_probe' AND ${stallVerdict} = 'unfunded',
          userId, NULL)) AS funding_unfunded_clients,
        COUNT(DISTINCT IF(
          event = 'onboarding:funding_probe' AND ${stallVerdict} = 'blocked',
          userId, NULL)) AS funding_blocked_clients,
        COUNT(DISTINCT IF(
          event = 'onboarding:funding_probe'
            AND ${stallVerdict} = 'inconclusive',
          userId, NULL)) AS funding_inconclusive_clients,
        COUNT(DISTINCT IF(
          event = 'onboarding:funding_guide_shown', userId, NULL))
          AS guide_shown_clients,
        COUNTIF(event = 'onboarding:funding_guide_shown')
          AS guide_shown_events,
        -- 어느 신호든 하나라도 맞은 고유 설치. funding_probe 는 실제로 막힌
        -- 판정(unfunded/blocked)만 스톨로 센다 — ok/inconclusive 는 아니다.
        COUNT(DISTINCT IF(
          event IN ('onboarding:spawn_blocked', 'onboarding:agent_needs_auth',
                    'onboarding:funding_guide_shown')
            OR (event = 'onboarding:funding_probe'
                AND ${stallVerdict} IN ('unfunded', 'blocked')),
          userId, NULL)) AS stalled_clients
      FROM ${eventsTable}
      WHERE ${eventTs} >= ${since}
        AND event IN ('onboarding:spawn_blocked',
                      'onboarding:agent_needs_auth',
                      'onboarding:agent_auth_resolved',
                      'onboarding:funding_probe',
                      'onboarding:funding_guide_shown')${ex.clause}
    `;
    // 차단 사유 분해(errorCategory: not-installed / not-authenticated /
    // vendor-not-configured). "어디를 고쳐야 하나" 는 이 분포가 답한다.
    const stallReasonQuery = `
      SELECT
        COALESCE(NULLIF(errorCategory, ''), '(none)') AS key,
        COUNT(*) AS count
      FROM ${eventsTable}
      WHERE event = 'onboarding:spawn_blocked'
        AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY key
      ORDER BY count DESC
    `;

    // ★차단 사유 **정규 어휘** 분해 (티켓 iyxb4KsJpgPgoKYUBPsu).
    //
    // 위 errorCategory 분해와 같은 이벤트를 읽지만 축이 다르다: errorCategory 는
    // 차단을 내린 코드의 원어휘(게이트/플랜캡마다 다르다)고, `metadata.reason` 은
    // 제품 질문의 축(no_subscription / needs_auth / no_cli / quota_exhausted /
    // other)이다. 온보딩 96% 이탈(cli_setup 531 → multi_agent_success 21)의 원인이
    // 구독 공백인지 인증인지 CLI 부재인지는 **이 분포**가 답한다.
    //
    // ★건수와 **고유 설치 수**를 함께 뽑는다. 한 사람이 열 번 눌러 열 건이 쌓인
    // 것과 열 명이 한 번씩 막힌 것은 완전히 다른 문제인데, 건수만 보면 구분되지
    // 않는다(무료티어 GO 판단의 입력값은 후자다).
    //
    // ★#930 교훈: `ex.clause`(운영자 제외절)는 events 전용
    // (JSON_VALUE(metadata,'$.accountUserId'))이고 이 쿼리도 events 를 읽으므로
    // 그대로 붙인다 — events 아닌 테이블(task_outcomes 등)에 옮겨 붙이지 말 것.
    const stallBlockReasonQuery = `
      SELECT
        COALESCE(NULLIF(JSON_VALUE(metadata, '$.reason'), ''), '(none)') AS key,
        COUNT(*) AS count,
        COUNT(DISTINCT userId) AS clients
      FROM ${eventsTable}
      WHERE event = 'onboarding:spawn_blocked'
        AND ${eventTs} >= ${since}${ex.clause}
      GROUP BY key
      ORDER BY count DESC
    `;

    // ── (11) ★제로마찰 KPI — 10분 첫 multi-agent 성공 · 동시2+ · 무료→유료 ──
    //
    // 티켓 pWSnJeQN. 사장님 최중요 KPI 를 이루는 조각들인데, 그중 **멀티에이전트
    // 동시실행은 BigQuery 에 한 건도 없었다**(grep 0). 이제 메인 프로세스가
    // 발생 시점에 직접 관측해 보내므로 여기서 규모를 뽑는다.
    //
    // ★시계 시작점 = **모델 연결 완료**(티켓 Tw6m14gR, 사장님 결정). 무료 데모는
    // 룰베이스라 진짜 multi-agent 실행이 모델 연결 이후에만 가능하므로, first_run
    // 부터 재면 **연결조차 안 한 사람이 영원히 '10분 실패'로 잡힌다**. 그래서
    // 분모를 '연결 완료 설치'로 좁히고, 앞단(최초 실행→연결)은 같은 쿼리에서
    // 따로 센다 — 두 이탈을 한 수치에 섞지 않는다.
    // ★소요시간은 클라가 계산해 싣는다(서버 timestamp 는 수신시각이고 로그인
    // 이전 이벤트는 나중에 한꺼번에 flush 된다). 목표창 판정도 같은 이유로 클라가
    // 실은 값을 읽기만 한다 — 여기서 다시 계산하면 두 수가 갈린다.
    const withinWindow = "JSON_VALUE(metadata, '$.withinTargetWindow')";
    const withinWindowFromConnect =
      "JSON_VALUE(metadata, '$.withinTargetWindowFromConnect')";
    const clockAvailable = "JSON_VALUE(metadata, '$.clockAvailable')";
    const msFromConnect =
      "SAFE_CAST(JSON_VALUE(metadata, '$.msFromModelConnect') AS INT64)";
    // 앵커 조건은 순수 모듈이 소유한다(클라의 앵커 지점과 짝을 이루는 계약).
    const connected = modelConnectedPredicateSql({
      event: "event",
      step: "JSON_VALUE(metadata, '$.step')",
      phase: "JSON_VALUE(metadata, '$.phase')",
      verdict: "JSON_VALUE(metadata, '$.verdict')",
    });
    const zeroFrictionQuery = `
      WITH raw AS (
        SELECT
          COALESCE(NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''), userId)
            AS identity,
          event,
          durationMs,
          metadata
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${since}
          AND userId IS NOT NULL
          AND event IN ('app:first_run',
                        'onboarding:multi_agent_active',
                        'onboarding:multi_agent_success',
                        'onboarding:first_multi_agent_success',
                        'billing:subscription_active',
                        ${MODEL_CONNECT_ANCHOR_EVENTS.map((e) => `'${e}'`).join(
                          ",\n                        "
                        )})${ex.clause}
      )
      SELECT
        COUNT(DISTINCT IF(event = 'app:first_run', identity, NULL))
          AS d_first_run_base,
        -- ★핵심 KPI 의 분모. 정본 앵커 이벤트 + 하위호환 두 신호의 합집합이라
        -- 이 빌드 이전에 이미 연결을 끝낸 설치도 분모에 들어온다.
        COUNT(DISTINCT IF(${connected}, identity, NULL)) AS d_model_connected,
        COUNT(DISTINCT IF(
          event = 'onboarding:multi_agent_active', identity, NULL))
          AS d_multi_active,
        COUNTIF(event = 'onboarding:multi_agent_active') AS n_multi_active,
        COUNT(DISTINCT IF(
          event = 'onboarding:multi_agent_success', identity, NULL))
          AS d_multi_success,
        COUNTIF(event = 'onboarding:multi_agent_success') AS n_multi_success,
        COUNT(DISTINCT IF(
          event = 'onboarding:first_multi_agent_success', identity, NULL))
          AS d_first_success,
        -- ★헤드라인 분자: **연결 후** 목표창 안에 도달.
        COUNT(DISTINCT IF(
          event = 'onboarding:first_multi_agent_success'
            AND ${withinWindowFromConnect} = 'true',
          identity, NULL)) AS d_first_success_within_connect,
        -- 연결 시계를 못 구한 설치(연결 스탬프 이전부터 쓰던 설치). 소요시간을
        -- 지어내지 않았다는 사실 자체를 수치로 보여 준다.
        -- ★판정 근거는 connectClockAvailable 플래그가 아니라 **값의 존재**다:
        -- 그 플래그는 이번 빌드부터 실리므로, 플래그로 세면 연결 시계가 실제로
        -- 있었던 #902 빌드 행까지 '시계 없음' 으로 잘못 잡힌다.
        COUNT(DISTINCT IF(
          event = 'onboarding:first_multi_agent_success'
            AND ${msFromConnect} IS NULL,
          identity, NULL)) AS d_first_success_no_connect_clock,
        APPROX_QUANTILES(
          IF(event = 'onboarding:first_multi_agent_success'
               AND ${msFromConnect} > 0,
             ${msFromConnect}, NULL), 100
        )[SAFE_OFFSET(50)] AS median_first_success_from_connect_ms,
        -- 참고(앵커 변경 전과 같은 축): first_run 기준 판정·시계.
        COUNT(DISTINCT IF(
          event = 'onboarding:first_multi_agent_success'
            AND ${withinWindow} = 'true',
          identity, NULL)) AS d_first_success_within,
        COUNT(DISTINCT IF(
          event = 'onboarding:first_multi_agent_success'
            AND ${clockAvailable} = 'false',
          identity, NULL)) AS d_first_success_no_clock,
        APPROX_QUANTILES(
          IF(event = 'onboarding:first_multi_agent_success' AND durationMs > 0,
             durationMs, NULL), 100
        )[SAFE_OFFSET(50)] AS median_first_success_ms,
        COUNT(DISTINCT IF(
          event = 'billing:subscription_active', identity, NULL)) AS d_paid
      FROM raw
    `;

    // ── (12) 주 2회+ 사용(최근 7일 창에서 서로 다른 활동일 2일 이상) ──
    // 분모는 그 창의 활동 설치다 — 다른 카드와 분모가 다르므로 화면에 병기한다.
    const weeklyTwicePlusQuery = `
      SELECT
        COUNT(*) AS weekly_active_clients,
        COUNTIF(active_days >= 2) AS weekly_twice_plus_clients
      FROM (
        SELECT
          COALESCE(NULLIF(JSON_VALUE(metadata, '$.accountUserId'), ''), userId)
            AS identity,
          COUNT(DISTINCT DATE(${eventTs})) AS active_days
        FROM ${eventsTable}
        WHERE ${eventTs} >= ${week}
          AND userId IS NOT NULL${ex.clause}
        GROUP BY identity
      )
    `;

    // 대부분 쿼리는 @days(윈도우)+제외절 파라미터를 참조한다. 단 weeklyQuery 는
    // 고정 7일 창(@days 미참조)이라, 미참조 파라미터를 넘기면 BQ 가 거부하므로
    // (위 getAdminModelSummary 의 uid/client 분리와 동일 사유) 제외절 파라미터만
    // 넘긴다.
    const daysParams = { days: rangeDays, ...ex.params };
    // ★WithStatus 로 받는다: 이 러너는 개별 쿼리 실패를 삼키고 빈 배열을 돌려주기
    // 때문에, 상태를 같이 내보내지 않으면 "쿼리가 죽어서 0" 과 "정말 0" 이 화면에서
    // 구분되지 않는다(어드민이 '데이터 변화 없음' 으로 오독하던 지점).
    const kpiQueryResults = await runAdminAnalyticsQueriesWithStatus([
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
      { name: "kpi.stall", query: stallQuery, params: daysParams },
      {
        name: "kpi.stallReason",
        query: stallReasonQuery,
        params: daysParams,
      },
      {
        name: "kpi.stallBlockReason",
        query: stallBlockReasonQuery,
        params: daysParams,
      },
      {
        name: "kpi.zeroFriction",
        query: zeroFrictionQuery,
        params: daysParams,
      },
      // 고정 7일 창이라 @days 를 참조하지 않는다 — weeklyQuery 와 같은 이유로
      // 제외절 파라미터만 넘긴다(미참조 파라미터는 BQ 가 거부한다).
      {
        name: "kpi.weeklyTwicePlus",
        query: weeklyTwicePlusQuery,
        params: ex.params,
      },
    ]);
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
      stallRows,
      stallReasonRows,
      stallBlockReasonRows,
      zeroFrictionRows,
      weeklyTwicePlusRows,
    ] = kpiQueryResults.map((r) => r.rows);
    const kpiQueryErrors = kpiQueryResults
      .filter((r) => r.error != null)
      .map((r) => ({
        name: r.name,
        error: r.error ?? "unknown query failure",
      }));

    const first = (rows: BigQueryRows): Record<string, unknown> =>
      rows[0] ?? {};
    const headRow = first(headRows);
    const retainedRow = first(retainedRows);
    const activityRow = first(activityRows);
    const demoConsentRow = first(demoConsentRows);
    const weeklyRow = first(weeklyRows);
    const secondSessionRow = first(secondSessionRows);
    const avgDauRow = first(avgDauRows);
    const stallRow = first(stallRows);
    const zeroFrictionRow = first(zeroFrictionRows);
    const weeklyTwicePlusRow = first(weeklyTwicePlusRows);

    // CLI 셋업 단계 요약 → 게이지의 CLI 인증/첫프로젝트 분자·분모 파생.
    const cliRows = (cliSetupRows as Array<Record<string, unknown>>).map(
      (r) => ({
        step: r.step,
        phase: r.phase,
        clients: r.clients,
        events: r.events,
      })
    ) as CliSetupStepRow[];
    const cliSummary = buildCliSetupSummary(cliRows);
    const connect = cliSummary.find((s) => s.step === "connect");
    const project = cliSummary.find((s) => s.step === "project");

    // 게이지 분자/분모 스칼라 묶음(순수 빌더가 d_<col> 로 읽는다).
    const gaugeRow: Record<string, unknown> = {
      d_signup_base: headRow.d_signup_base,
      d_activated_30m: headRow.d_activated_30m,
      d_task_completed: headRow.d_activated_30m,
      // 잔존 3종은 창 길이만 다른 같은 정의다(같은 쿼리에서 나온다).
      d_retained_1d: retainedRow.d_retained_1d,
      d_retained_7d: retainedRow.d_retained_7d,
      d_retained_30d: retainedRow.d_retained_30d,
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
        (r) => ({ key: r.key, count: r.count })
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
      stall: {
        spawnBlockedClients: stallRow.spawn_blocked_clients,
        spawnBlockedEvents: stallRow.spawn_blocked_events,
        spawnBlockedReasonRows: (
          stallReasonRows as Array<Record<string, unknown>>
        ).map((r) => ({ key: r.key, count: r.count })),
        // 정규 어휘 분해(티켓 iyxb4KsJpgPgoKYUBPsu) — 건수와 고유 설치 수를 함께.
        spawnBlockedBlockReasonRows: (
          stallBlockReasonRows as Array<Record<string, unknown>>
        ).map((r) => ({ key: r.key, count: r.count, clients: r.clients })),
        needsAuthClients: stallRow.needs_auth_clients,
        needsAuthAgents: stallRow.needs_auth_agents,
        needsAuthResolvedAgents: stallRow.needs_auth_resolved_agents,
        fundingOkClients: stallRow.funding_ok_clients,
        fundingUnfundedClients: stallRow.funding_unfunded_clients,
        fundingBlockedClients: stallRow.funding_blocked_clients,
        fundingInconclusiveClients: stallRow.funding_inconclusive_clients,
        guideShownClients: stallRow.guide_shown_clients,
        guideShownEvents: stallRow.guide_shown_events,
        stalledClients: stallRow.stalled_clients,
        // 스톨 비율의 분모는 게이지와 같은 로그인 성공 기반(같은 창·같은 제외절).
        signupBase: headRow.d_signup_base,
      },
      // ★제로마찰 KPI(티켓 pWSnJeQN · 앵커 수정 Tw6m14gR). 10분 판정의 분모는
      // **모델 연결 완료** 설치다 — 이유는 순수 빌더 buildZeroFrictionKpis 의
      // note 참조. 최초 실행 기준 값은 앞단 구간·참고치로 함께 넘긴다.
      zeroFriction: {
        firstRunBase: zeroFrictionRow.d_first_run_base,
        modelConnectedClients: zeroFrictionRow.d_model_connected,
        signupBase: headRow.d_signup_base,
        multiAgentActiveClients: zeroFrictionRow.d_multi_active,
        multiAgentActiveEvents: zeroFrictionRow.n_multi_active,
        multiAgentSuccessClients: zeroFrictionRow.d_multi_success,
        multiAgentSuccessEvents: zeroFrictionRow.n_multi_success,
        firstSuccessClients: zeroFrictionRow.d_first_success,
        firstSuccessWithinConnectClients:
          zeroFrictionRow.d_first_success_within_connect,
        firstSuccessNoConnectClockClients:
          zeroFrictionRow.d_first_success_no_connect_clock,
        firstSuccessMedianFromConnectMs:
          zeroFrictionRow.median_first_success_from_connect_ms,
        firstSuccessWithinFirstRunClients:
          zeroFrictionRow.d_first_success_within,
        firstSuccessNoClockClients: zeroFrictionRow.d_first_success_no_clock,
        firstSuccessMedianMs: zeroFrictionRow.median_first_success_ms,
        weeklyActiveClients: weeklyTwicePlusRow.weekly_active_clients,
        weeklyTwicePlusClients: weeklyTwicePlusRow.weekly_twice_plus_clients,
        paidClients: zeroFrictionRow.d_paid,
      },
    });

    return {
      rangeDays,
      generatedAt: new Date().toISOString(),
      adminExcluded: {
        applied: !includeAdmin,
        uidFiltered: getAdminExclusionUid() != null,
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
      },
      queryStatus: {
        ok: kpiQueryErrors.length === 0,
        errors: kpiQueryErrors,
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
    // 익명 세계 제외는 은퇴했다(위 adminEventExclusion 블록 주석) — 남는 절은 없다.
    const clientEx = EMPTY_EXCLUSION;
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
      FROM (SELECT * FROM ${outcomesTable}
            WHERE ${completedAtTs} >= ${sinceTs}${clientEx.clause}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY ${completedAtTs} DESC) = 1)
      WHERE success IS NOT NULL
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
      FROM (SELECT * FROM ${outcomesTable}
            WHERE ${completedAtTs} >= ${sinceTs}${clientEx.clause}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY ${completedAtTs} DESC) = 1)
      WHERE success IS NOT NULL
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

    // (3-c) ★하위모델 분해는 은퇴했다 — 여기 있던 harnessBridge/harnessAgents
    // 쿼리는 events.agentId 와 cost_logs.agentId 를 조인해 "하네스 claude 밑에서
    // 실제로 무엇이 돌았나"를 봤다. cost_logs 는 계정 uid 원장이라 그 조인이 곧
    // 익명 텔레메트리를 계정으로 되짚는 경로였고, 조인키를 가명화하면서
    // (analyticsPseudonym.ts) 성립하지 않게 됐다. 사유는 응답 note 로 밝힌다
    // (adminAnalytics.MODEL_BREAKDOWN_RETIRED, ticket U5OPOKf0D3I2TSRP8yUq).

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

    const [
      [costByModelRows],
      [costByDayRows],
      [costByDayModelRows],
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
      })
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
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
      },
      costByModel,
      costByDay: (costByDayRows as Array<Record<string, unknown>>).map((r) => ({
        date: String(r.date ?? ""),
        cost: toNumber(r.cost as number | string | undefined),
      })),
      // 일별 × 모델(기간별 분해) — 상위 6종 + '그 외'로 접되 총합은 보존한다.
      costByDayModel: buildCostByDayModel(
        costByDayModelRows as CostByDayModelSourceRow[],
        6
      ),
      // ★하위모델 분해(하네스 → 구체 모델)는 은퇴 — 사유는 note 에 담겨 있다.
      modelBreakdown: MODEL_BREAKDOWN_RETIRED,
      modelRoleStats,
      outcomeByModel,
      routing: {
        bySelectedModel: foldDistribution(
          routingSelectedRows as Array<Record<string, unknown>>,
          "key"
        ),
        byDecisionReason: foldDistribution(
          routingReasonRows as Array<Record<string, unknown>>,
          "key"
        ),
        byReuseVsSpawn: foldDistribution(
          routingReuseRows as Array<Record<string, unknown>>,
          "key"
        ),
        byModelSelectionMode: foldDistribution(
          routingModeRows as Array<Record<string, unknown>>,
          "key"
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
  }
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
    // 익명 세계 제외는 은퇴했다(위 adminEventExclusion 블록 주석) — 남는 절은 없다.
    // includeAdmin 토글은 응답의 adminExcluded.applied 로만 남는다.
    const ex = EMPTY_EXCLUSION;
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
        // 익명 세계 자기제외 은퇴(U5OPOKf0D3I2TSRP8yUq) — 항상 0.
        clientIdCount: 0,
      },
      ...buildReleaseHealth(
        versionRows as ReleaseVersionSourceRow[],
        adoptionRows as ReleaseAdoptionSourceRow[]
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

type DrilldownScope = typeof DRILLDOWN_SCOPES[number];

function parseDrilldownScope(data: unknown): DrilldownScope {
  const raw = (data as { scope?: unknown } | null | undefined)?.scope;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!(DRILLDOWN_SCOPES as readonly string[]).includes(s)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `scope must be one of: ${DRILLDOWN_SCOPES.join(", ")}`
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
    // 익명 세계 제외는 은퇴했다(위 adminEventExclusion 블록 주석) — 남는 절은 없다.
    const clientEx = EMPTY_EXCLUSION;

    // 스코프마다 참조하는 파라미터가 달라서(@date vs @days vs @key vs 제외절)
    // 후보를 모아두고 쿼리 본문이 실제로 참조하는 것만 넘긴다 — 미참조
    // 파라미터를 섞어 보내지 않기 위함.
    const runQuery = async (
      query: string,
      extra: Record<string, unknown>
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
            dayEndMs - 1
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
        FROM (SELECT * FROM ${outcomesTable}
              WHERE role = @key AND completedAt >= ${sinceTs}${clientEx.clause}
              QUALIFY ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY completedAt DESC) = 1)
        WHERE success IS NOT NULL
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
                    o.avgDurationMs as number | string | undefined
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
      FROM (SELECT * FROM ${outcomesTable}
            WHERE model = @key AND completedAt >= ${sinceTs}${clientEx.clause}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY completedAt DESC) = 1)
      WHERE success IS NOT NULL
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
  }
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
  contactId: string
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
  input: MarketingContactUpsertInput
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
    admin.firestore.FieldValue.serverTimestamp()
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
      : existing?.founderStatus ?? null;
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
          err
        )
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
  email: string
): Promise<{ ok: boolean; reason: string }> {
  try {
    const snap = await marketingContactRef(contactIdForEmail(email)).get();
    const verdict = isEmailable(
      snap.exists ? (snap.data() as MarketingContactDoc) : null
    );
    return { ok: verdict.ok, reason: verdict.reason };
  } catch (err) {
    console.warn(
      "[marketing-contacts] 게이트 조회 실패 — 발송 차단:",
      maskEmailForLog(email),
      err
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
    MARKETING_UNSUB_SECRET
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
  delivery: { footerHtml: string; footerText: string }
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
        err
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
        change.after.data() as UserDocRaw
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
        "로그인이 필요합니다."
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
        "마케팅 동의 상태를 확인할 수 없습니다."
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
        "마케팅 동의 상태를 확인할 수 없습니다."
      );
    }

    try {
      return marketingConsentStatusResponse(
        snap.exists ? (snap.data() as Partial<MarketingContactDoc>) : null
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
        "마케팅 동의 상태 데이터 형식이 올바르지 않습니다."
      );
    }
  }
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
        err
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
        err
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
        "MARKETING_EMAIL_ENC_KEY(base64 32B)가 설정돼야 실적재 가능 — 이메일은 암호화 저장만 허용"
      );
    }
    if (!MARKETING_UNSUB_SECRET) {
      console.warn(
        "[marketing-backfill] MARKETING_UNSUB_SECRET 미설정 — unsubscribe tokenHash 없이 적재됨(시크릿 설정 후 재실행 권장)"
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
        ...chunk.map((u) => db.collection("users").doc(u.uid))
      );
      snaps.forEach((snap, idx) => {
        if (!snap.exists) return;
        const consent = backfillConsentGrantFromUserDoc(
          snap.data() as UserDocRaw
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
      `[marketing-backfill] done: unique=${stats.uniqueEmails} created=${stats.created} updated=${stats.updated} granted=${stats.consentGranted} pending=${stats.consentPending}`
    );
    return stats;
  }
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
              '<h1 style="font-size:20px">링크가 유효하지 않습니다</h1><p>수신거부 링크가 만료됐거나 잘못됐어요. team@marblo.app 으로 회신 주시면 수동으로 처리해 드립니다.</p><p style="color:#666">This unsubscribe link is invalid. Reply to team@marblo.app and we\'ll handle it manually.</p>'
            )
          );
        return;
      }

      if (req.method === "GET") {
        const action = `?c=${encodeURIComponent(
          contactId
        )}&t=${encodeURIComponent(token)}`;
        res
          .status(200)
          .send(
            UNSUB_PAGE(
              `<h1 style="font-size:20px">마케팅 이메일 수신거부</h1><p>버튼을 누르면 마블로의 마케팅 이메일을 더 이상 받지 않습니다. (서비스·결제 관련 필수 안내는 계속 발송될 수 있어요.)</p><form method="POST" action="${action}"><button type="submit" style="background:#111;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:15px;cursor:pointer">수신거부 / Unsubscribe</button></form>`
            )
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
            { merge: true }
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
                err
              )
            );
        }
      }
      // 컨택트가 없어도 성공 응답(열거 방지 + 멱등).
      res
        .status(200)
        .send(
          UNSUB_PAGE(
            '<h1 style="font-size:20px">수신거부가 완료됐습니다</h1><p>마케팅 이메일을 더 이상 보내지 않습니다. 언제든 team@marblo.app 으로 연락 주세요.</p><p style="color:#666">You\'ve been unsubscribed from Marblo marketing emails.</p>'
          )
        );
    } catch (err) {
      console.warn("[unsubscribe] 처리 실패:", err);
      res
        .status(500)
        .send(
          UNSUB_PAGE(
            '<h1 style="font-size:20px">일시적인 오류가 발생했습니다</h1><p>잠시 후 다시 시도하거나 team@marblo.app 으로 회신해 주세요.</p>'
          )
        );
    }
  }
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
    contactToBqRow(d.id, d.data() as Partial<MarketingContactDoc>, snapshotDate)
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
    `[marketing-bq-mirror] snapshot=${snapshotDate} rows=${rows.length}`
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
  }
);
// ════════════════════════════════════════════════════════════════════════════
// 파생 분석 테이블 스케줄 빌드 — analytics_user_daily / *_install_profile /
//                                *_account_profile
// ════════════════════════════════════════════════════════════════════════════
//
// ★★ 축이 둘인 이유와 그 근거는 analyticsProfiles.ts 파일 머리에 있다.
//    한 줄 요약: 배포된 개인정보처리방침이 "두 기록이 공유하는 조인 키는
//    없습니다"(v3/src/components/legal/privacyContent.tsx:95, EN :210) 라고
//    적었다. 그래서 익명축(install_key)과 계정축(user_key)은 **다른 테이블**이고
//    서로 조인하지 않는다. 합치지 마라.
//
// ★원본은 건드리지 않는다. 아래 쿼리는 전부 읽기 전용 SELECT 다 —
//  events / agent_heartbeats / task_outcomes / install_attribution / cost_logs.
//
// ★멱등: 계산은 순수 함수(analyticsProfiles.ts)가 하고, 적재는 load job 의
//  WRITE_TRUNCATE 로 **테이블을 통째로 교체**한다. 스트리밍 insert + DELETE
//  조합을 쓰지 않는 이유는 marketing 미러에서 이미 데인 자리이기 때문이다 —
//  직전 ~90분 내 스트리밍 버퍼가 있으면 DELETE 가 실패하고, 그때 insert 를
//  강행하면 중복 행이 쌓인다. load job 은 버퍼와 무관하고 원자적이다.

const ANALYTICS_PROFILE_WINDOW_DAYS = 90;

/** 한 번에 스캔할 daily 원시 행 상한. 넘으면 잘린 사실을 로그에 남긴다. */
const ANALYTICS_PROFILE_ROW_LIMIT = 500000;

type ProfileBuildResult = {
  today: string;
  windowDays: number;
  dailyRows: number;
  installProfiles: number;
  accountProfiles: number;
  /** 조용한 부분 실패를 막는다 — 비어서 건너뛴 테이블을 이름으로 남긴다. */
  skipped: string[];
  notes: string[];
};

/**
 * 테이블을 보장한다. **스키마를 BQ 에 만들기 전에 축 검사를 돌린다** —
 * 한 번 만들어진 컬럼은 BigQuery 에서 지울 수 없으므로, 잘못된 축의 컬럼은
 * 생성 전에 막는 것 말고는 되돌릴 방법이 없다.
 *
 * 이미 있으면 NULLABLE 컬럼만 덧붙인다(ensureAttributionTable 과 같은 규약).
 * 기존 컬럼의 삭제·타입변경은 하지 않는다.
 */
async function ensureAnalyticsProfileTable(
  tableName: string,
  schema: ReadonlyArray<BqField>,
  partitionField?: string
): Promise<void> {
  assertAxisPurity(tableName, schema);

  const dataset = bigquery.dataset(ANALYTICS_DATASET);
  const table = dataset.table(tableName);
  const [exists] = await table.exists();
  if (!exists) {
    await table.create({
      schema: schema as unknown as { name: string; type: string }[],
      ...(partitionField
        ? { timePartitioning: { type: "DAY", field: partitionField } }
        : {}),
    });
    functions.logger.info("[analyticsProfiles] created table", { tableName });
    return;
  }

  const [metadata] = await table.getMetadata();
  const live: { name: string }[] = metadata?.schema?.fields ?? [];
  const liveNames = new Set(live.map((f) => f.name));
  const missing = schema.filter(
    (f) => !liveNames.has(f.name) && f.mode === "NULLABLE"
  );
  if (missing.length > 0) {
    await table.setMetadata({ schema: { fields: [...live, ...missing] } });
    functions.logger.info("[analyticsProfiles] schema columns added", {
      tableName,
      added: missing.map((f) => f.name),
    });
  }
}

/**
 * 행 전체를 WRITE_TRUNCATE 로 교체한다(원자적·멱등).
 *
 * ★행이 0개면 **교체하지 않고 건너뛴다.** 소스 쿼리가 0행을 돌려주는 건
 * 십중팔구 장애(권한·리전·컬럼명)지 "정말 아무도 안 썼다" 가 아니다. 그때
 * 테이블을 비워 버리면 어제까지 있던 분석이 통째로 사라진다 — 조용한 소실보다
 * 오래된 데이터가 낫고, 건너뛴 사실은 호출측이 skipped 로 밝힌다.
 */
async function replaceAnalyticsProfileRows(
  tableName: string,
  schema: ReadonlyArray<BqField>,
  rows: ReadonlyArray<Record<string, unknown>>
): Promise<boolean> {
  if (rows.length === 0) {
    functions.logger.warn("[analyticsProfiles] 0 rows — 교체를 건너뛴다", {
      tableName,
    });
    return false;
  }
  const table = bigquery.dataset(ANALYTICS_DATASET).table(tableName);
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  await new Promise<void>((resolve, reject) => {
    const stream = table.createWriteStream({
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      schema: { fields: schema as unknown as { name: string; type: string }[] },
      writeDisposition: "WRITE_TRUNCATE",
      createDisposition: "CREATE_IF_NEEDED",
      location: BQ_LOCATION,
    });
    stream.on("error", reject);
    stream.on("complete", () => resolve());
    stream.end(Buffer.from(ndjson, "utf8"));
  });
  return true;
}

/** UTC 'YYYY-MM-DD'. 리텐션 판정 기준일 — 순수 함수에 주입한다. */
function analyticsTodayUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

// ── 익명축 소스 쿼리 ────────────────────────────────────────────────────────
//
// ★install_key = events/agent_heartbeats/task_outcomes 의 `userId` 다. 이 컬럼은
//   계정 uid 가 **아니라** 클라이언트가 보낸 익명 설치 ID(clientId)다
//   (logTelemetryBatch / logHeartbeat / logTaskOutcome 주석 참조).
//
// ★id_scheme 은 여기서 길이를 실어 보내지 않는다. 오늘은 install_key 가 원시
//   설치 id 라 길이로 판정되지만, 선행 티켓(analytics_identity)이 이걸 HMAC
//   가명으로 바꾸면 가명 길이는 원시 길이와 무관해진다. 그때 LENGTH(userId) 를
//   보내고 있으면 **틀린 스킴을 자신 있게 적게** 된다. 그래서 안 보낸다 —
//   가명이 되는 순간 classifyIdScheme 은 "unknown" 을 돌려주고, 그게 맞다.
//   (가명화 이후 스킴을 되살리려면 analytics_identity 가 스킴을 컬럼으로 준다.)

const ANALYTICS_DAILY_EVENTS_SQL = `
WITH e AS (
  SELECT
    userId AS install_key,
    DATE(TIMESTAMP(timestamp)) AS d,
    model, role, taskType, appVersion, errorCategory,
    COALESCE(tokensInput, 0) AS ti,
    COALESCE(tokensOutput, 0) AS tout
  FROM \`${ANALYTICS_DATASET}.${BQ_EVENTS_TABLE}\`
  WHERE TIMESTAMP(timestamp) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    AND userId IS NOT NULL AND userId != '' AND userId != 'anon'
),
base AS (
  SELECT install_key, d,
    COUNT(*) AS eventCount,
    SUM(ti) AS tokensInput,
    SUM(tout) AS tokensOutput,
    MAX(appVersion) AS appVersion,
    ARRAY_AGG(DISTINCT role IGNORE NULLS) AS roles,
    ARRAY_AGG(DISTINCT taskType IGNORE NULLS) AS taskTypes
  FROM e GROUP BY install_key, d
),
m AS (
  SELECT install_key, d, ARRAY_AGG(STRUCT(model, calls)) AS models FROM (
    SELECT install_key, d, model, COUNT(*) AS calls
    FROM e WHERE model IS NOT NULL AND model != '' GROUP BY install_key, d, model
  ) GROUP BY install_key, d
),
er AS (
  SELECT install_key, d, ARRAY_AGG(STRUCT(category, count)) AS errorCategories FROM (
    SELECT install_key, d, errorCategory AS category, COUNT(*) AS count
    FROM e WHERE errorCategory IS NOT NULL AND errorCategory != ''
    GROUP BY install_key, d, errorCategory
  ) GROUP BY install_key, d
)
SELECT
  base.install_key AS installKey,
  FORMAT_DATE('%Y-%m-%d', base.d) AS day,
  base.eventCount, base.tokensInput, base.tokensOutput, base.appVersion,
  base.roles, base.taskTypes,
  m.models, er.errorCategories
FROM base
LEFT JOIN m ON m.install_key = base.install_key AND m.d = base.d
LEFT JOIN er ON er.install_key = base.install_key AND er.d = base.d
LIMIT @rowLimit`;

// ★활동 판정의 핵심 소스. presenceBeats(전체)와 workingBeats(status='working')를
//   **따로** 세어 보낸다 — 순수 로직이 둘을 구분해야 좀비를 격리할 수 있다.
const ANALYTICS_DAILY_HEARTBEATS_SQL = `
SELECT
  userId AS installKey,
  FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP(timestamp))) AS day,
  COUNT(*) AS presenceBeats,
  COUNTIF(status = 'working') AS workingBeats
FROM \`${ANALYTICS_DATASET}.agent_heartbeats\`
WHERE TIMESTAMP(timestamp) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
  AND userId IS NOT NULL AND userId != '' AND userId != 'anon'
GROUP BY installKey, day
LIMIT @rowLimit`;

// 완료·실패는 task_outcomes 단일 소스다. events 의 'task:completed' 로 또 세면
// 같은 완료가 두 번 잡힌다 — 분모가 부풀면 success_rate 가 통째로 틀어진다.
// 토큰도 여기서 다시 더하지 않는다(events 가 이미 실었다).
const ANALYTICS_DAILY_OUTCOMES_SQL = `
SELECT
  userId AS installKey,
  FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP(completedAt))) AS day,
  COUNTIF(success IS TRUE) AS tasksCompleted,
  COUNTIF(success IS FALSE) AS tasksFailed
FROM (SELECT * FROM \`${ANALYTICS_DATASET}.task_outcomes\`
      WHERE TIMESTAMP(completedAt) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
        AND userId IS NOT NULL AND userId != '' AND userId != 'anon'
      QUALIFY ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY TIMESTAMP(completedAt) DESC) = 1)
WHERE success IS NOT NULL
GROUP BY installKey, day
LIMIT @rowLimit`;

// first-touch. install_attribution 은 설치당 1행이 원칙(linkInstallAttribution
// 이 Firestore create 로 선착 1건만 적재)이라 창을 두지 않고 전량 읽는다.
// ★first_visit_at(웹 첫 방문)은 GA4 export 에 있는데 리전이 달라 한 쿼리에서
//   조인되지 않는다(getAdminCountryFunnel 의 리전 블로커와 같은 제약). 지금은
//   null 로 두고 그 사실을 notes 에 밝힌다 — 0 으로 채우거나 linkedAt 을
//   first_visit 인 척 넣지 않는다.
//
// ★상수가 아니라 **비동기 함수**인 이유가 둘 있다.
//  1) BQ_ATTRIBUTION_TABLE 이 이 지점보다 아래에서 선언돼 모듈 로드 시점에는
//     아직 TDZ 다.
//  2) ★install_attribution 은 코드 스키마(INSTALL_ATTRIBUTION_SCHEMA)와 실제
//     BQ 스키마가 어긋나 있다. `buildChannel` 은 코드에만 있고 라이브 테이블에는
//     없다(2026-08-21 실측: installId·gaClientId·utmSource·utmMedium·
//     utmCampaign·referrerHost·landingPath·platform·appVersion·linkedAt·
//     linkSource 뿐). ensureAttributionTable 이 다음 어트리뷰션 적재 때 붙여
//     주긴 하지만, 그게 언제일지 모르는 채로 SELECT 하면 쿼리가 통째로 죽는다.
//     그렇다고 여기서 원본 테이블 스키마를 고칠 수는 없다(BQ 원본 수정 금지).
//     → 라이브 스키마를 읽어 **있는 컬럼만 고르고, 없는 컬럼은 NULL 로 채운다.**
//       컬럼이 나중에 생기면 자동으로 값이 붙는다(코드를 다시 고칠 필요 없다).
const FIRST_TOUCH_OPTIONAL_COLUMNS = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "referrerHost",
  "landingPath",
  "linkSource",
  "platform",
  "buildChannel",
] as const;

async function analyticsFirstTouchSql(): Promise<string> {
  let live = new Set<string>();
  try {
    const [meta] = await bigquery
      .dataset(ANALYTICS_DATASET)
      .table(BQ_ATTRIBUTION_TABLE)
      .getMetadata();
    live = new Set(
      ((meta?.schema?.fields ?? []) as { name: string }[]).map((f) => f.name)
    );
  } catch (err) {
    // 스키마를 못 읽으면 선택 컬럼을 전부 NULL 로 둔다 — 쿼리가 죽는 것보다
    // 낫고, 비어 있다는 사실은 그 컬럼이 null 이라는 걸로 드러난다.
    functions.logger.warn("[analyticsProfiles] attribution 스키마 조회 실패", {
      message: safeAnalyticsErrorMessage(err),
    });
  }
  const optional = FIRST_TOUCH_OPTIONAL_COLUMNS.map((c) =>
    live.size === 0 || live.has(c) ? c : `CAST(NULL AS STRING) AS ${c}`
  ).join(",\n  ");
  return `
SELECT
  installId AS installKey,
  gaClientId AS gaKey,
  ${optional},
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', linkedAt) AS linkedAt
FROM \`${ANALYTICS_DATASET}.${BQ_ATTRIBUTION_TABLE}\`
WHERE installId IS NOT NULL AND installId != ''`;
}

// 이정표. 이벤트 이름은 ACTIVATION_GATE_STEPS 규약을 그대로 쓴다 — 여기서
// 새 이름을 만들면 퍼널 화면과 프로필이 다른 사람을 세게 된다.
const ANALYTICS_MILESTONES_SQL = `
SELECT
  userId AS installKey,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', MIN(IF(event = 'app:first_run', TIMESTAMP(timestamp), NULL))) AS firstRunAt,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', MIN(IF(event = 'agent:spawned', TIMESTAMP(timestamp), NULL))) AS firstSpawnAt,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', MIN(IF(event = 'task:completed', TIMESTAMP(timestamp), NULL))) AS firstCompletedAt
FROM \`${ANALYTICS_DATASET}.${BQ_EVENTS_TABLE}\`
WHERE userId IS NOT NULL AND userId != '' AND userId != 'anon'
GROUP BY installKey`;

// ── 계정축 소스 쿼리 ────────────────────────────────────────────────────────
// ★cost_logs 만 본다. 익명 테이블은 이 쿼리에 등장하지 않는다 — 등장하는 순간
//   두 축을 잇는 다리가 된다.
const ANALYTICS_ACCOUNT_COSTS_SQL = `
SELECT
  userId AS userKey,
  FORMAT_DATE('%Y-%m-%d', DATE(TIMESTAMP(timestamp))) AS day,
  model,
  COUNT(*) AS calls,
  SUM(COALESCE(inputTokens, 0)) AS inputTokens,
  SUM(COALESCE(outputTokens, 0)) AS outputTokens,
  SUM(COALESCE(cacheReadTokens, 0)) AS cacheReadTokens,
  SUM(COALESCE(cacheWriteTokens, 0)) AS cacheWriteTokens,
  SUM(COALESCE(totalCost, 0)) AS totalCost
FROM \`${ANALYTICS_DATASET}.${BQ_COST_TABLE}\`
WHERE userId IS NOT NULL AND userId != ''
GROUP BY userKey, day, model
LIMIT @rowLimit`;

async function runAnalyticsQuery(
  label: string,
  query: string,
  params: Record<string, unknown>,
  notes: string[]
): Promise<Record<string, unknown>[]> {
  try {
    const [rows] = await bigquery.query({
      query,
      params,
      location: BQ_LOCATION,
    });
    return rows as Record<string, unknown>[];
  } catch (err) {
    // 한 소스가 죽어도 나머지는 만든다. 다만 **조용히** 비우지 않는다 —
    // 실패한 소스를 notes 에 남겨 화면이 "그날 아무도 안 썼다" 로 오독하지
    // 않게 한다.
    functions.logger.error("[analyticsProfiles] query failed", {
      label,
      message: safeAnalyticsErrorMessage(err),
    });
    notes.push(`★소스 '${label}' 조회 실패 — 이 소스가 빠진 결과다.`);
    return [];
  }
}

/**
 * 계정축 결제 정보. `first_paid_at` 은 billingCharges 의 성공 청구 중 가장
 * 이른 것이다 — comped(무료 grant)는 결제가 아니므로 세지 않는다.
 *
 * ★mrr_usd / ltv_usd 는 여기서 채우지 않는다. 구매 티켓(analytics_purchase)이
 *   그 두 값의 주인이고, 여기서 임의로 추정치를 넣으면 나중에 두 개의 서로 다른
 *   MRR 이 생긴다. 값이 없으면 0 이 아니라 null 로 둔다.
 */
async function loadAccountBillingRows(
  notes: string[]
): Promise<AccountBillingRow[]> {
  const byUser = new Map<string, AccountBillingRow>();
  try {
    const subs = await db.collection("subscriptions").get();
    for (const doc of subs.docs) {
      const d = doc.data() as Record<string, unknown>;
      const plan = typeof d.planType === "string" ? d.planType : null;
      byUser.set(doc.id, { userKey: doc.id, plan, firstPaidAt: null });
    }
  } catch (err) {
    functions.logger.warn("[analyticsProfiles] subscriptions 조회 실패", {
      message: safeAnalyticsErrorMessage(err),
    });
    notes.push("★subscriptions 조회 실패 — plan 이 빠진 결과다.");
  }
  try {
    const charges = await db
      .collection("billingCharges")
      .where("status", "==", "succeeded")
      .get();
    for (const doc of charges.docs) {
      const d = doc.data() as Record<string, unknown>;
      const userId = typeof d.userId === "string" ? d.userId : "";
      if (userId === "") continue;
      const ms = tsToMillis(d.createdAt);
      if (ms == null) continue;
      const iso = new Date(ms).toISOString();
      const cur = byUser.get(userId) ?? { userKey: userId, plan: null };
      const prev = typeof cur.firstPaidAt === "string" ? cur.firstPaidAt : null;
      cur.firstPaidAt = prev == null || iso < prev ? iso : prev;
      byUser.set(userId, cur);
    }
  } catch (err) {
    functions.logger.warn("[analyticsProfiles] billingCharges 조회 실패", {
      message: safeAnalyticsErrorMessage(err),
    });
    notes.push("★billingCharges 조회 실패 — first_paid_at 이 빠진 결과다.");
  }
  return Array.from(byUser.values());
}

export async function buildAnalyticsProfileTablesInternal(
  windowDays = ANALYTICS_PROFILE_WINDOW_DAYS
): Promise<ProfileBuildResult> {
  const nowMs = Date.now();
  const today = analyticsTodayUtc(nowMs);
  const builtAt = new Date(nowMs).toISOString();
  const notes: string[] = [];
  const skipped: string[] = [];
  const days = Math.max(1, Math.floor(windowDays));
  const qp = { days, rowLimit: ANALYTICS_PROFILE_ROW_LIMIT };

  // ── 익명축 ────────────────────────────────────────────────────────────────
  const [eventRows, beatRows, outcomeRows, firstTouchRows, milestoneRows] =
    await Promise.all([
      runAnalyticsQuery("events", ANALYTICS_DAILY_EVENTS_SQL, qp, notes),
      runAnalyticsQuery(
        "heartbeats",
        ANALYTICS_DAILY_HEARTBEATS_SQL,
        qp,
        notes
      ),
      runAnalyticsQuery(
        "task_outcomes",
        ANALYTICS_DAILY_OUTCOMES_SQL,
        qp,
        notes
      ),
      runAnalyticsQuery(
        "first_touch",
        await analyticsFirstTouchSql(),
        {},
        notes
      ),
      runAnalyticsQuery("milestones", ANALYTICS_MILESTONES_SQL, {}, notes),
    ]);

  const daily = buildUserDailyRows([
    ...(eventRows as DailySourceRow[]),
    ...(beatRows as DailySourceRow[]),
    ...(outcomeRows as DailySourceRow[]),
  ]);
  const installProfiles = buildInstallProfileRows({
    today,
    daily,
    firstTouch: firstTouchRows as InstallFirstTouchRow[],
    milestones: milestoneRows as InstallMilestoneRow[],
  });

  // ── 계정축 (익명축 행을 여기서 절대 참조하지 않는다) ────────────────────
  const costRows = await runAnalyticsQuery(
    "cost_logs",
    ANALYTICS_ACCOUNT_COSTS_SQL,
    { rowLimit: ANALYTICS_PROFILE_ROW_LIMIT },
    notes
  );
  const accountProfiles = buildAccountProfileRows({
    costs: costRows as AccountCostRow[],
    billing: await loadAccountBillingRows(notes),
    adminUid: process.env.ADMIN_UID?.trim() ?? null,
  });

  // ── 적재 ─────────────────────────────────────────────────────────────────
  await ensureAnalyticsProfileTable(TABLE_USER_DAILY, USER_DAILY_SCHEMA, "day");
  await ensureAnalyticsProfileTable(
    TABLE_INSTALL_PROFILE,
    INSTALL_PROFILE_SCHEMA
  );
  await ensureAnalyticsProfileTable(
    TABLE_ACCOUNT_PROFILE,
    ACCOUNT_PROFILE_SCHEMA
  );

  const stamp = <T extends object>(rows: T[]): Record<string, unknown>[] =>
    rows.map((r) => ({ ...r, built_at: builtAt }));

  const loaded = await Promise.all([
    replaceAnalyticsProfileRows(
      TABLE_USER_DAILY,
      USER_DAILY_SCHEMA,
      stamp(daily)
    ),
    replaceAnalyticsProfileRows(
      TABLE_INSTALL_PROFILE,
      INSTALL_PROFILE_SCHEMA,
      stamp(installProfiles)
    ),
    replaceAnalyticsProfileRows(
      TABLE_ACCOUNT_PROFILE,
      ACCOUNT_PROFILE_SCHEMA,
      stamp(accountProfiles)
    ),
  ]);
  const tableNames = [
    TABLE_USER_DAILY,
    TABLE_INSTALL_PROFILE,
    TABLE_ACCOUNT_PROFILE,
  ];
  loaded.forEach((ok, i) => {
    if (!ok) skipped.push(tableNames[i]);
  });

  notes.push(
    "★익명축(analytics_user_daily / analytics_install_profile)과 계정축" +
      "(analytics_account_profile)은 조인하지 않는다. 조인 키를 만들지도 마라 — " +
      "privacyContent.tsx:95(EN :210)."
  );
  notes.push(
    "first_visit_at(웹 첫 방문)은 GA4 export 리전이 달라 이 쿼리에서 채우지 " +
      "못한다. null 은 '방문이 없었다' 가 아니라 '이 파이프라인이 모른다' 다."
  );
  notes.push(
    "mrr_usd / ltv_usd 는 구매 티켓(analytics_purchase)이 채운다. null 이면 " +
      "0 이 아니라 미기입이다."
  );

  const result: ProfileBuildResult = {
    today,
    windowDays: days,
    dailyRows: daily.length,
    installProfiles: installProfiles.length,
    accountProfiles: accountProfiles.length,
    skipped,
    notes,
  };
  functions.logger.info("[analyticsProfiles] build done", result);
  return result;
}

// 매일 05:30 KST. 다른 BQ 잡(04:00~05:00)이 끝난 뒤에 돈다.
export const scheduledBuildAnalyticsProfiles = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .pubsub.schedule("30 5 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    try {
      await buildAnalyticsProfileTablesInternal();
    } catch (err) {
      functions.logger.error("[analyticsProfiles] scheduled build failed", {
        message: safeAnalyticsErrorMessage(err),
      });
    }
    return null;
  });

// 수동 트리거(어드민) — 스키마 변경 직후 재빌드 등. 멱등이라 몇 번 눌러도 된다.
export const buildAnalyticsProfileTables = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const raw = Number((data as { windowDays?: unknown })?.windowDays);
    const windowDays = Number.isFinite(raw) && raw > 0 ? raw : undefined;
    return buildAnalyticsProfileTablesInternal(windowDays);
  });

// ════════════════════════════════════════════════════════════════════════════
// 사람 축 커버리지 봉투 (설계 §10.3 / docs/analytics-admin-callables-api.md)
// ════════════════════════════════════════════════════════════════════════════
//
// ★별도 콜러블을 만들지 않는다. 프론트(#1090)는 이미 **기존 응답에 실려 오는
//   옵셔널 `personAxis` 필드**를 읽도록 머지돼 있고, 우선순위는
//   getAdminInstallRetentionSummary → getAdminStreakRetention →
//   getAdminRetentionCohorts 다(처음 있는 것을 쓴다). 같은 사실에 두 경로를
//   만들면 어느 쪽이 맞는지 화면이 스스로 못 말한다.
//
// ★없으면 상태가 아니라 **배선 전**이다 — 그때 화면은 기존 '적재 전' 규약으로
//   접힌다. 그래서 프론트·백엔드 머지 순서가 어느 쪽이든 화면이 안 깨진다.
//
// ★값은 computePersonAxisCoverage() 가 그대로 만든다. 프론트는 계산하지 않는다 —
//   여기서 모양을 한 글자라도 바꾸면 조용히 undefined 가 되고 화면은 영원히
//   "배선 전" 을 띄운다.
//
// ★게이트가 닫혀 있으면 BQ 를 **아예 조회하지 않는다.** 닫힘은 장애가 아니라
//   정상 상태이므로, 0 과 사유를 돌려주는 것으로 끝난다.
//
// ★forward-only 문장은 프론트 상수(PERSON_AXIS_FORWARD_ONLY_NOTE)가 그린다.
//   프론트는 `personAxis` 가 **있을 때만** 그 문장을 띄우므로, 이 봉투를 싣는
//   것이 곧 "배포 직후엔 거의 0이다" 를 화면에 띄우는 것이다. 서버가 같은
//   문장을 한 벌 더 보내면 두 번 찍힌다 — 그래서 안 보낸다.

function personAxisCount(
  row: Record<string, unknown> | undefined,
  key: string
): number {
  const v = row?.[key];
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 사람 축 커버리지 한 벌. **던지지 않는다.**
 *
 * ★조회에 실패하면 `null` 을 돌려준다. 0 으로 채우면 화면이 "사람이 없다" 로
 * 읽고, 던지면 리텐션 탭 전체가 죽는다. `null` 이면 프론트가 다음 콜러블의
 * 봉투로 넘어가고(우선순위 폴백), 셋 다 없으면 '배선 전' 으로 접힌다.
 *
 * @param rangeDays `activeInstalls`(= complete 판정의 분모)를 세는 창.
 *        ★그 카드가 보고 있는 기간과 같아야 한다. 창이 넓으면 분모가 커져
 *        complete 가 늦게 뜰 뿐이라 **안전한 쪽으로** 틀린다.
 */
async function loadPersonAxisCoverage(
  rangeDays: number,
  basis: PersonAxisBasis = "since_link"
): Promise<PersonAxisCoverage | null> {
  const gate = resolvePersonAxisGate();
  const empty = {
    basis,
    linkedInstalls: 0,
    totalInstalls: 0,
    linkedActiveInstalls: 0,
    activeInstalls: 0,
    excludedSharedInstalls: 0,
    lastLinkedAt: null,
  };
  if (!gate.open) {
    // ★'적재 전'(pending)이 아니라 'disabled' 다 — 소스가 없는 게 아니라 아직
    //   열면 안 되는 것이고, 같은 말로 그리면 "곧 채워집니다" 라는 거짓 기대가 된다.
    return computePersonAxisCoverage({ gate, ...empty });
  }
  try {
    const since = new Date(Date.now() - rangeDays * 86400000)
      .toISOString()
      .slice(0, 10);
    const [rows] = await bigquery.query({
      query: buildPersonAxisCoverageSql(PERSON_AXIS_PROJECT_ID),
      params: { since, effective_from: gate.effectiveFrom },
      location: BQ_LOCATION,
    });
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
    return computePersonAxisCoverage({
      gate,
      basis,
      linkedInstalls: personAxisCount(row, "linked_installs"),
      totalInstalls: personAxisCount(row, "total_installs"),
      linkedActiveInstalls: personAxisCount(row, "linked_active_installs"),
      activeInstalls: personAxisCount(row, "active_installs"),
      excludedSharedInstalls: personAxisCount(row, "excluded_shared_installs"),
      lastLinkedAt:
        typeof row.last_linked_at === "string" ? row.last_linked_at : null,
    });
  } catch (err) {
    // 조용히 0 으로 접지 않는다 — 사유를 남기고 봉투를 뺀다.
    functions.logger.error("[personAxis] 커버리지 조회 실패", {
      message: safeAnalyticsErrorMessage(err),
    });
    return null;
  }
}

/**
 * 익명축 리텐션 요약(분자·분모 보존). 화면이 각자 SQL 로 분모를 세면 정의가
 * 갈라지므로, 세는 곳을 한 군데로 모은다(summarizeInstallRetention).
 */
export const getAdminInstallRetentionSummary = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (_data, context) => {
    requireAdmin(context);
    const notes: string[] = [];
    const rows = await runAnalyticsQuery(
      "install_profile",
      `SELECT * FROM \`${ANALYTICS_DATASET}.${TABLE_INSTALL_PROFILE}\``,
      {},
      notes
    );
    const summary = summarizeInstallRetention(
      rows as unknown as InstallProfileRow[]
    );
    // ★이 축은 조회 창이 없다(프로필 전량). 커버리지의 분모만 파생표가 도는
    //   창(ANALYTICS_PROFILE_WINDOW_DAYS)으로 센다 — 이 표가 그 창의 산물이다.
    const personAxis = await loadPersonAxisCoverage(
      ANALYTICS_PROFILE_WINDOW_DAYS
    );
    return {
      ...summary,
      notes: [...summary.notes, ...notes],
      personAxis,
    };
  });

// ════════════════════════════════════════════════════════════════════════════
// ★어드민 콜러블 매니페스트 (ticket 4KqBDPkH)
// ════════════════════════════════════════════════════════════════════════════
//
// 왜 필요한가 — 어드민 화면이 **아직 구현되지 않은 콜러블**을 부르면, 화면은
// '연결 전'(회색, 상태) 이 아니라 **빨간 내부 오류**를 그린다. 실측한 이유:
//
//   $ curl -X OPTIONS https://us-central1-marblo-2253d.cloudfunctions.net/
//           getAdminUserDailySummary -H "Origin: https://marblo.app" ...
//     HTTP/2 404, content-type: text/html, **Access-Control-Allow-Origin 없음**
//
// 미배포 함수의 404 는 Google Frontend 가 내는 HTML 이라 CORS 헤더가 없다.
// 브라우저는 preflight 에서 응답을 통째로 차단하고 fetch 가 TypeError 로 끝난다.
// firebase-js-sdk 는 그걸 status 0 으로 보고 `functions/internal` 로 매핑한다 —
// 그래서 프론트의 `err.code === "functions/not-found"` 가드는 **브라우저에서는
// 절대 참이 될 수 없다.** 가드가 있는데 죽어 있었다.
//
// ★고치는 방향: 클라가 에러 코드로 추측하게 두지 않고, **서버가 자기가 무엇을
//   갖고 있는지 말한다.** 없는 함수를 부르는 대신, 매니페스트에 없으면 아예
//   부르지 않고 '연결 전' 으로 접는다. 에러 코드 문자열 매칭 같은 SDK 내부 구현에
//   기대지 않으므로 SDK 판올림에도 안 깨진다.
//
// ★목록은 하드코딩하지 않는다. CommonJS 로 컴파일되므로 이 모듈이 실제로
//   내보낸 심볼(module.exports)을 실행 시점에 읽으면 드리프트가 원천 봉쇄된다 —
//   "문서에는 있는데 구현이 없다"(= 지금 getAdminUserDailySummary 의 상태)가
//   화면에 그대로 드러난다.
export const getAdminCallableManifest = functions.https.onCall(
  async (_data, context) => {
    requireAdmin(context);
    const exported = module.exports as Record<string, unknown>;
    const callables = Object.keys(exported)
      .filter((name) => name.startsWith("getAdmin"))
      .sort();
    return {
      generatedAt: new Date().toISOString(),
      // 이 배포본이 실제로 갖고 있는 어드민 콜러블 이름들.
      callables,
    };
  }
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
  snap: FirebaseFirestore.QuerySnapshot
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
  run: () => Promise<FirebaseFirestore.QuerySnapshot>
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
      }`
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
      Math.max(20, Math.floor(Number(data?.timelineLimit) || 0) || 200)
    );

    // 1) 프로젝트 목록 — 셀렉터용. 정렬은 최신 갱신순.
    const projectsRes = await auditQuery("projects", () =>
      db
        .collection("projects")
        .orderBy("updatedAt", "desc")
        .limit(AUDIT_PROJECT_SCAN_LIMIT)
        .get()
    );
    // orderBy 가 인덱스/필드 부재로 실패하면 무정렬로 한 번 더 시도한다 —
    // 정렬 실패 때문에 프로젝트 목록 자체가 비면 화면이 통째로 못 뜬다.
    const projects = projectsRes.ok
      ? projectsRes.docs
      : (
          await auditQuery("projects(unordered)", () =>
            db.collection("projects").limit(AUDIT_PROJECT_SCAN_LIMIT).get()
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
            .get()
        ),
        auditQuery("agents", () =>
          db
            .collection("agents")
            .where("projectId", "==", projectId)
            .limit(AUDIT_AGENT_SCAN_LIMIT)
            .get()
        ),
        auditQuery("missions", () =>
          db
            .collection("missions")
            .where("projectId", "==", projectId)
            .limit(AUDIT_MISSION_SCAN_LIMIT)
            .get()
        ),
        auditQuery("audit_logs", () =>
          db
            .collection("audit_logs")
            .where("projectId", "==", projectId)
            .orderBy("createdAt", "desc")
            .limit(AUDIT_LEDGER_SCAN_LIMIT)
            .get()
        ),
        auditQuery("merge_history", () =>
          db
            .collection("merge_history")
            .where("projectId", "==", projectId)
            .limit(AUDIT_MERGE_SCAN_LIMIT)
            .get()
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
            .get()
        )
      )
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
        `일부 소스를 읽지 못했다: ${failed.join(
          ", "
        )}. 해당 칸은 비어 보일 수 있다(0 이 아니라 '모름').`
      );
    }
    if (taskIds.length > activityTaskIds.length) {
      result.notes.push(
        `활동 타임라인은 최근 갱신 티켓 ${activityTaskIds.length}건 기준이다(전체 ${taskIds.length}건).`
      );
    }
    if (tasksRes.docs.length >= AUDIT_TASK_SCAN_LIMIT) {
      result.notes.push(
        `티켓 스캔이 상한 ${AUDIT_TASK_SCAN_LIMIT}건에서 잘렸다 — 요약 수치는 이 표본 기준이다.`
      );
    }

    return result;
  }
);

// ════════════════════════════════════════════════════════════════════════════
// 팀 프로젝트 감사 (읽기 전용) — 팀 오버뷰 "감사" 탭
// ════════════════════════════════════════════════════════════════════════════
// 설계: docs/team-usage-overview-design-2026-08-21.md §3.2 · §5 · §7 · §12.
// 경계 판정·좁히기는 전부 teamAudit.ts(순수, node --test). 여기서는 **역할 확인과
// Firestore fetch** 만 한다.
//
// ★위의 `getAdminProjectAudit` 와 대상은 같지만 **축이 다르다.**
//   `getAdminProjectAudit` = 마블로 운영자(`ADMIN_UID`) 축 · 전 테넌트
//   `getTeamProjectAudit`  = 팀 오너/admin/member 축 · 한 프로젝트
//   ★`requireAdmin` 을 부르지 않는다. 두 축을 섞으면 "이 사람이 왜 이걸 보나" 를
//   두 번 다시 풀 수 없다.
//
// ★Admin SDK 는 보안 규칙을 우회한다. 그래서 이 핸들러는 `firestore.rules` 의
//   `isProjectOwner`/`isAdminOrOwner`/`isProjectMember` 와 **같은 판정을 서버가
//   다시** 한다. 룰이 막아주리라 기대하지 않는다.
//
// ★쓰기 경로가 없다. `audit_logs` 는 읽기 전용이다.

/** 팀 감사 스캔 상한. 감사는 최근 사건을 보는 화면이라 전량 스캔하지 않는다. */
const TEAM_AUDIT_EVENT_SCAN_LIMIT = 1000;
const TEAM_AUDIT_TASK_SCAN_LIMIT = 500;
const TEAM_AUDIT_AGENT_SCAN_LIMIT = 300;
const TEAM_AUDIT_LEDGER_CONTEXT_LIMIT = 500;
const TEAM_AUDIT_MISSION_SCAN_LIMIT = 200;
const TEAM_AUDIT_MERGE_SCAN_LIMIT = 200;
const TEAM_AUDIT_PROJECT_SCAN_LIMIT = 100;
/** 활동은 taskId 축이라 `in` 청크(30개 상한)로 읽는다. 30 × 2. */
const TEAM_AUDIT_ACTIVITY_TASK_CAP = 60;

/** 허용목록을 Firestore `in` 절로 쓸 배열. 9개 — `in` 상한(30) 안이다. */
const TEAM_AUDIT_EVENT_TOOL_LIST = [...PROJECT_EVENT_TOOLS];

function teamAuditString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * 팀 축 역할 판정. ★`firestore.rules` 와 같은 판정을 서버가 다시 한다.
 *
 * 순서가 의미 있다: owner → admin → member. `memberRoles` 문서가 없으면 룰의
 * `getMemberRole` 기본값과 같게 'member' 로 본다(단, `members` 배열에 있을 때만).
 */
async function resolveTeamProjectRole(
  uid: string,
  projectId: string
): Promise<{ role: TeamProjectRole; projectName: string | null }> {
  let projectDoc: FirebaseFirestore.DocumentSnapshot;
  try {
    projectDoc = await db.collection("projects").doc(projectId).get();
  } catch (err) {
    functions.logger.warn(
      `[getTeamProjectAudit] project 조회 실패(projectId=${projectId}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    // ★읽지 못했으면 "권한 있음" 으로 접지 않는다. 모르면 닫는다.
    return { role: "none", projectName: null };
  }
  if (!projectDoc.exists) return { role: "none", projectName: null };

  const data = (projectDoc.data() ?? {}) as Record<string, unknown>;
  const projectName = teamAuditString(data.name);
  if (teamAuditString(data.ownerId) === uid) {
    return { role: "owner", projectName };
  }

  const members = Array.isArray(data.members) ? data.members : [];
  const isMember = members.some((m) => m === uid);

  try {
    const roleDoc = await db
      .collection("memberRoles")
      .doc(`${projectId}_${uid}`)
      .get();
    if (roleDoc.exists) {
      const roleData = (roleDoc.data() ?? {}) as Record<string, unknown>;
      // ★docId ↔ 본문 결속 확인. 룰(firestore.rules:594)이 같은 규약을 강제하지만
      //   Admin SDK 는 룰을 안 타므로 여기서 다시 본다.
      const boundProject = teamAuditString(roleData.projectId);
      if (boundProject === null || boundProject === projectId) {
        if (teamAuditString(roleData.role) === "admin") {
          return { role: "admin", projectName };
        }
      }
    }
  } catch (err) {
    functions.logger.warn(
      `[getTeamProjectAudit] memberRoles 조회 실패(projectId=${projectId}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    // admin 승격만 못 한다 — 아래 member 판정은 그대로 간다(좁은 쪽으로 실패).
  }

  return { role: isMember ? "member" : "none", projectName };
}

/**
 * 호출자가 역할을 가진 프로젝트 목록(셀렉터용).
 *
 * ★클라가 준 id 를 권한 근거로 쓰지 않는다(설계 §5.3). 서버가 uid 로 만든 이
 * 집합이 스코프의 상한이고, 클라 입력은 이 집합과의 교집합으로만 쓰인다.
 */
async function resolveTeamProjectRefs(
  uid: string
): Promise<{ refs: TeamAuditProjectRef[]; truncated: boolean }> {
  const [ownedRes, memberRes] = await Promise.all([
    auditQuery("team:projects(owner)", () =>
      db
        .collection("projects")
        .where("ownerId", "==", uid)
        .limit(TEAM_AUDIT_PROJECT_SCAN_LIMIT)
        .get()
    ),
    auditQuery("team:projects(member)", () =>
      db
        .collection("projects")
        .where("members", "array-contains", uid)
        .limit(TEAM_AUDIT_PROJECT_SCAN_LIMIT)
        .get()
    )
  ]);

  // ★셀렉터의 role 은 **하한**이다. `memberRoles` 를 프로젝트마다 읽으면 한 호출에
  //   최대 100 read 가 더 붙으므로, 목록에서는 owner 만 정확히 가르고 나머지는
  //   'member' 로 둔다. **데이터를 가르는 역할은 이 목록이 아니라** 선택된 프로젝트
  //   하나에 대한 `resolveTeamProjectRole` 결과이고, 그건 항상 정확하다.
  const byId = new Map<string, TeamAuditProjectRef>();
  for (const doc of ownedRes.docs) {
    byId.set(doc.id, {
      id: doc.id,
      name: teamAuditString(doc.name),
      role: "owner",
    });
  }
  for (const doc of memberRes.docs) {
    // owner 로 이미 잡혔으면 격상 상태를 유지한다.
    if (byId.has(doc.id)) continue;
    byId.set(doc.id, {
      id: doc.id,
      name: teamAuditString(doc.name),
      role: "member",
    });
  }
  // ★상한에 닿았으면 잘린 것이다. Firestore 는 "몇 개가 더 있었나" 를 알려주지
  //   않으므로 개수를 지어내지 않고 **사실만** 돌려준다.
  const truncated =
    ownedRes.docs.length >= TEAM_AUDIT_PROJECT_SCAN_LIMIT ||
    memberRes.docs.length >= TEAM_AUDIT_PROJECT_SCAN_LIMIT;
  return { refs: [...byId.values()], truncated };
}

/**
 * 팀 전용 구성원 가명. `tm_` + HMAC(salt, "teamMember:" + uid).
 *
 * ★솔트가 없으면 **null** 이다 — 원시 uid 폴백은 조용히 약속을 깨는 길이다
 * (`analyticsPseudonym.ts` 상단 fail-safe 규율과 같은 방향).
 * ★`user` kind 를 재사용하지 않는다 — 링크축 조인이 성립해 익명 설치가 이름으로
 *   되짚어진다(설계 §5.4).
 */
function makeTeamMemberKey(uid: string, salt: string | null): string | null {
  const key = pseudonymizeAnalyticsId("teamMember", uid, salt);
  return typeof key === "string" ? key : null;
}

export const getTeamProjectAudit = functions.https.onCall(
  async (data, context): Promise<TeamProjectAuditResult> => {
    // ★신원의 출처는 `context.auth` 하나뿐이다. 클라 제어 헤더는 읽지 않는다
    //   (설계 §5.3-2). ★requireAdmin 은 부르지 않는다 — 다른 축이다.
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }

    const nowMs = Date.now();
    const limit = normalizeLimit(data?.limit ?? DEFAULT_TEAM_AUDIT_LIMIT);
    const rawCursor = data?.cursor;
    const cursor =
      rawCursor == null || rawCursor === ""
        ? null
        : decodeAuditCursor(rawCursor);
    if (rawCursor != null && rawCursor !== "" && cursor === null) {
      // ★조용히 1페이지로 접으면 화면이 같은 페이지를 무한히 돈다.
      throw new functions.https.HttpsError(
        "invalid-argument",
        "cursor 를 해석할 수 없다. 이전 응답의 page.nextCursor 를 그대로 넘겨라."
      );
    }

    const { refs: projects, truncated: projectsTruncated } =
      await resolveTeamProjectRefs(uid);
    const requested = teamAuditString(data?.projectId);

    // ★클라가 준 projectId 는 **선택**일 뿐 권한 근거가 아니다(설계 §5.3-1).
    //   바로 아래 `resolveTeamProjectRole` 이 그 프로젝트에 대한 역할을 서버가
    //   직접 확인하고, 역할이 없으면 어떤 행도 나가지 않는다. 즉 클라 입력으로
    //   스코프를 넓히는 길이 없다.
    const projectId =
      requested ?? (projects.length > 0 ? projects[0].id : null);
    if (!projectId) {
      return deniedTeamAudit(nowMs, "no_project");
    }

    const { role, projectName } = await resolveTeamProjectRole(uid, projectId);
    const scope = scopeForRole(role);
    if (role === "none" || scope === null) {
      // ★존재하지 않는 프로젝트와 남의 프로젝트가 **구분되지 않는** 같은 응답이다
      //   — 그래야 열람 시도가 존재 탐지가 되지 않는다(설계 §5.3).
      return deniedTeamAudit(nowMs, "no_role");
    }

    // 셀렉터 목록에 현재 프로젝트의 실제 역할을 반영한다(admin 은 members 배열
    // 조회만으로는 안 잡힌다).
    const projectRefs: TeamAuditProjectRef[] = (() => {
      const existing = projects.find((p) => p.id === projectId);
      if (existing) {
        return projects.map((p) => (p.id === projectId ? { ...p, role } : p));
      }
      return [{ id: projectId, name: projectName, role }, ...projects];
    })();

    const salt = readAnalyticsIdSalt();
    const memberKeyCache = new Map<string, string | null>();
    const memberKeyOf = (rawUid: string): string | null => {
      const cached = memberKeyCache.get(rawUid);
      if (cached !== undefined) return cached;
      const key = makeTeamMemberKey(rawUid, salt);
      memberKeyCache.set(rawUid, key);
      return key;
    };
    const selfMemberKey = makeTeamMemberKey(uid, salt);

    // ── 1) 사건 원장 — ★허용목록으로 서버에서 거른다 ──────────────────────
    //   `in` 절이라 목록 밖 툴은 Firestore 밖으로 아예 안 나온다. self 스코프면
    //   `actorUid` 동등절을 추가해 **남의 행을 애초에 읽지 않는다.**
    //   색인: (projectId, toolName, createdAt) / (projectId, actorUid, toolName,
    //   createdAt) — firestore.indexes.json 에 이미 있다.
    const eventsRes = await auditQuery("team:audit_logs(events)", () => {
      let q: FirebaseFirestore.Query = db
        .collection("audit_logs")
        .where("projectId", "==", projectId);
      if (scope === "self") q = q.where("actorUid", "==", uid);
      return q
        .where("toolName", "in", TEAM_AUDIT_EVENT_TOOL_LIST)
        .orderBy("createdAt", "desc")
        .limit(TEAM_AUDIT_EVENT_SCAN_LIMIT)
        .get();
    });

    // ── 2) 프로젝트 축 소스들(요약·주의 필요 판정용). 서로 독립이라 병렬. ──
    const [tasksRes, agentsRes, missionsRes, contextLedgerRes, mergesRes] =
      await Promise.all([
        auditQuery("team:tasks", () =>
          db
            .collection("tasks")
            .where("projectId", "==", projectId)
            .limit(TEAM_AUDIT_TASK_SCAN_LIMIT)
            .get()
        ),
        auditQuery("team:agents", () =>
          db
            .collection("agents")
            .where("projectId", "==", projectId)
            .limit(TEAM_AUDIT_AGENT_SCAN_LIMIT)
            .get()
        ),
        auditQuery("team:missions", () =>
          db
            .collection("missions")
            .where("projectId", "==", projectId)
            .limit(TEAM_AUDIT_MISSION_SCAN_LIMIT)
            .get()
        ),
        // 최근 원장(허용목록 무관) — `failedActions` 수와 마지막 기록 시각만 쓴다.
        // ★이 행들의 **본문은 응답에 실리지 않는다.** 매퍼가 만든 timeline 은
        //   버리고, 사건 목록은 위 1) 의 허용목록 결과로만 만든다.
        auditQuery("team:audit_logs(context)", () =>
          db
            .collection("audit_logs")
            .where("projectId", "==", projectId)
            .orderBy("createdAt", "desc")
            .limit(TEAM_AUDIT_LEDGER_CONTEXT_LIMIT)
            .get()
        ),
        auditQuery("team:merge_history", () =>
          db
            .collection("merge_history")
            .where("projectId", "==", projectId)
            .orderBy("mergedAt", "desc")
            .limit(TEAM_AUDIT_MERGE_SCAN_LIMIT)
            .get()
        )
      ]);

    // ★에이전트 목록이 상한에 닿았나. 아래 두 곳이 이 값을 쓴다 — 판정 생략과 고지.
    const agentsTruncated =
      agentsRes.docs.length >= TEAM_AUDIT_AGENT_SCAN_LIMIT;

    // ── 3) 활동은 taskId 축. 카운트와 시각만 쓴다(본문은 응답에 안 나간다). ──
    const orderedTaskIds = [...tasksRes.docs]
      .sort(
        (a, b) => (toMillis(b.updatedAt) ?? 0) - (toMillis(a.updatedAt) ?? 0)
      )
      .map((t) => t.id);
    const activityTaskIds = orderedTaskIds.slice(
      0,
      TEAM_AUDIT_ACTIVITY_TASK_CAP
    );
    const activityChunks: string[][] = [];
    for (let i = 0; i < activityTaskIds.length; i += 30) {
      activityChunks.push(activityTaskIds.slice(i, i + 30));
    }
    const activityResults = await Promise.all(
      activityChunks.map((chunk, i) =>
        auditQuery(`team:activities[${i}]`, () =>
          db.collection("activities").where("taskId", "in", chunk).get()
        )
      )
    );
    const activities = activityResults.flatMap((r) => r.docs);

    // ── 4) ★매퍼 재사용(설계 §3.2). 새 매퍼를 만들지 않는다. ────────────────
    const base = buildProjectAudit({
      projects: [],
      projectId,
      tasks: tasksRes.docs,
      agents: agentsRes.docs,
      activities,
      ledger: contextLedgerRes.docs,
      missions: missionsRes.docs,
      merges: mergesRes.docs,
      // ★잘린 목록은 "없다" 가 아니라 "모른다" 다. 잘린 채로 판정하면 상한 밖
      //   에이전트가 물고 있는 티켓이 전부 '주인 없는 클레임' 거짓 경보로 뜬다
      //   (projectAudit.evaluateAttention 주석의 실패 모드 그대로).
      agentsLoaded: agentsRes.ok && !agentsTruncated,
      nowMs,
      // 타임라인은 어차피 좁히기에서 통째로 버린다 — 조립 비용만 최소화한다.
      timelineLimit: 1,
    });

    // ── 5) 사건 입력 추출. ★`actorUid` 는 여기까지만 산다 — 좁히기가 가명으로
    //      바꾸고, 응답 타입에는 그 필드 자리가 없다.
    const ledgerEvents: LedgerEventInput[] = eventsRes.docs.map((doc) => ({
      id: doc.id,
      toolName: doc.toolName,
      atMs: toMillis(doc.createdAt),
      taskId: teamAuditString(doc.taskId),
      agentId: teamAuditString(doc.agentId),
      actorUid: teamAuditString(doc.actorUid),
      success: typeof doc.success === "boolean" ? doc.success : null,
    }));
    const mergeEvents: MergeEventInput[] = mergesRes.docs.map((doc) => {
      const prNumber = Number(doc.prNumber);
      return {
        id: doc.id,
        atMs: toMillis(doc.mergedAt ?? doc.createdAt),
        taskId: teamAuditString(doc.taskId),
        branch: teamAuditString(doc.branch),
        prNumber: Number.isFinite(prNumber) && prNumber > 0 ? prNumber : null,
        filesChanged:
          doc.filesChanged == null ? null : Number(doc.filesChanged) || 0,
        linesAdded: doc.linesAdded == null ? null : Number(doc.linesAdded) || 0,
        linesDeleted:
          doc.linesDeleted == null ? null : Number(doc.linesDeleted) || 0,
        // ★`repoRoot` 를 **읽어서 넘기지도 않는다** — 타입에 자리가 없다.
      };
    });

    const sourcesIncomplete =
      !eventsRes.ok ||
      !tasksRes.ok ||
      !agentsRes.ok ||
      !missionsRes.ok ||
      !contextLedgerRes.ok ||
      !mergesRes.ok ||
      activityResults.some((r) => !r.ok);
    // ★자르는 자리는 전부 여기서 센다. 하나라도 빠지면 그 소스는 **조용히** 잘린다
    //   — 감사에서 조용한 누락은 가장 나쁜 실패다(파일 상단 규율).
    const scanTruncated =
      eventsRes.docs.length >= TEAM_AUDIT_EVENT_SCAN_LIMIT ||
      tasksRes.docs.length >= TEAM_AUDIT_TASK_SCAN_LIMIT ||
      agentsTruncated ||
      missionsRes.docs.length >= TEAM_AUDIT_MISSION_SCAN_LIMIT ||
      mergesRes.docs.length >= TEAM_AUDIT_MERGE_SCAN_LIMIT ||
      contextLedgerRes.docs.length >= TEAM_AUDIT_LEDGER_CONTEXT_LIMIT ||
      orderedTaskIds.length > activityTaskIds.length ||
      projectsTruncated;

    // ── 6) ★팀 경계 강제. 넓히는 경로는 없다. ──────────────────────────────
    const result = narrowAuditForTeam({
      base,
      ledger: ledgerEvents,
      merges: mergeEvents,
      scope,
      role,
      projects: projectRefs,
      memberKeyOf,
      selfMemberKey,
      limit,
      cursor,
      sourcesIncomplete,
      scanTruncated,
      agentsLoaded: agentsRes.ok && !agentsTruncated,
      agentsTruncated,
      projectsTruncated,
      // ★활동을 실제로 훑은 티켓만 '정체' 판정 대상이다. 상한에 안 걸렸으면 null
      //   (= 전부 훑었다). 잘렸을 때만 집합을 넘겨 판정을 좁힌다.
      activityScannedTaskIds:
        orderedTaskIds.length > activityTaskIds.length
          ? new Set(activityTaskIds)
          : null,
      nowMs,
    });

    // ★문장이 아니라 **코드**를 붙인다 — 화면이 ko·en·ja 로 번역할 수 있어야 한다.
    //   ★솔트 이름(`ANALYTICS_ID_SALT_ENV`)을 응답 문장에 넣지 않는다. env 키 이름은
    //   서버 설정 정보라 사용자 화면에 나갈 값이 아니다(부재 사실은 서버 로그에 남는다).
    if (!salt) {
      functions.logger.warn(
        `[getTeamProjectAudit] ${ANALYTICS_ID_SALT_ENV} is not configured; actor attribution is dropped (no raw uid fallback).`
      );
      result.notes.push(runtimeNote("note_member_key_unavailable"));
    }
    if (eventsRes.docs.length >= TEAM_AUDIT_EVENT_SCAN_LIMIT) {
      result.notes.push(runtimeNote("note_event_scan_truncated"));
    }
    return result;
  }
);

// ============================================================================
// 국가·채널 어트리뷰션 (익명 GA4 수도아이디) — 티켓 rPVkmOKG
// ============================================================================
//
// 설계: v3/docs/ga4-country-funnel-attribution-2026-08-10.md (#901 후속).
//
// 두 축이 여기 있다:
//   1) `linkInstallAttribution` — 웹(marblo.app/<locale>/link)이 앱의 익명 설치
//      ID 와 브라우저의 GA4 client_id 를 묶어 보내는 **미인증** 콜러블.
//   2) `getAdminCountryFunnel`  — 두 리전에 각각 쿼리를 던지고 결과를 **메모리
//      에서** 조인해 국가·채널 퍼널을 만드는 어드민 콜러블.
//
// ★리전 블로커(#901 §2)를 여기서 넘긴다. BigQuery 는 리전이 다른 데이터셋을 한
//   쿼리에서 조인하지 못하지만, 쿼리를 두 번 던져 애플리케이션에서 합치는 건
//   막지 않는다. 현 볼륨(31일 방문자 ~554, 다운로드 ~39)에선 이게 데이터셋
//   복제/전송을 세팅하는 것보다 싸고, 무엇보다 **사장님 콘솔 액션 없이 오늘
//   돌아간다**. 규모가 커지면(§WEB_VISITOR_LIMIT 절단이 보이기 시작하면)
//   #901 §2-3 의 Scheduled Query + Dataset Copy 로 승급한다.

const BQ_ATTRIBUTION_TABLE = "install_attribution";

/** GA4 BigQuery export 데이터셋/리전. 링크 재생성 시 env 로만 바꾼다. */
const GA4_BQ_DATASET =
  process.env.GA4_BQ_DATASET?.trim() || "analytics_543991508";
const GA4_BQ_LOCATION =
  process.env.GA4_BQ_LOCATION?.trim() || "asia-northeast3";

/**
 * 메모리 조인이 감당하는 GA4 방문자 상한. 넘으면 결과를 자르고 그 사실을
 * 응답 note 로 **밝힌다** — 조용히 잘린 표는 "전부 봤다"로 읽히기 때문이다.
 */
const WEB_VISITOR_LIMIT = 200000;

let attributionTableReady = false;

/**
 * 어트리뷰션 테이블을 최초 1회 생성한다(trainingCapture 와 같은 패턴).
 *
 * ★테이블이 **이미 있으면** 스키마에 새로 생긴 NULLABLE 컬럼만 덧붙인다.
 *   컬럼을 코드에만 추가하고 BQ 를 그대로 두면 insert 가 "no such field" 로
 *   통째로 죽고, 그 실패는 어트리뷰션 행의 영구 유실이 된다(아래 insert 의
 *   보상 로직은 Firestore 마커만 되돌린다). 붙이기만 하고 **기존 컬럼의 삭제·
 *   타입변경·데이터 수정은 하지 않는다** — BigQuery 도 NULLABLE 추가만 허용한다.
 */
async function ensureAttributionTable(): Promise<void> {
  if (attributionTableReady) return;
  const dataset = bigquery.dataset(BQ_DATASET);
  const table = dataset.table(BQ_ATTRIBUTION_TABLE);
  const [exists] = await table.exists();
  if (!exists) {
    await table.create({
      schema: INSTALL_ATTRIBUTION_SCHEMA as unknown as {
        name: string;
        type: string;
      }[],
      timePartitioning: { type: "DAY", field: "linkedAt" },
      clustering: { fields: ["gaClientId"] },
    });
    functions.logger.info(
      "[installAttribution] created install_attribution table"
    );
    attributionTableReady = true;
    return;
  }

  const [metadata] = await table.getMetadata();
  const live: { name: string }[] = metadata?.schema?.fields ?? [];
  const liveNames = new Set(live.map((f) => f.name));
  const missing = INSTALL_ATTRIBUTION_SCHEMA.filter(
    (f) => !liveNames.has(f.name)
  );
  if (missing.length > 0) {
    // 새 컬럼은 전부 NULLABLE 이어야 한다 — REQUIRED 를 기존 테이블에 붙이는
    // 건 BigQuery 가 거부하고, 거부당하면 여기서 던져 insert 까지 막힌다.
    const additive = missing.filter((f) => f.mode === "NULLABLE");
    if (additive.length > 0) {
      await table.setMetadata({
        schema: { fields: [...live, ...additive] },
      });
      functions.logger.info("[installAttribution] schema columns added", {
        added: additive.map((f) => f.name),
      });
    }
  }
  attributionTableReady = true;
}

/**
 * 웹→앱 익명 어트리뷰션 링크백. **미인증**이다 — 다운로드 직후 최초 실행 시점의
 * 사용자는 아직 로그인하지 않았고, 로그인을 요구하면 측정하려는 대상(설치 완주)을
 * 측정 행위가 파괴한다. 대신 IP 레이트리밋 + 설치당 1회 + 엄격한 입력 검증으로
 * 막는다.
 *
 * ★저장하지 않는 것: uid / 이메일 / 요청 IP. IP 는 레이트리밋 키로만 쓴다.
 * ★설치당 1회: Firestore `installAttributions/{installId}` 를 create 로 잡아
 *   선착 1건만 BigQuery 에 적재한다(재방문 시 채널이 덮이지 않게 — first-touch).
 */
export const linkInstallAttribution = functions.https.onCall(
  async (data, context) => {
    const ip = extractIp(context.rawRequest);
    const check = await enforceRateLimit(`attr:ip:${ip}`, ATTRIBUTION_RULES_IP);
    if (!check.allowed) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        `Too many attempts. Try again in ${check.retryAfter}s.`
      );
    }

    const parsed = parseLinkInstallRequest(data, new Date());
    if (!parsed.ok) {
      // 사유는 코드로만 남긴다 — 입력값 원문을 로그에 남기지 않는다.
      functions.logger.warn("[installAttribution] rejected", {
        reason: parsed.reason,
      });
      throw new functions.https.HttpsError("invalid-argument", parsed.reason);
    }
    const row = parsed.row;

    // 설치당 1회 게이트. create 는 문서가 이미 있으면 ALREADY_EXISTS 로 던진다.
    const docRef = db.collection("installAttributions").doc(row.installId);
    try {
      await docRef.create({
        linkedAt: admin.firestore.Timestamp.fromDate(new Date(row.linkedAt)),
        // ★조인키(gaClientId)를 Firestore 에 이중 보관하지 않는다 — 존재 여부만.
        hasGaClientId: row.gaClientId !== null,
        platform: row.platform,
        appVersion: row.appVersion,
        linkSource: row.linkSource,
      });
    } catch (e) {
      const code = (e as { code?: number | string }).code;
      // 6 = ALREADY_EXISTS(gRPC). 재실행/새로고침은 정상 흐름이므로 성공 응답.
      if (code === 6 || code === "already-exists") {
        return { ok: true, alreadyLinked: true };
      }
      throw e;
    }

    try {
      await ensureAttributionTable();
      // ★적재 직전에만 가명을 붙인다 — 솔트는 런타임 env 에만 있다. 이 컬럼이
      //   `ga_key` 는 여기서 만들지 않는다 — analytics_identity 백필
      //   (scripts/backfill-analytics-identity.ts)이 `gaClientId` 에서
      //   pseudonymizeAnalyticsId("ga", ...) 로 직접 파생한다. 두 벌을 만들면
      //   익명축 조인이 조용히 갈라진다.
      await bigquery
        .dataset(BQ_DATASET)
        .table(BQ_ATTRIBUTION_TABLE)
        .insert([row]);
    } catch (e) {
      // BQ 적재가 실패해도 Firestore 마커는 남아 재시도가 막힌다 → 마커를 되돌려
      // 다음 시도에 다시 적재될 수 있게 한다(조용한 영구 유실 방지).
      await docRef.delete().catch(() => undefined);
      functions.logger.error("[installAttribution] bigquery insert failed", {
        message: safeAnalyticsErrorMessage(e),
      });
      throw new functions.https.HttpsError("internal", "attribution_failed");
    }

    return { ok: true, alreadyLinked: false };
  }
);

/**
 * 어드민 국가·채널 퍼널. 두 리전 쿼리 → 메모리 조인.
 *
 * 한쪽(GA4)이 실패해도 나머지는 렌더된다 — 부분 실패를 0 으로 표시하지 않고
 * note 와 `webRegionError` 로 드러낸다.
 */
export const getAdminCountryFunnel = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseAnalyticsDays(data);
    const includeAdmin = parseIncludeAdmin(data);

    // GA4 데이터셋 이름은 SQL 에 그대로 박히므로 식별자 화이트리스트를 강제한다.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(GA4_BQ_DATASET)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "GA4_BQ_DATASET is not a valid BigQuery identifier"
      );
    }

    // ── (1) 웹측: GA4 export (asia-northeast3) ──────────────────────────────
    // 방문자 1명 = 1행. 국가는 **최초 이벤트 시점**의 값을 쓰고(여행/VPN 로 국가가
    // 바뀌어도 유입국가는 하나여야 한다), traffic_source 는 GA4 에서 유저 단위
    // 최초획득 값이라 ANY_VALUE 로 충분하다.
    const webQuery = `
      WITH ev AS (
        SELECT
          user_pseudo_id,
          event_name,
          event_timestamp,
          geo.country            AS country,
          traffic_source.source  AS source,
          traffic_source.medium  AS medium,
          traffic_source.name    AS campaign
        FROM \`marblo-2253d.${GA4_BQ_DATASET}.events_*\`
        WHERE _TABLE_SUFFIX BETWEEN
                FORMAT_DATE('%Y%m%d',
                  DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL @days DAY))
              AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Seoul'))
      )
      SELECT
        user_pseudo_id AS gaClientId,
        ARRAY_AGG(country IGNORE NULLS ORDER BY event_timestamp LIMIT 1)
          [SAFE_OFFSET(0)] AS country,
        ANY_VALUE(source)   AS source,
        ANY_VALUE(medium)   AS medium,
        ANY_VALUE(campaign) AS campaign,
        COUNTIF(event_name = 'download') AS downloads
      FROM ev
      GROUP BY gaClientId
      LIMIT ${WEB_VISITOR_LIMIT}
    `;

    // ── (2) 앱측: marblo_telemetry (US) ─────────────────────────────────────
    // 행 키는 **익명 설치 ID**(events.userId)다. accountUserId 폴백을 쓰지 않는
    // 이유: 이 퍼널의 조인 축은 설치이고, uid 를 섞으면 익명 축이 깨진다
    // (티켓 woXp2c70 — 앱 uid 제거와 정합).
    const eventsTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_EVENTS_TABLE}\``;
    const attrTable = `\`marblo-2253d.${BQ_DATASET}.${BQ_ATTRIBUTION_TABLE}\``;
    const connected = modelConnectedPredicateSql({
      event: "event",
      step: "JSON_VALUE(metadata, '$.step')",
      phase: "JSON_VALUE(metadata, '$.phase')",
      verdict: "JSON_VALUE(metadata, '$.verdict')",
    });
    // 익명 세계 운영자 자기제외는 은퇴했다(adminEventExclusion 블록 주석) —
    // 어드민의 익명 설치 ID 를 알아내려면 cost_logs 역참조가 필요했고, 그 다리를
    // 끊었기 때문이다. 여기 두 절은 그래서 항상 비어 있다.
    const excludeClause = "";
    const excludeAttrClause = "";

    const appQuery = `
      WITH att AS (
        SELECT
          installId,
          ARRAY_AGG(gaClientId IGNORE NULLS ORDER BY linkedAt LIMIT 1)
            [SAFE_OFFSET(0)] AS gaClientId,
          ARRAY_AGG(utmSource IGNORE NULLS ORDER BY linkedAt LIMIT 1)
            [SAFE_OFFSET(0)] AS utmSource,
          ARRAY_AGG(utmMedium IGNORE NULLS ORDER BY linkedAt LIMIT 1)
            [SAFE_OFFSET(0)] AS utmMedium,
          ARRAY_AGG(utmCampaign IGNORE NULLS ORDER BY linkedAt LIMIT 1)
            [SAFE_OFFSET(0)] AS utmCampaign,
          ARRAY_AGG(referrerHost IGNORE NULLS ORDER BY linkedAt LIMIT 1)
            [SAFE_OFFSET(0)] AS referrerHost
        FROM ${attrTable}
        WHERE linkedAt >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
          ${excludeAttrClause}
        GROUP BY installId
      ),
      ev AS (
        SELECT
          userId AS installId,
          MAX(IF(event = 'app:first_run', 1, 0))       AS firstRun,
          MAX(IF(${connected}, 1, 0))                  AS modelConnected,
          MAX(IF(event = 'onboarding:first_multi_agent_success'
                   AND JSON_VALUE(metadata, '$.withinTargetWindowFromConnect')
                       = 'true', 1, 0))                AS within10m
        FROM ${eventsTable}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
          AND userId IS NOT NULL${excludeClause}
        GROUP BY installId
      )
      SELECT
        COALESCE(att.installId, ev.installId) AS installId,
        att.gaClientId,
        att.utmSource,
        att.utmMedium,
        att.utmCampaign,
        att.referrerHost,
        IFNULL(ev.firstRun, 0)       AS firstRun,
        IFNULL(ev.modelConnected, 0) AS modelConnected,
        IFNULL(ev.within10m, 0)      AS within10m
      FROM att
      FULL OUTER JOIN ev ON att.installId = ev.installId
      -- 모집단 = 이번 창의 **신규 설치**(app:first_run) ∪ **링크백이 도달한 설치**.
      -- 후자를 포함하는 게 중요하다: 링크백은 로그인 없이도 도달하는 반면
      -- app:first_run 은 "다음 성공 로그인"까지 flush 되지 않는다(#901 §1-2) —
      -- 즉 링크백이 그 사각을 일부 메운다.
      WHERE att.installId IS NOT NULL OR ev.firstRun = 1
    `;

    const params: Record<string, unknown> = { days: rangeDays };

    const [webRes, appRes] = await Promise.allSettled([
      bigquery.query({
        query: webQuery,
        params: { days: rangeDays },
        location: GA4_BQ_LOCATION,
      }),
      bigquery.query({ query: appQuery, params, location: BQ_LOCATION }),
    ]);

    const webRows =
      webRes.status === "fulfilled"
        ? (webRes.value[0] as BigQueryRows)
        : ([] as BigQueryRows);
    const appRows =
      appRes.status === "fulfilled"
        ? (appRes.value[0] as BigQueryRows)
        : ([] as BigQueryRows);

    const funnel = buildCountryFunnel(
      webRows as unknown as WebVisitorRow[],
      appRows as unknown as InstallRow[]
    );

    const notes = [...funnel.notes];
    const webRegionError =
      webRes.status === "rejected"
        ? safeAnalyticsErrorMessage(webRes.reason)
        : null;
    const appRegionError =
      appRes.status === "rejected"
        ? safeAnalyticsErrorMessage(appRes.reason)
        : null;
    if (webRegionError) {
      notes.push(
        `GA4(${GA4_BQ_LOCATION}) 조회 실패 — 방문·다운로드 칸은 '0' 이 아니라 '모름'이다.`
      );
    }
    if (appRegionError) {
      notes.push(
        `앱 텔레메트리(${BQ_LOCATION}) 조회 실패 — 설치 이후 칸은 '0' 이 아니라 '모름'이다.`
      );
    }
    if (webRows.length >= WEB_VISITOR_LIMIT) {
      notes.push(
        `GA4 방문자가 상한 ${WEB_VISITOR_LIMIT.toLocaleString()}명에서 잘렸다 — 표의 방문·다운로드는 이 표본 기준이다. 스케줄 쿼리 + Dataset Copy 로 승급할 시점이다.`
      );
    }
    notes.push(
      "GA4 일별 export 는 D+1 이다 — 오늘·어제 다운로드는 아직 반영되지 않았을 수 있다."
    );

    return {
      rangeDays,
      includeAdmin,
      generatedAt: new Date().toISOString(),
      join: {
        // 조인은 SQL 이 아니라 여기서 일어난다는 사실을 화면이 말할 수 있게.
        strategy: "in_memory_cross_region",
        webRegion: GA4_BQ_LOCATION,
        appRegion: BQ_LOCATION,
        webVisitors: webRows.length,
        webRegionError,
        appRegionError,
      },
      byCountry: funnel.byCountry,
      byChannel: funnel.byChannel,
      totals: funnel.totals,
      coverage: funnel.coverage,
      notes,
    };
  });


// ════════════════════════════════════════════════════════════════════════════
// analytics_purchase — Firestore 결제 원장 → BigQuery (ticket 6EnTiEzL7T2NpjOnTTSj)
// ════════════════════════════════════════════════════════════════════════════
// marblo_telemetry 에는 결제 테이블이 아예 없었고(6개 테이블 전부 제품사용 축),
// 그래서 어드민 '수익' 탭은 **채울 소스가 없어서** 비어 있었다. 여기서 그 소스를
// 만든다. 매핑 규칙·프라이버시 판단은 analyticsPurchase.ts 에, 적재(로드 잡 +
// MERGE)는 analyticsPurchaseLoad.ts 에 있다 — 여기 있는 건 배선뿐이다.
//
// ★읽기 전용이다. 이 경로는 Firestore 에 한 글자도 쓰지 않고 실제 결제 흐름을
//   건드리지 않는다. 결제 원장을 **읽어서 복제**할 뿐이다.
// ★멱등이다. row_id(소스 문서키의 HMAC 가명) 로 MERGE 하므로 몇 번을 돌려도
//   행 수가 같다. 재실행에서 affected=0 이면 멱등이 지켜진 것이다.
// ★금액·주문번호·PG 응답 원문을 로그에 남기지 않는다. 아래 로그는 건수와 사유
//   코드만 싣는다.

/** 적재 1회 결과 — 로그와 어드민 콜러블 응답이 공유한다. */
interface PurchaseLoadReport {
  /** 소스 컬렉션별 원본 문서 수. Firestore 대조의 기준값. */
  sourceCounts: { charges: number; lectures: number; subscriptions: number };
  /** 만들어진 행 수. */
  mapped: number;
  /** 사유별 스킵 건수. 조용히 버리지 않는다. */
  skipped: Record<string, number>;
  /**
   * ★계정 성격별 건수 + 실매출. 적재 로그가 "이번 배치에서 내부 몇 건을
   * 갈랐는지" 를 그대로 말하게 한다 — 화면과 로그가 같은 정의를 쓴다.
   */
  tally: PurchaseTally;
  /**
   * 내부(운영자) 판정 축을 어디서 얻었는지. `"none"` 이면 판정 자체를 못 해
   * 모든 행의 account_class 가 null 이 된다(= 매출로 승격되지 않는다).
   */
  internalMarker: "env" | "fallback" | "none";
  staged: number;
  collapsed: number;
  affected: number;
  tableState: string;
  /** 진행을 막은 것이 있으면 사람이 읽을 수 있는 사유. 없으면 null. */
  blocker: string | null;
}

/**
 * 내부(운영자) 계정의 **가명키 집합**을 만든다.
 *
 * ★사람이 아니라 성격으로 판정한다. 운영자 uid 를 코드에 박지 않고 기존
 *   운영자 축(`getAdminExclusionUid()` = env `ADMIN_UID`)을 그대로 쓴다 —
 *   analyticsProfiles.ts 가 "새 운영자 판정 규약을 만들지 마라" 로 못박은 그
 *   축이다. 운영자가 바뀌면 env 만 바뀌고 판정은 계속 동작한다.
 * ★원시 uid 는 이 함수 밖으로 나가지 않는다. 매퍼에는 가명키만 넘어간다.
 * ★키를 못 만들면 `null` 을 돌려 "판정 불가" 를 그대로 남긴다 — 빈 Set 으로
 *   접으면 모든 행이 external(=실매출)로 승격된다.
 */
function resolveInternalUserKeys(
  deriveUserKey: ((uid: string) => string | null) | null
): {
  keys: ReadonlySet<string> | null;
  marker: PurchaseLoadReport["internalMarker"];
} {
  if (!deriveUserKey) return { keys: null, marker: "none" };
  const uid = getAdminExclusionUid();
  if (!uid) return { keys: null, marker: "none" };
  const key = deriveUserKey(uid);
  if (!key) return { keys: null, marker: "none" };
  const fromEnv = (process.env.ADMIN_UID?.trim() ?? "") !== "";
  return { keys: new Set([key]), marker: fromEnv ? "env" : "fallback" };
}

/**
 * 결제 원장을 읽어 analytics_purchase 로 적재한다.
 *
 * ★user_key 공용 HMAC 함수(사람 축 PR #1084 → analyticsUserKey.ts)가 배선되지
 *   않았으면 **행을 만들지 않고**
 *   blocker 를 돌려준다. 임시 해시로 메꾸지 않는다 — 그렇게 적재한 과거분은
 *   analytics_identity 와 영원히 조인되지 않고, 그 사실이 숫자로 드러나지
 *   않는다(조인 결과가 0 이 아니라 그냥 비어 보인다).
 */
async function loadAnalyticsPurchaseInternal(
  opts: { dryRun?: boolean } = {}
): Promise<PurchaseLoadReport> {
  const salt = getAnalyticsIdSalt();
  const deriveUserKey = resolveAnalyticsUserKeyFn();
  const internal = resolveInternalUserKeys(deriveUserKey);
  const ctx: PurchaseMapContext = {
    salt,
    deriveUserKey,
    internalUserKeys: internal.keys,
    ingestedAt: new Date(),
  };

  const sources = await readPurchaseSources(db);
  const built: BuildResult = buildPurchaseRows(sources, ctx);

  const blocker = !deriveUserKey
    ? ANALYTICS_USER_KEY_BLOCKER
    : !salt
    ? `${ANALYTICS_ID_SALT_ENV} 미설정 — 가명키를 만들 수 없어 적재하지 않는다`
    : !firebaseProjectId
    ? "GCLOUD_PROJECT 미설정 — MERGE 대상 테이블을 정규화할 수 없다"
    : null;

  const base: PurchaseLoadReport = {
    sourceCounts: sources.counts,
    mapped: built.rows.length,
    skipped: built.skipped as Record<string, number>,
    tally: tallyPurchaseRows(built.rows),
    internalMarker: internal.marker,
    staged: 0,
    collapsed: 0,
    affected: 0,
    tableState: "skipped",
    blocker,
  };

  if (blocker || opts.dryRun || built.rows.length === 0) {
    functions.logger.warn("[analytics_purchase] load skipped", {
      table: ANALYTICS_PURCHASE_TABLE,
      dryRun: opts.dryRun === true,
      blocker,
      sourceCounts: base.sourceCounts,
      mapped: base.mapped,
      skipped: base.skipped,
      tally: base.tally,
      internalMarker: base.internalMarker,
    });
    return base;
  }

  // BigQuery 클라이언트는 BqLike 를 구조적으로 만족하지만 타입 선언이 더
  // 넓다(제네릭 응답 튜플). 캐스트는 이 한 곳으로 가둔다.
  const outcome = await loadPurchaseRows(bigquery as unknown as BqLike, {
    projectId: firebaseProjectId as string,
    datasetId: BQ_DATASET,
    location: BQ_LOCATION,
    rows: built.rows,
  });

  const report: PurchaseLoadReport = {
    ...base,
    staged: outcome.staged,
    collapsed: outcome.collapsed,
    affected: outcome.affected,
    tableState: outcome.tableState,
  };
  // 건수와 사유 코드만 남긴다 — 금액·주문번호·PG 응답 원문은 싣지 않는다.
  functions.logger.info("[analytics_purchase] loaded", {
    table: ANALYTICS_PURCHASE_TABLE,
    sourceCounts: report.sourceCounts,
    mapped: report.mapped,
    skipped: report.skipped,
    // ★건수와 합계만. 개별 금액·주문번호·uid 는 여전히 로그에 없다.
    tally: report.tally,
    internalMarker: report.internalMarker,
    staged: report.staged,
    collapsed: report.collapsed,
    affected: report.affected,
    tableState: report.tableState,
  });
  return report;
}

// 갱신 크론(04:30 KST)과 마케팅 미러(04:45) 뒤에 둔다 — 그날 새로 생긴 청구
// 원장이 이미 확정된 뒤에 읽기 위해서다.
export const scheduledLoadAnalyticsPurchase = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 5 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    try {
      await loadAnalyticsPurchaseInternal();
    } catch (err) {
      // 예외 메시지에 PG 응답이 섞일 수 있어 원문을 그대로 싣지 않는다.
      functions.logger.error("[analytics_purchase] load failed", {
        message: safeAnalyticsErrorMessage(err),
      });
    }
    return null;
  });

/**
 * 수동 트리거(어드민) — 백필 직후 첫 적재, 또는 대조용 dry-run.
 * `{ dryRun: true }` 면 BigQuery 를 건드리지 않고 건수만 돌려준다.
 */
export const loadAnalyticsPurchase = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const dryRun = (data as { dryRun?: unknown } | null)?.dryRun === true;
    return loadAnalyticsPurchaseInternal({ dryRun });
  });

// ═══════════════════════════════════════════════════════════════════════════
// 팀 오버뷰 — 오너가 보는 멤버별 사용량 (#1103 설계 §10-T4)
// ═══════════════════════════════════════════════════════════════════════════
//
// 정본: docs/team-usage-overview-design-2026-08-21.md
// 판정·집계·가명화·라벨은 전부 `teamUsage.ts`(순수, node --test) 에 있다. 여기는
// **인증·권한 조회·BQ 질의·캐시 IO** 만 한다 — projectAudit.ts 와 같은 분업이다.
//
// ── ★이 콜러블이 지키는 넷 ─────────────────────────────────────────────────
//
//  1) ★Admin SDK 는 보안 규칙을 **우회한다.** "룰이 막아주겠지" 로 기대지 않고
//     서버 코드가 스스로 역할을 확인한다. 신원의 출처는 `context.auth` 하나뿐이고
//     `X-Plan`/`X-User-Id` 같은 클라 제어 헤더는 읽지 않는다.
//  2) ★클라가 준 projectId 를 권한 근거로 쓰지 않는다. 서버가 uid 로 만든 집합과의
//     **교집합 필터**로만 쓴다 — 확장이 구조적으로 불가능하다.
//  3) ★원시 uid·이메일을 응답·캐시·로그 어디에도 남기지 않는다. BQ 결과를 받는
//     즉시 팀 전용 가명(`tm_`)으로 바꾸고, 그 뒤로 uid 를 들고 다니지 않는다.
//  4) ★게이트가 닫혀 있으면 **질의 자체를 하지 않고** 0행 + 사유를 돌려준다.
//     그래도 self 스코프는 산다 — 화면 절반이 죽지 않는다.

/**
 * ★게이트 운영자 사유는 **로그로만** 나간다 — 봉투에 실으면 오너 화면에 env 키가
 * 박힌다. 인스턴스당 1회만 남긴다(`personAxisGateWarned` 와 같은 규약): 닫힘은
 * 설계된 정상 상태라 요청마다 경고를 쌓으면 진짜 문제가 묻힌다.
 */
let teamUsageGateWarned = false;

/** 뷰가 사는 BigQuery 프로젝트. PERSON_AXIS_PROJECT_ID 와 같은 규약. */
const TEAM_USAGE_BQ_PROJECT_ID =
  process.env.GCLOUD_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCP_PROJECT ??
  "marblo-2253d";

/** 한 번에 훑는 프로젝트 상한. 읽기 폭주를 막고 응답 시간을 묶어 둔다. */
const TEAM_USAGE_PROJECT_SCAN_LIMIT = 50;

/**
 * L1 — 인스턴스 메모리 캐시(TTL 60초). 같은 인스턴스가 처리하는 연속 요청
 * (탭 전환, 차트 여러 개가 같은 데이터를 쓰는 경우)을 흡수한다. 인스턴스 churn
 * 에 사라지므로 **보조 수단**이고, 본체는 L2(Firestore) 다.
 *
 * ★키에 uid 를 넣지 않는다 — 프로젝트 단위 캐시다(권한이 다른 둘이 같은 캐시를
 *   나눠 쓰지 않게 하려면 키가 프로젝트여야 한다, 설계 §6.2).
 */
const teamUsageMemoryCache = new Map<
  string,
  {
    rows: Array<Record<string, unknown>>;
    expiresAtMs: number;
    generatedAtMs: number;
  }
>();
const TEAM_USAGE_MEMORY_CACHE_MAX = 200;

type TeamProjectRef = {
  projectId: string;
  name: string | null;
  ownerId: string;
  members: string[];
  role: TeamRole;
};

/** 문자열 배열 파라미터를 안전하게 읽는다(형이 흔들려도 권한이 넓어지지 않는다). */
function parseProjectIdsParam(data: unknown): string[] | null {
  const raw = (data as { projectIds?: unknown } | null | undefined)?.projectIds;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t !== "") out.push(t);
  }
  // ★여기서 자르지 않는다. 상한은 `capProjectScope` 한 곳에서만 적용하고
  //   잘린 개수를 센다 — 자르는 자리가 둘이면 한 쪽이 조용해진다.
  return out.length > 0 ? out : null;
}

/**
 * ★서버가 uid 로 "내가 속한 프로젝트와 그 역할" 을 만든다.
 *
 * 세 갈래를 합친다:
 *   - `projects.ownerId == uid`                → owner
 *   - `memberRoles` 의 내 문서(role == admin)  → admin
 *   - `projects.members array-contains uid`    → member/viewer(역할 문서 기준)
 *
 * ★`memberRoles` 는 `userId` 단일 필드로 조회한다 — 복합 인덱스를 새로 요구하지
 *   않기 위해서다(인덱스가 없으면 쿼리가 통째로 죽고, 그러면 팀 탭이 안 뜬다).
 *   역할 필터는 코드에서 한다.
 */
async function resolveTeamProjects(uid: string): Promise<TeamProjectRef[]> {
  const [ownedSnap, memberSnap, roleSnap] = await Promise.all([
    db
      .collection("projects")
      .where("ownerId", "==", uid)
      .limit(TEAM_USAGE_PROJECT_SCAN_LIMIT)
      .get(),
    db
      .collection("projects")
      .where("members", "array-contains", uid)
      .limit(TEAM_USAGE_PROJECT_SCAN_LIMIT)
      .get(),
    db
      .collection("memberRoles")
      .where("userId", "==", uid)
      .limit(TEAM_USAGE_PROJECT_SCAN_LIMIT)
      .get(),
  ]);

  const roleByProject = new Map<string, string>();
  for (const doc of roleSnap.docs) {
    const d = doc.data() as { projectId?: unknown; role?: unknown };
    const pid = typeof d.projectId === "string" ? d.projectId : null;
    const role = typeof d.role === "string" ? d.role : null;
    if (pid && role) roleByProject.set(pid, role);
  }

  const byId = new Map<string, TeamProjectRef>();
  const add = (
    doc: FirebaseFirestore.QueryDocumentSnapshot
  ): void => {
    if (byId.has(doc.id)) return;
    const d = doc.data() as {
      name?: unknown;
      ownerId?: unknown;
      members?: unknown;
    };
    const ownerId = typeof d.ownerId === "string" ? d.ownerId : "";
    const members = Array.isArray(d.members)
      ? d.members.filter((m): m is string => typeof m === "string")
      : [];
    // ★역할 판정은 firestore.rules 의 isAdminOrOwner 와 같은 정본을 쓴다.
    const declared = roleByProject.get(doc.id);
    const role: TeamRole =
      ownerId === uid
        ? "owner"
        : declared === "admin"
        ? "admin"
        : declared === "viewer"
        ? "viewer"
        : "member";
    byId.set(doc.id, {
      projectId: doc.id,
      name: typeof d.name === "string" && d.name.trim() !== "" ? d.name : null,
      ownerId,
      members,
      role,
    });
  };
  for (const doc of ownedSnap.docs) add(doc);
  for (const doc of memberSnap.docs) add(doc);

  // ★admin 역할 문서는 있는데 `members[]` 에는 없는 프로젝트를 놓치지 않는다.
  //   두 곳이 어긋나 있어도 admin 이 조용히 권한을 잃으면 안 된다(그 반대는
  //   위험하지만 이쪽은 역할 문서가 근거이므로 안전하다).
  const orphanAdminIds = [...roleByProject.entries()]
    .filter(([pid, role]) => role === "admin" && !byId.has(pid))
    .map(([pid]) => pid)
    .slice(0, TEAM_USAGE_PROJECT_SCAN_LIMIT);
  if (orphanAdminIds.length > 0) {
    const docs = await db.getAll(
      ...orphanAdminIds.map((pid) => db.collection("projects").doc(pid))
    );
    for (const doc of docs) {
      if (doc.exists) add(doc as FirebaseFirestore.QueryDocumentSnapshot);
    }
  }

  // 상한에 걸렸으면 조용히 자르지 않는다 — 잘린 사실을 로그에 남긴다.
  if (
    ownedSnap.size >= TEAM_USAGE_PROJECT_SCAN_LIMIT ||
    memberSnap.size >= TEAM_USAGE_PROJECT_SCAN_LIMIT
  ) {
    functions.logger.warn(
      "[teamUsage] 프로젝트 스캔 상한에 걸렸다 — 일부 프로젝트가 스코프에서 빠졌다.",
      { limit: TEAM_USAGE_PROJECT_SCAN_LIMIT }
    );
  }
  return [...byId.values()];
}

/**
 * uid → 표시명. ★이메일을 폴백으로 쓰지 않는다(설계 §5.4).
 *
 * 이름을 모르면 null 이고 화면이 "이름 미상" 으로 그린다. 이메일로 채우면
 * 이 응답이 이메일 배포 경로가 된다 — `users` 문서에 이메일이 있다는 사실과
 * 그걸 팀 화면에 실어 보내는 것은 다른 얘기다.
 */
async function resolveMemberDisplayNames(
  uids: ReadonlyArray<string>
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(uids)].filter((u) => u.trim() !== "");
  if (unique.length === 0) return out;
  const refs = unique.map((u) => db.collection("users").doc(u));
  const docs = await db.getAll(...refs);
  for (const doc of docs) {
    const d = doc.data() as { displayName?: unknown } | undefined;
    const name =
      typeof d?.displayName === "string" && d.displayName.trim() !== ""
        ? d.displayName.trim()
        : null;
    out.set(doc.id, name);
  }
  return out;
}

/** BQ 뷰가 아직 없어서 실패한 건가(= 적재 전). */
function isBqViewMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /not found/i.test(msg) && /table|view/i.test(msg);
}

type TeamUsageQueryOutcome =
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { ok: false; notProvisioned: boolean };

/**
 * ★신선도를 숨기지 않는다. 캐시가 섞이면 응답의 `generatedAt` 은 **가장 오래된**
 * 조각의 생성 시각이다 — 낙관적으로 반올림하면 화면의 "N분 전 기준" 이 거짓말이 된다.
 */
type TeamUsageLoadResult = TeamUsageQueryOutcome & {
  cacheHits: number;
  oldestGeneratedAtMs: number;
};

/**
 * 한 창의 팀 사용량 행을 모은다. 프로젝트 단위 캐시(L1→L2)를 먼저 보고, 미스인
 * 프로젝트만 BQ 로 간다.
 *
 * ★반환 행은 **이미 가명화된 캐시 행 모양**이다 — 원시 uid 는 이 함수 밖으로
 *   나가지 않는다.
 */
async function loadTeamUsageRows(args: {
  projectIds: string[];
  window: ReturnType<typeof computeUsageWindow>;
  gateEffectiveFrom: string | null;
  salt: string | null;
  nowMs: number;
  forceRefresh: boolean;
}): Promise<TeamUsageLoadResult> {
  const { projectIds, window, gateEffectiveFrom, salt, nowMs } = args;
  const rows: Array<Record<string, unknown>> = [];
  const missing: string[] = [];
  let cacheHits = 0;
  let refreshThrottled = 0;
  let oldestGeneratedAtMs = nowMs;

  // L1 — 인스턴스 메모리. 수동 새로고침은 이 층을 건너뛴다.
  for (const projectId of projectIds) {
    const docId = buildTeamUsageCacheDocId(projectId, window.windowKey);
    if (args.forceRefresh) {
      missing.push(projectId);
      continue;
    }
    const mem = teamUsageMemoryCache.get(docId);
    if (mem && mem.expiresAtMs > nowMs) {
      rows.push(...mem.rows);
      cacheHits += 1;
      oldestGeneratedAtMs = Math.min(oldestGeneratedAtMs, mem.generatedAtMs);
      continue;
    }
    missing.push(projectId);
  }

  // L2 — Firestore. ★서버 전용 티어라 Admin SDK 로만 닿는다.
  //
  // ★수동 새로고침도 이 문서를 **먼저 읽는다.** 레이트리밋 시각이 여기 있기
  //   때문이다(프로젝트당 5분에 1회). 별도 컬렉션을 만들면 룰 표면이 늘고,
  //   인스턴스 메모리에 두면 인스턴스가 바뀔 때마다 리밋이 리셋된다.
  const stillMissing: string[] = [];
  const manualRefreshAtByProject = new Map<string, number>();
  const generatedAtById = new Map<string, number>();
  if (missing.length > 0) {
    const refs = missing.map((p) =>
      db
        .collection(TEAM_USAGE_CACHE_COLLECTION)
        .doc(buildTeamUsageCacheDocId(p, window.windowKey))
    );
    const docs = await db.getAll(...refs);
    const hitById = new Map<string, Array<Record<string, unknown>>>();
    for (const doc of docs) {
      const data = doc.data() as
        | (TeamUsageCacheDoc & { manualRefreshAtMs?: unknown })
        | undefined;
      const lastManual =
        typeof data?.manualRefreshAtMs === "number" ? data.manualRefreshAtMs : null;
      if (lastManual !== null) manualRefreshAtByProject.set(doc.id, lastManual);
      if (typeof data?.generatedAtMs === "number") {
        generatedAtById.set(doc.id, data.generatedAtMs);
      }
      if (
        isCacheUsable(data ?? null, {
          windowKey: window.windowKey,
          gateEffectiveFrom,
          nowMs,
        })
      ) {
        hitById.set(doc.id, (data?.rows ?? []) as Array<Record<string, unknown>>);
      }
    }
    for (const projectId of missing) {
      const docId = buildTeamUsageCacheDocId(projectId, window.windowKey);
      const hit = hitById.get(docId);
      // 수동 새로고침이 너무 잦으면 캐시가 살아 있는 한 그걸 준다 —
      // 던지지 않는다(새로고침 버튼이 에러를 뱉는 것보다 낡은 값이 낫다).
      const throttled =
        args.forceRefresh &&
        !canManualRefresh(manualRefreshAtByProject.get(docId) ?? null, nowMs);
      if (hit && (!args.forceRefresh || throttled)) {
        if (throttled) refreshThrottled += 1;
        rows.push(...hit);
        cacheHits += 1;
        const cachedAt = generatedAtById.get(docId) ?? nowMs;
        oldestGeneratedAtMs = Math.min(oldestGeneratedAtMs, cachedAt);
        teamUsageMemoryCache.set(docId, {
          rows: hit,
          expiresAtMs: nowMs + TEAM_USAGE_MEMORY_TTL_SECONDS * 1000,
          generatedAtMs: cachedAt,
        });
      } else {
        stillMissing.push(projectId);
      }
    }
  }
  if (refreshThrottled > 0) {
    functions.logger.info("[teamUsage] 수동 새로고침 레이트리밋 — 캐시로 응답", {
      projects: refreshThrottled,
    });
  }

  if (stillMissing.length === 0) {
    return { ok: true, rows, cacheHits, oldestGeneratedAtMs };
  }

  // 창이 비었으면(발효일이 창보다 뒤) 질의하지 않는다 — 0행이 정답이다.
  if (window.fromDay >= window.toDayExclusive) {
    return { ok: true, rows, cacheHits, oldestGeneratedAtMs };
  }

  let fresh: Array<Record<string, unknown>>;
  try {
    const [bqRows] = await bigquery.query({
      query: buildTeamUsageDailyQuery(TEAM_USAGE_BQ_PROJECT_ID),
      params: {
        fromDay: window.fromDay,
        toDayExclusive: window.toDayExclusive,
        projectIds: stillMissing,
      },
      types: {
        fromDay: "DATE",
        toDayExclusive: "DATE",
        projectIds: ["STRING"],
      },
      location: BQ_LOCATION,
    });
    // ★받는 즉시 가명화한다. 이 줄 아래로 원시 uid 가 흐르지 않는다.
    fresh = toCacheRows(bqRows as TeamUsageDailyRow[], salt);
  } catch (err) {
    if (isBqViewMissingError(err)) {
      functions.logger.warn(
        "[teamUsage] 뷰가 없다 — 적재 전으로 응답한다(0 으로 그리지 않는다).",
        {
          projects: stillMissing.length,
          operatorReason: TEAM_USAGE_NOT_PROVISIONED_OPERATOR_NOTE,
        }
      );
      return { ok: false, notProvisioned: true, cacheHits, oldestGeneratedAtMs };
    }
    throw err;
  }

  const freshByProject = new Map<string, Array<Record<string, unknown>>>();
  for (const p of stillMissing) freshByProject.set(p, []);
  for (const row of fresh) {
    const pid = typeof row.project_id === "string" ? row.project_id : "";
    const bucket = freshByProject.get(pid);
    if (bucket) bucket.push(row);
  }

  const expiresAtMs = nowMs + TEAM_USAGE_CACHE_TTL_SECONDS * 1000;
  await Promise.all(
    [...freshByProject.entries()].map(async ([projectId, projectRows]) => {
      const docId = buildTeamUsageCacheDocId(projectId, window.windowKey);
      rows.push(...projectRows);
      teamUsageMemoryCache.set(docId, {
        rows: projectRows,
        expiresAtMs: nowMs + TEAM_USAGE_MEMORY_TTL_SECONDS * 1000,
        generatedAtMs: nowMs,
      });
      try {
        await db
          .collection(TEAM_USAGE_CACHE_COLLECTION)
          .doc(docId)
          .set({
            schemaVersion: TEAM_USAGE_CACHE_SCHEMA_VERSION,
            gateEffectiveFrom,
            windowKey: window.windowKey,
            generatedAtMs: nowMs,
            expiresAtMs,
            // 수동 새로고침 레이트리밋의 근거. 자동 재적재는 직전 값을 보존한다.
            manualRefreshAtMs: args.forceRefresh
              ? nowMs
              : manualRefreshAtByProject.get(docId) ?? null,
            // Firestore TTL 정책이 이 필드를 본다(자동 삭제).
            expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
            // ★숫자와 가명만. 표시명은 매 응답에 조립한다(캐시가 낡은 이름을
            //   붙들지 않고, 이름이 캐시에 남지도 않는다).
            rows: projectRows,
          });
      } catch (err) {
        // 캐시 쓰기 실패로 응답을 죽이지 않는다 — 다음 요청이 다시 시도한다.
        functions.logger.warn("[teamUsage] 캐시 쓰기 실패(응답은 계속)", {
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    })
  );

  if (teamUsageMemoryCache.size > TEAM_USAGE_MEMORY_CACHE_MAX) {
    teamUsageMemoryCache.clear();
  }
  return { ok: true, rows, cacheHits, oldestGeneratedAtMs };
}

/**
 * 귀속 불가 행의 **규모**. ★행 수만 — 금액·토큰은 뷰에 컬럼조차 없다.
 * 실패해도 화면을 죽이지 않는다(0 으로 두고 계속) — 이 값은 보조 라벨이다.
 */
async function loadUnattributedRows(
  accountUids: ReadonlyArray<string>,
  window: ReturnType<typeof computeUsageWindow>
): Promise<number> {
  const uids = [...new Set(accountUids)].filter((u) => u.trim() !== "");
  if (uids.length === 0 || window.fromDay >= window.toDayExclusive) return 0;
  try {
    const [rows] = await bigquery.query({
      query: buildUnattributedRowsQuery(TEAM_USAGE_BQ_PROJECT_ID),
      params: {
        fromDay: window.fromDay,
        toDayExclusive: window.toDayExclusive,
        accountUids: uids,
      },
      types: {
        fromDay: "DATE",
        toDayExclusive: "DATE",
        accountUids: ["STRING"],
      },
      location: BQ_LOCATION,
    });
    const raw = (rows as Array<{ rows_n?: unknown }>)[0]?.rows_n;
    const n = typeof raw === "string" ? Number(raw) : Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    functions.logger.warn("[teamUsage] 귀속불가 규모 조회 실패(0 으로 계속)", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return 0;
  }
}

/**
 * `getTeamUsageSummary` — 팀/본인 사용량 요약.
 *
 * Request:  `{ days?: number, projectIds?: string[], scope?: "team"|"self", refresh?: boolean }`
 * Response: `teamUsage.ts` 의 `TeamUsageSummary`(설계 §7).
 *
 * ★게이트가 닫힌 채로 배포해도 안전하다 — team 스코프는 `disabled` + 사유로
 *   태어나고 self 스코프만 동작한다. 그게 §5.1 설계의 목적이다.
 */
export const getTeamUsageSummary = functions.https.onCall(
  async (data, context) => {
    // ★신원의 출처는 이것 하나다. 클라 제어 헤더는 읽지 않는다.
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }
    const uid = context.auth.uid;
    const nowMs = Date.now();
    const rangeDays = parseAnalyticsDays(data, TEAM_USAGE_DEFAULT_RANGE_DAYS);
    const requestedProjectIds = parseProjectIdsParam(data);
    const wantRefresh =
      (data as { refresh?: unknown } | null | undefined)?.refresh === true;

    const gate = resolveTeamUsageGate();
    const salt = readAnalyticsIdSalt();

    // ★Admin SDK 는 룰을 우회한다 — 역할을 서버가 직접 조회해 판정한다.
    const projects = await resolveTeamProjects(uid);
    const teamEligible = projects.filter((p) => canSeeTeamBreakdown(p.role));
    const { scope, downgradedReasonCode } = resolveUsageScope(
      (data as { scope?: unknown } | null | undefined)?.scope,
      teamEligible.length > 0
    );

    // ★클라 입력은 **교집합 필터**로만 쓴다. 확장은 불가능하다.
    const candidates = scope === "team" ? teamEligible : projects;
    // ★상한은 여기 한 곳에서만 적용하고, **잘린 개수를 센다.** 조용히 자르면
    //   합계가 전체의 합이 아닌데도 화면이 "이게 전부" 라고 말한다.
    const { ids: scopeIds, omitted: projectsOmitted } = capProjectScope(
      intersectProjectScope(
        requestedProjectIds,
        candidates.map((p) => p.projectId)
      )
    );
    if (projectsOmitted > 0) {
      functions.logger.warn("[teamUsage] 프로젝트 상한 초과 — 합계가 전체가 아니다", {
        omitted: projectsOmitted,
        max: TEAM_USAGE_MAX_PROJECTS_IN_SCOPE,
      });
    }
    const inScope = candidates.filter((p) => scopeIds.includes(p.projectId));

    let baseWindow = computeUsageWindow(nowMs, rangeDays);
    let scopeNoteCode = downgradedReasonCode;

    // ── 게이트: 닫혔으면 **질의 자체를 하지 않는다** ─────────────────────────
    if (scope === "team" && !gate.open) {
      if (!teamUsageGateWarned) {
        teamUsageGateWarned = true;
        // ★조치가 있는 쪽은 운영자다. 오너 화면에는 gate.reason 만 나간다.
        functions.logger.warn("[teamUsage] 팀 스코프 게이트 닫힘", {
          reasonCode: gate.reasonCode,
          operatorReason: gate.operatorReason,
        });
      }
      return buildTeamUsageEnvelope({
        scope: "team",
        scopeNoteCode,
        window: baseWindow,
        generatedAtMs: nowMs,
        gate,
        projectsInScope: inScope.length,
        projectsOmitted,
        cache: { hit: false, ageSeconds: 0, ttlSeconds: TEAM_USAGE_CACHE_TTL_SECONDS },
        folded: null,
      });
    }

    // 팀 스코프는 게이트 상한으로 창을 자른다(경계 포함). self 는 게이트 밖이다.
    if (scope === "team" && gate.open) {
      baseWindow = clampWindowToGate(baseWindow, gate.effectiveFrom);
    }

    if (scopeIds.length === 0) {
      // ★존재 여부를 말하지 않는다 — "권한 없음" 이 아니라 "볼 게 없다" 로 끝난다.
      return buildTeamUsageEnvelope({
        scope,
        scopeNoteCode: scopeNoteCode ?? "no_team_scope",
        window: baseWindow,
        generatedAtMs: nowMs,
        gate,
        projectsInScope: 0,
        cache: { hit: false, ageSeconds: 0, ttlSeconds: TEAM_USAGE_CACHE_TTL_SECONDS },
        folded: null,
      });
    }

    // ── 명부 ────────────────────────────────────────────────────────────────
    // 행이 없는 멤버도 0 으로 그리려면 명부가 필요하다(설계 §7 화면규칙 4).
    const rosterUids =
      scope === "team"
        ? [
            ...new Set(
              inScope.flatMap((p) => [p.ownerId, ...p.members]).filter((u) => u !== "")
            ),
          ]
        : [uid];

    let rows: Array<Record<string, unknown>> = [];
    let cacheHits = 0;
    let notProvisioned = false;
    let dataGeneratedAtMs = nowMs;

    if (scope === "team") {
      const out = await loadTeamUsageRows({
        projectIds: scopeIds,
        window: baseWindow,
        gateEffectiveFrom: gate.open ? gate.effectiveFrom : null,
        salt,
        nowMs,
        forceRefresh: wantRefresh,
      });
      cacheHits = out.cacheHits;
      dataGeneratedAtMs = out.oldestGeneratedAtMs;
      if (out.ok) rows = out.rows;
      else notProvisioned = out.notProvisioned;
    } else if (baseWindow.fromDay < baseWindow.toDayExclusive) {
      // ★self 는 캐시하지 않는다. 캐시 키에 계정을 넣어야 하는데, 그러면 캐시
      //   문서 id 에 계정 식별자가 남는다 — §5.4 의 "캐시 doc 에 uid 없음" 을
      //   어기는 길이다. self 질의는 단일 계정이라 스캔도 작다.
      try {
        const [bqRows] = await bigquery.query({
          query: buildSelfUsageDailyQuery(TEAM_USAGE_BQ_PROJECT_ID),
          params: {
            fromDay: baseWindow.fromDay,
            toDayExclusive: baseWindow.toDayExclusive,
            accountUid: uid,
            projectIds: scopeIds,
          },
          types: {
            fromDay: "DATE",
            toDayExclusive: "DATE",
            accountUid: "STRING",
            projectIds: ["STRING"],
          },
          location: BQ_LOCATION,
        });
        rows = toCacheRows(bqRows as TeamUsageDailyRow[], salt);
      } catch (err) {
        if (isBqViewMissingError(err)) notProvisioned = true;
        else throw err;
      }
    }

    if (notProvisioned) {
      return buildTeamUsageEnvelope({
        scope,
        scopeNoteCode,
        window: baseWindow,
        generatedAtMs: nowMs,
        gate,
        projectsInScope: inScope.length,
        projectsOmitted,
        cache: { hit: false, ageSeconds: 0, ttlSeconds: TEAM_USAGE_CACHE_TTL_SECONDS },
        folded: null,
        notProvisioned: true,
      });
    }

    // ── 라벨 조립 ───────────────────────────────────────────────────────────
    // ★가명 → 표시명. uid 로 조회하고 **가명으로 키를 바꿔** 넘긴다 — 접기 단계
    //   아래로 uid 가 흐르지 않는다.
    const includeMemberBreakdown = scope === "team";
    const displayNames = new Map<string, string | null>();
    const rosterMemberKeys: string[] = [];
    if (includeMemberBreakdown) {
      const names = await resolveMemberDisplayNames(rosterUids);
      for (const memberUid of rosterUids) {
        const key = teamMemberKey(memberUid, salt);
        if (key === null) continue;
        rosterMemberKeys.push(key);
        displayNames.set(key, names.get(memberUid) ?? null);
      }
    }

    const projectNames = new Map<string, string | null>(
      inScope.map((p) => [p.projectId, p.name])
    );

    const unattributedRows = await loadUnattributedRows(rosterUids, baseWindow);

    const folded = foldCachedTeamUsage(rows, {
      todayUtc: baseWindow.todayUtc,
      includeMemberBreakdown,
      // ★잘린 스코프 위에서는 "기록 없음" 을 단정하지 않는다(오탐 방지).
      scopeTruncated: projectsOmitted > 0,
      displayNames,
      projectNames,
      rosterMemberKeys,
      unattributedRows,
    });

    // ★self 로 내려온 이유가 따로 없으면 "멤버는 자기 것만 본다" 를 붙인다 —
    //   화면이 "왜 팀 총계가 없지" 를 스스로 답하게.
    if (scope === "self" && scopeNoteCode === null) {
      scopeNoteCode = "member_self_only";
    }

    return buildTeamUsageEnvelope({
      scope,
      scopeNoteCode,
      window: baseWindow,
      // ★가장 오래된 조각 기준. 낙관적으로 반올림하면 화면이 거짓말한다.
      generatedAtMs: dataGeneratedAtMs,
      gate,
      projectsInScope: inScope.length,
      projectsOmitted,
      cache: {
        hit: cacheHits > 0,
        // ★"N분 전 기준" 을 화면이 정직하게 그리게 한다.
        ageSeconds: Math.max(0, Math.round((nowMs - dataGeneratedAtMs) / 1000)),
        ttlSeconds: TEAM_USAGE_CACHE_TTL_SECONDS,
      },
      folded,
    });
  }
);

// ── ★수익 탭 읽기 경로 — "실매출 0" 과 "적재 전" 을 가른다 ──────────────────
// 이 콜러블이 없던 동안 수익 탭은 MRR 칸에 '적재 전' 만 띄웠다. 이제 표가
// 채워지므로 읽어 온다. ★다만 **0 을 그냥 그리지 않는다**: 표가 없으면
// '적재 전', 표가 있고 외부 매출 행이 0 이면 **정확한 0** 이다. 그 둘은 완전히
// 다른 뜻이고 지금 상황에서는 그 구분이 이 화면의 전부다.
//
// 응답에는 건수·합계만 담는다 — uid·이메일·주문번호·개별 행은 내리지 않는다.

/** 어드민 수익 탭이 읽는 요약. 금액은 합계뿐이고 개별 행은 없다. */
interface PurchaseSummaryResponse {
  generatedAt: string;
  /**
   * `not_ingested` — 표 자체가 없다(적재 전). 화면은 0 을 그리면 안 된다.
   * `ingested` — 표가 있다. 그 아래 숫자는 **진짜 숫자**다(0 이면 0 이다).
   */
  state: "not_ingested" | "ingested";
  /** state 가 not_ingested 인 이유. ingested 면 null. */
  reason: string | null;
  revenue: {
    /** ★실매출(외부 고객). state=ingested 면 0 도 정확한 0 이다. */
    externalKrw: number;
    externalRows: number;
    /** 매출에서 뺐지만 **화면에 보여야 하는** 내부(운영자) 결제 건수. */
    internalRows: number;
    /** 무상 부여(founder_grant) 건수. 매출은 아니지만 경영 정보다. */
    grantRows: number;
    /** 계정 성격 미분류 — 표식 이전 적재분이거나 운영자 축 미설정. */
    unclassifiedRows: number;
    /** 금액 미상 행(환불·해지·부여). 0 으로 읽히면 안 되는 수. */
    amountUnknownRows: number;
    totalRows: number;
  } | null;
  /** ★기준 라벨. "기준 라벨 없는 숫자 금지" 규약 — 숫자와 함께 화면에 뜬다. */
  basis: string;
  /** 축 한계 고지. 화면이 숫자 위에 그대로 띄운다. */
  notes: string[];
}

/** 매출 합산 기준을 한 문장으로. 화면이 이 문자열을 숫자 옆에 그대로 쓴다. */
const PURCHASE_BASIS_LABEL =
  `전 기간 · analytics_purchase · account_class='${REVENUE_ACCOUNT_CLASS}' · ` +
  `amount_known=true · kind ∈ {${REVENUE_KINDS.join(", ")}}`;

export const getAdminPurchaseSummary = functions.https.onCall(
  async (_data, context) => {
    requireAdmin(context);
    const generatedAt = new Date().toISOString();
    const notes: string[] = [];

    // 표가 있는지, 그리고 account_class 컬럼이 이미 붙었는지 먼저 본다.
    // ★컬럼이 없는 표에 그 컬럼을 쓰는 질의를 던지면 통째로 실패한다(웹 선배포
    //   / 적재 1회 전 상태). 그때 빨간 에러가 아니라 "미분류" 로 접어야 화면이
    //   거짓말을 하지 않는다.
    let liveColumns: Set<string>;
    try {
      const [meta] = await bigquery
        .dataset(BQ_DATASET)
        .table(ANALYTICS_PURCHASE_TABLE)
        .getMetadata();
      liveColumns = new Set(
        ((meta?.schema?.fields ?? []) as { name: string }[]).map((f) => f.name)
      );
    } catch (err) {
      functions.logger.info("[analytics_purchase] summary: table missing", {
        message: safeAnalyticsErrorMessage(err),
      });
      const out: PurchaseSummaryResponse = {
        generatedAt,
        state: "not_ingested",
        reason:
          `${ANALYTICS_PURCHASE_TABLE} 테이블이 없다 — 아직 한 번도 적재되지 ` +
          `않았다. 여기 0 을 그리면 '아무도 결제하지 않았다' 로 읽히는데 그건 ` +
          `데이터가 아니라 배선이 없는 것이다.`,
        revenue: null,
        basis: PURCHASE_BASIS_LABEL,
        notes,
      };
      return out;
    }

    const hasClass = liveColumns.has("account_class");
    if (!hasClass) {
      notes.push(
        "★account_class 컬럼이 아직 표에 없다(적재 1회 전). 모든 행을 " +
          "'미분류' 로 센다 — 내부 결제를 매출로 올리지 않기 위해서다."
      );
    }
    // 컬럼이 없으면 external 조건이 성립할 수 없다 → 매출 0 + 전량 미분류.
    const classExpr = hasClass ? "account_class" : "CAST(NULL AS STRING)";
    const revenueCond =
      `${classExpr} = @revenueClass AND amount_known ` +
      `AND kind IN UNNEST(@revenueKinds)`;

    const query = `
SELECT
  COUNT(*) AS totalRows,
  COUNTIF(${revenueCond}) AS externalRows,
  COALESCE(SUM(IF(${revenueCond}, amount, 0)), 0) AS externalKrw,
  COUNTIF(${classExpr} = 'internal') AS internalRows,
  COUNTIF(kind = 'grant') AS grantRows,
  COUNTIF(${classExpr} IS NULL) AS unclassifiedRows,
  COUNTIF(NOT amount_known) AS amountUnknownRows
FROM \`${BQ_DATASET}.${ANALYTICS_PURCHASE_TABLE}\``;

    const [rows] = await bigquery.query({
      query,
      params: {
        revenueClass: REVENUE_ACCOUNT_CLASS,
        revenueKinds: REVENUE_KINDS as string[],
      },
      location: BQ_LOCATION,
    });
    const r = (rows?.[0] ?? {}) as Record<string, number | string | undefined>;
    const revenue = {
      // NUMERIC 은 Big 객체로 오므로 String() 을 거쳐 숫자로 만든다.
      externalKrw: toNumber(String(r.externalKrw ?? 0)),
      externalRows: toNumber(r.externalRows),
      internalRows: toNumber(r.internalRows),
      grantRows: toNumber(r.grantRows),
      unclassifiedRows: toNumber(r.unclassifiedRows),
      amountUnknownRows: toNumber(r.amountUnknownRows),
      totalRows: toNumber(r.totalRows),
    };

    if (revenue.totalRows === 0) {
      notes.push(
        "★표는 있는데 행이 0 이다 — 적재가 아직 한 번도 성공하지 않았거나 " +
          "결제 원장이 비어 있다. 아래 매출 0 은 그 두 경우를 구분하지 못한다."
      );
    }
    if (revenue.internalRows > 0) {
      notes.push(
        `내부(운영자) 계정 ${revenue.internalRows}건을 매출에서 뺐다 — ` +
          "지운 게 아니라 가른 것이라 건수는 그대로 보인다."
      );
    }
    if (revenue.amountUnknownRows > 0) {
      notes.push(
        `금액 미상 ${revenue.amountUnknownRows}건(환불·해지·무상부여). ` +
          "미상은 0 이 아니라서 순매출은 아직 계산할 수 없다."
      );
    }

    const out: PurchaseSummaryResponse = {
      generatedAt,
      state: "ingested",
      reason: null,
      revenue,
      basis: PURCHASE_BASIS_LABEL,
      notes,
    };
    return out;
  }
);

// ════════════════════════════════════════════════════════════════════════════
// GA4 리전 브리지 — asia-northeast3 → US 사용자당 1행 (티켓 Th9VRMvm2HkyWSjwF12X)
// ════════════════════════════════════════════════════════════════════════════
//
// 설계·근거(귀속 소스 선택 포함): v3/docs/ga4-region-bridge-2026-08-21.md
// 순수 로직(SQL 조립·정규화·중복제거)은 전부 ga4Bridge.ts 에 있고, 여기서는
// BigQuery I/O 와 실패 격리만 한다.
//
// ★GA4 전체를 복사하지 않는다. GA4 쪽(서울)에서 **먼저 방문자당 1행으로 집계**
//   하고 그 결과만 US 로 옮긴다. 옮기는 조인키도 원시 user_pseudo_id 가 아니라
//   HMAC 가명(gaKey)이다 — GA4 원문 이벤트도, 원시 GA4 식별자도 US 로 넘어가지
//   않는다.
// ★기존 getAdminCountryFunnel 의 메모리 조인은 **그대로 둔다.** 브리지가 첫
//   적재 전이거나 실패해도 화면이 죽지 않아야 한다. 브리지는 SQL 조인이 필요한
//   분석(코호트·리텐션·BQML)을 열어 주는 쪽이고, 둘을 한 번에 바꾸면 회귀
//   원인을 가릴 수 없다.

const BQ_PROJECT = "marblo-2253d";

/** insert 요청 하나당 행 수. BQ streaming insert 요청 크기 한계 회피용. */
const GA4_BRIDGE_INSERT_CHUNK = 500;

/** 기존 ga_key 조회를 한 번에 던지는 후보 수. */
const GA4_BRIDGE_KEY_LOOKUP_CHUNK = 5000;

let ga4BridgeTableReady = false;

/** 동기화 1회 결과. 콜러블 응답 겸 스케줄 로그. */
interface Ga4BridgeSyncResult {
  rangeDays: number;
  /** GA4 에서 읽은 방문자 행 수(집계 후). */
  scanned: number;
  /** 그중 조인키로 쓸 수 있는 행(형식 검증 + 가명 파생 성공). */
  eligible: number;
  /** 실제로 US 브리지에 새로 적재된 행. */
  inserted: number;
  /** 이미 브리지에 있어 건너뛴 행 — first-touch 는 덮지 않는다. */
  skippedExisting: number;
  /** collected_traffic_source 를 못 읽어 content/term 이 null 로 간 경우. */
  collectedTrafficSourceAvailable: boolean;
  notes: string[];
}

/**
 * 브리지 테이블 보장. ensureAttributionTable 과 **같은 규약**이다 —
 * 없으면 만들고, 있으면 **NULLABLE 컬럼만 덧붙인다**. 컬럼을 코드에만 추가하고
 * BQ 를 두면 insert 가 `no such field` 로 통째로 죽는다.
 *
 * 파티션은 `firstVisitDate`(유입 코호트 축, 분석이 실제로 거는 조건),
 * 클러스터는 `gaKey`(조인 축).
 */
async function ensureGa4BridgeTable(): Promise<void> {
  if (ga4BridgeTableReady) return;
  const dataset = bigquery.dataset(BQ_DATASET);
  const table = dataset.table(GA4_BRIDGE_TABLE);
  const [exists] = await table.exists();
  if (!exists) {
    await table.create({
      schema: GA4_BRIDGE_SCHEMA as unknown as {
        name: string;
        type: string;
      }[],
      timePartitioning: { type: "DAY", field: "firstVisitDate" },
      clustering: { fields: ["gaKey"] },
    });
    functions.logger.info("[ga4Bridge] created bridge table", {
      table: GA4_BRIDGE_TABLE,
    });
    ga4BridgeTableReady = true;
    return;
  }

  const [metadata] = await table.getMetadata();
  const live: { name: string }[] = metadata?.schema?.fields ?? [];
  const liveNames = new Set(live.map((f) => f.name));
  const additive = GA4_BRIDGE_SCHEMA.filter(
    (f) => !liveNames.has(f.name) && f.mode === "NULLABLE"
  );
  if (additive.length > 0) {
    await table.setMetadata({ schema: { fields: [...live, ...additive] } });
    functions.logger.info("[ga4Bridge] schema columns added", {
      added: additive.map((f) => f.name),
    });
  }
  ga4BridgeTableReady = true;
}

/**
 * 뷰 하나를 만들거나(없으면) 정의를 최신으로 맞춘다(있으면).
 *
 * ★기존 객체가 **뷰가 아니면 건드리지 않고 던진다.** 이유는 가정이 아니라
 *   실측이다(2026-08-21): `analytics_identity` 라는 이름이 이미 다른
 *   파이프라인의 살아있는 TABLE 로 `marblo_telemetry` 에 있었다. 그때의
 *   구현은 `exists()` 만 보고 곧장 `setMetadata({view})` 로 갔는데, 그건
 *   **남의 표를 뷰로 덮으려는 요청**이다. 우리 뷰 이름은 이제 충돌하지
 *   않지만(ga4_install_identity), 이름은 언제든 다시 겹칠 수 있으므로
 *   규율을 주석이 아니라 코드로 세운다 — 뷰가 아닌 것은 절대 덮지 않는다.
 */
async function ensureView(name: string, query: string): Promise<void> {
  const dataset = bigquery.dataset(BQ_DATASET);
  const table = dataset.table(name);
  const [exists] = await table.exists();
  if (!exists) {
    await dataset.createTable(name, { view: { query, useLegacySql: false } });
    functions.logger.info("[ga4Bridge] created view", { view: name });
    return;
  }

  const [metadata] = await table.getMetadata();
  if (metadata?.type !== "VIEW") {
    // 이름만 남기고 내용은 남기지 않는다 — 남의 표 스키마를 로그로 흘리지 않는다.
    throw new Error(
      `refusing to overwrite existing ${String(
        metadata?.type ?? "UNKNOWN"
      )} "${name}" with a view; pick a different view name`
    );
  }
  await table.setMetadata({ view: { query, useLegacySql: false } });
}

/**
 * 브리지의 정본 읽기 뷰를 보장한다.
 *
 * - `ga4_first_touch_current` — `gaKey` 당 가장 이른 유입 1행.
 *
 * ★신원 뷰는 만들지 않는다. 조인 상대인 `analytics_identity`(익명축:
 *   `install_key` ↔ `ga_key`)는 사람 축 작업에서 이미 착지했고, 그쪽 백필이
 *   우리와 **같은 kind·같은 솔트**로 `ga_key` 를 파생한다(ga4Bridge.ts 의
 *   ANALYTICS_IDENTITY_TABLE 주석 참조). 신원표를 두 벌 만들면 익명축 조인이
 *   에러 없이 갈라진다 — 그래서 브리지는 표 한 장만 얹는다.
 */
async function ensureGa4BridgeViews(): Promise<void> {
  await ensureView(
    GA4_BRIDGE_CURRENT_VIEW,
    buildBridgeCurrentViewSql({ project: BQ_PROJECT, dataset: BQ_DATASET })
  );
}

/** 후보 ga_key 중 이미 브리지에 있는 것을 돌려준다(청크로 나눠 조회). */
async function readExistingBridgeKeys(
  keys: readonly string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  if (keys.length === 0) return found;
  const sql = buildExistingKeysQuery({
    project: BQ_PROJECT,
    dataset: BQ_DATASET,
  });
  for (const chunk of chunkRows(keys, GA4_BRIDGE_KEY_LOOKUP_CHUNK)) {
    const [rows] = await bigquery.query({
      query: sql,
      params: { keys: chunk },
      types: { keys: ["STRING"] },
      location: BQ_LOCATION,
    });
    for (const r of rows as { gaKey?: unknown }[]) {
      if (typeof r.gaKey === "string") found.add(r.gaKey);
    }
  }
  return found;
}

/**
 * GA4(서울) 집계 → US 브리지 적재. 한 번 돌 때 하는 일 전부.
 *
 * ★조회창(`days`)은 스케줄에서 짧다(기본 3일). 그래서 **최초 1회는 반드시
 *   백필**(syncGa4Bridge 콜러블에 days=400)을 돌려야 한다. 안 그러면 창 밖에
 *   첫 방문이 있던 사람의 first-touch 가 창 안 값으로 잘못 잡힌다. 나중에
 *   백필을 돌려도 `ga4_first_touch_current` 뷰가 **더 이른 유입을 우선**하므로
 *   자가 치유된다.
 */
async function syncGa4BridgeInternal(
  rangeDays: number
): Promise<Ga4BridgeSyncResult> {
  const notes: string[] = [];

  // GA4 데이터셋 이름은 SQL 에 그대로 박히므로 화이트리스트를 강제한다.
  if (!isSafeBqIdentifier(GA4_BQ_DATASET)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "GA4_BQ_DATASET is not a valid BigQuery identifier"
    );
  }

  // ★솔트가 없으면 **아무것도 적재하지 않는다.** 원시 GA4 client_id 로 폴백해
  //   US 에 적재하는 건 이 설계의 전제(원시 식별자는 리전을 넘지 않는다)를
  //   조용히 깨는 것이다. 시끄럽게 실패한다.
  const salt = getAnalyticsIdSalt();
  if (!salt) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `${ANALYTICS_ID_SALT_ENV} is not configured; refusing to write raw GA4 identifiers to US`
    );
  }

  // GA4 집계 — collected_traffic_source 는 비교적 최근 export 스키마에만 있다.
  // 참조가 실패하면 그 컬럼 없이 1회 재시도한다. **컬럼을 빼는 게 아니라**
  // content/term 이 null 로 가는 것이고, 그 사실을 note 로 드러낸다.
  let collectedAvailable = true;
  let sourceRows: Ga4BridgeSourceRow[];
  try {
    const [rows] = await bigquery.query({
      query: buildGa4FirstTouchQuery({
        project: BQ_PROJECT,
        dataset: GA4_BQ_DATASET,
        includeCollectedTrafficSource: true,
      }),
      params: { days: rangeDays },
      location: GA4_BQ_LOCATION,
    });
    sourceRows = rows as Ga4BridgeSourceRow[];
  } catch (e) {
    collectedAvailable = false;
    functions.logger.warn("[ga4Bridge] collected_traffic_source unavailable", {
      message: safeAnalyticsErrorMessage(e),
    });
    const [rows] = await bigquery.query({
      query: buildGa4FirstTouchQuery({
        project: BQ_PROJECT,
        dataset: GA4_BQ_DATASET,
        includeCollectedTrafficSource: false,
      }),
      params: { days: rangeDays },
      location: GA4_BQ_LOCATION,
    });
    sourceRows = rows as Ga4BridgeSourceRow[];
    notes.push(
      "GA4 export 에서 collected_traffic_source 를 읽지 못했다 — content/term 은 이번 적재분에서 null 이다(컬럼은 그대로 있다)."
    );
  }

  if (sourceRows.length >= GA4_SYNC_ROW_LIMIT) {
    notes.push(
      `GA4 방문자가 상한 ${GA4_SYNC_ROW_LIMIT.toLocaleString()}행에서 잘렸다 — 이번 적재분은 전량이 아니다.`
    );
  }

  const syncedAt = new Date().toISOString();
  const candidates: Ga4BridgeRow[] = [];
  for (const raw of sourceRows) {
    // 형식이 틀린 client_id 는 조인키가 될 수 없다 — 쓰레기가 들어가면
    // 매칭률 지표 자체를 못 믿게 된다(installAttribution 과 같은 규약).
    if (!isGaClientId(raw.gaClientId)) continue;
    const gaKey = deriveGaKey(raw.gaClientId, salt);
    if (!gaKey) continue;
    candidates.push(toBridgeRow(raw, gaKey, syncedAt));
  }

  await ensureGa4BridgeTable();
  const existing = await readExistingBridgeKeys(candidates.map((r) => r.gaKey));
  const fresh = selectNewBridgeRows(candidates, existing);

  for (const chunk of chunkRows(fresh, GA4_BRIDGE_INSERT_CHUNK)) {
    await bigquery.dataset(BQ_DATASET).table(GA4_BRIDGE_TABLE).insert(chunk);
  }

  // 뷰는 적재 뒤에 보장한다 — 테이블이 먼저 있어야 뷰가 컴파일된다.
  await ensureGa4BridgeViews();

  if (fresh.length === 0 && candidates.length > 0) {
    notes.push(
      "새로 적재된 방문자가 없다 — 이번 창의 방문자는 전부 이미 브리지에 있다(first-touch 는 덮지 않는다)."
    );
  }

  return {
    rangeDays,
    scanned: sourceRows.length,
    eligible: candidates.length,
    inserted: fresh.length,
    skippedExisting: candidates.length - fresh.length,
    collectedTrafficSourceAvailable: collectedAvailable,
    notes,
  };
}

/**
 * 일 1회 동기화. GA4 일별 export 는 D+1 이라 새벽에 돈다(어제치가 확정된 뒤).
 * 실패해도 던지지 않는다 — 다음 날 창이 겹치므로 자동으로 따라잡는다.
 */
export const scheduledSyncGa4Bridge = functions.pubsub
  .schedule("30 5 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    try {
      const result = await syncGa4BridgeInternal(GA4_SYNC_DEFAULT_DAYS);
      functions.logger.info("[ga4Bridge] sync ok", {
        scanned: result.scanned,
        inserted: result.inserted,
        skippedExisting: result.skippedExisting,
      });
    } catch (e) {
      // 값은 남기지 않는다 — 사유만.
      functions.logger.error("[ga4Bridge] sync failed", {
        message: safeAnalyticsErrorMessage(e),
      });
    }
    return null;
  });

/**
 * 수동 트리거(어드민) — **최초 백필**과 스케줄 실패 복구용.
 * 배포 직후 1회 `{ days: 400 }` 으로 돌려 전 구간을 덮어야 한다.
 */
export const syncGa4Bridge = functions
  .runWith(ADMIN_ANALYTICS_RUNTIME_OPTIONS)
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const rangeDays = parseSyncDays((data as { days?: unknown })?.days);
    return syncGa4BridgeInternal(rangeDays);
  });

// ═══════════════════════════════════════════════════════════════════
// GitHub App 자동상속 (티켓 ddbN2KvxHZ08rakiVfL0)
//
// 설계: v3/docs/github-app-installation-inheritance-design-2026-08-21.md (#1092)
//
// ★역할 경계 — App 은 인증이 아니다(설계 §2). device OAuth 가 "너는 누구인가"
// 를 답하고, App 은 "이 저장소를 읽어도 되는가" 를 답한다. 그래서 여기서
// 발급하는 것은 사용자 신원이 아니라 **저장소 1개 · contents:read · 1시간** 짜리
// installation 토큰이다.
//
// ★토큰 규율(설계 §5-B2/B4):
//   - private key 는 **여기(서버)에만** 있다. Electron 에 절대 넣지 않는다.
//   - App JWT·installation 토큰을 로그·Firestore 어디에도 남기지 않는다.
//   - 발급 토큰은 콜러블 응답에 한 번 실려 나가고 끝. 서버는 저장하지 않는다.
//   - 감사 기록은 githubApp.buildAuditEntry 가 만든 항목뿐이다(토큰 필드 없음).
//
// ★기존 사용자 회귀 0(설계 §6): 여기서 실패·거부가 나면 클라이언트는
// device 경로로 내려간다. 어느 경로도 **기존 동작을 막지 않는다** — installation
// 이 없는 프로젝트는 이 함수를 호출조차 하지 않는다.
// ═══════════════════════════════════════════════════════════════════

const GITHUB_APP_ID = process.env.GITHUB_APP_ID || "";
const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG || "";
// ★PEM 원문. 절대 로그·응답에 싣지 않는다. 존재 여부만 판정한다.
const GITHUB_APP_PRIVATE_KEY_RAW = process.env.GITHUB_APP_PRIVATE_KEY || "";
const GITHUB_APP_SETUP_STATE_SECRET =
  process.env.GITHUB_APP_SETUP_STATE_SECRET || "";

/** 설치 콜백 state nonce 보관소 — 서버 전용(클라 룰 미매치 = 기본 거부). */
const GITHUB_APP_SETUP_STATES = "github_app_setup_states";
/**
 * 저장소 접근 감사 원장 — 서버 전용.
 *
 * ★기존 `audit_logs`(MCP 툴 원장, electron/mcp-server/ledger.ts 스키마)에
 * 섞지 않는다. 그 컬렉션은 `{agentId, toolName, params, duration}` 형태라
 * 서버 이벤트를 넣으면 감사 뷰의 에이전트 워크로드 집계가 오염된다. 목적
 * (사람별 저장소 접근 기록)은 같고 그릇만 분리한다.
 */
const GITHUB_APP_ACCESS_LOGS = "github_app_access_logs";

/** App 이 아직 등록되지 않았으면(=env 미설정) 기능 전체가 잠들어 있다. */
function githubAppConfigured(): boolean {
  return (
    !!GITHUB_APP_ID &&
    !!githubAppPrivateKey() &&
    !!GITHUB_APP_SETUP_STATE_SECRET
  );
}

function githubAppPrivateKey(): string | null {
  return normalizePrivateKeyPem(GITHUB_APP_PRIVATE_KEY_RAW);
}

/** 요청 시마다 즉석 생성. 반환값을 로그·저장하지 않는다(설계 §3.3). */
function githubAppJwt(): string {
  const pem = githubAppPrivateKey();
  if (!pem) throw new Error("GitHub App private key is not configured");
  return buildAppJwt({
    appId: GITHUB_APP_ID,
    privateKeyPem: pem,
    nowSec: Math.floor(Date.now() / 1000),
  });
}

interface GitHubApiResult {
  status: number;
  body: unknown;
}

/**
 * App JWT 로 GitHub API 호출. **응답 본문을 로그에 남기지 않는다** — 발급
 * 엔드포인트의 본문에는 토큰이 들어 있다. 남기는 것은 status 뿐이다.
 */
async function githubAppApi(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<GitHubApiResult> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${githubAppJwt()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": "marblo-app",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** 감사 기록 — fail-soft. 원장 write 실패가 발급을 막지 않는다. */
async function recordGitHubAppAccess(entry: {
  uid: string;
  projectId: string;
  slug: RepoSlug | null;
  installationId: string | null;
  outcome: "issued" | "denied" | "error";
  reason: string | null;
  /** ★v2 — GitHub 쪽 push 이벤트가 `marblo[bot]` 으로 뭉개지는 만큼, "누가
   *  어떤 역할로 write 를 받아 갔나" 는 이 원장이 답한다. */
  role?: ProjectRole | null;
  access?: RepoAccess | null;
  branch?: string | null;
}): Promise<void> {
  try {
    const row = buildAuditEntry({ ...entry, nowMs: Date.now() });
    await db.collection(GITHUB_APP_ACCESS_LOGS).add({
      ...row,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    functions.logger.warn(
      "[githubApp] access log write failed (non-fatal)",
      err instanceof Error ? err.message : "unknown"
    );
  }
}

function projectSnapshotForIssue(
  snap: admin.firestore.DocumentSnapshot
): ProjectSnapshotForIssue {
  const data = snap.exists ? snap.data() || {} : {};
  const members = Array.isArray(data.members)
    ? data.members.filter((m: unknown): m is string => typeof m === "string")
    : [];
  return {
    exists: snap.exists,
    ownerId: typeof data.ownerId === "string" ? data.ownerId : null,
    members,
    githubInstallationId: data.githubInstallationId,
    gitRemoteUrl: data.gitRemoteUrl,
  };
}

/** 프로젝트 **오너**의 유효 플랜. enforceProjectLimit 과 같은 규율. */
async function ownerEntitledPlan(ownerId: string | null): Promise<string> {
  if (!ownerId) return "free";
  const subSnap = await db.collection("subscriptions").doc(ownerId).get();
  const sub = subSnap.exists ? subSnap.data() || {} : {};
  return resolveEntitledPlan(
    {
      status: typeof sub.status === "string" ? sub.status : null,
      planType: typeof sub.planType === "string" ? sub.planType : null,
      currentPeriodEndMs: tsToMillis(sub.currentPeriodEnd),
    },
    Date.now()
  );
}

/**
 * ★역할 조회 — `memberRoles/{projectId}_{uid}` (티켓 DbAZ5C6gbO6nWNx9FZ4Q 가
 * 도입한 컬렉션 그대로). 새 권한 개념을 만들지 않는다.
 *
 * 문서가 없으면 undefined 를 돌려주고, `normalizeMemberRole` 이
 * firestore.rules 의 `getMemberRole` 과 **같은 기본값**(member)으로 접는다.
 * 조회 실패는 던진다 — 실패를 member 로 접으면 viewer 가 write 를 받는다.
 */
async function readMemberRoleValue(
  projectId: string,
  uid: string
): Promise<unknown> {
  const snap = await db
    .collection("memberRoles")
    .doc(`${projectId}_${uid}`)
    .get();
  return snap.exists ? (snap.data() || {}).role : undefined;
}

/** 요청이 원하는 접근 수준. 생략·모르는 값은 read(= v1 동작). */
function requestedRepoAccess(data: unknown): RepoAccess {
  const raw =
    data && typeof data === "object"
      ? (data as { access?: unknown }).access
      : undefined;
  return raw === "write" ? "write" : "read";
}

/** write 요청이 밀려는 ref. 판정은 evaluatePushRef 가 한다. */
function requestedPushRef(data: unknown): unknown {
  return data && typeof data === "object"
    ? (data as { ref?: unknown }).ref
    : undefined;
}

function requireProjectId(data: unknown): string {
  const raw =
    data && typeof data === "object"
      ? (data as { projectId?: unknown }).projectId
      : undefined;
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "projectId 가 필요합니다."
    );
  }
  return raw;
}

/**
 * 설치 시작 — **오너만** 호출할 수 있다(설계 §3.1 [2]).
 *
 * 서명된 state nonce 를 발급해 GitHub 설치 URL 을 돌려준다. nonce 는 uid·
 * projectId 에 바인딩되고 10분 뒤 만료되며, 콜백에서 **1회만** 소비된다.
 * 그래서 남이 자기 설치를 남의 프로젝트에 붙일 수 없다.
 */
export const startGitHubAppInstall = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    if (!githubAppConfigured() || !GITHUB_APP_SLUG) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "GitHub App 이 아직 설정되지 않았습니다."
      );
    }
    const uid = context.auth.uid;
    const projectId = requireProjectId(data);

    const snap = await db.collection("projects").doc(projectId).get();
    const project = projectSnapshotForIssue(snap);
    // ★오너만. 멤버가 설치를 바인딩하면 오너가 모르는 사이 저장소 접근이
    // 위임된다.
    if (!project.exists || project.ownerId !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "프로젝트 오너만 App 을 설치할 수 있습니다."
      );
    }

    const nonceRef = db.collection(GITHUB_APP_SETUP_STATES).doc();
    const exp = Date.now() + SETUP_STATE_TTL_MS;
    await nonceRef.set({
      uid,
      projectId,
      expiresAt: exp,
      consumedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const state = signSetupState(
      { nonce: nonceRef.id, uid, projectId, exp },
      GITHUB_APP_SETUP_STATE_SECRET
    );
    return {
      installUrl: buildInstallUrl(GITHUB_APP_SLUG, state),
      expiresAt: exp,
    };
  }
);

/**
 * 설치 콜백(GitHub 의 Setup URL). `?installation_id=&setup_action=&state=`
 *
 * 1. state 서명 검증 → 2. nonce 1회 소비(트랜잭션) → 3. nonce.uid 가 그
 * 프로젝트 오너인지 재확인 → 4. App JWT 로 installation 실재 확인 →
 * 5. Admin SDK 로 `githubInstallationId` 기록.
 *
 * ★5번이 Admin SDK 인 게 핵심이다. `githubInstallationId` 는 firestore.rules
 * 의 어떤 클라 allowlist 에도 없다(#1096) — 서버만 쓴다.
 */
export const githubAppSetupCallback = functions.https.onRequest(
  async (req, res) => {
    const fail = (code: number, message: string): void => {
      // 사람이 브라우저에서 보는 화면이다. 내부 사유를 노출하지 않는다.
      res
        .status(code)
        .set("content-type", "text/html; charset=utf-8")
        .send(
          `<!doctype html><meta charset="utf-8"><title>Marblo</title>` +
            `<body style="font-family:system-ui;padding:40px;max-width:640px">` +
            `<h2>GitHub App 설치를 완료하지 못했습니다</h2><p>${message}</p>` +
            `<p>Marblo 앱에서 다시 시도해 주세요.</p></body>`
        );
    };

    if (req.method !== "GET") {
      res.set("Allow", "GET").status(405).send("Method Not Allowed");
      return;
    }
    if (!githubAppConfigured()) {
      fail(503, "서버 설정이 아직 완료되지 않았습니다.");
      return;
    }

    const installationId = normalizeInstallationId(req.query.installation_id);
    const verified = verifySetupState(
      req.query.state,
      GITHUB_APP_SETUP_STATE_SECRET,
      Date.now()
    );
    if (!verified.ok) {
      functions.logger.warn(
        `[githubAppSetupCallback] state rejected (${verified.reason})`
      );
      fail(400, "설치 요청이 만료되었거나 유효하지 않습니다.");
      return;
    }
    if (!installationId) {
      fail(400, "설치 정보를 읽지 못했습니다.");
      return;
    }

    const { uid, projectId, nonce } = verified.payload;

    // nonce 1회 소비 — 같은 state 로 두 번 바인딩할 수 없다.
    const nonceRef = db.collection(GITHUB_APP_SETUP_STATES).doc(nonce);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(nonceRef);
        const d = snap.exists ? snap.data() || {} : null;
        if (!d) throw new Error("nonce-missing");
        if (d.consumedAt) throw new Error("nonce-consumed");
        if (d.uid !== uid || d.projectId !== projectId) {
          throw new Error("nonce-mismatch");
        }
        if (typeof d.expiresAt === "number" && d.expiresAt <= Date.now()) {
          throw new Error("nonce-expired");
        }
        tx.update(nonceRef, { consumedAt: Date.now() });
      });
    } catch (err) {
      functions.logger.warn(
        `[githubAppSetupCallback] nonce rejected (${
          err instanceof Error ? err.message : "unknown"
        })`
      );
      fail(400, "설치 요청이 이미 사용되었거나 만료되었습니다.");
      return;
    }

    // 오너 재확인 — nonce 발급 이후 소유권이 바뀌었을 수 있다.
    const projectSnap = await db.collection("projects").doc(projectId).get();
    const project = projectSnapshotForIssue(projectSnap);
    if (!project.exists || project.ownerId !== uid) {
      await recordGitHubAppAccess({
        uid,
        projectId,
        slug: null,
        installationId,
        outcome: "denied",
        reason: "setup-not-owner",
      });
      fail(403, "이 프로젝트의 오너만 설치를 연결할 수 있습니다.");
      return;
    }

    // installation 실재 확인.
    let installation: GitHubApiResult;
    try {
      installation = await githubAppApi(
        `/app/installations/${installationId}`,
        {
          method: "GET",
        }
      );
    } catch (err) {
      functions.logger.error(
        "[githubAppSetupCallback] GitHub 호출 실패",
        err instanceof Error ? err.message : "unknown"
      );
      fail(502, "GitHub 과 통신하지 못했습니다.");
      return;
    }
    if (installation.status !== 200) {
      functions.logger.warn(
        `[githubAppSetupCallback] installation lookup ${installation.status}`
      );
      fail(400, "설치를 확인하지 못했습니다.");
      return;
    }

    await db.collection("projects").doc(projectId).set(
      {
        githubInstallationId: installationId,
        githubInstallationLinkedAt:
          admin.firestore.FieldValue.serverTimestamp(),
        githubInstallationLinkedBy: uid,
      },
      { merge: true }
    );

    await recordGitHubAppAccess({
      uid,
      projectId,
      slug: null,
      installationId,
      outcome: "issued",
      reason: "installation-linked",
    });

    res
      .status(200)
      .set("content-type", "text/html; charset=utf-8")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Marblo</title>` +
          `<body style="font-family:system-ui;padding:40px;max-width:640px">` +
          `<h2>GitHub App 설치가 연결되었습니다</h2>` +
          `<p>이제 이 프로젝트의 팀원은 GitHub 개별 초대 없이 저장소를 받을 수 있습니다.</p>` +
          `<p>이 창을 닫고 Marblo 로 돌아가세요.</p></body>`
      );
  }
);

/**
 * installation 토큰 발급 — 설계 §3.2 의 검증 순서를 그대로 구현한다.
 *
 * in : { projectId }               ★repo·installationId 를 클라에서 받지 않는다
 * out: { token, expiresAt, repo }  ★token 은 이 응답에만 존재한다
 *
 * 거부 사유는 **뭉뚱그려** 반환한다. 정밀한 사유는 감사 원장에만 남는다 —
 * 클라에 그대로 주면 projectId·설치 유무 프로빙 도구가 된다.
 */
export const issueRepoInstallationToken = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    const uid = context.auth.uid;
    const projectId = requireProjectId(data);

    if (!githubAppConfigured()) {
      // App 미등록 = 이 기능이 아직 없는 상태. 클라는 device 경로로 간다.
      throw new functions.https.HttpsError(
        "failed-precondition",
        "GitHub App 접근을 사용할 수 없습니다."
      );
    }

    // ★감사 write 를 **await 한다.** 콜러블이 응답/던지고 나면 컨테이너가
    // 얼어붙을 수 있어, 떼어놓은 write 는 조용히 유실된다 — 거부 기록이
    // 유실되면 원장이 거짓말을 한다.
    const deny = async (
      reason: string,
      slug: RepoSlug | null,
      inst: string | null,
      extra?: {
        role?: ProjectRole | null;
        access?: RepoAccess | null;
        branch?: string | null;
      }
    ): Promise<functions.https.HttpsError> => {
      await recordGitHubAppAccess({
        uid,
        projectId,
        slug,
        installationId: inst,
        outcome: "denied",
        reason,
        ...extra,
      });
      // ★거부 사유는 여전히 뭉뚱그린다 — 정밀한 사유는 원장에만 남는다.
      //
      // 단 하나의 예외: **역할 때문에 write 가 거부된 경우**만 `denyClass:
      // "role"` 을 붙인다. 이건 새는 정보가 아니다 — 자기 역할은 이미 화면에
      // 보이고(getGitHubAppStatus 의 role/canWrite/canMerge), 이게 없으면
      // 클라가 "역할 거부" 와 "서버 장애" 를 구분하지 못해 **역할 거부인데도
      // device 토큰으로 폴백**해 게이트를 스스로 뚫는다.
      const roleDenied =
        reason === "role-cannot-write" ||
        reason === "default-branch-requires-merge-role";
      if (roleDenied) {
        return new functions.https.HttpsError(
          "permission-denied",
          reason === "default-branch-requires-merge-role"
            ? "기본 브랜치에 직접 밀 수 없습니다. 브랜치를 올리고 PR 로 보내세요."
            : "이 프로젝트에서 코드를 밀 수 있는 역할이 아닙니다.",
          { denyClass: "role" }
        );
      }
      return new functions.https.HttpsError(
        "failed-precondition",
        "GitHub App 접근을 사용할 수 없습니다."
      );
    };

    const requestedAccess = requestedRepoAccess(data);
    const snap = await db.collection("projects").doc(projectId).get();
    const project = projectSnapshotForIssue(snap);
    // ★역할은 **멤버일 때만** 의미가 있다. 멤버가 아니면 이 조회 결과도
    // 무시되므로(resolveProjectRole 이 null), 조회를 먼저 해도 정보가 새지
    // 않는다. 조회 실패는 흡수하지 않는다 — member 로 접히면 viewer 가
    // write 를 받게 된다.
    let memberRole: unknown;
    try {
      memberRole = await readMemberRoleValue(projectId, uid);
    } catch (err) {
      functions.logger.error(
        "[issueRepoInstallationToken] 역할 조회 실패",
        err instanceof Error ? err.message : "unknown"
      );
      throw await deny("role-lookup-failed", null, null);
    }
    const decision = evaluateInstallationTokenRequest({
      uid,
      project,
      ownerPlan: await ownerEntitledPlan(project.ownerId),
      memberRole,
      requestedAccess,
    });
    if (!decision.ok) {
      throw await deny(decision.code, null, null);
    }
    const { installationId, slug, role } = decision;

    // ★계정이 털렸을 때 토큰 양산을 막는다(설계 §3.2 2번).
    //
    // 예산은 read/write 로 나뉘어 있다 — 왜 나눠야 하는지, 숫자의 근거가
    // 무엇인지, 어떻게 재조정하는지는 전부 `githubApp.ts` 의
    // `INSTALLATION_TOKEN_RULES_READ` 위 주석에 있다. ★그 주석을 읽지 않고
    // 이 숫자를 만지지 마라.
    //
    // ── ★왜 이 자리인가 — v1 은 함수 맨 앞이었다 ─────────────────────────
    //
    // "얼마나 쓸지 정하려면 무엇을 발급할지 알아야 한다." 함수 맨 앞에서 아는
    // 것은 **클라이언트의 주장**뿐이다. 그 주장으로 키를 고르면 누구나
    // `access:"write"` 를 실어 60회/시간 버킷을 스스로 고른다 — read 상한
    // 20회/시간이 **클라이언트가 해제할 수 있는 값**이 되어 사실상 사라진다.
    //
    // `decision.access` 는 그 주장이 **서버 권위로 걸러진 뒤**의 값이다.
    // `evaluateInstallationTokenRequest` 의 역할 게이트를 통과한 것만 write 로
    // 남는다 — viewer 의 write 요청은 여기 오기 전에 `role-cannot-write` 로
    // 죽는다. 즉 ★**write 버킷은 실제로 밀 수 있는 역할만 고를 수 있다.**
    //
    // 그러면서 이 자리는 여전히 **GitHub 왕복과 민팅보다 앞**이다. 이 리미터가
    // 지키는 자원(§3.2 2번의 토큰 양산 + 우리 App 이 공유하는 GitHub 쿼터)은
    // 전부 아래에 있다. 리미터 앞으로 넘어간 것은 우리 Firestore 읽기(프로젝트
    // 문서 · 오너 플랜 · 역할)와 거부 시 감사 write 뿐이다 — 우리 자원이고,
    // 콜러블이 한 번 호출된 것만으로 이미 치르는 비용과 같은 급이다. ★이게
    // 이 트레이드오프의 전부다: 싼 것을 앞으로 보내고 비싼 것을 뒤에 남겼다.
    //
    // ★왜 `negotiated.access` 가 아닌가 — 그쪽이 "실제로 발급되는 것" 이라 더
    // 정확하다. 하지만 협상은 `GET /repos/{o}/{r}/installation` 왕복을 **먼저**
    // 요구한다. 협상 뒤로 리미터를 옮기면 리미터가 GitHub 왕복을 못 막는다 =
    // 존재 이유가 사라진다. 그래서 협상 **앞**에 둔다.
    //
    // 그 대가는 하나뿐이고, 알고 받아들인다: write 를 요청했다가 설치 미승인으로
    // read 로 깎여 발급되면(`downgraded`) 그 요청은 write 슬롯을 먹고 read 토큰을
    // 받는다. ★**환불하지 않는다** — 예산에 남아야 하는 사실은 "write 를
    // 시도했다" 이고, 위 근거대로 read 는 발급 횟수가 폭발 반경을 줄이지 않으므로
    // 이 방향으로는 잃는 게 없다. 막아야 하는 건 반대 방향
    // (**read 예산으로 write 토큰을 얻는 것**)이고, 그건 위 역할 게이트가 막는다.
    //
    // ★예산 선택을 여기서 손으로 하지 않는다 — `installationTokenBudgetFor` 가
    // **판정 객체**를 받아 키와 룰을 함께 낸다. 문자열을 받게 두면 `"read"`
    // 리터럴 한 줄이 다시 기어들어오고, 그건 컴파일도 테스트도 통과하면서
    // 효과만 0이다.
    const budget = installationTokenBudgetFor(uid, projectId, decision);
    const rate = await enforceRateLimit(budget.key, [...budget.rules]);
    if (!rate.allowed) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        `요청이 너무 잦습니다. ${rate.retryAfter}초 후 다시 시도하세요.`
      );
    }

    // ★설계 §3.2 7번 — GitHub 에 되묻는다. 룰만 믿지 않는다.
    //
    // 설계 원문은 `GET /installation/repositories` 로 적혀 있지만, 그 엔드포인트는
    // **installation 토큰**을 먼저 발급해야 부를 수 있다(= 검증 전에 넓은 토큰을
    // 한 번 만들어야 한다). 같은 보증을 토큰 발급 **전에** 얻는 경로가
    // `GET /repos/{owner}/{repo}/installation` 이다(App JWT 로 호출 가능):
    //   - 이 저장소에 App 이 안 깔렸으면 404 → 거부
    //   - 오너가 App 을 제거했으면 404 → 거부  ★탈퇴/제거 차단이 여기서 실동작
    //   - 남의 저장소면 다른 installation id → mismatch → 거부 (크로스테넌트 차단)
    // 보증은 동일하고 노출 표면은 더 작다. 판정은 verifyRepoInstallationBinding.
    let lookup: GitHubApiResult;
    try {
      lookup = await githubAppApi(
        `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(
          slug.repo
        )}/installation`,
        { method: "GET" }
      );
    } catch (err) {
      functions.logger.error(
        "[issueRepoInstallationToken] GitHub 조회 실패",
        err instanceof Error ? err.message : "unknown"
      );
      throw await deny("github-unreachable", slug, installationId);
    }
    // ★판정은 순수 함수가 한다 — 여기서 다시 조건을 세우지 않는다. 그래야
    // "오너가 App 을 제거하면 끊긴다" 를 라이브 App 없이 테스트가 증명한다.
    const access = evaluateRepoInstallationLookup(
      lookup.status,
      lookup.body,
      installationId,
      slug
    );
    if (!access.ok) {
      throw await deny(access.reason, slug, installationId, { role });
    }

    // ★재승인 협상(v2) — 우리가 원하는 권한이 아니라 **오너가 이 설치에 실제로
    // 승인해 둔 권한**으로 요청을 깎는다. App 권한을 write 로 올려도 기존
    // 설치처는 오너가 재승인하기 전까지 read 그대로이고, 그 상태에서 write 를
    // 요청하면 GitHub 이 422 로 발급 자체를 거절해 **clone 까지 같이 죽는다.**
    // 여기서 깎으면 재승인 전에는 정확히 v1 동작이다(회귀 0).
    const negotiated = negotiateInstallationAccess(
      decision.access,
      access.permissions
    );

    // ★기본 브랜치 게이트 — write 일 때만. 화면이 Merge 를 owner/admin 으로
    // 막아 놓았으므로 토큰도 같은 선을 그어야 게이트가 뚫리지 않는다.
    let branch: string | null = null;
    if (negotiated.access === "write") {
      let repoMeta: GitHubApiResult;
      try {
        repoMeta = await githubAppApi(
          `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(
            slug.repo
          )}`,
          { method: "GET" }
        );
      } catch (err) {
        functions.logger.error(
          "[issueRepoInstallationToken] 기본 브랜치 조회 실패",
          err instanceof Error ? err.message : "unknown"
        );
        throw await deny("github-unreachable", slug, installationId, {
          role,
          access: "write",
        });
      }
      const refDecision = evaluatePushRef({
        role,
        ref: requestedPushRef(data),
        defaultBranch:
          repoMeta.status === 200 ? parseDefaultBranch(repoMeta.body) : null,
      });
      if (!refDecision.ok) {
        throw await deny(refDecision.code, slug, installationId, {
          role,
          access: "write",
        });
      }
      branch = refDecision.branch;
    }

    // 다운스코프 발급 — 이 저장소 1개 · 협상된 권한만.
    let minted: GitHubApiResult;
    try {
      minted = await githubAppApi(
        `/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          body: {
            repositories: [slug.repo],
            permissions: { ...negotiated.permissions },
          },
        }
      );
    } catch (err) {
      functions.logger.error(
        "[issueRepoInstallationToken] GitHub 발급 실패",
        err instanceof Error ? err.message : "unknown"
      );
      throw await deny("github-unreachable", slug, installationId, {
        role,
        access: negotiated.access,
        branch,
      });
    }
    // ★201 여부 + 다운스코프 검증을 한 함수가 한다. 넓게 온 토큰은 버린다.
    // 대조 기준은 **우리가 요청한 권한**이라, write 토큰이 read 기준으로
    // 버려지지도 않고 read 요청에 write 가 와도 통과하지 않는다.
    const checked = evaluateMintResponse(
      minted.status,
      minted.body,
      slug,
      negotiated.permissions
    );
    if (!checked.ok) {
      functions.logger.warn(
        `[issueRepoInstallationToken] mint rejected (${checked.reason})`
      );
      throw await deny(checked.reason, slug, installationId, {
        role,
        access: negotiated.access,
        branch,
      });
    }

    await recordGitHubAppAccess({
      uid,
      projectId,
      slug,
      installationId,
      outcome: "issued",
      reason: negotiated.downgraded ? "downgraded-to-read" : null,
      role,
      access: negotiated.access,
      branch,
    });

    // ★서버는 이 토큰을 저장하지 않는다(설계 §5-B2). 응답에 한 번 실려 끝.
    // ★`downgraded` 는 실패가 아니라 "오너 재승인 필요" 라는 사실이다 —
    // 클라가 이걸 보고 push 를 시도하지 않고 안내로 바꾼다.
    return {
      token: checked.minted.token,
      expiresAt: checked.minted.expiresAtMs,
      repo: repoSlugKey(slug),
      access: negotiated.access,
      downgraded: negotiated.downgraded,
    };
  }
);

/**
 * App 상태 조회 — 토큰을 발급하지 않는다. 화면이 "설치됨/재설치 필요" 를
 * 보여주기 위한 최소 정보만 준다(설계 §5-B3: `{installed, repoAccessible}`).
 */
export const getGitHubAppStatus = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "로그인이 필요합니다."
      );
    }
    const uid = context.auth.uid;
    const projectId = requireProjectId(data);
    // ★v2 필드는 전부 **보수적 기본값**이다. 상태 조회가 어디서 멈추든
    // "쓰기 가능" 이 참으로 새지 않는다.
    const off = {
      installed: false,
      repoAccessible: false,
      configured: false,
      role: null as ProjectRole | null,
      canWrite: false,
      canMerge: false,
      writeGranted: false,
    };
    if (!githubAppConfigured()) return off;

    const snap = await db.collection("projects").doc(projectId).get();
    const project = projectSnapshotForIssue(snap);
    let memberRole: unknown;
    try {
      memberRole = await readMemberRoleValue(projectId, uid);
    } catch {
      memberRole = undefined;
    }
    const decision = evaluateInstallationTokenRequest({
      uid,
      project,
      ownerPlan: await ownerEntitledPlan(project.ownerId),
      memberRole,
    });
    if (!decision.ok) {
      return { ...off, configured: true };
    }
    const { role } = decision;
    // ★역할이 주는 상한. 설치가 write 를 승인했는지와는 **별개**다 —
    // 화면은 둘을 다르게 안내해야 한다("당신 역할로는 못 민다" vs
    // "오너가 재승인해야 한다").
    const roleCaps = {
      role,
      canWrite: roleCanWriteRepo(role),
      canMerge: roleCanMerge(role),
    };

    try {
      const lookup = await githubAppApi(
        `/repos/${encodeURIComponent(decision.slug.owner)}/${encodeURIComponent(
          decision.slug.repo
        )}/installation`,
        { method: "GET" }
      );
      const checked = evaluateRepoInstallationLookup(
        lookup.status,
        lookup.body,
        decision.installationId,
        decision.slug
      );
      return {
        installed: true,
        repoAccessible: checked.ok,
        configured: true,
        ...roleCaps,
        // ★오너가 이 설치에 contents:write 를 승인했는가. 거짓이면 push 는
        // 아직 안 되고, 화면은 오너에게 **재승인**을 안내한다(회귀 0 —
        // 그동안 clone 은 그대로 된다).
        writeGranted: checked.ok && checked.permissions.contents === "write",
      };
    } catch {
      // 조회 실패는 "모름" 이다 — 접근 가능으로 위장하지 않는다.
      return {
        installed: true,
        repoAccessible: false,
        configured: true,
        ...roleCaps,
        writeGranted: false,
      };
    }
  }
);
