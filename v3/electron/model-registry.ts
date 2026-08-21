/**
 * 벤더중립 모델 레지스트리 — 모델 "사실"의 단일 소스.
 *
 * 이 파일이 존재하는 이유(v3/docs/INTELLIGENT-ROUTING-PLAN.md §2): 모델 지식이
 * `agent-config.ts`(alias·티어정책)·`cost-tracker.ts`(단가)·`dispatch-scoring.ts`
 * (태그보너스)·`tools.ts`(파라미터 설명문) 네 곳에 흩어져 있어서 모델 하나
 * 추가에 네 곳 수술이 필요했다. 여기 한 행을 넣으면 끝나게 만드는 것이 목표다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **사실만 담는다. 정책은 담지 않는다.** "이 모델은 무엇인가"(id·alias·능력등급·
 *    effort 축·단가·검증이력)만 여기 있고, "어떤 난도에 무엇을 쓸까"는
 *    `agent-config.ts` 의 티어 정책이 담당한다.
 * 2. **CLI-verified 만 등록한다.** 카탈로그 기억이나 추론으로 쓴 모델 id 는 이
 *    파일에 하나도 없다. 각 행의 `verified` 가 언제·무엇으로 확인했는지 남긴다.
 *    재확인은 `npm run verify:models`(electron/scripts/verify-models.ts).
 * 3. **단가에 추정치가 섞이면 `pricing.estimated: true` 로 표시한다.** 비용대비효과
 *    학습이 추정치를 사실로 착각하면 라우팅이 잘못 수렴한다.
 *
 * ── ★alias vs 구체 id (조용한 승격 방지) ────────────────────────────────
 * `opus`·`sonnet` 같은 alias 는 **CLI 가 해석하는 이동표적**이다. 실제로 2026-07
 * claude CLI 업데이트만으로 `opus` 의 의미가 opus-4.x → `claude-opus-5` 로 바뀌었고,
 * 우리 코드가 `"opus"` 리터럴을 쓰던 자리가 전부 조용히 세대 상승했다(§1.3-①).
 * 그래서 이 코드베이스의 규칙은:
 *
 *   - **주 선택값(핀)은 구체 id** — `claude-opus-5` 처럼. 바뀌면 커밋이 남는다.
 *   - **폴백만 alias** — 버전 불확실 구간에서 "CLI 가 아는 최선"으로 안전하게
 *     떨어지는 것이 목적이므로 이동표적인 편이 오히려 옳다.
 *
 * 이 구분은 `tests/unit/model-registry.test.ts` 와
 * `tests/unit/model-tier-complexity.test.ts` 의 회귀 가드가 강제한다.
 */

/**
 * ── ★provider ≠ harness (축 분리, USbdRV4k / 서베이 §4.5.1) ──────────────
 *
 * 종전엔 축이 하나였다 — `ModelProvider` 가 `ModelType`(스폰할 바이너리)과 같은
 * 집합이었고, 그래서 "벤더" 와 "실행 CLI" 가 한 값에 겹쳐 있었다. 그 상태에서는
 * Z.ai GLM 처럼 **우리 `claude` 바이너리를 그대로 쓰면서 env 만 바꾸는 벤더**를
 * 표현할 수 없다(유니온에 `"zai"` 를 넣는 순간 `buildLaunchConfig` 의 switch 가
 * `case "zai"` 를 요구하고, 서베이 §3.2 가 실측한 18파일 확산이 되살아난다).
 *
 * 그래서 축을 둘로 쪼갠다:
 *
 *   harness  — **어떤 바이너리를 스폰하는가** (claude / codex(=gpt) / agy …)
 *   provider — **어느 벤더 백엔드로 붙는가** (anthropic / openai / zai / minimax …)
 *
 * 기존 행은 전부 `harness === 옛 provider` 라 매핑이 항등이고 스폰 회귀가 0 이다
 * (`tests/unit/provider-harness-axis.test.ts` 가 강제한다).
 */

/**
 * 하네스 축 — 스폰할 CLI 바이너리. `agent-manager.ts` / `dispatch-scoring.ts` 의
 * `ModelType` 과 같은 집합이며, `agent-config.ts` 가 컴파일타임 양방향 호환
 * 단언으로 고정한다. 값이 `gpt`(=codex 바이너리)·`antigravity`(=agy)인 것은
 * 기존 `ModelType` 리터럴을 그대로 승계했기 때문이다 — 이 동일성이 깨지면
 * Firestore 에 쌓인 에이전트 문서·그래프 셀키·텔레메트리가 전부 갈라진다.
 *
 * ★신규 **하네스**(자기 CLI 를 갖는 벤더: Grok Build, Kimi Code) 추가는 이 유니온에
 * 한 줄 + `ModelType` 에 한 줄 + 스폰 switch 에 case 1개다(서베이 Phase V2).
 * 신규 **벤더**(자기 CLI 가 없는 env-swap 형: GLM, MiniMax)는 이 유니온을 건드리지
 * 않는다 — `VendorId` 에 한 줄 + 레지스트리 행 하나로 끝난다.
 */
import {
  isToolCapableToolSupport,
  resolveLocalToolSupport,
  type LocalToolSupport,
} from "./local-tool-tier";

export type HarnessId =
  | "claude"
  | "gemini"
  | "gpt"
  | "grok"
  | "antigravity"
  | "local"
  | "custom";

/**
 * 벤더 축 — 토큰·쿼터·장애특성·단가의 주인. **하네스와 독립**이다.
 *
 * 같은 `claude` 하네스라도 `anthropic` 과 `zai` 는 완전히 다른 백엔드다(다른
 * 구독·다른 쿼터창·다른 모델 id). 라우팅이 두 벤더의 성과를 한 셀에 섞지 않으려면
 * 이 축이 1급이어야 한다(서베이 §5.2).
 *
 * ★`local`/`custom` 은 "벤더 미상" 을 뜻하는 자리표시자다 — 사용자가 붙인 임의
 * 엔드포인트라 우리가 벤더를 알 수 없다.
 */
export type VendorId =
  | "anthropic"
  | "openai"
  | "google"
  | "zai"
  | "minimax"
  | "xai"
  | "moonshot"
  | "upstage"
  | "deepseek"
  | "local"
  | "custom";

/** 하네스 전체 목록(런타임 검증·테스트용). `HarnessId` 와 같아야 한다. */
export const HARNESS_IDS: readonly HarnessId[] = [
  "claude",
  "gemini",
  "gpt",
  "grok",
  "antigravity",
  "local",
  "custom",
] as const;

const HARNESS_ID_SET: ReadonlySet<string> = new Set<string>(HARNESS_IDS);

/**
 * 주어진 문자열이 **구체 모델 id 가 아니라 하네스 이름**인가.
 *
 * 이 구분이 관측 싱크의 불변식이다: 하네스 문자열이 모델 자리에 새어 들어가면
 * `cost_logs.model='claude'` / `task_outcomes.model='claude'` / KG 프로바이더
 * 해상도 셀처럼 "모델미상" 이 모델인 척 적재된다. 게다가 단가표·레지스트리 어디에도
 * `claude` 라는 id 는 없으므로 그 구간은 $0 로 청구된다(고스트 비용).
 * 씨앗/폴백을 고르는 자리는 전부 이 술어로 걸러라.
 */
export function isHarnessFamilyId(value: string | null | undefined): boolean {
  return HARNESS_ID_SET.has((value ?? "").trim().toLowerCase());
}

/** 벤더 전체 목록(런타임 검증·테스트용). `VendorId` 와 같아야 한다. */
export const VENDOR_IDS: readonly VendorId[] = [
  "anthropic",
  "openai",
  "google",
  "zai",
  "minimax",
  "xai",
  "moonshot",
  "upstage",
  "deepseek",
  "local",
  "custom",
] as const;

/**
 * reasoning effort 축. Codex 는 모델 × effort 곱집합이고 Claude 는 effort 축이
 * 아예 없다 — 이 비대칭을 레지스트리가 명시적으로 표현해야 라우팅이 두
 * 프로바이더를 같은 언어로 다룰 수 있다(§2 넷-뉴 3).
 *
 * `xhigh`/`max`/`ultra` 는 우리가 알던 low/medium/high 위의 실재하는 칸이다
 * (§1.2, `~/.codex/models_cache.json`). 5.6 계열만 max/ultra 를 지원한다.
 */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

/** 사다리 순서(낮음 → 높음). 에스컬레이션 정책(P3-1)이 이 순서를 쓴다. */
export const EFFORT_LADDER: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

/**
 * 능력등급. `simple|standard|complex`(작업 난도)와 **직교**한다 — 이건 모델의
 * 성질이고 저건 작업의 성질이다. 티어→모델 매핑은 정책(agent-config)이 한다.
 */
export type CapabilityTier = "cheap" | "mid" | "top" | "frontier";

/** $/1M 토큰. Standard tier · short context 기준(Batch/캐시 할인 미반영). */
export interface ModelRate {
  inputPer1M: number;
  outputPer1M: number;
  /**
   * true = 공식 단가를 확인하지 못한 **보수적 추정치**. 비용을 과소보고하지
   * 않는 방향(=높게)으로 잡는다. 확정되면 이 플래그를 지운다.
   */
  estimated?: boolean;
}

/** 이 행의 사실을 언제·무엇으로 확인했는지. 추론으로 채우지 않는다. */
export interface ModelVerification {
  /** ISO date (YYYY-MM-DD). */
  at: string;
  /** 프로브를 돌린 CLI 버전. */
  cli: string;
  /** 확인 방법(재현 가능하게). */
  method: string;
}

