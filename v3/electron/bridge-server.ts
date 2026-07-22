import http from "http";
import crypto from "crypto";
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
  scoreModelsDetailed as scoreModelsDetailedFn,
  resolvePreset,
  normalizeModel,
  isWorktreeIsolated,
  checkPlanConcurrency,
  isAgentContextReusable,
  budgetBiasScore,
  type AgentInfo,
  type ModelSelection,
  type ModelBudgetSnapshot,
} from "./dispatch-scoring";
import {
  loadRoutingGraph,
  graphBiasDetailForModel,
  type GraphContext,
} from "./routing-graph";
import { mainTelemetry, type DispatchDecisionPayload } from "./telemetry";
import { resolveTopClaudeModelDetailed } from "./agent-config";
import { getAccountRateLimits, type AccountRateLimits } from "./account-usage";
import type { RateLimitInfo } from "./session-parsers";
import { decideAutoMix, isAutoMixEnabled, autoMixThresholds } from "./auto-mix";
import { issueFreshAgentCustomToken } from "./firebase-auth-sync";
import type { WorktreeCoordinator } from "./worktree-coordinator";

function rateLimitToBudgetInfo(
  info: RateLimitInfo | null,
): { usedPercent: number } | undefined {
  if (!info) return undefined;
  const readings = [info.primaryPercent, info.secondaryPercent].filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p),
  );
  if (readings.length === 0) return undefined;
  return { usedPercent: Math.max(...readings) };
}

function accountRateLimitsToBudgetSnapshot(
  rateLimits: AccountRateLimits,
): ModelBudgetSnapshot {
  const budgets: ModelBudgetSnapshot = {};
  const claude = rateLimitToBudgetInfo(rateLimits.claude);
  const gpt = rateLimitToBudgetInfo(rateLimits.gpt);
  if (claude) budgets.claude = claude;
  if (gpt) budgets.gpt = gpt;
  return budgets;
}

const TASK_AGENT_FIRST_ACTIVITY_GRACE_MS = 180_000;

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
    // 완료 보고 규약: REVIEW/DONE 으로 닫기 직전, "무엇이 문제였고 어떻게 풀었는지"
    // 구조화 요약을 티켓에 한 건 남긴다. 보드/티켓에서 완료 내역을 한눈에 보기 위함.
    // submit_for_review/update_task_status 에 summary 로 같은 필드를 직접 넘겨도 된다.
    `- 완료 직전 보고: add_activity(task_id="${taskId}", message="✅ 완료 보고\\n- 문제: ...\\n- 접근: ...\\n- 변경: ...\\n- 검증: ...\\n- PR: ...") — 보드/티켓에서 완료 내역을 한눈에 보기 위해 필수.`,
    `- 정상 완료 / 리뷰 가능: submit_for_review(task_id="${taskId}", pr_url?, summary?) — summary 에 {problem,approach,changes,verification,pr} 를 주면 위 보고를 자동 기록한다.`,
    `- 실패 / 반려: update_task_status(task_id="${taskId}", status="FAILED", comment="이유")`,
    "완료/실패/차단 같은 중요 이벤트만 오케스트레이터 PTY 로 자동 주입된다.",
    // 막힘 규약: 대상만 사용자→오케로 바꾼다. "묻지 말고 추측하라"가 아니다 —
    // 근거 없는 추측 수정은 '머지됨≠동작함' 오판을 낳으므로 질문 자체는 옳다.
    // 문제는 ①대상이 사용자 ②질문 후 전면 정지 ③오케에 안 보임, 이 셋뿐이다.
    "",
    "[막혔을 때 — 사용자에게 직접 묻지 말 것]",
    "- 근거가 없으면 추측으로 고치지 마라. 모르면 묻는 게 맞다. 단 물어볼 대상은 사용자가 아니라 오케스트레이터다.",
    `- 질문·확인 요청: add_activity(task_id="${taskId}", message="[질문] 필요한 것: ... / 이유: ... / 못 받으면 막히는 범위: ...") — "[질문]" 표기가 있어야 오케 PTY 로 즉시 전달된다.`,
    `- 그 미지 때문에 진행이 실제로 멈추면: update_task_status(task_id="${taskId}", status="BLOCKED", comment="무엇을 기다리는지") — BLOCKED 도 즉시 전달된다.`,
    "- ★질문했다고 작업 전체를 멈추지 마라. 그 미지와 무관하게 진행 가능한 잔여 작업은 계속하고, 답이 오면 막혔던 부분을 이어서 한다.",
    "- 사용자만 답할 수 있는 것(스크린샷, 라이브 관측값, 제품 판단)이라도 오케에 보고하면 오케가 판단해 답하거나 사장님께 모아 전달한다.",
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
  /** Short routing decision reason retained for lifecycle outcome telemetry. */
  dispatchReason?: string;
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

