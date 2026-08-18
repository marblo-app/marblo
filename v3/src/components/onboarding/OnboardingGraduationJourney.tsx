import { useCallback, useEffect, useMemo } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useWorkspaceModeStore } from "../../stores/workspaceModeStore";
import {
  ONBOARDING_CALENDAR_USED_EVENT,
  ONBOARDING_REPO_CONNECTED_EVENT,
  ONBOARDING_REPO_GUIDE_LATER_EVENT,
  useOnboardingProgressStore,
  type GraduationJourneyMilestone,
} from "../../stores/onboardingProgressStore";
import { REPO_CONNECT_OPEN_EVENT } from "../collaboration/RepoConnectModal";
import { FirstProjectSurvey } from "./FirstProjectSurvey";
import { MarbloModeTour } from "../workspace/MarbloModeTour";
import type { Project } from "../../types/project";

const COMPLETED_TICKET_TARGET = 5;

function isResolved(record: {
  completedAt: number;
  laterAt: number;
  dismissedAt: number;
}): boolean {
  return record.completedAt > 0 || record.laterAt > 0 || record.dismissedAt > 0;
}

function hasConnectedRepo(project: Project | null): boolean {
  if (!project) return false;
  if (project.folderPathResolution?.kind === "own") return true;
  return Boolean(project.folderPath);
}

export function OnboardingGraduationJourney() {
  const tasks = useTaskStore((s) => s.tasks);
  const currentProject = useProjectStore((s) => s.currentProject);
  const workspaceEnabled = useWorkspaceModeStore((s) => s.enabled);
  const journey = useOnboardingProgressStore((s) => s.graduationJourney);
  const active = useOnboardingProgressStore((s) => s.activeGraduationMilestone);
  const setActive = useOnboardingProgressStore(
    (s) => s.setActiveGraduationMilestone,
  );
  const mark = useOnboardingProgressStore((s) => s.markGraduationMilestone);

  const completedTicketCount = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === "DONE" &&
          (!currentProject || task.projectId === currentProject.id),
      ).length,
    [currentProject, tasks],
  );

  const repoConnected = hasConnectedRepo(currentProject);
  const modeResolved = isResolved(journey.modeTour);
  const repoResolved = isResolved(journey.repoGuide);
  const surveyResolved = isResolved(journey.betaSurvey);

  const startMilestone = useCallback(
    (milestone: GraduationJourneyMilestone) => {
      setActive(milestone);
      mark(milestone, "prompted");
    },
    [mark, setActive],
  );

  useEffect(() => {
    if (active) return;
    if (completedTicketCount < COMPLETED_TICKET_TARGET) return;

    if (!isResolved(journey.modeTour)) {
      startMilestone("modeTour");
      return;
    }

    if (workspaceEnabled && modeResolved && !repoResolved) {
      if (repoConnected) {
        mark("repoGuide", "completed");
      } else if (currentProject) {
        startMilestone("repoGuide");
        window.dispatchEvent(new CustomEvent(REPO_CONNECT_OPEN_EVENT));
      }
      return;
    }

    if ((repoConnected || repoResolved) && !surveyResolved) {
      startMilestone("betaSurvey");
    }
  }, [
    active,
    completedTicketCount,
    currentProject,
    journey.modeTour,
    modeResolved,
    mark,
    repoConnected,
    repoResolved,
    startMilestone,
    surveyResolved,
    workspaceEnabled,
  ]);

  useEffect(() => {
    const finishRepo = () => {
      mark("repoGuide", "completed");
      setActive(null);
    };
    const deferRepo = () => {
      mark("repoGuide", "later");
      setActive(null);
    };
    const finishCalendar = () => {
      const repoGuide =
        useOnboardingProgressStore.getState().graduationJourney.repoGuide;
      if (!isResolved(repoGuide)) {
        mark("repoGuide", "completed");
      }
      setActive(null);
    };
    window.addEventListener(ONBOARDING_REPO_CONNECTED_EVENT, finishRepo);
    window.addEventListener(ONBOARDING_REPO_GUIDE_LATER_EVENT, deferRepo);
    window.addEventListener(ONBOARDING_CALENDAR_USED_EVENT, finishCalendar);
    return () => {
      window.removeEventListener(ONBOARDING_REPO_CONNECTED_EVENT, finishRepo);
      window.removeEventListener(ONBOARDING_REPO_GUIDE_LATER_EVENT, deferRepo);
      window.removeEventListener(
        ONBOARDING_CALENDAR_USED_EVENT,
        finishCalendar,
      );
    };
  }, [mark, setActive]);

  if (active === "modeTour") {
    return (
      <MarbloModeTour
        ready
        enabled
        blocked={false}
        onFinish={() => {
          mark("modeTour", "completed");
          setActive(null);
        }}
        onSkip={(permanent) => {
          mark("modeTour", permanent ? "dismissed" : "later");
          setActive(null);
        }}
      />
    );
  }

  if (active === "betaSurvey") {
    return (
      <FirstProjectSurvey
        forceVisible
        requireShareUrl={false}
        eyebrow="Beta survey"
        title="마블로 졸업 여정은 어땠나요?"
        submitLabel="피드백 보내기"
        onResolved={(disposition) => {
          mark(
            "betaSurvey",
            disposition === "submitted"
              ? "completed"
              : disposition === "dismissed"
                ? "dismissed"
                : "later",
          );
          setActive(null);
        }}
      />
    );
  }

  return null;
}
