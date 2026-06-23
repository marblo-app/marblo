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

    const state = this.states.get(ticket.taskId);

    // Healthy → if it had been stuck and activity has since advanced, it
    // recovered (e.g. a respawned worker started emitting). Reset its budget.
    if (!dead && !silent) {
      if (state && lastActiveMs > state.stuckAtActivityMs) {
        this.states.delete(ticket.taskId);
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

    const mustRespawn = dead || st.nudges >= this.cfg.maxNudges;
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
      const reason = dead ? "dead" : "silent (nudges spent)";
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
