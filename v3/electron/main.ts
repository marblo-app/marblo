import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  powerMonitor,
  clipboard,
  nativeImage,
  shell,
  safeStorage,
} from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import dotenv from "dotenv";
import { PtyManager } from "./pty-manager";
import { PendingInstructionListener } from "./pending-instruction-listener";
import { FsManager } from "./fs-manager";
import { AgentManager } from "./agent-manager";
import { Updater } from "./updater";
import { TaskDecomposer } from "./orchestrator/task-decomposer";
import type { DecomposedTask } from "./orchestrator/dag-generator";
import { BridgeServer } from "./bridge-server";
import { OrchestratorManager } from "./orchestrator-manager";
import { installBundledHarness } from "./bundle-installer";
import {
  listCatalog,
  installPackage,
  uninstallPackage,
  scheduleHarnessUpdates,
  getCatalogVersions,
} from "./harness-manager";
import { FlowRunner } from "./flow-engine/flow-runner";
import { KanbanBridge } from "./flow-engine/kanban-bridge";
import { createLLMProvider } from "./flow-engine/llm-provider";
import type { Flow, FlowEvent, HumanInput } from "./flow-engine/types";
import { findReconnectCandidates } from "./reconnect-manager";
import { CostTracker } from "./cost-tracker";
import { mainTelemetry } from "./telemetry";
import {
  buildMissionEngine,
  type BuiltMissionEngine,
} from "./mission-engine/wire";

// .env 파일에서 Firebase 환경변수 로드 (Electron 메인 프로세스용)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

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
    // File-IO method, project-agnostic — any orchestrator instance works.
    getAnyOrchestrator().saveSessionLabel(rootPath, sessionId, label, agentId);
    // Start tracking JSONL session file for token usage
    const agent = agentManager.getAgent(agentId);
    const model = agent?.model || "claude";
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
  },
  () => mainWindow
);

let mainWindow: BrowserWindow | null = null; // First window — fallback for things lacking owner
const allWindows = new Set<BrowserWindow>();

/** Broadcast an IPC event to all open windows */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
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
const bridgeServer = new BridgeServer(agentManager, ptyManager, ptyBuffers);

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
  return new OrchestratorManager(
    ptyManager,
    agentManager.getConfigGenerator(),
    (status) => {
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
      }
    }
  );
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

missionBundle = buildMissionEngine({
  agentManager,
  taskDecomposer: getDecomposer,
  orchestrators,
  createOrchestratorInstance,
  ptyManager,
  bridgePort: () => bridgeServer.getPort(),
  dispatchOne: (params) => bridgeServer.dispatchTask(params),
});

// --- Flow Engine Setup ---
import {
  initializeApp as initFirebaseApp,
  getApps as getFirebaseApps,
} from "firebase/app";
import {
  getFirestore,
  collection as fbCollection,
  addDoc as fbAddDoc,
  Timestamp as fbTimestamp,
} from "firebase/firestore";

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
    model: cost.model,
    inputTokens: cost.deltaInputTokens,
    outputTokens: cost.deltaOutputTokens,
    cacheReadTokens: cost.deltaCacheReadTokens || 0,
    cacheWriteTokens: cost.deltaCacheWriteTokens || 0,
    totalCost: cost.deltaCost,
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

