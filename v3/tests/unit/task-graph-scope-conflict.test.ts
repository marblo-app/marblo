/**
 * 그래프 뷰 **조율 레이어**의 순수 함수 회귀 — scope 겹침(충돌위험), 정체 여파,
 * 백로그 필드(독립 노드).
 *
 * 이 레이어가 붙은 이유가 곧 이 파일이 지키는 계약이다. 실보드는 1207태스크에
 * 의존이 82개라 dependsOn 만 그리면 노드의 90% 가 고립점이고, 그래프는 예쁘기만
 * 하고 아무 결정도 못 돕는다. 반면 오케가 실제로 다치는 자리는 **같은 파일을 두
 * 에이전트에게 동시에 준 것**이고, 그건 task.scope[] 에 이미 적혀 있다.
 *
 * ★여기서 못 박는 건 셋이다:
 *   ① **겹침 판정이 문자열 동등 비교가 아니다.** `v3/src/lib` 와
 *      `v3/src/lib/foo.ts` 는 같은 자리고, `v3/src/**` 는 그 아래 전부다.
 *      이게 없으면 실제 충돌의 대부분을 놓친다 — 사람은 scope 를 디렉토리로 쓴다.
 *   ② **DONE 은 안 부딪힌다.** 이미 머지된 변경끼리 주황 실타래를 만들면 살아
 *      있는 충돌이 그 안에 묻힌다.
 *   ③ **결정론.** 같은 보드를 두 번 열어 강조가 달라지면 사용자는 그걸 신호로
 *      오해한다(크리티컬 패스와 같은 이유).
 */
import { describe, expect, it } from "vitest";
import { layoutTaskGraph } from "../../src/lib/taskGraphLayout";
import {
  GRAPH_MIN_RADIUS,
  ISOLATED_RADIUS_SCALE,
  MAX_CONFLICT_EDGES,
  STATUS_HEX,
  classifyTaskReadiness,
  computeScopeConflicts,
  computeStuckImpact,
  conflictLinks,
  findIsolatedNodes,
  graphNodeRadius,
  normalizeScopePath,
  scopePathsOverlap,
} from "../../src/lib/taskGraphAnalysis";
import type { Task, TaskStatus } from "../../src/types/task";

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);

function task(
  id: string,
  scope: string[] = [],
  status: TaskStatus = "TODO",
  dependsOn: string[] = [],
): Task {
  return {
    id,
    projectId: "p",
    contextId: "board",
    title: id,
    description: "",
    status,
    role: "frontend",
    priority: 3,
    dependsOn,
    dependsOnCompleted: dependsOn.length === 0,
    claimedBy: null,
    claimedAt: null,
    scope,
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  } as Task;
}

/** 티켓들 → 충돌 결과. readiness 는 뷰가 넘기는 것과 같은 경로로 만든다. */
function conflictsOf(tasks: Task[]) {
  const layout = layoutTaskGraph(tasks);
  return computeScopeConflicts(layout, classifyTaskReadiness(layout));
}

/** 충돌 쌍을 `a⇄b` 문자열 배열로 — 순서 무관 비교용. */
const pairsOf = (tasks: Task[]) =>
  conflictsOf(tasks)
    .edges.map((edge) => `${edge.a}⇄${edge.b}`)
    .sort();

describe("normalizeScopePath — 같은 곳은 같은 문자열로", () => {
  it("앞뒤 슬래시·'./'·중복 슬래시를 턴다", () => {
    expect(normalizeScopePath("./v3/src/")).toBe("v3/src");
    expect(normalizeScopePath("/v3//src")).toBe("v3/src");
    expect(normalizeScopePath("  v3/src  ")).toBe("v3/src");
    // 윈도우 구분자도 같은 자리로 접는다 — 안 그러면 OS 별로 충돌이 갈린다.
    expect(normalizeScopePath("v3\\src\\lib")).toBe("v3/src/lib");
  });

  it("★전역 scope 는 신호가 아니라 잡음이라 버린다", () => {
    // 모든 티켓과 겹친다 = 아무것도 구분해 주지 않는다. 그대로 두면 화면에
    // 완전 그래프 하나가 남아 진짜 충돌이 통째로 묻힌다.
    expect(normalizeScopePath("")).toBeNull();
    expect(normalizeScopePath("   ")).toBeNull();
    expect(normalizeScopePath(".")).toBeNull();
    expect(normalizeScopePath("/")).toBeNull();
    expect(normalizeScopePath("**")).toBeNull();
    expect(normalizeScopePath("**/**")).toBeNull();
  });
});

