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
  const isLecture = type === 'lecture';

  // 강의 결제 확정 성공 시 GA4 purchase 1회만 발화.
  // orderId 기준 중복 가드: ref(마운트 내) + sessionStorage(리로드/재마운트 간).
  // 이메일 등 PII 는 넣지 않는다 — orderId(비식별)·금액·상품 slug/제목만.
  const fireLecturePurchase = (orderId: string, amountParam: string) => {
    const dedupeKey = `ga4_purchase_${orderId}`;
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

    const slug = searchParams.get('slug');
    const lecture = slug ? lectures.find((l) => l.slug === slug) : undefined;
    const itemName = lecture
      ? locale === 'ko'
        ? lecture.title_ko
        : lecture.title_en
      : undefined;
    trackPurchase({
      transactionId: orderId,
      value: Number(amountParam),
      currency: 'KRW',
      items: [
        {
          item_id: slug ?? 'lecture',
          item_name: itemName,
          item_category: 'lecture',
          price: Number(amountParam),
          quantity: 1,
        },
      ],
    });
  };

  useEffect(() => {
    const confirmPayment = async () => {
      const authKey = searchParams.get('authKey');
      const customerKey = searchParams.get('customerKey');
      const paymentKey = searchParams.get('paymentKey');
      const orderId = searchParams.get('orderId');
      const amountParam = searchParams.get('amount');

      const functions = getFunctions(app, 'us-central1');
      try {
        if (isLecture && paymentKey && orderId && amountParam) {
          const confirm = httpsCallable(functions, 'confirmLecturePayment');
          await confirm({ paymentKey, orderId, amount: Number(amountParam) });
          fireLecturePurchase(orderId, amountParam);
        } else if (authKey && customerKey && plan) {
          // 쿠폰 코드를 첫 청구까지 전달(빈 문자열이면 미적용). checkout 페이지가
          // successUrl 에 &coupon= 로 실어 보낸다.
          const coupon = searchParams.get('coupon') || undefined;
          const issue = httpsCallable(functions, 'issueBillingKey');
          await issue({ authKey, customerKey, plan, coupon });
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
  }, [searchParams, isLecture, plan, t]);

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
              href={`/${locale}/pricing`}
              className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition"
            >
              {t('tryAgain')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