function createWindow(isNewWindow = false) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    show: false,
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    // DevTools disabled by default for performance — open manually with Cmd+Option+I
  } else {
    // Serve from localhost so Firebase Auth (signInWithPopup) works
    // file:// protocol causes auth/unauthorized-domain error
    const distPath = path.join(__dirname, "../dist");
    const server = http.createServer((req, res) => {
      let filePath = path.join(
        distPath,
        req.url === "/" ? "index.html" : req.url || "index.html"
      );
      // SPA fallback: if file doesn't exist, serve index.html
      if (!fs.existsSync(filePath)) {
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
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      console.log(`[Marblo] Static server on http://127.0.0.1:${port}`);
      win.loadURL(`http://127.0.0.1:${port}`);
    });
    win.on("closed", () => server.close());
  }

  // Only the FIRST window becomes mainWindow. Don't overwrite on subsequent
  // createWindow() calls — that flipped which window received PTY events
  // and was the proximate cause of "open new window → previous window goes
  // silent" in multi-window mode.
  if (!mainWindow) {
    mainWindow = win;
  }
  allWindows.add(win);

  win.on("closed", () => {
    allWindows.delete(win);
    // Best-effort cleanup of per-window state.
    const closedSenderId = win.webContents.id;
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
    // Close this window's fs watcher (created in fs:watch handler).
    fsManager.stopWatching(`win-${closedSenderId}`);
    // Drop the window→project registration.
    windowProjects.delete(closedSenderId);
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
}

// --- PTY IPC Handlers ---
ipcMain.handle("pty:create", (_event, { id, name, command, args, cwd }) => {
  const session = ptyManager.create(id, name, command, args, cwd);

  // Use same buffer-then-live pattern as agents (survives React StrictMode)
  setupPtyForwarding(id);

  return { id: session.id, name: session.name, shell: session.shell };
});

// pty:write uses ipcMain.on (one-way) — keystrokes shouldn't pay invoke's round-trip cost
ipcMain.on("pty:write", (_event, { id, data }) => {
  ptyManager.write(id, data);
});

ipcMain.handle("pty:resize", (_event, { id, cols, rows }) => {
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

ipcMain.handle("pty:kill", (_event, { id }) => {
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

// --- File System IPC Handlers ---
ipcMain.handle("fs:readTree", (_event, rootPath: string) => {
  return fsManager.readTree(rootPath);
});

ipcMain.handle("fs:readFile", (_event, filePath: string) => {
  return fsManager.readFile(filePath);
});

ipcMain.handle(
  "fs:writeFile",
  (_event, { filePath, content }: { filePath: string; content: string }) => {
    fsManager.writeFile(filePath, content);
  }
);

ipcMain.handle("fs:gitStatus", async (_event, rootPath: string) => {
  return fsManager.getGitStatus(rootPath);
});

ipcMain.handle("fs:gitDiff", async (_event, filePath: string) => {
  return fsManager.getGitDiff(filePath);
});

ipcMain.handle("fs:gitRemoteUrl", async (_event, rootPath: string) => {
  return fsManager.getGitRemoteUrl(rootPath);
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

ipcMain.handle("fs:revealInFinder", (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath);
  return { success: true };
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
  const buffer: string[] = [];
  ptyBuffers.set(sid, buffer);

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
    const ownerId = ptyOwners.get(sid);
    ptyBuffers.delete(sid);
    sendToOwner(ownerId, `pty:exit:${sid}`, exitCode);
    ptyOwners.delete(sid);
  });
}

ipcMain.handle(
  "agent:launch",
  (event, { agent, cwd, initialPrompt, resumeSessionId, projectId }) => {
    // Resolve 'latest' to the actual session ID for this specific agent
    let resolvedSessionId = resumeSessionId;
    if (resumeSessionId === "latest") {
      // Stateless file-IO — any orchestrator instance reads the same on-disk
      // session metadata, so we don't need a project-specific instance here.
      const resolved = getAnyOrchestrator().resolveSessionId(
        cwd,
        "latest",
        agent.name,
        agent.id
      );
      resolvedSessionId = resolved ?? "new";
      console.log(
        `[agent:launch] Resolved 'latest' for "${agent.name}" → ${resolvedSessionId}`
      );
    }

    const senderId = event.sender.id;
    const instance = agentManager.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      cwd,
      initialPrompt,
      resumeSessionId: resolvedSessionId,
      projectId,
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
    // Re-setup PTY data forwarding to the requesting window. Owner mapping
    // ensures restarted agent output goes back to the same window that owned
    // it, not whichever window happens to be mainWindow.
    ptyOwners.set(instance.ptySessionId, event.sender.id);
    ptyManager.onData(instance.ptySessionId, (data) => {
      sendToOwner(
        ptyOwners.get(instance.ptySessionId),
        `pty:data:${instance.ptySessionId}`,
        data
      );
    });
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
  return agentManager.listAgentsByProject(scope);
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

ipcMain.handle(
  "agent:reconnect",
  (
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

    // Track Claude session IDs claimed during this reconnect pass — used
    // by the "any-unclaimed-session" fallback below to avoid attaching the
    // same JSONL to two different agents.
    const claimedClaudeSessions = new Set<string>(
      candidates.map((c) => c.sessionId).filter((s): s is string => Boolean(s))
    );

    const results = [];

    for (const candidate of candidates) {
      const agentData = agents.find((a) => a.id === candidate.agentId);
      if (!agentData) {
        results.push({
          agentId: candidate.agentId,
          reconnected: false,
          ptySessionId: null,
        });
        continue;
      }

      // Skip agents that already have a running PTY session
      const existing = agentManager.getAgent(agentData.id);
      if (
        existing &&
        existing.status !== "stopped" &&
        existing.status !== "error"
      ) {
        results.push({
          agentId: agentData.id,
          reconnected: false,
          ptySessionId: null,
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
        if (!resumeId) {
          resumeId = getAnyOrchestrator().resolveSessionId(
            rootPath,
            "latest",
            agentData.name,
            agentData.id
          );
        }
        // Aggressive fallback: agents created in earlier app versions don't
        // have label entries in marblo-labels.json, so the name/id-filtered
        // resolveSessionId returns null even when the project has plenty of
        // resumable JSONLs. Attach the most-recent unclaimed session as a
        // best-effort. --resume is token-free; worst case the user deletes
        // the wrong-session agent and re-spawns.
        if (!resumeId) {
          const allSessions = getAnyOrchestrator().listSessions(rootPath);
          const unclaimed = allSessions.find(
            (s) => !claimedClaudeSessions.has(s.id)
          );
          if (unclaimed) {
            resumeId = unclaimed.id;
            claimedClaudeSessions.add(unclaimed.id);
            console.log(
              `[Reconnect] Claude agent ${agentData.name} → unlabeled-session fallback ${unclaimed.id}`
            );
          }
        }
      } else {
        const model = agentData.model as "claude" | "gemini" | "gpt" | "custom";
        if (
          (model === "gpt" || model === "gemini") &&
          agentManager.hasSavedSession(agentData.id, model)
        ) {
          resumeId = "latest";
        } else {
          resumeId = null;
        }
      }
      // If no resumable session exists, fresh-launch the agent anyway so
      // it shows up alive in the panel after app restart (user requirement:
      // "기존에 에이전트들이 클로드코드 세션처럼 다 연결되서 살아있어야되").
      // resumeId stays null → agentManager.launch starts a fresh PTY with
      // no --resume. Token cost is the CLI's idle init (~0 until input).
      // Worst case the user deletes unused agents from the dashboard.
      if (!resumeId) {
        console.log(
          `[Reconnect] Agent ${agentData.name} (${agentData.model}) has no resumable session → fresh launch`
        );
      }

      try {
        const instance = agentManager.launch({
          id: agentData.id,
          name: agentData.name,
          model: agentData.model as "claude" | "gemini" | "gpt" | "custom",
          role: agentData.role,
          command: agentData.command,
          cwd: rootPath,
          resumeSessionId: resumeId ?? undefined,
          projectId,
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

ipcMain.handle(
  "orchestratorSession:launch",
  async (event, { projectId, rootPath, resumeSessionId, enabledModels }) => {
    const port = bridgeServer.getPort();
    // Resolve '~' to actual home directory
    const resolvedPath = rootPath === "~" ? require("os").homedir() : rootPath;

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
        // Cross-machine routing: any teammate who @mentions the orchestrator
        // from a machine that has no local orch PTY enqueues into
        // pendingInstructions with targetAgentId = `orch-${projectId}`.
        // This listener on the hosting machine picks it up and injects.
        pendingListener.attach(`orch-${projectId}`, sid);
      },
      resumeSessionId
    );

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
    const resolvedPath = rootPath === "~" ? require("os").homedir() : rootPath;
    // Stateless file-IO — any instance works.
    return getAnyOrchestrator().listSessions(resolvedPath);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.json();
  }
);

// --- Clipboard support ---
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
      const { execSync } = require("child_process");
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
  return { success: true };
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

app.whenReady().then(async () => {
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

  // Auto-update npm-global CLIs (claude / codex / gemini). One sweep now,
  // then every 24h. Keeps the user from being stuck on a codex that shows
  // a blocking "Update available!" dialog at startup (which would otherwise
  // deadlock agent spawning — see agent-manager.ts:dismissDialogs).
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

  createWindow();

  // --- powerMonitor: notify renderer on system wake ---
  powerMonitor.on("resume", () => {
    console.log("[Main] System resumed from sleep — notifying renderer");
    broadcast("system:wake");
  });

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
    bridgeServer.stop();
    agentManager.stopAll();
    pendingListener.detachAll();
    ptyManager.killAll();
    fsManager.stopAllWatching();
    missionBundle?.dispose();
    app.quit();
  }
  // macOS: keep managers alive so agents/orchestrator persist across window close/reopen
});

app.on("before-quit", () => {
  // Full cleanup when actually quitting (Cmd+Q)
  kanbanBridge.detach();
  stopAllOrchestrators();
  bridgeServer.stop();
  agentManager.stopAll();
  pendingListener.detachAll();
  ptyManager.killAll();
  fsManager.stopAllWatching();
  missionBundle?.dispose();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
