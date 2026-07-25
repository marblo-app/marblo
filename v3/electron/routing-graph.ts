/**
 * Live routing knowledge graph (v1, machine-local).
 *
 * Spec: docs/superpowers/specs/2026-07-22-live-knowledge-graph-routing-design.md
 *
 * The dispatch scorer (`dispatch-scoring.ts`) picks a model from a weighted sum
 * of STATIC signals (MODEL_TAG_BONUSES, cost-efficiency, budget headroom). Those
 * priors never learn from what actually happened. This module is the DYNAMIC,
 * decaying, observation-based version of MODEL_TAG_BONUSES: a compact rollup of
 * "(context factor × model) → outcome" counters that feeds ONE additive
 * component (`graphBias`, ±20) into the scorer.
 *
 * Design invariants (why this is safe to add to a hot path):
 *   - COLD START = 0. No cell / tiny n → `graphBiasForModel` returns 0, so the
 *     scorer behaves EXACTLY as before until real evidence accumulates. The ONE
 *     exception is an explicitly seeded cold-start `prior` (§ Cold-start priors
 *     below): a cell a human/agent deliberately seeded contributes its prior
 *     while n is small. Un-seeded cells are still exactly 0.
 *   - BOUNDED. graphBias is clamped to ±GRAPH_BIAS_MAX (20) — the same scale as
 *     budgetBias — so it can NEVER outweigh the role hard-gate (100) or the reuse
 *     bonus (30). It's a tie-breaker / mild lean, not a router override.
 *   - CONFIDENCE SHRINKAGE. A single observation barely moves the bias
 *     (n/(n+K), K≈6). Only repeated evidence earns weight — the §3.2 false-
 *     positive safety pin (a spurious "stale" from a quiet-but-alive agent
 *     doesn't demote a model).
 *   - ATTRIBUTION. Only MODEL-fault outcomes shape the routing prior. Host /
 *     availability failures decay fast (2d); orchestrator bugs
 *     (`dependency_stuck`) are EXCLUDED entirely — the graph must never learn
 *     "model X is bad" from a `depends_on` gate that never opened.
 *
 * The read path (`loadRoutingGraph` + `graphBiasForModel`) is SYNC + pure so it
 * fits the synchronous `scoreModelsDetailed` hot path (same mtime-cache pattern
 * as `loadSubscriptionPlans`). The write path (`applyOutcome`) runs off the hot
 * path, on agent-lifecycle outcome events (graph-updater.ts).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ModelType } from "./dispatch-scoring";

// ── Failure / success taxonomy (spec §3) ───────────────────────
//
// Detailed, not the coarse stale/BLOCKED lump. Each mode carries an attribution
// bucket (model-fault vs host vs excluded) and a decay half-life bucket.
export type OutcomeMode =
  | "spawn_failed" // 1  host — CLI didn't come up on this machine
  | "auth_failed" // 2  host — spawned but not authed
  | "tool_zero" // 3  host — alive but 0 MCP tools
  | "crash_loop" // 4  model — repeated crashes (restartCount ≥ MAX)
  | "crashed" // 5  model — single crash then recover/give-up
  | "no_activity_stale" // 6  model — alive but no progress (★antigravity case)
  | "dependency_stuck" // 7  EXCLUDED — orchestrator bug, model-agnostic
  | "blocked" // 8  weak — explicit BLOCKED (≈neutral)
  | "failed" // 9  model/task — explicit FAILED
  | "review_rejected" // 10 model quality — REVIEW bounce (needs CT3prjl4 ext)
  | "completed" // 11 success — submit_for_review / DONE
  | "merged"; // 12 success — task:merged (top accepted label)

/** All modes, for tests + iteration. */
export const OUTCOME_MODES: readonly OutcomeMode[] = [
  "spawn_failed",
  "auth_failed",
  "tool_zero",
  "crash_loop",
  "crashed",
  "no_activity_stale",
  "dependency_stuck",
  "blocked",
  "failed",
  "review_rejected",
  "completed",
  "merged",
] as const;

