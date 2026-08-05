/**
 * Seed the live routing knowledge graph with evidence-based cold-start priors.
 *
 * Why this exists: the graph learns only from outcomes it has observed, so on a
 * fresh (context × model) cell it routes from a blank slate — the static scorer
 * table decides, and that table's cost comments are years out of date. This
 * script installs a small, argued starting belief so the first few dispatches in
 * an unobserved context lean the right way, and then gets displaced by real data
 * (cellBias weights a prior at K/(n+K), so it fades as n grows).
 *
 * Evidence and the full reasoning per cell: v3/docs/MODEL-COMPARISON-SEED.md.
 *
 * Usage:
 *   npm run graph:seed                  # DRY RUN — print the diff, write nothing
 *   npm run graph:seed -- --apply       # back up, then write
 *   npm run graph:seed -- --revert      # strip every seeded prior
 *   npm run graph:seed -- --file <path> # target a different graph file
 *
 * Safety: dry-run is the default, --apply always writes a timestamped backup
 * next to the graph first, and --revert is a complete one-call undo.
 *
 * ── ★정적 모델 사실을 이 그래프에 복제하지 마라 ─────────────────────────
 * 단가·컨텍스트·공개 벤치 점수는 `model-registry.ts` / `model-context-reference.ts`
 * / `model-bench-reference.ts` 가 단일소스로 갖고, 오케는 `get_model_guidance`
 * (MCP)로 그것을 **직접 읽는다**. 그 수치를 prior 로 번역해 여기 눌러 담고 싶은
 * 유혹이 생기는데, 그러면 (a) 참조표가 갱신돼도 그래프의 복사본은 낡은 채로 남고,
 * (b) 카운터(관측)와 정적 사실(공개 수치)이 한 숫자로 섞여 "우리가 본 것" 과
 * "벤더가 주장한 것" 을 다시 분리할 수 없게 된다. 실제로 그 분리는 테스트로도
 * 강제돼 있다 — `tests/unit/model-bench-reference.test.ts` 의 "routing 그래프
 * 미주입" 이 라우팅 모듈의 참조표 import 자체를 막는다.
 *
 * 여기 들어가도 되는 것은 **사람이 근거를 적어 넣은 소수의 cold-start prior**
 * (아래 SEED_PRIORS, 근거는 v3/docs/MODEL-COMPARISON-SEED.md)뿐이고, 그것도 관측이
 * 쌓이면 K/(n+K) 로 밀려나도록 설계돼 있다.
 */
import * as fs from "fs";
import * as path from "path";
import {
  GLOBAL_GRAPH_FILE,
  SEED_PRIOR_MAX,
  SHRINKAGE_K,
  applyColdStartPriors,
  clampSeedPrior,
  graphBiasForModel,
  loadRoutingGraphFile,
  removeColdStartPriors,
  saveRoutingGraph,
  type ColdStartPrior,
  type GraphContext,
  type RoutingGraph,
} from "../routing-graph";
import type { ModelType } from "../dispatch-scoring";

/**
 * The 1st-pass seed (2026-07-25).
 *
 * Scope discipline — three rules decided which cells are in here, and they
 * matter more than the numbers:
 *
 *  1. ONLY factors the READ path consults. When this seed was written
 *     bridge-server built its GraphContext as `{role, tags, complexity}` —
 *     taskType was absent, so seeding `taskType:*` would have been inert.
 *     ★2026-07-25 (P2-1) that gap is closed: dispatch now carries a classified
 *     taskType (`mcp-server/task-type.ts`) and the read path consults it. This
 *     seed is deliberately left as-is anyway — adding a taskType prior is a new
 *     data claim, and the rule below (#3: only where the static scorer is silent
 *     or provably wrong) has to be argued per cell, not inherited. What DID
 *     change for free: these `complexity:*|claude` cells are now read as the
 *     **legacy/provider tier** of the model-key fallback (routing-graph.ts
 *     header), so they keep working at full weight for every claude variant
 *     until variant-level observations displace them.
 *  2. ONLY a closed value set. `complexity` is the enum simple|standard|complex,
 *     so every seeded cell is guaranteed reachable. `tags` are free-form strings
 *     supplied per dispatch, so a seeded tag is a coin-flip on ever being hit —
 *     deferred until we can measure the real tag distribution. `role` has zero
 *     cells in the live graph after 47 folded outcomes, i.e. it is not being
 *     captured yet; seeding it would be guessing twice over.
 *  3. ONLY where the static scorer is silent or provably wrong. Re-encoding
 *     MODEL_TAG_BONUSES into the graph would double-count a signal the scorer
 *     already applies.
 *
 * That leaves four cells on one axis. Small on purpose: the ticket's own
 * constraint is that a 1st injection must not overwhelm learning.
 */
