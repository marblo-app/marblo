/**
 * 처리방침 1회성 명확화 고지 배너 — 얇은 1줄(모달 아님).
 *
 * 왜 있는가(ticket woXp2c70oR0tliGB8Vs6): 1차 처리방침 변경은 (1) 서버가
 * 이벤트에 붙이던 계정 UID 부착 중단(수집 **축소**)과 (2) 이미 하고 있던
 * 사용량·비용 기록(계정 연결)의 **누락된 고지 추가** 두 조각이었다. 둘 다 새로
 * 받을 동의가 없어 CURRENT_POLICY_VERSION 을 올리지 않지만(올리면 전 사용자
 * PIPA 모달 재프롬프트 — #797~#809 saga), (2)는 사용자가 몰랐을 수 있는 사실이라
 * 조용히 넘기지 않는다. 그 사이의 자리가 이 배너다.
 *
 * ★2차(2026-08-21, ticket vilkbSrnzbAv4ezbZMRT): 사람 축 분석 개방. 이번 건은
 * 축소가 아니라 **약속을 거두는** 변경이다("사람 단위 분석은 하지 않겠다" 철회).
 * 사장님 결정으로 CURRENT_POLICY_VERSION 은 그대로 두고 이 배너로만 알린다 —
 * 즉 **이 배너가 유일한 고지 경로다.** 여기가 안 뜨면 "약속을 거뒀는데 아무도
 * 모르는" 상태가 된다. 판정은 privacyClarification.ts 의 버전 상승이 만든다.
 *
 * ── 불변식 ──────────────────────────────────────────────────────────
 *  - **아무것도 write 하지 않는다.** 체크박스도 동의 버튼도 없다 — 받을 동의가
 *    없기 때문이다(정산에 필수인 기록). MarketingReconsentBanner 와 여기서
 *    갈린다: 저건 동의 수집 창구, 이건 고지 창구다.
 *  - 닫기는 이 기기 로컬 억제일 뿐(privacyClarification.ts). 전문은 언제나
 *    "자세히" → 처리방침 화면에 있다.
 *  - 노출 판정은 순수 함수 shouldShowPrivacyClarification 하나로 수렴한다
 *    (tests/unit/privacyClarification.test.ts).
 *
 * ★심플(BeginnerShell)·어드밴스드(GlobalOverlays) 양쪽에 마운트된다 —
 *  TrainingConsentCard 와 같은 규약(한쪽만 배선되는 드리프트 방지).
 */
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import {
  hasSeenPrivacyClarification,
  rememberPrivacyClarificationSeen,
  shouldShowPrivacyClarification,
} from "../../services/privacyClarification";
import { PrivacyPolicyPage } from "./PrivacyPolicyPage";

export function PrivacyClarificationNotice() {
  const { t } = useTranslation();
  const { humanUser, humanUserUid, humanAuthReady } = useAuth();
  const hasLoaded = usePrivacyConsentStore((s) => s.hasLoaded);
  const loadedUid = usePrivacyConsentStore((s) => s.loadedUid);
  const needsPrompt = usePrivacyConsentStore((s) => s.needsPrompt);

  const [dismissed, setDismissed] = useState(true);
  const [showPolicy, setShowPolicy] = useState(false);

  // 사람 계정으로 확정된 uid 만 본다 — 부팅 중 잠깐 노출되는 에이전트
  // custom-token 신원이 고지 UI 를 몰면 안 된다(PrivacyConsentGate 와 같은 규칙).
  const uid = humanUser && humanAuthReady ? humanUserUid : null;

  useEffect(() => {
    setDismissed(uid ? hasSeenPrivacyClarification(uid) : true);
  }, [uid]);

  const visible = shouldShowPrivacyClarification({
    uid,
    consentLoaded: hasLoaded && loadedUid === uid,
    needsPolicyPrompt: needsPrompt,
    dismissedLocally: dismissed,
  });

  if (showPolicy) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div className="h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg border border-[#313244] shadow-2xl">
          <PrivacyPolicyPage onClose={() => setShowPolicy(false)} />
        </div>
      </div>
    );
  }

  if (!visible || !uid) return null;

  const dismiss = () => {
    rememberPrivacyClarificationSeen(uid);
    setDismissed(true);
  };

  return (
    <div
      data-testid="privacy-clarification-notice"
      className="flex items-center gap-3 border-b border-[#313244] bg-[#181825] px-4 py-2 text-xs text-[#bac2de]"
    >
      <span className="shrink-0 text-[#89b4fa]">
        {t("legal.clarification.label")}
      </span>
      {/* ★truncate 가 아니라 line-clamp-2 다. 2차 고지 문안은 첫 절(약속 철회)이
          잘리면 배너가 존재 이유를 잃는다 — 한 줄 디자인보다 문장이 우선이다. */}
      <span className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-[16px] text-[#a6adc8]">
        {t("legal.clarification.body")}
      </span>
      <button
        type="button"
        onClick={() => setShowPolicy(true)}
        className="shrink-0 text-[11px] text-[#89b4fa] hover:underline"
      >
        {t("legal.clarification.viewDetails")}
      </button>
      <button
        type="button"
        data-testid="privacy-clarification-dismiss"
        onClick={dismiss}
        className="shrink-0 text-[11px] text-[#6c7086] hover:text-[#bac2de]"
      >
        {t("legal.clarification.dismiss")}
      </button>
    </div>
  );
}
