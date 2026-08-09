// 어드민 분석 — 순수 로직(BQ/Firestore 무의존). node --test 로 단위검증한다
// (marketingContacts.ts / redact.ts 와 동일 규약). index.ts 의 onCall 핸들러는
// BQ 쿼리만 담당하고, 파싱·집계·퍼널 계산은 전부 여기로 내려 테스트 가능하게 한다.
//
// 두 축:
//   1) includeAdmin 토글 — 운영자(존킴) 제외를 하드코딩에서 파라미터로. 기본 false
//      (제외). 값이 정확히 true 일 때만 포함한다(구버전 web 이 param 을 안 보내면
//      undefined → false → 기존 동작 유지 = 하위호환).
//   2) 온보딩 활성화 퍼널 — app:first_run → login → folder_connected →
//      orchestrator_opened → agent:spawned → first ticket completed 의 순차
//      도달·이탈 + 실패분기 분해.

// ── includeAdmin 파싱 ────────────────────────────────────────────────────────
// 기본 false(제외 유지). 오직 boolean true 만 "포함". 문자열 "true" 등은 받지
// 않는다 — 콜러블은 JSON 을 그대로 넘기므로 클라이언트가 boolean 을 보낸다.
export function parseIncludeAdmin(data: unknown): boolean {
  const raw = (data as { includeAdmin?: unknown } | null | undefined)
    ?.includeAdmin;
  return raw === true;
}

// 빈 제외절(포함 모드거나 제외 대상이 없을 때). adminClientExclusion/
// adminUidExclusion 과 같은 shape 를 돌려줘 호출부가 분기 없이 쓸 수 있게 한다.
export const EMPTY_EXCLUSION: {
  clause: string;
  params: Record<string, unknown>;
} = { clause: "", params: {} };

// 안전한 숫자 변환(BQ 는 int64 를 string 으로 돌려줄 수 있다). index.ts 의
// toNumber 와 독립 구현 — 이 모듈이 index.ts 에 의존하지 않게 한다.
export function coerceNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ── metricMode(이벤트 수 vs 고유 사용자 수) ───────────────────────────────────
// 상위이벤트·스폰(역할/모델)별 분포를 두 렌즈로 읽는다:
//   'events'  = COUNT(*)             — 발생 총량(기본, 하위호환).
//   'clients' = COUNT(DISTINCT col)  — 고유 clientId 수(몇 명이 했나).
// 구버전 web 이 param 을 안 보내면 undefined → 'events' → 기존 동작 유지.
export type MetricMode = "events" | "clients";

export function parseMetricMode(data: unknown): MetricMode {
  const raw = (data as { metricMode?: unknown } | null | undefined)?.metricMode;
  return raw === "clients" ? "clients" : "events";
}

// BQ 집계 count 식을 metricMode 로 고른다. clients 모드의 distinctCol 은 SQL 에
// 그대로 삽입되므로 식별자 화이트리스트(주입 방지)를 강제한다. 기본 userId
// (events 테이블의 익명 clientId 컬럼 — 개인식별 아님, DISTINCT 카운트만).
export function metricCountExpr(
  mode: MetricMode,
  distinctCol = "userId",
): string {
  if (mode === "clients") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(distinctCol)) {
      throw new Error(
        `metricCountExpr: unsafe distinct column: ${distinctCol}`,
      );
    }
    return `COUNT(DISTINCT ${distinctCol})`;
  }
  return "COUNT(*)";
}

// ── 온보딩 활성화 퍼널 ───────────────────────────────────────────────────────
//
// 측정 방식(정직성): BigQuery 쿼리가 각 identity(신규 accountUserId, 과거 row 는
// clientId 폴백)별 최초 이벤트 시각을 조인해 "앞 단계에 도달한 사람 중 다음 단계도
// 24h/7d 창 안에 도달한 사람"만 넘긴다. 그래서 steps 는 항상 단조 감소해야 하며,
// task_completed 는 헤드라인 activatedClients 와 같은 스칼라를 읽는다.

export type OnboardingStepKey =
  | "first_run"
  | "login_attempt"
  | "login_success"
  | "folder_connected"
  | "orchestrator_opened"
  | "agent_spawned"
  // ── 스폰 이후 활성화 단계(reach 본선 밖, "핵심경험/잔존") ──
  | "task_completed" // 첫 오케 티켓을 에이전트가 완료(활성화 순간)
  | "core_experience" // 에이전트를 2회+ 스폰(반복 사용 = 핵심경험 도달)
  | "retained_7d"; // 7일 내 2번째 세션/프로젝트(초기 잔존)

// 단계 종류: reach=온보딩 본선(단순 이벤트 도달), activation=스폰 이후 활성화·
// 잔존(HAVING/시간창 같은 복합 집계라 index.ts 가 별도 subquery 로 d_<key> 를
// 채워 넣는다 — 순수 빌더는 채워진 count 만 읽어 kind 만 태깅한다).
export type OnboardingStepKind = "reach" | "activation";

// 퍼널 순서 + 라벨 + 소스 이벤트명 + 종류(단일 소스 오브 트루스).
export const ONBOARDING_FUNNEL_STEPS: ReadonlyArray<{
  key: OnboardingStepKey;
  event: string;
  label: string;
  kind: OnboardingStepKind;
}> = [
  {
    key: "first_run",
    event: "app:first_run",
    label: "앱 최초 실행",
    kind: "reach",
  },
  {
    key: "login_attempt",
    event: "auth:login_attempt",
    label: "로그인 시도",
    kind: "reach",
  },
  {
    key: "login_success",
    event: "auth:login_success",
    label: "로그인 성공",
    kind: "reach",
  },
  {
    key: "folder_connected",
    event: "onboarding:folder_connected",
    label: "폴더 연결",
    kind: "reach",
  },
  {
    key: "orchestrator_opened",
    event: "onboarding:orchestrator_opened",
    label: "오케 오픈(첫 스폰 시도)",
    kind: "reach",
  },
  {
    key: "agent_spawned",
    event: "agent:spawned",
    label: "에이전트 스폰",
    kind: "reach",
  },
  // ── 스폰 이후 활성화 단계 ──
  // task_completed 는 본선과 동일한 단일 스캔에서 d_task_completed 로 뽑히지만,
  // core_experience(스폰≥2)·retained_7d(7일내 2세션/2프로젝트)는 per-client
  // HAVING/시간창이라 index.ts 가 별도 subquery 스칼라를 row 에 주입한다.
  // ★활성화 단계는 reach 의 엄격 부분집합이 아니다(단일 스폰으로 티켓을 끝낸
  // 유저는 task_completed 엔 있어도 core_experience 엔 없다) — 인접 drop 은
  // 참고치일 뿐, 각 단계 reach 절대값을 우선으로 읽는다(note 참조).
  {
    key: "task_completed",
    event: "task:completed",
    label: "첫 티켓 완료(활성화)",
    kind: "activation",
  },
  {
    key: "core_experience",
    event: "agent:spawned",
    label: "핵심경험(스폰 2회+)",
    kind: "activation",
  },
  {
    key: "retained_7d",
    event: "session:started",
    label: "7일 잔존(2번째 세션/프로젝트)",
    kind: "activation",
  },
];

// 실패-분기 이벤트(퍼널 본선 밖의 이탈 사유). errorCategory 로 세분한다.
// col = BQ 집계행 컬럼 접두(snake) — 결과 key(camel)와 분리해 SQL 가독성 유지.
export const ONBOARDING_FAILURE_EVENTS: ReadonlyArray<{
  key: string;
  col: string;
  event: string;
  label: string;
}> = [
  {
    key: "loginFailed",
    col: "login_failed",
    event: "auth:login_failed",
    label: "로그인 실패",
  },
  {
    key: "folderConnectFailed",
    col: "folder_connect_failed",
    event: "onboarding:folder_connect_failed",
    label: "폴더 연결 실패",
  },
  {
    key: "orchestratorBlocked",
    col: "orchestrator_blocked",
    event: "onboarding:orchestrator_blocked",
    label: "오케 오픈 차단",
  },
  {
    key: "agentCrashed",
    col: "agent_crashed",
    event: "agent:crashed",
    label: "에이전트 크래시",
  },
];

// buildOnboardingFunnel 입력 — BQ 집계 1행에서 뽑은 단계별 (distinct, count).
export type FunnelCountsRow = Record<string, unknown>;

// errorCategory 분해 rows — { event, category, n, clients }.
export type ReasonRow = {
  event: unknown;
  category: unknown;
  n: unknown;
  clients: unknown;
};