describe("scopePathsOverlap — 겹침 판정", () => {
  it("동일 경로는 겹친다", () => {
    expect(scopePathsOverlap("v3/src/lib/a.ts", "v3/src/lib/a.ts")).toBe(true);
    // 표기가 달라도 같은 곳이면 겹친다.
    expect(scopePathsOverlap("./v3/src/lib/", "v3/src/lib")).toBe(true);
  });

  it("★서로 다른 경로는 안 겹친다 — 형제 파일도, 형제 디렉토리도", () => {
    expect(scopePathsOverlap("v3/src/lib/a.ts", "v3/src/lib/b.ts")).toBe(false);
    expect(scopePathsOverlap("v3/src/lib", "v3/src/components")).toBe(false);
    expect(scopePathsOverlap("backend/api", "v3/src")).toBe(false);
    // 접두사가 "문자열로" 같아도 조각이 다르면 남이다(v3/src vs v3/srcs).
    expect(scopePathsOverlap("v3/src", "v3/srcs/lib")).toBe(false);
    // 확장자만 다른 파일도 남이다.
    expect(scopePathsOverlap("v3/a.ts", "v3/a.tsx")).toBe(false);
  });

  it("★디렉토리가 파일을 품으면 겹친다 — 실제로 제일 흔한 충돌 모양", () => {
    expect(
      scopePathsOverlap("v3/src/lib", "v3/src/lib/taskGraphForce.ts"),
    ).toBe(true);
    expect(
      scopePathsOverlap("v3/src", "v3/src/components/board/Card.tsx"),
    ).toBe(true);
    // 방향은 무관하다(무향 관계).
    expect(scopePathsOverlap("v3/src/lib/a.ts", "v3/src")).toBe(true);
  });

  it("glob 접두사가 겹친다", () => {
    expect(
      scopePathsOverlap(
        "v3/src/components/**",
        "v3/src/components/board/x.tsx",
      ),
    ).toBe(true);
    expect(scopePathsOverlap("v3/src/**", "v3/src")).toBe(true);
    expect(scopePathsOverlap("v3/*/lib", "v3/src/lib")).toBe(true);
    expect(
      scopePathsOverlap("v3/src/**/*.test.ts", "v3/src/lib/a.test.ts"),
    ).toBe(true);
    // 조각 안 부분 glob 도 매칭된다.
    expect(scopePathsOverlap("v3/src/task*.ts", "v3/src/taskGraph.ts")).toBe(
      true,
    );
  });

  it("glob 이 아무거나 삼키지는 않는다", () => {
    expect(scopePathsOverlap("v3/src/components/**", "backend/api")).toBe(
      false,
    );
    expect(scopePathsOverlap("v3/*/lib", "v3/src/components/lib")).toBe(false);
    // ★`**/*.test.ts` 가 같은 트리 아래 **일반 파일**까지 먹으면 안 된다.
    // 확장자로 끝난 조각은 그 아래에 아무것도 없다는 뜻이라 접두사가 못 된다.
    expect(scopePathsOverlap("v3/src/**/*.test.ts", "v3/src/lib/impl.ts")).toBe(
      false,
    );
    // 다만 디렉토리라면 그 아래에 테스트 파일이 있을 수 있으므로 겹친다.
    expect(scopePathsOverlap("v3/src/**/*.test.ts", "v3/src/lib")).toBe(true);
  });

  it("전역/빈 scope 는 아무와도 안 겹친다", () => {
    expect(scopePathsOverlap("", "v3/src")).toBe(false);
    expect(scopePathsOverlap("**", "v3/src")).toBe(false);
  });
});

