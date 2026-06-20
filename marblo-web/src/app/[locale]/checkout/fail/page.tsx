'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { X, RotateCcw, MessageCircle, Home } from 'lucide-react';

export default function CheckoutFailPage() {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const searchParams = useSearchParams();

  const errorCode = searchParams.get('code');
  const errorMessage = searchParams.get('message');

  return (
    <div className="py-24 px-4 text-center">
      <div className="max-w-md mx-auto space-y-6">
        {/* Error icon */}
        <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center mx-auto">
          <X className="w-10 h-10 text-white" />
        </div>

        {/* Title and description */}
        <div>
          <h1 className="text-2xl font-bold mb-2">{t('failTitle')}</h1>
          <p className="text-zinc-400">{t('failDescription')}</p>
        </div>

        {/* Error details */}
        {(errorCode || errorMessage) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-left space-y-3">
            {errorCode && (
              <div className="flex justify-between">
                <span className="text-zinc-400 text-sm">{t('errorCode')}</span>
                <span className="text-red-400 font-mono text-sm">{errorCode}</span>
              </div>
            )}
            {errorMessage && (
              <div>
                <span className="text-zinc-400 text-sm block mb-1">{t('errorMessage')}</span>
                <p className="text-zinc-300 text-sm">{decodeURIComponent(errorMessage)}</p>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-3 pt-2">
          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition font-semibold"
          >
            <RotateCcw className="w-5 h-5" />
            {t('tryAgain')}
          </Link>

          <a
            href={locale === 'ko' ? 'mailto:team@marblo.app?subject=결제 오류 문의' : 'mailto:team@marblo.app?subject=Payment Error Inquiry'}
            className="inline-flex items-center justify-center gap-2 bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-3 rounded-lg transition"
          >
            <MessageCircle className="w-5 h-5" />
            {t('contactSupport')}
          </a>

          <Link
            href={`/${locale}`}
            className="inline-flex items-center justify-center gap-2 text-zinc-400 hover:text-white transition mt-2"
          >
            <Home className="w-4 h-4" />
            {t('goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
