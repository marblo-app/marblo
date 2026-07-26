/**
 * SWE-bench 계열 **공개 벤치 점수 참조표** — (모델 × 벤치 × 하네스 × 버전).
 *
 * ── 이 파일이 무엇이 **아닌지** 부터 ──────────────────────────────────────
 * 이건 라우팅 입력이 **아니다**. `routing-graph.ts`(라이브 학습 그래프)와
 * `mcp-server/routing-effectiveness.ts`(효과 집계)는 우리가 실제로 돌린 티켓의
 * 결과만 먹어야 한다. 벤더가 자기 하네스에서 낸 점수를 그 그래프에 주입하면
 * "우리 워크로드에서 관측된 사실"과 "벤더 마케팅 수치"가 한 통에 섞여, 그래프가
 * 무엇을 근거로 편향됐는지 사후에 분리할 수 없게 된다. 그래서 이 모듈은
 * **어느 라우팅 코드에서도 import 되지 않는다** — 그 사실 자체를
 * `tests/unit/model-bench-reference.test.ts` 가 소스 스캔으로 강제한다.
 *
 * 용도는 하나다: 사람이 "이 모델 대충 어느 급이지?" 를 물을 때 **출처가 붙은
 * 숫자**를 돌려주는 것. 레지스트리(model-registry.ts)가 모델의 *가격/effort*
 * 사실을 담듯, 여기는 모델의 *공개 성능* 사실을 담는다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **날조·추정 금지.** 모든 행은 공식 1차 출처(벤더 발표/시스템카드/모델카드,
 *    또는 벤치 소유자의 공식 리더보드)에서 눈으로 읽은 수치다. 추정·환산·
 *    기억으로 채운 칸은 하나도 없다. 확인 못 한 칸은 `score: null` 로 남기고
 *    이유를 적는다(아래 규율 3).
 * 2. **출처 URL 필수.** `source` 없는 행은 모듈 로드 시점에 throw 한다.
 *    `score: null` 인 행도 예외가 아니다 — 그 URL 이 "여기까지 찾아봤고 없더라"
 *    라는 **음성 증거**이기 때문이다. 다음 사람이 같은 곳을 다시 뒤지지 않는다.
 * 3. **빈 칸을 침묵시키지 않는다.** 공식 수치가 없으면 행을 지우는 게 아니라
 *    `score: null` + `note` 로 남긴다. 행이 없으면 "안 찾아봤다"와 "찾았는데
 *    없다"가 구분되지 않고, 그 구분이 이 표의 절반이다.
 * 4. **model id 는 레지스트리와 교차검증**(`kind: "registry"` 행). 레지스트리에
 *    없는 id 를 쓰면 부팅이 죽는다 — model-ladder.ts 와 같은 규율이다. 우리
 *    하네스에 아직 없는 벤더 후보(GLM/Grok/Kimi)는 `kind: "reference"` 로
 *    분리 표기하고, 오히려 **레지스트리에 있으면** 에러다(잘못 분류된 것이므로).
 *
 * ── ★같은 모델도 하네스가 다르면 다른 행이다 ────────────────────────────
 * 이 표의 존재 이유가 여기 있다. 실측 예:
 *
 *   GLM-4.6 / SWE-bench Verified
 *     · Z.ai 자체 스캐폴드 제출  → 68.20   (2025-09-30)
 *     · mini-SWE-agent 1.17.1    → 55.40   (2025-12-01)
 *                                  = 같은 모델, 12.8pt 차
 *   claude-haiku-4-5-20251001 / SWE-bench Verified
 *     · Anthropic 자체 스캐폴드  → 73.3    (2025-10-15)
 *     · mini-SWE-agent 2.0.0     → 66.60   (2026-02-17)
 *                                  = 같은 모델, 6.7pt 차
 *
 * 즉 "모델 A 가 B 보다 몇 점 높다" 는 **하네스를 고정하지 않으면 무의미**하다.
 * 그래서 스키마의 1급 필드가 `harness` 이고, 비교 헬퍼(`comparableRows`)는
 * 하네스 키가 같은 행끼리만 묶어준다.
 *
 * ── ★2026-07-26 조사 결과 요약(무엇이 비었나) ───────────────────────────
 *   · Claude(opus-5 / opus-4-8 / sonnet-5 / fable-5): 벤더 시스템카드에 SWE-bench
 *     Verified 있음. 단, **공식 리더보드(swebench.com)에는 한 줄도 없다** — 즉
 *     mini-SWE-agent 공통 하네스로 gpt 계열과 맞비교할 수단이 현재 없다.
 *   · gpt-5.5 / gpt-5.6-{sol,terra,luna}: OpenAI 는 **SWE-bench Pro 만** 공개하고
 *     Verified 는 공개하지 않는다. Anthropic Opus 4.8 시스템카드의 비교표도
 *     GPT-5.5 Verified 칸을 "-" 로 비워 뒀다(= 인용할 1차 출처가 없다).
 *   · claude-haiku-4-5-20251001: 우리 레지스트리 모델 중 **유일하게** 공식
 *     리더보드에 등재.
 *   · Kimi K2.7 Code: 벤더가 SWE-bench 를 아예 보고하지 않는다(자체 벤치로 이동).
 */

