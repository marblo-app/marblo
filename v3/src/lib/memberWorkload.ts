/**
 * 구성원별 작업량 집계 (순수 함수 — firebase/DOM 의존 없음, 유닛테스트 대상).
 *
 * ★ 새 로깅 파이프라인을 만들지 않는다. 이 파일은 앱이 **이미 쓰고 있는** 네
 * 개의 컬렉션만 조인한다:
 *
 *   agents        (projectId 스코프)  — 누가 몇 대를 띄웠나 + 누적 비용
 *   tasks         (projectId 스코프)  — 진행중 / REVIEW / DONE 수
 *   merge_history (projectId 스코프)  — 실제로 랜딩된 코드 (taskId 로 티켓에 붙는다)
 *   users         (project members)   — 표시 이름 + presence heartbeat
 *
 * 사람에 붙이는 사슬은 하나뿐이다:
 *
 *   task.claimedBy → agent → agent.ownerId → 멤버 uid
 *
 * ★ claimedBy 이중키 규칙: 같은 필드에 UI 수동할당은 **agent.name** 을, MCP
 * claim_task 는 **agent.id** 를 쓴다(components/agents/MemberCard 의 동일 주석
 * 참조). 한쪽만 비교하면 다른 경로로 잡힌 티켓이 통째로 사라진다 — 그래서
 * 여기서도 두 키를 모두 본다.
 *
 * ★ 귀속 실패를 조용히 버리지 않는다. 어느 멤버에게도 붙지 않는 티켓/에이전트
 * (선점자 없음, 이미 나간 멤버의 에이전트, 이름 충돌로 판정 불가)는 `unattributed`
 * 버킷으로 따로 셈해 UI 가 드러낸다. 합계가 안 맞는 대시보드는 틀린 대시보드보다
 * 나쁘다 — 맞는 줄 알고 읽히기 때문이다.
 */
import type { Agent } from "../types/agent";
import type { Task, TaskStatus } from "../types/task";
import type { MergeHistoryEntry } from "../types/mergeHistory";
import type { InvitationRole } from "../types/invitation";
import type { User } from "../types/user";

/** 한 주체(멤버 또는 미귀속 버킷)의 티켓 수 분해. */
export interface TaskCounts {
  /** CLAIMED + IN_PROGRESS — 지금 사람이 붙어 있는 일. */
  inProgress: number;
  /** REVIEW — 랜딩 대기. */
  review: number;
  done: number;
  /** BLOCKED + FAILED — 손이 필요한 일. */
  stuck: number;
  /** 위 네 버킷의 합(= 귀속된 티켓 총수). TODO 는 선점자가 없어 여기 안 든다. */
  total: number;
}

export interface MemberWorkloadRow {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
  /** presence 계산용 원본 heartbeat — types/user.getPresenceStatus 에 그대로 넘긴다. */
  lastHeartbeatAt?: Date;
  role: InvitationRole;
  /** 이 멤버가 이 프로젝트에서 띄운 에이전트 수. */
  agentCount: number;
  /** 그 중 지금 돌고 있는(status === "working") 수. */
  activeAgentCount: number;
  tasks: TaskCounts;
  /** 이 멤버의 티켓에서 실제로 랜딩된 머지 수 (merge_history). */
  merges: number;
  /** 에이전트 누적 비용 합 (USD, agent.totalCost). 값이 없는 doc 은 0. */
  cost: number;
  /** 이 멤버에 대해 우리가 가진 가장 최근 사실(에이전트 비용 갱신·티켓 갱신·생성). */
  lastActivityAt: Date | null;
  /** 이 멤버에 대해 셀 것이 하나라도 있었나 — 행 단위 "데이터 없음" 표시용. */
  hasData: boolean;
}

export interface WorkloadSummary {
  rows: MemberWorkloadRow[];
  /** 어느 멤버에게도 귀속되지 않은 잔여분. */
  unattributed: {
    tasks: TaskCounts;
    agentCount: number;
    merges: number;
  };
  /** 프로젝트 전체에서 셀 것이 하나라도 있었나. false 면 UI 는 "데이터 없음". */
  hasData: boolean;
}

const EMPTY_COUNTS = (): TaskCounts => ({
  inProgress: 0,
  review: 0,
  done: 0,
  stuck: 0,
  total: 0,
});

/** status → TaskCounts 의 어느 칸인가. TODO 는 어느 칸도 아니다(미선점). */
function bucketFor(status: TaskStatus): keyof TaskCounts | null {
  switch (status) {
    case "CLAIMED":
    case "IN_PROGRESS":
      return "inProgress";
    case "REVIEW":
      return "review";
    case "DONE":
      return "done";
    case "BLOCKED":
    case "FAILED":
      return "stuck";
    default:
      return null;
  }
}

function addTask(counts: TaskCounts, status: TaskStatus): boolean {
  const bucket = bucketFor(status);
  if (!bucket) return false;
  counts[bucket] += 1;
  counts.total += 1;
  return true;
}

/**
 * claimedBy 값 → 그 에이전트를 띄운 멤버 uid.
 *
 * id 로 먼저 맞춰 보고, 안 맞으면 name 으로 맞춘다(이중키 규칙). name 이
 * **서로 다른 소유자의** 에이전트 여럿에 걸리면 판정을 포기하고 null 을
 * 돌려준다 — 아무에게나 얹느니 미귀속으로 드러내는 편이 정직하다. 같은
 * 소유자의 동명 에이전트 여러 대는 모호하지 않으므로 그대로 귀속된다.
 */
