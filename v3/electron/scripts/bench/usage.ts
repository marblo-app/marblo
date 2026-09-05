/**
 * 토큰·비용 계측 — 라운드3 에서 추가된 **축**.
 *
 * ★왜 이걸 붙이는가(진단이 시킨 것이지 있으면 좋아서가 아니다).
 *
 * 라운드2 실측에서 frontier 10셀의 resolved 는 9~12/12 안에 전부 몰렸다
 * (표준편차 1.02문제, 12문제 중 7문제는 전원 정답 = 죽은 문제). 즉 **resolved
 * 한 축만으로는 모델이 안 갈린다.** 반면 같은 런의 소요시간은 61s~226s 로
 * 이미 3.7배 벌어져 있었다. 시간이 벌어진다는 것은 **일량이 벌어진다**는 뜻이고,
 * 일량은 토큰으로 직접 잰다.
 *
 * 그리고 이 축이 없으면 원래 질문에 답이 안 된다 — 두 신형(claude-fable-5-1,
 * gpt-6-astra)은 **단가가 $10/$50 로 같다.** 같은 값일 때 무엇이 더 나은가는
 * "몇 개 풀었나" 가 아니라 "몇 개를 얼마에 풀었나" 로만 답할 수 있다.
 *
 * ---
 *
 * ★정직성 문제 하나 — 두 CLI 가 같은 단어로 다른 것을 센다.
 *
 * 두 벤더의 usage 스키마는 **입력 토큰의 포함관계가 서로 반대**다:
 *
 *   claude(`--output-format json`):
 *     input_tokens / cache_read_input_tokens / cache_creation_input_tokens
 *     → 셋이 **서로소(disjoint)**. 총 입력 = 셋의 합.
 *
 *   codex(`--json` `turn.completed`):
 *     input_tokens / cached_input_tokens / cache_write_input_tokens
 *     → cached 와 cache_write 는 input_tokens 의 **부분집합**. 총 입력 = input_tokens.
 *
 * 이 차이를 무시하고 그냥 더하면 claude 는 정상, codex 는 캐시분을 **두 번**
 * 세어 입력이 부풀고, 그 상태로 "누가 더 싼가" 를 발표하게 된다. 그래서 여기서
 * 한 번 **정규화**하고, 정규화 규칙을 이 파일에 못박고 단위테스트로 고정한다.
 *
 * 출력 쪽도 같은 함정이 있다 — 양쪽 다 추론(thinking/reasoning) 토큰은
 * output_tokens 의 **부분집합**이다. 따로 더하지 않는다.
 *
 * ---
 *
 * ★비용을 두 개 적는 이유.
 *
 *   1. `vendorCostUsd` — claude 가 스스로 적어 준 실제 청구액(`total_cost_usd`).
 *      캐시 할인·티어가 반영된 진짜 값이지만 **codex 는 이걸 안 준다.**
 *   2. `listCostUsd` — 양쪽 모두에 **같은 공식**을 적용한 정가 환산액(리포트에서 계산).
 *
 * 1번끼리는 벤더 간 비교가 불가능하고(한쪽만 존재), 2번은 캐시 할인을 무시하므로
 * 절대액이 과대평가된다. 대신 2번은 **양쪽에 동일한 자**라서 상대 비교가 성립한다.
 * 그래서 리포트는 2번을 비교축으로 쓰고 1번은 대조로만 보인다. ★둘을 한 칸에
 * 섞지 않는다 — 섞는 순간 "캐시 할인 받은 쪽이 싸 보이는" 가짜 우위가 생긴다.
 */

/**
 * 벤더 스키마를 정규화한 1회 실행의 사용량.
 *
 * ★모든 필드는 "이 축이 무엇을 세는가" 가 벤더와 무관하게 같아야 한다.
 * 벤더 원문 필드명을 그대로 쓰지 않는 것은 그래서다.
 */
export interface AgentUsage {
  /** ★총 입력 토큰(캐시 읽기·쓰기 **포함**). 벤더 간 비교의 기준 축. */
  totalInputTokens: number;
  /** 그중 캐시에서 읽은 분. 청구 단가가 낮은 구간이라 따로 남긴다. */
  cachedInputTokens: number;
  /** 그중 캐시에 쓴 분(claude 만 별도 청구. codex 는 0 으로 오는 일이 많다). */
  cacheWriteInputTokens: number;
  /** 총 출력 토큰. ★추론 토큰을 **포함**한다(부분집합이므로 더하지 않는다). */
  outputTokens: number;
  /** 그중 추론(thinking/reasoning) 분. 진단용. */
  reasoningTokens: number;
  /**
   * 벤더가 스스로 적어 준 청구액(USD). claude 만 준다. codex 는 null.
   * ★이 값은 벤더 간 비교에 쓰지 않는다 — 한쪽에만 존재하기 때문이다.
   */
  vendorCostUsd: number | null;
  /** 어느 파서가 만든 값인지. 리포트가 근거를 표시하는 데 쓴다. */
  source: "claude-json" | "codex-json";
}

