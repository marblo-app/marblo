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
} from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import { execSync, spawn } from "node:child_process";
import dotenv from "dotenv";
import { PtyManager, isBusySignal } from "./pty-manager";
import {
  startMcpOrphanReaper,
  stopMcpOrphanReaper,
  reapOrphanedMcpChildren,
} from "./mcp-orphan-reaper";
import { PendingInstructionListener } from "./pending-instruction-listener";
import { FsManager } from "./fs-manager";
import { gitSpawnEnv } from "./git-path";
import { AgentManager, serializeAgent, type ModelType } from "./agent-manager";
import { Updater } from "./updater";
import {
  isPathUnder,
  resolveRestoreRoots,
  scrubRemovedRoots,
  selectPersistableWindows,
} from "./windowSession";
import { describeRootPathFailure, diagnoseRootPath } from "./rootPathHealth";
import { TaskDecomposer } from "./orchestrator/task-decomposer";
import type { DecomposedTask } from "./orchestrator/dag-generator";
import { BridgeServer, withCompletionFooter } from "./bridge-server";
import { GraphUpdater } from "./graph-updater";
import {
  AgentWatchdog,
  resolveWatchdogConfig,
  buildRespawnDispatch,
  type WatchdogTicket,
  type StaleReviewTicket,
  type PendingInstruction,
} from "./agent-watchdog";
import { OrchestratorManager } from "./orchestrator-manager";
import {
  buildOrchestratorHandoffSnapshot,
  formatHandoffPrompt,
  resolveEffectiveOrchestratorModelSetting,
  resolveRestartResumeSessionId,
  resolveSwitchHandoffResumeSessionId,
  type OrchestratorSwitchMode,
  type OrchestratorSwitchResumeMode,
  type RawHandoffDoc,
} from "./orchestrator-handoff";
import {
  OrchestratorSwitchStepTimeoutError,
  runOrchestratorSwitch,
  type OrchestratorSwitchStage,
  type OrchestratorSwitchArgs,
  type OrchestratorSwitchResult,
} from "./orchestrator-switch";
import { installBundledHarness } from "./bundle-installer";
import { runGoogleLoopbackOAuth } from "./google-oauth";
import {
  listCatalog,
  installPackage,
  uninstallPackage,
  scheduleHarnessUpdates,
  getCatalogVersions,
  probeCliAuth,
  checkSpawnAuthGate,
  type CliAuthModel,
} from "./harness-manager";
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
} from "./agent-config";
import { CostTracker } from "./cost-tracker";
import { getAccountRateLimits } from "./account-usage";
import { mainTelemetry } from "./telemetry";
import { initMainSentry } from "./sentry-main";
import { loadPackagedMainFirebaseConfigEnv } from "./firebase-config-env";
import {
  buildMissionEngine,
  type BuiltMissionEngine,
} from "./mission-engine/wire";
import { WorktreeManager } from "./worktree-manager";
import { WorktreeCoordinator } from "./worktree-coordinator";
import {
  registerWorktreeIpc,
  type WorktreeProjectRoot,
  type MergeHistoryRecord,
} from "./worktree-ipc";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";
import {
  clearAgentCustomToken,
  syncAgentCustomToken,
} from "./firebase-auth-sync";
import { buildLaneContextId, isLaneContextId } from "./mcp-server/context";
import {
  getTelegramChannelConfig,
  listTelegramChannelConfigs,
  setTelegramChannelFromLocalSettings,
  getTelegramChannelStatus,
  removeTelegramChannel,
  type TelegramChannelInput,
} from "./telegram-channels";
import {
  pushTelegramChannelMetaOne,
  syncTelegramChannelMeta,
} from "./telegram-channel-sync";
import {
  runTelegramChannelHealthCheck,
  type ChannelHealthReport,
} from "./telegram-health";
import { TelegramPoller, type InboundTarget } from "./telegram-poller";
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

type ConnectionCheckStatus = "pass" | "warn" | "fail";

interface ConnectionCheckItem {
  id: "repo" | "branch" | "issues" | "pullRequest" | "auth" | "mismatch";
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
    `[Main] packaged Firebase config loaded for main process (path=${firebaseConfigEnvResult.configPath}; keys=${firebaseConfigEnvResult.injectedKeys.length}; apiKeyPresent=${firebaseConfigEnvResult.apiKeyPresent})`
  );
} else if (
  firebaseConfigEnvResult.status === "missing" ||
  firebaseConfigEnvResult.status === "invalid"
) {
  console.warn(
    `[Main] packaged Firebase config unavailable for main process (status=${firebaseConfigEnvResult.status}; path=${firebaseConfigEnvResult.configPath})`
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
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      clientId?: string;
      clientSecret?: string;
    };
    if (cfg.clientId && !process.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID) {
      process.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID = cfg.clientId;
    }
    if (cfg.clientSecret && !process.env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET) {
      process.env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET = cfg.clientSecret;
    }
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
        "On macOS or Windows this should not happen — please report to support@marblo.app."
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
  demoCellValues?: Record<string, Record<string, string>>;
  // Project windows open at last quit, so a full restart can reopen them all
  // (the single lastProjectId/lastRootPath above only covers one window).
  windows?: Array<{ rootPath?: string; projectId?: string }>;
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

type WorkPowerSaveSource = "orchestrator" | "agent" | "telegram-poller";

let preventSleepWhileWorking =
  readAppState().preventSleepWhileWorking !== false;
let workPowerSaveBlockerId: number | null = null;
let workPowerSaveRefCount = 0;

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
      `demo cell scope must be ${MAX_DEMO_CELL_SCOPE_LENGTH} characters or fewer`
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
      `demo cell values cannot exceed ${MAX_DEMO_CELL_COUNT} cells`
    );
  }

  const normalized: Record<string, string> = {};
  for (const [cellKey, cellValue] of entries) {
    const key = cellKey.trim();
    if (!key) throw new Error("demo cell key cannot be empty");
    if (key.length > MAX_DEMO_CELL_KEY_LENGTH) {
      throw new Error(
        `demo cell key must be ${MAX_DEMO_CELL_KEY_LENGTH} characters or fewer`
      );
    }
    if (typeof cellValue !== "string") {
      throw new Error("demo cell value must be a string");
    }
    if (cellValue.length > MAX_DEMO_CELL_VALUE_LENGTH) {
      throw new Error(
        `demo cell value must be ${MAX_DEMO_CELL_VALUE_LENGTH} characters or fewer`
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
  values: Record<string, string>
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
        { merge: true }
      );
    } catch (err) {
      // Allow a retry on the next status change rather than giving up forever.
      stampedMachineAgentIds.delete(agentId);
      console.warn(
        "[MachineId] Failed to stamp agent ownership:",
        agentId,
        err instanceof Error ? err.message : err
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
  status: "stopped" | "error"
): void {
  void (async () => {
    try {
      const { app: fbApp, authReady } = getMissionFirebaseApp();
      await authReady;
      const db = getFirestore(fbApp);
      await fbSetDoc(
        fbDoc(db, "agents", agentId),
        { status, updatedAt: fbTimestamp.now() },
        { merge: true }
      );
    } catch (err) {
      console.warn(
        "[LifecycleReclaim] terminal status finalize failed:",
        agentId,
        status,
        err instanceof Error ? err.message : err
      );
    }
  })();
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
const WORKTREE_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
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
      fbWhere("machineId", "==", getMachineId())
    )
  );
  const now = Date.now();
  const reclaimed: GhostReclaimSweepResult["reclaimed"] = [];
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
    });
    if (!decision.reclaim) continue;
    try {
      await fbSetDoc(
        fbDoc(db, "agents", id),
        { status: "stopped", updatedAt: fbTimestamp.now() },
        { merge: true }
      );
      const name = typeof data.name === "string" ? data.name : id;
      reclaimed.push({ id, name, reason: decision.reason });
      console.log(
        `[LifecycleReclaim] ghost reclaimed: ${name} — ${decision.reason}`
      );
    } catch (err) {
      console.warn(
        "[LifecycleReclaim] ghost mark-stopped failed:",
        id,
        err instanceof Error ? err.message : err
      );
    }
  }
  return { scanned: docs.length, reclaimed };
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
          (a.cwd === c.path || a.cwd.startsWith(c.path + path.sep))
      );
    if (busy) continue;

    result.checked++;
    let taskStatus: string | null = null;
    try {
      const td = await fbGetDoc(fbDoc(db, "tasks", c.taskId));
      taskStatus = td.exists()
        ? (td.data() as { status?: string }).status ?? null
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
        fs.readFileSync(path.join(c.path, ".git"), "utf-8")
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
          `[LifecycleReclaim] worktree reaped: ${c.path} — ${res.reason}`
        );
      } else {
        result.preserved++;
      }
    } catch (err) {
      console.warn(
        "[LifecycleReclaim] worktree reap failed:",
        c.path,
        err instanceof Error ? err.message : err
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
    }`
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
        err instanceof Error ? err.message : err
      );
      return null;
    });
    const wt = await runWorktreeTerminalSweep().catch((err) => {
      console.warn(
        "[LifecycleReclaim] worktree sweep failed:",
        err instanceof Error ? err.message : err
      );
      return null;
    });
    console.log(
      `[LifecycleReclaim] sweep(${trigger}): scanned ${
        ghosts?.scanned ?? 0
      } own docs, reclaimed ${ghosts?.reclaimed.length ?? 0} ghost(s); ` +
        `worktrees ${
          wt
            ? `${wt.removed.length} reaped / ${wt.preserved} preserved / ${wt.total} on disk`
            : "skipped"
        }`
    );
    await reportAccumulation(wt ? wt.total - wt.removed.length : null);
  } finally {
    lifecycleSweepRunning = false;
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
const pendingListener = new PendingInstructionListener(ptyManager);
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
      finalizeAgentStatusInFirestore(agentId, status);
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
  (rootPath, sessionId, label, agentId) => {
    const agent = agentManager.getAgent(agentId);
    const model = agent?.model || "claude";
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
    if (model === "gpt" || model === "gemini") {
      // Codex/Gemini resume 는 네이티브(--last / --resume latest)라 UUID 라벨을
      // 저장할 필요가 없다. 파일 기반 비용 추적만 시작 — 트래커가 per-agent
      // CLI home 아래 최신 세션 파일을 스스로 찾고, 아직 없으면 다음 폴에서
      // 잡는다 (유실 없음).
      costTracker.trackSession(agentId, rootPath, null, model);
      return;
    }
    // File-IO method, project-agnostic — any orchestrator instance works.
    getAnyOrchestrator().saveSessionLabel(rootPath, sessionId, label, agentId);
    // Start tracking JSONL session file for token usage
    costTracker.trackSession(agentId, rootPath, sessionId, model);
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
      if (a?.currentTaskId) {
        void graphUpdater.recordOutcome({
          taskId: a.currentTaskId,
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
  () => mainWindow
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
      path.join(distPath, urlPath === "/" ? "index.html" : urlPath)
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
              "retrying on a random free port (auth persistence resets this launch)"
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
          console.error("[Marblo] Static server runtime error:", e)
        );
        const addr = server.address();
        const boundPort = typeof addr === "object" && addr ? addr.port : 0;
        staticServer = server;
        // Persist so the next launch reuses the same origin.
        if (boundPort) writeAppState({ staticServerPort: boundPort });
        console.log(
          `[Marblo] Shared static server on http://127.0.0.1:${boundPort}`
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
      `[TelegramHealth] project=${report.projectId} reliability — unanswered inbounds=${reliability.unanswered}, failed sends=${reliability.sendFailures}`
    );
  }
  broadcast("telegram:health", { ...report, reliability });
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
const windowRestore = new Map<
  number,
  { rootPath?: string; projectId?: string; detached?: boolean }
