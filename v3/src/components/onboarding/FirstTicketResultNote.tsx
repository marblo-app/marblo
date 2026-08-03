import { useTranslation } from "../../lib/i18n";
import {
  firstTicketView,
  ORCHESTRATOR_HELP_STEP_KEYS,
} from "../../lib/firstTicketDelivery";
import type { FirstTicketResult } from "../../services/cliSetupActions";

/**
 * 첫 티켓 전송 결과 한 덩어리 — 문구 + (필요할 때) "오케를 어떻게 띄우나" 안내.
 *
 * 레거시 모달(CliSetupGate)과 시작하기 탭(StartHereTab)이 같은 것을 그려야 해서
 * 컴포넌트로 뽑았다. 분기 규칙은 여기 없다 — `lib/firstTicketDelivery` 의 순수
 * 함수가 단일소스이고 이 파일은 그 결과를 색으로 옮길 뿐이다(활성화 F3).
 */
const TONE_CLASS = {
  success: "text-[#a6e3a1]",
  warning: "text-[#f9e2af]",
  error: "text-[#f38ba8]",
} as const;

const PANEL_CLASS = {
  success: "border-[#a6e3a1]/30 bg-[#a6e3a1]/5",
  warning: "border-[#f9e2af]/30 bg-[#f9e2af]/5",
  error: "border-[#f38ba8]/30 bg-[#f38ba8]/5",
} as const;

const TITLE_KEY = {
  delivered: "onboarding.cliGate.firstTicket.result.delivered.title",
  queued: "onboarding.cliGate.firstTicket.result.queued.title",
  failed: "onboarding.cliGate.firstTicket.result.failed.title",
} as const;

export function FirstTicketResultNote({
  result,
  onRetry,
  retrying = false,
}: {
  result: FirstTicketResult;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { t } = useTranslation();
  const view = firstTicketView(result.delivery);
  const canRetry = result.delivery !== "delivered" && Boolean(onRetry);

  return (
    <div
      role={view.tone === "success" ? "status" : "alert"}
      className={`space-y-2 rounded-md border px-3 py-2.5 ${PANEL_CLASS[view.tone]}`}
    >
      <div className="space-y-1">
        <p className={`text-xs font-semibold ${TONE_CLASS[view.tone]}`}>
          {t(TITLE_KEY[result.delivery])}
        </p>
        <p className="text-xs text-[#a6adc8]">{result.text}</p>
      </div>
      {view.showOrchestratorHelp && (
        <div className="rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/5 px-3 py-2.5">
          <p className="text-xs font-semibold text-[#f9e2af]">
            {t("onboarding.cliGate.firstTicket.needOrch.title")}
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-[#a6adc8]">
            {ORCHESTRATOR_HELP_STEP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-[#7f849c]">
            {t("onboarding.cliGate.firstTicket.needOrch.crossMachine")}
          </p>
        </div>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-md border border-[#45475a] px-2.5 py-1.5 text-xs font-medium text-[#cdd6f4] transition-colors hover:border-[#89b4fa]/60 hover:bg-[#89b4fa]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {retrying
            ? t("onboarding.cliGate.firstTicket.retrying")
            : t("onboarding.cliGate.firstTicket.retry")}
        </button>
      )}
    </div>
  );
}
