import { useEffect, useMemo, useState } from "react";
import type { Agent } from "../../types/agent";
import type { Task } from "../../types/task";
import AgentStatusCard from "./AgentStatusCard";
import AgentFleetGrid from "./AgentFleetGrid";
import TeamSummary from "./TeamSummary";
import ActivityFeed from "./ActivityFeed";
import CostWidget from "./CostWidget";
import AuditTimeline from "./AuditTimeline";
import { useCostStore } from "../../stores/costStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useTranslation } from "../../lib/i18n";

type ViewMode = "list" | "grid";
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
  const visibleAgents = agents.filter((a) => a.role !== "orchestrator");

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
    [sessions]
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
          {visibleAgents.filter((a) => a.status !== "working").length > 0 && (
            <button
              className="flex items-center gap-1.5 rounded border border-red-600/30 bg-red-600/10 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/20"
              onClick={() => {
                const inactive = visibleAgents.filter(
                  (a) => a.status !== "working"
                );
                if (
                  confirm(
                    t("agents.dashboard.cleanupConfirm", {
                      count: inactive.length,
                    })
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
        </div>
      </div>

      {/* Team Summary */}
      <TeamSummary agents={visibleAgents} tasks={tasks} />

      {/* Agent rendering — view mode toggles between rich list cards and
          the FleetView grid. Empty state is shared. Orchestrator filtered
          out of both views (it has its own bottom panel). */}
      {visibleAgents.length === 0 ? (
        <AgentSetupGuide onAddAgent={onAddAgent} />
      ) : viewMode === "grid" ? (
        <AgentFleetGrid agents={visibleAgents} terminals={shellTerminals} />
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

      {/* Cost Tracking */}
      <CostWidget />

      {/* Activity & Audit Tabs — ActivityFeed receives the full list so the
          orchestrator agent doc keeps its events visible. */}
      <ActivityAuditTabs projectId={projectId} agents={agents} />
    </div>
  );
}

// ── Activity & Audit Tabs ────────────────────────────────────

type TabType = "activity" | "audit" | "usage" | "guide";

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
    { key: "usage", label: "Usage" },
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
      ) : activeTab === "usage" ? (
        <UsageDashboard agents={agents} />
      ) : (
        <AgentGuide />
      )}
    </div>
  );
}

// ── Usage Dashboard ──────────────────────────────────────────

const MODEL_LIMITS: Record<
  string,
  { label: string; icon: string; daily?: number; note: string }
> = {
  claude: {
    label: "Claude Code",
    icon: "🟣",
    note: "Max 구독: 무제한 (5분 쿨다운) / Pro: 일일 제한 있음",
  },
  gpt: { label: "Codex CLI", icon: "🟢", note: "API 과금 — 신규 $5 크레딧" },
  gemini: {
    label: "Gemini CLI",
    icon: "🔵",
    daily: 1500,
    note: "무료: 15 RPM, 1M TPM / 유료: 무제한",
  },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function UsageDashboard({ agents }: { agents: Agent[] }) {
  // Cost source priority: live Firestore-backed agent.* fields (updated by
  // useCostWriter on every cost:update) → BigQuery historical via costStore
  // → empty. The Firestore path works without Cloud Functions deployed.
  const { summary } = useCostStore();
  const bqByAgent = summary?.byAgent || {};

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

  return (
    <div className="space-y-4">
      {Object.entries(byModel).map(([model, modelAgents]) => {
        const info = MODEL_LIMITS[model] || {
          label: model,
          icon: "⚪",
          note: "",
        };
        const isClaude = model === "claude";

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
          }
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
                {isClaude
                  ? `${formatTokens(totalTokens)} tokens`
                  : `$${modelTotals.cost.toFixed(2)}`}
              </span>
            </div>

            {/* Model-level gauge */}
            <ModelUsageGauge
              model={model}
              cost={modelTotals.cost}
              totalTokens={totalTokens}
            />

            {/* Token breakdown for Claude */}
            {isClaude && totalTokens > 0 && (
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

            {/* Per-agent breakdown */}
            <div className="space-y-1.5">
              {modelAgents.map((agent) => {
                const d = costFor(agent);
                const agentTokens = d
                  ? d.inputTokens +
                    d.outputTokens +
                    (d.cacheReadTokens || 0) +
                    (d.cacheWriteTokens || 0)
                  : 0;
                const barBase = isClaude ? totalTokens : modelTotals.cost;
                const barValue = isClaude ? agentTokens : d?.cost || 0;
                const barPct = barBase > 0 ? (barValue / barBase) * 100 : 0;

                return (
                  <div key={agent.id} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 truncate w-28">
                      {agent.name}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-gray-700 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-gray-400 w-20 text-right">
                      {isClaude
                        ? formatTokens(agentTokens)
                        : `$${(d?.cost || 0).toFixed(2)}`}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-gray-600">{info.note}</p>
          </div>
        );
      })}

      {/* Empty state */}
      {agents.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-500">
          에이전트를 추가하면 사용량이 여기에 표시됩니다.
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
              <span className="text-sm font-mono text-gray-300">
                {formatTokens(
                  summary.totalInputTokens +
                    summary.totalOutputTokens +
                    summary.totalCacheReadTokens +
                    summary.totalCacheWriteTokens
                )}{" "}
                tokens
              </span>
              {summary.totalCost > 0 && (
                <span className="text-lg font-mono font-bold text-gray-100">
                  ${summary.totalCost.toFixed(2)}
                </span>
              )}
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
  model,
  cost,
  totalTokens,
}: {
  model: string;
  cost: number;
  totalTokens: number;
}) {
  if (model === "claude") {
    // Claude Max: token-based activity gauge
    // Rough scale: 0 → 10M low, 10M→50M medium, 50M+ high
    const pct =
      totalTokens === 0 ? 0 : Math.min((totalTokens / 50_000_000) * 100, 100);
    const levelLabel =
      totalTokens === 0
        ? "대기"
        : totalTokens < 10_000_000
        ? "낮음"
        : totalTokens < 50_000_000
        ? "보통"
        : "높음";
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
          <span className="text-gray-500">세션 활동량</span>
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

  // API-based models: cost gauge
  const maxBudget = model === "gpt" ? 5 : 10;
  const pct = Math.min((cost / maxBudget) * 100, 100);
  const color =
    pct < 40 ? "bg-green-500" : pct < 75 ? "bg-amber-500" : "bg-red-500";
  const colorText =
    pct < 40 ? "text-green-400" : pct < 75 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-500">예산 ${maxBudget} 대비</span>
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

// ── Agent Guide ──────────────────────────────────────────────

function AgentGuide() {
  return (
    <div className="space-y-4 text-sm">
      {/* CLI Comparison Table */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          AI CLI 비교
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1.5 pr-3">CLI</th>
                <th className="text-left py-1.5 pr-3">모델</th>
                <th className="text-left py-1.5 pr-3">무료 사용</th>
                <th className="text-left py-1.5 pr-3">강점</th>
                <th className="text-left py-1.5">설치</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-700/50">
                <td className="py-2 pr-3 font-medium">
                  <span className="text-purple-400">Claude Code</span>
                </td>
                <td className="py-2 pr-3 text-gray-400">Sonnet/Opus 4</td>
                <td className="py-2 pr-3 text-gray-400">Pro/Max 구독 포함</td>
                <td className="py-2 pr-3 text-gray-400">
                  코드 품질, 아키텍처 설계, 복잡한 리팩토링
                </td>
                <td className="py-2 font-mono text-[10px] text-gray-500">
                  npm i -g @anthropic-ai/claude-code
                </td>
              </tr>
              <tr className="border-b border-gray-700/50">
                <td className="py-2 pr-3 font-medium">
                  <span className="text-green-400">Codex CLI</span>
                </td>
                <td className="py-2 pr-3 text-gray-400">GPT-4o / o3</td>
                <td className="py-2 pr-3 text-gray-400">신규 $5 크레딧</td>
                <td className="py-2 pr-3 text-gray-400">
                  빠른 반복, API 연동, 간단한 수정
                </td>
                <td className="py-2 font-mono text-[10px] text-gray-500">
                  npm i -g @openai/codex
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">
                  <span className="text-blue-400">Gemini CLI</span>
                </td>
                <td className="py-2 pr-3 text-gray-400">Gemini 2.5 Pro</td>
                <td className="py-2 pr-3 text-gray-400">15 RPM 무료</td>
                <td className="py-2 pr-3 text-gray-400">
                  긴 컨텍스트(1M), 대규모 코드 분석
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
          어떤 에이전트를 써야 할까?
        </h4>
        <div className="space-y-2.5">
          <GuideCard
            icon="🟣"
            title="Claude Code"
            scenarios={[
              "복잡한 아키텍처 설계/리팩토링",
              "코드 리뷰 + 보안 분석",
              "멀티파일 변경이 필요한 기능 구현",
              "MCP 도구 연동 (Marblo 태스크 관리)",
            ]}
          />
          <GuideCard
            icon="🟢"
            title="Codex CLI"
            scenarios={[
              "빠른 버그 수정 + 핫픽스",
              "API 엔드포인트 추가",
              "테스트 코드 작성",
              "간단한 CRUD 구현",
            ]}
          />
          <GuideCard
            icon="🔵"
            title="Gemini CLI"
            scenarios={[
              "대규모 코드베이스 분석 (1M 토큰 컨텍스트)",
              "문서 생성 + 코드 설명",
              "레거시 코드 이해 + 마이그레이션 계획",
              "비용 절약이 필요한 반복 작업",
            ]}
          />
        </div>
      </div>

      {/* Multi-Agent Strategy */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          멀티 에이전트 전략
        </h4>
        <div className="space-y-3 text-xs text-gray-400">
          <StrategyCard
            title="독립 에이전트 (분리형)"
            when="서로 다른 파일/모듈을 동시에 작업할 때"
            example="프론트엔드 에이전트 + 백엔드 에이전트를 각각 실행하여 병렬 개발"
            tip="Git 충돌 방지를 위해 작업 범위(scope)를 명확히 분리하세요"
          />
          <StrategyCard
            title="혼합 모델 전략"
            when="비용 최적화 + 품질 균형이 필요할 때"
            example="Claude로 아키텍처 설계 → Codex로 반복 구현 → Gemini로 코드 리뷰"
            tip="복잡한 작업은 Claude, 단순 반복은 Codex/Gemini로 비용을 절감하세요"
          />
          <StrategyCard
            title="단일 에이전트 (집중형)"
            when="하나의 복잡한 작업에 집중할 때"
            example="대규모 리팩토링, 새로운 기능의 전체 구현"
            tip="컨텍스트가 중요한 작업은 하나의 에이전트에 맡기는 것이 효율적입니다"
          />
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          설치 가이드
        </h4>
        <div className="space-y-2 text-xs">
          <SetupStep
            step={1}
            title="CLI 설치"
            code="npm install -g @anthropic-ai/claude-code  # Claude\nnpm install -g @openai/codex               # Codex\nnpm install -g @google/gemini-cli           # Gemini"
          />
          <SetupStep
            step={2}
            title="인증 설정"
            code="# Claude: ANTHROPIC_API_KEY 환경변수 또는 Pro/Max 구독\n# Codex:  codex 실행 후 OAuth 브라우저 인증\n# Gemini: Google AI Studio에서 API 키 발급"
          />
          <SetupStep
            step={3}
            title="Marblo에서 에이전트 추가"
            code="# 1. 'Add Agent' 버튼 클릭\n# 2. 이름, 모델, 역할 선택\n# 3. MCP 연결은 자동 — 태스크 관리 바로 사용 가능"
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

const CLI_GUIDES = [
  {
    name: "Claude Code",
    icon: "🟣",
    install: "npm install -g @anthropic-ai/claude-code",
    run: "claude --dangerously-skip-permissions",
    note: "Anthropic API 키 필요 (ANTHROPIC_API_KEY)",
    color: "border-purple-500/30",
  },
  {
    name: "OpenAI Codex CLI",
    icon: "🟢",
    install: "npm install -g @openai/codex",
    run: "codex --full-auto",
    note: "OpenAI API 키 필요 (OPENAI_API_KEY)",
    color: "border-green-500/30",
  },
  {
    name: "Gemini CLI",
    icon: "🔵",
    install: "npm install -g @google/gemini-cli",
    run: "gemini",
    note: "Google AI API 키 필요",
    color: "border-blue-500/30",
  },
];

function AgentSetupGuide({ onAddAgent }: { onAddAgent: () => void }) {
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
        <p className="text-sm mb-3">에이전트가 없습니다</p>
        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          onClick={onAddAgent}
        >
          + 첫 에이전트 추가
        </button>
      </div>

      {/* Setup Guide */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowGuide(!showGuide)}
        >
          <span className="text-sm font-medium text-gray-300">
            사전 설치 가이드
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
              에이전트를 실행하려면 해당 AI CLI가 시스템에 설치되어 있어야
              합니다.
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
                      설치
                    </span>
                    <code className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 font-mono">
                      {cli.install}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-10 flex-shrink-0">
                      실행
                    </span>
                    <code className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 font-mono">
                      {cli.run}
                    </code>
                  </div>
                </div>
                <p className="text-xs text-gray-500">{cli.note}</p>
              </div>
            ))}

            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-400 mb-1">
                MCP 연결 (선택)
              </p>
              <p className="text-xs text-gray-400 mb-2">
                터미널에서 직접 CLI를 MCP와 연결하면 에이전트 없이도 티켓을
                관리할 수 있습니다.
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
