import { useEffect, useMemo, useState } from "react";
import {
  buildReplayCardFileName,
  buildReplayCardModel,
  renderReplayCardPng,
  type ReplayCardTheme,
} from "../../../lib/replay/export/card";
import type { RedactedReplay } from "../../../types/missionReplay";

export interface ReplayExportPanelProps {
  redacted: RedactedReplay;
  /** Override for tests/stories. Production callers rely on the card's own default theme. */
  theme?: ReplayCardTheme;
}

type ExportState =
  | { status: "blocked" }
  | { status: "rendering" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

/**
 * Mission Replay 공유 카드 — PNG only (design §4 Phase 3, CEO gate §9.1로
 * GIF/영상/배지 절단). "Shipped with Marblo" 공유카드 티켓(`eyfqjtEpIOzCiXRPWfX5`)
 * 을 이 컴포넌트가 흡수한다.
 *
 * ★`redacted.verified === false` 면 카드를 아예 그리지 않는다 — 2차 검증을
 * 통과하지 못한 바이트로 이미지를 만드는 것도 발행이다(design §3.2 불변식).
 */
export function ReplayExportPanel({ redacted, theme }: ReplayExportPanelProps) {
  const [state, setState] = useState<ExportState>(
    redacted.verified ? { status: "rendering" } : { status: "blocked" },
  );

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

  const fileName = useMemo(
    () => buildReplayCardFileName(buildReplayCardModel(redacted)),
    [redacted],
  );

  const handleDownload = () => {
    if (state.status !== "ready") return;
    const link = document.createElement("a");
    link.href = state.url;
    link.download = fileName;
    link.click();
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
          검증을 통과한 발행 바이트에서만 카드를 생성합니다 · PNG only
        </p>
      </div>

      {state.status === "blocked" && (
        <div
          data-testid="replay-export-blocked"
          className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300"
        >
          검증 실패 · 카드 생성 중단 — 이 등급의 발행 바이트가 2차 검증을
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
    </section>
  );
}
