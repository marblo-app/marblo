'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Check } from 'lucide-react';

interface PlanCardProps {
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  highlighted?: boolean;
}

export default function PlanCard({ plan, highlighted }: PlanCardProps) {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const features = t.raw(`${plan}.features`) as string[];
  const isEnterprise = plan === 'enterprise';

  return (
    <div className={`rounded-2xl p-8 flex flex-col relative ${
      highlighted
        ? 'bg-indigo-600/10 border-2 border-indigo-500 ring-1 ring-indigo-500/50'
        : 'bg-zinc-900 border border-zinc-700/50'
    }`}>
      {highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
          {t('most_popular')}
        </span>
      )}
      <h3 className="text-2xl font-bold text-white">{t(`${plan}.name`)}</h3>
      <p className="text-zinc-500 text-sm mt-1 mb-4">{t(`${plan}.description`)}</p>

      {isEnterprise ? (
        <div className="mt-2 mb-6">
          <span className="text-2xl font-bold text-white">{t(`${plan}.cta`)}</span>
        </div>
      ) : (
        <div className="mt-2 mb-6 flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white">{t(`${plan}.price`)}</span>
          {plan !== 'free' && (
            <span className="text-zinc-400">{t(`${plan}.period`)}</span>
          )}
          {plan === 'free' && (
            <span className="text-zinc-400 ml-1">{t(`${plan}.period`)}</span>
          )}
        </div>
      )}

      <ul className="space-y-3 flex-1">
        {features.map((feature: string, i: number) => (
          <li key={i} className="flex items-center gap-3 text-zinc-300 text-sm">
            <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-8">
        {isEnterprise ? (
          <a href="mailto:contact@marblo.io" className="block w-full text-center py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition font-medium">
            {t(`${plan}.cta`)}
          </a>
        ) : plan === 'free' ? (
          <Link href={`/${locale}/download`} className="block w-full text-center py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition font-medium">
            {t('subscribe')}
          </Link>
        ) : (
          <Link href={`/${locale}/checkout?plan=${plan}`} className={`block w-full text-center py-3 rounded-lg transition font-medium ${
            highlighted ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-white'
          }`}>
            {t('subscribe')}
          </Link>
        )}
      </div>
    </div>
  );
}
