// ════════════════════════════════════════════════════════════════════════════
// ★ACTIVATED — 단일 정의 소스 (ticket O5JPlh4FSiCsNpZ4E9VJ)
// ════════════════════════════════════════════════════════════════════════════
//
// 사장님이 "광고 최적화 KPI 를 Beta Signup 이 아니라 **Activated Beta** 로 잡자"고
// 하셨다. 그 순간 ACTIVATED 는 두 화면의 공용 종점이 된다:
//   · 어드민 ②광고 탭 — 광고→ACTIVATED 퍼널의 마지막 칸 (ticket O5JPlh4F)
//   · 어드민 KPI 화면 — 11개 지표 중 Activated       (ticket 6jeXDBQ1xoH0FoXwjqAL)
//
// ★두 화면이 다른 ACTIVATED 를 쓰면 둘 다 못 믿게 된다. 그래서 정의를 이 파일
//   하나에 두고, SQL 조각도 화면 문구도 **전부 여기서 파생**시킨다. 어느 쪽이든
//   `3` 을 손으로 다시 적는 순간 이 파일의 존재 이유가 없어진다.
//
// ★왜 adminAnalytics.ts 가 아니라 새 파일인가:
//   지금 두 에이전트가 adminAnalytics.ts 를 동시에 만지고 있다. 공용 상수를 그
//   파일에 넣으면 "공유하자고 만든 것"이 병합 충돌의 진원지가 된다. 의존이 없는
//   잎(leaf) 모듈로 떼어 두면 양쪽이 import 만 하면 되고 충돌 면적이 0 이다.
//   (analyticsPseudonym.ts / personAxis.ts 와 같은 선례.)
//
// BQ/Firestore 무의존 규약을 지킨다 — 이 파일은 순수 상수·함수만 담고,
// node 표준 모듈조차 쓰지 않는다. node --test 로 단위검증한다.

/** 정의 버전. 응답에 실어 보내 화면이 "무슨 정의로 센 값인가"를 밝히게 한다. */
export const ACTIVATED_DEFINITION_ID = "activated.v1";

/**
 * ★사장님 KPI 표 원문의 임계값. "설치 + Agent 연결 + 실제 프로젝트 + **3개 이상
 * Task**". 이 숫자는 여기 한 곳에만 있다 — SQL 도 화면 문구도 이 상수에서 나온다.
 */
export const ACTIVATED_MIN_TASKS_COMPLETED = 3;

/**
 * 축. **정의와 축은 다른 축이다** — 같은 정의를 설치 단위로도 사람 단위로도 셀 수
 * 있다. 그래서 정의는 하나로 못 박고 축은 파라미터로 둔다.
 *
 * ★지금(2026-08) 사람 축 커버리지는 설치 44개 중 3개다(조사 티켓
 * jGUu096QviVsooCWslwv). 사람 축으로 세면 ACTIVATED 가 구조적으로 거의 0 이 되고,
 * 그 0 은 "아무도 활성화 안 했다"가 아니라 "이 축으로는 아직 못 센다"다.
 * 그래서 기본 축은 설치이고, 화면은 그 사실을 라벨로 **말해야** 한다.
 */
export type ActivatedAxis = "install" | "person";

export const ACTIVATED_DEFAULT_AXIS: ActivatedAxis = "install";

export const ACTIVATED_AXIS_LABEL: Readonly<Record<ActivatedAxis, string>> = {
  install: "설치 축(익명 설치 ID)",
  person: "사람 축(계정)",
};

/**
 * ★축 한계 문구. 화면이 "명" 이라고만 쓰면 거짓이 되는 지점을 그대로 적는다.
 * 사람 축이 채워지면 옮긴다는 것도 여기 적어 두 화면이 같은 말을 하게 한다.
 */
export const ACTIVATED_AXIS_NOTE =
  "★이 ACTIVATED 는 **설치 축**입니다(events.userId = 익명 설치 ID). " +
  "한 사람이 두 기기에 깔면 2 로, 한 기기를 두 사람이 쓰면 1 로 셉니다 — " +
  "즉 '명' 이 아니라 '설치' 입니다. 사람 축 커버리지가 채워지면(조사 " +
  "jGUu096QviVsooCWslwv) 같은 정의를 사람 축으로 옮깁니다. 축은 섞지 않습니다.";

/** 정의를 이루는 4개 조건. 화면은 이 배열을 그대로 렌더한다(문구 재작성 금지). */
export const ACTIVATED_CRITERIA: ReadonlyArray<{
  key: "installed" | "projectConnected" | "agentConnected" | "tasksCompleted";
  label: string;
  /** 이 조건을 채우는 텔레메트리 신호. "무엇으로 셌나"를 화면이 밝히게 한다. */
  signal: string;
}> = [
  {
    key: "installed",
    label: "설치",
    signal: "app:installed ∪ app:first_run",
  },
  {
    key: "projectConnected",
    label: "실제 프로젝트",
    signal: "onboarding:folder_connected",
  },
  {
    key: "agentConnected",
    label: "Agent 연결",
    signal: "agent:spawned",
  },
  {
    key: "tasksCompleted",
    label: `Task ${ACTIVATED_MIN_TASKS_COMPLETED}개 이상 완료`,
    signal: `task:completed 누적 ≥ ${ACTIVATED_MIN_TASKS_COMPLETED}`,
  },
];

