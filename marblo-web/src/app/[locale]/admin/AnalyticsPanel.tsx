"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable, getFunctions } from "firebase/functions";
import app from "@/lib/firebase";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  Users,
  Activity,
  Cpu,
  ShieldOff,
  Info,
  X,
  UserMinus,
  Hash,
} from "lucide-react";

// ── 콜러블 응답 타입 (docs/analytics-admin-callables-api.md 미러) ───────────────
type KeyCount = { key: string; count: number };

// 운영자(존킴) 자기계정 제외 현황. 서버는 제외 "건수"만 내려준다(uid 미노출).
type AdminExcludedFirestore = {
  subscriptions: number;
  billingCharges: number;
  founders: number;
  agents: number;
};
type AdminExcludedTelemetry = {
  // 이번 응답에 운영자 제외가 실제로 적용됐는지(includeAdmin 토글 상태의 반영).
  // 구버전 functions 는 이 필드를 안 내려주므로 optional — 없으면 제외로 간주.
  applied?: boolean;
  uidFiltered: boolean;
  clientIdCount: number;
};

// ── 온보딩 "첫 10분" 퍼널 (getAdminOnboardingFunnel) ─────────────────────────
type OnboardingFunnelStep = {
  key: string;
  event: string;
  label: string;
  kind: "reach" | "activation";
  clients: number;
  events: number;
  dropFromPrev: number | null;
  dropRateFromPrev: number | null;
  isMaxDrop: boolean;
};
// ★헤드라인 — 가입 후 30분 내 첫 티켓 완료 활성화율.
type ActivationHeadline = {
  activatedClients: number;
  baseClients: number;
  rate: number | null;
  windowMinutes: number;
  label: string;
};
type OnboardingFailureBranch = {
  key: string;
  event: string;
  label: string;
  clients: number;
  events: number;
  byCategory: { key: string; count: number; clients: number }[];
};
type OnboardingFunnel = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  steps: OnboardingFunnelStep[];
  failureBranches: OnboardingFailureBranch[];
  headline?: ActivationHeadline;
  note: string;
};

type BusinessSummary = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedFirestore;
  subscriptions: {
    total: number;
    byStatus: Record<string, number>;
    byPlanActive: Record<string, number>;
    byProviderActive: Record<string, number>;
    paidProActive: number;
    founderGrantActive: number;
    activeCurrent?: number;
    paidCurrent?: number;
    paddleActiveCurrent?: number;
    pastDue: number;
    newInWindow: number;
    churnedInWindow: number;
    trendByDay?: {
      date: string;
      active: number;
      new: number;
      churned: number;
    }[];
    consecutiveBilling?: {
      tossOnly: true;
      subscribers: number;
      maxCycleCount: number;
      averageCycleCount: number;
      byCycleCount: Record<string, number>;
      paddleGap: string;
    };
    proConversionRateVsSubscribers: number;
    proConversionRateVsWaitlist: number;
  };
  founders: {
    total: number;
    accessGranted: number;
    interviewCompleted: number;
    feedbackSubmitted: number;
  };
  waitlist: { total: number; newInWindow: number };
  agents: {
    liveCount: number;
    byStatus: Record<string, number>;
    rollingTotalCost: number;
    rollingTotalTokens: number;
  };
};

// 분포 렌즈 — 'events'(발생 총량, 기본) vs 'clients'(고유 사용자 수).
type MetricMode = "events" | "clients";

type UsageSummary = {
  rangeDays: number;
  generatedAt: string;
  metricMode?: MetricMode;
  adminExcluded?: AdminExcludedTelemetry;
  sampleClientCount: number;
  wau: number;
  activeByDay: { date: string; dau: number; events: number }[];
  topEvents: KeyCount[];
  spawnsByDay: { date: string; count: number }[];
  spawnsByRole: KeyCount[];
  spawnsByModel: KeyCount[];
  tasks: {
    total: number;
    succeeded: number;
    successRate: number;
    avgDurationMs: number;
  };
};

type ModelSummary = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  costByModel: {
    model: string;
    totalTokens: number;
    cost: number;
    count: number;
  }[];
  costByDay: { date: string; cost: number }[];
  modelRoleStats: {
    model: string;
    role: string;
    total: number;
    succeeded: number;
    successRate: number;
    avgDurationMs: number;
    avgCost: number;
    costEfficiency: number | null;
  }[];
  outcomeByModel: {
    model: string;
    total: number;
    succeeded: number;
    successRate: number;
    totalCost: number;
    avgCost: number;
    reworkCount: number;
    retriedTasks: number;
  }[];
  routing: {
    bySelectedModel: KeyCount[];
    byDecisionReason: KeyCount[];
    byReuseVsSpawn: KeyCount[];
    byModelSelectionMode: KeyCount[];
    scoreBuckets: {
      model: string;
      scoreBucket: string;
      reuseVsSpawn: string;
      count: number;
    }[];
  };
};

// ── 드릴다운 (getAdminDrilldown) ────────────────────────────────────────────
// 서버가 스코프별로 다른 모양을 내리지 않고 아래 제네릭 봉투 하나로 통일한다 —
// 모달이 스코프 분기 없이 그대로 렌더한다.
type DrilldownFormat = "int" | "cost" | "pct" | "duration";

type DrilldownScope =
  | "usage:day"
  | "spawn:day"
  | "cost:day"
  | "subscription:day"
  | "segment:event"
  | "segment:model"
  | "segment:role"
  | "segment:plan"
  | "segment:status"
  | "segment:provider";

type DrilldownRequest = {
  scope: DrilldownScope;
  days: number;
  date?: string;
  key?: string;
  // 상위 차트 토글과 같은 값으로 드릴다운도 동일 모집단을 분해한다(기본 제외).
  includeAdmin?: boolean;
};

type DrilldownResult = {
  scope: string;
  date: string | null;
  key: string | null;
  rangeDays: number;
  generatedAt: string;
  title: string;
  note: string;
  stats: { label: string; value: number; format: DrilldownFormat }[];
  breakdowns: {
    title: string;
    rows: KeyCount[];
    format: DrilldownFormat;
  }[];
  trend: { date: string; value: number }[] | null;
  trendLabel: string | null;
  trendFormat: DrilldownFormat;
};

type CallableError = { code?: string; message?: string };

// ── 디자인 토큰 (dataviz 검증 다크 팔레트, 다크 서피스 기준) ──────────────────
// 카테고리 슬롯 (엔티티 고정 배정, 순환 금지). palette.md dark 열.
const SERIES = "#3987e5"; // slot1 blue — 단일 측정 막대/시계열 기본
const SERIES_2 = "#199e70"; // slot2 aqua
// 상태 팔레트 (고정, 테마 무관) — 아이콘/라벨과 함께만 사용.
const STATUS_GOOD = "#0ca30c";
const STATUS_WARN = "#fab219";
const STATUS_CRIT = "#d03b3b";
const INK_MUTED = "#898781";