describe("computeScopeConflicts — 충돌 간선", () => {
  it("scope 가 없으면 간선도 없다", () => {
    const result = conflictsOf([task("a"), task("b")]);
    expect(result.edges).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("★같은 경로를 적은 두 티켓은 충돌 간선으로 이어진다", () => {
    const result = conflictsOf([
      task("a", ["v3/src/lib/taskGraphForce.ts"]),
      task("b", ["v3/src/lib/taskGraphForce.ts"]),
    ]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].a).toBe("a");
    expect(result.edges[0].b).toBe("b");
    // 무엇 때문에 부딪히는지가 같이 와야 사용자가 scope 를 가를 수 있다.
    expect(result.edges[0].paths).toEqual(["v3/src/lib/taskGraphForce.ts"]);
    // 무향이라 양쪽 다 이웃으로 잡힌다(호버 강조가 한쪽만 켜지면 안 된다).
    expect([...result.neighbors.get("a")!]).toEqual(["b"]);
    expect([...result.neighbors.get("b")!]).toEqual(["a"]);
  });

  it("★서로 다른 scope 면 간선이 안 생긴다", () => {
    expect(
      pairsOf([
        task("a", ["v3/src/lib/a.ts"]),
        task("b", ["v3/src/lib/b.ts"]),
        task("c", ["backend/api"]),
      ]),
    ).toEqual([]);
  });

  it("디렉토리와 그 아래 파일도 이어진다", () => {
    expect(
      pairsOf([
        task("dir", ["v3/src/components"]),
        task("file", ["v3/src/components/board/TaskCard.tsx"]),
        task("other", ["v3/src/stores"]),
      ]),
    ).toEqual(["dir⇄file"]);
  });

  it("glob 겹침도 이어진다", () => {
    expect(
      pairsOf([
        task("glob", ["v3/src/components/**"]),
        task("file", ["v3/src/components/board/TaskCard.tsx"]),
        task("far", ["backend/api/tasks.py"]),
      ]),
    ).toEqual(["file⇄glob"]);
  });

  it("한 티켓이 scope 를 여러 개 적으면 각각으로 이어진다", () => {
    const result = conflictsOf([
      task("hub", ["v3/src/lib", "backend/api"]),
      task("fe", ["v3/src/lib/x.ts"]),
      task("be", ["backend/api/tasks.py"]),
    ]);
    expect(result.edges.map((e) => e.id).sort()).toEqual(["be⇄hub", "fe⇄hub"]);
  });

  it("겹치는 경로가 여러 개면 모아서 보여 준다(최대 3개)", () => {
    const shared = ["v3/a.ts", "v3/b.ts", "v3/c.ts", "v3/d.ts"];
    const result = conflictsOf([task("x", shared), task("y", shared)]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].paths).toHaveLength(3);
  });

  it("★DONE 티켓은 아예 빠진다 — 이미 머지된 변경은 안 부딪힌다", () => {
    const path = ["v3/src/lib/x.ts"];
    // done↔done 도, done↔열린 티켓도 간선이 아니다.
    expect(
      pairsOf([
        task("d1", path, "DONE"),
        task("d2", path, "DONE"),
        task("open", path),
      ]),
    ).toEqual([]);
    // 열린 티켓이 둘이면 그때는 이어진다(대조군).
    expect(
      pairsOf([
        task("d1", path, "DONE"),
        task("open1", path),
        task("open2", path),
      ]),
    ).toEqual(["open1⇄open2"]);
  });

  it("대기·정체 티켓은 남는다 — 언젠간 돌고, 정체는 워크트리를 붙들고 있다", () => {
    const path = ["v3/src/lib/x.ts"];
    expect(
      pairsOf([
        task("ready", path),
        task("blocked", path, "BLOCKED"),
        task("waiting", path, "TODO", ["ready"]),
      ]),
    ).toEqual(["blocked⇄ready", "ready⇄waiting", "blocked⇄waiting"].sort());
  });

  it("자기 자신과는 안 부딪힌다(같은 경로를 두 번 적어도)", () => {
    expect(
      pairsOf([task("solo", ["v3/src", "v3/src/lib", "./v3/src/"])]),
    ).toEqual([]);
  });

  it("★결정론 — 같은 보드를 두 번 계산하면 간선 순서까지 같다", () => {
    const tasks = [
      task("a", ["v3/src/lib"]),
      task("b", ["v3/src/lib/x.ts"]),
      task("c", ["v3/src/lib/**"]),
    ];
    const first = conflictsOf(tasks).edges.map((e) => e.id);
    const second = conflictsOf(tasks).edges.map((e) => e.id);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
  });

  it("★상한에 걸리면 조용히 자르지 않고 truncated 로 알린다", () => {
    // 같은 경로를 공유하는 티켓 N 장이면 쌍은 N(N-1)/2 라 금방 상한을 넘는다.
    const shared = ["v3/src/lib/hot.ts"];
    const many: Task[] = [];
    for (let i = 0; i < 120; i += 1) many.push(task(`t${i}`, shared));
    const result = conflictsOf(many);
    expect(result.edges.length).toBe(MAX_CONFLICT_EDGES);
    expect(result.truncated).toBe(true);
  });

  it("큰 보드에서도 계산이 한순간에 끝난다(자릿수 감시)", () => {
    // scope 조각 쌍을 첫 조각 리터럴 비교로 걸러 내는 최적화가 사라지면
    // 여기서 눈에 띄게 느려진다. 벤치가 아니라 알고리즘 감시다.
    // 400 개의 서로 다른 경로를 3장씩 나눠 갖는다 → 겹침은 400×3=1200 쌍이고,
    // 나머지 조각 쌍(약 8만)은 첫 조각 비교에서 즉시 걸러져야 한다.
    const many: Task[] = [];
    for (let i = 0; i < 1200; i += 1) {
      many.push(task(`t${i}`, [`pkg${i % 400}/src/file${i % 400}.ts`]));
    }
    const started = performance.now();
    const result = conflictsOf(many);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(result.edges.length).toBe(1200);
  });
});

