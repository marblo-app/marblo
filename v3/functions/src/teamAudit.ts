// 팀 감사 — 순수 로직(Firestore 무의존). node --test 로 단위검증한다
// (projectAudit.ts / personAxis.ts 와 동일 규약). index.ts 의 `getTeamProjectAudit`
// 콜러블은 Firestore Admin SDK read 와 역할 확인만 담당하고, **경계 판정과 좁히기는
// 전부 여기**에 있다.
//
// 설계: docs/team-usage-overview-design-2026-08-21.md §3.2(감사 탭) · §5(권한 경계)
//       · §7(응답 봉투) · §12(감사 경계 — 이 티켓이 추가).
//
// ═════════════════════════════════════════════════════════════════════════════
// ★이 파일이 답하는 질문: 팀 기능과 감시의 경계는 어디인가
// ═════════════════════════════════════════════════════════════════════════════
// 사용량은 "얼마 썼나" 지만 감사는 **"무엇을 했나"** 다. 후자는 사람의 행동 이력이라
// 선을 잘못 그으면 팀 운영 도구가 아니라 감시 도구가 된다. 그어진 선은 이것이다:
//
//   ★**공유 산출물에 일어난 사건은 보여준다. 그 사람이 무슨 명령을 쳤는지는 안 보여준다.**
//
// 티켓·머지·에이전트·플로우는 팀이 함께 쥔 물건이고, 거기 일어난 변경에 대한
// 책임 추적은 팀 운영의 정의다. 반면 어떤 툴을 몇 번 호출했는지, 무엇을 읽었는지,
// 무엇을 물었는지는 그 사람의 **작업 방식**이지 프로젝트의 상태가 아니다.
//
// ── 기계로 강제한다 (차단목록이 아니라 허용목록) ─────────────────────────────
// `PROJECT_EVENT_TOOLS` 에 **없는 툴은 응답에 안 실린다.** 차단목록이면 새 툴이
// 생길 때마다 조용히 새지만, 허용목록은 분류되기 전까지 fail-closed 다. 프라이버시
// 경계가 실패하는 방향은 이쪽이어야 한다.
//
// ── ★응답에 자유 텍스트 필드가 **존재하지 않는다** ───────────────────────────
// `TeamAuditEvent` 에는 `text`/`message`/`instruction`/`result` 자리가 아예 없다.
// null 로 두지 않는 이유: 자리가 있으면 언젠가 누가 채운다. 배포된 처리방침이
// "코드 내용 · 사용자 작성 텍스트 · 파일 내용" 을 미수집 항목으로 고지하고 있고
// (v3/src/components/legal/privacyContent.tsx 의 항목 "미수집 항목" — ★행
// 번호로 인용하지 마라, 그 파일은 계속 움직인다), 응답에 실으면 그 문장이
// 거짓이 된다.
//
// ── ★금액·토큰 수치가 **하나도 없다** ────────────────────────────────────────
// `projectAudit.buildProjectAudit` 는 `workload[].totalCost` 를 낸다. 그걸 그대로
// 실으면 설계 §5.1 의 `TEAM_USAGE_EFFECTIVE_FROM` 게이트(고지 개정 전까지 멤버별
// 지출 비공개)가 **감사 탭 경유로 통째로 우회된다** — 감사 탭은 그 게이트 밖이기
// 때문이다. 그래서 돈은 여기로 안 나간다. `getTeamUsageSummary` 와 그 게이트로만
// 나간다. 이것이 감사 탭이 게이트 없이 배포돼도 안전한 이유다.
//
// ── ★운영자 축과 섞지 않는다 ─────────────────────────────────────────────────
// `requireAdmin`(단일 `ADMIN_UID` 대조 = 마블로 사장님 축)을 재사용하지 않는다.
// 팀 오너는 **다른 축**이고, 한번 섞으면 "이 사람이 왜 이걸 보나" 를 두 번 다시
// 풀 수 없다. 역할 판정은 `firestore.rules` 의 `isProjectOwner`/`isAdminOrOwner`/
// `isProjectMember` 와 **같은 판정을 서버가 다시** 한다 — Admin SDK 는 보안 규칙을
// 우회하므로 룰이 막아주리라 기대할 수 없다.

import { STALLED_AFTER_MS } from "./projectAudit";
import type { AttentionKind } from "./projectAudit";
import type {
  Attention,
  AuditTicket,
  ProjectAuditResult,
} from "./projectAudit";

// ── 역할 축 ──────────────────────────────────────────────────────────────────

/**
 * 팀 축의 역할. ★운영자 축(`ADMIN_UID`)과 **다른 축**이다 — 겹치지 않는다.
 * `firestore.rules` 의 판정과 1:1로 맞춘다:
 *   owner  = `projects/{id}.ownerId == uid`                (isProjectOwner)
 *   admin  = `memberRoles/{id}_{uid}.role == 'admin'`      (isAdminOrOwner 의 뒷항)
 *   member = `uid in projects/{id}.members`                (isProjectMember)
 *   none   = 위 어느 것도 아님
 */
export type TeamProjectRole = "owner" | "admin" | "member" | "none";

/** 이 호출이 볼 수 있는 범위. team = 프로젝트 전체 사건 / self = 자기 것만. */
export type TeamAuditScope = "team" | "self";

/**
 * 역할 → 스코프. `none` 은 스코프가 없다(null).
 *
 * ★member 가 `self` 인 근거: 본인 기록 열람은 감시가 아니라 정보주체 권리이고,
 * 룰상 이미 자기 프로젝트 원장을 읽을 수 있어 새 노출이 아니다. 반면 남의 행을
 * 보여주면 그 순간 이 화면은 감시 도구가 된다 — 그래서 **서버가** 거른다.
 */
export function scopeForRole(role: TeamProjectRole): TeamAuditScope | null {
  if (role === "owner" || role === "admin") return "team";
  if (role === "member") return "self";
  return null;
}

// ── ★허용목록 — 이 파일의 핵심 ───────────────────────────────────────────────

/**
 * 감사 피드에 실리는 툴. **공유 산출물(티켓·머지·에이전트·플로우)의 상태를 바꾸는
 * 툴만** 올라온다. 이름은 `electron/mcp-server/tools.ts` 의 등록명 정본과 같다.
 *
 * ★여기 없는 것은 안 나간다. 목록에 새 이름을 더할 때는 "이게 공유 산출물을
 * 바꾸는가, 아니면 그 사람의 작업 방식인가" 만 물어라.
 */
export const PROJECT_EVENT_TOOLS: ReadonlySet<string> = new Set([
  // 티켓이 생겼다.
  "create_task",
  "create_tasks_bulk",
  // 티켓이 움직였다 — ★사장님이 말한 "누가 티켓을 옮겼나" 가 이 셋이다.
  "claim_task",
  "update_task_status",
  "submit_for_review",
  // 머지됐다 — ★"누가 머지했나". merge_history 문서에는 행위자 필드가 아예
  //   없으므로(electron/main.ts:3603), 머지의 **사람**을 답하는 유일한 소스가 이것이다.
  "merge_and_close",
  // 에이전트가 보드에 생겼다.
  "spawn_agent",
  // 플로우 정의가 바뀌었다.
  "create_flow",
  "update_flow",
]);

/**
 * ★일부러 뺀 것과 그 이유. 이 표는 장식이 아니라 **결정의 기록**이다 —
 * 다음 사람이 "왜 add_activity 는 없지?" 하고 무심코 추가하는 것을 막는다.
 *
 * | 뺀 것 | 왜 |
 * | --- | --- |
 * | `add_activity` `ask_orchestrator` `answer_question` `check_feedback`
 *   `acknowledge_feedback` `add_pending_instruction`
 *   `mark_instruction_delivered` `escalate_to_owner`
 *   | 통신·보고다. 텍스트를 빼고 나면 "누가 언제 뭔가 적었다" 만 남는데, 그건
 *     운영 정보가 0 이고 분(分) 단위 행동 추적이 1 이다. 빈도도 가장 높아서
 *     넣는 순간 피드 전체가 개인 행동 로그가 된다. |
 * | `get_*` `search_tasks` `get_agent_skill` `run_skill`
 *   | **열람 기록**이다. "누가 무엇을 봤나" 는 어떤 해석으로도 감시다. |
 * | `request_model_escalation` `resolve_model_escalation`
 *   | 공유 산출물이 아니라 "이 사람이 얼마나 어려워했나" 의 기록 = 성과 평가.
 *     승인만 넣고 요청을 빼면 비대칭이라 계열 전체를 뺐다. |
 * | `mission.*` (mission-engine 원장 이벤트)
 *   | 미션은 `missions` 블록(id·상태·카운트)으로 이미 표현된다. 원장 이벤트까지
 *     넣으면 같은 사실이 두 번 나오고 `in` 절이 열거 불가능해진다. |
 * | 비-MCP 툴 전부(`Bash` `Read` `Edit` `Write` `Grep` …)
 *   | ★이게 "그 사람이 무슨 명령을 쳤는지" 다. 티켓이 감시라고 부른 바로 그것. |
 */
