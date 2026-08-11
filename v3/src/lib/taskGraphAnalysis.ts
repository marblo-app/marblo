import type { Task, TaskStatus } from "../types/task";
import type { TaskGraphLayout } from "./taskGraphLayout";

/**
 * 그래프 뷰의 **운영 분석기** — 순수 함수, DOM/스토어/캔버스 무관.
 *
 * 레이아웃(taskGraphLayout)이 "어디에 그리나" 를 답한다면 여기는 "무엇을 봐야
 * 하나" 를 답한다. 노드를 예쁘게 띄우는 것만으로는 오케가 얻는 게 없다. 보드를
 * 열었을 때 실제로 알고 싶은 건 딱 둘이다:
 *
 *   ① **지금 당장 던질 수 있는 티켓이 뭔가** (ready) — 놀고 있는 병렬성
 *   ② **끝나는 시점을 결정하는 사슬이 뭔가** (critical path) — 병목
 *   ③ ★**동시에 던지면 서로 깨지는 티켓이 뭔가** (scope 겹침) — 머지 충돌
 *
 * ③ 이 붙은 이유가 이 파일의 최근 변화다. 실보드가 1207태스크/82의존이라
 * dependsOn 만으로는 관계가 거의 없다시피 하고(노드 1100개가 고립), 그래프가
 * "점 잔치" 로 끝난다. 그런데 오케가 실제로 다치는 자리는 의존이 아니라 **같은
 * 파일을 두 에이전트에게 동시에 준 것**이다. task.scope[] 가 겹치는 열린 티켓
 * 쌍은 병렬로 돌리는 순간 머지 충돌이라, 그게 의존만큼 진짜 관계다.
 *
 * 셋 다 dependsOn/scope 만 보면 기계적으로 나오는데, 사람이 카드를 하나씩 열어
 * 보는 방식으로는 절대 안 나온다. 그래서 계산을 뷰에서 떼어 순수 함수로 두고
 * 테스트로 고정한다(tests/unit/task-graph-critical-path.test.ts,
 * tests/unit/task-graph-scope-conflict.test.ts).
 *
 * ★입력이 `Task[]` 가 아니라 `TaskGraphLayout` 인 이유: 의존 해석(자기참조·
 * dangling·중복 제거)과 **순환 간선 판정**을 레이아웃이 이미 한 번 했다. 여기서
 * 다시 DFS 를 돌리면 back edge 집합이 미묘하게 갈려서, 화면엔 점선(순환)으로
 * 그려진 간선을 크리티컬 패스는 실선으로 타고 지나가는 모순이 생긴다. 계산과
 * 렌더가 같은 간선 목록을 보게 만드는 게 이 시그니처의 목적이다.
 */

/**
 * 티켓 하나의 **운영 상태**. status 와 겹치는 축이 아니라 "의존을 감안하면
 * 지금 이 티켓은 어떤 처지인가" 다. status=TODO 두 장이 하나는 즉시 착수
 * 가능이고 하나는 3주 뒤에나 풀린다면, 보드에서 같은 회색으로 보이면 안 된다.
 */
export type TaskReadiness =
  /** 끝났다. 더 이상 누구도 막지 않는다. */
  | "done"
  /** 누가 붙어서 굴러가는 중 (CLAIMED/IN_PROGRESS/REVIEW). */
  | "active"
  /** 사람이 봐야 한다 (BLOCKED/FAILED). 의존과 무관하게 멈춰 있다. */
  | "stuck"
  /** ★의존이 전부 끝났고 아직 아무도 안 잡은 TODO — 지금 던질 수 있다. */
  | "ready"
  /** 미완 선행이 하나라도 남은 TODO — 기다리는 것 말곤 할 게 없다. */
  | "waiting";

/**
 * status → hex. 캔버스는 Tailwind 클래스를 못 쓰므로 hex 가 따로 필요하다.
 *
 * ★값은 KanbanColumn 의 `STATUS_CONFIG[...].bg` 클래스를 그대로 푼 것이다
 * (bg-gray-500 → #6b7280 …). 칸반의 REVIEW 와 그래프의 REVIEW 가 다른 보라색이면
 * 색이 정보가 아니라 장식이 된다. 상태가 새로 생겼는데 여기만 빠지는 드리프트는
 * 테스트가 잡는다(키 집합 일치 단언).
 */
export const STATUS_HEX: Record<TaskStatus, string> = {
  TODO: "#6b7280", // gray-500
  CLAIMED: "#eab308", // yellow-500
  IN_PROGRESS: "#3b82f6", // blue-500
  REVIEW: "#a855f7", // purple-500
  BLOCKED: "#f97316", // orange-500
  FAILED: "#ef4444", // red-500
  DONE: "#22c55e", // green-500
};

