'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { httpsCallable, getFunctions } from 'firebase/functions';
import app from '@/lib/firebase';
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

  const type = searchParams.get('type');
  const plan = searchParams.get('plan');
  const amount = searchParams.get('amount');
  const isLecture = type === 'lecture';

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
        } else if (authKey && customerKey && plan) {
          const issue = httpsCallable(functions, 'issueBillingKey');
          await issue({ authKey, customerKey, plan });
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
