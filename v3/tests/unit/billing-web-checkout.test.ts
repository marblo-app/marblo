/**
 * @vitest-environment jsdom
 *
 * BillingPage 국내 결제 — 웹 체크아웃 핸드오프 배선 회귀 테스트 (티켓 ZVg1OC3C).
 *
 * 이 화면의 국내 결제는 원래 **토스페이먼츠 SDK 를 렌더러에 직접 임베드**하고
 * `successUrl: ${window.location.origin}/settings/billing?toss_success=true`
 * 로 리다이렉트를 기대했다. Electron 에서 그 origin 은 앱 자신의 로더라
 * 결제 결과가 앱으로 돌아오지 않는다 — 웹 기준 코드가 데스크톱에 그대로
 * 들어와 있었던 것이다.
 *
 * 그래서 여기서 못박는 건 "결제가 된다"가 아니라 **어디서 결제가 벌어지는가** 다:
 *   - 국내 결제 = 기본 브라우저의 웹 체크아웃(포트원). 앱은 SDK 를 안 띄운다.
 *   - 그 URL 에 provider=portone 이 명시된다(웹 기본값에 기대지 않는다).
 *   - 결제 완료 판정은 앱의 추측이 아니라 **서버가 쓴 구독 문서** 로 한다.
 *   - ★해외 결제(Paddle) 경로는 회귀 0 — 여전히 앱 안 오버레이 체크아웃이다.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Paddle Price ID 는 빌드 타임 env 라 모듈 로드 시점에 상수로 굳는다.
// vi.hoisted 는 import 보다 먼저 돈다 — 여기서 심어야 BillingPage 가 본다.
// 이걸 안 하면 Paddle 경로가 "미설정" 분기로 빠져 회귀 테스트가 헛돈다.
vi.hoisted(() => {
  vi.stubEnv("VITE_PADDLE_PRO_PRICE_ID", "pri_test_pro");
});
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

const billingMock = vi.hoisted(() => ({
  subscription: null as Subscription | null,
  /** onSnapshot 구독자 — 서버가 구독 문서를 쓰는 순간을 흉내 낸다. */
  emit: null as ((sub: Subscription | null) => void) | null,
  openPaddleCheckout: vi.fn(),
  getSubscription: vi.fn(),
}));

vi.mock("../../src/services/billingService", () => ({
  subscribeToSubscription: (
    _uid: string,
    cb: (sub: Subscription | null) => void,
  ) => {
    billingMock.emit = (sub) => {
      // 재구독(리렌더)이 옛 값으로 되돌리지 않도록 저장값도 함께 옮긴다.
      billingMock.subscription = sub;
      cb(sub);
    };
    cb(billingMock.subscription);
    return () => {};
  },
  getSubscription: (...args: unknown[]) => billingMock.getSubscription(...args),
  openPaddleCheckout: (...args: unknown[]) =>
    billingMock.openPaddleCheckout(...args),
  cancelSubscription: vi.fn(),
  PLAN_PRICES_KRW: { pro: 19000, team: 29000, team_plus: 290000 },
}));

// ★렌더마다 새 객체를 돌려주면 안 된다 — subscribeToSubscription 의 effect
// 의존성이 user 라, 매 렌더 재구독하며 구독 상태가 초기값으로 되돌아간다.
// 실제 useAuth 는 AuthContext 값을 그대로 돌려주므로 참조가 안정적이다.
const authMock = vi.hoisted(() => ({
  user: { uid: "user-1", email: "u@example.com" },
  logout: vi.fn(),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => authMock,
}));

import { BillingPage } from "../../src/components/settings/BillingPage";
import { useLocaleStore } from "../../src/lib/i18n";
import { WEB_CHECKOUT_BASE_URL } from "../../src/lib/checkoutLink";
import {
  ACCOUNT_HINT_PARAM,
  verifyAccountHint,
} from "../../src/lib/checkoutAccountHint";

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "user-1",
    userId: "user-1",
    planType: "pro",
    status: "active",
    paymentProvider: "portone",
    currentPeriodStart: new Date(Date.now() - 10 * DAY),
    currentPeriodEnd: new Date(Date.now() + 20 * DAY),
    createdAt: new Date(Date.now() - 40 * DAY),
    ...overrides,
  };
}

