/**
 * @vitest-environment jsdom
 *
 * ★심플 모드 큐레이트 탭 — **셸을 실제로 마운트해서** 본다.
 *
 * `beginnerTabs.test.ts` 는 목록(무엇을 노출하는가)을 못박고, 여기서는 배선을
 * 본다: 눌렀을 때 그 화면이 뜨는가, 그리고 **대화가 살아남는가.**
 *
 * 셸을 통째로 올리는 이유가 두 번째 항목이다. 이 탭 전환의 유일한 위험은 오케
 * 대화창이 실 PTY 라는 사실에 있다 — 전환을 조건부 렌더로 짜면 탭을 옮길 때마다
 * OrchestratorPanel 이 언마운트되고, 돌아왔을 때 스크롤백은 사라진 뒤다. 하네스로
 * 배선을 베껴 쓰면 그 계약은 **하네스에서만** 참이 된다(이 폴더의 다른 셸 테스트가
 * 겪은 함정 — beginner-shell-wiring.test.ts 상단 주석). 그래서 진짜 셸을 올리고,
 * 무거운 것들(PTY·CLI 프로브·라이프사이클·큐레이트 탭 본체)만 스텁으로 바꾼다.
 *
 * 못박는 계약:
 *   ① 기본은 대화다 — 큐레이트 일곱은 **누르기 전엔 트리에 없다**(지연 마운트)
 *   ② 탭을 누르면 그 화면이 뜬다 (가이드·코드·에이전트·워크트리·사용량·하네스·설정)
 *   ③ ★탭을 옮겨도 오케 대화창은 재마운트되지 않는다 (PTY 생존)
 *   ④ 엑스퍼트 나머지 탭은 탭바에 없다 + 하네스는 모달이 아니라 인라인이다
 *   ⑤ ★상단바 "설정" 은 더 이상 **승격시키지 않는다** — 심플 안에서 연다
 *   ⑥ uiStore 의 "설정 섹션 열기" 래치가 심플에서도 도착한다
 *   ⑦ 큐레이트 탭에 가 있는 동안 코치마크 투어는 멈춘다(앵커가 display:none)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

/** OrchestratorPanel 스텁이 세는 마운트 횟수 — 계약 ③의 계측점. */
const mounts = vi.hoisted(() => ({ orchestrator: 0 }));

const beginnerStore = vi.hoisted(() => ({
  enteredAt: 1,
  entryReason: "fresh" as const,
  // 계측 이펙트는 재우고(이 파일의 관심사가 아니다) 승격만 관찰한다.
  enteredReported: true,
  markEnteredReported: vi.fn(),
  firstCompletionAt: 1,
  markFirstCompletion: vi.fn(() => null),
  promotionShownAt: 1,
  markPromotionShown: vi.fn(),
  promote: vi.fn(),
}));

// 셸의 import 그래프는 firebase 와 xterm 까지 끌고 온다(타입/서비스 경유).
// 여기서 태울 이유가 없다 — 아래 스텁들이 실제로 그리는 것은 DOM 뿐이다.
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));

vi.mock("../../src/hooks/useAppLifecycle", () => ({
  useAppLifecycle: () => {},
}));
vi.mock("../../src/hooks/useCliSetupEngine", () => ({
  useCliSetupEngine: () => {},
}));
vi.mock("../../src/hooks/useOnboardingSetup", () => ({
  useOnboardingSetup: () => ({
    preview: false,
    ready: true,
    sampleStatus: "idle",
    funding: { checking: false, outcome: null },
  }),
}));

vi.mock("../../src/stores/beginnerModeStore", () => ({
  useBeginnerModeStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector(beginnerStore),
  ),
}));
vi.mock("../../src/stores/onboardingPreviewStore", () => ({
  useOnboardingPreviewStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ enabled: false, setEnabled: vi.fn() }),
  ),
}));
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      currentProject: { id: "p1", name: "demo", folderPath: "/tmp/repo" },
    }),
  ),
}));
/** 구독 스냅샷. 점프 래치 테스트가 티켓 하나를 넣었다 뺐다 한다. */
const taskSnapshot = vi.hoisted(() => ({ tasks: [] as { id: string }[] }));

vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      tasks: taskSnapshot.tasks,
      subscribeToTasks: () => () => {},
    }),
  ),
}));
vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ agents: [], subscribeToAgents: () => () => {} }),
  ),
}));
vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ sessions: [] }),
  ),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    beginnerEntered: vi.fn(),
    beginnerFirstCompletion: vi.fn(),
    beginnerPromoted: vi.fn(),
    cliSetupStep: vi.fn(),
  },
  // 심플 셸이 "왜 멈췄나" 문항(PauseReasonPrompt)을 함께 마운트한다. 이 테스트는
  // 큐레이트 탭 배선을 보는 자리라 그 문항은 뜨지 않는 편이 맞다 — 동의 게이트를
  // 꺼 두면 판정 단계에서 곧바로 물러선다(그 판정 자체는 pauseReasonPrompt 테스트).
  isTelemetryEnabled: () => false,
  telemetry: { pauseReasonPrompt: vi.fn() },
}));
vi.mock("../../src/services/cliSetupActions", () => ({
  connectFolder: vi.fn(),
}));
vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: vi.fn(async () => "local"),
}));
vi.mock("../../src/services/firestore", () => ({
  subscribeToDocument: vi.fn(() => () => {}),
  subscribeToCollection: vi.fn(() => () => {}),
}));

/** 오케 대화창 = 실 PTY. 마운트 횟수를 세는 게 이 스텁의 유일한 일이다. */
vi.mock("../../src/components/orchestrator/OrchestratorPanel", () => ({
  default: () => {
    useEffect(() => {
      mounts.orchestrator += 1;
    }, []);
    return createElement("div", { "data-testid": "stub-orchestrator" });
  },
}));

vi.mock("../../src/components/sidebar/Sidebar", () => ({
  Sidebar: ({ isOpen }: { isOpen: boolean; onToggle: () => void }) =>
    createElement("div", {
      "data-testid": "stub-sidebar",
      "data-open": isOpen ? "1" : "0",
    }),
}));

// 큐레이트 여덟 — 본체는 각자 자기 구독·에디터·결제 화면을 끌고 온다. 여기서
// 검증하는 건 "그 컴포넌트가 걸렸는가" 이지 그 화면의 내용이 아니다.
vi.mock("../../src/components/onboarding/StartHereTab", () => ({
  StartHereTab: () =>
    createElement("div", { "data-testid": "stub-start-here" }),
}));
vi.mock("../../src/components/guide/GuideTab", () => ({
  GuideTab: () => createElement("div", { "data-testid": "stub-guide" }),
}));
vi.mock("../../src/components/tabs/CodeTab", () => ({
  CodeTab: () => createElement("div", { "data-testid": "stub-code" }),
}));
vi.mock("../../src/components/tabs/AgentsTab", () => ({
  AgentsTab: () => createElement("div", { "data-testid": "stub-agents" }),
}));
vi.mock("../../src/components/tabs/WorktreeTab", () => ({
  WorktreeTab: () => createElement("div", { "data-testid": "stub-worktrees" }),
}));
// ★하네스 = 심플 모드의 연결(GitHub·텔레그램·슬랙) 진입점. 여기서 확인하는 건
// "그 컴포넌트가 걸렸는가" + "모달이 아니라 인라인인가"(onClose 미전달)다.
vi.mock("../../src/components/harness/HarnessStore", () => ({
  HarnessStore: ({ onClose }: { onClose?: () => void }) =>
    createElement("div", {
      "data-testid": "stub-harness",
      "data-modal": onClose ? "1" : "0",
    }),
}));
vi.mock("../../src/components/usage/UsagePage", () => ({
  UsagePage: () => createElement("div", { "data-testid": "stub-usage" }),
}));
vi.mock("../../src/components/settings/SettingsPage", () => ({
  SettingsPage: () => createElement("div", { "data-testid": "stub-settings" }),
}));
vi.mock("../../src/components/board/TaskDetailModal", () => ({
  TaskDetailModal: ({ task }: { task: { id: string } }) =>
    createElement("div", {
      "data-testid": "stub-task-modal",
      "data-task": task.id,
    }),
}));

