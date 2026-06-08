import fs from "fs";
import path from "path";
import os from "os";
import { encodeClaudeProjectDir, claudeProjectDir } from "./claude-paths";
import { PtyManager } from "./pty-manager";
import { AgentConfigGenerator, LaunchConfig } from "./agent-config";
import type { ModelType } from "./agent-manager";
import { contextForKind } from "./mcp-server/context";

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
 * Detects summary-only stub JSONLs. Claude Code occasionally writes a
 * single `{"type":"summary",...,"leafUuid":...}` line when a session
 * aborts before any real turn (e.g., model 404 error). `--resume` on
 * such a UUID fails with "No conversation found" and exits 1, which
 * sends the orchestrator into a restart loop on the same stale label
 * — and the same UUID can also leak into agent reconnect via the
 * labels file, which is why this is module-level (shared with
 * reconnect-manager). We read at most the first few KB — sufficient
 * to spot a real user or assistant message and bail out early on
 * healthy sessions.
 */
export function isSummaryOnlyJsonl(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    const readBytes = Math.min(stat.size, 16 * 1024);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, 0);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n").filter(Boolean);
    if (lines.length === 0) return true;
    for (const line of lines) {
      try {
        const j = JSON.parse(line);
        if (j.type && j.type !== "summary") return false;
      } catch {
        // Malformed line — assume real session and skip filter.
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The orchestrator's Claude session is always seeded with this exact opening
 * line (see launch()'s initialPrompt). No agent or user session ever starts
 * with it, so it's a reliable, label-independent fingerprint for "this is the
 * orchestrator's own session". We use it both to label precisely in a busy
 * project dir (where agents + background jobs write JSONLs concurrently) and
 * to recover the prior session when marblo-labels.json is missing — which is
 * the common case in practice, and exactly why label-only matching failed.
 */
export const ORCHESTRATOR_PROMPT_SIGNATURE =
  "You are the Marblo Orchestrator Agent";

/**
 * True if one of the first few user-role messages in a session JSONL starts
 * with `signature`. Reads a bounded prefix — the opening turn sits near the
 * top even with the newer metadata-prefixed session format. Checks a few
 * user turns (not just the first) to tolerate a leading synthetic user line.
 */
export function firstUserMessageStartsWith(
  filePath: string,
  signature: string
): boolean {
  try {
    const stat = fs.statSync(filePath);
    const readBytes = Math.min(stat.size, 256 * 1024);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, 0);
    fs.closeSync(fd);
    let userTurnsSeen = 0;
    for (const line of buf.toString("utf-8").split("\n")) {
      if (!line.trim()) continue;
      let j: { type?: string; message?: { content?: unknown } };
      try {
        j = JSON.parse(line);
      } catch {
        continue; // truncated trailing line — skip
      }
      if (j.type !== "user") continue;
      const content = j.message?.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content))
        text = content
          .map((c) =>
            typeof c === "string" ? c : (c as { text?: string })?.text ?? ""
          )
          .join(" ");
      if (text.trimStart().startsWith(signature)) return true;
      if (++userTurnsSeen >= 3) return false;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True if `sessionId` is an orchestrator session (its opening turn is the
 * orchestrator prompt). Used by agent reconnect to make sure an agent never
 * adopts the orchestrator's session via its "most-recent unclaimed" fallback.
 */
export function isOrchestratorSession(
  rootPath: string,
  sessionId: string
): boolean {
  const p = path.join(claudeProjectDir(rootPath), `${sessionId}.jsonl`);
  return firstUserMessageStartsWith(p, ORCHESTRATOR_PROMPT_SIGNATURE);
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

  // kind: 같은 projectId 안에서 여러 orchestrator (board, mission) 를 분리하기 위한
  // 식별 prefix. 'board' (default) 외에 'mission' 등을 주면 sessionId 가
  // `orchestrator-${kind}-${projectId}` 가 되어 Firestore 도큐/MCP config/세션
  // 자동 resume 이 서로 충돌하지 않는다.
  private readonly kind: string;

  constructor(
    ptyManager: PtyManager,
    configGenerator: AgentConfigGenerator,
    onStatusChange?: (status: OrchestratorStatus) => void,
    kind: string = "board"
  ) {
    this.ptyManager = ptyManager;
    this.configGenerator = configGenerator;
    this.onStatusChange = onStatusChange;
    this.kind = kind;
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

    // Stable, project-scoped ID. Used as MARBLO_AGENT_ID, MCP config filename,
    // and the Firestore agents/* doc key — so the renderer can upsert one
    // canonical orchestrator doc per project instead of leaking a fresh row
    // on every relaunch.
    // kind 가 'board' (default) 면 기존 호환을 위해 prefix 없이, 그 외 (mission 등)
    // 는 별도 sessionId 로 board 와 분리.
    const sessionId =
      this.kind === "board"
        ? `orchestrator-${projectId}`
        : `orchestrator-${this.kind}-${projectId}`;
    // PTY id stays unique per launch so a stale auto-restart timer can't
    // attach to a freshly spawned PTY.
    const ptySessionId = `orch-${sessionId}-${Date.now()}`;

    this.setStatus("starting");

    // Determine resume mode.
    // board (default kind) 는 기존대로 rootPath 에 세션 있으면 auto-resume.
    // 다른 kind (mission 등) 는 board 와 같은 세션을 동시에 resume 하면 충돌
    // (PTY 가 비어 보이는 증상) → 명시적 resumeSessionId 가 주어진 경우에만 resume.
    const allowAutoResume = this.kind === "board";
    const shouldResume =
      resumeSessionId || (allowAutoResume && this.hasClaudeSession(rootPath));
    console.log(
      `[Orchestrator:${this.kind}] rootPath=${rootPath}, resumeSessionId=${
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

    // Resume must be scoped to THIS orchestrator kind. Board sessions are
    // labeled "Orchestrator", mission sessions "Orchestrator-mission". The old
    // hardcoded "Orchestrator" here made a mission orchestrator resume the
    // BOARD's claude session (two PTYs sharing one session → the mission PTY
    // renders blank), and crash auto-restart (launch(..., "latest")) hit the
    // same cross-contamination.
    const labelTarget =
      this.kind === "board" ? "Orchestrator" : `Orchestrator-${this.kind}`;

    // Add resume flag — always resolve to the actual session ID for the orchestrator
    if (resumeSessionId && resumeSessionId !== "new") {
      const resolvedId = this.resolveSessionId(
        rootPath,
        resumeSessionId,
        labelTarget
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
      // Auto-continue latest orchestrator session (kind-scoped label)
      const resolvedId = this.resolveSessionId(rootPath, "latest", labelTarget);
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
        const context = contextForKind(this.kind);
        if (context) {
          config.mcpServers.marblo.env.MARBLO_CONTEXT = context;
        }
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

    // Detect new session and auto-label it.
    //
    // labelTarget (computed above, kind-scoped): board keeps the bare
    // "Orchestrator" label the renderer's auto-reconnect lookup matches on;
    // other kinds get a suffixed label so two orchestrators sharing a rootPath
    // don't claim each other's session.

    // Resume of a known session id — (re)label it directly so the label
    // survives even if it was ever lost. Cheap and idempotent.
    if (
      resumeSessionId &&
      resumeSessionId !== "new" &&
      resumeSessionId !== "latest"
    ) {
      const resolvedId = this.resolveSessionId(rootPath, resumeSessionId);
      if (resolvedId) {
        this.saveSessionLabel(rootPath, resolvedId, labelTarget);
        this.saveOrchSessionId(rootPath, resolvedId);
      }
    }

    // New session — poll for the freshly created jsonl and label it. The
    // previous single 5s snapshot via listSessions failed ~100% of the
    // time: orchestrator startup loads the marblo MCP (a node process)
    // before the initial prompt is sent, so the first real message — and
    // sometimes the jsonl file itself — lands well after 5s, and
    // listSessions filters summary-only/empty stubs out entirely. We use
    // raw readdir (no summary filter, matching the agent detector) and
    // retry over ~40s so a slow-booting session still gets labeled.
    const existingRawIds = new Set(this.listRawSessionIds(rootPath));
    this.detectAndLabelNewSession(
      rootPath,
      ptySessionId,
      existingRawIds,
      labelTarget
    );

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
    const encodedPath = encodeClaudeProjectDir(rootPath);
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
      const encodedPath = encodeClaudeProjectDir(rootPath);
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
        .filter((f) => !isSummaryOnlyJsonl(path.join(sessionsDir, f)))
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

  /**
   * Raw session ids from the project dir — NO summary-only filter, unlike
   * listSessions. A just-created session jsonl is often empty or a summary
   * stub; the filtered list would hide it, which is exactly why orchestrator
   * labeling used to miss the new session. Mirrors the agent detector.
   */
  private listRawSessionIds(rootPath: string): string[] {
    try {
      const encodedPath = encodeClaudeProjectDir(rootPath);
      const sessionsDir = path.join(
        os.homedir(),
        ".claude",
        "projects",
        encodedPath
      );
      if (!fs.existsSync(sessionsDir)) return [];
      return fs
        .readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.replace(".jsonl", ""));
    } catch {
      return [];
    }
  }

  /**
   * Poll the project dir until a new session id (not in `existingIds`)
   * appears, then persist `label` for it. Retries over ~40s because the
   * orchestrator's first jsonl can lag far behind a fixed delay (slow MCP
   * load + readiness-gated initial prompt). Stops early if the launch was
   * superseded (relaunch/stop) so a stale timer can't mislabel.
   */
  private detectAndLabelNewSession(
    rootPath: string,
    ptySessionId: string,
    existingIds: Set<string>,
    label: string
  ): void {
    const MAX_ATTEMPTS = 20;
    const INTERVAL_MS = 2000;
    let attempts = 0;

    const encodedPath = encodeClaudeProjectDir(rootPath);
    const dir = path.join(os.homedir(), ".claude", "projects", encodedPath);

    const tick = () => {
      // Superseded by a newer launch/stop — bail.
      if (this.session?.ptySessionId !== ptySessionId) return;
      attempts++;

      // Only label a NEW session whose opening turn is the orchestrator
      // prompt. Picking "the newest new file" mislabels in shared project
      // dirs where agents and background jobs stream JSONLs at the same
      // time; the signature check pins it to the orchestrator's own session.
      // It also means we just keep polling until the prompt is actually
      // written (slow MCP boot) instead of labeling an empty stub.
      const match = this.listRawSessionIds(rootPath)
        .filter((id) => !existingIds.has(id))
        .find((id) =>
          firstUserMessageStartsWith(
            path.join(dir, `${id}.jsonl`),
            ORCHESTRATOR_PROMPT_SIGNATURE
          )
        );
      if (match) {
        this.saveSessionLabel(rootPath, match, label);
        this.saveOrchSessionId(rootPath, match);
        console.log(
          `[Orchestrator:${this.kind}] Labeled session ${match} as "${label}" (attempt ${attempts})`
        );
        return;
      }

      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tick, INTERVAL_MS);
      } else {
        console.warn(
          `[Orchestrator:${this.kind}] No orchestrator session detected after ${attempts} attempts — left unlabeled (content-scan resolver still recovers it)`
        );
      }
    };

    setTimeout(tick, INTERVAL_MS);
  }

  /**
   * Best previous-orchestrator-session id for `rootPath`, or null.
   *
   * Tries the fast label path first, then falls back to a content scan that
   * fingerprints the orchestrator's own session by its opening prompt. The
   * fallback is what makes reconnect work when marblo-labels.json is absent
   * (the usual case) — mirroring how agent reconnect tolerates a missing
   * labels file. When found by content we (re)write the label so the next
   * lookup hits the fast path.
   */
  resolveOrchestratorResumeId(rootPath: string): string | null {
    const labelTarget =
      this.kind === "board" ? "Orchestrator" : `Orchestrator-${this.kind}`;

    // 1) Dedicated stable-id store — the agy-style robust path: a direct
    //    kind → claude-session-UUID mapping, O(1) and unambiguous, no shared
    //    dir scan. Validate the session still exists and isn't a summary-only
    //    stub before trusting it.
    const stored = this.readOrchStore(rootPath)[this.kind]?.sessionId;
    if (stored && this.isResumableSession(rootPath, stored)) return stored;

    // 2) Label fast path (legacy + self-written by detection).
    const byLabel = this.resolveSessionId(rootPath, "latest", labelTarget);
    if (byLabel && this.isResumableSession(rootPath, byLabel)) {
      this.saveOrchSessionId(rootPath, byLabel);
      return byLabel;
    }

    // 3) Content-signature recovery — the common first-run / post-upgrade
    //    case where neither store nor label exists yet. Self-heal both.
    const byContent = this.findOrchestratorSessionByContent(rootPath);
    if (byContent) {
      this.saveSessionLabel(rootPath, byContent, labelTarget);
      this.saveOrchSessionId(rootPath, byContent);
      console.log(
        `[Orchestrator:${this.kind}] Recovered prior session ${byContent} by content signature → persisted (store + label)`
      );
    }
    return byContent;
  }

  /**
   * Dedicated orchestrator-session store, keyed by `kind` within the project
   * dir — the same robustness model the non-Claude agents rely on (a stable
   * id → concrete session mapping in a private file, not a scan of the shared
   * session dir). board/mission live under distinct keys.
   */
  private getOrchStorePath(rootPath: string): string {
    const encodedPath = encodeClaudeProjectDir(rootPath);
    return path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
      "marblo-orch-sessions.json"
    );
  }

  private readOrchStore(
    rootPath: string
  ): Record<string, { sessionId: string; updatedAt: number }> {
    try {
      return JSON.parse(
        fs.readFileSync(this.getOrchStorePath(rootPath), "utf-8")
      );
    } catch {
      return {};
    }
  }

  /** Persist this orchestrator's claude session id under its `kind` key. */
  saveOrchSessionId(rootPath: string, claudeSessionId: string): void {
    const store = this.readOrchStore(rootPath);
    store[this.kind] = { sessionId: claudeSessionId, updatedAt: Date.now() };
    try {
      fs.writeFileSync(
        this.getOrchStorePath(rootPath),
        JSON.stringify(store, null, 2),
        "utf-8"
      );
    } catch {
      /* best-effort */
    }
  }

  /** True if `id` is a real, resumable session (exists, not a summary stub). */
  private isResumableSession(rootPath: string, id: string): boolean {
    const encodedPath = encodeClaudeProjectDir(rootPath);
    const p = path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
      `${id}.jsonl`
    );
    return fs.existsSync(p) && !isSummaryOnlyJsonl(p);
  }

  /**
   * Most-recently-modified session whose opening turn is the orchestrator
   * prompt. Label-independent, so it survives a missing/stale labels file.
   */
  private findOrchestratorSessionByContent(rootPath: string): string | null {
    try {
      const encodedPath = encodeClaudeProjectDir(rootPath);
      const dir = path.join(os.homedir(), ".claude", "projects", encodedPath);
      if (!fs.existsSync(dir)) return null;
      const candidates = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const p = path.join(dir, f);
          return {
            id: f.replace(".jsonl", ""),
            p,
            mtime: fs.statSync(p).mtimeMs,
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (const c of candidates) {
        if (firstUserMessageStartsWith(c.p, ORCHESTRATOR_PROMPT_SIGNATURE)) {
          return c.id;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private setStatus(status: OrchestratorStatus): void {
    if (this.session) {
      this.session.status = status;
    }
    this.onStatusChange?.(status);
  }
}
