import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { QuickActionState } from "./useCodeQuickAction";

/**
 * 퀵액션의 **사이드 표면** — 실행 중 / 설명 결과 / 에러 / 연결 CLI 없음.
 *
 * `이거 고쳐` 가 성공했을 때만 여기가 비고, 결과는 선택 지점의 인라인 diff
 * 위젯으로 간다(CodeEditor). 수정 제안은 코드 옆에서 봐야 판단이 되기 때문 —
 * 설명은 읽고 닫으면 그만이라 옆 패널이 맞다.
 */
interface QuickActionPanelProps {
  state: QuickActionState;
  onDismiss: () => void;
  onOpenCliSetup: () => void;
}

const ACTION_LABEL: Record<QuickActionState["action"], MessageKey> = {
  explain: "code.quickAction.explain",
  fix: "code.quickAction.fix",
};

export function QuickActionPanel({
  state,
  onDismiss,
  onOpenCliSetup,
}: QuickActionPanelProps) {
  const { t } = useTranslation();

  // 수정 제안이 나온 경우는 인라인 diff 위젯이 표면이다 — 같은 결과를 두 군데
  // 띄우면 어느 쪽 [적용] 이 진짜인지 모호해진다.
  if (state.action === "fix" && state.status === "done") return null;

  const title = t(ACTION_LABEL[state.action]);

  return (
    <div
      data-testid="code-quick-action-panel"
      className="absolute bottom-3 right-3 top-3 z-20 flex w-[min(380px,calc(100%-24px))] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900/95 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
        <span className="text-sm">✨</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-100">
          {title}
        </span>
        {state.cli && (
          <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
            {state.cli === "claude" ? "Claude Code" : "Codex"}
          </span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("common.close")}
          title={t("common.close")}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-100"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-xs leading-relaxed text-gray-200">
        {state.status === "running" && (
          <div className="flex flex-col gap-2">
            <p className="text-gray-300">
              {t("code.quickAction.running", {
                start: state.startLine,
                end: state.endLine,
              })}
            </p>
            <p className="text-[11px] text-gray-500">
              {t("code.quickAction.onDemandHint")}
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="self-start rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}

        {state.status === "needs-cli" && (
          <div className="flex flex-col gap-2">
            <p className="text-gray-200">{t("code.quickAction.needsCli")}</p>
            <p className="text-[11px] text-gray-500">
              {t("code.quickAction.needsCliWhy")}
            </p>
            <button
              type="button"
              data-testid="code-quick-action-setup-cta"
              onClick={onOpenCliSetup}
              className="self-start rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-500"
            >
              {t("code.quickAction.needsCliCta")}
            </button>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-red-300">{state.error}</p>
            {state.text && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-950 p-2 text-[11px] text-gray-400">
                {state.text}
              </pre>
            )}
          </div>
        )}

        {state.status === "done" && state.action === "explain" && (
          <>
            {state.truncated && (
              <p className="mb-2 rounded bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
                {t("code.quickAction.truncated")}
              </p>
            )}
            <pre className="whitespace-pre-wrap break-words font-sans text-xs text-gray-200">
              {state.text}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
