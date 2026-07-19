import { BrowserWindow } from "electron";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { PtyManager } from "./pty-manager";
import {
  AgentConfigGenerator,
  LaunchConfig,
  FALLBACK_TOP_CLAUDE_MODEL,
  type TaskComplexity,
} from "./agent-config";
import { mainTelemetry } from "./telemetry";
import { encodeClaudeProjectDir } from "./claude-paths";
import {
  shouldPromoteOnPtyOutput,
  shouldDemoteCompletedTurn,
  shouldDemoteAbandonedTurn,
} from "./agent-status-reconcile";
import { looksLikeLoginScreen } from "./harness-manager";

export type ModelType =
  | "claude"
  | "gemini"
  | "gpt"
  | "antigravity"
  | "local"
  | "custom";
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
// "Graceful completion" threshold — an agent that lived past this window
// before exiting (even with a nonzero code) almost certainly ran its
// course rather than crashed on bootstrap. Codex / Claude can exit
// nonzero after a normal task completion (signal, ctrl-c, plugin shutdown,
// SIGPIPE on stdin close). Without this distinction those exits get
// classified as crashes → auto-restart 5x → error, which surfaces in the
// UI as "rest-and-error" for a worker that actually did its job.
const GRACEFUL_LIFETIME_MS = 60_000;

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
  /** 작업 난이도 — claude(--model)·codex(reasoning) 모델/레벨 선택용. 미지정=기본. */
  complexity?: TaskComplexity;
  /** Board task currently bound to this agent, when launched by dispatch/spawn. */
  currentTaskId?: string | null;
  /** MARBLO_CONTEXT injected into this agent's MCP process, e.g. lane:<id>. */
  contextId?: string;
  /** claude 런타임 강등 재시작(§3.4-3)용 모델 override. 설정되면 complexity
   * resolver 대신 이 모델 id 로 --model 핀(예: fable5 실패 → "opus"). */
  claudeModelOverride?: string;
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
  currentTaskId: string | null;
  /**
   * The last task this agent was bound to, RETAINED after the binding is
   * released. Audit-only — never used to decide whether the agent is free.
   *
   * Why it has to exist: `markTurnComplete` clears `currentTaskId` the instant
   * a worker reports its task terminal, but the reaper's gate required a
   * `currentTaskId` to prove the agent's work was finished. So the completion
   * report destroyed the only evidence that made the agent reapable, and every
   * agent that reported cleanly became permanently unreapable — 11 of 13
   * stranded, `cleanup_agents` answering "no reapable agents found" while the
   * box sat at load average 44. Keeping the id here lets the reaper re-check
   * that task's board status without resurrecting the binding.
   */
  lastTaskId: string | null;
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
  /** epoch-ms of the most recent PTY output activity. Bumped on every onData
   * chunk. A HINT ONLY — silence does not mean idle (a reasoning agent emits
   * nothing), so this now feeds only the wedged-turn backstop
   * (ABANDONED_TURN_MS) and the reaper's post-completion grace window, never a
   * routine working→idle demotion. */
  lastPtyActivity: number;
  /**
   * epoch-ms the agent reported its turn finished (submit_for_review /
   * update_task_status → REVIEW·DONE·FAILED·BLOCKED), set by markTurnComplete.
   * null while a turn is open.
   *
   * This is the AUTHORITATIVE turn boundary — the agent's own statement that it
   * is done, which no amount of terminal repaint can contradict. While it is
   * set, output cannot promote the agent to `working`. It is cleared only by a
   * real turn start (noteTurnStart, fired on submitted input) or an explicit
   * promotion, so genuine follow-up work is never suppressed.
   */
  turnCompletedAt: number | null;
  /** Claude only: the --model id this launch actually used (resolver result or
   * runtime-downgrade override). Lets the fast-fail handler detect a Fable5
   * launch and downgrade it to opus on restart (§3.4-3). undefined for
   * non-claude / non-complex launches. */
  topClaudeModel?: string;
  /** Set once when a Fable5 launch is downgraded to opus after a runtime
   * fast-fail. Carried into the auto-restart so the relaunch pins opus, and
   * acts as the once-only guard so the downgrade can't loop. */
  claudeModelOverride?: string;
  /** P3-4: epoch-ms the agent entered a TERMINAL state (stopped/error) with no
   * pending auto-restart. null while live or mid-restart. The periodic pruner
   * uses it as a backstop to evict long-dead map entries that cleanup_agents
   * never reaped (e.g. the orchestrator never calling it). Reset to null on any
   * revival. */
  terminalSince: number | null;
}