describe("computeScopeConflicts — 충돌 클러스터", () => {
  it("★동시에 던질 수 있는(ready/active) 티켓만 클러스터가 된다", () => {
    const path = ["v3/src/lib/x.ts"];
    const result = conflictsOf([
      task("ready", path),
      task("running", path, "IN_PROGRESS"),
      // 대기 티켓은 간선은 있지만 지금 던질 수 없으니 클러스터엔 안 든다.
      task("waiting", path, "TODO", ["ready"]),
    ]);
    expect(result.edges.length).toBe(3);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].ids).toEqual(["ready", "running"]);
    expect(result.clusters[0].paths).toEqual(["v3/src/lib/x.ts"]);
  });

  it("혼자면 클러스터가 아니다", () => {
    const result = conflictsOf([
      task("ready", ["v3/src/lib/x.ts"]),
      task("waiting", ["v3/src/lib/x.ts"], "TODO", ["ready"]),
    ]);
    expect(result.clusters).toEqual([]);
  });

  it("떨어진 덩어리는 따로 세고, 큰 덩어리가 먼저 온다", () => {
    const result = conflictsOf([
      task("small1", ["backend/api"]),
      task("small2", ["backend/api"]),
      task("big1", ["v3/src/lib"]),
      task("big2", ["v3/src/lib/a.ts"]),
      task("big3", ["v3/src/lib/b.ts"]),
    ]);
    expect(result.clusters.map((c) => c.ids)).toEqual([
      ["big1", "big2", "big3"],
      ["small1", "small2"],
    ]);
  });

  it("scope 가 겹쳐도 전부 DONE 이면 클러스터가 없다", () => {
    const path = ["v3/src/lib/x.ts"];
    const result = conflictsOf([
      task("a", path, "DONE"),
      task("b", path, "DONE"),
    ]);
    expect(result.clusters).toEqual([]);
  });
});

