import fs from "fs";
import path from "path";
import os from "os";
import { encodeClaudeProjectDir, claudeProjectDir } from "./claude-paths";
import { PtyManager, type DangerEvent } from "./pty-manager";
import {
  AgentConfigGenerator,
  LaunchConfig,
  resolveOrchestratorModel,
  orchestratorCommandForModel,
} from "./agent-config";
import { contextForKind } from "./mcp-server/context";
import { YOLO_FLAG, telegramChannelLaunchFlags } from "./telegram-channels";

export type OrchestratorStatus = "stopped" | "starting" | "running" | "error";

// --- Auto-restart constants ---
const ORCH_MAX_RESTARTS = 3;
const ORCH_BACKOFF_BASE_MS = 2000;
const ORCH_BACKOFF_MAX_MS = 30000;

// --- Concurrent-resume guard ---
// Two orchestrator instances — e.g. two worktrees in the fleet, which are
// SEPARATE OS processes — that `--resume` the SAME claude session id at the
// same time make Claude Code render the second PTY blank: the user's existing
// conversation appears to "vanish". We take an advisory, cross-process lock on
// the resumed session id in a per-project lock file. Liveness is decided
// PRIMARILY by whether the owning PID is still running (same host), with the
// TTL only as a backstop against PID reuse after an uncaught crash.
const ORCH_RESUME_LOCK_TTL_MS = 10 * 60 * 1000;

