/**
 * 감사 탭 봉투 계약 — `getTeamProjectAudit` 응답을 화면이 읽는 모양으로 접는다.
 *
 * 정본: `docs/team-usage-overview-design-2026-08-21.md` **§12**.
 * 서버 구현: `v3/functions/src/teamAudit.ts` (타입 원본) + `index.ts` 콜러블.
 *
 * ★사용량 봉투와 **같은 규약**이다(§7): `state` + `reasonCode`(i18n 키) +
 *   `reason`(ko 문장 폴백) + `basis`. 그래서 `teamUsageContract` 와 같은 규율을
 *   여기서도 지킨다 — **모르는 것을 0 으로 만들지 않는다.**
 *
 * ★이 응답에는 금액·토큰이 **하나도 없다**(§12.4). 감사 탭은
 *   `TEAM_USAGE_EFFECTIVE_FROM` 게이트 **밖**이라, 여기 금액을 실으면 사용량
 *   게이트가 감사 탭 경유로 통째로 우회된다. 그래서 화면에도 비용 칸을 만들지
 *   않는다 — 서버가 안 주는 것을 화면이 계산해 내면 같은 우회가 된다.
 *
 * ★React·firebase 무의존. `tsx --test` 로 그대로 돈다.
 */

// ── 봉투 원형 (서버 미러) ───────────────────────────────────────────────────

export type TeamAuditState = "disabled" | "empty" | "partial" | "complete";

/** ★안정 enum. 화면은 **이걸 i18n 키로** 쓴다(§12.5). */
export type TeamAuditReasonCode =
  | "no_role"
  | "no_project"
  | "no_events"
  | "partial_sources"
  | "scan_truncated"
  | "self_scope_unattributable";

export type TeamAuditScope = "team" | "self";
export type TeamAuditRole = "owner" | "admin" | "member";

/** 허용목록 분류. ★여기 없는 툴은 응답에 실리지 않는다(fail-closed, §12.2). */
export type TeamAuditEventKind =
  | "task_create"
  | "task_transition"
  | "merge"
  | "agent_spawn"
  | "flow_change";

export const TEAM_AUDIT_EVENT_KINDS: ReadonlyArray<TeamAuditEventKind> = [
  "task_create",
  "task_transition",
  "merge",
  "agent_spawn",
  "flow_change",
];

export type TeamAuditMergeFacts = {
  branch: string | null;
  prNumber: number | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
};

export type TeamAuditEvent = {
  id: string;
  kind: TeamAuditEventKind;
  action: string;
  at: string | null;
  atMs: number | null;
  taskId: string | null;
  taskTitle: string | null;
  /**
   * ★`tm_` 팀 전용 가명. 원시 uid 가 아니다.
   * ★`null` 이 **정상적으로** 존재한다 — `merge_history` 문서에 행위자 필드가
   *   아예 없다(§12.7). 화면은 빈칸이 아니라 '알 수 없음' 으로 그린다.
   */
  memberKey: string | null;
  /** 프로젝트 산출물인 에이전트 식별자(사람이 아니다). 가려질 수 있다. */
  agentId: AgentLabel;
  success: boolean | null;
  merge: TeamAuditMergeFacts | null;
};

export type TeamAuditAttention = {
  kinds: string[];
  severity: "critical" | "warning";
  idleMs: number | null;
};

export type TeamAuditTicket = {
  id: string;
  title: string | null;
  status: string | null;
  role: string | null;
  priority: number | null;
  missionId: string | null;
  prUrl: string | null;
  claimedBy: AgentLabel;
  archived: boolean;
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  activityCount: number;
  failedActions: number;
  attention: TeamAuditAttention | null;
};

export type TeamAuditWorkloadRow = {
  agentId: AgentLabel;
  name: AgentLabel;
  model: string | null;
  role: string | null;
  status: string | null;
  currentTaskId: string | null;
  openTasks: number;
  doneTasks: number;
};

export type TeamAuditSummary = {
  /** ★페이지가 아니라 **수집 창** 기준. */
  eventsInWindow: number | null;
  eventsByKind: Partial<Record<TeamAuditEventKind, number>>;
  tasksTotal: number | null;
  tasksOpen: number | null;
  tasksDone: number | null;
  attentionCount: number | null;
  criticalCount: number | null;
  agentsTotal: number | null;
  missionsTotal: number | null;
  missionsActive: number | null;
};

