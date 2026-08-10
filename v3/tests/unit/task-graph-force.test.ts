/**
 * 포스-다이렉티드 시뮬레이터 회귀.
 *
 * d3-force 를 안 끌어오고 손으로 적분하기로 한 대가가 여기다 — 라이브러리라면
 * 남이 검증해 줬을 것들(수렴, NaN 안전, 결정론)을 직접 못 박는다. 시뮬을 RAF 와
 * 분리해 `step()` 호출 수로 시간을 세는 설계라서 이게 가능하다.
 *
 * ★특히 두 가지가 회귀하면 뷰가 조용히 쓸모없어진다:
 *   ① 레이어 x 앵커 — 무너지면 "왼쪽이 먼저" 라는 읽기 규칙이 사라져, 예쁘지만
 *      의존 방향을 못 읽는 그래프가 된다.
 *   ② 결정론 — 같은 보드를 두 번 열어 배치가 달라지면 사용자는 기억으로 노드를
 *      못 찾고, 스크린샷 기반 회귀도 전부 깨진다.
 */
import { describe, expect, it } from "vitest";
import { layoutTaskGraph } from "../../src/lib/taskGraphLayout";
import {
  ALPHA_MIN,
  createTaskGraphSimulation,
  hitTest,
  warmUp,
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
