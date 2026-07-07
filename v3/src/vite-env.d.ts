/// <reference types="vite/client" />

// Installed app version, injected by vite.config.ts `define`. Used by the
// bug-report context collector to stamp the running app version.
declare const __APP_VERSION__: string;

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  gitStatus?: string;
}

interface FsAPI {
  readTree: (rootPath: string) => Promise<FileNode[]>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  gitStatus: (rootPath: string) => Promise<Record<string, string>>;
  gitDiff: (
    filePath: string,
  ) => Promise<{ original: string; modified: string }>;
  gitRemoteUrl: (rootPath: string) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  watch: (rootPath: string) => Promise<void>;
  onFileChange: (callback: (event: string, filePath: string) => void) => void;
  offFileChange: () => void;
  createFile: (
    rootPath: string,
    filePath: string,
  ) => Promise<{ success: boolean; path: string }>;
  createDirectory: (
    rootPath: string,
    dirPath: string,
  ) => Promise<{ success: boolean; path: string }>;
  rename: (
    rootPath: string,
    fromPath: string,
    toPath: string,
  ) => Promise<{ success: boolean; fromPath: string; toPath: string }>;
  remove: (
    rootPath: string,
    targetPath: string,
  ) => Promise<{ success: boolean; path: string }>;
  copy: (
    rootPath: string,
    fromPath: string,
    toPath: string,
  ) => Promise<{ success: boolean; fromPath: string; toPath: string }>;
  revealInFinder: (targetPath: string) => Promise<{ success: boolean }>;
  readFileBase64: (filePath: string) => Promise<string>;
  getPathForFile: (file: File) => string;
  importPaths: (args: {
    rootPath: string;
    destDir: string;
    srcPaths: string[];
  }) => Promise<{ success: boolean; imported: string[] }>;
}

interface PtyAPI {
  create: (opts: {
    id: string;
    name: string;
    command?: string;
    args?: string[];
    cwd?: string;
  }) => Promise<{ id: string; name: string; shell: string }>;
  write: (id: string, data: string) => Promise<void>;
  writeAndSubmit: (
    id: string,
    data: string,
    bracketedPaste?: boolean,
  ) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  list: () => Promise<{ id: string; name: string }[]>;
  onData: (id: string, callback: (data: string) => void) => void;
  onExit: (id: string, callback: (code: number) => void) => void;
  replay: (id: string) => Promise<string[]>;
  exists: (id: string) => Promise<boolean>;
  removeListeners: (id: string) => void;
}

interface AgentAPI {
  launch: (
    agent: {
      id: string;
      name: string;
      model: string;
      role: string;
      command: string;
    },
    cwd: string,
    initialPrompt?: string,
    resumeSessionId?: string,
    projectId?: string,
    taskId?: string,
  ) => Promise<{ id: string; ptySessionId: string; status: string }>;
  stop: (id: string) => Promise<void>;
  restart: (
    id: string,
  ) => Promise<{ id: string; ptySessionId: string; status: string } | null>;
  status: (id: string) => Promise<string>;
  list: (projectId?: string) => Promise<
    Array<{
      id: string;
      name: string;
      model: string;
      role: string;
      ptySessionId: string;
      status: string;
    }>
  >;
  remove: (id: string) => Promise<{ success: boolean }>;
  onStatusChange: (
    callback: (data: { agentId: string; status: string }) => void,
  ) => void;
  healthStatus: (id: string) => Promise<{
    status: string;
    restartCount: number;
    lastExitCode: number | null;
  } | null>;
  onRestartAttempt: (
    callback: (data: {
      agentId: string;
      attempt: number;
      maxAttempts: number;
    }) => void,
  ) => void;
  onRestartFailed: (
    callback: (data: { agentId: string; exitCode: number }) => void,
  ) => void;
  onCostUpdate: (
    callback: (data: {
      projectId: string;
      agentId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalCost: number;
      taskId?: string;
      taskType?: string;
      sessionId?: string;
      detectedPlanType?: string;
      rateLimitPercent?: number;
      rateLimitResetAt?: number;
      rateLimitWeeklyPercent?: number;
      rateLimitWeeklyResetAt?: number;
    }) => void,
  ) => void;
  offCostUpdate: () => void;
  reconnect: (
    agents: Array<{
      id: string;
      name: string;
      model: string;
      role: string;
      command: string;
    }>,
    rootPath: string,
    projectId: string,
  ) => Promise<
    Array<{
      agentId: string;
      reconnected: boolean;
      ptySessionId: string | null;
      /** reconnected=false 일 때 왜 skip 됐는지. 프론트가 Firestore status
       * 를 "stopped" 로 동기화할지 결정하는 데 사용. "no-session" 만
       * stopped 로 마킹 (다른 사유는 그대로 둠). "foreign-machine" 은 타
       * 머신/레거시 소유 doc — 절대 mutate 하면 안 되므로 그대로 둔다. */
      skippedReason?:
        | "no-session"
        | "already-running"
        | "foreign-machine"
        | "launch-failed"
        | "unknown";
    }>
  >;
  onSyncStatus: (
    callback: (data: {
      agentId: string;
      agentName: string;
      status: string;
      currentTaskId: string | null;
    }) => void,
  ) => void;
}

