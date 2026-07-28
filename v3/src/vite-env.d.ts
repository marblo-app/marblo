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
  readFile: (rootPath: string, filePath: string) => Promise<string>;
  writeFile: (
    rootPath: string,
    filePath: string,
    content: string,
  ) => Promise<void>;
  gitStatus: (rootPath: string) => Promise<Record<string, string>>;
  /**
   * Changed files for one worktree vs. merge-base(baseRef, HEAD) — committed,
   * uncommitted and untracked in a single set. Optional: a renderer running
   * against an older preload (dev HMR) falls back to `gitStatus`.
   */
  gitWorktreeChanges?: (
    rootPath: string,
    baseRef: string,
  ) => Promise<{
    baseSha: string;
    files: Array<{ relPath: string; status: string }>;
  }>;
  gitDiff: (
    filePath: string,
    baseSha?: string,
  ) => Promise<{ original: string; modified: string }>;
  gitRemoteUrl: (rootPath: string) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  /** 디렉터리 존재 확인(읽기 전용). 레거시 경로 마이그레이션 소유권 판정용. */
  pathExists: (targetPath: string) => Promise<boolean>;
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
  readFileBase64: (rootPath: string, filePath: string) => Promise<string>;
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
    /**
     * 명시 모델 핀 `<modelId>[@<effort>]` — 퀵레인 모델 셀렉터가 고른 구체 모델.
     * 생략하면 종전 동작(complexity 티어 정책 / CLI 기본 모델)이 그대로 돈다.
     * 핀의 하네스가 `agent.model` 과 다르면 main 이 버린다(spawn 보호).
     */
    modelPin?: string,
  ) => Promise<{
    id: string;
    ptySessionId: string;
    status: string;
    /** 이 launch 가 CLI 에 실제로 넘긴 구체 모델(`model@effort`). UI 스폰 경로는
     * agent:spawned 훅을 타지 않으므로, 호출자가 이 값을 agent doc 의
     * spawnedModel 로 스탬프해야 목록/보드가 벤더 대신 구체 모델을 보여준다. */
    spawnedModel?: string;
    /** Present (with empty id/ptySessionId) when the spawn was blocked
     * because the CLI is not installed / not logged in. */
    needsAuth?: { model: string; action: string; installed: boolean };
  }>;
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
      /** reconnected=true 일 때 이 relaunch 가 실제로 쓴 구체 모델
       * (`model@effort`). 콜드부트 재접속은 원래 dispatch 의 모델 핀을 갖고
       * 있지 않으므로 값이 달라질 수 있다 — 프론트가 doc 을 재스탬프한다. */
      spawnedModel?: string;
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
  /**
   * Inject a free-form instruction into the project's orchestrator PTY in-process
   * (guard-free, project-resolved). Returns a real ack: `delivered` is true only
   * when the message was actually committed to a running orchestrator; otherwise
   * `reason` explains the miss so the caller can fall through to the durable queue.
   */
  injectMessage: (
    projectId: string,
    message: string,
  ) => Promise<{ delivered: boolean; reason?: string }>;
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
  resolvePrevious: (
    rootPath: string,
    projectId?: string,
  ) => Promise<string | null>;
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
    /** 이번 launch 의 명시 모델(패널 Start). 생략 시 main 이
     * 프로젝트별 저장 모델 → 전역 설정 순으로 결정. */
    model?: string,
  ) => Promise<{
    sessionId: string;
    ptySessionId: string;
    status: string;
    /** Present (with empty sessionId/ptySessionId) when the orchestrator
     * spawn was blocked. `reason` tells the two gates apart: absent/anything
     * else = auth (open the CLI setup wizard), "mcp-unavailable" = the CLI is
     * signed in but Marblo MCP does not attach (#639 grok folder trust).
     * Classify with `lib/orchestratorLaunchBlock.classifyOrchestratorBlock`. */
    needsAuth?: {
      model: string;
      action: string;
      installed: boolean;
      reason?: string;
    };
  }>;
  switch: (args: {
    projectId: string;
    rootPath: string;
    targetModel: string;
    mode: "wait" | "takeover";
    resume: "fresh" | "previous";
  }) => Promise<{
    sessionId: string;
    ptySessionId: string;
    status: string;
    handoffSummary: {
      activeMissionCount: number;
      inFlightTaskCount: number;
      unresolvedDecisionCount: number;
    };
    /** launch 와 같은 봉투·같은 분류 규칙(위 주석 참조). */
    needsAuth?: {
      model: string;
      action: string;
      installed: boolean;
      reason?: string;
    };
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
  resolvePrevious: (
    rootPath: string,
    projectId?: string,
  ) => Promise<string | null>;
  onStatusChange: (callback: (data: { status: string }) => void) => void;
  onAgentSpawned: (
    callback: (data: {
      agentId: string;
      name: string;
      ptySessionId: string;
      model: string;
      role: string;
      /** 실제로 뜬 구체 모델(`model@effort`, 예: "claude-fable-5",
       * "gpt-5.6-sol@high"). 벤더(model)와 별개 축이며, 모델을 핀하지 않은
       * 스폰이면 없다 — 표시는 벤더로 graceful fallback. */
      spawnedModel?: string;
    }) => void,
  ) => void;
}