/**
 * Structured-clone-safe projection of an AgentInstance for the Electron IPC
 * boundary. AgentInstance carries fields that the structured-clone algorithm
 * cannot serialize — the `onPtyReady` callback (a function), the
 * `restartTimer` / `heartbeatTimer` Timer handles, and the nested
 * `launchConfig`. Returning a raw AgentInstance from an `ipcMain.handle`
 * channel therefore throws "An object could not be cloned" (see the
 * `agent:list` handler). This shape mirrors exactly the fields the renderer
 * consumes, all serializable scalars.
 */
export interface SerializableAgent {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  ptySessionId: string;
  status: AgentStatus;
  currentTaskId: string | null;
}

/** Map an AgentInstance to a plain, IPC-cloneable object. */
export function serializeAgent(agent: AgentInstance): SerializableAgent {
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    role: agent.role,
    ptySessionId: agent.ptySessionId,
    status: agent.status,
    currentTaskId: agent.currentTaskId,
  };
}

// NOTE: the old IDLE_INACTIVITY_MS (5 min of PTY silence ⇒ idle) is gone. It
// assumed a busy agent keeps talking, but an agent that is reasoning is silent,
// so the rule reported live work as free. Demotion is now driven by the agent's
// own completion report, with ABANDONED_TURN_MS (agent-status-reconcile.ts) as
// the only silence-based backstop. See that file's header for the full model.

const SECRET_OUTPUT_GUARDRAIL = [
  "[보안 가드레일]",
  "- `.env`, `.mcp.json`, firebase-config, service account JSON, OAuth/Toss/Paddle/API key 파일의 원문을 cat/print/log 하지 마세요.",
  "- 설정 확인이 필요하면 키 존재 여부, 파일 경로, 마스킹된 값만 보고하세요. 값 자체를 출력해야 하는 로그에는 maskConfigForLogging/maskEnvForLogging 계열 마스킹을 적용하세요.",
].join("\n");

// P3-4: backstop pruning of dead (stopped/error) entries the primary reaper
// (cleanup_agents → remove) never reclaimed — e.g. the orchestrator never
// calling cleanup_agents, or a naturally-completed agent whose Firestore doc was
// never deleted. The map otherwise grows for the app's whole (multi-day)
// lifetime. TTL is generous so a user can still revive a stopped agent via
// "+ New Session" long after it died; only truly-abandoned entries are evicted.
const DEAD_ENTRY_TTL_MS = 30 * 60 * 1000; // 30 min terminal → prunable
const DEAD_ENTRY_SWEEP_MS = 5 * 60 * 1000; // sweep cadence