/** Decay half-life bucket for each mode (spec §8.1). */
type DecayBucket = "model" | "host" | "quality";

const MODE_DECAY_BUCKET: Record<OutcomeMode, DecayBucket | "excluded"> = {
  // Host / availability — transient ("fix the auth and it's gone"): fast decay.
  spawn_failed: "host",
  auth_failed: "host",
  tool_zero: "host",
  // Model behaviour — durable capability signal: medium decay.
  crash_loop: "model",
  crashed: "model",
  no_activity_stale: "model",
  failed: "model",
  blocked: "model",
  // Quality (accepted / rejected output) — most durable: slow decay.
  review_rejected: "quality",
  completed: "quality",
  merged: "quality",
  // Orchestrator / infra bug — never a routing signal.
  dependency_stuck: "excluded",
};

/**
 * Attribution-weighted routing signal per mode (spec §8.2). Sign encodes
 * direction (success +, failure −); magnitude encodes rough strength. These are
 * accumulated (time-decayed) into `cell.decayed[mode]` — the sum of a cell's
 * decayed weights IS its net routing signal.
 *
 * `dependency_stuck` = 0 AND is excluded from the decay/n tracking (below), so
 * an orchestrator gate bug contributes exactly nothing to any model's prior.
 */
export const ROUTING_WEIGHT: Record<OutcomeMode, number> = {
  merged: 3,
  completed: 2,
  review_rejected: -3,
  no_activity_stale: -2,
  crash_loop: -2.5,
  crashed: -1,
  failed: -1.5,
  auth_failed: -2,
  spawn_failed: -2,
  tool_zero: -2,
  blocked: -0.3,
  dependency_stuck: 0,
};

/** True when a mode is excluded from the routing prior (spec §3.1 bucket 3). */
export function isExcludedOutcome(mode: OutcomeMode): boolean {
  return MODE_DECAY_BUCKET[mode] === "excluded";
}

// ── Tunable constants ───────────────────────────────────────────

/** Max absolute graphBias — same scale as budgetBias (dispatch-scoring). */
export const GRAPH_BIAS_MAX = 20;

/** Confidence-shrinkage constant: effect *= n/(n+K). Larger K = more evidence
 * required before the graph moves the score. */
export const SHRINKAGE_K = 6;

/** Default decay half-lives (days) written into a fresh graph (spec §8.1). */
export const DEFAULT_HALF_LIFE_DAYS: Readonly<Record<DecayBucket, number>> = {
  model: 21,
  host: 2,
  quality: 45,
};

/** Idempotency `seen` entries older than this are pruned (bounds file size). */
export const SEEN_TTL_DAYS = 30;

/** Per-project overlay preference threshold (spec §5.2): a project cell only
 * overrides the global cell once it has this many observations. */
export const PROJECT_OVERLAY_N_MIN = 8;

/**
 * Max absolute cold-start `prior` a single cell may carry (§ Cold-start priors).
 *
 * Deliberately far below GRAPH_BIAS_MAX (20) so a seeded belief is a nudge, not
 * a router override: the scorer's own static spread (MODEL_BASE_SCORE 50/45/45,
 * TIED_SCORE_BAND 5) means ±3 can break a tie but can never beat a tag bonus
 * (25) or the role hard-gate (100). Seeding above this is refused, not clamped
 * silently at the call site — see `applyColdStartPriors`.
 */
export const SEED_PRIOR_MAX = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GRAPH_VERSION = 1;

// ── Graph data model (spec §4) ──────────────────────────────────

