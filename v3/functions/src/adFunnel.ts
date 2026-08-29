// ════════════════════════════════════════════════════════════════════════════
// ★광고→ACTIVATED 퍼널 — 앱 안쪽 사다리 (ticket O5JPlh4FSiCsNpZ4E9VJ)
// ════════════════════════════════════════════════════════════════════════════
//
// 사장님 광고 퍼널의 **하단**(설치 → 로그인 → 첫 Project → 첫 Agent Task →
// 3 Tasks → ACTIVATED)을 조립하는 순수 로직. BQ/Firestore 무의존 — index.ts 의
// onCall 이 BQ 1행을 읽어 여기로 넘긴다(adminAnalytics.ts 와 같은 규약).
//
// ── ★이 파일이 기존 퍼널을 갈아엎지 않는다는 것 ──────────────────────────────
// `getAdminOnboardingFunnel` 의 순차 체인(24h 창 + gating 판단)은 **한 줄도**
// 건드리지 않는다. 그 안에는 어렵게 얻은 판단이 들어 있다:
//   · 비-gating `[]` 칸 — 계측이 늦게 생긴 칸을 체인에 끼우면 그 뒤가 통째로 0 이
//     되어 계측 공백이 제품 실패로 둔갑한다.
//   · FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION — 스캔 이벤트를 늘리면 잔존율이 저절로
//     올라간다. 그건 개선이 아니라 분모를 바꾼 것이다.
// 이 사다리는 **같은 단일 스캔의 `marks` CTE 에서 COUNTIF 를 몇 개 더 뽑은 것**이
// 전부다. 새 이벤트 0개, 추가 스캔 0바이트, 기존 컬럼 변경 0건.
//
// ── ★왜 순차 체인이 아니라 "누적 도달" 인가 ─────────────────────────────────
// 순차 체인은 로그인 후 24h 안에 각 단계를 밟은 설치만 센다. 사장님의 ACTIVATED
// 는 시간창 개념이 아니다("3개 이상 Task 를 했는가"). 3 Tasks 를 24h 창에 강제로
// 끼우면 값이 구조적으로 0 에 붙고, 그 0 은 제품 실패가 아니라 정의의 산물이다.
// 그래서 이 사다리는 **조회창 안 누적 도달**(순서·시간창 무관)로 잰다.
//
// ★그래서 ③활성화 탭의 순차 수치와 이 탭의 누적 수치는 **다르다.** 모순이 아니라
//   렌즈가 다른 것이고, 항상 `누적 ≥ 순차` 가 성립한다. 화면이 그 사실을 말한다.
//   (어느 쪽이 옳은가: 온보딩 품질 진단은 순차가 옳고, "광고비가 활성화로
//    이어졌나" 라는 이 탭의 질문에는 누적이 옳다.)

import {
  ACTIVATED_MIN_TASKS_COMPLETED,
  ActivatedAxis,
  ActivatedDefinition,
  activatedDefinition,
  activatedSqlPredicate,
  isActivated,
} from "./activatedDefinition";

/** BQ 집계 1행(컬럼명 → 값). int64 가 string 으로 올 수 있어 좁히지 않는다. */
export type AdFunnelCountsRow = Record<string, unknown>;