export const WITHHELD_TOOL_NOTE =
  "이 목록에는 티켓·머지·에이전트·워크플로를 바꾼 활동만 담깁니다. " +
  "명령 실행, 파일 접근, 열람·검색, 보고·질문 기록은 담기지 않습니다.";

/** 사건 분류 — 화면이 아이콘/그룹을 고르는 축. */
export type TeamAuditEventKind =
  | "task_create"
  | "task_transition"
  | "merge"
  | "agent_spawn"
  | "flow_change";

const TOOL_EVENT_KIND: Readonly<Record<string, TeamAuditEventKind>> = {
  create_task: "task_create",
  create_tasks_bulk: "task_create",
  claim_task: "task_transition",
  update_task_status: "task_transition",
  submit_for_review: "task_transition",
  merge_and_close: "merge",
  spawn_agent: "agent_spawn",
  create_flow: "flow_change",
  update_flow: "flow_change",
};

/** 허용목록 판정. 목록 밖이면 false — fail-closed. */
export function isProjectEventTool(toolName: unknown): boolean {
  return typeof toolName === "string" && PROJECT_EVENT_TOOLS.has(toolName);
}

/** 툴 이름 → 사건 분류. 허용목록 밖이면 null. */
export function eventKindForTool(toolName: unknown): TeamAuditEventKind | null {
  if (typeof toolName !== "string") return null;
  return TOOL_EVENT_KIND[toolName] ?? null;
}

// ── 봉투 상태 (설계 §7 규약 계승) ────────────────────────────────────────────

/**
 * `getTeamUsageSummary` 의 `teamUsage.state` 와 **같은 어휘**를 쓴다. 새 낱말을
 * 만들지 않는다 — 두 탭이 다른 낱말을 쓰면 화면이 상태를 두 벌로 해석한다.
 *
 * - `disabled` — 볼 권한이 없다. ★프로젝트 존재 여부를 말하지 않는다(설계 §5.3).
 * - `empty`    — 권한은 있고 조회 창 안에 사건이 0 건이다.
 * - `partial`  — 사건은 있으나 **전부가 아니다**(소스 일부 실패 또는 스캔 절단).
 *                티켓이 말한 `pending`(적재 전/미도착)이 여기로 접힌다.
 * - `complete` — 정상.
 */
export type TeamAuditState = "disabled" | "empty" | "partial" | "complete";

/**
 * 상태 사유 코드. ★안정적인 enum 이다 — 화면은 **이걸 i18n 키로** 써라.
 * `reason` 은 같은 뜻의 ko 문장이라 키가 없을 때 그대로 그려도 된다.
 * (`personAxis.PersonAxisGate` 의 `reasonCode`/`reason` 쌍과 같은 규약.)
 */
export const TEAM_AUDIT_REASON_CODES = [
  "no_role",
  "no_project",
  "no_events",
  "partial_sources",
  "scan_truncated",
  "self_scope_unattributable",
] as const;

export type TeamAuditReasonCode = typeof TEAM_AUDIT_REASON_CODES[number];

const REASON_TEXT: Readonly<Record<TeamAuditReasonCode, string>> = {
  // ★"프로젝트가 있는지 없는지는 말하지 않는다" 는 **설계 근거**이지 사용자에게 할
  //   말이 아니다. 그 근거는 `deniedTeamAudit` 주석과 설계 §5.3 에 있다.
  no_role: "이 프로젝트의 활동 기록을 볼 수 있는 권한이 없습니다.",
  no_project: "표시할 프로젝트가 없습니다.",
  no_events: "이 기간에 기록된 활동이 없습니다.",
  partial_sources:
    "기록 일부를 불러오지 못해 아래 목록이 전부가 아닙니다. 비어 있는 항목은 '없음' 이 아니라 '확인되지 않음' 입니다.",
  scan_truncated:
    "최근 활동만 불러왔습니다. 더 오래된 활동은 이 화면에 없습니다.",
  // ★원인(가명 솔트 부재)은 **서버 로그로** 간다(index.ts). 오너는 고칠 수 없는
  //   서버 설정 문제이므로, 화면에는 지금 상태와 다음 행동만 말한다.
  self_scope_unattributable:
    "지금은 본인 활동 기록을 표시할 수 없습니다. 문제가 계속되면 지원팀에 알려 주세요.",
};

/** 사유 코드 → ko 문장. 화면이 i18n 키가 없을 때 그대로 그릴 수 있는 폴백. */
export function reasonTextFor(code: TeamAuditReasonCode): string {
  return REASON_TEXT[code];
}

// ── 응답 타입 ────────────────────────────────────────────────────────────────

/**
 * 사건 한 줄.
 *
 * ★자유 텍스트 필드가 **없다.** `text`/`message`/`instruction`/`result` 를 null 로도
 * 두지 않는다 — 자리가 있으면 언젠가 채워진다.
 * ★금액·토큰 필드가 **없다.** 같은 이유 + 게이트 우회 방지(파일 상단).
 */
export interface TeamAuditEvent {
  /** `ledger:<docId>` 또는 `merge:<docId>`. 커서 타이브레이커이기도 하다. */
  id: string;
  kind: TeamAuditEventKind;
  /** 허용목록 툴 이름 그대로. `merge_history` 행은 `"merge_history"`. */
  action: string;
  at: string | null;
  /** 정렬·커서용 epoch ms. 시각을 못 읽었으면 null. */
  atMs: number | null;
  taskId: string | null;
  /** 공유 보드에 이미 떠 있는 라벨이다 — 새 노출이 아니다. */
  taskTitle: string | null;
  /** ★`tm_` 팀 전용 가명. 원시 uid 는 어디에도 안 나간다. 모르면 null. */
  memberKey: string | null;
  /** 프로젝트 산출물인 에이전트 식별자(사람이 아니다). 모르면 null. */
  agentId: string | null;
  /** 원장 행만 의미 있다. `merge_history` 행은 null. */
  success: boolean | null;
  /** 머지 사건에만 실린다. ★`repoRoot`(기기 로컬 경로)는 절대 안 싣는다. */
  merge: TeamAuditMergeFacts | null;
}

/** 머지의 크기 사실. 사람이 아니라 **변경**에 붙는 숫자다. */
export interface TeamAuditMergeFacts {
  branch: string | null;
  prNumber: number | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
}

/** 티켓 요약. 매퍼의 `AuditTicket` 을 그대로 쓴다(금액·자유 텍스트 없음). */
export interface TeamAuditTicket extends AuditTicket {
  /**
   * '정체' 를 **실제로 판정했나.**
   *
   * `false` = 이 티켓의 활동 기록을 다 읽지 못해 판정을 **유보**했다.
   * ★**정체가 아니라는 뜻이 아니다.** `attention` 에서 `stalled` 가 빠진 것과
   * "정체가 없다" 가 같은 모양이 되는 걸 막는 유일한 자리다(§12.5.3).
   *
   * 왜 필요한가: 배열에서 원소를 빼면 **"없음" 과 "모름" 이 같은 모양**이 된다.
   * 유보 사실이 글로벌 note 하나에만 얹혀 있으면, 화면이 그 note 를 접거나 요약만
   * 그리는 순간 사라진다. 문장은 **오독**을 막고 이 필드는 **접기**를 막는다 —
   * 둘 중 하나가 다른 하나를 덮지 못한다(형제 티켓 `lt9w8LucYFpSbaEzTsgG` 와 합의).
   *
   * ★화면이 이 필드를 **무시해도 동작은 지금과 같다**(추가 필드이지 모양 변경이 아니다).
   */
  stalledJudged: boolean;
}

/** 미션 요약. ★`goal`(사람이 친 지시문)은 뺀다. */
export interface TeamAuditMission {
  id: string;
  status: string | null;
  taskCount: number;
  doneCount: number;
  statusCounts: Record<string, number>;
  updatedAt: string | null;
}

/** 에이전트별 부하. ★`totalCost` 를 뺀 형태다 — 돈은 이 응답에 없다. */
export interface TeamAuditWorkloadRow {
  agentId: string;
  name: string | null;
  model: string | null;
  role: string | null;
  status: string | null;
  currentTaskId: string | null;
  openTasks: number;
  doneTasks: number;
}

export interface TeamAuditSummary {
  /** 이 페이지가 아니라 **수집 창** 기준 사건 수. */
  eventsInWindow: number;
  eventsByKind: Record<TeamAuditEventKind, number>;
  tasksTotal: number;
  tasksOpen: number;
  tasksDone: number;
  tasksByStatus: Record<string, number>;
  attentionCount: number;
  criticalCount: number;
  agentsTotal: number;
  missionsTotal: number;
  missionsActive: number;
}

