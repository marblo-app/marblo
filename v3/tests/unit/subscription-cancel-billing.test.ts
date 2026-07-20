import { describe, it, expect, vi } from "vitest";
import { selectDueForCharge } from "../../functions/src/billing";

// subscriptionStore 는 services/firestore → lib/firebase 를 타고 실제 firebase
// auth 초기화까지 끌어온다. 여기서 검증하려는 건 getPlan 판정 배선뿐이므로
// 데이터 계층을 통째로 스텁해 firebase 부팅을 피한다.
vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: () => () => {},
  convertTimestamps: (raw: unknown) => raw,
}));

const { useSubscriptionStore } =
  await import("../../src/stores/subscriptionStore");

// ─────────────────────────────────────────────────────────────────────
// 티켓 HUETzRj97oSJOGNULro8 — 해지 = 기간 말 종료.
//
// 이 파일은 위 설계가 **의존하는 전제**를 못박는다. 전제가 깨지면 해지한
// 사용자가 다음 달 다시 청구된다(반대 방향의 P0). 전제 자체에 테스트가 없어서
// (selectDueForCharge 는 순수 함수인데 커버리지가 0이었다) 여기서 채운다.
// ─────────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

/** 만료돼서 "청구할 때가 된" 정상 토스 구독. */
function dueToss(overrides: Record<string, unknown> = {}) {
  return {
    paymentProvider: "toss",
    status: "active",
    planType: "pro",
    tossBillingKey: "bk_test",
    tossCustomerKey: "ck_test",
    currentPeriodEndMs: NOW - DAY, // 이미 만료 → 청구 대상
    billingFailedCount: 0,
    nextRetryAtMs: null,
    ...overrides,
  };
}

describe("★전제: status='canceled' 는 다음 청구를 실제로 막는다", () => {
  it("기준선 — 해지하지 않은 활성 구독은 만료 후 청구 대상이다", () => {
    expect(selectDueForCharge(dueToss(), NOW)).toBe(true);
  });

  it("★해지한 구독은 기간이 지나도 청구되지 않는다 (재청구 방지)", () => {
    expect(selectDueForCharge(dueToss({ status: "canceled" }), NOW)).toBe(
      false,
    );
  });

  it("★해지 후 여러 사이클이 지나도 절대 청구되지 않는다", () => {
    for (const monthsLater of [1, 2, 6, 12]) {
      expect(
        selectDueForCharge(
          dueToss({ status: "canceled" }),
          NOW + monthsLater * 30 * DAY,
        ),
        `해지 후 ${monthsLater}개월 뒤 청구 시도됨`,
      ).toBe(false);
    }
  });

  it("잔여 기간이 남아 있는 해지 구독도 당연히 청구되지 않는다", () => {
    expect(
      selectDueForCharge(
        dueToss({ status: "canceled", currentPeriodEndMs: NOW + 29 * DAY }),
        NOW,
      ),
    ).toBe(false);
  });

  it("past_due(청구 실패 재시도)는 계속 청구 대상 — 해지와 구분된다", () => {
    expect(selectDueForCharge(dueToss({ status: "past_due" }), NOW)).toBe(true);
  });
});

describe("subscriptionStore.getPlan — 렌더러 배선", () => {
  function setSub(sub: unknown) {
    useSubscriptionStore.setState({ subscription: sub as never });
  }

  it("★해지 후 잔여 기간 동안 유료 플랜이 유지된다 (이 티켓의 버그)", () => {
    setSub({
      status: "canceled",
      planType: "pro",
      currentPeriodEnd: new Date(Date.now() + 29 * DAY),
    });
    expect(useSubscriptionStore.getState().getPlan()).toBe("pro");
  });

  it("★잔여 기간이 지나면 free 로 떨어진다", () => {
    setSub({
      status: "canceled",
      planType: "pro",
      currentPeriodEnd: new Date(Date.now() - DAY),
    });
    expect(useSubscriptionStore.getState().getPlan()).toBe("free");
  });

  it("정상 활성 구독은 그대로 유료", () => {
    setSub({
      status: "active",
      planType: "team",
      currentPeriodEnd: new Date(Date.now() + DAY),
    });
    expect(useSubscriptionStore.getState().getPlan()).toBe("team");
  });

  it("구독 문서가 없으면 free", () => {
    setSub(null);
    expect(useSubscriptionStore.getState().getPlan()).toBe("free");
  });

  it("레거시: active + currentPeriodEnd 없음 → 유료 유지(무회귀)", () => {
    setSub({ status: "active", planType: "pro" });
    expect(useSubscriptionStore.getState().getPlan()).toBe("pro");
  });

  it("환불로 planType 이 free 가 된 문서는 잔여 기간이 있어도 free", () => {
    setSub({
      status: "canceled",
      planType: "free",
      currentPeriodEnd: new Date(Date.now() + 29 * DAY),
    });
    expect(useSubscriptionStore.getState().getPlan()).toBe("free");
  });

  it("Firestore Timestamp 형태(toMillis)도 해석한다", () => {
    const endMs = Date.now() + 10 * DAY;
    setSub({
      status: "canceled",
      planType: "pro",
      currentPeriodEnd: { toMillis: () => endMs },
    });
    expect(useSubscriptionStore.getState().getPlan()).toBe("pro");
  });

  it("canUse 도 해지 후 잔여 기간 동안 유료 기능을 열어준다", () => {
    setSub({
      status: "canceled",
      planType: "pro",
      currentPeriodEnd: new Date(Date.now() + 29 * DAY),
    });
    expect(useSubscriptionStore.getState().canUse("flows")).toBe(true);
  });

  it("잔여 기간이 끝나면 유료 기능이 닫힌다", () => {
    setSub({
      status: "canceled",
      planType: "pro",
      currentPeriodEnd: new Date(Date.now() - DAY),
    });
    expect(useSubscriptionStore.getState().canUse("flows")).toBe(false);
  });
});
