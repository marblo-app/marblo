/**
 * 벤치용 **OpenAI 호환 env-swap 벤더 배선**(Upstage Solar).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * `agent.ts` 의 codex 분기는 `codex exec …` 를 그냥 스폰한다. 그 경로로는
 * Upstage Solar 를 **태울 수 없다**. 이유가 둘이고 둘 다 실측으로 확정된 것이다:
 *
 *   (a) codex 0.147+ 는 ChatGPT 계정이 로그인돼 있으면 `OPENAI_BASE_URL` 을
 *       **무시하고** ChatGPT 백엔드로 보낸다 → solar-pro4 는 HTTP 400.
 *       공식 우회로는 `model_provider` + `preferred_auth_method="apikey"` +
 *       `[model_providers.<id>]` 커스텀 프로바이더뿐이다.
 *   (b) Upstage 는 `/v1/chat/completions` 만 연다. 그런데 codex 0.148.0 은
 *       `wire_api="chat"` 을 **설정 로드 시점에 거부**한다(EXIT=1). 그래서
 *       유일한 경로가 `wire_api="responses"` + 로컬 Responses→Chat 브리지다.
 *
 * ── 무엇을 미러링하고 무엇을 재사용하나 (§4-G 경계) ─────────────────────
 * feasibility §4-G 는 벤치가 **제품 라우팅 로직**에 결합되는 것을 금지한다
 * (벤치 결과가 라우팅을 바꾸고 그 라우팅이 다시 벤치를 바꾸는 자기강화 루프
 * 방어). 그 규율을 이렇게 나눈다:
 *
 *   · **미러링**(여기 표) — 어느 모델이 어느 벤더인지, base_url 이 무엇인지.
 *     이건 `model-registry.ts` / `codex-vendor-provider.ts` 의 값과 같지만
 *     **일부러 복사**한다. 벤치의 사전등록 파일은 실행 전에 커밋된 증거여야
 *     하고, 제품 레지스트리가 나중에 바뀌어도 "그때 그 설정으로 쟀다" 가
 *     흔들리면 안 되기 때문이다(`manifest.ts` 머리말과 같은 논리).
 *   · **재사용**(import) — `codex-chat-bridge.ts` 와 `codex-model-catalog.ts`.
 *     둘 다 라우팅이 아니라 **변환기/렌더러**다. 900줄짜리 프로토콜 변환기나
 *     "설치된 codex 자신의 ModelInfo 를 레퍼런스로 복제" 하는 카탈로그 생성기를
 *     벤치용으로 다시 짜면 제품과 미세하게 다른 것을 재게 되고, 그건 "우리 스폰
 *     경로로 쟀다" 는 이 벤치의 유일한 주장을 무너뜨린다. 어느 쪽을 썼는지는
 *     `route` 문자열에 실려 리포트 셀에 그대로 찍힌다.
 *
 * ── ★공정성 메모(리포트에 그대로 실린다) ────────────────────────────────
 * Solar 런은 다른 codex 런에 **없는 홉**을 하나 더 탄다(로컬 브리지). 그 사실을
 * 숨기지 않으려고 `RunRecord.vendorRoute` 에 문자열로 박아 리포트가 셀별로
 * 출력한다. 반대로 스캐폴드 id 는 **올리지 않는다** — 올리면 라운드가 갈라져
 * 같은 표에서 비교가 불가능해지고, 이 티켓의 목적(동일 조건 비교) 자체가 사라진다.
 */
import fs from "fs";
import path from "path";
import { startCodexChatBridgeSync } from "../../codex-chat-bridge";
import {
  buildCodexModelCatalog,
  renderCodexModelCatalogJson,
} from "../../codex-model-catalog";

