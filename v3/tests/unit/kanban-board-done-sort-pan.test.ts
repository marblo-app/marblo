/**
 * @vitest-environment jsdom
 *
 * 보드 UX 두 가지(티켓 MThqQ62n) — KanbanBoard 통합.
 *
 *   ① 완료 컬럼은 최근 완료순: completedAt 이 축, 없으면 updatedAt 폴백. 다른
 *      컬럼은 스토어 순서(priority) 그대로.
 *   ② 빈 배경 드래그로 좌우 이동(pan) — 그리고 ★카드 드래그앤드롭은 그대로다.
 *      카드 위에서 시작한 포인터는 pan 이 손대지 않고, dnd-kit 이 예전처럼
 *      드래그를 시작한다(DragOverlay 가 뜬다). 임계값 미만 이동은 클릭이다.
 *
 * jsdom 엔 PointerEvent 가 없어서 MouseEvent 에 pointer 필드를 얹어 보낸다 —
 * React 의 onPointerDown 은 이벤트 **이름**으로 듣고, dnd-kit 의 PointerSensor 는
 * isPrimary/button 만 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import type { Task, TaskStatus } from "../../src/types/task";

const stores = vi.hoisted(() => ({
  tasks: [] as unknown[],
  agents: [] as unknown[],
  agentsHydrated: true,
}));

vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      tasks: stores.tasks,
      loading: false,
      subscribeToTasks: () => () => {},
      refreshTasks: () => Promise.resolve(),
    }),
  ),
}));

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ agents: stores.agents, hydrated: stores.agentsHydrated }),
  ),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      currentProject: {
        id: "p1",
        name: "Demo",
        ownerId: "u1",
        folderPath: "/tmp/demo",
      },
      loading: false,
      projectsHydrated: true,
    }),
  ),
}));

vi.mock("../../src/stores/subscriptionStore", () => ({
  useSubscriptionStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ canUse: () => false }),
  ),
}));

vi.mock("../../src/stores/navigationStore", () => ({
  useNavigationStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ pendingJump: null, consumeJump: () => {} }),
  ),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "u1" } }),
}));

vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      worktrees: [],
      ensureFresh: () => Promise.resolve(),
      statusPill: () => ({ tone: "ready", icon: "✓", label: "ready" }),
    }),
  ),
}));

vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ rootPath: "/tmp/repo" }),
  ),
}));

vi.mock("../../src/hooks/usePresence", () => ({
  usePresence: () => null,
}));

vi.mock("../../src/lib/firebase", () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: vi.fn(() => () => {}),
  subscribeToCollection: vi.fn(() => () => {}),
}));

vi.mock("../../src/services/taskService", () => ({
  updateTaskStatus: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    taskCreated: vi.fn(),
    taskStatusChanged: vi.fn(),
    taskCompleted: vi.fn(),
    cliSetupStep: vi.fn(),
  },
}));

vi.mock("../../src/components/work-history/FirstMissionShareNudge", () => ({
  FirstShareNudge: () => null,
}));
vi.mock("../../src/components/orchestrator/OrchestratorChat", () => ({
  OrchestratorChat: () => null,
}));
vi.mock("../../src/components/board/TaskCreateModal", () => ({
  TaskCreateModal: () => null,
}));
vi.mock("../../src/components/board/TaskDetailModal", () => ({
  TaskDetailModal: () => null,
}));
vi.mock("../../src/components/board/TaskGraphView", () => ({
  TaskGraphView: () => null,
}));

import { KanbanBoard } from "../../src/components/board/KanbanBoard";
import { useLocaleStore } from "../../src/lib/i18n";

const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const HOUR = 3_600_000;

function task(
  id: string,
  status: TaskStatus,
  title: string,
  dates: { completedAt?: Date | null; updatedAt?: Date } = {},
): Task {
  const now = new Date(NOW);
  return {
    id,
    projectId: "p1",
    contextId: "",
    title,
    description: "",
    status,
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: status === "TODO" ? null : "agent-1",
    claimedAt: status === "TODO" ? null : now,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: now,
    updatedAt: dates.updatedAt ?? now,
    ...(dates.completedAt !== undefined
      ? { completedAt: dates.completedAt }
      : {}),
  };
}

/** jsdom 엔 PointerEvent 가 없다 — MouseEvent 에 pointer 필드를 얹는다. */
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX: number; button?: number; pointerType?: string },
): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: 10,
    button: init.button ?? 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "isPrimary", { value: true });
  Object.defineProperty(ev, "pointerType", {
    value: init.pointerType ?? "mouse",
  });
  return ev;
}

