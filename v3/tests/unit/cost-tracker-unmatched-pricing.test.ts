/**
 * ★P1 고스트 비용 회귀 가드.
 *
 * 버그: cost-tracker 의 단가표가 `default: {3, 15}`(= Sonnet 실단가) 행으로
 * 끝났고, 어느 행에도 안 걸린 model id 는 **조용히 그 요율로 청구**됐다.
 * Anthropic 모델만 돌리던 시절엔 티가 안 났지만, 레지스트리에 grok(xai)·
 * GLM(zai)·MiniMax 행이 생기면서 실제 손실이 됐다:
 *
 *   - `MiniMax-M3` 는 벤더 공식 대소문자 혼합 id 로 등록돼 있는데 단가표 조회와
 *     프리픽스 스캔이 **둘 다 대소문자 구분**이었다. 세션이 `minimax-m3` 로
 *     보고하면 전부 미스 → $3/$15 청구. 실단가는 $0.6/$2.4 다(입력 5배·출력
 *     6.25배 과대청구 = 없는 돈).
 *   - `grok`/`opus`/`fable` 은 CLI **alias** 라 단가표 키와 안 맞았다. alias 로
 *     보인 Fable5 는 $10/$50 대신 $3/$15 로 청구됐다.
 *
 * 수리 규칙 3개(이 파일이 강제한다):
 *   1. 단가 해석은 model-registry 단일 소스. 하드코딩 요율 재도입 금지.
 *   2. 미매칭 id 는 **절대** 다른 모델 요율로 청구하지 않는다 → 0 + 명시적
 *      warn + 텔레메트리 카운터.
 *   3. 미매칭 전에 별칭/정규화(대소문자 접기)로 레지스트리를 다시 조회한다.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  perTokenRateFor,
  resolvePerTokenRate,
  onUnmatchedPricing,
  unmatchedPricingCounters,
  resetUnmatchedPricing,
  UNMATCHED_RATE,
  CostTracker,
  type UnmatchedPricingEvent,
} from "../../electron/cost-tracker";
import { MODEL_REGISTRY, getModel } from "../../electron/model-registry";
import { grokSessionsDir } from "../../electron/agent-config";
import path from "path";

const SONNET_RATE = { inputPer1M: 3, outputPer1M: 15 };
const ZERO_RATE = { inputPer1M: 0, outputPer1M: 0 };

/** `findPricing` 은 private 이라 공개 경로(computeIncrementalCost)로 청구액을 잰다. */
function chargeFor(model: string, inputTokens: number, outputTokens: number) {
  const tracker = new CostTracker();
  // findPricing 은 private — 청구 경로를 그대로 타려고 인덱스 접근으로 부른다.
  const pricing = (
    tracker as unknown as {
      findPricing(
        m: string,
      ): Parameters<CostTracker["computeIncrementalCost"]>[0];
    }
  ).findPricing(model);
  return tracker.computeIncrementalCost(pricing, inputTokens, outputTokens);
}

beforeEach(() => {
  resetUnmatchedPricing();
  onUnmatchedPricing(null);
});

