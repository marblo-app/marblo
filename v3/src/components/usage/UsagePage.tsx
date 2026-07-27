import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { Agent } from "../../types/agent";
import { useProjectStore } from "../../stores/projectStore";
import { useAgentStore } from "../../stores/agentStore";
import { useAuth } from "../../hooks/useAuth";
import { useCostStore } from "../../stores/costStore";
import type { CostByDayEntry } from "../../services/costService";
import { useQuickLaneModelStore } from "../../stores/quickLaneModelStore";
import { UsageDashboard } from "../agents/AgentDashboard";
import {
  CONNECTED_RATE_LIMIT_PACKAGES,
  getRateLimitProviderModels,
} from "./rateLimitProviders";
import { resolveRateLimitWindows } from "./rateLimitWindows";
import {
  aggregateUsageByVendor,
  buildVendorModelIndex,
  mapAgentsToModels,
  periodById,
  resolveModel,
  vendorColor,
  USAGE_PERIODS,
} from "../../lib/usageBreakdown";
import type {
  AgentModelRow,
  ModelIdSource,
  UsagePeriodId,
  UsageTotals,
  VendorModelIndex,
  VendorUsageRow,
} from "../../lib/usageBreakdown";
import { VendorCreditsPanel } from "./VendorCreditsPanel";

/**
 * Top-level Usage tab. Surfaces what used to be buried two levels deep
 * (Agents → Activity/Audit/Usage). Pulls the same data sources:
 *   - live per-agent rolling totals from the Firestore agent docs
 *     (written by useCostWriter on every cost:update)
 *   - BigQuery historical summary (byDay) via costStore → getCostSummary
 *
 * ── 하위모델 분해(이 화면의 축) ──────────────────────────────────────────
 * 종전엔 모델 id 를 **하네스 계열**로만 접어 보여줬다(`claude-opus-5`·`glm-4.7`·
 * `MiniMax-M3` → 전부 "Claude"). env-swap 벤더가 우리 `claude` 바이너리를 그대로
 * 쓰기 때문에 그 접기는 틀린 축이었고, 어느 벤더 쿼터를 태웠는지 화면에서 알 수
 * 없었다. 지금은 **벤더 → 구체 모델 id** 2단으로 분해한다. 매핑의 단일소스는
 * `electron/model-registry` 이고, 렌더러는 기존 `models:quickLaneCatalog` IPC 로
 * 그 파생을 받는다(모델 id 리터럴 0, 새 IPC 0). 로직은 `lib/usageBreakdown.ts`.
 *
 * ★수치는 전부 실데이터다 — `cost_logs`(BigQuery) 집계와 Firestore 에이전트 doc
 * 뿐이고, 조회할 수 없는 칸은 지어내지 않고 "조회불가" 로 비운다.
 *
 * Sections: 기간 선택기 → 총계 → 벤더·하위모델 분해 → 일자별 추이 →
 * 에이전트↔실모델 → 벤더 크레딧/쿼터 → 모델·에이전트(기존) → 한도 상태.
 *
 * ★하위 섹션 컴포넌트(`PeriodSelector`/`VendorBreakdown`/`DailyTrend`/
 * `AgentModelMap`)를 export 해 두는 이유: 이 페이지 전체는 Firestore·IPC·인증에
 * 묶여 있어 Electron 을 띄우지 않으면 렌더 자체가 안 된다. 섹션 단위로 꺼낼 수
 * 있으면 vite 프리뷰나 컴포넌트 테스트로 **레이아웃만** 검증할 수 있다.
 */