export type FunnelStep = {
  key: OnboardingStepKey;
  event: string;
  label: string;
  kind: OnboardingStepKind; // reach(본선) | activation(스폰 이후)
  clients: number; // 도달 고유 clientId
  events: number; // 이벤트 발생 총량
  dropFromPrev: number | null; // 직전 단계 대비 이탈 client 수(≥0, clamp). 첫 단계=null
  dropRateFromPrev: number | null; // dropFromPrev / prev.clients. 첫 단계=null
  isMaxDrop: boolean; // 최대 이탈 구간 표시(★22→6 같은 지점)
};

export type FailureBranch = {
  key: string;
  event: string;
  label: string;
  clients: number;
  events: number;
  byCategory: Array<{ key: string; count: number; clients: number }>;
};

// ★헤드라인 활성화 지표 — "가입 후 N시간 내 오케 티켓을 에이전트가 1개+ 완료한
// 사용자 비율". 분자=시간창 내 활성화한 고유 사용자(identity), 분모=가입(로그인 성공)
// 고유 사용자. 시간창 조인은 index.ts 가 BQ 로 계산해 d_activated_30m /
// d_signup_base 스칼라로 넘긴다. 컬럼명은 하위호환 때문에 30m 를 유지하지만, 창은
// 기본 24h(1440분)이다.
export type ActivationHeadline = {
  activatedClients: number; // 분자: 시간창 내 첫 티켓 완료
  baseClients: number; // 분모: 가입(로그인 성공) 고유 client
  rate: number | null; // activated / base (base=0 이면 null)
  windowMinutes: number; // 시간창(분). 기본 1440(24h)
  label: string;
};

export type OnboardingFunnelResult = {
  steps: FunnelStep[];
  failureBranches: FailureBranch[];
  headline: ActivationHeadline;
  note: string;
};

// 헤드라인 계산(순수). row 의 d_activated_30m / d_signup_base 를 읽어 비율을 낸다.
export function buildActivationHeadline(
  row: FunnelCountsRow | undefined | null,
  windowMinutes = 24 * 60,
): ActivationHeadline {
  const safeRow = row ?? {};
  const activatedClients = coerceNumber(safeRow["d_activated_30m"]);
  const baseClients = coerceNumber(safeRow["d_signup_base"]);
  return {
    activatedClients,
    baseClients,
    rate: baseClients > 0 ? activatedClients / baseClients : null,
    windowMinutes,
    label:
      windowMinutes % 60 === 0
        ? `가입 후 ${windowMinutes / 60}시간 내 오케 티켓을 에이전트가 1개+ 완료한 사용자 비율`
        : `가입 후 ${windowMinutes}분 내 오케 티켓을 에이전트가 1개+ 완료한 사용자 비율`,
  };
}

// distinct/count 컬럼명 규약: d_<key> / n_<key>.
function stepClients(row: FunnelCountsRow, key: OnboardingStepKey): number {
  return coerceNumber(row[`d_${key}`]);
}
function stepEvents(row: FunnelCountsRow, key: OnboardingStepKey): number {
  return coerceNumber(row[`n_${key}`]);
}

// 실패 이벤트 컬럼명 규약: d_<col> / n_<col> (col = snake 접두).
function failureClients(row: FunnelCountsRow, col: string): number {
  return coerceNumber(row[`d_${col}`]);
}
function failureEvents(row: FunnelCountsRow, col: string): number {
  return coerceNumber(row[`n_${col}`]);
}

