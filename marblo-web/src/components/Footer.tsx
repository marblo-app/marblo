'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';

export default function Footer() {
  const t = useTranslations('footer');
  const locale = useLocale();

  return (
    <footer className="border-t border-zinc-800/50 bg-zinc-950 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Marblo</h3>
            <p className="text-zinc-500 text-sm">{t('description')}</p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">{locale === 'ko' ? '제품' : locale === 'ja' ? 'プロダクト' : 'Product'}</h4>
            <ul>
              <li>
                <Link href={`/${locale}/#features`} className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">
                  {locale === 'ko' ? '기능' : locale === 'ja' ? '機能' : 'Features'}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/pricing`} className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">
                  {locale === 'ko' ? '가격' : locale === 'ja' ? '料金' : 'Pricing'}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/download`} className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">
                  {locale === 'ko' ? '다운로드' : locale === 'ja' ? 'ダウンロード' : 'Download'}
                </Link>
              </li>
            </ul>
          </div>

          {/* Lectures */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">{locale === 'ko' ? '강의' : locale === 'ja' ? '講座' : 'Lectures'}</h4>
            <ul>
              <li>
                <Link href={`/${locale}/lectures`} className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">
                  {locale === 'ko' ? '전체 강의' : locale === 'ja' ? '全講座' : 'All Lectures'}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/lectures/marblo-v3-masterclass`} className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">
                  {locale === 'ko' ? '마블로 v3 마스터클래스' : locale === 'ja' ? 'Marblo v3 マスタークラス' : 'Marblo v3 Masterclass'}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-3">{locale === 'ko' ? '법적 고지' : locale === 'ja' ? '法的情報' : 'Legal'}</h4>
            <ul>
              <li>
                <span className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">{t('terms')}</span>
              </li>
              <li>
                <span className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">{t('privacy')}</span>
              </li>
              <li>
                <span className="text-zinc-500 hover:text-zinc-300 text-sm block mb-2">{t('contact')}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-zinc-800/50 pt-8 text-center">
          <p className="text-zinc-600 text-sm">&copy; 2026 Marblo. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