/** 단가표 1행. `model-registry.ts` 의 `pricing` 과 같은 단위(USD per 1M tokens). */
export interface BenchRate {
  inputPer1M: number;
  outputPer1M: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * claude `-p --output-format json` 의 결과 객체에서 사용량을 뽑는다.
 *
 * stdout 마지막 줄이 결과 JSON 이지만, CLI 가 앞에 다른 줄을 찍는 경우가 있어
 * **뒤에서부터** JSON 으로 파싱되는 줄을 찾는다. 못 찾으면 null — ★추측해서
 * 0 을 채우지 않는다. 0 을 채우면 "공짜로 풀었다" 는 거짓이 표에 박힌다.
 */
export function parseClaudeUsage(stdout: string): AgentUsage | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const details = usage.output_tokens_details as
      | Record<string, unknown>
      | undefined;
    // ★claude 는 셋이 서로소다 — 그래서 더해야 총 입력이 된다.
    const input = num(usage.input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    const cost = obj.total_cost_usd;
    return {
      totalInputTokens: input + cacheRead + cacheWrite,
      cachedInputTokens: cacheRead,
      cacheWriteInputTokens: cacheWrite,
      outputTokens: num(usage.output_tokens),
      reasoningTokens: num(details?.thinking_tokens),
      vendorCostUsd:
        typeof cost === "number" && Number.isFinite(cost) ? cost : null,
      source: "claude-json",
    };
  }
  return null;
}

/**
 * codex `exec --json` 의 `turn.completed` 이벤트에서 사용량을 뽑는다.
 *
 * `codex exec` 는 도구를 여러 번 써도 **turn.completed 를 1회만** 찍는다(실측:
 * codex-cli 0.153.3, 파일 생성+읽기 태스크에서 1회). 그래도 합산 루프로 두는
 * 것은 방어다 — 미래 버전이 턴을 쪼개도 총량이 유지된다.
 *
 * ★codex 는 cached 가 input 의 **부분집합**이다. 그래서 더하지 않는다.
 */
export function parseCodexUsage(stdout: string): AgentUsage | null {
  let seen = false;
  let totalInput = 0;
  let cached = 0;
  let cacheWrite = 0;
  let output = 0;
  let reasoning = 0;
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type !== "turn.completed") continue;
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    seen = true;
    // ★input_tokens 가 이미 총량이다. cached/cache_write 를 더하면 이중계산.
    totalInput += num(usage.input_tokens);
    cached += num(usage.cached_input_tokens);
    cacheWrite += num(usage.cache_write_input_tokens);
    output += num(usage.output_tokens);
    reasoning += num(usage.reasoning_output_tokens);
  }
  if (!seen) return null;
  return {
    totalInputTokens: totalInput,
    cachedInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: reasoning,
    // ★codex 는 청구액을 안 준다. 지어내지 않는다.
    vendorCostUsd: null,
    source: "codex-json",
  };
}

/**
 * 정가 환산 비용(USD). ★양쪽 벤더에 **같은 공식**을 적용하는 것이 요점이다.
 *
 * 캐시 할인을 적용하지 않으므로 **절대액은 과대평가**다(claude 의
 * `vendorCostUsd` 와 대조하면 그 크기를 볼 수 있다). 그래도 이걸 비교축으로
 * 쓰는 이유는 하나뿐 — 한쪽만 가진 자로 두 벤더를 재면 그건 비교가 아니라
 * 벤더 리포팅 기능의 차이를 재는 것이 되기 때문이다.
 */
export function listCostUsd(
  usage: AgentUsage,
  rate: BenchRate | null,
): number | null {
  if (!rate) return null;
  return (
    (usage.totalInputTokens * rate.inputPer1M +
      usage.outputTokens * rate.outputPer1M) /
    1_000_000
  );
}

/** 하네스별 파서 선택. `gold`/`noop` 은 에이전트를 안 띄우므로 호출되지 않는다. */
export function parseUsage(harness: string, stdout: string): AgentUsage | null {
  if (harness === "claude") return parseClaudeUsage(stdout);
  if (harness === "codex") return parseCodexUsage(stdout);
  // grok CLI 에는 사용량 출력 축이 없다. ★없는 것을 0 으로 지어내지 않는다.
  return null;
}
