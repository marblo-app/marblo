"use client";
/**
 * 사람 축 코호트 — 어드민 ⓪ KPI · ① 획득 탭에 붙는 **사람 축 읽기 화면**.
 *
 * 서버 `getAdminPersonAxisCohort`(v3/functions/src/personAxisCohort.ts) 응답의
 * 미러다. 타입은 서버와 글자까지 같아야 한다 — 두 벌이 갈라지면 화면이 조용히
 * 다른 것을 그린다.
 *
 * ── ★이 화면이 지키는 것 다섯 (티켓 ymfPL2AorfuEniHpVpCT) ──────────────────
 *
 *  1) **축을 모르면 숫자가 거짓말을 한다.** 모든 숫자 옆에 축 배지가 붙는다
 *     (`AxisTag`). 배지 없는 숫자는 이 파일에 없다.
 *  2) **전환 시점을 하드코딩하지 않는다.** 경계는 props 로만 들어온다 — 서버가
 *     `events.userKey` 첫 행의 MIN(timestamp) 로 읽은 값이다. 이 파일에 날짜
 *     리터럴이 없다는 것을 테스트가 소스 문자열로 잰다.
 *  3) **경계 전후를 한 선에 섞지 않는다.** 설치 축 시계열(전 구간)과 사람 축
 *     시계열(경계 이후만)을 **다른 차트**에 그린다. 한 차트에 이으면 경계에서
 *     계단이 생기고 그 계단은 이탈도 성장도 아니다.
 *  4) **빈 것은 버그가 아니라 사실이다.** GA4 유입 × 사람키 코호트가 0행이면
 *     "데이터 없음" 이 아니라 **사슬의 어느 단계에서 0 이 됐는지**를 숫자로
 *     그린다. 사슬이 복구되면 같은 자리가 그대로 채워진다.
 *  5) **사람 축 블록은 비율을 만들지 않는다.** 분모가 한 자릿수라 퍼센트는
 *     동전 던지기다(BetaScorecard 규약 4). 분수와 원수만 그린다.
 */
import { Link2, TriangleAlert, Database, Globe } from "lucide-react";
import { MultiSeriesChart, type NamedSeries } from "@/components/charts";

/** 화면이 부르는 콜러블 이름. 서버 CALLABLE_PERSON_AXIS_COHORT 와 같은 문자열. */
export const CALLABLE_PERSON_AXIS_COHORT = "getAdminPersonAxisCohort";

// ── 서버 응답 미러 ─────────────────────────────────────────────────────────

export type ChainUnit = "browser" | "install" | "person";

export type ChainStep = {
  key: string;
  label: string;
  count: number | null;
  unit: ChainUnit;
  joinKey: string | null;
};

export type ChainFreshness = {
  identityMaxLinkedAt: string | null;
  ledgerMaxLinkedAt: string | null;
  ledgerRowsAfterIdentity: number | null;
};

export type PersonAxisChain = {
  steps: ChainStep[];
  breakAtKey: string | null;
  breakReason: string | null;
  freshness: ChainFreshness;
};

export type PersonAxisBoundary = {
  firstStampedAt: string | null;
  lastStampedAt: string | null;
  declaredStampFrom: string | null;
  stampGate: "on" | "off";
  stampGateReason: string | null;
  source: string;
};

export type PersonAxisDailyRow = {
  day: string;
  axis: "install" | "person" | "mixed";
  activeInstalls: number;
  people: number | null;
  stampedRows: number;
  unstampedRows: number;
};

export type SinceBoundarySummary = {
  stampedRows: number;
  unstampedRows: number;
  totalRows: number;
  people: number;
  installs: number;
};

export type Ga4PersonCohortRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  country: string | null;
  peopleLinked: number;
  peopleWithEvents: number;
  stampedRows: number;
  taskDone: number;
};

export type Ga4InstallFallbackRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  country: string | null;
  installs: number;
  browsers: number;
};

export type PersonScorecard = {
  basis: "since_link";
  view: string;
  linkedPeople: number;
  activatedPeople: number;
  activatedMinTasks: number;
  d30: { cohort: number; retained: number; pending: number };
};

