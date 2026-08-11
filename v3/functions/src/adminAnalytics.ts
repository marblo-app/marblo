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

// ── ★events 계정축 은퇴 (ticket woXp2c70oR0tliGB8Vs6) ────────────────────────
// logTelemetryBatch 는 그동안 모든 이벤트의 metadata 에 accountUserId(=Firebase
// uid)를 몰래 붙였다. 처리방침은 같은 테이블을 "계정 UID 없이 익명 설치 ID만"
// 이라고 고지하고 있었으므로, 문구가 아니라 코드를 고쳐 uid 부착을 중단했다.
//
// 결과적으로 events 로 만들 수 있는 identity 는 익명 설치 ID(clientId) 하나다.
//   - COALESCE(accountUserId, userId) 폴백을 쓰던 축(온보딩 퍼널·KPI 코크핏)은
//     그대로 동작한다. 단위가 "계정"에서 "설치"로 수렴할 뿐이다.
//   - accountUserId 단독을 쓰던 축(리텐션 코호트·활성화 게이트·DAU/WAU/MAU·
//     베타 세그먼트)은 은퇴일 이후 구간에서 events 기여분이 0 이 된다.
//     ★그 0 은 "아무도 안 왔다"가 아니라 "이 축으로는 더 이상 측정하지 않는다"다.
//     계정 단위 활동은 cost_logs.userId(=uid — 사용자 본인에게 자기 지출을
//     되돌려주는 용도라 유지) 로만 남는다.
// 화면이 0 을 제품 실패로 오독하지 않도록, 해당 콜러블은 아래 note 를 응답에
// 실어 보낸다.
export const EVENTS_ACCOUNT_AXIS_RETIRED_ON = "2026-08-10";

export const EVENTS_ACCOUNT_AXIS_NOTE =
  `★${EVENTS_ACCOUNT_AXIS_RETIRED_ON} 부터 events 에는 계정 식별자를 붙이지 ` +
  "않는다(익명 설치 ID 단일 축). 그래서 이 축의 events 기여분은 그 날짜까지의 " +
  "과거 구간에만 존재하고, 이후 구간의 계정 활동은 cost_logs(사용량·비용) " +
  "기준만 집계된다 — 0 은 '안 썼다'가 아니라 '이 축으로는 측정하지 않는다'다.";

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
  | "install"
  | "first_run"
  | "login_attempt"
  | "login_success"
  | "folder_connected"
  | "orchestrator_opened"
  | "first_conversation" // 오케에게 첫 지시를 **보낸** 순간
  | "first_ticket" // 보드에 첫 티켓이 생긴 순간
  | "agent_spawned"
  // ── 스폰 이후 활성화 단계(reach 본선 밖, "핵심경험/잔존") ──
  | "task_completed" // 첫 오케 티켓을 에이전트가 완료(활성화 순간)
  | "first_merge" // 첫 머지(7일 창) — 코드가 실제로 랜딩된 순간
  | "core_experience" // 에이전트를 2회+ 스폰(반복 사용 = 핵심경험 도달)
  | "retained_7d"; // 7일 내 2번째 세션/프로젝트(초기 잔존)

// 단계 종류: reach=온보딩 본선(단순 이벤트 도달), activation=스폰 이후 활성화·
// 잔존(HAVING/시간창 같은 복합 집계라 index.ts 가 별도 subquery 로 d_<key> 를
// 채워 넣는다 — 순수 빌더는 채워진 count 만 읽어 kind 만 태깅한다).
export type OnboardingStepKind = "reach" | "activation";