export function buildOnboardingFunnel(
  row: FunnelCountsRow | undefined | null,
  reasonRows: ReasonRow[] = [],
): OnboardingFunnelResult {
  const safeRow = row ?? {};

  // 1) 단계 reach(본선 + 스폰이후 활성화).
  const base = ONBOARDING_FUNNEL_STEPS.map((s) => ({
    key: s.key,
    event: s.event,
    label: s.label,
    kind: s.kind,
    clients: stepClients(safeRow, s.key),
    events: stepEvents(safeRow, s.key),
  }));

  // 2) 인접 단계 이탈(음수는 0 으로 clamp — 비단조 정상, §비단조 주석).
  // ★isMaxDrop(최대 이탈 구간)은 reach 본선 안에서만 후보로 삼는다 — activation
  // 단계는 reach 의 엄격 부분집합이 아니라(단일 스폰으로 완료한 유저 등) 그 감소가
  // 진짜 온보딩 누수가 아니다. drop 값 자체는 참고용으로 모든 단계에 계산한다.
  let maxDrop = 0;
  let maxDropIdx = -1;
  const steps: FunnelStep[] = base.map((s, i) => {
    if (i === 0) {
      return {
        ...s,
        dropFromPrev: null,
        dropRateFromPrev: null,
        isMaxDrop: false,
      };
    }
    const prev = base[i - 1];
    const drop = Math.max(0, prev.clients - s.clients);
    const rate = prev.clients > 0 ? drop / prev.clients : null;
    if (drop > maxDrop && s.kind === "reach") {
      maxDrop = drop;
      maxDropIdx = i;
    }
    return {
      ...s,
      dropFromPrev: drop,
      dropRateFromPrev: rate,
      isMaxDrop: false,
    };
  });
  // 최대 이탈 구간 1곳만 표시(drop>0 일 때만).
  if (maxDropIdx >= 0 && maxDrop > 0) {
    steps[maxDropIdx].isMaxDrop = true;
  }

  // 3) 실패 분기 + errorCategory 분해.
  const reasonByEvent = new Map<
    string,
    Array<{ key: string; count: number; clients: number }>
  >();
  for (const r of reasonRows) {
    const ev = typeof r.event === "string" ? r.event : "";
    if (!ev) continue;
    const cat =
      r.category == null || r.category === "" ? "(none)" : String(r.category);
    const list = reasonByEvent.get(ev) ?? [];
    list.push({
      key: cat,
      count: coerceNumber(r.n),
      clients: coerceNumber(r.clients),
    });
    reasonByEvent.set(ev, list);
  }

  const failureBranches: FailureBranch[] = ONBOARDING_FAILURE_EVENTS.map(
    (f) => ({
      key: f.key,
      event: f.event,
      label: f.label,
      clients: failureClients(safeRow, f.col),
      events: failureEvents(safeRow, f.col),
      byCategory: (reasonByEvent.get(f.event) ?? []).sort(
        (a, b) => b.count - a.count,
      ),
    }),
  );

  return {
    steps,
    failureBranches,
    headline: buildActivationHeadline(safeRow),
    note:
      "순차 퍼널 기준: 각 단계는 앞 단계 도달자의 부분집합이다. 신규 row 는 " +
      "accountUserId 기준으로 dedup 하고, 과거 row 는 BigQuery events.userId 에 남은 " +
      "익명 clientId 로 폴백한다. 로그인-이전 이벤트는 다음 로그인 성공 때 함께 flush " +
      "되어, 끝내 로그인 못 한 유저의 실패는 과소계상될 수 있다. 헤드라인 활성화율은 " +
      "가입(로그인 성공)한 유저 중 24시간 내 첫 티켓 완료 비율이며, 첫 티켓 완료 단계와 " +
      "같은 분자를 사용한다. 운영자 도그푸딩은 includeAdmin=false 기본값에서 제외된다.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// KPI 코크핏 — 지표기반 베타종료 게이지 · 신규 온보딩 이벤트 · 재사용/리텐션 ·
// 스폰 헬스 (mDzHRyX4 확장, ticket wXOhvdp1)
// ════════════════════════════════════════════════════════════════════════════
// index.ts 의 getAdminKpiCockpit 콜러블이 BQ 로 아래 스칼라/분포를 뽑아 넘기면,
// 여기 순수 빌더가 게이지·비율로 조립한다(BQ/Firestore 무의존 → node --test 로
// 단위검증). ★신규 온보딩 이벤트(cli_setup_step·survey·demo·marketing_consent)는
// 3.0.19 렌더러 빌드+실사용 전엔 값 0 — 구조만 먼저 세우고 데이터는 후행한다.
// 비율 분모가 0 이면 current=null 로 두어 "데이터 대기"를 게이지가 표시한다
// (0% 로 오도하지 않는다).

// ── 안전 비율 헬퍼(분모 0 → null) ────────────────────────────────────────────
export function safeRate(
  numerator: unknown,
  denominator: unknown,
): number | null {
  const n = coerceNumber(numerator);
  const d = coerceNumber(denominator);
  return d > 0 ? n / d : null;
}

// ── 별점(1~5) → NPS 환산 ─────────────────────────────────────────────────────
// survey_first_project 의 metadata.rating(1~5 별점) 분포를 NPS(-100~100)로 접는다.
// 5점 척도의 표준 매핑: 5=추천(promoter), 4=중립(passive), 1~3=비추(detractor).
// NPS = (추천% − 비추%) × 100. 응답 0 이면 nps=null(0 으로 오도 금지).
// ratings 는 { rating, count } 배열 — 범위 밖(0·6·NaN) 별점은 무시한다.
export type NpsResult = {
  total: number; // 유효 응답 수
  promoters: number; // 5점
  passives: number; // 4점
  detractors: number; // 1~3점
  nps: number | null; // (추천−비추)/total × 100, 반올림. 응답 0 이면 null
  avgRating: number | null; // 평균 별점(1~5). 응답 0 이면 null
  byStar: Record<string, number>; // "1".."5" → count(0 포함, 항상 5키)
};

export function computeNpsFromStars(
  ratings: ReadonlyArray<{ rating: unknown; count: unknown }>,
): NpsResult {
  const byStar: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  let total = 0;
  let weightedSum = 0;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const r of ratings) {
    const star = Math.round(coerceNumber(r.rating));
    if (star < 1 || star > 5) continue; // 범위 밖 무시(스키마 드리프트 방어)
    const c = coerceNumber(r.count);
    if (c <= 0) continue;
    byStar[String(star)] += c;
    total += c;
    weightedSum += star * c;
    if (star === 5) promoters += c;
    else if (star === 4) passives += c;
    else detractors += c;
  }
  return {
    total,
    promoters,
    passives,
    detractors,
    nps:
      total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null,
    avgRating: total > 0 ? weightedSum / total : null,
    byStar,
  };
}

// ── 베타종료 게이지 6종(현재값 vs 목표) ──────────────────────────────────────
// 활성화 전략 메모(activation_first_and_metrics_based_beta_exit_2026_07)의 지표기반
// 종료 기준을 게이지로 만든다. 목표치는 메모 준수:
//   CLI인증 80% · 첫프로젝트 60% · 첫티켓 50% · 7일잔존 30% · NPS 40+ · 활성화율.
// ★24시간내 첫완료율은 헤드라인(가입 24h내 첫티켓완료 = 핵심 KPI)이며, 메모에
// 숫자 목표가 명시돼 있지 않아 잠정 기본값 0.30 을 둔다(CEO 확정 시 이 상수만 조정).
export type BetaExitGaugeKey =
  | "cli_auth_success"
  | "first_project_run"
  | "first_ticket_completed"
  | "retention_7d"
  | "satisfaction_nps"
  | "activation_30m";

// unit: 'rate'=0~1 비율(퍼센트 표시), 'nps'=-100~100 점수.
export type GaugeUnit = "rate" | "nps";

export const BETA_EXIT_TARGETS: Readonly<Record<BetaExitGaugeKey, number>> = {
  cli_auth_success: 0.8,
  first_project_run: 0.6,
  first_ticket_completed: 0.5,
  retention_7d: 0.3,
  satisfaction_nps: 40,
  activation_30m: 0.3, // ★잠정(메모에 숫자 없음, headline 재사용) — CEO 확정 전 default
};

export type BetaExitGauge = {
  key: BetaExitGaugeKey;
  label: string;
  unit: GaugeUnit;
  current: number | null; // rate(0~1) 또는 nps(-100~100). 분모/응답 0 이면 null
  target: number;
  met: boolean; // current != null && current >= target
  numerator: number; // 표시용(분자). nps 게이지는 유효응답수를 담는다
  denominator: number; // 표시용(분모). nps 게이지는 유효응답수를 담는다
};

// 게이지 메타(라벨·단위·분자/분모 컬럼 규약). 분자/분모는 d_<col> 스칼라 키.
const BETA_EXIT_GAUGE_META: ReadonlyArray<{
  key: BetaExitGaugeKey;
  label: string;
  unit: GaugeUnit;
  numCol: string;
  denCol: string;
}> = [
  {
    key: "cli_auth_success",
    label: "CLI 인증 성공률",
    unit: "rate",
    numCol: "d_cli_connect_success",
    denCol: "d_cli_connect_enter",
  },
  {
    key: "first_project_run",
    label: "첫 프로젝트 실행률",
    unit: "rate",
    numCol: "d_cli_project_success",
    denCol: "d_signup_base",
  },
  {
    key: "first_ticket_completed",
    label: "첫 티켓 완료율",
    unit: "rate",
    numCol: "d_task_completed",
    denCol: "d_signup_base",
  },
  {
    key: "retention_7d",
    label: "7일 잔존율",
    unit: "rate",
    numCol: "d_retained_7d",
    denCol: "d_signup_base",
  },
  // satisfaction_nps 는 별점 분포에서 별도 계산 — 아래 buildBetaExitGauges 에서 주입.
  {
    key: "activation_30m",
    label: "가입 24시간내 첫완료율",
    unit: "rate",
    numCol: "d_activated_30m",
    denCol: "d_signup_base",
  },
];

// 게이지 6종 조립. row = d_<col> 스칼라 묶음, nps = computeNpsFromStars 결과.
export function buildBetaExitGauges(
  row: FunnelCountsRow | undefined | null,
  nps: NpsResult,
): BetaExitGauge[] {
  const safeRow = row ?? {};
  const rateGauges: BetaExitGauge[] = BETA_EXIT_GAUGE_META.map((g) => {
    const numerator = coerceNumber(safeRow[g.numCol]);
    const denominator = coerceNumber(safeRow[g.denCol]);
    const current = denominator > 0 ? numerator / denominator : null;
    const target = BETA_EXIT_TARGETS[g.key];
    return {
      key: g.key,
      label: g.label,
      unit: g.unit,
      current,
      target,
      met: current != null && current >= target,
      numerator,
      denominator,
    };
  });
  // NPS 게이지(별점 분포 기반). 응답 0 이면 current=null.
  const npsGauge: BetaExitGauge = {
    key: "satisfaction_nps",
    label: "만족도(NPS)",
    unit: "nps",
    current: nps.nps,
    target: BETA_EXIT_TARGETS.satisfaction_nps,
    met: nps.nps != null && nps.nps >= BETA_EXIT_TARGETS.satisfaction_nps,
    numerator: nps.total,
    denominator: nps.total,
  };
  // 표시 순서: 퍼널 흐름(인증→프로젝트→티켓→잔존)→만족도→헤드라인.
  return [
    rateGauges[0], // cli_auth_success
    rateGauges[1], // first_project_run
    rateGauges[2], // first_ticket_completed
    rateGauges[3], // retention_7d
    npsGauge, // satisfaction_nps
    rateGauges[4], // activation_30m
  ];
}

// ── 신규 온보딩 이벤트 집계(설문·데모·동의·CLI셋업) ──────────────────────────
// 3.0.19 전엔 전부 0. 각 이벤트의 원시 분포를 받아 비율·히스토그램으로 접는다.

// cli_setup_step: metadata.step(notice/connect/project) × phase(enter/success/fail).
// BQ 는 step·phase 별 (clients,events) 행을 준다 — 여기서 step 별로 묶는다.
export type CliSetupStepRow = {
  step: unknown;
  phase: unknown;
  clients: unknown;
  events: unknown;
};
export type CliSetupPhaseCounts = {
  enter: number;
  success: number;
  fail: number;
};
export type CliSetupStepSummary = {
  step: string; // notice | connect | project
  label: string;
  clients: CliSetupPhaseCounts; // 도달 고유 clientId
  events: CliSetupPhaseCounts; // 이벤트 발생량
  successRate: number | null; // success / enter (clients 기준). enter 0 → null
};

const CLI_SETUP_STEP_ORDER: ReadonlyArray<{ step: string; label: string }> = [
  { step: "notice", label: "고지" },
  { step: "connect", label: "CLI 연결·인증" },
  { step: "project", label: "폴더연결·오케실행" },
];

export function buildCliSetupSummary(
  rows: ReadonlyArray<CliSetupStepRow>,
): CliSetupStepSummary[] {
  // step → phase → {clients, events}
  const acc = new Map<
    string,
    { clients: CliSetupPhaseCounts; events: CliSetupPhaseCounts }
  >();
  const blank = (): {
    clients: CliSetupPhaseCounts;
    events: CliSetupPhaseCounts;
  } => ({
    clients: { enter: 0, success: 0, fail: 0 },
    events: { enter: 0, success: 0, fail: 0 },
  });
  for (const r of rows) {
    const step = typeof r.step === "string" ? r.step : "";
    const phase = typeof r.phase === "string" ? r.phase : "";
    if (
      (phase !== "enter" && phase !== "success" && phase !== "fail") ||
      !step
    ) {
      continue;
    }
    const entry = acc.get(step) ?? blank();
    entry.clients[phase] += coerceNumber(r.clients);
    entry.events[phase] += coerceNumber(r.events);
    acc.set(step, entry);
  }
  return CLI_SETUP_STEP_ORDER.map(({ step, label }) => {
    const entry = acc.get(step) ?? blank();
    return {
      step,
      label,
      clients: entry.clients,
      events: entry.events,
      successRate:
        entry.clients.enter > 0
          ? entry.clients.success / entry.clients.enter
          : null,
    };
  });
}

// 데모 퍼널(started → completed → cta_click). 완주율·CTA전환율.
export type DemoFunnelInput = {
  startedClients: unknown;
  completedClients: unknown;
  ctaClients: unknown;
  startedEvents: unknown;
  completedEvents: unknown;
  ctaEvents: unknown;
};
export type DemoFunnelSummary = {
  startedClients: number;
  completedClients: number;
  ctaClients: number;
  startedEvents: number;
  completedEvents: number;
  ctaEvents: number;
  completionRate: number | null; // completed / started(clients)
  ctaRate: number | null; // cta / started(clients)
};

export function buildDemoFunnel(input: DemoFunnelInput): DemoFunnelSummary {
  const startedClients = coerceNumber(input.startedClients);
  const completedClients = coerceNumber(input.completedClients);
  const ctaClients = coerceNumber(input.ctaClients);
  return {
    startedClients,
    completedClients,
    ctaClients,
    startedEvents: coerceNumber(input.startedEvents),
    completedEvents: coerceNumber(input.completedEvents),
    ctaEvents: coerceNumber(input.ctaEvents),
    completionRate:
      startedClients > 0 ? completedClients / startedClients : null,
    ctaRate: startedClients > 0 ? ctaClients / startedClients : null,
  };
}

// 마케팅 수신 동의(shown → granted). 동의율.
export type ConsentInput = {
  shownClients: unknown;
  grantedClients: unknown;
  shownEvents: unknown;
  grantedEvents: unknown;
};
export type ConsentSummary = {
  shownClients: number;
  grantedClients: number;
  shownEvents: number;
  grantedEvents: number;
  grantRate: number | null; // granted / shown(clients)
};

export function buildConsentSummary(input: ConsentInput): ConsentSummary {
  const shownClients = coerceNumber(input.shownClients);
  const grantedClients = coerceNumber(input.grantedClients);
  return {
    shownClients,
    grantedClients,
    shownEvents: coerceNumber(input.shownEvents),
    grantedEvents: coerceNumber(input.grantedEvents),
    grantRate: shownClients > 0 ? grantedClients / shownClients : null,
  };
}

// 설문(survey_first_project 별점 + survey_cli_fail 사유). NPS 는 위 별점에서.
export type OnboardingSurveySummary = {
  nps: NpsResult; // 별점 분포 + NPS
  cliFailReasons: Array<{ key: string; count: number }>; // 사유별 내림차순
};

// { key, count } 분포행을 내림차순 정렬한 배열로 접는다(빈 결과 안전).
export function foldKeyCounts(
  rows: ReadonlyArray<{ key: unknown; count: unknown }>,
): Array<{ key: string; count: number }> {
  return rows
    .map((r) => ({
      key: r.key == null || r.key === "" ? "(none)" : String(r.key),
      count: coerceNumber(r.count),
    }))
    .sort((a, b) => b.count - a.count);
}

// ── 재사용/리텐션 요약 ───────────────────────────────────────────────────────
// 주간 활성 프로젝트·주간 완료 티켓·2번째 세션 도달률·DAU/WAU 끈적임(stickiness).
export type ReuseInput = {
  weeklyActiveProjects: unknown; // 최근 7일 distinct projectId
  weeklyCompletedTasks: unknown; // 최근 7일 task:completed 건수
  secondSessionClients: unknown; // 세션/프로젝트 2회+ 도달 고유 clientId
  signupBase: unknown; // 분모(가입 = login_success 고유 clientId)
  avgDau: unknown; // 기간 평균 DAU
  wau: unknown; // 최근 7일 WAU
};
export type ReuseSummary = {
  weeklyActiveProjects: number;
  weeklyCompletedTasks: number;
  secondSessionClients: number;
  signupBase: number;
  secondSessionRate: number | null; // secondSession / signupBase
  avgDau: number;
  wau: number;
  stickiness: number | null; // avgDau / wau (0~1). wau 0 → null
};

export function buildReuseSummary(input: ReuseInput): ReuseSummary {
  const secondSessionClients = coerceNumber(input.secondSessionClients);
  const signupBase = coerceNumber(input.signupBase);
  const avgDau = coerceNumber(input.avgDau);
  const wau = coerceNumber(input.wau);
  return {
    weeklyActiveProjects: coerceNumber(input.weeklyActiveProjects),
    weeklyCompletedTasks: coerceNumber(input.weeklyCompletedTasks),
    secondSessionClients,
    signupBase,
    secondSessionRate:
      signupBase > 0 ? secondSessionClients / signupBase : null,
    avgDau,
    wau,
    stickiness: wau > 0 ? avgDau / wau : null,
  };
}

// ── 스폰 에이전트 헬스 ───────────────────────────────────────────────────────
// 성공률(완료 vs 크래시)·크래시율·평균 재시작. 동시작업 수는 append-only 이벤트
// 만으론 세션 상관 없이 정확히 못 구해 v1 미포함(스폰/크래시/재시작/완료만).
export type SpawnHealthInput = {
  spawned: unknown; // agent:spawned 건수
  crashed: unknown; // agent:crashed 건수
  restarted: unknown; // agent:restarted 건수
  completed: unknown; // task:completed 건수(성공 신호)
};
export type SpawnHealthSummary = {
  spawned: number;
  crashed: number;
  restarted: number;
  completed: number;
  // 성공률 = 완료 / (완료 + 크래시). 분모 0 → null. 재시작은 회복 신호라 분모 제외.
  successRate: number | null;
  crashRate: number | null; // crashed / spawned
  avgRestartPerSpawn: number | null; // restarted / spawned
};

export function buildSpawnHealth(input: SpawnHealthInput): SpawnHealthSummary {
  const spawned = coerceNumber(input.spawned);
  const crashed = coerceNumber(input.crashed);
  const restarted = coerceNumber(input.restarted);
  const completed = coerceNumber(input.completed);
  const outcomeBase = completed + crashed;
  return {
    spawned,
    crashed,
    restarted,
    completed,
    successRate: outcomeBase > 0 ? completed / outcomeBase : null,
    crashRate: spawned > 0 ? crashed / spawned : null,
    avgRestartPerSpawn: spawned > 0 ? restarted / spawned : null,
  };
}

// ── 온보딩 스톨(구독/크레딧/인증 공백) ───────────────────────────────────────
// 티켓 9dXgBdkGn1LyJokShh1g. 온램프 스파이크 #883/#885 의 공통 결론이 "무료→유료
// 투자 전에 **최초에 멈추는 유저 수**부터 세야 하는데 그 이벤트가 0건" 이었다.
// 이제 5개 이벤트가 들어오므로, 여기서 "몇 명이 · 어디서 · 왜" 로 접는다.
//
// ★두 가지가 이 요약의 정직성을 지킨다:
//  1) `needs_auth` 는 **철회**될 수 있다(readiness 도달 = 로그인화면 오탐). 그래서
//     agent 단위로 철회분을 뺀 `unresolvedAgents` 를 쓴다 — 오탐을 스톨로 세면
//     인증 팝업 오탐 saga 가 그대로 문제 크기로 둔갑한다.
//  2) 프로브 판정은 **정상(ok)도 분모로** 받는다. unfunded 건수만으로는 "인증까지
//     온 유저 중 몇 %가 못 도는가" 에 답할 수 없고, 그 비율이 온램프 투자 판단의
//     실제 입력값이다.
export type OnboardingStallInput = {
  /** 사전 스폰 게이트 차단(onboarding:spawn_blocked). */
  spawnBlockedClients: unknown;
  spawnBlockedEvents: unknown;
  /** 차단 사유 분포(errorCategory: not-installed / not-authenticated / vendor-not-configured). */
  spawnBlockedReasonRows: ReadonlyArray<{ key: unknown; count: unknown }>;
  /** 스폰 후 로그인화면 확정(onboarding:agent_needs_auth). */
  needsAuthClients: unknown;
  needsAuthAgents: unknown;
  /** 그중 철회된 agent 수(onboarding:agent_auth_resolved 로 짝지어진 것). */
  needsAuthResolvedAgents: unknown;
  /** funding 프로브 판정별 설치 수(onboarding:funding_probe). */
  fundingOkClients: unknown;
  fundingUnfundedClients: unknown;
  fundingBlockedClients: unknown;
  fundingInconclusiveClients: unknown;
  /** 가이드 모달 노출(onboarding:funding_guide_shown) = 눈으로 막힌 사람. */
  guideShownClients: unknown;
  guideShownEvents: unknown;
  /** ★어느 스톨 신호든 하나라도 맞은 **고유 설치 수**(SQL 에서 DISTINCT 합집합). */
  stalledClients: unknown;
  /** 같은 기간의 로그인 성공 설치 수 — 스톨 비율의 분모. */
  signupBase: unknown;
};

export type OnboardingStallSummary = {
  stalledClients: number;
  /** stalledClients / signupBase. 분모 0 → null("데이터 대기", 0% 로 오도 금지). */
  stalledRate: number | null;
  spawnBlocked: {
    clients: number;
    events: number;
    byReason: Array<{ key: string; count: number }>;
  };
  needsAuth: {
    clients: number;
    agents: number;
    resolvedAgents: number;
    /** 철회분을 뺀 값(음수 방지). 이게 진짜 "로그인화면에서 죽은" 수다. */
    unresolvedAgents: number;
    /** 철회 비율 = 오탐률. 높으면 백스톱 튜닝이 먼저다(스톨 대책이 아니라). */
    falsePositiveRate: number | null;
  };
  funding: {
    okClients: number;
    unfundedClients: number;
    blockedClients: number;
    inconclusiveClients: number;
    /** 판정이 난 설치(ok+unfunded+blocked). inconclusive 는 아무 주장도 아니라 제외. */
    decidedClients: number;
    /** ★핵심 지표: 인증까지 왔는데 구독/크레딧이 없어 못 도는 비율. */
    unfundedRate: number | null;
  };
  guideShown: { clients: number; events: number };
  note: string;
};

export function buildOnboardingStallSummary(
  input: OnboardingStallInput,
): OnboardingStallSummary {
  const stalledClients = coerceNumber(input.stalledClients);
  const needsAuthAgents = coerceNumber(input.needsAuthAgents);
  const resolvedAgents = coerceNumber(input.needsAuthResolvedAgents);
  const okClients = coerceNumber(input.fundingOkClients);
  const unfundedClients = coerceNumber(input.fundingUnfundedClients);
  const blockedClients = coerceNumber(input.fundingBlockedClients);
  const decidedClients = okClients + unfundedClients + blockedClients;
  return {
    stalledClients,
    stalledRate: safeRate(stalledClients, input.signupBase),
    spawnBlocked: {
      clients: coerceNumber(input.spawnBlockedClients),
      events: coerceNumber(input.spawnBlockedEvents),
      byReason: foldKeyCounts(input.spawnBlockedReasonRows),
    },
    needsAuth: {
      clients: coerceNumber(input.needsAuthClients),
      agents: needsAuthAgents,
      resolvedAgents,
      unresolvedAgents: Math.max(0, needsAuthAgents - resolvedAgents),
      falsePositiveRate: safeRate(resolvedAgents, needsAuthAgents),
    },
    funding: {
      okClients,
      unfundedClients,
      blockedClients,
      inconclusiveClients: coerceNumber(input.fundingInconclusiveClients),
      decidedClients,
      unfundedRate: safeRate(unfundedClients, decidedClients),
    },
    guideShown: {
      clients: coerceNumber(input.guideShownClients),
      events: coerceNumber(input.guideShownEvents),
    },
    note:
      "온보딩 스톨 = '구독/크레딧/인증이 없어 최초에 멈춘' 설치. needsAuth 는 철회(오탐)를 " +
      "뺀 unresolvedAgents 를 봐야 하고, funding 비율의 분모는 판정이 난 설치(ok 포함)다. " +
      "익명 install id(clientId) 기준이라 사람 수가 아니라 설치 수이며, 계정 조인은 하지 " +
      "않는다(비식별 방침). 3.0.24+ 렌더러/메인 빌드 실사용 전엔 전부 0 — 구조가 먼저다.",
  };
}

// ── 코크핏 전체 조립 ─────────────────────────────────────────────────────────
// index.ts 콜러블이 BQ 결과를 아래 입력 shape 로 넘기면 최종 응답 본문을 만든다.
export type KpiCockpitInput = {
  gaugeRow: FunnelCountsRow; // d_<col> 스칼라(게이지 분자/분모)
  starRatingRows: ReadonlyArray<{ rating: unknown; count: unknown }>;
  cliSetupRows: ReadonlyArray<CliSetupStepRow>;
  cliFailReasonRows: ReadonlyArray<{ key: unknown; count: unknown }>;
  demo: DemoFunnelInput;
  consent: ConsentInput;
  reuse: ReuseInput;
  spawn: SpawnHealthInput;
  /** 온보딩 스톨(티켓 9dXgBdkGn1LyJokShh1g). 구버전 호출부 호환을 위해 선택. */
  stall?: OnboardingStallInput;
};
export type KpiCockpitResult = {
  betaExitGauges: BetaExitGauge[];
  onboardingEvents: {
    cliSetup: CliSetupStepSummary[];
    survey: OnboardingSurveySummary;
    demo: DemoFunnelSummary;
    consent: ConsentSummary;
  };
  reuse: ReuseSummary;
  spawnHealth: SpawnHealthSummary;
  /** 온보딩 스톨 요약. 입력이 없으면(구버전 호출부) null. */
  onboardingStall: OnboardingStallSummary | null;
  note: string;
};

export function buildKpiCockpit(input: KpiCockpitInput): KpiCockpitResult {
  const nps = computeNpsFromStars(input.starRatingRows);
  return {
    betaExitGauges: buildBetaExitGauges(input.gaugeRow, nps),
    onboardingEvents: {
      cliSetup: buildCliSetupSummary(input.cliSetupRows),
      survey: {
        nps,
        cliFailReasons: foldKeyCounts(input.cliFailReasonRows),
      },
      demo: buildDemoFunnel(input.demo),
      consent: buildConsentSummary(input.consent),
    },
    reuse: buildReuseSummary(input.reuse),
    spawnHealth: buildSpawnHealth(input.spawn),
    onboardingStall: input.stall
      ? buildOnboardingStallSummary(input.stall)
      : null,
    note:
      "베타종료 게이지는 활성화 전략 메모의 지표기반 종료 기준(CLI인증80·첫프로젝트60· " +
      "첫티켓50·7일잔존30·NPS40+)이다. 분모가 0 인 게이지는 current=null('데이터 대기')로 " +
      "표시한다. ★신규 온보딩 이벤트(cli_setup_step·survey·demo·marketing_consent)는 3.0.19 " +
      "렌더러 빌드+실사용 전엔 전부 0 이다 — 구조가 먼저, 데이터는 후행한다. 30분내 첫완료율 " +
      "목표(0.30)는 메모에 숫자가 없어 잠정 기본값이다. 스폰 성공률은 완료/(완료+크래시)이며 " +
      "재시작은 회복 신호라 분모에서 제외한다. 동시작업 수는 세션 상관이 필요해 v1 미포함.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 필수 활성유저 지표 확충 — 리텐션 코호트 · Stickiness · 30일+ 잔존 · 순차 게이트
// ════════════════════════════════════════════════════════════════════════════
// 신규 row 는 events.metadata.accountUserId 를 계정 identity 로 쓰고, cost_logs.userId
// 는 이미 clean account uid 로 본다. events.userId 는 agent/client UUID 오염이 있어
// 여기서는 계정 identity 로 쓰지 않는다. ADMIN_UID 와 agent identity 는 쿼리에서
// 제외하고, 이 모듈은 BQ 행을 비율/표시 shape 로 접는 순수 로직만 담당한다.

export type RetentionHorizon = "d1" | "d7" | "d14" | "d30";
export type RetentionCohortSourceRow = {
  period?: unknown;
  cohort?: unknown;
  cohortUsers?: unknown;
  d1Users?: unknown;
  d7Users?: unknown;
  d14Users?: unknown;
  d30Users?: unknown;
};
export type RetentionCohort = {
  period: "day" | "week";
  cohort: string;
  cohortUsers: number;
  returningUsers: Record<RetentionHorizon, number>;
  rates: Record<RetentionHorizon, number | null>;
};
export type RetentionCohortsResult = {
  day: RetentionCohort[];
  week: RetentionCohort[];
  note: string;
};

function normalizeRetentionPeriod(value: unknown): "day" | "week" {
  return value === "week" ? "week" : "day";
}

function buildRetentionCohortRow(
  row: RetentionCohortSourceRow,
): RetentionCohort {
  const cohortUsers = coerceNumber(row.cohortUsers);
  const returningUsers: Record<RetentionHorizon, number> = {
    d1: coerceNumber(row.d1Users),
    d7: coerceNumber(row.d7Users),
    d14: coerceNumber(row.d14Users),
    d30: coerceNumber(row.d30Users),
  };
  const rate = (n: number): number | null =>
    cohortUsers > 0 ? n / cohortUsers : null;
  return {
    period: normalizeRetentionPeriod(row.period),
    cohort: coerceStr(row.cohort),
    cohortUsers,
    returningUsers,
    rates: {
      d1: rate(returningUsers.d1),
      d7: rate(returningUsers.d7),
      d14: rate(returningUsers.d14),
      d30: rate(returningUsers.d30),
    },
  };
}

export function buildRetentionCohorts(
  rows: ReadonlyArray<RetentionCohortSourceRow>,
): RetentionCohortsResult {
  const cohorts = rows
    .map(buildRetentionCohortRow)
    .filter((r) => r.cohort !== "")
    .sort((a, b) => b.cohort.localeCompare(a.cohort));
  return {
    day: cohorts.filter((r) => r.period === "day"),
    week: cohorts.filter((r) => r.period === "week"),
    note:
      "리텐션 코호트는 유저별 첫활성일을 기준으로 묶고, D1/D7/D14/D30 당일에 " +
      "재방문한 distinct account user 비율을 계산한다. events.userId 는 agent UUID " +
      "오염이 있어 쓰지 않고 metadata.accountUserId 와 cost_logs.userId 만 사용한다.",
  };
}

export type ActiveByDaySourceRow = {
  date?: unknown;
  dau?: unknown;
  events?: unknown;
};
export type ActiveUserScalarRow = {
  dau?: unknown;
  wau?: unknown;
  mau?: unknown;
};
export type ThirtyDayRetentionSourceRow = {
  date?: unknown;
  eligibleUsers?: unknown;
  retainedUsers?: unknown;
};
export type ActiveByDayMetric = {
  date: string;
  dau: number;
  events: number;
};
export type ThirtyDayRetentionPoint = {
  date: string;
  eligibleUsers: number;
  retainedUsers: number;
  retentionRate: number | null;
};
export type ActiveUserMetricsResult = {
  dau: number;
  wau: number;
  mau: number;
  dauWauRatio: number | null;
  dauMauRatio: number | null;
  activeByDay: ActiveByDayMetric[];
  thirtyDayRetention: {
    current: ThirtyDayRetentionPoint | null;
    trend: ThirtyDayRetentionPoint[];
  };
  note: string;
};

function buildThirtyDayRetentionPoint(
  row: ThirtyDayRetentionSourceRow,
): ThirtyDayRetentionPoint {
  const eligibleUsers = coerceNumber(row.eligibleUsers);
  const retainedUsers = coerceNumber(row.retainedUsers);
  return {
    date: coerceStr(row.date),
    eligibleUsers,
    retainedUsers,
    retentionRate: eligibleUsers > 0 ? retainedUsers / eligibleUsers : null,
  };
}

export function buildActiveUserMetrics(
  activeRows: ReadonlyArray<ActiveByDaySourceRow>,
  scalarRow: ActiveUserScalarRow | undefined | null,
  retentionRows: ReadonlyArray<ThirtyDayRetentionSourceRow>,
): ActiveUserMetricsResult {
  const scalars = scalarRow ?? {};
  const dau = coerceNumber(scalars.dau);
  const wau = coerceNumber(scalars.wau);
  const mau = coerceNumber(scalars.mau);
  const trend = retentionRows
    .map(buildThirtyDayRetentionPoint)
    .filter((r) => r.date !== "")
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    dau,
    wau,
    mau,
    dauWauRatio: wau > 0 ? dau / wau : null,
    dauMauRatio: mau > 0 ? dau / mau : null,
    activeByDay: activeRows
      .map((r) => ({
        date: coerceStr(r.date),
        dau: coerceNumber(r.dau),
        events: coerceNumber(r.events),
      }))
      .filter((r) => r.date !== "")
      .sort((a, b) => a.date.localeCompare(b.date)),
    thirtyDayRetention: {
      current: trend.length > 0 ? trend[trend.length - 1] : null,
      trend,
    },
    note:
      "DAU/WAU/MAU 는 account user 기준 distinct active users 이다. 30일+ 잔존은 " +
      "first-active 이후 30일이 지난 코호트 중 30일 이후에도 활동한 distinct user 수와 " +
      "그 비율이다.",
  };
}

export type ActivationGateKey =
  | "install"
  | "first_run"
  | "login"
  | "folder_connected"
  | "orchestrator_opened"
  | "agent_spawned"
  | "first_ticket_complete";

export const ACTIVATION_GATE_STEPS: ReadonlyArray<{
  key: ActivationGateKey;
  event: string;
  label: string;
}> = [
  { key: "install", event: "app:installed", label: "설치" },
  { key: "first_run", event: "app:first_run", label: "최초 실행" },
  { key: "login", event: "auth:login_success", label: "로그인" },
  {
    key: "folder_connected",
    event: "onboarding:folder_connected",
    label: "폴더 연결",
  },
  {
    key: "orchestrator_opened",
    event: "onboarding:orchestrator_opened",
    label: "오케 오픈",
  },
  { key: "agent_spawned", event: "agent:spawned", label: "스폰" },
  {
    key: "first_ticket_complete",
    event: "task:completed",
    label: "첫 티켓 완료",
  },
];

export type ActivationGateSourceRow = Record<string, unknown>;
export type ActivationGateStep = {
  key: ActivationGateKey;
  event: string;
  label: string;
  users: number;
  dropFromPrev: number | null;
  dropRateFromPrev: number | null;
  isMaxDrop: boolean;
};
export type ActivationGateFunnelResult = {
  steps: ActivationGateStep[];
  maxDrop: ActivationGateStep | null;
  note: string;
};

export function buildActivationGateFunnel(
  row: ActivationGateSourceRow | undefined | null,
): ActivationGateFunnelResult {
  const safeRow = row ?? {};
  let maxDrop = 0;
  let maxDropIndex = -1;
  const steps = ACTIVATION_GATE_STEPS.map((s, i) => {
    const users = coerceNumber(safeRow[`d_${s.key}`]);
    if (i === 0) {
      return {
        ...s,
        users,
        dropFromPrev: null,
        dropRateFromPrev: null,
        isMaxDrop: false,
      };
    }
    const prevUsers = coerceNumber(
      safeRow[`d_${ACTIVATION_GATE_STEPS[i - 1].key}`],
    );
    const drop = Math.max(0, prevUsers - users);
    if (drop > maxDrop) {
      maxDrop = drop;
      maxDropIndex = i;
    }
    return {
      ...s,
      users,
      dropFromPrev: drop,
      dropRateFromPrev: prevUsers > 0 ? drop / prevUsers : null,
      isMaxDrop: false,
    };
  });
  if (maxDropIndex >= 0 && maxDrop > 0) {
    steps[maxDropIndex].isMaxDrop = true;
  }
  return {
    steps,
    maxDrop: maxDropIndex >= 0 && maxDrop > 0 ? steps[maxDropIndex] : null,
    note:
      "활성화 게이트는 install→first_run→login→folder_connected→오케open→spawn→" +
      "first_ticket_complete 순차 부분집합이다. install 전용 이벤트가 없는 구버전 " +
      "데이터는 first_run 을 install 대체 신호로 사용한다.",
  };
}
// ════════════════════════════════════════════════════════════════════════════
// 릴리스·버전 헬스 + 모델 하위분해 (ticket F7OUUkNSD6FqoWxktWcp)
// ════════════════════════════════════════════════════════════════════════════
// 어드민 텔레메트리 대시보드에서 "지금 실제로 데이터가 쌓여 있는 축"만 채운다.
// 베타 세그먼트/리텐션은 외부 실사용≈0 이라 빈 화면이 되므로 여기 넣지 않는다.
//
// ★티켓 전제 정정(실측): `lifecycle:app-version` 같은 **이벤트는 없다**. 앱 버전은
// events 테이블의 `appVersion` **컬럼**으로 모든 행에 부착된다(telemetryService 가
// flush 시 주입). 그래서 릴리스 축은 이벤트 필터가 아니라 컬럼 GROUP BY 파생이다.
//
// ★두 model 컬럼의 해상도가 다르다(하위모델 분해가 필요한 이유):
//   - events.model      = 스폰 시점의 **하네스/CLI 계열**(claude · gpt · gemini · grok …)
//   - cost_logs.model   = 실제 과금된 **구체 모델 id**(claude-opus-4-8 · gpt-5.5 · MiniMax-M3 …)
// 두 축을 agentId 로 조인해야 "하네스 claude 밑에서 실제로 무엇이 돌았나"가 보인다
// (env-swap 벤더는 우리 claude 바이너리를 그대로 쓰기 때문에 하네스 축만 보면
// MiniMax/GLM 토큰이 Anthropic 과 한 칸에 섞인다 — usageBreakdown.ts 와 같은 문제의식).

// ── 버전 정렬(semver) ────────────────────────────────────────────────────────
// appVersion 은 실측상 semver("3.0.17")와 비-semver 라벨("github-actions" = CI 스모크
// 발신, index.ts 의 recordEvent 참조)과 NULL(구버전 텔레메트리 = 컬럼 도입 전)이
// 섞여 있다. 정렬은 semver 를 최신순으로 먼저 놓고, 라벨/미기록은 뒤로 보낸다.
// 지어낸 순서를 만들지 않기 위해 비교 불가한 값은 원문을 그대로 유지한다.

/** semver 파싱 — "3.0.17" 은 [3,0,17]. 파싱 불가면 null(비-semver). */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 미기록(NULL/빈 문자열) 버전의 표시 라벨. 0 이나 "unknown" 으로 위장하지 않는다. */
export const VERSION_UNRECORDED = "(미기록)";
/** CI 스모크 발신 라벨 — 사용자 설치본이 아니므로 UI 가 구분해 표시한다. */
export const VERSION_CI_LABEL = "github-actions";

export type ReleaseVersionRow = {
  version: string; // 표시용 버전(미기록은 VERSION_UNRECORDED)
  isSemver: boolean; // semver 로 해석됐나(정렬/최신판정 가능 여부)
  isCi: boolean; // CI 스모크 발신(github-actions) — 사용자 설치본 아님
  clients: number; // 고유 clientId(익명)
  events: number; // 총 이벤트
  sessions: number; // session:started
  spawned: number; // agent:spawned
  crashed: number; // agent:crashed
  // 크래시율 = crashed / spawned. 스폰 0 이면 null("데이터 없음" — 0% 로 오도 금지).
  crashRate: number | null;
  firstSeen: string; // 최초 관측일(YYYY-MM-DD)
  lastSeen: string; // 최종 관측일
};

// BQ 집계행(컬럼명 규약은 index.ts 쿼리와 1:1).
export type ReleaseVersionSourceRow = {
  version?: unknown;
  clients?: unknown;
  events?: unknown;
  sessions?: unknown;
  spawned?: unknown;
  crashed?: unknown;
  firstSeen?: unknown;
  lastSeen?: unknown;
};

/** 문자열 안전 변환 — null/빈값은 fallback. */
function coerceStr(v: unknown, fallback = ""): string {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

/**
 * 버전행 정렬 비교자 — semver 최신순, 그다음 CI/기타 라벨, 마지막이 미기록.
 * 같은 그룹 안에서는 이벤트 많은 순(실사용 비중).
 */
export function compareReleaseRows(
  a: ReleaseVersionRow,
  b: ReleaseVersionRow,
): number {
  const rank = (r: ReleaseVersionRow): number =>
    r.isSemver ? 0 : r.version === VERSION_UNRECORDED ? 2 : 1;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.isSemver && b.isSemver) {
    const pa = parseSemver(a.version);
    const pb = parseSemver(b.version);
    if (pa && pb) {
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i]; // 최신 먼저
      }
    }
  }
  return b.events - a.events;
}

