import { useTranslation } from "../../lib/i18n";
import { PlayCircle } from "lucide-react";
import { ORCHESTRATION_DEMO_SECONDS } from "../onboarding/VideoDemoModal";

export interface BeginnerDemoTicketCtaProps {
  onWatchDemo: () => void;
  testId?: string;
  className?: string;
}

/**
 * 비기너 연결 전 가치 확인 CTA.
 * 인터랙티브 티켓 생성 대신 고정 영상만 연다.
 */
export function BeginnerDemoTicketCta({
  onWatchDemo,
  testId = "beginner-firstscreen-demo",
  className = "",
}: BeginnerDemoTicketCtaProps) {
  const { t } = useTranslation();

  return (
    <div data-testid={testId} className={className}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#89b4fa]">
        {t("beginner.connect.demoLead")}
      </p>
      <button
        type="button"
        data-testid="beginner-firstscreen-demo-watch"
        onClick={onWatchDemo}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#89b4fa]/45 bg-[#89b4fa]/15 px-4 py-3 text-sm font-semibold text-[#cdd6f4] transition-colors hover:bg-[#89b4fa]/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#89b4fa]"
      >
        <PlayCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("beginner.connect.watchDemo", {
          seconds: ORCHESTRATION_DEMO_SECONDS,
        })}
      </button>
    </div>
  );
}
