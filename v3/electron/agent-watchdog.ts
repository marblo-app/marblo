// Agent health watchdog — native orchestrator self-recovery.
//
// Generalizes the mission conductor's "보고-감시(report watchdog)"
// (mission-engine/conductor-driver.ts) from a single mission step to the whole
// board. On a periodic sweep it inspects every CLAIMED / IN_PROGRESS ticket
// whose assigned worker has died (PTY exited → status "stopped"/"error", or
// the agent was removed entirely) or gone silent (alive but no PTY output /
// board activity beyond a grace window), then recovers it:
//
//   1. nudge   — inject a "report progress / continue or submit" message into
//                the live PTY (mirrors conductor buildReportNudge). Used while
//                the agent is alive-but-silent.
//   2. respawn — route the ticket back through the canonical guard-safe
//                dispatch path (bridge-server.dispatchTask). dispatchTask owns
//                the per-task lock + findLiveTaskAgent routing, so a still-live
//                worker is re-instructed instead of double-spawned, and a truly
//                dead one is restarted/spawned fresh. Used when the agent is
//                dead, or once the nudge budget is spent.
//
// Recovery escalation is per ticket with exponential backoff and a hard
// respawn cap (mirrors agent-manager's auto-restart budget) so a permanently
// broken ticket can't loop forever.
//
// ★ Recovery-only: the watchdog NEVER claims or starts TODO tickets. It only
//   acts on tickets that are already CLAIMED/IN_PROGRESS AND carry an assigned
//   agent. listActiveTickets() is responsible for excluding TODO/terminal
//   states; the sweep additionally skips any ticket with no bound agent.
//
// ★ W8 (2026-08-22, 티켓 Lfy6jvpil57eYf896km5) — the board-quiet SIGNAL.
//   Alongside the ladder above, every sweep also asks one question judged on
//   BOARD activity alone: "has this ticket's bound, locally-hosted agent posted
//   nothing for longer than the stall threshold for its priority?" (thresholds
//   and rationale: agent-stall-policy.ts). If so it raises a signal — to the
//   orchestrator PTY, the ticket timeline, telemetry (with the concrete model)
//   and the agent's stallSignal marker — and does NOTHING else. No nudge, no
//   respawn, no kill hangs off it: "워치독은 판정하지 말고 신호만 올려라. 죽일지
//   기다릴지는 맥락을 아는 쪽이 정한다." The ladder's liveness clock folds PTY
//   work output in (right for "don't kill a reasoning agent"), which is exactly
//   why an agent spinning on a hung tool for 80 minutes was never flagged by it.

// Type-only import — erased at compile/test time, so the watchdog stays a pure,
// Electron-free unit (the test imports only this module). Keeps the respawn
// model in lockstep with the dispatch model union instead of duplicating it.
import type { ModelType } from "./agent-manager";
import {
  DEFAULT_STALL_POLICY,
  classifyPtyLiveness,
  describePtyLiveness,
  evaluateBoardQuiet,
  evaluateExitQuiet,
  evaluateAnswerQuiet,
  evaluateFirstActivityQuiet,
  evaluateProbe,
  resolveStallPolicy,
  stallTier,
  type ProbeVerdict,
  type ProcessProbeSample,
  type StallPolicy,
  type AnsweredQuestionRef,
  type AnswerQuietVerdict,
  type StallSignal,
} from "./agent-stall-policy";

export type WatchdogTicketStatus = "CLAIMED" | "IN_PROGRESS";

export function isRecoverableWatchdogStatus(
  status: unknown,
): status is WatchdogTicketStatus {
  return status === "CLAIMED" || status === "IN_PROGRESS";
}

export interface WatchdogTicket {
  taskId: string;
  projectId: string;
  status: WatchdogTicketStatus;
  /** Worker role (backend/frontend/test/...) — passed to the respawn dispatch. */
  role: string;
  /** Agent currently bound to the ticket (projection.lastAgentId / claimedBy).
   * null when the board never recorded an owner — then there is nothing to
   * recover and the ticket is skipped (no auto-claim). */
  agentId: string | null;
  /** epoch-ms of the ticket's last board activity (projection.lastActivityAt),
   * or null if never recorded. */
  lastActivityAtMs: number | null;
  /** epoch-ms when the active assignment/status began, used only when no
   * activity projection exists yet (spawned but never reached first MCP call). */
  activeSinceMs?: number | null;
  /** Short title used to build the continuation instruction on respawn. */
  title?: string;
  /** Resolved working directory of the original dispatch (the agent's actual
   * cwd — typically its isolated per-task worktree), persisted as the task's
   * `dispatchMeta.cwd`. Restored on respawn so recovery lands in the SAME tree
   * instead of dispatch re-resolving cwd to a fresh base worktree (which lacks
   * the scope files and false-BLOCKs the ticket). Undefined when never persisted
   * → respawn falls back to the live AgentInstance's cwd, then to dispatch's own
   * cwd resolution. */
  cwd?: string;
  /** Resolved model / CLI provider of the original dispatch (claude/gpt/…),
   * persisted as `dispatchMeta.model`. Restored on respawn so a claude worker
   * isn't reborn as gpt by dispatch's model re-selection. Undefined → fall back
   * to the live AgentInstance's model, then to dispatch scoring. */
  model?: string;
  /** Task complexity of the original dispatch, persisted as
   * `dispatchMeta.complexity`. Restored on respawn so the claude `--model` tier
   * (sonnet/opus) / codex reasoning level matches the original. */
  complexity?: "simple" | "standard" | "complex";
  /** Human-readable dispatch decision reason, persisted with dispatchMeta. */
  dispatchReason?: string;
  /** Board priority (1~5, 5 highest). Picks the quiet-signal tier — see
   * agent-stall-policy.ts. Missing ⇒ normal tier (the conservative one). */
  priority?: number | null;
  /**
   * 이 티켓에서 **가장 최근에 답변된** 질문(tasks/{id}.questions 의
   * latestAnsweredQuestion). post-answer-quiet 축의 기준점이다.
   * 없거나 호스트가 안 실어주면 undefined/null → 그 축은 조용히 비활성.
   */
  lastAnswer?: AnsweredQuestionRef | null;
  /**
   * ★마지막 보드 활동(projection.lastActivityAt)이 **오케 자신의 기록**인가.
   * answer_question / resolve_model_escalation 은 답을 남기며 projection 을
   * 갱신해 활동 시계를 지금으로 되돌린다 — 그 활동을 에이전트의 반응으로 세면
   * post-answer-quiet 축이 영원히 안 운다. 호스트가 projection.
   * lastActivitySummary 로 판별해 실어준다(isOrchestratorActivitySummary).
   */
  lastActivityByOrchestrator?: boolean;
}

export type WatchdogAgentLiveStatus = "idle" | "working" | "error" | "stopped";

export interface WatchdogAgentHealth {
  status: WatchdogAgentLiveStatus;
  /** epoch-ms of the agent's most recent PTY output — ANY byte, including the
   * idle prompt's own repaint. Kept for backward compatibility; prefer
   * `lastWorkOutputMs` for liveness (see below). */
  lastPtyActivityMs: number;
  /** epoch-ms of the last PTY frame that counted as WORK — every frame except
   * the ones positively identified as the harness's idle input prompt (or as
   * contentless repaint). See agent-status-reconcile.ts classifyPtyFrame.
   *
   * ★This is the liveness clock. `lastPtyActivityMs` cannot be one: a CLI
   * parked at its prompt repaints its composer forever, so an agent that
   * stopped mid-task looked eternally fresh and was never flagged silent at
   * all. Optional — hosts that don't supply it fall back to lastPtyActivityMs
   * (legacy behavior). */
  lastWorkOutputMs?: number;
  /** epoch-ms since which every classified PTY frame has been an idle-prompt
   * repaint, or null/undefined when the agent is not provably parked.
   *
   * ★This is POSITIVE proof of a stop, not an inference from silence: a
   * reasoning agent emits nothing at all, so it can never reach this state. It
   * is what lets mid-task stalls be caught inside promptIdleGraceMs instead of
   * waiting out graceMs — see evaluatePromptIdleStall. */
  promptIdleSinceMs?: number | null;
  currentTaskId: string | null;
  /** Display name, for the quiet-signal message. Optional. */
  agentName?: string | null;
  /** Concrete model actually running (model@effort) or the vendor. Carried
   * on the quiet signal so stall cases record WHICH model stalled. */
  concreteModel?: string | null;
  /** agent-input-wait.ts InputWaitReason — a human is being waited on. Only
   * used to DESCRIBE the PTY state on the quiet signal. */
  inputWaitReason?: string | null;
  /** W8 보강: epoch-ms when this instance's PTY onExit confirmed the process
   * terminal (agent-manager's `terminalSince`), or null if never set / not
   * carried by this host. Used only to time the exit-axis quiet signal — NOT
   * a liveness input for the recovery ladder (unchanged). */
  terminalSinceMs?: number | null;
  /** W8 보강: the PTY's last exit code (agent-manager's `lastExitCode`), or
   * null when unknown / never exited. Carried on the exit-axis signal so the
   * message can say WHY it died, not just THAT it's quiet. */
  lastExitCode?: number | null;
  /**
   * ★능동 프로브 (b) 풀형 관측(티켓 DQYoyas3ESx33zXJOCOa) — epoch-ms of the
   * last marblo MCP tool call this agent made, as recorded by the bridge's
   * /agent-mcp-heartbeat. `undefined`/`null` = never observed (an older MCP
   * build, a foreign harness, or an agent that genuinely never calls us) →
   * the probe axis returns "프로브 불가" and stays silent.
   *
   * ★This is a PULL, not a push. Nothing is written to the agent's stdin to
   * obtain it: the agent's own tool-call loop reaches the server on its own
   * schedule and we merely note when it last did. There is no "channel outside
   * the terminal" in this architecture — even an MCP-delivered question ends
   * up as text+CR on the PTY via writeAndSubmit — so the probe never asks.
   *
   * Why it beats board activity as a liveness clock: read-only tool calls
   * (check_feedback / get_task / get_available_tasks) do NOT bump
   * projection.lastActivityAt, so an agent deep in a long reproduction can be
   * board-silent while its tool loop is demonstrably round-tripping. That gap
   * is exactly the false positive this axis exists to prevent.
   */
  lastMcpCallMs?: number | null;
  /** The PTY child's OS pid, when this host knows it. Used only by the
   * optional (a) branch of the probe (process.kill(pid,0) + `ps` CPU time).
   * Absent → that branch is simply not observed. */
  ptyPid?: number | null;
}

export type RecoveryPhase =
  | "nudge"
  | "respawn"
  | "recovered"
  | "exhausted"
  | "stand-down" // W3: original worker is alive/fresh — recovery skipped
  | "reroute" // W4: re-routed to another model/host before giving up
  | "escalated" // W4: real human/orchestrator notification fired
  | "misroute" // W6: scope/host guard blocked an orphan spawn
  | "review-stale" // W5: a dead-assignee REVIEW ticket surfaced
  | "in-progress-reset" // orphaned IN_PROGRESS reset to TODO for re-claim
  | "in-progress-stall" // orphaned IN_PROGRESS surfaced when reset is unwired
  // W9: IN_PROGRESS 인데 마지막 실제 산출이 임계를 넘겨 끊긴 티켓을 **표출만**
  // 했다. 담당자가 살아 보이는지 여부와 무관한 판정이라 in-progress-stall 과
  // 구분한다(그쪽은 담당자 부재가 전제다). 회수·리셋은 하지 않는다.
  | "in-progress-silent"
  | "pending-fallback" // W2: an undelivered instruction force-delivered via PTY
  | "quiet" // W8: board quiet past the stall threshold — SIGNAL ONLY
  | "quiet-cleared"; // W8: board activity resumed after a quiet signal

