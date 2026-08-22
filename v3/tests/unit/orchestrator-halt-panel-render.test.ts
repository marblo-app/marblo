/**
 * @vitest-environment jsdom
 *
 * 멈춘 오케가 **화면에서** 어떻게 보이나 — 마블로(어드밴스드) · 비기너 **양쪽**.
 *
 * ★비기너를 따로 검사하는 이유. 실측 F-5 는 비기너에 별도 런치 경로가 없고
 * 같은 IPC·같은 `OrchestratorPanel` 을 쓴다는 것을 확인했지만, 패널은 비기너에서
 * **다른 props** 로 마운트된다(`hideModelControls` / `showConnectedModelPicker` /
 * `showSessionRecovery`). 그 분기 중 하나가 사유 배너를 감추면 "마블로에선 보이는데
 * 비기너에선 안 보인다" 가 된다 — 그리고 비기너가 더 나쁘다: 멈춘 다이얼로그가
 * 원시 PTY 로 보이는데 그 위엔 초록 "실행 중" 이 달려 있었다.
 * 그래서 "한 곳만 고치면 된다" 는 **주장이 아니라 이 테스트가 증명한다.**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";

import type { OrchestratorHalt } from "../../src/lib/orchestratorHalt";
// ★문구 자체는 `orchestrator-halt.test.ts` 가 ko/en 양쪽으로 본다. 여기서는
// "그 문구가 실제로 화면에 걸리나" 만 보므로 사전에서 직접 꺼내 비교한다 —
// 문장을 손으로 베껴 두면 문구를 다듬을 때마다 렌더 테스트가 깨진다.
import { en } from "../../src/locales/en";

const stores = vi.hoisted(() => ({
  status: "running" as string,
  halt: null as OrchestratorHalt | null,
  ptySessionId: "pty-1" as string | null,
  isCollapsed: false,
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1", folderPath: "/tmp/p1" } }),
  ),
}));

vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ rootPath: "/tmp/p1" }),
  ),
}));

vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ tasks: [] }),
  ),
}));

vi.mock("../../src/stores/cliSetupStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/stores/cliSetupStore")>()),
  useCliSetupStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ states: {} }),
  ),
}));

// 터미널은 xterm 을 끌고 오므로 자리표시자로 바꾼다 — 이 테스트가 보는 것은
// "터미널이 살아 있나" 라는 사실뿐이다.
vi.mock("../../src/components/orchestrator/OrchestratorTerminal", () => ({
  default: () =>
    createElement("div", { "data-testid": "orchestrator-terminal" }),
}));

vi.mock("../../src/services/cliSetupActions", () => ({
  launchLogin: vi.fn(),
}));
vi.mock("../../src/services/orchestratorAgentDoc", () => ({
  upsertOrchestratorAgentDoc: vi.fn(),
}));
// 워크체인 패널(티켓 fQtXQ2NzyYs0MRpqByTS)은 Firestore 구독을 서비스로 감싼다 —
// 이 테스트가 보는 건 패널 자체가 아니라 오케 헤더/배너이므로 서비스만 비운다.
vi.mock("../../src/services/workChainService", () => ({
  subscribeWorkChain: vi.fn(() => () => {}),
  addWorkChainItemFromUi: vi.fn(async () => ({ ok: true, itemId: "wc_x" })),
  dropWorkChainItemFromUi: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/services/onrampBlockSignal", () => ({
  reportOnrampExecBlocked: vi.fn(),
}));

const actualStore = await vi.importActual<
  typeof import("../../src/stores/orchestratorStore")
>("../../src/stores/orchestratorStore");

vi.mock("../../src/stores/orchestratorStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/stores/orchestratorStore")
  >("../../src/stores/orchestratorStore");
  const useOrchestratorStore = Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        sessionId: "s1",
        ptySessionId: stores.ptySessionId,
        status: stores.status,
        isCollapsed: stores.isCollapsed,
        selectedModel: "claude",
        runningModel: "claude",
        switchStatus: "idle",
        lastHandoffSummary: null,
        launchBlock: null,
        halt: stores.halt,
        setSession: () => {},
        setStatus: () => {},
        setCollapsed: () => {},
        setSelectedModel: () => {},
        setSwitchStatus: () => {},
        setHandoffSummary: () => {},
        setLaunchBlock: () => {},
        setHalt: () => {},
        confirmLaunched: () => {},
        toggleCollapsed: () => {},
        clear: () => {},
      }),
    { getState: () => ({ switchStatus: "idle" }) },
  );
  return { ...actual, useOrchestratorStore };
});

const { default: OrchestratorPanel } =
  await import("../../src/components/orchestrator/OrchestratorPanel");

/** 마블로(어드밴스드) 마운트와 비기너 마운트의 실제 props. */
const SHELLS = [
  { name: "마블로(어드밴스드)", props: {} },
  {
    name: "비기너",
    props: {
      fill: true,
      hideModelControls: true,
      showConnectedModelPicker: true,
      showSessionRecovery: true,
    },
  },
] as const;

