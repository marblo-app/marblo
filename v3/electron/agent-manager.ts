import { BrowserWindow } from "electron";
import crypto from "crypto";
import { PtyManager } from "./pty-manager";
import { AgentConfigGenerator, LaunchConfig } from "./agent-config";
import { mainTelemetry } from "./telemetry";

export type ModelType = "claude" | "gemini" | "gpt" | "antigravity" | "custom";
export type AgentStatus = "idle" | "working" | "error" | "stopped";

// --- Auto-restart constants ---
const MAX_RESTARTS = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30_000;
// "Fast fail" threshold — if the agent process exits within this window
// after spawning, treat it as a config / binary-not-found problem rather
// than a transient crash. Restart up to FAST_FAIL_MAX times then give up,
// so a misconfigured Codex / Gemini binary doesn't burn 5 restart slots
// trying the same broken setup.
const FAST_FAIL_WINDOW_MS = 2_000;
const FAST_FAIL_MAX = 1;

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
  /** Counter for *immediate* exits (within FAST_FAIL_WINDOW_MS of spawn).
   * Capped by FAST_FAIL_MAX so misconfiguration can't burn the full
   * restart budget. */
  fastFailCount: number;
  /** epoch-ms timestamp of the most recent spawn (initial or restart).
   * Used to classify exit-on-startup vs runtime crash. */
  spawnedAt: number;
  lastExitCode: number | null;
  stopRequested: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Stored so auto-restart can re-register PTY forwarding */
  onPtyReady?: (ptySessionId: string) => void;
}

/**
 * Build the prompt that gets typed into the freshly-spawned CLI.
 *
 * - Codex / Gemini / custom CLIs have no skill auto-discovery, so we
 *   prepend the role's skill file (claim/activity/review workflow,
 *   coding rules, etc.) ahead of the orchestrator's instruction. Claude
 *   Code already auto-loads `~/.claude/skills/*` so prepending is
 *   redundant for it.
 * - Strip the `mcp__marblo__` prefix that Claude Code uses for MCP tool
 *   names — Codex / Gemini expose the same tools as `claim_task`,
 *   `submit_for_review`, etc. (no `mcp__server__` prefix). The
 *   orchestrator (Claude) writes instructions in Claude-style naming;
 *   without this rewrite, Codex/Gemini agents look for the prefixed
 *   tool, fail to find it, and stop without ever calling Marblo MCP.
 */
/**
 * Interactive dialogs that some CLIs show at startup before reaching the
 * input prompt. None of them match the readiness patterns in launch(), so
 * without intervention Marblo's 10s blind fallback dumps the initial
 * prompt into the dialog as keystrokes — typically navigating a menu and
 * exiting the CLI cleanly (exit 0), which Marblo classifies as "stopped"
 * with no auto-restart.
 *
 * Each entry says: when `pattern` first appears in PTY output for an
 * agent whose model is in `applies` (or any model when omitted), send
 * `keys` to dismiss it, reset the readiness buffer, and keep waiting for
 * the real input prompt. Each entry fires at most once per agent launch.
 */
interface StartupDialogMatcher {
  pattern: RegExp;
  keys: string;
  label: string;
  applies?: ModelType[];
}

export const STARTUP_DIALOG_MATCHERS: StartupDialogMatcher[] = [
  {
    // Codex CLI (e.g. 0.128 → 0.132): "✨ Update available!" prompt.
    // "3" = "Skip until next version" — least invasive choice.
    pattern: /Skip until next version/i,
    keys: "3\r",
    label: "codex update-available",
    applies: ["gpt"],
  },
];

