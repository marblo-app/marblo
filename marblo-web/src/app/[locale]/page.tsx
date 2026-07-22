import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import HeroScreenshot from "@/components/HeroScreenshot";
import HeroConstellation from "@/components/HeroConstellation";
import { Check, X, Minus } from "lucide-react";
import FeatureSection from "@/components/FeatureSection";
import FeatureVideoSection from "@/components/FeatureVideoSection";
import BetaTester50Section from "@/components/BetaTester50Section";
import {
  buildSoftwareApplicationSchema,
  buildFAQPageSchema,
} from "@/lib/schema";

// Answer-first FAQ for GEO (generative-engine optimization). Each answer opens
// with the direct, citable claim so LLM crawlers can lift a self-contained
// snippet. Facts only — no unreleased Mission/Flow features.
const HOME_FAQS: Record<
  "ko" | "en" | "ja",
  { question: string; answer: string }[]
> = {
  ko: [
    {
      question: "마블로(Marblo)가 무엇인가요?",
      answer:
        "마블로는 여러 AI 코딩 에이전트를 하나의 칸반 보드에서 동시에 오케스트레이션하는 데스크톱 앱입니다. 중앙 오케스트레이터가 태스크를 분할해 각 에이전트에 할당하고 진행 상황을 실시간으로 추적합니다. macOS와 Windows에서 실행됩니다.",
    },
    {
      question: "마블로는 어떤 AI 에이전트를 지원하나요?",
      answer:
        "마블로는 Claude, GPT/Codex, Antigravity 등 이종 AI 에이전트를 동시에 운용합니다. 각 모델의 강점에 맞춰 백엔드·프론트엔드·테스트 등 역할을 나눠 배치하며, MCP(Model Context Protocol)를 네이티브로 지원합니다.",
    },
    {
      question: "마블로 가격은 얼마인가요?",
      answer:
        "마블로 Free 플랜은 월 ₩0이고 Pro 플랜은 월 ₩19,000(약 $15)입니다. AI 사용료는 별도이며, 각 에이전트는 사용자의 기존 Claude Code·Codex 등 AI 계정(또는 API 키)을 연결해 운영합니다.",
    },
    {
      question: "마블로는 맥과 윈도우에서 모두 작동하나요?",
      answer:
        "네. 마블로는 macOS와 Windows용 데스크톱 앱으로 제공되며 다운로드 페이지에서 설치 파일을 받을 수 있습니다. 모든 실행이 로컬 머신에서 이루어져 코드가 외부 서버로 전송되지 않습니다.",
    },
    {
      question:
        "마블로를 쓰려면 내 AI 계정(Claude Code·Codex 등)이 필요한가요?",
      answer:
        "네. 마블로는 이종 AI 에이전트 오케스트레이터이므로 각 모델(Claude, GPT/Codex 등)은 사용자의 기존 AI 계정(Claude Code·Codex 등 CLI 로그인, 또는 API 키)으로 실행됩니다. 설치 후 해당 CLI 설치·로그인·계정 연결이 필요합니다. 마블로 구독료는 에이전트를 통합 지휘하는 오케스트레이션 비용이며 AI 사용료를 포함하지 않습니다.",
    },
  ],
  en: [
    {
      question: "What is Marblo?",
      answer:
        "Marblo is a desktop app that orchestrates multiple AI coding agents simultaneously on a single kanban board. A central orchestrator splits tasks, assigns them to each agent, and tracks progress in real time. It runs on macOS and Windows.",
    },
    {
      question: "Which AI agents does Marblo support?",
      answer:
        "Marblo runs heterogeneous AI agents — Claude, GPT/Codex, and Antigravity — at the same time. It assigns roles such as backend, frontend, and testing based on each model's strengths, and supports the Model Context Protocol (MCP) natively.",
    },
    {
      question: "How much does Marblo cost?",
      answer:
        "Marblo's Free plan is ₩0/month and the Pro plan is ₩19,000/month (about $15). AI usage is billed separately — each agent runs on your own existing AI accounts (Claude Code, Codex, etc.) that you connect, or an API key.",
    },
    {
      question: "Does Marblo work on both Mac and Windows?",
      answer:
        "Yes. Marblo ships as a desktop app for macOS and Windows, and you can get the installer from the download page. Everything runs locally on your machine, so your code is not sent to external servers.",
    },
    {
      question:
        "Do I need my own AI accounts (Claude Code, Codex, etc.) to use Marblo?",
      answer:
        "Yes. Because Marblo is a heterogeneous AI-agent orchestrator, each model (Claude, GPT/Codex, and others) runs on your own existing AI account (Claude Code / Codex CLI sign-in, or an API key). After installing Marblo you'll install those CLIs, sign in, and connect your accounts. The Marblo subscription is the cost of orchestrating those agents and does not include AI usage fees.",
    },
  ],
  ja: [
    {
      question: "Marblo(マブロ)とは何ですか?",
      answer:
        "Marbloは複数のAIコーディングエージェントを一つのカンバンボードで同時にオーケストレーションするデスクトップアプリです。中央オーケストレーターがタスクを分割して各エージェントに割り当て、進捗をリアルタイムで追跡します。macOSとWindowsで動作します。",
    },
    {
      question: "MarbloはどのAIエージェントに対応していますか?",
      answer:
        "MarbloはClaude、GPT/Codex、Antigravityなどの異種AIエージェントを同時に運用します。各モデルの強みに合わせてバックエンド・フロントエンド・テストなどの役割を分担し、MCP(Model Context Protocol)をネイティブ対応しています。",
    },
    {
      question: "Marbloの料金はいくらですか?",
      answer:
        "MarbloのFreeプランは月額₩0、Proプランは月額₩19,000(約$15)です。AIの利用料金は別途で、各エージェントはユーザーが連携する既存のAIアカウント（Claude Code・Codexなど）またはAPIキーで動作します。",
    },
    {
      question: "MarbloはMacとWindowsの両方で動作しますか?",
      answer:
        "はい。MarbloはmacOSとWindows向けのデスクトップアプリとして提供され、ダウンロードページからインストーラーを入手できます。すべての処理はローカルマシン上で実行され、コードが外部サーバーに送信されることはありません。",
    },
    {
      question:
        "Marbloを使うには自分のAIアカウント（Claude Code・Codexなど）が必要ですか?",
      answer:
        "はい。Marbloは異種AIエージェントのオーケストレーターであるため、各モデル(Claude、GPT/Codexなど)はユーザー自身の既存AIアカウント（Claude Code・Codex CLIログイン、またはAPIキー）で実行されます。インストール後、これらのCLIのインストール・ログイン・アカウント連携が必要です。Marbloのサブスクリプション料金はエージェントを統合指揮するオーケストレーション費用であり、AI利用料は含みません。",
    },
  ],
};

