/**
 * 5단 드릴다운 계약 — 조직 › 팀 › 프로젝트 › **사람** › **에이전트·모델**.
 *
 * 정본: `docs/org-analytics-b2b-design-2026-08-31.md` §4.1(층)·§4.3(L2 사람)·
 *       §4.4(에이전트 개체 축)·§5(성공사례 셋)·§6.1(권한표) ·
 *       `docs/org-team-layer-design-2026-08-31.md` §5(팀은 그룹핑)
 *
 * ★Phase 2(`orgUsageContract.ts`)가 조직›팀›프로젝트 세 단을 이미 냈다. 이
 *   파일은 **그 위에 두 단을 얹는 것**이지 다시 만드는 것이 아니다. 위 세 단의
 *   계약(`OrgUsageData`)은 한 글자도 안 건드린다.
 *
 * ★새 집계 파이프라인 0 · BQ 변경 0. 두 단은 **이미 배포된 두 콜러블을 프로젝트
 *   하나에 대해 부른 결과**를 여기서 접어서 만든다:
 *
 *     getTeamUsageSummary(projectId)  → byMember[]            (비용·토큰·모델)
 *     getTeamProjectAudit(projectId)  → summary·events·workload (성공/실패·머지)
 *
 * ★(티켓 uYcCq9DRPLT8ZEh0rlkh 추가) 실행 원장(`executionLedger`)만 예외로
 *   콜러블 하나(`getTeamProjectExecutionLedger`)가 새로 생겼다 — 집계 자체는
 *   `/admin` 과 공유하는 기존 `buildExecutionLedger` 그대로이고, 비용 축을
 *   실으므로 `getTeamProjectAudit`(금액 필드 0개가 설계 경계) 응답에 얹을 수
 *   없어 별도 콜러블·별도 게이트로 뒀다(`teamExecutionLedgerContract.ts` 상단
 *   주석에 근거).
 *
 * ── ★이 파일이 지키는 것 ────────────────────────────────────────────────────
 *
 *  1) ★**결측을 0 으로 그리지 않는다.** "미측정" 과 "0" 은 다른 사실이다. 그래서
 *     모든 칸이 숫자가 아니라 **상태**로 나간다(`teamUsageContract.UsageCell` 의
 *     여섯 종류를 그대로 계승 — 새 어휘를 만들지 않는다).
 *  2) ★**불변식 S ⊆ visible(u).** 보이는 합계는 그 사람이 볼 수 있는 집합의
 *     합이어야 한다. 아니면 "총계 − 내 것 = 남의 것" 이라는 **뺄셈 누수**가
 *     생긴다. Phase 2 는 이 검사를 프로젝트 집합에서 했고(`orgUsage.ts`
 *     `decideOrgUsageAccess`), 여기서는 **사람 집합으로 확장**한다 — 같은
 *     방식으로 역할 지름길이 아니라 **집합 포함 검사**다.
 *  3) ★**두 성공/실패 축을 절대 섞지 않는다.** 오늘 사람에게 붙는 성공/실패는
 *     **계정 축**(프로젝트 티켓 원장)뿐이다. 익명 설치 축(작업 결과 기록)의
 *     모델별 성공률은 Phase 4a 가 사람 가명 각인까지는 했지만 **그 축을 읽는
 *     뷰·콜러블이 아직 없다** — 그 칸은 `0%` 가 아니라 `미배선` 이고, 각인 이전 구간은 **영영**
 *     사람에게 안 붙는다. 화면이 그 경계를 말한다(§5.3 T₀).
 *  4) ★**모델 축이 섞여 있다는 사실을 화면이 말한다.** `cost_logs.model` 은
 *     구체 모델 id 로 씨앗이 심기지만(`v3/electron/cost-tracker.ts` 의
 *     `spawnedModelId`), 모델을 핀하지 않은 스폰과 그 수정 이전 행은 여전히
 *     **하네스족 문자열**(`claude`·`gpt`…)이다. 그 둘을 한 막대로 그리면
 *     solar·kimi·glm 스폰이 `claude` 로 뭉쳐 보인다(#1471 이 어드민에서 잡은
 *     바로 그 사고). 여기서는 **키를 분류해 라벨을 가른다** — 하네스족 값을
 *     실제 모델로 승격시키지 않는다.
 *  5) ★**에이전트 개체 축을 열지 않는다**(§4.4). 에이전트별 행 = 그 사람의 분(分)
 *     단위 작업 단위 = 감사 탭이 일부러 뺀 개인 행동 로그다. 이 파일은 모델·
 *     행위자종류·**개수**만 낸다. 프롬프트·응답 원문은 봉투에 애초에 없다.
 *
 * ★React·firebase 무의존. 그래서 `tsx --test` 로 그대로 돈다.
 */

import {
  isTeamMemberKey,
  type ByActorKindRow,
  type ByMemberRow,
  type ByModelRow,
  type TeamUsageEnvelope,
} from "../team/teamUsageContract";
import type {
  TeamAuditEnvelope,
  TeamAuditEvent,
  TeamAuditWorkloadRow,
} from "../team/teamAuditContract";
import type { TeamExecutionLedgerAxis } from "../team/teamExecutionLedgerContract";

