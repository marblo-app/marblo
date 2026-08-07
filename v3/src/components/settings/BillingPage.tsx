import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type {
  PlanType,
  Subscription,
  PaymentProvider,
} from "../../types/subscription";
import {
  subscribeToSubscription,
  openPaddleCheckout,
  cancelSubscription,
  createTossCheckout,
  confirmTossPayment,
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

type PaymentMethod = "paddle" | "card_kr" | "naverpay" | "kakaopay" | "tosspay";

const PAYMENT_METHODS: {
  id: PaymentMethod;
  labelKey: MessageKey;
  provider: PaymentProvider;
  icon: string;
}[] = [
  {
    id: "paddle",
    labelKey: "billing.data.method.paddle",
    provider: "paddle",
    icon: "🌍",
  },
  {
    id: "card_kr",
    labelKey: "billing.data.method.cardKr",
    provider: "toss",
    icon: "💳",
  },
  {
    id: "naverpay",
    labelKey: "billing.data.method.naverpay",
    provider: "toss",
    icon: "🟢",
  },
  {
    id: "kakaopay",
    labelKey: "billing.data.method.kakaopay",
    provider: "toss",
    icon: "🟡",
  },
  {
    id: "tosspay",
    labelKey: "billing.data.method.tosspay",
    provider: "toss",
    icon: "🔵",
  },
];

export function BillingPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);
  const [selectedMethod, setSelectedMethod] =
    useState<PaymentMethod>("card_kr");

  const currentPlan = subscription?.planType ?? "free";

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToSubscription(user.uid, (sub) => {
      setSubscription(sub);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  const handleUpgrade = (planType: PlanType) => {
    if (!user || planType === "free") return;
    setSelectedPlan(planType);
  };

  const handlePayment = async () => {
    if (!user || !selectedPlan) return;
    setActionLoading(true);

    const method = PAYMENT_METHODS.find((m) => m.id === selectedMethod);
    if (!method) return;

    try {
      if (method.provider === "paddle") {
        const priceId = PADDLE_PRICE_IDS[selectedPlan];
        if (!priceId) {
          console.error("Paddle Price ID가 설정되지 않았습니다.");
          return;
        }
        await openPaddleCheckout(user.uid, priceId, user.email || undefined);
      } else {
        // TossPayments
        const { orderId, amount } = await createTossCheckout(
          user.uid,
          selectedPlan
        );
        await loadTossPaymentsSDK();
        const tossPayments = window.TossPayments!(
          import.meta.env.VITE_TOSS_CLIENT_KEY
        );
        const payment = tossPayments.payment({ customerKey: user.uid });

        const methodMap: Record<string, string> = {
          card_kr: "CARD",
          naverpay: "NAVERPAY",
          kakaopay: "KAKAOPAY",
          tosspay: "TOSSPAY",
        };

        const result = await payment.requestPayment({
          method: methodMap[selectedMethod] || "CARD",
          amount: { currency: "KRW", value: amount },
          orderId,
          orderName: `Marblo ${
            selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)
          } 플랜`,
          successUrl: `${window.location.origin}/settings/billing?toss_success=true`,
          failUrl: `${window.location.origin}/settings/billing?toss_fail=true`,
        });

        if (result?.paymentKey) {
          await confirmTossPayment(orderId, result.paymentKey, amount);
        }
      }
    } catch (err) {
      if ((err as Error).message !== "결제 취소") {
        console.error("결제 처리 실패:", err);
      }
    } finally {
      setActionLoading(false);
      setSelectedPlan(null);
    }
  };

  // Handle TossPayments redirect callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("toss_success") === "true") {
      const paymentKey = params.get("paymentKey");
      const orderId = params.get("orderId");
      const amount = params.get("amount");
      if (paymentKey && orderId && amount) {
        confirmTossPayment(orderId, paymentKey, Number(amount))
          .then(() => {
            window.history.replaceState({}, "", "/settings/billing");
          })
          .catch(console.error);
      }
    }
  }, []);

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
    await handleCancelSubscription();
  };

  const handleCancelSubscription = async () => {
    if (!user || !subscription) return;
    if (subscription.status === "canceled") return;

    const confirmKey =
      subscription.status === "past_due"
        ? "billing.confirm.cancelPastDue"
        : "billing.confirm.cancel";
    if (!confirm(t(confirmKey))) return;

    setActionLoading(true);
    try {
      // provider 분기 없는 단일 callable — toss/portone/paddle 모두 서버에서 처리.
      await cancelSubscription();
    } catch (err) {
      console.error("구독 취소 실패:", err);
      alert(t("billing.alert.cancelFailed"));
    } finally {
      setActionLoading(false);
    }
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
                  (
                  {subscription.paymentProvider === "toss"
                    ? t("billing.data.provider.toss")
                    : "Paddle"}
                  )
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
                onClick={() => setSelectedPlan(null)}
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
                  <span className="text-sm text-gray-200">
                    {t(method.labelKey)}
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
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="rounded border border-red-800 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/30 disabled:opacity-50"
              >
                {t("billing.cancelSubscription")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TossPayments SDK Loader ─────────────────────────────────────
interface TossPaymentMethods {
  requestPayment(options: {
    method: string;
    amount: { currency: string; value: number };
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<{ paymentKey?: string } | undefined>;
}

interface TossPaymentsInstance {
  payment(options: { customerKey: string }): TossPaymentMethods;
}

type TossPaymentsSDK = (clientKey: string) => TossPaymentsInstance;

declare global {
  interface Window {
    TossPayments?: TossPaymentsSDK;
  }
}

let tossSDKLoaded = false;

function loadTossPaymentsSDK(): Promise<void> {
  if (tossSDKLoaded || window.TossPayments) {
    tossSDKLoaded = true;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.tosspayments.com/v2/standard";
    script.onload = () => {
      tossSDKLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("TossPayments SDK 로드 실패"));
    document.head.appendChild(script);
  });
}
