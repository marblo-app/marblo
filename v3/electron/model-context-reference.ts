/**
 * 모델 **컨텍스트 윈도우 참조표** — 출처가 붙은 공개 사실.
 *
 * ── 왜 레지스트리에 필드로 넣지 않았나 ──────────────────────────────────
 * `model-registry.ts` 의 `verified` 는 **CLI 프로브**의 이력이다("이 id 를 이
 * 바이너리로 실제로 불러봤다"). 컨텍스트 윈도우는 CLI 가 알려주지 않는 값이라
 * 출처가 다르다(벤더 문서 크롤). 두 성격을 한 행에 섞으면 `verified` 가 무엇을
 * 주장하는지 흐려지므로, `model-bench-reference.ts`(공개 벤치 점수)와 **같은
 * 모양의 사이드카**로 뺀다: 행마다 자기 출처 URL 과 관측일을 갖는다.
 *
 * ── 규율(bench 참조표와 동일) ───────────────────────────────────────────
 * 1. **날조·추정 금지.** 모든 숫자는 벤더 1차 문서에서 눈으로 읽은 값이다.
 *    못 찾은 모델은 행을 지우는 게 아니라 `tokens: null` + `note` 로 남긴다 —
 *    "안 찾아봤다" 와 "찾았는데 없다" 가 구분되지 않으면 다음 사람이 같은 곳을
 *    다시 뒤진다.
 * 2. **출처 URL 필수.** `tokens: null` 인 행도 예외가 아니다(음성 증거).
 * 3. **model id 는 레지스트리 구체 id.** alias 금지, 미등록 id 금지 —
 *    어긋나면 모듈 로드 시점에 throw 한다(model-bench-reference 와 같은 철학:
 *    날조된 칸이 조용히 사는 것보다 부팅 실패가 낫다).
 *
 * ── ★"컨텍스트 윈도우" 가 한 숫자가 아닌 경우 ──────────────────────────
 * 벤더가 플랜·구독 등급에 따라 다른 창을 주는 경우가 실재한다(Kimi Code: 상위
 * 멤버십만 1M). 그런 행은 상한을 적고 `note` 에 조건을 남긴다 — 우리 스폰이
 * 실제로 받는 창은 계정 등급에 달렸고, 이 표는 그걸 알 수 없다.
 *
 * ★이 표도 라우팅 입력이 **아니다**. 사람이 "이 모델 창이 얼마지?" 를 물을 때
 * 출처가 붙은 숫자를 돌려주는 용도다(사용량 탭 모델 정보표).
 */

import { getModel, isKnownModelId, MODEL_REGISTRY } from "./model-registry";

export interface ContextWindowRecord {
  /** `model-registry.ts` 의 **구체 id**(alias 금지). */
  model: string;
  /**
   * 컨텍스트 윈도우(토큰). 공식 수치를 못 찾았으면 **null** — 추정으로 채우지
   * 않는다.
   */
  tokens: number | null;
  /** 최대 출력 토큰(출처가 같은 화면에 밝힌 경우만). 모르면 undefined. */
  maxOutputTokens?: number;
  /** 1차 출처 URL. */
  source: string;
  /** 그 화면을 읽은 날(YYYY-MM-DD). */
  asOf: string;
  /** tokens=null 이면 필수. 그 외엔 조건·단서(플랜 종속 등)를 적는다. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 출처 상수 — 같은 URL 을 여러 행이 공유하므로 오타를 한 곳으로 모은다.
// 전부 2026-07-27 gstack /browse 로 직접 열어 표를 읽었다.
// ─────────────────────────────────────────────────────────────────────────

const SRC = {
  /** Anthropic 공식 모델 비교표(Context window 행). */
  anthropicModels:
    "https://docs.claude.com/en/docs/about-claude/models/overview",
  /** Opus 4.8 은 현행 비교표에서 빠졌고, 이 문서가 "Opus 5 와 같은 1M" 이라 적는다. */
  anthropicMigration:
    "https://platform.claude.com/docs/en/about-claude/models/migration-guide",
  /** OpenAI 모델 카드(모델마다 "N context window / M max output tokens" 를 적는다). */
  openaiModel: (id: string) => `https://platform.openai.com/docs/models/${id}`,
  xaiModels: "https://docs.x.ai/docs/models",
  zaiGlm52: "https://docs.z.ai/guides/llm/glm-5.2",
  zaiGlm47: "https://docs.z.ai/guides/llm/glm-4.7",
  /** ★우리가 실제로 붙는 엔드포인트의 문서. Context Window 열이 여기 있다. */
  minimaxAnthropic:
    "https://platform.minimax.io/docs/api-reference/text-anthropic-api",
  kimiCodeModels: "https://www.kimi.com/code/docs/en/kimi-code/models.html",
} as const;

/** 이 표 전체를 수집한 날. 행마다 반복하지 않으려고 상수로 뺀다. */
const CRAWLED = "2026-07-27";

