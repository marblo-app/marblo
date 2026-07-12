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
 * ON by default for de-identified first-party operational metrics (legitimate
 * interest). The payload uses an anonymous install ID rather than the Firebase
 * uid, and the telemetryService scrubber strips account/user identifiers and
 * free-text inputs before any external send.
 *
 * Two ways to turn first-party telemetry off:
 *   1. Build flag `VITE_DISABLE_TELEMETRY=1` — hard kill-switch.
 *   2. Runtime user opt-out via telemetryService.setTelemetryEnabled(false).
 *
 * `VITE_DISABLE_TELEMETRY=1` stays a hard kill-switch that overrides both.
 *
 * Third-party SDKs keep their stricter opt-in stance (Sentry via consent).
 */
export function firstPartyTelemetryDefaultEnabled(): boolean {
  const env = import.meta.env;
  // Hard kill-switch wins over everything.
  if (env?.VITE_DISABLE_TELEMETRY === "1") return false;
  return true;
}