/**
 * ★`summary` 와 목록의 관계 — 서버 `TEAM_AUDIT_SUMMARY_INVARIANTS` 의 미러.
 *
 * **항상 같다(대조해도 된다):**
 *   `attentionCount` === `attention.length`
 *   `criticalCount`  === `attention` 중 severity==="critical" 개수
 *   `agentsTotal`    === `workload.length`
 *   `eventsInWindow` === `eventsByKind` 값들의 합
 *
 * ★**일부러 다르다(대조하면 오경보):**
 *   `eventsInWindow` vs `events.length`  — 창 기준 vs **한 페이지**
 *   `tasksTotal`     vs `tickets.length` — `tasksTotal` 은 삭제된 티켓을 뺀다
 *
 * 두 번째 표를 적어 두는 것이 첫 번째만큼 중요하다. 안 적으면 다음 사람이
 * "숫자가 안 맞네" 하고 **틀린 짝을 대조해 오경보를 만든다.**
 */

export type TeamAuditGate = {
  state: TeamAuditState;
  reasonCode: TeamAuditReasonCode | null;
  reason: string | null;
  scope: TeamAuditScope;
  /** 역할이 없으면 null — 그 이상은 말하지 않는다. */
  role: TeamAuditRole | null;
  projectsInScope: number;
  /** ★라벨 없는 목록 금지 — 항상 실린다. */
  basis: string;
};

export type TeamAuditPage = {
  limit: number | null;
  returned: number | null;
  /** ★가공하지 않는다. 그대로 다음 호출의 `cursor` 로 넘긴다(§12.6). */
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * 코드 + 문장 쌍. ★서버가 ko 문장만 주면 en·ja 화면이 한국어를 그리게 되므로,
 * 계약이 **항상 코드를 같이 싣는다**(§12.5.1). 화면은 코드로 번역하고, 아직
 * 번역이 없는 코드만 서버 문장으로 떨어진다.
 */
export type CodedLine = {
  code: string | null;
  text: string;
};

/**
 * ★판정 기준값. 서버가 **판정에 쓰는 상수 그 자체**를 실어 보낸다
 * (`projectAudit.STALLED_AFTER_MS`). 그래서 화면이 말하는 숫자와 배지를 붙이는
 * 기준이 갈라질 자리가 없다.
 *
 * ★이 값이 있기 때문에 문구에 숫자를 박지 않아도 된다. 문구에 박으면 상한이
 * 바뀔 때마다 세 로케일 번역이 조용히 낡는다 — 값으로 받으면 번역은 안 낡고
 * 숫자는 항상 맞는다.
 */
export type TeamAuditCriteria = {
  stalledAfterHours: number | null;
};

export type TeamAuditProjectRef = {
  id: string;
  name: string | null;
  role: TeamAuditRole;
};

export type TeamAuditEnvelope = {
  generatedAt: string | null;
  projectId: string | null;
  projects: TeamAuditProjectRef[];
  /** ★없으면 상태가 아니라 **계약 미배선**이다. */
  teamAudit: TeamAuditGate | null;
  page: TeamAuditPage;
  /** 없을 수 있다(옛 배포). 없으면 화면이 숫자 없는 문장으로 떨어진다. */
  criteria: TeamAuditCriteria | null;
  summary: TeamAuditSummary | null;
  events: TeamAuditEvent[];
  attention: TeamAuditTicket[];
  workload: TeamAuditWorkloadRow[];
  /**
   * ★이 응답이 **일부러** 빼고 있는 것. 화면이 그대로 그린다(§12.3).
   * `code` 를 i18n 키로 쓰고, 키가 없으면 `text`(ko)를 폴백으로 그린다 —
   * 봉투 `reasonCode`/`reason` 과 **같은 규약**이라 헬퍼 하나로 처리된다(§12.5.1).
   */
  withheld: CodedLine[];
  notes: CodedLine[];
};

// ── 방어적 정규화 ───────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numOr0(v: unknown): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function strList(v: unknown): string[] {
  return arr(v).filter((s): s is string => typeof s === "string" && s !== "");
}