/**
 * readiness → 링 색. 채움은 status 가 쓰므로 readiness 는 **테두리**로만 말한다.
 *
 * `active`/`done` 이 null 인 건 의도다. 굴러가는 티켓과 끝난 티켓에까지 링을
 * 두르면 화면 전체가 테두리 범벅이 돼서, 정작 봐야 할 ready/waiting 대비가
 * 죽는다. 링은 "네가 개입할 여지가 있는 노드" 에만 붙는다.
 */
export const READINESS_RING: Record<TaskReadiness, string | null> = {
  done: null,
  active: null,
  stuck: "#ef4444", // red-500
  ready: "#34d399", // emerald-400 — 즉시 착수 가능
  waiting: "#f59e0b", // amber-500 — 점선으로 그린다(대기)
};

/** 크리티컬 패스 강조색. status/readiness 어느 색과도 안 겹치게 고른 cyan. */
export const CRITICAL_HEX = "#67e8f9"; // cyan-300

/**
 * scope 겹침(충돌위험) 간선 색 — 주황. 의존 간선(회색)·크리티컬(cyan)·순환
 * (amber)과 갈려야 한 화면에서 네 관계가 구분된다.
 *
 * ★amber(#f59e0b, 순환)와 가까운 색인 건 의도다. 둘 다 "여기서 사고 난다" 계열
 * 경고고, 선 모양이 갈린다(순환=화살표 달린 점선, 충돌=화살표 없는 굵은 점선).
 * 반대로 orange-400 은 BLOCKED 의 orange-500 과 헷갈릴 수 있어 한 칸 밝게 잡았다.
 */
export const CONFLICT_HEX = "#fb923c"; // orange-400

/** 정체(stuck) 여파 강조색 — 정체 티켓 자신의 링과 같은 빨강. */
export const STUCK_HEX = "#ef4444"; // red-500

/** 굴러가는 중 = 펄스 대상. 렌더와 분석이 같은 정의를 쓰도록 여기서 판정한다. */
const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
]);

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * 티켓별 운영 상태 판정.
 *
 * 순환 간선도 **의존으로 친다**: A↔B 가 서로를 기다리면 실제로 둘 다 못 나가는
 * 게 맞고, 그게 `waiting` 으로 보여야 사용자가 순환을 발견한다. 레이아웃은
 * 좌표를 뽑으려고 back edge 를 빼지만, 그건 그리기 사정이지 운영 사정이 아니다.
 */
export function classifyTaskReadiness(
  layout: TaskGraphLayout,
): Map<string, TaskReadiness> {
  const statusById = new Map<string, TaskStatus>();
  for (const node of layout.nodes) statusById.set(node.id, node.task.status);

  // to → [from...] (후행 → 선행들). 순환 간선 포함.
  const depsByTask = new Map<string, string[]>();
  for (const edge of layout.edges) {
    const list = depsByTask.get(edge.to);
    if (list) list.push(edge.from);
    else depsByTask.set(edge.to, [edge.from]);
  }

  const out = new Map<string, TaskReadiness>();
  for (const node of layout.nodes) {
    const status = node.task.status;
    if (status === "DONE") {
      out.set(node.id, "done");
      continue;
    }
    if (status === "BLOCKED" || status === "FAILED") {
      out.set(node.id, "stuck");
      continue;
    }
    if (isActiveStatus(status)) {
      out.set(node.id, "active");
      continue;
    }
    // 여기 남는 건 TODO 뿐 — 의존이 갈라 준다.
    const deps = depsByTask.get(node.id) ?? [];
    const waiting = deps.some((depId) => statusById.get(depId) !== "DONE");
    out.set(node.id, waiting ? "waiting" : "ready");
  }
  return out;
}

/** 각 readiness 가 몇 장인지 — 범례 배지에 그대로 박힌다. */
export function summarizeReadiness(
  readiness: ReadonlyMap<string, TaskReadiness>,
): Record<TaskReadiness, number> {
  const out: Record<TaskReadiness, number> = {
    done: 0,
    active: 0,
    stuck: 0,
    ready: 0,
    waiting: 0,
  };
  for (const value of readiness.values()) out[value] += 1;
  return out;
}

export interface CriticalPathResult {
  /** 선행 → 후행 순서의 티켓 id 사슬. 노드가 없으면 빈 배열. */
  ids: string[];
  /** 노드 강조용 조회 집합. */
  idSet: Set<string>;
  /** 간선 강조용 조회 집합 (`from→to` 키, layout.edges.id 와 같은 형식). */
  edgeIds: Set<string>;
  /** 사슬의 **남은** 무게 = 사슬 위 미완 티켓 수. */
  weight: number;
  /** 사슬 길이(완료분 포함 노드 수). */
  length: number;
}