import { getModel, isKnownModelId } from "./model-registry";

/**
 * 벤치 식별자. SWE-bench 는 "하나의 벤치"가 아니라 **문제집합이 다른 4종**이라
 * 서로 절대 비교되면 안 된다(Verified 500 / Pro / Multilingual 300 / Multimodal).
 * 그래서 이름을 합치지 않고 각각 별개 값으로 둔다.
 */
export type BenchmarkId =
  | "swe-bench-verified"
  | "swe-bench-pro"
  | "swe-bench-multilingual"
  | "swe-bench-multimodal";

export const BENCHMARK_IDS: readonly BenchmarkId[] = [
  "swe-bench-verified",
  "swe-bench-pro",
  "swe-bench-multilingual",
  "swe-bench-multimodal",
] as const;

/**
 * 점수를 낸 **하네스(스캐폴드)**. 같은 모델이라도 이게 다르면 다른 실험이다.
 *
 * `version` 을 별 필드로 뺀 이유: mini-SWE-agent 는 1.17.1 → 2.0.0 사이에
 * 점수가 크게 움직였다(리더보드가 "older agent versions" 를 따로 접어두는 것도
 * 같은 이유다). 하네스 이름만으로는 그 차이를 표현할 수 없다.
 */
export interface BenchHarness {
  /** 하네스 이름. 벤더 내부 하네스는 "vendor-internal" 접두로 통일. */
  name: string;
  /** 하네스 버전(출처가 밝힌 경우만). 미공개면 undefined. */
  version?: string;
  /** 출처가 밝힌 실행 설정(effort/trials/temperature…). 밝히지 않은 건 적지 않는다. */
  config?: string;
}

/**
 * 출처를 **누가** 냈는가. 같은 URL 이어도 신뢰 성격이 다르다:
 *   · model-vendor    : 모델 제조사가 자기 모델 점수를 발표(자기보고)
 *   · benchmark-owner : 벤치 소유자의 공식 리더보드(제3자 채점)
 *   · rival-vendor    : ★경쟁사가 비교표에 올린 남의 모델 점수. 공식 발간물이긴
 *                       하나 1차 출처가 아니므로 별도 표기한다. 1차 출처가
 *                       나타나면 그 행으로 교체하는 것이 원칙.
 */
export type SourceKind = "model-vendor" | "benchmark-owner" | "rival-vendor";