/**
 * ★`summary` 의 어떤 숫자가 어떤 배열과 **항상 같아야 하는가.**
 *
 * UI 티켓(`pTQuNVOI1MTzwaowegSR`)이 "둘이 다른 게 정상인 경우도 있어 대조를 안 걸었다"
 * 고 물어왔다. 맞는 조심이다 — 실제로 **일부러 다른** 짝이 있다. 그래서 어느 쪽인지를
 * 여기 못박는다. 적어두지 않으면 화면이 대조를 못 걸거나, 틀린 짝을 걸어 오경보를 낸다.
 *
 * ★화면이 목록을 **그리고 있다면 대조하지 말고 목록에서 세라.** 대조는 어긋났을 때
 * 무엇을 그릴지를 안 정해 준다 — 서버 값을 그리면 화면이 거짓말하고, 목록 값을 그리면
 * 대조가 무의미하다. 유도하면 그 선택지가 아예 없다(UI 티켓의 판단).
 * 대조는 목록이 화면에 **없는** 카운트에만 남는다.
 *
 * ── 항상 같다(유도하라 · 목록이 화면에 없으면 대조) ───────────────────────
 *   attentionCount   === attention.length
 *   criticalCount    === attention 중 severity === "critical" 개수
 *   agentsTotal      === workload.length
 *   missionsTotal    === missions.length
 *   eventsInWindow   === eventsByKind 값들의 합
 *
 * ── 일부러 다르다(대조를 걸면 오경보) ─────────────────────────────────────
 *   eventsInWindow vs events.length  — 창 기준 vs **한 페이지**
 *   tasksTotal     vs tickets.length — tasksTotal 은 삭제된 티켓을 뺀다
 *
 * ★그리고 `mergesTotal` 은 **없앴다.** 머지는 사건 피드에도 나오는데 그 숫자만
 * 프로젝트 전체였다 — `self` 스코프에서 피드에는 머지가 0건인데 "머지 12건" 이라고
 * 말하는 화면이 된다. `eventsByKind.merge` 가 보이는 것과 일치하는 유일한 숫자이므로
 * 그것만 남긴다. **출처가 둘이면 언젠가 갈라진다.**
 */
/**
 * ★**일부러 다른** 짝. 화면이 여기 대조를 걸면 **오경보**다.
 *
 * 상수로 뺀 이유: 주석에만 두면 "다를 수 있음" 으로 **근거 없이 미루는** 자리가 된다.
 * `reason` 을 필수로 두고 테스트가 **비어 있지 않은지** 검사한다 — 이유를 쓰게 만드는
 * 것이 요점이고, 길이 하한 자체는 아무래도 괜찮다(형제 티켓 규약 계승).
 *
 * ★그리고 이 목록에 있는 짝이 불변식 목록에 **동시에 있으면 안 된다.** 테스트가 본다.
 */
export const TEAM_AUDIT_DELIBERATE_MISMATCHES: ReadonlyArray<{
  pair: string;
  reason: string;
}> = [
  {
    pair: "eventsInWindow vs events.length",
    reason:
      "eventsInWindow 는 수집 창 전체의 사건 수이고 events 는 요청한 한 페이지다. 페이지마다 총계가 달라지면 안 되므로 창 기준을 유지한다.",
  },
  {
    pair: "tasksTotal vs tickets.length",
    reason:
      "tasksTotal 은 삭제된 티켓을 빼고 세지만 tickets 배열에는 삭제 표시된 티켓도 들어 있다. 화면이 삭제 티켓을 그릴지는 화면이 정한다.",
  },
  {
    pair: "eventsByKind.merge vs 프로젝트의 실제 머지 수",
    reason:
      "머지 사건은 스코프를 탄다 — self 스코프에서는 행위자를 알 수 없는 merge_history 행이 전부 빠진다. 프로젝트 전체 머지 수를 내는 필드는 일부러 없앴다(§12.5.4).",
  },
];

export const TEAM_AUDIT_SUMMARY_INVARIANTS = [
  "attentionCount === attention.length",
  "criticalCount === attention 중 critical 개수",
  "agentsTotal === workload.length",
  "missionsTotal === missions.length",
  "eventsInWindow === eventsByKind 합",
] as const;

/**
 * ★이 뷰가 적용한 **판정 기준**. 숫자는 문장이 아니라 여기로 나간다.
 *
 * 왜 나눴나: `note_stalled_threshold` 문장에 "여섯 시간" 을 박아 놨더니, 바로 그 위에
 * "상한 숫자를 문장에 넣지 마라(바꿀 때마다 세 로케일 번역이 낡는다)" 고 써 둔 규율과
 * 정면으로 어긋났다. UI 티켓(`pTQuNVOI1MTzwaowegSR`)이 그 모순을 짚었다.
 *
 * 그런데 숫자를 **지우는** 것도 답이 아니다 — "일정 시간" 은 오너가 '정체' 배지를
 * 얼마나 심각하게 볼지 판단할 근거를 뺏는다. 그래서 문장에서는 빼고 **값으로** 준다:
 * 화면이 로케일 문장에 끼워 넣으면 번역이 낡지 않고 숫자는 항상 맞다.
 *
 * ★값의 출처는 `projectAudit.STALLED_AFTER_MS` **그 자체**다. 판정에 쓰는 상수와
 * 화면에 말하는 숫자가 갈라질 자리를 만들지 않는다.
 */
export interface TeamAuditCriteria {
  /** '정체' 판정 임계 — 이 시간 동안 기록이 없으면 정체로 본다. */
  stalledAfterHours: number;
}

/**
 * 즉시 손이 필요한 판정 종류. ★`projectAudit` 의 같은 이름 상수와 **같은 값**이어야
 * 한다(그쪽은 export 되지 않는다). 갈라지면 배지 색이 두 화면에서 달라진다 —
 * 테스트가 매퍼 결과와 대조해 그 사실을 잡는다.
 */
const CRITICAL_ATTENTION_KINDS: ReadonlySet<AttentionKind> = new Set([
  "taskFailed",
  "failedActions",
  "orphanedClaim",
]);

export const TEAM_AUDIT_CRITERIA: TeamAuditCriteria = {
  stalledAfterHours: STALLED_AFTER_MS / (60 * 60 * 1000),
};

export interface TeamAuditPage {
  limit: number;
  returned: number;
  /** 다음 페이지 커서. 없으면 null. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TeamAuditEnvelope {
  state: TeamAuditState;
  /** ★i18n 키로 써라. 정상(`complete`)이면 null. */
  reasonCode: TeamAuditReasonCode | null;
  /** 같은 뜻의 ko 문장. 정상이면 null. */
  reason: string | null;
  scope: TeamAuditScope;
  /** `none` 이면 null — 역할이 없다는 사실 이상은 말하지 않는다. */
  role: Exclude<TeamProjectRole, "none"> | null;
  projectsInScope: number;
  /**
   * 프로젝트 목록이 상한에서 잘렸나.
   *
   * ★**개수를 세지 않고 boolean 으로 둔다.** Firestore 는 "몇 개가 더 있었는지" 를
   * 알려주지 않으므로, 정확히 모르는 숫자를 응답에 실으면 화면이 그 숫자를 사실로
   * 그린다. `projectsInScope` 는 **하한**이고 이 깃발이 그 사실을 말한다.
   */
  projectsTruncated: boolean;
  /** ★라벨 없는 목록 금지 — 이 피드가 무엇으로 만들어졌는지 항상 실린다. */
  basis: "project_event_ledger";
}

/** 셀렉터용 프로젝트 한 줄. ★호출자가 역할을 가진 것만 담긴다. */
export interface TeamAuditProjectRef {
  id: string;
  name: string | null;
  role: Exclude<TeamProjectRole, "none">;
}

export interface TeamProjectAuditResult {
  generatedAt: string;
  projectId: string | null;
  projects: TeamAuditProjectRef[];
  teamAudit: TeamAuditEnvelope;
  page: TeamAuditPage;
  /** ★판정 기준값. 화면이 로케일 문장에 끼워 넣는다(§12.5.1). */
  criteria: TeamAuditCriteria;
  summary: TeamAuditSummary;
  events: TeamAuditEvent[];
  tickets: TeamAuditTicket[];
  attention: TeamAuditTicket[];
  missions: TeamAuditMission[];
  workload: TeamAuditWorkloadRow[];
  /**
   * ★이 응답이 **일부러 빼고 있는 것**의 목록. 화면이 그대로 그린다.
   *
   * 문서에만 적으면 잃어버린다 — 응답이 스스로 말하게 하면 화면이 "이 화면은
   * 전부가 아니다" 를 사용자에게 전달할 수 있고, 계약이 바뀌면 여기가 먼저 깨진다.
   */
  withheld: TeamAuditNote[];
  notes: TeamAuditNote[];
}