const edgeKey = (from: string, to: string) => `${from}→${to}`;

/**
 * DAG **최장 의존 사슬**(크리티컬 패스).
 *
 * ★무게는 "노드 수" 가 아니라 **미완 노드 수**다 (DONE=0, 나머지=1). 운영에서
 * 던지는 질문은 "이 프로젝트가 언제 끝나나" 이고, 이미 끝난 티켓은 그 답을 1도
 * 늦추지 않는다. 노드 수로 재면 완료된 긴 꼬리가 달린 사슬이 정작 남은 일이
 * 몰린 짧은 사슬을 이겨서, 강조가 병목이 아니라 과거를 가리킨다.
 *
 * 동점 처리는 (남은 무게 → 사슬 길이 → 입력 순서) 로 결정론적이다. 같은 보드를
 * 두 번 열었을 때 강조되는 사슬이 바뀌면 사용자는 그걸 신호로 오해한다.
 *
 * 사이클 안전: `edge.cycle` 로 표시된 back edge 는 타지 않는다. 레이아웃의 DFS 가
 * back edge 를 걷어낸 나머지는 정의상 비순환이므로 여기서 무한 루프는 불가능하지만,
 * 입력이 손으로 조립된 경우까지 감안해 방문 중 표시로 한 번 더 막는다.
 */
export function computeCriticalPath(
  layout: TaskGraphLayout,
): CriticalPathResult {
  const empty: CriticalPathResult = {
    ids: [],
    idSet: new Set(),
    edgeIds: new Set(),
    weight: 0,
    length: 0,
  };
  if (layout.nodes.length === 0) return empty;

  const order = layout.nodes.map((node) => node.id);
  const weightById = new Map<string, number>();
  for (const node of layout.nodes) {
    weightById.set(node.id, node.task.status === "DONE" ? 0 : 1);
  }

  // to → [from...] — 순환 간선은 제외한다(화면에서 점선인 간선은 안 탄다).
  const depsByTask = new Map<string, string[]>();
  for (const edge of layout.edges) {
    if (edge.cycle) continue;
    const list = depsByTask.get(edge.to);
    if (list) list.push(edge.from);
    else depsByTask.set(edge.to, [edge.from]);
  }

  /** 이 노드에서 **끝나는** 최적 사슬. */
  interface Best {
    weight: number;
    length: number;
    prev: string | null;
  }
  const best = new Map<string, Best>();
  /** 0=미방문, 1=방문 중, 2=확정. 방어적 순환 차단용. */
  const state = new Map<string, 0 | 1 | 2>();

  // 명시적 스택 DFS — 긴 체인에서 재귀는 스택을 넘긴다(레이아웃과 같은 이유).
  for (const rootId of order) {
    if (state.get(rootId) === 2) continue;
    const stack: { id: string; cursor: number }[] = [{ id: rootId, cursor: 0 }];
    state.set(rootId, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = depsByTask.get(frame.id) ?? [];

      if (frame.cursor < deps.length) {
        const depId = deps[frame.cursor];
        frame.cursor += 1;
        const depState = state.get(depId) ?? 0;
        if (depState !== 0) continue; // 방문 중(방어) 또는 확정 — 값을 그대로 쓴다
        state.set(depId, 1);
        stack.push({ id: depId, cursor: 0 });
        continue;
      }

      const own = weightById.get(frame.id) ?? 1;
      let chosen: Best = { weight: own, length: 1, prev: null };
      for (const depId of deps) {
        const depBest = best.get(depId);
        if (!depBest) continue; // 방어적으로 끊은 간선
        const weight = depBest.weight + own;
        const length = depBest.length + 1;
        // 엄격 비교라 동점이면 먼저 만난 선행(= 입력 순서)이 이긴다.
        if (
          weight > chosen.weight ||
          (weight === chosen.weight && length > chosen.length)
        ) {
          chosen = { weight, length, prev: depId };
        }
      }
      best.set(frame.id, chosen);
      state.set(frame.id, 2);
      stack.pop();
    }
  }

  let endId = order[0];
  let endBest = best.get(endId) ?? { weight: 0, length: 1, prev: null };
  for (const id of order) {
    const candidate = best.get(id);
    if (!candidate) continue;
    if (
      candidate.weight > endBest.weight ||
      (candidate.weight === endBest.weight && candidate.length > endBest.length)
    ) {
      endId = id;
      endBest = candidate;
    }
  }

  const ids: string[] = [];
  for (let cursor: string | null = endId; cursor; ) {
    ids.push(cursor);
    cursor = best.get(cursor)?.prev ?? null;
  }
  ids.reverse();

  const edgeIds = new Set<string>();
  for (let i = 1; i < ids.length; i += 1) {
    edgeIds.add(edgeKey(ids[i - 1], ids[i]));
  }

  return {
    ids,
    idSet: new Set(ids),
    edgeIds,
    weight: endBest.weight,
    length: ids.length,
  };
}