const SEED_PRIORS: readonly ColdStartPrior[] = [
  {
    // Our complex tier escalates Claude's MODEL: complexity=complex resolves
    // through resolveTopClaudeModel() → claude-fable-5 ($10/$50), the vendor's
    // most capable widely-released model. Vendor docs put that model at the top
    // for long-horizon agentic work, which is what a `complex` ticket is.
    // Corroborated by the live graph (complexity:complex|claude, 15 merges, no
    // negatives), so this mostly ratifies observed behaviour rather than betting.
    factorType: "complexity",
    factorValue: "complex",
    model: "claude",
    prior: 2,
    note: "complex→fable5 ($10/$50) = vendor-top tier; 15 merges observed",
  },
  {
    // Historical prior: before gpt-5.6 model pinning, complex gpt dispatches
    // only escalated reasoning effort and inherited the user's gpt-5.5 config.
    // Keep the seed small and provider-scoped so new gpt-5.6-sol@high cells can
    // override it with direct observations.
    factorType: "complexity",
    factorValue: "complex",
    model: "gpt",
    prior: -1,
    note: "legacy complex gpt inherited gpt-5.5@high; direct gpt-5.6 cells override this prior",
  },
  {
    // routing-graph.ts's own taxonomy comment flags this: `no_activity_stale`
    // is annotated "★antigravity case" — alive but making no progress. That is
    // the documented in-repo failure mode for exactly this quadrant, and the
    // cell is empty today, so a fresh complex ticket would otherwise route to
    // antigravity with no memory of it.
    factorType: "complexity",
    factorValue: "complex",
    model: "antigravity",
    prior: -2,
    note: "documented no_activity_stale on complex agentic work",
  },
  {
    // Keeps the fleet genuinely split on cheap work (a standing operator
    // preference) and matches Codex-low's fewer-reasoning-tokens/lower-latency
    // profile. Held to +1, the smallest step, because the price argument for it
    // does NOT hold: gpt-5.5 is $5/$30 against sonnet-5's $3/$15, so at the
    // simple tier Claude is the cheaper fleet, not GPT. Deliberately no
    // counter-seed on complexity:simple|claude — the two are close enough that
    // the tie-band should decide and real outcomes should break it.
    factorType: "complexity",
    factorValue: "simple",
    model: "gpt",
    prior: 1,
    note: "fleet split on cheap work + codex-low latency; NOT a price argument",
  },
];

/** Contexts to preview, so the report shows the real routing delta. */
const PREVIEW: { label: string; ctx: GraphContext }[] = [
  { label: "complexity=complex", ctx: { complexity: "complex" } },
  { label: "complexity=standard", ctx: { complexity: "standard" } },
  { label: "complexity=simple", ctx: { complexity: "simple" } },
  {
    label: "complexity=complex + tags=[architecture]",
    ctx: { complexity: "complex", tags: ["architecture"] },
  },
];

const PREVIEW_MODELS: ModelType[] = ["claude", "gpt", "antigravity", "gemini"];

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (r >= 0 ? "+" : "") + r;
}

/** Deep clone so we can diff before/after without a second disk read. */
function clone(graph: RoutingGraph): RoutingGraph {
  return JSON.parse(JSON.stringify(graph)) as RoutingGraph;
}