/**
 * 화면에 그려지는 한 줄. `getTeamUsageSummary` 의 `{…Code, …}` 쌍과 **같은 규약**이다
 * (형제 티켓 `lt9w8LucYFpSbaEzTsgG` / `docs/team-usage-summary-contract-2026-08-21.md`).
 *
 * - `code` — 안정 식별자. ★화면은 **이걸 i18n 키로** 쓴다. ko·en·ja 세 로케일이
 *   있으므로 문장만 주면 en/ja 화면이 한국어를 그린다.
 * - `text` — 같은 뜻의 ko 문장. 키가 아직 없을 때의 폴백.
 *
 * ★**모든 note 가 코드를 갖는다.** 매퍼(`projectAudit.ts`)의 note 를 그대로 흘리지
 * 않기 때문이다 — 그 문장들은 **어드민 뷰 기준**이라 팀 뷰에서는 거짓이 된다.
 * 실제로 매퍼는 "지시문은 scrub 된 요약만 표시한다" 고 말하는데, 팀 응답은 지시문을
 * **아예 싣지 않는다.** 그 문장을 흘리면 응답이 스스로 거짓말한다. 그래서 매퍼 note 는
 * 버리고, 팀 뷰에서 참인 사실만 아래 코드로 다시 만든다.
 */
export interface TeamAuditNote {
  code: TeamAuditNoteCode;
  text: string;
}

/** ★안 보여주기로 한 것의 안정 식별자. 지우지 마라 — 프론트 번역이 조용히 빈다. */
export type TeamAuditWithheldCode =
  | "withheld_tool_params"
  | "withheld_instruction"
  | "withheld_tool_result"
  | "withheld_activity_body"
  | "withheld_personal_tool_calls"
  | "withheld_escalation"
  | "withheld_mission_goal"
  | "withheld_repo_path"
  | "withheld_money"
  | "withheld_raw_identity";

/** 그 외 응답 note 의 안정 식별자. */
export type TeamAuditRuntimeNoteCode =
  | "note_read_only"
  | "note_allowlist_only"
  | "note_self_scope"
  | "note_self_scope_board_is_project_wide"
  | "note_merge_actor_absent"
  | "note_merge_actor_absent_self"
  // 콜러블(index.ts)이 Firestore 실측 뒤에 붙이는 것. ★코드는 여기가 소유한다 —
  // 문장을 호출부에 흩어두면 i18n 키가 코드베이스 두 군데로 갈라진다.
  | "note_member_key_unavailable"
  | "note_event_scan_truncated"
  // 매퍼 note 를 흘리는 대신 팀 뷰에서 **참인** 사실만 다시 만든 것.
  | "note_orphan_claim_unknown"
  | "note_stalled_threshold"
  // ★조용한 절단 금지 — 자르는 건 정당해도 자른 사실을 숨기는 건 아니다.
  | "note_agents_truncated"
  | "note_projects_truncated"
  | "note_stalled_unknown_for_some";

export type TeamAuditNoteCode =
  | TeamAuditWithheldCode
  | TeamAuditRuntimeNoteCode;

/**
 * ★안 보여주기로 한 것 — 응답에 그대로 실린다.
 *
 * ★이 목록은 설계 doc §12.3 의 표와 **한 몸**이다. 한쪽만 고치면 계약이 갈라진다.
 */
export const TEAM_AUDIT_WITHHELD: ReadonlyArray<{
  code: TeamAuditWithheldCode;
  text: string;
}> = [
  {
    code: "withheld_tool_params",
    text: "에이전트가 도구에 넘긴 입력값 — 비밀 키가 섞여 들어올 수 있고, 기록은 한 번 남으면 지울 수 없습니다.",
  },
  {
    code: "withheld_instruction",
    text: "에이전트에게 준 지시문 — 민감한 부분을 가린 형태라도 지시문 자체는 싣지 않습니다.",
  },
  {
    code: "withheld_tool_result",
    text: "도구 실행 결과 — 코드나 파일 내용이 그대로 들어올 수 있습니다.",
  },
  {
    code: "withheld_activity_body",
    text: "에이전트가 남긴 진행 기록의 본문 — 코드·경로·오류 내용이 그대로 들어옵니다.",
  },
  {
    code: "withheld_personal_tool_calls",
    text: "명령 실행, 파일 접근, 열람·검색, 보고·질문 기록 — 팀이 함께 쓰는 산출물이 아니라 개인의 작업 방식입니다.",
  },
  {
    code: "withheld_escalation",
    text: "더 큰 모델을 쓰겠다는 요청과 승인 기록 — 개인의 업무 평가에 해당합니다.",
  },
  {
    code: "withheld_mission_goal",
    text: "미션에 적은 목표 문장 — 사람이 직접 쓴 지시문입니다.",
  },
  {
    code: "withheld_repo_path",
    text: "저장소가 놓인 기기의 폴더 경로 — 다른 사람의 컴퓨터 경로입니다.",
  },
  {
    code: "withheld_money",
    text: "금액과 토큰 수치 전부 — 사용량 탭에서만 볼 수 있습니다.",
  },
  {
    code: "withheld_raw_identity",
    text: "구성원의 계정 식별자·이메일·표시 이름 — 활동한 사람은 팀 전용 가명으로만 표시됩니다.",
  },
];

/**
 * 런타임 note 문장. ★`Record<Code, string>` 이라 **코드만 늘리고 문장을 빼먹으면
 * 타입이 잡는다** (형제 티켓의 `TEAM_USAGE_NOTE_TEXT_KO` 와 같은 장치).
 */
export const TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO: Readonly<
  Record<TeamAuditRuntimeNoteCode, string>
> = {
  note_read_only: "이 화면은 기록을 읽기만 합니다 — 여기서는 아무것도 바꾸거나 지우지 않습니다.",
  note_allowlist_only: WITHHELD_TOOL_NOTE,
  note_self_scope:
    "본인 활동만 표시됩니다. 다른 구성원의 기록은 이 목록에 포함되지 않습니다.",
  note_self_scope_board_is_project_wide:
    "티켓·미션·에이전트 현황은 프로젝트 전체 값입니다. 공유 보드에서 이미 보이는 정보이며, 본인 범위로 좁혀지는 것은 활동 목록입니다.",
  note_merge_actor_absent:
    "일부 머지 기록에는 수행한 사람이 남아 있지 않아 '알 수 없음' 으로 표시됩니다.",
  note_merge_actor_absent_self:
    "수행한 사람이 남아 있지 않은 머지 기록은 본인 활동에 포함되지 않습니다.",
  // ★원인을 "서버 설정 문제" 라고 쓰지 않는다 — 구현 어휘다. 그렇다고 "설정 문제"
  //   로만 줄이면 오너가 **자기 설정**을 뒤지러 간다. 원인을 말하지 말고 **오너가
  //   할 수 있는 것**으로 끝낸다. 그 문장이 "당신이 고칠 일이 아니다" 까지 전한다.
  note_member_key_unavailable:
    "활동한 사람을 표시할 수 없습니다. 활동 기록 자체는 정상이며, 문제가 계속되면 지원팀에 알려 주세요.",
  // ★상한 숫자를 문장에 넣지 않는다. 넣으면 상한을 바꿀 때마다 세 로케일 번역이
  //   전부 낡는다. "얼마나 잘렸나" 는 envelope 의 state/reasonCode 가 말한다.
  note_event_scan_truncated:
    "최근 활동만 불러왔습니다 — 더 오래된 활동은 이 화면에 없습니다.",
  note_orphan_claim_unknown:
    "에이전트 현황을 불러오지 못해 '담당자 없는 티켓' 확인을 건너뛰었습니다. 그런 티켓이 없다는 뜻은 아닙니다.",
  note_agents_truncated:
    "에이전트가 많아 일부만 불러왔습니다. 에이전트 현황과 '담당자 없는 티켓' 확인은 그 표본 기준입니다.",
  // ★"모른다" 를 "정체" 로 말하지 않는다 — 그 라벨은 사람에 대한 판단으로 읽힌다.
  note_stalled_unknown_for_some:
    "티켓이 많아 최근 활동 일부만 확인했습니다. 확인하지 못한 티켓에는 '정체' 를 표시하지 않았습니다 — 정체가 아니라는 뜻은 아닙니다.",
  note_projects_truncated:
    "프로젝트가 많아 목록 일부만 불러왔습니다. 여기 없는 프로젝트도 있을 수 있습니다.",
  note_stalled_threshold:
    "'정체' 는 일정 시간 동안 아무 기록이 없는 진행 중 티켓에만 표시됩니다. 완료·보관·삭제된 티켓은 주의 목록에 오르지 않습니다.",
};

/** 런타임 note 한 줄을 만든다. 코드와 문장이 갈라질 자리를 없앤다. */
export function runtimeNote(code: TeamAuditRuntimeNoteCode): TeamAuditNote {
  return { code, text: TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO[code] };
}

// ── 커서 (페이징) ────────────────────────────────────────────────────────────

/**
 * 커서는 `(atMs, id)` 키셋이다. 오프셋을 쓰지 않는 이유: 감사 원장은 조회 중에도
 * 계속 늘어나므로 오프셋 페이징은 행을 건너뛰거나 중복시킨다 — 감사에서 조용한
 * 누락은 가장 나쁜 실패다.
 *
 * ★시각을 못 읽은 행은 `atMs: null` 이고 정렬에서 맨 뒤로 간다. 커서에서는
 * `NULL_AT_SORT_KEY`(-1)로 표현한다 — 0(1970)으로 접으면 손상된 행이 1970년
 * 어딘가로 섞여 페이지 경계가 흔들린다.
 */