/** 브라우저 열기는 window.open → main 의 setWindowOpenHandler 경로다. */
function stubWindowOpen() {
  const openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
  return openSpy;
}

/** Free 사용자로 Pro 업그레이드 모달까지 연다. */
async function openPaymentModal() {
  render(createElement(BillingPage));
  fireEvent.click((await screen.findAllByText(ko["billing.upgrade"]))[0]);
  expect(
    await screen.findByText(ko["billing.selectPaymentMethod"]),
  ).toBeTruthy();
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  // 결제 전 상태 = 구독 문서 없음(Free).
  billingMock.subscription = null;
  billingMock.emit = null;
  billingMock.openPaddleCheckout.mockReset();
  billingMock.openPaddleCheckout.mockResolvedValue(undefined);
  billingMock.getSubscription.mockReset();
  billingMock.getSubscription.mockResolvedValue(null);
  authMock.logout.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("BillingPage 국내 결제 — 웹 체크아웃으로 넘긴다", () => {
  it("★결제수단 목록에 토스 4종이 없다 — 국내 결제 한 줄로 합쳐졌다", async () => {
    await openPaymentModal();

    // 국내 카드·네이버페이·카카오페이·토스페이는 전부 provider:"toss" 였고
    // 전부 인앱 토스 SDK 로 흘렀다. 라벨까지 함께 제거했다.
    for (const gone of ["국내 카드", "네이버페이", "카카오페이", "토스페이"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }

    expect(screen.getByText(ko["billing.data.method.portoneKr"])).toBeTruthy();
    expect(screen.getByText(ko["billing.data.method.paddle"])).toBeTruthy();
    // 어디서 결제가 벌어지는지 누르기 전에 말해준다.
    expect(screen.getByText(ko["billing.method.portone.desc"])).toBeTruthy();
  });

  it("★결제하기 → 브라우저로 포트원 웹 체크아웃을 연다(인앱 SDK 를 안 띄운다)", async () => {
    const openSpy = stubWindowOpen();
    await openPaymentModal();

    // 국내 결제가 기본 선택이다 — 그대로 결제하기.
    fireEvent.click(screen.getByText(ko["billing.pay"]));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    const [url, target] = openSpy.mock.calls[0];
    expect(url).toMatch(
      new RegExp(
        `^${WEB_CHECKOUT_BASE_URL}/checkout\\?plan=pro&provider=portone&billing=monthly&acct=`,
      ),
    );
    // _blank 여야 main 의 setWindowOpenHandler 가 shell.openExternal 로 넘긴다.
    expect(target).toBe("_blank");

    // 앱은 결제 콜러블을 직접 부르지 않는다 — 결제는 전부 웹/서버 몫이다.
    expect(billingMock.openPaddleCheckout).not.toHaveBeenCalled();

    // 브라우저를 다녀오는 동안 무슨 일이 벌어지는지 화면이 말해준다.
    expect(
      await screen.findByText(ko["billing.webCheckout.heading"]),
    ).toBeTruthy();
  });

  it("★결제 완료 판정은 서버가 쓴 구독 문서로 한다 — 그때 안내가 접힌다", async () => {
    stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    expect(
      await screen.findByText(ko["billing.webCheckout.heading"]),
    ).toBeTruthy();

    // 서버가 결제를 검증하고 subscriptions 문서를 쓴다 → onSnapshot 이 온다.
    billingMock.emit?.(makeSub({ planType: "pro" }));

    await waitFor(() =>
      expect(screen.queryByText(ko["billing.webCheckout.heading"])).toBeNull(),
    );
    // 현재 플랜 표시가 실제로 갱신된다(결제사 라벨은 포트원).
    expect(
      screen.getByText(ko["billing.data.provider.portone"], { exact: false }),
    ).toBeTruthy();
  });

  it("결제 안 하고 돌아와도 안내는 남고, 수동 새로고침은 재조회를 한다", async () => {
    stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);

    fireEvent.click(screen.getByText(ko["billing.webCheckout.refresh"]));

    await waitFor(() =>
      expect(billingMock.getSubscription).toHaveBeenCalledWith("user-1"),
    );
    // 아직 결제 전이므로(null) 안내는 그대로 남아 있어야 한다.
    expect(screen.getByText(ko["billing.webCheckout.heading"])).toBeTruthy();
  });

  it("창 포커스가 돌아오면 구독을 1회 재조회한다(백그라운드 스냅샷 지연 방어)", async () => {
    stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);

    fireEvent.focus(window);

    await waitFor(() =>
      expect(billingMock.getSubscription).toHaveBeenCalledWith("user-1"),
    );
  });

  it("결제창을 실수로 닫아도 ‘다시 열기’ 가 같은 URL 을 다시 연다", async () => {
    const openSpy = stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);

    fireEvent.click(screen.getByText(ko["billing.webCheckout.reopen"]));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2));
    expect(openSpy.mock.calls[1][0]).toBe(openSpy.mock.calls[0][0]);
  });
});