export interface WatchdogDeps {
  /** Active tickets in CLAIMED/IN_PROGRESS. Recovery-only: the implementation
   * MUST exclude TODO and terminal (REVIEW/DONE/FAILED/BLOCKED) tickets. */
  listActiveTickets: () => Promise<WatchdogTicket[]>;
  /** Live health of an agent, or null if the agent no longer exists. */
  getAgentHealth: (agentId: string) => WatchdogAgentHealth | null;
  /** Inject a nudge into the agent's PTY. Returns false if it couldn't. */
  nudgeAgent: (agentId: string, message: string) => boolean;
  /** Respawn an agent for the ticket via the guard-safe dispatch path. */
  respawnForTicket: (ticket: WatchdogTicket) => Promise<boolean>;
  /** Record a recovery transition to projection/timeline. Best-effort. */
  recordRecovery?: (
    ticket: WatchdogTicket,
    phase: RecoveryPhase,
    detail: string,
  ) => void;

  // ── W3: false-positive-respawn guards (all optional; absent → legacy behavior)
  /** Re-fetch the ticket's CURRENT status and report whether it is still
   * recoverable (i.e. NOT already REVIEW/DONE/FAILED/BLOCKED). Closes the race
   * where a ticket was CLAIMED/IN_PROGRESS at list time but the worker finished
   * mid-sweep — respawning it would double-work a done ticket. */
  isTaskStillRecoverable?: (taskId: string) => Promise<boolean>;
  /** Probe whether the ORIGINAL worker is demonstrably still alive: a recent
   * commit / add_activity / worktree mtime inside the freshness grace. Codifies
   * the watchdog_falsepositive_check_mtimes lesson as an actual gate. null when
   * it can't be determined (→ no opinion). */
  probeFreshness?: (
    ticket: WatchdogTicket,
  ) => Promise<{ fresh: boolean; reason: string } | null>;
  /** True when SOME live agent is already bound to this task (currentTaskId or
   * isolated worktree) — even under a different name than the ticket's recorded
   * agentId. Prevents a duplicate spawn when dispatch's name hint ≠ the real
   * live agentId. */
  hasLiveWorkerForTask?: (ticket: WatchdogTicket) => boolean;

  // ── W6: cross-host / scope guard (optional) ─────────────────
  /** Probe, for a respawn about to land on THIS host, whether the ticket's
   * scope files exist in the resolved cwd and the host constraint (e.g. a
   * Windows cwd in the description) matches. Returns the action to take. null →
   * no opinion (proceed). */
  probeScopeHost?: (ticket: WatchdogTicket) => Promise<{
    action: "proceed" | "redispatch" | "block";
    reason: string;
  } | null>;
  /** Hand a mis-routed ticket back to its origin host (add_activity diagnostic +
   * BLOCKED(force) request). Called when probeScopeHost says redispatch/block. */
  redispatchToOriginHost?: (
    ticket: WatchdogTicket,
    reason: string,
  ) => Promise<void>;

  // ── W4: real escalation before dead-end (optional) ──────────
  /** Try ONCE to re-route a budget-exhausted ticket to a different model/host
   * before giving up. Returns true if a re-route dispatch actually fired. */
  rerouteForTicket?: (ticket: WatchdogTicket) => Promise<boolean>;
  /** Fire a REAL escalation (orchestrator PTY nudge + Telegram) when a ticket
   * genuinely needs human attention. Replaces the old log-only dead-end. */
  escalate?: (ticket: WatchdogTicket, detail: string) => void;
  /** Reset an orphaned IN_PROGRESS ticket to TODO so another agent can reclaim
   * it. Called only after the recorded owner is gone and board activity is
   * stale / absent. */
  resetStalledInProgress?: (
    ticket: WatchdogTicket,
    detail: string,
  ) => Promise<boolean>;
  /** Surface an orphaned IN_PROGRESS stall when reset is not wired or fails. */
  escalateStalledInProgress?: (ticket: WatchdogTicket, detail: string) => void;

  // ── W5: stale non-human REVIEW sweep (optional) ─────────────
  /** List REVIEW tickets whose non-human review owner is dead/foreign, with
   * the age of their last review activity — cross-project. Normal REVIEW means
   * human approval pending and must stay out of stuck/stale recovery. */
  listStaleReviewCandidates?: () => Promise<StaleReviewTicket[]>;
  /** Surface a stale non-human REVIEW ticket to the orchestrator / human. */
  escalateStaleReview?: (ticket: StaleReviewTicket, detail: string) => void;

  // ── W2: undelivered pending-instruction fallback (optional) ──
  /** List pending instructions still undelivered (isDelivered==false), with age
   * and target agent. */
  listUndeliveredInstructions?: () => Promise<PendingInstruction[]>;
  /** Directly write an instruction to a locally-hosted agent's PTY (the
   * reuse_agent path that works when the Firestore listener didn't). Returns
   * false when the agent isn't hosted here / not writable. */
  deliverInstructionDirect?: (agentId: string, message: string) => boolean;
  /** Flip a pending instruction's isDelivered flag after a direct delivery. */
  markInstructionDelivered?: (docId: string) => Promise<void>;

  // ── W8: quiet signal (optional) ─────────────────────────────
  /**
   * The ticket's bound, locally-hosted agent has posted NOTHING to the board
   * for longer than the stall threshold for its priority. This is a SIGNAL for
   * the orchestrator — the watchdog does not nudge, kill, or respawn on it.
   * The host wires it to: orchestrator PTY injection, a ticket activity line,
   * telemetry (with the model), and the agent's `stallSignal` marker.
   */
  signalQuiet?: (
    ticket: WatchdogTicket,
    signal: StallSignal,
    detail: string,
  ) => void;
  /** Board activity resumed after a quiet signal — retract the marker. */
  clearQuiet?: (ticket: WatchdogTicket, agentId: string) => void;

  // ── 능동 프로브 (a) — optional OS 관측 (티켓 DQYoyas3ESx33zXJOCOa) ──
  /**
   * Actively poke the OS about an agent's process: does the pid still exist,
   * and how much CPU time has it accumulated? Wired by the host to
   * process-cpu-probe.sampleProcessProbe. **Entirely optional** — when absent
   * (or when it resolves to all-nulls, e.g. off macOS) the probe axis simply
   * runs on the (b) MCP clock alone, and an unobservable case falls to
   * "프로브 불가", never to "멈춤".
   *
   * ★Called ONLY from inside the probe branch — i.e. after every other axis
   * has declined the ticket AND both the board and the MCP clock have crossed
   * the grace. Never polled. Writes nothing to any PTY.
   */
  probeProcess?: (
    agentId: string,
    pid: number | null,
    prevCpuMs: number | null,
  ) => Promise<ProcessProbeSample | null>;