/**
 * 벤더 프로파일 — 이 모델을 그 벤더 백엔드로 붙이기 위해 스폰 env 에 얹는 값들.
 *
 * (B)형 벤더(자기 CLI 가 없는 env-swap 형)를 **코드 없이 데이터로** 흡수하는
 * 자리다. 예: GLM 은 `claude` 하네스에 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`
 * 만 갈아끼우면 돈다(서베이 §2.4).
 *
 * ★시크릿을 여기 박지 않는다. 토큰류는 값이 아니라 **읽어올 env 키 이름**을
 * `${ZAI_API_KEY}` 형태의 자리표시자로 적는다(MTtCVCP4 에서 확정). 해석은
 * `agent-config.applyVendorEnv` 가 스폰 시점에 `process.env`(= `v3/.env` dotenv
 * 단일소스)에서 하고, 키가 없으면 **프로파일 전체를 얹지 않는다** — 자세한 사유는
 * 그 함수 주석 참조("반쪽 프로파일" 이 우리 Anthropic 크레덴셜을 남의 엔드포인트로
 * 보내는 사고를 막는다).
 *
 * 자리표시자는 **값 전체**여야 한다(`"Bearer ${K}"` 같은 부분보간 금지). 부분보간을
 * 허용하면 시크릿이 다른 문자열에 섞여 들어가 마스킹·감사가 어려워진다 — 아래
 * 부팅 가드가 강제한다.
 */
export type VendorEnvProfile = Readonly<Record<string, string>>;

/** `${ENV_VAR}` 자리표시자(값 전체일 때만 유효). */
const VENDOR_ENV_SECRET_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** 이 프로파일 값이 시크릿 참조면 그 env 키 이름, 아니면 undefined. */
export function vendorEnvSecretRef(value: string): string | undefined {
  return VENDOR_ENV_SECRET_REF.exec(value)?.[1];
}

export interface ModelRegistryEntry {
  /** CLI/API 에 그대로 넘기는 구체 모델 id. */
  id: string;
  /**
   * ★스폰할 **바이너리**. 벤더가 아니다 — `{ harness: "claude", provider: "zai" }`
   * 는 "우리 claude CLI 로 띄우되 Z.ai 백엔드에 붙는다" 는 뜻이다.
   */
  harness: HarnessId;
  /** ★**벤더**(백엔드 주인). 하네스와 독립이다. */
  provider: VendorId;
  /**
   * 이 모델을 벤더 백엔드로 붙이기 위한 스폰 env. 벤더-네이티브 행(anthropic/
   * openai — CLI 가 자기 로그인으로 이미 붙는다)에는 없다.
   */
  envProfile?: VendorEnvProfile;
  /**
   * 이 모델로 해석되는 CLI alias 들. ★alias 는 이동표적이므로 핀에 쓰지 말 것
   * (파일 상단 규율 참조). 여기 등록하는 이유는 (a) 사용자가 env 에 alias 를
   * 넣었을 때 구체 id 로 정규화하고, (b) verify 런북이 "alias 의 의미가 바뀌었나"
   * 를 대조할 fixture 를 갖기 위해서다.
   */
  aliases: string[];
  capability: CapabilityTier;
  /** 지원 effort. 빈 배열 = 이 프로바이더엔 effort 축이 없다(claude). */
  efforts: EffortLevel[];
  /** CLI 가 적용하는 기본 effort(있을 때만). */
  defaultEffort?: EffortLevel;
  pricing: ModelRate;
  /**
   * ★이 id 를 **실제로 검증한 최저 CLI 버전**. 의미는 "이 아래면 지원 안 함"이
   * 아니라 **"이 아래는 미검증"** 이다. 미검증 구간에선 구체 id 를 강행하지 않고
   * alias 로 안전 폴백한다(폴백 대상은 정책이 정한다). 그래서 이 값을 보수적으로
   * 높게 잡아도 손해가 없다 — 폴백 결과가 곧 종전 동작이기 때문이다.
   */
  minCli?: string;
  verified: ModelVerification;
  /** deprecated 는 조회는 되지만 신규 라우팅 후보에서 빠진다. */
  status: "active" | "deprecated";
  /**
   * 로컬(Ollama) 행 전용. claude 하네스+MCP tool 주입을 견딜지.
   * `chat-only` 면 스폰 시 대화모드(툴/MCP 비주입). 클라우드 행에는 없다.
   */
  toolSupport?: LocalToolSupport;
}

// ─────────────────────────────────────────────────────────────────────────
// 레지스트리 데이터
//
// 출처는 전부 v3/docs/INTELLIGENT-ROUTING-PLAN.md §1 의 실제 CLI 프로브다.
// 단가는 티켓 150oZRiDRDNzC2N9JBli / PR#596 이 공식 문서 크롤로 확정한 값
// (platform.openai.com/docs/pricing, Anthropic 공식). ★effort 는 단가를 바꾸지
// 않는다 — 토큰 수량만 바꾼다. effort 별 가격 행은 존재하지 않는다.
// ─────────────────────────────────────────────────────────────────────────

/** §1.1 claude CLI 2.1.220 에서 `--output-format json` 의 modelUsage 키 대조. */
const CLAUDE_PROBE: ModelVerification = {
  at: "2026-07-25",
  cli: "2.1.220",
  method:
    "claude -p --model <id> --output-format json → modelUsage 키가 실제 서빙 모델 " +
    "(무효 id 는 is_error=true + modelUsage 공백으로 구분됨)",
};

/** §1.2 codex-cli 0.145.0 의 서버 권위 목록 캐시. */
const CODEX_PROBE: ModelVerification = {
  at: "2026-07-25",
  cli: "0.145.0",
  method:
    "~/.codex/models_cache.json (fetched_at 2026-07-25T09:59:42Z, client_version 0.145.0) 원문",
};

/**
 * Z.ai GLM — **CLI 프로브가 아니라 벤더 공식문서 크롤**이다. 구독키(Coding Plan)가
 * 없으면 `claude -p --model glm-4.7` 프로브 자체가 불가능하므로, 이 행들의 `verified`
 * 는 "문서에서 이 id·이 엔드포인트를 읽었다" 까지만 주장한다. 라이브 대조는 키를
 * 받은 뒤 `npm run verify:models`(벤더 프로파일 섹션)가 자동으로 돌린다.
 */
const ZAI_DOCS_PROBE: ModelVerification = {
  at: "2026-07-26",
  cli: "n/a (구독키 미보유 — 라이브 프로브 대기)",
  method:
    "gstack /browse 크롤: docs.z.ai/devpack/tool/claude · /devpack/latest-model · " +
    "/guides/overview/pricing (1차 출처). 모델 id·엔드포인트·단가 전부 원문 대조",
};

/**
 * MiniMax — GLM 과 같은 이유로 **문서 크롤**이다(Token Plan 구독키 미보유).
 * 라이브 대조는 키 확보 후 `npm run verify:models` 의 [vendor] 섹션이 돌린다.
 */
const MINIMAX_DOCS_PROBE: ModelVerification = {
  at: "2026-07-26",
  cli: "n/a (Token Plan 구독키 미보유 — 라이브 프로브 대기)",
  method:
    "gstack /browse 크롤: platform.minimax.io/docs/token-plan/claude-code.md · " +
    "/token-plan/other-tools.md · /guides/models-intro.md · /guides/pricing-paygo.md " +
    "(1차 출처). 엔드포인트·모델 id·단가 전부 원문 대조",
};

/**
 * Kimi Code — 문서 크롤 + **라이브 엔드포인트 프로브**다(구독키 미보유).
 *
 * GLM/MiniMax 행보다 한 단계 더 주장할 수 있다: 구독키 없이도 엔드포인트가
 * Anthropic 에러 봉투로 401 을 돌려주는 것까지 실측했으므로, "이 URL 이 실재하고
 * Anthropic 프로토콜을 말한다" 는 **추론이 아니라 관측**이다. 다만 모델 id 가
 * 실제로 서빙되는지는 구독키가 있어야 확인된다 — 그 대조는 키 확보 후
 * `npm run verify:models` 의 [vendor] 섹션이 돌린다.
 */
const KIMI_CODE_PROBE: ModelVerification = {
  at: "2026-07-27",
  cli: "2.1.220 (claude) — Kimi Code 구독키 미보유, 모델 id 라이브 대조 대기",
  method:
    "gstack /browse 크롤: www.kimi.com/code/docs/en/ (Service Endpoint 표) · " +
    "/third-party-tools/claude-code.html (Claude Code 배선) · /kimi-code/models.html " +
    "(모델 id 4종) · platform.kimi.ai/docs/pricing/chat-k3|chat-k27-code (단가). " +
    "+ 라이브: POST https://api.kimi.com/coding/v1/messages → 401 Anthropic 에러 봉투 " +
    "(무인증 vs 더미 크레덴셜이 다른 메시지 = 크레덴셜 파싱 확인, x-api-key/Bearer 동치), " +
    "claude 2.1.220 격리홈 실스폰 → duration_api_ms=0 + modelUsage={} 인증거부",
};

/**
 * Upstage Solar Pro — OpenAI 호환 env-swap 벤더다.
 *
 * 티켓은 예시 모델명을 `solar-pro` 로 줬지만, 2026-08-15 현재 Upstage 공식 Console
 * 문서와 Solar Pro 4 발표문은 모델 id 를 `solar-pro4` 로 안내한다. `solar-pro` 는
 * alias 로만 받되, API 로 나가는 값과 cost_logs 모델 키는 최신 공식 id 로 고정한다.
 */
const UPSTAGE_SOLAR_PROBE: ModelVerification = {
  at: "2026-08-15",
  cli: "n/a (Upstage API 키 미보유 — 라이브 프로브 대기)",
  method:
    "Upstage 공식 Console/API keys 예제와 Solar Pro 4 발표문 확인: " +
    "OpenAI-compatible base_url=https://api.upstage.ai/v1, model=solar-pro4, " +
    "공식 단가 Input $0.30 / Cached Input $0.06 / Output $1.20 per 1M tokens",
};

