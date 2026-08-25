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
  Globe,
  Repeat,
  CreditCard,
  Database,
  TriangleAlert,
  Link2,
  Unlink,
} from "lucide-react";
import {
  describeGa4BridgeFreshness,
  type Ga4BridgeFreshness,
} from "./ga4BridgeFreshness";
import { MultiSeriesChart, TimeSeriesChart } from "@/components/charts";

// ── 콜러블 응답 타입 (docs/analytics-admin-callables-api.md 미러) ───────────────
type KeyCount = { key: string; count: number };

// 운영자(존킴) 자기계정 제외 현황. 서버는 제외 "건수"만 내려준다(uid 미노출).
type AdminExcludedFirestore = {
  subscriptions: number;
  billingCharges: number;
  founders: number;
  agents: number;
};
export type AdminExcludedTelemetry = {
  // 이번 응답에 운영자 제외가 실제로 적용됐는지(includeAdmin 토글 상태의 반영).
  // 구버전 functions 는 이 필드를 안 내려주므로 optional — 없으면 제외로 간주.
  applied?: boolean;
  uidFiltered: boolean;
  clientIdCount: number;
  /**
   * ★조회창 안에 `metadata.accountUserId` 가 **남아 있는 행 수**(실측).
   *
   * events 제외절은 그 필드로만 거르는데 계정축 은퇴로 신규 row 에는 필드가 없다 —
   * 즉 `applied:true` 여도 실제로는 한 행도 안 빠질 수 있다. 0 이면 화면이
   * "제외됨" 이라고 말하면 안 된다. 구버전 functions 는 안 내려주므로 optional.
   */
  matchableRows?: number | null;
};

// ── 베타 세그먼트 사용패턴 (getAdminBetaSegmentUsage) ───────────────────────
// 모수 = Firestore subscriptions.founderGrant===true(파운더/베타 grant 보유자).
// 관측 계정이 minCohortSize 미만인 세그먼트는 서버가 행동지표를 억제해서 내려준다
// (suppressed=true + 지표 null) — 프론트는 그 상태를 숨기지 않고 그대로 말한다.
//
// ★events 계정축 은퇴(eventAxisRetired): 이벤트를 grant 계정에 귀속시키던
// metadata.accountUserId(=Firebase uid) 부착을 프라이버시 결정으로 중단했다.
// 그래서 기능사용·세션·기능채택 3종은 **영구히** 비어 있고, 화면은 그것을
// "텔레메트리 ON 하면 채워진다" 가 아니라 "이 축은 더 이상 측정하지 않는다" 로
// 그려야 한다. 남는 축(관측률·재방문 리듬)은 cost_logs 기반이라 그대로 유효하다.
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
  /** 구버전 functions 는 안 내려준다 — 없으면 기존 "측정 대기" 안내로 폴백. */
  eventAxisRetired?: boolean;
  eventAxisRetiredOn?: string;
  segments: BetaSegmentSummary[];
  all: BetaSegmentSummary;
};

// ── 온보딩 "첫 10분" 퍼널 (getAdminOnboardingFunnel) ─────────────────────────
export type OnboardingFunnelStep = {
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
  /**
   * ★이 칸의 `clients` 를 믿어도 되는가(ticket 4KqBDPkH). 구버전 응답은 미제공.
   *   'missing' — 그 이벤트가 **전기간 한 번도** 관측된 적 없다 → '미수집'.
   *   'partial' — 처음 관측된 날이 조회창 시작보다 늦다 → 창 앞부분엔 신호가 없다.
   * 이 둘의 0 은 "안 했다"가 아니라서 숫자로 그리면 거짓말이 된다.
   */
  coverage?: "ok" | "partial" | "missing";
  /** 그 이벤트가 전기간 처음 **관측된** 날(YYYY-MM-DD). 전기간 0건이면 null. */
  firstObservedDay?: string | null;
  /**
   * 순차 체인을 무시하고 조회창 안에 그 이벤트를 낸 고유 설치 수(BigQuery 실측).
   * `clients` 와 벌어지면 그 0 은 정의의 한계지 제품 실패가 아니다.
   */
  everInWindow?: number | null;
};
// ★헤드라인 — 가입 후 30분 내 첫 티켓 완료 활성화율.
type ActivationHeadline = {
  activatedClients: number;
  baseClients: number;
  rate: number | null;
  windowMinutes: number;
  label: string;
  /**
   * ★같은 창에서 `task:completed` 를 실제로 낸 고유 설치 수(실측).
   * 0% 가 "아무도 완주 안 했다" 로 읽히는 걸 막는 유일한 근거다 — 로그인이 창
   * 밖인 설치는 분모에 없기 때문에 분자도 0 이 된다. 구버전 응답은 미제공.
   */
  everActivatedInWindow?: number | null;
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
export type OnboardingFunnel = {
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
// 위 온보딩 퍼널과 다른 축이다: 여기는 계정 identity 만 쓰고 익명 설치 ID 폴백을
// 하지 않는다. 그 계정 identity 는 events.metadata.accountUserId 였는데, 계정축
// 은퇴(프라이버시 결정)로 그 필드 부착이 끊겼다 — 즉 이 축은 **은퇴일 이전
// 구간에서만** 채워지고 이후로는 구조적으로 비어 간다. 화면이 그 사실을 말해야
// 한다(0 을 '아무도 안 왔다'로 읽으면 오독이다). 설치 단위 동일 퍼널은 위
// '온보딩 퍼널'이 계속 온전하게 보여 준다.
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
export type RetentionCohorts = {
  rangeDays: number;
  generatedAt: string;
  adminExcluded?: AdminExcludedTelemetry;
  cohorts: { day: RetentionCohort[]; week: RetentionCohort[]; note: string };
  activationGate: {
    steps: ActivationGateStep[];
    maxDrop: ActivationGateStep | null;
    note: string;
  };
  /** ★선행 티켓이 실어 보낼 사람 축 커버리지. 없으면 배선 전이다. */
  personAxis?: PersonAxisCoverage | null;
};

// ── D7·D14 리텐션 + 연속사용 스트릭 (getAdminStreakRetention) ────────────────
// 사장님이 D7·D14 를 "매우 중요한 지표" 라고 했는데 지금까지 이 숫자는 사람이 BQ 를
// 직접 쳐야만 나왔다. 서버 순수 빌더(adminAnalytics.buildStreakRetention)의 응답
// 미러다.
//
// ★이 화면의 가장 큰 위험은 작은 표본을 퍼센트로 크게 보여주는 것이다. 실측 계정이
// 5개, 유의미 사용이 2개다 — "50%" 라고만 띄우면 2명짜리 표본에 확신이 생긴다.
// 그래서 서버는 rate 단독 필드를 주지 않고 언제나 분자/분모를 함께 준다. 화면도
// 분수를 크게, 퍼센트를 작게 그린다(그 반대가 아니다).
export type RetentionCountedRate = {
  numerator: number;
  denominator: number;
  /** 분모 0 이면 null — 0% 가 아니라 '판단 불가'다. */
  rate: number | null;
  display: string;
};
export type StreakRetentionHorizon = {
  key: "d1" | "d7" | "d14" | "d30";
  days: number;
  /** 아직 D+N 일이 오지 않아 판정 불가한 유닛 수. 분모에서 빠져 있다. */
  pending: number;
  exact: RetentionCountedRate;
  window: RetentionCountedRate;
};
export type StreakUnit = {
  label: string;
  axis: "install" | "account";
  firstActive: string | null;
  lastActive: string | null;
  activeDays: number;
  workingDays: number;
  presentDays: number;
  maxStreak: number;
  currentStreak: number;
  daysSinceLastActive: number | null;
  grid: string;
  gridStart: string;
  gridEnd: string;
  zombie: boolean;
  adminExcluded: boolean;
  legacyIdScheme: boolean;
  suspectedIdSwitchChurn: boolean;
  inCohortWindow: boolean;
  mappedAccountLabel: string | null;
  mappingStatus: "mapped" | "ambiguous" | "unmapped" | "n/a";
};
export type StreakRetentionAxis = {
  axis: "install" | "account";
  activityDefinition: string;
  gridLegend: string;
  gridDays: number;
  cohortWindowDays: number;
  unitsObserved: number;
  unitsZombie: number;
  unitsAdminExcluded: number;
  unitsBeforeWindow: number;
  unitsCohort: number;
  horizons: StreakRetentionHorizon[];
  units: StreakUnit[];
  identityScheme: {
    date: string;
    legacyUnits: number;
    currentUnits: number;
    suspectedIdSwitchChurn: number;
    note: string;
  };
  mapping: {
    mappedInstalls: number;
    ambiguousInstalls: number;
    unmappedInstalls: number;
    note: string;
  } | null;
  notes: string[];
};
type StreakRetention = {
  rangeDays: number;
  generatedAt: string;
  historyDays: number;
  adminExcluded?: AdminExcludedTelemetry;
  install: StreakRetentionAxis;
  account: StreakRetentionAxis;
  /** ★선행 티켓이 실어 보낼 사람 축 커버리지. 없으면 배선 전이다. */
  personAxis?: PersonAxisCoverage | null;
};
// ── 설치축 리텐션 요약 (getAdminInstallRetentionSummary) ─────────────────────
// 파생표 `analytics_install_profile` 의 분자·분모 롤업. 서버 순수 빌더
// (analyticsProfiles.summarizeInstallRetention)의 응답 미러다.
//
// ★이 축이 따로 있는 이유. 스트릭 뷰의 설치축은 **조회 구간의 코호트**만 보고,
//   이쪽은 **프로필 전량**을 본다 — 그래서 "다운로드만 하고 한 번도 안 켠 설치"
//   가 여기서만 보인다. 두 수를 같은 표에 섞지 않는다.
//
// ★좀비 격리. `installsNeverActive` 를 하나로 그리면 원인이 사라진다 —
//   좀비(하트비트만 있고 working 0)는 프로세스가 떠 있던 것이고, neverRan 은
//   사람이 아예 안 온 것이다. 원인이 다르면 할 일도 다르므로 나눠서 그린다.
type InstallRetentionHorizon = {
  key: "d1" | "d3" | "d7" | "d14" | "d30";
  days: number;
  /** 판정 불가(관측창 미도달)로 분모에서 뺀 설치 수. */
  pending: number;
  exact: RetentionCountedRate;
  window: RetentionCountedRate;
};
export type InstallRetentionSummary = {
  /** 프로필 전체 설치 수(좀비·무활동 포함). */
  installsObserved: number;
  /** 활동일이 0인 설치 = 아래 둘의 합. 합쳐 그리지 않는다(원인이 다르다). */
  installsNeverActive: number;
  /** 하트비트는 왔는데 working·이벤트가 0 인 설치(떠 있던 프로세스). */
  installsZombie: number;
  /** 어트리뷰션만 있고 활동 신호가 아예 없는 설치(다운로드 후 미실행). */
  installsNeverRan: number;
  /** 첫 활동일이 있어 코호트에 들어간 설치 수. ★모든 분모의 뿌리. */
  installsCohort: number;
  horizons: InstallRetentionHorizon[];
  activityDefinition: string;
  presentOnlyDefinition: string;
  horizonDefinitions: string;
  notes: string[];
  /**
   * ★선행 티켓(표·뷰 생성 + 링크 MERGE 배선)이 실어 보낼 사람 축 커버리지.
   * 없으면 상태가 아니라 **배선 전**이다 — 화면은 그때 '적재 전' 으로 접는다.
   */
  personAxis?: PersonAxisCoverage | null;
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
      /**
       * 차단 사유 **정규 어휘** 분해(#iyxb4KsJ). byReason 이 차단을 내린 코드의
       * 원어휘라면 이쪽은 "무엇을 고쳐야 하나" 의 축이다 — 구독 공백이 몇 명인지가
       * 여기서만 보인다. 구버전 functions 는 이 필드를 안 준다.
       */
      byBlockReason?: Array<{ key: string; count: number; clients: number }>;
      noSubscriptionClients?: number;
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

type AdSpendPlatform =
  | "google_ads"
  | "meta"
  | "youtube"
  | "instagram"
  | "facebook"
  | "threads"
  | "manual";

type ManualAdSpendForm = {
  spendDate: string;
  platform: AdSpendPlatform;
  campaignName: string;
  currency: "KRW";
  amountKrw: string;
};

type CacCampaignSummary = {
  campaignKey: string;
  campaignName: string;
  spendKrw: number;
  acquired: number;
  cacKrw: number | null;
};

type CacSummary = {
  matchedSpendKrw: number;
  unmatchedSpendKrw: number;
  acquiredFromMatchedCampaigns: number;
  overallCacKrw: number | null;
  campaigns: CacCampaignSummary[];
  unmatched: CacCampaignSummary[];
  notes: string[];
};

type AdminCacSummary = {
  generatedAt: string;
  state: "ingested" | "not_ingested";
  reason?: string;
  basis: string;
  summary: CacSummary | null;
};

type AddManualAdSpendResult = {
  ok: boolean;
  id: string;
  campaignKey: string | null;
  amountKrw: number;
  note: string;
};

type LoadAdSpendResult = {
  ok: boolean;
  scanned: number;
  merged: number;
  skipped: number;
  table: string;
  note: string;
};

type AdSpendMatchStatus =
  | { kind: "idle"; message: string }
  | { kind: "matched"; message: string }
  | { kind: "unmatched"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

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

// ── 국가·채널 퍼널 (getAdminCountryFunnel) ─────────────────────────────────
// 조인키는 익명 GA4 client_id 하나이고 Firebase uid 는 쓰지 않는다(티켓
// rPVkmOKG + woXp2c70). 서버가 GA4(서울)와 앱 텔레메트리(US)에 각각 쿼리를
// 던져 **메모리에서** 조인한다 — BigQuery 는 리전이 다르면 한 쿼리로 못 잇는다.
/**
 * 봇 판정문(getAdminCountryFunnel.suspectedTraffic). 서버 botTraffic.ts 의
 * 출력이며 **국가 차단 목록이 아니다** — 코호트의 device×browser×os 집중도와
 * 다운로드 0 이라는 행동 축으로만 판정한다.
 */
type SuspectCohort = {
  cohort: string;
  visitors: number;
  downloads: number;
  downloaders: number;
  judgedVisitors: number;
  unresolvedVisitors: number;
  distinctFingerprints: number;
  topFingerprint: string | null;
  topFingerprintVisitors: number;
  topFingerprintShare: number | null;
  suspected: boolean;
  suspectedVisitors: number;
  reason: string;
};
type SuspectedTraffic = {
  rule: {
    cohortAxis: string;
    minCohortVisitors: number;
    signatureShare: number;
    fingerprintAxes: string[];
    derived: boolean;
  };
  cohorts: SuspectCohort[];
  suspectedCohorts: SuspectCohort[];
  totals: {
    visitors: number;
    suspectedVisitors: number;
    qualifiedVisitors: number;
    downloads: number;
    downloaders: number;
    suspectedCohorts: number;
  };
  notes: string[];
};

type CountryFunnelRow = {
  key: string;
  label: string;
  source?: string;
  medium?: string;
  /** ★의심을 **뺀** 방문. 뺀 값은 버려지지 않고 suspectedVisitors 로 남는다. */
  visitors: number;
  /** 단일지문 집중 유입 — 구버전 함수면 undefined(0 이라고 단정하지 않는다). */
  suspectedVisitors?: number;
  /** visitors + suspectedVisitors. GA4 원본과 대조할 때 쓰는 값. */
  observedVisitors?: number;
  downloads: number;
  installs: number;
  connected: number;
  activated10m: number;
  // 분모가 0 이면 null — "0%"(=실패)와 "모름"을 구분한다.
  downloadRate: number | null;
  installRate: number | null;
  connectRate: number | null;
  activationRate: number | null;
  anomaly: boolean;
};
type CountryFunnel = {
  rangeDays: number;
  includeAdmin: boolean;
  generatedAt: string;
  join: {
    strategy: string;
    webRegion: string;
    appRegion: string;
    webVisitors: number;
    webRegionError: string | null;
    appRegionError: string | null;
  };
  /** 없으면 구버전 함수 — 미적재라고 단정하지 않는다. */
  ga4Bridge?: Ga4BridgeFreshness;
  /** 표의 기본 분모. 방문이 아니라 다운로드다(ticket IU1KDbYAv7FEewPkwHPU). */
  primaryDenominator?: string;
  /**
   * ★봇 판정문 — **파생**이다. 서버가 매 조회마다 다시 계산하며 원장에는
   * bot 플래그가 없다. 없으면 구버전 함수이므로 "봇 0" 이라고 단정하지 않는다.
   */
  suspectedTraffic?: SuspectedTraffic;
  byCountry: CountryFunnelRow[];
  byChannel: CountryFunnelRow[];
  totals: CountryFunnelRow;
  coverage: {
    installs: number;
    withGaClientId: number;
    matchedToWeb: number;
    matchRate: number | null;
  };
  notes: string[];
};

// ── ★통합 뷰 위의 획득 축 (getAdminInstallUnified) ─────────────────────────
//
// 계약 정본은 서버의 `v3/functions/src/adminInstallUnified.ts` 다. 이 타입들은
// 그것의 거울이고, **여기서 숫자를 만들지 않는다** — 화면은 GROUP BY 된 결과를
// 그리기만 한다. 화면이 다시 세는 순간 계획 §0 의 병(집계가 16곳에서 따로 돎)이
// 그대로 재발한다.
//
// ★이름을 새로 짓지 않았다. 컬럼명 정본은
//   v3/docs/install-unified-view-2026-08-24.md(#1196) 다.

/** ★분자·분모를 **둘 다** 싣는다. 퍼센트만 오면 분모를 화면에서 복원할 수 없다. */
export type UnifiedRatio = {
  numerator: number;
  denominator: number;
  /** 분모가 0 이거나 표본 하한 미만이면 null. ★0 이 아니다. */
  rate: number | null;
  /** 서버가 판정한 표본 부족. 화면은 퍼센트 대신 '표본 부족' 을 쓴다. */
  smallSample: boolean;
};

/** 사유가 "모른다" 인가 "안다, 없었다" 인가. 이 구분이 채널 판단을 뒤집는다. */
export type UnifiedReasonKind = "unknown" | "true_zero" | "known";
export type UnifiedRevenueReasonKind =
  | "pre_ingestion"
  | "unknown"
  | "true_zero"
  | "known";

export type InstallHygiene = {
  installsTotal: number;
  /** ★분모의 정본 — 개발·dev 태깅을 뺀 설치. */
  installsExternal: number;
  installsDev: number;
  /** 사람 추정치 하한 = 고유 브라우저(gaKey) 수. */
  humanEstimateMin: number;
  /** 상한 = 하한 + 브라우저를 모르는 설치. ★폭 자체가 "아직 못 센다" 는 정보다. */
  humanEstimateMax: number;
  unknownBrowserInstalls: number;
  byInstallClass: Array<{ installClass: string; installs: number }>;
  /** 한 브라우저가 만든 최대 설치 수(#1198 ft_browser_installs). */
  maxInstallsPerBrowser: number | null;
  hygieneMissingReason: string | null;
};

export type AcquisitionChannelRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  installs: number;
  spawned: UnifiedRatio;
  completed: UnifiedRatio;
};

export type AcquisitionMissingReasonRow = {
  reason: string;
  kind: UnifiedReasonKind;
  label: string;
  /** ★이 사유가 많으면 **우리가 무엇을 하나**. */
  action: string;
  hasGa4Row: boolean;
  installs: number;
};

export type AcquisitionCountryRow = {
  country: string | null;
  installs: number;
  channelKnown: UnifiedRatio;
  spawned: UnifiedRatio;
};

export type UnifiedActivationSummary = {
  spawned: UnifiedRatio;
  completed: UnifiedRatio;
  medianMinutesToFirstSpawn: number | null;
  medianMinutesToFirstSpawnReason: string | null;
  channelRows: Array<{
    source: string | null;
    medium: string | null;
    campaign: string | null;
    installs: number;
    spawned: UnifiedRatio;
    completed: UnifiedRatio;
  }>;
  channelRowsTruncated: boolean;
};

export type UnifiedRetentionHorizonKey = "d1" | "d7" | "d14" | "d30";

export type UnifiedRetentionHorizon = {
  key: UnifiedRetentionHorizonKey;
  retained: UnifiedRatio | null;
  pending: number;
};

export type UnifiedRetentionCohortRow = {
  cohortWeek: string;
  installs: number;
  horizons: UnifiedRetentionHorizon[];
};

export type UnifiedRetentionChannelRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  installs: number;
  d7: UnifiedRatio | null;
  d30: UnifiedRatio | null;
  pendingD7: number;
  pendingD30: number;
};

export type UnifiedRetentionPersonAxis = {
  installs: number;
  humanEstimateMin: number;
  humanEstimateMax: number;
  identityLinked: UnifiedRatio | null;
  multiInstallPeople: number;
  maxInstallsPerBrowser: number | null;
};

export type UnifiedRetentionZombieSummary = {
  activeInstalls: number;
  observedInstalls: number;
  zombieInstalls: number;
  neverRanInstalls: number;
};

export type UnifiedRetentionSummary = {
  d7: UnifiedRatio | null;
  d30: UnifiedRatio | null;
  pendingD7: number;
  pendingD30: number;
  cohortRows: UnifiedRetentionCohortRow[];
  cohortRowsTruncated: boolean;
  channelRows: UnifiedRetentionChannelRow[];
  channelRowsTruncated: boolean;
  personAxis: UnifiedRetentionPersonAxis | null;
  zombie: UnifiedRetentionZombieSummary | null;
};

export type UnifiedRevenueMissingReasonRow = {
  reason: string | null;
  kind: UnifiedRevenueReasonKind;
  label: string;
  action: string;
  installs: number;
};

export type UnifiedRevenueChannelRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  installs: number;
  purchasers: number;
  ledgerRevenueKrw: number | null;
  ga4RevenueKrw: number | null;
  revenueDivergenceReason: string | null;
};

export type UnifiedRevenueSummary = {
  ledger: {
    externalKrw: number | null;
    externalRows: number;
    currency: string | null;
    missingReason: string | null;
  };
  ga4: {
    revenueKrw: number | null;
    purchaseEvents: number;
    currency: string | null;
    missingReason: string | null;
  };
  classification: {
    totalRows: number;
    externalPaidRows: number;
    externalPaidKrw: number | null;
    externalProvider: string | null;
    internalPaidRows: number;
    grantRows: number;
    unclassifiedRows: number;
    amountUnknownRows: number;
  };
  installToPurchase: UnifiedRatio | null;
  missingReasonRows: UnifiedRevenueMissingReasonRow[];
  channelRows: UnifiedRevenueChannelRow[];
  channelRowsTruncated: boolean;
  revenueDivergenceReason: string | null;
  notes: string[];
};

export type AcquisitionUnified = {
  generatedAt: string;
  /** ★`unavailable` 일 때 0 을 그리지 않는다. */
  state: "ready" | "unavailable";
  reason: string | null;
  source: string;
  rangeDays: number;
  smallSampleMinDenominator: number;
  headline: {
    hygiene: InstallHygiene;
    channelKnown: UnifiedRatio;
    spawned: UnifiedRatio;
  } | null;
  channelRows: AcquisitionChannelRow[];
  channelRowsTruncated: boolean;
  missingReasonRows: AcquisitionMissingReasonRow[];
  countryRows: AcquisitionCountryRow[];
  countryRowsTruncated: boolean;
  installsByDay: Array<{ date: string; installs: number; channelKnown: number }>;
  activation?: UnifiedActivationSummary;
  retention?: UnifiedRetentionSummary;
  revenue?: UnifiedRevenueSummary;
  /** 뷰에 아직 없어 **화면이 대신 계산하지 않는** 파생 컬럼들(계획 §3-3). */
  pendingColumns: Array<{ column: string; blocks: string }>;
  notes: string[];
};

/**
 * 브리지 마지막 동기 시각. 빈 표가 '유입 0' 인지 '미적재' 인지 가른다.
 */
export function Ga4BridgeFreshnessNote({
  data,
}: {
  data: Ga4BridgeFreshness | null | undefined;
}) {
  const copy = describeGa4BridgeFreshness(data);
  if (!copy) return null;
  const tone =
    copy.tone === "ok"
      ? "border-zinc-800 bg-zinc-900/40 text-zinc-300"
      : "border-amber-900/50 bg-amber-950/20 text-amber-100";
  return (
    <div
      data-testid="ga4-bridge-freshness"
      className={`rounded-lg border p-3 text-xs leading-relaxed ${tone}`}
    >
      <p className="font-medium">{copy.headline}</p>
      <p className="mt-1 opacity-90">{copy.detail}</p>
    </div>
  );
}

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────
function fmtInt(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}
function fmtKrw(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return `₩${fmtInt(n)}`;
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "0.0%";
  return `${(n * 100).toFixed(1)}%`;
}
// 분모가 없어 계산 자체가 불가능한 전환율. fmtPct 와 달리 "0.0%" 로 눕히지
// 않는다 — 그러면 "아무도 넘어가지 못했다"로 읽힌다.
function fmtRate(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
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

export const AD_SPEND_PLATFORM_OPTIONS: {
  value: AdSpendPlatform;
  label: string;
}[] = [
  { value: "google_ads", label: "Google Ads" },
  { value: "meta", label: "Meta" },
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "threads", label: "Threads" },
  { value: "manual", label: "Manual" },
];

function todayKstDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function normalizeCampaignKeyForAdmin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? null : normalized;
}

