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
 *
 * ── ★P2-2 model@effort 해상도 (2026-07-25) ──────────────────────────────
 * cell key 의 모델 축은 이제 **프로바이더가 아니라 `modelKey` 문자열**이다
 * (`claude-opus-5`, `gpt-5.5@medium`, …). 이 파일은 그 문자열이 어떻게 만들어
 * 지는지 모른다 — 해상도 정책은 `routing-model-key.ts` 가, 사실은 레지스트리·
 * 사다리가 갖는다(이 모듈은 여전히 "카운터 + 감쇠" 만 안다).
 *
 * 마이그레이션은 **구키 폴백 다단 조회**로 한다: 읽기 호출자는 키를 구체적인
 * 것부터 덜 구체적인 순서로 넘기고(`["gpt-5.5@medium", "gpt"]`), 각 factor 마다
 * 존재하는 셀들을 **계층 축소(hierarchical shrinkage)** 로 섞는다 — 덜 구체적인
 * 셀(=종전 프로바이더 셀에 쌓인 94건)이 구체적인 셀의 prior 가 되고, 구체적인
 * 셀에 관측이 쌓이면 그 비중이 자동으로 옮겨간다. 그래서
 *   - 키 하나만 넘기면 종전과 **바이트 동일**(기존 유닛 전부 보존),
 *   - 새 키가 비어 있는 첫날엔 구키가 **원래 무게 그대로** 쓰이고,
 *   - 새 키가 차면 구키 영향이 사라진다.
 * 새 상수를 만들지 않았다 — 축소 계수는 이 파일이 이미 쓰던 SHRINKAGE_K 다.
 * ★같은 관측이 두 셀에 동시에 들어가지 않는다(쓰기 경로는 키 하나만 쓴다)는
 * 것이 이중계상 방지의 근거다.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

/**
 * Stale KG attenuation (autoselect · dispatch).
 *
 * 로컬 `routing-graph.json` 이 오래 갱신되지 않으면(관측 예: 2026-07-27 정지)
 * 과거 claude 편중 셀이 영원히 산다. soft 일수까지는 완전 가중, hard 일수부터
 * floor 까지 선형 감쇠 — 콜드(파일 없음)와 구분된다(updatedAt 이 epoch 이면 1).
 */
export const STALE_GRAPH_SOFT_DAYS = 7;
export const STALE_GRAPH_HARD_DAYS = 27;
/** hard 이상 방치 시 남는 KG 가중 하한(완전 0 이면 학습 신호 소멸). */
export const STALE_GRAPH_FLOOR = 0.15;

/**
 * graph.updatedAt 연령 → 가중 배수 [STALE_GRAPH_FLOOR, 1].
 * 파싱 실패·미래 시각·미설정 → 1(감쇠 없음).
 */
export function staleGraphAttenuation(
  updatedAt: string | undefined | null,
  nowMs: number = Date.now(),
): number {
  if (!updatedAt) return 1;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return 1;
  // Empty graph seeds use epoch — treat as "no real history", full weight (0).
  if (t <= 0) return 1;
  const ageDays = (nowMs - t) / MS_PER_DAY;
  if (!(ageDays > 0)) return 1;
  if (ageDays <= STALE_GRAPH_SOFT_DAYS) return 1;
  if (ageDays >= STALE_GRAPH_HARD_DAYS) return STALE_GRAPH_FLOOR;
  const frac =
    (ageDays - STALE_GRAPH_SOFT_DAYS) /
    (STALE_GRAPH_HARD_DAYS - STALE_GRAPH_SOFT_DAYS);
  return 1 - frac * (1 - STALE_GRAPH_FLOOR);
}

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
  /**
   * key = `${factorType}:${factorValue}|${modelKey}`
   *
   * `modelKey` 는 P2-2 이후 `claude-opus-5`·`gpt-5.5@medium` 같은 model@effort
   * 문자열이고, 그 이전에 쌓인 셀은 프로바이더 문자열(`claude`)이다. 두 세대가
   * 한 파일에 공존하는 것이 정상이며, 읽기 경로가 다단 조회로 섞는다(파일 상단).
   */
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

