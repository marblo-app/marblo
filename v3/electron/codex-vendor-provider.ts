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
 * DeepSeek natively speaks Responses, so Codex talks to it directly.
 *
 * Upstage Solar Pro 4 only exposes /v1/chat/completions. Talking to it with
 * wire_api="chat" is no longer an option: codex-cli 0.148.0 **removed** chat
 * support and refuses to even load the config —
 *
 *   Error loading config.toml: wire_api = "chat" is no longer supported.
 *   How to fix: set wire_api = "responses"      (EXIT=1, agent dies instantly)
 *   github.com/openai/codex/discussions/7782
 *
 * So Upstage must go through the local Responses → Chat bridge
 * (codex-chat-bridge.ts): wire_api="responses" pointed at a 127.0.0.1 shim
 * that translates to https://api.upstage.ai/v1/chat/completions.
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
    // codex 0.148.0 rejects wire_api="chat" at config-load time, so the only
    // path to a chat-only upstream is responses-over-bridge.
    wireApi: "responses",
    needsChatBridge: true,
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

  // ★크레덴셜이 없을 때 **조용히** null 을 주면 안 된다.
  //
  // null 은 "이 모델은 벤더가 아니다" 와 "벤더인데 키가 없다" 를 같은 값으로
  // 접는데, 두 번째 경우의 결과는 전혀 다르다: 호출자는 model_provider 를 안
  // 붙이고 ChatGPT auth.json 을 그대로 심링크한 채, argv 에는 여전히
  // `-c model="deepseek-v4-flash"` 를 붙여 스폰한다. 그러면 codex 는 우리
  // ChatGPT 계정으로 ChatGPT 백엔드에 벤더 slug 를 물어보고 HTTP 400 을 받는다.
  // 게다가 `model_catalog_json` 도 같이 빠져 apply_patch 마저 등록되지 않는다.
  //
  // 이건 가설이 아니라 이 레포가 이미 하루를 태운 실패 모양이다(solar-pro4 400,
  // #1037 은 그 400 을 "브리지 탓" 으로 오진했다). `applyVendorEnv` 가 남기는
  // 경고는 env 미주입만 말하고 이 config 조합은 말하지 않으므로, 진짜 위험한
  // 상태를 여기서 이름 붙여 남긴다. 값은 절대 안 남기고 **키 이름만** 남긴다.
  const missing = envKeys.filter((k) => !secretPresent(k));
  if (missing.length > 0) {
    console.error(
      "[codex-vendor-provider] 벤더 크레덴셜 없음 — model_provider 오버라이드를 " +
        "붙이지 않고 스폰한다(조용한 실패 아님, 사유는 이 줄이다)",
      {
        model: pinnedModelId,
        vendor: entry.provider,
        missingEnvKeys: missing,
        effect:
          "codex 가 ChatGPT 로그인으로 벤더 slug 를 요청해 HTTP 400 이 나고, " +
          "model_catalog_json 도 빠져 apply_patch 가 등록되지 않는다",
        fix: `설정 → API 키 → 벤더 API 키에서 ${missing.join(", ")} 를 등록하고 재스폰`,
      },
    );
    return null;
  }

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
 *
 * `modelCatalogPath` 는 벤더 모델의 `ModelInfo` 를 선언한 JSON 경로다. 이걸 주지
 * 않으면 codex 는 모르는 slug 에 대해 폴백 메타데이터를 쓰고, 그 폴백에는
 * `apply_patch` 가 등록되지 않아 편집이 통째로 실패한다(codex-model-catalog.ts
 * 주석의 실측 근거 참조). ★최상위 키이므로 반드시 `[model_providers.*]` 테이블
 * **앞**에 놓는다 — 뒤에 두면 그 테이블의 하위 키로 흡수돼 설정 로드가 깨진다.
 */
export function renderCodexVendorProviderToml(
  override: CodexVendorProviderOverride,
  baseUrl: string,
  modelCatalogPath?: string,
): string {
  const lines = [
    `model_provider = ${JSON.stringify(override.providerId)}`,
    'preferred_auth_method = "apikey"',
    'forced_login_method = "api"',
    ...(modelCatalogPath
      ? [`model_catalog_json = ${JSON.stringify(modelCatalogPath)}`]
      : []),
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