// 대화 탭의 나머지 살림 — 이 파일의 관심사가 아니다(각자 자기 테스트가 있다).
vi.mock("../../src/components/beginner/BeginnerChatBar", () => ({
  BeginnerChatBar: () =>
    createElement("div", { "data-testid": "stub-chatbar" }),
}));
vi.mock("../../src/components/beginner/BeginnerLiveStrip", () => ({
  BeginnerLiveStrip: () => createElement("div"),
}));
vi.mock("../../src/components/beginner/BeginnerAgentsPane", () => ({
  BeginnerAgentsPane: () => createElement("div"),
}));
vi.mock("../../src/components/beginner/BeginnerTour", () => ({
  BeginnerTour: ({ blocked }: { blocked: boolean }) =>
    createElement("div", {
      "data-testid": "stub-tour",
      "data-blocked": blocked ? "1" : "0",
    }),
}));
vi.mock("../../src/components/beginner/OnboardingPreviewBanner", () => ({
  OnboardingPreviewBanner: () => null,
}));
// 실 xterm 을 태우지 않기 위한 것 — 이 모달들은 여기서 열리지도 않는다.
vi.mock("../../src/components/beginner/BeginnerAgentTerminalModal", () => ({
  BeginnerAgentTerminalModal: () => null,
}));
vi.mock("../../src/components/beginner/BeginnerTaskModal", () => ({
  // 점프 래치의 `task` 목적지 — 심플에는 보드가 없어서 이 모달이 목적지다.
  BeginnerTaskModal: ({ task }: { task: { id: string } }) =>
    createElement("div", {
      "data-testid": "stub-task-modal",
      "data-task": task.id,
    }),
}));
vi.mock("../../src/components/beginner/BeginnerOneClickModal", () => ({
  BeginnerOneClickModal: () => null,
}));
vi.mock("../../src/components/beginner/BeginnerConnectStep", () => ({
  BeginnerConnectStep: () => null,
}));
vi.mock("../../src/components/beginner/BeginnerPromotionModal", () => ({
  BeginnerPromotionModal: () => null,
}));
vi.mock("../../src/components/onboarding/DemoMode", () => ({
  DemoMode: () => null,
  DEMO_CONNECT_PENDING_KEY: "demo-connect-pending",
}));
vi.mock("../../src/components/onboarding/FundingGuideHost", () => ({
  FundingGuideHost: () => null,
}));
vi.mock("../../src/components/onboarding/OnrampGateHost", () => ({
  OnrampGateHost: () => null,
}));
vi.mock("../../src/components/legal/PrivacyConsentGate", () => ({
  PrivacyConsentGate: () => null,
}));
vi.mock("../../src/components/legal/TrainingConsentCard", () => ({
  TrainingConsentCard: () => null,
}));
vi.mock("../../src/components/legal/PrivacyClarificationNotice", () => ({
  PrivacyClarificationNotice: () => null,
}));

import { BeginnerShell } from "../../src/components/beginner/BeginnerShell";
import { beginnerHiddenExpertTabs } from "../../src/lib/beginnerTabs";
import { useNavigationStore } from "../../src/stores/navigationStore";
import { useLocaleStore } from "../../src/lib/i18n";
import { useUiStore } from "../../src/stores/uiStore";
import { ko } from "../../src/locales/ko";

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  useUiStore.setState({ pendingSettingsSection: null });
  useNavigationStore.setState({ pendingJump: null });
  taskSnapshot.tasks = [];
  mounts.orchestrator = 0;
  beginnerStore.promote.mockClear();
});

afterEach(() => cleanup());

