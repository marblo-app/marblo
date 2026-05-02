/// <reference types="vite/client" />

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
  selectDirectory: () => Promise<string | null>;
  watch: (rootPath: string) => Promise<void>;
  onFileChange: (callback: (event: string, filePath: string) => void) => void;
  offFileChange: () => void;
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
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  list: () => Promise<{ id: string; name: string }[]>;
  onData: (id: string, callback: (data: string) => void) => void;
  onExit: (id: string, callback: (code: number) => void) => void;
  replay: (id: string) => Promise<string[]>;
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

interface ClipboardAPI {
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

interface WindowAPI {
  /** Register the renderer's current project so main can scope events
   * (agent:spawned, agent:statusChanged, etc.) to this window. Pass empty
   * string to clear the registration when the project is closed. */
  registerProject: (projectId: string) => Promise<void>;
}

interface ElectronAPI {
  platform: string;
  window: WindowAPI;
  send: (channel: string, data: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string) => void;
  pty: PtyAPI;
  agent: AgentAPI;
  orchestrator: OrchestratorAPI;
  orchestratorSession: OrchestratorSessionAPI;
  flow: FlowAPI;
  fs: FsAPI;
  settings: SettingsAPI;
  code: CodeAPI;
  modelPreset: ModelPresetAPI;
  clipboard: ClipboardAPI;
  bridge: BridgeAPI;
  appState: AppStateAPI;
  system: SystemAPI;
}

interface Window {
  electronAPI: ElectronAPI;
}
