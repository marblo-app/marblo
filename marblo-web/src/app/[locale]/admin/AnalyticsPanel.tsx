"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

// ── 콜러블 응답 타입 (docs/analytics-admin-callables-api.md 미러) ───────────────
type KeyCount = { key: string; count: number };

type BusinessSummary = {
  rangeDays: number;
  generatedAt: string;
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
    trendByDay?: { date: string; active: number; new: number; churned: number }[];
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

type UsageSummary = {
  rangeDays: number;
  generatedAt: string;
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
  routing: {
    bySelectedModel: KeyCount[];
    byDecisionReason: KeyCount[];
    byReuseVsSpawn: KeyCount[];
    byModelSelectionMode: KeyCount[];
  };
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
function BarList({
  data,
  color,
  colorMap,
  labelMap,
  format = fmtInt,
  emptyLabel,
  maxRows = 12,
}: {
  data: { key: string; value: number }[];
  color?: string;
  colorMap?: Record<string, string>;
  labelMap?: Record<string, string>;
  format?: (n: number) => string;
  emptyLabel?: string;
  maxRows?: number;
}) {
  const rows = data.filter((d) => d && isFinite(d.value));
  if (rows.length === 0) return <EmptyState label={emptyLabel} />;
  const max = Math.max(...rows.map((d) => d.value), 1);
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
        return (
          <li key={d.key} title={`${label}: ${format(d.value)}`}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-zinc-300">{label}</span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-zinc-400">
                {format(d.value)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-zinc-900">
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, backgroundColor: barColor }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// 시계열 라인/영역 차트 — 단일 시리즈, 인라인 SVG. 빈/단일점 안전.
function LineChart({
  data,
  color = SERIES,
  format = fmtInt,
  emptyLabel,
}: {
  data: { date: string; value: number }[];
  color?: string;
  format?: (n: number) => string;
  emptyLabel?: string;
}) {
  const clean = data.filter((d) => d && isFinite(d.value));
  const allZero = clean.every((d) => d.value === 0);
  if (clean.length === 0 || allZero) return <EmptyState label={emptyLabel} />;

  const W = 640;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...clean.map((d) => d.value), 1);
  const n = clean.length;
  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

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
        preserveAspectRatio="none"
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
            {/* hover hit target + 네이티브 툴팁 */}
            <rect
              x={x(i) - innerW / (2 * Math.max(n, 1))}
              y={padT}
              width={innerW / Math.max(n, 1)}
              height={innerH}
              fill="transparent"
            >
              <title>{`${fmtDay(d.date)} · ${format(d.value)}`}</title>
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
}: {
  data: { date: string; first: number; second: number }[];
  first: { label: string; color: string; format?: (n: number) => string };
  second: { label: string; color: string; format?: (n: number) => string };
  emptyLabel?: string;
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
  const padT = 12;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(
    ...clean.flatMap((d) => [d.first, d.second]),
    1
  );
  const n = clean.length;
  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const points = (key: "first" | "second") =>
    clean.map((d, i) => `${x(i)},${y(d[key])}`).join(" ");
  const labelIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const fmtFirst = first.format || fmtInt;
  const fmtSecond = second.format || fmtInt;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        preserveAspectRatio="none"
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
        {clean.map((d, i) => (
          <rect
            key={i}
            x={x(i) - innerW / (2 * Math.max(n, 1))}
            y={padT}
            width={innerW / Math.max(n, 1)}
            height={innerH}
            fill="transparent"
          >
            <title>{`${fmtDay(d.date)} · ${first.label} ${fmtFirst(
              d.first
            )} · ${second.label} ${fmtSecond(d.second)}`}</title>
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

// 콜러블 에러 → 사용자 메시지.
function mapErr(err: CallableError): string {
  if (err?.code === "functions/permission-denied")
    return "어드민 권한이 없습니다. 로그인 계정이 관리자 UID와 일치하지 않습니다.";
  if (err?.code === "functions/failed-precondition")
    return "어드민 분석 서버 설정 오류입니다. ADMIN_UID 또는 BigQuery 설정을 서버 로그에서 확인해야 합니다.";
  if (err?.code === "functions/invalid-argument")
    return "잘못된 기간 파라미터입니다.";
  return err?.message || "데이터를 불러오지 못했습니다.";
}

// 개별 콜러블 로딩 결과 래퍼.
type Loaded<T> = { data: T | null; loading: boolean; error: string | null };

export default function AnalyticsPanel() {
  const [days, setDays] = useState(30);
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

  const load = useCallback(async (d: number) => {
    const fns = getFunctions(app, "us-central1");
    const callBiz = httpsCallable<{ days: number }, BusinessSummary>(
      fns,
      "getAdminBusinessSummary"
    );
    const callUsage = httpsCallable<{ days: number }, UsageSummary>(
      fns,
      "getAdminUsageSummary"
    );
    const callModel = httpsCallable<{ days: number }, ModelSummary>(
      fns,
      "getAdminModelSummary"
    );

    setBiz((s) => ({ ...s, loading: true, error: null }));
    setUsage((s) => ({ ...s, loading: true, error: null }));
    setModel((s) => ({ ...s, loading: true, error: null }));

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
    callUsage({ days: d })
      .then((r) => setUsage({ data: r.data, loading: false, error: null }))
      .catch((e) =>
        setUsage({
          data: null,
          loading: false,
          error: mapErr(e as CallableError),
        })
      );
    callModel({ days: d })
      .then((r) => setModel({ data: r.data, loading: false, error: null }))
      .catch((e) =>
        setModel({
          data: null,
          loading: false,
          error: mapErr(e as CallableError),
        })
      );
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load(days);
    }, 0);
    return () => window.clearTimeout(id);
  }, [days, load]);

  const anyLoading = biz.loading || usage.loading || model.loading;

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
          <div className="flex overflow-hidden rounded-lg border border-zinc-700">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-medium transition ${
                  days === d
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {d}일
              </button>
            ))}
          </div>
          <button
            onClick={() => load(days)}
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
        수 있습니다.
      </p>

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
                  emptyLabel="활성 구독이 없습니다."
                />
              </Panel>
              <Panel
                title="구독 상태 분포"
                note={`전체 ${fmtInt(b.subscriptions.total)}건`}
              >
                <BarList
                  data={statusRows}
                  colorMap={SUB_STATUS_COLOR}
                  emptyLabel="구독 데이터가 없습니다."
                />
              </Panel>
              <Panel title="결제 수단 (active)">
                <BarList
                  data={providerRows}
                  colorMap={PROVIDER_COLOR}
                  emptyLabel="활성 결제 구독이 없습니다."
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
                />
              </Panel>
              <Panel title="성장/이탈 추이" note="신규 구독 doc · canceled/past_due">
                <TwoLineChart
                  data={subscriptionTrend.map((d) => ({
                    date: d.date,
                    first: d.new,
                    second: d.churned,
                  }))}
                  first={{ label: "성장", color: SERIES_2 }}
                  second={{ label: "이탈", color: STATUS_CRIT }}
                  emptyLabel="성장/이탈 이벤트가 없습니다."
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
                />
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel title="상위 이벤트">
                <BarList
                  data={u.topEvents.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  emptyLabel="이벤트 데이터가 없습니다."
                />
              </Panel>
              <Panel title="스폰 — 역할별">
                <BarList
                  data={u.spawnsByRole.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  color={SERIES_2}
                  emptyLabel="스폰 데이터가 없습니다."
                />
              </Panel>
              <Panel title="스폰 — 모델별">
                <BarList
                  data={u.spawnsByModel.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  color={SERIES_2}
                  emptyLabel="스폰 데이터가 없습니다."
                />
              </Panel>
            </div>
          </>
        ) : null}
      </div>

      {/* ── 모델 준비 (🟡) ────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader icon={Cpu} title="모델 선정·라우팅" trust="yellow" />
        {model.loading ? (
          <LoadingBox />
        ) : model.error ? (
          <ErrorBox msg={model.error} />
        ) : m ? (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="모델별 비용" note={`${days}일 누적 (cost_logs)`}>
                <BarList
                  data={m.costByModel.map((c) => ({
                    key: c.model,
                    value: c.cost,
                  }))}
                  format={fmtCost}
                  emptyLabel="비용 데이터가 없습니다."
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
                />
              </Panel>
            </div>

            <Panel
              title="모델 × 역할 성공률·효율"
              note="성공률·평균비용·비용대비효율 (task_outcomes)"
            >
              {m.modelRoleStats.length === 0 ? (
                <EmptyState label="모델×역할 데이터가 없습니다." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-left text-zinc-500">
                        <th className="py-2 pr-4 font-medium">모델</th>
                        <th className="py-2 pr-4 font-medium">역할</th>
                        <th className="py-2 pr-4 font-medium text-right">
                          건수
                        </th>
                        <th className="py-2 pr-4 font-medium">성공률</th>
                        <th className="py-2 pr-4 font-medium text-right">
                          평균시간
                        </th>
                        <th className="py-2 pr-4 font-medium text-right">
                          평균비용
                        </th>
                        <th className="py-2 font-medium text-right">효율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.modelRoleStats.slice(0, 40).map((r, i) => (
                        <tr
                          key={`${r.model}-${r.role}-${i}`}
                          className="border-b border-zinc-800/60 last:border-0"
                        >
                          <td className="py-2 pr-4 text-zinc-200">{r.model}</td>
                          <td className="py-2 pr-4 text-zinc-400">{r.role}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                            {fmtInt(r.total)}
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-900">
                                <div
                                  className="h-full rounded"
                                  style={{
                                    width: `${Math.round(
                                      r.successRate * 100
                                    )}%`,
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
                            {r.costEfficiency == null
                              ? "—"
                              : r.costEfficiency.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <Panel title="라우팅 — 선택 모델">
                <BarList
                  data={m.routing.bySelectedModel.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  emptyLabel="라우팅 결정 데이터가 없습니다."
                />
              </Panel>
              <Panel title="라우팅 — 결정 사유">
                <BarList
                  data={m.routing.byDecisionReason.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  emptyLabel="결정 사유 데이터가 없습니다."
                />
              </Panel>
              <Panel title="라우팅 — 재사용 vs 스폰">
                <BarList
                  data={m.routing.byReuseVsSpawn.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  emptyLabel="데이터가 없습니다."
                />
              </Panel>
              <Panel title="라우팅 — 선정 모드">
                <BarList
                  data={m.routing.byModelSelectionMode.map((e) => ({
                    key: e.key,
                    value: e.count,
                  }))}
                  emptyLabel="데이터가 없습니다."
                />
              </Panel>
            </div>
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
    </section>
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