/** 가로로 넘치는 스크롤 컨테이너처럼 보이게 한다(jsdom 은 레이아웃이 없다). */
function makeScrollable(el: HTMLElement, scrollLeft = 100): () => number {
  let left = scrollLeft;
  Object.defineProperty(el, "scrollWidth", { value: 2000, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 500, configurable: true });
  Object.defineProperty(el, "scrollLeft", {
    get: () => left,
    set: (v: number) => {
      left = v;
    },
    configurable: true,
  });
  return () => left;
}

function columnTitles(status: TaskStatus): string[] {
  const col = document.querySelector(
    `[data-testid="kanban-column"][data-column-status="${status}"]`,
  );
  if (!col) throw new Error(`column ${status} not rendered`);
  return Array.from(col.querySelectorAll("h4")).map((h) => h.textContent ?? "");
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  stores.tasks = [];
  stores.agents = [];
  stores.agentsHydrated = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("① 완료 컬럼 최근 완료순", () => {
  it("최상단이 가장 최근 완료 티켓 — completedAt 없는 옛 티켓은 updatedAt 폴백으로 섞인다", () => {
    stores.tasks = [
      // 스토어 순서는 일부러 뒤죽박죽. 완료 컬럼만 시간순으로 다시 서야 한다.
      task("d-old", "DONE", "옛날 완료", {
        completedAt: new Date(NOW - 5 * HOUR),
        updatedAt: new Date(NOW - 5 * HOUR),
      }),
      task("d-touched", "DONE", "옛날 완료(오늘 코멘트)", {
        completedAt: new Date(NOW - 8 * HOUR),
        updatedAt: new Date(NOW), // 완료 후 코멘트 → updatedAt 만 갱신
      }),
      task("d-new", "DONE", "방금 완료", {
        completedAt: new Date(NOW - 1 * HOUR),
        updatedAt: new Date(NOW - 1 * HOUR),
      }),
      task("d-legacy", "DONE", "필드 없는 완료", {
        // completedAt 없음(이 필드 이전에 완료된 티켓) → updatedAt 폴백
        updatedAt: new Date(NOW - 3 * HOUR),
      }),
      task("p-low", "IN_PROGRESS", "진행 A", {
        updatedAt: new Date(NOW - 9 * HOUR),
      }),
      task("p-high", "IN_PROGRESS", "진행 B", {
        updatedAt: new Date(NOW - 1 * HOUR),
      }),
    ];
    stores.agents = [
      {
        id: "agent-1",
        projectId: "p1",
        ownerId: "u1",
        name: "agent-1",
        model: "claude",
        role: "frontend",
        status: "working",
        currentTaskId: null,
        command: "claude",
        skillFile: "",
        createdAt: new Date(0),
      },
    ];
    render(createElement(KanbanBoard));

    expect(columnTitles("DONE")).toEqual([
      "방금 완료",
      "필드 없는 완료",
      "옛날 완료",
      "옛날 완료(오늘 코멘트)",
    ]);
    // 진행 중 컬럼은 스토어 순서(=priority 정렬) 그대로 — 시간순으로 바꾸지 않는다.
    expect(columnTitles("IN_PROGRESS")).toEqual(["진행 A", "진행 B"]);
  });
});

describe("② 배경 드래그 pan vs 카드 드래그", () => {
  function mountBoard() {
    stores.tasks = [
      task("t1", "TODO", "카드 하나"),
      task("d1", "DONE", "끝난 것"),
    ];
    render(createElement(KanbanBoard));
    const scroll = screen.getByTestId("kanban-scroll");
    const readScrollLeft = makeScrollable(scroll, 100);
    return { scroll, readScrollLeft };
  }

  it("빈 배경에서 임계값 넘게 끌면 pan — scrollLeft 가 따라오고 grabbing 커서, 뒤따르는 click 은 삼킨다", () => {
    const { scroll, readScrollLeft } = mountBoard();
    const clicks = vi.fn();
    document.body.addEventListener("click", clicks);

    act(() => {
      scroll.dispatchEvent(pointerEvent("pointerdown", { clientX: 300 }));
    });
    expect(scroll.dataset.boardPanning).toBeUndefined();

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 260 }));
    });
    // 오른쪽→왼쪽 40px 끌기 = 내용이 왼쪽으로 → scrollLeft 증가.
    expect(readScrollLeft()).toBe(140);
    expect(scroll.dataset.boardPanning).toBe("true");
    expect(scroll.className).toContain("cursor-grabbing");
    expect(scroll.className).toContain("select-none");

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 330 }));
    });
    expect(readScrollLeft()).toBe(70);

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 330 }));
    });
    expect(scroll.dataset.boardPanning).toBeUndefined();
    expect(scroll.className).not.toContain("cursor-grabbing");

    // pan 직후의 click 은 한 번 삼킨다(배경에서 시작해 카드 위에서 뗀 경우 대비).
    fireEvent.click(scroll);
    expect(clicks).not.toHaveBeenCalled();
    // 그 다음 클릭은 정상.
    fireEvent.click(scroll);
    expect(clicks).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", clicks);
  });

  it("임계값 미만 이동은 pan 이 아니라 클릭 — scrollLeft 그대로, click 살아 있다", () => {
    const { scroll, readScrollLeft } = mountBoard();
    const clicks = vi.fn();
    document.body.addEventListener("click", clicks);

    act(() => {
      scroll.dispatchEvent(pointerEvent("pointerdown", { clientX: 300 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 303 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 303 }));
    });
    expect(readScrollLeft()).toBe(100);
    expect(scroll.dataset.boardPanning).toBeUndefined();
    fireEvent.click(scroll);
    expect(clicks).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", clicks);
  });

  it("★카드 위에서 시작한 드래그는 pan 이 손대지 않고, dnd-kit 카드 드래그가 그대로 시작된다", () => {
    const { scroll, readScrollLeft } = mountBoard();
    const card = screen.getByText("카드 하나").closest('[role="button"]');
    expect(card, "dnd-kit 카드 루트(role=button)").toBeTruthy();

    act(() => {
      card!.dispatchEvent(pointerEvent("pointerdown", { clientX: 300 }));
    });
    act(() => {
      // dnd-kit PointerSensor 는 document 에 move 를 건다. 임계(5px) 를 넘긴다.
      document.dispatchEvent(pointerEvent("pointermove", { clientX: 320 }));
    });
    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", { clientX: 340 }));
    });

    // pan 은 전혀 안 걸렸다.
    expect(readScrollLeft()).toBe(100);
    expect(scroll.dataset.boardPanning).toBeUndefined();
    // 카드 드래그는 시작됐다 — DragOverlay 가 같은 카드를 하나 더 그린다.
    expect(screen.getAllByText("카드 하나").length).toBeGreaterThanOrEqual(2);

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", { clientX: 340 }));
    });
  });

  it("터치 포인터는 네이티브 가로 스크롤에 맡긴다(pan 안 함)", () => {
    const { scroll, readScrollLeft } = mountBoard();
    act(() => {
      scroll.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 300, pointerType: "touch" }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 200, pointerType: "touch" }),
      );
    });
    expect(readScrollLeft()).toBe(100);
    expect(scroll.dataset.boardPanning).toBeUndefined();
  });

  it("가로로 넘칠 게 없으면 세션을 열지 않는다", () => {
    stores.tasks = [task("t1", "TODO", "카드 하나")];
    render(createElement(KanbanBoard));
    const scroll = screen.getByTestId("kanban-scroll");
    Object.defineProperty(scroll, "scrollWidth", { value: 400 });
    Object.defineProperty(scroll, "clientWidth", { value: 500 });
    act(() => {
      scroll.dispatchEvent(pointerEvent("pointerdown", { clientX: 300 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 200 }));
    });
    expect(scroll.dataset.boardPanning).toBeUndefined();
  });
});