/** 안전한 숫자 변환. adminAnalytics.coerceNumber 와 같은 규약(의존은 만들지 않는다). */
function coerce(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export type ActivatedLadderKey =
  | "install"
  | "login_success"
  | "project_connected"
  | "agent_spawned"
  | "task_completed_1"
  | "task_completed_min"
  | "activated";

export type ActivatedLadderStep = {
  key: ActivatedLadderKey;
  label: string;
  /** 조회창 안 누적 도달 유닛 수(설치 축 기본). */
  units: number;
  /** 직전 칸 대비 전환율. 분모 0 이면 null — ★0% 가 아니다. */
  conversionFromPrev: number | null;
  /**
   * ★분자가 분모보다 큰가. 조회창 경계 때문에 상위 신호(설치)가 창 밖인 설치가
   * 있으면 실제로 일어난다. 조용히 100% 로 깎으면 그 사실이 사라지므로 그대로
   * 두고 플래그를 세운다.
   */
  exceedsPrev: boolean;
};

export type ActivatedLadder = {
  /** ★정의문. 화면은 이걸 렌더하고 자기 문구를 지어내지 않는다. */
  definition: ActivatedDefinition;
  steps: ActivatedLadderStep[];
  /** ACTIVATED 유닛 수(사다리 마지막 칸과 같은 값). 소비처 편의용 단축. */
  activatedUnits: number;
  /** 사다리의 기준 모집단(설치). CPA 분모가 아니라 전환율 분모다. */
  installUnits: number;
  /**
   * ★같은 정의를 **더 넓은 커버리지 소스**로 다시 센 값. null = 그 쿼리가 실패했다.
   * 두 값이 다르면 화면이 둘 다 보여 준다 — 어느 쪽도 조용히 이기지 않는다.
   */
  profile: ActivatedProfile | null;
  notes: string[];
};

const LADDER_LABELS: Readonly<Record<ActivatedLadderKey, string>> = {
  install: "설치",
  login_success: "로그인 성공(Beginner Mode 진입)",
  project_connected: "첫 Project(폴더 연결)",
  agent_spawned: "첫 Agent Task(스폰)",
  task_completed_1: "Task 1개 완료",
  task_completed_min: `Task ${ACTIVATED_MIN_TASKS_COMPLETED}개 완료`,
  activated: "ACTIVATED",
};

/** BQ 행에서 사다리 컬럼을 읽을 때 쓰는 이름. SQL 과 이 파일이 같은 상수를 쓴다. */
export const AD_FUNNEL_LADDER_COLUMNS: Readonly<
  Record<ActivatedLadderKey, string>
> = {
  install: "c_install",
  login_success: "c_login_success",
  project_connected: "c_project_connected",
  agent_spawned: "c_agent_spawned",
  task_completed_1: "c_task_completed_1",
  task_completed_min: "c_task_completed_min",
  activated: "c_activated",
};

/**
 * ★사다리 SQL 을 정의 상수에서 생성한다. 손으로 `>= 3` 을 적는 자리를 없앤다.
 *
 * `marks`/`seq_ext` CTE 의 컬럼만 참조한다 — 새 이벤트를 스캔하지 않으므로 BQ
 * 비용이 늘지 않는다. 반환값은 `SELECT` 절에 그대로 끼워 넣을 수 있는 조각이다.
 */
export function activatedLadderSelectSql(): string {
  const activatedPredicate = activatedSqlPredicate({
    installed: "install_ts IS NOT NULL",
    projectConnected: "folder_connected_ts IS NOT NULL",
    agentConnected: "agent_spawned_ts IS NOT NULL",
    tasksCompleted: "n_task_completed",
  });
  const c = AD_FUNNEL_LADDER_COLUMNS;
  return [
    `COUNTIF(install_ts IS NOT NULL) AS ${c.install}`,
    `COUNTIF(login_success_ts IS NOT NULL) AS ${c.login_success}`,
    `COUNTIF(folder_connected_ts IS NOT NULL) AS ${c.project_connected}`,
    `COUNTIF(agent_spawned_ts IS NOT NULL) AS ${c.agent_spawned}`,
    `COUNTIF(n_task_completed >= 1) AS ${c.task_completed_1}`,
    `COUNTIF(n_task_completed >= ${ACTIVATED_MIN_TASKS_COMPLETED}) ` +
      `AS ${c.task_completed_min}`,
    `COUNTIF(${activatedPredicate}) AS ${c.activated}`,
  ].join(",\n        ");
}

const LADDER_ORDER: ActivatedLadderKey[] = [
  "install",
  "login_success",
  "project_connected",
  "agent_spawned",
  "task_completed_1",
  "task_completed_min",
  "activated",
];

/**
 * 사다리 조립. 분모가 0 이면 전환율은 **null**(0% 아님) — "판단 불가"와 "실패"를
 * 섞지 않는 이 코드베이스의 기존 규율(safeRate·UnifiedRatio)을 그대로 따른다.
 */
export function buildActivatedLadder(
  row: AdFunnelCountsRow | null | undefined,
  axis: ActivatedAxis = "install",
  profileRow?: ActivatedProfileRow | null
): ActivatedLadder {
  const src = row ?? {};
  const steps: ActivatedLadderStep[] = [];
  let prev: number | null = null;

  for (const key of LADDER_ORDER) {
    const units = coerce(src[AD_FUNNEL_LADDER_COLUMNS[key]]);
    const conversionFromPrev =
      prev === null ? null : prev > 0 ? units / prev : null;
    steps.push({
      key,
      label: LADDER_LABELS[key],
      units,
      conversionFromPrev,
      exceedsPrev: prev !== null && units > prev,
    });
    prev = units;
  }

  const byKey = new Map(steps.map((s) => [s.key, s]));
  const activatedUnits = byKey.get("activated")?.units ?? 0;
  const installUnits = byKey.get("install")?.units ?? 0;
  const taskMinUnits = byKey.get("task_completed_min")?.units ?? 0;

  const notes: string[] = [
    "이 사다리는 조회창 안 **누적 도달**입니다(순서·시간창 무관). " +
      "③활성화 탭의 24h 순차 체인과는 렌즈가 달라 항상 누적 ≥ 순차 입니다 — " +
      "모순이 아니라 정의 차이입니다.",
  ];
  if (steps.some((s) => s.exceedsPrev)) {
    notes.push(
      "★일부 칸이 직전 칸보다 큽니다. 조회창 시작 이전에 설치한 유닛은 상위 " +
        "신호가 창 밖이라 분모에 없습니다 — 100% 로 깎지 않고 그대로 둡니다."
    );
  }
  if (activatedUnits !== taskMinUnits) {
    notes.push(
      `★ACTIVATED(${activatedUnits})와 Task ${ACTIVATED_MIN_TASKS_COMPLETED}개` +
        `(${taskMinUnits})가 다릅니다 — Task 는 채웠지만 폴더 연결/스폰 신호가 ` +
        "없는 유닛이 그 차이입니다."
    );
  }

  const profile = buildActivatedProfile(profileRow);
  if (profile && profile.activatedUnits !== activatedUnits) {
    notes.push(
      `★소스마다 ACTIVATED 가 다릅니다 — events 축 ${activatedUnits}, ` +
        `${profile.sourceLabel} ${profile.activatedUnits}. 렌더러 ` +
        "task:completed 가 구조적으로 과소계상이라 넓은 쪽이 실태에 가깝습니다. " +
        "한쪽을 지우지 않고 둘 다 싣습니다."
    );
  }

  return {
    definition: activatedDefinition(axis),
    steps,
    activatedUnits,
    installUnits,
    profile,
    notes,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ★교차 확인 소스 — analytics_install_profile (ticket O5JPlh4FSiCsNpZ4E9VJ)
// ════════════════════════════════════════════════════════════════════════════
//
// ★왜 소스가 둘인가. 실측(2026-08-29, BQ):
//
//   | 소스                       | 축         | Task 합계 | Task≥3 | ACTIVATED |
//   |---------------------------|-----------|----------|--------|-----------|
//   | events.`task:completed`   | 설치 ID    |       43 |      2 |         2 |
//   | analytics_install_profile | install_key |    1,494 |      5 |         5 |
//
// **같은 설치 축인데 Task 합계가 43 대 1,494 다.** 렌더러 이벤트
// `task:completed` 는 구조적으로 과소계상이고(오케 MCP 가 렌더러를 우회하는
// first_ticket 과 같은 계열의 문제), 일별 롤업은 그 경로를 타지 않는다.
// `install_key` 와 `events.userId` 는 **같은 ID 공간**이다(실측 44/44 완전 일치)
// — 축을 섞는 게 아니라 같은 축의 더 나은 계측을 읽는 것이다.
//
// ★그래서 한쪽을 골라 조용히 이기게 두지 않는다. 둘 다 싣고 라벨로 가른다.
//   이 코드베이스가 이미 쓰는 규율이다("정의가 둘이면 둘 다 보이게").
//
// ★비용: 이 소스는 **0.01 MiB** 스캔이다(690행 파생 테이블). events 재스캔이
//   필요 없으므로 퍼널 탭의 BQ 비용이 사실상 늘지 않는다.
//
// ★한계 하나를 숨기지 않는다: 이 테이블에는 폴더 연결(실제 프로젝트) 신호가
//   없다. 대신 `first_spawn_at`(Agent 연결)을 쓴다 — 폴더 없이는 스폰이 안 되므로
//   **추론**이다. 추론이라는 사실을 응답에 실어 보낸다.

export type ActivatedProfileRow = Record<string, unknown>;

export const AD_FUNNEL_PROFILE_COLUMNS = {
  installUnits: "p_install",
  agentUnits: "p_agent",
  taskMinUnits: "p_task_min",
  activatedUnits: "p_activated",
} as const;

export type ActivatedProfile = {
  sourceKey: "install_profile";
  sourceLabel: string;
  /** 설치(first_run_at 관측) 유닛 수. */
  installUnits: number;
  /** Agent 연결(first_spawn_at) 유닛 수. */
  agentUnits: number;
  /** Task 임계 이상 유닛 수. */
  taskMinUnits: number;
  activatedUnits: number;
  /** ★'실제 프로젝트' 조건을 스폰으로 대신 읽었나. 지금은 항상 true. */
  projectConditionInferred: boolean;
  note: string;
};

export const ACTIVATED_PROFILE_TABLE = "analytics_install_profile";

/**
 * 교차 확인 SQL. `analytics_install_profile` 만 읽는다(events 재스캔 없음).
 * 임계값은 정의 상수에서 온다.
 */
export function activatedProfileSelectSql(): string {
  const c = AD_FUNNEL_PROFILE_COLUMNS;
  const n = ACTIVATED_MIN_TASKS_COMPLETED;
  return [
    `COUNTIF(first_run_at IS NOT NULL) AS ${c.installUnits}`,
    `COUNTIF(first_spawn_at IS NOT NULL) AS ${c.agentUnits}`,
    `COUNTIF(tasks_completed >= ${n}) AS ${c.taskMinUnits}`,
    `COUNTIF(first_run_at IS NOT NULL AND first_spawn_at IS NOT NULL ` +
      `AND tasks_completed >= ${n}) AS ${c.activatedUnits}`,
  ].join(",\n        ");
}

export function buildActivatedProfile(
  row: ActivatedProfileRow | null | undefined
): ActivatedProfile | null {
  if (row == null) return null;
  const c = AD_FUNNEL_PROFILE_COLUMNS;
  return {
    sourceKey: "install_profile",
    sourceLabel: `설치 프로필(${ACTIVATED_PROFILE_TABLE}) — 일별 롤업 기반`,
    installUnits: coerce(row[c.installUnits]),
    agentUnits: coerce(row[c.agentUnits]),
    taskMinUnits: coerce(row[c.taskMinUnits]),
    activatedUnits: coerce(row[c.activatedUnits]),
    projectConditionInferred: true,
    note:
      "★'실제 프로젝트' 조건은 이 테이블에 신호가 없어 Agent 스폰으로 대신 " +
      "읽었습니다(폴더 없이는 스폰이 안 되므로 추론입니다). Task 계측은 " +
      "렌더러 이벤트가 아니라 일별 롤업이라 events 축보다 넓습니다 — " +
      "두 값이 다르면 events 쪽이 과소계상입니다.",
  };
}

// ── ★재수출 — 소비처가 정의 소스를 한 곳으로만 보게 한다 ────────────────────
// index.ts 가 activatedDefinition 과 adFunnel 을 따로 import 하다 보면 언젠가 한쪽만
// 갱신된다. 이 모듈을 쓰는 쪽은 여기서 다 가져갈 수 있게 해 둔다.
export {
  ACTIVATED_MIN_TASKS_COMPLETED,
  activatedDefinition,
  isActivated,
  type ActivatedAxis,
  type ActivatedDefinition,
};
