import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { PlanType, Subscription, PaymentProvider } from '../../types/subscription';
import {
  subscribeToSubscription,
  openPaddleCheckout,
  cancelPaddleSubscription,
  createTossCheckout,
  confirmTossPayment,
  PLAN_PRICES_KRW,
} from '../../services/billingService';

interface PlanCard {
  type: PlanType;
  name: string;
  priceUSD: string;
  priceKRW: string;
  features: string[];
}

const PLANS: PlanCard[] = [
  {
    type: 'free',
    name: 'Free',
    priceUSD: '$0',
    priceKRW: '₩0',
    features: [
      '프로젝트 1개',
      '에이전트 2개',
      'MCP 기본 지원',
    ],
  },
  {
    type: 'pro',
    name: 'Pro',
    priceUSD: '$15/mo',
    priceKRW: '₩19,000/월',
    features: [
      '프로젝트 3개',
      '에이전트 5개',
      'Flow 에디터',
      '오케스트레이터',
    ],
  },
  {
    type: 'team',
    name: 'Team',
    priceUSD: '$25/인/월',
    priceKRW: '₩29,000/인/월',
    features: [
      '무제한 프로젝트',
      '무제한 에이전트',
      '팀 협업',
      '오케스트레이터',
      '우선 지원',
    ],
  },
  {
    type: 'team_plus',
    name: 'Team Plus',
    priceUSD: '$245/mo',
    priceKRW: '₩290,000/월',
    features: [
      'SSO (Auth0/Clerk)',
      '감사 로그 노출',
      '우선 지원 (Slack 채널)',
      '5시트 포함 · 추가 시트당 ₩59,000',
      '모든 Team 기능 포함',
    ],
  },
];

// Paddle Price IDs (Paddle 대시보드에서 생성 후 .env에 설정)
const PADDLE_PRICE_IDS: Record<string, string> = {
  pro: import.meta.env.VITE_PADDLE_PRO_PRICE_ID || '',
  team: import.meta.env.VITE_PADDLE_TEAM_PRICE_ID || '',
};

type PaymentMethod = 'paddle' | 'card_kr' | 'naverpay' | 'kakaopay' | 'tosspay';

const PAYMENT_METHODS: { id: PaymentMethod; label: string; provider: PaymentProvider; icon: string }[] = [
  { id: 'paddle', label: '해외 결제 (카드/PayPal)', provider: 'paddle', icon: '🌍' },
  { id: 'card_kr', label: '국내 카드', provider: 'toss', icon: '💳' },
  { id: 'naverpay', label: '네이버페이', provider: 'toss', icon: '🟢' },
  { id: 'kakaopay', label: '카카오페이', provider: 'toss', icon: '🟡' },
  { id: 'tosspay', label: '토스페이', provider: 'toss', icon: '🔵' },
];