interface ValidateOrchestratorSessionRequest {
  /** Project ID forwarded by the MCP server's MARBLO_PROJECT env. */
  projectId?: string;
  /** Same routing context used by /notify-orchestrator. */
  contextId?: string;
  /** PTY session id injected into the orchestrator's MCP env at launch. */
  ptySessionId?: string;
  /** Diagnostics only; never trusted as authority. */
  agentId?: string;
  /** Diagnostics only; included so bridge logs can name the blocked tool. */
  toolName?: string;
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

export function validateOrchestratorSessionIdentity(input: {
  expectedPtySessionId?: string;
  currentSession?: { ptySessionId: string; status: string } | null;
}): { valid: boolean; reason: string; currentPtySessionId?: string } {
  const expectedPtySessionId = input.expectedPtySessionId ?? "";
  if (!expectedPtySessionId) {
    return {
      valid: false,
      reason: "missing orchestrator PTY session id",
    };
  }

  const session = input.currentSession;
  if (
    !session ||
    (session.status !== "starting" && session.status !== "running")
  ) {
    return {
      valid: false,
      reason: "orchestrator session is not running",
      currentPtySessionId: session?.ptySessionId,
    };
  }

  if (session.ptySessionId !== expectedPtySessionId) {
    return {
      valid: false,
      reason: "stale orchestrator PTY session",
      currentPtySessionId: session.ptySessionId,
    };
  }

  return {
    valid: true,
    reason: "current orchestrator PTY session",
    currentPtySessionId: session.ptySessionId,
  };
}

const IMPORTANT_TASK_UPDATE_STATUSES = new Set(["DONE", "FAILED", "BLOCKED"]);

/**
 * A blocked agent idles silently unless this returns true — `[Task Activity]`
 * is otherwise dropped below. An agent that asks a question but forgets the
 * BLOCKED transition used to vanish from the orchestrator's view entirely
 * (2026-07-19: project-missing-popup, homebutton-regression both idled for
 * several turns). The "[질문]" marker is what the dispatch footer mandates;
 * the natural-phrasing patterns are the safety net for when it's omitted.
 */
function mentionsBlockedOrNeedsInput(message: string): boolean {
  return (
    /\b(stuck|blocked|blocker|blocking)\b/i.test(message) ||
    /막힘|차단|블로커/.test(message) ||
    /\[질문\]/.test(message) ||
    /\b(needs?|awaiting|waiting for)\s+(input|clarification|confirmation|answer)\b/i.test(
      message,
    ) ||
    /확인 필요|답변 필요|판단 필요|확인 부탁|알려주세요/.test(message)
  );
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
  if (mentionsBlockedOrNeedsInput(trimmed)) return true;

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

// ── Local RCE hardening (per-session bearer token + host check) ──────────────
//
// The bridge is a localhost HTTP server that, via /spawn-agent + /dispatch-task,
// can launch processes with an attacker-chosen command/cwd at the user's
// privilege. Without auth, ANY local process (or a web page abusing
// DNS-rebinding / port brute-forcing 127.0.0.1) could drive it → local RCE.
// Defenses, layered:
//   1. Per-session bearer token — generated at boot, written to a 0600 discovery
//      file only the same OS user can read. A web page can't read local files,
//      so it can't obtain the token. Sensitive endpoints 401 without it.
//   2. Host-header allowlist — blocks DNS-rebinding (a rebound page still sends
//      its own Host, e.g. attacker.com).
//   3. Command allowlist — even an authenticated caller can only spawn a known
//      CLI (claude/gemini/codex/agy), never an arbitrary command.
//   4. Body-size cap — bounds request bodies so a local client can't OOM main.

/** Max request body the bridge will buffer (1 MiB). Spawn/dispatch payloads are
 * a few KB at most; anything larger is abuse. */
export const MAX_BRIDGE_BODY_BYTES = 1024 * 1024;

/** Discovery-file names under ~/.marblo (mirrors the existing bridge-port file). */
export const BRIDGE_PORT_FILE = "bridge-port";
export const BRIDGE_TOKEN_FILE = "bridge-token";

/**
 * True only when the request's Host header names the loopback interface.
 * Strips the optional :port and unwraps IPv6 brackets. A missing Host is
 * rejected (legitimate fetch() to http://127.0.0.1:<port> always sends one;
 * DNS-rebinding pages send their attacker hostname).
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    // Bracketed IPv6: [::1] or [::1]:port
    const end = h.indexOf("]");
    h = end >= 0 ? h.slice(1, end) : h.slice(1);
  } else {
    // Strip a :port suffix only for IPv4/hostnames (a single colon). A bare
    // IPv6 literal (multiple colons, no brackets) carries no port suffix, so
    // leave it intact rather than truncating at its first colon.
    const colonCount = (h.match(/:/g) || []).length;
    if (colonCount === 1) {
      h = h.slice(0, h.indexOf(":"));
    }
  }
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/** CLI binaries the bridge is allowed to spawn (basenames of getDefaultCommand). */
export const ALLOWED_SPAWN_COMMANDS = new Set([
  "claude",
  "gemini",
  "codex",
  "agy",
]);

/**
 * Validate an optional spawn `command` override against the allowlist.
 *  - empty/undefined → allowed (spawnNewAgent falls back to getDefaultCommand).
 *  - otherwise the command must be a single token (no args, no shell
 *    metacharacters) whose basename is a known CLI.
 * This rejects arbitrary-command RCE (e.g. "node /tmp/x.js", "sh -c …") while
 * still permitting both bare ("claude") and absolute ("/usr/local/bin/claude")
 * forms of the known fleet binaries.
 */
export function isAllowedSpawnCommand(command: string | undefined): boolean {
  if (command === undefined || command === null) return true;
  const trimmed = String(command).trim();
  if (!trimmed) return true;
  // No whitespace (→ no arguments) and no shell metacharacters.
  if (/\s/.test(trimmed)) return false;
  if (/[;&|`$(){}<>\\\n\r"'*?!~]/.test(trimmed)) return false;
  const base = trimmed.split("/").pop() || trimmed;
  return ALLOWED_SPAWN_COMMANDS.has(base);
}

/**
 * Constant-time bearer-token check. Returns true only when the Authorization
 * header carries exactly `Bearer <expected>`. Empty `expected` (no token
 * configured) always fails closed.
 */
export function bearerTokenMatches(
  authHeader: string | string[] | undefined,
  expected: string,
): boolean {
  if (!expected) return false;
  if (!authHeader || Array.isArray(authHeader)) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const want = Buffer.from(expected);
  if (provided.length !== want.length) return false;
  return crypto.timingSafeEqual(provided, want);
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
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
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

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function taskAgentFirstActivityGraceMs(): number {
  return intEnv(
    process.env,
    "MARBLO_WATCHDOG_FIRST_ACTIVITY_MS",
    TASK_AGENT_FIRST_ACTIVITY_GRACE_MS,
  );
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
  /** Deprecated compatibility flag. simple 작업도 기본으로 물리 에이전트 +
   * 보드 티켓 경로를 탄다. 논리 서브에이전트는 useLogical=true 로만 opt-in. */
  isolate?: boolean;
  /** Explicit opt-in for orchestrator-internal logical handling. Default false:
   * even complexity==="simple" spawns/reuses a physical agent and gets board
   * tracking. */
  useLogical?: boolean;
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
 *   POST /inject-message       — inject a PM instruction into an agent/orch PTY
 *   GET  /health               — health check
 *
 * ── Threat model (P3-3) — ACCEPTED residual risk, documented, not a hole ──
 * Command-bearing endpoints (/spawn-agent, /dispatch-task, /inject-message, …)
 * are protected by the strongest controls available to a localhost helper:
 *   - bind 127.0.0.1 only + non-loopback Host header rejected (isLoopbackHost)
 *     → no remote or DNS-rebinding reach;
 *   - per-boot 256-bit bearer token, constant-time compared, fail-closed
 *     (checkAuthToken) → a browser/web page with no local FS access can never
 *     obtain the token (discovery files are 0600, same-OS-user only);
 *   - spawn command allowlist (ALLOWED_SPAWN_COMMANDS, shell metachars/args
 *     rejected) + 1 MiB body cap.
 * The ONE risk these cannot remove: any process running as the SAME OS user can
 * read the 0600 token file and then legitimately call these endpoints — and
 * because every agent/orchestrator runs YOLO (--dangerously-skip-permissions,
 * see orchestrator-manager launch()), an injected instruction executes without
 * a confirm prompt. That is effectively same-user RCE. We ACCEPT it: on a
 * single-user desktop, a same-user process already has full ambient authority
 * (it can write ~/.zshrc, spawn `claude` itself, etc.), so the bridge grants no
 * privilege the caller didn't already have. Defense-in-depth against an
 * injected *destructive* command is the PtyManager dangerous-command guard,
 * which the orchestrator PTY runs in BLOCK mode (not warn-only) — see
 * setBlockDangerousForSession / danger-command.ts.
 */
export class BridgeServer {
  private server: http.Server | null = null;
  private port = 0;
  // Per-session bearer token guarding the sensitive (command-bearing) endpoints.
  // Generated on start(), written to a 0600 discovery file legitimate same-user
  // clients read, and mirrored into process.env.MARBLO_BRIDGE_TOKEN so spawned
  // agents / orchestrators inherit it. Empty until start() runs.
  private token = "";
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

  // Hook injected by main: persists the RESOLVED dispatch context (cwd / model /
  // complexity) onto the board task doc as `dispatchMeta` once a dispatch
  // confirms its agent. The agent-health watchdog reads this back on respawn so
  // recovery restores the original cwd + model instead of re-resolving them —
  // which dropped the explicit cwd override (→ fresh empty base worktree, false
  // BLOCKED) and re-selected the model (→ a claude worker reborn as gpt).
  // Best-effort, fire-and-forget — never blocks or fails a dispatch.
  private dispatchMetaHook:
    | ((
        taskId: string,
        meta: {
          cwd: string;
          model: string;
          complexity?: string;
          dispatchReason?: string | null;
          // KG routing (spec 2026-07-22): the dispatch's context factors, so the
          // graph-updater can attribute a later outcome to the right cells
          // (role/tags × model) without re-deriving them. taskType is optional
          // (electron can't import the src classifier) — absent → graceful
          // degradation (role/tag/complexity cells still populate).
          role?: string;
          tags?: string[];
          taskType?: string;
        },
      ) => void)
    | null = null;

  // Hook injected by main: checks whether a task-bound agent produced at least
  // one real board activity after the dispatch/bind baseline. Used by the
  // per-task reuse short-circuit so a born-dead, non-terminal CLI cannot keep
  // winning "already bound" forever.
  private taskAgentActivityHook:
    | ((
        taskId: string,
        agentId: string,
      ) =>
        | Promise<{ hasBoardActivity: boolean }>
        | { hasBoardActivity: boolean })
    | null = null;

  // Outbound Telegram sender — main wires this to the electron-owned
  // TelegramPoller.sendMessage (the poller holds the bot token + last-inbound
  // chat). The send_telegram_message MCP tool POSTs /send-telegram-message and
  // the bridge routes here. Null until wired (tool then reports it's
  // unavailable). Returns a token-SCRUBBED result — never surfaces the token.
  private sendTelegramMessage:
    | ((
        projectId: string,
        text: string,
        chatId?: string,
      ) => Promise<{ ok: boolean; chatId?: string; error?: string }>)
    | null = null;
  private ghostReclaim:
    | (() => Promise<{
        scanned: number;
        reclaimed: Array<{ id: string; name: string; reason: string }>;
      }>)
    | null = null;

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

  // Ghost-doc reclaim hook (main's runGhostReclaimSweep). Lets cleanup_agents
  // reach agents that exist only as Firestore docs of a dead previous Electron
  // instance — invisible to the in-memory passes above. Ownership/liveness
  // gating lives in agent-lifecycle-reclaim.ts; this is just the transport.
  setGhostReclaim(
    fn: () => Promise<{
      scanned: number;
      reclaimed: Array<{ id: string; name: string; reason: string }>;
    }>,
  ): void {
    this.ghostReclaim = fn;
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

  /** Wire the dispatch-meta persister (main writes `dispatchMeta` onto the task
   * doc). Until wired, dispatch still works — the watchdog just falls back to
   * the live AgentInstance for cwd/model on respawn. */
  setDispatchMetaHook(
    hook: (
      taskId: string,
      meta: {
        cwd: string;
        model: string;
        complexity?: string;
        dispatchReason?: string | null;
        role?: string;
        tags?: string[];
        taskType?: string;
      },
    ) => void,
  ): void {
    this.dispatchMetaHook = hook;
  }

  /** Wire the board-activity proof lookup used by findLiveTaskAgent. */
  setTaskAgentActivityHook(
    hook: (
      taskId: string,
      agentId: string,
    ) => Promise<{ hasBoardActivity: boolean }> | { hasBoardActivity: boolean },
  ): void {
    this.taskAgentActivityHook = hook;
  }

  /** Wire the outbound Telegram sender (main → TelegramPoller.sendMessage). */
  setSendTelegramMessage(
    fn: (
      projectId: string,
      text: string,
      chatId?: string,
    ) => Promise<{ ok: boolean; chatId?: string; error?: string }>,
  ): void {
    this.sendTelegramMessage = fn;
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

  /** Per-session bearer token for in-process callers (e.g. main's
   * /inject-message). Empty until start() has run. */
  getToken(): string {
    return this.token;
  }

  /** Whether a request carries the valid per-session bearer token. */
  private isAuthorized(req: http.IncomingMessage): boolean {
    return bearerTokenMatches(req.headers["authorization"], this.token);
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Loopback-only RPC server. No browser is a legitimate client, so we do
        // NOT emit a wildcard Access-Control-Allow-Origin — a `*` would let any
        // web page read responses and, via DNS-rebinding, drive spawns. Omitting
        // the allow-origin header makes browsers block cross-origin reads by
        // default; non-browser clients (Node fetch) ignore CORS entirely.
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );
        res.setHeader("Vary", "Origin");

        // DNS-rebinding defense: reject any request whose Host isn't loopback.
        if (!isLoopbackHost(req.headers.host)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Forbidden: non-local host",
            }),
          );
          return;
        }

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Body-size guard — cap buffered request bodies so a hostile local
        // client can't OOM the main process. Attached before routing so it
        // covers every handler; destroys the socket once the cap is exceeded.
        let receivedBytes = 0;
        req.on("data", (chunk: Buffer | string) => {
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > MAX_BRIDGE_BODY_BYTES) {
            try {
              if (!res.headersSent) {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    success: false,
                    error: "Payload too large",
                  }),
                );
              }
            } catch {
              /* headers may already be sent — ignore */
            }
            req.destroy();
          }
        });

        // /health is the only unauthenticated route (liveness probe; leaks
        // nothing beyond "a bridge is here"). Everything else requires the
        // per-session bearer token.
        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", port: this.port }));
          return;
        }

        if (!this.isAuthorized(req)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: "Unauthorized: missing or invalid bearer token",
            }),
          );
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

        if (
          req.method === "POST" &&
          req.url === "/validate-orchestrator-session"
        ) {
          this.handleValidateOrchestratorSession(req, res);
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

        if (req.method === "POST" && req.url === "/reclaim-ghosts") {
          this.handleReclaimGhosts(res);
          return;
        }

        if (req.method === "POST" && req.url === "/inject-message") {
          this.handleInjectMessage(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/send-telegram-message") {
          this.handleSendTelegram(req, res);
          return;
        }

        if (req.method === "POST" && req.url === "/agent-custom-token") {
          this.handleAgentCustomToken(res);
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
        // Per-session bearer token (256-bit). Regenerated every boot so a stale
        // token from a previous run can't be replayed.
        this.token = crypto.randomBytes(32).toString("hex");
        // Set bridge port + token in process.env so ALL spawned agents and
        // orchestrators inherit them via getMCPServerEnv() in agent-config.ts.
        process.env.MARBLO_BRIDGE_PORT = String(this.port);
        process.env.MARBLO_BRIDGE_TOKEN = this.token;
        // Write discovery files so external Claude Code sessions (using the
        // globally-registered Marblo MCP) can find a running Marblo + its token
        // without us hard-coding a port. The MCP server reads these at startup
        // when the env vars are not already injected. Both are 0600 — only the
        // same OS user may read the token, which is what keeps a web page (no
        // local file access) from ever obtaining it.
        try {
          const dir = path.join(os.homedir(), ".marblo");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, BRIDGE_PORT_FILE),
            String(this.port),
            {
              mode: 0o600,
            },
          );
          fs.writeFileSync(path.join(dir, BRIDGE_TOKEN_FILE), this.token, {
            mode: 0o600,
          });
          // writeFileSync's mode only applies on create; chmod existing files so
          // an upgrade from a prior 0644 port file is also tightened.
          try {
            fs.chmodSync(path.join(dir, BRIDGE_PORT_FILE), 0o600);
            fs.chmodSync(path.join(dir, BRIDGE_TOKEN_FILE), 0o600);
          } catch {
            /* best-effort on platforms without POSIX modes */
          }
        } catch (err) {
          console.warn(
            "[BridgeServer] Failed to write port/token discovery files:",
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
        // Retained across markTurnComplete's binding release, so a cleanly
        // completed agent stays reapable. Without it the completion report
        // erased the only evidence the reaper could match on — see agent-reap.ts.
        lastTaskId: a.lastTaskId,
        lastPtyActivity: a.lastPtyActivity,
      }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agents }));
  }

  // ── POST /agent-custom-token — MCP 자가 재인증용 신선한 토큰 발급 ──────────
  // MCP 서버(별도 프로세스)가 상속받은 custom token 이 만료/거부됐을 때 앱
  // 재시작 없이 재인증할 수 있는 유일한 경로 (티켓 etTRzsjqSr3S60xS5Wva).
  // mission app 이 실사용자로 로그인돼 있을 때만 issueAgentCustomToken callable
  // 로 새 토큰을 발급한다 — 익명/미로그인 상태에선 409 로 거부.
  // 상단의 bearer 토큰 게이트(isAuthorized)가 이미 이 라우트를 보호한다:
  // 토큰 파일은 0600 이라 같은 OS 사용자 프로세스만 접근 가능 — spawn 된
  // 에이전트가 env 로 custom token 을 상속받는 기존 신뢰 경계와 동일하다.

  private handleAgentCustomToken(res: http.ServerResponse): void {
    void issueFreshAgentCustomToken()
      .then((result) => {
        if (!result.ok) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: result.error ?? "custom token issue failed",
            }),
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            customToken: result.customToken,
            uid: result.uid,
          }),
        );
      })
      .catch((err: unknown) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
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

        // Command allowlist (defense-in-depth past the bearer token): refuse an
        // arbitrary `command` override — only known fleet CLIs may be spawned.
        // Empty command falls back to getDefaultCommand(model) in spawnNewAgent.
        if (!isAllowedSpawnCommand(params.command)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: `Disallowed command override: only ${[
                ...ALLOWED_SPAWN_COMMANDS,
              ].join("/")} are permitted`,
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

  // ── POST /validate-orchestrator-session ───────────────────────

  private handleValidateOrchestratorSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let params: ValidateOrchestratorSessionRequest;
      try {
        params = JSON.parse(body) as ValidateOrchestratorSessionRequest;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            valid: false,
            error: `Invalid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          }),
        );
        return;
      }