// ════════════════════════════════════════════════════════════════════════════
// 1. 층 — 다섯 단. ★층을 늘리는 것이 아니라 있는 세 단 아래 두 단을 잇는다
// ════════════════════════════════════════════════════════════════════════════

export const DRILL_LEVELS = [
  "org",
  "team",
  "project",
  "person",
  "agentModel",
] as const;

export type DrillLevel = typeof DRILL_LEVELS[number];

/**
 * 지금 펼쳐진 자리.
 *
 * ★`teamId` 는 `null` 이 **정상 값**이다(미지정 버킷, #1336 §6). 그래서 "안
 * 내려갔다" 를 `null` 로 표현하지 않고 필드 부재(`undefined`)로 표현한다 —
 * 둘을 같은 값으로 접으면 미지정 팀을 펼친 상태가 조직 루트로 되돌아간다.
 */
export type DrillPath = {
  teamId?: string | null;
  projectId?: string;
  memberKey?: string;
};

/** 이 경로가 가리키는 층. ★상위가 없는데 하위만 있는 경로는 상위에서 끊는다. */
export function drillLevelOf(path: DrillPath): DrillLevel {
  if (path.teamId === undefined) return "org";
  if (path.projectId === undefined) return "team";
  // ★가명 공간 밖 키로는 사람 단에 못 내려간다 — 원시 uid 를 경로에 실어
  //   드릴다운을 여는 경로 자체를 막는다.
  if (path.memberKey === undefined || !isTeamMemberKey(path.memberKey)) {
    return "project";
  }
  return "person";
}

