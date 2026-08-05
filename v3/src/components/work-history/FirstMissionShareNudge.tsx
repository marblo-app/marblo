/**
 * 첫 완료 미션 → Replay/공유 브릿지 널지.
 *
 * 신규 유저의 첫 완료 미션이 나는 순간, "이거 Replay로 보고 공유해보세요" 를
 * 은근히(강요 아니게) 띄운다 — 활성화 aha 를 바이럴 진입으로 잇는다. 새 Replay
 * 뷰/ReplayShareFlow(같은 세션 산출물)를 재사용하고, 새 공유 표면을 만들지 않는다.
 *
 * 1회성이다: 프로젝트당 한 번 보이면(또는 닫으면) 다시 뜨지 않는다
 * (`stores/firstMissionShareNudge.ts` — chatReadWatermark 와 같은 localStorage 패턴).
 *
 * ★이미 본 프로젝트에서는 미션 구독 자체를 열지 않는다 — `WorkHistoryTab` 이 이미
 * 지키는 방침("Replay 를 실제로 열었을 때만 미션 리스너를 켠다")을 신규 유저에게만
 * 좁혀서 지킨다. 널지를 본 뒤에는 이 컴포넌트가 다시 리스너를 켤 일이 없다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useReplayableMissions } from "../../hooks/useMissionReplay";
import {
  hasSeenFirstMissionShareNudge,
  markFirstMissionShareNudgeSeen,
  type FirstMissionShareNudgeStorage,
  type FirstShareNudgeSurface,
} from "../../stores/firstMissionShareNudge";
import { FirstMissionShareNudgeView } from "./FirstShareNudgeView";

export { FirstMissionShareNudgeView } from "./FirstShareNudgeView";

function safeStorage(): FirstMissionShareNudgeStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export interface FirstMissionShareNudgeProps {
  projectId: string;
  /** 사용자가 CTA 를 누르면 Replay 뷰에서 이 미션을 열도록 호출부에 알린다. */
  onOpenReplay: (missionId: string) => void;
}

export function FirstMissionShareNudge({
  projectId,
  onOpenReplay,
}: FirstMissionShareNudgeProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() =>
    hasSeenFirstMissionShareNudge(safeStorage(), projectId),
  );

  const { missions } = useReplayableMissions(dismissed ? null : projectId);
  const mission = !dismissed && missions.length === 1 ? missions[0] : null;

  // 널지가 화면에 뜬 순간 "봤다" 로 기록한다 — 그래야 재시작해도 다시 안 뜬다.
  // 명시적으로 닫지 않아도 한 번 보였으면 그걸로 1회성 조건은 끝난다.
  useEffect(() => {
    if (!mission) return;
    markFirstMissionShareNudgeSeen(safeStorage(), projectId);
  }, [mission, projectId]);

  const dismiss = () => {
    markFirstMissionShareNudgeSeen(safeStorage(), projectId);
    setDismissed(true);
  };

  return (
    <FirstMissionShareNudgeView
      mission={mission}
      onOpenReplay={(missionId) => {
        onOpenReplay(missionId);
        dismiss();
      }}
      onDismiss={dismiss}
      t={t}
    />
  );
}

export interface FirstShareNudgeProps {
  projectId: string;
  surface: Exclude<FirstShareNudgeSurface, "mission">;
  enabled?: boolean;
}

export function FirstShareNudge({
  projectId,
  surface,
  enabled = true,
}: FirstShareNudgeProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() =>
    hasSeenFirstMissionShareNudge(safeStorage(), projectId, surface),
  );

  if (!enabled || dismissed) return null;

  const dismiss = () => {
    markFirstMissionShareNudgeSeen(safeStorage(), projectId, surface);
    setDismissed(true);
  };

  return (
    <FirstMissionShareNudgeView
      mission={null}
      surface={surface}
      onDismiss={dismiss}
      t={t}
    />
  );
}