export const NULL_AT_SORT_KEY = -1;

export interface TeamAuditCursor {
  at: number;
  id: string;
}

/** 정렬 키 — null 시각을 맨 뒤로 보내는 sentinel 로 접는다. */
export function sortKeyOf(atMs: number | null): number {
  return atMs == null ? NULL_AT_SORT_KEY : atMs;
}

/** 사건 정렬: 최신순, 같은 시각이면 id 오름차순(전순서 보장 → 커서가 안전하다). */
export function compareEventsDesc(
  a: TeamAuditEvent,
  b: TeamAuditEvent
): number {
  const ka = sortKeyOf(a.atMs);
  const kb = sortKeyOf(b.atMs);
  if (ka !== kb) return kb - ka;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function encodeAuditCursor(cursor: TeamAuditCursor): string {
  return Buffer.from(
    JSON.stringify({ at: cursor.at, id: cursor.id }),
    "utf8"
  ).toString("base64url");
}

/**
 * 커서를 푼다. 못 풀면 null.
 *
 * ★호출측은 null 을 "커서 없음(1페이지)" 으로 접지 말고 `invalid-argument` 로
 * 되돌려라. 조용히 1페이지를 돌려주면 화면이 같은 페이지를 무한히 돈다.
 */
export function decodeAuditCursor(raw: unknown): TeamAuditCursor | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as { at?: unknown; id?: unknown };
    if (typeof obj.at !== "number" || !Number.isFinite(obj.at)) return null;
    if (typeof obj.id !== "string" || obj.id === "") return null;
    return { at: obj.at, id: obj.id };
  } catch {
    return null;
  }
}

/** 커서 **뒤에** 오는 행인가(최신순 기준). 커서가 없으면 전부 통과. */
export function isAfterCursor(
  event: TeamAuditEvent,
  cursor: TeamAuditCursor | null
): boolean {
  if (!cursor) return true;
  const key = sortKeyOf(event.atMs);
  if (key !== cursor.at) return key < cursor.at;
  return event.id > cursor.id;
}

// ── 입력 ─────────────────────────────────────────────────────────────────────

/** 원장 행에서 사건을 만들 때 필요한 최소 사실(Firestore raw 에서 뽑아 넘긴다). */
export interface LedgerEventInput {
  id: string;
  toolName: unknown;
  atMs: number | null;
  taskId: string | null;
  agentId: string | null;
  /** ★원시 uid. **여기서 가명으로 바꿔 나가고, 절대 응답에 실리지 않는다.** */
  actorUid: string | null;
  success: boolean | null;
}

/** `merge_history` 행에서 뽑은 사실. ★`repoRoot` 는 **의도적으로 없다**. */
export interface MergeEventInput {
  id: string;
  atMs: number | null;
  taskId: string | null;
  branch: string | null;
  prNumber: number | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
}

export interface NarrowTeamAuditInput {
  /** `projectAudit.buildProjectAudit` 의 결과 — ★매퍼를 재사용한다(설계 §3.2). */
  base: ProjectAuditResult;
  ledger: ReadonlyArray<LedgerEventInput>;
  merges: ReadonlyArray<MergeEventInput>;
  scope: TeamAuditScope;
  role: Exclude<TeamProjectRole, "none">;
  projects: ReadonlyArray<TeamAuditProjectRef>;
  /**
   * uid → 팀 전용 가명(`tm_…`). 못 만들면 null 을 돌려라(솔트 부재 등).
   * ★원시 uid 를 폴백으로 돌려주면 안 된다 — 그건 조용히 약속을 깨는 길이다.
   */
  memberKeyOf: (uid: string) => string | null;
  /** `scope === "self"` 일 때 남길 가명. 못 만들었으면 null → 0건(fail-closed). */
  selfMemberKey: string | null;
  limit: number;
  cursor: TeamAuditCursor | null;
  /** 소스 중 하나라도 못 읽었나 → `partial`. */
  sourcesIncomplete: boolean;
  /** 스캔 상한에서 잘렸나 → `partial`. */
  scanTruncated: boolean;
  /**
   * ★에이전트 목록이 상한에서 잘렸나. 잘렸으면 호출측이 `agentsLoaded: false` 로
   * 넘겨 '주인 없는 클레임' 판정을 **생략**해야 한다 — 잘린 목록으로 판정하면
   * 상한 밖 에이전트가 물고 있는 티켓이 전부 거짓 경보로 뜬다.
   * 이 깃발은 그 사실을 **화면에 말하기 위한** 것이다(판정 생략과는 별개).
   */
  agentsTruncated: boolean;
  /** 프로젝트 셀렉터가 상한에서 잘렸나. */
  projectsTruncated: boolean;
  /**
   * ★활동을 실제로 훑은 티켓 id 집합. `null` 이면 **전부 훑었다**(상한 미도달).
   *
   * 왜 필요한가: 매퍼의 '정체' 판정은 "마지막 기록 시각" 을 쓰는데, 활동을 안 읽은
   * 티켓은 그 값이 `task.updatedAt` 으로 **폴백**된다. 그런데 활동 스캔은 최근 갱신순
   * 상위 N건만 보므로, **잘려 나가는 건 정확히 `updatedAt` 이 오래된 티켓들**이다 —
   * 즉 6시간 임계를 넘길 후보들이다. 에이전트가 활동을 쓰고 있어도 그 활동을 안
   * 읽었으면 "정체" 로 찍힌다.
   *
   * ★그 라벨은 오너에게 **"이 사람 일이 멈췄다"** 로 읽힌다. 절단 부작용이 사람에
   * 대한 판단으로 번역되는 자리라, 모르면 **판정하지 않는다.**
   * (형제 티켓 `lt9w8LucYFpSbaEzTsgG` 의 `hasRows: null` 과 같은 판단이다.)
   */
  activityScannedTaskIds: ReadonlySet<string> | null;
  /**
   * 에이전트 목록을 실제로 읽었나. false 면 매퍼가 '주인 없는 클레임' 판정을
   * 생략했다는 뜻이라, 화면이 그 사실을 알아야 `attention` 을 과신하지 않는다.
   */
  agentsLoaded: boolean;
  nowMs: number;
}

export const DEFAULT_TEAM_AUDIT_LIMIT = 50;
export const MAX_TEAM_AUDIT_LIMIT = 200;

/** 페이지 크기 정규화. 범위 밖이면 조용히 접는다(던지지 않는다). */
export function normalizeLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TEAM_AUDIT_LIMIT;
  return Math.min(MAX_TEAM_AUDIT_LIMIT, n);
}

// ── 좁히기 ───────────────────────────────────────────────────────────────────

function emptyEventsByKind(): Record<TeamAuditEventKind, number> {
  return {
    task_create: 0,
    task_transition: 0,
    merge: 0,
    agent_spawn: 0,
    flow_change: 0,
  };
}

/**
 * 권한 없음 응답. ★프로젝트 존재 여부를 말하지 않는다 — 없는 프로젝트와 남의
 * 프로젝트가 **구분되지 않는** 같은 응답이어야 열람 시도가 존재 탐지가 되지 않는다
 * (설계 §5.3).
 */
export function deniedTeamAudit(
  nowMs: number,
  reasonCode: "no_role" | "no_project" = "no_role"
): TeamProjectAuditResult {
  return {
    generatedAt: new Date(nowMs).toISOString(),
    projectId: null,
    projects: [],
    teamAudit: {
      state: "disabled",
      reasonCode,
      reason: reasonTextFor(reasonCode),
      // 스코프는 가장 좁은 값으로 고정한다 — 닫힌 응답이 넓은 스코프를 주장하지 않는다.
      scope: "self",
      role: null,
      projectsInScope: 0,
      projectsTruncated: false,
      basis: "project_event_ledger",
    },
    page: {
      limit: DEFAULT_TEAM_AUDIT_LIMIT,
      returned: 0,
      nextCursor: null,
      hasMore: false,
    },
    criteria: { ...TEAM_AUDIT_CRITERIA },
    summary: {
      eventsInWindow: 0,
      eventsByKind: emptyEventsByKind(),
      tasksTotal: 0,
      tasksOpen: 0,
      tasksDone: 0,
      tasksByStatus: {},
      attentionCount: 0,
      criticalCount: 0,
      agentsTotal: 0,
      missionsTotal: 0,
      missionsActive: 0,
    },
    events: [],
    tickets: [],
    attention: [],
    missions: [],
    workload: [],
    withheld: [...TEAM_AUDIT_WITHHELD],
    notes: [],
  };
}

