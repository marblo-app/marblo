'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { httpsCallable, getFunctions } from 'firebase/functions';
import app from '@/lib/firebase';
import { lectures } from '@/data/lectures';
import { trackPurchase } from '@/lib/gtag';
import { Check, Loader2, BookOpen, Download, LayoutDashboard, Home } from 'lucide-react';

const PLAN_NAMES: Record<string, string> = {
  pro: 'Pro',
  team: 'Team',
  team_plus: 'Team Plus',
};

export default function CheckoutSuccessPage() {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [processing, setProcessing] = useState(true);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // GA4 purchase 중복 발화 가드 — StrictMode 이중 마운트/재실행 방지.
  const purchaseFiredRef = useRef(false);

  const type = searchParams.get('type');
  const plan = searchParams.get('plan');
  const amount = searchParams.get('amount');
  const provider = searchParams.get('provider');
  const isLecture = type === 'lecture';

  // 결제 확정 성공 시 GA4 purchase 1회만 발화 (강의 + 구독 Pro/Team/Team Plus).
  // transactionId 기준 중복 가드: ref(마운트 내) + sessionStorage(리로드/재마운트 간).
  // 이메일 등 PII 는 넣지 않는다 — transactionId(비식별)·금액·상품 id/제목만.
  const firePurchase = (args: {
    transactionId: string;
    value: number;
    itemId: string;
    itemName?: string;
    itemCategory: 'lecture' | 'subscription';
    itemVariant?: string;
  }) => {
    const { transactionId, value, itemId, itemName, itemCategory, itemVariant } = args;
    if (!transactionId || !Number.isFinite(value) || value < 0) return;

    const dedupeKey = `ga4_purchase_${transactionId}`;
    if (purchaseFiredRef.current) return;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage.getItem(dedupeKey)) {
        purchaseFiredRef.current = true;
        return;
      }
    } catch {
      // sessionStorage 접근 불가 — ref 가드만으로 진행
    }
    purchaseFiredRef.current = true;
    try {
      if (typeof window !== 'undefined') window.sessionStorage.setItem(dedupeKey, '1');
    } catch {
      // 무시 — 저장 실패해도 ref 가 이번 마운트 중복은 막음
    }

    trackPurchase({
      transactionId,
      value,
      currency: 'KRW',
      items: [
        {
          item_id: itemId,
          item_name: itemName,
          item_category: itemCategory,
          price: value,
          quantity: 1,
          item_variant: itemVariant,
        },
      ],
    });
  };

  const resolveLectureItem = () => {
    const slug = searchParams.get('slug');
    const lecture = slug ? lectures.find((l) => l.slug === slug) : undefined;
    const itemName = lecture
      ? locale === 'ko'
        ? lecture.title_ko
        : lecture.title_en
      : undefined;
    return { itemId: slug ?? 'lecture', itemName };
  };

  const resolveSubscriptionItem = (planId: string) => {
    const billing = searchParams.get('billing') || 'monthly';
    const planLabel = PLAN_NAMES[planId] || planId;
    const cycleLabel = billing === 'annual' ? 'Annual' : 'Monthly';
    return {
      itemId: planId,
      itemName: `Marblo ${planLabel} (${cycleLabel})`,
      itemVariant: billing,
    };
  };

  useEffect(() => {
    const confirmPayment = async () => {
      const authKey = searchParams.get('authKey');
      const customerKey = searchParams.get('customerKey');
      const paymentKey = searchParams.get('paymentKey');
      const paymentId = searchParams.get('paymentId');
      const orderId = searchParams.get('orderId');
      const amountParam = searchParams.get('amount');
      const txParam = searchParams.get('tx');
      const value = amountParam != null && amountParam !== '' ? Number(amountParam) : NaN;

      const functions = getFunctions(app, 'us-central1');
      try {
        if (provider === 'portone' && paymentId && plan) {
          // PortOne 일회성(강의 등) — checkout 에서 이미 complete 했을 수 있으나
          // 리다이렉트 복귀 경로와 동일 callable 로 멱등 확정.
          const billing = searchParams.get('billing') || undefined;
          const complete = httpsCallable(functions, 'completePortOnePayment');
          await complete({ paymentId, planType: plan, billing });
          if (Number.isFinite(value)) {
            if (isLecture) {
              const lectureItem = resolveLectureItem();
              firePurchase({
                transactionId: paymentId,
                value,
                itemId: lectureItem.itemId,
                itemName: lectureItem.itemName,
                itemCategory: 'lecture',
                itemVariant: undefined,
              });
            } else {
              const subItem = resolveSubscriptionItem(plan);
              firePurchase({
                transactionId: paymentId,
                value,
                itemId: subItem.itemId,
                itemName: subItem.itemName,
                itemCategory: 'subscription',
                itemVariant: subItem.itemVariant,
              });
            }
          }
        } else if (isLecture && paymentKey && orderId && amountParam) {
          // Toss 강의 결제
          const confirm = httpsCallable(functions, 'confirmLecturePayment');
          await confirm({ paymentKey, orderId, amount: Number(amountParam) });
          const lectureItem = resolveLectureItem();
          firePurchase({
            transactionId: orderId,
            value: Number(amountParam),
            itemId: lectureItem.itemId,
            itemName: lectureItem.itemName,
            itemCategory: 'lecture',
            itemVariant: undefined,
          });
        } else if (authKey && customerKey && plan) {
          // Toss 구독 빌링키 발급 + 첫 청구
          // 쿠폰 코드를 첫 청구까지 전달(빈 문자열이면 미적용). checkout 페이지가
          // successUrl 에 &coupon= 로 실어 보낸다.
          const coupon = searchParams.get('coupon') || undefined;
          // ★결제 주기도 함께 전달한다. checkout 페이지가 successUrl 에
          // &billing= 로 이미 실어 보내고 있었는데 여기서 흘리고 있었다 — 그래서
          // 연간을 고른 사용자에게 ₩190,000 을 보여주고 서버는 주기를 모른 채
          // ₩19,000·1개월을 청구했다. 서버가 최종 정규화하므로
          // (normalizeBillingCycle) 값이 없거나 이상해도 월간으로 안전하게 떨어진다.
          const billing = searchParams.get('billing') || undefined;
          const issue = httpsCallable(functions, 'issueBillingKey');
          try {
            await issue({ authKey, customerKey, plan, coupon, billing });
          } catch (issueErr: unknown) {
            const msg =
              issueErr && typeof issueErr === 'object' && 'message' in issueErr
                ? String((issueErr as { message?: string }).message || '')
                : '';
            // 이미 구독 중 / 멱등 재진입 — 성공 UI (이중청구 없음)
            if (msg.includes('already_subscribed')) {
              setSuccess(true);
              setProcessing(false);
              return;
            }
            // 카드 등록됨·청구 실패 — 재시도는 checkout 에서
            if (msg.includes('first_charge_failed')) {
              setErrorMsg(t('firstChargeFailed'));
              setSuccess(false);
              setProcessing(false);
              return;
            }
            throw issueErr;
          }
          // authKey 는 빌링 인증 1회당 유일 — transaction_id 로 사용(PII 아님).
          // amount 는 successUrl 에 실어 보낸 값; 없으면 발화 스킵(오값 방지).
          if (Number.isFinite(value) && value > 0) {
            const subItem = resolveSubscriptionItem(plan);
            firePurchase({
              transactionId: authKey,
              value,
              itemId: subItem.itemId,
              itemName: subItem.itemName,
              itemCategory: 'subscription',
              itemVariant: subItem.itemVariant,
            });
          }
        } else if (provider === 'portone' && plan && Number.isFinite(value) && value > 0) {
          // PortOne 구독: checkout 페이지에서 completePortOneBillingKey 까지 끝난 뒤
          // 여기로 리다이렉트만 한다(재확정 callable 없음). success 마운트 시 purchase 1회.
          const subItem = resolveSubscriptionItem(plan);
          firePurchase({
            transactionId: txParam || paymentId || `portone_${plan}_${searchParams.get('billing') || 'monthly'}_${value}`,
            value,
            itemId: subItem.itemId,
            itemName: subItem.itemName,
            itemCategory: 'subscription',
            itemVariant: subItem.itemVariant,
          });
        }
        setSuccess(true);
      } catch (err) {
        console.error('Confirmation error:', err);
        const message = err instanceof Error ? err.message : t('paymentError');
        setErrorMsg(message);
        setSuccess(false);
      } finally {
        setProcessing(false);
      }
    };
    confirmPayment();
  }, [searchParams, isLecture, plan, provider, t, locale]);

  return (
    <div className="py-24 px-4 text-center">
      <div className="max-w-md mx-auto">
        {processing ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-400 mx-auto" />
            <p className="text-zinc-400 text-lg">{t('processing')}</p>
            <p className="text-zinc-500 text-sm">
              {locale === 'ko'
                ? '결제를 확인하고 있습니다. 잠시만 기다려주세요...'
                : 'Verifying your payment. Please wait...'}
            </p>
          </div>
        ) : success ? (
          <div className="space-y-6">
            {/* Success icon */}
            <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-10 h-10 text-white" />
            </div>

            {/* Title */}
            <div>
              <h1 className="text-2xl font-bold mb-2">{t('successTitle')}</h1>
              <p className="text-zinc-400">
                {isLecture ? t('successLecture') : t('successSubscription')}
              </p>
            </div>

            {/* Purchase details */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-left space-y-3">
              {!isLecture && plan && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t('purchasedPlan')}</span>
                  <span className="font-semibold">{PLAN_NAMES[plan] || plan}</span>
                </div>
              )}
              {isLecture && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t('lectureTitle')}</span>
                  <span className="font-semibold">
                    {locale === 'ko' ? 'AI 에이전트 군단 마스터클래스' : 'AI Agent Army Masterclass'}
                  </span>
                </div>
              )}
              {amount && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t('purchasedAmount')}</span>
                  <span className="font-semibold">{'\u20A9'}{Number(amount).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              {isLecture ? (
                <Link
                  href={`/${locale}/lectures/my`}
                  className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition font-semibold"
                >
                  <BookOpen className="w-5 h-5" />
                  {t('goToMyLectures')}
                </Link>
              ) : (
                <>
                  <Link
                    href={`/${locale}/download`}
                    className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition font-semibold"
                  >
                    <Download className="w-5 h-5" />
                    {t('goToDownload')}
                  </Link>
                  <Link
                    href={`/${locale}`}
                    className="inline-flex items-center justify-center gap-2 bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-3 rounded-lg transition"
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    {t('goToDashboard')}
                  </Link>
                </>
              )}
              <Link
                href={`/${locale}`}
                className="inline-flex items-center justify-center gap-2 text-zinc-400 hover:text-white transition mt-2"
              >
                <Home className="w-4 h-4" />
                {t('goHome')}
              </Link>
            </div>
          </div>
        ) : (
          /* Error state */
          <div className="space-y-6">
            <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center mx-auto">
              <span className="text-3xl text-white">!</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-2">{t('failTitle')}</h1>
              <p className="text-zinc-400">{errorMsg || t('paymentError')}</p>
            </div>
            <Link
              href={
                errorMsg === t('firstChargeFailed') && plan
                  ? `/${locale}/checkout?plan=${encodeURIComponent(plan)}&billing=${encodeURIComponent(searchParams.get('billing') || 'monthly')}`
                  : `/${locale}/pricing`
              }
              className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition"
            >
              {errorMsg === t('firstChargeFailed') ? t('retryFirstCharge') : t('tryAgain')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
