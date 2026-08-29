// 이벤트 행 사람키 각인(stamp) — 순수 로직(BQ/Firebase 무의존).
// personAxis.ts / analyticsPseudonym.ts 와 같은 규약으로 node --test 로 검증한다.
//
// 설계 정본: v3/docs/person-axis-event-stamp-2026-08-29.md.
// 선행 정본: v3/docs/person-axis-user-key-design-2026-08-21.md §5.4-b (추기).
//
// ── ★이 모듈은 선행 설계의 결정 하나를 뒤집는다. 근거를 여기 남긴다 ─────────
// #1081 설계 §5.4 는 "소급을 저장이 아니라 조회로 한다. 이벤트 행에 `user_key`
// 컬럼을 만들지 않는다" 고 못박았다. 이 모듈은 그 컬럼을 만든다. 왜:
//
//  1) ★**배포된 처리방침이 이미 그렇게 고지하고 있다.** privacyContent.tsx
//     "비식별 1차 지표(BigQuery)" 항 원문: "…가명처리해 만든 가명 구분값을
//     **이 기록에 함께 적습니다**." 즉 방침이 코드보다 앞서 있었다 — 링크표만
//     쓰는 현행 구현은 방침을 **과소 구현**한 상태다. 이 각인은 방침 확장이
//     아니라 코드를 방침에 맞추는 일이다.
//  2) 같은 문장이 "통계에서 **운영자 본인의 활동을 빼는 것**" 도 약속한다.
//     지금 그건 안 된다 — `adminEventExclusion()`(index.ts)의 절은 계정축
//     은퇴 이후 행에서 항상 NULL 로 통과해 아무것도 제외하지 못한다.
//     각인이 있으면 조인 없이 그 약속이 지켜진다.
//  3) 링크표로는 **공용 기기의 행을 못 가른다.** 설계 §5.5 는 한 설치에 계정이
//     둘이면 그 설치를 통째로 **제외**한다(값을 만들지 않고 센다). 각인된 행은
//     그 행을 누가 만들었는지 안다 — 제외 대신 귀속이 된다.
//
// ── ★그래도 선행 설계가 옳았던 부분은 그대로 둔다 ───────────────────────────
//  - **링크표는 남는다.** 과거 43만 행은 각인이 없고, 링크표만이 그걸 소급으로
//    붙일 수 있다(`v_person_all_time`). 각인은 forward-only 이고 소급을 대체하지
//    못한다. 둘은 배타적이지 않다 — 앞으로는 각인, 과거는 링크표다.
//  - **되돌릴 수 있어야 한다.** 각인 컬럼은 NULLABLE 이고, PIPA 제36조 삭제요청은
//    `UPDATE events SET userKey = NULL WHERE userKey = @k` 한 줄이다. 실측
//    2026-08-29: `events` 는 437,114행 / 68MB 라 이 UPDATE 가 싸다.
//    ★`agent_heartbeats`(14,502,795행 / 1,753MB)에는 **각인하지 않는다** —
//    같은 논거가 그 표에서는 성립하지 않는다(삭제 비용이 25배).
//
// ── ★솔트를 SQL 에 넣지 마라 (personAxis.ts 계승) ───────────────────────────
//   HMAC 은 전부 Node 안에서 계산한다. BQ 로 나가는 SQL·파라미터에는 원시 uid 도
//   솔트도 없다. BQ 는 쿼리 본문을 job 히스토리에 수개월 보관한다.

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";
import { buildPersonAxisEraseSql, type PersonAxisGate } from "./personAxis";

// ════════════════════════════════════════════════════════════════════════════
// 1. 컬럼 이름 — 한 번 만들면 못 지운다
// ════════════════════════════════════════════════════════════════════════════