// ── scope 겹침 = 충돌위험 ────────────────────────────────────────────────────
//
// ★왜 이게 dependsOn 만큼 중요한 관계인가: 실보드가 1207태스크에 의존 82개다.
// depends_on 만 그리면 노드의 90% 가 아무와도 안 이어진 점이라, 그래프가
// "예쁘지만 아무것도 안 알려 주는 화면" 이 된다. 반면 오케가 실제로 다치는
// 자리는 **같은 파일을 두 에이전트에게 동시에 준 것**이고, 그건 scope[] 에 이미
// 적혀 있다. 그래서 겹치는 scope 를 별도 간선 종류로 올린다.
//
// ★의존 간선과 **절대 같은 색·같은 모양으로 그리지 않는다**. 둘은 뜻이 반대다:
// 의존은 "순서를 지켜라"(A 다음에 B), 충돌은 "동시에 하지 마라"(A 와 B 를 함께
// 던지면 깨진다). 한 색으로 뭉치면 화면이 거짓말을 한다.

/** 충돌 간선 id — 의존 간선의 `from→to` 와 절대 안 겹치는 무향 키. */
const conflictEdgeKey = (a: string, b: string) => `${a}⇄${b}`;

/** 툴팁에 보여 줄 "무엇 때문에 겹치나" 경로 개수 상한. */
const MAX_CONFLICT_PATHS = 3;

/**
 * 한 화면에 올릴 충돌 간선 상한.
 *
 * 충돌은 쌍(pair)이라 개수가 O(n²)로 튄다 — 열린 티켓 400장이 전부 `v3/src` 를
 * 적어 두면 8만 쌍이다. 그걸 다 그리면 화면은 주황 안개가 되고 계산도 길어진다.
 * ★자르되 **조용히 자르지는 않는다**: `truncated` 로 올려 헤더가 말하게 한다.
 */
export const MAX_CONFLICT_EDGES = 4000;

/**
 * scope 문자열 정규화. 못 쓸 값이면 null.
 *
 * `./v3/src/`, `v3/src`, `/v3//src` 는 전부 같은 곳이다. 여기서 한 번 접어 두면
 * 비교 로직이 문자열 잡일에서 자유로워진다.
 *
 * ★"." / "" / "**" 같은 **전역 scope 는 신호가 아니라 잡음**이라 버린다. 모든
 * 티켓과 겹친다는 말은 아무 것도 구분해 주지 않는다는 뜻이고, 화면에는 완전
 * 그래프 하나가 남는다.
 */
export function normalizeScopePath(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(/\\/g, "/") // 윈도우 경로도 같은 자리로 접는다
    .replace(/\/{2,}/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (cleaned === "" || cleaned === ".") return null;
  const segments = cleaned.split("/");
  // 전부 "**" 뿐 = 저장소 전체. 위 주석의 이유로 신호 없음 취급.
  if (segments.every((segment) => segment === "**")) return null;
  return cleaned;
}

/** 확장자가 붙은 마지막 조각은 "그 아래에 아무것도 없다" 로 읽는다. */
function looksLikeFile(segment: string): boolean {
  if (segment === "**") return false;
  return /\.[^./]+$/.test(segment);
}

/**
 * 조각 하나끼리의 glob 매칭(`*` = 이 조각 안 아무 문자열, `?` = 한 글자).
 *
 * 정규식을 만들지 않는 이유: scope 는 사용자·에이전트가 자유롭게 쓰는 문자열이라
 * 이스케이프를 한 군데만 놓쳐도 패턴이 폭주한다. 두 포인터 매칭은 30줄이고
 * 백트래킹이 선형이라 그런 걱정 자체가 없다.
 */
function globSegment(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p += 1;
      t += 1;
      continue;
    }
    if (p < pattern.length && pattern[p] === "*") {
      star = p;
      mark = t;
      p += 1;
      continue;
    }
    if (star === -1) return false;
    p = star + 1;
    mark += 1;
    t = mark;
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
}

function segmentMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === "*" || b === "*") return true;
  if (a.includes("*") || a.includes("?")) return globSegment(a, b);
  if (b.includes("*") || b.includes("?")) return globSegment(b, a);
  return false;
}