beforeEach(() => {
  stores.status = "running";
  stores.halt = null;
  stores.ptySessionId = "pty-1";
  stores.isCollapsed = false;
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    {
      claude: { version: () => Promise.resolve({ version: "2.1.238" }) },
      orchestratorModel: {
        get: () => Promise.resolve("claude"),
        set: () => Promise.resolve(),
      },
      orchestratorSession: {
        launch: () => Promise.resolve(null),
        stop: () => Promise.resolve(),
        listSessions: () => Promise.resolve([]),
      },
    };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("멈춘 오케 — 두 셸 모두에서 사유가 보인다", () => {
  for (const shell of SHELLS) {
    describe(shell.name, () => {
      it("★멈추면 초록이 아니고, 사유와 다음 행동이 함께 뜬다", () => {
        stores.status = "error";
        stores.halt = { kind: "firstRunDialog", model: "claude" };
        render(createElement(OrchestratorPanel, shell.props));

        const alert = screen.getByTestId("orchestrator-halt");
        expect(alert.getAttribute("role")).toBe("alert");
        expect(alert.getAttribute("data-halt-kind")).toBe("firstRunDialog");
        // 사유(무슨 일이 났나) + 다음 행동(무엇을 하면 되나)이 둘 다 있다.
        expect(alert.textContent).toContain(
          en["orchestrator.halt.firstRunDialogTitle"],
        );
        expect(alert.textContent).toContain(
          en["orchestrator.halt.firstRunDialogHint"],
        );
        // 헤더 라벨도 "Error" 가 아니라 사유를 말한다.
        expect(
          screen.getByTestId("orchestrator-status-label").textContent,
        ).toBe(en["orchestrator.halt.firstRunDialogLabel"]);
        // 초록 점이 서 있지 않다.
        expect(document.querySelector(".bg-\\[\\#a6e3a1\\]")).toBeNull();
      });

      it("★답해야 풀리는 사유면 터미널이 살아 있다 — 고칠 도구를 뺏지 않는다", () => {
        stores.status = "error";
        stores.halt = { kind: "firstRunDialog", model: "claude" };
        render(createElement(OrchestratorPanel, shell.props));
        expect(screen.getByTestId("orchestrator-terminal")).toBeTruthy();
      });

      it("로그인 사유면 원클릭 로그인 CTA 가 붙는다", () => {
        stores.status = "error";
        stores.halt = { kind: "needsAuth", model: "codex" };
        render(createElement(OrchestratorPanel, shell.props));
        const alert = screen.getByTestId("orchestrator-halt");
        // {model} 자리에 분류된 CLI id 가 박힌다 — 무엇을 로그인할지 말한다.
        expect(alert.textContent).toContain(
          en["orchestrator.halt.needsAuthTitle"].replace("{model}", "codex"),
        );
        expect(screen.getByTestId("orchestrator-halt-login")).toBeTruthy();
        expect(screen.getByTestId("orchestrator-halt-restart")).toBeTruthy();
      });

      it("PTY 가 이미 죽은 사유면 터미널을 감춘다", () => {
        stores.status = "error";
        stores.halt = { kind: "rootPathMissing", model: null };
        render(createElement(OrchestratorPanel, shell.props));
        expect(screen.queryByTestId("orchestrator-terminal")).toBeNull();
        // 그래도 사유와 다음 행동은 남는다.
        expect(screen.getByTestId("orchestrator-halt").textContent).toContain(
          en["orchestrator.halt.rootPathMissingHint"],
        );
      });

      it("돌고 있을 땐 배너가 없다 — 초록 위에 낡은 사유가 남지 않는다", () => {
        stores.status = "running";
        stores.halt = null;
        render(createElement(OrchestratorPanel, shell.props));
        expect(screen.queryByTestId("orchestrator-halt")).toBeNull();
      });
    });
  }
});

describe("멈춘 채로 터미널을 보여줄 때의 높이", () => {
  it("★고정 높이를 유지한다 — 놓으면 flex-1 터미널이 0px 로 접힌다", () => {
    // 배너가 뜨면 높이 고정을 놓는 규칙이 있는데(접힘 36px 안에 배너를 그리면
    // 안내가 삐져나온다), 정지 사유 배너는 터미널을 **살려 둔 채로** 뜨는 경우가
    // 있어 그 규칙을 그대로 적용하면 터미널이 사라진 것처럼 보인다.
    stores.status = "error";
    stores.halt = { kind: "firstRunDialog", model: "claude" };
    const { container } = render(createElement(OrchestratorPanel, {}));
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.height).not.toBe("");
    expect(screen.getByTestId("orchestrator-terminal")).toBeTruthy();
  });

  it("터미널이 없으면 고정을 놓아 배너가 잘리지 않는다", () => {
    stores.status = "error";
    stores.halt = { kind: "rootPathMissing", model: null };
    const { container } = render(createElement(OrchestratorPanel, {}));
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.height).toBe("");
  });
});

describe("스토어 계약", () => {
  it("★비-error 로 가면 사유가 지워진다", () => {
    const store = actualStore.useOrchestratorStore;
    store.setState({
      status: "error",
      halt: { kind: "needsAuth", model: "codex" },
    });
    store.getState().setStatus("running");
    expect(store.getState().halt).toBeNull();
  });

  it("★launch 성공 반환이 이미 도착한 사유를 덮지 않는다", () => {
    // 실측: codex 미인증은 스폰 445ms 에 이미 error 다. launch 의 반환이 그보다
    // 늦으면 종전 코드는 화면을 다시 초록으로 만들었다.
    const store = actualStore.useOrchestratorStore;
    store.setState({
      status: "error",
      halt: { kind: "needsAuth", model: "codex" },
    });
    store.getState().confirmLaunched();
    expect(store.getState().status).toBe("error");
    expect(store.getState().halt).not.toBeNull();
  });

  it("사유가 없으면 종전대로 running 으로 올린다", () => {
    const store = actualStore.useOrchestratorStore;
    store.setState({ status: "starting", halt: null });
    store.getState().confirmLaunched();
    expect(store.getState().status).toBe("running");
  });
});
