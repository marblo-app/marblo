import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import PricingSection from '@/components/PricingSection';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple pricing plans for Marblo AI Agent Workspace. Free, Pro, Team, and Enterprise.',
};

export default function PricingPage() {
  const t = useTranslations('pricing');

  return (
    <div className="py-24 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center">{t('title')}</h1>
        <p className="text-zinc-400 text-center mt-3 mb-4">{t('subtitle')}</p>
        <p className="text-center text-sm text-indigo-400 mb-8">{t('annual_discount')}</p>
        <PricingSection />
      </div>
    </div>
  );
}