export type ReleaseAdoptionSeries = {
  dates: string[]; // 공통 x축(오름차순 날짜)
  series: Array<{ version: string; values: number[] }>; // 버전별 일자 클라이언트 수
};

export type ReleaseHealthResult = {
  versions: ReleaseVersionRow[];
  adoption: ReleaseAdoptionSeries;
  totals: {
    versions: number; // 관측된 버전 수(미기록·CI 포함)
    spawned: number;
    crashed: number;
    crashRate: number | null; // 전체 크래시율
  };
  note: string;
};

/** 버전행 조립(순수). BQ 행에서 크래시율을 계산하고 정렬한다. */
export function buildReleaseVersions(
  rows: ReadonlyArray<ReleaseVersionSourceRow>,
): ReleaseVersionRow[] {
  return rows
    .map((r) => {
      const raw = coerceStr(r.version);
      const version = raw === "" ? VERSION_UNRECORDED : raw;
      const spawned = coerceNumber(r.spawned);
      const crashed = coerceNumber(r.crashed);
      return {
        version,
        isSemver: parseSemver(version) != null,
        isCi: version === VERSION_CI_LABEL,
        clients: coerceNumber(r.clients),
        events: coerceNumber(r.events),
        sessions: coerceNumber(r.sessions),
        spawned,
        crashed,
        crashRate: spawned > 0 ? crashed / spawned : null,
        firstSeen: coerceStr(r.firstSeen),
        lastSeen: coerceStr(r.lastSeen),
      };
    })
    .sort(compareReleaseRows);
}

