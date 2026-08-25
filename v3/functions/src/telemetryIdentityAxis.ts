// ═══════════════════════════════════════════════════════════════════════════
// telemetryIdentityAxis — 표마다 userId 가 다른 공간이다
// (ticket GCNpqvDYRrLhyLghPCF9 · 순수 로직, BQ 무의존)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★같은 컬럼 이름 `userId` 가 문제의 절반이다. 오늘 이 프로젝트가 같은 부류로
//   여러 번 틀렸다. 조인 전에 이 표가 어느 축인지 물어라.
//
//   events / task_outcomes / agent_heartbeats  → install clientId (보통 36자 UUID)
//   cost_logs                                 → Firebase uid (28자)
//
// 컬럼 개명 안(프로덕션 ALTER 는 이 모듈이 하지 않는다):
//   events.userId            → installClientId
//   task_outcomes.userId     → installClientId
//   agent_heartbeats.userId  → installClientId
//   cost_logs.userId         → firebaseUid
//
// 새 표는 `userId` 라는 이름을 쓰지 않는다. 기존 표는 뷰/쿼리 별칭으로 가른다.

export type TelemetryTable =
  | "events"
  | "task_outcomes"
  | "agent_heartbeats"
  | "cost_logs";

export type PersonAxis = "install_client_id" | "firebase_uid";

export const TABLE_PERSON_AXIS: Record<TelemetryTable, PersonAxis> = {
  events: "install_client_id",
  task_outcomes: "install_client_id",
  agent_heartbeats: "install_client_id",
  cost_logs: "firebase_uid",
};

export const USERID_COLUMN_RENAME: Record<
  TelemetryTable,
  { current: "userId"; proposed: "installClientId" | "firebaseUid" }
> = {
  events: { current: "userId", proposed: "installClientId" },
  task_outcomes: { current: "userId", proposed: "installClientId" },
  agent_heartbeats: { current: "userId", proposed: "installClientId" },
  cost_logs: { current: "userId", proposed: "firebaseUid" },
};

/** cost_logs 는 로그인(Firebase auth) 된 계정만 적재한다. 미인증 비용은 0행. */
export const COST_LOGS_REQUIRES_AUTH = true;

export function personAxisOf(table: TelemetryTable): PersonAxis {
  return TABLE_PERSON_AXIS[table];
}

/**
 * 두 표의 userId 를 같은 키로 조인해도 되는가.
 *
 * false 면 그 조인 결과는 사람이 아니다. 사람 축이 필요하면
 * analytics_user_install 링크표를 타고, 링크가 없으면 unmapped 로 남겨라.
 */
export function canJoinUserId(
  left: TelemetryTable,
  right: TelemetryTable
): boolean {
  return TABLE_PERSON_AXIS[left] === TABLE_PERSON_AXIS[right];
}