/**
 * 두 정규화 경로가 **같은 파일 영역을 건드리는가**.
 *
 * 규칙 셋:
 *   ① 조각끼리 literal/glob 매칭이 되어야 계속 간다.
 *   ② `**` 는 남은 조각 몇 개든 삼킬 수 있다 — 어느 지점에서 멈추든 한 번만
 *      맞아떨어지면 겹친다(경로 깊이가 얕아 분기 비용은 무시할 만하다).
 *   ③ ★한쪽이 먼저 끝나면 **디렉토리 접두사 관계**라 겹친다. `v3/src/lib` 와
 *      `v3/src/lib/taskGraphForce.ts` 는 같은 자리다 — 이게 실제로 제일 흔한
 *      충돌 모양이고, 문자열 동등 비교만 했으면 통째로 놓쳤을 자리다.
 *
 * ③ 의 예외가 `looksLikeFile` 이다: 끝난 쪽 마지막 조각에 확장자가 붙어 있으면
 * 그 아래엔 아무것도 없으므로 접두사 관계가 성립하지 않는다. 이게 없으면
 * 재귀 glob 테스트 패턴이 `v3/src/lib/foo.ts` 와도 겹친다고 나온다(둘 다
 * "v3/src 아래" 라는 이유만으로). 디렉토리인지 파일인지는 문자열만 봐서는 알 수
 * 없으니 확장자를 근거로 삼는다 — 완벽하진 않아도 실제 scope 표기와 맞는다.
 */
export function scopePathsOverlap(a: string, b: string): boolean {
  const left = normalizeScopePath(a);
  const right = normalizeScopePath(b);
  if (left === null || right === null) return false;
  return segmentsOverlap(left.split("/"), right.split("/"), 0, 0);
}

function segmentsOverlap(
  a: readonly string[],
  b: readonly string[],
  from: number,
  to: number,
): boolean {
  let i = from;
  let j = to;
  while (i < a.length && j < b.length) {
    const sa = a[i];
    const sb = b[j];
    if (sa === "**") {
      for (let k = j; k <= b.length; k += 1) {
        if (segmentsOverlap(a, b, i + 1, k)) return true;
      }
      return false;
    }
    if (sb === "**") {
      for (let k = i; k <= a.length; k += 1) {
        if (segmentsOverlap(a, b, k, j + 1)) return true;
      }
      return false;
    }
    if (!segmentMatches(sa, sb)) return false;
    i += 1;
    j += 1;
  }
  // 둘 다 소진 = 같은 경로.
  if (i >= a.length && j >= b.length) return true;
  // 한쪽만 소진 = 디렉토리 접두사 관계(단 파일로 끝났으면 아니다).
  const exhausted = i >= a.length ? a : b;
  return !looksLikeFile(exhausted[exhausted.length - 1]);
}

/** 충돌 간선 하나 — 무향이다(누가 먼저랄 게 없다). */
export interface ScopeConflictEdge {
  /** `a⇄b` — a<b 로 정규화해 같은 쌍이 두 번 안 생긴다. */
  id: string;
  a: string;
  b: string;
  /** 무엇 때문에 부딪히는지. 툴팁이 읽는다(최대 3개). */
  paths: string[];
}

/**
 * **지금 동시에 던질 수 있는데 서로 깨질** 티켓 덩어리.
 *
 * 간선(edges)과 클러스터의 기준이 다른 게 핵심이다. 간선은 열린 티켓 전부를
 * 보지만(대기·정체도 언젠간 돈다), 클러스터는 **ready/active** 만 본다 — 오케가
 * 오늘 병렬로 던질 후보가 그것들뿐이라 "지금 조심하라" 는 경고는 그 안에서만
 * 뜻이 있다.
 */
export interface ScopeConflictCluster {
  /** 구성원 — 입력 순서. */
  ids: string[];
  /** 이 덩어리가 공유하는 경로 대표 몇 개. */
  paths: string[];
}

export interface ScopeConflictResult {
  edges: ScopeConflictEdge[];
  /** id → 충돌 상대. 호버 강조와 고립 판정이 쓴다. */
  neighbors: Map<string, Set<string>>;
  clusters: ScopeConflictCluster[];
  /** 상한(MAX_CONFLICT_EDGES)에 걸려 일부를 못 그렸는가. */
  truncated: boolean;
}

const EMPTY_CONFLICTS: ScopeConflictResult = {
  edges: [],
  neighbors: new Map(),
  clusters: [],
  truncated: false,
};

/** 클러스터 후보 = 지금 병렬로 던질 수 있는 처지. */
const isDispatchable = (value: TaskReadiness): boolean =>
  value === "ready" || value === "active";

