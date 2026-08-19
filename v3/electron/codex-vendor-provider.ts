/**
 * Codex OpenAI-compatible env-swap vendors (Upstage / DeepSeek).
 *
 * Codex 0.147+ ignores OPENAI_BASE_URL when a ChatGPT account is logged in and
 * sends requests to the ChatGPT backend — which rejects solar-pro4 / deepseek
 * with HTTP 400. The fix is the official custom-provider path:
 *
 *   model_provider = "<id>"
 *   preferred_auth_method = "apikey"
 *   forced_login_method = "api"
 *   [model_providers.<id>]
 *   name / base_url / env_key / wire_api
 *
 * DeepSeek natively speaks Responses. Upstage Solar Pro 4 only exposes the
 * OpenAI Chat Completions path, so Codex must use wire_api="chat" directly
 * against https://api.upstage.ai/v1.
 */
import {
  envProfileForModel,
  getModel,
  vendorEnvSecretRef,
  type VendorId,
} from "./model-registry";
import { getVendorSecret } from "./vendor-secrets";

/** Vendors that use Codex (gpt) with an OpenAI-compatible env-swap profile. */
const CODEX_OPENAI_COMPAT_VENDORS: ReadonlySet<VendorId> = new Set([
  "upstage",
  "deepseek",
]);

export interface CodexVendorProviderOverride {
  /** Codex model_providers.<id> / model_provider value. */
  providerId: VendorId;
  /** Human-readable provider name in config.toml. */
  name: string;
  /** Upstream OpenAI-compatible base URL (no trailing slash required). */
  upstreamBaseUrl: string;
  /** Env var Codex reads for the Bearer token (must be present at spawn). */
  envKey: string;
  /** Codex custom-provider wire protocol. */
  wireApi: "chat" | "responses";
  /**
   * True when the upstream lacks /v1/responses and needs the local chat bridge.
   * Kept for vendors that still need Responses → Chat translation.
   */
  needsChatBridge: boolean;
}

const PROVIDER_META: Readonly<
  Record<
    "upstage" | "deepseek",
    {
      name: string;
      upstreamBaseUrl: string;
      wireApi: "chat" | "responses";
      needsChatBridge: boolean;
    }
  >
> = {
  upstage: {
    name: "Upstage Solar",
    upstreamBaseUrl: "https://api.upstage.ai/v1",
    wireApi: "chat",
    needsChatBridge: false,
  },
  deepseek: {
    name: "DeepSeek",
    upstreamBaseUrl: "https://api.deepseek.com",
    wireApi: "responses",
    needsChatBridge: false,
  },
};

function secretPresent(envKey: string): boolean {
  return Boolean(process.env[envKey]?.trim() || getVendorSecret(envKey));
}

/**
 * Resolve the Codex custom-provider override for a pinned model, or null when
 * the model is not an OpenAI-compat Codex env-swap vendor (or credentials are
 * incomplete — same all-or-nothing rule as applyVendorEnv).
 */
export function resolveCodexVendorProviderOverride(
  pinnedModelId?: string,
): CodexVendorProviderOverride | null {
  if (!pinnedModelId) return null;
  const entry = getModel(pinnedModelId);
  if (!entry || entry.harness !== "gpt") return null;
  if (entry.provider !== "upstage" && entry.provider !== "deepseek") return null;
  if (!CODEX_OPENAI_COMPAT_VENDORS.has(entry.provider)) return null;

  const profile = envProfileForModel(pinnedModelId);
  if (Object.keys(profile).length === 0) return null;

  const envKeys = [
    ...new Set(
      Object.values(profile)
        .map((v) => vendorEnvSecretRef(v))
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  if (envKeys.length === 0) return null;
  if (envKeys.some((k) => !secretPresent(k))) return null;

  const meta = PROVIDER_META[entry.provider];
  return {
    providerId: entry.provider,
    name: meta.name,
    upstreamBaseUrl: meta.upstreamBaseUrl,
    envKey: envKeys[0]!,
    wireApi: meta.wireApi,
    needsChatBridge: meta.needsChatBridge,
  };
}

/**
 * TOML fragment for an isolated CODEX_HOME config.toml.
 * `baseUrl` is the URL Codex will call (upstream or local bridge).
 */
export function renderCodexVendorProviderToml(
  override: CodexVendorProviderOverride,
  baseUrl: string,
): string {
  const lines = [
    `model_provider = ${JSON.stringify(override.providerId)}`,
    'preferred_auth_method = "apikey"',
    'forced_login_method = "api"',
    "",
    `[model_providers.${override.providerId}]`,
    `name = ${JSON.stringify(override.name)}`,
    `base_url = ${JSON.stringify(baseUrl.replace(/\/$/, ""))}`,
    `env_key = ${JSON.stringify(override.envKey)}`,
    `wire_api = ${JSON.stringify(override.wireApi)}`,
    // Custom providers must not reuse ChatGPT login.
    "requires_openai_auth = false",
  ];
  return lines.join("\n") + "\n";
}

/**
 * Ensure the spawn env carries the vendor secret under `env_key` (Codex reads
 * that name), not only as OPENAI_API_KEY from the envProfile swap.
 */
export function injectCodexVendorEnvKey(
  env: Record<string, string>,
  override: CodexVendorProviderOverride,
): Record<string, string> {
  const secret = env[override.envKey] || env.OPENAI_API_KEY;
  if (!secret) return env;
  if (env[override.envKey] === secret) return env;
  return { ...env, [override.envKey]: secret };
}
