/**
 * 협업 프로젝트 감사 로그 — 타입.
 *
 * 이 컬렉션(`projectAuditLog`)이 답하는 질문은 하나다: **"이 프로젝트에서 어떤
 * 구성원이 언제 무엇을 했나."** 그래서 1급 축은 (projectId, actorUid, type, ts) 다.
 *
 * ★기존 `audit_logs`(원장, electron/mcp-server/ledger.ts)와 무엇이 다른가 —
 * 둘은 겹치지 않는다. 합치지 않은 이유는 projectAuditService.ts 상단 주석 참조.
 *   - `audit_logs`  = MCP 툴 호출(=AI 에이전트 행위). read = 프로젝트 멤버 전원.
 *   - `projectAuditLog` = 렌더러발 **사람** 행위. read = owner/admin 전용.
 */

/**
 * 감사 이벤트 종류.
 *
 * 문자열 리터럴 유니온으로 못 박는다 — 자유 문자열이면 오타가 조용히 새 타입을
 * 만들어 필터가 영원히 0건을 돌려준다(감사에서 가장 나쁜 실패: 조용한 누락).
 */
export type ProjectAuditEventType =
  | "chat.message.sent"
  | "agent.spawned"
  | "task.claimed"
  | "task.status_changed";

/**
 * 메타데이터 값 — 스칼라만 허용한다.
 *
 * 중첩 객체를 허용하지 않는 것은 의도적이다. 감사 레코드는 사실상 불변이라
 * 한번 들어간 것은 못 지운다. 중첩을 열어두면 "일단 통째로 넣자"가 되어 채팅
 * 본문·지시문·시크릿이 영구 박제되기 쉽다(원장 ledger.ts 가 지시문을 해시로만
 * 담는 것과 같은 취지).
 */
export type ProjectAuditMetadataValue = string | number | boolean | null;
export type ProjectAuditMetadata = Record<string, ProjectAuditMetadataValue>;

/** Firestore 에 실제로 write 되는 필드(문서 id·서버 변환 전 createdAt 제외). */
export interface ProjectAuditEventWrite {
  projectId: string;
  /** 행위자 uid. 룰이 request.auth.uid 와 일치를 강제한다. */
  actorUid: string;
  /** 표시용 이름. 조회 시 users 조인을 피하려는 비정규화 — 없으면 null. */
  actorName: string | null;
  type: ProjectAuditEventType;
  /** 이 행위가 속한 티켓. 무관한 이벤트(채팅 등)는 null. */
  taskId: string | null;
  /** 행위 대상 id(agentId / messageId / taskId). 모르면 null. */
  targetId: string | null;
  metadata: ProjectAuditMetadata;
}

/** 조회 결과 한 건. */
export interface ProjectAuditEvent extends ProjectAuditEventWrite {
  id: string;
  createdAt: Date;
}

/** 조회 필터. 전부 optional — 아무것도 안 주면 프로젝트 전체 타임라인. */
export interface ProjectAuditLogQuery {
  actorUid?: string;
  type?: ProjectAuditEventType;
  /** 티켓 상세 패널(원장 상세)이 쓰는 축. 이 티켓에 속한 이벤트만. */
  taskId?: string;
  /** 최신순 커서. 지정하면 이 시각보다 오래된 기록만 이어 읽는다. */
  beforeCreatedAt?: Date;
  /** 기본 100, 상한 500(PROJECT_AUDIT_MAX_LIMIT). */
  limit?: number;
}
