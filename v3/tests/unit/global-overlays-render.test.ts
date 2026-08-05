/**
 * @vitest-environment jsdom
 *
 * GlobalOverlays — DOM render wiring for the shared banners/modals/toasts
 * both Layout and WorkspaceShell mount (ticket djYMmyNksWmjdiWhQN8j).
 *
 * Each real overlay pulls in a large dependency tree (project/editor stores,
 * telemetry, electronAPI, …), so this test stubs every child with a
 * lightweight marker component. That isolates GlobalOverlays' OWN contract —
 * that it renders every overlay, forwards `projectSetup` correctly, and gates
 * the upgrade modal on uiStore — from the internals each overlay already has
 * its own tests for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";

import type { ProjectSetup } from "../../src/hooks/useProjectSetup";

const uiStoreMock = vi.hoisted(() => ({
  state: {
    upgradeModal: null as { feature: string; requiredPlan: string } | null,
    hideUpgrade: vi.fn(),
  },
}));

vi.mock("../../src/stores/uiStore", () => ({
  useUiStore: (selector: (s: typeof uiStoreMock.state) => unknown) =>
    selector(uiStoreMock.state),
}));

vi.mock("../../src/components/UpdateBanner", () => ({
  UpdateBanner: () => createElement("div", { "data-testid": "update-banner" }),
}));
vi.mock("../../src/components/legal/MarketingReconsentBanner", () => ({
  MarketingReconsentBanner: () =>
    createElement("div", { "data-testid": "marketing-reconsent-banner" }),
}));
vi.mock("../../src/components/onboarding/ProjectSetupBanners", () => ({
  ProjectSetupBanners: (props: ProjectSetup) =>
    createElement("div", {
      "data-testid": "project-setup-banners",
      "data-show-new-project": String(props.showNewProject),
      "data-recovery-notice": props.recoveryNotice ?? "",
    }),
}));
vi.mock("../../src/components/collaboration/RepoConnectModal", () => ({
  RepoConnectModal: () =>
    createElement("div", { "data-testid": "repo-connect-modal" }),
}));
vi.mock("../../src/components/onboarding/FirstProjectSurvey", () => ({
  FirstProjectSurvey: () =>
    createElement("div", { "data-testid": "first-project-survey" }),
}));
vi.mock("../../src/components/legal/PrivacyConsentGate", () => ({
  PrivacyConsentGate: () =>
    createElement("div", { "data-testid": "privacy-consent-gate" }),
}));
vi.mock("../../src/components/chat/ChatToastHost", () => ({
  ChatToastHost: () =>
    createElement("div", { "data-testid": "chat-toast-host" }),
}));
vi.mock("../../src/components/chat/BugReportNoticeToast", () => ({
  BugReportNoticeToast: () =>
    createElement("div", { "data-testid": "bug-report-notice-toast" }),
}));
vi.mock("../../src/components/settings/UpgradeModal", () => ({
  UpgradeModal: (props: {
    feature: string;
    requiredPlan: string;
    onClose: () => void;
  }) =>
    createElement(
      "button",
      {
        "data-testid": "upgrade-modal",
        "data-feature": props.feature,
        "data-required-plan": props.requiredPlan,
        onClick: props.onClose,
      },
      "upgrade",
    ),
}));

import { GlobalOverlays } from "../../src/components/GlobalOverlays";

function makeProjectSetup(overrides: Partial<ProjectSetup> = {}): ProjectSetup {
  return {
    showNewProject: false,
    newProjectName: "",
    setNewProjectName: vi.fn(),
    newProjectInputRef: { current: null },
    handleCreateInlineProject: vi.fn(),
    handleCancelInlineProject: vi.fn(),
    handleSelectDirectory: vi.fn(),
    recoveryNotice: null,
    dismissRecoveryNotice: vi.fn(),
    ...overrides,
  } as ProjectSetup;
}

describe("GlobalOverlays DOM wiring", () => {
  beforeEach(() => {
    uiStoreMock.state.upgradeModal = null;
    uiStoreMock.state.hideUpgrade.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mounts every shared banner/modal/toast unconditionally", () => {
    render(createElement(GlobalOverlays, { projectSetup: makeProjectSetup() }));

    expect(screen.getByTestId("update-banner")).toBeTruthy();
    expect(screen.getByTestId("marketing-reconsent-banner")).toBeTruthy();
    expect(screen.getByTestId("project-setup-banners")).toBeTruthy();
    expect(screen.getByTestId("repo-connect-modal")).toBeTruthy();
    expect(screen.getByTestId("first-project-survey")).toBeTruthy();
    expect(screen.getByTestId("privacy-consent-gate")).toBeTruthy();
    expect(screen.getByTestId("chat-toast-host")).toBeTruthy();
    expect(screen.getByTestId("bug-report-notice-toast")).toBeTruthy();
  });

  it("forwards projectSetup straight through to ProjectSetupBanners", () => {
    render(
      createElement(GlobalOverlays, {
        projectSetup: makeProjectSetup({
          showNewProject: true,
          recoveryNotice: "restored",
        }),
      }),
    );

    const banners = screen.getByTestId("project-setup-banners");
    expect(banners.getAttribute("data-show-new-project")).toBe("true");
    expect(banners.getAttribute("data-recovery-notice")).toBe("restored");
  });

  it("hides the upgrade modal when uiStore has no pending upgrade", () => {
    render(createElement(GlobalOverlays, { projectSetup: makeProjectSetup() }));
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("shows the upgrade modal with uiStore's feature/plan and wires onClose to hideUpgrade", () => {
    uiStoreMock.state.upgradeModal = {
      feature: "flows",
      requiredPlan: "pro",
    };

    render(createElement(GlobalOverlays, { projectSetup: makeProjectSetup() }));

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal.getAttribute("data-feature")).toBe("flows");
    expect(modal.getAttribute("data-required-plan")).toBe("pro");

    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(uiStoreMock.state.hideUpgrade).toHaveBeenCalledTimes(1);
  });
});