describe("심플 큐레이트 탭 — 배선", () => {
  it("★기본은 대화다 — 큐레이트 여덟은 누르기 전엔 트리에 없다", () => {
    render(createElement(BeginnerShell));

    expect(screen.getByTestId("stub-sidebar").dataset.open).toBe("1");
    expect(screen.getByTestId("stub-orchestrator")).toBeTruthy();
    expect(screen.queryByTestId("stub-chatbar")).toBeNull();
    expect(
      screen.getByTestId("beginner-tab-chat").getAttribute("aria-selected"),
    ).toBe("true");
    for (const stub of [
      "start-here",
      "guide",
      "code",
      "agents",
      "worktrees",
      "usage",
      "harness",
      "settings",
    ]) {
      expect(screen.queryByTestId(`stub-${stub}`)).toBeNull();
    }
  });

  it.each([
    ["startHere", "stub-start-here"],
    ["guide", "stub-guide"],
    ["code", "stub-code"],
    ["agents", "stub-agents"],
    ["worktrees", "stub-worktrees"],
    ["usage", "stub-usage"],
    ["harness", "stub-harness"],
    ["settings", "stub-settings"],
  ])("%s 탭을 누르면 엑스퍼트의 그 화면이 뜬다", (tab, stub) => {
    render(createElement(BeginnerShell));

    fireEvent.click(screen.getByTestId(`beginner-tab-${tab}`));

    expect(screen.getByTestId(stub)).toBeTruthy();
    // 그 패널만 보인다 — 대화는 트리에 남되 display:none.
    expect(
      screen.getByTestId(`beginner-tabpanel-${tab}`).style.display,
    ).not.toBe("none");
  });

  it("★탭을 옮겨도 오케 대화창은 재마운트되지 않는다 (PTY·스크롤백 생존)", () => {
    render(createElement(BeginnerShell));
    expect(mounts.orchestrator).toBe(1);

    fireEvent.click(screen.getByTestId("beginner-tab-guide"));
    fireEvent.click(screen.getByTestId("beginner-tab-usage"));
    fireEvent.click(screen.getByTestId("beginner-tab-chat"));

    // 조건부 렌더였다면 여기가 4 다 — 되돌아온 대화창은 빈 화면이었을 것이다.
    expect(mounts.orchestrator).toBe(1);
    expect(screen.getByTestId("stub-orchestrator")).toBeTruthy();
  });

  it("한 번 연 큐레이트 탭도 계속 살아 있다 (스크롤·입력 보존)", () => {
    render(createElement(BeginnerShell));

    fireEvent.click(screen.getByTestId("beginner-tab-settings"));
    fireEvent.click(screen.getByTestId("beginner-tab-chat"));

    const panel = screen.getByTestId("beginner-tabpanel-settings");
    expect(panel).toBeTruthy();
    expect(panel.style.display).toBe("none");
  });

  it("★엑스퍼트 나머지 탭은 탭바에 없다", () => {
    render(createElement(BeginnerShell));

    const bar = screen.getByTestId("beginner-tabbar");
    expect(bar.querySelectorAll('[role="tab"]')).toHaveLength(9);
    for (const hidden of beginnerHiddenExpertTabs([])) {
      expect(screen.queryByTestId(`beginner-tab-${hidden}`)).toBeNull();
      expect(bar.textContent).not.toContain(ko[`workspace.tab.${hidden}`]);
    }
  });

  it("★하네스는 탭 자리에 **인라인**으로 뜬다 — 모달 크롬이 아니다", () => {
    // onClose 를 주면 HarnessStore 는 스스로를 모달로 그린다(isModal). 탭 안에서
    // 그러면 닫기 버튼이 갈 곳이 없다 — 엑스퍼트 탭바와 같은 래퍼여야 한다.
    render(createElement(BeginnerShell));

    fireEvent.click(screen.getByTestId("beginner-tab-harness"));

    expect(screen.getByTestId("stub-harness").dataset.modal).toBe("0");
  });

  it("★코드 탭은 심플 전용 사본이 아니라 큐레이트 패널의 CodeTab 자리로 열린다", () => {
    render(createElement(BeginnerShell));

    fireEvent.click(screen.getByTestId("beginner-tab-code"));

    expect(screen.getByTestId("beginner-tabpanel-code")).toBeTruthy();
    expect(screen.getByTestId("stub-code")).toBeTruthy();
    expect(screen.getByTestId("stub-sidebar").dataset.open).toBe("1");
  });
});

describe("심플 큐레이트 탭 — 설정으로 가는 길", () => {
  it("★상단바 '설정' 은 승격시키지 않는다 — 심플 안에서 연다", () => {
    render(createElement(BeginnerShell));

    fireEvent.click(screen.getByTestId("beginner-open-settings"));

    expect(screen.getByTestId("stub-settings")).toBeTruthy();
    // 종전 배선은 여기서 어드밴스드로 올렸다(13탭 화면에 떨어졌다).
    expect(beginnerStore.promote).not.toHaveBeenCalled();
    expect(screen.getByTestId("stub-orchestrator")).toBeTruthy();
  });

  it("'개발 모드로' 는 그대로 승격시킨다 — 두 버튼이 섞이지 않았다", () => {
    render(createElement(BeginnerShell));

    fireEvent.click(screen.getByTestId("beginner-go-advanced"));

    expect(beginnerStore.promote).toHaveBeenCalledTimes(1);
  });

  it("★'설정의 이 섹션을 열어라' 래치가 심플에서도 도착한다", () => {
    render(createElement(BeginnerShell));
    expect(screen.queryByTestId("stub-settings")).toBeNull();

    // 업그레이드 모달 CTA 등이 세우는 래치. 종전 심플 셸에는 설정 탭이 없어
    // 이 요청은 아무 데도 도착하지 못했다. (React 밖에서 세우는 값이라 act 로
    // 감싼다 — 실제로도 모달 콜백에서 스토어를 직접 건드린다.)
    act(() => {
      useUiStore.getState().openSettingsSection("billing");
    });

    expect(screen.getByTestId("stub-settings")).toBeTruthy();
  });
});

