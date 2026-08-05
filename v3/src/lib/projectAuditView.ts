/**
 * 감사 로그 **뷰** 파생 함수(L0 — 순수).
 *
 * services/projectAuditService.ts 가 I/O 를, lib/projectAudit.ts 가 write 쪽
 * 조립을 맡는다. 이 파일은 **읽은 것을 사람이 읽는 모양으로 접는 것**만 한다:
 * 이벤트 종류 → 라벨 키, 메타데이터 → 한 줄 요약, 에러 → 화면 분기, 그리고
 * **두 소스(사람 `projectAuditLog` + 오케 원장 `audit_logs`)의 병합**.
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
import type { AuditLog } from "../types/audit";
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

// ── 오케(툴) 라벨 ────────────────────────────────────────────────
//
// ★기존(#730) 방침 뒤집기: 예전엔 툴 이름을 "코드 값 그대로" 보여줬다(대조
// 가능성 우선). 이 티켓(사장님 도그푸딩 피드백)은 그 반대를 요구한다 — raw
// `create_task` 는 사람이 읽는 감사 뷰로선 의미가 안 보인다. 그래서 사람이
// 읽는 라벨을 1급으로 올리되, 대조가 필요한 사람을 위해 원문 toolName 은
// 버리지 않고 `AuditRowLabel`(kind:"tool")에 같이 싣는다 — 화면은 tooltip 으로,
// 필터 <select>(agentTypeFilterValue)는 여전히 raw toolName 을 값으로 쓴다.
//
// 열거형이 아니라 `Record<string, MessageKey>` 로 느슨하게 두는 이유는
// AUDIT_TYPE_LABEL_KEYS 와 다르다 — toolName 은 새 MCP 툴이 계속 추가되는
// 열린 집합이라 여기 없는 이름이 오는 게 정상이다. 그때는 라벨 없이(raw)
// 행을 남긴다 — 모르는 걸 숨기지 않는다는 원칙은 그대로.
export const AUDIT_TOOL_LABEL_KEYS: Record<string, MessageKey> = {
  acknowledge_feedback: "project.audit.tool.acknowledgeFeedback",
  add_activity: "project.audit.tool.addActivity",
  add_pending_instruction: "project.audit.tool.addPendingInstruction",
  answer_question: "project.audit.tool.answerQuestion",
  ask_orchestrator: "project.audit.tool.askOrchestrator",
  check_feedback: "project.audit.tool.checkFeedback",
  claim_task: "project.audit.tool.claimTask",
  cleanup_agents: "project.audit.tool.cleanupAgents",
  create_flow: "project.audit.tool.createFlow",
  create_task: "project.audit.tool.createTask",
  create_tasks_bulk: "project.audit.tool.createTasksBulk",
  delete_task: "project.audit.tool.deleteTask",
  dispatch_task: "project.audit.tool.dispatchTask",
  escalate_to_owner: "project.audit.tool.escalateToOwner",
  get_agent_skill: "project.audit.tool.getAgentSkill",
  get_agents: "project.audit.tool.getAgents",
  get_all_tasks: "project.audit.tool.getAllTasks",
  get_available_tasks: "project.audit.tool.getAvailableTasks",
  get_flows: "project.audit.tool.getFlows",
  get_ledger_spool_status: "project.audit.tool.getLedgerSpoolStatus",
  get_model_guidance: "project.audit.tool.getModelGuidance",
  get_open_questions: "project.audit.tool.getOpenQuestions",
  get_pending_instructions: "project.audit.tool.getPendingInstructions",
  get_projection: "project.audit.tool.getProjection",
  get_routing_effectiveness: "project.audit.tool.getRoutingEffectiveness",
  get_task_activities: "project.audit.tool.getTaskActivities",
  get_task_dependencies: "project.audit.tool.getTaskDependencies",
  get_task: "project.audit.tool.getTask",
  get_worktree_audit: "project.audit.tool.getWorktreeAudit",
  kill_agent: "project.audit.tool.killAgent",
  list_worktree_audit: "project.audit.tool.listWorktreeAudit",
  mark_instruction_delivered: "project.audit.tool.markInstructionDelivered",
  merge_and_close: "project.audit.tool.mergeAndClose",
  mission_step_done: "project.audit.tool.missionStepDone",
  request_model_escalation: "project.audit.tool.requestModelEscalation",
  resolve_model_escalation: "project.audit.tool.resolveModelEscalation",
  reuse_agent: "project.audit.tool.reuseAgent",
  run_skill: "project.audit.tool.runSkill",
  search_tasks: "project.audit.tool.searchTasks",
  send_telegram_message: "project.audit.tool.sendTelegramMessage",
  spawn_agent: "project.audit.tool.spawnAgent",
  submit_for_review: "project.audit.tool.submitForReview",
  update_flow: "project.audit.tool.updateFlow",
  update_task_status: "project.audit.tool.updateTaskStatus",
};

/** 알려진 툴 이름인가. 모르면 raw 로 떨어지므로 화면에서 행이 사라지지 않는다. */
export function auditToolLabelKey(toolName: string): MessageKey | null {
  return AUDIT_TOOL_LABEL_KEYS[toolName] ?? null;
}

