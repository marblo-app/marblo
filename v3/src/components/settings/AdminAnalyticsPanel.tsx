import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  getAdminAnalyticsDashboard,
  type AdminAnalyticsQuery,
} from "../../services/adminAnalyticsService";
import { useAuth } from "../../hooks/useAuth";
import {
  isAdminPermissionDenied,
  useAdminAccessStore,
} from "../../stores/adminAccessStore";
import type {
  AdminAnalyticsDashboardData,
  RetentionCohort,
  RetentionHorizon,
  ThirtyDayRetentionPoint,
} from "../../types/adminAnalytics";

const HORIZONS: Array<{ key: RetentionHorizon; label: string }> = [
  { key: "d1", label: "D1" },
  { key: "d7", label: "D7" },
  { key: "d14", label: "D14" },
  { key: "d30", label: "D30" },
];

/** 조회 기간. 백엔드가 `days` 를 이미 받고 있었는데 UI 가 30 을 고정으로 박아 뒀다. */
const RANGE_OPTIONS = [7, 30, 90] as const;

/** marblo-web 어드민 대시보드 — 이 패널에 없는 나머지 지표가 사는 곳. */
const FULL_DASHBOARD_URL = "https://marblo.app/ko/admin";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatPercent(value: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function heatmapStyle(rate: number | null): CSSProperties {
  const alpha = rate == null ? 0.08 : Math.max(0.12, Math.min(0.9, rate));
  return {
    backgroundColor: `rgba(20, 184, 166, ${alpha})`,
    color: rate != null && rate > 0.55 ? "#071014" : "#d1fae5",
  };
}

function retentionPath(points: ThirtyDayRetentionPoint[]): string {
  if (points.length === 0) return "";
  const values = points.map((p) => p.retentionRate ?? 0);
  const max = Math.max(0.01, ...values);
  return values
    .map((value, index) => {
      const x = points.length === 1 ? 300 : (index / (points.length - 1)) * 300;
      const y = 86 - (value / max) * 72;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

interface MetricTileProps {
  label: string;
  value: string;
  hint: string;
}

function MetricTile({ label, value, hint }: MetricTileProps) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/70 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-gray-400">{hint}</div>
    </div>
  );
}

interface RetentionGridProps {
  cohorts: RetentionCohort[];
}

function RetentionGrid({ cohorts }: RetentionGridProps) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-700"
      data-testid="admin-retention-grid"
    >
      <div className="grid grid-cols-[minmax(128px,1.4fr)_90px_repeat(4,minmax(72px,1fr))] bg-gray-900 text-xs font-medium text-gray-400">
        <div className="px-3 py-2">Cohort</div>
        <div className="px-3 py-2 text-right">Users</div>
        {HORIZONS.map((horizon) => (
          <div key={horizon.key} className="px-3 py-2 text-right">
            {horizon.label}
          </div>
        ))}
      </div>
      {cohorts.length === 0 ? (
        <div className="bg-gray-800 px-3 py-8 text-center text-sm text-gray-500">
          리텐션 코호트 데이터가 없습니다.
        </div>
      ) : (
        cohorts.map((cohort) => (
          <div
            key={`${cohort.period}:${cohort.cohort}`}
            className="grid grid-cols-[minmax(128px,1.4fr)_90px_repeat(4,minmax(72px,1fr))] border-t border-gray-700 bg-gray-800 text-sm"
          >
            <div className="px-3 py-2 font-medium text-gray-100">
              {cohort.cohort}
            </div>
            <div className="px-3 py-2 text-right text-gray-300">
              {formatNumber(cohort.cohortUsers)}
            </div>
            {HORIZONS.map((horizon) => (
              <div
                key={horizon.key}
                className="px-3 py-2 text-right font-medium"
                style={heatmapStyle(cohort.rates[horizon.key])}
                title={`${formatNumber(
                  cohort.returningUsers[horizon.key],
                )}/${formatNumber(cohort.cohortUsers)}`}
              >
                {formatPercent(cohort.rates[horizon.key])}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

interface RetentionTrendProps {
  points: ThirtyDayRetentionPoint[];
}

function RetentionTrend({ points }: RetentionTrendProps) {
  const current = points.length > 0 ? points[points.length - 1] : null;
  return (
    <div
      className="rounded-lg border border-gray-700 bg-gray-800 p-4"
      data-testid="admin-thirty-day-retention"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">
            30일+ 잔존 추이
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            first-active 이후 30일 초과 활동 비율
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold text-white">
            {formatPercent(current?.retentionRate ?? null)}
          </div>
          <div className="text-xs text-gray-500">{current?.date ?? "-"}</div>
        </div>
      </div>
      <svg
        viewBox="0 0 300 100"
        className="mt-4 h-28 w-full overflow-visible"
        role="img"
        aria-label="30일 잔존 추이 차트"
      >
        <path d="M 0 86 H 300" stroke="#374151" strokeWidth="1" />
        <path
          d={retentionPath(points)}
          fill="none"
          stroke="#38bdf8"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {points.map((point, index) => {
          const values = points.map((p) => p.retentionRate ?? 0);
          const max = Math.max(0.01, ...values);
          const x =
            points.length === 1 ? 300 : (index / (points.length - 1)) * 300;
          const y = 86 - ((point.retentionRate ?? 0) / max) * 72;
          return (
            <circle
              key={point.date}
              cx={x}
              cy={y}
              r="3.5"
              fill="#0ea5e9"
              stroke="#082f49"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
    </div>
  );
}

interface ActivationFunnelProps {
  data: AdminAnalyticsDashboardData["retention"]["activationGate"];
}

function ActivationFunnel({ data }: ActivationFunnelProps) {
  const maxUsers = Math.max(1, ...data.steps.map((step) => step.users));
  return (
    <div
      className="rounded-lg border border-gray-700 bg-gray-800 p-4"
      data-testid="admin-activation-funnel"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">
            활성화 게이트 퍼널
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            단계별 도달 수와 직전 단계 대비 이탈
          </p>
        </div>
        {data.maxDrop && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
            최대 이탈: {data.maxDrop.label}{" "}
            {formatPercent(data.maxDrop.dropRateFromPrev)}
          </div>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {data.steps.map((step) => (
          <div
            key={step.key}
            className={`rounded-md border p-3 ${
              step.isMaxDrop
                ? "border-amber-500/60 bg-amber-500/10"
                : "border-gray-700 bg-gray-900/60"
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-gray-100">{step.label}</span>
              <span className="font-mono text-gray-200">
                {formatNumber(step.users)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-gray-700">
              <div
                className="h-2 rounded-full bg-cyan-500"
                style={{
                  width: `${Math.max(3, (step.users / maxUsers) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {step.dropFromPrev == null
                ? "시작 단계"
                : `이탈 ${formatNumber(step.dropFromPrev)}명 · ${formatPercent(
                    step.dropRateFromPrev,
                  )}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 이 패널이 비는 진짜 이유를 화면에 적어 준다.
 *
 * ★2026-08-08 규명: "어드민 분석 탭이 작동 안 한다" 의 진범은 배포·권한이
 * 아니었다(두 callable 모두 ACTIVE·allUsers invoker·호출 200). UI 가 백엔드가
 * 이미 받고 있던 `includeAdmin` 을 한 번도 안 보내서, ADMIN_UID 를 제외하고 나면
 * 남는 account user 가 BQ 실측 3명(65일)뿐이라 DAU 0 · 코호트 빈칸이 나왔던 것
 * 이다. 그래서 여기서 하는 일은 (a) 그 파라미터를 노출하고 (b) 0 이 "고장" 이
 * 아니라 "제외 필터가 걸린 실제 값" 이라고 말해 주는 것이다.
 */
function EmptyDataNotice({ adminExcluded }: { adminExcluded: boolean }) {
  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200"
      data-testid="admin-analytics-empty-notice"
    >
      이 기간에 집계된 활성 계정이 없습니다.
      {adminExcluded
        ? " 어드민 계정이 제외된 상태라 값이 0 으로 보일 수 있습니다 — 위의 '어드민 포함' 을 켜고 다시 확인하세요."
        : " 어드민 포함 상태에서도 0 이면 텔레메트리 수집 자체를 확인해야 합니다."}
    </div>
  );
}

export function AdminAnalyticsPanel() {
  const { user } = useAuth();
  const markGranted = useAdminAccessStore((s) => s.markGranted);
  const markDenied = useAdminAccessStore((s) => s.markDenied);
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [days, setDays] = useState<number>(30);
  const [includeAdmin, setIncludeAdmin] = useState(false);
  const [data, setData] = useState<AdminAnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const uid = user?.uid ?? null;

  useEffect(() => {
    let alive = true;
    const query: AdminAnalyticsQuery = { days, includeAdmin };
    setLoading(true);
    setError(null);
    setDenied(false);
    getAdminAnalyticsDashboard(query)
      .then((next) => {
        if (!alive) return;
        setData(next);
        markGranted(uid);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // 확정적 비어드민만 캐시에 남긴다 — 네트워크/내부 오류로 탭이 사라지면
        // 진짜 어드민이 복구할 길이 없다(adminAccessStore 주석 참고).
        if (isAdminPermissionDenied(err)) {
          setDenied(true);
          markDenied(uid);
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : "분석 데이터를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days, includeAdmin, uid, markGranted, markDenied]);

  const cohorts = useMemo(
    () => data?.retention.cohorts[period] ?? [],
    [data?.retention.cohorts, period],
  );

  if (denied) {
    return (
      <div
        className="rounded-lg border border-gray-700 bg-gray-800 p-6 text-sm text-gray-300"
        data-testid="admin-analytics-denied"
      >
        <p className="font-medium text-gray-100">관리자 전용 화면입니다.</p>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">
          이 계정에는 어드민 분석 권한이 없습니다. 이 탭은 다음 실행부터
          숨겨집니다.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="rounded-lg border border-gray-700 bg-gray-800 p-8 text-center text-sm text-gray-400"
        data-testid="admin-analytics-loading"
      >
        어드민 분석 데이터를 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
        data-testid="admin-analytics-error"
      >
        {error}
      </div>
    );
  }

  if (!data) return null;

  const adminExcluded = data.activeUsers.adminExcluded.applied;
  const noActivity =
    data.activeUsers.dau === 0 &&
    data.activeUsers.wau === 0 &&
    data.activeUsers.mau === 0;

  return (
    <div className="space-y-6" data-testid="admin-analytics-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">어드민 분석</h2>
          <p className="mt-1 text-xs text-gray-500">
            리텐션 코호트 · 활성 계정 지표. 나머지 어드민 지표(매출 · 온보딩
            퍼널 · 릴리스 헬스 · 베타 세그먼트)는{" "}
            <a
              href={FULL_DASHBOARD_URL}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline"
            >
              marblo.app 어드민 대시보드
            </a>
            에 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  days === option
                    ? "bg-blue-500 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {option}일
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-1">
            {(["day", "week"] as const).map((nextPeriod) => (
              <button
                key={nextPeriod}
                type="button"
                onClick={() => setPeriod(nextPeriod)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  period === nextPeriod
                    ? "bg-blue-500 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {nextPeriod === "day" ? "Day" : "Week"}
              </button>
            ))}
          </div>
          {/* 백엔드는 처음부터 이 파라미터를 받고 있었다 — 없던 건 스위치뿐이다. */}
          <button
            type="button"
            role="switch"
            aria-checked={includeAdmin}
            data-testid="admin-analytics-include-admin"
            onClick={() => setIncludeAdmin((prev) => !prev)}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              includeAdmin
                ? "border-blue-500/50 bg-blue-500/15 text-blue-300"
                : "border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200"
            }`}
          >
            <span
              aria-hidden
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                includeAdmin ? "bg-blue-500" : "bg-gray-600"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                  includeAdmin ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </span>
            어드민 포함
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500" data-testid="admin-analytics-filter">
        {adminExcluded
          ? "어드민 계정 제외 — 외부 사용자만 집계합니다."
          : "어드민 계정 포함 — 내부 도그푸딩 사용량이 함께 집계됩니다."}
        {data.activeUsers.adminExcluded.clientIdCount
          ? ` (에이전트 client id ${data.activeUsers.adminExcluded.clientIdCount}개 매핑)`
          : ""}
      </p>

      {noActivity && <EmptyDataNotice adminExcluded={adminExcluded} />}

      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-4"
        data-testid="admin-stickiness-tiles"
      >
        <MetricTile
          label="DAU"
          value={formatNumber(data.activeUsers.dau)}
          hint="오늘 활성 계정"
        />
        <MetricTile
          label="WAU"
          value={formatNumber(data.activeUsers.wau)}
          hint="최근 7일 활성 계정"
        />
        <MetricTile
          label="MAU"
          value={formatNumber(data.activeUsers.mau)}
          hint="최근 30일 활성 계정"
        />
        <MetricTile
          label="DAU/MAU"
          value={formatPercent(data.activeUsers.dauMauRatio)}
          hint="stickiness"
        />
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-100">
          리텐션 코호트
        </h3>
        <RetentionGrid cohorts={cohorts} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RetentionTrend points={data.activeUsers.thirtyDayRetention.trend} />
        <ActivationFunnel data={data.retention.activationGate} />
      </div>
    </div>
  );
}