// 채택 추이 원시행 — { date, version, clients }.
export type ReleaseAdoptionSourceRow = {
  date?: unknown;
  version?: unknown;
  clients?: unknown;
};

/**
 * 채택 추이 조립 — (date, version, clients) 롱포맷을 공통 x축과 버전별 시리즈로 편다.
 * 관측 없는 (버전,날짜) 칸은 0 으로 채운다(실제 0 = 그날 그 버전 활동 없음).
 * 시리즈 순서는 versionOrder(버전표 정렬)를 그대로 따라 UI 범례와 일치시킨다.
 */
export function buildReleaseAdoption(
  rows: ReadonlyArray<ReleaseAdoptionSourceRow>,
  versionOrder: ReadonlyArray<string>,
): ReleaseAdoptionSeries {
  const dateSet = new Set<string>();
  const byVersion = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const date = coerceStr(r.date);
    if (!date) continue;
    const rawV = coerceStr(r.version);
    const version = rawV === "" ? VERSION_UNRECORDED : rawV;
    dateSet.add(date);
    const m = byVersion.get(version) ?? new Map<string, number>();
    m.set(date, (m.get(date) ?? 0) + coerceNumber(r.clients));
    byVersion.set(version, m);
  }
  const dates = Array.from(dateSet).sort();
  // versionOrder 에 있는 것 먼저, 그 외(추이에만 등장)는 뒤에 붙인다.
  const ordered = [
    ...versionOrder.filter((v) => byVersion.has(v)),
    ...Array.from(byVersion.keys()).filter((v) => !versionOrder.includes(v)),
  ];
  return {
    dates,
    series: ordered.map((version) => {
      const m = byVersion.get(version) ?? new Map<string, number>();
      return { version, values: dates.map((d) => m.get(d) ?? 0) };
    }),
  };
}

