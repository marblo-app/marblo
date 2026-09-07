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
  added: [] as Array<{ what: string; why: string; missionLabel?: string }>,
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
    async (
      _pid: string,
      input: { what: string; why: string; missionLabel?: string },
    ) => {
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

  it("★사장님이 직접 적을 때도 미션 라벨을 함께 보낼 수 있다", async () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([], false);
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    fireEvent.click(screen.getByText(en["orchestrator.chain.empty.create"]));
    const inputs = screen
      .getByTestId("work-chain-form")
      .querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "A 잡" } });
    fireEvent.change(inputs[1], { target: { value: "B 로 이어짐" } });
    fireEvent.change(inputs[2], { target: { value: "직원 온보딩" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("work-chain-submit"));
    });
    expect(state.added).toEqual([
      { what: "A 잡", why: "B 로 이어짐", missionLabel: "직원 온보딩" },
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

  it("★지금 시작은 항목의 미션 라벨을 오케 지시문에 실어 보낸다", async () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([
      chainItem({
        id: "a",
        what: "A 잡",
        why: "B 로 이어짐",
        missionLabel: "직원 온보딩",
      }),
    ]);
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    await act(async () =>
      fireEvent.click(screen.getByTestId("work-chain-start")),
    );
    expect(state.routeInstruction).toHaveBeenCalledTimes(1);
    const call = state.routeInstruction.mock.calls[0][0] as {
      message: string;
    };
    expect(call.message).toContain("직원 온보딩");
    expect(call.message).toContain("mission_label");
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

  it("권한 없는 구독 실패는 denied 로 그리고 '다시 시도' 를 붙이지 않는다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    act(() => {
      state.listener?.({
        kind: "error",
        error: new Error("permission-denied"),
        reason: "permission",
      });
    });
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    const denied = screen
      .getByTestId("work-chain-overlay")
      .querySelector('[data-state-kind="denied"]');
    expect(denied).toBeTruthy();
    expect(denied?.textContent).toContain(
      en["orchestrator.chain.failed.permission"],
    );
    expect(screen.queryByText(en["common.state.action.retry"])).toBeNull();
  });

  it("로드 실패는 failed 로 그리고 '다시 시도' 가 있다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    act(() => {
      state.listener?.({
        kind: "error",
        error: new Error("network"),
        reason: "load",
      });
    });
    fireEvent.click(screen.getByTestId("work-chain-toggle"));
    expect(
      screen.getByText(en["orchestrator.chain.failed.reason"]),
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("work-chain-overlay")
        .querySelector('[data-state-kind="failed"]'),
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
    expect(
      screen.getByTestId("work-chain-item").getAttribute("data-state"),
    ).toBe("ready");
  });

  it("접힘 줄 높이 클래스는 유지하고 다음 항목은 더 넓은 flex 폭을 가진다", () => {
    render(createElement(WorkChainPanel, { projectId: "p1" }));
    push([chainItem({ id: "a", what: "폭 확인 항목" })]);
    const summary = screen.getByTestId("work-chain-summary");
    expect(summary.className).toBe(
      "flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap px-2 py-0.5",
    );
    expect(screen.getByTestId("work-chain-next").className).toContain(
      "flex-[2_1_0]",
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
    expect(
      screen.getByTestId("work-chain-mission-progress").textContent,
    ).toContain("3/5");
    expect(screen.getByTestId("work-chain-mission-combined").textContent).toBe(
      en["orchestrator.chain.missionCombined"].replace("{count}", "2"),
    );
  });

  // 티켓 te3lbjp13nJ39L8WhUhv — 오케브레인을 미션 단위로 구조화.
  describe("mission grouping (te3lbjp13nJ39L8WhUhv)", () => {
    it("★전환 상태: 라벨 없는 항목이 대다수여도 화면은 지금과 완전히 같다", () => {
      render(createElement(WorkChainPanel, { projectId: "p1" }));
      push([
        chainItem({ id: "a", what: "라벨 없는 항목 1" }),
        chainItem({ id: "b", what: "라벨 없는 항목 2" }),
        chainItem({ id: "c", what: "라벨 없는 항목 3" }),
      ]);
      fireEvent.click(screen.getByTestId("work-chain-toggle"));

      expect(screen.getAllByTestId("work-chain-item")).toHaveLength(3);
      expect(screen.queryByTestId("work-chain-mission-group")).toBeNull();
    });

    it("한 항목뿐인 미션 라벨은 그룹 래퍼 없이 지금과 같은 모양이다", () => {
      render(createElement(WorkChainPanel, { projectId: "p1" }));
      push([
        chainItem({
          id: "a",
          what: "혼자인 미션 항목",
          missionLabel: "Solo Mission",
        }),
      ]);
      fireEvent.click(screen.getByTestId("work-chain-toggle"));

      expect(screen.queryByTestId("work-chain-mission-group")).toBeNull();
      expect(screen.getByTestId("work-chain-item").textContent).toContain(
        "혼자인 미션 항목",
      );
    });

    it("같은 라벨 항목 2개는 접힌 그룹 행 하나로 묶이고, 개별 항목은 클릭 전엔 안 보인다", () => {
      render(createElement(WorkChainPanel, { projectId: "p1" }));
      push([
        chainItem({
          id: "step1",
          what: "1단계: 설계",
          missionLabel: "Big Mission",
        }),
        chainItem({
          id: "step2",
          what: "2단계: 구현",
          missionLabel: "Big Mission",
        }),
      ]);
      fireEvent.click(screen.getByTestId("work-chain-toggle"));

      const group = screen.getByTestId("work-chain-mission-group");
      expect(group.textContent).toContain("Big Mission");
      expect(group.getAttribute("data-expanded")).toBe("false");
      expect(screen.queryByTestId("work-chain-item")).toBeNull();
      // 다음 할 일 미리보기 — 우선순위가 가장 앞선 미완료 단계.
      expect(
        screen.getByTestId("work-chain-mission-group-progress").textContent,
      ).toContain("0/2");
      expect(group.textContent).toContain("1단계: 설계");
    });

    it("그룹 행을 클릭하면 개별 단계가 펼쳐지고, 근거·상태 등 기존 상세는 그대로다", () => {
      setTasks([{ id: "t1", status: "DONE", title: "티켓" }]);
      render(createElement(WorkChainPanel, { projectId: "p1" }));
      push([
        chainItem({
          id: "step1",
          what: "1단계: 설계",
          why: "이유1",
          missionLabel: "Big Mission",
          taskIds: ["t1"],
        }),
        chainItem({
          id: "step2",
          what: "2단계: 구현",
          why: "이유2",
          missionLabel: "Big Mission",
        }),
      ]);
      fireEvent.click(screen.getByTestId("work-chain-toggle"));
      fireEvent.click(screen.getByTestId("work-chain-mission-group-toggle"));

      expect(
        screen
          .getByTestId("work-chain-mission-group")
          .getAttribute("data-expanded"),
      ).toBe("true");
      const items = screen.getAllByTestId("work-chain-item");
      expect(items).toHaveLength(2);
      expect(items[0]!.textContent).toContain("1단계: 설계");
      expect(items[0]!.textContent).toContain("이유1");
      // 근거 티켓 상세(evidence)는 그룹 안에서도 항목별로 그대로 보인다 —
      // 완료 근거를 클릭 한 번 더 판다고 잃지 않는다.
      expect(items[0]!.textContent).toContain("티켓");
      expect(items[0]!.textContent).toContain("DONE");

      // 클릭해서 접으면 다시 숨는다.
      fireEvent.click(screen.getByTestId("work-chain-mission-group-toggle"));
      expect(screen.queryByTestId("work-chain-item")).toBeNull();
    });

    it("내려진(dropped) 단계도 그룹 진행률엔 반영된다 — showClosed 와 무관하게", () => {
      render(createElement(WorkChainPanel, { projectId: "p1" }));
      push([
        chainItem({
          id: "step1",
          what: "1단계",
          missionLabel: "Big Mission",
          closed: { kind: "dropped", reason: "필요 없어짐", at: 1, by: "orch" },
        }),
        chainItem({
          id: "step2",
          what: "2단계",
          missionLabel: "Big Mission",
        }),
      ]);
      fireEvent.click(screen.getByTestId("work-chain-toggle"));
      // ★내려진 1단계도 "라벨 있는 항목은 항상 그룹에 들어간다" 규칙 때문에
      // showClosed 를 켜지 않아도 진행률(1/2)에 반영된다 — 안 그러면 이미
      // 끝난 절반이 화면에서 조용히 사라진 것처럼 보인다.
      expect(
        screen.getByTestId("work-chain-mission-group-progress").textContent,
      ).toContain("1/2");
      expect(
        screen.getByTestId("work-chain-mission-group").textContent,
      ).toContain("2단계");

      fireEvent.click(screen.getByTestId("work-chain-mission-group-toggle"));
      const items = screen.getAllByTestId("work-chain-item");
      expect(items).toHaveLength(2);
      expect(items.some((el) => el.textContent?.includes("1단계"))).toBe(true);
    });

    it("서로 다른 라벨은 각자 별도 그룹 행이 된다", () => {
      render(createElement(WorkChainPanel, { projectId: "p1" }));
      push([
        chainItem({ id: "a1", what: "A-1", missionLabel: "Mission A" }),
        chainItem({ id: "a2", what: "A-2", missionLabel: "Mission A" }),
        chainItem({ id: "b1", what: "B-1", missionLabel: "Mission B" }),
        chainItem({ id: "b2", what: "B-2", missionLabel: "Mission B" }),
      ]);
      fireEvent.click(screen.getByTestId("work-chain-toggle"));
      const groups = screen.getAllByTestId("work-chain-mission-group");
      expect(groups).toHaveLength(2);
      expect(groups[0]!.textContent).toContain("Mission A");
      expect(groups[1]!.textContent).toContain("Mission B");
    });
  });
});
