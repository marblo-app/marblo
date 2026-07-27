/**
 * `electron/model-context-reference.ts` 회귀 가드.
 *
 * 검사 축은 벤치 참조표와 같다:
 *   1. 스키마 규율(출처 URL·ISO 날짜·양의 정수)
 *   2. 레지스트리 교차검증(구체 id 만, alias/미등록 금지)
 *   3. **검증기가 실제로 더러운 행을 거부하는가** — "지금 데이터가 깨끗하다"
 *      만으로는 다음 사람이 넣을 날조 행을 못 막는다.
 *   4. 스팟체크(수집한 1차 출처의 숫자가 그대로 남아 있는가)
 */

import { describe, expect, it } from "vitest";
import {
  CONTEXT_REFERENCE,
  contextRecordFor,
  modelsMissingContext,
  validateContextRecords,
  type ContextWindowRecord,
} from "../../electron/model-context-reference";
import { isKnownModelId, MODEL_REGISTRY } from "../../electron/model-registry";

describe("model-context-reference / 스키마 규율", () => {
  it("모든 행에 출처 URL 과 ISO 날짜가 있다", () => {
    for (const rec of CONTEXT_REFERENCE) {
      expect(rec.source, rec.model).toMatch(/^https?:\/\/\S+$/);
      expect(rec.asOf, rec.model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("tokens 는 양의 정수이거나 명시적 null 이다", () => {
    for (const rec of CONTEXT_REFERENCE) {
      if (rec.tokens === null) {
        expect(rec.note, rec.model).toContain("no official number");
        continue;
      }
      expect(Number.isInteger(rec.tokens), rec.model).toBe(true);
      expect(rec.tokens, rec.model).toBeGreaterThan(0);
    }
  });

  it("모델당 행이 하나다(컨텍스트 창은 모델당 한 값)", () => {
    const ids = CONTEXT_REFERENCE.map((r) => r.model);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("model-context-reference / 레지스트리 교차검증", () => {
  it("모든 행의 model 은 레지스트리의 구체 id 다(alias 금지)", () => {
    for (const rec of CONTEXT_REFERENCE) {
      expect(
        isKnownModelId(rec.model),
        `${rec.model} 이 구체 id 가 아니다`,
      ).toBe(true);
    }
  });

  it("활성 레지스트리 모델에 빠짐이 없다", () => {
    // 이 테스트가 곧 "레지스트리에 모델을 추가하면 컨텍스트도 같이 채워라" 는
    // 강제다. 사용량 탭 표는 빠진 칸을 "확인 필요" 로 그리므로 화면이 깨지지는
    // 않지만, 빈 칸이 조용히 늘어나는 것은 여기서 막는다.
    expect(modelsMissingContext()).toEqual([]);
  });

  it("조회는 alias 로도 닿고, 모르는 모델은 undefined 다", () => {
    expect(contextRecordFor("opus")?.model).toBe("claude-opus-5");
    // ★대소문자 혼합 id(MiniMax)도 닿아야 한다 — 레지스트리 조회가 norm 키다.
    expect(contextRecordFor("minimax-m3")?.tokens).toBe(1_000_000);
    expect(contextRecordFor("gpt-4o")).toBeUndefined();
  });
});

describe("model-context-reference / 검증기는 잘못된 행을 거부한다", () => {
  const base: ContextWindowRecord = {
    model: "claude-opus-5",
    tokens: 1_000_000,
    source: "https://example.com/doc",
    asOf: "2026-07-27",
  };

  it("베이스라인 행은 통과한다(가드가 무조건 throw 하는 게 아님)", () => {
    expect(() => validateContextRecords([base])).not.toThrow();
  });

  it("레지스트리에 없는 모델 id 를 거부한다", () => {
    expect(() =>
      validateContextRecords([{ ...base, model: "gpt-4o" }]),
    ).toThrow(/레지스트리에 없는/);
  });

  it("alias 를 거부한다(이동표적 금지)", () => {
    expect(() => validateContextRecords([{ ...base, model: "opus" }])).toThrow(
      /alias/,
    );
  });

  it("출처가 URL 이 아니면 거부한다", () => {
    expect(() =>
      validateContextRecords([{ ...base, source: "벤더 문서에서 봤음" }]),
    ).toThrow(/source/);
  });

  it("tokens=null 인데 사유 표기가 없으면 거부한다", () => {
    expect(() => validateContextRecords([{ ...base, tokens: null }])).toThrow(
      /no official number/,
    );
    expect(() =>
      validateContextRecords([
        { ...base, tokens: null, note: "no official number: 문서에 없음" },
      ]),
    ).not.toThrow();
  });

  it("0/음수/소수 토큰을 거부한다", () => {
    for (const tokens of [0, -1, 1.5]) {
      expect(() => validateContextRecords([{ ...base, tokens }])).toThrow(
        /양의 정수/,
      );
    }
  });

  it("asOf 가 ISO 날짜가 아니면 거부한다", () => {
    expect(() =>
      validateContextRecords([{ ...base, asOf: "2026년 7월" }]),
    ).toThrow(/asOf/);
  });

  it("같은 모델이 두 번 들어오면 거부한다(붙여넣기 사고)", () => {
    expect(() => validateContextRecords([base, { ...base }])).toThrow(
      /이미 있습니다/,
    );
  });
});

describe("model-context-reference / 수치 스팟체크(출처 대조)", () => {
  const tokensOf = (id: string) => contextRecordFor(id)?.tokens;

  it("Anthropic 공식 모델표", () => {
    expect(tokensOf("claude-opus-5")).toBe(1_000_000);
    expect(tokensOf("claude-fable-5")).toBe(1_000_000);
    expect(tokensOf("claude-sonnet-5")).toBe(1_000_000);
    expect(tokensOf("claude-haiku-4-5-20251001")).toBe(200_000);
    // 4.8 은 현행 비교표에 없어 migration-guide 를 출처로 쓴다.
    expect(contextRecordFor("claude-opus-4-8")?.source).toContain(
      "migration-guide",
    );
  });

  it("OpenAI 는 1,050,000 이지 1M 이 아니다(반올림으로 사실을 지우지 않는다)", () => {
    for (const id of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
    ]) {
      expect(tokensOf(id), id).toBe(1_050_000);
    }
    expect(tokensOf("gpt-5.4-mini")).toBe(400_000);
  });

  it("env-swap 벤더 3사", () => {
    expect(tokensOf("grok-4.5")).toBe(500_000);
    expect(tokensOf("glm-5.2")).toBe(1_000_000);
    expect(tokensOf("glm-4.7")).toBe(200_000);
    // ★MiniMax 문서는 200k 로 접지 않고 204,800 을 적는다.
    expect(tokensOf("MiniMax-M3")).toBe(1_000_000);
    expect(tokensOf("MiniMax-M2.7")).toBe(204_800);
    expect(tokensOf("k3")).toBe(1_000_000);
    expect(tokensOf("k3-256k")).toBe(256_000);
    expect(tokensOf("kimi-for-coding")).toBe(256_000);
  });

  it("플랜에 따라 창이 달라지는 행은 note 로 그 조건을 남긴다", () => {
    // k3 의 1M 은 상위 멤버십 전용이다. 숫자만 남기면 하위 플랜 계정에서
    // 표가 거짓말을 한다.
    expect(contextRecordFor("k3")?.note).toMatch(/플랜|higher-tier|Allegretto/);
  });

  it("레지스트리 전 모델이 표에 있다(개수 동치)", () => {
    const active = MODEL_REGISTRY.filter((m) => m.status === "active");
    expect(CONTEXT_REFERENCE.length).toBe(active.length);
  });
});
