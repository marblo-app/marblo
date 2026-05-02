import fs from "fs";
import path from "path";
import os from "os";
import { PtyManager } from "./pty-manager";
import { AgentConfigGenerator, LaunchConfig } from "./agent-config";
import type { ModelType } from "./agent-manager";

export type OrchestratorStatus = "stopped" | "starting" | "running" | "error";

// --- Auto-restart constants ---
const ORCH_MAX_RESTARTS = 3;
const ORCH_BACKOFF_BASE_MS = 2000;
const ORCH_BACKOFF_MAX_MS = 30000;

export interface SessionLabel {
  label: string;
  agentId?: string;
  createdAt: number;
}

export interface OrchestratorSession {
  sessionId: string;
  ptySessionId: string;
  status: OrchestratorStatus;
  projectId: string;
  rootPath: string;
  launchConfig?: LaunchConfig;
}

/**
 * Manages the single orchestrator Claude Code session.
 * One orchestrator per app — it supervises agents via MCP tools.
 */
export class OrchestratorManager {
  private session: OrchestratorSession | null = null;
  private ptyManager: PtyManager;
  private configGenerator: AgentConfigGenerator;
  private onStatusChange?: (status: OrchestratorStatus) => void;
  // --- Auto-restart state ---
  private stopRequested = false;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLaunchArgs: {
    projectId: string;
    rootPath: string;
    bridgePort: number;
  } | null = null;
  private lastOnPtyReady?: (ptySessionId: string) => void;

  constructor(
    ptyManager: PtyManager,
    configGenerator: AgentConfigGenerator,
    onStatusChange?: (status: OrchestratorStatus) => void
  ) {
    this.ptyManager = ptyManager;
    this.configGenerator = configGenerator;
    this.onStatusChange = onStatusChange;
  }

  isRunning(): boolean {
    return (
      this.session?.status === "running" || this.session?.status === "starting"
    );
  }

  getSession(): OrchestratorSession | null {
    return this.session;
  }

  launch(
    projectId: string,
    rootPath: string,
    bridgePort: number,
    onPtyReady?: (ptySessionId: string) => void,
    resumeSessionId?: string // specific session ID or 'latest' for --continue
  ): OrchestratorSession {
    // Stop existing session if any
    if (this.session) {
      this.stop();
    }

    // Store args for auto-restart
    this.lastLaunchArgs = { projectId, rootPath, bridgePort };
    this.lastOnPtyReady = onPtyReady;
    this.stopRequested = false;

    const sessionId = `orchestrator-${Date.now()}`;
    const ptySessionId = `orch-${sessionId}`;

    this.setStatus("starting");

    // Determine resume mode
    const shouldResume = resumeSessionId || this.hasClaudeSession(rootPath);
    console.log(
      `[Orchestrator] rootPath=${rootPath}, resumeSessionId=${
        resumeSessionId || "auto"
      }, shouldResume=${!!shouldResume}`
    );

    // Generate MCP config for orchestrator (always claude)
    const launchConfig = this.configGenerator.getLaunchConfig(
      {
        id: sessionId,
        model: "claude",
        role: "orchestrator",
        command: "claude",
      },
      rootPath
    );

    // Add resume flag — always resolve to the actual session ID for the orchestrator
    if (resumeSessionId && resumeSessionId !== "new") {
      const resolvedId = this.resolveSessionId(
        rootPath,
        resumeSessionId,
        "Orchestrator"
      );
      if (resolvedId) {
        launchConfig.args.push("--resume", resolvedId);
        console.log(
          `[Orchestrator] Resuming session: ${resolvedId} (requested: ${resumeSessionId})`
        );
      } else {
        console.log(
          `[Orchestrator] No matching orchestrator session found for "${resumeSessionId}", starting new`
        );
      }
    } else if (!resumeSessionId && shouldResume) {
      // Auto-continue latest orchestrator session
      const resolvedId = this.resolveSessionId(
        rootPath,
        "latest",
        "Orchestrator"
      );
      if (resolvedId) {
        launchConfig.args.push("--resume", resolvedId);
        console.log(
          `[Orchestrator] Auto-continuing orchestrator session: ${resolvedId}`
        );
      } else {
        console.log(
          `[Orchestrator] No orchestrator session found, starting new`
        );
      }
    }

    // Inject MARBLO_BRIDGE_PORT into PTY env AND MCP config
    launchConfig.env.MARBLO_BRIDGE_PORT = String(bridgePort);

    // Also patch the MCP config file so the MCP server (node process)
    // gets MARBLO_BRIDGE_PORT — needed for spawn_agent tool
    try {
      const configContent = fs.readFileSync(
        launchConfig.mcpConfigPath,
        "utf-8"
      );
      const config = JSON.parse(configContent);
      if (config.mcpServers?.marblo?.env) {
        config.mcpServers.marblo.env.MARBLO_BRIDGE_PORT = String(bridgePort);
        config.mcpServers.marblo.env.MARBLO_PROJECT = projectId;
        fs.writeFileSync(
          launchConfig.mcpConfigPath,
          JSON.stringify(config, null, 2),
          "utf-8"
        );
      }
    } catch {
      // Ignore — config patching is best-effort
    }

    // Merge env
    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...launchConfig.env,
      MARBLO_PROJECT: projectId,
    };
    // Prevent nested Claude Code sessions
    delete mergedEnv.CLAUDECODE;