/**
 * DeepSeek V4 — OpenAI 호환 env-swap 벤더다.
 *
 * 공식 pricing 문서는 V4 계열만 노출한다. Codex(gpt) 하네스를 그대로 띄우고
 * OPENAI_* env 만 DeepSeek 으로 스왑한다.
 *
 * ★2026-08-21 재확인(티켓 giW7eJbD). 08-18 항목은 pricing 페이지만 봤고, 이번엔
 * DeepSeek 이 **Codex 용으로 직접 배포하는 공식 `models.json`** 까지 대조했다
 * (quick_start/agent_integrations/codex). 거기서 effort 축이 틀렸다는 게 드러났다 —
 * 아래 `efforts` 주석 참조. 모델 id·단가는 08-18 그대로다.
 *
 * ★2026-08-21 **라이브 프로브 완료**(티켓 Wx8jLTVl5inuMwv03yb5, 잔액 충전 후).
 * 이 레코드의 규율은 문서 확인과 라이브 검증을 **같은 칸에 섞지 않는 것**이다.
 * 그래서 `method`(문서 대조)는 그대로 두고 `cli`(라이브 실측)만 채운다.
 *
 * ★라이브가 문서를 **반증한 것이 하나 있다**: 공식 Responses 호환표는 tools 로
 * function/web_search/custom(apply_patch) 셋만 열거하는데, 실제로는
 * `type:"namespace"`(codex 가 MCP 도구를 싣는 모양)도 받아서 처리하고 응답에
 * `namespace` 필드까지 되돌려준다. 열거가 완전하지 않았다 —
 * `codex-model-catalog.ts` 상단의 정정 기록을 같이 볼 것.
 *
 * ★반대로 라이브로도 **확정하지 못한 것**을 확정한 것처럼 적지 않는다: effort 는
 * 네 값(low/medium/high/max) 모두 200 으로 수용되지만, effort 별로 행동이 달라진다는
 * 증거는 얻지 못했다. 아래 `cli` 문자열이 그 경계를 그대로 적는다.
 */
const DEEPSEEK_PROBE: ModelVerification = {
  at: "2026-08-21",
  cli:
    "codex-cli 0.149.0 라이브 실측(2026-08-21, 실계정). codex → 로컬 기록형 프록시 → " +
    "https://api.deepseek.com 로 **요청·응답 바디를 양쪽 다** 캡처했다 " +
    "(scripts/probe-codex-vendor-tools.mjs --live). model=deepseek-v4-flash. " +
    '① 도구 표면: MCP 도구가 type:"namespace" 로 실려 나가는데 DeepSeek 이 이를 ' +
    "**정상 처리**했다 — 응답 SSE 가 function_call{name:add_activity, namespace:mcp__marblo} " +
    "를 돌려줬고 그 호출이 MCP 서버까지 도달해 결과가 모델로 되돌아갔다(공식 호환표 반증). " +
    "② apply_patch: 시드 파일을 실제로 편집했고(bravo → PATCHED_BY_PROBE, 다른 줄 무변경) " +
    "`unsupported call: apply_patch` 거절 0건 — model_catalog_json 경로 확증. " +
    '③ effort: 핀 없으면 요청에 reasoning={effort:"high"} 가 실린다(default=high 확인). ' +
    "low/medium/high/max 네 값 **모두 HTTP 200** — codex 는 카탈로그 선언값을 게이트하지 " +
    "않고 medium 도 그대로 보내며 벤더도 400 을 내지 않는다. ★단 effort 별 행동 차이는 " +
    "**관측되지 않았다**(같은 프롬프트에서 reasoning_tokens 가 low 136 / medium 124 / max 124 로 " +
    "단조성 없음, 프롬프트 2종 각 n=1) — '수용된다' 까지만 확정이고 '먹는다' 는 미확정이다. " +
    "④ SWE 벤치: docs/benchmark/swebench-deepseek-v4-flash-2026-08-21.md",
  method:
    "DeepSeek 공식 API Docs 3개 대조(2026-08-21 재확인, 최초 2026-08-18): " +
    "① quick_start/pricing — model=deepseek-v4-flash(DeepSeek-V4-Flash-0731) / " +
    "deepseek-v4-pro(DeepSeek-V4-Pro-0813) 그대로 최신, context 1M / max output 384K, " +
    "peak pricing flash $0.44/$1.32, pro $1.32/$3.96 per 1M tokens(변동 없음), " +
    "cache-hit input peak flash $0.014 / pro $0.044, off-peak 는 정확히 절반이고 " +
    "peak 구간은 01:00-04:00 · 06:00-10:00 UTC 두 덩어리(하루 7시간)뿐이다. " +
    "② guides/responses_api — base_url=https://api.deepseek.com 로 Responses API 네이티브 지원, " +
    "tools 는 function/web_search 지원 · custom 은 apply_patch 만 허용(다른 이름은 400) · " +
    "mcp 등 나머지 built-in 타입은 무시, 미지원 파라미터는 400 이 아니라 조용히 무시. " +
    "③ quick_start/agent_integrations/codex — DeepSeek 이 배포하는 공식 codex models.json 및 " +
    "config.toml 예시(model_provider/preferred_auth_method/forced_login_method/" +
    'wire_api="responses"/model_catalog_json)가 우리 생성 config 와 형태 일치',
};

/**
 * Grok Build — **라이브 CLI 실측**.
 *
 * 2026-08-20 에 로그인된 `grok` 1.0.5 에서 `grok models` 를 직접 돌려 받은 목록이
 * 이 두 행의 근거다(종전엔 공식 문서/README 대조뿐이었다):
 *
 *   $ grok models
 *   Default model: grok-4.6
 *   Available models:
 *     * grok-4.6 (default)
 *     - grok-4.5
 *
 * 즉 **서빙 목록 자체**를 CLI 가 불러 준다 — claude 처럼 무효 id 를 때려 보고
 * 구분할 필요가 없다. 단가·컨텍스트는 같은 날 docs.x.ai/developers/models 카드로
 * 대조했다(두 모델 모두 500k / $2.00 / $6.00 — 세대가 올라도 단가축이 안 움직였다).
 */
const GROK_BUILD_PROBE: ModelVerification = {
  at: "2026-08-20",
  cli: "1.0.5",
  method:
    "`grok models` (로그인 상태) → 서빙 목록 실측: grok-4.6(default) / grok-4.5. " +
    "단가·컨텍스트는 docs.x.ai/developers/models 카드 대조(500k, $2.00/$6.00)",
};

/** 5.6 계열 effort 축(max/ultra 까지). */
const EFFORTS_56_FULL: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
/** luna 는 ultra 가 없다(§1.2 표). */
const EFFORTS_56_NO_ULTRA: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
/** 5.5 이하 계열. */
const EFFORTS_CLASSIC: EffortLevel[] = ["low", "medium", "high", "xhigh"];