/**
 * `events` 에 추가하는 사람키 컬럼 이름.
 *
 * ★왜 `user_key` 가 아니라 `userKey` 인가: `events` 의 컬럼은 전부 camelCase 다
 * (`userId`, `appVersion`, `projectId`, `taskId`, `parentAgentId` …). 그 표
 * 안에서만 snake_case 를 쓰면 다음 사람이 "다른 데서 복사해 온 컬럼" 으로 읽는다.
 * 값·kind·솔트는 `analytics_user_install.user_key` / `analytics_purchase.user_key`
 * 와 **완전히 같다**(`us_` + HMAC(salt,"user:"+uid)) — 이름만 그 표의 규약을 따른다.
 * 조인은 별칭 한 줄로 붙는다: `e.userKey = l.user_key`.
 *
 * ★BQ 는 컬럼 삭제·타입 변경이 사실상 불가하다. 이 이름을 바꾸려면 새 컬럼을
 * 하나 더 만드는 수밖에 없고, 그러면 같은 값이 두 컬럼에 살면서 어느 쪽이
 * 정본인지 아무도 못 말한다. 바꾸지 마라.
 */
export const EVENT_USER_KEY_FIELD = "userKey";

/**
 * 각인 컬럼의 BQ 스키마 한 줄. ★반드시 NULLABLE 이다 —
 *  - 미인증 경로(`logAnonymousTelemetryBatch`)에는 uid 가 아예 없고,
 *  - 각인 이전 43만 행은 영원히 비어 있고,
 *  - 삭제요청이 이 값을 NULL 로 되돌리는 것으로 처리되기 때문이다.
 * REQUIRED 로 만들면 위 셋이 전부 불가능해진다.
 */
export const EVENT_USER_KEY_FIELD_SCHEMA = {
  name: EVENT_USER_KEY_FIELD,
  type: "STRING",
  mode: "NULLABLE" as const,
  description:
    "계정 파생 가명 사람키(`us_` + HMAC). analytics_user_install.user_key / " +
    "analytics_purchase.user_key 와 같은 kind·같은 솔트다. ★원시 uid 는 어디에도 " +
    "없고 솔트는 함수 런타임 env 에만 있다. NULL 은 '사람이 없다' 가 아니라 " +
    "'각인 이전이거나 미인증 경로' 다 — 화면이 둘을 구분해 말해야 한다.",
};