    // Create PTY
    this.ptyManager.create(
      ptySessionId,
      "Orchestrator",
      launchConfig.command,
      launchConfig.args,
      rootPath,
      mergedEnv
    );

    // Notify caller IMMEDIATELY so they can register data listeners
    onPtyReady?.(ptySessionId);

    this.session = {
      sessionId,
      ptySessionId,
      status: "starting",
      projectId,
      rootPath,
      launchConfig,
    };

    // Send initial prompt only for NEW sessions (not resumed ones)
    if (shouldResume && resumeSessionId !== "new") {
      // Resumed session — just mark as running after CLI boots
      setTimeout(() => {
        if (this.session?.ptySessionId === ptySessionId) {
          this.setStatus("running");
        }
      }, 2000);
    } else {
      // New session — send skill-based initial prompt.
      // Two-step send (text then \r after a delay): writing the prompt and
      // \r in one chunk gets paste-buffered by Claude Code, so the \r ends
      // up inside the message instead of submitting it. Splitting forces
      // Enter to register as a discrete keystroke. Readiness detection
      // mirrors agent-manager so we send only after the CLI is actually
      // accepting input.
      const initialPrompt = [
        "You are the Marblo Orchestrator Agent.",
        `Read the orchestrator skill file: use get_agent_skill("orchestrator")`,
        "Wait for user instructions.",
      ].join(" ");

      let sent = false;
      const sendPrompt = () => {
        if (sent) return;
        if (this.session?.ptySessionId !== ptySessionId) return;
        sent = true;
        this.ptyManager.writeAndSubmit(ptySessionId, initialPrompt);
        this.setStatus("running");
      };

      let outputBuffer = "";
      // Patterns must match ONLY the actual input prompt — never the trust
      // folder dialog which also uses ╭─╮ box borders. If we match the
      // trust dialog and send `\r` 1500ms later, it confirms the default
      // ("No") and exits Claude Code immediately.
      const readinessPatterns = [
        /\? for shortcuts/, // Claude Code: footer help (only in input prompt)
        /Type your message/i, // Input prompt placeholder
        /Loaded \d+ MCP tool/i, // MCP tools loaded — only after trust granted
      ];
      this.ptyManager.onData(ptySessionId, (data) => {
        if (sent) return;
        outputBuffer += data;
        if (outputBuffer.length > 4096)
          outputBuffer = outputBuffer.slice(-4096);
        for (const pattern of readinessPatterns) {
          if (pattern.test(outputBuffer)) {
            // Wait for the input prompt to fully render before sending.
            setTimeout(sendPrompt, 1500);
            return;
          }
        }
      });

      // Fallback: send after 10s even if no readiness pattern matched.
      setTimeout(sendPrompt, 10000);
    }

    // Detect new session and auto-label it
    const existingIds = new Set(this.listSessions(rootPath).map((s) => s.id));
    setTimeout(() => {
      try {
        const current = this.listSessions(rootPath);
        const newSession = current.find((s) => !existingIds.has(s.id));
        if (newSession) {
          this.saveSessionLabel(rootPath, newSession.id, "Orchestrator");
        }
      } catch {
        /* best-effort */
      }
    }, 5000);