// ── ★값 수준 신원 스크럽 ─────────────────────────────────────────────────────
//
// `findForbiddenKeys` 는 **키**를 본다. 그런데 이 응답에는 사람이 자유롭게 지은
// 문자열이 몇 개 실린다 — `claimedBy` · `workload[].name` · `agentId` 다.
// 에이전트 이름은 `spawn_agent` 의 `name: z.string()`(tools.ts:4243)이라 무엇이든
// 들어갈 수 있고, `claimedBy` 는 **id 일 수도 이름일 수도 있다**
// (`projectAudit.ts:157` 주석). 즉 누군가 에이전트를 자기 이메일로 이름 지으면
// 키 스캐너를 그대로 통과해 응답에 실린다.
//
// ★이 티켓의 경계가 "원시 uid·이메일을 응답 어디에도 넣지 마라" 이므로 값도 본다.
//   (UI 티켓 `pTQuNVOI1MTzwaowegSR` 이 렌더 경계에서 같은 방어를 한다 — 이건 그
//   이중 방어의 서버 쪽이다. 화면 하나가 막는 것과 응답이 안 싣는 것은 다르다:
//   응답은 화면 말고도 갈 데가 있다.)

/** 가려진 값의 자리표시. 화면이 "이름이 없다"(null)와 구분할 수 있게 빈 값이 아니다. */
export const REDACTED_IDENTITY = "(가려짐)";

/**
 * 이메일 — 명확하다. 이 티켓이 이름으로 지목한 값이다.
 *
 * ★**팩토리다. 모듈 상수가 아니다.** `g` 플래그 정규식은 `lastIndex` 를 들고 다니고,
 * 모듈 상수로 두면 그 상태가 **호출 사이에 살아남는다.** 지금은 `String.replace` 가
 * 스펙상 되감아 줘서 안전하지만 그건 **우연**이다 — 다음 사람이 방어 삼아
 * `if (emailRe.test(v))` 한 줄을 앞에 넣으면 상태가 섞이고, 그 실패는 **예외도 안 나고
 * 값만 틀린다**(두 번째 호출이 조용히 못 잡는다).
 *
 * `lastIndex = 0` 을 명시하는 것으로도 막을 수 있지만, 그건 **호출 순서를 사람이 계속
 * 맞게 유지해야** 성립한다 — 리팩터링 한 번이면 그 줄이 조기 반환 뒤로 밀리거나 새
 * 진입점이 그 줄을 안 지난다. 매 호출 새로 만들면 그 실수가 **불가능**해진다.
 * 호출 수는 응답당 티켓·에이전트 수 정도라 비용이 무의미하다.
 * (형제 티켓 `lt9w8LucYFpSbaEzTsgG` 가 같은 결론에 닿았다.)
 *
 * ★TLD 를 글자로만 잡는다. `[^\s@]+` 로 두면 "a@x.com, b@y.com" 에서 첫 매치가
 * 쉼표까지 삼켜 구분자가 사라진다(테스트가 잡았다).
 *
 * ★매치된 **부분만** 바꾼다. 문자열 전체를 버리면 `backend-auth <ops@corp.com>` 이
 * 통째로 `(가려짐)` 이 되어 **어느 에이전트인지도 못 읽게 된다** — 가릴 이유가 없는
 * 절반까지 가리는 것은 과잉 차단이다.
 */
const emailLikeRe = (): RegExp => /[^\s@<>,;()[\]]+@[^\s@<>,;()[\]]+\.[A-Za-z]{2,}/g;

/**
 * Firebase uid 모양 — 정확히 28자 영숫자에 대문자·소문자·숫자가 모두 섞인 것.
 *
 * ★일부러 좁게 잡았다. `backend-1` 같은 실제 에이전트 이름은 하이픈이 있거나 28자가
 * 아니라 안 걸린다. 넓게 잡으면 워크로드 표가 전부 `(가려짐)` 이 되어 못 읽는다 —
 * **과잉 차단도 화면을 거짓말하게 만든다.**
 *
 * ★문자열 **전체**가 uid 일 때만 본다(`^…$`). 부분 일치를 허용하면 28자 토막을 품은
 * 멀쩡한 이름이 잘려 나간다. 위와 같은 이유로 팩토리로 둔다.
 */
const uidLikeRe = (): RegExp =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{28}$/;

/**
 * 사람이 지은 문자열에서 신원처럼 보이는 값을 가린다. 아니면 그대로 통과.
 *
 * - 이메일: **그 부분만** 바꾼다(위 주석). 문자열 전체가 이메일이면 결과도 전체가 된다.
 * - uid 모양: 문자열 **전체**가 uid 일 때만 바꾼다. 부분 일치를 허용하면 28자 토막을
 *   품은 멀쩡한 이름이 잘려 나간다.
 */
export function scrubIdentityLike(v: string | null): string | null {
  if (v === null) return null;
  if (uidLikeRe().test(v)) return REDACTED_IDENTITY;
  return v.replace(emailLikeRe(), REDACTED_IDENTITY);
}

/** 원장 행 → 사건. 허용목록 밖이거나 분류 불가면 null(= 안 싣는다). */
export function toTeamAuditEvent(
  row: LedgerEventInput,
  taskTitleById: ReadonlyMap<string, string | null>,
  memberKeyOf: (uid: string) => string | null
): TeamAuditEvent | null {
  const kind = eventKindForTool(row.toolName);
  if (kind === null) return null;
  return {
    id: `ledger:${row.id}`,
    kind,
    action: row.toolName as string,
    at: row.atMs == null ? null : new Date(row.atMs).toISOString(),
    atMs: row.atMs,
    taskId: row.taskId,
    taskTitle: row.taskId ? taskTitleById.get(row.taskId) ?? null : null,
    // ★여기가 원시 uid 가 응답 경계를 넘지 못하게 막는 유일한 지점이다.
    memberKey: row.actorUid ? memberKeyOf(row.actorUid) : null,
    agentId: scrubIdentityLike(row.agentId),
    success: row.success,
    merge: null,
  };
}

/**
 * `merge_history` 행 → 사건.
 *
 * ★`memberKey` 는 **항상 null** 이다. 그 문서에 행위자 필드가 아예 없기 때문이다
 * (`electron/main.ts:3603`). "모른다" 를 아무 값으로도 메우지 않는다 — 머지의
 * 사람을 알고 싶으면 `merge_and_close` 원장 행을 봐야 하고, 그 사실은 notes 에 밝힌다.
 */
export function toMergeAuditEvent(
  row: MergeEventInput,
  taskTitleById: ReadonlyMap<string, string | null>
): TeamAuditEvent {
  return {
    id: `merge:${row.id}`,
    kind: "merge",
    action: "merge_history",
    at: row.atMs == null ? null : new Date(row.atMs).toISOString(),
    atMs: row.atMs,
    taskId: row.taskId,
    taskTitle: row.taskId ? taskTitleById.get(row.taskId) ?? null : null,
    memberKey: null,
    agentId: null,
    success: null,
    merge: {
      branch: row.branch,
      prNumber: row.prNumber,
      filesChanged: row.filesChanged,
      linesAdded: row.linesAdded,
      linesDeleted: row.linesDeleted,
    },
  };
}

/**
 * ★팀 경계를 강제하는 유일한 지점.
 *
 * `buildProjectAudit`(운영자 뷰) 결과를 받아 팀 응답으로 **좁힌다**. 넓히는 경로는
 * 없다 — 이 함수를 거치지 않고 매퍼 결과가 팀 응답에 실릴 길을 만들지 마라.
 */