export interface RoutingGraphCell {
  /** Raw counts (audit/debug). */
  raw: Partial<Record<OutcomeMode, number>>;
  /** Time-decayed accumulated routing weights (what scoring reads). */
  decayed: Partial<Record<OutcomeMode, number>>;
  /** Total observations feeding the confidence shrinkage. */
  n: number;
  firstSeen: string;
  lastSeen: string;
  /**
   * Cold-start prior (§ Cold-start priors) — a seeded belief, NOT an
   * observation. Bounded by SEED_PRIOR_MAX, never decays, and is deliberately
   * excluded from `n` and `raw` so it can never masquerade as evidence in an
   * audit. Its weight in `cellBias` fades as real observations arrive.
   */
  prior?: number;
  /** Short human note for why `prior` was seeded (audit trail in the file). */
  priorNote?: string;
}

export interface RoutingGraph {
  version: number;
  scope: string; // "global" | "project:<id>"
  updatedAt: string;
  halfLifeDays: Record<DecayBucket, number>;
  /** key = `${factorType}:${factorValue}|${model}` */
  cells: Record<string, RoutingGraphCell>;
  /** idempotency guard: `${taskId}:${agentId}:${mode}` → ISO ts */
  seen: Record<string, string>;
}

/** Context factors a dispatch carries — each becomes one or more cell keys. */
export interface GraphContext {
  role?: string;
  taskType?: string;
  tags?: string[];
  complexity?: "simple" | "standard" | "complex";
}

// ── Empty / default graph ───────────────────────────────────────

export function emptyRoutingGraph(scope = "global"): RoutingGraph {
  return {
    version: GRAPH_VERSION,
    scope,
    updatedAt: new Date(0).toISOString(),
    halfLifeDays: { ...DEFAULT_HALF_LIFE_DAYS },
    cells: {},
    seen: {},
  };
}

// ── Cell keys from context ──────────────────────────────────────

/** All cell keys a dispatch context touches for a given model (spec §4.1). */
export function cellKeysForContext(
  model: ModelType,
  ctx: GraphContext,
): string[] {
  const keys: string[] = [];
  const push = (factorType: string, factorValue?: string) => {
    if (factorValue && factorValue.trim()) {
      keys.push(`${factorType}:${factorValue}|${model}`);
    }
  };
  push("role", ctx.role);
  push("taskType", ctx.taskType);
  push("complexity", ctx.complexity);
  for (const tag of ctx.tags ?? []) push("tag", tag);
  return keys;
}

// ── Decay ───────────────────────────────────────────────────────

function halfLifeFor(graph: RoutingGraph, mode: OutcomeMode): number | null {
  const bucket = MODE_DECAY_BUCKET[mode];
  if (bucket === "excluded") return null;
  const hl = graph.halfLifeDays[bucket];
  return Number.isFinite(hl) && hl > 0 ? hl : DEFAULT_HALF_LIFE_DAYS[bucket];
}

/**
 * Age a cell's decayed weights forward to `atMs` (exponential decay, per-mode
 * half-life). Mutates the cell. Δt < 0 (clock skew) is clamped to 0 so a
 * backwards timestamp never amplifies a signal.
 */
function decayCellTo(
  graph: RoutingGraph,
  cell: RoutingGraphCell,
  atMs: number,
): void {
  const lastMs = Date.parse(cell.lastSeen);
  if (!Number.isFinite(lastMs)) return;
  const dtDays = Math.max(0, (atMs - lastMs) / MS_PER_DAY);
  if (dtDays === 0) return;
  for (const mode of Object.keys(cell.decayed) as OutcomeMode[]) {
    const hl = halfLifeFor(graph, mode);
    if (hl == null) continue;
    const factor = Math.pow(2, -dtDays / hl);
    const next = (cell.decayed[mode] ?? 0) * factor;
    // Drop dust so the file/decayed map doesn't accumulate ~0 entries forever.
    if (Math.abs(next) < 1e-4) delete cell.decayed[mode];
    else cell.decayed[mode] = next;
  }
}

// ── Apply an outcome (write path, spec §7) ──────────────────────

export interface OutcomeInput {
  model: ModelType;
  mode: OutcomeMode;
  ctx: GraphContext;
  /** Idempotency key parts. */
  taskId?: string | null;
  agentId?: string | null;
  /** Event server timestamp (ms). Injected for test determinism (spec §8.1). */
  atMs: number;
}

