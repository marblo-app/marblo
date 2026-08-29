// ════════════════════════════════════════════════════════════════════════════
// ★사장님 광고→ACTIVATED 퍼널 — 조립 로직 (ticket O5JPlh4FSiCsNpZ4E9VJ)
// ════════════════════════════════════════════════════════════════════════════
//
// 사장님이 광고 퍼널을 새로 정의하시면서 **광고 최적화 KPI 를 Beta Signup 이
// 아니라 Activated Beta 로** 잡으셨다. 즉 광고를 신청 수가 아니라 "실제로 쓰기
// 시작한 사람 수" 로 평가한다.
//
//   Instagram/YouTube/X → 콘텐츠 → AI Builder Guide → Marblo Beta →
//   Beginner Mode(설치/Login) → 첫 Project → 첫 Agent Task → 3 Tasks → ACTIVATED
//
// ── 이 파일이 하는 일 / 안 하는 일 ──────────────────────────────────────────
// 하는 일: 이미 있는 세 콜러블의 응답을 **나눗셈만 해서** 사장님 퍼널 모양으로
//          늘어놓고, 목표치와 나란히 놓는다.
// 안 하는 일: 새 집계를 만들지 않는다. 새 이벤트를 만들지 않는다. 없는 값을
//          0 으로 그리지 않는다.
//
// ── ★세 개의 서로 다른 소스를 한 퍼널에 늘어놓는다는 것 ─────────────────────
// 이 퍼널은 소스가 셋이고, 그 경계에서 분자와 분모의 모집단이 **다르다**:
//   ① 광고 플랫폼(Instagram/YouTube/X) — 노출·클릭·비용. **우리 BQ 에 없다.**
//   ② GA4 웹(marblo.app)              — 랜딩 방문 · 다운로드. 익명 GA4 client_id 축.
//   ③ 앱 텔레메트리(events)            — 설치~ACTIVATED. 익명 설치 ID 축.
// 같은 사람이 ②에서 1, ③에서 1 로 세어진다는 보장이 없다(다운로드 후 설치 안 함,
// 링크백 실패 등). 그래서 소스가 바뀌는 칸은 `crossSource: true` 로 표시하고
// 화면이 그 경계를 그리게 한다. ★경계를 숨기고 한 줄로 이으면 그게 3.1% 사고다.
//
// ── ★없는 것을 0 으로 그리지 않는다 ─────────────────────────────────────────
// 광고 노출·클릭·CTR 은 각 광고 플랫폼에 있고 우리 원장에는 **입력 칸조차 없다**
// (`analytics_ad_spend` 는 spendDate·platform·campaignName·campaignKey·amountKrw
// 뿐이다). 0% CTR 로 그리면 "광고가 아무도 안 눌렀다" 는 없는 사실이 생긴다.
// 그래서 `unmeasured` 로 두고, **무엇을 하면 측정되는지**를 같이 적는다.

// ── 서버 계약의 거울 ────────────────────────────────────────────────────────
// ★정본은 `v3/functions/src/adFunnel.ts` + `v3/functions/src/activatedDefinition.ts`
//   다. 여기서 숫자를 만들지 않고, **ACTIVATED 정의도 지어내지 않는다** — 서버가
//   정의문(임계값·조건·축 라벨)을 실어 보내고 화면은 그걸 렌더만 한다. 웹이 "3개
//   이상" 을 하드코딩하는 순간 어드민 두 화면(②광고 · KPI)의 정의가 갈라진다.

export type ActivatedAxis = "install" | "person";

export type ActivatedDefinitionDto = {
  id: string;
  minTasksCompleted: number;
  axis: ActivatedAxis;
  axisLabel: string;
  axisNote: string;
  label: string;
  criteria: { key: string; label: string; signal: string }[];
  derivationNote: string;
};

export type ActivatedLadderStepDto = {
  key: string;
  label: string;
  units: number;
  conversionFromPrev: number | null;
  exceedsPrev: boolean;
};

/**
 * ★같은 정의를 더 넓은 커버리지 소스(analytics_install_profile)로 다시 센 값.
 * 실측(2026-08-29): events 축 Task 합계 43 · 프로필 축 1,494 — **같은 설치 축인데
 * 렌더러 `task:completed` 가 구조적으로 과소계상**이다. 한쪽을 골라 조용히 이기게
 * 두지 않고 둘 다 그린다.
 */
