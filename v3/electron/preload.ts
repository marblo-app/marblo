import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  // Multi-window: renderer registers its current project so main can scope
  // agent:* and orchestrator:* events to the right window. Pass empty string
  // to clear (e.g., when project is closed).
  window: {
    registerProject: (projectId: string) =>
      ipcRenderer.invoke("window:registerProject", projectId),
  },
  send: (channel: string, data: unknown) => {
    ipcRenderer.send(channel, data);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  off: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  pty: {
    create: (opts: {
      id: string;
      name: string;
      command?: string;
      args?: string[];
      cwd?: string;
    }) => ipcRenderer.invoke("pty:create", opts),
    // Fire-and-forget for keystrokes — avoids invoke's Promise round-trip.
    // Returns Promise<void> for type compatibility with awaiting callers.
    write: (id: string, data: string): Promise<void> => {
      ipcRenderer.send("pty:write", { id, data });
      return Promise.resolve();
    },
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke("pty:resize", { id, cols, rows }),
    kill: (id: string) => ipcRenderer.invoke("pty:kill", { id }),
    list: () => ipcRenderer.invoke("pty:list"),
    onData: (id: string, callback: (data: string) => void) => {
      ipcRenderer.on(`pty:data:${id}`, (_event, data) => callback(data));
    },
    onExit: (id: string, callback: (code: number) => void) => {
      ipcRenderer.on(`pty:exit:${id}`, (_event, code) => callback(code));
    },
    replay: (id: string): Promise<string[]> =>
      ipcRenderer.invoke("pty:replay", { id }),
    removeListeners: (id: string) => {
      ipcRenderer.removeAllListeners(`pty:data:${id}`);
      ipcRenderer.removeAllListeners(`pty:exit:${id}`);
    },
  },
  agent: {
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
    ) =>
      ipcRenderer.invoke("agent:launch", {
        agent,
        cwd,
        initialPrompt,
        resumeSessionId,
        projectId,
      }),
    stop: (id: string) => ipcRenderer.invoke("agent:stop", id),
    restart: (id: string) => ipcRenderer.invoke("agent:restart", id),
    status: (id: string) => ipcRenderer.invoke("agent:status", id),
    list: (projectId?: string) => ipcRenderer.invoke("agent:list", projectId),
    remove: (id: string) => ipcRenderer.invoke("agent:remove", id),
    onStatusChange: (
      callback: (data: { agentId: string; status: string }) => void,
    ) => {
      ipcRenderer.on("agent:statusChanged", (_event, data) => callback(data));
    },
    healthStatus: (id: string) => ipcRenderer.invoke("agent:healthStatus", id),
    onRestartAttempt: (
      callback: (data: {
        agentId: string;
        attempt: number;
        maxAttempts: number;
      }) => void,
    ) => {
      ipcRenderer.on("agent:restartAttempt", (_event, data) => callback(data));
    },
    onRestartFailed: (
      callback: (data: { agentId: string; exitCode: number }) => void,
    ) => {
      ipcRenderer.on("agent:restartFailed", (_event, data) => callback(data));
    },
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
      }) => void,
    ) => {
      ipcRenderer.on("cost:update", (_event, data) => callback(data));
    },
    offCostUpdate: () => {
      ipcRenderer.removeAllListeners("cost:update");
    },
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
    ) => ipcRenderer.invoke("agent:reconnect", { agents, rootPath, projectId }),
    onSyncStatus: (
      callback: (data: {
        agentId: string;
        agentName: string;
        status: string;
        currentTaskId: string | null;
      }) => void,
    ) => {
      ipcRenderer.on("agent:syncStatus", (_event, data) => callback(data));
    },
  },
  orchestrator: {
    decompose: (text: string) =>
      ipcRenderer.invoke("orchestrator:decompose", text),
    createTasks: (
      tasks: Array<{
        title: string;
        description: string;
        role: string;
        priority: number;
        depends_on: string[];
        scope: string[];
        estimatedHours: number;
      }>,
    ) => ipcRenderer.invoke("orchestrator:createTasks", tasks),
  },
  orchestratorSession: {
    launch: (projectId: string, rootPath: string, resumeSessionId?: string) =>
      ipcRenderer.invoke("orchestratorSession:launch", {
        projectId,
        rootPath,
        resumeSessionId,
      }),
    stop: () => ipcRenderer.invoke("orchestratorSession:stop"),
    status: () => ipcRenderer.invoke("orchestratorSession:status"),
    listSessions: (rootPath: string) =>
      ipcRenderer.invoke("orchestratorSession:listSessions", rootPath),
    onStatusChange: (callback: (data: { status: string }) => void) => {
      ipcRenderer.on("orchestrator:statusChanged", (_event, data) =>
        callback(data),
      );
    },
    onAgentSpawned: (
      callback: (data: {
        agentId: string;
        name: string;
        ptySessionId: string;
        model: string;
        role: string;
      }) => void,
    ) => {
      ipcRenderer.on("agent:spawned", (_event, data) => callback(data));
    },
  },
  flow: {
    run: (flow: unknown, inputs?: Record<string, unknown>) =>
      ipcRenderer.invoke("flow:run", { flow, inputs }),
    pause: (runId: string) => ipcRenderer.invoke("flow:pause", { runId }),
    resume: (
      runId: string,
      humanInput?: { nodeId: string; approved: boolean; data?: unknown },
    ) => ipcRenderer.invoke("flow:resume", { runId, humanInput }),
    cancel: (runId: string) => ipcRenderer.invoke("flow:cancel", { runId }),
    getState: (runId: string) => ipcRenderer.invoke("flow:getState", { runId }),
    onEvent: (callback: (event: unknown) => void) => {
      ipcRenderer.on("flow:event", (_event, data) => callback(data));
    },
    offEvent: () => {
      ipcRenderer.removeAllListeners("flow:event");
    },
  },
  telemetry: {
    onEvent: (callback: (data: Record<string, unknown>) => void) => {
      ipcRenderer.on("telemetry:event", (_event, data) => callback(data));
    },
    offEvent: () => {
      ipcRenderer.removeAllListeners("telemetry:event");
    },
  },
  settings: {
    getApiKeys: () => ipcRenderer.invoke("settings:getApiKeys"),
    setApiKey: (provider: string, key: string) =>
      ipcRenderer.invoke("settings:setApiKey", { provider, key }),
    deleteApiKey: (provider: string) =>
      ipcRenderer.invoke("settings:deleteApiKey", { provider }),
  },
  code: {
    format: (content: string, filePath: string) =>
      ipcRenderer.invoke("code:format", { content, filePath }) as Promise<{
        formatted: string;
        error: string | null;
      }>,
  },
  modelPreset: {
    get: () => ipcRenderer.invoke("modelPreset:get") as Promise<string>,
    set: (preset: string) =>
      ipcRenderer.invoke("modelPreset:set", preset) as Promise<{
        success: boolean;
      }>,
  },
  // Patent claim 8 (구독제 vs 토큰단위 과금): user declares which models
  // are on a subscription plan via this IPC. Stored at
  // ~/.marblo/subscription-plans.json so cost-tracker (which runs in
  // both electron main and per-agent MCP processes) sees the same view.
  subscriptionPlans: {
    list: () =>
      ipcRenderer.invoke("subscriptionPlans:list") as Promise<
        Array<{
          modelPrefix: string;
          monthlyFlatUsd: number;
          monthlyTokenAllowance?: number;
          overagePerToken?: { inputPer1M: number; outputPer1M: number };
        }>
      >,
    save: (
      plans: Array<{
        modelPrefix: string;
        monthlyFlatUsd: number;
        monthlyTokenAllowance?: number;
        overagePerToken?: { inputPer1M: number; outputPer1M: number };
      }>,
    ) =>
      ipcRenderer.invoke("subscriptionPlans:save", plans) as Promise<{
        success: boolean;
        error?: string;
      }>,
  },
  clipboard: {
    getImagePath: () =>
      ipcRenderer.invoke("clipboard:getImagePath") as Promise<string | null>,
    getFilePaths: () =>
      ipcRenderer.invoke("clipboard:getFilePaths") as Promise<string[]>,
  },
  bridge: {
    injectMessage: (params: {
      targetAgent: string;
      tag: string;
      message: string;
      taskId?: string;
      taskTitle?: string;
    }) =>
      ipcRenderer.invoke("bridge:injectMessage", params) as Promise<{
        success: boolean;
        delivered?: string;
        error?: string;
      }>,
  },
  appState: {
    load: () =>
      ipcRenderer.invoke("appState:load") as Promise<{
        lastProjectId?: string;
        lastRootPath?: string;
        wasOrchestratorRunning?: boolean;
      }>,
    save: (state: {
      lastProjectId?: string;
      lastRootPath?: string;
      wasOrchestratorRunning?: boolean;
    }) => ipcRenderer.invoke("appState:save", state),
  },
  system: {
    onWake: (callback: () => void) => {
      ipcRenderer.on("system:wake", () => callback());
    },
    offWake: () => {
      ipcRenderer.removeAllListeners("system:wake");
    },
  },
  harness: {
    list: () => ipcRenderer.invoke("harness:list"),
    install: (id: string) =>
      ipcRenderer.invoke("harness:install", id) as Promise<{
        success: boolean;
        error?: string;
      }>,
    uninstall: (id: string) =>
      ipcRenderer.invoke("harness:uninstall", id) as Promise<{
        success: boolean;
        error?: string;
      }>,
  },
  fs: {
    readTree: (rootPath: string) => ipcRenderer.invoke("fs:readTree", rootPath),
    readFile: (filePath: string) => ipcRenderer.invoke("fs:readFile", filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke("fs:writeFile", { filePath, content }),
    gitStatus: (rootPath: string) =>
      ipcRenderer.invoke("fs:gitStatus", rootPath),
    gitDiff: (filePath: string) => ipcRenderer.invoke("fs:gitDiff", filePath),
    gitRemoteUrl: (rootPath: string) =>
      ipcRenderer.invoke("fs:gitRemoteUrl", rootPath),
    selectDirectory: () => ipcRenderer.invoke("fs:selectDirectory"),
    watch: (rootPath: string) => ipcRenderer.invoke("fs:watch", rootPath),
    onFileChange: (callback: (event: string, filePath: string) => void) => {
      ipcRenderer.on("fs:change", (_event, ev, fp) =>
        callback(ev as string, fp as string),
      );
    },
    offFileChange: () => {
      ipcRenderer.removeAllListeners("fs:change");
    },
    createFile: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("fs:createFile", { rootPath, filePath }),
    createDirectory: (rootPath: string, dirPath: string) =>
      ipcRenderer.invoke("fs:createDirectory", { rootPath, dirPath }),
    rename: (rootPath: string, fromPath: string, toPath: string) =>
      ipcRenderer.invoke("fs:rename", { rootPath, fromPath, toPath }),
    remove: (rootPath: string, targetPath: string) =>
      ipcRenderer.invoke("fs:remove", { rootPath, targetPath }),
    copy: (rootPath: string, fromPath: string, toPath: string) =>
      ipcRenderer.invoke("fs:copy", { rootPath, fromPath, toPath }),
    revealInFinder: (targetPath: string) =>
      ipcRenderer.invoke("fs:revealInFinder", targetPath),
  },
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    cancelHotfix: () => ipcRenderer.invoke("updater:cancelHotfix"),
    onStatus: (callback: (status: unknown) => void) => {
      ipcRenderer.on("updater:status", (_event, status) => callback(status));
    },
    offStatus: () => {
      ipcRenderer.removeAllListeners("updater:status");
    },
  },
});
