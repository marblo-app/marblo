import { contextBridge, ipcRenderer, webUtils } from "electron";
// Sets up the @sentry/electron renderer↔main IPC bridge for this (sandboxed,
// contextIsolated) preload. Inert until BOTH the main and renderer SDKs are
// initialized — which only happens after the user opts in AND a DSN is
// configured (see src/lib/telemetry/sentry.ts). No network on the no-consent
// path. Required because we use a custom preload; the SDK cannot auto-inject.
//
// GUARDED: this MUST NOT be a bare top-level `import`. A sandboxed preload
// (Electron's default) can't `require` an unbundled node_modules package, and
// if @sentry/electron isn't packaged the require throws — either way the throw
// would abort this module BEFORE exposeInMainWorld runs, leaving
// window.electronAPI undefined and white-screening the whole app on launch.
// Sentry is dead weight without a DSN anyway, so a failure here is non-fatal.
//
// `__SENTRY_PRELOAD_ENABLED__` is baked in by scripts/bundle-preload.mjs, which
// esbuild-bundles this file so the require above resolves at BUILD time (a
// sandboxed preload cannot resolve node_modules at runtime — measured:
// "module not found: @sentry/electron/preload", which is why the bridge had
// never once installed). Three states, and the `typeof` test must come first:
//
//   undefined → not bundled (bare tsc output). Warn loudly; a silent miss here
//               is precisely the failure mode this ticket exists to kill.
//               `typeof` on an undeclared identifier is safe — it cannot throw.
//   false     → bundled with no DSN. Complete no-op; esbuild has already
//               dead-code-eliminated the SDK out of the artifact entirely.
//   true      → bundled with a DSN. The bridge is inlined; wire it up.
if (typeof __SENTRY_PRELOAD_ENABLED__ === "undefined") {
  console.warn(
    "[preload] not esbuild-bundled — Sentry renderer bridge inactive. " +
      "Run `node scripts/bundle-preload.mjs` (build scripts do this after tsc).",
  );
} else if (__SENTRY_PRELOAD_ENABLED__) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@sentry/electron/preload");
  } catch (err) {
    console.warn(
      "[preload] @sentry/electron/preload unavailable — skipping Sentry renderer bridge",
      err,
    );
  }
}

const isNewWindow = process.argv.includes("--marblo-new-window=1");

/**
 * env-swap 벤더 크레덴셜의 **값 없는** 스냅샷(main 의 `vendorSecretsSnapshot` 과
 * 같은 모양). preview 는 `abcd***wxyz` 로 마스킹된 문자열이고, 평문 시크릿은 이
 * 브리지를 **한 방향으로도** 통과하지 않는다(set 의 입력만 예외).
 */
