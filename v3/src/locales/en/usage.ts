/**
 * English — `usage.*` namespace. Typed `Record<keyof typeof koUsage, string>`
 * so any key drift against the ko sibling is a compile error for this
 * namespace alone.
 */
import type { usage as koUsage } from "../ko/usage";

export const usage: Record<keyof typeof koUsage, string> = {
  // ── Page header ─────────────────────────────────────────
  "usage.title": "Usage",
  "usage.subtitle":
    "Token usage by model, agent, and day. Live (agent docs) + history (BigQuery) combined.",
  "usage.selectProjectPrompt": "Select a project to see usage.",

  // ── Period selector: labels moved to `common.period.*` (shared control) ──

  // ── Summary cards ───────────────────────────────────────
  "usage.card.totalTokens": "Total tokens",
  "usage.card.inputOutput": "Input / Output",
  "usage.card.cache": "Cache (R/W)",
  "usage.card.cost": "Cost",
  "usage.section.byModelAgent": "By model / agent",
  "usage.totals.rangeNote":
    "Selected period ({period}) · aggregated from BigQuery cost_logs",
  "usage.totals.liveNote":
    "No BigQuery rows for the selected period, so this shows live lifetime totals summed across agent docs — the period filter is not applied to these numbers.",

  // ── Model family label (only the catch-all is translated) ──
  "usage.modelFamily.other": "Other",

  // ── Vendor → submodel breakdown ─────────────────────────
  "usage.breakdown.title": "By vendor · submodel",
  "usage.breakdown.loading": "Loading aggregation…",
  "usage.breakdown.empty":
    "No usage recorded for the selected period. The breakdown is aggregated from the actual executed model id in BigQuery cost_logs.",
  "usage.breakdown.modelCount": "{n} model(s)",
  "usage.breakdown.modelUnknown": "model not recorded",
  "usage.breakdown.vendorUnknown": "Unknown vendor",
  "usage.breakdown.unregistered": "unregistered",
  "usage.breakdown.unregisteredTip":
    "This id is not in the model registry. The vendor is inferred from the id prefix, and pricing is not pinned for this id either.",
  "usage.breakdown.estimated": "est. pricing",
  "usage.breakdown.estimatedTip":
    "This model's rate is a conservative estimate, not the vendor's confirmed list price (erring toward over-reporting). On a flat subscription the real marginal cost is lower.",
  "usage.breakdown.footer":
    "Vendors are resolved from the model registry (single source) — GLM and MiniMax stay separate vendors even though they spawn the same claude binary. Cost uses the recorded rate and is notional on flat subscriptions.",

  // ── Agent ↔ actual model ────────────────────────────────
  "usage.agentModel.title": "Agent ↔ actual model",
  "usage.agentModel.empty": "No agents in this project.",
  "usage.agentModel.colAgent": "Agent",
  "usage.agentModel.colHarness": "Harness",
  "usage.agentModel.colModel": "Actual model",
  "usage.agentModel.colSource": "Evidence",
  "usage.agentModel.noModel": "not recorded",
  "usage.agentModel.source.detected": "billed session",
  "usage.agentModel.source.spawned": "spawn argv",
  "usage.agentModel.source.none": "—",
  "usage.agentModel.footer":
    "Model ids come from observation only — billed session metadata (detectedModelId) first, else the argv the main process read back (spawnedModel). With neither, the cell is left empty rather than guessed.",

  // ── Vendor credits / quota ──────────────────────────────
  "usage.credits.title": "Vendor credits · quota",
  // Catalog hasn't arrived yet. Keep the section with this line instead of
  // hiding it — a section that disappears reads as "broken", not "no data".
  "usage.credits.empty":
    "Model catalog not loaded yet. Reopen the app or check your CLI installations.",
  "usage.credits.axis.subscription": "Subscription",
  "usage.credits.axis.subscriptionQuota": "Subscription quota (5h + weekly)",
  "usage.credits.axis.unknown": "Billing axis unknown",
  "usage.credits.unavailable": "Not queryable",
  "usage.credits.noApi":
    "This vendor publishes no remaining-quota API (verified across their full docs index). Check actual consumption in the vendor console.",
  "usage.credits.subscriptionNote":
    "Subscription-based, so there is no prepaid balance. Remaining headroom is measured below under 'Rate limit status'.",
  "usage.credits.console": "Open vendor console",
  "usage.credits.keySet": "Credentials set ({keys})",
  "usage.credits.keyMissing": "Credentials missing ({keys})",
  "usage.credits.footer":
    "This panel never estimates a number. Credential status is measured by the main process; only key names are shown and values never reach the renderer.",

  // ── Daily trend ─────────────────────────────────────────
  "usage.trend.titleEmpty": "Daily trend (by vendor)",
  "usage.trend.title": "Daily trend (by vendor, last {span} days)",
  "usage.trend.empty":
    "No daily data yet. The per-model trend is aggregated from BigQuery cost logs — run an agent on a new build to populate.",
  "usage.trend.noUsage": "No usage",

  // ── Rate-limit status ───────────────────────────────────
  "usage.rateLimit.title": "Rate limit status",
  "usage.rateLimit.empty":
    "No rate-limit rows to show. Once a CLI (Claude Code, Codex, …) is installed and signed in, its remaining quota appears here.",
  "usage.rateLimit.remaining": "{percent}% left",
  "usage.rateLimit.weeklyLabel": "Weekly",
  "usage.rateLimit.noUsage": "No usage",
  "usage.rateLimit.window.5h": "5 hours",
  "usage.rateLimit.window.weekly": "Weekly (7 days)",
  "usage.rateLimit.weeklyOnly":
    "This plan has a weekly (7-day) limit only · no 5-hour window",
  "usage.rateLimit.resetSuffix": "resets {time}",
  "usage.rateLimit.note.claude":
    "Max plan: 5-hour/weekly limits (managed by the CLI) · Pro: daily limit",
  "usage.rateLimit.note.gpt":
    "rate_limits from rollout (5h/weekly window, used_percent) — live display coming soon",
  "usage.rateLimit.note.grok":
    "Measured on Grok Build CLI 0.2.117: no usage/account/quota command — SuperGrok remaining-limit data is not exposed",
  "usage.rateLimit.note.gemini":
    "Free: per-minute/daily request limits · process exits when exceeded",
  "usage.rateLimit.note.antigravity":
    "Shares your personal Gemini account quota — tightest quota, exceeded often",
  "usage.rateLimit.note.none": "No limit info",
  "usage.rateLimit.unavailable": "Not queryable",
  "usage.rateLimit.unavailableTip":
    "This vendor publishes no remaining-limit API — the number is left empty rather than invented. Check actual consumption via the vendor console link under 'Vendor credits · quota' above.",
  "usage.rateLimit.footer":
    "Rows are per vendor — GLM, MiniMax and Kimi have their own quotas even though they spawn the same claude binary. Numbers are shown only for vendors with a real account probe (Claude/Anthropic, Codex/OpenAI); Grok/xAI is empty because the measured CLI exposes no remaining-limit command, and the rest publish no query API. Claude weekly limit display is wired up later (Phase 1b, statusline capture).",

  // ── Model fact sheet (collapsible, collapsed by default) ─
  // Benchmark names (SWE-bench Verified/Pro …) and harness names stay literal —
  // they must match the source page verbatim so numbers can be cross-checked.
  "usage.factSheet.title": "Model pricing · SWE-bench · context",
  "usage.factSheet.hint": "expand to view",
  "usage.factSheet.loading": "Loading model facts…",
  "usage.factSheet.error":
    "Could not load model facts (no response from the Electron bridge).",
  "usage.factSheet.retry": "Retry",
  "usage.factSheet.empty":
    "No models to show. This table reads straight from the model registry.",
  "usage.factSheet.colModel": "Model",
  "usage.factSheet.colInput": "Input $/1M",
  "usage.factSheet.colOutput": "Output $/1M",
  "usage.factSheet.colBench": "SWE-bench (rough)",
  "usage.factSheet.colContext": "Context",
  "usage.factSheet.colBenchVariant": "{variant} (rough)",

  // ── Basis (variant) lock ─────────────────────────────────
  "usage.factSheet.basisLabel": "Basis",
  "usage.factSheet.basisNote":
    "Every SWE-bench number in this table is on one basis: {variant} ({n}/{total} models have an official figure). The other variants (Verified, Pro, …) are separate exams over different problem sets, so they cannot be subtracted or ranked against each other — only one is shown at a time. Switching the basis re-renders the table on that basis.",
  "usage.factSheet.basisTip":
    'SWE-bench is not one exam but four with different problem sets (Verified, Pro, Multilingual, Multimodal). Vendors publish different ones — OpenAI publishes only Pro, Anthropic publishes all four — so this table used to pick whichever variant each model happened to have and put them in one column. That put Verified 96 next to Pro 64.6 and the gap read as a capability difference. Now the column has a single fixed basis, and a model with no figure on that basis is left as "unverified" rather than scored low. The default basis is not hand-picked: it is whichever variant currently measures the most models with the same ruler.',
  "usage.factSheet.benchNoVariantRow":
    "No official {variant} figure for this model (we do not fill it in with a different variant's score).",

  "usage.factSheet.maxOutput": "max output {n}",
  "usage.factSheet.estimated": "est.",
  "usage.factSheet.estimatedTip":
    "The vendor's list price can't be taken at face value here (flat-rate subscription, so the real marginal cost differs — or the billing axis is different altogether). This is a conservative upper bound that avoids under-reporting.",
  "usage.factSheet.unknown": "needs checking",
  "usage.factSheet.benchNoRow":
    "No benchmark reference row for this model yet.",
  "usage.factSheet.altMeasure": "other run {harness} · {date}: {score}%",
  "usage.factSheet.altMeasureTip":
    "Another measurement of the same model on the same benchmark — a different scaffold (vendor-internal vs the official leaderboard), or the same vendor publishing again on a different date. This is how much it moves, so read the column as an order of magnitude, not a ranking.",
  // ── Tier grouping (premier · standard · value) ──────────
  "usage.factSheet.tier.all": "All",
  "usage.factSheet.tier.count": "{n}",
  "usage.factSheet.tier.premier": "Premier",
  "usage.factSheet.tier.premierDesc": "when you need top capability",
  "usage.factSheet.tier.standard": "Standard",
  "usage.factSheet.tier.standardDesc": "mid grade",
  "usage.factSheet.tier.value": "Value",
  "usage.factSheet.tier.valueDesc": "cheap, and good enough",
  "usage.factSheet.tier.ruleTip":
    "Tiers are derived from the facts in this table, not from a hand-written list of model names. The base is the registry capability grade (frontier/top → Premier, mid → Standard, cheap → Value), plus one more move in a single direction: a Standard model is promoted to Value only if its output price is at or below the table's median AND its performance-per-dollar is at or above the median. Performance is normalized against the best score on the same benchmark so different benchmarks never get compared directly. A cheap price never demotes a Premier model — a cheap Premier is still Premier.",
  "usage.factSheet.tierFooter":
    "Tiers are derived automatically from the numbers above (registry capability grade + performance-per-dollar). Add a model to the registry and it lands in the right group here on its own. A model with no official benchmark number is never promoted to Value: we know it is cheap, but not that it is good enough. Benchmark conditions differ per model, so treat this grouping as rough guidance rather than a precise ranking. A tier is a property of the model, so switching the benchmark variant above never moves it: the table cells follow the variant you picked, but tiers are judged from each model's one representative benchmark.",
  "usage.factSheet.footer":
    "Prices are read verbatim from the model registry (electron/model-registry.ts) as the single source — add a model there and it shows up here automatically. SWE-bench is four different problem sets, and each model reports under different benchmark and scaffold conditions, so these are rough figures. Every number links to its primary source and the date it was read; cells with no official number say 'needs checking' rather than guessing.",

  // ── ★Our own measurements (our-measured) — a SEPARATE section ──────────
  // The fact sheet above holds vendor-published numbers; this holds numbers we
  // measured ourselves through our own spawn path. The execution environment
  // differs (not the official Docker images), so the two can never share a
  // table — and the caption saying so is never hidden behind the collapse.
  "usage.ourBench.title": "Our own measurements (SWE-bench)",
  "usage.ourBench.badge": "our-measured",
  "usage.ourBench.loading": "Loading our measurements…",
  "usage.ourBench.error":
    "Could not load our measurements (no response from the Electron bridge).",
  "usage.ourBench.retry": "Retry",
  "usage.ourBench.empty":
    "No measurements of our own yet. Run `npm run bench:swe`, then `npm run bench:swe:emit` to publish them here.",
  "usage.ourBench.summaryLead": "{dataset} · {n} instances",
  "usage.ourBench.summaryCell": "{model} {pct}",
  "usage.ourBench.summaryControl": "controls noop {floor} · gold {ceiling}",
  "usage.ourBench.summaryControlTip":
    "noop (do nothing) and gold (apply the reference patch) measure the grader, not the model. If noop is not 0% the grader is too loose; if gold is not 100% it is too strict. Without these two rows the 100% above is a claim with no evidence behind it.",
  "usage.ourBench.expand": "Show the full table",
  "usage.ourBench.collapse": "Hide the full table",
  // ★Round accordion — the latest round expands by default, older rounds
  // start collapsed (ticket pvaMBWvxpJIGSn5N6STp). {tag} is derived from the
  // scaffold string, never hardcoded.
  "usage.ourBench.roundHeading": "{tag} round · {n} instances",
  "usage.ourBench.latestBadge": "Latest",
  "usage.ourBench.previousRoundCaption":
    "Pipeline-proof round (3 easy instances; all models at 100% is expected)",

  // ★Caption — the header text of `docs/benchmark/generated-report.md`
  // verbatim (markdown emphasis stripped). The generator constant and these
  // strings are pinned together by tests/unit/model-bench-ours.test.ts.
  "usage.ourBench.caption.separate":
    "★These numbers were measured by us, through our own spawn path. They are never placed in the same table as vendor-published figures (electron/model-bench-reference.ts).",
  "usage.ourBench.caption.execEnv":
    "★The execution environment is not the official SWE-bench Docker image, so these cannot be compared against the official leaderboard. The only valid reading is a relative comparison within the same execEnv and the same scaffold.",

  "usage.ourBench.cellsTitle": "Per-cell summary",
  "usage.ourBench.instancesTitle": "Instance × harness",
  "usage.ourBench.colHarness": "Harness",
  "usage.ourBench.colModel": "Model",
  "usage.ourBench.colEffort": "Effort",
  "usage.ourBench.colGraded": "n (graded)",
  "usage.ourBench.colResolved": "Resolved",
  "usage.ourBench.colPct": "Resolved %",
  "usage.ourBench.colNoOutput": "No output",
  "usage.ourBench.colErrored": "Errors",
  "usage.ourBench.colAvg": "Avg time",
  "usage.ourBench.colInstance": "Instance",
  "usage.ourBench.cliDefault": "(CLI default)",
  "usage.ourBench.seconds": "{n}s",
  "usage.ourBench.control.floor": "control · floor",
  "usage.ourBench.control.ceiling": "control · ceiling",
  "usage.ourBench.grade":
    "F2P {f2pPassed}/{f2pTotal} · P2P {p2pPassed}/{p2pTotal}",
  "usage.ourBench.notGraded": "not graded",
  "usage.ourBench.envLine":
    "scaffold {scaffold} · execEnv {execEnv} · grader {grader}",
  "usage.ourBench.runsLine": "{runs} runs · generated {generatedAt}",
  "usage.ourBench.footer":
    "This table comes from the same generator as {path} — nobody copies numbers out of the document by hand, so the document and this screen cannot drift apart. Runs that failed before grading are counted separately as 'Errors' rather than dropped from the denominator.",

  // ── Relative reset time (fmtReset) ──────────────────────
  "usage.reset.soon": "soon",
  "usage.reset.days": "in {n} days",
  "usage.reset.hours": "in {n} hours",
  "usage.reset.minutes": "in {n} minutes",
};
