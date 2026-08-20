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
 *   · **재사용**(import) — `codex-chat-bridge.ts` 하나. 이건 라우팅이 아니라
 *     **프로토콜 변환기**다. 900줄짜리 변환기를 벤치용으로 다시 짜면 제품과
 *     미세하게 다른 변환을 재게 되고, 그건 "우리 스폰 경로로 쟀다" 는 이
 *     벤치의 유일한 주장을 무너뜨린다.
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
    route:
      "upstage/openai-compat via local responses→chat bridge (codex custom provider, apikey auth)",
  },
};

export function benchVendorFor(model: string | null): BenchVendorSpec | null {
  if (!model) return null;
  return BENCH_VENDORS[model] ?? null;
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
): string {
  return (
    [
      `model_provider = ${JSON.stringify(spec.providerId)}`,
      'preferred_auth_method = "apikey"',
      'forced_login_method = "api"',
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

  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    renderBenchVendorToml(spec, baseUrl),
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