export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  // ── Claude (§1.1) ─────────────────────────────────────────────────────
  {
    id: "claude-fable-5",
    harness: "claude",
    provider: "anthropic",
    aliases: ["fable"],
    capability: "frontier",
    efforts: [], // claude 는 effort 축 없음
    pricing: { inputPer1M: 10, outputPer1M: 50 },
    // 기존 §3 버전가드의 임계값을 그대로 계승(MARBLO_FABLE5_MIN_CLI 기본값).
    minCli: "2.1.170",
    verified: CLAUDE_PROBE,
    status: "active",
  },
  {
    id: "claude-opus-5",
    harness: "claude",
    provider: "anthropic",
    // ★alias `opus` 는 2026-07-25 기준 이 모델로 해석된다(§1.1). 그 사실이
    // 바로 §1.3-① "조용한 승격" 의 원인이므로, 핀에는 alias 가 아니라 이 id 를 쓴다.
    aliases: ["opus"],
    capability: "top",
    efforts: [],
    pricing: { inputPer1M: 5, outputPer1M: 25 },
    minCli: "2.1.220",
    verified: CLAUDE_PROBE,
    status: "active",
  },
  {
    id: "claude-opus-4-8",
    harness: "claude",
    provider: "anthropic",
    aliases: [],
    capability: "top",
    efforts: [],
    // Opus 4.8 = Opus 5 와 동일 단가(PR#596 확정).
    pricing: { inputPer1M: 5, outputPer1M: 25 },
    minCli: "2.1.220",
    verified: CLAUDE_PROBE,
    status: "active",
  },
  {
    id: "claude-sonnet-5",
    harness: "claude",
    provider: "anthropic",
    aliases: ["sonnet"],
    capability: "mid",
    efforts: [],
    pricing: { inputPer1M: 3, outputPer1M: 15 },
    minCli: "2.1.220",
    verified: CLAUDE_PROBE,
    status: "active",
  },
  {
    id: "claude-haiku-4-5-20251001",
    harness: "claude",
    provider: "anthropic",
    // alias `haiku` 는 날짜형 id 로 해석된다(§1.1) — 우리 코드가 프리픽스
    // 매칭에 의존하므로 id 를 날짜까지 그대로 둔다.
    aliases: ["haiku"],
    capability: "cheap",
    efforts: [],
    pricing: { inputPer1M: 1, outputPer1M: 5 },
    minCli: "2.1.220",
    verified: CLAUDE_PROBE,
    status: "active",
  },

  // ── Codex / GPT (§1.2) ────────────────────────────────────────────────
  // ★"고가 5.6" 은 단일 모델이 아니라 sol/terra/luna 3변종이고, terra·luna 는
  // 5.5 보다 싸다. "GPT=저가 fleet" 이라는 사내 전제는 현 설정에서 거짓이다
  // (우리 기본 모델 gpt-5.5 $5/$30 > sonnet5 $3/$15).
  {
    id: "gpt-5.6-sol",
    harness: "gpt",
    provider: "openai",
    aliases: [],
    capability: "frontier",
    efforts: EFFORTS_56_FULL,
    defaultEffort: "low",
    pricing: { inputPer1M: 5, outputPer1M: 30 },
    verified: CODEX_PROBE,
    status: "active",
  },
  {
    id: "gpt-5.6-terra",
    harness: "gpt",
    provider: "openai",
    aliases: [],
    capability: "top",
    efforts: EFFORTS_56_FULL,
    defaultEffort: "medium",
    pricing: { inputPer1M: 2.5, outputPer1M: 15 },
    verified: CODEX_PROBE,
    status: "active",
  },
  {
    id: "gpt-5.6-luna",
    harness: "gpt",
    provider: "openai",
    aliases: [],
    capability: "mid",
    efforts: EFFORTS_56_NO_ULTRA,
    defaultEffort: "medium",
    pricing: { inputPer1M: 1, outputPer1M: 6 },
    verified: CODEX_PROBE,
    status: "active",
  },
  {
    id: "gpt-5.5",
    harness: "gpt",
    provider: "openai",
    aliases: [],
    capability: "top",
    efforts: EFFORTS_CLASSIC,
    defaultEffort: "medium",
    // ★현행 fleet 기본 모델(`~/.codex/config.toml`). 기존 MODEL_PRICING 은
    // 이 행을 $5/$20 으로 갖고 있었다 = output 33% 과소보고.
    pricing: { inputPer1M: 5, outputPer1M: 30 },
    verified: CODEX_PROBE,
    status: "active",
  },
  {
    id: "gpt-5.4",
    harness: "gpt",
    provider: "openai",
    aliases: [],
    capability: "mid",
    efforts: EFFORTS_CLASSIC,
    defaultEffort: "medium",
    // ★확정(2026-07-27, gstack /browse): platform.openai.com/docs/models/gpt-5.4
    // 의 Pricing 절이 Input $2.50 / Cached $0.25 / Output $15.00 을 싣는다.
    // 종전 값은 "확정 못 해서 5.5 와 같게 잡아둔" 보수적 추정치($5/$30)였고,
    // 실단가의 **2배**였다 — 즉 5.4 를 쓴 티켓의 비용이 과대보고돼 왔다
    // (cost-tracker 규율은 과소보고를 금할 뿐, 과대보고도 라우팅 학습을
    //  오염시키는 방향은 같다). 같은 화면의 Quick comparison 표도 GPT-5.4 를
    // $2.50 로 적어 교차확인된다.
    pricing: { inputPer1M: 2.5, outputPer1M: 15 },
    verified: CODEX_PROBE,
    status: "active",
  },
  {
    id: "gpt-5.4-mini",
    harness: "gpt",
    provider: "openai",
    aliases: [],
    capability: "cheap",
    efforts: EFFORTS_CLASSIC,
    defaultEffort: "medium",
    pricing: { inputPer1M: 0.75, outputPer1M: 4.5 },
    verified: CODEX_PROBE,
    status: "active",
  },

  // ── Grok Build (xAI native harness) ───────────────────────────────────
  //
  // ★두 행의 순서가 곧 "신형이 위" 다(같은 등급 안에서는 등재 순서가 보존된다 —
  // `modelsByHarness` 는 안정정렬이고 셀렉터·사다리가 그 순서를 그대로 읽는다).
  //
  // ★effort 축은 **일부러 비워 둔다**. docs.x.ai 는 grok-4.6 을 "Reasoning:
  // Configurable" 로 적고 `grok --help` 에도 `--reasoning-effort` 가 있지만,
  // `agent-config.buildCLICommand` 의 grok 분기는 그 플래그를 argv 에 붙이지
  // 않는다. 지금 여기에 effort 를 적으면 셀렉터에 "골랐는데 CLI 엔 안 붙는" 둘째
  // 드롭다운이 서게 된다 — grok 오케가 이미 한 번 겪은 실패모드(#638/#639)다.
  // argv 배선이 생기는 날 이 배열이 열린다.
  {
    id: "grok-4.6",
    harness: "grok",
    provider: "xai",
    // ★alias `grok` 은 **4.5 에서 여기로 옮겨왔다**. `grok models` 가 4.6 을
    // default 로 찍고, docs.x.ai 의 alias 규칙이 "`<modelname>` is aliased to the
    // latest stable version" 이라고 명문화한다. alias 는 이동표적이라는 이 파일
    // 상단 규율의 실례 — 그래서 핀에는 alias 가 아니라 이 id 를 쓴다.
    aliases: ["grok"],
    capability: "top",
    efforts: [],
    // grok-4.5 와 **동일** 단가($2/$6, 500k). 세대가 올라도 과금축이 안 움직였다.
    // estimated 인 사유는 4.5 와 같다(아래 주석).
    pricing: { inputPer1M: 2, outputPer1M: 6, estimated: true },
    verified: GROK_BUILD_PROBE,
    status: "active",
  },
  {
    id: "grok-4.5",
    harness: "grok",
    provider: "xai",
    // alias 없음 — `grok` 은 위 4.6 으로 해석된다(2026-08-20 `grok models` 실측).
    aliases: [],
    capability: "top",
    efforts: [],
    // API list 단가. Grok Build 의 현재 무료 프로모/구독 경로와는 과금축이
    // 다르므로 상한 추정치로 표시한다.
    pricing: { inputPer1M: 2, outputPer1M: 6, estimated: true },
    verified: GROK_BUILD_PROBE,
    status: "active",
  },

  // ── Z.ai GLM (첫 env-swap 벤더 — 서베이 §2.4) ──────────────────────────
  // ★이 두 행이 **레퍼런스 패턴**이다. 신규 (B)형 벤더(MiniMax 등)는 코드를 한 줄도
  // 안 늘리고 여기 같은 모양의 행만 추가하면 된다: harness=claude(우리가 이미
  // 스폰하는 바이너리) + provider=<벤더> + envProfile(엔드포인트 + 시크릿 참조).
  //
  // 실측 출처(2026-07-26 gstack /browse 크롤, 1차 출처만):
  //   docs.z.ai/devpack/tool/claude   — ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN 배선
  //   docs.z.ai/devpack/latest-model  — "Claude Code / Goose (Anthropic-compatible):
  //                                      https://api.z.ai/api/anthropic", 모델 전환표
  //   docs.z.ai/guides/overview/pricing — 텍스트 모델 per-1M 단가표
  //
  // ★`ANTHROPIC_DEFAULT_*_MODEL` 을 함께 얹는 이유: 우리는 `--model <id>` 로 핀하지만,
  // claude CLI 는 그 밖의 자리(요약·제목 생성 등 내부 alias 경로)에서 `opus`/`sonnet`/
  // `haiku` 를 자체적으로 해석한다. 매핑을 안 주면 그 호출들이 **Anthropic 모델명 그대로**
  // Z.ai 엔드포인트에 나가 실패한다. 세 키 전부 GLM id 로 접어 벤더 경계를 닫는다
  // (docs.z.ai 의 "default configuration" 도 세 키를 모두 지정한다).
  //
  // ★1M 컨텍스트 변종(`glm-5.2[1m]`)은 등록하지 않았다 — 별도 env
  // (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`)와 최신 CLI 를 요구하고, 우리가 아직
  // 라이브로 확인하지 못했다. 구독키 확보 후 별 행으로 편입한다.
  {
    id: "glm-5.2",
    harness: "claude", // 우리 claude 바이너리를 그대로 스폰한다(신규 하네스 0)
    provider: "zai", // 붙는 백엔드는 Anthropic 이 아니라 Z.ai 다
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}", // ★값이 아니라 env 키 이름
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2",
      // haiku 자리는 벤더 문서가 더 싼 모델을 권한다. 우리는 **레지스트리에 등록된**
      // id 만 쓴다 — 미등록 id 가 스폰 env 로 새면 cost-tracker 가 단가를 모르는
      // "유령 비용" 이 된다(vzHgU4Tx 설계문서의 동일 실패모드).
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",
    },
    aliases: [],
    // ★벤치 미확보(model-bench-reference 에 GLM 행 없음). 등급은 **벤더 자기
    // 포지셔닝**(5.2=현행 플래그십, 4.7=직전 세대)에 따른 잠정값이고, 라우팅
    // 사다리엔 아직 안 들어가므로(LADDER_EXCLUSIONS) 이 값이 자동 선택을 바꾸지
    // 않는다. 실측 후 조정 대상.
    capability: "top",
    // claude 하네스엔 CLI 인자로 줄 effort 축이 없다. (Z.ai 문서는 세션 내
    // `/effort` 명령이 GLM effort 로 매핑된다고 적지만, 그건 우리 스폰 argv 가
    // 건드릴 수 있는 축이 아니다 — 그래서 여기선 빈 배열이 정직하다.)
    efforts: [],
    // 공식 API 리스트 단가($/1M). ★우리 접근 경로는 정액 Coding Plan 이라 실
    // 한계비용은 이보다 낮다(≈0) — 그래서 estimated 로 표시한다. 이 값은
    // "과소보고하지 않는" 상한이고, 쿼터 기반 비용축은 후속(서베이 V1-5).
    pricing: { inputPer1M: 1.4, outputPer1M: 4.4, estimated: true },
    verified: ZAI_DOCS_PROBE,
    status: "active",
  },
  {
    id: "glm-4.7",
    harness: "claude",
    provider: "zai",
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-4.7",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4.7",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",
    },
    aliases: [],
    capability: "mid",
    efforts: [],
    pricing: { inputPer1M: 0.6, outputPer1M: 2.2, estimated: true },
    verified: ZAI_DOCS_PROBE,
    status: "active",
  },

  // ── MiniMax Token Plan (두 번째 env-swap 벤더 — 서베이 §2.5) ─────────────
  // GLM 행의 **정확한 복제**다. 새로 배선한 코드는 없다 — 위 두 행과 같은 모양의
  // 행 2개가 전부다((B)형 벤더의 편입 비용이 실제로 데이터라는 두 번째 증거).
  //
  // 실측 출처(2026-07-26 gstack /browse 크롤, 1차 출처만):
  //   /docs/token-plan/claude-code.md  — Claude Code 배선(ANTHROPIC_BASE_URL/
  //                                      ANTHROPIC_AUTH_TOKEN + DEFAULT_* 매핑),
  //                                      "for international users, use
  //                                       https://api.minimax.io/anthropic"
  //   /docs/token-plan/other-tools.md  — Anthropic-Compatible 표: Base URL
  //                                      https://api.minimax.io/anthropic,
  //                                      Model ID `MiniMax-M3`
  //   /docs/guides/models-intro.md     — 현행 언어모델 3종(M3 / M2.7 /
  //                                      M2.7-highspeed), 그 아래는 Legacy
  //   /docs/guides/pricing-paygo.md    — per-1M 단가표
  //
  // ★모델 id 대소문자는 **벤더 문서 원문 그대로**다(`MiniMax-M3`). 소문자로 접어
  // 적으면 우리가 만든 문자열을 남의 API 에 보내는 것이고, 그게 유효한지 확인할
  // 방법이 (구독키 없이는) 없다. 레지스트리 **조회**는 대소문자를 안 가린다
  // (BY_ID 가 norm 키를 쓴다) — 그래서 dispatch 는 `minimax-m3` 로도 닿는다.
  //
  // ★국내(중국) 엔드포인트 `https://api.minimaxi.com/anthropic` 는 등록하지
  // 않았다. 같은 키가 양쪽에서 통하지 않고(플랫폼 계정 자체가 다르다), 우리가
  // 쓰는 건 international 이다. 필요해지면 별 행이 아니라 env 로 갈릴 축이다.
  //
  // ★1M 컨텍스트 표기(`MiniMax-M3[1m]`)는 등록하지 않았다 — GLM 의 `[1m]` 변종과
  // 같은 이유다. 벤더 Claude Code 문서가 그 표기와 함께
  // `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 을 요구하는데, 그 env 를 우리 스폰에
  // 얹었을 때의 동작을 라이브로 확인하지 못했다. 안 얹으면 claude 가 자기 기본
  // 임계에서 더 일찍 compact 할 뿐이라 **안전한 쪽으로 틀린다**.
  {
    id: "MiniMax-M3",
    harness: "claude", // 우리 claude 바이너리를 그대로 스폰한다(신규 하네스 0)
    provider: "minimax",
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}", // ★값이 아니라 env 키 이름
      ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M3",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M3",
      // GLM 과 같은 규율: **레지스트리에 등록된 id 만** env 로 내보낸다(미등록 id =
      // cost-tracker 가 단가를 모르는 유령 비용). 그래서 haiku 자리는 더 싼 현행
      // 모델인 M2.7 로 접었다.
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
    },
    aliases: [],
    // 벤더 자기 표기는 "Frontier multimodal coding model" 이지만, 우리 `frontier`
    // 등급은 벤치·실측이 붙은 칸이다(오늘은 fable5 하나). 벤더 마케팅 문구로 그
    // 등급을 주지 않는다 — GLM 과 같이 top 으로 잠정 두고, 사다리에 안 들어가므로
    // (LADDER_EXCLUSIONS) 이 값이 자동 선택을 바꾸지 않는다.
    capability: "top",
    efforts: [], // claude 하네스엔 CLI 인자로 줄 effort 축이 없다
    // 공식 pay-as-you-go 리스트 단가(≤512k input). 문서는 "Permanent 50% off" 로
    // $0.30/$1.20 을 병기하지만 **할인 전 리스트**를 적는다 — 할인은 벤더가 언제든
    // 거두고, 과소보고는 라우팅 학습을 오염시키는 방향이다(cost-tracker 규율).
    // 512k 초과 입력 구간은 2배($1.20/$4.80)이고 우리 축엔 그 조건이 없다. 우리
    // 접근 경로는 정액 Token Plan 이라 실 한계비용은 ≈0 — 그래서 estimated 다.
    pricing: { inputPer1M: 0.6, outputPer1M: 2.4, estimated: true },
    verified: MINIMAX_DOCS_PROBE,
    status: "active",
  },
  {
    id: "MiniMax-M2.7",
    harness: "claude",
    provider: "minimax",
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
    },
    aliases: [],
    capability: "mid",
    efforts: [],
    // $0.3/$1.2 (pricing-paygo.md, 할인 표기 없음). estimated 인 이유는 GLM 과
    // 같다 — 우리가 실제로 태우는 것은 구독 쿼터지 이 단가가 아니다.
    pricing: { inputPer1M: 0.3, outputPer1M: 1.2, estimated: true },
    verified: MINIMAX_DOCS_PROBE,
    status: "active",
  },
  // MiniMax 에서 **등록하지 않은 것**:
  //   - `MiniMax-M2.7-highspeed` : M2.7 과 성능 동일 + 저지연이고 단가가 2배다
  //     ($0.6/$2.4). 지연을 라우팅 축으로 쓰지 않는 지금은 "같은 성능에 2배 비싼
  //     칸" 일 뿐이라 고를 근거가 없다.
  //   - M2.5 / M2.1 / M2 : 벤더 문서가 Legacy 로 접었다.

  // ── Kimi Code (세 번째 env-swap 벤더 — tUobgoQF) ───────────────────────
  // ★1단계 판별 결과: **(B)형이다.** 티켓은 "자체 kimi CLI" 때문에 (A)형 신규
  // 하네스일 가능성을 열어뒀지만, 실측해 보니 **같은 구독이 Anthropic 호환
  // 엔드포인트로도 열린다** — 그래서 GLM/MiniMax 와 똑같이 행 3개로 끝난다
  // (`HarnessId` 무변경, 스폰 switch 무변경, grok 3겹 수술 0).
  //
  // 실측 출처 A — 2026-07-27 gstack /browse 크롤(1차 출처만):
  //   www.kimi.com/code/docs/en/  "Service Endpoint" 표
  //     · Anthropic Compatible  Base URL `https://api.kimi.com/coding/`
  //                             → 실 엔드포인트 `…/v1/messages`
  //     · OpenAI Compatible     `https://api.kimi.com/coding/v1`
  //     · "Subscribers can also obtain an API Key to integrate Kimi Code's model
  //        capabilities into third-party development tools" ← 구독 혜택이 자체
  //        CLI 전용이 **아니라는** 근거. 이 한 줄이 (A)형/(B)형을 갈랐다.
  //   /third-party-tools/claude-code.html — **Claude Code 전용 공식 가이드**.
  //     배선이 GLM/MiniMax 와 동형(ANTHROPIC_BASE_URL + 크레덴셜 + DEFAULT_* 매핑).
  //   /kimi-code/models.html — 모델 id 4종·컨텍스트·플랜별 가용성 표.
  //
  // 실측 출처 B — 2026-07-27 라이브 프로브(구독키 없이 확인 가능한 범위):
  //   ① `POST https://api.kimi.com/coding/v1/messages` 무인증 → 401
  //      `{"error":{"type":"authentication_error",…},"type":"error"}`
  //      = **Anthropic 에러 봉투 그대로**. 엔드포인트가 실재하고 프로토콜이 맞다.
  //   ② 같은 요청 + 더미 크레덴셜 → 401 "The API Key appears to be invalid" 로
  //      메시지가 **바뀐다**(무인증과 다름) = 크레덴셜이 실제로 파싱된다.
  //   ③ ★`x-api-key`(=ANTHROPIC_API_KEY)와 `Authorization: Bearer`
  //      (=ANTHROPIC_AUTH_TOKEN) **둘 다** ②와 동일 응답 → 게이트웨이가 두 헤더
  //      형태를 모두 받는다. 아래 AUTH_TOKEN 선택의 근거다.
  //   ④ claude CLI 2.1.220 로 이 프로파일을 실제 스폰(`-p --model kimi-for-coding`,
  //      격리 HOME): 두 형태 모두 `is_error:true` + `duration_api_ms:0` +
  //      `modelUsage:{}` 로 동일하게 인증거부 — 즉 우리 env 가 Kimi 까지 닿았다
  //      (CLAUDE_PROBE 가 쓰는 "무효 설정" 시그니처와 같은 모양).
  //
  // ★크레덴셜 키는 `ANTHROPIC_AUTH_TOKEN` 이다 — 벤더 문서는 `ANTHROPIC_API_KEY`
  // 를 쓰지만 위 프로브 ③이 두 형태 동치를 보였고, `ANTHROPIC_API_KEY` 는 claude
  // CLI 의 "이 API 키를 쓸까요?" 승인 경로를 건드릴 수 있는 축이다(대화형 스폰에서
  // 프롬프트로 멈추면 grok #617 과 같은 부류의 사고가 된다). 세 env-swap 벤더를
  // 한 모양으로 유지하는 이득도 같이 얻는다.
  //
  // ★env 이름은 `KIMI_API_KEY` 다(`MOONSHOT_API_KEY` 가 아니다). 후자는 Kimi
  // **Platform**(pay-go, api.moonshot.ai) 키의 공식 이름이고, 우리가 쓰는 것은
  // Kimi **Code Console** 의 구독 키다 — 엔드포인트도 모델 id 도 다른 별개 키라,
  // 같은 이름을 쓰면 두 계정 크레덴셜이 서로의 백엔드로 새는 축이 생긴다.
  //
  // ★모델 id 는 Kimi **Code** 표기(k3 / k3-256k / kimi-for-coding)다. Platform
  // 쪽 id(kimi-k3 / kimi-k2.7-code)와 **다르다** — 베이스 URL 이 다르면 id 도 다르다.
  {
    id: "k3",
    harness: "claude", // 우리 claude 바이너리를 그대로 스폰한다(신규 하네스 0)
    provider: "moonshot",
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
      ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}", // ★값이 아니라 env 키 이름
      // ★벤더 Claude Code 가이드는 GLM/MiniMax 문서에 없던 두 키를 더 지정한다
      // (FABLE·SUBAGENT). 우리 fleet 엔 `claude-fable-5` 행이 실재하고 Task 서브
      // 에이전트도 뜨므로, 이 둘을 안 접으면 그 경로가 **Anthropic 모델명 그대로**
      // Kimi 엔드포인트에 나가 실패한다. 벤더 경계를 전부 닫는다.
      ANTHROPIC_DEFAULT_FABLE_MODEL: "k3",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "k3",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "k3",
      // GLM/MiniMax 와 같은 규율: **레지스트리에 등록된 id 만** env 로 내보낸다
      // (미등록 id = cost-tracker 가 단가를 모르는 유령 비용). haiku 자리는 전
      // 멤버가 쓸 수 있고 제일 싼 kimi-for-coding 으로 접는다.
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
      CLAUDE_CODE_SUBAGENT_MODEL: "k3",
    },
    aliases: [],
    // 벤더 자기 표기는 "2.8T 파라미터 플래그십". MiniMax 행과 같은 규율로
    // `frontier` 는 주지 않는다 — 그 칸은 벤치·실측이 붙은 자리다(오늘 fable5 뿐).
    capability: "top",
    // ★K3 는 reasoning_effort(low/high/max) 가 **있다**. 그런데 그 축은 세션 내
    // `/effort` 나 요청 본문 필드로 가는 것이지 우리 스폰 argv 가 건드리는 축이
    // 아니다(claude 하네스엔 effort 인자가 없다). 그래서 빈 배열이 정직하다.
    // 벤더 문서상 미지정 기본값이 `high` 라 우리 스폰은 high 로 돈다.
    efforts: [],
    // Kimi Platform(pay-go) 리스트 단가 중 **cache-miss 입력**($3.00)과 출력
    // ($15.00) — platform.kimi.ai/docs/pricing/chat-k3. 우리 접근 경로는 정액
    // Kimi Code 구독이라 실 한계비용은 ≈0 이고, 이 값은 "과소보고하지 않는" 상한이다.
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0, estimated: true },
    verified: KIMI_CODE_PROBE,
    status: "active",
  },
  {
    id: "k3-256k",
    harness: "claude",
    provider: "moonshot",
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
      ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "k3-256k",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "k3-256k",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "k3-256k",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
      CLAUDE_CODE_SUBAGENT_MODEL: "k3-256k",
    },
    aliases: [],
    capability: "top",
    efforts: [],
    // 별도 단가 행이 없다(플랫폼 가격표엔 kimi-k3 한 행뿐). 문서는 "256K 판이라
    // 소모가 줄어든다" 고만 적으므로, 과소보고를 피해 k3 와 같은 값을 상한으로 둔다.
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0, estimated: true },
    verified: KIMI_CODE_PROBE,
    status: "active",
  },
  {
    id: "kimi-for-coding",
    harness: "claude",
    provider: "moonshot",
    envProfile: {
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
      ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "kimi-for-coding",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-for-coding",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-for-coding",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
      CLAUDE_CODE_SUBAGENT_MODEL: "kimi-for-coding",
    },
    aliases: [],
    // K2.7 Code = K3 직전 세대의 코딩 전용 모델. glm-4.7 / MiniMax-M2.7 과 같은 칸.
    capability: "mid",
    efforts: [],
    // platform.kimi.ai/docs/pricing/chat-k27-code 의 `kimi-k2.7-code` 행
    // (cache-miss 입력 $0.95 / 출력 $4.00). estimated 사유는 위와 같다.
    pricing: { inputPer1M: 0.95, outputPer1M: 4.0, estimated: true },
    verified: KIMI_CODE_PROBE,
    status: "active",
  },
  // Kimi 에서 **등록하지 않은 것**:
  //   - `kimi-for-coding-highspeed` : kimi-for-coding 과 **같은 모델**이고 출력만
  //     5~6배 빠른 대신 쿼터를 3배 태운다(+ Allegretto 이상 전용). MiniMax 의
  //     `-highspeed` 를 뺀 것과 같은 판단이다 — 지연을 라우팅 축으로 쓰지 않는
  //     지금은 "같은 성능에 3배 비싼 칸" 이라 고를 근거가 없다.
  //   - `k3[1m]` (1M 컨텍스트 표기) : GLM `glm-5.2[1m]`·MiniMax `MiniMax-M3[1m]`
  //     을 뺀 것과 **같은 이유**다. 벤더 문서가 그 표기와 함께
  //     `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1048576`·`CLAUDE_CODE_MAX_CONTEXT_TOKENS`
  //     를 요구하는데, 그 env 를 우리 스폰에 얹었을 때의 동작을 라이브로 확인하지
  //     못했다. 안 얹으면 claude 가 자기 기본 임계에서 더 일찍 compact 할 뿐이라
  //     **안전한 쪽으로 틀린다**. 위 `k3` 행은 대괄호 없는 평문 id 라 플랜이 주는
  //     만큼의 컨텍스트로 그냥 돈다.
  //   - `CLAUDE_CODE_EFFORT_LEVEL=high` : 벤더 예시엔 있지만 문서의 매핑표가
  //     "미지정 기본 = high" 라고 못박는다. 값이 같은 env 를 굳이 얹어 미검증
  //     노브를 늘리지 않는다.
  //   - 네이티브 `kimi` CLI (`code.kimi.com/kimi-code/install.sh`) : 실재하지만
  //     같은 구독이 위 (B)형으로 이미 열리므로 (A)형 하네스 수술(argv·격리홈
  //     auth 전파·command 정규화 3겹)을 지불할 이유가 없다.

  // ── Upstage Solar Pro (OpenAI 호환 env-swap 벤더 — tUlSJc0J) ───────────
  // Solar 는 GLM/MiniMax/Kimi 와 같은 (B)형이지만 **Anthropic 호환이 아니라
  // OpenAI 호환**이다. 따라서 harness=claude 가 아니라 harness=gpt(codex) 로
  // 접고, 스폰 env 도 ANTHROPIC_* 가 아니라 OPENAI_* 를 갈아끼운다. `agent-config`
  // 의 gpt 분기가 이미 `applyVendorEnv` 를 호출하므로 신규 switch 는 없다.
  //
  // 공식 출처(2026-08-15 확인):
  //   console.upstage.ai/api-keys — OpenAI SDK 예제:
  //     api_key="UPSTAGE_API_KEY", base_url="https://api.upstage.ai/v1",
  //     model="solar-pro4", reasoning_effort="medium"
  //   www.upstage.ai/blog/en/solar-pro-4 — OpenAI-compatible, model name
  //     `solar-pro4`, 정가 Input $0.30 / Cached Input $0.06 / Output $1.20 per 1M.
  //
  // ★티켓의 `solar-pro` 는 "예시"로만 본다. 오늘 공식 id 는 `solar-pro4` 라서
  // 레지스트리 id 는 그 값을 쓰고, 사람이 예전 표기로 dispatch 할 수 있도록 alias
  // `solar-pro` 를 둔다. cost_logs 와 단가표에는 구체 id 만 남겨 유령 비용을 막는다.
  {
    id: "solar-pro4",
    harness: "gpt", // Codex CLI 를 그대로 스폰하고 OpenAI 호환 env 만 바꾼다
    provider: "upstage",
    envProfile: {
      OPENAI_BASE_URL: "https://api.upstage.ai/v1",
      OPENAI_API_KEY: "${UPSTAGE_API_KEY}",
    },
    aliases: ["solar-pro"],
    capability: "mid",
    // Upstage 예제가 reasoning_effort="medium" 을 싣는다. Codex 분기는 이 축을
    // `model_reasoning_effort` 로 넘기므로 low/medium/high 까지만 연다(max/ultra
    // 같은 승인게이트 칸은 Upstage 공식 예제에 없고, 여기서 추측하지 않는다).
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    pricing: { inputPer1M: 0.3, outputPer1M: 1.2 },
    verified: UPSTAGE_SOLAR_PROBE,
    status: "active",
  },

  // ── DeepSeek V4 (OpenAI 호환 env-swap 벤더 — JrxWAAGq) ────────────────
  // Solar 와 같은 (B)형 OpenAI 호환 벤더다. 신규 하네스 없이 Codex(gpt) 바이너리를
  // 그대로 스폰하고, OPENAI_BASE_URL/OPENAI_API_KEY 만 DeepSeek 으로 갈아끼운다.
  // `agent-config` 의 gpt 분기가 이미 `applyVendorEnv` 를 호출하므로 switch 추가는
  // 없다.
  //
  // ★오케 셀렉터 경계(2026-08-21, 7HthjBEf 로 갱신): 종전엔 `selectorEligible` 이
  // env-swap 벤더를 통째로 잘라냈고 DeepSeek 도 거기 걸렸다. 지금은 DeepSeek 만
  // 예외로 통과하는데, 그 예외를 지탱하는 것은 **잔액 게이트**다 — 이 벤더는
  // `GET /user/balance` 를 공개해서 "선불 잔액이 말없이 0 이 되는" 조건부성을
  // 런타임에 관측할 수 있다(`electron/orchestrator-vendor-gate.ts`). 프로브가 없는
  // 다른 env-swap 벤더(GLM/MiniMax/Kimi/Solar)는 그대로 잘린다.
  //
  // 공식 스펙(2026-08-18 최초, 2026-08-21 재확인 — 모델 id·단가 전부 변동 없음):
  //   base_url=https://api.deepseek.com, api_key=${DEEPSEEK_API_KEY}
  //   model=deepseek-v4-flash(DeepSeek-V4-Flash-0731)
  //   model=deepseek-v4-pro(DeepSeek-V4-Pro-0813)
  //   둘 다 Tool Calls / Thinking mode 를 지원한다. context 1M, max output 384K.
  //
  // 단가는 peak 정가 기준($/1M)으로 둔다(과소보고 방지). 공식 off-peak 는 절반:
  //   flash input/output $0.22/$0.66, pro $0.66/$1.98.
  // cache-hit input 은 peak 기준 flash $0.014, pro $0.044(오프피크는 절반)다.
  // ★2026-08-21 확보: peak 는 하루 종일이 아니라 01:00-04:00 · 06:00-10:00 UTC
  //   두 구간(합 7시간)뿐이고 나머지 17시간은 전부 off-peak 다. 즉 우리 peak 기준
  //   기록은 실사용 대비 최대 2배 **과대**보고 방향이다 — 그래서 그대로 둔다.
  //
  // ★effort 축은 DeepSeek 이 Codex 용으로 직접 배포하는 공식 `models.json`
  //   (quick_start/agent_integrations/codex)이 권위다. 두 모델 모두
  //   supported_reasoning_levels = low / high / **max** 이고 default 는 **high** 다.
  //   종전 이 파일은 low/medium/high + default medium 으로 적혀 있었는데, DeepSeek
  //   은 `medium` 을 정의하지 않는다 — 즉 우리 **기본값이 벤더에 없는 값**이었다.
  //   (공식 config.toml 예시도 `model_reasoning_effort = "high"` 로 준다.)
  //   `max` 는 우리 쪽 승인게이트 칸이라 `selectableEfforts` 가 셀렉터에서 이미
  //   걷어낸다 — gpt 행들과 완전히 같은 취급이고, 명시 지정 경로로만 닿는다.
  {
    id: "deepseek-v4-flash",
    harness: "gpt", // Codex CLI 를 그대로 스폰하고 OpenAI 호환 env 만 바꾼다
    provider: "deepseek",
    envProfile: {
      OPENAI_BASE_URL: "https://api.deepseek.com",
      OPENAI_API_KEY: "${DEEPSEEK_API_KEY}",
    },
    aliases: [],
    capability: "mid",
    // 공식 models.json: low / high / max, default high (위 블록 주석 참조).
    efforts: ["low", "high", "max"],
    defaultEffort: "high",
    pricing: { inputPer1M: 0.44, outputPer1M: 1.32 },
    verified: DEEPSEEK_PROBE,
    status: "active",
  },
  {
    id: "deepseek-v4-pro",
    harness: "gpt",
    provider: "deepseek",
    envProfile: {
      OPENAI_BASE_URL: "https://api.deepseek.com",
      OPENAI_API_KEY: "${DEEPSEEK_API_KEY}",
    },
    aliases: [],
    capability: "mid",
    // flash 와 동일 — 공식 models.json 기준 low / high / max, default high.
    efforts: ["low", "high", "max"],
    defaultEffort: "high",
    pricing: { inputPer1M: 1.32, outputPer1M: 3.96 },
    verified: DEEPSEEK_PROBE,
    status: "active",
  },

  // 의도적 미등록(§1.2 표에는 있으나 라우팅 후보가 아님):
  //   - gpt-5.3-codex-spark : api ❌ (Codex CLI 전용). 단가만 cost-tracker 의
  //     legacy 프리픽스 행("gpt-5.3-codex" $1.75/$14)이 커버한다.
  //   - codex-auto-review   : hidden(내부 전용).
  // antigravity/gemini/local: CLI-verified 모델 사실이 아직 없다. 벤더 서베이
  //   (db3qs0o6)가 끝나면 여기 행 추가로 편입된다 — 다른 파일은 손대지 않는다.
];

