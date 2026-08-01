/**
 * Mission Replay — 완료 미션 카드 리스트 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1 / §2.1.
 *
 * 목록에 뜨는 것은 `status === "completed"` 인 미션뿐이다 — 판정은
 * `lib/replay/missionReplay.isReplayableMission`, 정렬·선별은 구독 계층
 * (`selectReplayableMissions`)이 한다. 여기서 다시 거르지 않는다.
 *
 * ★`ready + 빈 배열`(기록 없음)과 `denied`(권한 없음)를 다른 화면으로 그린다.
 * 둘을 같은 "미션이 없습니다"로 접으면 권한 문제가 기능 고장으로 읽힌다
 * (`services/missionReplayService.ts` ReplayMissionsState 주석).
 */

import { useTranslation, type TFunction } from "../../../lib/i18n";
import { useReplayableMissions } from "../../../hooks/useMissionReplay";
import type { ReplayMissionsState } from "../../../services/missionReplayService";
import type { Mission } from "../../../types/mission";
import { formatReplayDuration, formatReplayTimestamp } from "./ReplayHeadline";

function missionDurationMs(mission: Mission): number {
  const start = mission.launchedAt?.getTime?.();
  const end = (mission.completedAt ?? mission.lastActivityAt)?.getTime?.();
  if (typeof start !== "number" || typeof end !== "number") return 0;
  return Math.max(0, end - start);
}

function MissionCard({
  mission,
  onSelect,
  t,
}: {
  mission: Mission;
  onSelect: (missionId: string) => void;
  t: TFunction;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mission.id)}
      className="w-full rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2 text-left transition hover:border-gray-700 hover:bg-gray-800/70"
      title={mission.id}
    >
      <div className="flex items-center gap-3">
        {/* goal 은 사용자가 친 값 — 번역하지 않는다. */}
        <span className="min-w-0 flex-1 truncate text-sm text-gray-100">
          {mission.goal || (
            <span className="text-gray-500">
              {t("workHistory.replay.list.untitled")}
            </span>
          )}
        </span>
        <span className="hidden flex-shrink-0 font-mono text-[10px] text-gray-500 sm:inline">
          {mission.templateId}
        </span>
        <span className="flex-shrink-0 text-[11px] text-gray-400">
          {t("workHistory.replay.list.tasks", {
            count: mission.taskIds?.length ?? 0,
          })}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-gray-500">
        <span>{formatReplayTimestamp(mission.completedAt)}</span>
        <span>
          {t("workHistory.replay.headline.duration")}{" "}
          {formatReplayDuration(missionDurationMs(mission), t)}
        </span>
      </div>
    </button>
  );
}

export interface MissionReplayListViewProps {
  state: ReplayMissionsState;
  onSelect: (missionId: string) => void;
  onReload: () => void;
  t: TFunction;
}

/** 상태 → 화면. 구독을 모른다(테스트가 이 함수만 호출한다). */
export function MissionReplayListView({
  state,
  onSelect,
  onReload,
  t,
}: MissionReplayListViewProps) {
  if (state.status === "loading") {
    return (
      <p className="px-1 py-6 text-center text-xs text-gray-500">
        {t("workHistory.replay.list.loading")}
      </p>
    );
  }

  if (state.status === "denied" || state.status === "error") {
    const message =
      state.status === "denied"
        ? t("workHistory.replay.list.denied")
        : t("workHistory.replay.list.error", { message: state.message });
    return (
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
        <p className="text-sm text-gray-300">{message}</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-3 rounded border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-gray-800"
        >
          {t("workHistory.replay.list.retry")}
        </button>
      </div>
    );
  }

  if (state.missions.length === 0) {
    // 읽기는 성공했는데 완료 미션이 0건 — denied 와 다른 사실이라 문구도 다르다.
    return (
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
        <p className="text-sm text-gray-300">
          {t("workHistory.replay.list.empty.title")}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {t("workHistory.replay.list.empty.hint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500">
        {t("workHistory.replay.list.count", { count: state.missions.length })}
      </p>
      <div className="space-y-1.5">
        {state.missions.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            onSelect={onSelect}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

export interface MissionReplayListProps {
  projectId: string | null | undefined;
  onSelect: (missionId: string) => void;
}

export function MissionReplayList({
  projectId,
  onSelect,
}: MissionReplayListProps) {
  const { t } = useTranslation();
  const { state, reload } = useReplayableMissions(projectId);
  return (
    <MissionReplayListView
      state={state}
      onSelect={onSelect}
      onReload={reload}
      t={t}
    />
  );
}
