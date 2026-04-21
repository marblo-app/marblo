'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Clock, BookOpen, Play, Star, ArrowRight, Zap, Sparkles } from 'lucide-react';
import { lectures as staticLectures, type LectureData } from '@/data/lectures';

function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

export default function LecturesPage() {
  const t = useTranslations('lectures');
  const locale = useLocale();
  const [lectureList, setLectureList] = useState<LectureData[]>([]);

  useEffect(() => {
    const fetchLectures = async () => {
      try {
        const q = query(collection(db, 'lectures'), where('status', '==', 'published'));
        const snap = await getDocs(q);
        if (snap.docs.length > 0) {
          setLectureList(
            snap.docs.map((d) => ({ slug: d.id, ...d.data() }) as LectureData)
          );
          return;
        }
      } catch {
        // Firestore unavailable, fall through to static
      }
      setLectureList(staticLectures.filter((l) => l.status === 'published'));
    };
    fetchLectures();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ===================== HERO ===================== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/30 via-zinc-950 to-zinc-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-600/8 rounded-full blur-3xl" />

        <div className="relative max-w-5xl mx-auto px-4 pt-24 pb-10 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-4">
            <Zap className="w-4 h-4 text-indigo-400" />
            <span className="text-sm text-indigo-300">
              {locale === 'ko'
                ? 'AI 시대의 필수 역량'
                : locale === 'ja'
                  ? 'AI時代の必須スキル'
                  : 'Essential Skills for the AI Era'}
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-white">
            {locale === 'ko'
              ? 'AI 에이전트 강의'
              : locale === 'ja'
                ? 'AIエージェント講座'
                : 'AI Agent Courses'}
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed whitespace-pre-line">
            {locale === 'ko'
              ? '멀티 AI 에이전트를 활용한 실전 개발을 마스터하세요.\n기획부터 배포까지, 프로젝트 기반으로 배웁니다.'
              : locale === 'ja'
                ? 'マルチAIエージェントを活用した実践開発をマスター。\n企画からデプロイまで、プロジェクトベースで学びます。'
                : 'Master real-world development with multi AI agents.\nLearn project-based, from planning to deployment.'}
          </p>
        </div>
      </section>

      {/* ===================== LECTURE CARDS ===================== */}
      <section className="max-w-6xl mx-auto px-4 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {lectureList.map((lecture) => {
            const title = locale === 'ko' ? lecture.title_ko : lecture.title_en;
            const subtitle = locale === 'ko' ? lecture.subtitle_ko : lecture.subtitle_en;
            const totalSections = lecture.modules.reduce(
              (sum, m) => sum + m.sections.length,
              0
            );
            const totalDuration = lecture.modules.reduce(
              (sum, m) => sum + m.sections.reduce((s, sec) => s + sec.duration, 0),
              0
            );
            const moduleLabel =
              locale === 'ko' ? '모듈' : locale === 'ja' ? 'モジュール' : 'modules';
            const sectionLabel =
              locale === 'ko' ? '강의' : locale === 'ja' ? 'セクション' : 'sections';
            const levelText =
              lecture.level === 'beginner'
                ? locale === 'ko'
                  ? '입문'
                  : locale === 'ja'
                    ? '入門'
                    : 'Beginner'
                : lecture.level === 'intermediate'
                  ? locale === 'ko'
                    ? '중급'
                    : locale === 'ja'
                      ? '中級'
                      : 'Intermediate'
                  : locale === 'ko'
                    ? '고급'
                    : locale === 'ja'
                      ? '上級'
                      : 'Advanced';
            const discount = lecture.originalPrice
              ? Math.round((1 - lecture.price / lecture.originalPrice) * 100)
              : 0;

            return (
              <Link
                key={lecture.slug}
                href={`/${locale}/lectures/${lecture.slug}`}
                className="group bg-zinc-900 border border-zinc-700/50 rounded-2xl overflow-hidden hover:border-indigo-500/50 transition-all hover:shadow-xl hover:shadow-indigo-500/5 flex flex-col"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video overflow-hidden bg-zinc-800">
                  {lecture.thumbnail ? (
                    <Image
                      src={lecture.thumbnail}
                      alt={title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 via-violet-600/10 to-zinc-900 flex items-center justify-center">
                      <span className="text-zinc-600 text-sm">No Image</span>
                    </div>
                  )}

                  {/* Bestseller badge */}
                  <div className="absolute top-3 left-3 z-10">
                    <div className="flex items-center gap-1.5 bg-amber-500 text-black px-3 py-1 rounded-full text-xs font-bold shadow-lg">
                      <Star className="w-3 h-3" />
                      {locale === 'ko'
                        ? '베스트셀러'
                        : locale === 'ja'
                          ? 'ベストセラー'
                          : 'Bestseller'}
                    </div>
                  </div>
                  {/* Level badge */}
                  <div className="absolute top-3 right-3 z-10">
                    <div className="bg-zinc-900/80 backdrop-blur text-zinc-300 px-3 py-1 rounded-full text-xs font-medium">
                      {levelText}
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="text-lg font-bold mb-2 leading-snug group-hover:text-indigo-300 transition-colors line-clamp-2">
                    {title}
                  </h3>
                  <p className="text-zinc-400 text-sm mb-5 line-clamp-2 flex-1">
                    {subtitle}
                  </p>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm text-zinc-500 mb-5">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4" />
                      <span>
                        {lecture.modules.length} {moduleLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Play className="w-4 h-4" />
                      <span>
                        {totalSections} {sectionLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>{formatHours(totalDuration)}h</span>
                    </div>
                  </div>

                  {/* Price row */}
                  <div className="flex items-center justify-between pt-4 border-t border-zinc-700/50">
                    <div className="flex items-center gap-3">
                      {lecture.originalPrice && (
                        <span className="text-sm text-zinc-500 line-through">
                          {'\u20A9'}{lecture.originalPrice.toLocaleString()}
                        </span>
                      )}
                      <span className="text-xl font-bold text-white">
                        {'\u20A9'}{lecture.price.toLocaleString()}
                      </span>
                      {lecture.originalPrice && (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-semibold">
                          {discount}%
                        </span>
                      )}
                    </div>
                    <ArrowRight className="w-5 h-5 text-zinc-600 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Coming Soon cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-8">
          {[
            {
              title_ko: 'AI SaaS 빌드 & 런칭 — 마블로로 수익화',
              title_en: 'AI SaaS Build & Launch — Monetize with Marblo',
              title_ja: 'AI SaaS構築＆ローンチ — Marbloで収益化',
              desc_ko: '마블로 에이전트 군단으로 수익화 가능한 SaaS를 처음부터 런칭까지. TossPayments 구독 결제 시스템 직접 구축.',
              desc_en: 'Build a monetizable SaaS from scratch to launch with Marblo agents. Includes subscription payment system.',
              desc_ja: 'Marbloエージェント軍団で収益化可能なSaaSをゼロからローンチまで。サブスク決済システム構築込み。',
              gradient: 'from-amber-600/20 to-orange-600/20',
            },
            {
              title_ko: 'GraphRAG with 마블로 — 차세대 AI 검색',
              title_en: 'GraphRAG with Marblo — Next-Gen AI Search',
              title_ja: 'GraphRAG with Marblo — 次世代AI検索',
              desc_ko: '벡터DB + 그래프DB 하이브리드 RAG 파이프라인을 마블로에서 구축. 마블로 내장 GraphRAG 기능 활용.',
              desc_en: 'Build hybrid RAG pipelines with Vector DB + Graph DB in Marblo. Leverage built-in GraphRAG features.',
              desc_ja: 'ベクトルDB＋グラフDBハイブリッドRAGパイプラインをMarbloで構築。内蔵GraphRAG機能を活用。',
              gradient: 'from-cyan-600/20 to-indigo-600/20',
            },
          ].map((course, i) => (
            <div
              key={i}
              className="bg-zinc-900/50 border border-zinc-700/50 rounded-2xl overflow-hidden group hover:border-zinc-600 transition-all"
            >
              <div className={`aspect-video bg-gradient-to-br ${course.gradient} flex items-center justify-center relative`}>
                <div className="text-center">
                  <Sparkles className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
                  <span className="text-zinc-400 text-sm font-semibold bg-zinc-900/60 px-3 py-1 rounded-full">
                    {locale === 'ko' ? '출시 예정' : locale === 'ja' ? '近日公開' : 'Coming Soon'}
                  </span>
                </div>
              </div>
              <div className="p-6">
                <h3 className="text-base font-bold mb-2 text-zinc-300">
                  {locale === 'ko' ? course.title_ko : locale === 'ja' ? course.title_ja : course.title_en}
                </h3>
                <p className="text-zinc-500 text-sm line-clamp-2">
                  {locale === 'ko' ? course.desc_ko : locale === 'ja' ? course.desc_ja : course.desc_en}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {lectureList.length === 0 && (
          <div className="text-center py-20 text-zinc-500">
            <p className="text-lg">{t('noLectures')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
