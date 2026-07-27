import fs from "fs";
import path from "path";
import os from "os";
import { encodeClaudeProjectDir, claudeProjectDir } from "./claude-paths";
import type { ModelType } from "./agent-manager";
import { PtyManager, type DangerEvent } from "./pty-manager";
import {
  AgentConfigGenerator,
  LaunchConfig,
  resolveOrchestratorModel,
  orchestratorCommandForModel,
} from "./agent-config";
import { contextForKind } from "./mcp-server/context";
import {
  CODEX_ORCH_REQUIRED_MCP_TOOL_COUNT,
  CODEX_ORCH_REQUIRED_MCP_TOOLS,
} from "./mcp-server/tool-surface";
import { YOLO_FLAG } from "./telegram-channels";
import { looksLikeLoginScreen } from "./harness-manager";
import { maskConfigForLogging } from "./config-redaction";

export type OrchestratorStatus = "stopped" | "starting" | "running" | "error";

// --- Auto-restart constants ---
// Codex 세션 소유권 마커. codex 는 concrete rollout id 로 resume 하지 않고
// 격리 CODEX_HOME 의 `resume --last` 로만 이어가므로, orch store 에는 세션
// uuid 대신 "이 kind/미션이 이 home 의 마지막 codex 세션 소유자" 라는 마커를
// 남긴다. claude 경로의 isResumableSession 은 이 값을 항상 거부하므로(실재
// .jsonl 아님) claude resolver 로 새어 들어갈 수 없다.
export const GPT_SESSION_MARKER = "gpt-latest";

const ORCH_MAX_RESTARTS = 3;
const ORCH_BACKOFF_BASE_MS = 2000;
const ORCH_BACKOFF_MAX_MS = 30000;
// A crash that happens more than this long after the PREVIOUS crash is treated
// as an INDEPENDENT failure and gets a fresh restart budget — it is not part of
// a crash loop. Sized comfortably above the max backoff (30s) plus a short
// unhealthy uptime, so a genuine crash loop (dies again within seconds of every
// restart) stays inside one budget while a once-in-a-while crash resets it.
// Without this, restartCount only ever reset in stop(), so a long-lived
// orchestrator's 4th LIFETIME crash exhausted the budget and permanently
// disabled auto-recovery even though every crash had recovered fine.
const ORCH_CRASH_LOOP_WINDOW_MS = 60_000;
const INJECT_BOOT_GATE_STABILITY_ATTEMPTS = 5;

// --- Concurrent-resume guard ---
// Two orchestrator instances — e.g. two worktrees in the fleet, which are
// SEPARATE OS processes — that `--resume` the SAME claude session id at the
// same time make Claude Code render the second PTY blank: the user's existing
// conversation appears to "vanish". We take an advisory, cross-process lock on
// the resumed session id in a per-project lock file. Liveness is decided
// PRIMARILY by whether the owning PID is still running (same host), with the
// TTL only as a backstop against PID reuse after an uncaught crash.
const ORCH_RESUME_LOCK_TTL_MS = 10 * 60 * 1000;

// Staleness backstop for the exclusive lockfile that serializes the resume-lock
// read-modify-write (P3-5). The critical section is microseconds, so any mutex
// file older than this was almost certainly abandoned by a crashed process
// mid-RMW and is safe to reclaim. Kept well above the critical-section time and
// well below ORCH_RESUME_LOCK_TTL_MS.
const ORCH_LOCK_MUTEX_STALE_MS = 15 * 1000;

interface OrchResumeLock {
  ptySessionId: string;
  kind: string;
  pid: number;
  updatedAt: number;
}

type OrchestratorMcpEnv = Record<string, string>;

export interface CodexMarbloSurfaceReport {
  codexHome: string;
  configPath: string;
  marbloMcpConfigured: boolean;
  tfPromptCount: number;
  requiredTfPromptsPresent: boolean;
  fallbackCliPresent: boolean;
  fallbackCliPath: string;
}

const SECRET_OUTPUT_GUARDRAIL =
  "Security guardrail: never cat/print/log raw `.env`, `.mcp.json`, firebase-config, service account JSON, OAuth/Toss/Paddle/API key files. When checking config, report only existence, paths, or masked values.";

const BOARD_ORCHESTRATOR_ONBOARDING =
  "Opening reply for a new board orchestrator session: greet the user first in a friendly way, mention tf skill examples such as /tf-add, /tf-start, and /tf-status, and say: 작업 요청하시면 보드에 티켓 생성하고 에이전트 스폰해드릴게요. Do not show boot diagnostics or internal startup logs as the opening reply.";

const BOARD_ORCHESTRATOR_ROUTING_GATE =
  "Routing gate for every user turn: A) work, artifacts, code changes, execution, or multi-step requests => create_task or create_tasks_bulk, then dispatch_task to a physical Marblo agent and leave a board ticket. Do not solve these inline. B) questions, status checks, approvals, or clarifications => answer directly with no ticket. If ambiguous, prefer A. Never use Claude Code's native Task tool or logical subagents for A; route through physical dispatch_task. Codex orchestrators must also avoid inline execution for A. Only trivial read-only checks may stay in the orchestrator session.";

function tomlEnvLine(key: string, value: string): string {
  return `${key} = ${JSON.stringify(value)}`;
}

function parseTomlEnvBlock(block: string): OrchestratorMcpEnv {
  const env: OrchestratorMcpEnv = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    try {
      const value = JSON.parse(rawValue) as unknown;
      if (typeof value === "string") {
        env[key] = value;
      }
    } catch {
      env[key] = rawValue.replace(/^"(.*)"$/, "$1");
    }
  }
  return env;
}

/**
 * `[mcp_servers.marblo.env]` 를 머지 패치한다. codex(CODEX_HOME/config.toml)와
 * grok(GROK_HOME/config.toml)이 **같은 TOML 섹션 이름**을 쓰므로 한 함수로 둘 다
 * 처리한다 — grok 을 JSON 분기로 보내면 `JSON.parse` 가 TOML 을 만나 던지고,
 * 브리지 포트/토큰이 통째로 유실돼 오케의 spawn_agent·dispatch_task 가 401 난다.
 */
