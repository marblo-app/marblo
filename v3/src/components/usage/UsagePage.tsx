import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { Agent } from "../../types/agent";
import { useProjectStore } from "../../stores/projectStore";
import { useAgentStore } from "../../stores/agentStore";
import { useAuth } from "../../hooks/useAuth";
import { useCostStore } from "../../stores/costStore";
import type { CostWeekly } from "../../stores/costStore";
import type { CostByDayEntry } from "../../services/costService";
import { UsageDashboard } from "../agents/AgentDashboard";
import {
  CONNECTED_RATE_LIMIT_PACKAGES,
  getRateLimitProviderModels,
} from "./rateLimitProviders";

/**
 * Top-level Usage tab. Surfaces what used to be buried two levels deep
 * (Agents → Activity/Audit/Usage). Pulls the same data sources:
 *   - live per-agent rolling totals from the Firestore agent docs
 *     (written by useCostWriter on every cost:update)
 *   - BigQuery historical summary (byDay / byAgent) via costStore
 *
 * Sections: totals → daily trend → per-model & per-agent (reused
 * UsageDashboard) → rate-limit status.
 */
export function UsagePage() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);
  const ownedAgents = useAgentStore((s) => s.ownedAgents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const subscribeToOwnedAgents = useAgentStore((s) => s.subscribeToOwnedAgents);
  const { user } = useAuth();
  const { summary, loadCosts, trend, weekly, loadSummary } = useCostStore();
  const projectId = currentProject?.id || "";
  const ownerId = user?.uid || "";

  useEffect(() => {
    if (!projectId) return;
    return subscribeToAgents(projectId);
  }, [projectId, subscribeToAgents]);

  // Rate-limit panel is account-global: subscribe to every agent this user
  // owns across all projects, not just the current one. The same Claude/Codex
  // subscription limit is shared across projects, so this keeps the limit
  // identical regardless of which project is selected.
  useEffect(() => {
    if (!ownerId) return;
    return subscribeToOwnedAgents(ownerId);
  }, [ownerId, subscribeToOwnedAgents]);

  // loadCosts: raw logs → live-totals fallback (summary). loadSummary: the
  // server-aggregated daily trend + weekly token rollup (getCostSummary).
  useEffect(() => {
    if (!projectId) return;
    loadCosts(projectId);
    loadSummary(projectId);
  }, [projectId, loadCosts, loadSummary]);

  // Live totals from agent docs (preferred), summed across the fleet.
  const totals = useMemo(() => {
    let cost = 0;
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let hasLive = false;
    for (const a of agents) {
      if (
        a.totalCost !== undefined ||
        a.totalInputTokens !== undefined ||
        a.totalOutputTokens !== undefined
      ) {
        hasLive = true;
      }
      cost += a.totalCost ?? 0;
      input += a.totalInputTokens ?? 0;
      output += a.totalOutputTokens ?? 0;
      cacheRead += a.totalCacheReadTokens ?? 0;
      cacheWrite += a.totalCacheWriteTokens ?? 0;
    }
    // Fall back to BigQuery summary when no live agent totals exist yet.
    if (!hasLive && summary) {
      cost = summary.totalCost;
      input = summary.totalInputTokens;
      output = summary.totalOutputTokens;
      cacheRead = summary.totalCacheReadTokens;
      cacheWrite = summary.totalCacheWriteTokens;
    }
    return {
      cost,
      input,
      output,
      cacheRead,
      cacheWrite,
      tokens: input + output + cacheRead + cacheWrite,
    };
  }, [agents, summary]);

  if (!projectId) {
    return (
      <div className="p-6 text-sm text-gray-500">
        {t("usage.selectProjectPrompt")}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">
          {t("usage.title")}
        </h1>
        <p className="text-xs text-gray-500">{t("usage.subtitle")}</p>
      </div>

      {/* Recent 7-day token total (getCostSummary weekly rollup) */}
      <WeeklyTokenCard weekly={weekly} />

      {/* Totals */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label={t("usage.card.totalTokens")}
          value={formatTokens(totals.tokens)}
        />
        <SummaryCard
          label={t("usage.card.inputOutput")}
          value={`${formatTokens(totals.input)} / ${formatTokens(
            totals.output,
          )}`}
        />
        <SummaryCard
          label={t("usage.card.cache")}
          value={`${formatTokens(totals.cacheRead)} / ${formatTokens(
            totals.cacheWrite,
          )}`}
        />
      </div>

      {/* Daily trend (per-model) — server-aggregated, accumulates across days */}
      <DailyTrend trend={trend} rangeDays={weekly?.rangeDays ?? 30} />

      {/* Per-model & per-agent (reused) */}
      <Section title={t("usage.section.byModelAgent")}>
        <UsageDashboard agents={agents} />
      </Section>

      {/* Rate-limit status — account-global (all owned agents), not per-project */}
      <RateLimitPanel agents={ownedAgents} />
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono text-base font-medium text-gray-100">
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-gray-300">{title}</h2>
      {children}
    </div>
  );
}

// Brand labels stay literal; only the catch-all "other" is translated via
// familyLabel() at the render site (the label here is an inert fallback).
const MODEL_FAMILY_META: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#a78bfa" }, // purple
  gpt: { label: "Codex", color: "#34d399" }, // green
  gemini: { label: "Gemini", color: "#60a5fa" }, // blue
  antigravity: { label: "Antigravity", color: "#fb923c" }, // orange
  other: { label: "Other", color: "#9ca3af" },
};

/** Display label for a model family. Brand names are literal; the "other"
 * catch-all is localized. */
function familyLabel(family: string, t: (key: MessageKey) => string): string {
  if (family === "other") return t("usage.modelFamily.other");
  return MODEL_FAMILY_META[family]?.label ?? family;
}

/** Map a detected model id (claude-opus-4-7, gpt-5.4, gemini-3-flash…) to a
 * model family. antigravity also emits gemini-* ids, so the agent-doc family
 * (resolved by agentId) is preferred; this is the id-only fallback. */
function familyFromModelId(m: string): string {
  if (!m) return "other";
  if (m.startsWith("claude")) return "claude";
  if (m.startsWith("gemini")) return "gemini";
  if (/^(gpt|o[0-9]|codex)/i.test(m)) return "gpt";
  return "other";
}

type DayCell = { tokens: number; cost: number };

/**
 * "최근 7일 총 토큰량" — weekly token rollup from getCostSummary. The headline
 * number is weeklyTotalTokens; the breakdown is weeklyByModel (one family-
 * colored bar per model id). Window is a fixed last 7 days regardless of the
 * daily-trend range.
 */
function WeeklyTokenCard({ weekly }: { weekly: CostWeekly | null }) {
  const { t } = useTranslation();
  const total = weekly?.totalTokens ?? 0;
  const byModel = useMemo(
    () =>
      [...(weekly?.byModel ?? [])].sort(
        (a, b) => b.totalTokens - a.totalTokens,
      ),
    [weekly],
  );

  return (
    <Section title={t("usage.weekly.title")}>
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold text-gray-100">
            {formatTokens(total)}
          </span>
          <span className="text-xs text-gray-500">
            {t("usage.weekly.tokensSuffix")}
          </span>
        </div>

        {byModel.length > 0 ? (
          <div className="mt-3 space-y-2">
            {byModel.map((m, i) => {
              const family = familyFromModelId(m.model);
              const meta = MODEL_FAMILY_META[family] || MODEL_FAMILY_META.other;
              const pct = total > 0 ? (m.totalTokens / total) * 100 : 0;
              return (
                <div key={m.model || i}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-gray-300">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: meta.color }}
                      />
                      <span className="font-medium">
                        {familyLabel(family, t)}
                      </span>
                      <span className="text-gray-600">
                        {m.model || "unknown"}
                      </span>
                    </span>
                    <span className="font-mono text-gray-400">
                      {formatTokens(m.totalTokens)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: meta.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-snug text-gray-500">
            {t("usage.weekly.empty")}
          </p>
        )}
      </div>
    </Section>
  );
}

/**
 * Per-model daily token-usage trend. Driven by getCostSummary.byDay — server-
 * aggregated per day+model, so the trend accumulates across the full range
 * instead of collapsing to a single busy day (the old raw-logs LIMIT 200 bug).
 * Family is resolved from the model id (byDay carries no agentId, so
 * antigravity's gemini-* ids fold into the gemini family — a known,
 * non-blocking limitation). Token-based; flat subscriptions make $ notional, so
 * it's excluded from the UI. Stacked CSS bars, no chart dependency.
 */
function DailyTrend({
  trend,
  rangeDays,
}: {
  trend: CostByDayEntry[];
  rangeDays: number;
}) {
  const { t } = useTranslation();
  const span = Math.max(1, Math.round(rangeDays) || 30);
  // 즉시 뜨는 커스텀 툴팁용 hover 상태. native title(약 1초 지연·작아서
  // 못 알아챔)을 대체한다.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const { days, families } = useMemo(() => {
    const map: Record<string, Record<string, DayCell>> = {};
    const famSet = new Set<string>();
    for (const row of trend) {
      if (!row.date) continue;
      const fam = familyFromModelId(row.model);
      famSet.add(fam);
      const tokens =
        row.totalTokens ||
        (row.inputTokens || 0) +
          (row.outputTokens || 0) +
          (row.cacheReadTokens || 0) +
          (row.cacheWriteTokens || 0);
      map[row.date] ||= {};
      const cell = (map[row.date][fam] ||= { tokens: 0, cost: 0 });
      cell.tokens += tokens;
      cell.cost += row.cost || 0;
    }
    // Fixed axis: `span` days back from today, so sparse activity reads as thin
    // bars on a stable timeline and zero-usage days show as gaps.
    const today = new Date();
    const dayList: [string, Record<string, DayCell>][] = [];
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      dayList.push([key, map[key] || {}]);
    }
    return { days: dayList, families: Array.from(famSet) };
  }, [trend, span]);

  const valOf = (cell: DayCell) => cell.tokens;
  const fmt = (n: number) => `${formatTokens(n)} tok`;
  const sumDay = (fams: Record<string, DayCell>) =>
    Object.values(fams).reduce((s, c) => s + valOf(c), 0);

  if (families.length === 0) {
    return (
      <Section title={t("usage.trend.titleEmpty")}>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.trend.empty")}
        </div>
      </Section>
    );
  }

  const maxDay = Math.max(...days.map(([, fams]) => sumDay(fams)), 0.000001);

  return (
    <Section title={t("usage.trend.title", { span })}>
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        {/* legend */}
        <div className="mb-3 flex flex-wrap gap-3">
          {families.map((f) => {
            const meta = MODEL_FAMILY_META[f] || MODEL_FAMILY_META.other;
            return (
              <span
                key={f}
                className="flex items-center gap-1 text-[11px] text-gray-400"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: meta.color }}
                />
                {familyLabel(f, t)}
              </span>
            );
          })}
        </div>
        {/* relative 기준 컨테이너 — 커스텀 툴팁이 이 안에서 absolute 로 뜬다 */}
        <div className="relative">
          <div className="flex h-40 items-end gap-1">
            {days.map(([date, fams], i) => {
              const total = sumDay(fams);
              return (
                <div
                  key={date}
                  className="flex flex-1 cursor-default flex-col justify-end"
                  style={{ height: "100%" }}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() =>
                    setHoveredIndex((cur) => (cur === i ? null : cur))
                  }
                >
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                    style={{
                      height:
                        total > 0
                          ? `${Math.max(2, (total / maxDay) * 100)}%`
                          : "0%",
                    }}
                  >
                    {families
                      .filter((f) => fams[f] && valOf(fams[f]) > 0)
                      .map((f) => {
                        const meta =
                          MODEL_FAMILY_META[f] || MODEL_FAMILY_META.other;
                        return (
                          <div
                            key={f}
                            className="w-full"
                            style={{
                              height: `${(valOf(fams[f]) / total) * 100}%`,
                              background: meta.color,
                            }}
                          />
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 즉시 뜨는 커스텀 툴팁. 호버한 바 위에 뜨고, 좌우 끝에서는
              화면 밖으로 잘리지 않도록 정렬을 좌/우 끝으로 보정한다. */}
          {(() => {
            if (hoveredIndex == null || !days[hoveredIndex]) return null;
            const [date, fams] = days[hoveredIndex];
            const total = sumDay(fams);
            const ratio = (hoveredIndex + 0.5) / days.length;
            // ratio 0(왼끝)→좌측 정렬, 1(오른끝)→우측 정렬, 중앙→센터.
            const transform =
              ratio < 0.15
                ? "translateX(0)"
                : ratio > 0.85
                  ? "translateX(-100%)"
                  : "translateX(-50%)";
            const rows = families.filter((f) => fams[f] && valOf(fams[f]) > 0);
            return (
              <div
                className="pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[220px] rounded-md border border-gray-700 bg-gray-900 px-3 py-2 shadow-lg"
                style={{ left: `${ratio * 100}%`, transform }}
              >
                <div className="text-[11px] font-medium text-gray-200">
                  {date}
                </div>
                {total > 0 ? (
                  <>
                    <div className="mt-0.5 font-mono text-xs text-gray-100">
                      {fmt(total)}
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {rows.map((f) => {
                        const meta =
                          MODEL_FAMILY_META[f] || MODEL_FAMILY_META.other;
                        return (
                          <div
                            key={f}
                            className="flex items-center gap-1.5 text-[11px]"
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ background: meta.color }}
                            />
                            <span className="text-gray-300">
                              {familyLabel(f, t)}
                            </span>
                            <span className="ml-auto pl-2 font-mono text-gray-400">
                              {fmt(valOf(fams[f]))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {t("usage.trend.noUsage")}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-gray-500">
          <span>{days[0][0]}</span>
          <span>{days[days.length - 1][0]}</span>
        </div>
      </div>
    </Section>
  );
}

// ── Rate-limit status ────────────────────────────────────────

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>
) => string;

// CLI brand labels + icons stay literal; the Korean guidance note moves to
// usage.rateLimit.note.<family>, resolved via rateLimitNote() at render.
const RATE_LIMIT_GUIDANCE: Record<string, { label: string; icon: string }> = {
  claude: { label: "Claude Code", icon: "🟣" },
  gpt: { label: "Codex CLI", icon: "🟢" },
  gemini: { label: "Gemini CLI", icon: "🔵" },
  antigravity: { label: "Antigravity (agy)", icon: "🟠" },
};

const RATE_LIMIT_NOTE_KEYS: Record<string, MessageKey> = {
  claude: "usage.rateLimit.note.claude",
  gpt: "usage.rateLimit.note.gpt",
  gemini: "usage.rateLimit.note.gemini",
  antigravity: "usage.rateLimit.note.antigravity",
};

function rateLimitNote(model: string, t: Translate): string {
  return t(RATE_LIMIT_NOTE_KEYS[model] ?? "usage.rateLimit.note.none");
}

/** epoch seconds → 짧은 상대 리셋 표기 ("3일 후" / "5시간 후" / "곧"). */
function fmtReset(epochSeconds: number, t: Translate): string {
  const ms = epochSeconds * 1000 - Date.now();
  if (ms <= 0) return t("usage.reset.soon");
  const hours = ms / 3_600_000;
  if (hours >= 24) return t("usage.reset.days", { n: Math.round(hours / 24) });
  if (hours >= 1) return t("usage.reset.hours", { n: Math.round(hours) });
  return t("usage.reset.minutes", { n: Math.max(1, Math.round(ms / 60_000)) });
}

/** 단일 한도 윈도우(5h / 주간) 게이지. percent = 사용%, 표기는 "남음" 기준. */
function WindowGauge({
  label,
  percent,
  resetAt,
}: {
  label: string;
  percent: number;
  resetAt?: number;
}) {
  const { t } = useTranslation();
  const remaining = Math.max(0, 100 - percent);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] text-gray-400">
        <span>{label}</span>
        <span className="font-mono text-gray-300">
          {t("usage.rateLimit.remaining", { percent: remaining.toFixed(0) })}
          {typeof resetAt === "number"
            ? ` · ${t("usage.rateLimit.resetSuffix", {
                time: fmtReset(resetAt, t),
              })}`
            : ""}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className={`h-full ${
            percent >= 90
              ? "bg-red-500"
              : percent >= 70
                ? "bg-amber-500"
                : "bg-green-500"
          }`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Rate-limit status per connected provider. Claude Code and Codex should stay
 * visible once their CLI harnesses are installed, even before the current
 * project has spawned an agent for that provider.
 */
function RateLimitPanel({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation();
  const [connectedModels, setConnectedModels] = useState<Agent["model"][]>([]);

  useEffect(() => {
    let alive = true;
    window.electronAPI.harness
      .list()
      .then((packages) => {
        if (!alive) return;
        setConnectedModels(
          packages
            .filter((p) => p.status === "installed")
            .map((p) => CONNECTED_RATE_LIMIT_PACKAGES[p.id])
            .filter((model): model is Agent["model"] => Boolean(model))
        );
      })
      .catch(() => {
        if (alive) setConnectedModels([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const providerModels = useMemo(
    () => getRateLimitProviderModels(agents, connectedModels),
    [agents, connectedModels]
  );

  if (providerModels.length === 0) return null;

  return (
    <Section title={t("usage.rateLimit.title")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {providerModels.map((model) => {
          const g = RATE_LIMIT_GUIDANCE[model] || {
            label: model,
            icon: "⚪",
          };
          // 5h(primary) + 주간(7일/secondary) 윈도우를 agent doc 에서 읽는다.
          // codex 가 둘 다 emit, claude 주간은 Phase 1b 캡처로 같은 필드 채움.
          // 빈 model 은 위 modelsInUse 에서 이미 걸러졌으므로 정확 일치만 본다.
          const forModel = agents.filter((a) => a.model === model);
          // 죽은/스테일 agent doc 에 잔존한 percent 를 현재값으로 오인하지
          // 않도록, 한 대표 에이전트의 값만 읽는다. 선택 우선순위:
          //  (1) 한도 percent 를 실제로 보유한 doc 만 후보
          //  (2) working(실행 중) 상태 우선
          //  (3) 가장 최근 갱신(costUpdatedAt → createdAt) 우선
          const ts = (a: Agent) =>
            new Date(a.costUpdatedAt ?? a.createdAt ?? 0).getTime();
          const rep = forModel
            .filter(
              (a) =>
                typeof a.rateLimitPercent === "number" ||
                typeof a.rateLimitWeeklyPercent === "number",
            )
            .sort((x, y) => {
              const xLive = x.status === "working" ? 1 : 0;
              const yLive = y.status === "working" ? 1 : 0;
              if (xLive !== yLive) return yLive - xLive;
              return ts(y) - ts(x);
            })[0];
          const live =
            typeof rep?.rateLimitPercent === "number"
              ? rep.rateLimitPercent
              : undefined;
          const liveReset = rep?.rateLimitResetAt;
          const weekly =
            typeof rep?.rateLimitWeeklyPercent === "number"
              ? rep.rateLimitWeeklyPercent
              : undefined;
          const weeklyReset = rep?.rateLimitWeeklyResetAt;
          const headline = typeof weekly === "number" ? weekly : live;
          const hasData =
            typeof live === "number" || typeof weekly === "number";
          return (
            <div
              key={model}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
            >
              <div className="flex items-center gap-2">
                <span>{g.icon}</span>
                <span className="text-sm font-medium text-gray-200">
                  {g.label}
                </span>
                {typeof headline === "number" && (
                  <span className="ml-auto font-mono text-xs text-gray-300">
                    {typeof weekly === "number"
                      ? `${t("usage.rateLimit.weeklyLabel")} `
                      : ""}
                    {t("usage.rateLimit.remaining", {
                      percent: Math.max(0, 100 - headline).toFixed(0),
                    })}
                  </span>
                )}
                {typeof headline !== "number" && (
                  <span className="ml-auto text-xs text-gray-500">
                    {t("usage.rateLimit.noUsage")}
                  </span>
                )}
              </div>
              {typeof live === "number" && (
                <WindowGauge
                  label={t("usage.rateLimit.window.5h")}
                  percent={live}
                  resetAt={liveReset}
                />
              )}
              {typeof weekly === "number" && (
                <WindowGauge
                  label={t("usage.rateLimit.window.weekly")}
                  percent={weekly}
                  resetAt={weeklyReset}
                />
              )}
              {!hasData && (
                // 유효한 percent 가 없으면 스테일 빨강 게이지 대신 우아하게 표기.
                <p className="mt-2 text-xs text-gray-500">
                  {t("usage.rateLimit.noUsage")}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-gray-500">
                {rateLimitNote(model, t)}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600">
        ⓘ {t("usage.rateLimit.footer")}
      </p>
    </Section>
  );
}

export default UsagePage;