export type PersonAxisCohort = {
  generatedAt: string;
  rangeDays: number;
  state: "ready" | "unavailable";
  reason: string | null;
  boundary: PersonAxisBoundary;
  sinceBoundary: SinceBoundarySummary | null;
  daily: PersonAxisDailyRow[];
  chain: PersonAxisChain | null;
  cohortRows: Ga4PersonCohortRow[];
  cohortRowsTruncated: boolean;
  installFallbackRows: Ga4InstallFallbackRow[];
  personScorecard: PersonScorecard | null;
  personScorecardReason: string | null;
  queryStatus: { ok: boolean; errors: Array<{ name: string; error: string }> };
  notes: string[];
};

/** 부르는 쪽(AnalyticsPanel)의 Loaded<T> 와 구조가 같다. 여기서 다시 정의하는 이유는 순환 import 를 피하기 위해서다. */
export type CohortLoad = {
  data: PersonAxisCohort | null;
  loading: boolean;
  error: string | null;
  notDeployed?: boolean;
};

// ── ★축 어휘 — 숫자 옆에 반드시 붙는 말 ────────────────────────────────────

export type CountAxis = "browser" | "install" | "person" | "event";

export const AXIS_LABEL: Readonly<Record<CountAxis, string>> = {
  browser: "브라우저 축",
  install: "설치 축",
  person: "사람 축",
  event: "이벤트 행",
};

const AXIS_HINT: Readonly<Record<CountAxis, string>> = {
  browser: "GA4 _ga 쿠키 단위(ga_ 가명). 한 사람이 브라우저를 둘 쓰면 2.",
  install:
    "설치 UUID 단위(in_ 가명 / installId). 한 사람이 기기를 둘 쓰면 2, 재설치도 새로 센다.",
  person: "us_ 사람키 단위. 인증된 텔레메트리에만 붙고 경계 이전 행에는 없다.",
  event: "이벤트 행 수. 사람도 설치도 아니다.",
};

const AXIS_UNIT: Readonly<Record<CountAxis, string>> = {
  browser: "대",
  install: "건",
  person: "명",
  event: "행",
};

const AXIS_TONE: Readonly<Record<CountAxis, string>> = {
  browser: "border-sky-800/60 bg-sky-950/30 text-sky-200",
  install: "border-zinc-700 bg-zinc-900 text-zinc-300",
  person: "border-violet-800/60 bg-violet-950/30 text-violet-200",
  event: "border-zinc-800 bg-zinc-950 text-zinc-400",
};

