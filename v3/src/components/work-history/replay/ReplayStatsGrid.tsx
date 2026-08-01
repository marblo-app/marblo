/**
 * Mission Replay — 통계 타일 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1 / §2.2.
 *
 * `ReplayStats` 를 그대로 그린다. **여기서 다시 세지 않는다** — 같은 사실을 두 곳에서
 * 계산하면 화면과 (Phase 3~4의) 익스포트가 서로 다른 숫자를 말하게 된다
 * (`hooks/useMissionReplay.ts` 헤더의 같은 규칙).
 *
 * ★한 칸만 예외다: "사람 개입"·"머지"는 `ReplayStats` 에 칸이 없어 **이미 조립된
 * 비트**에서 센다(신규 계측이 아니라 파생값). 비트는 집계 코어가 만든 결정적
 * 배열이라 재계산이 아니라 **재집계 없는 조회**다.
 */

import type { TFunction } from "../../../lib/i18n";
import type { MissionReplay, ReplayBeat } from "../../../types/missionReplay";

/** 사람 레인 비트 수 = 사람이 직접 손댄 횟수(설계 §1.1 "개입 횟수"). */
export function countHumanInterventions(beats: readonly ReplayBeat[]): number {
  return beats.filter((beat) => beat.lane === "human").length;
}

/** 머지 비트 수 = 실제로 코드가 들어간 횟수. */
export function countMerges(beats: readonly ReplayBeat[]): number {
  return beats.filter((beat) => beat.source === "merge_history").length;
}

function Tile({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string | number;
  tone: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="flex flex-col items-center rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2"
    >
      <span className={`font-mono text-lg font-semibold ${tone}`}>{value}</span>
      <span className="mt-0.5 text-center text-[11px] text-gray-400">
        {label}
      </span>
    </div>
  );
}

/** 못 읽은 소스에서 나온 수치는 0 이 아니라 "—" 다. */
const UNREADABLE = "—";

export function ReplayStatsGrid({
  replay,
  t,
}: {
  replay: MissionReplay;
  t: TFunction;
}) {
  const { stats } = replay;
  // ★권한이 없어 못 읽은 소스의 수치를 0 으로 그리면 "그런 일이 없었다"는 거짓말이
  // 된다(설계 C2/R4). `projectAuditLog` 는 owner/admin 전용이라 일반 멤버 화면에서
  // 사람 레인이 통째로 비는데, 그 화면이 "사람 개입 0회"라고 말하면 안 된다.
  const mergeDenied = replay.provenance.sources.merge_history === "denied";
  const humanDenied = replay.provenance.sources.projectAuditLog === "denied";
  const interventions = humanDenied
    ? UNREADABLE
    : countHumanInterventions(replay.beats);
  const merges = mergeDenied ? UNREADABLE : countMerges(replay.beats);
  const deniedHint = t("workHistory.replay.stats.deniedHint");
  // heuristic 축의 분모가 전체와 다르면 그 사실을 밝힌다 — 안 밝히면 "12건 통과"가
  // 12/12 로 읽힌다(`types/missionReplay.ts` reportsScanned 주석, ShareCard 와 동일 규칙).
  const windowed = stats.reportsScanned < stats.tasksDone;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Tile
          label={t("workHistory.replay.stats.agents")}
          value={stats.agents}
          tone="text-blue-300"
        />
        <Tile
          label={t("workHistory.replay.stats.tasks")}
          value={`${stats.tasksDone}/${stats.tasks}`}
          tone="text-gray-100"
        />
        <Tile
          label={t("workHistory.replay.stats.merges")}
          value={merges}
          tone="text-teal-300"
          title={mergeDenied ? deniedHint : undefined}
        />
        <Tile
          label={t("workHistory.replay.stats.prs")}
          value={stats.prs}
          tone="text-violet-300"
        />
        <Tile
          label={t("workHistory.replay.stats.files")}
          value={mergeDenied ? UNREADABLE : stats.filesChanged}
          tone="text-emerald-300"
          title={mergeDenied ? deniedHint : undefined}
        />
        <Tile
          label={t("workHistory.replay.stats.lines")}
          value={
            mergeDenied
              ? UNREADABLE
              : `+${stats.linesAdded}/-${stats.linesDeleted}`
          }
          tone="text-emerald-300"
          title={mergeDenied ? deniedHint : undefined}
        />
        <Tile
          label={t("workHistory.replay.stats.tests")}
          value={stats.testsPassed}
          tone="text-amber-300"
        />
        <Tile
          label={t("workHistory.replay.stats.risk")}
          value={stats.riskFlags}
          tone="text-red-300"
        />
        <Tile
          label={t("workHistory.replay.stats.retries")}
          value={stats.retries}
          tone="text-orange-300"
        />
        <Tile
          label={t("workHistory.replay.stats.interventions")}
          value={interventions}
          tone="text-sky-300"
          title={
            humanDenied
              ? deniedHint
              : t("workHistory.replay.stats.interventionsHint")
          }
        />
      </div>

      <p className="mt-1.5 text-[11px] text-gray-500">
        {windowed
          ? t("workHistory.replay.stats.reportsNoteWindowed", {
              scanned: stats.reportsScanned,
              total: stats.tasksDone,
            })
          : t("workHistory.replay.stats.reportsNote")}
      </p>
    </div>
  );
}
