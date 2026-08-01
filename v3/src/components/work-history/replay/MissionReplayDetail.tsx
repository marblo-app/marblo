/**
 * Mission Replay — 단일 Replay 상세 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1 / §3.1.
 *
 * 구성: 헤드라인(요약·프로버넌스) → 통계 타일 → 타임라인 → 최종 결과 → 캐스트.
 *
 * ── 이 파일이 두 개로 나뉜 이유 ─────────────────────────────────────────────
 * `MissionReplayDetail` 은 훅(`useMissionReplay`)을 부르는 **컨테이너**이고,
 * `MissionReplayDetailView` 는 상태를 받아 그리기만 하는 **순수 뷰**다. 구독
 * 상태(loading/denied/error/ready)의 렌더를 단위테스트로 고정하려면 Firestore
 * 없이 그릴 수 있어야 한다 — 서비스 계층이 `MissionReplayDeps` 주입을 지원하는
 * 것과 같은 이유다(`services/missionReplayService.ts` 헤더).
 *
 * ★공유·공개·익스포트·remix 버튼은 이 화면에 하나도 없다. Phase 2(레닭션)를
 * 통과하지 않은 바이트는 앱 밖으로 나가지 않는다는 설계 §4 불변식을, "버튼을
 * 만들지 않는 것"으로 지킨다. PR 링크는 이미 공개된 GitHub URL 을 여는 것이라
 * 새 공개 경로가 아니다(완료이력 탭이 이미 같은 링크를 연다).
 */

import { useTranslation, type TFunction } from "../../../lib/i18n";
import { useMissionReplay } from "../../../hooks/useMissionReplay";
import type {
  MissionReplayOptions,
  MissionReplayState,
} from "../../../services/missionReplayService";
import type { MissionReplay } from "../../../types/missionReplay";
import { ReplayCast } from "./ReplayCast";
import { ReplayHeadline } from "./ReplayHeadline";
import { ReplayStatsGrid, countHumanInterventions } from "./ReplayStatsGrid";
import { ReplayTimeline } from "./ReplayTimeline";

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 px-4 py-10 text-center text-sm text-gray-400">
      {children}
    </div>
  );
}

function BackButton({ onBack, t }: { onBack: () => void; t: TFunction }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition hover:bg-gray-800"
    >
      {t("workHistory.replay.back")}
    </button>
  );
}

/**
 * 최종 결과 — "이 미션이 무엇을 남겼나".
 *
 * 통계 타일과 겹치는 수치가 있지만 역할이 다르다: 타일은 규모, 여기는 **산출물**
 * (완료 티켓·변경 파일·테스트·PR·사람 개입)이다. PR 은 링크로 남긴다.
 */
function ReplayOutcome({ replay, t }: { replay: MissionReplay; t: TFunction }) {
  const { stats } = replay;
  const humanDenied = replay.provenance.sources.projectAuditLog === "denied";
  const mergeDenied = replay.provenance.sources.merge_history === "denied";

  const lines: { label: string; value: string }[] = [
    {
      label: t("workHistory.replay.outcome.tasksDone"),
      value: `${stats.tasksDone} / ${stats.tasks}`,
    },
    {
      label: t("workHistory.replay.outcome.files"),
      value: mergeDenied ? "—" : String(stats.filesChanged),
    },
    {
      label: t("workHistory.replay.outcome.tests"),
      value: t("workHistory.replay.outcome.testsValue", {
        count: stats.testsPassed,
        scanned: stats.reportsScanned,
        total: stats.tasksDone,
      }),
    },
    {
      label: t("workHistory.replay.outcome.retries"),
      value: String(stats.retries),
    },
    {
      label: t("workHistory.replay.outcome.interventions"),
      // 권한이 없어 사람 레인을 못 읽었으면 0 이 아니라 "—" 다(설계 C2).
      value: humanDenied ? "—" : String(countHumanInterventions(replay.beats)),
    },
  ];

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-gray-300">
        {t("workHistory.replay.outcome.title")}
      </h3>
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
        <dl className="space-y-1">
          {lines.map((line) => (
            <div key={line.label} className="flex gap-3 text-[11px]">
              <dt className="w-24 flex-shrink-0 text-gray-500">{line.label}</dt>
              <dd className="font-mono text-gray-200">{line.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-2 border-t border-gray-800 pt-2">
          <p className="mb-1 text-[11px] text-gray-500">
            {t("workHistory.replay.outcome.prs")}
          </p>
          {replay.prUrls.length === 0 ? (
            <p className="text-[11px] text-gray-500">
              {t("workHistory.replay.outcome.noPrs")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {replay.prUrls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-[11px] text-blue-400 hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export interface MissionReplayDetailViewProps {
  state: MissionReplayState;
  onBack: () => void;
  onReload: () => void;
  t: TFunction;
}

/** 상태 → 화면. 구독을 모른다(테스트가 이 함수만 호출한다). */
export function MissionReplayDetailView({
  state,
  onBack,
  onReload,
  t,
}: MissionReplayDetailViewProps) {
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <BackButton onBack={onBack} t={t} />
      <button
        type="button"
        onClick={onReload}
        className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition hover:bg-gray-800"
      >
        {t("workHistory.replay.reload")}
      </button>
    </div>
  );

  if (state.status === "loading") {
    return (
      <div className="space-y-3">
        {header}
        <Panel>{t("workHistory.replay.loading")}</Panel>
      </div>
    );
  }

  if (state.status === "unavailable") {
    // "없음"·"완료 아님"·"권한 없음"은 서로 다른 사실이라 문구도 다르다.
    const message =
      state.reason === "denied"
        ? t("workHistory.replay.unavailable.denied")
        : state.reason === "not-completed"
          ? t("workHistory.replay.unavailable.notCompleted")
          : t("workHistory.replay.unavailable.notFound");
    return (
      <div className="space-y-3">
        {header}
        <Panel>{message}</Panel>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3">
        {header}
        <Panel>
          {t("workHistory.replay.error", { message: state.message })}
        </Panel>
      </div>
    );
  }

  const { replay, sourceErrors } = state;
  return (
    <div className="space-y-4">
      {header}
      <ReplayHeadline replay={replay} sourceErrors={sourceErrors} t={t} />
      <ReplayStatsGrid replay={replay} t={t} />
      <ReplayTimeline replay={replay} t={t} />
      <ReplayOutcome replay={replay} t={t} />
      <ReplayCast cast={replay.cast} t={t} />
    </div>
  );
}

export interface MissionReplayDetailProps {
  missionId: string;
  projectId?: string;
  onBack: () => void;
  /** 테스트/스토리에서 구독 의존을 갈아 끼우기 위한 통로. 앱 경로는 안 넘긴다. */
  options?: MissionReplayOptions;
}

export function MissionReplayDetail({
  missionId,
  projectId,
  onBack,
  options,
}: MissionReplayDetailProps) {
  const { t } = useTranslation();
  const { state, reload } = useMissionReplay(missionId, {
    ...options,
    projectId,
  });
  return (
    <MissionReplayDetailView
      state={state}
      onBack={onBack}
      onReload={reload}
      t={t}
    />
  );
}