type FlowEvent =
  | { type: "flow:started"; runId: string; state: unknown }
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
  // env-swap 벤더(GLM/MiniMax…) 크레덴셜. BYOK(위 3종)와 다른 축이다 — 이쪽은
  // 우리가 스폰하는 claude 바이너리를 벤더 엔드포인트로 붙이는 구독키다.
  // ★반환값에 평문은 없다. preview 는 마스킹 문자열.
  getVendorSecrets: () => Promise<VendorSecretsSnapshot>;
  setVendorSecret: (
    envKey: string,
    value: string,
  ) => Promise<{ success: boolean; snapshot: VendorSecretsSnapshot }>;
  deleteVendorSecret: (
    envKey: string,
  ) => Promise<{ success: boolean; snapshot: VendorSecretsSnapshot }>;
}

/** 값 없는 벤더 크레덴셜 스냅샷(electron/vendor-secrets.ts 와 같은 모양). */
interface VendorSecretsSnapshot {
  /** OS 키체인 암호화를 쓸 수 있는가. false 면 저장 시도가 에러로 끝난다. */
  encryptionAvailable: boolean;
  vendors: VendorSecretVendorStatus[];
}

interface VendorSecretVendorStatus {
  /** VendorId ("zai" | "minimax" | …). */
  vendor: string;
  /** 이 벤더를 켜는 데 필요한 env 키 이름들 — 전부 있어야 켜진다. */
  envKeys: string[];
  /** 이 프로파일을 쓰는 활성 모델 id 들. */
  modelIds: string[];
  /** all-or-nothing 판정: 하나라도 비면 스폰 시 프로파일을 얹지 않는다. */
  ready: boolean;
  keys: VendorSecretKeyStatus[];
}

