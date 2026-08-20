"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Clock,
  Play,
  ChevronDown,
  ChevronUp,
  Check,
  Monitor,
  Rocket,
  BookOpen,
  Shield,
  ArrowRight,
  Layers,
  Sparkles,
  Workflow,
  User,
  CalendarClock,
  CalendarCheck,
  Timer,
  ShieldCheck,
} from "lucide-react";
import {
  lectures as staticLectures,
  comingSoonLabel,
  type LectureData,
} from "@/data/lectures";

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
  const t = useTranslations("lectures");
  const locale = useLocale();
  const params = useParams();
  const slug = params.slug as string;

  const [lecture, setLecture] = useState<LectureData | null>(null);
  const [openModules, setOpenModules] = useState<Set<number>>(new Set([0]));
  const [showSticky, setShowSticky] = useState(false);

  // Fetch lecture: Firestore first, static fallback
  useEffect(() => {
    const fetchLecture = async () => {
      try {
        const docRef = doc(db, "lectures", slug);
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
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Computed values
  const stats = useMemo(() => {
    if (!lecture) return null;
    const totalSections = lecture.modules.reduce(
      (sum, m) => sum + m.sections.length,
      0
    );
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

  if (!lecture || !stats) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-zinc-500 text-lg">Loading...</div>
      </div>
    );
  }

  const title = locale === "ko" ? lecture.title_ko : lecture.title_en;
  const subtitle = locale === "ko" ? lecture.subtitle_ko : lecture.subtitle_en;
  const description =
    locale === "ko" ? lecture.description_ko : lecture.description_en;
  const features = locale === "ko" ? lecture.features : lecture.features_en;
  const requirements =
    locale === "ko" ? lecture.requirements : lecture.requirements_en;

  // 토스페이 가맹점 심사 대응(xRlxnHV0CDp5eVvItxHK) — 강사 이력·모집기간·개강시점·
  // 수강기간·모집실패 시 처리는 ko/en/ja 모두 데이터에 준비되어 있으므로 3분기.
  const instructorBio =
    locale === "ko"
      ? lecture.instructorBio_ko
      : locale === "ja"
      ? lecture.instructorBio_ja
      : lecture.instructorBio_en;
  const enrollmentPeriod =
    locale === "ko"
      ? lecture.enrollmentPeriod_ko
      : locale === "ja"
      ? lecture.enrollmentPeriod_ja
      : lecture.enrollmentPeriod_en;
  const courseStartDate =
    locale === "ko"
      ? lecture.courseStartDate_ko
      : locale === "ja"
      ? lecture.courseStartDate_ja
      : lecture.courseStartDate_en;
  const courseAccessPeriod =
    locale === "ko"
      ? lecture.courseAccessPeriod_ko
      : locale === "ja"
      ? lecture.courseAccessPeriod_ja
      : lecture.courseAccessPeriod_en;
  const enrollmentFailurePolicy =
    locale === "ko"
      ? lecture.enrollmentFailurePolicy_ko
      : locale === "ja"
      ? lecture.enrollmentFailurePolicy_ja
      : lecture.enrollmentFailurePolicy_en;

  const killingPoints =
    locale === "ko"
      ? [
          {
            icon: Layers,
            title: "멀티모델 오케스트레이션",
            desc: "Claude + Codex + Antigravity를 하나의 칸반 보드에서 동시 운용. 각 AI의 강점을 극대화하는 실전 전략을 배웁니다.",
          },
          {
            icon: Monitor,
            title: "올인원 데스크탑 앱",
            desc: "터미널, 칸반, 오케스트레이터, 코드 에디터 — 모든 것이 마블로 하나에. 설치부터 커스터마이징까지 완벽 가이드.",
          },
          {
            icon: Rocket,
            title: "실전 SaaS 빌드 & 배포",
            desc: "날씨 대시보드 워밍업 → AI SaaS 메인 프로젝트 → GCP Cloud Run 배포. 15.5시간 만에 프로덕션 레벨 서비스 완성.",
          },
        ]
      : locale === "ja"
      ? [
          {
            icon: Layers,
            title: "マルチモデルオーケストレーション",
            desc: "Claude + Codex + Antigravityを一つのカンバンボードで同時運用。各AIの強みを最大化する実践戦略を学びます。",
          },
          {
            icon: Monitor,
            title: "オールインワンデスクトップアプリ",
            desc: "ターミナル、カンバン、オーケストレーター、コードエディタ — すべてがMarblo一つに。インストールからカスタマイズまで完全ガイド。",
          },
          {
            icon: Rocket,
            title: "実践SaaSビルド＆デプロイ",
            desc: "天気ダッシュボードウォームアップ → AI SaaSメインプロジェクト → GCP Cloud Runデプロイ。15.5時間でプロダクションレベルのサービス完成。",
          },
        ]
      : [
          {
            icon: Layers,
            title: "Multi-Model Orchestration",
            desc: "Run Claude + Codex + Antigravity simultaneously on one kanban board. Learn real-world strategies to maximize each AI's strengths.",
          },
          {
            icon: Monitor,
            title: "All-in-One Desktop App",
            desc: "Terminal, Kanban, Orchestrator, Code Editor — everything in Marblo. Complete guide from installation to customization.",
          },
          {
            icon: Rocket,
            title: "Real SaaS Build & Deploy",
            desc: "Weather dashboard warmup → AI SaaS main project → GCP Cloud Run deployment. Production-level service in 15.5 hours.",
          },
        ];

  const packages = [
    {
      key: "earlybird" as const,
      // 판매 신호 제거: 전환 전에는 badge '한정 300석', 제목이 데이터의 '얼리버드'였다.
      // 한정수량·얼리버드는 사전예약으로 읽히므로 중립적 구성명으로 '표시만' 바꾼다
      // (LECTURE_PACKAGES 데이터는 그대로). 되돌리기: @/data/lectures 상단 참조.
      badge: "",
      displayLabel:
        locale === "ko"
          ? "기본 구성"
          : locale === "ja"
          ? "基本構成"
          : "Standard Edition",
      highlighted: true,
      features:
        locale === "ko"
          ? [
              "전체 8모듈 15.5시간 강의",
              "완성 소스코드 2개 프로젝트",
              "디스코드 커뮤니티 액세스",
              "마블로 Pro 6개월 무료 쿠폰",
              "마블로 초기 앰배서더 인증서",
              "구매 후 1년간 업데이트 무료",
            ]
          : locale === "ja"
          ? [
              "全8モジュール 15.5時間講座",
              "完成ソースコード2プロジェクト",
              "Discordコミュニティアクセス",
              "Marblo Pro 6ヶ月無料クーポン",
              "Marblo初期アンバサダー認定証",
              "購入後1年間アップデート無料",
            ]
          : [
              "All 8 modules, 15.5h video",
              "2 complete project source codes",
              "Discord community access",
              "Marblo Pro 6-month free coupon",
              "Marblo Early Ambassador Certificate",
              "Free updates for 1 year after purchase",
            ],
    },
    {
      key: "proBudle" as const,
      badge: "",
      displayLabel:
        locale === "ko"
          ? "프로 번들 구성"
          : locale === "ja"
          ? "プロバンドル構成"
          : "Pro Bundle Edition",
      highlighted: false,
      features:
        locale === "ko"
          ? [
              "기본 구성 전체 포함",
              "마블로 Pro 1년 무료 쿠폰",
              "에이전트 스킬 템플릿 5종",
              "PRD + 태스크 템플릿 5종",
              "월간 라이브 Q&A",
            ]
          : locale === "ja"
          ? [
              "基本構成の全内容を含む",
              "Marblo Pro 1年間無料クーポン",
              "エージェントスキルテンプレート5種",
              "PRD＋タスクテンプレート5種",
              "月間ライブQ&A",
            ]
          : [
              "Everything in Standard Edition",
              "Marblo Pro 1-year free coupon",
              "5 agent skill templates",
              "5 PRD + task templates",
              "Monthly live Q&A",
            ],
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ===================== HERO ===================== */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/40 via-zinc-950 to-zinc-950" />

        <div className="relative max-w-5xl mx-auto px-4 pt-28 pb-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
            <Link
              href={`/${locale}/lectures`}
              className="hover:text-zinc-300 transition"
            >
              {locale === "ko" ? "강의" : locale === "ja" ? "講座" : "Lectures"}
            </Link>
            <span>/</span>
            <span className="text-zinc-400">
              {locale === "ko"
                ? "마스터클래스"
                : locale === "ja"
                ? "マスタークラス"
                : "Masterclass"}
            </span>
          </div>

          {/* 출시 예정 뱃지 — 전환 전에는 '베스트셀러' 뱃지였다. 판매 중 신호를
              지운다. 되돌리기: @/data/lectures 상단 '출시 예정 전환' 블록 참조 */}
          <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-400/30 rounded-full px-4 py-1.5 mb-5">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-sm text-indigo-300 font-medium">
              {t("coming_soon")}
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
                <p className="text-sm font-medium text-white">
                  {lecture.instructor}
                </p>
                <p className="text-xs text-zinc-500">
                  {lecture.instructorTitle}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-sm">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                {stats.modules}{" "}
                {locale === "ko"
                  ? "모듈"
                  : locale === "ja"
                  ? "モジュール"
                  : "Modules"}
              </span>
              <span className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-sm">
                <Play className="w-4 h-4 text-indigo-400" />
                {stats.sections}{" "}
                {locale === "ko"
                  ? "강의"
                  : locale === "ja"
                  ? "レッスン"
                  : "Sections"}
              </span>
              <span className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-sm">
                <Clock className="w-4 h-4 text-indigo-400" />
                {stats.hours}{" "}
                {locale === "ko" ? "시간" : locale === "ja" ? "時間" : "Hours"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== 모집·개강 안내 (토스페이 가맹점 심사용) =====================
          xRlxnHV0CDp5eVvItxHK — 강사 이력·모집 기간·개강 시점·수강 기간·모집 실패 시
          진행 여부를 심사관이 스크롤/클릭 없이 바로 확인하도록 히어로 직후에 배치한다.
          접기·모달 금지. */}
      <section className="max-w-5xl mx-auto px-4 mb-16">
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 p-6 md:p-8">
          <h2 className="text-xl font-bold text-white mb-6">
            {t("operationInfoHeading")}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <CalendarClock className="w-4 h-4 text-indigo-400" />
                {t("enrollmentPeriodTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-300 leading-relaxed">
                {enrollmentPeriod}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <CalendarCheck className="w-4 h-4 text-indigo-400" />
                {t("courseStartDateTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-300 leading-relaxed">
                {courseStartDate}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Timer className="w-4 h-4 text-indigo-400" />
                {t("courseAccessPeriodTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-300 leading-relaxed">
                {courseAccessPeriod}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                {t("enrollmentFailureTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-300 leading-relaxed">
                {enrollmentFailurePolicy}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <User className="w-4 h-4 text-indigo-400" />
              {t("instructorBioTitle")} — {lecture.instructor}
            </p>
            <div className="mt-3 space-y-3">
              {instructorBio.split("\n\n").map((para, i) => (
                <p
                  key={i}
                  className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line"
                >
                  {para}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== COURSE BANNER IMAGE ===================== */}
      <section className="max-w-5xl mx-auto px-4 mb-10">
        <div className="rounded-2xl overflow-hidden border border-zinc-700/50 shadow-2xl shadow-indigo-900/10">
          <Image
            src="/images/lectures/marblo-workspace-board.png"
            alt="Marblo AI Agent Masterclass"
            width={1480}
            height={960}
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
              {/* 상태 정보 — 전환 전에는 가격 정보(정가 취소선 + 얼리버드 예정가 +
                  % OFF + 'Pro 6개월 무료 쿠폰 포함')였다. 가격과 사전예약 문구를
                  함께 내려 결제를 받는 것처럼 보이지 않게 한다.
                  되돌리기: @/data/lectures 상단 '출시 예정 전환' 블록 참조 */}
              <div>
                <p className="text-2xl md:text-3xl font-bold text-white mb-2">
                  {t("notify_heading")}
                </p>
                <p className="text-sm text-zinc-400 leading-relaxed max-w-md">
                  {t("commerceNotice")}
                </p>
              </div>

              {/* CTA */}
              <div className="flex flex-col items-center gap-3">
                <a
                  href="#lecture-notify"
                  className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-10 py-4 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-indigo-600/25 hover:shadow-indigo-500/40 hover:scale-105 whitespace-nowrap"
                >
                  {t("notify_cta")}
                  <ArrowRight className="w-5 h-5" />
                </a>
                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t("coming_soon")}</span>
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
            {locale === "ko"
              ? "강의 소개"
              : locale === "ja"
              ? "講座紹介"
              : "Course Overview"}
          </h2>
          {description.split("\n\n").map((para, i) => (
            <p
              key={i}
              className="text-zinc-300 leading-relaxed mb-5 last:mb-0 text-[15px]"
            >
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
              {locale === "ko"
                ? "마블로만의 핵심 기술"
                : locale === "ja"
                ? "Marbloだけのコア技術"
                : "Only in Marblo"}
            </span>
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              {locale === "ko"
                ? "이종 에이전트 오케스트레이션을 배웁니다"
                : locale === "ja"
                ? "異種エージェント・オーケストレーションを学ぶ"
                : "Learn Heterogeneous Agent Orchestration"}
            </h2>
            <p className="text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              {locale === "ko"
                ? "Claude, Codex(GPT), Antigravity를 하나의 대시보드에서 동시 관리하고, 태스크를 물리적/논리적으로 분할하여 할당하는 방법을 실전으로 배웁니다."
                : locale === "ja"
                ? "Claude、Codex(GPT)、Antigravityを一つのダッシュボードで同時管理し、タスクを物理的/論理的に分割して割り当てる方法を実践で学びます。"
                : "Learn to manage Claude, Codex (GPT), and Antigravity simultaneously from one dashboard, assigning tasks with physical and logical partitioning."}
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
              {locale === "ko"
                ? "이 강의가 특별한 이유"
                : locale === "ja"
                ? "この講座が特別な理由"
                : "Why This Course Stands Out"}
            </h2>
            <p className="text-zinc-400 text-lg">
              {locale === "ko"
                ? "다른 어디에서도 배울 수 없는 3가지 핵심 역량"
                : locale === "ja"
                ? "他では学べない3つの核心能力"
                : "3 core competencies you cannot learn anywhere else"}
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
                <p className="text-zinc-400 leading-relaxed text-[15px]">
                  {kp.desc}
                </p>
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
              {locale === "ko"
                ? "15.5시간 동안 이것들을 만듭니다"
                : locale === "ja"
                ? "15.5時間でこれらを作ります"
                : "What You'll Build in 15.5 Hours"}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {(locale === "ko"
              ? [
                  {
                    icon: Monitor,
                    iconColor: "text-indigo-400",
                    title: "날씨 대시보드",
                    desc: "워밍업 프로젝트로 마블로의 전체 워크플로우를 체험합니다. /tf-plan → /tf-start → 에이전트 스폰 → 배포까지.",
                    tag: "워밍업",
                  },
                  {
                    icon: Rocket,
                    iconColor: "text-indigo-400",
                    title: "AI SaaS 서비스",
                    desc: "풀스택 AI SaaS를 멀티 에이전트로 빌드합니다. 백엔드 + 프론트엔드 + 통합 테스트 → GCP Cloud Run 배포.",
                    tag: "메인 프로젝트",
                  },
                  {
                    icon: Workflow,
                    iconColor: "text-indigo-400",
                    title: "오케스트레이터 자동 분해 & dispatch",
                    desc: "오케스트레이터가 목표를 태스크로 자동 분해해 Claude/Codex/Antigravity 에이전트에 dispatch. 티켓 → 에이전트 연결과 diff 추적까지 실전으로 다룹니다.",
                    tag: "오케스트레이션",
                  },
                  {
                    icon: Sparkles,
                    iconColor: "text-indigo-400",
                    title: "SaaS 랜딩페이지",
                    desc: "Stitch MCP를 활용해 마케팅 랜딩페이지를 디자인하고 런칭 체크리스트까지 완성합니다.",
                    tag: "런칭",
                  },
                ]
              : locale === "ja"
              ? [
                  {
                    icon: Monitor,
                    iconColor: "text-indigo-400",
                    title: "天気ダッシュボード",
                    desc: "ウォームアッププロジェクトでMarbloの全ワークフローを体験。/tf-plan → /tf-start → エージェントスポーン → デプロイまで。",
                    tag: "ウォームアップ",
                  },
                  {
                    icon: Rocket,
                    iconColor: "text-indigo-400",
                    title: "AI SaaSサービス",
                    desc: "フルスタックAI SaaSをマルチエージェントでビルド。バックエンド＋フロントエンド＋統合テスト → GCP Cloud Runデプロイ。",
                    tag: "メインプロジェクト",
                  },
                  {
                    icon: Workflow,
                    iconColor: "text-indigo-400",
                    title: "オーケストレーター自動分解＆dispatch",
                    desc: "オーケストレーターが目標をタスクに自動分解し、Claude/Codex/Antigravityエージェントにdispatch。チケット → エージェント連携とdiff追跡まで実践で扱います。",
                    tag: "オーケストレーション",
                  },
                  {
                    icon: Sparkles,
                    iconColor: "text-indigo-400",
                    title: "SaaSランディングページ",
                    desc: "Stitch MCPを活用してマーケティングランディングページをデザインし、ローンチチェックリストまで完成。",
                    tag: "ローンチ",
                  },
                ]
              : [
                  {
                    icon: Monitor,
                    iconColor: "text-indigo-400",
                    title: "Weather Dashboard",
                    desc: "Experience Marblo's full workflow as a warmup. /tf-plan → /tf-start → agent spawn → deployment.",
                    tag: "Warmup",
                  },
                  {
                    icon: Rocket,
                    iconColor: "text-indigo-400",
                    title: "AI SaaS Service",
                    desc: "Build a full-stack AI SaaS with multi-agents. Backend + Frontend + integration tests → GCP Cloud Run deployment.",
                    tag: "Main Project",
                  },
                  {
                    icon: Workflow,
                    iconColor: "text-indigo-400",
                    title: "Orchestrator Auto-Dispatch",
                    desc: "The orchestrator decomposes a goal into tasks and dispatches them to Claude/Codex/Antigravity agents — including ticket-to-agent linking and diff tracking.",
                    tag: "Orchestration",
                  },
                  {
                    icon: Sparkles,
                    iconColor: "text-indigo-400",
                    title: "SaaS Landing Page",
                    desc: "Design a marketing landing page with Stitch MCP and complete the launch checklist.",
                    tag: "Launch",
                  },
                ]
            ).map((project, i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8 hover:border-indigo-500/30 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-600/10 flex items-center justify-center flex-shrink-0">
                    <project.icon className={`w-6 h-6 ${project.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-medium">
                      {project.tag}
                    </span>
                    <h3 className="text-lg font-bold mt-2 mb-2">
                      {project.title}
                    </h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      {project.desc}
                    </p>
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
                {locale === "ko"
                  ? "커리큘럼"
                  : locale === "ja"
                  ? "カリキュラム"
                  : "Curriculum"}
              </h2>
              <p className="text-zinc-400">
                {stats.modules}{" "}
                {locale === "ko"
                  ? "모듈"
                  : locale === "ja"
                  ? "モジュール"
                  : "modules"}{" "}
                &middot; {stats.sections}{" "}
                {locale === "ko"
                  ? "강의"
                  : locale === "ja"
                  ? "レッスン"
                  : "sections"}{" "}
                &middot; {stats.hours}{" "}
                {locale === "ko" ? "시간" : locale === "ja" ? "時間" : "hours"}
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
                ? locale === "ko"
                  ? "모두 접기"
                  : locale === "ja"
                  ? "すべて折りたたむ"
                  : "Collapse All"
                : locale === "ko"
                ? "모두 펼치기"
                : locale === "ja"
                ? "すべて展開"
                : "Expand All"}
            </button>
          </div>

          <div className="space-y-3">
            {lecture.modules.map((mod, i) => {
              const isOpen = openModules.has(i);
              const moduleDuration = mod.sections.reduce(
                (s, sec) => s + sec.duration,
                0
              );
              const moduleTitle = locale === "ko" ? mod.title : mod.title_en;

              return (
                <div
                  key={i}
                  className={`rounded-xl overflow-hidden transition-all ${
                    isOpen
                      ? "bg-zinc-900 border border-indigo-500/30"
                      : "bg-zinc-900/80 border border-zinc-700/50 hover:border-zinc-600"
                  }`}
                >
                  <button
                    onClick={() => toggleModule(i)}
                    className="w-full flex items-center justify-between px-6 py-5 text-left transition"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-mono font-bold px-2.5 py-1 rounded-lg text-indigo-400 bg-indigo-500/10">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-semibold text-white text-[15px]">
                        {moduleTitle}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:flex items-center gap-2">
                        <span className="text-xs bg-zinc-800/80 text-zinc-400 px-2 py-1 rounded-md">
                          {mod.sections.length}{" "}
                          {locale === "ko"
                            ? "강의"
                            : locale === "ja"
                            ? "レッスン"
                            : "lectures"}
                        </span>
                        <span className="text-xs bg-zinc-800/80 text-zinc-400 px-2 py-1 rounded-md">
                          {formatDuration(moduleDuration)}
                        </span>
                      </div>
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
                          isOpen ? "bg-zinc-800" : "bg-zinc-800/50"
                        }`}
                      >
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
                          const secTitle =
                            locale === "ko" ? sec.title : sec.title_en;
                          return (
                            <div
                              key={j}
                              className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-zinc-800/50 transition group"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-lg bg-zinc-800/80 flex items-center justify-center group-hover:bg-zinc-800">
                                  <Play className="w-3.5 h-3.5 text-zinc-500 group-hover:text-indigo-400 transition" />
                                </div>
                                <span className="text-sm text-zinc-300">
                                  {secTitle}
                                </span>
                              </div>
                              <span className="text-xs text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded">
                                {formatDurationShort(sec.duration)}
                                {t("duration")}
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
              {locale === "ko"
                ? "수강하면 받는 것들"
                : locale === "ja"
                ? "受講で得られるもの"
                : "What You'll Get"}
            </h2>
            <p className="text-zinc-400 text-lg">
              {locale === "ko"
                ? "강의 영상 외에도 즉시 활용 가능한 에셋을 제공합니다"
                : locale === "ja"
                ? "動画以外にもすぐ活用できるアセットを提供"
                : "Beyond videos — practical assets you can use right away"}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-zinc-900 border border-zinc-700/50 rounded-xl px-5 py-4 hover:border-indigo-500/30 transition"
              >
                <Check className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <span className="text-zinc-300 text-[15px] leading-relaxed">
                  {feature}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== REQUIREMENTS ===================== */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-8">{t("commerceInfoTitle")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-100">
                {t("providerTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                {t("providerBody", {
                  instructor: lecture.instructor,
                  title: lecture.instructorTitle,
                })}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-100">
                {t("deliveryTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                {t("deliveryBody")}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-100">
                {t("validityTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                {t("validityBody")}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-100">
                {t("refundTitle")}
              </p>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                {t("refundBody")}
              </p>
              <Link
                href={`/${locale}/legal/refund`}
                target="_blank"
                className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300 underline"
              >
                {t("refundLink")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-8">
            {locale === "ko"
              ? "사전 요구사항"
              : locale === "ja"
              ? "前提条件"
              : "Prerequisites"}
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
            {locale === "ko"
              ? "* Claude Code 사용법은 모듈 1에서 자세히 다룹니다. 처음이어도 괜찮습니다."
              : locale === "ja"
              ? "* Claude Codeの使い方はモジュール1で詳しく扱います。初めてでも大丈夫です。"
              : "* Claude Code basics are covered in Module 1. No prior experience needed."}
          </p>
        </div>
      </section>

      {/* ===================== 구성 안내 (출시 예정) =====================
           전환 전에는 '패키지 선택 / Choose Your Package' 가격 카드였다.
           가격·보너스·한정수량 뱃지를 함께 내려 결제를 받는 것처럼 보이지
           않게 한다. 되돌리기: @/data/lectures 상단 블록 참조 */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">
            {locale === "ko"
              ? "구성 안내"
              : locale === "ja"
              ? "構成のご案内"
              : "What's Planned"}
          </h2>
          <p className="text-zinc-400 text-center mb-12">
            {locale === "ko"
              ? "공개 시 제공 예정인 구성입니다. 가격과 판매 시작일은 준비되는 대로 안내드립니다."
              : locale === "ja"
              ? "公開時に提供予定の構成です。価格と販売開始日は準備でき次第ご案内します。"
              : "What each edition is planned to include. Pricing and sale date will be announced when ready."}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {packages.map((pkg) => {
              const isEarlyBird = pkg.key === "earlybird";
              return (
                <div
                  key={pkg.key}
                  className={`rounded-2xl p-8 ${
                    isEarlyBird
                      ? "bg-zinc-900 border-2 border-indigo-500 shadow-lg shadow-indigo-500/10 relative"
                      : "bg-zinc-900 border border-zinc-700/50"
                  }`}
                >
                  {pkg.badge && (
                    <div
                      className={`inline-block text-xs font-semibold px-3 py-1 rounded-full mb-4 ${
                        isEarlyBird
                          ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {pkg.badge}
                    </div>
                  )}

                  <h3 className="text-xl font-bold mb-2">{pkg.displayLabel}</h3>
                  <div className="text-sm font-semibold text-zinc-400 mb-6">
                    {comingSoonLabel(locale)}
                  </div>

                  <ul className="space-y-3 mb-8">
                    {pkg.features.map((feat, i) => {
                      const isCouponFeature =
                        feat.includes("Pro") &&
                        (feat.includes("쿠폰") || feat.includes("coupon"));
                      return (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-zinc-300"
                        >
                          <Check
                            className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                              isCouponFeature
                                ? "text-amber-400"
                                : "text-indigo-400"
                            }`}
                          />
                          <span
                            className={`text-sm leading-relaxed ${
                              isCouponFeature
                                ? "text-amber-300 font-medium"
                                : ""
                            }`}
                          >
                            {feat}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <a
                    href="#lecture-notify"
                    className={`block text-center py-3 rounded-xl font-semibold transition-all ${
                      isEarlyBird
                        ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25"
                        : "bg-zinc-800 hover:bg-zinc-700 text-white"
                    }`}
                  >
                    {t("notify_cta")}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA → 곧 공개 예정 + 베타 신청 유입 (결제 대체) ============ */}
      <section id="lecture-notify" className="py-24 scroll-mt-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="bg-gradient-to-br from-indigo-900/50 to-violet-900/50 border border-indigo-500/20 rounded-3xl p-12 md:p-16">
            <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-400/30 rounded-full px-4 py-1.5 mb-5 text-sm text-indigo-300 font-medium">
              <Sparkles className="w-4 h-4" />
              {t("coming_soon")}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t("notify_heading")}
            </h2>
            <p className="text-zinc-400 text-lg mb-8 max-w-2xl mx-auto">
              {t("notify_subtitle")}
            </p>
            <Link
              href={`/${locale}/founders`}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-10 py-4 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-indigo-600/25 hover:shadow-indigo-500/40 hover:scale-105"
            >
              {t("notify_beta_cta")}
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ===================== STICKY BOTTOM CTA BAR ===================== */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ${
          showSticky
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0"
        }`}
      >
        <div className="bg-zinc-900/95 backdrop-blur-lg border-t border-zinc-800 shadow-2xl">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="hidden sm:block">
              <p className="text-sm text-zinc-400 truncate max-w-md">{title}</p>
              <p className="text-sm text-zinc-500">{t("coming_soon")}</p>
            </div>
            <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
              <a
                href="#lecture-notify"
                className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/25"
              >
                {t("notify_cta")}
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom spacer for sticky bar */}
      <div className="h-20" />
    </div>
  );
}