    // Monitor PTY exit — auto-restart on crash
    this.ptyManager.onExit(ptySessionId, (exitCode) => {
      if (this.session?.ptySessionId !== ptySessionId) return;

      // Intentional stop or clean exit
      if (this.stopRequested || exitCode === 0) {
        this.setStatus("stopped");
        this.configGenerator.cleanup(sessionId);
        return;
      }

      // Crash detected — attempt auto-restart with backoff
      if (this.restartCount < ORCH_MAX_RESTARTS && this.lastLaunchArgs) {
        const delay = Math.min(
          ORCH_BACKOFF_BASE_MS * Math.pow(2, this.restartCount),
          ORCH_BACKOFF_MAX_MS
        );
        this.restartCount++;
        console.log(
          `[Orchestrator] Crash (exit ${exitCode}). Restart ${this.restartCount}/${ORCH_MAX_RESTARTS} in ${delay}ms`
        );

        this.restartTimer = setTimeout(() => {
          if (this.stopRequested || !this.lastLaunchArgs) return;
          const {
            projectId: pId,
            rootPath: rp,
            bridgePort: bp,
          } = this.lastLaunchArgs;
          this.configGenerator.cleanup(sessionId);
          this.session = null;
          this.launch(pId, rp, bp, this.lastOnPtyReady, "latest");
        }, delay);
      } else {
        // Max restarts exceeded
        this.setStatus("error");
        this.configGenerator.cleanup(sessionId);
        console.error(
          `[Orchestrator] Max restarts (${ORCH_MAX_RESTARTS}) exceeded. Exit code: ${exitCode}`
        );
      }
    });

    return this.session;
  }

  stop(): void {
    if (!this.session) return;

    this.stopRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const { ptySessionId, sessionId } = this.session;
    this.ptyManager.kill(ptySessionId);
    this.configGenerator.cleanup(sessionId);
    this.setStatus("stopped");
    this.session = null;
    this.restartCount = 0;
  }

  restart(
    projectId: string,
    rootPath: string,
    bridgePort: number
  ): OrchestratorSession {
    this.stop();
    return this.launch(projectId, rootPath, bridgePort);
  }

  getStatus(): OrchestratorStatus {
    return this.session?.status ?? "stopped";
  }

  /**
   * List available Claude Code sessions for a project root.
   */
  // --- Session label helpers ---

  private getLabelsPath(rootPath: string): string {
    const encodedPath = rootPath.replace(/\//g, "-");
    return path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
      "marblo-labels.json"
    );
  }

  private readLabels(rootPath: string): Record<string, SessionLabel> {
    try {
      return JSON.parse(fs.readFileSync(this.getLabelsPath(rootPath), "utf-8"));
    } catch {
      return {};
    }
  }

  saveSessionLabel(
    rootPath: string,
    sessionUuid: string,
    label: string,
    agentId?: string
  ): void {
    const labels = this.readLabels(rootPath);
    labels[sessionUuid] = { label, agentId, createdAt: Date.now() };
    try {
      fs.writeFileSync(
        this.getLabelsPath(rootPath),
        JSON.stringify(labels, null, 2),
        "utf-8"
      );
    } catch {
      /* best-effort */
    }
  }

  listSessions(rootPath: string): {
    id: string;
    updatedAt: number;
    sizeKB: number;
    label?: string;
    agentId?: string;
  }[] {
    try {
      const encodedPath = rootPath.replace(/\//g, "-");
      const sessionsDir = path.join(
        os.homedir(),
        ".claude",
        "projects",
        encodedPath
      );
      if (!fs.existsSync(sessionsDir)) return [];

      const labels = this.readLabels(rootPath);

      return fs
        .readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const stat = fs.statSync(path.join(sessionsDir, f));
          const id = f.replace(".jsonl", "");
          return {
            id,
            updatedAt: stat.mtimeMs,
            sizeKB: Math.round(stat.size / 1024),
            label: labels[id]?.label,
            agentId: labels[id]?.agentId,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /**
   * Resolve 'latest' or a specific session ID, filtered by label or agentId.
   * For orchestrator: filterLabel='Orchestrator'
   * For agents: filterLabel=agentName, filterAgentId=agent.id
   */
  resolveSessionId(
    rootPath: string,
    requested: string,
    filterLabel?: string,
    filterAgentId?: string
  ): string | null {
    if (requested !== "latest") return requested; // specific UUID, return as-is

    const sessions = this.listSessions(rootPath);
    // Filter by label or agentId (sessions are already sorted by updatedAt desc)
    const match = sessions.find(
      (s) =>
        (filterAgentId && s.agentId === filterAgentId) ||
        (filterLabel && s.label === filterLabel)
    );
    return match?.id ?? null;
  }

  private hasClaudeSession(rootPath: string): boolean {
    return this.listSessions(rootPath).length > 0;
  }

  private setStatus(status: OrchestratorStatus): void {
    if (this.session) {
      this.session.status = status;
    }
    this.onStatusChange?.(status);
  }
}