export type ActivatedProfileDto = {
  sourceKey: "install_profile";
  sourceLabel: string;
  installUnits: number;
  agentUnits: number;
  taskMinUnits: number;
  activatedUnits: number;
  /** '실제 프로젝트' 조건을 스폰으로 대신 읽었나(추론). */
  projectConditionInferred: boolean;
  note: string;
};

export type ActivatedLadderDto = {
  definition: ActivatedDefinitionDto;
  steps: ActivatedLadderStepDto[];
  activatedUnits: number;
  installUnits: number;
  /** null = 교차 확인 쿼리가 실패했다. ★0 이 아니다. */
  profile?: ActivatedProfileDto | null;
  notes: string[];
};

// ── 목표치 (사장님 KPI 표 원문) ─────────────────────────────────────────────
// ★상수로 둔다. 화면 JSX 안에 흩어 놓으면 목표가 바뀔 때 한 칸만 고쳐진다.

export type AdFunnelTarget = {
  /** 화면에 그대로 쓰는 목표 문구. */
  label: string;
  /** 하한(비율). null = 하한 없음. */
  min: number | null;
  /** 상한(비율). "10~20%" 처럼 구간 목표일 때만. */
  max: number | null;
};

export const AD_FUNNEL_TARGETS = {
  adCtr: { label: "1.5%+", min: 0.015, max: null },
  landingToBeta: { label: "10~20%", min: 0.1, max: 0.2 },
  betaToInstall: { label: "60%+", min: 0.6, max: null },
  installToProject: { label: "60%+", min: 0.6, max: null },
  projectToTasks: { label: "50%+", min: 0.5, max: null },
  signupToActivated: { label: "30~40%+", min: 0.3, max: 0.4 },
} as const satisfies Record<string, AdFunnelTarget>;

/** Activated CPA 목표 — ₩3~5만 이하. 상한(5만)을 달성 기준으로 쓴다. */
export const ACTIVATED_CPA_TARGET_MAX_KRW = 50000;
export const ACTIVATED_CPA_TARGET_LABEL = "₩3~5만 이하";

// ── 퍼널 행 ─────────────────────────────────────────────────────────────────

/** 이 칸의 숫자가 어느 소스에서 왔나. 경계에서 모집단이 바뀐다는 사실의 근거. */
export type AdFunnelBasis = "ad_platform" | "ga4_web" | "app_telemetry";

export const AD_FUNNEL_BASIS_LABEL: Readonly<Record<AdFunnelBasis, string>> = {
  ad_platform: "광고 플랫폼(Instagram·YouTube·X)",
  ga4_web: "GA4 웹 (marblo.app · 익명 GA4 client_id)",
  app_telemetry: "앱 텔레메트리 events (익명 설치 ID)",
};

/** 측정할 수 없는 칸이 왜 없는지 + 무엇을 하면 생기는지. */
export type AdFunnelUnmeasured = {
  reason: string;
  /** ★다음 사람이 무엇을 하면 이 칸이 채워지는지. 적어 두지 않으면 또 판다. */
  whatWouldFixIt: string;
};

export type AdFunnelConversion = {
  numerator: number;
  denominator: number;
  /** 분모 0 이면 null — ★0% 가 아니다("판단 불가"와 "전원 이탈"은 다르다). */
  rate: number | null;
  /** 분자가 분모보다 큰가. 조회창 경계·소스 차이로 실제로 일어난다. */
  exceedsDenominator: boolean;
};

export type AdFunnelRow = {
  key: string;
  /** 사장님 퍼널의 단계 이름. */
  stage: string;
  basis: AdFunnelBasis;
  /** 이 칸의 도달 수. 측정 불가면 null — ★0 이 아니다. */
  reached: number | null;
  /** 도달 수의 단위(설치/방문/다운로드). "명" 이라고 쓰지 않는다. */
  unitLabel: string;
  /** 이 칸의 전환율을 어느 칸에 대해 재는가. null = 퍼널 시작 칸. */
  conversionFromKey: string | null;
  conversion: AdFunnelConversion | null;
  target: AdFunnelTarget | null;
  /** 목표 달성 여부. ★측정 불가·분모 0 이면 null(미달이 아니다). */
  targetMet: boolean | null;
  unmeasured: AdFunnelUnmeasured | null;
  /** 직전 칸과 소스가 다른가. 다르면 전환율은 추정이다. */
  crossSource: boolean;
  /** 이 칸을 읽을 때 반드시 같이 읽어야 하는 한 줄. */
  warning: string | null;
};

