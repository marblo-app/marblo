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
 * Boundary note (★2026-07-25 P2-1 로 해소): taskType 은 이제 dispatch 시점에
 * `mcp-server/task-type.ts` 가 분류해 `dispatchMeta.taskType` 으로 남기므로
 * `fetchMeta` 가 그걸 읽어 온다. 종전엔 electron 이 렌더러의 `classifyTaskType()`
 * 을 import 할 수 없다는 이유로 이 축이 사실상 항상 비어 있었고(그게 PR#596 이
 * 지목한 "학습 축이 complexity 뿐" 의 진범이다), 그때도 코드는 우아하게 저하했다.
 * 저하 경로는 그대로 유지한다 — taskType 이 없으면 role/tag/complexity 셀만 배운다.
 *
 * ★모델 축 해상도(P2-2): 셀 키의 모델 축은 `dispatchMeta.spawnedModelKey`(실제
 * 스폰 argv 관측 = `gpt-5.5@medium`)를 우선 쓰고, 없으면 종전처럼 프로바이더 키
 * (`normalizeModel` 결과)로 쓴다. **난도에서 모델을 역추론하지 않는다** — 관측이
 * 없으면 덜 구체적인 키로 적는 것이 맞고, 읽기 경로가 그 구키를 폴백으로 함께
 * 조회하므로 학습이 끊기지 않는다(routing-graph 파일 상단).
 */

import { normalizeModel } from "./dispatch-scoring";
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
  /** ★P2-2 — 실제 스폰 관측 키(`claude-opus-5`/`gpt-5.5@medium`). 있으면 이게 셀 키다. */
  spawnedModelKey?: string | null;
}

export interface RecordOutcomeInput {
  taskId?: string | null;
  agentId?: string | null;
  /** Model string (raw, e.g. "codex"/"agy") — folded via normalizeModel. */
  model?: string | null;
  rawOutcome: RawOutcome | string;
  hints?: NormalizeHints;
  /**
   * ★P2-2 — 그래프 모델축 키를 호출자가 직접 줄 때(실스폰 관측값). 없으면
   * dispatchMeta.spawnedModelKey → 그것도 없으면 프로바이더 키로 떨어진다.
   */
  modelKey?: string | null;
  /** Explicit context; when omitted, resolved from dispatchMeta (fetchMeta). */
  ctx?: GraphContext;
  /** Event server timestamp (ms). Defaults to now(). */
  atMs?: number;
}

/** Why an outcome couldn't be folded into the graph (attribution failed). */
export interface OutcomeDropInfo {
  taskId?: string | null;
  agentId?: string | null;
  mode: OutcomeMode;
  reason: string;
}

export interface GraphUpdaterOptions {
  /** Graph file to write (defaults to the global machine-local file). */
  graphFile?: string;
  /** Injected clock for determinism (defaults to Date.now). */
  now?: () => number;
  /** Read the task's dispatchMeta to recover role/tags/complexity/model when the
   * caller didn't pass an explicit ctx. Best-effort; may return null. */
  fetchMeta?: (taskId: string) => Promise<DispatchMetaLike | null>;
  /** Called (best-effort) just before an unattributable outcome is dropped —
   * defaults to a console.warn. Negative signals were silently vanishing (the
   * graph learned ONLY positives); this makes every drop observable, and lets
   * tests assert the reason. */
  onDrop?: (info: OutcomeDropInfo) => void;
}

export class GraphUpdater {
  private readonly graphFile: string;
  private readonly now: () => number;
  private readonly fetchMeta?: (
    taskId: string,
  ) => Promise<DispatchMetaLike | null>;
  private readonly onDrop: (info: OutcomeDropInfo) => void;
  /** Serializes read→mutate→write so concurrent outcomes never clobber. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: GraphUpdaterOptions = {}) {
    this.graphFile = opts.graphFile ?? GLOBAL_GRAPH_FILE;
    this.now = opts.now ?? (() => Date.now());
    this.fetchMeta = opts.fetchMeta;
    this.onDrop =
      opts.onDrop ??
      ((info) =>
        console.warn(
          `[GraphUpdater] dropped ${info.mode} outcome — ${info.reason}`,
          { taskId: info.taskId ?? null, agentId: info.agentId ?? null },
        ));
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
    let modelKey = trimmedOrNull(input.modelKey);
    const ctxIncomplete =
      !ctx || !ctx.role || !ctx.tags || !ctx.complexity || !ctx.taskType;
    if (
      (ctxIncomplete || !modelStr || !modelKey) &&
      input.taskId &&
      this.fetchMeta
    ) {
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
          modelKey = modelKey ?? trimmedOrNull(meta.spawnedModelKey);
        }
      } catch {
        // ignore — fall through with whatever we have
      }
    }

    const model = normalizeModel(modelStr ?? undefined);
    // Can't attribute an outcome to a model → drop it (don't guess). Log the
    // reason first: a silent drop here is exactly why negative signals never
    // reached the graph (dead agents dying with no resolvable model/ctx).
    if (!model) {
      this.onDrop({
        taskId: input.taskId,
        agentId: input.agentId,
        mode,
        reason: `unresolved model (raw=${JSON.stringify(modelStr)})`,
      });
      return null;
    }
    if (!ctx || !hasAnyFactor(ctx)) {
      this.onDrop({
        taskId: input.taskId,
        agentId: input.agentId,
        mode,
        reason:
          "no attributable context factor (role/taskType/complexity/tags all empty)",
      });
      return null;
    }

    const atMs = input.atMs ?? this.now();
    // ★P2-2 — 셀 키의 모델 축. 실스폰 관측 키가 있으면 model@effort 해상도로,
    // 없으면 종전 프로바이더 키로 적는다(관측 없는 구체 키를 지어내지 않는다).
    await this.enqueueWrite(modelKey ?? model, mode, ctx, input, atMs);
    return mode;
  }

  private enqueueWrite(
    modelKey: string,
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
          model: modelKey,
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

/** 공백만 있는 문자열은 값이 아니다 — 키를 만들 때 빈 축이 생기지 않게. */
function trimmedOrNull(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? v : null;
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
