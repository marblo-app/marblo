import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AgentManager,
  type AgentInstance,
  type AgentStatus,
  type ModelType,
} from "./agent-manager";
import { PtyManager } from "./pty-manager";
import { OrchestratorManager } from "./orchestrator-manager";
import { BrowserWindow } from "electron";
import {
  scoreAgents as scoreAgentsFn,
  scoreModels as scoreModelsFn,
  resolvePreset,
  normalizeModel,
  isWorktreeIsolated,
  checkPlanConcurrency,
  isAgentContextReusable,
  type AgentInfo,
} from "./dispatch-scoring";
import { mainTelemetry } from "./telemetry";
import { resolveTopClaudeModelDetailed } from "./agent-config";
import type { WorktreeCoordinator } from "./worktree-coordinator";

/**
 * Append a completion-protocol footer to a dispatched instruction so the
 * worker knows which MCP calls close the loop back to the orchestrator.
 *
 * Background: when an agent calls `submit_for_review` or `update_task_status`
 * via the marblo MCP, mcp-server/tools.ts auto-posts to /notify-orchestrator
 * — that's the only mechanism that injects a completion message into the
 * orchestrator's PTY. If the agent finishes the work but never calls those
 * tools, the orchestrator stays blind to completion. The dispatch instruction
 * sent by the orchestrator usually doesn't include the task_id either, so the
 * worker wouldn't know what to pass even if it remembered the workflow.
 *
 * No-op when taskId is missing (one-off dispatches can't be reported through
 * these tools). The footer is appended, not prepended — keeps the user-facing
 * instruction at the top of the buffer.
 */
export function withCompletionFooter(
  instruction: string,
  taskId?: string,
): string {
  if (!taskId) return instruction;
  const footer = [
    "",
    "",
    `[완료 규약 — task_id="${taskId}"]`,
    "이 작업을 마치면 반드시 아래 marblo MCP 도구를 호출해야 오케스트레이터에게 자동 보고된다 (텍스트 답변만으론 오케스트레이터가 결과를 못 본다):",
    `- 진행 로그: add_activity(task_id="${taskId}", message="...") — 일반 progress 는 타임라인에만 기록된다.`,
    `- 진행 상황은 ticket 본문(description)이 아니라 add_activity 로만 보고 — 본문은 생성 시점의 불변 스펙이다.`,
    `- 정상 완료 / 리뷰 가능: submit_for_review(task_id="${taskId}", pr_url?)`,
    `- 실패 / 반려: update_task_status(task_id="${taskId}", status="FAILED", comment="이유")`,
    "완료/실패/차단 같은 중요 이벤트만 오케스트레이터 PTY 로 자동 주입된다.",
  ].join("\n");
  return instruction + footer;
}

/**
 * Build the instruction for a Resolve(agent) spawned in a conflicted worktree
 * (WORKTREE-SPEC §6). The agent is already cwd'd into the worktree; it rebases
 * onto base, resolves conflicts, continues the rebase, and commits. Kept
 * deterministic and explicit so the worker doesn't guess the git flow.
 */
export function buildResolverPrompt(req: {
  baseRef: string;
  branch: string;
  conflicts?: string[];
}): string {
  const files =
    req.conflicts && req.conflicts.length > 0
      ? `\n충돌 파일(예상): ${req.conflicts.join(", ")}`
      : "";
  return [
    `[머지 충돌 해결 — 워크트리 브랜치 ${req.branch}]`,
    `이 워크트리는 base \`${req.baseRef}\` 위로 rebase 시 충돌이 난다.${files}`,
    "",
    "다음 절차로 해결할 것:",
    `1. \`git rebase ${req.baseRef}\` 실행`,
    "2. 충돌 파일을 양쪽 의도를 보존하며 수정",
    "3. `git add <해결된 파일>` 후 `git rebase --continue` (남은 충돌 반복)",
    "4. rebase 완료 후 `git status`로 클린 상태 확인",
    "5. 해결 불가하면 `git rebase --abort` 후 사유를 보고",
  ].join("\n");
}

export interface SpawnAgentRequest {
  name: string;
  model: "claude" | "gemini" | "gpt" | "antigravity" | "local" | "custom";
  role: string;
  command?: string;
  cwd?: string;
  initialPrompt?: string;
  /** Optional task ID used to append the completion-reporting footer for
   * direct spawn_agent calls. dispatch_task already appends this footer. */
  taskId?: string;
  /** MCP context to inject into the spawned agent, e.g. board or lane:<id>. */
  contextId?: string;
  /** Project ID — required in multi-window mode to scope the agent's view
   * to the correct window. MCP server forwards MARBLO_PROJECT here. */
  projectId?: string;
  /** Parent agent ID (the caller). MCP server forwards MARBLO_AGENT_ID
   * here so the spawn hook can fall back to the parent's project / owner
   * when projectId is missing or empty. Critical for resolving owner
   * window when external Claude Code invokes Marblo MCP without an
   * explicit project context. */
  parentAgentId?: string;
  /** System-initiated spawn flag (M2 cap whitelist). When true, this spawn is
   * exempt from the per-plan concurrency cap — set ONLY by system paths that
   * must proceed regardless of plan (merge-conflict resolver, mission
   * recovery). User-/worker-initiated spawns must leave this unset. */
  system?: boolean;
  /** 작업 난이도 — claude(--model sonnet/opus)·codex(reasoning low/med/high) 모델/
   * 레벨 선택용. dispatch_task 가 전달. 미지정이면 기본 모델 유지. */
  complexity?: "simple" | "standard" | "complex";
}

interface SpawnAgentResponse {
  success: boolean;
  agentId?: string;
  ptySessionId?: string;
  error?: string;
  /** Board task the agent was bound to — the caller's taskId, or an ad-hoc
   * task auto-created by WorktreeCoordinator when none was supplied (null when
   * there is no project context / non-git fallback). The MCP layer reads this
   * to set the agent doc's currentTaskId. */
  taskId?: string | null;
}

interface NotifyOrchestratorRequest {
  message: string;
  /** Project ID — required in multi-window mode to route to the right
   * orchestrator. MCP server forwards MARBLO_PROJECT env var here. */
  projectId?: string;
  /** Task context (Quick Lanes 눈/브레인 분리) — routed by resolveNotifyTarget:
   *   "board"/empty        → board orchestrator
   *   "lane"/"lane:<id>"   → board orchestrator (Quick Lane review gate; lane
   *                          PROGRESS notifies are dropped upstream in
   *                          mcp-server/tools.ts, so only submit_for_review
   *                          reaches here)
   *   <missionId> (other)  → that project's MISSION orchestrator — never the
   *                          board one, so mission progress can't flood the
   *                          board orch PTY.
   * MCP server forwards the task's contextId here. */
  contextId?: string;
}

/**
 * 3-way context → orchestrator routing target for /notify-orchestrator.
 * Mirrors src/lib/laneContext.ts (the renderer's single source of truth);
 * duplicated because electron/tsconfig (rootDir-isolated, excludes mcp-server
 * + src) can't import across into src/. Keep in sync.
 *
 *   board  : "board" | "" | undefined        → "board"
 *   lane   : "lane" | "lane:<laneId>"          → "board"  (review gate)
 *   mission: 그 외(= missionId raw, 접두사 없음) → "mission"
 *
 * Lanes deliberately resolve to the BOARD orchestrator: a Quick Lane's only
 * orch wake is its submit_for_review (the board orch is the verification gate).
 * Lane progress (update_status/add_activity) never reaches this endpoint — it's
 * gated out at the mcp-server notify call sites — so routing lane → board here
 * only ever carries the review submission, not progress churn.
 */
export function resolveNotifyTarget(
  contextId: string | undefined,
): "board" | "mission" {
  const ctx = contextId ?? "";
  const isLaneContext = ctx === "lane" || ctx.startsWith("lane:");
  const isMissionContext = ctx !== "" && ctx !== "board" && !isLaneContext;
  return isMissionContext ? "mission" : "board";
}

const IMPORTANT_TASK_UPDATE_STATUSES = new Set(["DONE", "FAILED", "BLOCKED"]);

function mentionsStuckOrBlocked(message: string): boolean {
  return /\b(stuck|blocked|blocker|blocking)\b/i.test(message) ||
    /막힘|차단|블로커/.test(message);
}