export type ActivatedCpa =
  | {
      kind: "ok";
      spendKrw: number;
      activatedUnits: number;
      cpaKrw: number;
      targetMaxKrw: number;
      targetLabel: string;
      targetMet: boolean;
      /** ★광고비 원장은 전기간 합계고 ACTIVATED 는 조회창 N일이다. */
      periodMismatchNote: string | null;
    }
  | { kind: "unavailable"; reason: string; whatWouldFixIt: string };

export type AdFunnelResult = {
  rows: AdFunnelRow[];
  cpa: ActivatedCpa;
  /** 서버가 내려준 ACTIVATED 정의문. 없으면 함수 미배포. */
  definition: ActivatedDefinitionDto | null;
  /** ★교차 확인 소스. 화면이 두 숫자를 나란히 그리게 하는 자리. */
  profile: ActivatedProfileDto | null;
  /** 화면 상단에 그대로 거는 축·한계 문구. */
  notes: string[];
};

// ── 입력 ────────────────────────────────────────────────────────────────────

export type AdFunnelInput = {
  /** getAdminOnboardingFunnel.activatedLadder. 구버전 함수면 null/undefined. */
  ladder: ActivatedLadderDto | null | undefined;
  /** getAdminCountryFunnel.totals — 봇 제외 방문 · 다운로드. */
  web: { visitors: number; downloads: number } | null | undefined;
  /** getAdminCacSummary 에서 뽑은 광고비 합계. null = 원장을 못 읽었다. */
  spendKrw: number | null;
  /** 조회창(일). CPA 기간 불일치 문구에 쓴다. */
  rangeDays: number;
};

const LADDER_UNMEASURED: AdFunnelUnmeasured = {
  reason: "getAdminOnboardingFunnel 응답에 activatedLadder 가 없습니다 — 함수 미배포",
  whatWouldFixIt:
    "v3/functions 배포(firebase deploy --only functions). 머지만으로는 살아나지 않습니다.",
};

const WEB_UNMEASURED: AdFunnelUnmeasured = {
  reason: "GA4 웹 퍼널(getAdminCountryFunnel)을 읽지 못했습니다",
  whatWouldFixIt: "GA4 브리지 적재 상태와 콜러블 오류를 ①획득 탭에서 확인합니다.",
};

/** 광고 플랫폼 지표 — 우리 데이터가 아니다. 입력 칸조차 없다. */
const AD_PLATFORM_UNMEASURED: AdFunnelUnmeasured = {
  reason:
    "노출·클릭은 Instagram/YouTube/X 쪽 데이터이고, 광고비 원장" +
    "(analytics_ad_spend)에는 금액 칸만 있어 입력 경로가 없습니다.",
  whatWouldFixIt:
    "광고비 수동 입력 폼과 analytics_ad_spend 스키마에 impressions·clicks 를 " +
    "더하거나(수동), 각 광고 플랫폼 API 를 연동해야 합니다(자동). " +
    "둘 다 하기 전에는 0% 가 아니라 '미계측' 입니다.",
};

function conversion(
  numerator: number,
  denominator: number
): AdFunnelConversion {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
    exceedsDenominator: numerator > denominator,
  };
}

/**
 * 목표 달성 판정. ★비율이 null(분모 0·측정 불가)이면 **null** 이다 — 미달이
 * 아니다. 0% 로 접어 "미달" 도장을 찍으면 계측 공백이 제품 실패로 둔갑한다.
 */
export function meetsTarget(
  rate: number | null,
  target: AdFunnelTarget | null
): boolean | null {
  if (target == null || rate == null) return null;
  if (target.min != null && rate < target.min) return false;
  return true;
}

