// SWE-bench 하네스의 **비용 급소**를 못박는다.
//
// 배경: 라운드3 에서 토큰·비용을 축으로 편입했다. resolved 가 천장에 붙어
// 모델을 못 가를 때(라운드A 실측: frontier 10셀이 9~12/12 안에 전부 몰림),
// "같은 $10/$50 인데 무엇이 더 나은가" 는 비용 축으로만 답할 수 있기 때문이다.
//
// 그런데 그 축에는 조용한 오계측 경로가 하나 있다 — **두 벤더가 같은 단어로
// 다른 것을 센다**:
//
//   claude : input_tokens / cache_read / cache_creation 이 **서로소**
//            → 총 입력 = 셋의 합
//   codex  : cached_input_tokens 가 input_tokens 의 **부분집합**
//            → 총 입력 = input_tokens (더하면 이중계산)
//
// 이걸 안 맞추면 codex 쪽 입력이 부풀고, 그 부푼 표가 그대로 "누가 더 싼가" 의
// 근거로 발간된다. 채점기가 조용히 0점을 주는 실패모드와 같은 종류라서
// (`bench-logparse.test.ts` 참조) 같은 방식으로 코드에 고정한다.
import { describe, it, expect } from "vitest";
import {
  listCostUsd,
  parseClaudeUsage,
  parseCodexUsage,
  parseUsage,
} from "../../electron/scripts/bench/usage";
import { BENCH_PRICES } from "../../electron/scripts/bench/manifest";
import { MODEL_REGISTRY } from "../../electron/model-registry";

/** 실제 `claude -p --output-format json` 출력에서 딴 최소 형태(2026-09-05 실측). */
const CLAUDE_LINE = JSON.stringify({
  total_cost_usd: 1.0332205,
  usage: {
    input_tokens: 322,
    cache_read_input_tokens: 375002,
    cache_creation_input_tokens: 32290,
    output_tokens: 5809,
    output_tokens_details: { thinking_tokens: 531 },
  },
  is_error: false,
  type: "result",
});

/** 실제 `codex exec --json` 의 turn.completed(2026-09-05 실측). */
const CODEX_LINE = JSON.stringify({
  type: "turn.completed",
  usage: {
    input_tokens: 16237,
    cached_input_tokens: 12160,
    cache_write_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 0,
  },
});

describe("claude 사용량 파싱", () => {
  it("★서로소인 세 입력 필드를 **더해서** 총 입력을 만든다", () => {
    const u = parseClaudeUsage(CLAUDE_LINE);
    expect(u).not.toBeNull();
    // 322 + 375002 + 32290 — 하나라도 빠지면 입력이 과소집계된다.
    expect(u!.totalInputTokens).toBe(407614);
    expect(u!.cachedInputTokens).toBe(375002);
    expect(u!.cacheWriteInputTokens).toBe(32290);
  });

  it("벤더가 적어 준 청구액을 그대로 싣는다", () => {
    expect(parseClaudeUsage(CLAUDE_LINE)!.vendorCostUsd).toBe(1.0332205);
  });

  it("추론 토큰은 출력의 부분집합이므로 **따로 더하지 않는다**", () => {
    const u = parseClaudeUsage(CLAUDE_LINE)!;
    expect(u.outputTokens).toBe(5809); // 5809 + 531 이 아니다
    expect(u.reasoningTokens).toBe(531);
  });

  it("앞에 잡음 줄이 있어도 **뒤에서부터** 결과 JSON 을 찾는다", () => {
    const u = parseClaudeUsage(`some warning\n{"not":"usage"}\n${CLAUDE_LINE}`);
    expect(u!.totalInputTokens).toBe(407614);
  });

  it("★사용량을 못 찾으면 0 이 아니라 null 이다", () => {
    // 0 을 채우면 "공짜로 풀었다" 는 거짓이 비용 표에 박힌다.
    expect(parseClaudeUsage("no json here")).toBeNull();
    expect(parseClaudeUsage("")).toBeNull();
  });
});