function findCampaignMatch(summary: CacSummary | null, campaignName: string) {
  const campaignKey = normalizeCampaignKeyForAdmin(campaignName);
  if (!summary || !campaignKey) return null;
  const matched =
    summary.campaigns.find((c) => c.campaignKey === campaignKey) ?? null;
  const unmatched =
    summary.unmatched.find((c) => c.campaignKey === campaignKey) ?? null;
  return { campaignKey, matched, unmatched };
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
// ★시계열 위의 경계선. 06-13 식별자 교체처럼 "선 왼쪽과 오른쪽이 같은 단위가
// 아니다" 를 말하는 자리다 — 색·툴팁에만 의존하지 않도록 라벨을 선 옆에 박는다.
function ChartMarkerLine({
  cx,
  top,
  bottom,
  marker,
}: {
  cx: number;
  top: number;
  bottom: number;
  marker: ChartMarker;
}) {
  return (
    <g>
      <line
        x1={cx}
        x2={cx}
        y1={top}
        y2={bottom}
        stroke="#7dd3fc"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text x={cx + 4} y={top + 9} fontSize={9} fontWeight={600} fill="#7dd3fc">
        {marker.label}
      </text>
      <title>{marker.hint ?? marker.label}</title>
    </g>
  );
}

function LineChart({
  data,
  color = SERIES,
  format = fmtInt,
  emptyLabel,
  onDrill,
  marker,
}: {
  data: { date: string; value: number }[];
  color?: string;
  format?: (n: number) => string;
  emptyLabel?: string;
  onDrill?: (date: string) => void;
  marker?: ChartMarker;
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
  const mIdx = markerIndex(
    clean.map((d) => d.date),
    marker
  );

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
        {mIdx != null && marker && (
          <ChartMarkerLine
            cx={x(mIdx)}
            top={padT}
            bottom={padT + innerH}
            marker={marker}
          />
        )}
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
  marker,
}: {
  data: { date: string; first: number; second: number }[];
  first: { label: string; color: string; format?: (n: number) => string };
  second: { label: string; color: string; format?: (n: number) => string };
  emptyLabel?: string;
  onDrill?: (date: string) => void;
  marker?: ChartMarker;
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
  const mIdx = markerIndex(
    clean.map((d) => d.date),
    marker
  );

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
        {mIdx != null && marker && (
          <ChartMarkerLine
            cx={x(mIdx)}
            top={padT}
            bottom={padT + innerH}
            marker={marker}
          />
        )}
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

// ── ★식별자 스킴 교체 경계 ──────────────────────────────────────────────────
// 2026-06-13 에 설치/계정 식별자 스킴이 바뀌었다. 그 앞뒤를 한 선 위에서 그대로
// 이어 읽으면 "이탈"로 보이는 낙차가 실제로는 id 가 갈린 자리다. 시계열에는 그
// 날짜에 세로선을 긋고, 선 왼쪽과 오른쪽을 같은 유닛으로 취급하지 않는다.
const ID_SCHEME_SWITCH_DATE = "2026-06-13";
export type ChartMarker = { date: string; label: string; hint?: string };
export const ID_SCHEME_MARKER: ChartMarker = {
  date: ID_SCHEME_SWITCH_DATE,
  label: "06-13 식별자 교체",
  hint:
    "2026-06-13 식별자 스킴 교체 경계. 이 선 왼쪽 유닛과 오른쪽 유닛은 같은 " +
    "id 체계가 아니다 — 선 근처의 낙차는 이탈이 아니라 id 가 바뀐 것일 수 있다.",
};

/** 시계열 x 인덱스 중 마커를 그릴 자리. 구간 밖이면 null(선을 긋지 않는다). */
export function markerIndex(
  dates: string[],
  marker: ChartMarker | undefined
): number | null {
  if (!marker) return null;
  const idx = dates.findIndex((d) => d >= marker.date);
  // idx<=0 이면 조회 구간 전체가 교체 이후 — 경계선이 화면 밖이라 긋지 않는다.
  if (idx <= 0) return null;
  return idx;
}

// ── ★분자/분모 규약 ────────────────────────────────────────────────────────
// 이 화면의 가장 큰 실패 모드는 두 명짜리 표본을 "50%" 로 크게 띄우는 것이다.
// 그래서 분수를 크게, 퍼센트를 그 옆 작은 글씨로 그린다(그 반대가 아니다).
// 분모가 0 이면 "0.0%" 가 아니라 "—" 다 — 실패가 아니라 판단할 표본이 없다는 뜻.
/** 이 수 이하의 분모는 "작은 표본" 으로 보고 화면이 경고를 띄운다. */
const SMALL_SAMPLE_MAX = 10;

// ── ★분자 > 분모 방어 — 막는 자리는 렌더 직전이 아니라 **나누기 그 자체**다 ──
//
// 실화면에서 코크핏 '모델 연결 도달 (앞단)' 이 9/7 = 128.6% 로 나왔다. 두 수는
// 서로 다른 이벤트에서, 서로 다른 창으로 온다:
//   · 분자 `connectedClients`(= d_model_connected) 는 정본 앵커 + 하위호환 두
//     신호의 **합집합**이라, 이 조회 구간 밖에서 이미 연결을 끝낸 설치까지 센다.
//   · 분모 `firstRunBase`(= d_first_run_base) 는 이 구간에 `app:first_run` 을
//     찍은 설치만 센다.
// 그래서 분자가 분모를 넘는 것은 고장이 아니라 **정상적으로 일어나는 일**이다.
// 서버(buildZeroFrictionKpis)는 이미 앞단 이탈을 `Math.max(0, ...)` 로 자르며
// 그 사실을 인정하고 있는데, **비율은 안 잘랐다** — 그 구멍으로 128.6% 가 화면까지
// 왔다.
//
// ★그래서 여기서 막는다. 아래 `ratioVerdict` 가 이 화면에서 n/d 를 나누는 유일한
//   자리이고, 나눌 수 없는 두 수는 나누기 전에 '비교 불가' 로 갈린다.
//
// ★clamp 하지 않는다. 128.6% 를 100% 로 눕히는 것은 **수치를 고치는 것**이라 더
//   나쁘다 — 없던 상한을 지어내고, 다음 사람이 "100% 달성" 으로 읽는다.
// ★분수는 남긴다. 9/7 을 지우면 측정값을 숨기는 것이다. 퍼센트만 내지 않는다.
// ★빈칸으로 두지 않는다. 빈칸은 고장으로 읽힌다 — 대신 '비교 불가' 라고 쓴다.
export type RatioVerdict =
  | { kind: "ok"; rate: number }
  /** 분모가 0 이거나 없다 — 실패가 아니라 판단할 표본이 없다. */
  | { kind: "no-denominator" }
  /** 분자 > 분모 — 두 수의 모집단·관측창이 다르다. 나누면 안 된다. */
  | { kind: "incomparable" };

/** 나눌 수 없는 두 수 자리에 그리는 말. 빈칸도 0% 도 아니다. */
export const RATIO_INCOMPARABLE_LABEL = "비교 불가";

/** 왜 퍼센트가 없는지. 툴팁으로 붙어 화면이 스스로 설명한다. */
export const RATIO_INCOMPARABLE_HINT =
  "분자가 분모보다 큽니다 — 두 수가 서로 다른 모집단(또는 서로 다른 관측창)에서 " +
  "왔다는 뜻이라 나눌 수 없습니다. 분수는 그대로 둡니다: 지우면 측정값을 숨기는 " +
  "것이고, 나누면 없는 비율을 지어내는 것입니다.";

/**
 * ★이 화면에서 분자/분모를 **나누는 유일한 자리**. 퍼센트가 필요한 곳은 전부
 * 여기를 거친다 — 두 벌로 나누면 한쪽에만 방어가 붙고 다른 쪽으로 새어 나간다.
 */
export function ratioVerdict(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): RatioVerdict {
  const n = numerator ?? 0;
  const d = denominator ?? 0;
  if (!isFinite(n) || !isFinite(d) || d <= 0) return { kind: "no-denominator" };
  // ★경계(n === d)는 정상이다. 100% 는 있을 수 있는 값이라 막지 않는다.
  if (n > d) return { kind: "incomparable" };
  return { kind: "ok", rate: n / d };
}

/** 판정 → 화면 글자. `fmtRate` 규약(분모 0 → "—")을 그대로 잇는다. */
export function fmtRatioVerdict(v: RatioVerdict): string {
  if (v.kind === "incomparable") return RATIO_INCOMPARABLE_LABEL;
  return fmtRate(v.kind === "ok" ? v.rate : null);
}

export function Ratio({
  numerator,
  denominator,
  size = "sm",
  title,
}: {
  numerator: number | null | undefined;
  denominator: number | null | undefined;
  size?: "sm" | "lg";
  title?: string;
}) {
  const n = numerator ?? 0;
  const d = denominator ?? 0;
  // 분모 0 → "0.0%" 가 아니라 "—", 분자 > 분모 → 퍼센트 자체를 내지 않는다.
  // 두 규약 모두 ratioVerdict 한 곳에서 나온다.
  const v = ratioVerdict(n, d);
  const pct = fmtRatioVerdict(v);
  const incomparable = v.kind === "incomparable";
  return (
    <span
      className="inline-flex items-baseline gap-1.5 whitespace-nowrap"
      title={
        incomparable
          ? `${title ? `${title} · ` : ""}${RATIO_INCOMPARABLE_HINT}`
          : title
      }
    >
      {/* ★분수는 언제나 그대로 남는다 — 비교 불가에서도 지우지 않는다. */}
      <span
        className={`font-semibold tabular-nums text-zinc-100 ${
          size === "lg" ? "text-lg" : "text-sm"
        }`}
      >
        {fmtInt(n)}/{fmtInt(d)}
      </span>
      <span
        className={`${incomparable ? "" : "tabular-nums "}${
          v.kind === "ok" ? "text-zinc-500" : "text-zinc-600"
        } ${size === "lg" ? "text-xs" : "text-[11px]"}`}
      >
        ({pct})
      </span>
    </span>
  );
}

// ★비율 카드 — 큰 글씨가 분수, 작은 글씨가 퍼센트. 큰 글씨 자리에 퍼센트를 넣는
// 순간 2명짜리 표본이 "시장의 절반" 처럼 읽힌다. 순서를 뒤집지 말 것.
export function RatioCard({
  label,
  numerator,
  denominator,
  sub,
  title,
  accent,
}: {
  label: string;
  numerator: number;
  denominator: number;
  sub?: string;
  title?: string;
  accent?: string;
}) {
  const incomparable =
    ratioVerdict(numerator, denominator).kind === "incomparable";
  return (
    <div
      className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"
      title={
        incomparable
          ? `${title ? `${title} · ` : ""}${RATIO_INCOMPARABLE_HINT}`
          : title
      }
    >
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums text-zinc-100"
        style={accent ? { color: accent } : undefined}
      >
        {fmtInt(numerator)}/{fmtInt(denominator)}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        {fmtRatioVerdict(ratioVerdict(numerator, denominator))}
        {sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}

// ★events 계정축의 한계. 서버가 note 로 실어 보내는 것과 같은 사실을, 표 아래
// 각주가 아니라 탭 머리에서 먼저 말한다(v3/functions/src/index.ts 계정축 주석).
export const EVENTS_ACCOUNT_AXIS_LIMIT =
  "events 의 계정축(metadata.accountUserId)은 실측상 2026-08-06~08-10 5일간 " +
  "uid 1개에만 존재하고 그 밖의 전 구간은 NULL 입니다. 이 축의 0 은 '아무도 안 " +
  "썼다'가 아니라 '측정되지 않았다' 입니다 — 그 0 을 이탈로 읽으면 두 겹으로 " +
  "틀립니다. 계정 단위 활동은 cost_logs 축을, 설치 단위 동치 지표는 온보딩 " +
  "퍼널·설치 축을 보세요.";

// 표본이 작으면 화면이 그렇게 말한다. 분모가 SMALL_SAMPLE_MAX 를 넘으면 조용하다.
export function SmallSampleNotice({
  n,
  what,
  unit = "개",
}: {
  n: number;
  what: string;
  unit?: string;
}) {
  if (n > SMALL_SAMPLE_MAX) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {what} 표본이{" "}
        <b className="tabular-nums">
          {fmtInt(n)}
          {unit}
        </b>{" "}
        입니다. 이 규모에서 퍼센트는 한 건이 움직일 때마다 수십 %p 씩 흔들립니다
        — 분수(<span className="font-mono">1/2</span>)를 읽고 퍼센트는 참고만
        하세요.
      </span>
    </p>
  );
}

/** 설치 수를 분모로 쓰는 지표에 붙이는 공통 경고. */
function InstallDenominatorNotice({
  basis,
  observed,
}: {
  basis: string;
  observed?: number | null;
}) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>설치 수가 분모입니다.</b> {basis}
        {observed != null ? (
          <>
            {" "}
            현재 관측 설치는{" "}
            <b className="tabular-nums">{fmtInt(observed)}대</b>입니다.
          </>
        ) : null}{" "}
        개발·CI·도그푸드 설치가 섞이면 전환율과 리텐션이 희석됩니다. 이 수치를
        가입자 수나 사람 수로 읽지 마세요.
      </span>
    </p>
  );
}

// ── ★'적재 전' 상태 ────────────────────────────────────────────────────────
// 소스가 아직 안 붙은 지표는 0 을 그리지 않는다. 0 을 그리면 "아무도 안 샀다"로
// 읽히는데 그건 데이터가 아니라 배선이 없는 것이다. 빈 표를 채우는 대신 무엇을
// 기다리는지와, 붙으면 무엇이 보이는지를 화면이 직접 말한다.
export function PendingIngestion({
  title,
  waitingOn,
  willShow,
  missing = "source",
}: {
  title: string;
  waitingOn: string;
  willShow: string[];
  /**
   * ★없는 것이 **소스**인지 **조회 경로**인지 가른다.
   *
   * `analytics_user_daily` 처럼 스케줄이 매일 채우고 있는데 화면이 읽어 오는
   * 콜러블만 없는 칸이 있다. 그걸 "적재 전" 이라고 쓰면 그 자체가 작은 거짓말이고,
   * 다음 사람이 "적재부터 해야겠네" 로 읽어 이미 있는 표를 다시 만든다.
   * 그래서 배지를 **'연결 전'** 으로 가른다(오케스트레이터 확정 문구).
   * 어느 쪽이든 **가짜 0 을 그리지 않는다**는 규약은 같다.
   *
   * ★'연결 전' 의 '연결' 은 **화면↔표** 를 잇는 조회 경로다. 사람 축의
   * '연결된 설치'(설치↔사람 링크)와 다른 말이라, 본문 문장이 어느 쪽인지
   * 매번 못 박는다 — 배지 두 글자만 보고 헷갈릴 자리를 남기지 않는다.
   */
  missing?: "source" | "read-path";
}) {
  const noSource = missing === "source";
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-zinc-600" />
        <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
          {noSource ? "적재 전" : "연결 전"}
        </span>
      </div>
      {noSource ? (
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          아직{" "}
          <b className="text-zinc-400">수치가 0 인 게 아니라 소스가 없습니다</b>
          . 여기에 0 이나 빈 표를 그리면 &ldquo;아무도 안 했다&rdquo;로 읽히기
          때문에 그리지 않습니다.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          소스는 <b className="text-zinc-400">이미 쌓이고 있습니다</b> — 없는
          것은 이 화면이 그걸 읽어 오는 경로입니다. 그래서 여기 0 을 그리면 두
          겹으로 틀립니다(아무도 안 한 것도, 소스가 없는 것도 아닙니다).
        </p>
      )}
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-zinc-600">기다리는 것</dt>
          <dd className="text-zinc-400">{waitingOn}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-zinc-600">붙으면 보임</dt>
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

function AdSpendStatusBadge({ status }: { status: AdSpendMatchStatus }) {
  const tone =
    status.kind === "matched"
      ? "border-emerald-900/50 bg-emerald-950/25 text-emerald-200"
      : status.kind === "unmatched"
      ? "border-amber-900/50 bg-amber-950/25 text-amber-100"
      : status.kind === "error"
      ? "border-red-900/50 bg-red-950/25 text-red-200"
      : "border-zinc-800 bg-zinc-950/50 text-zinc-400";
  return (
    <p className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone}`}>
      {status.message}
    </p>
  );
}

export function CacSummaryView({ data }: { data: AdminCacSummary | null }) {
  const summary = data?.summary ?? null;
  if (!data) {
    return (
      <PendingIngestionFallback
        waitingOn="getAdminCacSummary — CAC 요약을 읽는 어드민 콜러블"
      />
    );
  }
  if (data.state !== "ingested" || !summary) {
    return (
      <PendingIngestionFallback
        waitingOn={
          data.reason ??
          "analytics_ad_spend 테이블 또는 ga4_first_touch_current 뷰 준비"
        }
      />
    );
  }
  const topMatched = summary.campaigns.slice(0, 5);
  const topUnmatched = summary.unmatched.slice(0, 5);
  return (
    <Panel
      title="캠페인·소스별 유입과 CAC"
      note="analytics_ad_spend.campaignKey 와 ga4_first_touch_current.campaign 정규화 키 기준"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="매칭 광고비"
          value={fmtKrw(summary.matchedSpendKrw)}
          sub={`획득 ${fmtInt(summary.acquiredFromMatchedCampaigns)} 설치`}
        />
        <StatCard
          label="미매칭 광고비"
          value={fmtKrw(summary.unmatchedSpendKrw)}
          sub={
            summary.unmatchedSpendKrw > 0
              ? "캠페인명 확인 필요"
              : "미매칭 없음"
          }
        />
        <StatCard
          label="전체 CAC"
          value={fmtKrw(summary.overallCacKrw)}
          sub="매칭 캠페인 기준"
        />
        <StatCard
          label="매칭 캠페인"
          value={fmtInt(summary.campaigns.length)}
          sub={`미매칭 ${fmtInt(summary.unmatched.length)}개`}
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h5 className="text-xs font-semibold text-zinc-300">매칭됨</h5>
          {topMatched.length === 0 ? (
            <EmptyState label="아직 GA4 캠페인과 매칭된 광고비가 없습니다." />
          ) : (
            <ul className="mt-2 space-y-2">
              {topMatched.map((c) => (
                <li
                  key={c.campaignKey}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate text-zinc-300">
                    {c.campaignName}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-400">
                    {fmtKrw(c.spendKrw)} · {fmtInt(c.acquired)}설치
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h5 className="text-xs font-semibold text-zinc-300">미매칭</h5>
          {topUnmatched.length === 0 ? (
            <EmptyState label="미매칭 광고비가 없습니다." />
          ) : (
            <ul className="mt-2 space-y-2">
              {topUnmatched.map((c) => (
                <li
                  key={c.campaignKey}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-900/40 bg-amber-950/10 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate text-amber-100">
                    {c.campaignName}
                  </span>
                  <span className="shrink-0 tabular-nums text-amber-200">
                    {fmtKrw(c.spendKrw)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function PendingIngestionFallback({ waitingOn }: { waitingOn: string }) {
  return (
    <PendingIngestion
      title="캠페인·소스별 유입과 CAC"
      waitingOn={waitingOn}
      willShow={[
        "캠페인별 광고비와 획득 설치수",
        "미매칭 광고비 — 캠페인명 확인 필요",
        "채널별 CAC = 광고비 / 획득 설치수",
      ]}
    />
  );
}

export function ManualAdSpendInputPanel({
  form,
  status,
  saving,
  onChange,
  onSubmit,
}: {
  form: ManualAdSpendForm;
  status: AdSpendMatchStatus;
  saving: boolean;
  onChange: (patch: Partial<ManualAdSpendForm>) => void;
  onSubmit: () => void;
}) {
  const amount = Number(form.amountKrw);
  const canSubmit =
    form.spendDate.trim() !== "" &&
    form.campaignName.trim() !== "" &&
    Number.isFinite(amount) &&
    amount > 0 &&
    !saving;
  return (
    <Panel
      title="광고비 수동 입력"
      note="append-only 원장입니다. 수정은 새 정정 행으로 남깁니다."
    >
      <form
        className="grid grid-cols-1 gap-2 lg:grid-cols-[150px_150px_minmax(220px,1fr)_100px_140px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <label className="space-y-1 text-xs text-zinc-500">
          <span>날짜</span>
          <input
            type="date"
            value={form.spendDate}
            onChange={(e) => onChange({ spendDate: e.target.value })}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-500">
          <span>채널</span>
          <select
            value={form.platform}
            onChange={(e) =>
              onChange({ platform: e.target.value as AdSpendPlatform })
            }
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          >
            {AD_SPEND_PLATFORM_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-500">
          <span>캠페인</span>
          <input
            type="text"
            value={form.campaignName}
            onChange={(e) => onChange({ campaignName: e.target.value })}
            placeholder="GA4 campaign 값과 같은 이름"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-500">
          <span>통화</span>
          <select
            value={form.currency}
            disabled
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 outline-none"
          >
            <option value="KRW">KRW</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-500">
          <span>금액</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={form.amountKrw}
            onChange={(e) => onChange({ amountKrw: e.target.value })}
            placeholder="100000"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm tabular-nums text-zinc-200 outline-none focus:border-indigo-500"
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 lg:mt-[22px]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          저장
        </button>
      </form>
      <div className="mt-3">
        <AdSpendStatusBadge status={status} />
      </div>
    </Panel>
  );
}

// ── ★실매출 — 내부·테스트 결제를 갈라서 보여준다 ───────────────────────────
//
// 이 블록의 존재 이유 한 줄: **매출 0 을 0 으로 보여주는 건 정확한 것이고,
// 테스트 1건을 매출로 보여주는 게 부정확한 것이다.**
//
// 그래서 세 상태를 절대 섞지 않는다.
//   1. 표가 없다        → '적재 전'  (숫자를 그리지 않는다)
//   2. 콜러블이 없다     → '연결 전'  (표는 차 있고 읽는 길만 없다)
//   3. 표가 있고 0 이다  → **0 을 그린다.** 이건 데이터다.
//
// 그리고 갈라낸 것은 **지운 게 아니라 뺀 것**이므로 건수를 나란히 띄운다.
// 안 띄우면 다음 사람이 "왜 결제가 하나도 안 잡히지" 로 또 판다.
export function PurchaseSplitView({ data }: { data: PurchaseSummary }) {
  const r = data.revenue;
  if (data.state === "not_ingested" || r == null) {
    return (
      <PendingIngestion
        title="실매출 (analytics_purchase)"
        waitingOn={
          data.reason ??
          "analytics_purchase 적재 — 표가 아직 없어 0 을 그리지 않는다"
        }
        willShow={[
          "실매출(외부 고객) 합계 — 기준 라벨과 함께",
          "매출에서 뺀 내부(운영자) 결제 건수",
          "무상 부여(founder_grant) 건수",
        ]}
      />
    );
  }

  const zeroRevenue = r.externalRows === 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* ★분모가 아니라 기준을 적는다. 0 옆에 '적재 전' 을 쓰지 않는다 —
            표가 있는 이상 이 0 은 미상이 아니라 측정값이다. */}
        <StatCard
          label="실매출 (외부 고객)"
          value={`₩${fmtInt(r.externalKrw)}`}
          sub={
            zeroRevenue
              ? "결제 고객 0명 — 적재 전이 아니라 측정된 0"
              : `${fmtInt(r.externalRows)}건`
          }
          accent={zeroRevenue ? undefined : STATUS_GOOD}
        />
        <StatCard
          label="내부·운영자 결제"
          value={fmtInt(r.internalRows)}
          sub="매출에서 뺌 · 지운 게 아니라 가른 것"
          accent={r.internalRows > 0 ? STATUS_WARN : undefined}
        />
        <StatCard
          label="무상 부여 (grant)"
          value={fmtInt(r.grantRows)}
          sub="PG 미경유 · 매출 아님"
          accent={SERIES_2}
        />
        <StatCard
          label="계정 성격 미분류"
          value={fmtInt(r.unclassifiedRows)}
          sub={
            r.unclassifiedRows > 0
              ? "표식 이전 적재분 — 매출로 올리지 않음"
              : "없음"
          }
          accent={r.unclassifiedRows > 0 ? STATUS_WARN : undefined}
        />
      </div>
      <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-500">
        <b className="text-zinc-400">기준</b> {data.basis} · 적재 행{" "}
        {fmtInt(r.totalRows)}건.
        {r.amountUnknownRows > 0 && (
          <>
            {" "}
            금액 미상 {fmtInt(r.amountUnknownRows)}건(환불·해지·부여) —{" "}
            <b className="text-zinc-400">미상은 0 이 아니라서</b> 순매출은 아직
            계산하지 않습니다.
          </>
        )}
      </p>
      <AxisLimitNote notes={data.notes} />
    </div>
  );
}

// ── ★축 한계 고지 ──────────────────────────────────────────────────────────
// 0 이 '없음'인지 '미측정'인지 구분한다. 서버가 note 로 실어 보내는 축 한계를
// 표 아래 각주가 아니라 탭 머리에 둔다 — 숫자를 읽기 전에 읽혀야 하는 문장이다.
export function AxisLimitNote({
  notes,
}: {
  notes: (string | null | undefined)[];
}) {
  const clean = Array.from(
    new Set(notes.filter((n): n is string => typeof n === "string" && n !== ""))
  );
  if (clean.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-200">
        <TriangleAlert className="h-3.5 w-3.5" />이 탭에서 0 은
        &ldquo;없음&rdquo; 이 아닐 수 있습니다
      </p>
      <ul className="space-y-1 text-[11px] leading-relaxed text-amber-200/80">
        {clean.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </div>
  );
}

// ── ★사람 축 — 기준을 말하지 않는 숫자를 금지한다 ────────────────────────────
// v3/functions/src/personAxis.ts 응답의 미러. 설계 정본은
// v3/docs/person-axis-user-key-design-2026-08-21.md §10.3(서버가 싣는 것) /
// §10.4(화면 규칙 일곱) / §5.5(공용 기기).
//
// ★이 블록이 존재하는 이유는 하나다. 사람 축은 **커버리지가 오르는 동안 숫자가
//   저절로 좋아진다.** 링크는 그 설치가 다시 인증해야 생기므로(forward-only)
//   켠 직후엔 거의 비어 있고 며칠에 걸쳐 채워지는데, 그 구간에 평소 화면을 그리면
//   "리텐션이 개선됐다" 로 읽힌다 — 실제로는 분모가 늘어난 것뿐이다. 그래서
//   `PendingIngestion`(0%) 과 정상(100%) 사이에 상태를 하나 더 둔다.

/** 어느 뷰로 사람에게 귀속했나. 값이 아니라 **말**이 라벨의 본체다(§10.4-5). */
export type PersonAxisBasis = "since_link" | "all_time";

/**
 * 화면에 그대로 그리는 배지 문구. ★서버 `PERSON_AXIS_BASIS_LABEL` 와 **같은 말**
 * 이어야 한다 — 두 벌이 갈라지면 "뷰 이름이 곧 고지" 라는 장치가 무너진다
 * (설계 §5.4-4).
 */
export const PERSON_AXIS_BASIS_LABEL: Readonly<
  Record<PersonAxisBasis, string>
> = {
  since_link: "연결 이후 기준",
  all_time: "설치 전체 이력 기준(소급)",
};

/**
 * 사람 축을 쓰는 **모든** 응답에 실려 오는 커버리지(설계 §10.3).
 *
 * ★`state` 는 넷이다. 설계 §10.3 의 셋에 `disabled` 가 더 붙었다(#1084 §9 가
 *   프론트 몫으로 남긴 자리) — 게이트가 닫힌 것은 '적재 전'(pending)이 **아니다.**
 *   소스가 없는 게 아니라 아직 열면 안 되는 것이고, 그 둘을 같은 말로 그리면
 *   화면이 "곧 채워집니다" 라는 거짓 기대를 만든다.
 */
export type PersonAxisCoverage = {
  state: "disabled" | "pending" | "ingesting" | "complete";
  metric: "identity_linked_ratio";
  /** disabled 일 때만 채워진다. 화면이 이 문장을 그대로 그린다. */
  disabledReason: string | null;
  identityLinkedInstalls: number;
  identityTotalInstalls: number;
  dailyActiveInstalls: number;
  dailyLinkedActiveInstalls: number;
  dailyJoinable: boolean;
  dailyJoinNote: string;
  linkedInstalls: number;
  totalInstalls: number;
  /** legacy: dailyLinkedActiveInstalls */
  linkedActiveInstalls: number;
  /** legacy: dailyActiveInstalls */
  activeInstalls: number;
  /** 공용 기기로 판정돼 제외된 설치 수(설계 §5.5). 값을 만들지 않고 센다. */
  excludedSharedInstalls: number;
  /** 개정 발효일 — 소급 상한. 게이트가 닫혔으면 null. */
  effectiveFrom: string | null;
  basis: PersonAxisBasis;
  lastLinkedAt: string | null;
};

/**
 * ★배포 직후 사람 축이 비어 있는 것은 고장이 아니다. 이 문장을 화면에서 빼면
 * "켰는데 왜 비어 있지" 로 읽힌다 — 그래서 상수로 박아 여러 자리에서 같은 말을
 * 쓴다(문장이 갈라지면 어느 쪽이 맞는지 화면이 스스로 못 말한다).
 */
export const PERSON_AXIS_FORWARD_ONLY_NOTE =
  "사람 축 링크는 forward-only 입니다 — 각 설치는 '다음에 인증할 때' 부터 " +
  "붙습니다. 그래서 켠 직후에 연결된 설치가 거의 없는 것이 정상이고, 여기 " +
  "낮은 identity linked ratio 는 '사람이 없다' 가 아니라 '아직 안 붙었다' 입니다. 잠자는 " +
  "설치는 며칠에서 영원히 안 붙을 수 있습니다.";

/**
 * ★'적재 전' 과 **행동이 다르다**는 사실. 이 문장이 이 상태의 존재 이유다.
 *
 * '적재 전' 은 기다리면 채워진다 — 파생표가 만들어지면 한 번에 다 들어온다.
 * '매핑 불가' 는 **기다려도 안 채워질 수 있다.** 링크는 설치마다 따로, 그 설치가
 * 다음에 인증할 때 생기고(forward-only), 잠자는 설치는 그날이 안 온다. 그리고
 * 소급 백필로 앞당길 수 없다 — 인증하지 않은 설치를 사람에 붙일 근거가 없다.
 *
 * 이 둘을 같은 배지로 그리면 오너가 "곧 채워지겠지" 로 읽고 기다린다. 그 기다림이
 * 영원히 안 끝나는 자리라 화면이 먼저 말해야 한다.
 */
export const PERSON_AXIS_NO_BACKFILL_NOTE =
  "소급 백필로 앞당길 방법이 없습니다 — 인증하지 않은 설치를 사람에 붙일 근거 " +
  "자체가 없기 때문입니다. 그래서 '적재 전' 처럼 시간이 해결해 주는 칸이 아닙니다: " +
  "identity linked ratio 가 영영 낮은 채로 남을 수 있고, 여기 분수는 '아직 적은 값' 이 아니라 " +
  "'이게 최종일 수도 있는 값' 으로 읽어야 합니다.";

/** 사람 축 지표의 분모는 현재 analytics_identity 의 HMAC 설치 집합이다. */
export const PERSON_AXIS_DENOMINATOR_NOTE =
  "이 지표 이름은 identity_linked_ratio 입니다. 분모는 활동 설치가 아니라 " +
  "analytics_identity 에 이미 식별된 HMAC install_key 집합입니다. daily 활동축은 " +
  "아직 raw install_key 라서 이 분수에 섞지 않습니다.";

export const PERSON_AXIS_DAILY_JOIN_NOTE =
  "daily 기준 활성 설치는 별도 숫자입니다. analytics_user_daily.install_key 는 원시 " +
  "설치 ID 이고 identity/link install_key 는 HMAC 이라, install_key_hmac 컬럼이 " +
  "추가되기 전까지 두 축은 직접 조인할 수 없습니다.";

/** 링크 MERGE 배선 전(서버가 커버리지를 아직 안 싣는 상태)에 기다리는 것. */
export const PERSON_AXIS_WAITING_ON =
  "인증 경로 링크 MERGE 배선 + 사람 축 뷰 2벌(v_person_since_link / " +
  "v_person_all_time) — 선행 티켓 진행 중";

/** 붙으면 무엇이 보이는지. '적재 전' 규약은 이 목록을 요구한다. */
export const PERSON_AXIS_WILL_SHOW = [
  "사람 단위 리텐션(설치가 아니라 사람 — 한 사람이 설치 여러 대를 쓴다)",
  "설치 전체 이력 기준(소급) 캠페인 귀속 — 라벨과 함께",
  "identity_linked_ratio: analytics_identity 설치 중 몇 대가 사람 링크에 연결됐나",
  "daily 기준 활성 설치 수 — raw/HMAC 키 통일 전까지 사람 링크와 별도 표시",
];

/**
 * 조회 구간의 시작일('YYYY-MM-DD'). 서버가 준 `generatedAt` 을 기준으로 센다 —
 * 클라 시계로 세면 시차 하루가 경계 고지를 켜고 끈다.
 */
export function analyticsRangeStart(
  generatedAt: string | null | undefined,
  rangeDays: number | null | undefined
): string | null {
  if (!generatedAt || !rangeDays || rangeDays <= 0) return null;
  const end = new Date(generatedAt);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - (rangeDays - 1) * 86400000);
  return start.toISOString().slice(0, 10);
}

/**
 * §10.4-7. 조회 구간이 발효일보다 앞으로 뻗으면 탭 머리에 적는다 — 그 구간의
 * 0 은 '없음' 이 아니라 '사람 축이 없던 때' 다. 겹치지 않으면 null(없는 고지를
 * 적는 것도 거짓말이다).
 */
export function personAxisRangeNote(
  coverage: PersonAxisCoverage | null | undefined,
  rangeStartDay: string | null | undefined
): string | null {
  const from = coverage?.effectiveFrom;
  if (!from || !rangeStartDay) return null;
  if (rangeStartDay >= from) return null;
  return (
    `이 조회 구간은 사람 축 발효일(${from}) 이전까지 뻗습니다. 발효일 왼쪽의 ` +
    `0 은 '없음' 이 아니라 '사람 축이 없던 때' 입니다 — 소급은 발효일에서 ` +
    `끊깁니다.`
  );
}

/**
 * 발효일 경계선. 06-13 교체선과 **같은 장치**를 쓴다(§10.4-7).
 *
 * ★지금 화면에는 이 마커를 받을 **사람 축 시계열이 아직 없다**(사람 축 카드는
 * 커버리지 하나뿐이다). 그래서 이 함수는 지금 어느 차트에도 안 걸려 있다 —
 * 대신 익명축 차트에 갖다 붙이지 **않는다.** 다른 축의 선을 긋는 것은 없는 선을
 * 긋는 것과 같은 종류의 거짓말이다. 규칙 7 의 글 절반(AxisLimitNote)은 이미
 * 걸려 있고, 선 절반은 사람 축 시계열이 붙는 티켓에서 이 함수를 그대로 쓴다.
 */
export function personAxisMarker(
  coverage: PersonAxisCoverage | null | undefined
): ChartMarker | undefined {
  const from = coverage?.effectiveFrom;
  if (!from) return undefined;
  return {
    date: from,
    label: `${from} 사람 축 발효`,
    hint:
      `사람 축 소급 상한(${from}). 이 선 왼쪽 구간은 사람에게 귀속하지 ` +
      `않습니다 — 거기 0 은 '없음' 이 아니라 '사람 축이 없던 때' 입니다.`,
  };
}

/**
 * §10.4-1. `complete` 가 아니면 퍼센트를 헤드라인으로 그리지 않는다 — 분수만
 * 그린다. 기존 `Ratio`/`RatioCard` 규약의 연장이지 새 규약이 아니다.
 */
export function personAxisHeadlineAllowed(
  coverage: PersonAxisCoverage | null | undefined
): boolean {
  return coverage?.state === "complete";
}

/**
 * ★사람 축 숫자를 그리는 **유일한** 자리. `basis` 가 필수 prop 이라 라벨을 빼고
 * 숫자만 그릴 방법이 타입 수준에서 없다 — 규약을 주석이 아니라 시그니처가
 * 지킨다(§10.4-5). 새 사람 축 카드는 `Ratio` 가 아니라 이걸 쓴다.
 *
 * §10.4-1 도 여기서 같이 지킨다: `state !== "complete"` 면 퍼센트를 크게 그리지
 * 않는다. 퍼센트가 커지는 것은 커버리지가 찼을 때뿐이다.
 */
export function PersonAxisNumber({
  numerator,
  denominator,
  coverage,
  label,
}: {
  numerator: number;
  denominator: number;
  coverage: PersonAxisCoverage;
  /** 분모가 무엇인지. ★"전체 설치" 라고 쓰지 마라 — 분모는 링크된 설치다(§10.4-2). */
  label: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <Ratio
        numerator={numerator}
        denominator={denominator}
        size={personAxisHeadlineAllowed(coverage) ? "lg" : "sm"}
        title={`${label} · ${PERSON_AXIS_BASIS_LABEL[coverage.basis]}`}
      />
      <span className="text-[11px] text-zinc-500">{label}</span>
      <PersonAxisBasisBadge
        basis={coverage.basis}
        effectiveFrom={coverage.effectiveFrom}
      />
    </span>
  );
}

/** §10.4-5. 사람 축 숫자 옆에는 **항상** 이 배지가 붙는다. */
export function PersonAxisBasisBadge({
  basis,
  effectiveFrom,
}: {
  basis: PersonAxisBasis;
  effectiveFrom?: string | null;
}) {
  const retro = basis === "all_time";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${
        retro
          ? "border-violet-800/60 bg-violet-950/30 text-violet-200"
          : "border-zinc-700 bg-zinc-900 text-zinc-400"
      }`}
      title={
        retro
          ? `v_person_all_time — 링크 이전의 설치 이력까지 그 사람에게 귀속합니다(소급).${
              effectiveFrom ? ` 상한: ${effectiveFrom}.` : ""
            }`
          : "v_person_since_link — 링크가 생긴 뒤의 행만 그 사람에게 귀속합니다."
      }
    >
      <Link2 className="h-3 w-3" />
      {PERSON_AXIS_BASIS_LABEL[basis]}
    </span>
  );
}

/**
 * §10.4-3. `PendingIngestion` 과 **같은 자리, 같은 문법**의 세 번째 상태.
 * 퍼센트를 헤드라인으로 쓰지 않고(§10.4-1) 분수로만 그린다.
 */
export function IngestionProgress({
  coverage,
}: {
  coverage: PersonAxisCoverage;
}) {
  const remaining = Math.max(
    coverage.identityTotalInstalls - coverage.identityLinkedInstalls,
    0
  );
  return (
    <div className="rounded-xl border border-dashed border-sky-900/60 bg-sky-950/20 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-sky-500" />
        <h4 className="text-sm font-semibold text-zinc-200">
          사람 축 identity linked ratio
        </h4>
        <span className="rounded-full border border-sky-800 bg-sky-950 px-2 py-0.5 text-[11px] text-sky-200">
          적재 중
        </span>
        <PersonAxisBasisBadge
          basis={coverage.basis}
          effectiveFrom={coverage.effectiveFrom}
        />
      </div>

      {/* ★분수만. 커버리지를 퍼센트 헤드라인으로 그리면 그 자체가 지표처럼
          읽힌다 — 이건 지표가 아니라 "지금 몇 %만 보고 있다" 는 경고다. */}
      <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-zinc-400">
        <span>analytics_identity 설치</span>
        <Ratio
          numerator={coverage.identityLinkedInstalls}
          denominator={coverage.identityTotalInstalls}
          size="lg"
          title="분자=analytics_identity HMAC 설치 중 사람 링크에 붙은 설치 · 분모=analytics_identity HMAC 설치"
        />
        <span>연결됨</span>
      </p>

      <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-zinc-400">
        <li>
          · 남은{" "}
          <b className="tabular-nums text-zinc-200">{fmtInt(remaining)}대</b>는
          다음에 인증할 때 붙습니다 · 지금 표는{" "}
          <b className="tabular-nums text-zinc-200">
            {fmtInt(coverage.identityLinkedInstalls)}대 기준
          </b>
          입니다
        </li>
        <li>
          · daily 기준 활성 설치:{" "}
          <b className="tabular-nums text-zinc-200">
            {fmtInt(coverage.dailyActiveInstalls)}대
          </b>{" "}
          <span className="text-zinc-600">
            (조인된 활성 {fmtInt(coverage.dailyLinkedActiveInstalls)}대 · 아직 raw/HMAC 키 불일치)
          </span>
        </li>
        <li>
          · 공용 기기로 판정돼 제외:{" "}
          <b className="tabular-nums text-zinc-200">
            {fmtInt(coverage.excludedSharedInstalls)}대
          </b>{" "}
          <span className="text-zinc-600">
            (한 설치에 사람이 둘 이상 — 몰아주지 않고 뺍니다)
          </span>
        </li>
        <li>
          · identity 전체 기준 연결:{" "}
          <Ratio
            numerator={coverage.identityLinkedInstalls}
            denominator={coverage.identityTotalInstalls}
            title="분모는 analytics_identity HMAC install_key 집합입니다."
          />
          {coverage.lastLinkedAt ? (
            <span className="text-zinc-600">
              {" "}
              · 마지막 연결 {fmtDay(coverage.lastLinkedAt.slice(0, 10))}
            </span>
          ) : null}
        </li>
      </ul>

      {/* ★§10.4-4 — "이 수치는 아직 커집니다" 를 먼저 말한다. */}
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b>이 수치는 아직 커집니다.</b> 같은 기간을 내일 다시 조회하면 값이
          올라갑니다 — identity_linked_ratio 가 오르는 중이기 때문입니다. 지금 화면을 캡처해
          나중 값과 비교하지 마세요. 그 비교는 개선이 아니라 분모의 증가입니다.
        </span>
      </p>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        {PERSON_AXIS_DENOMINATOR_NOTE}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        {coverage.dailyJoinNote || PERSON_AXIS_DAILY_JOIN_NOTE}
      </p>
    </div>
  );
}

/**
 * ★'매핑 불가' — 측정은 됐는데 사람에 못 붙은 상태(coverage.state === "pending").
 *
 * 예전에는 이 자리도 `PendingIngestion`('적재 전')으로 접혀 있었다. 그런데 그
 * 배지가 달고 오는 본문은 **"수치가 0 인 게 아니라 소스가 없습니다"** 다 — 이
 * 자리에서 그건 **사실이 아니다.** 소스는 있다(활동한 설치가 실제로 세어졌다).
 * 없는 것은 사람 링크뿐이다. 그 문장을 그대로 두면 다음 사람이 적재부터 다시 판다.
 *
 * 그리고 **행동이 다르다**(→ `PERSON_AXIS_NO_BACKFILL_NOTE`). '적재 전' 은
 * 기다리면 채워지고, 여기는 기다려도 안 채워질 수 있다. 보는 사람이 할 일이
 * 다르므로 이건 내부 구분이 아니라 **화면 상태**다.
 *
 * ★반대로 `coverage == null`(미배선)은 여전히 '적재 전' 으로 접는다 — §10.4-6.
 *   거기서 보는 사람이 할 일은 '적재 전' 과 똑같이 **기다린다** 하나뿐이다.
 */
export function PersonAxisUnmapped({
  coverage,
}: {
  coverage: PersonAxisCoverage;
}) {
  return (
    <div className="rounded-xl border border-dashed border-amber-900/50 bg-amber-950/10 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Unlink className="h-4 w-4 text-amber-500" />
        <h4 className="text-sm font-semibold text-zinc-300">
          사람 축 (설치가 아니라 사람 단위)
        </h4>
        <span className="rounded-full border border-amber-800/60 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-200">
          매핑 불가
        </span>
        <PersonAxisBasisBadge
          basis={coverage.basis}
          effectiveFrom={coverage.effectiveFrom}
        />
      </div>

      {/* ★첫 문장이 '적재 전' 과 갈리는 지점이다 — 소스는 있다. */}
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        <b className="text-zinc-200">측정은 됐습니다.</b> 없는 것은 소스가 아니라{" "}
        <b className="text-zinc-200">사람 링크</b>입니다 — 활동한 설치{" "}
        <b className="tabular-nums text-zinc-200">
          {`${fmtInt(coverage.dailyActiveInstalls)}대`}
        </b>{" "}
        는 별도 daily raw 축이고, identity 에서 사람 링크에 연결된 설치는{" "}
        <b className="tabular-nums text-zinc-200">
          {`${fmtInt(coverage.identityLinkedInstalls)}대`}
        </b>
        입니다. 그래서 daily 활동 설치를 사람 축 분모로 쓰지 않습니다 — raw/HMAC
        키 불일치를 숨기면 없는 비율을 지어내는 것입니다.
      </p>

      {/* ★"곧 채워지겠지" 로 읽히면 안 되는 자리. 그 말을 화면이 직접 막는다. */}
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b>기다린다고 채워지는 칸이 아닙니다.</b>{" "}
          {PERSON_AXIS_NO_BACKFILL_NOTE}
        </span>
      </p>

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-zinc-600">붙으면 보임</dt>
          <dd className="text-zinc-400">
            <ul className="space-y-0.5">
              {PERSON_AXIS_WILL_SHOW.map((w) => (
                <li key={w}>· {w}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        {PERSON_AXIS_FORWARD_ONLY_NOTE}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        {coverage.dailyJoinNote || PERSON_AXIS_DAILY_JOIN_NOTE}
      </p>
    </div>
  );
}

/**
 * ★다섯 번째 상태 — 게이트가 닫혀 있다(#1084 §9 가 프론트 몫으로 남긴 자리).
 * '적재 전' 과 **다른 말**을 쓴다. 소스가 없는 게 아니라 아직 열지 않은 것이고,
 * '곧 채워집니다' 라고 읽히면 안 된다.
 */
export function PersonAxisDisabled({
  coverage,
}: {
  coverage: PersonAxisCoverage;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 text-zinc-600" />
        <h4 className="text-sm font-semibold text-zinc-300">사람 축</h4>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
          아직 열지 않음
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        소스가 없어서 비어 있는 게 아니라{" "}
        <b className="text-zinc-400">아직 열면 안 되는 것</b>입니다. 곧 채워지는
        칸이 아니므로 &lsquo;적재 전&rsquo; 과 같은 말로 읽지 마세요.
      </p>
      {coverage.disabledReason ? (
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-400">
          {coverage.disabledReason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 사람 축 identity linked ratio 한 자리. **네 상태 + 미배선**을 여기 한 곳에서 가른다 —
 * 호출부마다 분기하면 어느 자리에서 규약 하나가 조용히 빠진다.
 *
 * ★`coverage` 가 없는 것은 상태가 아니라 **배선 전**이다. 선행 티켓이 응답에
 *   커버리지를 싣기 전까지 여기는 기존 '적재 전' 규약으로 접힌다 — **보는 사람이
 *   할 일이 '적재 전' 과 같기 때문**이다(기다린다). 할 일이 같은 내부 구분은
 *   화면 상태로 만들지 않는다는 §10.4-6 그대로다.
 *
 * ★반대로 `state === "pending"`(매핑 불가)은 갈랐다. 거기서는 할 일이 다르다 —
 *   기다려도 안 채워질 수 있다. `PersonAxisUnmapped` 주석 참조.
 */
export function PersonAxisCoverageNote({
  coverage,
}: {
  coverage: PersonAxisCoverage | null | undefined;
}) {
  if (!coverage) {
    return (
      <PendingIngestion
        title="사람 축 (설치가 아니라 사람 단위)"
        waitingOn={PERSON_AXIS_WAITING_ON}
        willShow={PERSON_AXIS_WILL_SHOW}
      />
    );
  }
  if (coverage.state === "disabled")
    return <PersonAxisDisabled coverage={coverage} />;
  // ★§10.4-6 개정 — '커버리지 0 에 새 상태를 만들지 않는다' 는 규약은 **미배선**
  //   에는 그대로 살아 있고(위 `!coverage` 분기), `state === "pending"` 에서만
  //   갈랐다. 가른 이유는 두 개다:
  //     ① '적재 전' 이 달고 오는 본문("소스가 없습니다")이 이 자리에서 거짓이다.
  //        소스는 있고 사람 링크만 없다.
  //     ② **보는 사람이 할 일이 다르다.** '적재 전' 은 기다리면 되고, 여기는
  //        기다려도 안 채워질 수 있다(forward-only · 소급 백필 불가).
  //   §10.4-6 이 막으려던 것은 '할 일이 같은 내부 구분을 화면 상태로 만드는 것'
  //   이었다. 미배선은 여전히 거기 해당하므로 접어 두고, 매핑 불가만 나온다.
  if (coverage.state === "pending")
    return <PersonAxisUnmapped coverage={coverage} />;
  if (coverage.state === "ingesting")
    return <IngestionProgress coverage={coverage} />;

  // complete — 여기서만 identity linked ratio 가 접힌 한 줄이 된다. 그래도 기준 라벨은 남는다.
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span>사람 축 identity linked ratio 완료</span>
      <Ratio
        numerator={coverage.identityLinkedInstalls}
        denominator={coverage.identityTotalInstalls}
      />
      <span>
        연결됨 · daily 활성 {fmtInt(coverage.dailyActiveInstalls)}대는 별도 raw 축 · 공용 기기 제외 {fmtInt(coverage.excludedSharedInstalls)}대
      </span>
      <PersonAxisBasisBadge
        basis={coverage.basis}
        effectiveFrom={coverage.effectiveFrom}
      />
    </p>
  );
}

// ── ★5탭 구조 ──────────────────────────────────────────────────────────────
// 지금까지 이 화면은 지표가 시간순으로 쌓여 있어 "무엇부터 봐야 하나" 가 없었다.
// 탭 하나 = 질문 하나로 세운다. 탭은 새 페이지가 아니라 기존 섹션의 재배치다.
export type AnalyticsTab =
  | "acquisition"
  | "activation"
  | "retention"
  | "revenue"
  | "operations";

export const ANALYTICS_TABS: {
  id: AnalyticsTab;
  label: string;
  question: string;
  icon: typeof Users;
}[] = [
  {
    id: "acquisition",
    label: "① 획득",
    question: "어디서 오고, 얼마 쓰면 몇 명 오나",
    icon: Globe,
  },
  {
    id: "activation",
    label: "② 활성화",
    question: "들어온 사람이 가치를 보나",
    icon: Activity,
  },
  {
    id: "retention",
    label: "③ 리텐션",
    question: "남아서 계속 쓰나",
    icon: Repeat,
  },
  {
    id: "revenue",
    label: "④ 수익",
    question: "쓰는 사람이 돈을 내나",
    icon: CreditCard,
  },
  {
    id: "operations",
    label: "⑤ 운영",
    question: "배포·라우팅이 건강한가",
    icon: Cpu,
  },
];

export function AnalyticsTabBar({
  tab,
  onChange,
}: {
  tab: AnalyticsTab;
  onChange: (t: AnalyticsTab) => void;
}) {
  const active = ANALYTICS_TABS.find((t) => t.id === tab);
  return (
    <div className="space-y-2">
      <div
        role="tablist"
        aria-label="분석 축"
        className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3"
      >
        {ANALYTICS_TABS.map((t) => {
          const Icon = t.icon;
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`analytics-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`analytics-panel-${t.id}`}
              onClick={() => onChange(t.id)}
              title={t.question}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                on
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      {active && (
        <p className="text-xs text-zinc-500">
          이 탭이 답하는 질문 —{" "}
          <b className="text-zinc-300">{active.question}</b>
        </p>
      )}
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
  /**
   * ★'red'(소스 없음)와 'unwired'(연결 전)는 다른 말이다.
   *
   * `analytics_user_daily` 는 매일 05:30 KST 스케줄로 **이미 채워지고 있다**
   * (실측: 229행, 어제 갱신). 없는 건 소스가 아니라 그걸 읽어 오는 콜러블이다.
   * 그런데 배지는 '🔴 소스 없음' 이라고 적혀 있었고, 그 옆에는 빨간 내부 오류가
   * 같이 떴다 — 화면이 서로 다른 세 가지 이야기를 동시에 한 셈이다(ticket
   * 4KqBDPkH). 상태를 아는 화면은 그걸 에러가 아니라 **상태**로 그려야 한다.
   */
  trust: "green" | "yellow" | "red" | "unwired";
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
      : trust === "unwired"
      ? {
          c: "text-zinc-400 bg-zinc-900 border-zinc-800",
          t: "⚪ 연결 전 (표는 적재 중)",
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
  // ★'internal' 은 두 가지가 겹쳐 있다: (a) 배포된 함수가 실제로 던졌다,
  //   (b) 함수가 아예 없어 404 가 CORS 에 막혔다(브라우저에선 이쪽이 흔하다).
  //   둘 다 가능하다고 말하지 않으면 (b) 를 장애로 오독한다.
  if (err?.code === "functions/internal")
    return (
      "지표를 불러오지 못했습니다. 이 함수가 아직 배포되지 않았거나(브라우저에서는 " +
      "미배포 404 가 CORS 에 막혀 내부 오류로 보입니다), 배포된 함수가 실패한 " +
      "것입니다. 먼저 배포 여부를 확인하고, 배포돼 있다면 서버 로그에서 " +
      "BigQuery/Cloud Functions 오류를 확인해야 합니다."
    );
  return err?.message || "데이터를 불러오지 못했습니다.";
}

// 개별 콜러블 로딩 결과 래퍼.
type Loaded<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  /**
   * ★그 콜러블이 **아직 서버에 없다**(functions/not-found). 장애가 아니라
   * '연결 전' 이다 — 빨간 에러 박스로 그리면 사장님이 고장으로 읽으신다.
   * 표는 이미 스케줄로 채워지고 있고 없는 것은 읽어 오는 길뿐이다.
   */
  notDeployed?: boolean;
};

/**
 * `functions/not-found` = 그 함수가 아직 배포되지 않았다.
 *
 * ★단, **브라우저에서는 이게 거의 안 걸린다**(ticket 4KqBDPkH 실측).
 * 미배포 콜러블의 404 는 Google Frontend 가 내는 HTML 이라 CORS 헤더가 없고,
 * 브라우저는 preflight 에서 응답을 통째로 차단한다 → fetch 가 TypeError 로
 * 끝나고 firebase-js-sdk 는 status 0 으로 보아 `functions/internal` 을 준다.
 * 그래서 "미배포인데 빨간 내부 오류" 가 떴다. 진짜 판정은 에러 코드가 아니라
 * 서버 매니페스트(CALLABLE_MANIFEST)로 한다 — 이 함수는 그 폴백일 뿐이다.
 */
function isNotDeployed(err: CallableError): boolean {
  return err?.code === "functions/not-found";
}

/**
 * ★이 배포본이 실제로 갖고 있는 어드민 콜러블 목록.
 *
 * 없는 함수를 부르면 화면이 '연결 전' 이 아니라 빨간 오류를 그리는 문제(위
 * isNotDeployed 주석)를 에러 코드 추측이 아니라 **서버에 직접 물어서** 없앤다.
 * 매니페스트 자체가 아직 배포 전이면 이 호출도 실패하는데, 그때는 예전처럼
 * 그냥 호출해 보는 경로로 접힌다(하위호환).
 */
export const CALLABLE_MANIFEST = "getAdminCallableManifest";
type CallableManifest = { generatedAt: string; callables: string[] };

// ── 온보딩 첫10분 퍼널 시각화 ────────────────────────────────────────────────
// 단계별 "도달 고유 clientId"를 세로 막대로, 인접 단계 이탈을 화살표로 표기한다.
// ★최대 이탈 구간(isMaxDrop)은 붉게 강조 — 22→6 같은 활성화 절벽이 눈에 띄게.
// ── 국가·채널 퍼널 ─────────────────────────────────────────────────────────
// 방문 → 다운로드 → 설치 → 모델연결 → 10분 첫 multi-agent 성공.
// 앞 두 칸은 GA4(웹), 뒤 세 칸은 앱 텔레메트리이며 익명 GA4 client_id 로 이어진다.
function CountryFunnelTable({
  rows,
  keyLabel,
}: {
  rows: CountryFunnelRow[];
  keyLabel: string;
}) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 font-medium">{keyLabel}</th>
            <th className="py-2 pr-3 text-right font-medium">방문</th>
            {/* ★거른 것을 버리지 않고 옆 칸에 남긴다 — 조용히 뺀 숫자는 이
                프로젝트가 이미 세 번 밟은 함정이다(#1193 과 같은 원칙). */}
            <th className="py-2 pr-3 text-right font-medium">
              <span className="text-amber-400/80">의심 유입</span>
            </th>
            {/* ★단계별 전환은 언제나 분자/분모다. "23%" 만 있으면 그게 4명 중
                1명인지 4천명 중 900명인지 화면에서 구분이 안 된다. */}
            <th className="py-2 pr-3 text-right font-medium">
              다운로드 <span className="text-zinc-600">/방문</span>
            </th>
            {/* ★설치·연결·10분 열은 여기서 내렸다(계획 §3-4 "유지(축소)").
                그 단계들은 **설치 축**이고 이 표는 **방문 축**이라, 한 표에 두면
                분모가 다른 숫자를 사람 눈이 자동으로 퍼널로 읽는다 — 계획 §0 이
                진단한 병이 정확히 그것이다. 설치 이후 단계는 위 통합 뷰 표가
                가져갔다. */}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-b border-zinc-900/60 text-zinc-300"
            >
              <td className="py-2 pr-3">
                <span className="text-zinc-100">{r.label}</span>
                {r.anomaly && (
                  <span
                    className="ml-1.5 text-amber-400"
                    title="설치 수가 다운로드 수보다 많다 — 조회창 밖 다운로드이거나 GA4 조인이 안 된 설치가 섞였다."
                  >
                    ⚠
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(r.visitors)}
              </td>
              <td
                className="py-2 pr-3 text-right tabular-nums text-amber-400/90"
                title={
                  r.suspectedVisitors
                    ? "단일지문 집중 + 다운로드 0 으로 판정된 방문. 삭제하지 않고 따로 센다 — 판정은 파생이라 규칙을 바꾸면 과거도 다시 읽힌다."
                    : undefined
                }
              >
                {r.suspectedVisitors ? fmtInt(r.suspectedVisitors) : "—"}
              </td>
              <td
                className={`py-2 pr-3 text-right ${
                  r.visitors > 0 && r.downloads === 0 ? "text-amber-400" : ""
                }`}
              >
                <Ratio numerator={r.downloads} denominator={r.visitors} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ★의심 유입 요약. 이 카드가 있는 이유는 하나다 — **거른 것을 버리지 않고
 * 보이게 하려고**. 조용히 뺀 숫자는 다음 사람이 반드시 다르게 읽는다(#1193 이
 * 미매칭 광고비를 보이게 한 것과 같은 원칙).
 *
 * ★국가 이름이 카드에 뜨지만 판정은 국적이 아니다. 국가는 집계 단위일 뿐이고
 *   판정 축은 (a) 그 코호트의 device×browser×os 조합 가짓수와 (b) 다운로드 0
 *   두 행동값이다. 그래서 이란에 진짜 사용자가 생겨 앱을 내려받으면 그 사람은
 *   이 카드에 들어가지 않는다.
 */
function SuspectedTrafficNotice({
  data,
}: {
  data: SuspectedTraffic | null | undefined;
}) {
  if (!data) return null;
  const { totals, rule } = data;
  if (totals.suspectedVisitors === 0) return null;
  const share =
    totals.visitors > 0 ? totals.suspectedVisitors / totals.visitors : null;

  return (
    <div
      data-testid="suspected-traffic"
      className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100"
    >
      <p className="font-medium">
        ★ 의심 유입 {fmtInt(totals.suspectedVisitors)}방문
        {share !== null && ` (${fmtPct(share)})`} · 코호트{" "}
        {totals.suspectedCohorts}개 — 버리지 않고 따로 셉니다.
      </p>
      <p className="mt-1 opacity-90">
        판정 축은 국적이 아니라 행동입니다: 한 코호트의 device×browser×os 조합이{" "}
        {Math.round(rule.signatureShare * 100)}% 이상 한 가지에 몰려 있고
        다운로드가 0인 경우만(최소 {rule.minCohortVisitors}방문). 다운로드한
        방문자는 어느 코호트에 있든 의심에 들어가지 않습니다.
      </p>
      <ul className="mt-2 space-y-1">
        {data.suspectedCohorts.slice(0, 8).map((c) => (
          <li key={c.cohort} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{c.cohort}</span>
            <span className="tabular-nums">
              {fmtInt(c.suspectedVisitors)}방문
            </span>
            <span className="opacity-70">{c.reason}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 opacity-70">
        판정은 <b>파생</b>입니다 — 원장(BigQuery)에 bot 플래그를 굽지 않으므로
        규칙을 바꾸면 과거 데이터가 즉시 새 규칙으로 다시 읽힙니다.
      </p>
    </div>
  );
}

function CountryFunnelView({ data }: { data: CountryFunnel }) {
  // 방문은 있는데 다운로드가 0 인 국가 — "해외 23% 다운로드 0" 이 여기서 뜬다.
  const zeroDownloadCountries = data.byCountry.filter(
    (r) => r.visitors > 0 && r.downloads === 0
  );
  const zeroDownloadVisitors = zeroDownloadCountries.reduce(
    (a, r) => a + r.visitors,
    0
  );
  const zeroShare =
    data.totals.visitors > 0
      ? zeroDownloadVisitors / data.totals.visitors
      : null;

  return (
    <div className="space-y-4">
      <Ga4BridgeFreshnessNote data={data.ga4Bridge} />
      <SuspectedTrafficNotice data={data.suspectedTraffic} />
      {/* 조인이 어디서 어떻게 일어났는지 숨기지 않는다. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5">
          조인 = 익명 GA4 client_id (uid 미사용)
        </span>
        <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5">
          {data.join.webRegion} ⋈ {data.join.appRegion} · 메모리 조인
        </span>
        <span
          className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5"
          title="봇은 데스크톱 앱을 내려받아 설치하고 실행하지 않는다. 그래서 채널·CAC 판단의 분모는 방문이 아니라 다운로드·설치다(#1200). 이 표는 그 앞 단계(방문→다운로드)만 본다."
        >
          ★이 표는 방문 축 — 판단 분모는 다운로드·설치
        </span>
        <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5">
          링크백 매칭{" "}
          <Ratio
            numerator={data.coverage.matchedToWeb}
            denominator={data.coverage.installs}
          />
        </span>
      </div>
      {/* ★축이 갈렸다는 사실을 표 위에 적는다 — 주석은 안 읽힌다. */}
      <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] leading-relaxed text-zinc-400">
        <b className="text-zinc-200">이 표의 알갱이는 브라우저(방문자) 1대</b>
        입니다. 설치 이후 단계(첫 스폰·첫 완주·잔존)는 알갱이가{" "}
        <b className="text-zinc-200">설치 1건</b>이라 이 표에 접히지 않고, 위{" "}
        <b className="text-zinc-200">국가별 획득(설치 축)</b> 표가 가져갔습니다.
        분모가 다른 두 표를 위아래로 놓고 곱해 읽지 마세요 — 그렇게 읽히도록
        그려 두었던 것이 이 화면의 오래된 오류였습니다. 링크백이 도달한 설치는{" "}
        <b className="tabular-nums">{fmtInt(data.coverage.installs)}대</b>입니다.
      </p>

      {(data.join.webRegionError || data.join.appRegionError) && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300">
          {data.join.webRegionError && (
            <p>
              GA4({data.join.webRegion}) 조회 실패: {data.join.webRegionError}
            </p>
          )}
          {data.join.appRegionError && (
            <p>
              앱 텔레메트리({data.join.appRegion}) 조회 실패:{" "}
              {data.join.appRegionError}
            </p>
          )}
        </div>
      )}

      {zeroShare !== null && zeroDownloadVisitors > 0 && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
          ★ 방문했지만 다운로드가 <b>0건</b>인 국가가{" "}
          {zeroDownloadCountries.length}개 · 방문자{" "}
          {fmtInt(zeroDownloadVisitors)}
          명({fmtPct(zeroShare)}). 상위:{" "}
          {zeroDownloadCountries
            .slice(0, 5)
            .map((r) => `${r.label}(${fmtInt(r.visitors)})`)
            .join(", ")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="유입 국가별"
          note="국가는 GA4 geo 가 정본이다. 조인이 안 된 설치는 (unknown) 으로 모인다."
        >
          <CountryFunnelTable rows={data.byCountry} keyLabel="국가" />
        </Panel>
        <Panel
          title="유입 채널별"
          note="GA4 traffic_source 기준. 조인이 안 된 설치는 링크백 utm/referrer 로 접힌다."
        >
          <CountryFunnelTable rows={data.byChannel} keyLabel="소스 / 매체" />
        </Panel>
      </div>

      <Panel title="합계">
        <CountryFunnelTable
          rows={[{ ...data.totals, label: "전체" }]}
          keyLabel="전체"
        />
      </Panel>

      {data.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-zinc-500">
          {data.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ★① 획득 탭 — 통합 뷰 위의 표들 (계획 §4-1)
// ════════════════════════════════════════════════════════════════════════════
//
// 표 순서 = 결정하는 순서다. 위에서부터 읽으면 "무엇을 고칠까" 가 나와야 한다:
//   상단 3줄(분모를 못 박는다) → 채널별 → ★미상 사유 → 국가 → 광고비 → 원장.
//
// ★이 섹션의 컴포넌트들은 **아무것도 세지 않는다.** 서버(adminInstallUnified.ts)가
//   GROUP BY 해서 준 것을 그린다. 화면에서 다시 세면 계획 §0 의 병이 재발한다.

/** #1198 `install_class` 어휘. 영문 키를 화면에 그대로 흘리지 않는다. */
const INSTALL_CLASS_LABEL: Record<string, string> = {
  distinct: "고유",
  reinstall_loop: "재설치 루프",
  dev_tagged: "dev 태깅",
  unknown: "판정 불가(ga_key 없음)",
};

/** 뷰를 못 읽었을 때. ★0 을 그리지 않고 무엇을 기다리는지 적는다. */
export function AcquisitionUnavailable({
  data,
  title,
  willShow,
}: {
  data: AcquisitionUnified | null;
  title: string;
  willShow: string[];
}) {
  return (
    <PendingIngestion
      title={title}
      waitingOn={
        data?.reason ??
        `${CALLABLE_INSTALL_UNIFIED} — 통합 뷰(v_install_unified) 위의 읽기 경로`
      }
      willShow={willShow}
      missing={data ? "source" : "read-path"}
    />
  );
}

/**
 * 분수 한 칸. ★서버가 `smallSample` 이라고 하면 퍼센트를 안 그린다 — 분모가 4
 * 이하인 표에서 퍼센트는 정보가 아니라 거짓말이다(계획 §4 공통 규칙).
 * 대신 분수는 그대로 남긴다. 원자료까지 가리는 건 또 다른 종류의 거짓말이다.
 */
export function UnifiedRatioCell({
  value,
  title,
}: {
  value: UnifiedRatio | null | undefined;
  title?: string;
}) {
  if (!value) return <span className="text-zinc-600">—</span>;
  if (value.smallSample) {
    return (
      <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-sm font-semibold tabular-nums text-zinc-100">
          {fmtInt(value.numerator)}/{fmtInt(value.denominator)}
        </span>
        <span
          className="text-[11px] text-amber-400/90"
          title={`분모 ${value.denominator} — 한 건이 ${(
            100 / Math.max(1, value.denominator)
          ).toFixed(0)}%p 를 움직인다. 퍼센트를 쓰지 않는다.`}
        >
          표본 부족
        </span>
      </span>
    );
  }
  return (
    <Ratio
      numerator={value.numerator}
      denominator={value.denominator}
      title={title}
    />
  );
}

/**
 * ★획득 CAC — 광고비 ÷ 외부 설치(계획 §4-1 상단 3줄 ③).
 *
 * 두 서버 값의 나눗셈일 뿐 새 집계가 아니다. 지출이 0 이면 0원 CAC 가 아니라
 * **산출 불가**다 — 0 을 그리면 "공짜로 획득했다" 로 읽힌다.
 */
export function acquisitionCac(input: {
  spendKrw: number | null;
  installsExternal: number | null;
}): { cacKrw: number | null; reason: string | null } {
  const spend = input.spendKrw ?? 0;
  const installs = input.installsExternal ?? 0;
  if (!(spend > 0)) {
    return {
      cacKrw: null,
      reason: "지출 0 — 산출 불가 (아직 유료 광고를 켠 적이 없습니다)",
    };
  }
  if (!(installs > 0)) {
    return { cacKrw: null, reason: "외부 설치 0 — 분모가 없어 산출 불가" };
  }
  return { cacKrw: spend / installs, reason: null };
}

/**
 * ★상단 3줄 — 분모를 화면 맨 위에 못 박는다.
 *
 * 3.1% 사고(분자와 분모가 서로 다른 모집단)의 재발 방지 장치가 이 자리다.
 * 넷째 숫자부터는 표로 내려간다.
 */
export function AcquisitionHeadlineView({
  unified,
  cac,
}: {
  unified: AcquisitionUnified | null;
  cac: AdminCacSummary | null;
}) {
  if (!unified || unified.state !== "ready" || !unified.headline) {
    return (
      <AcquisitionUnavailable
        data={unified}
        title="설치 · 채널 커버리지 · CAC"
        willShow={[
          "설치 (외부) — 개발·dev 태깅을 뺀 분모의 정본",
          "채널을 아는 설치 — '유입 0' 과 '모름' 을 가르는 한 칸",
          "획득 CAC — 광고비 ÷ 외부 설치",
        ]}
      />
    );
  }
  const h = unified.headline.hygiene;
  const spend =
    cac?.state === "ingested" && cac.summary
      ? cac.summary.matchedSpendKrw + cac.summary.unmatchedSpendKrw
      : null;
  const cacResult = acquisitionCac({
    spendKrw: spend,
    installsExternal: h.installsExternal,
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* ① 분모의 정본. ★전체와 사람 추정치를 같이 낸다 — 하나만 내면
            반드시 오독된다(실측: 설치 631행이 브라우저 5개, #1198). */}
        <StatCard
          label="설치 (외부)"
          value={`${fmtInt(h.installsExternal)} / ${fmtInt(h.installsTotal)}`}
          sub={`사람 추정 ${fmtInt(h.humanEstimateMin)}~${fmtInt(
            h.humanEstimateMax
          )}명 · dev ${fmtInt(h.installsDev)} 제외`}
        />
        {/* ② "유입 0" 과 "모름" 을 가르는 한 칸. */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs text-zinc-500">채널을 아는 설치</p>
          <div className="mt-1.5">
            <UnifiedRatioCell
              value={unified.headline.channelKnown}
              title="COUNTIF(hasGa4Row) / 외부 설치. 낮으면 '유입이 없다' 가 아니라 '조인이 안 됐다' 다."
            />
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">
            나머지의 사유는 아래 <b className="text-zinc-500">채널 미상 사유표</b>
            에 전부 있습니다
          </p>
        </div>
        {/* ③ CAC — 지출 0 이면 0원이 아니라 산출 불가. */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs text-zinc-500">획득 CAC</p>
          {cacResult.cacKrw == null ? (
            <p className="mt-1.5 text-sm leading-relaxed text-amber-300/90">
              {cacResult.reason}
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-zinc-100">
                {fmtKrw(Math.round(cacResult.cacKrw))}
              </p>
              <p className="mt-1 text-[11px] tabular-nums text-zinc-600">
                {fmtKrw(spend ?? 0)} ÷ {fmtInt(h.installsExternal)} 설치
              </p>
            </>
          )}
        </div>
      </div>
      {/* ★위생 경보는 주석이 아니라 화면에 있다 — 주석은 안 읽힌다. */}
      {unified.notes.length > 0 && (
        <ul className="space-y-1 text-[11px] leading-relaxed text-amber-200/80">
          {unified.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
      {h.hygieneMissingReason && (
        <p className="text-[11px] text-zinc-500">· {h.hygieneMissingReason}</p>
      )}
      {h.byInstallClass.length > 0 && (
        <p className="text-[11px] text-zinc-500">
          분모 위생 등급(#1198):{" "}
          {h.byInstallClass
            .map(
              (c) =>
                `${INSTALL_CLASS_LABEL[c.installClass] ?? c.installClass} ${fmtInt(
                  c.installs
                )}`
            )
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

/**
 * ★뷰에 아직 없는 파생 컬럼. 화면이 대신 계산하면 계획 §0 이 재발하므로
 * 계산하지 않고 **없다고 적는다.**
 */
export function PendingColumnsNote({
  columns,
}: {
  columns: Array<{ column: string; blocks: string }>;
}) {
  if (!columns || columns.length === 0) return null;
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
      아직 <b className="text-zinc-400">열이 없는 것</b>:{" "}
      {columns.map((c) => `${c.blocks}(${c.column})`).join(" · ")}. 잔존은{" "}
      <b>횟수가 아니라 복귀 여부</b>고 창이 안 닫힌 설치는 NULL 이어야 하는데, 그
      규칙을 화면 네 군데가 각자 구현하면 지금과 똑같아집니다 — 그래서 0 으로도
      퍼센트로도 그리지 않고 뷰가 컬럼으로 줄 때까지 비워 둡니다(계획 §3-3).
    </p>
  );
}

/**
 * 채널별 통합표. ★`channelMissingReason IS NULL` — 캠페인이 실재하는 행만.
 *
 * 광고 전인 지금 이 표는 0행이다. 그 자리에 "유료 광고를 켠 적이 없습니다" 라고
 * 쓴다 — 빈 표를 '유입 0' 으로 속이지 않는다.
 */
export function AcquisitionChannelTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  if (!data || data.state !== "ready") {
    return (
      <AcquisitionUnavailable
        data={data}
        title="채널별 획득 (소스 · 매체 · 캠페인 · 소재)"
        willShow={[
          "캠페인이 실재하는 행만 — 소스 × 매체 × 캠페인 × 소재",
          "설치 · 첫 스폰 · 첫 완주",
        ]}
      />
    );
  }
  if (data.channelRows.length === 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5 text-xs leading-relaxed text-zinc-400">
          <b className="text-zinc-200">유료 광고를 켠 적이 없습니다.</b> 이 표는
          캠페인이 <b>실재하는</b> 설치만 셉니다(
          <span className="font-mono">channelMissingReason IS NULL</span>). 지금
          0행인 것은 유입이 0 이라는 뜻이 아니라 캠페인 태그가 붙은 유입이 아직
          없다는 뜻이고, 나머지 설치가 어디로 갔는지는 바로 아래{" "}
          <b className="text-zinc-200">채널 미상 사유표</b>가 전부 말합니다.
        </div>
        <PendingColumnsNote columns={data.pendingColumns} />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 font-medium">소스 / 매체</th>
            <th className="py-2 pr-3 font-medium">캠페인</th>
            <th className="py-2 pr-3 font-medium">소재</th>
            <th className="py-2 pr-3 text-right font-medium">설치</th>
            <th className="py-2 pr-3 text-right font-medium">
              첫 스폰 <span className="text-zinc-600">/설치</span>
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              첫 완주 <span className="text-zinc-600">/설치</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.channelRows.map((r, i) => (
            <tr
              key={`${r.source}|${r.medium}|${r.campaign}|${r.content}|${i}`}
              className="border-b border-zinc-900/60 text-zinc-300"
            >
              <td className="py-2 pr-3 text-zinc-100">
                {r.source ?? "—"} / {r.medium ?? "—"}
              </td>
              <td className="py-2 pr-3">{r.campaign ?? "—"}</td>
              <td className="py-2 pr-3">{r.content ?? "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(r.installs)}
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.spawned} />
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.completed} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.channelRowsTruncated && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          ★상위 {data.channelRows.length}행만 보여 줍니다 — 잘렸다는 사실을
          숨기지 않습니다.
        </p>
      )}
      <PendingColumnsNote columns={data.pendingColumns} />
    </div>
  );
}

/**
 * ★★채널 미상 사유표 — 이 페이지에서 가장 중요한 신설물(계획 §4-1 표2).
 *
 * 위의 채널표가 비었을 때 그게 "광고를 안 켰다" 인지 "조인이 깨졌다" 인지는
 * 여기서만 알 수 있다. 두 답은 우리가 할 일이 정반대다 — 전자는 아무것도 안 해도
 * 되고, 후자는 오늘 백필을 돌려야 한다.
 *
 * ★`no_utm`(안다 — 자연유입)과 `no_ga4_row`(모른다 — 조인 실패)를 같은 칸에
 *   두지 않는다. 자연 유입을 결측으로 오독하면 채널 판단이 통째로 뒤집힌다.
 */
export function ChannelMissingReasonTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  if (!data || data.state !== "ready") {
    return (
      <AcquisitionUnavailable
        data={data}
        title="채널 미상 사유"
        willShow={[
          "no_ledger_row / no_ga_client_id / key_mismatch / no_ga4_row / no_utm 분포",
          "★'모른다' 와 '안다, 캠페인이 없었다' 의 구분",
        ]}
      />
    );
  }
  const rows = data.missingReasonRows;
  if (rows.length === 0) return <EmptyState label="설치가 한 건도 없습니다." />;
  const unknown = rows
    .filter((r) => r.kind === "unknown")
    .reduce((a, r) => a + r.installs, 0);
  const trueZero = rows
    .filter((r) => r.kind === "true_zero")
    .reduce((a, r) => a + r.installs, 0);
  return (
    <div className="space-y-3">
      {/* ★한 줄 요약이 이 표의 요점이다 — 모름과 진짜 0 은 다른 물건이다. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          data-testid="channel-reason-unknown"
          className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100"
        >
          <b className="tabular-nums">{fmtInt(unknown)}건</b> — <b>모른다.</b>{" "}
          조인이 깨졌거나 키가 없습니다. 백필·배포로 채워질 수 있는 쪽입니다.
        </div>
        <div
          data-testid="channel-reason-true-zero"
          className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs leading-relaxed text-emerald-100"
        >
          <b className="tabular-nums">{fmtInt(trueZero)}건</b> —{" "}
          <b>안다, 캠페인이 없었다.</b> 자연·직접 유입입니다.{" "}
          <b>결측이 아니라 진짜 0</b> 이라 백필할 것이 없습니다.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="py-2 pr-3 font-medium">사유</th>
              <th className="py-2 pr-3 font-medium">뜻</th>
              <th className="py-2 pr-3 text-center font-medium">GA4 행</th>
              <th className="py-2 pr-3 text-right font-medium">설치</th>
              <th className="py-2 pr-3 font-medium">
                이 값이 크면 우리가 하는 일
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.reason}|${String(r.hasGa4Row)}`}
                className="border-b border-zinc-900/60 text-zinc-300"
              >
                <td className="py-2 pr-3 font-mono text-[11px] text-zinc-100">
                  {r.reason}
                </td>
                <td
                  className={`py-2 pr-3 ${
                    r.kind === "true_zero"
                      ? "text-emerald-300"
                      : r.kind === "known"
                      ? "text-zinc-300"
                      : "text-amber-300"
                  }`}
                >
                  {r.label}
                </td>
                <td className="py-2 pr-3 text-center text-zinc-500">
                  {r.hasGa4Row ? "있음" : "없음"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-100">
                  {fmtInt(r.installs)}
                </td>
                <td className="py-2 pr-3 text-zinc-500">{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 국가별 — ★설치 축이다. 위의 방문 축(GA4 브라우저) 표와 분모가 다르므로 두
 * 표를 곱해서 읽으면 안 된다. 그 사실을 섹션 머리에 적는다.
 */
export function AcquisitionCountryTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  if (!data || data.state !== "ready") {
    return (
      <AcquisitionUnavailable
        data={data}
        title="국가별 획득 (설치 축)"
        willShow={["국가 × 설치 · 채널 커버리지 · 첫 스폰"]}
      />
    );
  }
  if (data.countryRows.length === 0) {
    return <EmptyState label="설치가 한 건도 없습니다." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 font-medium">국가</th>
            <th className="py-2 pr-3 text-right font-medium">설치</th>
            <th className="py-2 pr-3 text-right font-medium">
              채널 앎 <span className="text-zinc-600">/설치</span>
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              첫 스폰 <span className="text-zinc-600">/설치</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.countryRows.map((r, i) => (
            <tr
              key={`${r.country ?? "null"}|${i}`}
              className="border-b border-zinc-900/60 text-zinc-300"
            >
              <td className="py-2 pr-3 text-zinc-100">
                {r.country ?? (
                  <span
                    className="text-zinc-500"
                    title="GA4 행이 안 붙어 국가를 모른다. '해외' 가 아니라 '미상' 이다."
                  >
                    미상
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(r.installs)}
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.channelKnown} />
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.spawned} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.countryRowsTruncated && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          ★상위 {data.countryRows.length}개국만 보여 줍니다 — 잘렸다는 사실을
          숨기지 않습니다.
        </p>
      )}
    </div>
  );
}

function PendingMetricCard({
  label,
  waitingOn,
  sub,
}: {
  label: string;
  waitingOn: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1.5 text-sm font-semibold text-amber-300">판단 대기</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        {waitingOn}
        {sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}

function unifiedHumanRange(data: AcquisitionUnified | null): string | null {
  const h = data?.headline?.hygiene;
  if (!h) return null;
  return `사람 추정 ${fmtInt(h.humanEstimateMin)}~${fmtInt(
    h.humanEstimateMax
  )}명 · 폭 자체가 분모 불확실성`;
}

export function UnifiedActivationHeadlineView({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  if (!data || data.state !== "ready" || !data.headline) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="첫 스폰 · 첫 완주 · 첫 스폰까지 중앙 소요"
        willShow={[
          "첫 스폰 도달 — COUNTIF(hasSpawned) / 외부 설치",
          "첫 완주 도달 — firstCompletedAt IS NOT NULL / 외부 설치",
          "첫 스폰까지 중앙 소요 — minutesToFirstSpawn 중앙값",
        ]}
      />
    );
  }
  const activation = data.activation;
  const spawn = activation?.spawned ?? data.headline.spawned;
  const completed = activation?.completed ?? null;
  const humanRange = unifiedHumanRange(data);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs text-zinc-500">첫 스폰 도달</p>
          <div className="mt-1.5">
            <UnifiedRatioCell
              value={spawn}
              title="COUNTIF(hasSpawned) / 외부 설치. 분자와 분모가 같은 설치 축입니다."
            />
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">{humanRange}</p>
        </div>
        {completed ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="text-xs text-zinc-500">첫 완주 도달</p>
            <div className="mt-1.5">
              <UnifiedRatioCell
                value={completed}
                title="COUNTIF(firstCompletedAt IS NOT NULL) / 외부 설치"
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">{humanRange}</p>
          </div>
        ) : (
          <PendingMetricCard
            label="첫 완주 도달"
            waitingOn="통합 읽기 경로가 firstCompletedAt 전체 분자/분모를 싣기 전까지 0 으로 그리지 않습니다."
            sub={humanRange ?? undefined}
          />
        )}
        {activation?.medianMinutesToFirstSpawn != null ? (
          <StatCard
            label="첫 스폰까지 중앙 소요"
            value={`${fmtInt(activation.medianMinutesToFirstSpawn)}분`}
            sub="minutesToFirstSpawn 중앙값 · B6 10분 임계 대신 실제 분포"
          />
        ) : (
          <PendingMetricCard
            label="첫 스폰까지 중앙 소요"
            waitingOn={
              activation?.medianMinutesToFirstSpawnReason ??
              "minutesToFirstSpawn 열 대기 — daysToFirstSpawn 으로 분 단위를 지어내지 않습니다."
            }
          />
        )}
      </div>
      <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-500">
        근거: <span className="font-mono">{data.source}</span>. 설치 축은{" "}
        <span className="tabular-nums">
          {fmtInt(data.headline.hygiene.installsExternal)} /{" "}
          {fmtInt(data.headline.hygiene.installsTotal)}
        </span>
        이고, 사람 수는 단일값이 아니라 {humanRange} 입니다.
      </p>
    </div>
  );
}

export function UnifiedActivationChannelTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  if (!data || data.state !== "ready") {
    return (
      <AcquisitionUnavailable
        data={data}
        title="채널별 활성화"
        willShow={["채널 × 첫스폰률 × 첫완주률", "표본 부족이면 분수만 표시"]}
      />
    );
  }
  const rows =
    data.activation?.channelRows ??
    data.channelRows.map((r) => ({
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      installs: r.installs,
      spawned: r.spawned,
      completed: r.completed,
    }));
  if (rows.length === 0) {
    return (
      <EmptyState label="캠페인이 실재하는 채널 행이 없습니다 — 채널 품질을 0% 로 그리지 않습니다. 채널 미상 사유는 획득 탭 표를 보세요." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 font-medium">소스 / 매체</th>
            <th className="py-2 pr-3 font-medium">캠페인</th>
            <th className="py-2 pr-3 text-right font-medium">설치</th>
            <th className="py-2 pr-3 text-right font-medium">첫 스폰</th>
            <th className="py-2 pr-3 text-right font-medium">첫 완주</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.source}|${r.medium}|${r.campaign}|${i}`}
              className="border-b border-zinc-900/60 text-zinc-300"
            >
              <td className="py-2 pr-3 text-zinc-100">
                {r.source ?? "—"} / {r.medium ?? "—"}
              </td>
              <td className="py-2 pr-3">{r.campaign ?? "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(r.installs)}
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.spawned} />
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.completed} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(data.activation?.channelRowsTruncated ?? data.channelRowsTruncated) && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          상위 {rows.length}행만 표시합니다 — 잘렸다는 사실을 숨기지 않습니다.
        </p>
      )}
    </div>
  );
}

export function UnifiedZombieSeparationView({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const zombie = data?.state === "ready" ? data.retention?.zombie ?? null : null;
  if (!zombie) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="좀비 분리"
        willShow={[
          "activeDaysTotal vs observedDays",
          "하트비트만 있는 설치와 실제 활동 설치 분리",
        ]}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <RatioCard
        label="활동 설치"
        numerator={zombie.activeInstalls}
        denominator={zombie.observedInstalls}
        sub="activeDaysTotal 기준"
      />
      <StatCard
        label="좀비 설치"
        value={fmtInt(zombie.zombieInstalls)}
        sub="하트비트만 · 활동 아님"
        accent={zombie.zombieInstalls > 0 ? STATUS_WARN : undefined}
      />
      <StatCard
        label="한 번도 안 켬"
        value={fmtInt(zombie.neverRanInstalls)}
        sub="좀비와 원인이 달라 합치지 않음"
      />
      <StatCard
        label="관측 설치"
        value={fmtInt(zombie.observedInstalls)}
        sub="분모 후보"
      />
    </div>
  );
}

export function FoldedActivationSmallSamples() {
  const rows = [
    ["베타종료 게이지", "각 게이지 분모 n≥30"],
    ["CLI 셋업 위저드", "3.0.19+ 설치 n≥30"],
    ["첫프로젝트 만족도", "응답 ≥10"],
    ["샘플 데모 퍼널", "n≥30"],
    ["마케팅 수신 동의", "n≥30"],
    ["CLI 실패 마이크로설문", "응답 ≥10"],
  ] as const;
  return (
    <Panel
      title="표본 찰 때까지 접힘"
      note="열면 오해하는 지표는 기본 화면에서 내린다"
    >
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map(([label, threshold]) => (
            <tr key={label} className="border-b border-zinc-900/60">
              <td className="py-2 pr-3 text-zinc-300">{label}</td>
              <td className="py-2 pr-3 text-zinc-500">{threshold}</td>
              <td className="py-2 pr-3 text-right text-amber-300">표본 대기</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function UnifiedRetentionHeadlineView({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const retention = data?.state === "ready" ? data.retention ?? null : null;
  if (!data || data.state !== "ready" || !retention) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="D7 · D30 잔존 · 아직 판단 불가"
        willShow={[
          "D7 잔존 — retainedD7 IS NOT NULL 인 설치만 분모",
          "D30 잔존 — retainedD30 IS NOT NULL 인 설치만 분모",
          "아직 판단 불가 — d7_pending/d30_pending",
        ]}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <p className="text-xs text-zinc-500">D7 잔존</p>
        <div className="mt-1.5">
          <UnifiedRatioCell
            value={retention.d7}
            title="COUNTIF(retainedD7) / COUNTIF(retainedD7 IS NOT NULL)"
          />
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          판단 전 {fmtInt(retention.pendingD7)}건은 분모에서 제외
        </p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <p className="text-xs text-zinc-500">D30 잔존</p>
        <div className="mt-1.5">
          <UnifiedRatioCell
            value={retention.d30}
            title="COUNTIF(retainedD30) / COUNTIF(retainedD30 IS NOT NULL)"
          />
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          판단 전 {fmtInt(retention.pendingD30)}건은 분모에서 제외
        </p>
      </div>
      <StatCard
        label="아직 판단 불가"
        value={fmtInt(retention.pendingD7)}
        sub="D7 창 미도달 · 0% 로 그리지 않음"
        accent={retention.pendingD7 > 0 ? STATUS_WARN : undefined}
      />
    </div>
  );
}

function retentionHorizonLabel(key: UnifiedRetentionHorizonKey): string {
  return key.toUpperCase();
}

export function UnifiedRetentionCohortTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const retention = data?.state === "ready" ? data.retention ?? null : null;
  if (!data || data.state !== "ready" || !retention) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="주간 코호트"
        willShow={[
          "cohortWeek × D1/D7/D14/D30",
          "창이 안 닫힌 칸은 d*_pending 으로 분모에서 제외",
        ]}
      />
    );
  }
  if (retention.cohortRows.length === 0) {
    return <EmptyState label="코호트 행이 없습니다 — 0% 가 아니라 표본 공백입니다." />;
  }
  const horizonKeys: UnifiedRetentionHorizonKey[] = ["d1", "d7", "d14", "d30"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 text-left font-medium">코호트 주</th>
            <th className="py-2 pr-3 text-right font-medium">설치</th>
            {horizonKeys.map((key) => (
              <th key={key} className="py-2 pr-3 text-right font-medium">
                {retentionHorizonLabel(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retention.cohortRows.map((row) => {
            const byKey = new Map(row.horizons.map((h) => [h.key, h]));
            return (
              <tr key={row.cohortWeek} className="border-b border-zinc-900/60">
                <td className="py-2 pr-3 tabular-nums text-zinc-100">
                  {row.cohortWeek}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">
                  {fmtInt(row.installs)}
                </td>
                {horizonKeys.map((key) => {
                  const h = byKey.get(key);
                  return (
                    <td key={key} className="py-2 pr-3 text-right">
                      {h?.retained ? (
                        <span className="inline-flex flex-col items-end gap-0.5">
                          <UnifiedRatioCell value={h.retained} />
                          {h.pending > 0 && (
                            <span className="text-[10px] tabular-nums text-zinc-600">
                              판단 전 {fmtInt(h.pending)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span title="관측창 미도달 또는 분모 없음 — 0% 가 아니라 판단 불가입니다.">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {retention.cohortRowsTruncated && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          상위 {retention.cohortRows.length}개 코호트만 표시합니다.
        </p>
      )}
    </div>
  );
}

export function UnifiedRetentionChannelTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const retention = data?.state === "ready" ? data.retention ?? null : null;
  if (!data || data.state !== "ready" || !retention) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="채널별 리텐션"
        willShow={["채널 × D7 · D30", "채널×주차로 과분해하지 않음"]}
      />
    );
  }
  if (retention.channelRows.length === 0) {
    return (
      <EmptyState label="캠페인이 실재하는 채널 행이 없습니다 — 채널 리텐션을 0% 로 그리지 않습니다." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 font-medium">소스 / 매체</th>
            <th className="py-2 pr-3 font-medium">캠페인</th>
            <th className="py-2 pr-3 text-right font-medium">설치</th>
            <th className="py-2 pr-3 text-right font-medium">D7</th>
            <th className="py-2 pr-3 text-right font-medium">D30</th>
          </tr>
        </thead>
        <tbody>
          {retention.channelRows.map((r, i) => (
            <tr
              key={`${r.source}|${r.medium}|${r.campaign}|${i}`}
              className="border-b border-zinc-900/60 text-zinc-300"
            >
              <td className="py-2 pr-3 text-zinc-100">
                {r.source ?? "—"} / {r.medium ?? "—"}
              </td>
              <td className="py-2 pr-3">{r.campaign ?? "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(r.installs)}
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.d7} />
                {r.pendingD7 > 0 && (
                  <span className="ml-1 text-[10px] text-zinc-600">
                    판단 전 {fmtInt(r.pendingD7)}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right">
                <UnifiedRatioCell value={r.d30} />
                {r.pendingD30 > 0 && (
                  <span className="ml-1 text-[10px] text-zinc-600">
                    판단 전 {fmtInt(r.pendingD30)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {retention.channelRowsTruncated && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          상위 {retention.channelRows.length}행만 표시합니다.
        </p>
      )}
    </div>
  );
}

export function UnifiedPersonAxisComparison({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  if (!data || data.state !== "ready" || !data.headline) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="사람 축 대조"
        willShow={[
          "설치 수 · 사람 추정 범위",
          "identity_linked_ratio",
          "personInstallCount ≥ 2 인 사람 수",
        ]}
      />
    );
  }
  const hygiene = data.headline.hygiene;
  const person = data.retention?.personAxis;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard
          label="설치"
          value={fmtInt(hygiene.installsExternal)}
          sub={`전체 ${fmtInt(hygiene.installsTotal)} · dev ${fmtInt(
            hygiene.installsDev
          )} 제외`}
        />
        <StatCard
          label="사람 추정"
          value={`${fmtInt(hygiene.humanEstimateMin)}~${fmtInt(
            hygiene.humanEstimateMax
          )}명`}
          sub="범위의 폭이 정보"
        />
        {person?.identityLinked ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="text-xs text-zinc-500">identity_linked_ratio</p>
            <div className="mt-1.5">
              <UnifiedRatioCell value={person.identityLinked} />
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">설치↔사람 다리</p>
          </div>
        ) : (
          <PendingMetricCard
            label="identity_linked_ratio"
            waitingOn={`${CALLABLE_INSTALL_UNIFIED} / v_install_unified 의 personKey/personLinkCount 집계 대기 — 사람 없음으로 읽지 않습니다.`}
          />
        )}
        <StatCard
          label="다중 설치 사람"
          value={person ? fmtInt(person.multiInstallPeople) : "—"}
          sub="personInstallCount ≥ 2"
        />
      </div>
      <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">
        설치 ≠ 사람입니다. 실측상 배포 전 재설치 루프가 크므로 설치 단일값만
        보면 사람이 부풀어 보입니다. 한 브라우저 최대 설치 수:{" "}
        <span className="tabular-nums">
          {fmtInt(person?.maxInstallsPerBrowser ?? hygiene.maxInstallsPerBrowser)}
        </span>
        .
      </p>
    </div>
  );
}

export function UnifiedRevenueHeadlineView({
  data,
  business,
}: {
  data: AcquisitionUnified | null;
  business: BusinessSummary | null;
}) {
  const revenue = data?.state === "ready" ? data.revenue ?? null : null;
  if (!data || data.state !== "ready" || !revenue) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="수익 헤드라인"
        willShow={[
          "외부 매출(누적) — 원장 정본",
          "GA4 purchase 매출 — 채널 귀속 보조",
          "설치→결제 전환 — 결제 축을 아는 설치만 분모",
        ]}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label="외부 매출 (원장)"
          value={
            revenue.ledger.externalKrw == null
              ? "—"
              : fmtKrw(revenue.ledger.externalKrw)
          }
          sub={
            revenue.ledger.missingReason
              ? `미상: ${revenue.ledger.missingReason}`
              : `${fmtInt(revenue.ledger.externalRows)}건 · ${
                  revenue.ledger.currency ?? "통화 미상"
                }`
          }
          accent={
            revenue.ledger.externalKrw == null
              ? undefined
              : revenue.ledger.externalKrw > 0
              ? STATUS_GOOD
              : undefined
          }
        />
        <StatCard
          label="GA4 매출 (보조)"
          value={
            revenue.ga4.revenueKrw == null
              ? "—"
              : fmtKrw(revenue.ga4.revenueKrw)
          }
          sub={
            revenue.ga4.missingReason
              ? `미상: ${revenue.ga4.missingReason}`
              : `${fmtInt(revenue.ga4.purchaseEvents)} purchase · ${
                  revenue.ga4.currency ?? "통화 미상"
                }`
          }
          accent={
            revenue.revenueDivergenceReason ? STATUS_WARN : undefined
          }
        />
        {revenue.installToPurchase ? (
          <RatioCard
            label="설치 → 결제 전환"
            numerator={revenue.installToPurchase.numerator}
            denominator={revenue.installToPurchase.denominator}
            sub="분모 = 결제 축을 아는 설치"
          />
        ) : (
          <StatCard
            label="설치 → 결제 전환"
            value="—"
            sub="설치↔사람 다리 미상 · 0 으로 그리지 않음"
          />
        )}
      </div>

      {business ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatCard
            label="유료 구독자"
            value={fmtInt(business.subscriptions.paidProActive)}
            sub={`Firestore 원장 · active ${fmtInt(
              business.subscriptions.activeCurrent
            )}`}
            accent={SERIES}
          />
          <StatCard
            label="무료 부여"
            value={fmtInt(business.subscriptions.founderGrantActive)}
            sub="founderGrant · 매출 아님"
          />
          <StatCard
            label="연체·이탈"
            value={`${fmtInt(business.subscriptions.pastDue)} / ${fmtInt(
              business.subscriptions.churnedInWindow
            )}`}
            sub={`past_due / churn · ${business.rangeDays}일`}
            accent={
              business.subscriptions.pastDue +
                business.subscriptions.churnedInWindow >
              0
                ? STATUS_WARN
                : undefined
            }
          />
        </div>
      ) : null}

      {revenue.revenueDivergenceReason ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            원장과 GA4 매출이 갈립니다: {revenue.revenueDivergenceReason}. 원장은
            정본이고 GA4 는 광고차단·쿠키거부로 샐 수 있는 보조 경로입니다.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            원장 매출과 GA4 이커머스를 둘 다 표시합니다. 값이 갈리면 화면에서
            하나를 고르지 않고 대조 사유를 함께 둡니다.
          </span>
        </p>
      )}
    </div>
  );
}

export function UnifiedRevenueClassificationView({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const revenue = data?.state === "ready" ? data.revenue ?? null : null;
  if (!data || data.state !== "ready" || !revenue) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="실매출 · 결제 분류"
        willShow={[
          "외부 결제 1건(19,000원, portone)",
          "founder_grant 33건 · 내부테스트 1건",
          "금액 미상 행 — 0 으로 접지 않음",
        ]}
      />
    );
  }
  const c = revenue.classification;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard
          label="외부 결제"
          value={
            c.externalPaidKrw == null ? "—" : fmtKrw(c.externalPaidKrw)
          }
          sub={`${fmtInt(c.externalPaidRows)}건 · ${
            c.externalProvider ?? "provider 미상"
          }`}
          accent={c.externalPaidRows > 0 ? STATUS_GOOD : undefined}
        />
        <StatCard
          label="founder_grant"
          value={fmtInt(c.grantRows)}
          sub="무상 부여 · 매출 아님"
        />
        <StatCard
          label="내부테스트"
          value={fmtInt(c.internalPaidRows)}
          sub="내부·운영자 결제 · 매출 제외"
        />
        <StatCard
          label="미분류"
          value={fmtInt(c.unclassifiedRows)}
          sub="account_class 판정 전"
          accent={c.unclassifiedRows > 0 ? STATUS_WARN : undefined}
        />
        <StatCard
          label="금액 미상"
          value={fmtInt(c.amountUnknownRows)}
          sub={`원장 총 ${fmtInt(c.totalRows)}행 · 0 아님`}
          accent={c.amountUnknownRows > 0 ? STATUS_WARN : undefined}
        />
      </div>
      <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          원장 35행은 founder_grant 33 · 내부테스트 1 · 외부 1로 갈라 읽습니다.
          외부 1건은 실제 매출이고, founder_grant 와 내부 결제는 매출 합계에서
          제외하되 숨기지 않습니다.
        </span>
      </p>
    </div>
  );
}

export function UnifiedRevenueMissingReasonTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const revenue = data?.state === "ready" ? data.revenue ?? null : null;
  if (!data || data.state !== "ready" || !revenue) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="결제 축 미상 사유"
        willShow={[
          "적재 전 — 배선이 아직 없음",
          "진짜 0 — 결제 축을 알고 결제가 없음",
          "미상 — analytics_user_daily.install_key_hmac 다리 없음",
        ]}
      />
    );
  }

  const totals = revenue.missingReasonRows.reduce(
    (acc, row) => {
      acc[row.kind] += row.installs;
      return acc;
    },
    { pre_ingestion: 0, unknown: 0, true_zero: 0, known: 0 }
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label="적재 전"
          value={fmtInt(totals.pre_ingestion)}
          sub="배선이 아직 안 됨"
          accent={totals.pre_ingestion > 0 ? STATUS_WARN : undefined}
        />
        <StatCard
          label="진짜 0"
          value={fmtInt(totals.true_zero)}
          sub="결제 축을 알고 결제가 없음"
          accent={totals.true_zero > 0 ? STATUS_GOOD : undefined}
        />
        <StatCard
          label="미상"
          value={fmtInt(totals.unknown)}
          sub="설치↔사람 다리 없음 · 0 아님"
          accent={totals.unknown > 0 ? STATUS_WARN : undefined}
        />
      </div>

      {revenue.missingReasonRows.length === 0 ? (
        <EmptyState label="결제 축 사유 행이 없습니다 — 비었다고 0 으로 그리지 않습니다." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-3 font-medium">구분</th>
                <th className="py-2 pr-3 font-medium">사유</th>
                <th className="py-2 pr-3 text-right font-medium">설치</th>
                <th className="py-2 font-medium">다음 행동</th>
              </tr>
            </thead>
            <tbody>
              {revenue.missingReasonRows.map((row, i) => (
                <tr
                  key={`${row.kind}-${row.reason ?? "null"}-${i}`}
                  className="border-b border-zinc-900/60 text-zinc-300"
                >
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        row.kind === "true_zero"
                          ? "bg-emerald-950/40 text-emerald-300"
                          : row.kind === "known"
                          ? "bg-zinc-800 text-zinc-300"
                          : "bg-amber-950/40 text-amber-200"
                      }`}
                    >
                      {row.kind === "pre_ingestion"
                        ? "적재 전"
                        : row.kind === "true_zero"
                        ? "진짜 0"
                        : row.kind === "known"
                        ? "알려짐"
                        : "미상"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-100">{row.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-100">
                    {fmtInt(row.installs)}
                  </td>
                  <td className="py-2 text-zinc-500">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          `analytics_user_daily.install_key_hmac` 가 NULL 인 행은 매출 0이 아니라
          설치에 결제를 붙일 수 없는 미상입니다. 이 칸을 0으로 그리면 “매출이
          없다”로 읽힙니다.
        </span>
      </p>
    </div>
  );
}

export function UnifiedRevenueChannelTable({
  data,
}: {
  data: AcquisitionUnified | null;
}) {
  const revenue = data?.state === "ready" ? data.revenue ?? null : null;
  if (!data || data.state !== "ready" || !revenue) {
    return (
      <AcquisitionUnavailable
        data={data}
        title="채널별 매출"
        willShow={[
          "채널 × 결제자 × 원장 매출",
          "채널 × GA4 purchase 매출",
          "원장↔GA4 대조 사유",
        ]}
      />
    );
  }
  if (revenue.channelRows.length === 0) {
    return (
      <EmptyState label="채널에 귀속된 매출 행이 없습니다 — 결제 축 미상 사유표를 먼저 보세요." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="py-2 pr-3 font-medium">소스 / 매체</th>
            <th className="py-2 pr-3 font-medium">캠페인</th>
            <th className="py-2 pr-3 text-right font-medium">설치</th>
            <th className="py-2 pr-3 text-right font-medium">결제자</th>
            <th className="py-2 pr-3 text-right font-medium">원장 매출</th>
            <th className="py-2 pr-3 text-right font-medium">GA4 매출</th>
            <th className="py-2 font-medium">대조</th>
          </tr>
        </thead>
        <tbody>
          {revenue.channelRows.map((row, i) => (
            <tr
              key={`${row.source}|${row.medium}|${row.campaign}|${i}`}
              className="border-b border-zinc-900/60 text-zinc-300"
            >
              <td className="py-2 pr-3 text-zinc-100">
                {row.source ?? "—"} / {row.medium ?? "—"}
              </td>
              <td className="py-2 pr-3">{row.campaign ?? "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(row.installs)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {fmtInt(row.purchasers)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-zinc-100">
                {row.ledgerRevenueKrw == null ? "—" : fmtKrw(row.ledgerRevenueKrw)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-zinc-100">
                {row.ga4RevenueKrw == null ? "—" : fmtKrw(row.ga4RevenueKrw)}
              </td>
              <td className="py-2 text-zinc-500">
                {row.revenueDivergenceReason ?? "일치 또는 대조 불필요"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {revenue.channelRowsTruncated && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          상위 {revenue.channelRows.length}행만 표시합니다.
        </p>
      )}
    </div>
  );
}

/**
 * ★운영자(존킴) 제외가 **실제로 걸렸는지** 를 이 퍼널 기준으로 말한다.
 *
 * 지금까지 응답은 `applied: !includeAdmin` 만 내려보냈고 화면은 그걸 "제외됨"
 * 으로 읽었다. 그런데 events 제외절은 `metadata.accountUserId` 로만 거르는데,
 * 계정축 은퇴로 신규 row 에는 그 필드가 아예 없다 — 절은 통과하고 **아무도 안
 * 빠진다.** 서버가 실측으로 준 matchableRows(창 안에 그 필드가 남아 있는 행 수)
 * 가 0 이면, "제외됨" 이라고 말하는 것 자체가 거짓이다.
 *
 * 사장님이 물으신 "최근 데이터 존킴 계정은 빠진 거지?" 에 대한 화면의 답이 여기다.
 */
export function FunnelAdminExclusionNote({
  adminExcluded,
}: {
  adminExcluded?: AdminExcludedTelemetry;
}) {
  if (!adminExcluded) return null;
  const requested = adminExcluded.applied !== false;
  const matchable = adminExcluded.matchableRows;
  // 구버전 functions(미제공)면 아무 말도 하지 않는다 — 근거 없이 단정하지 않는다.
  if (matchable == null) return null;

  if (!requested) {
    return (
      <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200/90">
        🟠 운영자 포함 모드입니다 — 이 퍼널에는 운영자(도그푸딩) 활동이 그대로
        들어 있습니다.
      </p>
    );
  }
  if (matchable === 0) {
    return (
      <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200/90">
        ⚠️ <b>운영자 제외가 실제로는 적용되지 않았습니다.</b> 이 축의 제외기는
        이벤트에 붙어 있던 계정 UID로만 걸러내는데, 계정축 은퇴 이후 이벤트에는
        그 값이 붙지 않습니다 — 이 조회창 안에 걸러낼 수 있는 행이{" "}
        <b>한 건도 없습니다</b>. 따라서 아래 숫자에는 운영자 본인의 설치가 포함돼
        있을 수 있습니다. (설치 단위 익명 축이라 사후 식별도 불가능합니다.)
      </p>
    );
  }
  return (
    <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-500">
      운영자 제외: 계정 UID가 남아 있는 행에만 적용됩니다(이 조회창{" "}
      <span className="tabular-nums">{fmtInt(matchable)}</span>행). 계정축 은퇴
      이후의 이벤트에는 UID가 붙지 않아 그 구간은 제외되지 않습니다 — 최근으로
      올수록 운영자 활동이 섞여 있을 수 있습니다.
    </p>
  );
}

export function OnboardingFunnelView({
  funnel,
}: {
  funnel: OnboardingFunnel;
}) {
  const steps = funnel.steps;
  const maxClients = Math.max(1, ...steps.map((s) => s.clients));
  // ★순차 도달이 전부 0 이어도 창 안 실측(everInWindow)이 있으면 빈 화면이
  //   아니다 — 오히려 그때가 "정의가 다 걸러냈다" 는 걸 말해야 하는 순간이다.
  const hasAny = steps.some(
    (s) => s.clients > 0 || s.events > 0 || (s.everInWindow ?? 0) > 0
  );
  const failuresWithData = funnel.failureBranches.filter(
    (f) => f.clients > 0 || f.events > 0
  );
  const firstRunStep = steps.find(
    (s) =>
      s.key === "first_run" ||
      s.event === "app:first_run" ||
      s.label.includes("최초실행") ||
      s.label.includes("첫 실행")
  );
  const spawnStep = steps.find(
    (s) =>
      s.key.includes("spawn") ||
      s.event === "agent:spawned" ||
      s.label.includes("스폰")
  );
  const preSpawnLossRate =
    firstRunStep && spawnStep && firstRunStep.clients > 0
      ? Math.max(0, firstRunStep.clients - spawnStep.clients) /
        firstRunStep.clients
      : null;
  const completedStep = steps.find(
    (s) =>
      s.event === "task:completed" ||
      s.key.includes("completed") ||
      s.label.includes("티켓 완료")
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
      <FunnelAdminExclusionNote adminExcluded={funnel.adminExcluded} />
      {/* ★헤드라인 활성화 지표 — 가입 후 30분 내 첫 티켓 완료 비율. */}
      {headline && (
        <div className="rounded-xl border border-indigo-800/60 bg-indigo-950/30 p-4">
          <RatioCard
            label="핵심 활성화 (첫 티켓 완료)"
            numerator={headline.activatedClients}
            denominator={headline.baseClients}
            sub={`${headline.windowMinutes}분 창 · 퍼센트보다 분모를 먼저 읽기`}
            title={headline.label}
            accent={headline.activatedClients > 0 ? SERIES_2 : undefined}
          />
          <p className="mt-2 text-xs leading-relaxed text-indigo-300/80">
            {headline.label} · 분모는 가입자 총원이 아니라 이 서버 정의에 들어온
            설치/클라이언트입니다. 조회창 밖 로그인·첫 실행은 분자와 분모에서 함께
            빠집니다.
          </p>
          {/* ★0% 가 "아무도 제품을 완주 안 했다" 로 읽히는 걸 막는다.
              분모(가입)는 조회창 안에 로그인한 설치만 센다 — 그 전에 로그인해
              계속 쓰고 있는 설치는 분자에도 분모에도 없다. 서버가 실측으로 준
              everActivatedInWindow 가 그 차이를 드러내는 유일한 값이다. */}
          {headline.activatedClients === 0 &&
            headline.everActivatedInWindow != null &&
            headline.everActivatedInWindow > 0 && (
              <p className="mt-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-200/90">
                ★이 0% 를 &ldquo;아무도 제품을 끝까지 못 썼다&rdquo;로 읽지
                마십시오. 같은 기간에{" "}
                <b className="tabular-nums">
                  {fmtInt(headline.everActivatedInWindow)}개 설치
                </b>
                가 실제로 첫 티켓을 완료했습니다 — 그 설치들은 로그인이 조회창
                밖이라 분모(가입)에 없어서 분자에서도 빠집니다. 참인 명제는
                &ldquo;이 기간에 새로 가입한 {fmtInt(headline.baseClients)}명 중
                24시간 안에 완료한 사람은 없다&rdquo;까지입니다.
              </p>
            )}
        </div>
      )}
      {firstRunStep && spawnStep && (
        <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-xs leading-relaxed text-red-200/90">
          <p className="font-semibold">가장 큰 이탈은 첫 스폰 전입니다.</p>
          <p className="mt-1">
            앱 첫 실행{" "}
            <b className="tabular-nums">{fmtInt(firstRunStep.clients)}</b> → 첫
            스폰 <Ratio numerator={spawnStep.clients} denominator={firstRunStep.clients} />
            {completedStep ? (
              <>
                {" "}
                → 첫 태스크 완료{" "}
                <b className="tabular-nums">{fmtInt(completedStep.clients)}</b>
              </>
            ) : null}
            . 오늘 BQ 실측은 앱 첫 실행 577 → 첫 스폰 18(3.1%) → 첫 태스크 완료
            2이고, 첫 스폰 전 이탈은 96.9%입니다.{" "}
            {preSpawnLossRate != null ? (
              <>
                이 응답 기준 첫 스폰 전 이탈은{" "}
                <b className="tabular-nums">{fmtPct(preSpawnLossRate)}</b>
                입니다.{" "}
              </>
            ) : null}
            운영 판단은 뒤쪽 마이크로지표보다 이 앞단 절벽을 먼저 보세요.
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
            // 구버전 functions 응답(gating/coverage 미제공)은 전부 체인 칸·
            // 정상 계측으로 본다 — 근거 없이 딱지를 붙이지 않는다.
            const isGating = s.gating !== false;
            const coverage = s.coverage ?? "ok";
            const isMissing = coverage === "missing";
            const isPartial = coverage === "partial";
            // ★계측이 통째로 없는 칸의 '이탈' 은 이탈이 아니다 — 화살표를 숨긴다.
            const showDrop = i > 0 && drop != null && drop > 0 && !isMissing;
            // ★순차 도달 0 인데 창 안에 실제 발생이 있으면, 그 0 은 "안 했다"가
            //   아니라 "이 정의로는 못 센다" 다. 그 사실을 칸 안에서 말한다.
            const undercounted =
              isPartial &&
              s.everInWindow != null &&
              s.everInWindow > s.clients;
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
                    {/* ★계측 상태를 먼저 말한다. '참고' 는 "왜 믿기 어려운지"를
                        안 알려줘서 결국 0 이 그대로 읽혔다 — 사장님 화면의
                        "첫 대화 0명 / 스폰 2명" 이 그렇게 나왔다. */}
                    {isMissing ? (
                      <span
                        className="rounded bg-zinc-800 px-1 text-[9px] font-medium text-zinc-400"
                        title={`이 단계의 이벤트(${s.event})는 전 기간 한 번도 관측된 적이 없습니다. 0 이 아니라 신호 자체가 없는 것입니다.`}
                      >
                        미수집
                      </span>
                    ) : isPartial ? (
                      <span
                        className="rounded bg-amber-900/40 px-1 text-[9px] font-medium text-amber-300"
                        title={`이 이벤트(${s.event})가 처음 관측된 날은 ${
                          s.firstObservedDay ?? "조회창 시작 이후"
                        }입니다 — 조회창 앞부분에는 신호가 아예 없어 이 칸의 0 은 "안 했다"는 뜻이 아닙니다. (계측이 나중에 생긴 것인지, 그때까지 아무도 안 한 것인지는 이 축만으로 구분되지 않습니다.)`}
                      >
                        부분 구간
                      </span>
                    ) : (
                      !isGating && (
                        <span
                          className="rounded bg-zinc-800 px-1 text-[9px] font-medium text-zinc-400"
                          title="참고 지표 — 뒤 단계의 이탈률 기준선으로 쓰이지 않습니다(시간창이 본선과 다름)."
                        >
                          참고
                        </span>
                      )
                    )}
                  </div>
                  {/* ★계측이 전기간 0건인 칸은 막대를 그리지 않는다. 길이 0 짜리
                      막대 + "0명" 은 화면에서 "아무도 안 했다" 와 구분이 안 된다 —
                      이 화면의 규약(0 / 미수집 / 적재 전)이 바로 그걸 막으려고
                      있는 것이다. */}
                  {isMissing ? (
                    <div className="flex h-7 flex-1 items-center rounded border border-dashed border-zinc-800 bg-zinc-950/60 px-2">
                      <span className="text-xs font-medium text-zinc-500">
                        미수집
                      </span>
                      <span className="ml-2 text-[11px] text-zinc-600">
                        · <span className="font-mono">{s.event}</span> 이 전 기간
                        관측된 적 없음 (0 이 아니라 신호 없음)
                      </span>
                    </div>
                  ) : (
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
                  )}
                </div>
                {/* ★순차 0 인데 창 안 실측은 N — 이 한 줄이 "첫 대화 0명인데
                    스폰 2명" 이라는 자기모순의 정체다. 값을 고치지 않고(소급
                    보정 금지) 두 수를 나란히 보여 준다. */}
                {undercounted && (
                  <p className="mt-0.5 pl-[10.75rem] text-[11px] leading-relaxed text-amber-300/80">
                    ↳ 순차 정의로는 {fmtInt(s.clients)}명이지만, 같은 기간에 이
                    이벤트를 실제로 낸 설치는{" "}
                    <b className="tabular-nums">{fmtInt(s.everInWindow ?? 0)}개</b>
                    입니다
                    {s.firstObservedDay
                      ? ` (이 신호가 처음 보인 날 ${s.firstObservedDay})`
                      : ""}
                    . 앞 단계(로그인 성공)가 조회창 밖이면 순차 체인에서 통째로
                    빠집니다 — 이 칸의 0 은 제품 실패가 아니라 정의의 한계입니다.
                  </p>
                )}
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
// eventAxisRetired 면 이벤트 파생 3종(기능채택·기능별 사용·세션)은 아예 그리지
// 않는다. 영원히 비는 블록을 남겨 두면 "아직 안 쌓였나 보다" 로 읽히기 때문이다.
function BetaSegmentCard({
  seg,
  eventAxisRetired,
}: {
  seg: BetaSegmentSummary;
  eventAxisRetired: boolean;
}) {
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
      ) : eventAxisRetired ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs leading-relaxed text-zinc-500">
          기능채택·기능별 사용·세션은 이벤트를 계정에 귀속시켜야 나오는 지표라,
          계정축 은퇴와 함께 이 카드에서 내렸습니다. 위 관측률·재방문은
          cost_logs(사용량) 기반이라 계속 유효합니다.
        </p>
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
  // 구버전 functions 응답에는 이 필드가 없다 → false 로 접어 기존 안내를 쓴다.
  const retired = data.eventAxisRetired === true;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="founderGrant 보유자"
          value={fmtInt(data.grantCohortSize)}
          sub="가입자 아님 · 무상권한 보유 계정"
        />
        <StatCard
          label="관측된 계정"
          value={fmtInt(data.observedUsers)}
          sub={`최근 ${data.rangeDays}일 텔레메트리`}
        />
        <StatCard
          label="관측률"
          value={all.observedRate == null ? "—" : fmtPct(all.observedRate)}
          sub="founderGrant 보유 계정 중 실사용"
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

      {retired ? (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <strong className="text-zinc-300">
              이벤트 기반 계정 지표는 은퇴했습니다
            </strong>{" "}
            {data.eventAxisRetiredOn ? `(${data.eventAxisRetiredOn}부터)` : ""}.
            기능사용·세션·채택은 이벤트를 계정에 귀속시켜야 나오는데, 그 귀속에
            쓰던 계정 식별자를 텔레메트리 이벤트에서 제거했습니다 — 처리방침이
            이 테이블을 &ldquo;계정 UID 없는 익명 설치 ID&rdquo;로 고지하고 있어
            문구가 아니라 코드를 맞춘 결정입니다. grant 명단(계정)과 익명 설치
            ID 를 잇는 다리가 없으므로 이 축은 값을 추정하지 않고 내렸습니다. 위
            grant·관측·재방문은 Firestore·cost_logs 기반이라 그대로 정확합니다.
            설치 단위 기능사용은 &lsquo;온보딩 퍼널&rsquo;· &lsquo;사용량&rsquo;
            탭에서 계속 볼 수 있습니다.
          </p>
        </div>
      ) : (
        !data.accountAttributionAvailable && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              <strong>텔레메트리 ON 이 선행 조건입니다.</strong>{" "}
              기능사용·세션·채택 지표는 이벤트가 계정에 귀속돼야 나오는데, 현재
              이 구간의 grant 보유자 이벤트는 계정 귀속분이 없어 값을 표시하지
              않습니다 — 0 은 &ldquo;안 썼다&rdquo;가 아니라 &ldquo;측정되지
              않았다&rdquo;입니다. 위 grant/관측 카운트는 Firestore·cost_logs
              기반이라 텔레메트리와 무관하게 정확합니다.
            </p>
          </div>
        )
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BetaSegmentCard seg={all} eventAxisRetired={retired} />
        {data.segments.map((seg) => (
          <BetaSegmentCard key={seg.key} seg={seg} eventAxisRetired={retired} />
        ))}
      </div>

      <p className="text-xs text-zinc-600">
        프라이버시: 세그먼트 단위 집계만 표시하며 개별 계정 식별자는 서버 응답에
        포함되지 않습니다. 여기 모수는 가입자 수가 아니라
        subscriptions.founderGrant=true 인 권한 보유 계정입니다. 관측 계정이{" "}
        {data.minCohortSize}명 미만인 세그먼트는 행동지표를 표시하지 않습니다.
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

// ── D7·D14 리텐션 + 연속사용 스트릭 뷰 ──────────────────────────────────────
// 설계 원칙 하나: **퍼센트를 주인공으로 만들지 않는다.** 분수를 크게, 퍼센트를
// 괄호 안 작게 그린다. 표본이 한 자릿수인 화면에서 큰 퍼센트는 정보가 아니라
// 착시다.
function CountedRateCell({ r }: { r: RetentionCountedRate }) {
  // ★서버가 rate 를 실어 보내지만 퍼센트 판정은 여기서 다시 한다 — 분자/분모가
  //   같이 오는 자리라 '나눌 수 있는 두 수인가' 를 화면이 스스로 확인할 수 있고,
  //   서버가 안 자른 비율이 그대로 새어 나오는 길(코크핏 128.6%)을 닫는다.
  const v = ratioVerdict(r.numerator, r.denominator);
  const pct = fmtRatioVerdict(v);
  const incomparable = v.kind === "incomparable";
  return (
    <span
      className="inline-flex items-baseline gap-1.5 whitespace-nowrap"
      title={incomparable ? RATIO_INCOMPARABLE_HINT : undefined}
    >
      <span className="text-sm font-semibold tabular-nums text-zinc-100">
        {r.numerator}/{r.denominator}
      </span>
      <span
        className={`text-xs ${incomparable ? "" : "tabular-nums "}${
          v.kind === "ok" ? "text-zinc-500" : "text-zinc-600"
        }`}
      >
        ({pct})
      </span>
    </span>
  );
}

// 격자 한 줄. x=활동 / ~=하트비트만(활동 아님) / .=신호 없음.
// '~' 를 눈에 띄게 다른 색으로 칠하는 게 요점이다 — 그게 좀비를 알아보는 방법이다.
function StreakGrid({ grid }: { grid: string }) {
  return (
    <span className="font-mono text-[13px] leading-none tracking-[0.12em]">
      {grid.split("").map((c, i) => (
        <span
          key={i}
          className={
            c === "x"
              ? "text-emerald-400"
              : c === "~"
              ? "text-amber-500"
              : "text-zinc-700"
          }
        >
          {c}
        </span>
      ))}
    </span>
  );
}

// ── 코호트 셀 ↔ 아래 유닛 표를 잇는다 ────────────────────────────────────────
//
// ★요구의 실체는 "D7 window 1/3 의 그 1명이 아래 표의 누구냐" 다. 두 표가 같은
//   화면에 있으면서 서로를 가리키지 않아, 위에서 본 비율을 아래에서 사람으로
//   확인할 방법이 없었다. 그래서 **셀을 누르면 그 셀의 분모가 아래 표에 남는다.**
//
// ★"GA4처럼" 을 문자 그대로 하지 않았다. GA4 코호트 격자는 주(週) 코호트 × 경과주
//   삼각행렬이고, 그 형태는 코호트마다 수십~수백 명이 있어 **색의 농담이 패턴으로**
//   읽힐 때 작동한다. 이 축의 코호트 모수는 한 자릿수다 — 같은 격자를 그리면 칸의
//   대부분이 빈칸이거나 0/1 이 되고, GA4 처럼 **보이지만** 읽히지는 않는다.
//   표본이 한 자릿수일 때 실제로 읽히는 단위는 비율이 아니라 **사람**이다. 그래서
//   지평 4행 표는 그대로 두고, 대신 셀 → 사람으로 내려가는 길을 냈다.
//
// ★계산은 서버 것을 그대로 쓴다. 아래 재구성은 "그 셀에 누가 들어갔나"만 되찾는
//   것이고, 되찾은 수가 서버 분자·분모와 **정확히 일치할 때만** 링크를 연다. 하나라도
//   어긋나면 링크를 닫고 이유를 적는다 — 화면이 서버와 다른 수를 말하기 시작하면
//   이 패널이 지금 갖고 있는 유일한 자산(정직함)이 통째로 무너진다.

const STREAK_DAY_MS = 86_400_000;

/** "YYYY-MM-DD" → 에폭 일련번호. 서버 dayNumber 와 같은 기준(UTC 자정)이다. */
function streakDayNumber(day: string | null | undefined): number | null {
  if (day == null || day === "") return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / STREAK_DAY_MS) : null;
}

export type HorizonMembership = {
  /** 이 셀 분모에 들어간 유닛 라벨. 순서는 서버가 준 유닛 정렬 그대로다. */
  denominator: string[];
  /** 그중 잔존(분자)으로 센 유닛 라벨. */
  retained: string[];
};

/**
 * 지평 셀 하나의 분모·분자에 **어느 유닛이 들어갔는지** 되찾는다.
 *
 * ★이건 리텐션을 다시 계산하는 게 아니다. 판정 규칙은 서버(buildStreakRetention)와
 *   같은 걸 쓰되, 마지막에 **서버가 이미 센 분자/분모와 대조**해서 한 개라도
 *   다르면 `null` 을 돌려준다. 즉 이 함수는 "링크를 열어도 되는가" 를 답한다.
 *
 * `null` 이 되는 정상적인 경우가 하나 있다: 격자(최근 gridDays 일)가 판정에 필요한
 * 날을 덮지 못할 때다. 오래전에 시작한 코호트의 D7 구간은 격자 밖이라 화면 데이터만
 * 으로는 누가 그 안에서 돌아왔는지 알 수 없다 — 그때는 모르는 채로 두는 게 맞다.
 */
export function deriveHorizonMembership(
  axis: StreakRetentionAxis,
  horizon: StreakRetentionHorizon,
  kind: "window" | "exact"
): HorizonMembership | null {
  // 서버의 `today` 는 응답에 따로 없지만 모든 유닛의 gridEnd 가 그 날이다.
  const todayNum = axis.units.reduce<number | null>((acc, u) => {
    const n = streakDayNumber(u.gridEnd);
    if (n == null) return acc;
    return acc == null || n > acc ? n : acc;
  }, null);
  if (todayNum == null) return null;

  const denominator: string[] = [];
  const retained: string[] = [];
  for (const u of axis.units) {
    // 코호트 조건은 서버와 같다: 첫 활동이 있고 · 운영자가 아니고 · 코호트 창 안.
    if (u.firstActive == null || u.adminExcluded || !u.inCohortWindow) continue;
    const firstNum = streakDayNumber(u.firstActive);
    const gridStartNum = streakDayNumber(u.gridStart);
    if (firstNum == null || gridStartNum == null) return null;
    // 관측창 미도달은 분모에 넣지 않는다(pending). 서버와 같은 판정이다.
    if (todayNum - firstNum < horizon.days) continue;
    denominator.push(u.label);

    const from = kind === "exact" ? firstNum + horizon.days : firstNum + 1;
    const to = firstNum + horizon.days;
    // 격자가 판정 구간을 못 덮으면 재구성 불가 — 추측해서 그리지 않는다.
    if (from - gridStartNum < 0 || to - gridStartNum >= u.grid.length) {
      return null;
    }
    let hit = false;
    for (let d = from; d <= to; d += 1) {
      if (u.grid[d - gridStartNum] === "x") {
        hit = true;
        break;
      }
    }
    if (hit) retained.push(u.label);
  }

  // ★자기검증. 서버 수와 하나라도 어긋나면 링크를 열지 않는다.
  const rate = kind === "exact" ? horizon.exact : horizon.window;
  if (
    denominator.length !== rate.denominator ||
    retained.length !== rate.numerator
  ) {
    return null;
  }
  return { denominator, retained };
}

type StreakHorizonKey = StreakRetentionHorizon["key"];
type HorizonCellRef = { horizon: StreakHorizonKey; kind: "window" | "exact" };

/**
 * ★두 정의가 왜 다른지 화면이 직접 말한다. 지금까지는 두 숫자가 나란히 있을 뿐
 *   **어느 걸 봐야 하는지** 화면이 안 알려줬고, 그래서 `D7 exact 0%` 가 "활성 사용자
 *   없음" 으로 읽혔다. 그게 이 패널의 진짜 결함이었다.
 */
export const WINDOW_VS_EXACT_ONE_LINER =
  "★기본은 window 다 — 첫 활동 다음날부터 +N일 사이 하루라도 왔으면 잔존으로 센다. " +
  "exact 는 +N일 당일만 세기 때문에 6일째·8일째 온 사람이 D7 에서 0 으로 떨어진다 " +
  "(표본이 한 자릿수인 지금은 그 0 이 이탈이 아니라 대부분 노이즈다). " +
  "exact 는 '정해진 주기로 그날 켜는가'(습관화)를 볼 때만 펴서 보라.";

/** 링크를 못 여는 셀에 붙는 이유. 숫자는 서버 판정 그대로 남는다. */
const CELL_LINK_UNAVAILABLE =
  "이 셀은 아래 격자가 덮지 못하는 날짜로 판정돼서 아래 표로 좁힐 수 없습니다 — " +
  "숫자 자체는 서버 판정 그대로입니다(격자는 최근 구간만 담습니다).";

/** 지평 표의 한 칸. membership 이 있을 때만 아래 표로 내려가는 버튼이 된다. */
function HorizonRateCell({
  rate,
  membership,
  selected,
  onSelect,
  ariaLabel,
}: {
  rate: RetentionCountedRate;
  membership: HorizonMembership | null;
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
}) {
  const linkable = membership != null && rate.denominator > 0;
  if (!linkable) {
    const unavailable = membership == null && rate.denominator > 0;
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title={unavailable ? CELL_LINK_UNAVAILABLE : undefined}
      >
        <CountedRateCell r={rate} />
        {unavailable && (
          <span className="text-[10px] text-zinc-600">(연결 불가)</span>
        )}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={ariaLabel}
      title={
        selected
          ? "선택 해제 — 아래 표를 전체로 되돌린다"
          : "이 셀의 분모를 아래 사용자별 표에서 보기"
      }
      className={`group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors ${
        selected
          ? "bg-emerald-500/15 ring-1 ring-emerald-500/50"
          : "hover:bg-zinc-800/70"
      }`}
    >
      <CountedRateCell r={rate} />
      <Link2
        className={`h-3 w-3 shrink-0 ${
          selected
            ? "text-emerald-400"
            : "text-zinc-600 group-hover:text-zinc-300"
        }`}
      />
    </button>
  );
}

export function StreakAxisView({ axis }: { axis: StreakRetentionAxis }) {
  const isInstall = axis.axis === "install";
  const title = isInstall
    ? "설치 축 (익명 설치 ID)"
    : "계정 축 (cost_logs 계정 uid)";
  // D7·D14 를 먼저, 크게. 사장님이 "매우 중요한 지표" 라고 지목한 두 칸이다.
  const primary = axis.horizons.filter(
    (h) => h.key === "d7" || h.key === "d14"
  );
  const secondary = axis.horizons.filter(
    (h) => h.key !== "d7" && h.key !== "d14"
  );
  const rows = [...primary, ...secondary];
  const cohortEmpty = axis.unitsCohort === 0;

  // ★exact 는 지우지 않는다 — 접는다. 기본 화면은 window 하나뿐이다.
  const [showExact, setShowExact] = useState(false);
  const [cell, setCell] = useState<HorizonCellRef | null>(null);

  const membershipByCell = useMemo(() => {
    const m = new Map<string, HorizonMembership | null>();
    for (const h of axis.horizons) {
      m.set(`${h.key}:window`, deriveHorizonMembership(axis, h, "window"));
      m.set(`${h.key}:exact`, deriveHorizonMembership(axis, h, "exact"));
    }
    return m;
  }, [axis]);

  // exact 를 접으면 exact 셀 선택도 같이 풀린다(보이지 않는 필터를 남기지 않는다).
  const activeCell = cell != null && (cell.kind === "window" || showExact) ? cell : null;
  const activeMembership = activeCell
    ? membershipByCell.get(`${activeCell.horizon}:${activeCell.kind}`) ?? null
    : null;
  const denomSet = useMemo(
    () => new Set(activeMembership?.denominator ?? []),
    [activeMembership]
  );
  const retainedSet = useMemo(
    () => new Set(activeMembership?.retained ?? []),
    [activeMembership]
  );
  const filtered = activeCell != null && activeMembership != null;
  const visibleUnits = filtered
    ? axis.units.filter((u) => denomSet.has(u.label))
    : axis.units;
  const activeLabel = activeCell
    ? `${activeCell.horizon.toUpperCase()} ${activeCell.kind}`
    : "";

  const toggleCell = (horizon: StreakHorizonKey, kind: "window" | "exact") =>
    setCell((cur) =>
      cur != null && cur.horizon === horizon && cur.kind === kind
        ? null
        : { horizon, kind }
    );

  return (
    <Panel
      title={title}
      note={`코호트 기준일 = 그 유닛의 첫 활동일 · 코호트 창 ${axis.cohortWindowDays}일 · 격자 ${axis.gridDays}일`}
    >
      {/* ── 모수. 어떤 비율보다 먼저 읽혀야 한다.
          ★뺄셈 체인으로 그리지 않는다 — 아래 항목들은 서로 겹칠 수 있어서
            (운영자이면서 창 밖인 설치처럼) 43−1−9−28 이 6 이 되지 않는다.
            맞지 않는 산식을 화면에 그리면 그 화면 전체를 못 믿게 된다. ── */}
      <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs text-zinc-500">코호트 모수</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-zinc-100">
            N = {fmtInt(axis.unitsCohort)}
          </span>
          <span className="text-xs text-zinc-600">
            / 관측 {fmtInt(axis.unitsObserved)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <span>
            코호트 밖:{" "}
            <span className="tabular-nums text-amber-500">
              좀비 {fmtInt(axis.unitsZombie)}
            </span>
            {" · "}
            <span className="tabular-nums text-zinc-400">
              운영자 {fmtInt(axis.unitsAdminExcluded)}
            </span>
            {" · "}
            <span className="tabular-nums text-zinc-400">
              코호트창 밖 {fmtInt(axis.unitsBeforeWindow)}
            </span>
          </span>
          <span className="text-zinc-600">
            (항목이 서로 겹칠 수 있어 합계가 관측 수와 맞지 않는다)
          </span>
        </div>
      </div>

      {cohortEmpty ? (
        <EmptyState label="이 창에 코호트 모수가 없습니다 — 비율을 계산할 표본 자체가 없다는 뜻입니다(0% 가 아닙니다). 아래 스트릭 격자는 전 구간 기준이라 그대로 보입니다." />
      ) : (
        <>
          {/* ── ★어느 숫자를 봐야 하는지 화면이 먼저 말한다 ── */}
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
            <p className="max-w-[60ch] text-[11px] leading-relaxed text-zinc-400">
              {WINDOW_VS_EXACT_ONE_LINER}
            </p>
            <button
              type="button"
              onClick={() => {
                setShowExact((v) => !v);
                // 접을 때 exact 셀 선택이 남아 있으면 같이 푼다.
                setCell((cur) =>
                  showExact && cur?.kind === "exact" ? null : cur
                );
              }}
              aria-pressed={showExact}
              className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              {showExact ? "exact 접기" : "exact 펴기 (습관화용)"}
            </button>
          </div>

          {/* ★열을 페이지 폭까지 늘리지 않는다 — window 한 열만 남으면 지평과 숫자가
              화면 양 끝으로 벌어져서 한 행을 눈으로 잇기 어려워진다. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] max-w-2xl text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 pr-3 text-left font-medium">지평</th>
                  <th className="py-1 pr-3 text-left font-medium text-zinc-300">
                    돌아왔나 · window (1~N일 중)
                  </th>
                  {showExact && (
                    <th className="py-1 pr-3 text-left font-medium">
                      exact (+N일 당일)
                    </th>
                  )}
                  <th className="py-1 pr-3 text-right font-medium">
                    관측창 미도달
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const key = h.key.toUpperCase();
                  const isPrimary = h.key === "d7" || h.key === "d14";
                  return (
                    <tr
                      key={h.key}
                      className={`border-t border-zinc-900 ${
                        isPrimary ? "bg-zinc-900/30" : ""
                      }`}
                    >
                      <td
                        className={`py-1.5 pr-3 tabular-nums ${
                          isPrimary
                            ? "font-semibold text-zinc-100"
                            : "text-zinc-400"
                        }`}
                      >
                        {key}
                      </td>
                      <td className="py-1.5 pr-3">
                        <HorizonRateCell
                          rate={h.window}
                          membership={
                            membershipByCell.get(`${h.key}:window`) ?? null
                          }
                          selected={
                            activeCell?.horizon === h.key &&
                            activeCell?.kind === "window"
                          }
                          onSelect={() => toggleCell(h.key, "window")}
                          ariaLabel={`${key} window ${h.window.numerator}/${h.window.denominator} — 아래 사용자별 표를 이 셀의 분모로 좁히기`}
                        />
                      </td>
                      {showExact && (
                        <td className="py-1.5 pr-3">
                          <HorizonRateCell
                            rate={h.exact}
                            membership={
                              membershipByCell.get(`${h.key}:exact`) ?? null
                            }
                            selected={
                              activeCell?.horizon === h.key &&
                              activeCell?.kind === "exact"
                            }
                            onSelect={() => toggleCell(h.key, "exact")}
                            ariaLabel={`${key} exact ${h.exact.numerator}/${h.exact.denominator} — 아래 사용자별 표를 이 셀의 분모로 좁히기`}
                          />
                        </td>
                      )}
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-500">
                        {h.pending > 0 ? `${fmtInt(h.pending)}개 제외` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── 사용자별 연속사용 격자 ── */}
      <div className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-zinc-300">
            사용자별 연속사용 (전 구간 기준)
          </h5>
          <span className="text-[11px] text-zinc-500">{axis.gridLegend}</span>
        </div>

        {/* ★위 셀에서 내려온 필터. 무엇으로 좁혔는지 · 몇 개인지 · 어떻게 푸는지를
            한 줄에 다 적는다. 이유 없이 줄어든 표가 제일 위험하다. */}
        {filtered && activeMembership != null && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-[11px]">
            <span className="text-zinc-300">
              위 표{" "}
              <b className="font-semibold text-zinc-100">{activeLabel}</b> 의
              분모 {fmtInt(activeMembership.denominator.length)}개만 보는 중
            </span>
            <span className="tabular-nums text-emerald-400">
              잔존 {fmtInt(activeMembership.retained.length)}
            </span>
            <span className="tabular-nums text-zinc-500">
              미복귀{" "}
              {fmtInt(
                activeMembership.denominator.length -
                  activeMembership.retained.length
              )}
            </span>
            <button
              type="button"
              onClick={() => setCell(null)}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              전체 보기
            </button>
          </div>
        )}

        {visibleUnits.length === 0 ? (
          <EmptyState
            label={
              filtered
                ? "이 셀의 분모에 해당하는 유닛이 표에 없습니다."
                : "이 축에 관측된 유닛이 없습니다."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 pr-3 text-left font-medium">라벨</th>
                  {filtered && (
                    <th className="py-1 pr-3 text-left font-medium">
                      {activeLabel}
                    </th>
                  )}
                  <th className="py-1 pr-3 text-right font-medium">최대연속</th>
                  <th className="py-1 pr-3 text-right font-medium">현재연속</th>
                  <th className="py-1 pr-3 text-left font-medium">첫 활동</th>
                  <th className="py-1 pr-3 text-left font-medium">
                    최근 {axis.gridDays}일
                  </th>
                  <th className="py-1 pr-3 text-right font-medium">활동일</th>
                  {isInstall && (
                    <th className="py-1 pr-3 text-right font-medium">
                      working일
                    </th>
                  )}
                  <th className="py-1 pr-3 text-right font-medium">경과일</th>
                  {isInstall && (
                    <th className="py-1 pr-3 text-left font-medium">계정</th>
                  )}
                  <th className="py-1 pr-3 text-left font-medium">비고</th>
                </tr>
              </thead>
              <tbody>
                {visibleUnits.map((u) => (
                  <tr
                    key={u.label}
                    className={`border-t border-zinc-900 ${
                      u.zombie || u.adminExcluded ? "opacity-60" : ""
                    }`}
                  >
                    <td className="py-1 pr-3 font-mono text-[11px] text-zinc-300">
                      {u.label}
                    </td>
                    {filtered && (
                      <td className="py-1 pr-3">
                        {retainedSet.has(u.label) ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            잔존
                          </span>
                        ) : (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            미복귀
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-200">
                      {fmtInt(u.maxStreak)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-400">
                      {u.currentStreak > 0 ? fmtInt(u.currentStreak) : "—"}
                    </td>
                    <td className="py-1 pr-3 tabular-nums text-zinc-400">
                      {u.firstActive ?? "—"}
                    </td>
                    <td className="py-1 pr-3">
                      <StreakGrid grid={u.grid} />
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-300">
                      {fmtInt(u.activeDays)}
                    </td>
                    {isInstall && (
                      <td className="py-1 pr-3 text-right tabular-nums text-zinc-400">
                        {fmtInt(u.workingDays)}
                      </td>
                    )}
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-500">
                      {u.daysSinceLastActive == null
                        ? "—"
                        : fmtInt(u.daysSinceLastActive)}
                    </td>
                    {isInstall && (
                      <td className="py-1 pr-3 font-mono text-[11px] text-zinc-500">
                        {u.mappedAccountLabel ??
                          (u.mappingStatus === "unmapped" ? "매핑 불가" : "—")}
                        {u.mappingStatus === "ambiguous" && (
                          <span className="ml-1 text-amber-500">(모호)</span>
                        )}
                      </td>
                    )}
                    <td className="py-1 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {u.zombie && (
                          <span
                            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400"
                            title="최근 격자 구간에 하트비트만 있고 활동(working 하트비트·이벤트)이 0 — 사용자가 아니라 떠 있는 프로세스. 하트비트를 세면 이런 게 리텐션을 부풀린다."
                          >
                            좀비
                          </span>
                        )}
                        {u.adminExcluded && (
                          <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300">
                            운영자·제외
                          </span>
                        )}
                        {u.suspectedIdSwitchChurn && (
                          <span
                            className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-400"
                            title="2026-06-13 식별자 스킴 교체 경계에서 끊긴 구 스킴 유닛 — 이탈이 아니라 id 가 바뀐 것일 가능성이 높다."
                          >
                            id교체 추정
                          </span>
                        )}
                        {u.legacyIdScheme && !u.suspectedIdSwitchChurn && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            구 스킴
                          </span>
                        )}
                        {!u.inCohortWindow && u.firstActive != null && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                            코호트창 밖
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 설치→계정 매핑 요약 (설치 축만) ── */}
      {axis.mapping && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
          <span className="text-zinc-500">설치→계정</span>
          <span className="tabular-nums text-zinc-200">
            매핑 {fmtInt(axis.mapping.mappedInstalls)}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="tabular-nums text-amber-500">
            모호 {fmtInt(axis.mapping.ambiguousInstalls)}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="tabular-nums text-zinc-300">
            매핑 불가 {fmtInt(axis.mapping.unmappedInstalls)}
          </span>
        </div>
      )}

      {/* ── 정의·경고. 화면이 정의를 안 적으면 다음 사람이 다르게 읽는다 ── */}
      <div className="mt-3 space-y-1.5">
        {[
          axis.activityDefinition,
          axis.identityScheme.note,
          ...(axis.mapping ? [axis.mapping.note] : []),
          ...axis.notes.filter((n) => n !== axis.activityDefinition),
        ].map((note, i) => (
          <p
            key={i}
            className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px] leading-relaxed text-zinc-500"
          >
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{note}</span>
          </p>
        ))}
      </div>
    </Panel>
  );
}

function StreakRetentionView({ data }: { data: StreakRetention }) {
  return (
    <div className="space-y-4">
      {/* ★두 축을 한 표에 섞지 않는다 — 단위가 다르다(설치 ≠ 사람 ≠ 계정). */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-[11px] leading-relaxed text-zinc-400">
        <p className="mb-1 text-xs font-semibold text-zinc-200">
          이 숫자를 읽는 법
        </p>
        <p>
          · <b className="text-zinc-300">분모를 먼저 보라.</b> 모든 비율은{" "}
          <span className="font-mono">1/2 (50.0%)</span> 형태로 분자·분모와 함께
          나온다. 퍼센트만 보면 두 명짜리 표본이 절반의 시장처럼 보인다.{" "}
          <span className="font-mono">0/0 (—)</span> 은 0% 가 아니라 판단할
          표본이 없다는 뜻이다.
        </p>
        <p>
          · <b className="text-zinc-300">설치 축과 계정 축은 다른 단위다.</b> 한
          사람이 설치를 여러 대 쓴다(실측에서 계정 1개가 설치 9대를 썼다). 한
          표에 섞어 읽으면 인원이 부풀려진다.
        </p>
        <p>
          ·{" "}
          <b className="text-zinc-300">전 구간 {fmtInt(data.historyDays)}일</b>{" "}
          이력으로 첫 활동일·최대연속을 계산하고, 조회 기간({data.rangeDays}
          일)은 D7/D14 표에 넣을 코호트만 고른다.
        </p>
      </div>

      <StreakAxisView axis={data.install} />
      <StreakAxisView axis={data.account} />
    </div>
  );
}

// ── 콜러블이 오면 붙는 모양 (② analytics_user_daily / ④ analytics_account_profile) ──
//
// ★두 표는 **이미 매일 채워지고 있다**(scheduledBuildAnalyticsProfiles, 05:30 KST).
//   없는 것은 소스가 아니라 그걸 읽어 오는 콜러블이다. 그래서 이 칸은 '적재 전' 이
//   아니라 '연결 전' 이고, 콜러블이 배포되는 순간 프론트 변경 없이 값이 들어오도록
//   **지금 호출까지 걸어 둔다** — `functions/not-found` 를 장애가 아니라 '연결 전'
//   으로 접는 게 그 장치다.
//
// ★이름을 여기 박는다. 한쪽이 다른 이름을 쓰면 조용히 undefined 가 되고 화면은
//   영원히 '연결 전' 을 띄운다. 계약은 docs/analytics-admin-callables-api.md.
export const CALLABLE_USER_DAILY = "getAdminUserDailySummary";
export const CALLABLE_ACCOUNT_PROFILE = "getAdminAccountProfileSummary";
export const CALLABLE_PURCHASE_SUMMARY = "getAdminPurchaseSummary";
/**
 * ★획득 탭의 유일한 읽기 경로(계획 §5 PR 2). 이 하나가 콜러블 8개를 대체한다.
 *
 * 서버가 아직 이 이름을 안 내보내면 **장애가 아니라 '연결 전'** 이다 — 매니페스트가
 * 먼저 걸러 주고, 그동안 화면은 0 이 아니라 사유를 그린다.
 */
export const CALLABLE_INSTALL_UNIFIED = "getAdminInstallUnified";

/**
 * analytics_purchase 요약 — ★"실매출 0" 과 "적재 전" 을 가르는 응답.
 *
 * 실측(2026-08-21): 활성 portone 구독 1건은 **운영자 본인의 테스트 결제**고
 * 실제 결제 고객은 0명이다. 그 1건을 매출로 그리면 대시보드의 첫 숫자가 틀린
 * 값이 된다 — 그래서 서버가 `account_class` 로 갈라 주고, 이 화면은 **뺀 건수를
 * 숨기지 않는다.** 숨기면 다음 사람이 "왜 결제가 하나도 안 잡히지" 로 또 판다.
 */
type PurchaseSummary = {
  generatedAt: string;
  /** `not_ingested` = 표가 없다(적재 전). `ingested` = 아래 숫자는 진짜다. */
  state: "not_ingested" | "ingested";
  reason: string | null;
  revenue: {
    /** ★실매출(외부 고객). state=ingested 면 0 도 **정확한 0** 이다. */
    externalKrw: number;
    externalRows: number;
    /** 매출에서 뺐지만 화면에 보여야 하는 내부(운영자) 결제 건수. */
    internalRows: number;
    /** 무상 부여(founder_grant) 건수 — 매출은 아니지만 경영 정보다. */
    grantRows: number;
    /** 계정 성격 미분류(표식 이전 적재분 / 운영자 축 미설정). */
    unclassifiedRows: number;
    /** 금액 미상 행(환불·해지·부여). 0 이 아니다. */
    amountUnknownRows: number;
    totalRows: number;
  } | null;
  /** ★기준 라벨. "기준 라벨 없는 숫자 금지" — 숫자 옆에 그대로 붙인다. */
  basis: string;
  notes: string[];
};

/** analytics_user_daily 한 날(익명축, 설치 × 날짜). ★user_key 컬럼이 없다. */
type UserDailyDay = {
  day: string;
  /** 그날 active 였던 설치 수. */
  activeInstalls: number;
  /** ★그날 하트비트만 있던 설치 수(좀비). active 와 섞지 않는다. */
  presentOnlyInstalls: number;
  eventCount: number;
  tokensTotal: number;
};
export type UserDailySummary = {
  rangeDays: number;
  generatedAt: string;
  /** 구간에 행이 하나라도 있는 설치 수 = 아래 둘의 합이 아니다(겹친다). */
  installsObserved: number;
  /** 구간에 active 인 날이 하루라도 있는 설치. ★모든 분모의 뿌리. */
  installsActive: number;
  /** ★present_only 만 있고 active 인 날이 하루도 없는 설치 — 좀비. */
  installsPresentOnly: number;
  byDay: UserDailyDay[];
  notes: string[];
  personAxis?: PersonAxisCoverage | null;
};

/** analytics_account_profile 롤업(계정축). ★익명축 컬럼이 없다. */
export type AccountProfileSummary = {
  generatedAt: string;
  accountsObserved: number;
  /** cost_logs 흔적이 있는 계정(지출을 한 계정). */
  accountsWithSpend: number;
  /** ★mrr_usd 가 null 이 아닌 계정. analytics_purchase 적재 전이라 지금은 0 이 정상. */
  accountsWithMrr: number;
  /** ★null = 미기입이다. 0 이 아니다 — 0 으로 그리면 "아무도 안 냈다"로 읽힌다. */
  mrrUsdTotal: number | null;
  ltvUsdTotal: number | null;
  costUsdTotal: number | null;
  notes: string[];
};

/** null 을 0 으로 접지 않는다. 미기입은 '—' 이고 그 옆에 이유가 붙는다. */
function NullableMoney({
  value,
  label,
  whyNull,
}: {
  value: number | null;
  label: string;
  whyNull: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">
        {value == null ? "—" : fmtCost(value)}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        {value == null ? whyNull : "합계"}
      </p>
    </div>
  );
}

export function UserDailySummaryView({ data }: { data: UserDailySummary }) {
  return (
    <Panel
      title="설치 × 날짜 활동 (analytics_user_daily)"
      note={`${data.rangeDays}일 · 익명축(install_key). ★위 '제품 사용·활성' 은 events 옵트인 표본이라 분모가 다르다 — 두 수를 나눠 읽지 마라`}
    >
      <SmallSampleNotice n={data.installsActive} what="활동 설치" unit="대" />
      <InstallDenominatorNotice
        basis="이 패널의 비율은 analytics_user_daily 설치 행을 분모로 씁니다."
        observed={data.installsObserved}
      />
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <RatioCard
          label="활동한 설치"
          numerator={data.installsActive}
          denominator={data.installsObserved}
          sub="분모 = 구간에 행이 있는 설치"
          title="active = status:working 또는 이벤트 1건 이상. 하트비트만으로는 active 가 아니다."
        />
        <StatCard
          label="좀비 설치"
          value={fmtInt(data.installsPresentOnly)}
          sub="하트비트만 · active 0일"
          accent={data.installsPresentOnly > 0 ? STATUS_WARN : undefined}
        />
        <StatCard
          label="관측 설치"
          value={fmtInt(data.installsObserved)}
          sub="구간에 행이 하나라도 있음"
        />
      </div>

      <div className="mt-4">
        <Panel
          title="일별 활동 설치 vs 좀비"
          note="★두 계열을 겹쳐 읽지 마라 — 좀비는 활동이 아니다"
        >
          <TwoLineChart
            data={data.byDay.map((d) => ({
              date: d.day,
              first: d.activeInstalls,
              second: d.presentOnlyInstalls,
            }))}
            first={{ label: "활동", color: SERIES_2 }}
            second={{ label: "좀비(하트비트만)", color: STATUS_WARN }}
            emptyLabel="이 구간에 설치 × 날짜 행이 없습니다."
            marker={ID_SCHEME_MARKER}
          />
        </Panel>
      </div>

      <div className="mt-3 space-y-1.5">
        {[ANON_AXIS_ADMIN_TOGGLE_INERT, ...data.notes].map((note, i) => (
          <p
            key={i}
            className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px] leading-relaxed text-zinc-500"
          >
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{note}</span>
          </p>
        ))}
      </div>
    </Panel>
  );
}

export function AccountProfileSummaryView({
  data,
}: {
  data: AccountProfileSummary;
}) {
  const noMoney = data.mrrUsdTotal == null && data.ltvUsdTotal == null;
  return (
    <Panel
      title="계정 프로필 (analytics_account_profile)"
      note="계정축(user_key). 지출은 cost_logs, 매출은 analytics_purchase 가 채운다"
    >
      <SmallSampleNotice n={data.accountsObserved} what="계정" unit="개" />
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <RatioCard
          label="지출이 있는 계정"
          numerator={data.accountsWithSpend}
          denominator={data.accountsObserved}
          sub="cost_logs 흔적 기준"
        />
        <RatioCard
          label="MRR 이 기입된 계정"
          numerator={data.accountsWithMrr}
          denominator={data.accountsObserved}
          sub="analytics_purchase 적재 전이면 0/N 이 정상"
          title="분자 0 은 '아무도 안 냈다' 가 아니라 'mrr_usd 가 아직 안 채워졌다' 입니다."
        />
        <NullableMoney
          value={data.mrrUsdTotal}
          label="MRR 합계"
          whyNull="null 은 0 이 아니라 미기입입니다 — analytics_purchase 가 채웁니다"
        />
        <NullableMoney
          value={data.costUsdTotal}
          label="지출 합계"
          whyNull="cost_logs 집계가 비어 있습니다"
        />
      </div>

      {noMoney ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>mrr_usd · ltv_usd 가 전부 null 입니다.</b> 이 표의 계정 행은 매일
            채워지지만 금액 칸은 `analytics_purchase` 가 붙어야 들어옵니다 —
            여기 &lsquo;—&rsquo; 를 0 으로 읽지 마세요.
          </span>
        </p>
      ) : null}

      <div className="mt-3 space-y-1.5">
        {data.notes.map((note, i) => (
          <p
            key={i}
            className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px] leading-relaxed text-zinc-500"
          >
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{note}</span>
          </p>
        ))}
      </div>
    </Panel>
  );
}

// ── 설치축 리텐션 요약 뷰 (analytics_install_profile 전량) ───────────────────
// ★스트릭 뷰의 설치축과 **분모가 다르다.** 저쪽은 조회 구간 코호트, 이쪽은
//   프로필 전량이다. 그래서 두 표를 나란히 두되 한 번도 "저 수 나누기 이 수" 를
//   시키지 않는다 — 축이 다르면 그 비율은 무의미하다.

/** 익명축이라 운영자 토글이 **닿지 않는다.** 토글만 띄우고 침묵하면 거짓말이다. */
export const ANON_AXIS_ADMIN_TOGGLE_INERT =
  "이 표는 익명 설치축이라 위의 '운영자 포함' 토글이 동작하지 않습니다 — " +
  "설치 프로필에는 is_admin 이 없어 운영자 자기제외가 구조적으로 불가능합니다. " +
  "토글을 켜든 끄든 같은 수이고, 그만큼 운영자 도그푸드 쪽으로 낙관 편향될 수 " +
  "있습니다.";

export function InstallRetentionSummaryView({
  data,
}: {
  data: InstallRetentionSummary;
}) {
  const cohortEmpty = data.installsCohort === 0;
  // D7·D14 를 먼저, 크게 — 사장님이 지목한 두 칸이다(스트릭 뷰와 같은 순서).
  const primary = data.horizons.filter(
    (h) => h.key === "d7" || h.key === "d14"
  );
  const rows = [
    ...primary,
    ...data.horizons.filter((h) => h.key !== "d7" && h.key !== "d14"),
  ];

  return (
    <Panel
      title="설치 프로필 전량 (analytics_install_profile)"
      note="분모 = 첫 활동일이 있는 설치. 조회 기간과 무관한 전량 기준이라 위 스트릭 표와 분모가 다르다"
    >
      {/* ── 모수. 어떤 비율보다 먼저 읽혀야 한다.
          ★좀비와 '한 번도 안 켬' 을 합쳐 그리지 않는다 — 원인이 다르다. ── */}
      <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs text-zinc-500">코호트 모수</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-zinc-100">
            N = {fmtInt(data.installsCohort)}
          </span>
          <span className="text-xs text-zinc-600">
            / 관측 {fmtInt(data.installsObserved)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          <span>
            코호트 밖 {fmtInt(data.installsNeverActive)}대:{" "}
            <span className="tabular-nums text-amber-500">
              좀비 {fmtInt(data.installsZombie)}
            </span>
            {" · "}
            <span className="tabular-nums text-zinc-400">
              한 번도 안 켬 {fmtInt(data.installsNeverRan)}
            </span>
          </span>
          <span className="text-zinc-600">
            (좀비는 프로세스가 떠 있던 것, 안 켬은 사람이 안 온 것 — 원인이 달라
            합치지 않는다)
          </span>
        </div>
      </div>

      <SmallSampleNotice n={data.installsCohort} what="설치 코호트" unit="대" />
      <InstallDenominatorNotice
        basis="이 패널은 analytics_install_profile 전량 설치 프로필을 분모 후보로 봅니다."
        observed={data.installsObserved}
      />

      {cohortEmpty ? (
        <EmptyState label="첫 활동일이 있는 설치가 없습니다 — 비율을 계산할 표본 자체가 없다는 뜻입니다(0% 가 아닙니다)." />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-3 text-left font-medium">지평</th>
                <th className="py-1 pr-3 text-left font-medium">
                  exact (+N일 당일)
                </th>
                <th className="py-1 pr-3 text-left font-medium">
                  window (1~N일 중)
                </th>
                <th className="py-1 pr-3 text-right font-medium">
                  관측창 미도달
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const isPrimary = h.key === "d7" || h.key === "d14";
                return (
                  <tr
                    key={h.key}
                    className={`border-t border-zinc-900 ${
                      isPrimary ? "bg-zinc-900/30" : ""
                    }`}
                  >
                    <td
                      className={`py-1.5 pr-3 tabular-nums ${
                        isPrimary
                          ? "font-semibold text-zinc-100"
                          : "text-zinc-400"
                      }`}
                    >
                      {h.key.toUpperCase()}
                    </td>
                    <td className="py-1.5 pr-3">
                      <CountedRateCell r={h.exact} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <CountedRateCell r={h.window} />
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-500">
                      {h.pending > 0 ? `${fmtInt(h.pending)}대 제외` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 정의·경고. 화면이 정의를 안 적으면 다음 사람이 다르게 읽는다 ── */}
      <div className="mt-3 space-y-1.5">
        {Array.from(
          new Set([
            data.activityDefinition,
            data.presentOnlyDefinition,
            data.horizonDefinitions,
            ...data.notes,
          ])
        )
          .filter((n) => typeof n === "string" && n !== "")
          .map((note, i) => (
            <p
              key={i}
              className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px] leading-relaxed text-zinc-500"
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{note}</span>
            </p>
          ))}
      </div>
    </Panel>
  );
}

// ── 활성화 게이트 + 리텐션 코호트 뷰 (계정 identity 축) ─────────────────────
// ── 활성화 게이트 (계정 identity 축) ────────────────────────────────────────
// ★4탭 재배치에서 이 함수는 둘로 갈렸다. 게이트는 "들어온 사람이 가치를 보나"
// (②활성화)를, 코호트 표는 "남아서 계속 쓰나"(③리텐션)를 답한다 — 한 컴포넌트가
// 두 질문을 답하고 있던 게 이 화면이 지저분했던 이유 중 하나다.
export function ActivationGateView({ data }: { data: RetentionCohorts }) {
  const gate = data.activationGate;
  const maxUsers = Math.max(1, ...gate.steps.map((s) => s.users));
  const gateEmpty = gate.steps.every((s) => s.users === 0);
  const entry = gate.steps[0]?.users ?? 0;
  return (
    <Panel
      title="순차 활성화 게이트 (계정 identity)"
      note="설치 → 최초실행 → 로그인 → 폴더연결 → 오케오픈 → 스폰 → 첫 티켓 완료"
    >
      {gateEmpty ? (
        <EmptyState label="계정 귀속 이벤트가 이 기간에 없습니다 — 프라이버시 결정으로 텔레메트리 이벤트에서 계정 식별자를 제거해, 이 축은 은퇴일 이전 구간에서만 계산됩니다(0 은 '아무도 안 왔다'가 아닙니다). 설치 단위 동일 퍼널은 위 '온보딩 퍼널' 을 보세요." />
      ) : (
        <>
          <SmallSampleNotice n={entry} what="이 게이트의 진입" unit="명" />
          <div className="mt-2 space-y-1">
            {gate.steps.map((s, i) => {
              const widthPct = Math.round((s.users / maxUsers) * 100);
              const drop = s.dropFromPrev;
              const prev = s.users + (drop ?? 0);
              return (
                <div key={s.key}>
                  {i > 0 && drop != null && drop > 0 && (
                    <div
                      className={`flex flex-wrap items-center gap-1.5 py-0.5 pl-1 text-xs ${
                        s.isMaxDrop
                          ? "font-semibold text-red-400"
                          : "text-zinc-500"
                      }`}
                    >
                      <span>↓</span>
                      {/* ★−50% 만 띄우지 않는다. 전 단계 분모를 옆에 박아 둔다. */}
                      <span className="tabular-nums">
                        −{fmtInt(drop)}/{fmtInt(prev)}
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
                      <div className="absolute inset-0 flex items-center gap-2 px-2">
                        <span className="text-xs font-semibold tabular-nums text-zinc-100">
                          {fmtInt(s.users)}명
                        </span>
                        {i > 0 && (
                          // ★여기도 n/d 를 나누는 자리다 — 퍼널 단계와 진입은
                          //   같은 창에서 오지만, 뒤 단계가 앞을 넘는 봉투가
                          //   오면 그대로 100% 초과가 찍힌다. 다른 분수 자리와
                          //   같은 판정을 쓴다(코크핏 128.6% 와 같은 종류).
                          <span className="text-[11px] text-zinc-300/80">
                            진입 대비{" "}
                            <span className="tabular-nums">
                              {`${fmtInt(s.users)}/${fmtInt(entry)}`}
                            </span>{" "}
                            ({fmtRatioVerdict(ratioVerdict(s.users, entry))})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{gate.note}</span>
      </p>
    </Panel>
  );
}

// ── 리텐션 코호트 표 (주간, 계정 identity 축) ───────────────────────────────
export function RetentionCohortTableView({ data }: { data: RetentionCohorts }) {
  const cohorts = data.cohorts.week.length > 0 ? data.cohorts.week : [];
  const totalCohortUsers = cohorts.reduce((a, c) => a + c.cohortUsers, 0);
  const horizons: Array<["d1" | "d7" | "d14" | "d30", string]> = [
    ["d1", "D1"],
    ["d7", "D7"],
    ["d14", "D14"],
    ["d30", "D30"],
  ];
  return (
    <Panel
      title="리텐션 코호트 (주간)"
      note="first-active 주 기준 · D1/D7/D14/D30 복귀율 · 관측창 미도달 칸은 —"
    >
      {cohorts.length === 0 ? (
        <EmptyState label="코호트가 없습니다 (계정 귀속 활동 표본 없음) — 0% 가 아니라 비율을 계산할 모수 자체가 없다는 뜻입니다." />
      ) : (
        <>
          <SmallSampleNotice
            n={totalCohortUsers}
            what="이 표 전체의 코호트"
            unit="명"
          />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
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
                      const back = c.returningUsers?.[h];
                      // ★퍼센트만 띄우지 않는다. 표본이 한 자릿수라 "50%" 만
                      //   보면 1/2 이 절반의 시장처럼 읽힌다.
                      return (
                        <td
                          key={label}
                          className="py-1 pr-3 text-right tabular-nums text-zinc-400"
                        >
                          {rate == null ? (
                            <span title="관측창이 아직 안 왔거나 모수가 0 — 0% 가 아니라 판단 불가입니다.">
                              —
                            </span>
                          ) : (
                            <Ratio
                              numerator={back}
                              denominator={c.cohortUsers}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{data.cohorts.note}</span>
      </p>
    </Panel>
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
  // 정규 사유 분해(#iyxb4KsJ). 구버전 functions 는 이 축을 안 주므로 빈 배열로
  // 접고, 화면은 "0건" 이 아니라 "아직 안 실렸다" 로 말한다.
  const byBlockReason = stall.spawnBlocked.byBlockReason ?? [];
  const noSubClients = stall.spawnBlocked.noSubscriptionClients ?? 0;
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
          sub={
            byBlockReason.length === 0
              ? `${fmtInt(stall.spawnBlocked.events)}건 · 설치/인증/벤더 미비`
              : `${fmtInt(
                  stall.spawnBlocked.events
                )}건 · 그중 구독 공백 ${fmtInt(noSubClients)}개 설치`
          }
          accent={noSubClients > 0 ? STATUS_CRIT : undefined}
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
        {/*
          ★차단 사유 정규 어휘 — 온보딩 96% 이탈(cli_setup 531 → multi_agent 21)의
          원인을 "구독 공백 / 인증 / CLI 부재" 로 가르는 축(#iyxb4KsJ).
          막대는 **고유 설치 수**다. 건수로 그리면 재시도를 많이 한 한 사람이 만든
          꼬리가 최대 문제처럼 보인다 — 투자 판단이 보는 값은 사람 수 쪽이다.
        */}
        <Panel
          title="차단 사유 (설치 수 · 정규 어휘)"
          note="onboarding:spawn_blocked · metadata.reason"
        >
          <BarList
            data={byBlockReason.map((r) => ({
              key: r.key,
              value: r.clients,
            }))}
            colorMap={{
              no_subscription: STATUS_CRIT,
              quota_exhausted: STATUS_CRIT,
              needs_auth: STATUS_WARN,
              no_cli: STATUS_WARN,
            }}
            labelMap={{
              no_subscription: "구독 공백",
              needs_auth: "인증 필요",
              no_cli: "CLI 미설치",
              quota_exhausted: "한도 소진 (요금제 있음)",
              other: "기타",
              "(none)": "미표기 (구버전 앱)",
            }}
            color={STATUS_WARN}
            showShare
            emptyLabel="정규 사유 데이터가 없습니다 — 이 축이 실린 앱 빌드의 실사용 전입니다."
          />
        </Panel>
        <Panel
          title="차단 사유 (errorCategory)"
          note="onboarding:spawn_blocked · 원어휘(건수)"
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
      <SmallSampleNotice
        n={ten.base}
        what="이 패널의 분모(모델 연결 완료 설치)"
        unit="개"
      />
      <InstallDenominatorNotice
        basis="제로마찰 KPI·동시 2대+·주 2회+는 계정이나 가입자가 아니라 설치/클라이언트 축입니다."
        observed={Math.max(ten.base, usage.base, zf.weeklyTwicePlus.base)}
      />
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* ★큰 글씨는 분수다. 이 분모가 실측에서 한 자릿수라 퍼센트를 크게
            띄우면 한 사람이 움직일 때마다 화면이 수십 %p 씩 출렁인다. */}
        <RatioCard
          label={`연결 후 ${ten.windowMinutes}분 내 첫 multi-agent 성공`}
          numerator={ten.withinClients}
          denominator={ten.base}
          sub={`모델 연결 기준 · 연결→성공 중앙값 ${fmtDuration(ten.medianMs)}`}
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
        {connect == null ? (
          <StatCard
            label="모델 연결 도달 (앞단)"
            value="—"
            sub="구버전 functions — 재배포 후 표시"
          />
        ) : (
          <RatioCard
            label="모델 연결 도달 (앞단)"
            numerator={connect.connectedClients}
            denominator={connect.firstRunBase}
            sub={`최초 실행 기준 · 미연결 ${fmtInt(
              connect.notConnectedClients
            )}명은 10분 분모 밖`}
          />
        )}
        <RatioCard
          label="동시 2대+ 사용 설치"
          numerator={usage.activeClients}
          denominator={usage.base}
          sub={`모델 연결 기준 · 관측 ${fmtInt(usage.activeEvents)}회`}
        />
        <RatioCard
          label="무료 → 유료 전환"
          numerator={zf.freeToPaid.paidClients}
          denominator={zf.freeToPaid.base}
          sub={`최초 실행 기준 · 가입 대비 ${
            zf.freeToPaid.rateOfSignups == null
              ? "—"
              : fmtPct(zf.freeToPaid.rateOfSignups)
          }`}
          accent={zf.freeToPaid.paidClients > 0 ? STATUS_GOOD : undefined}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <RatioCard
          label="주 2회+ 사용"
          numerator={zf.weeklyTwicePlus.clients}
          denominator={zf.weeklyTwicePlus.base}
          sub="분모가 다르다 — 최근 7일 활동 설치 기준"
        />
        <RatioCard
          label="첫 성공 도달(창 무관)"
          numerator={ten.successClients}
          denominator={ten.base}
          sub={`${ten.windowMinutes}분 밖 성공 포함`}
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
        {fromFirstRun == null ? (
          <StatCard
            label="참고: 최초 실행 기준"
            value="—"
            sub="구버전 functions — 재배포 후 표시"
          />
        ) : (
          <RatioCard
            label="참고: 최초 실행 기준"
            numerator={fromFirstRun.withinClients}
            denominator={fromFirstRun.base}
            sub={`중앙값 ${fmtDuration(fromFirstRun.medianMs)}`}
          />
        )}
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

function OperationsUsageView({
  usage,
  kpi,
  days,
  onDrill,
}: {
  usage: UsageSummary;
  kpi: KpiCockpit | null;
  days: number;
  onDrill: (req: DrilldownRequest) => void;
}) {
  const reuse = kpi?.reuse ?? null;
  const spawn = kpi?.spawnHealth ?? null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="옵트인 표본"
          value={fmtInt(usage.sampleClientCount)}
          sub={`clientId · ${usage.rangeDays}일`}
        />
        <StatCard
          label="WAU"
          value={fmtInt(usage.wau)}
          sub="events 옵트인 표본"
        />
        <StatCard
          label="태스크 성공률"
          value={fmtPct(usage.tasks.successRate)}
          sub={`${fmtInt(usage.tasks.succeeded)} / ${fmtInt(
            usage.tasks.total
          )}`}
          accent={
            usage.tasks.successRate >= 0.7
              ? STATUS_GOOD
              : usage.tasks.successRate >= 0.4
              ? STATUS_WARN
              : STATUS_CRIT
          }
        />
        <StatCard
          label="평균 태스크 시간"
          value={fmtDuration(usage.tasks.avgDurationMs)}
          sub="task_outcomes · clientId 축"
        />
      </div>

      <Panel
        title="DAU · 스폰 추이"
        note="events 옵트인 clientId 축. 사업 판단이 아니라 이상 감지용입니다."
      >
        <MultiSeriesChart
          title="DAU · 스폰 추이"
          description="일별 고유 클라이언트와 스폰 수"
          surface="dark"
          series={[
            {
              key: "dau",
              label: "DAU",
              slot: 1,
              drillScopeKey: "usage:day",
              points: usage.activeByDay.map((d) => ({
                date: d.date,
                value: d.dau,
              })),
            },
            {
              key: "spawns",
              label: "스폰",
              slot: 3,
              drillScopeKey: "spawn:day",
              points: usage.spawnsByDay.map((d) => ({
                date: d.date,
                value: d.count,
              })),
            },
          ]}
          format={fmtInt}
          animationKey={days}
          emptyLabel="이 구간에 옵트인 사용 이벤트가 없습니다."
          onDrill={(t) => {
            const scope =
              t.scopeKey === "spawn:day" ? "spawn:day" : "usage:day";
            onDrill({ scope, date: t.date, days });
          }}
        />
      </Panel>

      {reuse || spawn ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {reuse ? (
            <>
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
                label="2번째 세션"
                value={
                  reuse.secondSessionRate == null
                    ? "—"
                    : fmtPct(reuse.secondSessionRate)
                }
                sub={`${fmtInt(reuse.secondSessionClients)} / ${fmtInt(
                  reuse.signupBase
                )}`}
              />
              <StatCard
                label="DAU/WAU 끈적임"
                value={
                  reuse.stickiness == null ? "—" : fmtPct(reuse.stickiness)
                }
                sub={`평균 DAU ${fmtInt(reuse.avgDau)} · WAU ${fmtInt(
                  reuse.wau
                )}`}
              />
            </>
          ) : null}
          {spawn ? (
            <>
              <StatCard
                label="스폰 성공률"
                value={
                  spawn.successRate == null ? "—" : fmtPct(spawn.successRate)
                }
                sub={`완료 ${fmtInt(spawn.completed)} vs 크래시 ${fmtInt(
                  spawn.crashed
                )}`}
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
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="상위 이벤트"
          note={`분포 렌즈: ${usage.metricMode === "clients" ? "고유 사용자" : "이벤트 수"}`}
        >
          <BarList
            data={usage.topEvents.map((r) => ({ key: r.key, value: r.count }))}
            maxRows={10}
            emptyLabel="이벤트 데이터가 없습니다."
            onDrill={(key) => onDrill({ scope: "segment:event", key, days })}
          />
        </Panel>
        <Panel title="스폰 — 역할별" note="agent:spawned · role">
          <BarList
            data={usage.spawnsByRole.map((r) => ({
              key: r.key,
              value: r.count,
            }))}
            color={SERIES_2}
            maxRows={10}
            emptyLabel="역할별 스폰 데이터가 없습니다."
            onDrill={(key) => onDrill({ scope: "segment:role", key, days })}
          />
        </Panel>
        <Panel title="스폰 — 모델별" note="agent:spawned · model">
          <BarList
            data={usage.spawnsByModel.map((r) => ({
              key: r.key,
              value: r.count,
            }))}
            color={SERIES}
            maxRows={10}
            emptyLabel="모델별 스폰 데이터가 없습니다."
            onDrill={(key) => onDrill({ scope: "segment:model", key, days })}
          />
        </Panel>
      </div>
    </div>
  );
}

function OperationsModelView({
  model,
  modelView,
  setModelView,
  days,
  onDrill,
}: {
  model: ModelSummary;
  modelView: "overview" | "routing";
  setModelView: (view: "overview" | "routing") => void;
  days: number;
  onDrill: (req: DrilldownRequest) => void;
}) {
  const costByModel = model.costByModel.map((r) => ({
    key: r.model,
    value: r.cost,
  }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-zinc-500">
          비용은 cost_logs 의 Firebase 계정 축(28자)이고, 성공률·라우팅은
          events/task_outcomes 의 익명 clientId 축(36자)입니다. 서로 나눠서
          ARPU나 ROI를 만들지 않습니다.
        </p>
        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-700">
          {(
            [
              ["overview", "비용·성공"],
              ["routing", "라우팅"],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => setModelView(view)}
              aria-pressed={modelView === view}
              className={`px-3 py-1.5 text-xs transition ${
                modelView === view
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {modelView === "overview" ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="모델별 비용" note="cost_logs 계정 축">
              <BarList
                data={costByModel}
                color={SERIES}
                maxRows={12}
                emptyLabel="모델별 비용 데이터가 없습니다."
                onDrill={(key) => onDrill({ scope: "segment:model", key, days })}
              />
            </Panel>
            <Panel title="일별 비용" note="cost_logs · USD">
              <LineChart
                data={model.costByDay.map((d) => ({
                  date: d.date,
                  value: d.cost,
                }))}
                color={SERIES_2}
                format={fmtCost}
                emptyLabel="일별 비용 데이터가 없습니다."
                onDrill={(date) => onDrill({ scope: "cost:day", date, days })}
              />
            </Panel>
          </div>

          {model.costByDayModel ? (
            <Panel
              title="일별 × 모델 비용"
              note={`상위 ${model.costByDayModel.models.length}개 모델 · 기타 ${fmtInt(
                model.costByDayModel.truncatedModels
              )}개 절단`}
            >
              <StackedBarChart
                dates={model.costByDayModel.dates}
                series={model.costByDayModel.models.map((m, i) => ({
                  key: m.model,
                  values: model.costByDayModel?.matrix[i] ?? [],
                }))}
                format={fmtCost}
                emptyLabel="일별 × 모델 비용 데이터가 없습니다."
                onDrill={(date) => onDrill({ scope: "cost:day", date, days })}
              />
            </Panel>
          ) : null}

          <Panel
            title="모델 × 역할 성공률·효율"
            note="성공률은 task_outcomes/events 축, 비용은 cost_logs 축 — 같은 userId 문자열이어도 공간이 다릅니다."
          >
            <ModelRoleTable
              rows={model.modelRoleStats}
              onDrill={(scope, key) => onDrill({ scope, key, days })}
            />
          </Panel>

          <Panel title="모델별 Outcome" note="task_outcomes · 운영 진단용">
            <OutcomeByModelTable rows={model.outcomeByModel} />
          </Panel>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel title="선택 모델" note="dispatch:decision selectedModel">
              <BarList
                data={model.routing.bySelectedModel.map((r) => ({
                  key: r.key,
                  value: r.count,
                }))}
                emptyLabel="선택 모델 데이터가 없습니다."
              />
            </Panel>
            <Panel title="결정 사유" note="dispatch:decision reason">
              <BarList
                data={model.routing.byDecisionReason.map((r) => ({
                  key: r.key,
                  value: r.count,
                }))}
                color={SERIES_2}
                emptyLabel="결정 사유 데이터가 없습니다."
              />
            </Panel>
            <Panel title="재사용 vs 스폰" note="라우터 경로">
              <BarList
                data={model.routing.byReuseVsSpawn.map((r) => ({
                  key: r.key,
                  value: r.count,
                }))}
                color={STATUS_WARN}
                emptyLabel="라우터 경로 데이터가 없습니다."
              />
            </Panel>
          </div>
          <Panel title="모델 선정 모드" note="수동/자동/기본값 분포">
            <BarList
              data={model.routing.byModelSelectionMode.map((r) => ({
                key: r.key,
                value: r.count,
              }))}
              emptyLabel="모델 선정 모드 데이터가 없습니다."
            />
          </Panel>
          <Panel title="매칭점수 분포" note="내부 라우팅 디버그">
            <RoutingScoreTable rows={model.routing.scoreBuckets} />
          </Panel>
        </>
      )}
    </div>
  );
}

export default function AnalyticsPanel({
  /**
   * 처음 열릴 탭. 기본은 ① 획득이고 화면에는 이 prop 을 주는 자리가 없다 —
   * ★테스트가 네 탭을 **각각 SSR 로 세워** 정직성 규약이 그 탭에서도 살아
   * 있는지 보기 위한 이음매다. 규약을 한 탭에서만 확인하면 나머지 셋에서
   * 조용히 빠져도 아무도 모른다.
   */
  initialTab = "acquisition",
}: { initialTab?: AnalyticsTab } = {}) {
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
  const [countryFunnel, setCountryFunnel] = useState<Loaded<CountryFunnel>>({
    data: null,
    loading: true,
    error: null,
  });
  const [cac, setCac] = useState<Loaded<AdminCacSummary>>({
    data: null,
    loading: true,
    error: null,
  });
  // ★① 획득 탭의 유일한 읽기 경로(계획 §5 PR 2). 이 하나가 콜러블 8개를
  //   대체한다 — 화면이 GROUP BY 를 다시 하지 않게 하려고 서버에 둔 자리다.
  const [unified, setUnified] = useState<Loaded<AcquisitionUnified>>({
    data: null,
    loading: true,
    error: null,
  });
  const [adSpendForm, setAdSpendForm] = useState<ManualAdSpendForm>(() => ({
    spendDate: todayKstDate(),
    platform: "google_ads",
    campaignName: "",
    currency: "KRW",
    amountKrw: "",
  }));
  const [adSpendSaving, setAdSpendSaving] = useState(false);
  const [adSpendStatus, setAdSpendStatus] = useState<AdSpendMatchStatus>({
    kind: "idle",
    message: "저장하면 GA4 캠페인 매칭을 바로 확인합니다.",
  });
  const [modelView, setModelView] = useState<"overview" | "routing">(
    "overview"
  );
  // ★4탭. 한 탭 = 한 질문. 새 페이지가 아니라 기존 섹션의 재배치다 —
  // 콜러블·로딩·토글은 전부 그대로 공유하고, 어느 탭에 있든 같은 모집단을 본다.
  const [tab, setTab] = useState<AnalyticsTab>(initialTab);
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

  const refreshCacSummary = useCallback(async () => {
    const fns = getFunctions(app, "us-central1");
    const callCac = httpsCallable<Record<string, never>, AdminCacSummary>(
      fns,
      "getAdminCacSummary"
    );
    const result = await callCac({});
    setCac({ data: result.data, loading: false, error: null });
    return result.data;
  }, []);

  const saveManualAdSpend = useCallback(async () => {
    const campaignName = adSpendForm.campaignName.trim();
    const amountKrw = Number(adSpendForm.amountKrw);
    if (!campaignName || !Number.isFinite(amountKrw) || amountKrw <= 0) return;

    setAdSpendSaving(true);
    setAdSpendStatus({
      kind: "saved",
      message: "저장 중 — 원장 저장 후 GA4 매칭을 확인합니다.",
    });
    try {
      const fns = getFunctions(app, "us-central1");
      const addManual = httpsCallable<
        {
          spendDate: string;
          platform: AdSpendPlatform;
          campaignName: string;
          amountKrw: number;
        },
        AddManualAdSpendResult
      >(fns, "addManualAnalyticsAdSpend");
      const loadSpend = httpsCallable<Record<string, never>, LoadAdSpendResult>(
        fns,
        "loadAnalyticsAdSpend"
      );

      await addManual({
        spendDate: adSpendForm.spendDate,
        platform: adSpendForm.platform,
        campaignName,
        amountKrw,
      });
      await loadSpend({});
      const nextCac = await refreshCacSummary();
      const match = findCampaignMatch(nextCac.summary, campaignName);
      if (match?.matched) {
        setAdSpendStatus({
          kind: "matched",
          message: `매칭됨 — GA4 캠페인 ${fmtInt(
            match.matched.acquired
          )}개 설치와 연결됐습니다.`,
        });
      } else if (match?.unmatched) {
        setAdSpendStatus({
          kind: "unmatched",
          message: "미매칭 — 캠페인명 확인 필요. 저장은 완료됐습니다.",
        });
      } else {
        setAdSpendStatus({
          kind: "unmatched",
          message: "미매칭 — 캠페인명 확인 필요. 저장은 완료됐습니다.",
        });
      }
      setAdSpendForm((f) => ({ ...f, campaignName: "", amountKrw: "" }));
    } catch (e) {
      setAdSpendStatus({
        kind: "error",
        message: `저장 또는 매칭 확인 실패 — ${mapErr(e as CallableError)}`,
      });
    } finally {
      setAdSpendSaving(false);
    }
  }, [adSpendForm, refreshCacSummary]);

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
      const callCountry = httpsCallable<
        { days: number; includeAdmin: boolean },
        CountryFunnel
      >(fns, "getAdminCountryFunnel");
      // ★통합 뷰 읽기 경로. 뷰가 아직 안 섰거나 함수가 미배포면 **0 이 아니라
      //   사유**가 온다(서버 state:"unavailable") — 화면은 그걸 그대로 그린다.
      const callUnified = httpsCallable<
        { days: number },
        AcquisitionUnified
      >(fns, CALLABLE_INSTALL_UNIFIED);

      setBiz((s) => ({ ...s, loading: true, error: null }));
      setUsage((s) => ({ ...s, loading: true, error: null }));
      setModel((s) => ({ ...s, loading: true, error: null }));
      setOnbFunnel((s) => ({ ...s, loading: true, error: null }));
      setKpi((s) => ({ ...s, loading: true, error: null }));
      setRelease((s) => ({ ...s, loading: true, error: null }));
      setBetaSeg((s) => ({ ...s, loading: true, error: null }));
      setCountryFunnel((s) => ({ ...s, loading: true, error: null }));
      setCac((s) => ({ ...s, loading: true, error: null }));
      setUnified((s) => ({
        ...s,
        loading: true,
        error: null,
        notDeployed: false,
      }));

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
      callCountry({ days: d, includeAdmin: inc })
        .then((r) =>
          setCountryFunnel({ data: r.data, loading: false, error: null })
        )
        .catch((e) =>
          setCountryFunnel({
            data: null,
            loading: false,
            error: mapErr(e as CallableError),
          })
        );
      void refreshCacSummary().catch((e) =>
        setCac({ data: null, loading: false, error: mapErr(e as CallableError) })
      );
      // ── ★선택 콜러블(아직 서버에 없을 수 있는 것들) ────────────────────
      // 매니페스트에 이름이 없으면 **호출하지 않고** 곧장 '연결 전' 으로 접는다.
      // 없는 함수를 부르면 브라우저에서는 CORS 에 막혀 `functions/internal` 이
      // 돌아오고(위 isNotDeployed 주석), 그게 사장님 화면의 빨간 오류였다.
      // 매니페스트를 못 얻으면(그 함수도 미배포 등) 예전처럼 그냥 호출한다.
      const callManifest = httpsCallable<
        Record<string, never>,
        CallableManifest
      >(fns, CALLABLE_MANIFEST);
      const deployedNames: Promise<Set<string> | null> = callManifest({})
        .then((r) => new Set(r.data?.callables ?? []))
        .catch(() => null);

      const runOptional = <T,>(
        name: string,
        invoke: () => Promise<{ data: T }>,
        set: (v: Loaded<T>) => void
      ) => {
        void deployedNames.then((names) => {
          if (names != null && !names.has(name)) {
            // 서버가 "그런 함수 없다" 고 말했다 — 장애가 아니라 배선 전이다.
            set({ data: null, loading: false, error: null, notDeployed: true });
            return;
          }
          return invoke()
            .then((r) => set({ data: r.data, loading: false, error: null }))
            .catch((e) => {
              const err = e as CallableError;
              if (isNotDeployed(err)) {
                set({
                  data: null,
                  loading: false,
                  error: null,
                  notDeployed: true,
                });
                return;
              }
              set({ data: null, loading: false, error: mapErr(err) });
            });
        });
      };

      runOptional(
        CALLABLE_INSTALL_UNIFIED,
        () => callUnified({ days: d }),
        (v) => setUnified(v)
      );
    },
    [refreshCacSummary]
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

      <AnalyticsTabBar tab={tab} onChange={setTab} />

      {/* ── ① 획득 — "어디서 오고, 얼마 쓰면 몇 명 오나" ────────────────────
          ★계획 v3/docs/admin-analytics-replan-2026-08-24.md §4-1 을 그대로
            집행한다. 표 순서 = 결정하는 순서다.
          ★모든 수치의 알갱이는 **설치 1행**(marblo_telemetry.v_install_unified)
            이다. 화면은 GROUP BY 결과를 그리기만 하고 다시 세지 않는다 — 세는
            코드가 여러 벌이 된 것이 계획 §0 이 진단한 병 그 자체다. */}
      {tab === "acquisition" && (
        <div
          id="analytics-panel-acquisition"
          role="tabpanel"
          aria-labelledby="analytics-tab-acquisition"
          className="space-y-8"
        >
          <AxisLimitNote
            notes={[
              "★분모는 방문이 아니라 다운로드·설치입니다(#1200). 봇은 Electron 데스크톱을 내려받아 설치하고 실행하지 않으므로, 설치를 분모로 쓰는 순간 봇은 규칙 없이도 0 으로 셉니다. 방문 축에서 거른 '의심 유입' 은 삭제하지 않고 아래 방문 축 표에 따로 남깁니다.",
              "★이 탭에는 축이 둘 있습니다 — 설치 축(통합 뷰)과 방문 축(GA4 브라우저). 두 표의 분모가 다르므로 위아래로 놓고 곱해서 읽지 마세요. 어느 표가 어느 축인지는 섹션 제목에 적혀 있습니다.",
              "★설치 수는 사람 수가 아닙니다. 실측(2026-08-24)으로 설치 631행이 브라우저 5대에서 나왔습니다(재설치 루프). 그래서 상단에 전체 설치와 사람 추정치를 같이 둡니다(#1198 install_class).",
              "설치 축의 모든 수치는 marblo_telemetry.v_install_unified 한 표에서 나옵니다 — 화면은 GROUP BY 만 하고 다시 세지 않습니다. 콜러블 이름은 getAdminInstallUnified 이고, 그게 아직 없으면 0 대신 '적재 전' 이라고 적습니다.",
            ]}
          />

          {/* ── ★상단 3줄 — 분모를 화면 맨 위에 못 박는다 (계획 §4-1) ─── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Database}
              title="설치 · 채널 커버리지 · CAC (설치 축)"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            >
              {unified.data?.source && (
                <span
                  className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-500"
                  title="이 탭의 모든 설치 축 수치가 나오는 단 하나의 표. 화면은 여기서 GROUP BY 만 합니다."
                >
                  {unified.data.source}
                </span>
              )}
            </SectionHeader>
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <AcquisitionHeadlineView unified={unified.data} cac={cac.data} />
            )}
            {/* ★차트를 새로 만들지 않았다 — #1211 이 넣은 공용
                MultiSeriesChart(recharts) 를 그대로 쓴다. 라이브러리는
                ChartFrame 뒤에 갇혀 있어 이 호출부는 계약(NamedSeries)만 안다.
                ★state 를 **부르는 쪽이 정해서 준다**: 뷰가 없으면 'pending'
                이라 0 선을 긋지 않는다(charts/types.ts 의 규약). */}
            <Panel
              title="일별 설치 추이 (외부 설치)"
              note="firstRunAt 기준 · 채널을 아는 설치를 같은 축에 얹는다"
            >
              <MultiSeriesChart
                title="일별 설치 추이"
                description="외부 설치와, 그중 채널을 아는 설치"
                surface="dark"
                state={
                  unified.data?.state === "ready"
                    ? unified.data.installsByDay.length > 0
                      ? "ready"
                      : "empty"
                    : "pending"
                }
                pendingLabel="통합 뷰(v_install_unified)가 아직 없습니다 — 0 을 그리지 않습니다."
                emptyLabel="이 구간에 설치가 없습니다."
                series={[
                  {
                    key: "installs",
                    label: "설치(외부)",
                    slot: 1,
                    points: (unified.data?.installsByDay ?? []).map((d) => ({
                      date: d.date,
                      value: d.installs,
                    })),
                  },
                  {
                    key: "channelKnown",
                    label: "채널을 아는 설치",
                    slot: 3,
                    points: (unified.data?.installsByDay ?? []).map((d) => ({
                      date: d.date,
                      value: d.channelKnown,
                    })),
                  },
                ]}
                format={fmtInt}
                animationKey={days}
              />
            </Panel>
          </div>

          {/* ── 1. 채널별 통합표 — 캠페인이 실재하는 행만 ─────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Globe}
              title="채널별 획득 (소스 · 매체 · 캠페인 · 소재)"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              // ★조회 실패는 '연결 전' 이 아니다. 두 말을 섞으면 고칠 사람이
              //   기다리기만 한다.
              <ErrorBox msg={unified.error} />
            ) : (
              <AcquisitionChannelTable data={unified.data} />
            )}
          </div>

          {/* ── 2. ★채널 미상 사유표 — 이 페이지에서 가장 중요한 표 ────
              1번 표가 비었을 때 "광고를 안 켰다" 인지 "조인이 깨졌다" 인지를
              가르는 곳이 여기뿐이다. 두 답은 우리가 할 일이 정반대다. */}
          <div className="space-y-4">
            <SectionHeader
              icon={Unlink}
              title="★채널 미상 사유 — '모른다' 와 '안다, 캠페인이 없었다'"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <ChannelMissingReasonTable data={unified.data} />
            )}
          </div>

          {/* ── 3. 국가별 — 설치 축(통합 뷰) + 방문 축(GA4) 대조 ──────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Globe}
              title="국가별 획득 (설치 축)"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <AcquisitionCountryTable data={unified.data} />
            )}

            <SectionHeader
              icon={Users}
              title="방문 → 다운로드 (방문 축 · 설치 이전 단계)"
              trust="yellow"
            />
            {/* ★방문·다운로드는 설치 **이전**이라 설치 알갱이로 접히지 않는다
                (계획 §3-4). 그래서 이 표만 방문 축으로 남기고, 설치 이후 단계는
                위 통합 뷰가 가져갔다 — 한 표에 두 축을 섞어 퍼널로 그리던 것이
                이 화면의 오래된 병이었다. */}
            {countryFunnel.loading ? (
              <LoadingBox />
            ) : countryFunnel.error ? (
              <ErrorBox msg={countryFunnel.error} />
            ) : countryFunnel.data ? (
              <CountryFunnelView data={countryFunnel.data} />
            ) : null}
          </div>

          {/* ── 4. 광고비 원장 × 채널 (#1193 수동 원장) ────────────────── */}
          <div className="space-y-4">
            <SectionHeader icon={Tag} title="광고비 원장 × 채널" trust="yellow" />
            <Ga4BridgeFreshnessNote data={countryFunnel.data?.ga4Bridge} />
            <ManualAdSpendInputPanel
              form={adSpendForm}
              saving={adSpendSaving}
              status={adSpendStatus}
              onChange={(patch) =>
                setAdSpendForm((f) => ({
                  ...f,
                  ...patch,
                  currency: "KRW",
                }))
              }
              onSubmit={saveManualAdSpend}
            />
            {cac.loading ? (
              <LoadingBox />
            ) : cac.error ? (
              <ErrorBox msg={cac.error} />
            ) : (
              <CacSummaryView data={cac.data} />
            )}
          </div>

          {/* ── 5. 대기자·파운더 원장 (🟢 Firestore) ────────────────────
              ★맨 아래다. 초록이라 믿을 만하지만 **광고 성과와 다른 축**이라
                위에 두면 섞여 읽힌다(계획 §4-1 표5). */}
          <div className="space-y-4">
            <SectionHeader icon={UserCheck} title="대기자 · 파운더 원장" trust="green" />
            {biz.loading ? (
              <LoadingBox />
            ) : biz.error ? (
              <ErrorBox msg={biz.error} />
            ) : b ? (
              <>
                <SmallSampleNotice
                  n={b.waitlist.total}
                  what="대기자(가입)"
                  unit="명"
                />
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
                  {/* ★전환은 카드에서도 분수가 먼저다 — "12%" 만 큰 글씨로
                      띄우면 분모가 몇인지 화면 어디에도 남지 않는다. */}
                  <RatioCard
                    label="대기자 → 파운더 선정"
                    numerator={b.founders.accessGranted}
                    denominator={b.waitlist.total}
                    sub="누적(조회 기간 무관)"
                    title="선정률 = accessGranted / 대기자 총원. 둘 다 Firestore 원장이라 항상 켜져 있는 축입니다."
                  />
                  <RatioCard
                    label="파운더 → 설문 제출"
                    numerator={b.founders.feedbackSubmitted}
                    denominator={b.founders.accessGranted}
                    sub="누적(조회 기간 무관)"
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── ② 활성화 — "들어온 사람이 가치를 보나" ──────────────────────── */}
      {tab === "activation" && (
        <div
          id="analytics-panel-activation"
          role="tabpanel"
          aria-labelledby="analytics-tab-activation"
          className="space-y-8"
        >
          <AxisLimitNote
            notes={[
              "활성화 탭의 헤드라인은 getAdminInstallUnified 한 경로에서 읽습니다. 설치 1행이 알갱이이고, 사람 수는 단일값이 아니라 범위로 표시합니다.",
              unifiedHumanRange(unified.data),
              "제품 사용·릴리스·라우팅·비용 같은 운영용 표본 지표는 이 사업 탭에서 내렸습니다. 이 탭은 들어온 설치가 첫 스폰·첫 완주까지 갔는지만 봅니다.",
            ]}
          />

          {/* ── ★상단 3줄 — 계획 §4-2 ─────────────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Database}
              title="첫 스폰 · 첫 완주 · 첫 스폰까지 중앙 소요 (설치 축)"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            >
              {unified.data?.source && (
                <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-500">
                  {unified.data.source}
                </span>
              )}
            </SectionHeader>
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedActivationHeadlineView data={unified.data} />
            )}
          </div>

          {/* ── 1. 단계별 도달 퍼널 — 유지 ─────────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Activity}
              title="단계별 도달 퍼널"
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

          {/* ── 2. 온보딩 스톨 · 차단 사유 — 유지 ─────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Gauge}
              title="온보딩 스톨 · 차단 사유"
              trust="yellow"
            />
            {kpi.loading ? (
              <LoadingBox />
            ) : kpi.error ? (
              <ErrorBox msg={kpi.error} />
            ) : kpi.data?.onboardingStall ? (
              <>
                <QueryStatusBanner status={kpi.data.queryStatus} />
                <OnboardingStallCard stall={kpi.data.onboardingStall} />
              </>
            ) : (
              <PendingIngestion
                title="온보딩 스톨 · 차단 사유"
                waitingOn="getAdminKpiCockpit.onboardingStall — 정규 차단 사유와 가이드 모달 노출"
                willShow={[
                  "온보딩 스톨",
                  "차단 사유 (정규 어휘 / errorCategory)",
                  "가이드 모달 노출",
                ]}
              />
            )}
          </div>

          {/* ── 3. 채널별 활성화 — 통합표 ──────────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Globe}
              title="채널별 활성화"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedActivationChannelTable data={unified.data} />
            )}
          </div>

          {/* ── 4. 좀비 분리 — 리텐션 신뢰 전제 ───────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Database}
              title="좀비 분리"
              trust={unified.data?.retention?.zombie ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedZombieSeparationView data={unified.data} />
            )}
          </div>

          {/* ── 5. 작은 표본 지표 — 기본 접힘 ─────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Lock}
              title="표본 찰 때까지 접음"
              trust="yellow"
            />
            <FoldedActivationSmallSamples />
          </div>

        </div>
      )}

      {/* ── ③ 리텐션 — "남아서 계속 쓰나" ──────────────────────────────── */}
      {tab === "retention" && (
        <div
          id="analytics-panel-retention"
          role="tabpanel"
          aria-labelledby="analytics-tab-retention"
          className="space-y-8"
        >
          <AxisLimitNote
            notes={[
              "리텐션 탭은 관측창이 닫힌 설치만 분모로 씁니다. d*_pending 으로 빠진 설치는 이탈 0% 가 아니라 아직 판단 불가입니다.",
              unifiedHumanRange(unified.data),
              "모델 비용·라우팅 진단은 운영용이라 이 탭에서 내렸습니다. 수익 탭과 운영 탭은 별도 티켓이 같은 파일에서 다룹니다.",
            ]}
          />

          {/* ── ★상단 3줄 — 계획 §4-3 ─────────────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Repeat}
              title="D7 · D30 잔존 · 아직 판단 불가"
              trust={unified.data?.retention ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRetentionHeadlineView data={unified.data} />
            )}
          </div>

          {/* ── 1. 주간 코호트표 — 통합표 ─────────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Repeat}
              title="주간 코호트"
              trust={unified.data?.retention ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRetentionCohortTable data={unified.data} />
            )}
          </div>

          {/* ── 2. 채널별 리텐션 — 통합표 ─────────────────────────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Globe}
              title="채널별 리텐션"
              trust={unified.data?.retention ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRetentionChannelTable data={unified.data} />
            )}
          </div>

          {/* ── 3. 사람 축 대조 — 설치 수를 사람으로 읽지 않기 ─────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Link2}
              title="사람 축 대조"
              trust={unified.data?.state === "ready" ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedPersonAxisComparison data={unified.data} />
            )}
          </div>

          {/* ── 4. 스트릭 단위표/격자 — 유지하되 통합 경로 대기 ─────── */}
          <div className="space-y-4">
            <SectionHeader
              icon={Activity}
              title="스트릭 단위표/격자"
              trust="unwired"
            />
            <PendingIngestion
              title="스트릭 단위표/격자"
              waitingOn={`${CALLABLE_INSTALL_UNIFIED} — 통합 뷰에서 스트릭 단위표를 내려주는 응답 확장`}
              willShow={[
                "어느 설치/사람이 D7 값을 만들었는지",
                "최근 활동 격자",
                "스트릭 정확 리텐션은 기본 접힘",
              ]}
            />
          </div>

        </div>
      )}

      {/* ── ④ 수익 — "쓰는 사람이 돈을 내나" ───────────────────────────── */}
      {tab === "revenue" && (
        <div
          id="analytics-panel-revenue"
          role="tabpanel"
          aria-labelledby="analytics-tab-revenue"
          className="space-y-8"
        >
          <AxisLimitNote
            notes={[
              "수익 탭의 설치·채널 매출 축은 getAdminInstallUnified 한 경로에서 읽습니다. 원장은 정본이고 GA4 이커머스는 채널 귀속 보조 경로입니다.",
              "★적재 전 · 진짜 0 · 미상을 세로로 가릅니다. 특히 analytics_user_daily.install_key_hmac 다리가 NULL 이면 매출 0 이 아니라 설치에 결제를 붙일 수 없는 미상입니다.",
              "외부 결제 1건(19,000원, portone)은 founder_grant 33건·내부테스트 1건과 섞지 않습니다. 구독 건수와 실매출도 서로 다른 숫자입니다.",
              "연속 청구 사이클은 Toss billingCharges 원장만 채웁니다. Paddle 구독은 원장 공백이라 그 칸의 0 은 '연속 결제가 없다' 가 아니라 '이 원장에 없다' 입니다.",
            ]}
          />

          <div className="space-y-4">
            <SectionHeader
              icon={Database}
              title="외부 매출 · GA4 대조 · 설치→결제"
              trust={unified.data?.revenue ? "yellow" : "unwired"}
            >
              {unified.data?.source && (
                <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-500">
                  {unified.data.source}
                </span>
              )}
            </SectionHeader>
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRevenueHeadlineView data={unified.data} business={b} />
            )}
          </div>

          <div className="space-y-4">
            <SectionHeader icon={CreditCard} title="구독 원장" trust="green" />
            {biz.loading ? (
              <LoadingBox />
            ) : biz.error ? (
              <ErrorBox msg={biz.error} />
            ) : b ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
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
                    )} · 무료부여 ${fmtInt(
                      b.subscriptions.founderGrantActive
                    )}`}
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
                      b.subscriptions.churnedInWindow > 0
                        ? STATUS_CRIT
                        : undefined
                    }
                  />
                  <StatCard
                    label="파운더 무료부여"
                    value={fmtInt(b.subscriptions.founderGrantActive)}
                    sub="매출 아님 · 구독 권한"
                  />
                  <StatCard
                    label="Paddle 활성"
                    value={fmtInt(b.subscriptions.paddleActiveCurrent)}
                    sub="연속 청구 원장 공백"
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
                    {/* ★대표 차트 2 — 다계열. 손 SVG TwoLineChart 에서 공용
                        MultiSeriesChart(recharts) 로 옮긴 자리다(티켓
                        cUsZBatAgMXGeUObwFmV). 여기서 실제로 보이는 것:
                        · 호버가 한 점이 아니라 **그날의 두 계열 단면**을 낸다
                        · 범례를 눌러 계열을 끄면 **축도 같이 줄어든다**
                        · 클릭하면 그날 상세로 들어간다(기존 onDrill 그대로)
                        · 하이드레이션 전에는 같은 높이의 스켈레톤이 선다

                        색은 그대로다 — '성장'은 슬롯3(#199e70, 기존 SERIES_2 와
                        같은 값), '이탈'은 상태색 critical(#d03b3b, 기존
                        STATUS_CRIT). ★이탈에 상태색을 쓰는 건 색이 모자라서가
                        아니라 그 계열이 '나쁜 쪽'을 뜻하기 때문이고, 색만으로
                        말하지 않도록 범례 라벨이 항상 함께 나간다.

                        drillScopeKey: 어드민은 전수를 보는 화면이라
                        visibleScopes 게이트가 없다. 조직 대시보드에서 같은
                        컴포넌트를 쓸 때는 **반드시 visibleScopes 를 넘긴다**
                        (org-access §3.4). */}
                    <MultiSeriesChart
                      title="성장/이탈 추이"
                      description="신규 구독과 이탈을 같은 축에서 본다"
                      surface="dark"
                      series={[
                        {
                          key: "new",
                          label: "성장",
                          slot: 3,
                          drillScopeKey: "subscription:all",
                          points: subscriptionTrend.map((d) => ({
                            date: d.date,
                            value: d.new,
                          })),
                        },
                        {
                          key: "churned",
                          label: "이탈",
                          slot: 3,
                          tone: "critical",
                          drillScopeKey: "subscription:all",
                          points: subscriptionTrend.map((d) => ({
                            date: d.date,
                            value: d.churned,
                          })),
                        },
                      ]}
                      format={fmtInt}
                      animationKey={days}
                      emptyLabel="성장/이탈 이벤트가 없습니다."
                      onDrill={(t) =>
                        openDrill({ scope: "subscription:day", date: t.date, days })
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
              </>
            ) : null}
          </div>

          <div className="space-y-4">
            <SectionHeader
              icon={CreditCard}
              title="실매출 · 결제 분류"
              trust={unified.data?.revenue ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRevenueClassificationView data={unified.data} />
            )}
          </div>

          <div className="space-y-4">
            <SectionHeader
              icon={CreditCard}
              title="채널별 매출"
              trust={unified.data?.revenue ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRevenueChannelTable data={unified.data} />
            )}
          </div>

          <div className="space-y-4">
            <SectionHeader
              icon={Unlink}
              title="★결제 축 미상 사유 — 적재 전 · 진짜 0 · 미상"
              trust={unified.data?.revenue ? "yellow" : "unwired"}
            />
            {unified.loading ? (
              <LoadingBox />
            ) : unified.error ? (
              <ErrorBox msg={unified.error} />
            ) : (
              <UnifiedRevenueMissingReasonTable data={unified.data} />
            )}
          </div>

          <div className="space-y-4">
            <SectionHeader icon={Info} title="운영 지표 이동 안내" trust="yellow" />
            <Panel
              title="여기 있던 운영용 지표는 ⑤ 운영으로 갔다"
              note="모델 비용·라우팅·릴리스 헬스·옵트인 사용 표본은 매출 판단과 분모가 다릅니다."
            >
              <p className="text-sm leading-relaxed text-zinc-400">
                MRR/LTV처럼 원천이 전량 null 이던 카드와 코호트 회수 플레이스홀더는
                삭제했습니다. 실제 배포·라우팅 상태를 볼 때는 ⑤ 운영 탭을 엽니다.
              </p>
            </Panel>
          </div>
        </div>
      )}

      {/* ── ⑤ 운영 — "배포·라우팅이 건강한가" ───────────────────────────── */}
      {tab === "operations" && (
        <div
          id="analytics-panel-operations"
          role="tabpanel"
          aria-labelledby="analytics-tab-operations"
          className="space-y-8"
        >
          <AxisLimitNote
            notes={[
              "옵트인 표본 · 운영용. 사업 판단에 쓰지 마세요.",
              "cost_logs 는 Firebase 계정 축(28자)이고 task_outcomes·events 는 익명 clientId(36자) 축입니다. 같은 userId 컬럼명이어도 표를 가로질러 나누지 않습니다.",
              "활성화·리텐션·수익 탭에서 빠진 모델·라우팅·릴리스 헬스·베타세그먼트 지표를 이 탭으로 옮겼습니다.",
            ]}
          />

          <div className="space-y-4">
            <SectionHeader icon={Activity} title="제품 사용 표본" trust="yellow" />
            {usage.loading ? (
              <LoadingBox />
            ) : usage.error ? (
              <ErrorBox msg={usage.error} />
            ) : usage.data ? (
              <OperationsUsageView
                usage={usage.data}
                kpi={kpi.data}
                days={days}
                onDrill={openDrill}
              />
            ) : null}
          </div>

          <div className="space-y-4">
            <SectionHeader
              icon={Cpu}
              title="모델 비용 · 성공률 · 라우팅"
              trust="yellow"
            />
            {model.loading ? (
              <LoadingBox />
            ) : model.error ? (
              <ErrorBox msg={model.error} />
            ) : model.data ? (
              <OperationsModelView
                model={model.data}
                modelView={modelView}
                setModelView={setModelView}
                days={days}
                onDrill={openDrill}
              />
            ) : null}
          </div>

          <div className="space-y-4">
            <SectionHeader icon={Repeat} title="릴리스·버전 헬스" trust="yellow" />
            {release.loading ? (
              <LoadingBox />
            ) : release.error ? (
              <ErrorBox msg={release.error} />
            ) : release.data ? (
              <ReleaseHealthView data={release.data} />
            ) : null}
          </div>

          <div className="space-y-4">
            <SectionHeader icon={UserCheck} title="베타 세그먼트" trust="yellow" />
            {betaSeg.loading ? (
              <LoadingBox />
            ) : betaSeg.error ? (
              <ErrorBox msg={betaSeg.error} />
            ) : betaSeg.data ? (
              <BetaSegmentView data={betaSeg.data} />
            ) : null}
          </div>
        </div>
      )}

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
// ★서버에서 은퇴한 표다(adminAnalytics.MODEL_BREAKDOWN_RETIRED): 이 분해를
// 만들던 events↔cost_logs 의 agentId 조인이 곧 익명 텔레메트리를 계정으로
// 되짚는 경로였다. 렌더러는 남겨 두되 항상 빈 상태 + 사유 note 를 보여준다.
function SubModelBreakdownTable({
  harnesses,
  onDrill,
}: {
  harnesses: NonNullable<ModelSummary["modelBreakdown"]>["harnesses"];
  onDrill?: (model: string) => void;
}) {
  if (harnesses.length === 0) {
    return <EmptyState label="은퇴한 분해입니다 — 아래 사유를 참고하세요." />;
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
