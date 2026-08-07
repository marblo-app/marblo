/**
 * Mission Replay — **미션 개요**(작업 분해 + 의존성 머지 순서).
 *
 * 이 모듈이 답하는 질문은 하나다: "이 미션은 어떤 태스크로 쪼개졌고, 그 PR 들은
 * 어떤 순서로 머지됐나." Replay 의 나머지 축(비트 타임라인·캐스트·통계)은 "무슨
 * 일이 몇 건 있었나"를 말하지 **누가 무엇을 먼저 해야 했는지**를 말하지 않는다.
 * 미션 서사 GIF 가 보여줘야 하는 건 후자다.
 *
 * ── ★PR 은 번호만 파생한다 (URL 이 아니라) ────────────────────────────────
 * `redactReplay` 에서 `prUrl` 은 R11 repoGate 로 처리된다 — 호출부가 공개 repo
 * 화이트리스트를 넘기지 않으면 **전부 DROP** 이다(fail-closed). 즉 URL 을 그대로
 * 실으면 GIF 에는 아무것도 안 뜬다. 반대로 PR **번호**는 저장소 좌표(호스트·
 * 오너·레포명·브랜치)를 하나도 담지 않는 정수라, 티켓이 요구한 "공유가능한
 * 내용(제목·PR번호)만" 에 정확히 들어맞는다. 그래서 번호 파생을 집계 시점에
 * 여기서 한 번만 한다.
 *
 * ── 왜 위상정렬인가 ──────────────────────────────────────────────────────
 * 티켓이 요구한 서사는 "PR #830·831·832 가 **의존성 순서로** 머지됐다"다. 그
 * 순서의 유일한 1급 근거는 `task.dependsOn` 이고, 생성시각·머지시각은 그 근거가
 * 아니다(동시 머지·재시도·수동 머지가 순서를 흔든다). 그래서 미션 내부 간선만
 * 남긴 뒤 Kahn 위상정렬을 돌린다. 동률은 **생성시각 → id** 로 못 박아, 같은
 * 미션을 두 번 렌더해도 A·B·C 가 뒤바뀌지 않게 한다(GIF 는 결정적이어야 한다).
 *
 * 순수 모듈 — firebase·react 를 모르고 I/O 도 없다.
 */

import type { Task } from "../../types/task";
import type {
  ReplayOutline,
  ReplayOutlineTask,
} from "../../types/missionReplay";

/**
 * 개요에 실을 태스크 상한.
 *
 * 상한이 필요한 이유는 화면이 아니라 **레닭션 비용**이다: 경량 Replay(완료이력
 * 집계)는 프로젝트의 DONE 태스크 전부를 한 미션처럼 묶기 때문에, 상한이 없으면
 * 수백 건의 제목이 매번 전수 스캐너를 타고 직렬화된다. 잘린 건수는 버리지 않고
 * `truncated` 로 남긴다 — 조용한 절단이 가장 나쁘다.
 */
export const REPLAY_OUTLINE_MAX_TASKS = 12;

/** GitHub/GitLab PR·MR URL 에서 번호만. 그 외 형태는 `null`(추측하지 않는다). */
export function parsePrNumber(url: string | null | undefined): number | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /(?:\/pull\/|\/pull-requests\/|\/merge_requests\/|^#)(\d+)/,
  );
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 표시용 ref. 0→"A" … 25→"Z", 그 뒤는 "T27" 처럼 번호로 떨어진다.
 *
 * 알파벳을 두 글자로 굴리지(AA/AB) 않는 이유: GIF 한 프레임에 들어가는 건 앞의
 * 몇 건뿐이고, 26건을 넘긴 시점에 이미 "A·B·C 로 쪼갰다"는 서사가 아니다.
 */
export function outlineRef(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `T${index + 1}`;
}

export interface BuildMissionOutlineOptions {
  /** taskId → 이 태스크의 PR URL(완료보고 파싱 결과 포함). 없으면 `task.prUrl` 만 본다. */
  prUrlByTaskId?: Readonly<Record<string, string | null | undefined>>;
  /** 개요 상한. 기본 `REPLAY_OUTLINE_MAX_TASKS`. */
  maxTasks?: number;
}

/** 결정적 정렬 키 — 생성시각(없으면 +∞) → id. */
function orderKey(task: Task): [number, string] {
  const created = task.createdAt?.getTime?.();
  return [
    typeof created === "number" && Number.isFinite(created)
      ? created
      : Number.POSITIVE_INFINITY,
    task.id,
  ];
}

