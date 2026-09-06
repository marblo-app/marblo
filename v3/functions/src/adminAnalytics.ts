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
// 라벨 해시 전용. BQ/Firestore 무의존 규약은 그대로다 — node 표준 모듈만 쓴다
// (analyticsPseudonym.ts 와 같은 선례).
import { createHash } from "node:crypto";
// ★Activated 임계값의 정본. 광고 퍼널 티켓(O5JPlh4FSiCsNpZ4E9VJ)이 세운 모듈이고,
//   KPI 스코어카드도 같은 상수를 읽어야 두 화면이 같은 Activated 를 말한다.
import { ACTIVATED_MIN_TASKS_COMPLETED } from "./activatedDefinition";

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

// ════════════════════════════════════════════════════════════════════════════
// ★단계별 계측 커버리지 (ticket 4KqBDPkH)
// ════════════════════════════════════════════════════════════════════════════
//
// 사장님 화면이 "첫 대화 0명 / 첫 티켓 0명 / 에이전트 스폰 2명" 을 동시에 띄웠다.
// 실측해 보니 이벤트는 **있었다**(30일 창 안 first_conversation 4설치 ·
// first_ticket 3설치). 0 이 나온 이유는 두 칸의 판정식이
//   reached_orchestrator_opened AND ts BETWEEN orch_ts AND login_success_ts+24h
// 라서, 그 계측이 처음 생긴 날(2026-08-09 / 08-10)보다 **먼저 로그인한 설치**는
// 구조적으로 창 밖이기 때문이다. 즉 "안 했다"가 아니라 "이 정의로는 셀 수 없다".
//
// ★그래서 값을 고치지 않는다(소급 보정 금지). 대신 **그 0 이 무슨 0 인지**를
//   같이 내려보낸다. 화면은 이 커버리지를 보고 `0` 대신 '미수집'/'부분 계측'을
//   그린다 — 0·미수집·적재 전을 가르는 이 화면의 기존 규약과 같은 규율이다.
//
//   missing — 그 이벤트가 **전기간 한 번도** BQ 에 없다(앱이 안 보낸다).
//             실측: app:installed / onboarding:agent_needs_auth /
//             onboarding:funding_guide_shown 셋이 여기 해당한다.
//   partial — 이벤트는 있는데 **최초 발신일이 조회창 시작보다 늦다**(forward-only).
//             창의 앞부분은 계측이 아예 없던 구간이라 0 이 "안 했다"가 아니다.
//   ok      — 조회창 전체를 덮는 계측이다.
export type StepCoverage = "ok" | "partial" | "missing";

/** 커버리지 입력 1행 — BQ 가 이벤트별로 뽑아 준다. */
export type FunnelCoverageRow = {
  event: unknown;
  /** 그 이벤트의 **전기간** 최초 발신일(YYYY-MM-DD). 한 번도 없으면 행 자체가 없다. */
  first_seen_day: unknown;
  /** 조회창 안에서 그 이벤트를 낸 고유 identity 수(순차 체인 무시, 있는 그대로). */
  clients_in_window: unknown;
};

/** 커버리지 맵 1건 — 이벤트명 → (최초 관측일, 창 안 실제 설치 수). */
export type FunnelCoverage = {
  /** 항상 실제 날짜다 — 최초 관측일이 없는 이벤트는 맵에 아예 안 들어간다. */
  firstSeenDay: string;
  clientsInWindow: number;
};

/** YYYY-MM-DD 문자열만 통과시킨다(BQ DATE 는 문자열로 온다). */
function asDayString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * 커버리지 rows → 이벤트명 맵. 행이 없는 이벤트는 맵에도 없다(= missing 판정).
 */
export function buildFunnelCoverageMap(
  rows: readonly FunnelCoverageRow[] | undefined | null,
): Map<string, FunnelCoverage> {
  const map = new Map<string, FunnelCoverage>();
  for (const r of rows ?? []) {
    const ev = typeof r.event === "string" ? r.event : "";
    if (ev === "") continue;
    const firstSeenDay = asDayString(r.first_seen_day);
    // ★전기간 최초 관측일이 없으면 그 행은 신호가 아니다 — 넣지 않는다.
    if (firstSeenDay == null) continue;
    map.set(ev, {
      firstSeenDay,
      clientsInWindow: coerceNumber(r.clients_in_window),
    });
  }
  return map;
}

/**
 * 한 단계의 계측 커버리지 판정(순수).
 *
 * @param cov          그 단계 이벤트의 커버리지(없으면 전기간 0건 = missing)
 * @param windowStartDay 조회창 시작일(YYYY-MM-DD). 없으면 partial 판정을 포기하고
 *                     ok 로 둔다 — 근거 없이 '부분 계측' 딱지를 붙이지 않는다.
 */