// ─────────────────────────────────────────────────────────────────────────
// 조회 API
// ─────────────────────────────────────────────────────────────────────────

// ★인덱스 키는 `norm`(trim+소문자)으로 접는다 — `getModel` 이 같은 함수로 조회하기
// 때문이다. 종전엔 **원문 그대로** 넣었고, 우리 id 가 전부 소문자라 그 차이가
// 드러나지 않았다. MiniMax 는 벤더 공식 id 가 `MiniMax-M3`(대소문자 혼합)라
// 그대로 두면 `getModel("MiniMax-M3")` 가 **영구 miss** 한다 — 즉 envProfile 이
// 조용히 안 얹히고 스폰이 Anthropic 으로 새는, 이 축이 막으려던 바로 그 실패모드다.
// 접는 쪽은 **조회 키**뿐이고 `entry.id` 원문(=CLI·API 로 나가는 값)은 그대로다.
const BY_ID = new Map<string, ModelRegistryEntry>();
const BY_ALIAS = new Map<string, ModelRegistryEntry>();
for (const entry of MODEL_REGISTRY) {
  BY_ID.set(norm(entry.id), entry);
  for (const alias of entry.aliases) BY_ALIAS.set(norm(alias), entry);
}

/**
 * `envProfile` 을 **실제로 주입할 수 있는** 하네스.
 *
 * 스폰 env 머지는 `agent-config.buildCLICommand` 의 claude·gpt 분기에만 배선돼
 * 있다(USbdRV4k). 다른 하네스에 프로파일을 단 행을 등록하면 그 env 는 **조용히
 * 버려진다** — 벤더 편입 티켓이 "붙였는데 왜 Anthropic 으로 가지?" 로 하루를
 * 태우는 실패모드라, 여기서 부팅을 멈춘다.
 */