export function resolveClaimOwner(
  claimedBy: string | null | undefined,
  agents: Agent[],
): string | null {
  if (!claimedBy) return null;
  const byId = agents.find((a) => a.id === claimedBy);
  if (byId) return byId.ownerId || null;

  const named = agents.filter((a) => a.name === claimedBy);
  if (named.length === 0) return null;
  const owners = new Set(named.map((a) => a.ownerId));
  if (owners.size !== 1) return null; // 이름 충돌 — 판정 불가
  return named[0].ownerId || null;
}

function laterOf(a: Date | null, b: Date | null | undefined): Date | null {
  if (!b || !(b instanceof Date) || Number.isNaN(b.getTime())) return a;
  if (!a) return b;
  return b.getTime() > a.getTime() ? b : a;
}

export interface WorkloadInput {
  members: User[];
  memberRoles: Record<string, InvitationRole>;
  agents: Agent[];
  tasks: Task[];
  merges: MergeHistoryEntry[];
}

/**
 * 멤버 목록 + 현존 데이터 → 구성원별 작업량 표.
 *
 * 정렬은 "지금 누구에게 일이 몰려 있나" 를 먼저 보여준다: 진행중 → REVIEW →
 * 완료 → 이름. 소유자/관리자가 이 화면에서 실제로 내리는 판단(다음 티켓을
 * 누구에게 줄 것인가)이 그 순서라서다.
 */
export function computeMemberWorkload(input: WorkloadInput): WorkloadSummary {
  const { members, memberRoles, agents, tasks, merges } = input;

  // soft-delete 된 티켓은 원장에서 지워진 것으로 취급한다. archived 는 남긴다 —
  // 접어 둔 것이지 안 한 일이 아니다.
  const liveTasks = tasks.filter((t) => t.deleted !== true);

  const memberIds = new Set(members.map((m) => m.id));
  const rows = new Map<string, MemberWorkloadRow>();
  for (const m of members) {
    rows.set(m.id, {
      userId: m.id,
      displayName: m.displayName || m.email || m.id,
      email: m.email || "",
      photoURL: m.photoURL || "",
      lastHeartbeatAt: m.lastHeartbeatAt,
      role: memberRoles[m.id] || "member",
      agentCount: 0,
      activeAgentCount: 0,
      tasks: EMPTY_COUNTS(),
      merges: 0,
      cost: 0,
      lastActivityAt: null,
      hasData: false,
    });
  }

  const unattributed = {
    tasks: EMPTY_COUNTS(),
    agentCount: 0,
    merges: 0,
  };

  // ── 에이전트 ───────────────────────────────────────────────────────────
  for (const agent of agents) {
    const row = agent.ownerId ? rows.get(agent.ownerId) : undefined;
    if (!row) {
      unattributed.agentCount += 1;
      continue;
    }
    row.agentCount += 1;
    if (agent.status === "working") row.activeAgentCount += 1;
    row.cost += typeof agent.totalCost === "number" ? agent.totalCost : 0;
    row.lastActivityAt = laterOf(row.lastActivityAt, agent.costUpdatedAt);
    row.lastActivityAt = laterOf(row.lastActivityAt, agent.createdAt);
    row.hasData = true;
  }

  // ── 티켓 ───────────────────────────────────────────────────────────────
  // taskId → 귀속 uid 를 여기서 한 번 만들어 두고 머지 집계가 재사용한다.
  const ownerByTaskId = new Map<string, string | null>();
  for (const task of liveTasks) {
    const owner = resolveClaimOwner(task.claimedBy, agents);
    const attributed = owner && memberIds.has(owner) ? owner : null;
    ownerByTaskId.set(task.id, attributed);

    const row = attributed ? rows.get(attributed) : undefined;
    if (!row) {
      addTask(unattributed.tasks, task.status);
      continue;
    }
    if (addTask(row.tasks, task.status)) {
      row.hasData = true;
      row.lastActivityAt = laterOf(row.lastActivityAt, task.updatedAt);
    }
  }

  // ── 머지 ───────────────────────────────────────────────────────────────
  for (const entry of merges) {
    const owner = entry.taskId ? ownerByTaskId.get(entry.taskId) : null;
    const row = owner ? rows.get(owner) : undefined;
    if (!row) {
      unattributed.merges += 1;
      continue;
    }
    row.merges += 1;
    row.hasData = true;
    row.lastActivityAt = laterOf(row.lastActivityAt, entry.mergedAt);
  }

  const sorted = Array.from(rows.values()).sort((a, b) => {
    if (b.tasks.inProgress !== a.tasks.inProgress)
      return b.tasks.inProgress - a.tasks.inProgress;
    if (b.tasks.review !== a.tasks.review)
      return b.tasks.review - a.tasks.review;
    if (b.tasks.done !== a.tasks.done) return b.tasks.done - a.tasks.done;
    return a.displayName.localeCompare(b.displayName);
  });

  const hasData =
    sorted.some((r) => r.hasData) ||
    unattributed.agentCount > 0 ||
    unattributed.tasks.total > 0 ||
    unattributed.merges > 0;

  return { rows: sorted, unattributed, hasData };
}

/** 표 상단 합계 — 행을 다시 도는 대신 한 번에. */
export function workloadTotals(summary: WorkloadSummary): {
  members: number;
  agents: number;
  inProgress: number;
  review: number;
  done: number;
  merges: number;
  cost: number;
} {
  const acc = {
    members: summary.rows.length,
    agents: summary.unattributed.agentCount,
    inProgress: summary.unattributed.tasks.inProgress,
    review: summary.unattributed.tasks.review,
    done: summary.unattributed.tasks.done,
    merges: summary.unattributed.merges,
    cost: 0,
  };
  for (const row of summary.rows) {
    acc.agents += row.agentCount;
    acc.inProgress += row.tasks.inProgress;
    acc.review += row.tasks.review;
    acc.done += row.tasks.done;
    acc.merges += row.merges;
    acc.cost += row.cost;
  }
  return acc;
}