>();

// Set on before-quit so per-window close handlers don't strip the saved
// session on the way out — we want the set of windows open AT quit to persist.
let isQuitting = false;

// Snapshot the currently-open project windows to disk so a full restart can
// reopen them all (see restoreWindowSession). Called whenever a window's
// project changes or a window closes — cheap and infrequent.
function persistWindowSession(): void {
  // Exclude detached pop-out windows and dedupe by rootPath — otherwise popping
  // out Board/Code tabs (which share the parent's rootPath) would reopen the
  // same project as extra full windows on restart. See windowSession.ts.
  const windows = selectPersistableWindows(windowRestore.values());
  writeAppState({ windows });
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
  windowKey?: number
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

  const last = readAppState().lastRootPath;
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
  opts?: { notice?: string }
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
        : undefined
    );
    console.warn(
      `[Window] Removed worktree root "${rootPath}" recovered without modal via "${diagnosis.fallbackRootPath}"`
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
  // The global single slot has to be scrubbed too, and FIRST. It is the
  // cold-start fallback for the primary window and the source of
  // `defaultRootPath` below, so leaving a reaped worktree in it means every
  // dead window falls back onto another dead path — which is exactly how a
  // reaped worktree survived #501 and kept the popup coming back each boot.
  // (#501 scrubbed `windows[]` only; `lastRootPath` was read but never fixed.)
  const lastRootPath = readAppState().lastRootPath;
  if (lastRootPath && removedPaths.some((r) => isPathUnder(lastRootPath, r))) {
    const replacement = pickFallbackRoot(lastRootPath);
    // Explicit `undefined` survives the spread in writeAppState and is then
    // dropped by JSON.stringify — i.e. the key is genuinely cleared, not left
    // holding the dead path.
    writeAppState({ lastRootPath: replacement });
    console.warn(
      `[Window] Worktree removed — global lastRootPath "${lastRootPath}" cleared` +
        (replacement ? ` in favour of "${replacement}"` : " (no fallback)")
    );
  }

  const scrubs = scrubRemovedRoots(windowRestore.entries(), removedPaths, {
    exists: (p) => fs.existsSync(p),
    defaultRootPath: readAppState().lastRootPath,
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
        `[Window] Worktree removed — repointing window ${key} from "${removedRootPath}" to "${rootPath}"`
      );
    } else {
      // No live fallback. Drop the root so the window reconnects to the folder
      // picker rather than to a directory that no longer exists.
      const { rootPath: _dead, ...rest } = entry;
      windowRestore.set(key, rest);
      console.warn(
        `[Window] Worktree removed — window ${key} has no surviving root (was "${removedRootPath}")`
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
// Track which window owns each PTY session so output goes only there.
const ptyOwners = new Map<string, number>(); // ptySessionId → webContents.id
// Renderers that have already drained the early-output buffer via pty:replay.
// On restart we reuse the same sid (agent-${id}) and the existing TerminalView
// does NOT re-call pty:replay (its useEffect only runs when sessionId changes).
// If setupPtyForwarding blindly creates a fresh buffer on the second call,
// every byte from the new PTY ends up trapped in main.ts and never reaches
// the renderer — the user sees a blank terminal and concludes the agent
// didn't start. drainedSids lets the second setup skip buffering.
const drainedSids = new Set<string>();
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
  worktreeCoordinator
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
          fbWhere("status", "in", ["CLAIMED", "IN_PROGRESS"])
        )
      );
      const out: WatchdogTicket[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        // Mission tickets are recovered by the conductor's report-watchdog.
        if (data.missionId) return;
        const projection = data.projection as
          | { lastAgentId?: unknown; lastActivityAt?: unknown }
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
        currentTaskId: a.currentTaskId,
      };
    },
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
            live ? { cwd: live.cwd, model: live.model } : null
          )
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
      return agentManager.listAgents().some((a) => {
        if (a.id === ticket.agentId) return false;
        if (a.status === "stopped" || a.status === "error") return false;
        if (a.currentTaskId && a.currentTaskId === ticket.taskId) return true;
        return !!a.cwd && a.cwd.includes(ticket.taskId);
      });
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
          data.comment ?? ""
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
          buildRespawnDispatch({ ...ticket, model: alt }, null)
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
    escalateStalledInProgress: (ticket, detail) => {
      const msg = `⚠️ [Watchdog] IN_PROGRESS 태스크 ${ticket.taskId} "${
        ticket.title ?? ""
      }" 담당 에이전트 부재/무활동 감지 — ${detail}. 재배정 또는 수동 리셋이 필요합니다.`;
      try {
        orchestrators.get(ticket.projectId)?.injectMessage(msg);
      } catch (err) {
        console.error(
          "[AgentWatchdog] escalateStalledInProgress orch failed:",
          err
        );
      }
      try {
        void telegramPoller.sendMessage(ticket.projectId, msg);
      } catch (err) {
        console.error(
          "[AgentWatchdog] escalateStalledInProgress tg failed:",
          err
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
        fbQuery(fbCollection(db, "tasks"), fbWhere("status", "==", "REVIEW"))
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
          fbWhere("isDelivered", "==", false)
        )
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
  resolveWatchdogConfig()
);

// Per-project orchestrator instances. One window per project is the typical
// usage; if the same project is opened in two windows they share an instance
// (same view, same PTY) — distinct projects stay fully isolated.
const orchestrators = new Map<string, OrchestratorManager>();
// Track which window launched each project's orchestrator (for default
// stop/status routing when the renderer call doesn't carry projectId).
const orchestratorOwners = new Map<string, number>(); // projectId → webContents.id
// Per-project enabledModels for dispatch scoring — replaces the previous
// global process.env.MARBLO_ENABLED_MODELS that races across windows.
const projectEnabledModels = new Map<string, string[]>();

function createOrchestratorInstance(projectId: string): OrchestratorManager {
  const orchestrator = new OrchestratorManager(
    ptyManager,
    agentManager.getConfigGenerator(),
    (status) => {
      refreshWorkPowerSaveBlocker();
      // Route status to the owner window only (multi-window: each window
      // tracks its own orchestrator). Broadcast as fallback when owner is
      // unknown (e.g., scratch instance from getAnyOrchestrator).
      const ownerId = orchestratorOwners.get(projectId);
      if (ownerId !== undefined) {
        sendToOwner(ownerId, "orchestrator:statusChanged", { status });
      } else {
        broadcast("orchestrator:statusChanged", { status });
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
    }
  );
  // "error" alone doesn't say WHY, and a dead rootPath produces no output at
  // all — the shell never starts. Name the cause instead of leaving the user
  // with an orchestrator that just won't attach.
  orchestrator.setRootPathMissingHandler(notifyRootPathMissing);
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
  senderId: number
): OrchestratorManager | null {
  for (const [projectId, ownerId] of orchestratorOwners) {
    if (ownerId === senderId) return orchestrators.get(projectId) ?? null;
  }
  return null;
}

// Connect orchestrator lookup to bridge so MCP tools can notify the right
// orchestrator. Bridge selects by projectId from the request body / agent's
// MARBLO_PROJECT env.
bridgeServer.setOrchestratorLookup(
  (projectId: string) => orchestrators.get(projectId) ?? null
);

// Per-project enabledModels lookup — replaces the global env var fallback
// in BridgeServer.dispatchTask so concurrent windows can dispatch with
// different model presets simultaneously.
bridgeServer.setEnabledModelsLookup((projectId: string) =>
  projectEnabledModels.get(projectId)
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
            updatedAt: fbTimestamp.now(),
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.warn(
        "[DispatchMeta] Failed to persist dispatchMeta for task",
        taskId,
        err instanceof Error ? err.message : err
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
    projection?: {
      lastAgentId?: unknown;
      lastActivitySummary?: unknown;
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
  parentAgentId: string | undefined
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
      // orchestratorOwners is projectId → webContentsId. Any single-project
      // window that has an orchestrator running matches; if multiple, pick
      // the first (deterministic enough for fallback).
      for (const [pid, ownerWin] of orchestratorOwners) {
        return { ownerId: ownerWin, resolvedProjectId: pid };
      }
    }
  }
  return { ownerId: undefined, resolvedProjectId: projectId };
}

bridgeServer.setAgentSpawnedHook(
  ({ sid, projectId, agentId, parentAgentId, name, model, role }) => {
    // (Re-)attach the pending-instruction listener with the current PTY
    // session. On auto-restart `sid` changes, so detach first to discard
    // the stale closure, then attach with the fresh sid.
    pendingListener.detach(agentId);
    pendingListener.attach(agentId, sid);

    const { ownerId, resolvedProjectId } = resolveSpawnOwner(
      projectId,
      parentAgentId
    );
    if (ownerId !== undefined) {
      ptyOwners.set(sid, ownerId);
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
    };
    if (resolvedProjectId) {
      sendToProject(resolvedProjectId, "agent:spawned", payload);
    } else {
      broadcast("agent:spawned", payload);
    }
  }
);

// Inject session resolver so agent auto-restart resolves 'latest' per-agent.
// Stateless file-IO — any instance works.
agentManager.setSessionResolver(
  (rootPath, requested, filterLabel, filterAgentId) =>
    getAnyOrchestrator().resolveSessionId(
      rootPath,
      requested,
      filterLabel,
      filterAgentId
    )
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

// Mission orchestrator lookup — lets /notify-orchestrator route mission-context
// task notifications (contextId=missionId) to the per-project MISSION
// orchestrator instead of the board one, so mission progress stays out of the
// board orchestrator PTY. `missionOrchestrators` is populated lazily by
// ensureMissionOrchestratorLaunched / missionOrchestrator:start; until a mission
// orchestrator exists this returns null and the bridge drops the mission
// notification (never falls back to the board orch).
bridgeServer.setMissionOrchestratorLookup(
  (projectId: string) => missionOrchestrators.get(projectId) ?? null
);

// ── Telegram poller (electron-main-owned, ticket vw38IB2VcmOIOlFV51Wa) ──
// Exactly one getUpdates loop per project, owned here — NOT inside any
// orchestrator (which used to carry --channels and 409-flap on churn).
// Inbound resolves the CURRENT live orchestrator (board wins over mission) and
// injectMessage()s the text; when none is live the poller holds the offset so
// the message is delivered after the next boot (at-least-once). Outbound
// (send_telegram_message MCP tool → bridge) routes into sendMessage().
const telegramPoller = new TelegramPoller({
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
bridgeServer.setSendTelegramMessage((projectId, text, chatId) =>
  telegramPoller.sendMessage(projectId, text, chatId)
);

function telegramInboundTarget(
  manager: OrchestratorManager,
  kind: "board" | "mission"
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
  };
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
      `unanswered=${health.reliability.unanswered} sendFailures=${health.reliability.sendFailures}`
  );
}

function collectWorkPowerSaveSources(): WorkPowerSaveSource[] {
  const sources: WorkPowerSaveSource[] = [];
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
  return sources;
}

function refreshWorkPowerSaveBlocker(): void {
  const sources = preventSleepWhileWorking ? collectWorkPowerSaveSources() : [];
  const nextRefCount = sources.length;
  workPowerSaveRefCount = nextRefCount;

  if (nextRefCount > 0) {
    if (workPowerSaveBlockerId === null) {
      workPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      console.log(
        `[PowerSave] Started prevent-app-suspension blocker id=${workPowerSaveBlockerId} sources=${sources.join(
          ","
        )}`
      );
    }
    return;
  }

  stopWorkPowerSaveBlocker("idle");
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
      `[PowerSave] Stopped prevent-app-suspension blocker (${reason})`
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
    repoRoot: string | undefined
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

  const state = readAppState();
  addRoot(state.lastProjectId, state.lastRootPath);

  return roots;
}

// ── Live routing knowledge-graph updater (spec 2026-07-22 §7) ──────────────
// Folds agent-lifecycle outcomes (stale / crash / merged) into the machine-
// local routing-graph.json so the next dispatch's model scoring reads a learned,
// decaying prior. fetchMeta recovers the dispatch's context (role/tags/complexity/
// model) from the task's dispatchMeta. Every call is best-effort + fire-and-
// forget — a graph write can never break recovery, telemetry, or a merge.
const graphUpdater = new GraphUpdater({
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
}): void => {
  if (!input.taskId) return;
  void graphUpdater.recordOutcome({
    taskId: input.taskId,
    rawOutcome: "merged",
    ctx: input.changeType ? { taskType: input.changeType } : undefined,
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
  };
  if (typeof p.taskId !== "string" || !p.taskId) return;
  foldMergeOutcome({
    taskId: p.taskId,
    changeType: typeof p.changeType === "string" ? p.changeType : null,
    mergedAtMs: typeof p.mergedAtMs === "number" ? p.mergedAtMs : null,
  });
});

// Append-only merge audit trail (WORKTREE-SPEC §6 / autonomy-dial audit log).
// Writes one immutable doc per completed merge to the `merge_history`
// collection, reusing the mission firebase app (anonymous auth) like the
// worktree coordinator's task writer above. Best-effort: the merge handler
// fires this without awaiting, so a Firestore failure never affects the merge.
const recordMergeHistory = async (
  record: MergeHistoryRecord
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
  invalidateRemovedWorktreeRoots
);

function createMissionOrchestratorInstance(
  projectId: string
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
    "mission" // kind — board orchestrator 와 sessionId / MCP config 분리
  );
  orchestrator.setRootPathMissingHandler(notifyRootPathMissing);
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
  const st = readAppState();
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
  missionId?: string
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
  const missionModel = normalizeOrchestratorModelType(
    applyOrchestratorModelEnvForProject(projectId)
  );
  // resume 결정:
  //  - missionId 알면: 그 미션의 세션이 있으면 resume(스텝→스텝 / 앱 재시작 이어가기),
  //    없으면 "new"(새 미션 = fresh 세션 + 초기 프롬프트).
  //  - missionId 미상(렌더러 부팅 reconnect): 직전 mission 세션 resume.
  //  - gpt: codex rollout id 는 저장하지 않으므로 격리 CODEX_HOME 에 세션이
  //    실재하고 (미션 지정 시) 그 미션이 마지막 소유자로 마킹된 경우에만
  //    "latest"(`codex resume --last`), 아니면 "new".
  let resumeId: string;
  if (missionModel === "gpt") {
    const hasSavedCodexSession = agentManager
      .getConfigGenerator()
      .hasSavedSession(`orchestrator-mission-${projectId}`, "gpt");
    const missionOwnsLast = missionId
      ? manager.hasGptMissionMarker(rootPath, missionId)
      : true;
    resumeId = hasSavedCodexSession && missionOwnsLast ? "latest" : "new";
    if (resumeId === "new" && hasSavedCodexSession && missionId) {
      console.log(
        `[MissionOrchestrator] Saved codex session belongs to another mission — starting fresh for mission ${missionId}`
      );
    }
  } else {
    resumeId = missionId
      ? manager.resolveMissionResumeId(rootPath, missionId) ?? "new"
      : manager.resolveOrchestratorResumeId(rootPath) ?? "new";
  }
  manager.launch(
    projectId,
    rootPath,
    bridgeServer.getPort(),
    (sid) => {
      // 소유 윈도우를 알면 그 창으로 라우팅, 모르면 setupPtyForwarding 의
      // mainWindow 폴백 + 버퍼링으로 패널이 나중에 붙어도 backlog 수신.
      const ownerId = missionOrchestratorOwners.get(projectId);
      if (ownerId !== undefined) ptyOwners.set(sid, ownerId);
      setupPtyForwarding(sid);
      hookOrchestratorActivity(sid, projectId);
      logTelegramRouteHealth(projectId, "mission-launch-pty-ready");
    },
    resumeId,
    missionId,
    { modelOverride: missionModel }
  );
  return manager;
}

/**
 * Feed orchestrator PTY "busy" signals to the Telegram poller so its un-replied
 * nudge can detect a busy→idle turn boundary. node-pty onData is add-only, so
 * this extra listener coexists with setupPtyForwarding's. Cheap: a regex test
 * per chunk, and markOrchestratorActivity is a no-op unless an inbound is
 * awaiting a reply for this project.
 */
function hookOrchestratorActivity(sid: string, projectId: string): void {
  if (!projectId) return;
  ptyManager.onData(sid, (data) => {
    if (isBusySignal(data)) telegramPoller.markOrchestratorActivity(projectId);
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
    "[Mission] disabled for MVP — set VITE_DEV_FEATURES=missions to enable the tab + engine"
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
  Timestamp as fbTimestamp,
} from "firebase/firestore";
import {
  evaluateGhostReclaim,
  evaluateAccumulationAlert,
  parseWorktreeTaskPath,
  deriveRepoRootFromGitFile,
  isWorktreeSweepEligibleTaskStatus,
} from "./agent-lifecycle-reclaim";
import { applyProjection } from "./mcp-server/projection";

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
const costTracker = new CostTracker((agentId, cost) => {
  const agent = agentManager.getAgent(agentId);
  const projectId = agent?.launchConfig?.env?.MARBLO_PROJECT || "";
  if (!projectId) {
    console.warn(
      `[CostTracker:CB] No projectId for agent ${agentId} — recording with empty projectId`
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
    } cost=$${cost.deltaCost.toFixed(4)}`
  );

  // Also send token:usage telemetry event with projectId
  mainTelemetry.tokenUsage(
    mainWindow,
    agentId,
    cost.model,
    cost.deltaInputTokens,
    cost.deltaOutputTokens,
    cost.deltaCost,
    projectId
  );
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

// Restore model preset from app state
const savedPreset = readAppState().modelPreset;
if (savedPreset) process.env.MARBLO_MODEL_PRESET = savedPreset;

const INITIAL_ORCHESTRATOR_MODEL_ENV =
  process.env.MARBLO_ORCHESTRATOR_MODEL?.trim() || "";

function normalizeOrchestratorModelSetting(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "claude";
  if (raw === "gpt") return "codex";
  if (raw === "claude" || raw === "codex" || raw === "antigravity") {
    return raw;
  }
  return "claude";
}

function normalizeOrchestratorModelType(value: unknown): ModelType {
  const normalized = normalizeOrchestratorModelSetting(value);
  if (normalized === "codex") return "gpt";
  if (normalized === "antigravity") return "antigravity";
  return "claude";
}

/** 프로젝트별 저장 모델 (없으면 null). 반환값은 정규화된 설정 문자열. */
function readProjectOrchestratorModel(projectId?: string): string | null {
  if (!projectId) return null;
  const stored = readAppState().orchestratorModelByProject?.[projectId];
  return stored ? normalizeOrchestratorModelSetting(stored) : null;
}

/** 프로젝트별 오케 모델 기록 — launch/switch 성공 경로에서 호출. */
function saveProjectOrchestratorModel(projectId: string, model: string): void {
  if (!projectId) return;
  const normalized = normalizeOrchestratorModelSetting(model);
  const map = { ...(readAppState().orchestratorModelByProject ?? {}) };
  if (map[projectId] === normalized) return;
  map[projectId] = normalized;
  writeAppState({ orchestratorModelByProject: map });
  console.log(
    `[Main] Orchestrator model for project ${projectId} recorded: ${normalized}`
  );
}

/**
 * 이 프로젝트의 오케 launch/resolve 가 사용할 모델을 결정하고
 * MARBLO_ORCHESTRATOR_MODEL env 에 반영한다 (agent-config 의
 * resolveOrchestratorModel 이 env 를 읽으므로). 우선순위:
 * 부팅 env 오버라이드 > 이번 launch 의 명시 요청(패널 Start) >
 * 프로젝트별 저장 모델(재시작 연속성) > 전역 설정.
 */
function applyOrchestratorModelEnvForProject(
  projectId?: string,
  explicitModel?: string
): string {
  const effective = resolveEffectiveOrchestratorModelSetting({
    envOverride: INITIAL_ORCHESTRATOR_MODEL_ENV,
    explicit: explicitModel
      ? normalizeOrchestratorModelSetting(explicitModel)
      : null,
    perProject: readProjectOrchestratorModel(projectId),
    globalSetting: normalizeOrchestratorModelSetting(
      readAppState().orchestratorModel
    ),
  });
  process.env.MARBLO_ORCHESTRATOR_MODEL = effective;
  return effective;
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
  output: Record<string, unknown>
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

    try {
      const instance = agentManager.launch({
        id: agentId,
        name: spawnConfig.name,
        model,
        role: spawnConfig.role,
        command: getDefaultCommand(model),
        cwd,
        initialPrompt: resolvedTask,
        onPtyReady: (sid) => {
          // Tag the PTY's owner so output is routed to the project's window
          // only — same pattern as the bridge agentSpawnedHook above.
          if (owningProjectId) {
            const ownerId = getOwnerForProject(owningProjectId);
            if (ownerId !== undefined) ptyOwners.set(sid, ownerId);
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
        role: spawnConfig.role,
        flowNodeId: nodeId,
      };
      if (owningProjectId) {
        sendToProject(owningProjectId, "agent:spawned", spawnedPayload);
      } else {
        broadcast("agent:spawned", spawnedPayload);
      }

      console.log(
        `[Flow:AgentDelegation] Spawned agent "${spawnConfig.name}" (${agentId}) for node ${nodeId}`
      );
    } catch (err) {
      console.error(
        `[Flow:AgentDelegation] Failed to spawn agent for node ${nodeId}:`,
        err
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
        `[Flow:AgentDelegation] Sent task to existing agent "${agent.name}" (${existingAgentId}) for node ${nodeId}`
      );
    } else {
      console.warn(
        `[Flow:AgentDelegation] Agent ${existingAgentId} not found or stopped. Cannot route task for node ${nodeId}.`
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
  // The app's own loaded origin (dev server + prod static server).
  if (host === "localhost" || host === "127.0.0.1") return true;

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
  webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalNavigationUrl(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // In-place top-level navigation: if the page tries to navigate the window to
  // an external http(s) URL, cancel it and hand off to the OS browser instead.
  // App-origin / auth navigations pass through untouched (see
  // isInternalNavigationUrl) so app boot and OAuth redirects are never hijacked.
  webContents.on("will-navigate", (event, url) => {
    if (!isInternalNavigationUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
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
    win.loadURL(`http://localhost:5173${detachedQuery}`);
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
            "차단하고 있을 수 있습니다.\n\n앱을 완전히 종료한 뒤 다시 실행해 주세요."
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
    for (const [sid, ownerId] of ptyOwners) {
      if (ownerId === closedSenderId) ptyOwners.delete(sid);
    }
    for (const [pid, ownerId] of orchestratorOwners) {
      if (ownerId === closedSenderId) {
        orchestratorOwners.delete(pid);
        // Stop the orchestrator owned by the closing window so its PTY isn't
        // left running with no place to send output.
        orchestrators.get(pid)?.stop();
      }
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
        allWindows.size > 0 ? allWindows.values().next().value ?? null : null;
      if (mainWindow) bridgeServer.setMainWindow(mainWindow);
    }
  });

  win.once("ready-to-show", () => {
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
  seed?: { rootPath?: string; projectId?: string }
): BrowserWindow {
  const win = createWindow(true, view);
  // External-link handling is already applied via createWindow; re-asserting it
  // here is a no-op (WeakSet-guarded) but keeps the contract explicit.
  applyExternalLinkHandling(win.webContents);
  // Always tag the per-window record as detached (even with no seed) so this
  // pop-out is never written into the persisted multi-window session — it's a
  // sub-panel of its parent project, not a standalone window to restore.
  windowRestore.set(win.webContents.id, {
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
function restoreWindowSession(): void {
  // Dedupe on read too — an app-state.json written by an older build (before
  // detached windows were excluded) can hold the same project many times.
  // selectPersistableWindows collapses those so we never reopen duplicates.
  const state = readAppState();
  const persistable = selectPersistableWindows(state.windows ?? []);

  // Drop / re-point windows whose folder died while the app was closed —
  // typically a git worktree cleaned up between sessions. Opening a window on a
  // path that no longer exists produces no error of its own; it just yields a
  // window where nothing can spawn. See resolveRestoreRoots.
  const { windows: resolved, dropped } = resolveRestoreRoots(
    persistable,
    (p) => fs.existsSync(p),
    state.lastRootPath ? { defaultRootPath: state.lastRootPath } : undefined
  );
  for (const w of dropped) {
    console.warn(
      `[Window] Saved window root no longer exists and has no fallback — not reopening: "${w.rootPath}"`
    );
  }
  const saved = resolved.slice(0, 10); // sanity cap — never spawn a runaway number of windows
  if (saved.length === 0) {
    // Every saved root is gone. Tell the user why they're back at the folder
    // picker instead of on their projects, then open one empty window.
    const firstDead = dropped[0]?.rootPath;
    if (firstDead) notifyRootPathMissing(firstDead);
    createWindow();
    return;
  }
  saved.forEach((w, i) => {
    // First window is primary; the rest open as additional windows. Their
    // seeded restore state makes them reconnect rather than show the picker.
    const win = createWindow(i > 0);
    windowRestore.set(win.webContents.id, {
      rootPath: w.rootPath,
      projectId: w.projectId,
    });
    if (w.fellBackFrom) {
      console.warn(
        `[Window] Saved root "${w.fellBackFrom}" no longer exists — reopening on "${w.rootPath}" instead`
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
  const owner = ptyOwners.get(id);
  return owner === undefined || owner === senderId;
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
  ptyOwners.set(id, event.sender.id);

  // Use same buffer-then-live pattern as agents (survives React StrictMode)
  setupPtyForwarding(id);

  return { id: session.id, name: session.name, shell: session.shell };
});

// pty:write uses ipcMain.on (one-way) — keystrokes shouldn't pay invoke's round-trip cost
ipcMain.on("pty:write", (event, { id, data }) => {
  if (!isPtyCallerOwner(event.sender.id, id)) return;
  ptyManager.write(id, data);
});

// pty:writeAndSubmit — inject a message and submit it as a discrete Enter.
// Used by programmatic senders (e.g. FeedbackInput) that aren't raw keystroke
// passthrough: routes through the same verify-and-retry submit logic as
// orchestrator/agent message injection so the CR actually registers.
ipcMain.on(
  "pty:writeAndSubmit",
  (
    event,
    {
      id,
      data,
      bracketedPaste,
    }: { id: string; data: string; bracketedPaste?: boolean }
  ) => {
    if (!isPtyCallerOwner(event.sender.id, id)) return;
    ptyManager.writeAndSubmit(id, data, undefined, bracketedPaste);
  }
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
  // We only clear during the initial buffering window (before pty:replay
  // drains the buffer). After replay, ptyBuffers no longer has the id, so
  // this is a no-op.
  const buf = ptyBuffers.get(id);
  if (buf && buf.length > 0) {
    buf.length = 0;
    console.log(
      `[PTY:RESIZE] Cleared pre-resize buffer for ${id} (now ${cols}x${rows})`
    );
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
    }
    return result;
  }
);

ipcMain.handle("auth:clearAgentCustomToken", () => clearAgentCustomToken());

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
      resolve({ code: 1, stdout, stderr: err.message });
    });
    proc.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function truncateBoardDiff(diff: string): string {
  if (diff.length <= BOARD_DIFF_MAX_BYTES) return diff;
  return `${diff.slice(
    0,
    BOARD_DIFF_MAX_BYTES
  )}\n\n...(truncated - run git diff locally for full output)`;
}

async function buildBoardWorktreeDiff(
  worktreePath: string,
  baseRef: string
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
    worktreePath
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
    worktreePath
  );
  if (tracked.code !== 0) {
    throw new Error(`git diff failed: ${tracked.stderr.trim()}`);
  }

  const parts = [tracked.stdout.trimEnd()].filter(Boolean);
  const untracked = await runBoardGit(
    ["ls-files", "--others", "--exclude-standard"],
    worktreePath
  );
  if (untracked.code === 0) {
    for (const filePath of untracked.stdout.split("\n").filter(Boolean)) {
      const fileDiff = await runBoardGit(
        ["diff", "--no-index", "--no-color", "--", "/dev/null", filePath],
        worktreePath
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
  }
);

// --- File System IPC Handlers ---
ipcMain.handle("fs:readTree", (_event, rootPath: string) => {
  return fsManager.readTree(rootPath);
});

ipcMain.handle(
  "fs:readFile",
  (_event, { rootPath, filePath }: { rootPath: string; filePath: string }) => {
    // Containment guard, symmetric with the mutation handlers below — blocks
    // reads of arbitrary absolute paths (e.g. ~/.ssh/config) via this IPC.
    fsGuard(rootPath, filePath);
    return fsManager.readFile(filePath);
  }
);

ipcMain.handle(
  "fs:writeFile",
  (
    _event,
    {
      rootPath,
      filePath,
      content,
    }: { rootPath: string; filePath: string; content: string }
  ) => {
    // Containment guard — blocks writes of arbitrary absolute paths.
    fsGuard(rootPath, filePath);
    fsManager.writeFile(filePath, content);
  }
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
    { rootPath, baseRef }: { rootPath: string; baseRef: string }
  ) => {
    return fsManager.getWorktreeChanges(rootPath, baseRef);
  }
);

ipcMain.handle(
  "fs:gitDiff",
  async (_event, filePath: string, baseSha?: string) => {
    return fsManager.getGitDiff(filePath, baseSha);
  }
);

ipcMain.handle("fs:gitRemoteUrl", async (_event, rootPath: string) => {
  return fsManager.getGitRemoteUrl(rootPath);
});

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
  }
);

ipcMain.handle(
  "fs:createDirectory",
  (_event, { rootPath, dirPath }: { rootPath: string; dirPath: string }) => {
    fsGuard(rootPath, dirPath);
    fsManager.createDirectory(dirPath);
    return { success: true, path: dirPath };
  }
);

ipcMain.handle(
  "fs:rename",
  (
    _event,
    {
      rootPath,
      fromPath,
      toPath,
    }: { rootPath: string; fromPath: string; toPath: string }
  ) => {
    fsGuard(rootPath, fromPath, toPath);
    fsManager.rename(fromPath, toPath);
    return { success: true, fromPath, toPath };
  }
);

ipcMain.handle(
  "fs:remove",
  (
    _event,
    { rootPath, targetPath }: { rootPath: string; targetPath: string }
  ) => {
    fsGuard(rootPath, targetPath);
    fsManager.remove(targetPath);
    return { success: true, path: targetPath };
  }
);

ipcMain.handle(
  "fs:copy",
  (
    _event,
    {
      rootPath,
      fromPath,
      toPath,
    }: { rootPath: string; fromPath: string; toPath: string }
  ) => {
    fsGuard(rootPath, fromPath, toPath);
    const finalPath = fsManager.copy(fromPath, toPath);
    return { success: true, fromPath, toPath: finalPath };
  }
);

// Read a file as base64 — used by the Code tab's ImagePreview to render raster
// images (png/jpg/webp/…), whose bytes are meaningless as utf-8 text.
ipcMain.handle(
  "fs:readFileBase64",
  async (
    _event,
    { rootPath, filePath }: { rootPath: string; filePath: string }
  ) => {
    // Containment guard, symmetric with the mutation handlers.
    fsGuard(rootPath, filePath);
    const buf = await fs.promises.readFile(filePath);
    return buf.toString("base64");
  }
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
    }: { rootPath: string; destDir: string; srcPaths: string[] }
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
            `${base} copy${i > 1 ? ` ${i}` : ""}${ext}`
          );
          i += 1;
        } while (fs.existsSync(dest));
      }
      await fs.promises.cp(src, dest, { recursive: true, errorOnExist: false });
      imported.push(dest);
    }
    return { success: true, imported };
  }
);

ipcMain.handle("fs:revealInFinder", (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath);
  return { success: true };
});