/**
 * Fold one lifecycle outcome into the graph (spec §7 feedback loop). Mutates and
 * returns `graph`. Idempotent on `(taskId, agentId, mode)` — a retried/re-read
 * outcome is absorbed once (immutable-ledger lesson: don't double-count, but
 * don't lose the first either). Excluded modes (`dependency_stuck`) record a raw
 * count + `seen` mark for audit but move NEITHER decayed weight NOR n, so they
 * contribute exactly 0 to any model's routing prior.
 */
export function applyOutcome(
  graph: RoutingGraph,
  input: OutcomeInput,
): RoutingGraph {
  const { model, mode, ctx, atMs } = input;
  const nowIso = new Date(atMs).toISOString();

  // Idempotency guard — skip an outcome already absorbed for this (task,agent).
  const seenKey = `${input.taskId ?? "-"}:${input.agentId ?? "-"}:${mode}`;
  if (graph.seen[seenKey]) return graph;
  graph.seen[seenKey] = nowIso;

  const excluded = isExcludedOutcome(mode);
  const weight = ROUTING_WEIGHT[mode] ?? 0;

  for (const key of cellKeysForContext(model, ctx)) {
    let cell = graph.cells[key];
    if (!cell) {
      cell = {
        raw: {},
        decayed: {},
        n: 0,
        firstSeen: nowIso,
        lastSeen: nowIso,
      };
      graph.cells[key] = cell;
    }
    // Raw count is always recorded (audit), even for excluded modes.
    cell.raw[mode] = (cell.raw[mode] ?? 0) + 1;

    if (!excluded) {
      // Age existing weights to now, THEN add this outcome's weight.
      decayCellTo(graph, cell, atMs);
      cell.decayed[mode] = (cell.decayed[mode] ?? 0) + weight;
      cell.n += 1;
    }
    cell.lastSeen = nowIso;
  }

  graph.updatedAt = nowIso;
  pruneSeen(graph, atMs);
  return graph;
}

/** Drop `seen` entries older than SEEN_TTL_DAYS (keeps the file bounded). */
function pruneSeen(graph: RoutingGraph, atMs: number): void {
  const cutoff = atMs - SEEN_TTL_DAYS * MS_PER_DAY;
  for (const [key, iso] of Object.entries(graph.seen)) {
    const ts = Date.parse(iso);
    if (Number.isFinite(ts) && ts < cutoff) delete graph.seen[key];
  }
}

// ── Cold-start priors (seeding path) ────────────────────────────
//
// `applyOutcome` is the only way OBSERVATIONS enter the graph. This section is
// the only way BELIEFS do. The split is the point: a prior is a hypothesis
// someone argued for from prices/docs/known failure modes, and the graph must
// never let it be mistaken for something that happened. Hence a separate field
// (never `n`, never `raw`), a hard magnitude bound, an idempotent set-not-
// accumulate write, and a single-call revert.
//
// Do NOT hand-edit `prior` into routing-graph.json. Go through
// `applyColdStartPriors` + `saveRoutingGraph` (the `graph:seed` script) so the
// bound, the audit note, and the revert path all hold.

/** One seeded (context-factor × model) belief. */
export interface ColdStartPrior {
  /** Factor family — must be one the READ path actually consults. */
  factorType: "role" | "taskType" | "complexity" | "tag";
  factorValue: string;
  model: ModelType;
  /** Signed nudge, |prior| ≤ SEED_PRIOR_MAX. */
  prior: number;
  /** Why — persisted into the cell so the live file explains itself. */
  note?: string;
}

export interface SeedResult {
  /** Cell keys written, with the value actually stored. */
  applied: { key: string; prior: number; created: boolean }[];
  /** Entries refused, with the reason (never silently dropped). */
  rejected: { key: string; reason: string }[];
}