interface DecomposedTaskDTO {
  title: string;
  description: string;
  role: "backend" | "frontend" | "test" | "devops";
  priority: number;
  depends_on: string[];
  scope: string[];
  estimatedHours: number;
}

interface DecompositionResultDTO {
  projectName: string;
  tasks: DecomposedTaskDTO[];
  dag: { nodes: string[]; edges: [string, string][] };
}

interface OrchestratorAPI {
  decompose: (text: string) => Promise<DecompositionResultDTO>;
  createTasks: (
    tasks: DecomposedTaskDTO[],
  ) => Promise<{ tasks: DecomposedTaskDTO[]; layers: string[][] }>;
}

interface MissionOrchestratorAPI {
  start: (args: {
    projectId: string;
    rootPath: string;
    modelType?: string;
    missionId?: string;
  }) => Promise<{
    sessionId: string;
    ptySessionId: string;
    status: string;
  } | null>;
  getSession: (projectId: string) => Promise<{
    sessionId: string;
    ptySessionId: string;
    status: string;
  } | null>;
  stop: (projectId: string) => Promise<void>;
  /** 미션 스코프 중지 — 그 미션에 바인딩된 오케만 stop (main 가드가
   * getOwnerMissionId 일치할 때만). 무관한 오케는 보존하므로 무조건 호출 안전. */
  stopForMission: (projectId: string, missionId: string) => Promise<void>;
  resolvePrevious: (rootPath: string) => Promise<string | null>;
  onStatusChange: (callback: (data: { status: string }) => void) => void;
  removeStatusListener: () => void;
  onNeedsInput: (
    callback: (notice: {
      missionId: string;
      projectId: string;
      goal: string;
      kind: "pty_input_required" | "escalate";
      question?: string;
      skill?: string | null;
    }) => void,
  ) => void;
  removeNeedsInputListener: () => void;
}

interface OrchestratorSessionAPI {
  launch: (
    projectId: string,
    rootPath: string,
    resumeSessionId?: string,
  ) => Promise<{
    sessionId: string;
    ptySessionId: string;
    status: string;
  }>;
  stop: () => Promise<void>;
  status: () => Promise<string>;
  listSessions: (rootPath: string) => Promise<
    {
      id: string;
      updatedAt: number;
      sizeKB: number;
      label?: string;
      agentId?: string;
    }[]
  >;
  resolvePrevious: (rootPath: string) => Promise<string | null>;
  onStatusChange: (callback: (data: { status: string }) => void) => void;
  onAgentSpawned: (
    callback: (data: {
      agentId: string;
      name: string;
      ptySessionId: string;
      model: string;
      role: string;
    }) => void,
  ) => void;
}

