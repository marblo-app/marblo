/**
 * 협업 감사 로그 — 순수 파생 함수(L0).
 *
 * Firestore 도 시계도 auth 도 만지지 않는다. I/O 는 전부
 * services/projectAuditService.ts 가 한다. 이 분리는 원장(ledger.ts = 순수 /
 * tools.ts = I/O)이 이미 쓰는 관례를 그대로 따른 것이고, 실익은 이 파일이
 * `lib/firebase` 를 import 하지 않아 **단위테스트에서 그대로 돌아간다**는 점이다
 * (lib/firebase 는 VITE_FIREBASE_* 없으면 모듈 로드 시점에 throw 한다).
 */

import type {
  ProjectAuditEventType,
  ProjectAuditEventWrite,
  ProjectAuditMetadata,
} from "../types/projectAudit";
import type { ChatMessageType } from "../types/chat";
import type { TaskStatus } from "../types/task";

/** 조회 기본/상한. 상한을 두는 이유는 감사 뷰가 실수로 컬렉션 전체를 끌어오는 것을 막기 위함. */
export const PROJECT_AUDIT_DEFAULT_LIMIT = 100;
export const PROJECT_AUDIT_MAX_LIMIT = 500;

/** 런타임에서도 종류 집합을 알아야 하는 곳(필터 UI·검증)이 있어 배열로도 노출한다. */
export const PROJECT_AUDIT_EVENT_TYPES: readonly ProjectAuditEventType[] = [
  "chat.message.sent",
  "agent.spawned",
  "task.claimed",
  "task.status_changed",
] as const;

export function isProjectAuditEventType(
  value: unknown,
): value is ProjectAuditEventType {
  return (
    typeof value === "string" &&
    (PROJECT_AUDIT_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/** 빈 문자열/공백을 null 로 접는다 — "빈 문자열로 귀속됨"을 만들지 않기 위해. */
function nullIfBlank(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

export interface BuildProjectAuditEventInput {
  projectId: string;
  actorUid: string | null | undefined;
  actorName?: string | null;
  type: ProjectAuditEventType;
  taskId?: string | null;
  targetId?: string | null;
  metadata?: ProjectAuditMetadata;
}

/**
 * 감사 레코드 한 건을 조립한다.
 *
 * ★귀속 불가면 **null 을 돌려준다**(= 기록하지 않는다). 원장(ledger.ts)이
 * `actorUid: null` 을 그대로 박아 넣는 것과 반대인데, 이유가 다르다:
 *   - 원장은 **서버(MCP 프로세스)**가 쓰므로 actorUid 가 null 이어도 "누가
 *     불렀는지 모르는 실제 이벤트"라는 정보 가치가 있고 write 가 통과한다.
 *   - 이 컬렉션은 **렌더러(로그인 사용자)**가 쓰고, 룰이
 *     `actorUid == request.auth.uid` 를 강제한다. 즉 actorUid 없는 write 는
 *     어차피 permission-denied 로 거부된다. 그걸 알면서 보내면 콘솔만 시끄럽고
 *     결과는 같다 — 그래서 조립 단계에서 명시적으로 떨군다.
 * 호출부(projectAuditService.recordProjectAuditEvent)가 이 null 을 warn 으로
 * 남겨 "조용한 유실"이 되지 않게 한다.
 */
export function buildProjectAuditEvent(
  input: BuildProjectAuditEventInput,
): ProjectAuditEventWrite | null {
  const projectId = nullIfBlank(input.projectId);
  const actorUid = nullIfBlank(input.actorUid);
  if (!projectId || !actorUid) return null;

  return {
    projectId,
    actorUid,
    actorName: nullIfBlank(input.actorName),
    type: input.type,
    taskId: nullIfBlank(input.taskId),
    targetId: nullIfBlank(input.targetId),
    metadata: input.metadata ?? {},
  };
}

// ── 이벤트별 메타데이터 (프라이버시 경계) ─────────────────────────

/**
 * 채팅 감사 메타 — **본문을 담지 않는다.**
 *
 * 담는 것: 종류와 길이. 담지 않는 것: content 원문·미리보기.
 * 이유는 두 가지고, 둘 다 되돌릴 수 없는 쪽의 위험이다:
 *   1) 감사 레코드는 불변(update/delete 금지)이라 한번 들어간 본문은 못 지운다.
 *      채팅엔 자격증명·고객정보가 실제로 섞인다.
 *   2) 채팅 본문은 이미 `chatMessages` 에 원본이 있다. 여기에 또 담으면
 *      **본문 사본이 다른 접근등급(owner/admin)으로 하나 더 생긴다** — 채팅
 *      원본은 멤버 전원 read 인데 사본만 admin 이면 등급이 어긋나고, 반대로
 *      본문을 admin 뷰에 노출하는 건 "메타 중심" 방침(티켓 프라이버시 항목)에
 *      정면으로 어긋난다.
 * 본문 대조가 필요하면 targetId(messageId)로 chatMessages 를 짚으면 된다.
 */
export function chatAuditMetadata(
  messageType: ChatMessageType,
  content: string,
): ProjectAuditMetadata {
  return { messageType, contentLength: content.length };
}

/** 태스크 상태 전이 메타 — 전이의 양끝을 남긴다. */
export function taskStatusAuditMetadata(
  from: TaskStatus,
  to: TaskStatus,
): ProjectAuditMetadata {
  return { from, to };
}

/** 에이전트 스폰 메타 — 벤더/역할/이름. 지시문 원문은 담지 않는다(원장과 동일 방침). */
export function agentSpawnAuditMetadata(
  agentName: string,
  model: string,
  role: string,
): ProjectAuditMetadata {
  return { agentName, model, role };
}

// ── 조회 보조 ────────────────────────────────────────────────────

/** limit 정규화. 0/음수/NaN/과대값을 안전한 범위로 접는다. */
export function normalizeAuditLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return PROJECT_AUDIT_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), PROJECT_AUDIT_MAX_LIMIT);
}

/** 최신순 정렬(내림차순). 동률이면 안정적으로 유지된다(Array.sort 는 ES2019+ stable). */
export function sortAuditEventsDesc<T extends { createdAt: Date }>(
  events: T[],
): T[] {
  return [...events].sort((a, b) => +b.createdAt - +a.createdAt);
}
