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
  type AgentInfo,
} from "./dispatch-scoring";
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
    `- 진행 로그: add_activity(task_id="${taskId}", message="...")`,
    `- 진행 상황은 ticket 본문(description)이 아니라 add_activity 로만 보고 — 본문은 생성 시점의 불변 스펙이다.`,
    `- 정상 완료 / 리뷰 가능: submit_for_review(task_id="${taskId}", pr_url?)`,
    `- 실패 / 반려: update_task_status(task_id="${taskId}", status="FAILED", comment="이유")`,
    "위 도구 호출 직후 오케스트레이터 PTY 로 알림이 자동 주입된다.",
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
  /** Project ID — required in multi-window mode to scope the agent's view
   * to the correct window. MCP server forwards MARBLO_PROJECT here. */
  projectId?: string;
  /** Parent agent ID (the caller). MCP server forwards MARBLO_AGENT_ID
   * here so the spawn hook can fall back to the parent's project / owner
   * when projectId is missing or empty. Critical for resolving owner
   * window when external Claude Code invokes Marblo MCP without an
   * explicit project context. */
  parentAgentId?: string;
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
}

// ── Dispatch types ──────────────────────────────────────────

export interface DispatchTaskRequest {
  role: string;
  instruction: string;
  taskId?: string;
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
}

export type DispatchAction = "logical" | "reused" | "restarted" | "spawned";

export interface DispatchTaskResponse {
  success: boolean;
  action?: DispatchAction;
  agentId?: string;
  agentName?: string;
  model?: string;
  score?: number;
  reason?: string;
  error?: string;
  /** Board task bound to the (possibly newly spawned) agent — used by the
   * MCP layer to set the agent doc's currentTaskId. */
  taskId?: string | null;
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

        const orch = this.orchestratorLookup(params.projectId ?? "");
        const session = orch?.getSession();
        if (!session || session.status !== "running") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: params.projectId
                ? `Orchestrator not running for project ${params.projectId}`
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
          `[BridgeServer] Notified orchestrator (project=${
            params.projectId
          }): ${params.message.slice(0, 80)}...`,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
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
      let params: { agentName: string; instruction: string };
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

        // Write instruction to agent's PTY stdin (split for discrete Enter)
        this.ptyManager.writeAndSubmit(agent.ptySessionId, params.instruction);
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
  async dispatchTask(
    params: DispatchTaskRequest,
  ): Promise<DispatchTaskResponse> {
    const { role, instruction, complexity = "standard", tags = [] } = params;
    // Fold "codex"/"agy" aliases onto canonical ids so an explicit model
    // request matches the right agents during reuse scoring AND spawns the
    // right CLI. undefined (no/unknown hint) falls through to tag scoring.
    const model = normalizeModel(params.model);

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

    // Step 0: Logical agent for simple tasks
    if (complexity === "simple") {
      return {
        success: true,
        action: "logical",
        reason: `Simple task — use internal sub-agent (complexity='simple')`,
        taskId: params.taskId ?? null,
      };
    }

    // Multi-window: only consider agents owned by the requesting project
    // for reuse / restart / spawn-constraint counting.
    const allAgents = this.agentManager.listAgentsByProject(params.projectId);

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
    // Only idle agents are safe to reuse — working agents may be mid-task
    const reusable = scored.filter(
      (s) =>
        s.score >= 100 &&
        s.agent.status === "idle" &&
        modelMatches(s.agent.model),
    );

    // Step 1: Reuse idle agent
    if (reusable.length > 0) {
      const best = reusable[0];
      // Resolve full AgentInstance from AgentManager (ScoredAgent.agent is AgentInfo)
      const fullAgent = this.agentManager.getAgent(best.agent.id);
      if (fullAgent) {
        this.ptyManager.writeAndSubmit(
          fullAgent.ptySessionId,
          effectiveInstruction,
        );
      }
      this.agentManager.setStatus(best.agent.id, "working");
      this.syncAgentStatus(best.agent.id, "working", params.taskId);

      console.log(
        `[BridgeServer] Dispatch: reused '${best.agent.name}' (score=${best.score})`,
      );
      return {
        success: true,
        action: "reused",
        agentId: best.agent.id,
        agentName: best.agent.name,
        model: best.agent.model,
        score: best.score,
        reason: best.reason,
        taskId: params.taskId ?? null,
      };
    }

    // Step 2: Restart stopped agent (same explicit-model gate as reuse)
    const restartable = scored.filter(
      (s) =>
        s.score >= 100 &&
        s.agent.status === "stopped" &&
        modelMatches(s.agent.model),
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
          model: best.agent.model,
          score: best.score,
          reason: best.reason,
          taskId: params.taskId ?? null,
        };
      }
    }

    // Step 3: Spawn new agent
    // NOTE: Spawn-count caps (MAX_AGENTS / MAX_PER_ROLE) were intentionally
    // removed (2026-06-02) — Marblo runs heterogeneous fleets where a role
    // can easily have 10+ agents (e.g. many Claude Code workers), so a hard
    // ceiling fought the product. There is no spawn-count limit now; the
    // only backstops are agent-manager's per-agent FAST_FAIL/MAX_RESTARTS
    // (crash loops) — not total count. Re-add a working-agent-based cap here
    // if runaway auto-dispatch ever becomes a problem.

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
    const selectedModel =
      model || this.scoreModels(enabledModels as ModelType[], tags);
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
    return {
      success: true,
      action: "spawned",
      agentId: spawnResult.agentId,
      agentName,
      model: selectedModel,
      score: 0,
      reason: `No reusable agent found. Spawned new ${selectedModel} agent '${agentName}'`,
      taskId: resolvedTaskId,
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

  private scoreModels(enabledModels: ModelType[], tags: string[]): ModelType {
    return scoreModelsFn(enabledModels, tags);
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
      initialPrompt,
      projectId: params.projectId,
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
    currentTaskId?: string,
  ): void {
    // Include agentName so the renderer can match by name (Firestore doc ID != AgentManager UUID)
    const agent = this.agentManager.getAgent(agentId);
    this.broadcast("agent:syncStatus", {
      agentId,
      agentName: agent?.name || "",
      status,
      currentTaskId: currentTaskId || null,
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

      let agent = params.agentName
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

      this.agentManager.setStatus(agent.id, params.status as AgentStatus);
      this.syncAgentStatus(agent.id, params.status as AgentStatus);
      console.log(
        `[BridgeServer] Set agent "${agent.name}" status → ${params.status}`,
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
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