// 퍼널 순서 + 라벨 + 소스 이벤트명 + 종류(단일 소스 오브 트루스).
//
// ★`gating` — 이 단계가 **하류 단계의 기준선**인가.
//
// 전 구간을 다 채우라는 요구(티켓 ygoWP1VJ)와 "체인을 늘리면 신호가 죽는다"는
// 현실이 부딪힌다. 새로 끼운 단계 중 일부는 구조적으로 과소계상이다:
//   · first_ticket — 오케는 MCP(별도 stdio 프로세스)로 Firestore 에 직접 write
//     하므로 렌더러의 task:created 를 우회한다. 그래서 렌더러 one-shot
//     `onboarding:first_ticket` 을 함께 세지만, 그 빌드가 깔리기 전 구간은 0 이다.
//   · first_conversation — 계측 자체가 이 티켓에서 처음 생겼다(그 전 전량 0).
//   · first_merge — 24h 가 아니라 7일 창이라 본선과 축이 다르다.
// 이런 단계를 순차 체인에 **강제로 끼우면** 그 뒤의 agent_spawned 가 통째로 0 이
// 되어, 계측 공백이 제품 실패로 둔갑한다. 그래서 gating=false 인 단계는 화면에는
// 보이되 하류의 기준선이 되지 않는다 — 이탈률은 직전 **gating** 단계 대비로 낸다.
// (기존 단계는 전부 gating=true 라 수치가 한 자리도 바뀌지 않는다.)
export const ONBOARDING_FUNNEL_STEPS: ReadonlyArray<{
  key: OnboardingStepKey;
  event: string;
  label: string;
  kind: OnboardingStepKind;
  gating: boolean;
}> = [
  // ★install 전용 이벤트(`app:installed`)는 **아직 한 번도 발신된 적이 없다**
  // (BQ 90일 실측 0건). index.ts 가 COALESCE(app:installed, app:first_run) 로
  // 채우므로 이 칸은 사실상 first_run 과 같은 수다 — 없는 신호를 있는 척하지
  // 않도록 note 와 라벨에 그대로 밝힌다.
  {
    key: "install",
    event: "app:installed",
    label: "설치(최초 실행 대체 신호)",
    kind: "reach",
    gating: true,
  },
  {
    key: "first_run",
    event: "app:first_run",
    label: "앱 최초 실행",
    kind: "reach",
    gating: true,
  },
  {
    key: "login_attempt",
    event: "auth:login_attempt",
    label: "로그인 시도",
    kind: "reach",
    gating: true,
  },
  {
    key: "login_success",
    event: "auth:login_success",
    label: "로그인 성공(인증)",
    kind: "reach",
    gating: true,
  },
  {
    key: "folder_connected",
    event: "onboarding:folder_connected",
    label: "폴더 연결",
    kind: "reach",
    gating: true,
  },
  {
    key: "orchestrator_opened",
    event: "onboarding:orchestrator_opened",
    label: "오케 오픈(첫 스폰 시도)",
    kind: "reach",
    gating: true,
  },
  // ★비-gating 2칸 — 위 주석의 이유로 하류 기준선이 되지 않는다.
  {
    key: "first_conversation",
    event: "onboarding:first_conversation",
    label: "첫 대화(오케에 첫 지시 전송)",
    kind: "reach",
    gating: false,
  },
  {
    key: "first_ticket",
    event: "onboarding:first_ticket",
    label: "첫 티켓 생성",
    kind: "reach",
    gating: false,
  },
  {
    key: "agent_spawned",
    event: "agent:spawned",
    label: "에이전트 스폰",
    kind: "reach",
    gating: true,
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
    gating: true,
  },
  // ★첫 머지는 24h 창이 아니라 **7일 창**이다(본선과 축이 다르다). 머지는 보통
  // 가입 당일에 안 일어나므로 24h 로 재면 구조적으로 0 이 된다 — 창을 늘려 재고,
  // gating=false 로 두어 뒤의 core_experience 기준선을 오염시키지 않는다.
  {
    key: "first_merge",
    event: "task:merged",
    label: "첫 머지(7일 내)",
    kind: "activation",
    gating: false,
  },
  {
    key: "core_experience",
    event: "agent:spawned",
    label: "핵심경험(스폰 2회+)",
    kind: "activation",
    gating: true,
  },
  {
    key: "retained_7d",
    event: "session:started",
    label: "7일 잔존(2번째 세션/프로젝트)",
    kind: "activation",
    gating: true,
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
  // ── 온보딩 스톨 분기(#888 계측을 퍼널 화면으로 끌어올린 것) ────────────────
  // 이 셋은 **전진 단계가 아니라 이탈 사유**다. 순차 체인에 칸으로 끼우면 "스폰
  // 하려다 인증에 막힌 사람"이 전진한 것처럼 보이므로 실패 분기로 넣는다.
  // 집계 축(buildOnboardingStallSummary)과 같은 이벤트를 읽으니 두 화면의 수가
  // 어긋나지 않는다 — needsAuth 만 의미가 갈리는데, 여기 clients 는 **철회 보정
  // 전** 원수치다(철회분을 뺀 값은 스톨 요약의 unresolvedAgents 를 봐야 한다).
  {
    key: "spawnBlocked",
    col: "spawn_blocked",
    event: "onboarding:spawn_blocked",
    label: "스폰 사전 차단(설치/인증/벤더 미비)",
  },
  {
    key: "needsAuth",
    col: "needs_auth",
    event: "onboarding:agent_needs_auth",
    label: "CLI 로그인 화면에서 멈춤(needsAuth, 철회 보정 전)",
  },
  {
    key: "authedButUnfunded",
    col: "funding_guide_shown",
    event: "onboarding:funding_guide_shown",
    label: "인증됐으나 구독/크레딧 없음(authedButUnfunded)",
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
  gating: boolean; // 하류 이탈률의 기준선인가(false=화면에만, 체인 밖)
  clients: number; // 도달 고유 clientId
  events: number; // 이벤트 발생 총량
  /** 이탈 client 수 = 직전 **gating** 단계 − 이 단계(≥0, clamp). 첫 단계=null */
  dropFromPrev: number | null;
  dropRateFromPrev: number | null; // dropFromPrev / prevGating.clients. 첫 단계=null
  /** 전환율 = 이 단계 / 직전 **gating** 단계(= 1 − dropRateFromPrev). 첫 단계=null */
  conversionFromPrev: number | null;
  /** 최초 단계(install) 대비 누적 전환율. 분모 0 이면 null. */
  conversionFromStart: number | null;
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
        ? `가입 후 ${
            windowMinutes / 60
          }시간 내 오케 티켓을 에이전트가 1개+ 완료한 사용자 비율`
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
    gating: s.gating,
    clients: stepClients(safeRow, s.key),
    events: stepEvents(safeRow, s.key),
  }));

  // 2) 이탈·전환(음수는 0 으로 clamp — 비단조 정상, §비단조 주석).
  // ★기준선은 "배열의 직전 칸"이 아니라 "직전 **gating** 칸"이다. 계측 공백이나
  // 다른 시간창을 쓰는 칸(first_conversation·first_ticket·first_merge)이 중간에
  // 끼어도 본선 수치가 흔들리지 않게 하기 위한 것 — 기존 칸은 전부 gating 이라
  // 이 변경으로 값이 바뀌지 않는다.
  // ★isMaxDrop(최대 이탈 구간)은 reach 본선의 **gating** 칸 안에서만 후보로 삼는다
  // — activation 단계는 reach 의 엄격 부분집합이 아니고(단일 스폰으로 완료한 유저
  // 등), 비-gating 칸의 감소는 제품 누수가 아니라 계측 공백일 수 있다.
  const startClients = base.length > 0 ? base[0].clients : 0;
  let prevGating: (typeof base)[number] | null = null;
  let maxDrop = 0;
  let maxDropIdx = -1;
  const steps: FunnelStep[] = base.map((s, i) => {
    const prev = prevGating;
    if (s.gating) prevGating = s;
    if (i === 0 || prev == null) {
      return {
        ...s,
        dropFromPrev: null,
        dropRateFromPrev: null,
        conversionFromPrev: null,
        conversionFromStart:
          i === 0 ? null : startClients > 0 ? s.clients / startClients : null,
        isMaxDrop: false,
      };
    }
    const drop = Math.max(0, prev.clients - s.clients);
    const rate = prev.clients > 0 ? drop / prev.clients : null;
    if (drop > maxDrop && s.kind === "reach" && s.gating) {
      maxDrop = drop;
      maxDropIdx = i;
    }
    return {
      ...s,
      dropFromPrev: drop,
      dropRateFromPrev: rate,
      conversionFromPrev: prev.clients > 0 ? s.clients / prev.clients : null,
      conversionFromStart: startClients > 0 ? s.clients / startClients : null,
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
      "같은 분자를 사용한다. 운영자 도그푸딩은 includeAdmin=false 기본값에서 제외된다. " +
      "★단계별 한계(있는 그대로): (1) '설치' 는 전용 이벤트가 없어 app:first_run 을 " +
      "대체 신호로 쓴다 — 실질적으로 최초 실행과 같은 수다. (2) '첫 대화'·'첫 티켓' 은 " +
      "이 티켓에서 처음 계측됐고(onboarding:first_conversation / onboarding:first_ticket), " +
      "그 렌더러 빌드가 깔리기 전 구간은 0 이다. 특히 오케가 MCP 로 만든 티켓은 렌더러 " +
      "task:created 를 우회하므로 설치당 one-shot 이벤트로 따로 센다. (3) '첫 머지' 는 " +
      "24h 가 아니라 7일 창이다. 이 세 칸은 gating=false — 화면에는 보이되 뒤 단계의 " +
      "이탈률 기준선이 되지 않는다(계측 공백이 제품 실패로 둔갑하지 않게). 이탈률/전환율은 " +
      "직전 gating 단계 대비값이다. needsAuth·authedButUnfunded 는 전진 단계가 아니라 " +
      "실패 분기로 집계한다(같은 이벤트를 온보딩 스톨 요약과 공유).",
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
  // ★잔존 3종(티켓 pWSnJeQN). 종전엔 D7 한 칸뿐이라 "첫날 바로 이탈" 과
  // "한 달 뒤에도 온다" 를 같은 화면에서 볼 수 없었다. 세 칸 모두 **같은 정의**
  // (가입 후 N일 창 안에서 2번째 파생세션/프로젝트 도달)라 창 길이만 다르다 —
  // 정의가 같아야 D1<D7<D30 의 단조성이 지표의 사실이 되고, 창이 다른 정의를
  // 섞어 놓은 것이 아님을 화면에서 말할 수 있다.
  | "retention_1d"
  | "retention_7d"
  | "retention_30d"
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
  // ★D1/D30 목표는 메모에 없다. D7(0.30)을 기준으로 D1 은 위, D30 은 아래로 둔
  // **잠정치**이며, 이 상수만 고치면 게이지가 따라온다(CEO 확정 전 default).
  retention_1d: 0.4,
  retention_30d: 0.2,
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
    key: "retention_1d",
    label: "1일 잔존율(D1)",
    unit: "rate",
    numCol: "d_retained_1d",
    denCol: "d_signup_base",
  },
  {
    key: "retention_7d",
    label: "7일 잔존율",
    unit: "rate",
    numCol: "d_retained_7d",
    denCol: "d_signup_base",
  },
  {
    key: "retention_30d",
    label: "30일 잔존율(D30)",
    unit: "rate",
    numCol: "d_retained_30d",
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
  // 표시 순서: 퍼널 흐름(인증→프로젝트→티켓→잔존 D1/D7/D30)→만족도→헤드라인.
  // ★키로 정렬한다 — 종전엔 rateGauges[0..4] 인덱스로 집어 넣었는데, 그 배열은
  // 메타 상수에서 나오므로 칸을 하나 추가하면 순서가 조용히 어긋난다(D1/D30 을
  // 넣으면서 실제로 어긋날 뻔했다). 키 기반이면 메타에 칸을 늘려도 안전하다.
  const order: BetaExitGaugeKey[] = [
    "cli_auth_success",
    "first_project_run",
    "first_ticket_completed",
    "retention_1d",
    "retention_7d",
    "retention_30d",
    "satisfaction_nps",
    "activation_30m",
  ];
  const byKey = new Map<BetaExitGaugeKey, BetaExitGauge>(
    [...rateGauges, npsGauge].map((g) => [g.key, g]),
  );
  return order
    .map((key) => byKey.get(key))
    .filter((g): g is BetaExitGauge => g != null);
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

/**
 * `{ key, count, clients }` 분포행을 접는다 — foldKeyCounts 의 '설치 수까지 든' 판
 * (티켓 iyxb4KsJpgPgoKYUBPsu).
 *
 * ★정렬 기준은 `clients`(고유 설치) 우선이다. 건수로 정렬하면 재시도를 많이 한 한
 * 사람이 만든 꼬리가 목록 맨 위에 올라와, 실제로는 몇 명 안 되는 사유가 최대 문제로
 * 보인다. 동률일 때만 건수로 가른다.
 */
export function foldBlockReasonCounts(
  rows: ReadonlyArray<{ key: unknown; count: unknown; clients: unknown }>,
): Array<{ key: string; count: number; clients: number }> {
  return rows
    .map((r) => ({
      key: r.key == null || r.key === "" ? "(none)" : String(r.key),
      count: coerceNumber(r.count),
      clients: coerceNumber(r.clients),
    }))
    .sort((a, b) => b.clients - a.clients || b.count - a.count);
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
  /**
   * ★차단 사유 **정규 어휘** 분포(metadata.reason: no_subscription / needs_auth /
   * no_cli / quota_exhausted / other) — 티켓 iyxb4KsJpgPgoKYUBPsu.
   *
   * 위 errorCategory 분포와 같은 이벤트지만 축이 다르다: 저쪽은 차단을 내린 코드의
   * 원어휘고, 이쪽은 "무엇을 고쳐야 하나" 의 축이다. 구버전 functions 응답에는 없어
   * optional — 없으면 빈 배열로 접힌다(0 을 사실로 주장하지 않게 화면이 빈 상태를
   * 구분한다).
   */
  spawnBlockedBlockReasonRows?: ReadonlyArray<{
    key: unknown;
    count: unknown;
    clients: unknown;
  }>;
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
    /**
     * ★정규 어휘 분해. `clients`(고유 설치)를 함께 들고 다니는 이유: 한 사람이 열 번
     * 눌러 쌓인 열 건과 열 명이 한 번씩 막힌 것은 완전히 다른 문제인데, 무료티어
     * GO 판단이 보는 값은 **사람(설치) 수** 쪽이다.
     */
    byBlockReason: Array<{ key: string; count: number; clients: number }>;
    /** 그중 '구독 공백'으로 막힌 고유 설치 — 이 티켓이 세려던 바로 그 수. */
    noSubscriptionClients: number;
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
  const blockReasons = foldBlockReasonCounts(
    input.spawnBlockedBlockReasonRows ?? [],
  );
  return {
    stalledClients,
    stalledRate: safeRate(stalledClients, input.signupBase),
    spawnBlocked: {
      clients: coerceNumber(input.spawnBlockedClients),
      events: coerceNumber(input.spawnBlockedEvents),
      byReason: foldKeyCounts(input.spawnBlockedReasonRows),
      byBlockReason: blockReasons,
      noSubscriptionClients:
        blockReasons.find((r) => r.key === "no_subscription")?.clients ?? 0,
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
      "차단 사유는 두 축으로 본다: byReason=차단을 내린 코드의 원어휘(errorCategory), " +
      "byBlockReason=정규 어휘(no_subscription/needs_auth/no_cli/quota_exhausted/other). " +
      "정규 어휘는 3.0.x+ 빌드부터 실리므로 그 전 행은 '(none)' 으로 모인다. " +
      "온보딩 스톨 = '구독/크레딧/인증이 없어 최초에 멈춘' 설치. needsAuth 는 철회(오탐)를 " +
      "뺀 unresolvedAgents 를 봐야 하고, funding 비율의 분모는 판정이 난 설치(ok 포함)다. " +
      "익명 install id(clientId) 기준이라 사람 수가 아니라 설치 수이며, 계정 조인은 하지 " +
      "않는다(비식별 방침). 3.0.24+ 렌더러/메인 빌드 실사용 전엔 전부 0 — 구조가 먼저다.",
  };
}

// ── 코크핏 전체 조립 ─────────────────────────────────────────────────────────
// index.ts 콜러블이 BQ 결과를 아래 입력 shape 로 넘기면 최종 응답 본문을 만든다.
// ════════════════════════════════════════════════════════════════════════════
// ★제로마찰 KPI — "10분 안에 첫 multi-agent 성공" · 동시 2+ · 주2회+ · 무료→유료
// ════════════════════════════════════════════════════════════════════════════
// 티켓 pWSnJeQN. #895 가 여정 골격(first_run→…→first_merge)을 심었고, 여기서는
// 사장님 최중요 KPI 를 이루는 **빠진 조각**만 집계한다. 전부 순수 로직 —
// index.ts 가 BQ 스칼라를 뽑아 넘기고 여기서 비율로 접는다.
//
// ★분모 규약: 이 섹션의 분모는 **가입(로그인 성공)** 이 아니라 **최초 실행**
// (app:first_run 고유 identity)이다. "설치한 사람 중 몇 %가 10분 안에 성공을
// 경험했나" 가 질문이기 때문이다. 로그인 기준 분모는 로그인에서 죽은 사람을
// 통째로 빼버려 KPI 를 낙관 편향시킨다. 참고용으로 가입 분모도 함께 내려준다.
//
// ★10분 시계의 앵커 = **모델 연결 완료**(티켓 Tw6m14gR, 사장님 결정). 무료 데모는
// 룰베이스라 진짜 multi-agent 실행이 모델 연결 이후에만 가능하다 — first_run 부터
// 재면 **연결조차 안 한 사람이 영원히 '10분 실패'로 잡힌다**. 그건 앞단(설치→연결)
// 이탈이지 10분 경험의 실패가 아니므로, 분모를 연결 완료 설치로 좁히고 앞단은
// `connectFunnel` 로 따로 센다. first_run 기준 값은 참고치로 계속 내려준다.
//
// ★한계는 note 에 그대로 적는다: 방문→다운로드, 다운로드→설치 구간은 web
// (GA4/Vercel) 경계라 이 축에 없다.

/**
 * ★"모델 연결 완료" 앵커의 **이벤트 목록**(클라 telemetryService 의 앵커 지점과
 * 짝이다 — 한쪽만 바뀌면 분모가 조용히 어긋난다).
 *
 * · `onboarding:model_connected` — 정본. 스폰 게이트 통과/CLI 인증/펀딩 프로브 중
 *   무엇이든 "이제 스폰 가능" 이 성립한 순간, 설치당 1회.
 * · 나머지 둘은 **하위호환**이다. 정본 이벤트는 이 빌드부터 나오므로, 그 전에
 *   이미 연결을 끝낸 설치를 분모에서 빠뜨리지 않으려고 같은 사실을 말하는 기존
 *   신호를 함께 센다(연결 마법사 인증 성공 / 펀딩 프로브 ok).
 */
export const MODEL_CONNECT_ANCHOR_EVENTS = [
  "onboarding:model_connected",
  "onboarding:cli_setup_step",
  "onboarding:funding_probe",
] as const;

/**
 * 위 세 신호를 하나의 boolean SQL 로 접는다. 표현식(step/phase/verdict 추출)은
 * 호출부가 이미 쓰고 있는 것을 그대로 넘겨 받는다 — JSON 경로를 두 벌 적지 않기
 * 위해서다.
 */
export function modelConnectedPredicateSql(exprs: {
  event: string;
  step: string;
  phase: string;
  verdict: string;
}): string {
  return (
    `(${exprs.event} = 'onboarding:model_connected'` +
    ` OR (${exprs.event} = 'onboarding:cli_setup_step'` +
    ` AND ${exprs.step} = 'auth' AND ${exprs.phase} = 'success')` +
    ` OR (${exprs.event} = 'onboarding:funding_probe'` +
    ` AND ${exprs.verdict} = 'ok'))`
  );
}

export type ZeroFrictionInput = {
  /** 앞단 분모: 최초 실행(app:first_run) 고유 identity. */
  firstRunBase: unknown;
  /** ★핵심 KPI 분모: **모델 연결이 관측된** 고유 identity(위 앵커 3신호 합집합). */
  modelConnectedClients: unknown;
  /** 참고 분모: 가입(로그인 성공) 고유 identity. */
  signupBase: unknown;
  /** 동시 2대+ 를 한 번이라도 관측한 고유 identity / 발생 총량. */
  multiAgentActiveClients: unknown;
  multiAgentActiveEvents: unknown;
  /** 동시 2대+ 상태에서 완료·머지가 난 고유 identity / 발생 총량. */
  multiAgentSuccessClients: unknown;
  multiAgentSuccessEvents: unknown;
  /** 설치당 1회 이벤트(first_multi_agent_success) 고유 identity. */
  firstSuccessClients: unknown;
  /** ★그중 **연결 후** 목표창(10분) 안에 도달한 고유 identity(헤드라인 분자). */
  firstSuccessWithinConnectClients: unknown;
  /** 그중 **연결 시계**를 못 구한 설치(연결 스탬프 이전부터 쓰던 설치). */
  firstSuccessNoConnectClockClients: unknown;
  /** ★연결→첫 성공 소요시간의 중앙값(ms). 표본 없으면 null. */
  firstSuccessMedianFromConnectMs: unknown;
  /** 참고: first_run 기준 목표창 안에 도달한 고유 identity(앞단 포함). */
  firstSuccessWithinFirstRunClients: unknown;
  /** 참고: first_run 시계를 못 구한 설치(이 계측 이전부터 쓰던 설치). */
  firstSuccessNoClockClients: unknown;
  /** 참고: first_run→첫 성공 소요시간의 중앙값(ms). 앞단 구간을 포함한다. */
  firstSuccessMedianMs: unknown;
  /** 최근 7일 활동 고유 identity / 그중 서로 다른 활동일이 2일 이상인 수. */
  weeklyActiveClients: unknown;
  weeklyTwicePlusClients: unknown;
  /** 유료 전환이 관측된 고유 identity(billing:subscription_active). */
  paidClients: unknown;
  /** 목표창(분). 클라 상수(MULTI_AGENT_TARGET_WINDOW_MS)와 같은 값. */
  targetWindowMinutes?: number;
};

export type ZeroFrictionResult = {
  /**
   * ★핵심 KPI. rate = **연결 후** 목표창 내 첫 multi-agent 성공 설치 / **모델
   * 연결 완료** 설치(티켓 Tw6m14gR). 연결하지 않은 설치는 분모에 없다.
   */
  tenMinuteMultiAgent: {
    /** 시계 시작점 이름 — 화면·문서가 이 값을 그대로 쓴다. */
    anchor: "model_connect";
    windowMinutes: number;
    withinClients: number;
    successClients: number;
    noClockClients: number;
    base: number;
    /** 목표창 내 성공률(분모=모델 연결 완료). 분모 0 이면 null. */
    rate: number | null;
    /** 창 무관 첫 성공률(같은 분모). 10분 밖 성공까지 포함. */
    successRate: number | null;
    /** 연결→첫 성공 중앙값(ms). 표본 없으면 null. */
    medianMs: number | null;
    label: string;
  };
  /**
   * ★앞단 구간(설치→모델 연결). 여기서 죽은 사람은 10분 KPI 의 **실패가 아니라
   * 앞단 이탈**이다 — 두 수를 갈라 놓는 것이 이 티켓의 핵심이다.
   */
  connectFunnel: {
    firstRunBase: number;
    connectedClients: number;
    /** 최초 실행 대비 모델 연결 도달률. 분모 0 이면 null. */
    connectRate: number | null;
    /** 최초 실행했지만 연결까지 못 온 설치(음수 방지로 0 하한). */
    notConnectedClients: number;
    label: string;
  };
  /**
   * 참고: **first_run 기준**(앞단 포함) 같은 KPI. 앵커 변경 전 수치와 같은 축이라
   * 전/후 대조에 쓴다 — 헤드라인은 위쪽이다.
   */
  fromFirstRunReference: {
    base: number;
    withinClients: number;
    noClockClients: number;
    rate: number | null;
    medianMs: number | null;
  };
  /** 동시 2대+ 를 실제로 쓴 설치(분모=모델 연결 완료 — 연결 전엔 불가능하다). */
  multiAgentUsage: {
    activeClients: number;
    activeEvents: number;
    successClients: number;
    successEvents: number;
    base: number;
    activeRate: number | null;
    successRate: number | null;
  };
  /** 주 2회+ 사용(최근 7일, 서로 다른 활동일 2일 이상). */
  weeklyTwicePlus: {
    clients: number;
    base: number;
    rate: number | null;
  };
  /** 무료→유료 전환(설치 축 귀속). */
  freeToPaid: {
    paidClients: number;
    base: number;
    signupBase: number;
    rate: number | null;
    /** 가입 분모 기준 참고치. */
    rateOfSignups: number | null;
  };
  note: string;
};

/** 기본 목표창 10분 — 렌더러 상수 MULTI_AGENT_TARGET_WINDOW_MS 와 짝이다. */
export const MULTI_AGENT_TARGET_WINDOW_MINUTES = 10;

export function buildZeroFrictionKpis(
  input: ZeroFrictionInput,
): ZeroFrictionResult {
  const windowMinutes =
    input.targetWindowMinutes && input.targetWindowMinutes > 0
      ? input.targetWindowMinutes
      : MULTI_AGENT_TARGET_WINDOW_MINUTES;
  // ★분모는 **모델 연결 완료** 설치다(티켓 Tw6m14gR). first_run 분모는 앞단
  // 구간과 참고치에서만 쓴다 — 연결 안 한 사람을 '10분 실패'로 세지 않기 위해서다.
  const firstRunBase = coerceNumber(input.firstRunBase);
  const base = coerceNumber(input.modelConnectedClients);
  const signupBase = coerceNumber(input.signupBase);
  const withinClients = coerceNumber(input.firstSuccessWithinConnectClients);
  const successClients = coerceNumber(input.firstSuccessClients);
  const medianRaw = coerceNumber(input.firstSuccessMedianFromConnectMs);
  const withinFromFirstRun = coerceNumber(
    input.firstSuccessWithinFirstRunClients,
  );
  const medianFromFirstRun = coerceNumber(input.firstSuccessMedianMs);
  const weeklyActive = coerceNumber(input.weeklyActiveClients);
  const weeklyTwice = coerceNumber(input.weeklyTwicePlusClients);
  const paidClients = coerceNumber(input.paidClients);
  const activeClients = coerceNumber(input.multiAgentActiveClients);
  const multiSuccessClients = coerceNumber(input.multiAgentSuccessClients);
  return {
    tenMinuteMultiAgent: {
      anchor: "model_connect",
      windowMinutes,
      withinClients,
      successClients,
      noClockClients: coerceNumber(input.firstSuccessNoConnectClockClients),
      base,
      rate: safeRate(withinClients, base),
      successRate: safeRate(successClients, base),
      // 표본이 없으면 0 이 아니라 null — "0분 만에 성공" 으로 읽히면 안 된다.
      medianMs: successClients > 0 && medianRaw > 0 ? medianRaw : null,
      label: `모델 연결 완료 후 ${windowMinutes}분 안에 에이전트 2대+ 동시 상태에서 첫 완료/머지에 도달한 설치 비율`,
    },
    connectFunnel: {
      firstRunBase,
      connectedClients: base,
      connectRate: safeRate(base, firstRunBase),
      // 두 수는 서로 다른 이벤트에서 오고 창 경계도 다르다 — 연결이 창 안이고
      // first_run 이 창 밖이면 음수가 나올 수 있다. 그건 '앞단 이탈 -1명' 이
      // 아니라 그냥 모르는 값이므로 0 으로 자른다.
      notConnectedClients: Math.max(0, firstRunBase - base),
      label: `최초 실행한 설치 중 모델 연결(실제 스폰 가능)까지 도달한 비율 — 여기서 이탈한 설치는 ${windowMinutes}분 KPI 의 분모에 들어가지 않는다`,
    },
    fromFirstRunReference: {
      base: firstRunBase,
      withinClients: withinFromFirstRun,
      noClockClients: coerceNumber(input.firstSuccessNoClockClients),
      rate: safeRate(withinFromFirstRun, firstRunBase),
      medianMs:
        successClients > 0 && medianFromFirstRun > 0
          ? medianFromFirstRun
          : null,
    },
    multiAgentUsage: {
      activeClients,
      activeEvents: coerceNumber(input.multiAgentActiveEvents),
      successClients: multiSuccessClients,
      successEvents: coerceNumber(input.multiAgentSuccessEvents),
      base,
      activeRate: safeRate(activeClients, base),
      successRate: safeRate(multiSuccessClients, base),
    },
    weeklyTwicePlus: {
      clients: weeklyTwice,
      base: weeklyActive,
      rate: safeRate(weeklyTwice, weeklyActive),
    },
    freeToPaid: {
      paidClients,
      // ★무료→유료만 분모가 **최초 실행**이다. 결제는 연결하지 않은 사람도 할 수
      // 있는 앞단 포함 여정이라, 연결 분모로 좁히면 전환율이 낙관 편향된다.
      base: firstRunBase,
      signupBase,
      rate: safeRate(paidClients, firstRunBase),
      rateOfSignups: safeRate(paidClients, signupBase),
    },
    note:
      `★${windowMinutes}분 시계의 시작점은 **모델 연결 완료**(실제로 에이전트를 스폰할 수 ` +
      `있게 된 순간)다 — 스폰 게이트 통과 / 연결 마법사 인증 성공 / 펀딩 프로브 ok 중 ` +
      `먼저 온 것. 무료 데모는 룰베이스라 진짜 multi-agent 실행이 모델 연결 이후에만 ` +
      `가능하므로, 최초 실행부터 재면 **연결조차 안 한 설치가 영원히 '10분 실패'로 ` +
      `잡힌다**. 그 이탈은 앞단(설치→연결) 구간(connectFunnel)에서 따로 세고, 핵심 KPI 의 ` +
      `분모는 연결을 끝낸 설치다. 최초 실행 기준 값은 fromFirstRunReference 에 참고로 ` +
      `남겨 앵커 변경 전후를 대조할 수 있게 했다. 시계는 클라이언트가 계산해 이벤트에 ` +
      `싣는다(서버 timestamp 는 수신시각이고, 로그인 이전 이벤트는 나중에 한꺼번에 flush ` +
      `되므로 서버에서는 지연을 구할 수 없다). '시계 없음' 설치는 이 계측 이전부터 쓰던 ` +
      `설치라 소요시간을 지어내지 않고 비운다. 주 2회+ 는 최근 7일 창에서 서로 다른 ` +
      `활동일이 2일 이상인 설치이며 분모는 그 창의 활동 설치다(다른 카드와 분모가 다르다). ` +
      `무료→유료는 분모가 최초 실행이고(결제는 연결 안 한 사람도 한다), 앱이 관측한 구독 ` +
      `활성화 시점이지 결제 시점이 아니다 — 웹에서 결제하고 앱을 나중에 열면 그만큼 늦게 ` +
      `찍힌다. 계측 직후 한동안은 이미 결제해 둔 설치가 분자에 섞여 과대 계상될 수 ` +
      `있다(창을 짧게 두고 읽으면 빠진다). ` +
      `★범위 밖: 방문→다운로드·다운로드→설치 구간은 web(GA4/Vercel) 경계라 이 축에 없다.`,
  };
}

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
  /** ★제로마찰 KPI(티켓 pWSnJeQN). 구버전 호출부 호환을 위해 선택. */
  zeroFriction?: ZeroFrictionInput;
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
  /** ★제로마찰 KPI. 입력이 없으면(구버전 호출부) null. */
  zeroFriction: ZeroFrictionResult | null;
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
    zeroFriction: input.zeroFriction
      ? buildZeroFrictionKpis(input.zeroFriction)
      : null,
    note:
      "베타종료 게이지는 활성화 전략 메모의 지표기반 종료 기준(CLI인증80·첫프로젝트60· " +
      "첫티켓50·7일잔존30·NPS40+)이다. 분모가 0 인 게이지는 current=null('데이터 대기')로 " +
      "표시한다. ★신규 온보딩 이벤트(cli_setup_step·survey·demo·marketing_consent)는 3.0.19 " +
      "렌더러 빌드+실사용 전엔 전부 0 이다 — 구조가 먼저, 데이터는 후행한다. 30분내 첫완료율 " +
      "목표(0.30)는 메모에 숫자가 없어 잠정 기본값이다. 스폰 성공률은 완료/(완료+크래시)이며 " +
      "재시작은 회복 신호라 분모에서 제외한다. ★동시작업(멀티에이전트)은 v1 에서 빠져 " +
      "있었으나 이제 zeroFriction 섹션이 직접 관측한 값으로 채운다(티켓 pWSnJeQN) — " +
      "세션 상관으로 재구성하지 않고 발생 시점에 센다. D1/D7/D30 잔존은 창 길이만 다른 " +
      "같은 정의(가입 후 N일 내 2번째 파생세션/프로젝트)이고, D1/D30 목표치는 잠정이다.",
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
      "오염이 있어 쓰지 않고 과거 구간의 metadata.accountUserId 와 " +
      "cost_logs.userId 만 사용한다. " +
      EVENTS_ACCOUNT_AXIS_NOTE,
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
      "그 비율이다. " +
      EVENTS_ACCOUNT_AXIS_NOTE,
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
      "데이터는 first_run 을 install 대체 신호로 사용한다. " +
      EVENTS_ACCOUNT_AXIS_NOTE +
      " 설치 단위 동일 퍼널은 '온보딩 퍼널'(getAdminOnboardingFunnel)에 있다.",
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

// ── 하위모델 분해(하네스에서 구체 모델로) — 은퇴 ────────────────────────────
//
// ★왜 은퇴했나 (ticket U5OPOKf0D3I2TSRP8yUq): 이 표는 events(agent:spawned).model
// = 하네스와 cost_logs.model = 구체 모델 id 를 **agentId 로 조인**해서 만들었다.
// 그런데 cost_logs 는 계정 uid 를 보관하는 원장이라, 그 조인이 성립한다는 것은
// 곧 익명 이벤트를 계정으로 되짚을 수 있다는 뜻이었다 — 처리방침이 "제품 사용
// 분석에는 계정 식별자가 없다" 고 말하는 근거를 반쪽으로 만들던 마지막 다리다.
//
// 익명 세계의 조인키를 가명화(functions/src/analyticsPseudonym.ts)하면서 그 조인은
// 더 이상 성립하지 않는다. 조용히 빈 표를 내려보내지 않고, 무엇이 왜 사라졌는지
// note 로 그대로 밝힌다(같은 판단: betaSegments 의 계정축 은퇴).
//
// 하네스 축 자체는 사라지지 않았다 — getAdminUsageSummary 의 spawnsByModel 이
// 하네스별 스폰 수를 계속 준다. 잃은 건 "그 하네스 밑에서 실제로 무엇이 돌았고
// 얼마를 썼나" 하는 비용축 결합뿐이다.

export type ModelBreakdownResult = {
  harnesses: never[];
  totalCost: number;
  totalAgents: number;
  note: string;
};

/** 하위모델 분해 은퇴 페이로드. 응답 모양은 유지하고 사유를 note 로 밝힌다. */
export const MODEL_BREAKDOWN_RETIRED: ModelBreakdownResult = {
  harnesses: [],
  totalCost: 0,
  totalAgents: 0,
  note:
    "하네스→구체 모델 분해는 은퇴했다. 이 표는 익명 이벤트와 cost_logs 를 agentId 로 " +
    "조인해 만들었는데, cost_logs 는 계정 uid 를 보관하므로 그 조인이 곧 익명 " +
    "텔레메트리를 계정으로 되짚는 경로였다. 조인키를 가명화하면서 다리를 끊었고, " +
    "그 대가로 이 분해를 포기했다. 하네스별 스폰 수는 '제품 사용' 탭의 모델별 " +
    "스폰 분포에, 구체 모델별 비용은 위 모델별 비용 표에 그대로 남아 있다."
};

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