function makeConnectionCheckItem(
  id: ConnectionCheckItem["id"],
  label: string,
  status: ConnectionCheckStatus,
  detail: string
): ConnectionCheckItem {
  return { id, label, status, detail };
}

// parseGitHubRepoSlug / repoUrlsMatch 는 connection-store 의 단일 진실원에서
// import 한다(origin↔repoUrl 일치 비교와 동일 로직 재사용).

function runConnectionCheckCommand(
  command: string,
  args: string[],
  cwd: string | undefined,
  timeoutMs = 10_000
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
  projectId: string
): Promise<ConnectionCheckResult> {
  const checkedAt = Date.now();
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
          "프로젝트 연결 정보가 없습니다."
        ),
        makeConnectionCheckItem(
          "branch",
          "Branch",
          "fail",
          "기본 브랜치를 확인할 연결 정보가 없습니다."
        ),
        makeConnectionCheckItem(
          "issues",
          "Issue read",
          "fail",
          "Issue 조회를 위한 repo 연결 정보가 없습니다."
        ),
        makeConnectionCheckItem(
          "pullRequest",
          "PR create",
          "fail",
          "PR 권한을 확인할 repo 연결 정보가 없습니다."
        ),
        makeConnectionCheckItem(
          "auth",
          "Token/auth",
          "fail",
          "GitHub 인증 상태를 확인할 연결 정보가 없습니다."
        ),
      ],
    };
  }

  const cwd = fs.existsSync(connection.localPath)
    ? connection.localPath
    : undefined;
  const repoSlug = parseGitHubRepoSlug(connection.repoUrl);
  const hasGitHubMcp = connection.availableMcps.some((mcp) =>
    /github/i.test(mcp)
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
        "로컬 경로가 없어 origin 일치 여부를 확인할 수 없습니다."
      )
    );
  } else {
    const origin = await runConnectionCheckCommand(
      "git",
      ["remote", "get-url", "origin"],
      cwd
    );
    const localOrigin = origin.code === 0 ? origin.stdout.trim() : "";
    if (!connection.repoUrl) {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "warn",
          "저장된 repo URL이 없어 로컬 origin과 비교할 수 없습니다."
        )
      );
    } else if (!localOrigin) {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "warn",
          "로컬 git origin을 확인하지 못해 일치 여부를 비교할 수 없습니다."
        )
      );
    } else if (repoUrlsMatch(localOrigin, connection.repoUrl)) {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "pass",
          `로컬 origin이 저장된 repo와 일치합니다 (${
            parseGitHubRepoSlug(connection.repoUrl) ?? connection.repoUrl
          }).`
        )
      );
    } else {
      items.push(
        makeConnectionCheckItem(
          "mismatch",
          "Repo match",
          "fail",
          `로컬 origin(${localOrigin})이 저장된 repo URL(${connection.repoUrl})과 다릅니다. 잘못된 repo에 작업할 위험이 있습니다.`
        )
      );
    }
  }

  const auth = await runConnectionCheckCommand(
    "gh",
    ["auth", "status", "-h", "github.com"],
    cwd
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
        : "GitHub CLI를 찾을 수 없습니다. GitHub MCP 또는 gh 인증 경로가 필요합니다."
    )
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
      cwd
    );
    if (repo.code === 0) repoView = parseRepoView(repo.stdout);
    items.push(
      makeConnectionCheckItem(
        "repo",
        "Repo access",
        repo.code === 0 ? "pass" : "fail",
        repo.code === 0
          ? `${repoSlug} 접근 가능`
          : repo.stderr || `${repoSlug} 접근 확인 실패`
      )
    );
  } else if (connection.repoUrl) {
    const repo = await runConnectionCheckCommand(
      "git",
      ["ls-remote", "--exit-code", connection.repoUrl, "HEAD"],
      cwd
    );
    items.push(
      makeConnectionCheckItem(
        "repo",
        "Repo access",
        repo.code === 0 ? "warn" : "fail",
        repo.code === 0
          ? "git remote 접근은 가능하지만 GitHub 인증 점검은 통과하지 못했습니다."
          : repo.stderr || "repo 접근 확인 실패"
      )
    );
  } else {
    items.push(
      makeConnectionCheckItem(
        "repo",
        "Repo access",
        "fail",
        "repo URL이 연결 정보에 없습니다."
      )
    );
  }

  const defaultBranch =
    connection.defaultBranch ?? repoView?.defaultBranch ?? null;
  if (repoSlug && ghAuthed && defaultBranch) {
    const branch = await runConnectionCheckCommand(
      "gh",
      ["api", `repos/${repoSlug}/branches/${defaultBranch}`],
      cwd
    );
    items.push(
      makeConnectionCheckItem(
        "branch",
        "Branch",
        branch.code === 0 ? "pass" : "fail",
        branch.code === 0
          ? `${defaultBranch} 브랜치 확인`
          : branch.stderr || `${defaultBranch} 브랜치 확인 실패`
      )
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
      cwd
    );
    items.push(
      makeConnectionCheckItem(
        "branch",
        "Branch",
        branch.code === 0 ? "warn" : "fail",
        branch.code === 0
          ? `${defaultBranch} 브랜치는 확인했지만 GitHub API 인증은 통과하지 못했습니다.`
          : branch.stderr || `${defaultBranch} 브랜치 확인 실패`
      )
    );
  } else {
    items.push(
      makeConnectionCheckItem(
        "branch",
        "Branch",
        "fail",
        "기본 브랜치 정보가 없습니다."
      )
    );
  }

  if (repoSlug && ghAuthed) {
    const issues = await runConnectionCheckCommand(
      "gh",
      ["issue", "list", "--repo", repoSlug, "--limit", "1", "--json", "number"],
      cwd
    );
    items.push(
      makeConnectionCheckItem(
        "issues",
        "Issue read",
        issues.code === 0 ? "pass" : "fail",
        issues.code === 0
          ? "Issue 조회 가능"
          : issues.stderr || "Issue 조회 권한 확인 실패"
      )
    );
  } else {
    items.push(
      makeConnectionCheckItem(
        "issues",
        "Issue read",
        "fail",
        "GitHub 인증이 없어 Issue 조회를 확인하지 못했습니다."
      )
    );
  }

  const viewerPermission = repoView?.viewerPermission;
  const canWriteToRepo = ["ADMIN", "MAINTAIN", "WRITE"].includes(
    viewerPermission ?? ""
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
        : "GitHub repo 권한 정보를 확인하지 못했습니다."
    )
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
  }
);