/**
 * scope 겹침 그래프.
 *
 * ★DONE 티켓은 아예 뺀다. 이미 머지된 변경은 누구와도 안 부딪히므로, 넣으면
 * 완료된 티켓 수백 장이 서로 주황 실타래를 만들어 정작 살아 있는 충돌을 덮는다.
 * (열린 티켓끼리만 = "지금 병렬로 돌리면 깨지는가" 라는 질문에 정확히 대응한다.)
 *
 * 구현 메모: 같은 scope 문자열을 여러 티켓이 공유하는 게 보통이라, 티켓 쌍이
 * 아니라 **서로 다른 scope 조각 쌍**을 비교하고 소유 티켓을 교차곱한다. 조각
 * 쌍은 첫 조각이 둘 다 리터럴이고 다르면 즉시 버려서 대부분이 O(1)에 걸러진다.
 */
export function computeScopeConflicts(
  layout: TaskGraphLayout,
  readiness: ReadonlyMap<string, TaskReadiness>,
): ScopeConflictResult {
  if (layout.nodes.length === 0) return EMPTY_CONFLICTS;

  /** 정규화 경로 → 그 경로를 적어 둔 열린 티켓들(입력 순서). */
  const owners = new Map<string, string[]>();
  const segmentsByPath = new Map<string, string[]>();
  for (const node of layout.nodes) {
    if (readiness.get(node.id) === "done") continue;
    const scope = node.task.scope;
    if (!Array.isArray(scope) || scope.length === 0) continue;
    const seen = new Set<string>(); // 한 티켓이 같은 경로를 두 번 적어도 한 번
    for (const raw of scope) {
      const path = normalizeScopePath(raw);
      if (path === null || seen.has(path)) continue;
      seen.add(path);
      const list = owners.get(path);
      if (list) list.push(node.id);
      else {
        owners.set(path, [node.id]);
        segmentsByPath.set(path, path.split("/"));
      }
    }
  }
  if (owners.size === 0) return EMPTY_CONFLICTS;

  const paths = [...owners.keys()];
  const byId = new Map<string, ScopeConflictEdge>();
  let truncated = false;

  const addPair = (x: string, y: string, path: string): boolean => {
    if (x === y) return true;
    const [a, b] = x < y ? [x, y] : [y, x];
    const id = conflictEdgeKey(a, b);
    const existing = byId.get(id);
    if (existing) {
      if (
        existing.paths.length < MAX_CONFLICT_PATHS &&
        !existing.paths.includes(path)
      ) {
        existing.paths.push(path);
      }
      return true;
    }
    if (byId.size >= MAX_CONFLICT_EDGES) {
      truncated = true;
      return false;
    }
    byId.set(id, { id, a, b, paths: [path] });
    return true;
  };

  // ★첫 조각과 "그게 glob 인가" 를 미리 뽑아 둔다. 아래 이중 루프는 조각 쌍
  // 전체(E²)를 훑는 유일한 자리라, 여기서 문자열 스캔을 반복하면 그게 곧 비용이다.
  const heads = paths.map((path) => segmentsByPath.get(path)![0]);
  const headWild = heads.map(
    (head) => head.includes("*") || head.includes("?"),
  );

  outer: for (let i = 0; i < paths.length; i += 1) {
    const pathA = paths[i];
    const ownersA = owners.get(pathA)!;
    const segA = segmentsByPath.get(pathA)!;

    // ① 같은 경로를 적은 티켓끼리 — 제일 흔하고 제일 확실한 충돌.
    for (let x = 0; x < ownersA.length; x += 1) {
      for (let y = x + 1; y < ownersA.length; y += 1) {
        if (!addPair(ownersA[x], ownersA[y], pathA)) break outer;
      }
    }

    // ② 다른 경로와의 접두사/glob 겹침.
    for (let j = i + 1; j < paths.length; j += 1) {
      const pathB = paths[j];
      const segB = segmentsByPath.get(pathB)!;
      // 첫 조각이 둘 다 리터럴인데 다르면 아래를 볼 것도 없다.
      if (!headWild[i] && !headWild[j] && heads[i] !== heads[j]) continue;
      if (!segmentsOverlap(segA, segB, 0, 0)) continue;
      const ownersB = owners.get(pathB)!;
      // 더 좁은(=긴) 쪽을 보여 줘야 "어디서 부딪히나" 가 구체적이다.
      const label = segA.length >= segB.length ? pathA : pathB;
      for (const x of ownersA) {
        for (const y of ownersB) {
          if (!addPair(x, y, label)) break outer;
        }
      }
    }
  }

  const edges = [...byId.values()];
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    const setA = neighbors.get(edge.a);
    if (setA) setA.add(edge.b);
    else neighbors.set(edge.a, new Set([edge.b]));
    const setB = neighbors.get(edge.b);
    if (setB) setB.add(edge.a);
    else neighbors.set(edge.b, new Set([edge.a]));
  }

  return {
    edges,
    neighbors,
    clusters: buildConflictClusters(layout, readiness, edges),
    truncated,
  };
}

