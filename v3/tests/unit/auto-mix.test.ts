import { describe, expect, it } from "vitest";
import {
  decideAutoMix,
  bindingPercent,
  isAutoMixEnabled,
  autoMixThresholds,
  DEFAULT_MIX_HEADROOM_PCT,
  DEFAULT_MIX_EXHAUST_PCT,
  type AutoMixInput,
} from "../../electron/auto-mix";
import type { RateLimitInfo } from "../../electron/session-parsers";

const rl = (
  primary: number | null,
  secondary: number | null = null,
): RateLimitInfo => ({
  planType: null,
  primaryPercent: primary,
  primaryResetAt: null,
  secondaryPercent: secondary,
  secondaryResetAt: null,
});

// 기본 입력: complex + 둘 다 연결 + 양쪽 여유(10%) + model 미지정 = 자동 믹스 발동 케이스.
const base = (over: Partial<AutoMixInput> = {}): AutoMixInput => ({
  enabled: true,
  complexity: "complex",
  explicitMix: false,
  explicitModel: false,
  effectiveModel: undefined,
  claudeEnabled: true,
  gptEnabled: true,
  claude: rl(10),
  gpt: rl(10),
  ...over,
});

describe("bindingPercent", () => {
  it("두 윈도우 중 더 높은(먼저 소진) 쪽을 취한다", () => {
    expect(bindingPercent(rl(30, 70))).toBe(70);
    expect(bindingPercent(rl(70, 30))).toBe(70);
  });
  it("null/정보없음은 null", () => {
    expect(bindingPercent(null)).toBeNull();
    expect(bindingPercent(rl(null, null))).toBeNull();
  });
  it("한쪽만 값이 있으면 그 값", () => {
    expect(bindingPercent(rl(null, 42))).toBe(42);
  });
});

describe("decideAutoMix — 게이트(무동작)", () => {
  it("플래그 off → 무동작", () => {
    const d = decideAutoMix(base({ enabled: false }));
    expect(d.mix).toBeUndefined();
    expect(d.rerouteModel).toBeUndefined();
  });
  it("complex 아니면 무동작", () => {
    expect(decideAutoMix(base({ complexity: "standard" })).mix).toBeUndefined();
    expect(
      decideAutoMix(base({ complexity: "simple" })).rerouteModel,
    ).toBeUndefined();
  });
  it("명시적 mix 요청이면 자동판단 skip", () => {
    const d = decideAutoMix(base({ explicitMix: true }));
    expect(d.mix).toBeUndefined();
    expect(d.rerouteModel).toBeUndefined();
  });
  it("둘 중 하나라도 미연결이면 무동작", () => {
    expect(decideAutoMix(base({ gptEnabled: false })).mix).toBeUndefined();
    expect(decideAutoMix(base({ claudeEnabled: false })).mix).toBeUndefined();
  });
  it("usage 정보 없음(null) → 낙관하지 않고 무동작", () => {
    const d = decideAutoMix(base({ claude: null, gpt: null }));
    expect(d.mix).toBeUndefined();
    expect(d.rerouteModel).toBeUndefined();
  });
});

describe("decideAutoMix — 자동 믹스", () => {
  it("model 미지정 + 양쪽 여유 → Claude 1차 고정 + cross-check 믹스", () => {
    const d = decideAutoMix(base());
    expect(d.mix).toBe("cross-check");
    expect(d.rerouteModel).toBe("claude");
  });
  it("명시 claude + 양쪽 여유 → cross-check 믹스(reroute 없음)", () => {
    const d = decideAutoMix(
      base({ effectiveModel: "claude", explicitModel: true }),
    );
    expect(d.mix).toBe("cross-check");
    expect(d.rerouteModel).toBeUndefined();
  });
  it("명시 gpt + 양쪽 여유 → Claude 1차가 아니므로 믹스 안 함", () => {
    const d = decideAutoMix(
      base({ effectiveModel: "gpt", explicitModel: true }),
    );
    expect(d.mix).toBeUndefined();
    expect(d.rerouteModel).toBeUndefined();
  });
});