export default function HomePage() {
  const t = useTranslations();
  const locale =
    t("nav.home") === "홈" ? "ko" : t("nav.home") === "ホーム" ? "ja" : "en";

  // JSON-LD: the product node (SoftwareApplication) + answer-first FAQPage.
  // Server-rendered into the home page HTML so it is present for crawlers.
  const softwareSchema = buildSoftwareApplicationSchema(locale);
  const faqSchema = buildFAQPageSchema(HOME_FAQS[locale]);

  const comparisonRows = [
    "multiAgent",
    "kanban",
    "ticketDiff",
    "agentNav",
    "multiModel",
    "mcp",
    "local",
  ] as const;

  // true = supported, false = not supported, 'partial' = partially
  const comparisonData: Record<string, Record<string, boolean | string>> = {
    multiAgent: {
      marblo: true,
      cursor: false,
      copilot: false,
      windsurf: false,
    },
    kanban: { marblo: true, cursor: false, copilot: false, windsurf: false },
    ticketDiff: {
      marblo: true,
      cursor: false,
      copilot: false,
      windsurf: false,
    },
    agentNav: {
      marblo: true,
      cursor: false,
      copilot: false,
      windsurf: false,
    },
    multiModel: {
      marblo: true,
      cursor: true,
      copilot: "partial",
      windsurf: true,
    },
    mcp: {
      marblo: true,
      cursor: true,
      copilot: "partial",
      windsurf: "partial",
    },
    local: { marblo: true, cursor: true, copilot: false, windsurf: true },
  };

  const prices: Record<string, string> = {
    marblo: "$19/mo",
    cursor: "$20/mo",
    copilot: "$10-39/mo",
    windsurf: "$15/mo",
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {/* Hero */}
      <section className="py-28 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-600/5 to-transparent" />
        <HeroConstellation />
        <div className="max-w-4xl mx-auto relative z-10">
          <span className="inline-block bg-indigo-500/10 text-indigo-400 text-sm font-medium px-4 py-1.5 rounded-full mb-6 border border-indigo-500/30">
            {t("hero.badge")}
          </span>
          <h1 className="text-5xl md:text-7xl font-bold leading-tight whitespace-pre-line tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            {t("hero.title")}
          </h1>
          <p className="mt-6 text-xl text-zinc-400 max-w-2xl mx-auto whitespace-pre-line leading-relaxed">
            {t("hero.subtitle")}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={`/${locale}/download`}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-xl text-lg font-semibold transition shadow-lg shadow-indigo-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("hero.cta_download")}
            </Link>
            <Link
              href={`/${locale}/pricing`}
              className="border border-zinc-700 hover:bg-zinc-800 text-white px-8 py-4 rounded-xl text-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("hero.cta_pricing")}
            </Link>
          </div>

          {/* Honest prerequisite — AI usage not included, CLI login/account
              connection required after install. Shown up front so users
              aren't surprised post-install. */}
          <p className="mt-5 text-sm text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            {t("hero.prereqNote")}
          </p>

          {/* App Screenshot Mockup */}
          <HeroScreenshot />
        </div>
      </section>

      <FeatureVideoSection />

      {/* Beta Tester 50 — inline waitlist signup */}
      <BetaTester50Section />

      {/* Value Proposition - Stats */}
      <section className="py-24 px-4 border-t border-zinc-800/50">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold whitespace-pre-line leading-tight">
            {t("value.title")}
          </h2>
          <p className="mt-4 text-lg text-zinc-400 max-w-2xl mx-auto whitespace-pre-line">
            {t("value.subtitle")}
          </p>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8"
              >
                <div className="text-5xl font-bold text-indigo-400 mb-2">
                  {t(`value.stat${i}_number`)}
                </div>
                <div className="text-zinc-400">{t(`value.stat${i}_label`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Killer Feature — Multi-Agent Orchestration */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-5 text-sm text-indigo-400 font-medium">
              {locale === "ko"
                ? "마블로만의 핵심 기술"
                : locale === "ja"
                ? "Marbloだけのコア技術"
                : "Core Technology Only in Marblo"}
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {locale === "ko"
                ? "이종 에이전트 오케스트레이션"
                : locale === "ja"
                ? "異種エージェント・オーケストレーション"
                : "Heterogeneous Agent Orchestration"}
            </h2>
            <p className="text-zinc-400 text-lg max-w-3xl mx-auto leading-relaxed">
              {locale === "ko"
                ? "중앙 오케스트레이터가 Claude, GPT/Codex, Antigravity 등 이종 AI 에이전트를 물리적/논리적으로 분할하여 태스크를 할당하고 관리합니다. 이것은 마블로에서만 가능합니다."
                : locale === "ja"
                ? "中央オーケストレーターがClaude、GPT/Codex、Antigravityなど異種AIエージェントを物理的/論理的に分割してタスクを割り当て管理します。これはMarbloでのみ可能です。"
                : "A central orchestrator physically and logically partitions heterogeneous AI agents — Claude, GPT/Codex, Antigravity — to assign and manage tasks. This is only possible with Marblo."}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-700/50 overflow-hidden shadow-2xl shadow-indigo-900/10">
            <Image
              src="/images/orchestration-demo.webp"
              alt="Marblo Agent Dashboard — Multi-model orchestration"
              width={2560}
              height={1440}
              className="w-full h-auto"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 text-center">
              <div className="text-2xl font-bold text-indigo-400 mb-2">3+</div>
              <p className="text-zinc-400 text-sm">
                {locale === "ko"
                  ? "AI 모델 동시 운용"
                  : locale === "ja"
                  ? "AIモデル同時運用"
                  : "AI Models Running Simultaneously"}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 text-center">
              <div className="text-2xl font-bold text-cyan-400 mb-2">1</div>
              <p className="text-zinc-400 text-sm">
                {locale === "ko"
                  ? "중앙 오케스트레이터"
                  : locale === "ja"
                  ? "中央オーケストレーター"
                  : "Central Orchestrator"}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 text-center">
              <div className="text-2xl font-bold text-amber-400 mb-2">0</div>
              <p className="text-zinc-400 text-sm">
                {locale === "ko"
                  ? "경쟁사 동일 기능"
                  : locale === "ja"
                  ? "競合の同等機能"
                  : "Competitors with This Feature"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features - Detailed (Client Component) */}
      <FeatureSection />

      {/* Comparison Table */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
            {t("comparison.title")}
          </h2>
          <p className="text-zinc-400 text-center mb-12 text-lg">
            {t("comparison.subtitle")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-4 px-4 text-zinc-400 font-medium">
                    {t("comparison.feature")}
                  </th>
                  <th className="text-center py-4 px-4 text-indigo-400 font-bold">
                    {t("comparison.marblo")}
                  </th>
                  <th className="text-center py-4 px-4 text-zinc-400 font-medium">
                    {t("comparison.cursor")}
                  </th>
                  <th className="text-center py-4 px-4 text-zinc-400 font-medium">
                    {t("comparison.copilot")}
                  </th>
                  <th className="text-center py-4 px-4 text-zinc-400 font-medium">
                    {t("comparison.windsurf")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row} className="border-b border-zinc-800/50">
                    <td className="py-4 px-4 text-zinc-300">
                      {t(`comparison.rows.${row}`)}
                    </td>
                    {["marblo", "cursor", "copilot", "windsurf"].map((tool) => (
                      <td key={tool} className="text-center py-4 px-4">
                        {comparisonData[row][tool] === true ? (
                          <Check className="w-5 h-5 text-green-400 mx-auto" />
                        ) : comparisonData[row][tool] === "partial" ? (
                          <Minus className="w-5 h-5 text-yellow-400 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-zinc-600 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-b border-zinc-800/50">
                  <td className="py-4 px-4 text-zinc-300 font-medium">
                    {t("comparison.rows.price")}
                  </td>
                  {["marblo", "cursor", "copilot", "windsurf"].map((tool) => (
                    <td
                      key={tool}
                      className={`text-center py-4 px-4 font-semibold ${
                        tool === "marblo" ? "text-indigo-400" : "text-zinc-400"
                      }`}
                    >
                      {prices[tool]}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Real Experience — founder & early beta, honestly attributed */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
            {t("experience.title")}
          </h2>
          <p className="text-zinc-400 text-center mb-12 text-lg">
            {t("experience.subtitle")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8 flex flex-col"
              >
                <span className="inline-block self-start bg-indigo-500/10 text-indigo-400 text-xs font-medium px-3 py-1 rounded-full mb-5 border border-indigo-500/20">
                  {t(`experience.tag${i}`)}
                </span>
                <p className="text-zinc-200 text-lg mb-6 leading-relaxed flex-1">
                  &ldquo;{t(`experience.quote${i}`)}&rdquo;
                </p>
                <div className="text-zinc-500 text-sm">
                  — {t(`experience.role${i}`)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 강의 (출시 예정) — 전환 전에는 "강의 + 앱 번들" 판매 섹션으로,
          가격(₩149,000 / $99 / ¥14,800)과 "강의 구매 시 Pro 50% 할인 쿠폰"
          혜택 칩이 노출됐다. 강의는 아직 판매하지 않으므로(checkout 가드가
          결제 진입을 차단) 가격·구매 문구를 함께 내리고 출시 예정 상태만
          알린다. 되돌리기: marblo-web/src/data/lectures.ts 상단
          "출시 예정 전환" 블록 참조(원래 가격 값도 거기 적어뒀다). */}
      <section className="py-24 px-4 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
            {t("bundle.title")}
          </h2>
          <p className="text-zinc-400 text-center mb-12 text-lg">
            {t("bundle.subtitle")}
          </p>
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8 md:p-12">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-3">
                  {t("bundle.lecture_title")}
                </h3>
                <p className="text-zinc-400 mb-4">{t("bundle.lecture_desc")}</p>
                <div className="inline-block bg-zinc-800 text-zinc-300 text-sm font-medium px-3 py-1 rounded-full">
                  {t("bundle.lecture_status")}
                </div>
              </div>
              <div>
                <Link
                  href={`/${locale}/lectures`}
                  className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-xl text-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  {t("bundle.cta")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
            {t("social.title")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-8"
              >
                <p className="text-zinc-300 text-lg mb-6 leading-relaxed">
                  &ldquo;{t(`social.quote${i}`)}&rdquo;
                </p>
                <div className="text-zinc-500 text-sm">
                  — {t(`social.author${i}`)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-4 text-center bg-gradient-to-t from-indigo-600/5 to-transparent">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t("cta_final.title")}
          </h2>
          <p className="text-zinc-400 text-lg mb-10 whitespace-pre-line">
            {t("cta_final.subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={`/${locale}/download`}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-xl text-lg font-semibold transition shadow-lg shadow-indigo-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("cta_final.download")}
            </Link>
            <Link
              href={`/${locale}/pricing`}
              className="border border-zinc-700 hover:bg-zinc-800 text-white px-8 py-4 rounded-xl text-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("cta_final.pricing")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
