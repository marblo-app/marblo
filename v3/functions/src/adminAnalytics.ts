// 어드민 분석 — 순수 로직(BQ/Firestore 무의존). node --test 로 단위검증한다
// (marketingContacts.ts / redact.ts 와 동일 규약). index.ts 의 onCall 핸들러는
// BQ 쿼리만 담당하고, 파싱·집계·퍼널 계산은 전부 여기로 내려 테스트 가능하게 한다.
//
// 두 축:
//   1) includeAdmin 토글 — 운영자(존킴) 제외를 하드코딩에서 파라미터로. 기본 false
//      (제외). 값이 정확히 true 일 때만 포함한다(구버전 web 이 param 을 안 보내면
//      undefined → false → 기존 동작 유지 = 하위호환).
//   2) 온보딩 "첫 10분" 퍼널 — app:first_run → login → folder_connected →
//      orchestrator_opened → agent:spawned 의 단계별 도달·이탈 + 실패분기 분해.

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

// ── 온보딩 첫10분 퍼널 ───────────────────────────────────────────────────────
//
// 측정 방식(정직성): 각 단계에 "도달한 고유 clientId 수"(distinct userId)로 센다.
// beta-churn 분석(§1-B, session:started 22 → agent:spawned 6)과 동일한 방법론이다.
// ★엄격 순차(prior-all-reached)가 아니다 — 익명 clientId + auth-gated flush 한계
// (로그인 전 이벤트는 다음 로그인 성공 때 함께 flush)로 순차 조인은 과소계상 위험.
// 그래서 "단계별 도달(reach)"로 읽고, 인접 단계 감소를 이탈로 표기한다.
//
// ★비단조(non-monotonic) 정상: folder_connected=0 인데 orchestrator_opened>0 이
// 나올 수 있다(관측 세션 전부 resumed:true = 기존 프로젝트 재개라 신규 폴더연결
// 경로 미실행 — onboarding live-verify 문서 §4 참조). 이때 drop 은 음수가 아니라
// 0 으로 clamp 하고, reach 값 자체는 있는 그대로 노출한다(왜곡 금지).

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

// ★헤드라인 활성화 지표 — "가입 후 N분 내 오케 티켓을 에이전트가 1개+ 완료한
// 사용자 비율". 분자=시간창 내 활성화한 고유 client, 분모=가입(로그인 성공)
// 고유 client. 시간창 조인(min task_completed ts − min login_success ts ≤ N분)은
// index.ts 가 BQ 로 계산해 d_activated_30m / d_signup_base 스칼라로 넘긴다.
export type ActivationHeadline = {
  activatedClients: number; // 분자: N분 내 첫 티켓 완료
  baseClients: number; // 분모: 가입(로그인 성공) 고유 client
  rate: number | null; // activated / base (base=0 이면 null)
  windowMinutes: number; // 시간창(분). 기본 30
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
  windowMinutes = 30,
): ActivationHeadline {
  const safeRow = row ?? {};
  const activatedClients = coerceNumber(safeRow["d_activated_30m"]);
  const baseClients = coerceNumber(safeRow["d_signup_base"]);
  return {
    activatedClients,
    baseClients,
    rate: baseClients > 0 ? activatedClients / baseClients : null,
    windowMinutes,
    label: `가입 후 ${windowMinutes}분 내 오케 티켓을 에이전트가 1개+ 완료한 사용자 비율`,
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
      "단계별 '도달 고유 clientId' 기준(엄격 순차 아님). folder_connected 미도달인데 " +
      "orchestrator_opened 가 잡히면 기존 프로젝트 resume 경로(신규 폴더연결 미실행)다. " +
      "로그인-이전 이벤트는 다음 로그인 성공 때 함께 flush 되어, 끝내 로그인 못 한 " +
      "유저의 실패는 과소계상될 수 있다. 스폰 이후 활성화 단계(첫 티켓 완료·핵심경험· " +
      "7일 잔존)는 reach 본선의 엄격 부분집합이 아니라 각 단계 절대값을 우선으로 읽는다 " +
      "(예: 단일 스폰으로 티켓을 끝낸 유저는 '첫 티켓 완료'엔 있어도 '핵심경험(스폰2회+)'엔 " +
      "없다). 헤드라인 활성화율은 가입(로그인 성공)한 유저 중 30분 내 첫 티켓 완료 비율이다.",
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
//   CLI인증 80% · 첫프로젝트 60% · 첫티켓 50% · 7일잔존 30% · NPS 40+ · 30분율.
// ★30분내 첫완료율은 헤드라인(가입 30분내 첫티켓완료 = 핵심 KPI)이며, 메모에
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
    label: "가입 30분내 첫완료율",
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
    note:
      "베타종료 게이지는 활성화 전략 메모의 지표기반 종료 기준(CLI인증80·첫프로젝트60· " +
      "첫티켓50·7일잔존30·NPS40+)이다. 분모가 0 인 게이지는 current=null('데이터 대기')로 " +
      "표시한다. ★신규 온보딩 이벤트(cli_setup_step·survey·demo·marketing_consent)는 3.0.19 " +
      "렌더러 빌드+실사용 전엔 전부 0 이다 — 구조가 먼저, 데이터는 후행한다. 30분내 첫완료율 " +
      "목표(0.30)는 메모에 숫자가 없어 잠정 기본값이다. 스폰 성공률은 완료/(완료+크래시)이며 " +
      "재시작은 회복 신호라 분모에서 제외한다. 동시작업 수는 세션 상관이 필요해 v1 미포함.",
  };
}