/**
 * Build the prompt that gets typed into the freshly-spawned CLI.
 *
 * - Codex / Gemini / custom CLIs have no skill auto-discovery, so we
 *   prepend the role's skill file (claim/activity/review workflow,
 *   coding rules, etc.) ahead of the orchestrator's instruction. Claude
 *   Code does auto-load `~/.claude/skills/*`, but marblo's role skills
 *   live in `v3/skills/{role}_agent.md` — they aren't symlinked into
 *   `~/.claude/skills/`, so Claude workers wouldn't see the
 *   claim→IN_PROGRESS→submit_for_review workflow either. Prepend for
 *   Claude too. Skipping this is what caused workers to finish reviews
 *   in their PTY but never call submit_for_review / update_task_status,
 *   leaving the orchestrator blind to completion.
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
  {
    // Antigravity (agy) v1.0.2 trust dialog: blocks input on first visit
    // to any new cwd. Default highlight is "> Yes, I trust this folder"
    // (verified via live PTY capture 2026-05-26), so a bare `\r` accepts.
    // Anchored to the question text — distinctive enough not to false-fire
    // on arbitrary chat content. Applied to antigravity only so claude /
    // codex / gemini chats discussing trust don't trigger it.
    pattern: /Do you trust the contents of this project/i,
    keys: "\r",
    label: "antigravity trust-folder",
    applies: ["antigravity"],
  },
];

export function composeInitialPrompt(
  model: ModelType,
  instruction: string,
  skillContent?: string,
): string {
  const isClaude = model === "claude";
  const sanitized = isClaude
    ? instruction
    : instruction.replace(/mcp__marblo__/g, "");
  // agy 도 v1.20+ 부터 MCP 지원 — generateAntigravityConfig 가 글로벌
  // ~/.gemini/antigravity-cli/mcp_config.json 에 marblo 항목을 머지하므로
  // role-skill 의 add_activity / claim_task / submit_for_review 호출이
  // 정상 작동한다. 따라서 다른 비-claude 워커와 동일한 prepend 경로 사용.
  if (!skillContent) return sanitized;
  return [
    "[역할 스킬 — 아래 워크플로우와 도구 사용 규칙을 따르세요]",
    skillContent.trim(),
    "",
    SECRET_OUTPUT_GUARDRAIL,
    "",
    "[작업 지시]",
    sanitized,
  ].join("\n");
}

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  // P3-4: periodic backstop that evicts long-dead map entries. Started in the
  // constructor, cleared in stopAll() (called on before-quit). .unref()'d so it
  // never keeps the process alive on its own.
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
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

    // P3-4: start the dead-entry pruner. Idempotent guard so re-entry can't
    // stack intervals.
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(
        () => this.pruneDeadEntries(),
        DEAD_ENTRY_SWEEP_MS,
      );
      this.pruneTimer.unref?.();
    }
  }

  /**
   * P3-4 backstop: evict map entries that have been TERMINAL (stopped/error)
   * longer than DEAD_ENTRY_TTL_MS. cleanup_agents (→ remove) is still the
   * primary reaper and Firestore docs are left untouched; this only bounds the
   * in-memory `agents` map so it can't grow unbounded across the app's lifetime
   * when cleanup_agents is never called. Live / restarting agents (terminalSince
   * === null) are never touched.
   */
  private pruneDeadEntries(): void {
    const now = Date.now();
    for (const [id, agent] of this.agents) {
      if (agent.status !== "stopped" && agent.status !== "error") continue;
      if (agent.terminalSince === null) continue;
      if (now - agent.terminalSince < DEAD_ENTRY_TTL_MS) continue;
      this.clearAgentTimers(agent);
      this.agents.delete(id);
      console.log(
        `[AgentManager] Pruned dead entry ${agent.name} (${id}, ${agent.status} for ${Math.round(
          (now - agent.terminalSince) / 60000,
        )}min) — backstop reaper (P3-4).`,
      );
    }
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
        }`,
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
      isResume ? resolvedResumeId : undefined,
      // Pin a fresh Claude launch to a generated --session-id so this agent's
      // tokens attribute to it deterministically (no racy post-launch scan).
      true,
      // 작업 난이도 → claude(--model sonnet/opus)·codex(reasoning) 모델/레벨 선택.
      params.complexity,
      // 런타임 강등 재시작 시 forced --model(예: fable5 실패 → "opus", §3.4-3).
      params.claudeModelOverride,
      params.contextId,
    );

    // 모델 할당 v2 텔레메트리 + 폴백 표식(§8.1/§8.4). modelResolution 은 complex
    // claude 가 §3 resolver 를 탔을 때만 채워진다(override 경로는 비움).
    // topClaudeModel 은 fast-fail 강등 판단에 쓰려고 인스턴스에 보존한다.
    const resolution = launchConfig.modelResolution;
    const topClaudeModel = params.claudeModelOverride ?? resolution?.model;
    if (resolution) {
      const win = this.getMainWindow?.() ?? null;
      mainTelemetry.modelTierResolved(
        win,
        params.model,
        params.complexity ?? "",
        resolution.model,
        params.id,
      );
      if (resolution.fallback) {
        mainTelemetry.topModelFallback(
          win,
          resolution.fallback.reason,
          resolution.fallback.requested,
          resolution.fallback.installed,
          resolution.fallback.fallbackTo,
          params.id,
        );
      }
    }

    if (isResume) {
      console.log(
        `[Agent:${params.id}] Resuming session: ${resolvedResumeId} (model=${params.model})`,
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
      mergedEnv,
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
        launchConfig.skillContent,
      );
      let sent = false;
      // Set once if the CLI boots into an interactive login prompt — blocks
      // BOTH the readiness path and the blind fallback from typing the
      // instruction into the login menu (which historically navigated the menu
      // and exited the CLI cleanly, leaving a dead PTY). Watched for
      // claude/codex (gated pre-spawn) AND antigravity (ungated pre-spawn, but
      // its OAuth flow still needs the backstop). See looksLikeLoginScreen.
      let authBlocked = false;
      const watchLoginScreen =
        params.model === "claude" ||
        params.model === "gpt" ||
        params.model === "antigravity";
      const sendPrompt = () => {
        if (sent || authBlocked) return;
        sent = true;
        // Split text and \r so Claude Code registers Enter as a discrete
        // keystroke (single-chunk write gets paste-buffered, leaving the
        // CR inside the message body without submitting).
        this.ptyManager.writeAndSubmit(ptySessionId, prompt);
        console.log(
          `[Agent:${params.id}] Initial prompt sent (${prompt.length} chars)`,
        );
      };
      const handleLoginScreen = () => {
        if (authBlocked || sent) return;
        authBlocked = true;
        console.error(
          `[Agent:${params.id}] Login prompt detected for ${params.model} — ` +
            `suppressing prompt injection (CLI needs auth / login).`,
        );
        this.setStatus(params.id, "error");
        // Surface to the renderer so it can open the CLI setup gate instead of
        // the agent silently dying at a login screen.
        this.getMainWindow?.()?.webContents.send("agent:needsAuth", {
          agentId: params.id,
          model: params.model,
        });
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
      // Antigravity (agy) verified via live PTY capture: the post-trust
      // input prompt uses the same `? for shortcuts` footer as Claude
      // Code, so the pattern above already matches once trust is granted.
      // The blocking gate is the trust dialog itself, handled below.

      // Per-launch state for STARTUP_DIALOG_MATCHERS — fire each matcher
      // at most once. Filter by model so e.g. codex's update prompt
      // doesn't get applied to claude agents (false positive on a chat
      // message containing the same words).
      const activeMatchers = STARTUP_DIALOG_MATCHERS.filter(
        (m) => !m.applies || m.applies.includes(params.model),
      );
      const dismissed = new Set<RegExp>();

      this.ptyManager.onData(ptySessionId, (data) => {
        if (sent || authBlocked) return;
        outputBuffer += data;
        // Only keep last 4KB to avoid memory growth
        if (outputBuffer.length > 4096)
          outputBuffer = outputBuffer.slice(-4096);

        // Login-screen backstop: if the CLI booted into an interactive login
        // prompt, stop here — never fall through to the readiness patterns or
        // the blind fallback and type into the menu.
        if (watchLoginScreen && looksLikeLoginScreen(outputBuffer)) {
          handleLoginScreen();
          return;
        }

        for (const dlg of activeMatchers) {
          if (dismissed.has(dlg.pattern)) continue;
          if (dlg.pattern.test(outputBuffer)) {
            dismissed.add(dlg.pattern);
            console.log(
              `[Agent:${params.id}] Dismissing blocking dialog: ${dlg.label}`,
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

      // Fallback: send after the model-specific timeout regardless of
      // readiness patterns. Antigravity gets a longer window because its
      // first-spawn OAuth browser flow (harness-catalog.ts antigravity)
      // can easily blow past 10s, and the 10s default would dump the
      // prompt into the auth dialog.
      const fallbackMs = params.model === "antigravity" ? 25000 : 10000;
      setTimeout(sendPrompt, fallbackMs);
    }

    // Wire Claude cost tracking to this agent's session.
    //
    // A fresh launch is PINNED to a brand-new session id up front
    // (--session-id <uuid> — see claudeSessionArgs), so we attribute
    // deterministically and SKIP the legacy "which new JSONL appeared?" scan.
    // That scan collides when several Claude agents share one cwd: it grabs an
    // arbitrary new file (or none, if Claude hasn't written it by the 5s mark),
    // which silently funnels every agent's tokens onto the orchestrator and
    // leaves the agents reading 0. The pinned JSONL may not exist yet at this
    // point; the cost tracker's poller tolerates that and picks it up once
    // Claude writes it. Gated to claude — codex/gemini/agy have their own
    // dedicated tracking kickoff below.
    //
    // Resume launches are excluded: their session already exists and is wired
    // for cost tracking via the reconnect path, so re-tracking here would
    // re-read the whole file and double-count. They fall through to the legacy
    // detector (a no-op on resume, since the resumed file isn't "new") — i.e.
    // identical to pre-fix behavior.
    if (this.onSessionDetected && params.cwd && params.model === "claude") {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;

      if (launchConfig.claudeSessionId && !isResume) {
        this.onSessionDetected(
          rootPath,
          launchConfig.claudeSessionId,
          agentName,
          agentId,
        );
      } else {
        // Fallback for the rare unresolved `--resume latest` (no concrete id to
        // pin): snapshot existing sessions, then 5s later claim the newly
        // created one. Best-effort and race-prone, but only this edge needs it.
        let existingIds: Set<string>;
        try {
          const encodedPath = encodeClaudeProjectDir(rootPath);
          const sessionsDir = path.join(
            os.homedir(),
            ".claude",
            "projects",
            encodedPath,
          );
          const files = fs.existsSync(sessionsDir)
            ? fs
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
            const encodedPath = encodeClaudeProjectDir(rootPath);
            const sessionsDir = path.join(
              os.homedir(),
              ".claude",
              "projects",
              encodedPath,
            );
            if (!fs.existsSync(sessionsDir)) return;
            const currentFiles = fs
              .readdirSync(sessionsDir)
              .filter((f: string) => f.endsWith(".jsonl"))
              .map((f: string) => f.replace(".jsonl", ""));
            const newId = currentFiles.find(
              (id: string) => !existingIds.has(id),
            );
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
    }

    // Codex / Gemini cost-tracking kickoff.
    //
    // The Claude session detector above only scans ~/.claude/projects, so it
    // never fires onSessionDetected for codex/gemini. Their cost tracking is
    // file-based and self-resolving (CostTracker polls the per-agent CLI home
    // and re-resolves the newest session file each tick), so we just nudge it
    // to start a few seconds after launch — the CLI needs a moment to write
    // its first session file. sessionId is passed empty; the tracker ignores
    // it for these models.
    if (
      this.onSessionDetected &&
      params.cwd &&
      (params.model === "gpt" || params.model === "gemini")
    ) {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;
      setTimeout(() => {
        this.onSessionDetected!(rootPath, "", agentName, agentId);
      }, 8000);
    }

    // Antigravity (agy) conversation watcher.
    //
    // agy 는 ~/.gemini/antigravity-cli/conversations/<UUID>.pb 에 cwd 무관
    // 하게 모든 conversation 을 저장하므로 cwd 별 분리 불가. spawn 직전
    // 스냅샷을 떠두고 일정 시간 후 새로 생긴 .pb basename 을 잡아
    // onSessionDetected 로 영속화한다.
    //
    // 타이밍: agy 는 첫 user message 가 들어가야 .pb 생성 — Marblo 의
    // initial prompt 가 25s fallback 후 주입되므로 35s 후 스캔.
    if (
      params.model === "antigravity" &&
      this.onSessionDetected &&
      params.cwd
    ) {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;
      const conversationsDir = path.join(
        os.homedir(),
        ".gemini",
        "antigravity-cli",
        "conversations",
      );
      // agy migrated from a flat .pb store to per-conversation SQLite (.db);
      // both formats still appear, so snapshot/scan UUID basenames from either
      // (ignoring .db-wal/.db-shm sidecars, which don't end in ".db").
      const listConvIds = (): Set<string> => {
        try {
          if (!fs.existsSync(conversationsDir)) return new Set();
          return new Set<string>(
            fs
              .readdirSync(conversationsDir)
              .filter((f: string) => f.endsWith(".pb") || f.endsWith(".db"))
              .map((f: string) => f.replace(/\.(pb|db)$/, "")),
          );
        } catch (err) {
          console.error(
            `[AgentManager] Failed to snapshot agy conversations for agent="${agentId}":`,
            err,
          );
          return new Set();
        }
      };
      const convMtime = (id: string): number => {
        for (const ext of [".db", ".pb"]) {
          try {
            return fs.statSync(path.join(conversationsDir, `${id}${ext}`))
              .mtimeMs;
          } catch {
            /* try next ext */
          }
        }
        return 0;
      };
      const existingIds = listConvIds();

      setTimeout(() => {
        try {
          const newIds = Array.from(listConvIds()).filter(
            (id: string) => !existingIds.has(id),
          );
          // Race ambiguity: if >1 conversation appeared in the window (parallel
          // spawn, user's own terminal session), we can't tell which is ours.
          // Pick the most-recently-modified one as best-effort.
          if (newIds.length === 0) return;
          let chosenId = newIds[0];
          if (newIds.length > 1) {
            chosenId = newIds
              .map((id: string) => ({ id, mtime: convMtime(id) }))
              .sort(
                (a: { mtime: number }, b: { mtime: number }) =>
                  b.mtime - a.mtime,
              )[0].id;
            console.warn(
              `[AgentManager] agy: ${newIds.length} new conversations detected during agent="${agentId}" window, picking newest=${chosenId}`,
            );
          }
          this.onSessionDetected!(rootPath, chosenId, agentName, agentId);
        } catch (err) {
          console.error(
            `[AgentManager] Failed to detect agy conversation for agent="${agentId}":`,
            err,
          );
        }
      }, 35000);
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
      currentTaskId: params.currentTaskId ?? null,
      lastTaskId: params.currentTaskId ?? null,
      launchConfig,
      restartCount: 0,
      fastFailCount: 0,
      spawnedAt: Date.now(),
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
      onPtyReady: params.onPtyReady,
      lastPtyActivity: Date.now(),
      turnCompletedAt: null,
      terminalSince: null,
      topClaudeModel,
      claudeModelOverride: params.claudeModelOverride,
    };

    this.agents.set(params.id, instance);

    // PTY activity → working/idle auto-derivation.
    //
    // Status was historically set only via two paths:
    //   (a) bridge-server dispatch → setStatus("working")
    //   (b) MCP self-report (submit_for_review / update_task_status DONE etc)
    //       → setStatus("idle")
    // Vendors without MCP self-report (notably agy 1.0.2 / direct PTY chat)
    // never moved off the initial "idle" — orchestrator then treated them as
    // "free" while they were actually mid-conversation waiting for the next
    // instruction, so no follow-up was ever sent.
    //
    // Hook every PTY output chunk: bump lastPtyActivity, and promote idle→
    // working on the first byte of an OPEN turn. Demotion is not handled here
    // (nor by silence) — it follows the agent's completion report; see the
    // heartbeat below and agent-status-reconcile.ts.
    this.ptyManager.onData(ptySessionId, () => {
      const agent = this.agents.get(params.id);
      if (!agent || agent !== instance) return;
      agent.lastPtyActivity = Date.now();
      // Output NEVER starts a turn — it only continues one. While a completion
      // report stands, these bytes are the finished turn's repaint (trailing
      // flush, then the idle prompt's spinner/cursor forever), and promoting on
      // them is what stranded agents at [working] with nothing able to reap
      // them. A real new turn arrives as INPUT and clears the marker via
      // noteTurnStart, which re-opens promotion.
      if (
        shouldPromoteOnPtyOutput({
          status: agent.status,
          stopRequested: agent.stopRequested,
          turnCompletedAt: agent.turnCompletedAt,
          now: Date.now(),
        })
      ) {
        this.setStatus(params.id, "working");
      }
    });

    // Input side of the turn boundary: any submitted instruction — from
    // dispatch, reuse, a nudge, or a human typing in the terminal tab — opens a
    // new turn, so the completed-turn marker is cleared and the next output
    // byte can legitimately promote the agent back to `working`.
    this.ptyManager.onSubmit(ptySessionId, () => {
      const agent = this.agents.get(params.id);
      if (!agent || agent !== instance) return;
      this.noteTurnStart(params.id);
    });

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
      promptLength,
    );

    // Start heartbeat for anomaly detection (ML-4)
    instance.heartbeatTimer = setInterval(() => {
      const win = this.getMainWindow?.() ?? null;
      const agent = this.agents.get(params.id);
      if (!agent || agent.stopRequested) return;
      // Demotion is driven by the agent's own completion report, NOT by PTY
      // silence. An agent that is reasoning emits nothing for minutes at a
      // time; the old "silent for 5 min ⇒ idle" rule therefore reported live
      // work as free, which both misled the orchestrator and exposed a
      // thinking agent to any idleness-gated reaper. Silence is not evidence
      // of idleness — see agent-status-reconcile.ts.
      if (
        // A completed turn whose slot didn't free (a trailing chunk promoted it
        // to `working` in the race just before /set-agent-status landed) —
        // demote on the SHORT settle window so the slot frees promptly and the
        // orchestrator stops seeing a phantom [working].
        shouldDemoteCompletedTurn({
          status: agent.status,
          stopRequested: agent.stopRequested,
          turnCompletedAt: agent.turnCompletedAt,
          lastPtyActivity: agent.lastPtyActivity,
          now: Date.now(),
        })
      ) {
        this.setStatus(params.id, "idle");
      } else if (
        // Backstop only: no completion report and mute for far longer than any
        // plausible inference pause ⇒ presumed wedged. Deliberately generous
        // (45 min vs the old 5) because demoting live work is the expensive
        // mistake and demoting a wedged agent late is the cheap one.
        shouldDemoteAbandonedTurn({
          status: agent.status,
          stopRequested: agent.stopRequested,
          turnCompletedAt: agent.turnCompletedAt,
          lastPtyActivity: agent.lastPtyActivity,
          now: Date.now(),
        })
      ) {
        console.warn(
          `[Agent:${params.id}] no completion report and PTY mute for ${Math.round(
            (Date.now() - agent.lastPtyActivity) / 60000,
          )}min — presuming wedged turn, demoting to idle.`,
        );
        this.setStatus(params.id, "idle");
      }
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

      // The PTY process is gone — release the heartbeat interval before taking
      // any branch below. Every branch is terminal for THIS instance: the
      // stopped/error branches leave a dead entry in the map (never deleted
      // here), and the auto-restart branch spawns a FRESH instance with its
      // own heartbeat via launch(). Without this clear the 30s interval (and
      // its telemetry.heartbeat emissions) leaked on every crash/completion.
      if (agent.heartbeatTimer) {
        clearInterval(agent.heartbeatTimer);
        agent.heartbeatTimer = null;
      }

      agent.lastExitCode = exitCode;
      const runtimeMs = Date.now() - agent.spawnedAt;

      // Intentional stop, clean exit, or graceful completion → mark stopped.
      // Graceful completion = nonzero exit after the worker has lived past
      // GRACEFUL_LIFETIME_MS; restarting at this point would just respawn
      // the CLI without context and waste a slot, and worse, repeated
      // nonzero exits eventually trigger the error state for a worker that
      // genuinely finished its task. The user can revive it explicitly via
      // "+ New Session".
      const isGracefulCompletion =
        exitCode !== 0 && runtimeMs >= GRACEFUL_LIFETIME_MS;
      if (agent.stopRequested || exitCode === 0 || isGracefulCompletion) {
        agent.status = "stopped";
        agent.terminalSince = Date.now(); // P3-4: pruner backstop clock
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "stopped");
        mainTelemetry.agentStopped(
          this.getMainWindow?.() ?? null,
          params.id,
          exitCode,
        );
        if (isGracefulCompletion) {
          console.log(
            `[Agent:${agent.id}] Graceful completion (exit ${exitCode} after ${runtimeMs}ms) — marking stopped, not restarting.`,
          );
        }
        return;
      }

      // Classify the exit: fast-fail (likely config / binary issue) vs.
      // runtime crash (transient, worth retrying).
      const wasFastFail = runtimeMs < FAST_FAIL_WINDOW_MS;
      if (wasFastFail) {
        agent.fastFailCount++;
        console.warn(
          `[Agent:${agent.id}] Fast-fail (exit ${exitCode} after ${runtimeMs}ms). fastFail=${agent.fastFailCount}/${FAST_FAIL_MAX}`,
        );

        // §3.4-3 2차 안전망: Fable5 가 런타임에서 빠르게 실패(미지원 모델 오류
        // 등)하면 opus 로 강등해 재시작한다. claudeModelOverride 가 한 번만
        // 세팅되는 전이 가드 — 강등 후 opus 가 또 fast-fail 하면 일반 예산을
        // 따른다. fastFail 예산은 강등 시점에 리셋해 opus 에 공정한 재시도를 준다.
        if (
          agent.model === "claude" &&
          agent.topClaudeModel === "claude-fable-5" &&
          !agent.claudeModelOverride
        ) {
          agent.claudeModelOverride = FALLBACK_TOP_CLAUDE_MODEL;
          agent.fastFailCount = 0;
          mainTelemetry.topModelFallback(
            this.getMainWindow?.() ?? null,
            "runtime_downgrade",
            "claude-fable-5",
            "runtime",
            FALLBACK_TOP_CLAUDE_MODEL,
            agent.id,
          );
          console.warn(
            `[Agent:${agent.id}] Fable5 runtime fast-fail — downgrading to ${FALLBACK_TOP_CLAUDE_MODEL} on restart (§3.4-3).`,
          );
        }
      }

      // Stop restarting once we've burned the fast-fail budget — it's
      // almost certainly a missing binary / bad config and another retry
      // won't help.
      const fastFailExceeded = agent.fastFailCount > FAST_FAIL_MAX;

      // Crash detected — attempt auto-restart with exponential backoff
      if (agent.restartCount < MAX_RESTARTS && !fastFailExceeded) {
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
          agent.currentTaskId,
        );
        console.log(
          `[Agent:${agent.id}] Crash detected (exit ${exitCode}). Restart ${agent.restartCount}/${MAX_RESTARTS} in ${delay}ms`,
        );

        agent.restartTimer = setTimeout(() => {
          this.performAutoRestart(agent.id);
        }, delay);
      } else {
        // Max restarts exceeded OR fast-fail budget burned → error state
        agent.status = "error";
        agent.terminalSince = Date.now(); // P3-4: pruner backstop clock
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "error");
        this.onRestartFailed?.(agent.id, exitCode);
        mainTelemetry.agentCrashed(
          this.getMainWindow?.() ?? null,
          agent.id,
          exitCode,
          agent.currentTaskId,
        );
        if (fastFailExceeded) {
          console.error(
            `[Agent:${agent.id}] Aborting auto-restart — agent exited within ${FAST_FAIL_WINDOW_MS}ms ${agent.fastFailCount}x. Likely a missing binary or bad config (command="${agent.command}"). Verify the CLI is on PATH and check the agent's launch args.`,
          );
        } else {
          console.error(
            `[Agent:${agent.id}] Max restarts (${MAX_RESTARTS}) exceeded. Exit code: ${exitCode}`,
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
    // Carry any Fable5→opus runtime downgrade into the relaunch so the restart
    // pins the safe model instead of resolving Fable5 again (§3.4-3).
    const claudeModelOverride = agent.claudeModelOverride;

    // Cleanup old PTY, config, and timers (heartbeat + the backoff timer that
    // just fired). onExit already released the heartbeat, but stay consistent.
    this.clearAgentTimers(agent);
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
      currentTaskId: agent.currentTaskId,
      contextId: agent.launchConfig?.env?.MARBLO_CONTEXT,
      resumeSessionId: resolvedSessionId,
      onPtyReady,
      claudeModelOverride,
    });

    // Carry over restart counters; spawnedAt is freshly set by launch().
    newInstance.restartCount = restartCount;
    newInstance.fastFailCount = fastFailCount;
  }

  /**
   * Release an agent's lifecycle timers — the restart-backoff setTimeout and
   * the heartbeat setInterval — so neither (nor the telemetry the heartbeat
   * emits) outlives the agent's PTY. Idempotent and null-safe: every teardown
   * path (stop / restart / auto-restart / PTY exit) calls it so timer cleanup
   * stays consistent across them.
   */
  private clearAgentTimers(agent: AgentInstance): void {
    if (agent.restartTimer) {
      clearTimeout(agent.restartTimer);
      agent.restartTimer = null;
    }
    if (agent.heartbeatTimer) {
      clearInterval(agent.heartbeatTimer);
      agent.heartbeatTimer = null;
    }
  }

  stop(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Mark as intentional stop before killing
    agent.stopRequested = true;
    this.clearAgentTimers(agent);

    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    agent.status = "stopped";
    agent.terminalSince = Date.now(); // P3-4: pruner backstop clock
    agent.restartCount = 0;
    this.onStatusChange?.(agentId, "stopped");
    mainTelemetry.agentStopped(this.getMainWindow?.() ?? null, agentId, 0);
  }

  restart(agentId: string, initialPrompt?: string): AgentInstance | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Kill existing PTY + cleanup configs + heartbeat
    agent.stopRequested = true;
    this.clearAgentTimers(agent);
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
      currentTaskId: agent.currentTaskId,
      contextId: agent.launchConfig?.env?.MARBLO_CONTEXT,
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
    // No-op when status is unchanged. The new PTY-activity hook calls
    // setStatus("working") on every output chunk; without this guard each
    // chunk would fire onStatusChange → IPC broadcast → renderer rerender,
    // which is wasteful and could storm the renderer during heavy streams.
    if (agent.status === status) return;
    // W1: a genuine promotion to `working` (dispatch / route / nudge / a real
    // new turn) clears the completed-turn marker so follow-up work is never
    // suppressed by the settle window. The trailing-flush promotion is already
    // filtered out upstream by shouldPromoteOnPtyOutput, so anything that
    // reaches here as `working` is real work.
    if (status === "working") agent.turnCompletedAt = null;
    // P3-4: any transition back to a live state clears the terminal clock so a
    // revived agent isn't pruned by the backstop reaper.
    if (status !== "stopped" && status !== "error") agent.terminalSince = null;
    agent.status = status;
    this.onStatusChange?.(agentId, status);
  }

  /**
   * W1: mark the agent's current turn complete and free its slot immediately.
   * Called from the bridge /set-agent-status idle path (which fires when a
   * worker reports its bound task terminal via submit_for_review /
   * update_task_status). Stamps `turnCompletedAt` BEFORE demoting so the
   * trailing render flush that follows can't re-promote the agent to `working`
   * (shouldPromoteOnPtyOutput suppresses output-driven promotion for as long as
   * the completion report stands). Idempotent — safe to call repeatedly.
   */
  markTurnComplete(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === "stopped" || agent.status === "error") return;
    agent.turnCompletedAt = Date.now();
    // Retain the binding for the reaper BEFORE releasing it. Clearing
    // currentTaskId without this is what made every cleanly-completed agent
    // unreapable (see AgentInstance.lastTaskId).
    if (agent.currentTaskId) agent.lastTaskId = agent.currentTaskId;
    agent.currentTaskId = null;
    // Demote directly (bypass setStatus's working-clear path) so the marker
    // set above survives the transition to idle.
    if (agent.status !== "idle") {
      agent.status = "idle";
      this.onStatusChange?.(agentId, "idle");
    }
  }

  setCurrentTask(agentId: string, taskId: string | null): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.currentTaskId = taskId;
    if (taskId) agent.lastTaskId = taskId;
  }

  /**
   * A new turn was submitted to this agent — clear the completed-turn marker so
   * the agent can be promoted to `working` again.
   *
   * Wired to PtyManager.onSubmit, so it fires for EVERY way work arrives:
   * dispatch, reuse_agent, a nudge, a Telegram forward, or a human pressing
   * Enter in the terminal tab. That last one matters — without an input-side
   * signal, manual terminal use after a completion report would leave the agent
   * pinned at `idle` while it was genuinely working.
   *
   * Does not itself set `working`; the first output byte does that (promotion is
   * now unblocked). Ignored for terminal agents.
   */
  noteTurnStart(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === "stopped" || agent.status === "error") return;
    agent.turnCompletedAt = null;
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
      currentTaskId: null,
      lastTaskId: null,
      restartCount: 0,
      fastFailCount: 0,
      spawnedAt: Date.now(),
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
      lastPtyActivity: Date.now(),
      turnCompletedAt: null,
      terminalSince: null,
    };
    this.agents.set(agent.id, instance);
    // Same PTY-activity hook as launch() — reconnected agents need
    // working/idle auto-derivation too (incl. the W1 completed-turn suppression).
    this.ptyManager.onData(agent.ptySessionId, () => {
      const a = this.agents.get(agent.id);
      if (!a || a !== instance) return;
      a.lastPtyActivity = Date.now();
      if (
        shouldPromoteOnPtyOutput({
          status: a.status,
          stopRequested: a.stopRequested,
          turnCompletedAt: a.turnCompletedAt,
          now: Date.now(),
        })
      ) {
        this.setStatus(agent.id, "working");
      }
    });
    // Input side of the turn boundary — same as launch().
    this.ptyManager.onSubmit(agent.ptySessionId, () => {
      const a = this.agents.get(agent.id);
      if (!a || a !== instance) return;
      this.noteTurnStart(agent.id);
    });
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
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    for (const [id] of this.agents) {
      this.stop(id);
    }
    this.configGenerator.cleanupAll();
  }
}
