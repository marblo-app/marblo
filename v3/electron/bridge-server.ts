import http from "http";
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
  checkSpawnConstraints,
  resolvePreset,
  MAX_AGENTS,
  MAX_PER_ROLE,
  type AgentInfo,
} from "./dispatch-scoring";

export interface SpawnAgentRequest {
  name: string;
  model: "claude" | "gemini" | "gpt" | "custom";
  role: string;
  command?: string;
  cwd?: string;
  initialPrompt?: string;
  /** Project ID — required in multi-window mode to scope the agent's view
   * to the correct window. MCP server forwards MARBLO_PROJECT here. */
  projectId?: string;
}

interface SpawnAgentResponse {
  success: boolean;
  agentId?: string;
  ptySessionId?: string;
  error?: string;
}

interface NotifyOrchestratorRequest {
  message: string;
  /** Project ID — required in multi-window mode to route to the right
   * orchestrator. MCP server forwards MARBLO_PROJECT env var here. */
  projectId?: string;
}

// ── Dispatch types ──────────────────────────────────────────

interface DispatchTaskRequest {
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
}

type DispatchAction = "logical" | "reused" | "restarted" | "spawned";

interface DispatchTaskResponse {
  success: boolean;
  action?: DispatchAction;
  agentId?: string;
  agentName?: string;
  model?: string;
  score?: number;
  reason?: string;
  error?: string;
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
  private mainWindow: BrowserWindow | null = null;
  private allWindows: Set<BrowserWindow> | null = null;
  private ptyBuffers: Map<string, string[]>;
  // Hook injected by main: when bridge spawns an agent, main wires up PTY
  // forwarding (with proper window-owner routing) and broadcasts spawn
  // notification scoped to the agent's project. This avoids bridge having
  // its own PTY routing that bypasses multi-window scoping.
  private agentSpawnedHook:
    | ((sid: string, projectId: string | undefined, agentId: string) => void)
    | null = null;

  constructor(
    agentManager: AgentManager,
    ptyManager: PtyManager,
    ptyBuffers: Map<string, string[]>,
  ) {
    this.agentManager = agentManager;
    this.ptyManager = ptyManager;
    this.ptyBuffers = ptyBuffers;
  }

  setOrchestratorLookup(
    lookup: (projectId: string) => OrchestratorManager | null,
  ): void {
    this.orchestratorLookup = lookup;
  }

