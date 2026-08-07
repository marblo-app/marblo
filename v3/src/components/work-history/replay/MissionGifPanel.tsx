/**
 * 미션 GIF — 완료이력 탭의 **기본 공유 플로우**.
 *
 * 표면은 딱 두 단계다: **미션을 고른다 → GIF 생성 버튼 하나.**
 *
 * ── 왜 이렇게 줄였나 ─────────────────────────────────────────────────────
 * 기존 공유 마법사(`ReplayShareFlow`)는 3단계였다: 형식(카드/링크/GIF) → 등급
 * (L1/L2/L3) + 비식별 미리보기 → 채널. 그런데 이 플로우가 만드는 GIF 에 들어가는
 * 것은 **미션명·태스크 제목·PR 번호·의존 순서**뿐이라(설계는
 * `lib/replay/missionOutline.ts`), 등급을 고르게 하는 것은 사용자에게 답을 알 수
 * 없는 질문을 시키는 셈이다. 그래서 등급은 L2 로 고정하고 선택 UI 를 없앴다.
 * 카드·링크·등급 패널의 **코드는 그대로 남아 있다**(후속 재도입 여지) — 기본
 * 경로에서 빠졌을 뿐이다.
 *
 * ★fail-closed 는 유지된다: 비식별 2차 검증(`redacted.verified`)이 깨지면 GIF 를
 * 만들지 않고 이유를 말한다. 검증 결과를 화면에서 없앤 게 아니라, 통과했을 때
 * 조용히 지나갈 뿐이다.
 *
 * ★native 인코더 금지 — 인코딩은 `gif.ts` 의 gifenc(순수 JS) 경로 그대로다.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation, type TFunction } from "../../../lib/i18n";
import {
  buildMissionExportReplay,
  useProjectMissions,
} from "../../../hooks/useMissionReplay";
import {
  buildMissionGifOptions,
  type MissionGifOption,
} from "../../../lib/replay/missionPicker";
import { redactReplay } from "../../../lib/replay/redactReplay";
import { buildReplayCardModel } from "../../../lib/replay/export/card";
import {
  buildReplayMotionFileName,
  renderReplayMotionGif,
} from "../../../lib/replay/export/gif";
import type { Activity } from "../../../types/activity";
import type { MergeHistoryEntry } from "../../../types/mergeHistory";
import type { Mission } from "../../../types/mission";
import type {
  MissionReplay,
  ReplayOutline,
} from "../../../types/missionReplay";
import type { Task } from "../../../types/task";

/** 이 플로우가 쓰는 공개 등급. 선택 UI 없음 — 담기는 사실이 등급과 무관하다. */
const GIF_VISIBILITY_LEVEL = "L2" as const;

export interface GeneratedGifAsset {
  url: string;
  fileName: string;
}

export interface MissionGifPanelViewProps {
  options: readonly MissionGifOption[];
  selectedId: string | null;
  onSelect: (missionId: string) => void;
  /** 선택된 미션의 개요(미리보기). 아직 조립 전이면 null. */
  outline: ReplayOutline | null;
  goal: string | null;
  generating: boolean;
  canGenerate: boolean;
  error: string | null;
  asset: GeneratedGifAsset | null;
  onGenerate: () => void;
  onDownload: () => void;
  /** 고를 미션이 하나도 없을 때의 탈출구(미션 만들기). */
  onCreateMission?: () => void;
  t: TFunction;
}

function statusChip(option: MissionGifOption, t: TFunction): string {
  return option.completed
    ? t("workHistory.replay.gif.status.completed")
    : t("workHistory.replay.gif.status.running");
}