/**
 * ready/active 노드만 남긴 충돌 부분그래프의 연결 요소(2장 이상).
 *
 * 큰 덩어리부터 — 오케가 제일 먼저 갈라 줘야 할 게 그거다. 동점이면 보드 입력
 * 순서라 같은 보드를 두 번 열어도 순서가 안 바뀐다.
 */
function buildConflictClusters(
  layout: TaskGraphLayout,
  readiness: ReadonlyMap<string, TaskReadiness>,
  edges: readonly ScopeConflictEdge[],
): ScopeConflictCluster[] {
  const rank = new Map<string, number>();
  layout.nodes.forEach((node, index) => {
    const value = readiness.get(node.id);
    if (value && isDispatchable(value)) rank.set(node.id, index);
  });
  if (rank.size === 0) return [];

  const adjacency = new Map<string, { id: string; path: string }[]>();
  for (const edge of edges) {
    if (!rank.has(edge.a) || !rank.has(edge.b)) continue;
    const path = edge.paths[0] ?? "";
    const listA = adjacency.get(edge.a);
    if (listA) listA.push({ id: edge.b, path });
    else adjacency.set(edge.a, [{ id: edge.b, path }]);
    const listB = adjacency.get(edge.b);
    if (listB) listB.push({ id: edge.a, path });
    else adjacency.set(edge.b, [{ id: edge.a, path }]);
  }
  if (adjacency.size === 0) return [];

  const visited = new Set<string>();
  const clusters: ScopeConflictCluster[] = [];
  for (const node of layout.nodes) {
    if (!adjacency.has(node.id) || visited.has(node.id)) continue;
    visited.add(node.id);
    const ids = [node.id];
    const paths: string[] = [];
    // 배열 커서 BFS — 재귀는 큰 덩어리에서 스택을 넘긴다.
    for (let head = 0; head < ids.length; head += 1) {
      for (const next of adjacency.get(ids[head]) ?? []) {
        if (next.path && paths.length < MAX_CONFLICT_PATHS) {
          if (!paths.includes(next.path)) paths.push(next.path);
        }
        if (visited.has(next.id)) continue;
        visited.add(next.id);
        ids.push(next.id);
      }
    }
    if (ids.length > 1) clusters.push({ ids, paths });
  }

  clusters.sort(
    (a, b) =>
      b.ids.length - a.ids.length ||
      (rank.get(a.ids[0]) ?? 0) - (rank.get(b.ids[0]) ?? 0),
  );
  return clusters;
}

// ── 정체(stuck)의 여파 ───────────────────────────────────────────────────────

export interface StuckImpactResult {
  /** BLOCKED/FAILED 티켓 자신. */
  stuckIds: Set<string>;
  /** 그 티켓들에 막혀 있는 후행 전부(이행적). stuck 자신은 안 들어간다. */
  downstreamIds: Set<string>;
  /** 여파를 타고 내려간 의존 간선(`from→to` 키). */
  edgeIds: Set<string>;
}

const EMPTY_STUCK: StuckImpactResult = {
  stuckIds: new Set(),
  downstreamIds: new Set(),
  edgeIds: new Set(),
};

/**
 * 정체 티켓의 **폭발 반경**.
 *
 * 빨간 점 하나만 칠하면 "누가 막혔나" 는 알아도 "그래서 얼마나 아픈가" 는 모른다.
 * BLOCKED 하나가 티켓 40장을 세우고 있는 것과 아무도 안 기다리는 것은 완전히
 * 다른 사건인데, 노드 색만으로는 둘이 똑같이 생겼다.
 *
 * 순환 간선은 타지 않는다 — 화면에서 점선으로 그린 간선을 강조가 실선처럼
 * 타고 지나가면 크리티컬 패스와 같은 모순이 생긴다(파일 상단 주석 참고).
 */
