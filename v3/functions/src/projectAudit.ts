// 어드민 프로젝트 감사 — 순수 로직(Firestore 무의존). node --test 로 단위검증한다
// (adminAnalytics.ts / marketingContacts.ts 와 동일 규약). index.ts 의
// getAdminProjectAudit 콜러블은 Firestore Admin SDK read 만 담당하고, 판정·집계·
// 마스킹은 전부 여기로 내려 테스트 가능하게 한다.
//
// ─────────────────────────────────────────────────────────────────────────────
// ★왜 콜러블인가 (룰 확장이 아니라)
// ─────────────────────────────────────────────────────────────────────────────
// 웹 클라가 tasks/agents/audit_logs 를 직접 읽으려면 firestore.rules 에 admin
// 분기를 열어야 하는데, Firestore 룰은 쿼리 결과의 **모든** 문서가 통과해야
// 쿼리를 허용한다 — 클라 쿼리 제약이 룰 분기와 조금이라도 어긋나면 쿼리 전체가
// permission-denied 로 죽는다(#406/#428 에서 겪은 실패 모드). 그래서 룰 표면은
// 0 만큼 늘리고, 서버가 Admin SDK 로 읽어 조립한 뷰만 내려보낸다.
//
// ─────────────────────────────────────────────────────────────────────────────
// ★민감정보 규율 (이 파일이 강제한다)
// ─────────────────────────────────────────────────────────────────────────────
//   - `audit_logs.params` 는 **절대** 응답에 넣지 않는다. 툴 인자에는 지시문·
//     경로·티켓 본문이 그대로 들어오고 자격증명이 섞일 수 있으며, 원장은 불변이라
//     한번 들어간 것은 못 지운다(v3/src/types/audit.ts 주석과 같은 취지).
//     노출은 scrub 이 끝난 `instructionRedacted` 로 한정한다.
//   - 자유 텍스트(activity message, 원장 result)는 길이를 자른다.
//   - 프로젝트의 `folderPath`/`folderPaths`(기기별 로컬 경로)는 응답에서 뺀다 —
//     남의 기기 경로가 새어나가지 않게 하는 지점이다.
// 이 규율은 index.ts 의 select 가 아니라 **여기 매퍼**가 강제한다. 매퍼를 거치지
// 않고 원문이 응답에 실릴 길을 만들지 않는다.
//
// ── ★실행 원장(아래 "실행 원장" 절)이 새로 투영하는 필드 — 왜 안전한가 ──────
// 다음 사람이 같은 판단을 다시 하지 않도록, 필드마다 근거를 적어 둔다.
// ★공통 규칙: 이 섹션은 **자유 텍스트를 한 필드도 새로 늘리지 않는다.** 실행
//   원장 행이 싣는 문자열은 이미 응답에 있던 티켓 제목·미션 목표뿐이고, 둘 다
//   `truncateText` 를 지난다. 나머지는 전부 숫자·enum·불리언·시각이다.
//
//   `tasks.costTotal` / `costInputTokens` / `costOutputTokens` / `retriesCount`
//       숫자다. 사람이 쓴 문자열이 섞일 수 없다. 출처는 렌더러
//       `services/taskRollups.ts` 의 increment(코스트 스트림) — 사용자 입력이
//       닿는 경로가 아니다.
//   `tasks.completedAt`
//       시각. `toIso` 로 정규화하고 못 읽으면 null 이다.
//   `agents.detectedModelId` / `agents.spawnedModel` / `agents.model`
//       모델 id 와 하네스 이름. 둘 다 **기계가 스탬프한 식별자**다 —
//       `detectedModelId` 는 과금 세션 메타데이터 관측값, `spawnedModel` 은
//       스폰 argv 되읽기다. 지시문·프롬프트가 들어오는 칸이 아니다.
//   `audit_logs.model`
//       위와 같은 하네스 식별자. ★`params` 는 여기서도 읽지 않는다 —
//       `buildExecutionLedger` 가 원장에서 읽는 필드는 `taskId`·`model` 둘뿐이다.
//   `merge_history.taskId`
//       머지 여부(불리언)로만 접는다. 브랜치·저장소 문자열은 안 싣는다.
//
// ★그리고 이 섹션은 서버가 허용하는 것보다 **더 좁게** 간다: 타임라인이 싣는
//   `instructionRedacted`(scrub 이 끝난 표시용 지시문)조차 실행 원장 행에는
//   싣지 않는다. 이유는 `yJLfoRpqvCcvarIXcT23`(원장 params 원문 노출 수리)이
//   착지하기 전에 이 축의 노출면을 **0 만큼도** 늘리지 않기 위해서다.
//   ★이 규율은 주석이 아니라 테스트로 서 있다 — projectAudit.test.ts 의
//   "원장 params 원문은 실행 원장 어디에도 실리지 않는다".

// ── 공통 스칼라 헬퍼 ─────────────────────────────────────────────────────────