export function buildReleaseHealth(
  versionRows: ReadonlyArray<ReleaseVersionSourceRow>,
  adoptionRows: ReadonlyArray<ReleaseAdoptionSourceRow>,
): ReleaseHealthResult {
  const versions = buildReleaseVersions(versionRows);
  const spawned = versions.reduce((s, v) => s + v.spawned, 0);
  const crashed = versions.reduce((s, v) => s + v.crashed, 0);
  return {
    versions,
    adoption: buildReleaseAdoption(
      adoptionRows,
      versions.map((v) => v.version),
    ),
    totals: {
      versions: versions.length,
      spawned,
      crashed,
      crashRate: spawned > 0 ? crashed / spawned : null,
    },
    note:
      "앱 버전은 전용 이벤트가 아니라 events.appVersion 컬럼(모든 이벤트에 부착)에서 " +
      "파생한다. '(미기록)'은 appVersion 주입 이전 텔레메트리이고, 'github-actions'는 " +
      "CI 스모크 발신이라 사용자 설치본이 아니다 — 둘 다 실사용 릴리스로 읽지 말 것. " +
      "크래시율은 agent:crashed / agent:spawned 이며 스폰 0 인 버전은 null('데이터 없음')로 " +
      "둔다(0% 로 오도 금지). 표본은 옵트인 텔레메트리이고 현재 도그푸드 편향이 크다.",
  };
}

