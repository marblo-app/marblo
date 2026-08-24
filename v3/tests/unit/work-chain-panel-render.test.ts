/**
 * @vitest-environment jsdom
 *
 * WorkChainPanel — 사장님이 보는 "다음 할 일" 이 **보드 상태로** 그려지는지.
 * 같은 체인 문서를 두고 보드 스토어의 티켓 status 만 바꾸면 화면의 완료/준비가 바뀐다.
 * 그리고 빈 상태엔 "항목 적기" 행동이, 실패 상태엔 "다시 시도" 가 붙는다.
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
// 테스트 런타임 로케일은 en 이다(orchestrator-halt-panel-render.test.ts 와 같은 이유로
// 문장을 베끼지 않고 사전에서 꺼낸다).
import { en } from "../../src/locales/en";
import type { WorkChainItem } from "../../src/lib/workChain";
import {
  DEFAULT_PANEL_HEIGHT,
  panelHeightForPointer,
} from "../../src/components/orchestrator/workChainPanelResize";

const state = vi.hoisted(() => ({
  listener: null as
    | null
    | ((
        r:
          | {
              kind: "data";
              snapshot: {
                projectId: string;
                items: WorkChainItem[];
                rev: number;
                exists: boolean;
              };
            }
          | { kind: "error"; error: Error; reason: "permission" | "load" },
      ) => void),
  added: [] as Array<{ what: string; why: string }>,
  subscribeTasks: vi.fn(() => () => {}),
  routeInstruction: vi.fn(async () => "local" as const),
  missionListener: null as null | ((missions: unknown[]) => void),
}));

const PANEL_HEIGHT_STORAGE_KEY = "marblo.workChainPanel.height.v1";

function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    },
  });
  return map;
}

let storage: Map<string, string>;

/** jsdom has no PointerEvent constructor, so use a mouse event with pointer fields. */
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  clientY: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  return event;
}

// 실제 zustand 스토어 — 보드 status 가 바뀌면 패널이 **스스로** 다시 그리는지를
// 보려면 selector 목이 아니라 구독이 있어야 한다(memo 컴포넌트라 props 만으론 안 바뀐다).
vi.mock("../../src/stores/taskStore", async () => {
  const { create } = await import("zustand");
  const useTaskStore = create<{
    tasks: unknown[];
    subscribeToTasks: (projectId: string) => () => void;
  }>(() => ({
    tasks: [],
    subscribeToTasks: state.subscribeTasks,
  }));
  return { useTaskStore };
});

vi.mock("../../src/services/workChainService", () => ({
  subscribeWorkChain: vi.fn((_pid: string, cb: typeof state.listener) => {
    state.listener = cb;
    return () => {
      state.listener = null;
    };
  }),
  subscribeWorkChainMissions: vi.fn(
    (_pid: string, cb: (m: unknown[]) => void) => {
      state.missionListener = cb;
      cb([]);
      return () => {
        state.missionListener = null;
      };
    },
  ),
  addWorkChainItemFromUi: vi.fn(
    async (_pid: string, input: { what: string; why: string }) => {
      state.added.push(input);
      return { ok: true, itemId: "wc_new" };
    },
  ),
  dropWorkChainItemFromUi: vi.fn(async () => ({ ok: true })),
  removeWorkChainEvidenceTaskFromUi: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: state.routeInstruction,
}));

import WorkChainPanel from "../../src/components/orchestrator/WorkChainPanel";
import { useTaskStore } from "../../src/stores/taskStore";

function setTasks(
  tasks: Array<{
    id: string;
    status: string;
    title: string;
    contextId?: string;
    deleted?: boolean;
  }>,
) {
  act(() => {
    useTaskStore.setState({ tasks: tasks as never });
  });
}

function chainItem(
  over: Partial<WorkChainItem> & { id: string; what: string },
): WorkChainItem {
  return {
    why: "why",
    afterTaskIds: [],
    afterItemIds: [],
    taskIds: [],
    doneWhen: "done",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "orch",
    ...over,
  };
}

function push(items: WorkChainItem[], exists = true) {
  act(() => {
    state.listener?.({
      kind: "data",
      snapshot: { projectId: "p1", items, rev: 1, exists },
    });
  });
}

beforeEach(() => {
  storage = installMemoryStorage();
  setTasks([]);
  state.added = [];
  state.listener = null;
  state.subscribeTasks.mockClear();
  state.routeInstruction.mockClear();
  state.missionListener = null;
});
afterEach(() => cleanup());

