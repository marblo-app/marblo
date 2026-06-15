import { contextBridge, ipcRenderer } from "electron";

const isNewWindow = process.argv.includes("--marblo-new-window=1");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  // Test hatch — main process 에서 MARBLO_TEST_BYPASS_AUTH=1 로 launch 한
  // 경우에만 true. Playwright e2e 가 Firebase Auth 게이트를 우회해서 메인
  // UI 까지 도달하기 위해 AuthProvider 가 이 플래그를 본다. Production
  // 빌드에서는 env 가 set 되지 않으므로 항상 false → short-circuit. renderer
  // 코드는 이 값을 임의로 set 할 수 없다 (preload 만 process.env 접근 가능).
  testMode: {
    bypassAuth: process.env.MARBLO_TEST_BYPASS_AUTH === "1",
    // MARBLO_TEST_MISSIONS_INMEM=1 일 때만 true. missionService 가 Firestore
    // 대신 in-memory 백엔드로 분기해 결정적 미션탭 E2E 를 가능케 한다. preload
    // 만 process.env 접근 → renderer 가 임의 set 불가, production 미설정.
    missionsInMemory: process.env.MARBLO_TEST_MISSIONS_INMEM === "1",
  },
  // Multi-window: renderer registers its current project so main can scope
  // agent:* and orchestrator:* events to the right window. Pass empty string
  // to clear (e.g., when project is closed).
  window: {
    isNewWindow: () => isNewWindow,
    registerProject: (projectId: string) =>
      ipcRenderer.invoke("window:registerProject", projectId),
    // Persist this window's folder/project in main (keyed by webContents.id,
    // stable across a renderer reload) so it can reconnect after sleep/wake.
    // Only non-empty fields are stored; never cleared by transient nulls.
    registerRestore: (state: { rootPath?: string; projectId?: string }) =>
      ipcRenderer.invoke("window:registerRestore", state),
    // Read back this window's saved folder/project for reconnect on startup.
    getRestoreState: () =>
      ipcRenderer.invoke("window:getRestoreState") as Promise<{
        rootPath?: string;
        projectId?: string;
      }>,
  },
  // Resolved Claude Code binary used to launch agents (path + version).
  claude: {
    version: (): Promise<{ command: string; version: string }> =>
      ipcRenderer.invoke("claude:version"),
    // Fast installed-version map per agent model (claude/gpt/antigravity/gemini).
    cliVersions: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke("harness:cliVersions"),
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
    // Inject a message and submit it as a discrete Enter (verify-and-retry
    // CR). Use for programmatic sends (not raw keystroke passthrough).
    writeAndSubmit: (
      id: string,
      data: string,
      bracketedPaste?: boolean,
    ): Promise<void> => {
      ipcRenderer.send("pty:writeAndSubmit", { id, data, bracketedPaste });
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
    exists: (id: string): Promise<boolean> =>
      ipcRenderer.invoke("pty:exists", { id }),
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
      taskId?: string,
    ) =>
      ipcRenderer.invoke("agent:launch", {
        agent,
        cwd,
        initialPrompt,
        resumeSessionId,
        projectId,
        taskId,
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
        detectedPlanType?: string;
        rateLimitPercent?: number;
        rateLimitResetAt?: number;
        rateLimitWeeklyPercent?: number;
        rateLimitWeeklyResetAt?: number;
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
  worktree: {
    list: () => ipcRenderer.invoke("worktree:list"),
    refresh: () => ipcRenderer.invoke("worktree:refresh"),
    status: (path: string, baseRef: string) =>
      ipcRenderer.invoke("worktree:status", { path, baseRef }),
    remove: (repoRoot: string, path: string, deleteBranch?: boolean) =>
      ipcRenderer.invoke("worktree:remove", { repoRoot, path, deleteBranch }),
    prune: (repoRoot: string) => ipcRenderer.invoke("worktree:prune", repoRoot),
    // Bulk-remove stale worktrees (merged into base / long idle) + their
    // branches (WORKTREE-SPEC §4). Returns { removed, failed }.
    cleanupStale: (repoRoot: string, maxIdleDays?: number) =>
      ipcRenderer.invoke("worktree:cleanupStale", { repoRoot, maxIdleDays }),
    // Rebase the worktree branch onto base (WORKTREE-SPEC §4). Returns
    // { ok, conflicts? } — manager safe-aborts on conflict.
    rebase: (path: string, baseRef: string) =>
      ipcRenderer.invoke("worktree:rebase", { path, baseRef }),
    // Clean squash-merge path: rebase → squash onto base → cleanup. Returns
    // { ok, needsResolve?, conflicts?, error?, mergedSha? }. projectId/taskId/mode
    // are best-effort metadata for the merge-history audit trail.
    merge: (args: {
      repoRoot: string;
      path: string;
      baseRef: string;
      branch: string;
      projectId?: string;
      taskId?: string;
      mode?: "manual" | "auto";
    }) => ipcRenderer.invoke("worktree:merge", args),
    // Render a completed merge's diff for the "완료 이력" view (git show <sha>
    // on base, where the squashed commit lives after the worktree is gone).
    // Returns { ok, diff }.
    showCommit: (repoRoot: string, sha: string) =>
      ipcRenderer.invoke("worktree:showCommit", { repoRoot, sha }),
    // Conflict path: spawn a Resolve(agent) in the worktree (WORKTREE-SPEC §6).
    // Returns { success, agentId?, stub?, reason? }.
    resolve: (args: {
      repoRoot: string;
      path: string;
      baseRef: string;
      branch: string;
      projectId?: string;
      taskId?: string;
      conflicts?: string[];
    }) => ipcRenderer.invoke("worktree:resolve", args),
  },
  missionOrchestrator: {
    start: (args: {
      projectId: string;
      rootPath: string;
      modelType?: string;
      missionId?: string;
    }) => ipcRenderer.invoke("missionOrchestrator:start", args),
    getSession: (projectId: string) =>
      ipcRenderer.invoke("missionOrchestrator:getSession", projectId),
    stop: (projectId: string) =>
      ipcRenderer.invoke("missionOrchestrator:stop", projectId),
    // 미션 스코프 중지 — 그 미션에 바인딩된 오케만 stop (main 가드가
    // getOwnerMissionId 일치할 때만 stop). 무관한 오케는 보존.
    stopForMission: (projectId: string, missionId: string) =>
      ipcRenderer.invoke(
        "missionOrchestrator:stopForMission",
        projectId,
        missionId,
      ),
    // 직전 mission 오케스트레이터 세션 id (kind=mission) — 없으면 null. 부팅 시
    // 자동 재연결(resume) 여부 판단용. board 의 resolvePrevious 와 동일 패턴.
    resolvePrevious: (rootPath: string): Promise<string | null> =>
      ipcRenderer.invoke("missionOrchestrator:resolvePrevious", rootPath),
    onStatusChange: (callback: (data: { status: string }) => void) => {
      ipcRenderer.on("missionOrchestrator:statusChanged", (_event, data) =>
        callback(data),
      );
    },
    removeStatusListener: () => {
      ipcRenderer.removeAllListeners("missionOrchestrator:statusChanged");
    },
    // 미션이 사용자 개입을 요구할 때 (waiting_for_human + notifyUser) — 인앱
    // 토스트 / 탭 attention dot 용. OS 알림은 main 프로세스가 별도 발사.
    onNeedsInput: (
      callback: (notice: {
        missionId: string;
        projectId: string;
        goal: string;
        kind: "pty_input_required" | "escalate";
        question?: string;
        skill?: string | null;
      }) => void,
    ) => {
      ipcRenderer.on("mission:needsInput", (_event, notice) =>
        callback(notice),
      );
    },
    removeNeedsInputListener: () => {
      ipcRenderer.removeAllListeners("mission:needsInput");
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
    resolvePrevious: (rootPath: string): Promise<string | null> =>
      ipcRenderer.invoke("orchestratorSession:resolvePrevious", rootPath),
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
    readText: () => ipcRenderer.invoke("clipboard:readText") as Promise<string>,
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
    versions: () =>
      ipcRenderer.invoke("harness:versions") as Promise<
        Record<
          string,
          {
            localVersion: string | null;
            latestVersion: string | null;
            updateState: "up-to-date" | "outdated" | "unknown";
          }
        >
      >,
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
    cliAuthCheck: (model: "claude" | "codex") =>
      ipcRenderer.invoke("harness:cliAuthCheck", { model }) as Promise<{
        installed: boolean;
        authenticated: boolean;
        action?: string;
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
  // 프로젝트↔repo 연결 단일 진실원 (연동 T1). T2/T3 가 소비하는 읽기 인터페이스.
  connection: {
    get: (projectId: string) => ipcRenderer.invoke("connection:get", projectId),
    list: () => ipcRenderer.invoke("connection:list"),
    upsert: (input: unknown) => ipcRenderer.invoke("connection:upsert", input),
    setAccess: (input: unknown) =>
      ipcRenderer.invoke("connection:setAccess", input),
    touchLastRun: (projectId: string, at?: number) =>
      ipcRenderer.invoke("connection:touchLastRun", { projectId, at }),
    check: (projectId: string) =>
      ipcRenderer.invoke("connection:check", projectId),
    remove: (projectId: string) =>
      ipcRenderer.invoke("connection:remove", projectId),
  },
  // 오케스트레이터↔Telegram 채널 연결 (텔레그램 T1·보안 민감). T2 설정 UI 가
  // 소비한다. set 은 로컬 설정 경로 — 여기서만 권한 파일(access.json)이 갱신된다.
  // status.canEnable=false (chatId 없음 등)면 프론트가 토글을 잠가야 한다.
  telegramChannel: {
    get: (projectId: string) =>
      ipcRenderer.invoke("telegramChannel:get", projectId),
    list: () => ipcRenderer.invoke("telegramChannel:list"),
    set: (input: {
      projectId: string;
      botToken?: string | null;
      chatId?: string | null;
      enabled?: boolean;
      inboundCapability?: "read" | "trigger";
    }) => ipcRenderer.invoke("telegramChannel:set", input),
    status: (projectId: string) =>
      ipcRenderer.invoke("telegramChannel:status", projectId),
    remove: (projectId: string) =>
      ipcRenderer.invoke("telegramChannel:remove", projectId),
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