/** 없는 칸(측정 불가) 한 줄. */
function unmeasuredRow(args: {
  key: string;
  stage: string;
  basis: AdFunnelBasis;
  unitLabel: string;
  conversionFromKey: string | null;
  target: AdFunnelTarget | null;
  unmeasured: AdFunnelUnmeasured;
  crossSource?: boolean;
}): AdFunnelRow {
  return {
    key: args.key,
    stage: args.stage,
    basis: args.basis,
    reached: null,
    unitLabel: args.unitLabel,
    conversionFromKey: args.conversionFromKey,
    conversion: null,
    target: args.target,
    targetMet: null,
    unmeasured: args.unmeasured,
    crossSource: args.crossSource ?? false,
    warning: null,
  };
}

/** 서버 사다리에서 한 칸을 찾는다. 없으면 null(0 으로 채우지 않는다). */
function ladderUnits(
  ladder: ActivatedLadderDto | null | undefined,
  key: string
): number | null {
  if (!ladder) return null;
  const step = ladder.steps.find((s) => s.key === key);
  return step ? step.units : null;
}

/**
 * ★사장님 퍼널 조립.
 *
 * 목표치와 나란히 놓되, 측정할 수 없는 칸은 `unmeasured` 로 남기고 목표 달성
 * 여부를 **판정하지 않는다**(null). 판정하려면 숫자가 있어야 하고, 없는 숫자를
 * 0 으로 채워 판정하면 그건 측정이 아니라 창작이다.
 */