export const ENV_PROFILE_SUPPORTED_HARNESSES: readonly HarnessId[] = [
  "claude",
  "gpt",
] as const;

/**
 * 각 하네스가 **아무 프로파일 없이** 붙는 백엔드(= 그 CLI 자기 로그인의 주인).
 *
 * 이 표가 있는 이유는 아래 부팅 가드 하나 때문이다: `provider` 만 바꾸고
 * `envProfile` 을 잊은 행은 **조용히 네이티브 벤더로 스폰된다**. GLM 이라고 적힌
 * 행이 실제로는 Anthropic 쿼터를 태우는 것이 이 티켓이 막아야 할 실패모드다.
 */
export const HARNESS_NATIVE_VENDOR: Readonly<Record<HarnessId, VendorId>> = {
  claude: "anthropic",
  gemini: "google",
  gpt: "openai",
  grok: "xai",
  antigravity: "google",
  local: "local",
  custom: "custom",
};

for (const entry of MODEL_REGISTRY) {
  const native = HARNESS_NATIVE_VENDOR[entry.harness];
  if (entry.provider !== native && !entry.envProfile) {
    throw new Error(
      `[model-registry] "${entry.id}" 는 provider=${entry.provider} 인데 envProfile 이 없습니다. ` +
        `harness="${entry.harness}" 는 프로파일이 없으면 ${native} 로 붙습니다 — ` +
        "벤더 이름만 바꾼 행은 조용히 네이티브 벤더 쿼터를 태웁니다.",
    );
  }
  if (!entry.envProfile) continue;
  if (!ENV_PROFILE_SUPPORTED_HARNESSES.includes(entry.harness)) {
    throw new Error(
      `[model-registry] "${entry.id}"(provider=${entry.provider}) 의 envProfile 은 ` +
        `harness="${
          entry.harness
        }" 에서 주입되지 않습니다(주입 가능: ${ENV_PROFILE_SUPPORTED_HARNESSES.join(
          ", ",
        )}). 그 하네스의 스폰 분기에 벤더 env 머지를 먼저 배선하세요.`,
    );
  }
  for (const [key, value] of Object.entries(entry.envProfile)) {
    // 부분보간 금지(`"Bearer ${K}"`). 값 전체가 자리표시자이거나, 자리표시자가
    // 아예 없거나 둘 중 하나여야 마스킹·감사 경계가 단순하게 유지된다.
    if (value.includes("${") && !vendorEnvSecretRef(value)) {
      throw new Error(
        `[model-registry] "${entry.id}" envProfile.${key} 의 \${...} 자리표시자는 ` +
          '값 전체여야 합니다(부분보간 금지). 예: "${ZAI_API_KEY}"',
      );
    }
  }
}

