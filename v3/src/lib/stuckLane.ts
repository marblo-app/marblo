import type { Agent } from "../types/agent";
import type { Task, TaskStatus } from "../types/task";
import {
  STALL_QUIET_NORMAL_MS,
  quietThresholdMs,
} from "../../electron/agent-stall-policy";

/**
 * 정체(Stuck) 레인 — DONE 우측에 붙는 **가상** 레인의 판정 로직.
 *
 * ★ 이 모듈은 status enum 을 늘리지 않는다. "STUCK" 이라는 상태는 존재하지
 * 않고, 앞으로도 만들지 않는다. 정체는 (a) 이미 있는 종착 status(BLOCKED /
 * FAILED) 와 (b) 다른 신호에서 **파생**되는 STALE 을 화면에서만 한데 묶는
 * 그룹핑이다. 원장(Firestore task.status)은 한 글자도 바뀌지 않으므로,
 * 레인을 껐다 켜도 데이터는 무손실이고 MCP·오케·텔레메트리가 보는 상태는
 * 그대로다.
 *
 * 왜 파생이어야 하나: "죽은 에이전트가 물고 있는 IN_PROGRESS 티켓" 은
 * status 로는 영원히 IN_PROGRESS 다(에이전트가 죽었으니 자기 상태를 고쳐
 * 줄 주체가 없다). 그 사실을 status 에 적으려면 누군가 write 를 해야 하고,
 * 그 write 는 되돌릴 수 없는 원장 오염이다. 읽는 쪽에서 파생하면 에이전트가
 * 되살아나는 순간 판정이 저절로 풀린다.
 */

/**
 * 무진척 임계 — **우선순위별**이며, 워치독·dispatch 와 같은 상수를 쓴다
 * (electron/agent-stall-policy.ts: P4–P5 = 20분, P1–P3 = 45분, 근거는 그 파일).
 *
 * 왜 공유하나: 보드가 "정체" 라고 그리는 순간과 워치독이 오케에게 "조용하다" 고
 * 올리는 순간과 dispatch_task 가 그 담당을 우회하기 시작하는 순간이 **같아야**
 * 사람·오케·도구가 같은 사실을 본다. 2026-08-22 배포 정지 건은 셋이 달라서
 * 보드는 working, 오케는 무소식, dispatch 는 "live" 였다.
 *
 * `STALE_THRESHOLD_MS` 는 일반 티어 값이다 — 우선순위를 모르는 표시용
 * (StuckLane 의 idleFor)과 기존 호출자 호환을 위해 남긴다. 판정은
 * `staleThresholdFor(task)` 를 쓴다.
 */
export const STALE_THRESHOLD_MS = STALL_QUIET_NORMAL_MS;

/** 이 티켓의 무진척 임계(ms) — priority 로 티어를 고른다. */
export function staleThresholdFor(task: Pick<Task, "priority">): number {
  return quietThresholdMs(task.priority);
}

/**
 * 워크트리가 "확실히 오래 안 만져졌다" 고 볼 일 수 임계.
 *
 * 렌더러가 쥔 워크트리 시간 신호는 `staleInfo.idleDays` 뿐이고 해상도가
 * **일** 단위다(분 단위 mtime 을 얻으려면 워크트리마다 stat 을 돌려야 하는데,
 * 그 per-worktree 스폰 패턴은 #511 이 걷어낸 바로 그 회귀다 — 135개 기준
 * 960ms/135스폰 대 52ms/2스폰). 그래서 워크트리는 30분 해상도를 못 준다.
 * 대신 "하루 넘게 손도 안 댔다" 는 **코드 진척이 없다는 독립 증거**로 쓴다:
 * PM 이 티켓을 편집해 updatedAt 만 갱신된 케이스처럼 활동 타임스탬프가
 * 거짓으로 신선해 보일 때 이 신호가 정체를 잡아낸다.
 */
export const WORKTREE_IDLE_STALE_DAYS = 1;

/** 정체 레인의 3개 서브그룹. status 가 아니라 화면 그룹 키다. */
export type StuckKind = "BLOCKED" | "FAILED" | "STALE";

/** STALE 로 판정된 근거 — 카드에 "왜" 를 그대로 보여주기 위해 남긴다. */
export type StaleReason =
  | "agent-missing"
  | "agent-dead"
  | "no-progress"
  | "worktree-idle";

export interface StuckVerdict {
  kind: StuckKind;
  /** STALE 일 때만 채워진다. */
  staleReason?: StaleReason;
  /** 마지막 진척 이후 경과(ms). STALE 근거 표시용. */
  idleMs?: number;
}

/** 분류에 필요한 에이전트 필드만. 스토어 전체를 끌고 오지 않는다. */
export type StuckAgentSnapshot = Pick<
  Agent,
  "id" | "name" | "status" | "currentTaskId"
>;

/**
 * 죽은 에이전트로 볼 status.
 *
 * `idle` 은 포함하지 않는다 — CLI 가 답을 기다리는 정상 상태이고, 마블로의
 * working/idle 판정 자체가 PTY 바이트 파생이라 추론 중인 에이전트가 idle 로
 * 보이는 오판이 실재한다. idle 을 dead 로 치면 살아있는 작업을 정체로
 * 몰아낸다. `idle` 은 무진척 시계(아래 no-progress arm)에만 맡긴다.
 */