export function buildAdAcquisitionFunnel(input: AdFunnelInput): AdFunnelResult {
  const { ladder, web, spendKrw, rangeDays } = input;

  const visitors = web ? web.visitors : null;
  const downloads = web ? web.downloads : null;
  const install = ladderUnits(ladder, "install");
  const login = ladderUnits(ladder, "login_success");
  const project = ladderUnits(ladder, "project_connected");
  const agent = ladderUnits(ladder, "agent_spawned");
  const tasksMin = ladderUnits(ladder, "task_completed_min");
  const activated = ladderUnits(ladder, "activated");
  const minTasks = ladder?.definition.minTasksCompleted ?? null;

  const rows: AdFunnelRow[] = [];

  // ── ① 광고 플랫폼 — 우리 데이터가 아니다 ─────────────────────────────────
  rows.push(
    unmeasuredRow({
      key: "ad_impression",
      stage: "광고 노출 (Instagram · YouTube · X)",
      basis: "ad_platform",
      unitLabel: "노출",
      conversionFromKey: null,
      target: null,
      unmeasured: AD_PLATFORM_UNMEASURED,
    })
  );
  rows.push(
    unmeasuredRow({
      key: "ad_click",
      stage: "광고 클릭 → 「AI 빌더 되기」 콘텐츠",
      basis: "ad_platform",
      unitLabel: "클릭",
      conversionFromKey: "ad_impression",
      target: AD_FUNNEL_TARGETS.adCtr,
      unmeasured: AD_PLATFORM_UNMEASURED,
    })
  );

  // ── ② GA4 웹 ─────────────────────────────────────────────────────────────
  if (visitors == null) {
    rows.push(
      unmeasuredRow({
        key: "landing_visit",
        stage: "랜딩 방문 (AI Builder Guide · marblo.app)",
        basis: "ga4_web",
        unitLabel: "방문",
        conversionFromKey: "ad_click",
        target: null,
        unmeasured: WEB_UNMEASURED,
        crossSource: true,
      })
    );
  } else {
    rows.push({
      key: "landing_visit",
      stage: "랜딩 방문 (AI Builder Guide · marblo.app)",
      basis: "ga4_web",
      reached: visitors,
      unitLabel: "방문",
      conversionFromKey: "ad_click",
      // 광고 클릭이 미계측이라 이 칸의 전환율(클릭→랜딩)도 낼 수 없다.
      conversion: null,
      target: null,
      targetMet: null,
      unmeasured: null,
      crossSource: true,
      warning:
        "봇 의심 코호트를 뺀 방문입니다. 광고 클릭이 미계측이라 " +
        "'클릭 → 랜딩' 전환율은 계산하지 않습니다.",
    });
  }

  if (visitors == null || downloads == null) {
    rows.push(
      unmeasuredRow({
        key: "beta_signup",
        stage: "Marblo Beta (다운로드)",
        basis: "ga4_web",
        unitLabel: "다운로드",
        conversionFromKey: "landing_visit",
        target: AD_FUNNEL_TARGETS.landingToBeta,
        unmeasured: WEB_UNMEASURED,
      })
    );
  } else {
    const conv = conversion(downloads, visitors);
    rows.push({
      key: "beta_signup",
      stage: "Marblo Beta (다운로드)",
      basis: "ga4_web",
      reached: downloads,
      unitLabel: "다운로드",
      conversionFromKey: "landing_visit",
      conversion: conv,
      target: AD_FUNNEL_TARGETS.landingToBeta,
      targetMet: meetsTarget(conv.rate, AD_FUNNEL_TARGETS.landingToBeta),
      unmeasured: null,
      crossSource: false,
      warning:
        "사장님 퍼널의 'Beta 신청' 자리를 **다운로드**로 읽습니다 — " +
        "지금 Beta 진입은 다운로드가 관문입니다.",
    });
  }

  // ── ③ 앱 텔레메트리 ───────────────────────────────────────────────────────
  const appRows: {
    key: string;
    stage: string;
    reached: number | null;
    fromKey: string;
    fromValue: number | null;
    target: AdFunnelTarget | null;
    crossSource: boolean;
    warning: string | null;
  }[] = [
    {
      key: "install",
      stage: "설치 (Beginner Mode 자동 CLI 설치)",
      reached: install,
      fromKey: "beta_signup",
      fromValue: downloads,
      target: AD_FUNNEL_TARGETS.betaToInstall,
      crossSource: true,
      warning:
        "★소스 경계입니다 — 분모는 GA4 다운로드, 분자는 앱 텔레메트리 설치라 " +
        "같은 모집단이라는 보장이 없습니다. 전환율은 추정으로 읽습니다.",
    },
    {
      key: "login_success",
      stage: "Login (Beginner Mode)",
      reached: login,
      fromKey: "install",
      fromValue: install,
      target: null,
      crossSource: false,
      warning: null,
    },
    {
      key: "project_connected",
      stage: "첫 Project (폴더 연결)",
      reached: project,
      fromKey: "install",
      fromValue: install,
      // ★사장님 표의 '설치 → 첫 Project 60%+' 는 설치 대비다(로그인 대비가 아니다).
      target: AD_FUNNEL_TARGETS.installToProject,
      crossSource: false,
      warning: null,
    },
    {
      key: "agent_task",
      stage: "첫 Agent Task (스폰)",
      reached: agent,
      fromKey: "project_connected",
      fromValue: project,
      target: null,
      crossSource: false,
      warning: null,
    },
    {
      key: "tasks_min",
      stage:
        minTasks == null ? "3 Tasks 완료" : `${minTasks} Tasks 완료`,
      reached: tasksMin,
      fromKey: "project_connected",
      fromValue: project,
      // ★사장님 표의 'Project → 3 Tasks 50%+' 는 Project 대비다.
      target: AD_FUNNEL_TARGETS.projectToTasks,
      crossSource: false,
      warning: null,
    },
    {
      key: "activated",
      stage: "ACTIVATED",
      reached: activated,
      fromKey: "beta_signup",
      fromValue: downloads,
      // ★사장님 표의 'Signup → Activated 30~40%+'. 분모는 직전 칸이 아니라 Beta 다.
      target: AD_FUNNEL_TARGETS.signupToActivated,
      crossSource: true,
      warning:
        "★분모가 직전 칸이 아니라 **Beta(다운로드)** 입니다 — 사장님 표의 " +
        "'Signup → Activated' 정의를 그대로 씁니다. 소스가 달라 추정입니다.",
    },
  ];

  for (const r of appRows) {
    if (r.reached == null) {
      rows.push(
        unmeasuredRow({
          key: r.key,
          stage: r.stage,
          basis: "app_telemetry",
          unitLabel: "설치",
          conversionFromKey: r.fromKey,
          target: r.target,
          unmeasured: LADDER_UNMEASURED,
          crossSource: r.crossSource,
        })
      );
      continue;
    }
    const conv = r.fromValue == null ? null : conversion(r.reached, r.fromValue);
    rows.push({
      key: r.key,
      stage: r.stage,
      basis: "app_telemetry",
      reached: r.reached,
      unitLabel: "설치",
      conversionFromKey: r.fromKey,
      conversion: conv,
      target: r.target,
      targetMet: meetsTarget(conv?.rate ?? null, r.target),
      unmeasured: null,
      crossSource: r.crossSource,
      warning: r.warning,
    });
  }

  // ── Activated CPA ────────────────────────────────────────────────────────
  const cpa = buildActivatedCpa({ spendKrw, activated, rangeDays });

  const notes: string[] = [
    "★광고 최적화 KPI 는 Beta Signup 이 아니라 **ACTIVATED** 입니다 — " +
      "이 퍼널의 종점이 광고 평가 기준입니다.",
  ];
  if (ladder) {
    notes.push(ladder.definition.axisNote);
    notes.push(ladder.definition.derivationNote);
    notes.push(...ladder.notes);
  } else {
    notes.push(
      "★ACTIVATED 사다리를 읽지 못했습니다(함수 미배포). 아래 앱 구간은 " +
        "0 이 아니라 '미계측' 입니다."
    );
  }
  notes.push(
    "★소스가 셋입니다 — 광고 플랫폼(미계측) · GA4 웹 · 앱 텔레메트리. " +
      "소스 경계를 넘는 전환율은 같은 모집단이 아니므로 추정입니다."
  );

  return {
    rows,
    cpa,
    definition: ladder ? ladder.definition : null,
    profile: ladder?.profile ?? null,
    notes,
  };
}