/** Bound a prior to ±SEED_PRIOR_MAX; non-finite/absent → 0. */
export function clampSeedPrior(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-SEED_PRIOR_MAX, Math.min(SEED_PRIOR_MAX, value));
}

/**
 * Fold cold-start priors into `graph`. Mutates and returns a report.
 *
 * SET, not accumulate — re-running the same seed twice yields the same graph, so
 * a seed script is safe to re-run and a diff is meaningful. Observations already
 * on the cell (`n`, `raw`, `decayed`) are left completely untouched, so seeding a
 * cell that has been learning does not destroy what it learned; it only changes
 * the belief the cell falls back on while `n` is small.
 *
 * Refuses (rather than clamps) an over-magnitude prior: silently shrinking a
 * caller's ±20 request to ±3 would make the seed look applied when it wasn't.
 */
export function applyColdStartPriors(
  graph: RoutingGraph,
  priors: readonly ColdStartPrior[],
  atMs: number,
): SeedResult {
  const nowIso = new Date(atMs).toISOString();
  const result: SeedResult = { applied: [], rejected: [] };

  for (const p of priors) {
    const key = `${p.factorType}:${p.factorValue}|${p.model}`;
    if (!p.factorValue || !p.factorValue.trim()) {
      result.rejected.push({ key, reason: "empty factorValue" });
      continue;
    }
    if (typeof p.prior !== "number" || !Number.isFinite(p.prior)) {
      result.rejected.push({ key, reason: `non-finite prior ${p.prior}` });
      continue;
    }
    if (Math.abs(p.prior) > SEED_PRIOR_MAX) {
      result.rejected.push({
        key,
        reason: `|prior| ${Math.abs(p.prior)} exceeds SEED_PRIOR_MAX ${SEED_PRIOR_MAX}`,
      });
      continue;
    }

    let cell = graph.cells[key];
    const created = !cell;
    if (!cell) {
      cell = {
        raw: {},
        decayed: {},
        n: 0,
        firstSeen: nowIso,
        lastSeen: nowIso,
      };
      graph.cells[key] = cell;
    }
    if (p.prior === 0) {
      delete cell.prior;
      delete cell.priorNote;
    } else {
      cell.prior = p.prior;
      if (p.note) cell.priorNote = p.note;
    }
    result.applied.push({ key, prior: p.prior, created });
  }

  graph.updatedAt = nowIso;
  return result;
}

/**
 * Strip every seeded prior — the documented one-call revert. Cells that exist
 * ONLY because they were seeded (no observations) are removed entirely, so a
 * revert restores the pre-seed graph rather than leaving inert husks behind.
 * Returns the keys touched.
 */
export function removeColdStartPriors(
  graph: RoutingGraph,
  atMs: number,
): { cleared: string[]; removed: string[] } {
  const cleared: string[] = [];
  const removed: string[] = [];
  for (const [key, cell] of Object.entries(graph.cells)) {
    if (cell.prior === undefined && cell.priorNote === undefined) continue;
    delete cell.prior;
    delete cell.priorNote;
    const barren =
      (cell.n ?? 0) <= 0 &&
      Object.keys(cell.raw ?? {}).length === 0 &&
      Object.keys(cell.decayed ?? {}).length === 0;
    if (barren) {
      delete graph.cells[key];
      removed.push(key);
    } else {
      cleared.push(key);
    }
  }
  if (cleared.length || removed.length) {
    graph.updatedAt = new Date(atMs).toISOString();
  }
  return { cleared, removed };
}

// ── Graph → scoring bias (read path, spec §4.3) ─────────────────

/**
 * Net routing signal of a single cell: the standard Bayesian blend of a seeded
 * prior and observed evidence, split by the SAME confidence weight that already
 * governed this function.
 *
 *   bias = prior · K/(n+K)  +  netDecayed · n/(n+K)
 *
 * At n = 0 the cell contributes its prior alone; at n = SHRINKAGE_K (6) the two
 * carry equal weight; by n = 30 the prior is down to 1/6 influence. So evidence
 * doesn't merely outvote the seed, it *displaces* it — which is the property the
 * seeding path needs to be safe (a wrong prior self-heals).
 *
 * Un-seeded cells (`prior` absent) keep the exact previous behaviour: cold → 0,
 * one observation shrunk to ~1/7 of its weight.
 */