/** 벤치가 아는 OpenAI 호환 env-swap 벤더 스펙. ★손으로 고치면 라운드가 바뀐다. */
export interface BenchVendorSpec {
  /** codex `model_provider` / `[model_providers.<id>]` 키. */
  providerId: string;
  /** config.toml 의 사람이 읽는 이름. */
  name: string;
  /** 업스트림 OpenAI 호환 base_url. */
  upstreamBaseUrl: string;
  /** codex 가 Bearer 토큰을 읽는 env 이름. */
  envKey: string;
  /** 업스트림이 /v1/responses 를 안 열어 로컬 브리지가 필요한가. */
  needsChatBridge: boolean;
  /**
   * codex `model_catalog_json` 을 방출할 것인가.
   *
   * ★이건 **점수를 움직이는 축**이다. 방출하지 않으면 codex 가 폴백 메타데이터로
   * 떠서 `apply_patch` 를 아예 등록하지 않고, 모델이 그걸 부르면 라우터가
   * `unsupported call: apply_patch` 로 거절한다(= Solar 를 무산출 8/12 로 만든
   * 그 실패모드, solar 문서 §4-(a)). 그래서 켜고 끄는 것을 **셀별로 기록**한다.
   *
   * Solar 라운드(2026-08-20)는 이 배선이 존재하기 전이라 **꺼진 채** 측정됐다.
   * 그 뒤 #1061 이 제품 스폰 경로에 카탈로그를 넣었으므로, 지금 벤더를 재면서
   * 끄면 **제품이 더 이상 쓰지 않는 경로**를 재는 것이 된다. 그래서 DeepSeek 은
   * 켠다 — 대신 이 차이를 `route` 문자열과 리포트 셀에 그대로 싣는다.
   */
  emitModelCatalog: boolean;
  /**
   * 리포트에 그대로 찍히는 경로 라벨. 다른 codex 런과 무엇이 다른지 한 줄로
   * 말한다 — 이 문자열이 있어야 표를 본 사람이 "같은 조건인가" 를 판단할 수 있다.
   */
  route: string;
}

/**
 * 모델 id → 벤더 스펙. 값의 출처는 전부 공식 문서다(2026-08-15 확인):
 *   console.upstage.ai/api-keys — base_url=https://api.upstage.ai/v1,
 *   model=solar-pro4, reasoning_effort="medium"
 */
export const BENCH_VENDORS: Readonly<Record<string, BenchVendorSpec>> = {
  "solar-pro4": {
    providerId: "upstage",
    name: "Upstage Solar",
    upstreamBaseUrl: "https://api.upstage.ai/v1",
    envKey: "UPSTAGE_API_KEY",
    needsChatBridge: true,
    // ★2026-08-20 라운드를 그대로 보존한다. 여기를 켜면 그때 잰 숫자의 조건이
    //   사후적으로 바뀌어 버린다 — 켜고 재려면 **새로 측정**해야 한다.
    emitModelCatalog: false,
    route:
      "upstage/openai-compat via local responses→chat bridge (codex custom provider, apikey auth)",
  },
  // DeepSeek 은 `/v1/responses` 를 네이티브로 연다(2026-08-21 라이브 확인:
  // codex → 프록시 → api.deepseek.com 이 200 + Responses SSE 를 그대로 돌려줬고,
  // `type:"namespace"` MCP 도구까지 정상 처리했다). 그래서 브리지 홉이 **없다**.
  "deepseek-v4-flash": {
    providerId: "deepseek",
    name: "DeepSeek",
    upstreamBaseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY",
    needsChatBridge: false,
    emitModelCatalog: true,
    route:
      "deepseek/responses-native direct (codex custom provider, apikey auth, model_catalog_json → apply_patch=freeform)",
  },
  "deepseek-v4-pro": {
    providerId: "deepseek",
    name: "DeepSeek",
    upstreamBaseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY",
    needsChatBridge: false,
    emitModelCatalog: true,
    route:
      "deepseek/responses-native direct (codex custom provider, apikey auth, model_catalog_json → apply_patch=freeform)",
  },
};

