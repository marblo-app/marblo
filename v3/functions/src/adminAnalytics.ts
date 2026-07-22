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
  distinctCol = "userId"
): string {
  if (mode === "clients") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(distinctCol)) {
      throw new Error(
        `metricCountExpr: unsafe distinct column: ${distinctCol}`
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
  windowMinutes = 30
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
  reasonRows: ReasonRow[] = []
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
        (a, b) => b.count - a.count
      ),
    })
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