// 구독 티어 — key 로 고정 배정(순위 아님).
const TIER_COLOR: Record<string, string> = {
  free: INK_MUTED,
  pro: "#3987e5", // blue
  team: "#199e70", // aqua
  team_plus: "#9085e9", // violet
};
const TIER_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  team_plus: "Team+",
};
// 구독 상태 — 상태 팔레트.
const SUB_STATUS_COLOR: Record<string, string> = {
  active: STATUS_GOOD,
  past_due: STATUS_WARN,
  canceled: STATUS_CRIT,
};
const PROVIDER_COLOR: Record<string, string> = {
  toss: "#3987e5",
  paddle: "#199e70",
  founder_grant: "#9085e9",
};

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────
function fmtInt(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "0.0%";
  return `${(n * 100).toFixed(1)}%`;
}
function fmtCost(n: number | undefined | null): string {
  if (n == null || !isFinite(n) || n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
function fmtDuration(ms: number | undefined | null): string {
  if (ms == null || !isFinite(ms) || ms === 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}분`;
  return `${(m / 60).toFixed(1)}시간`;
}
// ISO/날짜 → MM/DD (x축 라벨).
function fmtDay(d: string): string {
  const parts = d.split("-");
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  const dt = new Date(d);
  if (!isNaN(dt.getTime())) return `${dt.getMonth() + 1}/${dt.getDate()}`;
  return d;
}

// ── 재사용 차트 프리미티브 ──────────────────────────────────────────────────

// KPI 스탯 카드. 값은 큰 숫자 하나 + 보조 텍스트.
function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

// 카드 컨테이너(섹션 내 하위 블록).
function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-zinc-200">{title}</h4>
        {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
      </div>
      {children}
    </div>
  );
}

// 빈 상태 플레이스홀더 — 텔레메트리 공백(6/22 이후) 안전 렌더.
function EmptyState({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-800 py-8 text-center">
      <Info className="h-4 w-4 text-zinc-600" />
      <p className="text-xs text-zinc-500">
        {label || "이 구간에 데이터가 없습니다 (옵트인 표본 공백)."}
      </p>
    </div>
  );
}

// 가로 막대 리스트 — 단일 측정을 카테고리별로. 직접 값 라벨(색만으로 식별 금지).
// onDrill 이 있으면 각 행이 버튼이 되어 세그먼트 드릴다운을 연다("그 외" 제외).
function BarList({
  data,
  color,
  colorMap,
  labelMap,
  format = fmtInt,
  emptyLabel,
  maxRows = 12,
  onDrill,
  showShare,
}: {
  data: { key: string; value: number }[];
  color?: string;
  colorMap?: Record<string, string>;
  labelMap?: Record<string, string>;
  format?: (n: number) => string;
  emptyLabel?: string;
  maxRows?: number;
  onDrill?: (key: string) => void;
  showShare?: boolean;
}) {
  const rows = data.filter((d) => d && isFinite(d.value));
  if (rows.length === 0) return <EmptyState label={emptyLabel} />;
  const max = Math.max(...rows.map((d) => d.value), 1);
  const total = rows.reduce((a, b) => a + b.value, 0);
  const shown = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows);
  const restTotal = rest.reduce((a, b) => a + b.value, 0);
  const all = restTotal
    ? [...shown, { key: "__other__", value: restTotal }]
    : shown;
  return (
    <ul className="space-y-2">
      {all.map((d) => {
        const isOther = d.key === "__other__";
        const barColor = isOther
          ? INK_MUTED
          : colorMap?.[d.key] || color || SERIES;
        const label = isOther
          ? `그 외 ${rest.length}종`
          : labelMap?.[d.key] || d.key;
        const pct = Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0);
        const share = total > 0 ? d.value / total : 0;
        const drillable = !!onDrill && !isOther;
        const body = (
          <>
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-zinc-300">{label}</span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-zinc-400">
                {format(d.value)}
                {showShare && (
                  <span className="ml-1.5 text-zinc-600">{fmtPct(share)}</span>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-zinc-900">
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
          </>
        );
        return (
          <li key={d.key} title={`${label}: ${format(d.value)}`}>
            {drillable ? (
              <button
                type="button"
                onClick={() => onDrill(d.key)}
                className="w-full rounded text-left transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label={`${label} 상세 분해 보기`}
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

// 시계열에서 값 라벨을 붙일 인덱스를 고른다.
// 포인트가 적으면 전부, 많으면 겹치지 않게 최대/최소/끝점만 — 라벨이 서로
// 밟으면 안 붙이느니만 못하다.
function pickLabelIndices(values: number[]): Set<number> {
  const n = values.length;
  if (n === 0) return new Set();
  if (n <= 12) return new Set(values.map((_, i) => i));
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < n; i++) {
    if (values[i] > values[maxI]) maxI = i;
    if (values[i] < values[minI]) minI = i;
  }
  const picked = new Set([maxI, n - 1]);
  // 최소점은 최대/끝점과 충분히 떨어져 있을 때만(라벨 충돌 방지).
  const gap = Math.max(2, Math.floor(n / 12));
  if (Math.abs(minI - maxI) > gap && Math.abs(minI - (n - 1)) > gap) {
    picked.add(minI);
  }
  return picked;
}

// 시계열 라인/영역 차트 — 단일 시리즈, 인라인 SVG. 빈/단일점 안전.
// onDrill 이 있으면 각 데이터 포인트가 클릭 가능한 히트 타깃이 된다.
function LineChart({
  data,
  color = SERIES,
  format = fmtInt,
  emptyLabel,
  onDrill,
}: {
  data: { date: string; value: number }[];
  color?: string;
  format?: (n: number) => string;
  emptyLabel?: string;
  onDrill?: (date: string) => void;
}) {
  const clean = data.filter((d) => d && isFinite(d.value));
  const allZero = clean.every((d) => d.value === 0);
  if (clean.length === 0 || allZero) return <EmptyState label={emptyLabel} />;

  const W = 640;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 20; // 값 라벨이 상단으로 나가지 않도록 여유.
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...clean.map((d) => d.value), 1);
  const n = clean.length;
  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const labelIndices = pickLabelIndices(clean.map((d) => d.value));

  const linePts = clean.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const areaPts =
    `${x(0)},${padT + innerH} ` +
    clean.map((d, i) => `${x(i)},${y(d.value)}`).join(" ") +
    ` ${x(n - 1)},${padT + innerH}`;

  // x축 라벨: 처음/중간/끝만.
  const labelIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const gid = `area-${color.replace("#", "")}`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        preserveAspectRatio="xMidYMid meet"
        style={{ height: 180 }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 가로 그리드라인 (0 / 50% / 100%) */}
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={padL}
            x2={W - padR}
            y1={padT + innerH - g * innerH}
            y2={padT + innerH - g * innerH}
            stroke="#2c2c2a"
            strokeWidth={1}
          />
        ))}
        <polygon points={areaPts} fill={`url(#${gid})`} />
        <polyline
          points={linePts}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {clean.map((d, i) => (
          <g key={i}>
            {n <= 45 && (
              <circle cx={x(i)} cy={y(d.value)} r={2.5} fill={color} />
            )}
            {/* 값 라벨 — 색·툴팁에만 의존하지 않고 수치를 직접 노출 */}
            {labelIndices.has(i) && (
              <text
                x={x(i)}
                y={y(d.value) - 7}
                fontSize={10}
                fontWeight={600}
                fill="#d4d4d8"
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              >
                {format(d.value)}
              </text>
            )}
            {/* hover hit target + 네이티브 툴팁 (+ 클릭 시 드릴다운) */}
            <rect
              x={x(i) - innerW / (2 * Math.max(n, 1))}
              y={padT}
              width={innerW / Math.max(n, 1)}
              height={innerH}
              fill="transparent"
              onClick={onDrill ? () => onDrill(d.date) : undefined}
              style={onDrill ? { cursor: "pointer" } : undefined}
            >
              <title>{`${fmtDay(d.date)} · ${format(d.value)}${
                onDrill ? " (클릭: 상세 분해)" : ""
              }`}</title>
            </rect>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            fontSize={11}
            fill={INK_MUTED}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {fmtDay(clean[i].date)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-zinc-600">
        <span>범위 최대 {format(max)}</span>
        <span>{n}일</span>
      </div>
    </div>
  );
}

function TwoLineChart({
  data,
  first,
  second,
  emptyLabel,
  onDrill,
}: {
  data: { date: string; first: number; second: number }[];
  first: { label: string; color: string; format?: (n: number) => string };
  second: { label: string; color: string; format?: (n: number) => string };
  emptyLabel?: string;
  onDrill?: (date: string) => void;
}) {
  const clean = data.filter(
    (d) => d && isFinite(d.first) && isFinite(d.second)
  );
  const allZero = clean.every((d) => d.first === 0 && d.second === 0);
  if (clean.length === 0 || allZero) return <EmptyState label={emptyLabel} />;

  const W = 640;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 20; // 값 라벨 여유.
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...clean.flatMap((d) => [d.first, d.second]), 1);
  const n = clean.length;
  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const points = (key: "first" | "second") =>
    clean.map((d, i) => `${x(i)},${y(d[key])}`).join(" ");
  const labelIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const fmtFirst = first.format || fmtInt;
  const fmtSecond = second.format || fmtInt;
  // 두 시리즈가 겹치므로 값 라벨은 각 시리즈의 피크 하나씩만 — 그 이상은
  // 서로 밟는다.
  const peak = (key: "first" | "second") => {
    let best = 0;
    for (let i = 1; i < n; i++) if (clean[i][key] > clean[best][key]) best = i;
    return clean[best][key] > 0 ? best : -1;
  };
  const firstPeak = peak("first");
  const secondPeak = peak("second");

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        preserveAspectRatio="xMidYMid meet"
        style={{ height: 180 }}
      >
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={padL}
            x2={W - padR}
            y1={padT + innerH - g * innerH}
            y2={padT + innerH - g * innerH}
            stroke="#2c2c2a"
            strokeWidth={1}
          />
        ))}
        <polyline
          points={points("first")}
          fill="none"
          stroke={first.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={points("second")}
          fill="none"
          stroke={second.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 값 라벨 — 시리즈별 피크만 직접 노출 */}
        {[
          { i: firstPeak, key: "first" as const, s: first, f: fmtFirst },
          { i: secondPeak, key: "second" as const, s: second, f: fmtSecond },
        ]
          .filter((p) => p.i >= 0)
          .map((p) => (
            <text
              key={p.key}
              x={x(p.i)}
              y={y(clean[p.i][p.key]) - 7}
              fontSize={10}
              fontWeight={600}
              fill={p.s.color}
              textAnchor={
                p.i === 0 ? "start" : p.i === n - 1 ? "end" : "middle"
              }
            >
              {p.f(clean[p.i][p.key])}
            </text>
          ))}
        {clean.map((d, i) => (
          <rect
            key={i}
            x={x(i) - innerW / (2 * Math.max(n, 1))}
            y={padT}
            width={innerW / Math.max(n, 1)}
            height={innerH}
            fill="transparent"
            onClick={onDrill ? () => onDrill(d.date) : undefined}
            style={onDrill ? { cursor: "pointer" } : undefined}
          >
            <title>{`${fmtDay(d.date)} · ${first.label} ${fmtFirst(
              d.first
            )} · ${second.label} ${fmtSecond(d.second)}${
              onDrill ? " (클릭: 상세 분해)" : ""
            }`}</title>
          </rect>
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            fontSize={11}
            fill={INK_MUTED}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {fmtDay(clean[i].date)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>범위 최대 {fmtInt(max)}</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: first.color }}
            />
            {first.label}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: second.color }}
            />
            {second.label}
          </span>
        </span>
      </div>
    </div>
  );
}

// 옵트인 표본 배지.
function SampleBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-900/50 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-300">
      <Info className="h-3.5 w-3.5" />
      옵트인 {fmtInt(n)}명 기준 · 익명 집계
    </span>
  );
}

function ThinLabelNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        SLM 라우팅 학습 라벨은 준비중입니다. 현재 task_outcomes는 success 상수와
        비용 0 라벨 결함 때문에 얇게 보일 수 있으며, 3.0.17 이후 수정된 라벨이
        축적되면서 성공률·비용·재작업 지표가 채워집니다.
      </p>
    </div>
  );
}

// 섹션 헤더 (신뢰도 배지 포함).
function SectionHeader({
  icon: Icon,
  title,
  trust,
  children,
}: {
  icon: typeof Users;
  title: string;
  trust: "green" | "yellow" | "red";
  children?: React.ReactNode;
}) {
  const badge =
    trust === "green"
      ? {
          c: "text-green-300 bg-green-950/30 border-green-900/40",
          t: "🟢 항상 켜짐·식별",
        }
      : trust === "yellow"
      ? {
          c: "text-amber-300 bg-amber-950/30 border-amber-900/40",
          t: "🟡 옵트인 표본",
        }
      : { c: "text-zinc-400 bg-zinc-900 border-zinc-800", t: "🔴 소스 없음" };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-indigo-400" />
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${badge.c}`}>
          {badge.t}
        </span>
      </div>
      {children}
    </div>
  );
}

// 드릴다운 포맷 토큰 → 포매터.
function formatterFor(f: DrilldownFormat): (n: number) => string {
  if (f === "cost") return fmtCost;
  if (f === "pct") return fmtPct;
  if (f === "duration") return fmtDuration;
  return fmtInt;
}

const RANGE_PRESETS = [7, 30, 90];

// 기간 컨트롤 — 7/30/90 프리셋 + 커스텀 일수.
// 서버(getAdmin*)는 "최근 N일" 파라미터만 받으므로 커스텀도 일수 입력이다.
function RangeControl({
  days,
  onChange,
  disabled,
}: {
  days: number;
  onChange: (d: number) => void;
  disabled?: boolean;
}) {
  // days 는 이 컴포넌트의 핸들러를 통해서만 바뀌므로 effect 로 되동기화할 필요가
  // 없다 — 각 핸들러에서 draft 를 같이 갱신한다.
  const [customOpen, setCustomOpen] = useState(!RANGE_PRESETS.includes(days));
  const [draft, setDraft] = useState(String(days));

  const commit = () => {
    const n = Number(draft);
    // 서버 상한 365(BQ 스캔 가드)와 동일하게 클램프한다.
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      setDraft(String(days));
      return;
    }
    const clamped = Math.min(Math.max(Math.round(n), 1), 365);
    setDraft(String(clamped));
    if (clamped !== days) onChange(clamped);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-zinc-700">
        {RANGE_PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              setDraft(String(d));
              onChange(d);
            }}
            className={`px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              days === d && !customOpen
                ? "bg-indigo-600 text-white"
                : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {d}일
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCustomOpen(true)}
          className={`px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
            customOpen
              ? "bg-indigo-600 text-white"
              : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          커스텀
        </button>
      </div>
      {customOpen && (
        <label className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-sm text-zinc-400">
          <span className="text-xs text-zinc-500">최근</span>
          <input
            type="number"
            min={1}
            max={365}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            className="w-16 bg-transparent text-right tabular-nums text-zinc-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="조회 기간(일)"
          />
          <span className="text-xs text-zinc-500">일 (최대 365)</span>
        </label>
      )}
    </div>
  );
}

// 드릴다운 모달 — 제네릭 봉투를 그대로 렌더. 스코프별 분기 없음.
function DrilldownModal({
  request,
  state,
  onClose,
}: {
  request: DrilldownRequest;
  state: Loaded<DrilldownResult>;
  onClose: () => void;
}) {
  // Esc 로 닫기 + 열려 있는 동안 배경 스크롤 잠금.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const d = state.data;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="상세 분해"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-zinc-100">
              {d?.title || "상세 분해"}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {d?.note ||
                `${request.scope}${request.date ? ` · ${request.date}` : ""}${
                  request.key ? ` · ${request.key}` : ""
                }`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition hover:text-zinc-200"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {state.loading ? (
            <LoadingBox />
          ) : state.error ? (
            <ErrorBox msg={state.error} />
          ) : d ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {d.stats.map((s) => (
                  <StatCard
                    key={s.label}
                    label={s.label}
                    value={formatterFor(s.format)(s.value)}
                  />
                ))}
              </div>

              {d.trend && d.trend.length > 0 && (
                <Panel title={d.trendLabel || "추이"}>
                  <LineChart
                    data={d.trend}
                    format={formatterFor(d.trendFormat)}
                    color={d.trendFormat === "cost" ? SERIES_2 : SERIES}
                    emptyLabel="추이 데이터가 없습니다."
                  />
                </Panel>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {d.breakdowns.map((b) => (
                  <Panel key={b.title} title={b.title}>
                    <BarList
                      data={b.rows.map((r) => ({
                        key: r.key,
                        value: r.count,
                      }))}
                      format={formatterFor(b.format)}
                      showShare
                      emptyLabel="데이터가 없습니다."
                    />
                  </Panel>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// 운영자(관리자 계정) 제외 현황 고지.
// KPI 를 "고객 지표"로 읽으려면 운영자 본인 활동이 빠졌는지가 전제다.
// ⚠️ 서버는 uid/clientId 값을 내리지 않는다 — 건수만 표시한다.
function AdminExclusionNote({
  biz,
  usage,
  model,
}: {
  biz: BusinessSummary | null;
  usage: UsageSummary | null;
  model: ModelSummary | null;
}) {
  const fs = biz?.adminExcluded;
  const tel = usage?.adminExcluded ?? model?.adminExcluded;
  if (!fs && !tel) return null;

  const fsTotal = fs
    ? fs.subscriptions + fs.billingCharges + fs.founders + fs.agents
    : 0;
  const parts: string[] = [];
  if (fs) {
    parts.push(
      fsTotal > 0
        ? `사업 데이터에서 관리자 소유 ${fmtInt(fsTotal)}건 제외(구독 ${fmtInt(
            fs.subscriptions
          )} · 청구 ${fmtInt(fs.billingCharges)} · 파운더 ${fmtInt(
            fs.founders
          )} · 에이전트 ${fmtInt(fs.agents)})`
        : "사업 데이터에 관리자 소유 문서 없음"
    );
  }
  if (tel) {
    // applied 미제공(구버전 functions)이면 제외로 간주(기존 하드코딩 동작).
    const excluding = tel.applied !== false;
    if (!tel.uidFiltered) {
      parts.push("⚠️ ADMIN_UID 미설정 — 운영자 제외가 적용되지 않았습니다");
    } else if (!excluding) {
      // 포함(토글 ON) 모드 — 전체 수치. 제외 시 얼마가 빠지는지 함께 안내(비교).
      parts.push(
        tel.clientIdCount > 0
          ? `🟠 텔레메트리 전체 포함 중(운영자 미제외) — 제외 시 관리자 클라이언트 ${fmtInt(
              tel.clientIdCount
            )}개가 빠집니다`
          : "🟠 텔레메트리 전체 포함 중(운영자 미제외)"
      );
    } else if (tel.clientIdCount > 0) {
      parts.push(
        `텔레메트리에서 관리자 클라이언트 ${fmtInt(
          tel.clientIdCount
        )}개 제외(cost_logs 역참조 추정)`
      );
    } else {
      parts.push(
        "텔레메트리는 익명 clientId 라 운영자 식별분이 없어 제외분 0 " +
          "(비용 지출은 uid 기준 정확 제외)"
      );
    }
    // ★blind spot 상시 고지 — cost_logs 무흔적 세션은 존킴이라도 못 잡음.
    parts.push(
      "제외기 한계: cost_logs 흔적 있는 세션만 잡아 무토큰·dev·크래시 세션은 외부로 샐 수 있음"
    );
  }

  return (
    <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
      <UserMinus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>운영자 자기계정 제외: {parts.join(" · ")}.</span>
    </p>
  );
}

// 콜러블 에러 → 사용자 메시지.
function mapErr(err: CallableError): string {
  if (err?.code === "functions/permission-denied")
    return "어드민 권한이 없습니다. 로그인 계정이 관리자 UID와 일치하지 않습니다.";
  if (err?.code === "functions/failed-precondition")
    return "어드민 분석 서버 설정 오류입니다. ADMIN_UID 또는 BigQuery 설정을 서버 로그에서 확인해야 합니다.";
  if (err?.code === "functions/invalid-argument")
    return "잘못된 기간 파라미터입니다.";
  // 신규 콜러블이 아직 배포 전(web 선배포)일 때의 안내 — 나머지 섹션은 정상.
  if (err?.code === "functions/not-found" || err?.code === "functions/internal")
    return "이 지표는 Cloud Functions 배포 후 표시됩니다(신규 함수 미배포).";
  return err?.message || "데이터를 불러오지 못했습니다.";
}

// 개별 콜러블 로딩 결과 래퍼.
type Loaded<T> = { data: T | null; loading: boolean; error: string | null };

// ── 온보딩 첫10분 퍼널 시각화 ────────────────────────────────────────────────
// 단계별 "도달 고유 clientId"를 세로 막대로, 인접 단계 이탈을 화살표로 표기한다.
// ★최대 이탈 구간(isMaxDrop)은 붉게 강조 — 22→6 같은 활성화 절벽이 눈에 띄게.
function OnboardingFunnelView({ funnel }: { funnel: OnboardingFunnel }) {
  const steps = funnel.steps;
  const maxClients = Math.max(1, ...steps.map((s) => s.clients));
  const hasAny = steps.some((s) => s.clients > 0 || s.events > 0);
  const failuresWithData = funnel.failureBranches.filter(
    (f) => f.clients > 0 || f.events > 0
  );

  if (!hasAny) {
    return (
      <EmptyState label="온보딩 퍼널 이벤트가 없습니다 (해당 기간 미발화 또는 텔레메트리 공백)." />
    );
  }

  const headline = funnel.headline;

  return (
    <div className="space-y-4">
      {/* ★헤드라인 활성화 지표 — 가입 후 30분 내 첫 티켓 완료 비율. */}
      {headline && (
        <div className="rounded-xl border border-indigo-800/60 bg-indigo-950/30 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-200">
              <Activity className="h-4 w-4" />
              핵심 활성화율
            </div>
            <div className="text-2xl font-bold tabular-nums text-indigo-100">
              {headline.rate != null ? fmtPct(headline.rate) : "—"}
            </div>
          </div>
          <p className="mt-1 text-xs text-indigo-300/80">{headline.label}</p>
          <p className="mt-0.5 text-[11px] tabular-nums text-indigo-400/70">
            {fmtInt(headline.activatedClients)} / {fmtInt(headline.baseClients)}
            명 (분자=활성화 · 분모=가입)
          </p>
        </div>
      )}
      <Panel
        title="단계별 도달 (고유 clientId)"
        note="app:first_run → 로그인 → 폴더연결 → 오케오픈 → 스폰 → (활성화) 첫 티켓 완료·핵심경험·7일 잔존 · 인접 단계 감소 = 이탈"
      >
        <div className="space-y-1">
          {steps.map((s, i) => {
            const widthPct = Math.round((s.clients / maxClients) * 100);
            const drop = s.dropFromPrev;
            const showDrop = i > 0 && drop != null && drop > 0;
            return (
              <div key={s.key}>
                {showDrop && (
                  <div
                    className={`flex items-center gap-1.5 py-0.5 pl-1 text-xs ${
                      s.isMaxDrop
                        ? "font-semibold text-red-400"
                        : "text-zinc-500"
                    }`}
                  >
                    <span>↓</span>
                    <span className="tabular-nums">
                      −{fmtInt(drop)}
                      {s.dropRateFromPrev != null &&
                        ` (−${fmtPct(s.dropRateFromPrev)})`}
                    </span>
                    {s.isMaxDrop && <span>· 최대 이탈 구간</span>}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex w-40 shrink-0 items-center gap-1 text-xs text-zinc-400">
                    <span>{s.label}</span>
                    {s.kind === "activation" && (
                      <span className="rounded bg-emerald-900/50 px-1 text-[9px] font-medium text-emerald-300">
                        활성화
                      </span>
                    )}
                  </div>
                  <div className="relative h-7 flex-1 overflow-hidden rounded bg-zinc-900">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(widthPct, s.clients > 0 ? 2 : 0)}%`,
                        backgroundColor: s.isMaxDrop
                          ? STATUS_CRIT
                          : s.kind === "activation"
                          ? SERIES_2
                          : SERIES,
                      }}
                    />
                    <div className="absolute inset-0 flex items-center gap-2 px-2">
                      <span className="text-xs font-semibold tabular-nums text-zinc-100">
                        {fmtInt(s.clients)}명
                      </span>
                      {s.events > 0 && (
                        <span
                          className="text-[11px] tabular-nums"
                          style={{ color: INK_MUTED }}
                        >
                          · {fmtInt(s.events)} 이벤트
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {failuresWithData.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {failuresWithData.map((f) => (
            <Panel
              key={f.key}
              title={`실패 분기 · ${f.label}`}
              note={`${fmtInt(f.clients)} clientId · ${fmtInt(
                f.events
              )}건 · 사유(errorCategory)별`}
            >
              {f.byCategory.length > 0 ? (
                <BarList
                  data={f.byCategory.map((c) => ({
                    key: c.key,
                    value: c.count,
                  }))}
                  color={STATUS_WARN}
                  showShare
                  emptyLabel="사유 데이터가 없습니다."
                />
              ) : (
                <EmptyState label="사유(errorCategory) 미기록." />
              )}
            </Panel>
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{funnel.note}</span>
      </p>
    </div>
  );
}

export default function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  // 운영자(존킴) 포함 토글. 기본 false = 제외(고객 지표). ON = 전체 포함.
  // ★blind spot: 제외기는 cost_logs 에 흔적 있는 세션만 존킴으로 잡는다 —
  // 무토큰/dev/크래시 세션은 존킴이라도 '외부'로 샌다(툴팁에 명시, 오분해 방지).
  const [includeAdmin, setIncludeAdmin] = useState(false);
  // 분포 렌즈 토글(상위이벤트·스폰별). 기본 'events'(발생 총량, 하위호환).
  // 'clients' = 고유 사용자 수(COUNT(DISTINCT clientId)) — "몇 명이 했나".
  const [metricMode, setMetricMode] = useState<MetricMode>("events");
  const [biz, setBiz] = useState<Loaded<BusinessSummary>>({
    data: null,
    loading: true,
    error: null,
  });
  const [usage, setUsage] = useState<Loaded<UsageSummary>>({
    data: null,
    loading: true,
    error: null,
  });
  const [model, setModel] = useState<Loaded<ModelSummary>>({
    data: null,
    loading: true,
    error: null,
  });
  const [onbFunnel, setOnbFunnel] = useState<Loaded<OnboardingFunnel>>({
    data: null,
    loading: true,
    error: null,
  });
  const [modelView, setModelView] = useState<"overview" | "routing">(
    "overview"
  );
  // 드릴다운 — 열려 있는 요청과 그 응답.
  const [drill, setDrill] = useState<DrilldownRequest | null>(null);
  const [drillState, setDrillState] = useState<Loaded<DrilldownResult>>({
    data: null,
    loading: false,
    error: null,
  });
  const drillSeq = useRef(0);

  const openDrill = useCallback(
    (req: DrilldownRequest) => {
      // 드릴다운도 상위 차트 토글과 동일 모집단을 분해하도록 includeAdmin 주입.
      const fullReq = { ...req, includeAdmin };
      const seq = drillSeq.current + 1;
      drillSeq.current = seq;
      setDrill(fullReq);
      setDrillState({ data: null, loading: true, error: null });
      const fns = getFunctions(app, "us-central1");
      const call = httpsCallable<DrilldownRequest, DrilldownResult>(
        fns,
        "getAdminDrilldown"
      );
      call(fullReq)
        .then((r) => {
          if (drillSeq.current !== seq) return;
          setDrillState({ data: r.data, loading: false, error: null });
        })
        .catch((e) => {
          if (drillSeq.current !== seq) return;
          setDrillState({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          });
        });
    },
    [includeAdmin]
  );

  const closeDrill = useCallback(() => {
    drillSeq.current += 1;
    setDrill(null);
    setDrillState({ data: null, loading: false, error: null });
  }, []);

  const load = useCallback(
    async (d: number, inc: boolean, mode: MetricMode) => {
      const fns = getFunctions(app, "us-central1");
      // 사업(Firestore)은 항상 운영자 제외(별도 doc-id 기반) — includeAdmin 무관.
      const callBiz = httpsCallable<{ days: number }, BusinessSummary>(
        fns,
        "getAdminBusinessSummary"
      );
      // 텔레메트리 계열은 includeAdmin 토글을 그대로 전달. usage 는 metricMode 도.
      const callUsage = httpsCallable<
        { days: number; includeAdmin: boolean; metricMode: MetricMode },
        UsageSummary
      >(fns, "getAdminUsageSummary");
      const callModel = httpsCallable<
        { days: number; includeAdmin: boolean },
        ModelSummary
      >(fns, "getAdminModelSummary");
      const callFunnel = httpsCallable<
        { days: number; includeAdmin: boolean },
        OnboardingFunnel
      >(fns, "getAdminOnboardingFunnel");

      setBiz((s) => ({ ...s, loading: true, error: null }));
      setUsage((s) => ({ ...s, loading: true, error: null }));
      setModel((s) => ({ ...s, loading: true, error: null }));
      setOnbFunnel((s) => ({ ...s, loading: true, error: null }));

      // 각 콜러블 독립 처리 — 하나 실패해도 나머지는 렌더.
      callBiz({ days: d })
        .then((r) => setBiz({ data: r.data, loading: false, error: null }))
        .catch((e) =>
          setBiz({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      callUsage({ days: d, includeAdmin: inc, metricMode: mode })
        .then((r) => setUsage({ data: r.data, loading: false, error: null }))
        .catch((e) =>
          setUsage({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      callModel({ days: d, includeAdmin: inc })
        .then((r) => setModel({ data: r.data, loading: false, error: null }))
        .catch((e) =>
          setModel({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      // 신규 콜러블 — functions 미배포(web 선배포) 시 not-found 로 실패할 수 있으나
      // 독립 catch 라 나머지 섹션은 정상 렌더된다(배포순서 soft-fail).
      callFunnel({ days: d, includeAdmin: inc })
        .then((r) =>
          setOnbFunnel({ data: r.data, loading: false, error: null })
        )
        .catch((e) =>
          setOnbFunnel({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
    },
    []
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load(days, includeAdmin, metricMode);
    }, 0);
    return () => window.clearTimeout(id);
  }, [days, includeAdmin, metricMode, load]);

  const anyLoading =
    biz.loading || usage.loading || model.loading || onbFunnel.loading;

  const b = biz.data;
  const u = usage.data;
  const m = model.data;
  const consecutiveBilling = b?.subscriptions.consecutiveBilling ?? {
    tossOnly: true as const,
    subscribers: 0,
    maxCycleCount: 0,
    averageCycleCount: 0,
    byCycleCount: {},
    paddleGap: "",
  };

  const tierRows = useMemo(
    () =>
      b
        ? Object.entries(b.subscriptions.byPlanActive || {}).map(
            ([key, value]) => ({ key, value })
          )
        : [],
    [b]
  );
  const statusRows = useMemo(
    () =>
      b
        ? Object.entries(b.subscriptions.byStatus || {}).map(
            ([key, value]) => ({ key, value })
          )
        : [],
    [b]
  );
  const providerRows = useMemo(
    () =>
      b
        ? Object.entries(b.subscriptions.byProviderActive || {}).map(
            ([key, value]) => ({ key, value })
          )
        : [],
    [b]
  );
  const consecutiveRows = useMemo(
    () =>
      b
        ? Object.entries(
            b.subscriptions.consecutiveBilling?.byCycleCount || {}
          ).map(([key, value]) => ({ key, value }))
        : [],
    [b]
  );
  const subscriptionTrend = useMemo(
    () => b?.subscriptions.trendByDay || [],
    [b]
  );

  // 퍼널: 신청 → 선정 → 활성(옵트인) → Pro. 활성은 익명 표본이라 라벨 구분.
  const funnel = useMemo(() => {
    if (!b) return [];
    return [
      { key: "신청(대기자)", value: b.waitlist.total, trust: "green" as const },
      {
        key: "선정(파운더)",
        value: b.founders.accessGranted,
        trust: "green" as const,
      },
      {
        key: "활성(옵트인 표본)",
        value: u?.sampleClientCount ?? 0,
        trust: "yellow" as const,
      },
      {
        key: "유료 Pro",
        value: b.subscriptions.paidProActive,
        trust: "green" as const,
      },
    ];
  }, [b, u]);

  return (
    <section className="space-y-8">
      {/* 헤더 + 기간 셀렉터 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-indigo-400" />
          <h2 className="text-lg font-semibold">사업 분석</h2>
          {u && <SampleBadge n={u.sampleClientCount} />}
        </div>
        <div className="flex items-center gap-2">
          {/* 분포 렌즈 세그먼트 — 이벤트 수 vs 고유 사용자 수(상위이벤트·스폰별). */}
          <div
            className="flex overflow-hidden rounded-lg border border-zinc-700"
            title={
              "상위이벤트·스폰(역할/모델)별 분포를 세는 기준.\n" +
              "이벤트 = 발생 총량(COUNT(*)) · 고유 사용자 = 몇 명이 했나" +
              "(COUNT(DISTINCT clientId)).\n" +
              "DAU·스폰 추이·태스크 지표는 이 토글과 무관합니다."
            }
          >
            {(
              [
                ["events", "이벤트", Hash],
                ["clients", "고유 사용자", Users],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                onClick={() => setMetricMode(mode)}
                disabled={anyLoading}
                aria-pressed={metricMode === mode}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs transition disabled:opacity-50 ${
                  metricMode === mode
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <label
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            title={
              "운영자(존킴) 자기활동 제외 토글 · 기본=제외(고객 지표).\n" +
              "⚠️ 제외기는 cost_logs 에 흔적 있는 세션만 존킴으로 잡습니다 — " +
              "무토큰·dev·크래시 세션은 존킴 것이라도 '외부'로 계상될 수 있어 " +
              "외부 수치가 과대계상될 수 있습니다(오분해 주의)."
            }
          >
            <input
              type="checkbox"
              checked={includeAdmin}
              disabled={anyLoading}
              onChange={(e) => setIncludeAdmin(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-500"
            />
            <UserMinus className="h-3.5 w-3.5" />
            운영자 포함
            <Info className="h-3 w-3 text-zinc-600" />
          </label>
          <RangeControl days={days} onChange={setDays} disabled={anyLoading} />
          <button
            onClick={() => load(days, includeAdmin, metricMode)}
            disabled={anyLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
            aria-label="새로고침"
          >
            <RefreshCw
              className={`h-4 w-4 ${anyLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        모든 지표는 익명·집계치입니다(개별 PII 없음). 제품 사용(🟡)은 텔레메트리
        옵트인/도그푸드 표본이라 편향될 수 있고, 2026-06-22 이후 구간은 공백일
        수 있습니다. 차트의 데이터 포인트·막대를 클릭하면 해당 날/세그먼트
        분해를 볼 수 있습니다.
      </p>

      <AdminExclusionNote biz={b} usage={u} model={m} />

      {/* ── 사업 (🟢) ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader icon={Users} title="사업 퍼널·성장" trust="green" />
        {biz.loading ? (
          <LoadingBox />
        ) : biz.error ? (
          <ErrorBox msg={biz.error} />
        ) : b ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <StatCard
                label="대기자(가입)"
                value={fmtInt(b.waitlist.total)}
                sub={`+${fmtInt(b.waitlist.newInWindow)} / ${days}일`}
              />
              <StatCard
                label="활성 파운더"
                value={fmtInt(b.founders.accessGranted)}
                sub={`설문 ${fmtInt(
                  b.founders.feedbackSubmitted
                )} · 인터뷰 ${fmtInt(b.founders.interviewCompleted)}`}
              />
              <StatCard
                label="활성 구독자"
                value={fmtInt(b.subscriptions.activeCurrent)}
                sub="active · 만료일 미래"
                accent={STATUS_GOOD}
              />
              <StatCard
                label="유료 Pro(active)"
                value={fmtInt(b.subscriptions.paidProActive)}
                sub={`현재 ${fmtInt(
                  b.subscriptions.paidCurrent
                )} · 무료부여 ${fmtInt(b.subscriptions.founderGrantActive)}`}
                accent={SERIES}
              />
              <StatCard
                label="연속 구독자"
                value={fmtInt(consecutiveBilling.subscribers)}
                sub={`Toss 평균 ${consecutiveBilling.averageCycleCount.toFixed(
                  1
                )}회`}
                accent={SERIES_2}
              />
              <StatCard
                label="이탈(Churn)"
                value={fmtInt(b.subscriptions.churnedInWindow)}
                sub={`연체 ${fmtInt(b.subscriptions.pastDue)} · ${days}일`}
                accent={
                  b.subscriptions.churnedInWindow > 0 ? STATUS_CRIT : undefined
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel
                title="구독 티어 분포 (active)"
                note={`활성 구독 ${fmtInt(
                  Object.values(b.subscriptions.byPlanActive || {}).reduce(
                    (a, c) => a + c,
                    0
                  )
                )}건`}
              >
                <BarList
                  data={tierRows}
                  colorMap={TIER_COLOR}
                  labelMap={TIER_LABEL}
                  showShare
                  emptyLabel="활성 구독이 없습니다."
                  onDrill={(key) =>
                    openDrill({ scope: "segment:plan", key, days })
                  }
                />
              </Panel>
              <Panel
                title="구독 상태 분포"
                note={`전체 ${fmtInt(b.subscriptions.total)}건`}
              >
                <BarList
                  data={statusRows}
                  colorMap={SUB_STATUS_COLOR}
                  showShare
                  emptyLabel="구독 데이터가 없습니다."
                  onDrill={(key) =>
                    openDrill({ scope: "segment:status", key, days })
                  }
                />
              </Panel>
              <Panel title="결제 수단 (active)">
                <BarList
                  data={providerRows}
                  colorMap={PROVIDER_COLOR}
                  showShare
                  emptyLabel="활성 결제 구독이 없습니다."
                  onDrill={(key) =>
                    openDrill({ scope: "segment:provider", key, days })
                  }
                />
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel
                title="활성 구독자 추이"
                note="status=active · currentPeriodEnd 미래"
              >
                <LineChart
                  data={subscriptionTrend.map((d) => ({
                    date: d.date,
                    value: d.active,
                  }))}
                  color={STATUS_GOOD}
                  emptyLabel="활성 구독자 추이 데이터가 없습니다."
                  onDrill={(date) =>
                    openDrill({ scope: "subscription:day", date, days })
                  }
                />
              </Panel>
              <Panel
                title="성장/이탈 추이"
                note="신규 구독 doc · canceled/past_due"
              >
                <TwoLineChart
                  data={subscriptionTrend.map((d) => ({
                    date: d.date,
                    first: d.new,
                    second: d.churned,
                  }))}
                  first={{ label: "성장", color: SERIES_2 }}
                  second={{ label: "이탈", color: STATUS_CRIT }}
                  emptyLabel="성장/이탈 이벤트가 없습니다."
                  onDrill={(date) =>
                    openDrill({ scope: "subscription:day", date, days })
                  }
                />
              </Panel>
              <Panel
                title="연속 청구 사이클"
                note={`Toss billingCharges 기준 · Paddle ${fmtInt(
                  b.subscriptions.paddleActiveCurrent
                )}건은 원장 공백`}
              >
                <BarList
                  data={consecutiveRows}
                  color={SERIES_2}
                  labelMap={{
                    "2": "2회",
                    "3": "3회",
                    "4": "4회",
                    "5": "5회",
                    "6+": "6회 이상",
                  }}
                  emptyLabel="연속 succeeded 청구가 없습니다."
                />
              </Panel>
            </div>

            <Panel
              title="가입 → 활성 → Pro 퍼널"
              note="양끝(가입·Pro)은 식별 데이터(🟢), 가운데 활성은 옵트인 표본(🟡)."
            >
              {funnel.every((f) => f.value === 0) ? (
                <EmptyState label="퍼널 데이터가 없습니다." />
              ) : (
                <ul className="space-y-2.5">
                  {(() => {
                    const fmax = Math.max(...funnel.map((f) => f.value), 1);
                    return funnel.map((f) => {
                      const pct = Math.max(
                        (f.value / fmax) * 100,
                        f.value > 0 ? 3 : 0
                      );
                      const color = f.trust === "yellow" ? STATUS_WARN : SERIES;
                      return (
                        <li key={f.key}>
                          <div className="mb-0.5 flex items-baseline justify-between gap-2">
                            <span className="text-xs text-zinc-300">
                              {f.key}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-zinc-400">
                              {fmtInt(f.value)}
                            </span>
                          </div>
                          <div className="h-3 w-full overflow-hidden rounded bg-zinc-900">
                            <div
                              className="h-full rounded"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: color,
                              }}
                            />
                          </div>
                        </li>
                      );
                    });
                  })()}
                </ul>
              )}
            </Panel>
          </>
        ) : null}
      </div>

      {/* ── 제품 사용 (🟡) ────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader icon={Activity} title="제품 사용·활성" trust="yellow">
          {u && <SampleBadge n={u.sampleClientCount} />}
        </SectionHeader>
        {usage.loading ? (
          <LoadingBox />
        ) : usage.error ? (
          <ErrorBox msg={usage.error} />
        ) : u ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="WAU (7일 고유)" value={fmtInt(u.wau)} />
              <StatCard
                label="옵트인 표본"
                value={fmtInt(u.sampleClientCount)}
                sub={`고유 clientId / ${days}일`}
              />
              <StatCard
                label="태스크 성공률"
                value={fmtPct(u.tasks.successRate)}
                sub={`${fmtInt(u.tasks.succeeded)}/${fmtInt(u.tasks.total)}`}
                accent={u.tasks.total > 0 ? STATUS_GOOD : undefined}
              />
              <StatCard
                label="평균 완료시간"
                value={fmtDuration(u.tasks.avgDurationMs)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel
                title="DAU 추이"
                note="일별 고유 활성 clientId (옵트인 표본)"
              >
                <LineChart
                  data={u.activeByDay.map((d) => ({
                    date: d.date,
                    value: d.dau,
                  }))}
                  emptyLabel="활성 데이터가 없습니다 (텔레메트리 공백)."
                  onDrill={(date) =>
                    openDrill({ scope: "usage:day", date, days })
                  }
                />
              </Panel>
              <Panel title="에이전트 스폰 추이" note="agent:spawned 일별">
                <LineChart
                  data={u.spawnsByDay.map((d) => ({
                    date: d.date,
                    value: d.count,
                  }))}
                  color={SERIES_2}
                  emptyLabel="스폰 이벤트가 없습니다."
                  onDrill={(date) =>
                    openDrill({ scope: "spawn:day", date, days })
                  }
                />
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel
                title="상위 이벤트"
                note={
                  (u.metricMode ?? "events") === "clients"
                    ? "단위: 고유 사용자 수(clientId)"
                    : "단위: 이벤트 발생 수"
                }
              >
                <BarList
                  data={u.topEvents.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  showShare
                  emptyLabel="이벤트 데이터가 없습니다."
                  onDrill={(key) =>
                    openDrill({ scope: "segment:event", key, days })
                  }
                />
              </Panel>
              <Panel
                title="스폰 — 역할별"
                note={
                  (u.metricMode ?? "events") === "clients"
                    ? "단위: 고유 사용자 수(clientId)"
                    : "단위: 스폰 발생 수"
                }
              >
                <BarList
                  data={u.spawnsByRole.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  color={SERIES_2}
                  showShare
                  emptyLabel="스폰 데이터가 없습니다."
                  onDrill={(key) =>
                    openDrill({ scope: "segment:role", key, days })
                  }
                />
              </Panel>
              <Panel
                title="스폰 — 모델별"
                note={
                  (u.metricMode ?? "events") === "clients"
                    ? "단위: 고유 사용자 수(clientId)"
                    : "단위: 스폰 발생 수"
                }
              >
                <BarList
                  data={u.spawnsByModel.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  color={SERIES_2}
                  showShare
                  emptyLabel="스폰 데이터가 없습니다."
                  onDrill={(key) =>
                    openDrill({ scope: "segment:model", key, days })
                  }
                />
              </Panel>
            </div>
          </>
        ) : null}
      </div>

      {/* ── 온보딩 첫10분 퍼널 (🟡) ───────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={Activity}
          title="온보딩 첫 10분 퍼널 (활성화)"
          trust="yellow"
        />
        {onbFunnel.loading ? (
          <LoadingBox />
        ) : onbFunnel.error ? (
          <ErrorBox msg={onbFunnel.error} />
        ) : onbFunnel.data ? (
          <OnboardingFunnelView funnel={onbFunnel.data} />
        ) : null}
      </div>

      {/* ── 모델 준비 (🟡) ────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader icon={Cpu} title="모델 선정·라우팅" trust="yellow">
          <div className="flex overflow-hidden rounded-lg border border-zinc-700">
            {[
              ["overview", "비용/성과"],
              ["routing", "SLM/라우팅"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setModelView(key as "overview" | "routing")}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  modelView === key
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionHeader>
        {model.loading ? (
          <LoadingBox />
        ) : model.error ? (
          <ErrorBox msg={model.error} />
        ) : m ? (
          <>
            <ThinLabelNotice />

            {modelView === "overview" ? (
              <>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Panel
                    title="모델별 비용"
                    note={`${days}일 누적 (cost_logs)`}
                  >
                    <BarList
                      data={m.costByModel.map((c) => ({
                        key: c.model,
                        value: c.cost,
                      }))}
                      format={fmtCost}
                      showShare
                      emptyLabel="비용 데이터가 없습니다."
                      onDrill={(key) =>
                        openDrill({ scope: "segment:model", key, days })
                      }
                    />
                  </Panel>
                  <Panel title="일별 비용 추이">
                    <LineChart
                      data={m.costByDay.map((d) => ({
                        date: d.date,
                        value: d.cost,
                      }))}
                      format={fmtCost}
                      emptyLabel="비용 데이터가 없습니다."
                      onDrill={(date) =>
                        openDrill({ scope: "cost:day", date, days })
                      }
                    />
                  </Panel>
                </div>

                <Panel
                  title="모델 × 역할 성공률·효율"
                  note="성공률·평균비용·비용대비효율 (task_outcomes)"
                >
                  {m.modelRoleStats.length === 0 ? (
                    <EmptyState label="라벨 준비중입니다. 3.0.17 이후 task_outcomes가 축적되면 채워집니다." />
                  ) : (
                    <ModelRoleTable
                      rows={m.modelRoleStats}
                      onDrill={(scope, key) => openDrill({ scope, key, days })}
                    />
                  )}
                </Panel>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard
                    label="라우팅 결정"
                    value={fmtInt(
                      m.routing.byReuseVsSpawn.reduce(
                        (sum, r) => sum + r.count,
                        0
                      )
                    )}
                    sub="dispatch:decision"
                  />
                  <StatCard
                    label="선택 모델"
                    value={fmtInt(m.routing.bySelectedModel.length)}
                    sub="모델 종류"
                  />
                  <StatCard
                    label="Outcome 모델"
                    value={fmtInt(m.outcomeByModel.length)}
                    sub="task_outcomes"
                  />
                  <StatCard
                    label="재작업"
                    value={fmtInt(
                      m.outcomeByModel.reduce(
                        (sum, r) => sum + r.reworkCount,
                        0
                      )
                    )}
                    sub="retriesCount 합계"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
                  <Panel title="선택 모델">
                    <BarList
                      data={m.routing.bySelectedModel.map((e) => ({
                        key: e.key,
                        value: e.count,
                      }))}
                      showShare
                      emptyLabel="라우팅 결정 데이터가 없습니다. 라벨 준비중/3.0.17 이후 축적 상태입니다."
                      onDrill={(key) =>
                        openDrill({ scope: "segment:model", key, days })
                      }
                    />
                  </Panel>
                  <Panel title="결정 사유">
                    <BarList
                      data={m.routing.byDecisionReason.map((e) => ({
                        key: e.key,
                        value: e.count,
                      }))}
                      showShare
                      emptyLabel="결정 사유 데이터가 없습니다."
                    />
                  </Panel>
                  <Panel title="재사용 vs 스폰">
                    <BarList
                      data={m.routing.byReuseVsSpawn.map((e) => ({
                        key: e.key,
                        value: e.count,
                      }))}
                      colorMap={{
                        reuse: STATUS_GOOD,
                        restart: STATUS_WARN,
                        spawn: SERIES,
                      }}
                      showShare
                      emptyLabel="데이터가 없습니다."
                    />
                  </Panel>
                  <Panel title="선정 모드">
                    <BarList
                      data={m.routing.byModelSelectionMode.map((e) => ({
                        key: e.key,
                        value: e.count,
                      }))}
                      showShare
                      emptyLabel="데이터가 없습니다."
                    />
                  </Panel>
                </div>

                <Panel
                  title="매칭점수 분포"
                  note="perModelScores[].total + reuse/restart agentScore 버킷"
                >
                  <RoutingScoreTable rows={m.routing.scoreBuckets} />
                </Panel>

                <Panel
                  title="모델별 Outcome"
                  note="성공·비용·재작업 라벨은 준비중이며 3.0.17 이후 축적분부터 해석 가능"
                >
                  <OutcomeByModelTable rows={m.outcomeByModel} />
                </Panel>
              </>
            )}
          </>
        ) : null}
      </div>

      {/* ── 안정성 (🔴 Sentry 선행) ──────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader icon={ShieldOff} title="안정성·에러율" trust="red" />
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-10 text-center">
          <ShieldOff className="h-6 w-6 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-400">
            Sentry 연동 대기 (v2)
          </p>
          <p className="max-w-md text-xs text-zinc-600">
            크래시/에러율·릴리스별 안정성 KPI 는 Sentry DSN 설정 후
            활성화됩니다. 현재 DSN 미설정 상태로 데이터 소스가 없습니다.
          </p>
        </div>
      </div>

      {drill && (
        <DrilldownModal
          request={drill}
          state={drillState}
          onClose={closeDrill}
        />
      )}
    </section>
  );
}

function ModelRoleTable({
  rows,
  onDrill,
}: {
  rows: ModelSummary["modelRoleStats"];
  onDrill?: (scope: "segment:model" | "segment:role", key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="py-2 pr-4 font-medium">모델</th>
            <th className="py-2 pr-4 font-medium">역할</th>
            <th className="py-2 pr-4 font-medium text-right">건수</th>
            <th className="py-2 pr-4 font-medium">성공률</th>
            <th className="py-2 pr-4 font-medium text-right">평균시간</th>
            <th className="py-2 pr-4 font-medium text-right">평균비용</th>
            <th className="py-2 font-medium text-right">효율</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 40).map((r, i) => (
            <tr
              key={`${r.model}-${r.role}-${i}`}
              className="border-b border-zinc-800/60 last:border-0"
            >
              <td className="py-2 pr-4 text-zinc-200">
                {onDrill ? (
                  <button
                    type="button"
                    onClick={() => onDrill("segment:model", r.model)}
                    className="rounded underline decoration-dotted underline-offset-2 transition hover:text-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {r.model}
                  </button>
                ) : (
                  r.model
                )}
              </td>
              <td className="py-2 pr-4 text-zinc-400">
                {onDrill ? (
                  <button
                    type="button"
                    onClick={() => onDrill("segment:role", r.role)}
                    className="rounded underline decoration-dotted underline-offset-2 transition hover:text-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {r.role}
                  </button>
                ) : (
                  r.role
                )}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtInt(r.total)}
              </td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-900">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.round(r.successRate * 100)}%`,
                        backgroundColor:
                          r.successRate >= 0.7
                            ? STATUS_GOOD
                            : r.successRate >= 0.4
                            ? STATUS_WARN
                            : STATUS_CRIT,
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-zinc-300">
                    {fmtPct(r.successRate)}
                  </span>
                </div>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtDuration(r.avgDurationMs)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtCost(r.avgCost)}
              </td>
              <td className="py-2 text-right tabular-nums text-zinc-300">
                {r.costEfficiency == null ? "—" : r.costEfficiency.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoutingScoreTable({
  rows,
}: {
  rows: ModelSummary["routing"]["scoreBuckets"];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState label="매칭점수 데이터가 없습니다. dispatch:decision 축적 후 표시됩니다." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="py-2 pr-4 font-medium">모델</th>
            <th className="py-2 pr-4 font-medium">점수 버킷</th>
            <th className="py-2 pr-4 font-medium">경로</th>
            <th className="py-2 font-medium text-right">건수</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 60).map((r, i) => (
            <tr
              key={`${r.model}-${r.scoreBucket}-${r.reuseVsSpawn}-${i}`}
              className="border-b border-zinc-800/60 last:border-0"
            >
              <td className="py-2 pr-4 text-zinc-200">{r.model}</td>
              <td className="py-2 pr-4 text-zinc-400">{r.scoreBucket}</td>
              <td className="py-2 pr-4 text-zinc-400">{r.reuseVsSpawn}</td>
              <td className="py-2 text-right tabular-nums text-zinc-300">
                {fmtInt(r.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeByModelTable({
  rows,
}: {
  rows: ModelSummary["outcomeByModel"];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState label="모델별 outcome 데이터가 없습니다. 라벨 준비중/3.0.17 이후 축적 상태입니다." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="py-2 pr-4 font-medium">모델</th>
            <th className="py-2 pr-4 font-medium text-right">태스크</th>
            <th className="py-2 pr-4 font-medium">성공률</th>
            <th className="py-2 pr-4 font-medium text-right">총비용</th>
            <th className="py-2 pr-4 font-medium text-right">평균비용</th>
            <th className="py-2 pr-4 font-medium text-right">재작업</th>
            <th className="py-2 font-medium text-right">재시도 태스크</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 40).map((r) => (
            <tr
              key={r.model}
              className="border-b border-zinc-800/60 last:border-0"
            >
              <td className="py-2 pr-4 text-zinc-200">{r.model}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtInt(r.total)}
              </td>
              <td className="py-2 pr-4 text-zinc-300">
                {fmtPct(r.successRate)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtCost(r.totalCost)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtCost(r.avgCost)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                {fmtInt(r.reworkCount)}
              </td>
              <td className="py-2 text-right tabular-nums text-zinc-300">
                {fmtInt(r.retriedTasks)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingBox() {
  return (
    <div className="flex justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 py-12">
      <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-red-400">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="text-sm">{msg}</p>
    </div>
  );
}
