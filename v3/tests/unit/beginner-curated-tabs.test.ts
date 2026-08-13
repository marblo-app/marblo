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
 *   ① 기본은 대화다 — 큐레이트 넷은 **누르기 전엔 트리에 없다**(지연 마운트)
 *   ② 탭을 누르면 그 화면이 뜬다 (가이드·코드·사용량·설정)
 *   ③ ★탭을 옮겨도 오케 대화창은 재마운트되지 않는다 (PTY 생존)
 *   ④ 엑스퍼트 나머지 탭은 탭바에 없다
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
vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ tasks: [], subscribeToTasks: () => () => {} }),
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

// 큐레이트 넷 — 본체는 각자 자기 구독·에디터·결제 화면을 끌고 온다. 여기서
// 검증하는 건 "그 컴포넌트가 걸렸는가" 이지 그 화면의 내용이 아니다.
vi.mock("../../src/components/guide/GuideTab", () => ({
  GuideTab: () => createElement("div", { "data-testid": "stub-guide" }),
}));
vi.mock("../../src/components/tabs/CodeTab", () => ({
  CodeTab: () => createElement("div", { "data-testid": "stub-code" }),
}));
vi.mock("../../src/components/usage/UsagePage", () => ({
  UsagePage: () => createElement("div", { "data-testid": "stub-usage" }),
}));
vi.mock("../../src/components/settings/SettingsPage", () => ({
  SettingsPage: () => createElement("div", { "data-testid": "stub-settings" }),
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
  BeginnerTaskModal: () => null,
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
import { useLocaleStore } from "../../src/lib/i18n";
import { useUiStore } from "../../src/stores/uiStore";
import { ko } from "../../src/locales/ko";

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  useUiStore.setState({ pendingSettingsSection: null });
  mounts.orchestrator = 0;
  beginnerStore.promote.mockClear();
});

afterEach(() => cleanup());

describe("심플 큐레이트 탭 — 배선", () => {
  it("★기본은 대화다 — 큐레이트 넷은 누르기 전엔 트리에 없다", () => {
    render(createElement(BeginnerShell));

    expect(screen.getByTestId("stub-orchestrator")).toBeTruthy();
    expect(
      screen.getByTestId("beginner-tab-chat").getAttribute("aria-selected"),
    ).toBe("true");
    for (const stub of ["guide", "code", "usage", "settings"]) {
      expect(screen.queryByTestId(`stub-${stub}`)).toBeNull();
    }
  });

  it.each([
    ["guide", "stub-guide"],
    ["code", "stub-code"],
    ["usage", "stub-usage"],
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
    expect(bar.querySelectorAll('[role="tab"]')).toHaveLength(5);
    for (const hidden of beginnerHiddenExpertTabs([])) {
      expect(screen.queryByTestId(`beginner-tab-${hidden}`)).toBeNull();
      expect(bar.textContent).not.toContain(ko[`workspace.tab.${hidden}`]);
    }
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