export function UsagePage() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);
  const ownedAgents = useAgentStore((s) => s.ownedAgents);
  const agentsLoading = useAgentStore((s) => s.loading);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const subscribeToOwnedAgents = useAgentStore((s) => s.subscribeToOwnedAgents);
  const { user } = useAuth();
  const {
    summary,
    loadCosts,
    trend,
    loadSummary,
    loading: costsLoading,
    summaryLoading,
  } = useCostStore();
  const projectId = currentProject?.id || "";
  const ownerId = user?.uid || "";

  // 상단 기간 선택기. 기본 30일(종전 loadSummary 기본값과 같아 첫 화면이 동일).
  const [periodId, setPeriodId] = useState<UsagePeriodId>("30d");
  const period = periodById(periodId);

  // 벤더↔모델 카탈로그(레지스트리 파생). 프로세스 수명 동안 불변이라 한 번만.
  const catalogGroups = useQuickLaneModelStore((s) => s.groups);
  const loadCatalog = useQuickLaneModelStore((s) => s.load);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

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
  // server-aggregated per-day+model rollup (getCostSummary), re-fetched when
  // the period changes — the range is a server-side WHERE, not a client filter,
  // so "전체" really queries the whole table instead of padding a 30일 응답.
  useEffect(() => {
    if (!projectId) return;
    loadCosts(projectId);
    loadSummary(projectId, period.days);
  }, [projectId, period.days, loadCosts, loadSummary]);

  const modelIndex = useMemo(
    () => buildVendorModelIndex(catalogGroups),
    [catalogGroups],
  );

  // 선택 기간의 벤더 → 하위모델 분해. `trend`(byDay) 가 그 기간의 실제 BQ 행이다.
  const { vendors, totals: rangeTotals } = useMemo(
    () => aggregateUsageByVendor(trend, modelIndex),
    [trend, modelIndex],
  );

  // 라이브(에이전트 doc) 누적 — BQ 행이 하나도 없을 때만 쓰는 폴백. 이쪽은
  // **기간 개념이 없는 전체 누적**이라, 폴백일 때만 그렇다고 라벨을 바꾼다.
  const liveTotals = useMemo(() => {
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
    if (!hasLive && summary) {
      cost = summary.totalCost;
      input = summary.totalInputTokens;
      output = summary.totalOutputTokens;
      cacheRead = summary.totalCacheReadTokens;
      cacheWrite = summary.totalCacheWriteTokens;
      hasLive = true;
    }
    return {
      hasLive,
      totals: {
        tokens: input + output + cacheRead + cacheWrite,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        cost,
      } satisfies UsageTotals,
    };
  }, [agents, summary]);

  const rangeHasData = trend.length > 0;
  const totals = rangeHasData ? rangeTotals : liveTotals.totals;

  const agentModelRows = useMemo(
    () => mapAgentsToModels(agents, modelIndex),
    [agents, modelIndex],
  );

  if (!projectId) {
    return (
      <div className="p-6 text-sm text-gray-500">
        {t("usage.selectProjectPrompt")}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">
            {t("usage.title")}
          </h1>
          <p className="text-xs text-gray-500">{t("usage.subtitle")}</p>
        </div>
        <PeriodSelector value={periodId} onChange={setPeriodId} />
      </div>

      {/* Totals — 선택 기간(BQ) 기준. BQ 행이 없으면 라이브 누적으로 폴백하고
          그 사실을 라벨로 드러낸다(두 수치는 답하는 질문이 다르다). */}
      <div className="space-y-2">
        <p className="text-[11px] text-gray-500">
          {rangeHasData
            ? t("usage.totals.rangeNote", { period: periodLabel(periodId, t) })
            : t("usage.totals.liveNote")}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <SummaryCard
            label={t("usage.card.totalTokens")}
            value={formatTokens(totals.tokens)}
          />
          <SummaryCard
            label={t("usage.card.inputOutput")}
            value={`${formatTokens(totals.inputTokens)} / ${formatTokens(
              totals.outputTokens,
            )}`}
          />
          <SummaryCard
            label={t("usage.card.cache")}
            value={`${formatTokens(totals.cacheReadTokens)} / ${formatTokens(
              totals.cacheWriteTokens,
            )}`}
          />
          <SummaryCard
            label={t("usage.card.cost")}
            value={formatCost(totals.cost)}
          />
        </div>
      </div>

      {/* ★하위모델 분해 — 이 화면의 핵심. 벤더 → 구체 모델 id. */}
      <VendorBreakdown
        vendors={vendors}
        totals={rangeTotals}
        loading={summaryLoading && trend.length === 0}
      />

      {/* Daily trend — 벤더별로 쌓는다(종전엔 하네스 계열이라 GLM/MiniMax 가
          Anthropic 과 한 색으로 뭉쳤다). */}
      <DailyTrend
        trend={trend}
        rangeDays={period.days}
        periodId={periodId}
        index={modelIndex}
      />

      {/* 에이전트명 ↔ 실제 실행 모델 */}
      <AgentModelMap rows={agentModelRows} loading={agentsLoading} />

      {/* 벤더 크레딧/쿼터 — 조회 가능한 것만, 나머지는 "조회불가" */}
      <VendorCreditsPanel groups={catalogGroups} />

      {/* Per-model & per-agent (reused) */}
      <Section title={t("usage.section.byModelAgent")}>
        <UsageDashboard
          agents={agents}
          loading={agentsLoading || costsLoading || summaryLoading}
        />
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

/** 비용 표기. 0 은 "$0" 로, 아주 작은 값은 소수 넷째자리까지 살린다. */
function formatCost(n: number): string {
  if (!n) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
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

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

const PERIOD_LABEL_KEYS: Record<UsagePeriodId, MessageKey> = {
  "7d": "usage.period.7d",
  "30d": "usage.period.30d",
  all: "usage.period.all",
};

function periodLabel(id: UsagePeriodId, t: Translate): string {
  return t(PERIOD_LABEL_KEYS[id]);
}

// ── 기간 선택기 ──────────────────────────────────────────────

/**
 * 7 / 30 / 전체. 세그먼트 컨트롤 한 줄 — 필터는 차트 위 한 행에 둔다.
 * 값은 `loadSummary(projectId, days)` 로 그대로 나가는 **서버 WHERE** 다.
 */
export function PeriodSelector({
  value,
  onChange,
}: {
  value: UsagePeriodId;
  onChange: (id: UsagePeriodId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500">
        {t("usage.period.label")}
      </span>
      <div
        role="group"
        aria-label={t("usage.period.label")}
        className="flex overflow-hidden rounded-md border border-gray-700"
      >
        {USAGE_PERIODS.map((p) => {
          const active = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(p.id)}
              className={`px-3 py-1 text-xs transition-colors ${
                active
                  ? "bg-gray-700 font-medium text-gray-100"
                  : "bg-gray-800/50 text-gray-400 hover:text-gray-200"
              }`}
            >
              {periodLabel(p.id, t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 벤더 → 하위모델 분해 ─────────────────────────────────────

/** 벤더 표시명. 카탈로그 라벨이 있으면 그것, 없으면(추정 분류) "미상". */
function vendorDisplayLabel(row: VendorUsageRow, t: Translate): string {
  if (row.registered) return row.label;
  if (row.vendor === "unknown") return t("usage.breakdown.vendorUnknown");
  return row.vendor;
}

/**
 * 벤더 → 구체 모델 분해. 기본은 전부 펼친 상태 — 이 화면의 존재 이유가
 * 하위모델이라, 한 번 더 클릭해야 보이면 목적을 잃는다.
 */
export function VendorBreakdown({
  vendors,
  totals,
  loading,
}: {
  vendors: VendorUsageRow[];
  totals: UsageTotals;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (loading) {
    return (
      <Section title={t("usage.breakdown.title")}>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.breakdown.loading")}
        </div>
      </Section>
    );
  }

  if (vendors.length === 0) {
    return (
      <Section title={t("usage.breakdown.title")}>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.breakdown.empty")}
        </div>
      </Section>
    );
  }

  return (
    <Section title={t("usage.breakdown.title")}>
      <div className="space-y-2">
        {vendors.map((v) => {
          const open = !collapsed[v.vendor];
          const share =
            totals.tokens > 0 ? (v.tokens / totals.tokens) * 100 : 0;
          return (
            <div
              key={v.vendor}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [v.vendor]: !c[v.vendor] }))
                }
                className="flex w-full items-center gap-2 text-left"
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: v.color }}
                />
                <span className="text-sm font-medium text-gray-200">
                  {vendorDisplayLabel(v, t)}
                </span>
                <span className="text-[11px] text-gray-600">
                  {t("usage.breakdown.modelCount", { n: v.models.length })}
                </span>
                <span className="ml-auto flex items-baseline gap-2">
                  <span className="font-mono text-sm text-gray-100">
                    {formatTokens(v.tokens)}
                  </span>
                  <span className="font-mono text-[11px] text-gray-500">
                    {formatCost(v.cost)}
                  </span>
                  <span className="w-10 text-right text-[11px] text-gray-500">
                    {share.toFixed(0)}%
                  </span>
                  <span className="text-[10px] text-gray-600">
                    {open ? "▾" : "▸"}
                  </span>
                </span>
              </button>

              {/* 벤더 점유율 바 — 4px 둥근 끝, 베이스라인에 고정 */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${share}%`, background: v.color }}
                />
              </div>

              {open && (
                <div className="mt-3 space-y-2 border-t border-gray-700/60 pt-3">
                  {v.models.map((m) => {
                    const inner =
                      v.tokens > 0 ? (m.tokens / v.tokens) * 100 : 0;
                    return (
                      <div key={m.modelId || "unknown"}>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="truncate font-mono text-gray-300">
                            {m.modelId || t("usage.breakdown.modelUnknown")}
                          </span>
                          {m.label && m.label !== m.modelId && (
                            <span className="truncate text-gray-500">
                              {m.label}
                            </span>
                          )}
                          {!m.registered && m.modelId && (
                            <span
                              title={t("usage.breakdown.unregisteredTip")}
                              className="shrink-0 rounded border border-amber-700/60 px-1 text-[10px] text-amber-500/90"
                            >
                              {t("usage.breakdown.unregistered")}
                            </span>
                          )}
                          {m.estimatedPricing && (
                            <span
                              title={t("usage.breakdown.estimatedTip")}
                              className="shrink-0 rounded border border-gray-600 px-1 text-[10px] text-gray-500"
                            >
                              {t("usage.breakdown.estimated")}
                            </span>
                          )}
                          <span className="ml-auto flex shrink-0 items-baseline gap-2">
                            <span className="font-mono text-gray-300">
                              {formatTokens(m.tokens)}
                            </span>
                            <span className="font-mono text-gray-600">
                              {formatCost(m.cost)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-700/70">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${inner}%`,
                              background: v.color,
                              opacity: 0.75,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600">
        ⓘ {t("usage.breakdown.footer")}
      </p>
    </Section>
  );
}

// ── 에이전트 ↔ 실제 실행 모델 ────────────────────────────────

const SOURCE_LABEL_KEYS: Record<ModelIdSource, MessageKey> = {
  detected: "usage.agentModel.source.detected",
  spawned: "usage.agentModel.source.spawned",
  none: "usage.agentModel.source.none",
};

/**
 * "이 에이전트는 실제로 어떤 모델로 돌았나". 근거는 두 가지뿐이고 둘 다 관측값이다
 * — `detectedModelId`(과금 세션 메타데이터) > `spawnedModel`(main 의 argv 되읽기).
 * 둘 다 없으면 모델 칸을 **비운다**(하네스로 추정하지 않는다).
 */
export function AgentModelMap({
  rows,
  loading,
}: {
  rows: AgentModelRow[];
  loading: boolean;
}) {
  const { t } = useTranslation();

  if (loading && rows.length === 0) {
    return (
      <Section title={t("usage.agentModel.title")}>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.breakdown.loading")}
        </div>
      </Section>
    );
  }

  if (rows.length === 0) {
    return (
      <Section title={t("usage.agentModel.title")}>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.agentModel.empty")}
        </div>
      </Section>
    );
  }

  return (
    <Section title={t("usage.agentModel.title")}>
      <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800/50">
        <table className="w-full min-w-[520px] text-left text-[11px]">
          <thead className="text-gray-500">
            <tr className="border-b border-gray-700">
              <th className="px-3 py-2 font-normal">
                {t("usage.agentModel.colAgent")}
              </th>
              <th className="px-3 py-2 font-normal">
                {t("usage.agentModel.colHarness")}
              </th>
              <th className="px-3 py-2 font-normal">
                {t("usage.agentModel.colModel")}
              </th>
              <th className="px-3 py-2 font-normal">
                {t("usage.agentModel.colSource")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agentId} className="border-b border-gray-700/40">
                <td className="px-3 py-2 text-gray-200">{r.name}</td>
                <td className="px-3 py-2 font-mono text-gray-500">
                  {r.harness || "—"}
                </td>
                <td className="px-3 py-2">
                  {r.modelId ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-sm"
                        style={{ background: r.color }}
                      />
                      <span className="font-mono text-gray-200">
                        {r.modelId}
                      </span>
                      {r.registered && (
                        <span className="text-gray-600">{r.vendorLabel}</span>
                      )}
                      {!r.registered && (
                        <span
                          title={t("usage.breakdown.unregisteredTip")}
                          className="rounded border border-amber-700/60 px-1 text-[10px] text-amber-500/90"
                        >
                          {t("usage.breakdown.unregistered")}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-600">
                      {t("usage.agentModel.noModel")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {t(SOURCE_LABEL_KEYS[r.source])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-600">
        ⓘ {t("usage.agentModel.footer")}
      </p>
    </Section>
  );
}

// ── 일자별 추이 ──────────────────────────────────────────────

type DayCell = { tokens: number; cost: number };

/**
 * 일자별 토큰 추이. `getCostSummary.byDay`(서버 집계, 일자×모델) 기반이라
 * 원시로그 LIMIT 200 시절처럼 하루로 뭉치지 않는다.
 *
 * ★쌓는 축이 **벤더**로 바뀌었다. 종전엔 모델 id 프리픽스로 하네스 계열을 잡아서
 * `glm-*`/`MiniMax-*` 가 어느 계열에도 안 걸리고 "기타" 로 빠지거나, 하네스가
 * claude 라는 이유로 Anthropic 과 한 색이 됐다. 지금은 레지스트리 파생 인덱스로
 * 벤더를 해석한다.
 *
 * 토큰 기준이다 — 정액 구독에서 $ 는 명목값이라 추이에서 뺀다.
 */
export function DailyTrend({
  trend,
  rangeDays,
  periodId,
  index,
}: {
  trend: CostByDayEntry[];
  rangeDays: number;
  periodId: UsagePeriodId;
  index: VendorModelIndex;
}) {
  const { t } = useTranslation();
  // 즉시 뜨는 커스텀 툴팁용 hover 상태. native title(약 1초 지연·작아서
  // 못 알아챔)을 대체한다.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { days, vendors, labels } = useMemo(() => {
    const map: Record<string, Record<string, DayCell>> = {};
    const vendorSet = new Set<string>();
    const labelOf: Record<string, string> = {};
    let earliest = "";
    for (const row of trend) {
      if (!row.date) continue;
      const resolved = resolveModel(row.model, index);
      vendorSet.add(resolved.vendor);
      if (resolved.registered) labelOf[resolved.vendor] = resolved.vendorLabel;
      const tokens =
        row.totalTokens ||
        (row.inputTokens || 0) +
          (row.outputTokens || 0) +
          (row.cacheReadTokens || 0) +
          (row.cacheWriteTokens || 0);
      map[row.date] ||= {};
      const cell = (map[row.date][resolved.vendor] ||= { tokens: 0, cost: 0 });
      cell.tokens += tokens;
      cell.cost += row.cost || 0;
      if (!earliest || row.date < earliest) earliest = row.date;
    }

    // 축 길이: "전체" 는 10년 창을 그대로 그리면 막대가 보이지 않으므로 **실제
    // 데이터가 있는 첫 날**부터 오늘까지로 좁힌다(없으면 30일). 7/30 은 요청한
    // 창을 그대로 써서 사용 없는 날이 빈칸으로 보이게 둔다.
    const today = new Date();
    let span: number;
    if (periodId === "all") {
      const first = earliest ? new Date(`${earliest}T00:00:00Z`) : null;
      const diff = first
        ? Math.round((today.getTime() - first.getTime()) / 86_400_000) + 1
        : 30;
      span = Math.min(Math.max(diff, 7), 365);
    } else {
      span = Math.max(1, Math.round(rangeDays) || 30);
    }

    const dayList: [string, Record<string, DayCell>][] = [];
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      dayList.push([key, map[key] || {}]);
    }
    return {
      days: dayList,
      vendors: Array.from(vendorSet),
      labels: labelOf,
    };
  }, [trend, rangeDays, periodId, index]);

  const vendorLabel = (v: string) =>
    labels[v] ?? (v === "unknown" ? t("usage.breakdown.vendorUnknown") : v);
  const fmt = (n: number) => `${formatTokens(n)} tok`;
  const sumDay = (cells: Record<string, DayCell>) =>
    Object.values(cells).reduce((s, c) => s + c.tokens, 0);

  if (vendors.length === 0) {
    return (
      <Section title={t("usage.trend.titleEmpty")}>
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-xs text-gray-500">
          {t("usage.trend.empty")}
        </div>
      </Section>
    );
  }

  const maxDay = Math.max(...days.map(([, cells]) => sumDay(cells)), 0.000001);

  return (
    <Section title={t("usage.trend.title", { span: days.length })}>
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        {/* legend — 2개 이상이면 항상 있어야 정체성이 색만으로 전달되지 않는다 */}
        <div className="mb-3 flex flex-wrap gap-3">
          {vendors.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 text-[11px] text-gray-400"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: vendorColor(v) }}
              />
              {vendorLabel(v)}
            </span>
          ))}
        </div>
        {/* relative 기준 컨테이너 — 커스텀 툴팁이 이 안에서 absolute 로 뜬다 */}
        <div className="relative">
          <div className="flex h-40 items-end gap-1">
            {days.map(([date, cells], i) => {
              const total = sumDay(cells);
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
                    className="flex w-full flex-col-reverse gap-[2px] overflow-hidden rounded-t"
                    style={{
                      height:
                        total > 0
                          ? `${Math.max(2, (total / maxDay) * 100)}%`
                          : "0%",
                    }}
                  >
                    {vendors
                      .filter((v) => cells[v] && cells[v].tokens > 0)
                      .map((v) => (
                        <div
                          key={v}
                          className="w-full"
                          style={{
                            height: `${(cells[v].tokens / total) * 100}%`,
                            background: vendorColor(v),
                          }}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 즉시 뜨는 커스텀 툴팁. 호버한 바 위에 뜨고, 좌우 끝에서는
              화면 밖으로 잘리지 않도록 정렬을 좌/우 끝으로 보정한다. */}
          {(() => {
            if (hoveredIndex == null || !days[hoveredIndex]) return null;
            const [date, cells] = days[hoveredIndex];
            const total = sumDay(cells);
            const ratio = (hoveredIndex + 0.5) / days.length;
            // ratio 0(왼끝)→좌측 정렬, 1(오른끝)→우측 정렬, 중앙→센터.
            const transform =
              ratio < 0.15
                ? "translateX(0)"
                : ratio > 0.85
                  ? "translateX(-100%)"
                  : "translateX(-50%)";
            const rows = vendors.filter((v) => cells[v] && cells[v].tokens > 0);
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
                      {rows.map((v) => (
                        <div
                          key={v}
                          className="flex items-center gap-1.5 text-[11px]"
                        >
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: vendorColor(v) }}
                          />
                          <span className="text-gray-300">
                            {vendorLabel(v)}
                          </span>
                          <span className="ml-auto pl-2 font-mono text-gray-400">
                            {fmt(cells[v].tokens)}
                          </span>
                        </div>
                      ))}
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
  // Account-global rate limits, independent of any running agent. This is the
  // canonical source: claude is probed headlessly, codex/gpt is read from the
  // newest rollout. It lets the panel show real utilization with ZERO agents,
  // as long as the CLI is logged in. null per provider = no information.
  const [account, setAccount] = useState<{
    claude: RateLimitSnapshot | null;
    gpt: RateLimitSnapshot | null;
  } | null>(null);

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
            .filter((model): model is Agent["model"] => Boolean(model)),
        );
      })
      .catch(() => {
        if (alive) setConnectedModels([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Poll account-level limits on mount and every minute (the main process
  // TTL-caches, so this never spawns a probe more than once a minute).
  useEffect(() => {
    let alive = true;
    const load = () =>
      window.electronAPI.usage
        .accountRateLimits()
        .then((a) => {
          if (alive) setAccount(a);
        })
        .catch(() => {
          if (alive) setAccount(null);
        });
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const providerModels = useMemo(
    () => getRateLimitProviderModels(agents, connectedModels),
    [agents, connectedModels],
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
          // Account-global snapshot is the canonical source (works with zero
          // agents); the per-agent doc is only a fallback when the probe has
          // no data for that provider. claude/gpt have an account source;
          // gemini/antigravity fall through to the agent doc as before.
          const acct =
            model === "claude"
              ? account?.claude
              : model === "gpt"
                ? account?.gpt
                : null;
          // Account snapshot is canonical. When it is duration-aware, the set
          // of windows it carries is authoritative — a stale per-agent doc must
          // not resurrect a window (e.g. a bogus 5h gauge on a weekly-only
          // Codex `prolite` plan). resolveRateLimitWindows encodes that gate.
          const { live, liveReset, weekly, weeklyReset, weeklyOnly, hasData } =
            resolveRateLimitWindows(acct, rep);
          const headline = typeof weekly === "number" ? weekly : live;
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
              {weeklyOnly && (
                // 5h 창 자체가 없는 플랜(예: Codex prolite) — 빈 5h 게이지를
                // 그리는 대신 주간 전용임을 명시한다.
                <p className="mt-2 text-[11px] leading-snug text-gray-500">
                  {t("usage.rateLimit.weeklyOnly")}
                </p>
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
