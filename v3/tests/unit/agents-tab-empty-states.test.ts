/**
 * @vitest-environment jsdom
 *
 * AgentsTab(마블로봇 탭 껍데기) — 빈 상태 두 가지. 티켓 EzCYDCeMETcEyecPUfMI.
 *
 *  · 프로젝트 없음 → 폴더 선택 CTA(막다른 길 없음).
 *  · 프로젝트는 있는데 로그인 없음 → 봇 섹션은 loginRequired 문구.
 *  · 섹션 탭(봇/에이전트/트리거) 전환이 실제 하위 화면을 바꾼다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const authMock = vi.hoisted(() => ({
  user: { uid: "u1" } as { uid: string } | null,
}));
const projectMock = vi.hoisted(() => ({
  currentProject: null as Record<string, unknown> | null,
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: authMock.user }),
}));
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ currentProject: projectMock.currentProject }),
}));
vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({
      agents: [],
      loading: false,
      subscribeToAgents: () => () => undefined,
      stopAgent: vi.fn(),
      restartAgent: vi.fn(),
      deleteAgent: vi.fn(),
    }),
}));
vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: (selector: (s: unknown) => unknown) =>
    selector({ tasks: [], subscribeToTasks: () => () => undefined }),
}));
vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: { getState: () => ({ attachSession: vi.fn() }) },
}));
vi.mock("../../src/stores/navigationStore", () => ({
  useNavigationStore: (selector: (s: unknown) => unknown) =>
    selector({ pendingJump: null, consumeJump: vi.fn() }),
}));
vi.mock("../../src/stores/subscriptionStore", () => ({
  useSubscriptionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ getPlan: () => "free" }),
    { getState: () => ({ getPlan: () => "free" }) },
  ),
}));
vi.mock("../../src/stores/uiStore", () => ({
  useUiStore: { getState: () => ({ showUpgrade: vi.fn() }) },
}));
vi.mock("../../src/lib/planLimits", () => ({
  checkAgentSpawn: () => ({ allowed: true, active: 0, limit: 0 }),
}));
vi.mock("../../src/services/agentService", () => ({}));
vi.mock("../../src/services/onrampBlockSignal", () => ({
  reportOnrampExecBlocked: vi.fn(),
}));
vi.mock("../../src/components/agents/AgentDashboard", () => ({
  default: (props: { scope: string }) =>
    createElement("div", { "data-testid": `dashboard-${props.scope}` }),
}));
vi.mock("../../src/components/agents/AgentAddModal", () => ({
  default: () => null,
}));
vi.mock("../../src/components/agents/MarbloBotGallery", () => ({
  MarbloBotGallery: () => createElement("div", { "data-testid": "gallery" }),
}));
vi.mock("../../src/components/agents/AssistantTriggerSettingsPanel", () => ({
  AssistantTriggerSettingsPanel: () =>
    createElement("div", { "data-testid": "triggers" }),
}));

import { AgentsTab } from "../../src/components/tabs/AgentsTab";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  authMock.user = { uid: "u1" };
  projectMock.currentProject = { id: "p1", name: "비서", kind: "assistant" };
});

afterEach(() => {
  cleanup();
});

describe("AgentsTab 빈 상태", () => {
  it("프로젝트가 없으면 폴더 선택 CTA 를 보여주고, 누르면 select-folder 이벤트를 쏜다", () => {
    projectMock.currentProject = null;
    const listener = vi.fn();
    window.addEventListener("marblo:select-folder", listener);
    render(createElement(AgentsTab));
    expect(screen.getByText(ko["agents.noProject.title"])).toBeTruthy();
    fireEvent.click(screen.getByText(ko["agents.noProject.cta"]));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("marblo:select-folder", listener);
    expect(screen.queryByTestId("gallery")).toBeNull();
  });

  it("로그인이 없으면 봇 섹션 대신 loginRequired 문구를 보여준다", () => {
    authMock.user = null;
    render(createElement(AgentsTab));
    expect(
      screen.getByText(ko["agents.marbloBots.loginRequired"]),
    ).toBeTruthy();
    expect(screen.queryByTestId("gallery")).toBeNull();
  });

  it("기본은 봇 섹션이고, 탭을 누르면 에이전트(bot scope)·트리거 화면으로 바뀐다", () => {
    render(createElement(AgentsTab));
    expect(screen.getByTestId("gallery")).toBeTruthy();

    fireEvent.click(screen.getByText(ko["agents.marbloBots.section.agents"]));
    expect(screen.getByTestId("dashboard-bot")).toBeTruthy();
    expect(screen.queryByTestId("gallery")).toBeNull();

    fireEvent.click(screen.getByText(ko["agents.marbloBots.section.triggers"]));
    expect(screen.getByTestId("triggers")).toBeTruthy();

    fireEvent.click(screen.getByText(ko["agents.marbloBots.section.bots"]));
    expect(screen.getByTestId("gallery")).toBeTruthy();
  });
});