ipcMain.handle(
  "connection:touchLastRun",
  (_event, { projectId, at }: { projectId: string; at?: number }) => {
    return touchProjectLastRun(projectId, at);
  }
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
    { projectId, accessMode }: { projectId: string; accessMode: AccessMode }
  ) => {
    return withAvailableMcps(setAccessMode(projectId, accessMode));
  }
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

ipcMain.handle("telegramChannel:remove", (_event, projectId: string) => {
  const removed = removeTelegramChannel(projectId);
  // 채널 삭제 → 해당 프로젝트 폴러 루프 정지.
  telegramPoller.syncActiveChannels();
  // 원격 메타도 삭제 전파 — 다른 기기에서 제거된 채널이 좀비 복원되는 것 방지.
  void pushTelegramChannelMetaOne(projectId, getMachineId());
  return removed;
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
  }
  const gen = (sidGen.get(sid) ?? 0) + 1;
  sidGen.set(sid, gen);

  ptyManager.onData(sid, (data) => {
    if (sid.startsWith("agent-")) {
      costTracker.processOutput(sid.replace("agent-", ""), data);
    }

    if (ptyBuffers.has(sid)) {
      ptyBuffers.get(sid)!.push(data);
      return;
    }

    // Live mode — route to the owner window only. Falls back to mainWindow
    // if owner isn't tracked (legacy paths) or has been closed.
    sendToOwner(ptyOwners.get(sid), `pty:data:${sid}`, data);
  });

  ptyManager.onExit(sid, (exitCode) => {
    // Stale guard: a newer setupPtyForwarding(sid) replaced us (e.g. via
    // agent restart). Letting the OLD pty's exit run would nuke the NEW
    // pty's ptyOwners/ptyBuffers entries and forward a phantom exit to
    // the renderer mid-restart.
    if (sidGen.get(sid) !== gen) return;
    const ownerId = ptyOwners.get(sid);
    ptyBuffers.delete(sid);
    sendToOwner(ownerId, `pty:exit:${sid}`, exitCode);
    ptyOwners.delete(sid);
  });
}