describe("WorkChainPanel", () => {
  it("다른 탭을 열지 않아도 자신의 프로젝트 티켓을 구독한다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    expect(state.subscribeTasks).toHaveBeenCalledWith("p1");
  });

  it("완료/준비는 보드 티켓 status 로 파생된다 — 같은 문서, 다른 보드", () => {
    setTasks([{ id: "t1", status: "REVIEW", title: "센트리" }]);
    const { rerender } = render(
      createElement(WorkChainPanel, { projectId: "p1" }),
    );
    push([chainItem({ id: "a", what: "센트리 마감", taskIds: ["t1"] })]);
    // 요약 줄에 ▶ 다음 이 보인다(펼치지 않아도).
    expect(screen.getByTestId("work-chain-next").textContent).toContain(
      "센트리 마감",
    );

    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    const li = screen.getByTestId("work-chain-item");
    expect(li.getAttribute("data-state")).toBe("ready");

    // 보드에서 DONE 이 되면 — 체인 문서는 그대로인데 — 화면은 완료(board)로 바뀐다.
    setTasks([{ id: "t1", status: "DONE", title: "센트리" }]);
    rerender(createElement(WorkChainPanel, { projectId: "p1" }));
    expect(screen.queryByTestId("work-chain-next")).toBeNull();
    // 열린 항목이 없으니 목록은 닫힌 항목 토글 뒤에 숨는다.
    fireEvent.click(
      screen.getByText(
        en["orchestrator.chain.showClosed"].replace("{count}", "1"),
      ),
    );
    const done = screen.getByTestId("work-chain-item");
    expect(done.getAttribute("data-state")).toBe("done");
    expect(done.getAttribute("data-evidence")).toBe("board");
  });

  it("선행 티켓이 DONE 이 아니면 대기, 되면 준비 — 요약 줄이 따라 바뀐다", () => {
    setTasks([{ id: "deploy", status: "IN_PROGRESS", title: "배포" }]);
    const { rerender } = render(
      createElement(WorkChainPanel, { projectId: "p1" }),
    );
    push([
      chainItem({
        id: "d38",
        what: "디자인 3/8 재개",
        why: "배포가 급해서 보류",
        afterTaskIds: ["deploy"],
      }),
    ]);
    expect(screen.queryByTestId("work-chain-next")).toBeNull();
    setTasks([{ id: "deploy", status: "DONE", title: "배포" }]);
    rerender(createElement(WorkChainPanel, { projectId: "p1" }));
    expect(screen.getByTestId("work-chain-next").textContent).toContain(
      "디자인 3/8 재개",
    );
  });

  it("빈 상태엔 '항목 적기' 행동이 붙고, 폼 제출이 서비스로 간다", async () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([], false);
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(screen.getByText(en["orchestrator.chain.empty.title"])).toBeTruthy();
    fireEvent.click(screen.getByText(en["orchestrator.chain.empty.create"]));
    const inputs = screen
      .getByTestId("work-chain-form")
      .querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "웹 티켓 열기" } });
    fireEvent.change(inputs[1], { target: { value: "에이전트에게 약속함" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("work-chain-submit"));
    });
    expect(state.added).toEqual([
      { what: "웹 티켓 열기", why: "에이전트에게 약속함" },
    ]);
  });

  it("지금 시작은 기존 오케 지시 경로로 한 번만 보낸다", async () => {
    setTasks([{ id: "t1", status: "REVIEW", title: "센트리" }]);
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([
      chainItem({ id: "a", what: "센트리 마감", why: "검증", taskIds: ["t1"] }),
    ]);
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    await act(async () =>
      fireEvent.click(screen.getByTestId("work-chain-start")),
    );
    expect(state.routeInstruction).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("work-chain-start").hasAttribute("disabled"),
    ).toBe(true);
  });

  it("펼친 본문은 터미널 공간을 밀지 않는 오버레이이며 Esc로 닫힌다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([chainItem({ id: "a", what: "첫 항목" })]);
    const panel = screen.getByTestId("work-chain-panel");
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(screen.getByTestId("work-chain-overlay").className).toContain(
      "absolute",
    );
    expect(panel.style.height).toBe("");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("work-chain-overlay")).toBeNull();
  });

  it("구독 실패는 0개가 아니라 실패로 그리고 '다시 시도' 가 있다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    act(() => {
      state.listener?.({
        kind: "error",
        error: new Error("permission-denied"),
        reason: "permission",
      });
    });
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(
      screen.getByText(en["orchestrator.chain.failed.permission"]),
    ).toBeTruthy();
    expect(screen.getByText(en["common.state.action.retry"])).toBeTruthy();
  });

  it("프로젝트가 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(
      createElement(WorkChainPanel, { projectId: null }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("펼친 목록은 상한 안에서 스크롤되고, 하단 핸들 높이를 재시작 뒤에도 기억한다", () => {
    const { unmount } = render(
      createElement(WorkChainPanel, { projectId: "p1" }),
    );
    push(
      Array.from({ length: 20 }, (_, index) =>
        chainItem({ id: `item-${index}`, what: `항목 ${index + 1}` }),
      ),
    );
    fireEvent.click(screen.getByTestId("work-chain-toggle"));

    const panel = screen.getByTestId("work-chain-panel");
    const overlay = screen.getByTestId("work-chain-overlay");
    expect(overlay.style.height).toBe(`${DEFAULT_PANEL_HEIGHT}px`);
    expect(overlay.style.maxHeight).toBe("320px");
    expect(panel.querySelector(".overflow-y-auto")).toBeTruthy();
    expect(screen.getAllByTestId("work-chain-item")).toHaveLength(20);

    const handle = screen.getByTestId("work-chain-resize-handle");
    fireEvent(handle, pointerEvent("pointerdown", 200));
    fireEvent(document, pointerEvent("pointermove", 140));
    fireEvent(document, pointerEvent("pointerup", 140));
    const resizedHeight = panelHeightForPointer(DEFAULT_PANEL_HEIGHT, 200, 140);
    expect(overlay.style.height).toBe(`${resizedHeight}px`);
    expect(storage.get(PANEL_HEIGHT_STORAGE_KEY)).toBe(String(resizedHeight));

    unmount();
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([chainItem({ id: "a", what: "첫 항목" })]);
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(screen.getByTestId("work-chain-overlay").style.height).toBe(
      `${resizedHeight}px`,
    );
  });

  it("미션 진행률은 펼침 안에만 있고 접힘 한 줄은 그대로다", () => {
    setTasks([
      { id: "t1", status: "DONE", title: "하나", contextId: "m1" },
      { id: "t2", status: "TODO", title: "둘", contextId: "m1" },
      { id: "t3", status: "TODO", title: "셋", contextId: "m1" },
    ]);
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    act(() => {
      state.missionListener?.([
        {
          id: "m1",
          missionKind: "implicit",
          implicitLabel: "Replay Wiring",
          status: "active",
        },
      ]);
    });
    push([
      chainItem({
        id: "a",
        what: "리플레이 배선",
        missionLabel: "Replay Wiring",
      }),
    ]);
    const summary = screen.getByTestId("work-chain-summary");
    expect(summary.textContent).toContain("리플레이 배선");
    expect(summary.textContent).not.toMatch(/1\/3/);
    expect(screen.queryByTestId("work-chain-mission-progress")).toBeNull();

    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    const progress = screen.getByTestId("work-chain-mission-progress");
    expect(progress.textContent).toContain("1/3");
    expect(screen.getByTestId("work-chain-item").getAttribute("data-state")).toBe(
      "ready",
    );
  });

  it("티켓 0개 미션은 펼침에서 아직 안 쪼개짐이고 완료가 아니다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([
      chainItem({
        id: "a",
        what: "큰 덩어리",
        missionLabel: "아직 없음",
      }),
    ]);
    expect(screen.getByTestId("work-chain-next").textContent).toContain(
      "큰 덩어리",
    );
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(
      screen.getByTestId("work-chain-item").getAttribute("data-unsplit"),
    ).toBe("true");
    expect(
      screen.getByTestId("work-chain-item").getAttribute("data-state"),
    ).toBe("ready");
    expect(screen.getByTestId("work-chain-mission-progress").textContent).toBe(
      en["orchestrator.chain.unsplitHint"],
    );
  });

  it("같은 라벨 미션 2개는 펼침에서 합산을 말하고 접힘 줄에는 안 넣는다", () => {
    setTasks([
      { id: "old-1", status: "DONE", title: "지난 배치", contextId: "m-old" },
      { id: "old-2", status: "DONE", title: "지난 배치 2", contextId: "m-old" },
      { id: "new-1", status: "DONE", title: "이번 1", contextId: "m-new" },
      { id: "new-2", status: "TODO", title: "이번 2", contextId: "m-new" },
      { id: "new-3", status: "TODO", title: "이번 3", contextId: "m-new" },
    ]);
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    act(() => {
      state.missionListener?.([
        {
          id: "m-old",
          missionKind: "implicit",
          implicitLabel: "Replay Wiring",
          status: "completed",
        },
        {
          id: "m-new",
          missionKind: "implicit",
          implicitLabel: "Replay Wiring",
          status: "active",
        },
      ]);
    });
    push([
      chainItem({
        id: "a",
        what: "리플레이 배선",
        missionLabel: "Replay Wiring",
      }),
    ]);
    const summary = screen.getByTestId("work-chain-summary");
    expect(summary.textContent).not.toMatch(/2/);
    expect(summary.textContent).not.toContain(
      en["orchestrator.chain.missionCombined"].replace("{count}", "2"),
    );
    expect(screen.queryByTestId("work-chain-mission-combined")).toBeNull();

    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(screen.getByTestId("work-chain-mission-progress").textContent).toContain(
      "3/5",
    );
    expect(screen.getByTestId("work-chain-mission-combined").textContent).toBe(
      en["orchestrator.chain.missionCombined"].replace("{count}", "2"),
    );
  });
});
