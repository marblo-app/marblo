/**
 * Mission Replay — 비트 1행 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1 / §5.2.
 *
 * ── 이 행이 절대 그리지 않는 것 ─────────────────────────────────────────────
 * 코드 원문·터미널 출력·diff·시크릿. 그릴 방법이 없다 — 집계 코어가 그런 필드를
 * 애초에 비트에 담지 않기 때문이다(`lib/replay/beats.ts`: `audit_logs.params`
 * 제외, `merge_history.repoRoot/branch/headSha` 제외). 뷰가 "안 그리기로 결심"
 * 하는 구조가 아니라 **가진 적이 없는** 구조다.
 *
 * ── 민감도 뱃지가 여기 있는 이유 ────────────────────────────────────────────
 * Phase 1 인앱 화면은 로컬이라 `private` 비트도 보인다(`beats.ts` contextLogDetail
 * 주석). 그래서 뱃지는 "지금 가려졌다"가 아니라 **"이건 나중에도 밖으로 못 나간다"**
 * 를 미리 보여주는 표시다 — Phase 2 의 공개 등급 UI 가 붙었을 때 사용자가 무엇이
 * 빠질지 이 화면에서 이미 알고 있어야 한다.
 */

import { useState } from "react";
import type { TFunction } from "../../../lib/i18n";
import type {
  ReplayBeat,
  ReplayLane,
  ReplaySensitivity,
} from "../../../types/missionReplay";

const LANE_TONE: Record<ReplayLane, string> = {
  human: "border-sky-500/40 text-sky-300",
  orchestrator: "border-violet-500/40 text-violet-300",
  agent: "border-emerald-500/40 text-emerald-300",
  system: "border-gray-600 text-gray-400",
};

const SENSITIVITY_TONE: Record<ReplaySensitivity, string> = {
  private: "border-red-500/40 text-red-300",
  process: "border-gray-600 text-gray-400",
  summary: "border-amber-500/40 text-amber-300",
  detail: "border-orange-500/40 text-orange-300",
};

export function laneLabel(lane: ReplayLane, t: TFunction): string {
  switch (lane) {
    case "human":
      return t("workHistory.replay.lane.human");
    case "orchestrator":
      return t("workHistory.replay.lane.orchestrator");
    case "agent":
      return t("workHistory.replay.lane.agent");
    case "system":
      return t("workHistory.replay.lane.system");
    default: {
      // 레인 유니온이 늘면 컴파일 에러로 잡는다.
      const exhaustive: never = lane;
      return exhaustive;
    }
  }
}

export function sensitivityLabel(
  sensitivity: ReplaySensitivity,
  t: TFunction,
): string {
  switch (sensitivity) {
    case "private":
      return t("workHistory.replay.sensitivity.private");
    case "process":
      return t("workHistory.replay.sensitivity.process");
    case "summary":
      return t("workHistory.replay.sensitivity.summary");
    case "detail":
      return t("workHistory.replay.sensitivity.detail");
    default: {
      const exhaustive: never = sensitivity;
      return exhaustive;
    }
  }
}

function beatTime(ts: Date): string {
  return ts instanceof Date ? ts.toLocaleTimeString("ko-KR") : "—";
}

export function ReplayBeatRow({ beat, t }: { beat: ReplayBeat; t: TFunction }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!beat.detail;

  return (
    <li className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-1.5">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        // detail 이 없는 비트는 펼칠 게 없으니 버튼을 죽여 둔다(빈 패널 방지).
        disabled={!hasDetail}
        className="flex w-full items-center gap-2 text-left disabled:cursor-default"
        title={beat.taskId ?? undefined}
      >
        <span aria-hidden className="w-3 flex-shrink-0 text-gray-600">
          {hasDetail ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="w-20 flex-shrink-0 font-mono text-[10px] text-gray-500">
          {beatTime(beat.ts)}
        </span>
        <span
          className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${LANE_TONE[beat.lane]}`}
        >
          {laneLabel(beat.lane, t)}
        </span>
        {/* kind 는 이벤트 타입 코드/툴 이름이라 번역하지 않는다(locales/README). */}
        <span className="hidden flex-shrink-0 font-mono text-[10px] text-gray-500 sm:inline">
          {beat.kind}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-gray-200">
          {beat.title}
        </span>
        {beat.agentRef && (
          <span className="hidden flex-shrink-0 truncate font-mono text-[10px] text-gray-400 md:inline">
            {beat.agentRef}
          </span>
        )}
        {beat.actorRef && (
          <span className="hidden flex-shrink-0 font-mono text-[10px] text-gray-400 md:inline">
            {beat.actorRef}
          </span>
        )}
        <span
          className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${SENSITIVITY_TONE[beat.sensitivity]}`}
          title={
            beat.sensitivity === "private"
              ? t("workHistory.replay.sensitivity.privateHint")
              : t("workHistory.replay.sensitivity.hint")
          }
        >
          {sensitivityLabel(beat.sensitivity, t)}
        </span>
      </button>

      {expanded && hasDetail && (
        // 본문은 데이터(에이전트/오케 산출물)라 번역 대상이 아니다. 줄바꿈만 살린다.
        <p className="mt-1.5 whitespace-pre-wrap break-words border-t border-gray-800 pt-1.5 text-[11px] text-gray-300">
          {beat.detail}
        </p>
      )}
    </li>
  );
}