/** 각인 컬럼을 붙이는 ALTER. ★머지가 아니라 이 DDL 이 배포다. */
export function buildEventUserKeyAlterSql(
  projectId: string,
  dataset: string,
  table: string,
): string {
  return (
    `ALTER TABLE \`${projectId}.${dataset}.${table}\`\n` +
    `ADD COLUMN IF NOT EXISTS ${EVENT_USER_KEY_FIELD} STRING`
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 배포 게이트 — 컬럼이 없는데 쓰면 텔레메트리가 통째로 죽는다
// ════════════════════════════════════════════════════════════════════════════

/**
 * env 키. 값은 'YYYY-MM-DD'(UTC). ★코드 기본값을 두지 않는다.
 *
 * ── 왜 `PERSON_AXIS_EFFECTIVE_FROM` 을 재사용하지 않나 ──────────────────────
 * 그 값은 **이미 프로덕션에 켜져 있다**(2026-04-01). 그것에 각인을 매달면
 * 머지하는 순간 함수가 존재하지 않는 컬럼에 스트리밍 insert 를 시도하고,
 * BQ 가 배치 전체를 거절해 **텔레메트리 수집이 통째로 멈춘다.** 분석 기능
 * 하나 때문에 제품 기능이 죽는 순서를 만들지 않는다.
 *
 * 그래서 키를 따로 둔다. 켜는 순서가 곧 안전 순서다:
 *   1) `buildEventUserKeyAlterSql` 로 컬럼 추가 (되돌리기: 컬럼은 남지만 전부 NULL)
 *   2) `EVENTS_PERSON_STAMP_FROM` 설정 + 함수 배포
 *   3) 화면이 `buildEventStampBoundarySql` 로 전환 시점을 **데이터에서** 읽는다
 *
 * ★이 값은 동시에 "언제부터 각인됐나" 의 **선언**이기도 하다. 다만 화면이
 * 믿어야 하는 것은 선언이 아니라 실측이다(§3) — 배포가 밀리면 선언과 사실이
 * 갈라지기 때문이다.
 */
export const EVENTS_PERSON_STAMP_FROM_ENV = "EVENTS_PERSON_STAMP_FROM";

export const EVENTS_PERSON_STAMP_UNSET_NOTE =
  "EVENTS_PERSON_STAMP_FROM 미설정 — 이벤트 행 사람키 각인이 꺼져 있다. " +
  "이건 장애가 아니라 기본값이다: BQ 컬럼(ALTER)을 먼저 넣지 않고 켜면 " +
  "텔레메트리 적재가 통째로 실패한다. 순서는 ①ALTER ②env ③배포 다.";

const EVENTS_PERSON_STAMP_INVALID_NOTE =
  "EVENTS_PERSON_STAMP_FROM 값이 'YYYY-MM-DD' 가 아니다 — 전환 시점을 못 세우므로 " +
  "각인하지 않는다. 잘못된 경계로 켜는 것보다 꺼진 편이 안전하다.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type EventStampGate =
  | {
      readonly on: false;
      readonly reasonCode: "unset" | "invalid";
      readonly reason: string;
      readonly stampFrom: null;
    }
  | {
      readonly on: true;
      readonly reasonCode: null;
      readonly reason: null;
      readonly stampFrom: string;
    };

/** ★던지지 않는다 — 꺼짐은 정상 상태다(personAxis 게이트와 같은 규율). */
export function resolveEventStampGate(
  env: Record<string, string | undefined> = process.env,
): EventStampGate {
  const raw = env[EVENTS_PERSON_STAMP_FROM_ENV];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) {
    return {
      on: false,
      reasonCode: "unset",
      reason: EVENTS_PERSON_STAMP_UNSET_NOTE,
      stampFrom: null,
    };
  }
  if (!isRealDate(trimmed)) {
    return {
      on: false,
      reasonCode: "invalid",
      reason: EVENTS_PERSON_STAMP_INVALID_NOTE,
      stampFrom: null,
    };
  }
  return { on: true, reasonCode: null, reason: null, stampFrom: trimmed };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 각인 판정 — 한 배치에 한 번
// ════════════════════════════════════════════════════════════════════════════

/** 각인을 안 한 사유. ★전부 "정상"이다 — 하나도 예외를 던지지 않는다. */
export type StampSkipReason =
  | "stamp_gate_off"
  | "person_gate_closed"
  | "no_salt"
  | "no_uid"
  | "pseudonym_failed";

export type EventStampPlan =
  | { readonly stamped: false; readonly reason: StampSkipReason }
  | { readonly stamped: true; readonly userKey: string };

export type PlanEventStampInput = {
  /** 인증된 요청의 uid. ★이 값은 여기서 소비되고 버려진다 — 어디에도 안 남는다. */
  readonly uid: unknown;
  readonly salt: string | null;
  /** 방침 게이트(personAxis.resolvePersonAxisGate). 닫혀 있으면 각인하지 않는다. */
  readonly personGate: PersonAxisGate;
  /** 배포 게이트(resolveEventStampGate). */
  readonly stampGate: EventStampGate;
};

/**
 * 이 배치의 행들에 붙일 사람키를 정한다.
 *
 * ★게이트를 **둘 다** 통과해야 각인한다. 배포 게이트는 "컬럼이 있나"(기술),
 * 방침 게이트는 "고지가 섰나"(법)이다. 둘은 다른 질문이라 하나로 합치지 않는다 —
 * 합치면 컬럼을 추가하는 것만으로 방침 판단이 통과된 것처럼 읽힌다.
 *
 * ★`planUserInstallLink` 와 같은 모양이다(둘 다 "게이트 통과분만 돌려준다").
 */
export function planEventUserKeyStamp(
  input: PlanEventStampInput,
): EventStampPlan {
  if (!input.stampGate.on) {
    return { stamped: false, reason: "stamp_gate_off" };
  }
  if (!input.personGate.open) {
    return { stamped: false, reason: "person_gate_closed" };
  }
  if (!input.salt) return { stamped: false, reason: "no_salt" };
  const uid = typeof input.uid === "string" ? input.uid.trim() : "";
  if (uid.length === 0) return { stamped: false, reason: "no_uid" };
  const key = pseudonymizeAnalyticsId("user", uid, input.salt);
  if (typeof key !== "string" || key.length === 0) {
    return { stamped: false, reason: "pseudonym_failed" };
  }
  return { stamped: true, userKey: key };
}

/**
 * 이벤트 행 하나에 각인을 얹는다. ★입력을 변형하지 않고 사본을 돌려준다
 * (`pseudonymizeAnalyticsRow` 와 같은 규약).
 *
 * ★각인이 없으면 컬럼을 **아예 넣지 않는다** — `null` 을 명시적으로 넣는 것과
 * 결과는 같지만, 넣지 않으면 각인이 꺼진 배포에서 스트리밍 insert 가 존재하지
 * 않는 컬럼을 언급하지 않게 되어 ALTER 전에도 안전하다. 이게 §2 순서를 코드
 * 차원에서 한 번 더 보장한다.
 */
export function applyEventUserKeyStamp<T extends Record<string, unknown>>(
  row: T,
  plan: EventStampPlan,
): T {
  if (!plan.stamped) return row;
  return { ...row, [EVENT_USER_KEY_FIELD]: plan.userKey } as T;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 전환 시점을 **데이터에서** 읽는다
// ════════════════════════════════════════════════════════════════════════════
//
// ★완료 기준의 "전환 시점 이전/이후를 화면이 구분할 수 있는 근거가 데이터에
//   남는다" 가 이 절이다. env 상수를 화면에 그리면 배포가 밀렸을 때 화면이
//   거짓말을 한다(선언 ≠ 사실). 그래서 경계는 **각인된 첫 행의 시각**으로 읽는다.
//
// ★본문에 원시 uid 도 솔트도 없다. 파라미터는 날짜 하나다.

/** 각인 경계·커버리지를 한 번에 세는 SQL. */
export function buildEventStampBoundarySql(
  projectId: string,
  dataset: string,
  table: string,
): string {
  const t = `\`${projectId}.${dataset}.${table}\``;
  const k = EVENT_USER_KEY_FIELD;
  return [
    "SELECT",
    `  COUNTIF(${k} IS NOT NULL AND ${k} != "") AS stamped_rows,`,
    "  COUNT(*) AS total_rows,",
    `  COUNT(DISTINCT IF(${k} != "", ${k}, NULL)) AS stamped_people,`,
    `  CAST(MIN(IF(${k} IS NOT NULL AND ${k} != "", timestamp, NULL)) AS STRING)`,
    "    AS first_stamped_at,",
    `  CAST(MAX(IF(${k} IS NOT NULL AND ${k} != "", timestamp, NULL)) AS STRING)`,
    "    AS last_stamped_at",
    `FROM ${t}`,
    "WHERE timestamp >= TIMESTAMP(DATE(@since))",
  ].join("\n");
}

/**
 * 사람 축을 쓰는 응답에 싣는 각인 봉투.
 *
 * ★`state` 판정이 이 타입의 요점이다. `PersonAxisCoverage`(설계 §10.3)와 같은
 * 규율을 따른다 — 부분 적재 중에 퍼센트를 헤드라인으로 그리면 "커버리지가
 * 오르는 동안 지표가 저절로 좋아지는" 거짓말이 생긴다.
 */
export type EventStampCoverage = {
  readonly state: "off" | "stamping" | "complete";
  readonly reason: string | null;
  readonly stampedRows: number;
  readonly totalRows: number;
  readonly stampedPeople: number;
  /** ★각인 경계의 **실측** 출처. env 선언이 아니라 데이터에서 온 값이다. */
  readonly firstStampedAt: string | null;
  readonly lastStampedAt: string | null;
  /** env 선언값. 실측과 갈라지면 배포가 밀린 것이다 — 화면이 둘을 같이 보인다. */
  readonly declaredStampFrom: string | null;
};

function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * ★`complete` 는 `stampedRows === totalRows` 가 **아니다.**
 * 각인 이전 43만 행은 영원히 NULL 이라 그 판정은 영원히 false 가 되고, 그러면
 * 이 장치가 늑대소년이 된다(설계 §10.3 이 `linkedActive === active` 로 같은
 * 함정을 피한 것과 같은 이유).
 *
 * 그래서 판정은 **경계 이후 구간에서만** 본다 — 그건 이 함수가 아니라 호출측이
 * `@since >= firstStampedAt` 로 질의를 좁혀서 만든다. 이 함수는 넘어온 창
 * 안에서만 말한다. 창을 안 좁히고 부른 값을 `complete` 로 읽지 마라.
 */
export function summarizeEventStampCoverage(
  row: Record<string, unknown> | null | undefined,
  gate: EventStampGate,
): EventStampCoverage {
  const stampedRows = toInt(row?.stamped_rows);
  const totalRows = toInt(row?.total_rows);
  const base = {
    stampedRows,
    totalRows,
    stampedPeople: toInt(row?.stamped_people),
    firstStampedAt: toStr(row?.first_stamped_at),
    lastStampedAt: toStr(row?.last_stamped_at),
    declaredStampFrom: gate.on ? gate.stampFrom : null,
  };
  if (!gate.on) {
    return { ...base, state: "off", reason: gate.reason };
  }
  if (totalRows > 0 && stampedRows === totalRows) {
    return { ...base, state: "complete", reason: null };
  }
  return {
    ...base,
    state: "stamping",
    reason:
      "각인 중 — 이 창의 행 " +
      `${totalRows} 중 ${stampedRows} 만 사람키를 갖고 있다. 나머지는 각인 ` +
      "이전이거나 미인증(로그인 전) 경로로 들어온 행이다. 퍼센트를 헤드라인으로 " +
      "읽지 말고 분수로 읽어라.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 삭제요청 — 각인은 되돌릴 수 있어야 한다
// ════════════════════════════════════════════════════════════════════════════

/**
 * PIPA 제36조 삭제요청. 링크표 DELETE(`buildPersonAxisEraseSql`)와 **짝**이다.
 *
 * ★둘을 같이 부르지 않으면 반쪽이 남는다: 링크만 지우면 각인된 행이 그대로
 * 사람 축에 남고, 각인만 지우면 과거 소급이 링크표로 살아 있다.
 *
 * ★`SET NULL` 이지 `DELETE` 가 아니다 — 이벤트 행 자체는 익명 통계의 분모이므로
 * 지우면 지표가 조용히 줄어든다. 지우는 것은 **사람과의 연결**이지 사실이 아니다.
 */
export function buildEventStampEraseSql(
  projectId: string,
  dataset: string,
  table: string,
): string {
  const t = `\`${projectId}.${dataset}.${table}\``;
  const k = EVENT_USER_KEY_FIELD;
  return [`UPDATE ${t}`, `SET ${k} = NULL`, `WHERE ${k} = @user_key`].join(
    "\n",
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. ★삭제요청은 **한 덩어리**다 — 반쪽을 부를 수 있으면 언젠가 반쪽이 남는다
// ════════════════════════════════════════════════════════════════════════════
//
// §5 는 "링크표 DELETE 와 각인 SET NULL 은 **짝**이다" 라고 적어 뒀다. 그런데
// 2026-08-29 각인을 켜기 전 실측: **둘 다 호출자가 한 명도 없다.**
// `buildPersonAxisEraseSql` 도 `buildEventStampEraseSql` 도 export 만 돼 있고
// index.ts 에도, 스크립트에도, 어디에도 부르는 자리가 없다. 삭제요청 경로는
// 사람이 손으로 SQL 을 붙여 넣는 것이고 — **그 사람이 짝의 존재를 아는지는
// 주석에 달려 있었다.** 각인이 켜지는 순간 그 주석 하나가 PIPA 제36조와 우리
// 사이의 유일한 방어선이 된다.
//
// 그래서 반쪽을 부를 수 없게 만든다: 아래 계획이 **두 문장을 한 배열로만**
// 돌려준다. 개별 빌더는 테스트가 붙잡고 있어 그대로 두되, 운영 경로
// (`scripts/erase-person-axis.ts`)는 이 계획만 쓴다.
//
// ── ★실측으로 드러난 두 번째 것: 각인 UPDATE 는 **실패할 수 있다** ──────────
// `events` 는 `tabledata.insertAll`(스트리밍)로 적재된다. BigQuery 는 스트리밍
// 버퍼에 걸린 행을 건드리는 UPDATE/DELETE 를 **거절한다.** 2026-08-29 실측
// (격리 표에 스트리밍 insert 직후 UPDATE):
//
//   UPDATE or DELETE statement over table ... would affect rows in the
//   streaming buffer, which is not supported
//
// ★부분 실행이 아니라 **문장째 거절**이라 조용히 반쪽이 되지는 않는다. 대신
// "지금 활동 중인 사람" 의 삭제요청이 그냥 안 나간다. 계속 활동하면 계속 안 된다.
// 그래서 운영 문장에는 버퍼 밖만 고르는 시간 가드를 붙이고, **남은 행 수를 세서
// 보고한다.** 가드만 붙이고 세지 않으면 그게 진짜 반쪽이다 — 에러 없이 남는다.

/**
 * 스트리밍 버퍼를 피하는 여유. BQ 문서는 버퍼 체류를 "최대 90분" 으로 말한다.
 * ★넉넉하게 잡는 쪽이 옳다: 짧으면 문장이 거절돼 삭제가 **안 나가고**, 길면
 * 남은 행이 잔여로 잡혀 **재실행 대상이 될 뿐**이다. 실패의 값이 다르다.
 */
export const EVENT_STAMP_ERASE_BUFFER_MINUTES = 90;

/**
 * 각인 SET NULL — 스트리밍 버퍼 밖 구간만. ★`buildEventStampEraseSql` 의
 * 운영판이다(그쪽은 이상적인 문장이고 이쪽은 실제로 나가는 문장이다).
 */
export function buildEventStampEraseOutsideBufferSql(
  projectId: string,
  dataset: string,
  table: string
): string {
  const t = `\`${projectId}.${dataset}.${table}\``;
  const k = EVENT_USER_KEY_FIELD;
  return [
    `UPDATE ${t}`,
    `SET ${k} = NULL`,
    `WHERE ${k} = @user_key`,
    `  AND timestamp < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${EVENT_STAMP_ERASE_BUFFER_MINUTES} MINUTE)`,
  ].join("\n");
}

/**
 * 위 문장이 **못 지운 행**을 센다. ★0 이 아니면 삭제요청은 아직 안 끝난 것이다 —
 * 재실행해야 한다. 이 수를 보고하지 않으면 시간 가드가 조용한 반쪽이 된다.
 */
export function buildEventStampEraseResidualSql(
  projectId: string,
  dataset: string,
  table: string
): string {
  const t = `\`${projectId}.${dataset}.${table}\``;
  const k = EVENT_USER_KEY_FIELD;
  return [
    `SELECT COUNT(*) AS residual_rows`,
    `FROM ${t}`,
    `WHERE ${k} = @user_key`,
  ].join("\n");
}

export type PersonEraseStatement = {
  /** 사람이 읽는 이름. 로그에 이것만 남는다 — 값은 안 남는다. */
  readonly label: string;
  readonly sql: string;
};

export type PersonErasePlan = {
  /** ★실행 순서대로다. 배열을 쪼개 쓰지 마라 — 쪼갤 수 있으면 언젠가 쪼갠다. */
  readonly statements: ReadonlyArray<PersonEraseStatement>;
  /** 각인 UPDATE 뒤에 반드시 확인할 잔여 카운트. */
  readonly residualCheck: PersonEraseStatement;
};

/**
 * PIPA 제36조 삭제요청 한 덩어리.
 *
 * ★순서가 설계다: **각인 UPDATE 를 먼저, 링크표 DELETE 를 나중에** 한다.
 * 각인 UPDATE 는 스트리밍 버퍼 때문에 거절될 수 있는 **깨지기 쉬운 문장**이고,
 * 링크표는 스트리밍이 아니라 MERGE 로 쓰므로 그 제약이 없다. 링크를 먼저 지운
 * 뒤 각인이 실패하면 남는 것이 정확히 설계가 경고한 반쪽이다 — 링크는 사라졌는데
 * 각인된 행이 그 사람을 계속 가리킨다. 깨지기 쉬운 쪽을 앞에 두면 실패가
 * "아무것도 안 한 상태" 로 끝난다.
 *
 * ★파라미터는 `@user_key` 하나다. 원시 uid 도 솔트도 문장에 없다 — BQ 는 쿼리
 * 본문을 job 히스토리에 수개월 보관한다.
 */
export function buildPersonErasePlan(
  projectId: string,
  dataset: string,
  table: string
): PersonErasePlan {
  return {
    statements: [
      {
        label: "각인 SET NULL (events.userKey, 스트리밍 버퍼 밖)",
        sql: buildEventStampEraseOutsideBufferSql(projectId, dataset, table),
      },
      {
        label: "링크표 DELETE (analytics_user_install)",
        sql: buildPersonAxisEraseSql(projectId),
      },
    ],
    residualCheck: {
      label: "잔여 각인 행 수 (0 이 아니면 재실행)",
      sql: buildEventStampEraseResidualSql(projectId, dataset, table),
    },
  };
}