type FlowEvent =
  | { type: "node:start"; nodeId: string }
  | { type: "node:complete"; nodeId: string; result: unknown }
  | { type: "node:error"; nodeId: string; error: string }
  | { type: "flow:paused"; runId: string; pendingNodeId: string }
  | { type: "flow:resumed"; runId: string }
  | { type: "flow:completed"; runId: string; state: unknown }
  | { type: "flow:failed"; runId: string; error: string }
  | { type: "flow:cancelled"; runId: string };

interface FlowAPI {
  run: (
    flow: unknown,
    inputs?: Record<string, unknown>,
  ) => Promise<{ runId: string }>;
  pause: (runId: string) => Promise<void>;
  resume: (
    runId: string,
    humanInput?: { nodeId: string; approved: boolean; data?: unknown },
  ) => Promise<void>;
  cancel: (runId: string) => Promise<void>;
  getState: (runId: string) => Promise<unknown>;
  onEvent: (callback: (event: FlowEvent) => void) => void;
  offEvent: () => void;
}

interface SettingsAPI {
  getApiKeys: () => Promise<{
    anthropic: string;
    openai: string;
    google: string;
    _isSet: { anthropic: boolean; openai: boolean; google: boolean };
  }>;
  setApiKey: (provider: string, key: string) => Promise<{ success: boolean }>;
  deleteApiKey: (provider: string) => Promise<{ success: boolean }>;
}

interface CodeAPI {
  format: (
    content: string,
    filePath: string,
  ) => Promise<{ formatted: string; error: string | null }>;
}

interface ModelPresetAPI {
  get: () => Promise<string>;
  set: (preset: string) => Promise<{ success: boolean }>;
}

interface SubscriptionPlanEntry {
  modelPrefix: string;
  monthlyFlatUsd: number;
  monthlyTokenAllowance?: number;
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

interface SubscriptionPlansAPI {
  list: () => Promise<SubscriptionPlanEntry[]>;
  save: (
    plans: SubscriptionPlanEntry[],
  ) => Promise<{ success: boolean; error?: string }>;
}

interface ClipboardAPI {
  readText: () => Promise<string>;
  getImagePath: () => Promise<string | null>;
  getFilePaths: () => Promise<string[]>;
}

interface BridgeAPI {
  injectMessage: (params: {
    targetAgent: string;
    tag: string;
    message: string;
    taskId?: string;
    taskTitle?: string;
  }) => Promise<{ success: boolean; delivered?: string; error?: string }>;
}

interface AppStateAPI {
  load: () => Promise<{
    lastProjectId?: string;
    lastRootPath?: string;
    wasOrchestratorRunning?: boolean;
  }>;
  save: (state: {
    lastProjectId?: string;
    lastRootPath?: string;
    wasOrchestratorRunning?: boolean;
  }) => Promise<{ success: boolean }>;
}

interface SystemAPI {
  onWake: (callback: () => void) => void;
  offWake: () => void;
}

interface WorktreeStatus {
  branch: string;
  baseRef: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  mergeable: boolean;
  conflicts: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
}

interface WorktreeStaleInfo {
  merged: boolean;
  idleDays: number;
  stale: boolean;
}

interface WorktreeListItem {
  path: string;
  branch: string;
  head: string;
  status: WorktreeStatus;
  /** Cleanup candidate (merged into base or long idle). Main worktree → false. */
  stale?: boolean;
  /** Full stale verdict; omitted for the main worktree. */
  staleInfo?: WorktreeStaleInfo;
}

interface WorktreeProjectGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: WorktreeListItem[];
}

interface WorktreeMergeArgs {
  repoRoot: string;
  path: string;
  baseRef: string;
  branch: string;
  /** Best-effort metadata for the merge-history audit trail. */
  projectId?: string;
  taskId?: string;
  mode?: "manual" | "auto";
}

interface WorktreeResolveArgs extends WorktreeMergeArgs {
  projectId?: string;
  taskId?: string;
  conflicts?: string[];
}