export interface BenchRecord {
  /**
   * `kind: "registry"` → `model-registry.ts` 의 **구체 id**(alias 금지).
   * `kind: "reference"` → 우리 하네스에 아직 없는 벤더 후보의 벤더 표기 이름.
   */
  model: string;
  /** 라우팅 대상(registry)인가, 편입 검토용 후보(reference)인가. */
  kind: "registry" | "reference";
  benchmark: BenchmarkId;
  /**
   * 출처가 표기한 벤치 **버전/변형**. 표기가 없으면 `"unspecified"`.
   * (예: OpenAI 는 GPT-5.5 발표에선 "Public" 이라 적고 GPT-5.6 발표에선 안 적었다.
   *  그 차이가 두 발표의 58.6 vs 59.4 를 설명할 수도 있어 버리지 않는다.)
   */
  version: string;
  harness: BenchHarness;
  /** % resolved. ★공식 수치가 없으면 null — 추정으로 채우지 않는다. */
  score: number | null;
  source: string;
  sourceKind: SourceKind;
  /** 그 출처가 발간된 날(YYYY-MM-DD). */
  asOf: string;
  /** score=null 이면 필수(왜 비었는지). 그 외엔 선택. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 출처 상수 — 같은 URL 을 여러 행이 공유하므로 오타를 한 곳으로 모은다.
//
// ★재현 메모(openai.com / x.ai): 이 두 도메인은 헤드리스 클라이언트에 403 을
// 돌려준다. 그래서 수집은 **공식 URL 의 Wayback 스냅샷**을 읽어서 했다. 아래
// `source` 는 어디까지나 1차 출처(공식 URL)이고, 리뷰어가 같은 화면을 보려면:
//   · GPT-5.6  → https://web.archive.org/web/20260725095156/https://openai.com/index/gpt-5-6/
//   · GPT-5.5  → https://web.archive.org/web/20260723234206/https://openai.com/index/introducing-gpt-5-5/
//   · Grok 4.5 → https://web.archive.org/web/20260724214146/https://x.ai/news/grok-4-5
// 나머지 출처(Anthropic 시스템카드 PDF, swebench.com, z.ai, huggingface)는
// 직접 열려서 스냅샷을 쓰지 않았다.
// ─────────────────────────────────────────────────────────────────────────

const SRC = {
  opus5Card: "https://www.anthropic.com/claude-opus-5-system-card",
  opus48Card:
    "https://cdn.sanity.io/files/4zrzovbb/website/c886650a2e96fc0925c805a1a7ca77314ccbf4a6.pdf",
  sonnet5Card: "https://www.anthropic.com/claude-sonnet-5-system-card",
  fable5Card:
    "https://www-cdn.anthropic.com/2f9323abbcc4abe219577539efe19a623c9ca2bd/Claude%20Fable%205%20&%20Claude%20Mythos%205%20System%20Card.pdf",
  haiku45News: "https://www.anthropic.com/news/claude-haiku-4-5",
  openaiGpt56: "https://openai.com/index/gpt-5-6/",
  openaiGpt55: "https://openai.com/index/introducing-gpt-5-5/",
  swebenchVerified: "https://www.swebench.com/",
  zaiGlm47: "https://z.ai/blog/glm-4.7",
  xaiGrok45: "https://x.ai/news/grok-4-5",
  kimiK26Card: "https://huggingface.co/moonshotai/Kimi-K2.6",
  kimiK27CodeCard: "https://huggingface.co/moonshotai/Kimi-K2.7-Code",
} as const;

/**
 * Anthropic 시스템카드의 표준 실행설정(각 카드 Table 8.1.A 캡션 + §8.2).
 * 카드마다 문구가 같아서 상수로 뺀다.
 */
const ANTHROPIC_INTERNAL: BenchHarness = {
  name: "vendor-internal (Anthropic system-card standard config)",
  config: "adaptive thinking @ max effort, 기본 샘플링, 5 trials 평균",
};

/** swebench.com 공식 Verified 리더보드가 쓰는 공통 하네스. */
function miniSweAgent(version: string, config?: string): BenchHarness {
  return { name: "mini-SWE-agent", version, ...(config ? { config } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────
// 레지스트리 모델 (= 우리가 실제로 스폰하는 모델)
// ─────────────────────────────────────────────────────────────────────────

const REGISTRY_ROWS: BenchRecord[] = [
  // ── Claude / SWE-bench Verified (벤더 내부 하네스) ─────────────────────
  {
    model: "claude-opus-5",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 96.0,
    source: SRC.opus5Card,
    sourceKind: "model-vendor",
    asOf: "2026-07-24",
    note: "Claude Opus 5 System Card §8.2. 같은 절: Pro 79.2 / Multilingual 89.5 / Multimodal 59.4.",
  },
  {
    model: "claude-opus-4-8",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 88.6,
    source: SRC.opus48Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-28",
    note: "Claude Opus 4.8 System Card §8.2.",
  },
  {
    model: "claude-sonnet-5",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 85.2,
    source: SRC.sonnet5Card,
    sourceKind: "model-vendor",
    asOf: "2026-06-30",
    note: "Claude Sonnet 5 System Card §8.2.",
  },
  {
    model: "claude-fable-5",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 95.0,
    source: SRC.fable5Card,
    sourceKind: "model-vendor",
    asOf: "2026-06-09",
    note: "Claude Fable 5 & Mythos 5 System Card §8.2 (같은 절의 Mythos 5 는 95.5 — 별 모델이라 행을 만들지 않는다).",
  },
  {
    model: "claude-haiku-4-5-20251001",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: {
      name: "vendor-internal (Anthropic simple scaffold)",
      config:
        "bash + str-replace 파일편집 2개 툴, 50 trials 평균, test-time compute 없음",
    },
    score: 73.3,
    source: SRC.haiku45News,
    sourceKind: "model-vendor",
    asOf: "2025-10-15",
    note: "발표문 Methodology 절. ★Haiku 4.5 System Card 에는 RSP 용 hard subset(45문제) 36.6% 만 있고 500문제 Verified 는 없다 — 그건 다른 수치이므로 여기 섞지 않는다.",
  },

  // ── ★Claude / SWE-bench Verified (공식 리더보드 하네스) ────────────────
  // 우리 레지스트리 모델 중 유일하게 등재된 행. 위 73.3 과 **같은 모델·같은
  // 벤치**인데 6.7pt 낮다 — 하네스 축이 왜 1급 필드인지 보여주는 자리.
  {
    model: "claude-haiku-4-5-20251001",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: miniSweAgent("2.0.0", "high reasoning, Attempts=1"),
    score: 66.6,
    source: SRC.swebenchVerified,
    sourceKind: "benchmark-owner",
    asOf: "2026-02-17",
    note: '리더보드 행 태그 "Model: claude-haiku-4-5-20251001, Org: Anthropic, Mini: 2.0.0". 표기명은 "Claude 4.5 Haiku (high reasoning)".',
  },

  // ── ★빈 칸: Claude 신형은 공식 리더보드에 없다 ────────────────────────
  // 행을 지우지 않는 이유 = 규율 3. 이 4줄이 "gpt 계열과 공통 하네스로 맞비교할
  // 수단이 현재 없다" 는 사실을 표에 남긴다.
  ...(
    [
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-fable-5",
    ] as const
  ).map(
    (model): BenchRecord => ({
      model,
      kind: "registry",
      benchmark: "swe-bench-verified",
      version: "unspecified",
      harness: miniSweAgent("2.0.0"),
      score: null,
      source: SRC.swebenchVerified,
      sourceKind: "benchmark-owner",
      asOf: "2026-07-26",
      note: `no official number: swebench.com Verified 리더보드에 ${model} 제출 없음(2026-07-26 전수 확인 — Agent 필터 "All agents" + 구버전 포함, 행 data-tags 전수 대조).`,
    }),
  ),

  // ── Claude / 나머지 SWE-bench 변형 ────────────────────────────────────
  {
    model: "claude-opus-5",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 79.2,
    source: SRC.opus5Card,
    sourceKind: "model-vendor",
    asOf: "2026-07-24",
  },
  {
    model: "claude-opus-4-8",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 69.2,
    source: SRC.opus48Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-28",
  },
  {
    model: "claude-sonnet-5",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 63.2,
    source: SRC.sonnet5Card,
    sourceKind: "model-vendor",
    asOf: "2026-06-30",
  },
  {
    model: "claude-fable-5",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 80.0,
    source: SRC.fable5Card,
    sourceKind: "model-vendor",
    asOf: "2026-06-09",
  },
  {
    model: "claude-opus-5",
    kind: "registry",
    benchmark: "swe-bench-multilingual",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 89.5,
    source: SRC.opus5Card,
    sourceKind: "model-vendor",
    asOf: "2026-07-24",
  },
  {
    model: "claude-opus-4-8",
    kind: "registry",
    benchmark: "swe-bench-multilingual",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 84.4,
    source: SRC.opus48Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-28",
  },
  {
    model: "claude-sonnet-5",
    kind: "registry",
    benchmark: "swe-bench-multilingual",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 78.3,
    source: SRC.sonnet5Card,
    sourceKind: "model-vendor",
    asOf: "2026-06-30",
  },
  {
    model: "claude-fable-5",
    kind: "registry",
    benchmark: "swe-bench-multilingual",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 86.6,
    source: SRC.opus5Card,
    sourceKind: "model-vendor",
    asOf: "2026-07-24",
    note: "Fable 5 자체 카드(§8.2)는 Multilingual 을 Mythos 5 만 적었다. 이 값은 Opus 5 카드 Table 8.1.A 의 Fable 5 열 — 같은 벤더의 자기 모델 수치라 1차 출처다.",
  },
  {
    model: "claude-opus-5",
    kind: "registry",
    benchmark: "swe-bench-multimodal",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 59.4,
    source: SRC.opus5Card,
    sourceKind: "model-vendor",
    asOf: "2026-07-24",
  },
  {
    model: "claude-opus-4-8",
    kind: "registry",
    benchmark: "swe-bench-multimodal",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 38.4,
    source: SRC.opus48Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-28",
  },
  {
    model: "claude-sonnet-5",
    kind: "registry",
    benchmark: "swe-bench-multimodal",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 28.1,
    source: SRC.sonnet5Card,
    sourceKind: "model-vendor",
    asOf: "2026-06-30",
  },
  {
    model: "claude-fable-5",
    kind: "registry",
    benchmark: "swe-bench-multimodal",
    version: "unspecified",
    harness: ANTHROPIC_INTERNAL,
    score: 54.1,
    source: SRC.opus5Card,
    sourceKind: "model-vendor",
    asOf: "2026-07-24",
    note: "출처는 Multilingual 행과 같음(Opus 5 카드 Table 8.1.A 의 Fable 5 열).",
  },

  // ── ★gpt: OpenAI 는 Verified 를 공개하지 않는다 ────────────────────────
  // 네 모델 모두 같은 이유로 비어 있고, 그 사실이 이 표의 가장 중요한 발견이다:
  // 우리 fleet 의 두 축(claude/gpt)은 **같은 벤치로 비교된 적이 없다**.
  ...(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"] as const).map(
    (model): BenchRecord => ({
      model,
      kind: "registry",
      benchmark: "swe-bench-verified",
      version: "unspecified",
      harness: { name: "vendor-internal (OpenAI)" },
      score: null,
      source: SRC.openaiGpt56,
      sourceKind: "model-vendor",
      asOf: "2026-07-09",
      note: "no official number: OpenAI 공식 발표는 SWE-Bench **Pro** 만 싣고 Verified 는 싣지 않는다. Anthropic Opus 4.8 시스템카드의 비교표도 GPT-5.5 Verified 칸을 '-' 로 비워 두었다(= 인용 가능한 1차 출처 부재). swebench.com 공식 리더보드에도 gpt-5.5/5.6 제출 없음.",
    }),
  ),

  // ── gpt / SWE-bench Pro (OpenAI 1차 출처) ─────────────────────────────
  {
    model: "gpt-5.6-sol",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: { name: "vendor-internal (OpenAI)" },
    score: 64.6,
    source: SRC.openaiGpt56,
    sourceKind: "model-vendor",
    asOf: "2026-07-09",
    note: "GPT-5.6 GA 발표 Coding 표. Anthropic Opus 5 카드도 GPT 5.6 Sol 을 같은 64.6 으로 인용해 교차확인된다.",
  },
  {
    model: "gpt-5.6-terra",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: { name: "vendor-internal (OpenAI)" },
    score: 63.4,
    source: SRC.openaiGpt56,
    sourceKind: "model-vendor",
    asOf: "2026-07-09",
  },
  {
    model: "gpt-5.6-luna",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: { name: "vendor-internal (OpenAI)" },
    score: 62.7,
    source: SRC.openaiGpt56,
    sourceKind: "model-vendor",
    asOf: "2026-07-09",
  },
  {
    model: "gpt-5.5",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: { name: "vendor-internal (OpenAI)" },
    score: 59.4,
    source: SRC.openaiGpt56,
    sourceKind: "model-vendor",
    asOf: "2026-07-09",
    note: "★같은 모델을 OpenAI 가 두 번 발표했고 값이 다르다(아래 58.6 행). 재실행/버전 차이로 보이나 출처가 이유를 밝히지 않아 둘 다 남긴다.",
  },
  {
    model: "gpt-5.5",
    kind: "registry",
    benchmark: "swe-bench-pro",
    version: "Public",
    harness: { name: "vendor-internal (OpenAI)" },
    score: 58.6,
    source: SRC.openaiGpt55,
    sourceKind: "model-vendor",
    asOf: "2026-04-23",
    note: 'GPT-5.5 런치 발표. 표기가 "SWE-Bench Pro (Public)" 이고 각주로 "Labs have noted evidence of memorization on this eval" 를 달았다.',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// 참조행 — 우리 하네스에 아직 없는 벤더 후보(라우팅 대상 아님)
//
// db3qs0o6 벤더 서베이의 후보들. `kind: "reference"` 라 레지스트리 교차검증을
// 받지 않는 대신, **레지스트리에 있으면 안 된다**는 역방향 검증을 받는다.
// ─────────────────────────────────────────────────────────────────────────

const REFERENCE_ROWS: BenchRecord[] = [
  // ── Z.ai GLM ──────────────────────────────────────────────────────────
  {
    model: "GLM-4.7",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: {
      name: "vendor-internal (Z.ai)",
      config:
        "temperature 0.7, top-p 1.0, max new tokens 16384 (블로그 각주 2)",
    },
    score: 73.8,
    source: SRC.zaiGlm47,
    sourceKind: "model-vendor",
    asOf: "2025-12-22",
  },
  {
    model: "GLM-4.6",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: {
      name: "vendor-internal (Z.ai)",
      config:
        "temperature 0.7, top-p 1.0, max new tokens 16384 (블로그 각주 2)",
    },
    score: 68.0,
    source: SRC.zaiGlm47,
    sourceKind: "model-vendor",
    asOf: "2025-12-22",
    note: "GLM-4.7 블로그 비교표의 GLM-4.6 열. GLM-4.6 자체 블로그(z.ai/blog/glm-4.6)에는 SWE-bench 수치가 없다.",
  },
  {
    model: "GLM-4.6",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: { name: "vendor scaffold (Z.ai 제출)", config: "Attempts=1" },
    score: 68.2,
    source: SRC.swebenchVerified,
    sourceKind: "benchmark-owner",
    asOf: "2025-09-30",
    note: '리더보드 표기명 "GLM-4.6", Org: Z.ai. 벤더 자체 하네스로 제출한 행.',
  },
  {
    model: "GLM-4.6",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: miniSweAgent("1.17.1", "T=1, Attempts=1"),
    score: 55.4,
    source: SRC.swebenchVerified,
    sourceKind: "benchmark-owner",
    asOf: "2025-12-01",
    note: '★같은 GLM-4.6 인데 벤더 스캐폴드(68.2) 대비 12.8pt 낮다. 리더보드 표기명 "mini-SWE-agent + GLM-4.6 (T=1)".',
  },

  // ── xAI Grok ──────────────────────────────────────────────────────────
  {
    model: "Grok 4.5",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: { name: "vendor-internal (xAI)" },
    score: null,
    source: SRC.xaiGrok45,
    sourceKind: "model-vendor",
    asOf: "2026-07-16",
    note: "no official number: Grok 4.5 발표는 SWE Bench Pro / DeepSWE / SWE Marathon / Terminal-Bench 만 싣고 Verified 는 없다. swebench.com 리더보드에도 Grok 항목 자체가 없다.",
  },
  {
    model: "Grok 4.5",
    kind: "reference",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: { name: "vendor-internal (xAI)" },
    score: 64.7,
    source: SRC.xaiGrok45,
    sourceKind: "model-vendor",
    asOf: "2026-07-16",
    note: "발표문 SWE Bench Pro resolve rate.",
  },

  // ── Moonshot Kimi ─────────────────────────────────────────────────────
  {
    model: "Kimi K2.7 Code",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: { name: "vendor-internal (Moonshot, Kimi Code CLI)" },
    score: null,
    source: SRC.kimiK27CodeCard,
    sourceKind: "model-vendor",
    asOf: "2026-06-15",
    note: "no official number: 공식 모델카드가 SWE-bench 를 아예 보고하지 않는다(자체 Kimi Code Bench v2 / Program Bench / MLS-Bench Lite / Kimi Claw 24/7 Bench 로 대체). 아래 베이스 모델 K2.6 행이 그나마 가까운 대용.",
  },
  {
    model: "Kimi K2.6",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: {
      name: "vendor-internal (Moonshot, SWE-agent 파생)",
      config:
        "in-house 프레임워크(bash/createfile/insert/view/strreplace/submit 6툴), thinking mode, temp 1.0 top-p 0.95",
    },
    score: 80.2,
    source: SRC.kimiK26Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-19",
    note: "Kimi K2.7 Code 의 베이스 모델. 같은 카드: Pro 58.6 / Multilingual 76.7.",
  },
  {
    model: "Kimi K2.6",
    kind: "reference",
    benchmark: "swe-bench-pro",
    version: "unspecified",
    harness: { name: "vendor-internal (Moonshot, SWE-agent 파생)" },
    score: 58.6,
    source: SRC.kimiK26Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-19",
  },
  {
    model: "Kimi K2.6",
    kind: "reference",
    benchmark: "swe-bench-multilingual",
    version: "unspecified",
    harness: { name: "vendor-internal (Moonshot, SWE-agent 파생)" },
    score: 76.7,
    source: SRC.kimiK26Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-19",
  },
  {
    model: "Kimi K2.5",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: { name: "vendor-internal (Moonshot, SWE-agent 파생)" },
    score: 76.8,
    source: SRC.kimiK26Card,
    sourceKind: "model-vendor",
    asOf: "2026-05-19",
    note: "K2.6 카드 비교표의 K2.5 열.",
  },
  {
    model: "Kimi K2.5",
    kind: "reference",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: miniSweAgent("2.0.0", "high reasoning, Attempts=1"),
    score: 70.8,
    source: SRC.swebenchVerified,
    sourceKind: "benchmark-owner",
    asOf: "2026-02-17",
    note: '리더보드 태그 "Model: kimi-k2.5, Org: Moonshot AI, Mini: 2.0.0". 벤더 자체 하네스(76.8) 대비 6.0pt 낮다.',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// 검증 — 모듈 로드 시점에 돈다. 어긋난 행은 앱을 못 뜨게 한다.
// (model-ladder.ts 와 같은 철학: 날조된 칸이 조용히 사는 것보다 부팅 실패가 낫다.)
// ─────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function label(rec: BenchRecord, i: number): string {
  return `#${i} ${rec.model}/${rec.benchmark}/${harnessKey(rec.harness)}`;
}

/**
 * 행 묶음을 검증한다. 위반이면 **throw** — 통과하면 입력을 그대로 돌려준다.
 *
 * export 하는 이유: 이 규율은 "지금 데이터가 깨끗하다" 가 아니라 "더러운 행이
 * 들어오면 죽는다" 는 것이고, 후자는 실제로 더러운 행을 넣어 봐야만 증명된다.
 * 테스트가 위조 행으로 각 가드를 두드릴 수 있게 열어 둔다.
 */
export function validateBenchRecords(
  rows: readonly BenchRecord[],
): readonly BenchRecord[] {
  rows.forEach((rec, i) => {
    const at = label(rec, i);

    // ── 출처 URL 필수 ───────────────────────────────────────────────────
    if (!/^https?:\/\/\S+$/.test(rec.source)) {
      throw new Error(
        `[model-bench-reference] ${at}: source 가 URL 이 아닙니다("${rec.source}"). ` +
          "출처 없는 수치는 담지 않는다 — score=null 인 행도 '여기까지 찾아봤다'는 URL 이 필요하다.",
      );
    }

    // ── model 교차검증 ──────────────────────────────────────────────────
    if (rec.kind === "registry") {
      const entry = getModel(rec.model);
      if (!entry) {
        throw new Error(
          `[model-bench-reference] ${at}: 레지스트리에 없는 모델 id "${rec.model}". ` +
            "라우팅 대상이면 model-registry.ts 에 CLI-verified 행을 먼저 추가하고, " +
            '아직 편입 전 후보면 kind: "reference" 로 적으세요.',
        );
      }
      if (!isKnownModelId(rec.model)) {
        throw new Error(
          `[model-bench-reference] ${at}: "${rec.model}" 은 alias 입니다(→ ${entry.id}). ` +
            "벤치 행은 구체 id 만 쓴다 — alias 는 CLI 가 뜻을 바꾸는 이동표적이라 " +
            "점수와 모델의 대응이 조용히 어긋난다.",
        );
      }
    } else if (isKnownModelId(rec.model)) {
      throw new Error(
        `[model-bench-reference] ${at}: "${rec.model}" 은 레지스트리에 있는 모델인데 ` +
          'kind: "reference" 로 적혀 있습니다. 라우팅 대상이면 "registry" 로 고치세요.',
      );
    }

    // ── 점수 ────────────────────────────────────────────────────────────
    if (rec.score === null) {
      if (!rec.note || !rec.note.includes("no official number")) {
        throw new Error(
          `[model-bench-reference] ${at}: score=null 인 행은 note 에 ` +
            '"no official number" 와 왜 비었는지를 남겨야 합니다.',
        );
      }
    } else if (
      !Number.isFinite(rec.score) ||
      rec.score < 0 ||
      rec.score > 100
    ) {
      throw new Error(
        `[model-bench-reference] ${at}: score ${rec.score} 가 % 범위(0..100) 밖입니다.`,
      );
    }

    // ── 나머지 ──────────────────────────────────────────────────────────
    if (!BENCHMARK_IDS.includes(rec.benchmark)) {
      throw new Error(
        `[model-bench-reference] ${at}: 알 수 없는 benchmark "${rec.benchmark}".`,
      );
    }
    if (!rec.version.trim()) {
      throw new Error(
        `[model-bench-reference] ${at}: version 이 비었습니다(표기가 없으면 "unspecified").`,
      );
    }
    if (!rec.harness.name.trim()) {
      throw new Error(
        `[model-bench-reference] ${at}: harness.name 이 비었습니다.`,
      );
    }
    if (!ISO_DATE.test(rec.asOf)) {
      throw new Error(
        `[model-bench-reference] ${at}: asOf "${rec.asOf}" 가 YYYY-MM-DD 가 아닙니다.`,
      );
    }
  });

  // ── 중복 방지 ─────────────────────────────────────────────────────────
  // (model, benchmark, harness, version, source) 가 같은 행이 둘이면 둘 중
  // 하나는 오타이거나 붙여넣기 사고다. 서로 다른 실험이면 하네스나 출처가
  // 반드시 다르므로 이 키로 걸러진다.
  const seen = new Map<string, number>();
  rows.forEach((rec, i) => {
    const key = [
      rec.model,
      rec.benchmark,
      rec.version,
      harnessKey(rec.harness),
      rec.source,
    ].join("|");
    const prev = seen.get(key);
    if (prev !== undefined) {
      throw new Error(
        `[model-bench-reference] ${label(rec, i)}: 같은 (model,benchmark,version,harness,source) 행이 ` +
          `#${prev} 에 이미 있습니다. 다른 실험이면 harness 나 출처가 달라야 합니다.`,
      );
    }
    seen.set(key, i);
  });

  return rows;
}

/** 하네스 동일성 키 — 이게 같은 행끼리만 점수를 비교해도 된다. */
export function harnessKey(h: BenchHarness): string {
  return h.version ? `${h.name}@${h.version}` : h.name;
}

/** 전체 참조표(레지스트리 행 + 후보 참조행). 로드 시점에 검증을 통과한 것만. */
export const BENCH_REFERENCE: readonly BenchRecord[] = validateBenchRecords([
  ...REGISTRY_ROWS,
  ...REFERENCE_ROWS,
]);

// ─────────────────────────────────────────────────────────────────────────
// 조회 API
// ─────────────────────────────────────────────────────────────────────────

export function benchRowsForModel(model: string): BenchRecord[] {
  return BENCH_REFERENCE.filter((r) => r.model === model);
}

export function benchRowsFor(
  benchmark: BenchmarkId,
  opts: { kind?: BenchRecord["kind"]; scoredOnly?: boolean } = {},
): BenchRecord[] {
  return BENCH_REFERENCE.filter(
    (r) =>
      r.benchmark === benchmark &&
      (opts.kind ? r.kind === opts.kind : true) &&
      (opts.scoredOnly ? r.score !== null : true),
  );
}

/**
 * **하네스가 같아서 실제로 비교해도 되는** 행들만. 이 함수를 거치지 않은
 * 비교("A 가 B 보다 높다")는 대부분 서로 다른 스캐폴드를 견주는 착시다.
 */
export function comparableRows(
  benchmark: BenchmarkId,
  harness: string,
): BenchRecord[] {
  return BENCH_REFERENCE.filter(
    (r) =>
      r.benchmark === benchmark &&
      harnessKey(r.harness) === harness &&
      r.score !== null,
  ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** 공식 수치가 없어 비어 있는 칸들 — 런북/보고가 "무엇이 미확인인지" 를 물을 때. */
export function missingCells(): BenchRecord[] {
  return BENCH_REFERENCE.filter((r) => r.score === null);
}

/** 사람이 읽는 표. 하네스별로 묶어서 낸다(섞어 읽는 사고를 구조로 막는다). */
export function formatBenchTable(benchmark: BenchmarkId): string {
  const rows = benchRowsFor(benchmark);
  if (rows.length === 0) return `${benchmark}: 참조 행 없음.`;
  const byHarness = new Map<string, BenchRecord[]>();
  for (const r of rows) {
    const k = harnessKey(r.harness);
    byHarness.set(k, [...(byHarness.get(k) ?? []), r]);
  }
  const blocks = [...byHarness.entries()].map(([k, list]) => {
    const lines = [...list]
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .map((r) => {
        const score = r.score === null ? "— (공식수치 없음)" : `${r.score}%`;
        const tag = r.kind === "reference" ? " [참조]" : "";
        return `    ${r.model}${tag}: ${score}  (${r.asOf}, ${r.source})`;
      });
    return [`  하네스 ${k}`, ...lines].join("\n");
  });
  return [`${benchmark}`, ...blocks].join("\n");
}