export function AxisTag({ axis }: { axis: CountAxis }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] ${AXIS_TONE[axis]}`}
      title={AXIS_HINT[axis]}
      data-axis={axis}
    >
      {axis === "person" ? <Link2 className="h-2.5 w-2.5" /> : null}
      {AXIS_LABEL[axis]}
    </span>
  );
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ko-KR").format(Math.round(n));
}

/** 축 배지가 **필수 prop** 인 숫자 카드. 배지 없이 숫자를 그릴 방법이 타입에 없다. */
export function AxisStat({
  label,
  value,
  axis,
  sub,
}: {
  label: string;
  value: number | null;
  axis: CountAxis;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-xs font-medium text-zinc-400">{label}</p>
        <AxisTag axis={axis} />
      </div>
      {value == null ? (
        <p className="mt-1 text-sm font-semibold text-amber-300">미상</p>
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {fmtInt(value)}
          <span className="ml-0.5 text-sm font-normal text-zinc-400">
            {AXIS_UNIT[axis]}
          </span>
        </p>
      )}
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

/** 사람 축 분수. ★퍼센트를 만들지 않는다(규칙 5). 분모 0 은 '—' 다. */
function PersonFraction({
  numerator,
  denominator,
  title,
}: {
  numerator: number;
  denominator: number;
  title: string;
}) {
  if (denominator <= 0) {
    return (
      <span className="text-sm font-semibold text-amber-300" title={title}>
        판단 불가
      </span>
    );
  }
  return (
    <span
      className="text-sm font-semibold tabular-nums text-zinc-100"
      title={title}
    >
      {fmtInt(numerator)}/{fmtInt(denominator)}
      <span className="ml-1 text-[11px] font-normal text-zinc-400">명</span>
    </span>
  );
}

// ── 순수 헬퍼 (테스트 대상) ────────────────────────────────────────────────

/** BQ 타임스탬프 문자열의 앞 10자 = UTC 날짜. 서버 boundaryDay 와 같은 규칙. */
export function boundaryDayOf(
  firstStampedAt: string | null | undefined,
): string | null {
  if (!firstStampedAt) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(firstStampedAt.trim());
  return m ? m[1] : null;
}

/**
 * 일별 행을 두 차트로 가른다. ★사람 축 계열은 `people` 이 null 인 날(경계 이전)을
 * **점 자체를 넣지 않는다** — 0 을 넣으면 경계 왼쪽에 0 선이 생긴다.
 */
export function splitDailyByBoundary(daily: readonly PersonAxisDailyRow[]): {
  installSeries: NamedSeries;
  personSeries: NamedSeries;
  preBoundaryDays: number;
  postBoundaryDays: number;
} {
  const installSeries: NamedSeries = {
    key: "active_installs",
    label: `${AXIS_LABEL.install} · 활성 설치`,
    slot: 1,
    points: daily.map((d) => ({ date: d.day, value: d.activeInstalls })),
  };
  const personSeries: NamedSeries = {
    key: "people",
    label: `${AXIS_LABEL.person} · 사람`,
    slot: 3,
    points: daily
      .filter((d) => d.people != null)
      .map((d) => ({ date: d.day, value: d.people ?? 0 })),
  };
  return {
    installSeries,
    personSeries,
    preBoundaryDays: daily.filter((d) => d.axis === "install").length,
    postBoundaryDays: daily.filter((d) => d.axis !== "install").length,
  };
}

/** 사슬에서 끊긴 단계의 인덱스. 없으면 -1. */
export function chainBreakIndex(chain: PersonAxisChain | null): number {
  if (!chain || !chain.breakAtKey) return -1;
  return chain.steps.findIndex((s) => s.key === chain.breakAtKey);
}

// ── 공통 조각 ──────────────────────────────────────────────────────────────

function Notice({
  children,
  tone = "amber",
}: {
  children: React.ReactNode;
  tone?: "amber" | "zinc";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-900/50 bg-amber-950/20 text-amber-200"
      : "border-zinc-800 bg-zinc-950/40 text-zinc-400";
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11px] leading-relaxed ${cls}`}
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** 연결 전 / 읽기 실패 / 로딩 — 숫자를 하나도 그리지 않는 상태 셋. */
function LoadGate({
  load,
  title,
  willShow,
  children,
}: {
  load: CohortLoad;
  title: string;
  willShow: string[];
  children: (data: PersonAxisCohort) => React.ReactNode;
}) {
  if (load.loading) {
    return (
      <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-xs text-zinc-400">
        {title} 불러오는 중…
      </div>
    );
  }
  if (load.error) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-xs text-red-200">
        {title}: {load.error}
      </div>
    );
  }
  const data = load.data;
  if (!data || load.notDeployed) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Database className="h-4 w-4 text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            연결 전
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          소스(각인된 events · marblo_identity 뷰)는 이미 쌓이고 있고, 없는 것은
          이 화면이 읽어 오는 경로입니다. 0 을 그리지 않습니다.
        </p>
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-400">기다리는 것</dt>
            <dd className="text-zinc-400">
              <span className="font-mono">{CALLABLE_PERSON_AXIS_COHORT}</span>{" "}
              (functions 배포)
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-zinc-400">붙으면 보임</dt>
            <dd className="text-zinc-400">
              <ul className="space-y-0.5">
                {willShow.map((w) => (
                  <li key={w}>· {w}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </div>
    );
  }
  if (data.state !== "ready") {
    return (
      <Notice>
        <b>{title}을(를) 읽지 못했습니다.</b> {data.reason} — 아래 칸은 0 이
        아니라 비어 있는 것입니다.
      </Notice>
    );
  }
  return <>{children(data)}</>;
}

// ── ① 경계 + 경계 전후 시계열 ────────────────────────────────────────────────

export function PersonAxisBoundaryView({ load }: { load: CohortLoad }) {
  return (
    <LoadGate
      load={load}
      title="사람 축 경계 · 경계 전후 시계열"
      willShow={[
        "각인 경계(실측 · events.userKey 첫 행) vs env 선언",
        "경계 이후 사람 수 · 설치 수 · 각인 행/미인증 행",
        "설치 축 시계열(전 구간)과 사람 축 시계열(경계 이후만) — 다른 차트",
      ]}
    >
      {(data) => <BoundaryBody data={data} />}
    </LoadGate>
  );
}

