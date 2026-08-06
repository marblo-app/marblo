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
import type { TaskStatus } from "../types/task";
import { getMissionId } from "./laneContext";
import { isProjectAuditEventType } from "./projectAudit";
import { scrubString, scrubValue } from "./telemetry/scrub";

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
  /** 사람 행은 워크트리 개념이 없다 — null. 오케 행은 원장 worktreeId 상태. */
  worktree: LedgerFieldValue | null;
  /** 저장된 원장 상세의 표시용 projection. params/result 는 scrubbed 문자열만 싣는다. */
  evidence: AuditRowEvidence | null;
}

export interface AuditRowEvidence {
  paramsJson: string | null;
  resultText: string | null;
  instructionRedacted: string | null;
  activityText: string | null;
  resolutionText: string | null;
}

function stableJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return null;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify(String(value));
  }
}

function agentRowEvidence(
  event: Pick<
    AuditLog,
    "toolName" | "params" | "result" | "instructionRedacted"
  >,
): AuditRowEvidence {
  const paramsJson = stableJson(scrubValue(event.params));
  const resultText =
    typeof event.result === "string" && event.result.trim()
      ? scrubString(event.result.trim())
      : null;
  const instructionRedacted =
    typeof event.instructionRedacted === "string" &&
    event.instructionRedacted.trim()
      ? event.instructionRedacted.trim()
      : null;
  const rawActivity =
    event.toolName === "add_activity" &&
    typeof event.params?.message === "string"
      ? event.params.message.trim()
      : null;
  const rawResolution =
    event.toolName === "submit_for_review"
      ? stringFromPath(event.params, ["summary", "changes"]) ??
        stringFromPath(event.params, ["summary", "verification"]) ??
        stringFromPath(event.params, ["summary", "approach"]) ??
        stringFromPath(event.params, ["summary", "problem"])
      : null;
  return {
    paramsJson,
    resultText,
    instructionRedacted,
    activityText: rawActivity ? scrubString(rawActivity) : null,
    resolutionText: rawResolution ? scrubString(rawResolution) : null,
  };
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
    worktree: null,
    evidence: null,
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
    worktree: ledgerFieldValue(event, "worktreeId"),
    evidence: agentRowEvidence(event),
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

// ═══════════════════════════════════════════════════════════════════
// 관리자 뷰 — 문제 우선 · 미션/티켓 묶음 · 링크 클러스터
// ═══════════════════════════════════════════════════════════════════
//
// ★왜 시간순 firehose 를 접는가
// 위의 `buildAuditRows` 는 "언제 무슨 일이 있었나"를 최신순 한 줄씩 준다. 그건
// 한 사건을 되짚을 때는 맞지만, **운영자가 화면을 여는 이유**와는 다르다:
// 운영자는 "지금 무엇이 막혔나 / 누가 무엇을 지고 있나 / 이 티켓은 어디까지
// 갔나"를 본다. 같은 티켓 하나가 created→claimed→dispatched→status→submitted
// 로 5줄씩 흩어지면 그 세 질문 중 어느 것도 답이 안 나온다(사장님 도그푸딩
// 피드백).
//
// 그래서 이 섹션은 같은 행들을 **세 겹으로 다시 접는다**: 티켓(1차) → 미션
// (상위) → 그리고 그 위에 **문제 우선** 목록. 캡처도 원본 행도 건드리지 않는다 —
// `AuditTicketGroup.rows` 는 그대로 `UnifiedAuditRow` 이고, 펼치면 예전 타임라인이
// 그대로 다시 보인다(표현만 접는다는 `foldAuditRows` 의 원칙 그대로).
//
// ★왜 순수함수 모듈에 두는가 (설계 §7)
// 이 파일은 firebase 도 react 도 electron IPC 도 타지 않는다. 그래서 같은 뷰모델을
// 나중에 웹 관리자 콘솔(marblo.app admin)이 그대로 lift 할 수 있다 — 그쪽은
// Electron 스토어(worktree/agent)가 없으므로, 그 두 축은 **주입받는 옵션**
// (`liveAgentIds`)이나 **원장에서 파생된 값**(`worktreeId`)으로만 표현하고
// 여기서 직접 조회하지 않는다.

/**
 * 감사 뷰가 티켓에 대해 필요로 하는 **최소 사실**. `tasks` 스냅샷의 얇은 투영이다.
 *
 * 왜 `Task` 를 그대로 안 쓰는가: 이 모듈은 렌더러 스토어가 없는 곳(웹 콘솔)에서도
 * 돌아야 하고, `Task` 전체를 요구하면 그 호출부가 보드 스토어까지 끌고 와야 한다.
 * 감사 뷰가 실제로 읽는 6개 필드만 계약으로 못 박는다.
 *
 * 각 필드의 `null` 은 "모른다"이지 "없다"가 아니다 — 티켓 문서를 못 읽은 경우
 * (물리 삭제 등)와 값이 빈 경우를 호출부가 가를 수 있어야 한다.
 */
export interface AuditTaskMeta {
  id: string;
  title: string | null;
  status: TaskStatus | null;
  /**
   * 원문 `contextId`. 미션 귀속은 여기서 파생한다 — 판정 규약(`"board"` 도
   * `"lane:*"` 도 아니면 missionId)은 lib/laneContext 하나에만 있고, 이 모듈은
   * 그것을 부를 뿐 다시 구현하지 않는다. (`Task` 에는 `missionId` 필드가 아예
   * 없다 — dispatcher 가 `contextId: missionId` 로 태깅하는 것이 유일한 결속.)
   */
  contextId: string | null;
  prUrl: string | null;
  claimedBy: string | null;
  archived: boolean;
  deleted: boolean;
}

/** 미션 섹션 헤더가 쓰는 최소 사실. `projection` 은 #775 프로젝터 롤업. */
export interface AuditMissionMeta {
  id: string;
  goal: string | null;
  status: string | null;
  taskIds: string[];
  statusCounts: Partial<Record<string, number>> | null;
}

// ── 주의 필요(문제 우선) ─────────────────────────────────────────

/**
 * 이 티켓이 사람 손을 필요로 하는 이유.
 *
 * ★사실만 담는다. 각 종류는 **관측된 값 하나**에 1:1로 대응하고, 추측은 없다:
 *   - `taskFailed`    — 티켓 상태가 FAILED (에이전트가 스스로 실패를 보고했다).
 *   - `taskBlocked`   — 티켓 상태가 BLOCKED (무언가를 기다린다고 스스로 말했다).
 *   - `failedActions` — 원장에 `success:false` 툴 호출이 있다.
 *   - `orphanedClaim` — 클레임한 에이전트 id 가 살아 있는 에이전트 목록에 없다.
 *   - `stalled`       — 진행 중(CLAIMED/IN_PROGRESS/REVIEW)인데 마지막 기록이
 *                       임계값보다 오래됐다.
 */
export type AuditAttentionKind =
  | "taskFailed"
  | "taskBlocked"
  | "failedActions"
  | "orphanedClaim"
  | "stalled";

export type AuditAttentionSeverity = "critical" | "warning";

export interface AuditAttention {
  kinds: AuditAttentionKind[];
  severity: AuditAttentionSeverity;
  /** `stalled` 의 근거 — 마지막 기록 이후 경과(ms). 해당 없으면 null. */
  idleMs: number | null;
}

/**
 * 정체 판정 임계값. 6시간 — 한 근무 반나절이다.
 *
 * 이 값을 짧게(예: 30분) 잡으면 정상적으로 긴 턴을 도는 에이전트가 전부 "정체"로
 * 뜨고, 배너가 한 번 늑대소년이 되면 진짜 정체를 아무도 안 본다. 판정 자체는
 * 주입 가능(`stalledAfterMs`)하게 열어 둔다 — 테스트와 향후 설정 UI 를 위해.
 */
export const AUDIT_STALLED_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * 에이전트 목록 → 클레임 키 집합.
 *
 * ★`task.claimedBy` 는 **id 일 수도 이름일 수도 있다**(보드가 실제로
 * `a.id === claimedBy || a.name === claimedBy || a.name.toLowerCase() === ...`
 * 로 푼다 — components/board/TaskDetailModal.tsx). 여기서 id 만 모으면 이름으로
 * 물린 티켓이 전부 "고아 클레임"으로 떠서 배너가 통째로 거짓말이 된다. 그래서
 * 같은 세 갈래를 모두 키로 넣는다(대조는 `auditAttention` 이 원문·소문자 둘 다로).
 *
 * `Agent` 타입을 안 받고 구조로만 받는 이유는 이 모듈의 나머지와 같다 —
 * 렌더러 스토어가 없는 곳(웹 콘솔)에서도 돌아야 한다.
 */
export function auditAgentClaimKeys(
  agents: readonly { id: string; name: string }[],
): Set<string> {
  const keys = new Set<string>();
  for (const agent of agents) {
    if (agent.id) keys.add(agent.id);
    if (agent.name) {
      keys.add(agent.name);
      keys.add(agent.name.toLowerCase());
    }
  }
  return keys;
}

/** 아직 끝나지 않은 = 누군가 지고 있어야 하는 상태. */
const IN_FLIGHT_TASK_STATUSES: ReadonlySet<string> = new Set([
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
]);

/** 즉시 손이 필요한 종류. 나머지는 경고(노랑). */
const CRITICAL_ATTENTION_KINDS: ReadonlySet<AuditAttentionKind> = new Set([
  "taskFailed",
  "failedActions",
  "orphanedClaim",
]);

export interface AuditAttentionInput {
  status: TaskStatus | null;
  claimedBy: string | null;
  archived: boolean;
  deleted: boolean;
  /** 이 티켓 그룹 안의 실패한 툴 호출 수. */
  failedCount: number;
  /** 이 티켓의 가장 최근 기록 시각. */
  latestAt: Date;
}

export interface AuditAttentionOptions {
  now?: Date;
  /**
   * 살아 있는 에이전트의 **클레임 키** 집합 — `auditAgentClaimKeys` 로 만든다.
   *
   * ★`null`/미지정이면 고아 클레임 **판정을 아예 하지 않는다**. 에이전트 스토어가
   * 아직 하이드레이트되지 않은 상태에서 빈 집합을 넘기면 진행 중인 티켓이 전부
   * "고아"로 떠서, 배너가 첫 프레임마다 거짓 경보를 낸다 — "모른다"를 "없다"로
   * 접지 않는다는 이 파일의 규칙(LedgerFieldValue 주석)과 같은 이유. 에이전트
   * 스토어 자체가 `hydrated` 로 그 둘을 가르고 있으니 호출부는 그걸 그대로 쓴다.
   */
  liveAgentKeys?: ReadonlySet<string> | null;
  stalledAfterMs?: number;
}

/**
 * 티켓 하나의 주의 필요 판정. 없으면 null.
 *
 * ★끝난 티켓은 문제가 아니다. DONE·보관·삭제된 티켓은 과거에 실패한 호출이
 * 있었더라도 배너에 올리지 않는다 — 이미 사람이 처리해서 끝난 일을 계속 "N건
 * 주의 필요"로 세면 그 숫자가 영원히 안 줄고, 배너 전체가 무시된다.
 *
 * 티켓 문서를 못 읽은 경우(`status === null`)는 상태 기반 판정을 못 하지만,
 * `failedActions` 는 원장이 직접 말하는 사실이라 그대로 남긴다.
 */
export function auditAttention(
  input: AuditAttentionInput,
  options: AuditAttentionOptions = {},
): AuditAttention | null {
  if (input.deleted || input.archived || input.status === "DONE") return null;

  const kinds: AuditAttentionKind[] = [];
  if (input.status === "FAILED") kinds.push("taskFailed");
  if (input.status === "BLOCKED") kinds.push("taskBlocked");
  if (input.failedCount > 0) kinds.push("failedActions");

  const inFlight = !!input.status && IN_FLIGHT_TASK_STATUSES.has(input.status);

  const liveAgentKeys = options.liveAgentKeys;
  if (
    inFlight &&
    input.claimedBy &&
    liveAgentKeys != null &&
    !liveAgentKeys.has(input.claimedBy) &&
    !liveAgentKeys.has(input.claimedBy.toLowerCase())
  ) {
    kinds.push("orphanedClaim");
  }

  const stalledAfterMs = options.stalledAfterMs ?? AUDIT_STALLED_AFTER_MS;
  const nowMs = auditTimeValue(options.now ?? new Date());
  const latestMs = auditTimeValue(input.latestAt);
  // latestMs === 0 은 시각 변환 실패다(auditTimeValue). 그걸 "1970년부터 정체"로
  // 읽으면 모든 손상 행이 최우선 경보가 된다 — 판정에서 뺀다.
  const idleMs = latestMs > 0 ? nowMs - latestMs : null;
  if (inFlight && idleMs !== null && idleMs >= stalledAfterMs) {
    kinds.push("stalled");
  }

  if (kinds.length === 0) return null;
  return {
    kinds,
    severity: kinds.some((kind) => CRITICAL_ATTENTION_KINDS.has(kind))
      ? "critical"
      : "warning",
    idleMs: kinds.includes("stalled") ? idleMs : null,
  };
}

// ── 티켓 그룹 ────────────────────────────────────────────────────

/**
 * 티켓 하나의 모든 행을 접은 그룹 = 이 화면의 1차 단위.
 *
 * `taskId === null` 은 **티켓에 안 붙는 행들**(티켓 없는 채팅, `get_agents` 같은
 * 조회 툴 …)의 묶음이다. 버리지 않는다 — 감사에서 조용한 누락은 가장 나쁜
 * 실패이고, 그건 이 파일이 `auditTypeLabelKey` 부터 지켜 온 규칙이다.
 */
export interface AuditTicketGroup {
  key: string;
  taskId: string | null;
  /** 티켓 제목. 못 읽으면 null — 호출부가 해시/기타로 그린다. */
  title: string | null;
  status: TaskStatus | null;
  missionId: string | null;
  /** 링크 클러스터의 PR. 없으면 null → 링크를 **숨긴다**(죽은 링크 금지). */
  prUrl: string | null;
  /** 링크 클러스터의 워크트리. 원장에서 파생 — 라이브/아카이브 판정은 호출부. */
  worktreeId: string | null;
  /** 이 티켓을 선점한 에이전트 id. 고아 클레임 사유의 근거로 화면에 밝힌다. */
  claimedBy: string | null;
  /** 이 티켓에 등장한 모델(중복 제거, 등장 순). */
  models: string[];
  /** 이 티켓에 등장한 행위자 표시 이름(중복 제거, 등장 순). */
  actorLabels: string[];
  actionCount: number;
  actorCount: number;
  failedCount: number;
  latestAt: Date;
  attention: AuditAttention | null;
  /** 원본 행 — 최신순 그대로. 펼치면 캡처와 1:1. */
  rows: UnifiedAuditRow[];
  detail: AuditTicketDetailEvidence;
}

export interface AuditTicketDetailEvidence {
  lastActivity: string | null;
  resolutionSummary: string | null;
  prUrl: string | null;
  worktreeId: string | null;
}

function stringFromPath(value: unknown, path: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim()
    ? current.trim()
    : null;
}

function latestActivity(rows: readonly UnifiedAuditRow[]): string | null {
  for (const row of rows) {
    const text = row.evidence?.activityText;
    if (text) return text;
  }
  return null;
}

function latestResolutionSummary(rows: readonly UnifiedAuditRow[]): string | null {
  for (const row of rows) {
    const toolName = auditRowToolName(row);
    if (toolName !== "submit_for_review") continue;
    const summary = row.evidence?.resolutionText;
    if (summary) return summary;
    if (row.evidence?.resultText) return row.evidence.resultText;
  }
  return null;
}

/** 티켓에 안 붙는 행들의 그룹 키(고정). */
export const AUDIT_NO_TICKET_KEY = "__noTicket__";

function distinct(values: readonly (string | null)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * 그룹의 최신 시각. 입력이 최신순 정렬돼 있어도 **다시 최대값을 구한다** —
 * 정렬을 믿고 `rows[0]` 을 쓰면, 손상된 createdAt(0 으로 접힌 값)이 맨 앞에
 * 오는 순간 그룹 전체가 1970년으로 보인다.
 */
function latestRowTime(rows: readonly UnifiedAuditRow[]): Date {
  let best: Date | null = null;
  let bestMs = -1;
  for (const row of rows) {
    const ms = auditTimeValue(row.createdAt);
    if (ms > bestMs) {
      bestMs = ms;
      best = row.createdAt;
    }
  }
  return best ?? new Date(0);
}

/** 원장 행에 실린 워크트리 id 중 실제 값이 있는 첫 번째. 없으면 null. */
function groupWorktreeId(rows: readonly UnifiedAuditRow[]): string | null {
  for (const row of rows) {
    if (row.worktree?.state === "value") return row.worktree.value;
  }
  return null;
}

function summarizeTicketGroup(
  taskId: string | null,
  rows: UnifiedAuditRow[],
  meta: AuditTaskMeta | undefined,
  options: AuditAttentionOptions,
): AuditTicketGroup {
  const latestAt = latestRowTime(rows);
  const failedCount = rows.filter((row) => row.failed).length;
  const archived = meta?.archived ?? false;
  const deleted = meta?.deleted ?? false;
  const status = meta?.status ?? null;
  const claimedBy = meta?.claimedBy?.trim() || null;

  return {
    key: `ticket:${taskId ?? AUDIT_NO_TICKET_KEY}`,
    taskId,
    title: meta?.title?.trim() || null,
    status,
    missionId: getMissionId(meta?.contextId ?? undefined),
    prUrl: meta?.prUrl?.trim() || null,
    worktreeId: groupWorktreeId(rows),
    claimedBy,
    models: distinct(rows.map((row) => row.model)),
    actorLabels: distinct(rows.map((row) => row.actorLabel)),
    actionCount: rows.length,
    // 귀속 불가 행(actorUid 없음)이 섞여 있어도 "행위자 0명"이라고 말하지
    // 않는다 — uid 로 셀 수 없을 뿐 누군가는 했다. 그런 행만 있으면 0 이고,
    // 호출부가 "미귀속"으로 그린다.
    actorCount: new Set(
      rows.map((row) => row.actorUid).filter((uid): uid is string => !!uid),
    ).size,
    failedCount,
    latestAt,
    attention:
      taskId === null
        ? // 티켓에 안 붙는 행 묶음은 "티켓 상태"라는 개념이 없다. 실패한 호출은
          // 여전히 사실이므로 그것만으로 판정한다.
          auditAttention(
            {
              status: null,
              claimedBy: null,
              archived: false,
              deleted: false,
              failedCount,
              latestAt,
            },
            options,
          )
        : auditAttention(
            {
              status,
              claimedBy,
              archived,
              deleted,
              failedCount,
              latestAt,
            },
            options,
          ),
    rows,
    detail: {
      lastActivity: latestActivity(rows),
      resolutionSummary: latestResolutionSummary(rows),
      prUrl: meta?.prUrl?.trim() || null,
      worktreeId: groupWorktreeId(rows),
    },
  };
}

/**
 * 행 목록 → 티켓 그룹. **순수함수.**
 *
 * 입력이 최신순이라는 전제하에 첫 등장 순서로 그룹을 배치하고(=최신 활동 순),
 * 각 그룹 안의 행 순서도 입력 그대로 유지한다.
 */
export function groupAuditRowsByTicket(
  rows: readonly UnifiedAuditRow[],
  taskMetaById: Record<string, AuditTaskMeta> = {},
  options: AuditAttentionOptions = {},
): AuditTicketGroup[] {
  const order: (string | null)[] = [];
  const byTask = new Map<string | null, UnifiedAuditRow[]>();
  for (const row of rows) {
    const key = row.taskId ?? null;
    const prior = byTask.get(key);
    if (prior) prior.push(row);
    else {
      byTask.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((taskId) =>
    summarizeTicketGroup(
      taskId,
      byTask.get(taskId)!,
      taskId ? taskMetaById[taskId] : undefined,
      options,
    ),
  );
}

// ── 미션 섹션 ────────────────────────────────────────────────────

/**
 * 미션 진행도.
 *
 * ★분모를 **감사 창에 잡힌 티켓 수로 잡지 않는다.** 창에 3개만 잡힌 미션을
 * "3개 중 1개 완료"라고 쓰면, 실제로 10개짜리 미션인데 화면이 33% 를 보여준다 —
 * 감사 화면이 지어낸 숫자를 말하는 순간 나머지 화면도 안 믿기게 된다.
 *
 * - `source: "projection"` — 프로젝터 롤업(#775 `mission.projection.statusCounts`).
 *   가장 신뢰할 수 있는 값이라 있으면 항상 이걸 쓴다.
 * - `source: "tasks"`      — 롤업이 없을 때만. 분모는 `mission.taskIds` 이고,
 *   그중 상태를 못 읽은 티켓 수를 `unknown` 으로 **따로 밝힌다**(0 이 아니면
 *   호출부가 "일부 미상"을 표기한다).
 */
export interface AuditMissionProgress {
  done: number;
  total: number;
  unknown: number;
  source: "projection" | "tasks";
}

export function auditMissionProgress(
  mission: AuditMissionMeta,
  taskMetaById: Record<string, AuditTaskMeta> = {},
): AuditMissionProgress | null {
  const counts = mission.statusCounts;
  if (counts) {
    const total = Object.values(counts).reduce<number>(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
    if (total > 0) {
      return {
        done: counts.DONE ?? 0,
        total,
        unknown: 0,
        source: "projection",
      };
    }
  }
  const taskIds = mission.taskIds;
  if (!taskIds.length) return null;
  let done = 0;
  let unknown = 0;
  for (const taskId of taskIds) {
    const status = taskMetaById[taskId]?.status;
    if (!status) unknown++;
    else if (status === "DONE") done++;
  }
  return { done, total: taskIds.length, unknown, source: "tasks" };
}

/**
 * 미션 하나(또는 "보드")로 묶인 티켓 그룹들.
 *
 * `missionId === null` = 미션에 안 묶인 티켓 = **보드**. 마지막에 온다 — 미션이
 * 있는 일이 상위 맥락이고, 보드는 그 밖의 낱개 작업이다.
 */
export interface AuditMissionSection {
  key: string;
  missionId: string | null;
  /** 미션 목표. 미션 문서를 못 읽었으면 null → 호출부가 id 로 떨군다. */
  goal: string | null;
  status: string | null;
  progress: AuditMissionProgress | null;
  ticketCount: number;
  actionCount: number;
  attentionCount: number;
  latestAt: Date;
  tickets: AuditTicketGroup[];
}

/** 보드 섹션(미션 없음)의 고정 키 — 미션 필터 <select> 의 값으로도 쓴다. */
export const AUDIT_BOARD_SECTION_ID = "__board__";

// ── 필터 ─────────────────────────────────────────────────────────

/**
 * 행위자 축 필터.
 *
 * `auditBadgeKind` 와 **같은 3분류**를 쓴다(사람 / 오케 컨트롤플레인 / 스폰된
 * 에이전트). 뱃지가 가르는 것과 필터가 가르는 것이 다르면, 보라색 뱃지만 골라
 * 보려고 필터를 걸었는데 다른 게 나오는 화면이 된다.
 */
export type AuditActorKindFilter = "all" | "human" | "orchestrator" | "agent";

export function auditActorKindOf(
  row: Pick<UnifiedAuditRow, "actorKind" | "model">,
): Exclude<AuditActorKindFilter, "all"> {
  const kind = auditBadgeKind(row);
  if (kind === "human") return "human";
  return kind === "agentModel" ? "agent" : "orchestrator";
}

export interface AuditAdminFilters {
  actorKind?: AuditActorKindFilter;
  /** 티켓 상태. `"all"`/미지정 = 전체. */
  status?: TaskStatus | "all";
  /** 미션 id, `AUDIT_BOARD_SECTION_ID`, 또는 `"all"`. */
  mission?: string;
}

function matchesActorKind(
  row: UnifiedAuditRow,
  filter: AuditActorKindFilter | undefined,
): boolean {
  if (!filter || filter === "all") return true;
  return auditActorKindOf(row) === filter;
}

function matchesTicketFilters(
  group: AuditTicketGroup,
  filters: AuditAdminFilters,
): boolean {
  if (filters.status && filters.status !== "all") {
    if (group.status !== filters.status) return false;
  }
  const mission = filters.mission;
  if (mission && mission !== "all") {
    const target = mission === AUDIT_BOARD_SECTION_ID ? null : mission;
    if (group.missionId !== target) return false;
  }
  return true;
}

// ── 조립 ─────────────────────────────────────────────────────────

export interface BuildAuditAdminViewOptions extends AuditAttentionOptions {
  taskMetaById?: Record<string, AuditTaskMeta>;
  missionMetaById?: Record<string, AuditMissionMeta>;
  filters?: AuditAdminFilters;
}

export interface AuditAdminView {
  /** 미션 → 보드 순. 필터가 적용된 결과. */
  sections: AuditMissionSection[];
  /**
   * 주의 필요 티켓, 심각도 → 최신순.
   *
   * ★**필터를 무시한다.** "문제 우선"이 필터로 조용히 좁혀지면, 미션 하나만
   * 보려고 필터를 건 운영자에게 다른 미션이 불타는 것이 안 보인다. 배너는 항상
   * 현재 불러온 전체를 말하고, 화면은 그 사실을 문구로 밝힌다.
   */
  attention: AuditTicketGroup[];
  /** 필터 적용 후 티켓 수 / 행 수. 헤더 카운트가 화면과 일치하도록 여기서 센다. */
  ticketCount: number;
  actionCount: number;
  /** 필터로 가려진 행 수 — 조용한 절단 금지(빈 화면 분기와 같은 이유). */
  hiddenByFilterCount: number;
}

/** 심각도(critical 먼저) → 최신순. */
function compareAttention(a: AuditTicketGroup, b: AuditTicketGroup): number {
  const rank = (group: AuditTicketGroup) =>
    group.attention?.severity === "critical" ? 0 : 1;
  const bySeverity = rank(a) - rank(b);
  if (bySeverity !== 0) return bySeverity;
  return auditTimeValue(b.latestAt) - auditTimeValue(a.latestAt);
}

/**
 * 통합 행 목록 → 관리자 뷰(문제 우선 + 미션/티켓 묶음). **이 섹션의 진입점.**
 *
 * 순서가 중요하다:
 *   1. 전체 행으로 티켓 그룹을 만든다 → 주의 필요 판정은 **필터 전** 사실로.
 *   2. 행위자 필터를 행에 걸고 그룹을 다시 요약한다(카운트가 화면과 일치).
 *   3. 티켓 필터(상태·미션)를 걸고 미션 섹션으로 접는다.
 */
export function buildAuditAdminView(
  rows: readonly UnifiedAuditRow[],
  options: BuildAuditAdminViewOptions = {},
): AuditAdminView {
  const taskMetaById = options.taskMetaById ?? {};
  const missionMetaById = options.missionMetaById ?? {};
  const filters = options.filters ?? {};
  const attentionOptions: AuditAttentionOptions = {
    ...(options.now ? { now: options.now } : {}),
    ...(options.liveAgentKeys !== undefined
      ? { liveAgentKeys: options.liveAgentKeys }
      : {}),
    ...(options.stalledAfterMs !== undefined
      ? { stalledAfterMs: options.stalledAfterMs }
      : {}),
  };

  const allGroups = groupAuditRowsByTicket(
    rows,
    taskMetaById,
    attentionOptions,
  );
  const attention = allGroups
    .filter((group) => group.attention)
    .sort(compareAttention);

  const visibleRows = rows.filter((row) =>
    matchesActorKind(row, filters.actorKind),
  );

  const filteredGroups = groupAuditRowsByTicket(
    visibleRows,
    taskMetaById,
    attentionOptions,
  ).filter((group) => matchesTicketFilters(group, filters));

  const sections = foldTicketsIntoMissions(filteredGroups, missionMetaById, {
    taskMetaById,
  });

  const actionCount = filteredGroups.reduce(
    (sum, group) => sum + group.actionCount,
    0,
  );

  return {
    sections,
    attention,
    ticketCount: filteredGroups.length,
    actionCount,
    // 두 겹(행위자 축 + 티켓 축)의 필터를 합쳐 **최종적으로 안 보이는 행 수**를
    // 한 숫자로 준다. 두 축을 나눠 보여줘야 할 이유가 없고(사용자는 "몇 개가
    // 가려졌나"만 알면 필터를 되돌린다), 나누면 합이 안 맞는 순간이 생긴다.
    hiddenByFilterCount: rows.length - actionCount,
  };
}

function foldTicketsIntoMissions(
  groups: readonly AuditTicketGroup[],
  missionMetaById: Record<string, AuditMissionMeta>,
  context: { taskMetaById: Record<string, AuditTaskMeta> },
): AuditMissionSection[] {
  const order: (string | null)[] = [];
  const byMission = new Map<string | null, AuditTicketGroup[]>();
  for (const group of groups) {
    const key = group.missionId;
    const prior = byMission.get(key);
    if (prior) prior.push(group);
    else {
      byMission.set(key, [group]);
      order.push(key);
    }
  }

  const sections = order.map<AuditMissionSection>((missionId) => {
    const tickets = byMission.get(missionId)!;
    const mission = missionId ? missionMetaById[missionId] : undefined;
    return {
      key: `mission:${missionId ?? AUDIT_BOARD_SECTION_ID}`,
      missionId,
      goal: mission?.goal?.trim() || null,
      status: mission?.status ?? null,
      progress: mission
        ? auditMissionProgress(mission, context.taskMetaById)
        : null,
      ticketCount: tickets.length,
      actionCount: tickets.reduce((sum, group) => sum + group.actionCount, 0),
      attentionCount: tickets.filter((group) => group.attention).length,
      latestAt: tickets.reduce<Date>(
        (latest, group) =>
          auditTimeValue(group.latestAt) > auditTimeValue(latest)
            ? group.latestAt
            : latest,
        tickets[0]?.latestAt ?? new Date(0),
      ),
      tickets,
    };
  });

  // 미션 섹션이 먼저(최신 활동 순), 보드는 항상 맨 뒤. 보드는 "그 밖의 낱개
  // 작업" 이라 상위 맥락인 미션보다 먼저 오면 화면이 다시 firehose 로 읽힌다.
  return sections.sort((a, b) => {
    if (a.missionId === null && b.missionId !== null) return 1;
    if (a.missionId !== null && b.missionId === null) return -1;
    return auditTimeValue(b.latestAt) - auditTimeValue(a.latestAt);
  });
}

/**
 * 미션 필터 <select> 의 선택지 — **화면에 실제로 등장한** 미션만.
 *
 * 프로젝트의 전체 미션을 박아 두면 고르는 족족 0건인 항목이 섞인다(종류 필터가
 * `toolNames` 를 등장한 것으로만 채우는 것과 같은 이유).
 */
export interface AuditMissionOption {
  missionId: string;
  label: string;
  ticketCount: number;
}

export function auditMissionOptions(
  sections: readonly AuditMissionSection[],
): AuditMissionOption[] {
  return sections
    .filter(
      (section): section is AuditMissionSection & { missionId: string } =>
        section.missionId !== null,
    )
    .map((section) => ({
      missionId: section.missionId,
      label: section.goal ?? `#${section.missionId.slice(0, 8)}`,
      ticketCount: section.ticketCount,
    }));
}

// ── 멤버 워크로드 스트립 ─────────────────────────────────────────

/**
 * 구성원 워크로드 타일 하나.
 *
 * ★위쪽 `MemberWorkloadPanel`(결과: 에이전트·티켓·머지 현황)과 **다른 축**이다.
 * 여기 숫자는 "이 프로젝트에서 이 사람에게 귀속된 감사 기록 수"다. 두 패널이
 * 같은 숫자를 다르게 말하는 것처럼 보이면 안 되므로, 호출부는 이 스트립을 감사
 * 필터로만 쓰고 인사 지표로 쓰지 않는다.
 *
 * ★`actionCount` 의 **범위를 숨기지 않는다**(`countScope`):
 *   - `"project"` — 서버 집계(`mergeAuditActors`). 불러온 창과 무관한 전체 수라,
 *     창 안에 한 건도 없는 구성원도 타일이 남는다. 그게 중요한 이유는 이 타일이
 *     **서버사이드 필터**의 진입점이기 때문이다 — 창에 없다고 타일을 지우면
 *     "최근 100건 안에 3건뿐인 사람"을 고를 방법이 화면에서 사라진다(예전
 *     구성원 드롭다운이 전체 집계를 쓴 이유와 같다).
 *   - `"window"` — 서버 집계에 없는 행위자(=미귀속 등). 불러온 창 안의 수다.
 *
 * `actorUid === null` = **미귀속** 타일(원장 확장 이전 문서 등). uid 가 없어 서버
 * 필터를 걸 수 없으므로 항상 `"window"` 다. 0 건이면 아예 만들지 않는다 — 항상
 * 떠 있으면 정상 상태에서도 결손이 있는 것처럼 보인다.
 */
export interface AuditWorkloadTile {
  actorUid: string | null;
  label: string | null;
  actionCount: number;
  countScope: "project" | "window";
  /** 이 사람이 손댄 티켓 중 주의 필요인 것 — **불러온 창 기준**. */
  attentionCount: number;
}

/**
 * 워크로드 스트립.
 *
 * 정렬은 행위 수 내림차순, 미귀속 타일은 항상 맨 뒤 — 결손은 목록을 이끄는
 * 정보가 아니라 각주다.
 */
export function auditWorkloadTiles(
  groups: readonly AuditTicketGroup[],
  actors: readonly AuditActorTally[] = [],
): AuditWorkloadTile[] {
  const byUid = new Map<string | null, AuditWorkloadTile>();

  // ①서버 집계를 먼저 깐다 — 창에 안 잡힌 구성원도 고를 수 있어야 한다.
  for (const actor of actors) {
    if (!actor.actorUid) continue;
    byUid.set(actor.actorUid, {
      actorUid: actor.actorUid,
      label: actor.actorName,
      actionCount: actor.count,
      countScope: "project",
      attentionCount: 0,
    });
  }

  // ②창 안의 사실로 이름을 메꾸고, 서버 집계에 없던 행위자를 더한다.
  for (const group of groups) {
    for (const row of group.rows) {
      const uid = row.actorUid ?? null;
      const prior = byUid.get(uid);
      if (prior) {
        prior.label = prior.label ?? row.actorLabel;
        if (prior.countScope === "window") prior.actionCount += 1;
        continue;
      }
      byUid.set(uid, {
        actorUid: uid,
        label: row.actorLabel,
        actionCount: 1,
        countScope: "window",
        attentionCount: 0,
      });
    }
    if (!group.attention) continue;
    // 주의 필요 티켓은 **그 티켓에 손댄 모든 사람**에게 표시한다. 마지막 행위자
    // 하나에게만 달면 "누가 이걸 떠안아야 하나"가 우연히 정해진다.
    for (const uid of new Set(group.rows.map((row) => row.actorUid ?? null))) {
      const tile = byUid.get(uid);
      if (tile) tile.attentionCount += 1;
    }
  }

  return [...byUid.values()].sort((a, b) => {
    if (a.actorUid === null && b.actorUid !== null) return 1;
    if (a.actorUid !== null && b.actorUid === null) return -1;
    return b.actionCount - a.actionCount;
  });
}
