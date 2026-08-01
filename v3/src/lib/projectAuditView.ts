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
 * 사람 행위는 유한한 유니온이라 i18n 키로 번역하고, 오케 행위는 `toolName`
 * (`update_task_status`, `spawn_agent` …)이라 **번역하지 않고 코드 값 그대로**
 * 보여준다. 툴 이름은 앱 전체·문서·MCP 스펙에서 원문으로 통용되므로 번역하면
 * 오히려 대조가 불가능해진다(상태코드를 번역하지 않는 것과 같은 이유).
 */
export type AuditRowLabel =
  | { kind: "i18n"; key: MessageKey }
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
  return {
    key: `agent:${event.id}`,
    actorKind: "agent",
    createdAt: event.createdAt,
    actorLabel: actorUid
      ? resolveActorLabel({ actorUid, actorName: null }, nameByUid)
      : null,
    actorUid,
    label: { kind: "raw", text: event.toolName || "?" },
    detail: auditLedgerDetail(event),
    taskId: event.taskId?.trim() || null,
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
