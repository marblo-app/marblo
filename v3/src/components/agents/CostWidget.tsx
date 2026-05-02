import { useState, useEffect, useMemo } from "react";
import { useCostStore } from "../../stores/costStore";
import { useProjectStore } from "../../stores/projectStore";
import { useAgentStore } from "../../stores/agentStore";
import type { CostSummary } from "../../types/cost";

type DateRange = "today" | "week" | "month" | "all";

export default function CostWidget() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const { summary, loading, loadCosts } = useCostStore();
  const agents = useAgentStore((s) => s.agents);
  const [dateRange, setDateRange] = useState<DateRange>("today");

  useEffect(() => {
    if (!currentProject) return;
    loadCosts(currentProject.id);
  }, [currentProject, loadCosts]);

  // Live summary derived from each agent's rolling totals (Firestore agent
  // doc fields written by useCostWriter on every cost:update). Used as a
  // fallback when the BigQuery-backed summary isn't available — and as the
  // truthier "right now" view for active sessions.
  const liveSummary = useMemo<CostSummary | null>(() => {
    if (!agents.length) return null;
    const s: CostSummary = {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      byAgent: {},
      byDay: {},
    };
    for (const a of agents) {
      const cost = a.totalCost ?? 0;
      const input = a.totalInputTokens ?? 0;
      const output = a.totalOutputTokens ?? 0;
      const cacheR = a.totalCacheReadTokens ?? 0;
      const cacheW = a.totalCacheWriteTokens ?? 0;
      if (!cost && !input && !output && !cacheR && !cacheW) continue;
      s.totalCost += cost;
      s.totalInputTokens += input;
      s.totalOutputTokens += output;
      s.totalCacheReadTokens += cacheR;
      s.totalCacheWriteTokens += cacheW;
      s.byAgent[a.id] = {
        cost,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheR,
        cacheWriteTokens: cacheW,
        model: a.model || "",
      };
    }
    return s.totalCost > 0 || s.totalInputTokens > 0 ? s : null;
  }, [agents]);

  if (loading && !liveSummary) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-700" />
      </div>
    );
  }

  // Prefer live (Firestore) summary; fall back to BigQuery historical.
  const effective = liveSummary ?? summary;
  if (!effective || effective.totalCost === 0) return null;

  const filtered = filterByDateRange(effective, dateRange);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Cost Tracking</h3>
        <div className="flex gap-1">
          {(["today", "week", "month", "all"] as DateRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                dateRange === range
                  ? "bg-blue-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {range === "today"
                ? "Today"
                : range === "week"
                ? "Week"
                : range === "month"
                ? "Month"
                : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="text-2xl font-bold text-gray-100">
        ${filtered.totalCost.toFixed(2)}
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span>Input: {formatTokens(filtered.totalInputTokens)}</span>
        <span>Output: {formatTokens(filtered.totalOutputTokens)}</span>
      </div>

      {Object.keys(filtered.byAgent).length > 0 && (
        <div className="space-y-1.5 border-t border-gray-700 pt-3">
          <span className="text-xs text-gray-500">By Agent</span>
          {Object.entries(filtered.byAgent)
            .sort(([, a], [, b]) => b.cost - a.cost)
            .map(([agentId, data]) => (
              <div
                key={agentId}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-gray-400 truncate max-w-[150px]">
                  {agentId.slice(0, 12)}...
                </span>
                <span className="text-gray-200 font-mono">
                  ${data.cost.toFixed(2)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function filterByDateRange(
  summary: CostSummary,
  range: DateRange
): CostSummary {
  if (range === "all") return summary;

  const now = new Date();
  let cutoff: Date;

  switch (range) {
    case "today":
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week":
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }

  const cutoffStr = cutoff.toISOString().split("T")[0];

  const filteredByDay: Record<string, number> = {};
  let totalCost = 0;

  for (const [day, cost] of Object.entries(summary.byDay)) {
    if (day >= cutoffStr) {
      filteredByDay[day] = cost;
      totalCost += cost;
    }
  }

  return {
    ...summary,
    totalCost,
    byDay: filteredByDay,
  };
}