// ── 하위모델 분해(하네스에서 구체 모델로) ───────────────────────────────────
// events(agent:spawned).model = 하네스, cost_logs.model = 구체 id 를 agentId 로 조인한
// 행을 받아 2단 트리로 접는다. ★조인 신뢰도: 실측상 한 agentId 가 2개 하네스로 스폰된
// 경우는 2093개 중 2개(0.1%)라 하네스 귀속은 사실상 1:1 이다. 그래도 추정이 아니라
// "관측된 조인 결과"이므로 없는 값을 만들지 않는다 — 비용행이 없는 하네스는 cost 0 과
// costRows 0 으로 그대로 남겨 UI 가 "비용 미적재"로 표시한다.

/** 구체 모델 칸이 실제 모델 id 가 아니라 미귀속 센티넬인지. usageBreakdown 과 같은 규율. */
export const UNATTRIBUTED_MODEL_KEYS: ReadonlySet<string> = new Set([
  "unknown", // cost-tracker 가 모델 귀속 없이 emit 한 값(자기 세션파일 미사용 하네스)
  "(none)", // BQ COALESCE fallback
  "<synthetic>", // 합성/테스트 적재
]);

export type ModelBridgeSourceRow = {
  harness?: unknown;
  model?: unknown;
  agents?: unknown;
  cost?: unknown;
  tokens?: unknown;
  costRows?: unknown;
};