/** 한 단 올라간 경로. 조직 루트에서는 그대로다. */
export function parentDrillPath(path: DrillPath): DrillPath {
  switch (drillLevelOf(path)) {
    case "person":
      return { teamId: path.teamId, projectId: path.projectId };
    case "project":
      return { teamId: path.teamId };
    case "team":
      return {};
    default:
      return {};
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. ★모델 축 분류 — 하네스족을 실제 모델로 승격시키지 않는다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 하네스족 id. ★정본은 `v3/electron/model-registry.ts` 의 `HARNESS_IDS` 이고
 * 여기는 그 거울이다(웹은 electron 을 import 할 수 없다). 어긋나면
 * `orgDrilldownContract.test.ts` 의 표류 검사가 정본 파일을 읽어 실패시킨다 —
 * 목록이 조용히 갈라지면 새 하네스가 실제 모델로 둔갑한다.
 */
export const HARNESS_FAMILY_IDS = [
  "claude",
  "gemini",
  "gpt",
  "grok",
  "antigravity",
  "local",
  "custom",
] as const;

const HARNESS_FAMILY_SET: ReadonlySet<string> = new Set(HARNESS_FAMILY_IDS);

/** 서버가 빈 모델명을 접는 값(`teamUsage.foldTeamUsage`). 화면이 이 문자열을 안다. */
export const MODEL_UNKNOWN_KEY = "(미상)";

/**
 * 한 모델 키가 무엇인가.
 *
 * - `model`       — 구체 모델 id 다. 이 값은 그대로 그려도 된다.
 * - `harnessOnly` — **하네스족 이름**이 모델 자리에 앉아 있다. 실제 모델은
 *                   **미상**이다. ★"이 사람은 claude 를 썼다" 로 그리면 안 된다 —
 *                   그 밑에 solar·kimi·glm·deepseek·minimax 가 뭉쳐 있을 수 있다.
 * - `unknown`     — 모델명이 아예 없었다. `0` 도 아니고 하네스도 아니다.
 */
export type ModelAxis =
  | { kind: "model"; modelId: string }
  | { kind: "harnessOnly"; harnessId: string }
  | { kind: "unknown" };

/**
 * 모델 키 → 축 판정. ★지어내지 않는다(#1471 `deriveEffectiveModel` 과 같은 규율).
 *
 * ★그 함수와 **계약이 다르다**: `deriveEffectiveModel` 은 분포의 **버킷 키**를
 * 만드느라 없으면 하네스로 폴백한다. 여기는 **행의 모델 칸**이라 폴백하면
 * 하네스가 실제 모델 자리에 앉는다. 그래서 통합하지 않고 나란히 둔다
 * (형제 티켓 6X5zmTY5OUKI4Sxwufqo 의 `readAgentModelAxes` 와 같은 판정).
 */
export function classifyModelKey(key: string | null | undefined): ModelAxis {
  const raw = typeof key === "string" ? key.trim() : "";
  if (raw === "" || raw === MODEL_UNKNOWN_KEY) return { kind: "unknown" };
  // 효과(@high)는 축이 아니다 — 단가·집계 축은 모델 id 다(cost_logs 관례).
  const bare = raw.split("@")[0].trim();
  if (bare === "") return { kind: "unknown" };
  if (HARNESS_FAMILY_SET.has(bare.toLowerCase())) {
    return { kind: "harnessOnly", harnessId: bare.toLowerCase() };
  }
  return { kind: "model", modelId: bare };
}

export type DrilldownModelRow = {
  axis: ModelAxis;
  /** 정렬·키용 원본 문자열. 화면이 라벨로 쓰지 않는다(축에 따라 문구가 다르다). */
  rawKey: string;
  costUsd: number;
  tokens: number;
};

/**
 * 모델 행들을 축 판정과 함께 접는다. ★두 축의 금액을 **따로 센다** — 화면이
 * "이만큼은 실제 모델을 안다 / 이만큼은 모른다" 를 숫자로 말할 수 있게.
 */
export type ModelAxisFold = {
  rows: DrilldownModelRow[];
  measuredCostUsd: number;
  /** ★하네스족으로만 남은 금액. 0 이 아니면 화면이 그 사실을 말해야 한다. */
  harnessOnlyCostUsd: number;
  unknownCostUsd: number;
};

export function foldModelAxis(rows: ReadonlyArray<ByModelRow>): ModelAxisFold {
  let measuredCostUsd = 0;
  let harnessOnlyCostUsd = 0;
  let unknownCostUsd = 0;
  const out: DrilldownModelRow[] = rows.map((r) => {
    const axis = classifyModelKey(r.model);
    if (axis.kind === "model") measuredCostUsd += r.costUsd;
    else if (axis.kind === "harnessOnly") harnessOnlyCostUsd += r.costUsd;
    else unknownCostUsd += r.costUsd;
    return { axis, rawKey: r.model, costUsd: r.costUsd, tokens: r.tokens };
  });
  // 금액 내림차순. ★같은 금액이면 실제 모델을 먼저 — 하네스족이 위에 서면
  //   표의 첫 줄이 "미상" 이 되어 화면이 모르는 것부터 말한다.
  out.sort(
    (a, b) =>
      b.costUsd - a.costUsd ||
      axisRank(a.axis) - axisRank(b.axis) ||
      a.rawKey.localeCompare(b.rawKey)
  );
  return {
    rows: out,
    measuredCostUsd: round6(measuredCostUsd),
    harnessOnlyCostUsd: round6(harnessOnlyCostUsd),
    unknownCostUsd: round6(unknownCostUsd),
  };
}

function axisRank(a: ModelAxis): number {
  return a.kind === "model" ? 0 : a.kind === "harnessOnly" ? 1 : 2;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. ★사람 › 에이전트·모델 — 5단째. "없음" 을 네 가지로 가른다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 한 사람의 모델 분해 상태.
 *
 * ★배열 길이로 판정하지 않는다. `[]` 는 최소 세 가지 뜻이라, 길이로 접으면
 * "옛 배포라 안 보냈다" 가 "이 사람은 아무 모델도 안 썼다" 로 둔갑한다.
 *
 * - `measured`  — 실측 분해가 있다.
 * - `noRows`    — 이 창에 이 사람 행이 **없다**(`hasRows === false`). ★"안 썼다"
 *                 가 아니라 "안 보냈다" 일 수 있다(텔레메트리 옵트아웃) — 그
 *                 문장은 봉투의 `coverage.telemetryOptOutNote` 가 실어 나른다.
 * - `unknown`   — 스코프가 잘려 판정을 **안 한다**(`hasRows === null`). 잘린
 *                 표본 위의 부정 판정은 누락이 아니라 오탐이다.
 * - `unwired`   — 행은 있는데(`hasRows === true`) 분해가 안 왔다 = **계약 미배선**
 *                 (옛 배포). ★이걸 `noRows` 로 접으면 배포 갭이 사람에 대한
 *                 판단으로 둔갑한다.
 */
export type MemberModelAxis =
  | { kind: "measured"; fold: ModelAxisFold; byActorKind: ByActorKindRow[] }
  | { kind: "noRows" }
  | { kind: "unknown" }
  | { kind: "unwired" };

export function memberModelAxisOf(member: ByMemberRow): MemberModelAxis {
  if (member.hasRows === null) return { kind: "unknown" };
  if (member.hasRows === false) return { kind: "noRows" };
  // hasRows === true 이거나 서버가 안 준 경우(null 은 위에서 걸렀다).
  if (member.byModel.length === 0 && member.byActorKind.length === 0) {
    return { kind: "unwired" };
  }
  return {
    kind: "measured",
    fold: foldModelAxis(member.byModel),
    byActorKind: [...member.byActorKind].sort((a, b) => b.costUsd - a.costUsd),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 계정 축 원장 — 성공/실패·머지를 **사람에게** 붙인다 (§5.1 (a))
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★`getTeamUsageSummary.byMember[].memberKey` 와
 *   `getTeamProjectAudit.events[].memberKey` 는 **같은 가명 공간**이다 — 둘 다
 *   서버에서 `pseudonymizeAnalyticsId("teamMember", uid, readAnalyticsIdSalt())`
 *   를 지난다. 그래서 이 조인은 원시 uid 를 한 번도 지나지 않고, 새 다리를
 *   놓지도 않는다. **이 사실이 5단을 가능하게 하는 유일한 근거다.**
 *
 * ★그리고 조인은 **한 프로젝트 안에서만** 성립한다. 두 봉투가 같은 프로젝트의
 *   것이 아니면 같은 가명이 다른 사람일 수 있는 게 아니라(가명은 uid 함수라
 *   전역이다) **권한 경계가 다르다** — 그래서 호출부가 프로젝트를 짝지어 준다.
 */
export type PersonLedgerRow = {
  memberKey: string;
  /** 이 사람이 상태를 바꾼 티켓 수(중복 제거). */
  tasksTouched: number;
  /** 원장 행이 성공으로 남은 건수. */
  successes: number;
  /** 원장 행이 실패로 남은 건수. */
  failures: number;
  /** `merge_and_close` 행 수 — ★번호가 아니라 **건수**다(아래 주석). */
  merges: number;
  /** 이 사람에게 붙은 원장 사건 총수. */
  events: number;
};

/**
 * 프로젝트 원장의 사람 축 상태.
 *
 * - `restricted` — 그 프로젝트의 owner/admin 이 아니다. ★조직 관리자라도 여기서
 *                  막힌다(§6.1 "조직 역할은 프로젝트 내용을 주지 않는다"). 숫자를
 *                  그리지 않고 무엇이 필요한지만 말한다.
 * - `unwired`    — 봉투에 상태 축이 없다(계약 미배선).
 * - `empty`      — 권한은 있고 창 안에 사건이 0 건이다.
 * - `measured`   — 실측. `partial` 이면 `truncated: true` 로 "전부가 아니다" 를 싣는다.
 */
export type LedgerPersonAxis =
  | {
      kind: "measured";
      rows: PersonLedgerRow[];
      /**
       * ★사람이 안 붙은 머지 건수. `merge_history` 문서에는 **행위자 필드가 아예
       * 없어서** 그 행의 `memberKey` 는 항상 `null` 이다. 그래서 **병합 요청
       * 번호는 사람 축에 붙지 않는다** — 프로젝트 축에서만 센다. 이 숫자를 0 으로
       * 접거나 아무에게나 붙이면 화면이 거짓말한다.
       */
      unattributedMerges: number;
      /** 사람이 안 붙은 머지 중 번호를 읽을 수 있었던 건수(프로젝트 축 표시용). */
      mergeRequestNumbers: number[];
      /** 스캔이 잘렸거나 소스 일부가 빠졌다 — 합계가 전부가 아니다. */
      truncated: boolean;
    }
  | { kind: "empty" }
  | {
      kind: "restricted";
      requires: "project_admin";
      reasonCode: string | null;
      reason: string | null;
    }
  | { kind: "unwired" };

/** 이 사건이 성공/실패 판정을 담고 있나. `null` 은 판정 없음이지 실패가 아니다. */
function outcomeOf(e: TeamAuditEvent): "success" | "failure" | null {
  if (e.success === true) return "success";
  if (e.success === false) return "failure";
  return null;
}

export function foldLedgerPersonAxis(
  audit: TeamAuditEnvelope | null
): LedgerPersonAxis {
  if (audit === null) return { kind: "unwired" };
  const gate = audit.teamAudit;
  // 봉투에 상태 축이 없다 = 계약 미배선. 모르는 것을 0 으로 그리지 않는다.
  if (gate === null) return { kind: "unwired" };
  if (gate.state === "disabled") {
    return {
      kind: "restricted",
      // ★역할 이름만 담는다 — 조직·프로젝트 식별자를 담으면 존재가 샌다.
      requires: "project_admin",
      reasonCode: gate.reasonCode,
      reason: gate.reason,
    };
  }
  if (gate.state === "empty" && audit.events.length === 0) {
    return { kind: "empty" };
  }

  const byMember = new Map<
    string,
    PersonLedgerRow & { taskIds: Set<string> }
  >();
  let unattributedMerges = 0;
  const mergeRequestNumbers: number[] = [];

  for (const e of audit.events) {
    if (e.merge !== null) {
      // `merge_history` 행 — 행위자가 없다. 사람에게 붙이지 않는다.
      unattributedMerges += 1;
      if (typeof e.merge.prNumber === "number") {
        mergeRequestNumbers.push(e.merge.prNumber);
      }
      continue;
    }
    // ★가명 공간을 벗어난 키는 버린다(정규화가 이미 걸렀지만 이중 방어).
    if (!isTeamMemberKey(e.memberKey)) continue;
    const key = e.memberKey;
    let row = byMember.get(key);
    if (!row) {
      row = {
        memberKey: key,
        tasksTouched: 0,
        successes: 0,
        failures: 0,
        merges: 0,
        events: 0,
        taskIds: new Set<string>(),
      };
      byMember.set(key, row);
    }
    row.events += 1;
    if (e.taskId) row.taskIds.add(e.taskId);
    if (e.kind === "merge") row.merges += 1;
    const outcome = outcomeOf(e);
    if (outcome === "success") row.successes += 1;
    else if (outcome === "failure") row.failures += 1;
  }

  const rows: PersonLedgerRow[] = [...byMember.values()]
    .map(({ taskIds, ...rest }) => ({ ...rest, tasksTouched: taskIds.size }))
    .sort(
      (a, b) =>
        b.events - a.events ||
        b.tasksTouched - a.tasksTouched ||
        a.memberKey.localeCompare(b.memberKey)
    );

  return {
    kind: "measured",
    rows,
    unattributedMerges,
    mergeRequestNumbers,
    // ★조용한 절단 금지 — partial 은 "합계가 전부가 아니다" 라는 뜻이다.
    truncated: gate.state === "partial",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. ★사람 축 성과(익명 설치 축) — T₀ 경계. 오늘은 **미배선**이다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 모델별 성공률을 **사람 축**으로 보는 칸의 상태.
 *
 * ★2026-09-07(티켓 85dkAQMiYauFwg1Z9kaH, 사장님 지시): `getTeamProjectOutcomeAxis`
 *   콜러블이 배선됐다 — 익명 설치 축의 사람별·모델별 성공률을 이제 실제로
 *   읽는다(원본 표 이름은 서버 쪽 `personAxis.ts` §7b 에만 있다 — 클라이언트
 *   계약은 모양만 안다, `org-usage-axis-guard.test.ts` 의 축 순수성 규율).
 *   다리는 여전히 `user` kind 가명 하나뿐이다. `byModel` 은 **분류하지 않은
 *   원본 모델 문자열**을 담는다 — 하네스족/실모델/미상 판정은
 *   `classifyModelKey`(§2, 이 파일)가 하나만 한다. 두 벌을 두면 어느 쪽이
 *   정본인지 갈린다.
 *
 * ★그리고 T₀ **이전 구간은 영영 안 붙는다** — 각인은 forward-only 이고 백필을
 *   하지 않는다(#1320 규약). 화면이 그 경계를 말하지 않으면, 나중에 이 칸이
 *   켜졌을 때 "왜 작년 데이터가 없지" 가 버그로 보고된다.
 */
export type PersonOutcomeModelRow = {
  /** 익명 설치 축 작업 결과의 모델 칸 원본. `classifyModelKey` 로 분류해서 그린다. */
  model: string | null;
  decided: number;
  successes: number;
};

export type PersonOutcomeAxis =
  | { kind: "unwired"; reason?: string | null }
  | {
      kind: "pending";
      /** 각인이 시작된 날(데이터에서 읽은 값). ★env 값을 그리지 않는다. */
      stampedFrom: string | null;
    }
  | {
      kind: "measured";
      stampedFrom: string | null;
      decided: number;
      successes: number;
      /** ★모델별 분해. 표본이 작은 모델도 그대로 실린다 — 표본 억제는
       *  `canDrawSuccessRate` 가 그릴 때 한다(계산과 판정을 안 섞는다). */
      byModel: PersonOutcomeModelRow[];
    };

/**
 * ★사람당 판정 최소 표본(설계 §5.3). 성공률 p≈0.94 에서 95% 신뢰구간 폭이
 * ±8%p 가 되는 최소값 — 이보다 적으면 **퍼센트를 그리지 않고** `n/35` 로 그린다.
 * 2명·4명을 %로 접으면 발표에 없는 정밀도가 실린다.
 */
export const PERSON_OUTCOME_MIN_SAMPLE = 35;

/**
 * 표본이 퍼센트를 감당하나. ★`false` 면 화면은 비율 대신 건수를 그린다.
 */
export function canDrawSuccessRate(decided: number): boolean {
  return Number.isFinite(decided) && decided >= PERSON_OUTCOME_MIN_SAMPLE;
}

/**
 * 성공률. 분모가 0 이면 **모른다**(`0%` 가 아니다). 표본이 모자라도 값은
 * 돌려주되, 그릴지 말지는 `canDrawSuccessRate` 가 정한다 — 두 판정을 한
 * 함수에 섞으면 호출부가 둘 중 하나를 잊는다.
 */
export function successRateOf(
  successes: number,
  decided: number
): number | null {
  if (!Number.isFinite(decided) || decided <= 0) return null;
  return successes / decided;
}

/**
 * 오늘의 사람 축 성과 상태. ★상수처럼 보이지만 함수다 — 뷰·콜러블이 배선되면
 * 호출부가 봉투를 넘기게 되고, 그때 이 함수 하나만 갈면 화면이 따라온다.
 */
export function personOutcomeAxisOf(
  envelope: unknown | null | undefined
): PersonOutcomeAxis {
  if (envelope == null) return { kind: "unwired" };
  const r =
    typeof envelope === "object" && !Array.isArray(envelope)
      ? (envelope as Record<string, unknown>)
      : null;
  if (!r) return { kind: "unwired" };
  if (r.__disabled === true) {
    return {
      kind: "unwired",
      reason: typeof r.reason === "string" ? r.reason : null,
    };
  }
  const stampedFrom =
    typeof r.stampedFrom === "string" && r.stampedFrom !== ""
      ? r.stampedFrom
      : null;
  const decided = typeof r.decided === "number" ? r.decided : null;
  const successes = typeof r.successes === "number" ? r.successes : null;
  if (decided === null || successes === null)
    return { kind: "pending", stampedFrom };
  return {
    kind: "measured",
    stampedFrom,
    decided,
    successes,
    byModel: parsePersonOutcomeModelRows(r.byModel),
  };
}

/** `byModel` 배열 방어 파싱 — 깨진 항목은 조용히 버린다(그 항목만, 나머지는 산다). */
function parsePersonOutcomeModelRows(v: unknown): PersonOutcomeModelRow[] {
  if (!Array.isArray(v)) return [];
  const out: PersonOutcomeModelRow[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const decided = typeof o.decided === "number" ? o.decided : null;
    const successes = typeof o.successes === "number" ? o.successes : null;
    if (decided === null || successes === null) continue;
    out.push({
      model: typeof o.model === "string" ? o.model : null,
      decided,
      successes,
    });
  }
  return out;
}

/**
 * ★팀 전체 성과 봉투(`getTeamProjectOutcomeAxis` 원문)에서 한 사람 몫만 뽑는다.
 * 팀 봉투가 `disabled` 면 사유를 실어 `unwired` 로 접고, 그 사람 행이 없으면
 * (아직 결정 건이 0건이거나 로스터 계산 전) `pending` 으로 접는다 —
 * `personOutcomeAxisOf` 가 그 다음을 잇는다. 이 함수 자체는 uid 를 보지
 * 않는다 — 서버가 이미 `memberKey` 로 접어 보낸 것을 그대로 찾을 뿐이다.
 */
export function personOutcomeEnvelopeFor(
  teamEnvelope: unknown | null | undefined,
  memberKey: string
): unknown | null {
  if (teamEnvelope == null) return null;
  const r =
    typeof teamEnvelope === "object" && !Array.isArray(teamEnvelope)
      ? (teamEnvelope as Record<string, unknown>)
      : null;
  if (!r) return null;
  if (r.state === "disabled") {
    return {
      __disabled: true,
      reason: typeof r.reason === "string" ? r.reason : null,
    };
  }
  const stampedFrom = typeof r.stampedFrom === "string" ? r.stampedFrom : null;
  const members = Array.isArray(r.members) ? r.members : [];
  const found = members.find(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>).memberKey === memberKey
  ) as Record<string, unknown> | undefined;
  if (!found) return { stampedFrom };
  return { ...found, stampedFrom };
}

// ════════════════════════════════════════════════════════════════════════════
// 6. ★불변식 S ⊆ visible(u) — 사람 집합으로 확장 (#1205 §3.3 · Phase 2 계승)
// ════════════════════════════════════════════════════════════════════════════

/**
 * S ⊆ visible 인가. `orgUsage.isScopeVisible` 과 **같은 검사**를 화면 쪽에서 한
 * 번 더 한다(심층 방어). 서버가 실수로 부분집합을 실어 보내도 화면이 그것을
 * 총계로 그리지 않게 하는 자리다.
 */
export function isSubsetVisible(
  scopeIds: ReadonlyArray<string>,
  visibleIds: ReadonlyArray<string>
): boolean {
  const visible = new Set(visibleIds);
  return scopeIds.every((id) => visible.has(id));
}

export type PersonScopeAccess =
  | { kind: "full" }
  | { kind: "restricted"; requires: "project_admin" };

/**
 * 이 사람이 이 프로젝트에서 **사람 분해로 볼 수 있는** 멤버 집합.
 *
 * ★`orgUsage.resolveOrgVisibleProjects` 의 사람 축 짝이다. 같은 규율: 전수
 * 아니면 **공집합**이고, 그 사이는 없다. 부분집합을 돌려주면 그 합계가 "이
 * 프로젝트 전체" 로 읽혀 불변식이 깨진다(총계 − 내 것 = 남의 것).
 *
 * 권한의 출처는 **원장 봉투의 게이트**다 — 화면이 역할을 다시 계산하지 않는다.
 * 서버가 그 프로젝트의 owner/admin 을 확인해 `disabled(no_role)` 로 닫아 주고,
 * 여기는 그 판정을 집합으로 옮길 뿐이다(조직 역할은 여기 입력되지 않는다 —
 * §6.1 "조직 역할은 프로젝트 내용을 주지 않는다").
 */
export function resolveVisibleMembers(
  ledger: LedgerPersonAxis,
  memberKeys: ReadonlyArray<string>
): string[] {
  return ledger.kind === "restricted" ? [] : [...memberKeys];
}

/**
 * 사람 단의 합계를 그려도 되나.
 *
 * ★역할 문자열로 판정하지 않는다. 판정 근거는 **집합 포함**이다:
 *   S = 화면이 사람 행으로 그릴 집합
 *   visible(u) = `resolveVisibleMembers` 가 돌려주는 집합
 *
 * 이 분업이 요점이다: 나중에 "팀장은 자기 팀 멤버만" 같은 **부분 가시 역할**이
 * 생겨도 `resolveVisibleMembers` 만 고치면 되고, 이 함수를 지나는 한 부분집합이
 * 총계로 나가는 경로가 생기지 않는다. Phase 2 의 `decideOrgUsageAccess` 가
 * 프로젝트 집합에서 지킨 것과 **같은 구조**다.
 */
export function decidePersonScopeAccess(
  memberKeys: ReadonlyArray<string>,
  ledger: LedgerPersonAxis
): PersonScopeAccess {
  const visible = resolveVisibleMembers(ledger, memberKeys);
  return isSubsetVisible(memberKeys, visible)
    ? { kind: "full" }
    : { kind: "restricted", requires: "project_admin" };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 4단 조립 — 한 프로젝트의 사람 행
// ════════════════════════════════════════════════════════════════════════════

export type DrilldownPersonRow = {
  memberKey: string;
  displayName: string | null;
  /** 비용 칸. ★숫자가 아니라 **상태**다(`PersonCostCell` 주석 참고). */
  cost: PersonCostCell;
  tokens: number | null;
  /** 5단째 — 이 사람의 모델·행위자종류 분해. */
  models: MemberModelAxis;
  /** 계정 축 원장의 이 사람 몫. 없으면 `null`(사건이 안 붙었다). */
  ledger: PersonLedgerRow | null;
  /** 익명 설치 축 성과. 오늘은 항상 `unwired`. */
  outcome: PersonOutcomeAxis;
};

export type DrilldownProjectDetail =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      /** ★사용량은 보이는데 원장 권한이 없다 — 사람 행을 **0 으로 접지 않는다**. */
      kind: "restricted";
      requires: "project_admin";
      reasonCode: string | null;
      reason: string | null;
    }
  | {
      kind: "data";
      persons: DrilldownPersonRow[];
      ledger: LedgerPersonAxis;
      /** 프로젝트 축 에이전트 워크로드(개체 나열이 아니라 행 그대로 — §4.4). */
      workload: TeamAuditWorkloadRow[];
      /** 프로젝트 전체의 모델 분해(사람이 안 붙은 행까지 포함). */
      projectModels: ModelAxisFold;
      /** ★사람에게 안 붙은 사용량 행 수. 0 이 아니면 사람 축 합 < 프로젝트 합. */
      unattributedRows: number | null;
      /** 성공/실패 요약(계정 축, 프로젝트 단위). */
      tasksDone: number | null;
      tasksFailed: number | null;
      tasksOpen: number | null;
      /**
       * ★Mission→Ticket→Agent→Model→Cost→Result 한 줄(티켓
       * uYcCq9DRPLT8ZEh0rlkh). 사람 축(`ledger`)과 독립된 별도 게이트다 —
       * 비용을 싣기 때문에 owner/admin 이어도 `TEAM_USAGE_EFFECTIVE_FROM`
       * 게이트가 닫혀 있으면 `restricted` 다(사람 축은 그 게이트가 없다).
       */
      executionLedger: TeamExecutionLedgerAxis;
    };

/**
 * 한 프로젝트의 4·5단을 조립한다.
 *
 * @param usage `getTeamUsageSummary({projectId})` 정규화 결과. `null` = 못 불렀다.
 * @param audit `getTeamProjectAudit({projectId})` 정규화 결과. `null` = 못 불렀다.
 * @param executionLedger `getTeamProjectExecutionLedger({projectId})` 정규화
 *   결과. 생략하거나 `null` 이면 `unwired`(콜러블을 안 불렀거나 구 배포) —
 *   티켓 uYcCq9DRPLT8ZEh0rlkh.
 * @param outcomeAxis `getTeamProjectOutcomeAxis({projectId})` 원문 응답.
 *   생략하거나 `null` 이면 사람마다 `unwired`(콜러블을 안 불렀거나 구 배포) —
 *   티켓 85dkAQMiYauFwg1Z9kaH. 세 번째 인자와 같은 규약(옵션 + 기본값).
 *
 * ★네 봉투는 **같은 프로젝트**의 것이어야 한다. 호출부가 짝지어 준다.
 */
export function buildProjectDetail(
  usage: TeamUsageEnvelope | null,
  audit: TeamAuditEnvelope | null,
  executionLedger: TeamExecutionLedgerAxis | null = { kind: "unwired" },
  outcomeAxis: unknown | null = null
): DrilldownProjectDetail {
  const ledger = foldLedgerPersonAxis(audit);
  // ★원장이 막혔으면 사람 단을 열지 않는다. 사용량 봉투에 멤버 행이 있어도
  //   마찬가지다 — 두 축 중 하나라도 막히면 그 사람은 이 프로젝트의 사람
  //   분해를 볼 권한이 없다(§6.1 권한표: 조직 역할은 프로젝트 내용을 안 준다).
  if (ledger.kind === "restricted") {
    return {
      kind: "restricted",
      requires: "project_admin",
      reasonCode: ledger.reasonCode,
      reason: ledger.reason,
    };
  }
  if (usage === null && audit === null) return { kind: "error" };

  const members = usage?.byMember ?? [];
  const access = decidePersonScopeAccess(
    members.map((m) => m.memberKey),
    ledger
  );
  if (access.kind === "restricted") {
    return {
      kind: "restricted",
      requires: "project_admin",
      reasonCode: null,
      reason: null,
    };
  }

  const ledgerByKey = new Map<string, PersonLedgerRow>(
    ledger.kind === "measured" ? ledger.rows.map((r) => [r.memberKey, r]) : []
  );

  const persons: DrilldownPersonRow[] = members.map((m) => ({
    memberKey: m.memberKey,
    displayName: m.displayName,
    cost: personCostCell(m),
    // ★기록이 없거나 모르는 사람의 토큰은 `0` 이 아니라 `null` 이다.
    tokens: m.hasRows === true ? m.tokens : null,
    models: memberModelAxisOf(m),
    ledger: ledgerByKey.get(m.memberKey) ?? null,
    outcome: personOutcomeAxisOf(
      personOutcomeEnvelopeFor(outcomeAxis, m.memberKey)
    ),
  }));

  const summary = audit?.summary ?? null;
  return {
    kind: "data",
    persons,
    ledger,
    workload: audit?.workload ?? [],
    projectModels: foldModelAxis(usage?.byModel ?? []),
    unattributedRows: usage?.coverage?.unattributedRows ?? null,
    tasksDone: summary?.tasksDone ?? null,
    tasksFailed: summary?.tasksFailed ?? null,
    tasksOpen: summary?.tasksOpen ?? null,
    executionLedger: executionLedger ?? { kind: "unwired" },
  };
}

/**
 * 한 사람의 비용 칸. ★세 부재를 **셋 다 다르게** 그린다.
 *
 *   `hasRows === true`  → `measured`. 금액이 0 이어도 **진짜 0** 이다("실측 0").
 *   `hasRows === false` → `noRecords`. 기록이 없다. ★"안 썼다" 가 아니라
 *                         "안 보냈다"(텔레메트리 옵트아웃)일 수 있다 — 그
 *                         문장은 봉투의 `coverage.telemetryOptOutNote` 가 실어
 *                         나른다. 숫자를 그리지 않는다.
 *   `hasRows === null`  → `unknown`. 스코프가 잘려 **판정을 안 했다**. 잘린 표본
 *                         위의 부정 판정은 누락이 아니라 **오탐**이고, 그 오탐은
 *                         사람에 대한 판단이 된다.
 *
 * ★왜 `UsageCell` 을 그대로 쓰지 않나: 그 어휘의 여섯 종류 중 "모른다" 에
 * 대응하는 칸이 없다. `unwired`(계약 미배선)나 `pending`(적재 전)으로 접으면
 * **다른 사실**로 둔갑한다 — 낱말을 재사용하려고 뜻을 구부리는 쪽이, 낱말을
 * 하나 더 두는 쪽보다 나쁘다. 대신 `restricted` 는 여기서 안 만든다: 권한은
 * 사람 **칸**이 아니라 프로젝트 **단** 전체에서 닫힌다(§6.1).
 */
export type PersonCostCell =
  | { kind: "measured"; costUsd: number; tokens: number }
  | { kind: "noRecords" }
  | { kind: "unknown" };

export function personCostCell(member: ByMemberRow): PersonCostCell {
  if (member.hasRows === true) {
    return { kind: "measured", costUsd: member.costUsd, tokens: member.tokens };
  }
  if (member.hasRows === false) return { kind: "noRecords" };
  return { kind: "unknown" };
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 합계 대조 — 사람 축 합은 프로젝트 합이 **아닐 수 있다**
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★사람 축을 다 더해도 프로젝트 합보다 작을 수 있다. 이유는 둘이고 **둘 다
 * 정상**이다:
 *   1. 귀속 불가 행(`coverage.unattributedRows`) — 어느 사람에게도 안 붙는다.
 *   2. 가명을 못 만든 멤버(솔트 부재)는 목록에서 빠진다.
 *
 * 그래서 화면은 사람 행의 합을 "프로젝트 총계" 로 그리면 안 되고, 차이가 있으면
 * **그 차이를 말해야** 한다. 이 함수는 그 판정을 한 자리에 모은다.
 */
export type PersonSumReconciliation = {
  personSumUsd: number;
  projectTotalUsd: number | null;
  /** 프로젝트 합 − 사람 합. `null` = 프로젝트 합을 모른다(대조 안 함). */
  gapUsd: number | null;
  /** 차이를 화면이 밝혀야 하나. */
  hasGap: boolean;
};

/** 금액 대조 허용오차 — 버킷마다 6자리 반올림하므로 정확히 같지 않다. */
export function sumToleranceUsd(bucketCount: number): number {
  return (Math.max(1, bucketCount) + 1) * 5e-7;
}

export function reconcilePersonSum(
  persons: ReadonlyArray<DrilldownPersonRow>,
  projectTotalUsd: number | null
): PersonSumReconciliation {
  const personSumUsd = round6(
    persons.reduce(
      (acc, p) => acc + (p.cost.kind === "measured" ? p.cost.costUsd : 0),
      0
    )
  );
  if (projectTotalUsd === null) {
    return { personSumUsd, projectTotalUsd: null, gapUsd: null, hasGap: false };
  }
  const gapUsd = round6(projectTotalUsd - personSumUsd);
  return {
    personSumUsd,
    projectTotalUsd,
    gapUsd,
    hasGap: Math.abs(gapUsd) > sumToleranceUsd(persons.length),
  };
}
