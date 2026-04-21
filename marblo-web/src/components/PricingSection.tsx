'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Check } from 'lucide-react';

const plans = ['free', 'pro', 'team', 'enterprise'] as const;
type Plan = typeof plans[number];

// Monthly prices
const MONTHLY_PRICES: Record<Plan, number> = {
  free: 0,
  pro: 19000,
  team: 29000,
  enterprise: 0,
};

export default function PricingSection() {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const [isAnnual, setIsAnnual] = useState(false);

  const getPrice = (plan: Plan) => {
    const monthly = MONTHLY_PRICES[plan];
    if (plan === 'free' || plan === 'enterprise') return monthly;
    return isAnnual ? Math.round(monthly * 12 * 0.8) : monthly; // 20% discount for annual
  };

  const getDisplayPrice = (plan: Plan) => {
    const price = getPrice(plan);
    if (plan === 'free') return locale === 'ko' ? '\u20A90' : locale === 'ja' ? '\u00A50' : '$0';
    if (plan === 'enterprise') return null;

    if (locale === 'ko') return `\u20A9${price.toLocaleString()}`;
    if (locale === 'ja') {
      // Approximate JPY
      const jpy = isAnnual ? (plan === 'pro' ? 27840 : 42240) : (plan === 'pro' ? 2900 : 4400);
      return `\u00A5${jpy.toLocaleString()}`;
    }
    // USD
    const usd = isAnnual ? (plan === 'pro' ? 182 : 278) : (plan === 'pro' ? 19 : 29);
    return `$${usd}`;
  };

  const getPeriod = (plan: Plan) => {
    if (plan === 'free') return locale === 'ko' ? '\uC601\uAD6C \uBB34\uB8CC' : locale === 'ja' ? '\u6C38\u4E45\u7121\u6599' : 'forever free';
    if (plan === 'enterprise') return '';
    if (isAnnual) return locale === 'ko' ? '/\uB144' : locale === 'ja' ? '/\u5E74' : '/year';
    return locale === 'ko' ? '/\uC6D4' : locale === 'ja' ? '/\u6708' : '/mo';
  };

  return (
    <div>
      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <span className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-zinc-500'}`}>
          {locale === 'ko' ? '\uC6D4\uAC04' : locale === 'ja' ? '\u6708\u984D' : 'Monthly'}
        </span>
        <button
          onClick={() => setIsAnnual(!isAnnual)}
          className={`relative w-14 h-7 rounded-full transition-colors ${
            isAnnual ? 'bg-indigo-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${
              isAnnual ? 'translate-x-7' : 'translate-x-0'
            }`}
          />
        </button>
        <span className={`text-sm font-medium ${isAnnual ? 'text-white' : 'text-zinc-500'}`}>
          {locale === 'ko' ? '\uC5F0\uAC04' : locale === 'ja' ? '\u5E74\u984D' : 'Annual'}
        </span>
        {isAnnual && (
          <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full font-medium">
            {locale === 'ko' ? '20% \uD560\uC778' : locale === 'ja' ? '20%\u5272\u5F15' : '20% off'}
          </span>
        )}
      </div>

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
        {plans.map((plan) => {
          const highlighted = plan === 'pro';
          const isEnterprise = plan === 'enterprise';
          const features = t.raw(`${plan}.features`) as string[];

          return (
            <div
              key={plan}
              className={`rounded-2xl p-8 flex flex-col relative ${
                highlighted
                  ? 'bg-indigo-600/10 border-2 border-indigo-500 ring-1 ring-indigo-500/50'
                  : 'bg-zinc-900 border border-zinc-700/50'
              }`}
            >
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
                  <span className="text-4xl font-bold text-white">{getDisplayPrice(plan)}</span>
                  <span className="text-zinc-400">{getPeriod(plan)}</span>
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
                  <a
                    href="mailto:contact@marblo.net"
                    className="block w-full text-center py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition font-medium"
                  >
                    {t(`${plan}.cta`)}
                  </a>
                ) : plan === 'free' ? (
                  <Link
                    href={`/${locale}/download`}
                    className="block w-full text-center py-3 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition font-medium"
                  >
                    {t('subscribe')}
                  </Link>
                ) : (
                  <Link
                    href={`/${locale}/checkout?plan=${plan}${isAnnual ? '&billing=annual' : ''}`}
                    className={`block w-full text-center py-3 rounded-lg transition font-medium ${
                      highlighted
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        : 'bg-zinc-700 hover:bg-zinc-600 text-white'
                    }`}
                  >
                    {t('subscribe')}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
