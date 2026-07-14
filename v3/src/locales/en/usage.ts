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

  // ── Summary cards ───────────────────────────────────────
  "usage.card.totalTokens": "Total tokens",
  "usage.card.inputOutput": "Input / Output",
  "usage.card.cache": "Cache (R/W)",
  "usage.section.byModelAgent": "By model / agent",

  // ── Model family label (only the catch-all is translated) ──
  "usage.modelFamily.other": "Other",

  // ── Weekly token card ───────────────────────────────────
  "usage.weekly.title": "Last 7 days total tokens",
  "usage.weekly.tokensSuffix": "tokens · last 7 days",
  "usage.weekly.empty":
    "No token data for the last 7 days yet. Aggregated by getCostSummary (BigQuery) — run an agent on a new build to populate.",

  // ── Daily trend ─────────────────────────────────────────
  "usage.trend.titleEmpty": "Daily trend (by model)",
  "usage.trend.title": "Daily trend (by model, last {span} days)",
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
  "usage.rateLimit.footer":
    "Codex shows 5-hour and weekly (7-day) limits live from rollout. Claude weekly limit display is wired up later (Phase 1b, statusline capture).",

  // ── Relative reset time (fmtReset) ──────────────────────
  "usage.reset.soon": "soon",
  "usage.reset.days": "in {n} days",
  "usage.reset.hours": "in {n} hours",
  "usage.reset.minutes": "in {n} minutes",
};