/**
 * 이 모델을 벤더 백엔드로 붙이는 데 **반드시 있어야 하는 env 키 이름들**(값 아님).
 *
 * 런북·`verify:models`·설정 UI 가 "무엇을 넣어야 켜지나" 를 값 없이 물어볼 수 있게
 * 하는 자리다. 시크릿 값은 이 모듈이 아예 읽지 않는다(`process.env` 접근은
 * `agent-config` 쪽 한 군데뿐).
 */
export function vendorEnvSecretKeys(idOrAlias?: string): string[] {
  const profile = getModel(idOrAlias ?? "")?.envProfile;
  if (!profile) return [];
  const keys = new Set<string>();
  for (const value of Object.values(profile)) {
    const ref = vendorEnvSecretRef(value);
    if (ref) keys.add(ref);
  }
  return [...keys].sort();
}

/** 입력 정규화 — CLI 는 대소문자를 가리지 않고 env 값엔 공백이 섞인다. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** 구체 id 또는 alias 로 항목을 찾는다(없으면 undefined). */
export function getModel(idOrAlias: string): ModelRegistryEntry | undefined {
  const key = norm(idOrAlias);
  return BY_ID.get(key) ?? BY_ALIAS.get(key);
}

/** 레지스트리가 아는 **구체 id** 인가(alias 는 false). */
export function isKnownModelId(s: string): boolean {
  return BY_ID.has(norm(s));
}

/** 레지스트리가 아는 **alias** 인가(구체 id 는 false). */
export function isModelAlias(s: string): boolean {
  return BY_ALIAS.has(norm(s));
}

/**
 * alias 를 구체 id 로 정규화한다. 모르는 문자열은 **그대로 돌려준다** —
 * 판정(폴백할지 말지)은 호출자 정책의 몫이고, 여기서 삼키면 미지 모델이 조용히
 * 사라진다.
 */
export function resolveModelAlias(idOrAlias: string): string {
  return getModel(idOrAlias)?.id ?? norm(idOrAlias);
}

const CAPABILITY_ORDER: Readonly<Record<CapabilityTier, number>> = {
  cheap: 0,
  mid: 1,
  top: 2,
  frontier: 3,
};

function byCapability(entries: ModelRegistryEntry[]): ModelRegistryEntry[] {
  return entries.sort(
    (a, b) => CAPABILITY_ORDER[a.capability] - CAPABILITY_ORDER[b.capability],
  );
}