export type SubModelRow = {
  model: string;
  agents: number;
  cost: number;
  tokens: number;
  costRows: number;
  share: number; // 상위 하네스 비용 내 점유율(0~1). 하네스 비용 0 이면 0
  /** 구체 모델로 못 읽는 칸(미귀속 센티넬이거나 하네스명이 그대로 온 경우). */
  unattributed: boolean;
};

export type HarnessRow = {
  harness: string;
  agents: number;
  cost: number;
  tokens: number;
  costRows: number;
  share: number; // 전체 비용 내 점유율
  /** 이 하네스 밑에서 실제로 돈 구체 모델(비용 내림차순). */
  subModels: SubModelRow[];
  /** 하네스명과 다른 구체 모델이 1종이라도 잡혔나(=분해가 의미를 가졌나). */
  hasDecomposition: boolean;
};

export type ModelBreakdownResult = {
  harnesses: HarnessRow[];
  totalCost: number;
  totalAgents: number;
  note: string;
};

// 하네스별 고유 에이전트 수 — (harness, model) 그레인의 agents 를 합치면 한 에이전트가
// 여러 모델을 태운 경우 중복 계상되므로, 하네스 그레인의 COUNT(DISTINCT agentId) 를
// 별도로 받아 덮어쓴다. 안 주면 하위합(중복 가능)으로 폴백한다.
export type HarnessAgentRow = { harness?: unknown; agents?: unknown };

/**
 * 하네스에서 구체모델로 내려가는 2단 분해(순수).
 * @param rows agentId 조인 결과 (harness, model, agents, cost, tokens, costRows)
 * @param harnessAgentRows 하네스 그레인 고유 에이전트 수(중복 계상 방지)
 */
export function buildModelBreakdown(
  rows: ReadonlyArray<ModelBridgeSourceRow>,
  harnessAgentRows: ReadonlyArray<HarnessAgentRow> = [],
): ModelBreakdownResult {
  const harnessAgents = new Map<string, number>();
  for (const r of harnessAgentRows) {
    harnessAgents.set(coerceStr(r.harness, "(none)"), coerceNumber(r.agents));
  }
  const acc = new Map<string, Map<string, SubModelRow>>();
  for (const r of rows) {
    const harness = coerceStr(r.harness, "(none)");
    const model = coerceStr(r.model, "(none)");
    const sub = acc.get(harness) ?? new Map<string, SubModelRow>();
    const prev = sub.get(model);
    const merged: SubModelRow = {
      model,
      agents: (prev?.agents ?? 0) + coerceNumber(r.agents),
      cost: (prev?.cost ?? 0) + coerceNumber(r.cost),
      tokens: (prev?.tokens ?? 0) + coerceNumber(r.tokens),
      costRows: (prev?.costRows ?? 0) + coerceNumber(r.costRows),
      share: 0, // 아래에서 채움
      // 하네스명이 그대로 구체 칸에 온 경우도 "분해 안 됨"으로 본다
      // (예: harness=claude 인데 model 도 claude 이면 구체 모델 미기록).
      unattributed:
        UNATTRIBUTED_MODEL_KEYS.has(model.toLowerCase()) ||
        model.toLowerCase() === harness.toLowerCase(),
    };
    sub.set(model, merged);
    acc.set(harness, sub);
  }

  const harnesses: HarnessRow[] = Array.from(acc.entries()).map(
    ([harness, sub]) => {
      const subModels = Array.from(sub.values()).sort(
        (a, b) => b.cost - a.cost || b.agents - a.agents,
      );
      const cost = subModels.reduce((s, m) => s + m.cost, 0);
      for (const m of subModels) m.share = cost > 0 ? m.cost / cost : 0;
      return {
        harness,
        agents:
          harnessAgents.get(harness) ??
          subModels.reduce((s, m) => s + m.agents, 0),
        cost,
        tokens: subModels.reduce((s, m) => s + m.tokens, 0),
        costRows: subModels.reduce((s, m) => s + m.costRows, 0),
        share: 0,
        subModels,
        hasDecomposition: subModels.some((m) => !m.unattributed),
      };
    },
  );

  const totalCost = harnesses.reduce((s, h) => s + h.cost, 0);
  for (const h of harnesses) h.share = totalCost > 0 ? h.cost / totalCost : 0;
  harnesses.sort((a, b) => b.cost - a.cost || b.agents - a.agents);

  return {
    harnesses,
    totalCost,
    totalAgents: harnesses.reduce((s, h) => s + h.agents, 0),
    note:
      "스폰 이벤트의 model 은 하네스(claude·gpt·grok…)이고 실제 과금 모델 id 는 " +
      "cost_logs.model 이라, 두 축을 agentId 로 조인해 하위모델을 분해한다. env-swap " +
      "벤더(Z.ai·MiniMax·Kimi)는 우리 claude 바이너리를 그대로 쓰기 때문에 하네스 축만 " +
      "보면 Anthropic 과 한 칸에 섞인다 — 이 표가 그 구분을 드러낸다. 구체 모델 칸이 " +
      "하네스명과 같거나 unknown/synthetic 이면 '모델 미기록'으로 표시하며 지어내지 " +
      "않는다. 비용행이 0 인 하네스는 스폰만 있고 토큰 적재가 없는 경우다.",
  };
}

// ── 일별 × 모델 비용(기간별 분해) ───────────────────────────────────────────
// 기존 대시보드의 costByDay 는 **총합**만이라 "어느 모델이 그날 비용을 만들었나"를
// 볼 수 없다. (date, model, cost) 롱포맷을 상위 N 모델과 '그 외'로 접어 누적막대용
// 매트릭스로 만든다. topN 을 넘긴 모델은 버리지 않고 '그 외'로 합산한다(총합 보존).

export const COST_BY_DAY_OTHER_KEY = "그 외";

export type CostByDayModelSourceRow = {
  date?: unknown;
  model?: unknown;
  cost?: unknown;
};

export type CostByDayModelResult = {
  dates: string[];
  models: Array<{ model: string; total: number; share: number }>;
  /** models 순서와 1:1 대응하는 일자별 비용 행렬(models.length × dates.length). */
  matrix: number[][];
  grandTotal: number;
  truncatedModels: number; // '그 외'로 접힌 모델 종수(0 이면 접힘 없음)
};

export function buildCostByDayModel(
  rows: ReadonlyArray<CostByDayModelSourceRow>,
  topN = 6,
): CostByDayModelResult {
  const dateSet = new Set<string>();
  const totals = new Map<string, number>();
  const cell = new Map<string, number>(); // `model date` 키로 합산
  const cellKey = (m: string, d: string): string => `${m} ${d}`;
  for (const r of rows) {
    const date = coerceStr(r.date);
    if (!date) continue;
    const model = coerceStr(r.model, "(none)");
    const cost = coerceNumber(r.cost);
    dateSet.add(date);
    totals.set(model, (totals.get(model) ?? 0) + cost);
    const k = cellKey(model, date);
    cell.set(k, (cell.get(k) ?? 0) + cost);
  }
  const dates = Array.from(dateSet).sort();
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const limit = Math.max(1, topN);
  const keep = ranked.slice(0, limit);
  const rest = ranked.slice(limit);

  const models = keep.map(([model, total]) => ({ model, total, share: 0 }));
  const matrix = keep.map(([model]) =>
    dates.map((d) => cell.get(cellKey(model, d)) ?? 0),
  );
  if (rest.length > 0) {
    models.push({
      model: COST_BY_DAY_OTHER_KEY,
      total: rest.reduce((s, [, t]) => s + t, 0),
      share: 0,
    });
    matrix.push(
      dates.map((d) =>
        rest.reduce((s, [m]) => s + (cell.get(cellKey(m, d)) ?? 0), 0),
      ),
    );
  }
  const grandTotal = models.reduce((s, m) => s + m.total, 0);
  for (const m of models) m.share = grandTotal > 0 ? m.total / grandTotal : 0;

  return { dates, models, matrix, grandTotal, truncatedModels: rest.length };
}