/**
 * `{ code, text }` 배열로 접는다.
 *
 * ★맨 문자열도 받아 준다. 계약은 `{code,text}` 로 확정됐지만 배포가 뒤처진
 * 환경에서 옛 모양이 올 수 있고, 그때 목록이 통째로 사라지면 화면이 "숨긴 것이
 * 없다" 고 말하는 셈이 된다 — 그건 이 목록이 존재하는 이유와 정반대다.
 * 코드가 없는 줄은 `code: null` 이라 번역 없이 서버 문장 그대로 그려진다.
 */
function codedList(v: unknown): CodedLine[] {
  return arr(v).flatMap((row) => {
    if (typeof row === "string" && row !== "") return [{ code: null, text: row }];
    const r = asRecord(row);
    const text = str(r?.text);
    const code = str(r?.code);
    if (!r) return [];
    // 코드만 있고 문장이 없어도 버리지 않는다 — 사전에 있으면 그려진다.
    if (!text && !code) return [];
    return [{ code, text: text ?? "" }];
  });
}

const STATES: ReadonlyArray<TeamAuditState> = [
  "disabled",
  "empty",
  "partial",
  "complete",
];

const REASON_CODES: ReadonlyArray<TeamAuditReasonCode> = [
  "no_role",
  "no_project",
  "no_events",
  "partial_sources",
  "scan_truncated",
  "self_scope_unattributable",
];

const ROLES: ReadonlyArray<TeamAuditRole> = ["owner", "admin", "member"];

function auditState(v: unknown): TeamAuditState | null {
  return STATES.includes(v as TeamAuditState) ? (v as TeamAuditState) : null;
}

function reasonCode(v: unknown): TeamAuditReasonCode | null {
  return REASON_CODES.includes(v as TeamAuditReasonCode)
    ? (v as TeamAuditReasonCode)
    : null;
}

function role(v: unknown): TeamAuditRole | null {
  return ROLES.includes(v as TeamAuditRole) ? (v as TeamAuditRole) : null;
}

function eventKind(v: unknown): TeamAuditEventKind | null {
  return TEAM_AUDIT_EVENT_KINDS.includes(v as TeamAuditEventKind)
    ? (v as TeamAuditEventKind)
    : null;
}

/** 팀 전용 가명 공간(설계 §4.6). `us_`(사람 축 조인 키)·원시 uid 는 통과 못 한다. */
export function isTeamMemberKey(v: unknown): v is string {
  return typeof v === "string" && /^tm_[A-Za-z0-9_-]{4,}$/.test(v);
}

/**
 * 에이전트/담당자 라벨의 세 가지 상태.
 *
 * ★`redacted` 와 `absent` 를 **같은 칸으로 그리지 않는다.**
 *   "담당자 없음" 과 "담당자를 가렸음" 은 다른 사실이고, 감사 화면에서 그 둘을
 *   합치면 가려진 자리가 조용히 사라진다.
 */
export type AgentLabel =
  | { kind: "value"; value: string }
  | { kind: "redacted" }
  | { kind: "absent" };

/** 서버가 값 수준에서 신원을 가릴 때 넣는 자리표시(`teamAudit.REDACTED_IDENTITY`). */
export const SERVER_REDACTED_MARKER = "(가려짐)";

/**
 * ★이름처럼 보이는 값이 감사 피드에 새지 않게 하는 마지막 문턱.
 *
 * 에이전트 이름은 사람이 자유롭게 짓는다(`spawn_agent` 의 `name` 이 자유 문자열).
 * 그래서 에이전트를 자기 이메일로 이름 지으면 **키 이름만 보는 검사기는 통과한다** —
 * 서버가 그 구멍을 값 수준 스크럽으로 막았고, 여기는 그 이중 방어다. 응답은 화면
 * 말고도 갈 데가 있으니 두 겹이 맞다.
 *
 * ★걸렀을 때 `absent` 로 접지 않는다. 접으면 "가렸다" 가 "없다" 로 둔갑한다.
 * uid 판정은 좁게 잡는다 — `backend-1`·`orchestrator-claude-p1` 같은 정상 이름을
 * 가려 버리면 감사 피드가 통째로 '가려짐' 이 된다.
 */