const RECORDS: ContextWindowRecord[] = [
  // ── Anthropic ─────────────────────────────────────────────────────────
  {
    model: "claude-fable-5",
    tokens: 1_000_000,
    maxOutputTokens: 128_000,
    source: SRC.anthropicModels,
    asOf: CRAWLED,
  },
  {
    model: "claude-opus-5",
    tokens: 1_000_000,
    maxOutputTokens: 128_000,
    source: SRC.anthropicModels,
    asOf: CRAWLED,
  },
  {
    model: "claude-opus-4-8",
    tokens: 1_000_000,
    maxOutputTokens: 128_000,
    source: SRC.anthropicMigration,
    asOf: CRAWLED,
    note: '현행 모델 비교표에는 4.8 열이 없다. 이 문서가 "Claude Opus 5 supports the same set of features as Claude Opus 4.8, including the 1M token context window (the default, with no beta header), 128k max output tokens" 라고 적는다.',
  },
  {
    model: "claude-sonnet-5",
    tokens: 1_000_000,
    maxOutputTokens: 128_000,
    source: SRC.anthropicModels,
    asOf: CRAWLED,
  },
  {
    model: "claude-haiku-4-5-20251001",
    tokens: 200_000,
    maxOutputTokens: 64_000,
    source: SRC.anthropicModels,
    asOf: CRAWLED,
  },

  // ── OpenAI ────────────────────────────────────────────────────────────
  // ★1,050,000 은 반올림한 "1M" 이 아니라 문서가 그대로 적는 값이다. 우리가
  // 1M 으로 접으면 5만 토큰이 조용히 사라지므로 원문 숫자를 그대로 둔다.
  {
    model: "gpt-5.6-sol",
    tokens: 1_050_000,
    maxOutputTokens: 128_000,
    source: SRC.openaiModel("gpt-5.6-sol"),
    asOf: CRAWLED,
    note: "같은 화면 각주: 입력 272K 초과 프롬프트는 input 2배 / output 1.5배 과금(우리 단가표엔 그 축이 없다).",
  },
  {
    model: "gpt-5.6-terra",
    tokens: 1_050_000,
    maxOutputTokens: 128_000,
    source: SRC.openaiModel("gpt-5.6-terra"),
    asOf: CRAWLED,
  },
  {
    model: "gpt-5.6-luna",
    tokens: 1_050_000,
    maxOutputTokens: 128_000,
    source: SRC.openaiModel("gpt-5.6-luna"),
    asOf: CRAWLED,
  },
  {
    model: "gpt-5.5",
    tokens: 1_050_000,
    maxOutputTokens: 128_000,
    source: SRC.openaiModel("gpt-5.5"),
    asOf: CRAWLED,
  },
  {
    model: "gpt-5.4",
    tokens: 1_050_000,
    maxOutputTokens: 128_000,
    source: SRC.openaiModel("gpt-5.4"),
    asOf: CRAWLED,
  },
  {
    model: "gpt-5.4-mini",
    tokens: 400_000,
    maxOutputTokens: 128_000,
    source: SRC.openaiModel("gpt-5.4-mini"),
    asOf: CRAWLED,
  },

  // ── xAI ───────────────────────────────────────────────────────────────
  {
    model: "grok-4.5",
    tokens: 500_000,
    source: SRC.xaiModels,
    asOf: CRAWLED,
    note: '공식 모델 목록의 grok-4.5 카드가 "Context 500k tokens" 로 적는다(같은 카드의 단가 $2.00/$6.00 은 우리 레지스트리 값과 일치).',
  },

  // ── Z.ai GLM ──────────────────────────────────────────────────────────
  {
    model: "glm-5.2",
    tokens: 1_000_000,
    maxOutputTokens: 128_000,
    source: SRC.zaiGlm52,
    asOf: CRAWLED,
    note: "★우리 스폰은 `glm-5.2`(대괄호 없는 평문 id)라 실제로 받는 창은 벤더 기본값이다. 문서가 요구하는 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 을 우리 envProfile 이 얹지 않으므로, claude CLI 는 자기 기본 임계에서 더 일찍 compact 한다(레지스트리 glm-5.2 행 주석 참조).",
  },
  {
    model: "glm-4.7",
    tokens: 200_000,
    maxOutputTokens: 128_000,
    source: SRC.zaiGlm47,
    asOf: CRAWLED,
  },

  // ── MiniMax ───────────────────────────────────────────────────────────
  {
    model: "MiniMax-M3",
    tokens: 1_000_000,
    source: SRC.minimaxAnthropic,
    asOf: CRAWLED,
    note: "Anthropic 호환 API 문서의 Context Window 열(= 우리가 실제로 붙는 엔드포인트). glm-5.2 와 같은 단서: 우리는 `[1m]` 표기와 그 짝 env 를 쓰지 않는다.",
  },
  {
    model: "MiniMax-M2.7",
    tokens: 204_800,
    source: SRC.minimaxAnthropic,
    asOf: CRAWLED,
    note: '문서가 200k 로 반올림하지 않고 204,800 으로 적는다("200k" 는 목록 페이지의 표기).',
  },

  // ── Moonshot Kimi Code ────────────────────────────────────────────────
  {
    model: "k3",
    tokens: 1_000_000,
    source: SRC.kimiCodeModels,
    asOf: CRAWLED,
    note: '★플랜 종속이다. 모델 스펙표가 "Up to 1M (for higher-tier members)" / "1M context for Allegretto and above" 라고 적는다 — 하위 플랜 계정이면 실제 창은 더 작다. 여기 값은 상한.',
  },
  {
    model: "k3-256k",
    tokens: 256_000,
    source: SRC.kimiCodeModels,
    asOf: CRAWLED,
    note: '스펙표 표기는 "256k only". 정확한 토큰수(262,144 여부)는 문서가 밝히지 않아 표기 그대로 256,000 으로 적는다.',
  },
  {
    model: "kimi-for-coding",
    tokens: 256_000,
    source: SRC.kimiCodeModels,
    asOf: CRAWLED,
    note: 'K2.7 Code 열의 "256k". k3-256k 와 같은 표기 단서.',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// 검증 — 모듈 로드 시점에 돈다.
// ─────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 행 묶음을 검증한다. 위반이면 **throw** — 통과하면 입력을 그대로 돌려준다.
 * (export 하는 이유는 bench 참조표와 같다: 테스트가 위조 행으로 가드를 두드릴
 * 수 있어야 "더러운 행이 들어오면 죽는다" 가 증명된다.)
 */
export function validateContextRecords(
  rows: readonly ContextWindowRecord[],
): readonly ContextWindowRecord[] {
  const seen = new Set<string>();
  rows.forEach((rec, i) => {
    const at = `#${i} ${rec.model}`;

    if (!/^https?:\/\/\S+$/.test(rec.source)) {
      throw new Error(
        `[model-context-reference] ${at}: source 가 URL 이 아닙니다("${rec.source}"). ` +
          "출처 없는 수치는 담지 않는다 — tokens=null 인 행도 '여기까지 찾아봤다'는 URL 이 필요하다.",
      );
    }
    if (!getModel(rec.model)) {
      throw new Error(
        `[model-context-reference] ${at}: 레지스트리에 없는 모델 id 입니다. ` +
          "model-registry.ts 에 행을 먼저 추가하세요.",
      );
    }
    if (!isKnownModelId(rec.model)) {
      throw new Error(
        `[model-context-reference] ${at}: alias 입니다(→ ${getModel(rec.model)?.id}). ` +
          "컨텍스트 행은 구체 id 만 쓴다 — alias 는 CLI 가 뜻을 바꾸는 이동표적이다.",
      );
    }
    if (seen.has(rec.model)) {
      throw new Error(
        `[model-context-reference] ${at}: 같은 모델의 행이 이미 있습니다. ` +
          "컨텍스트 창은 모델당 한 값이므로 행이 둘이면 하나는 붙여넣기 사고다.",
      );
    }
    seen.add(rec.model);

    if (rec.tokens === null) {
      if (!rec.note || !rec.note.includes("no official number")) {
        throw new Error(
          `[model-context-reference] ${at}: tokens=null 인 행은 note 에 ` +
            '"no official number" 와 왜 비었는지를 남겨야 합니다.',
        );
      }
    } else if (!Number.isInteger(rec.tokens) || rec.tokens <= 0) {
      throw new Error(
        `[model-context-reference] ${at}: tokens ${rec.tokens} 가 양의 정수가 아닙니다.`,
      );
    }
    if (
      rec.maxOutputTokens !== undefined &&
      (!Number.isInteger(rec.maxOutputTokens) || rec.maxOutputTokens <= 0)
    ) {
      throw new Error(
        `[model-context-reference] ${at}: maxOutputTokens ${rec.maxOutputTokens} 가 양의 정수가 아닙니다.`,
      );
    }
    if (!ISO_DATE.test(rec.asOf)) {
      throw new Error(
        `[model-context-reference] ${at}: asOf "${rec.asOf}" 가 YYYY-MM-DD 가 아닙니다.`,
      );
    }
  });
  return rows;
}

/** 전체 참조표. 로드 시점에 검증을 통과한 것만. */
export const CONTEXT_REFERENCE: readonly ContextWindowRecord[] =
  validateContextRecords(RECORDS);

const BY_MODEL = new Map<string, ContextWindowRecord>(
  CONTEXT_REFERENCE.map((r) => [r.model.trim().toLowerCase(), r]),
);

/**
 * 이 모델의 컨텍스트 창 행. **모르는 모델은 undefined** — 호출자가 "확인 필요"
 * 로 그린다. 여기서 0 이나 기본값을 지어내면 그 순간 표가 거짓말을 한다.
 */
export function contextRecordFor(
  idOrAlias: string,
): ContextWindowRecord | undefined {
  const entry = getModel(idOrAlias);
  if (!entry) return undefined;
  return BY_MODEL.get(entry.id.trim().toLowerCase());
}

/** 아직 컨텍스트 행이 없는 활성 레지스트리 모델 id — 런북이 "다음에 뭘 찾아야 하나" 를 물을 때. */
export function modelsMissingContext(): string[] {
  return MODEL_REGISTRY.filter(
    (m) => m.status === "active" && !BY_MODEL.has(m.id.trim().toLowerCase()),
  ).map((m) => m.id);
}
