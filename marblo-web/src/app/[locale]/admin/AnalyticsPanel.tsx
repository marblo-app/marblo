"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Gauge,
  Star,
  Tag,
  Lock,
  UserCheck,
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

// ── 베타 세그먼트 사용패턴 (getAdminBetaSegmentUsage) ───────────────────────
// 모수 = Firestore subscriptions.founderGrant===true(파운더/베타 grant 보유자).
// 관측 계정이 minCohortSize 미만인 세그먼트는 서버가 행동지표를 억제해서 내려준다
// (suppressed=true + 지표 null) — 프론트는 그 상태를 숨기지 않고 그대로 말한다.
type BetaFeatureUsage = { event: string; users: number; count: number };
type BetaSessionStats = {
  sessions: number;
  sessionsPerUser: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
};
type BetaRhythmStats = {
  avgActiveDays: number | null;
  returningUsers: number;
  returningRate: number | null;
  avgSpanDays: number | null;
};
type BetaAdoptionStats = {
  orchestratorUsers: number;
  spawnUsers: number;
  ticketUsers: number;
  orchestratorRate: number | null;
  spawnRate: number | null;
  ticketRate: number | null;
};
type BetaSegmentSummary = {
  key: string;
  label: string;
  cohortSize: number;
  observedUsers: number;
  observedRate: number | null;
  suppressed: boolean;
  suppressionReason: string | null;
  featureUsage: BetaFeatureUsage[];
  sessions: BetaSessionStats | null;
  rhythm: BetaRhythmStats | null;
  adoption: BetaAdoptionStats | null;
};
type BetaSegmentUsage = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded: AdminExcludedTelemetry;
  minCohortSize: number;
  grantCohortSize: number;
  observedUsers: number;
  accountAttributionAvailable: boolean;
  segments: BetaSegmentSummary[];
  all: BetaSegmentSummary;
};

// ── 온보딩 "첫 10분" 퍼널 (getAdminOnboardingFunnel) ─────────────────────────
type OnboardingFunnelStep = {
  key: string;
  event: string;
  label: string;
  kind: "reach" | "activation";
  /** 하류 이탈률의 기준선인가. false = 체인 밖(계측이 늦게 생겼거나 창이 다른 칸).
   *  구버전 functions 응답에는 없으므로 optional — 없으면 true 로 본다. */
  gating?: boolean;
  clients: number;
  events: number;
  dropFromPrev: number | null;
  dropRateFromPrev: number | null;
  /** 직전 gating 단계 대비 전환율(= 1 − dropRateFromPrev). 구버전은 미제공. */
  conversionFromPrev?: number | null;
  /** 최초 단계(설치) 대비 누적 전환율. 구버전은 미제공. */
  conversionFromStart?: number | null;
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
type QueryStatus = { ok: boolean; errors: { name: string; error: string }[] };
type OnboardingFunnel = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  /** 부분 쿼리 실패 상태. 구버전 functions 는 안 내려준다. */
  queryStatus?: QueryStatus;
  steps: OnboardingFunnelStep[];
  failureBranches: OnboardingFailureBranch[];
  headline?: ActivationHeadline;
  note: string;
};

// ── 활성화 게이트 + 리텐션 코호트 (getAdminRetentionCohorts) ─────────────────
// ★이 콜러블은 서버에 있는데 **웹이 호출조차 하지 않고 있었다** — 앱 설정의
// 어드민 탭이 제거되면서(#881) 이 축이 어디에도 안 보이게 됐다.
//
// 위 온보딩 퍼널과 다른 축이다: 여기는 events.metadata.accountUserId(계정
// identity)만 쓰고 익명 clientId 폴백을 하지 않는다. 그래서 accountUserId 주입이
// 시작된 시점 이전 구간은 구조적으로 비어 있다 — 화면이 그 사실을 말해야 한다
// (0 을 '아무도 안 왔다'로 읽으면 오독이다).
type ActivationGateStep = {
  key: string;
  event: string;
  label: string;
  users: number;
  dropFromPrev: number | null;
  dropRateFromPrev: number | null;
  isMaxDrop: boolean;
};
type RetentionCohort = {
  period: "day" | "week";
  cohort: string;
  cohortUsers: number;
  returningUsers: Record<string, number>;
  rates: Record<string, number | null>;
};
type RetentionCohorts = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  cohorts: { day: RetentionCohort[]; week: RetentionCohort[]; note: string };
  activationGate: {
    steps: ActivationGateStep[];
    maxDrop: ActivationGateStep | null;
    note: string;
  };
};

// ── KPI 코크핏 (getAdminKpiCockpit) — 지표기반 베타종료 게이지 + 신규 온보딩 ──
// 이벤트(설문·데모·동의·CLI셋업) + 재사용/리텐션 + 스폰 헬스. 서버 순수 빌더
// (adminAnalytics.buildKpiCockpit)의 응답 shape 미러. ★신규 이벤트는 3.0.19 전 값 0.
type BetaExitGauge = {
  key: string;
  label: string;
  unit: "rate" | "nps"; // rate=0~1 비율, nps=-100~100 점수
  current: number | null; // 분모/응답 0 이면 null ('데이터 대기')
  target: number;
  met: boolean;
  numerator: number;
  denominator: number;
};
type CliSetupPhaseCounts = { enter: number; success: number; fail: number };
type CliSetupStepSummary = {
  step: string;
  label: string;
  clients: CliSetupPhaseCounts;
  events: CliSetupPhaseCounts;
  successRate: number | null;
};
type NpsResult = {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  avgRating: number | null;
  byStar: Record<string, number>;
};
type KpiCockpit = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  /** 부분 쿼리 실패 상태. 구버전 functions 는 안 내려준다. */
  queryStatus?: QueryStatus;
  betaExitGauges: BetaExitGauge[];
  onboardingEvents: {
    cliSetup: CliSetupStepSummary[];
    survey: {
      nps: NpsResult;
      cliFailReasons: KeyCount[];
    };
    demo: {
      startedClients: number;
      completedClients: number;
      ctaClients: number;
      startedEvents: number;
      completedEvents: number;
      ctaEvents: number;
      completionRate: number | null;
      ctaRate: number | null;
    };
    consent: {
      shownClients: number;
      grantedClients: number;
      shownEvents: number;
      grantedEvents: number;
      grantRate: number | null;
    };
  };
  reuse: {
    weeklyActiveProjects: number;
    weeklyCompletedTasks: number;
    secondSessionClients: number;
    signupBase: number;
    secondSessionRate: number | null;
    avgDau: number;
    wau: number;
    stickiness: number | null;
  };
  spawnHealth: {
    spawned: number;
    crashed: number;
    restarted: number;
    completed: number;
    successRate: number | null;
    crashRate: number | null;
    avgRestartPerSpawn: number | null;
  };
  /**
   * 온보딩 스톨 요약(#888 buildOnboardingStallSummary) — "구독/크레딧/인증이
   * 없어 최초에 멈춘" 설치. 서버는 진작 계산해 내려주고 있었는데 이 화면에
   * 필드조차 없어 아무 데도 안 보였다(어드민 정본이 웹으로 옮겨온 뒤 생긴 공백).
   * 구버전 functions 는 null 을 준다.
   */
  onboardingStall?: {
    stalledClients: number;
    stalledRate: number | null;
    spawnBlocked: {
      clients: number;
      events: number;
      byReason: KeyCount[];
    };
    needsAuth: {
      clients: number;
      agents: number;
      resolvedAgents: number;
      /** 철회(오탐)를 뺀 값 — 진짜 "로그인 화면에서 죽은" 수. */
      unresolvedAgents: number;
      /** 철회 비율 = 오탐률. 높으면 백스톱 튜닝이 먼저다. */
      falsePositiveRate: number | null;
    };
    funding: {
      okClients: number;
      unfundedClients: number;
      blockedClients: number;
      inconclusiveClients: number;
      decidedClients: number;
      unfundedRate: number | null;
    };
    guideShown: { clients: number; events: number };
    note: string;
  } | null;
  /**
   * ★제로마찰 KPI(티켓 pWSnJeQN · 앵커 수정 Tw6m14gR) — 사장님 최중요 KPI 인
   * "**연결 후** 10분 안에 첫 multi-agent 성공" 과 그 주변(앞단 연결 퍼널·
   * 동시2+·주2회+·무료→유료). 서버 순수 빌더 buildZeroFrictionKpis 의 응답
   * shape 미러. 구버전 functions 는 null 또는 신규 칸 없이 준다.
   */
  zeroFriction?: {
    tenMinuteMultiAgent: {
      /** 시계 시작점. 구버전 functions 응답엔 없다. */
      anchor?: "model_connect";
      windowMinutes: number;
      withinClients: number;
      successClients: number;
      /** 연결 시계를 못 구한 설치(이 계측 이전부터 쓰던 설치). */
      noClockClients: number;
      base: number;
      rate: number | null;
      successRate: number | null;
      medianMs: number | null;
      label: string;
    };
    /** ★앞단(설치→모델 연결). 구버전 functions 는 안 내려준다. */
    connectFunnel?: {
      firstRunBase: number;
      connectedClients: number;
      connectRate: number | null;
      notConnectedClients: number;
      label: string;
    };
    /** 참고: first_run 기준(앞단 포함) 같은 KPI — 앵커 변경 전과 같은 축. */
    fromFirstRunReference?: {
      base: number;
      withinClients: number;
      noClockClients: number;
      rate: number | null;
      medianMs: number | null;
    };
    multiAgentUsage: {
      activeClients: number;
      activeEvents: number;
      successClients: number;
      successEvents: number;
      base: number;
      activeRate: number | null;
      successRate: number | null;
    };
    weeklyTwicePlus: { clients: number; base: number; rate: number | null };
    freeToPaid: {
      paidClients: number;
      base: number;
      signupBase: number;
      rate: number | null;
      rateOfSignups: number | null;
    };
    note: string;
  } | null;
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
  // 일별 × 모델 비용(기간별 분해). 구버전 functions 는 안 내려주므로 optional.
  costByDayModel?: {
    dates: string[];
    models: { model: string; total: number; share: number }[];
    /** models 순서와 1:1 대응하는 일자별 비용 행렬. */
    matrix: number[][];
    grandTotal: number;
    truncatedModels: number;
  };
  // ★하위모델 분해(하네스 → 구체 모델). 구버전 functions 는 안 내려준다.
  modelBreakdown?: {
    harnesses: {
      harness: string;
      agents: number;
      cost: number;
      tokens: number;
      costRows: number;
      share: number;
      subModels: {
        model: string;
        agents: number;
        cost: number;
        tokens: number;
        costRows: number;
        share: number;
        unattributed: boolean;
      }[];
      hasDecomposition: boolean;
    }[];
    totalCost: number;
    totalAgents: number;
    note: string;
  };
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