function cellBias(cell: RoutingGraphCell): number {
  if (!cell) return 0;
  const prior = clampSeedPrior(cell.prior);
  const n = Number.isFinite(cell.n) ? cell.n : 0;
  if (n <= 0) return prior;
  let net = 0;
  for (const mode of Object.keys(cell.decayed) as OutcomeMode[]) {
    net += cell.decayed[mode] ?? 0;
  }
  const shrink = n / (n + SHRINKAGE_K);
  return prior * (1 - shrink) + net * shrink;
}

/**
 * Observed routing prior for `model` in this dispatch context (spec §4.3).
 * Pure: reads the graph as materialized (decay is applied at write time). Sums
 * the per-cell biases the context points at, clamped to ±GRAPH_BIAS_MAX.
 *
 * Cold start (no matching cells / tiny n) → 0, i.e. the scorer is unchanged.
 */
export function graphBiasForModel(
  model: ModelType,
  ctx: GraphContext,
  graph: RoutingGraph | null | undefined,
): number {
  if (!graph) return 0;
  let sum = 0;
  for (const key of cellKeysForContext(model, ctx)) {
    const cell = graph.cells[key];
    if (cell) sum += cellBias(cell);
  }
  if (!Number.isFinite(sum)) return 0;
  return Math.max(-GRAPH_BIAS_MAX, Math.min(GRAPH_BIAS_MAX, sum));
}

export interface GraphBiasDetail {
  bias: number;
  /** Short human note for decisionReason, e.g. "complex,agentic stale". */
  note: string;
}

/**
 * graphBias plus a short reason fragment naming the dominant contributing
 * factors — surfaced in `dispatch:decision`.decisionReason so the graph's own
 * influence is re-logged to telemetry (observable feedback loop, spec §6.3).
 */
export function graphBiasDetailForModel(
  model: ModelType,
  ctx: GraphContext,
  graph: RoutingGraph | null | undefined,
): GraphBiasDetail {
  const bias = graphBiasForModel(model, ctx, graph);
  if (!graph || bias === 0) return { bias: 0, note: "" };

  // Dominant modes across the touched cells (by |decayed net| per mode).
  const modeNet = new Map<OutcomeMode, number>();
  const factors: string[] = [];
  // A cell can contribute via observations (n > 0) OR via a seeded prior alone
  // (n = 0) — include both, else a seed-driven bias would be reported with an
  // empty note and the decision log would say nothing about why it moved.
  let seeded = false;
  for (const key of cellKeysForContext(model, ctx)) {
    const cell = graph.cells[key];
    if (!cell) continue;
    const hasPrior = clampSeedPrior(cell.prior) !== 0;
    if (cell.n <= 0 && !hasPrior) continue;
    if (hasPrior) seeded = true;
    const factorValue = key.split("|")[0].split(":").slice(1).join(":");
    if (factorValue) factors.push(factorValue);
    for (const mode of Object.keys(cell.decayed) as OutcomeMode[]) {
      modeNet.set(mode, (modeNet.get(mode) ?? 0) + (cell.decayed[mode] ?? 0));
    }
  }
  const topMode = [...modeNet.entries()].sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  )[0];
  const modeLabel = topMode ? topMode[0] : seeded ? "seed" : "";
  const factorLabel = factors.slice(0, 3).join(",");
  const note = [factorLabel, modeLabel].filter(Boolean).join(" ");
  return { bias, note };
}

// ── Sync load (read path) — subscription-plans mtime-cache pattern ──

export const GLOBAL_GRAPH_FILE = path.join(
  os.homedir(),
  ".marblo",
  "routing-graph.json",
);

