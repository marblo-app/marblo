/**
 * 오케 **벤더 잔액 게이트** — DeepSeek 예외를 지탱하는 관문의 계약.
 *
 * 이 파일이 지키는 것은 셋이다:
 *   ① 실패 사유 넷(잔액 0 / 키 없음 / 401 / 네트워크)이 **끝까지 갈라져** 있고,
 *      문구가 "무엇을 해야 하는지" 까지 말한다.
 *   ② 저장된 값이 나중에 못 쓰게 됐을 때 **조용히 통과하지 않는다**(fail-closed).
 *   ③ 셀렉터 예외가 **잔액 프로브가 있는 벤더에만** 붙어 있다 — 프로브 없는 벤더를
 *      예외 집합에 넣으면 칸만 서고 절대 안 뜨는 상태가 되므로 여기서 깨진다.
 */
import { describe, it, expect } from "vitest";
import {
  LOW_BALANCE_THRESHOLDS,
  decideOrchestratorVendorGate,
  orchestratorVendorBootNotice,
} from "../../electron/orchestrator-vendor-gate";
import { ORCHESTRATOR_RUNTIME_GATED_VENDORS } from "../../electron/model-selection";
import { balanceProbeVendors } from "../../electron/vendor-balance";
import type { VendorBalanceResult } from "../../electron/vendor-balance";
import { LOW_BALANCE_THRESHOLDS as MIRROR_THRESHOLDS } from "../../src/lib/vendorBalanceLevel";
import { vendorBalanceLevel } from "../../src/lib/vendorBalanceLevel";

const VENDOR = "deepseek";
const LABEL = "DeepSeek";

function balance(
  partial: Partial<VendorBalanceResult> & Pick<VendorBalanceResult, "status">,
): VendorBalanceResult {
  return {
    vendor: VENDOR,
    amounts: [],
    fetchedAt: 1,
    cached: false,
    ...partial,
  };
}

function decide(b: VendorBalanceResult | null) {
  return decideOrchestratorVendorGate({
    vendor: VENDOR,
    vendorLabel: LABEL,
    balance: b,
    requiredEnvKeys: ["DEEPSEEK_API_KEY"],
  });
}