describe("codex 사용량 파싱", () => {
  it("★cached 는 input 의 부분집합이므로 **더하지 않는다**", () => {
    const u = parseCodexUsage(CODEX_LINE);
    expect(u).not.toBeNull();
    // 16237 그대로. 16237+12160=28397 이 되면 이중계산이다.
    expect(u!.totalInputTokens).toBe(16237);
    expect(u!.cachedInputTokens).toBe(12160);
  });

  it("turn.completed 가 여러 번이면 합산한다", () => {
    const two = `${CODEX_LINE}\n${CODEX_LINE}`;
    expect(parseCodexUsage(two)!.totalInputTokens).toBe(16237 * 2);
  });

  it("turn.completed 가 아닌 이벤트는 무시한다", () => {
    const noise = JSON.stringify({
      type: "item.completed",
      usage: { input_tokens: 999999 },
    });
    const u = parseCodexUsage(`${noise}\n${CODEX_LINE}`);
    expect(u!.totalInputTokens).toBe(16237);
  });

  it("★codex 는 청구액을 안 주므로 지어내지 않고 null 을 남긴다", () => {
    expect(parseCodexUsage(CODEX_LINE)!.vendorCostUsd).toBeNull();
  });

  it("사용량 이벤트가 없으면 null 이다", () => {
    expect(parseCodexUsage('{"type":"turn.started"}')).toBeNull();
  });
});

describe("★두 벤더 정규화가 실제로 서로 다른 규칙임을 고정", () => {
  it("같은 캐시 수치를 줘도 claude 는 더하고 codex 는 안 더한다", () => {
    const shared = {
      input_tokens: 1000,
      output_tokens: 10,
    };
    const c = parseClaudeUsage(
      JSON.stringify({
        usage: {
          ...shared,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 200,
        },
      }),
    )!;
    const x = parseCodexUsage(
      JSON.stringify({
        type: "turn.completed",
        usage: {
          ...shared,
          cached_input_tokens: 500,
          cache_write_input_tokens: 200,
        },
      }),
    )!;
    expect(c.totalInputTokens).toBe(1700); // 1000+500+200 (서로소)
    expect(x.totalInputTokens).toBe(1000); // 부분집합이므로 그대로
    // ★이 둘이 같아지면 정규화가 무너진 것이다.
    expect(c.totalInputTokens).not.toBe(x.totalInputTokens);
  });
});

describe("parseUsage 하네스 라우팅", () => {
  it("claude/codex 를 각 파서로 보낸다", () => {
    expect(parseUsage("claude", CLAUDE_LINE)!.source).toBe("claude-json");
    expect(parseUsage("codex", CODEX_LINE)!.source).toBe("codex-json");
  });

  it("★grok 은 사용량 축이 없으므로 null — 0 으로 지어내지 않는다", () => {
    expect(parseUsage("grok", CODEX_LINE)).toBeNull();
  });
});

describe("정가 환산 비용", () => {
  it("입력·출력에 각 단가를 적용한다", () => {
    const u = parseClaudeUsage(CLAUDE_LINE)!;
    const cost = listCostUsd(u, { inputPer1M: 10, outputPer1M: 50 })!;
    // (407614*10 + 5809*50) / 1e6
    expect(cost).toBeCloseTo(4.36659, 5);
  });

  it("★정가 환산은 캐시 할인을 반영하지 않으므로 실청구보다 크다", () => {
    // 이 관계가 뒤집히면 리포트가 "정가 환산은 과대평가" 라고 적는 근거가 깨진다.
    const u = parseClaudeUsage(CLAUDE_LINE)!;
    const list = listCostUsd(u, { inputPer1M: 10, outputPer1M: 50 })!;
    expect(list).toBeGreaterThan(u.vendorCostUsd!);
  });

  it("단가를 모르면 null — 0 원이 아니다", () => {
    expect(listCostUsd(parseClaudeUsage(CLAUDE_LINE)!, null)).toBeNull();
  });
});

describe("★단가표 드리프트 방어", () => {
  // 하네스는 제품 코드를 import 하지 않는다(feasibility §4-G). 그래서 단가가
  // manifest 에 복제돼 있는데, 복제는 조용히 어긋난다. 그 어긋남을 여기서 잡는다.
  it("BENCH_PRICES 가 model-registry 의 pricing 과 일치한다", () => {
    for (const [id, rate] of Object.entries(BENCH_PRICES)) {
      const m = MODEL_REGISTRY.find((x) => x.id === id);
      expect(m, `${id} 가 레지스트리에 없다`).toBeTruthy();
      expect(m!.pricing.inputPer1M, `${id} 입력 단가 불일치`).toBe(
        rate.inputPer1M,
      );
      expect(m!.pricing.outputPer1M, `${id} 출력 단가 불일치`).toBe(
        rate.outputPer1M,
      );
    }
  });

  it("★이 라운드의 두 신형이 같은 단가라는 전제를 고정한다", () => {
    // 이 전제가 깨지면 "같은 값에 무엇이 더 나은가" 라는 질문 자체가 바뀐다.
    expect(BENCH_PRICES["claude-fable-5-1"]).toEqual(
      BENCH_PRICES["gpt-6-astra"],
    );
  });
});
