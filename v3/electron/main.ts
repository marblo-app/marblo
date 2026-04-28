import { app, BrowserWindow, Menu, ipcMain, dialog, powerMonitor, clipboard, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import dotenv from 'dotenv';
import { PtyManager } from './pty-manager';
import { FsManager } from './fs-manager';
import { AgentManager } from './agent-manager';
import { Updater } from './updater';
import { TaskDecomposer } from './orchestrator/task-decomposer';
import type { DecomposedTask } from './orchestrator/dag-generator';
import { BridgeServer } from './bridge-server';
import { OrchestratorManager } from './orchestrator-manager';
import { FlowRunner } from './flow-engine/flow-runner';
import { KanbanBridge } from './flow-engine/kanban-bridge';
import { createLLMProvider } from './flow-engine/llm-provider';
import type { Flow, FlowEvent, HumanInput } from './flow-engine/types';
import { findReconnectCandidates } from './reconnect-manager';
import { CostTracker } from './cost-tracker';
import { mainTelemetry } from './telemetry';

// .env 파일에서 Firebase 환경변수 로드 (Electron 메인 프로세스용)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// --- API Key Storage ---
const API_KEYS_DIR = path.join(os.homedir(), '.marblo');
const API_KEYS_FILE = path.join(API_KEYS_DIR, 'api-keys.json');

interface StoredApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
}

function ensureApiKeysDir(): void {
  if (!fs.existsSync(API_KEYS_DIR)) {
    fs.mkdirSync(API_KEYS_DIR, { recursive: true });
  }
}

function readApiKeys(): StoredApiKeys {
  try {
    ensureApiKeysDir();
    if (fs.existsSync(API_KEYS_FILE)) {
      const raw = fs.readFileSync(API_KEYS_FILE, 'utf-8');
      return JSON.parse(raw) as StoredApiKeys;
    }
  } catch {
    // If file is corrupted, return empty
  }
  return {};
}

function writeApiKeys(keys: StoredApiKeys): void {
  ensureApiKeysDir();
  fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8');
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

// --- App State Persistence (session restore across restart / sleep-wake) ---
const APP_STATE_FILE = path.join(API_KEYS_DIR, 'app-state.json');

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
      return JSON.parse(fs.readFileSync(APP_STATE_FILE, 'utf-8')) as AppState;
    }
  } catch { /* corrupted — return empty */ }
  return {};
}