function compareTasks(a: Task, b: Task): number {
  const [aMs, aId] = orderKey(a);
  const [bMs, bId] = orderKey(b);
  if (aMs !== bMs) return aMs - bMs;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * 미션 태스크 → 의존성 위상순서 목록.
 *
 * 사이클(또는 미해소 간선)이 남으면 그 나머지를 생성시각 순으로 뒤에 붙인다 —
 * 순환 의존은 데이터 오류지만, 그것 때문에 GIF 가 통째로 비면 사용자는 원인을
 * 볼 수 없다. 순서가 근사값이 될 뿐 사실(제목·PR번호)은 그대로 남는다.
 */
export function topoSortTasks(tasks: readonly Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    // 미션 **바깥** 태스크로 가는 간선은 순서의 근거가 못 된다(그 태스크는 이
    // 서사에 등장하지 않는다) — 그래서 미션 내부 간선만 남긴다.
    const deps = (task.dependsOn ?? []).filter(
      (dep) => dep !== task.id && byId.has(dep),
    );
    indegree.set(task.id, new Set(deps).size);
    for (const dep of new Set(deps)) {
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }

  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .sort(compareTasks);
  const ordered: Task[] = [];
  const emitted = new Set<string>();

  while (ready.length > 0) {
    const next = ready.shift() as Task;
    if (emitted.has(next.id)) continue;
    emitted.add(next.id);
    ordered.push(next);
    for (const childId of dependents.get(next.id) ?? []) {
      const left = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, left);
      if (left === 0) {
        const child = byId.get(childId);
        if (child) {
          ready.push(child);
          ready.sort(compareTasks);
        }
      }
    }
  }

  if (ordered.length < tasks.length) {
    for (const task of [...tasks].sort(compareTasks)) {
      if (!emitted.has(task.id)) ordered.push(task);
    }
  }
  return ordered;
}

/**
 * 미션 개요 조립.
 *
 * ★여기서 읽는 태스크 필드는 **제목·상태·의존성·PR URL** 뿐이다. description /
 * comment / scope / notes 같은 자유텍스트는 한 글자도 읽지 않는다 — 개요는
 * 애초에 공유 가능한 것만 담아야 무거운 2차 비식별이 필요 없어진다(티켓 §공유
 * 레벨 확정).
 */
export function buildMissionOutline(
  tasks: readonly Task[],
  options: BuildMissionOutlineOptions = {},
): ReplayOutline {
  const max = Math.max(0, options.maxTasks ?? REPLAY_OUTLINE_MAX_TASKS);
  // soft-delete 된 티켓은 보드에서 이미 사라진 일이다 — 서사에 되살리지 않는다.
  const live = tasks.filter((task) => task.deleted !== true);
  const ordered = topoSortTasks(live);
  const refById = new Map<string, string>();
  ordered.forEach((task, index) => refById.set(task.id, outlineRef(index)));

  const kept = ordered.slice(0, max);
  const outlineTasks: ReplayOutlineTask[] = kept.map((task) => {
    const prUrl = options.prUrlByTaskId?.[task.id] ?? task.prUrl ?? null;
    const dependsOn = [
      ...new Set(
        (task.dependsOn ?? [])
          .map((dep) => refById.get(dep))
          .filter((ref): ref is string => Boolean(ref)),
      ),
    ];
    return {
      ref: refById.get(task.id) ?? outlineRef(0),
      title: (task.title ?? "").trim(),
      prNumber: parsePrNumber(prUrl),
      dependsOn,
      done: task.status === "DONE",
    };
  });

  // 머지 순서는 **완료된** 태스크의 PR 만 — 아직 안 끝난 티켓의 PR 을 "머지됨"
  // 순서에 끼우면 GIF 가 사실이 아닌 것을 말하게 된다.
  const mergeOrder: number[] = [];
  for (const item of outlineTasks) {
    if (!item.done || item.prNumber === null) continue;
    if (!mergeOrder.includes(item.prNumber)) mergeOrder.push(item.prNumber);
  }

  return {
    tasks: outlineTasks,
    mergeOrder,
    hasDependencies: outlineTasks.some((item) => item.dependsOn.length > 0),
    truncated: Math.max(0, ordered.length - kept.length),
  };
}
