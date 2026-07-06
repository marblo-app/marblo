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

// Type-only import — erased at compile/test time, so the watchdog stays a pure,
// Electron-free unit (the test imports only this module). Keeps the respawn
// model in lockstep with the dispatch model union instead of duplicating it.
import type { ModelType } from "./agent-manager";

export type WatchdogTicketStatus = "CLAIMED" | "IN_PROGRESS";

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
}

export type WatchdogAgentLiveStatus = "idle" | "working" | "error" | "stopped";

export interface WatchdogAgentHealth {
  status: WatchdogAgentLiveStatus;
  /** epoch-ms of the agent's most recent PTY output. */
  lastPtyActivityMs: number;
  currentTaskId: string | null;
}

export type RecoveryPhase = "nudge" | "respawn" | "recovered" | "exhausted";

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
  /** Injectable clock (epoch-ms) for deterministic tests. */
  now?: () => number;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface WatchdogConfig {
  /** Master toggle. */
  enabled: boolean;
  /** Sweep cadence (ms). */
  intervalMs: number;
  /** Silence (no PTY output / board activity) before a live agent is "stuck". */
  graceMs: number;
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
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: true,
  intervalMs: 60_000,
  graceMs: 300_000, // 5 min — matches agent-manager IDLE_INACTIVITY_MS
  firstActivityGraceMs: 180_000, // 3 min — a spawned worker should have logged
  // its first board activity / real PTY work well within this window.
  nudgeIntervalMs: 120_000,
  maxNudges: 2,
  maxRespawns: 3,
  backoffBaseMs: 5_000,
  backoffMaxMs: 120_000,
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
    } catch (err) {
      this.log("sweep failed (best-effort)", { err: String(err) });
    } finally {
      this.sweeping = false;
    }
  }

  /** Inspect one ticket and, if stuck, take the next recovery step. */
  private async inspect(ticket: WatchdogTicket): Promise<void> {
    // ★ Recovery-only: never touch a ticket with no bound agent.
    if (!ticket.agentId) return;

    const health = this.deps.getAgentHealth(ticket.agentId);
    const now = this.now();
    const dead =
      health === null ||
      health.status === "stopped" ||
      health.status === "error";

    // Freshest signal of life: board activity OR raw PTY output.
    const lastActiveMs = Math.max(
      ticket.lastActivityAtMs ?? 0,
      health?.lastPtyActivityMs ?? 0,
    );
    const silent = !dead && now - lastActiveMs > this.cfg.graceMs;

    // First-activity heartbeat: record when we first saw this ticket (with the
    // dispatch-baseline activity), then flag it "born dead" if it's still alive
    // but produced ZERO new activity beyond that baseline within the window.
    // This catches a spawned worker that died before its first MCP call while
    // its PTY shell (and the dispatch's fresh timestamps) kept it looking
    // active — silence-from-grace alone can't, because the clock starts fresh
    // at dispatch. A never-started worker won't answer a nudge, so it escalates
    // straight to respawn below.
    const seenAt = this.firstSeen.get(ticket.taskId);
    if (!seenAt) {
      this.firstSeen.set(ticket.taskId, {
        atMs: now,
        baselineActivityMs: lastActiveMs,
      });
    }
    const noFirstActivity =
      !dead &&
      !!seenAt &&
      now - seenAt.atMs >= this.cfg.firstActivityGraceMs &&
      lastActiveMs <= seenAt.baselineActivityMs;

    const state = this.states.get(ticket.taskId);

    // Healthy → if it had been stuck and activity has since advanced, it
    // recovered (e.g. a respawned worker started emitting). Reset its budget.
    if (!dead && !silent && !noFirstActivity) {
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
    };
    if (!state) this.states.set(ticket.taskId, st);
    if (now < st.cooldownUntilMs) return;

    // A born-dead ticket (never produced first activity) skips nudging — a
    // worker that never started won't answer — and respawns directly.
    const mustRespawn =
      dead || noFirstActivity || st.nudges >= this.cfg.maxNudges;
    if (mustRespawn) {
      if (st.respawns >= this.cfg.maxRespawns) {
        st.exhausted = true;
        this.deps.recordRecovery?.(
          ticket,
          "exhausted",
          `respawn budget spent (${st.respawns}/${this.cfg.maxRespawns}) — ` +
            `giving up; needs human attention`,
        );
        this.log("exhausted — giving up", {
          taskId: ticket.taskId,
          agentId: ticket.agentId,
          respawns: st.respawns,
        });
        return;
      }
      const reason = dead
        ? "dead"
        : noFirstActivity
          ? `no activity since spawn (${Math.round(
              (now - (seenAt?.atMs ?? now)) / 1000,
            )}s)`
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
        baselineActivityMs: lastActiveMs,
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

    // Alive but silent, nudge budget remaining → nudge.
    const sent = this.deps.nudgeAgent(ticket.agentId, buildBoardNudge(ticket));
    st.nudges += 1;
    st.cooldownUntilMs = now + this.cfg.nudgeIntervalMs;
    st.stuckAtActivityMs = lastActiveMs;
    this.deps.recordRecovery?.(
      ticket,
      "nudge",
      `silent ${Math.round((now - lastActiveMs) / 1000)}s → nudge ` +
        `${st.nudges}/${this.cfg.maxNudges} (${sent ? "sent" : "no PTY"})`,
    );
    this.log("nudge", {
      taskId: ticket.taskId,
      agentId: ticket.agentId,
      attempt: st.nudges,
      sent,
    });
  }
}