function printBiasTable(before: RoutingGraph, after: RoutingGraph): void {
  console.log("\n── graphBias delta (what dispatch will actually see) ──");
  for (const { label, ctx } of PREVIEW) {
    const parts: string[] = [];
    for (const model of PREVIEW_MODELS) {
      const b = graphBiasForModel(model, ctx, before);
      const a = graphBiasForModel(model, ctx, after);
      const mark = Math.abs(a - b) > 1e-9 ? "" : " (=)";
      parts.push(`${model} ${fmt(b)}→${fmt(a)}${mark}`);
    }
    console.log(`  ${label}\n    ${parts.join("  |  ")}`);
  }
  console.log(
    "\n  Reminder: graphBias is ONE additive component, clamped to ±20, against\n" +
      "  a role hard-gate of 100, tag bonuses up to 30, and a reuse bonus of 30.",
  );
}

function printCellDiff(before: RoutingGraph, after: RoutingGraph): void {
  console.log("\n── cell diff ──");
  const keys = new Set([
    ...Object.keys(before.cells),
    ...Object.keys(after.cells),
  ]);
  for (const key of [...keys].sort()) {
    const b = before.cells[key];
    const a = after.cells[key];
    const bp = clampSeedPrior(b?.prior);
    const ap = clampSeedPrior(a?.prior);
    if (!b && a) {
      console.log(`  + ${key}  prior=${fmt(ap)}  n=0  (new, seed-only)`);
    } else if (b && !a) {
      console.log(`  - ${key}  (removed)`);
    } else if (bp !== ap) {
      console.log(
        `  ~ ${key}  prior ${fmt(bp)}→${fmt(ap)}  n=${a.n} ` +
          `(prior weight ${Math.round((SHRINKAGE_K / (a.n + SHRINKAGE_K)) * 100)}%)`,
      );
    }
  }
}

function backup(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(
    path.dirname(file),
    `${path.basename(file, ".json")}.backup-${stamp}.json`,
  );
  fs.copyFileSync(file, dest);
  return dest;
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const revert = args.includes("--revert");
  const fileFlag = args.indexOf("--file");
  const file = fileFlag >= 0 ? args[fileFlag + 1] : GLOBAL_GRAPH_FILE;
  const atMs = Date.now();

  if (apply && revert) {
    console.error("[seed] --apply and --revert are mutually exclusive.");
    process.exit(1);
  }

  const before = loadRoutingGraphFile(file);
  const after = clone(before);

  console.log(`[seed] graph: ${file}`);
  console.log(
    `[seed] before: ${Object.keys(before.cells).length} cells, ` +
      `updatedAt=${before.updatedAt}`,
  );
  console.log(
    `[seed] mode: ${revert ? "REVERT" : "SEED"}${apply ? " (APPLY)" : " (dry run — nothing will be written)"}`,
  );

  if (revert) {
    const { cleared, removed } = removeColdStartPriors(after, atMs);
    console.log(
      `\n[seed] priors cleared on ${cleared.length} cell(s), ` +
        `${removed.length} seed-only cell(s) removed`,
    );
    for (const k of cleared) console.log(`  ~ ${k} (prior stripped, kept)`);
    for (const k of removed) console.log(`  - ${k} (removed)`);
  } else {
    const res = applyColdStartPriors(after, SEED_PRIORS, atMs);
    console.log(
      `\n[seed] ${res.applied.length} applied, ${res.rejected.length} rejected ` +
        `(bound |prior| ≤ ${SEED_PRIOR_MAX})`,
    );
    for (const r of res.rejected) {
      console.error(`  ✗ ${r.key} — ${r.reason}`);
    }
    if (res.rejected.length) {
      console.error("[seed] refusing to continue with rejected entries.");
      process.exit(1);
    }
  }

  printCellDiff(before, after);
  printBiasTable(before, after);

  if (!apply && !revert) {
    console.log(
      "\n[seed] DRY RUN — nothing written. Re-run with `-- --apply` to commit.",
    );
    return;
  }
  if (!apply) {
    console.log(
      "\n[seed] DRY RUN (revert preview) — nothing written. Add `--apply` to commit.",
    );
    return;
  }

  const saved = backup(file);
  if (saved) console.log(`\n[seed] backup written: ${saved}`);
  saveRoutingGraph(after, file);
  console.log(`[seed] wrote ${file}`);
  console.log(
    `[seed] rollback: npm run graph:seed -- --revert --apply` +
      (saved ? `   (or restore ${path.basename(saved)})` : ""),
  );
}

main();