describe("오케 벤더 게이트 — 실패 사유 넷을 뭉개지 않는다", () => {
  it("★잔액 0 → depleted. 문구가 '충전' 을 말하고 로그인은 말하지 않는다", () => {
    const v = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "USD", total: 0, granted: 0, toppedUp: 0 }],
        isAvailable: true,
      }),
    );
    expect(v.status).toBe("depleted");
    expect(v.allowed).toBe(false);
    expect(v.action).toContain("충전");
    // ★조치를 반대 방향으로 보내면 안 된다. 잔액 0 은 로그인·키 교체로 안 풀린다.
    expect(v.action).not.toContain("로그인 문제입니다");
    expect(v.action).not.toContain("새 키로 교체");
  });

  it("★키 없음 → no-key. 키 **이름**을 말하고 값은 어디에도 없다", () => {
    const v = decide(
      balance({ status: "no-key", missingEnvKeys: ["DEEPSEEK_API_KEY"] }),
    );
    expect(v.status).toBe("no-key");
    expect(v.allowed).toBe(false);
    expect(v.action).toContain("DEEPSEEK_API_KEY");
    expect(v.action).toContain("설정");
    expect(v.missingEnvKeys).toEqual(["DEEPSEEK_API_KEY"]);
    // 충전 안내로 새면 안 된다 — 키가 없는 사람은 충전해도 안 뜬다.
    expect(v.action).not.toContain("충전");
  });

  it("★401 → unauthorized. '잔액 문제가 아니다' 를 명시하고 키 교체로 보낸다", () => {
    const v = decide(balance({ status: "unauthorized", httpStatus: 401 }));
    expect(v.status).toBe("unauthorized");
    expect(v.allowed).toBe(false);
    expect(v.httpStatus).toBe(401);
    expect(v.action).toContain("401");
    expect(v.action).toContain("잔액 문제가 아닙니다");
    expect(v.action).toContain("교체");
  });

  it("★네트워크 → unreachable. 키도 잔액도 탓하지 않는다", () => {
    const v = decide(balance({ status: "network-error" }));
    expect(v.status).toBe("unreachable");
    expect(v.allowed).toBe(false);
    expect(v.action).toContain("네트워크");
    expect(v.action).not.toContain("충전해야");
  });

  it("★넷의 문구가 서로 다르다 — 하나로 뭉개면 사용자는 뭘 고칠지 모른다", () => {
    const actions = [
      decide(
        balance({
          status: "ok",
          amounts: [
            { currency: "USD", total: 0, granted: null, toppedUp: null },
          ],
        }),
      ).action,
      decide(
        balance({ status: "no-key", missingEnvKeys: ["DEEPSEEK_API_KEY"] }),
      ).action,
      decide(balance({ status: "unauthorized", httpStatus: 401 })).action,
      decide(balance({ status: "network-error" })).action,
    ];
    expect(new Set(actions).size).toBe(4);
    // 넷 다 "무엇을 해야 하는지" 까지 적는다 — "잔액이 부족합니다" 로 끝내지 않는다.
    for (const a of actions) expect(a.length).toBeGreaterThan(30);
  });

  it("5xx 는 401 과 갈라 둔다 — 503 을 '키를 바꾸세요' 로 안내하면 반대 방향이다", () => {
    const v = decide(balance({ status: "http-error", httpStatus: 503 }));
    expect(v.status).toBe("unreachable");
    expect(v.action).toContain("503");
    expect(v.action).toContain("키 문제가 아닙니다");
  });

  it("스키마 미상은 넷 중 아무 데나 접지 않는다(없는 사실을 만들지 않는다)", () => {
    const v = decide(balance({ status: "malformed" }));
    expect(v.status).toBe("indeterminate");
    expect(v.allowed).toBe(false);
    expect(v.action).toContain("해석하지 못했습니다");
  });
});

describe("오케 벤더 게이트 — 조용히 통과하지 않는다(fail-closed)", () => {
  it("★아직 조회 전이면 막는다 — '모르니까 일단 띄운다' 가 원래의 샘이다", () => {
    const v = decide(null);
    expect(v.status).toBe("indeterminate");
    expect(v.allowed).toBe(false);
  });

  it("★잔액이 남아 있어도 벤더가 is_available=false 면 막는다", () => {
    const v = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "USD", total: 50, granted: null, toppedUp: 50 }],
        isAvailable: false,
      }),
    );
    expect(v.status).toBe("depleted");
    expect(v.allowed).toBe(false);
  });

  it("모든 차단 상태에서 allowed=false 다(허용은 ok/low 둘뿐)", () => {
    const blocked: VendorBalanceResult[] = [
      balance({ status: "no-key" }),
      balance({ status: "unauthorized", httpStatus: 403 }),
      balance({ status: "http-error", httpStatus: 500 }),
      balance({ status: "network-error" }),
      balance({ status: "malformed" }),
      balance({ status: "unsupported" }),
    ];
    for (const b of blocked) {
      expect(decide(b).allowed, b.status).toBe(false);
    }
  });
});