export function narrowAuditForTeam(
  input: NarrowTeamAuditInput
): TeamProjectAuditResult {
  const {
    base,
    scope,
    role,
    projects,
    memberKeyOf,
    selfMemberKey,
    cursor,
    nowMs,
  } = input;
  const limit = normalizeLimit(input.limit);
  const notes: TeamAuditNote[] = [];

  const taskTitleById = new Map<string, string | null>(
    base.tickets.map((t) => [t.id, t.title])
  );

  // ── 사건 조립: 허용목록을 통과한 원장 행 + merge_history 행 ──
  const events: TeamAuditEvent[] = [];
  for (const row of input.ledger) {
    const ev = toTeamAuditEvent(row, taskTitleById, memberKeyOf);
    if (ev) events.push(ev);
  }
  for (const row of input.merges) {
    events.push(toMergeAuditEvent(row, taskTitleById));
  }

  // ── ★self 스코프: 남의 행을 서버가 거른다 ──
  //   가명을 못 만들었으면(솔트 부재) 0건으로 닫는다 — 열어두는 쪽으로 실패하지 않는다.
  let scoped = events;
  let selfUnattributable = false;
  if (scope === "self") {
    if (!selfMemberKey) {
      selfUnattributable = true;
      scoped = [];
    } else {
      scoped = events.filter((e) => e.memberKey === selfMemberKey);
      if (input.merges.length > 0) {
        notes.push(runtimeNote("note_merge_actor_absent_self"));
      }
    }
  } else if (input.merges.length > 0) {
    notes.push(runtimeNote("note_merge_actor_absent"));
  }

  scoped.sort(compareEventsDesc);

  // ── 요약은 **페이지가 아니라 창** 기준이다(페이지마다 총계가 달라지면 안 된다) ──
  const eventsByKind = emptyEventsByKind();
  for (const e of scoped) eventsByKind[e.kind] += 1;

  // ── 페이징(키셋) ──
  const afterCursor = scoped.filter((e) => isAfterCursor(e, cursor));
  const pageRows = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > pageRows.length;
  const last = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
  const nextCursor =
    hasMore && last
      ? encodeAuditCursor({ at: sortKeyOf(last.atMs), id: last.id })
      : null;

  // ── 티켓·미션·워크로드: 금액과 자유 텍스트를 뺀 형태로 옮긴다 ──
  // ★`claimedBy` 는 자유 문자열이다(id 일 수도 이름일 수도 있다) — 값을 훑는다.
  const scrubTicket = (t: AuditTicket): AuditTicket =>
    t.claimedBy === null
      ? t
      : { ...t, claimedBy: scrubIdentityLike(t.claimedBy) };

  // ★활동을 안 읽은 티켓에서는 '정체' 판정을 뗀다(위 activityScannedTaskIds 주석).
  const scanned = input.activityScannedTaskIds;
  // ★note 와 `stalledJudged` 는 **같은 하나의 사실**을 말한다: "이 티켓의 활동을 다
  //   읽었나". 그래서 note 를 "실제로 stalled 를 뗐을 때" 가 아니라 **"안 읽은 티켓이
  //   하나라도 있을 때"** 로 낸다.
  //
  //   ★고치기 전에는 **덜 말하고 있었다**: 안 읽은 티켓이 있어도 그중 정체 후보가
  //   없으면 note 가 안 나갔다. 그러면 화면은 `stalledJudged: false` 인 티켓을 보면서
  //   **왜 그런지 설명하는 문장은 못 받는다.** 안 읽었으면 정체 여부를 모르는 건
  //   마찬가지이고, "몰랐다" 는 사실은 결과가 어떻든 같다.
  //
  //   ★이렇게 두면 둘이 **갈라질 자리가 없다**: note 있음 ⟺ `stalledJudged:false` 존재.
  //   (UI 티켓 `pTQuNVOI1MTzwaowegSR` 이 "출처가 둘이면 갈라진다" 를 지적했고, 답은
  //   출처를 없애는 게 아니라 **같은 술어에서 나오게** 하는 것이었다.)
  let anyUnjudged = false;
  const judged = (id: string): boolean => scanned === null || scanned.has(id);
  const dropUnknownStalled = (t: TeamAuditTicket): TeamAuditTicket => {
    if (judged(t.id)) return t;
    if (t.attention === null) return t;
    if (!t.attention.kinds.includes("stalled")) return t;
    const kinds = t.attention.kinds.filter((k) => k !== "stalled");
    if (kinds.length === 0) return { ...t, attention: null };
    return {
      ...t,
      attention: {
        kinds,
        // 남은 종류로 심각도를 **다시 계산**한다 — 원래 값을 들고 있으면
        // 사라진 근거로 critical 배지가 남는다.
        severity: kinds.some((k) => CRITICAL_ATTENTION_KINDS.has(k))
          ? "critical"
          : "warning",
        idleMs: null,
      },
    };
  };
  const narrowTicket = (t: AuditTicket): TeamAuditTicket => {
    const stalledJudged = judged(t.id);
    if (!stalledJudged) anyUnjudged = true;
    return dropUnknownStalled({ ...scrubTicket(t), stalledJudged });
  };

  const tickets: TeamAuditTicket[] = base.tickets.map(narrowTicket);
  // ★주의 목록은 다시 거른다 — 판정이 떨어져 나간 티켓은 여기 남으면 안 된다.
  const attention: TeamAuditTicket[] = base.attention
    .map(narrowTicket)
    .filter((t) => t.attention !== null);
  const missions: TeamAuditMission[] = base.missions.map((m) => ({
    // ★`goal` 을 옮기지 않는다 — 사람이 친 지시문이다.
    id: m.id,
    status: m.status,
    taskCount: m.taskCount,
    doneCount: m.doneCount,
    statusCounts: m.statusCounts,
    updatedAt: m.updatedAt,
  }));
  const workload: TeamAuditWorkloadRow[] = base.workload.map((w) => ({
    // ★`totalCost` 를 옮기지 않는다 — 돈은 사용량 탭의 게이트로만 나간다.
    // ★에이전트 이름은 사람이 자유롭게 짓는다(spawn_agent 의 name: z.string()).
    agentId: scrubIdentityLike(w.agentId) ?? REDACTED_IDENTITY,
    name: scrubIdentityLike(w.name),
    model: w.model,
    role: w.role,
    status: w.status,
    currentTaskId: w.currentTaskId,
    openTasks: w.openTasks,
    doneTasks: w.doneTasks,
  }));

  // ── 봉투 상태 ──
  let state: TeamAuditState;
  let reasonCode: TeamAuditReasonCode | null;
  if (selfUnattributable) {
    // ★이건 진짜 0 이다 — 가명을 못 만들어 **의도적으로 닫았다.** 소스 건강과 무관하게
    //   서버가 스스로 0 건으로 만든 것이므로 "0 건" 이라고 말해도 거짓이 아니다.
    state = "empty";
    reasonCode = "self_scope_unattributable";
  } else if (input.sourcesIncomplete) {
    // ★소스를 못 읽었으면 **행 수와 무관하게** `partial` 이다.
    //
    //   전에는 `scoped.length === 0` 을 먼저 봐서, 사건 쿼리가 통째로 실패했는데도
    //   `state: "empty"` 가 나갔다. **`empty` 는 "사건이 0 건이다" 라는 적극적 주장**
    //   인데(§12.5), 못 읽었을 때 우리가 아는 건 0 이 아니라 **아무것도 없다.**
    //   내가 §12.5.2 에 "'모름' 을 '없음' 으로 접지 않는다" 고 써 놓고 봉투 상태
    //   기계에서 그걸 하고 있었다.
    //
    //   ★특히 위험한 실패 모드: 색인이 없으면 Firestore 가 FAILED_PRECONDITION 을
    //   내는데 `auditQuery` 가 그걸 빈 배열로 삼킨다 — 즉 **완전 실패가 "사건 없음"
    //   으로 위장**된다. 화면은 봉투 밖에서 그 둘을 구분할 방법이 없다(UI 티켓
    //   `pTQuNVOI1MTzwaowegSR` 지적). `partial` 로 나가야 화면의 정직성 규칙이 닿는다.
    state = "partial";
    reasonCode = "partial_sources";
  } else if (scoped.length === 0) {
    // 여기 오면 소스는 다 읽었다 — 그러니 "0 건" 은 참이다.
    state = "empty";
    reasonCode = "no_events";
  } else if (input.scanTruncated) {
    state = "partial";
    reasonCode = "scan_truncated";
  } else {
    state = "complete";
    reasonCode = null;
  }

  // ★매퍼 note 를 **흘리지 않는다**(위 TeamAuditNote 주석의 근거). 팀 뷰에서 참인
  //   사실만 코드로 다시 만든다.
  notes.push(
    runtimeNote("note_read_only"),
    runtimeNote("note_allowlist_only"),
    runtimeNote("note_stalled_threshold")
  );
  if (!input.agentsLoaded) notes.push(runtimeNote("note_orphan_claim_unknown"));
  // ★자른 사실을 숨기지 않는다. 자르는 것 자체는 읽기 폭주를 막는 정당한 선택이지만,
  //   자른 걸 숨기면 화면이 표본을 전량으로 말한다.
  if (input.agentsTruncated) notes.push(runtimeNote("note_agents_truncated"));
  if (input.projectsTruncated) {
    notes.push(runtimeNote("note_projects_truncated"));
  }
  if (anyUnjudged) notes.push(runtimeNote("note_stalled_unknown_for_some"));
  if (scope === "self") {
    notes.push(
      runtimeNote("note_self_scope"),
      // ★정직하게 밝힌다: 좁혀지는 것은 **사건 목록**이고, 티켓·미션·에이전트 부하는
      //   프로젝트 전체다. 그 셋은 firestore.rules 상 이미 프로젝트 멤버 누구나
      //   읽을 수 있는 공유 보드 상태라 새 노출이 아니다 — "좁혔다" 고 뭉뚱그리면
      //   화면이 실제보다 좁다고 오해한다.
      runtimeNote("note_self_scope_board_is_project_wide")
    );
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    projectId: base.projectId,
    projects: [...projects],
    teamAudit: {
      state,
      reasonCode,
      reason: reasonCode ? reasonTextFor(reasonCode) : null,
      scope,
      role,
      projectsInScope: projects.length,
      projectsTruncated: input.projectsTruncated,
      basis: "project_event_ledger",
    },
    page: {
      limit,
      returned: pageRows.length,
      nextCursor,
      hasMore,
    },
    criteria: { ...TEAM_AUDIT_CRITERIA },
    summary: {
      eventsInWindow: scoped.length,
      eventsByKind,
      tasksTotal: base.summary.tasksTotal,
      tasksOpen: base.summary.tasksOpen,
      tasksDone: base.summary.tasksDone,
      tasksByStatus: base.summary.tasksByStatus,
      // ★매퍼 값을 그대로 쓰지 않는다 — 위에서 판정을 뗀 티켓이 있으면 숫자가
      //   목록과 어긋난다("주의 3건" 이라 써 놓고 2건만 보이는 화면).
      attentionCount: attention.length,
      criticalCount: attention.filter(
        (t) => t.attention?.severity === "critical"
      ).length,
      // ★목록에서 **유도**한다. 따로 계산하면 언젠가 갈라진다 — 형제 티켓이
      //   `membersWithNoRows` 에서 정확히 그 실패를 겪었다(카운트 1, 목록 2).
      agentsTotal: workload.length,
      missionsTotal: missions.length,
      missionsActive: base.summary.missionsActive,
    },
    events: pageRows,
    tickets,
    attention,
    missions,
    workload,
    withheld: [...TEAM_AUDIT_WITHHELD],
    notes,
  };
}