      const projectId = params.projectId ?? "";
      const contextId = params.contextId ?? "";
      const target = resolveNotifyTarget(contextId);
      const orch =
        target === "mission"
          ? this.missionOrchestratorLookup(projectId)
          : this.orchestratorLookup(projectId);
      const validation = validateOrchestratorSessionIdentity({
        expectedPtySessionId: params.ptySessionId,
        currentSession: orch?.getSession(),
      });

      if (!validation.valid) {
        console.warn(
          `[BridgeServer] Rejected stale ${target} orchestrator MCP write ` +
            `(project=${projectId || "missing"}, context=${
              contextId || "board"
            }, agent=${params.agentId || "unknown"}, tool=${
              params.toolName || "unknown"
            }): ${validation.reason}`,
        );
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          target,
          valid: validation.valid,
          reason: validation.reason,
          currentPtySessionId: validation.currentPtySessionId,
        }),
      );
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

        // Write instruction to agent's PTY stdin (split for discrete Enter).
        // Footer carries both the completion protocol and the "막혔을 때" rule
        // (report to the orchestrator, never ask the user directly). The
        // dispatch/spawn paths already append it; reuse used to skip it, so a
        // reused agent knew how to work but not how to report or unblock.
        this.ptyManager.writeAndSubmit(
          agent.ptySessionId,
          withCompletionFooter(params.instruction, params.taskId),
        );

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
    const res = params.taskId
      ? await this.withTaskLock(params.taskId, () =>
          this.dispatchTaskInner(params),
        )
      : await this.dispatchTaskInner(params);
    // Persist the resolved cwd/model/complexity so the watchdog can restore them
    // on respawn (no fresh base worktree, no claude→gpt). Only when a real agent
    // was bound to a task — "logical" (internal sub-agent) has no PTY/worktree,
    // and a failed dispatch resolved nothing.
    if (
      params.taskId &&
      res.success &&
      res.agentId &&
      res.action !== "logical"
    ) {
      this.persistDispatchMeta(params.taskId, res.agentId, params);
    }
    return res;
  }

  /** Persist the resolved dispatch context onto the task doc (via the main-wired
   * hook) so the watchdog can restore it on respawn. cwd/model come from the
   * live AgentInstance — the post-resolution source of truth for both fresh
   * spawns AND reused/restarted agents — and complexity/role/tags from the
   * request. role/tags are additionally the KG graph-updater's attribution keys
   * (spec 2026-07-22 §7): they let a later outcome (stale/crash/merged) be
   * folded into the right (context × model) cells without re-deriving them.
   * No-op when the hook is unset or the agent can't be resolved. */
  private persistDispatchMeta(
    taskId: string,
    agentId: string,
    params: DispatchTaskRequest,
  ): void {
    if (!this.dispatchMetaHook) return;
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) return;
    try {
      this.dispatchMetaHook(taskId, {
        cwd: agent.cwd,
        model: agent.model,
        complexity: params.complexity,
        dispatchReason: agent.dispatchReason,
        // Prefer the agent's resolved role (may differ from the request when a
        // dispatch routed to an already-bound agent), fall back to the request.
        role: agent.role || params.role,
        tags: params.tags,
        // taskType intentionally omitted here: electron can't import the src
        // classifyTaskType() (module-boundary), and the request carries no
        // taskType. The graph degrades gracefully to role/tag/complexity cells.
      });
    } catch (err) {
      console.warn("[BridgeServer] persistDispatchMeta failed:", err);
    }
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
    // §B/티켓 XL3NhdW — usage 기반 자동 믹스(기본 off). 명시적 mix 가 없고
    // complex 이며 MARBLO_AUTO_MIX 가 켜졌을 때만, Codex·Claude 둘 다 연결 +
    // 전체 usage 여유 조건에서 자동으로 Codex 교차검증을 걸거나(mix), 한쪽이
    // 소진 임박이면 반대 모델로 1차 라우팅(rerouteModel)한다. 결정은 순수함수
    // decideAutoMix 가 내리고, 여기서는 그 결정을 dispatchMix/dispatchSingle 로
    // 적용만 한다(폴백=현행 단일 디스패치 → 무회귀).
    if (isComplex && !params.mix && isAutoMixEnabled()) {
      const auto = await this.resolveAutoMix(params, complexity);
      if (auto) {
        let next = params;
        // reroute 는 decideAutoMix 가 model 미명시일 때만 채우므로 명시 지정
        // 을 덮어쓸 위험이 없다(재배정 가드 정책 보존).
        if (auto.rerouteModel) {
          next = { ...next, model: auto.rerouteModel };
        }
        if (auto.mix) {
          return this.dispatchMix(next, auto.mix);
        }
        if (next !== params) {
          return this.dispatchSingle(next);
        }
      }
    }
    return this.dispatchSingle(params);
  }

  /**
   * §B — 현재 account-global usage 를 프로브해 자동 믹스/라우팅 결정을 낸다.
   * 순수 판정은 decideAutoMix 가 하고, 여기서는 usage 프로브(TTL 캐시)와 enabled
   * 모델 판별 같은 부작용/조회만 담당한다. 프로브 실패 시엔 usage=null 로 넘어가
   * decideAutoMix 가 "정보없음 → 무동작"으로 안전 폴백한다. 반환 null 은
   * "적용할 결정 없음"(현행 단일 디스패치).
   */
  private async resolveAutoMix(
    params: DispatchTaskRequest,
    complexity: "simple" | "standard" | "complex",
  ): Promise<{
    mix?: "cross-check" | "split-role";
    rerouteModel?: ModelType;
  } | null> {
    const enabledModels =
      params.enabledModels ||
      (this.enabledModelsLookup(params.projectId ?? "") as
        | ModelType[]
        | undefined) ||
      resolvePreset(process.env.MARBLO_MODEL_PRESET);
    const claudeEnabled = (enabledModels as ModelType[]).includes("claude");
    const gptEnabled = (enabledModels as ModelType[]).includes("gpt");
    const effectiveModel = normalizeModel(params.model);

    // 둘 다 연결돼 있어야만 usage 프로브를 돌린다(불필요한 CLI 스폰 회피).
    if (!claudeEnabled || !gptEnabled) return null;

    let rateLimits: AccountRateLimits = { claude: null, gpt: null };
    try {
      rateLimits = await getAccountRateLimits();
    } catch (err) {
      console.warn(
        `[BridgeServer] auto-mix usage 프로브 실패 — 무동작 폴백: ${String(
          err,
        )}`,
      );
    }

    const { headroomPct, exhaustPct } = autoMixThresholds();
    const decision = decideAutoMix({
      enabled: true,
      complexity,
      explicitMix: !!params.mix,
      explicitModel: !!effectiveModel,
      effectiveModel,
      claudeEnabled,
      gptEnabled,
      claude: rateLimits.claude,
      gpt: rateLimits.gpt,
      headroomPct,
      exhaustPct,
    });

    console.log(`[BridgeServer] auto-mix 결정: ${decision.reason}`);
    if (!decision.mix && !decision.rerouteModel) return null;
    return { mix: decision.mix, rerouteModel: decision.rerouteModel };
  }

  private async dispatchSingle(
    params: DispatchTaskRequest,
  ): Promise<DispatchTaskResponse> {
    const {
      role,
      instruction,
      complexity = "standard",
      tags = [],
      useLogical = false,
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

    // Step 0: Logical agent is now explicit opt-in only. The default for simple
    // tasks is the normal physical path below, which guarantees board tracking
    // and still uses the cheap simple model tier (claude=sonnet, codex=low).
    if (complexity === "simple" && useLogical) {
      return {
        success: true,
        action: "logical",
        reason: `Simple task — logical sub-agent explicitly requested (useLogical=true)`,
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
        (agent) => !requiresTrackedModel || isTrackedDispatchModel(agent.model),
      );

    // L3/RG — per-task single-agent guarantee. A task-bound live agent wins
    // before normal idle reuse scoring. The binding can come from the isolated
    // worktree cwd or the in-memory currentTaskId set by dispatch. This closes
    // the observed reassign gap where the original worker was still live but a
    // different just-idle agent scored as reusable for the same task.
    const taskAgent = await this.findLiveTaskAgent(
      allAgents,
      params.projectId,
      params.taskId,
      model,
    );
    if (taskAgent && params.taskId) {
      return this.routeToTaskAgent(
        taskAgent,
        effectiveInstruction,
        params.taskId,
      );
    }

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
    const budgetModels = new Set<ModelType>([
      ...allAgents.map((agent) => agent.model),
      ...(enabledModels as ModelType[]),
      ...(model ? [model] : []),
    ]);
    let budgetSnapshot: ModelBudgetSnapshot = {};
    if (budgetModels.has("claude") || budgetModels.has("gpt")) {
      try {
        budgetSnapshot = accountRateLimitsToBudgetSnapshot(
          await getAccountRateLimits(),
        );
      } catch (err) {
        console.warn(
          `[BridgeServer] dispatch budget usage probe failed — neutral budgetBias fallback: ${String(
            err,
          )}`,
        );
      }
    }

    // Step 1 & 2: Score existing agents
    const scored = this.scoreAgents(
      allAgents,
      role,
      model,
      tags,
      budgetSnapshot,
    );
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
      this.agentManager.setDispatchReason(fullAgent.id, candidate.reason);
      this.syncAgentStatus(fullAgent.id, "working", params.taskId);

      console.log(
        `[BridgeServer] Dispatch: reused '${candidate.agent.name}' (score=${candidate.score})`,
      );
      // Decision snapshot: reuse picked an existing idle agent via agent-level
      // scoring (scoreAgents) — no fresh model competition ran, so eligibleModels
      // / perModelScores are empty; agentScore carries the winning match score.
      this.emitDispatchDecision({
        taskId: params.taskId ?? null,
        agentId: fullAgent.id,
        role,
        complexity,
        tags,
        eligibleModels: [],
        selectedModel: candidate.agent.model,
        perModelScores: [],
        decisionReason: candidate.reason,
        reuseVsSpawn: "reuse",
        explicitModel: !!model,
        agentScore: candidate.score,
      });
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
        this.agentManager.setDispatchReason(restarted.id, best.reason);
        this.syncAgentStatus(restarted.id, "working", params.taskId);

        console.log(
          `[BridgeServer] Dispatch: restarted '${best.agent.name}' (score=${best.score})`,
        );
        this.emitDispatchDecision({
          taskId: params.taskId ?? null,
          agentId: restarted.id,
          role,
          complexity,
          tags,
          eligibleModels: [],
          selectedModel: best.agent.model,
          perModelScores: [],
          decisionReason: best.reason,
          reuseVsSpawn: "restart",
          explicitModel: !!model,
          agentScore: best.score,
        });
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

    const eligibleModels = requiresTrackedModel
      ? trackedModelCandidates(enabledModels as ModelType[])
      : (enabledModels as ModelType[]);
    if (model) {
      const explicitBudget = budgetBiasScore(model, budgetSnapshot);
      if (explicitBudget.bias === null) {
        const reason = `Explicit model '${model}' is budget exhausted — dispatch blocked.`;
        this.emitDispatchDecision({
          taskId: params.taskId ?? null,
          role,
          complexity,
          tags,
          eligibleModels: eligibleModels as string[],
          selectedModel: model,
          perModelScores: [],
          modelSelectionMode: "all-budget-exhausted",
          decisionReason: reason,
          reuseVsSpawn: "spawn",
          explicitModel: true,
        });
        return { success: false, error: reason };
      }
    }
    // Live knowledge-graph (spec 2026-07-22): sync mtime-cache load — an
    // observed, decaying prior over (context × model) outcomes. Cold/absent →
    // graphBias 0 everywhere, so scoring is byte-identical to before. Read here
    // (not on every candidate) so one load serves the whole model competition.
    const routingGraph = model ? null : loadRoutingGraph(params.projectId);
    const graphCtx: GraphContext = { role, tags, complexity };
    // Score the eligible models ONCE (when no explicit model was named) so the
    // dispatch-decision telemetry can carry the per-model breakdown + how the
    // winner was picked. scoreModelsDetailed advances the round-robin counter
    // exactly once, identical to the old scoreModels() call — no double-rotate.
    const modelSelection: ModelSelection | null = model
      ? null
      : scoreModelsDetailedFn(
          eligibleModels,
          tags,
          complexity,
          budgetSnapshot,
          graphCtx,
          routingGraph,
        );
    if (modelSelection?.mode === "all-budget-exhausted") {
      const reason = `All eligible models are budget exhausted — dispatch blocked.`;
      this.emitDispatchDecision({
        taskId: params.taskId ?? null,
        role,
        complexity,
        tags,
        eligibleModels: eligibleModels as string[],
        selectedModel: modelSelection.selected,
        perModelScores: [],
        modelSelectionMode: modelSelection.mode,
        decisionReason: reason,
        reuseVsSpawn: "spawn",
        explicitModel: false,
      });
      return { success: false, error: reason };
    }
    const selectedModel = model || modelSelection!.selected;
    const selectedBudgetReason = model
      ? budgetBiasScore(selectedModel, budgetSnapshot).reason
      : `budgetBias=${
          modelSelection?.scores.find((s) => s.model === selectedModel)
            ?.budgetBias ?? 0
        }`;
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
    // Graph fragment (spec §6.3): re-log the knowledge-graph's own influence
    // into decisionReason so a later audit can see how much the learned prior
    // moved this decision. Names non-zero-bias models (selected + any strongly
    // demoted rival). Empty when the graph is cold (no behavioral change).
    const graphFragment = model
      ? ""
      : (() => {
          const parts: string[] = [];
          for (const s of modelSelection?.scores ?? []) {
            if (s.graphBias === 0) continue;
            const d = graphBiasDetailForModel(s.model, graphCtx, routingGraph);
            const sign = s.graphBias > 0 ? "+" : "";
            parts.push(
              `${s.model} ${sign}${Math.round(s.graphBias)}${
                d.note ? ` (${d.note})` : ""
              }`,
            );
          }
          return parts.length ? ` graph: ${parts.join(", ")}.` : "";
        })();
    const spawnDecisionReason = model
      ? `Explicit model '${model}' requested — scoring bypassed (${selectedBudgetReason}). Spawned new ${selectedModel} agent.`
      : `Scored ${eligibleModels.length} model(s) → ${selectedModel} (${modelSelection?.mode}; ${selectedBudgetReason}).${graphFragment} Spawned new agent.`;
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
      dispatchReason: spawnDecisionReason,
    });

    if (!spawnResult.success) {
      mainTelemetry.agentSpawnFailed(this.mainWindow, {
        taskId: params.taskId ?? null,
        agentId: spawnResult.agentId ?? null,
        model: selectedModel,
        role,
        dispatchReason: spawnDecisionReason,
        errorCategory: "spawn_failed",
        errorMessage: spawnResult.error || "Failed to spawn agent",
        metadata: {
          complexity,
          tags,
          explicitModel: !!model,
          eligibleModels: eligibleModels as string[],
        },
      });
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
    // Decision snapshot: fresh spawn. When the model was scored (no explicit
    // hint) carry the full per-model breakdown + selection mode; an explicit
    // model request bypasses scoring (explicitModel=true, perModelScores=[]).
    this.emitDispatchDecision({
      taskId: resolvedTaskId,
      agentId: spawnResult.agentId,
      role,
      complexity,
      tags,
      eligibleModels: eligibleModels as string[],
      selectedModel,
      perModelScores: modelSelection?.scores ?? [],
      modelSelectionMode: modelSelection?.mode,
      decisionReason: spawnDecisionReason,
      reuseVsSpawn: "spawn",
      explicitModel: !!model,
    });
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

  private async findLiveTaskAgent(
    agents: AgentInstance[],
    projectId: string | undefined,
    taskId: string | undefined,
    requestedModel: ModelType | undefined,
  ): Promise<AgentInstance | null> {
    if (!projectId || !taskId) return null;
    const candidates = [
      ...agents.filter((a) => a.currentTaskId === taskId),
      ...agents.filter(
        (a) =>
          a.currentTaskId !== taskId &&
          isWorktreeIsolated(a.cwd, projectId, taskId),
      ),
    ];
    for (const agent of candidates) {
      if (await this.isLiveTaskAgentCandidate(agent, taskId, requestedModel)) {
        return agent;
      }
    }
    return null;
  }

  private async isLiveTaskAgentCandidate(
    agent: AgentInstance,
    taskId: string,
    requestedModel: ModelType | undefined,
  ): Promise<boolean> {
    if (agent.status === "stopped" || agent.status === "error") return false;
    // Fix3: explicit dispatch/reroute models can replace a differently-modeled
    // bound worker instead of being absorbed by the task-bound short-circuit.
    if (requestedModel && agent.model !== requestedModel) return false;

    const ageMs = Date.now() - agent.spawnedAt;
    if (Number.isFinite(ageMs) && ageMs <= taskAgentFirstActivityGraceMs()) {
      return true;
    }

    if (!this.taskAgentActivityHook) return false;
    try {
      const proof = await this.taskAgentActivityHook(taskId, agent.id);
      return proof.hasBoardActivity;
    } catch (err) {
      console.warn(
        `[BridgeServer] task-bound activity lookup failed for task ${taskId}, agent ${agent.id}:`,
        err,
      );
      return false;
    }
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
      reason:
        `Agent already bound to task ${taskId} with live activity evidence ` +
        `— routed instead of reassigning or spawning a duplicate.`,
      taskId,
    };
  }

  // ── Scoring (delegated to dispatch-scoring.ts) ───────────────

  private scoreAgents(
    agents: AgentInstance[],
    role: string,
    preferredModel?: ModelType,
    tags: string[] = [],
    budgets?: ModelBudgetSnapshot,
  ) {
    const infos: AgentInfo[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      role: a.role,
      status: a.status,
      restartCount: a.restartCount,
    }));
    return scoreAgentsFn(infos, role, preferredModel, tags, budgets);
  }

  /**
   * Emit a dispatch:decision telemetry snapshot for the renderer → BigQuery
   * pipe. Rides the exact same path as every other mainTelemetry event, so the
   * first-party opt-in gate (firstPartyTelemetryDefaultEnabled) and PII scrub
   * (telemetryService.anonymize) apply automatically — consent OFF ⇒ 0 external
   * sends. Best-effort: a destroyed/absent window is a silent no-op and never
   * blocks dispatch. Payload is de-identified (ids + model names + scores +
   * short reason strings only; never prompt text / paths / keys).
   */
  private emitDispatchDecision(payload: DispatchDecisionPayload): void {
    try {
      mainTelemetry.dispatchDecision(this.mainWindow, payload);
    } catch (err) {
      console.warn("[BridgeServer] dispatch:decision telemetry failed:", err);
    }
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
      dispatchReason: params.dispatchReason ?? null,
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
      // W1: a demote to idle here is the worker reporting its bound task
      // terminal (submit_for_review / update_task_status). Route it through
      // markTurnComplete so the trailing render flush of the finishing turn
      // can't re-promote the agent to `working` and strand the slot at
      // [working]. Any other transition uses the plain setStatus path.
      if (nextStatus === "idle") {
        this.agentManager.markTurnComplete(agent.id);
      } else {
        this.agentManager.setStatus(agent.id, nextStatus);
      }
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

  // ── POST /reclaim-ghosts ─────────────────────────────────────
  //
  // On-demand run of main's ghost-doc reclaim sweep (agent-lifecycle-reclaim):
  // marks this machine's dead-instance agent docs `stopped`. cleanup_agents
  // calls this as its Firestore pass — the in-memory passes structurally
  // cannot see agents a previous Electron instance left behind.
  private handleReclaimGhosts(res: http.ServerResponse): void {
    const send = (code: number, payload: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (!this.ghostReclaim) {
      send(200, {
        success: false,
        error: "ghost reclaim not wired",
      });
      return;
    }
    this.ghostReclaim()
      .then((result) => send(200, { success: true, ...result }))
      .catch((e) =>
        send(200, {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
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

  // ── POST /send-telegram-message ────────────────────────────
  //
  // Outbound path for the send_telegram_message MCP tool: the orchestrator
  // replies to a Telegram inbound by calling the tool, which POSTs here, and
  // the bridge routes to the electron-owned TelegramPoller (holds the bot token
  // + last-inbound chat). The token NEVER crosses this boundary — the request
  // carries only projectId/text/chatId, and the response error is pre-scrubbed
  // by the poller.
  private handleSendTelegram(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      void (async () => {
        let params: { projectId?: string; text?: string; chatId?: string };
        try {
          params = JSON.parse(body);
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: `Invalid JSON: ${
                err instanceof Error ? err.message : "parse error"
              }`,
            }),
          );
          return;
        }

        const projectId = (params.projectId ?? "").trim();
        const text = params.text ?? "";
        if (!projectId || !text.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: "Missing required fields: projectId, text",
            }),
          );
          return;
        }

        if (!this.sendTelegramMessage) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: "Telegram sender not available (no active channel).",
            }),
          );
          return;
        }

        try {
          const result = await this.sendTelegramMessage(
            projectId,
            text,
            params.chatId,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          // Defensive: the sender scrubs its own errors, but a thrown error
          // here could carry unexpected content — keep it generic.
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "send failed",
            }),
          );
        }
      })();
    });
  }
}