describe("BillingPage 국내 결제 — 계정 핸드오프 (티켓 3Notu54M)", () => {
  /**
   * 데스크톱 Firebase 세션(A)과 OS 브라우저 세션(B)은 별개다. URL 에 계정
   * 힌트가 없으면 B 로 결제되고 서버는 subscriptions/B 에 쓰는데 앱은
   * subscriptions/A 를 듣는다 — 앱은 영원히 Free 다. 폴링으로도 안 풀린다.
   */
  it("★체크아웃 URL 에 검증 가능한 계정 힌트가 실린다 — uid·email 원문은 아니다", async () => {
    const openSpy = stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));

    const url = new URL(openSpy.mock.calls[0][0] as string);
    const hint = url.searchParams.get(ACCOUNT_HINT_PARAM);
    expect(hint).toBeTruthy();
    // 웹이 로그인된 uid 로 재계산해 대조할 수 있다.
    expect(await verifyAccountHint(hint, "user-1")).toBe("match");
    expect(await verifyAccountHint(hint, "user-2")).toBe("mismatch");
    // ★원시 식별자는 어디에도 없다 — 브라우저 이력·리퍼러·어깨너머.
    expect(url.toString()).not.toContain("user-1");
    expect(url.toString()).not.toContain("u@example.com");
    expect(url.toString()).not.toContain(encodeURIComponent("u@example.com"));
  });

  it("★수동 새로고침 후에도 미반영이면 '계정 불일치 의심' 상태를 그린다 — 다음 행동과 함께", async () => {
    const openSpy = stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);

    // 사용자가 "결제했는데 왜 안 바뀌지?" 하고 직접 누른다 — 서버 문서는 여전히 없다(A 기준).
    fireEvent.click(screen.getByText(ko["billing.webCheckout.refresh"]));

    // 실패를 0 으로 그리지 않는다: 의심 상태가 뜬다.
    expect(
      await screen.findByText(ko["billing.webCheckout.unresolved.heading"]),
    ).toBeTruthy();
    // 다음 행동이 화면에 있다: 이 계정으로 다시 열기 / 결제한 계정으로 재로그인 / 아직 결제 안 함.
    const switchBtn = screen.getByText(
      ko["billing.webCheckout.unresolved.switchAccount"],
    );
    const reopenBtn = screen.getByText(
      ko["billing.webCheckout.unresolved.reopen"],
    );
    expect(screen.getByText(ko["billing.webCheckout.unresolved.notPaid"])).toBeTruthy();

    // 다시 열기 = 같은 URL(같은 계정 힌트) — 웹이 B 로 로그인돼 있으면 거기서 막는다.
    fireEvent.click(reopenBtn);
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2));
    expect(openSpy.mock.calls[1][0]).toBe(openSpy.mock.calls[0][0]);

    // 결제한 계정으로 앱에 다시 로그인 = 로그아웃으로 보낸다.
    fireEvent.click(switchBtn);
    await waitFor(() => expect(authMock.logout).toHaveBeenCalledTimes(1));
  });

  it("'아직 결제하지 않았어요' 는 의심 상태만 접고 대기 안내는 남긴다", async () => {
    stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);
    fireEvent.click(screen.getByText(ko["billing.webCheckout.refresh"]));
    await screen.findByText(ko["billing.webCheckout.unresolved.heading"]);

    fireEvent.click(screen.getByText(ko["billing.webCheckout.unresolved.notPaid"]));

    await waitFor(() =>
      expect(
        screen.queryByText(ko["billing.webCheckout.unresolved.heading"]),
      ).toBeNull(),
    );
    expect(screen.getByText(ko["billing.webCheckout.heading"])).toBeTruthy();
  });

  it("포커스 복귀 재조회만으로는 의심 상태를 띄우지 않는다(결제 도중 알트탭이 흔하다)", async () => {
    stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);

    fireEvent.focus(window);
    await waitFor(() =>
      expect(billingMock.getSubscription).toHaveBeenCalledWith("user-1"),
    );

    expect(
      screen.queryByText(ko["billing.webCheckout.unresolved.heading"]),
    ).toBeNull();
  });

  it("의심 상태에서도 서버가 구독 문서를 쓰면 전부 접힌다 — 판정은 여전히 문서다", async () => {
    stubWindowOpen();
    await openPaymentModal();
    fireEvent.click(screen.getByText(ko["billing.pay"]));
    await screen.findByText(ko["billing.webCheckout.heading"]);
    fireEvent.click(screen.getByText(ko["billing.webCheckout.refresh"]));
    await screen.findByText(ko["billing.webCheckout.unresolved.heading"]);

    billingMock.emit?.(makeSub({ planType: "pro" }));

    await waitFor(() =>
      expect(screen.queryByText(ko["billing.webCheckout.heading"])).toBeNull(),
    );
    expect(
      screen.queryByText(ko["billing.webCheckout.unresolved.heading"]),
    ).toBeNull();
  });
});