const DEAD_AGENT_STATUSES: ReadonlySet<Agent["status"]> = new Set([
  "stopped",
  "error",
]);

/** STALE 판정 대상 status — "진행 중이라고 주장하는" 티켓만. */
const IN_FLIGHT_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "CLAIMED",
  "IN_PROGRESS",
]);

export interface StuckContext {
  /** 현재 프로젝트의 에이전트 목록(agentStore.agents). */
  agents: readonly StuckAgentSnapshot[];
  /**
   * 에이전트 구독이 최소 1회 스냅샷을 받았는가.
   *
   * ★ 콜드 부팅 순간 agents 는 빈 배열이다. 그때 "바인딩 에이전트 없음" 을
   * 곧이곧대로 믿으면 진행 중인 티켓이 **전부** 정체로 튀었다가 한 프레임
   * 뒤 돌아온다. 로드 전에는 agent-missing arm 을 통째로 침묵시킨다
   * (무진척 시계는 그대로 돈다 — 진짜 정체는 어차피 그쪽에서 잡힌다).
   */
  agentsLoaded: boolean;
  /** 판정 기준 시각(epoch ms). 테스트가 시계를 고정할 수 있게 주입받는다. */
  now: number;
  /** taskId → 워크트리 idleDays (worktreeStore 스냅샷에서 1패스로 만든다). */
  worktreeIdleDays?: ReadonlyMap<string, number>;
  /** 무진척 임계 override (기본은 티켓 우선순위별 {@link staleThresholdFor}). */
  thresholdMs?: number;
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // Firestore Timestamp. task 의 nested `projection` 은 convertTimestamps 의
  // top-level DATE_FIELDS 를 안 타서 raw Timestamp 인 채로 렌더러에 온다.
  const candidate = value as {
    toDate?: () => Date;
    seconds?: number;
  };
  if (typeof candidate.toDate === "function") {
    return toMillis(candidate.toDate());
  }
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  return null;
}

/**
 * 이 티켓을 물고 있는 에이전트.
 *
 * `claimedBy` 는 두 경로로 저장된다 — 수동 UI 배정은 agent.name, MCP
 * claim_task 는 agent.id. 한쪽만 보면 다른 경로로 들어온 티켓이 전부
 * "에이전트 없음" 으로 오판돼 멀쩡한 작업이 정체 레인으로 빨려 들어간다
 * (TaskCard / resolveTaskAgentId 와 같은 규칙).
 */
export function findBoundAgent<T extends StuckAgentSnapshot>(
  agents: readonly T[],
  task: Pick<Task, "id" | "claimedBy">,
): T | null {
  const claimedBy = task.claimedBy;
  if (claimedBy) {
    const normalized = claimedBy.toLowerCase();
    const byClaim = agents.find(
      (a) =>
        a.id === claimedBy ||
        a.name === claimedBy ||
        a.name.toLowerCase() === normalized,
    );
    if (byClaim) return byClaim;
  }
  return agents.find((a) => a.currentTaskId === task.id) ?? null;
}

/**
 * 마지막 진척 시각(epoch ms).
 *
 * 후보의 **최댓값**을 쓴다 — 하나라도 최근이면 진척으로 친다. 정체 판정은
 * 카드가 활성 컬럼에서 사라지게 만드는 조치라, 애매하면 "안 정체" 쪽으로
 * 기우는 게 맞다.
 *  - `projection.lastActivityAt` — MCP add_activity/상태전이가 트랜잭션으로
 *    같이 찍는 진짜 활동 시각.
 *  - `updatedAt` — 모든 write 가 올린다(구 문서엔 projection 자체가 없다).
 *  - `claimedAt` — 배정 직후 아직 아무 활동도 없는 티켓의 시작점. 이게 없으면
 *    갓 배정된 티켓이 즉시 무진척으로 보인다.
 */