  /** Injectable clock (epoch-ms) for deterministic tests. */
  now?: () => number;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** W5 — a REVIEW ticket whose assignee looks dead/foreign. */
export interface StaleReviewTicket {
  taskId: string;
  projectId: string;
  title?: string;
  role?: string;
  assigneeAgentId: string | null;
  /** True when the assignee agent is gone / stopped / on another host. */
  assigneeDead: boolean;
  /** epoch-ms of the last review-related activity, or null. */
  lastActivityAtMs: number | null;
  /** REVIEW normally means "waiting for human approval"; those tickets must
   * not be treated as stuck/stale agent work. Only explicit non-human review
   * ownership may opt into stale-review escalation. */
  awaitingHumanApproval?: boolean;
}

/** W2 — an undelivered cross-machine instruction. */
export interface PendingInstruction {
  docId: string;
  targetAgentId: string;
  message: string;
  createdAtMs: number;
}

export interface WatchdogConfig {
  /** Master toggle. */
  enabled: boolean;
  /** Sweep cadence (ms). */
  intervalMs: number;
  /** Silence (no work output / board activity) before a live agent is "stuck". */
  graceMs: number;
  /** How long an agent must sit PROVABLY parked at its input prompt (harness
   * prompt marker, no busy marker since) with no board activity before it is
   * treated as stuck. Much shorter than graceMs on purpose: this is not a
   * silence timer but a positive observation that the CLI is waiting for input,
   * and the only action it unlocks is the cheapest rung of the ladder (a
   * nudge). A reasoning agent emits no frames and so never enters this state. */
  promptIdleGraceMs: number;
  /** Grace for a freshly-observed ticket to produce its FIRST activity beyond
   * the dispatch baseline. A spawned worker that dies before running a single
   * MCP call still looks "fresh" (dispatch stamps projection.lastActivityAt and
   * the PTY boot bumps lastPtyActivity), so plain silence-from-grace can't tell
   * "born dead" from "just started". If a live-but-idle ticket produces zero new
   * activity within this window, it's treated as born-dead and escalated
   * straight to respawn (a never-started worker won't answer a nudge). */
  firstActivityGraceMs: number;
  /** Minimum gap between consecutive nudges on the same ticket. */
  nudgeIntervalMs: number;
  /** Nudges to try before escalating to respawn. */
  maxNudges: number;
  /** Hard cap on respawns per ticket before giving up. */
  maxRespawns: number;
  /** Exponential-backoff base / ceiling between respawns (ms). */
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** W3: how recently the original worker must have committed/logged/touched its
   * worktree to count as "alive" and cancel a respawn. */
  freshnessGraceMs: number;
  /** W5: how long a dead-assignee REVIEW ticket may sit before it's surfaced,
   * and the minimum gap between re-surfacing the same ticket. */
  reviewStaleMs: number;
  /** W2: how long a pending instruction may stay undelivered before the
   * watchdog force-delivers it via direct PTY write. */
  pendingFallbackMs: number;
  /** Owner missing from the LOCAL registry AND no board activity for this
   * long before the watchdog may treat it as dead at all (respawn for CLAIMED,
   * reset-to-TODO / orchestrator notify for IN_PROGRESS). Must exceed the real
   * agent reporting cadence: workers post add_activity every 2–11 min while
   * actively working (2026-07-18 실측), so anything shorter converts a mere
   * "hosted elsewhere / attribution drift" miss into a destructive reset. */
  inProgressOrphanResetMs: number;
  /**
   * W9: 담당자가 살아 **보이든 말든**, IN_PROGRESS 티켓에서 마지막 실제 산출이
   * 이만큼 끊기면 사유와 함께 드러낸다. 같은 티켓의 재표출 간격도 이 값이다.
   */
  silentInProgressMs: number;
  /** W8: board-quiet thresholds per priority tier + repeat gap. Shared with
   * dispatch and the renderer's stuck lane — see agent-stall-policy.ts. */
  stall: StallPolicy;
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: true,
  intervalMs: 60_000,
  // 5 min. NOTE: this used to be described as matching agent-manager's
  // IDLE_INACTIVITY_MS, which no longer exists — PTY silence no longer demotes
  // an agent to idle, because a reasoning agent is silent (see
  // agent-status-reconcile.ts). The watchdog judges liveness by BOARD activity
  // (add_activity / commits), not PTY status, so this window is independent and
  // is left unchanged here deliberately.
  graceMs: 300_000,
  // 90 s parked at the input prompt with nothing on the board. Safe to make
  // this short because it is evidence, not impatience: the CLI has told us it
  // is waiting for someone to type, and a working (even deeply reasoning) agent
  // never produces that frame. The nudge it unlocks is harmless if wrong.
  promptIdleGraceMs: 90_000,
  firstActivityGraceMs: 180_000, // 3 min — a spawned worker should have logged
  // its first board activity / real PTY work well within this window.
  nudgeIntervalMs: 120_000,
  maxNudges: 2,
  maxRespawns: 3,
  backoffBaseMs: 5_000,
  backoffMaxMs: 120_000,
  freshnessGraceMs: 180_000, // 3 min — a live worker commits/logs within this
  reviewStaleMs: 14_400_000, // 4 h — dead-assignee REVIEW grace before surfacing
  pendingFallbackMs: 45_000, // 45 s — undelivered instruction → PTY-direct
  inProgressOrphanResetMs: 900_000, // 15 min — 3× graceMs and beyond the
  // 2–11 min add_activity cadence measured on live workers. The old 90 s
  // default reset actively-working agents' tickets to TODO within one silent
  // stretch (watchdog-false-death, 2026-07-18).
  // W9 — 90분. 회수가 아니라 **표출**이므로 오탐의 대가가 알림 하나뿐이지만,
  // 그래도 board-quiet 정상 임계(45분)의 2배로 잡아 정상 장시간 작업과 겹치지
  // 않게 했다. 실측 사례(51분 무산출 · 9시간 방치)를 모두 덮는다.
  silentInProgressMs: 5_400_000,
  stall: DEFAULT_STALL_POLICY,
};

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the watchdog config from environment overrides (all optional). */
export function resolveWatchdogConfig(
  env: NodeJS.ProcessEnv = process.env,
): WatchdogConfig {
  const d = DEFAULT_WATCHDOG_CONFIG;
  return {
    // Default ON; only the literal "false" / "0" disables it.
    enabled: !["false", "0", "off"].includes(
      (env.MARBLO_WATCHDOG_ENABLED ?? "").trim().toLowerCase(),
    ),
    intervalMs: intEnv(env, "MARBLO_WATCHDOG_INTERVAL_MS", d.intervalMs),
    graceMs: intEnv(env, "MARBLO_WATCHDOG_GRACE_MS", d.graceMs),
    promptIdleGraceMs: intEnv(
      env,
      "MARBLO_WATCHDOG_PROMPT_IDLE_MS",
      d.promptIdleGraceMs,
    ),
    firstActivityGraceMs: intEnv(
      env,
      "MARBLO_WATCHDOG_FIRST_ACTIVITY_MS",
      d.firstActivityGraceMs,
    ),
    nudgeIntervalMs: intEnv(env, "MARBLO_WATCHDOG_NUDGE_MS", d.nudgeIntervalMs),
    maxNudges: intEnv(env, "MARBLO_WATCHDOG_MAX_NUDGES", d.maxNudges),
    maxRespawns: intEnv(env, "MARBLO_WATCHDOG_MAX_RESPAWNS", d.maxRespawns),
    backoffBaseMs: intEnv(
      env,
      "MARBLO_WATCHDOG_BACKOFF_BASE_MS",
      d.backoffBaseMs,
    ),
    backoffMaxMs: intEnv(env, "MARBLO_WATCHDOG_BACKOFF_MAX_MS", d.backoffMaxMs),
    freshnessGraceMs: intEnv(
      env,
      "MARBLO_WATCHDOG_FRESHNESS_MS",
      d.freshnessGraceMs,
    ),
    reviewStaleMs: intEnv(
      env,
      "MARBLO_WATCHDOG_REVIEW_STALE_MS",
      d.reviewStaleMs,
    ),
    pendingFallbackMs: intEnv(
      env,
      "MARBLO_WATCHDOG_PENDING_FALLBACK_MS",
      d.pendingFallbackMs,
    ),
    inProgressOrphanResetMs: intEnv(
      env,
      "MARBLO_WATCHDOG_IN_PROGRESS_ORPHAN_RESET_MS",
      d.inProgressOrphanResetMs,
    ),
    silentInProgressMs: intEnv(
      env,
      "MARBLO_WATCHDOG_SILENT_IN_PROGRESS_MS",
      d.silentInProgressMs,
    ),
    stall: resolveStallPolicy(env),
  };
}

/** Per-ticket recovery progress. Lives only while a ticket is stuck. */
interface RecoveryState {
  nudges: number;
  respawns: number;
  /** epoch-ms before which we must not act again (nudge gap / respawn backoff). */
  cooldownUntilMs: number;
  /** Freshest activity timestamp observed at the last action — when activity
   * later advances past this, the ticket has recovered and the state resets. */
  stuckAtActivityMs: number;
  /** Respawn budget spent — stop touching the ticket. */
  exhausted: boolean;
  /** W4: a model/host re-route was already attempted once (so exhaustion only
   * escalates to a human AFTER a re-route, and the re-route can't loop). */
  rerouted: boolean;
}

/**
 * W7 — mid-task idle detection. Pure.
 *
 * The gap this closes: liveness used to be `max(boardActivity, anyPtyByte)`, and
 * a CLI parked at its input prompt repaints forever. So an agent that stopped
 * mid-task — turn over, completion never reported — was never `dead` (its PTY is
 * alive), never `silent` (the repaint kept bumping the clock) and long past the
 * born-dead window. It wasn't caught late; it was never caught.
 *
 * The signal here is the opposite of a silence timer. It fires only on a
 * POSITIVE observation, produced by the harness itself, that the CLI is sitting
 * at its ready input prompt (agent-status-reconcile.ts classifyPtyFrame), which
 * a reasoning agent — emitting nothing at all — can never produce. Both clocks
 * must agree: parked for the full window AND nothing posted to the board in it.
 *
 * What it unlocks is deliberately limited to the cheapest rung: a nudge. A
 * respawn still requires the pre-existing gates (dead / born-dead / nudge budget
 * spent), so a misread marker costs one harmless message, never a killed agent.
 */
export function evaluatePromptIdleStall(input: {
  /** health.promptIdleSinceMs — null/undefined ⇒ not provably parked. */
  promptIdleSinceMs: number | null | undefined;
  /** Freshest BOARD activity for the ticket (add_activity / commit). */
  lastBoardActivityMs: number;
  now: number;
  graceMs: number;
  /** The agent must be locally hosted and not terminal — we can only read a PTY
   * we own, and a dead/missing worker is the other gates' business. */
  agentLocallyLive: boolean;
}): { stalled: boolean; detail: string } {
  const { promptIdleSinceMs, now, graceMs } = input;
  if (!input.agentLocallyLive) return { stalled: false, detail: "" };
  if (promptIdleSinceMs === null || promptIdleSinceMs === undefined) {
    return { stalled: false, detail: "" };
  }
  const parkedMs = now - promptIdleSinceMs;
  if (parkedMs < graceMs) return { stalled: false, detail: "" };
  // A worker that is posting progress is working, whatever its terminal paints.
  const boardIdleMs = now - input.lastBoardActivityMs;
  if (boardIdleMs < graceMs) return { stalled: false, detail: "" };
  return {
    stalled: true,
    detail:
      `PTY has been parked at the harness input prompt for ` +
      `${Math.round(parkedMs / 1000)}s with no board activity for ` +
      `${Math.round(boardIdleMs / 1000)}s (idle-at-prompt, not silence)`,
  };
}

/** W3 — interpret the false-positive-respawn guards. Pure: given the three
 * "someone else is handling it / already done" signals, decide whether to stand
 * down instead of nudging/respawning. Any true signal cancels recovery. */
export function evaluateRespawnGuard(input: {
  /** Result of isTaskStillRecoverable (undefined when the probe wasn't run). */
  stillRecoverable?: boolean;
  /** Result of probeFreshness (undefined when not run / no opinion). */
  fresh?: boolean;
  freshReason?: string;
  /** Result of hasLiveWorkerForTask. */
  liveWorkerBound?: boolean;
  /** W7: the agent is demonstrably parked at its input prompt (see
   * evaluatePromptIdleStall). Overrides the `fresh` stand-down ONLY: worktree
   * mtime is an *inference* that the worker lives, while a ready input prompt is
   * a *direct observation* that it is not working — a stall right after the last
   * file write is exactly the case that must not be waved through. The other two
   * signals are untouched: a terminal ticket still has nothing to recover, and a
   * live worker bound elsewhere still forbids a duplicate. */
  promptIdleProven?: boolean;
}): { standDown: boolean; reason: string } {
  if (input.stillRecoverable === false) {
    return {
      standDown: true,
      reason:
        "bound task already terminal (REVIEW/DONE/…) — nothing to recover",
    };
  }
  if (input.liveWorkerBound === true) {
    return {
      standDown: true,
      reason: "a live agent is already bound to this task — no duplicate spawn",
    };
  }
  if (input.fresh === true && input.promptIdleProven !== true) {
    return {
      standDown: true,
      reason: `original worker is fresh (${
        input.freshReason ?? "recent activity"
      }) — stand down`,
    };
  }
  return { standDown: false, reason: "" };
}

/** W6 — interpret the scope/host probe. Pure. */
export function interpretScopeHostProbe(
  probe: { action: "proceed" | "redispatch" | "block"; reason: string } | null,
): {
  blockSpawn: boolean;
  action: "proceed" | "redispatch" | "block";
  reason: string;
} {
  if (!probe || probe.action === "proceed") {
    return {
      blockSpawn: false,
      action: "proceed",
      reason: probe?.reason ?? "",
    };
  }
  return { blockSpawn: true, action: probe.action, reason: probe.reason };
}

/** W5 — select the REVIEW tickets that are genuinely stale: assignee dead AND
 * last activity older than the threshold. Pure filter over the candidate list.
 * A human-approval REVIEW, a REVIEW with a live assignee, or one that was just
 * submitted is excluded so normal review flow isn't flagged as noise. */
export function selectStaleReviews(
  candidates: StaleReviewTicket[],
  now: number,
  thresholdMs: number,
): StaleReviewTicket[] {
  return candidates.filter((c) => {
    if (c.awaitingHumanApproval !== false) return false;
    if (!c.assigneeDead) return false;
    const age = now - (c.lastActivityAtMs ?? 0);
    return age >= thresholdMs;
  });
}

/** W2 — select undelivered instructions old enough to force-deliver via direct
 * PTY write. Pure filter. */
export function selectStalePendingForFallback(
  list: PendingInstruction[],
  now: number,
  thresholdMs: number,
): PendingInstruction[] {
  return list.filter((p) => now - p.createdAtMs >= thresholdMs);
}

export function detectOrphanedInProgressStall(
  ticket: WatchdogTicket,
  input: {
    ownerMissing: boolean;
    now: number;
    thresholdMs: number;
  },
): { stalled: boolean; detail: string } {
  if (ticket.status !== "IN_PROGRESS" || !input.ownerMissing) {
    return { stalled: false, detail: "" };
  }

  if (ticket.lastActivityAtMs === null) {
    const ageBase = ticket.activeSinceMs ?? 0;
    const ageMs = input.now - ageBase;
    if (ageMs >= input.thresholdMs) {
      return {
        stalled: true,
        detail:
          `assigned agent ${ticket.agentId ?? "(none)"} is missing and ` +
          `IN_PROGRESS has no activity log for ${Math.round(ageMs / 1000)}s`,
      };
    }
    return { stalled: false, detail: "" };
  }

  const idleMs = input.now - ticket.lastActivityAtMs;
  if (idleMs >= input.thresholdMs) {
    return {
      stalled: true,
      detail:
        `assigned agent ${ticket.agentId ?? "(none)"} is missing and ` +
        `IN_PROGRESS has been inactive for ${Math.round(idleMs / 1000)}s`,
    };
  }
  return { stalled: false, detail: "" };
}

/** W9 — "살아 있어 보이는데 아무것도 안 나오는" IN_PROGRESS 티켓의 판정 결과. */
export interface SilentInProgressVerdict {
  silent: boolean;
  /** 판정 기준이 된 **마지막 실제 산출** 시각(epoch-ms). 없으면 null. */
  lastOutputAtMs: number | null;
  /** 그 이후 흐른 시간. 판정 불가면 0. */
  quietMs: number;
  /** 감사/알림에 그대로 실리는 한 줄 근거. */
  detail: string;
}

/**
 * W9 — 오래 조용한 IN_PROGRESS 티켓을 **드러낸다**(진단 §5.4).
 *
 * 왜 별도 축인가: 기존 detectOrphanedInProgressStall 은 `ownerMissing`(이 인스턴스
 * 메모리에 담당 에이전트가 없음)을 전제한다. 그런데 실제로 9시간이 조용히 지나간
 * 사례에서 담당 에이전트는 **문서상 계속 `working`** 이었고 메모리에도 있었다.
 * 그래서 그 감시는 한 번도 걸리지 않았다. 미션 스텝에는 240초 nudge 가 있는데
 * 보드 티켓에는 대응물이 없다는 것이 진단의 지적이다.
 *
 * ★판정 기준은 "working 표시"가 아니라 **마지막 실제 산출 시각**이다
 *   (2026-09-04 실측: 51분 무커밋 · 지시 미배달인 에이전트가 계속 working 으로
 *   보였고, PTY 직접 지시를 두 번 보내도 반응이 없었다. 상태 표시가 PTY 바이트에서
 *   파생되기 때문에 양방향 오판이 난다). 그래서 이 함수는 **agentId 도 에이전트
 *   상태도 보지 않는다** — 보드에 남은 산출물만 본다.
 *
 * ★이 판정은 아무것도 회수하지 않는다. 티켓을 리셋하지도, claim 을 풀지도 않고
 *   오직 사유와 함께 드러낸다. 그래서 오탐의 대가가 "알림 한 번"이다 — 살아있는
 *   작업을 뺏는 판정(evaluateGhostReclaim)과 의도적으로 성격을 갈라 놓았다.
 *
 * 산출 흔적이 아예 없으면(`lastActivityAtMs`·`activeSinceMs` 둘 다 없음) 판정하지
 * 않는다 — 증거의 부재는 부재의 증거가 아니다.
 */
export function detectSilentInProgressTicket(
  ticket: WatchdogTicket,
  input: { now: number; thresholdMs: number },
): SilentInProgressVerdict {
  const quiet = (lastOutputAtMs: number | null): SilentInProgressVerdict => ({
    silent: false,
    lastOutputAtMs,
    quietMs: 0,
    detail: "",
  });
  if (ticket.status !== "IN_PROGRESS") return quiet(null);

  // 마지막 **실제 산출**: 보드 활동(add_activity / 상태 전이 projection)을 우선하고,
  // 아직 첫 활동이 없으면 배정 시작 시각으로 대신한다.
  const lastOutputAtMs = ticket.lastActivityAtMs ?? ticket.activeSinceMs ?? null;
  if (lastOutputAtMs === null) return quiet(null);

  const quietMs = input.now - lastOutputAtMs;
  if (quietMs < input.thresholdMs) return quiet(lastOutputAtMs);

  const mins = (ms: number): number => Math.round(ms / 60_000);
  return {
    silent: true,
    lastOutputAtMs,
    quietMs,
    detail:
      `IN_PROGRESS 인데 마지막 실제 산출(보드 활동)이 ${mins(quietMs)}분 전이다 ` +
      `(임계 ${mins(input.thresholdMs)}분). 담당 ${ticket.agentId ?? "(없음)"} 의 ` +
      `표시 상태와 무관하게 산출 시각만으로 판정했다 — 진행 여부를 확인하고, ` +
      `끝났으면 보고를, 막혔으면 BLOCKED 를, 죽었으면 재배정을 해야 한다`,
  };
}

/** W9 — 임계를 넘은 조용한 IN_PROGRESS 티켓만 고르는 순수 필터. */
export function selectSilentInProgressTickets(
  tickets: WatchdogTicket[],
  now: number,
  thresholdMs: number,
): Array<{ ticket: WatchdogTicket; verdict: SilentInProgressVerdict }> {
  const out: Array<{
    ticket: WatchdogTicket;
    verdict: SilentInProgressVerdict;
  }> = [];
  for (const ticket of tickets) {
    const verdict = detectSilentInProgressTicket(ticket, { now, thresholdMs });
    if (verdict.silent) out.push({ ticket, verdict });
  }
  return out;
}

function buildBoardNudge(ticket: WatchdogTicket): string {
  const label = ticket.title ? `"${ticket.title}" ` : "";
  return (
    `【Watchdog】 태스크 ${ticket.taskId} ${label}의 진행 보고를 한동안 받지 못했습니다.\n` +
    `아직 작업 중이면 무시하세요. 이미 끝냈다면 지금 바로 submit_for_review 로 보고하고, ` +
    `막혔다면 update_task_status(BLOCKED, 이유) 로 알려주세요. ` +
    `중단된 상태라면 이어서 계속 진행해 주세요.`
  );
}

/** Continuation instruction injected into the (re)dispatched worker when a stuck
 * ticket is respawned. Mirrors the board nudge but framed as a recovery hand-off
 * to a possibly-fresh agent. */
export function buildRespawnInstruction(ticket: WatchdogTicket): string {
  return (
    `이전 담당 에이전트가 중단/침묵 상태로 감지되어 워치독이 복구를 ` +
    `트리거했습니다. 태스크 "${ticket.title ?? ticket.taskId}" 의 현재 ` +
    `상태를 점검하고, 끝났으면 submit_for_review, 막혔으면 ` +
    `update_task_status(BLOCKED), 아니면 이어서 진행하세요.`
  );
}

/** Guard-safe dispatch params for respawning a stuck ticket's worker — fed
 * straight into bridgeServer.dispatchTask. `cwd`/`model`/`complexity` are the
 * crux of the fix: without them dispatch re-resolves cwd (→ a fresh empty base
 * worktree that lacks the task's scope files → false BLOCKED) and re-selects the
 * model (→ a claude worker reborn as gpt). */
export interface RespawnDispatchParams {
  role: string;
  instruction: string;
  taskId: string;
  projectId?: string;
  cwd?: string;
  model?: ModelType;
  complexity?: "simple" | "standard" | "complex";
  /** Recovery must not be blocked by the per-plan concurrency cap. */
  system: true;
}

/**
 * Build the respawn dispatch for a stuck ticket, restoring the ORIGINAL
 * dispatch's working directory + model + complexity so recovery is faithful.
 *
 * Resolution order for cwd/model (first defined wins):
 *   1. the ticket's persisted `dispatchMeta` (ticket.cwd / ticket.model) —
 *      survives even full agent removal (reap),
 *   2. `fallback` — the live (or merely stopped) AgentInstance still bound to
 *      the ticket, read by the caller from agentManager.getAgent(agentId),
 *   3. undefined — dispatch falls back to its own resolution (legacy behavior).
 *
 * Leaving cwd/model undefined is exactly the pre-fix bug, so callers should pass
 * a fallback whenever the agent doc still exists.
 */
export function buildRespawnDispatch(
  ticket: WatchdogTicket,
  fallback?: { cwd?: string; model?: ModelType } | null,
): RespawnDispatchParams {
  // ticket.model is a free string (Firestore dispatchMeta); dispatch re-folds it
  // through normalizeModel, so the union cast here only satisfies the request
  // type — an unknown value can't slip past dispatch's own resolution.
  const model = (ticket.model as ModelType | undefined) ?? fallback?.model;
  return {
    role: ticket.role,
    instruction: buildRespawnInstruction(ticket),
    taskId: ticket.taskId,
    projectId: ticket.projectId || undefined,
    cwd: ticket.cwd ?? fallback?.cwd ?? undefined,
    model: model ?? undefined,
    complexity: ticket.complexity,
    system: true,
  };
}

/**
 * Native agent-health watchdog. Construct with injected ports (so it is fully
 * unit-testable without Firestore/Electron), then start()/stop() in the app
 * lifecycle. tickOnce() runs a single sweep and is what tests drive directly.
 */
export class AgentWatchdog {
  private readonly deps: WatchdogDeps;
  private readonly cfg: WatchdogConfig;
  private readonly now: () => number;
  private readonly log: (msg: string, meta?: Record<string, unknown>) => void;