/** 한 줄 정의문. 두 화면이 같은 문장을 쓰게 한다. */
export const ACTIVATED_DEFINITION_LABEL = `ACTIVATED = ${ACTIVATED_CRITERIA.map(
  (c) => c.label
).join(" + ")}`;

/**
 * ★계측을 늘려서 지표를 좋게 만들지 않았다는 근거.
 *
 * 3 Tasks·ACTIVATED 는 **새 이벤트를 하나도 만들지 않고** 기존 `task:completed`
 * 카운트에서 파생한다. 기존 퍼널 쿼리가 이미 identity 별 `n_task_completed` 를
 * 세고 있어, 임계값 비교만 추가하면 된다 — 스캔하는 이벤트 종류가 늘지 않으므로
 * `FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION` 이 막으려던 잔존율 인플레가 원천적으로
 * 발생하지 않는다(그 목록에 추가할 것도 없다).
 */
export const ACTIVATED_DERIVATION_NOTE =
  "3 Tasks·ACTIVATED 는 새 이벤트 없이 기존 task:completed 카운트에서 파생합니다. " +
  "스캔 이벤트 종류가 늘지 않으므로 잔존율 계산이 오염되지 않습니다 " +
  "(FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION 에 추가할 항목 없음).";

/** 한 유닛(설치 또는 사람)의 활성화 판정 재료. */
export type ActivatedFacts = {
  /** 설치 신호를 낸 적이 있는가. */
  installed: boolean;
  /** 실제 프로젝트(폴더)를 연결한 적이 있는가. */
  projectConnected: boolean;
  /** Agent 를 스폰한 적이 있는가. */
  agentConnected: boolean;
  /** 완료한 Task 누적 수. */
  tasksCompleted: number;
};

/**
 * ★판정 함수 — 정의의 정본. SQL 도 이것과 같은 논리여야 하고,
 * `activatedSqlPredicate()` 가 같은 상수에서 그 SQL 을 만들어 낸다.
 */
export function isActivated(facts: ActivatedFacts): boolean {
  return (
    facts.installed &&
    facts.projectConnected &&
    facts.agentConnected &&
    Number.isFinite(facts.tasksCompleted) &&
    facts.tasksCompleted >= ACTIVATED_MIN_TASKS_COMPLETED
  );
}

/** `activatedSqlPredicate` 가 받을 컬럼(또는 식) 이름. */
export type ActivatedSqlColumns = {
  /** 설치 신호 존재를 뜻하는 boolean 식(예: `install_ts IS NOT NULL`). */
  installed: string;
  projectConnected: string;
  agentConnected: string;
  /** 완료 Task 수 식(예: `n_task_completed`). */
  tasksCompleted: string;
};

/**
 * SQL 술어를 **정의 상수에서 생성**한다. 손으로 `>= 3` 을 적지 않게 하는 것이
 * 이 함수의 전부다 — 임계값이 바뀌면 SQL 도 같이 바뀐다.
 *
 * ★식별자 주입 방지: 호출부가 넘기는 것은 SQL 식이므로 이 함수는 값을 검증하지
 * 않는다. 반드시 **상수 리터럴**만 넘겨라(사용자 입력 금지). 임계값만은 이
 * 모듈이 숫자로 직접 넣으므로 안전하다.
 */
export function activatedSqlPredicate(cols: ActivatedSqlColumns): string {
  return [
    `(${cols.installed})`,
    `(${cols.projectConnected})`,
    `(${cols.agentConnected})`,
    `(${cols.tasksCompleted}) >= ${ACTIVATED_MIN_TASKS_COMPLETED}`,
  ].join(" AND ");
}

/**
 * 응답에 실어 보내는 정의문. **화면은 이걸 렌더하고 자기 문구를 지어내지 않는다.**
 * 두 화면이 같은 객체를 받으면 정의가 갈라질 자리가 없다.
 */
export type ActivatedDefinition = {
  id: string;
  minTasksCompleted: number;
  axis: ActivatedAxis;
  axisLabel: string;
  axisNote: string;
  label: string;
  criteria: ReadonlyArray<{ key: string; label: string; signal: string }>;
  derivationNote: string;
};

export function activatedDefinition(
  axis: ActivatedAxis = ACTIVATED_DEFAULT_AXIS
): ActivatedDefinition {
  return {
    id: ACTIVATED_DEFINITION_ID,
    minTasksCompleted: ACTIVATED_MIN_TASKS_COMPLETED,
    axis,
    axisLabel: ACTIVATED_AXIS_LABEL[axis],
    axisNote: ACTIVATED_AXIS_NOTE,
    label: ACTIVATED_DEFINITION_LABEL,
    criteria: ACTIVATED_CRITERIA,
    derivationNote: ACTIVATED_DERIVATION_NOTE,
  };
}