/**
 * Decide whether a bridge notification should wake the orchestrator PTY.
 *
 * Timeline-only progress still reaches Firestore via the MCP tool that emitted
 * it; this gate only suppresses the extra PTY conversation turn. Unknown
 * notification shapes remain injectable so new important events do not get
 * silently dropped until they add an explicit classifier here.
 */
export function shouldInjectOrchestratorNotification(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (mentionsStuckOrBlocked(trimmed)) return true;

  if (trimmed.startsWith("[Task Activity]")) {
    return false;
  }

  if (trimmed.startsWith("[Task Update]")) {
    const match = trimmed.match(/\s→\s([A-Z_]+)\b/);
    return match ? IMPORTANT_TASK_UPDATE_STATUSES.has(match[1]) : true;
  }

  if (trimmed.startsWith("[Review Submitted]")) return true;
  if (trimmed.startsWith("[Dependency Resolved]")) return true;

  return true;
}

// ── Dispatch types ──────────────────────────────────────────

const TRACKED_MODEL_FALLBACKS: ModelType[] = ["claude", "gpt"];
const TRACKED_MODEL_TAGS = new Set([
  "require-tracked-model",
  "require-tracked-models",
  "tracked-model",
  "tracked-model-required",
  "progress-tracking",
  "progress-tracking-required",
  "activity-tracking",
  "activity-tracking-required",
  "needs-progress",
  "needs-tracking",
]);

function normalizeDispatchTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function isTrackedDispatchModel(model: ModelType): boolean {
  return model !== "antigravity";
}

function dispatchRequiresTrackedModel(params: {
  requireTrackedModel?: boolean;
  tags?: string[];
}): boolean {
  if (params.requireTrackedModel) return true;
  return (params.tags ?? []).some((tag) =>
    TRACKED_MODEL_TAGS.has(normalizeDispatchTag(tag)),
  );
}

function trackedModelCandidates(models: ModelType[]): ModelType[] {
  const filtered = models.filter(isTrackedDispatchModel);
  return filtered.length > 0 ? filtered : TRACKED_MODEL_FALLBACKS;
}

export interface DispatchTaskRequest {
  role: string;
  instruction: string;
  taskId?: string;
  /** Caller MCP context. Used to keep board dispatches from reusing lane agents. */
  contextId?: string;
  complexity?: "simple" | "standard" | "complex";
  model?: ModelType;
  enabledModels?: ModelType[];
  nameHint?: string;
  cwd?: string;
  tags?: string[];
  /** Project ID — required in multi-window mode. Filters reusable agents
   * to only those owned by this project. MCP forwards MARBLO_PROJECT. */
  projectId?: string;
  /** Parent agent ID — fallback for owner resolution when projectId is
   * missing. MCP forwards MARBLO_AGENT_ID. */
  parentAgentId?: string;
  /** System-initiated dispatch flag (M2 cap whitelist) — see SpawnAgentRequest.
   * Exempts this dispatch's restart/spawn from the per-plan concurrency cap. */
  system?: boolean;
  /** When true, never assign this dispatch to a model whose progress/activity
   * MCP telemetry is not reliable. Tags such as `require_tracked_model` and
   * `progress-tracking` enable the same guard for MCP callers whose schema has
   * not yet grown this explicit flag. */
  requireTrackedModel?: boolean;
  /** simple 물리스폰 opt-in(§B). 기본 false 면 complexity==="simple" 은 종전대로
   * action="logical"(내부 서브에이전트)로 단락된다. true 면 logical 단락을 건너뛰고
   * cheap 모델(claude=resolveSimpleClaudeModel/기본 sonnet, gpt=low)로 격리 worktree
   * 물리 에이전트를 스폰한다 — 격리·병렬이 필요한 저난도 작업용. simple 이 아니면 무시. */
  isolate?: boolean;
  /** 모델 믹스(SPAWN-MODEL-ALLOCATION-V2 §4) — complex 전용 opt-in. 발동 시 Claude
   * 최상위 + Codex high 2-spawn. "cross-check"=교차검증(기본), "split-role"=역할분담.
   * complexity!=="complex" 면 무시(+경고). 미지정이면 단일 디스패치(무변동). */
  mix?: "cross-check" | "split-role";
  /** 단계분할(§5) — complex 전용 opt-in. 스텝 배열을 각각 작은 dispatch 로 풀어
   * 난도별 모델을 매칭한다. dependsOnPrevious 인 스텝은 직전 스텝 후 디스패치(순차),
   * 아니면 병렬. complexity!=="complex" 면 무시(+경고). */
  stages?: Array<{
    instruction: string;
    complexity?: "simple" | "standard" | "complex";
    /** 스텝별 프로바이더 힌트(claude/codex/gpt/...). normalizeModel 로 접힘. */
    model?: string;
    tags?: string[];
    /** true 면 직전 스텝 완료 후 디스패치(순차 게이트). */
    dependsOnPrevious?: boolean;
  }>;
}

export type DispatchAction =
  | "logical"
  | "reused"
  | "restarted"
  | "spawned"
  | "mixed"
  | "staged";

export interface DispatchTaskResponse {
  success: boolean;
  action?: DispatchAction;
  agentId?: string;
  agentName?: string;
  /** Actual registered role of the selected agent. May differ from task role
   * when routing to an already-bound or manually reused agent. */
  agentRole?: string;
  model?: string;
  score?: number;
  reason?: string;
  error?: string;
  /** Board task bound to the (possibly newly spawned) agent — used by the
   * MCP layer to set the agent doc's currentTaskId. */
  taskId?: string | null;
  /** 모델 믹스(§4) 발동 시 동반 spawn 된 Codex 에이전트 id(있을 때만). */
  companionAgentId?: string;
  /** 단계분할(§5) 디스패치된 각 스텝 에이전트 id. */
  stageAgentIds?: string[];
}

/**
 * HTTP Bridge Server — localhost-only server that receives requests from
 * MCP tools (running inside Claude Code) and forwards them to Electron's
 * AgentManager. This bridges the gap between the MCP subprocess and the
 * Electron main process.
 *
 * Endpoints:
 *   GET  /agents               — real-time agent list from AgentManager
 *   POST /spawn-agent          — launch a new agent
 *   POST /reuse-agent          — send instruction to existing agent
 *   POST /dispatch-task        — smart dispatch: reuse/restart/spawn/logical
 *   POST /kill-agent           — stop and remove an agent
 *   POST /notify-orchestrator  — send a message to the orchestrator PTY
 *   GET  /health               — health check
 */
export class BridgeServer {
  private server: http.Server | null = null;
  private port = 0;
  private agentManager: AgentManager;
  private ptyManager: PtyManager;
  // Lookup function: returns the OrchestratorManager for a given projectId
  // (null if no orchestrator running for that project). Replaces the old
  // single-instance setter to support per-project orchestrators in
  // multi-window mode.
  private orchestratorLookup: (
    projectId: string,
  ) => OrchestratorManager | null = () => null;
  // Mission orchestrator lookup — parallel to orchestratorLookup but for the
  // per-project MISSION orchestrator (board 와 분리된 풀). Used by
  // /notify-orchestrator to route mission-context task notifications to the
  // mission orchestrator instead of the board one. Null until main wires it.
  private missionOrchestratorLookup: (
    projectId: string,
  ) => OrchestratorManager | null = () => null;
  // Per-project enabledModels lookup — main wires this so dispatchTask
  // doesn't read process.env (which races across windows).
  private enabledModelsLookup: (projectId: string) => string[] | undefined =
    () => undefined;
  private mainWindow: BrowserWindow | null = null;
  private allWindows: Set<BrowserWindow> | null = null;
  private ptyBuffers: Map<string, string[]>;
  // Hook injected by main: when bridge spawns an agent, main wires up PTY
  // forwarding (with proper window-owner routing) and broadcasts spawn
  // notification scoped to the agent's project. This avoids bridge having
  // its own PTY routing that bypasses multi-window scoping.
  private agentSpawnedHook:
    | ((info: {
        sid: string;
        projectId: string | undefined;
        agentId: string;
        parentAgentId?: string;
        // Pass spawn metadata explicitly — at the moment onPtyReady fires,
        // agentManager.agents.set hasn't run yet, so a downstream
        // agentManager.getAgent(id) lookup returns undefined and we lose
        // model/name/role info. Always carry them through the hook.
        name: string;
        model: string;
        role: string;
      }) => void)
    | null = null;

