import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  powerMonitor,
  powerSaveBlocker,
  clipboard,
  shell,
  safeStorage,
  Notification,
  WebContentsView,
  webContents as allWebContents,
} from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import dotenv from "dotenv";
import { PtyManager, isBusySignal } from "./pty-manager";
import {
  isPowerSaveMode,
  normalizePowerSaveMode,
  powerSaveSources,
  type PowerSaveMode,
  type WorkPowerSaveSource,
} from "./power-save-policy";
import type { ComposerRefusal } from "./composer-gate";
import {
  startMcpOrphanReaper,
  stopMcpOrphanReaper,
  reapOrphanedMcpChildren,
} from "./mcp-orphan-reaper";
import { PendingInstructionListener } from "./pending-instruction-listener";
import {
  OrchestratorBoardResync,
  type ResyncTaskRow,
} from "./orchestrator-board-resync";
import type { UnsurfacedGitFacts } from "./orchestrator-unsubmitted-work";
import {
  isOrchestratorActivitySummary,
  latestAnsweredQuestion,
  readQuestions,
} from "./mcp-server/question-channel";
import { FsManager } from "./fs-manager";
import { devServerUrl } from "./dev-server-origin";
import { startMainBuildWatcher } from "./main-build-scan";
import { gitSpawnEnv } from "./git-path";
import {
  AgentManager,
  serializeAgent,
  formatModelAtEffort,
  isNoOutputRun,
  MULTI_AGENT_MIN_CONCURRENCY,
  type ModelType,
} from "./agent-manager";
import { Updater } from "./updater";
import {
  isPathUnder,
  mergeAccountWindowSessionIntoState,
  resolveRestoreRoots,
  scrubRemovedRoots,
  sessionForAccount,
  selectPersistableWindows,
  type AccountWindowSession,
  type WindowRestoreEntry,
} from "./windowSession";
import { describeRootPathFailure, diagnoseRootPath } from "./rootPathHealth";
import { TaskDecomposer } from "./orchestrator/task-decomposer";
import type { DecomposedTask } from "./orchestrator/dag-generator";
import { BridgeServer, withCompletionFooter } from "./bridge-server";
import {
  listModelPresets,
  normalizePresetId,
  CUSTOM_PRESET_HARNESSES,
  DEFAULT_MODEL_PRESET,
} from "./dispatch-scoring";
import { GraphUpdater } from "./graph-updater";
import type { GraphContext } from "./routing-graph";
import {
  AgentWatchdog,
  resolveWatchdogConfig,
  buildRespawnDispatch,
  type WatchdogTicket,
  type StaleReviewTicket,
  type PendingInstruction,
} from "./agent-watchdog";
import { sampleProcessProbe } from "./process-cpu-probe";
import { isOtherLiveWorkerForTask } from "./agent-stall-policy";
import { OrchestratorManager } from "./orchestrator-manager";
import type { OrchestratorCostSession } from "./session-kind";
import { OwnerRegistry } from "./owner-registry";
import {
  buildOrchestratorHandoffSnapshot,
  classifyOrchestratorSelectionSource,
  formatHandoffPrompt,
  needsOrchestratorAutoProbe,
  resolveEffectiveOrchestratorModelSetting,
  resolveRestartResumeSessionId,
  resolveSwitchHandoffResumeSessionId,
  usesIsolatedHomeSentinelResume,
  type OrchestratorModelSelectionSource,
  type OrchestratorSwitchMode,
  type OrchestratorSwitchResumeMode,
  type RawHandoffDoc,
} from "./orchestrator-handoff";
import {
  ORCHESTRATOR_BLOCK_REASON_MCP,
  ORCHESTRATOR_BLOCK_REASON_VENDOR,
  OrchestratorSwitchStepTimeoutError,
  runOrchestratorSwitch,
  type OrchestratorSwitchStage,
  type OrchestratorSwitchArgs,
  type OrchestratorSwitchResult,
} from "./orchestrator-switch";
import { installBundledHarness } from "./bundle-installer";
import { runGoogleLoopbackOAuth } from "./google-oauth";
import {
  applyPackagedOAuthConfig,
  type PackagedOAuthConfig,
} from "./oauth-config-env";
import {
  shouldReleaseClaimForStoppedAgent,
  taskStatusAfterClaimRelease,
} from "./mcp-server/task-ownership";
import {
  listCatalog,
  installPackageWithTelemetry,
  describeInstallPackageForTelemetry,
  uninstallPackage,
  scheduleHarnessUpdates,
  getCatalogVersions,
  probeCliAuth,
  checkSpawnAuthGate,
  setSpawnGateObserver,
  setSpawnGatePassedObserver,
  type CliAuthModel,
} from "./harness-manager";
import { getRegistryIndex } from "./registry-client";
import {
  installDefaultRegistryItems,
  installRegistryItem,
  uninstallRegistryItem,
  overlayInstallState,
  type InstallerDeps,
} from "./registry-installer";
import { rateRegistryItems } from "./registry-rating";
import { readLedger, registryLedgerPath } from "./registry-ledger";
import {
  LOCAL_MODEL_CATALOG,
  LocalModelPullManager,
  catalogEntry,
  evaluateLocalModelCards,
  localHardwareInfo,
  syncInstalledLocalModels,
} from "./local-models";
import { FlowRunner } from "./flow-engine/flow-runner";
import { KanbanBridge } from "./flow-engine/kanban-bridge";
import { createLLMProvider } from "./flow-engine/llm-provider";
import type { Flow, FlowEvent, HumanInput } from "./flow-engine/types";
import {
  findReconnectCandidates,
  resolveClaudeColdBootResumeId,
  classifyMachineOwnership,
  FOREIGN_MACHINE_SKIP_REASON,
} from "./reconnect-manager";
import {
  saveAgyConversationLabel,
  getAgyConversationId,
  resolveClaudeBinary,
  resolveOrchestratorModel,
  resolveAllHarnessVersions,
  preflightNodeSpawn,
  probeGrokMarbloMcp,
  CONFIG_DIR,
} from "./agent-config";
import { unlinkLegacyGrokAuthSymlinks } from "./grok-auth-broker";
import {
  splitOrchestratorModelValue,
  normalizeOrchestratorModelSetting as normalizeOrchestratorModelSettingImpl,
  orchestratorModelTypeForSetting,
  orchestratorLaunchPin,
  orchestratorVendorGateTarget,
  quickLaneVendorCatalog,
  claudeOrchestratorChoices,
  codexOrchestratorChoices,
  grokOrchestratorChoices,
  resolveModelPin,
  pickPreferredOrchestratorHarness,
  ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY,
} from "./model-selection";
import { modelFactSheetPayload } from "./model-fact-sheet";
import { ourBenchPayload } from "./model-bench-ours";
import {
  vendorSecretsSnapshot,
  setVendorSecret,
  deleteVendorSecret,
} from "./vendor-secrets";
import { CostTracker, onUnmatchedPricing } from "./cost-tracker";
import { isCliHomeTracked } from "./session-parsers";
import {
  classifyPtySessionId,
  planOrchestratorCostTracking,
} from "./session-kind";
import {
  ingestSessionLines,
  initTrainingCapture,
  refreshTrainingCapture,
  trackOrchestratorSession,
  trainingCaptureStatus,
} from "./training-capture";
import { getAccountRateLimits } from "./account-usage";
// 자율 픽업의 토큰 잔여 게이트가 읽는 셋 — 브리지 /model-guidance 가 쓰는 것과
// **같은 함수·같은 예비선**이다(티켓 6hWxqjbzGQs1hzTUTihx).
import { harnessQuotaRows } from "./harness-quota";
import { loadUsageRollup } from "./usage-rollup";
import { resolveQuotaReservePct } from "./dispatch-scoring";
import { getVendorBalance, hasBalanceProbe } from "./vendor-balance";
import {
  decideOrchestratorVendorGate,
  orchestratorVendorBootNotice,
  type OrchestratorVendorGateStatus,
} from "./orchestrator-vendor-gate";
import { mainTelemetry } from "./telemetry";
import { initMainSentry } from "./sentry-main";
import { loadPackagedMainFirebaseConfigEnv } from "./firebase-config-env";
import {
  buildMissionEngine,
  type BuiltMissionEngine,
} from "./mission-engine/wire";
import { WorktreeManager } from "./worktree-manager";
import { discoverWorktreeRoots } from "./worktree-root-discovery";
import { WorktreeCoordinator } from "./worktree-coordinator";
import {
  registerWorktreeIpc,
  type WorktreeProjectRoot,
  type MergeHistoryRecord,
} from "./worktree-ipc";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";
import {
  clearAgentCustomToken,
  currentRealUserUid,
  syncAgentCustomToken,
} from "./firebase-auth-sync";
import { buildLaneContextId, isLaneContextId } from "./mcp-server/context";
import { RESYNC_ATTENTION_STATUSES } from "./mcp-server/notify-resync-coverage";
// 자율 픽업 패스가 쓰는 둘 — 플래그는 전진 신호와 **공유**하고(새 환경변수 없음),
// 오너 인바운드 저널은 사장님 지시가 자율 진행보다 우선한다는 판정면이다
// (티켓 6hWxqjbzGQs1hzTUTihx).
import { isAdvanceSignalEnabled } from "./mcp-server/advance-guards";
import { readOwnerInbound } from "./mcp-server/owner-inbound";
import {
  getTelegramChannelConfig,
  listTelegramChannelConfigs,
  setTelegramChannelFromLocalSettings,
  getTelegramChannelStatus,
  removeTelegramChannel,
  setTelegramBindingObserver,
  type TelegramChannelInput,
} from "./telegram-channels";
import {
  pushTelegramChannelMetaOne,
  syncTelegramChannelMeta,
  createTelegramLeaseRemote,
  createTelegramBindingObserver,
} from "./telegram-channel-sync";
import {
  runTelegramChannelHealthCheck,
  type ChannelHealthReport,
} from "./telegram-health";
import { TelegramPoller, type InboundTarget } from "./telegram-poller";
import { TelegramPollerLeaseManager } from "./telegram-poller-lease";
import { TelegramRouteJournal } from "./telegram-route-journal";
import {
  getSlackChannelConfig,
  getSlackChannelStatus,
  listSlackChannelStatuses,
  setSlackChannelFromLocalSettings,
  removeSlackChannel,
  type SlackChannelInput,
} from "./slack-channels";
import {
  runSlackChannelHealthCheck,
  probeSlackChannel,
  type SlackChannelHealthReport,
} from "./slack-health";
import { SlackPoller } from "./slack-poller";
import {
  AssistantTriggerManager,
  type AssistantTriggerWebhookEvent,
  type AssistantTriggerProject,
  type AssistantTriggerResolution,
} from "./assistant-triggers";
import type { AssistantTriggerDeliveryFailure } from "./assistant-trigger-delivery";
import {
  getProjectConnection,
  upsertProjectConnection,
  listProjectConnections,
  touchProjectLastRun,
  setAccessMode,
  removeConnection,
  withAvailableMcps,
  parseGitHubRepoSlug,
  repoUrlsMatch,
  type ProjectConnectionInput,
  type AccessMode,
} from "./connection-store";
import { cloneRepo, defaultCloneParentDir, realGitRunner } from "./repo-clone";
import { pushBranch, normalizeBranchName } from "./repo-push";
import {
  applyCommitIdentity,
  fetchCommitIdentity,
  type CommitIdentity,
} from "./github-commit-identity";
// macOS Xcode CLT 라이선스/설치 문제를 git 실패에서 감지·사전감지한다
// (티켓 nETj7szjEtT5prbYsg1D).
import { annotateGitFailure, probeXcodeClt } from "./xcode-clt";
import { ensureSampleProject, resolveSampleProjectDir } from "./sample-project";
import {
  pollGitHubDeviceCode,
  requestGitHubDeviceCode,
} from "./github-device-oauth";
import {
  getGitHubToken,
  removeGitHubToken,
  saveGitHubToken,
} from "./github-token-store";
// GitHub App 자동상속 (티켓 ddbN2KvxHZ08rakiVfL0). ★device OAuth 를 대체하지
// 않는다 — 두 경로가 같은 타입을 만들어 **하나의 clone 구현**에 들어간다.
import {
  pushCredentialAuditFields,
  resolveCloneCredential,
  resolvePushCredential,
  type CloneCredential,
  type PushCredential,
} from "./github-clone-credential";
import {
  getGitHubAppStatus,
  issueRepoInstallationToken,
  issueRepoInstallationWriteToken,
  readProjectInstallationId,
  startGitHubAppInstall,
} from "./github-app-client";
import {
  connectGoogleDrive,
  createUserCalendarConnector,
  createUserSheetsConnector,
  createUserContactsConnector,
  createUserDriveConnector,
  createUserGmailConnector,
  disconnectGoogleDrive,
  driveConnectionStatus,
} from "./google-drive-auth";
import {
  browserSessionStore,
  normalizeSiteKey,
} from "./web-automation/browser-session-store";
import { chromeBrowserSessionManager } from "./web-automation/browser-session-manager";
import { BROWSER_SESSION_LEAKAGE_GUARDS } from "./web-automation/leakage-guards";
import {
  browserPaneNoticeForExternalReason,
  BrowserPaneOpenUrlDelivery,
  classifyInAppBrowserNavigation,
  IN_APP_BROWSER_SESSION_PARTITION,
  normalizeBrowserPaneUrl,
  resolveAppLinkSurface,
  routeExternalLinkClick,
  type AppLinkSurface,
  type AppLinkSurfaceGraph,
  type BrowserPaneOpenUrlSender,
  type InAppBrowserExternalReason,
} from "./in-app-browser-policy";
import {
  browserPaneBoundsFromContainerRect,
  type BrowserPaneContainerRect,
  type BrowserPaneViewBounds,
  type BrowserPaneWindowOrigin,
} from "./browser-pane-bounds";
import {
  formatBrowserPaneTrace,
  isBrowserPaneTraceComplete,
  type BrowserPaneTraceMarks,
} from "./browser-pane-trace";
import {
  AgentReadRateLimiter,
  classifyAgentNavigationRequest,
  classifyAgentReadRequest,
  GlobalBrowserAccessSwitch,
  type AgentReadDenyReason,
} from "./browser-pane-agent-read-policy";
import {
  runAgentNavigation,
  runAgentReadExtraction,
} from "./browser-pane-agent-read";
// restricted 스코프를 뺀 결과 잠긴 기능들 — 조용히 401 을 내지 않고 이유를
// 말하기 위한 단일 진실원(티켓 v5Phjv1WxndUpgFJyrIn).
import { withheldCapabilityError } from "./google-restricted-scopes";
import type {
  DriveDocument,
  DriveListParams,
  DriveSearchResult,
  DriveWriteParams,
  DriveWriteResult,
} from "./google-drive-connector";
import type {
  GmailComposeParams,
  GmailDraftResult,
  GmailMessage,
  GmailSearchParams,
  GmailSearchResult,
  GmailSendResult,
} from "./gmail-connector";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarListParams,
  CalendarListResult,
  CalendarPatchInput,
} from "./calendar-connector";
import type {
  SheetsValuesParams,
  SheetsValuesResult,
} from "./sheets-connector";
import type {
  ContactsSearchParams,
  ContactsSearchResult,
} from "./contacts-connector";
import {
  clearDriveProjectBinding,
  getDriveProjectBinding,
  isValidDriveFolderId,
  setDriveProjectBinding,
} from "./drive-project-binding";
import {
  authorizeScopedFetch,
  createDriveScopeResolver,
  driveAccessFromInput,
  planScopedSearch,
  type DriveAccess,
  type DriveScopeInfo,
  type DriveScopeResolver,
} from "./drive-scope";
import {
  connectNotionWithIntegrationToken,
  createUserNotionConnector,
  disconnectNotion,
  notionStatus,
} from "./notion-auth";
import type {
  NotionDocument,
  NotionSearchParams,
  NotionSearchResult,
  NotionWriteParams,
  NotionWriteResult,
} from "./notion-connector";
import {
  clearNotionProjectBinding,
  getNotionProjectBinding,
  isValidNotionObjectId,
  setNotionProjectBinding,
  type NotionProjectBinding,
  type NotionBindingKind,
} from "./notion-project-binding";
import {
  authorizeScopedNotionFetch,
  notionAccessFromInput,
  planScopedNotionSearch,
  type NotionAccess,
  type NotionScopeInfo,
} from "./notion-scope";

type ConnectionCheckStatus = "pass" | "warn" | "fail";

interface ConnectionCheckItem {
  id:
    | "repo"
    | "branch"
    | "issues"
    | "pullRequest"
    | "auth"
    | "mismatch"
    // macOS Xcode CLT 라이선스/설치 문제 (티켓 nETj7szjEtT5prbYsg1D).
    // 이게 걸리면 git 이 아예 안 도니 나머지 점검은 의미가 없다.
    | "toolchain";
  label: string;
  status: ConnectionCheckStatus;
  detail: string;
}

interface ConnectionCheckResult {
  checkedAt: number;
  ok: boolean;
  items: ConnectionCheckItem[];
}

// .env 파일에서 Firebase 환경변수 로드 (Electron 메인 프로세스용)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
const firebaseConfigEnvResult = loadPackagedMainFirebaseConfigEnv({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});
if (firebaseConfigEnvResult.status === "loaded") {
  console.log(
    `[Main] packaged Firebase config loaded for main process (path=${firebaseConfigEnvResult.configPath}; keys=${firebaseConfigEnvResult.injectedKeys.length}; apiKeyPresent=${firebaseConfigEnvResult.apiKeyPresent})`,
  );
} else if (
  firebaseConfigEnvResult.status === "missing" ||
  firebaseConfigEnvResult.status === "invalid"
) {
  console.warn(
    `[Main] packaged Firebase config unavailable for main process (status=${firebaseConfigEnvResult.status}; path=${firebaseConfigEnvResult.configPath})`,
  );
}

// Packaged app has no `.env`, so the Google 로그인 loopback OAuth values
// (ticket QvaYPAjAW822I0IDiwwZ) would be empty and the flow would fail before
// opening the browser. electron-builder ships JUST those two values as
// resources/oauth-config.json (scripts/write-oauth-config.mjs — NOT the whole
// .env, which holds Toss/Resend secrets). Load them into process.env here so
// google-oauth.ts reads them normally. dev/unpackaged falls through to .env.
if (app.isPackaged) {
  try {
    const cfgPath = path.join(process.resourcesPath, "oauth-config.json");
    const cfg = JSON.parse(
      fs.readFileSync(cfgPath, "utf-8"),
    ) as PackagedOAuthConfig;
    applyPackagedOAuthConfig(cfg);
  } catch {
    // Missing/malformed (dev build, or OAuth not configured) — the loopback
    // flow will surface a clear "Desktop OAuth client 미설정" error if used.
  }
}

// --- API Key Storage ---
// BYOK keys are encrypted at rest with Electron's safeStorage API, which
// uses the OS keychain under the hood (Keychain on macOS, DPAPI on
// Windows, libsecret on Linux). Plaintext fallback is a hard error per
// the v3.1 launch master plan P0-4 acceptance ("평문 파일 0개 검증").
//
// Two file paths cover the upgrade path:
//   api-keys.json       (legacy plaintext — auto-migrated on first write)
//   api-keys.enc.json   (base64-encoded ciphertext per key)
const API_KEYS_DIR = path.join(os.homedir(), ".marblo");
const API_KEYS_FILE_LEGACY = path.join(API_KEYS_DIR, "api-keys.json");
const API_KEYS_FILE_ENC = path.join(API_KEYS_DIR, "api-keys.enc.json");

interface StoredApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
}

interface EncryptedKeyStore {
  anthropic?: string; // base64 ciphertext
  openai?: string;
  google?: string;
}

function ensureApiKeysDir(): void {
  if (!fs.existsSync(API_KEYS_DIR)) {
    fs.mkdirSync(API_KEYS_DIR, { recursive: true });
  }
}

/** safeStorage requires app.isReady() before it can be used. */
function isEncryptionAvailable(): boolean {
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function decryptField(b64: string | undefined): string | undefined {
  if (!b64) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(b64, "base64"));
  } catch (err) {
    console.warn("[ApiKeys] decrypt failed for one field:", err);
    return undefined;
  }
}

function encryptField(plain: string | undefined): string | undefined {
  if (!plain) return undefined;
  return safeStorage.encryptString(plain).toString("base64");
}

function readApiKeys(): StoredApiKeys {
  try {
    ensureApiKeysDir();

    // 1) Prefer encrypted store if it exists AND safeStorage is up.
    if (fs.existsSync(API_KEYS_FILE_ENC)) {
      if (!isEncryptionAvailable()) {
        // Called before app.whenReady() — return empty and rely on the
        // post-ready refresh hook to load keys later.
        return {};
      }
      const raw = fs.readFileSync(API_KEYS_FILE_ENC, "utf-8");
      const enc = JSON.parse(raw) as EncryptedKeyStore;
      return {
        anthropic: decryptField(enc.anthropic),
        openai: decryptField(enc.openai),
        google: decryptField(enc.google),
      };
    }

    // 2) Legacy plaintext file — read it so the user doesn't lose keys.
    //    Migration to encrypted happens lazily on the next writeApiKeys().
    if (fs.existsSync(API_KEYS_FILE_LEGACY)) {
      const raw = fs.readFileSync(API_KEYS_FILE_LEGACY, "utf-8");
      const keys = JSON.parse(raw) as StoredApiKeys;
      // Opportunistic migration if safeStorage is ready right now.
      if (isEncryptionAvailable()) {
        try {
          writeApiKeys(keys);
          console.log("[ApiKeys] Migrated legacy plaintext → encrypted store");
        } catch (err) {
          console.warn("[ApiKeys] Migration deferred (write failed):", err);
        }
      }
      return keys;
    }
  } catch (err) {
    console.warn("[ApiKeys] read failed:", err);
  }
  return {};
}

// BYOK 키는 안전한 encrypted store 에 있고, orchestrator 쪽 LLM 클라이언트
// (task-decomposer / flow-generator) 는 process.env 만 읽는다. 시작 시 + 키
// 변경 시 stored 키를 process.env 로 동기화해서 양쪽 경로가 같은 키를 본다.
// 명시적으로 설정된 env 가 있으면 덮어쓰지 않는다 (개발자 override 보존).
function syncApiKeysToEnv(keys: StoredApiKeys): void {
  if (keys.anthropic && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = keys.anthropic;
  }
  if (keys.openai && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = keys.openai;
  }
  if (keys.google && !process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_API_KEY = keys.google;
  }
}

function writeApiKeys(keys: StoredApiKeys): void {
  ensureApiKeysDir();
  if (!isEncryptionAvailable()) {
    // Per P0-4: never write plaintext. If safeStorage is unavailable
    // (Linux without libsecret, ancient OS) surface the error so the
    // user knows their keys aren't being saved.
    throw new Error(
      "OS keychain encryption unavailable. " +
        "On Linux install libsecret-1-0 / gnome-keyring and restart Marblo. " +
        "On macOS or Windows this should not happen — please report to support@marblo.app.",
    );
  }
  const enc: EncryptedKeyStore = {
    anthropic: encryptField(keys.anthropic),
    openai: encryptField(keys.openai),
    google: encryptField(keys.google),
  };
  fs.writeFileSync(API_KEYS_FILE_ENC, JSON.stringify(enc, null, 2), "utf-8");
  // Once an encrypted copy exists, drop the legacy plaintext so the
  // disk never holds the keys in cleartext again.
  if (fs.existsSync(API_KEYS_FILE_LEGACY)) {
    try {
      fs.unlinkSync(API_KEYS_FILE_LEGACY);
      console.log("[ApiKeys] Removed legacy plaintext file");
    } catch (err) {
      console.warn("[ApiKeys] Failed to remove legacy plaintext:", err);
    }
  }
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

// --- App State Persistence (session restore across restart / sleep-wake) ---
const APP_STATE_FILE = path.join(API_KEYS_DIR, "app-state.json");

interface AppState {
  // Legacy single-slot fields kept only for non-account/device settings
  // compatibility. Account restore must use accountWindowSessions below.
  lastProjectId?: string;
  lastRootPath?: string;
  wasOrchestratorRunning?: boolean;
  modelPreset?: string;
  orchestratorModel?: string;
  // 프로젝트별 오케 모델 (restart 연속성). 전역 orchestratorModel 은 마지막으로
  // 만진 프로젝트의 값으로 덮여 재시작 시 다른 프로젝트 오케까지 그 모델로
  // 부팅시켰다 — claude 대화를 가진 프로젝트가 codex 로 떠 "세션 연결 안 됨"
  // 이 되는 라이브 사고(0zV1apB3CvIiabHlYHxQ)의 직접 원인. launch 성공 시마다
  // 기록되며, 재시작/reconnect 는 이 값을 전역보다 우선한다.
  orchestratorModelByProject?: Record<string, string>;
  // 프로젝트별 오케 모델 출처 — `user`(설정/스위치/명시 launch) vs `auto`
  // (Claude>Codex>Grok 우선순위 픽). auto 는 resolve 때마다 재평가해 클로드
  // 복원 후에도 그록에 묶이지 않게 한다. 키 없으면 legacy auto 로 취급.
  orchestratorModelSourceByProject?: Record<
    string,
    OrchestratorModelSelectionSource
  >;
  demoCellValues?: Record<string, Record<string, string>>;
  // Project windows open at last quit, so a full restart can reopen them all
  // (the single lastProjectId/lastRootPath above only covers one window).
  windows?: Array<{ rootPath?: string; projectId?: string }>;
  // Account-scoped restore state. The app-state file itself is device-scoped
  // (machineId, static server port, power settings), but project folders and
  // window restore slots are account data and must not be read across uid.
  accountWindowSessions?: Record<string, AccountWindowSession>;
  // Stable per-install identifier for this machine. Generated once on first
  // boot and persisted. Stamped onto agent docs this machine launches so
  // boot-restore / reap can be machine-scoped on a shared account (see
  // getMachineId / stampAgentMachineOwnership). Never auto-changes.
  machineId?: string;
  // epoch-ms of the last resource-accumulation warning (agents/worktrees over
  // threshold), persisted so the 24h alert dedupe survives restarts.
  lastAccumulationAlertAt?: number;
  // Port the shared static server (production) bound last launch. Reused on the
  // next launch so the app origin (http://127.0.0.1:<port>) stays stable and
  // Firebase auth persistence (origin-scoped localStorage) survives a restart.
  // Falls back to a random free port if the saved one is taken.
  staticServerPort?: number;
  // Keep background orchestrator / agent / Telegram work alive while active.
  // Defaults to true; false means never hold a powerSaveBlocker.
  preventSleepWhileWorking?: boolean;
  // "remote" also holds the assertion while waiting for a remote trigger.
  powerSaveMode?: PowerSaveMode;
}

function readAppState(): AppState {
  try {
    ensureApiKeysDir();
    if (fs.existsSync(APP_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(APP_STATE_FILE, "utf-8")) as AppState;
    }
  } catch {
    /* corrupted — return empty */
  }
  return {};
}

function writeAppState(state: AppState): void {
  ensureApiKeysDir();
  // Merge with existing state to allow partial updates
  const existing = readAppState();
  const merged = { ...existing, ...state };
  fs.writeFileSync(APP_STATE_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

let activeAccountUid: string | null = null;

function isValidAccountUid(uid: unknown): uid is string {
  return (
    typeof uid === "string" &&
    uid.trim().length > 0 &&
    uid.length <= 256 &&
    uid !== "__proto__" &&
    uid !== "constructor" &&
    uid !== "prototype"
  );
}

function accountUidFromInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const uid = (input as { accountUid?: unknown }).accountUid;
  return isValidAccountUid(uid) ? uid : null;
}

function appStateVisibleToRenderer(state: AppState): AppState {
  const visible: AppState = { ...state };
  delete visible.accountWindowSessions;
  return visible;
}

function appStateForAccount(uid: string): AppState & { uid: string } {
  const state = readAppState();
  const scoped = sessionForAccount(state.accountWindowSessions, uid);
  return {
    ...appStateVisibleToRenderer(state),
    uid,
    lastProjectId: scoped.lastProjectId,
    lastRootPath: scoped.lastRootPath,
    windows: scoped.windows,
  };
}

function hasOwnKey<T extends object>(obj: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function writeAccountAppState(
  uid: string,
  patch: Partial<AccountWindowSession>,
): void {
  const state = readAppState();
  writeAppState(mergeAccountWindowSessionIntoState(state, uid, patch));
}

function saveAppStateInput(
  input: Partial<AppState> & { accountUid?: unknown },
) {
  const accountUid = accountUidFromInput(input);
  const globalPatch: AppState = { ...input };
  delete (globalPatch as { accountUid?: unknown }).accountUid;

  if (accountUid) {
    const scopedPatch: Partial<AccountWindowSession> = {};
    if (hasOwnKey(input, "lastProjectId")) {
      scopedPatch.lastProjectId = input.lastProjectId;
      delete globalPatch.lastProjectId;
    }
    if (hasOwnKey(input, "lastRootPath")) {
      scopedPatch.lastRootPath = input.lastRootPath;
      delete globalPatch.lastRootPath;
    }
    if (hasOwnKey(input, "windows")) {
      scopedPatch.windows = input.windows as AccountWindowSession["windows"];
      delete globalPatch.windows;
    }

    if (Object.keys(scopedPatch).length > 0) {
      if (accountUid === activeAccountUid) {
        writeAccountAppState(accountUid, scopedPatch);
      } else {
        console.warn(
          `[AppState] Ignored stale account restore save for uid=${accountUid.slice(
            0,
            6,
          )} (active uid differs)`,
        );
      }
    }
  }

  writeAppState(globalPatch);
}

const persistedPowerSaveState = readAppState();
let powerSaveMode = normalizePowerSaveMode(
  persistedPowerSaveState.powerSaveMode,
  persistedPowerSaveState.preventSleepWhileWorking,
);
let preventSleepWhileWorking = powerSaveMode !== "off";
let workPowerSaveBlockerId: number | null = null;
let workPowerSaveRefCount = 0;
/**
 * ★Screen-lock state, tracked from powerMonitor lock-screen/unlock-screen
 * (ticket VCGuLWmNTlhoRvwGAKJA). null until the first event tells us — macOS
 * gives no synchronous getter, and guessing "unlocked" would put a fabricated
 * value into the journal on exactly the samples that matter most.
 */
let screenLocked: boolean | null = null;

const DEFAULT_DEMO_CELL_SCOPE = "default";
const MAX_DEMO_CELL_SCOPE_LENGTH = 120;
const MAX_DEMO_CELL_KEY_LENGTH = 120;
const MAX_DEMO_CELL_VALUE_LENGTH = 20_000;
const MAX_DEMO_CELL_COUNT = 2_000;

function normalizeDemoCellScope(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_DEMO_CELL_SCOPE;
  }
  if (typeof value !== "string") {
    throw new Error("demo cell scope must be a string");
  }
  const scope = value.trim();
  if (!scope) return DEFAULT_DEMO_CELL_SCOPE;
  if (scope.length > MAX_DEMO_CELL_SCOPE_LENGTH) {
    throw new Error(
      `demo cell scope must be ${MAX_DEMO_CELL_SCOPE_LENGTH} characters or fewer`,
    );
  }
  return scope;
}

function normalizeDemoCellValues(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("demo cell values must be a string map");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_DEMO_CELL_COUNT) {
    throw new Error(
      `demo cell values cannot exceed ${MAX_DEMO_CELL_COUNT} cells`,
    );
  }

  const normalized: Record<string, string> = {};
  for (const [cellKey, cellValue] of entries) {
    const key = cellKey.trim();
    if (!key) throw new Error("demo cell key cannot be empty");
    if (key.length > MAX_DEMO_CELL_KEY_LENGTH) {
      throw new Error(
        `demo cell key must be ${MAX_DEMO_CELL_KEY_LENGTH} characters or fewer`,
      );
    }
    if (typeof cellValue !== "string") {
      throw new Error("demo cell value must be a string");
    }
    if (cellValue.length > MAX_DEMO_CELL_VALUE_LENGTH) {
      throw new Error(
        `demo cell value must be ${MAX_DEMO_CELL_VALUE_LENGTH} characters or fewer`,
      );
    }
    normalized[key] = cellValue;
  }

  return normalized;
}

function readDemoCellValues(scope: string): Record<string, string> {
  return { ...(readAppState().demoCellValues?.[scope] ?? {}) };
}

function writeDemoCellValues(
  scope: string,
  values: Record<string, string>,
): void {
  const state = readAppState();
  writeAppState({
    demoCellValues: {
      ...(state.demoCellValues ?? {}),
      [scope]: values,
    },
  });
}

// --- Machine identity (shared-account multi-machine safety) ---
// john.kim signs into the same Firestore `agents/` collection from several
// machines (Mac + Windows). Without a per-machine owner, a second machine's
// boot rehydrates the WHOLE collection — foreign + stale docs included — which
// caused the "83 phantom agents on launch" incident. We stamp every agent doc
// this machine launches with a stable machineId, then scope boot-restore and
// reap to docs this machine actually owns. Foreign docs stay read-only.
let cachedMachineId: string | null = null;
function getMachineId(): string {
  if (cachedMachineId) return cachedMachineId;
  const state = readAppState();
  if (state.machineId) {
    cachedMachineId = state.machineId;
    return cachedMachineId;
  }
  // hostname+platform make it human-readable in the doc/board; the random UUID
  // guarantees uniqueness even if two machines share a hostname. Persisted so
  // it's stable across restarts — it must never silently change, or this
  // machine would orphan its own agents.
  const generated = `${os.hostname()}-${os.platform()}-${crypto.randomUUID()}`;
  writeAppState({ machineId: generated });
  cachedMachineId = generated;
  return cachedMachineId;
}

// Stamp this machine's ownership onto an agent doc, once per agent per session.
// Called from the AgentManager status callback, so it fires for every agent
// this machine actually launches (fresh spawn AND reconnect) regardless of
// which writer created the doc. setDoc(merge) is create-or-update: it never
// clobbers other fields and works even if the doc write hasn't landed yet.
// Re-stamping on reconnect also transfers ownership when a user manually
// ▶ Starts an agent that previously ran on another machine.
//
// Writes go through the mission firebase app (anonymous auth) — the same
// authed path WorktreeCoordinator uses for tasks/agents. The `agents` rule is
// isAuthenticated-only, so anon auth is sufficient; the unauthenticated
// flow-engine app would be rejected.
// Boot time of THIS Electron main process — stamped onto agent docs alongside
// the pid so a doc can be traced to a specific instance incarnation.
const instanceStartedAtMs = Date.now();
const stampedMachineAgentIds = new Set<string>();
function stampAgentMachineOwnership(agentId: string): void {
  if (!agentId || stampedMachineAgentIds.has(agentId)) return;
  stampedMachineAgentIds.add(agentId);
  void (async () => {
    try {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      await fbSetDoc(
        fbDoc(db, "agents", agentId),
        {
          machineId: getMachineId(),
          // Instance identity for the ghost reclaim (agent-lifecycle-reclaim):
          // lets the sweep distinguish "my dead previous instance's doc"
          // (reclaimable) from "another live Electron on this machine"
          // (untouchable — pid still alive).
          instancePid: process.pid,
          instanceStartedAt: instanceStartedAtMs,
        },
        { merge: true },
      );
    } catch (err) {
      // Allow a retry on the next status change rather than giving up forever.
      stampedMachineAgentIds.delete(agentId);
      console.warn(
        "[MachineId] Failed to stamp agent ownership:",
        agentId,
        err instanceof Error ? err.message : err,
      );
    }
  })();
}

// --- Resource lifecycle reclaim (ghost agent docs + stale task worktrees) ---
// 2026-07-19 incident: agents/ grew to 1,057 docs — 28 stuck at status=working
// from previous instances — because terminal status writes flowed only through
// the renderer (dead exactly when agents die) and cleanup_agents only scans
// AgentManager memory. See agent-lifecycle-reclaim.ts for the decision rules.

// Finalize a terminal agent status straight from MAIN. The renderer's
// agent:statusChanged listener is the normal writer, but it no longer exists
// when the last window closed or the app is tearing down — exactly the paths
// that strand docs at `working`. Terminal statuses only (stopped/error): they
// are low-volume and idempotent alongside the renderer's own write. App-quit's
// in-flight writes may still be cut off — the boot ghost sweep is the backstop.
function finalizeAgentStatusInFirestore(
  agentId: string,
  status: "stopped" | "error",
  // ★실행 종료 신호(#890 F-7 · 감사 G11). 이 세 값이 없으면 "실패" 를 무산출과
  // 모델 귀책으로 가를 수 없다 — 태스크 라벨 빌더(taskOutcome)가 여기서 스탬프된
  // 값을 읽어 errorCategory 를 정한다. 전부 숫자/불리언(비식별)이고, 값이 없으면
  // 키 자체를 쓰지 않아 기존 doc 형태를 건드리지 않는다.
  runSignals?: {
    outputChars?: number;
    lastExitCode?: number | null;
    noOutput?: boolean;
  },
): void {
  void (async () => {
    try {
      const { app: fbApp, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(fbApp);
      await fbSetDoc(
        fbDoc(db, "agents", agentId),
        {
          status,
          updatedAt: fbTimestamp.now(),
          ...(runSignals?.outputChars !== undefined
            ? { outputChars: runSignals.outputChars }
            : {}),
          ...(runSignals?.lastExitCode !== undefined &&
          runSignals?.lastExitCode !== null
            ? { lastExitCode: runSignals.lastExitCode }
            : {}),
          ...(runSignals?.noOutput !== undefined
            ? { noOutput: runSignals.noOutput }
            : {}),
        },
        { merge: true },
      );
      const release = await releaseTaskClaimsForDeadAgent(db, agentId);
      if (release.released > 0) {
        console.log(
          `[LifecycleReclaim] agent ${agentId} → ${status}: released ${release.released} claim(s), revived ${release.revived} task(s) to TODO`,
        );
      }
    } catch (err) {
      console.warn(
        "[LifecycleReclaim] terminal status finalize failed:",
        agentId,
        status,
        err instanceof Error ? err.message : err,
      );
    }
  })();
}

/**
 * 죽은 에이전트의 claim 을 회수한다.
 *
 * ★진단 §5.3-b 수정: 예전에는 `claimedBy`/`claimedAt` 만 지우고 `status` 를
 * `IN_PROGRESS` 로 남겨 뒀다. 그런데 `get_available_tasks` 는 TODO 만 쿼리하고
 * `claim_task` 는 TODO 가 아니면 거부한다 — **회수돼도 아무도 못 집는** 유령
 * 티켓이 됐다(실측 사례에서 9시간 방치). 이제 집혔지만 제출 전인 상태
 * (CLAIMED / IN_PROGRESS)만 TODO 로 되돌려 **실제로 되살린다**. REVIEW·BLOCKED·
 * 종결 상태는 손대지 않는다(taskStatusAfterClaimRelease 주석 참조).
 *
 * 반환: released = claim 을 푼 건수, revived = 그중 TODO 로 되살아나 다시 집을 수
 * 있게 된 건수. 회수가 **몇 건을 되살렸는지**가 로그에 남아야 한다.
 */
async function releaseTaskClaimsForDeadAgent(
  db: ReturnType<typeof getFirestore>,
  agentId: string,
): Promise<{ released: number; revived: number }> {
  const snap = await fbGetDocs(
    fbQuery(fbCollection(db, "tasks"), fbWhere("claimedBy", "==", agentId)),
  );
  let released = 0;
  let revived = 0;
  const now = fbTimestamp.now();
  for (const taskDoc of snap.docs) {
    const data = taskDoc.data() as {
      claimedBy?: string | null;
      status?: unknown;
    };
    if (
      !shouldReleaseClaimForStoppedAgent({
        claimedBy: data.claimedBy ?? null,
        stoppedAgentId: agentId,
      })
    ) {
      continue;
    }
    const revivedStatus = taskStatusAfterClaimRelease(data.status);
    await fbUpdateDoc(fbDoc(db, "tasks", taskDoc.id), {
      claimedBy: null,
      claimedAt: null,
      ...(revivedStatus ? { status: revivedStatus } : {}),
      updatedAt: now,
    });
    released++;
    if (revivedStatus) {
      revived++;
      console.log(
        `[LifecycleReclaim] task revived: ${taskDoc.id} ${String(
          data.status,
        )} → ${revivedStatus} (claim released from dead agent ${agentId})`,
      );
    }
  }
  return { released, revived };
}

/** pid liveness ON THIS MACHINE. EPERM = exists but not ours → alive. */
function isPidAliveOnThisMachine(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const GHOST_RECLAIM_BOOT_DELAY_MS = 60_000; // let agent:reconnect repopulate memory first
const GHOST_RECLAIM_INTERVAL_MS = 10 * 60_000;
// ★에이전트 heartbeat 영속화 주기 (진단 §5.3-a 수정).
//
// `agent.lastMcpCall` 은 그 에이전트의 MCP 툴 호출이 서버에 닿은 시각이고, 지금은
// **이 인스턴스의 메모리에만** 있다(bridge /agent-mcp-heartbeat 가 찍는다 — 그
// 엔드포인트는 의도적으로 Firestore 를 건드리지 않는 초경량 생존 시계다).
// 그런데 고아 판정은 **다른 인스턴스가 남긴 문서**를 보고 하므로, 메모리 안에만
// 있는 시계로는 "이 에이전트가 아직 살아 있는가"를 답할 수 없었다 — 그래서 Electron
// pid 라는 엉뚱한 축을 대신 봤고, 앱이 안 죽으면 에이전트가 죽어도 영원히 고아였다.
//
// 여기서 그 시계를 주기적으로 문서에 흘려 둔다. 값이 **변했을 때만** 쓰므로 조용한
// 에이전트에는 쓰기가 0이고(그게 곧 stale 신호다), 60초 주기라 60분 임계에 비해
// 해상도가 충분히 촘촘하다.
const HEARTBEAT_FLUSH_INTERVAL_MS = 60_000;
const WORKTREE_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
// 원장 체크포인트: 부팅 직후 1회(제네시스를 일찍 찍어 보증 구간을 앞당긴다) +
// 주기. 최근 몇 장만 읽어 연속성을 본다 — 전량 스캔은 프로젝트가 오래될수록 비싸다.
const LEDGER_CHECKPOINT_BOOT_DELAY_MS = 90_000;
const CHECKPOINT_HISTORY_WINDOW = 50;
// Firestore-read cap per worktree sweep so a large backlog (696 trees at the
// time of writing) can't turn one sweep into hundreds of task lookups. The
// backlog drains across sweeps; steady-state counts fit in one.
const WORKTREE_SWEEP_TASK_LOOKUP_CAP = 20;
// Rotating scan offset (per app run) so capped sweeps cover the whole backlog
// over time instead of re-checking the same head of the list.
let worktreeSweepCursor = 0;

interface GhostReclaimSweepResult {
  scanned: number;
  reclaimed: Array<{ id: string; name: string; reason: string }>;
  /** 회수로 TODO 까지 되돌아가 **다시 집을 수 있게 된** 티켓 수(진단 §5.3-b). */
  revivedTasks: number;
}

// Mark this machine's ghost agent docs (previous/dead instances) stopped.
// Never kills a process, never deletes a doc, preserves currentTaskId; docs of
// other machines / other live instances are untouchable by the decision gate.
async function runGhostReclaimSweep(): Promise<GhostReclaimSweepResult> {
  const { app: fbApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(fbApp);
  const snap = await fbGetDocs(
    fbQuery(
      fbCollection(db, "agents"),
      fbWhere("machineId", "==", getMachineId()),
    ),
  );
  const now = Date.now();
  const reclaimed: GhostReclaimSweepResult["reclaimed"] = [];
  let revivedTasks = 0;
  const docs: Array<{ id: string; data: Record<string, unknown> }> = [];
  snap.forEach((d) => docs.push({ id: d.id, data: d.data() }));
  for (const { id, data } of docs) {
    const decision = evaluateGhostReclaim({
      status: data.status,
      machineId: typeof data.machineId === "string" ? data.machineId : null,
      instancePid:
        typeof data.instancePid === "number" ? data.instancePid : null,
      role: typeof data.role === "string" ? data.role : null,
      lastTouchedAtMs:
        watchdogMillis(data.updatedAt) ?? watchdogMillis(data.createdAt),
      thisMachineId: getMachineId(),
      thisPid: process.pid,
      inMemory: !!agentManager.getAgent(id),
      isPidAlive: isPidAliveOnThisMachine,
      now,
      // ★에이전트 자신의 시계. 이게 최근이면 어떤 경로로도 회수하지 않고,
      // 임계를 넘겨 끊겼을 때만 "이 머신의 다른 Electron 이 살아 있다" 가드를
      // 넘어선다. 없으면(한 번도 관측 안 됨) 판정은 예전과 완전히 동일하다.
      lastHeartbeatAtMs: watchdogMillis(data.lastHeartbeatAt),
    });
    if (!decision.reclaim) continue;
    try {
      await fbSetDoc(
        fbDoc(db, "agents", id),
        { status: "stopped", updatedAt: fbTimestamp.now() },
        { merge: true },
      );
      const release = await releaseTaskClaimsForDeadAgent(db, id);
      revivedTasks += release.revived;
      const name = typeof data.name === "string" ? data.name : id;
      reclaimed.push({ id, name, reason: decision.reason });
      console.log(
        `[LifecycleReclaim] ghost reclaimed: ${name} — ${decision.reason}`,
      );
    } catch (err) {
      console.warn(
        "[LifecycleReclaim] ghost mark-stopped failed:",
        id,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { scanned: docs.length, reclaimed, revivedTasks };
}

/**
 * 이 인스턴스가 호스팅하는 에이전트들의 **자기 heartbeat** 를 문서로 흘린다.
 *
 * 무엇을 쓰는가: `agent.lastMcpCall` — 그 에이전트가 스스로 한 마지막 MCP 툴 호출이
 * 서버에 닿은 시각. 우리가 보내서 얻는 값이 아니라 에이전트의 실제 활동이 남긴
 * 흔적이라, "working 으로 보인다"(PTY 바이트에서 파생돼 양방향 오판이 나는 표시)와
 * 달리 살아있음의 근거로 쓸 수 있다.
 *
 * ★값이 변했을 때만 쓴다. 조용한 에이전트는 쓰기가 0이고, 그 침묵 자체가 판정
 *   재료다. 실패는 전부 삼킨다 — 이건 보조 시계이지 정합성 축이 아니다.
 */
const lastFlushedHeartbeat = new Map<string, number>();
async function flushAgentHeartbeats(): Promise<void> {
  const live = agentManager
    .listAgents()
    .filter((a) => typeof a.lastMcpCall === "number" && a.lastMcpCall !== null);
  if (live.length === 0) return;
  const { app: fbApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(fbApp);
  for (const agent of live) {
    const at = agent.lastMcpCall as number;
    if (lastFlushedHeartbeat.get(agent.id) === at) continue;
    try {
      await fbSetDoc(
        fbDoc(db, "agents", agent.id),
        { lastHeartbeatAt: fbTimestamp.fromMillis(at) },
        { merge: true },
      );
      lastFlushedHeartbeat.set(agent.id, at);
    } catch {
      /* best-effort — 다음 주기에 다시 시도한다 */
    }
  }
}

interface WorktreeSweepResult {
  /** Task worktree dirs currently on disk (pre-sweep). */
  total: number;
  checked: number;
  removed: string[];
  preserved: number;
}

// Reap worktrees whose task is already terminal (DONE/FAILED) — the catch-all
// for every path the DONE-time /reap-worktree trigger misses (board-UI status
// changes, app-quit races, other projects). Reuses the manager's work-loss
// guard: dirty / unmerged-unpushed trees are always preserved.
async function runWorktreeTerminalSweep(): Promise<WorktreeSweepResult> {
  const root = worktreeManager.getWorktreesRoot();
  const candidates: Array<{ taskId: string; path: string }> = [];
  try {
    for (const proj of fs.readdirSync(root, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue;
      const projPath = path.join(root, proj.name);
      let taskDirs: fs.Dirent[];
      try {
        taskDirs = fs.readdirSync(projPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const t of taskDirs) {
        if (!t.isDirectory()) continue;
        const wtPath = path.join(projPath, t.name);
        // Only the canonical <root>/<projectId>/<taskId> layout is sweepable.
        if (parseWorktreeTaskPath(root, wtPath, path.sep)) {
          candidates.push({ taskId: t.name, path: wtPath });
        }
      }
    }
  } catch {
    return { total: 0, checked: 0, removed: [], preserved: 0 };
  }

  const result: WorktreeSweepResult = {
    total: candidates.length,
    checked: 0,
    removed: [],
    preserved: 0,
  };
  if (candidates.length === 0) return result;

  const { app: fbApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(fbApp);

  // Rotate the scan start across sweeps: with a large backlog and a per-sweep
  // lookup cap, a fixed readdir order would re-check the same first N trees
  // forever and starve the tail.
  const start = worktreeSweepCursor % candidates.length;
  const ordered = candidates.slice(start).concat(candidates.slice(0, start));

  for (const c of ordered) {
    if (result.checked >= WORKTREE_SWEEP_TASK_LOOKUP_CAP) break;

    // Live-agent guard: any in-memory agent working out of this tree defers it.
    const busy = agentManager
      .listAgents()
      .some(
        (a) =>
          a.status !== "stopped" &&
          a.status !== "error" &&
          !!a.cwd &&
          (a.cwd === c.path || a.cwd.startsWith(c.path + path.sep)),
      );
    if (busy) continue;

    result.checked++;
    let taskStatus: string | null = null;
    try {
      const td = await fbGetDoc(fbDoc(db, "tasks", c.taskId));
      taskStatus = td.exists()
        ? ((td.data() as { status?: string }).status ?? null)
        : null;
    } catch {
      continue; // lookup failure → preserve
    }
    if (!isWorktreeSweepEligibleTaskStatus(taskStatus)) continue;

    // The worktree's own .git file names the main repo — no project registry
    // needed, works for every repo that ever created trees here.
    let repoRoot: string | null = null;
    try {
      repoRoot = deriveRepoRootFromGitFile(
        fs.readFileSync(path.join(c.path, ".git"), "utf-8"),
      );
    } catch {
      repoRoot = null;
    }
    if (!repoRoot || !fs.existsSync(repoRoot)) continue;

    try {
      const res = await worktreeManager.reap(repoRoot, c.path, {});
      if (res.removed) {
        result.removed.push(c.path);
        console.log(
          `[LifecycleReclaim] worktree reaped: ${c.path} — ${res.reason}`,
        );
      } else {
        result.preserved++;
      }
    } catch (err) {
      console.warn(
        "[LifecycleReclaim] worktree reap failed:",
        c.path,
        err instanceof Error ? err.message : err,
      );
    }
  }
  worktreeSweepCursor = start + result.checked;
  // Reuse #497's cause-side invalidation instead of duplicating it. The IPC
  // paths (worktree:remove / cleanupStale) already notify on removal, but this
  // sweep reaps from the main process and never goes through them — without
  // this call an open window rooted at a swept tree keeps a dead rootPath and
  // that path is persisted to app-state.json at quit (ticket failure mode (c):
  // "삭제된 워크트리 rootPath 로 오케 즉사"). No double-fire risk: a given
  // removal travels exactly one of the two routes, and the handler no-ops when
  // no window matches.
  if (result.removed.length > 0) invalidateRemovedWorktreeRoots(result.removed);
  return result;
}

// Accumulation visibility (fix 4): count, warn past thresholds, never delete.
async function reportAccumulation(worktreeCount: number | null): Promise<void> {
  let agentDocs: number | null = null;
  try {
    const { app: fbApp, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(fbApp);
    const agg = await fbGetCountFromServer(fbCollection(db, "agents"));
    agentDocs = agg.data().count;
  } catch {
    agentDocs = null;
  }
  console.log(
    `[LifecycleReclaim] accumulation: agents=${agentDocs ?? "?"} worktrees=${
      worktreeCount ?? "?"
    }`,
  );
  const decision = evaluateAccumulationAlert({
    counts: { agentDocs, worktrees: worktreeCount },
    lastAlertAtMs: readAppState().lastAccumulationAlertAt ?? null,
    now: Date.now(),
  });
  if (!decision.alert || !decision.message) return;
  writeAppState({ lastAccumulationAlertAt: Date.now() });
  console.warn("[LifecycleReclaim]", decision.message);
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: "Marblo 리소스 누적 경고",
        body: decision.message,
      }).show();
    }
  } catch {
    /* notification is best-effort */
  }
}

// One full pass: ghosts, then worktrees, then the accumulation report.
// Overlap-guarded so a slow sweep can't stack on the next timer tick.
let lifecycleSweepRunning = false;
async function runLifecycleReclaimSweep(trigger: string): Promise<void> {
  if (lifecycleSweepRunning) return;
  lifecycleSweepRunning = true;
  try {
    const ghosts = await runGhostReclaimSweep().catch((err) => {
      console.warn(
        "[LifecycleReclaim] ghost sweep failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    const wt = await runWorktreeTerminalSweep().catch((err) => {
      console.warn(
        "[LifecycleReclaim] worktree sweep failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    console.log(
      `[LifecycleReclaim] sweep(${trigger}): scanned ${
        ghosts?.scanned ?? 0
      } own docs, reclaimed ${ghosts?.reclaimed.length ?? 0} ghost(s), ` +
        `revived ${ghosts?.revivedTasks ?? 0} task(s) back to TODO; ` +
        `worktrees ${
          wt
            ? `${wt.removed.length} reaped / ${wt.preserved} preserved / ${wt.total} on disk`
            : "skipped"
        }`,
    );
    await reportAccumulation(wt ? wt.total - wt.removed.length : null);
  } finally {
    lifecycleSweepRunning = false;
  }
}

// ── 감사 원장 L3 — 주기적 머클 체크포인트 (스펙 §6) ────────────────
//
// 체인 봉인은 에이전트별 MCP 서버가 한다(경합 없음이 §6 의 요점). 그래서 어떤 MCP
// 서버도 *다른* 체인의 존재를 모르고, 자기 체인이 통째로 지워져도 자기는 이미 죽고
// 없다. 여러 체인을 가로질러 볼 수 있는 관측자가 따로 있어야 "있어야 할 체인이
// 없다"를 말할 수 있고, 앱 생애 내내 사는 프로세스는 메인뿐이다.
//
// ★#406/#428 교훈에 따라 **감사 보조 장치가 앱을 죽이지 않게** 한다: 모든 실패를
// 삼키고 다음 주기에 재시도한다(§11). 타이머는 unref — 종료를 붙잡지 않는다.

/** 체크포인트를 찍을 프로젝트 = 이 머신에서 에이전트가 돌고 있는 프로젝트. */
function projectIdsForCheckpoint(): string[] {
  const ids = new Set<string>();
  for (const agent of agentManager.listAgents()) {
    const pid = agent.launchConfig?.env?.MARBLO_PROJECT;
    if (typeof pid === "string" && pid.trim()) ids.add(pid.trim());
  }
  return [...ids];
}

/** Firestore 문서 → 검증용 체인 엔트리. 체인 필드가 없으면 제네시스 이전 기록이다. */
function toChainEntry(
  id: string,
  data: Record<string, unknown>,
): LedgerChainEntry {
  const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
  return {
    id,
    occurredAtMs:
      typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : 0,
    // 저장된 문서를 **그대로** 넘긴다. 필드를 골라 담으면 해시 입력이 저장 내용과
    // 어긋나 멀쩡한 기록이 변조로 보고된다.
    event: data as LedgerChainEntry["event"],
  };
}

let ledgerCheckpointRunning = false;
async function runLedgerCheckpointSweep(trigger: string): Promise<void> {
  if (ledgerCheckpointRunning) return;
  ledgerCheckpointRunning = true;
  try {
    const projectIds = projectIdsForCheckpoint();
    if (projectIds.length === 0) return;

    const { app: fbApp, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(fbApp);

    for (const projectId of projectIds) {
      const result = await runCheckpointCycle(projectId, {
        now: () => Date.now(),
        // 최근 N 장만 읽는다 → 창이므로 제네시스 부재를 이상으로 보지 않는다.
        checkpointsWindowed: true,
        loadCheckpoints: async () => {
          const snap = await fbGetDocs(
            fbQuery(
              fbCollection(db, "ledger_checkpoints"),
              fbWhere("projectId", "==", projectId),
              fbOrderBy("seqNo", "desc"),
              fbLimit(CHECKPOINT_HISTORY_WINDOW),
            ),
          );
          const out: LedgerCheckpoint[] = [];
          snap.forEach((d) => out.push(d.data() as LedgerCheckpoint));
          return out;
        },
        loadRecentEvents: async (_pid, limit) => {
          const snap = await fbGetDocs(
            fbQuery(
              fbCollection(db, "audit_logs"),
              fbWhere("projectId", "==", projectId),
              fbOrderBy("createdAt", "desc"),
              fbLimit(limit),
            ),
          );
          const out: LedgerChainEntry[] = [];
          snap.forEach((d) =>
            out.push(toChainEntry(d.id, d.data() as Record<string, unknown>)),
          );
          return out;
        },
        writeCheckpoint: async (cp) => {
          // 결정적 문서 id — 재시도가 중복 장을 만들지 않는다(원장에서 같은 봉인이
          // 두 벌 보이면 그 자체가 증거의 오염이다).
          await fbSetDoc(
            fbDoc(db, "ledger_checkpoints", `${cp.projectId}_${cp.seqNo}`),
            { ...cp, createdAt: fbTimestamp.fromMillis(cp.atMs) },
          );
        },
      });

      const notice = formatCycleNotice(result);
      if (notice) console.warn(notice);
      else if (result.genesis) {
        console.log(
          `[Ledger] ${projectId} — 제네시스 체크포인트를 찍었습니다. ` +
            `이후 기록부터 무결성이 보증됩니다(이전 기록은 미보증으로 표기).`,
        );
      }
    }
  } catch (err) {
    // 감사 보조 장치가 앱을 죽이지 않는다. 다음 주기에 재시도한다(§11).
    console.warn(
      `[Ledger] 체크포인트 스윕(${trigger}) 실패 — 다음 주기에 재시도합니다:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    ledgerCheckpointRunning = false;
  }
}

// Disable QUIC protocol — prevents ERR_QUIC_PROTOCOL_ERROR with Firestore in Electron
app.commandLine.appendSwitch("disable-quic");

// Rendering optimization
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

// Enable remote debugging in dev mode — port 0 lets OS pick a free port
// (avoids "Address already in use" when restarting before previous instance fully releases)
if (!app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

// MARBLO_FORCE_PROD=1 lets you run a production-style local server (loads
// from ./dist instead of Vite dev) without packaging. Used for perf
// comparison: prod build skips HMR + dev-only React work.
const isDev = process.env.MARBLO_FORCE_PROD !== "1" && !app.isPackaged;
const updater = new Updater();
const ptyManager = new PtyManager();
// Periodic sweep to reclaim any PTY master fd leaked by a session whose child
// died without a clean teardown — belt-and-suspenders against macOS
// kern.tty.ptmx_max exhaustion (posix_spawnp failed on new terminals/agents).
ptyManager.startReaper();
// Periodic sweep to SIGKILL orphaned per-agent marblo MCP servers
// (`dist-mcp/index.js`) whose CLI exited without them — e.g. Codex's detached
// MCP child, or any agent that completed/crashed on its own. Explicit kills are
// already handled by PtyManager.killProcessTree; this catches the natural-exit
// orphans that reparent to launchd (ppid=1) and would otherwise accumulate.
startMcpOrphanReaper();
const fsManager = new FsManager();
// Bridges the cross-machine `pendingInstructions` Firestore queue to local
// PTYs. attach/detach is driven by agent spawn / stop lifecycle below.
const pendingListener = new PendingInstructionListener(ptyManager, {
  // ★전달 실패는 조용히 넘어가지 않는다(P5-2). 원장에 delivered 로 찍힌 지시가
  // 끝내 PTY 에 못 들어가면 — 오케가 보낸 "답변"이 여기 해당한다 — 그 사실을
  // 오케 PTY 로 되돌려 준다. 오케가 다시 보내거나 사장님께 올릴 수 있게.
  onDeliveryFailure: (failure) => {
    // ★보류(deferred)는 permanent 가 아니어도 **반드시** 알린다
    // (티켓 RtyOMpOArfI7a5JNSzsg). 컴포저에 남의 초안이 있어 일부러 쓰지 않은
    // 경우인데, 이걸 조용히 큐에만 넣으면 오케 입장에서는 "답을 보냈는데 반응이
    // 없다" 와 구별되지 않는다 — #1160 이 55분 공백을 오독했던 바로 그 모양이다.
    // 나머지 재시도 여지가 남은 실패는 종전대로 조용히 지나간다.
    if (!failure.permanent && !failure.deferred) return;
    const projectId = failure.agentId.startsWith("orch-")
      ? failure.agentId.slice("orch-".length)
      : (projectIdForAgent(failure.agentId) ?? "");
    if (!projectId) return;
    const orch = orchestrators.get(projectId);
    // 오케 자신에게 못 넣은 경우는 알릴 통로가 그 PTY 뿐이라 재주입해봐야
    // 같은 이유로 실패한다 — 콘솔 기록(큐가 이미 남김)으로만 끝낸다.
    if (!orch || failure.agentId === `orch-${projectId}`) return;
    void orch.injectMessage(
      failure.deferred
        ? `[전달 보류] 에이전트 ${failure.agentId} 에게 아직 보내지 않았습니다 ` +
            `(사유: ${failure.deferred} — ${failure.reason}). ` +
            `상대 컴포저에 남의 초안이 물려 있거나 확인 다이얼로그 앞이라 지금 쓰면 ` +
            `내용이 섞이거나 선택이 눌립니다. 지우지도 대신 제출하지도 않았고, ` +
            `컴포저가 비는 즉시 자동으로 재전송합니다 — 이 메시지는 "안 갔다" 는 ` +
            `사실을 알리는 것이지 다시 보내 달라는 뜻이 아닙니다.\n` +
            `--- 보류된 원문 (doc=${failure.docId}) ---\n${failure.message}`
        : `[전달 실패] 에이전트 ${failure.agentId} 의 PTY 주입이 ${failure.attempts}회 시도 후 실패했습니다 ` +
            `(사유: ${failure.reason}). 아래 내용은 전달되지 않았습니다 — 필요하면 다시 보내세요.\n` +
            `--- 미전달 원문 (doc=${failure.docId}) ---\n${failure.message}`,
    );
  },
});
// Helper used by AgentManager callbacks to route project-scoped events.
// Looks up the agent's project from its launchConfig env (set at spawn).
function projectIdForAgent(agentId: string): string | undefined {
  const agent = agentManager?.getAgent(agentId);
  return agent?.launchConfig?.env?.MARBLO_PROJECT;
}

// Late-bound by the mission-engine wire block below — declared here so the
// agent status callback can forward `idle`/`stopped` transitions to the
// MissionEngine event bus without reordering construction.
let missionBundle: BuiltMissionEngine | null = null;

const agentManager = new AgentManager(
  ptyManager,
  (agentId, status) => {
    refreshWorkPowerSaveBlocker();
    // Claim machine ownership of this agent's doc — AgentManager only ever
    // tracks agents THIS machine launched, so any agentId here is ours. Stamps
    // once per session; enables machine-scoped boot-restore / reap on a shared
    // account (see stampAgentMachineOwnership / agent:reconnect).
    stampAgentMachineOwnership(agentId);
    // Terminal statuses are ALSO written from main (renderer-independent) so a
    // crash/force-kill/normal-exit can't strand the doc at `working` when no
    // window is alive to sync it (agent-lifecycle-reclaim fix 1).
    if (status === "stopped" || status === "error") {
      const ended = agentManager?.getAgent(agentId);
      // ★산출량을 모르면(에이전트가 이미 정리됨) noOutput 을 **쓰지 않는다**.
      // false 로 적으면 "산출이 있었다" 는, 근거 없는 주장이 doc 에 남는다.
      const outputChars = ended?.outputChars;
      finalizeAgentStatusInFirestore(agentId, status, {
        outputChars,
        lastExitCode: ended?.lastExitCode,
        noOutput:
          typeof outputChars === "number"
            ? isNoOutputRun(outputChars)
            : undefined,
      });
    }
    // Free the pending-instruction listener once the agent is fully gone.
    // "error" is transient (auto-restart may follow), only "stopped" is final.
    if (status === "stopped") {
      pendingListener.detach(agentId);
    }
    const pid = projectIdForAgent(agentId);
    if (pid) sendToProject(pid, "agent:statusChanged", { agentId, status });
    else broadcast("agent:statusChanged", { agentId, status });
    // Mission-engine wake signal — only after build (post-bridgeServer).
    missionBundle?.forwardAgentStatus(agentId, status);
  },
  (rootPath, sessionId, label, agentId, spawnedModel) => {
    const agent = agentManager.getAgent(agentId);
    const model = agent?.model || "claude";
    // ★비용 트래커에 넘길 **구체 모델 id**. 두 출처를 이 순서로 본다:
    //   1) `spawnedModel` — AgentManager 가 방금 만든 argv 에서 되읽어 실어준 값.
    //      claude 분기는 `agents.set` 보다 먼저 발화하므로 위 조회(getAgent)가
    //      아직 undefined 다 — 이 인자가 유일한 근거다.
    //   2) resolveConcreteModel(agentId) — 지연 발화 경로(codex·gemini 는 8s 뒤
    //      타이머)에서 유효하며, argv 핀이 없으면 과금 관측으로 떨어진다.
    // 둘 다 없으면 undefined 를 넘기고 트래커가 종전 기본값을 쓴다 — CLI 기본
    // 모델을 우리가 지어내지 않는다.
    const seedModel =
      spawnedModel || agentManager.resolveConcreteModel(agentId)?.modelId;
    if (model === "antigravity") {
      // agy 는 ~/.gemini/antigravity-cli/conversations/<UUID>.{pb,db} 가 cwd
      // 무관하게 섞이므로 claude 의 cwd 기반 labels.json 으로는 매칭 불가.
      // 별도 marblo-agy-labels.json 에 agentId → conversation UUID 매핑을 저장.
      saveAgyConversationLabel(agentId, sessionId, label);
      // 비용 추적: 해당 conversation 의 SQLite 스토어(gen_metadata)를 폴링한다.
      // labels 저장 직후 시작해야 트래커가 agentId→UUID 로 스토어를 찾는다.
      costTracker.trackSession(agentId, rootPath, sessionId, model);
      return;
    }
    if (isCliHomeTracked(model)) {
      // Codex/Gemini/Grok resume 는 네이티브(--last / --resume latest)라 UUID
      // 라벨을 저장할 필요가 없다. 파일 기반 비용 추적만 시작 — 트래커가
      // per-agent CLI home 아래 최신 세션 파일을 스스로 찾고, 아직 없으면 다음
      // 폴에서 잡는다 (유실 없음).
      //
      // ★grok 이 이 분기에 없던 동안엔 아래 claude 분기로 흘러 클로드용
      // saveSessionLabel(빈 sessionId)까지 탔다 — 지금은 자기 경로로 온다.
      costTracker.trackSession(agentId, rootPath, null, model, seedModel);
      return;
    }
    // File-IO method, project-agnostic — any orchestrator instance works.
    getAnyOrchestrator().saveSessionLabel(rootPath, sessionId, label, agentId);
    // Start tracking JSONL session file for token usage
    costTracker.trackSession(agentId, rootPath, sessionId, model, seedModel);
  },
  // Auto-restart callbacks
  (agentId, attempt, maxAttempts) => {
    const pid = projectIdForAgent(agentId);
    if (pid)
      sendToProject(pid, "agent:restartAttempt", {
        agentId,
        attempt,
        maxAttempts,
      });
    else broadcast("agent:restartAttempt", { agentId, attempt, maxAttempts });
  },
  (agentId, exitCode) => {
    const pid = projectIdForAgent(agentId);
    if (pid) sendToProject(pid, "agent:restartFailed", { agentId, exitCode });
    else broadcast("agent:restartFailed", { agentId, exitCode });
    // KG feedback (spec §7): a terminal crash (restart budget exhausted). The
    // agent doc is still in the manager here — read its task/model/role/restart
    // count so the graph-updater can classify crash_loop vs a bad-host spawn
    // fail and attribute it to the right cells. Best-effort, fire-and-forget.
    try {
      const a = agentManager.getAgent(agentId);
      if (a) {
        // Record even when the agent has NO currentTaskId — a crash between
        // tasks (or after markTurnComplete nulled it) is still a real negative
        // signal for (role × model). Without a taskId we can't backfill
        // taskType/complexity from dispatchMeta, but role+model alone is enough
        // to fold a negative into the role cell (the graph was learning ONLY
        // positives before this). agentId still seeds the idempotency key.
        void graphUpdater.recordOutcome({
          taskId: a.currentTaskId ?? null,
          agentId,
          model: a.model,
          rawOutcome: "crashed",
          hints: {
            restartCount: a.restartCount,
            errorCategory: "runtime_crash",
          },
          ctx: { role: a.role },
        });
      }
    } catch {
      // never let graph bookkeeping affect crash handling
    }
  },
  () => mainWindow,
  // ★An agent is waiting on a PERSON (agent-input-wait.ts). Same per-project
  // scoping as agent:statusChanged above: the notification belongs in the
  // window showing that agent's board, and the broadcast fallback keeps
  // single-window / pre-registration setups working.
  (event) => {
    const pid = event.projectId || projectIdForAgent(event.agentId);
    if (pid) sendToProject(pid, "agent:inputWait", event);
    else broadcast("agent:inputWait", event);
  },
);

let mainWindow: BrowserWindow | null = null; // First window — fallback for things lacking owner
const allWindows = new Set<BrowserWindow>();

// --- Shared static server (production) -------------------------------------
// Every window MUST load from ONE stable origin (http://127.0.0.1:<port>).
// Firebase auth persistence (localStorage / IndexedDB) is keyed by web origin,
// and the origin includes the port. The old code spun up a fresh
// http.createServer on `listen(0)` (a random free port) INSIDE createWindow,
// so each window got a different origin — a newly opened window (e.g. "새 창"
// / a detached Board pop-out) could not see the first window's persisted
// session and fell back to the login screen. A single shared server keeps the
// origin identical across every window, and by reusing the persisted port it
// keeps it stable across app launches too (so a restart no longer forces
// re-login). See src/lib/firebase.ts for the origin-scoped persistence chain.
let staticServer: http.Server | null = null;
let staticServerStart: Promise<number> | null = null;

function buildStaticServer(): http.Server {
  const distPath = path.join(__dirname, "../dist");
  return http.createServer((req, res) => {
    // Strip query string / fragment and percent-decode before touching the fs,
    // so `/index.html?v=1` and `%2e%2e` are handled correctly.
    const rawPath = (req.url || "/").split(/[?#]/, 1)[0];
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(rawPath);
    } catch {
      urlPath = rawPath;
    }
    let filePath = path.normalize(
      path.join(distPath, urlPath === "/" ? "index.html" : urlPath),
    );
    // Path-traversal guard: reject anything that escapes distPath (e.g.
    // `GET /../../../.marblo/bridge-token`) with 403 rather than serving it.
    if (!filePath.startsWith(distPath + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    // Serve only regular files; SPA-fallback to index.html for missing paths
    // and for directories (a dir path would make createReadStream throw EISDIR).
    let isFile = false;
    try {
      isFile = fs.statSync(filePath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      filePath = path.join(distPath, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      // Chromium refuses to evaluate a module script served as
      // application/octet-stream, so the Code tab's notebook kernel (Pyodide,
      // dist/pyodide/*.mjs) would fail to load in packaged builds without this.
      ".mjs": "application/javascript",
      // instantiateStreaming needs the real wasm type; .whl/.zip are the
      // vendored Python wheels + stdlib the same runtime fetches.
      ".wasm": "application/wasm",
      ".whl": "application/zip",
      ".zip": "application/zip",
    };
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    const stream = fs.createReadStream(filePath);
    // Without this, a stream error (e.g. TOCTOU delete between statSync and
    // open, or EISDIR) is an uncaught exception that crashes the main process
    // and white-screens every window. Headers are already sent, so just end.
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    });
    stream.pipe(res);
  });
}

// Start (once) the shared static server and resolve its port. Idempotent — all
// callers share one Promise, so concurrent createWindow() calls during session
// restore converge on the same origin. Prefers the port persisted last launch;
// on EADDRINUSE (or any bind error) it retries once on a random free port.
function startStaticServer(): Promise<number> {
  if (staticServerStart) return staticServerStart;
  staticServerStart = new Promise<number>((resolve) => {
    const preferredPort = readAppState().staticServerPort ?? 0;

    const bind = (port: number, allowFallback: boolean) => {
      const server = buildStaticServer();
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        try {
          server.close();
        } catch {
          /* not yet listening */
        }
        if (allowFallback) {
          console.warn(
            `[Marblo] static port ${port} unavailable (${err.code}); ` +
              "retrying on a random free port (auth persistence resets this launch)",
          );
          bind(0, false);
        } else {
          console.error("[Marblo] Shared static server failed to start:", err);
          resolve(0);
        }
      };
      const onListening = () => {
        server.removeListener("error", onError);
        // Keep a benign handler so a later runtime error can't crash the app.
        server.on("error", (e) =>
          console.error("[Marblo] Static server runtime error:", e),
        );
        const addr = server.address();
        const boundPort = typeof addr === "object" && addr ? addr.port : 0;
        staticServer = server;
        // Persist so the next launch reuses the same origin.
        if (boundPort) writeAppState({ staticServerPort: boundPort });
        console.log(
          `[Marblo] Shared static server on http://127.0.0.1:${boundPort}`,
        );
        resolve(boundPort);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };

    // Only allow the fallback path when we actually asked for a specific port.
    bind(preferredPort, preferredPort !== 0);
  });
  return staticServerStart;
}

/** Broadcast an IPC event to all open windows */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

/**
 * Broadcast a Telegram channel health report to the renderer so the UI can
 * surface "webhook cleared" / "poller may be deaf — reconnect" states. The
 * report carries no secret material (see telegram-health.ts).
 */
function emitTelegramHealth(report: ChannelHealthReport): void {
  // Fold in the per-project outbound/inbound reliability counters (unanswered
  // inbounds, failed sends) so the 4-min health channel surfaces silent loss.
  // Loud log when any counter is non-zero — never let a drop pass unnoticed.
  const reliability = telegramPoller.getReliabilityStats(report.projectId);
  if (reliability.unanswered > 0 || reliability.sendFailures > 0) {
    console.warn(
      `[TelegramHealth] project=${report.projectId} reliability — unanswered inbounds=${reliability.unanswered}, failed sends=${reliability.sendFailures}`,
    );
  }
  // ★경합 상태를 같이 실어 보낸다 (티켓 hAzP05kOTxggd8LhZGwT). 지금까지 409 는
  // maybeDiagnose409 의 log.warn 으로만 나가서 사용자가 전혀 볼 수 없었다 —
  // 이 필드가 채널 설정 화면의 배너/배지가 읽는 바로 그 값이다.
  const contention = telegramPoller.getContention(report.projectId);
  if (contention.kind !== "none") {
    console.warn(
      `[TelegramHealth] project=${report.projectId} contention=${contention.kind}` +
        (contention.hostLabel ? ` holder=${contention.hostLabel}` : "") +
        ` consecutive409=${contention.consecutive409}`,
    );
  }
  broadcast("telegram:health", { ...report, reliability, contention });
}

/**
 * Broadcast a Slack channel health report to the renderer — the mirror of
 * emitTelegramHealth. The report carries no secret material (slack-health.ts),
 * and the folded-in reliability counters are what make silent loss visible:
 * unanswered inbounds, failed sends, and inbounds dropped because the
 * orchestrator stayed offline long enough to overflow the pending queue.
 */
function emitSlackHealth(report: SlackChannelHealthReport): void {
  const reliability = slackPoller.getReliabilityStats(report.projectId);
  if (
    reliability.unanswered > 0 ||
    reliability.sendFailures > 0 ||
    reliability.droppedOverflow > 0
  ) {
    console.warn(
      `[SlackHealth] project=${report.projectId} reliability — unanswered inbounds=${reliability.unanswered}, ` +
        `failed sends=${reliability.sendFailures}, dropped (queue overflow)=${reliability.droppedOverflow}`,
    );
  }
  broadcast("slack:health", {
    ...report,
    reliability,
    route: slackPoller.getRouteHealth(report.projectId),
  });
}

/** Send an IPC event to a specific webContents id (or fallback to mainWindow). */
function sendToOwner(
  ownerId: number | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (ownerId !== undefined) {
    for (const win of allWindows) {
      if (!win.isDestroyed() && win.webContents.id === ownerId) {
        win.webContents.send(channel, ...args);
        return;
      }
    }
  }
  // Fallback: owner window closed or unknown — drop to mainWindow if alive.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// Window ↔ project mapping. Renderer registers its currentProject via the
// `window:registerProject` IPC; we use this to scope project-level events
// (agent:spawned, agent:statusChanged, etc.) to only the matching window(s).
const windowProjects = new Map<number, string>(); // webContents.id → projectId

// Per-window restore state, keyed by webContents.id (stable across a renderer
// reload). The main process survives macOS sleep/wake, so when a window's
// renderer is discarded+reloaded on wake it can ask main "what folder/project
// did I have?" and reconnect — instead of falling back to the new-window
// folder picker. Unlike windowProjects (event scoping, cleared when a project
// closes), this map is NEVER cleared by transient nulls during a reload: it
// only accumulates non-empty values and is dropped when the window closes.
// The global app-state.json holds a single slot, so it can't represent more
// than one open project — this per-window map is what makes multi-window
// reconnect correct. See src/lib/sessionRestore.ts for the precedence rules.
const windowRestore = new Map<number, WindowRestoreEntry>();

// Set on before-quit so per-window close handlers don't strip the saved
// session on the way out — we want the set of windows open AT quit to persist.
let isQuitting = false;

// Snapshot the currently-open project windows to disk so a full restart can
// reopen them all (see restoreWindowSession). Called whenever a window's
// project changes or a window closes — cheap and infrequent.
function persistWindowSession(): void {
  if (!activeAccountUid) return;
  // Exclude detached pop-out windows and dedupe by rootPath — otherwise popping
  // out Board/Code tabs (which share the parent's rootPath) would reopen the
  // same project as extra full windows on restart. See windowSession.ts.
  const windows = selectPersistableWindows(
    windowRestore.values(),
    activeAccountUid,
  );
  writeAccountAppState(activeAccountUid, { windows });
}

/** Paths already reported this session — see notifyRootPathMissing below. */
const notifiedMissingRoots = new Set<string>();
const notifiedWorktreeFallbacks = new Set<string>();

/**
 * Best surviving root to offer as a way out of `deadRootPath`.
 *
 * Same order as resolveRestoreRoots / scrubRemovedRoots so the three agree:
 * a live window on the SAME project first (its main checkout), then the global
 * lastRootPath, then any other live window. Every candidate is existence-checked
 * — offering a second dead path would be worse than offering nothing.
 *
 * The last rung matters for the caller that has no window of its own (the
 * lastRootPath scrub): without it that caller can only ever rediscover the dead
 * path it is trying to replace.
 */
function pickFallbackRoot(
  deadRootPath: string,
  windowKey?: number,
): string | undefined {
  const usable = (p: string | undefined): p is string =>
    !!p && p !== deadRootPath && fs.existsSync(p);

  const projectId =
    windowKey !== undefined
      ? windowRestore.get(windowKey)?.projectId
      : undefined;
  if (projectId) {
    for (const [key, entry] of windowRestore) {
      if (key === windowKey || entry.projectId !== projectId) continue;
      if (usable(entry.rootPath)) return entry.rootPath;
    }
  }

  const last = activeAccountUid
    ? sessionForAccount(readAppState().accountWindowSessions, activeAccountUid)
        .lastRootPath
    : undefined;
  if (usable(last)) return last;

  for (const [key, entry] of windowRestore) {
    if (key === windowKey) continue;
    if (usable(entry.rootPath)) return entry.rootPath;
  }
  return undefined;
}

/** Point a window at `rootPath` and tell its renderer to follow (see below). */
function repointWindowRoot(
  windowKey: number | undefined,
  rootPath: string,
  removedRootPath: string,
  opts?: { notice?: string },
): void {
  if (windowKey === undefined) return;
  const entry = windowRestore.get(windowKey);
  if (entry) windowRestore.set(windowKey, { ...entry, rootPath });
  persistWindowSession();
  sendToOwner(windowKey, "window:rootPathInvalidated", {
    removedRootPath,
    rootPath,
    ...(opts?.notice ? { notice: opts.notice } : {}),
  });
}

// A window whose rootPath is unusable is otherwise a SILENT failure: the PTY
// guard in PtyManager.create throws instead of spawning a shell that dies in
// ~6ms, but nothing in the UI renders that throw.
//
// This used to be a bare showErrorBox that asserted the folder had been DELETED.
// That was wrong for the two most common causes and it hid them: a reaped agent
// worktree is a normal lifecycle event whose project root is still there, and a
// foreign-OS path from Firestore `projects.folderPath` was never on this machine
// at all. Both rendered as "사라졌습니다" with an OK button, every boot, so the
// user learned to dismiss the one signal that something was actually wrong.
// Now we name the cause and offer the way out. Shown once per path per session —
// one removed worktree can invalidate several windows at once.
function notifyRootPathMissing(rootPath: string, ownerKey?: number): void {
  // Callers that have no window of their own (orchestrator handlers, cold-start
  // restore) still need the recovery buttons to DO something — fall back to the
  // window the user is looking at, then to the primary one.
  const windowKey =
    ownerKey ??
    BrowserWindow.getFocusedWindow()?.webContents.id ??
    mainWindow?.webContents.id;

  const fallbackRootPath = pickFallbackRoot(rootPath, windowKey);
  const diagnosis = diagnoseRootPath(rootPath, {
    homeDir: os.homedir(),
    ...(fallbackRootPath ? { fallbackRootPath } : {}),
  });

  if (
    diagnosis.failure === "worktree-removed" &&
    diagnosis.fallbackRootPath &&
    fs.existsSync(diagnosis.fallbackRootPath)
  ) {
    const shouldNotify = !notifiedWorktreeFallbacks.has(rootPath);
    notifiedWorktreeFallbacks.add(rootPath);
    repointWindowRoot(
      windowKey,
      diagnosis.fallbackRootPath,
      rootPath,
      shouldNotify
        ? {
            notice: "작업 워크트리가 정리되어 프로젝트 루트로 돌아왔습니다.",
          }
        : undefined,
    );
    console.warn(
      `[Window] Removed worktree root "${rootPath}" recovered without modal via "${diagnosis.fallbackRootPath}"`,
    );
    return;
  }

  if (notifiedMissingRoots.has(rootPath)) return;
  notifiedMissingRoots.add(rootPath);

  const msg = describeRootPathFailure(diagnosis);

  const PICK = "다른 폴더 열기";
  const CLOSE = "닫기";
  const buttons = [
    ...(msg.fallbackLabel ? [msg.fallbackLabel] : []),
    PICK,
    CLOSE,
  ];

  dialog
    .showMessageBox({
      type: "warning",
      title: msg.title,
      message: msg.title,
      detail: msg.body,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    })
    .then(({ response }) => {
      const choice = buttons[response];
      if (choice === PICK) {
        // The picker lives in the renderer (useProjectSetup) — it owns project
        // registration, which main can't do on its own.
        if (windowKey !== undefined)
          sendToOwner(windowKey, "window:requestFolderPicker", { rootPath });
        return;
      }
      if (choice !== CLOSE && diagnosis.fallbackRootPath) {
        repointWindowRoot(windowKey, diagnosis.fallbackRootPath, rootPath);
      }
    })
    .catch(() => {});
}

// Cause-side invalidation: a worktree we just removed may be the rootPath of an
// OPEN window. Repoint those windows (see scrubRemovedRoots) and re-persist
// immediately — otherwise the dead path is written to app-state.json at quit and
// faithfully reopened on the next launch, so the failure survives a restart.
function invalidateRemovedWorktreeRoots(removedPaths: string[]): void {
  // The account-scoped lastRootPath has to be scrubbed too, and FIRST. It is the
  // cold-start fallback for the primary window and the source of
  // `defaultRootPath` below, so leaving a reaped worktree in it means every
  // dead window falls back onto another dead path — which is exactly how a
  // reaped worktree survived #501 and kept the popup coming back each boot.
  // (#501 scrubbed `windows[]` only; `lastRootPath` was read but never fixed.)
  const lastRootPath = activeAccountUid
    ? sessionForAccount(readAppState().accountWindowSessions, activeAccountUid)
        .lastRootPath
    : undefined;
  if (lastRootPath && removedPaths.some((r) => isPathUnder(lastRootPath, r))) {
    const replacement = pickFallbackRoot(lastRootPath);
    // Explicit `undefined` survives the spread in writeAppState and is then
    // dropped by JSON.stringify — i.e. the key is genuinely cleared, not left
    // holding the dead path.
    if (activeAccountUid) {
      writeAccountAppState(activeAccountUid, { lastRootPath: replacement });
    }
    console.warn(
      `[Window] Worktree removed — account lastRootPath "${lastRootPath}" cleared` +
        (replacement ? ` in favour of "${replacement}"` : " (no fallback)"),
    );
  }

  const scrubs = scrubRemovedRoots(windowRestore.entries(), removedPaths, {
    exists: (p) => fs.existsSync(p),
    defaultRootPath: activeAccountUid
      ? sessionForAccount(
          readAppState().accountWindowSessions,
          activeAccountUid,
        ).lastRootPath
      : undefined,
  });
  if (scrubs.length === 0) return;

  for (const { key, rootPath, removedRootPath } of scrubs) {
    const entry = windowRestore.get(key);
    if (!entry) continue;
    const shouldNotify = !notifiedWorktreeFallbacks.has(removedRootPath);
    notifiedWorktreeFallbacks.add(removedRootPath);
    if (rootPath) {
      windowRestore.set(key, { ...entry, rootPath });
      console.warn(
        `[Window] Worktree removed — repointing window ${key} from "${removedRootPath}" to "${rootPath}"`,
      );
    } else {
      // No live fallback. Drop the root so the window reconnects to the folder
      // picker rather than to a directory that no longer exists.
      const { rootPath: _dead, ...rest } = entry;
      windowRestore.set(key, rest);
      console.warn(
        `[Window] Worktree removed — window ${key} has no surviving root (was "${removedRootPath}")`,
      );
    }
    sendToOwner(key, "window:rootPathInvalidated", {
      removedRootPath,
      rootPath,
      ...(rootPath && shouldNotify
        ? {
            notice: "작업 워크트리가 정리되어 프로젝트 루트로 돌아왔습니다.",
          }
        : {}),
    });
  }
  persistWindowSession();
}

function getProjectForSender(senderId: number): string | undefined {
  return windowProjects.get(senderId);
}

function getOwnerForProject(projectId: string): number | undefined {
  for (const [winId, pid] of windowProjects) {
    if (pid === projectId) return winId;
  }
  return undefined;
}

/** Send to all windows currently scoped to `projectId`. */
function sendToProject(
  projectId: string,
  channel: string,
  ...args: unknown[]
): void {
  let delivered = false;
  for (const win of allWindows) {
    if (win.isDestroyed()) continue;
    if (windowProjects.get(win.webContents.id) === projectId) {
      win.webContents.send(channel, ...args);
      delivered = true;
    }
  }
  // Fallback only if no window claims the project — preserves single-window
  // behavior before any window registers (legacy renderer compatibility).
  if (!delivered && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// --- Bridge Server + Orchestrator Managers (per project) ---
const ptyBuffers = new Map<string, string[]>();
// Track which windows own each PTY session so output goes only to them.
// Multi-owner (see OwnerRegistry): one PTY can legitimately be displayed by
// more than one window, and a second window must not steal the first's stream.
const ptyOwners = new OwnerRegistry<string>(); // ptySessionId → webContents.ids

/** Register `senderId` as an owner of `sid` (additive — never evicts others). */
function addPtyOwner(sid: string, senderId: number): void {
  ptyOwners.add(sid, senderId);
}

/**
 * Send to every window that owns `sid`. Falls back to mainWindow when the PTY
 * has no live owner — same permissive posture as sendToOwner, so legacy paths
 * that never registered an owner keep working.
 */
function sendToPtyOwners(
  sid: string,
  channel: string,
  ...args: unknown[]
): void {
  const owners = ptyOwners.ownersOf(sid);
  let delivered = false;
  if (owners) {
    for (const win of allWindows) {
      if (win.isDestroyed()) continue;
      if (owners.has(win.webContents.id)) {
        win.webContents.send(channel, ...args);
        delivered = true;
      }
    }
  }
  if (!delivered && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}
// Renderers that have already drained the early-output buffer via pty:replay.
// On restart we reuse the same sid (agent-${id}) and the existing TerminalView
// does NOT re-call pty:replay (its useEffect only runs when sessionId changes).
// If setupPtyForwarding blindly creates a fresh buffer on the second call,
// every byte from the new PTY ends up trapped in main.ts and never reaches
// the renderer — the user sees a blank terminal and concludes the agent
// didn't start. drainedSids lets the second setup skip buffering.
const drainedSids = new Set<string>();
// When each sid's early-output buffer started filling. `pty:resize` needs this
// to tell two very different buffers apart (see that handler for why):
//   - young buffer = the TUI's first frame, drawn at the 80x24 spawn size,
//                    with a TerminalView mounting alongside the spawn.
//   - old buffer   = the WHOLE session so far, because nobody ever mounted a
//                    terminal for it (beginner mode opens the agent modal
//                    minutes later). Until the first `pty:replay` this buffer
//                    is the ONLY copy — output is not sent live before then.
const ptyBufferStartedAt = new Map<string, number>();
// How long after a buffer starts filling a resize may still discard it as
// "that's just the 80x24 first frame". A TerminalView mounting with the spawn
// fits and resizes within a frame or two; a human opening a modal takes far
// longer. Past this, the buffer is session history and has to survive.
const PTY_INITIAL_FRAME_DISCARD_MS = 3_000;
// Ceiling on an undrained buffer. Only reachable when no terminal is ever
// mounted (a beginner agent runs headless until the user opens its modal), and
// a TUI redrawing frames is not cheap in bytes. Oldest chunks go first;
// `pty:replay` prefixes a screen clear so the surviving partial stream starts
// from a clean screen instead of smearing over whatever was there.
const PTY_BUFFER_MAX_CHARS = 4_000_000;
const ptyBufferChars = new Map<string, number>();
const ptyBufferTruncated = new Set<string>();
function forgetPtyBufferBookkeeping(sid: string): void {
  ptyBufferStartedAt.delete(sid);
  ptyBufferChars.delete(sid);
  ptyBufferTruncated.delete(sid);
}

// ── Retained replay ring (orchestrator PTYs only) ──────────────────────────
// `ptyBuffers` above is a ONE-SHOT buffer, not scrollback: the first
// `pty:replay` drains it, records the sid in `drainedSids`, and from then on
// output is forwarded live and kept nowhere. That is fine as long as the
// terminal that drained it stays mounted — and for an agent terminal it does.
//
// The orchestrator's does not. `App.tsx` renders <BeginnerShell/> and
// <WorkspaceShell/> as SIBLING branches, so switching modes unmounts the whole
// subtree and OrchestratorPanel → TerminalView remounts with a fresh xterm.
// That new terminal calls `pty:replay` and — with only the one-shot buffer —
// gets back an empty array, so it has nothing to draw until the next byte of
// output arrives. The user sees a black panel and concludes the orchestrator
// dropped, even though the PTY never died (the unmount deliberately does not
// stop it; see useOrchestratorAutoLaunch + orchestratorTeardownAction).
//
// So orchestrator sids keep a bounded ring that SURVIVES the drain, and replay
// serves it on every mount. Deliberately not extended to agent PTYs: there is
// exactly one live orchestrator per project window, while agents come by the
// dozen, and this ring's whole cost is paid per sid. Agent terminals keep the
// old behavior byte for byte.
//
// ★This is NOT the #1047 fix and must not shadow it. #1047 was `pty:resize`
// wiping a buffer that was still THERE; this is the buffer being already GONE.
// The resize discard below still runs, and now clears the ring inside the same
// time window so the stale 80x24 first frame cannot come back through it.
// Same ceiling as the one-shot buffer, deliberately. Two reasons: a mount must
// never get back LESS than it would have before this ring existed (a smaller
// cap would silently shorten the first mount's replay), and the justification
// is identical — a TUI redrawing frames is not cheap in bytes. The cost that
// IS new is that this one is held for the life of the PTY rather than until
// the first drain: ~8MB of UTF-16 for the single orchestrator per window. That
// is the whole reason `retainsPtyScrollback` refuses to cover agent PTYs.
const PTY_SCROLLBACK_MAX_CHARS = PTY_BUFFER_MAX_CHARS;
const ptyScrollback = new Map<string, string[]>();
const ptyScrollbackChars = new Map<string, number>();
const ptyScrollbackTruncated = new Set<string>();

/** Which sids pay for a retained ring. Orchestrator only — see above. */
function retainsPtyScrollback(sid: string): boolean {
  return isOrchestratorPtyId(sid);
}

/** Start (or restart) a sid's ring. Called per PTY process, not per mount. */
function resetPtyScrollback(sid: string): void {
  if (!retainsPtyScrollback(sid)) return;
  ptyScrollback.set(sid, []);
  ptyScrollbackChars.set(sid, 0);
  ptyScrollbackTruncated.delete(sid);
}

function forgetPtyScrollback(sid: string): void {
  ptyScrollback.delete(sid);
  ptyScrollbackChars.delete(sid);
  ptyScrollbackTruncated.delete(sid);
}

/** Append one PTY chunk, evicting the oldest once the ring is over budget. */
function pushPtyScrollback(sid: string, data: string): void {
  const ring = ptyScrollback.get(sid);
  if (!ring) return;
  ring.push(data);
  let chars = (ptyScrollbackChars.get(sid) ?? 0) + data.length;
  if (chars > PTY_SCROLLBACK_MAX_CHARS) {
    while (ring.length > 1 && chars > PTY_SCROLLBACK_MAX_CHARS / 2) {
      chars -= ring.shift()!.length;
    }
    // Once evicted, the ring starts mid-stream — replay has to prefix a screen
    // clear so the first surviving fragment doesn't smear over the new screen.
    ptyScrollbackTruncated.add(sid);
  }
  ptyScrollbackChars.set(sid, chars);
}
// Generation counter per sid — increments on every setupPtyForwarding call.
// node-pty's onData/onExit are attached to a specific IPty instance, so when
// kill() + create() reuse the same sid the OLD process still owns the OLD
// listeners. The OLD onExit closure then fires AFTER the NEW setup, with the
// shared sid, and trashes ptyOwners/ptyBuffers + sends a phantom pty:exit to
// the renderer (looks like the new session crashed). Guarding the closures
// with a captured gen makes the stale OLD callbacks no-op.
const sidGen = new Map<string, number>();

// --- Worktree isolation (WORKTREE-SPEC) ---
// Runs just before every bridge spawn: guarantees an isolated git worktree +
// a board task for the agent. createTask auto-creates an ad-hoc board task
// (mirrors the mission dispatcher payload) when a spawn arrives without one,
// so the "every worktree has a task" invariant holds. Uses the mission
// firebase app/db (same as dispatcher-impl) and writes only after auth is
// ready. Lazy — getMissionFirebaseApp()/getFirestore are resolved per call.
const worktreeManager = new WorktreeManager();
const worktreeCoordinator = new WorktreeCoordinator({
  worktreeManager,
  createTask: async ({ projectId, title, description }) => {
    const { app, authReady } = getMissionFirebaseApp();
    await authReady;
    const wtDb = getFirestore(app);
    const now = fbTimestamp.now();
    const ref = await fbAddDoc(fbCollection(wtDb, "tasks"), {
      title,
      description: description ?? "",
      projectId,
      role: "backend",
      priority: 3,
      status: "TODO",
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: null,
      claimedAt: null,
      scope: [],
      comment: "ad-hoc(worktree)",
      prUrl: "",
      hasPmFeedback: false,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  },
});

const bridgeServer = new BridgeServer(
  agentManager,
  ptyManager,
  ptyBuffers,
  worktreeCoordinator,
);
// cleanup_agents' Firestore pass — reaches ghost docs of dead previous
// instances that the bridge's in-memory agent list cannot see.
bridgeServer.setGhostReclaim(() => runGhostReclaimSweep());

// ── Agent health watchdog (native orchestrator self-recovery) ──
// Periodically inspects CLAIMED/IN_PROGRESS board tickets whose assigned worker
// has died (PTY exited → stopped/error, or removed) or gone silent (alive but no
// PTY output / board activity past the grace window) and recovers them:
// nudge the live PTY, then respawn via the guard-safe dispatchTask path
// (per-task lock + findLiveTaskAgent → no double-spawn). Recovery-only — it
// never claims TODO tickets. Mission tickets are excluded here because the
// conductor's own report-watchdog (conductor-driver.ts) already owns them.
// Started/stopped in the app lifecycle below.
function watchdogMillis(value: unknown): number | null {
  const ts = value as { toMillis?: () => number } | undefined;
  return typeof ts?.toMillis === "function" ? ts.toMillis() : null;
}

const agentWatchdog = new AgentWatchdog(
  {
    listActiveTickets: async (): Promise<WatchdogTicket[]> => {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      const snap = await fbGetDocs(
        fbQuery(
          fbCollection(db, "tasks"),
          fbWhere("status", "in", ["CLAIMED", "IN_PROGRESS"]),
        ),
      );
      const out: WatchdogTicket[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        // Mission tickets are recovered by the conductor's report-watchdog.
        if (data.missionId) return;
        const projection = data.projection as
          | {
              lastAgentId?: unknown;
              lastActivityAt?: unknown;
              lastActivitySummary?: unknown;
            }
          | undefined;
        const agentId =
          (typeof projection?.lastAgentId === "string" &&
            projection.lastAgentId) ||
          (typeof data.claimedBy === "string"
            ? (data.claimedBy as string)
            : null) ||
          null;
        const lastActivityAtMs = watchdogMillis(projection?.lastActivityAt);
        const activeSinceMs =
          lastActivityAtMs ??
          watchdogMillis(data.claimedAt) ??
          watchdogMillis(data.updatedAt) ??
          watchdogMillis(data.createdAt);
        // Persisted at dispatch time (bridge-server persistDispatchMeta) so a
        // respawn restores the original cwd + model + complexity instead of
        // re-resolving them (fresh base worktree + claude→gpt re-selection).
        const meta = data.dispatchMeta as
          | {
              cwd?: unknown;
              model?: unknown;
              complexity?: unknown;
              dispatchReason?: unknown;
            }
          | undefined;
        const metaComplexity =
          meta?.complexity === "simple" ||
          meta?.complexity === "standard" ||
          meta?.complexity === "complex"
            ? meta.complexity
            : undefined;
        out.push({
          taskId: d.id,
          projectId: typeof data.projectId === "string" ? data.projectId : "",
          status: data.status as "CLAIMED" | "IN_PROGRESS",
          role: typeof data.role === "string" ? data.role : "backend",
          agentId: agentId || null,
          lastActivityAtMs,
          activeSinceMs,
          title: typeof data.title === "string" ? data.title : undefined,
          cwd: typeof meta?.cwd === "string" && meta.cwd ? meta.cwd : undefined,
          model:
            typeof meta?.model === "string" && meta.model
              ? meta.model
              : undefined,
          complexity: metaComplexity,
          dispatchReason:
            typeof meta?.dispatchReason === "string" && meta.dispatchReason
              ? meta.dispatchReason
              : undefined,
          // W8: picks the board-quiet tier (P4+ = urgent, else normal).
          priority:
            typeof data.priority === "number" && Number.isFinite(data.priority)
              ? data.priority
              : null,
          // post-answer-quiet 축(티켓 igGI6QpXkEfrkkKN3rU0)의 기준점. 티켓
          // 문서에 이미 실려 오는 questions 배열에서 뽑으므로 추가 읽기가 없다.
          lastAnswer: latestAnsweredQuestion(readQuestions(data.questions)),
          // ★마지막 활동이 오케 자신의 답변/승인 기록이면 에이전트의 반응이
          // 아니다 — 그걸 반응으로 세면 post-answer-quiet 축이 안 운다.
          lastActivityByOrchestrator: isOrchestratorActivitySummary(
            projection?.lastActivitySummary,
          ),
        });
      });
      return out;
    },
    getAgentHealth: (agentId) => {
      const a = agentManager.getAgent(agentId);
      if (!a) return null;
      return {
        status: a.status,
        lastPtyActivityMs: a.lastPtyActivity,
        // W7: the classified clocks. lastWorkOutput ignores the idle prompt's
        // own repaint (which otherwise made a stalled agent look eternally
        // alive), and promptIdleSince is the positive "parked at the input
        // prompt" observation — see agent-status-reconcile.classifyPtyFrame.
        lastWorkOutputMs: a.lastWorkOutput,
        promptIdleSinceMs: a.promptIdleSince,
        currentTaskId: a.currentTaskId,
        // W8: description axes for the quiet signal. The concrete model is
        // what makes a stall case usable as a per-model completion-failure
        // datapoint later (today that data is not recorded at all).
        agentName: a.name,
        concreteModel:
          formatModelAtEffort(agentManager.resolveConcreteModel(a.id)) ??
          a.model,
        inputWaitReason: a.inputWaitReason,
        // W8 보강: 이미 agent-manager 가 PTY onExit 에서 확정해 둔 값을 그대로
        // 넘긴다 — quiet 판정이 이걸 안 보고 무활동 임계를 기다리던 게 이번
        // 티켓의 문제였다.
        terminalSinceMs: a.terminalSince,
        lastExitCode: a.lastExitCode,
        // ★능동 프로브 축(티켓 DQYoyas3ESx33zXJOCOa). (b) 는 이 에이전트가
        // 스스로 한 마지막 MCP 툴 호출 시각(bridge /agent-mcp-heartbeat 가
        // 찍는다), (a) 는 그 PTY 자식의 pid — 워치독이 OS 에 직접 물어보는
        // 대상이다. 둘 다 읽기 전용이고 PTY 에는 아무것도 쓰지 않는다.
        lastMcpCallMs: a.lastMcpCall,
        ptyPid: ptyManager.getPid(a.ptySessionId),
      };
    },
    // ★능동 프로브 (a) — OS 에게만 묻는다. process.kill(pid, 0) 은 시그널을
    // 실제로 보내지 않는 존재 검사이고, `ps` 는 대상 프로세스를 건드리지 않는다.
    // 신규 의존성 0(오케 확정): pidusage 류를 붙이지 않고 macOS 에서만 `ps` 를
    // 파싱하며, 다른 플랫폼에서는 전부 null → 프로브는 "프로브 불가" 로 떨어지고
    // 기존 board-quiet(20/45분) 안전망이 그대로 받는다.
    probeProcess: (_agentId, pid, prevCpuMs) =>
      sampleProcessProbe(pid, prevCpuMs),
    nudgeAgent: (agentId, message) => {
      const a = agentManager.getAgent(agentId);
      if (!a) return false;
      try {
        ptyManager.writeAndSubmit(a.ptySessionId, message);
        return true;
      } catch {
        return false;
      }
    },
    respawnForTicket: async (ticket) => {
      try {
        // Restore the original dispatch's cwd/model/complexity so recovery lands
        // in the SAME worktree on the SAME model. Prefer the ticket's persisted
        // dispatchMeta; fall back to the (live or merely stopped) AgentInstance
        // still bound to the ticket — it carries the agent's true cwd + model
        // even after a PTY exit. Without this, dispatch re-resolves cwd to a
        // fresh empty base worktree (false BLOCKED) and re-selects the model
        // (claude reborn as gpt).
        const live = ticket.agentId
          ? agentManager.getAgent(ticket.agentId)
          : null;
        const res = await bridgeServer.dispatchTask(
          buildRespawnDispatch(
            ticket,
            live ? { cwd: live.cwd, model: live.model } : null,
          ),
        );
        return res?.success !== false;
      } catch (err) {
        console.error("[AgentWatchdog] respawn dispatch failed:", err);
        return false;
      }
    },
    recordRecovery: (ticket, phase, detail) => {
      if (phase === "respawn") {
        mainTelemetry.agentWentStale(mainWindow, {
          taskId: ticket.taskId,
          agentId: ticket.agentId,
          model: ticket.model ?? null,
          role: ticket.role,
          dispatchReason: ticket.dispatchReason ?? null,
          errorCategory: "agent_stale",
          errorMessage: detail,
          metadata: {
            phase,
            status: ticket.status,
            projectId: ticket.projectId,
          },
        });
        // KG feedback (spec §9): the motivating negative label — an agent that
        // went stale on this (context × model). Fold it in so repeated stales
        // demote the model for this shape. ctx (tags/complexity) is backfilled
        // from dispatchMeta; role/model come straight off the ticket.
        void graphUpdater.recordOutcome({
          taskId: ticket.taskId,
          agentId: ticket.agentId ?? undefined,
          model: ticket.model ?? undefined,
          rawOutcome: "stale",
          ctx: { role: ticket.role, complexity: ticket.complexity },
        });
      }
      // Board-visible audit WITHOUT bumping projection.lastActivityAt (which
      // would mask the watchdog's own silence detection). Best-effort, fire
      // and forget — never blocks or breaks a sweep.
      void (async () => {
        try {
          const { app, authReady } = getMissionFirebaseApp();
          await authReady;
          const db = getFirestore(app);
          await fbAddDoc(fbCollection(db, "activities"), {
            taskId: ticket.taskId,
            agentId: ticket.agentId ?? "watchdog",
            message: `🔧 [Watchdog ${phase}] ${detail}`,
            createdAt: fbTimestamp.now(),
            source: "watchdog",
          });
        } catch (err) {
          console.error("[AgentWatchdog] recordRecovery write failed:", err);
        }
      })();
    },

    // ── W3: false-positive-respawn guards ──────────────────────
    isTaskStillRecoverable: async (taskId) => {
      try {
        const { app, authReady } = getMissionFirebaseApp();
        await authReady;
        const db = getFirestore(app);
        const snap = await fbGetDoc(fbDoc(db, "tasks", taskId));
        if (!snap.exists()) return false;
        const status = (snap.data() as { status?: string }).status ?? "";
        // Recoverable only while still in active work — REVIEW/DONE/FAILED/
        // BLOCKED means someone/something already closed it out.
        return status === "CLAIMED" || status === "IN_PROGRESS";
      } catch (err) {
        console.error("[AgentWatchdog] isTaskStillRecoverable failed:", err);
        return true; // read blip → don't cancel recovery on our own error
      }
    },
    hasLiveWorkerForTask: (ticket) => {
      // A DIFFERENT (not the ticket's recorded agentId) non-dead agent bound to
      // this task — by currentTaskId OR sitting in the task's isolated worktree.
      // This is the identity match: dispatch's name hint ≠ the real live
      // agentId, so the original worker can be alive under another id while the
      // recorded agentId looks dead. Excluding the ticket's own agentId keeps
      // the normal nudge/respawn of the bound worker intact (else a silent-but-
      // alive bound agent would always match itself and never get nudged).
      // An agent RELEASED from this task (currentTaskId cleared, lastTaskId
      // kept — completion report or stale-bypass) does not count either, or a
      // retired predecessor parked in the worktree would block its
      // successor's recovery forever (agent-stall-policy.isOtherLiveWorkerForTask).
      return agentManager
        .listAgents()
        .some((a) => isOtherLiveWorkerForTask(a, ticket));
    },
    probeFreshness: async (ticket) => {
      // Original worker demonstrably alive if its isolated worktree was touched
      // (file write / commit) within the freshness grace. Codifies the
      // watchdog_falsepositive_check_mtimes lesson as a real gate.
      const graceMs = resolveWatchdogConfig().freshnessGraceMs;
      const cwd = ticket.cwd;
      if (!cwd) return null;
      try {
        if (!fs.existsSync(cwd)) return null;
        let newest = 0;
        // Cheap probe: the worktree dir mtime + .git/index mtime (bumped by any
        // add/commit) + HEAD. Avoids walking the whole tree.
        for (const rel of [".", ".git/index", ".git/HEAD", ".git/logs/HEAD"]) {
          try {
            const st = fs.statSync(path.join(cwd, rel));
            newest = Math.max(newest, st.mtimeMs);
          } catch {
            /* missing path — skip */
          }
        }
        if (newest === 0) return null;
        const ageMs = Date.now() - newest;
        return {
          fresh: ageMs <= graceMs,
          reason: `worktree touched ${Math.round(ageMs / 1000)}s ago`,
        };
      } catch (err) {
        console.error("[AgentWatchdog] probeFreshness failed:", err);
        return null;
      }
    },

    // ── W6: cross-host / scope guard ───────────────────────────
    probeScopeHost: async (ticket) => {
      try {
        const { app, authReady } = getMissionFirebaseApp();
        await authReady;
        const db = getFirestore(app);
        const snap = await fbGetDoc(fbDoc(db, "tasks", ticket.taskId));
        if (!snap.exists()) return { action: "proceed", reason: "" };
        const data = snap.data() as {
          scope?: unknown;
          description?: unknown;
          comment?: unknown;
        };
        const scope = Array.isArray(data.scope) ? (data.scope as string[]) : [];
        const constraintText = `${String(data.description ?? "")}\n${String(
          data.comment ?? "",
        )}`;
        // Host constraint: a Windows-only task (C:\… cwd or explicit Windows
        // note) must not respawn on this darwin host.
        const wantsWindows =
          /[A-Za-z]:\\/.test(constraintText) ||
          /\bwindows\b/i.test(constraintText) ||
          /C:\/Users\//i.test(constraintText);
        if (wantsWindows && process.platform !== "win32") {
          return {
            action: "redispatch",
            reason: `task carries a Windows host constraint but this host is ${process.platform}`,
          };
        }
        // Scope-file existence: if the task names scope files and NONE exist in
        // the resolved cwd, this is a mis-routed empty worktree — don't write
        // orphan code here.
        const cwd = ticket.cwd;
        if (scope.length > 0 && cwd && fs.existsSync(cwd)) {
          const anyPresent = scope.some((rel) => {
            try {
              return fs.existsSync(path.join(cwd, rel));
            } catch {
              return false;
            }
          });
          if (!anyPresent) {
            return {
              action: "redispatch",
              reason: `none of ${scope.length} scope file(s) exist under ${cwd} — mis-routed worktree`,
            };
          }
        }
        return { action: "proceed", reason: "" };
      } catch (err) {
        console.error("[AgentWatchdog] probeScopeHost failed:", err);
        return { action: "proceed", reason: "" }; // fail open — don't block on our error
      }
    },
    redispatchToOriginHost: async (ticket, reason) => {
      try {
        const { app, authReady } = getMissionFirebaseApp();
        await authReady;
        const db = getFirestore(app);
        await fbAddDoc(fbCollection(db, "activities"), {
          taskId: ticket.taskId,
          agentId: "watchdog",
          message: `🚫 [Watchdog misroute] ${reason}. 이 호스트에서 스폰하지 않고 원 호스트 재디스패치를 요청합니다 (고아코드 방지).`,
          createdAt: fbTimestamp.now(),
          source: "watchdog",
        });
        // Park the ticket as BLOCKED(force) so the origin host / orchestrator
        // picks it up instead of this host looping respawns.
        await fbUpdateDoc(fbDoc(db, "tasks", ticket.taskId), {
          status: "BLOCKED",
          updatedAt: fbTimestamp.now(),
        });
      } catch (err) {
        console.error("[AgentWatchdog] redispatchToOriginHost failed:", err);
      }
    },

    // ── W4: real escalation before dead-end ────────────────────
    rerouteForTicket: async (ticket) => {
      // One re-route to the OTHER CLI family (claude↔gpt) before giving up — the
      // three respawns may all have failed for a model/host reason.
      try {
        const cur = (ticket.model ?? "").toLowerCase();
        const alt =
          cur.includes("gpt") || cur.includes("codex") ? "claude" : "gpt";
        const res = await bridgeServer.dispatchTask(
          buildRespawnDispatch({ ...ticket, model: alt }, null),
        );
        return res?.success !== false;
      } catch (err) {
        console.error("[AgentWatchdog] rerouteForTicket failed:", err);
        return false;
      }
    },
    escalate: (ticket, detail) => {
      const msg = `🚨 [Watchdog] 태스크 ${ticket.taskId} "${
        ticket.title ?? ""
      }" 자동복구 소진 — ${detail}. 사람 개입이 필요합니다.`;
      // Orchestrator PTY nudge (project-scoped, best-effort).
      try {
        orchestrators.get(ticket.projectId)?.injectMessage(msg);
      } catch (err) {
        console.error("[AgentWatchdog] escalate orch nudge failed:", err);
      }
      // Telegram outbound (best-effort).
      try {
        void telegramPoller.sendMessage(ticket.projectId, msg);
      } catch (err) {
        console.error("[AgentWatchdog] escalate telegram failed:", err);
      }
    },

    // ── W8: board-quiet SIGNAL — tell the orchestrator, decide nothing ──
    // 사장님 요청(2026-08-22): "워치독이 체크가 되서 일중인지 죽은건지 판단이
    // 되도록해서 오케가 판단 후 새로 스폰하거나". Three outlets, zero actions:
    //   1. orchestrator PTY — the reader who can actually decide.
    //   2. the agent's stallSignal marker — so get_agents / cleanup_agents
    //      show it next to the agent (the orchestrator's own tools).
    //   3. telemetry with the CONCRETE MODEL — per-model stall data, which
    //      today is not recorded anywhere (the respawn-phase agentWentStale
    //      only fires when the ladder gets that far, and it carries the
    //      dispatchMeta vendor string, not the model that actually ran).
    // The ticket-timeline activity line comes from recordRecovery("quiet").
    signalQuiet: (ticket, signal, detail) => {
      const agent = ticket.agentId
        ? agentManager.getAgent(ticket.agentId)
        : null;
      const agentLabel = agent
        ? `${agent.name} (${signal.model ?? agent.model})`
        : `${ticket.agentId ?? "(unknown)"} (${signal.model ?? "?"})`;
      const quietMin = Math.round(signal.quietMs / 60_000);
      const boardIdleMin = Math.round(signal.boardIdleMs / 60_000);
      // W8 보강(2026-08-23): 축마다 헤드라인을 다르게 — 죽음(exit)과 침묵
      // (first-activity/board-quiet)이 같은 "N분째 보드 활동 없음" 문구로
      // 오면 오케가 구분할 수 없다. exit 축은 quietMs 가 "종료 확정 후 경과"
      // 라 0에 가까울 수 있으므로 boardIdleMs(마지막 실보고 이후 경과)를
      // 따로 싣는다.
      const headline =
        signal.axis === "exit"
          ? `프로세스 종료 확인(exit ${signal.exitCode ?? "?"}) — 사망, ` +
            `무활동 임계 대기 없이 즉시 신호 (마지막 보드 활동 ${boardIdleMin}분 전)`
          : signal.axis === "first-activity"
            ? `스폰(또는 재배정) 이후 ${quietMin}분간 첫 활동 없음 ` +
              `(첫 활동 임계 ${Math.round(signal.thresholdMs / 60_000)}분)`
            : `${quietMin}분째 보드 활동 없음`;
      const msg =
        `🕵️ [Watchdog] 티켓 ${ticket.taskId} "${ticket.title ?? ""}" ` +
        `(P${ticket.priority ?? "?"}) — ${headline}. ` +
        `담당 ${agentLabel}. ${detail}\n` +
        `   판단 재료: get_task_activities(${ticket.taskId}) · get_agents 의 ⚠ 표시. ` +
        `선택지: 기다리기(정상 장시간 작업일 수 있음) / reuse_agent 로 진행 보고 요청 / ` +
        `kill_agent 후 dispatch_task 재배정` +
        (signal.axis === "board-quiet"
          ? ` — 이제 dispatch_task 는 ${quietMin}분 조용한 담당에게 되돌려보내지 않습니다.`
          : ".");
      try {
        orchestrators.get(ticket.projectId)?.injectMessage(msg);
      } catch (err) {
        console.error("[AgentWatchdog] quiet-signal orch nudge failed:", err);
      }
      if (ticket.agentId) {
        agentManager.setStallSignal(ticket.agentId, signal);
      }
      mainTelemetry.agentQuietSignal(mainWindow, {
        taskId: ticket.taskId,
        agentId: ticket.agentId,
        model: signal.model,
        role: ticket.role,
        dispatchReason: ticket.dispatchReason ?? null,
        errorCategory: "agent_quiet",
        errorMessage: detail,
        metadata: {
          tier: signal.tier,
          axis: signal.axis,
          quietMs: signal.quietMs,
          thresholdMs: signal.thresholdMs,
          boardIdleMs: signal.boardIdleMs,
          exitCode: signal.exitCode,
          pty: signal.pty,
          repeat: signal.repeat,
          priority: ticket.priority ?? null,
          status: ticket.status,
          projectId: ticket.projectId,
        },
      });
    },
    clearQuiet: (_ticket, agentId) => {
      agentManager.setStallSignal(agentId, null);
    },
    resetStalledInProgress: async (ticket, detail) => {
      try {
        const { app, authReady } = getMissionFirebaseApp();
        await authReady;
        const db = getFirestore(app);
        await applyProjection(db, ticket.taskId, {
          newStatus: "TODO",
          lastAgentId: "watchdog",
          lastActivitySummary: "watchdog reset orphaned IN_PROGRESS to TODO",
          extraTaskFields: {
            claimedBy: null,
            claimedAt: null,
            comment: `Watchdog reset: ${detail}`,
          },
          activityPayload: {
            agentId: "watchdog",
            message:
              `🔁 [Watchdog IN_PROGRESS reset] ${detail}. ` +
              `TODO로 되돌려 재클레임 가능하게 했습니다.`,
          },
          validateFrom: (from) => from === "IN_PROGRESS",
          validateTask: (task) => {
            const projection = task.projection as
              | { lastAgentId?: unknown }
              | undefined;
            const claimedBy =
              typeof task.claimedBy === "string" ? task.claimedBy : null;
            const projectedAgent =
              typeof projection?.lastAgentId === "string"
                ? projection.lastAgentId
                : null;
            return (
              task.status === "IN_PROGRESS" &&
              (claimedBy === ticket.agentId ||
                projectedAgent === ticket.agentId)
            );
          },
        });
        return true;
      } catch (err) {
        console.error("[AgentWatchdog] resetStalledInProgress failed:", err);
        return false;
      }
    },
    // 두 축이 공유하는 표출 채널이다: 담당자 부재(orphan)와, 담당자가 살아 보이는데
    // 산출이 끊긴 경우(W9 silent). 어느 쪽인지는 detail 이 말한다.
    escalateStalledInProgress: (ticket, detail) => {
      const msg = `⚠️ [Watchdog] IN_PROGRESS 태스크 ${ticket.taskId} "${
        ticket.title ?? ""
      }" 담당 에이전트 부재 또는 무산출 감지 — ${detail}. 재배정 또는 수동 리셋이 필요합니다.`;
      try {
        orchestrators.get(ticket.projectId)?.injectMessage(msg);
      } catch (err) {
        console.error(
          "[AgentWatchdog] escalateStalledInProgress orch failed:",
          err,
        );
      }
      try {
        void telegramPoller.sendMessage(ticket.projectId, msg);
      } catch (err) {
        console.error(
          "[AgentWatchdog] escalateStalledInProgress tg failed:",
          err,
        );
      }
    },

    // ── W5: stale-REVIEW sweep ─────────────────────────────────
    listStaleReviewCandidates: async () => {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      // Cross-project: every REVIEW ticket, dead-assignee filtered downstream.
      const snap = await fbGetDocs(
        fbQuery(fbCollection(db, "tasks"), fbWhere("status", "==", "REVIEW")),
      );
      const out: StaleReviewTicket[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (data.missionId) return; // mission review owned by the conductor
        const projection = data.projection as
          | { lastAgentId?: unknown; lastActivityAt?: unknown }
          | undefined;
        const assigneeAgentId =
          (typeof projection?.lastAgentId === "string" &&
            projection.lastAgentId) ||
          (typeof data.claimedBy === "string"
            ? (data.claimedBy as string)
            : null) ||
          null;
        // REVIEW is normally a human approval/merge gate, not active agent work.
        // Only explicit non-human review owners opt into stale-review surfacing.
        const reviewPolicy = data.reviewPolicy as
          | { owner?: unknown; autoMergeWhenGreen?: unknown }
          | undefined;
        const reviewOwner =
          (typeof reviewPolicy?.owner === "string" && reviewPolicy.owner) ||
          (typeof data.reviewOwner === "string"
            ? (data.reviewOwner as string)
            : "human");
        const awaitingHumanApproval =
          reviewOwner !== "agent" && reviewOwner !== "orchestrator";
        // Assignee is "dead" when no live local agent carries that id. This is
        // only actionable for the non-human review owners above; normal human
        // REVIEW tickets remain excluded by awaitingHumanApproval.
        const live = assigneeAgentId
          ? agentManager.getAgent(assigneeAgentId)
          : null;
        const assigneeDead =
          !live || live.status === "stopped" || live.status === "error";
        const ts = projection?.lastActivityAt as
          | { toMillis?: () => number }
          | undefined;
        out.push({
          taskId: d.id,
          projectId: typeof data.projectId === "string" ? data.projectId : "",
          title: typeof data.title === "string" ? data.title : undefined,
          role: typeof data.role === "string" ? data.role : undefined,
          assigneeAgentId,
          assigneeDead,
          lastActivityAtMs:
            typeof ts?.toMillis === "function" ? ts.toMillis() : null,
          awaitingHumanApproval,
        });
      });
      return out;
    },
    escalateStaleReview: (ticket, detail) => {
      const msg = `🕒 [Watchdog] REVIEW 방치 감지 — ${detail}. 리뷰/머지 또는 재배정이 필요합니다.`;
      try {
        orchestrators.get(ticket.projectId)?.injectMessage(msg);
      } catch (err) {
        console.error("[AgentWatchdog] escalateStaleReview orch failed:", err);
      }
      try {
        void telegramPoller.sendMessage(ticket.projectId, msg);
      } catch (err) {
        console.error("[AgentWatchdog] escalateStaleReview tg failed:", err);
      }
    },

    // ── W2: undelivered pending-instruction fallback ───────────
    listUndeliveredInstructions: async () => {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      const snap = await fbGetDocs(
        fbQuery(
          fbCollection(db, "pendingInstructions"),
          fbWhere("isDelivered", "==", false),
        ),
      );
      const out: PendingInstruction[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const targetAgentId =
          typeof data.targetAgentId === "string" ? data.targetAgentId : "";
        const message = typeof data.message === "string" ? data.message : "";
        if (!targetAgentId || !message) return;
        const ts = data.createdAt as { toMillis?: () => number } | undefined;
        out.push({
          docId: d.id,
          targetAgentId,
          message,
          createdAtMs: typeof ts?.toMillis === "function" ? ts.toMillis() : 0,
        });
      });
      return out;
    },
    deliverInstructionDirect: (agentId, message) => {
      const a = agentManager.getAgent(agentId);
      if (!a || a.status === "stopped" || a.status === "error") return false;
      try {
        ptyManager.writeAndSubmit(a.ptySessionId, message);
        return true;
      } catch (err) {
        console.error("[AgentWatchdog] deliverInstructionDirect failed:", err);
        return false;
      }
    },
    markInstructionDelivered: async (docId) => {
      try {
        const { app, authReady } = getMissionFirebaseApp();
        await authReady;
        const db = getFirestore(app);
        await fbUpdateDoc(fbDoc(db, "pendingInstructions", docId), {
          isDelivered: true,
          deliveredAt: fbTimestamp.now(),
          deliveredVia: "watchdog-fallback",
        });
      } catch (err) {
        console.error("[AgentWatchdog] markInstructionDelivered failed:", err);
      }
    },
  },
  resolveWatchdogConfig(),
);

// Per-project orchestrator instances. One window per project is the typical
// usage; if the same project is opened in two windows they share an instance
// (same view, same PTY) — distinct projects stay fully isolated.
const orchestrators = new Map<string, OrchestratorManager>();
// Track which windows have this project's orchestrator open (for default
// stop/status routing when the renderer call doesn't carry projectId).
//
// A SET for the same reason as ptyOwners: the orchestrator instance is shared
// per project across windows, so a second window opening the same project used
// to overwrite the first window's ownership. The dispossessed window's
// stop()/status calls then resolved to null and became silent no-ops.
const orchestratorOwners = new OwnerRegistry<string>(); // projectId → webContents.ids

/** Register `senderId` as an owner of `projectId`'s orchestrator. */
function addOrchestratorOwner(projectId: string, senderId: number): void {
  orchestratorOwners.add(projectId, senderId);
}
// Per-project enabledModels for dispatch scoring — replaces the previous
// global process.env.MARBLO_ENABLED_MODELS that races across windows.
const projectEnabledModels = new Map<string, string[]>();

/**
 * git/gh 한 줄 실행. 절대 reject 하지 않는다 — `captureStdout`(클립보드
 * 헬퍼)와 같은 규율이되, `ok`/`stdout` 을 분리해 반환한다: "실패"와 "성공
 * 했는데 비어 있음"은 미제출 판정에서 뜻이 다르다(예: `git status
 * --porcelain` 이 성공해서 빈 문자열이면 dirty=false, 실행 자체가 실패하면
 * dirty=null). `gitSpawnEnv()` 는 git 호출에만 쓴다 — `gh` 는 그 env 오버라이드가
 * 필요 없고, 오히려 `gh` 인증에 쓰는 환경변수를 건드리지 않는 쪽이 안전하다.
 */
function runShortCommand(
  command: "git" | "gh",
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf-8",
        timeout: timeoutMs,
        windowsHide: true,
        env: command === "git" ? gitSpawnEnv() : process.env,
      },
      (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }),
    );
  });
}

/**
 * git/GitHub 실측 — 미제출 작업 축의 유일한 I/O(티켓 Z4095CT4CpAuTVtnAp9l,
 * PM 피드백). ★절대 throw 하지 않는다: 실패하면 `null` 필드로 "모름"을
 * 돌려주고, 판정 모듈(`orchestrator-unsubmitted-work.ts`)이 그 모름을 오탐
 * 방지 쪽으로 접는다.
 *
 * ★워크트리 경로는 `<worktreesRoot>/<projectId>/<taskId>` 로 결정적이다
 * (`WorktreeManager.getWorktreesRoot()` 헤더 주석 그대로) — 에이전트별
 * 조회 없이 바로 계산한다.
 *
 * ★`alreadyInBase` 는 `git diff <baseRef>...HEAD --stat` 이 비어 있는지로
 * 판정한다 — 커밋 SHA 비교(`git cherry`)가 squash 머지에서 구조적으로
 * 오탐하는 것과 달리 **패치 내용**을 본다(PM 피드백의 세 번째 정정). 한계:
 * `baseRef` 가 로컬에 최근 fetch 되지 않았으면 이 비교가 낡을 수 있다 —
 * 이 워크트리 관리 시스템 전체가 이미 그 전제 위에 있다(새 fetch 를 이
 * 함수에서 강제하지 않는다).
 */
async function getUnsurfacedGitFacts(
  projectId: string,
  taskId: string,
  branch: string,
): Promise<UnsurfacedGitFacts | null> {
  const worktreePath = path.join(
    worktreeManager.getWorktreesRoot(),
    projectId,
    taskId,
  );
  if (!fs.existsSync(worktreePath)) return null;

  const baseRef = await worktreeManager
    .resolveBaseRef(worktreePath)
    .catch(() => null);
  if (!baseRef) return null;

  const [statusRes, diffRes, aheadRes, logRes, ghRes] = await Promise.all([
    runShortCommand("git", ["status", "--porcelain"], worktreePath, 5_000),
    runShortCommand(
      "git",
      ["diff", "--stat", `${baseRef}...HEAD`],
      worktreePath,
      10_000,
    ),
    runShortCommand(
      "git",
      ["rev-list", "--count", `${baseRef}..HEAD`],
      worktreePath,
      8_000,
    ),
    runShortCommand("git", ["log", "-1", "--format=%ct"], worktreePath, 5_000),
    runShortCommand(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "all",
        "--json",
        "state,mergedAt",
        "--limit",
        "5",
      ],
      worktreePath,
      10_000,
    ),
  ]);

  const dirty = statusRes.ok ? statusRes.stdout.trim().length > 0 : null;
  const alreadyInBase = diffRes.ok ? diffRes.stdout.trim().length === 0 : null;
  const aheadCount = aheadRes.ok
    ? Number.parseInt(aheadRes.stdout.trim(), 10)
    : NaN;
  const hasCommitsAheadOfBase = Number.isFinite(aheadCount)
    ? aheadCount > 0
    : false;
  const lastCommitAt =
    logRes.ok && logRes.stdout.trim()
      ? Number(logRes.stdout.trim()) * 1000
      : null;

  let prExistsAnyState: boolean | null = null;
  let mostRecentPrMergedAt: number | null = null;
  if (ghRes.ok) {
    try {
      const prs = JSON.parse(ghRes.stdout) as Array<{
        state?: string;
        mergedAt?: string;
      }>;
      prExistsAnyState = prs.length > 0;
      const mergedTimes = prs
        .filter((p) => p.state === "MERGED" && p.mergedAt)
        .map((p) => new Date(p.mergedAt as string).getTime())
        .filter((t) => Number.isFinite(t));
      mostRecentPrMergedAt =
        mergedTimes.length > 0 ? Math.max(...mergedTimes) : null;
    } catch {
      prExistsAnyState = null; // JSON 파싱 실패 — 모름
    }
  }

  return {
    hasCommitsAheadOfBase,
    alreadyInBase,
    prExistsAnyState,
    mostRecentPrMergedAt,
    lastCommitAt,
    dirty,
  };
}

// ── 보드 → 오케 주기 재동기화 (티켓 tHQzXPvFaR29fy0I82rM) ────────────────
// 개별 push 알림(notify-orchestrator)이 유실돼도 폐루프가 살아 있도록, 보드를
// 진실원으로 삼아 "오케가 아직 통보받지 못한 REVIEW·FAILED·BLOCKED·고아 티켓·
// 체인 READY" 를 주기적으로 오케 PTY 에 밀어준다. seen 추적은 오케 PTY 세션
// 단위라 오케가 재시작되면 미처리분 전체가 자동 재통보된다(2026-09-01 앱 재시작
// 블랙아웃의 수리). 주입은 브리지 경로가 아니라 OrchestratorManager.injectMessage
// (정직한 boolean) 를 쓴다 — 실패 시 seen 미기록 → 다음 틱 재시도.
const boardResync = new OrchestratorBoardResync({
  listBoardOrchestratorProjects: () => [...orchestrators.keys()],
  getOrchestratorSession: (projectId) => {
    const s = orchestrators.get(projectId)?.getSession();
    return s ? { ptySessionId: s.ptySessionId, status: s.status } : null;
  },
  listAttentionTasks: async (): Promise<ResyncTaskRow[]> => {
    const { app, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(app);
    // 워치독 listActiveTickets 와 같은 단일 필드 "in" 쿼리 — 추가 인덱스 불필요.
    const snap = await fbGetDocs(
      fbQuery(
        fbCollection(db, "tasks"),
        // ★상태 집합은 notify-resync-coverage 가 단일소스다 — mcp-server 의
        // 미전달 기록이 "스위프가 다시 밀어준다" 고 적을지 말지를 이 목록으로
        // 판정하므로, 쿼리와 갈라지면 그게 곧 거짓 위로가 된다
        // (티켓 B0G7agMgarQPqIYEc3Jq).
        fbWhere("status", "in", [...RESYNC_ATTENTION_STATUSES]),
      ),
    );
    const now = Date.now();
    const out: ResyncTaskRow[] = [];
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      if (data.deleted === true) return;
      const projection = data.projection as
        | { lastActivityAt?: unknown }
        | undefined;
      const lastMs =
        watchdogMillis(projection?.lastActivityAt) ??
        watchdogMillis(data.claimedAt) ??
        watchdogMillis(data.updatedAt) ??
        watchdogMillis(data.createdAt);
      out.push({
        taskId: d.id,
        projectId: typeof data.projectId === "string" ? data.projectId : "",
        status: typeof data.status === "string" ? data.status : "",
        title: typeof data.title === "string" ? data.title : undefined,
        role: typeof data.role === "string" ? data.role : undefined,
        prUrl: typeof data.prUrl === "string" && data.prUrl ? data.prUrl : null,
        contextId:
          typeof data.contextId === "string" ? data.contextId : undefined,
        isMission: !!data.missionId,
        claimedBy: typeof data.claimedBy === "string" ? data.claimedBy : null,
        ageMs: lastMs === null ? null : Math.max(0, now - lastMs),
        branch:
          typeof data.branch === "string" && data.branch ? data.branch : null,
      });
    });
    return out;
  },
  isAgentAliveInFleet: (agentId) => {
    const a = agentManager.getAgent(agentId);
    return !!a && a.status !== "stopped" && a.status !== "error";
  },
  listReadyChainItems: async (projectId) => {
    const { app, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(app);
    const chain = await loadWorkChain(db, projectId);
    return chain.derived.ready.map((d) => ({
      itemId: d.item.id,
      what: d.item.what,
    }));
  },
  // ★약속 정체 패스(티켓 WLC9OjIJ8lbCAuz6WlNG)의 유일한 I/O — 새 포착기가
  //   아니라 work-chain-capture.ts 가 이미 적어 둔 것을 읽는다. open(=waiting
  //   |ready, done/dropped 제외)이고 source="auto" 인 항목만 넘긴다 —
  //   manual/owner 항목의 정체는 이 티켓 범위 밖이다.
  listOpenAutoCommitments: async (projectId) => {
    const { app, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(app);
    const chain = await loadWorkChain(db, projectId);
    return chain.derived.open
      .filter((d) => d.item.source === "auto")
      .map((d) => ({
        id: d.item.id,
        what: d.item.what,
        createdAt: d.item.createdAt,
        updatedAt: d.item.updatedAt,
      }));
  },
  inject: (projectId, message) =>
    orchestrators.get(projectId)?.injectMessage(message) ??
    Promise.resolve(false),

  // ── 자율 픽업 패스 (티켓 6hWxqjbzGQs1hzTUTihx) ────────────────────────────
  // 설계: v3/docs/orch-idle-pickup-design-2026-09-05.md.
  // ★새 플래그를 만들지 않는다 — 전진 신호와 같은 MISSION_ADVANCE_SIGNAL 하나를
  //   공유하고, 값이 정확히 "on" 일 때만 켜진다(#1416 규율, 기본값 OFF).
  idlePickupEnabled: () => isAdvanceSignalEnabled(),
  // 미션 오케가 돌면 미션 티켓의 주인이 있다는 뜻 — 픽업이 손대지 않는다.
  // 판정면은 /notify-orchestrator 의 수신자 선택과 같다(#1425 와 같은 술어).
  isMissionOrchestratorRunning: (projectId) =>
    missionOrchestrators.get(projectId)?.getSession()?.status === "running",
  // 사장님 지시가 자율 진행보다 항상 우선한다. 인바운드 저널은 로컬 파일이고
  // 수명이 몇 분이라 오래된 줄로 오탐하지 않는다(tools.ts 와 같은 판단면).
  // ★#1422 의 텔레그램 내구 큐와는 **읽기만** 겹친다 — 이 경로는 그 큐에 쓰지도
  //   드레인하지도 않는다. 사람의 말은 그 큐가 순서대로 전부 넣고, 여기서는
  //   "지금 사람이 루프 안에 있다" 는 사실만 읽어 자율 진행을 비킨다.
  isOwnerInputPending: async (projectId) => {
    const entries = await readOwnerInbound(projectId);
    return entries.some(
      (e) => !e.consumed || Object.keys(e.consumed).length === 0,
    );
  },
  // ★토큰 잔여는 **사용량 탭이 그리는 그 실측**을 읽는다 — 새 프로브도 새 합성도
  //   만들지 않는다. getAccountRateLimits() 는 TTL 캐시라 브리지의
  //   /model-guidance 와 같은 셀을 본다(읽는 셀 = 쓰는 셀). 이 콜백은 밀 후보가
  //   있고 오케가 한가할 때만 호출된다 — 조용한 틱에 계정을 찌르지 않는다.
  readQuota: async () => {
    const reservePct = resolveQuotaReservePct(
      process.env.MARBLO_QUOTA_RESERVE_PCT,
    );
    const rateLimits = await getAccountRateLimits();
    return {
      rows: harnessQuotaRows(rateLimits, loadUsageRollup(), { reservePct }),
      reservePct,
    };
  },

  // ── 활성 정체 패스 (티켓 Z4095CT4CpAuTVtnAp9l) ────────────────────────────
  // "바쁜데 일이 안 늘어나는 오케" — 유휴 스위프·자율 픽업 둘 다 놓치는 축.
  // ★새 플래그를 만들지 않는다 — 위 자율 픽업과 같은 MISSION_ADVANCE_SIGNAL
  //   하나를 공유한다(#1416 규율 그대로).
  activeStallEnabled: () => isAdvanceSignalEnabled(),

  // ── 미제출 작업 패스 (티켓 Z4095CT4CpAuTVtnAp9l, PM 피드백) ────────────────
  // "REVIEW/IN_PROGRESS 인데 GitHub 에 흔적이 없다" — 위 두 축과도 다른
  // 축이다(git/GitHub 실측). ★같은 MISSION_ADVANCE_SIGNAL 하나를 공유한다.
  unsubmittedEnabled: () => isAdvanceSignalEnabled(),
  getUnsurfacedGitFacts: (row) =>
    getUnsurfacedGitFacts(row.projectId, row.taskId, row.branch),

  // ── 약속 정체 패스 (티켓 WLC9OjIJ8lbCAuz6WlNG, 사장님 지시) ─────────────────
  // "오케가 한다고 하고 멈추는 걸 아무도 안 본다" — 위 세 축과도 다른 축이다
  // (오케 자신의 약속 하나가 안 움직인다). ★같은 MISSION_ADVANCE_SIGNAL
  // 하나를 공유한다(#1416 규율 그대로) — 새 환경변수를 만들지 않는다.
  commitmentStallEnabled: () => isAdvanceSignalEnabled(),
});
// 직접 알림이 주입에 **성공**하면 그 사실을 seen 으로 기록한다 — 정상 경로가
// 이미 전한 REVIEW/FAILED/BLOCKED 를 다이제스트가 또 밀어 오케가 이중 검증하는
// 것을 막는다. 미션 오케 알림은 보드 스위프 소관이 아니므로 거른다.
bridgeServer.setNotifyDeliveredObserver((info) => {
  if (info.target !== "board") return;
  boardResync.noteDirectDelivery(info.projectId, info.taskId, info.message);
});

// ── ★미전달 알림을 사람이 보게 (티켓 B0G7agMgarQPqIYEc3Jq) ────────────────
//
// 아무 오케에도 닿지 못한 알림은 지금까지 티켓 activity 깊은 곳에만 남았다 —
// 아무도 안 봤고, 그래서 폐루프가 몇 주간 안 도는데 이유를 아무도 몰랐다.
// telegram/slack health 와 같은 규율로 (1) 시끄러운 로그 (2) OS 알림
// (3) 렌더러 브로드캐스트 세 겹으로 올린다. OS 알림은 폭주를 막기 위해
// 프로젝트+사유 단위로 묶어 쓰로틀한다 — 오케가 꺼져 있으면 알림이 연달아
// 실패하는 것이 정상이라 매 건 팝업을 띄우면 그게 새로운 소음이 된다.
const NOTIFY_UNDELIVERED_ALERT_THROTTLE_MS = 5 * 60_000;
const notifyUndeliveredLastAlertAt = new Map<string, number>();

bridgeServer.setNotifyUndeliveredObserver((info) => {
  console.error(
    `[NotifyUndelivered] project=${info.projectId || "missing"} ` +
      `context=${info.contextId || "board"} target=${info.requestedTarget}` +
      (info.deliveredTo ? ` (attempted=${info.deliveredTo})` : "") +
      (info.taskId ? ` task=${info.taskId}` : "") +
      ` — ${info.reason}: ${info.message.slice(0, 160)}`,
  );
  broadcast("orchestrator:notifyUndelivered", {
    projectId: info.projectId,
    contextId: info.contextId,
    taskId: info.taskId,
    requestedTarget: info.requestedTarget,
    deliveredTo: info.deliveredTo,
    reason: info.reason,
    preview: info.message.slice(0, 200),
    at: Date.now(),
  });
  const key = `${info.projectId}|${info.requestedTarget}|${info.reason}`;
  const now = Date.now();
  const last = notifyUndeliveredLastAlertAt.get(key) ?? 0;
  if (now - last < NOTIFY_UNDELIVERED_ALERT_THROTTLE_MS) return;
  notifyUndeliveredLastAlertAt.set(key, now);
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: "오케 알림이 전달되지 않았습니다",
        body:
          `${info.reason}\n` +
          `${info.taskId ? `티켓 ${info.taskId} · ` : ""}${info.message.slice(
            0,
            120,
          )}`,
      }).show();
    }
  } catch {
    /* OS 알림은 best-effort — 실패가 배달 경로를 죽이면 안 된다 */
  }
});

function createOrchestratorInstance(projectId: string): OrchestratorManager {
  const orchestrator = new OrchestratorManager(
    ptyManager,
    agentManager.getConfigGenerator(),
    (status, detail) => {
      refreshWorkPowerSaveBlocker();
      // ★사유를 status 와 같은 봉투에 담는다. 예전엔 `{ status }` 만 실려 나가서
      // 렌더러가 "멈췄다" 는 알아도 "왜" 를 알 길이 없었고, 사유는 main 의
      // console.error 에만 남았다(F-4, ymRo9BtilQnb48Y5ol68).
      //
      // ★실리는 것은 **분류값뿐**이다 — `reason` 은 OrchestratorHaltReason 유니온의
      // 리터럴, `spawnErrno` 는 UI가 허용한 두 errno 중 하나, `model` 은 CLI id다.
      // PTY 원문은 이 경로로 나가지 않는다(그 규약의 근거는
      // orchestrator-manager 의 ORCHESTRATOR_HALT_REASONS 주석).
      const payload = {
        status,
        ...(detail?.reason ? { reason: detail.reason } : {}),
        ...(detail?.spawnErrno ? { spawnErrno: detail.spawnErrno } : {}),
        ...(detail?.model ? { model: detail.model } : {}),
      };
      // Route status to every window showing this project's orchestrator
      // (they share one instance, so they must all see the same status).
      // Broadcast as fallback when no owner is known (e.g., scratch instance
      // from getAnyOrchestrator).
      const owners = orchestratorOwners.ownersOf(projectId);
      if (owners && owners.size > 0) {
        for (const ownerId of owners) {
          sendToOwner(ownerId, "orchestrator:statusChanged", payload);
        }
      } else {
        broadcast("orchestrator:statusChanged", payload);
      }
      // Mirror the agent listener policy: detach only on "stopped". "error"
      // can be transient (orchestrator-manager auto-restarts up to 3 times
      // with exponential backoff and reattaches via the launch onPtyReady
      // callback), so we leave the listener up so a pending instruction
      // queued during the crash window is delivered after recovery.
      if (status === "stopped" && projectId) {
        pendingListener.detach(`orch-${projectId}`);
        // Telegram 인계(handover) 로직은 제거됐다 — 폴러가 오케에 종속되지 않고
        // electron main 이 소유하므로 오케가 멈춰도 인계할 것이 없다
        // (ticket vw38IB2VcmOIOlFV51Wa).
      }
    },
  );
  // "error" alone doesn't say WHY, and a dead rootPath produces no output at
  // all — the shell never starts. Name the cause instead of leaving the user
  // with an orchestrator that just won't attach.
  orchestrator.setRootPathMissingHandler(notifyRootPathMissing);
  // 오케 세션 원문 캡처(ticket IqcXHVbT0rXnHloXpV7n). 오케는 agent-manager 를
  // 안 타서 cost-tracker sink 로는 절대 안 들어온다 — 세션 id 초크포인트에
  // 직접 붙인다. 게이트가 닫혀 있으면 파일을 읽지도 않는다.
  orchestrator.setSessionTranscriptHandler(trackOrchestratorSession);
  // ★오케 비용 수집(ticket TaDiWyLNi5ihBnjfVmMs). transcript 훅과 별도인 이유는
  // orchestrator-manager 의 setCostSessionHandler 주석 참조 — 격리 홈 하네스는
  // claude 세션 id 초크포인트를 영원히 안 탄다.
  orchestrator.setCostSessionHandler(trackOrchestratorCostSession);
  return orchestrator;
}

function getOrchestrator(projectId: string): OrchestratorManager {
  let m = orchestrators.get(projectId);
  if (!m) {
    m = createOrchestratorInstance(projectId);
    orchestrators.set(projectId, m);
  }
  return m;
}

/**
 * Return any existing orchestrator instance for stateless file-IO calls
 * (resolveSessionId, listSessions, saveSessionLabel). Lazy-creates a
 * scratch instance if none exist yet — that instance is also stored as
 * the "default" so subsequent reads stay consistent.
 */
function getAnyOrchestrator(): OrchestratorManager {
  const first = orchestrators.values().next().value;
  if (first) return first;
  // No project yet — store under empty key so we don't keep creating.
  const m = createOrchestratorInstance("");
  orchestrators.set("", m);
  return m;
}

/** Resolve the orchestrator for a webContents (sender) window. */
function getOrchestratorForSender(
  senderId: number,
): OrchestratorManager | null {
  for (const [projectId, owners] of orchestratorOwners.entries()) {
    if (owners.has(senderId)) return orchestrators.get(projectId) ?? null;
  }
  return null;
}

// Connect orchestrator lookup to bridge so MCP tools can notify the right
// orchestrator. Bridge selects by projectId from the request body / agent's
// MARBLO_PROJECT env.
bridgeServer.setOrchestratorLookup(
  (projectId: string) => orchestrators.get(projectId) ?? null,
);

// Per-project enabledModels lookup — replaces the global env var fallback
// in BridgeServer.dispatchTask so concurrent windows can dispatch with
// different model presets simultaneously.
bridgeServer.setEnabledModelsLookup((projectId: string) =>
  projectEnabledModels.get(projectId),
);

// Persist each dispatch's resolved cwd/model/complexity onto the task doc as
// `dispatchMeta`. The agent-health watchdog reads it back on respawn so recovery
// restores the original working tree + model instead of re-resolving them — the
// fix for "respawn drops the cwd override → fresh empty base worktree → false
// BLOCKED, and claude reborn as gpt". setDoc(merge) is create-or-update and
// never clobbers sibling fields. Best-effort, fire-and-forget.
bridgeServer.setDispatchMetaHook((taskId, meta) => {
  void (async () => {
    try {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      await fbSetDoc(
        fbDoc(db, "tasks", taskId),
        {
          dispatchMeta: {
            cwd: meta.cwd,
            model: meta.model,
            complexity: meta.complexity ?? null,
            dispatchReason: meta.dispatchReason ?? null,
            // KG routing attribution keys (spec 2026-07-22 §7) — the
            // graph-updater reads these back to fold a later outcome into the
            // right (context × model) cells.
            role: meta.role ?? null,
            tags: meta.tags ?? null,
            taskType: meta.taskType ?? null,
            // ★P2-2 — 그래프 모델축 키(실스폰 argv 관측). 없으면 null 로 남겨
            // 두고, 읽는 쪽이 프로바이더 키로 떨어진다(추측 키를 만들지 않는다).
            spawnedModelKey: meta.spawnedModelKey ?? null,
            updatedAt: fbTimestamp.now(),
          },
        },
        { merge: true },
      );
    } catch (err) {
      console.warn(
        "[DispatchMeta] Failed to persist dispatchMeta for task",
        taskId,
        err instanceof Error ? err.message : err,
      );
    }
  })();
});

bridgeServer.setTaskAgentActivityHook(async (taskId, agentId) => {
  const { app, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(app);
  const snap = await fbGetDoc(fbDoc(db, "tasks", taskId));
  if (!snap.exists()) return { hasBoardActivity: false };
  const data = snap.data() as {
    priority?: unknown;
    projection?: {
      lastAgentId?: unknown;
      lastActivitySummary?: unknown;
      lastActivityAt?: unknown;
    };
  };
  const projection = data.projection;
  const lastAgentId =
    typeof projection?.lastAgentId === "string" ? projection.lastAgentId : "";
  const summary =
    typeof projection?.lastActivitySummary === "string"
      ? projection.lastActivitySummary.trim()
      : "";
  const isDispatchBaseline = summary.startsWith("dispatched to ");
  return {
    hasBoardActivity:
      lastAgentId === agentId && summary !== "" && !isDispatchBaseline,
    // ★WHEN — without this the proof was "has it ever posted?", and an agent
    // quiet for 80 minutes kept winning "already bound" (2026-08-22).
    lastActivityAtMs: watchdogMillis(projection?.lastActivityAt),
    priority:
      typeof data.priority === "number" && Number.isFinite(data.priority)
        ? data.priority
        : null,
  };
});

// When the bridge spawns an agent (via MCP /spawn-agent or /dispatch-task),
// route its PTY output to the project-owning window and emit agent:spawned
// scoped to that project. This keeps multi-window spawns isolated.
//
// Owner resolution chain (first match wins):
//   1. explicit projectId in the spawn request → window registered for it
//   2. parentAgentId.MARBLO_PROJECT (parent agent's launchConfig env)
//   3. orchestratorOwners lookup if parentAgentId looks like an orchestrator
//      session id (`orchestrator-*`)
//   4. mainWindow fallback (legacy / single-window mode)
function resolveSpawnOwner(
  projectId: string | undefined,
  parentAgentId: string | undefined,
): { ownerId: number | undefined; resolvedProjectId: string | undefined } {
  // 1. explicit projectId
  if (projectId) {
    const owner = getOwnerForProject(projectId);
    if (owner !== undefined)
      return { ownerId: owner, resolvedProjectId: projectId };
  }
  // 2. parent agent's project (look up via agentManager)
  if (parentAgentId) {
    const parent = agentManager.getAgent(parentAgentId);
    const parentProject = parent?.launchConfig?.env?.MARBLO_PROJECT;
    if (parentProject) {
      const owner = getOwnerForProject(parentProject);
      if (owner !== undefined)
        return { ownerId: owner, resolvedProjectId: parentProject };
    }
    // 3. orchestrator parent — find which window owns its project
    if (parentAgentId.startsWith("orchestrator-")) {
      // orchestratorOwners is projectId → webContentsIds. Any window that has
      // an orchestrator running matches; if multiple, pick the first
      // (deterministic enough for fallback).
      for (const [pid, ownerWins] of orchestratorOwners.entries()) {
        for (const ownerWin of ownerWins) {
          return { ownerId: ownerWin, resolvedProjectId: pid };
        }
      }
    }
  }
  return { ownerId: undefined, resolvedProjectId: projectId };
}

bridgeServer.setAgentSpawnedHook(
  ({
    sid,
    projectId,
    agentId,
    parentAgentId,
    name,
    model,
    role,
    spawnedModel,
  }) => {
    // (Re-)attach the pending-instruction listener with the current PTY
    // session. On auto-restart `sid` changes, so detach first to discard
    // the stale closure, then attach with the fresh sid.
    pendingListener.detach(agentId);
    pendingListener.attach(agentId, sid);

    const { ownerId, resolvedProjectId } = resolveSpawnOwner(
      projectId,
      parentAgentId,
    );
    if (ownerId !== undefined) {
      addPtyOwner(sid, ownerId);
    }
    setupPtyForwarding(sid);

    // Build the payload from values passed by the bridge — at this point
    // agentManager.agents.set hasn't run yet, so getAgent(agentId) returns
    // undefined. Falling back to that lookup was leaking model="claude"
    // for every Codex / Gemini agent and corrupting the Firestore doc the
    // renderer wrote on receipt.
    const payload = {
      agentId,
      name,
      ptySessionId: sid,
      model,
      role,
      // 벤더(model)와 별개인 구체 모델 축. 재시작도 같은 onPtyReady 를 재사용해
      // 이 훅을 다시 태우므로, 강등/폴백으로 모델이 바뀌면 렌더러가 재스탬프한다.
      spawnedModel,
    };
    if (resolvedProjectId) {
      sendToProject(resolvedProjectId, "agent:spawned", payload);
    } else {
      broadcast("agent:spawned", payload);
    }
  },
);

// Inject session resolver so agent auto-restart resolves 'latest' per-agent.
// Stateless file-IO — any instance works.
agentManager.setSessionResolver(
  (rootPath, requested, filterLabel, filterAgentId) =>
    getAnyOrchestrator().resolveSessionId(
      rootPath,
      requested,
      filterLabel,
      filterAgentId,
    ),
);

// --- Mission Engine Wire (Phase 3, Step 5) ---
// All upstream deps (bridgeServer, agentManager, ptyManager, orchestrators map,
// createOrchestratorInstance) are now defined. Build the mission-engine bundle
// here so the agent-status callback declared above can forward into it via the
// late-bound `missionBundle`.
let taskDecomposer: TaskDecomposer | null = null;
function getDecomposer(): TaskDecomposer {
  if (!taskDecomposer) taskDecomposer = new TaskDecomposer();
  return taskDecomposer;
}

// Mission 전용 orchestrator pool — board 용 `orchestrators` 와 분리.
// 같은 projectId 라도 board 와 mission 은 각자의 Claude Code 세션을 들고 있다.
// 컨텍스트 오염 방지 + 동시 사용 가능 + 미션 PTY 가 Missions 탭에 별도 노출.
const missionOrchestrators = new Map<string, OrchestratorManager>();
const missionOrchestratorOwners = new Map<string, number>(); // projectId → webContents.id

function adoptMainAccountScope(nextUid: string | null, reason: string): void {
  if (activeAccountUid === nextUid) return;
  const prevUid = activeAccountUid;
  activeAccountUid = nextUid;

  // Explicit account-scoped runtime list. Do not add device-scoped state here:
  // machineId, static server port, model defaults, and power settings stay on
  // the install, not the signed-in account.
  windowProjects.clear();
  windowRestore.clear();
  ptyOwners.clear();
  ptyBuffers.clear();
  orchestratorOwners.clear();
  missionOrchestratorOwners.clear();
  projectEnabledModels.clear();
  pendingListener.detachAll();
  for (const manager of orchestrators.values()) {
    manager.stop();
  }
  orchestrators.clear();
  for (const manager of missionOrchestrators.values()) {
    manager.stop();
  }
  missionOrchestrators.clear();
  for (const agent of agentManager.listAgents()) {
    agentManager.remove(agent.id);
  }
  ptyManager.killAll();
  fsManager.stopAllWatching();
  refreshWorkPowerSaveBlocker();

  console.info(
    `[AccountScope] main runtime reset (${reason}) prev=${
      prevUid ? "set" : "none"
    } next=${nextUid ? "set" : "none"}`,
  );

  if (nextUid) {
    restoreWindowSession(nextUid);
  }
}

// Mission orchestrator lookup — lets /notify-orchestrator route mission-context
// task notifications (contextId=missionId) to the per-project MISSION
// orchestrator instead of the board one, so mission progress stays out of the
// board orchestrator PTY. `missionOrchestrators` is populated lazily by
// ensureMissionOrchestratorLaunched / missionOrchestrator:start; until a mission
// orchestrator exists this returns null and the bridge drops the mission
// notification (never falls back to the board orch).
bridgeServer.setMissionOrchestratorLookup(
  (projectId: string) => missionOrchestrators.get(projectId) ?? null,
);

// ── Telegram poller (electron-main-owned, ticket vw38IB2VcmOIOlFV51Wa) ──
// Exactly one getUpdates loop per project, owned here — NOT inside any
// orchestrator (which used to carry --channels and 409-flap on churn).
// Inbound resolves the CURRENT live orchestrator (board wins over mission) and
// injectMessage()s the text; when none is live the poller holds the offset so
// the message is delivered after the next boot (at-least-once). Outbound
// (send_telegram_message MCP tool → bridge) routes into sendMessage().
// ★기기 귀속 관측자 (티켓 t5X4CUwr4LqbEZNRpeEZ). "이 채널을 어느 기기가
// 인증했는가"라는 지속 사실을 채널 스토어가 볼 수 있게 꽂는다. 위 리스와
// 혼동하지 말 것 — 리스는 90초 TTL 의 협조적 소유권이고 이건 만료 없는 사실이다.
// ★관측 전(부팅 직후)이나 실패 시 판정은 unknown 이고 아무것도 막지 않는다.
setTelegramBindingObserver(createTelegramBindingObserver(() => getMachineId()));

const telegramPoller = new TelegramPoller({
  // ★기기 간 폴러 리스 (티켓 hAzP05kOTxggd8LhZGwT). 맥북프로와 맥미니가 같은
  // 봇을 동시에 폴링해 서로를 409 로 강탈하던 경로를 닫는다. holderId 는 이
  // 기기의 안정 machineId, hostLabel 은 사람이 읽을 호스트명 — 사용자에게
  // "다른 기기가 이 봇을 사용 중입니다 — <hostLabel>" 로 그대로 나간다.
  // ★리스가 실패하면 폴링을 막지 않는다(fail-open) — telegram-poller-lease 참고.
  leaseGate: new TelegramPollerLeaseManager({
    remote: createTelegramLeaseRemote(),
    holderId: () => getMachineId(),
    hostLabel: () => os.hostname(),
  }),
  resolveOrchestrator: (projectId: string) => {
    const board = orchestrators.get(projectId);
    if (board && board.isRunning()) {
      return telegramInboundTarget(board, "board");
    }
    const mission = missionOrchestrators.get(projectId);
    if (mission && mission.isRunning()) {
      return telegramInboundTarget(mission, "mission");
    }
    return null;
  },
  onLoopActivityChange: () => refreshWorkPowerSaveBlocker(),
  // ★배달을 일어난 순간 저널에 남긴다 (티켓 nMpBzIMJmkSFqrrZfSKz). 아래
  // telegramRouteJournal 은 60초 주기로 "마지막 배달 update id" 한 칸만 찍어서,
  // 두 표본 사이에 두 건이 배달되면 앞 건이 어느 표본에도 안 나왔다 —
  // 2026-09-05 에 96862774 가 배달됐는지 사라졌는지 데이터로 말할 수 없던 이유다.
  // (선언은 아래에 있지만 호출은 배달 시점이라 TDZ 에 걸리지 않는다.)
  onDelivered: (projectId, updateId) => {
    telegramRouteJournal.sample(`delivered:${projectId}:${updateId}`);
  },
});
bridgeServer.setSendTelegramMessage((projectId, text, chatId) =>
  telegramPoller.sendMessage(projectId, text, chatId),
);

// ── Telegram route journal (ticket c1R9C8v5MrBycZYSdTeB) ──────────────────
// logTelegramRouteHealth only fires on EVENTS (switch, launch), so the quiet
// stretches — exactly the ones the boss reports — left no record at all. This
// samples the same health on a TIMER and appends it to a capped JSONL, so
// "the loop stopped" and "the loop is turning but injection is refused" can be
// told apart after the fact. Read-only: it never touches delivery.
//
// `getSystemIdleTime` is what ties a sample to "the boss was away", and the
// sampler's own lateness (driftMs) is the only way app-level throttling of the
// Electron main timers would show up.
const telegramRouteJournal = new TelegramRouteJournal({
  listProjects: () => telegramPoller.activeProjectIds(),
  getRouteHealth: (projectId) => telegramPoller.getRouteHealth(projectId),
  getSystemIdleSeconds: () => {
    try {
      return powerMonitor.getSystemIdleTime();
    } catch {
      return null;
    }
  },
  getPowerSaveBlockerActive: () => isWorkPowerSaveBlockerActuallyStarted(),
  // 오케 PTY 의 제출 결말 집계. 인바운드가 향하는 바로 그 PTY 를 고른다
  // (board 우선, 없으면 mission) — resolveOrchestrator 와 같은 규칙이다.
  getSubmitTally: (projectId) => {
    const manager =
      orchestrators.get(projectId) ?? missionOrchestrators.get(projectId);
    const ptySessionId = manager?.getSession()?.ptySessionId;
    return ptySessionId ? ptyManager.getSubmitTally(ptySessionId) : null;
  },
  // ★Ticket VCGuLWmNTlhoRvwGAKJA axis D. On the affected MacBook Pro the
  // screen locks; on the two machines that never lose inbound it does not. The
  // lock window measured on 2026-09-04 (09-03 19:06 → 09-04 10:03, 14h57m)
  // covers the whole reported silence AND #1397's overnight error ramp.
  // Recording the state per sample is what turns that correlation into
  // something the next silence can confirm or kill.
  getScreenLocked: () => screenLocked,
});

// ── Slack Socket Mode client (electron-main-owned, ticket GjEj83bvxJs701irBKJl) ──
// The Telegram poller mirrored onto Slack: exactly one Socket Mode connection
// per project, owned here. It resolves the SAME orchestrator target as Telegram
// (board wins over mission) and injectMessage()s the text — the two inbound
// paths coexist and share one orchestrator. When no orchestrator is live the
// inbound is queued to disk and redelivered after the next boot (Slack demands
// a 3s envelope ack, so "hold the offset" is not available — see slack-poller).
// Outbound (send_slack_message MCP tool → bridge) routes into sendMessage().
const slackPoller = new SlackPoller({
  resolveOrchestrator: (projectId: string) => {
    const board = orchestrators.get(projectId);
    if (board && board.isRunning()) {
      return telegramInboundTarget(board, "board");
    }
    const mission = missionOrchestrators.get(projectId);
    if (mission && mission.isRunning()) {
      return telegramInboundTarget(mission, "mission");
    }
    return null;
  },
  onLoopActivityChange: () => refreshWorkPowerSaveBlocker(),
});
bridgeServer.setSendSlackMessage((projectId, text, opts) =>
  slackPoller.sendMessage(projectId, text, opts),
);

let assistantTriggerManager: AssistantTriggerManager | null = null;

function telegramInboundTarget(
  manager: OrchestratorManager,
  kind: "board" | "mission",
): InboundTarget {
  return {
    injectMessage: (text) => manager.injectMessage(text),
    isRunning: () => manager.isRunning(),
    describe: () => {
      const session = manager.getSession();
      return {
        kind,
        ptySessionId: session?.ptySessionId ?? null,
        status: manager.getStatus(),
      };
    },
    // ★"오케가 죽었다" 와 "오케는 살아 있는데 컴포저가 막혔다" 를 폴러가
    // 구분할 수 있게 하는 유일한 통로(티켓 c1R9C8v5MrBycZYSdTeB). 진단 전용 —
    // injectMessage 의 boolean 과 보류 의미는 그대로다.
    describeInjectFailure: () => {
      const outcome = manager.getLastInjectOutcome();
      if (!outcome || outcome.ok || !outcome.refusal) return null;
      return {
        refusal: outcome.refusal,
        composer: outcome.composer,
        // ★막힘의 사유까지 실어 보낸다(티켓 nMpBzIMJmkSFqrrZfSKz) — 폴러의
        //   안내문이 "사장님 초안" 과 "오케가 턴 중" 을 가르는 유일한 근거다.
        occupancy: outcome.occupancy,
        detail: outcome.detail,
      };
    },
  };
}

/**
 * 비서 트리거 발화 시점에 오케를 깨운다.
 *
 * ★관문마다 **사유를 실어** 돌려준다(티켓 lcR4OMWCriWIpwbVDwVt). 예전에는 전부
 * `null` 이라 로그에만 남았고, 사용자에게는 "켜 뒀는데 아무 일도 안 일어난다" 로만
 * 보였다. 로그인이 풀린 것 · MCP 가 안 붙은 것 · 폴더를 옮긴 것 · 잔액이 빈 것은
 * **서로 다른 행동**을 요구하므로 뭉치면 아무것도 고칠 수 없다.
 */
async function ensureAssistantTriggerOrchestrator(
  projectId: string,
  rootPath?: string,
): Promise<AssistantTriggerResolution> {
  const running = orchestrators.get(projectId);
  if (running?.isRunning()) return running;
  const resolvedPath =
    rootPath && rootPath.trim()
      ? rootPath.trim() === "~"
        ? os.homedir()
        : rootPath.trim()
      : "";
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    console.warn(
      `[AssistantTriggers] cannot wake orchestrator for project=${projectId}: missing local folderPath`,
    );
    return { unavailableReason: "orchestrator-folder-missing" };
  }
  const decision = await resolveOrchestratorModelDecision(projectId);
  const effectiveModelSetting = decision.setting;
  applyOrchestratorModelEnv(effectiveModelSetting);
  const orchestratorModel = resolveOrchestratorModel();
  const orchestratorPins = orchestratorModelPins(effectiveModelSetting);
  const orchGate = await checkSpawnAuthGate(
    orchestratorModel,
    splitOrchestratorModelValue(effectiveModelSetting).modelId,
    "orchestrator_launch",
  );
  if (!orchGate.ok) {
    console.warn(
      `[AssistantTriggers] orchestrator auth gate blocked project=${projectId} model=${orchestratorModel} reason=${orchGate.reason}`,
    );
    return { unavailableReason: "orchestrator-auth-blocked" };
  }
  const orchMcpGate = await checkOrchestratorMcpGate(
    orchestratorModel,
    resolvedPath,
  );
  if (!orchMcpGate.ok) {
    console.warn(
      `[AssistantTriggers] orchestrator MCP gate blocked project=${projectId}`,
    );
    return { unavailableReason: "orchestrator-mcp-blocked" };
  }
  // 3번째 관문(벤더 잔액). ★이 경로는 **사용자가 화면 앞에 없을 때** 오케를
  // 깨우므로 배너를 띄울 상대가 없다 — 그래서 조용히 안 띄우는 대신 사유를 로그로
  // 남기고 멈춘다. 여기서 통과시키면 무인 기동이 매번 400 을 뱉는 오케를 세운다.
  const orchVendorGate = await checkOrchestratorVendorGate(
    effectiveModelSetting,
  );
  if (!orchVendorGate.ok) {
    console.warn(
      `[AssistantTriggers] orchestrator vendor gate blocked project=${projectId} status=${orchVendorGate.status} — ${orchVendorGate.action}`,
    );
    return { unavailableReason: "orchestrator-vendor-blocked" };
  }
  const port = bridgeServer.getPort();
  if (!port) {
    console.warn(
      `[AssistantTriggers] cannot wake orchestrator for project=${projectId}: bridge not ready`,
    );
    // 앱이 아직 뜨는 중이다 — 사용자가 할 일은 "기다린다" 뿐이라 offline 과 같은 칸.
    return { unavailableReason: "orchestrator-offline" };
  }
  const orch = getOrchestrator(projectId);
  orch.launch(
    projectId,
    resolvedPath,
    port,
    (sid, { reused }) => {
      if (reused) return;
      setupPtyForwarding(sid);
      hookOrchestratorActivity(sid, projectId);
      pendingListener.attach(`orch-${projectId}`, sid);
      logTelegramRouteHealth(projectId, "assistant-trigger-pty-ready");
    },
    "latest",
    undefined,
    {
      modelOverride: orchestratorModel,
      claudeModelOverride: orchestratorPins.claudeModel,
      codexModelOverride: orchestratorPins.codexModel,
      codexEffortOverride: orchestratorPins.codexEffort,
      nativeModelOverride: orchestratorPins.nativeModel,
      // 임계 이하 잔액 경고를 오케 자신에게 전달한다(없으면 필드 자체가 안 붙어
      // 부트 프롬프트가 종전과 바이트 동일하다).
      ...(orchVendorGate.bootNotice
        ? { bootNotice: orchVendorGate.bootNotice }
        : {}),
    },
  );
  saveProjectOrchestratorModel(
    projectId,
    effectiveModelSetting,
    decision.source,
  );
  return orch;
}

async function listAssistantTriggerProjects(): Promise<
  AssistantTriggerProject[]
> {
  const uid = currentRealUserUid();
  if (!uid) return [];
  const { app: fbApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(fbApp);
  const snap = await fbGetDocs(
    fbQuery(
      fbCollection(db, "projects"),
      fbWhere("members", "array-contains", uid),
    ),
  );
  const projects: AssistantTriggerProject[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    projects.push({
      id: docSnap.id,
      name: typeof data.name === "string" ? data.name : docSnap.id,
      kind: typeof data.kind === "string" ? data.kind : undefined,
      folderPath:
        typeof data.folderPath === "string" ? data.folderPath : undefined,
      assistantTriggers: data.assistantTriggers,
    });
  });
  return projects;
}

function assistantWebhookEventFromDoc(
  docId: string,
  data: Record<string, unknown>,
): AssistantTriggerWebhookEvent | null {
  const payload =
    data.payload &&
    typeof data.payload === "object" &&
    !Array.isArray(data.payload)
      ? (data.payload as Record<string, unknown>)
      : {};
  const cleanPayload: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      cleanPayload[key] = value;
    }
  }
  const event = typeof data.event === "string" ? data.event : "";
  if (!event) return null;
  const receivedAt =
    data.receivedAt instanceof fbTimestamp
      ? data.receivedAt.toDate().toISOString()
      : undefined;
  return {
    id: docId,
    event,
    source: typeof data.source === "string" ? data.source : undefined,
    payload: cleanPayload,
    receivedAt,
  };
}

async function listAssistantWebhookEvents(
  projectId: string,
  limit: number,
): Promise<
  | { ok: true; events: AssistantTriggerWebhookEvent[] }
  | { ok: false; error: string }
> {
  const uid = currentRealUserUid();
  if (!uid) return { ok: true, events: [] };
  try {
    const { app: fbApp, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(fbApp);
    const snap = await fbGetDocs(
      fbQuery(
        fbCollection(db, "projects", projectId, "assistantWebhookEvents"),
        fbWhere("status", "==", "pending"),
        fbLimit(Math.max(1, Math.min(20, Math.trunc(limit)))),
      ),
    );
    const events: AssistantTriggerWebhookEvent[] = [];
    snap.forEach((docSnap) => {
      const parsed = assistantWebhookEventFromDoc(
        docSnap.id,
        docSnap.data() as Record<string, unknown>,
      );
      if (parsed) events.push(parsed);
    });
    events.sort((a, b) =>
      (a.receivedAt ?? "").localeCompare(b.receivedAt ?? ""),
    );
    return { ok: true, events };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function claimAssistantWebhookEvent(
  projectId: string,
  eventId: string,
): Promise<{ ok: true; claimed: boolean } | { ok: false; error: string }> {
  const uid = currentRealUserUid();
  if (!uid) return { ok: true, claimed: false };
  try {
    const { app: fbApp, authReady } = getMissionFirebaseApp();
    await authReady;
    const db = getFirestore(fbApp);
    const ref = fbDoc(
      db,
      "projects",
      projectId,
      "assistantWebhookEvents",
      eventId,
    );
    const claimed = await fbRunTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const data = snap.data() as Record<string, unknown>;
      if (data.status !== "pending") return false;
      tx.update(ref, {
        status: "consumed",
        consumedAt: fbServerTimestamp(),
        consumedBy: uid,
      });
      return true;
    });
    return { ok: true, claimed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 이 사용자가 멤버인 프로젝트 id 들 — 미션 엔진의 Firestore 구독 스코프.
 *
 * ★missions 룰이 멤버 스코프로 바뀌면서 필요해졌다(티켓 Ciriq5ASEvAlA8TnKxhW).
 *   엔진은 예전에 `where("status","==","planning")` 무스코프 쿼리를 쐈고 룰이
 *   `isAuthenticated()` 뿐이라 통과했다. 지금은 통째로 거부되므로 projectId 를
 *   고정해야 한다("security rules are not filters").
 *
 * 실사용자로 로그인돼 있지 않으면 빈 배열 — 익명 uid 로는 어차피 어떤 프로젝트
 * 문서도 읽을 수 없고, 호출부는 빈 스코프에서 구독을 건너뛴다.
 * (listAssistantTriggerProjects 와 동일한 경로/전제다.)
 */
async function listMemberProjectIds(): Promise<string[]> {
  const uid = currentRealUserUid();
  if (!uid) return [];
  const { app: fbApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(fbApp);
  const snap = await fbGetDocs(
    fbQuery(
      fbCollection(db, "projects"),
      fbWhere("members", "array-contains", uid),
    ),
  );
  const ids: string[] = [];
  snap.forEach((docSnap) => ids.push(docSnap.id));
  return ids;
}

function logTelegramRouteHealth(projectId: string, reason: string): void {
  const health = telegramPoller.getRouteHealth(projectId);
  const target = health.lastDeliveredTarget;
  console.info(
    `[TelegramPoller:${reason}] project=${projectId} loop=${
      health.loopRunning ? "running" : "stopped"
    } ` +
      `lastChatIdKnown=${health.lastChatIdKnown} pendingReply=${health.pendingReply} ` +
      `lastDeliveredUpdateId=${health.lastDeliveredUpdateId ?? "none"} ` +
      `lastTarget=${
        target
          ? `${target.kind}:${target.ptySessionId ?? "unknown"}:${
              target.status
            }`
          : "none"
      } ` +
      `unanswered=${health.reliability.unanswered} sendFailures=${health.reliability.sendFailures} ` +
      // ★보류/루프 상태 (티켓 c1R9C8v5MrBycZYSdTeB). loop=running 은 핸들이
      // 등록돼 있다는 뜻일 뿐이라, 그것만으로는 "안 들어온다" 의 두 원인을
      // 못 가른다. 마지막 왕복 시각과 보류 사유를 같은 줄에 붙인다.
      `pollDone=${
        health.lastPollCompletedAt
          ? `${Math.round((Date.now() - health.lastPollCompletedAt) / 1000)}s ago`
          : "never"
      } pollErrors=${health.consecutivePollErrors} ` +
      `hold=${
        health.hold
          ? `${health.hold.reason}@${health.hold.updateId} ${Math.round(
              health.hold.heldMs / 1000,
            )}s x${health.hold.attempts}${
              health.hold.detail?.composer
                ? ` composer=${health.hold.detail.composer}`
                : ""
            }`
          : "none"
      }`,
  );
  // 같은 체크포인트를 시계열에도 한 줄 남긴다 — 이벤트 로그와 시계열이 서로
  // 다른 이야기를 하는 일이 없게.
  telegramRouteJournal.sample(reason);
  logSlackRouteHealth(projectId, reason);
}

/**
 * The Slack half of the same route diagnosis. Called from the Telegram logger
 * so every switch/launch checkpoint reports BOTH inbound paths — with two
 * channels feeding one orchestrator, "which PTY gets inbound" has to be
 * answered for each. Silent when the project has no Slack connection and
 * nothing queued.
 */
function logSlackRouteHealth(projectId: string, reason: string): void {
  const health = slackPoller.getRouteHealth(projectId);
  if (!health.connected && health.pendingInbound === 0) return;
  const target = health.lastDeliveredTarget;
  console.info(
    `[SlackPoller:${reason}] project=${projectId} socket=${
      health.connected ? "connected" : "disconnected"
    } ` +
      `lastChannelKnown=${health.lastChannelKnown} pendingReply=${health.pendingReply} ` +
      `pendingInbound=${health.pendingInbound} lastDelivered=${
        health.lastDeliveredKey ?? "none"
      } ` +
      `lastTarget=${
        target
          ? `${target.kind}:${target.ptySessionId ?? "unknown"}:${
              target.status
            }`
          : "none"
      } ` +
      `unanswered=${health.reliability.unanswered} sendFailures=${health.reliability.sendFailures} ` +
      `droppedOverflow=${health.reliability.droppedOverflow}`,
  );
}

function collectWorkPowerSaveSources(): Exclude<
  WorkPowerSaveSource,
  "remote-wait"
>[] {
  const sources: Exclude<WorkPowerSaveSource, "remote-wait">[] = [];
  const hasRunningOrchestrator = [
    ...orchestrators.values(),
    ...missionOrchestrators.values(),
  ].some((manager) => {
    const status = manager.getStatus();
    return status === "starting" || status === "running";
  });
  if (hasRunningOrchestrator) sources.push("orchestrator");

  const hasWorkingAgent = agentManager
    .listAgents()
    .some((agent) => agent.status === "working");
  if (hasWorkingAgent) sources.push("agent");

  if (telegramPoller.hasActiveLoops()) sources.push("telegram-poller");
  // A live Socket Mode connection is real inbound work — letting the app
  // suspend would silently deafen the Slack channel exactly like it does the
  // Telegram poller.
  if (slackPoller.hasActiveLoops()) sources.push("slack-socket");
  return sources;
}

/**
 * ★findings (ticket VCGuLWmNTlhoRvwGAKJA) — why loop-stalled/driftMs≈15-17min
 * can still happen while this blocker is held:
 *
 * 1. `prevent-app-suspension` only prevents macOS *idle* sleep. Apple's own
 *    QA1340 says explicitly: "even with I/O Kit, it is not possible to
 *    prevent forced sleep, only delay it" — and lid-close is classified as
 *    forced sleep, not idle sleep.
 *    https://developer.apple.com/library/archive/qa/qa1340/_index.html
 * 2. Holding an IOKit/NSProcessInfo assertion (which this blocker is, under
 *    the hood) DOES exempt the app from App Nap per Apple's App Nap guide —
 *    so App Nap throttling is not the likely culprit while the assertion is
 *    genuinely held:
 *    https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html
 * 3. Clamshell mode (running with the lid closed) officially requires AC
 *    power + an external display + external keyboard/mouse; without those,
 *    closing the lid sleeps the Mac regardless of any assertion. This lines
 *    up with the MacBook Pro-only symptom (needs login again after a while)
 *    vs. MacBook Air/Mac mini not showing it — NOT confirmed against this
 *    machine's actual usage pattern (lid open/closed, AC vs. battery), only
 *    consistent with it. Do not treat as proven without a live observation.
 * 4. `powerSaveBlocker.isStarted(id)` is the only way to tell "we believe we
 *    started it" (workPowerSaveBlockerId !== null) apart from "the OS still
 *    has it" — see isWorkPowerSaveBlockerActuallyStarted() below, now wired
 *    into settings:getPowerSave/setPowerSave and the route journal's
 *    `powerSaveBlockerActive` field.
 *
 * Stronger candidates NOT implemented here (behavior change deferred —
 * telegram is the owner's only remote channel, see skill guardrails):
 *   - NSProcessInfo beginActivityWithOptions(.userInitiated/.background):
 *     same IOKit-assertion foundation as powerSaveBlocker: still can't stop
 *     forced/lid-close sleep. Would need a small native (objc/Swift) addon
 *     since Electron doesn't expose it — real cost, no proven upside over
 *     the current blocker for THIS failure mode.
 *   - A separate `caffeinate -s` child process: same limitation (idle sleep
 *     only), adds a process to supervise/reap for no behavioral gain.
 *   - Server-side push (Telegram webhook) instead of long-polling: the only
 *     candidate that actually survives forced/lid-close sleep, since delivery
 *     would no longer depend on this process's timers being alive — but it's
 *     a real architecture change (needs a reachable HTTPS endpoint) to the
 *     owner's only remote channel. Recommend evaluating this in a follow-up
 *     ticket, not silently switching here.
 */
function refreshWorkPowerSaveBlocker(): void {
  const sources = powerSaveSources(
    powerSaveMode,
    collectWorkPowerSaveSources(),
  );
  const nextRefCount = sources.length;
  workPowerSaveRefCount = nextRefCount;

  if (nextRefCount > 0) {
    if (workPowerSaveBlockerId === null) {
      workPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      console.log(
        `[PowerSave] Started prevent-app-suspension blocker id=${workPowerSaveBlockerId} sources=${sources.join(
          ",",
        )}`,
      );
    }
    return;
  }

  stopWorkPowerSaveBlocker("idle");
}

/**
 * ★"우리 변수가 non-null" 과 "OS 가 assertion 을 실제로 들고 있다" 는 별개다
 * (ticket VCGuLWmNTlhoRvwGAKJA) — `powerSaveBlocker.isStarted(id)` 로 실측한다.
 * null 은 애초에 걸 필요가 없는 상태(작업 소스가 없음)이고, false 는 걸었다고
 * 믿었는데 OS 가 이미 풀어버린(비정상) 상태다. 둘을 UI/저널에서 구분한다.
 */
function isWorkPowerSaveBlockerActuallyStarted(): boolean | null {
  if (workPowerSaveBlockerId === null) return null;
  try {
    return powerSaveBlocker.isStarted(workPowerSaveBlockerId);
  } catch (err) {
    console.warn("[PowerSave] isStarted check failed:", err);
    return null;
  }
}

function stopWorkPowerSaveBlocker(reason: string): void {
  if (workPowerSaveBlockerId === null) return;
  const id = workPowerSaveBlockerId;
  workPowerSaveBlockerId = null;
  workPowerSaveRefCount = 0;
  try {
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id);
    }
    console.log(
      `[PowerSave] Stopped prevent-app-suspension blocker (${reason})`,
    );
  } catch (err) {
    console.warn("[PowerSave] Failed to stop blocker:", err);
  }
}

// Periodic Telegram channel-health sweep timer. Hoisted to module scope (set in
// app.whenReady) so quit handlers can clear it — otherwise, even though it's
// unref'd, it keeps polling every 4 min with no windows open after
// window-all-closed on macOS. See setInterval below.
let telegramHealthTimer: ReturnType<typeof setInterval> | null = null;

function collectWorktreeProjectRoots(): WorktreeProjectRoot[] {
  const roots: WorktreeProjectRoot[] = [];
  const addRoot = (
    projectId: string | undefined,
    repoRoot: string | undefined,
  ) => {
    if (!projectId || !repoRoot) return;
    roots.push({
      projectId,
      repoRoot: repoRoot === "~" ? os.homedir() : repoRoot,
    });
  };

  for (const [projectId, manager] of orchestrators) {
    addRoot(projectId, manager.getSession()?.rootPath);
  }
  for (const [projectId, manager] of missionOrchestrators) {
    addRoot(projectId, manager.getSession()?.rootPath);
  }

  const state: Partial<AppState> = activeAccountUid
    ? appStateForAccount(activeAccountUid)
    : {};
  addRoot(state.lastProjectId, state.lastRootPath);
  for (const connection of listProjectConnections()) {
    addRoot(connection.projectId, connection.localPath);
  }

  // Every source above answers "where is this project bound NOW". None of them
  // can answer "which clones actually own the worktrees in this project's
  // pool" — and those diverge as soon as a project is re-bound to a second
  // clone of the same repo. Ticket NHCsWfnp: 81 pool directories owned 74 / 7
  // by two clones, only the bound one was ever listed, so the tab showed 7 and
  // the other 74 were never fetched (not filtered — never fetched).
  //
  // Git's own per-worktree `gitdir:` pointer is the authoritative ownership
  // record, so we read it back rather than guessing. `uniqueProjectRoots`
  // already keys on projectId+repoRoot and `listWorktrees` maps over every
  // root, so a second owner simply adds a group the renderer merges by
  // projectId. A clone that no longer exists is skipped — enumerating it would
  // only spawn a doomed git process; `worktree:coverage` reports it instead.
  const worktreePool = worktreeManager.getWorktreesRoot();
  for (const projectId of new Set(roots.map((root) => root.projectId))) {
    for (const owner of discoverWorktreeRoots(worktreePool, projectId).roots) {
      if (owner.exists) addRoot(projectId, owner.repoRoot);
    }
  }

  return roots;
}

// ── Live routing knowledge-graph updater (spec 2026-07-22 §7) ──────────────
// Folds agent-lifecycle outcomes (stale / crash / merged) into the machine-
// local routing-graph.json so the next dispatch's model scoring reads a learned,
// decaying prior. fetchMeta recovers the dispatch's context (role/tags/complexity/
// model) from the task's dispatchMeta. Every call is best-effort + fire-and-
// forget — a graph write can never break recovery, telemetry, or a merge.
const graphUpdater = new GraphUpdater({
  onRecorded: ({ taskId, agentId, mode, atMs }) => {
    void (async () => {
      try {
        const { app, authReady } = getMissionFirebaseApp();
        await authReady;
        const db = getFirestore(app);
        // The event is intentionally taskId-scoped: it is the only bridge to
        // cost_logs/task_outcomes. It carries no user or audit-ledger identity.
        await fbSetDoc(
          fbDoc(db, "tasks", taskId),
          {
            outcomeModeEvent: {
              id: `${taskId}:${agentId ?? "-"}:${mode}`,
              mode,
              atMs,
            },
          },
          { merge: true },
        );
      } catch (err) {
        console.warn("[GraphUpdater] task outcome event write failed:", err);
      }
    })();
  },
  fetchMeta: async (taskId) => {
    try {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      const snap = await fbGetDoc(fbDoc(db, "tasks", taskId));
      const data = snap.data() as Record<string, unknown> | undefined;
      const meta = data?.dispatchMeta as
        | {
            role?: unknown;
            tags?: unknown;
            taskType?: unknown;
            complexity?: unknown;
            model?: unknown;
            spawnedModelKey?: unknown;
          }
        | undefined;
      if (!meta) return null;
      return {
        role: typeof meta.role === "string" ? meta.role : null,
        tags: Array.isArray(meta.tags)
          ? (meta.tags.filter((t) => typeof t === "string") as string[])
          : null,
        taskType: typeof meta.taskType === "string" ? meta.taskType : null,
        complexity:
          typeof meta.complexity === "string" ? meta.complexity : null,
        model: typeof meta.model === "string" ? meta.model : null,
        // ★P2-2 — model@effort 해상도의 셀 키. 구 문서엔 없으므로 null 이 정상이고,
        // 그때는 프로바이더 키로 학습한다(구키 폴백이 읽기에서 이어 준다).
        spawnedModelKey:
          typeof meta.spawnedModelKey === "string"
            ? meta.spawnedModelKey
            : null,
      };
    } catch {
      return null;
    }
  },
});

// Fold one ACCEPTED merge (the top positive KG label, spec §7) into the
// machine-local routing graph. Shared by BOTH merge sources so gh/GitHub merges
// learn identically to the app's own Merge button:
//   (1) the app Merge path (recordMergeHistory, below) calls this directly;
//   (2) gh/GitHub merges are captured server-side into merge_history (#566),
//       which the renderer (an authenticated project member — the anonymous-auth
//       main process may NOT read member-scoped merge_history, cf #406/L2 rules)
//       forwards over the `kg:recordMergeOutcome` channel.
// ctx (role/tags/complexity/model) is recovered from the task's dispatchMeta;
// changeType is a de-identified taskType fallback. Idempotent via the graph's
// `seen` guard keyed on (taskId,agentId=-,merged), so double-folding an app
// merge (direct call + its own forwarded merge_history doc) is a no-op. A merge
// with no taskId can't be attributed to a dispatch's model+ctx, so recordOutcome
// would drop it anyway — skip it here.
const foldMergeOutcome = (input: {
  taskId?: string | null;
  changeType?: string | null;
  mergedAtMs?: number | null;
  // Renderer-resolved dispatchMeta (the forwarded gh/app-merge path enriches
  // these because the anonymous main process can't read member-scoped `tasks`,
  // #406/L2). Any may be null → we degrade to changeType-derived taskType.
  role?: string | null;
  taskType?: string | null;
  complexity?: string | null;
  model?: string | null;
  /** ★P2-2 — 실스폰 관측 model@effort 키. 없으면 updater 가 dispatchMeta 를
   * 되읽어 채우고, 그것도 없으면 프로바이더 키로 학습한다. */
  spawnedModelKey?: string | null;
}): void => {
  if (!input.taskId) return;
  // Build ctx from the renderer-resolved dispatchMeta; taskType falls back to
  // the de-identified changeType so the cell still learns even when the task
  // carried no dispatchMeta. When nothing resolves, ctx stays undefined and the
  // updater's own (best-effort) fetchMeta backfill is the last resort.
  const ctx: GraphContext = {};
  if (input.role && input.role.trim()) ctx.role = input.role;
  const taskType = input.taskType?.trim() ? input.taskType : input.changeType;
  if (taskType && taskType.trim()) ctx.taskType = taskType;
  if (
    input.complexity === "simple" ||
    input.complexity === "standard" ||
    input.complexity === "complex"
  ) {
    ctx.complexity = input.complexity;
  }
  const hasCtx = Boolean(ctx.role || ctx.taskType || ctx.complexity);
  void graphUpdater.recordOutcome({
    taskId: input.taskId,
    model: input.model ?? undefined,
    modelKey: input.spawnedModelKey ?? undefined,
    rawOutcome: "merged",
    ctx: hasCtx ? ctx : undefined,
    atMs:
      typeof input.mergedAtMs === "number" && Number.isFinite(input.mergedAtMs)
        ? input.mergedAtMs
        : undefined,
  });
};

// Renderer → main bridge for source (2) above: the renderer's merge_history
// subscription (member-scoped read it IS allowed to do) forwards each new merge.
// Renderer-provided payload → validate every field before use.
ipcMain.on("kg:recordMergeOutcome", (_event, payload: unknown) => {
  if (!payload || typeof payload !== "object") return;
  const p = payload as {
    taskId?: unknown;
    changeType?: unknown;
    mergedAtMs?: unknown;
    role?: unknown;
    taskType?: unknown;
    complexity?: unknown;
    model?: unknown;
    spawnedModelKey?: unknown;
  };
  if (typeof p.taskId !== "string" || !p.taskId) return;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  foldMergeOutcome({
    taskId: p.taskId,
    changeType: str(p.changeType),
    mergedAtMs: typeof p.mergedAtMs === "number" ? p.mergedAtMs : null,
    role: str(p.role),
    taskType: str(p.taskType),
    complexity: str(p.complexity),
    model: str(p.model),
    spawnedModelKey: str(p.spawnedModelKey),
  });
});

// Append-only merge audit trail (WORKTREE-SPEC §6 / autonomy-dial audit log).
// Writes one immutable doc per completed merge to the `merge_history`
// collection, reusing the mission firebase app (anonymous auth) like the
// worktree coordinator's task writer above. Best-effort: the merge handler
// fires this without awaiting, so a Firestore failure never affects the merge.
const recordMergeHistory = async (
  record: MergeHistoryRecord,
): Promise<void> => {
  // Single capture, fed to both sinks (ticket cZBlOnkg). (1) ML sink first: a
  // synchronous IPC send to the renderer's gated telemetry choke point — routed
  // to BigQuery `events` as task:merged for routing-data collection. Emitted
  // before the awaited Firestore write so a slow authReady never delays it; the
  // renderer honors the telemetry opt-out. (2) Audit sink: the append-only
  // merge_history doc below, now enriched with the same de-identified diff
  // features so the "완료 이력" view can show change size without a re-`git show`.
  mainTelemetry.taskMerged(mainWindow, {
    taskId: record.taskId ?? null,
    projectId: record.projectId,
    mode: record.mode,
    filesChanged: record.filesChanged,
    linesAdded: record.linesAdded,
    linesDeleted: record.linesDeleted,
    changeType: record.changeType,
  });

  // ★"10분 안에 첫 multi-agent 성공"(티켓 pWSnJeQN)의 머지측 트리거. 머지는
  // 가장 강한 성공 라벨이므로, 그 순간 동시에 2대 이상이 살아 있었다면 그건
  // 정확히 이 제품이 약속한 경험이 일어난 순간이다. 동시성 판정은 메인이
  // 소유하고(AgentManager), 설치당 1회로 접는 것과 시계 계산은 렌더러가 한다.
  const mergeConcurrency = agentManager.getConcurrency();
  if (mergeConcurrency.live >= MULTI_AGENT_MIN_CONCURRENCY) {
    mainTelemetry.multiAgentSuccess(mainWindow, {
      trigger: "merge",
      concurrent: mergeConcurrency.live,
      working: mergeConcurrency.working,
      taskId: record.taskId ?? null,
      projectId: record.projectId,
    });
  }

  // KG feedback (spec §7): merge is the top accepted (positive) label. Fold it
  // into the routing graph via the shared entry point (same path gh merges take
  // through the kg:recordMergeOutcome bridge). Idempotent with the renderer-
  // forwarded copy of this same merge_history doc.
  foldMergeOutcome({ taskId: record.taskId, changeType: record.changeType });

  const { app, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(app);
  await fbAddDoc(fbCollection(db, "merge_history"), {
    projectId: record.projectId,
    taskId: record.taskId ?? null,
    repoRoot: record.repoRoot,
    branch: record.branch,
    baseRef: record.baseRef,
    headSha: record.headSha,
    mode: record.mode,
    mergedAt: fbTimestamp.fromDate(record.mergedAt),
    createdAt: fbTimestamp.now(),
    // De-identified diff features (counts + path-category only; no raw diff).
    filesChanged: record.filesChanged ?? null,
    linesAdded: record.linesAdded ?? null,
    linesDeleted: record.linesDeleted ?? null,
    changeType: record.changeType ?? null,
  });
};

registerWorktreeIpc(
  ipcMain,
  worktreeManager,
  collectWorktreeProjectRoots,
  undefined,
  recordMergeHistory,
  invalidateRemovedWorktreeRoots,
);

function createMissionOrchestratorInstance(
  projectId: string,
): OrchestratorManager {
  const orchestrator = new OrchestratorManager(
    ptyManager,
    agentManager.getConfigGenerator(),
    (status) => {
      refreshWorkPowerSaveBlocker();
      const ownerId = missionOrchestratorOwners.get(projectId);
      if (ownerId !== undefined) {
        sendToOwner(ownerId, "missionOrchestrator:statusChanged", { status });
      } else {
        broadcast("missionOrchestrator:statusChanged", { status });
      }
    },
    "mission", // kind — board orchestrator 와 sessionId / MCP config 분리
  );
  orchestrator.setRootPathMissingHandler(notifyRootPathMissing);
  // 오케 세션 원문 캡처(ticket IqcXHVbT0rXnHloXpV7n). 오케는 agent-manager 를
  // 안 타서 cost-tracker sink 로는 절대 안 들어온다 — 세션 id 초크포인트에
  // 직접 붙인다. 게이트가 닫혀 있으면 파일을 읽지도 않는다.
  orchestrator.setSessionTranscriptHandler(trackOrchestratorSession);
  // ★오케 비용 수집(ticket TaDiWyLNi5ihBnjfVmMs). transcript 훅과 별도인 이유는
  // orchestrator-manager 의 setCostSessionHandler 주석 참조 — 격리 홈 하네스는
  // claude 세션 id 초크포인트를 영원히 안 탄다.
  orchestrator.setCostSessionHandler(trackOrchestratorCostSession);
  return orchestrator;
}

// 미션 오케스트레이터의 프로젝트 루트 해석. 엔진(ensureSession) 경로는 mission
// doc 에 rootPath 가 없어 hint 없이 호출되므로, board 오케스트레이터 세션 →
// 미션 세션 → appState 순으로 실제 프로젝트 루트를 찾는다.
function resolveMissionRootPath(projectId: string, hint?: string): string {
  const norm = (p?: string): string | undefined =>
    p === "~" ? os.homedir() : p;
  const fromHint = norm(hint);
  if (fromHint) return fromHint;
  const board = orchestrators.get(projectId)?.getSession()?.rootPath;
  if (board) return board;
  const mission = missionOrchestrators.get(projectId)?.getSession()?.rootPath;
  if (mission) return mission;
  const st: Partial<AppState> = activeAccountUid
    ? appStateForAccount(activeAccountUid)
    : {};
  const fromState = norm(st.lastRootPath);
  if (fromState) return fromState;
  return process.env.MARBLO_PROJECT_ROOT ?? process.cwd();
}

// 미션 오케스트레이터를 보장 launch 하는 단일 경로. 패널 IPC
// (missionOrchestrator:start) 와 미션 엔진(orch-registry ensureSession) 양쪽이
// 이걸 통해 launch 한다. 두 책임을 한 곳에 모은 이유:
//   1) onPtyReady 콜백으로 setupPtyForwarding(sid) 를 반드시 건다 — 엔진이
//      패널보다 먼저 PTY 를 띄워도 출력이 renderer 로 흐른다. (예전엔 엔진 경로가
//      콜백을 안 넘겨 PTY 가 살아있어도 패널이 빈 화면이었다.)
//   2) 직전 mission 오케스트레이터 세션을 resume — 앱 재시작 후에도 컨텍스트
//      연속 (board 오케스트레이터와 동일). crash auto-restart 도 lastOnPtyReady
//      로 forwarding 을 유지한다.
function ensureMissionOrchestratorLaunched(
  projectId: string,
  rootPathHint?: string,
  missionId?: string,
): OrchestratorManager {
  let manager = missionOrchestrators.get(projectId);
  if (!manager) {
    manager = createMissionOrchestratorInstance(projectId);
    missionOrchestrators.set(projectId, manager);
  }
  if (manager.isRunning()) {
    // 미션 오케는 '포커스된 한 미션'에 종속된다. 요청 missionId 가 현재 운전 중인
    // 미션과 다르면(=null 포함) 그 미션의 세션으로 교체한다 — 새 미션이면 fresh,
    // 기존 미션이면 그 미션 세션 resume. owner 가 null 인 경우(패널이 missionId
    // 없이 직전 세션을 미리 resume 해 둔 상태)도 반드시 교체해야 새 미션이 옛
    // 대화를 이어받아 /compact 되는 증상이 사라진다. missionId 미상(렌더러
    // reconnect/Restart)이면 실행 중 세션을 그대로 reuse.
    const owner = manager.getOwnerMissionId();
    if (missionId && owner !== missionId) {
      manager.stop();
    } else {
      return manager;
    }
  }
  const rootPath = resolveMissionRootPath(projectId, rootPathHint);
  // 모델 결정은 board launch 와 동일한 프로젝트별 우선순위. resume 해석은
  // 모델 인지가 필수 — claude 전용 resolver(~/.claude 스캔)를 codex 에 태우면
  // claude uuid 가 `codex resume <uuid>` 로 넘어가 exit 1 즉사하거나(혼재
  // 프로젝트), 항상 null → 매 재시작 fresh(순수 codex)가 된다. (56C9L5DP 흡수)
  //
  // ★이 함수는 동기 계약이라 auth 프로브 자동선택(async)을 태우지 않는다.
  // 보드 launch 가 먼저 돌며 전역/프로젝트 설정을 채우는 게 보통이고, 미설정
  // 이면 hard default claude 로 떨어진다(보드 auto-launch 와 같은 안전 바닥).
  const missionModel = normalizeOrchestratorModelType(
    applyOrchestratorModelEnvForProjectSync(projectId),
  );
  // resume 결정:
  //  - missionId 알면: 그 미션의 세션이 있으면 resume(스텝→스텝 / 앱 재시작 이어가기),
  //    없으면 "new"(새 미션 = fresh 세션 + 초기 프롬프트).
  //  - missionId 미상(렌더러 부팅 reconnect): 직전 mission 세션 resume.
  //  - gpt/grok: 세션 id 를 저장하지 않으므로 격리 홈(CODEX_HOME/GROK_HOME)에
  //    세션이 실재하고 (미션 지정 시) 그 미션이 마지막 소유자로 마킹된 경우에만
  //    "latest"(`codex resume --last` / `grok --continue`), 아니면 "new".
  let resumeId: string;
  if (usesIsolatedHomeSentinelResume(missionModel)) {
    const isolatedHomeModel = missionModel === "grok" ? "grok" : "gpt";
    const hasSavedIsolatedSession = agentManager
      .getConfigGenerator()
      .hasSavedSession(
        `orchestrator-mission-${projectId}`,
        isolatedHomeModel,
        rootPath,
      );
    const missionOwnsLast = missionId
      ? manager.hasGptMissionMarker(rootPath, missionId)
      : true;
    resumeId = hasSavedIsolatedSession && missionOwnsLast ? "latest" : "new";
    if (resumeId === "new" && hasSavedIsolatedSession && missionId) {
      console.log(
        `[MissionOrchestrator] Saved ${isolatedHomeModel} session belongs to another mission — starting fresh for mission ${missionId}`,
      );
    }
  } else {
    resumeId = missionId
      ? (manager.resolveMissionResumeId(rootPath, missionId) ?? "new")
      : (manager.resolveOrchestratorResumeId(rootPath) ?? "new");
  }
  manager.launch(
    projectId,
    rootPath,
    bridgeServer.getPort(),
    (sid, { reused }) => {
      // 소유 윈도우를 알면 그 창으로 라우팅, 모르면 setupPtyForwarding 의
      // mainWindow 폴백 + 버퍼링으로 패널이 나중에 붙어도 backlog 수신.
      const ownerId = missionOrchestratorOwners.get(projectId);
      if (ownerId !== undefined) addPtyOwner(sid, ownerId);
      // 이 경로는 위에서 isRunning() 이면 early-return 하거나 stop() 하므로
      // 실질적으로 항상 fresh spawn 이다. 그래도 방어적으로 막는다 — 살아있는
      // PTY 에 forwarding 을 다시 걸면 출력이 두 배가 된다.
      if (reused) return;
      setupPtyForwarding(sid);
      hookOrchestratorActivity(sid, projectId);
      logTelegramRouteHealth(projectId, "mission-launch-pty-ready");
    },
    resumeId,
    missionId,
    { modelOverride: missionModel },
  );
  return manager;
}

/**
 * Feed orchestrator PTY "busy" signals to the Telegram and Slack inbound
 * clients so their un-replied nudge can detect a busy→idle turn boundary.
 * node-pty onData is add-only, so this extra listener coexists with
 * setupPtyForwarding's. Cheap: one regex test per chunk, and
 * markOrchestratorActivity is a no-op in each client unless an inbound is
 * awaiting a reply for this project.
 */
function hookOrchestratorActivity(sid: string, projectId: string): void {
  if (!projectId) return;
  ptyManager.onData(sid, (data) => {
    if (!isBusySignal(data)) return;
    telegramPoller.markOrchestratorActivity(projectId);
    slackPoller.markOrchestratorActivity(projectId);
    // ★자율 픽업의 "바쁠 때 깨우지 않기" 도 **같은 관측**을 쓴다 — 오케의 턴이
    //   끝났다는 판정이 두 벌이면 어느 쪽이 진짜인지 아무도 모른다
    //   (티켓 6hWxqjbzGQs1hzTUTihx). 보드·미션 오케 어느 쪽이 바쁘든 그
    //   프로젝트는 바쁜 것으로 본다 — 보수적인 쪽이 옳다(덜 깨운다).
    boardResync.markOrchestratorActivity(projectId);
  });
}

// NOTE: maybeHandoverTelegram (텔레그램 단일 소유자 인계) 는 제거됐다. 폴러가
// 오케스트레이터에 종속되지 않고 electron main(telegramPoller)이 프로젝트당 1개를
// 소유하므로, 오케가 멈춰도 넘겨줄 소유권이 없다. 채널 활성/비활성에 따른 폴러
// 시작/정지는 telegramPoller.syncActiveChannels() 가 담당한다
// (ticket vw38IB2VcmOIOlFV51Wa).

// 미션이 사용자 개입을 요구할 때 (waiting_for_human + notifyUser) OS 알림 +
// 인앱 IPC 로 surface. gstack 스킬은 상호작용(AskUserQuestion 등) 이 많아 PTY
// 패널을 안 보고 있으면 미션이 멈춘 줄 모른다 → 능동 알림이 필요.
function notifyMissionNeedsInput(n: {
  missionId: string;
  projectId: string;
  goal: string;
  kind: "pty_input_required" | "escalate";
  question?: string;
  skill?: string | null;
}): void {
  const title =
    n.kind === "escalate"
      ? "미션 단계 실패 — 확인이 필요합니다"
      : "미션이 당신의 답을 기다립니다";
  const detail = n.question ?? (n.skill ? `${n.skill} 단계` : "");
  const body = [n.goal, detail].filter(Boolean).join("\n");
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({ title, body });
      notif.on("click", () => {
        // 클릭 시 소유 창(없으면 mainWindow) 포커스 + Missions 탭으로 이동.
        const ownerId = missionOrchestratorOwners.get(n.projectId);
        let win: BrowserWindow | null = null;
        if (ownerId !== undefined) {
          for (const w of allWindows) {
            if (!w.isDestroyed() && w.webContents.id === ownerId) {
              win = w;
              break;
            }
          }
        }
        win = win ?? mainWindow;
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.focus();
        }
        sendToOwner(ownerId, "mission:focusRequest", {
          missionId: n.missionId,
        });
      });
      notif.show();
    }
  } catch (err) {
    console.warn("[Mission] OS notification failed:", err);
  }
  // 인앱 surface — 소유 창(없으면 broadcast)에 이벤트. 렌더러가 토스트 / 탭
  // attention dot 으로 표시.
  const ownerId = missionOrchestratorOwners.get(n.projectId);
  if (ownerId !== undefined) {
    sendToOwner(ownerId, "mission:needsInput", n);
  } else {
    broadcast("mission:needsInput", n);
  }
}

// 미션은 MVP 제외(보드+오케스트레이터 집중) — 단일 플래그로 UI 탭(TabBar
// DEV_ONLY_TABS)과 함께 엔진 기동을 게이트한다. 플래그 off 면 buildMissionEngine 을
// 아예 안 불러 missionBundle=null → startup 의 forwarder.start()/pickupPlanningMissions()
// 가 if(missionBundle) 가드로 스킵 → 잔존 테스트 미션이 자동 실행돼 quota 를 태우지
// 않는다. (.env 가 main 에도 dotenv 로드되므로 VITE_DEV_FEATURES 를 그대로 읽는다.)
const missionsEnabled = (process.env.VITE_DEV_FEATURES || "")
  .split(",")
  .map((s) => s.trim())
  .includes("missions");
if (!missionsEnabled) {
  console.log(
    "[Mission] disabled for MVP — set VITE_DEV_FEATURES=missions to enable the tab + engine",
  );
}
if (missionsEnabled)
  missionBundle = buildMissionEngine({
    agentManager,
    taskDecomposer: getDecomposer,
    orchestrators: missionOrchestrators,
    createOrchestratorInstance: createMissionOrchestratorInstance,
    ensureOrchestratorLaunched: (projectId, missionId) =>
      ensureMissionOrchestratorLaunched(projectId, undefined, missionId),
    memberProjectIds: listMemberProjectIds,
    notifier: notifyMissionNeedsInput,
    ptyManager,
    bridgePort: () => bridgeServer.getPort(),
    // bridgeServer.dispatchTask is async now (it awaits worktree prep before
    // spawning). The mission-engine dispatchOne port is synchronous and only
    // uses the result for best-effort logging — the mission owns its own task
    // lifecycle via Firestore polling and already knows each taskId it passes
    // in. So kick the worktree-isolated dispatch off in the background and
    // return an optimistic synchronous ack; real failures surface via the
    // .catch below and the mission's own status polling.
    dispatchOne: (params) => {
      void bridgeServer.dispatchTask(params).catch((err) => {
        console.error("[Main] mission dispatch (async) failed:", err);
      });
      return { success: true };
    },
  });

// --- Flow Engine Setup ---
import {
  initializeApp as initFirebaseApp,
  getApps as getFirebaseApps,
} from "firebase/app";
import {
  getFirestore,
  collection as fbCollection,
  doc as fbDoc,
  getDoc as fbGetDoc,
  setDoc as fbSetDoc,
  updateDoc as fbUpdateDoc,
  addDoc as fbAddDoc,
  query as fbQuery,
  where as fbWhere,
  getDocs as fbGetDocs,
  getCountFromServer as fbGetCountFromServer,
  runTransaction as fbRunTransaction,
  orderBy as fbOrderBy,
  limit as fbLimit,
  Timestamp as fbTimestamp,
  serverTimestamp as fbServerTimestamp,
} from "firebase/firestore";
import {
  CHECKPOINT_INTERVAL_MS,
  formatCycleNotice,
  runCheckpointCycle,
} from "./ledger-checkpointer";
import type {
  ChainEntry as LedgerChainEntry,
  LedgerCheckpoint,
} from "./mcp-server/ledger-chain";
import {
  evaluateGhostReclaim,
  evaluateAccumulationAlert,
  parseWorktreeTaskPath,
  deriveRepoRootFromGitFile,
  isWorktreeSweepEligibleTaskStatus,
} from "./agent-lifecycle-reclaim";
import { applyProjection } from "./mcp-server/projection";
import { readWorkChain, loadWorkChain } from "./mcp-server/work-chain";

function getFlowDb() {
  const config = {
    apiKey:
      process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "",
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      "",
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      "",
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      "",
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID ||
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      "",
    appId:
      process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "",
  };
  const existingApps = getFirebaseApps();
  const fbApp =
    existingApps.find((a) => a.name === "flow-engine") ||
    initFirebaseApp(config, "flow-engine");
  return getFirestore(fbApp);
}

const flowDb = getFlowDb();

// --- Cost Tracking ---

// ── 오케 비용 수집 (ticket TaDiWyLNi5ihBnjfVmMs) ────────────────────────
//
// 오케는 agent-manager 를 안 타므로 `agentManager.getAgent(costAgentId)` 가
// 영원히 undefined 다 — 아래 cost 콜백의 projectId 해석이 그 조회 하나에 기대고
// 있어서, 배선만 하고 이 맵을 안 두면 오케 행이 전부 projectId="" 로 적재된다
// (수집은 됐는데 테넌트 축이 비는, 절반짜리 수리).
const orchestratorCostProjects = new Map<string, string>();

const costTracker = new CostTracker((agentId, cost) => {
  const agent = agentManager.getAgent(agentId);
  // 오케는 agent-manager 에 없다 — 그 경우 오케 등록 시 기억해 둔 projectId 로
  // 떨어진다(ticket TaDiWyLNi5ihBnjfVmMs). 둘 다 없으면 종전대로 빈 문자열.
  const projectId =
    agent?.launchConfig?.env?.MARBLO_PROJECT ||
    orchestratorCostProjects.get(agentId) ||
    "";
  // ★과금 세션이 기록한 실제 모델 id 를 AgentManager 로 되먹인다. argv 에 모델을
  // 핀하지 않은 launch(오케 기본 경로·Agents 탭 ▶Start·콜드부트 reconnect)에서는
  // 이것이 그 에이전트의 유일한 모델 관측이고, 이후 dispatchMeta(→라우팅 KG)가
  // `resolveConcreteModel` 로 이 값을 집어 "모델미상" 셀을 면한다. 하네스족
  // 문자열은 setDetectedModel 안에서 걸러진다.
  agentManager.setDetectedModel(agentId, cost.model);
  if (!projectId) {
    console.warn(
      `[CostTracker:CB] No projectId for agent ${agentId} — recording with empty projectId`,
    );
  }

  // Send delta (incremental) values to renderer for BigQuery + Firestore.
  // Scope to the owning project's window(s) — `useCostWriter` calls
  // Firestore `increment()`, so broadcasting would N-count the cost across
  // every open window.
  const costPayload = {
    projectId,
    agentId,
    // ML/analytics join key: stamp the agent's CURRENT task so cost_logs rows
    // can join BigQuery `events` (incl. dispatch:decision) on taskId. The agent
    // doc's currentTaskId is set by syncAgentStatus on EVERY dispatch path
    // (spawn / reuse / restart), so this populates taskId regardless of how the
    // agent got the work — previously the payload carried no taskId at all, so
    // cost_logs.taskId was always null and the join was broken. null when the
    // agent isn't bound to a board task (one-off / orchestrator session).
    taskId: agent?.currentTaskId ?? null,
    model: cost.model,
    inputTokens: cost.deltaInputTokens,
    outputTokens: cost.deltaOutputTokens,
    cacheReadTokens: cost.deltaCacheReadTokens || 0,
    cacheWriteTokens: cost.deltaCacheWriteTokens || 0,
    totalCost: cost.deltaCost,
    // Latest rate-limit / plan snapshot (codex). Not deltas — the writer
    // SETs these on the agent doc.
    detectedPlanType: cost.detectedPlanType,
    rateLimitPercent: cost.rateLimitPercent,
    rateLimitResetAt: cost.rateLimitResetAt,
    rateLimitWeeklyPercent: cost.rateLimitWeeklyPercent,
    rateLimitWeeklyResetAt: cost.rateLimitWeeklyResetAt,
  };
  if (projectId) {
    sendToProject(projectId, "cost:update", costPayload);
  } else {
    // Unknown project (shouldn't happen in normal flow) — fall back to
    // mainWindow only, never broadcast.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cost:update", costPayload);
    }
  }
  console.log(
    `[CostTracker] Sent cost:update (delta) — agent=${agentId} project=${
      projectId || "(none)"
    } in=${cost.deltaInputTokens} out=${
      cost.deltaOutputTokens
    } cost=$${cost.deltaCost.toFixed(4)}`,
  );

  // Also send token:usage telemetry event with projectId
  mainTelemetry.tokenUsage(
    mainWindow,
    agentId,
    cost.model,
    cost.deltaInputTokens,
    cost.deltaOutputTokens,
    cost.deltaCost,
    projectId,
  );
});

/**
 * 오케 세션 수명주기 → 비용 트래커 등록/해제.
 *
 * 판단은 전부 `planOrchestratorCostTracking`(session-kind.ts, 순수함수)이 한다 —
 * 여기는 그 결정을 실행만 한다. 회귀 테스트가 붙을 수 있는 표면을 electron 이
 * 없는 쪽에 두기 위해서다(ticket TaDiWyLNi5ihBnjfVmMs).
 */
function trackOrchestratorCostSession(input: OrchestratorCostSession): void {
  const plan = planOrchestratorCostTracking(input, isCliHomeTracked);

  if (plan.action === "stop") {
    costTracker.stopSession(plan.costAgentId);
    orchestratorCostProjects.delete(plan.costAgentId);
    return;
  }

  if (plan.action === "skip") {
    // ★조용히 넘어가지 않는다. 이 사고의 재발 형태가 정확히 "아무도 못 보는
    // 사이 빠지는 것" 이었다. session-id-pending 은 정상 대기이므로 log,
    // 나머지는 화면/표가 0 으로 오해할 수 있는 상태이므로 warn.
    const line = `[CostTracker:Orch] ${plan.costAgentId} not tracked — ${plan.reason}`;
    if (plan.reason === "session-id-pending") console.log(line);
    else console.warn(line);
    return;
  }

  if (input.projectId) {
    orchestratorCostProjects.set(plan.costAgentId, input.projectId);
  }
  costTracker.trackSession(
    plan.costAgentId,
    plan.rootPath,
    plan.sessionId,
    plan.model,
  );
  console.log(
    `[CostTracker:Orch] tracking ${plan.costAgentId} (${plan.model}) session=${
      plan.sessionId ?? "(cli-home)"
    }`,
  );
}

// Surface models we cannot price. Those tokens are billed at $0 (never at a
// borrowed rate), so without this event the under-reporting would be silent —
// exactly the ghost-cost failure the zero-rate rule replaced.
onUnmatchedPricing(({ model, count, firstSeen }) => {
  mainTelemetry.pricingUnmatched(mainWindow, model, count, firstSeen);
});

// ── 학습데이터 캡처 (ticket IqcXHVbT0rXnHloXpV7n) ────────────────────────
//
// 같은 세션 파일, 두 개의 완전히 다른 싱크:
//   - 위의 cost 콜백 → cost_logs / events. 비식별, 상시. 텍스트 없음.
//   - 아래 sink → marblo_training.training_samples. 원문, admin 전용, 동의 게이트.
//
// 트래커가 방금 읽은 **새 라인**만 넘기므로 파일 IO 는 0 이고, 게이트가 닫혀
// 있으면(=서버가 eligible+consent 를 확정해 주지 않으면) 아무것도 스풀되지
// 않는다. 원문은 렌더러/telemetry 큐/Sentry 어느 경로에도 들어가지 않는다.
costTracker.setSessionLinesSink(
  ({ agentId, format, newLines, model, filePath }) => {
    const agent = agentManager.getAgent(agentId);
    ingestSessionLines(
      format,
      newLines,
      {
        agentId,
        source: "agent",
        projectId: agent?.launchConfig?.env?.MARBLO_PROJECT || null,
        taskId: agent?.currentTaskId ?? null,
        role: agent?.role ?? null,
        model,
        // AgentInstance 는 부모 에이전트를 보관하지 않는다(스폰 파라미터에만
        // 있음). 지어내지 않고 비운다 — 필요하면 events 의 spawn 행으로 조인한다.
        parentAgentId: null,
        sessionId: null,
        cwd: agent?.cwd ?? null,
      },
      filePath,
    );
  },
);

// ★온보딩 스톨 계측 (티켓 9dXgBdkGn1LyJokShh1g). 사전 스폰 게이트가 거절한 순간 =
// 사용자가 첫 작업을 **실행 전에** 막힌 순간. 관측을 게이트 안(단일 판정 지점)에
// 두고 여기서 창을 붙인다 — 호출부마다 emit 을 흩뿌리면 새 호출부가 생길 때
// 조용히 빠지고, 그게 지금 이 이벤트가 BigQuery 에 0건인 이유이기도 하다.
setSpawnGateObserver((e) => {
  if (e.surface === "orchestrator_auto_select") {
    mainTelemetry.orchestratorCandidateProbe(mainWindow, {
      model: e.model,
      outcome: "blocked",
      reason: e.reason,
      installed: e.installed,
      ...(e.vendor ? { vendor: e.vendor } : {}),
      ...(e.missingEnvKeyCount !== undefined
        ? { missingEnvKeyCount: e.missingEnvKeyCount }
        : {}),
    });
    return;
  }
  mainTelemetry.spawnBlocked(mainWindow, e);
});

// ★10분 시계의 앵커 (티켓 Tw6m14gR). 같은 게이트의 **통과** 쪽 — "이 설치가
// 실제로 에이전트를 돌릴 수 있게 된" 순간이고, 사장님 결정으로 핵심 KPI 의
// 시계가 여기서 시작한다. 차단 관측과 같은 이유로 게이트 안에 두고 창만 붙인다.
setSpawnGatePassedObserver((e) => {
  if (e.surface === "orchestrator_auto_select") {
    mainTelemetry.orchestratorCandidateProbe(mainWindow, {
      model: e.model,
      outcome: "ready",
      ...(e.vendor ? { vendor: e.vendor } : {}),
      ...(e.noAuthAxis ? { noAuthAxis: true } : {}),
    });
    return;
  }
  mainTelemetry.modelConnected(mainWindow, e);
});

// Load stored API keys and create LLM provider
const storedKeys = readApiKeys();
syncApiKeysToEnv(storedKeys);
let llmProvider = createLLMProvider({
  anthropicApiKey: storedKeys.anthropic,
  openaiApiKey: storedKeys.openai,
  googleApiKey: storedKeys.google,
});
const flowRunner = new FlowRunner(flowDb, llmProvider);
const kanbanBridge = new KanbanBridge(flowDb, flowRunner);
kanbanBridge.attach();

// Restore model preset from app state. 정규화를 여기서도 태우는 이유: 폐기된 id
// (`recommended`)가 저장돼 있던 기기에서도 라우팅이 현행 프리셋(`auto`)을 읽어야
// 한다 — 정규화가 없으면 `resolvePreset` 이 알 수 없는 값으로 보고 기본값으로
// 폴백하긴 하지만, env 에는 옛 문자열이 남아 로그와 설정 화면이 어긋난다.
const savedPreset = readAppState().modelPreset;
if (savedPreset) {
  process.env.MARBLO_MODEL_PRESET = normalizePresetId(savedPreset);
}

const INITIAL_ORCHESTRATOR_MODEL_ENV =
  process.env.MARBLO_ORCHESTRATOR_MODEL?.trim() || "";

// 오케 모델 설정값(`provider[:modelId][@effort]`)의 정규화는
// `model-selection.normalizeOrchestratorModelSetting` 이 한다 — 저장값·env·IPC 세
// 입구가 전부 그 함수를 지나고, 유닛테스트도 **그 함수**를 검증한다(규칙을 main
// 안에 두면 테스트가 복사본을 검증하게 된다 — `orchestratorLaunchPin` 과 같은 이유).
// 그 함수가 이 티켓에서 늘린 축이 둘이다: 오케 후보에 grok(네이티브 CLI, 자체 auth)
// 편입, 그리고 env-swap 벤더 핀("claude:glm-4.7")의 명시적 강등.
// 여기서는 이름만 로컬로 유지해 기존 호출부를 그대로 둔다(선언 호이스팅도 유지).
function normalizeOrchestratorModelSetting(value: unknown): string {
  return normalizeOrchestratorModelSettingImpl(value);
}

function normalizeOrchestratorModelType(value: unknown): ModelType {
  return orchestratorModelTypeForSetting(value);
}

/**
 * 이 설정값이 요구하는 CLI 모델 핀 전부 — claude `--model`, codex `-c model=` +
 * `-c model_reasoning_effort=`. 비어 있는 축은 종전대로 CLI 기본값을 상속한다
 * (프로바이더만 고른 "claude"/"codex" 는 전 축이 비어 종전 동작과 바이트 동일).
 *
 * ★claude 축은 버전가드를 탄다 — 셀렉터에서 고른 모델이 설치된 CLI 의 검증 범위
 * 밖이면 `resolveClaudeModelPinned` 이 opus 로 떨어뜨리고 구조화 로그를 남긴다.
 * 오케가 안 뜨는 것보다 한 단계 낮은 모델로 뜨는 편이 낫다(§8.3 불변식).
 *
 * 해석 자체는 `model-selection.orchestratorLaunchPin` 이 한다(라이브 경로와 유닛
 * 테스트가 같은 함수를 쓰게 하려고 그쪽에 뒀다). 여기서는 설정값 정규화만 얹는다.
 */
function orchestratorModelPins(value: unknown): {
  claudeModel?: string;
  codexModel?: string;
  codexEffort?: string;
  nativeModel?: string;
} {
  return orchestratorLaunchPin(normalizeOrchestratorModelSetting(value));
}

/**
 * 오케 스폰 **2번째 관문** — 인증(checkSpawnAuthGate) 다음으로, 이 오케가 실제로
 * 일을 할 수 있는지 본다.
 *
 * grok 오케는 marblo MCP 가 없으면 dispatch·보드 조작이 전부 불가능한 껍데기이고,
 * 그 실패가 **조용하다**(CLI 는 멀쩡히 뜨고 설정 파일에도 서버가 들어있다).
 * 그래서 스폰 전에 grok 에게 직접 물어 툴이 실제로 붙는지 확인하고, 안 붙으면
 * 무력 오케를 띄우는 대신 막는다.
 *
 * grok 이 아닌 모델은 즉시 통과 — 기존 경로는 바이트 동일하다.
 */
async function checkOrchestratorMcpGate(
  model: string,
  projectDir: string,
): Promise<{ ok: boolean; action?: string }> {
  if (model !== "grok") return { ok: true };
  const probe = await probeGrokMarbloMcp(projectDir);
  if (probe.ok) {
    console.info(
      `[orchestratorSession] grok MCP gate passed — ${probe.detail}`,
    );
    return { ok: true };
  }
  console.error(
    `[orchestratorSession] Blocked — grok orchestrator has no Marblo MCP tools (${probe.reason}): ${probe.detail}`,
  );
  return {
    ok: false,
    action: `grok 오케 차단 — ${probe.detail}. 프로젝트 폴더 신뢰/설정을 확인하세요.`,
  };
}

/**
 * 오케 스폰 **3번째 관문** — 인증·MCP 다음으로, 이 오케가 **이번 달 실제로 돌 수
 * 있는 크레덴셜을 갖고 있는지** 본다. (2026-08-21, 티켓 7HthjBEf)
 *
 * ── 왜 세 번째 관문이 필요했나 ──────────────────────────────────────────
 * 오케 모델 선택은 프로젝트별 **영구 저장**이다. 그래서 종전 규율은 "env-swap 벤더는
 * 아예 셀렉터에 세우지 않는다" 였다 — 키가 빠진 순간부터 매 재시작이 말없이 하네스
 * 기본 백엔드로 새기 때문이다(`model-selection.orchestratorSelectorEligible` 주석).
 *
 * DeepSeek 은 그 필터의 첫 예외인데, 예외를 **지탱하는 것이 이 함수**다. DeepSeek 은
 * 구독제가 아니라 선불 충전이라 만료일이 없고 잔액이 말없이 0 이 된다(2026-08-21
 * 아침 실측). 즉 "저장된 값이 나중에 못 쓰게 되는" 구간이 GLM 보다 더 잘 온다.
 * 그때 **조용히 Codex 기본 백엔드로 새지 않고 사유를 띄우고 멈추는 것**이 이 관문의
 * 유일한 일이다.
 *
 * ── 호출 빈도 ───────────────────────────────────────────────────────────
 * ★스폰마다 벤더 API 를 때리지 않는다. `getVendorBalance` 가 TTL 10분 캐시 +
 * in-flight 접기를 이미 쥐고 있어 대부분의 스폰은 요청 0 이다. 임계 **근처에서만**
 * 한 번 더 확인한다(캐시가 low 로 답하면 force 로 재조회 — 그것도
 * `MIN_REFRESH_INTERVAL_MS`(15초) 하한이 걸려 연타가 API 연타가 되지 않는다).
 * 잔액은 0 에 가까울수록 빨리 변하므로, 자주 볼 값어치가 있는 구간이 거기뿐이다.
 *
 * ── 기존 경로 무변경 ────────────────────────────────────────────────────
 * ★네이티브 하네스(claude/codex/grok/antigravity)와 접미 없는 칸은
 * `orchestratorVendorGateTarget` 이 즉시 null 을 돌려 **요청도 판정도 없이** 통과한다
 * — 기존 오케 스폰은 바이트 동일하다.
 *
 * ── ★이 관문이 **덮지 않는** 자리(알고 남긴다) ─────────────────────────
 * 오케를 띄우는 입구는 넷인데 이 관문은 셋에 걸려 있다: launch IPC · switch ·
 * assistant-trigger 기동. 넷째는 `OrchestratorManager` 의 **크래시 자동재시작**
 * 이고, 그 경로는 `lastLaunchOptions` 를 그대로 재사용해 main 을 거치지 않는다.
 *
 * 안 건 이유: (a) 티켓이 지목한 위험 구간은 "잔액 0 이 된 뒤 **앱 재시작**" 이고
 * 그 경로는 launch IPC 라 여기서 잡힌다. (b) 세션 도중 0 이 되어 CLI 가 죽는
 * 경우에도 크래시 예산(`ORCH_MAX_RESTARTS`)이 재시작을 3회로 끊고 status=error
 * 로 멈춘다 — 무한 루프가 아니다. (c) 이 관문을 거기 걸려면 매니저가 main 의
 * 비동기 게이트를 콜백으로 되받아야 해서 의존 방향이 뒤집힌다.
 * 재시작 루프가 실제로 관측되면 그때 콜백 축을 판다.
 */
async function checkOrchestratorVendorGate(setting: string): Promise<{
  ok: boolean;
  action?: string;
  status?: OrchestratorVendorGateStatus;
  /** 임계 이하(비차단)일 때 오케 부트 프롬프트에 실을 충전 안내. */
  bootNotice?: string;
}> {
  const target = orchestratorVendorGateTarget(setting);
  if (!target) return { ok: true };

  let balance = await getVendorBalance(target.vendor);
  let verdict = decideOrchestratorVendorGate({
    vendor: target.vendor,
    vendorLabel: target.vendorLabel,
    balance,
    requiredEnvKeys: target.requiredEnvKeys,
  });
  // ★임계 근처에서만 한 번 더. 캐시가 "얼마 안 남았다" 로 답했다면 그 값은 이미
  // 낡았을 수 있고, 여기서 틀리면 사용자는 세션 중간에 말없이 끊긴다.
  if (verdict.status === "low" && balance.cached) {
    balance = await getVendorBalance(target.vendor, { force: true });
    verdict = decideOrchestratorVendorGate({
      vendor: target.vendor,
      vendorLabel: target.vendorLabel,
      balance,
      requiredEnvKeys: target.requiredEnvKeys,
    });
  }

  if (!verdict.allowed) {
    // ★키 값도 응답 원문도 남기지 않는다 — 상태·모델·키 이름뿐이다.
    console.error(
      `[orchestratorSession] Blocked by vendor gate — ${target.vendor}/${target.modelId} status=${verdict.status}`,
      {
        vendor: target.vendor,
        model: target.modelId,
        status: verdict.status,
        ...(verdict.httpStatus ? { httpStatus: verdict.httpStatus } : {}),
        ...(verdict.missingEnvKeys
          ? { missingEnvKeys: verdict.missingEnvKeys }
          : {}),
      },
    );
    return { ok: false, action: verdict.action, status: verdict.status };
  }

  if (verdict.status === "low") {
    console.warn(
      `[orchestratorSession] ${target.vendor} 잔액 임계 이하 — 스폰은 허용하고 충전 안내를 띄운다`,
      { vendor: target.vendor, model: target.modelId },
    );
    const notice = orchestratorVendorBootNotice(verdict);
    return {
      ok: true,
      status: verdict.status,
      action: verdict.action,
      ...(notice ? { bootNotice: notice } : {}),
    };
  }
  return { ok: true, status: verdict.status };
}

/**
 * 인증 게이트가 막았을 때 **렌더러가 어느 화면을 열어야 하나**의 표식.
 *
 * `checkSpawnAuthGate` 는 env-swap 벤더의 키 부재도 같은 봉투로 돌려준다
 * (`reason: "vendor-not-configured"`). 그것을 표식 없이 흘리면 렌더러는 "auth" 로
 * 읽어 **CLI 로그인 위저드**를 여는데, DeepSeek 오케를 고른 사용자는 Codex 로그인이
 * 멀쩡하므로 위저드가 "연결됨" 만 보여주고 끝난다 — 실패 사유 넷 중 "키 없음" 이
 * 화면에서 사라지는 자리가 정확히 여기다.
 *
 * 오케 후보 중 env-swap 벤더는 오늘 DeepSeek 뿐이므로(런타임 게이트 집합) 이
 * 재라벨은 다른 하네스의 종전 동작을 한 글자도 바꾸지 않는다.
 */
function orchestratorAuthBlockReason(
  gateReason?: string,
): { reason: string } | Record<string, never> {
  return gateReason === "vendor-not-configured"
    ? { reason: ORCHESTRATOR_BLOCK_REASON_VENDOR }
    : {};
}

/** 프로젝트별 저장 모델 (없으면 null). 반환값은 정규화된 설정 문자열. */
function readProjectOrchestratorModel(projectId?: string): string | null {
  if (!projectId) return null;
  const stored = readAppState().orchestratorModelByProject?.[projectId];
  return stored ? normalizeOrchestratorModelSetting(stored) : null;
}

/**
 * 프로젝트별 저장 모델 출처. 값 없이 모델만 있으면 legacy → `null`
 * (해석 측은 null 을 auto 로 취급해 재평가).
 */
function readProjectOrchestratorModelSource(
  projectId?: string,
): OrchestratorModelSelectionSource | null {
  if (!projectId) return null;
  const raw = readAppState().orchestratorModelSourceByProject?.[projectId];
  if (raw === "user" || raw === "auto") return raw;
  return null;
}

/**
 * 프로젝트별 오케 모델 기록 — launch/switch 성공 경로에서 호출.
 * `source` 는 명시 선택(`user`) vs 우선순위 자동(`auto`) 구분. 생략 시 `user`
 * (설정 IPC·스위치 등 호출부가 사용자 의도인 경우의 안전 기본값).
 */
function saveProjectOrchestratorModel(
  projectId: string,
  model: string,
  source: OrchestratorModelSelectionSource = "user",
): void {
  if (!projectId) return;
  const normalized = normalizeOrchestratorModelSetting(model);
  const state = readAppState();
  const map = { ...(state.orchestratorModelByProject ?? {}) };
  const sourceMap = { ...(state.orchestratorModelSourceByProject ?? {}) };
  if (map[projectId] === normalized && sourceMap[projectId] === source) return;
  map[projectId] = normalized;
  sourceMap[projectId] = source;
  writeAppState({
    orchestratorModelByProject: map,
    orchestratorModelSourceByProject: sourceMap,
  });
  console.log(
    `[Main] Orchestrator model for project ${projectId} recorded: ${normalized} (source=${source})`,
  );
}

/**
 * 전역 `orchestratorModel` 이 **사용자가(또는 온보딩이) 써 둔 값**인가.
 *
 * 빈 문자열/미설정은 "미설정" 이다. `normalizeOrchestratorModelSetting` 은 빈 값을
 * `"claude"` 로 바꿔 버리므로, 자동선택 게이트에는 정규화 전 raw 를 봐야 한다 —
 * 미설정인데 `"claude"` 를 globalSetting 으로 넘기면 autoFallback 이 영원히
 * 막힌다(mwYD1YxEc9aARgmZ4bX7).
 */
function readGlobalOrchestratorModelSetting(): string | null {
  const raw = readAppState().orchestratorModel;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeOrchestratorModelSetting(raw);
}

/**
 * 연결·인증된 네이티브 하네스(Claude/Codex/Grok)를 프로브해 제품 기본 우선순위로
 * 하나를 고른다. env-swap 벤더는 오케 후보가 아니라 프로브 대상도 아니다.
 *
 * 감지=메인(App.tsx 텔레메트리 분업 주석과 같은 규율): 계정 프로브는 main 만
 * 알고, 렌더러는 결과 설정값만 본다.
 */
async function probePreferredOrchestratorHarness(): Promise<string | null> {
  const ready: string[] = [];
  for (const harness of ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY) {
    // checkSpawnAuthGate 는 ModelType 축(`gpt`)도 받지만 codex 표기도 통과한다.
    const gate = await checkSpawnAuthGate(
      harness,
      undefined,
      "orchestrator_auto_select",
    );
    if (gate.ok && gate.authenticated) {
      ready.push(harness);
    }
  }
  return pickPreferredOrchestratorHarness(ready);
}

/**
 * resolve + source 태그 (env 미변경). launch 저장·셀렉터 get 이 공유한다.
 *
 * 우선순위: 부팅 env > 이번 launch 명시 > 프로젝트별 **사용자** 저장 >
 * 프로젝트별 **자동** 저장(재평가) > 전역 설정 > 네이티브 자동
 * (Claude > Codex > Grok) > hard default claude.
 */
async function resolveOrchestratorModelDecision(
  projectId?: string,
  explicitModel?: string,
): Promise<{ setting: string; source: OrchestratorModelSelectionSource }> {
  const hasExplicit =
    typeof explicitModel === "string" && explicitModel.trim().length > 0;
  const perProject = readProjectOrchestratorModel(projectId);
  const perProjectSource = readProjectOrchestratorModelSource(projectId);
  const globalSetting = readGlobalOrchestratorModelSetting();
  const explicit = hasExplicit
    ? normalizeOrchestratorModelSetting(explicitModel)
    : null;
  const needsAuto = needsOrchestratorAutoProbe({
    envOverride: INITIAL_ORCHESTRATOR_MODEL_ENV || null,
    explicit,
    perProject,
    perProjectSource,
    globalSetting,
  });
  const autoFallback = needsAuto
    ? await probePreferredOrchestratorHarness()
    : null;
  if (autoFallback) {
    const prev = perProject ?? "(unset)";
    console.info(
      `[Main] Orchestrator model auto-selected/re-evaluated: ${autoFallback} (was ${prev}; priority Claude>Codex>Grok among authenticated natives)`,
    );
  }
  const input = {
    envOverride: INITIAL_ORCHESTRATOR_MODEL_ENV || null,
    explicit,
    perProject,
    perProjectSource,
    globalSetting,
    autoFallback: autoFallback
      ? normalizeOrchestratorModelSetting(autoFallback)
      : null,
  };
  return {
    setting: resolveEffectiveOrchestratorModelSetting(input),
    source: classifyOrchestratorSelectionSource(input),
  };
}

/**
 * resolve 결과를 MARBLO_ORCHESTRATOR_MODEL env 에 반영한다.
 * ★env 에는 **프로바이더만** 넣는다 — compound 를 넣으면 agent-config 의
 * resolveOrchestratorModel 이 미지값 → claude 로 폴백하며 핀이 사라진다.
 */
function applyOrchestratorModelEnv(setting: string): void {
  process.env.MARBLO_ORCHESTRATOR_MODEL =
    splitOrchestratorModelValue(setting).harness;
}

/**
 * 동기 해석 + env 반영. auth 프로브(async) 없이 저장값·전역·hard default 만 본다.
 * mission 오케 ensure 경로처럼 동기 계약인 호출부용 — 보드 launch 가 먼저
 * 돌아 auto 를 채워 두는 게 보통이고, 미설정이면 claude 로 떨어진다.
 */
function applyOrchestratorModelEnvForProjectSync(
  projectId?: string,
  explicitModel?: string,
): string {
  const hasExplicit =
    typeof explicitModel === "string" && explicitModel.trim().length > 0;
  const input = {
    envOverride: INITIAL_ORCHESTRATOR_MODEL_ENV || null,
    explicit: hasExplicit
      ? normalizeOrchestratorModelSetting(explicitModel)
      : null,
    perProject: readProjectOrchestratorModel(projectId),
    perProjectSource: readProjectOrchestratorModelSource(projectId),
    globalSetting: readGlobalOrchestratorModelSetting(),
    autoFallback: null as string | null,
  };
  const setting = resolveEffectiveOrchestratorModelSetting(input);
  applyOrchestratorModelEnv(setting);
  return setting;
}

/**
 * launch/resolve 입구: 모델을 정하고 env 에 반영. 반환은 설정 문자열.
 * source 가 필요하면 `resolveOrchestratorModelDecision` 을 직접 쓴다.
 */
async function resolveAndApplyOrchestratorModelForProject(
  projectId?: string,
  explicitModel?: string,
): Promise<string> {
  const decision = await resolveOrchestratorModelDecision(
    projectId,
    explicitModel,
  );
  applyOrchestratorModelEnv(decision.setting);
  return decision.setting;
}

/** Recreate LLM provider with current stored keys and update FlowRunner */
function refreshLLMProvider(): void {
  const keys = readApiKeys();
  syncApiKeysToEnv(keys);
  // Stored 키가 바뀌었을 수 있으므로 lazy 캐시된 TaskDecomposer 도 무효화 →
  // 다음 dispatch 때 새 키로 재구성.
  taskDecomposer = null;
  llmProvider = createLLMProvider({
    anthropicApiKey: keys.anthropic,
    openaiApiKey: keys.openai,
    googleApiKey: keys.google,
  });
  (flowRunner as unknown as { llmProvider: typeof llmProvider }).llmProvider =
    llmProvider;
}

// Cache flows by flowId so the agent delegation handler can resolve node configs
const flowNodeCache = new Map<string, Flow>();

// Resolve the owning projectId for a FlowEvent so events from window B's
// flow run don't appear in window A's Flows tab.
//   - flow:* events carry runId → look up state via flowRunner, then flow.
//   - node:* events carry nodeId only → scan flowNodeCache for the parent
//     flow that owns that node.
function projectIdForFlowEvent(event: FlowEvent): string | undefined {
  if ("runId" in event) {
    const state = flowRunner.getState(event.runId);
    if (!state) return undefined;
    const flow = flowNodeCache.get(state.flowId);
    return flow?.projectId;
  }
  for (const [, flow] of flowNodeCache) {
    if (flow.nodes.some((n) => n.id === event.nodeId)) return flow.projectId;
  }
  return undefined;
}

// Forward flow events to renderer, scoped to the owning project's window(s).
flowRunner.on("event", (event: FlowEvent) => {
  const projectId = projectIdForFlowEvent(event);
  if (projectId) sendToProject(projectId, "flow:event", event);
  else broadcast("flow:event", event);
});

// Handle agent node delegation: spawn new agent or route task to existing PTY
flowRunner.on("event", (event: FlowEvent) => {
  if (event.type !== "node:complete") return;

  const result = event.result;
  const output = result.output as Record<string, unknown> | null;
  if (!output?.delegated) return;

  handleAgentDelegation(event.nodeId, output);
});

/**
 * Default CLI command for each model type.
 */
function getDefaultCommand(model: string): string {
  switch (model) {
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
    case "gpt":
      return "codex";
    default:
      return "claude";
  }
}

/**
 * Handle agent node delegation after the executor returns.
 * - 'auto' mode: spawn a new agent PTY with the resolved task as initial prompt.
 * - 'existing' mode: write the task to an already-running agent's PTY.
 *
 * In both cases, the KanbanBridge handles flow resumption when the
 * Firestore task is marked DONE externally.
 */
function handleAgentDelegation(
  nodeId: string,
  output: Record<string, unknown>,
): void {
  const connectionMode = output.connectionMode as string;
  const resolvedTask = (output.task as string) || "";

  if (connectionMode === "auto" && output.spawnConfig) {
    // --- Spawn a new agent ---
    const spawnConfig = output.spawnConfig as {
      name: string;
      model: string;
      role: string;
    };

    // Look up cwd + projectId from the flow node config.
    let cwd = process.cwd();
    let owningProjectId: string | undefined;
    for (const [, flow] of flowNodeCache) {
      const node = flow.nodes.find((n) => n.id === nodeId);
      if (node) {
        cwd = (node.data.config?.cwd as string) || cwd;
        owningProjectId = flow.projectId;
        break;
      }
    }

    const agentId = crypto.randomUUID();
    const model = spawnConfig.model as "claude" | "gemini" | "gpt" | "custom";
    // onPtyReady 가 실어 주는 구체 모델. 이 콜백은 launch() 반환 전에 불리므로
    // 아래 payload 를 만들 때는 이미 채워져 있다.
    let spawnedModel: string | undefined;

    try {
      const instance = agentManager.launch({
        id: agentId,
        name: spawnConfig.name,
        model,
        role: spawnConfig.role,
        command: getDefaultCommand(model),
        cwd,
        initialPrompt: resolvedTask,
        onPtyReady: (sid, launchedModel) => {
          // Tag the PTY's owner so output is routed to the project's window
          // only — same pattern as the bridge agentSpawnedHook above.
          spawnedModel = launchedModel;
          if (owningProjectId) {
            const ownerId = getOwnerForProject(owningProjectId);
            if (ownerId !== undefined) addPtyOwner(sid, ownerId);
          }
          setupPtyForwarding(sid);
        },
      });

      // Notify the project's window(s) to attach the new terminal tab.
      // Without this scoping, every window's Layout listener would attach a
      // PTY that doesn't belong to it.
      const spawnedPayload = {
        agentId,
        name: spawnConfig.name,
        ptySessionId: instance.ptySessionId,
        model,
        spawnedModel,
        role: spawnConfig.role,
        flowNodeId: nodeId,
      };
      if (owningProjectId) {
        sendToProject(owningProjectId, "agent:spawned", spawnedPayload);
      } else {
        broadcast("agent:spawned", spawnedPayload);
      }

      console.log(
        `[Flow:AgentDelegation] Spawned agent "${spawnConfig.name}" (${agentId}) for node ${nodeId}`,
      );
    } catch (err) {
      console.error(
        `[Flow:AgentDelegation] Failed to spawn agent for node ${nodeId}:`,
        err,
      );
    }
  } else if (connectionMode === "existing" && output.existingAgentId) {
    // --- Route task to existing agent PTY ---
    const existingAgentId = output.existingAgentId as string;
    const agent = agentManager.getAgent(existingAgentId);

    if (agent && agent.status !== "stopped") {
      const taskMessage = `\n--- Flow Task ---\n${resolvedTask}\n--- End Task ---\n`;
      // writeAndSubmit splits text and \r so Claude Code registers Enter
      // as a discrete keystroke (single-chunk gets paste-buffered).
      ptyManager.writeAndSubmit(agent.ptySessionId, taskMessage);
      console.log(
        `[Flow:AgentDelegation] Sent task to existing agent "${agent.name}" (${existingAgentId}) for node ${nodeId}`,
      );
    } else {
      console.warn(
        `[Flow:AgentDelegation] Agent ${existingAgentId} not found or stopped. Cannot route task for node ${nodeId}.`,
      );
    }
  }
}

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
  // Don't exit - try to keep app alive for beta
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

// Detached pop-out windows render a single tab (Board/Code) full-screen,
// without the orchestrator PTY, agent panels or tab bar. The renderer detects
// this via the `?detached=<view>` query (see App.tsx); main only has to append
// the query and pick a sensible title/size. `detachedView` is undefined for the
// normal full app window (0 behavior change for the regular path).
type DetachedView = "board" | "code" | "history";

// ---------------------------------------------------------------------------
// External link handling (open http(s) links in the OS default browser)
// ---------------------------------------------------------------------------
// Bug: clicking a link inside the app (e.g. a GitHub PR URL) navigated the
// Electron window itself. For private GitHub repos that meant the in-app
// (unauthenticated) view rendered a 404. Fix: send all *external* http(s)
// targets to the user's default browser via shell.openExternal, and never
// externalize the app's own content or the Firebase auth popup flow.
//
// `webContents` are guarded with a WeakSet so the handler is registered exactly
// once per webContents even though we wire it from multiple places
// (createWindow, createDetachedWindow, and the global web-contents-created hook).
const externalLinkHandledWebContents = new WeakSet<Electron.WebContents>();

// WHO can host a clicked link — the object-graph half of the routing decision
// (ticket Gebe84T64LVUh1iO1hQR). The URL half lives in in-app-browser-policy's
// `classifyInAppBrowserNavigation`; the answer to "is there a Web tab surface
// for this click" used to be `browserPaneOpenTargets.has(owner.id)`, i.e. it
// only ever said yes for the exact webContents that called
// `browserPane.registerOpenTarget` — the workspace shell. Every click that
// surfaced on any OTHER webContents in the same app was declared homeless and
// shipped to the OS browser with a `no-tab-target` notice, with the Web tab
// sitting right there. See `resolveAppLinkSurface` for the two paths that do
// exactly that.

/**
 * The WebContentsView that renders an in-app Web tab's page. It gets the
 * global external-link handling like every other webContents, but it must not
 * USE it: the pane runs its own complete policy in
 * `wireBrowserPaneWebContents`, and the two both listening to `will-navigate`
 * meant the app-level one (registered first, by the `web-contents-created`
 * hook) preventDefault()ed and externalized every link clicked inside the
 * app's own browser.
 */
const browserPaneViewWebContentsIds = new Set<number>();

/**
 * child webContents id → the webContents that opened it via `window.open`.
 * Populated from `did-create-window`, dropped when the child goes away.
 */
const externalLinkOpeners = new Map<number, number>();

function appLinkSurfaceGraph(): AppLinkSurfaceGraph {
  return {
    isWebTabHost: (id) => browserPaneOpenTargets.has(id),
    isInAppBrowserPane: (id) => browserPaneViewWebContentsIds.has(id),
    openerOf: (id) => externalLinkOpeners.get(id) ?? null,
  };
}

function currentAppOrigin(): string | null {
  if (isDev) return new URL(devServerUrl()).origin;
  const address = staticServer?.address();
  return typeof address === "object" && address
    ? `http://127.0.0.1:${address.port}`
    : null;
}

// Returns true when `rawUrl` is the app's OWN content (or part of the in-app
// Firebase auth popup flow) and therefore must be allowed to load inside the
// app rather than being kicked out to the system browser.
//
// IMPORTANT — do not externalize these or you break boot / login:
//   - file://                         → preload + packaged assets
//   - http(s)://localhost|127.0.0.1   → dev server (5173) and the prod static
//                                        server (random 127.0.0.1 port). This is
//                                        the app's own loaded origin and the
//                                        Firebase redirect return URL.
//   - non-http(s) schemes (about:blank, blob:, data:, devtools:, chrome:) →
//                                        keep default behavior, never externalize.
//   - Firebase auth domains + OAuth provider endpoints → signInWithRedirect
//                                        navigates the app window through the
//                                        Firebase handler and provider, then back
//                                        to 127.0.0.1. It MUST stay in-app.
//                                        Note github.com is allowed ONLY for the
//                                        /login/oauth path — ordinary github.com
//                                        links (PR URLs) still open externally,
//                                        which is exactly the bug we are fixing.
function isInternalNavigationUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    // Unparseable / empty (e.g. "about:blank") — leave to default behavior.
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;

  const host = u.hostname;
  // Only the exact origin currently loaded by the app is internal. A second
  // loopback port is a user's local demo and must reach routeAppExternalLink
  // so it can become a Browser tab; treating every localhost URL as internal
  // created the blank-window regression this ticket fixes.
  const appOrigin = currentAppOrigin();
  if (appOrigin !== null && u.origin === appOrigin) return true;

  // Firebase auth popup flow (signInWithPopup, Google + GitHub providers).
  const firebaseAuthDomain = (
    process.env.FIREBASE_AUTH_DOMAIN ||
    process.env.VITE_FIREBASE_AUTH_DOMAIN ||
    ""
  ).toLowerCase();
  if (firebaseAuthDomain && host === firebaseAuthDomain) return true;
  if (host.endsWith(".firebaseapp.com") || host.endsWith(".web.app"))
    return true;
  if (host === "accounts.google.com") return true;
  // GitHub OAuth only — NOT general github.com links.
  if (host === "github.com" && u.pathname.startsWith("/login/oauth"))
    return true;

  return false;
}

// Wire a webContents so that external http(s) links open in the OS browser.
// Idempotent per webContents (WeakSet guard) so it is safe to call from every
// window-creation path plus the global web-contents-created hook.
function applyExternalLinkHandling(webContents: Electron.WebContents): void {
  if (externalLinkHandledWebContents.has(webContents)) return;
  externalLinkHandledWebContents.add(webContents);

  // window.open / target="_blank" / window.open(...): external http(s) goes to
  // the OS browser; everything internal (auth redirects, about:blank, etc.)
  // keeps the default behavior.
  //
  // No browser-pane guard here on purpose: `wireBrowserPaneWebContents`
  // installs the pane's own window-open handler AFTER this one, and
  // setWindowOpenHandler REPLACES rather than adds, so for a pane this
  // callback is already dead code. Denying here "just in case" would turn the
  // pane's popup handling into a silent branch, which the spec forbids.
  webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalNavigationUrl(url)) {
      routeAppExternalLink(webContents, url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Remember who opened whom. A link handler that opens a window first and
  // navigates it second (xterm's WebLinksAddon default did exactly that)
  // surfaces the real navigation on the CHILD's webContents; without this the
  // child looks like an app window that never registered a Web tab surface,
  // and the click leaves for the OS browser (ticket Gebe84T64LVUh1iO1hQR).
  webContents.on("did-create-window", (childWindow) => {
    const childId = childWindow.webContents.id;
    externalLinkOpeners.set(childId, webContents.id);
    childWindow.webContents.once("destroyed", () => {
      externalLinkOpeners.delete(childId);
    });
  });

  // In-place top-level navigation: if the page tries to navigate the window to
  // an external http(s) URL, cancel it and hand off to the OS browser instead.
  // App-origin / auth navigations pass through untouched (see
  // isInternalNavigationUrl) so app boot and OAuth redirects are never hijacked.
  webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigationUrl(url)) return;
    const surface = resolveAppLinkSurface(
      webContents.id,
      appLinkSurfaceGraph(),
    );
    // A link clicked INSIDE a Web tab belongs to the in-app browser, which has
    // its own complete policy (wireBrowserPaneWebContents) and navigates the
    // pane in place, exactly like a browser tab. This listener runs FIRST (the
    // global web-contents-created hook wires it at construction, before
    // wireBrowserPaneWebContents), so without this stand-down every such click
    // was preventDefault()ed and pushed out to the OS browser.
    if (surface.kind === "in-app-browser-pane") return;
    event.preventDefault();
    routeAppExternalLink(webContents, url, surface);
  });
}

type BrowserPaneBounds = BrowserPaneViewBounds;

interface BrowserPaneState {
  paneId: string;
  url: string;
  title: string;
  isLoading: boolean;
  notice?: {
    code:
      | "google-auth-external"
      | "auth-external"
      | "payment-external"
      | "external-protocol"
      | "unsupported-protocol"
      | "invalid-url"
      | "open-failed"
      | "tab-open-failed"
      | "no-tab-target"
      | "load-failed"
      | "blocked-url";
    message: string;
  };
  security: {
    nodeIntegration: false;
    contextIsolation: true;
    partition: string;
  };
}

interface BrowserPaneRecord {
  ownerWebContentsId: number;
  /** The pane page's own webContents id — see browserPaneViewWebContentsIds. */
  viewWebContentsId: number;
  owner: Electron.WebContents;
  win: BrowserWindow;
  paneId: string;
  view: WebContentsView;
  partition: string;
  currentUrl: string;
  title: string;
  isLoading: boolean;
  notice?: BrowserPaneState["notice"];
  /** Initial-open latency marks (ticket r70lKKYAN8syX9sLpcFj) — see
   * browser-pane-trace.ts. Logged once via maybeLogBrowserPaneTrace and then
   * left alone; a pane's reload/re-navigate doesn't get a second trace. */
  trace: BrowserPaneTraceMarks;
  traceLogged: boolean;
}

/**
 * Logs the initial-load latency trace the first time both the finish-load and
 * first-visible signals have landed (whichever order they race in). No-ops on
 * every call before/after that — cheap enough to call from every place a mark
 * gets set instead of threading completion checks through each call site.
 */
function maybeLogBrowserPaneTrace(record: BrowserPaneRecord): void {
  if (record.traceLogged) return;
  if (!isBrowserPaneTraceComplete(record.trace)) return;
  record.traceLogged = true;
  console.log(formatBrowserPaneTrace(record.paneId, record.trace));
}

const browserPaneRecords = new Map<string, BrowserPaneRecord>();
const browserPaneOwnerCleanup = new Set<number>();
// Separate from `browserPaneOwnerCleanup`: that Set is cleared by
// `cleanupBrowserPanesForOwner` itself (so a later pane on the same owner can
// re-register the one-shot "destroyed" cleanup). The reload hook below must
// NOT be re-added every time a pane is created after a reload, or repeated
// reloads would stack up duplicate `did-navigate` listeners on the same
// still-alive owner. This tracks "has this owner's reload hook ever been
// wired", independent of how many times its panes have been cleaned up.
const browserPaneOwnerReloadHooked = new Set<number>();
const browserPaneOpenTargets = new Set<number>();

// Best-effort OS notification so a blocked/failed link click is never silent
// (ticket bHuirRxD643VVvhdaWGM). Mirrors the existing Notification pattern
// used for the lifecycle-reclaim accumulation alert above.
function presentExternalLinkNotice(notice: { message: string } | null): void {
  if (!notice) return;
  try {
    if (Notification.isSupported()) {
      new Notification({ title: "Marblo", body: notice.message }).show();
    }
  } catch {
    /* notification is best-effort */
  }
}

// Sends browserPane:openUrl with an ack/timeout instead of a bare
// owner.send — see BrowserPaneOpenUrlDelivery in in-app-browser-policy.ts
// for why (ticket GiChqmgXxSQxdUwo3NLq: a fire-and-forget send let clicks
// vanish with no fallback and no notice when the renderer's listener wasn't
// there to catch it).
const browserPaneOpenUrlDelivery = new BrowserPaneOpenUrlDelivery({
  setTimeout,
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  generateRequestId: () => crypto.randomUUID(),
  onDeliveryFailed: (sender, url) => {
    console.warn(
      "[Main] browserPane:openUrl not acknowledged by renderer — falling back to OS browser:",
      url,
    );
    handleBrowserPaneOpenDeliveryFailure(sender, url);
  },
});

function handleBrowserPaneOpenDeliveryFailure(
  owner: BrowserPaneOpenUrlSender,
  url: string,
): void {
  // "tab-open-failed", not "open-failed": we're about to attempt the OS
  // browser open below, and it will usually succeed — the notice must say
  // the app tab failed, not claim the browser open itself already failed.
  presentExternalLinkNotice(
    browserPaneNoticeForExternalReason("tab-open-failed"),
  );
  if (owner.isDestroyed()) return;
  shell.openExternal(url).catch((err: unknown) => {
    console.error(
      "[Main] shell.openExternal fallback (after undelivered open-in-tab) failed:",
      url,
      err,
    );
    presentExternalLinkNotice(
      browserPaneNoticeForExternalReason("open-failed"),
    );
  });
}

// Thin adapter over routeExternalLinkClick: the decision and the ordering
// (explain, then act) live in in-app-browser-policy.ts so unit tests exercise
// the same path this does. Everything Electron-shaped stays here.
function routeAppExternalLink(
  owner: Electron.WebContents,
  rawUrl: string,
  // "Is there a Web tab surface for this click?" is a question about the
  // window/opener chain, not about the one webContents that happened to fire
  // the handler — see resolveAppLinkSurface (ticket Gebe84T64LVUh1iO1hQR).
  // Passed in by will-navigate, which has to ask the same question one step
  // earlier to know whether it may preventDefault at all.
  surface: AppLinkSurface = resolveAppLinkSurface(
    owner.id,
    appLinkSurfaceGraph(),
  ),
): void {
  const host =
    surface.kind === "web-tab-host"
      ? (allWebContents.fromId(surface.hostId) ?? null)
      : null;
  const hasOpenTarget = host !== null && !host.isDestroyed();

  const { routing, url } = routeExternalLinkClick(rawUrl, hasOpenTarget, {
    // `host`, not `owner`: the click may have surfaced on a window the
    // shell opened, and only the shell has a renderer listening for
    // browserPane:openUrl. `hasOpenTarget` already proved host is live.
    openInTab: (target) => {
      if (host) browserPaneOpenUrlDelivery.send(host, target);
    },
    openExternal: (target) => {
      // A rejected open used to vanish with `void` — no log, no notice.
      shell.openExternal(target).catch((err: unknown) => {
        console.error("[Main] shell.openExternal failed:", target, err);
        presentExternalLinkNotice(
          browserPaneNoticeForExternalReason("open-failed"),
        );
      });
    },
    notify: presentExternalLinkNotice,
  });

  if (routing.kind === "blocked") {
    console.warn(
      "[Main] Blocked external link navigation:",
      url,
      routing.notice.code,
    );
  }
}

function browserPaneKey(ownerWebContentsId: number, paneId: string): string {
  return `${ownerWebContentsId}:${paneId}`;
}

function browserPaneSecurity(
  partition = IN_APP_BROWSER_SESSION_PARTITION,
): BrowserPaneState["security"] {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    partition,
  };
}

function toBrowserPaneState(record: BrowserPaneRecord): BrowserPaneState {
  return {
    paneId: record.paneId,
    url: record.currentUrl,
    title: record.title,
    isLoading: record.isLoading,
    notice: record.notice,
    security: browserPaneSecurity(record.partition),
  };
}

function sendBrowserPaneState(record: BrowserPaneRecord): void {
  if (record.owner.isDestroyed()) return;
  record.owner.send("browserPane:state", toBrowserPaneState(record));
}

function cleanupBrowserPaneRecord(record: BrowserPaneRecord): void {
  browserPaneRecords.delete(
    browserPaneKey(record.ownerWebContentsId, record.paneId),
  );
  browserPaneViewWebContentsIds.delete(record.viewWebContentsId);
  externalLinkOpeners.delete(record.viewWebContentsId);
  try {
    record.win.contentView.removeChildView(record.view);
  } catch {
    // The owning window may already be tearing down.
  }
  try {
    if (!record.view.webContents.isDestroyed()) {
      record.view.webContents.close();
    }
  } catch {
    // Ignore teardown races.
  }
}

function cleanupBrowserPanesForOwner(ownerWebContentsId: number): void {
  for (const record of browserPaneRecords.values()) {
    if (record.ownerWebContentsId === ownerWebContentsId) {
      cleanupBrowserPaneRecord(record);
    }
  }
  browserPaneOwnerCleanup.delete(ownerWebContentsId);
  browserPaneOpenTargets.delete(ownerWebContentsId);
  browserPaneOpenUrlDelivery.cancelForSender(ownerWebContentsId);
}

function registerBrowserPaneOwnerCleanup(owner: Electron.WebContents): void {
  const ownerId = owner.id;
  if (!browserPaneOwnerCleanup.has(ownerId)) {
    browserPaneOwnerCleanup.add(ownerId);
    owner.once("destroyed", () => cleanupBrowserPanesForOwner(ownerId));
  }
  if (browserPaneOwnerReloadHooked.has(ownerId)) return;
  browserPaneOwnerReloadHooked.add(ownerId);
  // A renderer reload (Cmd+R, DevTools reload, a crash-recovery reload) does
  // NOT destroy this webContents — only "destroyed" above would fire — so
  // without this, every WebContentsView a pane owned survives the reload as
  // an orphan: still a child of `win.contentView`, still visible at its last
  // bounds, with no React tree left to ever call `browserPane:setBounds` or
  // `:release` on it again (the old page's JS realm is torn down before its
  // effect cleanups can run). "did-navigate" only fires for the main frame,
  // so an in-page/SPA route change never triggers this.
  owner.on("did-navigate", () => cleanupBrowserPanesForOwner(ownerId));
  owner.once("destroyed", () => browserPaneOwnerReloadHooked.delete(ownerId));
}

function parseBrowserPaneId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function parseBrowserPaneUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeBrowserPaneUrl(value);
  const decision = classifyInAppBrowserNavigation(normalized);
  return decision.action === "deny" ? null : normalized;
}

function parseBrowserPaneBounds(
  value: unknown,
): BrowserPaneContainerRect | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Record<keyof BrowserPaneContainerRect, unknown>>;
  const x = numberOrNull(raw.x);
  const y = numberOrNull(raw.y);
  const width = numberOrNull(raw.width);
  const height = numberOrNull(raw.height);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

function parseBrowserPaneWindowOrigin(
  value: unknown,
): BrowserPaneWindowOrigin | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Record<keyof BrowserPaneWindowOrigin, unknown>>;
  const x = numberOrNull(raw.x);
  const y = numberOrNull(raw.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findBrowserPaneRecord(
  ownerWebContentsId: number,
  paneId: unknown,
): BrowserPaneRecord | null {
  const id = parseBrowserPaneId(paneId);
  if (!id) return null;
  return browserPaneRecords.get(browserPaneKey(ownerWebContentsId, id)) ?? null;
}

function setBrowserPaneNotice(
  record: BrowserPaneRecord,
  reason: InAppBrowserExternalReason,
): void {
  const notice = browserPaneNoticeForExternalReason(reason);
  if (notice) {
    record.notice = notice;
    sendBrowserPaneState(record);
  }
}

function handleBrowserPaneExternalNavigation(
  record: BrowserPaneRecord,
  url: string,
  reason: InAppBrowserExternalReason,
): void {
  setBrowserPaneNotice(record, reason);
  shell.openExternal(url).catch((err: unknown) => {
    console.error("[Main] shell.openExternal failed (browser pane):", url, err);
    record.notice = {
      code: "load-failed",
      message: "Marblo couldn't open this link in your system browser.",
    };
    sendBrowserPaneState(record);
  });
}

function loadBrowserPaneBlank(record: BrowserPaneRecord): void {
  record.currentUrl = "about:blank";
  record.isLoading = false;
  record.notice = undefined;
  void record.view.webContents.loadURL("about:blank").catch(() => {
    sendBrowserPaneState(record);
  });
}

function wireBrowserPaneWebContents(record: BrowserPaneRecord): void {
  const child = record.view.webContents;

  // `loadURL()`'s initial URL is checked by agentNavigateWebTab, but a server
  // redirect does not necessarily emit `will-navigate`. Re-evaluate EVERY
  // redirect target here so a public search result cannot silently land the
  // isolated pane on an auth/payment, HTTP, or private-network destination.
  // This branch only applies to the non-persistent agent partition; ordinary
  // human Web tabs retain their established in-app routing behavior.
  child.on("will-redirect", (event, url) => {
    if (record.partition !== AGENT_NAVIGATION_PARTITION) return;
    const decision = classifyAgentNavigationRequest({
      globalStopActive: globalBrowserAgentSwitch.isSuspended(),
      rateLimitOk: true,
      url,
    });
    if (decision.allowed) return;
    event.preventDefault();
    record.notice = {
      code: "blocked-url",
      message: agentNavigationDenialMessage(decision.reason),
    };
    sendBrowserPaneState(record);
  });

  child.setWindowOpenHandler(({ url }) => {
    // Electron's `allow` creates a separate BrowserWindow; it does not mean
    // "load this URL in the current WebContents". Route the request through
    // the app's Web-tab model and cancel native-window creation, preserving
    // the current pane and its session/history.
    routeAppExternalLink(record.owner, url, {
      kind: "web-tab-host",
      hostId: record.owner.id,
    });
    return { action: "deny" };
  });

  child.on("will-navigate", (event, url) => {
    const decision = classifyInAppBrowserNavigation(url);
    if (decision.action === "allow") {
      record.notice = undefined;
      return;
    }
    event.preventDefault();
    if (decision.action === "external") {
      handleBrowserPaneExternalNavigation(record, url, decision.reason);
      return;
    }
    record.notice = {
      code: "blocked-url",
      message: "Marblo blocked this URL scheme inside the browser tab.",
    };
    sendBrowserPaneState(record);
  });

  child.on("did-start-loading", () => {
    record.trace.didStartLoadingAt ??= Date.now();
    record.isLoading = true;
    record.notice = undefined;
    sendBrowserPaneState(record);
  });

  child.on("did-stop-loading", () => {
    record.isLoading = false;
    record.currentUrl = child.getURL() || record.currentUrl;
    record.title = child.getTitle() || record.title;
    sendBrowserPaneState(record);
  });

  // dom-ready / did-finish-load exist purely for the latency trace below —
  // nothing here fed BrowserPaneState before, so state semantics (and every
  // existing consumer of it) are unchanged.
  child.on("dom-ready", () => {
    record.trace.domReadyAt ??= Date.now();
  });

  child.on("did-finish-load", () => {
    record.trace.didFinishLoadAt ??= Date.now();
    maybeLogBrowserPaneTrace(record);
  });

  child.on("did-navigate", (_event, url) => {
    record.currentUrl = url || record.currentUrl;
    record.title = child.getTitle() || record.title;
    sendBrowserPaneState(record);
  });

  child.on("did-navigate-in-page", (_event, url) => {
    record.currentUrl = url || record.currentUrl;
    record.title = child.getTitle() || record.title;
    sendBrowserPaneState(record);
  });

  child.on("page-title-updated", (_event, title) => {
    record.title = title;
    sendBrowserPaneState(record);
  });

  child.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      record.isLoading = false;
      record.currentUrl = validatedURL || record.currentUrl;
      record.notice = {
        code: "load-failed",
        message: errorDescription || "Failed to load URL.",
      };
      sendBrowserPaneState(record);
    },
  );
}

function createBrowserPaneRecord(
  owner: Electron.WebContents,
  paneId: string,
  url: string,
  attachRequestedAt?: number,
  partition = IN_APP_BROWSER_SESSION_PARTITION,
): BrowserPaneRecord | null {
  const win = BrowserWindow.fromWebContents(owner);
  if (!win || win.isDestroyed()) return null;

  const trace: BrowserPaneTraceMarks = { attachRequestedAt };

  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition,
    },
  });
  trace.viewConstructedAt = Date.now();
  view.setVisible(false);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  // Before anything can navigate in it: the global web-contents-created hook
  // has already wired app-level external-link handling onto this webContents,
  // and this is what tells that handling to stand down for a pane page
  // (ticket Gebe84T64LVUh1iO1hQR).
  browserPaneViewWebContentsIds.add(view.webContents.id);

  const record: BrowserPaneRecord = {
    ownerWebContentsId: owner.id,
    viewWebContentsId: view.webContents.id,
    owner,
    win,
    paneId,
    view,
    partition,
    currentUrl: url,
    title: "",
    isLoading: false,
    trace,
    traceLogged: false,
  };

  wireBrowserPaneWebContents(record);
  win.contentView.addChildView(view);
  browserPaneRecords.set(browserPaneKey(owner.id, paneId), record);
  registerBrowserPaneOwnerCleanup(owner);
  if (url !== "about:blank") {
    record.trace.loadUrlCalledAt = Date.now();
    void view.webContents.loadURL(url).catch((err: unknown) => {
      record.notice = {
        code: "load-failed",
        message: err instanceof Error ? err.message : "Failed to load URL.",
      };
      sendBrowserPaneState(record);
    });
  }
  return record;
}

function setBrowserPaneVisible(
  record: BrowserPaneRecord,
  visible: boolean,
  bounds?: BrowserPaneBounds,
): void {
  if (
    !visible ||
    !bounds ||
    bounds.width < 8 ||
    bounds.height < 8 ||
    record.win.isMinimized()
  ) {
    record.view.setVisible(false);
    record.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }

  record.view.setBounds(bounds);
  record.view.setVisible(true);
  record.trace.firstVisibleAt ??= Date.now();
  maybeLogBrowserPaneTrace(record);
}

function createWindow(isNewWindow = false, detachedView?: DetachedView) {
  const detachedQuery = detachedView ? `?detached=${detachedView}` : "";
  const win = new BrowserWindow({
    width: detachedView ? 1100 : 1200,
    height: detachedView ? 820 : 800,
    minWidth: 800,
    minHeight: 600,
    title: detachedView
      ? `Marblo — ${
          detachedView === "board"
            ? "Board"
            : detachedView === "code"
              ? "Code"
              : "History"
        }`
      : "Marblo",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--marblo-new-window=${isNewWindow ? "1" : "0"}`],
    },
    titleBarStyle: "hiddenInset",
    show: false,
  });

  // Route external http(s) links to the OS browser (covers createDetachedWindow
  // too, since it delegates to createWindow).
  applyExternalLinkHandling(win.webContents);

  if (isDev) {
    // dev 도 프로덕션과 같은 규칙을 따른다: 모든 창이 ONE stable origin 에서
    // 로드된다. 그 origin 값은 electron/dev-server-origin.ts 한 곳에만 있고
    // vite.config.ts / scripts/dev-electron.mjs 도 같은 상수를 읽는다 — 세 곳에
    // 흩어진 포트 표기가 갈라져 origin 이 나뉘는 사고를 원천 차단한다
    // (티켓 L1LQjuQhRiW2hIoBkOAs).
    win.loadURL(devServerUrl(detachedQuery));
    // DevTools disabled by default for performance — open manually with Cmd+Option+I
  } else {
    // Serve from the SHARED static server so every window loads from one stable
    // http://127.0.0.1:<port> origin (Firebase Auth requires an authorized
    // http origin rather than file://, and origin-scoped auth persistence must
    // be identical across windows — see startStaticServer). The server outlives
    // individual windows and is closed on app quit, not on window close.
    startStaticServer().then((port) => {
      if (win.isDestroyed()) return;
      // port === 0 means the shared static server failed to bind (see
      // startStaticServer's resolve(0) path). Loading http://127.0.0.1:0 would
      // just render a silent blank window, so surface the failure instead.
      if (!port) {
        dialog.showErrorBox(
          "Marblo — 시작 실패",
          "내부 웹 서버를 시작하지 못했습니다. 이미 실행 중인 다른 Marblo 인스턴스가 " +
            "포트를 점유하고 있거나 로컬 방화벽/보안 소프트웨어가 127.0.0.1 바인딩을 " +
            "차단하고 있을 수 있습니다.\n\n앱을 완전히 종료한 뒤 다시 실행해 주세요.",
        );
        return;
      }
      win.loadURL(`http://127.0.0.1:${port}${detachedQuery}`);
    });
  }

  // Only the FIRST window becomes mainWindow. Don't overwrite on subsequent
  // createWindow() calls — that flipped which window received PTY events
  // and was the proximate cause of "open new window → previous window goes
  // silent" in multi-window mode.
  if (!mainWindow) {
    mainWindow = win;
  }
  allWindows.add(win);

  // Capture the webContents id NOW, while the window is alive. The "closed"
  // event fires AFTER the native window and its webContents are destroyed, so
  // reading win.webContents in that handler throws "Object has been destroyed"
  // (FATAL at main.js:2228 → this line). An isDestroyed() guard is the wrong
  // fix here: inside "closed" it is always true, which would silently turn the
  // whole cleanup block below into dead code and leak every per-window map.
  const senderId = win.webContents.id;

  win.on("closed", () => {
    allWindows.delete(win);
    // Best-effort cleanup of per-window state. Keyed by the id captured above —
    // never re-read it off the destroyed window.
    const closedSenderId = senderId;
    // Drop this window from every PTY's owner set. A PTY still owned by
    // ANOTHER window keeps its entry and keeps streaming there — only the
    // ones that just lost their LAST owner are untracked (which merely
    // reverts them to the permissive mainWindow fallback; the process lives).
    for (const sid of ptyOwners.removeWindow(closedSenderId)) {
      ptyOwners.delete(sid);
    }
    for (const pid of orchestratorOwners.removeWindow(closedSenderId)) {
      // Last window showing this orchestrator is gone. We deliberately do NOT
      // stop() it: the orchestrator is long-lived main-process state driving
      // real work (spawned agents, telegram relay, pending instructions), and
      // closing a window — or a renderer teardown that merely looks like one —
      // must not destroy the user's live session. It stays running and
      // reattaches when a window reopens the project (launch() is idempotent).
      //
      // The cost is a genuinely orphaned orchestrator surviving until quit
      // (killAll on app exit still reaps it). That is the deliberate trade:
      // an over-eager reclaim is unrecoverable, an orphan is merely idle. If
      // this ever needs reclaiming, do it on a grace timer that re-checks for
      // owners — never synchronously here.
      orchestratorOwners.delete(pid);
      console.warn(
        `[Orchestrator] Window ${closedSenderId} closed and was the last owner of project ${pid}'s orchestrator. Leaving it RUNNING for reattach (no auto-kill).`,
      );
    }
    // Mission orchestrators are owned per-window too (missionOrchestratorOwners
    // is populated on mission:start). Without this the map keeps accumulating
    // dead webContents ids, and owner lookups for those projects silently fall
    // back to mainWindow forever.
    for (const [pid, ownerId] of missionOrchestratorOwners) {
      if (ownerId === closedSenderId) missionOrchestratorOwners.delete(pid);
    }
    // Close this window's fs watcher (created in fs:watch handler).
    fsManager.stopWatching(`win-${closedSenderId}`);
    // Drop the window→project registration.
    windowProjects.delete(closedSenderId);
    // Drop the per-window restore record (no point reconnecting a closed window).
    windowRestore.delete(closedSenderId);
    // A user-closed window leaves the restore set; but during quit we keep it
    // so the next launch reopens everything that was open.
    if (!isQuitting) persistWindowSession();
    if (mainWindow === win) {
      // Promote another window as primary, or null
      mainWindow =
        allWindows.size > 0 ? (allWindows.values().next().value ?? null) : null;
      if (mainWindow) bridgeServer.setMainWindow(mainWindow);
    }
  });

  win.once("ready-to-show", () => {
    if (!detachedView) {
      win.maximize();
    }
    win.show();

    // Tell renderer if this is a new window (skip session restore)
    if (isNewWindow) {
      win.webContents.send("window:isNew", true);
    }

    // Auto-update check (production only)
    if (!isDev) {
      updater.setMainWindow(win);
      updater.checkForUpdates();
    }
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "Marblo",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => createWindow(true),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Terminal",
      submenu: [
        {
          label: "New Terminal",
          accelerator: "CmdOrCtrl+`",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) {
              focused.webContents.send("terminal:new");
            }
          },
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "close" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  return win;
}

// Open a tab (Board/Code) in its own pop-out window. Reuses createWindow with a
// `detachedView` so the renderer boots into the single-panel DetachedLayout.
// `seed` carries the parent window's folder/project so the new window's
// useSessionRestore reconnects to the SAME project rather than showing the
// folder picker (per-window restore record wins even for new windows).
function createDetachedWindow(
  view: DetachedView,
  seed?: { rootPath?: string; projectId?: string },
): BrowserWindow {
  const win = createWindow(true, view);
  // External-link handling is already applied via createWindow; re-asserting it
  // here is a no-op (WeakSet-guarded) but keeps the contract explicit.
  applyExternalLinkHandling(win.webContents);
  // Always tag the per-window record as detached (even with no seed) so this
  // pop-out is never written into the persisted multi-window session — it's a
  // sub-panel of its parent project, not a standalone window to restore.
  windowRestore.set(win.webContents.id, {
    ...(activeAccountUid ? { uid: activeAccountUid } : {}),
    ...(seed?.rootPath ? { rootPath: seed.rootPath } : {}),
    ...(seed?.projectId ? { projectId: seed.projectId } : {}),
    detached: true,
  });
  return win;
}

// On launch, reopen every project window that was open at last quit. Falls
// back to a single default window (which restores via the global app-state)
// when no multi-window session was saved. Seeds each window's per-window
// restore record (windowRestore, keyed by webContents.id) so its renderer
// reconnects to the right project instead of showing the folder picker —
// see src/lib/sessionRestore.ts.
function restoreWindowSession(accountUid: string): void {
  // Dedupe on read too — an app-state.json written by an older build (before
  // detached windows were excluded) can hold the same project many times.
  // selectPersistableWindows collapses those so we never reopen duplicates.
  const state = appStateForAccount(accountUid);
  const persistable = selectPersistableWindows(state.windows ?? []);

  // Drop / re-point windows whose folder died while the app was closed —
  // typically a git worktree cleaned up between sessions. Opening a window on a
  // path that no longer exists produces no error of its own; it just yields a
  // window where nothing can spawn. See resolveRestoreRoots.
  const { windows: resolved, dropped } = resolveRestoreRoots(
    persistable,
    (p) => fs.existsSync(p),
    state.lastRootPath ? { defaultRootPath: state.lastRootPath } : undefined,
  );
  for (const w of dropped) {
    console.warn(
      `[Window] Saved window root no longer exists and has no fallback — not reopening: "${w.rootPath}"`,
    );
  }
  const saved = resolved.slice(0, 10); // sanity cap — never spawn a runaway number of windows
  if (saved.length === 0) {
    // Every saved root is gone. Tell the user why they're back at the folder
    // picker instead of on their projects, then open one empty window.
    const firstDead = dropped[0]?.rootPath;
    if (firstDead) notifyRootPathMissing(firstDead);
    if (allWindows.size === 0) createWindow();
    return;
  }
  const reusableWindows = Array.from(allWindows).filter(
    (candidate) => !candidate.isDestroyed(),
  );
  saved.forEach((w, i) => {
    // First window is primary; the rest open as additional windows. Their
    // seeded restore state makes them reconnect rather than show the picker.
    const reusable = reusableWindows[i];
    const win = reusable ?? createWindow(i > 0 || allWindows.size > 0);
    windowRestore.set(win.webContents.id, {
      uid: accountUid,
      rootPath: w.rootPath,
      projectId: w.projectId,
    });
    if (w.fellBackFrom) {
      console.warn(
        `[Window] Saved root "${w.fellBackFrom}" no longer exists — reopening on "${w.rootPath}" instead`,
      );
    }
  });
  // Re-persist so the substituted roots replace the dead ones on disk right
  // away, rather than only if the user happens to touch a window before quit.
  persistWindowSession();
}

// --- PTY IPC Handlers ---

// Owner-scoping guard for renderer-supplied PTY ids. ptyOwners maps a PTY sid
// to the webContents that owns it (set at create / restore / onPtyReady). We
// accept mutating ops (write/writeAndSubmit/kill/resize) only from the owning
// window so one window can't drive — or kill — another window's PTY via a
// guessed/leaked sid. Untracked sids (legacy paths that never registered an
// owner) are allowed to avoid regressing existing sessions — same permissive
// fallback posture as sendToOwner. Same-trust app, so this is defence-in-depth,
// not a hard security boundary.
function isPtyCallerOwner(senderId: number, id: string): boolean {
  // Untracked (or fully orphaned) sids stay permissive — see comment above.
  if (!ptyOwners.isOwned(id)) return true;
  return ptyOwners.has(id, senderId);
}

// pty:create spawns a PTY with a renderer-supplied command/args. This is a
// CONSCIOUS trust decision: the terminal exists to run arbitrary user commands,
// so the bridge's ALLOWED_SPAWN_COMMANDS allowlist (which gates the *remote*
// RCE surface) is deliberately NOT applied here. The renderer is same-origin,
// same-OS-user, first-party code; an attacker who can call this IPC already has
// in-process code execution. Guarding it would only break the feature. If the
// renderer ever loads untrusted remote content this decision must be revisited.
ipcMain.handle("pty:create", (event, { id, name, command, args, cwd }) => {
  let session;
  try {
    session = ptyManager.create(id, name, command, args, cwd);
  } catch (err) {
    // A dead cwd now throws here instead of spawning a shell that exits in 6ms.
    // Rejecting alone would surface as a bare console error in the renderer, so
    // name the real cause — this is the "터미널이 그냥 안 열림" case.
    const code = (err as NodeJS.ErrnoException)?.code;
    if ((code === "ENOENT" || code === "ENOTDIR") && cwd) {
      // Pass the caller's window so the dialog can offer to repoint THAT window
      // (and so its renderer, not some other one, gets the folder picker).
      notifyRootPathMissing(cwd, event.sender.id);
    }
    throw err;
  }
  addPtyOwner(id, event.sender.id);

  // Use same buffer-then-live pattern as agents (survives React StrictMode)
  setupPtyForwarding(id);

  return { id: session.id, name: session.name, shell: session.shell };
});

// 오케스트레이터 PTY 는 launch 시 `orch-orchestrator-...` 로 id 가 만들어진다
// (orchestrator-manager: `orch-${sessionId}-${Date.now()}`). 활성화 퍼널의
// "첫 대화" 칸은 **사용자가 오케에 말을 건 순간**이라, 에이전트 PTY 는 세면 안 된다.
function isOrchestratorPtyId(id: string): boolean {
  return id.startsWith("orch-");
}

// 사용자가 오케 PTY 에 지시를 제출한 순간 = 활성화 퍼널 "첫 대화"(티켓 ygoWP1VJ).
// 렌더러가 보낸 것만 여기를 지난다(메인 내부 주입은 ptyManager 를 직접 호출).
// 내용은 넘기지 않는다 — 길이만 넘기고 그마저 구간으로 접혀 나간다.
function noteOrchestratorSubmit(id: string, surface: string, length: number) {
  if (!isOrchestratorPtyId(id)) return;
  mainTelemetry.orchestratorMessage(mainWindow, surface, length);
}

// pty:write uses ipcMain.on (one-way) — keystrokes shouldn't pay invoke's round-trip cost
ipcMain.on("pty:write", (event, { id, data }) => {
  if (!isPtyCallerOwner(event.sender.id, id)) return;
  // 터미널 직접 입력의 '제출' 은 CR 키다(xterm 이 Enter 를 \r 로 보낸다).
  // 키스트로크마다 도는 경로라 오케 PTY 가 아니면 문자열 검사도 하지 않는다.
  // 길이는 -1(unknown) 로 보낸다 — 입력이 키스트로크로 쪼개져 들어오므로 진짜
  // 길이를 알려면 사용자 입력을 메인에서 버퍼링해야 하고, 그건 비식별 원칙에
  // 어긋난다. 0 으로 적어 "빈 메시지"를 지어내지도 않는다.
  if (
    typeof data === "string" &&
    isOrchestratorPtyId(id) &&
    data.includes("\r")
  ) {
    noteOrchestratorSubmit(id, "terminal", -1);
  }
  ptyManager.write(id, data);
});

type PtyWriteAndSubmitResult = {
  ok: boolean;
  refusal: ComposerRefusal | null;
  reason: string | null;
};

// pty:writeAndSubmit — inject a message and submit it as a discrete Enter.
// Used by programmatic senders (e.g. FeedbackInput) that aren't raw keystroke
// passthrough: routes through the same verify-and-retry submit logic as
// orchestrator/agent message injection so the CR actually registers.
//
// This is request/response, not fire-and-forget: composer-gate refusals mean
// nothing was written, so renderer senders must keep the user's draft intact.
ipcMain.handle(
  "pty:writeAndSubmit",
  async (
    event,
    {
      id,
      data,
      bracketedPaste,
    }: { id: string; data: string; bracketedPaste?: boolean },
  ): Promise<PtyWriteAndSubmitResult> => {
    if (!isPtyCallerOwner(event.sender.id, id)) {
      return {
        ok: false,
        refusal: null,
        reason: "PTY write rejected: caller does not own this session",
      };
    }

    const ok = await ptyManager.writeAndSubmit(
      id,
      data,
      undefined,
      bracketedPaste,
    );
    if (ok) {
      // FeedbackInput / CommandPanel 처럼 한 번에 통째로 제출하는 경로 — 여기서는
      // 길이를 알 수 있어 구간으로 접어 남긴다(내용은 넘기지 않는다). 실제로
      // 제출된 뒤에만 기록한다. 컴포저 게이트가 막은 것은 사용자 첫 대화가 아니다.
      noteOrchestratorSubmit(
        id,
        "inject",
        typeof data === "string" ? data.length : -1,
      );
      return { ok: true, refusal: null, reason: null };
    }

    const gate = ptyManager.composerVerdict(id);
    console.error(
      `[pty:writeAndSubmit] NOT SENT to ${id} (${
        typeof data === "string" ? data.length : -1
      } chars) — ${gate.refusal ?? "write rejected"}: ${gate.reason}`,
    );
    return {
      ok: false,
      refusal: gate.refusal,
      reason: gate.reason,
    };
  },
);

ipcMain.handle("pty:resize", (event, { id, cols, rows }) => {
  if (!isPtyCallerOwner(event.sender.id, id)) return;
  // Discard any pre-resize buffered output. The PTY was spawned at 80x24
  // and the TUI (Gemini Ink, Codex/Claude TUI variants) rendered its
  // initial frame at those dimensions. Once we resize, the CLI receives
  // SIGWINCH and redraws at the new size — but the OLD frame is still in
  // ptyBuffers. If we keep it, the next pty:replay writes the 80x24 frame
  // and the post-resize frame back-to-back into xterm, producing duplicate
  // text, two input boxes, and visual flicker (most visible in Gemini's
  // alt-screen TUI).
  //
  // ★"initial" is a TIME window, not merely "not yet drained". A terminal that
  // mounts late — the beginner agent modal, opened minutes after the agent
  // spawned — fits itself on mount and sends exactly this resize. Its buffer is
  // not a stale 80x24 frame; it is the entire session, and it is the only copy
  // (nothing is sent live before the first pty:replay). Clearing it there is
  // what made the beginner terminal open blank and only fill in once the user
  // typed and the TUI redrew itself. Measured in
  // tests/playwright/unit/terminal-late-mount-replay.spec.ts.
  const buf = ptyBuffers.get(id);
  if (buf && buf.length > 0) {
    const startedAt = ptyBufferStartedAt.get(id);
    // Unknown age (e.g. a bridge-server-created buffer) counts as old — losing
    // a duplicate frame is cosmetic, losing the session is a blank screen.
    const age = startedAt === undefined ? Infinity : Date.now() - startedAt;
    if (age <= PTY_INITIAL_FRAME_DISCARD_MS) {
      buf.length = 0;
      ptyBufferChars.set(id, 0);
      // The retained ring holds that same stale frame — clear it in lockstep,
      // or the ring would hand #1047's duplicate 80x24 frame straight back on
      // the very next replay and quietly undo that fix.
      resetPtyScrollback(id);
      console.log(
        `[PTY:RESIZE] Cleared pre-resize buffer for ${id} (now ${cols}x${rows})`,
      );
    } else {
      console.log(
        `[PTY:RESIZE] Kept ${buf.length} buffered chunks for ${id} — late mount (buffer age ${age}ms), now ${cols}x${rows}`,
      );
    }
  }
  ptyManager.resize(id, cols, rows);
});

ipcMain.handle("pty:kill", (event, { id }) => {
  if (!isPtyCallerOwner(event.sender.id, id)) return;
  ptyManager.kill(id);
});

ipcMain.handle("pty:list", () => {
  return ptyManager.listSessions();
});

// Cheap existence probe. Used by TerminalView to suppress the misleading
// "session expired" warning on re-mount (the replay buffer is drained on
// first mount, so subsequent mounts always see buffered.length === 0 even
// when the PTY is alive and well).
ipcMain.handle("pty:exists", (_event, { id }: { id: string }) => {
  return ptyManager.listSessions().some((s) => s.id === id);
});

// Resolved `claude` binary + version (surfaced in the orchestrator header so
// the user can see which Claude Code build agents actually launch with).
ipcMain.handle("claude:version", () => {
  return resolveClaudeBinary();
});

// Fast, offline installed-version map per agent model (claude/gpt/antigravity/
// gemini) for the per-agent version badges. Local `--version` only — no npm
// round-trip, and it covers agy/gemini which harness:versions omits.
ipcMain.handle("harness:cliVersions", () => {
  return resolveAllHarnessVersions();
});

// Packaged-app Google sign-in (B안, ticket QvaYPAjAW822I0IDiwwZ). The renderer
// calls this on the packaged 127.0.0.1 origin where signInWithRedirect silently
// hangs; main runs the system-browser loopback OAuth flow (RFC 8252 + PKCE) and
// returns the id_token so the renderer can finish with signInWithCredential. The
// client id/secret never leave main. See docs/GOOGLE_LOGIN_PACKAGED.md.
ipcMain.handle("auth:googleLoopback", () => {
  return runGoogleLoopbackOAuth();
});

ipcMain.on("auth:setAccountScope", (_event, input: { uid?: unknown }) => {
  const uid = input?.uid === null ? null : input?.uid;
  adoptMainAccountScope(isValidAccountUid(uid) ? uid : null, "renderer-auth");
});

ipcMain.handle(
  "auth:syncAgentCustomToken",
  async (_event, input: { customToken?: unknown }) => {
    const result = await syncAgentCustomToken(input?.customToken);
    // 실사용자 uid 인증이 성립한 순간이 텔레그램 채널 메타 동기화가 가능해지는
    // 순간이다(projects 의 isProjectMember 규칙 통과). pull 로 다른 기기의
    // 채널 메타를 복원하고 push 리컨사일로 이 기기의 설정을 업로드한다.
    // fail-soft — 실패해도 로그인/로컬 채널에는 영향 없음.
    if (result.ok && result.customTokenAccepted) {
      void syncTelegramChannelMeta(getMachineId()).catch(() => undefined);
      // 실사용자 인증이 성립한 지금이 학습데이터 캡처 게이트를 서버에 물어볼 수
      // 있는 첫 시점이다(익명 세션에선 콜러블이 거부한다). 여기서 한 번 당겨
      // 두면 첫 폴부터 캡처가 붙고, 스풀에 남아 있던 이전 세션분도 함께 나간다.
      void refreshTrainingCapture().catch(() => undefined);
      // ★미션 엔진 구독 재동기화 (티켓 Ciriq5ASEvAlA8TnKxhW).
      //   missions 룰이 멤버 스코프가 된 뒤로 엔진 구독은 "내가 멤버인 프로젝트"
      //   목록을 필요로 한다. startup 이 로그인보다 먼저 돌면 그 목록이 비어
      //   구독을 건너뛰므로(=거부될 쿼리를 안 쏜다), 실사용자 인증이 성립한
      //   지금 다시 건다. pickupPlanningMissions 는 구독이 없을 때만 동작하는
      //   멱등 함수라 이미 붙어 있으면 no-op 이다. fail-soft.
      if (missionBundle) {
        void (async () => {
          try {
            await missionBundle.forwarder.resync();
            await missionBundle.pickupPlanningMissions();
          } catch (err) {
            console.error("[Main] mission engine resync failed:", err);
          }
        })();
      }
    }
    if (result.ok && result.customTokenAccepted && result.uid) {
      adoptMainAccountScope(result.uid, "agent-custom-token");
    }
    return result;
  },
);

ipcMain.handle("auth:clearAgentCustomToken", () => {
  adoptMainAccountScope(null, "agent-custom-token-clear");
  return clearAgentCustomToken();
});

// 학습데이터 캡처 상태(진단용). 원문/uid 는 절대 반환하지 않는다 — 켜졌는지,
// 서버가 적격이라고 했는지, 스풀에 몇 건 남았는지만.
ipcMain.handle("training:captureStatus", () => trainingCaptureStatus());

// 설정에서 동의 토글을 바꾼 직후 게이트를 즉시 재조회한다(10분 주기 대기 없이).
ipcMain.handle("training:refreshCapture", async () => {
  await refreshTrainingCapture();
  return trainingCaptureStatus();
});

// --- Board IPC Handlers ---
interface BoardWorktreeDiffArgs {
  taskId?: string;
  worktreePath?: string;
  baseRef?: string;
}

interface BoardGitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const BOARD_DIFF_MAX_BYTES = 200_000;

function runBoardGit(args: string[], cwd: string): Promise<BoardGitResult> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, env: gitSpawnEnv() });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: annotateGitFailure(err.message) });
    });
    proc.on("close", (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        // macOS Xcode CLT 문제면 raw xcrun 출력 대신 실행할 명령을 담은
        // 안내로 바뀐다 (티켓 nETj7szjEtT5prbYsg1D).
        stderr: stderr ? annotateGitFailure(stderr) : stderr,
      });
    });
  });
}

function truncateBoardDiff(diff: string): string {
  if (diff.length <= BOARD_DIFF_MAX_BYTES) return diff;
  return `${diff.slice(
    0,
    BOARD_DIFF_MAX_BYTES,
  )}\n\n...(truncated - run git diff locally for full output)`;
}

async function buildBoardWorktreeDiff(
  worktreePath: string,
  baseRef: string,
): Promise<string> {
  if (
    !fs.existsSync(worktreePath) ||
    !fs.statSync(worktreePath).isDirectory()
  ) {
    throw new Error(`worktree path not found: ${worktreePath}`);
  }

  let comparisonRef = baseRef;
  const mergeBase = await runBoardGit(
    ["merge-base", baseRef, "HEAD"],
    worktreePath,
  );
  if (mergeBase.code === 0 && mergeBase.stdout.trim()) {
    comparisonRef = mergeBase.stdout.trim();
  }

  const tracked = await runBoardGit(
    [
      "diff",
      "--stat",
      "--patch",
      "--no-color",
      "--no-ext-diff",
      comparisonRef,
      "--",
    ],
    worktreePath,
  );
  if (tracked.code !== 0) {
    throw new Error(`git diff failed: ${tracked.stderr.trim()}`);
  }

  const parts = [tracked.stdout.trimEnd()].filter(Boolean);
  const untracked = await runBoardGit(
    ["ls-files", "--others", "--exclude-standard"],
    worktreePath,
  );
  if (untracked.code === 0) {
    for (const filePath of untracked.stdout.split("\n").filter(Boolean)) {
      const fileDiff = await runBoardGit(
        ["diff", "--no-index", "--no-color", "--", "/dev/null", filePath],
        worktreePath,
      );
      if ((fileDiff.code === 0 || fileDiff.code === 1) && fileDiff.stdout) {
        parts.push(fileDiff.stdout.trimEnd());
      }
      if (parts.join("\n\n").length > BOARD_DIFF_MAX_BYTES) break;
    }
  }

  return truncateBoardDiff(parts.join("\n\n"));
}

ipcMain.handle(
  "board:worktreeDiff",
  async (_event, args: BoardWorktreeDiffArgs) => {
    const worktreePath = args?.worktreePath?.trim();
    if (!worktreePath) {
      throw new Error("board:worktreeDiff requires worktreePath");
    }
    return buildBoardWorktreeDiff(worktreePath, args.baseRef?.trim() || "HEAD");
  },
);

// --- File System IPC Handlers ---
ipcMain.handle(
  "fs:readTree",
  (_event, rootPath: string, options?: { showHidden?: boolean }) => {
    return fsManager.readTree(rootPath, options ?? {});
  },
);

ipcMain.handle(
  "fs:readFile",
  (_event, { rootPath, filePath }: { rootPath: string; filePath: string }) => {
    // Containment guard, symmetric with the mutation handlers below — blocks
    // reads of arbitrary absolute paths (e.g. ~/.ssh/config) via this IPC.
    fsGuard(rootPath, filePath);
    return fsManager.readFile(filePath);
  },
);

ipcMain.handle(
  "fs:writeFile",
  (
    _event,
    {
      rootPath,
      filePath,
      content,
    }: { rootPath: string; filePath: string; content: string },
  ) => {
    // Containment guard — blocks writes of arbitrary absolute paths.
    fsGuard(rootPath, filePath);
    fsManager.writeFile(filePath, content);
  },
);

ipcMain.handle("fs:gitStatus", async (_event, rootPath: string) => {
  return fsManager.getGitStatus(rootPath);
});

// Changed-file set for a worktree, relative to merge-base(baseRef, HEAD) — the
// collection behind "이 워크트리 보기". Errors propagate to the renderer on
// purpose: a failed collection must not be indistinguishable from "no changes".
ipcMain.handle(
  "fs:gitWorktreeChanges",
  async (
    _event,
    { rootPath, baseRef }: { rootPath: string; baseRef: string },
  ) => {
    return fsManager.getWorktreeChanges(rootPath, baseRef);
  },
);

ipcMain.handle(
  "fs:gitDiff",
  async (_event, filePath: string, baseSha?: string) => {
    return fsManager.getGitDiff(filePath, baseSha);
  },
);

ipcMain.handle("fs:gitRemoteUrl", async (_event, rootPath: string) => {
  return fsManager.getGitRemoteUrl(rootPath);
});

ipcMain.handle("fs:isGitRepository", async (_event, rootPath: string) => {
  if (typeof rootPath !== "string" || !rootPath) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const proc = spawn("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: rootPath,
        env: gitSpawnEnv(),
      });
      let out = "";
      proc.stdout.on("data", (data) => {
        out += data.toString();
      });
      proc.on("close", (code) => {
        resolve(code === 0 && out.trim() === "true");
      });
      proc.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
});

/**
 * 연결된 own 폴더가 실제 코드 탭을 쓸 수 있는 상태인지 검사 (티켓
 * r8vg9pMWCRtdnUzR3KyX, own-but-empty 보강).
 *
 * ★왜 새 IPC 인가 — `fs:pathExists`/`fs:gitRemoteUrl` 만으로는 부족하다.
 *  - "빈 폴더 자동 등록으로 own 이 된 멤버"는 pathExists 도 통과하고 git
 *    remote 도 없으니, 두 호출을 따로 하면 "폴더는 있는데 git 이 없다" /
 *    "git 은 있는데 origin 이 다르다" / "코드가 없다"를 구분 못 해
 *    shouldOfferRepoConnect 가 빈폴더를 정상 own 으로 오해한다.
 *  - 한 번에 묶어야 "empty" 와 "mismatch" 를 정확히 가른다. 둘 다 true
 *    인 경우는 사실상 비어 있으므로 empty 가 이긴다(빈 폴더에서 git
 *    remote 를 요구하는 건 무의미).
 *
 * ★IPC 실패는 빈 객체로 무력화한다. shouldOfferRepoConnect 는 검사 실패를
 * "valid 도 empty 도 아님(null)" 으로 보고 기존 동작(own 이면 모달 안
 * 띄움)을 유지한다 — 부팅 중 권한 지연·fs 잠깐 잠김 등으로 깜빡이지
 * 않게.
 */
ipcMain.handle(
  "fs:checkFolderValidity",
  async (
    _event,
    {
      folderPath,
      expectedRemoteUrl,
    }: {
      folderPath: string;
      expectedRemoteUrl?: string | null;
    },
  ): Promise<{
    exists: boolean;
    isEmpty: boolean;
    remoteUrl: string | null;
    matches: boolean | null;
  }> => {
    const empty: {
      exists: boolean;
      isEmpty: boolean;
      remoteUrl: string | null;
      matches: boolean | null;
    } = {
      exists: false,
      isEmpty: true,
      remoteUrl: null,
      matches: null,
    };
    if (typeof folderPath !== "string" || !folderPath) return empty;
    try {
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) return { ...empty, exists: false };
      const entries = fs.readdirSync(folderPath);
      if (entries.length === 0) {
        // ★빈 폴더는 곧장 empty — git remote 비교는 무의미.
        return { exists: true, isEmpty: true, remoteUrl: null, matches: null };
      }
      const remoteUrl = await fsManager.getGitRemoteUrl(folderPath);
      let matches: boolean | null = null;
      if (expectedRemoteUrl && expectedRemoteUrl.trim() && remoteUrl) {
        matches =
          normalizeGitRemoteForCompare(remoteUrl) ===
          normalizeGitRemoteForCompare(expectedRemoteUrl);
      }
      // 코드는 있는데 git 이 전혀 아니면(empty 가 아니면서 remoteUrl=null)
      // 도 mismatch 로 본다 — 프로젝트는 git 저장소를 기대하기 때문.
      const isEmpty = false;
      return { exists: true, isEmpty, remoteUrl, matches };
    } catch {
      return empty;
    }
  },
);

/** repo URL 비교 정규화 (projectService.normalizeGitRemoteUrl 과 동일 규칙). */
function normalizeGitRemoteForCompare(url: string): string {
  let s = url.trim().toLowerCase();
  let m = s.match(/^git@([^:]+):(.+)$/);
  if (m) s = `${m[1]}/${m[2]}`;
  else {
    m = s.match(/^(?:(?:ssh:\/\/)?git@|https?:\/\/|git:\/\/)([^/]+)\/(.+)$/);
    if (m) s = `${m[1]}/${m[2]}`;
  }
  return s.replace(/\.git$/, "");
}

// --- Repo clone (팀 멤버 "Clone & 연결" 원클릭, 티켓 r8VggohxLGciDVXV2rf6) ---
//
// ★완전 자동풀 아님 — RepoConnectModal 의 명시적 버튼에서만 호출된다.
// URL 검증·대상 경로 조합·에러 분류는 전부 repo-clone.ts 가 담당한다.

ipcMain.handle("repo:defaultCloneParent", () => defaultCloneParentDir());

interface GitHubDeviceSession {
  userId: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresAt: number;
}

const githubDeviceSessions = new Map<string, GitHubDeviceSession>();

function validGitHubOAuthUserId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function githubOAuthClientId(): string | null {
  return process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || null;
}

/** Device-flow 시작. 토큰은 이 IPC 응답에 절대 포함되지 않는다. */
ipcMain.handle("github:deviceStart", async (_event, input: unknown) => {
  const userId =
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : undefined;
  const clientId = githubOAuthClientId();
  if (!validGitHubOAuthUserId(userId))
    return { ok: false, error: "유효한 사용자 정보가 필요합니다." };
  if (!clientId)
    return { ok: false, error: "GitHub 연결이 아직 설정되지 않았습니다." };
  try {
    const code = await requestGitHubDeviceCode(clientId);
    const sessionId = crypto.randomUUID();
    githubDeviceSessions.set(sessionId, {
      userId,
      deviceCode: code.deviceCode,
      intervalSeconds: code.interval,
      expiresAt: Date.now() + code.expiresIn * 1000,
    });
    return {
      ok: true,
      sessionId,
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      verificationUriComplete: code.verificationUriComplete,
      expiresIn: code.expiresIn,
      interval: code.interval,
    };
  } catch {
    return { ok: false, error: "GitHub 디바이스 코드를 시작하지 못했습니다." };
  }
});

/** 한 번의 polling. pending/slow_down은 renderer가 nextInterval 후 재호출한다. */
ipcMain.handle("github:devicePoll", async (_event, sessionId: unknown) => {
  if (typeof sessionId !== "string")
    return { kind: "error", message: "연결 세션이 올바르지 않습니다." };
  const session = githubDeviceSessions.get(sessionId);
  const clientId = githubOAuthClientId();
  if (!session || !clientId)
    return {
      kind: "error",
      message: "연결 세션이 만료되었습니다. 다시 시작하세요.",
    };
  if (Date.now() >= session.expiresAt) {
    githubDeviceSessions.delete(sessionId);
    return { kind: "expired" };
  }
  const result = await pollGitHubDeviceCode(
    clientId,
    session.deviceCode,
    session.intervalSeconds,
  );
  if (result.kind === "pending" || result.kind === "slow_down") {
    session.intervalSeconds = result.nextIntervalSeconds;
    return result;
  }
  githubDeviceSessions.delete(sessionId);
  if (result.kind !== "success") return result;
  try {
    saveGitHubToken(safeStorage, session.userId, result.accessToken);
    return { kind: "success" };
  } catch {
    return {
      kind: "error",
      message: "OS 키체인에 GitHub 연결 정보를 저장하지 못했습니다.",
    };
  }
});

ipcMain.handle("github:status", (_event, userId: unknown) => {
  if (!validGitHubOAuthUserId(userId)) return { connected: false };
  return { connected: !!getGitHubToken(safeStorage, userId) };
});

ipcMain.handle("github:disconnect", (_event, userId: unknown) => {
  if (!validGitHubOAuthUserId(userId)) return { ok: false };
  try {
    removeGitHubToken(safeStorage, userId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// ── GitHub App 자동상속 (티켓 ddbN2KvxHZ08rakiVfL0) ────────────────────────
//
// ★device OAuth 채널(위)의 시그니처·반환형은 하나도 건드리지 않았다 —
// 설계 §6.2 G4(IPC 계약 불변). 아래 두 채널은 **추가**일 뿐이다.
//
// ★어떤 응답에도 토큰이 실리지 않는다(설계 §5-B3). status 는 boolean 3개,
// install 은 URL 하나뿐이다.

function validProjectIdArg(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** 이 프로젝트에 App 이 붙어 있는가 / 지금도 저장소를 열 수 있는가. */
ipcMain.handle("github:appStatus", async (_event, projectId: unknown) => {
  if (!validProjectIdArg(projectId)) {
    // ★전 필드를 채운다. v2 필드를 빼고 돌려주면 렌더러가 선언된 타입을
    // 믿고 `writeGranted` 를 undefined 로 읽는데, 그게 곧 "권한 없음" 과
    // "모름" 이 구분되지 않는 상태다. 보수적 기본값으로 전부 false.
    return {
      installed: false,
      repoAccessible: false,
      configured: false,
      role: null,
      canWrite: false,
      canMerge: false,
      writeGranted: false,
    };
  }
  return getGitHubAppStatus(projectId);
});

/**
 * 오너의 설치 시작. ★앱 창을 navigate 하지 않고 **시스템 브라우저**로 연다
 * (Drive 커넥터와 같은 규율) — GitHub 로그인 화면을 앱 안에 띄우지 않는다.
 */
ipcMain.handle("github:appInstall", async (_event, projectId: unknown) => {
  if (!validProjectIdArg(projectId)) {
    return { ok: false, error: "프로젝트 정보가 올바르지 않습니다." };
  }
  const started = await startGitHubAppInstall(projectId);
  if (!started.ok || !started.installUrl) return started;
  try {
    await shell.openExternal(started.installUrl);
  } catch {
    return { ok: false, error: "브라우저를 열지 못했습니다." };
  }
  return { ok: true };
});

// ── Google Drive 커넥터 (읽기 전용, 티켓 zqNxS9904aeeBEug1uAD) ──────────────
//
// 지식위키·비서 에이전트 에픽의 선행 기반. 여기 있는 것은 커넥터까지고, 인덱스
// 저장소/위키 UI/비서는 후속이다.
//
// ★userId 규율: Drive 자격증명은 **Marblo 사용자 uid 별로** 저장된다(한 머신을
// 여러 계정이 쓸 수 있다). 렌더러 호출은 uid 를 명시로 넘기고, 창이 없는 경로
// (브리지→MCP 도구)는 `currentRealUserUid()` 로 지금 로그인된 실사용자를 쓴다.
// 익명 세션에서는 null 이 나오고, 그때는 "연결되지 않음" 으로 정직하게 답한다.
//
// ★토큰은 이 IPC 응답 어디에도 실리지 않는다 — status 는 이메일·스코프·연결시각만.
//
// ── ★두 개의 축, 두 개의 호출 경로 (티켓 MCTHALmNAWPpilTFwe8o) ──────────────
//
// 인증은 유저 단위(위 uid 규율)지만 **지식은 프로젝트 단위**다. 그래서 같은
// 커넥터를 두 가지 접근 모드로 나눠 쓴다.
//
//   · `mode: "user"` — 렌더러의 **폴더 피커**. 사람이 자기 드라이브를 보며 "이
//     프로젝트의 위키는 이 폴더" 를 고르는 화면이라, 스코프를 걸면 아무것도 고를
//     수 없다. 사람이 자기 눈으로 자기 드라이브를 보는 것이므로 경계가 필요 없다.
//   · `mode: "project"` — 브리지→MCP(drive_search/drive_fetch), 즉 **에이전트**.
//     여기서는 프로젝트의 바인딩 폴더 밖을 절대 보지 못한다. 바인딩이 없으면
//     "폴더를 먼저 고르라" 고 답하고 조회 자체를 하지 않는다 — 미바인딩을 조용히
//     "드라이브 전체" 로 해석하면 프로젝트 A 의 에이전트가 B 의 문서를 읽는다.

function validDriveUserId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

/** 렌더러가 준 uid 를 우선하고, 없으면 로그인된 실사용자. 없으면 null. */
function resolveDriveUserId(value: unknown): string | null {
  if (validDriveUserId(value)) return value;
  return currentRealUserUid();
}

function resolveBrowserAutomationUserId(value: unknown): string | null {
  return resolveDriveUserId(value);
}

function browserAutomationSiteKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeSiteKey(value);
  } catch {
    return null;
  }
}

/** Drive 호출 실패 → 사용자 문구. 예외 종류에 관계없이 토큰은 새지 않는다. */
function driveFailure(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error:
      e instanceof Error
        ? e.message
        : "Google Drive 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  };
}

const DRIVE_NOT_CONNECTED = {
  ok: false as const,
  error:
    "Google 계정이 연결되어 있지 않습니다. Harness 탭에서 Google 커넥터를 연결해 주세요.",
};

function googleConnectorFailure(
  e: unknown,
  fallback: string,
): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error ? e.message : fallback,
  };
}

/**
 * 유저별 스코프 해석기 캐시. 커넥터는 매 호출 토큰을 새로 얻으므로 상태가 없고,
 * 해석기가 들고 있는 것은 폴더트리 캐시(TTL)뿐이라 재사용이 안전하다.
 */
const driveScopeResolvers = new Map<string, DriveScopeResolver>();

function driveScopeResolverFor(userId: string): DriveScopeResolver {
  const cached = driveScopeResolvers.get(userId);
  if (cached) return cached;
  const resolver = createDriveScopeResolver(
    createUserDriveConnector(safeStorage, userId),
  );
  driveScopeResolvers.set(userId, resolver);
  return resolver;
}

/** 바인딩 변경·연결 해제 후 낡은 폴더트리 캐시를 버린다. */
function invalidateDriveScopeCaches(): void {
  for (const resolver of driveScopeResolvers.values()) resolver.invalidate();
}

async function driveSearchFor(
  userId: string | null,
  params: DriveListParams,
  access: DriveAccess = { mode: "user" },
): Promise<
  | { ok: true; result: DriveSearchResult; scope?: DriveScopeInfo }
  | { ok: false; error: string }
> {
  // ★게이트가 로그인 검사보다 **앞**에 온다. 이 기능은 "연결하면 되는" 상태가
  //   아니라 "이번 출시에는 없는" 상태다. 순서를 바꾸면 로그아웃 사용자가
  //   "연결하세요" 를 보고 연결한 뒤에야 진짜 이유를 알게 된다.
  const withheld = withheldCapabilityError("drive_read");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    const connector = createUserDriveConnector(safeStorage, userId);
    if (access.mode === "user") {
      return { ok: true, result: await connector.search(params) };
    }

    const planned = await planScopedSearch(
      driveScopeResolverFor(userId),
      access.projectId,
      access.projectId ? getDriveProjectBinding(access.projectId) : null,
      params,
    );
    if (!planned.ok) return planned;

    return {
      ok: true,
      result: await connector.search(planned.params),
      scope: planned.scope,
    };
  } catch (e) {
    return driveFailure(e);
  }
}

async function driveFetchFor(
  userId: string | null,
  fileId: string,
  access: DriveAccess = { mode: "user" },
): Promise<
  { ok: true; document: DriveDocument } | { ok: false; error: string }
> {
  const withheld = withheldCapabilityError("drive_read");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  if (typeof fileId !== "string" || !fileId.trim()) {
    return { ok: false, error: "파일 id 가 필요합니다." };
  }
  const trimmed = fileId.trim();
  try {
    if (access.mode === "project") {
      const allowed = await authorizeScopedFetch(
        driveScopeResolverFor(userId),
        access.projectId,
        access.projectId ? getDriveProjectBinding(access.projectId) : null,
        trimmed,
      );
      if (!allowed.ok) return allowed;
    }
    const connector = createUserDriveConnector(safeStorage, userId);
    return { ok: true, document: await connector.fetchDocument(trimmed) };
  } catch (e) {
    return driveFailure(e);
  }
}

async function driveWriteFor(
  userId: string | null,
  params: DriveWriteParams,
  projectId: string | null,
): Promise<
  { ok: true; result: DriveWriteResult } | { ok: false; error: string }
> {
  // ★스코프(`drive.file`)는 살아 있는데 기능은 잠긴, 이 티켓에서 유일하게
  //   간접적인 경우다. 만들 위치인 프로젝트 위키 폴더가 **사용자 소유 폴더**라
  //   `drive.file` 로는 메타데이터조차 못 읽어(404) 바인딩 검증이 성립하지 않는다.
  //   바인딩이 되살아나면 이 기능도 같이 살아난다.
  const withheld = withheldCapabilityError("drive_write");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  if (!projectId) return { ok: false, error: "프로젝트 id 가 필요합니다." };
  try {
    const binding = getDriveProjectBinding(projectId);
    if (!binding) {
      return {
        ok: false,
        error:
          "이 프로젝트의 Drive 위키 폴더가 바인딩되어 있지 않습니다. Harness 탭에서 먼저 폴더를 선택해 주세요.",
      };
    }
    const folderId = params.folderId?.trim() || binding.folderId;
    const allowed = await authorizeScopedFetch(
      driveScopeResolverFor(userId),
      projectId,
      binding,
      folderId,
    );
    if (!allowed.ok) return allowed;
    const connector = createUserDriveConnector(safeStorage, userId);
    return {
      ok: true,
      result: await connector.createGoogleDoc({ ...params, folderId }),
    };
  } catch (e) {
    return driveFailure(e);
  }
}

/** 렌더러가 넘긴 검색 입력을 신뢰하지 않고 형태를 좁혀서 받는다. */
function sanitizeDriveListParams(input: unknown): DriveListParams {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    text: str(raw.text),
    nameContains: str(raw.nameContains),
    folderId: str(raw.folderId),
    mimeTypes: Array.isArray(raw.mimeTypes)
      ? raw.mimeTypes.filter((m): m is string => typeof m === "string")
      : undefined,
    includeFolders: raw.includeFolders === true,
    includeTrashed: raw.includeTrashed === true,
    pageSize: typeof raw.pageSize === "number" ? raw.pageSize : undefined,
    pageToken: str(raw.pageToken),
  };
}

function sanitizeGmailSearchParams(input: unknown): GmailSearchParams {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    query: str(raw.query),
    labelIds: Array.isArray(raw.labelIds)
      ? raw.labelIds.filter(
          (label): label is string => typeof label === "string",
        )
      : undefined,
    pageSize: typeof raw.pageSize === "number" ? raw.pageSize : undefined,
    pageToken: str(raw.pageToken),
  };
}

function sanitizeCalendarListParams(input: unknown): CalendarListParams {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    timeMin: str(raw.timeMin),
    timeMax: str(raw.timeMax),
    query: str(raw.query),
    maxResults: typeof raw.maxResults === "number" ? raw.maxResults : undefined,
    pageToken: str(raw.pageToken),
  };
}

function sanitizeContactsSearchParams(input: unknown): ContactsSearchParams {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    query: str(raw.query) ?? "",
    pageSize: typeof raw.pageSize === "number" ? raw.pageSize : undefined,
    maxResults: typeof raw.maxResults === "number" ? raw.maxResults : undefined,
  };
}

async function gmailSearchFor(
  userId: string | null,
  params: GmailSearchParams,
): Promise<
  { ok: true; result: GmailSearchResult } | { ok: false; error: string }
> {
  const withheld = withheldCapabilityError("gmail_read");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      result: await createUserGmailConnector(safeStorage, userId).search(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Gmail 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function gmailFetchFor(
  userId: string | null,
  messageId: string,
): Promise<{ ok: true; message: GmailMessage } | { ok: false; error: string }> {
  const withheld = withheldCapabilityError("gmail_read");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  const trimmed = messageId.trim();
  if (!trimmed) return { ok: false, error: "Gmail 메시지 id 가 필요합니다." };
  try {
    return {
      ok: true,
      message: await createUserGmailConnector(safeStorage, userId).fetch(
        trimmed,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Gmail 메시지 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function gmailDraftFor(
  userId: string | null,
  params: GmailComposeParams,
): Promise<
  { ok: true; draft: GmailDraftResult } | { ok: false; error: string }
> {
  // 초안 자체가 사라진 게 아니다 — 만드는 **장소**가 Gmail 초안함에서 Marblo
  // 화면으로 옮겨갔다. 대체 경로의 도구 계약은 docs/GMAIL_DRAFT_REPLACEMENT.md.
  const withheld = withheldCapabilityError("gmail_draft");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      draft: await createUserGmailConnector(safeStorage, userId).createDraft(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Gmail 초안 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function gmailSendFor(
  userId: string | null,
  params: GmailComposeParams,
): Promise<
  { ok: true; message: GmailSendResult } | { ok: false; error: string }
> {
  const withheld = withheldCapabilityError("gmail_send");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      message: await createUserGmailConnector(safeStorage, userId).sendMessage(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Gmail 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function calendarListFor(
  userId: string | null,
  params: CalendarListParams,
): Promise<
  { ok: true; result: CalendarListResult } | { ok: false; error: string }
> {
  const withheld = withheldCapabilityError("calendar_read");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      result: await createUserCalendarConnector(safeStorage, userId).list(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Calendar 일정 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

/**
 * 시트 값 조회. 트리거 엔진 전용 경로다 — 브리지(MCP)에는 아직 노출하지 않는다.
 * 티켓 qxDMhv5bgZA2nRe7AdPC.
 */
async function sheetsValuesFor(
  userId: string | null,
  params: SheetsValuesParams,
): Promise<
  { ok: true; result: SheetsValuesResult } | { ok: false; error: string }
> {
  const withheld = withheldCapabilityError("sheets_trigger");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      result: await createUserSheetsConnector(safeStorage, userId).getValues(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "스프레드시트 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function calendarCreateFor(
  userId: string | null,
  params: CalendarEventInput,
): Promise<{ ok: true; event: CalendarEvent } | { ok: false; error: string }> {
  const withheld = withheldCapabilityError("calendar_write");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      event: await createUserCalendarConnector(safeStorage, userId).create(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Calendar 일정 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function calendarPatchFor(
  userId: string | null,
  params: CalendarPatchInput,
): Promise<{ ok: true; event: CalendarEvent } | { ok: false; error: string }> {
  const withheld = withheldCapabilityError("calendar_write");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      event: await createUserCalendarConnector(safeStorage, userId).patch(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Calendar 일정 수정에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

async function contactsSearchFor(
  userId: string | null,
  params: ContactsSearchParams,
): Promise<
  { ok: true; result: ContactsSearchResult } | { ok: false; error: string }
> {
  const withheld = withheldCapabilityError("contacts_search");
  if (withheld) return withheld;
  if (!userId) return DRIVE_NOT_CONNECTED;
  try {
    return {
      ok: true,
      result: await createUserContactsConnector(safeStorage, userId).search(
        params,
      ),
    };
  } catch (e) {
    return googleConnectorFailure(
      e,
      "Contacts 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

/**
 * Drive 동의(시스템 브라우저 loopback). ★앱 창은 navigate 하지 않는다 —
 * signInWithRedirect 가 Electron 에서 깨지는 이력 때문에 이 경로만 쓴다.
 */
ipcMain.handle("drive:connect", async (_event, input: unknown) => {
  const userId = resolveDriveUserId(
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : undefined,
  );
  if (!userId) {
    return {
      ok: false,
      error: "먼저 Marblo 에 로그인한 뒤 Google Drive 를 연결해 주세요.",
    };
  }
  const result = await connectGoogleDrive(safeStorage, userId);
  // 다른 구글 계정으로 다시 연결했을 수 있다 — 이전 계정의 폴더트리 캐시를
  // 들고 있으면 남의 드라이브 구조로 스코프를 잡는다.
  if (result.ok) invalidateDriveScopeCaches();
  return result;
});

ipcMain.handle("drive:status", (_event, input: unknown) => {
  const userId = resolveDriveUserId(
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : input,
  );
  if (!userId) return { connected: false };
  return driveConnectionStatus(safeStorage, userId);
});

ipcMain.handle("drive:disconnect", (_event, input: unknown) => {
  const userId = resolveDriveUserId(
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : input,
  );
  if (!userId) return { ok: false, error: "로그인 정보가 없습니다." };
  // 계정이 바뀌면 폴더트리 캐시는 남의 드라이브 구조다 — 즉시 버린다.
  invalidateDriveScopeCaches();
  return disconnectGoogleDrive(safeStorage, userId);
});

// ── 웹 자동화 브라우저 런타임 + 세션 보관 (녹화재생 R3) ─────────────────────
//
// ★Chrome stable 만 쓴다: Playwright `channel:"chrome"` 고정. Edge/Brave
// 자동 폴백은 하지 않는다. Chrome 이 없으면 NEEDS_BROWSER_INSTALL 로 멈추고
// 사람이 Chrome 설치/확인을 해야 한다.
//
// ★세션 평문은 IPC 로 노출하지 않는다. Renderer 가 볼 수 있는 것은 어떤
// siteKey/origin 세션이 있는지, 언제 캡처/검증/만료되는지, 삭제할 수 있는
// 경로뿐이다. 복호화된 storageState 는 자동화 매니저 내부에서만 Playwright
// context 에 메모리로 전달된다.

ipcMain.handle("webAutomation:chromeProbe", async () => {
  return chromeBrowserSessionManager.probeChrome();
});

ipcMain.handle("webAutomation:sessions:list", (_event, input: unknown) => {
  const userId = resolveBrowserAutomationUserId(
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : input,
  );
  if (!userId) return [];
  return browserSessionStore.listSessions(safeStorage, userId);
});

ipcMain.handle("webAutomation:sessions:delete", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const userId = resolveBrowserAutomationUserId(raw.userId);
  const siteKey = browserAutomationSiteKey(raw.siteKey);
  if (!userId || !siteKey) {
    return { ok: false, error: "브라우저 세션 삭제 대상이 올바르지 않습니다." };
  }
  browserSessionStore.deleteSession(safeStorage, userId, siteKey);
  return { ok: true };
});

ipcMain.handle(
  "webAutomation:sessions:launchStored",
  async (_event, input: unknown) => {
    const raw =
      input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    const userId = resolveBrowserAutomationUserId(raw.userId);
    const siteKey = browserAutomationSiteKey(raw.siteKey);
    if (!userId || !siteKey) {
      return {
        ok: false,
        status: "NEEDS_HUMAN_AUTH",
        humanActionReason: "NO_STORED_SESSION",
        message:
          "저장된 사이트 로그인 세션을 찾을 수 없어 사람이 로그인해야 합니다.",
      };
    }
    return chromeBrowserSessionManager.launchStoredSession(safeStorage, {
      userId,
      siteKey,
      headless: raw.headless === false ? false : true,
    });
  },
);

ipcMain.handle(
  "webAutomation:sessions:close",
  async (_event, input: unknown) => {
    const sessionId =
      input && typeof input === "object"
        ? (input as { sessionId?: unknown }).sessionId
        : input;
    if (typeof sessionId !== "string" || !sessionId) {
      return { ok: false, error: "브라우저 세션 id 가 올바르지 않습니다." };
    }
    return { ok: await chromeBrowserSessionManager.closeSession(sessionId) };
  },
);

ipcMain.handle(
  "webAutomation:sessions:leakageGuards",
  () => BROWSER_SESSION_LEAKAGE_GUARDS,
);

ipcMain.handle("drive:search", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return driveSearchFor(
    resolveDriveUserId(raw.userId),
    sanitizeDriveListParams(raw),
    driveAccessFromInput(raw),
  );
});

ipcMain.handle("drive:fetch", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return driveFetchFor(
    resolveDriveUserId(raw.userId),
    typeof raw.fileId === "string" ? raw.fileId : "",
    driveAccessFromInput(raw),
  );
});

ipcMain.handle("gmail:search", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return gmailSearchFor(
    resolveDriveUserId(raw.userId),
    sanitizeGmailSearchParams(raw),
  );
});

ipcMain.handle("gmail:fetch", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return gmailFetchFor(
    resolveDriveUserId(raw.userId),
    typeof raw.messageId === "string" ? raw.messageId : "",
  );
});

ipcMain.handle("calendar:list", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return calendarListFor(
    resolveDriveUserId(raw.userId),
    sanitizeCalendarListParams(raw),
  );
});

ipcMain.handle("contacts:search", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return contactsSearchFor(
    resolveDriveUserId(raw.userId),
    sanitizeContactsSearchParams(raw),
  );
});

// ── ★프로젝트 위키 폴더 바인딩 (티켓 MCTHALmNAWPpilTFwe8o) ──────────────────
//
// 인증(유저)과 다른 축이다. 저장소는 drive-project-binding.ts(로컬 JSON, 0600) —
// slack/telegram 채널 설정과 같은 자리·같은 패턴이다. 시크릿이 없으므로 응답을
// 그대로 렌더러에 준다(folderId·폴더명·갱신시각뿐).

function driveProjectIdFrom(raw: Record<string, unknown>): string | null {
  const value = raw.projectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

ipcMain.handle("drive:binding:get", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : { projectId: input };
  const projectId = driveProjectIdFrom(raw);
  if (!projectId) return null;
  return getDriveProjectBinding(projectId);
});

// ★바인딩은 **비활성**이지 삭제가 아니다(티켓 v5Phjv1WxndUpgFJyrIn).
//
//   · set    — 막는다. 새 폴더를 고를 방법(폴더 검색)이 drive.readonly 를 쓰므로
//              애초에 성립하지 않고, 성립하는 척 저장해두면 나중에 "지정했는데
//              에이전트가 못 읽는다" 는 더 나쁜 상태가 된다.
//   · get    — 그대로 둔다. 기존 바인딩 정보를 지우지 않는 것이 되살리기 비용을
//              낮추는 핵심이고, folderId/폴더명은 시크릿도 아니다.
//   · clear  — 그대로 둔다. 낡은 지정을 걷어낼 길까지 막을 이유는 없다.
ipcMain.handle("drive:binding:set", (_event, input: unknown) => {
  const withheld = withheldCapabilityError("drive_binding");
  if (withheld) return withheld;
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const projectId = driveProjectIdFrom(raw);
  if (!projectId) return { ok: false, error: "프로젝트를 선택해 주세요." };
  if (!isValidDriveFolderId(raw.folderId)) {
    return { ok: false, error: "Drive 폴더 id 형식이 올바르지 않습니다." };
  }
  try {
    const binding = setDriveProjectBinding({
      projectId,
      folderId: raw.folderId,
      folderName:
        typeof raw.folderName === "string" ? raw.folderName : undefined,
    });
    // 폴더가 바뀌었으면 이전 폴더의 하위트리 캐시는 무의미하다.
    invalidateDriveScopeCaches();
    return { ok: true, binding };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "폴더 바인딩 저장에 실패했습니다.",
    };
  }
});

ipcMain.handle("drive:binding:clear", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : { projectId: input };
  const projectId = driveProjectIdFrom(raw);
  if (!projectId) return { ok: false, error: "프로젝트를 선택해 주세요." };
  const removed = clearDriveProjectBinding(projectId);
  invalidateDriveScopeCaches();
  return { ok: true, removed };
});

// 브리지(→ web_tab_read MCP 도구, ticket FQ7nshXHjDWOvD0WWUVV)가 쓰는
// 게이트웨이. 실제 권한 판정·추출·중단은 전부 agentReadWebTabPane 이 한다 —
// 이 어댑터는 그 함수를 브리지의 게이트웨이 인터페이스에 맞춰 넘기기만 한다.
bridgeServer.setWebTabAgentReadGateway({
  read: (input) => agentReadWebTabPane(input),
  navigate: (input) => agentNavigateWebTab(input),
  list: () =>
    Promise.resolve({
      ok: true as const,
      panes: listAgentReadableWebTabs(),
      globalStopActive: globalBrowserAgentSwitch.isSuspended(),
    }),
});

// 브리지(→ drive_search / drive_fetch MCP 도구)가 쓰는 게이트웨이. 창이 없는
// 호출이라 uid 는 매번 "지금 로그인된 실사용자" 로 해석한다 — 로그아웃 상태에선
// null 이 되어 도구가 "연결 안 됨" 으로 정직하게 답한다.
//
// ★이 경로는 **항상 프로젝트 모드**다. MCP 프로세스가 넘긴 projectId
// (MARBLO_PROJECT)의 바인딩 폴더 하위만 보이고, 바인딩이 없으면 아무것도 안
// 보인다 — 에이전트에게 "드라이브 전체" 는 어떤 경우에도 열리지 않는다.
bridgeServer.setDriveGateway({
  search: (projectId, params) =>
    driveSearchFor(currentRealUserUid(), params, {
      mode: "project",
      projectId,
    }),
  fetch: (projectId, fileId) =>
    driveFetchFor(currentRealUserUid(), fileId, { mode: "project", projectId }),
  write: (projectId, params) =>
    driveWriteFor(currentRealUserUid(), params, projectId),
});

bridgeServer.setGoogleWorkspaceGateway({
  gmailSearch: (_projectId, params) =>
    gmailSearchFor(currentRealUserUid(), params),
  gmailFetch: (_projectId, messageId) =>
    gmailFetchFor(currentRealUserUid(), messageId),
  gmailDraft: (_projectId, params) =>
    gmailDraftFor(currentRealUserUid(), params),
  gmailSend: (_projectId, params) => gmailSendFor(currentRealUserUid(), params),
  calendarList: (_projectId, params) =>
    calendarListFor(currentRealUserUid(), params),
  calendarCreate: (_projectId, params) =>
    calendarCreateFor(currentRealUserUid(), params),
  calendarPatch: (_projectId, params) =>
    calendarPatchFor(currentRealUserUid(), params),
  contactsSearch: (_projectId, params) =>
    contactsSearchFor(currentRealUserUid(), params),
});

// ── Notion 커넥터 (읽기 전용, 티켓 gaUx2Cmsw6EN8ymjL2ks) ───────────────────
//
// Drive 와 같은 축 분리다. 인증은 유저 단위(safeStorage 암호화 토큰), 지식
// 바인딩은 프로젝트 단위(DB 또는 페이지 id). MCP 경로는 항상 프로젝트 모드라
// 바인딩 밖 페이지 id 를 fetch 해도 거절한다.

function validNotionUserId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function resolveNotionUserId(value: unknown): string | null {
  if (validNotionUserId(value)) return value;
  return currentRealUserUid();
}

function notionFailure(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error:
      e instanceof Error
        ? e.message
        : "Notion 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  };
}

const NOTION_NOT_CONNECTED = {
  ok: false as const,
  error:
    "Notion 이 연결되어 있지 않습니다. Harness 탭에서 Notion 을 연결해 주세요.",
};

async function notionSearchFor(
  userId: string | null,
  params: NotionSearchParams,
  access: NotionAccess = { mode: "user" },
): Promise<
  | { ok: true; result: NotionSearchResult; scope?: NotionScopeInfo }
  | { ok: false; error: string }
> {
  if (!userId) return NOTION_NOT_CONNECTED;
  try {
    const connector = createUserNotionConnector(safeStorage, userId);
    if (access.mode === "user") {
      return { ok: true, result: await connector.search(params) };
    }
    const planned = await planScopedNotionSearch(
      connector,
      access.projectId,
      access.projectId ? getNotionProjectBinding(access.projectId) : null,
      params,
    );
    return planned;
  } catch (e) {
    return notionFailure(e);
  }
}

async function notionFetchFor(
  userId: string | null,
  pageId: string,
  access: NotionAccess = { mode: "user" },
): Promise<
  { ok: true; document: NotionDocument } | { ok: false; error: string }
> {
  if (!userId) return NOTION_NOT_CONNECTED;
  if (typeof pageId !== "string" || !pageId.trim()) {
    return { ok: false, error: "Notion 페이지 id 가 필요합니다." };
  }
  const trimmed = pageId.trim();
  try {
    const connector = createUserNotionConnector(safeStorage, userId);
    if (access.mode === "project") {
      const allowed = await authorizeScopedNotionFetch(
        connector,
        access.projectId,
        access.projectId ? getNotionProjectBinding(access.projectId) : null,
        trimmed,
      );
      if (!allowed.ok) return allowed;
    }
    return { ok: true, document: await connector.fetchPage(trimmed) };
  } catch (e) {
    return notionFailure(e);
  }
}

async function notionWriteFor(
  userId: string | null,
  params: NotionWriteParams,
  projectId: string | null,
): Promise<
  { ok: true; result: NotionWriteResult } | { ok: false; error: string }
> {
  if (!userId) return NOTION_NOT_CONNECTED;
  if (!projectId) return { ok: false, error: "프로젝트 id 가 필요합니다." };
  try {
    const connector = createUserNotionConnector(safeStorage, userId);
    const binding = getNotionProjectBinding(projectId);
    if (!binding) {
      return {
        ok: false,
        error:
          "이 프로젝트의 Notion 위키가 지정되어 있지 않습니다. Harness 탭에서 Notion DB 또는 페이지를 먼저 선택해 주세요.",
      };
    }
    if (params.pageId?.trim()) {
      const allowed = await authorizeScopedNotionFetch(
        connector,
        projectId,
        binding,
        params.pageId.trim(),
      );
      if (!allowed.ok) return allowed;
      return { ok: true, result: await connector.appendBlocks(params) };
    }
    return {
      ok: true,
      result: await connector.createPage({
        ...params,
        parentDatabaseId:
          binding.objectKind === "database" ? binding.objectId : undefined,
        parentPageId:
          binding.objectKind === "page" ? binding.objectId : undefined,
      }),
    };
  } catch (e) {
    return notionFailure(e);
  }
}

function sanitizeNotionSearchParams(input: unknown): NotionSearchParams {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const object = str(raw.object);
  return {
    query: str(raw.query),
    object: object === "page" || object === "database" ? object : undefined,
    pageSize: typeof raw.pageSize === "number" ? raw.pageSize : undefined,
    startCursor: str(raw.startCursor),
  };
}

ipcMain.handle("notion:connect", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const userId = resolveNotionUserId(raw.userId);
  if (!userId) {
    return {
      ok: false,
      error: "먼저 Marblo 에 로그인한 뒤 Notion 을 연결해 주세요.",
    };
  }
  const accessToken =
    typeof raw.accessToken === "string" ? raw.accessToken : "";
  return connectNotionWithIntegrationToken(safeStorage, userId, {
    accessToken,
    workspaceName: raw.workspaceName,
    workspaceId: raw.workspaceId,
    botId: raw.botId,
  });
});

ipcMain.handle("notion:status", (_event, input: unknown) => {
  const userId = resolveNotionUserId(
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : input,
  );
  if (!userId) return { connected: false };
  return notionStatus(safeStorage, userId);
});

ipcMain.handle("notion:disconnect", (_event, input: unknown) => {
  const userId = resolveNotionUserId(
    input && typeof input === "object"
      ? (input as { userId?: unknown }).userId
      : input,
  );
  if (!userId) return { ok: false, error: "로그인 정보가 없습니다." };
  return disconnectNotion(safeStorage, userId);
});

ipcMain.handle("notion:search", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return notionSearchFor(
    resolveNotionUserId(raw.userId),
    sanitizeNotionSearchParams(raw),
    notionAccessFromInput(raw),
  );
});

ipcMain.handle("notion:fetch", async (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return notionFetchFor(
    resolveNotionUserId(raw.userId),
    typeof raw.pageId === "string" ? raw.pageId : "",
    notionAccessFromInput(raw),
  );
});

function notionProjectIdFrom(raw: Record<string, unknown>): string | null {
  const value = raw.projectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function notionBindingKindFrom(value: unknown): NotionBindingKind | null {
  return value === "database" || value === "page" ? value : null;
}

ipcMain.handle("notion:binding:get", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : { projectId: input };
  const projectId = notionProjectIdFrom(raw);
  if (!projectId) return null;
  return getNotionProjectBinding(projectId);
});

ipcMain.handle("notion:binding:set", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const projectId = notionProjectIdFrom(raw);
  if (!projectId) return { ok: false, error: "프로젝트를 선택해 주세요." };
  if (!isValidNotionObjectId(raw.objectId)) {
    return {
      ok: false,
      error: "Notion 페이지/데이터베이스 id 형식이 올바르지 않습니다.",
    };
  }
  const objectKind = notionBindingKindFrom(raw.objectKind);
  if (!objectKind) {
    return { ok: false, error: "Notion 바인딩 종류를 선택해 주세요." };
  }
  try {
    const binding: NotionProjectBinding = setNotionProjectBinding({
      projectId,
      objectId: raw.objectId,
      objectKind,
      title: typeof raw.title === "string" ? raw.title : undefined,
    });
    return { ok: true, binding };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Notion 바인딩 저장에 실패했습니다.",
    };
  }
});

ipcMain.handle("notion:binding:clear", (_event, input: unknown) => {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : { projectId: input };
  const projectId = notionProjectIdFrom(raw);
  if (!projectId) return { ok: false, error: "프로젝트를 선택해 주세요." };
  const removed = clearNotionProjectBinding(projectId);
  return { ok: true, removed };
});

bridgeServer.setNotionGateway({
  search: (projectId, params) =>
    notionSearchFor(currentRealUserUid(), params, {
      mode: "project",
      projectId,
    }),
  fetch: (projectId, pageId) =>
    notionFetchFor(currentRealUserUid(), pageId, {
      mode: "project",
      projectId,
    }),
  write: (projectId, params) =>
    notionWriteFor(currentRealUserUid(), params, projectId),
});

ipcMain.handle(
  "repo:clone",
  async (
    _event,
    {
      projectId,
      repoUrl,
      parentDir,
      userId,
    }: {
      projectId?: string;
      repoUrl: string;
      parentDir?: string | null;
      userId?: string;
    },
  ) => {
    // ★자격증명 분기 선택 (티켓 ddbN2KvxHZ08rakiVfL0, 설계 §6).
    //
    // App 설치가 바인딩된 프로젝트면 서버에서 1시간짜리 installation 토큰을
    // 받아 쓰고, 그 외 전부는 **지금까지와 똑같이** device 토큰을 쓴다.
    // 어떤 실패도 device 경로를 막지 않는다(G2) — resolveCloneCredential 이
    // 던지지 않고 흡수한다.
    //
    // ★토큰은 여기서 cloneRepo 로만 흘러간다. cloneRepo 는 #1097 이후
    // `GIT_CONFIG_*` 로 헤더만 주입하므로 argv 에도 `.git/config` 에도 남지
    // 않는다. **clone 구현을 새로 만들지 않는다.**
    const credential: CloneCredential = await resolveCloneCredential(
      { projectId, repoUrl },
      {
        getInstallationId: readProjectInstallationId,
        issueInstallationToken: issueRepoInstallationToken,
        getDeviceToken: () =>
          validGitHubOAuthUserId(userId)
            ? getGitHubToken(safeStorage, userId)
            : null,
      },
    );
    const githubToken = credential.kind === "none" ? null : credential.token;
    const result = await cloneRepo({ repoUrl, parentDir, githubToken });
    // 성공 시 이 머신의 연결 단일 진실원(connection-store)에도 기록해
    // Harness 탭/미션 선택이 즉시 연결 상태를 본다. repoUrl/defaultBranch
    // 는 connect() 가 git 으로 자동 채운다. fail-soft — 기록 실패가
    // clone 성공을 가리면 안 된다.
    if (result.ok && result.path && projectId) {
      try {
        await upsertProjectConnection({ projectId, localPath: result.path });
      } catch (err) {
        console.warn("[repo:clone] connection upsert failed (non-fatal):", err);
      }
      // ★커밋 귀속을 clone 직후에 박는다(v2, 티켓 FYIyUuhJbv2cDVjgkRGf).
      //
      // 여기서 박아야 하는 이유: 커밋을 만드는 것은 우리가 아니라 그 폴더에서
      // 도는 **에이전트/사람**이다. push 시점에 고치면 이미 만들어진 커밋의
      // 작성자는 못 고친다. repo-local config 라 전역 설정을 건드리지 않는다.
      //
      // fail-soft — 귀속 실패가 clone 성공을 가리면 안 된다. 대신 조용히
      // 넘기지 않고 로그를 남긴다(조용히 깨지는 게 이 기능의 실패 모드다).
      await applyCommitIdentityForRepo(result.path, userId);
    }
    return result;
  },
);

/**
 * 저장소에 커밋 신원을 박는다 — v2 커밋 귀속의 유일한 진입점.
 *
 * ★이메일은 **GitHub 이 답한 값**만 쓴다. 마블로 계정 이메일을 쓰면 GitHub
 * 계정에 매칭되지 않아 귀속이 조용히 깨진다(github-commit-identity 참조).
 * 그래서 device OAuth 를 한 번도 안 한 사용자에게는 **아무것도 박지 않고**
 * false 를 돌려준다 — 틀린 이메일을 박는 것보다 안 박는 게 낫다.
 */
async function applyCommitIdentityForRepo(
  repoPath: string,
  userId?: string,
): Promise<{ ok: boolean; identity?: CommitIdentity }> {
  const deviceToken = validGitHubOAuthUserId(userId)
    ? getGitHubToken(safeStorage, userId)
    : null;
  if (!deviceToken) {
    console.info(
      "[commitIdentity] GitHub 계정 미연결 — 커밋 귀속을 설정하지 않았다",
    );
    return { ok: false };
  }
  const identity = await fetchCommitIdentity(deviceToken);
  if (!identity) return { ok: false };

  const applied = await applyCommitIdentity(repoPath, identity, (args, opts) =>
    realGitRunner(args, { cwd: opts.cwd, timeoutMs: 15_000 }),
  );
  if (!applied) {
    console.warn("[commitIdentity] git config 쓰기 실패 — 귀속이 안 붙었다");
    return { ok: false };
  }
  // ★이메일을 로그하지 않는다. login 만 남긴다.
  console.info(
    `[commitIdentity] ${identity.login} 로 커밋 귀속 설정${
      identity.usesNoreply ? " (noreply 주소)" : ""
    }`,
  );
  return { ok: true, identity };
}

/**
 * 브랜치 push — 팀원이 GitHub 개별 초대 없이 코드를 올리는 경로 (v2).
 *
 * ★clone 과 **같은 자격증명 게이트**를 쓰고(github-clone-credential), **같은
 * git 실행기·같은 토큰 주입 방식**(#1097 의 `GIT_CONFIG_*`)을 쓴다. 새로 만든
 * 것은 push 고유의 것뿐이다.
 *
 * ★역할 거부는 **폴백하지 않는다.** device 토큰으로 내려가면 화면의 Merge
 * 게이트를 우리 손으로 뚫는 것이다(resolvePushCredential 참조).
 */
ipcMain.handle(
  "repo:push",
  async (
    _event,
    {
      projectId,
      repoPath,
      repoUrl,
      branch,
      userId,
    }: {
      projectId?: string;
      repoPath: string;
      repoUrl: string;
      branch: string;
      userId?: string;
    },
  ) => {
    const safeBranch = normalizeBranchName(branch);
    if (!safeBranch) {
      return {
        ok: false,
        errorKind: "invalid-branch",
        message: "브랜치 이름이 올바르지 않습니다.",
      };
    }
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      return {
        ok: false,
        errorKind: "git",
        message: "저장소 경로를 찾을 수 없습니다.",
      };
    }

    // 커밋 귀속을 한 번 더 맞춰 둔다 — clone 이 아니라 기존 폴더를 연결한
    // 사용자에게는 여기가 첫 기회다. 실패해도 push 는 막지 않는다(이미
    // 만들어진 커밋의 작성자는 어차피 여기서 못 고친다).
    await applyCommitIdentityForRepo(repoPath, userId);

    const credential: PushCredential = await resolvePushCredential(
      { projectId, repoUrl, ref: safeBranch },
      {
        getInstallationId: readProjectInstallationId,
        issueWriteToken: issueRepoInstallationWriteToken,
        getDeviceToken: () =>
          validGitHubOAuthUserId(userId)
            ? getGitHubToken(safeStorage, userId)
            : null,
      },
    );
    console.info(
      `[repo:push] credential decision ${JSON.stringify(
        pushCredentialAuditFields(
          { projectId, repoUrl, ref: safeBranch },
          credential,
        ),
      )}`,
    );

    if (credential.kind === "denied") {
      // ★역할 거부. 토큰을 만들지도, device 로 내려가지도 않는다.
      return { ok: false, errorKind: "denied", message: credential.message };
    }
    if (credential.kind === "unavailable") {
      // ★설치가 있는데 서버 판정이 흔들린 경우다. device 로 우회하지 않고 재시도한다.
      return { ok: false, errorKind: "network", message: credential.message };
    }

    const githubToken = credential.kind === "none" ? null : credential.token;
    return pushBranch({
      repoPath,
      remoteUrl: repoUrl,
      branch: safeBranch,
      githubToken,
    });
  },
);

/**
 * 이 저장소의 커밋 귀속을 (재)설정한다. 화면이 "귀속이 안 붙었습니다" 를
 * 띄우고 사용자가 GitHub 을 연결한 뒤 누르는 버튼용.
 * ★이메일을 렌더러로 돌려주지 않는다 — login 과 noreply 여부만.
 */
ipcMain.handle(
  "repo:setCommitIdentity",
  async (
    _event,
    { repoPath, userId }: { repoPath: string; userId?: string },
  ) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      return { ok: false };
    }
    const r = await applyCommitIdentityForRepo(repoPath, userId);
    return r.ok && r.identity
      ? {
          ok: true,
          login: r.identity.login,
          usesNoreply: r.identity.usesNoreply,
        }
      : { ok: false };
  },
);

// 이 기기의 안정적 식별자를 렌더러에 넘긴다. 프로젝트 폴더 경로를 기기별로
// 저장하려면(티켓 sHyHC9RoutYHDt97UOEm) 렌더러가 자기 machineId 를 알아야
// 한다. 읽기 전용이고 app-state.json 의 기존 값을 그대로 돌려준다.
ipcMain.handle("app:getMachineId", () => getMachineId());

// 디렉터리 존재 확인(읽기 전용). 레거시 단일 folderPath 를 이 기기 칸으로
// 마이그레이션할 때, **그 경로가 실제로 이 기기에 있을 때만** 소유권을
// 주장하기 위해 쓴다 — 같은 OS 를 쓰는 형제 기기(맥미니↔맥북)는 경로 모양
// 으로 구분할 수 없어서, 존재 여부가 유일하게 믿을 수 있는 단서다.
// (티켓 sHyHC9RoutYHDt97UOEm)
ipcMain.handle("fs:pathExists", (_event, targetPath: string) => {
  try {
    return (
      typeof targetPath === "string" &&
      !!targetPath &&
      fs.existsSync(targetPath) &&
      fs.statSync(targetPath).isDirectory()
    );
  } catch {
    return false;
  }
});

ipcMain.handle("fs:watch", (event, rootPath: string) => {
  // Each window gets its own watcher keyed by its webContents id, so opening
  // a folder in window B no longer kills window A's watcher (they used to
  // share a single FsManager.watchers slot).
  const senderId = event.sender.id;
  const token = `win-${senderId}`;
  fsManager.watchDirectory(token, rootPath, (ev, filePath) => {
    // Send only to the watching window — irrelevant fs activity in window B
    // shouldn't trigger reloads in window A.
    sendToOwner(senderId, "fs:change", ev, filePath);
  });
});

ipcMain.handle("fs:selectDirectory", async () => {
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!focusedWin) return null;
  const result = await dialog.showOpenDialog(focusedWin, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// --- 첫 실행 샘플 프로젝트 (티켓 yk8ouW2pS6nGzH272rXy) ---
//
// 폴더 미설정이면 오케스트레이터가 아예 기동되지 않는다(useOrchestratorAutoLaunch
// 는 currentProject.folderPath 를 키로 한다). 그 마지막 관문을 없애려면 "연결할
// 폴더"가 하나 있어야 하는데, 아래 fs:* 뮤테이션은 전부 **이미 알고 있는 rootPath
// 안**으로 제한되어 있어(fsGuard) 새 폴더를 만드는 데 쓸 수 없다. 그래서 시드는
// 이 전용 핸들러 하나로만 일어난다 — 경로는 렌더러가 정하지 않고 main 이
// `<Documents>/Marblo Sample` 로 고정 산출한다(임의 경로 쓰기 차단).
ipcMain.handle("sample:ensure", async (_event, input: unknown) => {
  const locale =
    input &&
    typeof input === "object" &&
    (input as { locale?: unknown }).locale === "en"
      ? "en"
      : "ko";
  const dir = resolveSampleProjectDir({
    documentsDir: (() => {
      try {
        return app.getPath("documents");
      } catch {
        // 일부 리눅스/포터블 환경엔 documents 가 없다 — 홈으로 떨어진다.
        return null;
      }
    })(),
    homeDir: os.homedir(),
  });
  return ensureSampleProject({ dir, locale });
});

// File mutation operations. All paths must be inside rootPath (path-traversal guard).
function fsGuard(rootPath: string, ...targets: string[]) {
  for (const t of targets) {
    if (!fsManager.isInsideRoot(rootPath, t)) {
      throw new Error("경로가 프로젝트 폴더를 벗어났습니다");
    }
  }
}

ipcMain.handle(
  "fs:createFile",
  (_event, { rootPath, filePath }: { rootPath: string; filePath: string }) => {
    fsGuard(rootPath, filePath);
    fsManager.createFile(filePath);
    return { success: true, path: filePath };
  },
);

ipcMain.handle(
  "fs:createDirectory",
  (_event, { rootPath, dirPath }: { rootPath: string; dirPath: string }) => {
    fsGuard(rootPath, dirPath);
    fsManager.createDirectory(dirPath);
    return { success: true, path: dirPath };
  },
);

ipcMain.handle(
  "fs:rename",
  (
    _event,
    {
      rootPath,
      fromPath,
      toPath,
    }: { rootPath: string; fromPath: string; toPath: string },
  ) => {
    fsGuard(rootPath, fromPath, toPath);
    fsManager.rename(fromPath, toPath);
    return { success: true, fromPath, toPath };
  },
);

ipcMain.handle(
  "fs:remove",
  (
    _event,
    { rootPath, targetPath }: { rootPath: string; targetPath: string },
  ) => {
    fsGuard(rootPath, targetPath);
    fsManager.remove(targetPath);
    return { success: true, path: targetPath };
  },
);

ipcMain.handle(
  "fs:copy",
  (
    _event,
    {
      rootPath,
      fromPath,
      toPath,
    }: { rootPath: string; fromPath: string; toPath: string },
  ) => {
    fsGuard(rootPath, fromPath, toPath);
    const finalPath = fsManager.copy(fromPath, toPath);
    return { success: true, fromPath, toPath: finalPath };
  },
);

// Read a file as base64 — used by the Code tab's ImagePreview to render raster
// images (png/jpg/webp/…), whose bytes are meaningless as utf-8 text.
ipcMain.handle(
  "fs:readFileBase64",
  async (
    _event,
    { rootPath, filePath }: { rootPath: string; filePath: string },
  ) => {
    // Containment guard, symmetric with the mutation handlers.
    fsGuard(rootPath, filePath);
    const buf = await fs.promises.readFile(filePath);
    return buf.toString("base64");
  },
);

// Import external OS files (e.g. dragged from Finder) into a project directory.
// srcPaths are arbitrary absolute paths; destDir must live under rootPath
// (fsGuard). Existing names are de-duped with a " copy" suffix rather than
// clobbered. Copies recursively so dropped folders come in whole.
ipcMain.handle(
  "fs:importPaths",
  async (
    _event,
    {
      rootPath,
      destDir,
      srcPaths,
    }: { rootPath: string; destDir: string; srcPaths: string[] },
  ) => {
    fsGuard(rootPath, destDir);
    const imported: string[] = [];
    for (const src of srcPaths) {
      if (!src) continue;
      let dest = path.join(destDir, path.basename(src));
      if (fs.existsSync(dest)) {
        const ext = path.extname(dest);
        const base = path.basename(dest, ext);
        let i = 1;
        do {
          dest = path.join(
            destDir,
            `${base} copy${i > 1 ? ` ${i}` : ""}${ext}`,
          );
          i += 1;
        } while (fs.existsSync(dest));
      }
      await fs.promises.cp(src, dest, { recursive: true, errorOnExist: false });
      imported.push(dest);
    }
    return { success: true, imported };
  },
);

ipcMain.handle("fs:revealInFinder", (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath);
  return { success: true };
});

function makeConnectionCheckItem(
  id: ConnectionCheckItem["id"],
  label: string,
  status: ConnectionCheckStatus,
  detail: string,
): ConnectionCheckItem {
  return { id, label, status, detail };
}

// parseGitHubRepoSlug / repoUrlsMatch 는 connection-store 의 단일 진실원에서
// import 한다(origin↔repoUrl 일치 비교와 동일 로직 재사용).

function runConnectionCheckCommand(
  command: string,
  args: string[],
  cwd: string | undefined,
  timeoutMs = 10_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    };

    try {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        shell: false,
      });
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
        finish(124);
      }, timeoutMs);
      timer.unref?.();
      child.stdout.on("data", (data) => {
        stdout += data.toString();
        if (stdout.length > 12_000) stdout = stdout.slice(-12_000);
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
        if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
      });
      child.on("close", (code) => finish(code ?? 1));
      child.on("error", (err) => {
        stderr = err.message;
        finish(-1);
      });
    } catch (err) {
      stderr = err instanceof Error ? err.message : String(err);
      finish(-1);
    }
  });
}

function parseRepoView(stdout: string): {
  defaultBranch?: string;
  viewerPermission?: string;
} {
  try {
    const parsed = JSON.parse(stdout) as {
      defaultBranchRef?: { name?: string } | null;
      viewerPermission?: string | null;
    };
    return {
      defaultBranch: parsed.defaultBranchRef?.name,
      viewerPermission: parsed.viewerPermission ?? undefined,
    };
  } catch {
    return {};
  }
}

async function checkProjectConnectionHealth(
  projectId: string,
): Promise<ConnectionCheckResult> {
  const checkedAt = Date.now();

  // ★git 이전에 툴체인부터. macOS 는 CLT 라이선스에 동의하지 않으면 모든 git
  // 호출이 xcrun 원문 에러로 죽는다 — 그 상태에서 repo/branch/auth 를 계속
  // 돌려봐야 "repo 접근 확인 실패" 같은 엉뚱한 진단만 쌓인다. 여기서 끊고
  // 실행할 명령 한 줄만 돌려준다 (티켓 nETj7szjEtT5prbYsg1D).
  const toolchain = await probeXcodeClt();
  if (!toolchain.ok && toolchain.message) {
    return {
      checkedAt,
      ok: false,
      items: [
        makeConnectionCheckItem(
          "toolchain",
          "Xcode Command Line Tools",
          "fail",
          toolchain.message,
        ),
        makeConnectionCheckItem(
          "repo",
          "Repo access",
          "warn",
          "git 을 실행할 수 없어 repo 접근을 확인하지 못했습니다. 위 안내를 먼저 처리하세요.",
        ),
        makeConnectionCheckItem(
          "branch",
          "Branch",
          "warn",
          "git 을 실행할 수 없어 브랜치를 확인하지 못했습니다. 위 안내를 먼저 처리하세요.",
        ),
      ],
    };
  }

  const connection = getProjectConnection(projectId);
  if (!connection) {
    return {
      checkedAt,
      ok: false,
      items: [
        makeConnectionCheckItem(
          "repo",
          "Repo access",
          "fail",
          "프로젝트 연결 정보가 없습니다.",
        ),
        makeConnectionCheckItem(
          "branch",
          "Branch",
          "fail",
          "기본 브랜치를 확인할 연결 정보가 없습니다.",
        ),
        makeConnectionCheckItem(
          "issues",
          "Issue read",
          "fail",
          "Issue 조회를 위한 repo 연결 정보가 없습니다.",
        ),
        makeConnectionCheckItem(
          "pullRequest",
          "PR create",
          "fail",
          "PR 권한을 확인할 repo 연결 정보가 없습니다.",
        ),
        makeConnectionCheckItem(
          "auth",
          "Token/auth",
          "fail",
          "GitHub 인증 상태를 확인할 연결 정보가 없습니다.",
        ),
      ],
    };
  }

  const cwd = fs.existsSync(connection.localPath)
    ? connection.localPath
    : undefined;
  const repoSlug = parseGitHubRepoSlug(connection.repoUrl);
  const hasGitHubMcp = connection.availableMcps.some((mcp) =>
    /github/i.test(mcp),
  );
  const items: ConnectionCheckItem[] = [];

  // origin mismatch — 로컬 git origin 이 저장된 repoUrl 과 같은 repo 를
  // 가리키는지 검증. 불일치면 잘못된 repo 에 작업할 위험이므로 fail 로 표시한다.
  if (!cwd) {
    items.push(
      makeConnectionCheckItem(
        "mismatch",
        "Repo match",
        "warn",
        "로컬 경로가 없어 origin 일치 여부를 확인할 수 없습니다.",
      ),
    );
  } else {
    const origin = await runConnectionCheckCommand(
      "git",
      ["remote", "get-url", "origin"],
      cwd,
    );
    const localOrigin = origin.code === 0 ? origin.stdout.trim() : "";
    if (!connection.repoUrl) {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "warn",
          "저장된 repo URL이 없어 로컬 origin과 비교할 수 없습니다.",
        ),
      );
    } else if (!localOrigin) {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "warn",
          "로컬 git origin을 확인하지 못해 일치 여부를 비교할 수 없습니다.",
        ),
      );
    } else if (repoUrlsMatch(localOrigin, connection.repoUrl)) {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "pass",
          `로컬 origin이 저장된 repo와 일치합니다 (${
            parseGitHubRepoSlug(connection.repoUrl) ?? connection.repoUrl
          }).`,
        ),
      );
    } else {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "fail",
          `로컬 origin(${localOrigin})이 저장된 repo URL(${connection.repoUrl})과 다릅니다. 잘못된 repo에 작업할 위험이 있습니다.`,
        ),
      );
    }
  }

  const auth = await runConnectionCheckCommand(
    "gh",
    ["auth", "status", "-h", "github.com"],
    cwd,
  );
  const ghAvailable = auth.code !== -1;
  const ghAuthed = auth.code === 0;
  items.push(
    makeConnectionCheckItem(
      "auth",
      "Token/auth",
      ghAuthed ? "pass" : "fail",
      ghAuthed
        ? hasGitHubMcp
          ? "GitHub 인증과 GitHub MCP 연결 신호를 확인했습니다."
          : "GitHub 인증을 확인했습니다."
        : ghAvailable
          ? "GitHub CLI 인증이 필요합니다. OAuth 화면은 열지 않았습니다."
          : "GitHub CLI를 찾을 수 없습니다. GitHub MCP 또는 gh 인증 경로가 필요합니다.",
    ),
  );

  let repoView:
    | { defaultBranch?: string; viewerPermission?: string }
    | undefined;
  if (repoSlug && ghAuthed) {
    const repo = await runConnectionCheckCommand(
      "gh",
      [
        "repo",
        "view",
        repoSlug,
        "--json",
        "nameWithOwner,defaultBranchRef,viewerPermission",
      ],
      cwd,
    );
    if (repo.code === 0) repoView = parseRepoView(repo.stdout);
    items.push(
      makeConnectionCheckItem(
        "repo",
        "Repo access",
        repo.code === 0 ? "pass" : "fail",
        repo.code === 0
          ? `${repoSlug} 접근 가능`
          : repo.stderr || `${repoSlug} 접근 확인 실패`,
      ),
    );
  } else if (connection.repoUrl) {
    const repo = await runConnectionCheckCommand(
      "git",
      ["ls-remote", "--exit-code", connection.repoUrl, "HEAD"],
      cwd,
    );
    items.push(
      makeConnectionCheckItem(
        "repo",
        "Repo access",
        repo.code === 0 ? "warn" : "fail",
        repo.code === 0
          ? "git remote 접근은 가능하지만 GitHub 인증 점검은 통과하지 못했습니다."
          : repo.stderr || "repo 접근 확인 실패",
      ),
    );
  } else {
    items.push(
      makeConnectionCheckItem(
        "repo",
        "Repo access",
        "fail",
        "repo URL이 연결 정보에 없습니다.",
      ),
    );
  }

  const defaultBranch =
    connection.defaultBranch ?? repoView?.defaultBranch ?? null;
  if (repoSlug && ghAuthed && defaultBranch) {
    const branch = await runConnectionCheckCommand(
      "gh",
      ["api", `repos/${repoSlug}/branches/${defaultBranch}`],
      cwd,
    );
    items.push(
      makeConnectionCheckItem(
        "branch",
        "Branch",
        branch.code === 0 ? "pass" : "fail",
        branch.code === 0
          ? `${defaultBranch} 브랜치 확인`
          : branch.stderr || `${defaultBranch} 브랜치 확인 실패`,
      ),
    );
  } else if (connection.repoUrl && defaultBranch) {
    const branch = await runConnectionCheckCommand(
      "git",
      [
        "ls-remote",
        "--exit-code",
        connection.repoUrl,
        `refs/heads/${defaultBranch}`,
      ],
      cwd,
    );
    items.push(
      makeConnectionCheckItem(
        "branch",
        "Branch",
        branch.code === 0 ? "warn" : "fail",
        branch.code === 0
          ? `${defaultBranch} 브랜치는 확인했지만 GitHub API 인증은 통과하지 못했습니다.`
          : branch.stderr || `${defaultBranch} 브랜치 확인 실패`,
      ),
    );
  } else {
    items.push(
      makeConnectionCheckItem(
        "branch",
        "Branch",
        "fail",
        "기본 브랜치 정보가 없습니다.",
      ),
    );
  }

  if (repoSlug && ghAuthed) {
    const issues = await runConnectionCheckCommand(
      "gh",
      ["issue", "list", "--repo", repoSlug, "--limit", "1", "--json", "number"],
      cwd,
    );
    items.push(
      makeConnectionCheckItem(
        "issues",
        "Issue read",
        issues.code === 0 ? "pass" : "fail",
        issues.code === 0
          ? "Issue 조회 가능"
          : issues.stderr || "Issue 조회 권한 확인 실패",
      ),
    );
  } else {
    items.push(
      makeConnectionCheckItem(
        "issues",
        "Issue read",
        "fail",
        "GitHub 인증이 없어 Issue 조회를 확인하지 못했습니다.",
      ),
    );
  }

  const viewerPermission = repoView?.viewerPermission;
  const canWriteToRepo = ["ADMIN", "MAINTAIN", "WRITE"].includes(
    viewerPermission ?? "",
  );
  const connectionAllowsPr =
    connection.accessMode === "pr" || connection.accessMode === "commit";
  items.push(
    makeConnectionCheckItem(
      "pullRequest",
      "PR create",
      canWriteToRepo && connectionAllowsPr
        ? "pass"
        : canWriteToRepo
          ? "warn"
          : "fail",
      canWriteToRepo && connectionAllowsPr
        ? `PR 생성 가능 (${viewerPermission})`
        : canWriteToRepo
          ? `GitHub 권한은 ${viewerPermission}이지만 connection accessMode가 ${connection.accessMode}입니다.`
          : viewerPermission
            ? `현재 GitHub 권한 ${viewerPermission}으로 PR 생성을 보장할 수 없습니다.`
            : "GitHub repo 권한 정보를 확인하지 못했습니다.",
    ),
  );

  return {
    checkedAt,
    ok: items.every((item) => item.status === "pass"),
    items,
  };
}

// --- Connection IPC Handlers (연동 T1·기반) ---
//
// 프로젝트↔repo 연결의 단일 진실원. T2(Harness 탭)·T3(미션 선택)는 렌더러에서
// `connection:get` 으로 연결 상태를 읽고, electron-side 소비자는 connection-store
// 의 getProjectConnection 을 직접 import 한다. upsert 는 git 메타(repoUrl·default
// branch)를 가능하면 자동 채운다(MCP-first, OAuth UI 없음).

ipcMain.handle("connection:get", (_event, projectId: string) => {
  // 렌더러에는 실시간 availableMcps 를 채워 돌려준다(저장 레코드는 비어 있을 수
  // 있음) — connection-store.withAvailableMcps 가 ~/.claude.json + marblo 로 채움.
  return withAvailableMcps(getProjectConnection(projectId));
});

ipcMain.handle("connection:list", () => {
  return listProjectConnections();
});

ipcMain.handle(
  "connection:upsert",
  async (_event, input: ProjectConnectionInput) => {
    const conn = await upsertProjectConnection(input);
    return withAvailableMcps(conn);
  },
);

ipcMain.handle(
  "connection:touchLastRun",
  (_event, { projectId, at }: { projectId: string; at?: number }) => {
    return touchProjectLastRun(projectId, at);
  },
);

ipcMain.handle("connection:check", (_event, projectId: string) => {
  return checkProjectConnectionHealth(projectId);
});

// 접근모드(쓰기 강도) 설정 = 권한 grant. accessMode 저장 + permissionsState
// 'granted' 승격을 한 번에 처리하고, 갱신된 연결(availableMcps 채움)을 돌려준다.
// 미연결 프로젝트면 setAccessMode 가 null → 그대로 null 반환.
ipcMain.handle(
  "connection:setAccess",
  (
    _event,
    { projectId, accessMode }: { projectId: string; accessMode: AccessMode },
  ) => {
    return withAvailableMcps(setAccessMode(projectId, accessMode));
  },
);

// 연결 해제 — 레코드 삭제. 있었으면 true, 없었으면 false.
ipcMain.handle("connection:remove", (_event, projectId: string) => {
  return removeConnection(projectId);
});

// --- Telegram Channels IPC Handlers (텔레그램 T1·보안 민감) ---
//
// 프론트(T2)가 채널 설정을 읽기/쓰기/상태조회한다. ★쓰기(telegramChannel:set)는
// 로컬 설정 경로 — 이 경로에서만 권한 파일(access.json)이 동기화된다(chmod 600).
// 텔레그램 인바운드(다른 티켓)는 telegram-channels 의 read-only 함수만 import 하며
// 권한을 변경할 수 없다(보안 불변식). chatId 가 비면 enabled 가 false 로 강등되고
// status.canEnable=false 로 노출되어 프론트가 토글을 잠근다.

ipcMain.handle("telegramChannel:get", (_event, projectId: string) => {
  return getTelegramChannelConfig(projectId);
});

ipcMain.handle("telegramChannel:list", () => {
  return listTelegramChannelConfigs();
});

ipcMain.handle("telegramChannel:set", (_event, input: TelegramChannelInput) => {
  // 로컬 설정 경로 — 설정 저장 + access.json 동기화. 합성 상태를 돌려줘
  // 프론트가 토글 잠금/사유(issues)를 즉시 반영하게 한다.
  const status = setTelegramChannelFromLocalSettings(input);
  // 채널 활성/비활성 변화를 폴러에 반영한다(활성 → getUpdates 루프 시작,
  // 비활성 → 정지). syncActiveChannels 는 멱등이라 안전하다.
  telegramPoller.syncActiveChannels();
  // 기기 간 이어짐: 채널 메타(토큰 미포함)를 프로젝트 문서로 push — 다른
  // 기기가 복원할 수 있게 한다. fire-and-forget·fail-soft.
  void pushTelegramChannelMetaOne(input.projectId, getMachineId());
  return status;
});

ipcMain.handle("telegramChannel:status", (_event, projectId: string) => {
  return getTelegramChannelStatus(projectId);
});

/**
 * ★지금 이 봇을 누가 물고 있는가 (티켓 hAzP05kOTxggd8LhZGwT).
 *
 * 이 티켓의 절반은 "사용자가 이 상황을 전혀 볼 수 없었다"였다. 두 맥이 같은
 * 봇을 12초 주기로 서로 강탈하는 동안 남은 흔적은 log.warn 하나였고, 아무도
 * 콘솔을 보지 않는다. 이 창구가 그 사실을 채널 설정 화면까지 실어 나른다.
 * 반환값에는 토큰도 chatId 도 없다 — 기기 이름과 시각, 409 연속 횟수뿐이다.
 */
ipcMain.handle("telegramChannel:contention", (_event, projectId: string) => {
  return telegramPoller.getContention(projectId);
});

ipcMain.handle("telegramChannel:remove", (_event, projectId: string) => {
  const removed = removeTelegramChannel(projectId);
  // 채널 삭제 → 해당 프로젝트 폴러 루프 정지.
  telegramPoller.syncActiveChannels();
  // 원격 메타도 삭제 전파 — 다른 기기에서 제거된 채널이 좀비 복원되는 것 방지.
  void pushTelegramChannelMetaOne(projectId, getMachineId());
  return removed;
});

// --- Slack Channels IPC Handlers (텔레그램 채널 IPC 의 미러) ---
//
// ★텔레그램과 의도적으로 다른 한 가지: `get` 이 없다. 텔레그램은 설정 원문
// (봇 토큰 포함)을 렌더러로 돌려주지만, 여기서는 시크릿을 렌더러 경계 밖으로
// 내보내지 않는다 — 창구는 상태(status)뿐이고 그 안엔 hasBotToken/hasAppToken
// 불리언만 있다. Slack UI 는 아직 없어서 깨질 소비자도 없으니, 노출을 넓히지
// 않는 쪽으로 시작한다.
//
// 쓰기(slackChannel:set)는 로컬 설정 경로 — 이 경로에서만 권한 파일이
// 동기화된다(chmod 600). Slack 인바운드(slack-poller)는 slack-channels 의
// read-only 함수만 import 하며 권한을 변경할 수 없다(보안 불변식).

ipcMain.handle("slackChannel:list", () => {
  return listSlackChannelStatuses();
});

ipcMain.handle("slackChannel:set", (_event, input: SlackChannelInput) => {
  // 로컬 설정 경로 — 설정 저장 + 권한 동기화. 합성 상태를 돌려줘 프론트가
  // 토글 잠금/사유(issues)를 즉시 반영하게 한다.
  const status = setSlackChannelFromLocalSettings(input);
  // 활성/비활성 변화를 Socket Mode 클라이언트에 반영(활성 → 연결, 비활성 →
  // 정지). syncActiveChannels 는 멱등이라 안전하다.
  slackPoller.syncActiveChannels();
  return status;
});

/**
 * 지금 붙들고 있는 "발화가 오케에 닿지 못했다" 목록 (티켓 lcR4OMWCriWIpwbVDwVt).
 *
 * ★브로드캐스트만으로는 부족하다 — 발화는 사용자가 자리를 비운 새벽에도 일어나고,
 * 그때 열려 있는 창이 없으면 이벤트는 아무도 못 받는다. 그래서 사실은 메인이 계속
 * 들고 있고, 렌더러는 패널을 열 때 이걸로 처음부터 다시 읽는다.
 */
ipcMain.handle("assistantTriggers:deliveryFailures", () => {
  return assistantTriggerManager?.deliveryFailures() ?? [];
});

ipcMain.handle("slackChannel:status", (_event, projectId: string) => {
  return getSlackChannelStatus(projectId);
});

ipcMain.handle("slackChannel:remove", (_event, projectId: string) => {
  const removed = removeSlackChannel(projectId);
  slackPoller.syncActiveChannels();
  return removed;
});

// 설정한 자격증명이 실제로 동작하는지 사용자가 저장 직후 확인하는 경로.
// ★probeAppToken:true 는 여기서만 켠다 — 검증 수단인 apps.connections.open 이
// 실제 연결 슬롯을 하나 소비하므로 주기 스윕은 이걸 쓰지 않는다(slack-health).
ipcMain.handle("slackChannel:probe", async (_event, projectId: string) => {
  const status = getSlackChannelStatus(projectId);
  const config = getSlackChannelConfig(projectId);
  if (!config?.botToken) {
    return {
      ok: false,
      botUserId: null,
      teamId: null,
      appTokenOk: false,
      error: "bot token 이 저장돼 있지 않습니다.",
    };
  }
  const health = await probeSlackChannel(config.botToken, config.appToken, {
    probeAppToken: !!config.appToken,
  });
  return { ...health, status, route: slackPoller.getRouteHealth(projectId) };
});

// --- Agent IPC Handlers ---

// Buffer early PTY output so data isn't lost before the renderer's listener is ready.
// While buffering, data is ONLY stored in the buffer (not sent live) to prevent
// duplicates. After replay, the buffer is deleted and data flows live.
// NOTE: ptyBuffers is now shared with BridgeServer (declared above).

/**
 * Helper: register PTY data/exit handlers that buffer-then-live.
 * While ptyBuffers has an entry for `sid`, data is ONLY buffered.
 * After pty:replay deletes the entry, data is sent live via direct IPC.
 *
 * NOTE: We deliberately do NOT batch via setImmediate or time-windows here.
 * Tested batching variants both regressed INP — same-tick coalescing added 1
 * Node tick of latency per chunk and joined chunks made xterm refresh heavier
 * per frame, which raised the next keystroke's inputDelay.
 */
function setupPtyForwarding(sid: string): void {
  // First call for this sid: create the early-output buffer. Subsequent
  // calls (restart reusing the same sid) skip this — the renderer's
  // TerminalView is already mounted and listening live; re-buffering would
  // trap every byte in main.ts.
  if (!drainedSids.has(sid)) {
    ptyBuffers.set(sid, []);
    ptyBufferStartedAt.set(sid, Date.now());
    ptyBufferChars.set(sid, 0);
    ptyBufferTruncated.delete(sid);
  }
  // The retained ring resets on EVERY call — unlike the one-shot buffer above,
  // which is keyed to "has a renderer drained this sid yet". A second call for
  // the same sid means a new PTY process (restart), and the previous process's
  // output is not this one's history.
  resetPtyScrollback(sid);
  const gen = (sidGen.get(sid) ?? 0) + 1;
  sidGen.set(sid, gen);

  ptyManager.onData(sid, (data) => {
    // ★세션 종류 판정은 session-kind.ts 가 정본이다(ticket TaDiWyLNi5ihBnjfVmMs).
    // 종전엔 여기에 `sid.startsWith("agent-")` 가 인라인으로 박혀 있었고, 그래서
    // 오케 PTY(`orch-`)는 어느 분기에도 안 걸린 채 조용히 빠졌다.
    //
    // ★오케를 여기로 끌어오지 않는 것이 맞다: processOutput 은 자기 사용량을
    // 터미널에 찍는 CLI 를 위한 **스크래핑 폴백**이고, claude/codex 오케는
    // 세션 파일이라는 정확한 출처가 있다(trackOrchestratorCostSession). 스크래핑을
    // 겹치면 없는 행을 지어낸다. 여기서는 "오케는 여기가 아니다" 를 명시적으로
    // 남기는 것까지가 이 판정의 역할이다.
    const ptyIdentity = classifyPtySessionId(sid);
    if (ptyIdentity.kind === "agent" && ptyIdentity.costAgentId) {
      costTracker.processOutput(ptyIdentity.costAgentId, data);
    }

    // Retained ring first — it must capture BOTH the pre-drain output and the
    // live stream, since a remount can land at either point in the session.
    pushPtyScrollback(sid, data);

    const buffer = ptyBuffers.get(sid);
    if (buffer) {
      buffer.push(data);
      // Bound the buffer. It only grows unbounded when no terminal is ever
      // mounted (a beginner agent runs headless until the user opens its
      // modal), and a TUI redrawing frames is not cheap in bytes.
      let chars = (ptyBufferChars.get(sid) ?? 0) + data.length;
      if (chars > PTY_BUFFER_MAX_CHARS) {
        while (buffer.length > 1 && chars > PTY_BUFFER_MAX_CHARS / 2) {
          chars -= buffer.shift()!.length;
        }
        if (!ptyBufferTruncated.has(sid)) {
          ptyBufferTruncated.add(sid);
          console.warn(
            `[PTY:BUFFER] ${sid} exceeded ${PTY_BUFFER_MAX_CHARS} buffered chars with no terminal attached — dropped the oldest output`,
          );
        }
      }
      ptyBufferChars.set(sid, chars);
      return;
    }

    // Live mode — route to every owner window. Falls back to mainWindow
    // if no owner is tracked (legacy paths) or all owners have closed.
    sendToPtyOwners(sid, `pty:data:${sid}`, data);
  });

  ptyManager.onExit(sid, (exitCode) => {
    // Stale guard: a newer setupPtyForwarding(sid) replaced us (e.g. via
    // agent restart). Letting the OLD pty's exit run would nuke the NEW
    // pty's ptyOwners/ptyBuffers entries and forward a phantom exit to
    // the renderer mid-restart.
    if (sidGen.get(sid) !== gen) return;
    ptyBuffers.delete(sid);
    forgetPtyBufferBookkeeping(sid);
    // Drop the ring too. A dead PTY must replay as EMPTY so TerminalView's
    // pty:exists probe can tell "session expired" from "alive but silent" —
    // serving history for a corpse would suppress that warning.
    forgetPtyScrollback(sid);
    // Notify every owner BEFORE dropping the ownership record — the process is
    // gone, so all windows showing it need the exit, not just the last one to
    // register.
    sendToPtyOwners(sid, `pty:exit:${sid}`, exitCode);
    ptyOwners.delete(sid);
  });
}

async function resolveLaneLaunchContext(
  taskId: string | undefined,
): Promise<string | undefined> {
  if (!taskId) return undefined;
  try {
    const { app: fbApp, authReady } = getMissionFirebaseApp();
    await authReady;
    const ref = fbDoc(getFirestore(fbApp), "tasks", taskId);
    const snap = await fbGetDoc(ref);
    const rawContext = snap.data()?.contextId;
    if (typeof rawContext !== "string" || !isLaneContextId(rawContext)) {
      return undefined;
    }
    if (rawContext !== "lane") return rawContext;

    const laneContextId = buildLaneContextId(taskId);
    await fbUpdateDoc(ref, { contextId: laneContextId });
    return laneContextId;
  } catch (err) {
    console.warn(
      `[agent:launch] Failed to resolve task context for task=${taskId}:`,
      err,
    );
    return undefined;
  }
}

/**
 * 퀵레인 모델 셀렉터가 그릴 카탈로그 — **레지스트리 파생 + 이 프로세스의 env 판정**.
 *
 * 렌더러가 직접 만들 수 없는 값이 둘이라 IPC 로 내린다:
 *   (1) 모델 사실 — `electron/model-registry.ts` 는 `src/` 에서 import 할 수 없다
 *       (경계 규약, `src/lib/rootPathScope.ts`). 종전 오케 셀렉터는 그래서 미러
 *       배열 + 대조 테스트로 버텼는데, 여기는 어차피 (2) 때문에 IPC 가 필요하므로
 *       목록까지 같은 채널로 내려 **미러 자체를 없앤다**.
 *   (2) 벤더 크레덴셜 존재 여부 — `process.env`(= v3/.env dotenv 단일소스)는 메인
 *       프로세스에만 있다.
 *
 * ★값은 절대 내려보내지 않는다. 내려가는 것은 키 **이름**과 boolean 뿐이다
 *   (model-registry 상단 규율 + 스킬의 시크릿 출력 금지).
 */
ipcMain.handle("models:quickLaneCatalog", () => {
  return quickLaneVendorCatalog().map((group) => {
    const missingEnvKeys = group.requiredEnvKeys.filter(
      (key) => !(process.env[key] ?? "").trim(),
    );
    return {
      ...group,
      missingEnvKeys,
      // 네이티브 벤더는 requiredEnvKeys 가 비어 있어 항상 available=true 다
      // (CLI 로그인 여부는 별개 축이고 스폰 직전 checkSpawnAuthGate 가 본다).
      available: missingEnvKeys.length === 0,
    };
  });
});

/**
 * 오케 모델 셀렉터 카탈로그 — **레지스트리 파생 목록 + 이 프로세스의 벤더 판정**.
 *
 * `models:quickLaneCatalog` 과 같은 분업이다: 목록은 순수 모듈이 만들고
 * (`*OrchestratorChoices`), 시크릿·잔액을 봐야 답할 수 있는 축만 여기서 얹는다.
 * `selectorEligible` 이 시크릿을 안 읽는 순수함수인 것은 우연이 아니라 "영구 저장
 * 되는 기본값" 결정의 구현이라(`orchestratorSelectorEligible` 주석) 그 성질을
 * 유지한 채 판정만 main 이 붙여 내린다.
 *
 * ★값은 내려가지 않는다 — 금액·통화·상태·키 **이름**뿐이다.
 * ★런타임 게이트가 없는 칸(claude/codex/grok 네이티브 전부)은 `gate` 가 undefined 라
 *   종전 목록과 의미가 완전히 같다. 벤더 API 도 그 칸들 때문에는 한 번도 안 맞는다.
 */
ipcMain.handle("models:orchestratorCatalog", async () => {
  const choices = [
    ...claudeOrchestratorChoices(),
    ...codexOrchestratorChoices(),
    ...grokOrchestratorChoices(),
  ];
  // 벤더당 한 번만 조회한다(같은 벤더 칸이 둘 이상이다 — flash/pro). 조회 자체도
  // `getVendorBalance` 의 TTL 캐시 + in-flight 접기를 그대로 탄다.
  const verdicts = new Map<
    string,
    Awaited<ReturnType<typeof decideOrchestratorVendorGate>>
  >();
  for (const choice of choices) {
    if (!choice.runtimeGated || !choice.vendor) continue;
    if (verdicts.has(choice.vendor)) continue;
    const balance = await getVendorBalance(choice.vendor);
    verdicts.set(
      choice.vendor,
      decideOrchestratorVendorGate({
        vendor: choice.vendor,
        vendorLabel: choice.vendorLabel,
        balance,
        requiredEnvKeys: choice.requiredEnvKeys,
      }),
    );
  }
  return choices.map((choice) => {
    const gate = choice.vendor ? verdicts.get(choice.vendor) : undefined;
    return { ...choice, ...(gate ? { gate } : {}) };
  });
});

/**
 * 사용량 탭 상단 **모델 정보표**(단가 · 개략 SWE-bench · 컨텍스트).
 *
 * quickLaneCatalog 과 같은 이유로 IPC 다 — 렌더러는 `electron/model-registry.ts`
 * 를 import 할 수 없다. 다만 이쪽엔 `process.env` 판정이 전혀 없다: 순수
 * 레지스트리 + 두 참조표(컨텍스트·벤치)의 조인이고, 조립 로직 전부가
 * `model-fact-sheet.ts` 에 있어 여기는 그대로 흘리기만 한다(시크릿·env 값은 한
 * 바이트도 지나가지 않는다).
 */
ipcMain.handle("models:factSheet", () => modelFactSheetPayload());

/**
 * 사용량 탭 **우리 자체 실측**(SWE-bench, our-measured).
 *
 * ★위 `models:factSheet` 과 **채널이 다르고 소스도 다르다**. 같은 응답에 합치고
 * 싶은 유혹이 있지만(둘 다 "모델 성능" 이니까), 합치는 순간 화면에서 두 숫자를
 * 한 표에 놓지 않을 이유가 사라진다 — 벤더 발표치와 우리 실측치는 실행환경이
 * 달라 뺄셈이 성립하지 않는다(`model-bench-ours.ts` 상단 §Docker). 채널을 갈라
 * 두면 "섞지 않는다" 가 규율이 아니라 **구조**가 된다.
 *
 * factSheet 과 마찬가지로 순수 상수 파생이고 env·시크릿은 한 바이트도 지나가지
 * 않는다.
 */
ipcMain.handle("models:ourBench", () => ourBenchPayload());

ipcMain.handle(
  "agent:launch",
  async (
    event,
    { agent, cwd, initialPrompt, resumeSessionId, projectId, taskId, modelPin },
  ) => {
    // 명시 모델 핀(`<modelId>[@<effort>]`). 퀵레인 모델 셀렉터가 보내는 축이다.
    //
    // ★해석은 `resolveModelPin` 이 한다 — dispatch_task(model=…) 와 **같은 함수**라
    // claude 버전가드(미검증 CLI → 안전 폴백)와 effort 검증이 자동으로 따라온다.
    // 하네스가 어긋난 핀(예: agent.model="claude" 인데 modelPin="gpt-5.5")은
    // 버린다 — claude CLI 에 `--model gpt-5.5` 가 붙으면 spawn 이 깨진다.
    //
    // ★게이트보다 **먼저** 해석한다: env-swap 벤더(GLM/MiniMax/Kimi)로 뜨는 스폰의
    // 인증 축은 Anthropic 계정이 아니라 벤더 크레덴셜이고, 그 판정에 이 핀이 필요하다.
    // ★로컬(Ollama) 핀은 레지스트리에 **런타임 등록**돼 있어야 해석된다 — 앱
    // 재시작 후 첫 launch 가 UI(스토어/모달)를 안 거쳤을 수 있으므로, 스폰 직전에
    // `ollama list` 실측을 한 번 동기화한다(10초 캐시, 실패해도 스폰은 계속).
    if (agent.model === "local" && modelPin) {
      try {
        await syncInstalledLocalModels();
      } catch (err) {
        console.warn(
          "[agent:launch] 로컬 모델 동기화 실패(핀 미해석 가능):",
          err,
        );
      }
    }
    const pin = modelPin ? resolveModelPin(String(modelPin)) : undefined;
    const pinApplies =
      pin?.harness === agent.model ||
      // ★local 에이전트 예외: 로컬(Ollama) 행은 env-swap 이라 하네스가 "claude"
      //   로 접힌다(harnessForLaunch 와 같은 접힘). 벤더가 local 인 행에 한해서만
      //   허용한다 — 다른 벤더의 claude 행이 local 에이전트로 새면 우리 Anthropic
      //   쿼터가 "로컬" 이라는 이름으로 타는 실패모드라 그대로 막는다.
      (agent.model === "local" &&
        pin?.harness === "claude" &&
        pin?.vendor === "local");
    if (pin && !pinApplies) {
      console.warn("[agent:launch] 모델 핀이 하네스와 어긋나 무시", {
        agent: agent.name,
        agentModel: agent.model,
        modelPin,
        pinHarness: pin.harness,
      });
    }
    // 게이트에 넘기는 구체 모델 id — `getLaunchConfig` 가 `applyVendorEnv` 에 넘기는
    // 값과 **같은 식**이다(claudeModel ?? codexModel ?? nativeModel). 두 곳이 갈리면
    // "게이트는 통과했는데 스폰은 다른 벤더" 라는 어긋남이 생긴다(버전가드가 핀을
    // 폴백시킨 경우까지 포함해 같은 값을 본다).
    const gatePinnedModelId = pinApplies
      ? (pin?.claudeModel ?? pin?.codexModel ?? pin?.nativeModel)
      : undefined;

    // Pre-spawn auth gate (claude/codex/grok). Block an unauthenticated spawn
    // before any worktree/PTY side effects so the CLI never boots into its login
    // prompt. Ungated models (gemini/agy/custom) pass through. Resume launches
    // are gated too — a lapsed login should still surface, not hang.
    const agentGate = await checkSpawnAuthGate(
      agent.model,
      gatePinnedModelId,
      "agent_launch",
    );
    if (!agentGate.ok) {
      console.warn(
        `[agent:launch] Blocked "${agent.name}" — ${
          agentGate.vendor ?? agentGate.model
        } ${agentGate.reason} (action: ${agentGate.action})`,
      );
      return {
        id: "",
        ptySessionId: "",
        status: "blocked",
        needsAuth: {
          // env-swap 벤더 차단이면 사용자가 손봐야 하는 축은 CLI 로그인이 아니라
          // 그 벤더의 키다 — 그 사실이 그대로 보이게 벤더 id 를 앞세운다.
          model: agentGate.vendor ?? agentGate.model ?? agent.model,
          action: agentGate.action ?? "",
          installed: agentGate.installed,
        },
      };
    }

    let launchCwd = cwd;
    try {
      const prep = await worktreeCoordinator.prepare({
        projectId,
        taskId,
        title: agent.name,
        repoRoot: cwd,
        requestedCwd: cwd,
      });
      launchCwd = prep.cwd;
    } catch (err) {
      console.error("[agent:launch] worktree prepare failed:", err);
      launchCwd = cwd;
    }

    // Resolve 'latest' to the actual session ID for this specific agent
    let resolvedSessionId = resumeSessionId;
    if (resumeSessionId === "latest") {
      if (agent.model === "antigravity") {
        // agy 는 별도 매핑 파일에 concrete UUID 가 있으면 그걸 우선 사용
        // (사용자 본인 터미널 작업의 latest 를 잘못 잡지 않도록). 없으면
        // 'latest' 그대로 통과시켜 buildCLICommand 가 --continue 로 폴백.
        const uuid = getAgyConversationId(agent.id);
        resolvedSessionId = uuid ?? "latest";
        console.log(
          `[agent:launch] agy resolve 'latest' for "${agent.name}" → ${resolvedSessionId}`,
        );
      } else if (
        agent.model === "gpt" ||
        agent.model === "gemini" ||
        agent.model === "grok"
      ) {
        // Codex/Gemini/Grok sessions live in this agent's isolated home, NOT in
        // ~/.claude — so the Claude resolver below must not run for them.
        // It matches on agentId/label, so an agent that once ran as Claude
        // and was switched to Codex still has a Claude label bearing its id;
        // resolving it here would emit `codex resume <claude-uuid>`, which
        // exits 1 ("No saved session found with ID ..."). Grok is identical:
        // `grok --resume <claude-uuid>` misses locally, falls through to the
        // remote session registry, 404s and exits. Pass the native "latest"
        // sentinel instead (grok maps it to --continue), and only when a
        // session actually exists — grok's sessions are cwd-keyed, so the
        // launch cwd narrows the check.
        resolvedSessionId = agentManager
          .getConfigGenerator()
          .hasSavedSession(agent.id, agent.model, launchCwd)
          ? "latest"
          : "new";
        console.log(
          `[agent:launch] Resolved 'latest' for "${agent.name}" (${agent.model}) → ${resolvedSessionId}`,
        );
      } else {
        // Stateless file-IO — any orchestrator instance reads the same on-disk
        // session metadata, so we don't need a project-specific instance here.
        const resolved = getAnyOrchestrator().resolveSessionId(
          launchCwd,
          "latest",
          agent.name,
          agent.id,
        );
        resolvedSessionId = resolved ?? "new";
        console.log(
          `[agent:launch] Resolved 'latest' for "${agent.name}" → ${resolvedSessionId}`,
        );
      }
    }

    const senderId = event.sender.id;
    const laneContextId = await resolveLaneLaunchContext(taskId);
    const effectiveInitialPrompt =
      laneContextId && taskId
        ? withCompletionFooter(initialPrompt || "", taskId)
        : initialPrompt;

    // 모델 핀은 게이트보다 먼저 해석했다(위 `pin` / `pinApplies`).
    const instance = agentManager.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      ...(pinApplies
        ? {
            claudeModelOverride: pin?.claudeModel,
            codexModelOverride: pin?.codexModel,
            codexEffortOverride: pin?.codexEffort,
            nativeModelOverride: pin?.nativeModel,
          }
        : {}),
      cwd: launchCwd,
      initialPrompt: effectiveInitialPrompt,
      resumeSessionId: resolvedSessionId,
      projectId,
      currentTaskId: taskId ?? agent.currentTaskId ?? null,
      contextId: laneContextId,
      onPtyReady: (sid) => {
        // Tag agent PTY with owner window so output flows back to the
        // launching window only.
        addPtyOwner(sid, senderId);
        setupPtyForwarding(sid);
      },
    });

    return {
      id: instance.id,
      ptySessionId: instance.ptySessionId,
      status: instance.status,
      command: instance.command,
      args: instance.launchConfig?.args || [],
      // UI 에서 띄운 에이전트(Agents 탭 / 카드 ▶ Start / Lanes)는 agent:spawned
      // 훅을 타지 않으므로 여기서 구체 모델을 돌려줘 호출자가 doc 에 스탬프한다.
      // launch() 반환 뒤라 조회 경로가 유효하다.
      //
      // 이 경로는 난도를 넘기지 않아(=기본 모델 상속) argv 근거가 없는 경우가
      // 많다 — 그때는 직전 세션의 과금 관측이 유일한 모델 근거이고, 그것도
      // 없으면 undefined 로 남는다(지어내지 않는다).
      spawnedModel: formatModelAtEffort(
        agentManager.resolveConcreteModel(instance.id),
      ),
    };
  },
);

// Renderer calls this after TerminalView mounts to drain any buffered early output.
// Switches to live mode immediately — subsequent PTY data is sent live via webContents.send.
// (StrictMode dev double-mount is handled by the renderer's `disposed` flag + cleared replay timer.)
ipcMain.handle("pty:replay", (_event, { id }: { id: string }) => {
  const buffer = ptyBuffers.get(id);
  console.log(
    `[PTY:REPLAY] id=${id}, drained ${buffer?.length ?? 0} chunks → live mode`,
  );
  // Mark live regardless of buffer presence — second replay call for the
  // same sid (StrictMode dev double-mount, or a stale call) shouldn't undo
  // the drained flag. Future setupPtyForwarding calls for this sid skip
  // re-buffering so restart output flows straight through.
  drainedSids.add(id);

  // Orchestrator sids serve the retained ring instead, on EVERY mount. It is a
  // superset of the one-shot buffer (both are fed from the same onData), so
  // this is not "buffer + ring" — it is the same bytes from the copy that
  // survives. The ring is deliberately NOT deleted here: the next remount
  // (mode switch) has to be able to redraw the session too.
  const ring = ptyScrollback.get(id);
  if (ring) {
    ptyBuffers.delete(id);
    forgetPtyBufferBookkeeping(id);
    if (ring.length === 0) return [];
    // Joined into ONE string, unlike the buffer path above. A full ring is
    // thousands of chunks, and this replay now runs on every mount rather than
    // once per session — collapsing/expanding the panel remounts too. Sending
    // them individually pays a structured clone per chunk across IPC and then
    // one `terminal.write` per chunk in the renderer; one string is the same
    // bytes for a fraction of both. (xterm time-slices a large write, so this
    // does not block the frame.)
    const joined = ring.join("");
    return ptyScrollbackTruncated.has(id)
      ? [`\x1b[2J\x1b[H${joined}`]
      : [joined];
  }

  if (!buffer) {
    forgetPtyBufferBookkeeping(id);
    return [];
  }
  // A truncated buffer starts mid-stream, so its first surviving bytes can be a
  // fragment addressed at wherever the cursor happened to be. Start the replay
  // from a cleared screen; TerminalView follows it with a PTY resize nudge,
  // which makes an alt-screen TUI repaint the frame in full anyway.
  const data = ptyBufferTruncated.has(id)
    ? ["\x1b[2J\x1b[H", ...buffer]
    : [...buffer];
  ptyBuffers.delete(id);
  forgetPtyBufferBookkeeping(id);
  return data;
});

ipcMain.handle("agent:stop", (_event, agentId: string) => {
  agentManager.stop(agentId);
});

ipcMain.handle("agent:restart", (event, agentId: string) => {
  const instance = agentManager.restart(agentId);
  if (instance) {
    // Update PTY owner mapping to the requesting window. The agent's stored
    // onPtyReady (called from agentManager.restart → launch) already runs
    // setupPtyForwarding(sid) which attaches an onData listener and tags
    // ptyOwners; we just refresh the owner here in case the restart was
    // triggered from a different window than the initial launch.
    //
    // DO NOT call ptyManager.onData again — node-pty's onData is add-only,
    // so the previous (buggy) code stacked TWO listeners onto the same
    // fresh PTY. Every chunk fired both listeners → renderer received each
    // pty:data event twice → terminal.write twice → the whole chat + input
    // box appeared duplicated. Fixed in <this commit>.
    addPtyOwner(instance.ptySessionId, event.sender.id);
  }
  return instance
    ? {
        id: instance.id,
        ptySessionId: instance.ptySessionId,
        status: instance.status,
        spawnedModel: formatModelAtEffort(
          agentManager.resolveConcreteModel(instance.id),
        ),
      }
    : null;
});

ipcMain.handle("agent:status", (_event, agentId: string) => {
  return agentManager.getStatus(agentId);
});

ipcMain.handle("agent:list", (event, projectId?: string) => {
  // Prefer explicit projectId from the renderer; fall back to the project
  // registered for this window. If neither, return everything (single-window
  // legacy behavior).
  const scope = projectId || getProjectForSender(event.sender.id);
  // AgentInstance carries non-serializable fields (onPtyReady callback,
  // restart/heartbeat Timer handles, launchConfig). Map each to a plain
  // object so structuredClone — used by Electron IPC to copy the return
  // value across the process boundary — doesn't throw "An object could not
  // be cloned". (regression: this handler returned raw instances.)
  return agentManager.listAgentsByProject(scope).map(serializeAgent);
});

// ★멀티에이전트 동시성 조회(티켓 pWSnJeQN). 렌더러가 "티켓이 방금 DONE 이 됐다"
// 를 관측한 순간 이 값을 읽어 '동시 2대+ 에서의 성공' 을 판정한다.
//
// 왜 렌더러가 자기 스토어로 세지 않나: agents 스토어는 Firestore 문서 기반이라
// **선택된 프로젝트로 스코프**되고 죽은 문서가 남을 수 있다. 살아 있는 PTY 의
// 진실은 메인의 AgentManager 뿐이고, KPI 가 묻는 것은 "이 사람이 2대를 동시에
// 굴렸나"(설치 축)라 프로젝트로 나누면 안 된다. 개수만 돌려준다 — id·이름 없음.
ipcMain.handle("agent:concurrency", () => agentManager.getConcurrency());

// Renderer registers its current project so we can scope events
// (agent:spawned, agent:statusChanged, etc.) to the right window in
// multi-window mode.
ipcMain.handle("window:registerProject", (event, projectId: string) => {
  if (typeof projectId !== "string" || projectId.length === 0) {
    windowProjects.delete(event.sender.id);
    return;
  }
  windowProjects.set(event.sender.id, projectId);
});

// Persist this window's folder/project so it can reconnect after a renderer
// reload (e.g. macOS sleep/wake discards a background window's renderer).
// Only non-empty fields are merged in — a transient null during reload must
// NOT wipe the saved state (that's the race that left woken windows on the
// folder picker). Cleared only when the window closes.
ipcMain.handle(
  "window:registerRestore",
  (event, state: { uid?: unknown; rootPath?: string; projectId?: string }) => {
    if (!isValidAccountUid(state?.uid) || state.uid !== activeAccountUid) {
      windowRestore.delete(event.sender.id);
      persistWindowSession();
      return;
    }
    const next = { ...(windowRestore.get(event.sender.id) ?? {}) };
    next.uid = state.uid;
    if (typeof state?.rootPath === "string" && state.rootPath) {
      next.rootPath = state.rootPath;
    }
    if (typeof state?.projectId === "string" && state.projectId) {
      next.projectId = state.projectId;
    }
    windowRestore.set(event.sender.id, next);
    // Keep the on-disk multi-window session current so a full restart reopens
    // every project window (not just the last-touched one).
    persistWindowSession();
  },
);

ipcMain.handle("window:getRestoreState", (event, input?: { uid?: unknown }) => {
  const uid = isValidAccountUid(input?.uid) ? input.uid : null;
  const state = windowRestore.get(event.sender.id);
  if (!uid || uid !== activeAccountUid || state?.uid !== uid) return {};
  return state;
});

// Pop a tab (Board/Code) out into its own window. The new window inherits the
// requesting window's folder/project (from its restore record, with the live
// project registration as a fallback) so it opens on the same project.
ipcMain.handle("window:popOutTab", (event, view: DetachedView) => {
  if (view !== "board" && view !== "code" && view !== "history")
    return { success: false };
  const senderId = event.sender.id;
  const restore = windowRestore.get(senderId) ?? {};
  const seed = {
    rootPath: restore.rootPath,
    projectId: restore.projectId ?? windowProjects.get(senderId),
  };
  createDetachedWindow(view, seed);
  return { success: true };
});

ipcMain.handle("browserPane:attach", (event, input: unknown) => {
  const raw = input as {
    paneId?: unknown;
    url?: unknown;
    attachRequestedAt?: unknown;
  } | null;
  const paneId = parseBrowserPaneId(raw?.paneId);
  const url = parseBrowserPaneUrl(raw?.url ?? "about:blank");
  if (!paneId || !url) {
    return { ok: false, error: "Invalid browser pane request." };
  }
  const attachRequestedAt =
    typeof raw?.attachRequestedAt === "number"
      ? raw.attachRequestedAt
      : undefined;

  const key = browserPaneKey(event.sender.id, paneId);
  const existing = browserPaneRecords.get(key);
  const requestedDecision = classifyInAppBrowserNavigation(url);
  const initialUrl =
    requestedDecision.action === "external" ? "about:blank" : url;
  const record =
    existing ??
    createBrowserPaneRecord(
      event.sender,
      paneId,
      initialUrl,
      attachRequestedAt,
    );
  if (!record)
    return { ok: false, error: "No owning window for browser pane." };

  if (requestedDecision.action === "external") {
    handleBrowserPaneExternalNavigation(record, url, requestedDecision.reason);
  } else if (record.currentUrl !== url) {
    if (url === "about:blank") {
      loadBrowserPaneBlank(record);
    } else {
      record.currentUrl = url;
      record.notice = undefined;
      void record.view.webContents.loadURL(url).catch((err: unknown) => {
        record.notice = {
          code: "load-failed",
          message: err instanceof Error ? err.message : "Failed to load URL.",
        };
        sendBrowserPaneState(record);
      });
    }
  }
  return { ok: true, state: toBrowserPaneState(record) };
});

ipcMain.handle("browserPane:navigate", (event, input: unknown) => {
  const raw = input as { paneId?: unknown; url?: unknown } | null;
  const record = findBrowserPaneRecord(event.sender.id, raw?.paneId);
  const url = parseBrowserPaneUrl(raw?.url);
  if (!record || !url) {
    return { ok: false, error: "Invalid browser navigation request." };
  }

  const decision = classifyInAppBrowserNavigation(url);
  if (decision.action === "external") {
    handleBrowserPaneExternalNavigation(record, url, decision.reason);
    return { ok: true, state: toBrowserPaneState(record) };
  }
  if (decision.action === "deny") {
    record.notice = {
      code: "blocked-url",
      message: "Marblo blocked this URL scheme inside the browser tab.",
    };
    sendBrowserPaneState(record);
    return { ok: false, error: record.notice.message };
  }

  record.currentUrl = url;
  record.notice = undefined;
  if (url === "about:blank") {
    loadBrowserPaneBlank(record);
  } else {
    void record.view.webContents.loadURL(url).catch((err: unknown) => {
      record.isLoading = false;
      record.notice = {
        code: "load-failed",
        message: err instanceof Error ? err.message : "Failed to load URL.",
      };
      sendBrowserPaneState(record);
    });
  }
  return { ok: true, state: toBrowserPaneState(record) };
});

ipcMain.handle("browserPane:reload", (event, input: unknown) => {
  const raw = input as { paneId?: unknown } | null;
  const record = findBrowserPaneRecord(event.sender.id, raw?.paneId);
  if (!record) return { ok: false, error: "Unknown browser pane." };
  if (record.currentUrl !== "about:blank") record.view.webContents.reload();
  return { ok: true, state: toBrowserPaneState(record) };
});

ipcMain.handle("browserPane:openExternal", async (_event, input: unknown) => {
  const raw = input as { url?: unknown } | null;
  if (typeof raw?.url !== "string") {
    return { ok: false, error: "Invalid external URL." };
  }
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return { ok: false, error: "Invalid external URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Unsupported external URL scheme." };
  }
  try {
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not open the system browser." };
  }
});

ipcMain.handle("browserPane:setBounds", (event, input: unknown) => {
  const raw = input as {
    paneId?: unknown;
    visible?: unknown;
    bounds?: unknown;
    windowOrigin?: unknown;
  } | null;
  const record = findBrowserPaneRecord(event.sender.id, raw?.paneId);
  if (!record) return { ok: false, error: "Unknown browser pane." };
  const visible = raw?.visible === true;
  const containerRect = parseBrowserPaneBounds(raw?.bounds);
  const windowOrigin = parseBrowserPaneWindowOrigin(raw?.windowOrigin);
  const bounds =
    containerRect && windowOrigin
      ? browserPaneBoundsFromContainerRect(
          containerRect,
          windowOrigin,
          event.sender.getZoomFactor(),
        )
      : undefined;
  setBrowserPaneVisible(record, visible, bounds ?? undefined);
  return { ok: true };
});

ipcMain.handle("browserPane:release", (event, input: unknown) => {
  const raw = input as { paneId?: unknown } | null;
  const record = findBrowserPaneRecord(event.sender.id, raw?.paneId);
  if (!record) return { ok: true };
  cleanupBrowserPaneRecord(record);
  return { ok: true };
});

ipcMain.handle("browserPane:registerOpenTarget", (event, enabled: unknown) => {
  if (enabled === true) {
    browserPaneOpenTargets.add(event.sender.id);
    registerBrowserPaneOwnerCleanup(event.sender);
  } else {
    browserPaneOpenTargets.delete(event.sender.id);
    browserPaneOpenUrlDelivery.cancelForSender(event.sender.id);
  }
  return { ok: true };
});

// Renderer's ack for browserPane:openUrl — see BrowserPaneOpenUrlDelivery.
// One-way `send`, so this is `ipcMain.on`, not `.handle`.
ipcMain.on("browserPane:openUrl:ack", (event, requestId: unknown) => {
  if (typeof requestId !== "string") return;
  browserPaneOpenUrlDelivery.acknowledge(event.sender.id, requestId);
});

// ── Stage 1 agent web-tab read surface (ticket FQ7nshXHjDWOvD0WWUVV) ──────
// Read-only observation + live owner visibility + a global stop. Deliberately
// kept in its own block, separate from the pane lifecycle above, so it never
// has to touch `BrowserPaneRecord`/`BrowserPaneState` — see
// docs/wiki/20-constraints/browser-session-approval-boundary.md for why the
// design stays out of that surface's own read/write plumbing.

/** Per-pane owner grant. Keyed like `browserPaneRecords` (browserPaneKey) so
 * a grant is scoped to one pane instance, never the whole partition — see
 * design note 2 in browser-pane-agent-read-policy.ts. Left unpruned on pane
 * teardown on purpose: a stale key is inert (checked against
 * `browserPaneRecords` at read time) and bounded by panes-ever-opened in one
 * run, which is not worth a second cleanup hook next to the pane lifecycle
 * code this block deliberately avoids touching. */
const agentReadGrantedPanes = new Set<string>();
const globalBrowserAgentSwitch = new GlobalBrowserAccessSwitch();
const agentReadRateLimiter = new AgentReadRateLimiter();
// Navigation has its own budget so a successful "go → read" loop is not
// self-denied by the read pane's cooldown, while both operations still use
// the same conservative limits and the same global stop.
const agentNavigationRateLimiter = new AgentReadRateLimiter();
const AGENT_NAVIGATION_PARTITION = "temp:marblo-agent-browser";

function findBrowserPaneRecordByPaneId(
  paneId: string,
): BrowserPaneRecord | null {
  for (const record of browserPaneRecords.values()) {
    if (record.paneId === paneId) return record;
  }
  return null;
}

/** Only panes the owner has granted — an ungranted tab is invisible to
 * `web_tab_list`, not merely unreadable, so discovery can't leak what web
 * tabs are open. */
function listAgentReadableWebTabs(): Array<{
  paneId: string;
  url: string;
  title: string;
}> {
  const result: Array<{ paneId: string; url: string; title: string }> = [];
  for (const record of browserPaneRecords.values()) {
    const key = browserPaneKey(record.ownerWebContentsId, record.paneId);
    if (!agentReadGrantedPanes.has(key)) continue;
    result.push({
      paneId: record.paneId,
      url: record.currentUrl,
      title: record.title,
    });
  }
  return result;
}

export interface AgentReadActivityEvent {
  agentId: string;
  ticketId?: string;
  paneId: string;
  url: string;
  status: "reading" | "navigating" | "done" | "blocked" | "aborted";
  reason?: string;
  at: number;
  /** Only set on a read's "done" event, so the owner can see what the agent
   * actually pulled off the page without opening the pane themselves — the
   * previous surface only broadcast the URL, never the extracted content. */
  title?: string;
  textPreview?: string;
  redacted?: boolean;
}

/** Pushes to every open window, not just the pane's owner — the whole point
 * of design doc §B is that the owner sees this regardless of which window's
 * Web tab an agent is reading. */
function broadcastAgentReadActivity(event: AgentReadActivityEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("browserPane:agentReadActivity", event);
    }
  }
}

function agentReadDenialMessage(
  reason: AgentReadDenyReason | undefined,
): string {
  switch (reason) {
    case "pane-not-found":
      return "That web tab isn't open.";
    case "global-stop":
      return "The owner has stopped all agent browser access.";
    case "not-granted":
      return "The owner hasn't allowed agent reads on this tab yet.";
    case "rate-limited":
      return "Reading too fast — slow down and retry shortly.";
    case "sensitive-navigation":
      return "This page is a sign-in/payment page and can't be read.";
    default:
      return "Read denied.";
  }
}

function agentNavigationDenialMessage(reason: string | undefined): string {
  switch (reason) {
    case "global-stop":
      return "The owner has stopped all agent browser access.";
    case "rate-limited":
      return "Navigating too fast — slow down and retry shortly.";
    case "sensitive-navigation":
      return "Sign-in and payment pages can't be opened by an agent.";
    case "non-public-url":
      return "Only public HTTPS pages can be opened in the isolated agent browser.";
    default:
      return "Navigation denied.";
  }
}

function findAgentNavigationOwner(): Electron.WebContents | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && browserPaneOpenTargets.has(focused.webContents.id)) {
    return focused.webContents;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && browserPaneOpenTargets.has(win.webContents.id)) {
      return win.webContents;
    }
  }
  return null;
}

/**
 * Creates a fresh hidden WebContentsView for a public investigation. It is
 * intentionally not an existing owner pane and uses a non-persistent
 * partition: navigation cannot replace the page the owner was viewing and
 * cannot inherit their cookies/localStorage. The only follow-up authority is
 * the already-existing text-only `web_tab_read` path.
 */
async function agentNavigateWebTab(input: {
  url: string;
  agentId: string;
  ticketId?: string;
}): Promise<
  | { ok: true; paneId: string; url: string }
  | { ok: false; error: string; reason?: string }
> {
  const normalizedUrl = normalizeBrowserPaneUrl(input.url);
  const rateKey = `navigate:${input.agentId}`;
  const decision = classifyAgentNavigationRequest({
    globalStopActive: globalBrowserAgentSwitch.isSuspended(),
    rateLimitOk: agentNavigationRateLimiter.allow(rateKey),
    url: normalizedUrl,
  });
  if (!decision.allowed) {
    broadcastAgentReadActivity({
      agentId: input.agentId,
      ticketId: input.ticketId,
      paneId: "*",
      url: normalizedUrl,
      status: "blocked",
      reason: decision.reason,
      at: Date.now(),
    });
    return {
      ok: false,
      error: agentNavigationDenialMessage(decision.reason),
      reason: decision.reason,
    };
  }
  const owner = findAgentNavigationOwner();
  if (!owner) {
    return {
      ok: false,
      error: "No Marblo workspace is ready to host an isolated agent browser.",
    };
  }
  const paneId = `agent-${crypto.randomUUID()}`;
  const record = createBrowserPaneRecord(
    owner,
    paneId,
    "about:blank",
    undefined,
    AGENT_NAVIGATION_PARTITION,
  );
  if (!record)
    return { ok: false, error: "Unable to create an isolated agent browser." };
  const key = browserPaneKey(record.ownerWebContentsId, record.paneId);
  // The agent owns this isolated pane, so it is readable without granting
  // visibility into any human-owned persistent pane.
  agentReadGrantedPanes.add(key);
  agentNavigationRateLimiter.record(rateKey);
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  globalBrowserAgentSwitch.register(requestId, {
    paneId,
    agentId: input.agentId,
    ticketId: input.ticketId,
    abort: () => controller.abort(),
  });
  broadcastAgentReadActivity({
    agentId: input.agentId,
    ticketId: input.ticketId,
    paneId,
    url: normalizedUrl,
    status: "navigating",
    at: Date.now(),
  });
  try {
    await runAgentNavigation(record.view.webContents, normalizedUrl, {
      signal: controller.signal,
    });
    record.currentUrl = record.view.webContents.getURL() || normalizedUrl;
    record.title = record.view.webContents.getTitle() || record.title;
    broadcastAgentReadActivity({
      agentId: input.agentId,
      ticketId: input.ticketId,
      paneId,
      url: record.currentUrl,
      status: "done",
      at: Date.now(),
    });
    return { ok: true, paneId, url: record.currentUrl };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    broadcastAgentReadActivity({
      agentId: input.agentId,
      ticketId: input.ticketId,
      paneId,
      url: normalizedUrl,
      status: aborted ? "aborted" : "blocked",
      reason: aborted ? "global-stop" : "navigation-failed",
      at: Date.now(),
    });
    return {
      ok: false,
      error: aborted
        ? "The owner stopped agent browser access mid-navigation."
        : err instanceof Error
          ? err.message
          : "Navigation failed.",
    };
  } finally {
    globalBrowserAgentSwitch.unregister(requestId);
  }
}

export type AgentReadWebTabResult =
  | {
      ok: true;
      title: string;
      url: string;
      text: string;
      truncated: boolean;
      redactedCount: number;
    }
  | { ok: false; error: string; reason?: AgentReadDenyReason };

/**
 * The (A) half of the ticket, called from the bridge server (agent process),
 * never directly from a renderer. `bridgeServer.setWebTabAgentReadGateway`
 * below wires this in.
 */
async function agentReadWebTabPane(input: {
  paneId: string;
  agentId: string;
  ticketId?: string;
}): Promise<AgentReadWebTabResult> {
  const { paneId, agentId, ticketId } = input;
  const record = findBrowserPaneRecordByPaneId(paneId);
  const key = record
    ? browserPaneKey(record.ownerWebContentsId, record.paneId)
    : null;

  const decision = classifyAgentReadRequest({
    paneExists: record !== null,
    granted: key !== null && agentReadGrantedPanes.has(key),
    globalStopActive: globalBrowserAgentSwitch.isSuspended(),
    rateLimitOk: key !== null && agentReadRateLimiter.allow(key),
    currentUrl: record?.currentUrl ?? "",
  });

  if (!decision.allowed) {
    broadcastAgentReadActivity({
      agentId,
      ticketId,
      paneId,
      url: record?.currentUrl ?? "",
      status: "blocked",
      reason: decision.reason,
      at: Date.now(),
    });
    return {
      ok: false,
      error: agentReadDenialMessage(decision.reason),
      reason: decision.reason,
    };
  }

  // `decision.allowed` implies `record` and `key` are non-null (paneExists
  // was checked first).
  agentReadRateLimiter.record(key as string);
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  globalBrowserAgentSwitch.register(requestId, {
    paneId,
    agentId,
    ticketId,
    abort: () => controller.abort(),
  });
  broadcastAgentReadActivity({
    agentId,
    ticketId,
    paneId,
    url: record!.currentUrl,
    status: "reading",
    at: Date.now(),
  });
  try {
    const snapshot = await runAgentReadExtraction(record!.view.webContents, {
      signal: controller.signal,
    });
    broadcastAgentReadActivity({
      agentId,
      ticketId,
      paneId,
      url: snapshot.url,
      status: "done",
      at: Date.now(),
      title: snapshot.title,
      textPreview: snapshot.text.slice(0, 240),
      redacted: snapshot.redactedCount > 0,
    });
    return { ok: true, ...snapshot };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    broadcastAgentReadActivity({
      agentId,
      ticketId,
      paneId,
      url: record!.currentUrl,
      status: aborted ? "aborted" : "blocked",
      reason: aborted ? "global-stop" : "extraction-failed",
      at: Date.now(),
    });
    return {
      ok: false,
      error: aborted
        ? "The owner stopped agent browser access mid-read."
        : err instanceof Error
          ? err.message
          : "Read failed.",
    };
  } finally {
    globalBrowserAgentSwitch.unregister(requestId);
  }
}

ipcMain.handle("browserPane:setAgentReadAccess", (event, input: unknown) => {
  const raw = input as { paneId?: unknown; granted?: unknown } | null;
  const record = findBrowserPaneRecord(event.sender.id, raw?.paneId);
  if (!record) return { ok: false, error: "Unknown browser pane." };
  const key = browserPaneKey(event.sender.id, record.paneId);
  if (raw?.granted === true) agentReadGrantedPanes.add(key);
  else agentReadGrantedPanes.delete(key);
  return { ok: true, granted: agentReadGrantedPanes.has(key) };
});

ipcMain.handle("browserPane:getAgentReadAccess", (event, input: unknown) => {
  const raw = input as { paneId?: unknown } | null;
  const record = findBrowserPaneRecord(event.sender.id, raw?.paneId);
  if (!record) return { ok: true, granted: false };
  const key = browserPaneKey(event.sender.id, record.paneId);
  return { ok: true, granted: agentReadGrantedPanes.has(key) };
});

// ★The global stop (design doc §B). Tripping it clears every per-pane grant
// too — a stop is a hard reset the owner must deliberately undo pane by
// pane, not a pause that quietly re-arms every grant it had.
ipcMain.handle("browserPane:setGlobalAgentStop", (_event, input: unknown) => {
  const raw = input as { suspended?: unknown } | null;
  if (raw?.suspended === true) {
    const { abortedCount } = globalBrowserAgentSwitch.suspend();
    agentReadGrantedPanes.clear();
    console.warn(
      `[Main] Global agent browser-read stop engaged — aborted ${abortedCount} in-flight read(s).`,
    );
    broadcastAgentReadActivity({
      agentId: "*",
      paneId: "*",
      url: "",
      status: "aborted",
      reason: `global-stop:${abortedCount}`,
      at: Date.now(),
    });
  } else {
    globalBrowserAgentSwitch.resume();
  }
  return { ok: true, suspended: globalBrowserAgentSwitch.isSuspended() };
});

ipcMain.handle("browserPane:getGlobalAgentStop", () => {
  return { ok: true, suspended: globalBrowserAgentSwitch.isSuspended() };
});

ipcMain.handle("agent:remove", (_event, agentId: string) => {
  agentManager.remove(agentId);
  return { success: true };
});

ipcMain.handle("agent:getMCPConfig", (_event, agentId: string) => {
  return agentManager.getMCPConfig(agentId);
});

ipcMain.handle("agent:healthStatus", (_event, agentId: string) => {
  const agent = agentManager.getAgent(agentId);
  if (!agent) return null;
  return {
    status: agent.status,
    restartCount: agent.restartCount,
    lastExitCode: agent.lastExitCode,
  };
});

// spawn-node 실제 실행 검증 결과를 렌더러(연결 상태 패널)에 노출한다. 깨진
// node 로 MCP/에이전트 자식이 침묵 -32000 으로 죽던 사고를, 행동가능 배너로
// 드러내기 위한 preflight (marblo_mcp_dies_broken_node_binary).
ipcMain.handle("system:nodeHealth", () => preflightNodeSpawn());

// macOS Xcode CLT 사전 감지 (티켓 nETj7szjEtT5prbYsg1D). 저장소 연결 모달이
// 사용자가 [Clone & 연결] 을 누르기 **전에** 호출해 라이선스 미동의/CLT 미설치
// 를 미리 알린다. darwin 이 아니면 { ok:true, checked:false } 로 즉시 통과.
ipcMain.handle("system:xcodeClt", () => probeXcodeClt());

// ── 메인↔렌더러 코드 세대 가드 (티켓 4HMJGUJBo0tKPU4mgHyr) ────────────────────
// dev 에서 렌더러는 vite HMR 로 즉시 최신이 되지만, 메인 프로세스는 기동 시점에
// require 한 dist-electron/*.js 에 묶인 채 남는다. `tsc --watch` 가 그 파일들을
// 다시 써도 이미 뜬 Node 프로세스는 읽지 않는다. 2026-09-05 하루에만 세 번
// (#1418 웹탭 좌표, #1420 폐루프 스위치, #1422 텔레그램 큐) "머지됐는데 안
// 고쳐졌다" 로 나타났고, 매번 사람이 ps lstart 와 dist mtime 을 손으로 대조해서야
// 원인을 알았다. 그 대조를 프로세스가 스스로 하게 만든다.
//
// ★패키징 빌드에선 아예 안 켠다. 코드가 app.asar 안에 있어 실행 중 바뀌지 않고,
// 업데이트는 재시작 때 통째로 교체된다 — 여기서 이 감시자는 거짓 양성만 만들 수
// 있다. 판정 축은 mtime 이 아니라 내용 해시다(main-build-freshness.ts 헤더).
const mainBuildWatcher = app.isPackaged
  ? null
  : startMainBuildWatcher({
      distDir: __dirname,
      log: (message) => console.warn(message),
      // ★로그로만 남기지 않는다. 오늘 문제의 절반이 "기록은 있었는데 아무도 안
      // 봤다" 였다. 열려 있는 모든 창에 밀어 넣어 화면에서 보이게 한다.
      onStale: (report) => broadcast("system:mainBuildStale", report),
    });
app.on("before-quit", () => mainBuildWatcher?.stop());

// 배너 마운트가 stale 판정보다 늦을 수 있으므로(렌더러 전체 리로드) 현재 판정을
// 직접 끌어갈 pull 경로도 연다. 감시자가 없으면 null — 렌더러는 그걸 "판정 없음"
// 으로 보고 아무것도 그리지 않는다.
ipcMain.handle("system:mainBuildFreshness", () =>
  mainBuildWatcher ? mainBuildWatcher.latest() : null,
);

ipcMain.handle(
  "agent:reconnect",
  async (
    event,
    {
      agents,
      rootPath,
      projectId,
    }: {
      agents: Array<{
        id: string;
        name: string;
        model: string;
        role: string;
        command: string;
        currentTaskId?: string | null;
      }>;
      rootPath: string;
      projectId: string;
    },
  ) => {
    const senderId = event.sender.id;
    // Find session candidates for each agent
    const candidates = findReconnectCandidates(
      agents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
      rootPath,
    );

    // Machine-scoping (shared-account safety): read each agent doc's machineId
    // so we only relaunch agents THIS machine owns. The `agents/` collection is
    // shared across every machine on one account; without this, a second
    // machine's boot rehydrates the whole project (the "83 phantom agents"
    // incident). On a fetch failure we leave the map empty → every doc is
    // treated as legacy → nothing auto-launches (the safe default this ticket
    // mandates; the user can still ▶ Start manually).
    const thisMachineId = getMachineId();
    const machineIdByAgent = new Map<string, string | undefined>();
    try {
      const { app, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(app);
      const snap = await fbGetDocs(
        fbQuery(
          fbCollection(db, "agents"),
          fbWhere("projectId", "==", projectId),
        ),
      );
      snap.forEach((d) => {
        machineIdByAgent.set(
          d.id,
          (d.data() as { machineId?: string }).machineId,
        );
      });
    } catch (err) {
      console.warn(
        "[Reconnect] machineId map fetch failed — treating all docs as legacy (no auto-launch):",
        err instanceof Error ? err.message : err,
      );
    }

    const results = [];

    for (const candidate of candidates) {
      const agentData = agents.find((a) => a.id === candidate.agentId);
      if (!agentData) {
        results.push({
          agentId: candidate.agentId,
          reconnected: false,
          ptySessionId: null,
          skippedReason: "unknown",
        });
        continue;
      }

      // Skip agents that already have a running PTY session. main 메모리에
      // 살아있는 인스턴스가 있으면 그 ptySessionId 를 응답에 같이 넘겨야
      // renderer 가 그 터미널에 다시 attach 할 수 있다. 이걸 안 넘기면
      // (앱/렌더러 리로드 직후 main 만 유지된 경우) PTY 는 도는데 셀이
      // 빈 상태로 보여 "끊긴 것처럼" 인지됨.
      const existing = agentManager.getAgent(agentData.id);
      if (
        existing &&
        existing.status !== "stopped" &&
        existing.status !== "error"
      ) {
        results.push({
          agentId: agentData.id,
          reconnected: false,
          ptySessionId: existing.ptySessionId,
          skippedReason: "already-running",
        });
        // Renderer 가 reload 되면서 owner 매핑이 빠졌을 수 있어 새 senderId
        // 로 재바인딩. forwarding 은 최초 launch 의 onPtyReady 에서 이미
        // 걸려 있으므로 setupPtyForwarding 을 다시 부르지 않는다 (node-pty
        // 의 onData 는 호출마다 listener 가 누적돼 데이터가 중복 forward
        // 되는 부작용).
        addPtyOwner(existing.ptySessionId, senderId);
        continue;
      }

      // Machine-ownership gate. Only relaunch agents THIS machine owns. A
      // `foreign` doc (stamped by another machine) or a `legacy` doc (never
      // stamped — possibly another machine's) is reported as a non-destructive
      // skip: FOREIGN_MACHINE_SKIP_REASON is deliberately NOT "no-session", so
      // the renderer leaves the shared doc untouched (marking it "stopped"
      // would rewrite a live agent's status on the other machine). The agent
      // still shows on the board, read-only. This is the core (a)/(b) fix.
      // NB: the already-running check above wins first — if we have a live PTY
      // for it, it is genuinely ours regardless of a stale doc machineId.
      const ownership = classifyMachineOwnership(
        machineIdByAgent.get(agentData.id),
        thisMachineId,
      );
      if (ownership !== "own") {
        console.log(
          `[Reconnect] Agent ${agentData.name} (${agentData.model}) is ${
            ownership === "foreign"
              ? "owned by another machine"
              : "unstamped/legacy"
          } → read-only skip (no launch, no Firestore mutation)`,
        );
        results.push({
          agentId: agentData.id,
          reconnected: false,
          ptySessionId: null,
          skippedReason: FOREIGN_MACHINE_SKIP_REASON,
        });
        continue;
      }

      // Resolve resume id per model.
      // - Claude: candidate.sessionId from ~/.claude/projects scan, or
      //   resolveSessionId('latest') as fallback. Need a concrete UUID.
      // - Codex / Gemini / Grok: their sessions live in our per-agent isolated
      //   home (created by AgentConfigGenerator), keyed by agentId — same
      //   home survives across app restarts because tmpdir() is persistent
      //   on macOS/Linux. We pass "latest" as a sentinel and the CLI's
      //   own resume logic (`codex resume --last`, `gemini --resume latest`,
      //   `grok --continue`) picks that agent's most recent session. Skip when
      //   the home is empty so we don't error out on a fresh agent that never
      //   ran. Grok additionally keys its sessions by working directory, so its
      //   check is scoped to the rootPath we relaunch in.
      let resumeId: string | null | undefined = candidate.sessionId;
      if (agentData.model === "claude") {
        // Resume ONLY on an agent-SPECIFIC match: a marblo-labels.json entry
        // (candidate.sessionId) or a name/id-scoped ~/.claude scan. The old
        // "adopt any unclaimed session" fallback for labelless agents is gone
        // on purpose — see resolveClaudeColdBootResumeId. agents/ has no
        // machine identity, so a second machine on the same account rehydrates
        // the other machine's stale agent docs; the blind fallback let each of
        // them grab an arbitrary local JSONL and launch a real CLI (the "83
        // phantom agents on launch" bug). No specific match → fall through to
        // the no-session skip below (marked stopped, woken via ▶ Start).
        const nameScoped = candidate.sessionId
          ? null
          : getAnyOrchestrator().resolveSessionId(
              rootPath,
              "latest",
              agentData.name,
              agentData.id,
            );
        resumeId = resolveClaudeColdBootResumeId(
          candidate.sessionId,
          nameScoped,
        );
      } else {
        const model = agentData.model as
          | "claude"
          | "gemini"
          | "gpt"
          | "grok"
          | "antigravity"
          | "custom";
        if (model === "antigravity") {
          // agy 는 marblo-agy-labels.json 에 저장된 concrete conversation
          // UUID 를 직접 넘긴다 → buildCLICommand 가 --conversation <UUID>
          // 로 매핑. 'latest' 를 쓰면 --continue 로 빠져 사용자 본인
          // 터미널의 가장 최근 conversation 을 잡을 위험.
          resumeId = getAgyConversationId(agentData.id);
        } else if (
          (model === "gpt" || model === "gemini") &&
          agentManager.hasSavedSession(agentData.id, model)
        ) {
          resumeId = "latest";
        } else if (
          model === "grok" &&
          agentManager.hasSavedSession(agentData.id, model, rootPath)
        ) {
          // grok 은 사용자 본인 홈이 아니라 격리 GROK_HOME 을 쓰므로 agy 와
          // 달리 --continue 가 남의 대화를 물 수 없다(그 홈엔 이 에이전트
          // 세션만 있다). cwd 스코프까지 확인했으니 sentinel 을 그대로 넘긴다.
          resumeId = "latest";
        } else {
          resumeId = null;
        }
      }
      // Policy change (PR #9): resumable 세션이 없으면 fresh-launch 하지 않고
      // 그대로 skip. 이전 동작은 "다 살려놓기" 였지만 N 개 CLI 프로세스 동시
      // spawn → RAM / 레이트리밋 / 잊고 둔 에이전트도 다 켜지는 리스크가 큼.
      // 사용자가 그리드 셀의 ▶ Start 버튼으로 의도 시점에 깨우게 함.
      // 프론트 useAgentReconnect 가 reconnected:false 결과를 보면 Firestore
      // status 를 "stopped" 로 동기화해 UI 에 ▶ Start 가 노출되도록 처리.
      if (!resumeId) {
        console.log(
          `[Reconnect] Agent ${agentData.name} (${agentData.model}) has no resumable session → skip (사용자가 ▶ Start 로 수동 기동)`,
        );
        results.push({
          agentId: agentData.id,
          reconnected: false,
          ptySessionId: null,
          skippedReason: "no-session",
        });
        continue;
      }

      try {
        const laneContextId = await resolveLaneLaunchContext(
          agentData.currentTaskId ?? undefined,
        );
        const instance = agentManager.launch({
          id: agentData.id,
          name: agentData.name,
          model: agentData.model as
            | "claude"
            | "gemini"
            | "gpt"
            | "grok"
            | "antigravity"
            | "custom",
          role: agentData.role,
          command: agentData.command,
          cwd: rootPath,
          resumeSessionId: resumeId ?? undefined,
          projectId,
          currentTaskId: agentData.currentTaskId ?? null,
          contextId: laneContextId,
          onPtyReady: (sid) => {
            addPtyOwner(sid, senderId);
            setupPtyForwarding(sid);
          },
        });
        results.push({
          agentId: agentData.id,
          reconnected: true,
          ptySessionId: instance.ptySessionId,
          // 콜드부트 재접속은 dispatch 때의 모델 핀(override)을 갖고 있지 않다 —
          // 이 relaunch 의 argv 가 곧 지금 돌고 있는 모델이다. 렌더러가 이 값으로
          // doc 을 재스탬프해야 배지가 "예전에 뭐였는지" 를 계속 주장하지 않는다.
          // argv 근거가 없으면(핀 없는 재접속) 이 프로세스 수명 안에서 관측된
          // 과금 모델로 떨어진다.
          spawnedModel: formatModelAtEffort(
            agentManager.resolveConcreteModel(agentData.id),
          ),
        });
        console.log(
          `[Reconnect] Agent ${agentData.name} (${
            agentData.id
          }) reconnected via ${
            candidate.sessionId
              ? "--resume " + candidate.sessionId
              : "--continue"
          }`,
        );

        // Start cost tracking — uses sessionId if known, or finds most recent JSONL
        costTracker.trackSession(
          agentData.id,
          rootPath,
          candidate.sessionId,
          agentData.model || "claude",
          // 이 relaunch 의 argv 가 곧 지금 돌고 있는 모델이다(launch() 반환 뒤라
          // 조회 경로가 유효하다). 없으면 undefined — 트래커가 첫 assistant 턴을
          // 파싱하는 순간 실제 모델로 채운다.
          agentManager.resolveConcreteModel(agentData.id)?.modelId,
        );
      } catch (err) {
        console.error(`[Reconnect] Failed for agent ${agentData.id}:`, err);
        results.push({
          agentId: agentData.id,
          reconnected: false,
          ptySessionId: null,
          skippedReason: "launch-failed",
        });
      }
    }
    return results;
  },
);

ipcMain.handle("agent:getSkill", (_event, role: string) => {
  const safeRole = role.replace(/[^a-zA-Z0-9_]/g, "");
  if (!safeRole) return null;

  const skillsDir = path.resolve(__dirname, "..", "skills");
  for (const filename of [`${safeRole}_agent.md`, `${safeRole}.md`]) {
    const filePath = path.resolve(skillsDir, filename);
    if (!filePath.startsWith(skillsDir)) continue;
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  }
  return null;
});

// --- Mission Orchestrator IPC Handlers ---
// 보드 orchestrator 와 분리된 별도 Claude Code 세션. Missions 탭 하단 PTY 패널이
// 사용. 한번 launch 되면 missionOrchestrators map 에 영구 보관되어 mission engine
// 이 ensureSession 호출 시 같은 인스턴스를 reuse.
ipcMain.handle(
  "missionOrchestrator:start",
  async (
    event,
    args: {
      projectId: string;
      rootPath: string;
      modelType?: string;
      missionId?: string;
    },
  ) => {
    const { projectId, rootPath, missionId } = args;
    if (!projectId || !rootPath) {
      throw new Error("projectId and rootPath required");
    }
    // 소유 윈도우 추적 — status event 라우팅 + onPtyReady 의 ptyOwners 세팅용.
    // ensureMissionOrchestratorLaunched 호출 전에 set 해야 새로 launch 되는
    // 경우 forwarding 이 곧장 이 창으로 향한다.
    missionOrchestratorOwners.set(projectId, event.sender.id);
    // 패널·엔진 공용 단일 launch 경로 — forwarding + resume + rootPath 포함.
    // missionId 를 넘기면 그 미션 세션에 종속(다르면 전환). 패널이 선택 미션을
    // 전달하므로 카드 선택 시 오케가 그 미션으로 바뀐다.
    const manager = ensureMissionOrchestratorLaunched(
      projectId,
      rootPath,
      missionId,
    );
    const session = manager.getSession();
    if (!session) return null;
    // 엔진이 먼저 띄운 경우 forwarding 의 소유 윈도우가 이 패널이 아닐 수 있으니
    // 라이브 출력을 현재 패널 창으로 재라우팅. (초기 backlog 는 pty:replay 가
    // 호출 renderer 에게 직접 반환하므로 순서 무관.)
    addPtyOwner(session.ptySessionId, event.sender.id);
    return {
      sessionId: session.sessionId,
      ptySessionId: session.ptySessionId,
      status: session.status,
    };
  },
);

ipcMain.handle(
  "missionOrchestrator:getSession",
  async (_event, projectId: string) => {
    const manager = missionOrchestrators.get(projectId);
    if (!manager) return null;
    const session = manager.getSession();
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      ptySessionId: session.ptySessionId,
      status: session.status,
    };
  },
);

ipcMain.handle(
  "missionOrchestrator:stop",
  async (_event, projectId: string) => {
    const manager = missionOrchestrators.get(projectId);
    if (manager) {
      manager.stop();
    }
  },
);

// 미션 스코프 중지 — 어밴던/삭제된 미션에 바인딩된 오케만 stop 한다. 다른
// 미션에 바인딩된 오케(getOwnerMissionId 불일치)는 보존하므로 무조건 호출해도
// 안전(no-op). MissionsTab 의 abandon/delete 핸들러에서 fire-and-forget 호출.
ipcMain.handle(
  "missionOrchestrator:stopForMission",
  async (_event, projectId: string, missionId: string) => {
    const manager = missionOrchestrators.get(projectId);
    if (manager && manager.getOwnerMissionId() === missionId) {
      manager.stop();
    }
  },
);

// 직전 mission 오케스트레이터 세션 id (kind=mission, rootPath 스코프) 조회.
// 부팅 시 렌더러가 "이 프로젝트에 이어갈 미션 세션이 있나?" 판단 → 있으면
// start 로 resume. 없으면 자동 spawn 하지 않는다 (미션 안 쓰는 프로젝트는 비용 0).
// manager 인스턴스만 보장하고 launch 는 하지 않는다 (파일 스캔만 수행).
ipcMain.handle(
  "missionOrchestrator:resolvePrevious",
  async (
    _event,
    rootPath: string,
    projectId?: string,
  ): Promise<string | null> => {
    const resolved = rootPath === "~" ? os.homedir() : rootPath;
    // 모델 인지 필수: claude 전용 resolver 가 codex 프로젝트에서 claude uuid 를
    // 돌려주면 `codex resume <uuid>` 즉사로 이어진다. 격리 홈 하네스(gpt/grok)는
    // 자기 홈(CODEX_HOME/GROK_HOME)의 세션 실재 여부만으로 "latest"/null 을
    // 판정한다 — grok 도 `--resume <claude-uuid>` 면 원격 404 로 똑같이 죽는다.
    const targetModel = normalizeOrchestratorModelType(
      await resolveAndApplyOrchestratorModelForProject(projectId),
    );
    if (usesIsolatedHomeSentinelResume(targetModel)) {
      if (!projectId) return null;
      return agentManager
        .getConfigGenerator()
        .hasSavedSession(
          `orchestrator-mission-${projectId}`,
          targetModel === "grok" ? "grok" : "gpt",
          resolved,
        )
        ? "latest"
        : null;
    }
    // 임시 manager — 파일 기반 resolve 만 하므로 map 에 보관/ launch 불필요.
    const probe = createMissionOrchestratorInstance("__resolve_probe__");
    try {
      return probe.resolveOrchestratorResumeId(resolved);
    } catch {
      return null;
    }
  },
);

// --- Orchestrator IPC Handlers ---
// (taskDecomposer / getDecomposer moved to mission-engine wire block above
//  so MissionEngine can share the same lazy singleton.)

ipcMain.handle("orchestrator:decompose", async (_event, text: string) => {
  const decomposer = getDecomposer();
  return decomposer.decompose(text);
});

ipcMain.handle(
  "orchestrator:createTasks",
  async (_event, tasks: DecomposedTask[]) => {
    // Return tasks for the renderer to create in Firestore
    // The renderer handles Firestore writes directly
    const decomposer = getDecomposer();
    const layers = decomposer.getExecutionPlan(tasks);
    return { tasks, layers };
  },
);

// orchestrator:injectMessage — the in-process, project-resolved, guard-free
// delivery path for renderer-originated orchestrator instructions (Worktrees-tab
// "Review request" button, diff inline comments). Unlike the old
// pty.list()+writeAndSubmit fast path — which grabbed the first PTY named
// "orchestrator" across ALL windows and fired-and-forgot, so a detached pop-out
// or second window (a non-owner of that PTY) was silently dropped by
// isPtyCallerOwner while the UI still flashed a success toast — this resolves the
// orchestrator by projectId in main and injects through OrchestratorManager.
// injectMessage (boot-gate + board-routing-gate serialised), returning a REAL
// ack. When there is no local orchestrator for the project, it isn't running, or
// the injection couldn't be committed, we return delivered:false with a reason so
// the renderer router can fall through to the durable Firestore queue and the UI
// can honestly show queued/failed instead of a phantom "sent".
ipcMain.handle(
  "orchestrator:injectMessage",
  async (
    _event,
    { projectId, message }: { projectId: string; message: string },
  ): Promise<{ delivered: boolean; reason?: string }> => {
    if (!projectId || typeof message !== "string" || message.length === 0) {
      return { delivered: false, reason: "invalid-args" };
    }
    const orch = orchestrators.get(projectId);
    if (!orch) {
      return { delivered: false, reason: "no-local-orchestrator" };
    }
    if (!orch.isRunning()) {
      return { delivered: false, reason: "orchestrator-not-running" };
    }
    try {
      const delivered = await orch.injectMessage(message);
      return delivered
        ? { delivered: true }
        : { delivered: false, reason: "inject-not-committed" };
    } catch (err) {
      return {
        delivered: false,
        reason: err instanceof Error ? err.message : "inject-error",
      };
    }
  },
);

// --- Orchestrator Session IPC Handlers ---

const ORCHESTRATOR_SWITCH_STEP_TIMEOUT_MS = 25_000;
const ORCHESTRATOR_SWITCH_INJECT_TIMEOUT_MS = 10_000;
const ORCHESTRATOR_SWITCH_STALE_LOCK_MS =
  ORCHESTRATOR_SWITCH_STEP_TIMEOUT_MS * 2 + 5_000;

interface OrchestratorSwitchLock {
  promise: Promise<OrchestratorSwitchResult>;
  startedAt: number;
  targetModel: ModelType;
  mode: OrchestratorSwitchMode;
  stage: OrchestratorSwitchStage | "queued";
}

const orchestratorSwitchLocks = new Map<string, OrchestratorSwitchLock>();

function describeSwitchLock(lock: OrchestratorSwitchLock): string {
  return `target=${lock.targetModel}, mode=${lock.mode}, stage=${
    lock.stage
  }, ageMs=${Date.now() - lock.startedAt}`;
}

function firestoreDocsToRaw(
  snap: Awaited<ReturnType<typeof fbGetDocs>>,
): RawHandoffDoc[] {
  return snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));
}

async function buildSwitchHandoffSnapshot(
  args: OrchestratorSwitchArgs,
  resolvedRootPath: string,
  targetModel: ModelType,
) {
  const { app: missionApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(missionApp);
  const current = orchestrators.get(args.projectId)?.getSession() ?? null;
  const resumeSessionId = resolveSwitchHandoffResumeSessionId({
    resume: args.resume,
    targetModel,
    // 격리 홈 하네스(codex/grok)는 자기 홈의 세션 실재 여부로만 판정한다.
    // grok 세션은 cwd 로도 키잉되므로 오케가 실제로 돌 rootPath 까지 넘긴다.
    hasSavedIsolatedHomeSession: () =>
      agentManager
        .getConfigGenerator()
        .hasSavedSession(
          `orchestrator-${args.projectId}`,
          targetModel === "grok" ? "grok" : "gpt",
          resolvedRootPath,
        ),
    resolvePreviousNonGptSession: () =>
      getAnyOrchestrator().resolveOrchestratorResumeId(resolvedRootPath),
  });
  const [missionSnap, taskSnap, workChain] = await Promise.all([
    fbGetDocs(
      fbQuery(
        fbCollection(db, "missions"),
        fbWhere("projectId", "==", args.projectId),
      ),
    ),
    fbGetDocs(
      fbQuery(
        fbCollection(db, "tasks"),
        fbWhere("projectId", "==", args.projectId),
      ),
    ),
    // 워크체인은 세션이 갈릴 때 유일하게 보드 밖에 있는 상태다 — 안 실으면 새
    // 오케는 "다음에 할 일" 만 물려받지 못한다(티켓 itSrsErpvtwUEcI4Deif).
    // ★fail-open: 체인 읽기가 실패해도 스위치를 죽이지 않는다. 대신 undefined 로
    // 넘겨서 스냅샷에 workChain 필드가 아예 빠지게 하고, 프롬프트가 "못 읽었으니
    // get_work_chain 을 먼저 불러라" 를 말한다 — 조용히 빈 체인으로 위장하지 않는다.
    readWorkChain(db, args.projectId).catch((err) => {
      console.warn(
        `[orchestratorSession:switch] work chain read failed project=${args.projectId}:`,
        err,
      );
      return undefined;
    }),
  ]);

  return buildOrchestratorHandoffSnapshot({
    projectId: args.projectId,
    rootPath: resolvedRootPath,
    from: {
      ptySessionId: current?.ptySessionId ?? null,
      claudeSessionId: current?.claudeSessionId,
      model: current?.launchConfig?.model,
    },
    targetModel,
    resumeSessionId,
    missions: firestoreDocsToRaw(missionSnap),
    tasks: firestoreDocsToRaw(taskSnap),
    ...(workChain
      ? { workChain: { items: workChain.items, rev: workChain.rev } }
      : {}),
  });
}

ipcMain.handle(
  "orchestratorSession:switch",
  async (
    event,
    rawArgs: {
      projectId: string;
      rootPath: string;
      targetModel: string;
      mode?: OrchestratorSwitchMode;
      resume?: OrchestratorSwitchResumeMode;
    },
  ): Promise<OrchestratorSwitchResult> => {
    const projectId = rawArgs.projectId;
    if (!projectId || !rawArgs.rootPath) {
      throw new Error("projectId and rootPath required");
    }

    const resolvedRootPath =
      rawArgs.rootPath === "~" ? os.homedir() : rawArgs.rootPath;
    const targetModel = normalizeOrchestratorModelType(rawArgs.targetModel);
    // 셀렉터가 Claude 변형으로 스위치했으면 그 구체 모델을 새 오케에 핀한다.
    // compound 를 통째로 보존해야 재시작 연속성이 변형까지 기억한다.
    const targetModelSetting = normalizeOrchestratorModelSetting(
      rawArgs.targetModel,
    );
    // Codex 변형(모델 + reasoning effort)도 같은 함수로 함께 해석된다.
    const targetPins = orchestratorModelPins(targetModelSetting);
    const args: OrchestratorSwitchArgs = {
      projectId,
      rootPath: resolvedRootPath,
      targetModel,
      mode: rawArgs.mode === "takeover" ? "takeover" : "wait",
      resume: rawArgs.resume === "previous" ? "previous" : "fresh",
    };
    const existing = orchestratorSwitchLocks.get(projectId);
    if (existing) {
      const ageMs = Date.now() - existing.startedAt;
      if (ageMs < ORCHESTRATOR_SWITCH_STALE_LOCK_MS) {
        console.warn(
          `[orchestratorSession:switch] Existing switch in flight for project ${projectId}; reusing (${describeSwitchLock(
            existing,
          )})`,
        );
        return existing.promise;
      }
      console.error(
        `[orchestratorSession:switch] Dropping stale switch lock for project ${projectId}; previous ${describeSwitchLock(
          existing,
        )}`,
      );
      orchestratorSwitchLocks.delete(projectId);
    }
    const senderId = event.sender.id;
    const port = bridgeServer.getPort();
    const lock: OrchestratorSwitchLock = {
      promise: new Promise<OrchestratorSwitchResult>(() => {}),
      startedAt: Date.now(),
      targetModel,
      mode: args.mode,
      stage: "queued",
    };

    // 잔액 임계 경고는 checkAuth 단계에서 판정되고 launchNew 단계에서 쓰인다.
    // (`runOrchestratorSwitch` 는 두 단계 사이로 값을 넘기는 축이 없다 — 그 축을
    //  늘리는 대신 이 스코프의 지역변수로 나른다. 스위치는 프로젝트당 락이 걸려
    //  동시에 둘이 돌지 않으므로 이 변수가 경합하지 않는다.)
    let switchVendorBootNotice: string | undefined;

    const op = runOrchestratorSwitch(args, {
      buildSnapshot: (switchArgs) =>
        buildSwitchHandoffSnapshot(switchArgs, resolvedRootPath, targetModel),
      checkAuth: async (model) => {
        const gate = await checkSpawnAuthGate(
          model,
          splitOrchestratorModelValue(targetModelSetting).modelId,
          "orchestrator_switch",
        );
        if (!gate.ok) {
          return {
            ok: false,
            model: gate.model,
            action: gate.action,
            installed: gate.installed,
            // launch 와 같은 재라벨 — 벤더 키 부재를 로그인 위저드로 보내지 않는다.
            ...orchestratorAuthBlockReason(gate.reason),
          };
        }
        // launch 와 같은 2번째 관문 — MCP 툴이 안 붙는 오케로는 스위치하지 않는다.
        // 여기서 막지 않으면 사용자는 멀쩡히 돌던 오케를 잃고 무력한 grok 오케를
        // 받는다(스위치는 항상 현재 오케를 stop 한 뒤 새로 띄우기 때문이다).
        const mcpGate = await checkOrchestratorMcpGate(model, resolvedRootPath);
        if (!mcpGate.ok) {
          return {
            ok: false,
            model,
            action: mcpGate.action,
            installed: true,
            // 인증이 아니라 MCP 가용성 — 렌더러가 CLI 로그인 위저드 대신
            // 폴더신뢰/MCP 안내를 띄우게 하는 표식.
            reason: ORCHESTRATOR_BLOCK_REASON_MCP,
          };
        }
        // launch 와 같은 3번째 관문 — 잔액이 없는 오케로는 스위치하지 않는다.
        // ★스위치는 **항상 현재 오케를 stop 한 뒤** 새로 띄우므로, 여기서 막지
        // 않으면 사용자는 멀쩡히 돌던 오케를 잃고 그 자리에 400 만 뱉는 껍데기를
        // 받는다(MCP 관문을 여기 둔 것과 정확히 같은 이유).
        const vendorGate =
          await checkOrchestratorVendorGate(targetModelSetting);
        switchVendorBootNotice = vendorGate.bootNotice;
        if (!vendorGate.ok) {
          return {
            ok: false,
            model,
            action: vendorGate.action,
            installed: true,
            reason: ORCHESTRATOR_BLOCK_REASON_VENDOR,
          };
        }
        return {
          ok: true,
          model: gate.model,
          action: gate.action,
          installed: gate.installed,
        };
      },
      detachPending: (pid) => pendingListener.detach(`orch-${pid}`),
      stopCurrent: (pid) => {
        logTelegramRouteHealth(pid, "switch-before-stop");
        const current = orchestrators.get(pid);
        if (current) current.stop();
        logTelegramRouteHealth(pid, "switch-after-stop");
      },
      launchNew: async (switchArgs, snapshot) => {
        const orch = getOrchestrator(projectId);
        addOrchestratorOwner(projectId, senderId);
        const handoffPrompt = formatHandoffPrompt(snapshot, switchArgs.mode);
        const session = orch.launch(
          projectId,
          resolvedRootPath,
          port,
          (sid, { reused }) => {
            addPtyOwner(sid, senderId);
            // A switch always stop()s the current orchestrator first, so this
            // is a fresh spawn in practice. Guard anyway — re-wiring a live
            // PTY duplicates its output.
            if (reused) return;
            setupPtyForwarding(sid);
            hookOrchestratorActivity(sid, projectId);
            logTelegramRouteHealth(projectId, "switch-new-pty-ready");
          },
          snapshot.to.resumeSessionId,
          undefined,
          {
            modelOverride: targetModel,
            claudeModelOverride: targetPins.claudeModel,
            codexModelOverride: targetPins.codexModel,
            codexEffortOverride: targetPins.codexEffort,
            nativeModelOverride: targetPins.nativeModel,
            ...(switchVendorBootNotice
              ? { bootNotice: switchVendorBootNotice }
              : {}),
            handoffPrompt,
            handoffMode: switchArgs.mode,
          },
        );
        // 스위치로 모델이 바뀌면 이 프로젝트의 재시작 연속성도 새 모델을 따른다.
        // ★compound 를 저장한다 — 프로바이더만 저장하면 Claude 변형 선택이 다음
        // 재시작에서 사라진다. 스위치는 사용자 명시 → source=user.
        saveProjectOrchestratorModel(projectId, targetModelSetting, "user");
        return {
          sessionId: session.sessionId,
          ptySessionId: session.ptySessionId,
          status: session.status,
        };
      },
      injectHandoff: async (_session, snapshot, mode) => {
        if (snapshot.to.resumeSessionId === "new") return;
        const orch = orchestrators.get(projectId);
        if (!orch) return;
        await orch.injectMessage(formatHandoffPrompt(snapshot, mode));
      },
      attachPending: (pid, ptySessionId) => {
        pendingListener.attach(`orch-${pid}`, ptySessionId);
        logTelegramRouteHealth(pid, "switch-after-attach");
      },
      stepTimeoutMs: ORCHESTRATOR_SWITCH_STEP_TIMEOUT_MS,
      injectTimeoutMs: ORCHESTRATOR_SWITCH_INJECT_TIMEOUT_MS,
      onStage: (stage) => {
        lock.stage = stage;
        console.info(
          `[orchestratorSession:switch] project=${projectId} stage=${stage} target=${targetModel} mode=${args.mode}`,
        );
      },
      onWarning: (message, error) => {
        console.warn(`[orchestratorSession:switch] ${message}`, error);
      },
    })
      .catch((error: unknown) => {
        if (error instanceof OrchestratorSwitchStepTimeoutError) {
          console.error(
            `[orchestratorSession:switch] Timeout at ${error.step} for project ${projectId}; lock will be released`,
          );
        } else {
          console.error(
            `[orchestratorSession:switch] Failed for project ${projectId}; lock will be released`,
            error,
          );
        }
        throw error;
      })
      .finally(() => {
        const current = orchestratorSwitchLocks.get(projectId);
        if (current?.promise === op) {
          orchestratorSwitchLocks.delete(projectId);
        }
      });
    lock.promise = op;

    console.info(
      `[orchestratorSession:switch] Starting switch project=${projectId} target=${targetModel} mode=${args.mode} resume=${args.resume}`,
    );
    orchestratorSwitchLocks.set(projectId, lock);
    return op;
  },
);

ipcMain.handle(
  "orchestratorSession:launch",
  async (
    event,
    { projectId, rootPath, resumeSessionId, enabledModels, model, locale },
  ) => {
    const port = bridgeServer.getPort();
    // Resolve '~' to actual home directory
    const resolvedPath = rootPath === "~" ? os.homedir() : rootPath;
    // 모델 결정: 명시 요청(패널 Start) > 프로젝트별 사용자 저장 >
    // 프로젝트별 자동 저장(재평가) > 전역 설정 > 네이티브 자동
    // (Claude>Codex>Grok) > hard default claude. 전역값만 쓰면 마지막으로
    // 만진 프로젝트의 모델이 다른 프로젝트 재시작에 적용돼 claude 대화를
    // 가진 프로젝트가 codex fresh 로 부팅된다(라이브 사고).
    const decision = await resolveOrchestratorModelDecision(
      projectId,
      typeof model === "string" ? model : undefined,
    );
    const effectiveModelSetting = decision.setting;
    applyOrchestratorModelEnv(effectiveModelSetting);
    const orchestratorModel = resolveOrchestratorModel();
    // 셀렉터가 구체 변형을 골랐으면 그 모델을 CLI 인자로 핀한다 — claude 는
    // `--model`, codex 는 `-c model=` + `-c model_reasoning_effort=`. 프로바이더만
    // 고른 경우엔 전 축이 undefined → 종전대로 각 CLI 의 기본값을 상속한다.
    const orchestratorPins = orchestratorModelPins(effectiveModelSetting);

    // Pre-spawn auth gate. If the selected CLI is not installed / logged in,
    // DON'T spawn it into an interactive login
    // prompt (which would hang the readiness loop and dump the boot prompt
    // into the login menu). Return a needsAuth marker so the renderer can open
    // the CLI setup gate instead of silently failing. (QA vj7ZvHphYOIhsNd340ad)
    // 핀된 구체 모델도 넘긴다 — 게이트가 벤더 축을 볼 근거다. 오케 후보는
    // `normalizeOrchestratorModelSetting` 이 네이티브 벤더로만 좁혀 두므로 이 값은
    // env-swap 행일 수 없고, 따라서 오케의 인증 축은 종전(계정 프로브) 그대로다.
    const orchGate = await checkSpawnAuthGate(
      orchestratorModel,
      splitOrchestratorModelValue(effectiveModelSetting).modelId,
      "orchestrator_launch",
    );
    if (!orchGate.ok) {
      console.warn(
        `[orchestratorSession:launch] Blocked — ${orchestratorModel} ${orchGate.reason} (action: ${orchGate.action})`,
      );
      return {
        sessionId: "",
        ptySessionId: "",
        status: "blocked",
        needsAuth: {
          model: orchGate.model ?? orchestratorModel,
          action: orchGate.action ?? "claude login",
          installed: orchGate.installed,
          // 키 부재는 로그인으로 안 풀린다 — 위저드가 아니라 벤더 키 안내로 보낸다.
          ...orchestratorAuthBlockReason(orchGate.reason),
        },
      };
    }

    // 2번째 관문 — 인증은 됐지만 MCP 툴이 안 붙는 "무력 오케" 차단(grok 한정).
    const orchMcpGate = await checkOrchestratorMcpGate(
      orchestratorModel,
      resolvedPath,
    );
    if (!orchMcpGate.ok) {
      return {
        sessionId: "",
        ptySessionId: "",
        status: "blocked",
        needsAuth: {
          model: orchestratorModel,
          action: orchMcpGate.action ?? "grok MCP 설정 확인",
          installed: true,
          // ★인증 실패가 아니다 — 렌더러가 CLI 로그인 위저드를 열면 "이미
          // 로그인됨" 만 보여주고 사용자는 이유 없이 막힌 채로 끝난다.
          reason: ORCHESTRATOR_BLOCK_REASON_MCP,
        },
      };
    }

    // 3번째 관문 — 인증도 MCP 도 통과했지만 **벤더 잔액이 없는** 오케 차단.
    // ★여기가 이 축의 본체다: 잔액 0 이 된 뒤 재시작하면 저장된 DeepSeek 오케가
    // 그대로 뜨는데, 막지 않으면 codex 가 우리 ChatGPT 로그인으로 벤더 slug 를
    // 물어보고 HTTP 400 을 받거나(키 있음/잔액 없음) 조용히 기본 백엔드로 샌다.
    // 그 조용한 샘이 `orchestratorSelectorEligible` 주석이 원래 두려워한 그것이다.
    const orchVendorGate = await checkOrchestratorVendorGate(
      effectiveModelSetting,
    );
    if (!orchVendorGate.ok) {
      return {
        sessionId: "",
        ptySessionId: "",
        status: "blocked",
        needsAuth: {
          model: orchestratorModel,
          action: orchVendorGate.action ?? "벤더 크레딧 확인",
          installed: true,
          // ★로그인 문제가 아니다. 표식이 없으면 렌더러가 CLI 위저드를 연다.
          reason: ORCHESTRATOR_BLOCK_REASON_VENDOR,
        },
      };
    }

    // Store enabledModels per-project (not as global env var) so two
    // concurrent windows don't race and overwrite each other's preset.
    if (
      enabledModels &&
      Array.isArray(enabledModels) &&
      enabledModels.length > 0
    ) {
      projectEnabledModels.set(projectId, enabledModels);
    }

    const senderId = event.sender.id;
    const orch = getOrchestrator(projectId);
    addOrchestratorOwner(projectId, senderId);
    const session = orch.launch(
      projectId,
      resolvedPath,
      port,
      (sid, { reused }) => {
        // Tag the PTY session with this owner window so its output is routed
        // here too. Additive: a second window attaching does NOT displace the
        // first — both terminals stay live.
        addPtyOwner(sid, senderId);
        if (reused) {
          // Attached to an ALREADY-RUNNING orchestrator. Everything below is
          // per-PTY wiring that is still in place from the original launch.
          // Re-running it would add a second node-pty data listener
          // (duplicated terminal output) and a duplicate pending-instruction
          // listener (double-injected instructions). Ownership above is the
          // only thing this new window needs.
          logTelegramRouteHealth(projectId, "launch-pty-attached");
          return;
        }
        setupPtyForwarding(sid);
        hookOrchestratorActivity(sid, projectId);
        // Cross-machine routing: any teammate who @mentions the orchestrator
        // from a machine that has no local orch PTY enqueues into
        // pendingInstructions with targetAgentId = `orch-${projectId}`.
        // This listener on the hosting machine picks it up and injects.
        pendingListener.attach(`orch-${projectId}`, sid);
        logTelegramRouteHealth(projectId, "launch-pty-ready");
      },
      resumeSessionId,
      undefined,
      // env 는 전역이라 동시 다중 창 launch 가 서로의 모델을 덮을 수 있다 —
      // 이 launch 가 결정한 모델을 명시적으로 고정한다.
      {
        modelOverride: orchestratorModel,
        claudeModelOverride: orchestratorPins.claudeModel,
        codexModelOverride: orchestratorPins.codexModel,
        codexEffortOverride: orchestratorPins.codexEffort,
        nativeModelOverride: orchestratorPins.nativeModel,
        locale: typeof locale === "string" ? locale : undefined,
        // 임계 이하 잔액 경고 — 사장님이 말한 "내부 터미널 충전 알림" 이 여기서
        // 나간다. 차단이 아니므로 스폰은 그대로 진행된다.
        ...(orchVendorGate.bootNotice
          ? { bootNotice: orchVendorGate.bootNotice }
          : {}),
      },
    );

    // 재시작 연속성: 이 프로젝트 오케가 실제로 뜬 모델을 기록. 다음 앱 재시작의
    // auto-reconnect(모델 미명시)는 전역 대신 이 값을 따른다.
    // ★compound 를 통째로 저장한다 — 프로바이더만 저장하면 재시작 때 Claude 변형
    // 선택이 사라져 CLI 기본 모델로 조용히 되돌아간다.
    // source 는 resolve 가 판정한 자동/명시를 그대로 이어 — 자동 그록이
    // 영구 user 로 굳지 않게 한다.
    saveProjectOrchestratorModel(
      projectId,
      effectiveModelSetting,
      decision.source,
    );

    return {
      sessionId: session.sessionId,
      ptySessionId: session.ptySessionId,
      status: session.status,
    };
  },
);

ipcMain.handle(
  "orchestratorSession:stop",
  (event, payload?: { projectId?: string }) => {
    // Resolve which orchestrator to stop:
    //   1. explicit projectId from request body (preferred)
    //   2. lookup by sender window's owned project
    //   3. otherwise no-op (legacy renderer paths still work after this lands)
    const explicit = payload?.projectId;
    const orch = explicit
      ? (orchestrators.get(explicit) ?? null)
      : getOrchestratorForSender(event.sender.id);
    if (orch) {
      orch.stop();
      // Forget the owner + enabledModels mappings for this project. We
      // intentionally leave OTHER projects' state alone — a previous bug
      // wiped the global env var and broke the other window's dispatch.
      for (const [pid, instance] of orchestrators) {
        if (instance === orch) {
          orchestratorOwners.delete(pid);
          projectEnabledModels.delete(pid);
          pendingListener.detach(`orch-${pid}`);
        }
      }
    }
  },
);

ipcMain.handle(
  "orchestratorSession:status",
  (event, payload?: { projectId?: string }) => {
    const explicit = payload?.projectId;
    const orch = explicit
      ? (orchestrators.get(explicit) ?? null)
      : getOrchestratorForSender(event.sender.id);
    return orch?.getStatus() ?? "stopped";
  },
);

ipcMain.handle(
  "orchestratorSession:listSessions",
  (_event, rootPath: string) => {
    const resolvedPath = rootPath === "~" ? os.homedir() : rootPath;
    // Stateless file-IO — any instance works.
    return getAnyOrchestrator().listSessions(resolvedPath);
  },
);

// Resolve the best previous orchestrator session to resume: label match,
// else a content-signature scan that recovers it even when the labels file
// is missing (the common case). Returns a concrete session id or null.
ipcMain.handle(
  "orchestratorSession:resolvePrevious",
  async (_event, rootPath: string, projectId?: string) => {
    const resolvedPath = rootPath === "~" ? os.homedir() : rootPath;
    // Session identity is per-CLI, so this must be model-aware. Codex/Grok keep
    // their sessions in the isolated CODEX_HOME/GROK_HOME and resume via a
    // native sentinel (`codex resume --last` / `grok --continue`) — handing
    // either a Claude uuid from the ~/.claude store makes it exit on launch.
    // See resolveRestartResumeSessionId. 모델은 launch 와 같은 프로젝트별
    // 우선순위로 결정해야 resolve/launch 가 서로 다른 모델을 보지 않는다.
    await resolveAndApplyOrchestratorModelForProject(projectId);
    const targetModel = resolveOrchestratorModel();
    return resolveRestartResumeSessionId({
      targetModel,
      hasSavedIsolatedHomeSession: () => {
        if (projectId) {
          return agentManager
            .getConfigGenerator()
            .hasSavedSession(
              `orchestrator-${projectId}`,
              targetModel === "grok" ? "grok" : "gpt",
              resolvedPath,
            );
        }
        // Without a projectId we cannot inspect the isolated home. Codex is
        // safe to guess "yes" — `--last` boots a fresh session on an empty
        // home. Grok is NOT: `--continue` with no session for the cwd exits
        // ("No session found for current directory"), so it must guess "no"
        // and start fresh.
        return targetModel !== "grok";
      },
      resolvePreviousNonGptSession: () =>
        getAnyOrchestrator().resolveOrchestratorResumeId(resolvedPath),
    });
  },
);

// --- Flow IPC Handlers ---

ipcMain.handle(
  "flow:run",
  async (
    _event,
    { flow, inputs }: { flow: Flow; inputs?: Record<string, unknown> },
  ) => {
    kanbanBridge.registerFlow(flow);
    flowNodeCache.set(flow.id, flow);
    const state = await flowRunner.run(flow, inputs);
    // Clean up cache after flow completes
    flowNodeCache.delete(flow.id);
    return state;
  },
);

ipcMain.handle("flow:pause", async (_event, { runId }: { runId: string }) => {
  await flowRunner.pause(runId);
});

ipcMain.handle(
  "flow:resume",
  async (
    _event,
    { runId, humanInput }: { runId: string; humanInput?: HumanInput },
  ) => {
    const state = await flowRunner.resume(runId, humanInput);
    return state;
  },
);

ipcMain.handle("flow:cancel", async (_event, { runId }: { runId: string }) => {
  await flowRunner.cancel(runId);
});

ipcMain.handle("flow:getState", (_event, { runId }: { runId: string }) => {
  return flowRunner.getState(runId);
});

// --- Settings IPC Handlers (API Keys) ---

ipcMain.handle("settings:getApiKeys", () => {
  const keys = readApiKeys();
  return {
    anthropic: keys.anthropic ? maskKey(keys.anthropic) : "",
    openai: keys.openai ? maskKey(keys.openai) : "",
    google: keys.google ? maskKey(keys.google) : "",
    // Also return whether each key is set (since masked values aren't the real keys)
    _isSet: {
      anthropic: !!keys.anthropic,
      openai: !!keys.openai,
      google: !!keys.google,
    },
  };
});

// --- Code formatting (Prettier) ---
ipcMain.handle(
  "code:format",
  async (
    _event,
    { content, filePath }: { content: string; filePath: string },
  ) => {
    try {
      const prettier = await import("prettier");
      const ext = path.extname(filePath).toLowerCase();
      const parserMap: Record<string, string> = {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "babel",
        ".jsx": "babel",
        ".json": "json",
        ".md": "markdown",
        ".css": "css",
        ".scss": "scss",
        ".less": "less",
        ".html": "html",
        ".vue": "vue",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".graphql": "graphql",
        ".gql": "graphql",
      };
      const parser = parserMap[ext];
      if (!parser) return { formatted: content, error: null };

      // Try to find project prettier config
      const config = (await prettier.resolveConfig(filePath)) || {};
      const formatted = await prettier.format(content, {
        ...config,
        parser,
        tabWidth: 2,
        singleQuote: true,
        trailingComma: "all",
      });
      return { formatted, error: null };
    } catch (err) {
      return {
        formatted: content,
        error: err instanceof Error ? err.message : "Format failed",
      };
    }
  },
);

ipcMain.handle(
  "settings:setApiKey",
  (_event, { provider, key }: { provider: string; key: string }) => {
    const validProviders = ["anthropic", "openai", "google"];
    if (!validProviders.includes(provider)) {
      throw new Error(`Invalid provider: ${provider}`);
    }
    const keys = readApiKeys();
    (keys as Record<string, string>)[provider] = key;
    writeApiKeys(keys);
    refreshLLMProvider();
    return { success: true };
  },
);

ipcMain.handle(
  "settings:deleteApiKey",
  (_event, { provider }: { provider: string }) => {
    const validProviders = ["anthropic", "openai", "google"];
    if (!validProviders.includes(provider)) {
      throw new Error(`Invalid provider: ${provider}`);
    }
    const keys = readApiKeys();
    delete (keys as Record<string, string | undefined>)[provider];
    writeApiKeys(keys);
    refreshLLMProvider();
    return { success: true };
  },
);

// --- env-swap 벤더 크레덴셜 IPC (GLM/MiniMax…) ---------------------------
//
// BYOK(위 settings:*ApiKey)와 **다른 축**이다. 저쪽은 Flow 엔진이 쓰는 프로바이더
// SDK 키고, 이쪽은 우리가 스폰하는 `claude` 바이너리를 남의 Anthropic-호환
// 엔드포인트로 붙이기 위한 벤더 구독키다(레지스트리 `envProfile` 의 `${...}` 참조).
//
// ★평문은 renderer 로 절대 나가지 않는다. 아래 세 핸들러 중 값을 **받는** 것은
//   set 하나뿐이고, 돌려주는 것은 전부 마스킹된 스냅샷이다.
ipcMain.handle("vendorSecrets:list", () => {
  return vendorSecretsSnapshot();
});

ipcMain.handle(
  "vendorSecrets:set",
  (_event, { envKey, value }: { envKey: string; value: string }) => {
    // allowlist 검증은 setVendorSecret 안에서 레지스트리 파생 목록으로 한다 —
    // 여기서 목록을 복제하면 벤더 행이 늘 때 둘이 어긋난다.
    setVendorSecret(envKey, value);
    // 같은 프로세스에서 이미 스폰된 에이전트는 자기 env 사본을 들고 있으므로
    // 영향받지 않는다. 다음 스폰부터 새 값이 적용된다.
    console.log("[vendor-secrets] 저장됨", { envKey }); // ★값 없음
    return { success: true, snapshot: vendorSecretsSnapshot() };
  },
);

ipcMain.handle(
  "vendorSecrets:delete",
  (_event, { envKey }: { envKey: string }) => {
    deleteVendorSecret(envKey);
    console.log("[vendor-secrets] 삭제됨", { envKey });
    return { success: true, snapshot: vendorSecretsSnapshot() };
  },
);

ipcMain.handle("settings:getPowerSave", () => {
  return {
    mode: powerSaveMode,
    preventSleepWhileWorking,
    // ★"걸었다고 믿는 것"이 아니라 OS 에 물어본 실측치(isStarted). 우리 쪽
    // 변수가 non-null 이라는 것만으로는 실제로 걸려 있다는 보장이 안 된다.
    active: isWorkPowerSaveBlockerActuallyStarted() === true,
    refCount: workPowerSaveRefCount,
    sources: powerSaveSources(powerSaveMode, collectWorkPowerSaveSources()),
  };
});

ipcMain.handle(
  "settings:setPowerSave",
  (
    _event,
    settings: { mode?: unknown; preventSleepWhileWorking?: unknown },
  ) => {
    const requestedMode = isPowerSaveMode(settings.mode)
      ? settings.mode
      : typeof settings.preventSleepWhileWorking === "boolean"
        ? normalizePowerSaveMode(undefined, settings.preventSleepWhileWorking)
        : null;
    if (!requestedMode) {
      return {
        success: false,
        error: "mode must be off, working, or remote",
      };
    }
    powerSaveMode = requestedMode;
    preventSleepWhileWorking = powerSaveMode !== "off";
    writeAppState({ powerSaveMode, preventSleepWhileWorking });
    refreshWorkPowerSaveBlocker();
    return {
      success: true,
      mode: powerSaveMode,
      preventSleepWhileWorking,
      active: isWorkPowerSaveBlockerActuallyStarted() === true,
      refCount: workPowerSaveRefCount,
      sources: powerSaveSources(powerSaveMode, collectWorkPowerSaveSources()),
    };
  },
);

// --- App State IPC ---
// --- Bridge Message Injection IPC ---
ipcMain.handle(
  "bridge:injectMessage",
  async (
    _event,
    params: {
      targetAgent: string;
      tag: string;
      message: string;
      taskId?: string;
      taskTitle?: string;
    },
  ) => {
    const port = bridgeServer.getPort();
    if (!port) return { success: false, error: "Bridge server not running" };
    const res = await fetch(`http://127.0.0.1:${port}/inject-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // In-process caller — attach the bridge's per-session bearer token so
        // the auth gate accepts it (local-RCE hardening).
        Authorization: `Bearer ${bridgeServer.getToken()}`,
      },
      body: JSON.stringify(params),
    });
    return res.json();
  },
);

// --- Clipboard support ---
// Plain-text read for the in-app terminal's explicit paste handler. The
// native menu paste (role:"paste", CmdOrCtrl+V) does not reliably reach
// xterm's hidden textarea after an OAuth browser round-trip — typing works
// but paste is lost — which broke pasting auth tokens (e.g. Antigravity
// `agy` login). The terminal reads the clipboard itself and injects via
// terminal.paste() instead of depending on the native paste event.
ipcMain.handle("clipboard:readText", () => clipboard.readText());

ipcMain.handle("clipboard:getImagePath", async () => {
  // If clipboard has text, skip image (user is pasting text, not an image)
  const text = clipboard.readText();
  if (text && text.length > 0) return null;

  const img = clipboard.readImage();
  if (img.isEmpty()) return null;

  const tmpDir = path.join(os.tmpdir(), "marblo-clipboard");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `paste-${Date.now()}.png`);
  fs.writeFileSync(filePath, img.toPNG());
  return filePath;
});

/**
 * Read the macOS pasteboard's file URLs directly (JXA → NSPasteboard).
 *
 * Replaces an AppleScript coercion (`the clipboard as «class furl»`) that was
 * wrong in three measured ways — all of which the file-tree ⌘V paste turns into
 * real damage rather than a cosmetic glitch:
 *
 *  - a single copied file came back TWICE (the furl branch and the list branch
 *    both matched), so a paste produced "a.txt" *and* "a.txt copy";
 *  - a Finder multi-select copy came back as the FIRST file only, duplicated —
 *    AppleScript's `the clipboard` exposes one pasteboard item, so items 2..n
 *    were silently dropped;
 *  - plain *text* coerced into a path: with "/tmp" on the clipboard the handler
 *    returned "/tmp", which exists, so pasting copied text would have copied
 *    the whole directory.
 *
 * `readObjectsForClasses` returns every item, and `FileURLsOnly` makes text
 * (including a copied http URL) return nothing. Measured ~46ms.
 */
const MACOS_CLIPBOARD_FILE_URLS_JXA = `
ObjC.import('AppKit');
const pb = $.NSPasteboard.generalPasteboard;
const opts = $.NSDictionary.dictionaryWithObjectForKey(
  $.NSNumber.numberWithBool(true),
  $.NSPasteboardURLReadingFileURLsOnlyKey,
);
const objs = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), opts);
const out = [];
if (objs) { for (let i = 0; i < objs.count; i++) out.push(ObjC.unwrap(objs.objectAtIndex(i).path)); }
out.join('\\n')
`;

/** Run a helper and capture stdout; any failure (missing binary, timeout,
 * non-zero exit) resolves to "" so the caller just sees an empty clipboard. */
function captureStdout(
  command: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf-8", timeout, windowsHide: true },
      (error, stdout) => resolve(error ? "" : String(stdout ?? "")),
    );
  });
}

ipcMain.handle("clipboard:getFilePaths", async () => {
  let raw = "";
  if (process.platform === "darwin") {
    raw = await captureStdout(
      "osascript",
      ["-l", "JavaScript", "-e", MACOS_CLIPBOARD_FILE_URLS_JXA],
      2000,
    );
  } else if (process.platform === "win32") {
    // CF_HDROP (Explorer Ctrl+C, multi-select aware). Windows PowerShell 5.1 is
    // present on every supported Windows; `Get-Clipboard -Format FileDropList`
    // is a 5.1-only parameter, hence powershell.exe and not pwsh.
    raw = await captureStdout(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }",
      ],
      5000,
    );
    if (!raw.trim()) {
      // Apps that advertise only CF_UNICODETEXT's FileNameW (single file).
      try {
        const buf = clipboard.readBuffer("FileNameW");
        if (buf && buf.length > 0)
          raw = buf.toString("utf16le").replace(/\0+$/, "");
      } catch {
        /* format not on the clipboard */
      }
    }
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const p = line.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (fs.existsSync(p)) paths.push(p);
  }
  return paths;
});

// --- Model Preset ---
//
// ★목록은 여기서 만들지 않고 `dispatch-scoring.MODEL_PRESETS`(라우팅이 실제로
// 읽는 그 표)를 그대로 서빙한다. 종전엔 `SettingsPage.PRESETS` 가 그 표를 2차
// 하드코딩해서, 백엔드가 grok 을 편입하고 가중치를 바꾼 뒤에도 화면은 옛 60/20/20
// 을 광고했고 `grok-only` 는 고를 방법 자체가 없었다.
ipcMain.handle("modelPreset:set", (_event, preset: string) => {
  // 저장 전에 정규화한다 — 알 수 없는 값·폐기된 id(`recommended`)·custom 표기가
  // 앱 상태에 날것으로 남으면 다음 부팅에서 조용히 기본값으로 되돌아간다.
  const normalized = normalizePresetId(preset);
  process.env.MARBLO_MODEL_PRESET = normalized;
  writeAppState({ modelPreset: normalized });
  console.log(`[Main] Model preset set to: ${normalized}`);
  return { success: true, preset: normalized };
});

ipcMain.handle("modelPreset:get", () => {
  return normalizePresetId(
    process.env.MARBLO_MODEL_PRESET ||
      readAppState().modelPreset ||
      DEFAULT_MODEL_PRESET,
  );
});

ipcMain.handle("modelPreset:list", () => ({
  presets: listModelPresets(),
  customHarnesses: [...CUSTOM_PRESET_HARNESSES],
}));

ipcMain.handle(
  "orchestratorModel:set",
  (_event, model: string, projectId?: string) => {
    const normalized = normalizeOrchestratorModelSetting(model);
    writeAppState({ orchestratorModel: normalized });
    // projectId 가 오면 그 프로젝트의 재시작 연속성도 이 선택을 따르게 기록.
    // 설정 패널 선택은 항상 사용자 명시.
    if (projectId) saveProjectOrchestratorModel(projectId, normalized, "user");
    console.log(`[Main] Orchestrator model set to: ${normalized}`);
    return { success: true };
  },
);

ipcMain.handle("orchestratorModel:get", async (_event, projectId?: string) => {
  // launch 와 같은 해석(자동 저장 재평가 포함) — 셀렉터 표시와 실제 기동이
  // 어긋나지 않게 한다. env 는 적용하지 않은 채 읽기만 하면 UI 가 어긋나므로
  // resolve 경로를 그대로 탄다.
  const decision = await resolveOrchestratorModelDecision(projectId);
  return decision.setting;
});

// --- Sentry (main-process crash/error capture) ---
//
// Consent-gated + DSN-gated. The renderer drives this over IPC ONLY after the
// user opts in (privacyConsentStore) and only when VITE_SENTRY_DSN is set —
// so with no consent or no DSN nothing here ever runs (PIPA + regression-safe).
// DSN/release/environment are the renderer's single source of truth (inlined
// from import.meta.env at build time); we forward them here so main doesn't
// need its own env plumbing. initMainSentry is idempotent and no-ops without a
// DSN. See electron/sentry-main.ts and src/lib/telemetry/sentry.ts.
ipcMain.handle(
  "sentry:init-main",
  async (
    _e,
    opts: { dsn?: string; release?: string; environment?: string },
  ) => {
    const ok = await initMainSentry(opts || {});
    return { ok };
  },
);

// --- Subscription plans (patent claim 8 — 구독제 vs 토큰단위 구분) ---
//
// User declares which models are billed under a flat-monthly subscription
// (Claude Max, ChatGPT Plus, etc.) vs the default per-token rates. The
// list is stored in ~/.marblo/subscription-plans.json so the cost-tracker
// running in any process (electron main, per-agent MCP) reads the same
// view via fs without needing IPC. Subscription matches override the
// per-token rate table; entries below the optional monthly token
// allowance contribute zero incremental cost (the flat fee covers them).
const SUBSCRIPTION_PLANS_FILE = path.join(
  os.homedir(),
  ".marblo",
  "subscription-plans.json",
);

interface SubscriptionPlanEntry {
  modelPrefix: string;
  monthlyFlatUsd: number;
  monthlyTokenAllowance?: number;
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

ipcMain.handle("subscriptionPlans:list", () => {
  try {
    if (!fs.existsSync(SUBSCRIPTION_PLANS_FILE)) return [];
    const raw = fs.readFileSync(SUBSCRIPTION_PLANS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SubscriptionPlanEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[Main] subscriptionPlans:list failed:", err);
    return [];
  }
});

ipcMain.handle(
  "subscriptionPlans:save",
  (_event, plans: SubscriptionPlanEntry[]) => {
    try {
      if (!Array.isArray(plans)) {
        return { success: false, error: "plans must be an array" };
      }
      const dir = path.dirname(SUBSCRIPTION_PLANS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${SUBSCRIPTION_PLANS_FILE}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(plans, null, 2), "utf-8");
      fs.renameSync(tmp, SUBSCRIPTION_PLANS_FILE);
      console.log(
        `[Main] subscriptionPlans:save wrote ${plans.length} plan(s)`,
      );
      return { success: true };
    } catch (err) {
      console.error("[Main] subscriptionPlans:save failed:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

ipcMain.handle("appState:load", (_event, input?: unknown) => {
  const accountUid = accountUidFromInput(input);
  if (!accountUid) return appStateVisibleToRenderer(readAppState());
  if (accountUid !== activeAccountUid) {
    const state = appStateVisibleToRenderer(readAppState());
    return {
      ...state,
      lastProjectId: undefined,
      lastRootPath: undefined,
      windows: undefined,
    };
  }
  return appStateForAccount(accountUid);
});

ipcMain.handle("appState:save", (_event, state: Partial<AppState>) => {
  saveAppStateInput(state);
  if (isPowerSaveMode(state.powerSaveMode)) {
    powerSaveMode = state.powerSaveMode;
    preventSleepWhileWorking = powerSaveMode !== "off";
    refreshWorkPowerSaveBlocker();
  } else if (typeof state.preventSleepWhileWorking === "boolean") {
    powerSaveMode = normalizePowerSaveMode(
      undefined,
      state.preventSleepWhileWorking,
    );
    preventSleepWhileWorking = powerSaveMode !== "off";
    refreshWorkPowerSaveBlocker();
  }
  return { success: true };
});

ipcMain.handle("demoCells:load", (_event, scope?: unknown) => {
  try {
    const normalizedScope = normalizeDemoCellScope(scope);
    return {
      success: true,
      values: readDemoCellValues(normalizedScope),
    };
  } catch (err) {
    return {
      success: false,
      values: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

ipcMain.handle(
  "demoCells:save",
  (_event, payload: { scope?: unknown; values?: unknown }) => {
    try {
      if (typeof payload !== "object" || payload === null) {
        throw new Error("demo cell payload must be an object");
      }
      const scope = normalizeDemoCellScope(payload.scope);
      const values = normalizeDemoCellValues(payload.values);
      writeDemoCellValues(scope, values);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

ipcMain.handle("demoCells:clear", (_event, scope?: unknown) => {
  try {
    const normalizedScope = normalizeDemoCellScope(scope);
    writeDemoCellValues(normalizedScope, {});
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// --- Harness IPC Handlers ---

ipcMain.handle("harness:list", () => {
  return listCatalog();
});

ipcMain.handle("harness:versions", async () => {
  return getCatalogVersions();
});

function normalizeHarnessInstallStartedBy(value: unknown): string {
  return value === "row_button" ||
    value === "one_click_install" ||
    value === "harness_store"
    ? value
    : "unknown";
}

ipcMain.handle(
  "harness:install",
  async (_event, id: string, startedBy?: unknown) => {
    const normalizedStartedBy = normalizeHarnessInstallStartedBy(startedBy);
    const descriptor = describeInstallPackageForTelemetry(id);
    mainTelemetry.cliInstallAttempt(mainWindow, {
      rowId: descriptor.id,
      model: descriptor.model,
      strategy: descriptor.strategy,
      platform: descriptor.platform,
      startedBy: normalizedStartedBy,
      ...(descriptor.sourceHost ? { sourceHost: descriptor.sourceHost } : {}),
    });
    const attempt = await installPackageWithTelemetry(id);
    mainTelemetry.cliInstallResult(mainWindow, {
      rowId: attempt.id,
      model: attempt.model,
      strategy: attempt.strategy,
      platform: attempt.platform,
      startedBy: normalizedStartedBy,
      success: attempt.success,
      durationMs: attempt.durationMs,
      postProbeInstalled: attempt.postProbeInstalled,
      ...(attempt.sourceHost ? { sourceHost: attempt.sourceHost } : {}),
      ...(attempt.exitCode !== undefined ? { exitCode: attempt.exitCode } : {}),
      ...(attempt.failureClassification
        ? { failureClassification: attempt.failureClassification }
        : {}),
      ...(attempt.tailHash ? { tailHash: attempt.tailHash } : {}),
      ...(attempt.npmPrefixFallback !== undefined
        ? { npmPrefixFallback: attempt.npmPrefixFallback }
        : {}),
      ...(attempt.postInstallExecFailed !== undefined
        ? { postInstallExecFailed: attempt.postInstallExecFailed }
        : {}),
    });
    return {
      success: attempt.success,
      error: attempt.error,
      failureClassification: attempt.failureClassification,
      postProbeInstalled: attempt.postProbeInstalled,
    };
  },
);

ipcMain.handle("harness:uninstall", async (_event, id: string) => {
  try {
    await uninstallPackage(id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
});

// Live-probe a required CLI's install + login state so the UI can show a
// "login required" badge instead of spawning into a hanging auth prompt.
ipcMain.handle(
  "harness:cliAuthCheck",
  async (_event, payload: { model: CliAuthModel }) => {
    try {
      return await probeCliAuth(payload.model);
    } catch (err) {
      return {
        installed: false,
        authenticated: false,
        action: err instanceof Error ? err.message : "probe failed",
      };
    }
  },
);

// --- Registry IPC Handlers (public marblo-app/marblo Store) ---
//
// 내장 카탈로그(harness:*)와 완전히 분리된 경로다 — untrusted 레지스트리
// 입력은 registry-client(검증) → registry-installer(§4.4 하드룰) → ledger 만
// 지난다. 설치·제거의 대상 항목은 항상 "우리가 마지막으로 검증한 인덱스"에서
// id 로 찾는다(렌더러가 항목 본문을 실어 보내는 구조 금지 — IPC 로 위조된
// install 블록이 게이트를 우회하지 못하게).

function registryInstallerDeps(): InstallerDeps {
  return {
    ledgerPath: registryLedgerPath(app.getPath("userData")),
    marbloVersion: app.getVersion(),
  };
}

ipcMain.handle(
  "registry:index",
  async (_event, opts?: { refresh?: boolean }) => {
    try {
      const index = await getRegistryIndex({
        cacheDir: app.getPath("userData"),
        forceRefresh: !!opts?.refresh,
      });
      const ledger = readLedger(registryInstallerDeps().ledgerPath);
      return {
        success: true,
        commit: index.commit,
        stale: index.stale,
        available: index.available,
        error: index.error,
        // 별점은 **여기서** 붙는다 — 렌더러는 이미 계산된 값을 표시·정렬만
        // 하고 점수를 만들 수단이 없다. 캐시에는 별점 없는 원본이 저장되므로,
        // 앱 업데이트로 스타 스냅샷이 바뀌면 같은 커밋이어도 즉시 재산출된다.
        items: rateRegistryItems(overlayInstallState(index, ledger)),
      };
    } catch (err) {
      return {
        success: false,
        available: false,
        items: [],
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle(
  "registry:install",
  async (
    _event,
    payload: {
      id: string;
      type: string;
      overwriteLocalChanges?: boolean;
      acknowledgeUnreviewed?: boolean;
    },
  ) => {
    try {
      if (!payload || typeof payload.id !== "string") {
        throw new Error("잘못된 요청");
      }
      const index = await getRegistryIndex({
        cacheDir: app.getPath("userData"),
      });
      const item = index.items.find(
        (i) => i.id === payload.id && i.type === payload.type,
      );
      if (!item) throw new Error(`레지스트리에 없는 항목: ${payload.id}`);
      // acknowledgeUnreviewed 는 그대로 전달만 한다 — community 설치를 실제로
      // 거부하는 것은 registry-installer 의 tier 게이트다(렌더러 불신 원칙).
      await installRegistryItem(item, registryInstallerDeps(), {
        overwriteLocalChanges: !!payload.overwriteLocalChanges,
        acknowledgeUnreviewed: payload.acknowledgeUnreviewed === true,
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle(
  "registry:uninstall",
  async (_event, payload: { id: string }) => {
    try {
      if (!payload || typeof payload.id !== "string") {
        throw new Error("잘못된 요청");
      }
      uninstallRegistryItem(payload.id, registryInstallerDeps());
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
);

// --- Local model (Ollama) IPC Handlers (스토어 '로컬 모델' 탭) ---
//
// 공개 레지스트리 경로와 **분리**된 first-party 축이다(§4.4) — 카탈로그는 앱
// 상수이고, pull 대상 id 는 카탈로그 화이트리스트로만 해석한다(렌더러 불신).
// pull 완료 후 레지스트리 등록은 syncInstalledLocalModels 가 `ollama list`
// 실측으로만 한다(유령비용 방지).

const localModelPullManager = new LocalModelPullManager();

ipcMain.handle("localModels:info", async () => {
  const hardware = localHardwareInfo();
  const detection = await syncInstalledLocalModels(true);
  return {
    hardware,
    ollama: {
      installed: detection.installed,
      version: detection.version,
      daemonRunning: detection.daemonRunning,
    },
    installedIds: detection.installedIds,
    cards: evaluateLocalModelCards(
      hardware.totalMemGB,
      detection,
      detection.installedIds,
      LOCAL_MODEL_CATALOG,
    ),
  };
});

ipcMain.handle("localModels:pull", async (_event, payload: { id: string }) => {
  const entry =
    payload && typeof payload.id === "string"
      ? catalogEntry(payload.id)
      : undefined;
  if (!entry) {
    // 카탈로그 밖 id 는 실행하지 않는다 — first-party 큐레이션이 원클릭의
    // 정당성이므로(티켓 §4.4), 임의 문자열은 argv 근처에도 못 간다.
    return { success: false, error: "not-in-catalog" };
  }
  const hardware = localHardwareInfo();
  if (hardware.totalMemGB < entry.minRamGB) {
    // UI 가 이미 비활성화하지만, 게이트는 렌더러를 신뢰하지 않는다.
    return { success: false, error: "insufficient-ram" };
  }
  const detection = await syncInstalledLocalModels();
  if (!detection.installed || !detection.command) {
    return { success: false, error: "ollama-missing" };
  }
  if (!detection.daemonRunning) {
    return { success: false, error: "daemon-stopped" };
  }
  const result = await localModelPullManager.pull(
    detection.command,
    entry.id,
    (ev) => broadcast("localModels:pullProgress", ev),
  );
  if (result.success) {
    // ★등록은 pull 성공 후 `ollama list` 재실측으로만 — pull 이 정확히 어떤
    // id 를 만들었는지의 정본은 요청값이 아니라 목록이다.
    await syncInstalledLocalModels(true);
  }
  return result;
});

ipcMain.handle("localModels:cancelPull", (_event, payload: { id: string }) => {
  const cancelled =
    !!payload &&
    typeof payload.id === "string" &&
    localModelPullManager.cancel(payload.id);
  return { success: cancelled };
});

// Account-global rate-limit snapshots for the Usage tab. Independent of any
// agent: claude is probed headlessly, codex/gpt is read from the newest
// rollout across all codex homes. null fields = no information (logged out /
// probe failed), never zero usage. See account-usage.ts.
ipcMain.handle("usage:accountRateLimits", () => getAccountRateLimits());

/**
 * 벤더 **선불 잔액**(사용량 탭 벤더 크레딧 패널).
 *
 * ★키는 이 프로세스를 벗어나지 않는다. 렌더러가 보내는 건 벤더 id 와 "새로고침을
 * 눌렀나" boolean 뿐이고, 돌아가는 건 금액·통화·상태·**키 이름**뿐이다
 * (`models:quickLaneCatalog` 이 세운 규율과 같은 축). 인증·엔드포인트·캐시는 전부
 * `vendor-balance.ts` 안에 있다.
 *
 * ★렌더러가 임의 벤더 문자열로 네트워크를 유발할 수 없다 — 프로브가 배선된 벤더가
 * 아니면 요청 없이 `unsupported` 로 답한다. 호출 빈도 하한도 그 모듈이 쥔다.
 */
ipcMain.handle(
  "usage:vendorBalance",
  async (_event, payload: { vendor?: unknown; force?: unknown }) => {
    const vendor =
      typeof payload?.vendor === "string" ? payload.vendor.trim() : "";
    if (!vendor || !hasBalanceProbe(vendor)) {
      return {
        vendor: vendor.toLowerCase(),
        status: "unsupported" as const,
        amounts: [],
        fetchedAt: Date.now(),
        cached: false,
      };
    }
    return getVendorBalance(vendor, { force: payload?.force === true });
  },
);

app.whenReady().then(async () => {
  console.log("[Marblo] auth=redirect build");

  // A persisted Remote mode must take effect before any inbound poller has
  // work to report; otherwise the machine could sleep during an idle wait.
  refreshWorkPowerSaveBlocker();

  // Global safety net: any webContents created anywhere in the app (including
  // child popups and any future windows) routes external http(s) links to the
  // OS browser. App-origin and Firebase-auth navigations are exempted inside
  // applyExternalLinkHandling, so app boot and OAuth redirects are never
  // hijacked.
  app.on("web-contents-created", (_event, contents) => {
    applyExternalLinkHandling(contents);
  });

  // safeStorage only comes online after `ready`. The module-load
  // `readApiKeys()` returned {} if the user had encrypted keys on disk;
  // refresh now so the LLM provider picks them up before any flow runs.
  if (safeStorage.isEncryptionAvailable()) {
    try {
      refreshLLMProvider();
    } catch (err) {
      console.warn("[Main] Post-ready key load failed (non-fatal):", err);
    }
  } else {
    console.warn(
      "[ApiKeys] OS keychain encryption unavailable on this system. " +
        "BYOK keys will not persist across restarts. " +
        "On Linux, install libsecret-1-0 / gnome-keyring.",
    );
  }

  // ★grok 레거시 심링크 지뢰 제거 (2026-08-10).
  //   종전 배선은 격리 GROK_HOME 의 auth.json 을 사용자 ~/.grok/auth.json 로
  //   심링크했다. grok 은 그것을 realpath 로 풀어 쓰고, refresh 가 영구실패하면
  //   **사용자 실파일을 지운다** — 에이전트 하나의 실패가 머신 전체 로그인을
  //   날렸다(2주간 6회 실측). 지금은 사설 복사본을 쓰지만, 예전 실행이 남긴 홈
  //   수천 개에 심링크가 그대로 남아 있어 그 홈이 다시 물리면 재발한다.
  //   심링크만 끊는다 — 홈/세션/실파일은 건드리지 않고, 다음 실행 때 복사본으로
  //   재생성되므로 기능 손실이 없다.
  try {
    const unlinked = unlinkLegacyGrokAuthSymlinks(CONFIG_DIR);
    if (unlinked > 0) {
      console.log(
        `[Main] Detached ${unlinked} legacy grok auth symlink(s) from the shared login`,
      );
    }
  } catch (err) {
    console.warn("[Main] grok auth symlink sweep failed (non-fatal):", err);
  }

  // Register installed Ollama models during app boot, not only when the Local
  // Models tab is opened. This keeps post-restart dispatch(model:"qwen…")
  // from missing the runtime registry row and falling into unrelated routing.
  try {
    const detection = await syncInstalledLocalModels(true);
    if (detection.installedIds.length > 0) {
      console.log(
        `[Main] Registered ${detection.installedIds.length} installed Ollama model(s)`,
      );
    } else if (detection.installed && !detection.daemonRunning) {
      console.log(
        "[Main] Ollama daemon is not running; local model scan skipped",
      );
    }
  } catch (err) {
    console.warn(
      "[Main] Ollama local model boot scan failed (non-fatal):",
      err,
    );
  }

  // 학습데이터 캡처 부트스트랩. 여기서는 타이머만 세우고 게이트를 서버에
  // 물어보기만 한다 — 인증 전이면 닫힌 상태로 남고(fail-closed), 로그인 직후
  // auth:syncAgentCustomToken 이 다시 당긴다. 지난 실행에서 업로드하지 못하고
  // 스풀에 남은 샘플도 이 타이머가 이어서 내보낸다.
  initTrainingCapture({ appVersion: app.getVersion() });

  // Install bundled harness assets (tf-* commands + skills) into ~/.claude/.
  // Idempotent: skips when the version marker already matches the current
  // app version.
  try {
    const result = await installBundledHarness();
    console.log(
      `[Main] Bundle install: ${result.installed} files, ${result.errors.length} errors`,
    );
  } catch (err) {
    console.warn("[Main] Bundle install failed (non-fatal):", err);
  }

  // official 첫파티 에이전트 기본설치(최초 1회). 번들 설치와 나란히 두지만
  // **다른 종류의 일**이다 — 번들은 앱 자산을 매 기동 심고(빌트인), 이쪽은
  // 레지스트리의 설치형 항목을 사용자 대신 한 번 눌러 주는 것이다(원장에
  // 기록되고 스토어에서 제거 가능).
  //
  // await 하지 않는다: 네트워크가 낀 일이 창 생성을 늦추면 안 된다. 그리고
  // 인덱스가 신선할 때만 돈다 — stale/unavailable 로 돌리면 "물어보지도 못한"
  // 실행이 완주 마커를 찍어 사용자가 기본 에이전트를 영영 못 받는다.
  void (async () => {
    try {
      const index = await getRegistryIndex({
        cacheDir: app.getPath("userData"),
      });
      if (!index.available || index.stale) return;
      const outcome = await installDefaultRegistryItems(
        index,
        registryInstallerDeps(),
      );
      if (outcome.alreadyRan) return;
      console.log(
        `[Main] Default registry install: ${outcome.installed.length} installed, ` +
          `${outcome.skipped.length} skipped, ${outcome.failed.length} failed`,
      );
      for (const f of outcome.failed) {
        console.warn(`[Main] Default install failed for ${f.id}: ${f.error}`);
      }
    } catch (err) {
      console.warn("[Main] Default registry install failed (non-fatal):", err);
    }
  })();

  // Auto-update Harness CLIs (Claude / Codex / Antigravity). One sweep now,
  // then every 24h. Keeps the user from being stuck on CLIs that show
  // blocking "Update available!" / settings-migration dialogs at startup
  // (which would otherwise deadlock agent spawning — see agent-manager.ts
  // startup dialog handling).
  scheduleHarnessUpdates((outcomes) => {
    const updated = outcomes.filter((o) => o.status === "updated");
    if (updated.length > 0) {
      broadcast("harness:updated", { outcomes: updated });
    }
  });

  // Start HTTP bridge server before creating the window
  try {
    const port = await bridgeServer.start();
    console.log(`[Main] BridgeServer started on port ${port}`);
  } catch (err) {
    console.error("[Main] Failed to start BridgeServer:", err);
  }

  // Account-scoped project windows are restored only after renderer auth tells
  // main which uid is active. Restoring here would attach a project folder
  // before main knows the account, which is the cross-account leak this path
  // must prevent.
  createWindow();

  // Start the electron-owned Telegram poller: one getUpdates loop per active
  // channel, resuming from the persisted offset. Idempotent — safe even if no
  // channels are configured yet (starts nothing).
  try {
    telegramPoller.start();
    telegramRouteJournal.start();
  } catch (err) {
    console.error("[Main] Telegram poller start failed:", err);
  }

  // Start the electron-owned Slack Socket Mode client: one WebSocket per active
  // channel, plus a drain of any inbound queued while the app was down.
  // Idempotent and independent of Telegram — both inbound paths coexist.
  try {
    slackPoller.start();
  } catch (err) {
    console.error("[Main] Slack Socket Mode start failed:", err);
  }

  assistantTriggerManager = new AssistantTriggerManager({
    listProjects: listAssistantTriggerProjects,
    workspace: {
      gmailSearch: (_projectId, params) =>
        gmailSearchFor(currentRealUserUid(), params),
      gmailFetch: (_projectId, messageId) =>
        gmailFetchFor(currentRealUserUid(), messageId),
      calendarList: (_projectId, params) =>
        calendarListFor(currentRealUserUid(), params),
      listWebhookEvents: listAssistantWebhookEvents,
      claimWebhookEvent: claimAssistantWebhookEvent,
      sheetsValues: (_projectId, params) =>
        sheetsValuesFor(currentRealUserUid(), params),
    },
    resolveOrchestrator: ensureAssistantTriggerOrchestrator,
    // ★발화가 죽은 사실을 화면까지 나른다(티켓 lcR4OMWCriWIpwbVDwVt). 발화 시점에
    // 사용자가 이 화면을 보고 있을 거라 기대하지 않으므로, 브로드캐스트는 "지금 열려
    // 있는 창을 위한 것" 이고 진짜 기록은 매니저가 들고 있다 —
    // assistantTriggers:deliveryFailures 로 나중에 열어도 그대로 읽힌다.
    onDeliveryFailure: (failure: AssistantTriggerDeliveryFailure) =>
      broadcast("assistantTriggers:deliveryFailure", failure),
    onDeliveryRecovered: (projectId: string) =>
      broadcast("assistantTriggers:deliveryRecovered", { projectId }),
    log: (message) => console.log(message),
    warn: (message, err) =>
      console.warn(message, err instanceof Error ? err.message : err),
  });
  try {
    assistantTriggerManager.start();
  } catch (err) {
    console.error("[Main] Assistant trigger manager start failed:", err);
  }

  // 텔레그램 채널 메타 기기 간 동기화(기동 시 1회): 다른 기기가 push 한 메타를
  // 복원하고(토큰 없음·비활성 — 사용자가 토큰 재입력 시 복구), 이 기기의 기존
  // 채널 메타를 업로드한다. custom-token 인증 전(익명)이면 조용히 스킵되고,
  // 인증이 성립하는 auth:syncAgentCustomToken 시점에 다시 돈다. fail-soft.
  void syncTelegramChannelMeta(getMachineId()).catch(() => undefined);

  // ── powerMonitor: process-suspension recovery (VCGuLWmNTlhoRvwGAKJA) ──
  //
  // ★Why these three events and not just `resume`.
  //
  // `resume` only fires for SYSTEM sleep. The measured failure had zero system
  // sleeps in an 83-hour window (pmset -g log) while the poller's own timers
  // still drifted 15-17 minutes — the process was suspended without the system
  // ever sleeping, so `resume` never fired and nothing re-polled. The blocker we
  // hold cannot prevent that: `prevent-app-suspension` compiles down to
  // kIOPMAssertionTypeNoIdleSleep (chromium power_save_blocker_mac.cc), which
  // governs system idle sleep and says nothing about per-process App Nap.
  //
  // `unlock-screen` is the one that matters on the affected machine: its screen
  // locks (09-03 19:06 → 09-04 10:03), the machines that never lose inbound do
  // not lock, and unlock is the moment inbound is expected back. It is also
  // exactly what `caffeinate -dimsu` failed to control, which is why that
  // control run reproduced the fault.
  //
  // Each of these only CANCELS A BACKOFF WAIT. No offset moves, no delivery
  // changes, no getUpdates is issued out of band. See
  // docs/telegram-app-nap-investigation.md.
  const notePowerResume = (reason: string): void => {
    try {
      telegramPoller.notePowerResume(reason);
    } catch (err) {
      console.warn(`[Main] telegram resume nudge (${reason}) failed:`, err);
    }
  };
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    console.log("[Main] Screen unlocked — nudging Telegram poller to re-poll");
    notePowerResume("unlock-screen");
  });
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    console.log("[Main] Screen locked — journal will mark samples from here");
  });
  powerMonitor.on("user-did-become-active", () => {
    notePowerResume("user-did-become-active");
  });

  // --- powerMonitor: notify renderer on system wake ---
  powerMonitor.on("resume", () => {
    console.log("[Main] System resumed from sleep — notifying renderer");
    broadcast("system:wake");
    notePowerResume("resume");
    // Telegram poller self-heal: mac sleep kills the getUpdates TCP socket and
    // a stray webhook 409-wedges getUpdates. The out-of-band health sweep
    // clears a webhook wedge with the stored bot token; then reconcile poller
    // loops so any that died on the dead socket are (re)started. Fire-and-forget.
    void runTelegramChannelHealthCheck("wake", {
      onReport: emitTelegramHealth,
    })
      .catch((err) =>
        console.warn("[Main] Telegram wake health check failed:", err),
      )
      .finally(() => telegramPoller.syncActiveChannels());
    // Slack self-heal on the same trigger: sleep kills the Socket Mode
    // WebSocket too. The credential probe is cheap and tells us WHY a channel
    // is quiet (revoked token vs dead socket); syncActiveChannels then
    // re-dials anything whose connection died. Fire-and-forget.
    void runSlackChannelHealthCheck("wake", { onReport: emitSlackHealth })
      .catch((err) =>
        console.warn("[Main] Slack wake health check failed:", err),
      )
      .finally(() => slackPoller.syncActiveChannels());
  });

  // Conservative periodic health sweep — catches steady-state disconnects that
  // never fire a wake event (a webhook registered mid-session, or a silently
  // deaf poller). Only probes active channels; no-op when none are configured.
  // unref'd so it never keeps the process alive on quit. Also reconciles poller
  // loops so a crashed loop is revived and a newly-active channel gets one.
  telegramHealthTimer = setInterval(
    () => {
      void runTelegramChannelHealthCheck("interval", {
        onReport: emitTelegramHealth,
      })
        .catch((err) =>
          console.warn("[Main] Telegram interval health check failed:", err),
        )
        .finally(() => telegramPoller.syncActiveChannels());
      // Same cadence for Slack: reconcile connections so a socket that died
      // without a wake event is re-dialed, and surface credential expiry.
      void runSlackChannelHealthCheck("interval", { onReport: emitSlackHealth })
        .catch((err) =>
          console.warn("[Main] Slack interval health check failed:", err),
        )
        .finally(() => slackPoller.syncActiveChannels());
    },
    4 * 60 * 1000,
  );
  telegramHealthTimer.unref?.();

  // Share windows with bridge server
  if (mainWindow) {
    bridgeServer.setMainWindow(mainWindow);
  }
  bridgeServer.setAllWindows(allWindows);

  // Mission engine — start Firestore listener for wake-from-sleep events, then
  // re-attach any missions left in `planning` (UI created them and shut down
  // before engine picked up).
  if (missionBundle) {
    try {
      await missionBundle.forwarder.start();
      await missionBundle.pickupPlanningMissions();
    } catch (err) {
      console.error("[Main] Mission engine startup failed:", err);
    }
  }

  // Native agent-health watchdog — self-recovers stuck board tickets without
  // relying on the orchestrator's own /loop session. Recovery-only.
  try {
    agentWatchdog.start();
  } catch (err) {
    console.error("[Main] Agent watchdog startup failed:", err);
  }

  // 보드 → 오케 주기 재동기화 — 개별 알림이 전부 유실돼도 오케가 미처리
  // REVIEW·FAILED·BLOCKED·고아 티켓·체인 READY 를 보드 기준으로 다시 받는다.
  try {
    boardResync.start();
  } catch (err) {
    console.error("[Main] Board resync startup failed:", err);
  }

  // Resource lifecycle reclaim: one delayed boot pass (after agent:reconnect
  // had a chance to repopulate AgentManager memory), then periodic ghost
  // sweeps and slower full sweeps. All timers unref'd — never block quit.
  const bootSweepTimer = setTimeout(() => {
    void runLifecycleReclaimSweep("boot");
  }, GHOST_RECLAIM_BOOT_DELAY_MS);
  bootSweepTimer.unref?.();
  const ghostSweepTimer = setInterval(() => {
    void runGhostReclaimSweep().catch((err) =>
      console.warn(
        "[LifecycleReclaim] periodic ghost sweep failed:",
        err instanceof Error ? err.message : err,
      ),
    );
  }, GHOST_RECLAIM_INTERVAL_MS);
  ghostSweepTimer.unref?.();
  const fullSweepTimer = setInterval(() => {
    void runLifecycleReclaimSweep("interval");
  }, WORKTREE_SWEEP_INTERVAL_MS);
  fullSweepTimer.unref?.();
  // 에이전트 자신의 heartbeat 를 문서로 흘린다 — 고아 판정이 Electron pid 가 아니라
  // 이 시계를 보게 하는 재료다(진단 §5.3-a).
  const heartbeatFlushTimer = setInterval(() => {
    void flushAgentHeartbeats().catch(() => undefined);
  }, HEARTBEAT_FLUSH_INTERVAL_MS);
  heartbeatFlushTimer.unref?.();

  // 감사 원장 체크포인트(§6). 부팅 1회 + 주기. 모든 실패를 삼키고 다음 주기에
  // 재시도하므로 이 타이머가 앱 동작에 영향을 주지 않는다. 전부 unref.
  const ledgerBootTimer = setTimeout(() => {
    void runLedgerCheckpointSweep("boot");
  }, LEDGER_CHECKPOINT_BOOT_DELAY_MS);
  ledgerBootTimer.unref?.();
  const ledgerCheckpointTimer = setInterval(() => {
    void runLedgerCheckpointSweep("interval");
  }, CHECKPOINT_INTERVAL_MS);
  ledgerCheckpointTimer.unref?.();
});

function stopAllOrchestrators(): void {
  for (const m of orchestrators.values()) {
    m.stop();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Non-macOS: full cleanup and quit
    kanbanBridge.detach();
    stopAllOrchestrators();
    if (telegramHealthTimer) clearInterval(telegramHealthTimer);
    assistantTriggerManager?.stop();
    telegramRouteJournal.stop();
    void telegramPoller.stopAll();
    void slackPoller.stopAll();
    bridgeServer.stop();
    agentManager.stopAll();
    pendingListener.detachAll();
    ptyManager.killAll();
    // Reap any dist-mcp orphaned by earlier natural exits, then stop the sweep.
    stopMcpOrphanReaper();
    reapOrphanedMcpChildren();
    fsManager.stopAllWatching();
    agentWatchdog.stop();
    boardResync.stop();
    missionBundle?.dispose();
    stopWorkPowerSaveBlocker("window-all-closed");
    app.quit();
  }
  // macOS: keep managers alive so agents/orchestrator persist across window close/reopen
});

app.on("before-quit", () => {
  // Capture the windows open at quit BEFORE they start closing, so the next
  // launch can reopen them all. isQuitting also tells per-window close handlers
  // not to strip the saved session on the way out.
  isQuitting = true;
  persistWindowSession();
  assistantTriggerManager?.stop();

  // Full cleanup when actually quitting (Cmd+Q)
  kanbanBridge.detach();
  stopAllOrchestrators();
  if (telegramHealthTimer) clearInterval(telegramHealthTimer);
  telegramRouteJournal.stop();
  void telegramPoller.stopAll();
  void slackPoller.stopAll();
  bridgeServer.stop();
  agentManager.stopAll();
  pendingListener.detachAll();
  ptyManager.killAll();
  // Reap any dist-mcp orphaned by earlier natural exits, then stop the sweep.
  stopMcpOrphanReaper();
  reapOrphanedMcpChildren();
  fsManager.stopAllWatching();
  agentWatchdog.stop();
  boardResync.stop();
  missionBundle?.dispose();
  stopWorkPowerSaveBlocker("before-quit");
  // Shared static server outlives individual windows — close it only here.
  try {
    staticServer?.close();
  } catch {
    /* already closed */
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