interface OrchResumeLock {
  ptySessionId: string;
  kind: string;
  pid: number;
  updatedAt: number;
}

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
  // The concrete claude session UUID this PTY is bound to (resumed OR the
  // freshly-detected one). Tracked so we can release the cross-process resume
  // lock on exit/stop. Undefined until a session id is known.
  claudeSessionId?: string;
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
  signature: string,
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
            typeof c === "string" ? c : ((c as { text?: string })?.text ?? ""),
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
  sessionId: string,
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
  // crash auto-restart 가 동일 미션 세션을 이어가도록 마지막 ownerMissionId 보관.
  private lastOwnerMissionId: string | null = null;

  // kind: 같은 projectId 안에서 여러 orchestrator (board, mission) 를 분리하기 위한
  // 식별 prefix. 'board' (default) 외에 'mission' 등을 주면 sessionId 가
  // `orchestrator-${kind}-${projectId}` 가 되어 Firestore 도큐/MCP config/세션
  // 자동 resume 이 서로 충돌하지 않는다.
  private readonly kind: string;

  // 현재 이 매니저가 운전 중인 미션 id (kind="mission" 전용). launch 시 주입되어
  // orch-session store 를 mission 단위로 키잉(`mission:${missionId}`)하는 데 쓴다.
  // 이게 있어야 "새 미션 시작 = fresh, 같은 미션 이어가기 = resume" 가 성립한다 —
  // 예전엔 프로젝트 단위 단일 "mission" 세션을 무조건 resume 해, 새 미션이 직전
  // (아카이브된) 미션 대화를 이어받아 /compact + 옛 컨텍스트로 첫 스텝이 막혔다.
  private currentMissionId: string | null = null;

  // 부팅 프롬프트(launch 시 자동 주입)와 conductor 의 첫 step grant 가 같은 PTY 에
  // 동시 writeAndSubmit 되면 bracketed-paste 버퍼가 병합되고 CR(Enter)이 유실돼
  // 첫 스텝이 stall 한다. 그래서 모든 외부 주입(injectMessage)은
  //   1) bootGate — 부팅 프롬프트 제출 사이클이 끝난 뒤에만, 그리고
  //   2) injectChain — 서로 직렬화해서(겹치지 않게)
  // PTY 로 보낸다. 부팅 프롬프트 자체는 launch 가 직접 writeAndSubmit 하고,
  // bootGate 는 그 제출 직후 일정 시간 뒤 resolve 된다.
  private bootGate: Promise<void> = Promise.resolve();
  private resolveBootGate: () => void = () => {};
  private injectChain: Promise<void> = Promise.resolve();

  // --- Safety guard (MVP-P0-1) ---
  // The orchestrator drives the MAIN checkout (not a sandboxed worktree), so a
  // dangerous command injected into its PTY is the highest-risk path. We record
  // detections that target this orchestrator's session for visibility.
  private dangerWarnings: DangerEvent[] = [];
  private static readonly MAX_DANGER_WARNINGS = 100;

  constructor(
    ptyManager: PtyManager,
    configGenerator: AgentConfigGenerator,
    onStatusChange?: (status: OrchestratorStatus) => void,
    kind: string = "board",
  ) {
    this.ptyManager = ptyManager;
    this.configGenerator = configGenerator;
    this.onStatusChange = onStatusChange;
    this.kind = kind;

    // Connect the danger-detection hook to the injection path. The chokepoint
    // lives in PtyManager.writeAndSubmit (covers boot prompt + injectMessage);
    // here we just record the ones aimed at our own session.
    this.ptyManager.onDanger((e) => {
      if (e.sessionId !== this.session?.ptySessionId) return;
      this.dangerWarnings.push(e);
      if (
        this.dangerWarnings.length > OrchestratorManager.MAX_DANGER_WARNINGS
      ) {
        this.dangerWarnings.shift();
      }
      console.warn(
        `[OrchestratorManager:${this.kind}] dangerous command ${
          e.blocked ? "BLOCKED" : "detected"
        } on orchestrator PTY (${e.match.severity}: ${e.match.pattern})`,
      );
    });
  }

  /** Dangerous-command detections recorded for this orchestrator's PTY. */
  getDangerWarnings(): DangerEvent[] {
    return [...this.dangerWarnings];
  }

  isRunning(): boolean {
    return (
      this.session?.status === "running" || this.session?.status === "starting"
    );
  }

  getSession(): OrchestratorSession | null {
    return this.session;
  }

  /**
   * conductor → 미션 오케 PTY 로 메시지(스텝 grant 등)를 주입한다. 직접
   * writeAndSubmit 을 호출하면 부팅 프롬프트와 같은 PTY 에 동시 write 되어
   * bracketed-paste 버퍼가 병합되고 Enter 가 유실된다(첫 스텝 stall). 그래서
   *   - bootGate: 부팅 프롬프트 제출 사이클이 끝난 뒤에만,
   *   - injectChain: 직전 주입의 제출이 끝난 뒤에(직렬화)
   * writeAndSubmit 한다. 게이트는 launch 마다 새로 걸린다.
   */
  injectMessage(text: string): Promise<void> {
    const expectPty = this.session?.ptySessionId;
    this.injectChain = this.injectChain.then(async () => {
      await this.bootGate;
      const cur = this.session?.ptySessionId;
      // 게이트 대기 중 세션이 바뀌거나(미션 전환) 멈췄으면 주입 취소.
      if (!cur || cur !== expectPty) return;
      this.ptyManager.writeAndSubmit(cur, text);
      // 다음 주입이 이 메시지의 제출 사이클과 겹치지 않도록 여유를 둔다(직렬화).
      await new Promise((r) => setTimeout(r, 2500));
    });
    return this.injectChain;
  }

  launch(
    projectId: string,
    rootPath: string,
    bridgePort: number,
    onPtyReady?: (ptySessionId: string) => void,
    resumeSessionId?: string, // specific session ID or 'latest' for --continue
    ownerMissionId?: string, // kind="mission" 운전 대상 미션 id (세션 store 키잉용)
  ): OrchestratorSession {
    // Stop existing session if any
    if (this.session) {
      this.stop();
    }

    // Store args for auto-restart
    this.lastLaunchArgs = { projectId, rootPath, bridgePort };
    this.lastOnPtyReady = onPtyReady;
    this.stopRequested = false;
    // stop() 이 null 로 리셋하므로 그 다음에 설정한다. crash auto-restart 는 같은
    // 미션 컨텍스트를 유지해야 하므로 lastOwnerMissionId 로도 보관해 재주입한다.
    this.currentMissionId = ownerMissionId ?? null;
    this.lastOwnerMissionId = ownerMissionId ?? null;

    // 이 launch 의 주입 게이트를 새로 건다. bootGate 는 부팅 프롬프트 제출(또는 resume
    // settle) 후 resolve 되고, injectChain 은 직렬화 체인을 리셋한다. (resolve 되기
    // 전까지 injectMessage 의 grant 주입은 대기 → 부팅과 인터리브되지 않는다.)
    this.bootGate = new Promise<void>((resolve) => {
      this.resolveBootGate = resolve;
    });
    this.injectChain = Promise.resolve();

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
      }, shouldResume=${!!shouldResume}`,
    );

    // Generate MCP config for orchestrator. Model is env-selectable via
    // MARBLO_ORCHESTRATOR_MODEL (default "claude"). The default path resolves
    // to model:"claude"/command:"claude" — byte-identical to the previous
    // hardcoding, so current behavior is unchanged. Selecting codex/local here
    // only constructs the launchConfig for that binary; the orchestrator's
    // actual readiness/prompt/session wiring for non-claude models is a
    // separate follow-up (backlog IUj7YTFqJVZvi9AbtTPf).
    const orchestratorModel = resolveOrchestratorModel();
    const launchConfig = this.configGenerator.getLaunchConfig(
      {
        id: sessionId,
        model: orchestratorModel,
        role: "orchestrator",
        command: orchestratorCommandForModel(orchestratorModel),
      },
      rootPath,
    );

    // ── Telegram Channels 스폰 주입 (텔레그램 T1) ──────────────────────
    // ★신규 오케스트레이터는 욜로(--dangerously-skip-permissions)와 채널 플래그
    // (--channels plugin:telegram@...)를 함께 물고 시작한다. claude 의 욜로 플래그는
    // buildCLICommand 가 이미 주입하지만(채널 인바운드 무인 트리거 전제), 여기서
    // 존재를 한 번 더 보장한다 — 채널을 켜면서 욜로가 빠지는 일이 없도록.
    // 채널 플래그는 그 프로젝트의 채널 연결이 "활성"(enabled && 프리플라이트 통과)
    // 일 때만 주입한다. chatId 가 비어 활성 불가면 telegramChannelLaunchFlags 가
    // 빈 배열을 돌려주므로 채널 없이 정상 부팅한다.
    if (!launchConfig.args.includes(YOLO_FLAG)) {
      launchConfig.args.unshift(YOLO_FLAG);
    }
    const channelFlags = telegramChannelLaunchFlags(projectId);
    if (channelFlags.length > 0) {
      launchConfig.args.push(...channelFlags);
      console.log(
        `[Orchestrator:${
          this.kind
        }] Telegram channel active → injecting ${channelFlags.join(
          " ",
        )} (+ ${YOLO_FLAG})`,
      );
    }

    // Resume must be scoped to THIS orchestrator kind. Board sessions are
    // labeled "Orchestrator", mission sessions "Orchestrator-mission". The old
    // hardcoded "Orchestrator" here made a mission orchestrator resume the
    // BOARD's claude session (two PTYs sharing one session → the mission PTY
    // renders blank), and crash auto-restart (launch(..., "latest")) hit the
    // same cross-contamination.
    const labelTarget =
      this.kind === "board" ? "Orchestrator" : `Orchestrator-${this.kind}`;

    // Resolve the concrete session id we intend to resume (if any). A null
    // candidate means "no prior session matched" → start fresh.
    let resumeCandidate: string | null = null;
    if (resumeSessionId && resumeSessionId !== "new") {
      resumeCandidate = this.resolveSessionId(
        rootPath,
        resumeSessionId,
        labelTarget,
      );
      if (!resumeCandidate) {
        console.log(
          `[Orchestrator] No matching orchestrator session found for "${resumeSessionId}", starting new`,
        );
      }
    } else if (!resumeSessionId && shouldResume) {
      // Auto-continue latest orchestrator session (kind-scoped label)
      resumeCandidate = this.resolveSessionId(rootPath, "latest", labelTarget);
      if (!resumeCandidate) {
        console.log(
          `[Orchestrator] No orchestrator session found, starting new`,
        );
      }
    }

    // Concurrent-resume guard. Only attach `--resume` if no OTHER live
    // orchestrator process already holds this session. A second `--resume` of
    // the same id blanks both PTYs and orphans the user's visible conversation
    // — exactly the "기존 세션 안보임(blank PTY)" symptom. When the lock is
    // taken we start a FRESH session instead (the prior one stays intact for
    // its real owner). `resumedSessionId` (not `shouldResume`) now gates the
    // initial-prompt send below, so a fall-back-to-fresh correctly seeds the
    // boot prompt — the old `shouldResume` gate skipped the prompt whenever a
    // resume was *requested* even if no session was actually resumed.
    let resumedSessionId: string | null = null;
    if (resumeCandidate) {
      if (this.acquireResumeLock(rootPath, resumeCandidate, ptySessionId)) {
        launchConfig.args.push("--resume", resumeCandidate);
        resumedSessionId = resumeCandidate;
        console.log(
          `[Orchestrator:${
            this.kind
          }] Resuming session: ${resumeCandidate} (requested: ${
            resumeSessionId ?? "auto"
          })`,
        );
      } else {
        console.warn(
          `[Orchestrator:${this.kind}] Session ${resumeCandidate} is already attached by another live orchestrator instance — starting a FRESH session to avoid a blank PTY (concurrent --resume guard).`,
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
        "utf-8",
      );
      const config = JSON.parse(configContent);
      if (config.mcpServers?.marblo?.env) {
        config.mcpServers.marblo.env.MARBLO_BRIDGE_PORT = String(bridgePort);
        config.mcpServers.marblo.env.MARBLO_PROJECT = projectId;
        // 미션 오케는 MARBLO_CONTEXT 를 '운전 중인 미션 id' 로 스코프해야 MCP 서버가
        // create_task/add_activity 를 missionId 로 태깅하고 mission_step_done 을
        // 그 미션 보고로 해석한다. contextForKind("mission") 은 ""(미설정)이라 그것만
        // 쓰면 미션 스코프가 배달되지 않아 mission_step_done 이 거부된다. 미션 전환 시
        // stop+relaunch 하므로 launch 시점의 currentMissionId 가 곧 그 미션이다.
        const context =
          this.kind === "mission"
            ? (this.currentMissionId ?? "")
            : contextForKind(this.kind);
        if (context) {
          config.mcpServers.marblo.env.MARBLO_CONTEXT = context;
        }
        fs.writeFileSync(
          launchConfig.mcpConfigPath,
          JSON.stringify(config, null, 2),
          "utf-8",
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
      mergedEnv,
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
      claudeSessionId: resumedSessionId ?? undefined,
    };

    // Send initial prompt only for NEW sessions (not resumed ones). Gate on
    // whether we ACTUALLY resumed (lock acquired + session matched), not on the
    // mere request — a fall-back-to-fresh must still send the boot prompt.
    if (resumedSessionId) {
      // Resumed session — just mark as running after CLI boots
      setTimeout(() => {
        if (this.session?.ptySessionId === ptySessionId) {
          this.setStatus("running");
        }
        // resume 은 부팅 프롬프트를 보내지 않으므로 CLI settle 후 곧장 주입 허용.
        this.resolveBootGate();
      }, 2000);
    } else {
      // New session — send skill-based initial prompt.
      // Two-step send (text then \r after a delay): writing the prompt and
      // \r in one chunk gets paste-buffered by Claude Code, so the \r ends
      // up inside the message instead of submitting it. Splitting forces
      // Enter to register as a discrete keystroke. Readiness detection
      // mirrors agent-manager so we send only after the CLI is actually
      // accepting input.
      const initialPrompt =
        this.kind === "mission"
          ? [
              "You are the Marblo Mission Orchestrator (B-mode, orchestrator-driven).",
              `Read the orchestrator skill with get_agent_skill("orchestrator") and follow ONLY its Mission section (§6 — orchestrator-driven). Ignore the board tf-* slash commands.`,
              "You drive exactly ONE mission. Do NOT start anything on your own.",
              "Wait for the conductor (지휘자) to grant the first step via a system message, then execute that step with run_skill and report with mission_step_done.",
            ].join(" ")
          : [
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
        // 부팅 프롬프트의 제출 사이클(text→150ms→CR+재시도 ~2s)이 끝난 뒤에야
        // conductor grant 주입을 허용한다 → 같은 PTY 동시 write 인터리브 제거.
        setTimeout(() => this.resolveBootGate(), 3500);
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
      labelTarget,
    );

    // Monitor PTY exit — auto-restart on crash
    this.ptyManager.onExit(ptySessionId, (exitCode) => {
      if (this.session?.ptySessionId !== ptySessionId) return;

      // Intentional stop or clean exit — release our resume lock so another
      // instance (or our own next launch) can attach without false contention.
      if (this.stopRequested || exitCode === 0) {
        if (this.session?.claudeSessionId) {
          this.releaseResumeLock(rootPath, this.session.claudeSessionId);
        }
        this.setStatus("stopped");
        this.configGenerator.cleanup(sessionId);
        return;
      }

      // Crash detected — attempt auto-restart with backoff
      if (this.restartCount < ORCH_MAX_RESTARTS && this.lastLaunchArgs) {
        const delay = Math.min(
          ORCH_BACKOFF_BASE_MS * Math.pow(2, this.restartCount),
          ORCH_BACKOFF_MAX_MS,
        );
        this.restartCount++;
        console.log(
          `[Orchestrator] Crash (exit ${exitCode}). Restart ${this.restartCount}/${ORCH_MAX_RESTARTS} in ${delay}ms`,
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
          // crash 후 자동재시작은 *직전에 크래시한 바로 그 세션*을 정확히 이어가야
          // 한다(직전 컨텍스트가 그대로 보여야 함 — blank 금지). 예전엔 board 가
          // "latest" 를 넘겨 launch() 의 라벨 전용 resolver(resolveSessionId)를
          // 탔는데, marblo-labels.json 이 없는 흔한 경우엔 매치 실패 → fresh 세션이
          // 부팅돼 직전 대화가 통째로 orphan(빈화면처럼 보임)되거나, 바쁜 공유 dir
          // 에서 엉뚱한 세션을 집었다. 대신 store → 라벨 → 컨텐츠 시그니처로 복원하는
          // robust resolver 로 정확한 세션 UUID 를 집어 넘긴다 — 렌더러 auto-reconnect
          // (resolveOrchestratorResumeId)과 동일 경로. 미션은 미션 단위 resolver 로.
          // 어느 쪽도 복원 불가(genuinely 없음)면 "new"(fresh) — "latest" 로 약한
          // 라벨 resolver 를 다시 타며 엉뚱/blank 세션을 집을 여지를 없앤다.
          const ownerMission = this.lastOwnerMissionId ?? undefined;
          const resumeTarget =
            this.kind === "mission" && ownerMission
              ? (this.resolveMissionResumeId(rp, ownerMission) ?? "new")
              : (this.resolveOrchestratorResumeId(rp) ?? "new");
          this.launch(
            pId,
            rp,
            bp,
            this.lastOnPtyReady,
            resumeTarget,
            ownerMission,
          );
        }, delay);
      } else {
        // Max restarts exceeded — give up and release the lock so a manual
        // restart (or a sibling instance) can re-attach to the session.
        if (this.session?.claudeSessionId) {
          this.releaseResumeLock(rootPath, this.session.claudeSessionId);
        }
        this.setStatus("error");
        this.configGenerator.cleanup(sessionId);
        console.error(
          `[Orchestrator] Max restarts (${ORCH_MAX_RESTARTS}) exceeded. Exit code: ${exitCode}`,
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

    const { ptySessionId, sessionId, rootPath, claudeSessionId } = this.session;
    if (claudeSessionId) this.releaseResumeLock(rootPath, claudeSessionId);
    this.ptyManager.kill(ptySessionId);
    this.configGenerator.cleanup(sessionId);
    this.setStatus("stopped");
    this.session = null;
    this.restartCount = 0;
    this.currentMissionId = null;
    // 대기 중이던 injectMessage 들이 영영 매달리지 않게 게이트를 푼다 — 세션이
    // null 이라 실제 write 는 스킵된다.
    this.resolveBootGate();
  }

  /**
   * 현재 이 매니저가 운전 중인 미션 id (kind="mission" 전용), 없으면 null.
   * 호출부(ensureMissionOrchestratorLaunched)가 "실행 중인 오케가 다른 미션을
   * 점유 중인가" 를 판정해 새 미션을 위해 fresh 세션으로 교체할지 결정한다.
   */
  getOwnerMissionId(): string | null {
    return this.currentMissionId;
  }

  restart(
    projectId: string,
    rootPath: string,
    bridgePort: number,
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
      "marblo-labels.json",
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
    agentId?: string,
  ): void {
    const labels = this.readLabels(rootPath);
    labels[sessionUuid] = { label, agentId, createdAt: Date.now() };
    try {
      fs.writeFileSync(
        this.getLabelsPath(rootPath),
        JSON.stringify(labels, null, 2),
        "utf-8",
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
        encodedPath,
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
    filterAgentId?: string,
  ): string | null {
    if (requested !== "latest") return requested; // specific UUID, return as-is

    const sessions = this.listSessions(rootPath);
    // Filter by label or agentId (sessions are already sorted by updatedAt desc)
    const match = sessions.find(
      (s) =>
        (filterAgentId && s.agentId === filterAgentId) ||
        (filterLabel && s.label === filterLabel),
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
        encodedPath,
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
    label: string,
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
            ORCHESTRATOR_PROMPT_SIGNATURE,
          ),
        );
      if (match) {
        this.saveSessionLabel(rootPath, match, label);
        this.saveOrchSessionId(rootPath, match);
        // Bind our resume lock to the freshly-created session id so a sibling
        // instance can't later `--resume` it from under us and blank our PTY.
        if (this.session?.ptySessionId === ptySessionId) {
          this.session.claudeSessionId = match;
          this.acquireResumeLock(rootPath, match, ptySessionId);
        }
        console.log(
          `[Orchestrator:${this.kind}] Labeled session ${match} as "${label}" (attempt ${attempts})`,
        );
        return;
      }

      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tick, INTERVAL_MS);
      } else {
        console.warn(
          `[Orchestrator:${this.kind}] No orchestrator session detected after ${attempts} attempts — left unlabeled (content-scan resolver still recovers it)`,
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
        `[Orchestrator:${this.kind}] Recovered prior session ${byContent} by content signature → persisted (store + label)`,
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
      "marblo-orch-sessions.json",
    );
  }

  private readOrchStore(
    rootPath: string,
  ): Record<
    string,
    { sessionId: string; updatedAt: number; missionId?: string }
  > {
    try {
      return JSON.parse(
        fs.readFileSync(this.getOrchStorePath(rootPath), "utf-8"),
      );
    } catch {
      return {};
    }
  }

  /**
   * store 키: board 는 "board". mission 은 운전 중인 미션이 있으면
   * `mission:${missionId}` 로 미션 단위 분리(새 미션 = 새 키 = fresh), 미션을
   * 모르면 레거시 "mission" 키(렌더러 reconnect self-heal 용).
   */
  private orchStoreKey(): string {
    return this.kind === "mission" && this.currentMissionId
      ? `mission:${this.currentMissionId}`
      : this.kind;
  }

  /** Persist this orchestrator's claude session id under its store key. */
  saveOrchSessionId(rootPath: string, claudeSessionId: string): void {
    const store = this.readOrchStore(rootPath);
    // Repoint visibility: when the board/mission pointer moves to a DIFFERENT
    // session, the previous conversation is orphaned (no longer auto-resumed).
    // Surface it instead of silently swapping it out — "조용한 유실 금지".
    const prev = store[this.orchStoreKey()]?.sessionId;
    if (prev && prev !== claudeSessionId) {
      console.warn(
        `[Orchestrator:${this.kind}] Session pointer repointed ${prev} → ${claudeSessionId}; the prior conversation is now orphaned (it will not be auto-resumed).`,
      );
    }
    store[this.orchStoreKey()] = {
      sessionId: claudeSessionId,
      updatedAt: Date.now(),
      missionId: this.currentMissionId ?? undefined,
    };
    try {
      fs.writeFileSync(
        this.getOrchStorePath(rootPath),
        JSON.stringify(store, null, 2),
        "utf-8",
      );
    } catch {
      /* best-effort */
    }
  }

  // ── Concurrent-resume lock (cross-process, advisory) ──────────────────
  // A per-project file mapping claude-session-id → owning orchestrator. It
  // prevents two LIVE instances from `--resume`-ing the same session at once
  // (which renders the second PTY blank). Same-process re-resume — e.g. crash
  // auto-restart — is always allowed (pid match).

  private getOrchLocksPath(rootPath: string): string {
    const encodedPath = encodeClaudeProjectDir(rootPath);
    return path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
      "marblo-orch-locks.json",
    );
  }

  private readOrchLocks(rootPath: string): Record<string, OrchResumeLock> {
    try {
      return JSON.parse(
        fs.readFileSync(this.getOrchLocksPath(rootPath), "utf-8"),
      );
    } catch {
      return {};
    }
  }

  private writeOrchLocks(
    rootPath: string,
    locks: Record<string, OrchResumeLock>,
  ): void {
    try {
      fs.writeFileSync(
        this.getOrchLocksPath(rootPath),
        JSON.stringify(locks, null, 2),
        "utf-8",
      );
    } catch {
      /* best-effort */
    }
  }

  /** True if `pid` is a currently-running process on this host. */
  private static isPidAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      // Signal 0 performs error checking without sending a signal.
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // EPERM = process exists but is owned by another user → still alive.
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  /** True if `lock` is held by a DIFFERENT orchestrator that is still alive. */
  private isForeignLiveLock(lock?: OrchResumeLock): boolean {
    if (!lock) return false;
    if (lock.pid === process.pid) return false; // our own (incl. crash restart)
    if (Date.now() - lock.updatedAt > ORCH_RESUME_LOCK_TTL_MS) return false; // stale
    return OrchestratorManager.isPidAlive(lock.pid);
  }

  /**
   * Try to claim the resume lock for `claudeSessionId`. Returns false when a
   * different, still-running orchestrator already holds it — the caller then
   * starts a fresh session instead of double-attaching (which blanks the PTY).
   */
  private acquireResumeLock(
    rootPath: string,
    claudeSessionId: string,
    ptySessionId: string,
  ): boolean {
    const locks = this.readOrchLocks(rootPath);
    if (this.isForeignLiveLock(locks[claudeSessionId])) return false;
    locks[claudeSessionId] = {
      ptySessionId,
      kind: this.kind,
      pid: process.pid,
      updatedAt: Date.now(),
    };
    this.writeOrchLocks(rootPath, locks);
    return true;
  }

  /** Release our resume lock for `claudeSessionId` (only if we still hold it). */
  private releaseResumeLock(rootPath: string, claudeSessionId: string): void {
    const locks = this.readOrchLocks(rootPath);
    const held = locks[claudeSessionId];
    if (held && held.pid === process.pid) {
      delete locks[claudeSessionId];
      this.writeOrchLocks(rootPath, locks);
    }
  }

  /**
   * 미션 단위 resume 세션 id — `mission:${missionId}` 에 저장된 세션이 아직
   * 실재(resumable)하면 그 id, 아니면 null. null 이면 호출부가 "new"(fresh)로
   * 새 미션 세션을 띄운다. 이게 "새 미션 = fresh, 같은 미션 = 이어가기" 의 핵심.
   * (board kind 에는 해당 없음 — 항상 null.)
   */
  resolveMissionResumeId(rootPath: string, missionId: string): string | null {
    if (this.kind !== "mission" || !missionId) return null;
    const stored =
      this.readOrchStore(rootPath)[`mission:${missionId}`]?.sessionId;
    if (stored && this.isResumableSession(rootPath, stored)) return stored;
    return null;
  }

  /** True if `id` is a real, resumable session (exists, not a summary stub). */
  private isResumableSession(rootPath: string, id: string): boolean {
    const encodedPath = encodeClaudeProjectDir(rootPath);
    const p = path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodedPath,
      `${id}.jsonl`,
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
