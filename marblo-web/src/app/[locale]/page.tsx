import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import HeroScreenshot from "@/components/HeroScreenshot";
import { Check, X, Minus } from "lucide-react";
import FeatureSection from "@/components/FeatureSection";
import BetaTester50Section from "@/components/BetaTester50Section";

export default function HomePage() {
  const t = useTranslations();
  const locale =
    t("nav.home") === "홈" ? "ko" : t("nav.home") === "ホーム" ? "ja" : "en";

  const comparisonRows = [
    "multiAgent",
    "kanban",
    "flowEditor",
    "orchestrator",
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
    flowEditor: {
      marblo: true,
      cursor: false,
      copilot: false,
      windsurf: false,
    },
    orchestrator: {
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
      {/* Hero */}
      <section className="py-28 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-600/5 to-transparent" />
        <div className="max-w-4xl mx-auto relative">
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

          {/* App Screenshot Mockup */}
          <HeroScreenshot />
        </div>
      </section>

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

      {/* Lecture Bundle */}
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
                <div className="text-3xl font-bold text-white mb-2">
                  {t("bundle.lecture_price")}
                </div>
                <div className="inline-block bg-green-500/20 text-green-400 text-sm font-medium px-3 py-1 rounded-full">
                  {t("bundle.bundle_benefit")}
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
