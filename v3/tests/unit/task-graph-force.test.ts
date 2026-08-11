/**
 * 포스-다이렉티드 시뮬레이터 회귀.
 *
 * d3-force 를 안 끌어오고 손으로 적분하기로 한 대가가 여기다 — 라이브러리라면
 * 남이 검증해 줬을 것들(수렴, NaN 안전, 결정론)을 직접 못 박는다. 시뮬을 RAF 와
 * 분리해 `step()` 호출 수로 시간을 세는 설계라서 이게 가능하다.
 *
 * ★특히 네 가지가 회귀하면 뷰가 조용히 쓸모없어진다:
 *   ① 레이어 x 앵커 — 무너지면 "왼쪽이 먼저" 라는 읽기 규칙이 사라져, 예쁘지만
 *      의존 방향을 못 읽는 그래프가 된다.
 *   ② 결정론 — 같은 보드를 두 번 열어 배치가 달라지면 사용자는 기억으로 노드를
 *      못 찾고, 스크린샷 기반 회귀도 전부 깨진다.
 *   ③ ★**면적을 채우는 배치**(아래 "실보드 모양" 블록). 이게 무너진 게 이 파일이
 *      고친 실제 버그다: 레이아웃의 level 은 의존 깊이라 의존 없는 티켓이 전부
 *      0 이고, 실보드는 1207태스크에 의존이 82개뿐이라 1100개 넘는 노드가 한
 *      컬럼에 세로로 쌓였다. x-앵커가 그걸 계속 되당겨서 화면이 세로 일자가 됐다.
 *      "종횡비가 대략 정사각형" 은 취향이 아니라 그 증상의 직접적인 반대말이다.
 *   ④ **클러스터가 보일 것.** 연결된 티켓이 무작위 티켓보다 눈에 띄게 가까워야
 *      의존 관계가 그림에서 읽힌다 — 그게 이 뷰의 존재 이유다.
 */
import { describe, expect, it } from "vitest";
import { layoutTaskGraph } from "../../src/lib/taskGraphLayout";
import {
  ALPHA_MIN,
  createTaskGraphSimulation,
  fitGraphToViewport,
  hitTest,
  recommendedWarmUpTicks,
  warmUp,
  type TaskGraphSimulation,
} from "../../src/lib/taskGraphForce";
import type { Task } from "../../src/types/task";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

function task(id: string, dependsOn: string[] = []): Task {
  return {
    id,
    projectId: "p",
    contextId: "board",
    title: id,
    description: "",
    status: "TODO",
    role: "frontend",
    priority: 3,
    dependsOn,
    dependsOnCompleted: dependsOn.length === 0,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  } as Task;
}

const simOf = (tasks: Task[], radius = 12) =>
  createTaskGraphSimulation(layoutTaskGraph(tasks), { radiusOf: () => radius });

const xOf = (sim: ReturnType<typeof simOf>, id: string) =>
  sim.byId.get(id)?.x ?? Number.NaN;

const allFinite = (sim: ReturnType<typeof simOf>) =>
  sim.nodes.every(
    (node) =>
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      Number.isFinite(node.vx) &&
      Number.isFinite(node.vy),
  );

/**
 * 실보드 모사 — 티켓은 많고 의존은 드물다. 실측이 1207태스크/82의존이라 고립
 * 노드가 ~1100개인데, 예전 시드는 그걸 전부 한 컬럼에 세웠다. `deps` 개의
 * 2노드 컴포넌트 + 나머지 전부 고립으로 그 비율을 재현한다.
 */
function sparseBoard(count: number, deps: number): Task[] {
  const tasks: Task[] = [];
  for (let i = 0; i < count; i += 1) tasks.push(task(`t${i}`));
  let made = 0;
  for (let i = 1; i < count && made < deps; i += 7) {
    tasks[i] = task(`t${i}`, [`t${i - 1}`]);
    made += 1;
  }
  return tasks;
}

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

const stdDev = (values: number[]) => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
};