afterEach(() => {
  onUnmatchedPricing(null);
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe("★미매칭 model id 는 Sonnet 요율로 청구되지 않는다", () => {
  const UNKNOWN_IDS = [
    "totally-unknown-model",
    "llama-77b-instruct",
    "some-vendor/some-model",
    "",
    "   ",
  ];

  it.each(UNKNOWN_IDS)("미지 id %j → 요율 0 (Sonnet 아님)", (id) => {
    const res = resolvePerTokenRate(id);
    expect(res.matched).toBe(false);
    expect(res.kind).toBe("unmatched");
    expect(res.rate).toEqual(ZERO_RATE);
    expect(res.rate).not.toEqual(SONNET_RATE);
  });

  it("미지 id 의 실제 청구액이 0 이다 (요율표가 아니라 돈 기준 검증)", () => {
    // 1M in / 1M out 을 태워도 0. 종전 동작이었다면 $18 이 발명됐다.
    expect(chargeFor("totally-unknown-model", 1_000_000, 1_000_000)).toBe(0);
    // 대조군: 실단가가 있는 모델은 정상 청구된다(0 이 되는 게 전면 마비가 아님).
    expect(chargeFor("claude-sonnet-5", 1_000_000, 1_000_000)).toBeCloseTo(
      18,
      6,
    );
  });

  it("단가표에 default(=Sonnet) 폴백 행 자체가 존재하지 않는다", () => {
    // 폴백 행이 되살아나면 그 즉시 조용한 과금이 부활한다. 행이 있으면
    // "default" 라는 문자열 id 로 조회했을 때 매칭이 잡힌다.
    expect(resolvePerTokenRate("default").matched).toBe(false);
    expect(UNMATCHED_RATE).toEqual(ZERO_RATE);
  });

  it("PTY 스크레이핑(model 미상)도 Sonnet 요율로 청구되지 않는다", () => {
    const seen: Array<{ agentId: string; cost: number; model: string }> = [];
    const tracker = new CostTracker((agentId, cost) =>
      seen.push({ agentId, cost: cost.deltaCost, model: cost.model }),
    );
    // 모델 귀속이 없는 토큰 수치만 있는 출력. 종전엔 $3/$15 로 환산됐다.
    tracker.processOutput(
      "agent-1",
      "input tokens: 1,000,000\noutput tokens: 1,000,000\n",
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].model).toBe("unknown");
    expect(seen[0].cost).toBe(0);
    expect(unmatchedPricingCounters()["unknown"]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("★(a) 별칭/정규화로 registry 재조회 — 미매칭 판정 전에", () => {
  it("대소문자만 다른 벤더 id 가 레지스트리로 되잡힌다 (MiniMax 고스트 비용 원흉)", () => {
    const canonical = getModel("MiniMax-M3")!;
    const expected = {
      inputPer1M: canonical.pricing.inputPer1M,
      outputPer1M: canonical.pricing.outputPer1M,
    };

    for (const spelling of ["minimax-m3", "MINIMAX-M3", "  MiniMax-M3  "]) {
      const res = resolvePerTokenRate(spelling);
      expect(res.matched, spelling).toBe(true);
      expect(res.rate, spelling).toEqual(expected);
      // ★핵심: Sonnet 요율이 아니다. 이게 그대로 과대청구였다.
      expect(res.rate, spelling).not.toEqual(SONNET_RATE);
    }
    // 미매칭으로 새지 않았으므로 카운터는 비어 있어야 한다.
    expect(unmatchedPricingCounters()).toEqual({});
  });

  it("CLI alias 가 구체 id 단가로 해석된다 (alias 는 단가표 키가 아니다)", () => {
    // fable → claude-fable-5 $10/$50. 종전엔 alias 가 어느 행에도 안 걸려
    // $3/$15 로 청구됐다 — 출력 기준 3.3배 과소보고.
    expect(perTokenRateFor("fable")).toEqual({
      inputPer1M: 10,
      outputPer1M: 50,
    });
    expect(perTokenRateFor("opus")).toEqual({ inputPer1M: 5, outputPer1M: 25 });
    expect(perTokenRateFor("sonnet")).toEqual(SONNET_RATE);
    expect(perTokenRateFor("haiku")).toEqual({ inputPer1M: 1, outputPer1M: 5 });
    // grok alias → grok-4.5. Sonnet 요율이 아니어야 한다.
    expect(perTokenRateFor("grok")).toEqual(
      (({ inputPer1M, outputPer1M }) => ({ inputPer1M, outputPer1M }))(
        getModel("grok-4.5")!.pricing,
      ),
    );
    expect(perTokenRateFor("grok")).not.toEqual(SONNET_RATE);
  });

  it("해석 순서: 정확 매칭 → registry(별칭/대소문자) → 프리픽스 → 미매칭", () => {
    expect(resolvePerTokenRate("claude-sonnet-5").kind).toBe("exact");
    expect(resolvePerTokenRate("minimax-m3").kind).toBe("registry");
    expect(resolvePerTokenRate("fable").kind).toBe("registry");
    // 미등록 gpt-5.x 변종은 legacy 계열 프리픽스 행("gpt-5")이 계속 잡는다.
    expect(resolvePerTokenRate("gpt-5.9-experimental").kind).toBe("prefix");
    expect(resolvePerTokenRate("nope-not-a-model").kind).toBe("unmatched");
  });

  it("legacy 프리픽스 행은 보존된다 — 0 화가 과거 세션로그를 망가뜨리지 않는다", () => {
    expect(perTokenRateFor("claude-opus-4-7")).toEqual({
      inputPer1M: 15,
      outputPer1M: 75,
    });
    expect(perTokenRateFor("gpt-4o-mini")).toEqual({
      inputPer1M: 0.15,
      outputPer1M: 0.6,
    });
    expect(perTokenRateFor("gemini-2.0-flash")).toEqual({
      inputPer1M: 0.1,
      outputPer1M: 0.4,
    });
    expect(perTokenRateFor("gpt-5.3-codex")).toEqual({
      inputPer1M: 1.75,
      outputPer1M: 14,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("★알려진 신규 벤더 id 는 정확한 실단가로 청구된다", () => {
  // 요율 리터럴을 여기 베끼지 않는다 — 베끼는 순간 그게 두 번째 하드코딩
  // 단가표가 되고, PR#598 이 없앤 이중 소스가 부활한다. 레지스트리와 **같은
  // 값이어야 한다**는 것만 주장한다.
  const NEW_VENDOR_IDS = [
    "grok-4.5", // xai
    "glm-5.2", // zai
    "glm-4.7", // zai
    "MiniMax-M3", // minimax
    "MiniMax-M2.7", // minimax
  ];

  it.each(NEW_VENDOR_IDS)("%s 가 registry 단가와 정확히 일치한다", (id) => {
    const entry = getModel(id);
    expect(entry, `${id} 행이 레지스트리에 없다`).toBeDefined();
    expect(perTokenRateFor(id)).toEqual({
      inputPer1M: entry!.pricing.inputPer1M,
      outputPer1M: entry!.pricing.outputPer1M,
    });
  });

  it.each(NEW_VENDOR_IDS)("%s 는 Sonnet 요율로 청구되지 않는다", (id) => {
    const rate = perTokenRateFor(id);
    // glm-5.2($1.4/$4.4) 등은 전부 Sonnet 과 다른 값이다. 같아지는 순간
    // "폴백에 걸린 건지 진짜 그 값인지" 구분이 불가능해지므로 여기서 막는다.
    expect(rate).not.toEqual(SONNET_RATE);
    expect(rate.inputPer1M).toBeGreaterThan(0);
    expect(rate.outputPer1M).toBeGreaterThan(0);
  });

  it("신규 벤더 3사(xai/zai/minimax) 행이 실제로 레지스트리에 존재한다", () => {
    for (const vendor of ["xai", "zai", "minimax"] as const) {
      const rows = MODEL_REGISTRY.filter((m) => m.provider === vendor);
      expect(rows.length, `${vendor} 행 없음`).toBeGreaterThan(0);
      for (const row of rows) {
        // 단가 0 인 행이 레지스트리에 있으면 그건 "미매칭" 과 구분 불가다.
        expect(row.pricing.inputPer1M, row.id).toBeGreaterThan(0);
        expect(row.pricing.outputPer1M, row.id).toBeGreaterThan(0);
      }
    }
  });

  it("레지스트리 전 행이 단가표를 통과한다 (미매칭 0건)", () => {
    for (const m of MODEL_REGISTRY) {
      const res = resolvePerTokenRate(m.id);
      expect(res.matched, m.id).toBe(true);
      expect(res.rate, m.id).toEqual({
        inputPer1M: m.pricing.inputPer1M,
        outputPer1M: m.pricing.outputPer1M,
      });
    }
    expect(unmatchedPricingCounters()).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("★(b) 미매칭 가시화 — warn 로그 + 텔레메트리 카운터", () => {
  it("조회(pure)는 카운터를 건드리지 않고, 청구 경로만 기록한다", () => {
    resolvePerTokenRate("ghost-model-a");
    expect(unmatchedPricingCounters()).toEqual({});

    chargeFor("ghost-model-a", 10, 10);
    expect(unmatchedPricingCounters()["ghost-model-a"]).toBe(1);
  });

  it("첫 미매칭에 warn 로그가 나가고 '0 청구/과소보고' 를 명시한다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    chargeFor("ghost-model-b", 1, 1);

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0].join(" ");
    expect(msg).toContain("ghost-model-b");
    expect(msg).toContain("UNMATCHED");
    // 운영자가 "추정치로 청구됐나?" 를 오해하지 않도록 0/과소보고를 못박는다.
    expect(msg).toContain("$0");
    expect(msg).toContain("model-registry");
  });

  it("텔레메트리 sink 가 첫 목격에 firstSeen 으로 발화한다", () => {
    const events: UnmatchedPricingEvent[] = [];
    onUnmatchedPricing((ev) => events.push(ev));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    chargeFor("ghost-model-c", 1, 1);

    expect(events).toEqual([
      { model: "ghost-model-c", count: 1, firstSeen: true },
    ]);
  });

  it("카운터는 매번 누적하되 발화는 자릿수 단위로 제한된다(15s 폴러 홍수 방지)", () => {
    const events: UnmatchedPricingEvent[] = [];
    onUnmatchedPricing((ev) => events.push(ev));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 100; i++) chargeFor("ghost-model-d", 1, 1);

    // 정확한 횟수는 항상 카운터로 알 수 있다.
    expect(unmatchedPricingCounters()["ghost-model-d"]).toBe(100);
    // 발화는 1·10·100 세 번뿐.
    expect(events.map((e) => e.count)).toEqual([1, 10, 100]);
    expect(events[0].firstSeen).toBe(true);
    expect(events[1].firstSeen).toBe(false);
  });

  it("모델별로 따로 센다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    chargeFor("ghost-x", 1, 1);
    chargeFor("ghost-x", 1, 1);
    chargeFor("ghost-y", 1, 1);

    expect(unmatchedPricingCounters()).toEqual({ "ghost-x": 2, "ghost-y": 1 });
  });

  // ── 인접 고스트 비용: 남의 토큰을 내 것으로 청구하는 경로 ─────────────
  it("★custom 은 ~/.claude JSONL 리더로 새지 않는다(교차귀속 방지)", () => {
    // custom 은 세션 포맷을 모르는 하네스다 — ~/.claude/projects 에 JSONL 을
    // 쓰지 않는다. 종전엔 claude 분기로 흘러들었고, sessionId 가 null 인
    // 재접속 경로(main.ts --continue)에서는 "프로젝트 디렉토리의 최신 JSONL" 을
    // 집었다 = **다른 에이전트의 실제 Anthropic 세션**. 틀린 요율보다 나쁘다:
    // 진짜 돈이 두 번 청구된다.
    const emitted: string[] = [];
    const tracker = new CostTracker((agentId) => emitted.push(agentId));

    tracker.trackSession("agent-custom", process.cwd(), null, "custom");
    // 트래커가 아예 안 생겨야 한다 — 생겼다면 15s 폴러가 남의 파일을 읽는다.
    expect(
      (tracker as unknown as { sessions: Map<string, unknown> }).sessions.has(
        "agent-custom",
      ),
    ).toBe(false);
    expect(emitted).toEqual([]);
    tracker.clearAll();
  });

  it("★grok 은 추적하되 읽는 곳은 자기 GROK_HOME 이다(claude 트리 미접촉)", () => {
    // grok 은 이제 **추적된다** — 자기 GROK_HOME 아래 updates.jsonl 에 실제
    // per-prompt usage 를 쓰기 때문이다(session-parsers.grokLineUsage). 다만
    // 위 교차귀속 사고를 되풀이하지 않는 게 조건이다: searchRoot 가 grok 자기
    // 홈이어야 하고, ~/.claude 근처면 안 된다. 포맷도 grok 이어야 한다 —
    // claude 포맷이면 account-global rate-limit 프로브까지 딸려 켜진다.
    const tracker = new CostTracker(() => {});
    tracker.trackSession("agent-grok", process.cwd(), null, "grok");

    const sessions = (
      tracker as unknown as {
        sessions: Map<string, { format: string; searchRoot: string }>;
      }
    ).sessions;
    const t = sessions.get("agent-grok");
    expect(t).toBeDefined();
    expect(t!.format).toBe("grok");
    expect(t!.searchRoot).toBe(grokSessionsDir("agent-grok"));
    expect(t!.searchRoot).toContain("grok-home-agent-grok");
    expect(t!.searchRoot).not.toContain(path.join(".claude", "projects"));
    tracker.clearAll();
  });

  it("★grok 서버측 변종 id(grok-4.5-build)는 grok-4.5 행으로 청구된다", () => {
    // grok 의 turn_completed.modelUsage 키는 우리가 핀한 id 가 아니라 **서버가
    // 실제로 서빙한 이름**이다(라이브 관측: `grok-4.5-build`). 이 id 가 단가표에
    // 안 걸리면 새로 붙인 grok 토큰이 전부 $0 로 적재되고 15s 폴러가 warn 을
    // 쏟는다. 최장-프리픽스가 grok-4.5 행으로 접어주는 게 그 방지선이다.
    const r = resolvePerTokenRate("grok-4.5-build");
    expect(r.matched).toBe(true);
    expect(r.matchedKey).toBe("grok-4.5");
    const row = getModel("grok-4.5")!.pricing;
    expect(r.rate).toEqual({
      inputPer1M: row.inputPer1M,
      outputPer1M: row.outputPer1M,
    });
    expect(unmatchedPricingCounters()).toEqual({});
  });

  it("알려진 모델은 카운터를 오염시키지 않는다", () => {
    chargeFor("claude-opus-5", 1000, 1000);
    chargeFor("MiniMax-M3", 1000, 1000);
    chargeFor("minimax-m3", 1000, 1000);
    chargeFor("grok", 1000, 1000);
    expect(unmatchedPricingCounters()).toEqual({});
  });
});