/** 안전한 숫자 변환. adminAnalytics.coerceNumber 와 같은 규약(모듈 독립 유지). */
export function coerceNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 문자열 안전 변환 — 값이 없으면 null(빈 문자열로 위장하지 않는다). */
export function coerceString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** 자유 텍스트 절단. 잘렸으면 말줄임표를 붙여 "원문 그대로"로 오해되지 않게 한다. */
export function truncateText(v: unknown, max: number): string | null {
  const s = coerceString(v);
  if (s === null) return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** 활동/원장 자유 텍스트의 표시 상한. */
export const TEXT_MAX = 500;

/**
 * Firestore Timestamp / Date / ISO 문자열 / epoch 를 ISO 문자열로.
 * 못 읽으면 null — 0(1970)으로 접지 않는다. 그렇게 접으면 "정체 판정"이
 * 손상된 행마다 최우선 경보를 내며 배너 전체가 거짓말이 된다.
 */
export function toIso(v: unknown): string | null {
  const ms = toMillis(v);
  return ms === null ? null : new Date(ms).toISOString();
}

/** 시각 → epoch ms. 못 읽으면 null(모름). */
export function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  // Firestore Timestamp — Admin SDK 의 toDate() 또는 _seconds 로 온다.
  if (typeof v === "object") {
    const obj = v as {
      toDate?: () => Date;
      _seconds?: unknown;
      seconds?: unknown;
    };
    if (typeof obj.toDate === "function") {
      try {
        const ms = obj.toDate().getTime();
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    }
    const secs = obj._seconds ?? obj.seconds;
    if (typeof secs === "number" && Number.isFinite(secs)) return secs * 1000;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// ── 티켓 상태 ────────────────────────────────────────────────────────────────

/**
 * 서버(mcp-server/tools.ts)가 검증하는 7-원소 상태 집합과 같은 값.
 * 여기 없는 값은 null("모름")로 떨어뜨린다 — 없는 상태를 화면이 발명하지 않게.
 */
export const TASK_STATUSES = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

const TASK_STATUS_SET: ReadonlySet<string> = new Set(TASK_STATUSES);

export function parseTaskStatus(v: unknown): TaskStatus | null {
  return typeof v === "string" && TASK_STATUS_SET.has(v)
    ? (v as TaskStatus)
    : null;
}

/** 아직 끝나지 않은 = 누군가 지고 있어야 하는 상태(앱 규약과 동일). */
const IN_FLIGHT_TASK_STATUSES: ReadonlySet<string> = new Set([
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
]);

// ── 미션 귀속 (contextId 파생) ───────────────────────────────────────────────
//
// ★Task 에는 missionId 필드가 **없다**. dispatcher 가 `contextId: missionId` 로
// 태깅하는 것이 유일한 결속이다(v3/src/lib/laneContext.ts). 규약을 그대로 옮긴다:
//   "board"(또는 미설정) = 일반 보드 / "lane:*" = Quick Lane / 그 외 = missionId.

const RESERVED_BOARD = "board";
export const LANE_CONTEXT_PREFIX = "lane:";

/** contextId → missionId. 보드/레인/미설정이면 null. */
export function missionIdFromContext(contextId: unknown): string | null {
  const c = coerceString(contextId);
  if (!c) return null;
  if (c === RESERVED_BOARD) return null;
  if (c.startsWith(LANE_CONTEXT_PREFIX)) return null;
  return c;
}

// ── 고아 클레임 판정용 키 ────────────────────────────────────────────────────

/**
 * 에이전트 목록 → 클레임 키 집합.
 *
 * ★`task.claimedBy` 는 **id 일 수도 이름일 수도 있다** — 보드가 실제로
 * `a.id === claimedBy || a.name === claimedBy || a.name.toLowerCase() === …`
 * 로 푼다(v3/src/lib/projectAuditView.ts:1282 주석). 여기서 id 만 모으면 이름으로
 * 물린 티켓이 전부 "고아 클레임"으로 떠서 배너가 통째로 거짓말이 된다.
 */
export function agentClaimKeys(
  agents: ReadonlyArray<{ id?: unknown; name?: unknown }>
): Set<string> {
  const keys = new Set<string>();
  for (const a of agents) {
    const id = coerceString(a.id);
    if (id) keys.add(id);
    const name = coerceString(a.name);
    if (name) {
      keys.add(name);
      keys.add(name.toLowerCase());
    }
  }
  return keys;
}

// ── 주의 필요(문제 우선) ─────────────────────────────────────────────────────

/**
 * 이 티켓이 사람 손을 필요로 하는 이유. 각 종류는 **관측된 값 하나**에 1:1로
 * 대응하고 추측은 없다(앱 ProjectAuditAttention 과 같은 5종).
 */
export type AttentionKind =
  | "taskFailed"
  | "taskBlocked"
  | "failedActions"
  | "orphanedClaim"
  | "stalled";

export type AttentionSeverity = "critical" | "warning";

export interface Attention {
  kinds: AttentionKind[];
  severity: AttentionSeverity;
  /** `stalled` 의 근거 — 마지막 기록 이후 경과(ms). 해당 없으면 null. */
  idleMs: number | null;
}

/**
 * 정체 판정 임계값 6시간 — 앱의 AUDIT_STALLED_AFTER_MS 와 같은 값.
 * 짧게 잡으면 정상적으로 긴 턴을 도는 에이전트가 전부 "정체"로 뜨고, 배너가
 * 한 번 늑대소년이 되면 진짜 정체를 아무도 안 본다.
 */
export const STALLED_AFTER_MS = 6 * 60 * 60 * 1000;

/** 즉시 손이 필요한 종류. 나머지는 경고. */
const CRITICAL_ATTENTION_KINDS: ReadonlySet<AttentionKind> = new Set([
  "taskFailed",
  "failedActions",
  "orphanedClaim",
]);

export interface AttentionInput {
  status: TaskStatus | null;
  claimedBy: string | null;
  archived: boolean;
  deleted: boolean;
  /** 이 티켓에 달린 실패한 툴 호출 수. */
  failedCount: number;
  /** 이 티켓의 가장 최근 기록 시각(epoch ms). 모르면 null. */
  latestMs: number | null;
}

export interface AttentionOptions {
  nowMs?: number;
  /**
   * 살아 있는 에이전트의 클레임 키 집합 — `agentClaimKeys` 로 만든다.
   *
   * ★`null`/미지정이면 고아 클레임 **판정을 아예 하지 않는다.** 에이전트 목록을
   * 못 읽은 상태에서 빈 집합을 넘기면 진행 중인 티켓이 전부 "고아"로 떠서 배너가
   * 거짓 경보를 낸다 — "모른다"를 "없다"로 접지 않는다.
   */
  liveAgentKeys?: ReadonlySet<string> | null;
  stalledAfterMs?: number;
}

/**
 * 티켓 하나의 주의 필요 판정. 없으면 null.
 *
 * ★끝난 티켓은 문제가 아니다. DONE·보관·삭제된 티켓은 과거에 실패한 호출이
 * 있었더라도 올리지 않는다 — 이미 끝난 일을 계속 "N건 주의 필요"로 세면 그
 * 숫자가 영원히 안 줄고 배너 전체가 무시된다.
 */
export function evaluateAttention(
  input: AttentionInput,
  options: AttentionOptions = {}
): Attention | null {
  if (input.deleted || input.archived || input.status === "DONE") return null;

  const kinds: AttentionKind[] = [];
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

  const stalledAfterMs = options.stalledAfterMs ?? STALLED_AFTER_MS;
  const nowMs = options.nowMs ?? Date.now();
  // latestMs === null 은 시각을 못 읽었다는 뜻이다. 그걸 "1970년부터 정체"로
  // 읽으면 손상된 행이 모두 최우선 경보가 된다 — 판정에서 뺀다.
  const idleMs = input.latestMs != null ? nowMs - input.latestMs : null;
  if (inFlight && idleMs !== null && idleMs >= stalledAfterMs) {
    kinds.push("stalled");
  }

  if (kinds.length === 0) return null;
  return {
    kinds,
    severity: kinds.some((k) => CRITICAL_ATTENTION_KINDS.has(k))
      ? "critical"
      : "warning",
    idleMs: kinds.includes("stalled") ? idleMs : null,
  };
}

// ── 응답 타입 ────────────────────────────────────────────────────────────────

export interface AuditProjectRef {
  id: string;
  name: string | null;
  ownerId: string | null;
  memberCount: number;
  updatedAt: string | null;
}

export interface AuditTicket {
  id: string;
  title: string | null;
  status: TaskStatus | null;
  role: string | null;
  priority: number | null;
  missionId: string | null;
  prUrl: string | null;
  claimedBy: string | null;
  archived: boolean;
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  /** 이 티켓에 달린 activities 수(수집 창 안에서). */
  activityCount: number;
  /** 이 티켓에 달린 원장 실패 호출 수(수집 창 안에서). */
  failedActions: number;
  attention: Attention | null;
}

export interface AuditWorkloadRow {
  agentId: string;
  name: string | null;
  model: string | null;
  role: string | null;
  status: string | null;
  currentTaskId: string | null;
  /** 이 에이전트가 물고 있는 미완료 티켓 수. */
  openTasks: number;
  /** 이 에이전트 이름/id 로 완료된 티켓 수. */
  doneTasks: number;
  totalCost: number;
}

export interface AuditMissionRow {
  id: string;
  goal: string | null;
  status: string | null;
  taskCount: number;
  doneCount: number;
  statusCounts: Record<string, number>;
  updatedAt: string | null;
}

export type TimelineKind = "activity" | "ledger" | "merge";

export interface AuditTimelineRow {
  id: string;
  kind: TimelineKind;
  at: string | null;
  taskId: string | null;
  taskTitle: string | null;
  /** 표시용 행위자(에이전트 id/이름). 모르면 null. */
  actor: string | null;
  /** 무슨 일인지 한 줄 라벨(툴 이름 / "활동" / "머지"). */
  label: string;
  /** 자유 텍스트(절단됨). 원장 params 는 절대 여기 오지 않는다. */
  text: string | null;
  /** 원장 행만 의미 있음. 그 외는 null. */
  success: boolean | null;
}

export interface AuditMergeRow {
  id: string;
  taskId: string | null;
  repoRoot: string | null;
  branch: string | null;
  prNumber: number | null;
  mergedAt: string | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
}

export interface AuditSummary {
  tasksTotal: number;
  tasksOpen: number;
  tasksDone: number;
  tasksByStatus: Record<string, number>;
  agentsTotal: number;
  agentsWorking: number;
  missionsTotal: number;
  missionsActive: number;
  mergesTotal: number;
  prCount: number;
  attentionCount: number;
  criticalCount: number;
}

export interface ProjectAuditResult {
  projects: AuditProjectRef[];
  projectId: string | null;
  generatedAt: string;
  summary: AuditSummary;
  attention: AuditTicket[];
  workload: AuditWorkloadRow[];
  missions: AuditMissionRow[];
  tickets: AuditTicket[];
  timeline: AuditTimelineRow[];
  merges: AuditMergeRow[];
  /**
   * ★Mission→Ticket→Agent→Model→Cost→Result 를 한 줄로 이은 실행 기록.
   * `timeline`(사건 나열)과 다른 축이다 — 아래 "실행 원장" 절 참조.
   */
  executionLedger: ExecutionLedgerRow[];
  /** 그 원장의 실측 커버리지(미측정을 0 으로 위장하지 않기 위한 분모). */
  executionCoverage: ExecutionLedgerCoverage;
  notes: string[];
}

// ── 입력(Firestore raw 문서) ─────────────────────────────────────────────────

export type RawDoc = Record<string, unknown> & { id: string };

export interface ProjectAuditInput {
  projects: ReadonlyArray<RawDoc>;
  projectId: string | null;
  tasks: ReadonlyArray<RawDoc>;
  agents: ReadonlyArray<RawDoc>;
  activities: ReadonlyArray<RawDoc>;
  ledger: ReadonlyArray<RawDoc>;
  missions: ReadonlyArray<RawDoc>;
  merges: ReadonlyArray<RawDoc>;
  /**
   * 에이전트 목록을 실제로 읽었나. false 면 고아 클레임 판정을 하지 않는다
   * ("모른다"를 "없다"로 접지 않기 위해 — evaluateAttention 주석 참조).
   */
  agentsLoaded: boolean;
  nowMs?: number;
  /** 타임라인 행 상한. 넘치면 잘리고 notes 에 그 사실을 남긴다. */
  timelineLimit?: number;
}

export const DEFAULT_TIMELINE_LIMIT = 200;

// ── 매퍼 ─────────────────────────────────────────────────────────────────────

/**
 * 프로젝트 셀렉터용 최소 사실.
 * ★`folderPath`/`folderPaths` 는 담지 않는다 — 기기별 로컬 경로 유출 방지.
 */
export function mapProject(doc: RawDoc): AuditProjectRef {
  const members = Array.isArray(doc.members) ? doc.members : [];
  return {
    id: doc.id,
    name: coerceString(doc.name),
    ownerId: coerceString(doc.ownerId),
    memberCount: members.length,
    updatedAt: toIso(doc.updatedAt),
  };
}

/** 미션 요약. `projection.statusCounts` 는 #775 프로젝터 롤업. */
export function mapMission(doc: RawDoc): AuditMissionRow {
  const taskIds = Array.isArray(doc.taskIds) ? doc.taskIds : [];
  const projection = (doc.projection ?? {}) as { statusCounts?: unknown };
  const rawCounts = (projection.statusCounts ?? {}) as Record<string, unknown>;
  const statusCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCounts)) {
    const n = coerceNumber(v);
    if (n > 0) statusCounts[k] = n;
  }
  return {
    id: doc.id,
    goal: truncateText(doc.goal, 200),
    status: coerceString(doc.status),
    taskCount: taskIds.length,
    doneCount: coerceNumber(statusCounts["DONE"]),
    statusCounts,
    updatedAt: toIso(doc.updatedAt ?? doc.createdAt),
  };
}

export function mapMerge(doc: RawDoc): AuditMergeRow {
  const prNumber = doc.prNumber == null ? null : coerceNumber(doc.prNumber);
  return {
    id: doc.id,
    taskId: coerceString(doc.taskId),
    repoRoot: coerceString(doc.repoRoot),
    branch: coerceString(doc.branch),
    prNumber: prNumber && prNumber > 0 ? prNumber : null,
    mergedAt: toIso(doc.mergedAt ?? doc.createdAt),
    filesChanged:
      doc.filesChanged == null ? null : coerceNumber(doc.filesChanged),
    linesAdded: doc.linesAdded == null ? null : coerceNumber(doc.linesAdded),
    linesDeleted:
      doc.linesDeleted == null ? null : coerceNumber(doc.linesDeleted),
  };
}

// ── 조립 ─────────────────────────────────────────────────────────────────────

/** 티켓 정렬: 주의 필요(critical→warning) 먼저, 그다음 최신 갱신순. */
function compareTickets(a: AuditTicket, b: AuditTicket): number {
  const rank = (t: AuditTicket): number =>
    t.attention?.severity === "critical"
      ? 0
      : t.attention?.severity === "warning"
      ? 1
      : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return (toMillis(b.updatedAt) ?? 0) - (toMillis(a.updatedAt) ?? 0);
}

/**
 * 어드민 프로젝트 감사 뷰 조립(순수).
 *
 * 입력은 Firestore raw 문서 그대로다. 이 함수를 거치지 않고 원문이 응답에 실릴
 * 길은 만들지 않는다 — 민감정보 규율(파일 상단)이 여기서 강제된다.
 */
export function buildProjectAudit(
  input: ProjectAuditInput
): ProjectAuditResult {
  const nowMs = input.nowMs ?? Date.now();
  const timelineLimit = Math.max(
    1,
    input.timelineLimit ?? DEFAULT_TIMELINE_LIMIT
  );
  const notes: string[] = [];

  // ── 티켓별 부수 집계(활동 수 / 실패 호출 수 / 최근 기록 시각) ──
  const activityCount = new Map<string, number>();
  const failedActions = new Map<string, number>();
  const latestByTask = new Map<string, number>();

  const touch = (taskId: string | null, ms: number | null): void => {
    if (!taskId || ms == null) return;
    const prev = latestByTask.get(taskId);
    if (prev == null || ms > prev) latestByTask.set(taskId, ms);
  };

  for (const a of input.activities) {
    const taskId = coerceString(a.taskId);
    if (taskId) {
      activityCount.set(taskId, (activityCount.get(taskId) ?? 0) + 1);
    }
    touch(taskId, toMillis(a.createdAt));
  }
  for (const l of input.ledger) {
    const taskId = coerceString(l.taskId);
    if (taskId && l.success === false) {
      failedActions.set(taskId, (failedActions.get(taskId) ?? 0) + 1);
    }
    touch(taskId, toMillis(l.createdAt));
  }

  // ── 에이전트 ──
  const liveAgentKeys = input.agentsLoaded
    ? agentClaimKeys(input.agents)
    : null;
  if (!input.agentsLoaded) {
    notes.push(
      "에이전트 목록을 읽지 못해 고아 클레임 판정을 생략했다 — '모름'을 '없음'으로 접지 않는다."
    );
  }

  // ── 티켓 ──
  const tickets: AuditTicket[] = input.tasks.map((doc) => {
    const status = parseTaskStatus(doc.status);
    const claimedBy = coerceString(doc.claimedBy);
    const archived = doc.archived === true;
    const deleted = doc.deleted === true;
    // 최근 기록 시각: 활동/원장 중 최신, 없으면 티켓 자체의 updatedAt.
    const latestMs = latestByTask.get(doc.id) ?? toMillis(doc.updatedAt);
    const failed = failedActions.get(doc.id) ?? 0;
    return {
      id: doc.id,
      title: truncateText(doc.title, 200),
      status,
      role: coerceString(doc.role),
      priority: doc.priority == null ? null : coerceNumber(doc.priority),
      missionId: missionIdFromContext(doc.contextId),
      prUrl: coerceString(doc.prUrl),
      claimedBy,
      archived,
      deleted,
      createdAt: toIso(doc.createdAt),
      updatedAt: toIso(doc.updatedAt),
      activityCount: activityCount.get(doc.id) ?? 0,
      failedActions: failed,
      attention: evaluateAttention(
        { status, claimedBy, archived, deleted, failedCount: failed, latestMs },
        { nowMs, liveAgentKeys }
      ),
    };
  });
  tickets.sort(compareTickets);

  const titleById = new Map<string, string | null>(
    tickets.map((t) => [t.id, t.title])
  );

  // ── 워크로드 ──
  // 티켓의 claimedBy 는 id 일 수도 이름일 수도 있으므로(위 주석), 에이전트마다
  // 자기 키 3갈래로 대조한다.
  const workload: AuditWorkloadRow[] = input.agents.map((doc) => {
    const keys = agentClaimKeys([doc]);
    let openTasks = 0;
    let doneTasks = 0;
    for (const t of tickets) {
      if (t.deleted || !t.claimedBy) continue;
      if (!keys.has(t.claimedBy) && !keys.has(t.claimedBy.toLowerCase())) {
        continue;
      }
      if (t.status === "DONE") doneTasks += 1;
      else if (!t.archived) openTasks += 1;
    }
    return {
      agentId: doc.id,
      name: coerceString(doc.name),
      model: coerceString(doc.spawnedModel ?? doc.model),
      role: coerceString(doc.role),
      status: coerceString(doc.status),
      currentTaskId: coerceString(doc.currentTaskId),
      openTasks,
      doneTasks,
      totalCost: coerceNumber(doc.totalCost),
    };
  });
  workload.sort(
    (a, b) => b.openTasks - a.openTasks || b.doneTasks - a.doneTasks
  );

  // ── 미션 ──
  const missions = input.missions.map(mapMission);
  missions.sort(
    (a, b) => (toMillis(b.updatedAt) ?? 0) - (toMillis(a.updatedAt) ?? 0)
  );

  // ── 머지 ──
  const merges = input.merges.map(mapMerge);
  merges.sort(
    (a, b) => (toMillis(b.mergedAt) ?? 0) - (toMillis(a.mergedAt) ?? 0)
  );

  // ── 타임라인(3소스 병합, 최신순) ──
  const timelineAll: AuditTimelineRow[] = [];
  for (const a of input.activities) {
    const taskId = coerceString(a.taskId);
    timelineAll.push({
      id: `activity:${a.id}`,
      kind: "activity",
      at: toIso(a.createdAt),
      taskId,
      taskTitle: taskId ? titleById.get(taskId) ?? null : null,
      actor: coerceString(a.agentId),
      label: "활동",
      text: truncateText(a.message, TEXT_MAX),
      success: null,
    });
  }
  for (const l of input.ledger) {
    const taskId = coerceString(l.taskId);
    timelineAll.push({
      id: `ledger:${l.id}`,
      kind: "ledger",
      at: toIso(l.createdAt),
      taskId,
      taskTitle: taskId ? titleById.get(taskId) ?? null : null,
      actor: coerceString(l.agentId),
      label: coerceString(l.toolName) ?? "툴 호출",
      // ★`params` 는 절대 담지 않는다. 지시문은 scrub 이 끝난 redacted 만.
      text:
        truncateText(l.instructionRedacted, TEXT_MAX) ??
        truncateText(l.result, TEXT_MAX),
      success: typeof l.success === "boolean" ? l.success : null,
    });
  }
  for (const m of merges) {
    timelineAll.push({
      id: `merge:${m.id}`,
      kind: "merge",
      at: m.mergedAt,
      taskId: m.taskId,
      taskTitle: m.taskId ? titleById.get(m.taskId) ?? null : null,
      actor: null,
      label: "머지",
      text: [m.repoRoot, m.branch, m.prNumber ? `#${m.prNumber}` : null]
        .filter(Boolean)
        .join(" · "),
      success: null,
    });
  }
  // 시각을 못 읽은 행(at=null)은 버리지 않고 맨 뒤로 보낸다 —
  // 감사에서 조용한 누락은 가장 나쁜 실패다.
  timelineAll.sort((a, b) => (toMillis(b.at) ?? -1) - (toMillis(a.at) ?? -1));
  const timeline = timelineAll.slice(0, timelineLimit);
  if (timelineAll.length > timeline.length) {
    notes.push(
      `타임라인이 최근 ${timeline.length}건으로 잘렸다(수집 ${timelineAll.length}건).`
    );
  }

  // ── 요약 ──
  const tasksByStatus: Record<string, number> = {};
  for (const s of TASK_STATUSES) tasksByStatus[s] = 0;
  let unknownStatus = 0;
  let tasksOpen = 0;
  let tasksDone = 0;
  for (const t of tickets) {
    if (t.deleted) continue;
    if (t.status === null) unknownStatus += 1;
    else tasksByStatus[t.status] += 1;
    if (t.status === "DONE") tasksDone += 1;
    else if (!t.archived) tasksOpen += 1;
  }
  if (unknownStatus > 0) tasksByStatus["(미기록)"] = unknownStatus;

  const attention = tickets.filter((t) => t.attention !== null);
  const summary: AuditSummary = {
    tasksTotal: tickets.filter((t) => !t.deleted).length,
    tasksOpen,
    tasksDone,
    tasksByStatus,
    agentsTotal: workload.length,
    agentsWorking: workload.filter((w) => w.status === "working").length,
    missionsTotal: missions.length,
    missionsActive: missions.filter(
      (m) => m.status !== "completed" && m.status !== "failed"
    ).length,
    mergesTotal: merges.length,
    prCount: tickets.filter((t) => !!t.prUrl).length,
    attentionCount: attention.length,
    criticalCount: attention.filter((t) => t.attention?.severity === "critical")
      .length,
  };

  // ── 실행 원장(한 줄로 이은 기록) ──
  // ★새 읽기가 없다 — 위에서 이미 조립한 것들만 잇는다.
  const execution = buildExecutionLedger({
    tickets,
    taskDocs: input.tasks,
    agents: input.agents,
    missions,
    ledger: input.ledger,
    merges,
    latestByTask,
  });
  if (execution.coverage.rows > 0) {
    const c = execution.coverage;
    notes.push(
      `실행 원장 ${c.rows}건 중 실제 모델이 실측된 행은 ${c.modelMeasured}건, ` +
        `티켓 단위 비용이 실측된 행은 ${c.costMeasured}건이다 — ` +
        "나머지는 '미측정'이며 0 이 아니다.",
    );
  }
  if (execution.coverage.ticketsWithoutExecution > 0) {
    notes.push(
      `실행 흔적이 없어 원장에 올리지 않은 티켓이 ${execution.coverage.ticketsWithoutExecution}건 있다.`,
    );
  }

  notes.push(
    "읽기 전용 뷰다 — 이 화면에서 티켓 재배정·메시지·상태 변경은 하지 않는다(Phase2).",
    "원장 툴 인자(params)는 지시문·경로·자격증명이 섞일 수 있어 응답에 싣지 않는다. 지시문은 scrub 된 요약만 표시한다.",
    "정체 판정은 6시간 무기록 기준이며, 진행 중(CLAIMED/IN_PROGRESS/REVIEW) 티켓에만 적용한다. 끝난·보관·삭제된 티켓은 주의 목록에 올리지 않는다."
  );

  return {
    projects: input.projects.map(mapProject),
    projectId: input.projectId,
    generatedAt: new Date(nowMs).toISOString(),
    summary,
    attention,
    workload,
    missions,
    tickets,
    timeline,
    merges,
    executionLedger: execution.rows,
    executionCoverage: execution.coverage,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★실행 원장 (Execution Ledger) — Mission→Ticket→Agent→Model→Cost→Result 한 줄
// ─────────────────────────────────────────────────────────────────────────────
//
// 왜 이게 따로 있나: 위의 `timeline` 은 **사건 나열**이다. "이 미션의 이 티켓을
// 이 에이전트가 이 모델로 실행해서 이 비용에 이 결과가 났다" 는 한 줄로 읽히지
// 않는다. 이 섹션이 그 한 줄이다.
//
// ★새 집계 파이프라인이 아니다. 콜러블이 **이미 읽고 있는 문서**(tasks/agents/
//   audit_logs/missions/merge_history)의 필드를 잇기만 한다. 새 쿼리·새 컬렉션·
//   BigQuery 조인 0.
//
// ── ★이 섹션이 지키는 세 가지 규율 ──────────────────────────────────────────
//
// (1) **결측은 0 이 아니다.** 비용·모델·재시도는 전부 nullable 이다. 필드가 없는
//     문서(롤업이 생기기 전 티켓)는 `null`("미측정")이고, 실제로 0 이 기록된
//     티켓만 `0`("실측 0")이다. 이 둘을 뭉개면 발표에서 틀린 숫자가 나간다.
//
// (2) **모델은 두 축이다.** `agents.model` 은 하네스(CLI/런타임: claude/codex/…)
//     축이고, 실제 실행 모델은 `detectedModelId`(과금 관측) → `spawnedModel`
//     (argv 되읽기) 순으로만 온다. `audit_logs.model` 도 하네스 축이다.
//     ★하네스 값을 실제 모델 칸으로 승격시키지 않는다 — `workload[].model` 이
//     `spawnedModel ?? model` 로 **조용히 폴백**하는 것과 의도적으로 다르다.
//
// (3) **비용은 티켓 단위 적립값만 쓴다.** `tasks/<id>.costTotal` 은
//     `v3/src/services/taskRollups.ts` 가 cost:update 스트림에서 티켓별로
//     increment 한 값이다. ★`cost_logs` 전역 SUM 이 아니다(재읽기 중복),
//     `task_outcomes` 조인도 아니다(clientId vs uid 축 불일치).
//
// (4) 자유 텍스트를 **새로 늘리지 않는다.** 이 행이 싣는 텍스트는 이미 응답에
//     있던 티켓 제목·미션 목표뿐이다. 원장 `params`·`result`·`instructionRedacted`
//     는 이 섹션에 오지 않는다.

/**
 * 숫자 필드의 **3-상태** 변환: 값 / 실측 0 / 미측정(null).
 *
 * ★`coerceNumber` 와 갈라놓은 이유가 이 파일의 존재 이유다 — 저쪽은 없는 값을
 * 0 으로 접는다. 요약 카운터에는 그게 맞지만, "이 티켓이 얼마 썼나" 에는 틀렸다.
 * 필드가 아예 없는 티켓(롤업 이전 문서)을 `$0` 으로 그리면 화면이 거짓말을 한다.
 */
export function coerceNullableNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 실제 실행 모델의 근거. 없으면 null — 하네스 값으로 대신하지 않는다. */
export type ModelEvidenceSource = "detectedModelId" | "spawnedModel";

export interface LedgerModelAxis {
  /**
   * 실제 실행 모델 id. ★없으면 null = **미측정**이다. 하네스 값을 넣지 않는다.
   * (감사 실측: `spawnedModel` 계열은 2026-08-10 부터 채워지기 시작해 전 구간
   * 커버리지가 아니다. 그 사실을 화면이 숨기면 안 된다.)
   */
  actual: string | null;
  /** 어디서 온 값인가. `actual` 이 null 이면 null. */
  actualSource: ModelEvidenceSource | null;
  /** 하네스/실행기 축(claude/codex/grok/…). 실제 모델이 **아니다**. */
  harness: string | null;
}

export interface LedgerCostAxis {
  /** 티켓 단위 누적 비용(USD). null = 미측정, 0 = 실측 0. */
  total: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** 이 티켓에서 에이전트가 재시작된 횟수. null = 미측정. */
  retries: number | null;
}

export interface LedgerResultAxis {
  status: TaskStatus | null;
  /** DONE 으로 처음 전이한 시각. 없으면 null(구 티켓은 백필하지 않는다). */
  completedAt: string | null;
  prUrl: string | null;
  /** `merge_history` 에 이 티켓의 머지 기록이 있나. */
  merged: boolean;
  /** 원장에 남은 이 티켓의 툴 호출 수(수집 창 안에서). */
  actions: number;
  /** 그중 실패한 호출 수. */
  failedActions: number;
}

/** Mission→Ticket→Agent→Model→Cost→Result 를 한 줄로 이은 실행 기록. */
export interface ExecutionLedgerRow {
  taskId: string;
  missionId: string | null;
  /** 미션 목표(절단됨). 보드/레인 티켓은 미션이 없으므로 null. */
  missionGoal: string | null;
  ticketTitle: string | null;
  role: string | null;
  /** 티켓이 물린 문자열 그대로(`claimedBy` 는 id 일 수도 이름일 수도 있다). */
  claimedBy: string | null;
  /** `claimedBy` 를 실제 에이전트 문서로 푼 결과. 못 풀면 null. */
  agentId: string | null;
  agentName: string | null;
  /**
   * ★에이전트 문서를 못 찾았다는 사실을 그대로 남긴다. 완료된 티켓의 에이전트
   * 문서는 정리(cleanup)로 사라진다 — "에이전트 없음" 과 "모델 미측정" 은
   * 원인이 다르고, 화면이 그 둘을 같은 회색으로 뭉개면 안 된다.
   */
  agentResolved: boolean;
  model: LedgerModelAxis;
  cost: LedgerCostAxis;
  result: LedgerResultAxis;
  /** 이 티켓의 마지막 기록 시각(활동/원장 중 최신, 없으면 updatedAt). */
  at: string | null;
}

/**
 * 실행 원장의 **커버리지**. 화면이 "몇 건이 실측이고 몇 건이 미측정인지" 를
 * 밝히는 데 쓴다 — 발표에서 "이 숫자 전부 실측이냐" 는 질문에 대한 답이다.
 */
export interface ExecutionLedgerCoverage {
  /** 실행 흔적이 있어 원장 행이 만들어진 티켓 수. */
  rows: number;
  /** 실행 흔적이 없어 행을 만들지 않은 티켓 수(삭제 제외). */
  ticketsWithoutExecution: number;
  /** `model.actual` 이 있는 행 수. */
  modelMeasured: number;
  /** `cost.total` 이 null 이 아닌 행 수(0 도 실측으로 센다). */
  costMeasured: number;
  /** `claimedBy` 를 에이전트 문서로 푼 행 수. */
  agentResolved: number;
  /**
   * 실측된 비용의 합. ★분모는 `costMeasured` 지 `rows` 가 아니다 —
   * 미측정 행을 0 으로 세어 평균을 희석하지 않는다.
   */
  costMeasuredTotal: number;
}

/**
 * 한 에이전트 문서에서 두 모델 축을 갈라 읽는다.
 *
 * ★`adminAnalytics.deriveEffectiveModel`(#1471)과 **의도적으로 다른 계약**이다.
 * 통합하지 마라 — 통합하는 순간 이 화면이 하네스를 실제 모델로 그린다.
 *
 *   `deriveEffectiveModel` = **분포의 버킷 키**를 만드는 함수다. 키가 없으면
 *       막대를 그릴 수 없으니 하네스로 폴백하고, 그마저 없으면 `"(none)"` 을
 *       돌려준다. 분포에서는 그게 맞다.
 *   `readAgentModelAxes`   = **한 기록의 한 칸**을 채우는 함수다. 모르면
 *       모른다고 말할 수 있어야 하므로 `actual: null`(미측정)을 돌려주고,
 *       하네스는 `harness` 라는 **다른 칸**으로 내보낸다. 원장에서는 그게 맞다.
 *
 * ★효과 접미사(`@high`)도 벗기지 않는다. `deriveEffectiveModel` 은 단가 집계
 * 축을 `cost_logs.model` 관례에 맞추려고 벗기지만, 원장은 **스탬프된 값 그대로**
 * 가 증거다. 벗기면 "무엇으로 띄웠나" 의 일부가 기록에서 사라진다.
 */
export function readAgentModelAxes(
  doc: Record<string, unknown>,
): Pick<LedgerModelAxis, "actual" | "actualSource" | "harness"> {
  const detected = coerceString(doc.detectedModelId);
  if (detected) {
    return {
      actual: detected,
      actualSource: "detectedModelId",
      harness: coerceString(doc.model),
    };
  }
  const spawned = coerceString(doc.spawnedModel);
  if (spawned) {
    return {
      actual: spawned,
      actualSource: "spawnedModel",
      harness: coerceString(doc.model),
    };
  }
  // ★여기서 `doc.model` 을 actual 로 올리지 않는다. 그게 축 혼동이다.
  return { actual: null, actualSource: null, harness: coerceString(doc.model) };
}

export interface ExecutionLedgerInput {
  tickets: ReadonlyArray<AuditTicket>;
  /** 원본 task 문서(비용 롤업 필드는 `AuditTicket` 에 없다). id 로 찾는다. */
  taskDocs: ReadonlyArray<RawDoc>;
  agents: ReadonlyArray<RawDoc>;
  missions: ReadonlyArray<AuditMissionRow>;
  ledger: ReadonlyArray<RawDoc>;
  merges: ReadonlyArray<AuditMergeRow>;
  /** 티켓별 마지막 기록 시각(ms). `buildProjectAudit` 이 이미 계산한 것. */
  latestByTask: ReadonlyMap<string, number>;
}

export interface ExecutionLedgerOutput {
  rows: ExecutionLedgerRow[];
  coverage: ExecutionLedgerCoverage;
}

/**
 * 실행 원장 행 조립. 순수 함수 — Firestore 무의존, 입력만으로 결정된다.
 *
 * 행을 만드는 기준은 **실행 흔적이 있는가** 다: 물린 적이 있거나(claimedBy),
 * 원장에 툴 호출이 남았거나, 비용이 적립됐거나, 완료 시각이 찍혔거나.
 * 아무도 손대지 않은 TODO 티켓까지 넣으면 "실행 기록" 이 아니라 그냥 티켓
 * 목록이 된다. ★대신 **몇 건을 뺐는지 커버리지에 밝힌다** — 조용한 누락 금지.
 */
export function buildExecutionLedger(
  input: ExecutionLedgerInput,
): ExecutionLedgerOutput {
  const taskDocById = new Map<string, RawDoc>(
    input.taskDocs.map((d) => [d.id, d]),
  );
  const missionById = new Map<string, AuditMissionRow>(
    input.missions.map((m) => [m.id, m]),
  );

  // 티켓별 원장 집계 — 호출 수와 하네스 축 모델(에이전트 문서가 사라진 뒤에도
  // 원장에는 남아 있다).
  const actionsByTask = new Map<string, number>();
  const harnessByTask = new Map<string, string>();
  for (const l of input.ledger) {
    const taskId = coerceString(l.taskId);
    if (!taskId) continue;
    actionsByTask.set(taskId, (actionsByTask.get(taskId) ?? 0) + 1);
    if (!harnessByTask.has(taskId)) {
      const m = coerceString(l.model);
      if (m) harnessByTask.set(taskId, m);
    }
  }

  const mergedTasks = new Set<string>();
  for (const m of input.merges) {
    if (m.taskId) mergedTasks.add(m.taskId);
  }

  // 에이전트 조회표 — `claimedBy` 는 id 일 수도 이름일 수도 있다(agentClaimKeys
  // 주석). 같은 3갈래 키로 색인해 이름으로 물린 티켓도 풀리게 한다.
  const agentByKey = new Map<string, RawDoc>();
  for (const a of input.agents) {
    for (const key of agentClaimKeys([a])) {
      if (!agentByKey.has(key)) agentByKey.set(key, a);
    }
  }

  const rows: ExecutionLedgerRow[] = [];
  let ticketsWithoutExecution = 0;

  for (const t of input.tickets) {
    if (t.deleted) continue;

    const doc = taskDocById.get(t.id);
    const cost: LedgerCostAxis = {
      total: coerceNullableNumber(doc?.costTotal),
      inputTokens: coerceNullableNumber(doc?.costInputTokens),
      outputTokens: coerceNullableNumber(doc?.costOutputTokens),
      retries: coerceNullableNumber(doc?.retriesCount),
    };
    const completedAt = toIso(doc?.completedAt);
    const actions = actionsByTask.get(t.id) ?? 0;

    const executed =
      t.claimedBy !== null ||
      actions > 0 ||
      cost.total !== null ||
      completedAt !== null;
    if (!executed) {
      ticketsWithoutExecution += 1;
      continue;
    }

    const agentDoc = t.claimedBy
      ? (agentByKey.get(t.claimedBy) ??
        agentByKey.get(t.claimedBy.toLowerCase()) ??
        null)
      : null;
    const axes = agentDoc
      ? readAgentModelAxes(agentDoc)
      : { actual: null, actualSource: null, harness: null };
    const mission = t.missionId ? (missionById.get(t.missionId) ?? null) : null;
    const latestMs = input.latestByTask.get(t.id) ?? null;

    rows.push({
      taskId: t.id,
      missionId: t.missionId,
      missionGoal: mission ? truncateText(mission.goal, 200) : null,
      ticketTitle: t.title,
      role: t.role,
      claimedBy: t.claimedBy,
      agentId: agentDoc ? agentDoc.id : null,
      agentName: agentDoc ? coerceString(agentDoc.name) : null,
      agentResolved: agentDoc !== null,
      model: {
        actual: axes.actual,
        actualSource: axes.actualSource,
        // 에이전트 문서가 사라졌어도 원장에 남은 하네스 축은 살린다.
        harness: axes.harness ?? harnessByTask.get(t.id) ?? null,
      },
      cost,
      result: {
        status: t.status,
        completedAt,
        prUrl: t.prUrl,
        merged: mergedTasks.has(t.id),
        actions,
        failedActions: t.failedActions,
      },
      at: latestMs !== null ? new Date(latestMs).toISOString() : t.updatedAt,
    });
  }

  // 최신 실행순. 시각을 못 읽은 행은 버리지 않고 맨 뒤로 — 감사에서 조용한
  // 누락이 가장 나쁜 실패다(타임라인과 같은 규약).
  rows.sort((a, b) => (toMillis(b.at) ?? -1) - (toMillis(a.at) ?? -1));

  let modelMeasured = 0;
  let costMeasured = 0;
  let agentResolved = 0;
  let costMeasuredTotal = 0;
  for (const r of rows) {
    if (r.model.actual !== null) modelMeasured += 1;
    if (r.cost.total !== null) {
      costMeasured += 1;
      costMeasuredTotal += r.cost.total;
    }
    if (r.agentResolved) agentResolved += 1;
  }

  return {
    rows,
    coverage: {
      rows: rows.length,
      ticketsWithoutExecution,
      modelMeasured,
      costMeasured,
      agentResolved,
      costMeasuredTotal,
    },
  };
}