describe("decideAutoMix — 소진 임박 라우팅", () => {
  it("Claude 소진임박 + Codex 여유(model 미지정) → gpt 로 라우팅, 믹스 안 함", () => {
    const d = decideAutoMix(base({ claude: rl(95), gpt: rl(10) }));
    expect(d.rerouteModel).toBe("gpt");
    expect(d.mix).toBeUndefined();
  });
  it("Codex 소진임박 + Claude 여유(model 미지정) → claude 로 라우팅, 믹스 안 함", () => {
    const d = decideAutoMix(base({ claude: rl(10), gpt: rl(95) }));
    expect(d.rerouteModel).toBe("claude");
    expect(d.mix).toBeUndefined();
  });
  it("명시 model 이 있으면 소진임박이어도 reroute 하지 않는다(재배정 가드 보존)", () => {
    const d = decideAutoMix(
      base({
        explicitModel: true,
        effectiveModel: "claude",
        claude: rl(95),
        gpt: rl(10),
      }),
    );
    expect(d.rerouteModel).toBeUndefined();
    // claude 가 소진임박이라 free 아님 → 믹스도 안 걸림.
    expect(d.mix).toBeUndefined();
  });
  it("secondary(주간) 윈도우 소진도 소진임박으로 감지", () => {
    const d = decideAutoMix(base({ claude: rl(10, 92), gpt: rl(10) }));
    expect(d.rerouteModel).toBe("gpt");
  });
  it("둘 다 소진임박 → 라우팅 대상 없음, 무동작", () => {
    const d = decideAutoMix(base({ claude: rl(95), gpt: rl(95) }));
    expect(d.rerouteModel).toBeUndefined();
    expect(d.mix).toBeUndefined();
  });
  it("중간 사용률(여유도 소진도 아님) → 무동작", () => {
    const d = decideAutoMix(base({ claude: rl(85), gpt: rl(85) }));
    expect(d.rerouteModel).toBeUndefined();
    expect(d.mix).toBeUndefined();
  });
});

describe("isAutoMixEnabled", () => {
  it("미설정/빈값 → off", () => {
    expect(isAutoMixEnabled({})).toBe(false);
    expect(isAutoMixEnabled({ MARBLO_AUTO_MIX: "" })).toBe(false);
    expect(isAutoMixEnabled({ MARBLO_AUTO_MIX: "off" })).toBe(false);
    expect(isAutoMixEnabled({ MARBLO_AUTO_MIX: "0" })).toBe(false);
  });
  it("1/true/on/yes → on", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE", "On"]) {
      expect(isAutoMixEnabled({ MARBLO_AUTO_MIX: v })).toBe(true);
    }
  });
});

describe("autoMixThresholds", () => {
  it("미설정 → 기본치", () => {
    expect(autoMixThresholds({})).toEqual({
      headroomPct: DEFAULT_MIX_HEADROOM_PCT,
      exhaustPct: DEFAULT_MIX_EXHAUST_PCT,
    });
  });
  it("유효값 파싱", () => {
    expect(
      autoMixThresholds({
        MARBLO_MIX_HEADROOM_PCT: "70",
        MARBLO_MIX_EXHAUST_PCT: "85",
      }),
    ).toEqual({ headroomPct: 70, exhaustPct: 85 });
  });
  it("범위 밖/역전이면 기본치로 폴백", () => {
    // exhaust < headroom (논리 역전) → 기본치.
    expect(
      autoMixThresholds({
        MARBLO_MIX_HEADROOM_PCT: "90",
        MARBLO_MIX_EXHAUST_PCT: "50",
      }),
    ).toEqual({
      headroomPct: DEFAULT_MIX_HEADROOM_PCT,
      exhaustPct: DEFAULT_MIX_EXHAUST_PCT,
    });
    // 범위 밖(>100) → 그 항목만 기본치.
    expect(
      autoMixThresholds({ MARBLO_MIX_HEADROOM_PCT: "150" }).headroomPct,
    ).toBe(DEFAULT_MIX_HEADROOM_PCT);
  });
});