/**
 * ★계약 검사 — 응답에 금지된 값이 실렸는지 **기계가** 본다.
 *
 * "조심하겠다" 는 근거가 아니다. 테스트가 이 함수를 불러 응답 전체를 훑고, 금지된
 * 키(자유 텍스트·금액·원시 식별자)가 하나라도 있으면 실패시킨다. 매퍼가 새 필드를
 * 늘려도 여기서 걸린다.
 */
export const FORBIDDEN_RESPONSE_KEYS: readonly string[] = [
  // 자유 텍스트 계열
  "params",
  "instruction",
  "instructionRedacted",
  "instructionHash",
  "result",
  "message",
  "text",
  "goal",
  // 경로 계열
  "repoRoot",
  "folderPath",
  "folderPaths",
  "worktreeId",
  // 금액·토큰 계열
  "totalCost",
  "costUsd",
  "cost",
  "inputTokens",
  "outputTokens",
  "tokens",
  // 원시 식별자 계열
  "actorUid",
  "uid",
  "userId",
  "ownerId",
  "email",
  "displayName",
  "members",
];

/**
 * ★스캔에서 제외하는 최상위 가지.
 *
 * `withheld`/`notes` 는 **서버가 쓴 고정 문장**이다(`TEAM_AUDIT_WITHHELD` ·
 * `TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO` · 매퍼의 진단 프로즈). 사용자 데이터가 한 줄도
 * 안 들어간다. 그런데 그 문장들이 담기는 필드 이름이 `text` 이고, `text` 는 금지
 * 키다 — 스캐너를 그대로 돌리면 **"안 보여준다" 고 말하는 문장 자체가** 위반으로
 * 잡힌다. 그래서 이 두 가지만 제외하고, 나머지(데이터 본체)는 전부 훑는다.
 *
 * ★제외를 늘리지 마라. 늘리는 순간 스캐너가 장식이 된다.
 */
export const FORBIDDEN_SCAN_EXEMPT_ROOTS: readonly string[] = [
  "withheld",
  "notes",
];

/** 금지 키를 찾으면 경로 목록을 돌려준다. 비어 있으면 통과. */
export function findForbiddenKeys(
  value: unknown,
  path = "$",
  found: string[] = []
): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, `${path}[${i}]`, found));
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (path === "$" && FORBIDDEN_SCAN_EXEMPT_ROOTS.includes(k)) continue;
      if (FORBIDDEN_RESPONSE_KEYS.includes(k)) found.push(`${path}.${k}`);
      findForbiddenKeys(v, `${path}.${k}`, found);
    }
  }
  return found;
}

/**
 * 응답 어딘가에 원시 uid 가 섞였는지 본다. 가명(`tm_…`)은 24자 hex 라 uid 와
 * 모양이 다르므로, **알고 있는 uid 문자열**을 넣어 문자열 전체를 훑는다.
 */
export function containsRawValue(value: unknown, needle: string): boolean {
  if (needle === "") return false;
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) {
    return value.some((v) => containsRawValue(v, needle));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k.includes(needle) || containsRawValue(v, needle)
    );
  }
  return false;
}

// ── ★사용자 문장 계약 — "문장은 참인데 독자가 틀린" 것을 기계가 잡는다 ─────────
//
// 형제 티켓(`lt9w8LucYFpSbaEzTsgG`)이 자기 봉투에서 이 부류로 4건을 찾았고, 그 경고로
// 이 파일에서도 8건이 나왔다. 실패 모드가 미묘하다: **문장은 전부 사실이었다.**
// 틀린 건 독자다 — `audit_logs` · `merge_and_close` · `repoRoot` 는 엔지니어의 낱말이지
// 팀 오너의 낱말이 아니다. 오너가 보는 화면이 남의 배포 런북처럼 읽히면, 그 화면은
// 제품이 아니라 로그다.
//
// ★그리고 하필 **제일 잘 보이는 자리**가 위험하다. 화면규칙 1 이 `disabled` 일 때
//   `reason` **문장만** 그리라고 하므로, 권한 없는 사람이 보는 화면은 그 한 문장이 전부다.
//
// 운영자에게 필요한 세부(솔트 부재, 스캔 상한, 컬렉션 이름)는 **서버 로그와 이 파일의
// 주석·설계 doc** 에 있다. 응답에 싣지 않는다.

/**
 * 사용자 화면에 나가는 문장 전량.
 *
 * ★세 상수가 사용자 문장의 **유일한** 출처다(둘은 `Record<Code, string>`, 하나는
 * 코드가 붙은 배열). 새 문장은 셋 중 하나에 들어갈 수밖에 없으므로 여기서 새지 않는다.
 */
export function allUserFacingTexts(): Array<{ code: string; text: string }> {
  return [
    ...Object.entries(REASON_TEXT).map(([code, text]) => ({ code, text })),
    ...TEAM_AUDIT_WITHHELD.map((w) => ({ code: w.code as string, text: w.text })),
    ...Object.entries(TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO).map(([code, text]) => ({
      code,
      text,
    })),
  ];
}

/**
 * 사용자 문장에 있으면 안 되는 것. ★줄이지 마라 — 줄이는 만큼 런북이 새어 나간다.
 */
export const OPERATOR_ONLY_PATTERNS: ReadonlyArray<{
  label: string;
  re: RegExp;
}> = [
  // env 키·상수명 (TEAM_USAGE_EFFECTIVE_FROM · ANALYTICS_ID_SALT · 스캔 상한 상수…)
  { label: "env/상수명", re: /[A-Z][A-Z0-9_]{5,}/ },
  // Firestore 컬렉션 · BQ 표 이름
  {
    label: "컬렉션/표 이름",
    re: /audit_logs|merge_history|cost_logs|memberRoles|teamUsageCache|BigQuery|Firestore/,
  },
  // 코드 식별자 · 필드명
  {
    label: "코드 식별자",
    re: /\bparams\b|instructionRedacted|repoRoot|actorUid|totalCost|memberKey|projectId|\btm_|\bnull\b|\buid\b/,
  },
  // MCP 툴 이름
  {
    label: "툴 이름",
    re: /merge_and_close|update_task_status|claim_task|submit_for_review|spawn_agent|create_task|add_activity/,
  },
  // 실행 지시 · 문서 경로 · 파일명
  { label: "런북/경로", re: /npm run|cd v3|docs\/|\.ts\b|§/ },
  // ★한글로 쓴 구현 어휘. 라틴 규칙은 "서버"·"콜러블" 을 못 잡는다 — 한글이니까.
  //   ★목록을 좁게 잡았다. "응답"·"요청"·"필드" 처럼 오너 문장에서도 자연스러울 수
  //   있는 낱말은 넣지 않는다 — 넓은 검사는 멀쩡한 문장을 사람 손으로 고치게 만든다
  //   (형제 티켓 `lt9w8LucYFpSbaEzTsgG` 의 "한 건도" 사례).
  {
    label: "구현 어휘(한글)",
    re: /서버|클라이언트|콜러블|엔드포인트|스키마|쿼리|인덱스|캐시/,
  },
  // ★가장 단순하고 가장 잘 잡는 규칙: **한국어 사용자 문장에 라틴 낱말이 없다.**
  //   위 패턴들은 아는 이름만 잡는다 — 목록에 없는 새 필드명(`criteria`, `withheld`,
  //   `nextCursor` …)은 그대로 통과한다. 실제로 이 규칙을 넣기 직전, 기준 시간을
  //   criteria 로 옮기면서 문장에 "criteria" 를 적어 넣었고 위 다섯 패턴이 전부
  //   놓쳤다. 목록을 늘리는 대신 **화이트리스트가 아니라 문자 종류**로 막는다.
  { label: "라틴 낱말", re: /[A-Za-z]{2,}/ },
];

/** 위반 목록. 비어 있으면 통과. */
export function findOperatorOnlyText(): Array<{
  code: string;
  label: string;
  text: string;
}> {
  const found: Array<{ code: string; label: string; text: string }> = [];
  for (const { code, text } of allUserFacingTexts()) {
    for (const { label, re } of OPERATOR_ONLY_PATTERNS) {
      if (re.test(text)) found.push({ code, label, text });
    }
  }
  return found;
}

/** `Attention` 재노출 — 화면 타입이 매퍼를 직접 import 하지 않게 한다. */
export type { Attention };