  // Runs just before every spawn to guarantee a board task + isolated git
  // worktree for the agent (WORKTREE-SPEC). Never throws — falls back to a
  // plain cwd for non-git / no-project spawns, preserving legacy behavior.
  private worktreeCoordinator: WorktreeCoordinator;

  // M2 — per-plan concurrency cap source. Returns the requesting user's plan
  // ("free" | "pro" | "team" | ...), or undefined when unknown. main wires
  // this (setPlanLookup) so the backend dispatch/spawn paths enforce the SAME
  // cap the renderer does (src/lib/planLimits.ts) instead of being bypassed by
  // MCP spawn_agent / HTTP dispatch. Default reads MARBLO_PLAN so an env-only
  // deploy still works; unknown → unlimited (never false-blocks a spawn).
  private planLookup: (projectId?: string) => string | undefined = () =>
    process.env.MARBLO_PLAN;

  // L3 — per-taskId dispatch serialization. Concurrent dispatches for the same
  // taskId must not each spawn their own agent (the WorktreeCoordinator only
  // dedups worktree DIRECTORIES, and two dispatches can both decide "no
  // reusable agent → spawn"). Chaining each task's dispatches makes the
  // reuse/restart/spawn decision atomic per task. Keyed by taskId; entry is
  // GC'd when its chain drains.
  private taskDispatchLocks = new Map<string, Promise<unknown>>();

  constructor(
    agentManager: AgentManager,
    ptyManager: PtyManager,
    ptyBuffers: Map<string, string[]>,
    worktreeCoordinator: WorktreeCoordinator,
  ) {
    this.agentManager = agentManager;
    this.ptyManager = ptyManager;
    this.ptyBuffers = ptyBuffers;
    this.worktreeCoordinator = worktreeCoordinator;
  }

  setOrchestratorLookup(
    lookup: (projectId: string) => OrchestratorManager | null,
  ): void {
    this.orchestratorLookup = lookup;
  }

  setMissionOrchestratorLookup(
    lookup: (projectId: string) => OrchestratorManager | null,
  ): void {
    this.missionOrchestratorLookup = lookup;
  }

  setAgentSpawnedHook(
    hook: (info: {
      sid: string;
      projectId: string | undefined;
      agentId: string;
      parentAgentId?: string;
      name: string;
      model: string;
      role: string;
    }) => void,
  ): void {
    this.agentSpawnedHook = hook;
  }

  setEnabledModelsLookup(
    lookup: (projectId: string) => string[] | undefined,
  ): void {
    this.enabledModelsLookup = lookup;
  }

  /** M2 — wire the per-plan concurrency cap source. main should call this with
   * a per-project plan lookup (the renderer pushes the active subscription
   * plan). Until wired, the cap falls back to the MARBLO_PLAN env var. */
  setPlanLookup(lookup: (projectId?: string) => string | undefined): void {
    this.planLookup = lookup;
  }

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  setAllWindows(windows: Set<BrowserWindow>): void {
    this.allWindows = windows;
  }

