// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../src/types/project";
import type { Task } from "../../src/types/task";

vi.mock("../../src/components/workspace/MarbloModeTour", () => ({
  MarbloModeTour: (props: {
    onFinish: () => void;
    onSkip: (permanent: boolean) => void;
  }) =>
    createElement(
      "div",
      { "data-testid": "mode-tour" },
      createElement(
        "button",
        { "data-testid": "finish-tour", onClick: props.onFinish },
        "finish",
      ),
      createElement(
        "button",
        { "data-testid": "skip-tour", onClick: () => props.onSkip(false) },
        "skip",
      ),
    ),
}));

vi.mock("../../src/components/onboarding/FirstProjectSurvey", () => ({
  FirstProjectSurvey: (props: {
    onResolved: (disposition: "submitted" | "later" | "dismissed") => void;
  }) =>
    createElement(
      "button",
      {
        "data-testid": "beta-survey",
        onClick: () => props.onResolved("submitted"),
      },
      "survey",
    ),
}));

vi.mock("../../src/components/collaboration/RepoConnectModal", () => ({
  REPO_CONNECT_OPEN_EVENT: "marblo:open-repo-connect",
}));

const { OnboardingGraduationJourney } =
  await import("../../src/components/onboarding/OnboardingGraduationJourney");
const {
  EMPTY_GRADUATION_JOURNEY,
  ONBOARDING_REPO_CONNECTED_EVENT,
  useOnboardingProgressStore,
} = await import("../../src/stores/onboardingProgressStore");
const { useTaskStore } = await import("../../src/stores/taskStore");
const { useProjectStore } = await import("../../src/stores/projectStore");
const { useWorkspaceModeStore } =
  await import("../../src/stores/workspaceModeStore");

function doneTask(id: string, projectId = "p1"): Task {
  return {
    id,
    projectId,
    contextId: "ctx",
    title: id,
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 1,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Project",
    ownerId: "u1",
    members: ["u1"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Project;
}

describe("OnboardingGraduationJourney", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingProgressStore.setState({
      graduationJourney: {
        modeTour: { ...EMPTY_GRADUATION_JOURNEY.modeTour },
        repoGuide: { ...EMPTY_GRADUATION_JOURNEY.repoGuide },
        betaSurvey: { ...EMPTY_GRADUATION_JOURNEY.betaSurvey },
      },
      activeGraduationMilestone: null,
    });
    useTaskStore.setState({
      tasks: Array.from({ length: 5 }, (_, i) => doneTask(`t${i + 1}`)),
    });
    useProjectStore.setState({ currentProject: project() });
    useWorkspaceModeStore.setState({ enabled: true });
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("starts the Marblo mode tour after five completed tickets", async () => {
    render(createElement(OnboardingGraduationJourney));

    expect(await screen.findByTestId("mode-tour")).toBeTruthy();
    expect(
      useOnboardingProgressStore.getState().graduationJourney.modeTour
        .promptedAt,
    ).toBeGreaterThan(0);
  });

  it("opens the repo guide only after the mode milestone is resolved", async () => {
    const opened = vi.fn();
    window.addEventListener("marblo:open-repo-connect", opened);

    render(createElement(OnboardingGraduationJourney));
    fireEvent.click(await screen.findByTestId("finish-tour"));

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(
      useOnboardingProgressStore.getState().activeGraduationMilestone,
    ).toBe("repoGuide");
    window.removeEventListener("marblo:open-repo-connect", opened);
  });

  it("shows the beta survey after repo connection completes the repo guide", async () => {
    render(createElement(OnboardingGraduationJourney));
    fireEvent.click(await screen.findByTestId("finish-tour"));
    window.dispatchEvent(new CustomEvent(ONBOARDING_REPO_CONNECTED_EVENT));

    expect(await screen.findByTestId("beta-survey")).toBeTruthy();
    fireEvent.click(screen.getByTestId("beta-survey"));
    expect(
      useOnboardingProgressStore.getState().graduationJourney.betaSurvey
        .completedAt,
    ).toBeGreaterThan(0);
  });
});