export function composeInitialPrompt(
  model: ModelType,
  instruction: string,
  skillContent?: string
): string {
  const isClaude = model === "claude";
  const sanitized = isClaude
    ? instruction
    : instruction.replace(/mcp__marblo__/g, "");
  if (isClaude || !skillContent) return sanitized;
  return [
    "[역할 스킬 — 아래 워크플로우와 도구 사용 규칙을 따르세요]",
    skillContent.trim(),
    "",
    "[작업 지시]",
    sanitized,
  ].join("\n");
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
    agentId: string
  ) => void;
  private onRestartAttempt?: (
    agentId: string,
    attempt: number,
    maxAttempts: number
  ) => void;
  private onRestartFailed?: (agentId: string, exitCode: number) => void;
  private getMainWindow?: () => BrowserWindow | null;
  private resolveSessionId?: (
    rootPath: string,
    requested: string,
    filterLabel?: string,
    filterAgentId?: string
  ) => string | null;

  constructor(
    ptyManager: PtyManager,
    onStatusChange?: (agentId: string, status: AgentStatus) => void,
    onSessionDetected?: (
      rootPath: string,
      sessionId: string,
      label: string,
      agentId: string
    ) => void,
    onRestartAttempt?: (
      agentId: string,
      attempt: number,
      maxAttempts: number
    ) => void,
    onRestartFailed?: (agentId: string, exitCode: number) => void,
    getMainWindow?: () => BrowserWindow | null
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
      filterAgentId?: string
    ) => string | null
  ) {
    this.resolveSessionId = resolver;
  }

  launch(params: AgentLaunchParams): AgentInstance {
    const ptySessionId = `agent-${params.id}`;

    // Resume resolution. Claude Code needs a concrete session UUID
    // (resolveSessionId converts "latest" by scanning ~/.claude/projects/).
    // Codex / Gemini take "latest" natively (codex resume --last,
    // gemini --resume latest), so we keep the sentinel and let agent-config
    // emit the right CLI flags.
    let resolvedResumeId = params.resumeSessionId;
    if (
      params.model === "claude" &&
      resolvedResumeId === "latest" &&
      this.resolveSessionId &&
      params.cwd
    ) {
      resolvedResumeId =
        this.resolveSessionId(params.cwd, "latest", params.name, params.id) ??
        undefined;
      console.log(
        `[Agent:${params.id}] Resolved 'latest' → ${
          resolvedResumeId ?? "none (new session)"
        }`
      );
    }
    const isResume =
      !!resolvedResumeId &&
      resolvedResumeId !== "new" &&
      // For Claude we treat unresolved 'latest' as no-resume (the resolve
      // step above set it to undefined when no session was found). For
      // codex/gemini 'latest' is a valid CLI sentinel and should resume.
      !(params.model === "claude" && resolvedResumeId === "latest");

    // Generate MCP config + skill file for this agent. The resume id
    // (if any) gets injected into the model-specific CLI args by
    // buildCLICommand — Claude uses --resume <UUID>, Codex uses
    // `resume --last|<UUID>` subcommand, Gemini uses --resume latest.
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
      isResume ? resolvedResumeId : undefined
    );

    if (isResume) {
      console.log(
        `[Agent:${params.id}] Resuming session: ${resolvedResumeId} (model=${params.model})`
      );
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
      mergedEnv
    );

    // Notify caller IMMEDIATELY so they can register data listeners
    // before the PTY produces any output.
    params.onPtyReady?.(ptySessionId);

    // Send initial prompt via stdin after CLI finishes booting (only for NEW sessions).
    // Uses PTY output detection instead of fixed timer to reliably detect readiness.
    if (!isResume && launchConfig.initialPrompt) {
      const prompt = composeInitialPrompt(
        params.model,
        launchConfig.initialPrompt,
        launchConfig.skillContent
      );
      let sent = false;
      const sendPrompt = () => {
        if (sent) return;
        sent = true;
        // Split text and \r so Claude Code registers Enter as a discrete
        // keystroke (single-chunk write gets paste-buffered, leaving the
        // CR inside the message body without submitting).
        this.ptyManager.writeAndSubmit(ptySessionId, prompt);
        console.log(
          `[Agent:${params.id}] Initial prompt sent (${prompt.length} chars)`
        );
      };

      // Watch PTY output for CLI readiness indicators
      // Only match patterns that confirm the CLI is actually ready for input.
      // Do NOT match `╭─+` — it also matches the "Do you trust this folder?"
      // dialog box border, and our 1500ms-delayed `\r` would confirm the
      // default ("No") and immediately kill the agent. Match only patterns
      // that appear in the post-trust input prompt.
      let outputBuffer = "";
      const readinessPatterns = [
        /\? for shortcuts/, // Claude Code: footer help text
        /Type your message/i, // Claude/Gemini: input prompt placeholder
        /Loaded \d+ MCP tool/i, // MCP tools loaded — only after trust granted
        /Ready to assist/i, // Generic CLI ready message
        /What can I help/i, // Gemini/GPT greeting
        // Codex TUI: the empty input area shows the example prompt
        // "Explain this codebase" once init finishes (post plugin-sync,
        // post trust check, post MCP startup). Verified by capturing
        // the live PTY output of `codex` 0.128. Without a codex-specific
        // pattern, Marblo would fall through to the 10s blind fallback
        // and dump the prompt into whatever dialog/state codex is in,
        // which historically caused the agent to exit cleanly without
        // ever processing the instruction.
        /Explain this codebase/i,
        /esc to interrupt/i,
      ];

      // Per-launch state for STARTUP_DIALOG_MATCHERS — fire each matcher
      // at most once. Filter by model so e.g. codex's update prompt
      // doesn't get applied to claude agents (false positive on a chat
      // message containing the same words).
      const activeMatchers = STARTUP_DIALOG_MATCHERS.filter(
        (m) => !m.applies || m.applies.includes(params.model)
      );
      const dismissed = new Set<RegExp>();

      this.ptyManager.onData(ptySessionId, (data) => {
        if (sent) return;
        outputBuffer += data;
        // Only keep last 4KB to avoid memory growth
        if (outputBuffer.length > 4096)
          outputBuffer = outputBuffer.slice(-4096);

        for (const dlg of activeMatchers) {
          if (dismissed.has(dlg.pattern)) continue;
          if (dlg.pattern.test(outputBuffer)) {
            dismissed.add(dlg.pattern);
            console.log(
              `[Agent:${params.id}] Dismissing blocking dialog: ${dlg.label}`
            );
            // Small delay so the TUI is in steady state when we type.
            setTimeout(() => {
              this.ptyManager.write(ptySessionId, dlg.keys);
            }, 300);
            // Reset buffer so the dismissed dialog's text doesn't keep
            // being re-matched against readiness patterns.
            outputBuffer = "";
            return;
          }
        }

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
          encodedPath
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
          err
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
            encodedPath
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
            err
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
      fastFailCount: 0,
      spawnedAt: Date.now(),
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
    // Capture prompt context for moat-data: hash + length only, never the
    // raw prompt. Hash lets us cluster identical prompts across agents
    // (cache-hit shape) without leaking content into BigQuery.
    const initial = params.initialPrompt;
    const promptHash = initial
      ? crypto.createHash("sha256").update(initial).digest("hex")
      : undefined;
    const promptLength = initial?.length;
    mainTelemetry.agentSpawned(
      this.getMainWindow?.() ?? null,
      params.id,
      params.name,
      params.model || "claude",
      params.role || "backend",
      spawnProjectId,
      promptHash,
      promptLength
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
      // Stale exit: the agent under this id has already been replaced by
      // a restart/relaunch. Acting on the old PTY's exit here would clean
      // up the NEW agent's MCP config file (same path: claude-mcp-<id>.json,
      // same ptySessionId string `agent-<id>`) and crash the freshly-launched
      // claude process with "Invalid MCP configuration: file not found".
      // Use object identity — comparing `agent.ptySessionId !== ptySessionId`
      // would always be false on restart since the sid is reused verbatim.
      if (agent !== instance) return;

      agent.lastExitCode = exitCode;

      // Intentional stop or clean exit → just mark stopped
      if (agent.stopRequested || exitCode === 0) {
        agent.status = "stopped";
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "stopped");
        mainTelemetry.agentStopped(
          this.getMainWindow?.() ?? null,
          params.id,
          exitCode
        );
        return;
      }

      // Classify the exit: fast-fail (likely config / binary issue) vs.
      // runtime crash (transient, worth retrying).
      const runtimeMs = Date.now() - agent.spawnedAt;
      const wasFastFail = runtimeMs < FAST_FAIL_WINDOW_MS;
      if (wasFastFail) {
        agent.fastFailCount++;
        console.warn(
          `[Agent:${agent.id}] Fast-fail (exit ${exitCode} after ${runtimeMs}ms). fastFail=${agent.fastFailCount}/${FAST_FAIL_MAX}`
        );
      }

      // Stop restarting once we've burned the fast-fail budget — it's
      // almost certainly a missing binary / bad config and another retry
      // won't help.
      const fastFailExceeded = agent.fastFailCount > FAST_FAIL_MAX;

      // Crash detected — attempt auto-restart with exponential backoff
      if (agent.restartCount < MAX_RESTARTS && !fastFailExceeded) {
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, agent.restartCount),
          BACKOFF_MAX_MS
        );
        agent.restartCount++;
        this.onRestartAttempt?.(agent.id, agent.restartCount, MAX_RESTARTS);
        mainTelemetry.agentRestarted(
          this.getMainWindow?.() ?? null,
          agent.id,
          agent.restartCount
        );
        console.log(
          `[Agent:${agent.id}] Crash detected (exit ${exitCode}). Restart ${agent.restartCount}/${MAX_RESTARTS} in ${delay}ms`
        );

        agent.restartTimer = setTimeout(() => {
          this.performAutoRestart(agent.id);
        }, delay);
      } else {
        // Max restarts exceeded OR fast-fail budget burned → error state
        agent.status = "error";
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "error");
        this.onRestartFailed?.(agent.id, exitCode);
        mainTelemetry.agentCrashed(
          this.getMainWindow?.() ?? null,
          agent.id,
          exitCode
        );
        if (fastFailExceeded) {
          console.error(
            `[Agent:${agent.id}] Aborting auto-restart — agent exited within ${FAST_FAIL_WINDOW_MS}ms ${agent.fastFailCount}x. Likely a missing binary or bad config (command="${agent.command}"). Verify the CLI is on PATH and check the agent's launch args.`
          );
        } else {
          console.error(
            `[Agent:${agent.id}] Max restarts (${MAX_RESTARTS}) exceeded. Exit code: ${exitCode}`
          );
        }
      }
    });

    return instance;
  }

  private performAutoRestart(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.stopRequested) return;

    const restartCount = agent.restartCount;
    const fastFailCount = agent.fastFailCount;
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
      `[Agent:${agentId}] Performing auto-restart (attempt ${restartCount})`
    );

    // Re-launch with resume
    // Resolve 'latest' to the actual session ID for this agent
    let resolvedSessionId: string = "latest";
    if (this.resolveSessionId && agent.cwd) {
      const resolved = this.resolveSessionId(
        agent.cwd,
        "latest",
        agent.name,
        agent.id
      );
      resolvedSessionId = resolved ?? "new";
      console.log(
        `[Agent:${agent.id}] Auto-restart resolved 'latest' → ${resolvedSessionId}`
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

    // Carry over restart counters; spawnedAt is freshly set by launch().
    newInstance.restartCount = restartCount;
    newInstance.fastFailCount = fastFailCount;
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

  /**
   * Whether the given agent has any saved CLI session in its isolated
   * home dir. Used by the reconnect path to decide if `resume --last`
   * (codex) / `--resume latest` (gemini) is safe to pass — running
   * those against an empty sessions dir errors out on some CLIs and
   * would just leave a dead PTY.
   */
  hasSavedSession(agentId: string, model: ModelType): boolean {
    return this.configGenerator.hasSavedSession(agentId, model);
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
      fastFailCount: 0,
      spawnedAt: Date.now(),
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
    };
    this.agents.set(agent.id, instance);
    console.log(
      `[AgentManager] Registered reconnected agent: ${agent.name} (${agent.id})`
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
      (a) => a.launchConfig?.env?.MARBLO_PROJECT === projectId
    );
  }

  stopAll(): void {
    for (const [id] of this.agents) {
      this.stop(id);
    }
    this.configGenerator.cleanupAll();
  }
}
