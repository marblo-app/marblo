/**
 * First-party telemetry gate — the single source of truth for whether the
 * app may transmit analytics off-device.
 *
 * Covers the Firebase Functions → BigQuery sinks (`logTelemetryBatch`,
 * `logHeartbeat`, `logCostBatch`, `logTaskOutcome`) and the Firestore
 * cost/usage roll-ups written by useCostWriter. These are ANALYTICS sinks —
 * NOT core product data: tasks/agents/chats keep reading & writing Firestore
 * regardless of this gate.
 *
 * OFF by default. The 6/23 build ships local-only: under PIPA we transmit no
 * analytics off-device without an explicit, affirmative opt-in (제15조 — 침묵은
 * 동의가 아니다). The only telemetry that stays on-device is the ~/.claude
 * session JSONL the main-process cost-tracker reads locally; nothing in that
 * path leaves the machine.
 *
 * Two ways to turn first-party telemetry on:
 *   1. Build flag `VITE_FIRST_PARTY_TELEMETRY=1` — internal / dogfood builds.
 *   2. Runtime opt-in after in-app consent (dev8), via
 *      telemetryService.setTelemetryEnabled(true).
 *
 * `VITE_DISABLE_TELEMETRY=1` stays a hard kill-switch that overrides both.
 *
 * Mirrors the opt-in stance already enforced for the 3rd-party SDKs
 * (sentry.ts / ga4.ts: maybeInit*(consented), default consent all-false).
 */
export function firstPartyTelemetryDefaultEnabled(): boolean {
  const env = import.meta.env;
  // Hard kill-switch wins over everything.
  if (env?.VITE_DISABLE_TELEMETRY === "1") return false;
  // Default OFF — only the explicit build flag opts a build into external send.
  return env?.VITE_FIRST_PARTY_TELEMETRY === "1";
}
