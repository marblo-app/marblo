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
 * 프로바이더(벤더) 축. `agent-manager.ts` / `dispatch-scoring.ts` 의 `ModelType`
 * 과 같은 집합이며, `agent-config.ts` 가 컴파일타임 양방향 호환 단언으로 고정한다.
 *
 * ★신규 벤더 추가 절차 = 이 유니온에 한 줄 + 아래 `MODEL_REGISTRY` 에 행 추가.
 * (db3qs0o6 벤더 서베이 결과가 그렇게 편입되도록 만든 구조다.)
 */
export type ModelProvider =
  | "claude"
  | "gemini"
  | "gpt"
  | "antigravity"
  | "local"
  | "custom";

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

export interface ModelRegistryEntry {
  /** CLI/API 에 그대로 넘기는 구체 모델 id. */
  id: string;
  provider: ModelProvider;
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
    provider: "claude",
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
    provider: "claude",
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
    provider: "claude",
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
    provider: "claude",
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
    provider: "claude",
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
    provider: "gpt",
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
    provider: "gpt",
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
    provider: "gpt",
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
    provider: "gpt",
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
    provider: "gpt",
    aliases: [],
    capability: "mid",
    efforts: EFFORTS_CLASSIC,
    defaultEffort: "medium",
    // TODO(단가확정): PR#596 크롤이 5.4 본체 행을 확정하지 못했다(5.4-mini 는 확정).
    // 과소보고를 피하려고 5.5 와 동일하게 보수적으로 잡아둔다. 서베이(db3qs0o6)
    // 결과가 나오면 estimated 를 지우고 실단가로 교체할 것.
    pricing: { inputPer1M: 5, outputPer1M: 30, estimated: true },
    verified: CODEX_PROBE,
    status: "active",
  },
  {
    id: "gpt-5.4-mini",
    provider: "gpt",
    aliases: [],
    capability: "cheap",
    efforts: EFFORTS_CLASSIC,
    defaultEffort: "medium",
    pricing: { inputPer1M: 0.75, outputPer1M: 4.5 },
    verified: CODEX_PROBE,
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

const BY_ID = new Map<string, ModelRegistryEntry>();
const BY_ALIAS = new Map<string, ModelRegistryEntry>();
for (const entry of MODEL_REGISTRY) {
  BY_ID.set(entry.id, entry);
  for (const alias of entry.aliases) BY_ALIAS.set(alias, entry);
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

/** 프로바이더별 활성 모델(능력등급 낮음 → 높음). 라우팅 사다리의 재료. */
export function modelsByProvider(
  provider: ModelProvider,
): ModelRegistryEntry[] {
  const order: Record<CapabilityTier, number> = {
    cheap: 0,
    mid: 1,
    top: 2,
    frontier: 3,
  };
  return MODEL_REGISTRY.filter(
    (m) => m.provider === provider && m.status === "active",
  ).sort((a, b) => order[a.capability] - order[b.capability]);
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
