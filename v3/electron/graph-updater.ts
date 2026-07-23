/**
 * Live routing-graph updater (write path, spec 2026-07-22 §7).
 *
 * Consumes agent-lifecycle OUTCOMES (stale / crash / spawn-fail / completed /
 * merged) already observed by watchdog / agent-manager / merge hooks, folds each
 * into the machine-local `routing-graph.json` via `applyOutcome`, and persists
 * atomically. This is the feedback loop that turns "antigravity went stale on a
 * complex agentic ticket" into a decaying routing prior the next dispatch reads.
 *
 * This runs OFF the dispatch hot path — on lifecycle events that already do
 * async work — so a synchronous read→mutate→write is fine. Writes are serialized
 * (a promise chain) so two near-simultaneous outcomes can't clobber each other,
 * and every step is best-effort: a failed graph update NEVER breaks recovery,
 * telemetry, or dispatch (dispatch just reads a slightly older graph).
 *
 * Boundary note: electron can't import the renderer's `classifyTaskType()`
 * (src/), so taskType is only used when a caller already resolved it (e.g. from
 * dispatchMeta / merge changeType). Absent taskType → graceful degradation: the
 * role / tag / complexity cells still learn (spec §13).
 */

import { normalizeModel, type ModelType } from "./dispatch-scoring";
import {
  applyOutcome,
  loadRoutingGraphFile,
  saveRoutingGraph,
  GLOBAL_GRAPH_FILE,
  type GraphContext,
  type OutcomeMode,
} from "./routing-graph";

/** Restart budget beyond which repeated crashes are a crash-LOOP, not a single
 * crash (mirrors agent-manager MAX_RESTARTS). */
const CRASH_LOOP_RESTARTS = 5;

/**
 * The coarse outcome vocabulary the current telemetry/lifecycle events emit
 * (CT3prjl4 + agent-manager errorCategory). `normalizeOutcome` bridges these to
 * the finer §3 taxonomy locally (spec §7.2) until the CT3prjl4 contract grows
 * the extra modes.
 */
export type RawOutcome =
  | "stale"
  | "crashed"
  | "spawn_failed"
  | "blocked"
  | "failed"
  | "completed"
  | "merged"
  | "dependency_stuck"
  | "review_rejected";

export interface NormalizeHints {
  /** agent-manager exit classification: fast_fail_config | runtime_crash | ... */
  errorCategory?: string | null;
  /** restartCount at the time of the terminal event (crash-loop detection). */
  restartCount?: number | null;
}

/**
 * Map a raw lifecycle outcome (+ hints) onto a §3 OutcomeMode. Pure. Returns
 * null when the signal is unmapped/ignorable so the caller can no-op.
 */
export function normalizeOutcome(
  raw: RawOutcome | string,
  hints: NormalizeHints = {},
): OutcomeMode | null {
  const { errorCategory, restartCount } = hints;
  switch (raw) {
    case "stale":
    case "went_stale":
    case "no_activity_stale":
      return "no_activity_stale";
    case "spawn_failed":
      return "spawn_failed";
    case "crashed": {
      // fast_fail_config = binary/config missing on THIS host → host bucket.
      if (errorCategory === "fast_fail_config") return "spawn_failed";
      // Restart budget exhausted (runtime_crash) or ≥ MAX restarts → loop.
      if (
        errorCategory === "runtime_crash" ||
        (typeof restartCount === "number" &&
          restartCount >= CRASH_LOOP_RESTARTS)
      ) {
        return "crash_loop";
      }
      return "crashed";
    }
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    case "merged":
      return "merged";
    case "review_rejected":
      return "review_rejected";
    case "dependency_stuck":
      return "dependency_stuck";
    default:
      return null;
  }
}

/** Context the updater needs; usually read back from the task's dispatchMeta. */
export interface DispatchMetaLike {
  role?: string | null;
  tags?: string[] | null;
  taskType?: string | null;
  complexity?: string | null;
  model?: string | null;
}

export interface RecordOutcomeInput {
  taskId?: string | null;
  agentId?: string | null;
  /** Model string (raw, e.g. "codex"/"agy") — folded via normalizeModel. */
  model?: string | null;
  rawOutcome: RawOutcome | string;
  hints?: NormalizeHints;
  /** Explicit context; when omitted, resolved from dispatchMeta (fetchMeta). */
  ctx?: GraphContext;
  /** Event server timestamp (ms). Defaults to now(). */
  atMs?: number;
}

export interface GraphUpdaterOptions {
  /** Graph file to write (defaults to the global machine-local file). */
  graphFile?: string;
  /** Injected clock for determinism (defaults to Date.now). */
  now?: () => number;
  /** Read the task's dispatchMeta to recover role/tags/complexity/model when the
   * caller didn't pass an explicit ctx. Best-effort; may return null. */
  fetchMeta?: (taskId: string) => Promise<DispatchMetaLike | null>;
}

