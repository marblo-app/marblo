'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Clock,
  Play,
  ChevronDown,
  ChevronUp,
  Check,
  Monitor,
  Rocket,
  BookOpen,
  Users,
  Star,
  Shield,
  Gift,
  ArrowRight,
  Layers,
  Sparkles,
  Workflow,
} from 'lucide-react';
import {
  lectures as staticLectures,
  LECTURE_PACKAGES,
  type LectureData,
} from '@/data/lectures';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDurationShort(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${m}`;
}

export default function LectureDetailPage() {
  const t = useTranslations('lectures');
  const locale = useLocale();
  const params = useParams();
  const slug = params.slug as string;

  const [lecture, setLecture] = useState<LectureData | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [openModules, setOpenModules] = useState<Set<number>>(new Set([0]));
  const [showSticky, setShowSticky] = useState(false);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setIsLoggedIn(!!u));
    return () => unsub();
  }, []);

  // Fetch lecture: Firestore first, static fallback
  useEffect(() => {
    const fetchLecture = async () => {
      try {
        const docRef = doc(db, 'lectures', slug);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setLecture({ slug: snap.id, ...snap.data() } as LectureData);
          return;
        }
      } catch {
        // Firestore unavailable, fall through to static
      }
      const found = staticLectures.find((l) => l.slug === slug);
      if (found) setLecture(found);
    };
    fetchLecture();
  }, [slug]);

  // Sticky CTA bar on scroll
  useEffect(() => {
    const handleScroll = () => {
      setShowSticky(window.scrollY > 600);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Computed values
  const stats = useMemo(() => {
    if (!lecture) return null;
    const totalSections = lecture.modules.reduce((sum, m) => sum + m.sections.length, 0);
    const totalDuration = lecture.modules.reduce(
      (sum, m) => sum + m.sections.reduce((s, sec) => s + sec.duration, 0),
      0
    );
    return {
      modules: lecture.modules.length,
      sections: totalSections,
      hours: (totalDuration / 3600).toFixed(1),
      totalDuration,
    };
  }, [lecture]);

  const toggleModule = (idx: number) => {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const checkoutUrl = isLoggedIn
    ? `/${locale}/checkout?type=lecture&slug=${slug}`
    : `/${locale}/auth/login?redirect=/${locale}/lectures/${slug}`;

  if (!lecture || !stats) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-zinc-500 text-lg">Loading...</div>
      </div>
    );
  }

  const title = locale === 'ko' ? lecture.title_ko : lecture.title_en;
  const subtitle = locale === 'ko' ? lecture.subtitle_ko : lecture.subtitle_en;
  const description = locale === 'ko' ? lecture.description_ko : lecture.description_en;
  const features = locale === 'ko' ? lecture.features : lecture.features_en;
  const requirements = locale === 'ko' ? lecture.requirements : lecture.requirements_en;

  const killingPoints = locale === 'ko'
    ? [
        {
          icon: Layers,
          title: '멀티모델 오케스트레이션',
          desc: 'Claude + Codex + Antigravity를 하나의 칸반 보드에서 동시 운용. 각 AI의 강점을 극대화하는 실전 전략을 배웁니다.',
        },
        {
          icon: Monitor,
          title: '올인원 데스크탑 앱',
          desc: '터미널, 칸반, 오케스트레이터, 코드 에디터 — 모든 것이 마블로 하나에. 설치부터 커스터마이징까지 완벽 가이드.',
        },
        {
          icon: Rocket,
          title: '실전 SaaS 빌드 & 배포',
          desc: '날씨 대시보드 워밍업 → AI SaaS 메인 프로젝트 → GCP Cloud Run 배포. 15.5시간 만에 프로덕션 레벨 서비스 완성.',
        },
      ]
    : locale === 'ja'
      ? [
          {
            icon: Layers,
            title: 'マルチモデルオーケストレーション',
            desc: 'Claude + Codex + Antigravityを一つのカンバンボードで同時運用。各AIの強みを最大化する実践戦略を学びます。',
          },
          {
            icon: Monitor,
            title: 'オールインワンデスクトップアプリ',
            desc: 'ターミナル、カンバン、オーケストレーター、コードエディタ — すべてがMarblo一つに。インストールからカスタマイズまで完全ガイド。',
          },
          {
            icon: Rocket,
            title: '実践SaaSビルド＆デプロイ',
            desc: '天気ダッシュボードウォームアップ → AI SaaSメインプロジェクト → GCP Cloud Runデプロイ。15.5時間でプロダクションレベルのサービス完成。',
          },
        ]
      : [
          {
            icon: Layers,
            title: 'Multi-Model Orchestration',
            desc: 'Run Claude + Codex + Antigravity simultaneously on one kanban board. Learn real-world strategies to maximize each AI\'s strengths.',
          },
          {
            icon: Monitor,
            title: 'All-in-One Desktop App',
            desc: 'Terminal, Kanban, Orchestrator, Code Editor — everything in Marblo. Complete guide from installation to customization.',
          },
          {
            icon: Rocket,
            title: 'Real SaaS Build & Deploy',
            desc: 'Weather dashboard warmup → AI SaaS main project → GCP Cloud Run deployment. Production-level service in 15.5 hours.',
          },
        ];

  const packages = [
    {
      key: 'earlybird' as const,
      badge: locale === 'ko' ? '한정 300석' : locale === 'ja' ? '限定300席' : 'Limited 300 seats',
      highlighted: true,
      features: locale === 'ko'
        ? ['전체 8모듈 15.5시간 강의', '완성 소스코드 2개 프로젝트', '디스코드 커뮤니티 액세스', '마블로 Pro 6개월 무료 쿠폰', '마블로 초기 앰배서더 인증서', '평생 업데이트 무료']
        : locale === 'ja'
          ? ['全8モジュール 15.5時間講座', '完成ソースコード2プロジェクト', 'Discordコミュニティアクセス', 'Marblo Pro 6ヶ月無料クーポン', 'Marblo初期アンバサダー認定証', '永久無料アップデート']
          : ['All 8 modules, 15.5h video', '2 complete project source codes', 'Discord community access', 'Marblo Pro 6-month free coupon', 'Marblo Early Ambassador Certificate', 'Lifetime free updates'],
    },
    {
      key: 'proBudle' as const,
      badge: locale === 'ko' ? '최고 가치' : locale === 'ja' ? '最高価値' : 'Best Value',
      highlighted: false,
      features: locale === 'ko'
        ? ['얼리버드 전체 포함', '마블로 Pro 1년 무료 쿠폰', '에이전트 스킬 템플릿 5종', 'PRD + 태스크 템플릿 5종', '월간 라이브 Q&A']
        : locale === 'ja'
          ? ['アーリーバード全内容を含む', 'Marblo Pro 1年間無料クーポン', 'エージェントスキルテンプレート5種', 'PRD＋タスクテンプレート5種', '月間ライブQ&A']
          : ['Everything in Early Bird', 'Marblo Pro 1-year free coupon', '5 agent skill templates', '5 PRD + task templates', 'Monthly live Q&A'],
    },
  ];

  const discount = lecture.originalPrice
    ? Math.round((1 - lecture.price / lecture.originalPrice) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ===================== HERO ===================== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-zinc-950 to-zinc-950" />

        <div className="relative max-w-5xl mx-auto px-4 pt-28 pb-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
            <Link href={`/${locale}/lectures`} className="hover:text-zinc-300 transition">
              {locale === 'ko' ? '강의' : locale === 'ja' ? '講座' : 'Lectures'}
            </Link>
            <span>/</span>
            <span className="text-zinc-400">
              {locale === 'ko' ? '마스터클래스' : locale === 'ja' ? 'マスタークラス' : 'Masterclass'}
            </span>
          </div>

          {/* Bestseller badge */}
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1.5 mb-5">
            <Star className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-300 font-medium">
              {locale === 'ko' ? '베스트셀러' : locale === 'ja' ? 'ベストセラー' : 'Bestseller'}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight mb-4">
            {title}
          </h1>

          {/* Subtitle */}
          <p className="text-lg text-zinc-400 mb-6 leading-relaxed max-w-3xl">
            {subtitle}
          </p>

          {/* Instructor + Stats row */}
          <div className="flex flex-wrap items-center gap-6 mb-8">
            <div className="flex items-center gap-3">
              <Image
                src="/images/instructor-dongwon.jpg"
                alt={lecture.instructor}
                width={40}
                height={40}
                className="w-10 h-10 rounded-full object-cover border border-zinc-700"
              />
              <div>
                <p className="text-sm font-medium text-white">{lecture.instructor}</p>
                <p className="text-xs text-zinc-500">{lecture.instructorTitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-sm">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                {stats.modules} {locale === 'ko' ? '모듈' : locale === 'ja' ? 'モジュール' : 'Modules'}
              </span>
              <span className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-sm">
                <Play className="w-4 h-4 text-indigo-400" />
                {stats.sections} {locale === 'ko' ? '강의' : locale === 'ja' ? 'レッスン' : 'Sections'}
              </span>
              <span className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-sm">
                <Clock className="w-4 h-4 text-indigo-400" />
                {stats.hours} {locale === 'ko' ? '시간' : locale === 'ja' ? '時間' : 'Hours'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== COURSE BANNER IMAGE ===================== */}
      <section className="max-w-5xl mx-auto px-4 mb-10">
        <div className="rounded-2xl overflow-hidden border border-zinc-700/50 shadow-2xl shadow-indigo-900/10">
          <Image
            src="/images/lectures/marblo-v3-masterclass.png"
            alt="Marblo AI Agent Masterclass"
            width={2950}
            height={1344}
            className="w-full h-auto"
            priority
          />
        </div>
      </section>

      {/* ===================== PRICING BOX ===================== */}
      <section className="max-w-3xl mx-auto px-4 mb-16">
        <div className="bg-gradient-to-b from-zinc-800/60 to-zinc-900/60 border-2 border-indigo-400/40 rounded-3xl overflow-hidden shadow-2xl shadow-indigo-600/20">
          <div className="h-1.5 bg-gradient-to-r from-indigo-600 to-violet-600" />
          <div className="p-8 md:p-10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Price info */}
              <div>
                <div className="flex items-baseline gap-3 mb-2">
                  {lecture.originalPrice && (
                    <span className="text-lg text-zinc-500 line-through">
                      {'\u20A9'}{lecture.originalPrice.toLocaleString()}
                    </span>
                  )}
                  <span className="text-4xl font-bold text-white">
                    {'\u20A9'}{lecture.price.toLocaleString()}
                  </span>
                  {lecture.originalPrice && (
                    <span className="bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full text-sm font-semibold">
                      {discount}% OFF
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500">
                  {locale === 'ko' ? '얼리버드 한정가' : locale === 'ja' ? 'アーリーバード限定価格' : 'Early bird limited'}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Gift className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 text-sm font-medium">
                    {locale === 'ko' ? 'Pro 6개월 무료 쿠폰 포함' : locale === 'ja' ? 'Pro 6ヶ月無料クーポン付き' : 'Includes Pro 6-month free coupon'}
                  </span>
                </div>
              </div>

              {/* CTA */}
              <div className="flex flex-col items-center gap-3">
                <Link
                  href={checkoutUrl}
                  className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-10 py-4 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-indigo-600/25 hover:shadow-indigo-500/40 hover:scale-105 whitespace-nowrap"
                >
                  {t('purchase')}
                  <ArrowRight className="w-5 h-5" />
                </Link>
                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                  <Shield className="w-3.5 h-3.5" />
                  <span>{locale === 'ko' ? '30일 환불 보장' : locale === 'ja' ? '30日間返金保証' : '30-day refund guarantee'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== DESCRIPTION ===================== */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-8">
            {locale === 'ko' ? '강의 소개' : locale === 'ja' ? '講座紹介' : 'Course Overview'}
          </h2>
          {description.split('\n\n').map((para, i) => (
            <p key={i} className="text-zinc-300 leading-relaxed mb-5 last:mb-0 text-[15px]">
              {para}
            </p>
          ))}
        </div>
      </section>

      {/* ===================== AGENT DASHBOARD SHOWCASE ===================== */}
      <section className="py-24 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-10">
            <span className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-4 text-sm text-indigo-400 font-medium">
              {locale === 'ko' ? '마블로만의 핵심 기술' : locale === 'ja' ? 'Marbloだけのコア技術' : 'Only in Marblo'}
            </span>
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              {locale === 'ko' ? '이종 에이전트 오케스트레이션을 배웁니다' : locale === 'ja' ? '異種エージェント・オーケストレーションを学ぶ' : 'Learn Heterogeneous Agent Orchestration'}
            </h2>
            <p className="text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              {locale === 'ko'
                ? 'Claude, Codex(GPT), Antigravity를 하나의 대시보드에서 동시 관리하고, 태스크를 물리적/논리적으로 분할하여 할당하는 방법을 실전으로 배웁니다.'
                : locale === 'ja'
                  ? 'Claude、Codex(GPT)、Antigravityを一つのダッシュボードで同時管理し、タスクを物理的/論理的に分割して割り当てる方法を実践で学びます。'
                  : 'Learn to manage Claude, Codex (GPT), and Antigravity simultaneously from one dashboard, assigning tasks with physical and logical partitioning.'}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-700/50 overflow-hidden shadow-2xl shadow-indigo-900/10">
            <Image
              src="/images/orchestration-demo.webp"
              alt="Marblo Agent Dashboard"
              width={2560}
              height={1440}
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* ===================== KILLING POINTS ===================== */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-3">
              {locale === 'ko' ? '이 강의가 특별한 이유' : locale === 'ja' ? 'この講座が特別な理由' : 'Why This Course Stands Out'}
            </h2>
            <p className="text-zinc-400 text-lg">
              {locale === 'ko'
                ? '다른 어디에서도 배울 수 없는 3가지 핵심 역량'
                : locale === 'ja'
                  ? '他では学べない3つの核心能力'
                  : '3 core competencies you cannot learn anywhere else'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {killingPoints.map((kp, i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8 hover:border-indigo-500/40 transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-indigo-600/10 flex items-center justify-center mb-6 group-hover:bg-indigo-600/20 transition">
                  <kp.icon className="w-7 h-7 text-indigo-400" />
                </div>
                <h3 className="text-xl font-bold mb-3">{kp.title}</h3>
                <p className="text-zinc-400 leading-relaxed text-[15px]">{kp.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== WHAT YOU'LL BUILD ===================== */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-3">
              {locale === 'ko' ? '15.5시간 동안 이것들을 만듭니다' : locale === 'ja' ? '15.5時間でこれらを作ります' : 'What You\'ll Build in 15.5 Hours'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {(locale === 'ko' ? [
              { icon: Monitor, iconColor: 'text-indigo-400', title: '날씨 대시보드', desc: '워밍업 프로젝트로 마블로의 전체 워크플로우를 체험합니다. /tf-plan → /tf-start → 에이전트 스폰 → 배포까지.', tag: '워밍업' },
              { icon: Rocket, iconColor: 'text-indigo-400', title: 'AI SaaS 서비스', desc: '풀스택 AI SaaS를 멀티 에이전트로 빌드합니다. 백엔드 + 프론트엔드 + 통합 테스트 → GCP Cloud Run 배포.', tag: '메인 프로젝트' },
              { icon: Workflow, iconColor: 'text-indigo-400', title: '오케스트레이터 자동 분해 & dispatch', desc: '오케스트레이터가 목표를 태스크로 자동 분해해 Claude/Codex/Antigravity 에이전트에 dispatch. 티켓 → 에이전트 연결과 diff 추적까지 실전으로 다룹니다.', tag: '오케스트레이션' },
              { icon: Sparkles, iconColor: 'text-indigo-400', title: 'SaaS 랜딩페이지', desc: 'Stitch MCP를 활용해 마케팅 랜딩페이지를 디자인하고 런칭 체크리스트까지 완성합니다.', tag: '런칭' },
            ] : locale === 'ja' ? [
              { icon: Monitor, iconColor: 'text-indigo-400', title: '天気ダッシュボード', desc: 'ウォームアッププロジェクトでMarbloの全ワークフローを体験。/tf-plan → /tf-start → エージェントスポーン → デプロイまで。', tag: 'ウォームアップ' },
              { icon: Rocket, iconColor: 'text-indigo-400', title: 'AI SaaSサービス', desc: 'フルスタックAI SaaSをマルチエージェントでビルド。バックエンド＋フロントエンド＋統合テスト → GCP Cloud Runデプロイ。', tag: 'メインプロジェクト' },
              { icon: Workflow, iconColor: 'text-indigo-400', title: 'オーケストレーター自動分解＆dispatch', desc: 'オーケストレーターが目標をタスクに自動分解し、Claude/Codex/Antigravityエージェントにdispatch。チケット → エージェント連携とdiff追跡まで実践で扱います。', tag: 'オーケストレーション' },
              { icon: Sparkles, iconColor: 'text-indigo-400', title: 'SaaSランディングページ', desc: 'Stitch MCPを活用してマーケティングランディングページをデザインし、ローンチチェックリストまで完成。', tag: 'ローンチ' },
            ] : [
              { icon: Monitor, iconColor: 'text-indigo-400', title: 'Weather Dashboard', desc: 'Experience Marblo\'s full workflow as a warmup. /tf-plan → /tf-start → agent spawn → deployment.', tag: 'Warmup' },
              { icon: Rocket, iconColor: 'text-indigo-400', title: 'AI SaaS Service', desc: 'Build a full-stack AI SaaS with multi-agents. Backend + Frontend + integration tests → GCP Cloud Run deployment.', tag: 'Main Project' },
              { icon: Workflow, iconColor: 'text-indigo-400', title: 'Orchestrator Auto-Dispatch', desc: 'The orchestrator decomposes a goal into tasks and dispatches them to Claude/Codex/Antigravity agents — including ticket-to-agent linking and diff tracking.', tag: 'Orchestration' },
              { icon: Sparkles, iconColor: 'text-indigo-400', title: 'SaaS Landing Page', desc: 'Design a marketing landing page with Stitch MCP and complete the launch checklist.', tag: 'Launch' },
            ]).map((project, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8 hover:border-indigo-500/30 transition-all group">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-600/10 flex items-center justify-center flex-shrink-0">
                    <project.icon className={`w-6 h-6 ${project.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-medium">
                      {project.tag}
                    </span>
                    <h3 className="text-lg font-bold mt-2 mb-2">{project.title}</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">{project.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== CURRICULUM ACCORDION ===================== */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-3xl font-bold mb-2">
                {locale === 'ko' ? '커리큘럼' : locale === 'ja' ? 'カリキュラム' : 'Curriculum'}
              </h2>
              <p className="text-zinc-400">
                {stats.modules} {locale === 'ko' ? '모듈' : locale === 'ja' ? 'モジュール' : 'modules'} &middot;{' '}
                {stats.sections} {locale === 'ko' ? '강의' : locale === 'ja' ? 'レッスン' : 'sections'} &middot;{' '}
                {stats.hours} {locale === 'ko' ? '시간' : locale === 'ja' ? '時間' : 'hours'}
              </p>
            </div>
            <button
              onClick={() => {
                if (openModules.size === lecture.modules.length) {
                  setOpenModules(new Set());
                } else {
                  setOpenModules(new Set(lecture.modules.map((_, i) => i)));
                }
              }}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition"
            >
              {openModules.size === lecture.modules.length
                ? (locale === 'ko' ? '모두 접기' : locale === 'ja' ? 'すべて折りたたむ' : 'Collapse All')
                : (locale === 'ko' ? '모두 펼치기' : locale === 'ja' ? 'すべて展開' : 'Expand All')}
            </button>
          </div>

          <div className="space-y-3">
            {lecture.modules.map((mod, i) => {
              const isOpen = openModules.has(i);
              const moduleDuration = mod.sections.reduce((s, sec) => s + sec.duration, 0);
              const moduleTitle = locale === 'ko' ? mod.title : mod.title_en;

              return (
                <div
                  key={i}
                  className={`rounded-xl overflow-hidden transition-all ${
                    isOpen
                      ? 'bg-zinc-900 border border-indigo-500/30'
                      : 'bg-zinc-900/80 border border-zinc-700/50 hover:border-zinc-600'
                  }`}
                >
                  <button
                    onClick={() => toggleModule(i)}
                    className="w-full flex items-center justify-between px-6 py-5 text-left transition"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-mono font-bold px-2.5 py-1 rounded-lg text-indigo-400 bg-indigo-500/10">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-semibold text-white text-[15px]">{moduleTitle}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:flex items-center gap-2">
                        <span className="text-xs bg-zinc-800/80 text-zinc-400 px-2 py-1 rounded-md">
                          {mod.sections.length} {locale === 'ko' ? '강의' : locale === 'ja' ? 'レッスン' : 'lectures'}
                        </span>
                        <span className="text-xs bg-zinc-800/80 text-zinc-400 px-2 py-1 rounded-md">
                          {formatDuration(moduleDuration)}
                        </span>
                      </div>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${isOpen ? 'bg-zinc-800' : 'bg-zinc-800/50'}`}>
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4 text-zinc-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                        )}
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-5">
                      <div className="space-y-1">
                        {mod.sections.map((sec, j) => {
                          const secTitle = locale === 'ko' ? sec.title : sec.title_en;
                          return (
                            <div
                              key={j}
                              className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-zinc-800/50 transition group"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-lg bg-zinc-800/80 flex items-center justify-center group-hover:bg-zinc-800">
                                  <Play className="w-3.5 h-3.5 text-zinc-500 group-hover:text-indigo-400 transition" />
                                </div>
                                <span className="text-sm text-zinc-300">{secTitle}</span>
                              </div>
                              <span className="text-xs text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded">
                                {formatDurationShort(sec.duration)}{t('duration')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== WHAT YOU'LL GET ===================== */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">
              {locale === 'ko' ? '수강하면 받는 것들' : locale === 'ja' ? '受講で得られるもの' : 'What You\'ll Get'}
            </h2>
            <p className="text-zinc-400 text-lg">
              {locale === 'ko'
                ? '강의 영상 외에도 즉시 활용 가능한 에셋을 제공합니다'
                : locale === 'ja'
                  ? '動画以外にもすぐ活用できるアセットを提供'
                  : 'Beyond videos — practical assets you can use right away'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-zinc-900 border border-zinc-700/50 rounded-xl px-5 py-4 hover:border-indigo-500/30 transition"
              >
                <Check className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <span className="text-zinc-300 text-[15px] leading-relaxed">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== REQUIREMENTS ===================== */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-8">
            {locale === 'ko' ? '사전 요구사항' : locale === 'ja' ? '前提条件' : 'Prerequisites'}
          </h2>
          <ul className="space-y-4">
            {requirements.map((req, i) => (
              <li key={i} className="flex items-start gap-3 text-zinc-300">
                <Shield className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <span className="text-[15px] leading-relaxed">{req}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-zinc-500 mt-6">
            {locale === 'ko'
              ? '* Claude Code 사용법은 모듈 1에서 자세히 다룹니다. 처음이어도 괜찮습니다.'
              : locale === 'ja'
                ? '* Claude Codeの使い方はモジュール1で詳しく扱います。初めてでも大丈夫です。'
                : '* Claude Code basics are covered in Module 1. No prior experience needed.'}
          </p>
        </div>
      </section>

      {/* ===================== PRICING PACKAGES ===================== */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">
            {locale === 'ko' ? '패키지 선택' : locale === 'ja' ? 'パッケージを選ぶ' : 'Choose Your Package'}
          </h2>
          <p className="text-zinc-400 text-center mb-12">
            {locale === 'ko'
              ? '모든 패키지에 전체 강의가 포함됩니다'
              : locale === 'ja'
                ? '全パッケージに全講座が含まれます'
                : 'All packages include the complete course'}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {packages.map((pkg) => {
              const pkgData = LECTURE_PACKAGES[pkg.key];
              const isEarlyBird = pkg.key === 'earlybird';
              return (
                <div
                  key={pkg.key}
                  className={`rounded-2xl p-8 ${
                    isEarlyBird
                      ? 'bg-zinc-900 border-2 border-indigo-500 shadow-lg shadow-indigo-500/10 relative'
                      : 'bg-zinc-900 border border-zinc-700/50'
                  }`}
                >
                  {pkg.badge && (
                    <div
                      className={`inline-block text-xs font-semibold px-3 py-1 rounded-full mb-4 ${
                        isEarlyBird
                          ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {pkg.badge}
                    </div>
                  )}

                  <h3 className="text-xl font-bold mb-2">
                    {locale === 'ko' ? pkgData.label : pkgData.label_en}
                  </h3>
                  <div className="text-3xl font-bold mb-6">
                    {'\u20A9'}{pkgData.price.toLocaleString()}
                  </div>

                  <ul className="space-y-3 mb-8">
                    {pkg.features.map((feat, i) => {
                      const isCouponFeature = feat.includes('Pro') && (feat.includes('쿠폰') || feat.includes('coupon'));
                      return (
                        <li key={i} className="flex items-start gap-2.5 text-zinc-300">
                          <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isCouponFeature ? 'text-amber-400' : 'text-indigo-400'}`} />
                          <span className={`text-sm leading-relaxed ${isCouponFeature ? 'text-amber-300 font-medium' : ''}`}>
                            {feat}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {pkgData.bonus && (
                    <div className="mb-6 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <Gift className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <span className="text-amber-300 text-xs font-medium">
                        {locale === 'ko' ? pkgData.bonus : pkgData.bonus_en}
                      </span>
                    </div>
                  )}

                  <Link
                    href={checkoutUrl}
                    className={`block text-center py-3 rounded-xl font-semibold transition-all ${
                      isEarlyBird
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                    }`}
                  >
                    {t('purchase')}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== FINAL CTA ===================== */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="bg-gradient-to-br from-indigo-900/50 to-violet-900/50 border border-indigo-500/20 rounded-3xl p-12 md:p-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {locale === 'ko'
                ? 'AI 에이전트 군단을 직접 운용하세요'
                : locale === 'ja'
                  ? 'AIエージェント軍団を自分で運用しよう'
                  : 'Command Your Own AI Agent Army'}
            </h2>
            <p className="text-zinc-400 text-lg mb-8 max-w-2xl mx-auto">
              {locale === 'ko'
                ? '15.5시간의 실전 프로젝트로 AI 에이전트 오케스트레이션을 마스터하세요. 얼리버드 가격은 한정 수량입니다.'
                : locale === 'ja'
                  ? '15.5時間の実践プロジェクトでAIエージェントオーケストレーションをマスター。アーリーバード価格は数量限定です。'
                  : 'Master AI agent orchestration through 15.5 hours of hands-on projects. Early bird pricing is limited.'}
            </p>
            <div className="flex items-center justify-center gap-4 mb-8">
              {lecture.originalPrice && (
                <span className="text-xl text-zinc-500 line-through">
                  {'\u20A9'}{lecture.originalPrice.toLocaleString()}
                </span>
              )}
              <span className="text-4xl font-bold text-white">
                {'\u20A9'}{lecture.price.toLocaleString()}
              </span>
            </div>
            <Link
              href={checkoutUrl}
              className="inline-flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-12 py-4 rounded-xl text-lg font-bold transition-all shadow-lg shadow-indigo-600/25 hover:shadow-indigo-500/40 hover:scale-105"
            >
              {t('purchase')}
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ===================== STICKY BOTTOM CTA BAR ===================== */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ${
          showSticky ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
      >
        <div className="bg-zinc-900/95 backdrop-blur-lg border-t border-zinc-800 shadow-2xl">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="hidden sm:block">
              <p className="text-sm text-zinc-400 truncate max-w-md">{title}</p>
              <div className="flex items-center gap-3">
                {lecture.originalPrice && (
                  <span className="text-sm text-zinc-500 line-through">
                    {'\u20A9'}{lecture.originalPrice.toLocaleString()}
                  </span>
                )}
                <span className="text-xl font-bold text-white">
                  {'\u20A9'}{lecture.price.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
              <div className="sm:hidden">
                <span className="text-xl font-bold text-white">
                  {'\u20A9'}{lecture.price.toLocaleString()}
                </span>
              </div>
              <Link
                href={checkoutUrl}
                className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/25"
              >
                {t('purchase')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom spacer for sticky bar */}
      <div className="h-20" />
    </div>
  );
}