  setAgentSpawnedHook(
    hook: (sid: string, projectId: string | undefined, agentId: string) => void,
  ): void {
    this.agentSpawnedHook = hook;
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

        if (req.method === "GET" && req.url === "/agents") {
          this.handleGetAgents(res);
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

  private handleGetAgents(res: http.ServerResponse): void {
    const agents = this.agentManager.listAgents().map((a) => ({
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
    req.on("end", () => {
      let params: SpawnAgentRequest;
      try {
        params = JSON.parse(body) as SpawnAgentRequest;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
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

        const result = this.spawnNewAgent(params);

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
    req.on("end", () => {
      let params: DispatchTaskRequest;
      try {
        params = JSON.parse(body) as DispatchTaskRequest;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
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

        const result = this.dispatchTask(params);
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
            error: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
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
          `[BridgeServer] Removed agent '${params.agentName}' (reason: ${params.reason || "none"})`,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            agentId: agent.id,
            reason: `Agent '${params.agentName}' stopped${params.reason ? `: ${params.reason}` : ""}`,
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
            error: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
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
          `[BridgeServer] Notified orchestrator (project=${params.projectId}): ${params.message.slice(0, 80)}...`,
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
            error: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
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
          `[BridgeServer] Reused agent '${params.agentName}': ${params.instruction.slice(0, 80)}...`,
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

  private dispatchTask(params: DispatchTaskRequest): DispatchTaskResponse {
    const {
      role,
      instruction,
      complexity = "standard",
      model,
      tags = [],
    } = params;

    // Step 0: Logical agent for simple tasks
    if (complexity === "simple") {
      return {
        success: true,
        action: "logical",
        reason: `Simple task — use internal sub-agent (complexity='simple')`,
      };
    }

    // Multi-window: only consider agents owned by the requesting project
    // for reuse / restart / spawn-constraint counting.
    const allAgents = this.agentManager.listAgentsByProject(params.projectId);

    // Step 1 & 2: Score existing agents
    const scored = this.scoreAgents(allAgents, role, model, tags);
    // Only idle agents are safe to reuse — working agents may be mid-task
    const reusable = scored.filter(
      (s) => s.score >= 100 && s.agent.status === "idle",
    );

    // Step 1: Reuse idle agent
    if (reusable.length > 0) {
      const best = reusable[0];
      // Resolve full AgentInstance from AgentManager (ScoredAgent.agent is AgentInfo)
      const fullAgent = this.agentManager.getAgent(best.agent.id);
      if (fullAgent) {
        this.ptyManager.writeAndSubmit(fullAgent.ptySessionId, instruction);
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
      };
    }

    // Step 2: Restart stopped agent
    const restartable = scored.filter(
      (s) => s.score >= 100 && s.agent.status === "stopped",
    );

    if (restartable.length > 0) {
      const best = restartable[0];
      // Pass instruction as initialPrompt so readiness detection handles delivery timing
      const restarted = this.agentManager.restart(best.agent.id, instruction);
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
        };
      }
    }

    // Step 3: Spawn new agent
    // Check constraints
    const agentInfos: AgentInfo[] = allAgents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      role: a.role,
      status: a.status,
      restartCount: a.restartCount,
    }));
    const constraint = checkSpawnConstraints(agentInfos, role);
    if (!constraint.allowed) {
      return { success: false, error: constraint.error };
    }

    // Select best model
    const enabledModels =
      params.enabledModels ||
      (process.env.MARBLO_ENABLED_MODELS?.split(",") as
        | ModelType[]
        | undefined) ||
      resolvePreset(process.env.MARBLO_MODEL_PRESET);
    const selectedModel =
      model || this.scoreModels(enabledModels as ModelType[], tags);
    const agentName =
      params.nameHint ||
      `${role}-${selectedModel}-${Date.now().toString(36).slice(-4)}`;
    const cwd = params.cwd || process.cwd();

    const spawnResult = this.spawnNewAgent({
      name: agentName,
      model: selectedModel,
      role,
      cwd,
      initialPrompt: instruction,
      projectId: params.projectId,
    });

    if (!spawnResult.success) {
      return {
        success: false,
        error: spawnResult.error || "Failed to spawn agent",
      };
    }

    this.syncAgentStatus(spawnResult.agentId!, "working", params.taskId);

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

  // ── Shared spawn logic ──────────────────────────────────────

  private spawnNewAgent(params: SpawnAgentRequest): SpawnAgentResponse {
    const agentId = crypto.randomUUID();
    const cwd = params.cwd || process.cwd();

    // PTY forwarding is delegated to the host (main process) via
    // agentSpawnedHook so multi-window owner-routing happens consistently.
    // We fall back to bridge-local broadcast forwarding only when no hook
    // is wired (legacy / test paths).
    const instance = this.agentManager.launch({
      id: agentId,
      name: params.name,
      model: params.model,
      role: params.role,
      command: params.command || this.getDefaultCommand(params.model),
      cwd,
      initialPrompt: params.initialPrompt,
      projectId: params.projectId,
      onPtyReady: (sid) => {
        if (this.agentSpawnedHook) {
          this.agentSpawnedHook(sid, params.projectId, agentId);
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
      default:
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
            error: `Invalid JSON: ${err instanceof Error ? err.message : "parse error"}`,
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
          ? ` task="${params.taskTitle}"${params.taskId ? ` taskId=${params.taskId}` : ""}`
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