describe("심플 큐레이트 탭 — 코치마크", () => {
  it("★큐레이트 탭에 가 있는 동안 투어는 멈춘다 (앵커가 display:none)", () => {
    render(createElement(BeginnerShell));
    expect(screen.getByTestId("stub-tour").dataset.blocked).toBe("0");

    fireEvent.click(screen.getByTestId("beginner-tab-guide"));
    expect(screen.getByTestId("stub-tour").dataset.blocked).toBe("1");

    fireEvent.click(screen.getByTestId("beginner-tab-chat"));
    expect(screen.getByTestId("stub-tour").dataset.blocked).toBe("0");
  });
});

/**
 * ★탭 간 점프 래치 — 워크트리 탭이 심플에 들어오면서 필요해진 배선.
 *
 * 그 탭의 "코드에서 보기"·"티켓 보기" 는 스스로 화면을 바꾸지 않고 래치만
 * 세운다(navigationStore). 어드밴스드에서는 WorkspaceShell 이 그걸 받아 탭을
 * 옮겨 주는데, 심플에 소비자가 없으면 **눌러도 아무 일이 없는 버튼**이 된다 —
 * 화면에 흔적도 없이 실패하는 종류라 손으로는 안 잡힌다.
 */
describe("심플 큐레이트 탭 — 탭 간 점프", () => {
  it("코드 점프가 코드 탭을 연다 (워크트리의 '코드에서 보기')", () => {
    render(createElement(BeginnerShell));

    act(() => {
      useNavigationStore.getState().requestJump({ type: "code" });
    });

    expect(screen.getByTestId("stub-code")).toBeTruthy();
    // 목적지가 받았으면 래치는 비어야 한다 — 남으면 다음 렌더마다 다시 튄다.
    expect(useNavigationStore.getState().pendingJump).toBeNull();
  });

  it("워크트리 점프가 워크트리 탭을 연다 (코드 탭의 브랜치 diff 탈출구)", () => {
    render(createElement(BeginnerShell));

    act(() => {
      useNavigationStore.getState().requestJump({ type: "worktrees" });
    });

    expect(screen.getByTestId("stub-worktrees")).toBeTruthy();
    expect(useNavigationStore.getState().pendingJump).toBeNull();
  });

  it("★에이전트 점프는 탭만 옮기고 래치는 AgentsTab 에 넘긴다", () => {
    // 소거는 목적지의 일이다 — 셸이 미리 지우면 스크롤·플래시가 영영 안 뜬다.
    render(createElement(BeginnerShell));

    act(() => {
      useNavigationStore.getState().requestJump({ type: "agent", id: "a1" });
    });

    expect(screen.getByTestId("stub-agents")).toBeTruthy();
    expect(useNavigationStore.getState().pendingJump).toEqual({
      type: "agent",
      id: "a1",
    });
  });

  it("티켓 점프는 보드가 아니라 비기너 상세 모달을 연다", () => {
    taskSnapshot.tasks = [{ id: "t1" }];
    render(createElement(BeginnerShell));

    act(() => {
      useNavigationStore.getState().requestJump({ type: "task", id: "t1" });
    });

    expect(screen.getByTestId("stub-task-modal").dataset.task).toBe("t1");
    expect(useNavigationStore.getState().pendingJump).toBeNull();
  });

  it("★구독에 아직 없는 티켓이면 래치를 **소거하지 않고** 기다린다", () => {
    // 지워 버리면 구독이 한 프레임 늦은 것만으로 클릭이 증발한다.
    render(createElement(BeginnerShell));

    act(() => {
      useNavigationStore.getState().requestJump({ type: "task", id: "t9" });
    });

    expect(screen.queryByTestId("stub-task-modal")).toBeNull();
    expect(useNavigationStore.getState().pendingJump).toEqual({
      type: "task",
      id: "t9",
    });
  });
});