describe("BillingPage 해외 결제(Paddle) — 회귀 0", () => {
  it("★Paddle 은 그대로 앱 안 오버레이 체크아웃이다(브라우저를 열지 않는다)", async () => {
    const openSpy = stubWindowOpen();
    await openPaymentModal();

    fireEvent.click(screen.getByText(ko["billing.data.method.paddle"]));
    fireEvent.click(screen.getByText(ko["billing.pay"]));

    await waitFor(() =>
      expect(billingMock.openPaddleCheckout).toHaveBeenCalledTimes(1),
    );
    // uid·priceId·email 이 그대로 넘어간다(인자 순서가 이 경로의 계약이다).
    const [uid, priceId, email] = billingMock.openPaddleCheckout.mock.calls[0];
    expect(uid).toBe("user-1");
    expect(priceId).toBe("pri_test_pro");
    expect(email).toBe("u@example.com");

    // 해외 결제는 브라우저로 나가지 않는다 — 웹 체크아웃 핸드오프도 없다.
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(ko["billing.webCheckout.heading"])).toBeNull();
  });

  it("Paddle 실패는 조용히 삼키지 않고 모달 안 인라인 에러로 뜬다", async () => {
    stubWindowOpen();
    billingMock.openPaddleCheckout.mockRejectedValueOnce(new Error("boom"));
    await openPaymentModal();

    fireEvent.click(screen.getByText(ko["billing.data.method.paddle"]));
    fireEvent.click(screen.getByText(ko["billing.pay"]));

    // 예전엔 console.error 만 남아서 "눌렀는데 아무 일도 안 일어남" 이었다.
    expect(
      await screen.findByText(ko["billing.error.paddleFailed"]),
    ).toBeTruthy();
    // 모달이 닫히지 않아 그 자리에서 다시 시도할 수 있다.
    expect(screen.getByText(ko["billing.pay"])).toBeTruthy();
  });

  it("사용자가 Paddle 창을 닫은 것은 오류가 아니다(에러를 띄우지 않는다)", async () => {
    stubWindowOpen();
    billingMock.openPaddleCheckout.mockRejectedValueOnce(
      new Error(ko["common.payment.checkoutCanceled"]),
    );
    await openPaymentModal();

    fireEvent.click(screen.getByText(ko["billing.data.method.paddle"]));
    fireEvent.click(screen.getByText(ko["billing.pay"]));

    await waitFor(() =>
      expect(screen.queryByText(ko["billing.selectPaymentMethod"])).toBeNull(),
    );
    expect(screen.queryByText(ko["billing.error.paddleFailed"])).toBeNull();
  });
});