interface WorktreeAPI {
  list: () => Promise<WorktreeProjectGroup[]>;
  refresh: () => Promise<WorktreeProjectGroup[]>;
  status: (path: string, baseRef: string) => Promise<WorktreeStatus>;
  remove: (
    repoRoot: string,
    path: string,
    deleteBranch?: boolean,
  ) => Promise<{ success: boolean }>;
  prune: (repoRoot: string) => Promise<{ success: boolean }>;
  cleanupStale: (
    repoRoot: string,
    maxIdleDays?: number,
  ) => Promise<{
    removed: string[];
    failed: { path: string; error: string }[];
  }>;
  rebase: (
    path: string,
    baseRef: string,
  ) => Promise<{ ok: boolean; conflicts?: string[] }>;
  merge: (args: WorktreeMergeArgs) => Promise<{
    ok: boolean;
    needsResolve?: boolean;
    conflicts?: string[];
    error?: string;
    mergedSha?: string;
  }>;
  resolve: (args: WorktreeResolveArgs) => Promise<{
    success: boolean;
    agentId?: string;
    stub?: boolean;
    reason?: string;
  }>;
  showCommit: (
    repoRoot: string,
    sha: string,
  ) => Promise<{ ok: boolean; diff: string }>;
}

interface BoardAPI {
  worktreeDiff: (args: {
    taskId?: string;
    worktreePath?: string;
    baseRef?: string;
  }) => Promise<string>;
}

interface WindowAPI {
  /** True for File > New Window / Cmd+Shift+N windows. */
  isNewWindow: () => boolean;
  /** Register the renderer's current project so main can scope events
   * (agent:spawned, agent:statusChanged, etc.) to this window. Pass empty
   * string to clear the registration when the project is closed. */
  registerProject: (projectId: string) => Promise<void>;
  /** Persist this window's folder/project in main, keyed by webContents.id
   * (stable across a renderer reload). Lets a window reconnect to its project
   * after a sleep/wake reload. Only non-empty fields are stored; the record is
   * never cleared by transient nulls (only when the window closes). */
  registerRestore: (state: {
    rootPath?: string;
    projectId?: string;
  }) => Promise<void>;
  /** Read back this window's saved folder/project for reconnect on startup. */
  getRestoreState: () => Promise<{ rootPath?: string; projectId?: string }>;
  /** Pop a tab (Board/Code) out into its own detached window. The new window
   * inherits this window's folder/project so it opens on the same data. */
  popOutTab: (
    view: "board" | "code" | "history",
  ) => Promise<{ success: boolean }>;
}

interface HarnessPackage {
  id: string;
  name: string;
  description: string;
  type: "skill" | "mcp" | "plugin" | "cli";
  category: "required" | "recommended" | "mcp" | "cli";
  install: {
    kind: "git" | "mcp" | "bundled" | "manual" | "npm-global" | "shell";
    source?: string;
    dest?: string;
    env?: Record<string, string>;
    args?: string[];
    instructions?: string;
    postInstall?: string;
    postInstallExec?: Array<{ command: string; args: string[] }>;
  };
  detect: { path?: string; mcpKey?: string; binary?: string };
  url?: string;
  deprecated?: { note: string };
  status: "installed" | "not-installed" | "manual-required" | "unknown";
}

interface HarnessVersionInfo {
  localVersion: string | null;
  latestVersion: string | null;
  updateState: "up-to-date" | "outdated" | "unknown";
}

interface CliAuthResult {
  installed: boolean;
  authenticated: boolean;
  action?: string;
}

interface HarnessAPI {
  list: () => Promise<HarnessPackage[]>;
  versions: () => Promise<Record<string, HarnessVersionInfo>>;
  install: (id: string) => Promise<{ success: boolean; error?: string }>;
  uninstall: (id: string) => Promise<{ success: boolean; error?: string }>;
  cliAuthCheck: (model: "claude" | "codex") => Promise<CliAuthResult>;
}

type ConnectionAccessMode = "read" | "write" | "pr" | "commit";
type ConnectionPermissionsState = "unknown" | "pending" | "granted" | "denied";