export function agentLabelOf(v: unknown): AgentLabel {
  const raw = str(v);
  if (!raw) return { kind: "absent" };
  if (raw === SERVER_REDACTED_MARKER) return { kind: "redacted" };
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(raw)) return { kind: "redacted" };
  // 정확히 28자 영숫자 + 대·소문자·숫자 혼재 = Firebase uid 모양(서버와 같은 판정).
  if (
    /^[A-Za-z0-9]{28}$/.test(raw) &&
    /[a-z]/.test(raw) &&
    /[A-Z]/.test(raw) &&
    /[0-9]/.test(raw)
  ) {
    return { kind: "redacted" };
  }
  return { kind: "value", value: raw };
}

function normalizeGate(v: unknown): TeamAuditGate | null {
  const r = asRecord(v);
  if (!r) return null;
  const state = auditState(r.state);
  if (!state) return null;
  return {
    state,
    reasonCode: reasonCode(r.reasonCode),
    reason: str(r.reason),
    scope: r.scope === "self" ? "self" : "team",
    role: role(r.role),
    projectsInScope: numOr0(r.projectsInScope),
    basis: str(r.basis) ?? "",
  };
}

function normalizeMerge(v: unknown): TeamAuditMergeFacts | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    branch: str(r.branch),
    prNumber: num(r.prNumber),
    // ★결측을 0 으로 접지 않는다. 0줄 변경과 "모른다" 는 다른 사실이다.
    filesChanged: num(r.filesChanged),
    linesAdded: num(r.linesAdded),
    linesDeleted: num(r.linesDeleted),
  };
}

function normalizeEvents(v: unknown): TeamAuditEvent[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    if (!r) return [];
    const id = str(r.id);
    const kind = eventKind(r.kind);
    // 분류되지 않은 사건은 그리지 않는다 — 허용목록이 fail-closed 인 것과 같은 방향.
    if (!id || !kind) return [];
    return [
      {
        id,
        kind,
        action: str(r.action) ?? kind,
        at: str(r.at),
        atMs: num(r.atMs),
        taskId: str(r.taskId),
        taskTitle: str(r.taskTitle),
        // ★가명 공간 밖 값은 통과시키지 않는다. null 은 정상이다(§12.7).
        memberKey: isTeamMemberKey(r.memberKey) ? r.memberKey : null,
        agentId: agentLabelOf(r.agentId),
        success: typeof r.success === "boolean" ? r.success : null,
        merge: normalizeMerge(r.merge),
      },
    ];
  });
}

function normalizeAttentionMark(v: unknown): TeamAuditAttention | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    kinds: strList(r.kinds),
    severity: r.severity === "critical" ? "critical" : "warning",
    idleMs: num(r.idleMs),
  };
}

function normalizeTickets(v: unknown): TeamAuditTicket[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    const id = str(r?.id);
    if (!r || !id) return [];
    return [
      {
        id,
        title: str(r.title),
        status: str(r.status),
        role: str(r.role),
        priority: num(r.priority),
        missionId: str(r.missionId),
        prUrl: str(r.prUrl),
        claimedBy: agentLabelOf(r.claimedBy),
        archived: r.archived === true,
        deleted: r.deleted === true,
        createdAt: str(r.createdAt),
        updatedAt: str(r.updatedAt),
        activityCount: numOr0(r.activityCount),
        failedActions: numOr0(r.failedActions),
        attention: normalizeAttentionMark(r.attention),
      },
    ];
  });
}

function normalizeWorkload(v: unknown): TeamAuditWorkloadRow[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    // ★식별자가 가려졌다고 행을 버리지 않는다. 감사에서 조용한 누락이 가장 나쁜
    //   실패이고, 가려진 것은 없는 것이 아니다.
    if (!r) return [];
    return [
      {
        agentId: agentLabelOf(r.agentId),
        name: agentLabelOf(r.name),
        model: str(r.model),
        role: str(r.role),
        status: str(r.status),
        currentTaskId: str(r.currentTaskId),
        openTasks: numOr0(r.openTasks),
        doneTasks: numOr0(r.doneTasks),
      },
    ];
  });
}