export class GraphUpdater {
  private readonly graphFile: string;
  private readonly now: () => number;
  private readonly fetchMeta?: (
    taskId: string,
  ) => Promise<DispatchMetaLike | null>;
  /** Serializes read→mutate→write so concurrent outcomes never clobber. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: GraphUpdaterOptions = {}) {
    this.graphFile = opts.graphFile ?? GLOBAL_GRAPH_FILE;
    this.now = opts.now ?? (() => Date.now());
    this.fetchMeta = opts.fetchMeta;
  }

  /**
   * Fold one lifecycle outcome into the graph. Best-effort + fire-and-forget
   * safe: resolves once the write settles; never throws. Returns the applied
   * OutcomeMode (or null when the signal was unmapped / unattributable).
   */
  async recordOutcome(input: RecordOutcomeInput): Promise<OutcomeMode | null> {
    const mode = normalizeOutcome(input.rawOutcome, input.hints ?? {});
    if (!mode) return null;

    // Resolve context + model. Explicit ctx fields win; any missing field is
    // backfilled from the task's dispatchMeta (so a partial ctx — e.g. a merge
    // supplying only taskType — still recovers role/tags/complexity/model).
    let ctx: GraphContext | undefined = input.ctx
      ? { ...input.ctx }
      : undefined;
    let modelStr = input.model ?? null;
    const ctxIncomplete =
      !ctx || !ctx.role || !ctx.tags || !ctx.complexity || !ctx.taskType;
    if ((ctxIncomplete || !modelStr) && input.taskId && this.fetchMeta) {
      try {
        const meta = await this.fetchMeta(input.taskId);
        if (meta) {
          ctx = {
            role: ctx?.role ?? meta.role ?? undefined,
            tags: ctx?.tags ?? meta.tags ?? undefined,
            taskType: ctx?.taskType ?? meta.taskType ?? undefined,
            complexity: ctx?.complexity ?? normalizeComplexity(meta.complexity),
          };
          modelStr = modelStr ?? meta.model ?? null;
        }
      } catch {
        // ignore — fall through with whatever we have
      }
    }

    const model = normalizeModel(modelStr ?? undefined);
    // Can't attribute an outcome to a model → drop it (don't guess).
    if (!model || !ctx) return null;
    if (!hasAnyFactor(ctx)) return null;

    const atMs = input.atMs ?? this.now();
    await this.enqueueWrite(model, mode, ctx, input, atMs);
    return mode;
  }

  private enqueueWrite(
    model: ModelType,
    mode: OutcomeMode,
    ctx: GraphContext,
    input: RecordOutcomeInput,
    atMs: number,
  ): Promise<void> {
    const run = () => {
      try {
        const graph = loadRoutingGraphFile(this.graphFile);
        // Idempotency-aware write-skip: applyOutcome is a no-op when this
        // (taskId,agentId,mode) was already folded (its `seen` guard). Detect
        // that up front so a re-delivered outcome never rewrites an unchanged
        // file — notably the merge_history subscription re-emitting historical
        // merges on every launch (a fresh in-memory Set re-forwards them, but
        // the graph already absorbed each). Safe-degrading: if this key format
        // ever drifts from routing-graph's, `alreadyFolded` just reads false
        // and we always save — it can never skip a genuine first-time fold nor
        // lose data. Mirrors applyOutcome's `${taskId}:${agentId}:${mode}` key.
        const seenKey = `${input.taskId ?? "-"}:${
          input.agentId ?? "-"
        }:${mode}`;
        const alreadyFolded = Object.prototype.hasOwnProperty.call(
          graph.seen,
          seenKey,
        );
        applyOutcome(graph, {
          model,
          mode,
          ctx,
          taskId: input.taskId ?? null,
          agentId: input.agentId ?? null,
          atMs,
        });
        if (!alreadyFolded) saveRoutingGraph(graph, this.graphFile);
      } catch (err) {
        console.warn("[GraphUpdater] recordOutcome write failed:", err);
      }
    };
    // Chain regardless of prior success/failure so one bad write can't wedge the
    // queue (same discipline as bridge-server withTaskLock).
    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }
}

function normalizeComplexity(
  c: string | null | undefined,
): "simple" | "standard" | "complex" | undefined {
  return c === "simple" || c === "standard" || c === "complex" ? c : undefined;
}

function hasAnyFactor(ctx: GraphContext): boolean {
  return !!(
    (ctx.role && ctx.role.trim()) ||
    (ctx.taskType && ctx.taskType.trim()) ||
    (ctx.complexity && ctx.complexity.trim()) ||
    (ctx.tags && ctx.tags.length > 0)
  );
}
