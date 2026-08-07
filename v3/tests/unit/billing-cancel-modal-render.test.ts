/**
 * @vitest-environment jsdom
 *
 * BillingPage 구독 취소 — 실제 DOM 렌더 배선 회귀 테스트.
 *
 * 티켓 WtfctlpviFChIkvgzVZB. 이 화면의 취소 경로는 두 번 회귀했다:
 *   1) toss/portone 구독이 "고객센터로 문의" alert 로 막혀 있었고(#836 이전),
 *   2) 그 뒤엔 네이티브 confirm()/alert() 로 처리돼 Electron 렌더러를 통째로
 *      블로킹하고 웹(my/subscription)의 인라인 확인 UX 와 어긋났다.
 *
 * 그래서 여기서 못박는 건 "취소가 된다"가 아니라 **어떤 경로로 되는가** 다:
 *   - 네이티브 confirm/alert 을 절대 쓰지 않는다(둘 다 spy 로 0 호출 확인)
 *   - 확인은 앱 내 모달, 실행은 단일 cancelSubscription callable(웹과 동일)
 *   - 성공 후 기간말 접근(accessUntil) 안내를 실제로 렌더한다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import type { Subscription } from "../../src/types/subscription";
import { ko } from "../../src/locales/ko";

const DAY = 24 * 60 * 60 * 1000;
const PERIOD_END = new Date(Date.now() + 20 * DAY);

const billingMock = vi.hoisted(() => ({
  subscription: null as Subscription | null,
  cancelSubscription: vi.fn(),
}));

vi.mock("../../src/services/billingService", () => ({
  subscribeToSubscription: (
    _uid: string,
    cb: (sub: Subscription | null) => void,
  ) => {
    cb(billingMock.subscription);
    return () => {};
  },
  cancelSubscription: (...args: unknown[]) =>
    billingMock.cancelSubscription(...args),
  openPaddleCheckout: vi.fn(),
  createTossCheckout: vi.fn(),
  confirmTossPayment: vi.fn(),
  PLAN_PRICES_KRW: { pro: 19000, team: 29000, team_plus: 290000 },
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "user-1", email: "u@example.com" } }),
}));

import { BillingPage } from "../../src/components/settings/BillingPage";
import { useLocaleStore } from "../../src/lib/i18n";

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "user-1",
    userId: "user-1",
    planType: "pro",
    status: "active",
    paymentProvider: "portone",
    currentPeriodStart: new Date(Date.now() - 10 * DAY),
    currentPeriodEnd: PERIOD_END,
    createdAt: new Date(Date.now() - 40 * DAY),
    ...overrides,
  };
}

/** 네이티브 다이얼로그는 jsdom 에 구현이 없어 스텁해야 호출 여부를 볼 수 있다. */
function stubNativeDialogs() {
  const confirmSpy = vi.fn(() => true);
  const alertSpy = vi.fn();
  vi.stubGlobal("confirm", confirmSpy);
  vi.stubGlobal("alert", alertSpy);
  return { confirmSpy, alertSpy };
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  billingMock.subscription = makeSub();
  billingMock.cancelSubscription.mockReset();
  billingMock.cancelSubscription.mockResolvedValue({
    success: true,
    alreadyCanceled: false,
    provider: "portone",
    accessUntil: PERIOD_END.toISOString(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BillingPage 구독 취소 — 확인 모달 경로", () => {
  it("★취소 버튼은 네이티브 confirm 대신 앱 내 모달을 연다", async () => {
    const { confirmSpy } = stubNativeDialogs();
    render(createElement(BillingPage));

    fireEvent.click(await screen.findByText(ko["billing.cancelSubscription"]));

    // 모달 본문(확인 문구) + 두 버튼이 실제로 렌더돼야 한다.
    expect(await screen.findByText(ko["billing.confirm.cancel"])).toBeTruthy();
    expect(screen.getByText(ko["billing.cancel.keep"])).toBeTruthy();
    expect(screen.getByText(ko["billing.cancel.confirm"])).toBeTruthy();

    expect(confirmSpy).not.toHaveBeenCalled();
    // 확인 전에는 callable 이 절대 나가면 안 된다.
    expect(billingMock.cancelSubscription).not.toHaveBeenCalled();
  });

  it("★확인 시 단일 cancelSubscription callable 을 부르고 기간말 접근을 안내한다", async () => {
    const { confirmSpy, alertSpy } = stubNativeDialogs();
    render(createElement(BillingPage));

    fireEvent.click(await screen.findByText(ko["billing.cancelSubscription"]));
    fireEvent.click(screen.getByText(ko["billing.cancel.confirm"]));

    await waitFor(() =>
      expect(billingMock.cancelSubscription).toHaveBeenCalledTimes(1),
    );
    // provider 분기는 서버가 한다 — 클라이언트는 인자 없이 부른다(웹과 동일 경로).
    expect(billingMock.cancelSubscription).toHaveBeenCalledWith();

    expect(
      await screen.findByText(ko["billing.cancel.doneTitle"]),
    ).toBeTruthy();
    // 안내 문구에 서버가 준 accessUntil 날짜가 들어가야 한다.
    const notice = await screen.findByText(/까지 현재 플랜/);
    expect(notice.textContent).toContain(
      PERIOD_END.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("★취소 유지(‘구독 유지’)를 누르면 callable 이 나가지 않는다", async () => {
    render(createElement(BillingPage));

    fireEvent.click(await screen.findByText(ko["billing.cancelSubscription"]));
    fireEvent.click(screen.getByText(ko["billing.cancel.keep"]));

    await waitFor(() =>
      expect(screen.queryByText(ko["billing.confirm.cancel"])).toBeNull(),
    );
    expect(billingMock.cancelSubscription).not.toHaveBeenCalled();
  });

  it("★실패는 alert 이 아니라 모달 안 인라인 에러로 뜨고, 재시도가 가능하다", async () => {
    const { alertSpy } = stubNativeDialogs();
    billingMock.cancelSubscription.mockRejectedValueOnce(new Error("boom"));
    render(createElement(BillingPage));

    fireEvent.click(await screen.findByText(ko["billing.cancelSubscription"]));
    fireEvent.click(screen.getByText(ko["billing.cancel.confirm"]));

    expect(
      await screen.findByText(ko["billing.alert.cancelFailed"]),
    ).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    // 모달이 닫히지 않아 그 자리에서 다시 시도할 수 있다.
    expect(screen.getByText(ko["billing.cancel.confirm"])).toBeTruthy();
  });

  it("past_due 는 ‘재시도 청구 중단·환불 없음’ 문구로 갈린다", async () => {
    billingMock.subscription = makeSub({ status: "past_due" });
    render(createElement(BillingPage));

    fireEvent.click(await screen.findByText(ko["billing.cancelSubscription"]));

    expect(
      await screen.findByText(ko["billing.confirm.cancelPastDue"]),
    ).toBeTruthy();
    expect(screen.queryByText(ko["billing.confirm.cancel"])).toBeNull();
  });

  it("이미 해지된 구독은 멱등 성공을 별도 문구로 알린다", async () => {
    billingMock.cancelSubscription.mockResolvedValue({
      success: true,
      alreadyCanceled: true,
      provider: "toss",
      accessUntil: PERIOD_END.toISOString(),
    });
    render(createElement(BillingPage));

    fireEvent.click(await screen.findByText(ko["billing.cancelSubscription"]));
    fireEvent.click(screen.getByText(ko["billing.cancel.confirm"]));

    expect(
      await screen.findByText(ko["billing.cancel.doneAlreadyTitle"]),
    ).toBeTruthy();
  });
});

describe("BillingPage 결제사 라벨", () => {
  it("★PortOne 구독이 'Paddle' 로 오표시되지 않는다", async () => {
    billingMock.subscription = makeSub({ paymentProvider: "portone" });
    render(createElement(BillingPage));

    expect(
      await screen.findByText(`(${ko["billing.data.provider.portone"]})`),
    ).toBeTruthy();
    expect(screen.queryByText("(Paddle)")).toBeNull();
  });

  it("Toss 구독은 토스페이먼츠로 표시된다", async () => {
    billingMock.subscription = makeSub({ paymentProvider: "toss" });
    render(createElement(BillingPage));

    expect(
      await screen.findByText(`(${ko["billing.data.provider.toss"]})`),
    ).toBeTruthy();
  });
});