function normalizeSummary(v: unknown): TeamAuditSummary | null {
  const r = asRecord(v);
  if (!r) return null;
  const byKindRaw = asRecord(r.eventsByKind) ?? {};
  const eventsByKind: Partial<Record<TeamAuditEventKind, number>> = {};
  for (const kind of TEAM_AUDIT_EVENT_KINDS) {
    const n = num(byKindRaw[kind]);
    if (n !== null) eventsByKind[kind] = n;
  }
  return {
    // ★전부 `num` 이다. 결측은 0 이 아니라 '모름' 으로 그린다(§12 화면규칙 3).
    eventsInWindow: num(r.eventsInWindow),
    eventsByKind,
    tasksTotal: num(r.tasksTotal),
    tasksOpen: num(r.tasksOpen),
    tasksDone: num(r.tasksDone),
    attentionCount: num(r.attentionCount),
    criticalCount: num(r.criticalCount),
    agentsTotal: num(r.agentsTotal),
    missionsTotal: num(r.missionsTotal),
    missionsActive: num(r.missionsActive),
  };
}

function normalizeProjects(v: unknown): TeamAuditProjectRef[] {
  return arr(v).flatMap((row) => {
    const r = asRecord(row);
    const id = str(r?.id);
    const rl = role(r?.role);
    if (!r || !id || !rl) return [];
    return [{ id, name: str(r.name), role: rl }];
  });
}

function normalizeCriteria(v: unknown): TeamAuditCriteria | null {
  const r = asRecord(v);
  if (!r) return null;
  const hours = num(r.stalledAfterHours);
  // ★0 이하는 기준이 될 수 없다 — 값으로 인정하면 화면이 "0시간 동안" 이라고 쓴다.
  return { stalledAfterHours: hours !== null && hours > 0 ? hours : null };
}

function normalizePage(v: unknown): TeamAuditPage {
  const r = asRecord(v);
  return {
    limit: num(r?.limit),
    returned: num(r?.returned),
    nextCursor: str(r?.nextCursor),
    hasMore: r?.hasMore === true,
  };
}

/** 콜러블 응답 → 화면이 읽는 봉투. 어떤 입력이 와도 던지지 않는다. */
export function normalizeTeamAudit(raw: unknown): TeamAuditEnvelope {
  const r = asRecord(raw) ?? {};
  return {
    generatedAt: str(r.generatedAt),
    projectId: str(r.projectId),
    projects: normalizeProjects(r.projects),
    teamAudit: normalizeGate(r.teamAudit),
    page: normalizePage(r.page),
    criteria: normalizeCriteria(r.criteria),
    summary: normalizeSummary(r.summary),
    events: normalizeEvents(r.events),
    attention: normalizeTickets(r.attention),
    workload: normalizeWorkload(r.workload),
    withheld: codedList(r.withheld),
    notes: codedList(r.notes),
  };
}

// ── 화면 판정 ───────────────────────────────────────────────────────────────

/**
 * 목록을 그려도 되나.
 *
 * ★`disabled` 면 목록을 **아예 안 그린다**(§12 화면규칙 1). 봉투가 없어도 같다 —
 *   계약이 없는 것을 "사건 0건" 으로 그리면 그게 곧 거짓말이다.
 */
export function isAuditRenderable(env: TeamAuditEnvelope): boolean {
  return env.teamAudit !== null && env.teamAudit.state !== "disabled";
}

/** 사건이 실제로 하나도 없나. `empty` 는 고장이 아니라 정상 상태다. */
export function isAuditEmpty(env: TeamAuditEnvelope): boolean {
  if (!env.teamAudit) return true;
  if (env.teamAudit.state === "empty") return true;
  return env.events.length === 0;
}

/** 목록이 전부가 아닌가. `partial` 이면 화면이 그 사실을 배너로 말한다. */
export function isAuditPartial(env: TeamAuditEnvelope): boolean {
  return env.teamAudit?.state === "partial";
}

/**
 * ★다음 페이지를 요청해도 되나.
 *
 * `hasMore` 와 `nextCursor` 가 **둘 다** 있어야 한다. 커서 없이 `hasMore` 만 믿고
 * 같은 인자로 다시 부르면 화면이 1페이지를 무한히 돈다 — 서버가 깨진 커서를
 * 조용히 접지 않는 것(§12.6)과 같은 이유로 화면도 접지 않는다.
 */
export function nextCursorOf(env: TeamAuditEnvelope): string | null {
  return env.page.hasMore && env.page.nextCursor ? env.page.nextCursor : null;
}