function patchTomlMarbloMcpEnv(
  configPath: string,
  env: OrchestratorMcpEnv,
): void {
  const configContent = fs.readFileSync(configPath, "utf-8");
  const existingEnvMatch =
    /\n?\[mcp_servers\.marblo\.env\]\n([\s\S]*?)(?=\n\[|$)/.exec(configContent);
  const existingEnv = existingEnvMatch
    ? parseTomlEnvBlock(existingEnvMatch[1])
    : {};
  const mergedEnv = { ...existingEnv, ...env };
  const envEntries = Object.entries(mergedEnv)
    .map(([key, value]) => tomlEnvLine(key, value))
    .join("\n");
  if (!envEntries) return;

  const withoutExistingEnv = configContent
    .replace(/\n?\[mcp_servers\.marblo\.env\]\n[\s\S]*?(?=\n\[|$)/, "")
    .trimEnd();

  fs.writeFileSync(
    configPath,
    `${withoutExistingEnv}\n\n[mcp_servers.marblo.env]\n${envEntries}\n`,
    "utf-8",
  );
}

function inspectCodexMarbloSurface(
  configPath: string,
): CodexMarbloSurfaceReport {
  const codexHome = path.dirname(configPath);
  const configContent = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : "";
  const promptsDir = path.join(codexHome, "prompts");
  const tfPromptNames =
    fs.existsSync(promptsDir) && fs.statSync(promptsDir).isDirectory()
      ? fs
          .readdirSync(promptsDir)
          .filter((entry) => entry.startsWith("tf-") && entry.endsWith(".md"))
      : [];
  const requiredTfPromptsPresent = [
    "tf-add.md",
    "tf-start.md",
    "tf-status.md",
  ].every((entry) => tfPromptNames.includes(entry));
  const fallbackCliPath = path.join(
    codexHome,
    "bin",
    os.platform() === "win32" ? "marblo-fallback.cmd" : "marblo-fallback",
  );
  return {
    codexHome,
    configPath,
    marbloMcpConfigured: configContent.includes("[mcp_servers.marblo]"),
    tfPromptCount: tfPromptNames.length,
    requiredTfPromptsPresent,
    fallbackCliPresent: fs.existsSync(fallbackCliPath),
    fallbackCliPath,
  };
}

function assertCodexMarbloSurface(
  configPath: string,
): CodexMarbloSurfaceReport {
  const report = inspectCodexMarbloSurface(configPath);
  if (!report.marbloMcpConfigured) {
    throw new Error(
      `Codex config is missing [mcp_servers.marblo]: ${configPath}`,
    );
  }

  if (!report.requiredTfPromptsPresent) {
    console.warn(
      `[Orchestrator] Codex CODEX_HOME missing required tf prompts: ${path.join(
        report.codexHome,
        "prompts",
      )}`,
    );
  }
  if (!report.fallbackCliPresent) {
    console.warn(
      `[Orchestrator] Codex fallback CLI wrapper missing: ${report.fallbackCliPath}`,
    );
  }
  return report;
}

export function buildCodexBootHealthSummary(input: {
  projectId: string;
  contextId: string;
  bridgeConnected: boolean;
  surface: CodexMarbloSurfaceReport | null;
}): string {
  const surface = input.surface;
  return [
    `mcp=${surface?.marbloMcpConfigured ? "yes" : "no"}`,
    `bridge=${input.bridgeConnected ? "yes" : "no"}`,
    `project=${input.projectId ? "set" : "missing"}`,
    `context=${input.contextId || "none"}`,
    `requiredTools=${CODEX_ORCH_REQUIRED_MCP_TOOL_COUNT}`,
    `tfPrompts=${surface?.tfPromptCount ?? 0}`,
    `requiredTfPrompts=${surface?.requiredTfPromptsPresent ? "yes" : "no"}`,
    `fallback=${surface?.fallbackCliPresent ? "yes" : "no"}`,
  ].join("\n");
}

export function buildCodexBootInstructions(input: {
  surface: CodexMarbloSurfaceReport | null;
}): string {
  const fallbackLine =
    input.surface?.fallbackCliPresent && input.surface.fallbackCliPath
      ? `If Marblo MCP tools are unavailable, use fallback CLI: ${input.surface.fallbackCliPath}`
      : "If Marblo MCP tools are unavailable, report it briefly and ask for operator action.";
  return [
    "Codex orchestrator startup:",
    'First call get_agent_skill("orchestrator") and follow that skill.',
    BOARD_ORCHESTRATOR_ONBOARDING,
    BOARD_ORCHESTRATOR_ROUTING_GATE,
    `Required Marblo tools: ${CODEX_ORCH_REQUIRED_MCP_TOOLS.join(", ")}.`,
    "For /tf-add use create_task; for /tf-start use create_tasks_bulk then dispatch_task; for /tf-status use get_all_tasks.",
    fallbackLine,
    "Do not inspect source files to reconstruct Marblo tool behavior. Do not print env values, tokens, config contents, or raw .mcp.json/.env data.",
  ].join(" ");
}

// NOTE: Telegram is NO LONGER owned by any orchestrator. The getUpdates poller
// is owned directly by electron main (telegram-poller.ts), exactly one per
// project, so no orchestrator carries `--channels` and there is no per-project
// owner lock / handover here anymore (ticket vw38IB2VcmOIOlFV51Wa). The prior
// single-owner lock only narrowed the 409 flapping caused by orchestrator churn
// spawning/killing pollers; moving ownership out of the orchestrator removes
// the race entirely.

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

export interface OrchestratorLaunchOptions {
  modelOverride?: ModelType;
  /**
   * claude 오케를 띄울 **구체 모델 id**(`--model` 값). 모델 셀렉터가 Claude 변형
   * (Fable 5 / Opus 4.8 …)을 고르면 채워진다. undefined 면 종전대로 플래그 없이
   * 떠서 CLI 기본 모델을 상속한다 — 즉 기존 경로는 바이트 동일하다.
   *
   * 호출자(main.ts)가 이미 버전가드(`resolveClaudeModelPinned`)를 통과시킨 값을
   * 넘긴다. 여기서 다시 검증하지 않는 이유는 폴백 로그가 두 번 찍히지 않게 하기
   * 위해서다.
   */
  claudeModelOverride?: string;
  /**
   * codex 오케를 띄울 **구체 모델 id**(`-c model="…"` 값). 모델 셀렉터가 Codex
   * 변형(gpt-5.6-sol / terra / luna …)을 고르면 채워진다. undefined 면 종전대로
   * 플래그 없이 떠서 사용자 `~/.codex/config.toml` 의 모델을 그대로 쓴다 — 즉
   * 기존 "Codex" 선택 경로는 바이트 동일하다.
   */
  codexModelOverride?: string;
  /**
   * codex reasoning effort(`-c model_reasoning_effort="…"` 값). 오케는 난도 티어를
   * 타지 않으므로(complexity 미지정) 이 값이 없으면 CLI 기본 effort 가 그대로다.
   *
   * ★승인게이트(max/ultra, #602)는 여기 오기 전에 이미 걸러진다 —
   * `model-selection.splitOrchestratorModelValue` 가 셀렉터·저장값·env 세 입구를
   * 모두 통과시키는 유일한 문이다.
   */
  codexEffortOverride?: string;
  handoffPrompt?: string;
  handoffMode?: "wait" | "takeover";
}

/** Second argument handed to launch()'s `onPtyReady` callback. */
export interface OrchestratorPtyReadyInfo {
  /**
   * True when launch() ATTACHED to an already-running PTY rather than spawning
   * a new one. Callers must register ownership (so output reaches their window)
   * but must NOT re-run PTY output forwarding: `PtyManager.onData` ADDS a
   * node-pty listener, so wiring it twice duplicates every byte in the
   * terminal.
   */
  reused: boolean;
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

function withBoardRoutingGate(text: string): string {
  return `[Marblo routing gate]\n${BOARD_ORCHESTRATOR_ROUTING_GATE}\n\n${text}`;
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
  // Wall-clock of the most recent crash, used to distinguish a crash LOOP
  // (rapid, keeps the budget) from INDEPENDENT crashes across a healthy run
  // (resets the budget). See ORCH_CRASH_LOOP_WINDOW_MS / registerCrashForRestart.
  private lastCrashAt: number | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLaunchArgs: {
    projectId: string;
    rootPath: string;
    bridgePort: number;
  } | null = null;
  private lastLaunchOptions?: OrchestratorLaunchOptions;
  private lastOnPtyReady?: (
    ptySessionId: string,
    info: OrchestratorPtyReadyInfo,
  ) => void;
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
  private injectChain: Promise<boolean> = Promise.resolve(true);

  // --- Safety guard (MVP-P0-1) ---
  // The orchestrator drives the MAIN checkout (not a sandboxed worktree), so a
  // dangerous command injected into its PTY is the highest-risk path. We record
  // detections that target this orchestrator's session for visibility.
  private dangerWarnings: DangerEvent[] = [];
  private static readonly MAX_DANGER_WARNINGS = 100;

  // Called when a launch/relaunch is abandoned because rootPath is gone. The
  // status alone ("error") does not say WHY, and this failure mode is otherwise
  // invisible — the shell dies before printing anything. main.ts wires this to
  // a user-facing notice so a removed worktree reads as a removed worktree.
  private onRootPathMissing?: (rootPath: string) => void;

  /** Register the rootPath-missing notice sink (see {@link onRootPathMissing}). */
  setRootPathMissingHandler(handler: (rootPath: string) => void): void {
    this.onRootPathMissing = handler;
  }

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
  injectMessage(text: string): Promise<boolean> {
    const expectPty = this.session?.ptySessionId ?? null;
    const expectMissionId = this.currentMissionId;
    const injectedText =
      this.kind === "board" ? withBoardRoutingGate(text) : text;
    const next = this.injectChain
      .catch(() => false)
      .then(async (): Promise<boolean> => {
        const stableGate = await this.waitForStableBootGate();
        if (!stableGate) return false;
        const cur = this.session?.ptySessionId ?? null;
        const status = this.session?.status ?? "stopped";
        // 게이트 대기 중 세션이 사라졌거나 멈췄으면 호출부가 offset 을 보류할 수
        // 있게 false 를 반환한다. 절대 조용한 성공으로 가장하지 않는다.
        if (!cur || (status !== "starting" && status !== "running")) {
          return false;
        }
        // 미션이 바뀌었으면 낡은 grant 를 새 미션 오케스트레이터에 흘리지
        // 않는다. ensureMissionOrchestratorLaunched(main.ts) 는 missionId 변경
        // 시 같은 매니저를 동기 stop() -> launch() 하므로 이 창이 실제로 열린다.
        // 조용한 성공으로 가장하지 않고 false 를 반환해 호출부가 보류/재시도하게
        // 한다.
        if (this.currentMissionId !== expectMissionId) {
          return false;
        }
        // 같은 미션(또는 board)인데 PTY 만 바뀐 경우(오케 전환/재시작)는 유실보다
        // 재해석 전달이 옳다. waitForStableBootGate 가 새 세션의 부팅 제출 사이클
        // 종료를 보장하므로 boot prompt 와 인터리브되지 않는다.
        if (expectPty && cur !== expectPty) {
          console.warn(
            `[OrchestratorManager:${this.kind}] injectMessage PTY changed while queued; routing to current PTY ${cur}.`,
          );
        }
        const wrote = await this.ptyManager.writeAndSubmit(cur, injectedText);
        if (!wrote) return false;
        // 다음 주입이 이 메시지의 제출 사이클과 겹치지 않도록 여유를 둔다(직렬화).
        await new Promise((r) => setTimeout(r, 2500));
        return true;
      });
    this.injectChain = next;
    return next;
  }

  private async waitForStableBootGate(): Promise<boolean> {
    for (let i = 0; i < INJECT_BOOT_GATE_STABILITY_ATTEMPTS; i += 1) {
      const gate = this.bootGate;
      await gate;
      if (this.bootGate === gate) return true;
    }
    console.warn(
      `[OrchestratorManager:${this.kind}] injectMessage boot gate kept changing; holding delivery for retry.`,
    );
    return false;
  }

  /**
   * Decide whether an incoming launch() can ATTACH to the session already
   * running here instead of killing it and respawning.
   *
   * The orchestrator PTY is main-process state that must outlive any single
   * renderer. Before this existed, launch() unconditionally did
   * `if (this.session) this.stop()`, so a second launch for the SAME project —
   * a renderer remount after a Vite full-reload, a second window opening the
   * same project, a reconnect — silently killed the boss's live conversation
   * and respawned it. That is the "오케가 혼자 끊긴다" P0.
   *
   * Attach only when the request is genuinely for the SAME orchestrator:
   * same project, same rootPath, same model, same owning mission. A change in
   * any of those is a different orchestrator and must respawn (the model switch
   * path in particular — orchestratorSession:switch — calls stop() explicitly
   * before launching, so it never reaches here with a live session).
   *
   * `resumeSessionId` is deliberately NOT part of the match: when a session is
   * already live, that live conversation IS the session, and resuming a
   * different one would mean discarding it. The only callers that pass a
   * concrete id are the reconnect paths (which want exactly this attach) and
   * the panel's Start button (which is gated behind `if (isRunning) return`).
   */
  private findAttachableSession(
    projectId: string,
    rootPath: string,
    model: ModelType,
    ownerMissionId: string | null,
  ): OrchestratorSession | null {
    const current = this.session;
    if (!current) return null;
    if (current.status !== "running" && current.status !== "starting") {
      return null;
    }
    if (current.projectId !== projectId) return null;
    if (current.rootPath !== rootPath) return null;
    // launchConfig is optional on the type; without it we cannot prove the
    // running model matches, so fail safe and respawn rather than attach.
    if (!current.launchConfig || current.launchConfig.model !== model) {
      return null;
    }
    if ((this.currentMissionId ?? null) !== ownerMissionId) return null;
    // Status can lag reality — onExit removes the PTY from PtyManager before
    // our status listener necessarily ran. Attaching to a dead ptySessionId
    // would hand the renderer a terminal that never emits another byte, which
    // is a WORSE failure than respawning. Verify the process is really there.
    if (!this.ptyManager.hasSession(current.ptySessionId)) return null;
    return current;
  }

  launch(
    projectId: string,
    rootPath: string,
    bridgePort: number,
    onPtyReady?: (ptySessionId: string, info: OrchestratorPtyReadyInfo) => void,
    resumeSessionId?: string, // specific session ID or 'latest' for --continue
    ownerMissionId?: string, // kind="mission" 운전 대상 미션 id (세션 store 키잉용)
    launchOptions?: OrchestratorLaunchOptions,
  ): OrchestratorSession {
    // Model must be resolved BEFORE the attach check — a model change is one of
    // the few things that legitimately forces a respawn.
    const orchestratorModel: ModelType =
      launchOptions?.modelOverride ?? resolveOrchestratorModel();

    // ── Idempotent re-launch ────────────────────────────────────────────────
    // Same orchestrator, already running → attach. We hand the caller the
    // EXISTING ptySessionId and let it (re)register ownership, but we do NOT
    // respawn, do NOT re-send the boot prompt, and do NOT touch the resume
    // lock. `reused: true` tells the caller its PTY output forwarding is
    // already wired: re-running it would ADD a second node-pty data listener
    // and duplicate every byte in the terminal.
    const attachable = this.findAttachableSession(
      projectId,
      rootPath,
      orchestratorModel,
      ownerMissionId ?? null,
    );
    if (attachable) {
      // Keep the newest caller's wiring for crash auto-restart, so a respawn
      // reattaches to the window that most recently asked for this session.
      this.lastOnPtyReady = onPtyReady;
      console.log(
        `[Orchestrator:${this.kind}] launch(project=${projectId}) matched the RUNNING session — attaching to ${attachable.ptySessionId} instead of respawning` +
          (resumeSessionId && resumeSessionId !== "new"
            ? ` (requested resume "${resumeSessionId}" ignored: the live session takes precedence)`
            : ""),
      );
      onPtyReady?.(attachable.ptySessionId, { reused: true });
      return attachable;
    }

    // Not attachable — a stale/mismatched session must go before we respawn.
    if (this.session) {
      this.stop();
    }

    // Store args for auto-restart
    this.lastLaunchArgs = { projectId, rootPath, bridgePort };
    this.lastOnPtyReady = onPtyReady;
    this.lastLaunchOptions = launchOptions;
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
    this.injectChain = Promise.resolve(true);

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
    let effectiveResumeSessionId = resumeSessionId;
    if (orchestratorModel === "gpt") {
      const hasSavedCodexSession = this.configGenerator.hasSavedSession(
        sessionId,
        "gpt",
      );
      if (!effectiveResumeSessionId || effectiveResumeSessionId === "latest") {
        if (hasSavedCodexSession) {
          effectiveResumeSessionId = "latest";
        } else if (effectiveResumeSessionId === "latest") {
          console.log(
            `[Orchestrator:${this.kind}] Codex resume requested but no saved session exists for ${sessionId}; starting new`,
          );
          effectiveResumeSessionId = undefined;
        }
      } else if (effectiveResumeSessionId !== "new") {
        // Concrete id under codex. Marblo never persists codex rollout ids
        // (codex is resumed via `resume --last` against its isolated home),
        // so any concrete id reaching here was minted by ANOTHER CLI — a
        // claude uuid from a model-unaware resolver. `codex resume
        // <unknown-id>` exits 1 ("No saved session found") → 오케 즉사.
        // Never pass it through: resume this home's own last session when
        // one exists, else start fresh. (0zV1apB3CvIiabHlYHxQ / 56C9L5DP)
        if (hasSavedCodexSession) {
          console.warn(
            `[Orchestrator:${this.kind}] Discarding non-codex resume id "${effectiveResumeSessionId}" for ${sessionId} → resuming latest saved codex session instead`,
          );
          effectiveResumeSessionId = "latest";
        } else {
          console.warn(
            `[Orchestrator:${this.kind}] Discarding non-codex resume id "${effectiveResumeSessionId}" for ${sessionId}; no saved codex session — starting new`,
          );
          effectiveResumeSessionId = undefined;
        }
      }
    }

    const allowAutoResume =
      this.kind === "board" && orchestratorModel === "claude";
    const shouldResume =
      effectiveResumeSessionId ||
      (allowAutoResume && this.hasClaudeSession(rootPath));
    console.log(
      `[Orchestrator:${this.kind}] rootPath=${rootPath}, resumeSessionId=${
        effectiveResumeSessionId || "auto"
      }, shouldResume=${!!shouldResume}`,
    );

    // Generate MCP config for orchestrator. Model is env-selectable via
    // MARBLO_ORCHESTRATOR_MODEL (default "claude"). The default path resolves
    // to model:"claude"/command:"claude" — byte-identical to the previous
    // hardcoding, so current behavior is unchanged. Selecting codex/local here
    // only constructs the launchConfig for that binary; the orchestrator's
    // actual readiness/prompt/session wiring for non-claude models is a
    // separate follow-up (backlog IUj7YTFqJVZvi9AbtTPf).
    const nonClaudeResumeSessionId =
      orchestratorModel === "claude" ||
      !effectiveResumeSessionId ||
      effectiveResumeSessionId === "new"
        ? undefined
        : effectiveResumeSessionId;
    const launchConfig = this.configGenerator.getLaunchConfig(
      {
        id: sessionId,
        model: orchestratorModel,
        role: "orchestrator",
        command: orchestratorCommandForModel(orchestratorModel),
      },
      rootPath,
      undefined,
      projectId,
      nonClaudeResumeSessionId,
      // pinClaudeSession: 오케는 자기 세션 수명을 직접 관리한다(종전 기본값 유지).
      false,
      // complexity: 오케는 난도 티어를 타지 않는다(종전대로 미지정).
      undefined,
      // 모델 셀렉터가 고른 변형. 미지정 축은 플래그 자체가 안 붙는다
      // (claude=--model, codex=-c model=/-c model_reasoning_effort=).
      {
        claudeModel: launchOptions?.claudeModelOverride,
        codexModel: launchOptions?.codexModelOverride,
        codexEffort: launchOptions?.codexEffortOverride,
      },
    );

    // ── YOLO(권한 스킵) 보장 ────────────────────────────────────────────
    // 오케스트레이터는 샌드박스가 아닌 MAIN 체크아웃을 운전하므로 무인 실행을 위해
    // 모델별 unattended 플래그를 문다. Claude/Antigravity 는
    // --dangerously-skip-permissions 를 지원하지만 Codex 는 같은 문자열을
    // unknown argument 로 보고 exit code 2 로 종료한다. Codex 의 unattended
    // 설정은 AgentConfigGenerator 의 -c approval_policy/sandbox_mode 로 이미
    // 구성되므로 여기서는 해당 플래그를 추가하지 않는다.
    //
    // ★Telegram: 오케는 더 이상 `--channels plugin:telegram` 을 물지 않는다. 봇당
    // 단일 소비자인 getUpdates 폴러는 electron main(telegram-poller.ts)이 프로젝트당
    // 정확히 1개만 소유하며, 오케 churn(재기동/resume/handover)과 무관하게 돈다.
    // 그래서 여기서의 채널 플래그 주입·단일 소유자 게이팅·토큰 env 주입은 전부 제거됐다
    // (ticket vw38IB2VcmOIOlFV51Wa).
    if (
      (launchConfig.model === "claude" ||
        launchConfig.model === "antigravity") &&
      !launchConfig.args.includes(YOLO_FLAG)
    ) {
      launchConfig.args.unshift(YOLO_FLAG);
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
    if (
      launchConfig.model === "claude" &&
      effectiveResumeSessionId &&
      effectiveResumeSessionId !== "new"
    ) {
      resumeCandidate = this.resolveSessionId(
        rootPath,
        effectiveResumeSessionId,
        labelTarget,
      );
      if (!resumeCandidate) {
        console.log(
          `[Orchestrator] No matching orchestrator session found for "${effectiveResumeSessionId}", starting new`,
        );
      }
    } else if (
      launchConfig.model === "claude" &&
      !effectiveResumeSessionId &&
      shouldResume
    ) {
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
    let resumedCliSessionId: string | null = null;
    if (resumeCandidate && launchConfig.model === "claude") {
      if (this.acquireResumeLock(rootPath, resumeCandidate, ptySessionId)) {
        launchConfig.args.push("--resume", resumeCandidate);
        resumedSessionId = resumeCandidate;
        resumedCliSessionId = resumeCandidate;
        console.log(
          `[Orchestrator:${
            this.kind
          }] Resuming session: ${resumeCandidate} (requested: ${
            effectiveResumeSessionId ?? "auto"
          })`,
        );
      } else {
        console.warn(
          `[Orchestrator:${this.kind}] Session ${resumeCandidate} is already attached by another live orchestrator instance — starting a FRESH session to avoid a blank PTY (concurrent --resume guard).`,
        );
      }
    } else if (launchConfig.model === "gpt" && nonClaudeResumeSessionId) {
      resumedCliSessionId = nonClaudeResumeSessionId;
      console.log(
        `[Orchestrator:${this.kind}] Resuming Codex session: ${
          nonClaudeResumeSessionId === "latest"
            ? "latest (--last)"
            : nonClaudeResumeSessionId
        } (requested: ${resumeSessionId ?? "auto"})`,
      );
    }

    const context =
      this.kind === "mission"
        ? (this.currentMissionId ?? "")
        : contextForKind(this.kind);

    // Inject MARBLO_BRIDGE_PORT into PTY env AND MCP config
    launchConfig.env.MARBLO_BRIDGE_PORT = String(bridgePort);
    // Per-session bearer token for the bridge's authenticated endpoints. The
    // bridge sets process.env.MARBLO_BRIDGE_TOKEN at boot (same main process);
    // forward it so the orchestrator's MCP can call spawn_agent/dispatch_task
    // without 401ing. Empty string when the bridge hasn't booted yet.
    const bridgeToken = process.env.MARBLO_BRIDGE_TOKEN ?? "";
    if (bridgeToken) {
      launchConfig.env.MARBLO_BRIDGE_TOKEN = bridgeToken;
    }
    if (context) {
      launchConfig.env.MARBLO_CONTEXT = context;
    }

    const mcpEnvPatch: OrchestratorMcpEnv = {
      ELECTRON_RUN_AS_NODE: "1",
      MARBLO_BRIDGE_PORT: String(bridgePort),
      MARBLO_PROJECT: projectId,
      MARBLO_ORCHESTRATOR_PTY_SESSION_ID: ptySessionId,
    };
    launchConfig.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID = ptySessionId;
    if (bridgeToken) {
      mcpEnvPatch.MARBLO_BRIDGE_TOKEN = bridgeToken;
    }
    if (context) {
      mcpEnvPatch.MARBLO_CONTEXT = context;
    }

    // Also patch the MCP config file so the MCP server (node process)
    // gets MARBLO_BRIDGE_PORT — needed for spawn_agent tool
    try {
      if (launchConfig.model === "gpt" || launchConfig.model === "grok") {
        patchTomlMarbloMcpEnv(launchConfig.mcpConfigPath, mcpEnvPatch);
      } else {
        const configContent = fs.readFileSync(
          launchConfig.mcpConfigPath,
          "utf-8",
        );
        const config = JSON.parse(configContent) as {
          mcpServers?: {
            marblo?: {
              env?: Record<string, string>;
            };
          };
        };
        if (config.mcpServers?.marblo?.env) {
          Object.assign(config.mcpServers.marblo.env, mcpEnvPatch);
          fs.writeFileSync(
            launchConfig.mcpConfigPath,
            JSON.stringify(config, null, 2),
            "utf-8",
          );
          console.info(
            `[Orchestrator:${this.kind}] MCP config patched`,
            maskConfigForLogging({
              configPath: launchConfig.mcpConfigPath,
              mcpServers: {
                marblo: {
                  env: config.mcpServers.marblo.env,
                },
              },
            }),
          );
        }
      }
    } catch (e) {
      // Best-effort, but NOT silent: a failed patch here means the MCP config
      // file never receives MARBLO_BRIDGE_TOKEN/PORT, so the orchestrator's MCP
      // node calls spawn_agent / dispatch_task against the bridge and 401s with
      // no obvious cause (P3-6). Surface the failure so a broken dispatch is
      // traceable to the token/port injection instead of looking like an auth bug.
      console.warn(
        `[Orchestrator:${
          this.kind
        }] MCP config patch failed (bridge token/port not injected → spawn_agent/dispatch_task may 401): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    const codexSurface =
      launchConfig.model === "gpt"
        ? assertCodexMarbloSurface(launchConfig.mcpConfigPath)
        : null;

    // Merge env
    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...launchConfig.env,
      MARBLO_PROJECT: projectId,
    };
    // Prevent nested Claude Code sessions
    delete mergedEnv.CLAUDECODE;

    // Create PTY. create() now rejects a missing/non-directory cwd up front
    // (it used to spawn a shell that died in ~6ms with no error). Surface that
    // as an error status + explicit notice rather than letting it escape as an
    // unhandled rejection through the IPC boundary.
    try {
      this.ptyManager.create(
        ptySessionId,
        "Orchestrator",
        launchConfig.command,
        launchConfig.args,
        rootPath,
        mergedEnv,
      );
    } catch (err) {
      this.setStatus("error");
      this.configGenerator.cleanup(sessionId);
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        console.error(
          `[Orchestrator] Cannot launch in "${rootPath}" — the directory is gone.`,
        );
        this.onRootPathMissing?.(rootPath);
      }
      throw err;
    }

    // P3-3: enforce (not just log) the dangerous-command guard on THIS PTY. The
    // orchestrator drives the non-isolated MAIN checkout under YOLO
    // (--dangerously-skip-permissions), so a high-severity command injected into
    // its stdin (boot prompt / conductor grant / telegram relay) would run
    // unguarded. Blocking is scoped to this session id so worktree-isolated
    // workers stay in warn-only mode (their task text may legitimately mention
    // such commands). Cleared automatically when the PTY is killed on
    // stop()/relaunch. onDanger (wired in the constructor) still records + logs.
    this.ptyManager.setBlockDangerousForSession(ptySessionId, true);

    // Notify caller IMMEDIATELY so they can register data listeners. Fresh
    // spawn → the caller MUST wire forwarding (contrast the attach path above).
    onPtyReady?.(ptySessionId, { reused: false });

    this.session = {
      sessionId,
      ptySessionId,
      status: "starting",
      projectId,
      rootPath,
      launchConfig,
      claudeSessionId: resumedSessionId ?? undefined,
    };

    // Codex 세션은 rollout id 를 우리가 저장하지 않으므로(resume 은 항상
    // `--last`), 대신 "이 미션이 이 codex home 의 마지막 세션 소유자" 라는
    // 마커를 orch store 에 남긴다. 재시작 시 같은 미션이면 `latest` 로
    // 이어가고, 다른(새) 미션이면 fresh 로 뜨는 미션 단위 연속성의 근거.
    if (launchConfig.model === "gpt" && this.kind === "mission") {
      this.saveOrchSessionId(rootPath, GPT_SESSION_MARKER);
    }

    // Send initial prompt only for NEW sessions (not resumed ones). Gate on
    // whether we ACTUALLY resumed (lock acquired + session matched), not on the
    // mere request — a fall-back-to-fresh must still send the boot prompt.
    if (resumedCliSessionId) {
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
      if (launchConfig.model === "gpt") {
        console.info(
          `[Orchestrator:${
            this.kind
          }] Codex boot health: ${buildCodexBootHealthSummary({
            projectId,
            contextId: context,
            bridgeConnected: Boolean(bridgePort),
            surface: codexSurface,
          })}`,
        );
      }
      const codexOrchestratorInstructions =
        launchConfig.model === "gpt"
          ? buildCodexBootInstructions({ surface: codexSurface })
          : "";
      const baseInitialPrompt =
        this.kind === "mission"
          ? [
              "You are the Marblo Mission Orchestrator (B-mode, orchestrator-driven).",
              `Read the orchestrator skill with get_agent_skill("orchestrator") and follow ONLY its Mission section (§6 — orchestrator-driven). Ignore the board tf-* slash commands.`,
              SECRET_OUTPUT_GUARDRAIL,
              codexOrchestratorInstructions,
              "You drive exactly ONE mission. Do NOT start anything on your own.",
              "Wait for the conductor (지휘자) to grant the first step via a system message, then execute that step with run_skill and report with mission_step_done.",
            ]
              .filter(Boolean)
              .join(" ")
          : [
              "You are the Marblo Orchestrator Agent.",
              `Read the orchestrator skill file: use get_agent_skill("orchestrator")`,
              SECRET_OUTPUT_GUARDRAIL,
              launchConfig.model === "gpt" ? "" : BOARD_ORCHESTRATOR_ONBOARDING,
              launchConfig.model === "gpt"
                ? ""
                : BOARD_ORCHESTRATOR_ROUTING_GATE,
              codexOrchestratorInstructions,
              "Wait for user instructions.",
            ]
              .filter(Boolean)
              .join(" ");
      const initialPrompt = launchOptions?.handoffPrompt
        ? `${baseInitialPrompt}\n\n${launchOptions.handoffPrompt}`
        : baseInitialPrompt;

      let sent = false;
      // Login-screen backstop: the orchestrator is always claude. If it boots
      // into `claude login` (unauthenticated), suppress the boot prompt rather
      // than typing it into the login menu (which navigates the menu and exits
      // Claude cleanly → dead PTY). checkSpawnAuthGate at the IPC layer
      // normally prevents this; this is the defense-in-depth backstop.
      let authBlocked = false;
      const sendPrompt = () => {
        if (sent || authBlocked) return;
        if (this.session?.ptySessionId !== ptySessionId) return;
        sent = true;
        this.ptyManager.writeAndSubmit(ptySessionId, initialPrompt);
        this.setStatus("running");
        // 부팅 프롬프트의 제출 사이클(text→150ms→CR+재시도 ~2s)이 끝난 뒤에야
        // conductor grant 주입을 허용한다 → 같은 PTY 동시 write 인터리브 제거.
        setTimeout(
          () => this.resolveBootGate(),
          launchConfig.model === "gpt" ? 1500 : 3500,
        );
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
        /Ask Codex/i,
        /Enter to send/i,
        /Explain this codebase/i,
        /esc to interrupt/i,
      ];
      this.ptyManager.onData(ptySessionId, (data) => {
        if (sent || authBlocked) return;
        outputBuffer += data;
        if (outputBuffer.length > 4096)
          outputBuffer = outputBuffer.slice(-4096);
        // Login-screen backstop — never inject the boot prompt into a
        // `claude login` menu; surface an error the UI can act on instead.
        if (
          launchConfig.model === "claude" &&
          looksLikeLoginScreen(outputBuffer)
        ) {
          authBlocked = true;
          console.error(
            "[Orchestrator] Login prompt detected — suppressing boot prompt " +
              "(claude needs auth: run `claude login`).",
          );
          this.setStatus("error");
          return;
        }
        for (const pattern of readinessPatterns) {
          if (pattern.test(outputBuffer)) {
            // Wait for the input prompt to fully render before sending.
            setTimeout(sendPrompt, launchConfig.model === "gpt" ? 250 : 1500);
            return;
          }
        }
      });

      // Fallback: send after a model-specific timeout even if no readiness
      // pattern matched. Codex gets a shorter backstop because its project dir
      // is pre-trusted in config.toml; keeping Claude at 10s preserves the
      // existing trust/auth-dialog safety margin.
      setTimeout(sendPrompt, launchConfig.model === "gpt" ? 3500 : 10000);
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
    if (launchConfig.model === "claude") {
      this.detectAndLabelNewSession(
        rootPath,
        ptySessionId,
        existingRawIds,
        labelTarget,
      );
    }

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

      // Root gone → NOT a crash we can retry out of. A shell spawned into a
      // deleted directory exits 1 in milliseconds without ever running the
      // harness, so restarting into the same rootPath just burns the budget in
      // 14s and lands on a silent "error" status. This is the common shape now
      // that windows can point at `~/.marblo/worktrees/**` trees that are later
      // removed. Stop immediately and name the actual cause instead.
      if (!fs.existsSync(rootPath)) {
        if (this.restartTimer) {
          clearTimeout(this.restartTimer);
          this.restartTimer = null;
        }
        if (this.session?.claudeSessionId) {
          this.releaseResumeLock(rootPath, this.session.claudeSessionId);
        }
        this.setStatus("error");
        this.configGenerator.cleanup(sessionId);
        console.error(
          `[Orchestrator] Working directory no longer exists — not restarting: "${rootPath}" (exit ${exitCode}). Reopen the project on a path that still exists.`,
        );
        this.onRootPathMissing?.(rootPath);
        return;
      }

      // Crash detected — attempt auto-restart with backoff, but only within the
      // crash-LOOP budget. registerCrashForRestart resets the budget first when
      // this crash is independent of the previous one (healthy run in between),
      // so an occasional crash never permanently disables auto-recovery.
      const attempt = this.registerCrashForRestart(Date.now());
      if (attempt !== null && this.lastLaunchArgs) {
        // Back off on the PRE-increment attempt number so the first restart of a
        // loop waits ORCH_BACKOFF_BASE_MS (attempt 1 → 2^0), matching the prior
        // schedule exactly (2s, 4s, 8s).
        const delay = Math.min(
          ORCH_BACKOFF_BASE_MS * Math.pow(2, attempt - 1),
          ORCH_BACKOFF_MAX_MS,
        );
        console.log(
          `[Orchestrator] Crash (exit ${exitCode}). Restart ${attempt}/${ORCH_MAX_RESTARTS} in ${delay}ms`,
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
          const restartModel =
            this.lastLaunchOptions?.modelOverride ?? resolveOrchestratorModel();
          const resumeTarget =
            restartModel === "gpt"
              ? "latest"
              : this.kind === "mission" && ownerMission
                ? (this.resolveMissionResumeId(rp, ownerMission) ?? "new")
                : (this.resolveOrchestratorResumeId(rp) ?? "new");
          this.launch(
            pId,
            rp,
            bp,
            this.lastOnPtyReady,
            resumeTarget,
            ownerMission,
            this.lastLaunchOptions,
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

  /**
   * Record a crash and decide whether an auto-restart is still in budget.
   *
   * ORCH_MAX_RESTARTS guards against a crash LOOP — a session that dies again
   * within seconds of every restart — NOT against independent crashes spread
   * across a long healthy run. If the previous crash was more than
   * ORCH_CRASH_LOOP_WINDOW_MS ago, this crash is independent: reset the budget
   * before counting it, so a once-in-a-while crash never permanently disables
   * auto-recovery. (Before this, restartCount only ever reset in stop(), so a
   * long-lived orchestrator's 4th LIFETIME crash hit the cap and it went
   * permanently to "error" despite every crash having recovered fine.)
   *
   * Returns the 1-based restart attempt number when a restart is in budget, or
   * null when the crash-loop budget is exhausted (give up). Mutates
   * restartCount and lastCrashAt. Pass Date.now() so the clock is injectable
   * from tests.
   */
  private registerCrashForRestart(now: number): number | null {
    if (
      this.lastCrashAt !== null &&
      now - this.lastCrashAt > ORCH_CRASH_LOOP_WINDOW_MS
    ) {
      if (this.restartCount > 0) {
        console.log(
          `[Orchestrator] ${Math.round(
            (now - this.lastCrashAt) / 1000,
          )}s since last crash — independent failure, resetting restart budget`,
        );
      }
      this.restartCount = 0;
    }
    this.lastCrashAt = now;
    if (this.restartCount >= ORCH_MAX_RESTARTS) return null;
    this.restartCount += 1;
    return this.restartCount;
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
    this.lastCrashAt = null;
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

  private getOrchLockMutexPath(rootPath: string): string {
    return this.getOrchLocksPath(rootPath) + ".lock";
  }

  /**
   * Acquire the cross-process mutex guarding the resume-locks read-modify-write
   * (P3-5). `fs.openSync(path, "wx")` is an atomic create-exclusive: at most one
   * process across all worktrees can hold it at a time. Returns the open fd on
   * success, or null when a DIFFERENT live process currently holds it (the
   * caller then treats that as contention and starts fresh — the fail-safe that
   * avoids a double `--resume`/blank PTY). A mutex file older than
   * ORCH_LOCK_MUTEX_STALE_MS is assumed abandoned by a crashed process and is
   * reclaimed once.
   */
  private acquireLockMutex(rootPath: string): number | null {
    const mutexPath = this.getOrchLockMutexPath(rootPath);
    try {
      return fs.openSync(mutexPath, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null;
      // EEXIST → either a live holder mid-RMW, or a mutex left by a crash.
      // Reclaim ONLY if stale, so we never yank the lock from a live holder.
      try {
        const age = Date.now() - fs.statSync(mutexPath).mtimeMs;
        if (age > ORCH_LOCK_MUTEX_STALE_MS) {
          fs.unlinkSync(mutexPath);
          return fs.openSync(mutexPath, "wx");
        }
      } catch {
        /* stat/unlink raced another reclaimer — fall through to contention */
      }
      return null;
    }
  }

  private releaseLockMutex(fd: number | null, rootPath: string): void {
    if (fd === null) return;
    try {
      fs.closeSync(fd);
    } catch {
      /* best-effort */
    }
    try {
      fs.unlinkSync(this.getOrchLockMutexPath(rootPath));
    } catch {
      /* best-effort */
    }
  }

  /**
   * Try to claim the resume lock for `claudeSessionId`. Returns false when a
   * different, still-running orchestrator already holds it — the caller then
   * starts a fresh session instead of double-attaching (which blanks the PTY).
   *
   * P3-5: the read → isForeignLiveLock → write sequence is a non-atomic RMW.
   * Two orchestrators (typically in separate worktrees) launching at once could
   * both read before either writes, both see no live lock, and both `--resume`
   * the same session → both PTYs blank. We serialize the RMW behind an exclusive
   * lockfile (acquireLockMutex). The pid-liveness + TTL logic in the JSON stays
   * the source of truth for OWNERSHIP; the mutex only makes the update atomic.
   * On genuine contention (mutex held by a live peer) we fail safe to "taken"
   * so the caller starts fresh — never a double-resume.
   */
  private acquireResumeLock(
    rootPath: string,
    claudeSessionId: string,
    ptySessionId: string,
  ): boolean {
    const mutexFd = this.acquireLockMutex(rootPath);
    if (mutexFd === null) {
      console.warn(
        `[Orchestrator:${this.kind}] resume-lock mutex contended — starting a FRESH session (TOCTOU guard).`,
      );
      return false;
    }
    try {
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
    } finally {
      this.releaseLockMutex(mutexFd, rootPath);
    }
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

  /**
   * gpt(codex) 미션 연속성 판정: 이 미션이 codex home 의 마지막 세션 소유자로
   * 마킹돼 있으면 true → 호출부가 "latest"(`codex resume --last`) 로 이어간다.
   * 다른 미션 소유거나 마커가 없으면 false → fresh. codex 는 rollout id 를
   * 우리가 저장하지 않으므로 이 마커가 미션 단위 resume 근거의 전부다.
   */
  hasGptMissionMarker(rootPath: string, missionId: string): boolean {
    if (this.kind !== "mission" || !missionId) return false;
    return (
      this.readOrchStore(rootPath)[`mission:${missionId}`]?.sessionId ===
      GPT_SESSION_MARKER
    );
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
