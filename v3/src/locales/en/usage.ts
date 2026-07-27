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

  // ── Period selector ─────────────────────────────────────
  "usage.period.label": "Period",
  "usage.period.7d": "7 days",
  "usage.period.30d": "30 days",
  "usage.period.all": "All",

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
  "usage.rateLimit.note.gemini":
    "Free: per-minute/daily request limits · process exits when exceeded",
  "usage.rateLimit.note.antigravity":
    "Shares your personal Gemini account quota — tightest quota, exceeded often",
  "usage.rateLimit.note.none": "No limit info",
  "usage.rateLimit.unavailable": "Not queryable",
  "usage.rateLimit.unavailableTip":
    "This vendor publishes no remaining-limit API — the number is left empty rather than invented. Check actual consumption via the vendor console link under 'Vendor credits · quota' above.",
  "usage.rateLimit.footer":
    "Rows are per vendor — GLM, MiniMax and Kimi have their own quotas even though they spawn the same claude binary. Numbers are shown only for vendors with a real account probe (Claude/Anthropic, Codex/OpenAI); the rest publish no query API and stay empty. Claude weekly limit display is wired up later (Phase 1b, statusline capture).",

  // ── Model fact sheet (collapsible, collapsed by default) ─
  // Benchmark names (SWE-bench Verified/Pro …) and harness names stay literal —
  // they must match the source page verbatim so numbers can be cross-checked.
  "usage.factSheet.title": "Model pricing · performance · context",
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
  "usage.factSheet.footer":
    "Prices are read verbatim from the model registry (electron/model-registry.ts) as the single source — add a model there and it shows up here automatically. SWE-bench is four different problem sets, and each model reports under different benchmark and scaffold conditions, so these are rough figures. Every number links to its primary source and the date it was read; cells with no official number say 'needs checking' rather than guessing.",

  // ── Relative reset time (fmtReset) ──────────────────────
  "usage.reset.soon": "soon",
  "usage.reset.days": "in {n} days",
  "usage.reset.hours": "in {n} hours",
  "usage.reset.minutes": "in {n} minutes",
};