export function BillingPage() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('card_kr');

  const currentPlan = subscription?.planType ?? 'free';

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToSubscription(user.uid, (sub) => {
      setSubscription(sub);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  const handleUpgrade = (planType: PlanType) => {
    if (!user || planType === 'free') return;
    setSelectedPlan(planType);
  };

  const handlePayment = async () => {
    if (!user || !selectedPlan) return;
    setActionLoading(true);

    const method = PAYMENT_METHODS.find(m => m.id === selectedMethod);
    if (!method) return;

    try {
      if (method.provider === 'paddle') {
        const priceId = PADDLE_PRICE_IDS[selectedPlan];
        if (!priceId) {
          console.error('Paddle Price ID가 설정되지 않았습니다.');
          return;
        }
        await openPaddleCheckout(user.uid, priceId, user.email || undefined);
      } else {
        // TossPayments
        const { orderId, amount } = await createTossCheckout(user.uid, selectedPlan);
        await loadTossPaymentsSDK();
        const tossPayments = window.TossPayments!(
          import.meta.env.VITE_TOSS_CLIENT_KEY
        );
        const payment = tossPayments.payment({ customerKey: user.uid });

        const methodMap: Record<string, string> = {
          card_kr: 'CARD',
          naverpay: 'NAVERPAY',
          kakaopay: 'KAKAOPAY',
          tosspay: 'TOSSPAY',
        };

        const result = await payment.requestPayment({
          method: methodMap[selectedMethod] || 'CARD',
          amount: { currency: 'KRW', value: amount },
          orderId,
          orderName: `Marblo ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} 플랜`,
          successUrl: `${window.location.origin}/settings/billing?toss_success=true`,
          failUrl: `${window.location.origin}/settings/billing?toss_fail=true`,
        });

        if (result?.paymentKey) {
          await confirmTossPayment(orderId, result.paymentKey, amount);
        }
      }
    } catch (err) {
      if ((err as Error).message !== '결제 취소') {
        console.error('결제 처리 실패:', err);
      }
    } finally {
      setActionLoading(false);
      setSelectedPlan(null);
    }
  };

  // Handle TossPayments redirect callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('toss_success') === 'true') {
      const paymentKey = params.get('paymentKey');
      const orderId = params.get('orderId');
      const amount = params.get('amount');
      if (paymentKey && orderId && amount) {
        confirmTossPayment(orderId, paymentKey, Number(amount))
          .then(() => {
            window.history.replaceState({}, '', '/settings/billing');
          })
          .catch(console.error);
      }
    }
  }, []);

  const handleManageSubscription = async () => {
    if (!user || !subscription) return;
    setActionLoading(true);
    try {
      if (subscription.paymentProvider === 'paddle' && subscription.paddleSubscriptionId) {
        // Paddle 구독 관리 — Paddle의 update URL로 이동
        const updateUrl = `https://customer-portal.paddle.com/subscriptions/${subscription.paddleSubscriptionId}`;
        window.open(updateUrl, '_blank');
      } else {
        // 토스페이먼츠 — 앱 내 취소
        alert('구독 취소는 고객센터로 문의해주세요.');
      }
    } catch (err) {
      console.error('구독 관리 실패:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!user) return;
    if (!confirm('정말 구독을 취소하시겠습니까? 현재 기간이 끝날 때까지 서비스를 이용할 수 있습니다.')) return;

    setActionLoading(true);
    try {
      await cancelPaddleSubscription(user.uid);
    } catch (err) {
      console.error('구독 취소 실패:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (date: Date | undefined) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
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
      <h1 className="mb-6 text-2xl font-bold text-white">Plans & Billing</h1>

      {/* 현재 플랜 정보 */}
      <div className="mb-8 rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">현재 플랜</p>
            <p className="text-lg font-semibold text-white capitalize">
              {currentPlan}
              {subscription?.paymentProvider && currentPlan !== 'free' && (
                <span className="ml-2 text-xs text-gray-500">
                  ({subscription.paymentProvider === 'toss' ? '토스페이먼츠' : 'Paddle'})
                </span>
              )}
              {subscription?.status === 'past_due' && (
                <span className="ml-2 text-sm text-yellow-400">(결제 지연)</span>
              )}
              {subscription?.status === 'canceled' && (
                <span className="ml-2 text-sm text-red-400">(취소됨)</span>
              )}
            </p>
          </div>
          {subscription?.currentPeriodEnd && (
            <div className="text-right">
              <p className="text-sm text-gray-400">다음 결제일</p>
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
            plan.type !== 'free' &&
            (currentPlan === 'free' ||
              (currentPlan === 'pro' && plan.type === 'team'));

          return (
            <div
              key={plan.type}
              className={`rounded-lg border p-5 transition-colors ${
                isCurrent
                  ? 'border-blue-500 bg-gray-800'
                  : 'border-gray-700 bg-gray-800 hover:border-gray-600'
              }`}
            >
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-1 text-2xl font-bold text-white">{plan.priceKRW}</p>
              <p className="text-xs text-gray-500">{plan.priceUSD}</p>

              <ul className="mt-4 space-y-2">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-center gap-2 text-sm text-gray-300">
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
                    {feat}
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <span className="block w-full rounded bg-gray-700 py-2 text-center text-sm text-gray-400">
                    현재 플랜
                  </span>
                ) : isUpgrade ? (
                  <button
                    onClick={() => handleUpgrade(plan.type)}
                    disabled={actionLoading}
                    className="block w-full rounded bg-blue-600 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    업그레이드
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
              <h2 className="text-lg font-semibold text-white">결제 수단 선택</h2>
              <button
                onClick={() => setSelectedPlan(null)}
                className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-400">
              {selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} 플랜 —{' '}
              <span className="text-white font-medium">
                {PLAN_PRICES_KRW[selectedPlan as keyof typeof PLAN_PRICES_KRW]?.toLocaleString()}원/월
              </span>
            </p>

            <div className="space-y-2">
              {PAYMENT_METHODS.map((method) => (
                <label
                  key={method.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedMethod === method.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-700 hover:border-gray-600'
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
                  <span className="text-sm text-gray-200">{method.label}</span>
                  {selectedMethod === method.id && (
                    <svg className="ml-auto h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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
              {actionLoading ? '처리 중...' : '결제하기'}
            </button>
          </div>
        </div>
      )}

      {/* 구독 관리 */}
      {currentPlan !== 'free' && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">구독 관리</p>
              <p className="text-xs text-gray-400">
                결제 수단 변경, 구독 취소, 인보이스 확인
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleManageSubscription}
                disabled={actionLoading}
                className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                관리
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="rounded border border-red-800 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/30 disabled:opacity-50"
              >
                구독 취소
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
    const script = document.createElement('script');
    script.src = 'https://js.tosspayments.com/v2/standard';
    script.onload = () => {
      tossSDKLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('TossPayments SDK 로드 실패'));
    document.head.appendChild(script);
  });
}
