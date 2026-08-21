/**
 * 프로젝트 스코프 쿼리 규율 — "Missing or insufficient permissions" 의 진짜 원인.
 *
 * ── 왜 필요한가 (실측) ───────────────────────────────────────────────────────
 * firestore.rules 의 `tasks` read 는 `isProjectMember(resource.data.projectId)` 다.
 * 단건 get 이면 `resource.data` 가 그 문서라 잘 동작한다. 그런데 **list(쿼리)** 는
 * Firestore 가 문서를 읽어 보고 판정하지 않는다 — 쿼리 제약식만으로 룰을 증명할 수
 * 있어야 한다("security rules are not filters"). 그래서 projectId 를 `==` 로
 * 고정하지 않은 쿼리는, 결과가 전부 내 프로젝트 문서여도, 통째로 거부된다.
 *
 *   에뮬레이터 실측 에러:
 *     FirebaseError: Property projectId is undefined on object. for 'list' @ L167
 *   클라이언트에는 이게 "Missing or insufficient permissions" 로 보인다.
 *
 * 이 한 줄이 티켓 4ov5wbQZ25XUXHZVhxdh 의 근인이었다: applyProjection 이 미션
 * statusCounts 를 seed 하려고 `where("missionId","==",…)` 무스코프 쿼리를
 * 트랜잭션 **진입 전에** 쏘고, 그게 거부되면서 update_task_status/add_activity 의
 * 상태 write 자체가 시작도 못 하고 throw 했다. board 컨텍스트 태스크는 그 경로를
 * 안 타서 "간헐"로 보였을 뿐, 룰 드리프트도 토큰 만료도 아니었다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────────
 * 아래 컬렉션에 **쿼리(list)** 를 날릴 때는 projectId 동등조건이 반드시 있어야
 * 한다. projectId 를 모르면 쿼리를 쏘지 말고 여기서 즉시 실패시킨다 — 어차피
 * 거부될 쿼리를 던져 놓고 catch 로 삼키면(실제로 여러 곳이 그랬다) 의존성 해소,
 * 죽은 클레임 해제 같은 기능이 **조용히** 죽는다. 그게 이 버그가 오래 산 이유다.
 *
 * 단건 get / doc write 는 해당 없음 — `resource.data` 가 실제 문서다.
 */

/**
 * read 룰이 `resource.data.projectId` 를 참조하는 컬렉션 = 쿼리에 projectId
 * 동등조건이 필수인 컬렉션. firestore.rules 와 함께 갱신할 것.
 *
 * 여기 없는 것들과 그 이유:
 *   - activities  : read 룰이 `isTaskProjectMember(resource.data.taskId)` — 쿼리가
 *                   taskId 를 고정하므로 그 자체로 증명된다.
 *   - projects    : projectId 필드가 아니라 members/ownerId 를 본다(별도 규율).
 *
 * ★missions / cost_logs 는 원래 "read 룰이 isAuthenticated() 뿐"이라 이 목록에서
 *   빠져 있었다. 티켓 Ciriq5ASEvAlA8TnKxhW 가 그 룰을 크로스테넌트 구멍으로 보고
 *   `canReadProjectScopedDoc()`(= isProjectMember) 으로 조였으므로 이제 여기 속한다.
 *   같은 티켓에서 mission-engine 의 무스코프 구독도 함께 스코프했다
 *   (electron/mission-engine/mission-project-scope.ts).
 */
export const PROJECT_SCOPED_COLLECTIONS: readonly string[] = [
  "tasks",
  "agents",
  "flows",
  "chatMessages",
  "taskComments",
  "pendingInstructions",
  "audit_logs",
  "merge_history",
  "telemetry_events",
  "projectAuditLog",
  "publicReplayOwners",
  "missions",
  "cost_logs",
];

const SCOPED = new Set(PROJECT_SCOPED_COLLECTIONS);

export function isProjectScopedCollection(collectionId: string): boolean {
  return SCOPED.has(collectionId);
}

/**
 * projectId 없이 스코프 컬렉션을 쿼리하려는 시도. PERMISSION_DENIED 로 둔갑하기
 * 전에 이 타입으로 먼저 실패시켜, 원인이 "룰/멤버십" 이 아니라 "쿼리에 projectId
 * 가 빠졌다" 임을 호출부와 로그가 바로 알 수 있게 한다.
 */
export class MissingProjectScopeError extends Error {
  constructor(
    readonly collectionId: string,
    readonly operation: string,
  ) {
    super(
      `'${collectionId}' 컬렉션 쿼리(${operation})에 projectId 가 없습니다. ` +
        `Firestore 룰은 list 를 쿼리 제약식으로 평가하므로 projectId 동등조건이 ` +
        `없는 쿼리는 무조건 거부됩니다(Missing or insufficient permissions). ` +
        `MARBLO_PROJECT 를 설정하거나 project_id 를 넘기세요.`,
    );
    this.name = "MissingProjectScopeError";
  }
}

/**
 * 스코프 컬렉션이면 non-empty projectId 를 보장해 돌려준다(아니면 throw).
 * 스코프 컬렉션이 아니면 null — 호출부는 projectId 조건을 붙이지 않는다.
 */
export function requireProjectScope(
  collectionId: string,
  projectId: string | undefined | null,
  operation: string,
): string | null {
  if (!isProjectScopedCollection(collectionId)) return null;
  const pid = (projectId ?? "").trim();
  if (!pid) throw new MissingProjectScopeError(collectionId, operation);
  return pid;
}

/** Firestore permission-denied 판별 (code 또는 메시지). */
export function isPermissionDeniedError(err: unknown): boolean {
  if (err instanceof MissingProjectScopeError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.includes("permission-denied")) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /Missing or insufficient permissions|PERMISSION_DENIED/i.test(message);
}
