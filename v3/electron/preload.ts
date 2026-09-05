import { contextBridge, ipcRenderer, webUtils } from "electron";
// 타입만 가져온다(esbuild 가 지워서 런타임 require 가 생기지 않는다). 잔액 응답의
// 모양이 메인과 갈라지지 않게 하는 유일한 방법이라 여기서만 예외적으로 쓴다.
import type { VendorBalanceResult } from "./vendor-balance";
// 같은 이유(모양이 메인과 갈라지지 않게) — 타입만 가져온다.
import type {
  AssistantTriggerDeliveryFailure as AssistantTriggerDeliveryFailureWire,
  AssistantTriggerFailureReason,
  AssistantTriggerKind,
} from "./assistant-trigger-delivery";
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
const LOCALE_STORAGE_KEY = "marblo:locale";

interface RendererLocaleGlobals {
  localStorage?: {
    getItem: (key: string) => string | null;
  };
  navigator?: {
    language?: string;
  };
}

function readRendererLocaleForMain(): string | undefined {
  const rendererGlobal = globalThis as typeof globalThis &
    RendererLocaleGlobals;
  try {
    const saved = rendererGlobal.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    // Locale is optional for orchestrator launch; main falls back to English.
  }

  try {
    const nav = rendererGlobal.navigator?.language?.toLowerCase() ?? "";
    return nav.startsWith("ko") ? "ko" : "en";
  } catch {
    return undefined;
  }
}

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

/**
 * 설정 화면이 그릴 에이전트 모델 프리셋 카탈로그. 모양은
 * `electron/dispatch-scoring.ModelPresetCatalogEntry` 와 같고, 값은 그 표 자체다.
 * (preload 는 main 모듈을 import 하지 않으므로 구조만 다시 적는다 — 값이 아니라
 * 모양의 중복이라 백엔드가 프리셋을 늘려도 여기 손댈 일이 없다.)
 */
/**
 * 학습데이터 캡처 상태(ticket IqcXHVbT0rXnHloXpV7n). 불리언과 건수뿐 —
 * 전사 원문도, uid 도, ADMIN_UID 도 여기 없다.
 */
interface TrainingCaptureStatus {
  /** 지금 실제로 캡처 중인가(= eligible && consent && 서버가 거부 안 함). */
  enabled: boolean;
  /** 서버가 이 계정을 적격이라고 답했나(= 운영자 본인인가). */
  eligible: boolean;
  /** 동의 플래그가 켜져 있나. */
  consent: boolean;
  /** 아직 업로드 못 하고 로컬 스풀에 남아 있는 샘플 수. */
  spooled: number;
  /** 캡처가 꺼져 있다면 그 사유(서버 거부 등). 정상이면 null. */
  disabledReason: string | null;
}

interface ModelPresetCatalog {
  presets: Array<{
    id: string;
    label: string;
    description: string;
    models: string[];
    budgetUsedFloorPercent?: number;
  }>;
  /** custom 프리셋에서 고를 수 있는 하네스 축. */
  customHarnesses: string[];
}

/**
 * 배달 실패 1건의 모양 검사. 사유·트리거 종류는 **아는 값만** 통과시킨다 —
 * 모르는 문자열을 그대로 흘리면 화면이 번역 키를 못 찾고 빈 배너를 그린다.
 */
const DELIVERY_FAILURE_REASONS: readonly AssistantTriggerFailureReason[] = [
  "orchestrator-offline",
  "orchestrator-folder-missing",
  "orchestrator-auth-blocked",
  "orchestrator-mcp-blocked",
  "orchestrator-vendor-blocked",
  "composer-busy",
  "delivery-failed",
];
const DELIVERY_FAILURE_TRIGGERS: readonly AssistantTriggerKind[] = [
  "schedule",
  "calendar",
  "gmail",
  "webhook",
  "sheets",
  "notice",
];