async function resolveLaneLaunchContext(
  taskId: string | undefined
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
      err
    );
    return undefined;
  }
}

ipcMain.handle(
  "agent:launch",
  async (
    event,
    { agent, cwd, initialPrompt, resumeSessionId, projectId, taskId }
  ) => {
    // Pre-spawn auth gate (claude/codex). Block an unauthenticated spawn before
    // any worktree/PTY side effects so the CLI never boots into its login
    // prompt. Ungated models (gemini/agy/custom) pass through. Resume launches
    // are gated too — a lapsed login should still surface, not hang.
    const agentGate = await checkSpawnAuthGate(agent.model);
    if (!agentGate.ok) {
      console.warn(
        `[agent:launch] Blocked "${agent.name}" — ${agentGate.model} ${agentGate.reason} (action: ${agentGate.action})`
      );
      return {
        id: "",
        ptySessionId: "",
        status: "blocked",
        needsAuth: {
          model: agentGate.model ?? agent.model,
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
          `[agent:launch] agy resolve 'latest' for "${agent.name}" → ${resolvedSessionId}`
        );
      } else if (agent.model === "gpt" || agent.model === "gemini") {
        // Codex/Gemini sessions live in this agent's isolated home, NOT in
        // ~/.claude — so the Claude resolver below must not run for them.
        // It matches on agentId/label, so an agent that once ran as Claude
        // and was switched to Codex still has a Claude label bearing its id;
        // resolving it here would emit `codex resume <claude-uuid>`, which
        // exits 1 ("No saved session found with ID ..."). Pass the native
        // "latest" sentinel instead, and only when a session actually exists.
        resolvedSessionId = agentManager
          .getConfigGenerator()
          .hasSavedSession(agent.id, agent.model)
          ? "latest"
          : "new";
        console.log(
          `[agent:launch] Resolved 'latest' for "${agent.name}" (${agent.model}) → ${resolvedSessionId}`
        );
      } else {
        // Stateless file-IO — any orchestrator instance reads the same on-disk
        // session metadata, so we don't need a project-specific instance here.
        const resolved = getAnyOrchestrator().resolveSessionId(
          launchCwd,
          "latest",
          agent.name,
          agent.id
        );
        resolvedSessionId = resolved ?? "new";
        console.log(
          `[agent:launch] Resolved 'latest' for "${agent.name}" → ${resolvedSessionId}`
        );
      }
    }

    const senderId = event.sender.id;
    const laneContextId = await resolveLaneLaunchContext(taskId);
    const effectiveInitialPrompt =
      laneContextId && taskId
        ? withCompletionFooter(initialPrompt || "", taskId)
        : initialPrompt;
    const instance = agentManager.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      cwd: launchCwd,
      initialPrompt: effectiveInitialPrompt,
      resumeSessionId: resolvedSessionId,
      projectId,
      currentTaskId: taskId ?? agent.currentTaskId ?? null,
      contextId: laneContextId,
      onPtyReady: (sid) => {
        // Tag agent PTY with owner window so output flows back to the
        // launching window only.
        ptyOwners.set(sid, senderId);
        setupPtyForwarding(sid);
      },
    });

    return {
      id: instance.id,
      ptySessionId: instance.ptySessionId,
      status: instance.status,
      command: instance.command,
      args: instance.launchConfig?.args || [],
    };
  }
);