  private states = new Map<string, RecoveryState>();
  /** First-activity tracker: when the watchdog first observed each active,
   * agent-bound ticket, plus the freshest activity timestamp seen at that
   * moment (the dispatch baseline). Used to detect a spawned worker that never
   * produced its first real activity. Pruned alongside `states`. */
  private firstSeen = new Map<
    string,
    { atMs: number; baselineActivityMs: number }
  >();
  /** W5: last epoch-ms each REVIEW ticket was surfaced, so re-surfacing is rate
   * limited to once per reviewStaleMs instead of every sweep. */
  private reviewEscalatedAt = new Map<string, number>();
  /** W9 — 조용한 IN_PROGRESS 티켓을 마지막으로 드러낸 시각(재표출 rate-limit). */
  private silentSurfacedAt = new Map<string, number>();
  /** W2: pending-instruction doc ids already force-delivered this process, so a
   * fallback isn't attempted twice while the isDelivered flip propagates. */
  private pendingAttempted = new Set<string>();
  /** W8: per-ticket quiet-signal memory — when it was last raised, the board
   * clock it was raised against (advancing past it = cleared), and how many
   * times this quiet stretch has been surfaced. Pruned alongside `states`. */
  private quietRaised = new Map<
    string,
    {
      lastRaisedAtMs: number;
      baselineBoardMs: number;
      repeat: number;
      ticket: WatchdogTicket;
    }
  >();
  /**
   * 능동 프로브 (a): 에이전트별 직전 CPU 표본. CPU 는 **델타로만** 의미가 있고
   * 절대값은 아무것도 말해주지 않는다 — 그래서 첫 표본이 찍히는 라운드는 CPU
   * 축 없이(=MCP 시계만으로) 판정된다. agentId 키인 이유는 이 값이 티켓이
   * 아니라 프로세스의 성질이기 때문이다(재배정돼도 같은 프로세스면 이어진다).
   */
  private cpuSamples = new Map<string, { atMs: number; cpuMs: number }>();
  /** 티켓별 가장 최근 프로브 판정. 신호를 만들지 않은 라운드의 결과도 남는다. */
  private lastProbe = new Map<string, ProbeVerdict>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    deps: WatchdogDeps,
    cfg: WatchdogConfig = resolveWatchdogConfig(),
  ) {
    this.deps = deps;
    this.cfg = cfg;
    this.now = deps.now ?? (() => Date.now());
    this.log =
      deps.logger ??
      ((m, meta) => console.log(`[AgentWatchdog] ${m}`, meta ?? ""));
  }