interface VendorSecretKeyStatus {
  envKey: string;
  /** 실제로 이기는 소스. "none" 이면 미설정. */
  source: "env" | "store" | "none";
  storedInApp: boolean;
  presentInProcessEnv: boolean;
  /** `abcd***wxyz`. 값이 없으면 빈 문자열. */
  preview: string;
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

/**
 * 퀵레인 모델 셀렉터가 그릴 한 칸(구체 모델). 형태는
 * `electron/model-selection.QuickLaneModelOption` 과 같고, 값은 전부
 * `electron/model-registry` 파생이다 — 렌더러엔 모델 id 리터럴이 없다.
 */
interface QuickLaneModelOption {
  modelId: string;
  /**
   * 이 모델로 해석되는 CLI alias 들. 셀렉터는 안 그리고, 사용량 탭이 과거 로그·
   * 스폰 argv 에 남은 alias(`grok`·`opus`…)를 벤더로 해석하는 데 쓴다.
   */
  aliases: string[];
  label: string;
  capability: "cheap" | "mid" | "top" | "frontier";
  /** 고를 수 있는 effort(낮음→높음). 빈 배열이면 effort 드롭다운을 그리지 않는다. */
  efforts: Array<"low" | "medium" | "high" | "xhigh">;
  /** CLI 기본 effort(있을 때). "기본" 칸이 무엇을 뜻하는지 보여주는 힌트. */
  defaultEffort?: string;
  estimatedPricing: boolean;
}

/** 벤더 그룹(= 셀렉터 1단계). env-swap 벤더는 키가 없으면 available=false. */
interface QuickLaneVendorGroup {
  vendor: string;
  label: string;
  /** 스폰할 바이너리 — 에이전트 doc 의 `model` 필드가 된다. */
  harness: string;
  /** 에이전트 doc 의 `command` 필드. */
  command: string;
  /** 이 벤더에 붙는 데 필요한 env 키 **이름**(값 아님). */
  requiredEnvKeys: string[];
  /** 그중 이 머신에 없는 것들. 비어 있으면 available. */
  missingEnvKeys: string[];
  available: boolean;
  models: QuickLaneModelOption[];
}

/**
 * 사용량 탭 정보표의 벤치 칸. 형태는 `electron/model-fact-sheet.ModelFactBench`
 * 와 같다. ★`score: null` 은 "0점" 이 아니라 **공식 수치가 없다** 는 뜻이고,
 * `note` 가 왜 비었는지를 들고 있다.
 */
interface ModelFactBench {
  benchmark: string;
  score: number | null;
  /** 점수를 낸 스캐폴드(`name@version`). 이게 다르면 다른 실험이다. */
  harness: string;
  source: string;
  sourceKind: "model-vendor" | "benchmark-owner" | "rival-vendor";
  asOf: string;
  note?: string;
}

/** 정보표의 컨텍스트 칸. `tokens: null` = 공식 수치 미확인. */
interface ModelFactContext {
  tokens: number | null;
  maxOutputTokens?: number;
  source: string;
  asOf: string;
  note?: string;
}

/** SWE-bench 의 **변형**(=문제집합). 이게 다른 두 점수는 직접 비교 대상이 아니다. */
type BenchmarkVariantId =
  | "swe-bench-verified"
  | "swe-bench-pro"
  | "swe-bench-multilingual"
  | "swe-bench-multimodal";

/**
 * 한 **변형**에 대한 이 모델의 벤치 칸. `primary: null` = 이 변형에 이 모델의
 * 행이 아예 없다(= 안 찾아봤다). `primary.score: null` = 찾아봤는데 공식 수치가
 * 없다. 화면은 둘 다 "확인 필요" 로 그리되 툴팁이 다르다.
 */
interface ModelFactBenchCell {
  benchmark: BenchmarkVariantId;
  /** 출처가 화면에 적은 변형 이름(표준 표기와 다를 수 있다). */
  variantLabel: string;
  primary: ModelFactBench | null;
  /** **같은 변형**의 다른 측정(하네스가 다르거나 발표가 다르다). */
  alternates: ModelFactBench[];
}

/** 표/차트가 고를 수 있는 변형 하나. 커버리지가 붙어 있어 기본값을 파생할 수 있다. */
interface ModelFactVariant {
  benchmark: BenchmarkVariantId;
  label: string;
  short: string;
  blurb: string;
  scoredModels: number;
  totalModels: number;
}

/**
 * 정보표 한 줄 = 레지스트리 한 행. 단가는 `model-registry.pricing` 단일소스
 * 파생이라 레지스트리에 모델이 늘면 이 표도 자동으로 는다.
 */
interface ModelFactRow {
  modelId: string;
  label: string;
  vendor: string;
  vendorLabel: string;
  harness: string;
  capability: "cheap" | "mid" | "top" | "frontier";
  inputPer1M: number;
  outputPer1M: number;
  estimatedPricing: boolean;
  context: ModelFactContext | null;
  /**
   * ★**변형별** 벤치 칸. 표는 한 번에 한 변형만 그린다 — 다른 변형으로 넘어가는
   * fallback 은 없다(그 fallback 이 Verified 96 과 Pro 64.6 을 한 열에 세웠다).
   */
  benchByVariant: Record<BenchmarkVariantId, ModelFactBenchCell>;
}

/** `models:factSheet` 응답. 행 + 고를 수 있는 변형 목록. */
interface ModelFactSheetPayload {
  rows: ModelFactRow[];
  /** 커버리지 내림차순. [0] 이 기본 축이고, 그 판정은 데이터에서 파생된다. */
  variants: ModelFactVariant[];
  defaultBenchmark: BenchmarkVariantId;
}

interface ModelsAPI {
  quickLaneCatalog: () => Promise<QuickLaneVendorGroup[]>;
  factSheet: () => Promise<ModelFactSheetPayload>;
}

interface OrchestratorModelAPI {
  /** projectId 를 주면 그 프로젝트의 재시작 연속성 모델 우선. */
  get: (projectId?: string) => Promise<string>;
  set: (model: string, projectId?: string) => Promise<{ success: boolean }>;
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

interface SentryBridgeAPI {
  /** Initialize the main-process Sentry SDK (native crashes + IPC transport).
   * Driven by the renderer only after opt-in + DSN present. Idempotent; the
   * main side no-ops without a DSN. Resolves { ok } — false means not
   * initialized (missing DSN or SDK load failure). */
  initMain: (opts: {
    dsn?: string;
    release?: string;
    environment?: string;
  }) => Promise<{ ok: boolean }>;
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

/** Topology-only group from `worktree:listLight` — no status/staleInfo. */
interface WorktreeLightGroup {
  projectId: string;
  repoRoot: string;
  baseRef: string;
  worktrees: { path: string; branch: string; head: string }[];
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
  /** Enumeration without per-worktree git probes (~0.17s vs ~20s at 681). */
  listLight?: () => Promise<WorktreeLightGroup[]>;
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
    projectId?: string,
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
  cliAuthCheck: (
    model: "claude" | "codex" | "grok" | "antigravity",
  ) => Promise<CliAuthResult>;
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
  syncAgentCustomToken: (
    customToken: string,
  ) => Promise<{ ok: boolean; uid?: string; error?: string }>;
  clearAgentCustomToken: () => Promise<{ ok: boolean; error?: string }>;
}

/** Account-global rate-limit reading for one provider. null fields = no
 * information (logged out / probe failed), never zero usage. */
interface RateLimitSnapshot {
  planType: string | null;
  primaryPercent: number | null;
  primaryResetAt: number | null;
  primaryWindowDurationMins?: number | null;
  secondaryPercent: number | null;
  secondaryResetAt: number | null;
  secondaryWindowDurationMins?: number | null;
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
  /**
   * 이 기기의 안정적 식별자(app-state.json 의 machineId). 프로젝트 폴더 경로를
   * 기기별로 저장하기 위해 렌더러에 노출한다 — 티켓 sHyHC9RoutYHDt97UOEm.
   */
  getMachineId: () => Promise<string>;
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
  models: ModelsAPI;
  orchestratorModel: OrchestratorModelAPI;
  subscriptionPlans: SubscriptionPlansAPI;
  clipboard: ClipboardAPI;
  bridge: BridgeAPI;
  appState: AppStateAPI;
  system: SystemAPI;
  connection: ConnectionAPI;
  updater: UpdaterAPI;
  sentry: SentryBridgeAPI;
  kg: KgBridgeAPI;
}

/**
 * Routing knowledge-graph feedback bridge. The renderer forwards each merge it
 * observes in merge_history (its own app merge OR a gh/GitHub merge captured
 * server-side, #566) to the main process, which folds it into the machine-local
 * routing graph. Renderer is the authenticated project member allowed to read
 * member-scoped merge_history (cf #406/L2); main runs anonymous and can't.
 */
interface KgBridgeAPI {
  recordMergeOutcome: (payload: {
    taskId: string;
    changeType: string | null;
    mergedAtMs: number | null;
    role?: string | null;
    taskType?: string | null;
    complexity?: string | null;
    model?: string | null;
    /** ★P2-2 실스폰 관측 model@effort 키 — 그래프 셀의 모델 축. */
    spawnedModelKey?: string | null;
  }) => void;
}

interface Window {
  electronAPI: ElectronAPI;
}

declare module "@sentry/electron/renderer" {
  export function init(opts: Record<string, unknown>): void;
  export function captureException(err: unknown): void;
  export function captureMessage(msg: string): void;
}