function writeAppState(state: AppState): void {
  ensureApiKeysDir();
  // Merge with existing state to allow partial updates
  const existing = readAppState();
  const merged = { ...existing, ...state };
  fs.writeFileSync(APP_STATE_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

// Disable QUIC protocol — prevents ERR_QUIC_PROTOCOL_ERROR with Firestore in Electron
app.commandLine.appendSwitch('disable-quic');

// Enable remote debugging in dev mode
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

const isDev = !app.isPackaged;
const updater = new Updater();
const ptyManager = new PtyManager();
const fsManager = new FsManager();
const agentManager = new AgentManager(
  ptyManager,
  (agentId, status) => {
    broadcast('agent:statusChanged', { agentId, status });
  },
  (rootPath, sessionId, label, agentId) => {
    orchestratorManager.saveSessionLabel(rootPath, sessionId, label, agentId);
    // Start tracking JSONL session file for token usage
    const agent = agentManager.getAgent(agentId);
    const model = agent?.model || 'claude';
    costTracker.trackSession(agentId, rootPath, sessionId, model);
  },
  // Auto-restart callbacks
  (agentId, attempt, maxAttempts) => {
    broadcast('agent:restartAttempt', { agentId, attempt, maxAttempts });
  },
  (agentId, exitCode) => {
    broadcast('agent:restartFailed', { agentId, exitCode });
  },
  () => mainWindow,
);

let mainWindow: BrowserWindow | null = null; // Primary window (for bridge server reference)
const allWindows = new Set<BrowserWindow>();

/** Broadcast an IPC event to all open windows */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

// --- Bridge Server + Orchestrator Manager ---
const ptyBuffers = new Map<string, string[]>();
const bridgeServer = new BridgeServer(agentManager, ptyManager, ptyBuffers);

const orchestratorManager = new OrchestratorManager(
  ptyManager,
  agentManager.getConfigGenerator(),
  (status) => {
    broadcast('orchestrator:statusChanged', { status });
  },
);

// Connect orchestrator manager to bridge so MCP tools can notify orchestrator
bridgeServer.setOrchestratorManager(orchestratorManager);

// Inject session resolver so agent auto-restart resolves 'latest' per-agent
agentManager.setSessionResolver(
  (rootPath, requested, filterLabel, filterAgentId) =>
    orchestratorManager.resolveSessionId(rootPath, requested, filterLabel, filterAgentId),
);

// --- Flow Engine Setup ---
import { initializeApp as initFirebaseApp, getApps as getFirebaseApps } from 'firebase/app';
import { getFirestore, collection as fbCollection, addDoc as fbAddDoc, Timestamp as fbTimestamp } from 'firebase/firestore';

function getFlowDb() {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '',
  };
  const existingApps = getFirebaseApps();
  const fbApp = existingApps.find(a => a.name === 'flow-engine')
    || initFirebaseApp(config, 'flow-engine');
  return getFirestore(fbApp);
}

const flowDb = getFlowDb();

// --- Cost Tracking ---
const costTracker = new CostTracker((agentId, cost) => {
  const agent = agentManager.getAgent(agentId);
  const projectId = agent?.launchConfig?.env?.MARBLO_PROJECT || '';
  if (!projectId) {
    console.warn(`[CostTracker:CB] No projectId for agent ${agentId} — recording with empty projectId`);
  }

  // Send delta (incremental) values to renderer for BigQuery
  broadcast('cost:update', {
    projectId,
    agentId,
    model: cost.model,
    inputTokens: cost.deltaInputTokens,
    outputTokens: cost.deltaOutputTokens,
    cacheReadTokens: cost.deltaCacheReadTokens || 0,
    cacheWriteTokens: cost.deltaCacheWriteTokens || 0,
    totalCost: cost.deltaCost,
  });
  console.log(`[CostTracker] Sent cost:update (delta) — agent=${agentId} project=${projectId || '(none)'} in=${cost.deltaInputTokens} out=${cost.deltaOutputTokens} cost=$${cost.deltaCost.toFixed(4)}`);

  // Also send token:usage telemetry event with projectId
  mainTelemetry.tokenUsage(mainWindow, agentId, cost.model, cost.deltaInputTokens, cost.deltaOutputTokens, cost.deltaCost, projectId);
});

// Load stored API keys and create LLM provider
const storedKeys = readApiKeys();
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
  llmProvider = createLLMProvider({
    anthropicApiKey: keys.anthropic,
    openaiApiKey: keys.openai,
    googleApiKey: keys.google,
  });
  (flowRunner as unknown as { llmProvider: typeof llmProvider }).llmProvider = llmProvider;
}

// Cache flows by flowId so the agent delegation handler can resolve node configs
const flowNodeCache = new Map<string, Flow>();

// Forward flow events to renderer
flowRunner.on('event', (event: FlowEvent) => {
  broadcast('flow:event', event);
});

