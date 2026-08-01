/**
 * 감사 로그 **뷰** 파생 함수(L0 — 순수).
 *
 * services/projectAuditService.ts 가 I/O 를, lib/projectAudit.ts 가 write 쪽
 * 조립을 맡는다. 이 파일은 **읽은 것을 사람이 읽는 모양으로 접는 것**만 한다:
 * 이벤트 종류 → 라벨 키, 메타데이터 → 한 줄 요약, 에러 → 화면 분기.
 *
 * firebase 도 react 도 타지 않는다(=단위테스트에서 그대로 돈다). lib/firebase
 * 는 VITE_FIREBASE_* 없으면 모듈 로드 시점에 throw 하므로 이 경계는 취향이
 * 아니라 테스트 가능성의 조건이다 — lib/projectAudit.ts 와 같은 이유.
 */

import type { MessageKey } from "../locales/ko";
import type {
  ProjectAuditEvent,
  ProjectAuditEventType,
  ProjectAuditMetadata,
} from "../types/projectAudit";
import { isProjectAuditEventType } from "./projectAudit";

// ── 이벤트 종류 라벨 ─────────────────────────────────────────────

/**
 * 종류 → i18n 키. 값이 `MessageKey` 로 타입돼 있어서 **키 오타가 컴파일
 * 에러**가 된다(자유 문자열이면 화면에 raw 키가 그대로 찍힌다).
 */
export const AUDIT_TYPE_LABEL_KEYS: Record<ProjectAuditEventType, MessageKey> =
  {
    "chat.message.sent": "project.audit.type.chatMessageSent",
    "agent.spawned": "project.audit.type.agentSpawned",
    "task.claimed": "project.audit.type.taskClaimed",
    "task.status_changed": "project.audit.type.taskStatusChanged",
  };

/**
 * 라벨 키 조회. **모르는 종류도 떨구지 않는다** — 앞으로 추가될 type 이 담긴
 * 문서를 옛 클라이언트가 읽으면 여기 없는 값이 오는데, 그때 행을 숨기면
 * 감사 뷰가 조용히 누락된다(감사에서 가장 나쁜 실패). 알 수 없음으로 표시만
 * 하고 행은 남긴다.
 */
export function auditTypeLabelKey(type: string): MessageKey {
  return isProjectAuditEventType(type)
    ? AUDIT_TYPE_LABEL_KEYS[type]
    : "project.audit.type.unknown";
}

// ── 표시용 파생 ──────────────────────────────────────────────────

/**
 * 행에 찍을 행위자 이름.
 *
 * actorName 은 기록 시점의 비정규화 값이라 비어 있을 수 있다(스폰 당시
 * displayName 미설정 등). 그럴 때 현재 멤버 목록으로 메꾸고, 그것도 없으면
 * uid 앞자리로 떨어진다 — 빈 칸으로 두면 "누구인지 모르는 기록"처럼 보인다.
 */
export function resolveActorLabel(
  event: Pick<ProjectAuditEvent, "actorUid" | "actorName">,
  nameByUid: Record<string, string> = {},
): string {
  const name = event.actorName?.trim() || nameByUid[event.actorUid]?.trim();
  if (name) return name;
  return event.actorUid.slice(0, 8);
}

/**
 * 메타데이터 한 줄 요약.
 *
 * 종류별로 의미 있는 필드만 골라 코드 값 그대로 보여준다(번역하지 않는다 —
 * `TODO → IN_PROGRESS` 같은 상태코드는 앱 전체에서 원문으로 통용된다).
 * 모르는 종류/빈 메타는 null 이고, 호출부는 그냥 칸을 비운다.
 */
export function auditMetadataSummary(
  type: string,
  metadata: ProjectAuditMetadata | undefined,
): string | null {
  if (!metadata) return null;
  const str = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  if (type === "task.status_changed") {
    const from = str("from");
    const to = str("to");
    if (from && to) return `${from} → ${to}`;
    return to ?? from;
  }
  if (type === "agent.spawned") {
    const parts = [str("agentName"), str("model"), str("role")].filter(
      (v): v is string => !!v,
    );
    return parts.length ? parts.join(" · ") : null;
  }
  if (type === "chat.message.sent") {
    return str("messageType");
  }
  return null;
}

// ── 에러 분기 ────────────────────────────────────────────────────

/**
 * 감사 뷰의 로드 결과.
 *
 * ★`denied` 를 `ready(events: [])` 와 **절대 같은 값으로 접지 않는다**.
 * "권한이 없다"와 "기록이 없다"가 같은 화면이 되면, 권한 문제로 안 보이는
 * 상황을 사용자가 "우리 팀은 아무것도 안 했구나"로 읽는다. 서비스가 빈 배열
 * 위장 대신 permission-denied 를 그대로 throw 하는 이유와 같다.
 */
export type AuditLoadState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; events: ProjectAuditEvent[] };

/** FirebaseError 의 code. 라이브러리 타입을 끌어오지 않으려고 구조로만 본다. */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : String(err);
}

/**
 * 권한 거부인가.
 *
 * code 를 1순위로 보되, 메시지 fallback 도 둔다 — 래핑된 에러(서비스 계층을
 * 지나며 다시 감싸진 경우)는 code 를 잃고 메시지만 남는 일이 있다. 여기서
 * 놓치면 "권한 없음"이 빨간 에러 박스로 보여서 owner 가 버그로 오해한다.
 */
export function isPermissionDenied(err: unknown): boolean {
  const code = errorCode(err);
  if (code === "permission-denied" || code === "unauthenticated") return true;
  const message = errorMessage(err).toLowerCase();
  return (
    message.includes("permission-denied") ||
    message.includes("missing or insufficient permissions")
  );
}

/** 에러 → 화면 상태. throw 를 이 한 지점에서만 상태로 바꾼다. */
export function auditStateFromError(err: unknown): AuditLoadState {
  if (isPermissionDenied(err)) return { status: "denied" };
  return { status: "error", message: errorMessage(err) };
}