/**
 * ★티켓 pW7c7b0p2FdAmhaLj1Xq: Upstage 가 Codex 용 `/v1/responses` 를 네이티브로
 * 연다고 공지했다(console.upstage.ai/docs/integrations/codex, 라이브 미검증).
 * 브리지 코드는 지우지 않고, 이 축으로 켜고 끈다 — 제품쪽
 * `codex-vendor-provider.ts` 의 `upstageNeedsChatBridge` 와 같은 env, 같은
 * 기본값(끔 = 기존 브리지 경로 유지)이지만, 이 파일의 "미러링" 규율(머리말
 * §무엇을 미러링하나) 때문에 함수를 import 하지 않고 나란히 둔다.
 */
function upstageNeedsChatBridgeOverride(): boolean {
  const v = process.env.MARBLO_UPSTAGE_NATIVE_RESPONSES;
  return v === "1" || v === "true";
}

export function benchVendorFor(model: string | null): BenchVendorSpec | null {
  if (!model) return null;
  const spec = BENCH_VENDORS[model] ?? null;
  if (!spec) return null;
  if (spec.providerId === "upstage" && upstageNeedsChatBridgeOverride()) {
    return {
      ...spec,
      needsChatBridge: false,
      route:
        "upstage/responses-native direct (codex custom provider, apikey auth) — LIVE UNVERIFIED, see console.upstage.ai/docs/integrations/codex",
    };
  }
  return spec;
}

/** 브리지 + 격리 CODEX_HOME 한 세트. 런 묶음 전체가 공유한다. */
export interface BenchVendorSession {
  /** `runAgent` 에 얹을 추가 env. */
  env: Record<string, string>;
  /** 리포트에 남길 경로 라벨. */
  route: string;
  stop: () => Promise<void>;
}

/**
 * codex 커스텀 프로바이더 TOML. 제품(`codex-vendor-provider.renderCodexVendorProviderToml`)
 * 과 **같은 키 집합**이다. 벤치는 여기에 사용자 config 를 섞지 않는다 —
 * 스캐폴드가 `no-mcp,no-board` 라고 적혀 있으니 실제로도 비어 있어야 한다.
 */
export function renderBenchVendorToml(
  spec: BenchVendorSpec,
  baseUrl: string,
  /**
   * `model_catalog_json` 이 가리킬 파일. ★**최상위 키**라서 반드시
   * `[model_providers.*]` 테이블보다 **앞**에 와야 한다 — 뒤에 쓰면 그 테이블의
   * 하위 키로 흡수돼 설정 로드가 깨진다(codex-model-catalog.ts 머리말 3번).
   */
  modelCatalogPath?: string,
): string {
  return (
    [
      `model_provider = ${JSON.stringify(spec.providerId)}`,
      'preferred_auth_method = "apikey"',
      'forced_login_method = "api"',
      ...(modelCatalogPath
        ? [`model_catalog_json = ${JSON.stringify(modelCatalogPath)}`]
        : []),
      "",
      `[model_providers.${spec.providerId}]`,
      `name = ${JSON.stringify(spec.name)}`,
      `base_url = ${JSON.stringify(baseUrl.replace(/\/$/, ""))}`,
      `env_key = ${JSON.stringify(spec.envKey)}`,
      'wire_api = "responses"',
      "requires_openai_auth = false",
    ].join("\n") + "\n"
  );
}

/**
 * 브리지를 띄우고 격리 CODEX_HOME 을 만든다.
 *
 * ★키가 없으면 **조용히 기본 경로로 떨어지지 않고 throw** 한다. 조용히 떨어지면
 * codex 가 ChatGPT 계정으로 붙어 **다른 모델을 재고서 solar 라고 라벨**하게 된다.
 * 그게 이 벤치에서 가장 비싼 사고라, 실패를 크게 낸다.
 */