export function projectGraphFile(projectId: string): string {
  return path.join(
    os.homedir(),
    ".marblo",
    "projects",
    projectId,
    "routing-graph.json",
  );
}

interface GraphCacheEntry {
  graph: RoutingGraph | null;
  mtime: number;
}
const _graphCache = new Map<string, GraphCacheEntry>();

function readGraphFileCached(file: string): RoutingGraph | null {
  try {
    if (!fs.existsSync(file)) {
      _graphCache.set(file, { graph: null, mtime: 0 });
      return null;
    }
    const stat = fs.statSync(file);
    const cached = _graphCache.get(file);
    if (cached && cached.mtime === stat.mtimeMs) return cached.graph;
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as RoutingGraph;
    const graph = normalizeGraph(parsed);
    _graphCache.set(file, { graph, mtime: stat.mtimeMs });
    return graph;
  } catch {
    // Corrupt / partial write → treat as absent (cold start = no regression).
    _graphCache.set(file, { graph: null, mtime: 0 });
    return null;
  }
}

/** Defensive normalization of a parsed graph (tolerate old/partial files). */
function normalizeGraph(parsed: RoutingGraph): RoutingGraph {
  const base = emptyRoutingGraph(parsed?.scope || "global");
  return {
    ...base,
    ...parsed,
    halfLifeDays: { ...base.halfLifeDays, ...(parsed?.halfLifeDays ?? {}) },
    cells: parsed?.cells ?? {},
    seen: parsed?.seen ?? {},
  };
}

/**
 * Load the routing graph for a dispatch, SYNC (mtime cache). With a projectId,
 * returns a merged view: a project cell with n ≥ PROJECT_OVERLAY_N_MIN overrides
 * the global cell for that key; otherwise the global cell wins; the union of
 * keys is returned (spec §5.2 two-tier overlay). Missing files → empty graph, so
 * the caller's scoring is unchanged (cold start).
 */
export function loadRoutingGraph(projectId?: string): RoutingGraph {
  const global = readGraphFileCached(GLOBAL_GRAPH_FILE) ?? emptyRoutingGraph();
  if (!projectId) return global;

  const project = readGraphFileCached(projectGraphFile(projectId));
  if (!project) return global;

  const merged: RoutingGraph = {
    ...global,
    scope: `project:${projectId}`,
    cells: { ...global.cells },
    seen: {},
  };
  for (const [key, cell] of Object.entries(project.cells)) {
    if (cell.n >= PROJECT_OVERLAY_N_MIN) merged.cells[key] = cell;
    else if (!merged.cells[key]) merged.cells[key] = cell;
  }
  return merged;
}

/** Test/maintenance hook — drop the sync mtime cache. */
export function clearRoutingGraphCache(): void {
  _graphCache.clear();
}

/**
 * Read a single graph FILE fresh (bypassing the read cache) — the write path
 * (graph-updater) needs the latest on-disk state before folding a new outcome,
 * so a serialized read→mutate→write cycle never loses a concurrent update.
 * Missing/corrupt file → a fresh empty graph (never throws).
 */
export function loadRoutingGraphFile(
  file: string,
  scope = "global",
): RoutingGraph {
  try {
    if (!fs.existsSync(file)) return emptyRoutingGraph(scope);
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as RoutingGraph;
    return normalizeGraph(parsed);
  } catch {
    return emptyRoutingGraph(scope);
  }
}

// ── Atomic persistence (write path) ─────────────────────────────

/**
 * Persist a graph atomically (temp + rename) so a concurrent sync
 * `loadRoutingGraph` never sees a torn file (spec §8.5). Best-effort — a failed
 * write leaves the previous graph intact and is not fatal to dispatch.
 */
export function saveRoutingGraph(graph: RoutingGraph, file: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.floor(Date.parse(graph.updatedAt) || 0)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(graph), "utf-8");
  fs.renameSync(tmp, file);
  // Invalidate our own cache entry so the next sync load re-reads.
  _graphCache.delete(file);
}