/**
 * **하네스**별 활성 모델(능력등급 낮음 → 높음). 라우팅 사다리의 재료.
 *
 * ★종전 이름은 `modelsByProvider` 였다. 축이 쪼개진 지금 그 이름을 남겨두면
 * "provider 로 필터하는데 실제로는 바이너리 기준" 이라는 조용한 거짓말이 되므로
 * 이름을 바꿨다(호출자는 컴파일 에러로 전부 드러난다).
 */
export function modelsByHarness(harness: HarnessId): ModelRegistryEntry[] {
  return byCapability(
    MODEL_REGISTRY.filter(
      (m) => m.harness === harness && m.status === "active",
    ),
  );
}

/** **벤더**별 활성 모델(능력등급 낮음 → 높음). 쿼터·단가 집계의 재료. */
export function modelsByVendor(provider: VendorId): ModelRegistryEntry[] {
  return byCapability(
    MODEL_REGISTRY.filter(
      (m) => m.provider === provider && m.status === "active",
    ),
  );
}

/** 이 모델을 띄울 바이너리(하네스). 모르는 모델은 undefined. */
export function harnessForModel(idOrAlias: string): HarnessId | undefined {
  return getModel(idOrAlias)?.harness;
}

/** 이 모델의 벤더. 모르는 모델은 undefined. */
export function vendorForModel(idOrAlias: string): VendorId | undefined {
  return getModel(idOrAlias)?.provider;
}

/**
 * 이 모델을 벤더 백엔드로 붙이는 데 필요한 스폰 env. 프로파일이 없으면 **빈
 * 객체**를 돌려준다 — 오늘 모든 행이 그렇고, 그래서 스폰 env 가 종전과 동일하다.
 *
 * 사본을 돌려주므로 호출자가 변형해도 레지스트리 사실이 오염되지 않는다.
 */
export function envProfileForModel(idOrAlias?: string): Record<string, string> {
  if (!idOrAlias) return {};
  const profile = getModel(idOrAlias)?.envProfile;
  return profile ? { ...profile } : {};
}

// ── 로컬(Ollama) 모델 런타임 등록 ────────────────────────────────
//
// 스토어 '로컬 모델' 원클릭 pull 이 끝나면 그 실측 id 를 여기로 등록한다.
// PR#608 설계 그대로 **(B)형 env-swap 1행**이다: 하네스는 claude, 벤더는 local,
// env 는 Ollama 의 Anthropic 호환 엔드포인트(/v1/messages)로 갈아끼운다.
//
// ★정적 MODEL_REGISTRY 배열에는 넣지 않는다 — 그 배열은 검증된 벤더 사실의
// 정본이고 부팅 가드·퀵레인 카탈로그·단가표가 순회한다. 런타임 행은 조회 축
// (BY_ID → getModel/harnessForModel/envProfileForModel/resolveModelPin)에만
// 합류해, 핀·스폰·게이트는 통하되 정적 카탈로그 표면은 오염하지 않는다.
//
// ★유령비용 방지: 호출자는 반드시 `ollama list` **실측 출력**만 넘겨야 한다
// (local-models.syncInstalledLocalModels 가 단일 창구). 요청값·추측 id 를
// 등록하면 "설치 안 된 모델이 핀 가능" 이 되는, 이 축이 막으려던 실패모드가 된다.

/**
 * Ollama Anthropic 호환 엔드포인트 프로파일. `ANTHROPIC_AUTH_TOKEN` 은 더미다 —
 * ollama 는 인증을 무시하지만, 이 키가 비면 claude CLI 가 **우리 Anthropic
 * 크레덴셜을 그대로 들고** 로컬 엔드포인트로 가므로(부분 주입 금지와 같은 사유)
 * 명시적으로 갈아끼운다. 시크릿이 아니라서 `${...}` 참조가 아닌 리터럴이다.
 */
export const LOCAL_OLLAMA_ENV_PROFILE: VendorEnvProfile = {
  ANTHROPIC_BASE_URL: "http://localhost:11434",
  ANTHROPIC_AUTH_TOKEN: "ollama-local",
};

const RUNTIME_LOCAL_MODEL_IDS = new Set<string>();

/**
 * `ollama list` 실측 id 들을 스폰 축에 등록한다(멱등). 정적 레지스트리와 id 가
 * 충돌하면 정적 행이 이긴다 — 검증된 벤더 사실이 로컬 별칭에 덮이지 않게.
 */
/**
 * 파라미터 규모(B)만으로 toolSupport 를 판정한다.
 *
 * ★예전에는 임계값을 여기 복붙해 뒀다("카탈로그 import 순환 회피"). local-models
 * → model-registry 방향 import 가 이미 있어 반대 방향을 못 넣었기 때문인데, 그
 * 복붙이 곧 드리프트였다 — 임계를 한쪽만 고치면 스토어 카드와 스폰 레지스트리가
 * 다른 말을 한다. 판정을 의존성 0 인 `local-tool-tier.ts` 로 빼서 양쪽이 같은
 * 함수를 부른다(순환 없음, 단일 소스).
 *
 * 여기서는 카탈로그의 **행 단위 override 를 볼 수 없다**(그건 local-models 소관).
 * 이 경로로 오는 id 는 `ollama list` 실측분이고, 카탈로그에 있는 행은 스토어/스폰
 * 분기가 `toolSupportForLocalModelId` 로 다시 조회하므로 override 가 최종 판단에서
 * 유실되지는 않는다.
 */

export function registerLocalOllamaModels(ids: readonly string[]): void {
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id) continue;
    const key = norm(id);
    if (BY_ID.has(key)) continue; // 정적 행 우선 + 재등록 멱등
    const toolSupport = resolveLocalToolSupport(id);
    const entry: ModelRegistryEntry = {
      id,
      harness: "claude",
      provider: "local",
      envProfile: LOCAL_OLLAMA_ENV_PROFILE,
      aliases: [],
      // chat-only 는 cheap, 도구를 싣는 티어(lite 포함)는 mid — 라우팅이 대화
      // 전용 모델을 "실작업 cheap 티어"로 오해하지 않게 한다. lite 를 mid 로 두는
      // 이유: 주입량은 깎지만 티켓 한 건을 끝내는 실작업 경로 자체는 같다.
      capability: isToolCapableToolSupport(toolSupport) ? "mid" : "cheap",
      efforts: [],
      // 로컬 추론은 API 과금이 없다 — 0 요율은 사실이지 미측정이 아니다.
      pricing: { inputPer1M: 0, outputPer1M: 0 },
      verified: {
        at: new Date().toISOString().slice(0, 10),
        cli: "n/a (ollama)",
        method: "ollama list 실측 — 스토어 로컬모델 설치 경로가 등록",
      },
      status: "active",
      toolSupport,
    };
    BY_ID.set(key, entry);
    RUNTIME_LOCAL_MODEL_IDS.add(id);
  }
}

/** 런타임 등록된 로컬(Ollama) 모델 id 들(정적 행 제외). */
export function registeredLocalOllamaModelIds(): string[] {
  return [...RUNTIME_LOCAL_MODEL_IDS].sort();
}

/** 이 모델이 해당 effort 를 지원하는가. effort 축이 없는 모델은 항상 false. */
export function supportsEffort(idOrAlias: string, effort: string): boolean {
  const entry = getModel(idOrAlias);
  if (!entry) return false;
  return entry.efforts.includes(norm(effort) as EffortLevel);
}

/**
 * semver "X.Y.Z" 비교. a<b → 음수, a==b → 0, a>b → 양수. 누락/파싱불가 파트는
 * 0 취급. (agent-config 가 재수출하므로 기존 호출자는 그대로 쓴다.)
 */
export function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * 설치된 CLI 가 이 모델을 쓰기에 **검증된 범위 안**인가.
 *
 * `minCli` 가 없으면 게이트 없음(true). 버전 문자열이 비었으면(감지 실패) 미검증
 * 취급해 false — 모르면 안전한 쪽으로 떨어진다.
 *
 * @param minCliOverride 임계값 강제(env 튜닝용, 예: MARBLO_FABLE5_MIN_CLI).
 */
export function meetsMinCli(
  idOrAlias: string,
  installedVersion: string,
  minCliOverride?: string,
): boolean {
  const entry = getModel(idOrAlias);
  const min = minCliOverride ?? entry?.minCli;
  if (!min) return true;
  if (!installedVersion) return false;
  return cmpSemver(installedVersion, min) >= 0;
}

/**
 * cost-tracker 의 단가표에 합류시킬 { 모델id → 요율 } 맵.
 *
 * cost-tracker 는 **최장 프리픽스 매칭**을 쓰므로 구체 id 를 키로 넣는 것만으로
 * `claude-opus-5`·`gpt-5.6-luna` 같은 신형이 정확히 잡힌다. 레지스트리에 없는
 * 구형(claude-3-*, gpt-4o, gemini-*)은 cost-tracker 의 legacy 행이 계속 커버한다.
 *
 * `estimated` 플래그는 여기서 떨군다 — 단가표는 순수 요율만 담고, "추정치임"은
 * `estimatedPricingModelIds()` 로 따로 조회한다(추정이 사실로 위장하지 않게).
 */
export function registryPricing(): Record<
  string,
  { inputPer1M: number; outputPer1M: number }
> {
  const out: Record<string, { inputPer1M: number; outputPer1M: number }> = {};
  for (const entry of MODEL_REGISTRY) {
    out[entry.id] = {
      inputPer1M: entry.pricing.inputPer1M,
      outputPer1M: entry.pricing.outputPer1M,
    };
  }
  return out;
}

/** 단가가 추정치인 모델 id 들 — 런북/대시보드가 "확정 필요" 로 띄운다. */
export function estimatedPricingModelIds(): string[] {
  return MODEL_REGISTRY.filter((m) => m.pricing.estimated).map((m) => m.id);
}
