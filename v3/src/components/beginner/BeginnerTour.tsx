import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  BEGINNER_TOUR_ID,
  shouldStartTour,
  type CoachmarkStep,
} from "../../lib/coachmark";
import { selectTour, useCoachmarkStore } from "../../stores/coachmarkStore";
import telemetry from "../../services/telemetryService";
import { CoachmarkOverlay } from "../common/CoachmarkOverlay";

/**
 * 비기너 첫 실행 투어 — 오케 대화창·진행 보드·모드 전환을 순서대로
 * 한 번씩 짚는다(티켓 m7mpxqSw).
 *
 * 이 파일이 드는 건 **무엇을 짚을지와 언제 띄울지** 뿐이다: 그리기는
 * `CoachmarkOverlay`(재사용 컴포넌트), 다시 띄울지 말지는 `lib/coachmark` 의
 * 순수 규칙, 봤다는 사실은 `coachmarkStore`(localStorage) 가 든다.
 *
 * ★앵커는 셸이 붙여 준 `data-coach` 속성으로만 잡는다. Tailwind 클래스나 DOM
 * 구조로 잡으면 셸을 손대는 다음 티켓이 조용히 투어를 깨뜨린다.
 */

/** 셸이 붙이는 앵커 이름 — 셸과 이 파일 사이의 유일한 계약. */
export const COACH_ANCHORS = {
  live: '[data-coach="beginner-live"]',
  chat: '[data-coach="beginner-chat"]',
  advanced: '[data-coach="beginner-advanced"]',
} as const;

export function BeginnerTour({
  /** 스포트라이트 대상들이 실제로 렌더된 상태인가(연결·폴더 게이트를 지났나). */
  ready,
  /** 다른 오버레이(승격 모달·데모)가 떠 있는가 — 겹쳐 띄우지 않는다. */
  blocked = false,
}: {
  ready: boolean;
  blocked?: boolean;
}) {
  const { t } = useTranslation();

  const record = useCoachmarkStore((s) => selectTour(s, BEGINNER_TOUR_ID));
  const markStarted = useCoachmarkStore((s) => s.markStarted);
  const markCompleted = useCoachmarkStore((s) => s.markCompleted);
  const markDismissed = useCoachmarkStore((s) => s.markDismissed);

  const [running, setRunning] = useState(false);
  const startedAt = useRef(0);
  /**
   * ★이번 세션에서 이미 한 번 띄웠는가.
   *
   * 영속 기록만으로 판정하면 '건너뛰기' 가 자기 자신을 되살린다: 건너뛰기는
   * completedAt/dismissedAt 를 쓰지 않으므로(다음 실행에 다시 권하려고)
   * `shouldStartTour` 가 곧바로 다시 true 를 돌려주고, 닫자마자 투어가 다시 뜬다.
   * 재노출은 **다음 실행** 몫이다 — 그 경계를 이 ref 가 긋는다.
   */
  const shownThisSession = useRef(false);

  const steps = useMemo<CoachmarkStep[]>(
    () => [
      {
        id: "chat",
        anchor: COACH_ANCHORS.chat,
        title: t("beginner.tour.chat.title"),
        body: t("beginner.tour.chat.body"),
        placement: "top",
      },
      {
        id: "live",
        anchor: COACH_ANCHORS.live,
        title: t("beginner.tour.live.title"),
        body: t("beginner.tour.live.body"),
        placement: "bottom",
      },
      {
        id: "advanced",
        anchor: COACH_ANCHORS.advanced,
        title: t("beginner.tour.advanced.title"),
        body: t("beginner.tour.advanced.body"),
        placement: "bottom",
      },
    ],
    [t],
  );

  // 시작 판정. 앵커가 붙은 프레임 다음에 띄운다 — 같은 프레임에 재면 아직 레이아웃이
  // 안 잡혀 0×0 을 밝히게 된다.
  useEffect(() => {
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
      markStarted(BEGINNER_TOUR_ID);
      telemetry.coachmarkStarted(BEGINNER_TOUR_ID, steps.length);
    });
    return () => cancelAnimationFrame(raf);
  }, [running, record, ready, blocked, markStarted, steps.length]);

  const finish = useCallback(
    (total: number) => {
      setRunning(false);
      markCompleted(BEGINNER_TOUR_ID);
      telemetry.coachmarkCompleted(
        BEGINNER_TOUR_ID,
        total,
        startedAt.current ? Date.now() - startedAt.current : 0,
      );
    },
    [markCompleted],
  );

  const skip = useCallback(
    (permanent: boolean, stepIndex: number, total: number) => {
      setRunning(false);
      // 그냥 건너뛰기는 기록을 남기지 않는다 — startedCount 만으로 최대 3회까지
      // 다시 권하는 규칙(lib/coachmark)이 알아서 조용해진다.
      if (permanent) markDismissed(BEGINNER_TOUR_ID);
      telemetry.coachmarkSkipped(BEGINNER_TOUR_ID, stepIndex, total, permanent);
    },
    [markDismissed],
  );

  if (!running) return null;

  return (
    <CoachmarkOverlay
      testId="beginner-tour"
      steps={steps}
      onFinish={finish}
      onSkip={skip}
      labels={{
        next: t("beginner.tour.next"),
        back: t("beginner.tour.back"),
        done: t("beginner.tour.done"),
        skip: t("beginner.tour.skip"),
        never: t("beginner.tour.never"),
        progress: (current, total) =>
          t("beginner.tour.progress", { current, total }),
      }}
    />
  );
}