// Renderer calls this after TerminalView mounts to drain any buffered early output.
// Switches to live mode immediately — subsequent PTY data is sent live via webContents.send.
// (StrictMode dev double-mount is handled by the renderer's `disposed` flag + cleared replay timer.)
ipcMain.handle("pty:replay", (_event, { id }: { id: string }) => {
  const buffer = ptyBuffers.get(id);
  console.log(
    `[PTY:REPLAY] id=${id}, drained ${buffer?.length ?? 0} chunks → live mode`
  );
  // Mark live regardless of buffer presence — second replay call for the
  // same sid (StrictMode dev double-mount, or a stale call) shouldn't undo
  // the drained flag. Future setupPtyForwarding calls for this sid skip
  // re-buffering so restart output flows straight through.
  drainedSids.add(id);
  if (!buffer) return [];
  const data = [...buffer];
  ptyBuffers.delete(id);
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
    ptyOwners.set(instance.ptySessionId, event.sender.id);
  }
  return instance
    ? {
        id: instance.id,
        ptySessionId: instance.ptySessionId,
        status: instance.status,
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
  (event, state: { rootPath?: string; projectId?: string }) => {
    const next = { ...(windowRestore.get(event.sender.id) ?? {}) };
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
  }
);

ipcMain.handle("window:getRestoreState", (event) => {
  return windowRestore.get(event.sender.id) ?? {};
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
    }
  ) => {
    const senderId = event.sender.id;
    // Find session candidates for each agent
    const candidates = findReconnectCandidates(
      agents.map((a) => ({ id: a.id, name: a.name, role: a.role })),
      rootPath
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
          fbWhere("projectId", "==", projectId)
        )
      );
      snap.forEach((d) => {
        machineIdByAgent.set(
          d.id,
          (d.data() as { machineId?: string }).machineId
        );
      });
    } catch (err) {
      console.warn(
        "[Reconnect] machineId map fetch failed — treating all docs as legacy (no auto-launch):",
        err instanceof Error ? err.message : err
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
        ptyOwners.set(existing.ptySessionId, senderId);
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
        thisMachineId
      );
      if (ownership !== "own") {
        console.log(
          `[Reconnect] Agent ${agentData.name} (${agentData.model}) is ${
            ownership === "foreign"
              ? "owned by another machine"
              : "unstamped/legacy"
          } → read-only skip (no launch, no Firestore mutation)`
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
      // - Codex / Gemini: their sessions live in our per-agent isolated
      //   home (created by AgentConfigGenerator), keyed by agentId — same
      //   home survives across app restarts because tmpdir() is persistent
      //   on macOS/Linux. We pass "latest" as a sentinel and the CLI's
      //   own resume logic (`codex resume --last`, `gemini --resume latest`)
      //   picks that agent's most recent session. Skip when the home is
      //   empty so we don't error out on a fresh agent that never ran.
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
              agentData.id
            );
        resumeId = resolveClaudeColdBootResumeId(
          candidate.sessionId,
          nameScoped
        );
      } else {
        const model = agentData.model as
          | "claude"
          | "gemini"
          | "gpt"
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
          `[Reconnect] Agent ${agentData.name} (${agentData.model}) has no resumable session → skip (사용자가 ▶ Start 로 수동 기동)`
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
          agentData.currentTaskId ?? undefined
        );
        const instance = agentManager.launch({
          id: agentData.id,
          name: agentData.name,
          model: agentData.model as
            | "claude"
            | "gemini"
            | "gpt"
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
            ptyOwners.set(sid, senderId);
            setupPtyForwarding(sid);
          },
        });
        results.push({
          agentId: agentData.id,
          reconnected: true,
          ptySessionId: instance.ptySessionId,
        });
        console.log(
          `[Reconnect] Agent ${agentData.name} (${
            agentData.id
          }) reconnected via ${
            candidate.sessionId
              ? "--resume " + candidate.sessionId
              : "--continue"
          }`
        );

        // Start cost tracking — uses sessionId if known, or finds most recent JSONL
        costTracker.trackSession(
          agentData.id,
          rootPath,
          candidate.sessionId,
          agentData.model || "claude"
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
  }
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
    }
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
      missionId
    );
    const session = manager.getSession();
    if (!session) return null;
    // 엔진이 먼저 띄운 경우 forwarding 의 소유 윈도우가 이 패널이 아닐 수 있으니
    // 라이브 출력을 현재 패널 창으로 재라우팅. (초기 backlog 는 pty:replay 가
    // 호출 renderer 에게 직접 반환하므로 순서 무관.)
    ptyOwners.set(session.ptySessionId, event.sender.id);
    return {
      sessionId: session.sessionId,
      ptySessionId: session.ptySessionId,
      status: session.status,
    };
  }
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
  }
);