function BoundaryBody({ data }: { data: PersonAxisCohort }) {
  const b = data.boundary;
  const bDay = boundaryDayOf(b.firstStampedAt);
  const split = splitDailyByBoundary(data.daily);
  const since = data.sinceBoundary;

  if (b.stampGate === "off") {
    return (
      <div className="space-y-3">
        <Notice>
          <b>이벤트 행 사람키 각인이 꺼져 있습니다.</b> {b.stampGateReason} 사람
          축 시계열은 0 이 아니라 <b>없음</b>입니다. 아래는 설치 축뿐입니다.
        </Notice>
        <MultiSeriesChart
          title={`${AXIS_LABEL.install} · 일별 활성 설치 (전 구간)`}
          description="events.userId DISTINCT · 사람이 아니라 설치입니다"
          surface="dark"
          series={[split.installSeries]}
          state={split.installSeries.points.length > 0 ? "ready" : "empty"}
          emptyLabel="이 구간에 이벤트 행이 없습니다"
          animate={false}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 경계 카드 — 실측이 주인공, 선언은 옆자리 */}
      <div className="rounded-xl border border-violet-900/50 bg-violet-950/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link2 className="h-4 w-4 text-violet-300" />
          <p className="text-xs font-semibold text-violet-200">
            사람 축 경계 (실측)
          </p>
          <AxisTag axis="person" />
        </div>
        {b.firstStampedAt ? (
          <>
            <p
              className="mt-1 font-mono text-lg font-bold tabular-nums text-violet-100"
              data-testid="boundary-measured"
            >
              {b.firstStampedAt}
            </p>
            <p className="mt-0.5 text-[11px] text-violet-300/80">
              출처: {b.source}
              {b.lastStampedAt ? ` · 마지막 각인 ${b.lastStampedAt}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm font-semibold text-amber-300">
            아직 각인된 행이 없습니다 — 경계는 첫 행이 들어오는 순간 데이터에서
            생깁니다.
          </p>
        )}
        <p className="mt-2 text-[11px] text-zinc-400">
          env 선언(EVENTS_PERSON_STAMP_FROM):{" "}
          <span className="font-mono">{b.declaredStampFrom ?? "—"}</span>
          {b.declaredStampFrom && bDay && b.declaredStampFrom !== bDay ? (
            <b className="ml-1 text-amber-300">
              ← 실측({bDay})과 다릅니다. 화면의 경계선은 실측입니다.
            </b>
          ) : (
            <span className="ml-1 text-zinc-400">
              — 참고용. 경계선은 실측을 씁니다.
            </span>
          )}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          이 시각 <b>이전</b> 행은 전부 userKey NULL 이고 백필하지 않습니다 — 그
          구간의 사람 수는 &lsquo;없음&rsquo; 이 아니라{" "}
          <b>&lsquo;셀 수 없음&rsquo;</b>
          입니다. 그래서 왼쪽은 설치 축으로만 그립니다.
        </p>
      </div>

      {/* 경계 이후 원수 — 축 배지 필수 */}
      {since ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AxisStat
            label="경계 이후 사람"
            value={since.people}
            axis="person"
            sub="userKey DISTINCT"
          />
          <AxisStat
            label="경계 이후 설치"
            value={since.installs}
            axis="install"
            sub="userId DISTINCT · 같은 사람이 두 기기면 2"
          />
          <AxisStat
            label="각인된 행"
            value={since.stampedRows}
            axis="event"
            sub={`전체 ${fmtInt(since.totalRows)}행 중`}
          />
          <AxisStat
            label="각인 없는 행 (미인증)"
            value={since.unstampedRows}
            axis="event"
            sub="로그인 전 텔레메트리 — 결함이 아니라 설계"
          />
        </div>
      ) : b.firstStampedAt ? (
        <Notice>
          경계 이후 요약을 읽지 못했습니다(queryStatus 참조). 0 이 아닙니다.
        </Notice>
      ) : null}

      {/* ★두 차트 — 한 선으로 잇지 않는다 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MultiSeriesChart
          title={`${AXIS_LABEL.install} · 일별 활성 설치 (전 구간)`}
          description={
            bDay
              ? `세로선이 사람 축 경계(${bDay}, 실측). 선 왼쪽은 사람으로 셀 수 없는 구간입니다.`
              : "events.userId DISTINCT · 사람이 아니라 설치입니다"
          }
          surface="dark"
          series={[split.installSeries]}
          state={split.installSeries.points.length > 0 ? "ready" : "empty"}
          emptyLabel="이 구간에 이벤트 행이 없습니다"
          marker={
            bDay
              ? { date: bDay, label: "사람 축 경계 (실측)", hint: b.source }
              : undefined
          }
          animate={false}
        />
        <MultiSeriesChart
          title={`${AXIS_LABEL.person} · 일별 사람 (경계 이후만)`}
          description="userKey DISTINCT · 경계 이전 날은 점이 없습니다 — 0 이 아니라 없음"
          surface="dark"
          series={[split.personSeries]}
          state={
            !b.firstStampedAt
              ? "pending"
              : split.personSeries.points.length > 0
                ? "ready"
                : "empty"
          }
          pendingLabel="각인 전 — 사람 축 시계열이 아직 없습니다"
          emptyLabel="경계 이후 조회 구간에 사람 축 행이 없습니다"
          animate={false}
        />
      </div>
      <p className="text-[11px] text-zinc-400">
        조회 구간 {fmtInt(data.rangeDays)}일 중 설치 축만 있는 날{" "}
        <span className="tabular-nums">{fmtInt(split.preBoundaryDays)}</span>일
        · 사람 축이 있는 날{" "}
        <span className="tabular-nums">{fmtInt(split.postBoundaryDays)}</span>
        일. 경계 당일은 두 축이 한 날에 섞여 있어(mixed) 그날 사람 수는 하루
        전체가 아닙니다.
      </p>

      {data.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px] leading-relaxed text-zinc-400">
          {data.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── ② 사람 축 Activated / D30 재계산 ──────────────────────────────────────────

export function PersonAxisScorecardView({ load }: { load: CohortLoad }) {
  return (
    <LoadGate
      load={load}
      title="Activated · D30 — 사람 축 재계산"
      willShow={[
        "Activated(사람): 누적 완료 task ≥ 3 인 사람 수",
        "D30(사람): 첫 완료 task 후 +30일 안에 다시 task 한 사람 / 창이 닫힌 사람",
      ]}
    >
      {(data) => <ScorecardBody data={data} />}
    </LoadGate>
  );
}

function ScorecardBody({ data }: { data: PersonAxisCohort }) {
  const s = data.personScorecard;
  if (!s) {
    return (
      <Notice>
        <b>사람 축 Activated/D30 을 셀 수 없습니다.</b>{" "}
        {data.personScorecardReason ?? "사람 축 뷰를 읽지 못했습니다."} 위
        격자의 Activated/D30 은 <b>설치 축</b>이고 그 값은 그대로입니다.
      </Notice>
    );
  }
  return (
    <div className="space-y-3">
      <Notice tone="zinc">
        위 11개 격자의 Activated · D7/D14/D30 은 <b>설치 축</b>
        (analytics_user_daily) 이고 값을 바꾸지 않았습니다. 아래는{" "}
        <b>같은 정의</b>를{" "}
        <span className="font-mono">{s.view.split(".").slice(-1)[0]}</span>{" "}
        위에서 <b>사람 단위</b>로 다시 센 것입니다 — 두 수를 더하거나 비교하지
        마세요.
      </Notice>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AxisStat
          label="링크된 사람"
          value={s.linkedPeople}
          axis="person"
          sub="연결 이후 기준(since_link) · daily 행이 있는 사람"
        />
        <AxisStat
          label={`Activated (task ≥ ${s.activatedMinTasks})`}
          value={s.activatedPeople}
          axis="person"
          sub="설치 축 Activated 와 같은 정의, 단위만 사람"
        />
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p className="text-xs font-medium text-zinc-400">
              D30 Retention (사람)
            </p>
            <AxisTag axis="person" />
          </div>
          <div className="mt-1">
            <PersonFraction
              numerator={s.d30.retained}
              denominator={s.d30.cohort}
              title="첫 완료 task 날 + 30일 창이 닫힌 사람 중 창 안에 다시 task 한 사람. 퍼센트는 일부러 없습니다."
            />
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            창 안 닫힘(판단 대기){" "}
            <span className="tabular-nums">{fmtInt(s.d30.pending)}</span>명
            {s.d30.cohort === 0
              ? " · 창이 닫힌 사람이 아직 없어 분모가 없습니다"
              : ""}
          </p>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-400">
        ★이 블록은 퍼센트를 만들지 않습니다. 분모가 한 자릿수인 동안 비율은 한 사람이
        움직일 때마다 통째로 뒤집힙니다. 분수로 읽으세요.
      </p>
    </div>
  );
}

// ── ③ GA4 유입 × 사람키 코호트 — 0행이면 왜 0 인지 ───────────────────────────

const UNIT_AXIS: Readonly<Record<ChainUnit, CountAxis>> = {
  browser: "browser",
  install: "install",
  person: "person",
};

export function Ga4PersonCohortView({ load }: { load: CohortLoad }) {
  return (
    <LoadGate
      load={load}
      title="GA4 유입 × 사람키 코호트"
      willShow={[
        "유입원(source/medium/campaign/country)별 링크된 사람 · 활동한 사람 · task 완료",
        "사슬 4단계 — 어느 조인에서 몇이 남는지",
        "analytics_identity 신선도(마지막 갱신 vs 원장)",
      ]}
    >
      {(data) => <CohortBody data={data} />}
    </LoadGate>
  );
}

function CohortBody({ data }: { data: PersonAxisCohort }) {
  const chain = data.chain;
  const breakIdx = chainBreakIndex(chain);
  const rows = data.cohortRows;

  if (data.boundary.stampGate === "off" || !data.boundary.firstStampedAt) {
    return (
      <Notice>
        <b>사람 축 경계가 없어 코호트를 만들 수 없습니다.</b>{" "}
        {data.boundary.stampGate === "off"
          ? "각인이 꺼져 있습니다."
          : "각인은 켜졌지만 아직 각인된 행이 없습니다."}{" "}
        0행이 아니라 <b>조회하지 않은 것</b>입니다.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      {/* 사슬 — 각 단계의 남은 수와 축 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs font-semibold text-zinc-300">
          사슬 — GA4 브라우저 → 설치 → 사람 → 경계 이후 활동
        </p>
        {chain ? (
          <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            {chain.steps.map((s, i) => {
              const broken = i === breakIdx;
              const dead = breakIdx >= 0 && i > breakIdx;
              return (
                <li
                  key={s.key}
                  data-chain-step={s.key}
                  data-chain-broken={broken ? "true" : undefined}
                  className={`rounded-lg border p-3 ${
                    broken
                      ? "border-red-900/60 bg-red-950/20"
                      : dead
                        ? "border-zinc-800 bg-zinc-950/20 opacity-60"
                        : "border-zinc-800 bg-zinc-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-zinc-400">{s.key}</span>
                    <AxisTag axis={UNIT_AXIS[s.unit]} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-300">{s.label}</p>
                  {s.count == null ? (
                    <p className="mt-1 text-sm font-semibold text-amber-300">
                      미상
                    </p>
                  ) : (
                    <p
                      className={`mt-1 text-xl font-bold tabular-nums ${
                        broken ? "text-red-300" : "text-zinc-100"
                      }`}
                    >
                      {fmtInt(s.count)}
                      <span className="ml-0.5 text-xs font-normal text-zinc-400">
                        {AXIS_UNIT[UNIT_AXIS[s.unit]]}
                      </span>
                    </p>
                  )}
                  {s.joinKey && (
                    <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                      ⋈ {s.joinKey}
                    </p>
                  )}
                  {broken && (
                    <p className="mt-1 text-[11px] font-semibold text-red-300">
                      ★여기서 끊김
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <Notice>
            사슬 단계를 읽지 못했습니다(queryStatus 참조). 단계별 0 을 그리지
            않습니다.
          </Notice>
        )}
        {chain?.breakReason && (
          <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/10 p-2.5 text-[11px] leading-relaxed text-red-200">
            <b>왜 0 인가:</b> {chain.breakReason}
          </p>
        )}
        {chain && (
          <dl className="mt-3 grid grid-cols-1 gap-1 text-[11px] text-zinc-400 sm:grid-cols-3">
            <div>
              <dt className="text-zinc-400">analytics_identity 마지막 갱신</dt>
              <dd className="font-mono text-zinc-400">
                {chain.freshness.identityMaxLinkedAt ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">
                install_attribution 마지막 링크백
              </dt>
              <dd className="font-mono text-zinc-400">
                {chain.freshness.ledgerMaxLinkedAt ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">identity 가 아직 모르는 원장 행</dt>
              <dd className="tabular-nums text-zinc-400">
                {chain.freshness.ledgerRowsAfterIdentity == null
                  ? "—"
                  : `${fmtInt(chain.freshness.ledgerRowsAfterIdentity)}건`}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* 코호트 표 — 0행이면 자리를 비워 두되 이유를 붙인다 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Globe className="h-4 w-4 text-zinc-400" />
          <p className="text-xs font-semibold text-zinc-300">
            유입원 × 사람 (경계 이후 활동)
          </p>
          <AxisTag axis="person" />
        </div>
        {rows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-zinc-400">
                <tr>
                  <th className="py-1 pr-3">source</th>
                  <th className="py-1 pr-3">medium</th>
                  <th className="py-1 pr-3">campaign</th>
                  <th className="py-1 pr-3">country</th>
                  <th className="py-1 pr-3 text-right">링크된 사람</th>
                  <th className="py-1 pr-3 text-right">활동한 사람</th>
                  <th className="py-1 pr-3 text-right">각인 행</th>
                  <th className="py-1 text-right">task 완료</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-800/60">
                    <td className="py-1 pr-3">{r.source ?? "—"}</td>
                    <td className="py-1 pr-3">{r.medium ?? "—"}</td>
                    <td className="py-1 pr-3">{r.campaign ?? "—"}</td>
                    <td className="py-1 pr-3">{r.country ?? "—"}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtInt(r.peopleLinked)}명
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtInt(r.peopleWithEvents)}명
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtInt(r.stampedRows)}행
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtInt(r.taskDone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.cohortRowsTruncated && (
              <p className="mt-1 text-[11px] text-zinc-400">
                상위 {rows.length}행만 표시했습니다.
              </p>
            )}
          </div>
        ) : (
          <div
            className="mt-3 rounded-lg border border-dashed border-zinc-800 p-4 text-xs leading-relaxed text-zinc-400"
            data-testid="cohort-empty"
          >
            <p className="font-semibold text-zinc-300">
              지금 이 표는 0행입니다 — 데이터가 없어서가 아닙니다.
            </p>
            <p className="mt-1">
              {chain?.breakAtKey
                ? `사슬 ${chain.breakAtKey} 단계에서 남는 사람이 0 이라 여기까지 오는 행이 없습니다.`
                : "사슬 단계를 읽지 못해 이유를 특정할 수 없습니다."}{" "}
              사슬이 복구되면(analytics_identity 재갱신 — 별건 티켓) 이 자리는
              같은 쿼리로 그대로 채워집니다. 다만 복구돼도 지금 각인된 사람은
              내부 계정 1명이 상한입니다 — 외부 유입이 먼저입니다.
            </p>
          </div>
        )}
      </div>

      {/* 설치 축 폴백 — 유입 자체가 있는지 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Database className="h-4 w-4 text-zinc-400" />
          <p className="text-xs font-semibold text-zinc-300">
            참고 — 같은 표를 설치 축까지만
          </p>
          <AxisTag axis="install" />
          <AxisTag axis="browser" />
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">
          사람 축이 0 일 때 &ldquo;유입 자체가 없나&rdquo; 를 가르는 표입니다.
          사람 열이 없고, 위 표와 더하지 마세요.
        </p>
        {data.installFallbackRows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-zinc-400">
                <tr>
                  <th className="py-1 pr-3">source</th>
                  <th className="py-1 pr-3">medium</th>
                  <th className="py-1 pr-3">campaign</th>
                  <th className="py-1 pr-3">country</th>
                  <th className="py-1 pr-3 text-right">설치</th>
                  <th className="py-1 text-right">브라우저</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {data.installFallbackRows.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-800/60">
                    <td className="py-1 pr-3">{r.source ?? "—"}</td>
                    <td className="py-1 pr-3">{r.medium ?? "—"}</td>
                    <td className="py-1 pr-3">{r.campaign ?? "—"}</td>
                    <td className="py-1 pr-3">{r.country ?? "—"}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtInt(r.installs)}건
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtInt(r.browsers)}대
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-400">
            설치 축으로도 GA4 에 닿는 설치가 없습니다(브리지 ⋈ identity 0).
          </p>
        )}
      </div>
    </div>
  );
}