interface VendorSecretsSnapshot {
  encryptionAvailable: boolean;
  vendors: Array<{
    vendor: string;
    envKeys: string[];
    modelIds: string[];
    ready: boolean;
    keys: Array<{
      envKey: string;
      source: "env" | "store" | "none";
      storedInApp: boolean;
      presentInProcessEnv: boolean;
      preview: string;
    }>;
  }>;
}

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  // 이 기기의 안정적 식별자. 프로젝트 폴더 경로를 기기별 칸에 저장하려면
  // 렌더러가 자기 machineId 를 알아야 한다(티켓 sHyHC9RoutYHDt97UOEm).
  // app-state.json 에 이미 있는 값이라 새로 만들지 않는다.
  getMachineId: () => ipcRenderer.invoke("app:getMachineId"),
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
    // Pop a tab (Board/Code/History) out into its own detached window. The new window
    // inherits this window's project so it opens on the same data.
    popOutTab: (view: "board" | "code" | "history") =>
      ipcRenderer.invoke("window:popOutTab", view) as Promise<{
        success: boolean;
      }>,
  },
  // Packaged-app Google sign-in via system-browser loopback OAuth (B안,
  // ticket QvaYPAjAW822I0IDiwwZ). Returns the id_token (+ access_token) that the
  // renderer feeds to signInWithCredential. See docs/GOOGLE_LOGIN_PACKAGED.md.
  auth: {
    googleLoopback: (): Promise<{
      ok: boolean;
      idToken?: string;
      accessToken?: string;
      error?: string;
    }> => ipcRenderer.invoke("auth:googleLoopback"),
    syncAgentCustomToken: (
      customToken: string,
    ): Promise<{ ok: boolean; uid?: string; error?: string }> =>
      ipcRenderer.invoke("auth:syncAgentCustomToken", { customToken }),
    clearAgentCustomToken: (): Promise<{
      ok: boolean;
      error?: string;
    }> => ipcRenderer.invoke("auth:clearAgentCustomToken"),
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
      /** 명시 모델 핀 `<modelId>[@<effort>]` (퀵레인 모델 셀렉터). */
      modelPin?: string,
    ) =>
      ipcRenderer.invoke("agent:launch", {
        agent,
        cwd,
        initialPrompt,
        resumeSessionId,
        projectId,
        taskId,
        modelPin,
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
    // Topology-only enumeration (no per-worktree status probes) — the cheap
    // freshness path for board cards / ticket modal (ticket yJgz7s03).
    listLight: () => ipcRenderer.invoke("worktree:listLight"),
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
    showCommit: (repoRoot: string, sha: string, projectId?: string) =>
      ipcRenderer.invoke("worktree:showCommit", { repoRoot, sha, projectId }),
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
  board: {
    worktreeDiff: (args: {
      taskId?: string;
      worktreePath?: string;
      baseRef?: string;
    }) => ipcRenderer.invoke("board:worktreeDiff", args),
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
    // projectId 를 주면 main 이 프로젝트별 모델(codex 등)을 인지해 해석한다.
    resolvePrevious: (
      rootPath: string,
      projectId?: string,
    ): Promise<string | null> =>
      ipcRenderer.invoke(
        "missionOrchestrator:resolvePrevious",
        rootPath,
        projectId,
      ),
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
    // In-process, project-resolved delivery of a free-form instruction to the
    // project's orchestrator PTY. Returns a REAL ack ({ delivered, reason }) so
    // the renderer router can fall through to the durable queue on a miss —
    // unlike the fire-and-forget pty.writeAndSubmit it replaces.
    injectMessage: (
      projectId: string,
      message: string,
    ): Promise<{ delivered: boolean; reason?: string }> =>
      ipcRenderer.invoke("orchestrator:injectMessage", { projectId, message }),
  },
  orchestratorSession: {
    // model: 이번 launch 의 명시 모델(패널 Start). 생략하면 main 이 프로젝트별
    // 저장 모델(재시작 연속성) → 전역 설정 순으로 결정한다.
    launch: (
      projectId: string,
      rootPath: string,
      resumeSessionId?: string,
      model?: string,
    ) =>
      ipcRenderer.invoke("orchestratorSession:launch", {
        projectId,
        rootPath,
        resumeSessionId,
        model,
      }),
    switch: (args: {
      projectId: string;
      rootPath: string;
      targetModel: string;
      mode: "wait" | "takeover";
      resume: "fresh" | "previous";
    }) => ipcRenderer.invoke("orchestratorSession:switch", args),
    stop: () => ipcRenderer.invoke("orchestratorSession:stop"),
    status: () => ipcRenderer.invoke("orchestratorSession:status"),
    listSessions: (rootPath: string) =>
      ipcRenderer.invoke("orchestratorSession:listSessions", rootPath),
    // projectId lets main check the per-orchestrator isolated CODEX_HOME
    // before proposing a Codex resume.
    resolvePrevious: (
      rootPath: string,
      projectId?: string,
    ): Promise<string | null> =>
      ipcRenderer.invoke(
        "orchestratorSession:resolvePrevious",
        rootPath,
        projectId,
      ),
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
        /** 실제로 뜬 구체 모델(`model@effort`). 모델을 핀하지 않은 스폰이면
         * 없다 — 수신 측은 벤더(model) 표시로 fallback 해야 한다. */
        spawnedModel?: string;
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
  // Routing knowledge-graph feedback: the renderer (an authenticated project
  // member — the only party allowed to read member-scoped merge_history, cf
  // #406/L2 rules) forwards each new merge — the app's OR gh/GitHub's (#566) —
  // to main, which folds it into the machine-local routing graph. Fire-and-
  // forget send; main validates the payload and best-efforts the fold.
  kg: {
    recordMergeOutcome: (payload: {
      taskId: string;
      changeType: string | null;
      mergedAtMs: number | null;
      // Renderer-resolved routing ctx (dispatchMeta) — main can't read
      // member-scoped `tasks` itself (#406/L2). Optional/null-safe.
      role?: string | null;
      taskType?: string | null;
      complexity?: string | null;
      model?: string | null;
      /** ★P2-2 실스폰 관측 model@effort 키 — 그래프 셀의 모델 축. */
      spawnedModelKey?: string | null;
    }) => ipcRenderer.send("kg:recordMergeOutcome", payload),
  },
  // Sentry: consent-gated crash/error capture. The renderer calls initMain
  // ONLY after the user opts in AND VITE_SENTRY_DSN is set; main inits the
  // @sentry/electron/main SDK (idempotent, no-op without a DSN).
  sentry: {
    initMain: (opts: {
      dsn?: string;
      release?: string;
      environment?: string;
    }) =>
      ipcRenderer.invoke("sentry:init-main", opts) as Promise<{ ok: boolean }>,
  },
  settings: {
    getApiKeys: () => ipcRenderer.invoke("settings:getApiKeys"),
    setApiKey: (provider: string, key: string) =>
      ipcRenderer.invoke("settings:setApiKey", { provider, key }),
    deleteApiKey: (provider: string) =>
      ipcRenderer.invoke("settings:deleteApiKey", { provider }),
    // env-swap 벤더(GLM/MiniMax…) 크레덴셜. ★list/set/delete 모두 **평문을 돌려주지
    // 않는다** — 반환값은 마스킹된 스냅샷뿐이고, 평문은 set 의 입력으로만 흐른다.
    getVendorSecrets: () =>
      ipcRenderer.invoke(
        "vendorSecrets:list",
      ) as Promise<VendorSecretsSnapshot>,
    setVendorSecret: (envKey: string, value: string) =>
      ipcRenderer.invoke("vendorSecrets:set", { envKey, value }) as Promise<{
        success: boolean;
        snapshot: VendorSecretsSnapshot;
      }>,
    deleteVendorSecret: (envKey: string) =>
      ipcRenderer.invoke("vendorSecrets:delete", { envKey }) as Promise<{
        success: boolean;
        snapshot: VendorSecretsSnapshot;
      }>,
    getPowerSave: () =>
      ipcRenderer.invoke("settings:getPowerSave") as Promise<{
        preventSleepWhileWorking: boolean;
        active: boolean;
        refCount: number;
        sources: string[];
      }>,
    setPowerSave: (preventSleepWhileWorking: boolean) =>
      ipcRenderer.invoke("settings:setPowerSave", {
        preventSleepWhileWorking,
      }) as Promise<{
        success: boolean;
        error?: string;
        preventSleepWhileWorking?: boolean;
        active?: boolean;
        refCount?: number;
        sources?: string[];
      }>,
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
  models: {
    /**
     * 퀵레인 모델 셀렉터가 그릴 벤더→모델 카탈로그. 목록은 `model-registry`
     * 파생이고 available/missingEnvKeys 는 main 이 `process.env` 로 판정한다.
     * ★키 **이름**과 boolean 만 건너온다(시크릿 값은 절대 안 넘어온다).
     */
    quickLaneCatalog: () => ipcRenderer.invoke("models:quickLaneCatalog"),
    /**
     * 사용량 탭 상단 정보표(단가·개략 SWE-bench·컨텍스트). `model-registry` +
     * 컨텍스트/벤치 참조표의 조인이고, env·시크릿은 지나가지 않는다.
     */
    factSheet: () => ipcRenderer.invoke("models:factSheet"),
  },
  orchestratorModel: {
    // projectId 를 주면 그 프로젝트의 오케가 마지막으로 돈 모델을 우선 반환/기록
    // (재시작 연속성). 생략하면 레거시 전역값.
    get: (projectId?: string) =>
      ipcRenderer.invoke("orchestratorModel:get", projectId) as Promise<string>,
    set: (model: string, projectId?: string) =>
      ipcRenderer.invoke("orchestratorModel:set", model, projectId) as Promise<{
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
        preventSleepWhileWorking?: boolean;
      }>,
    save: (state: {
      lastProjectId?: string;
      lastRootPath?: string;
      wasOrchestratorRunning?: boolean;
      preventSleepWhileWorking?: boolean;
    }) => ipcRenderer.invoke("appState:save", state),
  },
  system: {
    onWake: (callback: () => void) => {
      ipcRenderer.on("system:wake", () => callback());
    },
    offWake: () => {
      ipcRenderer.removeAllListeners("system:wake");
    },
    nodeHealth: () => ipcRenderer.invoke("system:nodeHealth"),
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
    cliAuthCheck: (model: "claude" | "codex" | "grok" | "antigravity") =>
      ipcRenderer.invoke("harness:cliAuthCheck", { model }) as Promise<{
        installed: boolean;
        authenticated: boolean;
        action?: string;
      }>,
  },
  usage: {
    // Account-global rate-limit snapshots, independent of any running agent.
    // null per provider = no information (logged out / probe failed), never 0%.
    accountRateLimits: () =>
      ipcRenderer.invoke("usage:accountRateLimits") as Promise<{
        claude: {
          planType: string | null;
          primaryPercent: number | null;
          primaryResetAt: number | null;
          primaryWindowDurationMins?: number | null;
          secondaryPercent: number | null;
          secondaryResetAt: number | null;
          secondaryWindowDurationMins?: number | null;
        } | null;
        gpt: {
          planType: string | null;
          primaryPercent: number | null;
          primaryResetAt: number | null;
          primaryWindowDurationMins?: number | null;
          secondaryPercent: number | null;
          secondaryResetAt: number | null;
          secondaryWindowDurationMins?: number | null;
        } | null;
      }>,
  },
  fs: {
    readTree: (rootPath: string) => ipcRenderer.invoke("fs:readTree", rootPath),
    readFile: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("fs:readFile", { rootPath, filePath }),
    writeFile: (rootPath: string, filePath: string, content: string) =>
      ipcRenderer.invoke("fs:writeFile", { rootPath, filePath, content }),
    gitStatus: (rootPath: string) =>
      ipcRenderer.invoke("fs:gitStatus", rootPath),
    // Everything the worktree changed vs. its base branch (committed +
    // uncommitted + untracked), on-demand for a single worktree.
    gitWorktreeChanges: (rootPath: string, baseRef: string) =>
      ipcRenderer.invoke("fs:gitWorktreeChanges", { rootPath, baseRef }),
    gitDiff: (filePath: string, baseSha?: string) =>
      ipcRenderer.invoke("fs:gitDiff", filePath, baseSha),
    gitRemoteUrl: (rootPath: string) =>
      ipcRenderer.invoke("fs:gitRemoteUrl", rootPath),
    selectDirectory: () => ipcRenderer.invoke("fs:selectDirectory"),
    pathExists: (targetPath: string): Promise<boolean> =>
      ipcRenderer.invoke("fs:pathExists", targetPath),
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
    readFileBase64: (rootPath: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke("fs:readFileBase64", { rootPath, filePath }),
    // Electron 32+ removed File.path; webUtils.getPathForFile is the supported
    // way to resolve a dropped file's absolute path (called from preload).
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    importPaths: (args: {
      rootPath: string;
      destDir: string;
      srcPaths: string[];
    }): Promise<{ success: boolean; imported: string[] }> =>
      ipcRenderer.invoke("fs:importPaths", args),
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
