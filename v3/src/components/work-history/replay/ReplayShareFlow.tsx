import { useEffect, useMemo, useState } from "react";
import {
  buildReplayCardFileName,
  buildReplayCardModel,
  renderReplayCardPng,
} from "../../../lib/replay/export/card";
import {
  buildReplayMotionFileName,
  renderReplayMotionGif,
} from "../../../lib/replay/export/gif";
import { redactReplay } from "../../../lib/replay/redactReplay";
import {
  buildReplayShareIntents,
  type ShareIntent,
} from "../../../lib/replay/shareIntents";
import {
  getMissionPublication,
  publicReplayUrl,
  publishReplay,
  type PublicReplayRef,
  unpublishReplay,
} from "../../../services/publicReplayService";
import type {
  MissionReplay,
  RedactedReplay,
  ReplayVisibilityLevel,
} from "../../../types/missionReplay";
import { RedactionPreview } from "./RedactionPreview";
import { ReplayVisibilityPanel } from "./ReplayVisibilityPanel";
import { ReplayPublishPanel } from "./ReplayPublishPanel";

export type ReplayShareFormat = "link" | "image" | "gif";
export type ReplayShareStep = 1 | 2 | 3;

export interface ReplayShareFlowProps {
  replay: MissionReplay;
  canPublish: boolean;
  publisherUid?: string;
  onClose: () => void;
  /** Opens the flow directly at the given format step (avoids extra tap). */
  defaultFormat?: ReplayShareFormat;
}

interface GeneratedAsset {
  url: string;
  fileName: string;
}

const FORMAT_COPY: Record<
  ReplayShareFormat,
  { title: string; description: string }
> = {
  link: {
    title: "텍스트 · 링크",
    description: "공개 URL을 원클릭으로 공유합니다. OG 카드가 자동 미리보기됩니다.",
  },
  image: {
    title: "이미지 카드",
    description: "PNG 공유 카드를 생성합니다.",
  },
  gif: {
    title: "GIF",
    description: "미션 흐름을 보여 주는 GIF를 생성합니다.",
  },
};

/** Step 3's platform constraint is intentionally explicit and unit-testable. */
export function replayShareChannelMode(
  format: ReplayShareFormat,
): "intent" | "download-and-compose" {
  return format === "link" ? "intent" : "download-and-compose";
}

export function replayShareStepLabel(step: ReplayShareStep): string {
  return ["형식 선택", "생성", "채널 선택"][step - 1];
}

export function nextReplayShareStep(step: ReplayShareStep): ReplayShareStep {
  return Math.min(step + 1, 3) as ReplayShareStep;
}

export function previousReplayShareStep(step: ReplayShareStep): ReplayShareStep {
  return Math.max(step - 1, 1) as ReplayShareStep;
}

function downloadAsset(asset: GeneratedAsset): void {
  const link = document.createElement("a");
  link.href = asset.url;
  link.download = asset.fileName;
  link.click();
}

function publicationRef(record: Awaited<ReturnType<typeof getMissionPublication>>): PublicReplayRef | null {
  if (!record) return null;
  return {
    replayId: record.replayId,
    level: record.level,
    url: publicReplayUrl(record.replayId),
    publishedAt: record.publishedAt,
  };
}

/**
 * Detail-scoped, guided sharing surface.  It consumes only `RedactedReplay`
 * beyond the step-2 boundary, so image/GIF bytes and public payload cannot
 * accidentally use the original replay.
 */