function isDeliveryFailure(
  value: unknown,
): value is AssistantTriggerDeliveryFailureWire {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.projectId === "string" &&
    typeof v.projectName === "string" &&
    typeof v.firstAt === "number" &&
    typeof v.lastAt === "number" &&
    typeof v.count === "number" &&
    DELIVERY_FAILURE_REASONS.includes(
      v.reason as AssistantTriggerFailureReason,
    ) &&
    DELIVERY_FAILURE_TRIGGERS.includes(v.trigger as AssistantTriggerKind)
  );
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
    registerRestore: (state: {
      uid: string;
      rootPath?: string;
      projectId?: string;
    }) => ipcRenderer.invoke("window:registerRestore", state),
    // Read back this window's saved folder/project for reconnect on startup.
    getRestoreState: (uid: string) =>
      ipcRenderer.invoke("window:getRestoreState", { uid }) as Promise<{
        uid?: string;
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
  browserPane: {
    openExternal: (url: string) =>
      ipcRenderer.invoke("browserPane:openExternal", { url }),
    attach: (input: {
      paneId: string;
      url: string;
      attachRequestedAt?: number;
    }) => ipcRenderer.invoke("browserPane:attach", input),
    navigate: (input: { paneId: string; url: string }) =>
      ipcRenderer.invoke("browserPane:navigate", input),
    reload: (paneId: string) =>
      ipcRenderer.invoke("browserPane:reload", { paneId }),
    setBounds: (input: {
      paneId: string;
      visible: boolean;
      bounds?: { x: number; y: number; width: number; height: number };
      windowOrigin?: { x: number; y: number };
    }) => ipcRenderer.invoke("browserPane:setBounds", input),
    release: (paneId: string) =>
      ipcRenderer.invoke("browserPane:release", { paneId }),
    registerOpenTarget: (enabled: boolean) =>
      ipcRenderer.invoke("browserPane:registerOpenTarget", enabled),
    // requestId round-trips to ackOpenUrl so main knows the click was
    // actually handled (ticket GiChqmgXxSQxdUwo3NLq — the prior bare `send`
    // had no way to tell a live listener from a missing one).
    onOpenUrl: (
      callback: (payload: { url: string; requestId: string }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ) => {
        if (
          payload &&
          typeof payload === "object" &&
          typeof (payload as { url?: unknown }).url === "string" &&
          typeof (payload as { requestId?: unknown }).requestId === "string"
        ) {
          callback(payload as { url: string; requestId: string });
        }
      };
      ipcRenderer.on("browserPane:openUrl", listener);
      return () => ipcRenderer.removeListener("browserPane:openUrl", listener);
    },
    ackOpenUrl: (requestId: string) =>
      ipcRenderer.send("browserPane:openUrl:ack", requestId),
    onState: (
      callback: (state: {
        paneId: string;
        url: string;
        title: string;
        isLoading: boolean;
        notice?: { code: string; message: string };
        security: {
          nodeIntegration: false;
          contextIsolation: true;
          partition: string;
        };
      }) => void,
    ) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        callback(
          state as {
            paneId: string;
            url: string;
            title: string;
            isLoading: boolean;
            notice?: { code: string; message: string };
            security: {
              nodeIntegration: false;
              contextIsolation: true;
              partition: string;
            };
          },
        );
      };
      ipcRenderer.on("browserPane:state", listener);
      return () => ipcRenderer.removeListener("browserPane:state", listener);
    },
    // ── Stage 1 agent web-tab read surface (ticket FQ7nshXHjDWOvD0WWUVV) ──
    setAgentReadAccess: (input: { paneId: string; granted: boolean }) =>
      ipcRenderer.invoke("browserPane:setAgentReadAccess", input),
    getAgentReadAccess: (paneId: string) =>
      ipcRenderer.invoke("browserPane:getAgentReadAccess", { paneId }),
    setGlobalAgentStop: (suspended: boolean) =>
      ipcRenderer.invoke("browserPane:setGlobalAgentStop", { suspended }),
    getGlobalAgentStop: () =>
      ipcRenderer.invoke("browserPane:getGlobalAgentStop"),
    onAgentReadActivity: (
      callback: (event: {
        agentId: string;
        ticketId?: string;
        paneId: string;
        url: string;
        status: "reading" | "navigating" | "done" | "blocked" | "aborted";
        reason?: string;
        at: number;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ) => {
        callback(
          payload as {
            agentId: string;
            ticketId?: string;
            paneId: string;
            url: string;
            status: "reading" | "navigating" | "done" | "blocked" | "aborted";
            reason?: string;
            at: number;
          },
        );
      };
      ipcRenderer.on("browserPane:agentReadActivity", listener);
      return () =>
        ipcRenderer.removeListener("browserPane:agentReadActivity", listener);
    },
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
    setAccountScope: (uid: string | null): void =>
      ipcRenderer.send("auth:setAccountScope", { uid }),
    syncAgentCustomToken: (
      customToken: string,
    ): Promise<{ ok: boolean; uid?: string; error?: string }> =>
      ipcRenderer.invoke("auth:syncAgentCustomToken", { customToken }),
    clearAgentCustomToken: (): Promise<{
      ok: boolean;
      error?: string;
    }> => ipcRenderer.invoke("auth:clearAgentCustomToken"),
  },
  // 학습데이터 캡처(ticket IqcXHVbT0rXnHloXpV7n) — 상태 조회와 즉시 재평가만.
  // ★원문 전사(transcript)는 이 브리지를 절대 통과하지 않는다. 캡처·업로드는
  // 전부 main 프로세스 안에서 끝나고, 렌더러는 "켜졌나/적격인가/스풀 몇 건"만
  // 본다. 렌더러로 원문을 흘리면 비식별 텔레 경로와 한 프로세스에 놓이게 된다.
  training: {
    captureStatus: (): Promise<TrainingCaptureStatus> =>
      ipcRenderer.invoke("training:captureStatus"),
    /** 동의 토글 직후 서버 게이트를 다시 읽는다(10분 주기 대기 없이 즉시 반영). */
    refreshCapture: (): Promise<TrainingCaptureStatus> =>
      ipcRenderer.invoke("training:refreshCapture"),
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
    writeAndSubmit: (id: string, data: string, bracketedPaste?: boolean) =>
      ipcRenderer.invoke("pty:writeAndSubmit", { id, data, bracketedPaste }),
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
    /** 지금 동시에 살아 있는 에이전트 수(개수만, 설치 전역). 티켓 pWSnJeQN. */
    concurrency: (): Promise<{ live: number; working: number }> =>
      ipcRenderer.invoke("agent:concurrency"),
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
    /**
     * An agent is (or is no longer) waiting on a human — see
     * electron/agent-input-wait.ts. Edge-triggered: `waiting:false` is the
     * retraction, so the renderer never has to poll or de-dupe a stream.
     */
    onInputWait: (
      callback: (data: {
        agentId: string;
        agentName: string;
        projectId: string;
        taskId: string | null;
        waiting: boolean;
        reason: "confirm" | "prompt" | null;
        since: number | null;
      }) => void,
    ) => {
      ipcRenderer.on("agent:inputWait", (_event, data) => callback(data));
    },
    offInputWait: () => {
      ipcRenderer.removeAllListeners("agent:inputWait");
    },
  },
  worktree: {
    list: () => ipcRenderer.invoke("worktree:list"),
    // Topology-only enumeration (no per-worktree status probes) — the cheap
    // freshness path for board cards / ticket modal (ticket yJgz7s03).
    listLight: () => ipcRenderer.invoke("worktree:listLight"),
    // On-disk vs listed accounting, so the tab can tell "a filter hid these"
    // apart from "these never arrived" (ticket NHCsWfnp).
    coverage: () => ipcRenderer.invoke("worktree:coverage"),
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
        locale: readRendererLocaleForMain(),
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
    /**
     * 오케 상태 변화 구독. **해제 함수를 돌려준다.**
     *
     * ★제네릭 `off(channel)` 은 `removeAllListeners` 라 쓸 수 없다 — 같은 채널에
     * `App.tsx` 의 dev IPC 카운터가 붙어 있어서, 구독을 정리하려다 그 계측을 같이
     * 지운다. 리스너를 이름으로 잡아 자기 것만 떼는 이 형태가 유일하게 안전하다.
     *
     * `reason`/`spawnErrno`/`model` 은 main 이 분류한 값만 온다(PTY 원문 아님 —
     * orchestrator-manager 의 ORCHESTRATOR_HALT_REASONS 주석).
     */
    onStatusChange: (
      callback: (data: {
        status: string;
        reason?: string;
        spawnErrno?: string;
        model?: string;
      }) => void,
    ) => {
      const listener = (_event: unknown, data: unknown) =>
        callback(
          data as {
            status: string;
            reason?: string;
            spawnErrno?: string;
            model?: string;
          },
        );
      ipcRenderer.on("orchestrator:statusChanged", listener);
      return () =>
        ipcRenderer.removeListener("orchestrator:statusChanged", listener);
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
        mode: "off" | "working" | "remote";
        preventSleepWhileWorking: boolean;
        active: boolean;
        refCount: number;
        sources: string[];
      }>,
    setPowerSave: (mode: "off" | "working" | "remote") =>
      ipcRenderer.invoke("settings:setPowerSave", {
        mode,
      }) as Promise<{
        success: boolean;
        error?: string;
        mode?: "off" | "working" | "remote";
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
        preset?: string;
      }>,
    /**
     * 설정 화면이 그릴 프리셋 카탈로그. ★목록의 단일소스는 라우팅이 실제로 읽는
     * `electron/dispatch-scoring.MODEL_PRESETS` 다 — 렌더러가 프리셋 표를 다시
     * 적으면 백엔드가 하네스를 편입해도 화면만 옛 표에 머문다(이 티켓이 고친
     * 실패모드). `models:quickLaneCatalog` 와 같은 규율.
     */
    list: () =>
      ipcRenderer.invoke("modelPreset:list") as Promise<ModelPresetCatalog>,
  },
  models: {
    /**
     * 퀵레인 모델 셀렉터가 그릴 벤더→모델 카탈로그. 목록은 `model-registry`
     * 파생이고 available/missingEnvKeys 는 main 이 `process.env` 로 판정한다.
     * ★키 **이름**과 boolean 만 건너온다(시크릿 값은 절대 안 넘어온다).
     */
    quickLaneCatalog: () => ipcRenderer.invoke("models:quickLaneCatalog"),
    /**
     * 오케 모델 셀렉터 카탈로그 — 목록(`model-selection` 파생) + **벤더 판정**.
     *
     * 퀵레인 카탈로그와 같은 분업이다: 시크릿·잔액을 봐야 답할 수 있는 축만 main 이
     * 얹는다. 런타임 게이트 벤더(오늘 DeepSeek)의 칸에만 `gate` 가 붙고, 네이티브
     * 칸에는 아예 안 붙는다 — 그 칸들 때문에 벤더 API 가 호출되는 일은 없다.
     * ★내려오는 것은 금액·통화·상태·키 **이름**뿐이다(시크릿 값 금지).
     */
    orchestratorCatalog: () => ipcRenderer.invoke("models:orchestratorCatalog"),
    /**
     * 사용량 탭 상단 정보표(단가·개략 SWE-bench·컨텍스트). `model-registry` +
     * 컨텍스트/벤치 참조표의 조인이고, env·시크릿은 지나가지 않는다.
     */
    factSheet: () => ipcRenderer.invoke("models:factSheet"),
    /**
     * ★우리 **자체 실측** SWE-bench(our-measured). 위 factSheet(벤더 공개치)와
     * 채널을 일부러 나눈다 — 소스가 다르고(우리 실행 vs 벤더 발표), 실행환경이
     * 달라 한 표에 놓을 수 없기 때문이다. 한 응답으로 합치면 화면이 둘을 섞지
     * 않을 구조적 이유가 사라진다.
     */
    ourBench: () => ipcRenderer.invoke("models:ourBench"),
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
    load: (input?: { accountUid?: string }) =>
      ipcRenderer.invoke("appState:load", input) as Promise<{
        uid?: string;
        lastProjectId?: string;
        lastRootPath?: string;
        wasOrchestratorRunning?: boolean;
        preventSleepWhileWorking?: boolean;
      }>,
    save: (state: {
      accountUid?: string;
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
    // macOS Xcode CLT 상태 사전 감지 (티켓 nETj7szjEtT5prbYsg1D).
    // 읽기 전용 probe — `xcode-select -p` + `git --version` 만 돌린다.
    xcodeClt: () => ipcRenderer.invoke("system:xcodeClt"),
    // 메인↔렌더러 코드 세대 불일치 (티켓 4HMJGUJBo0tKPU4mgHyr). dev 에서만
    // 의미가 있고, 패키징 빌드에선 메인이 감시자를 안 켜 항상 null 이다.
    // 페이로드는 순수 데이터(MainBuildReport)이며 렌더러가 다시 검증한다
    // (src/lib/staleMainBuild.parseMainBuildReport).
    mainBuildFreshness: () =>
      ipcRenderer.invoke("system:mainBuildFreshness") as Promise<unknown>,
    onMainBuildStale: (callback: (report: unknown) => void) => {
      ipcRenderer.on("system:mainBuildStale", (_event, report) =>
        callback(report),
      );
    },
    offMainBuildStale: () => {
      ipcRenderer.removeAllListeners("system:mainBuildStale");
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
    install: (
      id: string,
      startedBy?: "row_button" | "one_click_install" | "harness_store",
    ) =>
      ipcRenderer.invoke("harness:install", id, startedBy) as Promise<{
        success: boolean;
        error?: string;
        failureClassification?: string;
        postProbeInstalled?: boolean;
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
  // 공개 레지스트리 스토어(marblo-app/marblo). 내장 카탈로그(harness.*)와
  // 분리된 채널 — 설치 검증은 전부 메인 프로세스(registry-installer)에서 한다.
  registry: {
    index: (opts?: { refresh?: boolean }) =>
      ipcRenderer.invoke("registry:index", opts) as Promise<{
        success: boolean;
        commit?: string | null;
        stale?: boolean;
        available?: boolean;
        error?: string;
        items: unknown[];
      }>,
    install: (payload: {
      id: string;
      type: string;
      overwriteLocalChanges?: boolean;
      /** community(미검수) 설치 동의 — 강제는 메인 프로세스 installer 가 한다. */
      acknowledgeUnreviewed?: boolean;
    }) =>
      ipcRenderer.invoke("registry:install", payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    uninstall: (payload: { id: string }) =>
      ipcRenderer.invoke("registry:uninstall", payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
  },
  // 스토어 '로컬 모델'(Ollama) — 공개 레지스트리와 분리된 first-party 축(§4.4).
  // 카탈로그·하드웨어 게이트·pull 실행은 전부 메인 프로세스에서 한다.
  localModels: {
    info: () =>
      ipcRenderer.invoke("localModels:info") as Promise<{
        hardware: {
          totalMemGB: number;
          platform: string;
          unifiedMemory: boolean;
        };
        ollama: {
          installed: boolean;
          version?: string;
          daemonRunning: boolean;
        };
        installedIds: string[];
        cards: unknown[];
      }>,
    pull: (payload: { id: string }) =>
      ipcRenderer.invoke("localModels:pull", payload) as Promise<{
        success: boolean;
        cancelled?: boolean;
        error?: string;
      }>,
    cancelPull: (payload: { id: string }) =>
      ipcRenderer.invoke("localModels:cancelPull", payload) as Promise<{
        success: boolean;
      }>,
    onPullProgress: (
      callback: (ev: {
        id: string;
        phase: "progress" | "done" | "error" | "cancelled";
        percent?: number;
        error?: string;
      }) => void,
    ) => {
      ipcRenderer.on("localModels:pullProgress", (_event, data) =>
        callback(data),
      );
    },
    offPullProgress: () => {
      ipcRenderer.removeAllListeners("localModels:pullProgress");
    },
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
        grok: {
          planType: string | null;
          primaryPercent: number | null;
          primaryResetAt: number | null;
          primaryWindowDurationMins?: number | null;
          secondaryPercent: number | null;
          secondaryResetAt: number | null;
          secondaryWindowDurationMins?: number | null;
        } | null;
      }>,
    // Vendor prepaid balance (Usage tab credits panel). The API key never
    // leaves the main process — only amount, currency and a status code come
    // back, plus env key NAMES when a key is missing. Cached in main with a
    // TTL; `force` is the user pressing refresh (still rate-limited there).
    vendorBalance: (vendor: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke("usage:vendorBalance", {
        vendor,
        force: opts?.force === true,
      }) as Promise<VendorBalanceResult>,
  },
  fs: {
    readTree: (rootPath: string, options?: { showHidden?: boolean }) =>
      ipcRenderer.invoke("fs:readTree", rootPath, options),
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
    isGitRepository: (rootPath: string) =>
      ipcRenderer.invoke("fs:isGitRepository", rootPath),
    // 연결된 own 폴더가 실제 코드 탭을 쓸 수 있는 상태인지 한 번에 검사
    // (티켓 r8vg9pMWCRtdnUzR3KyX, own-but-empty 보강). 빈 폴더·origin
    // 불일치를 가른다.
    checkFolderValidity: (input: {
      folderPath: string;
      expectedRemoteUrl?: string | null;
    }) => ipcRenderer.invoke("fs:checkFolderValidity", input),
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
  // 첫 실행 샘플 프로젝트. 경로 인자가 없는 것이 핵심 — 대상은 main 이
  // `<Documents>/Marblo Sample` 로 고정 산출한다(티켓 yk8ouW2pS6nGzH272rXy).
  sample: {
    ensure: (locale?: "ko" | "en") =>
      ipcRenderer.invoke("sample:ensure", { locale }),
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
  // 팀 멤버 "Clone & 연결" 원클릭 (티켓 r8VggohxLGciDVXV2rf6). ★자동풀 아님 —
  // RepoConnectModal 의 명시적 버튼에서만 호출된다.
  repo: {
    defaultCloneParent: (): Promise<string> =>
      ipcRenderer.invoke("repo:defaultCloneParent"),
    clone: (input: {
      projectId?: string;
      repoUrl: string;
      parentDir?: string | null;
      userId?: string;
    }) => ipcRenderer.invoke("repo:clone", input),
    // ── 브랜치 push (티켓 FYIyUuhJbv2cDVjgkRGf, v2) ─────────────────────────
    // ★응답에 토큰이 실리지 않는다 — `{ok, branch, errorKind, message}` 뿐이다.
    // ★역할 거부는 `errorKind: "denied"` 로 온다. 화면은 그걸 device 재시도로
    //   덮지 말아야 한다(그 폴백 금지가 main 쪽에서 이미 강제된다).
    push: (input: {
      projectId?: string;
      repoPath: string;
      repoUrl: string;
      branch: string;
      userId?: string;
    }) => ipcRenderer.invoke("repo:push", input),
    // 커밋 귀속 (재)설정. ★이메일을 돌려주지 않는다 — login 과 noreply 여부만.
    setCommitIdentity: (input: { repoPath: string; userId?: string }) =>
      ipcRenderer.invoke("repo:setCommitIdentity", input),
  },
  github: {
    deviceStart: (userId: string) =>
      ipcRenderer.invoke("github:deviceStart", { userId }),
    devicePoll: (sessionId: string) =>
      ipcRenderer.invoke("github:devicePoll", sessionId),
    status: (userId: string) => ipcRenderer.invoke("github:status", userId),
    disconnect: (userId: string) =>
      ipcRenderer.invoke("github:disconnect", userId),
    // ── GitHub App 자동상속 (티켓 ddbN2KvxHZ08rakiVfL0) ────────────────────
    // ★위의 device 채널은 그대로다 — App 은 대체가 아니라 추가다(설계 §6 G4).
    // ★어떤 응답에도 토큰이 실리지 않는다. status 는 boolean 3개뿐.
    //   installed && !repoAccessible → 오너가 App 을 제거했거나 저장소를
    //   이전했다는 뜻이고, 화면은 그 때 재설치를 안내하면 된다.
    // ★v2 필드(role/canWrite/canMerge/writeGranted)까지 선언한다. 핸들러는
    //   이미 이 값들을 돌려주고 있었는데 타입이 v1 모양에 멈춰 있어서,
    //   렌더러가 "권한이 read 뿐" 과 "역할이 write 를 못 한다" 를 **구분할
    //   방법이 타입상 없었다**(티켓 kzxsRzC37uVvYftpVZO4).
    // ★두 축을 섞지 말 것: `writeGranted` 는 **설치가 승인한 권한**이고,
    //   `canWrite` 는 **마블로 역할**이다. 화면은 둘을 다르게 안내한다 —
    //   전자는 "오너가 재승인해야 한다", 후자는 "당신 역할로는 못 민다".
    appStatus: (
      projectId: string,
    ): Promise<{
      installed: boolean;
      repoAccessible: boolean;
      configured: boolean;
      role: string | null;
      canWrite: boolean;
      canMerge: boolean;
      writeGranted: boolean;
    }> => ipcRenderer.invoke("github:appStatus", projectId),
    // 오너만 성공한다(서버가 판정). 시스템 브라우저로 설치 화면을 연다.
    appInstall: (projectId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke("github:appInstall", projectId),
  },
  webAutomation: {
    chromeProbe: () => ipcRenderer.invoke("webAutomation:chromeProbe"),
    listSessions: (userId?: string) =>
      ipcRenderer.invoke("webAutomation:sessions:list", { userId }),
    deleteSession: (input: { userId?: string; siteKey: string }) =>
      ipcRenderer.invoke("webAutomation:sessions:delete", input),
    launchStoredSession: (input: {
      userId?: string;
      siteKey: string;
      headless?: boolean;
    }) => ipcRenderer.invoke("webAutomation:sessions:launchStored", input),
    closeSession: (sessionId: string) =>
      ipcRenderer.invoke("webAutomation:sessions:close", { sessionId }),
    leakageGuards: () =>
      ipcRenderer.invoke("webAutomation:sessions:leakageGuards"),
  },
  // Google Drive 읽기 전용 커넥터 (티켓 zqNxS9904aeeBEug1uAD + MCTHALmNAWPpilTFwe8o).
  // ★connect 는 시스템 브라우저를 열어 동의를 받는다(앱 창은 navigate 안 함).
  // ★어떤 응답에도 OAuth 토큰은 실리지 않는다(status 는 이메일·스코프만).
  //
  // ★두 축: connect/status/disconnect 는 **유저**(구글 계정 연결), binding.* 은
  // **프로젝트**("이 프로젝트의 위키 = 이 폴더"). 하나를 바꿔도 다른 하나는 그대로다.
  drive: {
    connect: (userId?: string) =>
      ipcRenderer.invoke("drive:connect", { userId }),
    status: (userId?: string) => ipcRenderer.invoke("drive:status", { userId }),
    disconnect: (userId?: string) =>
      ipcRenderer.invoke("drive:disconnect", { userId }),
    // scope:"project" + projectId 를 주면 그 프로젝트의 바인딩 폴더 범위로만
    // 검색한다(패널의 미리보기). 안 주면 폴더 피커용 전체 조회다.
    search: (input: {
      userId?: string;
      projectId?: string;
      scope?: "user" | "project";
      text?: string;
      nameContains?: string;
      folderId?: string;
      mimeTypes?: string[];
      includeFolders?: boolean;
      includeTrashed?: boolean;
      pageSize?: number;
      pageToken?: string;
    }) => ipcRenderer.invoke("drive:search", input),
    fetch: (input: {
      userId?: string;
      projectId?: string;
      scope?: "user" | "project";
      fileId: string;
    }) => ipcRenderer.invoke("drive:fetch", input),
    binding: {
      get: (projectId: string) =>
        ipcRenderer.invoke("drive:binding:get", { projectId }),
      set: (input: {
        projectId: string;
        folderId: string;
        folderName?: string | null;
      }) => ipcRenderer.invoke("drive:binding:set", input),
      clear: (projectId: string) =>
        ipcRenderer.invoke("drive:binding:clear", { projectId }),
    },
  },
  googleWorkspace: {
    gmailSearch: (input: {
      userId?: string;
      query?: string;
      labelIds?: string[];
      pageSize?: number;
      pageToken?: string;
    }) => ipcRenderer.invoke("gmail:search", input),
    gmailFetch: (input: { userId?: string; messageId: string }) =>
      ipcRenderer.invoke("gmail:fetch", input),
    calendarList: (input: {
      userId?: string;
      timeMin?: string;
      timeMax?: string;
      query?: string;
      maxResults?: number;
      pageToken?: string;
    }) => ipcRenderer.invoke("calendar:list", input),
    contactsSearch: (input: {
      userId?: string;
      query: string;
      pageSize?: number;
      maxResults?: number;
    }) => ipcRenderer.invoke("contacts:search", input),
  },
  notion: {
    connect: (input: {
      userId?: string;
      accessToken: string;
      workspaceName?: string | null;
      workspaceId?: string | null;
      botId?: string | null;
    }) => ipcRenderer.invoke("notion:connect", input),
    status: (userId?: string) =>
      ipcRenderer.invoke("notion:status", { userId }),
    disconnect: (userId?: string) =>
      ipcRenderer.invoke("notion:disconnect", { userId }),
    search: (input: {
      userId?: string;
      projectId?: string;
      scope?: "user" | "project";
      query?: string;
      object?: "page" | "database";
      pageSize?: number;
      startCursor?: string;
    }) => ipcRenderer.invoke("notion:search", input),
    fetch: (input: {
      userId?: string;
      projectId?: string;
      scope?: "user" | "project";
      pageId: string;
    }) => ipcRenderer.invoke("notion:fetch", input),
    binding: {
      get: (projectId: string) =>
        ipcRenderer.invoke("notion:binding:get", { projectId }),
      set: (input: {
        projectId: string;
        objectId: string;
        objectKind: "database" | "page";
        title?: string | null;
      }) => ipcRenderer.invoke("notion:binding:set", input),
      clear: (projectId: string) =>
        ipcRenderer.invoke("notion:binding:clear", { projectId }),
    },
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
    // ★지금 이 봇을 누가 물고 있는가 (티켓 hAzP05kOTxggd8LhZGwT). 토큰/chatId
    // 는 들어 있지 않다 — 기기 이름·갱신 시각·409 연속 횟수뿐이다.
    contention: (projectId: string) =>
      ipcRenderer.invoke("telegramChannel:contention", projectId),
    remove: (projectId: string) =>
      ipcRenderer.invoke("telegramChannel:remove", projectId),
  },
  // 오케스트레이터↔Slack 채널 연결 (Socket Mode inbound + chat.postMessage
  // outbound). telegramChannel 의 미러이되 ★`get` 이 없다 — 시크릿 원문은 렌더러
  // 경계를 넘지 않고, 창구는 status(hasBotToken/hasAppToken 불리언)뿐이다.
  // probe 는 저장한 자격증명이 실제로 동작하는지 사용자가 확인하는 경로.
  slackChannel: {
    list: () => ipcRenderer.invoke("slackChannel:list"),
    set: (input: {
      projectId: string;
      botToken?: string | null;
      appToken?: string | null;
      channelId?: string | null;
      enabled?: boolean;
      inboundCapability?: "read" | "trigger";
    }) => ipcRenderer.invoke("slackChannel:set", input),
    status: (projectId: string) =>
      ipcRenderer.invoke("slackChannel:status", projectId),
    remove: (projectId: string) =>
      ipcRenderer.invoke("slackChannel:remove", projectId),
    probe: (projectId: string) =>
      ipcRenderer.invoke("slackChannel:probe", projectId),
    onHealth: (callback: (report: unknown) => void) => {
      ipcRenderer.on("slack:health", (_event, report) => callback(report));
    },
    offHealth: () => {
      ipcRenderer.removeAllListeners("slack:health");
    },
  },
  /**
   * 비서 트리거 — 발화가 오케에 닿지 못한 사실 (티켓 lcR4OMWCriWIpwbVDwVt).
   *
   * ★경계에서 모양을 검사한다. 메인이 보낸 것이라고 렌더러가 무조건 믿으면, 나중에
   * 채널 계약이 어긋났을 때 화면이 `undefined` 를 읽고 조용히 빈 배너를 그린다 —
   * 이 티켓이 고치려는 "조용히 죽는다" 와 똑같은 모양이다.
   */
  assistantTriggers: {
    deliveryFailures: async (): Promise<
      AssistantTriggerDeliveryFailureWire[]
    > => {
      const raw: unknown = await ipcRenderer.invoke(
        "assistantTriggers:deliveryFailures",
      );
      return Array.isArray(raw) ? raw.filter(isDeliveryFailure) : [];
    },
    onDeliveryFailure: (
      callback: (failure: AssistantTriggerDeliveryFailureWire) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ) => {
        if (isDeliveryFailure(payload)) callback(payload);
      };
      ipcRenderer.on("assistantTriggers:deliveryFailure", listener);
      return () =>
        ipcRenderer.removeListener(
          "assistantTriggers:deliveryFailure",
          listener,
        );
    },
    onDeliveryRecovered: (callback: (projectId: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ) => {
        const projectId = (payload as { projectId?: unknown } | null)
          ?.projectId;
        if (typeof projectId === "string" && projectId) callback(projectId);
      };
      ipcRenderer.on("assistantTriggers:deliveryRecovered", listener);
      return () =>
        ipcRenderer.removeListener(
          "assistantTriggers:deliveryRecovered",
          listener,
        );
    },
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
