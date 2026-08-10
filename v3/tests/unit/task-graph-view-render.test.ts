/**
 * @vitest-environment jsdom
 *
 * TaskGraphView — 실제 DOM 렌더 회귀.
 *
 * 레이아웃 순수함수(task-graph-layout.test.ts)만 고정하면 "좌표는 맞는데 화면엔
 * 아무것도 없다" 를 못 잡는다. 이 뷰의 계약은 셋이다:
 *   ① 모든 티켓이 노드로 선다 (의존 없는 티켓도 사라지지 않는다)
 *   ② dependsOn 이 간선으로 그려진다
 *   ③ ★노드를 누르면 onSelect 로 **그 티켓**이 올라간다 — 보드가 기존
 *      TaskDetailModal 을 여는 유일한 경로다(뷰가 자기 모달을 만들지 않는다)
 *
 * ★Phase 2 에서 렌더가 DOM 박스에서 **캔버스**로 바뀌었다. 그래서 노드/간선을
 * DOM 으로 세던 단언이 두 갈래로 갈린다:
 *   - 간선 수는 캔버스 엘리먼트의 `data-edge-count` 로 확인한다(픽셀은 jsdom 이
 *     못 그린다 — getContext 가 없다).
 *   - 노드는 여전히 진짜 버튼이다. 캔버스만 두면 이 뷰가 스크린리더·키보드에
 *     통째로 안 보이므로 sr-only 목록을 병행하고, 그 목록이 계약의 정본이다.
 * jsdom 에 2D 컨텍스트가 없다는 사실 자체가 회귀 방어다: 컨텍스트가 null 일 때
 * 뷰가 던지면 여기 전부가 빨개진다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Task, TaskStatus } from "../../src/types/task";

const stores = vi.hoisted(() => ({ agents: [] as unknown[] }));

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ agents: stores.agents }),
  ),
}));

// TaskGraphView 는 TaskCard 에서 역할/모델 색표를 빌려 온다. TaskCard 의 import
// 그래프에 firestore 가 딸려 오는데(FlowKanbanLink) jsdom 에서 실 초기화는 터진다.
vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: vi.fn(() => () => {}),
}));

import { TaskGraphView } from "../../src/components/board/TaskGraphView";
import { STATUS_CONFIG } from "../../src/components/board/KanbanColumn";
import { STATUS_HEX } from "../../src/lib/taskGraphAnalysis";
import { useLocaleStore } from "../../src/lib/i18n";

function task(
  id: string,
  dependsOn: string[] = [],
  status: TaskStatus = "TODO",
): Task {
  return {
    id,
    projectId: "p1",
    contextId: "",
    title: `제목 ${id}`,
    description: "",
    status,
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
    createdAt: new Date("2026-08-10T00:00:00Z"),
    updatedAt: new Date("2026-08-10T00:00:00Z"),
  } as Task;
}

beforeEach(() => {
  stores.agents = [];
  useLocaleStore.setState({ locale: "ko" });
});

afterEach(() => cleanup());

describe("TaskGraphView", () => {
  it("모든 티켓이 노드로 서고, dependsOn 이 엣지로 그려진다", () => {
    render(
      createElement(TaskGraphView, {
        tasks: [task("a"), task("b", ["a"]), task("c")],
        onSelect: vi.fn(),
      }),
    );

    const nodes = screen.getAllByTestId("task-graph-node");
    expect(nodes).toHaveLength(3);
    // 의존이 없는 c 도 노드로 남는다.
    expect(screen.getByText("제목 c")).toBeTruthy();
    // a → b 엣지 하나.
    const canvas = screen.getByTestId("task-graph-canvas");
    expect(canvas.getAttribute("data-node-count")).toBe("3");
    expect(canvas.getAttribute("data-edge-count")).toBe("1");
  });

  it("노드를 누르면 그 태스크가 onSelect 로 올라간다", () => {
    const onSelect = vi.fn();
    render(
      createElement(TaskGraphView, {
        tasks: [task("a"), task("b", ["a"])],
        onSelect,
      }),
    );

    fireEvent.click(screen.getByText("제목 b").closest("button")!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("b");
  });

  it("빈 프로젝트에서 크래시 없이 빈 상태만 그린다", () => {
    render(createElement(TaskGraphView, { tasks: [], onSelect: vi.fn() }));
    expect(screen.queryAllByTestId("task-graph-node")).toHaveLength(0);
    expect(screen.getByText("그릴 태스크가 없습니다")).toBeTruthy();
  });

  it("순환 의존이 있어도 렌더되고 경고 배지가 뜬다", () => {
    render(
      createElement(TaskGraphView, {
        tasks: [task("a", ["b"]), task("b", ["a"])],
        onSelect: vi.fn(),
      }),
    );
    expect(screen.getAllByTestId("task-graph-node")).toHaveLength(2);
    expect(screen.getByText(/순환 의존/)).toBeTruthy();
  });

  it("담당 에이전트가 있으면 스폰 모델 라벨을, 없으면 미배정을 보여준다", () => {
    stores.agents = [
      {
        id: "agent-1",
        name: "frontend-1",
        model: "claude",
        spawnedModel: "opus-5@high",
      },
    ];
    render(
      createElement(TaskGraphView, {
        tasks: [
          { ...task("a"), claimedBy: "agent-1", status: "IN_PROGRESS" } as Task,
          task("b"),
        ],
        onSelect: vi.fn(),
      }),
    );
    expect(screen.getByText("opus-5@high")).toBeTruthy();
    expect(screen.getByText("미배정")).toBeTruthy();
  });
});

/**
 * Phase 2 운영 레이어의 **배선** 회귀. 판정 자체는 순수함수 테스트가 덮으므로
 * (task-graph-critical-path.test.ts) 여기서는 "계산 결과가 정말 화면 속성으로
 * 흘러나오나" 만 본다 — 둘을 한 곳에서 재면 로직이 맞는데 화면이 안 바뀌는
 * 회귀를 놓친다.
 */
