import { BrowserWindow } from "electron";
import { PtyManager } from "./pty-manager";
import { AgentConfigGenerator, LaunchConfig } from "./agent-config";
import { mainTelemetry } from "./telemetry";

export type ModelType = "claude" | "gemini" | "gpt" | "custom";
export type AgentStatus = "idle" | "working" | "error" | "stopped";

// --- Auto-restart constants ---
const MAX_RESTARTS = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface AgentLaunchParams {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  command: string;
  cwd: string;
  initialPrompt?: string;
  resumeSessionId?: string; // 'new' | 'latest' | UUID
  /** Firestore project document ID — injected as MARBLO_PROJECT env var into MCP */
  projectId?: string;
  /** Called immediately after PTY is created, before any output can be missed */
  onPtyReady?: (ptySessionId: string) => void;
}

export interface AgentInstance {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  ptySessionId: string;
  status: AgentStatus;
  command: string;
  cwd: string;
  launchConfig?: LaunchConfig;
  // --- Auto-restart fields ---
  restartCount: number;
  lastExitCode: number | null;
  stopRequested: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Stored so auto-restart can re-register PTY forwarding */
  onPtyReady?: (ptySessionId: string) => void;
}

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  private ptyManager: PtyManager;
  private configGenerator: AgentConfigGenerator;
  private onStatusChange?: (agentId: string, status: AgentStatus) => void;
  private onSessionDetected?: (
    rootPath: string,
    sessionId: string,
    label: string,
    agentId: string,
  ) => void;
  private onRestartAttempt?: (
    agentId: string,
    attempt: number,
    maxAttempts: number,
  ) => void;
  private onRestartFailed?: (agentId: string, exitCode: number) => void;
  private getMainWindow?: () => BrowserWindow | null;
  private resolveSessionId?: (
    rootPath: string,
    requested: string,
    filterLabel?: string,
    filterAgentId?: string,
  ) => string | null;

  constructor(
    ptyManager: PtyManager,
    onStatusChange?: (agentId: string, status: AgentStatus) => void,
    onSessionDetected?: (
      rootPath: string,
      sessionId: string,
      label: string,
      agentId: string,
    ) => void,
    onRestartAttempt?: (
      agentId: string,
      attempt: number,
      maxAttempts: number,
    ) => void,
    onRestartFailed?: (agentId: string, exitCode: number) => void,
    getMainWindow?: () => BrowserWindow | null,
  ) {
    this.ptyManager = ptyManager;
    this.configGenerator = new AgentConfigGenerator();
    this.onStatusChange = onStatusChange;
    this.onSessionDetected = onSessionDetected;
    this.onRestartAttempt = onRestartAttempt;
    this.onRestartFailed = onRestartFailed;
    this.getMainWindow = getMainWindow;
  }

  /** Inject session resolver (from OrchestratorManager) after construction */
  setSessionResolver(
    resolver: (
      rootPath: string,
      requested: string,
      filterLabel?: string,
      filterAgentId?: string,
    ) => string | null,
  ) {
    this.resolveSessionId = resolver;
  }

  launch(params: AgentLaunchParams): AgentInstance {
    const ptySessionId = `agent-${params.id}`;

    // Generate MCP config + skill file for this agent
    const launchConfig = this.configGenerator.getLaunchConfig(
      {
        id: params.id,
        model: params.model,
        role: params.role,
        command: params.command,
      },
      params.cwd,
      params.initialPrompt,
      params.projectId,
    );

    // Resume support: add --resume flag
    let resolvedResumeId = params.resumeSessionId;
    // Safety: if 'latest' leaked through, try resolving it here
    if (resolvedResumeId === "latest" && this.resolveSessionId && params.cwd) {
      resolvedResumeId =
        this.resolveSessionId(params.cwd, "latest", params.name, params.id) ??
        undefined;
      console.log(
        `[Agent:${params.id}] Resolved 'latest' → ${resolvedResumeId ?? "none (new session)"}`,
      );
    }
    const isResume =
      resolvedResumeId &&
      resolvedResumeId !== "new" &&
      resolvedResumeId !== "latest";
    if (isResume) {
      launchConfig.args.push("--resume", resolvedResumeId!);
      console.log(`[Agent:${params.id}] Resuming session: ${resolvedResumeId}`);
    }

    // Merge env: process.env + generated MCP env
    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...launchConfig.env,
    };
    // Claude Code 중첩 세션 방지 — 부모의 CLAUDECODE 변수 제거
    delete mergedEnv.CLAUDECODE;

    // Create PTY session with the CLI command + MCP args
    this.ptyManager.create(
      ptySessionId,
      `Agent: ${params.name}`,
      launchConfig.command,
      launchConfig.args,
      params.cwd,
      mergedEnv,
    );

    // Notify caller IMMEDIATELY so they can register data listeners
    // before the PTY produces any output.
    params.onPtyReady?.(ptySessionId);

    // Send initial prompt via stdin after CLI finishes booting (only for NEW sessions).
    // Uses PTY output detection instead of fixed timer to reliably detect readiness.
    if (!isResume && launchConfig.initialPrompt) {
      const prompt = launchConfig.initialPrompt;
      let sent = false;
      const sendPrompt = () => {
        if (sent) return;
        sent = true;
        // Split text and \r so Claude Code registers Enter as a discrete
        // keystroke (single-chunk write gets paste-buffered, leaving the
        // CR inside the message body without submitting).
        this.ptyManager.writeAndSubmit(ptySessionId, prompt);
        console.log(
          `[Agent:${params.id}] Initial prompt sent (${prompt.length} chars)`,
        );
      };

      // Watch PTY output for CLI readiness indicators
      // Only match patterns that confirm the CLI is actually ready for input
      let outputBuffer = "";
      const readinessPatterns = [
        /╭─+/, // Claude Code: box border (specific)
        /\? for shortcuts/, // Claude Code: footer help text
        /Type your message/i, // Claude/Gemini: input prompt
        /Loaded \d+ MCP tool/i, // MCP tools loaded confirmation
        /Ready to assist/i, // Generic CLI ready message
        /What can I help/i, // Gemini/GPT greeting
      ];

      this.ptyManager.onData(ptySessionId, (data) => {
        if (sent) return;
        outputBuffer += data;
        // Only keep last 4KB to avoid memory growth
        if (outputBuffer.length > 4096)
          outputBuffer = outputBuffer.slice(-4096);
        for (const pattern of readinessPatterns) {
          if (pattern.test(outputBuffer)) {
            // Delay to let CLI fully render its prompt
            setTimeout(sendPrompt, 1500);
            return;
          }
        }
      });

      // Fallback: send after 10 seconds regardless
      setTimeout(sendPrompt, 10000);
    }

    // Detect new Claude session file and save label (5s after launch)
    if (this.onSessionDetected && params.cwd) {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;
      // Capture existing sessions before launch
      let existingIds: Set<string>;
      try {
        const encodedPath = rootPath.replace(/\//g, "-");
        const sessionsDir = require("path").join(
          require("os").homedir(),
          ".claude",
          "projects",
          encodedPath,
        );
        const files = require("fs").existsSync(sessionsDir)
          ? require("fs")
              .readdirSync(sessionsDir)
              .filter((f: string) => f.endsWith(".jsonl"))
              .map((f: string) => f.replace(".jsonl", ""))
          : [];
        existingIds = new Set(files);
      } catch (err) {
        console.error(
          `[AgentManager] Failed to read existing session files for rootPath="${rootPath}":`,
          err,
        );
        existingIds = new Set();
      }

      setTimeout(() => {
        try {
          const encodedPath = rootPath.replace(/\//g, "-");
          const sessionsDir = require("path").join(
            require("os").homedir(),
            ".claude",
            "projects",
            encodedPath,
          );
          if (!require("fs").existsSync(sessionsDir)) return;
          const currentFiles = require("fs")
            .readdirSync(sessionsDir)
            .filter((f: string) => f.endsWith(".jsonl"))
            .map((f: string) => f.replace(".jsonl", ""));
          const newId = currentFiles.find((id: string) => !existingIds.has(id));
          if (newId) {
            this.onSessionDetected!(rootPath, newId, agentName, agentId);
          }
        } catch (err) {
          console.error(
            `[AgentManager] Failed to detect new session file for agent="${agentId}" rootPath="${rootPath}":`,
            err,
          );
        }
      }, 5000);
    }

    const instance: AgentInstance = {
      id: params.id,
      name: params.name,
      model: params.model,
      role: params.role,
      ptySessionId,
      status: "idle",
      command: params.command,
      cwd: params.cwd,
      launchConfig,
      restartCount: 0,
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
      onPtyReady: params.onPtyReady,
    };

    this.agents.set(params.id, instance);

    // Telemetry: agent spawned — prefer MARBLO_PROJECT from launchConfig (always set by agent-config)
    const spawnProjectId =
      instance.launchConfig?.env?.MARBLO_PROJECT || params.projectId || "";
    mainTelemetry.agentSpawned(
      this.getMainWindow?.() ?? null,
      params.id,
      params.name,
      params.model || "claude",
      params.role || "backend",
      spawnProjectId,
    );

    // Start heartbeat for anomaly detection (ML-4)
    instance.heartbeatTimer = setInterval(() => {
      const win = this.getMainWindow?.() ?? null;
      const agent = this.agents.get(params.id);
      if (!agent || agent.stopRequested) return;
      const hbProjectId =
        agent.launchConfig?.env?.MARBLO_PROJECT || params.projectId || "";
      mainTelemetry.heartbeat(win, params.id, hbProjectId, agent.status, 0, 0);
    }, HEARTBEAT_INTERVAL_MS);

    // Monitor PTY exit — auto-restart on crash
    this.ptyManager.onExit(ptySessionId, (exitCode) => {
      const agent = this.agents.get(params.id);
      if (!agent) return;

      agent.lastExitCode = exitCode;

      // Intentional stop or clean exit → just mark stopped
      if (agent.stopRequested || exitCode === 0) {
        agent.status = "stopped";
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "stopped");
        mainTelemetry.agentStopped(
          this.getMainWindow?.() ?? null,
          params.id,
          exitCode,
        );
        return;
      }

      // Crash detected — attempt auto-restart with exponential backoff
      if (agent.restartCount < MAX_RESTARTS) {
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, agent.restartCount),
          BACKOFF_MAX_MS,
        );
        agent.restartCount++;
        this.onRestartAttempt?.(agent.id, agent.restartCount, MAX_RESTARTS);
        mainTelemetry.agentRestarted(
          this.getMainWindow?.() ?? null,
          agent.id,
          agent.restartCount,
        );
        console.log(
          `[Agent:${agent.id}] Crash detected (exit ${exitCode}). Restart ${agent.restartCount}/${MAX_RESTARTS} in ${delay}ms`,
        );

        agent.restartTimer = setTimeout(() => {
          this.performAutoRestart(agent.id);
        }, delay);
      } else {
        // Max restarts exceeded → error state
        agent.status = "error";
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "error");
        this.onRestartFailed?.(agent.id, exitCode);
        mainTelemetry.agentCrashed(
          this.getMainWindow?.() ?? null,
          agent.id,
          exitCode,
        );
        console.error(
          `[Agent:${agent.id}] Max restarts (${MAX_RESTARTS}) exceeded. Exit code: ${exitCode}`,
        );
      }
    });

    return instance;
  }

  private performAutoRestart(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.stopRequested) return;

    const restartCount = agent.restartCount;
    const onPtyReady = agent.onPtyReady;

    // Cleanup old PTY, config, and heartbeat
    if (agent.heartbeatTimer) {
      clearInterval(agent.heartbeatTimer);
      agent.heartbeatTimer = null;
    }
    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    this.agents.delete(agentId);

    console.log(
      `[Agent:${agentId}] Performing auto-restart (attempt ${restartCount})`,
    );

    // Re-launch with resume
    // Resolve 'latest' to the actual session ID for this agent
    let resolvedSessionId: string = "latest";
    if (this.resolveSessionId && agent.cwd) {
      const resolved = this.resolveSessionId(
        agent.cwd,
        "latest",
        agent.name,
        agent.id,
      );
      resolvedSessionId = resolved ?? "new";
      console.log(
        `[Agent:${agent.id}] Auto-restart resolved 'latest' → ${resolvedSessionId}`,
      );
    }

    const newInstance = this.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      cwd: agent.cwd,
      resumeSessionId: resolvedSessionId,
      onPtyReady,
    });

    // Carry over restart count
    newInstance.restartCount = restartCount;
  }

  stop(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Mark as intentional stop before killing
    agent.stopRequested = true;
    if (agent.restartTimer) {
      clearTimeout(agent.restartTimer);
      agent.restartTimer = null;
    }
    if (agent.heartbeatTimer) {
      clearInterval(agent.heartbeatTimer);
      agent.heartbeatTimer = null;
    }

    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    agent.status = "stopped";
    agent.restartCount = 0;
    this.onStatusChange?.(agentId, "stopped");
    mainTelemetry.agentStopped(this.getMainWindow?.() ?? null, agentId, 0);
  }

  restart(agentId: string, initialPrompt?: string): AgentInstance | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Kill existing PTY + cleanup configs + heartbeat
    agent.stopRequested = true;
    if (agent.restartTimer) {
      clearTimeout(agent.restartTimer);
      agent.restartTimer = null;
    }
    if (agent.heartbeatTimer) {
      clearInterval(agent.heartbeatTimer);
      agent.heartbeatTimer = null;
    }
    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    this.agents.delete(agentId);

    // Re-launch with same params (+ optional initial prompt for dispatch restart)
    return this.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      cwd: agent.cwd,
      initialPrompt,
      onPtyReady: agent.onPtyReady,
    });
  }

  getStatus(agentId: string): AgentStatus {
    const agent = this.agents.get(agentId);
    return agent?.status ?? "stopped";
  }

  getAgent(agentId: string): AgentInstance | null {
    return this.agents.get(agentId) ?? null;
  }

  getMCPConfig(agentId: string): LaunchConfig | null {
    const agent = this.agents.get(agentId);
    return agent?.launchConfig ?? null;
  }

  getConfigGenerator(): AgentConfigGenerator {
    return this.configGenerator;
  }

  setStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.status = status;
    this.onStatusChange?.(agentId, status);
  }

  getAgentByName(name: string): AgentInstance | null {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return null;
  }

  /**
   * Remove an agent from the in-memory map (after stop).
   * Call this when deleting an agent from Firestore.
   */
  remove(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    // Stop first if still running
    if (agent.status !== "stopped" && agent.status !== "error") {
      this.stop(agentId);
    }
    this.agents.delete(agentId);
    console.log(`[AgentManager] Removed agent ${agent.name} (${agentId})`);
  }

  /**
   * Register a reconnected agent into the in-memory map so dispatch can find it.
   */
  registerReconnected(agent: {
    id: string;
    name: string;
    model: ModelType;
    role: string;
    command: string;
    cwd: string;
    ptySessionId: string;
  }): void {
    if (this.agents.has(agent.id)) return; // Already registered
    const instance: AgentInstance = {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      ptySessionId: agent.ptySessionId,
      status: "idle",
      command: agent.command,
      cwd: agent.cwd,
      restartCount: 0,
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
    };
    this.agents.set(agent.id, instance);
    console.log(
      `[AgentManager] Registered reconnected agent: ${agent.name} (${agent.id})`,
    );
  }

  listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * List agents whose injected MARBLO_PROJECT env var matches `projectId`.
   * Used by multi-window mode to scope each window's view to its own project.
   * If `projectId` is falsy or empty, returns all agents (legacy behavior).
   */
  listAgentsByProject(projectId: string | undefined): AgentInstance[] {
    if (!projectId) return this.listAgents();
    return Array.from(this.agents.values()).filter(
      (a) => a.launchConfig?.env?.MARBLO_PROJECT === projectId,
    );
  }

  stopAll(): void {
    for (const [id] of this.agents) {
      this.stop(id);
    }
    this.configGenerator.cleanupAll();
  }
}