ipcMain.handle(
  "missionOrchestrator:stop",
  async (_event, projectId: string) => {
    const manager = missionOrchestrators.get(projectId);
    if (manager) {
      manager.stop();
    }
  }
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
  }
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
    projectId?: string
  ): Promise<string | null> => {
    const resolved = rootPath === "~" ? os.homedir() : rootPath;
    // 모델 인지 필수: claude 전용 resolver 가 codex 프로젝트에서 claude uuid 를
    // 돌려주면 `codex resume <uuid>` 즉사로 이어진다. gpt 는 격리 CODEX_HOME 의
    // 세션 실재 여부만으로 "latest"/null 을 판정한다.
    const targetModel = normalizeOrchestratorModelType(
      applyOrchestratorModelEnvForProject(projectId)
    );
    if (targetModel === "gpt") {
      if (!projectId) return null;
      return agentManager
        .getConfigGenerator()
        .hasSavedSession(`orchestrator-mission-${projectId}`, "gpt")
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
  }
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
  }
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
  snap: Awaited<ReturnType<typeof fbGetDocs>>
): RawHandoffDoc[] {
  return snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));
}

async function buildSwitchHandoffSnapshot(
  args: OrchestratorSwitchArgs,
  resolvedRootPath: string,
  targetModel: ModelType
) {
  const { app: missionApp, authReady } = getMissionFirebaseApp();
  await authReady;
  const db = getFirestore(missionApp);
  const current = orchestrators.get(args.projectId)?.getSession() ?? null;
  const resumeSessionId = resolveSwitchHandoffResumeSessionId({
    resume: args.resume,
    targetModel,
    hasSavedGptSession: () =>
      agentManager
        .getConfigGenerator()
        .hasSavedSession(`orchestrator-${args.projectId}`, "gpt"),
    resolvePreviousNonGptSession: () =>
      getAnyOrchestrator().resolveOrchestratorResumeId(resolvedRootPath),
  });
  const [missionSnap, taskSnap] = await Promise.all([
    fbGetDocs(
      fbQuery(
        fbCollection(db, "missions"),
        fbWhere("projectId", "==", args.projectId)
      )
    ),
    fbGetDocs(
      fbQuery(
        fbCollection(db, "tasks"),
        fbWhere("projectId", "==", args.projectId)
      )
    ),
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
    }
  ): Promise<OrchestratorSwitchResult> => {
    const projectId = rawArgs.projectId;
    if (!projectId || !rawArgs.rootPath) {
      throw new Error("projectId and rootPath required");
    }

    const resolvedRootPath =
      rawArgs.rootPath === "~" ? os.homedir() : rawArgs.rootPath;
    const targetModel = normalizeOrchestratorModelType(rawArgs.targetModel);
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
            existing
          )})`
        );
        return existing.promise;
      }
      console.error(
        `[orchestratorSession:switch] Dropping stale switch lock for project ${projectId}; previous ${describeSwitchLock(
          existing
        )}`
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

    const op = runOrchestratorSwitch(args, {
      buildSnapshot: (switchArgs) =>
        buildSwitchHandoffSnapshot(switchArgs, resolvedRootPath, targetModel),
      checkAuth: async (model) => {
        const gate = await checkSpawnAuthGate(model);
        return {
          ok: gate.ok,
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
        orchestratorOwners.set(projectId, senderId);
        const handoffPrompt = formatHandoffPrompt(snapshot, switchArgs.mode);
        const session = orch.launch(
          projectId,
          resolvedRootPath,
          port,
          (sid) => {
            ptyOwners.set(sid, senderId);
            setupPtyForwarding(sid);
            hookOrchestratorActivity(sid, projectId);
            logTelegramRouteHealth(projectId, "switch-new-pty-ready");
          },
          snapshot.to.resumeSessionId,
          undefined,
          {
            modelOverride: targetModel,
            handoffPrompt,
            handoffMode: switchArgs.mode,
          }
        );
        // 스위치로 모델이 바뀌면 이 프로젝트의 재시작 연속성도 새 모델을 따른다.
        saveProjectOrchestratorModel(projectId, targetModel);
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
          `[orchestratorSession:switch] project=${projectId} stage=${stage} target=${targetModel} mode=${args.mode}`
        );
      },
      onWarning: (message, error) => {
        console.warn(`[orchestratorSession:switch] ${message}`, error);
      },
    })
      .catch((error: unknown) => {
        if (error instanceof OrchestratorSwitchStepTimeoutError) {
          console.error(
            `[orchestratorSession:switch] Timeout at ${error.step} for project ${projectId}; lock will be released`
          );
        } else {
          console.error(
            `[orchestratorSession:switch] Failed for project ${projectId}; lock will be released`,
            error
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
      `[orchestratorSession:switch] Starting switch project=${projectId} target=${targetModel} mode=${args.mode} resume=${args.resume}`
    );
    orchestratorSwitchLocks.set(projectId, lock);
    return op;
  }
);

ipcMain.handle(
  "orchestratorSession:launch",
  async (
    event,
    { projectId, rootPath, resumeSessionId, enabledModels, model }
  ) => {
    const port = bridgeServer.getPort();
    // Resolve '~' to actual home directory
    const resolvedPath = rootPath === "~" ? os.homedir() : rootPath;
    // 모델 결정: 명시 요청(패널 Start) > 프로젝트별 저장(재시작 연속성) > 전역.
    // 전역값만 쓰면 마지막으로 만진 프로젝트의 모델이 다른 프로젝트의 재시작에
    // 적용돼 claude 대화를 가진 프로젝트가 codex fresh 로 부팅된다(라이브 사고).
    applyOrchestratorModelEnvForProject(
      projectId,
      typeof model === "string" ? model : undefined
    );
    const orchestratorModel = resolveOrchestratorModel();

    // Pre-spawn auth gate. If the selected CLI is not installed / logged in,
    // DON'T spawn it into an interactive login
    // prompt (which would hang the readiness loop and dump the boot prompt
    // into the login menu). Return a needsAuth marker so the renderer can open
    // the CLI setup gate instead of silently failing. (QA vj7ZvHphYOIhsNd340ad)
    const orchGate = await checkSpawnAuthGate(orchestratorModel);
    if (!orchGate.ok) {
      console.warn(
        `[orchestratorSession:launch] Blocked — ${orchestratorModel} ${orchGate.reason} (action: ${orchGate.action})`
      );
      return {
        sessionId: "",
        ptySessionId: "",
        status: "blocked",
        needsAuth: {
          model: orchGate.model ?? orchestratorModel,
          action: orchGate.action ?? "claude login",
          installed: orchGate.installed,
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
    orchestratorOwners.set(projectId, senderId);
    const session = orch.launch(
      projectId,
      resolvedPath,
      port,
      (sid) => {
        // Tag the PTY session with its owner window so output is routed
        // back only to that window (not broadcast / mainWindow-only).
        ptyOwners.set(sid, senderId);
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
      { modelOverride: orchestratorModel }
    );

    // 재시작 연속성: 이 프로젝트 오케가 실제로 뜬 모델을 기록. 다음 앱 재시작의
    // auto-reconnect(모델 미명시)는 전역 대신 이 값을 따른다.
    saveProjectOrchestratorModel(projectId, orchestratorModel);

    return {
      sessionId: session.sessionId,
      ptySessionId: session.ptySessionId,
      status: session.status,
    };
  }
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
      ? orchestrators.get(explicit) ?? null
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
  }
);

ipcMain.handle(
  "orchestratorSession:status",
  (event, payload?: { projectId?: string }) => {
    const explicit = payload?.projectId;
    const orch = explicit
      ? orchestrators.get(explicit) ?? null
      : getOrchestratorForSender(event.sender.id);
    return orch?.getStatus() ?? "stopped";
  }
);

ipcMain.handle(
  "orchestratorSession:listSessions",
  (_event, rootPath: string) => {
    const resolvedPath = rootPath === "~" ? os.homedir() : rootPath;
    // Stateless file-IO — any instance works.
    return getAnyOrchestrator().listSessions(resolvedPath);
  }
);

// Resolve the best previous orchestrator session to resume: label match,
// else a content-signature scan that recovers it even when the labels file
// is missing (the common case). Returns a concrete session id or null.
ipcMain.handle(
  "orchestratorSession:resolvePrevious",
  (_event, rootPath: string, projectId?: string) => {
    const resolvedPath = rootPath === "~" ? os.homedir() : rootPath;
    // Session identity is per-CLI, so this must be model-aware. Codex keeps
    // its sessions in the isolated CODEX_HOME and resumes via the native
    // `codex resume --last` ("latest" sentinel) — handing it a Claude uuid
    // from the ~/.claude store makes it exit 1 on launch. See
    // resolveRestartResumeSessionId. 모델은 launch 와 같은 프로젝트별
    // 우선순위로 결정해야 resolve/launch 가 서로 다른 모델을 보지 않는다.
    applyOrchestratorModelEnvForProject(projectId);
    return resolveRestartResumeSessionId({
      targetModel: resolveOrchestratorModel(),
      // Without a projectId we cannot inspect the isolated home; assume a
      // session exists and let `--last` decide — it boots a fresh session on
      // an empty home rather than failing.
      hasSavedGptSession: () =>
        projectId
          ? agentManager
              .getConfigGenerator()
              .hasSavedSession(`orchestrator-${projectId}`, "gpt")
          : true,
      resolvePreviousNonGptSession: () =>
        getAnyOrchestrator().resolveOrchestratorResumeId(resolvedPath),
    });
  }
);

// --- Flow IPC Handlers ---

ipcMain.handle(
  "flow:run",
  async (
    _event,
    { flow, inputs }: { flow: Flow; inputs?: Record<string, unknown> }
  ) => {
    kanbanBridge.registerFlow(flow);
    flowNodeCache.set(flow.id, flow);
    const state = await flowRunner.run(flow, inputs);
    // Clean up cache after flow completes
    flowNodeCache.delete(flow.id);
    return state;
  }
);

ipcMain.handle("flow:pause", async (_event, { runId }: { runId: string }) => {
  await flowRunner.pause(runId);
});

ipcMain.handle(
  "flow:resume",
  async (
    _event,
    { runId, humanInput }: { runId: string; humanInput?: HumanInput }
  ) => {
    const state = await flowRunner.resume(runId, humanInput);
    return state;
  }
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
    { content, filePath }: { content: string; filePath: string }
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
  }
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
  }
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
  }
);

ipcMain.handle("settings:getPowerSave", () => {
  return {
    preventSleepWhileWorking,
    active: workPowerSaveBlockerId !== null,
    refCount: workPowerSaveRefCount,
    sources: collectWorkPowerSaveSources(),
  };
});

ipcMain.handle(
  "settings:setPowerSave",
  (_event, settings: { preventSleepWhileWorking?: unknown }) => {
    if (typeof settings.preventSleepWhileWorking !== "boolean") {
      return {
        success: false,
        error: "preventSleepWhileWorking must be a boolean",
      };
    }
    preventSleepWhileWorking = settings.preventSleepWhileWorking;
    writeAppState({ preventSleepWhileWorking });
    refreshWorkPowerSaveBlocker();
    return {
      success: true,
      preventSleepWhileWorking,
      active: workPowerSaveBlockerId !== null,
      refCount: workPowerSaveRefCount,
      sources: collectWorkPowerSaveSources(),
    };
  }
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
    }
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
  }
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

ipcMain.handle("clipboard:getFilePaths", () => {
  if (process.platform === "darwin") {
    try {
      // Use osascript (AppleScript) — no compilation needed, fast
      const result = execSync(
        `osascript -e 'set filePaths to {}' -e 'try' -e 'set theClip to the clipboard as «class furl»' -e 'set end of filePaths to POSIX path of theClip' -e 'end try' -e 'try' -e 'set fileList to the clipboard as list' -e 'repeat with f in fileList' -e 'try' -e 'set end of filePaths to POSIX path of (f as «class furl»)' -e 'end try' -e 'end repeat' -e 'end try' -e 'set text item delimiters to linefeed' -e 'filePaths as text'`,
        { encoding: "utf-8", timeout: 2000 }
      ).trim();
      if (result) {
        return result
          .split("\n")
          .map((p: string) => p.trim())
          .filter((p: string) => p && fs.existsSync(p));
      }
    } catch {
      /* not file clipboard */
    }
  }
  return [];
});

// --- Model Preset ---
ipcMain.handle("modelPreset:set", (_event, preset: string) => {
  process.env.MARBLO_MODEL_PRESET = preset;
  writeAppState({ modelPreset: preset });
  console.log(`[Main] Model preset set to: ${preset}`);
  return { success: true };
});

ipcMain.handle("modelPreset:get", () => {
  return (
    process.env.MARBLO_MODEL_PRESET ||
    readAppState().modelPreset ||
    "recommended"
  );
});

ipcMain.handle(
  "orchestratorModel:set",
  (_event, model: string, projectId?: string) => {
    const normalized = normalizeOrchestratorModelSetting(model);
    writeAppState({ orchestratorModel: normalized });
    // projectId 가 오면 그 프로젝트의 재시작 연속성도 이 선택을 따르게 기록.
    if (projectId) saveProjectOrchestratorModel(projectId, normalized);
    console.log(`[Main] Orchestrator model set to: ${normalized}`);
    return { success: true };
  }
);

ipcMain.handle("orchestratorModel:get", (_event, projectId?: string) => {
  if (INITIAL_ORCHESTRATOR_MODEL_ENV) {
    return normalizeOrchestratorModelSetting(INITIAL_ORCHESTRATOR_MODEL_ENV);
  }
  // 프로젝트별 저장 모델(그 프로젝트 오케가 마지막으로 돈 모델)이 있으면 그걸
  // 보여준다 — 전역값은 다른 프로젝트가 마지막으로 만진 값일 수 있다.
  return (
    readProjectOrchestratorModel(projectId) ??
    normalizeOrchestratorModelSetting(readAppState().orchestratorModel)
  );
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
    opts: { dsn?: string; release?: string; environment?: string }
  ) => {
    const ok = await initMainSentry(opts || {});
    return { ok };
  }
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
  "subscription-plans.json"
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
        `[Main] subscriptionPlans:save wrote ${plans.length} plan(s)`
      );
      return { success: true };
    } catch (err) {
      console.error("[Main] subscriptionPlans:save failed:", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle("appState:load", () => readAppState());

ipcMain.handle("appState:save", (_event, state: Partial<AppState>) => {
  writeAppState(state);
  if (typeof state.preventSleepWhileWorking === "boolean") {
    preventSleepWhileWorking = state.preventSleepWhileWorking;
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
  }
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

ipcMain.handle("harness:install", async (_event, id: string) => {
  try {
    await installPackage(id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
});

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
  }
);

// Account-global rate-limit snapshots for the Usage tab. Independent of any
// agent: claude is probed headlessly, codex/gpt is read from the newest
// rollout across all codex homes. null fields = no information (logged out /
// probe failed), never zero usage. See account-usage.ts.
ipcMain.handle("usage:accountRateLimits", () => getAccountRateLimits());

app.whenReady().then(async () => {
  console.log("[Marblo] auth=redirect build");

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
        "On Linux, install libsecret-1-0 / gnome-keyring."
    );
  }

  // Install bundled harness assets (tf-* commands + skills) into ~/.claude/.
  // Idempotent: skips when the version marker already matches the current
  // app version.
  try {
    const result = await installBundledHarness();
    console.log(
      `[Main] Bundle install: ${result.installed} files, ${result.errors.length} errors`
    );
  } catch (err) {
    console.warn("[Main] Bundle install failed (non-fatal):", err);
  }

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

  // Reopen all project windows that were open at last quit (multi-window
  // session restore). Single default window when nothing was saved.
  restoreWindowSession();

  // Start the electron-owned Telegram poller: one getUpdates loop per active
  // channel, resuming from the persisted offset. Idempotent — safe even if no
  // channels are configured yet (starts nothing).
  try {
    telegramPoller.start();
  } catch (err) {
    console.error("[Main] Telegram poller start failed:", err);
  }

  // 텔레그램 채널 메타 기기 간 동기화(기동 시 1회): 다른 기기가 push 한 메타를
  // 복원하고(토큰 없음·비활성 — 사용자가 토큰 재입력 시 복구), 이 기기의 기존
  // 채널 메타를 업로드한다. custom-token 인증 전(익명)이면 조용히 스킵되고,
  // 인증이 성립하는 auth:syncAgentCustomToken 시점에 다시 돈다. fail-soft.
  void syncTelegramChannelMeta(getMachineId()).catch(() => undefined);

  // --- powerMonitor: notify renderer on system wake ---
  powerMonitor.on("resume", () => {
    console.log("[Main] System resumed from sleep — notifying renderer");
    broadcast("system:wake");
    // Telegram poller self-heal: mac sleep kills the getUpdates TCP socket and
    // a stray webhook 409-wedges getUpdates. The out-of-band health sweep
    // clears a webhook wedge with the stored bot token; then reconcile poller
    // loops so any that died on the dead socket are (re)started. Fire-and-forget.
    void runTelegramChannelHealthCheck("wake", {
      onReport: emitTelegramHealth,
    })
      .catch((err) =>
        console.warn("[Main] Telegram wake health check failed:", err)
      )
      .finally(() => telegramPoller.syncActiveChannels());
  });

  // Conservative periodic health sweep — catches steady-state disconnects that
  // never fire a wake event (a webhook registered mid-session, or a silently
  // deaf poller). Only probes active channels; no-op when none are configured.
  // unref'd so it never keeps the process alive on quit. Also reconciles poller
  // loops so a crashed loop is revived and a newly-active channel gets one.
  telegramHealthTimer = setInterval(() => {
    void runTelegramChannelHealthCheck("interval", {
      onReport: emitTelegramHealth,
    })
      .catch((err) =>
        console.warn("[Main] Telegram interval health check failed:", err)
      )
      .finally(() => telegramPoller.syncActiveChannels());
  }, 4 * 60 * 1000);
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
        err instanceof Error ? err.message : err
      )
    );
  }, GHOST_RECLAIM_INTERVAL_MS);
  ghostSweepTimer.unref?.();
  const fullSweepTimer = setInterval(() => {
    void runLifecycleReclaimSweep("interval");
  }, WORKTREE_SWEEP_INTERVAL_MS);
  fullSweepTimer.unref?.();
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
    void telegramPoller.stopAll();
    bridgeServer.stop();
    agentManager.stopAll();
    pendingListener.detachAll();
    ptyManager.killAll();
    // Reap any dist-mcp orphaned by earlier natural exits, then stop the sweep.
    stopMcpOrphanReaper();
    reapOrphanedMcpChildren();
    fsManager.stopAllWatching();
    agentWatchdog.stop();
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

  // Full cleanup when actually quitting (Cmd+Q)
  kanbanBridge.detach();
  stopAllOrchestrators();
  if (telegramHealthTimer) clearInterval(telegramHealthTimer);
  void telegramPoller.stopAll();
  bridgeServer.stop();
  agentManager.stopAll();
  pendingListener.detachAll();
  ptyManager.killAll();
  // Reap any dist-mcp orphaned by earlier natural exits, then stop the sweep.
  stopMcpOrphanReaper();
  reapOrphanedMcpChildren();
  fsManager.stopAllWatching();
  agentWatchdog.stop();
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
