import { useState } from "react";
import { buildShareMarkdown, type ShareStats } from "../../lib/shareCard";

interface ShareCardProps {
  stats: ShareStats;
}

interface StatProps {
  label: string;
  value: number;
  tone: string;
}

function Stat({ label, value, tone }: StatProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
      <span className={`font-mono text-lg font-semibold ${tone}`}>{value}</span>
      <span className="mt-0.5 text-[11px] text-gray-400">{label}</span>
    </div>
  );
}

/**
 * "Shipped with Marblo" 공유카드 lite — 세션 집계를 보여주고, 복사 가능한 한 줄
 * markdown 을 클립보드로 내보낸다. 자동 PR-comment 푸터(electron 필요)는 이번 범위
 * 밖이라 "복사" 까지만 제공한다.
 */
export function ShareCard({ stats }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const markdown = buildShareMarkdown(stats);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 거부(권한/포커스) — 조용히 무시. 텍스트는 화면에 그대로 보인다.
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">
            Shipped with Marblo
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            완료 {stats.doneTasks}건 집계 · 테스트통과/리스크는 완료 보고 키워드
            추정값
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 rounded border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/10"
          title="공유용 markdown 복사"
        >
          {copied ? "복사됨 ✓" : "markdown 복사"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-2">
        <Stat label="agents" value={stats.agents} tone="text-blue-300" />
        <Stat label="PRs" value={stats.prs} tone="text-violet-300" />
        <Stat label="files" value={stats.files} tone="text-emerald-300" />
        <Stat label="tests" value={stats.testsPassed} tone="text-amber-300" />
        <Stat label="risk flags" value={stats.riskFlags} tone="text-red-300" />
      </div>

      <pre className="mt-3 overflow-x-auto rounded border border-gray-800 bg-gray-950/60 px-3 py-2 font-mono text-[11px] leading-snug text-gray-400">
        {markdown}
      </pre>
    </div>
  );
}