export async function startBenchVendorSession(
  spec: BenchVendorSpec,
  workRoot: string,
  /**
   * 카탈로그를 만들 모델 id. `emitModelCatalog` 가 켜진 벤더에서만 쓰인다.
   * ★비어 있으면 카탈로그 없이 뜨고, 그건 apply_patch 가 빠진 **다른 조건**이다
   * — 조용히 그렇게 되지 않도록 아래에서 크게 실패시킨다.
   */
  modelId?: string | null,
): Promise<BenchVendorSession> {
  const apiKey = process.env[spec.envKey]?.trim();
  if (!apiKey) {
    throw new Error(
      `${spec.envKey} 가 이 프로세스 env 에 없다. ${spec.providerId} 벤더 모델은 ` +
        `키 없이 돌리면 codex 가 기본 계정으로 붙어 **다른 모델을 재고 라벨만 solar** 가 된다. ` +
        `scripts/bench/secret-launcher.ts 로 스폰하거나 env 로 직접 주입할 것.`,
    );
  }

  const codexHome = path.join(workRoot, `codex-home-${spec.providerId}`);
  fs.mkdirSync(codexHome, { recursive: true });

  let baseUrl = spec.upstreamBaseUrl;
  let stopBridge: (() => Promise<void>) | null = null;
  if (spec.needsChatBridge) {
    // ★반드시 **별 프로세스** 변형(`…Sync`)이어야 한다. 인프로세스 변형을 쓰면
    // 100% 교착한다 — 러너는 에이전트를 `spawnSync`(env.ts)로 띄우는데, 그게
    // 이 프로세스의 이벤트 루프를 통째로 막는다. 같은 프로세스에 있는 브리지
    // 서버는 그동안 accept 조차 못 하므로, codex 는 TCP 만 연결된 채 응답을
    // 영원히 기다리다 타임아웃한다.
    //
    // 실측(2026-08-20, 이 배선의 첫 스모크): 인프로세스 브리지로 돌렸더니
    // codex 가 600초 내내 CPU 0.25초만 쓰고 무산출로 타임아웃했고, 브리지에서
    // Upstage 로 나간 연결은 **한 건도 없었다**. 같은 프롬프트를 이벤트 루프가
    // 살아 있는 프로세스에서 돌리면 1.3초에 응답이 온다.
    const bridge = startCodexChatBridgeSync({
      upstreamBaseUrl: spec.upstreamBaseUrl,
      apiKey,
    });
    baseUrl = bridge.baseUrl;
    stopBridge = bridge.stop;
  }

  // ★카탈로그. 켜져 있는데 못 만들면 **조용히 넘어가지 않는다** — 카탈로그 없이
  //   뜨면 codex 가 폴백 메타데이터로 떨어져 apply_patch 를 등록하지 않고, 그
  //   상태의 점수는 우리가 재려던 조건의 점수가 아니다(Solar §4-(a) 그대로).
  let catalogPath: string | undefined;
  if (spec.emitModelCatalog) {
    const catalog = buildCodexModelCatalog(modelId ?? undefined);
    if (!catalog) {
      throw new Error(
        `${spec.providerId}: model_catalog_json 을 만들지 못했다(model=${
          modelId ?? "(none)"
        }). ` +
          `카탈로그 없이 뜨면 codex 가 폴백 메타데이터로 떨어져 apply_patch 가 등록되지 않고, ` +
          `그건 이 셀이 재려던 조건이 아니다. 조용히 진행하지 않는다.`,
      );
    }
    catalogPath = path.join(codexHome, "model-catalog.json");
    fs.writeFileSync(
      catalogPath,
      renderCodexModelCatalogJson(catalog),
      "utf-8",
    );
  }

  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    renderBenchVendorToml(spec, baseUrl, catalogPath),
    "utf-8",
  );
  // ChatGPT auth.json 이 이 홈에 없어야 apikey 경로가 이긴다(제품과 같은 규율).
  const strayAuth = path.join(codexHome, "auth.json");
  if (fs.existsSync(strayAuth)) fs.unlinkSync(strayAuth);

  return {
    env: { CODEX_HOME: codexHome, [spec.envKey]: apiKey },
    route: spec.route,
    stop: async () => {
      if (stopBridge) await stopBridge();
    },
  };
}