/** 종횡비(가로/세로). 세로 일자면 0 에 가깝고, 정사각형이면 1 이다. */
const aspectOf = (sim: TaskGraphSimulation) => {
  const bounds = sim.bounds();
  return (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
};

const distance = (sim: TaskGraphSimulation, a: string, b: string): number => {
  const p = sim.byId.get(a)!;
  const q = sim.byId.get(b)!;
  return Math.hypot(q.x - p.x, q.y - p.y);
};

describe("createTaskGraphSimulation — 수렴", () => {
  it("빈 그래프에서 즉시 정착한다", () => {
    const sim = simOf([]);
    sim.step();
    expect(sim.settled()).toBe(true);
    expect(sim.nodes).toEqual([]);
    expect(sim.bounds()).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("500틱 안에 식는다(뷰가 RAF 를 멈출 수 있다)", () => {
    const sim = simOf([
      task("a"),
      task("b", ["a"]),
      task("c", ["b"]),
      task("d", ["a"]),
      task("e", ["d"]),
    ]);
    warmUp(sim, 500);
    expect(sim.settled()).toBe(true);
    expect(sim.alpha).toBeLessThanOrEqual(ALPHA_MIN);
  });

  it("reheat 하면 다시 움직인다(노드를 끌었을 때)", () => {
    const sim = simOf([task("a"), task("b", ["a"])]);
    warmUp(sim, 500);
    expect(sim.settled()).toBe(true);
    sim.reheat();
    expect(sim.settled()).toBe(false);
  });
});

describe("createTaskGraphSimulation — 읽히는 배치", () => {
  it("★사슬은 좌→우 순서를 유지한다(레이어 x 앵커)", () => {
    const sim = simOf([task("a"), task("b", ["a"]), task("c", ["b"])]);
    warmUp(sim, 400);
    expect(xOf(sim, "a")).toBeLessThan(xOf(sim, "b"));
    expect(xOf(sim, "b")).toBeLessThan(xOf(sim, "c"));
  });

  it("연결된 두 노드는 스프링 자연 길이 근처로 모인다", () => {
    const sim = simOf([task("a"), task("b", ["a"])]);
    warmUp(sim, 500);
    const a = sim.byId.get("a")!;
    const b = sim.byId.get("b")!;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    // 자연 길이 120 + x 앵커(레이어 간격)가 서로 당긴다 — 정확한 값이 아니라
    // "붙지도 날아가지도 않았다" 를 고정한다.
    expect(distance).toBeGreaterThan(60);
    expect(distance).toBeLessThan(400);
  });

  it("★서로 겹치지 않는다 — 반지름이 큰 노드끼리도", () => {
    const sim = simOf(
      [task("a"), task("b"), task("c"), task("d"), task("e")],
      24,
    );
    warmUp(sim, 500);
    for (let i = 0; i < sim.nodes.length; i += 1) {
      for (let j = i + 1; j < sim.nodes.length; j += 1) {
        const p = sim.nodes[i];
        const q = sim.nodes[j];
        const distance = Math.hypot(q.x - p.x, q.y - p.y);
        // 충돌 해소는 반지름 합 + 여백까지 민다. 수치 오차만 봐준다.
        expect(distance).toBeGreaterThan(p.radius + q.radius - 1);
      }
    }
  });

  it("핀으로 고정한 노드는 움직이지 않는다(드래그 중)", () => {
    const sim = simOf([task("a"), task("b", ["a"]), task("c", ["a"])]);
    const a = sim.byId.get("a")!;
    a.pinned = true;
    a.x = 500;
    a.y = -300;
    warmUp(sim, 200);
    expect(a.x).toBe(500);
    expect(a.y).toBe(-300);
  });
});

describe("createTaskGraphSimulation — 안전성", () => {
  it("★순환 의존에서도 발산하거나 NaN 이 되지 않는다", () => {
    const sim = simOf([task("a", ["c"]), task("b", ["a"]), task("c", ["b"])]);
    warmUp(sim, 600);
    expect(allFinite(sim)).toBe(true);
    const bounds = sim.bounds();
    expect(bounds.maxX - bounds.minX).toBeLessThan(10_000);
    expect(bounds.maxY - bounds.minY).toBeLessThan(10_000);
  });

  it("완전히 겹친 좌표에서 출발해도 갈라진다(0 나눗셈 없음)", () => {
    const layout = layoutTaskGraph([task("a"), task("b"), task("c")]);
    const coincident = new Map(
      layout.nodes.map((node) => [node.id, { x: 0, y: 0 }]),
    );
    const sim = createTaskGraphSimulation(layout, { previous: coincident });
    warmUp(sim, 300);
    expect(allFinite(sim)).toBe(true);
    const a = sim.byId.get("a")!;
    const b = sim.byId.get("b")!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(1);
  });

  it("노드 하나짜리 보드도 죽지 않는다", () => {
    const sim = simOf([task("solo")]);
    warmUp(sim, 200);
    expect(allFinite(sim)).toBe(true);
  });

  it("★결정론 — 같은 입력을 두 번 돌리면 좌표가 완전히 같다", () => {
    const tasks = [
      task("a"),
      task("b", ["a"]),
      task("c", ["a"]),
      task("d", ["b", "c"]),
    ];
    const first = simOf(tasks);
    const second = simOf(tasks);
    warmUp(first, 250);
    warmUp(second, 250);
    expect(first.snapshot()).toEqual(second.snapshot());
  });
});

describe("createTaskGraphSimulation — 스냅샷 이어받기", () => {
  it("살아남은 노드는 있던 자리에서 이어 간다(보드 갱신 때 안 흩어진다)", () => {
    const before = simOf([task("a"), task("b", ["a"])]);
    warmUp(before, 400);
    const snapshot = before.snapshot();

    // 티켓 한 장이 추가된 다음 스냅샷.
    const after = createTaskGraphSimulation(
      layoutTaskGraph([task("a"), task("b", ["a"]), task("c", ["b"])]),
      { previous: snapshot },
    );
    const carried = after.byId.get("a")!;
    const original = snapshot.get("a")!;
    // jitter(결정론적 흔들기) 폭인 0.5px 안쪽이면 "이어받았다".
    expect(Math.abs(carried.x - original.x)).toBeLessThan(1);
    expect(Math.abs(carried.y - original.y)).toBeLessThan(1);
    // 처음 보는 노드는 레이아웃 시드에서 출발한다.
    expect(after.byId.get("c")).toBeTruthy();
  });
});

/**
 * ★이 블록이 "그래프 뷰가 세로 일자로 뭉친다" 버그의 회귀다.
 *
 * 하나하나가 아니라 셋이 같이 서야 의미가 있다: 정사각형으로 퍼지되(①②),
 * 연결된 것끼리는 여전히 뭉쳐야 한다(③). ①②만 보면 전부 균등하게 흩뿌려
 * 의존이 안 보이는 그림도 통과하고, ③만 보면 예전처럼 한 줄로 겹쳐 놔도 통과한다.
 */
describe("createTaskGraphSimulation — 실보드 모양(의존이 드문 큰 보드)", () => {
  it("★① 예열 후 bounds 종횡비가 대략 정사각형이다(세로 일자 회귀)", () => {
    const sim = simOf(sparseBoard(600, 40));
    warmUp(sim, recommendedWarmUpTicks(600));
    const aspect = aspectOf(sim);
    // 예전 배치는 이 값이 0.05 언저리였다(한 컬럼 + 600행). 정확한 1.0 을
    // 요구하는 게 아니라 "한 축으로 납작하지 않다" 를 못 박는다.
    expect(aspect).toBeGreaterThan(0.75);
    expect(aspect).toBeLessThan(1.34);
  });

  it("★② 고립 노드가 2D 로 퍼진다 — x·y 분산이 둘 다 유의미하다", () => {
    const tasks = sparseBoard(600, 40);
    const sim = simOf(tasks);
    warmUp(sim, recommendedWarmUpTicks(600));

    // 고립 노드는 x 앵커가 없다 — 있으면 이웃도 없는 점들이 한 컬럼에 줄을 선다.
    const isolated = sim.nodes.filter((node) => node.anchorX === null);
    expect(isolated.length).toBe(600 - 40 * 2);

    const sdX = stdDev(isolated.map((node) => node.x));
    const sdY = stdDev(isolated.map((node) => node.y));
    // 노드 간격(≥64px)의 몇 배는 돼야 "퍼졌다" 고 할 수 있다.
    expect(sdX).toBeGreaterThan(200);
    expect(sdY).toBeGreaterThan(200);
    // 두 축이 비슷해야 등방이다. 예전 배치는 sdX 가 0 에 가까웠다.
    expect(sdX / sdY).toBeGreaterThan(0.7);
    expect(sdX / sdY).toBeLessThan(1.43);

    // 한 컬럼에 쌓였는지를 직접 세는 단언 — 분산보다 증상에 가깝다.
    const columns = new Set(isolated.map((node) => Math.round(node.x / 100)));
    expect(columns.size).toBeGreaterThan(10);
  });

  it("★③ 연결된 두 노드가 무작위 두 노드보다 평균적으로 가깝다(클러스터)", () => {
    const tasks = sparseBoard(600, 40);
    const layout = layoutTaskGraph(tasks);
    const sim = createTaskGraphSimulation(layout, { radiusOf: () => 12 });
    warmUp(sim, recommendedWarmUpTicks(600));

    const connected = mean(
      layout.edges.map((edge) => distance(sim, edge.from, edge.to)),
    );
    // 무작위 쌍 — 결정론을 지키려고 서로 소인 보폭으로 훑는다(Math.random 금지).
    const random: number[] = [];
    for (let k = 0; k < 2000; k += 1) {
      const a = sim.nodes[(k * 137) % sim.nodes.length];
      const b = sim.nodes[(k * 331 + 17) % sim.nodes.length];
      if (a === b) continue;
      random.push(Math.hypot(b.x - a.x, b.y - a.y));
    }

    expect(connected).toBeLessThan(mean(random) * 0.5);
  });

  it("서로 다른 컴포넌트는 같은 컬럼에 겹치지 않는다(앵커가 상대 좌표다)", () => {
    // 2노드 사슬 여러 개. x 앵커가 절대 좌표(level * 간격)면 컴포넌트가 전부
    // 같은 두 컬럼으로 끌려와 세로로 겹친다 — 고립 노드와 같은 병.
    const sim = simOf(sparseBoard(300, 40));
    warmUp(sim, recommendedWarmUpTicks(300));
    const heads: number[] = [];
    for (let i = 1; i < 300; i += 7) {
      heads.push(sim.byId.get(`t${i - 1}`)!.x);
    }
    expect(heads.length).toBeGreaterThan(20);
    expect(stdDev(heads)).toBeGreaterThan(150);
  });

  it("큰 보드에서도 결정론과 노드 간 최소 간격이 지켜진다", () => {
    const tasks = sparseBoard(600, 40);
    const first = simOf(tasks);
    const second = simOf(tasks);
    warmUp(first, 120);
    warmUp(second, 120);
    expect(first.snapshot()).toEqual(second.snapshot());

    // 충돌 해소가 밀도에 지지 않는지 — 간격이 노드 수에 따라 좁아지면 큰 보드
    // 에서만 노드가 겹친 채 부글거린다.
    let closest = Infinity;
    for (let i = 0; i < first.nodes.length; i += 1) {
      for (let j = i + 1; j < first.nodes.length; j += 1) {
        const a = first.nodes[i];
        const b = first.nodes[j];
        const gap = Math.hypot(b.x - a.x, b.y - a.y);
        if (gap < closest) closest = gap;
      }
    }
    expect(closest).toBeGreaterThan(12 + 12 - 1);
  });

  it("★4000 노드 예열이 O(n²) 로 돌아가지 않는다(공간 격자)", () => {
    // 벤치가 아니라 **자릿수 감시**다. 격자를 걷어내고 전수 비교로 되돌리면
    // 이 크기에서 수 초가 걸린다(측정: 격자 ~0.1초 / 전수 ~3초). 느린 CI 를
    // 감안해 한참 넉넉한 천장만 둔다 — 여기 걸리면 성능이 아니라 알고리즘이
    // 바뀐 것이다.
    const tasks = sparseBoard(4000, 200);
    const started = performance.now();
    const sim = simOf(tasks);
    warmUp(sim, recommendedWarmUpTicks(4000));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(allFinite(sim)).toBe(true);
  });
});

/**
 * ★scope 겹침(충돌위험)이 배치에 미치는 영향.
 *
 * 새 간선을 그리기만 하고 배치를 그대로 두면, 부딪히는 티켓 두 장이 화면 반대편에
 * 앉은 채 주황 선 하나로 이어진 그림이 나온다 — 선이 화면을 가로지르기만 하고
 * "이것들이 한 덩어리다" 는 안 읽힌다. 그래서 컴포넌트 분해와 스프링에 같이
 * 넣는데, **그러면서 Phase 2 의 정사각형 확산 불변식이 깨지면 안 된다**. 둘을
 * 같이 재는 게 이 블록의 존재 이유다.
 */
describe("createTaskGraphSimulation — scope 겹침 연결(extraLinks)", () => {
  const withLinks = (tasks: Task[], links: [string, string][]) =>
    createTaskGraphSimulation(layoutTaskGraph(tasks), {
      radiusOf: () => 12,
      extraLinks: links,
    });

  it("★충돌로 이어진 두 노드가 무작위 두 노드보다 가깝다(클러스터로 읽힌다)", () => {
    const tasks = sparseBoard(300, 0);
    // 30 쌍을 충돌로 잇는다 — 의존은 하나도 없는 보드다.
    const links: [string, string][] = [];
    for (let i = 0; i < 60; i += 2) links.push([`t${i}`, `t${i + 1}`]);

    const sim = withLinks(tasks, links);
    warmUp(sim, recommendedWarmUpTicks(300));

    const linked = mean(links.map(([a, b]) => distance(sim, a, b)));
    const random: number[] = [];
    for (let k = 0; k < 2000; k += 1) {
      const a = sim.nodes[(k * 137) % sim.nodes.length];
      const b = sim.nodes[(k * 331 + 17) % sim.nodes.length];
      if (a === b) continue;
      random.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    expect(linked).toBeLessThan(mean(random) * 0.5);
  });

  it("★레벨 폭이 0 인 덩어리에는 x 앵커를 안 건다(세로 일자 재발 방지)", () => {
    // 충돌로만 묶인 티켓들은 의존이 없어 전부 level 0 이다. 여기에 x 앵커를
    // 걸면 덩어리 전체가 같은 x 로 끌려가 한 컬럼에 줄을 선다 — 이 파일이 이미
    // 한 번 고친 바로 그 병이다.
    const tasks = [task("a"), task("b"), task("c"), task("d")];
    const sim = withLinks(tasks, [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ]);
    expect(sim.nodes.every((node) => node.anchorX === null)).toBe(true);

    warmUp(sim, 400);
    const columns = new Set(sim.nodes.map((node) => Math.round(node.x / 40)));
    expect(columns.size).toBeGreaterThan(1);
  });

  it("의존이 있는 덩어리는 좌→우 읽기 규칙을 그대로 지킨다", () => {
    // 충돌 간선이 붙어도 의존 스프링(2배 강함)이 순서를 이긴다.
    const sim = withLinks(
      [task("a"), task("b", ["a"]), task("c", ["b"])],
      [["a", "c"]],
    );
    warmUp(sim, 400);
    expect(xOf(sim, "a")).toBeLessThan(xOf(sim, "b"));
    expect(xOf(sim, "b")).toBeLessThan(xOf(sim, "c"));
  });

  it("★충돌 간선이 빽빽해도 정사각형 확산 불변식이 유지된다", () => {
    const tasks = sparseBoard(600, 40);
    // 고립 노드를 5장씩 묶는 충돌 덩어리를 잔뜩 만든다.
    const links: [string, string][] = [];
    for (let i = 0; i < 400; i += 5) {
      for (let k = 1; k < 5; k += 1) links.push([`t${i}`, `t${i + k}`]);
    }
    const sim = withLinks(tasks, links);
    warmUp(sim, recommendedWarmUpTicks(600));
    expect(aspectOf(sim)).toBeGreaterThan(0.75);
    expect(aspectOf(sim)).toBeLessThan(1.34);
    expect(allFinite(sim)).toBe(true);
  });

  it("결정론과 안전성이 그대로다(자기참조·유령 id 포함)", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const links: [string, string][] = [
      ["a", "b"],
      ["a", "a"], // 자기참조 — 스프링이 0 나눗셈으로 터지면 안 된다
      ["a", "ghost"], // 삭제된 티켓을 가리키는 링크
    ];
    const first = withLinks(tasks, links);
    const second = withLinks(tasks, links);
    warmUp(first, 300);
    warmUp(second, 300);
    expect(allFinite(first)).toBe(true);
    expect(first.snapshot()).toEqual(second.snapshot());
  });
});

describe("recommendedWarmUpTicks", () => {
  it("작은 보드는 넉넉히, 큰 보드는 덜 익힌다(동기 예열이 곧 프리즈 시간)", () => {
    expect(recommendedWarmUpTicks(0)).toBe(0);
    expect(recommendedWarmUpTicks(50)).toBe(140);
    expect(recommendedWarmUpTicks(1207)).toBeLessThan(140);
    // 아무리 커도 바닥은 있다 — 덜 익은 채 뜨면 점들이 모여드는 게 보인다.
    expect(recommendedWarmUpTicks(100_000)).toBe(40);
  });
});

/**
 * 화면 맞춤 — 시드가 원반으로 바뀌면서 그래프 한 변이 √(노드 수)에 비례하게
 * 됐다(1200 티켓 ≈ 3000px). "정말 다 들어오나" 가 회귀 대상이 된 이유고,
 * jsdom 에는 레이아웃이 없어 캔버스 렌더 테스트로는 못 재는 이유다.
 */
describe("fitGraphToViewport", () => {
  const options = {
    padding: 56,
    minZoom: 0.05,
    maxZoom: 2.5,
    maxFitZoom: 1.1,
  };

  it("★1200 티켓짜리 정사각형 그래프가 창 안에 통째로 들어온다", () => {
    const bounds = { minX: -1500, minY: -1500, maxX: 1500, maxY: 1500 };
    const width = 900;
    const height = 620;
    const view = fitGraphToViewport(bounds, width, height, options);

    const project = (x: number, y: number) => ({
      x: x * view.k + view.x,
      y: y * view.k + view.y,
    });
    const topLeft = project(bounds.minX, bounds.minY);
    const bottomRight = project(bounds.maxX, bounds.maxY);

    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(width);
    expect(bottomRight.y).toBeLessThanOrEqual(height);
    // 짧은 변에 딱 맞아야 "꽉 찬다" — 절반만 쓰면 노드가 죽처럼 뭉쳐 보인다.
    expect(bottomRight.y - topLeft.y).toBeGreaterThan(
      height - options.padding * 2 - 1,
    );
  });

  it("그래프 중심이 화면 중심에 온다", () => {
    const bounds = { minX: 200, minY: -600, maxX: 1000, maxY: 200 };
    const view = fitGraphToViewport(bounds, 800, 600, options);
    expect(600 * view.k + view.x).toBeCloseTo(400, 6);
    expect(-200 * view.k + view.y).toBeCloseTo(300, 6);
  });

  it("★하한 줌이 화면 맞춤을 자르지 않는다(아주 큰 보드)", () => {
    // 한 변 5000px ≈ 3000 티켓짜리 보드. 필요한 배율이 0.1 인데 하한이 예전
    // 값(0.2)이면 여기서 잘려 가장자리 노드가 영영 화면 밖에 남는다.
    const bounds = { minX: -2500, minY: -2500, maxX: 2500, maxY: 2500 };
    const view = fitGraphToViewport(bounds, 800, 600, options);
    expect(view.k).toBeGreaterThan(options.minZoom);
    expect(view.k).toBeLessThan(0.2);
    expect(5000 * view.k).toBeLessThanOrEqual(600);
  });

  it("노드 몇 개짜리 보드를 억지로 확대하지 않는다", () => {
    const bounds = { minX: -40, minY: -40, maxX: 40, maxY: 40 };
    const view = fitGraphToViewport(bounds, 1200, 900, options);
    expect(view.k).toBe(options.maxFitZoom);
  });

  it("패널이 여백보다 좁아도 배율이 뒤집히지 않는다", () => {
    const bounds = { minX: 0, minY: 0, maxX: 500, maxY: 500 };
    const view = fitGraphToViewport(bounds, 80, 60, options);
    expect(view.k).toBeGreaterThan(0);
    expect(Number.isFinite(view.x)).toBe(true);
    expect(Number.isFinite(view.y)).toBe(true);
  });
});

describe("hitTest", () => {
  it("반지름 안이면 잡고 밖이면 안 잡는다", () => {
    const sim = simOf([task("a")], 20);
    const a = sim.byId.get("a")!;
    expect(hitTest(sim.nodes, a.x, a.y, 0)?.id).toBe("a");
    expect(hitTest(sim.nodes, a.x + 19, a.y, 0)?.id).toBe("a");
    expect(hitTest(sim.nodes, a.x + 40, a.y, 0)).toBeNull();
  });

  it("겹친 노드는 나중에 그려진(위에 있는) 쪽을 집는다", () => {
    const sim = simOf([task("a"), task("b")], 20);
    sim.nodes[0].x = 0;
    sim.nodes[0].y = 0;
    sim.nodes[1].x = 0;
    sim.nodes[1].y = 0;
    expect(hitTest(sim.nodes, 0, 0)?.id).toBe("b");
  });

  it("빈 그래프에서 null 을 준다", () => {
    expect(hitTest([], 0, 0)).toBeNull();
  });
});
