import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  ADVANCED_TOUR_ID,
  shouldStartTour,
  type CoachmarkStep,
} from "../../lib/coachmark";
import { selectTour, useCoachmarkStore } from "../../stores/coachmarkStore";
import telemetry from "../../services/telemetryService";
import { CoachmarkOverlay } from "../common/CoachmarkOverlay";

/**
 * 마블로 모드 첫 진입 투어 — 우측 WorkTabs 탭을 순서대로 짚는다.
 *
 * 비기너 첫 실행 투어(`BeginnerTour`)와 **같은 골격**: 그리기는
 * `CoachmarkOverlay`, 재노출 규칙은 `lib/coachmark.shouldStartTour`, 영속은
 * `coachmarkStore`. 이 파일이 드는 건 **무엇을 짚을지와 언제 띄울지** 뿐이다.
 *
 * ★앵커는 WorkTabs 가 붙이는 `data-coach="workspace-tab-<id>"` 로만 잡는다.
 * 탭 라벨/DOM 구조로 잡으면 탭 바 리팩터가 조용히 투어를 깨뜨린다.
 */

/** WorkTabs 가 붙이는 앵커 이름 — 탭 바와 이 파일 사이의 유일한 계약. */
export const ADVANCED_COACH_ANCHORS = {
  board: '[data-coach="workspace-tab-board"]',
  code: '[data-coach="workspace-tab-code"]',
  agents: '[data-coach="workspace-tab-agents"]',
  harness: '[data-coach="workspace-tab-harness"]',
  usage: '[data-coach="workspace-tab-usage"]',
  settings: '[data-coach="workspace-tab-settings"]',
} as const;

export function MarbloModeTour({
  /** 탭 바가 실제로 렌더된 상태인가(폴더 게이트를 지났나). */
  ready,
  /** 다른 오버레이가 떠 있는가 — 겹쳐 띄우지 않는다. */
  blocked = false,
  /** 마일스톤 호스트가 조건을 만족시켰는가. */
  enabled = true,
  onFinish,
  onSkip,
}: {
  ready: boolean;
  blocked?: boolean;
  enabled?: boolean;
  onFinish?: () => void;
  onSkip?: (permanent: boolean) => void;
}) {
  const { t } = useTranslation();

  const record = useCoachmarkStore((s) => selectTour(s, ADVANCED_TOUR_ID));
  const markStarted = useCoachmarkStore((s) => s.markStarted);
  const markCompleted = useCoachmarkStore((s) => s.markCompleted);
  const markDismissed = useCoachmarkStore((s) => s.markDismissed);

  const [running, setRunning] = useState(false);
  const startedAt = useRef(0);
  /**
   * 이번 세션에서 이미 한 번 띄웠는가 — 건너뛰기가 자기 자신을 되살리지 않게
   * (BeginnerTour 와 같은 경계).
   */
  const shownThisSession = useRef(false);

  const steps = useMemo<CoachmarkStep[]>(
    () => [
      {
        id: "board",
        anchor: ADVANCED_COACH_ANCHORS.board,
        title: t("workspace.tour.board.title"),
        body: t("workspace.tour.board.body"),
        placement: "bottom",
      },
      {
        id: "code",
        anchor: ADVANCED_COACH_ANCHORS.code,
        title: t("workspace.tour.code.title"),
        body: t("workspace.tour.code.body"),
        placement: "bottom",
      },
      {
        id: "agents",
        anchor: ADVANCED_COACH_ANCHORS.agents,
        title: t("workspace.tour.agents.title"),
        body: t("workspace.tour.agents.body"),
        placement: "bottom",
      },
      {
        id: "harness",
        anchor: ADVANCED_COACH_ANCHORS.harness,
        title: t("workspace.tour.harness.title"),
        body: t("workspace.tour.harness.body"),
        placement: "bottom",
      },
      {
        id: "usage",
        anchor: ADVANCED_COACH_ANCHORS.usage,
        title: t("workspace.tour.usage.title"),
        body: t("workspace.tour.usage.body"),
        placement: "bottom",
      },
      {
        id: "settings",
        anchor: ADVANCED_COACH_ANCHORS.settings,
        title: t("workspace.tour.settings.title"),
        body: t("workspace.tour.settings.body"),
        placement: "bottom",
      },
    ],
    [t],
  );

  useEffect(() => {
    if (!enabled) return;
    if (running || shownThisSession.current) return;
    if (
      !shouldStartTour(record, {
        anchorsReady: ready,
        blockedByOtherOverlay: blocked,
      })
    )
      return;
    const raf = requestAnimationFrame(() => {
      shownThisSession.current = true;
      setRunning(true);
      startedAt.current = Date.now();
      markStarted(ADVANCED_TOUR_ID);
      telemetry.coachmarkStarted(ADVANCED_TOUR_ID, steps.length);
    });
    return () => cancelAnimationFrame(raf);
  }, [enabled, running, record, ready, blocked, markStarted, steps.length]);

  const finish = useCallback(
    (total: number) => {
      setRunning(false);
      markCompleted(ADVANCED_TOUR_ID);
      telemetry.coachmarkCompleted(
        ADVANCED_TOUR_ID,
        total,
        startedAt.current ? Date.now() - startedAt.current : 0,
      );
      onFinish?.();
    },
    [markCompleted, onFinish],
  );

  const skip = useCallback(
    (permanent: boolean, stepIndex: number, total: number) => {
      setRunning(false);
      if (permanent) markDismissed(ADVANCED_TOUR_ID);
      telemetry.coachmarkSkipped(ADVANCED_TOUR_ID, stepIndex, total, permanent);
      onSkip?.(permanent);
    },
    [markDismissed, onSkip],
  );

  if (!running) return null;

  return (
    <CoachmarkOverlay
      testId="advanced-tour"
      steps={steps}
      onFinish={finish}
      onSkip={skip}
      labels={{
        next: t("workspace.tour.next"),
        back: t("workspace.tour.back"),
        done: t("workspace.tour.done"),
        skip: t("workspace.tour.skip"),
        never: t("workspace.tour.never"),
        progress: (current, total) =>
          t("workspace.tour.progress", { current, total }),
      }}
    />
  );
}