  /** Begin periodic sweeps. No-op when disabled or already running. */
  start(): void {
    if (!this.cfg.enabled) {
      this.log("disabled — not starting");
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.cfg.intervalMs);
    // Don't keep the event loop alive on its own (clean shutdown / tests).
    this.timer.unref?.();
    this.log("started", {
      intervalMs: this.cfg.intervalMs,
      graceMs: this.cfg.graceMs,
      maxNudges: this.cfg.maxNudges,
      maxRespawns: this.cfg.maxRespawns,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.states.clear();
    this.firstSeen.clear();
    this.reviewEscalatedAt.clear();
    this.silentSurfacedAt.clear();
    this.pendingAttempted.clear();
    this.quietRaised.clear();
    this.cpuSamples.clear();
    this.lastProbe.clear();
    this.log("stopped");
  }

  /** Run a single health sweep. Safe to call directly (tests) — overlapping
   * invocations are coalesced so an in-flight async sweep is never doubled. */
  async tickOnce(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const tickets = await this.deps.listActiveTickets();
      const seen = new Set<string>();
      for (const ticket of tickets) {
        if (!isRecoverableWatchdogStatus(ticket.status)) continue;
        seen.add(ticket.taskId);
        try {
          await this.inspect(ticket);
        } catch (err) {
          this.log("inspect failed (best-effort)", {
            taskId: ticket.taskId,
            err: String(err),
          });
        }
      }
      // Prune state for tickets that left the active set (recovered, submitted,
      // failed, deleted) so their budgets reset if they ever come back.
      for (const taskId of [...this.states.keys()]) {
        if (!seen.has(taskId)) this.states.delete(taskId);
      }
      for (const taskId of [...this.firstSeen.keys()]) {
        if (!seen.has(taskId)) this.firstSeen.delete(taskId);
      }
      // 프로브 판정 캐시도 같이 정리한다. CPU 표본(cpuSamples)은 agentId 키라
      // 여기서 지우지 않고, 아래 활성 에이전트 집합 기준으로 따로 턴다.
      for (const taskId of [...this.lastProbe.keys()]) {
        if (!seen.has(taskId)) this.lastProbe.delete(taskId);
      }
      const liveAgents = new Set(
        tickets.map((t) => t.agentId).filter((id): id is string => !!id),
      );
      for (const agentId of [...this.cpuSamples.keys()]) {
        if (!liveAgents.has(agentId)) this.cpuSamples.delete(agentId);
      }
      // W8: a ticket that left the active set (submitted / closed / reassigned)
      // takes its quiet marker with it — retract it from the agent.
      for (const [taskId, q] of [...this.quietRaised.entries()]) {
        if (seen.has(taskId)) continue;
        this.quietRaised.delete(taskId);
        if (q.ticket.agentId) {
          try {
            this.deps.clearQuiet?.(q.ticket, q.ticket.agentId);
          } catch (err) {
            this.log("clearQuiet threw (best-effort)", {
              taskId,
              err: String(err),
            });
          }
        }
      }
      // W2 + W5 + W9 run alongside the active-ticket sweep. Isolated so a
      // failure in one never aborts the others (all best-effort).
      await this.sweepPendingInstructions();
      await this.sweepStaleReviews();
      this.sweepSilentInProgress(tickets, seen);
    } catch (err) {
      this.log("sweep failed (best-effort)", { err: String(err) });
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * W9 — 오래 조용한 IN_PROGRESS 티켓을 드러낸다(진단 §5.4).
   *
   * ★기존 사다리(inspect)와 **독립**이다. 사다리는 담당 에이전트가 이 인스턴스
   *   메모리에서 사라졌을 때만 IN_PROGRESS 고아를 잡는데, 실제 사고에서는 에이전트가
   *   계속 `working` 으로 보였기 때문에 한 번도 걸리지 않았다. 여기서는 **표시 상태를
   *   아예 보지 않고** 마지막 실제 산출 시각만 본다.
   *
   * ★회수하지 않는다. 리셋도 claim 해제도 하지 않고 사유만 올린다 — 살아있는 작업을
   *   뺏는 판정은 evaluateGhostReclaim 한 곳에만 두고, 이 축은 "안 보이던 것을 보이게"
   *   에서 멈춘다.
   *
   * 같은 티켓은 silentInProgressMs 당 한 번만 다시 드러낸다(첫 표출은 항상 발화 —
   * `now - 0` 이 "방금"으로 오판되지 않게 한다).
   */
  private sweepSilentInProgress(
    tickets: WatchdogTicket[],
    seen: Set<string>,
  ): void {
    if (!this.deps.escalateStalledInProgress) return;
    const now = this.now();
    // 활성 집합을 떠난 티켓의 rate-limit 기억은 버린다(다시 돌아오면 즉시 표출).
    for (const taskId of [...this.silentSurfacedAt.keys()]) {
      if (!seen.has(taskId)) this.silentSurfacedAt.delete(taskId);
    }
    const silent = selectSilentInProgressTickets(
      tickets,
      now,
      this.cfg.silentInProgressMs,
    );
    for (const { ticket, verdict } of silent) {
      const last = this.silentSurfacedAt.get(ticket.taskId);
      if (last !== undefined && now - last < this.cfg.silentInProgressMs) {
        continue;
      }
      this.silentSurfacedAt.set(ticket.taskId, now);
      try {
        this.deps.escalateStalledInProgress(ticket, verdict.detail);
      } catch (err) {
        this.log("escalateStalledInProgress threw (best-effort)", {
          taskId: ticket.taskId,
          err: String(err),
        });
      }
      this.deps.recordRecovery?.(ticket, "in-progress-silent", verdict.detail);
      this.log("silent in-progress surfaced", {
        taskId: ticket.taskId,
        agentId: ticket.agentId,
        quietMin: Math.round(verdict.quietMs / 60_000),
      });
    }
  }

  /**
   * W2 — undelivered pending-instruction fallback. The Firestore listener→PTY
   * delivery depends on an attached listener; a turn-ended idle session can miss
   * it, stranding the orchestrator's follow-up for 25-50 min (reuse_agent's
   * direct PTY write always worked). Here the watchdog force-delivers any
   * instruction that has stayed undelivered past pendingFallbackMs by writing it
   * straight to the locally-hosted agent's PTY, then flips isDelivered.
   */
  private async sweepPendingInstructions(): Promise<void> {
    if (
      !this.deps.listUndeliveredInstructions ||
      !this.deps.deliverInstructionDirect
    ) {
      return;
    }
    let list: PendingInstruction[] = [];
    try {
      list = await this.deps.listUndeliveredInstructions();
    } catch (err) {
      this.log("listUndeliveredInstructions failed (best-effort)", {
        err: String(err),
      });
      return;
    }
    const now = this.now();
    const stale = selectStalePendingForFallback(
      list,
      now,
      this.cfg.pendingFallbackMs,
    );
    for (const p of stale) {
      if (this.pendingAttempted.has(p.docId)) continue;
      let delivered = false;
      try {
        delivered = this.deps.deliverInstructionDirect(
          p.targetAgentId,
          p.message,
        );
      } catch (err) {
        this.log("deliverInstructionDirect threw (best-effort)", {
          docId: p.docId,
          err: String(err),
        });
      }
      if (!delivered) continue; // agent not hosted here — leave for its host
      this.pendingAttempted.add(p.docId);
      try {
        await this.deps.markInstructionDelivered?.(p.docId);
      } catch (err) {
        this.log("markInstructionDelivered threw (best-effort)", {
          docId: p.docId,
          err: String(err),
        });
      }
      this.log("pending-fallback delivered", {
        docId: p.docId,
        agentId: p.targetAgentId,
        ageMs: now - p.createdAtMs,
      });
    }
  }

  /**
   * W5 — stale non-human REVIEW sweep. The main sweep excludes REVIEW as
   * terminal, and normal REVIEW is a human approval gate. This only surfaces
   * explicit non-human review ownership whose assignee is dead AND whose last
   * review activity is older than reviewStaleMs, rate-limited to once per
   * reviewStaleMs per ticket.
   */
  private async sweepStaleReviews(): Promise<void> {
    if (
      !this.deps.listStaleReviewCandidates ||
      !this.deps.escalateStaleReview
    ) {
      return;
    }
    let candidates: StaleReviewTicket[] = [];
    try {
      candidates = await this.deps.listStaleReviewCandidates();
    } catch (err) {
      this.log("listStaleReviewCandidates failed (best-effort)", {
        err: String(err),
      });
      return;
    }
    const now = this.now();
    const stale = selectStaleReviews(candidates, now, this.cfg.reviewStaleMs);
    const liveIds = new Set(stale.map((s) => s.taskId));
    // Drop cooldown memory for tickets no longer stale (reviewed / reassigned).
    for (const id of [...this.reviewEscalatedAt.keys()]) {
      if (!liveIds.has(id)) this.reviewEscalatedAt.delete(id);
    }
    for (const rev of stale) {
      const last = this.reviewEscalatedAt.get(rev.taskId);
      // Rate-limit ONLY re-surfacing (a prior escalation exists). The first
      // surface must always fire — `now - 0` would spuriously look "recent".
      if (last !== undefined && now - last < this.cfg.reviewStaleMs) continue;
      this.reviewEscalatedAt.set(rev.taskId, now);
      const ageH = Math.round(
        (now - (rev.lastActivityAtMs ?? now)) / 3_600_000,
      );
      const detail =
        `REVIEW ${rev.taskId} "${rev.title ?? ""}" assignee ` +
        `${rev.assigneeAgentId ?? "(none)"} is dead/foreign and no review ` +
        `activity for ~${ageH}h — needs review/merge or re-routing`;
      this.deps.escalateStaleReview(rev, detail);
      this.deps.recordRecovery?.(
        {
          taskId: rev.taskId,
          projectId: rev.projectId,
          status: "CLAIMED",
          role: rev.role ?? "backend",
          agentId: rev.assigneeAgentId,
          lastActivityAtMs: rev.lastActivityAtMs,
          title: rev.title,
        },
        "review-stale",
        detail,
      );
      this.log("review-stale surfaced", { taskId: rev.taskId, ageH });
    }
  }

  /**
   * W8 — raise / repeat / clear the board-quiet signal for one ticket.
   *
   * Four axes, checked in order (2026-08-23 보강, 티켓 O1OQKukSSCmMaJCoGHGP +
   * DQYoyas3ESx33zXJOCOa):
   *   1. exit           — this instance's PTY confirmed the process terminal
   *                        (status stopped/error). Immediate — no threshold
   *                        wait, because death isn't inferred, it's known.
   *   2. first-activity  — the ticket has NEVER recorded any board activity
   *                        (lastActivityAtMs is still null). Much shorter
   *                        threshold than board-quiet: a worker with zero
   *                        reports ever is a different failure than one that
   *                        reported for a while and then stopped.
   *   3. probe           — ★the ACTIVE axis. Everything above waits for an
   *                        observation to arrive; this one goes and checks —
   *                        without writing a single byte to the PTY. Fires at
   *                        12 min (earlier than board-quiet's 20/45) but only
   *                        with positive corroboration: the board AND the
   *                        agent's own MCP tool-call clock are BOTH past the
   *                        grace and the PTY is silent/parked. Any MCP call
   *                        inside the window is itself the answer ("응답함")
   *                        and suppresses the signal. "프로브 불가" raises
   *                        nothing at all — board-quiet keeps waiting.
   *   4. board-quiet     — the original W8 axis: reported before, then quiet
   *                        past the priority-tiered threshold.
   * A ticket is judged by exactly one axis per raise — once exit,
   * first-activity or probe claims it, board-quiet is not also evaluated for
   * the same stretch (same underlying "nothing has been reported" fact; two
   * signals for one fact would just be noise). Concretely: a stall normally
   * surfaces as `probe` at 12 min and the repeat limiter then holds
   * board-quiet's 20-min raise until repeatMs — deliberate, the orchestrator
   * has already been told, with strictly more evidence than board-quiet had.
   *
   * Fires only for a LOCALLY-hosted bound agent: a missing agent belongs to
   * another instance (which runs its own sweep — two instances raising the
   * same signal would double-ping the orchestrator). Rate-limited per ticket
   * to one signal per `stall.repeatMs`; any board activity after a signal
   * clears it.
   */
  private async sweepQuiet(
    ticket: WatchdogTicket,
    health: WatchdogAgentHealth | null,
    lastBoardMs: number,
    now: number,
    missing: boolean,
    terminalLocal: boolean,
  ): Promise<void> {
    if (!this.deps.signalQuiet || !ticket.agentId) return;
    const prior = this.quietRaised.get(ticket.taskId);
    if (prior && lastBoardMs > prior.baselineBoardMs) {
      // The board moved — whatever was wrong, someone is reporting again.
      this.quietRaised.delete(ticket.taskId);
      try {
        this.deps.clearQuiet?.(ticket, ticket.agentId);
      } catch (err) {
        this.log("clearQuiet threw (best-effort)", {
          taskId: ticket.taskId,
          err: String(err),
        });
      }
      this.deps.recordRecovery?.(
        ticket,
        "quiet-cleared",
        `board activity resumed after ${prior.repeat} quiet signal(s)`,
      );
      this.log("quiet cleared", { taskId: ticket.taskId });
      return;
    }
    if (missing) return;

    const boardIdleMs = Math.max(0, now - lastBoardMs);
    const lastWork = health?.lastWorkOutputMs ?? health?.lastPtyActivityMs;
    const pty = classifyPtyLiveness({
      now,
      status: health?.status ?? null,
      lastWorkOutputMs: lastWork,
      promptIdleSinceMs: health?.promptIdleSinceMs,
      inputWaitReason: health?.inputWaitReason,
    });
    const model = health?.concreteModel ?? ticket.model ?? null;
    const tier = stallTier(ticket.priority, this.cfg.stall);

    const raise = (
      axis: StallSignal["axis"],
      quietMs: number,
      thresholdMs: number,
      exitCode: number | null,
      detail: string,
      probe: ProbeVerdict | null = null,
      answerQuiet: AnswerQuietVerdict | null = null,
    ): void => {
      const repeat = (prior?.repeat ?? 0) + 1;
      const signal: StallSignal = {
        taskId: ticket.taskId,
        tier,
        axis,
        quietMs,
        thresholdMs,
        boardIdleMs,
        exitCode,
        probe,
        pty,
        model,
        raisedAtMs: now,
        repeat,
        answerQuiet,
      };
      const fullDetail =
        detail +
        (repeat > 1 ? ` · ${repeat}회째 알림` : "") +
        ` — 워치독은 판정하지 않습니다. 오케/사람이 확인 후 결정하세요.`;
      this.quietRaised.set(ticket.taskId, {
        lastRaisedAtMs: now,
        baselineBoardMs: lastBoardMs,
        repeat,
        ticket,
      });
      try {
        this.deps.signalQuiet!(ticket, signal, fullDetail);
      } catch (err) {
        this.log("signalQuiet threw (best-effort)", {
          taskId: ticket.taskId,
          err: String(err),
        });
      }
      this.deps.recordRecovery?.(ticket, "quiet", fullDetail);
      this.log("quiet signal", {
        taskId: ticket.taskId,
        agentId: ticket.agentId,
        axis,
        tier,
        quietMs,
        pty,
        model,
        exitCode,
        repeat,
      });
    };

    const rateLimited =
      !!prior && now - prior.lastRaisedAtMs < this.cfg.stall.repeatMs;

    // post-answer-quiet 판정은 **한 번만** 내고 축과 무관하게 재사용한다.
    // 자기 축이 신호를 올릴 때뿐 아니라 다른 축의 신호에도 실어, "이 침묵이
    // 답을 전달한 뒤의 침묵인가" 를 오케가 한눈에 보게 한다.
    const answerVerdict = evaluateAnswerQuiet({
      now,
      answer: ticket.lastAnswer ?? null,
      lastBoardActivityMs: ticket.lastActivityAtMs,
      lastMcpCallMs: health?.lastMcpCallMs ?? null,
      pty,
      lastBoardActivityByOrchestrator: ticket.lastActivityByOrchestrator,
      policy: this.cfg.stall,
    });

    // ── axis 1: exit — locally-confirmed dead process, immediate ──────────
    const exitVerdict = evaluateExitQuiet({
      now,
      terminalLocal,
      terminalSinceMs: health?.terminalSinceMs,
      lastBoardActivityMs: ticket.lastActivityAtMs,
      exitCode: health?.lastExitCode,
    });
    if (exitVerdict) {
      if (rateLimited) return;
      const detail =
        `프로세스 종료 확인(exit ${exitVerdict.exitCode ?? "?"}) — 사망, ` +
        `무활동 임계 대기 없이 즉시 신호 · 종료 후 ${Math.round(
          exitVerdict.ageMs / 60_000,
        )}분 경과 · 마지막 보드 활동은 ${Math.round(
          boardIdleMs / 60_000,
        )}분 전 · 모델 ${model ?? "?"}`;
      raise("exit", exitVerdict.ageMs, 0, exitVerdict.exitCode, detail);
      return;
    }
    // exitVerdict is null exactly when !terminalLocal, so this cannot in
    // practice be true here — kept as an explicit guard for clarity/safety.
    if (terminalLocal) return;

    // ── axis 2: first-activity — never reported once, ever ────────────────
    const faVerdict = evaluateFirstActivityQuiet({
      now,
      lastBoardActivityMs: ticket.lastActivityAtMs,
      activeSinceMs: ticket.activeSinceMs,
      policy: this.cfg.stall,
    });
    if (ticket.lastActivityAtMs === null) {
      if (faVerdict.quiet && !rateLimited) {
        const detail = `스폰(또는 재배정) 이후 ${Math.round(
          faVerdict.ageMs / 60_000,
        )}분간 보드 활동 0건(첫 활동 임계 ${Math.round(
          faVerdict.thresholdMs / 60_000,
        )}분) · ${describePtyLiveness(pty, {
          now,
          lastWorkOutputMs: lastWork,
        })} · 모델 ${model ?? "?"}`;
        raise(
          "first-activity",
          faVerdict.ageMs,
          faVerdict.thresholdMs,
          null,
          detail,
        );
      }
      // Whether raised or still within grace, a never-activated ticket is
      // entirely this axis's business — never also fall through to
      // board-quiet for the same underlying fact.
      return;
    }

    // ── axis 3: post-answer-quiet — 우리가 밀어넣은 것에 대한 반응 ────────
    //
    // ★다른 축과 기준점이 다르다. 여기서만 시계가 "스폰"이나 "마지막 활동"이
    // 아니라 **오케가 답을 전달한 시각**에서 출발한다. 실사례 2건(55분 공백 /
    // 승인 후 미착수)이 정확히 이 구간이었고, 프로세스도 살아 있고 보드도
    // 움직여서 다른 어느 축에도 안 걸렸다.
    //
    // ★acted / indeterminate 는 신호를 만들지 않는다 — 프로브 축과 같은 규율로
    // 판정 불가를 멈춤으로 뚝치지 않는다. 특히 답변 직후 정상적으로 일하는
    // 에이전트는 board-activity / mcp-call 로 acted 에서 빠져나가 절대 신호되지
    // 않는다(오탐 금지 요구사항).
    if (answerVerdict?.outcome === "quiet") {
      if (rateLimited) return;
      // ★문구 주의 — 이 신호를 "에이전트가 게으르다" 로 읽으면 안 된다. 답 전달도
      // writeAndSubmit 으로 PTY stdin 에 쓰이고, 주입 순간 컴포저에 초안이 물려
      // 있으면 답이 초안 뒤에 이어붙어 한 덩어리로 제출된다(실측 페이로드:
      // "아직 쓰는 중인 초안입니다[답변 도착] question_id=…"). 즉 침묵의 첫 번째
      // 용의자는 에이전트가 아니라 **우리 전달 경로**다. 사유를 그렇게 적는다.
      const detail =
        `★답이 전달됐다는 근거가 없다 — ${answerVerdict.reason} · ` +
        `${describePtyLiveness(pty, { now, lastWorkOutputMs: lastWork })} · ` +
        `모델 ${model ?? "?"} · ` +
        `먼저 전달을 의심할 것(컴포저 오염 시 답이 초안과 합쳐져 제출된다) · ` +
        `(이 축도 죽이지 않습니다 — 신호만 올립니다)`;
      raise(
        "post-answer-quiet",
        answerVerdict.sinceAnswerMs,
        answerVerdict.thresholdMs,
        null,
        detail,
        null,
        answerVerdict,
      );
      return;
    }

    // ── axis 4: probe — ★능동. 기다리지 않고 확인한다 ─────────────────────
    //
    // (b) 풀형 MCP 관측이 주 증거, (a) OS 관측이 보조. PTY 에는 0바이트.
    // evaluateProbe 가 board/MCP/PTY 전제를 전부 들고 있으므로 여기서는
    // "OS 를 실제로 찔러볼 가치가 있는가" 만 판단한다 — 값싼 (b) 만으로 이미
    // responsive/not-applicable 이 나오면 `ps` 를 부르지 않는다(상시 폴링 금지).
    const probeInput = {
      now,
      boardIdleMs,
      pty,
      lastMcpCallMs: health?.lastMcpCallMs ?? null,
      policy: this.cfg.stall,
    };
    let probe = evaluateProbe(probeInput);
    if (probe.outcome === "unresponsive" || probe.evidence === "no-baseline") {
      // 값싼 경로가 "무응답" 또는 "관측 수단 없음" 을 냈을 때만 OS 를 찌른다.
      // 전자는 (a) 로 사실 확인(pid 실종)/반증(CPU 진행)을 받을 값어치가 있고,
      // 후자는 MCP 시계가 없는 에이전트에 남은 유일한 관측 수단이 (a) 다.
      const sample = await this.runProcessProbe(ticket, health, now);
      if (sample) probe = evaluateProbe({ ...probeInput, process: sample });
    }
    // 신호를 만들든 안 만들든 이번 라운드 판정을 남긴다 — 다른 축의 신호에
    // 붙여 보내고, "왜 안 울렸나" 를 나중에 확인할 수 있어야 한다.
    this.lastProbe.set(ticket.taskId, probe);
    if (probe.outcome === "unresponsive") {
      if (rateLimited) return;
      const detail =
        `★능동 프로브 무응답 — ${probe.reason} · ` +
        `${describePtyLiveness(pty, { now, lastWorkOutputMs: lastWork })} · ` +
        `모델 ${model ?? "?"} · ` +
        `(PTY 에 아무것도 쓰지 않은 관측 결과입니다 — 이 축은 죽이지 않습니다)`;
      raise(
        "probe",
        probe.mcpQuietMs ?? boardIdleMs,
        probe.thresholdMs,
        null,
        detail,
        probe,
        answerVerdict,
      );
      return;
    }
    // ★responsive / indeterminate 는 신호를 만들지 않는다. 특히 indeterminate
    // ("프로브 불가")를 '멈춤' 으로 뚝치지 않는 것이 이 축의 설계 전부다 —
    // 아래 board-quiet 의 20/45분 타임라인이 그대로 살아 있어 안전망이 된다.

    // ── axis 5: board-quiet — reported before, then went quiet ───────────
    const verdict = evaluateBoardQuiet({
      now,
      lastBoardActivityMs: ticket.lastActivityAtMs,
      activeSinceMs: ticket.activeSinceMs,
      priority: ticket.priority,
      policy: this.cfg.stall,
    });
    if (!verdict.quiet) return;
    if (rateLimited) return;
    const detail =
      `보드 활동 없음 ${Math.round(verdict.quietMs / 60_000)}분 ` +
      `(임계 ${Math.round(verdict.thresholdMs / 60_000)}분 · ` +
      `${verdict.tier === "urgent" ? "긴급 P4+" : "일반"}) · ` +
      `${describePtyLiveness(pty, { now, lastWorkOutputMs: lastWork })} · ` +
      `모델 ${model ?? "?"} · 프로브: ${probe.reason}`;
    // ★프로브 결과를 board-quiet 신호에도 싣는다. "20분째 조용한데 찔러봤을 때
    // 살아 있었나" 는 오케가 '긴 추론' 과 '행(hang)' 을 가르는 데 필요한 재료다.
    raise(
      "board-quiet",
      verdict.quietMs,
      verdict.thresholdMs,
      null,
      detail,
      probe,
      answerVerdict,
    );
  }

  /**
   * 능동 프로브 (a) — OS 를 실제로 찔러본다. 배선이 없거나 관측 불가면 null.
   *
   * ★부작용은 CPU 표본 저장 하나뿐이다. PTY 에 쓰지 않고, 시그널 0(전달 검사)
   *   외에는 대상 프로세스에 어떤 시그널도 보내지 않는다.
   * ★한 에이전트당 sweep 마다 최대 1회, 그것도 (b) 가 이미 의심 판정을 낸
   *   뒤에만 불린다 — 상시 폴링 금지 요구사항이 여기서 지켜진다.
   */
  private async runProcessProbe(
    ticket: WatchdogTicket,
    health: WatchdogAgentHealth | null,
    now: number,
  ): Promise<ProcessProbeSample | null> {
    if (!this.deps.probeProcess || !ticket.agentId) return null;
    const prev = this.cpuSamples.get(ticket.agentId) ?? null;
    try {
      const sample = await this.deps.probeProcess(
        ticket.agentId,
        health?.ptyPid ?? null,
        prev?.cpuMs ?? null,
      );
      if (sample && typeof sample.cpuMs === "number") {
        this.cpuSamples.set(ticket.agentId, { atMs: now, cpuMs: sample.cpuMs });
      }
      return sample;
    } catch (err) {
      // 관측 실패는 '멈춤' 이 아니라 '모름' 이다. 그대로 삼키고 null.
      this.log("probeProcess threw (best-effort → 프로브 불가)", {
        taskId: ticket.taskId,
        err: String(err),
      });
      return null;
    }
  }

  /**
   * 가장 최근 프로브 판정(신호를 만들지 않은 것 포함). 다른 축의 신호에
   * 붙여 보내고, 진단/테스트가 "왜 안 울렸나" 를 확인하는 데 쓴다.
   */
  getLastProbe(taskId: string): ProbeVerdict | null {
    return this.lastProbe.get(taskId) ?? null;
  }

  /** Inspect one ticket and, if stuck, take the next recovery step. */
  private async inspect(ticket: WatchdogTicket): Promise<void> {
    if (!isRecoverableWatchdogStatus(ticket.status)) return;
    // ★ Recovery-only: never touch a ticket with no bound agent.
    if (!ticket.agentId) return;

    const health = this.deps.getAgentHealth(ticket.agentId);
    const now = this.now();
    // "Missing" means "not registered in THIS process's AgentManager" — which
    // is NOT proof of death. The worker may be hosted by another app instance
    // or host, or its board attribution may drift from the local registry id
    // (e.g. a codex worker posting under a self-chosen agent_id). The 2026-07-18
    // false-death storm was exactly this: a stale Electron instance's watchdog
    // judged every other instance's live worker "missing" and respawn/reset-
    // stormed the whole board while the workers kept posting add_activity.
    const missing = health === null;
    const terminalLocal =
      health !== null &&
      (health.status === "stopped" || health.status === "error");

    // Board activity (projection.lastActivityAt, bumped by every add_activity)
    // is the cross-instance heartbeat: it lives in Firestore, so it is visible
    // no matter which app instance/host runs the worker. When the ticket has
    // no activity projection yet (fresh bind), fall back to the assignment
    // start so a just-dispatched foreign-hosted worker isn't instantly
    // "inactive since epoch".
    const lastBoardMs = ticket.lastActivityAtMs ?? ticket.activeSinceMs ?? 0;

    // ── W8: board-quiet SIGNAL (not a rung of the ladder) ──────────────────
    // Judged on board activity ALONE, on purpose. Everything below this line
    // folds PTY work output into liveness — correct for "don't kill a reasoning
    // agent", but it is exactly why an agent spinning on a hung tool call for
    // 80 minutes (2026-08-22 P0 deploy) was never flagged: its spinner counted
    // as work. The quiet signal asks a different question — "has anyone been
    // TOLD anything?" — and only tells the orchestrator. No nudge, no respawn,
    // no kill hangs off it; the decision belongs to whoever knows the context.
    await this.sweepQuiet(
      ticket,
      health,
      lastBoardMs,
      now,
      missing,
      terminalLocal,
    );

    // Freshest overall signal of life: board activity OR local PTY WORK output.
    // ★Work output, not raw bytes: a CLI parked at its input prompt repaints its
    // composer forever, and counting that as life is why a mid-task stall was
    // never flagged silent (see WatchdogAgentHealth.lastWorkOutputMs). Hosts
    // that don't supply the classified clock fall back to raw PTY activity, i.e.
    // exactly the legacy behavior.
    const lastPtyWorkMs =
      health?.lastWorkOutputMs ?? health?.lastPtyActivityMs ?? 0;
    const lastActiveMs = Math.max(lastBoardMs, lastPtyWorkMs);
    // ★ Single source of liveness: a fresh BOARD heartbeat VETOES any
    // local-registry death verdict — an agent that just reported progress is
    // alive no matter what the in-memory map says. Deliberately board-only:
    // a locally-confirmed stopped/error PTY may have produced output moments
    // before dying, so local PTY freshness must not veto a terminal state.
    const boardFresh = now - lastBoardMs <= this.cfg.graceMs;
    // Dead only when locally CONFIRMED terminal (this process owned the PTY and
    // saw it stop/error), or missing AND inactive past the orphan grace. A
    // merely-missing worker with sub-grace inactivity gets no action at all —
    // its host instance is responsible for it.
    const dead =
      !boardFresh &&
      (terminalLocal ||
        (missing && now - lastActiveMs >= this.cfg.inProgressOrphanResetMs));
    // Silence-based nudging only applies to locally-hosted, live agents — a
    // nudge writes to the local PTY, which a missing worker doesn't have.
    const silent = !dead && !missing && now - lastActiveMs > this.cfg.graceMs;

    // ── W7: mid-task idle, caught by PROOF rather than by waiting ──────────
    // The agent's own terminal says it is sitting at a ready input prompt with
    // nothing left running, and the board agrees nothing has been reported. That
    // is a stall now, not in five minutes. Silence alone still gets the old,
    // slow path — this fires only on a positive marker a reasoning agent cannot
    // emit. It unlocks the nudge rung only; see mustRespawn below.
    const promptIdle = evaluatePromptIdleStall({
      promptIdleSinceMs: health?.promptIdleSinceMs,
      lastBoardActivityMs: lastBoardMs,
      now,
      graceMs: this.cfg.promptIdleGraceMs,
      agentLocallyLive: !dead && !missing && !terminalLocal,
    });

    // First-activity heartbeat: record when we first saw this ticket (with the
    // dispatch-baseline BOARD activity), then flag it "born dead" if it's still
    // alive but produced ZERO new board activity beyond that baseline within
    // the window. Deliberately board-only: a blocked CLI can keep repainting
    // PTY bytes forever while never calling add_activity / submit_for_review.
    const seenAt = this.firstSeen.get(ticket.taskId);
    if (!seenAt) {
      this.firstSeen.set(ticket.taskId, {
        atMs: now,
        baselineActivityMs: lastBoardMs,
      });
    }
    // Born-dead detection is only meaningful for a LOCALLY-hosted worker (we
    // can see its PTY booted but produced nothing). A missing worker is judged
    // solely by the inactivity gates above — never by this window.
    const noFirstActivity =
      !dead &&
      !missing &&
      !!seenAt &&
      now - seenAt.atMs >= this.cfg.firstActivityGraceMs &&
      lastBoardMs <= seenAt.baselineActivityMs;

    const state = this.states.get(ticket.taskId);

    // Healthy → if it had been stuck and activity has since advanced, it
    // recovered (e.g. a respawned worker started emitting). Reset its budget.
    if (!dead && !silent && !noFirstActivity && !promptIdle.stalled) {
      if (state && lastActiveMs > state.stuckAtActivityMs) {
        this.states.delete(ticket.taskId);
        // Re-arm the first-activity baseline from the resumed activity so a
        // later relapse is measured fresh (not against the stale spawn baseline).
        this.firstSeen.delete(ticket.taskId);
        this.deps.recordRecovery?.(
          ticket,
          "recovered",
          `agent ${ticket.agentId} resumed activity after ` +
            `${state.nudges} nudge(s), ${state.respawns} respawn(s)`,
        );
        this.log("recovered", {
          taskId: ticket.taskId,
          agentId: ticket.agentId,
          nudges: state.nudges,
          respawns: state.respawns,
        });
      }
      return;
    }

    // Stuck (dead or silent). Honor give-up + backoff/nudge cooldown.
    if (state?.exhausted) return;
    const st: RecoveryState = state ?? {
      nudges: 0,
      respawns: 0,
      cooldownUntilMs: 0,
      stuckAtActivityMs: 0,
      exhausted: false,
      rerouted: false,
    };
    if (!state) this.states.set(ticket.taskId, st);
    if (now < st.cooldownUntilMs) return;

    // ── W3: false-positive-respawn guard ──────────────────────
    // Before ANY recovery action, confirm the ticket really needs it. Even when
    // the recorded agentId looks dead/silent, the ORIGINAL worker may be alive
    // under a different name and actively committing (the web-guide-page 3/3
    // exhausted false alarm). Ask the injected probes; if any says "handled",
    // stand down and drop the accrued budget so a later genuine stall starts
    // fresh. Guards are optional — absent deps ⇒ legacy behavior.
    if (
      this.deps.isTaskStillRecoverable ||
      this.deps.probeFreshness ||
      this.deps.hasLiveWorkerForTask
    ) {
      const stillRecoverable = this.deps.isTaskStillRecoverable
        ? await this.deps.isTaskStillRecoverable(ticket.taskId)
        : undefined;
      const liveWorkerBound = this.deps.hasLiveWorkerForTask
        ? this.deps.hasLiveWorkerForTask(ticket)
        : undefined;
      // Only pay for the freshness probe if the cheaper signals didn't already
      // decide to stand down.
      let fresh: boolean | undefined;
      let freshReason: string | undefined;
      if (
        stillRecoverable !== false &&
        liveWorkerBound !== true &&
        this.deps.probeFreshness
      ) {
        const p = await this.deps.probeFreshness(ticket);
        if (p) {
          fresh = p.fresh;
          freshReason = p.reason;
        }
      }
      const guard = evaluateRespawnGuard({
        stillRecoverable,
        fresh,
        freshReason,
        liveWorkerBound,
        promptIdleProven: promptIdle.stalled,
      });
      if (guard.standDown) {
        this.states.delete(ticket.taskId);
        this.deps.recordRecovery?.(ticket, "stand-down", guard.reason);
        this.log("stand-down (false-positive guard)", {
          taskId: ticket.taskId,
          agentId: ticket.agentId,
          reason: guard.reason,
        });
        return;
      }
    }

    const orphanedInProgress = detectOrphanedInProgressStall(ticket, {
      ownerMissing: health === null,
      now,
      thresholdMs: this.cfg.inProgressOrphanResetMs,
    });
    const canHandleOrphan =
      !!this.deps.resetStalledInProgress ||
      !!this.deps.escalateStalledInProgress;
    if (orphanedInProgress.stalled && canHandleOrphan) {
      let reset = false;
      if (this.deps.resetStalledInProgress) {
        try {
          reset = await this.deps.resetStalledInProgress(
            ticket,
            orphanedInProgress.detail,
          );
        } catch (err) {
          this.log("resetStalledInProgress threw (best-effort)", {
            taskId: ticket.taskId,
            err: String(err),
          });
        }
      }
      if (reset) {
        this.states.delete(ticket.taskId);
        this.firstSeen.delete(ticket.taskId);
        this.deps.recordRecovery?.(
          ticket,
          "in-progress-reset",
          `${orphanedInProgress.detail} → reset to TODO for re-claim`,
        );
        this.log("in-progress orphan reset", {
          taskId: ticket.taskId,
          agentId: ticket.agentId,
        });
        return;
      }
      this.deps.escalateStalledInProgress?.(
        ticket,
        `${orphanedInProgress.detail} — reset unavailable`,
      );
      this.deps.recordRecovery?.(
        ticket,
        "in-progress-stall",
        `${orphanedInProgress.detail} — orchestrator notified`,
      );
      this.log("in-progress orphan surfaced", {
        taskId: ticket.taskId,
        agentId: ticket.agentId,
      });
      return;
    }

    // A born-dead ticket (never produced first activity) skips nudging — a
    // worker that never started won't answer — and respawns directly.
    //
    // ★W7 is deliberately absent from this list: being parked at the prompt is
    // never on its own a reason to respawn. It can only bring the ticket into
    // the ladder at the nudge rung; a respawn still requires the pre-existing
    // evidence (dead / born-dead) or a spent nudge budget — i.e. proof that the
    // parked agent was asked to continue and didn't.
    const mustRespawn =
      dead || noFirstActivity || st.nudges >= this.cfg.maxNudges;
    if (mustRespawn) {
      if (st.respawns >= this.cfg.maxRespawns) {
        // ── W4: real escalation instead of a log-only dead-end ──
        // Before declaring "needs human attention", try ONE model/host re-route
        // (the exhausted attempts may all have failed for a host/model reason,
        // not a genuinely-broken ticket). Only after that — or if no re-route is
        // wired — fire a REAL escalation (orch PTY nudge + Telegram).
        if (!st.rerouted && this.deps.rerouteForTicket) {
          let rerouted = false;
          try {
            rerouted = await this.deps.rerouteForTicket(ticket);
          } catch (err) {
            this.log("reroute threw (best-effort)", {
              taskId: ticket.taskId,
              err: String(err),
            });
          }
          st.rerouted = true;
          if (rerouted) {
            // Give the re-routed worker a fresh first-activity window + backoff
            // before it can be judged stuck again.
            st.cooldownUntilMs = now + this.cfg.backoffMaxMs;
            st.stuckAtActivityMs = lastActiveMs;
            this.firstSeen.set(ticket.taskId, {
              atMs: now,
              baselineActivityMs: lastBoardMs,
            });
            this.deps.recordRecovery?.(
              ticket,
              "reroute",
              `respawn budget spent — re-routed to an alternate model/host once ` +
                `before escalating`,
            );
            this.log("reroute", { taskId: ticket.taskId });
            return;
          }
          // reroute didn't fire → fall through to escalate immediately.
        }
        st.exhausted = true;
        const escalateDetail =
          `respawn budget spent (${st.respawns}/${this.cfg.maxRespawns})` +
          (st.rerouted ? " + re-route" : "") +
          ` — needs human attention`;
        this.deps.recordRecovery?.(ticket, "exhausted", escalateDetail);
        // The actual wake: orch PTY + Telegram (no-op if unwired).
        this.deps.escalate?.(ticket, escalateDetail);
        if (this.deps.escalate) {
          this.deps.recordRecovery?.(
            ticket,
            "escalated",
            "orchestrator + Telegram notified",
          );
        }
        this.log("exhausted — giving up", {
          taskId: ticket.taskId,
          agentId: ticket.agentId,
          respawns: st.respawns,
          rerouted: st.rerouted,
        });
        return;
      }

      // ── W6: cross-host / scope guard ──────────────────────────
      // Before a respawn LANDS on this host, verify the ticket's scope files
      // exist in the resolved cwd and the host constraint matches. A mis-route
      // (music_composer/stock_analysis into an empty macOS worktree) must NOT
      // write orphan code — hand it back to the origin host instead.
      if (this.deps.probeScopeHost) {
        let probe = null;
        try {
          probe = await this.deps.probeScopeHost(ticket);
        } catch (err) {
          this.log("probeScopeHost threw (best-effort)", {
            taskId: ticket.taskId,
            err: String(err),
          });
        }
        const verdict = interpretScopeHostProbe(probe);
        if (verdict.blockSpawn) {
          try {
            await this.deps.redispatchToOriginHost?.(ticket, verdict.reason);
          } catch (err) {
            this.log("redispatchToOriginHost threw (best-effort)", {
              taskId: ticket.taskId,
              err: String(err),
            });
          }
          // Park the ticket so we don't respawn-loop on the wrong host; the
          // origin host / orchestrator now owns it.
          st.exhausted = true;
          this.deps.recordRecovery?.(
            ticket,
            "misroute",
            `${verdict.action}: ${verdict.reason} — handed back to origin host, ` +
              `no spawn on this host (orphan-code guard)`,
          );
          this.log("misroute — spawn blocked", {
            taskId: ticket.taskId,
            action: verdict.action,
            reason: verdict.reason,
          });
          return;
        }
      }
      const reason = dead
        ? "dead"
        : noFirstActivity
          ? `no activity since spawn (${Math.round(
              (now - (seenAt?.atMs ?? now)) / 1000,
            )}s)`
          : promptIdle.stalled
            ? "idle at prompt, unresponsive to nudges"
            : "silent (nudges spent)";
      let ok = false;
      try {
        ok = await this.deps.respawnForTicket(ticket);
      } catch (err) {
        this.log("respawn threw (best-effort)", {
          taskId: ticket.taskId,
          err: String(err),
        });
      }
      st.respawns += 1;
      const backoff = Math.min(
        this.cfg.backoffBaseMs * 2 ** (st.respawns - 1),
        this.cfg.backoffMaxMs,
      );
      st.cooldownUntilMs = now + backoff;
      st.stuckAtActivityMs = lastActiveMs;
      // Re-arm the first-activity window so the freshly respawned worker gets a
      // full firstActivityGraceMs to produce activity before it's judged
      // born-dead again — without this, all respawns would burn within the
      // short backoff span (each tick still sees the stale baseline as stuck).
      this.firstSeen.set(ticket.taskId, {
        atMs: now,
        baselineActivityMs: lastBoardMs,
      });
      this.deps.recordRecovery?.(
        ticket,
        "respawn",
        `${reason} → respawn ${st.respawns}/${this.cfg.maxRespawns} ` +
          `(${ok ? "dispatched" : "dispatch failed"})`,
      );
      this.log("respawn", {
        taskId: ticket.taskId,
        agentId: ticket.agentId,
        attempt: st.respawns,
        reason,
        ok,
      });
      return;
    }

    // Alive but stalled (silent past grace, or provably parked at its prompt),
    // nudge budget remaining → nudge. For a parked agent this is the exactly
    // right move: the CLI is waiting for input, so give it some.
    const sent = this.deps.nudgeAgent(ticket.agentId, buildBoardNudge(ticket));
    st.nudges += 1;
    st.cooldownUntilMs = now + this.cfg.nudgeIntervalMs;
    st.stuckAtActivityMs = lastActiveMs;
    const stallReason = promptIdle.stalled
      ? promptIdle.detail
      : `silent ${Math.round((now - lastActiveMs) / 1000)}s`;
    this.deps.recordRecovery?.(
      ticket,
      "nudge",
      `${stallReason} → nudge ` +
        `${st.nudges}/${this.cfg.maxNudges} (${sent ? "sent" : "no PTY"})`,
    );
    this.log("nudge", {
      taskId: ticket.taskId,
      agentId: ticket.agentId,
      attempt: st.nudges,
      promptIdle: promptIdle.stalled,
      sent,
    });
  }
}