/**
 * The context-factor half of a cell key (`role:backend`, `taskType:feature`, …)
 * — everything left of the `|`. Split out from `cellKeysForContext` because the
 * multi-tier read (P2-2) needs to compose the SAME factor list against several
 * model keys, and re-deriving it per tier would let the two lists drift.
 */
export function factorKeysForContext(ctx: GraphContext): string[] {
  const keys: string[] = [];
  const push = (factorType: string, factorValue?: string) => {
    if (factorValue && factorValue.trim()) {
      keys.push(`${factorType}:${factorValue}`);
    }
  };
  push("role", ctx.role);
  push("taskType", ctx.taskType);
  push("complexity", ctx.complexity);
  for (const tag of ctx.tags ?? []) push("tag", tag);
  return keys;
}

/**
 * All cell keys a dispatch context touches for one model key (spec §4.1).
 *
 * `modelKey` is a plain string on purpose (P2-2): `claude-opus-5`,
 * `gpt-5.5@medium`, or — for a vendor whose model facts we don't have — the bare
 * provider (`antigravity`). Resolution lives in `routing-model-key.ts`.
 */
export function cellKeysForContext(
  modelKey: string,
  ctx: GraphContext,
): string[] {
  return factorKeysForContext(ctx).map((factor) => `${factor}|${modelKey}`);
}

/**
 * One or more model keys, ordered **most specific first**
 * (`["gpt-5.5@medium", "gpt"]`). A bare string = single tier = pre-P2-2
 * behaviour.
 */
export type ModelKeyQuery = string | readonly string[];

