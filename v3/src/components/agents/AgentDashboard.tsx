import { useEffect, useMemo, useState } from "react";
import type { Agent } from "../../types/agent";
import type { Task } from "../../types/task";
import type { MessageKey } from "../../locales/ko";
import AgentStatusCard from "./AgentStatusCard";
import AgentFleetGrid from "./AgentFleetGrid";
import TeamSummary from "./TeamSummary";
import ActivityFeed from "./ActivityFeed";
import AuditTimeline from "./AuditTimeline";
import { useCostStore } from "../../stores/costStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useTranslation } from "../../lib/i18n";
import { classifyBotAgentSource } from "../../lib/botAgentSource";

type ViewMode = "list" | "grid";
type AgentDashboardScope = "all" | "bot";
const VIEW_MODE_KEY = "agentsViewMode";

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    return v === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

interface AgentDashboardProps {
  agents: Agent[];
  tasks: Task[];
  projectId: string;
  loading: boolean;
  onAddAgent: () => void;
  onStop: (agentId: string) => void;
  onRestart: (agentId: string) => void;
  onDelete: (agentId: string) => void;
  scope?: AgentDashboardScope;
}

export default function AgentDashboard({
  agents,
  tasks,
  projectId,
  loading,
  onAddAgent,
  onStop,
  onRestart,
  onDelete,
  scope = "all",
}: AgentDashboardProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* quota / disabled — best-effort */
    }
  }, [viewMode]);

  // Orchestrator is rendered in its own bottom panel — hide it from the
  // Agents tab card grid / summary / cleanup. ActivityFeed still receives
  // the full list so its `agentId in agents` filter passes orchestrator
  // events.
  const visibleAgents = useMemo(
    () =>
      agents
        .filter((a) => a.role !== "orchestrator")
        .filter((agent) =>
          scope === "bot"
            ? classifyBotAgentSource(agent, tasks).status === "present"
            : true,
        ),
    [agents, scope, tasks],
  );
  const activityAgents = scope === "bot" ? visibleAgents : agents;

  // 사용자 spawn 셸 터미널 (isAgent !== true) — 그리드에 에이전트와 함께
  // 표시. useTerminalRestore 가 프로젝트 단위로 재spawn 해 재시작 후에도
  // 같은 탭 구성으로 복구.
  //
  // selector 안에서 .filter() 하면 매 render마다 새 array reference 가
  // 반환돼 useSyncExternalStore 가 "값 바뀜"으로 판단 → 무한 re-render
  // (Maximum update depth exceeded). sessions 전체를 받아 useMemo 로 안정화.
  const sessions = useTerminalStore((s) => s.sessions);
  const shellTerminals = useMemo(
    () => sessions.filter((sess) => !sess.isAgent),
    [sessions],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          <p className="mt-3 text-sm">{t("agents.dashboard.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-100">
          {t("agents.dashboard.title")}
        </h2>
        <div className="flex items-center gap-2">
          {/* View switcher — list (cards) vs grid (FleetView) */}
          <div className="flex items-center rounded border border-gray-700 bg-gray-800/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              title="List view"
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-gray-700 text-gray-100"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              ▤ List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              title="Grid view (FleetView)"
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "grid"
                  ? "bg-gray-700 text-gray-100"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              ▦ Grid
            </button>
          </div>
          {scope === "all" &&
            visibleAgents.filter((a) => a.status !== "working").length > 0 && (
              <button
                className="flex items-center gap-1.5 rounded border border-red-600/30 bg-red-600/10 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/20"
                onClick={() => {
                  const inactive = visibleAgents.filter(
                    (a) => a.status !== "working",
                  );
                  if (
                    confirm(
                      t("agents.dashboard.cleanupConfirm", {
                        count: inactive.length,
                      }),
                    )
                  ) {
                    inactive.forEach((a) => onDelete(a.id));
                  }
                }}
              >
                {t("agents.dashboard.cleanup")} (
                {visibleAgents.filter((a) => a.status !== "working").length})
              </button>
            )}
          {scope === "all" && (
            <button
              className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              onClick={onAddAgent}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M7 2v10M2 7h10" />
              </svg>
              {t("agents.dashboard.addAgent")}
            </button>
          )}
        </div>
      </div>

      {/* Team Summary */}
      <TeamSummary agents={visibleAgents} tasks={tasks} />

      {/* Agent rendering — view mode toggles between rich list cards and
          the FleetView grid. Empty state is shared. Orchestrator filtered
          out of both views (it has its own bottom panel). */}
      {visibleAgents.length === 0 ? (
        scope === "bot" ? (
          <BotAgentEmptyState />
        ) : (
          <AgentSetupGuide onAddAgent={onAddAgent} />
        )
      ) : viewMode === "grid" ? (
        <AgentFleetGrid
          agents={visibleAgents}
          terminals={scope === "bot" ? [] : shellTerminals}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visibleAgents.map((agent) => (
            <AgentStatusCard
              key={agent.id}
              agent={agent}
              tasks={tasks}
              onStop={onStop}
              onRestart={onRestart}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {/* Activity & Audit Tabs — ActivityFeed receives the full list so the
          orchestrator agent doc keeps its events visible.
          Usage/cost moved out to the top-level "Usage" tab. */}
      <ActivityAuditTabs projectId={projectId} agents={activityAgents} />
    </div>
  );
}

function BotAgentEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="rounded border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">
      {t("agents.marbloBots.runningEmpty")}
    </div>
  );
}

// ── Activity & Audit Tabs ────────────────────────────────────

type TabType = "activity" | "audit" | "guide";

function ActivityAuditTabs({
  projectId,
  agents,
}: {
  projectId: string;
  agents: Agent[];
}) {
  const [activeTab, setActiveTab] = useState<TabType>("activity");

  const tabs: { key: TabType; label: string }[] = [
    { key: "activity", label: "Activity" },
    { key: "audit", label: "Audit Trail" },
    { key: "guide", label: "Guide" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex gap-1 border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "activity" ? (
        <ActivityFeed projectId={projectId} agents={agents} />
      ) : activeTab === "audit" ? (
        <AuditTimeline />
      ) : (
        <AgentGuide />
      )}
    </div>
  );
}

// ── Usage Dashboard ──────────────────────────────────────────

const MODEL_LIMITS: Record<
  string,
  { label: string; icon: string; daily?: number; noteKey: MessageKey | "" }
> = {
  claude: {
    label: "Claude Code",
    icon: "🟣",
    noteKey: "agents.usage.note.claude",
  },
  gpt: {
    label: "Codex CLI",
    icon: "🟢",
    noteKey: "agents.usage.note.gpt",
  },
  gemini: {
    label: "Gemini CLI",
    icon: "🔵",
    daily: 1500,
    noteKey: "agents.usage.note.gemini",
  },
};

// Declared subscription plan per model family (the "seed"; Settings editing is
// a follow-up). Codex's actual plan is auto-detected from its session rollout
// (agent.detectedPlanType) and overrides this default when present.
const PLAN_DEFAULTS: Record<string, string> = {
  claude: "Max",
  gpt: "Plus",
  gemini: "Pro",
  antigravity: "Pro",
};
const RECENT_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function planLabelFor(model: string, agents: Agent[]): string {
  const detected = agents.map((a) => a.detectedPlanType).find(Boolean);
  if (detected) return detected.charAt(0).toUpperCase() + detected.slice(1);
  return PLAN_DEFAULTS[model] || "—";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function timeValue(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime() || 0;
  if (typeof value === "object" && "toDate" in value) {
    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      return maybeTimestamp.toDate().getTime();
    }
  }
  return 0;
}

function lastUsageTime(agent: Agent): number {
  return Math.max(timeValue(agent.costUpdatedAt), timeValue(agent.createdAt));
}

function isActiveOrRecentAgent(agent: Agent, now: number): boolean {
  if (agent.status !== "stopped") return true;
  const lastSeen = lastUsageTime(agent);
  return lastSeen > 0 && now - lastSeen <= RECENT_AGENT_WINDOW_MS;
}

type AgentCost = {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

type SubmodelBucket = {
  id: string;
  label: string;
  tokens: number;
  agentCount: number;
  agentNames: string;
};

/**
 * 하네스 그룹 안의 막대를 **실행한 하위모델 id** 로 접는다.
 *
 * 종전엔 이 막대가 에이전트명(오케·프론트·클로드)이었다. 그런데 이 섹션의 그룹은
 * 하네스(`claude`/`gpt`)이고, 같은 하네스가 opus·fable·GLM 을 전부 띄운다 —
 * 즉 "어느 모델이 토큰을 태웠나" 라는 이 화면의 질문에 에이전트명 축은 답을 못
 * 한다(에이전트 목록은 다른 탭에 이미 있다).
 *
 * 모델 근거는 호출자가 넘기는 `submodelFor`(관측값: detectedModelId >
 * spawnedModel). 근거가 없으면 agent.model → 하네스 폴백으로 떨어진다 — 지어내지
 * 않고 아는 만큼만 좁힌다. 같은 id 는 합산하고 토큰 내림차순으로 준다(큰 소비가
 * 위로).
 */
function submodelBreakdown(
  agents: Agent[],
  harnessFallback: string,
  costFor: (a: Agent) => AgentCost | null,
  submodelFor?: (a: Agent) => { id: string; label: string } | null,
): SubmodelBucket[] {
  const buckets = new Map<string, SubmodelBucket & { names: string[] }>();
  for (const agent of agents) {
    const resolved = submodelFor?.(agent) ?? null;
    const id = resolved?.id ?? agent.model ?? harnessFallback;
    const label = resolved?.label ?? id;
    const d = costFor(agent);
    const tokens = d
      ? d.inputTokens +
        d.outputTokens +
        (d.cacheReadTokens || 0) +
        (d.cacheWriteTokens || 0)
      : 0;
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.tokens += tokens;
      bucket.agentCount += 1;
      bucket.names.push(agent.name);
    } else {
      buckets.set(id, {
        id,
        label,
        tokens,
        agentCount: 1,
        agentNames: "",
        names: [agent.name],
      });
    }
  }
  return Array.from(buckets.values())
    .map(({ names, ...b }) => ({ ...b, agentNames: names.join(", ") }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function UsageDashboard({
  agents,
  loading = false,
  submodelFor,
}: {
  agents: Agent[];
  loading?: boolean;
  /**
   * 에이전트 → 관측된 하위모델. 넘기지 않으면 `agent.model`(=하네스)로 접히므로
   * 이 컴포넌트를 쓰는 다른 화면은 종전과 같은 그림을 본다.
   */
  submodelFor?: (a: Agent) => { id: string; label: string } | null;
}) {
  const { t } = useTranslation();
  const [showOlderAgents, setShowOlderAgents] = useState(false);
  // Cost source priority: live Firestore-backed agent.* fields (updated by
  // useCostWriter on every cost:update) → BigQuery historical via costStore
  // → empty. The Firestore path works without Cloud Functions deployed.
  const { summary } = useCostStore();
  const bqByAgent = summary?.byAgent || {};
  const now = Date.now();

  // Group agents by model
  const byModel: Record<string, Agent[]> = {};
  for (const agent of agents) {
    const model = agent.model || "claude";
    if (!byModel[model]) byModel[model] = [];
    byModel[model].push(agent);
  }

  // Per-agent cost lookup: prefer the agent doc's rolling totals (live).
  const costFor = (a: Agent) => {
    const live = a.totalCost ?? 0;
    const bq = bqByAgent[a.id];
    const hasLive =
      a.totalCost !== undefined ||
      a.totalInputTokens !== undefined ||
      a.totalOutputTokens !== undefined;
    if (hasLive) {
      return {
        cost: live,
        inputTokens: a.totalInputTokens ?? 0,
        outputTokens: a.totalOutputTokens ?? 0,
        cacheReadTokens: a.totalCacheReadTokens ?? 0,
        cacheWriteTokens: a.totalCacheWriteTokens ?? 0,
      };
    }
    if (bq) return bq;
    return null;
  };

  if (loading && agents.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        {t("agents.dashboard.loading")}
      </div>
    );
  }

  const hiddenAgentCount = agents.filter(
    (agent) => !isActiveOrRecentAgent(agent, now),
  ).length;

  return (
    <div className="space-y-4">
      {Object.entries(byModel).map(([model, modelAgents]) => {
        const info = MODEL_LIMITS[model] || {
          label: model,
          icon: "⚪",
          noteKey: "",
        };
        const displayAgents = showOlderAgents
          ? modelAgents
          : modelAgents.filter((agent) => isActiveOrRecentAgent(agent, now));
        const hiddenInModel = modelAgents.length - displayAgents.length;

        // Aggregate tokens/cost for this model group
        const modelTotals = modelAgents.reduce(
          (acc, a) => {
            const d = costFor(a);
            if (!d) return acc;
            return {
              cost: acc.cost + d.cost,
              inputTokens: acc.inputTokens + d.inputTokens,
              outputTokens: acc.outputTokens + d.outputTokens,
              cacheRead: acc.cacheRead + (d.cacheReadTokens || 0),
              cacheWrite: acc.cacheWrite + (d.cacheWriteTokens || 0),
            };
          },
          {
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
        );
        const totalTokens =
          modelTotals.inputTokens +
          modelTotals.outputTokens +
          modelTotals.cacheRead +
          modelTotals.cacheWrite;

        return (
          <div
            key={model}
            className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{info.icon}</span>
                <span className="text-sm font-medium text-gray-200">
                  {info.label}
                </span>
                <span className="text-xs text-gray-500">
                  ({modelAgents.length} agents)
                </span>
              </div>
              <span className="text-sm font-mono font-medium text-gray-200">
                {`${formatTokens(totalTokens)} tokens`}
              </span>
            </div>

            {/* Model-level gauge */}
            <ModelUsageGauge
              model={model}
              totalTokens={totalTokens}
              planLabel={planLabelFor(model, modelAgents)}
              rateLimitPercent={(() => {
                const ps = modelAgents
                  .map((a) => a.rateLimitPercent)
                  .filter((p): p is number => typeof p === "number");
                return ps.length ? Math.max(...ps) : undefined;
              })()}
            />

            {/* Token breakdown (all models — usage is token-based) */}
            {totalTokens > 0 && (
              <div className="grid grid-cols-4 gap-2 text-center">
                <TokenStat
                  label="Input"
                  value={modelTotals.inputTokens}
                  color="text-blue-400"
                />
                <TokenStat
                  label="Output"
                  value={modelTotals.outputTokens}
                  color="text-green-400"
                />
                <TokenStat
                  label="Cache Read"
                  value={modelTotals.cacheRead}
                  color="text-amber-400"
                />
                <TokenStat
                  label="Cache Write"
                  value={modelTotals.cacheWrite}
                  color="text-purple-400"
                />
              </div>
            )}

            {/* Per-submodel breakdown — 하네스 그룹 안을 실행 모델 id 로 접는다 */}
            <div className="space-y-1.5">
              {submodelBreakdown(
                displayAgents,
                model,
                costFor,
                submodelFor,
              ).map((bucket) => {
                const barPct =
                  totalTokens > 0 ? (bucket.tokens / totalTokens) * 100 : 0;

                return (
                  <div key={bucket.id} className="flex items-center gap-3">
                    <span
                      className="w-40 truncate font-mono text-xs text-gray-400"
                      title={bucket.label}
                    >
                      {bucket.label}
                    </span>
                    {bucket.agentCount > 1 && (
                      <span
                        className="shrink-0 text-[10px] text-gray-500"
                        title={`${t("agents.usage.submodelAgentCount", {
                          n: bucket.agentCount,
                        })} — ${bucket.agentNames}`}
                      >
                        ×{bucket.agentCount}
                      </span>
                    )}
                    <div className="flex-1 h-2 rounded-full bg-gray-700 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-gray-400 w-20 text-right">
                      {formatTokens(bucket.tokens)}
                    </span>
                  </div>
                );
              })}
              {displayAgents.length === 0 && modelAgents.length > 0 && (
                <div className="rounded border border-dashed border-gray-700 py-3 text-center text-xs text-gray-500">
                  {t("agents.usage.noVisibleAgents")}
                </div>
              )}
            </div>

            {hiddenInModel > 0 && (
              <div className="flex items-center justify-between text-[10px] text-gray-500">
                <span>{t("agents.usage.hiddenNotice")}</span>
                <button
                  type="button"
                  onClick={() => setShowOlderAgents(true)}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
                >
                  {t("agents.usage.showOlder", { count: hiddenInModel })}
                </button>
              </div>
            )}

            <p className="text-[10px] text-gray-600">
              {info.noteKey ? t(info.noteKey) : ""}
            </p>
          </div>
        );
      })}

      {showOlderAgents && hiddenAgentCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowOlderAgents(false)}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
          >
            {t("agents.usage.hideOlder")}
          </button>
        </div>
      )}

      {/* Empty state */}
      {agents.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-500">
          {t("agents.usage.empty")}
        </div>
      )}

      {/* Total summary */}
      {summary &&
        (summary.totalCost > 0 ||
          summary.totalInputTokens > 0 ||
          summary.totalOutputTokens > 0) && (
          <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
            <span className="text-xs text-gray-400">Total</span>
            <div className="flex items-center gap-4">
              <span className="text-lg font-mono font-bold text-gray-100">
                {formatTokens(
                  summary.totalInputTokens +
                    summary.totalOutputTokens +
                    summary.totalCacheReadTokens +
                    summary.totalCacheWriteTokens,
                )}{" "}
                tokens
              </span>
            </div>
          </div>
        )}
    </div>
  );
}

function TokenStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded bg-gray-900/50 py-1.5 px-1">
      <div className={`text-xs font-mono font-medium ${color}`}>
        {formatTokens(value)}
      </div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function ModelUsageGauge({
  model: _model,
  totalTokens,
  planLabel,
  rateLimitPercent,
}: {
  model: string;
  totalTokens: number;
  planLabel: string;
  /** Live rate-limit usage % (codex). When present, shown instead of the
   * token-activity gauge — it's the real "how close to your plan limit". */
  rateLimitPercent?: number;
}) {
  const { t } = useTranslation();
  // Subscription plans are flat-fee, so we never show a fake "$N budget".
  // Codex exposes a live rate-limit %, which is the meaningful "vs limit"
  // signal; everything else falls back to a token-activity gauge.
  if (typeof rateLimitPercent === "number") {
    const pct = Math.min(Math.max(rateLimitPercent, 0), 100);
    const color =
      pct < 70 ? "bg-green-500" : pct < 90 ? "bg-amber-500" : "bg-red-500";
    const colorText =
      pct < 70
        ? "text-green-400"
        : pct < 90
          ? "text-amber-400"
          : "text-red-400";
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-gray-500">
            {t("agents.usage.gauge.rateLimit", { planLabel })}
          </span>
          <span className={colorText}>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-700">
          <div
            className={`h-2 rounded-full ${color} transition-all duration-700`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // Flat subscription, no live limit data → token-activity gauge.
  // Rough scale: 0 → 10M low, 10M→50M medium, 50M+ high.
  const pct =
    totalTokens === 0 ? 0 : Math.min((totalTokens / 50_000_000) * 100, 100);
  const levelLabel =
    totalTokens === 0
      ? t("agents.usage.level.idle")
      : totalTokens < 10_000_000
        ? t("agents.usage.level.low")
        : totalTokens < 50_000_000
          ? t("agents.usage.level.medium")
          : t("agents.usage.level.high");
  const levelColor =
    totalTokens === 0
      ? "text-gray-500"
      : totalTokens < 10_000_000
        ? "text-green-400"
        : totalTokens < 50_000_000
          ? "text-purple-400"
          : "text-amber-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-500">
          {t("agents.usage.gauge.activity", { planLabel })}
        </span>
        <span className={levelColor}>
          {levelLabel} ({formatTokens(totalTokens)})
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-700">
        <div
          className="h-2 rounded-full bg-purple-500 transition-all duration-700"
          style={{ width: `${Math.max(pct, totalTokens > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

// ── Agent Guide ──────────────────────────────────────────────

function AgentGuide() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 text-sm">
      {/* CLI Comparison Table */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {t("agents.guide.cliCompare.title")}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1.5 pr-3">CLI</th>
                <th className="text-left py-1.5 pr-3">
                  {t("agents.guide.cliCompare.col.model")}
                </th>
                <th className="text-left py-1.5 pr-3">
                  {t("agents.guide.cliCompare.col.free")}
                </th>
                <th className="text-left py-1.5 pr-3">
                  {t("agents.guide.cliCompare.col.strength")}
                </th>
                <th className="text-left py-1.5">
                  {t("agents.guide.cliCompare.col.install")}
                </th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-700/50">
                <td className="py-2 pr-3 font-medium">
                  <span className="text-purple-400">Claude Code</span>
                </td>
                <td className="py-2 pr-3 text-gray-400">Sonnet/Opus 4</td>
                <td className="py-2 pr-3 text-gray-400">
                  {t("agents.guide.cliCompare.claude.free")}
                </td>
                <td className="py-2 pr-3 text-gray-400">
                  {t("agents.guide.cliCompare.claude.strength")}
                </td>
                <td className="py-2 font-mono text-[10px] text-gray-500">
                  curl -fsSL https://claude.ai/install.sh | bash
                </td>
              </tr>
              <tr className="border-b border-gray-700/50">
                <td className="py-2 pr-3 font-medium">
                  <span className="text-green-400">Codex CLI</span>
                </td>
                <td className="py-2 pr-3 text-gray-400">GPT-4o / o3</td>
                <td className="py-2 pr-3 text-gray-400">
                  {t("agents.guide.cliCompare.codex.free")}
                </td>
                <td className="py-2 pr-3 text-gray-400">
                  {t("agents.guide.cliCompare.codex.strength")}
                </td>
                <td className="py-2 font-mono text-[10px] text-gray-500">
                  curl -fsSL https://chatgpt.com/codex/install.sh | sh
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">
                  <span className="text-blue-400">Gemini CLI</span>
                </td>
                <td className="py-2 pr-3 text-gray-400">Gemini 2.5 Pro</td>
                <td className="py-2 pr-3 text-gray-400">
                  {t("agents.guide.cliCompare.gemini.free")}
                </td>
                <td className="py-2 pr-3 text-gray-400">
                  {t("agents.guide.cliCompare.gemini.strength")}
                </td>
                <td className="py-2 font-mono text-[10px] text-gray-500">
                  npm i -g @google/gemini-cli
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* When to Use Which Agent */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {t("agents.guide.which.title")}
        </h4>
        <div className="space-y-2.5">
          <GuideCard
            icon="🟣"
            title="Claude Code"
            scenarios={[
              t("agents.guide.which.claude.0"),
              t("agents.guide.which.claude.1"),
              t("agents.guide.which.claude.2"),
              t("agents.guide.which.claude.3"),
            ]}
          />
          <GuideCard
            icon="🟢"
            title="Codex CLI"
            scenarios={[
              t("agents.guide.which.codex.0"),
              t("agents.guide.which.codex.1"),
              t("agents.guide.which.codex.2"),
              t("agents.guide.which.codex.3"),
            ]}
          />
          <GuideCard
            icon="🔵"
            title="Gemini CLI"
            scenarios={[
              t("agents.guide.which.gemini.0"),
              t("agents.guide.which.gemini.1"),
              t("agents.guide.which.gemini.2"),
              t("agents.guide.which.gemini.3"),
            ]}
          />
        </div>
      </div>

      {/* Multi-Agent Strategy */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {t("agents.guide.strategy.title")}
        </h4>
        <div className="space-y-3 text-xs text-gray-400">
          <StrategyCard
            title={t("agents.guide.strategy.independent.title")}
            when={t("agents.guide.strategy.independent.when")}
            example={t("agents.guide.strategy.independent.example")}
            tip={t("agents.guide.strategy.independent.tip")}
          />
          <StrategyCard
            title={t("agents.guide.strategy.mixed.title")}
            when={t("agents.guide.strategy.mixed.when")}
            example={t("agents.guide.strategy.mixed.example")}
            tip={t("agents.guide.strategy.mixed.tip")}
          />
          <StrategyCard
            title={t("agents.guide.strategy.single.title")}
            when={t("agents.guide.strategy.single.when")}
            example={t("agents.guide.strategy.single.example")}
            tip={t("agents.guide.strategy.single.tip")}
          />
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {t("agents.guide.setup.title")}
        </h4>
        <div className="space-y-2 text-xs">
          <SetupStep
            step={1}
            title={t("agents.guide.setup.step1.title")}
            code={t("agents.guide.setup.step1.code")}
          />
          <SetupStep
            step={2}
            title={t("agents.guide.setup.step2.title")}
            code={t("agents.guide.setup.step2.code")}
          />
          <SetupStep
            step={3}
            title={t("agents.guide.setup.step3.title")}
            code={t("agents.guide.setup.step3.code")}
          />
        </div>
      </div>
    </div>
  );
}

function GuideCard({
  icon,
  title,
  scenarios,
}: {
  icon: string;
  title: string;
  scenarios: string[];
}) {
  return (
    <div className="flex gap-3 rounded border border-gray-700/50 bg-gray-900/30 p-2.5">
      <span className="text-lg shrink-0">{icon}</span>
      <div className="min-w-0">
        <span className="text-xs font-medium text-gray-200">{title}</span>
        <ul className="mt-1 space-y-0.5">
          {scenarios.map((s, i) => (
            <li
              key={i}
              className="text-[11px] text-gray-400 flex items-start gap-1.5"
            >
              <span className="text-gray-600 mt-0.5 shrink-0">-</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StrategyCard({
  title,
  when,
  example,
  tip,
}: {
  title: string;
  when: string;
  example: string;
  tip: string;
}) {
  return (
    <div className="rounded border border-gray-700/50 bg-gray-900/30 p-2.5 space-y-1">
      <span className="text-xs font-medium text-gray-200">{title}</span>
      <div className="text-[11px] text-gray-400 space-y-0.5">
        <p>
          <span className="text-gray-500">When:</span> {when}
        </p>
        <p>
          <span className="text-gray-500">Example:</span> {example}
        </p>
        <p className="text-amber-400/80">
          <span className="text-gray-500">Tip:</span> {tip}
        </p>
      </div>
    </div>
  );
}

function SetupStep({
  step,
  title,
  code,
}: {
  step: number;
  title: string;
  code: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
          {step}
        </span>
        <span className="text-xs font-medium text-gray-300">{title}</span>
      </div>
      <pre className="rounded bg-gray-900 p-2 text-[10px] text-gray-400 overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

// ── Setup Guide ──────────────────────────────────────────────

const CLI_GUIDES: {
  name: string;
  icon: string;
  install: string;
  run: string;
  noteKey: MessageKey;
  color: string;
}[] = [
  {
    name: "Claude Code",
    icon: "🟣",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    run: "claude --dangerously-skip-permissions",
    noteKey: "agents.setupGuide.note.claude",
    color: "border-purple-500/30",
  },
  {
    name: "OpenAI Codex CLI",
    icon: "🟢",
    install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    run: "codex --full-auto",
    noteKey: "agents.setupGuide.note.codex",
    color: "border-green-500/30",
  },
  {
    name: "Gemini CLI",
    icon: "🔵",
    install: "npm install -g @google/gemini-cli",
    run: "gemini",
    noteKey: "agents.setupGuide.note.gemini",
    color: "border-blue-500/30",
  },
];

function AgentSetupGuide({ onAddAgent }: { onAddAgent: () => void }) {
  const { t } = useTranslation();
  const [showGuide, setShowGuide] = useState(true);

  return (
    <div className="space-y-4">
      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 py-8 text-gray-500">
        <svg
          className="mb-3 h-10 w-10 text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 01-1.59.659H9.06a2.25 2.25 0 01-1.591-.659L5 14.5m14 0V7a2 2 0 00-2-2H7a2 2 0 00-2 2v7.5"
          />
        </svg>
        <p className="text-sm mb-3">{t("agents.setupGuide.empty")}</p>
        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          onClick={onAddAgent}
        >
          {t("agents.setupGuide.addFirst")}
        </button>
      </div>

      {/* Setup Guide */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowGuide(!showGuide)}
        >
          <span className="text-sm font-medium text-gray-300">
            {t("agents.setupGuide.preInstall")}
          </span>
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${
              showGuide ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {showGuide && (
          <div className="border-t border-gray-700 px-4 py-3 space-y-3">
            <p className="text-xs text-gray-500">
              {t("agents.setupGuide.preInstallDesc")}
            </p>

            {CLI_GUIDES.map((cli) => (
              <div
                key={cli.name}
                className={`rounded border ${cli.color} bg-gray-900/50 p-3 space-y-1.5`}
              >
                <div className="flex items-center gap-2">
                  <span>{cli.icon}</span>
                  <span className="text-sm font-medium text-gray-200">
                    {cli.name}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-10 flex-shrink-0">
                      {t("agents.setupGuide.install")}
                    </span>
                    <code className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 font-mono">
                      {cli.install}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-10 flex-shrink-0">
                      {t("agents.setupGuide.run")}
                    </span>
                    <code className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 font-mono">
                      {cli.run}
                    </code>
                  </div>
                </div>
                <p className="text-xs text-gray-500">{t(cli.noteKey)}</p>
              </div>
            ))}

            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-400 mb-1">
                {t("agents.setupGuide.mcp.title")}
              </p>
              <p className="text-xs text-gray-400 mb-2">
                {t("agents.setupGuide.mcp.desc")}
              </p>
              <code className="block rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 font-mono whitespace-pre">{`# Claude Code MCP 설정 (~/.claude.json)
"mcpServers": {
  "marblo-v3": {
    "command": "node",
    "args": ["${"{v3 경로}"}/dist-mcp/index.js"]
  }
}`}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