/**
 * ★Activated CPA = 광고비 ÷ ACTIVATED.
 *
 * 비용 입력 경로는 **있다**(어드민 ②광고 탭의 광고비 수동 입력 원장). 하지만
 * 아직 한 푼도 입력되지 않았다면 CPA 는 0원이 아니라 **"비용 미입력"** 이다 —
 * 0원 CPA 는 "공짜로 활성화시켰다" 로 읽힌다(acquisitionCac 과 같은 규율).
 */
export function buildActivatedCpa(input: {
  spendKrw: number | null;
  activated: number | null;
  rangeDays: number;
}): ActivatedCpa {
  const { spendKrw, activated, rangeDays } = input;
  if (spendKrw == null) {
    return {
      kind: "unavailable",
      reason: "광고비 원장을 읽지 못했습니다 — 0원으로 그리지 않습니다.",
      whatWouldFixIt:
        "getAdminCacSummary 응답과 analytics_ad_spend 적재 상태를 확인합니다.",
    };
  }
  if (!(spendKrw > 0)) {
    return {
      kind: "unavailable",
      reason: "비용 미입력 — 아직 입력된 광고비가 없습니다(0원이 아닙니다).",
      whatWouldFixIt:
        "이 탭의 '광고비 수동 입력' 에 캠페인별 지출을 넣으면 CPA 가 계산됩니다.",
    };
  }
  if (activated == null) {
    return {
      kind: "unavailable",
      reason: "ACTIVATED 를 읽지 못해 분모가 없습니다.",
      whatWouldFixIt: "v3/functions 배포 후 다시 조회합니다.",
    };
  }
  if (!(activated > 0)) {
    return {
      kind: "unavailable",
      reason:
        "ACTIVATED 0 — 분모가 없어 CPA 를 산출할 수 없습니다(∞ 로 그리지 않습니다).",
      whatWouldFixIt:
        "조회 기간을 넓히거나, 활성화 정의를 채운 설치가 생길 때까지 기다립니다.",
    };
  }
  const cpaKrw = spendKrw / activated;
  return {
    kind: "ok",
    spendKrw,
    activatedUnits: activated,
    cpaKrw,
    targetMaxKrw: ACTIVATED_CPA_TARGET_MAX_KRW,
    targetLabel: ACTIVATED_CPA_TARGET_LABEL,
    targetMet: cpaKrw <= ACTIVATED_CPA_TARGET_MAX_KRW,
    // ★기간 축이 다르다. getAdminCacSummary 는 원장 **전기간** 합계를 주고
    //   ACTIVATED 는 조회창 N일이다. 숨기면 CPA 가 과대평가된다.
    periodMismatchNote:
      `★기간 축이 다릅니다 — 광고비는 원장 **전기간** 합계이고 ACTIVATED 는 ` +
      `최근 ${rangeDays}일입니다. 광고를 오래 돌렸다면 CPA 가 과대평가됩니다.`,
  };
}