describe("computeStuckImpact — 정체의 폭발 반경", () => {
  const impactOf = (tasks: Task[]) => {
    const layout = layoutTaskGraph(tasks);
    return computeStuckImpact(layout, classifyTaskReadiness(layout));
  };

  it("정체가 없으면 빈 결과다", () => {
    const impact = impactOf([task("a"), task("b", [], "TODO", ["a"])]);
    expect(impact.stuckIds.size).toBe(0);
    expect(impact.downstreamIds.size).toBe(0);
    expect(impact.edgeIds.size).toBe(0);
  });

  it("★막힌 티켓의 후행을 이행적으로 전부 센다", () => {
    // blocked → b → c, 그리고 무관한 z.
    const impact = impactOf([
      task("blocked", [], "BLOCKED"),
      task("b", [], "TODO", ["blocked"]),
      task("c", [], "TODO", ["b"]),
      task("z"),
    ]);
    expect([...impact.stuckIds]).toEqual(["blocked"]);
    expect([...impact.downstreamIds].sort()).toEqual(["b", "c"]);
    expect([...impact.edgeIds].sort()).toEqual(["blocked→b", "b→c"].sort());
  });

  it("정체 티켓끼리는 서로의 여파로 안 센다(빨강을 두 겹으로 칠할 이유가 없다)", () => {
    const impact = impactOf([
      task("s1", [], "FAILED"),
      task("s2", [], "BLOCKED", ["s1"]),
      task("after", [], "TODO", ["s2"]),
    ]);
    expect([...impact.stuckIds].sort()).toEqual(["s1", "s2"]);
    expect([...impact.downstreamIds]).toEqual(["after"]);
  });

  it("선행은 여파가 아니다 — 막힌 티켓 위쪽은 이미 끝났거나 무관하다", () => {
    const impact = impactOf([
      task("before"),
      task("blocked", [], "BLOCKED", ["before"]),
    ]);
    expect([...impact.downstreamIds]).toEqual([]);
  });

  it("★순환이 있어도 멈추지 않는다", () => {
    const impact = impactOf([
      task("a", [], "BLOCKED", ["c"]),
      task("b", [], "TODO", ["a"]),
      task("c", [], "TODO", ["b"]),
    ]);
    expect(impact.stuckIds.has("a")).toBe(true);
    // 노드가 유한 집합이라 여파도 유한하다(무한 루프면 여기서 앱이 얼어붙는다).
    expect(impact.downstreamIds.size).toBeLessThanOrEqual(2);
  });
});

describe("독립 노드 = 백로그 필드", () => {
  it("의존도 scope 겹침도 없는 노드만 독립이다", () => {
    const tasks = [
      task("dep1"),
      task("dep2", [], "TODO", ["dep1"]),
      task("clash1", ["v3/src/lib"]),
      task("clash2", ["v3/src/lib/x.ts"]),
      task("alone"),
      task("aloneWithScope", ["backend/only/mine.py"]),
    ];
    const layout = layoutTaskGraph(tasks);
    const conflicts = computeScopeConflicts(
      layout,
      classifyTaskReadiness(layout),
    );
    const isolated = findIsolatedNodes(layout, conflicts);
    // scope 가 있어도 남과 안 겹치면 여전히 독립이다 — 관계가 없다는 게 요점이다.
    expect([...isolated].sort()).toEqual(["alone", "aloneWithScope"]);
  });

  it("★독립 노드는 작게 그린다(연결 클러스터가 화면을 갖게)", () => {
    const connected = graphNodeRadius(task("a"), 0, true);
    const isolated = graphNodeRadius(task("a"), 0, false);
    expect(isolated).toBeLessThan(connected);
    expect(isolated).toBeCloseTo(connected * ISOLATED_RADIUS_SCALE, 6);
    // 그래도 클릭할 수 있을 만큼은 남는다.
    expect(isolated).toBeGreaterThan(GRAPH_MIN_RADIUS * 0.5);
  });

  it("기본값은 연결로 친다 — 기존 호출부가 안 바뀐다", () => {
    expect(graphNodeRadius(task("a"), 2)).toBe(
      graphNodeRadius(task("a"), 2, true),
    );
  });

  it("충돌 간선은 시뮬의 무향 연결로 넘어간다(뭉치게 만드는 힘)", () => {
    const conflicts = conflictsOf([
      task("a", ["v3/src/lib"]),
      task("b", ["v3/src/lib/x.ts"]),
    ]);
    expect(conflictLinks(conflicts)).toEqual([["a", "b"]]);
  });
});

describe("상태색 — 캔버스가 칸반과 같은 말을 한다", () => {
  it("모든 상태에 색이 있고, 서로 다르다", () => {
    const statuses: TaskStatus[] = [
      "TODO",
      "CLAIMED",
      "IN_PROGRESS",
      "REVIEW",
      "BLOCKED",
      "FAILED",
      "DONE",
    ];
    for (const status of statuses) {
      expect(STATUS_HEX[status]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // 두 상태가 같은 색이면 노드 색은 정보가 아니라 장식이 된다.
    expect(new Set(Object.values(STATUS_HEX)).size).toBe(statuses.length);
  });
});