/** 상태 → 화면. 구독도 인코딩도 모른다(테스트가 이 함수만 호출한다). */
export function MissionGifPanelView({
  options,
  selectedId,
  onSelect,
  outline,
  goal,
  generating,
  canGenerate,
  error,
  asset,
  onGenerate,
  onDownload,
  onCreateMission,
  t,
}: MissionGifPanelViewProps) {
  return (
    <section className="space-y-3" data-testid="mission-gif-panel">
      <div>
        <h2 className="text-sm font-semibold text-gray-100">
          {t("workHistory.replay.gif.title")}
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          {t("workHistory.replay.gif.hint")}
        </p>
      </div>

      {options.length === 0 ? (
        <div
          data-testid="mission-gif-empty"
          className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-4"
        >
          <p className="text-xs text-gray-400">
            {t("workHistory.replay.gif.empty")}
          </p>
          {onCreateMission && (
            <button
              type="button"
              onClick={onCreateMission}
              className="mt-2 rounded border border-sky-500/40 px-2.5 py-1 text-[11px] text-sky-100 transition hover:bg-sky-500/10"
            >
              {t("workHistory.replay.list.empty.cta")}
            </button>
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={t("workHistory.replay.gif.pickerLabel")}
          data-testid="mission-gif-options"
          // 미션이 수십 개인 프로젝트에서 목록이 화면을 통째로 밀어내지 않도록
          // 여기서만 스크롤한다. ★자르지는 않는다 — 목록에서 빠진 미션은
          // 사용자 입장에서 "만들 수 없는 미션"이 된다.
          className="max-h-72 space-y-1.5 overflow-y-auto"
        >
          {options.map((option) => {
            const selected = option.missionId === selectedId;
            return (
              <button
                key={option.missionId}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`mission-gif-option-${option.missionId}`}
                data-selected={selected}
                onClick={() => onSelect(option.missionId)}
                title={option.goal}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  selected
                    ? "border-violet-400 bg-violet-500/10"
                    : "border-gray-800 bg-gray-800/40 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-100">
                    {option.label}
                  </span>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      option.completed
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-sky-500/15 text-sky-300"
                    }`}
                  >
                    {statusChip(option, t)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-gray-500">
                  <span>
                    {t("workHistory.replay.gif.taskCount", {
                      done: option.doneCount,
                      total: option.taskCount,
                    })}
                  </span>
                  {option.prCount > 0 && (
                    <span>
                      {t("workHistory.replay.gif.prCount", {
                        count: option.prCount,
                      })}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {outline && (
        <div
          data-testid="mission-gif-preview"
          className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
        >
          <p className="truncate text-xs font-medium text-gray-200">{goal}</p>
          <ol className="mt-2 space-y-1">
            {outline.tasks.map((item) => (
              <li
                key={item.ref}
                className="flex items-center gap-2 text-[11px] text-gray-400"
              >
                <span className="w-5 flex-shrink-0 font-mono text-violet-300">
                  {item.ref}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.dependsOn.length > 0 && (
                  <span className="flex-shrink-0 font-mono text-gray-600">
                    ← {item.dependsOn.join(", ")}
                  </span>
                )}
                {item.prNumber !== null && (
                  <span className="flex-shrink-0 font-mono text-sky-300">
                    #{item.prNumber}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {outline.truncated > 0 && (
            <p className="mt-1 text-[11px] text-gray-600">
              {t("workHistory.replay.gif.truncated", {
                count: outline.truncated,
              })}
            </p>
          )}
          {outline.mergeOrder.length > 0 && (
            <p
              data-testid="mission-gif-merge-order"
              className="mt-2 text-[11px] text-gray-400"
            >
              {t("workHistory.replay.gif.mergeOrder")}{" "}
              <span className="font-mono text-sky-300">
                {outline.mergeOrder.map((pr) => `#${pr}`).join(" → ")}
              </span>
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="mission-gif-error"
          className="rounded border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="mission-gif-generate"
          disabled={!canGenerate || generating}
          onClick={onGenerate}
          className="rounded bg-violet-400 px-3 py-1.5 text-xs font-medium text-gray-950 transition disabled:opacity-40"
        >
          {generating
            ? t("workHistory.replay.gif.generating")
            : t("workHistory.replay.gif.generate")}
        </button>
        {asset && (
          <button
            type="button"
            data-testid="mission-gif-download"
            onClick={onDownload}
            className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/10"
          >
            {t("workHistory.replay.gif.download", { name: asset.fileName })}
          </button>
        )}
      </div>
    </section>
  );
}

export interface MissionGifPanelProps {
  projectId: string;
  /** 프로젝트 태스크 전부(기간 필터 이전). 미션 소속은 기간과 무관하다. */
  tasks: readonly Task[];
  activitiesByTaskId?: Readonly<Record<string, readonly Activity[]>>;
  mergeHistoryByTaskId?: Readonly<Record<string, MergeHistoryEntry>>;
  /**
   * missions 컬렉션이 비어 있을 때의 대체 미션(완료 작업 집계).
   * 있으면 선택 목록의 마지막 칸으로 들어간다.
   */
  fallbackMission?: { mission: Mission; replay: MissionReplay } | null;
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onCreateMission?: () => void;
}

export function MissionGifPanel({
  projectId,
  tasks,
  activitiesByTaskId,
  mergeHistoryByTaskId,
  fallbackMission,
  selectedMissionId,
  onSelectMission,
  onCreateMission,
}: MissionGifPanelProps) {
  const { t } = useTranslation();
  const { missions } = useProjectMissions(projectId);
  const [asset, setAsset] = useState<GeneratedGifAsset | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const real = buildMissionGifOptions(missions, tasks);
    if (real.length > 0 || !fallbackMission) return real;
    // 미션 문서가 없는 프로젝트에서도 고를 게 하나는 있어야 한다 — 완료 작업
    // 집계(경량 Replay)를 미션 한 칸으로 내놓는다.
    const { mission, replay } = fallbackMission;
    return [
      {
        missionId: mission.id,
        label: mission.goal,
        goal: mission.goal,
        status: mission.status,
        taskCount: replay.stats.tasks,
        doneCount: replay.stats.tasksDone,
        prCount: replay.stats.prs,
        completed: true,
        sortedAt: mission.completedAt,
      } satisfies MissionGifOption,
    ];
  }, [missions, tasks, fallbackMission]);

  // 고르지 않았으면 첫 칸(= 가장 최근 미션)을 미리 고른다. 아무것도 안 고른
  // 화면에서 "생성" 이 죽어 있으면 사용자는 그걸 고장으로 읽는다.
  const selectedId =
    selectedMissionId && options.some((o) => o.missionId === selectedMissionId)
      ? selectedMissionId
      : (options[0]?.missionId ?? null);

  const replay = useMemo<MissionReplay | null>(() => {
    if (!selectedId) return null;
    if (fallbackMission && selectedId === fallbackMission.mission.id) {
      return fallbackMission.replay;
    }
    const mission = missions.find((item) => item.id === selectedId);
    if (!mission) return null;
    return buildMissionExportReplay({
      mission,
      tasks,
      activitiesByTaskId,
      mergeHistoryByTaskId,
    });
  }, [
    selectedId,
    missions,
    tasks,
    activitiesByTaskId,
    mergeHistoryByTaskId,
    fallbackMission,
  ]);

  // 선택이 바뀌면 이전 미션의 GIF 를 들고 있으면 안 된다(다른 미션 파일을
  // 내려받게 된다).
  useEffect(() => {
    setAsset((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setError(null);
  }, [selectedId]);

  useEffect(
    () => () => {
      if (asset) URL.revokeObjectURL(asset.url);
    },
    [asset],
  );

  const generate = async () => {
    if (!replay) return;
    setError(null);
    setGenerating(true);
    try {
      const redacted = redactReplay(replay, { level: GIF_VISIBILITY_LEVEL });
      if (!redacted.verified) {
        // 등급 선택 UI 는 없앴지만 fail-closed 는 그대로다 — 검증이 깨지면
        // 만들지 않고, 무엇이 걸렸는지 규칙 이름으로 말한다.
        const rules = redacted.removed
          .slice(0, 5)
          .map((item) => item.rule)
          .join(", ");
        throw new Error(
          t("workHistory.replay.gif.error.unverified", { rules: rules || "-" }),
        );
      }
      const blob = await renderReplayMotionGif(redacted, {
        template: "mission",
      });
      const fileName = buildReplayMotionFileName(
        buildReplayCardModel(redacted),
        "gif",
        "mission",
      );
      setAsset((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { url: URL.createObjectURL(blob), fileName };
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("workHistory.replay.gif.error.generic"),
      );
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!asset) return;
    const link = document.createElement("a");
    link.href = asset.url;
    link.download = asset.fileName;
    link.click();
  };

  return (
    <MissionGifPanelView
      options={options}
      selectedId={selectedId}
      onSelect={onSelectMission}
      outline={replay?.outline ?? null}
      goal={replay?.goal ?? null}
      generating={generating}
      canGenerate={Boolean(replay)}
      error={error}
      asset={asset}
      onGenerate={() => void generate()}
      onDownload={download}
      onCreateMission={onCreateMission}
      t={t}
    />
  );
}