interface ProjectConnection {
  projectId: string;
  localPath: string;
  repoUrl: string | null;
  defaultBranch: string | null;
  connectedHarness: string | null;
  availableMcps: string[];
  accessMode: ConnectionAccessMode;
  lastRunAt: number | null;
  permissionsState: ConnectionPermissionsState;
}

interface ConnectionCheckItem {
  id: "repo" | "branch" | "issues" | "pullRequest" | "auth";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface ConnectionCheckResult {
  checkedAt: number;
  ok: boolean;
  items: ConnectionCheckItem[];
}

interface ConnectionAPI {
  get: (projectId: string) => Promise<ProjectConnection | null>;
  list: () => Promise<ProjectConnection[]>;
  upsert: (
    input: Partial<ProjectConnection> & {
      projectId: string;
      localPath: string;
    },
  ) => Promise<ProjectConnection>;
  touchLastRun: (
    projectId: string,
    at?: number,
  ) => Promise<ProjectConnection | null>;
  check: (projectId: string) => Promise<ConnectionCheckResult>;
}

interface UpdaterStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  info?: { version?: string; releaseName?: string };
  progress?: { percent: number };
  error?: string;
  forceInstallInMs?: number;
}

interface UpdaterAPI {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  cancelHotfix: () => Promise<void>;
  onStatus: (cb: (status: UpdaterStatus) => void) => void;
  offStatus: () => void;
}

interface TestModeAPI {
  /** Main process 가 MARBLO_TEST_BYPASS_AUTH=1 로 launch 됐을 때만 true. */
  bypassAuth: boolean;
  /** MARBLO_TEST_MISSIONS_INMEM=1 로 launch 됐을 때만 true. missionService 가
   * Firestore 대신 in-memory 백엔드를 써 결정적 미션탭 E2E 를 가능케 한다. */
  missionsInMemory: boolean;
}

interface ClaudeAPI {
  version: () => Promise<{ command: string; version: string }>;
  cliVersions: () => Promise<Record<string, string>>;
}

/** Packaged-app Google sign-in via system-browser loopback OAuth (B안). */
interface AuthAPI {
  /** Run the loopback OAuth flow in the system browser; resolves with the
   * id_token (+ access_token) on success, or { ok:false, error } otherwise. */
  googleLoopback: () => Promise<{
    ok: boolean;
    idToken?: string;
    accessToken?: string;
    error?: string;
  }>;
}

/** Account-global rate-limit reading for one provider. null fields = no
 * information (logged out / probe failed), never zero usage. */
interface RateLimitSnapshot {
  planType: string | null;
  primaryPercent: number | null;
  primaryResetAt: number | null;
  secondaryPercent: number | null;
  secondaryResetAt: number | null;
}

interface UsageAPI {
  /** Account-level rate limits independent of any running agent. */
  accountRateLimits: () => Promise<{
    claude: RateLimitSnapshot | null;
    gpt: RateLimitSnapshot | null;
  }>;
}

interface ElectronAPI {
  platform: string;
  testMode: TestModeAPI;
  window: WindowAPI;
  auth: AuthAPI;
  claude: ClaudeAPI;
  harness: HarnessAPI;
  usage: UsageAPI;
  send: (channel: string, data: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string) => void;
  pty: PtyAPI;
  agent: AgentAPI;
  worktree: WorktreeAPI;
  board: BoardAPI;
  orchestrator: OrchestratorAPI;
  orchestratorSession: OrchestratorSessionAPI;
  missionOrchestrator: MissionOrchestratorAPI;
  flow: FlowAPI;
  fs: FsAPI;
  settings: SettingsAPI;
  code: CodeAPI;
  modelPreset: ModelPresetAPI;
  subscriptionPlans: SubscriptionPlansAPI;
  clipboard: ClipboardAPI;
  bridge: BridgeAPI;
  appState: AppStateAPI;
  system: SystemAPI;
  connection: ConnectionAPI;
  updater: UpdaterAPI;
}

interface Window {
  electronAPI: ElectronAPI;
}