// ── 릴리스·버전 헬스 (getAdminReleaseHealth) ─────────────────────────────────
// ★앱 버전은 전용 이벤트가 아니라 events.appVersion **컬럼**에서 파생한다
// (`lifecycle:app-version` 같은 이벤트는 존재하지 않는다 — 서버 주석 참조).
type ReleaseHealth = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  versions: {
    version: string;
    isSemver: boolean;
    isCi: boolean; // github-actions = CI 스모크 발신(사용자 설치본 아님)
    clients: number;
    events: number;
    sessions: number;
    spawned: number;
    crashed: number;
    crashRate: number | null; // 스폰 0 이면 null("데이터 없음")
    firstSeen: string;
    lastSeen: string;
  }[];
  adoption: {
    dates: string[];
    series: { version: string; values: number[] }[];
  };
  totals: {
    versions: number;
    spawned: number;
    crashed: number;
    crashRate: number | null;
  };
  note: string;
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

// 다계열(누적막대) 카테고리 슬롯 — palette.md dark 열의 고정 순서.
// ★순환 금지: 슬롯이 모자라면 색을 만들어내지 않고 '그 외'로 접는다(서버의
// buildCostByDayModel 이 topN 으로 이미 접어 보낸다). 인접쌍 기준 CVD/명도 게이트를
// validate_palette.js 로 통과 확인함(dark, 7슬롯 ALL PASS).
const CATEGORICAL = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
] as const;
// 계열 인덱스 → 색. 엔티티 순서 고정 배정이라 필터로 계열 수가 바뀌어도
// 남은 계열의 색이 다시 칠해지지 않는다(색은 순위가 아니라 엔티티를 따른다).
function seriesColor(i: number): string {
  return CATEGORICAL[i] ?? INK_MUTED;
}

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
  if (err?.code === "functions/not-found")
    return "이 지표는 Cloud Functions 배포 후 표시됩니다(신규 함수 미배포).";
  if (err?.code === "functions/internal")
    return "지표 데이터를 불러오지 못했습니다. 서버 로그에서 BigQuery/Cloud Functions 오류를 확인해야 합니다.";
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
    // ★빈 화면일수록 배너가 필요하다 — 쿼리가 통째로 죽어도 여기로 떨어지므로,
    // 배너 없이 '이벤트 없음' 만 보여주면 장애를 데이터 공백으로 오독하게 된다.
    return (
      <div className="space-y-3">
        <QueryStatusBanner status={funnel.queryStatus} />
        <EmptyState label="온보딩 퍼널 이벤트가 없습니다 (해당 기간 미발화 또는 텔레메트리 공백)." />
      </div>
    );
  }

  const headline = funnel.headline;

  return (
    <div className="space-y-4">
      {/* ★부분 쿼리 실패는 '0' 이 아니라 '못 읽음' — 먼저 밝힌다. */}
      <QueryStatusBanner status={funnel.queryStatus} />
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
        note="설치 → 최초실행 → 로그인 → 폴더연결 → 오케오픈 → 첫대화 → 첫티켓 → 스폰 → (활성화) 첫 티켓 완료·첫 머지·핵심경험·7일 잔존 · 감소=이탈, 증가율=전환"
      >
        <div className="space-y-1">
          {steps.map((s, i) => {
            const widthPct = Math.round((s.clients / maxClients) * 100);
            const drop = s.dropFromPrev;
            const showDrop = i > 0 && drop != null && drop > 0;
            // 구버전 functions 응답(gating 미제공)은 전부 체인 칸으로 본다.
            const isGating = s.gating !== false;
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
                    {/* ★체인 밖 칸임을 화면에서도 밝힌다 — 이 칸의 감소를
                        "제품 누수"로 읽으면 안 된다(계측이 늦게 생겼거나
                        시간창이 다르다). 서버 note 와 같은 이야기. */}
                    {!isGating && (
                      <span
                        className="rounded bg-zinc-800 px-1 text-[9px] font-medium text-zinc-400"
                        title="참고 지표 — 뒤 단계의 이탈률 기준선으로 쓰이지 않습니다(계측 시점/시간창이 본선과 다름)."
                      >
                        참고
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
                      {/* 단계별 전환율(직전 gating 대비 · 시작 대비). 분모가 0 이면
                          서버가 null 을 주므로 0% 로 오도하지 않고 아예 감춘다. */}
                      {i > 0 && s.conversionFromPrev != null && (
                        <span className="ml-auto text-[11px] tabular-nums text-zinc-300">
                          전환 {fmtPct(s.conversionFromPrev)}
                          {s.conversionFromStart != null && (
                            <span
                              className="ml-1"
                              style={{ color: INK_MUTED }}
                              title="최초 단계(설치) 대비 누적 전환율"
                            >
                              · 누적 {fmtPct(s.conversionFromStart)}
                            </span>
                          )}
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

// ── 베타종료 게이지 카드 ─────────────────────────────────────────────────────
// 현재값 vs 목표를 선형 게이지로. 목표 마커(눈금)를 트랙 위에 표시하고, 달성 시
// 초록·미달 주황·데이터공백(current=null) 회색으로 상태를 색+텍스트로 이중표기한다.
// nps 단위는 -100~100 을 0~1 로 정규화해 같은 트랙에 그린다.
// 베타 세그먼트 — 억제된 세그먼트의 자리표시. 값을 0 으로 그리지 않는다.
function SuppressedBox({ reason }: { reason: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-3">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
      <p className="text-xs text-zinc-500">
        {reason || "표본이 작아 행동지표를 표시하지 않습니다."}
      </p>
    </div>
  );
}

// 세그먼트 1건 카드 — 코호트/관측은 항상, 행동지표는 억제 해제 시에만.
function BetaSegmentCard({ seg }: { seg: BetaSegmentSummary }) {
  const adoptionRows = seg.adoption
    ? [
        { key: "오케스트레이터", value: seg.adoption.orchestratorUsers },
        { key: "에이전트 스폰", value: seg.adoption.spawnUsers },
        { key: "티켓", value: seg.adoption.ticketUsers },
      ]
    : [];
  return (
    <Panel
      title={seg.label}
      note={`grant ${fmtInt(seg.cohortSize)}명 · 관측 ${fmtInt(
        seg.observedUsers
      )}명`}
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <StatCard
          label="관측률"
          value={seg.observedRate == null ? "—" : fmtPct(seg.observedRate)}
          sub="grant 대비 실사용 관측"
        />
        <StatCard
          label="재방문"
          value={
            seg.rhythm?.returningRate == null
              ? "—"
              : fmtPct(seg.rhythm.returningRate)
          }
          sub={
            seg.rhythm
              ? `활동일 2일+ ${fmtInt(seg.rhythm.returningUsers)}명`
              : "표본 대기"
          }
        />
      </div>
      {seg.suppressed ? (
        <SuppressedBox reason={seg.suppressionReason} />
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">
              기능 채택 (사용자 수)
            </p>
            <BarList data={adoptionRows} emptyLabel="채택 이벤트가 없습니다." />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">
              기능별 사용 (이벤트 종류별 사용자 수)
            </p>
            <BarList
              data={seg.featureUsage.map((f) => ({
                key: f.event,
                value: f.users,
              }))}
              color={SERIES_2}
              maxRows={8}
              emptyLabel="계정에 귀속된 이벤트가 없습니다."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="세션/인"
              value={
                seg.sessions?.sessionsPerUser == null
                  ? "—"
                  : seg.sessions.sessionsPerUser.toFixed(1)
              }
              sub={`총 ${fmtInt(seg.sessions?.sessions)}세션`}
            />
            <StatCard
              label="평균 세션길이"
              value={
                seg.sessions?.avgDurationMs == null
                  ? "—"
                  : fmtDuration(seg.sessions.avgDurationMs)
              }
              sub={
                seg.sessions?.medianDurationMs == null
                  ? "정상종료 표본"
                  : `중앙 ${fmtDuration(seg.sessions.medianDurationMs)}`
              }
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function BetaSegmentView({ data }: { data: BetaSegmentUsage }) {
  const all = data.all;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="grant 보유자"
          value={fmtInt(data.grantCohortSize)}
          sub="파운더·베타 (Firestore)"
        />
        <StatCard
          label="관측된 계정"
          value={fmtInt(data.observedUsers)}
          sub={`최근 ${data.rangeDays}일 텔레메트리`}
        />
        <StatCard
          label="관측률"
          value={all.observedRate == null ? "—" : fmtPct(all.observedRate)}
          sub="grant 를 준 사람 중 실사용"
          accent={
            all.observedRate != null && all.observedRate < 0.5
              ? STATUS_CRIT
              : undefined
          }
        />
        <StatCard
          label="최소 코호트"
          value={fmtInt(data.minCohortSize)}
          sub="미만이면 행동지표 비공개"
        />
      </div>

      {!data.accountAttributionAvailable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <strong>텔레메트리 ON 이 선행 조건입니다.</strong>{" "}
            기능사용·세션·채택 지표는 이벤트가 계정에 귀속돼야 나오는데(
            <code className="text-amber-300">metadata.accountUserId</code>),
            해당 필드는 2026-08-06 부터 적재되기 시작했고 프로덕션 텔레메트리는
            기본 OFF 입니다. 현재 이 구간의 grant 보유자 이벤트는 계정 귀속분이
            없어 값을 표시하지 않습니다 — 0 은 &ldquo;안 썼다&rdquo;가 아니라
            &ldquo;측정되지 않았다&rdquo;입니다. 위 grant/관측 카운트는
            Firestore·cost_logs 기반이라 텔레메트리와 무관하게 정확합니다.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BetaSegmentCard seg={all} />
        {data.segments.map((seg) => (
          <BetaSegmentCard key={seg.key} seg={seg} />
        ))}
      </div>

      <p className="text-xs text-zinc-600">
        프라이버시: 세그먼트 단위 집계만 표시하며 개별 계정 식별자는 서버 응답에
        포함되지 않습니다. 관측 계정이 {data.minCohortSize}명 미만인 세그먼트는
        행동지표를 표시하지 않습니다.
      </p>
    </>
  );
}

function GaugeCard({ gauge }: { gauge: BetaExitGauge }) {
  const isNps = gauge.unit === "nps";
  // 정규화(0~1). rate 는 그대로, nps 는 (-100~100)→(0~1).
  const norm = (v: number) => (isNps ? (v + 100) / 200 : v);
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const hasData = gauge.current != null;
  const fill = hasData ? clamp01(norm(gauge.current as number)) : 0;
  const targetPos = clamp01(norm(gauge.target));
  const valueText = !hasData
    ? "—"
    : isNps
    ? String(Math.round(gauge.current as number))
    : fmtPct(gauge.current);
  const targetText = isNps ? String(gauge.target) : fmtPct(gauge.target);
  const color = !hasData ? INK_MUTED : gauge.met ? STATUS_GOOD : STATUS_WARN;
  const statusText = !hasData ? "데이터 대기" : gauge.met ? "달성" : "미달";
  const subText = isNps
    ? `유효응답 ${fmtInt(gauge.numerator)}명`
    : `${fmtInt(gauge.numerator)} / ${fmtInt(gauge.denominator)}명`;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-zinc-400">{gauge.label}</p>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ color, backgroundColor: `${color}1f` }}
        >
          {statusText}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: hasData ? color : INK_MUTED }}
        >
          {valueText}
        </span>
        <span className="text-xs text-zinc-500">목표 {targetText}</span>
      </div>
      {/* 게이지 트랙 + 목표 마커 */}
      <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded bg-zinc-900">
        <div
          className="h-full rounded"
          style={{ width: `${fill * 100}%`, backgroundColor: color }}
        />
        {/* 목표 눈금 — 트랙 위 세로선(오버플로 방지 위해 트랙 밖에 절대배치) */}
      </div>
      <div className="relative h-0">
        <span
          className="absolute top-[-14px] block h-3.5 w-0.5 bg-zinc-400"
          style={{ left: `calc(${targetPos * 100}% - 1px)` }}
          title={`목표 ${targetText}`}
        />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-zinc-500">{subText}</p>
    </div>
  );
}

// CLI 셋업 위저드 단계별 성공/실패 미니 리스트.
function CliSetupList({ steps }: { steps: CliSetupStepSummary[] }) {
  const hasAny = steps.some(
    (s) => s.clients.enter > 0 || s.clients.success > 0 || s.clients.fail > 0
  );
  if (!hasAny) {
    return (
      <EmptyState label="CLI 셋업 이벤트가 없습니다 (3.0.19 이후 발화)." />
    );
  }
  return (
    <ul className="space-y-2.5">
      {steps.map((s) => {
        const enter = Math.max(1, s.clients.enter);
        const successPct = Math.round((s.clients.success / enter) * 100);
        const failPct = Math.round((s.clients.fail / enter) * 100);
        return (
          <li key={s.step}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="text-xs text-zinc-300">{s.label}</span>
              <span className="text-xs tabular-nums text-zinc-500">
                진입 {fmtInt(s.clients.enter)} · 성공률{" "}
                {s.successRate == null ? "—" : fmtPct(s.successRate)}
              </span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded bg-zinc-900">
              <div
                className="h-full"
                style={{
                  width: `${successPct}%`,
                  backgroundColor: STATUS_GOOD,
                }}
                title={`성공 ${fmtInt(s.clients.success)}`}
              />
              <div
                className="h-full"
                style={{ width: `${failPct}%`, backgroundColor: STATUS_CRIT }}
                title={`실패 ${fmtInt(s.clients.fail)}`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// 첫프로젝트 설문 별점(1~5) 히스토그램 + NPS 요약.
function SurveyStars({ nps }: { nps: NpsResult }) {
  if (nps.total === 0) {
    return (
      <EmptyState label="첫프로젝트 설문 응답이 없습니다 (3.0.19 이후)." />
    );
  }
  const stars = ["5", "4", "3", "2", "1"];
  const max = Math.max(1, ...stars.map((s) => nps.byStar[s] ?? 0));
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <div>
          <p className="text-2xl font-bold tabular-nums text-zinc-100">
            {nps.avgRating == null ? "—" : nps.avgRating.toFixed(2)}
          </p>
          <p className="text-[11px] text-zinc-500">평균 별점 (1~5)</p>
        </div>
        <div>
          <p
            className="text-2xl font-bold tabular-nums"
            style={{
              color:
                nps.nps == null
                  ? INK_MUTED
                  : nps.nps >= 40
                  ? STATUS_GOOD
                  : STATUS_WARN,
            }}
          >
            {nps.nps == null ? "—" : nps.nps}
          </p>
          <p className="text-[11px] text-zinc-500">
            NPS · 응답 {fmtInt(nps.total)}
          </p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {stars.map((s) => {
          const count = nps.byStar[s] ?? 0;
          const pct = Math.max((count / max) * 100, count > 0 ? 2 : 0);
          return (
            <li key={s} className="flex items-center gap-2">
              <span className="flex w-8 shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-zinc-400">
                {s}
                <Star className="h-3 w-3 fill-current text-amber-400" />
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-900">
                <div
                  className="h-full rounded"
                  style={{ width: `${pct}%`, backgroundColor: SERIES }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
                {fmtInt(count)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 활성화 게이트 + 리텐션 코호트 뷰 (계정 identity 축) ─────────────────────
function RetentionCohortsView({ data }: { data: RetentionCohorts }) {
  const gate = data.activationGate;
  const maxUsers = Math.max(1, ...gate.steps.map((s) => s.users));
  const gateEmpty = gate.steps.every((s) => s.users === 0);
  const cohorts = data.cohorts.week.length > 0 ? data.cohorts.week : [];
  const horizons: Array<["d1" | "d7" | "d14" | "d30", string]> = [
    ["d1", "D1"],
    ["d7", "D7"],
    ["d14", "D14"],
    ["d30", "D30"],
  ];
  return (
    <div className="space-y-4">
      <Panel
        title="순차 활성화 게이트 (계정 identity)"
        note="설치 → 최초실행 → 로그인 → 폴더연결 → 오케오픈 → 스폰 → 첫 티켓 완료"
      >
        {gateEmpty ? (
          <EmptyState label="계정 귀속(metadata.accountUserId) 이벤트가 이 기간에 없습니다 — 이 축은 계정 귀속이 붙은 이후 구간만 계산됩니다. 익명 clientId 기준 수치는 위 '온보딩 퍼널' 을 보세요." />
        ) : (
          <div className="space-y-1">
            {gate.steps.map((s, i) => {
              const widthPct = Math.round((s.users / maxUsers) * 100);
              const drop = s.dropFromPrev;
              return (
                <div key={s.key}>
                  {i > 0 && drop != null && drop > 0 && (
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
                    <div className="w-40 shrink-0 text-xs text-zinc-400">
                      {s.label}
                    </div>
                    <div className="relative h-7 flex-1 overflow-hidden rounded bg-zinc-900">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.max(widthPct, s.users > 0 ? 2 : 0)}%`,
                          backgroundColor: s.isMaxDrop ? STATUS_CRIT : SERIES,
                        }}
                      />
                      <div className="absolute inset-0 flex items-center px-2">
                        <span className="text-xs font-semibold tabular-nums text-zinc-100">
                          {fmtInt(s.users)}명
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{gate.note}</span>
        </p>
      </Panel>

      <Panel
        title="리텐션 코호트 (주간)"
        note="first-active 주 기준 · D1/D7/D14/D30 복귀율 · 관측창 미도달 칸은 —"
      >
        {cohorts.length === 0 ? (
          <EmptyState label="코호트가 없습니다 (계정 귀속 활동 표본 없음)." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 pr-3 text-left font-medium">코호트</th>
                  <th className="py-1 pr-3 text-right font-medium">인원</th>
                  {horizons.map(([, label]) => (
                    <th
                      key={label}
                      className="py-1 pr-3 text-right font-medium"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.cohort} className="border-t border-zinc-900">
                    <td className="py-1 pr-3 tabular-nums text-zinc-300">
                      {c.cohort}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-300">
                      {fmtInt(c.cohortUsers)}
                    </td>
                    {horizons.map(([h, label]) => {
                      const rate = c.rates?.[h];
                      return (
                        <td
                          key={label}
                          className="py-1 pr-3 text-right tabular-nums text-zinc-400"
                        >
                          {rate == null ? "—" : fmtPct(rate)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{data.cohorts.note}</span>
        </p>
      </Panel>
    </div>
  );
}

// ── 온보딩 스톨 카드 (#888) ─────────────────────────────────────────────────
// "구독/크레딧/인증이 없어 최초에 멈춘 설치"의 규모. 서버는 진작 내려주고 있었는데
// 화면이 없어 어디에도 안 보이던 축이다.
//
// 두 가지를 화면에서도 지킨다(서버 빌더와 같은 정직성 규약):
//  1) needsAuth 는 **철회 보정 후**(unresolvedAgents)를 크게 쓴다 — 인증 팝업
//     오탐을 스톨로 세면 오탐이 곧 문제 크기로 둔갑한다. 오탐률도 같이 보인다.
//  2) unfunded 비율의 분모는 판정이 난 설치(ok 포함)다. 분모 0 이면 0% 가 아니라
//     '데이터 대기'로 적는다.
function OnboardingStallCard({
  stall,
}: {
  stall: NonNullable<KpiCockpit["onboardingStall"]>;
}) {
  const na = stall.needsAuth;
  const fu = stall.funding;
  const hasAny =
    stall.stalledClients > 0 ||
    stall.spawnBlocked.clients > 0 ||
    na.agents > 0 ||
    fu.decidedClients > 0 ||
    stall.guideShown.clients > 0;
  return (
    <Panel
      title="온보딩 스톨 (인증·구독/크레딧에서 멈춘 설치)"
      note="스폰 사전차단 · CLI 로그인화면 정지(철회 보정) · 인증됐으나 미결제"
    >
      {!hasAny && (
        <div className="mb-3">
          <EmptyState label="스톨 신호 0건 — 해당 계측(3.0.24+)이 실린 빌드의 실사용 전이거나, 실제로 막힌 설치가 없습니다." />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="스톨 설치"
          value={fmtInt(stall.stalledClients)}
          sub={
            stall.stalledRate == null
              ? "가입 표본 없음 (데이터 대기)"
              : `가입 대비 ${fmtPct(stall.stalledRate)}`
          }
          accent={stall.stalledClients > 0 ? STATUS_CRIT : undefined}
        />
        <StatCard
          label="스폰 사전 차단"
          value={fmtInt(stall.spawnBlocked.clients)}
          sub={`${fmtInt(stall.spawnBlocked.events)}건 · 설치/인증/벤더 미비`}
        />
        <StatCard
          label="로그인화면 정지 (철회 제외)"
          value={fmtInt(na.unresolvedAgents)}
          sub={
            na.falsePositiveRate == null
              ? `발화 ${fmtInt(na.agents)} · 오탐률 —`
              : `발화 ${fmtInt(na.agents)} · 오탐 ${fmtPct(
                  na.falsePositiveRate
                )}`
          }
          accent={na.unresolvedAgents > 0 ? STATUS_WARN : undefined}
        />
        <StatCard
          label="인증됐으나 미결제"
          value={fu.unfundedRate == null ? "—" : fmtPct(fu.unfundedRate)}
          sub={`${fmtInt(fu.unfundedClients)} / 판정 ${fmtInt(
            fu.decidedClients
          )} (ok ${fmtInt(fu.okClients)})`}
          accent={
            fu.unfundedRate != null && fu.unfundedRate > 0
              ? STATUS_CRIT
              : undefined
          }
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="차단 사유 (errorCategory)"
          note="onboarding:spawn_blocked"
        >
          <BarList
            data={stall.spawnBlocked.byReason.map((r) => ({
              key: r.key,
              value: r.count,
            }))}
            color={STATUS_WARN}
            showShare
            emptyLabel="차단 사유 데이터가 없습니다."
          />
        </Panel>
        <Panel
          title="가이드 모달 노출 (눈으로 막힌 사람)"
          note="onboarding:funding_guide_shown · 판정과 따로 센다"
        >
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="본 설치"
              value={fmtInt(stall.guideShown.clients)}
            />
            <StatCard
              label="노출 횟수"
              value={fmtInt(stall.guideShown.events)}
            />
            <StatCard
              label="판정 불가"
              value={fmtInt(fu.inconclusiveClients)}
              sub="주장 아님 — 분모에서 제외"
            />
            <StatCard
              label="차단(요금제 있음 포함)"
              value={fmtInt(fu.blockedClients)}
            />
          </div>
        </Panel>
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{stall.note}</span>
      </p>
    </Panel>
  );
}

// ── ★제로마찰 KPI 카드 (티켓 pWSnJeQN) ──────────────────────────────────────
//
// 사장님이 가장 먼저 보는 수치라 코크핏 맨 위에 온다. 화면이 지키는 정직성 규약:
//  1) 분모를 항상 병기한다 — 10분 성공률·동시2+·무료→유료는 **최초 실행** 기준,
//     주2회+ 만 그 주의 활동 설치 기준이라 분모가 다르다. 안 적으면 네 수치를
//     같은 축으로 착각한다.
//  2) 분모 0 은 0% 가 아니라 '데이터 대기'다.
//  3) 계측이 새로 생겼다는 사실과 web 경계(방문→다운로드) 밖이라는 사실을 적는다.
function ZeroFrictionCard({
  zf,
}: {
  zf: NonNullable<KpiCockpit["zeroFriction"]>;
}) {
  const ten = zf.tenMinuteMultiAgent;
  const usage = zf.multiAgentUsage;
  const connect = zf.connectFunnel;
  const fromFirstRun = zf.fromFirstRunReference;
  const hasAny =
    ten.successClients > 0 ||
    usage.activeClients > 0 ||
    zf.freeToPaid.paidClients > 0 ||
    zf.weeklyTwicePlus.clients > 0;
  return (
    <Panel
      title="★제로마찰 핵심 KPI (연결 후 10분 내 첫 multi-agent 성공)"
      note="시계 시작 = 모델 연결 완료(= 실제로 에이전트를 스폰할 수 있게 된 순간) · 분모는 연결을 끝낸 설치다 — 연결 전 이탈은 '모델 연결 도달률' 칸에서 따로 본다"
    >
      {!hasAny && (
        <div className="mb-3">
          <EmptyState label="멀티에이전트 신호 0건 — 이 계측이 실린 빌드의 실사용 전이거나, 아직 아무도 2대를 동시에 굴리지 않았습니다." />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={`연결 후 ${ten.windowMinutes}분 내 첫 multi-agent 성공률`}
          value={ten.rate == null ? "—" : fmtPct(ten.rate)}
          sub={`${fmtInt(ten.withinClients)} / 모델 연결 ${fmtInt(
            ten.base
          )} · 연결→성공 중앙값 ${fmtDuration(ten.medianMs)}`}
          accent={
            ten.rate == null
              ? undefined
              : ten.rate >= 0.3
              ? STATUS_GOOD
              : STATUS_WARN
          }
        />
        {/* ★앞단(설치→연결). 여기서 죽은 사람은 위 KPI 의 실패가 아니라 앞단
            이탈이다 — 두 수를 나란히 두는 것이 이 카드의 요점이다. */}
        <StatCard
          label="모델 연결 도달률 (앞단)"
          value={
            connect == null || connect.connectRate == null
              ? "—"
              : fmtPct(connect.connectRate)
          }
          sub={
            connect == null
              ? "구버전 functions — 재배포 후 표시"
              : `${fmtInt(connect.connectedClients)} / 최초 실행 ${fmtInt(
                  connect.firstRunBase
                )} · 미연결 ${fmtInt(
                  connect.notConnectedClients
                )}명은 10분 분모 밖`
          }
        />
        <StatCard
          label="동시 2대+ 사용 설치"
          value={usage.activeRate == null ? "—" : fmtPct(usage.activeRate)}
          sub={`${fmtInt(usage.activeClients)} / 모델 연결 ${fmtInt(
            usage.base
          )} · 관측 ${fmtInt(usage.activeEvents)}회`}
        />
        <StatCard
          label="무료 → 유료 전환"
          value={zf.freeToPaid.rate == null ? "—" : fmtPct(zf.freeToPaid.rate)}
          sub={`${fmtInt(zf.freeToPaid.paidClients)} / 최초 실행 ${fmtInt(
            zf.freeToPaid.base
          )} · 가입 대비 ${
            zf.freeToPaid.rateOfSignups == null
              ? "—"
              : fmtPct(zf.freeToPaid.rateOfSignups)
          }`}
          accent={zf.freeToPaid.paidClients > 0 ? STATUS_GOOD : undefined}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="주 2회+ 사용"
          value={
            zf.weeklyTwicePlus.rate == null
              ? "—"
              : fmtPct(zf.weeklyTwicePlus.rate)
          }
          sub={`${fmtInt(zf.weeklyTwicePlus.clients)} / 최근 7일 활동 ${fmtInt(
            zf.weeklyTwicePlus.base
          )}명 (분모 다름)`}
        />
        <StatCard
          label="첫 성공 도달(창 무관)"
          value={ten.successRate == null ? "—" : fmtPct(ten.successRate)}
          sub={`${fmtInt(ten.successClients)}명 · ${
            ten.windowMinutes
          }분 밖 성공 포함`}
        />
        <StatCard
          label="동시 2대+ 에서의 성공"
          value={fmtInt(usage.successClients)}
          sub={`설치 · 발생 ${fmtInt(usage.successEvents)}회(완료·머지)`}
        />
        <StatCard
          label="연결 시계 없음"
          value={fmtInt(ten.noClockClients)}
          sub="연결 스탬프 이전 설치 — 소요시간을 지어내지 않음"
        />
        {/* 앵커 변경 전과 같은 축(앞단 포함). 두 수의 차이가 곧 '설치→연결'
            구간이 KPI 를 얼마나 눌렀는지다. */}
        <StatCard
          label="참고: 최초 실행 기준"
          value={
            fromFirstRun == null || fromFirstRun.rate == null
              ? "—"
              : fmtPct(fromFirstRun.rate)
          }
          sub={
            fromFirstRun == null
              ? "구버전 functions — 재배포 후 표시"
              : `${fmtInt(fromFirstRun.withinClients)} / 최초 실행 ${fmtInt(
                  fromFirstRun.base
                )} · 중앙값 ${fmtDuration(fromFirstRun.medianMs)}`
          }
        />
        <StatCard
          label="목표창"
          value={`${ten.windowMinutes}분`}
          sub="시작점 = 모델 연결 완료(스폰 게이트 통과 · CLI 인증 · 펀딩 프로브 ok)"
        />
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{zf.note}</span>
      </p>
    </Panel>
  );
}

// ── KPI 코크핏 뷰 (베타종료 게이지 + 온보딩 이벤트 + 재사용 + 스폰 헬스) ──────
function KpiCockpitView({ kpi }: { kpi: KpiCockpit }) {
  const { onboardingEvents: onb, reuse, spawnHealth: spawn } = kpi;
  const demo = onb.demo;
  const consent = onb.consent;
  return (
    <div className="space-y-4">
      <QueryStatusBanner status={kpi.queryStatus} />
      {/* ★제로마찰 핵심 KPI(pWSnJeQN) — 맨 위. 사장님이 가장 먼저 보는 수치다. */}
      {kpi.zeroFriction && <ZeroFrictionCard zf={kpi.zeroFriction} />}
      {/* ★온보딩 스톨(#888) — 퍼널 바로 옆에 있어야 "왜 안 넘어갔나"가 읽힌다. */}
      {kpi.onboardingStall && (
        <OnboardingStallCard stall={kpi.onboardingStall} />
      )}

      {/* ★베타종료 게이지 6종 */}
      <Panel
        title="베타종료 게이지 (현재값 vs 목표)"
        note="활성화 전략 메모의 지표기반 종료 기준. 분모 0 게이지는 '데이터 대기'."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kpi.betaExitGauges.map((g) => (
            <GaugeCard key={g.key} gauge={g} />
          ))}
        </div>
      </Panel>

      {/* 재사용·리텐션 + 스폰 헬스 카드 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="주간 활성 프로젝트"
          value={fmtInt(reuse.weeklyActiveProjects)}
          sub="최근 7일 distinct projectId"
        />
        <StatCard
          label="주간 완료 티켓"
          value={fmtInt(reuse.weeklyCompletedTasks)}
          sub="최근 7일 task:completed"
        />
        <StatCard
          label="2번째 세션 도달률"
          value={
            reuse.secondSessionRate == null
              ? "—"
              : fmtPct(reuse.secondSessionRate)
          }
          sub={`${fmtInt(reuse.secondSessionClients)} / ${fmtInt(
            reuse.signupBase
          )}명`}
        />
        <StatCard
          label="DAU/WAU 끈적임"
          value={reuse.stickiness == null ? "—" : fmtPct(reuse.stickiness)}
          sub={`평균 DAU ${fmtInt(reuse.avgDau)} · WAU ${fmtInt(reuse.wau)}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="스폰 성공률"
          value={spawn.successRate == null ? "—" : fmtPct(spawn.successRate)}
          sub={`완료 ${fmtInt(spawn.completed)} vs 크래시 ${fmtInt(
            spawn.crashed
          )}`}
          accent={
            spawn.successRate == null
              ? undefined
              : spawn.successRate >= 0.7
              ? STATUS_GOOD
              : STATUS_WARN
          }
        />
        <StatCard
          label="크래시율"
          value={spawn.crashRate == null ? "—" : fmtPct(spawn.crashRate)}
          sub={`크래시 ${fmtInt(spawn.crashed)} / 스폰 ${fmtInt(
            spawn.spawned
          )}`}
          accent={
            spawn.crashRate != null && spawn.crashRate > 0
              ? STATUS_CRIT
              : undefined
          }
        />
        <StatCard
          label="평균 재시작/스폰"
          value={
            spawn.avgRestartPerSpawn == null
              ? "—"
              : spawn.avgRestartPerSpawn.toFixed(2)
          }
          sub={`재시작 ${fmtInt(spawn.restarted)}회`}
        />
        <StatCard
          label="총 스폰"
          value={fmtInt(spawn.spawned)}
          sub={`agent:spawned / ${kpi.rangeDays}일`}
        />
      </div>

      {/* 신규 온보딩 이벤트: CLI셋업 · 설문 · 데모 · 동의 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="CLI 셋업 위저드 단계"
          note="notice → connect(인증) → project(폴더연결·오케실행) · 초록=성공·빨강=실패"
        >
          <CliSetupList steps={onb.cliSetup} />
        </Panel>
        <Panel
          title="첫프로젝트 만족도 (별점·NPS)"
          note="survey_first_project · 5=추천·4=중립·1~3=비추"
        >
          <SurveyStars nps={onb.survey.nps} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="샘플 데모 퍼널"
          note="시작 → 완주 → 연결 CTA (인증 전 Demo Mode)"
        >
          <ul className="space-y-2.5">
            {(
              [
                ["데모 시작", demo.startedClients, SERIES],
                ["데모 완주", demo.completedClients, SERIES_2],
                ["연결 CTA 클릭", demo.ctaClients, STATUS_GOOD],
              ] as const
            ).map(([label, value, color]) => {
              const base = Math.max(1, demo.startedClients);
              const pct = Math.max((value / base) * 100, value > 0 ? 2 : 0);
              return (
                <li key={label}>
                  <div className="mb-0.5 flex items-baseline justify-between gap-2">
                    <span className="text-xs text-zinc-300">{label}</span>
                    <span className="text-xs tabular-nums text-zinc-400">
                      {fmtInt(value)}명
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded bg-zinc-900">
                    <div
                      className="h-full rounded"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] tabular-nums text-zinc-500">
            완주율{" "}
            {demo.completionRate == null ? "—" : fmtPct(demo.completionRate)} ·
            CTA전환 {demo.ctaRate == null ? "—" : fmtPct(demo.ctaRate)}
          </p>
        </Panel>
        <Panel
          title="마케팅 수신 동의"
          note="marketing_consent_shown → granted"
        >
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <div>
                <p className="text-2xl font-bold tabular-nums text-zinc-100">
                  {consent.grantRate == null ? "—" : fmtPct(consent.grantRate)}
                </p>
                <p className="text-[11px] text-zinc-500">동의율</p>
              </div>
              <p className="text-xs tabular-nums text-zinc-500">
                {fmtInt(consent.grantedClients)} /{" "}
                {fmtInt(consent.shownClients)}명
              </p>
            </div>
          </div>
        </Panel>
        <Panel
          title="CLI 실패 사유 (마이크로설문)"
          note="survey_cli_fail · 5초 사유"
        >
          <BarList
            data={onb.survey.cliFailReasons.map((r) => ({
              key: r.key,
              value: r.count,
            }))}
            color={STATUS_WARN}
            showShare
            emptyLabel="CLI 실패 설문 응답이 없습니다."
          />
        </Panel>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{kpi.note}</span>
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
  const [kpi, setKpi] = useState<Loaded<KpiCockpit>>({
    data: null,
    loading: true,
    error: null,
  });
  const [release, setRelease] = useState<Loaded<ReleaseHealth>>({
    data: null,
    loading: true,
    error: null,
  });
  const [betaSeg, setBetaSeg] = useState<Loaded<BetaSegmentUsage>>({
    data: null,
    loading: true,
    error: null,
  });
  const [retention, setRetention] = useState<Loaded<RetentionCohorts>>({
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
      const callKpi = httpsCallable<
        { days: number; includeAdmin: boolean },
        KpiCockpit
      >(fns, "getAdminKpiCockpit");
      const callRelease = httpsCallable<
        { days: number; includeAdmin: boolean },
        ReleaseHealth
      >(fns, "getAdminReleaseHealth");
      const callBetaSeg = httpsCallable<
        { days: number; includeAdmin: boolean },
        BetaSegmentUsage
      >(fns, "getAdminBetaSegmentUsage");
      const callRetention = httpsCallable<
        { days: number; includeAdmin: boolean },
        RetentionCohorts
      >(fns, "getAdminRetentionCohorts");

      setBiz((s) => ({ ...s, loading: true, error: null }));
      setUsage((s) => ({ ...s, loading: true, error: null }));
      setModel((s) => ({ ...s, loading: true, error: null }));
      setOnbFunnel((s) => ({ ...s, loading: true, error: null }));
      setKpi((s) => ({ ...s, loading: true, error: null }));
      setRelease((s) => ({ ...s, loading: true, error: null }));
      setBetaSeg((s) => ({ ...s, loading: true, error: null }));
      setRetention((s) => ({ ...s, loading: true, error: null }));

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
      callKpi({ days: d, includeAdmin: inc })
        .then((r) => setKpi({ data: r.data, loading: false, error: null }))
        .catch((e) =>
          setKpi({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      callRelease({ days: d, includeAdmin: inc })
        .then((r) => setRelease({ data: r.data, loading: false, error: null }))
        .catch((e) =>
          setRelease({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      callBetaSeg({ days: d, includeAdmin: inc })
        .then((r) => setBetaSeg({ data: r.data, loading: false, error: null }))
        .catch((e) =>
          setBetaSeg({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      callRetention({ days: d, includeAdmin: inc })
        .then((r) =>
          setRetention({ data: r.data, loading: false, error: null })
        )
        .catch((e) =>
          setRetention({
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
    biz.loading ||
    usage.loading ||
    model.loading ||
    onbFunnel.loading ||
    kpi.loading;

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

      {/* ── ★KPI 코크핏: 베타종료 게이지·재사용·스폰·신규 온보딩 이벤트 (🟡) ── */}
      <div className="space-y-4">
        <SectionHeader
          icon={Gauge}
          title="지표기반 베타종료 · 활성화 코크핏"
          trust="yellow"
        />
        {kpi.loading ? (
          <LoadingBox />
        ) : kpi.error ? (
          <ErrorBox msg={kpi.error} />
        ) : kpi.data ? (
          <KpiCockpitView kpi={kpi.data} />
        ) : null}
      </div>

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

      {/* ── 베타 세그먼트 사용패턴 (🟡 grant 모수는 🟢) ──────────────
          "grant 를 준 사람들이 실제로 쓰는가". 모수(grant 명단)와 관측 카운트는
          Firestore/cost_logs 라 항상 정확하고, 기능사용·세션·채택만 텔레메트리에
          걸린다 — 그래서 섹션 신뢰도는 🟡 로 두되 카드가 둘을 구분해 말한다. */}
      <div className="space-y-4">
        <SectionHeader
          icon={UserCheck}
          title="베타 세그먼트 사용패턴"
          trust="yellow"
        >
          {betaSeg.data && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-1 text-xs text-zinc-400">
              <Lock className="h-3.5 w-3.5" />
              최소 코호트 {fmtInt(betaSeg.data.minCohortSize)}명 가드
            </span>
          )}
        </SectionHeader>
        {betaSeg.loading ? (
          <LoadingBox />
        ) : betaSeg.error ? (
          <ErrorBox msg={betaSeg.error} />
        ) : betaSeg.data ? (
          <BetaSegmentView data={betaSeg.data} />
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

      {/* ── 활성화 게이트 · 리텐션 코호트 (🟡, 계정 identity 축) ───────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={Activity}
          title="활성화 게이트 · 리텐션 코호트"
          trust="yellow"
        />
        {retention.loading ? (
          <LoadingBox />
        ) : retention.error ? (
          <ErrorBox msg={retention.error} />
        ) : retention.data ? (
          <RetentionCohortsView data={retention.data} />
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

                {/* 기간별 모델 분해 — 위 '일별 비용 추이'는 총합이라 어느 모델이
                    그날 비용을 만들었는지 못 본다. 구버전 functions 응답에는
                    없는 필드라 optional 가드(배포순서 soft-fail). */}
                {m.costByDayModel && (
                  <Panel
                    title="일별 모델별 비용"
                    note={
                      m.costByDayModel.truncatedModels > 0
                        ? `상위 ${
                            m.costByDayModel.models.length - 1
                          }종 + 그 외 ${
                            m.costByDayModel.truncatedModels
                          }종 (총합 보존)`
                        : `모델 ${m.costByDayModel.models.length}종 (cost_logs)`
                    }
                  >
                    <StackedBarChart
                      dates={m.costByDayModel.dates}
                      series={m.costByDayModel.models.map((mm, i) => ({
                        key: mm.model,
                        values: m.costByDayModel!.matrix[i] ?? [],
                      }))}
                      format={fmtCost}
                      emptyLabel="비용 데이터가 없습니다."
                      onDrill={(date) =>
                        openDrill({ scope: "cost:day", date, days })
                      }
                    />
                  </Panel>
                )}

                {/* ★하위모델 분해 — 스폰축(하네스)과 비용축(구체 모델)의 해상도
                    차이를 agentId 조인으로 메운다. */}
                {m.modelBreakdown && (
                  <Panel
                    title="하네스 → 하위모델 분해"
                    note="스폰(events.model=하네스) × 비용(cost_logs.model=구체 모델) agentId 조인"
                  >
                    <SubModelBreakdownTable
                      harnesses={m.modelBreakdown.harnesses}
                      onDrill={(key) =>
                        openDrill({ scope: "segment:model", key, days })
                      }
                    />
                    <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                      {m.modelBreakdown.note}
                    </p>
                  </Panel>
                )}

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

      {/* ── 릴리스·버전 헬스 (🟡 BQ events.appVersion) ─────────────── */}
      <div className="space-y-4">
        <SectionHeader icon={Tag} title="릴리스·버전 헬스" trust="yellow" />
        {release.loading ? (
          <LoadingBox />
        ) : release.error ? (
          <ErrorBox msg={release.error} />
        ) : release.data ? (
          <ReleaseHealthView data={release.data} />
        ) : null}
      </div>

      {/* ── 안정성 상세 (🔴 Sentry 선행) ──────────────────────────── */}
      {/* 위 릴리스 섹션이 채우는 것은 **에이전트 크래시 이벤트**(agent:crashed)
          기반 버전별 안정성이다. 앱 자체의 예외/스택트레이스 집계는 Sentry
          연동이 선행이라 여전히 비어 있다 — 두 개를 한 칸으로 합치지 않는다. */}
      <div className="space-y-4">
        <SectionHeader
          icon={ShieldOff}
          title="앱 예외·스택트레이스"
          trust="red"
        />
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-10 text-center">
          <ShieldOff className="h-6 w-6 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-400">
            어드민 대시보드 연동 대기
          </p>
          <p className="max-w-md text-xs text-zinc-600">
            앱의 Sentry 크래시 리포팅은 DSN 이 설정되어 있고 사용자 동의 시
            동작합니다. 다만 이 패널이 Sentry API 에서 지표를 읽어오는 연동은
            아직 구현되지 않아 표시할 수치가 없습니다. 예외/스택트레이스 단위
            지표는 sentry.io 프로젝트에서 확인하세요. (버전별 에이전트
            크래시율은 위 &ldquo;릴리스·버전 헬스&rdquo; 섹션이 텔레메트리로
            이미 보여줍니다.)
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

// 누적 막대 — 하나의 총량을 카테고리(모델/버전)로 쪼개 일자별로 본다.
// 단일 y축(이중축 금지). 계열 색은 CATEGORICAL 고정 배정이고, 범례가 항상 있어
// 식별이 색에만 의존하지 않는다. 세그먼트 사이에는 2px 서피스 간격을 둔다.
function StackedBarChart({
  dates,
  series,
  format = fmtInt,
  emptyLabel,
  onDrill,
}: {
  dates: string[];
  series: { key: string; values: number[] }[];
  format?: (n: number) => string;
  emptyLabel?: string;
  onDrill?: (date: string) => void;
}) {
  const n = dates.length;
  // 일자별 총합 — y 스케일과 빈 상태 판정의 기준.
  const totals = dates.map((_, i) =>
    series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0)
  );
  const max = Math.max(...totals, 0);
  if (n === 0 || series.length === 0 || max <= 0) {
    return <EmptyState label={emptyLabel} />;
  }

  const W = 720;
  const H = 220;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const x = (i: number) => padL + slot * i + slot / 2;
  const yOf = (v: number) => padT + innerH - (v / max) * innerH;
  // x축 라벨은 처음/중간/끝만(라벨 충돌 방지).
  const labelIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="일자별 누적 분해 차트"
      >
        {/* 눈금선 — 배경으로 물러나게(recessive) */}
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={padL}
            x2={W - padR}
            y1={padT + innerH * t}
            y2={padT + innerH * t}
            stroke="#27272a"
            strokeWidth={1}
          />
        ))}
        {[1, 0.5, 0].map((t) => (
          <text
            key={t}
            x={padL - 8}
            y={padT + innerH * (1 - t) + 4}
            textAnchor="end"
            className="fill-zinc-600"
            fontSize={10}
          >
            {format(max * t)}
          </text>
        ))}

        {dates.map((d, i) => {
          // 아래에서 위로 쌓는다. 세그먼트 사이 2px 간격은 높이에서 빼서 만든다.
          let acc = 0;
          return (
            <g key={d}>
              {series.map((ser, si) => {
                const v = ser.values[i] ?? 0;
                if (v <= 0) return null;
                const y0 = yOf(acc);
                const y1 = yOf(acc + v);
                acc += v;
                const h = Math.max(1, y0 - y1 - 2); // 2px 서피스 간격
                return (
                  <rect
                    key={ser.key}
                    x={x(i) - barW / 2}
                    y={y1}
                    width={barW}
                    height={h}
                    rx={2}
                    fill={seriesColor(si)}
                  >
                    <title>{`${fmtDay(d)} · ${ser.key} ${format(v)}`}</title>
                  </rect>
                );
              })}
              {/* 컬럼 전체 히트 타깃 — 막대보다 크게 잡아 총합 툴팁/드릴다운 제공 */}
              <rect
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={innerH}
                fill="transparent"
                className={onDrill ? "cursor-pointer" : undefined}
                onClick={onDrill ? () => onDrill(d) : undefined}
              >
                <title>{`${fmtDay(d)} · 합계 ${format(totals[i])}`}</title>
              </rect>
            </g>
          );
        })}

        {labelIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 10}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            className="fill-zinc-600"
            fontSize={10}
          >
            {fmtDay(dates[i])}
          </text>
        ))}
      </svg>

      {/* 범례 — 2계열 이상이면 항상 표시(색 단독 식별 금지) */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((ser, si) => (
          <li key={ser.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: seriesColor(si) }}
              aria-hidden
            />
            <span className="text-zinc-400">{ser.key}</span>
            <span className="tabular-nums text-zinc-500">
              {format(ser.values.reduce((a, b) => a + b, 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 하위모델 분해표 — 하네스(스폰축) 행 아래에 구체 모델(비용축) 행을 들여쓴다.
// ★두 축의 해상도가 달라서 필요한 표다(서버 buildModelBreakdown 주석 참조):
// env-swap 벤더는 우리 claude 바이너리를 그대로 쓰므로 하네스 축만 보면
// Anthropic 과 한 칸에 섞인다.
function SubModelBreakdownTable({
  harnesses,
  onDrill,
}: {
  harnesses: NonNullable<ModelSummary["modelBreakdown"]>["harnesses"];
  onDrill?: (model: string) => void;
}) {
  if (harnesses.length === 0) {
    return <EmptyState label="스폰-비용 조인 결과가 없습니다." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="py-2 pr-4 font-medium">하네스 / 구체 모델</th>
            <th className="py-2 pr-4 text-right font-medium">에이전트</th>
            <th className="py-2 pr-4 text-right font-medium">토큰</th>
            <th className="py-2 pr-4 text-right font-medium">비용</th>
            <th className="py-2 font-medium">비중</th>
          </tr>
        </thead>
        <tbody>
          {harnesses.map((h) => (
            <Fragment key={h.harness}>
              <tr className="border-b border-zinc-800/60 bg-zinc-900/30">
                <td className="py-2 pr-4 font-medium text-zinc-100">
                  {h.harness}
                  {!h.hasDecomposition && (
                    <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal text-zinc-400">
                      구체 모델 미기록
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-300">
                  {fmtInt(h.agents)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                  {fmtInt(h.tokens)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-200">
                  {fmtCost(h.cost)}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-900">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.round(h.share * 100)}%`,
                          backgroundColor: SERIES,
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-zinc-400">
                      {fmtPct(h.share)}
                    </span>
                  </div>
                </td>
              </tr>
              {h.subModels.map((s) => (
                <tr
                  key={`${h.harness}-${s.model}`}
                  className="border-b border-zinc-800/40 last:border-0"
                >
                  <td className="py-1.5 pr-4 pl-6 text-zinc-300">
                    <span className="mr-1.5 text-zinc-600">└</span>
                    {s.unattributed ? (
                      <span className="text-zinc-500">
                        {s.model}
                        <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          모델 미기록
                        </span>
                      </span>
                    ) : onDrill ? (
                      <button
                        type="button"
                        onClick={() => onDrill(s.model)}
                        className="rounded underline decoration-dotted underline-offset-2 transition hover:text-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {s.model}
                      </button>
                    ) : (
                      s.model
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-500">
                    {fmtInt(s.agents)}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-500">
                    {fmtInt(s.tokens)}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-400">
                    {fmtCost(s.cost)}
                  </td>
                  <td className="py-1.5 text-xs tabular-nums text-zinc-500">
                    {s.costRows === 0 ? "비용 미적재" : fmtPct(s.share)}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 릴리스·버전 헬스 — 버전별 채택/크래시율 표 + 일자별 버전 채택 추이.
function ReleaseHealthView({ data }: { data: ReleaseHealth }) {
  const { versions, adoption, totals } = data;
  // 실사용 릴리스만(=CI 스모크·미기록 제외)으로 헤드라인을 낸다.
  const realReleases = versions.filter((v) => v.isSemver);
  const latest = realReleases[0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="관측 버전"
          value={fmtInt(totals.versions)}
          sub={`실사용 릴리스 ${realReleases.length}종`}
        />
        <StatCard
          label="최신 릴리스"
          value={latest ? latest.version : "—"}
          sub={latest ? `클라이언트 ${fmtInt(latest.clients)}` : "semver 없음"}
        />
        <StatCard
          label="전체 크래시율"
          value={totals.crashRate == null ? "—" : fmtPct(totals.crashRate)}
          sub={`크래시 ${fmtInt(totals.crashed)} / 스폰 ${fmtInt(
            totals.spawned
          )}`}
          accent={
            totals.crashRate == null
              ? undefined
              : totals.crashRate >= 0.2
              ? STATUS_CRIT
              : totals.crashRate >= 0.05
              ? STATUS_WARN
              : STATUS_GOOD
          }
        />
        <StatCard
          label="최신 릴리스 크래시율"
          value={latest?.crashRate == null ? "—" : fmtPct(latest.crashRate)}
          sub={latest ? `스폰 ${fmtInt(latest.spawned)}` : "데이터 없음"}
        />
      </div>

      <Panel
        title="버전별 채택 추이"
        note="일자별 고유 클라이언트 수 (events.appVersion 컬럼 파생)"
      >
        <StackedBarChart
          dates={adoption.dates}
          series={adoption.series.map((s) => ({
            key: s.version,
            values: s.values,
          }))}
          format={fmtInt}
          emptyLabel="이 구간에 버전 관측이 없습니다."
        />
      </Panel>

      <Panel
        title="버전별 안정성"
        note="크래시율 = agent:crashed / agent:spawned"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="py-2 pr-4 font-medium">버전</th>
                <th className="py-2 pr-4 text-right font-medium">클라이언트</th>
                <th className="py-2 pr-4 text-right font-medium">세션</th>
                <th className="py-2 pr-4 text-right font-medium">스폰</th>
                <th className="py-2 pr-4 text-right font-medium">크래시</th>
                <th className="py-2 pr-4 font-medium">크래시율</th>
                <th className="py-2 font-medium">관측 기간</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr
                  key={v.version}
                  className="border-b border-zinc-800/60 last:border-0"
                >
                  <td className="py-2 pr-4 text-zinc-200">
                    {v.version}
                    {v.isCi && (
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        CI 발신
                      </span>
                    )}
                    {!v.isSemver && !v.isCi && (
                      <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        버전 미주입
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                    {fmtInt(v.clients)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                    {fmtInt(v.sessions)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                    {fmtInt(v.spawned)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                    {fmtInt(v.crashed)}
                  </td>
                  <td className="py-2 pr-4">
                    {v.crashRate == null ? (
                      // 스폰 0 → 0% 가 아니라 "데이터 없음"(0% 로 오도 금지)
                      <span className="text-xs text-zinc-600">데이터 없음</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-900">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(v.crashRate * 100)
                              )}%`,
                              backgroundColor:
                                v.crashRate >= 0.2
                                  ? STATUS_CRIT
                                  : v.crashRate >= 0.05
                                  ? STATUS_WARN
                                  : STATUS_GOOD,
                            }}
                          />
                        </div>
                        <span className="tabular-nums text-zinc-300">
                          {fmtPct(v.crashRate)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-xs tabular-nums text-zinc-500">
                    {v.firstSeen && v.lastSeen
                      ? `${fmtDay(v.firstSeen)} – ${fmtDay(v.lastSeen)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-xs leading-relaxed text-zinc-600">{data.note}</p>
    </div>
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

/**
 * 부분 실패 배너 — 콜러블은 성공했지만 **일부 BigQuery 쿼리가 죽은** 경우.
 *
 * 서버 러너(runAdminAnalyticsQueries)는 개별 쿼리 실패를 삼키고 빈 배열을 준다.
 * 섹션 전체가 에러로 뜨지 않는 대신, 그 칸이 "정말 0" 인지 "쿼리가 죽어서 0" 인지
 * 화면에서 구분이 안 됐다 — 어드민이 '수치가 안 변한다' 고 본 자리가 여기다.
 * 응답에 queryStatus 가 없는 구버전 functions 면 아무것도 그리지 않는다.
 */
function QueryStatusBanner({
  status,
}: {
  status?: { ok: boolean; errors: { name: string; error: string }[] } | null;
}) {
  if (!status || status.ok || status.errors.length === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-amber-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-xs">
        <p className="font-medium">
          일부 쿼리가 실패했습니다 — 아래 수치 중 일부는 0 이 아니라 &quot;못
          읽음&quot; 입니다.
        </p>
        <ul className="mt-1 space-y-0.5 text-amber-400/80">
          {status.errors.map((e) => (
            <li key={e.name}>
              <span className="font-mono">{e.name}</span>: {e.error}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