/** Trim + de-dup a key query, preserving the caller's specificity order. */
function modelKeyTiers(query: ModelKeyQuery): string[] {
  const raw = typeof query === "string" ? [query] : query;
  const out: string[] = [];
  for (const key of raw) {
    const trimmed = (key ?? "").trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
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
  /**
   * ★쓰기는 **키 하나만** 쓴다(P2-2). 아는 만큼만 구체적으로 — 실제 스폰 argv
   * 에서 model@effort 를 읽어낸 경우엔 그 키, 못 읽은 경우엔 프로바이더 키다.
   * 난도에서 "아마 이 모델이었을 것" 을 역추론해 구체 키로 적지 않는다(그건
   * 관측이 아니라 추측이고, 그래프는 관측만 담는다). 키를 하나로 제한하는 것이
   * 다단 읽기의 이중계상 방지 근거이기도 하다.
   */
  model: string;
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
  /** 프로바이더 키(`claude`) 또는 model@effort 키(`gpt-5.5@medium`). */
  model: string;
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
 * Blend one factor's cells across model-key tiers (P2-2 구키 폴백).
 *
 * `cells` arrives most-specific first. The fold walks from the LEAST specific
 * cell upward, each step treating the accumulated coarser signal as the prior
 * for the finer cell under the same n/(n+K) confidence weight `cellBias`
 * already uses for seeded priors:
 *
 *   bias = coarse                            (fine cell absent)
 *   bias = fine                              (coarse cell absent)
 *   bias = fine·n/(n+K) + coarse·K/(n+K)     (both present)
 *
 * The single-tier case is byte-identical to the pre-P2-2 function, which is why
 * every existing routing-graph unit keeps its expected numbers. Applying the
 * shrink ONLY when a coarser cell exists matters: shrinking unconditionally
 * would double-shrink a brand-new precise cell (1/7 → 1/49) and silently
 * flatten exactly the learning this ticket is trying to enable.
 */
function blendKeyTiers(cells: (RoutingGraphCell | undefined)[]): number {
  const present = cells.filter((c): c is RoutingGraphCell => !!c);
  if (present.length === 0) return 0;
  let acc = cellBias(present[present.length - 1]);
  for (let i = present.length - 2; i >= 0; i--) {
    const cell = present[i];
    const n = Number.isFinite(cell.n) ? Math.max(0, cell.n) : 0;
    const shrink = n / (n + SHRINKAGE_K);
    acc = cellBias(cell) * shrink + acc * (1 - shrink);
  }
  return acc;
}

/**
 * Observed routing prior for a model key in this dispatch context (spec §4.3).
 * Pure: reads the graph as materialized (decay is applied at write time). Sums
 * the per-factor biases the context points at, clamped to ±GRAPH_BIAS_MAX.
 *
 * `modelKey` may be a single key (pre-P2-2 behaviour) or a specificity-ordered
 * list (`["gpt-5.5@medium", "gpt"]`) — see `blendKeyTiers`.
 *
 * Cold start (no matching cells / tiny n) → 0, i.e. the scorer is unchanged.
 */
export function graphBiasForModel(
  modelKey: ModelKeyQuery,
  ctx: GraphContext,
  graph: RoutingGraph | null | undefined,
): number {
  if (!graph) return 0;
  const tiers = modelKeyTiers(modelKey);
  if (tiers.length === 0) return 0;
  let sum = 0;
  for (const factor of factorKeysForContext(ctx)) {
    sum += blendKeyTiers(tiers.map((key) => graph.cells[`${factor}|${key}`]));
  }
  if (!Number.isFinite(sum)) return 0;
  return Math.max(-GRAPH_BIAS_MAX, Math.min(GRAPH_BIAS_MAX, sum));
}

/**
 * 이 맥락에서 한 모델 키가 **몇 번 관측됐나**(bias 가 아니라 증거의 양).
 *
 * `graphBiasForModel` 은 "어느 쪽이 좋은가" 를 답하고, 이 함수는 "그 답을 얼마나
 * 믿을 근거가 쌓였나" 를 답한다. 둘은 다른 질문이다 — bias 0 은 "중립" 일 수도
 * "무근거" 일 수도 있고, ε-greedy 탐색(`model-autoselect`)이 고를 칸은 후자,
 * 즉 **셀이 비어 있는 칸**이어야 비교데이터가 실제로 늘어난다.
 *
 * 다단 키는 **가장 구체적인 존재 셀 하나만** 센다. 구키(프로바이더) 관측까지 더하면
 * 새 칸이 이미 관측된 것처럼 보여 탐색이 그 칸을 영원히 건너뛴다.
 */
export function observationCountForModel(
  modelKey: ModelKeyQuery,
  ctx: GraphContext,
  graph: RoutingGraph | null | undefined,
): number {
  if (!graph) return 0;
  const tiers = modelKeyTiers(modelKey);
  if (tiers.length === 0) return 0;
  let total = 0;
  for (const factor of factorKeysForContext(ctx)) {
    for (const key of tiers) {
      const cell = graph.cells[`${factor}|${key}`];
      if (!cell) continue;
      const n = Number.isFinite(cell.n) ? Math.max(0, cell.n) : 0;
      if (n > 0) {
        total += n;
        break;
      }
    }
  }
  return total;
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
  modelKey: ModelKeyQuery,
  ctx: GraphContext,
  graph: RoutingGraph | null | undefined,
): GraphBiasDetail {
  const bias = graphBiasForModel(modelKey, ctx, graph);
  if (!graph || bias === 0) return { bias: 0, note: "" };

  // Dominant modes across the touched cells (by |decayed net| per mode).
  const modeNet = new Map<OutcomeMode, number>();
  const factors: string[] = [];
  // A cell can contribute via observations (n > 0) OR via a seeded prior alone
  // (n = 0) — include both, else a seed-driven bias would be reported with an
  // empty note and the decision log would say nothing about why it moved.
  let seeded = false;
  const tiers = modelKeyTiers(modelKey);
  // Per factor, name the MOST SPECIFIC tier that actually carries signal — the
  // note should say "gpt-5.5@medium" once that cell is learning, and honestly
  // fall back to the legacy provider cell while it isn't.
  const contributing: string[] = [];
  for (const factor of factorKeysForContext(ctx)) {
    for (const key of tiers) {
      const cell = graph.cells[`${factor}|${key}`];
      if (!cell) continue;
      if (cell.n <= 0 && clampSeedPrior(cell.prior) === 0) continue;
      contributing.push(`${factor}|${key}`);
      break;
    }
  }
  for (const key of contributing) {
    const cell = graph.cells[key];
    if (!cell) continue;
    const hasPrior = clampSeedPrior(cell.prior) !== 0;
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
