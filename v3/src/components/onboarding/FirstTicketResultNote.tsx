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

export function FirstTicketResultNote({
  result,
}: {
  result: FirstTicketResult;
}) {
  const { t } = useTranslation();
  const view = firstTicketView(result.delivery);

  return (
    <>
      <p className={`text-xs ${TONE_CLASS[view.tone]}`}>{result.text}</p>
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
    </>
  );
}
