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
 * ★Upstage 도 이제 네이티브다(티켓 hj7tpt0FFdyc1oGhSGgz, 2026-09-07 라이브 확인).
 * 예전 주석은 "Upstage 는 /v1/chat/completions 만 연다"고 적었고 그게 로컬
 * Responses→Chat 브리지(codex-chat-bridge.ts)를 강제하는 근거였다 — **그 문장이
 * 낡았다.** Upstage 공식 launcher(console.upstage.ai/codex-solar.sh, 직접 받아
 * 확인)가 `wire_api="responses"` + `base_url="https://api.upstage.ai/v1"` 를
 * **브리지 없이** 그대로 쓰고, 이 레포도 같은 설정으로 실제 스폰(`codex exec`,
 * 진짜 UPSTAGE_API_KEY, model=solar-pro4)을 1건 완주시켰다(200 OK, "pong").
 * codex-cli 0.148.0 이 `wire_api="chat"` 을 설정 로드 시점에 거부하는 것(아래
 * 인용)은 여전히 사실이지만, 그건 애초에 chat 경로가 막혔다는 뜻이지 responses
 * 경로가 브리지를 요구한다는 뜻이 아니었다 —
 *
 *   Error loading config.toml: wire_api = "chat" is no longer supported.
 *   How to fix: set wire_api = "responses"      (EXIT=1, agent dies instantly)
 *   github.com/openai/codex/discussions/7782
 *
 * 브리지(codex-chat-bridge.ts) 코드는 **지우지 않는다** — 되돌릴 일이 생기면
 * `MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE=1` 하나로 되돌린다(아래 upstageNeedsChatBridge).
 * DeepSeek 은 원래부터 네이티브였으니 이 티켓으로 바뀐 게 없다.
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
    // ★2026-09-07 라이브 확인(hj7tpt0FFdyc1oGhSGgz): Upstage 는 /v1/responses 를
    // 네이티브로 연다 — 브리지 없이 base_url 을 그대로 가리켜도 실제 스폰이
    // 완주한다(아래 upstageNeedsChatBridge 주석의 근거). 기본값을 브리지 필요
    // 없음으로 바꾼다.
    wireApi: "responses",
    needsChatBridge: false,
  },
  deepseek: {
    name: "DeepSeek",
    upstreamBaseUrl: "https://api.deepseek.com",
    wireApi: "responses",
    needsChatBridge: false,
  },
};

/**
 * ★티켓 pW7c7b0p2FdAmhaLj1Xq 가 이 토글을 만들었을 때는 업스테이지의 네이티브
 * `/v1/responses` 공지(console.upstage.ai/docs/integrations/codex)가 라이브로
 * 확인되기 전이라 기본값을 바꾸지 않았다 — 2026-08-20 라운드 실측(3/12,
 * `swebench-solar-pro4-2026-08-20.md`)이 그 브리지 경로로 나온 유일한 검증된
 * 수치였기 때문이다.
 *
 * ★티켓 hj7tpt0FFdyc1oGhSGgz(2026-09-07)가 그 라이브 확인을 했다: Upstage 공식
 * launcher(codex-solar.sh, 직접 받아 확인)가 브리지 없이 `wire_api="responses"`
 * + `base_url="https://api.upstage.ai/v1"` 를 그대로 쓰고, 같은 설정으로 이
 * 레포도 실제 스폰(codex exec, 진짜 키, model=solar-pro4)을 1건 완주시켰다
 * (200 OK). 그래서 기본값을 **네이티브(브리지 불필요)로 뒤집었다.**
 *
 * 이 플래그는 브리지를 **지우지 않고** 켜고 끄는 축이다 — 그 설계는 그대로다.
 * 방향만 바뀌었다: 예전엔 "브리지가 기본, `MARBLO_UPSTAGE_NATIVE_RESPONSES=1`
 * 로 네이티브를 켬"이었고, 지금은 "네이티브가 기본, 문제가 생기면
 * `MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE=1` 로 브리지로 되돌림"이다.
 * `MARBLO_UPSTAGE_NATIVE_RESPONSES=1` 도 계속 동작한다(이미 기본과 같은 값을
 * 명시할 뿐이라 무해하다) — 코드 삭제 없이 두 방향 다 되돌릴 수 있다.
 */
export function upstageNeedsChatBridge(): boolean {
  const forceBridge = process.env.MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE;
  if (forceBridge === "1" || forceBridge === "true") return true;
  const forceNative = process.env.MARBLO_UPSTAGE_NATIVE_RESPONSES;
  if (forceNative === "1" || forceNative === "true") return false;
  return PROVIDER_META.upstage.needsChatBridge;
}

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
  if (entry.provider !== "upstage" && entry.provider !== "deepseek")
    return null;
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
        fix: `설정 → API 키 → 벤더 API 키에서 ${missing.join(
          ", ",
        )} 를 등록하고 재스폰`,
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
    needsChatBridge:
      entry.provider === "upstage"
        ? upstageNeedsChatBridge()
        : meta.needsChatBridge,
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
