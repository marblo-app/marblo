/**
 * Mission Replay — 타임라인 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1.
 *
 * 미션의 서사(요청 → 분해 → 스폰 → 작업 → 리뷰/테스트 → 재작업 → PR → 머지)는
 * **비트의 시간 순서 그 자체**다. 여기서 단계를 다시 추론하지 않는다 — 집계 코어가
 * 이미 결정적으로 정렬한 배열(`buildReplayBeats`: ts → id 안정 정렬)을 그대로 그린다.
 * 뷰가 자체 분류를 얹으면 같은 미션이 화면과 익스포트에서 다른 이야기를 하게 된다.
 *
 * ★빈 레인은 그리지 않는다(설계 R4). 단, **권한이 없어 빈 레인**은 숨기는 대신
 * 명시적으로 "권한 없음"이라고 말한다 — 조용한 누락이 이 기능에서 가장 나쁜 실패다.
 */

import { useMemo, useState } from "react";
import type { TFunction } from "../../../lib/i18n";
import type {
  MissionReplay,
  ReplayBeat,
  ReplayLane,
} from "../../../types/missionReplay";
import { ReplayBeatRow, laneLabel } from "./ReplayBeatRow";

/** 레인 표기 순서 — 사람 → 오케 → 에이전트 → 시스템(위에서 아래로 지휘 흐름). */
const LANE_ORDER: readonly ReplayLane[] = [
  "human",
  "orchestrator",
  "agent",
  "system",
];

/** 한 번에 그리는 비트 수. 미션 하나가 수천 비트일 수 있어 화면을 잘라 둔다. */
export const TIMELINE_PAGE = 100;

interface TicketGroup {
  key: string;
  title: string;
  beats: ReplayBeat[];
}

export function countBeatsByLane(
  beats: readonly ReplayBeat[],
): Record<ReplayLane, number> {
  const counts: Record<ReplayLane, number> = {
    human: 0,
    orchestrator: 0,
    agent: 0,
    system: 0,
  };
  for (const beat of beats) counts[beat.lane] += 1;
  return counts;
}

export function ReplayTimeline({
  replay,
  t,
}: {
  replay: MissionReplay;
  t: TFunction;
}) {
  const [lane, setLane] = useState<ReplayLane | null>(null);
  const [limit, setLimit] = useState(TIMELINE_PAGE);

  const counts = useMemo(() => countBeatsByLane(replay.beats), [replay.beats]);
  const filtered = useMemo(
    () =>
      lane ? replay.beats.filter((beat) => beat.lane === lane) : replay.beats,
    [replay.beats, lane],
  );
  const shown = filtered.slice(0, limit);
  const grouped = useMemo(() => groupBeats(shown, t), [shown, t]);

  // 사람 레인은 owner/admin 전용 소스에서만 나온다(설계 C2). 못 읽은 것을
  // "아무 일도 없었다"로 그리지 않기 위해 레인별 denied 를 따로 본다.
  const deniedLanes: { lane: ReplayLane; visible: boolean }[] = [
    {
      lane: "human",
      visible: replay.provenance.sources.projectAuditLog === "denied",
    },
    {
      lane: "system",
      visible: replay.provenance.sources.merge_history === "denied",
    },
  ];

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-300">
          {t("workHistory.replay.timeline.title")}
        </h3>
        <span className="text-[11px] text-gray-500">
          {t("workHistory.replay.timeline.showing", {
            shown: shown.length,
            total: filtered.length,
          })}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => {
            setLane(null);
            setLimit(TIMELINE_PAGE);
          }}
          className={`rounded border px-2 py-0.5 text-[11px] transition ${
            lane === null
              ? "border-gray-500 bg-gray-800 text-gray-100"
              : "border-gray-700 text-gray-400 hover:bg-gray-800"
          }`}
        >
          {t("workHistory.replay.lane.all")} ({replay.beats.length})
        </button>
        {/* 비트가 0인 레인은 칩도 만들지 않는다 — 누를 수 없는 빈 필터는 UI 소음이다. */}
        {LANE_ORDER.filter((candidate) => counts[candidate] > 0).map(
          (candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => {
                setLane(candidate);
                setLimit(TIMELINE_PAGE);
              }}
              className={`rounded border px-2 py-0.5 text-[11px] transition ${
                lane === candidate
                  ? "border-gray-500 bg-gray-800 text-gray-100"
                  : "border-gray-700 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {laneLabel(candidate, t)} ({counts[candidate]})
            </button>
          ),
        )}
      </div>

      {deniedLanes
        .filter((entry) => entry.visible)
        .map((entry) => (
          <p key={entry.lane} className="mb-2 text-[11px] text-red-300">
            {t("workHistory.replay.timeline.laneDenied", {
              lane: laneLabel(entry.lane, t),
            })}
          </p>
        ))}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 px-3 py-6 text-center text-xs text-gray-500">
          {t("workHistory.replay.timeline.empty")}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {grouped.map((group) => (
              <section
                key={group.key}
                className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/30"
              >
                <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/70 px-3 py-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]"
                  />
                  <h4 className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-100">
                    {group.title}
                  </h4>
                  <span className="font-mono text-[10px] text-gray-500">
                    {t("workHistory.replay.timeline.ticketBeats", {
                      count: group.beats.length,
                    })}
                  </span>
                </div>
                <div className="divide-y divide-gray-800/80">
                  {group.beats.map((beat) => (
                    <div key={beat.id} className="px-3 py-2">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded-md border border-gray-700 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300">
                          {laneLabel(beat.lane, t)}
                        </span>
                        {beat.taskId && (
                          <span className="truncate font-mono text-[10px] text-gray-500">
                            {beat.taskId}
                          </span>
                        )}
                      </div>
                      <ReplayBeatRow beat={beat} t={t} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {shown.length < filtered.length && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + TIMELINE_PAGE)}
              className="mt-2 w-full rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition hover:bg-gray-800"
            >
              {t("workHistory.replay.timeline.more", {
                count: filtered.length - shown.length,
              })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function groupBeats(beats: readonly ReplayBeat[], t: TFunction): TicketGroup[] {
  const groups: TicketGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const beat of beats) {
    const key = beat.taskId ?? `mission-${beat.lane}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      groups[existing].beats.push(beat);
      continue;
    }
    const title = beat.taskId
      ? `${t("workHistory.replay.timeline.ticket")} ${beat.taskId}`
      : t("workHistory.replay.timeline.missionGroup");
    indexByKey.set(key, groups.length);
    groups.push({ key, title, beats: [beat] });
  }
  return groups;
}