describe("오케 벤더 게이트 — 임계와 통화", () => {
  it("임계 이하는 **막지 않고** 충전 안내만 띄운다", () => {
    const v = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "USD", total: 1, granted: null, toppedUp: 1 }],
      }),
    );
    expect(v.status).toBe("low");
    expect(v.allowed).toBe(true);
    expect(v.action).toContain("충전");
  });

  it("임계 위는 아무 말도 하지 않는다(경고 인플레 방지)", () => {
    const v = decide(
      balance({
        status: "ok",
        amounts: [
          { currency: "USD", total: 100, granted: null, toppedUp: 100 },
        ],
      }),
    );
    expect(v.status).toBe("ok");
    expect(v.allowed).toBe(true);
    expect(v.action).toBe("");
  });

  it("★통화를 환산하지 않는다 — CNY 는 CNY 임계로 본다", () => {
    // 10 CNY 는 USD 임계(2)보다 크지만 CNY 임계(15) 이하다. 환산했다면 여기서
    // "ok" 가 나온다.
    const v = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "CNY", total: 10, granted: null, toppedUp: 10 }],
      }),
    );
    expect(v.status).toBe("low");
  });

  it("★모르는 통화는 저잔액 판정을 하지 않는다(지어낸 사실 금지)", () => {
    const v = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "KRW", total: 1, granted: null, toppedUp: 1 }],
      }),
    );
    expect(v.status).toBe("ok");
  });

  it("★그래도 소진(≤0)은 통화와 무관하게 잡는다", () => {
    const v = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "KRW", total: 0, granted: null, toppedUp: 0 }],
      }),
    );
    expect(v.status).toBe("depleted");
  });

  it("★렌더러 미러가 같은 임계를 쓴다 — 화면과 스폰 게이트가 갈라지지 않는다", () => {
    // 벌어지면 화면은 "충분함" 인데 스폰은 막히는(또는 그 반대) 상태가 된다.
    expect(MIRROR_THRESHOLDS).toEqual(LOW_BALANCE_THRESHOLDS);
  });

  it("★미러의 수위 판정이 게이트 판정과 같은 답을 낸다", () => {
    const cases: Array<[{ currency: string; total: number }, string]> = [
      [{ currency: "USD", total: 0 }, "depleted"],
      [{ currency: "USD", total: 1 }, "low"],
      [{ currency: "USD", total: 100 }, "ok"],
      [{ currency: "CNY", total: 10 }, "low"],
      [{ currency: "KRW", total: 1 }, "ok"],
    ];
    for (const [amount, expected] of cases) {
      expect(vendorBalanceLevel([amount]), amount.currency).toBe(expected);
      const v = decide(
        balance({
          status: "ok",
          amounts: [{ ...amount, granted: null, toppedUp: null }],
        }),
      );
      expect(v.status, `${amount.currency} ${amount.total}`).toBe(expected);
    }
  });
});

describe("오케 벤더 게이트 — 터미널 공지", () => {
  it("★임계 이하일 때만 부트 공지를 만든다", () => {
    const low = decide(
      balance({
        status: "ok",
        amounts: [{ currency: "USD", total: 1, granted: null, toppedUp: 1 }],
      }),
    );
    const notice = orchestratorVendorBootNotice(low);
    expect(notice).toBeDefined();
    // 공지는 오케가 **사용자에게** 전하라는 지시여야 한다 — 로그로만 남으면
    // 사장님이 말한 "내부 터미널 알림" 이 되지 않는다.
    expect(notice).toContain("사용자에게");
    expect(notice).toContain("충전");
  });

  it("여유·차단 상태에서는 공지가 없다(차단은 배너가 진다)", () => {
    for (const b of [
      balance({
        status: "ok",
        amounts: [
          { currency: "USD", total: 100, granted: null, toppedUp: 100 },
        ],
      }),
      balance({ status: "no-key" }),
      balance({ status: "network-error" }),
    ]) {
      expect(orchestratorVendorBootNotice(decide(b))).toBeUndefined();
    }
  });
});

describe("셀렉터 예외는 잔액 프로브가 있는 벤더에만 붙는다", () => {
  it("★런타임 게이트 벤더는 전부 `BALANCE_PROBES` 에 있다", () => {
    // 프로브 없는 벤더를 예외 집합에 넣으면 게이트가 매번 indeterminate 로 막아
    // **칸만 서고 절대 안 뜨는** 상태가 된다. 그 어긋남을 여기서 잡는다.
    const probed = new Set(balanceProbeVendors());
    for (const vendor of ORCHESTRATOR_RUNTIME_GATED_VENDORS) {
      expect(probed.has(vendor), `${vendor} 에 잔액 프로브가 없다`).toBe(true);
    }
  });

  it("★오늘의 예외는 DeepSeek 하나뿐이다 — 확대는 의식적 결정이어야 한다", () => {
    expect([...ORCHESTRATOR_RUNTIME_GATED_VENDORS]).toEqual(["deepseek"]);
  });
});
