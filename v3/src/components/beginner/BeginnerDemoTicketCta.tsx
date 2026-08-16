import { useTranslation } from "../../lib/i18n";
import { OnrampDecomposeCard } from "../onboarding/OnrampDecomposeCard";

export interface BeginnerDemoTicketCtaProps {
  surface: "beginner_connect" | "beginner_chat";
  testId?: string;
  className?: string;
}

/**
 * 비기너 공용 L0 CTA — "내 문장으로 티켓 만들기".
 *
 * StartHereTab 과 같은 OnrampDecomposeCard 를 태워 입력→티켓 생성 경로를 공유한다.
 * 연결 전/후 표면이 갈라도 카드 구현은 한 벌이어야 한다.
 */
export function BeginnerDemoTicketCta({
  surface,
  testId = "beginner-firstscreen-demo",
  className = "",
}: BeginnerDemoTicketCtaProps) {
  const { t } = useTranslation();

  return (
    <div data-testid={testId} className={className}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#89b4fa]">
        {t("beginner.connect.demoLead")}
      </p>
      <OnrampDecomposeCard surface={surface} />
    </div>
  );
}
