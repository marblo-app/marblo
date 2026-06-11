import { useEffect, useMemo, useState } from "react";
import type { Agent } from "../../types/agent";
import { useProjectStore } from "../../stores/projectStore";
import { useAgentStore } from "../../stores/agentStore";
import { useCostStore } from "../../stores/costStore";
import type { CostWeekly } from "../../stores/costStore";
import type { CostByDayEntry } from "../../services/costService";
import { UsageDashboard } from "../agents/AgentDashboard";

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
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const { summary, loadCosts, trend, weekly, loadSummary } = useCostStore();
  const projectId = currentProject?.id || "";

  useEffect(() => {
    if (!projectId) return;
    return subscribeToAgents(projectId);
  }, [projectId, subscribeToAgents]);

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
        프로젝트를 선택하면 사용량이 표시됩니다.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Usage</h1>
        <p className="text-xs text-gray-500">
          모델·에이전트·일자별 토큰 사용량. 라이브(에이전트 문서) +
          히스토리(BigQuery) 합산.
        </p>
      </div>

      {/* Recent 7-day token total (getCostSummary weekly rollup) */}
      <WeeklyTokenCard weekly={weekly} />

      {/* Totals */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="총 토큰" value={formatTokens(totals.tokens)} />
        <SummaryCard
          label="Input / Output"
          value={`${formatTokens(totals.input)} / ${formatTokens(
            totals.output
          )}`}
        />
        <SummaryCard
          label="Cache (R/W)"
          value={`${formatTokens(totals.cacheRead)} / ${formatTokens(
            totals.cacheWrite
          )}`}
        />
      </div>

      {/* Daily trend (per-model) — server-aggregated, accumulates across days */}
      <DailyTrend trend={trend} rangeDays={weekly?.rangeDays ?? 30} />

      {/* Per-model & per-agent (reused) */}
      <Section title="모델별 / 에이전트별">
        <UsageDashboard agents={agents} />
      </Section>

      {/* Rate-limit status */}
      <RateLimitPanel agents={agents} />
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

const MODEL_FAMILY_META: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#a78bfa" }, // purple
  gpt: { label: "Codex", color: "#34d399" }, // green
  gemini: { label: "Gemini", color: "#60a5fa" }, // blue
  antigravity: { label: "Antigravity", color: "#fb923c" }, // orange
  other: { label: "기타", color: "#9ca3af" },
};

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
  const total = weekly?.totalTokens ?? 0;
  const byModel = useMemo(
    () =>
      [...(weekly?.byModel ?? [])].sort(
        (a, b) => b.totalTokens - a.totalTokens
      ),
    [weekly]
  );

  return (
    <Section title="최근 7일 총 토큰량">
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold text-gray-100">
            {formatTokens(total)}
          </span>
          <span className="text-xs text-gray-500">tokens · 최근 7일 누적</span>
        </div>

        {byModel.length > 0 ? (
          <div className="mt-3 space-y-2">
            {byModel.map((m, i) => {
              const meta =
                MODEL_FAMILY_META[familyFromModelId(m.model)] ||
                MODEL_FAMILY_META.other;
              const pct = total > 0 ? (m.totalTokens / total) * 100 : 0;
              return (
                <div key={m.model || i}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-gray-300">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: meta.color }}
                      />
                      <span className="font-medium">{meta.label}</span>
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
            아직 최근 7일 토큰 데이터가 없습니다. getCostSummary(BigQuery) 집계
            — 새 빌드로 에이전트를 실행하면 채워집니다.
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
      <Section title="일자별 추이 (모델별)">
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          아직 일자별 데이터가 없습니다. 모델별 추이는 BigQuery 비용 로그에서
          집계됩니다 — 새 빌드로 에이전트를 실행하면 채워집니다.
        </div>
      </Section>
    );
  }

  const maxDay = Math.max(...days.map(([, fams]) => sumDay(fams)), 0.000001);

  return (
    <Section title={`일자별 추이 (모델별, 최근 ${span}일)`}>
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
                {meta.label}
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
                            <span className="text-gray-300">{meta.label}</span>
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
                    사용 없음
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

const RATE_LIMIT_GUIDANCE: Record<
  string,
  { label: string; icon: string; note: string }
> = {
  claude: {
    label: "Claude Code",
    icon: "🟣",
    note: "Max 구독: 5시간/주간 한도 (CLI 자체 관리) · Pro: 일일 제한",
  },
  gpt: {
    label: "Codex CLI",
    icon: "🟢",
    note: "rollout 의 rate_limits(5h/주간 window, used_percent) — 라이브 표시 후속",
  },
  gemini: {
    label: "Gemini CLI",
    icon: "🔵",
    note: "무료: 분당/일일 요청 한도 · 초과 시 프로세스 종료",
  },
  antigravity: {
    label: "Antigravity (agy)",
    icon: "🟠",
    note: "개인 Gemini 계정 쿼터 공유 — 쿼터가 가장 빡빡, 초과 잦음",
  },
};

/** epoch seconds → 짧은 상대 리셋 표기 ("3일 후" / "5시간 후" / "곧"). */
function fmtReset(epochSeconds: number): string {
  const ms = epochSeconds * 1000 - Date.now();
  if (ms <= 0) return "곧";
  const hours = ms / 3_600_000;
  if (hours >= 24) return `${Math.round(hours / 24)}일 후`;
  if (hours >= 1) return `${Math.round(hours)}시간 후`;
  return `${Math.max(1, Math.round(ms / 60_000))}분 후`;
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
  const remaining = Math.max(0, 100 - percent);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] text-gray-400">
        <span>{label}</span>
        <span className="font-mono text-gray-300">
          {remaining.toFixed(0)}% 남음
          {typeof resetAt === "number" ? ` · ${fmtReset(resetAt)} 리셋` : ""}
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
 * Rate-limit status per model in use. Surfaces the live 5h(primary) and
 * weekly(7-day/secondary) windows when an agent doc carries them. Codex emits
 * both in its rollout `rate_limits`; Claude weekly capture (statusline) is a
 * Phase 1b follow-up that reuses the same `rateLimitWeekly*` fields.
 */
function RateLimitPanel({ agents }: { agents: Agent[] }) {
  // model 이 비어있는(오케스트레이터/미상) 에이전트는 버킷팅에서 제외 —
  // 실제 모델 id 가 있는 에이전트만 한도 패널에 표기한다.
  const modelsInUse = useMemo(() => {
    const s = new Set<string>();
    for (const a of agents) if (a.model) s.add(a.model);
    return Array.from(s);
  }, [agents]);

  if (modelsInUse.length === 0) return null;

  return (
    <Section title="한도(Rate limit) 상태">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {modelsInUse.map((model) => {
          const g = RATE_LIMIT_GUIDANCE[model] || {
            label: model,
            icon: "⚪",
            note: "한도 정보 없음",
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
                typeof a.rateLimitWeeklyPercent === "number"
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
                    {typeof weekly === "number" ? "주간 " : ""}
                    {Math.max(0, 100 - headline).toFixed(0)}% 남음
                  </span>
                )}
              </div>
              {typeof live === "number" && (
                <WindowGauge label="5시간" percent={live} resetAt={liveReset} />
              )}
              {typeof weekly === "number" && (
                <WindowGauge
                  label="주간(7일)"
                  percent={weekly}
                  resetAt={weeklyReset}
                />
              )}
              {!hasData && (
                // 유효한 percent 가 없으면 스테일 빨강 게이지 대신 우아하게 표기.
                <p className="mt-2 text-xs text-gray-500">한도 정보 없음</p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-gray-500">
                {g.note}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600">
        ⓘ Codex 는 5시간·주간(7일) 한도를 rollout 에서 실시간 표기합니다. Claude
        주간 한도 표기는 후속(Phase 1b, statusline 캡처)에서 연결됩니다.
      </p>
    </Section>
  );
}

export default UsagePage;
