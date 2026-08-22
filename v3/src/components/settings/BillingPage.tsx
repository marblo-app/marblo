/**
 * 설정 → 플랜 및 결제.
 *
 * ★국내 결제는 이 화면에서 처리하지 않는다 — 기본 브라우저의 웹 체크아웃
 * (marblo-web /checkout, 포트원·KG이니시스)으로 넘긴다. 이유는 lib/checkoutLink.ts
 * 상단 주석에 길게 적어뒀다. 요약하면:
 *   · 예전엔 토스페이먼츠 SDK 를 이 렌더러에 임베드하고 successUrl 을
 *     `${window.location.origin}/settings/billing?toss_success=true` 로 줬는데,
 *     Electron 에서 그 origin 은 앱 자신의 로더라 PG 리다이렉트가 돌아오지 않았다.
 *   · 포트원 SDK 로 갈아끼워도 리다이렉트·3DS·PG 팝업은 그대로라 같은 함정이다.
 *   · 웹 체크아웃은 이미 있고 실제 테스트 결제를 완주한 유일한 경로다. 앱에
 *     두 번째 결제 구현을 두면 둘 중 하나만 고쳐지는 상태가 반드시 온다.
 *
 * 결제 후 상태 갱신은 별도 폴링을 새로 만들지 않는다 — 이 화면은 이미
 * subscribeToSubscription(onSnapshot) 을 걸고 있어 서버가 subscriptions 문서를
 * 쓰는 순간 반영된다. 브라우저를 다녀오는 동안 렌더러가 백그라운드로 눌려 있을
 * 수 있으므로, 창 포커스 복귀 시 1회 재조회 + 수동 새로고침 버튼을 덧댄다.
 *
 * 해외 결제(Paddle)는 그대로다 — 오버레이 체크아웃이라 리다이렉트를 타지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import { buildWebCheckoutUrl } from "../../lib/checkoutLink";
import type { MessageKey } from "../../locales/ko";
import type {
  PlanType,
  Subscription,
  PaymentProvider,
} from "../../types/subscription";
import {
  subscribeToSubscription,
  getSubscription,
  openPaddleCheckout,
  cancelSubscription,
  PLAN_PRICES_KRW,
} from "../../services/billingService";

interface PlanCard {
  type: PlanType;
  name: string;
  // Currency amount only; the locale-specific unit suffix (/mo, /seat/mo)
  // is appended at render via priceUnitKey so it localizes.
  priceUSD: string;
  priceKRW: string;
  priceUnitKey?: MessageKey;
  // i18n keys (billing.feature.*) — translated at render with t().
  featureKeys: MessageKey[];
}

const PLANS: PlanCard[] = [
  {
    type: "free",
    name: "Free",
    priceUSD: "$0",
    priceKRW: "₩0",
    featureKeys: [
      "billing.feature.projects1",
      "billing.feature.agents2",
      "billing.feature.mcpBasic",
    ],
  },
  {
    type: "pro",
    name: "Pro",
    priceUSD: "$15",
    priceKRW: "₩19,000",
    priceUnitKey: "billing.data.unit.perMonth",
    featureKeys: [
      "billing.feature.projects3",
      "billing.feature.agents5",
      "billing.feature.flowEditor",
      "billing.feature.orchestrator",
    ],
  },
  {
    type: "team",
    name: "Team",
    priceUSD: "$25",
    priceKRW: "₩29,000",
    priceUnitKey: "billing.data.unit.perSeatMonth",
    featureKeys: [
      "billing.feature.projectsUnlimited",
      "billing.feature.agentsUnlimited",
      "billing.feature.teamCollab",
      "billing.feature.orchestrator",
      "billing.feature.prioritySupport",
    ],
  },
  {
    type: "team_plus",
    name: "Team Plus",
    priceUSD: "$245",
    priceKRW: "₩290,000",
    priceUnitKey: "billing.data.unit.perMonth",
    featureKeys: [
      "billing.feature.sso",
      "billing.feature.auditLog",
      "billing.feature.prioritySupportSlack",
      "billing.feature.seatsIncluded",
      "billing.feature.allTeamFeatures",
    ],
  },
];

// Paddle Price IDs (Paddle 대시보드에서 생성 후 .env에 설정)
const PADDLE_PRICE_IDS: Record<string, string> = {
  pro: import.meta.env.VITE_PADDLE_PRO_PRICE_ID || "",
  team: import.meta.env.VITE_PADDLE_TEAM_PRICE_ID || "",
};

type PaymentMethod = "portone" | "paddle";

// 국내 4종(card_kr·naverpay·kakaopay·tosspay)은 전부 provider:"toss" 였고,
// 전부 이 컴포넌트가 직접 띄우는 토스 SDK 로 흘렀다. 그 경로를 걷어내면서
// 목록에서도 지웠다 — 국내 결제는 웹 체크아웃 진입점 하나로 합쳐진다.
// 개별 수단(카드/네이버페이/카카오페이/토스페이) 선택은 웹 체크아웃이 맡는다.
//
// ★그래서 이 목록에는 provider:"toss" 항목이 없다. 토스 진입 차단
// (billingService 의 filterAvailablePaymentMethods)이 걸러낼 대상 자체가
// 남지 않았다 — 가리는 게 아니라 없앤 것이다.
const PAYMENT_METHODS: {
  id: PaymentMethod;
  labelKey: MessageKey;
  descKey: MessageKey;
  provider: PaymentProvider;
  icon: string;
}[] = [
  {
    id: "portone",
    labelKey: "billing.data.method.portoneKr",
    descKey: "billing.method.portone.desc",
    provider: "portone",
    icon: "💳",
  },
  {
    id: "paddle",
    labelKey: "billing.data.method.paddle",
    descKey: "billing.method.paddle.desc",
    provider: "paddle",
    icon: "🌍",
  },
];

// 결제사 표시 라벨. 예전엔 `toss ? 토스 : "Paddle"` 이라 PortOne 구독이
// "Paddle" 로 오표시됐다. 런타임 구독 문서에는 타입에 없는 값(founder_grant 등)도
// 들어올 수 있으므로 조회 실패 시 provider 코드를 그대로 보여준다.
const PROVIDER_LABEL_KEYS: Record<PaymentProvider, MessageKey> = {
  toss: "billing.data.provider.toss",
  portone: "billing.data.provider.portone",
  paddle: "billing.data.provider.paddle",
};

export function BillingPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);
  // 국내 결제가 기본 선택 — 앱의 1차 시장이고, 해외(Paddle)는 명시 선택이다.
  const [selectedMethod, setSelectedMethod] =
    useState<PaymentMethod>("portone");
  // 결제 수단 모달 안에서 보여줄 오류. 예전엔 console.error 로만 남아서
  // "결제하기를 눌렀는데 아무 일도 안 일어남" 으로 보였다(Paddle priceId 미설정).
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // 브라우저로 웹 체크아웃을 넘긴 뒤의 대기 상태. url 을 들고 있는 이유는
  // "결제창을 실수로 닫음" 이 흔해서 — 다시 열기가 한 번의 클릭이어야 한다.
  const [pendingCheckout, setPendingCheckout] = useState<{
    plan: PlanType;
    url: string;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 취소 확인 모달 상태. 네이티브 confirm/alert 은 Electron 렌더러를 통째로
  // 블로킹하고 웹(my/subscription)의 인라인 확인 UX 와도 어긋나서 쓰지 않는다.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // 취소 성공 후 기간말 접근(entitlement) 안내 — callable 이 돌려준 accessUntil.
  const [cancelResult, setCancelResult] = useState<{
    alreadyCanceled: boolean;
    accessUntil: Date | null;
  } | null>(null);

  const currentPlan = subscription?.planType ?? "free";

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToSubscription(user.uid, (sub) => {
      setSubscription(sub);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  /**
   * 구독 문서 1회 재조회. onSnapshot 이 정본이고 이건 보조다 — 브라우저를
   * 다녀오는 동안 렌더러가 백그라운드로 눌려 스냅샷이 늦게 도착하는 경우와,
   * 사용자가 "지금 확인해줘" 라고 누르는 경우를 위해 둔다.
   */
  const refreshSubscription = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      setSubscription(await getSubscription(user.uid));
    } catch (err) {
      // 조회 실패는 화면을 막지 않는다 — onSnapshot 이 계속 살아 있다.
      console.error("구독 상태 조회 실패:", err);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  const handleUpgrade = (planType: PlanType) => {
    if (!user || planType === "free") return;
    setPaymentError(null);
    setSelectedPlan(planType);
  };

  /** 국내 결제 — 웹 체크아웃을 기본 브라우저로 연다(결제는 앱 밖에서 끝난다). */
  const openWebCheckout = (plan: PlanType): boolean => {
    const url = buildWebCheckoutUrl({ plan, locale });
    if (!url) {
      // free/enterprise. 플랜 카드가 그 둘에 업그레이드 버튼을 주지 않으므로
      // 정상 경로로는 오지 않지만, 조용히 아무 일도 안 하는 것보다는 낫다.
      setPaymentError(t("billing.error.checkoutUnavailable"));
      return false;
    }
    // main 의 setWindowOpenHandler 가 외부 https + _blank 를 shell.openExternal
    // 로 넘긴다(새 IPC 없음 — installAttribution/WorktreeTab 과 같은 경로).
    window.open(url, "_blank");
    setPendingCheckout({ plan, url });
    return true;
  };

  const handlePayment = async () => {
    if (!user || !selectedPlan) return;

    const method = PAYMENT_METHODS.find((m) => m.id === selectedMethod);
    if (!method) return;

    setPaymentError(null);

    if (method.provider === "portone") {
      // 브라우저로 넘기는 것은 동기다. actionLoading 을 걸면 되돌릴 시점이
      // 없어서(결제 완료를 앱이 관측하지 못한다) 아예 걸지 않는다.
      if (openWebCheckout(selectedPlan)) setSelectedPlan(null);
      return;
    }

    // 해외 결제(Paddle) — 오버레이 체크아웃이라 앱 안에서 그대로 끝난다.
    setActionLoading(true);
    try {
      const priceId = PADDLE_PRICE_IDS[selectedPlan];
      if (!priceId) {
        console.error("Paddle Price ID가 설정되지 않았습니다.");
        setPaymentError(t("billing.error.paddleNotConfigured"));
        return;
      }
      await openPaddleCheckout(user.uid, priceId, user.email || undefined);
      setSelectedPlan(null);
    } catch (err) {
      // openPaddleCheckout 은 사용자가 창을 닫아도 reject 한다 — 그건 오류가 아니다.
      const canceled =
        (err as Error).message === t("common.payment.checkoutCanceled");
      if (!canceled) {
        console.error("결제 처리 실패:", err);
        setPaymentError(t("billing.error.paddleFailed"));
      } else {
        setSelectedPlan(null);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // 웹 체크아웃을 다녀오면 앱 창이 다시 포커스를 받는다. 그때 1회 재조회한다.
  // onSnapshot 이 이미 반영했다면 같은 값을 다시 쓰는 것뿐이라 비용이 없다.
  useEffect(() => {
    if (!user || !pendingCheckout) return;
    const onFocus = () => {
      void refreshSubscription();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshSubscription();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, pendingCheckout, refreshSubscription]);

  // 결제가 실제로 반영되면 대기 안내를 스스로 접는다. 판정 기준은 "결제했다"
  // 라는 앱의 추측이 아니라 **서버가 쓴 구독 문서**다 — 앱은 결제 결과를
  // 직접 관측하지 못하므로 이것만이 믿을 수 있는 신호다.
  useEffect(() => {
    if (!pendingCheckout) return;
    if (
      subscription?.planType === pendingCheckout.plan &&
      subscription.status !== "canceled"
    ) {
      setPendingCheckout(null);
    }
  }, [subscription, pendingCheckout]);

  const handleManageSubscription = async () => {
    if (!user || !subscription) return;
    // Paddle: 고객 포털. toss/portone: 지원 알림 없이 실제 해지(단일 cancelSubscription).
    if (
      subscription.paymentProvider === "paddle" &&
      subscription.paddleSubscriptionId
    ) {
      setActionLoading(true);
      try {
        const updateUrl = `https://customer-portal.paddle.com/subscriptions/${subscription.paddleSubscriptionId}`;
        window.open(updateUrl, "_blank");
      } catch (err) {
        console.error("구독 관리 실패:", err);
      } finally {
        setActionLoading(false);
      }
      return;
    }
    openCancelModal();
  };

  const openCancelModal = () => {
    if (!user || !subscription) return;
    if (subscription.status === "canceled") return;
    setCancelError(null);
    setCancelResult(null);
    setConfirmingCancel(true);
  };

  const closeCancelModal = () => {
    if (canceling) return;
    setConfirmingCancel(false);
    setCancelError(null);
    setCancelResult(null);
  };

  const handleCancelSubscription = async () => {
    if (!user || !subscription) return;
    if (subscription.status === "canceled") return;

    setCanceling(true);
    setCancelError(null);
    try {
      // provider 분기 없는 단일 callable — toss/portone/paddle 모두 서버에서 처리.
      // 웹 my/subscription 과 동일 경로.
      const result = await cancelSubscription();
      // 서버가 준 accessUntil 을 우선 쓰고(취소 시점의 정본), 없으면 구독 문서의
      // currentPeriodEnd 로 폴백한다.
      const accessUntil = result.accessUntil
        ? new Date(result.accessUntil)
        : subscription.currentPeriodEnd ?? null;
      setCancelResult({
        alreadyCanceled: result.alreadyCanceled === true,
        accessUntil:
          accessUntil && !isNaN(accessUntil.getTime()) ? accessUntil : null,
      });
    } catch (err) {
      console.error("구독 취소 실패:", err);
      setCancelError(t("billing.alert.cancelFailed"));
    } finally {
      setCanceling(false);
    }
  };

  const providerLabel = (provider: PaymentProvider) => {
    const key = PROVIDER_LABEL_KEYS[provider];
    return key ? t(key) : provider;
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString(
      locale === "ko" ? "ko-KR" : "en-US",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      }
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">
        {t("billing.title")}
      </h1>

      {/* 현재 플랜 정보 */}
      <div className="mb-8 rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">{t("billing.currentPlan")}</p>
            <p className="text-lg font-semibold text-white capitalize">
              {currentPlan}
              {subscription?.paymentProvider && currentPlan !== "free" && (
                <span className="ml-2 text-xs text-gray-500">
                  ({providerLabel(subscription.paymentProvider)})
                </span>
              )}
              {subscription?.status === "past_due" && (
                <span className="ml-2 text-sm text-yellow-400">
                  ({t("billing.status.pastDue")})
                </span>
              )}
              {subscription?.status === "canceled" && (
                <span className="ml-2 text-sm text-red-400">
                  ({t("billing.status.canceled")})
                </span>
              )}
            </p>
          </div>
          {subscription?.currentPeriodEnd && (
            <div className="text-right">
              <p className="text-sm text-gray-400">
                {subscription.status === "canceled"
                  ? t("billing.accessUntil")
                  : subscription.status === "past_due"
                  ? t("billing.periodEndPastDue")
                  : t("billing.nextBillingDate")}
              </p>
              <p className="text-sm text-white">
                {formatDate(subscription.currentPeriodEnd)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 웹 체크아웃 대기 안내 — 국내 결제는 브라우저에서 끝난다.
          결제 결과를 앱이 직접 보지 못하므로, 서버가 구독 문서를 쓸 때까지
          "무슨 일이 벌어지고 있는지" 를 사용자에게 말해주는 자리다. */}
      {pendingCheckout && (
        <div
          role="status"
          className="mb-8 rounded-lg border border-blue-700 bg-blue-950/40 p-4"
        >
          <p className="text-sm font-medium text-white">
            {t("billing.webCheckout.heading")}
          </p>
          <p className="mt-1 text-xs text-gray-300">
            {t("billing.webCheckout.desc", {
              plan:
                pendingCheckout.plan.charAt(0).toUpperCase() +
                pendingCheckout.plan.slice(1),
            })}
          </p>
          {user?.email && (
            <p className="mt-1 text-xs text-gray-400">
              {t("billing.webCheckout.account", { email: user.email })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => window.open(pendingCheckout.url, "_blank")}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-700"
            >
              {t("billing.webCheckout.reopen")}
            </button>
            <button
              onClick={() => void refreshSubscription()}
              disabled={refreshing}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
            >
              {refreshing
                ? t("billing.webCheckout.refreshing")
                : t("billing.webCheckout.refresh")}
            </button>
            <button
              onClick={() => setPendingCheckout(null)}
              className="rounded px-3 py-1.5 text-xs text-gray-400 transition-colors hover:text-gray-200"
            >
              {t("billing.webCheckout.dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* 플랜 카드 */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.type;
          const isUpgrade =
            plan.type !== "free" &&
            (currentPlan === "free" ||
              (currentPlan === "pro" && plan.type === "team"));

          return (
            <div
              key={plan.type}
              className={`rounded-lg border p-5 transition-colors ${
                isCurrent
                  ? "border-blue-500 bg-gray-800"
                  : "border-gray-700 bg-gray-800 hover:border-gray-600"
              }`}
            >
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-1 text-2xl font-bold text-white">
                {plan.priceKRW}
                {plan.priceUnitKey ? t(plan.priceUnitKey) : ""}
              </p>
              <p className="text-xs text-gray-500">
                {plan.priceUSD}
                {plan.priceUnitKey ? t(plan.priceUnitKey) : ""}
              </p>

              <ul className="mt-4 space-y-2">
                {plan.featureKeys.map((featKey) => (
                  <li
                    key={featKey}
                    className="flex items-center gap-2 text-sm text-gray-300"
                  >
                    <svg
                      className="h-4 w-4 flex-shrink-0 text-blue-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {t(featKey)}
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <span className="block w-full rounded bg-gray-700 py-2 text-center text-sm text-gray-400">
                    {t("billing.currentPlanBadge")}
                  </span>
                ) : isUpgrade ? (
                  <button
                    onClick={() => handleUpgrade(plan.type)}
                    disabled={actionLoading}
                    className="block w-full rounded bg-blue-600 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {t("billing.upgrade")}
                  </button>
                ) : (
                  <span className="block w-full rounded bg-gray-700 py-2 text-center text-sm text-gray-500">
                    -
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 결제 수단 선택 모달 */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {t("billing.selectPaymentMethod")}
              </h2>
              <button
                onClick={() => {
                  setSelectedPlan(null);
                  setPaymentError(null);
                }}
                aria-label={t("billing.cancel.close")}
                className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-400">
              {t("billing.modal.planLabel", {
                plan:
                  selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1),
              })}{" "}
              —{" "}
              <span className="text-white font-medium">
                {t("billing.modal.amountPerMonth", {
                  amount:
                    PLAN_PRICES_KRW[
                      selectedPlan as keyof typeof PLAN_PRICES_KRW
                    ]?.toLocaleString() ?? "",
                })}
              </span>
            </p>

            <div className="space-y-2">
              {PAYMENT_METHODS.map((method) => (
                <label
                  key={method.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedMethod === method.id
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={method.id}
                    checked={selectedMethod === method.id}
                    onChange={() => setSelectedMethod(method.id)}
                    className="sr-only"
                  />
                  <span className="text-lg">{method.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-200">
                      {t(method.labelKey)}
                    </span>
                    {/* 어디서 결제가 벌어지는지를 미리 말해준다 — 국내 결제는
                        앱을 벗어나 브라우저로 간다. 누른 뒤에 알게 되면 사고다. */}
                    <span className="block text-xs text-gray-500">
                      {t(method.descKey)}
                    </span>
                  </span>
                  {selectedMethod === method.id && (
                    <svg
                      className="ml-auto h-5 w-5 text-blue-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </label>
              ))}
            </div>

            {paymentError && (
              <p
                role="alert"
                className="mt-4 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300"
              >
                {paymentError}
              </p>
            )}

            <button
              onClick={handlePayment}
              disabled={actionLoading}
              className="mt-5 w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading ? t("billing.processing") : t("billing.pay")}
            </button>
          </div>
        </div>
      )}

      {/* 구독 관리 — free 강등·이미 해지 시 숨김. past_due 도 해지 가능. */}
      {currentPlan !== "free" && subscription?.status !== "canceled" && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">
                {t("billing.manage.heading")}
              </p>
              <p className="text-xs text-gray-400">
                {subscription?.status === "past_due"
                  ? t("billing.manage.descPastDue")
                  : t("billing.manage.desc")}
              </p>
            </div>
            <div className="flex gap-2">
              {subscription?.paymentProvider === "paddle" && (
                <button
                  onClick={handleManageSubscription}
                  disabled={actionLoading}
                  className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
                >
                  {t("billing.manage.button")}
                </button>
              )}
              <button
                onClick={openCancelModal}
                disabled={actionLoading || canceling}
                className="rounded border border-red-800 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/30 disabled:opacity-50"
              >
                {t("billing.cancelSubscription")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 구독 취소 확인 모달 — 확인 → 취소 → 기간말 접근 안내까지 한 자리에서.
          past_due 는 "재시도 청구 중단·환불 없음" 문구로 갈린다. */}
      {confirmingCancel && subscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-6">
            <h2 className="mb-3 text-lg font-semibold text-white">
              {cancelResult
                ? cancelResult.alreadyCanceled
                  ? t("billing.cancel.doneAlreadyTitle")
                  : t("billing.cancel.doneTitle")
                : t("billing.cancel.modalTitle")}
            </h2>

            {cancelResult ? (
              <>
                <p className="text-sm text-gray-300">
                  {cancelResult.accessUntil
                    ? t("billing.cancel.doneAccessUntil", {
                        date: formatDate(cancelResult.accessUntil),
                      })
                    : t("billing.cancel.doneNoPeriod")}
                </p>
                <button
                  onClick={closeCancelModal}
                  className="mt-5 w-full rounded-lg bg-gray-700 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-600"
                >
                  {t("billing.cancel.close")}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-300">
                  {subscription.status === "past_due"
                    ? t("billing.confirm.cancelPastDue")
                    : t("billing.confirm.cancel")}
                </p>

                {cancelError && (
                  <p className="mt-3 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                    {cancelError}
                  </p>
                )}

                <div className="mt-5 flex gap-2">
                  <button
                    onClick={closeCancelModal}
                    disabled={canceling}
                    className="flex-1 rounded-lg border border-gray-600 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
                  >
                    {t("billing.cancel.keep")}
                  </button>
                  <button
                    onClick={handleCancelSubscription}
                    disabled={canceling}
                    className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {canceling
                      ? t("billing.cancel.canceling")
                      : t("billing.cancel.confirm")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