/** 오케 행 라벨 조립. 아는 툴은 사람이 읽는 라벨 + 원문(툴이름)을 같이 싣는다. */
export function toolRowLabel(toolName: string): AuditRowLabel {
  const key = auditToolLabelKey(toolName);
  return key
    ? { kind: "tool", key, toolName }
    : { kind: "raw", text: toolName || "?" };
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

// ── 빈 목록 분기 ─────────────────────────────────────────────────

/**
 * 목록이 비었을 때 **왜** 비었는가.
 *
 * ★`denied` 를 `ready([])` 와 가르는 것과 같은 이유로 이 둘도 가른다. 감사에서
 * 빈 화면은 세 가지 전혀 다른 사실일 수 있고("못 본다" / "조건에 안 맞는다" /
 * "아직 아무 기록도 없다"), 하나의 "기록 없음"으로 뭉개면 owner 는 그걸 전부
 * **기능 고장**으로 읽는다(이 티켓이 그렇게 시작됐다).
 *
 * - `filtered`     — 필터가 걸려 있다. 전체로는 기록이 있을 수 있으니 필터를
 *                    되돌리라고 안내해야 한다.
 * - `noRecordsYet` — 필터 없이도 0건. 이때만 "언제부터 쌓이는지 / 무엇이 여기
 *                    안 잡히는지"를 설명한다.
 */
export type AuditEmptyKind = "filtered" | "noRecordsYet";

export function auditEmptyKind(filters: {
  actorUid?: string;
  type?: string;
}): AuditEmptyKind {
  return filters.actorUid || filters.type ? "filtered" : "noRecordsYet";
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
export function auditStateFromError(err: unknown): AuditFailureState {
  if (isPermissionDenied(err)) return { status: "denied" };
  return { status: "error", message: errorMessage(err) };
}

// ═══════════════════════════════════════════════════════════════════
// 통합 뷰 — 사람(projectAuditLog) + 오케(audit_logs 원장)
// ═══════════════════════════════════════════════════════════════════
//
// ★왜 병합이 **읽기 전용**인가
// 두 컬렉션을 합치지 않은 이유는 접근등급 충돌이었다(projectAuditService.ts
// 상단 주석). 그 결정은 write 에 대한 것이고, 읽기는 얘기가 다르다 — owner/admin
// 패널은 두 등급 **모두를 읽을 수 있는** 주체라, 화면에서 겹쳐 보여주는 데는
// 아무 룰 변경이 필요 없다. 그래서 이 슬라이스는 새 write·새 룰을 하나도 만들지
// 않는다. 원장 read 등급(멤버 전원)을 조이는 방향은 특히 금지다(#406/#428).
//
// ★왜 "오케 행위"를 굳이 같은 타임라인에 넣는가
// 보드 이동의 대다수가 에이전트발이라(MCP 가 Firestore 를 직접 write) 사람 쪽
// 컬렉션만 보면 정상 운영 중에도 화면이 거의 비어 있다. owner 는 그걸 기능
// 고장으로 읽는다. 두 소스를 겹쳐야 "이 프로젝트에서 실제로 무슨 일이 있었나"가
// 처음으로 한 화면에서 답이 된다.

/**
 * 행 하나가 **사람 행위인가 오케(에이전트) 행위인가.**
 *
 * ★오케 행이라고 해서 행위자가 사라지는 게 아니다. 원장의 `actorUid` 는 그
 * 에이전트를 **발주한 사람**의 uid 라, 오케 행도 사람에게 귀속된다. 그래서 구성원
 * 필터가 두 소스에 그대로 걸린다 — 이게 병합이 성립하는 이유다.
 */
export type AuditActorKind = "human" | "agent";

/**
 * 행 종류 라벨.
 *
 * 사람 행위는 유한한 유니온이라 i18n 키로 번역한다("i18n"). 오케 행위는
 * `toolName`(`update_task_status`, `spawn_agent` …)인데, 아는 툴은 사람이 읽는
 * 라벨로 번역하되 **원문 toolName 도 같이 싣는다**("tool") — 대조가 필요한
 * 사람(문서·MCP 스펙과 맞춰보는)을 위해 원문을 버리지 않는다. 모르는 툴(새
 * MCP 툴 추가 등)은 예전처럼 raw 그대로("raw") — 행을 숨기지 않는다.
 */
export type AuditRowLabel =
  | { kind: "i18n"; key: MessageKey }
  | { kind: "tool"; key: MessageKey; toolName: string }
  | { kind: "raw"; text: string };

/** 통합 타임라인 한 행. 두 소스가 이 모양으로 접힌 뒤에는 구분이 `actorKind` 뿐이다. */
export interface UnifiedAuditRow {
  /**
   * React key. **소스 접두사를 붙인다** — 두 컬렉션의 문서 id 는 서로 다른
   * 네임스페이스라 충돌할 수 있고, 충돌하면 React 가 행을 조용히 덮어써서
   * 감사 기록이 화면에서 사라진다.
   */
  key: string;
  actorKind: AuditActorKind;
  createdAt: Date;
  /** 행위자(= 사람) 표시 이름. 귀속 불가면 null — 호출부가 "알 수 없음"을 그린다. */
  actorLabel: string | null;
  actorUid: string | null;
  label: AuditRowLabel;
  /** 한 줄 요약. 없으면 칸을 비운다. */
  detail: string | null;
  taskId: string | null;
  /** 오케 행의 모델(claude/codex/grok…). 사람 행은 항상 null. */
  model: string | null;
  /** 실패한 툴 호출인가. 사람 행은 성공/실패 개념이 없어 항상 false. */
  failed: boolean;
}

/**
 * 오케 행의 detail.
 *
 * model·toolName·taskId 는 각자 전용 칸이 있으므로(모델 뱃지 · 라벨 · 티켓 칸)
 * 여기서 되풀이하지 않는다 — 같은 값을 한 줄에 두 번 찍으면 밀도만 올라가고
 * 읽히지 않는다. 남는 건 티어라 그것만 싣는다.
 *
 * ★`params` 는 절대 담지 않는다. 툴 인자 원문에는 지시문·경로·티켓 본문이 그대로
 * 들어오고 거기 자격증명이 섞일 수 있다(types/audit.ts 주석). `instructionHash`
 * 도 담지 않는다 — 해시는 사람이 읽을 정보가 아니고, 화면에 띄우면 "원문이 어딘가
 * 있다"는 오해를 만든다.
 */
export function auditLedgerDetail(
  event: Pick<AuditLog, "tier">,
): string | null {
  const tier = event.tier?.trim();
  return tier ? tier : null;
}

/** update_task_status 가 유효 상태로 검증한 뒤에만 write 하는 7개 값. tools.ts 의 TASK_STATUS_VALUES 와 같은 집합. */
const TASK_STATUS_VALUES = new Set([
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
]);

/**
 * `update_task_status` 호출의 목표 상태만 뽑는다. **화이트리스트 예외** —
 * 위 `auditLedgerDetail` 의 "params 는 절대 담지 않는다" 원칙은 유지하되, 이
 * 한 필드만 예외로 둔다. 근거: `status` 는 서버(tools.ts `isTaskStatus`)가
 * 고정 7-원소 enum 중 하나로 검증한 **뒤에만** write 되므로 자유 텍스트·
 * 자격증명이 섞일 길이 없다(다른 params 필드 — comment 등 — 는 여전히 담지
 * 않는다). "from" 은 원장에 아예 없다(캡처가 저장하지 않는다) — 캡처를
 * 건드리지 않는 이 티켓의 제약상 화살표는 목표 쪽만 보여준다.
 */
export function auditStatusTarget(
  event: Pick<AuditLog, "toolName" | "params">,
): string | null {
  if (event.toolName !== "update_task_status") return null;
  const raw = event.params?.status;
  return typeof raw === "string" && TASK_STATUS_VALUES.has(raw) ? raw : null;
}

/** 오케 행 detail 전체 — 상태 목표(있으면) + 티어(있으면). */
function agentRowDetail(
  event: Pick<AuditLog, "tier" | "toolName" | "params">,
): string | null {
  const target = auditStatusTarget(event);
  const tier = auditLedgerDetail(event);
  const parts = [target ? `→ ${target}` : null, tier].filter(
    (v): v is string => !!v,
  );
  return parts.length ? parts.join(" · ") : null;
}

/** 사람 행위 한 건 → 통합 행. */
export function humanAuditRow(
  event: ProjectAuditEvent,
  nameByUid: Record<string, string> = {},
): UnifiedAuditRow {
  return {
    key: `human:${event.id}`,
    actorKind: "human",
    createdAt: event.createdAt,
    actorLabel: resolveActorLabel(event, nameByUid),
    actorUid: event.actorUid,
    label: { kind: "i18n", key: auditTypeLabelKey(event.type) },
    detail: auditMetadataSummary(event.type, event.metadata),
    taskId: event.taskId,
    model: null,
    failed: false,
  };
}

/**
 * `create_task` 성공 결과 텍스트에서 새로 만들어진 태스크 id 를 뽑는다.
 *
 * ★캡처 갭: ledger.ts `taskIdFromParams` 은 **요청** params 의 `task_id` 만
 * 읽는데, `create_task` 는 호출 시점엔 아직 id 가 없다(새로 발급) — 그래서
 * 원장의 `taskId` 필드가 이 툴에서는 항상 null 이고, 감사 뷰에 제목 대신
 * 해시만 보인다. 캡처(electron/mcp-server, audit_logs)는 건드리지 않고, 이미
 * 저장돼 있는 `result` 원문(tools.ts create_task 핸들러가 성공 시 항상
 * `ID: <id>` 줄을 찍는다)에서 뷰가 파싱해 메꾼다 — 새 write 도 새 필드도 없다.
 */
const CREATE_TASK_RESULT_ID_RE = /(?:^|\n)ID:\s*(\S+)/;

export function taskIdFromCreateTaskResult(result: string): string | null {
  const match = CREATE_TASK_RESULT_ID_RE.exec(result);
  return match ? match[1].trim() : null;
}

/**
 * 원장 이벤트 한 건 → 통합 행.
 *
 * 이름은 원장에 없다(uid 만 있다). 그래서 `nameByUid`(현재 멤버 목록)로만 메꾸고,
 * 못 메꾸면 uid 앞자리로 떨어진다 — 사람 쪽 `resolveActorLabel` 과 같은 규칙이라
 * 같은 사람이 두 소스에서 다른 이름으로 보이지 않는다.
 *
 * `actorUid` 가 아예 없는(= 원장 확장 이전) 문서는 **행을 버리지 않고** 귀속만
 * 비운다. 오래된 기록이 조용히 사라지는 것이 감사에서는 더 나쁘다.
 */
export function agentAuditRow(
  event: AuditLog,
  nameByUid: Record<string, string> = {},
): UnifiedAuditRow {
  const actorUid = event.actorUid?.trim() || null;
  const taskId =
    event.taskId?.trim() ||
    (event.toolName === "create_task"
      ? taskIdFromCreateTaskResult(event.result)
      : null);
  return {
    key: `agent:${event.id}`,
    actorKind: "agent",
    createdAt: event.createdAt,
    actorLabel: actorUid
      ? resolveActorLabel({ actorUid, actorName: null }, nameByUid)
      : null,
    actorUid,
    label: toolRowLabel(event.toolName || "?"),
    detail: agentRowDetail(event),
    taskId,
    model: event.model?.trim() || null,
    // success 는 원장 초창기부터 있던 필드라 undefined 면 옛 문서가 아니라
    // 손상된 문서다. 그때는 실패로 단정하지 않는다(없는 사실을 지어내지 않음).
    failed: event.success === false,
  };
}

/** createdAt 을 정렬 가능한 숫자로. 변환 실패(Date 아님/Invalid)는 0 으로 접어 맨 뒤로 보낸다. */
function auditTimeValue(value: Date): number {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * 두 소스를 하나의 최신순 타임라인으로 접는다. **순수함수.**
 *
 * 각 소스는 이미 서버가 정렬해 주지만 그것만 믿으면 안 된다 — 소스별로 따로
 * 잘라온 두 목록을 이어붙이면 경계에서 시간이 뒤섞인다(사람 3건 뒤에 오케
 * 100건이 통째로 오는 모양). 여기서 한 번 더 접어야 "타임라인"이 된다.
 *
 * 동률은 입력 순서를 유지한다(Array.prototype.sort 는 ES2019+ stable).
 */
export function mergeAuditRows(
  ...groups: readonly UnifiedAuditRow[][]
): UnifiedAuditRow[] {
  return groups
    .flat()
    .sort((a, b) => auditTimeValue(b.createdAt) - auditTimeValue(a.createdAt));
}

/**
 * 두 소스 → 하나의 최신순 통합 타임라인. **이 슬라이스의 핵심 순수함수.**
 *
 * firebase 도 react 도 안 타므로 단위테스트가 이 함수에 그대로 붙는다 —
 * "denied≠empty", "오래된 무귀속 행을 안 버린다", "경계에서 시간이 안 섞인다"
 * 같은 계약이 전부 여기서 검증된다.
 */
export function buildAuditRows(
  human: readonly ProjectAuditEvent[],
  agent: readonly AuditLog[],
  nameByUid: Record<string, string> = {},
): UnifiedAuditRow[] {
  return mergeAuditRows(
    human.map((event) => humanAuditRow(event, nameByUid)),
    agent.map((event) => agentAuditRow(event, nameByUid)),
  );
}

// ── 종류 필터 (소스를 가르는 축) ─────────────────────────────────

/**
 * 오케 쪽 종류 필터 값의 접두사.
 *
 * 사람 종류(`chat.message.sent` …)와 툴 이름(`update_task_status` …)이 같은
 * `<select>` 에 섞이는데, 두 네임스페이스가 언젠가 충돌할 수 있어 접두사로
 * 못 박는다. 접두사가 있으면 파싱이 **어느 소스에 거는 필터인가**를 확정한다.
 */
export const AGENT_TYPE_FILTER_PREFIX = "tool:";

export function agentTypeFilterValue(toolName: string): string {
  return `${AGENT_TYPE_FILTER_PREFIX}${toolName}`;
}

/**
 * 종류 필터 해석 결과.
 *
 * ★종류 필터는 **소스를 가른다**: 사람 종류를 고르면 원장은 조회하지 않고, 툴
 * 이름을 고르면 사람 쪽을 조회하지 않는다. 안 고른 소스를 그대로 다 실어주면
 * "채팅 전송만 보기"를 눌렀는데 오케 100건이 그대로 남는 — 필터가 아무것도 안
 * 한 것처럼 보이는 화면이 된다.
 */
export type AuditTypeFilter =
  | { source: "both" }
  | { source: "human"; type: ProjectAuditEventType }
  | { source: "agent"; toolName: string };

/**
 * 필터 값 파싱. 빈 값/`undefined`/모르는 값은 **전체**로 접는다.
 *
 * 모르는 값을 "아무것도 안 보임"으로 접지 않는 이유: 그러면 옛 선택값이 남아
 * 있는 상황에서 화면이 영구히 0건이 되고, 사용자는 그걸 기록이 없는 것으로
 * 읽는다. 실제로 이 드롭다운은 우리가 만든 값만 내보내므로 이 경로는 방어다.
 */
export function parseAuditTypeFilter(
  value: string | undefined | null,
): AuditTypeFilter {
  const raw = value?.trim();
  if (!raw) return { source: "both" };
  if (raw.startsWith(AGENT_TYPE_FILTER_PREFIX)) {
    const toolName = raw.slice(AGENT_TYPE_FILTER_PREFIX.length).trim();
    return toolName ? { source: "agent", toolName } : { source: "both" };
  }
  if (isProjectAuditEventType(raw)) return { source: "human", type: raw };
  return { source: "both" };
}

// ── 소스별 로드 상태 ─────────────────────────────────────────────

/**
 * 소스 하나의 상태.
 *
 * ★소스마다 **따로** 든다. 한 소스가 permission-denied 났다고 다른 소스까지
 * 죽이면, 원장은 멤버 전원이 읽을 수 있는데도 사람 쪽 거부 하나 때문에 화면이
 * 통째로 "권한 없음"이 된다 — 볼 수 있는 것을 못 보게 만드는 회귀다.
 *
 * `skipped` 는 "종류 필터가 다른 소스를 골랐다" 다. `ready(0)` 과 가르는 이유는
 * 같다 — 조회조차 안 한 소스를 "0건"이라고 말하면 없는 사실을 단정하게 된다.
 */
export type AuditFailureState =
  | { status: "denied" }
  | { status: "error"; message: string };

export type AuditSourceState =
  | { status: "loading" }
  | { status: "skipped" }
  | { status: "ready"; count: number }
  | AuditFailureState;

export interface AuditSources {
  human: AuditSourceState;
  agent: AuditSourceState;
}

export interface AuditSourceNotice {
  source: AuditActorKind;
  state: AuditFailureState;
}

function asFailure(state: AuditSourceState): AuditFailureState | null {
  if (state.status === "denied") return { status: "denied" };
  if (state.status === "error")
    return { status: "error", message: state.message };
  return null;
}

/**
 * 부분 실패 안내 목록.
 *
 * 한 소스만 죽었을 때 조용히 넘어가면 화면은 "일부만 있는 타임라인"인데 사용자는
 * 그것을 **전부**로 읽는다. 감사에서 부분 목록을 전체로 오인하게 두는 건
 * 빈 화면보다 나쁘다 — 그래서 살아남은 소스를 보여주되 무엇이 빠졌는지 항상 말한다.
 */
export function auditSourceNotices(sources: AuditSources): AuditSourceNotice[] {
  const notices: AuditSourceNotice[] = [];
  const human = asFailure(sources.human);
  if (human) notices.push({ source: "human", state: human });
  const agent = asFailure(sources.agent);
  if (agent) notices.push({ source: "agent", state: agent });
  return notices;
}

/**
 * 두 소스가 **모두** 거부됐는가 = 전체 "권한 없음" 화면을 띄울 조건.
 *
 * 하나만 거부면 전체 화면을 띄우지 않는다(위 notices 로 부분 안내). 거부와
 * 에러가 섞인 경우도 전체 거부가 아니다 — 서로 다른 사실이라 한 문장으로
 * 뭉개면 owner 가 권한 문제를 장애로, 장애를 권한 문제로 읽는다.
 */
export function isFullyDenied(sources: AuditSources): boolean {
  return sources.human.status === "denied" && sources.agent.status === "denied";
}

/** 아직 로딩 중인 소스가 있는가(=스피너). */
export function isAuditLoading(sources: AuditSources): boolean {
  return (
    sources.human.status === "loading" || sources.agent.status === "loading"
  );
}

// ── 행위자 목록 병합 ─────────────────────────────────────────────

export interface AuditActorTally {
  actorUid: string;
  actorName: string | null;
  count: number;
}

/**
 * 두 소스의 행위자 집계를 uid 로 합친다.
 *
 * 같은 사람이 사람 행위 3건 + 오케 발주 40건이면 한 줄에 43 으로 보여야 한다 —
 * 두 줄로 갈리면 "구성원 필터"가 아니라 "소스별 구성원 필터"가 돼서, 고르는
 * 순간 반쪽 타임라인이 나온다.
 *
 * 이름은 있는 쪽을 남긴다(원장 쪽은 항상 null 이라 사람 쪽 이름이 이긴다).
 */
export function mergeAuditActors(
  ...groups: readonly AuditActorTally[][]
): AuditActorTally[] {
  const byUid = new Map<string, AuditActorTally>();
  for (const group of groups) {
    for (const actor of group) {
      if (!actor.actorUid) continue;
      const prior = byUid.get(actor.actorUid);
      if (prior) {
        prior.count += actor.count;
        prior.actorName = prior.actorName ?? actor.actorName;
      } else {
        byUid.set(actor.actorUid, { ...actor });
      }
    }
  }
  return [...byUid.values()].sort((a, b) => b.count - a.count);
}

// ── 태스크 제목 해석 ─────────────────────────────────────────────

/**
 * 행의 티켓 id → 표시용 라벨(제목 우선, 없으면 해시).
 *
 * `titleById` 는 현재 `tasks` 컬렉션 스냅샷이다(services/projectAuditService.ts
 * `getProjectTaskTitles`). ★소프트 삭제된 티켓은 문서가 그대로 남아 title 도
 * 살아 있어서 여기 잡힌다 — 삭제돼도 제목이 보이는 이유다. **물리 삭제**된
 * 티켓만 맵에서 빠지고, 그때는 해시로 떨어진다(원장에 title 스냅샷 필드가
 * 없어 그 이상은 복구할 수 없다 — 캡처를 건드리지 않는 이 티켓의 한계).
 *
 * 사람 쪽 `resolveActorLabel`(이름 메꿈)과 같은 모양의 함수다: 있으면 쓰고,
 * 없으면 조용히 사라지지 않게 판별 가능한 형태(해시)로 떨어진다.
 */
export function resolveTaskLabel(
  taskId: string | null,
  titleById: Record<string, string> = {},
): string | null {
  if (!taskId) return null;
  const title = titleById[taskId]?.trim();
  return title ? title : `#${taskId.slice(0, 8)}`;
}

// ── 행위자 뱃지 종류 ─────────────────────────────────────────────

/**
 * 뱃지 3분류: 사람 / 오케(에이전트, 모델 있음) / 오케(컨트롤플레인, 모델 없음).
 *
 * 지금은 오케가 사장님 uid 로 행동해 사람 행과 오케 행이 이름만으로는 안
 * 갈린다(actorLabel 이 둘 다 "John Kim"). `actorKind`+`model` 로 시각 구분을
 * 강제한다 — 원래 #730 취지를 이어받아, 스폰된 에이전트가 한 일(모델이 실림)과
 * 오케 자신이 MCP 툴을 직접 호출한 일(모델 없음 — 스폰 없이 발생)을 또 가른다.
 * 후자를 "모델 미상"(오류처럼 읽힘)이 아니라 "오케 조작"(정상 분류)으로 표기하는
 * 이유가 이것이다.
 */
export type AuditBadgeKind =
  | "human"
  | "agentModel"
  | "orchestratorControlPlane";

export function auditBadgeKind(
  row: Pick<UnifiedAuditRow, "actorKind" | "model">,
): AuditBadgeKind {
  if (row.actorKind === "human") return "human";
  return row.model ? "agentModel" : "orchestratorControlPlane";
}

// ── 노이즈 접기 ──────────────────────────────────────────────────

/** 접기 대상 툴. `add_activity` 는 진행 메모라 같은 티켓에 연속으로 쌓이기 쉽다. */
const FOLDABLE_TOOL_NAME = "add_activity";

/** 행의 raw 툴 이름. i18n(사람 종류) 행엔 툴 이름 개념이 없어 null. */
function auditRowToolName(row: UnifiedAuditRow): string | null {
  if (row.label.kind === "tool") return row.label.toolName;
  if (row.label.kind === "raw") return row.label.text;
  return null;
}

function isFoldableAuditRow(row: UnifiedAuditRow): boolean {
  return (
    row.actorKind === "agent" &&
    !!row.taskId &&
    auditRowToolName(row) === FOLDABLE_TOOL_NAME
  );
}

// ── 저신호 기본 숨김 ─────────────────────────────────────────────

/**
 * 기본 뷰에서 접어두는 저신호 오케 행위. 텔레그램 발송·메모(add_activity)는
 * 실제로 무엇이 바뀌었나(상태전이·스폰·머지)가 아니라 커뮤니케이션 부산물이라,
 * 매 세션 수십 건씩 쌓여 신호 있는 행을 밀어낸다(사장님 도그푸딩 피드백).
 *
 * ★캡처는 그대로다 — 이 필터는 표시 여부만 가른다. `audit_logs` 원문은 지우지도
 * 새로 쓰지도 않고, 토글(`showLowSignal`)을 켜면 즉시 그대로 다시 보인다.
 */
const LOW_SIGNAL_TOOL_NAMES = new Set([
  "send_telegram_message",
  "add_activity",
]);

export function isLowSignalAuditRow(row: UnifiedAuditRow): boolean {
  if (row.actorKind !== "agent") return false;
  const toolName = auditRowToolName(row);
  return toolName ? LOW_SIGNAL_TOOL_NAMES.has(toolName) : false;
}

/** 접힌 그룹 하나. 원본 행(`rows`)은 그대로 들고 있다 — 펼치면 캡처와 1:1로 대응한다. */
export interface AuditRowGroup {
  kind: "group";
  key: string;
  taskId: string;
  rows: UnifiedAuditRow[];
}

export type AuditDisplayRow =
  | { kind: "row"; row: UnifiedAuditRow }
  | AuditRowGroup;

// ═══════════════════════════════════════════════════════════════════
// 티켓 상세 — 한 티켓의 원장 상세(#754 확장, 티켓 U6ITRR38Z3c4MGLyg2PU)
// ═══════════════════════════════════════════════════════════════════
//
// 목록 행(`UnifiedAuditRow`)은 요약이라 seq/prevHash/hash·kind 같은 원장 원본
// 필드를 담지 않는다. 티켓 상세 패널은 그 원본을 그대로 보여줘야 하므로, 목록용
// 타입을 오염시키지 않고 **상세 전용 파생**을 여기 따로 둔다.

/**
 * 원장 확장 필드(§5) 하나의 표시 상태.
 *
 * ★"없음"을 한 종류로 뭉개지 않는다 — 세 사실이 서로 다르다:
 *   - `preLedger`      — 문서에 그 **필드 자체가 없다**(원장 확장 이전에 쓰인 기록).
 *   - `outOfConvention`— 필드는 있는데 값이 null(예: 워크트리 경로 규약 밖이라
 *                        `parseWorktreePath` 가 null 을 write 했다 — ledger.ts §8).
 *   - `value`          — 실제 값이 있다.
 * 티켓 스펙의 "확실한 척 금지"가 이 세 갈래를 요구한다 — `outOfConvention` 을
 * `preLedger` 로 보여주면 "이 기록엔 원래 워크트리 개념이 없었다"는 거짓말이 되고,
 * 반대로 접으면 "판별에 실패했다"는 사실이 "정상적으로 없다"로 읽힌다.
 */
export type LedgerFieldValue =
  | { state: "preLedger" }
  | { state: "outOfConvention" }
  | { state: "value"; value: string };

/** 원장 확장(§5) 필드 중 상세 패널이 표시하는 것. */
type LedgerExtensionField =
  | "actorUid"
  | "model"
  | "tier"
  | "taskId"
  | "worktreeId"
  | "instructionHash";

/**
 * 확장 필드 하나의 표시 상태를 뽑는다.
 *
 * `field in event` 로 **필드 부재**(원장 확장 이전 문서)를 판별한다 —
 * `convertTimestamps`(services/firestore.ts)가 raw Firestore 문서를 그대로
 * spread 하므로, Firestore 에 없던 필드는 여기서도 진짜로 없다(값이 `undefined`
 * 인 게 아니라 키 자체가 없다). 그래서 옵셔널 체이닝(`event.field == null`)이
 * 아니라 `in` 을 쓴다 — 그래야 "없다"와 "있는데 null 이다"가 갈린다.
 */
export function ledgerFieldValue(
  event: AuditLog,
  field: LedgerExtensionField,
): LedgerFieldValue {
  if (!(field in event)) return { state: "preLedger" };
  const raw = event[field];
  if (raw === null || raw === undefined || raw === "") {
    return { state: "outOfConvention" };
  }
  return { state: "value", value: String(raw) };
}

/**
 * 봉인(체인) 상태. `seq`/`prevHash`/`hash` 는 L3 가 채우는 필드고(ledger.ts §6
 * 주석: "이번 슬라이스는 write 하지 않는다"), 지금은 항상 비어 있어 모든 행이
 * `unsealed` 다 — 그게 사실이므로 그대로 보여준다("봉인됨"으로 지어내지 않는다).
 * L3 가 배선되면 이 함수 하나만 바뀌면 되도록 판정을 여기 모아 둔다.
 */
export function auditSealStatus(
  event: Pick<AuditLog, "seq" | "prevHash" | "hash">,
): "sealed" | "unsealed" {
  return event.seq != null && !!event.prevHash && !!event.hash
    ? "sealed"
    : "unsealed";
}

/** 티켓 상세 패널의 원장 행 한 건 — 목록 행 + 원장 전용 필드. */
export interface TicketLedgerRow extends UnifiedAuditRow {
  /** 사람 행은 체인 개념이 없다 — null. */
  sealStatus: "sealed" | "unsealed" | null;
  /** 사람 행은 워크트리 개념이 없다 — null. */
  worktree: LedgerFieldValue | null;
}

/**
 * 한 티켓의 통합 이력. **순수함수.** `buildAuditRows` 와 같은 병합 규칙(최신순,
 * 소스 태깅)을 쓰되, 오케 행에는 봉인 상태·워크트리 필드 상태를 더 싣는다.
 *
 * 호출부가 이미 `taskId` 로 필터된 두 소스를 넘긴다고 가정한다(서버 사이드
 * 필터는 `services/projectAuditService.ts` 의 `taskId` 축) — 여기서 다시
 * 거르지 않는다.
 */
export function buildTicketLedgerRows(
  human: readonly ProjectAuditEvent[],
  agent: readonly AuditLog[],
  nameByUid: Record<string, string> = {},
): TicketLedgerRow[] {
  const humanRows: TicketLedgerRow[] = human.map((event) => ({
    ...humanAuditRow(event, nameByUid),
    sealStatus: null,
    worktree: null,
  }));
  const agentRows: TicketLedgerRow[] = agent.map((event) => ({
    ...agentAuditRow(event, nameByUid),
    sealStatus: auditSealStatus(event),
    worktree: ledgerFieldValue(event, "worktreeId"),
  }));
  return mergeAuditRows(humanRows, agentRows) as TicketLedgerRow[];
}

/**
 * 최신순으로 이미 정렬된 행 목록을 화면 표시 단위로 접는다. **순수함수, 뷰 전용.**
 *
 * ★캡처는 그대로다 — `rows` 는 이미 buildAuditRows 가 만든 값을 그대로 들고
 * 있을 뿐, 원본 이벤트를 지우거나 합치지 않는다. 접힌 그룹을 펼치면 원문
 * 그대로 다시 보인다(완결성 유지, 표현만 접는다).
 *
 * 같은 티켓의 **연속된**(사이에 다른 티켓/사람 행이 안 끼는) `add_activity` 가
 * `minGroupSize`(기본 2) 건 이상일 때만 접는다. 1건뿐이면 접어봐야 화면만
 * 복잡해지므로 그대로 낱개 행으로 남긴다.
 */
export function foldAuditRows(
  rows: readonly UnifiedAuditRow[],
  minGroupSize = 2,
): AuditDisplayRow[] {
  const out: AuditDisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (isFoldableAuditRow(row)) {
      let j = i + 1;
      while (
        j < rows.length &&
        isFoldableAuditRow(rows[j]) &&
        rows[j].taskId === row.taskId
      ) {
        j++;
      }
      const group = rows.slice(i, j);
      if (group.length >= minGroupSize) {
        out.push({
          kind: "group",
          key: `group:${row.key}`,
          taskId: row.taskId!,
          rows: group,
        });
        i = j;
        continue;
      }
    }
    out.push({ kind: "row", row });
    i++;
  }
  return out;
}