// Handle agent node delegation: spawn new agent or route task to existing PTY
flowRunner.on('event', (event: FlowEvent) => {
  if (event.type !== 'node:complete') return;

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
    case 'claude': return 'claude';
    case 'gemini': return 'gemini';
    case 'gpt': return 'codex';
    default: return 'claude';
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
function handleAgentDelegation(nodeId: string, output: Record<string, unknown>): void {
  const connectionMode = output.connectionMode as string;
  const resolvedTask = (output.task as string) || '';

  if (connectionMode === 'auto' && output.spawnConfig) {
    // --- Spawn a new agent ---
    const spawnConfig = output.spawnConfig as { name: string; model: string; role: string };

    // Look up cwd from the flow node config
    let cwd = process.cwd();
    for (const [, flow] of flowNodeCache) {
      const node = flow.nodes.find(n => n.id === nodeId);
      if (node) {
        cwd = (node.data.config?.cwd as string) || cwd;
        break;
      }
    }

    const agentId = crypto.randomUUID();
    const model = spawnConfig.model as 'claude' | 'gemini' | 'gpt' | 'custom';

    try {
      const instance = agentManager.launch({
        id: agentId,
        name: spawnConfig.name,
        model,
        role: spawnConfig.role,
        command: getDefaultCommand(model),
        cwd,
        initialPrompt: resolvedTask,
        onPtyReady: (sid) => setupPtyForwarding(sid),
      });

      // Notify renderer to attach terminal tab
      broadcast('agent:spawned', {
        agentId,
        name: spawnConfig.name,
        ptySessionId: instance.ptySessionId,
        model,
        role: spawnConfig.role,
        flowNodeId: nodeId,
      });

      console.log(`[Flow:AgentDelegation] Spawned agent "${spawnConfig.name}" (${agentId}) for node ${nodeId}`);
    } catch (err) {
      console.error(`[Flow:AgentDelegation] Failed to spawn agent for node ${nodeId}:`, err);
    }
  } else if (connectionMode === 'existing' && output.existingAgentId) {
    // --- Route task to existing agent PTY ---
    const existingAgentId = output.existingAgentId as string;
    const agent = agentManager.getAgent(existingAgentId);

    if (agent && agent.status !== 'stopped') {
      const taskMessage = `\n--- Flow Task ---\n${resolvedTask}\n--- End Task ---\n`;
      ptyManager.write(agent.ptySessionId, taskMessage + '\r');
      console.log(`[Flow:AgentDelegation] Sent task to existing agent "${agent.name}" (${existingAgentId}) for node ${nodeId}`);
    } else {
      console.warn(`[Flow:AgentDelegation] Agent ${existingAgentId} not found or stopped. Cannot route task for node ${nodeId}.`);
    }
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  // Don't exit - try to keep app alive for beta
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

function createWindow(isNewWindow = false) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Serve from localhost so Firebase Auth (signInWithPopup) works
    // file:// protocol causes auth/unauthorized-domain error
    const distPath = path.join(__dirname, '../dist');
    const server = http.createServer((req, res) => {
      let filePath = path.join(distPath, req.url === '/' ? 'index.html' : req.url || 'index.html');
      // SPA fallback: if file doesn't exist, serve index.html
      if (!fs.existsSync(filePath)) {
        filePath = path.join(distPath, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      console.log(`[Marblo] Static server on http://127.0.0.1:${port}`);
      win.loadURL(`http://127.0.0.1:${port}`);
    });
    win.on('closed', () => server.close());
  }

  mainWindow = win;
  allWindows.add(win);

  win.on('closed', () => {
    allWindows.delete(win);
    if (mainWindow === win) {
      // Promote another window as primary, or null
      mainWindow = allWindows.size > 0 ? (allWindows.values().next().value ?? null) : null;
      if (mainWindow) bridgeServer.setMainWindow(mainWindow);
    }
  });

  win.once('ready-to-show', () => {
    win.show();

    // Tell renderer if this is a new window (skip session restore)
    if (isNewWindow) {
      win.webContents.send('window:isNew', true);
    }

    // Auto-update check (production only)
    if (!isDev) {
      updater.setMainWindow(win);
      updater.checkForUpdates();
    }
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Marblo',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow(true),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) {
              focused.webContents.send('terminal:new');
            }
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// --- PTY IPC Handlers ---
ipcMain.handle('pty:create', (_event, { id, name, command, args, cwd }) => {
  const session = ptyManager.create(id, name, command, args, cwd);

  // Use same buffer-then-live pattern as agents (survives React StrictMode)
  setupPtyForwarding(id);

  return { id: session.id, name: session.name, shell: session.shell };
});

ipcMain.handle('pty:write', (_event, { id, data }) => {
  ptyManager.write(id, data);
});

ipcMain.handle('pty:resize', (_event, { id, cols, rows }) => {
  ptyManager.resize(id, cols, rows);
});

ipcMain.handle('pty:kill', (_event, { id }) => {
  ptyManager.kill(id);
});

ipcMain.handle('pty:list', () => {
  return ptyManager.listSessions();
});

// --- File System IPC Handlers ---
ipcMain.handle('fs:readTree', (_event, rootPath: string) => {
  return fsManager.readTree(rootPath);
});

ipcMain.handle('fs:readFile', (_event, filePath: string) => {
  return fsManager.readFile(filePath);
});

ipcMain.handle('fs:writeFile', (_event, { filePath, content }: { filePath: string; content: string }) => {
  fsManager.writeFile(filePath, content);
});

ipcMain.handle('fs:gitStatus', async (_event, rootPath: string) => {
  return fsManager.getGitStatus(rootPath);
});

ipcMain.handle('fs:gitDiff', async (_event, filePath: string) => {
  return fsManager.getGitDiff(filePath);
});

ipcMain.handle('fs:watch', (_event, rootPath: string) => {
  fsManager.watchDirectory(rootPath, (event, filePath) => {
    broadcast('fs:change', event, filePath);
  });
});

ipcMain.handle('fs:selectDirectory', async () => {
  const focusedWin = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!focusedWin) return null;
  const result = await dialog.showOpenDialog(focusedWin, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// --- Agent IPC Handlers ---

// Buffer early PTY output so data isn't lost before the renderer's listener is ready.
// While buffering, data is ONLY stored in the buffer (not sent live) to prevent
// duplicates. After replay, the buffer is deleted and data flows live.
// NOTE: ptyBuffers is now shared with BridgeServer (declared above).

/**
 * Helper: register PTY data/exit handlers that buffer-then-live.
 * While ptyBuffers has an entry for `sid`, data is ONLY buffered.
 * After pty:replay deletes the entry, data is sent live via IPC.
 */
function setupPtyForwarding(sid: string): void {
  const buffer: string[] = [];
  ptyBuffers.set(sid, buffer);
  console.log(`[PTY:FWD] setupPtyForwarding for ${sid}`);

  ptyManager.onData(sid, (data) => {
    // Cost tracking — observe all output (read-only, fire-and-forget)
    if (sid.startsWith('agent-')) {
      costTracker.processOutput(sid.replace('agent-', ''), data);
    }

    if (ptyBuffers.has(sid)) {
      ptyBuffers.get(sid)!.push(data);
      if (ptyBuffers.get(sid)!.length <= 3) {
        console.log(`[PTY:FWD] Buffering data for ${sid}, buf size=${ptyBuffers.get(sid)!.length}, bytes=${data.length}`);
      }
      return; // buffer only — don't send live yet
    }
    // Live mode: send directly to all renderers
    broadcast(`pty:data:${sid}`, data);
  });

  ptyManager.onExit(sid, (exitCode) => {
    ptyBuffers.delete(sid);
    replayTimers.delete(sid);
    broadcast(`pty:exit:${sid}`, exitCode);
  });
}

ipcMain.handle('agent:launch', (_event, { agent, cwd, initialPrompt, resumeSessionId, projectId }) => {
  // Resolve 'latest' to the actual session ID for this specific agent
  let resolvedSessionId = resumeSessionId;
  if (resumeSessionId === 'latest') {
    const resolved = orchestratorManager.resolveSessionId(cwd, 'latest', agent.name, agent.id);
    resolvedSessionId = resolved ?? 'new';
    console.log(`[agent:launch] Resolved 'latest' for "${agent.name}" → ${resolvedSessionId}`);
  }

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
    onPtyReady: (sid) => setupPtyForwarding(sid),
  });

  return {
    id: instance.id,
    ptySessionId: instance.ptySessionId,
    status: instance.status,
    command: instance.command,
    args: instance.launchConfig?.args || [],
  };
});

// Timers for delayed buffer cleanup (survives React StrictMode double-mount)
const replayTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Renderer calls this after TerminalView mounts to get any buffered early output.
// Returns a COPY of the buffer and schedules delayed cleanup so React StrictMode's
// second mount can also get the data.
ipcMain.handle('pty:replay', (_event, { id }: { id: string }) => {
  const buffer = ptyBuffers.get(id);
  console.log(`[PTY:REPLAY] id=${id}, hasBuffer=${!!buffer}, bufLen=${buffer?.length ?? 0}`);
  if (!buffer || buffer.length === 0) {
    // No data yet — just switch to live mode immediately
    ptyBuffers.delete(id);
    return [];
  }

  // Return a copy (don't drain yet — StrictMode may call again)
  const data = [...buffer];
  const replayedUpTo = buffer.length; // Track what was returned to avoid duplicates

  // Reschedule cleanup timer (each replay call resets it)
  const existing = replayTimers.get(id);
  if (existing) clearTimeout(existing);

  replayTimers.set(id, setTimeout(() => {
    const buf = ptyBuffers.get(id);
    if (buf) {
      // Only send data that arrived AFTER the last replay (avoid duplicates)
      for (let i = replayedUpTo; i < buf.length; i++) {
        broadcast(`pty:data:${id}`, buf[i]);
      }
      console.log(`[PTY:REPLAY] Timer flush id=${id}, sent ${buf.length - replayedUpTo} new chunks (skipped ${replayedUpTo} replayed)`);
    }
    ptyBuffers.delete(id);
    replayTimers.delete(id);
  }, 1500));

  return data;
});

ipcMain.handle('agent:stop', (_event, agentId: string) => {
  agentManager.stop(agentId);
});

ipcMain.handle('agent:restart', (_event, agentId: string) => {
  const instance = agentManager.restart(agentId);
  if (instance) {
    // Re-setup PTY data forwarding
    ptyManager.onData(instance.ptySessionId, (data) => {
      broadcast(`pty:data:${instance.ptySessionId}`, data);
    });
  }
  return instance ? {
    id: instance.id,
    ptySessionId: instance.ptySessionId,
    status: instance.status,
  } : null;
});

ipcMain.handle('agent:status', (_event, agentId: string) => {
  return agentManager.getStatus(agentId);
});

ipcMain.handle('agent:list', () => {
  return agentManager.listAgents();
});

ipcMain.handle('agent:remove', (_event, agentId: string) => {
  agentManager.remove(agentId);
  return { success: true };
});

ipcMain.handle('agent:getMCPConfig', (_event, agentId: string) => {
  return agentManager.getMCPConfig(agentId);
});

ipcMain.handle('agent:healthStatus', (_event, agentId: string) => {
  const agent = agentManager.getAgent(agentId);
  if (!agent) return null;
  return {
    status: agent.status,
    restartCount: agent.restartCount,
    lastExitCode: agent.lastExitCode,
  };
});

ipcMain.handle('agent:reconnect', (_event, { agents, rootPath, projectId }: {
  agents: Array<{ id: string; name: string; model: string; role: string; command: string }>;
  rootPath: string;
  projectId: string;
}) => {
  // Find session candidates for each agent
  const candidates = findReconnectCandidates(
    agents.map(a => ({ id: a.id, name: a.name, role: a.role })),
    rootPath,
  );

  const results = [];

  for (const candidate of candidates) {
    const agentData = agents.find(a => a.id === candidate.agentId);
    if (!agentData) {
      results.push({ agentId: candidate.agentId, reconnected: false, ptySessionId: null });
      continue;
    }

    // Non-Claude agents can't --resume, but register them as idle for dispatch reuse
    if (agentData.model !== 'claude') {
      agentManager.registerReconnected({
        id: agentData.id, name: agentData.name,
        model: agentData.model as 'claude' | 'gemini' | 'gpt' | 'custom',
        role: agentData.role, command: agentData.command,
        cwd: rootPath, ptySessionId: `agent-${agentData.id}`,
      });
      results.push({ agentId: agentData.id, reconnected: false, ptySessionId: null });
      continue;
    }

    // Skip agents that already have a running PTY session
    const existing = agentManager.getAgent(agentData.id);
    if (existing && existing.status !== 'stopped' && existing.status !== 'error') {
      results.push({ agentId: agentData.id, reconnected: false, ptySessionId: null });
      continue;
    }

    // Use specific session ID if found; resolve 'latest' per-agent if not
    let resumeId = candidate.sessionId;
    if (!resumeId) {
      resumeId = orchestratorManager.resolveSessionId(rootPath, 'latest', agentData.name, agentData.id);
    }
    if (!resumeId) {
      // No session found for this agent — skip reconnect
      results.push({ agentId: agentData.id, reconnected: false, ptySessionId: null });
      console.log(`[Reconnect] No session found for agent ${agentData.name}, skipping`);
      continue;
    }

    try {
      const instance = agentManager.launch({
        id: agentData.id,
        name: agentData.name,
        model: agentData.model as 'claude' | 'gemini' | 'gpt' | 'custom',
        role: agentData.role,
        command: agentData.command,
        cwd: rootPath,
        resumeSessionId: resumeId,
        projectId,
        onPtyReady: (sid) => setupPtyForwarding(sid),
      });
      results.push({ agentId: agentData.id, reconnected: true, ptySessionId: instance.ptySessionId });
      console.log(`[Reconnect] Agent ${agentData.name} (${agentData.id}) reconnected via ${candidate.sessionId ? '--resume ' + candidate.sessionId : '--continue'}`);

      // Start cost tracking — uses sessionId if known, or finds most recent JSONL
      costTracker.trackSession(agentData.id, rootPath, candidate.sessionId, agentData.model || 'claude');
    } catch (err) {
      console.error(`[Reconnect] Failed for agent ${agentData.id}:`, err);
      results.push({ agentId: agentData.id, reconnected: false, ptySessionId: null });
    }
  }
  return results;
});

ipcMain.handle('agent:getSkill', (_event, role: string) => {
  const safeRole = role.replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeRole) return null;

  const skillsDir = path.resolve(__dirname, '..', 'skills');
  for (const filename of [`${safeRole}_agent.md`, `${safeRole}.md`]) {
    const filePath = path.resolve(skillsDir, filename);
    if (!filePath.startsWith(skillsDir)) continue;
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  }
  return null;
});

// --- Orchestrator IPC Handlers ---
let taskDecomposer: TaskDecomposer | null = null;

function getDecomposer(): TaskDecomposer {
  if (!taskDecomposer) {
    taskDecomposer = new TaskDecomposer();
  }
  return taskDecomposer;
}

ipcMain.handle('orchestrator:decompose', async (_event, text: string) => {
  const decomposer = getDecomposer();
  return decomposer.decompose(text);
});

ipcMain.handle('orchestrator:createTasks', async (_event, tasks: DecomposedTask[]) => {
  // Return tasks for the renderer to create in Firestore
  // The renderer handles Firestore writes directly
  const decomposer = getDecomposer();
  const layers = decomposer.getExecutionPlan(tasks);
  return { tasks, layers };
});

// --- Orchestrator Session IPC Handlers ---

ipcMain.handle('orchestratorSession:launch', async (_event, { projectId, rootPath, resumeSessionId, enabledModels }) => {
  const port = bridgeServer.getPort();
  // Resolve '~' to actual home directory
  const resolvedPath = rootPath === '~' ? require('os').homedir() : rootPath;

  // Inject enabled models into env for Bridge dispatch scoring
  if (enabledModels && Array.isArray(enabledModels) && enabledModels.length > 0) {
    process.env.MARBLO_ENABLED_MODELS = enabledModels.join(',');
  }

  const session = orchestratorManager.launch(projectId, resolvedPath, port, (sid) => {
    setupPtyForwarding(sid);
  }, resumeSessionId);

  return {
    sessionId: session.sessionId,
    ptySessionId: session.ptySessionId,
    status: session.status,
  };
});

ipcMain.handle('orchestratorSession:stop', () => {
  orchestratorManager.stop();
  // Clean up enabledModels env var to prevent stale values in next session
  delete process.env.MARBLO_ENABLED_MODELS;
});

ipcMain.handle('orchestratorSession:status', () => {
  return orchestratorManager.getStatus();
});

ipcMain.handle('orchestratorSession:listSessions', (_event, rootPath: string) => {
  const resolvedPath = rootPath === '~' ? require('os').homedir() : rootPath;
  return orchestratorManager.listSessions(resolvedPath);
});

// --- Flow IPC Handlers ---

ipcMain.handle('flow:run', async (_event, { flow, inputs }: { flow: Flow; inputs?: Record<string, unknown> }) => {
  kanbanBridge.registerFlow(flow);
  flowNodeCache.set(flow.id, flow);
  const state = await flowRunner.run(flow, inputs);
  // Clean up cache after flow completes
  flowNodeCache.delete(flow.id);
  return state;
});

ipcMain.handle('flow:pause', async (_event, { runId }: { runId: string }) => {
  await flowRunner.pause(runId);
});

ipcMain.handle('flow:resume', async (_event, { runId, humanInput }: { runId: string; humanInput?: HumanInput }) => {
  const state = await flowRunner.resume(runId, humanInput);
  return state;
});

ipcMain.handle('flow:cancel', async (_event, { runId }: { runId: string }) => {
  await flowRunner.cancel(runId);
});

ipcMain.handle('flow:getState', (_event, { runId }: { runId: string }) => {
  return flowRunner.getState(runId);
});

// --- Settings IPC Handlers (API Keys) ---

ipcMain.handle('settings:getApiKeys', () => {
  const keys = readApiKeys();
  return {
    anthropic: keys.anthropic ? maskKey(keys.anthropic) : '',
    openai: keys.openai ? maskKey(keys.openai) : '',
    google: keys.google ? maskKey(keys.google) : '',
    // Also return whether each key is set (since masked values aren't the real keys)
    _isSet: {
      anthropic: !!keys.anthropic,
      openai: !!keys.openai,
      google: !!keys.google,
    },
  };
});

// --- Code formatting (Prettier) ---
ipcMain.handle('code:format', async (_event, { content, filePath }: { content: string; filePath: string }) => {
  try {
    const prettier = await import('prettier');
    const ext = path.extname(filePath).toLowerCase();
    const parserMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'babel', '.jsx': 'babel',
      '.json': 'json', '.md': 'markdown',
      '.css': 'css', '.scss': 'scss', '.less': 'less',
      '.html': 'html', '.vue': 'vue',
      '.yaml': 'yaml', '.yml': 'yaml',
      '.graphql': 'graphql', '.gql': 'graphql',
    };
    const parser = parserMap[ext];
    if (!parser) return { formatted: content, error: null };

    // Try to find project prettier config
    const config = await prettier.resolveConfig(filePath) || {};
    const formatted = await prettier.format(content, {
      ...config,
      parser,
      tabWidth: 2,
      singleQuote: true,
      trailingComma: 'all',
    });
    return { formatted, error: null };
  } catch (err) {
    return { formatted: content, error: err instanceof Error ? err.message : 'Format failed' };
  }
});

ipcMain.handle('settings:setApiKey', (_event, { provider, key }: { provider: string; key: string }) => {
  const validProviders = ['anthropic', 'openai', 'google'];
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}`);
  }
  const keys = readApiKeys();
  (keys as Record<string, string>)[provider] = key;
  writeApiKeys(keys);
  refreshLLMProvider();
  return { success: true };
});

ipcMain.handle('settings:deleteApiKey', (_event, { provider }: { provider: string }) => {
  const validProviders = ['anthropic', 'openai', 'google'];
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}`);
  }
  const keys = readApiKeys();
  delete (keys as Record<string, string | undefined>)[provider];
  writeApiKeys(keys);
  refreshLLMProvider();
  return { success: true };
});

// --- App State IPC ---
// --- Bridge Message Injection IPC ---
ipcMain.handle('bridge:injectMessage', async (_event, params: {
  targetAgent: string; tag: string; message: string; taskId?: string; taskTitle?: string;
}) => {
  const port = bridgeServer.getPort();
  if (!port) return { success: false, error: 'Bridge server not running' };
  const res = await fetch(`http://127.0.0.1:${port}/inject-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
});

// --- Clipboard image paste support ---
ipcMain.handle('clipboard:getImagePath', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;

  const tmpDir = path.join(os.tmpdir(), 'marblo-clipboard');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `paste-${Date.now()}.png`);
  fs.writeFileSync(filePath, img.toPNG());
  return filePath;
});

// --- Model Preset ---
ipcMain.handle('modelPreset:set', (_event, preset: string) => {
  process.env.MARBLO_MODEL_PRESET = preset;
  writeAppState({ modelPreset: preset });
  console.log(`[Main] Model preset set to: ${preset}`);
  return { success: true };
});

ipcMain.handle('modelPreset:get', () => {
  return process.env.MARBLO_MODEL_PRESET || readAppState().modelPreset || 'recommended';
});

ipcMain.handle('appState:load', () => readAppState());

ipcMain.handle('appState:save', (_event, state: Partial<AppState>) => {
  writeAppState(state);
  return { success: true };
});

app.whenReady().then(async () => {
  // Start HTTP bridge server before creating the window
  try {
    const port = await bridgeServer.start();
    console.log(`[Main] BridgeServer started on port ${port}`);
  } catch (err) {
    console.error('[Main] Failed to start BridgeServer:', err);
  }

  createWindow();

  // --- powerMonitor: notify renderer on system wake ---
  powerMonitor.on('resume', () => {
    console.log('[Main] System resumed from sleep — notifying renderer');
    broadcast('system:wake');
  });

  // Share windows with bridge server
  if (mainWindow) {
    bridgeServer.setMainWindow(mainWindow);
  }
  bridgeServer.setAllWindows(allWindows);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Non-macOS: full cleanup and quit
    kanbanBridge.detach();
    orchestratorManager.stop();
    bridgeServer.stop();
    agentManager.stopAll();
    ptyManager.killAll();
    fsManager.stopWatching();
    app.quit();
  }
  // macOS: keep managers alive so agents/orchestrator persist across window close/reopen
});

app.on('before-quit', () => {
  // Full cleanup when actually quitting (Cmd+Q)
  kanbanBridge.detach();
  orchestratorManager.stop();
  bridgeServer.stop();
  agentManager.stopAll();
  ptyManager.killAll();
  fsManager.stopWatching();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
