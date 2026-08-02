import { useEffect, useMemo, useState } from "react";
import {
  buildReplayCardFileName,
  buildReplayCardModel,
  renderReplayCardPng,
  type ReplayCardTheme,
} from "../../../lib/replay/export/card";
import {
  buildReplayMotionFileName,
  isReplayMotionWebmSupported,
  renderReplayMotionGif,
  renderReplayMotionWebm,
} from "../../../lib/replay/export/gif";
import {
  REPLAY_EXPORT_DEFAULT_TEMPLATE,
  REPLAY_EXPORT_TEMPLATES,
  type ReplayExportTemplateId,
} from "../../../lib/replay/export/gifStoryboard";
import type { RedactedReplay } from "../../../types/missionReplay";

export interface ReplayExportPanelProps {
  redacted: RedactedReplay;
  /** Override for tests/stories. Production callers rely on the card's own default theme. */
  theme?: ReplayCardTheme;
  /** Override for tests/stories. Production defaults to the narrative cut. */
  defaultTemplate?: ReplayExportTemplateId;
}

type ExportState =
  | { status: "blocked" }
  | { status: "rendering" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

type MotionState =
  | { status: "blocked" }
  | { status: "unsupported" }
  | { status: "rendering" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

/**
 * Mission Replay 공유 카드 + 모션 익스포트 (design §4 Phase 3). 원래 CEO
 * gate(§9.1)로 PNG only 로 절단됐던 GIF/영상이 이 티켓에서 앞당겨 복귀했다.
 * "Shipped with Marblo" 공유카드 티켓(`eyfqjtEpIOzCiXRPWfX5`)을 이 컴포넌트가
 * 흡수한다.
 *
 * ★`redacted.verified === false` 면 PNG/GIF/영상 전부 그리지 않는다 — 2차
 * 검증을 통과하지 못한 바이트로 이미지를 만드는 것도 발행이다(design §3.2
 * 불변식). 이 게이트는 세 출력 모두에 동일하게 적용된다.
 *
 * ★영상(WebM)은 WebCodecs 를 쓰는 런타임(Chromium/Electron)에서만 만들어진다
 * — 지원하지 않는 런타임에서는 폴백 인코더 없이 "unsupported" 로 명시하고,
 * GIF 다운로드는 그대로 제공한다.
 *
 * ★시나리오 템플릿은 **모션에만** 적용된다 — PNG 공유카드는 `card.ts` 의 한
 * 가지 레이아웃 그대로다. 템플릿을 바꾸면 GIF/영상만 다시 인코딩된다(PNG
 * effect 의 deps 에 template 이 없는 이유).
 */
export function ReplayExportPanel({
  redacted,
  theme,
  defaultTemplate = REPLAY_EXPORT_DEFAULT_TEMPLATE,
}: ReplayExportPanelProps) {
  const [template, setTemplate] =
    useState<ReplayExportTemplateId>(defaultTemplate);
  const [state, setState] = useState<ExportState>(
    redacted.verified ? { status: "rendering" } : { status: "blocked" },
  );
  const [gifState, setGifState] = useState<MotionState>(
    redacted.verified ? { status: "rendering" } : { status: "blocked" },
  );
  const [webmState, setWebmState] = useState<MotionState>(() => {
    if (!redacted.verified) return { status: "blocked" };
    return isReplayMotionWebmSupported()
      ? { status: "rendering" }
      : { status: "unsupported" };
  });

  useEffect(() => {
    if (!redacted.verified) {
      setState({ status: "blocked" });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "rendering" });

    renderReplayCardPng(redacted, { theme })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [redacted, theme]);

  useEffect(() => {
    if (!redacted.verified) {
      setGifState({ status: "blocked" });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setGifState({ status: "rendering" });

    renderReplayMotionGif(redacted, { theme, template })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setGifState({ status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGifState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [redacted, theme, template]);

  useEffect(() => {
    if (!redacted.verified) {
      setWebmState({ status: "blocked" });
      return;
    }
    if (!isReplayMotionWebmSupported()) {
      setWebmState({ status: "unsupported" });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setWebmState({ status: "rendering" });

    renderReplayMotionWebm(redacted, { theme, template })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setWebmState({ status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWebmState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [redacted, theme, template]);

  const cardModel = useMemo(() => buildReplayCardModel(redacted), [redacted]);
  const fileName = useMemo(
    () => buildReplayCardFileName(cardModel),
    [cardModel],
  );
  const gifFileName = useMemo(
    () => buildReplayMotionFileName(cardModel, "gif", template),
    [cardModel, template],
  );
  const webmFileName = useMemo(
    () => buildReplayMotionFileName(cardModel, "webm", template),
    [cardModel, template],
  );

  const handleDownload = () => {
    if (state.status !== "ready") return;
    downloadUrl(state.url, fileName);
  };
  const handleGifDownload = () => {
    if (gifState.status !== "ready") return;
    downloadUrl(gifState.url, gifFileName);
  };
  const handleWebmDownload = () => {
    if (webmState.status !== "ready") return;
    downloadUrl(webmState.url, webmFileName);
  };

  return (
    <section
      aria-labelledby="replay-export-title"
      className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4"
    >
      <div>
        <h3
          id="replay-export-title"
          className="text-sm font-semibold text-gray-200"
        >
          공유 카드
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          검증을 통과한 발행 바이트에서만 생성합니다 · PNG · GIF · 영상(WebM)
        </p>
      </div>

      {state.status === "blocked" && (
        <div
          data-testid="replay-export-blocked"
          className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300"
        >
          검증 실패 · 익스포트 중단 — 이 등급의 발행 바이트가 2차 검증을
          통과하지 못했습니다.
        </div>
      )}

      {state.status === "rendering" && (
        <div
          data-testid="replay-export-rendering"
          className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center text-xs text-gray-400"
        >
          카드를 그리는 중…
        </div>
      )}

      {state.status === "error" && (
        <div
          data-testid="replay-export-error"
          className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300"
        >
          카드를 만들지 못했습니다 — {state.message}
        </div>
      )}

      {state.status === "ready" && (
        <div className="space-y-3">
          <img
            src={state.url}
            alt="Mission Replay 공유 카드 미리보기"
            className="w-full rounded-lg border border-gray-800"
          />
          <button
            type="button"
            onClick={handleDownload}
            className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/10"
          >
            PNG 다운로드
          </button>
        </div>
      )}

      {state.status !== "blocked" && (
        <div className="space-y-3 border-t border-gray-800 pt-3">
          <div>
            <h4 className="text-xs font-semibold text-gray-300">
              모션 스토리보드
            </h4>
            <p className="mt-1 text-[11px] text-gray-500">
              SNS 공유용 · 앱 다크 테마와 무관한 자체 브랜드 테마 · 비식별
              지표만(디프 원문 없음)
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="모션 시나리오 템플릿"
            data-testid="replay-export-templates"
            className="grid gap-2 sm:grid-cols-3"
          >
            {REPLAY_EXPORT_TEMPLATES.map((option) => {
              const selected = option.id === template;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`replay-export-template-${option.id}`}
                  data-selected={selected ? "true" : "false"}
                  onClick={() => setTemplate(option.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? "border-violet-500/60 bg-violet-500/10"
                      : "border-gray-800 bg-gray-800/30 hover:border-gray-700"
                  }`}
                >
                  <span
                    className={`block text-xs font-semibold ${
                      selected ? "text-violet-200" : "text-gray-300"
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          <MotionExportRow
            label="GIF"
            testId="replay-export-gif"
            state={gifState}
            onDownload={handleGifDownload}
          />
          <MotionExportRow
            label="영상 (WebM)"
            testId="replay-export-webm"
            state={webmState}
            onDownload={handleWebmDownload}
          />
        </div>
      )}
    </section>
  );
}

function downloadUrl(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

interface MotionExportRowProps {
  label: string;
  testId: string;
  state: MotionState;
  onDownload: () => void;
}

function MotionExportRow({
  label,
  testId,
  state,
  onDownload,
}: MotionExportRowProps) {
  return (
    <div
      data-testid={testId}
      data-status={state.status}
      className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2 text-xs"
    >
      <span className="text-gray-300">{label}</span>

      {state.status === "rendering" && (
        <span className="text-gray-500">생성 중…</span>
      )}
      {state.status === "unsupported" && (
        <span className="text-gray-500">이 런타임에서는 지원되지 않음</span>
      )}
      {state.status === "error" && (
        <span className="text-red-300">실패 — {state.message}</span>
      )}
      {state.status === "ready" && (
        <button
          type="button"
          onClick={onDownload}
          className="rounded border border-emerald-500/40 px-3 py-1.5 text-emerald-300 transition hover:bg-emerald-500/10"
        >
          다운로드
        </button>
      )}
    </div>
  );
}