describe("TaskGraphView — 운영 레이어", () => {
  it("준비(ready)와 대기(waiting)가 노드 속성으로 갈린다", () => {
    render(
      createElement(TaskGraphView, {
        tasks: [task("a"), task("b", ["a"]), task("c", [], "DONE")],
        onSelect: vi.fn(),
      }),
    );
    const readiness = Object.fromEntries(
      screen
        .getAllByTestId("task-graph-node")
        .map((node) => [
          node.querySelector("span")?.textContent,
          node.getAttribute("data-task-readiness"),
        ]),
    );
    expect(readiness).toEqual({
      "제목 a": "ready",
      "제목 b": "waiting",
      "제목 c": "done",
    });
  });

  it("크리티컬 패스 위의 노드가 표시되고, 토글로 끌 수 있다", () => {
    render(
      createElement(TaskGraphView, {
        tasks: [task("a"), task("b", ["a"]), task("island")],
        onSelect: vi.fn(),
      }),
    );

    const onPath = screen
      .getAllByTestId("task-graph-node")
      .filter((node) => node.getAttribute("data-task-critical") === "true")
      .map((node) => node.querySelector("span")?.textContent);
    expect(onPath).toEqual(["제목 a", "제목 b"]);

    const toggle = screen.getByTestId("task-graph-critical-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("의존이 하나도 없으면 강조할 사슬이 없어 토글이 잠긴다", () => {
    render(
      createElement(TaskGraphView, {
        tasks: [task("a"), task("b")],
        onSelect: vi.fn(),
      }),
    );
    const toggle = screen.getByTestId(
      "task-graph-critical-toggle",
    ) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it("범례가 준비/대기 개수를 센다", () => {
    render(
      createElement(TaskGraphView, {
        tasks: [task("a"), task("b", ["a"]), task("c", ["a"]), task("d")],
        onSelect: vi.fn(),
      }),
    );
    expect(screen.getByText("준비 2")).toBeTruthy();
    expect(screen.getByText("대기 2")).toBeTruthy();
  });

  /**
   * ★"의존이 드문 큰 보드" 경로. 실보드가 1207태스크/82의존이고, 그래프 뷰가
   * 세로 일자로 뭉치던 버그가 정확히 이 비율에서 났다.
   *
   * 캔버스 픽셀은 jsdom 이 못 그리니 배치의 *모양*은 여기서 못 잰다(그건
   * task-graph-force.test.ts 의 bounds 종횡비 단언이 맡는다). 여기서 지키는 건
   * 다른 것 둘이다: 티켓이 수백 장이어도 ① 노드가 하나도 안 빠지고 ② 마운트가
   * 동기 예열 때문에 멎지 않는다 — 예열은 useEffect 안에서 그냥 돌기 때문에
   * 여기가 실제로 그 비용을 타는 유일한 테스트다.
   */
  it("★수백 장짜리 희소 보드도 노드를 빠짐없이 세우고 즉시 마운트된다", () => {
    const many: Task[] = [];
    for (let i = 0; i < 300; i += 1) many.push(task(`n${i}`));
    // 의존은 드물게 — 고립 노드가 대부분인 실보드 비율.
    for (let i = 7; i < 300; i += 37) {
      many[i] = task(`n${i}`, [`n${i - 1}`]);
    }

    const started = performance.now();
    render(createElement(TaskGraphView, { tasks: many, onSelect: vi.fn() }));
    const elapsed = performance.now() - started;

    expect(screen.getAllByTestId("task-graph-node")).toHaveLength(300);
    const canvas = screen.getByTestId("task-graph-canvas");
    expect(canvas.getAttribute("data-node-count")).toBe("300");
    expect(canvas.getAttribute("data-edge-count")).toBe("8");
    // 자릿수 감시다(벤치가 아니다) — 반발/충돌이 전수 비교로 되돌아가거나 예열
    // 예산제가 사라지면 여기서 수 초가 걸린다. 느린 CI 를 감안한 천장.
    expect(elapsed).toBeLessThan(3000);
  });

  it("★캔버스 색표가 칸반 상태표와 같은 키를 덮는다(색 드리프트 방지)", () => {
    // 상태가 새로 생겼는데 STATUS_HEX 에만 안 들어가면 그 노드는 회색 폴백으로
    // 조용히 그려진다 — 칸반에선 보라, 그래프에선 회색이 되는 자리다.
    expect(Object.keys(STATUS_HEX).sort()).toEqual(
      Object.keys(STATUS_CONFIG).sort(),
    );
  });
});
