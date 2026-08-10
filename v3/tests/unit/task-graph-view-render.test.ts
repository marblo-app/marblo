/**
 * @vitest-environment jsdom
 *
 * TaskGraphView — 실제 DOM 렌더 회귀.
 *
 * 레이아웃 순수함수(task-graph-layout.test.ts)만 고정하면 "좌표는 맞는데 화면엔
 * 아무것도 없다" 를 못 잡는다. 이 뷰의 계약은 셋이다:
 *   ① 모든 티켓이 노드로 선다 (의존 없는 티켓도 사라지지 않는다)
 *   ② dependsOn 이 엣지(SVG path)로 그려진다
 *   ③ ★노드를 누르면 onSelect 로 **그 티켓**이 올라간다 — 보드가 기존
 *      TaskDetailModal 을 여는 유일한 경로다(뷰가 자기 모달을 만들지 않는다)
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
    const { container } = render(
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
    expect(container.querySelectorAll("svg path[marker-end]")).toHaveLength(1);
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