  /** Broadcast to all open windows */
  private broadcast(channel: string, ...args: unknown[]): void {
    if (this.allWindows) {
      for (const win of this.allWindows) {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, ...args);
        }
      }
    } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // CORS headers for local access
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", port: this.port }));
          return;
        }

        if (req.method === "GET" && req.url?.startsWith("/agents")) {
          // Optional ?projectId= query param scopes the list to a single
          // project (multi-window). Without it, returns all agents
          // (legacy behavior — used by the renderer's debug panel).
          const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
          const projectId = url.searchParams.get("projectId") ?? undefined;
          this.handleGetAgents(res, projectId);
          return;
        }

        if (req.method === "POST" && req.url === "/spawn-agent") {
          this.handleSpawnAgent(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/notify-orchestrator") {
          this.handleNotifyOrchestrator(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/reuse-agent") {
          this.handleReuseAgent(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/dispatch-task") {
          this.handleDispatchTask(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/kill-agent") {
          this.handleKillAgent(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/set-agent-status") {
          this.handleSetAgentStatus(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/reap-worktree") {
          this.handleReapWorktree(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/inject-message") {
          this.handleInjectMessage(req, res);
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });

      // Listen on port 0 → OS assigns random available port
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr !== "string") {
          this.port = addr.port;
        }
        // Set bridge port in process.env so ALL spawned agents inherit it
        // via getMCPServerEnv() in agent-config.ts
        process.env.MARBLO_BRIDGE_PORT = String(this.port);
        // Write a port-discovery file so external Claude Code sessions
        // (using the globally-registered Marblo MCP) can find a running
        // Marblo without us hard-coding a port. The MCP server reads
        // this file at startup if MARBLO_BRIDGE_PORT env is not set.
        try {
          const dir = path.join(os.homedir(), ".marblo");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "bridge-port"), String(this.port));
        } catch (err) {
          console.warn(
            "[BridgeServer] Failed to write port-discovery file:",
            err,
          );
        }
        console.log(`[BridgeServer] Listening on 127.0.0.1:${this.port}`);
        resolve(this.port);
      });

      this.server.on("error", reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  // ── GET /agents — real-time agent list ──────────────────────

  private handleGetAgents(res: http.ServerResponse, projectId?: string): void {
    const agents = this.agentManager
      .listAgentsByProject(projectId)
      .map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        role: a.role,
        status: a.status,
        ptySessionId: a.ptySessionId,
        restartCount: a.restartCount,
        contextId: a.launchConfig?.env?.MARBLO_CONTEXT,
        // Exposed so cleanup_agents can reap agents whose connected task is
        // terminal (DONE/FAILED) even while their PTY still reports working —
        // gated on PTY-silence via lastPtyActivity (see agent-reap.ts).
        currentTaskId: a.currentTaskId,
        lastPtyActivity: a.lastPtyActivity,
      }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agents }));
  }

  // ── POST /spawn-agent ───────────────────────────────────────

  private handleSpawnAgent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      let params: SpawnAgentRequest;
      try {
        params = JSON.parse(body) as SpawnAgentRequest;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      try {
        if (!params.name || !params.model || !params.role) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Missing required fields: name, model, role",
            }),
          );
          return;
        }

        const result = await this.spawnNewAgent(params);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const response: SpawnAgentResponse = {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      }
    });
  }

  // ── POST /dispatch-task — smart dispatch ────────────────────

  private handleDispatchTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      let params: DispatchTaskRequest;
      try {
        params = JSON.parse(body) as DispatchTaskRequest;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      try {
        if (!params.role || !params.instruction) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Missing required fields: role, instruction",
            }),
          );
          return;
        }

        const result = await this.dispatchTask(params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    });
  }

  // ── POST /kill-agent ────────────────────────────────────────

  private handleKillAgent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let params: { agentName: string; reason?: string };
      try {
        params = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      try {
        if (!params.agentName) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Missing required field: agentName",
            }),
          );
          return;
        }

        const agent = this.agentManager.getAgentByName(params.agentName);
        if (!agent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: `Agent '${params.agentName}' not found`,
            }),
          );
          return;
        }

        this.agentManager.stop(agent.id);
        this.syncAgentStatus(agent.id, "stopped", null);
        this.agentManager.remove(agent.id);
        // Notify renderer to delete from Firestore too
        this.broadcast("agent:deleted", {
          agentId: agent.id,
          agentName: agent.name,
        });
        console.log(
          `[BridgeServer] Removed agent '${params.agentName}' (reason: ${
            params.reason || "none"
          })`,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            agentId: agent.id,
            reason: `Agent '${params.agentName}' stopped${
              params.reason ? `: ${params.reason}` : ""
            }`,
          }),
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    });
  }

  // ── POST /notify-orchestrator ───────────────────────────────

  private handleNotifyOrchestrator(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let params: NotifyOrchestratorRequest;
      try {
        params = JSON.parse(body) as NotifyOrchestratorRequest;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      try {
        if (!params.message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Missing required field: message",
            }),
          );
          return;
        }

        // 3-way context routing (Quick Lanes 눈/브레인 분리) — see
        // resolveNotifyTarget. mission→mission orch, board+lane→board orch.
        // A mission notification that arrives while no mission orchestrator is
        // running is DROPPED (returning 200) rather than falling back to the
        // board orch, which would reintroduce the pollution this routing exists
        // to prevent. Lane review submissions land on the board orch (the Quick
        // Lane verification gate); lane progress never reaches here (gated out
        // at the mcp-server notify call sites).
        const projectId = params.projectId ?? "";
        const contextId = params.contextId ?? "";
        const target = resolveNotifyTarget(contextId);
        if (!shouldInjectOrchestratorNotification(params.message)) {
          console.log(
            `[BridgeServer] Suppressed timeline-only ${target} orchestrator notification (project=${projectId}, context=${
              contextId || "board"
            }): ${params.message.slice(0, 80)}...`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              injected: false,
              reason: "timeline-only notification suppressed",
            }),
          );
          return;
        }
        const isMissionContext = target === "mission";
        const orch = isMissionContext
          ? this.missionOrchestratorLookup(projectId)
          : this.orchestratorLookup(projectId);
        const session = orch?.getSession();
        if (!session || session.status !== "running") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: isMissionContext
                ? `Mission orchestrator not running for project ${projectId} (context=${contextId}) — notification dropped`
                : projectId
                  ? `Orchestrator not running for project ${projectId}`
                  : "Orchestrator not running (missing projectId)",
            }),
          );
          return;
        }

        // Write the notification message to the orchestrator's PTY stdin.
        // writeAndSubmit splits text and \r so Claude Code registers Enter
        // as a discrete keystroke (single-chunk gets paste-buffered).
        this.ptyManager.writeAndSubmit(session.ptySessionId, params.message);
        console.log(
          `[BridgeServer] Notified ${target} orchestrator (project=${projectId}, context=${
            contextId || "board"
          }): ${params.message.slice(0, 80)}...`,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, injected: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    });
  }

  // ── POST /reuse-agent ───────────────────────────────────────

  private handleReuseAgent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let params: {
        agentName: string;
        instruction: string;
        taskId?: string;
        contextId?: string;
      };
      try {
        params = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      try {
        if (!params.agentName || !params.instruction) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Missing required fields: agentName, instruction",
            }),
          );
          return;
        }

        // Find agent by name
        const agent = this.agentManager.getAgentByName(params.agentName);
        if (!agent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: `Agent '${params.agentName}' not found`,
            }),
          );
          return;
        }

        if (agent.status === "stopped" || agent.status === "error") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: `Agent '${params.agentName}' is not available (status: ${agent.status})`,
            }),
          );
          return;
        }

        const agentContextId = agent.launchConfig?.env?.MARBLO_CONTEXT;
        if (!isAgentContextReusable(agentContextId, params.contextId)) {
          const requestContext = params.contextId || "board";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: `Agent '${params.agentName}' belongs to context '${
                agentContextId || "board"
              }' and cannot be reused from context '${requestContext}'`,
            }),
          );
          return;
        }

        // Write instruction to agent's PTY stdin (split for discrete Enter)
        this.ptyManager.writeAndSubmit(agent.ptySessionId, params.instruction);

        // Rebind the agent to the new task so currentTaskId reverse-map views
        // (LanesTab, ActivityStreamPanel) and the agent doc point at the task it
        // is now actually working — not the stale previous one. Mirrors the
        // dispatch path's syncAgentStatus("working", taskId). Only when a taskId
        // is supplied; otherwise leave currentTaskId untouched (the idle/stopped
        // transition in /set-agent-status already clears it on completion).
        if (params.taskId) {
          this.agentManager.setStatus(agent.id, "working");
          this.syncAgentStatus(agent.id, "working", params.taskId);
        }

        console.log(
          `[BridgeServer] Reused agent '${
            params.agentName
          }': ${params.instruction.slice(0, 80)}...`,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, agentId: agent.id }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    });
  }

  // ── Smart Dispatch Logic ────────────────────────────────────

  // Public so MissionEngine wiring can call this in-process (Step 5 mission feature).
  // HTTP /dispatch-task handler also calls it via this same entrypoint.
  // Async because the spawn path awaits WorktreeCoordinator (git worktree prep)
  // before launching. The mission-engine dispatchOne port is synchronous, so
  // main.ts adapts this with a fire-and-forget shim there.
  //
  // L3 — serialize by taskId so concurrent dispatches for the SAME task can't
  // each spawn a duplicate agent. dispatchTaskInner additionally routes to an
  // agent already bound to the task's worktree instead of spawning. Dispatches
  // without a taskId can't be deduped and run directly.
  async dispatchTask(
    params: DispatchTaskRequest,
  ): Promise<DispatchTaskResponse> {
    if (!params.taskId) return this.dispatchTaskInner(params);
    return this.withTaskLock(params.taskId, () =>
      this.dispatchTaskInner(params),
    );
  }

  /** L3 — run `fn` after any in-flight dispatch for the same taskId settles
   * (success or failure both release, so one failed dispatch can't wedge the
   * task's queue). */
  private withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.taskDispatchLocks.get(taskId) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.taskDispatchLocks.set(taskId, tail);
    void tail.finally(() => {
      // GC the entry once the chain drains (no newer dispatch chained on).
      if (this.taskDispatchLocks.get(taskId) === tail) {
        this.taskDispatchLocks.delete(taskId);
      }
    });
    return result;
  }

  // SPAWN-MODEL-ALLOCATION-V2 §4/§5 — complex 전용 opt-in 분기. mix(모델 믹스)·
  // stages(단계분할)가 켜져 있고 complexity==="complex" 일 때만 새 경로를 타고,
  // 그 외에는 dispatchSingle 로 떨어져 현행과 byte-identical(무회귀).
  private async dispatchTaskInner(
    params: DispatchTaskRequest,
  ): Promise<DispatchTaskResponse> {
    const complexity = params.complexity ?? "standard";
    const isComplex = complexity === "complex";
    // complex 가 아닌데 mix/stages 가 들어오면 조용히 삼키지 않고 무시 + 경고
    // (tools.ts 에서도 1차로 거르지만, 여기서도 방어적으로 가드).
    if (!isComplex && (params.mix || (params.stages?.length ?? 0) > 0)) {
      console.warn(
        `[BridgeServer] mix/stages ignored — complexity='${complexity}' (complex 전용). 단일 디스패치로 진행.`,
      );
    }
    if (isComplex && params.stages && params.stages.length > 0) {
      return this.dispatchStages(params, params.stages);
    }
    if (isComplex && params.mix) {
      return this.dispatchMix(params, params.mix);
    }
    return this.dispatchSingle(params);
  }

  private async dispatchSingle(
    params: DispatchTaskRequest,
  ): Promise<DispatchTaskResponse> {
    const {
      role,
      instruction,
      complexity = "standard",
      tags = [],
      isolate = false,
    } = params;
    // Fold "codex"/"agy" aliases onto canonical ids so an explicit model
    // request matches the right agents during reuse scoring AND spawns the
    // right CLI. undefined (no/unknown hint) falls through to tag scoring.
    const requiresTrackedModel = dispatchRequiresTrackedModel(params);
    const requestedModel = normalizeModel(params.model);
    const model =
      requiresTrackedModel && requestedModel === "antigravity"
        ? undefined
        : requestedModel;

    // Append a completion-protocol footer so the worker knows which MCP
    // calls close the loop back to the orchestrator. Without this, agents
    // finish the work in their PTY but never call submit_for_review /
    // update_task_status — so notifyOrchestrator() (mcp-server/tools.ts)
    // never fires and the orchestrator stays blind to completion. Only
    // append when taskId is provided (one-off dispatches without a task
    // can't be reported via these tools).
    const effectiveInstruction = withCompletionFooter(
      instruction,
      params.taskId,
    );

    // Step 0: Logical agent for simple tasks — unless isolate=true(§B), which
    // opts a simple task into a real isolated worktree spawn on a cheap model
    // (claude=resolveSimpleClaudeModel/sonnet, gpt=low). Default(!isolate) keeps
    // the cheapest path: an internal sub-agent that runs in the orchestrator's
    // own context with no extra process.
    if (complexity === "simple" && !isolate) {
      return {
        success: true,
        action: "logical",
        reason: `Simple task — use internal sub-agent (complexity='simple')`,
        taskId: params.taskId ?? null,
      };
    }

    // Multi-window: only consider agents owned by the requesting project
    // for reuse / restart / spawn-constraint counting.
    const allAgents = this.agentManager
      .listAgentsByProject(params.projectId)
      .filter((agent) =>
        isAgentContextReusable(
          agent.launchConfig?.env?.MARBLO_CONTEXT,
          params.contextId,
        ),
      )
      .filter(
        (agent) =>
          !requiresTrackedModel || isTrackedDispatchModel(agent.model),
      );

    // L3/RG — per-task single-agent guarantee. A task-bound live agent wins
    // before normal idle reuse scoring. The binding can come from the isolated
    // worktree cwd or the in-memory currentTaskId set by dispatch. This closes
    // the observed reassign gap where the original worker was still live but a
    // different just-idle agent scored as reusable for the same task.
    const taskAgent = this.findLiveTaskAgent(
      allAgents,
      params.projectId,
      params.taskId,
    );
    if (taskAgent && params.taskId) {
      return this.routeToTaskAgent(
        taskAgent,
        effectiveInstruction,
        params.taskId,
      );
    }

    // Step 1 & 2: Score existing agents
    const scored = this.scoreAgents(allAgents, role, model, tags);
    // Explicit model request wins over reuse. When the user/orchestrator
    // names a model (normalized: "코덱스"/"codex" → "gpt"), only an agent of
    // that SAME model may be reused/restarted; otherwise we fall through to
    // Step 3 and spawn the requested model fresh. Without this gate an idle
    // Claude (role match alone scores ~180, well over the 100 threshold)
    // hijacks a "코덱스 스폰" request. When no model is specified, reuse is
    // unrestricted (model === undefined → predicate is always true).
    const modelMatches = (m: string) => !model || m === model;
    // Worktree isolation gate: reuse/restart re-use an existing PTY in its
    // CURRENT cwd and never run through WorktreeCoordinator.prepare(). When a
    // dispatch targets an isolated worktree (projectId+taskId) but the candidate
    // is sitting in another tree (the main checkout, or a different task's
    // worktree), reusing it would pollute the wrong tree — so we drop it here
    // and let dispatch fall through to a coordinator-routed fresh spawn that
    // lands in the right worktree. Non-isolated dispatch (no projectId/taskId)
    // keeps unrestricted reuse — no regression. cwd comes from the full
    // AgentInstance (AgentInfo carries no cwd).
    const worktreeOk = (agentId: string) =>
      isWorktreeIsolated(
        this.agentManager.getAgent(agentId)?.cwd,
        params.projectId,
        params.taskId,
      );
    const taskBindingOk = (agentId: string) => {
      const currentTaskId = this.agentManager.getAgent(agentId)?.currentTaskId;
      return !currentTaskId || currentTaskId === params.taskId;
    };
    // Only idle agents are safe to reuse — working agents may be mid-task
    const reusable = scored.filter(
      (s) =>
        s.score >= 100 &&
        s.agent.status === "idle" &&
        modelMatches(s.agent.model) &&
        worktreeOk(s.agent.id) &&
        taskBindingOk(s.agent.id),
    );

    // Step 1: Reuse idle agent.
    // M6 — re-confirm the candidate's LIVE status at claim time. scoreAgents()
    // snapshotted status when it ran; between then and now a concurrent
    // dispatch could have claimed the agent, or its first PTY output byte could
    // have auto-promoted it idle→working (agent-manager). Reusing an agent that
    // is no longer idle injects a 2nd task into a live session. Skip any
    // candidate whose live status isn't still "idle" and try the next; the
    // claim (setStatus → working) is synchronous so a later dispatch in this
    // same tick sees it as working and can't double-claim it.
    for (const candidate of reusable) {
      const fullAgent = this.agentManager.getAgent(candidate.agent.id);
      if (!fullAgent || fullAgent.status !== "idle") continue; // stale → skip
      this.ptyManager.writeAndSubmit(
        fullAgent.ptySessionId,
        effectiveInstruction,
      );
      this.agentManager.setStatus(fullAgent.id, "working");
      this.syncAgentStatus(fullAgent.id, "working", params.taskId);

      console.log(
        `[BridgeServer] Dispatch: reused '${candidate.agent.name}' (score=${candidate.score})`,
      );
      return {
        success: true,
        action: "reused",
        agentId: fullAgent.id,
        agentName: candidate.agent.name,
        agentRole: fullAgent.role,
        model: candidate.agent.model,
        score: candidate.score,
        reason: candidate.reason,
        taskId: params.taskId ?? null,
      };
    }

    // M2 — per-plan concurrency cap. We're past reuse (idle→working adds no
    // slot). The remaining paths BOTH add a net-new active agent — restart
    // re-activates a stopped agent (stopped→working), spawn creates a new one —
    // so gate them here against the requesting user's plan (free=2 / pro=5 /
    // team+ unlimited). Orchestrator / internal / system-flagged dispatches are
    // exempt: capping them would freeze fleet operation. The spawn path is
    // ALSO gated inside spawnNewAgent (so HTTP /spawn-agent is covered); this
    // gate is what additionally stops a restart from exceeding the cap.
    const planCap = checkPlanConcurrency(
      this.planLookup(params.projectId),
      allAgents,
      { role, system: params.system },
    );
    if (!planCap.allowed) {
      console.warn(
        `[BridgeServer] Dispatch blocked by plan cap (role=${role}, active=${planCap.active}/${planCap.limit})`,
      );
      return { success: false, error: planCap.reason };
    }

    // Step 2: Restart stopped agent (same explicit-model + worktree-isolation
    // gates as reuse). restart() relaunches the PTY at the agent's STORED cwd,
    // also bypassing the coordinator — so a stopped agent in the wrong tree
    // must likewise fall through to a fresh, correctly-isolated spawn.
    const restartable = scored.filter(
      (s) =>
        s.score >= 100 &&
        s.agent.status === "stopped" &&
        modelMatches(s.agent.model) &&
        worktreeOk(s.agent.id) &&
        taskBindingOk(s.agent.id),
    );

    if (restartable.length > 0) {
      const best = restartable[0];
      // Pass instruction as initialPrompt so readiness detection handles delivery timing
      const restarted = this.agentManager.restart(
        best.agent.id,
        effectiveInstruction,
      );
      if (restarted) {
        this.agentManager.setStatus(restarted.id, "working");
        this.syncAgentStatus(restarted.id, "working", params.taskId);

        console.log(
          `[BridgeServer] Dispatch: restarted '${best.agent.name}' (score=${best.score})`,
        );
        return {
          success: true,
          action: "restarted",
          agentId: restarted.id,
          agentName: best.agent.name,
          agentRole: restarted.role,
          model: best.agent.model,
          score: best.score,
          reason: best.reason,
          taskId: params.taskId ?? null,
        };
      }
    }

    // Step 3: Spawn new agent
    // NOTE: The old role-count caps (MAX_AGENTS / MAX_PER_ROLE) were removed
    // (2026-06-02) — Marblo runs heterogeneous fleets where a role can have
    // 10+ agents, so a hard per-role ceiling fought the product. The cap that
    // DOES apply now is the per-PLAN concurrency cap gated above (M2,
    // checkPlanConcurrency) + re-checked inside spawnNewAgent, with the
    // orchestrator/internal/system whitelist. Per-agent FAST_FAIL/MAX_RESTARTS
    // (agent-manager) still backstop crash loops.

    // Select best model. Order:
    //   1. enabledModels in the request body
    //   2. per-project lookup (set by main when orchestrator launches)
    //   3. global MARBLO_MODEL_PRESET as last-resort default
    // The previous code read process.env.MARBLO_ENABLED_MODELS, which races
    // across concurrent windows in multi-window mode.
    const enabledModels =
      params.enabledModels ||
      (this.enabledModelsLookup(params.projectId ?? "") as
        | ModelType[]
        | undefined) ||
      resolvePreset(process.env.MARBLO_MODEL_PRESET);
    const eligibleModels = requiresTrackedModel
      ? trackedModelCandidates(enabledModels as ModelType[])
      : (enabledModels as ModelType[]);
    const selectedModel =
      model || this.scoreModels(eligibleModels, tags, complexity);
    const agentName =
      params.nameHint ||
      `${role}-${selectedModel}-${Date.now().toString(36).slice(-4)}`;
    // Don't eagerly fall back to process.cwd() here — let spawnNewAgent's
    // resolveSpawnCwd run the full chain (parent agent → orchestrator
    // rootPath → process.cwd()) so dispatch-time spawns inherit the
    // project folder instead of /.
    // Pass the RAW instruction + taskId here (not effectiveInstruction):
    // spawnNewAgent appends the completion footer once, using the worktree
    // coordinator's resolved taskId (the caller's, or a freshly created ad-hoc
    // task). Passing the already-footered effectiveInstruction would double it.
    const spawnResult = await this.spawnNewAgent({
      name: agentName,
      model: selectedModel,
      role,
      cwd: params.cwd,
      initialPrompt: instruction,
      taskId: params.taskId,
      projectId: params.projectId,
      parentAgentId: params.parentAgentId,
      // Carry the cap-whitelist flag so a system dispatch's fresh spawn stays
      // exempt at the spawnNewAgent gate too (M2).
      system: params.system,
      // complexity → claude(--model)·codex(reasoning) 모델/레벨 선택.
      complexity,
    });

    if (!spawnResult.success) {
      return {
        success: false,
        error: spawnResult.error || "Failed to spawn agent",
      };
    }

    // Bind status to the resolved board task — spawnResult.taskId is the
    // caller's taskId or the ad-hoc worktree task created by the coordinator.
    const resolvedTaskId = spawnResult.taskId ?? params.taskId ?? null;
    this.syncAgentStatus(
      spawnResult.agentId!,
      "working",
      resolvedTaskId ?? undefined,
    );

    console.log(
      `[BridgeServer] Dispatch: spawned '${agentName}' (model=${selectedModel})`,
    );
    // §8.1 폴백 사용자 표식 — complex claude 가 최상위 모델 resolver 를 탔는데
    // 버전가드/미지모델로 폴백됐으면 dispatch 응답에 표시(사용자가 왜 최상위가
    // 아닌지 알 수 있게). read-only 재해석(같은 env → spawn 이 쓴 값과 일치).
    let topModelNote = "";
    if (selectedModel === "claude" && complexity === "complex") {
      const res = resolveTopClaudeModelDetailed();
      if (res.fallback) {
        const f = res.fallback;
        topModelNote =
          ` | ⚠️ 최상위모델 폴백: ${f.requested} 미지원` +
          `(installed=${f.installed}${f.required ? ` < ${f.required}` : ""})` +
          ` → ${f.fallbackTo}`;
      }
    }
    return {
      success: true,
      action: "spawned",
      agentId: spawnResult.agentId,
      agentName,
      agentRole: role,
      model: selectedModel,
      score: 0,
      reason: `No reusable agent found. Spawned new ${selectedModel} agent '${agentName}'${topModelNote}`,
      taskId: resolvedTaskId,
    };
  }

  // ── 모델 믹스 (§4) — complex 전용, opt-in ────────────────────
  //
  // 1차 spawn(Claude 최상위, dispatchSingle)에 더해 Codex high 동반 에이전트를
  // 추가로 띄운다. cross-check=교차검증(기본), split-role=역할분담. 동반은 공유
  // taskId 없이 띄워(ad-hoc worktree) 1차의 격리 트리와 충돌하지 않게 한다(한
  // worktree = 한 에이전트, WORKTREE-SPEC). 동반 spawn 은 spawnNewAgent 내부
  // 비용 캡(§4.4: 믹스=슬롯 2)에 종속 — 캡에 막히면 1차만으로 그레이스풀 강등.
  private async dispatchMix(
    params: DispatchTaskRequest,
    mode: "cross-check" | "split-role",
  ): Promise<DispatchTaskResponse> {
    const primary = await this.dispatchSingle(params);
    // 1차가 실패/논리에이전트면 믹스 없이 그대로 반환.
    if (!primary.success || primary.action === "logical") return primary;

    const framed =
      mode === "cross-check"
        ? `[모델 믹스 · 교차검증] 아래 작업을 독립적으로 수행하고, 1차 에이전트의 산출물을 적대적으로 검증(refute)하라. 불일치 시 오케스트레이터에 에스컬레이션.\n\n${params.instruction}`
        : `[모델 믹스 · 역할분담] 너는 테스트/기계적 변경/검증 담당이다. 설계·리팩터는 1차(Claude) 에이전트가 맡는다.\n\n${params.instruction}`;
    const companionName = `${params.role}-codex-mix-${Date.now()
      .toString(36)
      .slice(-4)}`;
    const companion = await this.spawnNewAgent({
      name: companionName,
      model: "gpt",
      role: params.role,
      cwd: params.cwd,
      initialPrompt: framed,
      // taskId 의도적으로 비움 — 1차의 격리 worktree 와 충돌 방지.
      projectId: params.projectId,
      parentAgentId: params.parentAgentId,
      system: params.system,
      complexity: "complex", // Codex high
    });

    mainTelemetry.modelMixDispatched(
      this.mainWindow,
      mode,
      params.taskId ?? null,
    );

    if (!companion.success) {
      console.warn(
        `[BridgeServer] Mix(${mode}) companion spawn blocked/failed: ${companion.error} — 1차만으로 진행.`,
      );
      return {
        ...primary,
        reason: `${primary.reason} | 모델 믹스(${mode}) 동반 spawn 실패(${companion.error}) — 단일로 강등.`,
      };
    }
    return {
      ...primary,
      action: "mixed",
      companionAgentId: companion.agentId,
      reason: `${primary.reason} | 모델 믹스(${mode}): Codex high 동반 에이전트 '${companionName}'(${companion.agentId}) spawn.`,
    };
  }

  // ── 단계분할 (§5) — complex 전용, opt-in ─────────────────────
  //
  // complex 태스크를 스텝 배열로 풀어 각 스텝을 작은 dispatch 로 보낸다. 스텝은
  // 자기 complexity/model/tags 를 가져 난도별 모델이 매칭된다(설계→최상위,
  // 기계적→cheap). dependsOnPrevious 가 하나라도 있으면 순차(직전 완료 후),
  // 아니면 병렬. 각 스텝은 taskId 없이 독립 에이전트로 떨어진다(1차 수동 분해 —
  // 자동 분해는 후속). 동시성은 spawnNewAgent 의 플랜 캡(§8.2)에 종속.
  private async dispatchStages(
    parent: DispatchTaskRequest,
    stages: NonNullable<DispatchTaskRequest["stages"]>,
  ): Promise<DispatchTaskResponse> {
    const parentRequiresTrackedModel = dispatchRequiresTrackedModel(parent);
    const runStage = (
      stage: NonNullable<DispatchTaskRequest["stages"]>[number],
    ): Promise<DispatchTaskResponse> =>
      this.dispatchSingle({
        role: parent.role,
        instruction: stage.instruction,
        complexity: stage.complexity ?? "standard",
        model: stage.model ? normalizeModel(stage.model) : parent.model,
        tags: stage.tags ?? parent.tags,
        cwd: parent.cwd,
        projectId: parent.projectId,
        parentAgentId: parent.parentAgentId,
        system: parent.system,
        requireTrackedModel: parentRequiresTrackedModel,
        // taskId 의도적으로 비움 — 스텝마다 독립 에이전트(worktree 충돌 방지).
      });

    const anyOrdered = stages.some((s) => s.dependsOnPrevious);
    const results: DispatchTaskResponse[] = [];
    if (anyOrdered) {
      // 순차: 직전 스텝이 끝난 뒤 다음 스텝을 디스패치.
      for (const stage of stages) {
        results.push(await runStage(stage));
      }
    } else {
      results.push(...(await Promise.all(stages.map(runStage))));
    }

    mainTelemetry.complexStagesDispatched(
      this.mainWindow,
      stages.length,
      stages.map((s) => s.complexity ?? "standard"),
      parent.taskId ?? null,
    );

    const stageAgentIds = results
      .map((r) => r.agentId)
      .filter((id): id is string => Boolean(id));
    return {
      success: results.every((r) => r.success),
      action: "staged",
      agentId: stageAgentIds[0],
      stageAgentIds,
      reason: `Complex 단계분할: ${stages.length} 스텝 ${
        anyOrdered ? "순차" : "병렬"
      } 디스패치 (에이전트 ${stageAgentIds.length}개).`,
      taskId: parent.taskId ?? null,
    };
  }

  private findLiveTaskAgent(
    agents: AgentInstance[],
    projectId: string | undefined,
    taskId: string | undefined,
  ): AgentInstance | null {
    if (!projectId || !taskId) return null;
    const byTaskId = agents.find(
      (a) =>
        a.status !== "stopped" &&
        a.status !== "error" &&
        a.currentTaskId === taskId,
    );
    if (byTaskId) return byTaskId;
    return (
      agents.find(
        (a) =>
          a.status !== "stopped" &&
          a.status !== "error" &&
          isWorktreeIsolated(a.cwd, projectId, taskId),
      ) ?? null
    );
  }

  private routeToTaskAgent(
    agent: AgentInstance,
    instruction: string,
    taskId: string,
  ): DispatchTaskResponse {
    this.ptyManager.writeAndSubmit(agent.ptySessionId, instruction);
    if (agent.status === "idle") {
      this.agentManager.setStatus(agent.id, "working");
    }
    this.syncAgentStatus(agent.id, "working", taskId);
    console.log(
      `[BridgeServer] Dispatch: routed to task-bound agent '${agent.name}' (task=${taskId})`,
    );
    return {
      success: true,
      action: "reused",
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      model: agent.model,
      score: 0,
      reason: `Agent already bound to task ${taskId} — routed instead of reassigning or spawning a duplicate.`,
      taskId,
    };
  }

  // ── Scoring (delegated to dispatch-scoring.ts) ───────────────

  private scoreAgents(
    agents: AgentInstance[],
    role: string,
    preferredModel?: ModelType,
    tags: string[] = [],
  ) {
    const infos: AgentInfo[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      role: a.role,
      status: a.status,
      restartCount: a.restartCount,
    }));
    return scoreAgentsFn(infos, role, preferredModel, tags);
  }

  private scoreModels(
    enabledModels: ModelType[],
    tags: string[],
    complexity?: "simple" | "standard" | "complex",
  ): ModelType {
    return scoreModelsFn(enabledModels, tags, complexity);
  }

  /**
   * Pick a working directory for a freshly-spawned agent.
   *
   * Priority:
   *   1. params.cwd  — explicit override from the caller (renderer or MCP)
   *   2. parent agent's cwd  — when MCP forwards parentAgentId, inherit
   *      its working dir so child agents stay in the project folder
   *   3. orchestrator session's rootPath  — same project, derived from
   *      the OrchestratorManager
   *   4. process.cwd()  — last-resort fallback (often "/" on macOS Finder
   *      launches; only used when nothing else can resolve)
   */
  private resolveSpawnCwd(params: SpawnAgentRequest): string {
    if (params.cwd) return params.cwd;
    if (params.parentAgentId) {
      const parent = this.agentManager.getAgent(params.parentAgentId);
      if (parent?.cwd) return parent.cwd;
    }
    if (params.projectId) {
      const orch = this.orchestratorLookup(params.projectId);
      const root = orch?.getSession()?.rootPath;
      if (root) return root;
    }
    return process.cwd();
  }

  // ── Conflict resolution (WORKTREE-SPEC §6 충돌 경로) ──────────
  //
  // When the clean squash-merge path hits a rebase conflict, the merge cockpit
  // routes to Resolve(agent): spawn a builder agent *inside* the conflicted
  // worktree to resolve it (Conductor's `/resolve-merge-conflicts` model).
  //
  // We reuse the normal spawn path — passing the worktree as cwd AND the
  // bound taskId so WorktreeCoordinator.prepare() reuses the EXISTING worktree
  // (its path is ~/.marblo/worktrees/<projectId>/<taskId>) instead of cutting
  // a fresh one. main.ts wires this as the registerWorktreeIpc spawnResolver
  // callback: `(req) => bridge.spawnResolverAgent(req)`.

  async spawnResolverAgent(req: {
    repoRoot: string;
    worktreePath: string;
    baseRef: string;
    branch: string;
    projectId?: string;
    taskId?: string;
    conflicts?: string[];
  }): Promise<{
    success: boolean;
    agentId?: string;
    taskId?: string | null;
    error?: string;
  }> {
    const shortBranch = req.branch.split("/").pop() || "worktree";
    const result = await this.spawnNewAgent({
      name: `resolver-${shortBranch}`,
      model: "claude",
      role: "backend",
      cwd: req.worktreePath,
      taskId: req.taskId,
      projectId: req.projectId,
      initialPrompt: buildResolverPrompt(req),
      // System-initiated, must-proceed spawn (merge-conflict resolution) →
      // exempt from the per-plan concurrency cap (M2).
      system: true,
    });
    return {
      success: result.success,
      agentId: result.agentId,
      taskId: result.taskId ?? req.taskId ?? null,
      error: result.error,
    };
  }

  // ── Shared spawn logic ──────────────────────────────────────

  private async spawnNewAgent(
    params: SpawnAgentRequest,
  ): Promise<SpawnAgentResponse> {
    // M2 — per-plan concurrency cap at the single spawn chokepoint, so EVERY
    // new-agent path (HTTP /spawn-agent, dispatch Step 3, resolver) is gated,
    // not just dispatch. Orchestrator / internal / system-flagged spawns are
    // exempt (resolver passes system:true). Count the project's active agents
    // before adding this one; unknown plan → unlimited (never false-blocks).
    const cap = checkPlanConcurrency(
      this.planLookup(params.projectId),
      this.agentManager.listAgentsByProject(params.projectId),
      { role: params.role, system: params.system },
    );
    if (!cap.allowed) {
      console.warn(
        `[BridgeServer] Spawn blocked by plan cap (role=${params.role}, active=${cap.active}/${cap.limit})`,
      );
      return { success: false, error: cap.reason };
    }

    // Fold model aliases ("codex" → "gpt", "agy" → "antigravity") at the
    // single spawn chokepoint so every caller (HTTP /spawn-agent, dispatch,
    // mission engine) routes to the right CLI even when the orchestrator
    // says the natural word "codex" instead of the internal id "gpt".
    params.model = normalizeModel(params.model) ?? params.model;
    const agentId = crypto.randomUUID();
    // cwd resolution chain: explicit → parent agent's cwd → orchestrator
    // for the same project → process.cwd(). This fixes the "agent opens
    // in / instead of project folder" issue when the orchestrator omits
    // cwd in dispatch_task. Electron launched from Finder has process.cwd()
    // == "/", so the explicit-cwd fallback is what kept it working at all.
    const repoRoot = this.resolveSpawnCwd(params);

    // WORKTREE-SPEC: hand the resolved repo root to the coordinator, which
    // guarantees a board task + an isolated git worktree for this spawn and
    // returns the cwd the agent should launch in. Never throws — for non-git
    // or no-project spawns it falls back to repoRoot (legacy behavior) and
    // leaves taskId as the caller's value (or null).
    const prep = await this.worktreeCoordinator.prepare({
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.name,
      // Raw spawn prompt (pre-footer) so the ad-hoc ticket shows what the agent
      // was asked to do; only used when the coordinator auto-creates a task.
      description: params.initialPrompt,
      repoRoot,
      requestedCwd: repoRoot,
    });
    const cwd = prep.cwd;

    // PTY forwarding is delegated to the host (main process) via
    // agentSpawnedHook so multi-window owner-routing happens consistently.
    // We fall back to bridge-local broadcast forwarding only when no hook
    // is wired (legacy / test paths). Footer uses the coordinator's resolved
    // taskId so ad-hoc spawns report against the auto-created board task.
    const initialPrompt = params.initialPrompt
      ? withCompletionFooter(params.initialPrompt, prep.taskId ?? params.taskId)
      : params.initialPrompt;
    const instance = this.agentManager.launch({
      id: agentId,
      name: params.name,
      model: params.model,
      role: params.role,
      command: params.command || this.getDefaultCommand(params.model),
      cwd,
      currentTaskId: prep.taskId ?? params.taskId ?? null,
      initialPrompt,
      projectId: params.projectId,
      complexity: params.complexity,
      contextId: params.contextId,
      onPtyReady: (sid) => {
        if (this.agentSpawnedHook) {
          this.agentSpawnedHook({
            sid,
            projectId: params.projectId,
            agentId,
            parentAgentId: params.parentAgentId,
            name: params.name,
            model: params.model,
            role: params.role,
          });
          return;
        }
        // Fallback: bridge-local PTY forwarding
        const buffer: string[] = [];
        this.ptyBuffers.set(sid, buffer);
        this.ptyManager.onData(sid, (data) => {
          if (this.ptyBuffers.has(sid)) {
            this.ptyBuffers.get(sid)!.push(data);
            return;
          }
          this.broadcast(`pty:data:${sid}`, data);
        });
        this.ptyManager.onExit(sid, (exitCode) => {
          this.ptyBuffers.delete(sid);
          this.broadcast(`pty:exit:${sid}`, exitCode);
        });
      },
    });

    const sid = instance.ptySessionId;

    // M6 — claim the freshly-launched agent as "working" synchronously. launch()
    // sets status "idle" and only the FIRST PTY output byte auto-promotes it to
    // "working" (agent-manager). An agent dispatched with an initialPrompt IS
    // working on it; leaving it "idle" until that first byte opens a window
    // where a concurrent/subsequent reuse-dispatch grabs it and injects a 2nd
    // task. Setting it here — no await between launch() and this line — closes
    // that window. The heartbeat (5-min PTY silence) and MCP self-report demote
    // it back to idle once it's genuinely free.
    if (params.initialPrompt) {
      this.agentManager.setStatus(agentId, "working");
    }

    // Notify renderer to attach terminal tab. If hook is wired, main owns
    // the project-scoped notify; otherwise broadcast (legacy).
    if (!this.agentSpawnedHook) {
      this.broadcast("agent:spawned", {
        agentId,
        name: params.name,
        ptySessionId: sid,
        model: params.model,
        role: params.role,
      });
    }

    return {
      success: true,
      agentId,
      ptySessionId: sid,
      taskId: prep.taskId ?? params.taskId ?? null,
    };
  }

  // ── Sync status to renderer (→ Firestore) ───────────────────

  private syncAgentStatus(
    agentId: string,
    status: AgentStatus,
    currentTaskId?: string | null,
  ): void {
    // Include agentName so the renderer can match by name (Firestore doc ID != AgentManager UUID)
    const agent = this.agentManager.getAgent(agentId);
    if (currentTaskId !== undefined) {
      this.agentManager.setCurrentTask(agentId, currentTaskId);
    }
    this.broadcast("agent:syncStatus", {
      agentId,
      agentName: agent?.name || "",
      status,
      currentTaskId: currentTaskId ?? null,
    });
  }

  private getDefaultCommand(model: string): string {
    switch (model) {
      case "claude":
        return "claude";
      case "gemini":
        return "gemini";
      case "gpt":
        return "codex";
      case "antigravity":
        return "agy";
      default:
        // local / custom expect an explicit command override from the
        // caller — the claude fallback here is a "should never happen"
        // safety net, not a routing decision.
        return "claude";
    }
  }

  // ── POST /set-agent-status ──────────────────────────────────

  private handleSetAgentStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let params: { agentId?: string; agentName?: string; status: string };
      try {
        params = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
        return;
      }

      const agent = params.agentName
        ? this.agentManager.getAgentByName(params.agentName)
        : params.agentId
          ? this.agentManager.getAgent(params.agentId)
          : null;

      if (!agent) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Agent not found" }));
        return;
      }

      const validStatuses = ["idle", "working", "stopped", "error"];
      if (!validStatuses.includes(params.status)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid status: ${params.status}`,
          }),
        );
        return;
      }

      const nextStatus = params.status as AgentStatus;
      const nextTaskId = nextStatus === "working" ? undefined : null;
      this.agentManager.setStatus(agent.id, nextStatus);
      this.syncAgentStatus(agent.id, nextStatus, nextTaskId);
      console.log(
        `[BridgeServer] Set agent "${agent.name}" status → ${params.status}`,
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });
  }

  // ── POST /reap-worktree ─────────────────────────────────────
  //
  // Auto-reap the isolated worktree of a terminal task (DONE) or merged PR —
  // the fix for the 100+ orphaned-worktree pileup that locked the shared
  // branch. Fired best-effort by update_task_status (MCP) when a task hits
  // DONE; the heavy lifting + work-loss guard lives in WorktreeManager.reap
  // (dirty / unmerged-unpushed worktrees are preserved, never destroyed).
  //
  // Extra guard here: never pull the rug from an agent still ACTIVELY working
  // in that worktree (status === "working"). On DONE the reporting agent is
  // already set idle, so the normal path proceeds; this only defers the rare
  // case of a reap arriving while a live session still owns the tree.

  private handleReapWorktree(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const reply = (code: number, payload: Record<string, unknown>) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      let params: {
        projectId?: string;
        taskId?: string;
        requireMerged?: boolean;
      };
      try {
        params = JSON.parse(body);
      } catch {
        reply(400, { success: false, error: "Invalid JSON" });
        return;
      }

      const { projectId, taskId, requireMerged } = params;
      if (!projectId || !taskId) {
        reply(400, { success: false, error: "projectId and taskId required" });
        return;
      }

      const repoRoot =
        this.orchestratorLookup(projectId)?.getSession()?.rootPath;
      if (!repoRoot) {
        reply(200, {
          success: true,
          removed: false,
          reason: "no repo root for project",
        });
        return;
      }

      // Defer if a live agent still owns this worktree (AgentInfo carries no
      // cwd, so resolve the full instance for each candidate).
      const suffix = path.sep + path.join(projectId, taskId);
      const busy = this.agentManager
        .listAgentsByProject(projectId)
        .some((a) => {
          const full = this.agentManager.getAgent(a.id);
          return (
            full?.status === "working" &&
            !!full.cwd &&
            full.cwd.endsWith(suffix)
          );
        });
      if (busy) {
        reply(200, {
          success: true,
          removed: false,
          reason: "owning agent still working",
        });
        return;
      }

      void this.worktreeCoordinator
        .reapForTask({ projectId, taskId, repoRoot, requireMerged })
        .then((result) => {
          if (result.removed) {
            console.log(
              `[BridgeServer] Reaped worktree for task ${taskId} (${result.reason})`,
            );
          }
          reply(200, { success: true, ...result });
        })
        .catch((e) => {
          reply(200, {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          });
        });
    });
  }

  // ── POST /inject-message ───────────────────────────────────
  //
  // Patent 단락 296-297 양방향 동기화 *하향 경로*:
  //   사용자가 칸반보드(KanbanBoard / TaskDetailModal)에서 코멘트 추가,
  //   상태 강제 변경, 우선순위 변경, 에이전트 재배정 등을 수행하면
  //   해당 액션이 PM 신규지시 형태로 담당 에이전트의 PTY 표준입력에
  //   주입된다 (PtyManager.writeAndSubmit). 에이전트는 실행을 중단하지
  //   않고 기존 컨텍스트 위에서 신규지시를 반영해 작업을 이어간다.
  //   상향 경로(에이전트 stdout → 태스크보드 → 칸반)와 합쳐 청구항 5/10
  //   + 명세서 양방향 실시간 제어 인터페이스 구현 완성.

  private handleInjectMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let params: {
        targetAgent: string;
        tag: string;
        message: string;
        taskId?: string;
        taskTitle?: string;
        projectId?: string; // multi-window: routes orchestrator fallback
      };
      try {
        params = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      if (!params.targetAgent || !params.tag || !params.message) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Missing required fields: targetAgent, tag, message",
          }),
        );
        return;
      }

      try {
        const taskMeta = params.taskTitle
          ? ` task="${params.taskTitle}"${
              params.taskId ? ` taskId=${params.taskId}` : ""
            }`
          : params.taskId
            ? ` taskId=${params.taskId}`
            : "";
        const formatted = `[${params.tag}]${taskMeta}\n${params.message}`;

        // Try to find the target agent
        let agent = this.agentManager.getAgentByName(params.targetAgent);
        if (!agent) agent = this.agentManager.getAgent(params.targetAgent);

        if (agent && agent.status !== "stopped" && agent.status !== "error") {
          // Agent is online — inject directly (split for discrete Enter)
          this.ptyManager.writeAndSubmit(agent.ptySessionId, formatted);
          console.log(
            `[BridgeServer] Injected [${params.tag}] → agent "${agent.name}"`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              delivered: "agent",
              agentName: agent.name,
            }),
          );
        } else {
          // Agent offline — fallback to orchestrator (route by projectId)
          const orch = this.orchestratorLookup(params.projectId ?? "");
          const session = orch?.getSession();
          if (session && session.status === "running") {
            const forwarded = `[${params.tag} → Forwarded] agent="${params.targetAgent}"${taskMeta}\n에이전트 오프라인. 원본: ${params.message}`;
            this.ptyManager.writeAndSubmit(session.ptySessionId, forwarded);
            console.log(
              `[BridgeServer] Forwarded [${params.tag}] → orchestrator (agent "${params.targetAgent}" offline)`,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                delivered: "orchestrator",
                reason: `Agent "${params.targetAgent}" offline`,
              }),
            );
          } else {
            console.warn(
              `[BridgeServer] Cannot deliver [${params.tag}]: agent "${params.targetAgent}" offline, orchestrator not running`,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                error: "Agent offline and orchestrator not running",
              }),
            );
          }
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    });
  }
}