export function classifyStepCoverage(
  cov: FunnelCoverage | undefined,
  windowStartDay: string | null,
): StepCoverage {
  if (cov == null) return "missing";
  if (windowStartDay == null) return "ok";
  return cov.firstSeenDay > windowStartDay ? "partial" : "ok";
}

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
  /**
   * ★이 칸의 `clients` 를 믿어도 되는가. 'missing' 이면 화면은 숫자가 아니라
   * '미수집' 을 그려야 한다 — 0 으로 그리면 계측 공백이 제품 실패로 읽힌다.
   * 구버전 응답에는 없으므로 프론트는 optional 로 읽는다.
   */
  coverage: StepCoverage;
  /**
   * 그 이벤트가 **전기간 처음 관측된 날**(YYYY-MM-DD). 전기간 0건이면 null.
   * ★'계측이 생긴 날' 이라고 단정하지 않는다 — BQ 는 관측만 안다.
   */
  firstObservedDay: string | null;
  /**
   * 순차 체인을 **무시하고** 조회창 안에 그 이벤트를 낸 고유 설치 수.
   * ★추정이 아니라 실측이다. `clients`(순차 도달)와 크게 벌어지면 그 0 은
   * "안 했다"가 아니라 "이 정의로 못 센다"는 뜻이고, 화면이 그렇게 말해야 한다.
   * 전기간 0건(missing)이면 null.
   */
  everInWindow: number | null;
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
  /**
   * ★순차 정의를 무시하고 조회창 안에서 `task:completed` 를 실제로 낸 고유 설치 수.
   *
   * 이 칸이 있는 이유: 사장님 화면의 `0.0% (0/5)` 는 **정의 안에서는 사실**이지만
   * ("30일 안에 새로 로그인한 5명 중 24h 안에 첫 티켓을 완료한 사람 0명"),
   * 같은 창 안에 티켓을 실제로 완료한 설치는 2개 있었다 — 그 둘은 로그인이 창
   * 밖이라 분모에 없다. 이 값이 없으면 화면의 0% 가 "아무도 제품을 완주하지
   * 않았다"로 읽히고, 그건 거짓이다. 실측값이지 추정이 아니다.
   * 커버리지 정보가 없는(구버전) 경로에서는 null.
   */
  everActivatedInWindow: number | null;
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
  everActivatedInWindow: number | null = null,
): ActivationHeadline {
  const safeRow = row ?? {};
  const activatedClients = coerceNumber(safeRow["d_activated_30m"]);
  const baseClients = coerceNumber(safeRow["d_signup_base"]);
  return {
    activatedClients,
    baseClients,
    rate: baseClients > 0 ? activatedClients / baseClients : null,
    everActivatedInWindow,
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

/**
 * @param coverageRows   이벤트별 (전기간 최초 발신일, 창 안 실제 설치 수). 빈 배열이면
 *                       모든 단계가 'missing' 이 되어 화면이 통째로 '미수집' 이 된다 —
 *                       그래서 index.ts 는 이 쿼리가 **실패했을 때** 아예 undefined 를
 *                       넘겨 커버리지 판정을 포기한다(아래 hasCoverage 참조).
 * @param windowStartDay 조회창 시작일(YYYY-MM-DD). null 이면 partial 판정을 포기한다.
 */
export function buildOnboardingFunnel(
  row: FunnelCountsRow | undefined | null,
  reasonRows: ReasonRow[] = [],
  coverageRows?: readonly FunnelCoverageRow[] | null,
  windowStartDay: string | null = null,
): OnboardingFunnelResult {
  const safeRow = row ?? {};

  // ★커버리지 쿼리가 아예 안 왔으면(구버전 호출·쿼리 실패) 판정을 하지 않는다.
  //   근거 없이 전 칸에 '미수집' 딱지를 붙이면 그것대로 거짓말이다.
  const hasCoverage = coverageRows != null;
  const coverageMap = buildFunnelCoverageMap(coverageRows);

  // 1) 단계 reach(본선 + 스폰이후 활성화).
  const base = ONBOARDING_FUNNEL_STEPS.map((s) => {
    const cov = coverageMap.get(s.event);
    return {
      key: s.key,
      event: s.event,
      label: s.label,
      kind: s.kind,
      gating: s.gating,
      clients: stepClients(safeRow, s.key),
      events: stepEvents(safeRow, s.key),
      coverage: hasCoverage
        ? classifyStepCoverage(cov, windowStartDay)
        : ("ok" as StepCoverage),
      firstObservedDay: cov?.firstSeenDay ?? null,
      everInWindow: cov?.clientsInWindow ?? null,
    };
  });

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
    // ★계측이 통째로 없는 칸(coverage='missing')은 최대 이탈 후보에서 뺀다.
    //   그 칸의 0 은 이탈이 아니라 계측 공백이라, 붉게 칠하면 없는 절벽을 만든다.
    if (
      drop > maxDrop &&
      s.kind === "reach" &&
      s.gating &&
      s.coverage !== "missing"
    ) {
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
    headline: buildActivationHeadline(
      safeRow,
      undefined,
      // 헤드라인 분자와 같은 이벤트(task:completed)의 창 안 실측 설치 수.
      coverageMap.get("task:completed")?.clientsInWindow ?? null,
    ),
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
      "실패 분기로 집계한다(같은 이벤트를 온보딩 스톨 요약과 공유). " +
      "★각 칸에는 신호 커버리지가 붙는다(ticket 4KqBDPkH): '미수집' = 그 이벤트가 " +
      "전기간 한 번도 관측된 적이 없다, '부분 구간' = 처음 관측된 날이 조회창 시작보다 " +
      "늦어 창 앞부분에는 신호가 아예 없다. 이 두 경우의 0 은 '안 했다'가 아니므로 " +
      "화면이 숫자 대신 그 상태를 그린다. '부분 구간' 칸에는 순차 체인을 무시한 창 안 " +
      "실측 설치 수(everInWindow)를 함께 싣는다 — 추정이 아니라 BigQuery 원값이며, " +
      "순차 도달 수와 크게 벌어지면 그 0 은 정의의 한계지 제품 실패가 아니다. " +
      "★단, BQ 가 아는 것은 '언제 처음 관측됐나' 뿐이다 — 계측이 늦게 생긴 것인지 " +
      "그때까지 아무도 안 한 것인지는 이 축만으로 가르지 못한다.",
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

// ── 익명축 "모델별" 분해의 실제-모델 보정(티켓 g6TjsfP9NdtHlwuziyt7) ────────
//
// events.model 은 하네스축이다(gpt/claude/gemini/grok/...). solar·kimi·glm·
// deepseek·minimax 는 자기 하네스가 없어 codex/claude 하네스를 빌려 env 만
// 갈아끼운다 — 그래서 이 벤더들의 스폰이 "모델별" breakdown 에서 gpt/claude 로
// 뭉친다. ★이건 컬럼 결함이 아니다(MODEL_BREAKDOWN_RETIRED 의 판단과 같은 축
// 정의) — 하네스축은 위 은퇴 노트가 지키는 "제품 사용 탭의 모델별 스폰 분포"
// 그 자체다. 결함은 소비자가 그 축을 **실제 모델**로 오독하는 쪽에 있었다.
//
// ★agentId 조인은 쓰지 않는다 — 그건 위에서 이미 은퇴한 바로 그 다리다(익명
// 이벤트를 계정 cost_logs 로 되짚는 경로). 대신 events 행 자체에 실린
// metadata.spawnedModel(핀했을 때만, 없으면 undefined — 지어내지 않는다)을
// 같은 익명축 안에서만 접는다. 그래서 새 breakdown 도 여전히 "익명 텔레메트리"
// 다 — 계정 축을 한 걸음도 넘지 않는다.
//
// 효과(@effort)는 벗긴다 — cost_logs.model 관례(단가·집계 축은 모델 id, 효과는
// 별도)와 형태를 맞추기 위해서다(형태만 맞춘 것이지 cost_logs 와 조인하지 않는다).

/**
 * 한 스폰 행의 **실제 모델** 추정치. spawnedModel 이 있으면 그 모델 id(효과 벗김),
 * 없으면 하네스로 폴백한다 — 하네스 문자열을 지어내지 않고, 모델도 지어내지 않는다.
 */
export function deriveEffectiveModel(
  harnessModel: string | null | undefined,
  spawnedModel: string | null | undefined,
): string {
  const spawned = typeof spawnedModel === "string" ? spawnedModel.trim() : "";
  if (spawned) {
    const bare = spawned.split("@")[0].trim();
    if (bare) return bare;
  }
  const harness = typeof harnessModel === "string" ? harnessModel.trim() : "";
  return harness || "(none)";
}

/** `getAdminDrilldown` 이 BQ 에서 뽑아 주는 (모델, spawnedModel) 별 카운트 한 줄. */
export type EffectiveModelSourceRow = {
  model?: unknown;
  spawnedModel?: unknown;
  n?: unknown;
};

/**
 * (하네스, spawnedModel) 별 카운트를 **실제 모델**로 접는다. 하네스 축은 이
 * 함수가 건드리지 않는다 — 호출부가 기존 "모델별"(하네스) breakdown 을 그대로
 * 둔 채 이 결과를 **새 행**으로 나란히 추가한다(두 축 다 보존, 티켓 지시).
 * 내림차순 정렬 — 기존 foldDistribution 계열과 같은 계약.
 */
export function foldEffectiveModelDistribution(
  rows: ReadonlyArray<EffectiveModelSourceRow>,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = deriveEffectiveModel(
      typeof r.model === "string" ? r.model : undefined,
      typeof r.spawnedModel === "string" ? r.spawnedModel : undefined,
    );
    const raw = r.n;
    const n = typeof raw === "number" ? raw : Number(raw ?? 0);
    counts.set(key, (counts.get(key) ?? 0) + (Number.isFinite(n) ? n : 0));
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
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

// ═══════════════════════════════════════════════════════════════════════════
// D7/D14 리텐션 + 사용자별 연속사용(스트릭)  — ticket b1L3L2zmL2HFWMo91BVr
//
// 사장님이 D7·D14 를 "매우 중요한 지표" 라고 했는데, 지금까지 이 숫자는 사람이
// BQ 를 직접 쳐야만 나왔다. 여기서 그 계산을 순수 로직으로 내려 화면이 매번
// 같은 정의로 같은 숫자를 뽑게 한다. (BQ 쿼리는 index.ts 의 onCall 담당.)
//
// ── 이 파일이 지키는 3가지 (전부 2026-08-21 실측에서 나온 함정이다) ──────────
//
// 1) ★활동 = "하트비트 존재" 가 아니다.
//    실측에서 어떤 설치는 14일 중 13일 "활동" 으로 잡혔는데, 하트비트 35,170건
//    중 status="working" 이 0건이고 이벤트도 0건이었다 — 35일간 등장한 agentId
//    가 2개뿐인 **좀비 프로세스**다. 하트비트 존재를 세면 이런 게 코호트에
//    들어와 리텐션을 부풀린다.
//    → 활동 = 그날 working 신호 ≥1 **또는** 이벤트 ≥1. 그 정의를 응답에 문자열로
//      실어 화면이 그대로 적게 한다(ACTIVITY_DEFINITION_*).
//
// 2) ★N 을 숨기지 않는다.
//    실측 계정이 5개, 그중 유의미 사용은 2개다. "50%" 라고만 띄우면 사장님이
//    2명짜리 표본에 확신을 갖는다. 그래서 모든 비율은 rate 하나가 아니라
//    {numerator, denominator, rate, display="1/2 (50%)"} 로만 나간다
//    (RetentionCountedRate). 분모 0 이면 rate 는 0 이 아니라 null 이다 —
//    "아무도 안 돌아왔다" 와 "판단할 표본이 없다" 는 다른 말이다.
//    관측창이 아직 안 찬 유닛(가입 3일차에게 D7 을 묻는 것)은 분모에서 빼고
//    pending 으로 따로 센다. 분모에 넣으면 최근 유입이 자동으로 이탈로 찍힌다.
//
// 3) ★2026-06-13 식별자 스킴 교체 경계.
//    그 전 설치 id 는 Firebase uid(28자), 이후는 UUID(36자)다. 실측에서 어떤
//    설치의 "06-13 이탈" 은 이탈이 아니라 **같은 사람의 id 가 바뀐 것**이었다.
//    id 가 다르니 계산이 저절로 끊기는데, 문제는 그 끊김이 화면에서 이탈로
//    보인다는 것이다. → 경계 이전 스킴 유닛을 플래그로 표시하고, 경계에서
//    끊긴 유닛은 suspectedIdSwitchChurn 으로 구분해 이탈로 읽히지 않게 한다.
//    (계산에서 두 id 를 이어붙이지는 않는다 — 근거 없이 같은 사람이라고 단정
//     하는 쪽이 더 위험하다.)
// ═══════════════════════════════════════════════════════════════════════════

/** 설치 식별자 스킴이 Firebase uid(28) → UUID(36) 로 바뀐 날. */
export const IDENTITY_SCHEME_SWITCH_ON = "2026-06-13";

/** 교체 이전 설치 id = Firebase uid 길이. 이후는 UUID(36). */
export const LEGACY_INSTALL_ID_LENGTH = 28;

/** 스트릭 격자 기본 길이(일). */
export const STREAK_GRID_DAYS = 14;

/** 리텐션 축. 두 축은 절대 한 표에 섞지 않는다 — 단위가 다르다. */
export type RetentionAxis = "install" | "account";

/**
 * 축별 "활동" 정의. 화면이 이 문자열을 그대로 적는다 — 정의를 안 적으면 다음
 * 사람이 다르게 읽고, 같은 화면이 다른 숫자로 보인다.
 */
export const ACTIVITY_DEFINITION_INSTALL =
  "활동 = 그날 status=\"working\" 하트비트 ≥1건 **또는** 이벤트 ≥1건. " +
  "하트비트가 떠 있기만 한 날은 활동이 아니다 — 실측에서 하트비트 35,170건 중 " +
  "working 0건·이벤트 0건인 좀비 프로세스가 14일 중 13일 '활동'으로 잡혔다.";

export const ACTIVITY_DEFINITION_ACCOUNT =
  "활동 = 그날 cost_logs 에 과금된 모델 호출 ≥1건. 계정 축에는 하트비트가 없어 " +
  "좀비 문제가 발생하지 않는다(호출 기록 자체가 실사용의 증거다).";

export function activityDefinitionFor(axis: RetentionAxis): string {
  return axis === "install"
    ? ACTIVITY_DEFINITION_INSTALL
    : ACTIVITY_DEFINITION_ACCOUNT;
}

/** 격자 기호 범례 — 화면과 계산이 같은 문자를 쓰게 한다. */
export const STREAK_GRID_LEGEND =
  "x = 활동(정의 충족) · ~ = 하트비트만 있고 활동 아님 · . = 아무 신호 없음";

// ── 날짜 유틸(UTC, 순수) ─────────────────────────────────────────────────────
// BQ 는 DATE 를 'YYYY-MM-DD' 로 준다. 여기서는 문자열↔일련번호 변환만 한다.

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → epoch 기준 일련번호. 형식이 아니면 null. */
export function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / MS_PER_DAY);
}

/** 일련번호 → 'YYYY-MM-DD'. */
export function dayString(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 두 날짜 사이 일수(b - a). 형식 오류면 null. */
export function daysBetween(a: string, b: string): number | null {
  const na = dayNumber(a);
  const nb = dayNumber(b);
  return na == null || nb == null ? null : nb - na;
}

// ── 안정 라벨 ────────────────────────────────────────────────────────────────
// ★원시 식별자(uid/UUID/이메일)는 응답에도 화면에도 절대 나가지 않는다. 대신
// 결정적 해시 접두를 쓴다. 순번이 아니라 해시인 이유는 **다음 조회에서도 같은
// 사람이 같은 라벨**이어야 시계열 추적이 되기 때문이다 — 순번은 조회 창이
// 바뀌거나 신규 유닛이 끼면 통째로 밀린다.
//
// 라벨 규칙은 고정이다. 바꾸면 과거 스크린샷·메모와 대조가 불가능해지므로,
// 규칙을 바꿔야 할 땐 VERSION 을 올려 "다른 규칙" 임을 명시적으로 드러낸다.
export const ANALYTICS_LABEL_VERSION = "v1";

const LABEL_PREFIX: Record<RetentionAxis, string> = {
  install: "I",
  account: "A",
};

/**
 * 원시 식별자 → 안정 라벨(예: "I-3f9a1c").
 *
 * 같은 (version, axis, raw) 면 언제 어디서 불러도 같은 값이다. 역산은 원시
 * 식별자 후보 목록을 이미 가진 쪽만 가능한데, 이 응답을 받는 쪽은 requireAdmin
 * 을 통과한 운영자뿐이라 그 경로로 새로 새는 정보는 없다.
 */
export function analyticsUnitLabel(axis: RetentionAxis, raw: string): string {
  const digest = createHash("sha256")
    .update(`${ANALYTICS_LABEL_VERSION}:${axis}:${raw}`)
    .digest("hex")
    .slice(0, 6);
  return `${LABEL_PREFIX[axis]}-${digest}`;
}

// ── 입력 shape ───────────────────────────────────────────────────────────────

/**
 * (유닛 × 날짜) 활동 집계 한 줄. index.ts 가 BQ 에서 이 모양으로 뽑아 준다.
 *
 * `unit` 은 **원시 식별자**다 — 여기서 라벨로 바꾸고 밖으로는 내보내지 않는다.
 * 신호 3종의 의미는 축마다 다르다:
 *   - install : workingSignals=status="working" 하트비트 수 /
 *               presenceSignals=전체 하트비트 수 / eventSignals=events 행 수
 *   - account : workingSignals=presenceSignals=과금 호출 수 / eventSignals=0
 */
export type UnitDayActivityRow = {
  unit?: unknown;
  date?: unknown;
  workingSignals?: unknown;
  presenceSignals?: unknown;
  eventSignals?: unknown;
};

/** 설치 ↔ 계정 조인 후보 한 줄(agentId 다리). */
export type InstallAccountMappingRow = {
  installUnit?: unknown;
  accountUnit?: unknown;
  joins?: unknown;
};

export type StreakRetentionInput = {
  axis: RetentionAxis;
  /** 'YYYY-MM-DD'(UTC). 호출측이 주입한다 — 순수 함수를 시계에 묶지 않는다. */
  today: string;
  rows: ReadonlyArray<UnitDayActivityRow>;
  /**
   * 코호트 창(일). 첫 활동일이 최근 N일 안인 유닛만 D7/D14 코호트에 넣는다.
   * 창 밖에서 시작한 유닛은 조용히 빼지 않고 unitsBeforeWindow 로 센다.
   */
  cohortWindowDays: number;
  /**
   * 운영자로 판정된 원시 unit 들. includeAdmin=true 면 호출측이 빈 배열을 준다
   * (제외 안 함). 설치 축에서는 agentId 다리로 역추적한 목록이라 완전하지 않다 —
   * 그 불완전성은 mapping.unmappedInstalls 로 화면에 드러난다.
   */
  adminUnits?: ReadonlyArray<string>;
  /** 설치→계정 조인 후보(설치 축에서만 의미 있다). */
  mappingRows?: ReadonlyArray<InstallAccountMappingRow>;
  /** 격자 길이(기본 STREAK_GRID_DAYS). */
  gridDays?: number;
};

// ── 출력 shape ───────────────────────────────────────────────────────────────

/**
 * ★비율은 절대 홀로 나가지 않는다. 분자·분모를 항상 달고 다닌다.
 * display 는 화면이 그대로 찍을 수 있는 "1/2 (50%)" 문자열이다.
 */
export type RetentionCountedRate = {
  numerator: number;
  denominator: number;
  /** 분모 0 이면 null — 0% 가 아니다. */
  rate: number | null;
  display: string;
};

export function countedRate(
  numerator: number,
  denominator: number,
): RetentionCountedRate {
  const rate = denominator > 0 ? numerator / denominator : null;
  const pct = rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
  return {
    numerator,
    denominator,
    rate,
    display: `${numerator}/${denominator} (${pct})`,
  };
}

export type RetentionHorizonKey = "d1" | "d7" | "d14" | "d30";

/**
 * 한 지평(D7 등)의 결과.
 *
 * ★두 정의를 **둘 다** 낸다. 업계에 두 정의가 다 쓰이고, 하나만 내면 다음
 * 사람이 다르게 읽는다. 표본이 작을수록 둘의 차이가 커서 어느 쪽을 골랐는지가
 * 결론을 바꾼다 — 그래서 고르지 않고 나란히 보여 준다.
 *   - exact  : 첫 활동일 + N일 **당일**에 활동 (bracket/classic 정의)
 *   - window : 첫 활동일 다음날 ~ +N일 **사이 하루라도** 활동 (rolling/range 정의)
 */
export type StreakRetentionHorizon = {
  key: RetentionHorizonKey;
  days: number;
  /** 아직 D+N 일이 오지 않아 판정 불가한 유닛 수. 분모에서 뺀다. */
  pending: number;
  exact: RetentionCountedRate;
  window: RetentionCountedRate;
};

export type StreakUnitMappingStatus =
  | "mapped"
  | "ambiguous"
  | "unmapped"
  | "n/a";

export type StreakUnit = {
  /** 안정 라벨. 원시 식별자는 여기 없다. */
  label: string;
  axis: RetentionAxis;
  /** 첫 "활동" 일. 활동이 한 번도 없으면 null(=좀비). */
  firstActive: string | null;
  lastActive: string | null;
  /** 활동 정의를 충족한 날 수. */
  activeDays: number;
  /** working 신호가 있던 날 수. */
  workingDays: number;
  /** 어떤 신호든(하트비트 포함) 있던 날 수. activeDays 와 벌어지면 좀비 신호다. */
  presentDays: number;
  maxStreak: number;
  /** 오늘/어제까지 이어진 연속일. 끊겼으면 0 — 과거 연속은 maxStreak 에 있다. */
  currentStreak: number;
  daysSinceLastActive: number | null;
  /** 최근 gridDays 일 격자. STREAK_GRID_LEGEND 참조. */
  grid: string;
  gridStart: string;
  gridEnd: string;
  /**
   * ★격자 구간에서 하트비트만 있고 활동이 0 — 사용자가 아니라 떠 있는 프로세스.
   *
   * 판정을 **격자 구간(최근 gridDays)** 으로 잡는 이유: 실측의 그 설치는 전 기간
   * 으로 보면 7월에 활동한 날이 며칠 있었고, 최근 35일이 순수 좀비였다. 평생
   * 기준으로 재면 "좀비 0" 이라고 뜨는데 격자에는 좀비가 13칸 그려진다 — 헤드라인
   * 숫자와 눈에 보이는 격자가 어긋나면 헤드라인 쪽을 믿게 된다. 화면이 보여주는
   * 구간과 같은 구간으로 센다.
   *
   * ★이 플래그는 설명용이다. 코호트 제외는 이 플래그가 아니라 활동 정의 자체가
   * 한다(하트비트만 있는 날은 애초에 활동일이 아니다) — 플래그를 지워도 숫자는
   * 부풀지 않는다.
   */
  zombie: boolean;
  /** 운영자로 판정돼 코호트에서 빠진 유닛. */
  adminExcluded: boolean;
  /** 2026-06-13 이전 식별자 스킴(Firebase uid 28자)으로 만들어진 유닛. */
  legacyIdScheme: boolean;
  /**
   * ★경계에서 끊긴 구 스킴 유닛. 이 "이탈" 은 이탈이 아니라 id 교체일 가능성이
   * 높다 — 실측에서 실제로 그랬다. 이탈 근거로 쓰면 안 된다.
   */
  suspectedIdSwitchChurn: boolean;
  /** 코호트 창(cohortWindowDays) 안에서 시작했는가. */
  inCohortWindow: boolean;
  /** 설치→계정 매핑(설치 축에서만). 못 붙였으면 null + status 로 밝힌다. */
  mappedAccountLabel: string | null;
  mappingStatus: StreakUnitMappingStatus;
};

export type InstallAccountMappingSummary = {
  /** 계정에 붙은 설치 수. */
  mappedInstalls: number;
  /** 여러 계정에 걸쳐 모호한 설치 수(우세 계정으로 표시하되 플래그를 남긴다). */
  ambiguousInstalls: number;
  /** ★못 붙인 설치 수. 조용히 빼면 인원이 줄어 보인다 — 세어서 화면에 남긴다. */
  unmappedInstalls: number;
  note: string;
};

export type IdentitySchemeBoundary = {
  date: string;
  /** 구 스킴(uid 28자) 유닛 수. */
  legacyUnits: number;
  /** 신 스킴(UUID) 유닛 수. */
  currentUnits: number;
  /** 경계에서 끊긴 구 스킴 유닛 수 — 이탈로 읽으면 안 되는 것들. */
  suspectedIdSwitchChurn: number;
  note: string;
};

export type StreakRetentionAxisResult = {
  axis: RetentionAxis;
  activityDefinition: string;
  gridLegend: string;
  gridDays: number;
  cohortWindowDays: number;
  /** 관측된 전체 유닛 수(좀비·운영자·창 밖 전부 포함). */
  unitsObserved: number;
  /** 격자 구간에서 하트비트만 있고 활동이 0 인 유닛 수. */
  unitsZombie: number;
  /** 운영자로 판정돼 빠진 유닛 수. */
  unitsAdminExcluded: number;
  /** 코호트 창보다 먼저 시작해 코호트에서 빠진 유닛 수. */
  unitsBeforeWindow: number;
  /** 최종 코호트 모수. ★모든 비율의 분모 뿌리다. */
  unitsCohort: number;
  horizons: StreakRetentionHorizon[];
  /** 스트릭 격자 — 좀비·운영자도 플래그를 달고 전부 들어온다(숨기지 않는다). */
  units: StreakUnit[];
  identityScheme: IdentitySchemeBoundary;
  mapping: InstallAccountMappingSummary | null;
  /** 화면이 그대로 적어야 하는 경고들. */
  notes: string[];
};

const HORIZON_DAYS: ReadonlyArray<{ key: RetentionHorizonKey; days: number }> = [
  { key: "d1", days: 1 },
  { key: "d7", days: 7 },
  { key: "d14", days: 14 },
  { key: "d30", days: 30 },
];

type UnitAccumulator = {
  raw: string;
  /** dayNumber → 신호 합계 */
  byDay: Map<number, { working: number; presence: number; events: number }>;
};

function foldUnitDays(
  rows: ReadonlyArray<UnitDayActivityRow>,
): Map<string, UnitAccumulator> {
  const units = new Map<string, UnitAccumulator>();
  for (const row of rows) {
    const raw = coerceStr(row.unit);
    const date = coerceStr(row.date);
    if (raw === "" || raw === "anon") continue;
    const dn = dayNumber(date);
    if (dn == null) continue;
    let acc = units.get(raw);
    if (!acc) {
      acc = { raw, byDay: new Map() };
      units.set(raw, acc);
    }
    const cur = acc.byDay.get(dn) ?? { working: 0, presence: 0, events: 0 };
    cur.working += coerceNumber(row.workingSignals);
    cur.presence += coerceNumber(row.presenceSignals);
    cur.events += coerceNumber(row.eventSignals);
    acc.byDay.set(dn, cur);
  }
  return units;
}

/**
 * 설치→계정 매핑을 접는다. 한 설치가 여러 계정에 걸리면 조인 수가 가장 많은
 * 계정을 쓰되 ambiguous 로 표시한다 — 조용히 하나를 고르면 그게 사실처럼 보인다.
 */
function foldInstallAccountMapping(
  rows: ReadonlyArray<InstallAccountMappingRow>,
): Map<string, { account: string; ambiguous: boolean }> {
  const byInstall = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const installUnit = coerceStr(row.installUnit);
    const accountUnit = coerceStr(row.accountUnit);
    if (installUnit === "" || accountUnit === "") continue;
    const joins = Math.max(1, coerceNumber(row.joins));
    const bucket = byInstall.get(installUnit) ?? new Map<string, number>();
    bucket.set(accountUnit, (bucket.get(accountUnit) ?? 0) + joins);
    byInstall.set(installUnit, bucket);
  }
  const out = new Map<string, { account: string; ambiguous: boolean }>();
  for (const [installUnit, bucket] of byInstall) {
    const ranked = Array.from(bucket.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const top = ranked[0];
    if (!top) continue;
    out.set(installUnit, { account: top[0], ambiguous: ranked.length > 1 });
  }
  return out;
}

/** 정렬된 일련번호 배열에서 최대 연속 길이와 마지막 연속 길이를 구한다. */
function streaksOf(sortedDays: number[]): { max: number; last: number } {
  if (sortedDays.length === 0) return { max: 0, last: 0 };
  let max = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i += 1) {
    run = sortedDays[i] === sortedDays[i - 1] + 1 ? run + 1 : 1;
    if (run > max) max = run;
  }
  return { max, last: run };
}

/**
 * D7/D14 리텐션 + 스트릭 격자를 한 축에 대해 만든다.
 *
 * 순수 함수다 — 시계도, BQ 도, Firestore 도 건드리지 않는다. `today` 는 반드시
 * 주입받는다(테스트가 시계에 흔들리면 이런 지표는 검증할 수 없다).
 */
export function buildStreakRetention(
  input: StreakRetentionInput,
): StreakRetentionAxisResult {
  const { axis } = input;
  const gridDays = Math.max(1, Math.floor(input.gridDays ?? STREAK_GRID_DAYS));
  const cohortWindowDays = Math.max(1, Math.floor(input.cohortWindowDays));
  const todayNum = dayNumber(input.today);
  const switchNum = dayNumber(IDENTITY_SCHEME_SWITCH_ON);
  const adminSet = new Set(input.adminUnits ?? []);
  const mapping =
    axis === "install"
      ? foldInstallAccountMapping(input.mappingRows ?? [])
      : new Map<string, { account: string; ambiguous: boolean }>();

  const folded = foldUnitDays(input.rows);

  // 라벨 충돌은 사실상 없지만(6 hex), 생겨도 결정적으로 갈라야 다음 조회에서
  // 같은 라벨이 유지된다 — 원시값 정렬 순서로 접미사를 붙인다.
  const labelBuckets = new Map<string, string[]>();
  for (const raw of Array.from(folded.keys()).sort()) {
    const base = analyticsUnitLabel(axis, raw);
    const bucket = labelBuckets.get(base) ?? [];
    bucket.push(raw);
    labelBuckets.set(base, bucket);
  }
  const labelOf = new Map<string, string>();
  for (const [base, raws] of labelBuckets) {
    raws.forEach((raw, i) => {
      labelOf.set(raw, i === 0 ? base : `${base}#${i + 1}`);
    });
  }

  // 지평 판정에 쓸 유닛별 활동일 집합/첫 활동일. StreakUnit 에는 원시 일련번호를
  // 싣지 않으므로(응답 shape 를 얇게 유지) 계산 중에만 옆에 들고 간다.
  const unitActiveSets = new Map<string, Set<number>>();
  const unitFirstNums = new Map<string, number | null>();

  const units: StreakUnit[] = [];
  for (const acc of folded.values()) {
    const days = Array.from(acc.byDay.keys()).sort((a, b) => a - b);
    // ★활동 정의는 여기 한 곳에만 있다. 하트비트 존재는 활동이 아니다.
    const activeDays = days.filter((d) => {
      const s = acc.byDay.get(d);
      return s != null && (s.working >= 1 || s.events >= 1);
    });
    const workingDays = days.filter(
      (d) => (acc.byDay.get(d)?.working ?? 0) >= 1,
    );
    const presentDays = days.filter((d) => {
      const s = acc.byDay.get(d);
      return s != null && (s.working >= 1 || s.events >= 1 || s.presence >= 1);
    });

    const activeSet = new Set(activeDays);
    const firstNum = activeDays.length > 0 ? activeDays[0] : null;
    const lastNum =
      activeDays.length > 0 ? activeDays[activeDays.length - 1] : null;
    const { max: maxStreak, last: lastRun } = streaksOf(activeDays);
    const daysSinceLastActive =
      lastNum != null && todayNum != null ? todayNum - lastNum : null;
    // 끊긴 연속을 "현재 연속" 으로 부르지 않는다. 부분 집계된 오늘 때문에
    // 어제까지는 살아 있는 것으로 본다.
    const currentStreak =
      daysSinceLastActive != null && daysSinceLastActive <= 1 ? lastRun : 0;

    const gridEndNum = todayNum ?? lastNum ?? 0;
    const gridStartNum = gridEndNum - (gridDays - 1);
    let grid = "";
    for (let d = gridStartNum; d <= gridEndNum; d += 1) {
      const s = acc.byDay.get(d);
      if (s != null && (s.working >= 1 || s.events >= 1)) grid += "x";
      else if (s != null && s.presence >= 1) grid += "~";
      else grid += ".";
    }
    // 좀비 판정은 화면이 보여주는 격자와 **같은 구간**으로 잰다(위 필드 주석 참조).
    const zombie = grid.includes("~") && !grid.includes("x");

    const legacyIdScheme =
      axis === "install" && acc.raw.length === LEGACY_INSTALL_ID_LENGTH;
    const suspectedIdSwitchChurn =
      legacyIdScheme &&
      lastNum != null &&
      switchNum != null &&
      lastNum <= switchNum;

    const inCohortWindow =
      firstNum != null &&
      todayNum != null &&
      todayNum - firstNum <= cohortWindowDays;

    const mapped = mapping.get(acc.raw);
    const mappingStatus: StreakUnitMappingStatus =
      axis !== "install"
        ? "n/a"
        : mapped == null
          ? "unmapped"
          : mapped.ambiguous
            ? "ambiguous"
            : "mapped";

    units.push({
      label: labelOf.get(acc.raw) ?? analyticsUnitLabel(axis, acc.raw),
      axis,
      firstActive: firstNum == null ? null : dayString(firstNum),
      lastActive: lastNum == null ? null : dayString(lastNum),
      activeDays: activeDays.length,
      workingDays: workingDays.length,
      presentDays: presentDays.length,
      maxStreak,
      currentStreak,
      daysSinceLastActive,
      grid,
      gridStart: dayString(gridStartNum),
      gridEnd: dayString(gridEndNum),
      zombie,
      adminExcluded: adminSet.has(acc.raw),
      legacyIdScheme,
      suspectedIdSwitchChurn,
      inCohortWindow,
      mappedAccountLabel:
        mapped == null ? null : analyticsUnitLabel("account", mapped.account),
      mappingStatus,
    });

    // 지평 판정용 활동 집합을 유닛에 잠시 붙여 둘 필요 없이, 아래에서 다시 쓴다.
    unitActiveSets.set(units[units.length - 1].label, activeSet);
    unitFirstNums.set(units[units.length - 1].label, firstNum);
  }

  // 정렬: 최근 활동 우선 → 최대연속 → 라벨(결정적).
  units.sort(
    (a, b) =>
      (a.daysSinceLastActive ?? 9_999) - (b.daysSinceLastActive ?? 9_999) ||
      b.maxStreak - a.maxStreak ||
      a.label.localeCompare(b.label),
  );

  // ── 코호트 구성 ────────────────────────────────────────────────────────────
  // 좀비(활동 0)는 활동 정의 자체로 이미 걸러진다 — firstActive 가 null 이다.
  // 운영자 제외와 창 밖 유닛은 세어서 밖으로 내보낸다(조용히 빼지 않는다).
  const unitsZombie = units.filter((u) => u.zombie).length;
  const unitsAdminExcluded = units.filter((u) => u.adminExcluded).length;
  const cohortCandidates = units.filter(
    (u) => u.firstActive != null && !u.adminExcluded,
  );
  const unitsBeforeWindow = cohortCandidates.filter(
    (u) => !u.inCohortWindow,
  ).length;
  const cohort = cohortCandidates.filter((u) => u.inCohortWindow);

  const horizons: StreakRetentionHorizon[] = HORIZON_DAYS.map(
    ({ key, days }) => {
      let pending = 0;
      let exactNum = 0;
      let exactDen = 0;
      let windowNum = 0;
      let windowDen = 0;
      for (const u of cohort) {
        const firstNum = unitFirstNums.get(u.label);
        const activeSet = unitActiveSets.get(u.label);
        if (firstNum == null || activeSet == null || todayNum == null) continue;
        // ★관측창 미도달은 분모에 넣지 않는다. 넣으면 최근 유입이 자동 이탈이 된다.
        if (todayNum - firstNum < days) {
          pending += 1;
          continue;
        }
        exactDen += 1;
        windowDen += 1;
        if (activeSet.has(firstNum + days)) exactNum += 1;
        for (let d = firstNum + 1; d <= firstNum + days; d += 1) {
          if (activeSet.has(d)) {
            windowNum += 1;
            break;
          }
        }
      }
      return {
        key,
        days,
        pending,
        exact: countedRate(exactNum, exactDen),
        window: countedRate(windowNum, windowDen),
      };
    },
  );

  const legacyUnits = units.filter((u) => u.legacyIdScheme).length;
  const identityScheme: IdentitySchemeBoundary = {
    date: IDENTITY_SCHEME_SWITCH_ON,
    legacyUnits,
    currentUnits: units.length - legacyUnits,
    suspectedIdSwitchChurn: units.filter((u) => u.suspectedIdSwitchChurn)
      .length,
    note:
      `★${IDENTITY_SCHEME_SWITCH_ON} 에 설치 식별자 스킴이 Firebase uid(28자) → ` +
      "UUID(36자) 로 바뀌었다. 이 경계를 넘겨 이어붙이면 **같은 사람이 이탈한 것처럼** " +
      "보인다 — 실측에서 실제로 그렇게 보였다. 경계 이전 유닛은 따로 표시하고, " +
      "두 id 를 같은 사람으로 잇지는 않는다(근거 없이 동일인이라 단정하는 쪽이 더 위험하다).",
  };

  const mappingSummary: InstallAccountMappingSummary | null =
    axis === "install"
      ? {
          mappedInstalls: units.filter((u) => u.mappingStatus === "mapped")
            .length,
          ambiguousInstalls: units.filter(
            (u) => u.mappingStatus === "ambiguous",
          ).length,
          unmappedInstalls: units.filter((u) => u.mappingStatus === "unmapped")
            .length,
          note:
            "설치→계정은 agent_heartbeats.agentId ↔ cost_logs.agentId 조인으로만 " +
            "붙는다. ★2026-08 부터 익명 세계의 agentId 는 HMAC 가명이라 그 조인이 " +
            "성립하지 않는다 — 즉 이 다리는 가명화 이전 과거 row 에서만 걸리고, " +
            "시간이 지날수록 '매핑 불가' 가 늘어난다. 못 붙인 설치를 빼지 않고 " +
            "세어서 보여주는 이유다(조용히 빼면 인원이 줄어 보인다).",
        }
      : null;

  const notes: string[] = [activityDefinitionFor(axis)];
  notes.push(
    "★비율은 언제나 분자/분모와 함께 읽어라. 표본이 한 자릿수라 퍼센트 하나만 " +
      "보면 실제보다 훨씬 강한 결론이 된다 — 분모 0 이면 0% 가 아니라 '—'(판단 불가)다.",
  );
  notes.push(
    "D7/D14 는 두 정의를 나란히 낸다. exact = 첫 활동일 +N일 **당일** 활동, " +
      "window = 첫 활동일 다음날부터 +N일 **사이 하루라도** 활동. 표본이 작을수록 " +
      "두 값이 크게 벌어지므로 어느 쪽을 인용하는지 반드시 같이 말해야 한다.",
  );
  notes.push(
    `관측창이 아직 안 찬 유닛은 분모에서 빼고 pending 으로 센다 — 가입 3일차에게 ` +
      "D7 을 물으면 무조건 이탈로 찍히기 때문이다.",
  );
  if (axis === "install") {
    notes.push(
      "설치 축의 운영자 제외는 agentId 다리로 역추적한 것이라 완전하지 않다. " +
        "매핑 불가 설치는 운영자인지 아닌지 판정할 수 없어 그대로 남는다 — " +
        "그만큼 이 축은 운영자 도그푸드 쪽으로 낙관 편향될 수 있다.",
    );
  } else {
    notes.push(
      "계정 축의 유일한 소스는 cost_logs.userId 다. events.metadata.accountUserId " +
        "는 5일치 uid 1개뿐이라 쓰지 않는다. " +
        EVENTS_ACCOUNT_AXIS_NOTE,
    );
  }

  return {
    axis,
    activityDefinition: activityDefinitionFor(axis),
    gridLegend: STREAK_GRID_LEGEND,
    gridDays,
    cohortWindowDays,
    unitsObserved: units.length,
    unitsZombie,
    unitsAdminExcluded,
    unitsBeforeWindow,
    unitsCohort: cohort.length,
    horizons,
    units,
    identityScheme,
    mapping: mappingSummary,
    notes,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ★베타 종료 판단용 KPI 스코어카드 (티켓 6jeXDBQ1xoH0FoXwjqAL)
// ════════════════════════════════════════════════════════════════════════════
//
// 사장님이 요구하신 것은 "11개 지표를 목표치와 나란히 한눈에" 다. 이 모듈은 그
// **그릇**을 만든다 — 지금 숫자가 한 자릿수인 것은 알고 계시고, 숫자가 작다는
// 이유로 지표를 빼지 않는 것이 요구사항이다.
//
// ── ★이 파일에서 가장 중요한 사실: 축이 둘이고, 섞으면 안 된다 ──────────────
//
// 티켓 본문과 그 정정 지시가 **둘 다** "task_outcomes 는 사람 축" 이라고 적었다.
// 프로덕션 BQ 실측 결과 그것은 사실이 아니다:
//
//   SELECT LENGTH(userId), COUNT(DISTINCT userId) FROM task_outcomes
//     → {36, 7}                      ← 전부 uuid36 = 익명 **설치** ID
//   analytics_account_profile.user_key → LENGTH 28   ← 계정 uid 는 28자다
//
// 코드도 같은 말을 한다(index.ts 익명축 소스 쿼리 주석):
//   "★install_key = events/agent_heartbeats/task_outcomes 의 `userId` 다.
//    이 컬럼은 계정 uid 가 **아니라** 클라이언트가 보낸 익명 설치 ID(clientId)다."
//
// 결정적 증거: `analytics_user_daily`(설치 축)로 같은 정의의 누적창 리텐션을
// 돌리면 task_outcomes 로 뽑은 값이 **한 자리도 안 틀리고 재현된다**
// (코호트 7 / D7 3 / D14 4 / D30 3, 분모 6). 같은 숫자가 나오는 이유는 같은
// 축이기 때문이다. "42 vs 7" 은 두 축의 차이가 아니라 "이벤트를 보낸 설치 44대
// 중 실제 task 를 한 설치가 7대" 라는 **같은 축 안의 부분집합**이다.
//
// ★그럼 사람 축은 없나 — 있다. `personAxis.ts` + `marblo_identity` 의
//   `v_person_since_link` 가 그것이고, 게이트가 열려 있다. 다만 오늘 커버리지가
//   **사람 2명**이고 그중 task 를 한 번이라도 한 사람이 **1명**이다. 분모 1에서
//   D7/D14/D30 은 비율이 아니라 동전 던지기다.
//
// ── 그래서 이 스코어카드가 하는 일 ─────────────────────────────────────────
//  1) 두 축을 **라벨로 갈라 병기**한다. 한 숫자로 합치지 않는다.
//  2) 사람 축은 **원수만** 낸다(비율 금지). 설치 축만 곡선을 그린다.
//  3) 모든 비율이 분자·분모를 달고 다닌다(countedRate 규약 계승).
//  4) 측정 불가능한 지표를 0 으로 그리지 않는다 — 사유를 들고 다닌다.
//
// ★계측을 늘렸다고 게이지가 좋아지면 안 된다(KPI_RETENTION_EXCLUDED_EVENTS 와
//   같은 규율). 이 스코어카드의 리텐션 분자는 `tasks_completed > 0` **하나**다 —
//   이벤트 종류가 늘어도 움직이지 않는다. 그게 이 정의를 고른 이유이기도 하다
//   (사장님 정의 "7일 후 다시 **실제 Task 수행**" 과도 이쪽이 맞는다).

/** 스코어카드 지표가 사는 축. 축이 다른 두 값을 더하거나 비교하면 안 된다. */
export type ScorecardAxis =
  /** 익명 설치 축(analytics_user_daily). 한 사람이 두 기기면 2로 센다. */
  | "install"
  /** 사람 축(marblo_identity.v_person_since_link). 커버리지가 아직 얇다. */
  | "person"
  /** 계정 축(Firestore subscriptions). 값은 다른 봉투에서 온다. */
  | "account"
  /** 텔레메트리에 없는 사실(계약·영업). 자동 측정 불가. */
  | "manual";

/** 지표의 단위. rate 는 분모 없이 그리면 안 된다. */
export type ScorecardUnit = "count" | "rate";

/**
 * 지표 한 칸.
 *
 * ★`value` 는 절대 홀로 나가지 않는다. rate 면 `counted` 가 분자·분모를 달고
 * 오고, 측정 불가면 `value=null` + `unmeasuredReason` 이 온다. 0 은 "측정했는데
 * 0" 일 때만 쓴다 — 측정 안 한 것을 0 으로 그리는 게 이 화면 최대의 실패다.
 */
export type ScorecardMetric = {
  key: string;
  label: string;
  /** 사장님이 말씀하신 정의 그대로. 화면이 이 문장을 띄운다. */
  definition: string;
  /** 우리가 실제로 무엇을 셌는가 — 정의와 다르면 그 차이가 여기 드러난다. */
  measuredAs: string;
  axis: ScorecardAxis;
  unit: ScorecardUnit;
  /** count 면 원수, rate 면 0~1 비율. 측정 불가/분모 0 이면 null. */
  value: number | null;
  /** rate 지표의 분자·분모. count 지표는 null. */
  counted: RetentionCountedRate | null;
  /** 2026년 말 목표 하한. 달성률의 분모다. */
  targetMin: number;
  /** 2026년 말 목표 상한(범위가 아니면 targetMin 과 같다). */
  targetMax: number;
  /** Seed 기준(참고치). 없으면 null. */
  seedMin: number | null;
  /** 목표 하한 대비 달성률(0~1+). 측정 불가면 null. ★1.0 을 넘길 수 있다. */
  attainment: number | null;
  /** 목표 하한까지 남은 양. count 면 원수, rate 면 비율차. 넘었으면 0. */
  remaining: number | null;
  /** 목표 하한 도달 여부. 측정 불가면 false(달성이 아니라 미상이다). */
  met: boolean;
  /** 자동 측정이 되는 지표인가. false 면 value 는 반드시 null 이다. */
  measurable: boolean;
  /** measurable=false 인 이유. measurable=true 면 null. */
  unmeasuredReason: string | null;
  /**
   * 값이 이 응답이 아니라 **다른 봉투**에서 오는 지표(축이 달라 여기서 세면
   * 정의가 두 벌이 된다). 프론트가 이 좌표로 채운다.
   */
  externalSource: string | null;
};

/** 사장님이 못 박으신 최중요 지표. 화면이 이걸 가장 크게 그린다. */
export const SCORECARD_HERO_KEY = "d30_retention";

/**
 * ★비율에 이 분모 이하면 곡선을 믿지 마라. 화면 상수(SMALL_SAMPLE_MAX)와 같은
 * 값이고, 서버가 판정해 내려보내야 화면 두 곳이 갈라지지 않는다.
 */
export const SCORECARD_SMALL_SAMPLE_MAX = 10;

export type BetaScorecardInput = {
  /**
   * ── 설치 축(analytics_user_daily) 스칼라 ──
   *
   * ★쿼리가 실패하면 **null 을 넣어라.** 빈 행을 넣으면 전부 0 이 되고, 화면은
   * 그 0 을 "측정했더니 0" 으로 읽는다 — 조회 실패를 제품 실패로 그리는 것이라
   * 이 화면 최대의 실패 모드다(사람 축 규약과 같다).
   */
  install: {
    /**
     * 활동일이 하루라도 있는 설치 수(전 기간).
     * ★Qualified Beta 가 **아니다.** 사장님 정의는 '신청하고 우리가 승인한 사람'
     * (계정 축)이라 이 수는 그 지표의 분자도 분모도 아니다 — 참고 맥락으로만 쓴다.
     */
    activeInstalls: unknown;
    /** ★Activated 정본 — 누적 완료 task ≥ 3 인 설치 수(사장님 최종 확정). */
    activatedInstalls: unknown;
    /**
     * ★첫 스폰을 한 설치 수 — **광고 최적화용 선행지표**.
     * Activated 가 아니다. 역할이 다르다: 광고는 빠른 신호가 필요한데
     * 클릭→3 Task 는 며칠 걸려 캠페인을 못 돌린다. 스폰은 설치 당일 찍힌다.
     */
    firstSpawnInstalls: unknown;
    /** 조회 창의 완료 task 총량. */
    monthlyTasks: unknown;
    /** 최근 4주 안에 '주 3일+ 또는 주 10 task+' 를 한 번이라도 만족한 설치 수. */
    powerUsers: unknown;
    /** D7/D14/D30 코호트(= 판정 가능한 설치 수)와 재수행 설치 수. */
    d7Cohort: unknown;
    d7Retained: unknown;
    d14Cohort: unknown;
    d14Retained: unknown;
    d30Cohort: unknown;
    d30Retained: unknown;
    /** 아직 D+30 이 오지 않아 분모에서 뺀 설치 수. 화면이 이걸 말한다. */
    d30Pending: unknown;
  } | null;
  /** install 이 null 인 이유(쿼리 실패). null 이면 정상. */
  installUnavailableReason?: string | null;
  /** ── 사람 축(v_person_since_link) 원수. 비율로 접지 않는다 ── */
  person: {
    /** 링크가 닿은 사람 수. */
    linkedPeople: unknown;
    /** 그중 완료 task 가 1건 이상인 사람 수. */
    peopleWithTask: unknown;
    /** 그중 조회 창에 활동일이 있는 사람 수. */
    activePeople: unknown;
  } | null;
  /** person 이 null 인 이유(게이트 닫힘/쿼리 실패). null 이면 정상. */
  personUnavailableReason?: string | null;
};

export type BetaScorecardResult = {
  metrics: ScorecardMetric[];
  /**
   * ★KPI 가 **아닌** 선행지표. 베타 종료·Seed 판단에 쓰지 않는다.
   *
   * 11개 지표와 한 격자에 섞지 않는 이유: 섞는 순간 누가 "Activated 가 18이네"
   * 로 읽는다. 목표치도 붙이지 않는다 — 목표를 붙이는 순간 KPI 가 된다.
   */
  leadingIndicators: ScorecardMetric[];
  /** 가장 크게 그릴 지표의 key. */
  heroKey: string;
  /** 사람 축 원수(비율 없음). 게이트가 닫혔거나 실패면 null. */
  personAxisCounts: {
    linkedPeople: number;
    peopleWithTask: number;
    activePeople: number;
  } | null;
  personUnavailableReason: string | null;
  /** 설치 축 조회가 실패했을 때의 사유. 정상이면 null. */
  installUnavailableReason: string | null;
  smallSampleMax: number;
  /** 화면 머리에 그대로 찍는 축 경고. */
  axisNote: string;
  note: string;
};

/** ★축 경고. 이 문장이 화면에 없으면 숫자가 거짓말이 된다. */
export const SCORECARD_AXIS_NOTE =
  "이 표의 지표는 **익명 설치 축**입니다(analytics_user_daily). 한 사람이 두 " +
  "기기에 깔면 2로 세고, 한 기기를 두 계정이 쓰면 1로 합칩니다 — 사장님 지표의 " +
  "단위인 '사람 수'가 아닙니다. 진짜 사람 축(marblo_identity.v_person_since_link)은 " +
  "아래 별도 블록에 **원수만** 적었습니다: 커버리지가 아직 얇아 그 분모로 비율을 " +
  "그리면 한 명이 움직일 때마다 수십 %p 가 흔들립니다. ★두 블록의 숫자를 더하거나 " +
  "서로 비교하지 마세요. 축이 다릅니다.";

/** ★운영자 제외가 이 축에서 구조적으로 불가능하다는 사실. 숨기지 않는다. */
export const SCORECARD_ADMIN_EXCLUSION_NOTE =
  "★운영자 제외(includeAdmin) 토글이 이 표에는 **적용되지 않습니다.** 익명축 " +
  "테이블(analytics_user_daily / analytics_install_profile)에는 is_admin 컬럼이 " +
  "없고, 계정축(analytics_account_profile)과의 조인은 축 분리 규약이 금지합니다" +
  "(assertAxisPurity 가 스키마로 막습니다). 처리방침이 이미 고지한 대가입니다 — " +
  "'운영자 본인 활동 제외는 포기했습니다'. 따라서 이 숫자는 내부 도그푸드 쪽으로 " +
  "낙관 편향돼 있습니다. 실제 외부 고객 수는 여기 적힌 것보다 작습니다.";

const MANUAL_REASON =
  "계약·영업 사실이라 텔레메트리에 없습니다. 자동 측정 경로가 존재하지 않으므로 " +
  "0 으로 그리지 않습니다 — 0 은 '아직 한 곳도 없다'로 읽히는데, 우리는 그것조차 " +
  "모릅니다. 값이 필요하면 사람이 세어 적어야 합니다.";

const PAYING_SOURCE = "getAdminBusinessSummary.subscriptions.paidCurrent";
/**
 * ★Qualified Beta 의 좌표. 사장님 정의가 '신청하고 우리가 승인한 사람' 이라
 * 계정 축 사실이고, 설치 축 쿼리로는 셀 수 없다. 여기서 Firestore 를 또 읽으면
 * '승인' 정의가 두 벌이 되므로 좌표만 선언하고 값은 기존 봉투에서 받는다.
 */
const QUALIFIED_SOURCE = "getAdminBusinessSummary.betaAccess.grantTotal";
export { PAYING_SOURCE as SCORECARD_PAYING_SOURCE };
export { QUALIFIED_SOURCE as SCORECARD_QUALIFIED_SOURCE };

/**
 * 지표 한 칸 조립. ★measurable=false 면 value 를 **강제로 null 로 만든다** —
 * 호출부가 실수로 0 을 넣어도 화면까지 0 이 나가지 않게 하는 자리다.
 */
function scorecardMetric(spec: {
  key: string;
  label: string;
  definition: string;
  measuredAs: string;
  axis: ScorecardAxis;
  unit: ScorecardUnit;
  counted?: RetentionCountedRate | null;
  rawValue?: number | null;
  targetMin: number;
  targetMax: number;
  seedMin: number | null;
  measurable: boolean;
  unmeasuredReason?: string | null;
  externalSource?: string | null;
}): ScorecardMetric {
  const counted = spec.counted ?? null;
  const value = !spec.measurable
    ? null
    : spec.unit === "rate"
      ? (counted?.rate ?? null)
      : (spec.rawValue ?? null);
  // 달성률의 분모는 **목표 하한**이다. 목표가 0 이면 나누지 않는다(null).
  const attainment =
    value == null || spec.targetMin <= 0 ? null : value / spec.targetMin;
  // ★목표가 없는 줄(targetMin ≤ 0 = 선행지표)은 '남은 양'도 없다. 0 으로 두면
  //   화면이 "목표 하한 도달" 이라고 쓰는데, 도달할 목표 자체가 없다.
  const hasTarget = spec.targetMin > 0;
  const remaining =
    !hasTarget || value == null
      ? null
      : Math.max(0, spec.targetMin - value);
  return {
    key: spec.key,
    label: spec.label,
    definition: spec.definition,
    measuredAs: spec.measuredAs,
    axis: spec.axis,
    unit: spec.unit,
    value,
    counted: spec.unit === "rate" ? counted : null,
    targetMin: spec.targetMin,
    targetMax: spec.targetMax,
    seedMin: spec.seedMin,
    attainment,
    remaining,
    // ★측정 불가는 '미달'이 아니라 '미상'이다 — met 을 참으로 만들지 않는다.
    // ★목표가 없는 줄도 마찬가지다: targetMin=0 이면 어떤 값이든 `value >= 0`
    //   이라 전부 '달성'으로 뜬다. 선행지표가 늘 초록으로 보이면 그 줄이 곧
    //   12번째 KPI 로 읽힌다 — 목표가 없으면 달성 판정도 없다.
    met: hasTarget && value != null && value >= spec.targetMin,
    measurable: spec.measurable,
    unmeasuredReason: spec.measurable ? null : (spec.unmeasuredReason ?? null),
    externalSource: spec.externalSource ?? null,
  };
}

/**
 * 11개 지표를 목표치와 나란히 조립한다. **순수 함수** — BQ 도 시계도 없다.
 *
 * ★분모가 0 이면 rate 는 null 이고(countedRate 규약) 그 자리에 0% 를 그리지
 * 않는다. 분모 자체는 그대로 남는다 — `0/0` 을 지우면 측정값을 숨기는 것이다.
 */
export function buildBetaScorecard(
  input: BetaScorecardInput,
): BetaScorecardResult {
  // ★조회 실패면 0 이 아니라 '미상'이다. install 이 null 이면 설치 축 지표
  //   전체가 measurable=false 로 내려가고 value 는 강제로 null 이 된다
  //   (scorecardMetric 이 그 자리를 지킨다) — 화면에 0 이 나갈 길이 없다.
  const i = input.install;
  const installOk = i != null;
  const installReason = installOk
    ? null
    : (input.installUnavailableReason ??
      "설치 축 조회가 실패했습니다. 0 으로 접지 않고 '미상'으로 둡니다.");
  const num = (v: unknown): number => coerceNumber(v);
  const d7 = countedRate(num(i?.d7Retained), num(i?.d7Cohort));
  const d14 = countedRate(num(i?.d14Retained), num(i?.d14Cohort));
  const d30 = countedRate(num(i?.d30Retained), num(i?.d30Cohort));

  const installAxisSuffix =
    " ★단위는 사람이 아니라 **설치**입니다(한 사람이 두 기기면 2).";
  const retentionMeasured =
    "첫 완료 task 가 있던 날을 코호트 기준일로 잡고, 그 다음날부터 +N일 안에 " +
    "완료 task 를 **한 번이라도 더** 한 설치를 셉니다(analytics_user_daily." +
    "tasks_completed > 0). 창은 누적이라 D7 ≤ D14 ≤ D30 이 정의상 보장됩니다. " +
    "아직 D+N 일이 오지 않은 설치는 분모에서 뺍니다 — 넣으면 최근 코호트가 " +
    "'이탈'로 잡혀 비율이 조용히 낮아집니다." + installAxisSuffix;

  const metrics: ScorecardMetric[] = [
    scorecardMetric({
      key: "qualified_beta",
      label: "Qualified Beta",
      definition: "신청하고 우리가 승인한 사람",
      measuredAs:
        "베타 접근권이 부여된 계정 수(Firestore subscriptions 의 founder_grant). " +
        "★값은 이 응답이 아니라 getAdminBusinessSummary 봉투에서 옵니다 — 계정 " +
        "축 사실이라 설치 축 쿼리로는 셀 수 없습니다. 화면은 신청 → 선정 → " +
        "접근권 부여 → 현재 유효 사다리를 함께 그려 어디서 새는지 보여 줍니다. " +
        "★설치 축의 '활동 설치 수'를 이 자리에 쓰면 안 됩니다: 승인 없이 깔린 " +
        "설치도 세고, 한 사람이 두 기기에 깔면 2로 셉니다.",
      axis: "account",
      unit: "count",
      rawValue: null,
      targetMin: 500,
      targetMax: 500,
      seedMin: 500,
      measurable: true,
      externalSource: QUALIFIED_SOURCE,
    }),
    scorecardMetric({
      key: "activated",
      label: "Activated",
      definition: "설치 + Agent 연결 + 실제 프로젝트 + 3개 이상 Task",
      measuredAs:
        `누적 완료 task 가 ${ACTIVATED_MIN_TASKS_COMPLETED}건 이상인 설치 수. ` +
        "★네 조건 중 'Task 3개 이상'만 " +
        "셉니다 — task 를 3건 끝냈다면 앞의 세 조건은 이미 통과한 것이라 " +
        "가장 좁은(= 가장 보수적인) 조건 하나로 대신합니다. ★사장님이 한때 " +
        "'첫 스폰'으로 정하셨다가 3 Task 로 되돌리셨습니다 — 이것이 최종 " +
        "확정입니다. 첫 스폰은 아래 선행지표 줄에 따로 있고 Activated 가 " +
        "아닙니다." + installAxisSuffix,
      axis: "install",
      unit: "count",
      rawValue: num(i?.activatedInstalls),
      targetMin: 200,
      targetMax: 200,
      seedMin: 200,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "d7_retention",
      label: "D7 Retention",
      definition: "7일 후 다시 실제 Task 수행",
      measuredAs: retentionMeasured,
      axis: "install",
      unit: "rate",
      counted: d7,
      targetMin: 0.35,
      targetMax: 0.35,
      seedMin: 0.35,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "d14_retention",
      label: "D14 Retention",
      definition: "14일 후 다시 실제 Task 수행",
      measuredAs: retentionMeasured,
      axis: "install",
      unit: "rate",
      counted: d14,
      targetMin: 0.25,
      targetMax: 0.25,
      seedMin: 0.25,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "d30_retention",
      label: "D30 Retention",
      definition: "30일 후에도 실제 사용",
      measuredAs: retentionMeasured,
      axis: "install",
      unit: "rate",
      counted: d30,
      targetMin: 0.2,
      targetMax: 0.2,
      seedMin: 0.2,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "d30_retained_users",
      label: "D30 retained users",
      definition: "실제 인원",
      measuredAs:
        "위 D30 비율의 **분자** 그 자체입니다(같은 수를 두 번 세지 않습니다). " +
        "정의는 '실제 인원'인데 이 축이 세는 것은 설치 수라 단위가 어긋납니다 — " +
        "사람 수는 아래 사람 축 블록을 보세요." + installAxisSuffix,
      axis: "install",
      unit: "count",
      rawValue: d30.numerator,
      targetMin: 30,
      targetMax: 40,
      seedMin: 40,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "power_user",
      label: "Power User",
      definition: "주 3일+ 또는 주 10 Task+",
      measuredAs:
        "최근 4주 안의 어느 한 주에서 '완료 task 가 있던 날 3일 이상' 또는 " +
        "'완료 task 10건 이상'을 만족한 설치 수. 주는 월요일 시작입니다." +
        installAxisSuffix,
      axis: "install",
      unit: "count",
      rawValue: num(i?.powerUsers),
      targetMin: 20,
      targetMax: 20,
      seedMin: 30,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "monthly_agent_tasks",
      label: "Monthly Agent Tasks",
      definition: "실사용 Task",
      measuredAs:
        "조회 창의 완료 task 총량(analytics_user_daily.tasks_completed 합). " +
        "실패한 task 는 빼고 셉니다. 이 지표만 단위가 설치가 아니라 건수라 " +
        "축 경고의 영향을 받지 않습니다.",
      axis: "install",
      unit: "count",
      rawValue: num(i?.monthlyTasks),
      targetMin: 10000,
      targetMax: 10000,
      seedMin: 30000,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
    scorecardMetric({
      key: "paying_users",
      label: "Paying Users",
      definition: "개인/Team",
      measuredAs:
        "Firestore subscriptions 의 현재 유효 유료 구독자 수. ★이 값은 이 " +
        "응답이 아니라 getAdminBusinessSummary 봉투에서 옵니다 — 같은 " +
        "'결제자' 정의를 두 곳에서 세면 두 수가 갈라집니다. 축도 다릅니다" +
        "(계정 축이라 위 설치 축 수치와 더하거나 나누면 안 됩니다).",
      axis: "account",
      unit: "count",
      rawValue: null,
      targetMin: 20,
      targetMax: 50,
      seedMin: 50,
      measurable: true,
      externalSource: PAYING_SOURCE,
    }),
    scorecardMetric({
      key: "design_partners",
      label: "Design Partners",
      definition: "기업/팀",
      measuredAs: "—",
      axis: "manual",
      unit: "count",
      targetMin: 3,
      targetMax: 5,
      seedMin: 5,
      measurable: false,
      unmeasuredReason: MANUAL_REASON,
    }),
    scorecardMetric({
      key: "paid_poc",
      label: "Paid PoC",
      definition: "돈 받고 실증",
      measuredAs: "—",
      axis: "manual",
      unit: "count",
      targetMin: 1,
      targetMax: 2,
      seedMin: 2,
      measurable: false,
      unmeasuredReason: MANUAL_REASON,
    }),
  ];

  // ── ★선행지표 — KPI 가 아니다 ──────────────────────────────────────────
  //
  // 목표치를 붙이지 않는다(targetMin=0 → attainment/met 이 만들어지지 않는다).
  // 목표가 붙는 순간 이 줄이 12번째 KPI 가 되고, 다음 사람이 Activated 대신
  // 이 수를 읽는다 — 사장님이 정확히 그걸 경계하셨다.
  const leadingIndicators: ScorecardMetric[] = [
    scorecardMetric({
      key: "first_spawn_leading",
      label: "첫 스폰 (선행지표 · Activated 아님)",
      definition:
        "광고 최적화용 빠른 신호 — 클릭에서 3 Task 까지는 며칠 걸려 캠페인을 " +
        "못 돌립니다. 스폰은 설치 당일 찍힙니다.",
      measuredAs:
        "analytics_install_profile.first_spawn_at 이 채워진 설치 수. events 의 " +
        "agent:spawned 를 직접 세는 것과 값이 같고(실측 둘 다 동일) 스캔이 절반 " +
        "이하라 파생표를 읽습니다. ★베타 종료·Seed 판단에는 쓰지 마세요 — " +
        "스폰은 '가치를 봤다'가 아니라 '실행은 됐다'입니다." + installAxisSuffix,
      axis: "install",
      unit: "count",
      rawValue: num(i?.firstSpawnInstalls),
      // ★목표 0 = 목표 없음. scorecardMetric 이 attainment 를 null 로 만든다.
      targetMin: 0,
      targetMax: 0,
      seedMin: null,
      measurable: installOk,
      unmeasuredReason: installReason,
    }),
  ];

  const p = input.person;
  return {
    metrics,
    leadingIndicators,
    heroKey: SCORECARD_HERO_KEY,
    personAxisCounts: p
      ? {
          linkedPeople: num(p.linkedPeople),
          peopleWithTask: num(p.peopleWithTask),
          activePeople: num(p.activePeople),
        }
      : null,
    personUnavailableReason: p ? null : (input.personUnavailableReason ?? null),
    installUnavailableReason: installReason,
    smallSampleMax: SCORECARD_SMALL_SAMPLE_MAX,
    axisNote: SCORECARD_AXIS_NOTE,
    note:
      "★티켓 본문과 그 정정 지시가 둘 다 'task_outcomes 는 사람 축'이라고 " +
      "적었지만 실측은 다릅니다: task_outcomes.userId 는 전부 LENGTH 36(uuid36) " +
      "= 익명 설치 ID 이고, 계정 uid 는 28자입니다. 같은 정의로 " +
      "analytics_user_daily 에서 리텐션을 돌리면 task_outcomes 결과가 한 자리도 " +
      "안 틀리고 재현됩니다 — 같은 축이기 때문입니다. 그래서 이 표는 설치 축임을 " +
      "숨기지 않고 라벨로 밝히고, 사람 축은 원수만 따로 냅니다. " +
      "★D30 이 D7 보다 높게 나올 수 있습니다. 창이 누적이라 정의상 " +
      "D7 ≤ D14 ≤ D30 이고, 코호트가 지평마다 달라(늦게 들어온 설치는 D30 " +
      "분모에서 빠짐) 비율의 대소가 뒤집힐 수 있습니다. 그것은 제품이 좋아졌다는 " +
      "뜻이 아니라 **분모가 한 자릿수라 곡선이 의미를 못 가진다**는 뜻입니다. " +
      "★목표 달성 여부(met)는 목표 하한 기준이며, 분모가 " +
      `${SCORECARD_SMALL_SAMPLE_MAX} 이하인 비율의 met 은 신뢰하지 마세요. ` +
      "★Design Partners·Paid PoC 는 자동 측정 경로가 없어 0 이 아니라 '측정 안 " +
      "함'입니다. Paying Users 와 Qualified Beta 는 계정 축이라 값이 다른 봉투" +
      "(getAdminBusinessSummary)에서 옵니다 — 같은 정의를 두 곳에서 세면 두 수가 " +
      "조용히 갈라집니다. " +
      "★Activated 정본은 '누적 완료 task ≥ 3' 입니다(사장님 최종 확정). '첫 " +
      "스폰'은 광고 최적화용 선행지표로 leadingIndicators 에 따로 있고 목표치가 " +
      "없습니다 — Activated 로 읽지 마세요. " +
      "★D30 을 읽기 전에 베타 접근권 만료를 보세요: 부여 기간이 짧으면 D30 은 " +
      "제품 리텐션이 아니라 **만료 신호**입니다. 그 수는 계정 축이라 이 응답에 " +
      "없고 화면이 getAdminBusinessSummary.betaAccess 로 그립니다 — 설치 축인 " +
      "D30 의 분모를 그 수로 보정할 수는 없습니다(축 분리 규약이 조인을 " +
      "금지합니다).",
  };
}
