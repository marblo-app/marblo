/**
 * Configuration. Secrets are read once and never leave this module in cleartext
 * — {@link describeConfigForLogging} is the only shape allowed into logs,
 * telemetry or error messages (existing gate discipline, §5-F).
 */

export interface ProxyConfig {
  port: number;
  /** Vendor origin. Single account, single region — cache is scoped to both (§4-A row 3). */
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  defaultAnthropicVersion: string;
  /** Request bodies above this are rejected with 413 rather than buffered. */
  maxBodyBytes: number;
  /** Upstream socket timeout. Agent turns run long; this is a backstop, not a budget. */
  upstreamTimeoutMs: number;
  /** How many RelayRecords the in-memory PoC metrics endpoint keeps. */
  metricsRingSize: number;
}

export const DEFAULT_UPSTREAM_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

function readInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProxyConfig {
  const upstreamApiKey = env.ANTHROPIC_API_KEY ?? "";
  return {
    port: readInt(env.PORT, 8080),
    upstreamBaseUrl: (
      env.UPSTREAM_BASE_URL ?? DEFAULT_UPSTREAM_BASE_URL
    ).replace(/\/+$/, ""),
    upstreamApiKey,
    defaultAnthropicVersion: env.ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION,
    maxBodyBytes: readInt(env.MAX_BODY_BYTES, 32 * 1024 * 1024),
    upstreamTimeoutMs: readInt(env.UPSTREAM_TIMEOUT_MS, 15 * 60 * 1000),
    metricsRingSize: readInt(env.METRICS_RING_SIZE, 200),
  };
}

/**
 * The only representation of config that may be logged.
 * Reports whether the key exists, never any part of its value — not even a
 * prefix, which is enough to identify an account.
 */
export function describeConfigForLogging(
  config: ProxyConfig,
): Record<string, string | number | boolean> {
  return {
    port: config.port,
    upstreamBaseUrl: config.upstreamBaseUrl,
    upstreamApiKeyPresent: config.upstreamApiKey.length > 0,
    defaultAnthropicVersion: config.defaultAnthropicVersion,
    maxBodyBytes: config.maxBodyBytes,
    upstreamTimeoutMs: config.upstreamTimeoutMs,
    metricsRingSize: config.metricsRingSize,
  };
}