export function ReplayShareFlow({
  replay,
  canPublish,
  publisherUid,
  onClose,
  defaultFormat,
}: ReplayShareFlowProps) {
  const [step, setStep] = useState<ReplayShareStep>(1);
  const [format, setFormat] = useState<ReplayShareFormat>(defaultFormat ?? "link");
  const [level, setLevel] = useState<Exclude<ReplayVisibilityLevel, "L0">>("L2");
  const [publication, setPublication] = useState<PublicReplayRef | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(true);
  const [asset, setAsset] = useState<GeneratedAsset | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const redacted = useMemo<RedactedReplay>(
    () => redactReplay(replay, { level }),
    [level, replay],
  );
  const shareText = `${buildReplayCardModel(redacted).goal} — Mission Replay`;
  const intents = useMemo<ShareIntent[]>(
    () => buildReplayShareIntents(publication?.url ?? "", shareText),
    [publication?.url, shareText],
  );

  useEffect(() => {
    let cancelled = false;
    void getMissionPublication(replay.projectId, replay.missionId)
      .then((record) => {
        if (!cancelled) setPublication(publicationRef(record));
      })
      .catch(() => {
        // Owner-record read can be denied for a member. Publish itself remains
        // fail-closed through `canPublish`; do not treat a failed lookup as no
        // publication and promise a new URL.
      })
      .finally(() => {
        if (!cancelled) setPublicationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [replay.missionId, replay.projectId]);

  useEffect(
    () => () => {
      if (asset) URL.revokeObjectURL(asset.url);
    },
    [asset],
  );

  const publishCurrent = async () => {
    if (!canPublish || !publisherUid) {
      setError("공개 URL 발행 권한이 없습니다. 프로젝트 소유자 또는 관리자에게 요청하세요.");
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      setPublication(await publishReplay({ replay, redacted, publisherUid }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공개 URL을 발행하지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const unpublishCurrent = async () => {
    if (!publication) return;
    setError(null);
    setGenerating(true);
    try {
      await unpublishReplay(publication.replayId);
      setPublication(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공개 URL을 해제하지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      if (!redacted.verified) {
        throw new Error("비식별화 검증에 실패해 공유 산출물 생성을 중단했습니다.");
      }
      if (format === "link") {
        if (publication) {
          setStep(3);
          return;
        }
        throw new Error("공개 URL을 먼저 발행한 뒤 채널을 선택하세요.");
      }

      const blob =
        format === "image"
          ? await renderReplayCardPng(redacted)
          : await renderReplayMotionGif(redacted);
      const model = buildReplayCardModel(redacted);
      const fileName =
        format === "image"
          ? buildReplayCardFileName(model)
          : buildReplayMotionFileName(model, "gif");
      setAsset((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { url: URL.createObjectURL(blob), fileName };
      });
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공유 산출물을 만들지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("클립보드에 복사하지 못했습니다. URL 또는 문구를 직접 선택해 복사하세요.");
    }
  };

  const assetMode = replayShareChannelMode(format) === "download-and-compose";
  const changeLevel = (next: ReplayVisibilityLevel) => {
    // VisibilityPanel only exposes L1-L3, but its public prop keeps L0 for
    // callers that render the full policy type. The share boundary cannot
    // generate a redacted payload for L0, so remain fail-closed.
    if (next !== "L0") setLevel(next);
  };

  return (
    <section
      aria-label="Mission Replay 공유 마법사"
      className="space-y-4 rounded-xl border border-violet-500/40 bg-gray-950 p-4 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-violet-300">이 미션 공유</p>
          <h3 className="mt-1 text-sm font-semibold text-gray-100">{replay.goal}</h3>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-gray-100">
          닫기
        </button>
      </div>

      <ol aria-label="공유 단계" className="grid grid-cols-3 gap-2 text-[11px]">
        {([1, 2, 3] as ReplayShareStep[]).map((item) => (
          <li
            key={item}
            className={`rounded px-2 py-1.5 ${item === step ? "bg-violet-500/20 text-violet-200" : "bg-gray-900 text-gray-500"}`}
          >
            {item}. {replayShareStepLabel(item)}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(FORMAT_COPY) as ReplayShareFormat[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFormat(item)}
              className={`rounded-lg border p-3 text-left text-xs ${format === item ? "border-violet-400 bg-violet-500/10" : "border-gray-800 hover:border-gray-600"}`}
            >
              <span className="block font-medium text-gray-100">{FORMAT_COPY[item].title}</span>
              <span className="mt-1 block text-[11px] text-gray-500">{FORMAT_COPY[item].description}</span>
            </button>
          ))}
          <div className="sm:col-span-3 flex justify-end">
            <button type="button" onClick={() => setStep(nextReplayShareStep(step))} className="rounded bg-violet-400 px-3 py-1.5 text-xs font-medium text-gray-950">
              다음: 생성
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <ReplayVisibilityPanel level={level} onLevelChange={changeLevel} />
          <RedactionPreview redacted={redacted} />
          {format === "link" && !publicationLoading && (
            <ReplayPublishPanel
              redacted={redacted}
              canPublish={canPublish && Boolean(publisherUid)}
              publication={publication}
              isCompletedMission={replay.completedAt !== null}
              onPublish={publishCurrent}
              onUnpublish={unpublishCurrent}
              busy={generating}
              errorMessage={error}
              showShareControls={false}
            />
          )}
          {format === "link" && !publication && !publicationLoading && (
            <p className="rounded border border-sky-500/30 bg-sky-950/30 p-3 text-xs text-sky-100">
              텍스트·링크 공유에는 공개 URL이 필요합니다. 등급을 확인한 뒤 발행하면 URL과 OG 카드 미리보기를 원클릭으로 공유할 수 있습니다.
            </p>
          )}
          {format !== "link" && error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          <div className="flex justify-between gap-2">
            <button type="button" onClick={() => setStep(previousReplayShareStep(step))} className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300">이전</button>
            <button type="button" disabled={generating || publicationLoading || (format === "link" && !publication)} onClick={() => void generate()} className="rounded bg-violet-400 px-3 py-1.5 text-xs font-medium text-gray-950 disabled:opacity-40">
              {generating ? "생성 중…" : format === "link" ? "다음: 채널 선택" : `${FORMAT_COPY[format].title} 생성`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {assetMode ? (
            <>
              <p className="rounded border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-100/90">
                정직한 안내: X·Threads·LinkedIn의 웹 공유 창은 이미지나 GIF 파일을 자동 첨부할 수 없습니다. 먼저 파일을 다운로드한 뒤 채널 컴포저를 열어 직접 첨부하세요. 링크 공유만으로도 OG 카드 미리보기가 자동 표시되어 대부분의 경우 충분합니다.
              </p>
              {asset && <button type="button" onClick={() => downloadAsset(asset)} className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300">{asset.fileName} 다운로드</button>}
            </>
          ) : (
            <p className="rounded border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-100/90">
              텍스트·링크는 URL과 문구를 채운 공식 웹 intent로 바로 공유합니다. 게시물에는 OG 카드 미리보기가 자동으로 붙습니다.
            </p>
          )}
          <div role="group" aria-label="공유 채널" className="flex flex-wrap gap-2">
            {intents.map((intent) => (
              <a key={intent.platform} href={intent.url} target="_blank" rel="noopener noreferrer" className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:border-gray-500">
                {intent.label}{assetMode ? " 컴포저 열기" : " 공유"}
              </a>
            ))}
            <button type="button" onClick={() => void copy(publication?.url ?? shareText)} className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:border-gray-500">
              {copied ? "복사됨" : assetMode ? "공유 문구 복사" : "링크 복사"}
            </button>
          </div>
          {assetMode && !publication && <p className="text-[11px] text-gray-500">컴포저에는 공유 문구만 넣습니다. 파일을 직접 첨부하고, 원하면 위 문구를 함께 붙여 주세요.</p>}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(previousReplayShareStep(step))} className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300">이전</button>
            <button type="button" onClick={onClose} className="rounded bg-violet-400 px-3 py-1.5 text-xs font-medium text-gray-950">완료</button>
          </div>
        </div>
      )}
    </section>
  );
}