export function computeStuckImpact(
  layout: TaskGraphLayout,
  readiness: ReadonlyMap<string, TaskReadiness>,
): StuckImpactResult {
  const stuckIds = new Set<string>();
  for (const node of layout.nodes) {
    if (readiness.get(node.id) === "stuck") stuckIds.add(node.id);
  }
  if (stuckIds.size === 0) return EMPTY_STUCK;

  // from → [{to, edgeId}] — 선행에서 후행으로 내려간다.
  const forward = new Map<string, { to: string; edgeId: string }[]>();
  for (const edge of layout.edges) {
    if (edge.cycle) continue;
    const list = forward.get(edge.from);
    if (list) list.push({ to: edge.to, edgeId: edge.id });
    else forward.set(edge.from, [{ to: edge.to, edgeId: edge.id }]);
  }

  const downstreamIds = new Set<string>();
  const edgeIds = new Set<string>();
  const queue = [...stuckIds];
  const seen = new Set<string>(stuckIds);
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of forward.get(queue[head]) ?? []) {
      edgeIds.add(next.edgeId);
      // 정체 티켓이 다른 정체 티켓의 후행일 수 있다 — 그건 여파가 아니라 원인
      // 이므로 downstream 에 넣지 않는다(빨강 두 겹으로 칠할 이유가 없다).
      if (!stuckIds.has(next.to)) downstreamIds.add(next.to);
      if (seen.has(next.to)) continue;
      seen.add(next.to);
      queue.push(next.to);
    }
  }

  return { stuckIds, downstreamIds, edgeIds };
}

// ── 독립 노드(백로그 필드) ───────────────────────────────────────────────────

/**
 * 간선이 하나도 없는 노드 — 의존도 없고 scope 겹침도 없다.
 *
 * ★실보드에서 이게 노드의 대다수(1207 중 1100+)다. 전부 같은 크기로 그리면
 * 화면의 90% 를 "아무 관계도 없는 점" 이 차지하고, 정작 읽을 게 있는 연결
 * 클러스터가 그 안에 파묻힌다. 그래서 작게·흐리게 깔아 **배경(백로그 필드)** 로
 * 물리고 연결된 것들이 전경을 갖게 한다. 지우지는 않는다 — 안 보이면 "내 티켓이
 * 사라졌다" 가 된다.
 */
export function findIsolatedNodes(
  layout: TaskGraphLayout,
  conflicts: ScopeConflictResult,
): Set<string> {
  const connected = new Set<string>();
  for (const edge of layout.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  for (const id of conflicts.neighbors.keys()) connected.add(id);

  const isolated = new Set<string>();
  for (const node of layout.nodes) {
    if (!connected.has(node.id)) isolated.add(node.id);
  }
  return isolated;
}

/** 시뮬에 넘길 무향 연결 목록(scope 겹침) — 연결된 것끼리 뭉치게 만든다. */
export function conflictLinks(
  conflicts: ScopeConflictResult,
): [string, string][] {
  return conflicts.edges.map((edge) => [edge.a, edge.b]);
}

/** 노드 반지름 하한/상한 — 시뮬의 충돌 반경이자 그리기 반경. */
export const GRAPH_MIN_RADIUS = 9;
export const GRAPH_MAX_RADIUS = 26;

/** 독립 노드를 얼마나 줄일지 / 얼마나 흐리게 그릴지. */
export const ISOLATED_RADIUS_SCALE = 0.55;
export const ISOLATED_ALPHA = 0.34;

/**
 * 노드 크기 = **우선순위 + 피의존 수**.
 *
 * 둘 중 하나만 쓰면 반쪽이다. 우선순위만 보면 P5 고아 티켓이 제일 크게 뜨고,
 * 피의존 수만 보면 아무도 급하다고 안 한 허브가 화면을 지배한다. 크기가 답해야
 * 하는 질문은 "이거 늦으면 얼마나 아픈가" 라서 둘을 더한다.
 *
 * ★`connected=false`(간선이 하나도 없는 노드)면 통째로 줄인다. 크기는 여기서도
 * 정보다 — 아무와도 안 엮인 티켓은 늦어도 남을 안 세우므로 작은 게 맞고, 그래야
 * 연결 클러스터가 화면을 차지한다. 기본값이 true 라 기존 호출부는 안 바뀐다.
 */
export function graphNodeRadius(
  task: Task,
  dependentCount: number,
  connected = true,
): number {
  const priority = Number.isFinite(task.priority) ? task.priority : 3;
  const clampedPriority = Math.min(5, Math.max(1, priority));
  const raw =
    GRAPH_MIN_RADIUS +
    (clampedPriority - 1) * 1.6 +
    Math.sqrt(Math.max(0, dependentCount)) * 4.2;
  const bounded = Math.min(GRAPH_MAX_RADIUS, raw);
  return connected ? bounded : bounded * ISOLATED_RADIUS_SCALE;
}

/** id → 이 티켓을 기다리는 티켓 수(피의존). 크기 계산의 입력. */
export function countDependents(layout: TaskGraphLayout): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of layout.nodes) out.set(node.id, 0);
  for (const edge of layout.edges) {
    out.set(edge.from, (out.get(edge.from) ?? 0) + 1);
  }
  return out;
}