/**
 * 사건 목록을 페이지끼리 이어 붙인다. ★`id` 로 중복을 막는다 — 감사에서 같은 행이
 * 두 번 보이는 것은 누락만큼 나쁘다. 서버 정렬(atMs desc, id asc)을 뒤집지 않는다.
 */
export function appendEvents(
  prev: TeamAuditEvent[],
  next: TeamAuditEvent[]
): TeamAuditEvent[] {
  const seen = new Set(prev.map((e) => e.id));
  return [...prev, ...next.filter((e) => !seen.has(e.id))];
}

/**
 * 가명 키를 화면 칩 라벨로. ★전체 키를 그대로 뿌리지 않는다 — 사람이 못 읽고,
 * 축을 넘나드는 조인 키를 DOM 에 통째로 남길 이유도 없다.
 * `null` 은 호출부가 '알 수 없음' 으로 그린다(§12.7 — 정상 상태다).
 */
export function memberChipLabel(memberKey: string | null): string | null {
  if (!isTeamMemberKey(memberKey)) return null;
  return memberKey.slice(3, 9);
}

/**
 * 코드 → 문장. 사용량 탭의 `resolveReason` 과 **같은 계약**이다.
 *
 * ★사유(`reasonCode`) · 숨긴 항목(`withheld[].code`) · 참고(`notes[].code`)가
 *   전부 이 함수 하나를 지난다. 서버가 코드 이름 공간을 겹치지 않게 잡아 줬기
 *   때문에 사전도 하나로 충분하다 — 사전이 둘이 되면 어느 쪽이 정본인지 화면이
 *   스스로 못 말한다.
 */
export function resolveCoded(
  code: string | null,
  prose: string | null,
  dictionary: Readonly<Record<string, string>>,
  fallback: string
): string {
  if (code && Object.prototype.hasOwnProperty.call(dictionary, code)) {
    const hit = dictionary[code];
    if (typeof hit === "string" && hit !== "") return hit;
  }
  if (prose) return prose;
  return fallback;
}

/** 봉투 사유 전용 별칭 — 호출부에서 무엇을 푸는지 이름으로 보이게 한다. */
export function resolveAuditReason(
  code: TeamAuditReasonCode | null,
  prose: string | null,
  dictionary: Readonly<Record<string, string>>,
  fallback: string
): string {
  return resolveCoded(code, prose, dictionary, fallback);
}

/** `{code,text}` 한 줄을 로케일 문장으로. 코드가 없으면 서버 문장 그대로. */
export function resolveCodedLine(
  line: CodedLine,
  dictionary: Readonly<Record<string, string>>
): string {
  return resolveCoded(line.code, line.text, dictionary, line.text);
}

/**
 * ★타일 숫자를 **목록에서 유도**한다.
 *
 * 서버가 이 둘을 목록 기준으로 다시 세 주기로 했지만(불변식 표), 화면이 서버
 * 값을 그대로 쓰면 그 약속이 깨지는 날 **"주의 3건" 이라 써 놓고 2건만 보이는
 * 화면**이 된다. 목록에서 세면 그 자리가 아예 없어진다 — 규칙을 지키기 어렵게
 * 두지 말고 어길 자리를 없앤다.
 *
 * ★창 기준 값(`eventsInWindow`·`tasksOpen` …)은 유도하지 않는다. 그것들은 목록과
 *   **일부러 다르다**(위 두 번째 표).
 */
export function derivedCounts(env: TeamAuditEnvelope): {
  attention: number;
  critical: number;
  agents: number;
} {
  return {
    attention: env.attention.length,
    critical: env.attention.filter((t) => t.attention?.severity === "critical")
      .length,
    agents: env.workload.length,
  };
}

/** 결측을 0 으로 그리지 않는다 — '모름' 은 호출부가 문구로 넣는다. */
export function formatCount(
  value: number | null,
  locale: string,
  unknown: string
): string {
  if (value === null || !Number.isFinite(value)) return unknown;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    value
  );
}

/** 사건 시각. 못 읽은 행은 버리지 않고 '모름' 으로 남긴다(서버도 안 버린다). */
export function formatEventTime(
  iso: string | null,
  locale: string,
  unknown: string
): string {
  if (!iso) return unknown;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return unknown;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