export function lastProgressAt(task: Task): number | null {
  const projection = (task as { projection?: { lastActivityAt?: unknown } })
    .projection;
  const candidates = [
    toMillis(projection?.lastActivityAt),
    toMillis(task.updatedAt),
    toMillis(task.claimedAt),
  ].filter((ms): ms is number => ms !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/**
 * 보드에서 통째로 감춰야 하는 티켓 — 보관됐거나 soft-delete 됐다.
 *
 * 정체 레인을 포함한 **전 레인**에 적용된다. soft-delete 는 MCP delete_task
 * 가 이미 쓰던 규약(`deleted:true` + deletedAt/deletedBy/deleteReason)을 그대로
 * 재사용한다 — 렌더러가 그동안 이 플래그를 안 봐서 MCP 로 지운 티켓이 보드에
 * 계속 떠 있었다.
 */
export function isHiddenTask(task: Task): boolean {
  return task.archived === true || task.deleted === true;
}

/**
 * 이 티켓이 정체인가, 정체면 어떤 그룹·왜인가. 아니면 null.
 *
 * 판정 순서는 "이미 원장에 적힌 사실" 이 파생 추론을 이긴다:
 *   1. status === BLOCKED → BLOCKED
 *   2. status === FAILED  → FAILED
 *   3. CLAIMED/IN_PROGRESS 인데 아래 중 하나 → STALE
 *      a. 바인딩 에이전트가 목록에 없음        (agent-missing)
 *      b. 바인딩 에이전트가 stopped/error      (agent-dead)
 *      c. 마지막 진척이 임계(우선순위별 20/45분) 초과 (no-progress)
 *      d. 워크트리가 하루 넘게 무변경          (worktree-idle)
 *
 * (a)(b) 는 "누가 이 일을 하고 있나" 가 무너진 경우, (c)(d) 는 "일이 실제로
 * 굴러가고 있나" 가 무너진 경우다. 둘은 독립이라 OR 로 묶는다 — 죽은
 * 에이전트가 물고 있는데 마침 방금 write 가 있었다고 해서 살아있는 게 아니고,
 * 에이전트가 멀쩡히 떠 있는데 두 시간째 아무 것도 안 하는 것도 정체다.
 *
 * TODO/REVIEW/DONE 은 절대 STALE 이 아니다. 아무도 안 집은 TODO 는 정체가
 * 아니라 백로그고, REVIEW 는 사람 차례를 기다리는 정상 상태다.
 */
export function classifyStuck(
  task: Task,
  ctx: StuckContext,
): StuckVerdict | null {
  if (task.status === "BLOCKED") return { kind: "BLOCKED" };
  if (task.status === "FAILED") return { kind: "FAILED" };
  if (!IN_FLIGHT_STATUSES.has(task.status)) return null;
  return classifyStale(task, ctx);
}

function classifyStale(task: Task, ctx: StuckContext): StuckVerdict | null {
  const threshold = ctx.thresholdMs ?? staleThresholdFor(task);
  const progressAt = lastProgressAt(task);
  const idleMs =
    progressAt === null ? undefined : Math.max(0, ctx.now - progressAt);

  const agent = findBoundAgent(ctx.agents, task);
  if (!agent) {
    // 에이전트 구독이 아직 스냅샷을 못 받았으면 "없음" 을 신뢰하지 않는다.
    if (ctx.agentsLoaded) {
      return { kind: "STALE", staleReason: "agent-missing", idleMs };
    }
  } else if (DEAD_AGENT_STATUSES.has(agent.status)) {
    return { kind: "STALE", staleReason: "agent-dead", idleMs };
  }

  if (idleMs !== undefined && idleMs > threshold) {
    return { kind: "STALE", staleReason: "no-progress", idleMs };
  }

  const idleDays = ctx.worktreeIdleDays?.get(task.id);
  if (idleDays !== undefined && idleDays >= WORKTREE_IDLE_STALE_DAYS) {
    return { kind: "STALE", staleReason: "worktree-idle", idleMs };
  }

  return null;
}

export interface StuckGroups {
  blocked: Task[];
  failed: Task[];
  stale: Task[];
  /** taskId → 판정. 카드가 근거 배지를 그릴 때 쓴다. */
  verdicts: Map<string, StuckVerdict>;
  total: number;
}

export interface BoardPartition {
  /** 활성 컬럼(TODO/CLAIMED/IN_PROGRESS/REVIEW/DONE)이 그릴 티켓 — 정체분 제외. */
  active: Task[];
  stuck: StuckGroups;
  /**
   * 보관/삭제로 감춘 티켓 — 어느 레인에도 안 그려진다.
   *
   * 개수만 세지 않고 목록을 그대로 돌려주는 이유: 되돌릴 길이 없는 숨김은
   * 함정이다. 정체 레인이 이 목록으로 복구 서랍을 그린다.
   */
  hidden: Task[];
}

/**
 * 보드 한 판을 활성/정체/감춤으로 가른다. 한 번의 패스로 전부 계산하므로
 * 컬럼마다 다시 분류하지 않는다(컬럼별 필터가 각자 classify 를 부르면
 * 판정이 컬럼 사이에서 어긋날 수 있다 — 같은 티켓이 두 곳에 뜨거나 아무
 * 데도 안 뜨는 사고).
 */
export function partitionBoardTasks(
  tasks: readonly Task[],
  ctx: StuckContext,
): BoardPartition {
  const active: Task[] = [];
  const blocked: Task[] = [];
  const failed: Task[] = [];
  const stale: Task[] = [];
  const verdicts = new Map<string, StuckVerdict>();
  const hidden: Task[] = [];

  for (const task of tasks) {
    if (isHiddenTask(task)) {
      hidden.push(task);
      continue;
    }
    const verdict = classifyStuck(task, ctx);
    if (!verdict) {
      active.push(task);
      continue;
    }
    verdicts.set(task.id, verdict);
    if (verdict.kind === "BLOCKED") blocked.push(task);
    else if (verdict.kind === "FAILED") failed.push(task);
    else stale.push(task);
  }

  return {
    active,
    stuck: {
      blocked,
      failed,
      stale,
      verdicts,
      total: blocked.length + failed.length + stale.length,
    },
    hidden,
  };
}
